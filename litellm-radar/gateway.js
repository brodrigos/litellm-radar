'use strict';

/**
 * gateway.js — leitura e gravação do config.yaml do gateway LiteLLM.
 *
 * Responsabilidades:
 *  - listar as contas/chaves por model_name (balancing: várias entradas com o mesmo nome)
 *  - derivar a cadeia de fallback atual a partir de litellm_settings.fallbacks
 *  - gravar nova ordem de fallback SEM reformatar o resto do arquivo
 *    (substitui apenas os blocos `fallbacks:` e `context_window_fallbacks:`)
 *
 * O estado local (e-mails das contas + ordem escolhida) fica em gateway-state.json,
 * fora do config do gateway, para não misturar dado pessoal com a config do proxy.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const YAML = require('yaml');

const DEFAULT_CONFIG =
  process.env.LITELLM_CONFIG || '//DS3622xs/docker/litellm-gateway/config.yaml';
const DEFAULT_STATE =
  process.env.LITELLM_RADAR_STATE || path.join(__dirname, 'gateway-state.json');

/* --------------------------------------------------------------- helpers */

function fingerprint(apiKey) {
  const raw = String(apiKey == null ? '' : apiKey).trim();
  if (!raw) return 'none';
  if (raw.startsWith('os.environ/')) return 'env:' + raw.slice('os.environ/'.length);
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 12);
}

function maskKey(apiKey) {
  const raw = String(apiKey == null ? '' : apiKey).trim();
  if (!raw) return '—';
  if (raw.startsWith('os.environ/')) return raw;
  if (raw.length <= 12) return raw.slice(0, 4) + '…';
  return raw.slice(0, 6) + '…' + raw.slice(-4);
}

