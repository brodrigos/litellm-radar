'use strict';

/**
 * Teste de interface do tool.js — roda num DOM mínimo, sem navegador.
 *
 * Monta a ferramenta com um `Brodrigos` de mentira e um `fetch` que devolve
 * fixtures, depois clica de verdade nos botões (reordenar, incluir, tirar) e
 * verifica o que foi enviado ao servidor e o que apareceu na tela.
 *
 *   node litellm-radar/tests/tool.test.js
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/* --------------------------------------------------------- DOM mínimo */

function makeNode(tag) {
  const node = {
    tagName: String(tag).toUpperCase(),
    childNodes: [],
    listeners: {},
    className: '',
    value: '',
    title: '',
    disabled: false,
    style: {},
    dataset: {},
    _attrs: {},
    _text: '',
  };

  // Semântica do DOM real: atribuir textContent limpa os filhos.
  Object.defineProperty(node, 'textContent', {
    get() {
      return node._text;
    },
    set(value) {
      node._text = value == null ? '' : String(value);
      node.childNodes.length = 0;
    },
  });

  node.classList = {
    _set: new Set(),
    add(...names) {
      for (const n of names) node.classList._set.add(n);
    },
    remove(...names) {
      for (const n of names) node.classList._set.delete(n);
    },
    contains(name) {
      return node.classList._set.has(name);
    },
    toggle(name, on) {
      const next = on === undefined ? !node.classList._set.has(name) : Boolean(on);
      if (next) node.classList._set.add(name);
      else node.classList._set.delete(name);
      return next;
    },
  };

  node.append = (...kids) => {
    for (const kid of kids) if (kid) node.childNodes.push(kid);
  };
  node.setAttribute = (key, value) => {
    node._attrs[key] = value;
    if (key === 'title') node.title = value;
    if (key === 'value') node.value = value;
    if (key === 'disabled') node.disabled = true;
  };
  node.addEventListener = (event, fn) => {
    (node.listeners[event] = node.listeners[event] || []).push(fn);
  };
  node.removeEventListener = () => {};
  node.dispatch = (event) => {
    for (const fn of node.listeners[event] || []) fn({ target: node });
  };
  return node;
}

/** Mesma semântica do helper do dashboard. */
function el(tag, props = {}, children = []) {
  const node = makeNode(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node._attrs.html = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (value === true) node.setAttribute(key, '');
    else if (value !== false) node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    // O DOM real só aceita nós; qualquer outra coisa (inclusive array aninhado)
    // vira texto via String(child) — um array de spans apareceria como
    // "[object HTMLSpanElement],[object HTMLSpanElement]".
    if (child && typeof child === 'object' && child.tagName) node.append(child);
    else node.append(String(child));
  }
  return node;
}

function textOf(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (node._text) return node._text;
  return (node.childNodes || []).map(textOf).join(' ');
}

function chainNames(body) {
  return findAll(body, (n) => String(n.className).includes('radar-chain-primary'))
    .flatMap((box) => findAll(box, (n) => String(n.className).includes('radar-chain-row')))
    .map((row) => textOf(findAll(row, (n) => String(n.className).includes('radar-chain-name'))[0]));
}

function findAll(node, predicate, out = []) {
  if (!node) return out;
  if (predicate(node)) out.push(node);
  for (const kid of node.childNodes || []) findAll(kid, predicate, out);
  return out;
}

function clickable(node, label) {
  return findAll(node, (n) => n.tagName === 'BUTTON' && textOf(n).trim() === label);
}

/* ------------------------------------------------------------- fixtures */

