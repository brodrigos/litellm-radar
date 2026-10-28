#!/usr/bin/env node
'use strict';

/**
 * Ajusta o config.yaml do LiteLLM para balanceamento real do Haimaker:
 *  - Todas as entradas Haimaker usam model_name: deepseek-web (mesmo nome => LiteLLM faz balanceamento)
 *  - Remove entradas órfãs com nomes diferentes (deepseek-web-haimaker-*, Haimaker-Deepseek-v4.1-flash)
 *  - Mantém apenas 1 entrada original deepseek-web + 3 novas Haimaker = 4 entradas no balanceamento
 *  - Salva backup antes de gravar
 */

const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const CONFIG = '//DS3622xs/docker/litellm-gateway/config.yaml';

const haimakerAccounts = [
  { accountEmail: 'ezsell@gmail.com', apiKey: 'sk-c9ymT-U0vzFq_0bkM-o4wQ' },
  { accountEmail: 'rodrigobuddy@gmail.com', apiKey: 'sk-YojTnxUtd45954MMZZRtBw' },
  { accountEmail: 'rodsilva.us@gmail.com', apiKey: 'sk-Jyw7p1Gw15QwWYhM1yM5sw' },
];

const SHARED = {
  model: 'deepseek/deepseek-v4.1-flash',
  api_base: 'http://192.168.1.130:8010/v1',
  timeout: 300,
  max_parallel_requests: 2,
  rpm: 10,
  max_retries: 0,
};

const text = fs.readFileSync(CONFIG, 'utf8');
const eol = text.includes('\r\n') ? '\r\n' : '\n';
const lines = text.split(/\r?\n/);

// Encontra o bloco model_list (linha 'model_list:' até a próxima chave de nível 1)
const startIdx = lines.findIndex((l) => /^model_list:\s*$/.test(l));
if (startIdx < 0) throw new Error('bloco model_list não encontrado');
const endIdx = lines.findIndex((l, i) => i > startIdx && /^[a-z_]+:\s*$/.test(l));
if (endIdx < 0) throw new Error('fim do bloco model_list não encontrado');

// Reconstroi entradas: mantém apenas entradas que NÃO são órfãs nem deepseek-web duplicadas
const data = YAML.parse(text) || {};
const modelList = Array.isArray(data.model_list) ? data.model_list : [];

const kept = modelList.filter((m) => {
  const name = m.model_name;
  // remove órfãs com nome diferente (não fazem balanceamento)
  if (name === 'deepseek-web-haimaker-1' || name === 'deepseek-web-haimaker-2' ||
      name === 'deepseek-web-haimaker-3' || name === 'Haimaker-Deepseek-v4.1-flash') {
    return false;
  }
  // remove entradas deepseek-web que não sejam a original sk-local-change-me
  if (name === 'deepseek-web' && m.litellm_params.api_key !== 'sk-local-change-me') {
    return false;
  }
  return true;
});

const removedCount = modelList.length - kept.length;

// Renderiza o bloco model_list mantendo estilo do arquivo original
const renderEntry = (m) => {
  const p = m.litellm_params || {};
  const lines_ = [];
  lines_.push(`- model_name: ${m.model_name}`);
  lines_.push('  litellm_params:');
  lines_.push(`    model: ${p.model || ''}`);
  if (p.api_base) lines_.push(`    api_base: ${p.api_base}`);
  lines_.push(`    api_key: ${p.api_key || ''}`);
  if (p.timeout != null) lines_.push(`    timeout: ${p.timeout}`);
  if (p.max_parallel_requests != null) lines_.push(`    max_parallel_requests: ${p.max_parallel_requests}`);
  if (p.rpm != null) lines_.push(`    rpm: ${p.rpm}`);
  if (p.max_retries != null) lines_.push(`    max_retries: ${p.max_retries}`);
  if (m.model_info && m.model_info.notes) {
    lines_.push('  model_info:');
    lines_.push(`    notes: ${m.model_info.notes}`);
  }
  return lines_;
};

// Bloco novo: entradas mantidas + 3 novas Haimaker
const newBlockLines = [];
for (const m of kept) newBlockLines.push(...renderEntry(m));
for (const acc of haimakerAccounts) {
  newBlockLines.push('- model_name: deepseek-web');
  newBlockLines.push('  litellm_params:');
  newBlockLines.push(`    model: ${SHARED.model}`);
  newBlockLines.push(`    api_base: ${SHARED.api_base}`);
  newBlockLines.push(`    api_key: ${acc.apiKey}`);
  newBlockLines.push(`    timeout: ${SHARED.timeout}`);
  newBlockLines.push(`    max_parallel_requests: ${SHARED.max_parallel_requests}`);
  newBlockLines.push(`    rpm: ${SHARED.rpm}`);
  newBlockLines.push(`    max_retries: ${SHARED.max_retries}`);
  newBlockLines.push('  model_info:');
  newBlockLines.push(`    notes: Haimaker.ai — conta ${acc.accountEmail} — deepseek-v4.1-flash (balanceamento com outras contas Haimaker) — bridge local porta 8010`);
}

const head = lines.slice(0, startIdx + 1); // inclui 'model_list:'
const tail = lines.slice(endIdx); // a partir de 'litellm_settings:'
const updatedText = head.concat(newBlockLines, tail).join(eol);

// Validação
const parsed = YAML.parse(updatedText);
const deepseekWebEntries = (parsed.model_list || []).filter((m) => m.model_name === 'deepseek-web');
console.log('Entradas deepseek-web (balanceamento):', deepseekWebEntries.length);
if (deepseekWebEntries.length !== 4) throw new Error('esperava 4 entradas deepseek-web');
const keysOk = haimakerAccounts.every((acc) =>
  deepseekWebEntries.some((e) => e.litellm_params.api_key === acc.apiKey)) &&
  deepseekWebEntries.some((e) => e.litellm_params.api_key === 'sk-local-change-me');
if (!keysOk) throw new Error('chaves do Haimaker ou original não gravadas corretamente');

// Garante que não há mais deepseek-web-haimaker nem Haimaker-Deepseek-v4.1-flash
const orphans = (parsed.model_list || []).filter((m) =>
  m.model_name.startsWith('deepseek-web-haimaker') || m.model_name === 'Haimaker-Deepseek-v4.1-flash');
if (orphans.length) throw new Error('ainda há entradas órfãs: ' + orphans.map((o) => o.model_name).join(', '));

const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13);
const backup = `${CONFIG}.bak-haimaker-balance-${stamp}`;
fs.copyFileSync(CONFIG, backup);
fs.writeFileSync(CONFIG, updatedText, 'utf8');
console.log('Backup:', path.basename(backup));
console.log('Removidas entradas órfãs:', removedCount);
console.log('Total de entradas model_list:', parsed.model_list.length);
console.log('Reinicie o container do LiteLLM (Portainer → litellm → Restart)');