function eolOf(text) {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

function isEmptyState(state) {
  return !state || (!Array.isArray(state.chain) || state.chain.length === 0);
}

/* ---------------------------------------------------------------- estado */

function readState(statePath = DEFAULT_STATE) {
  try {
    const raw = fs.readFileSync(statePath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      accounts: parsed.accounts && typeof parsed.accounts === 'object' ? parsed.accounts : {},
      chain: Array.isArray(parsed.chain) ? parsed.chain.map(String) : [],
      ctxTargets: Array.isArray(parsed.ctxTargets) ? parsed.ctxTargets.map(String) : [],
      updatedAt: parsed.updatedAt || null,
    };
  } catch {
    return { accounts: {}, chain: [], ctxTargets: [], updatedAt: null };
  }
}

function writeState(state, statePath = DEFAULT_STATE) {
  const payload = {
    accounts: state.accounts || {},
    chain: state.chain || [],
    ctxTargets: state.ctxTargets || [],
    updatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

/* ----------------------------------------------------------- leitura config */

function readConfig(configPath = DEFAULT_CONFIG) {
  const text = fs.readFileSync(configPath, 'utf8');
  const data = YAML.parse(text) || {};
  const modelList = Array.isArray(data.model_list) ? data.model_list : [];

  const models = new Map(); // name -> { name, deployments: [], notes }
  const deployments = [];

  for (const entry of modelList) {
    if (!entry || typeof entry !== 'object') continue;
    const name = String(entry.model_name || '').trim();
    if (!name) continue;
    const p = entry.litellm_params || {};
    const apiKey = p.api_key;
    const fp = fingerprint(apiKey);
    const dep = {
      modelName: name,
      fingerprint: fp,
      masked: maskKey(apiKey),
      model: String(p.model || ''),
      apiBase: p.api_base ? String(p.api_base) : null,
      envRef: String(apiKey || '').startsWith('os.environ/'),
    };
    deployments.push(dep);
    if (!models.has(name)) {
      models.set(name, {
        name,
        deployments: [],
        notes: entry.model_info && entry.model_info.notes ? String(entry.model_info.notes) : '',
      });
    }
    models.get(name).deployments.push(dep);
  }

  return { text, data, models, deployments };
}

/**
 * Deriva a cadeia a partir do próprio config.
 *
 * O config atual é um DAG (cada modelo tem sua própria lista). Para editar uma
 * única ordem, expandimos a lista mais completa — que é a que contém todos os
 * elos — e colocamos na frente o único modelo que nunca aparece como alvo
 * (a cabeça real da cadeia, hoje o groq-fast).
 */
function deriveFromConfig(data) {
  const settings = (data && data.litellm_settings) || {};
  const fb = Array.isArray(settings.fallbacks) ? settings.fallbacks : [];

  const lists = [];
  const targetsSeen = new Set();
  for (const entry of fb) {
    if (!entry || typeof entry !== 'object') continue;
    for (const [head, rest] of Object.entries(entry)) {
      const targets = Array.isArray(rest) ? rest.map(String) : [];
      lists.push({ head: String(head), targets });
      for (const t of targets) targetsSeen.add(t);
    }
  }

  let chain = [];
  if (lists.length) {
    const heads = lists.map((l) => l.head);
    const roots = heads.filter((h) => !targetsSeen.has(h));
    const longest = lists.slice().sort((a, b) => b.targets.length - a.targets.length)[0];
    const head = roots.length ? roots[0] : longest.head;

    const push = (name) => {
      if (name && !chain.includes(name)) chain.push(name);
    };
    push(head);
    push(longest.head);
    for (const t of longest.targets) push(t);
    // completa com qualquer elo que só exista em listas menores
    for (const list of lists) {
      push(list.head);
      for (const t of list.targets) push(t);
    }
  }

  const ctx = Array.isArray(settings.context_window_fallbacks) ? settings.context_window_fallbacks : [];
  let ctxTargets = [];
  for (const entry of ctx) {
    if (!entry || typeof entry !== 'object') continue;
    for (const rest of Object.values(entry)) {
      const list = Array.isArray(rest) ? rest.map(String) : [];
      if (list.length > ctxTargets.length) ctxTargets = list;
    }
  }

  return { chain, ctxTargets };
}

/* --------------------------------------------------------- render blocos */

function renderFallbacks(chain) {
  if (!chain || chain.length < 2) return ['  fallbacks: []'];
  const lines = ['  fallbacks:'];
  for (let i = 0; i < chain.length - 1; i += 1) {
    lines.push(`  - ${chain[i]}:`);
    for (const target of chain.slice(i + 1)) lines.push(`    - ${target}`);
  }
  return lines;
}

function renderContextWindow(chain, ctxTargets) {
  const targets = (ctxTargets || []).filter((m) => chain.includes(m));
  const sources = chain.filter((m) => !targets.includes(m));
  if (!targets.length || !sources.length) return ['  context_window_fallbacks: []'];
  const lines = ['  context_window_fallbacks:'];
  for (const source of sources) {
    lines.push(`  - ${source}:`);
    for (const target of targets) lines.push(`    - ${target}`);
  }
  return lines;
}

function replaceBlock(text, startRe, endRe, newLines) {
  const eol = eolOf(text);
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => startRe.test(line));
  if (start < 0) throw new Error('bloco não encontrado: ' + startRe);
  let end = -1;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (endRe.test(lines[i])) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('fim do bloco não encontrado após a linha ' + (start + 1));
  const out = lines.slice(0, start).concat(newLines, lines.slice(end));
  return out.join(eol);
}

/* -------------------------------------------------------------- gravação */

function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    '-' +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

/**
 * Grava a nova cadeia. Só os blocos de fallback são tocados; o restante do
 * arquivo (comentários, chaves, ordem dos modelos) permanece byte a byte.
 */
function saveChain({ chain, ctxTargets }, { configPath = DEFAULT_CONFIG, statePath = DEFAULT_STATE } = {}) {
  const { text, data, models } = readConfig(configPath);
  const known = new Set(models.keys());

  const cleanChain = [];
  for (const name of chain || []) {
    const n = String(name).trim();
    if (!n || !known.has(n) || cleanChain.includes(n)) continue;
    cleanChain.push(n);
  }
  const cleanCtx = [];
  for (const name of ctxTargets || []) {
    const n = String(name).trim();
    if (!n || !known.has(n) || !cleanChain.includes(n) || cleanCtx.includes(n)) continue;
    cleanCtx.push(n);
  }

  // Cadeia com menos de dois modelos não produz entrada de fallback nenhuma
  // (`fallbacks: []`). Normalizamos para vazio, que é o que o arquivo passa a
  // dizer — assim a UI não fica eternamente "pendente".
  if (cleanChain.length < 2) {
    cleanChain.length = 0;
    cleanCtx.length = 0;
  }

  let updated = replaceBlock(
    text,
    /^ {2}fallbacks:(\s*\[\])?\s*$/,
    /^ {2}context_window_fallbacks:(\s*\[\])?\s*$/,
    renderFallbacks(cleanChain),
  );
  updated = replaceBlock(
    updated,
    /^ {2}context_window_fallbacks:(\s*\[\])?\s*$/,
    /^ {2}[A-Za-z_][\w-]*:/,
    renderContextWindow(cleanChain, cleanCtx),
  );

  // ---- validação: estrutura esperada e resto do arquivo intacto ----
  const parsed = YAML.parse(updated) || {};
  const beforeModelList = JSON.stringify(data.model_list || []);
  if (JSON.stringify(parsed.model_list || []) !== beforeModelList) {
    throw new Error('validação falhou: model_list foi alterado');
  }
  const derived = deriveFromConfig(parsed);
  if (JSON.stringify(derived.chain) !== JSON.stringify(cleanChain)) {
    throw new Error('validação falhou: cadeia gravada difere da solicitada');
  }
  for (const key of Object.keys(data)) {
    if (key === 'litellm_settings') continue;
    if (JSON.stringify(parsed[key]) !== JSON.stringify(data[key])) {
      throw new Error('validação falhou: bloco "' + key + '" mudou');
    }
  }
  const beforeSettings = data.litellm_settings || {};
  const afterSettings = parsed.litellm_settings || {};
  for (const key of Object.keys(afterSettings)) {
    if (key === 'fallbacks' || key === 'context_window_fallbacks') continue;
    if (JSON.stringify(afterSettings[key]) !== JSON.stringify(beforeSettings[key])) {
      throw new Error('validação falhou: litellm_settings.' + key + ' mudou');
    }
  }

  let backup = null;
  if (updated !== text) {
    backup = `${configPath}.bak-radar-${stamp()}`;
    fs.copyFileSync(configPath, backup);
    fs.writeFileSync(configPath, updated, 'utf8');
  }

  const previous = readState(statePath);
  writeState(
    {
      accounts: previous.accounts,
      chain: cleanChain,
      ctxTargets: cleanCtx,
    },
    statePath,
  );

  return {
    ok: true,
    changed: updated !== text,
    backup: backup ? path.basename(backup) : null,
    chain: cleanChain,
    ctxTargets: cleanCtx,
  };
}

function saveAccounts(patch, { statePath = DEFAULT_STATE, configPath = DEFAULT_CONFIG } = {}) {
  const { deployments } = readConfig(configPath);
  const known = new Set(deployments.map((d) => d.fingerprint));
  const state = readState(statePath);
  let changed = 0;

  for (const item of Array.isArray(patch) ? patch : [patch]) {
    if (!item || !item.fingerprint) continue;
    const fp = String(item.fingerprint);
    if (!known.has(fp)) continue;
    const email = item.email == null ? '' : String(item.email).trim().slice(0, 120);
    const label = item.label == null ? '' : String(item.label).trim().slice(0, 60);
    const quotaDaily = item.quotaDaily != null && item.quotaDaily !== '' ? Number(item.quotaDaily) : null;
    const quotaUsed = item.quotaUsed != null && item.quotaUsed !== '' ? Number(item.quotaUsed) : null;

    const current = state.accounts[fp] || {};
    const next = { email, label };
    if (quotaDaily != null && !isNaN(quotaDaily)) next.quotaDaily = quotaDaily;
    else if (current.quotaDaily != null) next.quotaDaily = current.quotaDaily;

    if (quotaUsed != null && !isNaN(quotaUsed)) next.quotaUsed = quotaUsed;
    else if (current.quotaUsed != null) next.quotaUsed = current.quotaUsed;

    if (
      current.email !== email ||
      current.label !== label ||
      current.quotaDaily !== next.quotaDaily ||
      current.quotaUsed !== next.quotaUsed
    ) {
      state.accounts[fp] = next;
      changed += 1;
    }
  }

  writeState(state, statePath);
  return { ok: true, accounts: state.accounts, changed };
}

/* ------------------------------------------------------------- snapshot */

function snapshot({ configPath = DEFAULT_CONFIG, statePath = DEFAULT_STATE } = {}) {
  const { data, models, deployments } = readConfig(configPath);
  const state = readState(statePath);
  const derived = deriveFromConfig(data);

  const knownNames = Array.from(models.keys());
  // Modelos novos que aparecem no config entram como "fora da cadeia" por
  // padrão — incluir é decisão explícita do usuário.
  const effective = isEmptyState(state)
    ? derived.chain.slice()
    : state.chain.filter((name) => models.has(name));

  const ctxTargets = isEmptyState(state)
    ? derived.ctxTargets.slice()
    : state.ctxTargets.filter((n) => models.has(n) && effective.includes(n));

  const accountOf = (fp) => state.accounts[fp] || null;

  const accountsMap = new Map();
  for (const dep of deployments) {
    if (!accountsMap.has(dep.fingerprint)) {
      const accState = accountOf(dep.fingerprint) || {};
      accountsMap.set(dep.fingerprint, {
        fingerprint: dep.fingerprint,
        masked: dep.masked,
        model: dep.model,
        apiBase: dep.apiBase,
        envRef: dep.envRef,
        email: accState.email || '',
        label: accState.label || '',
        quotaDaily: accState.quotaDaily ?? null,
        quotaUsed: accState.quotaUsed ?? null,
        models: [],
      });
    }
    const acc = accountsMap.get(dep.fingerprint);
    if (!acc.models.includes(dep.modelName)) acc.models.push(dep.modelName);
    if (!acc.apiBase && dep.apiBase) acc.apiBase = dep.apiBase;
  }

  const list = knownNames.map((name) => {
    const info = models.get(name);
    const index = effective.indexOf(name);
    return {
      name,
      notes: info.notes || '',
      inChain: index >= 0,
      chainIndex: index,
      inCtx: ctxTargets.includes(name),
      deployments: info.deployments.map((dep) => {
        const acc = accountOf(dep.fingerprint) || {};
        return {
          fingerprint: dep.fingerprint,
          masked: dep.masked,
          model: dep.model,
          apiBase: dep.apiBase,
          envRef: dep.envRef,
          email: acc.email || '',
          label: acc.label || '',
        };
      }),
      emails: Array.from(
        new Set(
          info.deployments
            .map((dep) => (accountOf(dep.fingerprint) || {}).email)
            .filter(Boolean),
        ),
      ),
    };
  });

  const pending =
    JSON.stringify(effective) !== JSON.stringify(derived.chain) ||
    JSON.stringify(ctxTargets) !== JSON.stringify(derived.ctxTargets);

  return {
    ok: true,
    configPath,
    updatedAt: state.updatedAt,
    models: list,
    accounts: Array.from(accountsMap.values()),
    chain: effective,
    ctxTargets,
    configChain: derived.chain,
    configCtxTargets: derived.ctxTargets,
    pending,
  };
}

function addAccount({ modelName, apiKey, email, label, apiBase, timeout }, { configPath = DEFAULT_CONFIG, statePath = DEFAULT_STATE } = {}) {
  const name = String(modelName || '').trim();
  const key = String(apiKey || '').trim();
  if (!name || !key) throw new Error('modelName e apiKey são obrigatórios');

  const { text, data } = readConfig(configPath);
  const modelList = Array.isArray(data.model_list) ? data.model_list : [];

  // Pega uma referência de modelo existente com esse name para copiar parâmetros padrão (model, api_base, timeout, etc.)
  const ref = modelList.find((m) => String(m.model_name) === name) || modelList[0];
  const refParams = (ref && ref.litellm_params) || {};

  const newEntry = {
    model_name: name,
    litellm_params: {
      model: refParams.model || 'openai/' + name,
      api_base: apiBase != null ? String(apiBase) : (refParams.api_base || undefined),
      api_key: key,
      timeout: timeout != null ? Number(timeout) : (refParams.timeout || 60),
    },
  };
  if (refParams.max_parallel_requests != null) newEntry.litellm_params.max_parallel_requests = refParams.max_parallel_requests;
  if (refParams.rpm != null) newEntry.litellm_params.rpm = refParams.rpm;
  if (refParams.max_retries != null) newEntry.litellm_params.max_retries = refParams.max_retries;

  if (email || label) {
    newEntry.model_info = {
      notes: `Adicionado via LiteLLM Radar — conta ${email || '—'}`,
    };
  }

  // Insere antes de litellm_settings
  const lines = text.split(/\r?\n/);
  const eol = eolOf(text);
  const insertAt = lines.findIndex((l) => /^litellm_settings:\s*$/.test(l));
  if (insertAt < 0) throw new Error('bloco litellm_settings não encontrado');

  const rendered = YAML.stringify([newEntry], { sortKeys: false });
  const head = lines.slice(0, insertAt);
  const tail = lines.slice(insertAt);
  const updatedText = head.concat(rendered.split(/\r?\n/), '', tail).join(eol);

  // Validação
  const parsed = YAML.parse(updatedText) || {};
  const newModelList = Array.isArray(parsed.model_list) ? parsed.model_list : [];
  if (newModelList.length !== modelList.length + 1) {
    throw new Error('validação falhou ao adicionar chave');
  }

  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13);
  const backup = `${configPath}.bak-radar-${stamp}`;
  fs.copyFileSync(configPath, backup);
  fs.writeFileSync(configPath, updatedText, 'utf8');

  const fp = fingerprint(key);
  if (email || label) {
    const state = readState(statePath);
    state.accounts[fp] = {
      email: email ? String(email).trim() : '',
      label: label ? String(label).trim() : '',
    };
    writeState(state, statePath);
  }

  return { ok: true, backup: path.basename(backup), fingerprint: fp };
}

function removeAccount({ fingerprint: targetFp }, { configPath = DEFAULT_CONFIG, statePath = DEFAULT_STATE } = {}) {
  const fp = String(targetFp || '').trim();
  if (!fp) throw new Error('fingerprint obrigatório');

  const { text, data } = readConfig(configPath);
  const modelList = Array.isArray(data.model_list) ? data.model_list : [];

  let removed = 0;
  const filteredList = modelList.filter((m) => {
    const k = (m.litellm_params || {}).api_key;
    const thisFp = fingerprint(k);
    if (thisFp === fp) {
      removed += 1;
      return false;
    }
    return true;
  });

  if (removed === 0) throw new Error('nenhuma chave encontrada com esse fingerprint');

  data.model_list = filteredList;
  const updatedText = YAML.stringify(data, { sortKeys: false });

  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13);
  const backup = `${configPath}.bak-radar-${stamp}`;
  fs.copyFileSync(configPath, backup);
  fs.writeFileSync(configPath, updatedText, 'utf8');

  const state = readState(statePath);
  if (state.accounts[fp]) {
    delete state.accounts[fp];
    writeState(state, statePath);
  }

  return { ok: true, backup: path.basename(backup), removed };
}

module.exports = {
  DEFAULT_CONFIG,
  DEFAULT_STATE,
  fingerprint,
  maskKey,
  readState,
  writeState,
  readConfig,
  deriveFromConfig,
  renderFallbacks,
  renderContextWindow,
  saveChain,
  saveAccounts,
  addAccount,
  removeAccount,
  snapshot,
};
