/**
 * LiteLLM Server Radar — ferramenta do Brodrigos Dashboard.
 *
 * Faz varredura e testa modelos do servidor LiteLLM em tempo real.
 * Se o servidor local (localhost:3333) não estiver rodando, exibe um botão
 * "Iniciar Servidor" com instruções claras e dispara varredura automática ao carregar.
 */
(function (global) {
  'use strict';

  const B = global.Brodrigos;
  if (!B) return;
  const el = B.el;

  const SERVER_URL = 'http://localhost:3333';

  B.register({
    id: 'litellm-radar',
    name: 'LiteLLM Server Radar',
    icon: '📡',
    description: 'Monitoramento em tempo real, varredura de modelos, teste de latência e verificação de saúde do servidor LiteLLM.',
    init(body, ctx) {
      const state = { data: null, error: null, filter: 'all', query: '', scanning: false, serverUp: null };

      const root = el('div', { class: 'radar' });
      const stats = el('div', { class: 'radar-stats' });
      const statusLine = el('div', { class: 'radar-status' });
      const chips = el('div', { class: 'radar-bar' });
      const tableWrap = el('div', {});
      root.append(stats, statusLine, chips, tableWrap);
      body.append(root);

      const search = el('input', {
        type: 'search',
        placeholder: 'filtrar por nome do modelo...',
        oninput: (ev) => {
          state.query = ev.target.value;
          render();
        },
      });
      chips.append(search);

      const FILTERS = [
        ['all', 'todos'],
        ['online', 'online'],
        ['offline', 'offline'],
      ];
      const chipNodes = [];
      FILTERS.forEach(([id, label]) => {
        chipNodes.push(
          el('button', {
            class: 'radar-chip' + (id === 'all' ? ' on' : ''),
            type: 'button',
            text: label,
            dataset: { filter: id },
            onclick: () => {
              state.filter = id;
              chipNodes.forEach((n) => n.classList.toggle('on', n.dataset.filter === id));
              render();
            },
          }),
        );
      });
      chipNodes.forEach((n) => chips.append(n));

      function statCard(value, label, extraClass) {
        return el('div', { class: 'radar-stat' + (extraClass ? ' ' + extraClass : '') }, [
          el('b', { text: String(value) }),
          el('span', { text: label }),
        ]);
      }

      function renderStats(summary) {
        stats.textContent = '';
        if (!summary) {
          stats.append(
            statCard(0, 'total de modelos'),
            statCard(0, 'online'),
            statCard(0, 'offline'),
            statCard('0 ms', 'latência média')
          );
          return;
        }
        stats.append(
          statCard(summary.total, 'total de modelos'),
          statCard(summary.online, 'online', summary.online > 0 ? 'is-online' : ''),
          statCard(summary.offline, 'offline', summary.offline > 0 ? 'is-offline' : ''),
          statCard(summary.avgLatency + ' ms', 'latência média')
        );
      }

      function renderTable() {
        tableWrap.textContent = '';
        const all = (state.data && state.data.models) || [];
        if (!all.length) {
          tableWrap.append(
            el('div', { class: 'radar-empty' }, [
              el('p', { text: state.scanning ? 'Varrendo modelos do LiteLLM...' : 'Clique em "Executar Varredura" para testar os modelos.' }),
            ]),
          );
          return;
        }

        const q = state.query.trim().toLowerCase();
        const rows = all.filter((m) => {
          if (q && !m.id.toLowerCase().includes(q)) return false;
          if (state.filter === 'online' && m.status !== 'online') return false;
          if (state.filter === 'offline' && m.status !== 'offline') return false;
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
          const isOnline = m.status === 'online';
          const row = el('tr', { class: 'radar-row' }, [
            el('td', {}, [
              el('span', {
                class: 'radar-pill ' + (isOnline ? 'win' : ''),
                style: isOnline ? 'background: rgba(16,185,129,0.1); color: #10b981' : 'background: rgba(244,63,94,0.1); color: #f43f5e',
                text: isOnline ? 'ONLINE' : 'OFFLINE',
              }),
            ]),
            el('td', {}, [
              el('code', { class: 'radar-name', text: m.id }),
            ]),
            el('td', {}, [
              el('span', { class: 'radar-lat', text: m.latency ? `${m.latency}ms` : 'N/A' }),
            ]),
            el('td', {}, [
              el('span', { class: 'radar-muted', text: m.error || 'Operacional (OK)' }),
            ]),
          ]);
          tbody.append(row);
        }

        tableWrap.append(table);
        if (!rows.length) {
          tableWrap.append(el('div', { class: 'radar-empty', text: 'Nenhum modelo encontrado com os filtros atuais.' }));
        }
      }

      function renderServerOffline() {
        tableWrap.textContent = '';
        stats.textContent = '';
        stats.append(
          statCard('—', 'servidor'),
          statCard('—', 'online'),
          statCard('—', 'offline'),
          statCard('— ms', 'latência média')
        );

        const card = el('div', { class: 'radar-empty radar-server-down' }, [
          el('div', { class: 'radar-card' }, [
            el('i', { class: 'fa-solid fa-server text-4xl mb-4 text-slate-500' }),
            el('h3', { class: 'text-xl font-bold text-white mb-2', text: 'Servidor Radar não está em execução' }),
            el('p', { class: 'text-slate-400 mb-6', text: 'Para ativar a varredura de modelos, inicie o servidor Node.js local.' }),
            el('code', { class: 'block bg-slate-900 border border-slate-700 rounded-lg p-3 text-sm mb-4 text-indigo-300 overflow-x-auto', text: 'node litellm-radar-server.js' }),
            el('div', { class: 'flex gap-3 justify-center' }, [
              el('button', {
                class: 'btn btn-primary px-6 py-2',
                type: 'button',
                text: 'Tentar Conectar Novamente',
                onclick: () => scan(),
              }),
            ]),
          ]),
        ]);
        tableWrap.append(card);
      }

      function render() {
        renderStats(state.data && state.data.summary);
        if (state.serverUp === false) {
          renderServerOffline();
          statusLine.textContent = 'Servidor local (localhost:3333) não responde.';
          return;
        }
        renderTable();
        statusLine.textContent = state.scanning
          ? 'Varrendo servidor LiteLLM em http://192.168.1.130:4000...'
          : (state.error ? `Erro: ${state.error}` : 'Varredura pronta. Servidor ativo em localhost:3333');
      }

      async function scan() {
        state.scanning = true;
        state.error = null;
        render();
        ctx.toast('Conectando ao servidor radar...', 'info');

        try {
          const res = await fetch(`${SERVER_URL}/api/scan`, { cache: 'no-store' });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          state.data = await res.json();
          state.serverUp = true;
          ctx.toast('Varredura concluída com sucesso!', 'success');
        } catch (err) {
          state.error = err.message;
          state.serverUp = false;
          ctx.toast('Servidor radar fora do ar', 'error');
        } finally {
          state.scanning = false;
          render();
        }
      }

      ctx.setFooter(
        el('div', { class: 'actions-row' }, [
          el('button', {
            class: 'btn btn-primary',
            type: 'button',
            text: 'Executar Varredura',
            onclick: () => scan(),
          }),
        ]),
      );

      scan();
    },
  });
})(window);