const GW = {
  ok: true,
  configPath: '//nas/docker/litellm-gateway/config.yaml',
  updatedAt: '2026-10-27T19:00:00.000Z',
  pending: false,
  chain: ['groq-fast', 'gemini-fallback', 'or-super-vl', 'local-ollama'],
  ctxTargets: ['gemini-fallback', 'local-ollama'],
  configChain: ['groq-fast', 'gemini-fallback', 'or-super-vl', 'local-ollama'],
  configCtxTargets: ['gemini-fallback', 'local-ollama'],
  models: [
    {
      name: 'groq-fast',
      inChain: true,
      chainIndex: 0,
      deployments: [{ fingerprint: 'aaa', masked: 'gsk_teste…AAAA', model: 'groq/openai/gpt-oss-120b' }],
      emails: ['groq@exemplo.com'],
    },
    {
      name: 'gemini-fallback',
      inChain: true,
      chainIndex: 1,
      deployments: [
        { fingerprint: 'bbb', masked: 'AQ.Ab8…OSzw', model: 'gemini/gemini-3.8-flash' },
        { fingerprint: 'ccc', masked: 'AQ.Ab8…h4A', model: 'gemini/gemini-3.8-flash' },
      ],
      emails: ['conta1@exemplo.com', 'conta2@exemplo.com'],
    },
    {
      name: 'or-super-vl',
      inChain: true,
      chainIndex: 2,
      deployments: [{ fingerprint: 'ddd', masked: 'sk-or…c27c', model: 'openrouter/super-vl' }],
      emails: [],
    },
    {
      name: 'local-ollama',
      inChain: true,
      chainIndex: 3,
      deployments: [{ fingerprint: 'eee', masked: 'ollama', model: 'openai/llama3.1-dsh' }],
      emails: [],
    },
    {
      name: 'mistral-free',
      inChain: false,
      chainIndex: -1,
      deployments: [{ fingerprint: 'fff', masked: 'mstrl…6A', model: 'mistral/mistral-small-latest' }],
      emails: [],
    },
  ],
  accounts: [
    { fingerprint: 'bbb', masked: 'AQ.Ab8…OSzw', model: 'gemini/gemini-3.8-flash', email: 'conta1@exemplo.com', models: ['gemini-fallback'] },
    { fingerprint: 'ccc', masked: 'AQ.Ab8…h4A', model: 'gemini/gemini-3.8-flash', email: 'conta2@exemplo.com', models: ['gemini-fallback'] },
    { fingerprint: 'eee', masked: 'ollama', model: 'openai/llama3.1-dsh', email: '', models: ['local-ollama'] },
  ],
};

const SCAN = {
  success: true,
  summary: { total: 2, online: 1, offline: 1, avgLatency: 120 },
  models: [
    { id: 'groq-fast', status: 'online', latency: 120, error: null },
    { id: 'deepseek-web', status: 'offline', latency: 20000, error: 'Timeout (>20s)' },
  ],
};

/* ---------------------------------------------------------------- boot */

const calls = [];
global.fetch = async (url, init) => {
  const body = init && init.body ? JSON.parse(init.body) : null;
  calls.push({ url: String(url), method: (init && init.method) || 'GET', body });
  const payload = String(url).endsWith('/api/scan') ? SCAN : String(url).endsWith('/api/gateway') ? GW : { ok: true };
  return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) };
};

let tool = null;
global.window = {
  Brodrigos: {
    el,
    register(definition) {
      tool = definition;
    },
  },
};

const source = fs.readFileSync(path.join(__dirname, '..', 'tool.js'), 'utf8');
// eslint-disable-next-line no-new-func
new Function('window', source)(global.window);

/* --------------------------------------------------------------- testes */

const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push([true, name]);
    console.log('ok   -', name);
  } catch (err) {
    results.push([false, name]);
    console.log('FAIL -', name, '\n      ', err.message);
  }
}

