'use strict';

/**
 * Testes do gateway.js — rodam em pasta temporária, nunca tocam o config real.
 *   node litellm-radar/tests/gateway.test.js
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const gateway = require('../gateway');

const FIXTURE = `model_list:
- model_name: alpha
  litellm_params:
    model: groq/alpha
    api_key: key-alpha
    timeout: 45
- model_name: beta
  litellm_params:
    model: gemini/beta
    api_key: key-beta
    timeout: 10
# mesma chave, segunda entrada — balancing entre contas
- model_name: beta
  litellm_params:
    model: gemini/beta
    api_key: key-beta-2
    timeout: 10
- model_name: gamma
  litellm_params:
    model: openrouter/gamma
    api_key: key-gamma
    timeout: 60
- model_name: delta
  litellm_params:
    model: openai/delta
    api_base: http://127.0.0.1:11434/v1
    api_key: ollama
    timeout: 300
# fora da cadeia de proposito
- model_name: omega
  litellm_params:
    model: openai/omega
    api_key: os.environ/OMEGA_KEY
    timeout: 60
litellm_settings:
  fallbacks:
  - alpha:
    - beta
    - gamma
    - delta
  - beta:
    - gamma
    - delta
  - gamma:
    - delta
  context_window_fallbacks:
  - alpha:
    - beta
    - delta
  num_retries: 1
  cooldown_time: 30
  drop_params: true
`;

const results = [];
function test(name, fn) {
  try {
    fn();
    results.push([true, name]);
    console.log('ok   -', name);
  } catch (err) {
    results.push([false, name]);
    console.log('FAIL -', name, '\n      ', err.message);
  }
}

function sandbox(text = FIXTURE) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'litellm-radar-test-'));
  const configPath = path.join(dir, 'config.yaml');
  const statePath = path.join(dir, 'gateway-state.json');
  fs.writeFileSync(configPath, text, 'utf8');
  return { dir, configPath, statePath };
}

/* ---------------------------------------------------------------- testes */

test('deriva a cadeia a partir do config', () => {
  const box = sandbox();
  const snap = gateway.snapshot(box);
  assert.deepStrictEqual(snap.chain, ['alpha', 'beta', 'gamma', 'delta']);
  assert.deepStrictEqual(snap.ctxTargets, ['beta', 'delta']);
  assert.strictEqual(snap.pending, false);
});

test('modelos fora da cadeia ficam excluídos', () => {
  const box = sandbox();
  const snap = gateway.snapshot(box);
  const omega = snap.models.find((m) => m.name === 'omega');
  assert.strictEqual(omega.inChain, false);
});

test('balancing: duas chaves do mesmo modelo viram duas contas', () => {
  const box = sandbox();
  const snap = gateway.snapshot(box);
  const beta = snap.models.find((m) => m.name === 'beta');
  assert.strictEqual(beta.deployments.length, 2);
  assert.notStrictEqual(beta.deployments[0].fingerprint, beta.deployments[1].fingerprint);
  // nenhuma chave crua sai do servidor
  for (const dep of beta.deployments) assert.ok(!dep.masked.includes('key-beta'));
});

