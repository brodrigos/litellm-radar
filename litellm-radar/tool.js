/**
 * LiteLLM Server Radar — ferramenta do Brodrigos Dashboard.
 *
 * Duas abas:
 *  - Varredura: testa todos os model_name do gateway (latência/online).
 *  - Contas & fallback: mostra qual conta (e-mail) gerou cada API key, agrupa
 *    as várias chaves de um mesmo provedor e permite editar a ordem de fallback,
 *    incluindo ou tirando modelos da sequência.
 */
(function (global) {
  'use strict';

  const B = global.Brodrigos;
  if (!B) return;
  const el = B.el;

  const SERVER_URL = 'http://localhost:3333';

  async function jsonFetch(path, init) {
    const res = await fetch(SERVER_URL + path, {
      cache: 'no-store',
      ...(init || {}),
      headers: init && init.body ? { 'Content-Type': 'application/json' } : undefined,
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      const message = (payload && (payload.error || payload.message)) || 'HTTP ' + res.status;
      const err = new Error(message);
      err.payload = payload;
      throw err;
    }
    return payload;
  }

  B.register({
    id: 'litellm-radar',
    name: 'LiteLLM Server Radar',
    icon: '📡',
    description:
      'Varredura de modelos do gateway LiteLLM, contas/chaves por provedor e edição da ordem de fallback.',
    init(body, ctx) {
      const state = {
        tab: 'scan',
        scan: { data: null, error: null, filter: 'all', query: '', running: false },
        gw: {
          data: null,
          error: null,
          loading: false,
          chain: [],
          ctx: [],
          dirty: false,
          saving: false,
        },
      };

      const root = el('div', { class: 'radar' });
      const tabsBar = el('div', { class: 'radar-tabs' });
      const viewScan = el('div', { class: 'radar-panel' });
      const viewGw = el('div', { class: 'radar-panel' });
      root.append(tabsBar, viewScan, viewGw);
      body.append(root);

      /* -------------------------------------------------------------- abas */

      const TABS = [
        ['scan', 'Varredura'],
        ['gateway', 'Contas & fallback'],
      ];
      const tabNodes = new Map();
      for (const [id, label] of TABS) {
        const node = el('button', {
          class: 'radar-tab' + (id === state.tab ? ' on' : ''),
          type: 'button',
          text: label,
          onclick: () => {
            state.tab = id;
            syncTabs();
            if (id === 'gateway' && !state.gw.data) loadGateway();
          },
        });
        tabNodes.set(id, node);
        tabsBar.append(node);
      }

      function syncTabs() {
        for (const [id, node] of tabNodes) node.classList.toggle('on', id === state.tab);
        viewScan.style.display = state.tab === 'scan' ? '' : 'none';
        viewGw.style.display = state.tab === 'gateway' ? '' : 'none';
      }

      /* --------------------------------------------------------- varredura */

      const scanStats = el('div', { class: 'radar-stats' });
      const scanStatus = el('div', { class: 'radar-status' });
      const scanBar = el('div', { class: 'radar-bar' });
      const scanWrap = el('div', {});
      viewScan.append(scanStats, scanStatus, scanBar, scanWrap);

      const scanSearch = el('input', {
        type: 'search',
        placeholder: 'filtrar por nome do modelo...',
        oninput: (ev) => {
          state.scan.query = ev.target.value;
          renderScanTable();
        },
      });
      scanBar.append(scanSearch);

      const FILTERS = [
        ['all', 'todos'],
        ['online', 'online'],
        ['offline', 'offline'],
      ];
      const chipNodes = [];
      for (const [id, label] of FILTERS) {
        const node = el('button', {
          class: 'radar-chip' + (id === 'all' ? ' on' : ''),
          type: 'button',
          text: label,
          onclick: () => {
            state.scan.filter = id;
            chipNodes.forEach((n) => n.classList.toggle('on', n.dataset.filter === id));
            renderScanTable();
          },
        });
        node.dataset.filter = id;
        chipNodes.push(node);
        scanBar.append(node);
      }

      function statCard(value, label, extraClass) {
        return el('div', { class: 'radar-stat' + (extraClass ? ' ' + extraClass : '') }, [
          el('b', { text: String(value) }),
          el('span', { text: label }),
        ]);
      }

      function renderScanStats() {
        const summary = state.scan.data && state.scan.data.summary;
        scanStats.textContent = '';
        if (!summary) {
          scanStats.append(
            statCard('—', 'total de modelos'),
            statCard('—', 'online'),
            statCard('—', 'offline'),
            statCard('—', 'latência média'),
          );
          return;
        }
        scanStats.append(
          statCard(summary.total, 'total de modelos'),
          statCard(summary.online, 'online', summary.online ? 'is-online' : ''),
          statCard(summary.offline, 'offline', summary.offline ? 'is-offline' : ''),
          statCard(summary.avgLatency + ' ms', 'latência média'),
        );
      }

      function renderScanTable() {
        scanWrap.textContent = '';
        const all = (state.scan.data && state.scan.data.models) || [];
        if (!all.length) {
          scanWrap.append(
            el('div', { class: 'radar-empty' }, [
              el('p', {
                text: state.scan.running
                  ? 'Varrendo modelos do LiteLLM...'
                  : 'Clique em "Executar Varredura" para testar os modelos.',
              }),
            ]),
          );
          return;
        }

        const q = state.scan.query.trim().toLowerCase();
        const rows = all.filter((m) => {
          if (q && !m.id.toLowerCase().includes(q)) return false;
          if (state.scan.filter === 'online' && m.status !== 'online') return false;
          if (state.scan.filter === 'offline' && m.status !== 'offline') return false;
          return true;
        });

        const table = el('table', { class: 'radar-table' }, [
          el('thead', {}, [
            el('tr', {}, [
              el('th', { text: 'status' }),
              el('th', { text: 'modelo' }),
              el('th', { text: 'latência' }),
              el('th', { text: 'detalhes / erro' }),
            ]),
          ]),
        ]);
        const tbody = el('tbody');
        table.append(tbody);

        for (const m of rows) {
          const online = m.status === 'online';
          tbody.append(
            el('tr', { class: 'radar-row' }, [
              el('td', {}, [
                el('span', {
                  class: 'radar-pill ' + (online ? 'is-up' : 'is-down'),
                  text: online ? 'ONLINE' : 'OFFLINE',
                }),
              ]),
              el('td', {}, [el('code', { class: 'radar-name', text: m.id })]),
              el('td', {}, [
                el('span', { class: 'radar-lat', text: m.latency ? m.latency + 'ms' : 'N/A' }),
              ]),
              el('td', {}, [el('span', { class: 'radar-muted', text: m.error || 'Operacional (OK)' })]),
            ]),
          );
        }

        scanWrap.append(table);
        if (!rows.length) {
          scanWrap.append(
            el('div', { class: 'radar-empty', text: 'Nenhum modelo encontrado com os filtros atuais.' }),
          );
        }
      }

      function renderScan() {
        renderScanStats();
        renderScanTable();
        scanStatus.textContent = state.scan.running
          ? 'Varrendo servidor LiteLLM...'
          : state.scan.error
            ? 'Erro: ' + state.scan.error
            : state.scan.data
              ? 'Última varredura concluída.'
              : 'Aguardando varredura.';
      }

      async function scan() {
        if (state.scan.running) return;
        state.scan.running = true;
        state.scan.error = null;
        renderScan();
        ctx.toast('Conectando ao servidor radar...', 'info');
        try {
          state.scan.data = await jsonFetch('/api/scan');
          ctx.toast('Varredura concluída!', 'success');
        } catch (err) {
          state.scan.error = err.message;
          ctx.toast('Falha na varredura: ' + err.message, 'error');
        } finally {
          state.scan.running = false;
          renderScan();
        }
      }

      /* ------------------------------------------------- contas & fallback */

      const gwStatus = el('div', { class: 'radar-status' });
      const gwBody = el('div', { class: 'radar-stack' });
      viewGw.append(gwStatus, gwBody);

      function modelOf(name) {
        return (state.gw.data && state.gw.data.models || []).find((m) => m.name === name) || {
          name,
          deployments: [],
          emails: [],
        };
      }

      function emailBadge(name) {
        const model = modelOf(name);
        const emails = model.emails || [];
        if (!emails.length) {
          const n = (model.deployments || []).length;
          return el('span', {
            class: 'radar-mail is-missing',
            text: n > 1 ? n + ' contas · sem e-mail' : 'sem e-mail',
          });
        }
        const node = el('span', { class: 'radar-mail', text: emails.join(' · ') });
        if (emails.length > 1) node.classList.add('is-multi');
        return node;
      }

      function chainRow(name, index, list, kind) {
        const model = modelOf(name);
        const isCtx = kind === 'ctx';

        const up = el('button', {
          class: 'radar-icon-btn',
          type: 'button',
          title: 'subir',
          text: '↑',
          disabled: index === 0,
          onclick: () => {
            if (index === 0) return;
            const arr = isCtx ? state.gw.ctx : state.gw.chain;
            [arr[index - 1], arr[index]] = [arr[index], arr[index - 1]];
            markDirty();
            renderGateway();
          },
        });

        const down = el('button', {
          class: 'radar-icon-btn',
          type: 'button',
          title: 'descer',
          text: '↓',
          disabled: index === list.length - 1,
          onclick: () => {
            const arr = isCtx ? state.gw.ctx : state.gw.chain;
            if (index >= arr.length - 1) return;
            [arr[index + 1], arr[index]] = [arr[index], arr[index + 1]];
            markDirty();
            renderGateway();
          },
        });

        const remove = el('button', {
          class: 'radar-icon-btn is-remove',
          type: 'button',
          title: isCtx ? 'tirar do fallback de contexto' : 'tirar da sequência de fallback',
          text: '✕',
          onclick: () => {
            if (isCtx) {
              state.gw.ctx = state.gw.ctx.filter((n) => n !== name);
            } else {
              state.gw.chain = state.gw.chain.filter((n) => n !== name);
              state.gw.ctx = state.gw.ctx.filter((n) => n !== name);
            }
            markDirty();
            renderGateway();
          },
        });

        const ctxToggle = isCtx
          ? null
          : el('button', {
              class: 'radar-icon-btn' + (state.gw.ctx.includes(name) ? ' is-on' : ''),
              type: 'button',
              title: state.gw.ctx.includes(name)
                ? 'tirar do fallback por contexto'
                : 'usar como fallback por limite de contexto',
              text: 'ctx',
              onclick: () => {
                state.gw.ctx = state.gw.ctx.includes(name)
                  ? state.gw.ctx.filter((n) => n !== name)
                  : state.gw.ctx.concat(name);
                markDirty();
                renderGateway();
              },
            });

        const meta = [emailBadge(name)];
        if ((model.deployments || []).length > 1) {
          meta.push(el('span', { class: 'radar-pill', text: model.deployments.length + ' chaves' }));
        }
        if (!isCtx && state.gw.ctx.includes(name)) {
          meta.push(el('span', { class: 'radar-pill is-ctx', text: 'ctx' }));
        }

        return el('div', { class: 'radar-chain-row' }, [
          el('span', { class: 'radar-chain-idx', text: String(index + 1) }),
          el('div', { class: 'radar-chain-main' }, [
            el('code', { class: 'radar-chain-name', text: name }),
            el('div', { class: 'radar-chain-meta' }, meta),
          ]),
          el('div', { class: 'radar-chain-actions' }, [ctxToggle, up, down, remove]),
        ]);
      }

      function addRow(kind) {
        const candidates =
          kind === 'ctx'
            ? state.gw.chain.filter((n) => !state.gw.ctx.includes(n))
            : (state.gw.data.models || [])
                .map((m) => m.name)
                .filter((n) => !state.gw.chain.includes(n));

        if (!candidates.length) {
          return el('div', {
            class: 'radar-add-empty',
            text:
              kind === 'ctx'
                ? 'todos os modelos da cadeia já estão no fallback de contexto'
                : 'todos os modelos já estão na cadeia',
          });
        }

        const select = el('select', { class: 'radar-select' });
        for (const name of candidates) select.append(el('option', { value: name, text: name }));

        const add = el('button', {
          class: 'btn btn-secondary',
          type: 'button',
          text: '+ incluir',
          onclick: () => {
            const name = select.value;
            if (!name) return;
            if (kind === 'ctx') state.gw.ctx = state.gw.ctx.concat(name);
            else state.gw.chain = state.gw.chain.concat(name);
            markDirty();
            renderGateway();
          },
        });

        return el('div', { class: 'radar-add-row' }, [select, add]);
      }

      function sectionTitle(title, hint) {
        return el('div', { class: 'radar-section-head' }, [
          el('h3', { class: 'radar-section-title', text: title }),
          hint ? el('span', { class: 'radar-hint', text: hint }) : null,
        ]);
      }

      function renderAccounts() {
        const accounts = (state.gw.data && state.gw.data.accounts) || [];
        if (!accounts.length) {
          return el('div', { class: 'radar-empty', text: 'Nenhuma chave lida do config do gateway.' });
        }

        const table = el('table', { class: 'radar-table radar-accounts' }, [
          el('thead', {}, [
            el('tr', {}, [
              el('th', { text: 'provedor / modelo base' }),
              el('th', { text: 'chave' }),
              el('th', { text: 'e-mail da conta' }),
              el('th', { text: 'cota diária / uso' }),
              el('th', { text: 'usada em' }),
            ]),
          ]),
        ]);
        const tbody = el('tbody');
        table.append(tbody);

        for (const acc of accounts) {
          const input = el('input', {
            type: 'text',
            class: 'radar-email-input',
            placeholder: 'conta@exemplo.com',
            value: acc.email || '',
            onchange: async (ev) => {
              const email = ev.target.value.trim();
              try {
                const res = await jsonFetch('/api/gateway/accounts', {
                  method: 'POST',
                  body: JSON.stringify({ accounts: [{ fingerprint: acc.fingerprint, email, quotaDaily: acc.quotaDaily, quotaUsed: acc.quotaUsed }] }),
                });
                state.gw.data = res.snapshot || state.gw.data;
                ctx.toast(email ? 'E-mail salvo' : 'E-mail removido', 'success');
                renderGateway();
              } catch (err) {
                ctx.toast('Falha ao salvar e-mail: ' + err.message, 'error');
              }
            },
          });

          // Inputs de cota
          const dailyInput = el('input', {
            type: 'number',
            class: 'radar-email-input radar-quota-input',
            placeholder: 'Máx',
            value: acc.quotaDaily != null ? acc.quotaDaily : '',
            title: 'Cota diária limite',
          });
          const usedInput = el('input', {
            type: 'number',
            class: 'radar-email-input radar-quota-input',
            placeholder: 'Uso',
            value: acc.quotaUsed != null ? acc.quotaUsed : '',
            title: 'Uso atual atingido',
          });

          const saveQuotaBtn = el('button', {
            class: 'btn btn-secondary radar-quota-save',
            type: 'button',
            text: 'Salvar',
            onclick: async () => {
              const quotaDaily = dailyInput.value === '' ? null : Number(dailyInput.value);
              const quotaUsed = usedInput.value === '' ? null : Number(usedInput.value);
              try {
                const res = await jsonFetch('/api/gateway/accounts', {
                  method: 'POST',
                  body: JSON.stringify({ accounts: [{ fingerprint: acc.fingerprint, email: acc.email, quotaDaily, quotaUsed }] }),
                });
                state.gw.data = res.snapshot || state.gw.data;
                ctx.toast('Cota atualizada!', 'success');
                renderGateway();
              } catch (err) {
                ctx.toast('Falha ao atualizar cota: ' + err.message, 'error');
              }
            },
          });

          // Barra de progresso se houver cota definida
          let progressBar = null;
          if (acc.quotaDaily && acc.quotaDaily > 0) {
            const used = acc.quotaUsed || 0;
            const pct = Math.min(100, Math.round((used / acc.quotaDaily) * 100));
            const colorClass = pct >= 90 ? 'is-danger' : pct >= 75 ? 'is-warn' : 'is-ok';
            progressBar = el('div', { class: 'radar-quota-wrap' }, [
              el('div', { class: 'radar-quota-bar-bg' }, [
                el('div', { class: 'radar-quota-bar-fill ' + colorClass, style: { width: pct + '%' } }),
              ]),
              el('span', { class: 'radar-quota-text', text: `${used} / ${acc.quotaDaily} (${pct}%)` }),
            ]);
          } else {
            progressBar = el('span', { class: 'radar-muted', text: '—' });
          }

          tbody.append(
            el('tr', {}, [
              el('td', {}, [
                el('div', { class: 'radar-code', text: acc.model }),
                acc.envRef ? el('span', { class: 'radar-pill', text: 'variável de ambiente' }) : null,
                acc.apiBase
                  ? el('div', { class: 'radar-tier', text: String(acc.apiBase).replace(/^https?:\/\//, '') })
                  : null,
              ]),
              el('td', {}, [el('code', { class: 'radar-code', text: acc.masked })]),
              el('td', {}, [input]),
              el('td', {}, [
                el('div', { class: 'radar-quota-edit-row' }, [dailyInput, usedInput, saveQuotaBtn]),
                progressBar,
              ]),
              el('td', {}, [
                ...(acc.models || []).map((name) => el('span', { class: 'radar-pill', text: name })),
                el('button', {
                  class: 'radar-icon-btn is-remove',
                  type: 'button',
                  title: 'apagar esta chave do config.yaml',
                  text: '🗑️',
                  onclick: async () => {
                    if (!confirm('Apagar a chave ' + acc.masked + ' do config.yaml?')) return;
                    try {
                      const res = await jsonFetch('/api/gateway/account/remove', {
                        method: 'POST',
                        body: JSON.stringify({ fingerprint: acc.fingerprint }),
                      });
                      state.gw.data = res.snapshot || state.gw.data;
                      ctx.toast('Chave removida (' + res.removed + ' entrada(s))', 'success');
                      renderGateway();
                    } catch (err) {
                      ctx.toast('Falha ao remover: ' + err.message, 'error');
                    }
                  },
                }),
              ]),
            ]),
          );
        }

        return table;
      }

      function renderGateway() {
        gwBody.textContent = '';

        if (state.gw.loading) {
          gwStatus.textContent = 'Lendo config.yaml do gateway...';
          return;
        }
        if (state.gw.error) {
          gwStatus.textContent = 'Falha ao ler o gateway: ' + state.gw.error;
          gwBody.append(
            el('div', { class: 'radar-empty' }, [
              el('p', {
                text: 'O servidor local (localhost:3333) precisa estar rodando e conseguir ler o config.yaml no NAS.',
              }),
              el('code', { text: 'node litellm-radar-server.js' }),
            ]),
          );
          return;
        }
        if (!state.gw.data) {
          gwStatus.textContent = 'Aguardando leitura do gateway.';
          return;
        }

        const data = state.gw.data;
        gwStatus.textContent =
          (state.gw.dirty ? 'Alterações locais ainda não gravadas no config.yaml. ' : '') +
          'config: ' + data.configPath +
          (data.updatedAt ? ' · editado ' + new Date(data.updatedAt).toLocaleString() : '');

        gwBody.append(
          sectionTitle(
            'Ordem de fallback',
            'o 1º é o principal; cada um cai para o próximo da lista. Use ✕ para tirar da sequência.',
          ),
        );

        const chainBox = el('div', { class: 'radar-chain radar-chain-primary' });
        if (!state.gw.chain.length) {
          chainBox.append(el('div', { class: 'radar-empty', text: 'Cadeia vazia — nenhum fallback será aplicado.' }));
        } else {
          state.gw.chain.forEach((name, i) => chainBox.append(chainRow(name, i, state.gw.chain, 'chain')));
        }
        chainBox.append(addRow('chain'));
        gwBody.append(chainBox);

        gwBody.append(
          el('details', { class: 'radar-details' }, [
            el('summary', { class: 'radar-summary', text: 'Fallback por limite de contexto (prompt grande)' }),
            el('p', {
              class: 'radar-hint',
              text: 'Aplicado aos modelos da cadeia que não estão nesta lista — hoje manda prompt grande para os modelos de 1M de contexto.',
            }),
            el('div', { class: 'radar-chain radar-chain-ctx' }, [
              ...(state.gw.ctx.length
                ? state.gw.ctx.map((name, i) => chainRow(name, i, state.gw.ctx, 'ctx'))
                : [el('div', { class: 'radar-empty', text: 'Nenhum modelo marcado (context_window_fallbacks vazio).' })]),
              addRow('ctx'),
            ]),
          ]),
        );

        gwBody.append(
          sectionTitle(
            'Contas e chaves',
            'a mesma chave pode servir vários modelos; o e-mail vale para todas as entradas dela.',
          ),
        );
        gwBody.append(renderAccounts());

        // Formulário para adicionar nova chave/conta
        const allModelNames = (state.gw.data.models || []).map((m) => m.name);
        const addModelSelect = el('select', { class: 'radar-select' });
        for (const name of allModelNames) addModelSelect.append(el('option', { value: name, text: name }));

        const addKeyInput = el('input', {
          type: 'text',
          class: 'radar-email-input',
          placeholder: 'sk-... ou token',
        });
        const addEmailInput = el('input', {
          type: 'text',
          class: 'radar-email-input',
          placeholder: 'conta@exemplo.com',
        });
        const addBtn = el('button', {
          class: 'btn btn-primary',
          type: 'button',
          text: '+ Adicionar Chave',
          onclick: async () => {
            const modelName = addModelSelect.value;
            const apiKey = addKeyInput.value.trim();
            const email = addEmailInput.value.trim();
            if (!apiKey) {
              ctx.toast('Informe a API Key', 'warning');
              return;
            }
            try {
              const res = await jsonFetch('/api/gateway/account/add', {
                method: 'POST',
                body: JSON.stringify({ modelName, apiKey, email }),
              });
              state.gw.data = res.snapshot || state.gw.data;
              addKeyInput.value = '';
              addEmailInput.value = '';
              ctx.toast('Chave adicionada com sucesso!', 'success');
              renderGateway();
            } catch (err) {
              ctx.toast('Falha ao adicionar: ' + err.message, 'error');
            }
          },
        });

        gwBody.append(
          el('div', { class: 'radar-chain radar-add-key-box' }, [
            el('h4', { class: 'radar-section-title', text: 'Adicionar nova chave / conta' }),
            el('div', { class: 'radar-add-key-grid' }, [
              el('div', {}, [el('label', { text: 'Modelo alvo' }), addModelSelect]),
              el('div', {}, [el('label', { text: 'API Key' }), addKeyInput]),
              el('div', {}, [el('label', { text: 'E-mail (opcional)' }), addEmailInput]),
            ]),
            el('div', { style: { 'margin-top': '8px' } }, [addBtn]),
          ]),
        );

        const excluded = (data.models || []).filter((m) => !state.gw.chain.includes(m.name));
        if (excluded.length) {
          gwBody.append(
            sectionTitle(
              'Fora da sequência',
              'estes modelos não entram como fallback; clique para incluir.',
            ),
          );
          gwBody.append(
            el(
              'div',
              { class: 'radar-excluded' },
              excluded.map((m) =>
                el('button', {
                  class: 'radar-chip radar-chip-add',
                  type: 'button',
                  title: 'incluir na cadeia',
                  text: '+ ' + m.name,
                  onclick: () => {
                    state.gw.chain = state.gw.chain.concat(m.name);
                    markDirty();
                    renderGateway();
                  },
                }),
              ),
            ),
          );
        }
      }

      function markDirty() {
        state.gw.dirty = true;
      }

      async function loadGateway() {
        state.gw.loading = true;
        state.gw.error = null;
        renderGateway();
        try {
          const data = await jsonFetch('/api/gateway');
          state.gw.data = data;
          state.gw.chain = (data.chain || []).slice();
          state.gw.ctx = (data.ctxTargets || []).slice();
          state.gw.dirty = Boolean(data.pending);
        } catch (err) {
          state.gw.error = err.message;
        } finally {
          state.gw.loading = false;
          renderGateway();
        }
      }

      async function saveChain() {
        if (state.gw.saving) return;
        if (!state.gw.data) {
          await loadGateway();
          if (!state.gw.data) return;
        }
        state.gw.saving = true;
        ctx.toast('Gravando ordem no config.yaml...', 'info');
        try {
          const res = await jsonFetch('/api/gateway/chain', {
            method: 'POST',
            body: JSON.stringify({ chain: state.gw.chain, ctxTargets: state.gw.ctx }),
          });
          state.gw.data = res.snapshot || state.gw.data;
          state.gw.chain = (res.chain || state.gw.chain).slice();
          state.gw.ctx = (res.ctxTargets || state.gw.ctx).slice();
          state.gw.dirty = false;
          ctx.toast(
            res.changed ? 'Cadeia gravada. Backup: ' + (res.backup || '—') : 'Nada mudou no arquivo.',
            'success',
          );
          await reloadGateway(true);
        } catch (err) {
          ctx.toast('Falha ao gravar: ' + err.message, 'error');
        } finally {
          state.gw.saving = false;
          renderGateway();
        }
      }

      async function reloadGateway(silent) {
        try {
          const res = await jsonFetch('/api/gateway/reload', { method: 'POST' });
          if (silent) ctx.toast(res.message || 'Gateway reiniciado.', 'success');
          return res;
        } catch (err) {
          const message = (err.payload && err.payload.message) || err.message;
          if (silent) ctx.toast(message, 'warning');
          return null;
        }
      }

      async function restartLiteLLM() {
        try {
          const res = await jsonFetch('/api/gateway/reload', { method: 'POST' });
          ctx.toast(res.message || 'LiteLLM reiniciado.', 'success');
          return res;
        } catch (err) {
          const message = (err.payload && err.payload.message) || err.message;
          ctx.toast('Falha ao reiniciar LiteLLM: ' + message, 'error');
          return null;
        }
      }

      /* ---------------------------------------------------------- rodapé */

      ctx.setFooter(
        el('div', { class: 'actions-row radar-footer' }, [
          el('button', {
            class: 'btn btn-primary',
            type: 'button',
            text: 'Executar Varredura',
            onclick: () => {
              state.tab = 'scan';
              syncTabs();
              scan();
            },
          }),
          el('button', {
            class: 'btn btn-secondary',
            type: 'button',
            text: 'Salvar ordem de fallback',
            onclick: () => {
              state.tab = 'gateway';
              syncTabs();
              if (!state.gw.data) loadGateway();
              saveChain();
            },
          }),
          el('button', {
            class: 'btn btn-ghost',
            type: 'button',
            text: 'Recarregar do gateway',
            onclick: () => loadGateway(),
          }),
          el('button', {
            class: 'btn btn-ghost',
            type: 'button',
            text: '🔄 Reiniciar LiteLLM',
            onclick: () => restartLiteLLM(),
          }),
        ]),
      );

      /* ------------------------------------------------------------ boot */

      syncTabs();
      renderScan();
      scan();
    },
  });
})(window);