function mount() {
  const body = makeNode('div');
  const toasts = [];
  const footer = { node: null };
  const ctx = {
    toast: (message, type) => toasts.push([type, message]),
    setFooter: (node) => {
      footer.node = node;
    },
  };
  tool.init(body, ctx);
  return { body, toasts, footer };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

(async () => {
  await test('registra a ferramenta com o id certo', () => {
    assert.ok(tool);
    assert.strictEqual(tool.id, 'litellm-radar');
  });

  const { body, footer } = mount();
  await tick();

  await test('varredura carrega sozinha e mostra online/offline', () => {
    const text = textOf(body);
    assert.match(text, /groq-fast/);
    assert.match(text, /deepseek-web/);
    assert.match(text, /Timeout \(>20s\)/);
    assert.match(text, /120 ms/);
  });

  await test('rodapé tem varredura, salvar ordem e recarregar', () => {
    const labels = findAll(footer.node, (n) => n.tagName === 'BUTTON').map((n) => textOf(n).trim());
    assert.deepStrictEqual(labels, ['Executar Varredura', 'Salvar ordem de fallback', 'Recarregar do gateway', '🔄 Reiniciar LiteLLM']);
  });

  // abre a aba de fallback
  const tab = findAll(body, (n) => n.tagName === 'BUTTON' && textOf(n).trim() === 'Contas & fallback')[0];
  tab.dispatch('click');
  await tick();

  await test('aba de fallback lista a cadeia na ordem do gateway', () => {
    assert.deepStrictEqual(chainNames(body), ['groq-fast', 'gemini-fallback', 'or-super-vl', 'local-ollama']);
  });

  await test('mostra os e-mails das duas contas do mesmo provedor', () => {
    const text = textOf(body);
    assert.match(text, /conta1@exemplo\.com/);
    assert.match(text, /conta2@exemplo\.com/);
    assert.match(text, /2 chaves/);
    assert.match(text, /sem e-mail/);
  });

  await test('chave mascarada nunca aparece crua', () => {
    const text = textOf(body);
    assert.ok(!/gsk_teste…AAAA/.test(text));
    assert.match(text, /AQ\.Ab8…OSzw/);
  });

  await test('modelo fora da cadeia aparece como opção para incluir', () => {
    const excluded = findAll(body, (n) => String(n.className).includes('radar-chip-add')).map(textOf);
    assert.deepStrictEqual(excluded, ['+ mistral-free']);
  });

  await test('tabela de contas exibe campos e barras de cota diária', () => {
    const inputs = findAll(body, (n) => n.tagName === 'INPUT' && String(n.className).includes('radar-quota-input'));
    assert.ok(inputs.length > 0, 'inputs de cota devem existir na tabela de contas');
    const buttons = findAll(body, (n) => n.tagName === 'BUTTON' && textOf(n).trim() === 'Salvar');
    assert.ok(buttons.length > 0, 'botão Salvar cota deve existir');
  });

  await test('seta ↓ troca a ordem e marca alteração pendente', () => {
    const rows = findAll(body, (n) => String(n.className).includes('radar-chain-primary'))
      .flatMap((box) => findAll(box, (n) => String(n.className).includes('radar-chain-row')));
    const down = findAll(rows[0], (n) => n.tagName === 'BUTTON' && textOf(n).trim() === '↓')[0];
    down.dispatch('click');
    assert.deepStrictEqual(chainNames(body), ['gemini-fallback', 'groq-fast', 'or-super-vl', 'local-ollama']);
    assert.match(textOf(body), /Alterações locais ainda não gravadas/);
  });

  await test('✕ tira o modelo da sequência', () => {
    const rows = findAll(body, (n) => String(n.className).includes('radar-chain-primary'))
      .flatMap((box) => findAll(box, (n) => String(n.className).includes('radar-chain-row')));
    const remove = findAll(rows[2], (n) => n.tagName === 'BUTTON' && textOf(n).trim() === '✕')[0];
    remove.dispatch('click');
    assert.deepStrictEqual(chainNames(body), ['gemini-fallback', 'groq-fast', 'local-ollama']);
    assert.match(textOf(body), /\+ or-super-vl/);
  });

  await test('incluir devolve o modelo ao fim da cadeia', () => {
    const chips = findAll(body, (n) => String(n.className).includes('radar-chip-add'));
    const orSuper = chips.find((n) => textOf(n).includes('or-super-vl'));
    orSuper.dispatch('click');
    assert.deepStrictEqual(chainNames(body), ['gemini-fallback', 'groq-fast', 'local-ollama', 'or-super-vl']);
  });

  await test('salvar envia a ordem editada para /api/gateway/chain', async () => {
    const save = findAll(footer.node, (n) => n.tagName === 'BUTTON' && textOf(n).trim() === 'Salvar ordem de fallback')[0];
    save.dispatch('click');
    await tick();
    const post = calls.filter((c) => c.url.endsWith('/api/gateway/chain')).pop();
    assert.ok(post, 'nenhum POST de cadeia');
    assert.strictEqual(post.method, 'POST');
    assert.deepStrictEqual(post.body.chain, ['gemini-fallback', 'groq-fast', 'local-ollama', 'or-super-vl']);
    assert.deepStrictEqual(post.body.ctxTargets, ['gemini-fallback', 'local-ollama']);
  });

  await test('editar o e-mail posta em /api/gateway/accounts', async () => {
    const inputs = findAll(body, (n) => String(n.className).includes('radar-email-input'));
    assert.ok(inputs.length >= 2);
    const input = inputs[0];
    input.value = 'novo@exemplo.com';
    input.dispatch('change');
    await tick();
    const post = calls.filter((c) => c.url.endsWith('/api/gateway/accounts')).pop();
    assert.ok(post, 'nenhum POST de conta');
    assert.deepStrictEqual(post.body.accounts[0].email, 'novo@exemplo.com');
  });

  const failed = results.filter(([ok]) => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} testes passaram`);
  process.exit(failed ? 1 : 0);
})();