test('grava a ordem como sufixos e preserva o resto do arquivo', () => {
  const box = sandbox();
  gateway.saveChain({ chain: ['alpha', 'beta', 'gamma', 'delta'], ctxTargets: ['beta', 'delta'] }, box);
  const out = fs.readFileSync(box.configPath, 'utf8');
  assert.match(out, /  - alpha:\r?\n {4}- beta\r?\n {4}- gamma\r?\n {4}- delta/);
  assert.match(out, /# fora da cadeia de proposito/);
  assert.match(out, /- model_name: omega/);
  assert.match(out, /  num_retries: 1/);
  assert.match(out, /  cooldown_time: 30/);
});

test('reordenar muda a cadeia gravada', () => {
  const box = sandbox();
  gateway.saveChain({ chain: ['gamma', 'alpha', 'beta'], ctxTargets: [] }, box);
  const snap = gateway.snapshot(box);
  assert.deepStrictEqual(snap.chain, ['gamma', 'alpha', 'beta']);
  const out = fs.readFileSync(box.configPath, 'utf8');
  assert.ok(out.indexOf('- gamma:') < out.indexOf('- alpha:'));
});

test('tirar um modelo da sequência remove dos fallbacks', () => {
  const box = sandbox();
  gateway.saveChain({ chain: ['alpha', 'beta', 'delta'], ctxTargets: [] }, box);
  const out = fs.readFileSync(box.configPath, 'utf8');
  assert.ok(!out.includes('- gamma:'));
  const snap = gateway.snapshot(box);
  assert.deepStrictEqual(snap.chain, ['alpha', 'beta', 'delta']);
});

test('gravar de novo sem mudanças não altera o arquivo', () => {
  const box = sandbox();
  gateway.saveChain({ chain: ['alpha', 'beta', 'gamma', 'delta'], ctxTargets: ['beta', 'delta'] }, box);
  const before = fs.readFileSync(box.configPath, 'utf8');
  const again = gateway.saveChain({ chain: ['alpha', 'beta', 'gamma', 'delta'], ctxTargets: ['beta', 'delta'] }, box);
  assert.strictEqual(again.changed, false);
  assert.strictEqual(fs.readFileSync(box.configPath, 'utf8'), before);
});

test('cadeia com menos de dois modelos vira fallbacks vazios', () => {
  const box = sandbox();
  gateway.saveChain({ chain: ['alpha'], ctxTargets: [] }, box);
  const out = fs.readFileSync(box.configPath, 'utf8');
  assert.match(out, /  fallbacks: \[\]/);
  const snap = gateway.snapshot(box);
  assert.deepStrictEqual(snap.chain, []);
  assert.strictEqual(snap.pending, false);
});

test('nomes desconhecidos e duplicados são filtrados', () => {
  const box = sandbox();
  const res = gateway.saveChain(
    { chain: ['inexistente', 'alpha', 'alpha', 'beta'], ctxTargets: ['beta', 'beta', 'nada'] },
    box,
  );
  assert.deepStrictEqual(res.chain, ['alpha', 'beta']);
  assert.deepStrictEqual(res.ctxTargets, ['beta']);
});

test('e-mail por chave vale para todos os modelos daquela chave', () => {
  const box = sandbox();
  const snap = gateway.snapshot(box);
  const alpha = snap.models.find((m) => m.name === 'alpha');
  gateway.saveAccounts([{ fingerprint: alpha.deployments[0].fingerprint, email: 'conta@exemplo.com' }], box);
  const after = gateway.snapshot(box);
  assert.deepStrictEqual(after.models.find((m) => m.name === 'alpha').emails, ['conta@exemplo.com']);
  const acc = after.accounts.find((a) => a.fingerprint === alpha.deployments[0].fingerprint);
  assert.strictEqual(acc.email, 'conta@exemplo.com');
});

test('e-mail em chave de variável de ambiente usa o prefixo env:', () => {
  const box = sandbox();
  gateway.saveAccounts([{ fingerprint: 'env:OMEGA_KEY', email: 'omega@exemplo.com' }], box);
  const snap = gateway.snapshot(box);
  const acc = snap.accounts.find((a) => a.fingerprint === 'env:OMEGA_KEY');
  assert.strictEqual(acc.email, 'omega@exemplo.com');
  assert.strictEqual(acc.envRef, true);
});

test('backup é criado quando o arquivo muda', () => {
  const box = sandbox();
  const res = gateway.saveChain({ chain: ['beta', 'delta'], ctxTargets: [] }, box);
  assert.ok(res.backup);
  assert.ok(fs.existsSync(path.join(box.dir, res.backup)));
});

test('config real do NAS, quando acessível, deriva cadeia coerente', () => {
  let snapshot;
  try {
    gateway.readConfig(gateway.DEFAULT_CONFIG);
  } catch {
    console.log('      (config do NAS inacessível — teste ignorado)');
    return;
  }
  snapshot = gateway.snapshot();
  assert.ok(snapshot.models.length > 0);
  assert.strictEqual(snapshot.chain[0], 'groq-fast');
});

/* --------------------------------------------------------------- resumo */

const failed = results.filter(([ok]) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} testes passaram`);
process.exit(failed ? 1 : 0);
