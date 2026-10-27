const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.RADAR_PORT || 3333);
const LITELLM_HOST = process.env.LITELLM_HOST || '192.168.1.130';
const LITELLM_PORT = Number(process.env.LITELLM_PORT || 4000);
const LITELLM_BASE = `http://${LITELLM_HOST}:${LITELLM_PORT}`;

const gateway = require('./litellm-radar/gateway');

/* ----------------------------------------------------------- credenciais */

function readCredential(name) {
  if (process.env[name]) return process.env[name];
  try {
    const creds = fs.readFileSync('C:/Users/rodsi/.dsh/.credentials.yaml', 'utf8');
    const match = creds.match(new RegExp('^\\s*' + name + '\\s*:\\s*[\'"]?([^\'"\\r\\n]+)', 'm'));
    return match ? match[1].trim() : '';
  } catch (e) {
    return '';
  }
}

const API_KEY = readCredential('LITELLM_API_KEY');
console.log('LiteLLM API Key carregada:', API_KEY ? API_KEY.slice(0, 6) + '...' : 'NÃO ENCONTRADA');

/* ----------------------------------------------------------------- utils */

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', Connection: 'close' });
  res.end(JSON.stringify(payload));
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('corpo grande demais'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error('JSON inválido: ' + err.message));
      }
    });
    req.on('error', reject);
  });
}

async function testModel(modelId) {
  const start = Date.now();
  const payload = JSON.stringify({
    model: modelId,
    messages: [{ role: 'user', content: 'Ping' }],
    max_tokens: 30,
    temperature: 0.1,
  });

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);

    const resp = await fetch(`${LITELLM_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + API_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      body: payload,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const latency = Date.now() - start;

    if (!resp.ok) {
      const errText = await resp.text();
      let errMsg = `HTTP ${resp.status}`;
      try {
        const json = JSON.parse(errText);
        if (json.error && json.error.message) errMsg = json.error.message;
      } catch (e) {
        errMsg = errText.slice(0, 300) || errMsg;
      }
      return { id: modelId, status: 'offline', latency, error: errMsg };
    }

    await resp.json();
    return { id: modelId, status: 'online', latency, error: null };
  } catch (err) {
    const latency = Date.now() - start;
    let errMsg = err.message;
    if (err.name === 'AbortError') errMsg = 'Timeout (>20s)';
    return { id: modelId, status: 'offline', latency, error: errMsg };
  }
}

/* --------------------------------------------------------------- reload */

async function restartGateway() {
  const token = process.env.PORTAINER_TOKEN;
  const base = (process.env.PORTAINER_URL || 'http://192.168.1.130:9000').replace(/\/$/, '');
  const endpoint = process.env.PORTAINER_ENDPOINT || '2';
  const container = process.env.LITELLM_CONTAINER || 'litellm';

  if (token) {
    try {
      const listResp = await fetch(`${base}/api/endpoints/${endpoint}/docker/containers/json?all=1`, {
        headers: { 'X-API-Key': token },
      });
      if (listResp.ok) {
        const containers = await listResp.json();
        const hit = (containers || []).find((c) =>
          (c.Names || []).some((n) => n.replace(/^\//, '') === container),
        );
        if (hit) {
          const r = await fetch(
            `${base}/api/endpoints/${endpoint}/docker/containers/${hit.Id}/restart`,
            { method: 'POST', headers: { 'X-API-Key': token } },
          );
          if (r.ok) return { ok: true, method: 'portainer', message: 'Container reiniciado via Portainer.' };
          return { ok: false, method: 'portainer', message: 'Portainer recusou o restart (HTTP ' + r.status + ').' };
        }
        return { ok: false, method: 'portainer', message: `Container "${container}" não encontrado no endpoint ${endpoint}.` };
      }
      return { ok: false, method: 'portainer', message: 'Portainer respondeu HTTP ' + listResp.status + '.' };
    } catch (err) {
      return { ok: false, method: 'portainer', message: 'Falha ao falar com o Portainer: ' + err.message };
    }
  }

  return {
    ok: false,
    method: 'manual',
    message:
      'Config gravada. Para o gateway carregar, reinicie o container do LiteLLM no NAS ' +
      '(Portainer → litellm → Restart). Defina PORTAINER_TOKEN para permitir o restart pelo painel.',
  };
}

/* --------------------------------------------------------------- server */

const server = http.createServer(async (req, res) => {
  // O painel roda em http://127.0.0.1:8899 e chama este servidor em :3333.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const route = url.pathname;

  try {
    /* ---------------------------------------------------- página standalone */
    if (route === '/' || route === '/index.html') {
      try {
        const html = fs.readFileSync(path.join(__dirname, 'litellm-radar-index.html'), 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Erro ao carregar litellm-radar-index.html');
      }
      return;
    }

    /* ------------------------------------------------------------- varredura */
    if (route === '/api/scan') {
      console.log('Varredura de modelos do LiteLLM...');
      const modelsResp = await fetch(`${LITELLM_BASE}/v1/models`, {
        headers: { Authorization: 'Bearer ' + API_KEY },
      });
      if (!modelsResp.ok) {
        return sendJson(res, 502, {
          success: false,
          error: 'Falha ao listar modelos do LiteLLM (HTTP ' + modelsResp.status + ')',
        });
      }
      const modelsJson = await modelsResp.json();
      const modelIds = (modelsJson.data || []).map((m) => m.id);
      const results = await Promise.all(modelIds.map((id) => testModel(id)));

      const total = results.length;
      const online = results.filter((r) => r.status === 'online').length;
      const offline = total - online;
      const onlineResults = results.filter((r) => r.status === 'online' && r.latency);
      const avgLatency = onlineResults.length
        ? Math.round(onlineResults.reduce((acc, r) => acc + r.latency, 0) / onlineResults.length)
        : 0;

      console.log(`Varredura: ${online}/${total} online, média ${avgLatency}ms`);
      return sendJson(res, 200, {
        success: true,
        summary: { total, online, offline, avgLatency },
        models: results,
      });
    }

    /* ---------------------------------------------- gateway: contas/fallback */
    if (route === '/api/gateway' && req.method === 'GET') {
      return sendJson(res, 200, gateway.snapshot());
    }

    if (route === '/api/gateway/accounts' && req.method === 'POST') {
      const body = await readBody(req);
      const result = gateway.saveAccounts(body.accounts || body);
      return sendJson(res, 200, { ok: true, ...result, snapshot: gateway.snapshot() });
    }

    if (route === '/api/gateway/chain' && req.method === 'POST') {
      const body = await readBody(req);
      if (!Array.isArray(body.chain)) {
        return sendJson(res, 400, { ok: false, error: 'campo "chain" deve ser uma lista' });
      }
      const result = gateway.saveChain({
        chain: body.chain,
        ctxTargets: Array.isArray(body.ctxTargets) ? body.ctxTargets : [],
      });
      return sendJson(res, 200, { ...result, snapshot: gateway.snapshot() });
    }

    if (route === '/api/gateway/reload' && req.method === 'POST') {
      const result = await restartGateway();
      return sendJson(res, result.ok ? 200 : 409, result);
    }

    return sendJson(res, 404, { ok: false, error: 'Not Found' });
  } catch (err) {
    console.error('Erro em', route, '-', err.message);
    return sendJson(res, 500, { ok: false, error: err.message });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n==================================================`);
  console.log(` LiteLLM Server Radar rodando em http://localhost:${PORT}`);
  console.log(` config do gateway: ${gateway.DEFAULT_CONFIG}`);
  console.log(`==================================================\n`);
});
