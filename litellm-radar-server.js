const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3333;
const LITELLM_HOST = '192.168.1.130';
const LITELLM_PORT = 4000;

function getApiKey() {
  try {
    const creds = fs.readFileSync('C:/Users/rodsi/.dsh/.credentials.yaml', 'utf8');
    const match = creds.match(/LITELLM_API_KEY\s*:\s*([^\r\n]+)/);
    return match ? match[1].trim() : '';
  } catch (e) {
    return '';
  }
}

const API_KEY = getApiKey();
console.log('LiteLLM API Key carregada:', API_KEY ? API_KEY.slice(0, 6) + '...' : 'NÃO ENCONTRADA');

async function testModel(modelId) {
  const start = Date.now();
  const url = `http://${LITELLM_HOST}:${LITELLM_PORT}/v1/chat/completions`;
  
  const payload = JSON.stringify({
    model: modelId,
    messages: [{ role: 'user', content: 'Ping' }],
    max_tokens: 30,
    temperature: 0.1
  });

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + API_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      body: payload,
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    const latency = Date.now() - start;

    if (!resp.ok) {
      const errText = await resp.text();
      let errMsg = `HTTP ${resp.status}`;
      try {
        const json = JSON.parse(errText);
        if (json.error && json.error.message) errMsg = json.error.message;
      } catch(e) {}
      return { id: modelId, status: 'offline', latency, error: errMsg };
    }

    const data = await resp.json();
    return { id: modelId, status: 'online', latency, error: null };
  } catch (err) {
    const latency = Date.now() - start;
    let errMsg = err.message;
    if (err.name === 'AbortError') errMsg = 'Timeout (>20s)';
    return { id: modelId, status: 'offline', latency, error: errMsg };
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/' || url.pathname === '/index.html') {
    try {
      const html = fs.readFileSync(path.join(__dirname, 'litellm-radar-index.html'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Erro ao carregar litellm-radar-index.html');
    }
  } else if (url.pathname === '/api/scan') {
    console.log('Iniciando varredura de modelos no LiteLLM...');
    try {
      const modelsResp = await fetch(`http://${LITELLM_HOST}:${LITELLM_PORT}/v1/models`, {
        headers: { 'Authorization': 'Bearer ' + API_KEY }
      });

      if (!modelsResp.ok) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Falha ao listar modelos do LiteLLM (HTTP ' + modelsResp.status + ')' }));
        return;
      }

      const modelsJson = await modelsResp.json();
      const rawModels = modelsJson.data || [];
      const modelIds = rawModels.map(m => m.id);

      console.log(`Encontrados ${modelIds.length} modelos. Testando em paralelo...`);

      const results = await Promise.all(modelIds.map(id => testModel(id)));

      const total = results.length;
      const online = results.filter(r => r.status === 'online').length;
      const offline = total - online;
      const onlineResults = results.filter(r => r.status === 'online' && r.latency);
      const avgLatency = onlineResults.length > 0 
        ? Math.round(onlineResults.reduce((acc, r) => acc + r.latency, 0) / onlineResults.length) 
        : 0;

      const summary = { total, online, offline, avgLatency };

      console.log(`Varredura concluída: ${online}/${total} online. Latência média: ${avgLatency}ms`);

      res.writeHead(200, { 'Content-Type': 'application/json', 'Connection': 'close' });
      res.end(JSON.stringify({ success: true, summary, models: results }, null, 2));
    } catch (e) {
      console.error('Erro na API /api/scan:', e);
      res.writeHead(500, { 'Content-Type': 'application/json', 'Connection': 'close' });
      res.end(JSON.stringify({ success: false, error: e.message }));
    }
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain', 'Connection': 'close' });
    res.end('Not Found');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n==================================================`);
  console.log(` LiteLLM Server Radar rodando em http://localhost:${PORT}`);
  console.log(`==================================================\n`);
});
