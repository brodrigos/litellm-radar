#!/usr/bin/env node
'use strict';

/**
 * Adiciona 3 entradas de modelo do Haimaker.ai ao config.yaml do LiteLLM,
 * cada uma com sua própria chave e conta, e as coloca em sequência no fallback
 * (uma falha → tenta a próxima).
 *
 * Depois de rodar, reinicie o container do LiteLLM (Portainer → litellm → Restart).
 */

const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const CONFIG = '//DS3622xs/docker/litellm-gateway/config.yaml';

const haimakerKeys = [
  {
    modelName: 'deepseek-web-haimaker-1',
    accountEmail: 'ezsell@gmail.com',
    apiKey: 'sk-c9ymT-U0vzFq_0bkM-o4wQ',
  },
  {
    modelName: 'deepseek-web-haimaker-2',
    accountEmail: 'rodrigobuddy@gmail.com',
    apiKey: 'sk-YojTnxUtd45954MMZZRtBw',
  },
  {
    modelName: 'deepseek-web-haimaker-3',
    accountEmail: 'rodsilva.us@gmail.com',
    apiKey: 'sk-Jyw7p1Gw15QwWYhM1yM5sw',
  },
];

const SHARED_PARAMS = {
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

// 1) Insere as entradas no fim do bloco model_list (antes de 'litellm_settings:')
const insertAt = lines.findIndex((l) => /^litellm_settings:\s*$/.test(l));
if (insertAt < 0) throw new Error('bloco litellm_settings não encontrado');

const entryLines = [];
for (const h of haimakerKeys) {
  entryLines.push(`- model_name: ${h.modelName}`);
  entryLines.push('  litellm_params:');
  entryLines.push(`    model: ${SHARED_PARAMS.model}`);
  entryLines.push(`    api_base: ${SHARED_PARAMS.api_base}`);
  entryLines.push(`    api_key: ${h.apiKey}`);
  entryLines.push(`    timeout: ${SHARED_PARAMS.timeout}`);
  entryLines.push(`    max_parallel_requests: ${SHARED_PARAMS.max_parallel_requests}`);
  entryLines.push(`    rpm: ${SHARED_PARAMS.rpm}`);
  entryLines.push(`    max_retries: ${SHARED_PARAMS.max_retries}`);
  entryLines.push('  model_info:');
  entryLines.push(`    notes: Haimaker.ai — conta ${h.accountEmail} — deepseek-v4.1-flash — bridge local na porta 8010`);
  entryLines.push('');
}

const head = lines.slice(0, insertAt);
const tail = lines.slice(insertAt);
const updatedText = head.concat(entryLines, tail).join(eol);

// 2) Valida YAML
const parsed = YAML.parse(updatedText);
const modelNames = (parsed.model_list || []).map((m) => m.model_name);
for (const h of haimakerKeys) {
  if (!modelNames.includes(h.modelName)) throw new Error(`entrada ${h.modelName} não gravada`);
}
console.log('Entradas validadas no YAML:', haimakerKeys.map((h) => h.modelName).join(', '));

// 3) Backup + grava
const stamp = new Date()
  .toISOString()
  .replace(/[-:]/g, '')
  .slice(0, 13);
const backup = `${CONFIG}.bak-haimaker-${stamp}`;
fs.copyFileSync(CONFIG, backup);
fs.writeFileSync(CONFIG, updatedText, 'utf8');
console.log('Backup:', path.basename(backup));
console.log('Gravado com sucesso. Total de entradas no model_list:', parsed.model_list.length);
