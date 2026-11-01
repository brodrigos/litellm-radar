(function (global) {
  'use strict';

  const B = global.Brodrigos;
  if (!B) return;

  function init(body, ctx) {
    body.innerHTML = `
      <div class="av1-container" style="padding: 24px; color: #f3f4f6; font-family: inherit;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
          <div>
            <h2 style="font-size: 24px; font-weight: bold; margin: 0;">Filament3D Control</h2>
            <p style="color: #9ca3af; font-size: 14px; margin: 4px 0 0 0;">Klipper / Moonraker Printer (192.168.1.101:85) — USD Currency</p>
          </div>
          <div style="display: flex; gap: 12px;">
            <button class="btn btn-secondary" onclick="window._filamentApp.refresh()">Refresh</button>
            <button class="btn btn-primary" onclick="window._filamentApp.openAddSpool()">+ New Spool</button>
          </div>
        </div>

        <!-- Printer Status & Live Stats -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-bottom: 24px;">
          <div style="background: #1f2937; border: 1px solid #374151; padding: 16px; border-radius: 12px;">
            <div style="font-size: 12px; color: #9ca3af; font-weight: bold; text-transform: uppercase;">Printer State</div>
            <div id="fc-printer-state" style="font-size: 18px; font-weight: bold; margin-top: 4px;">Connecting...</div>
          </div>
          <div style="background: #1f2937; border: 1px solid #374151; padding: 16px; border-radius: 12px;">
            <div style="font-size: 12px; color: #9ca3af; font-weight: bold; text-transform: uppercase;">Current File</div>
            <div id="fc-print-file" style="font-size: 14px; font-weight: bold; margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">-</div>
          </div>
          <div style="background: #1f2937; border: 1px solid #374151; padding: 16px; border-radius: 12px;">
            <div style="font-size: 12px; color: #9ca3af; font-weight: bold; text-transform: uppercase;">Filament Used (Job)</div>
            <div id="fc-filament-used" style="font-size: 18px; font-weight: bold; margin-top: 4px; color: #60a5fa;">0.00 m</div>
          </div>
          <div style="background: #1f2937; border: 1px solid #374151; padding: 16px; border-radius: 12px;">
            <div style="font-size: 12px; color: #9ca3af; font-weight: bold; text-transform: uppercase;">Progress</div>
            <div id="fc-print-progress" style="font-size: 18px; font-weight: bold; margin-top: 4px; color: #34d399;">0%</div>
          </div>
        </div>

        <!-- Active Spool & Financials -->
        <div style="display: grid; grid-template-columns: 1fr 2fr; gap: 24px; margin-bottom: 24px;">
          <div style="background: #1f2937; border: 1px solid #374151; padding: 20px; border-radius: 12px; display: flex; flex-direction: column; justify-content: space-between;">
            <div>
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                <h3 style="font-size: 16px; font-weight: bold; margin: 0;">Active Spool</h3>
                <span id="fc-active-material" style="background: #312e81; color: #c7d2fe; padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: bold;">PLA</span>
              </div>
              <div id="fc-active-name" style="font-size: 18px; font-weight: bold; margin-bottom: 12px;">Loading...</div>
              <div style="background: #374151; border-radius: 9999px; height: 12px; overflow: hidden; margin-bottom: 8px;">
                <div id="fc-active-bar" style="background: #6366f1; height: 100%; width: 0%; transition: width 0.3s;"></div>
              </div>
              <div style="display: flex; justify-content: font-size: 13px; color: #9ca3af; font-size: 13px;">
                <span>Remaining: <strong id="fc-active-weight" style="color: #fff;">0g</strong></span>
                <span>Total: <strong id="fc-active-total" style="color: #fff;">1000g</strong></span>
              </div>
            </div>
            <div style="margin-top: 16px; display: flex; gap: 8px;">
              <button class="btn btn-secondary" style="flex: 1;" onclick="window._filamentApp.openSimulate()">Simulate Use</button>
            </div>
          </div>

          <div style="background: #1f2937; border: 1px solid #374151; padding: 20px; border-radius: 12px; display: flex; flex-direction: column; justify-content: space-between;">
            <h3 style="font-size: 16px; font-weight: bold; margin: 0 0 16px 0;">Financial & Usage Summary (USD)</h3>
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 16px;">
              <div style="background: #111827; padding: 14px; border-radius: 8px; border: 1px solid #374151;">
                <div style="font-size: 11px; color: #9ca3af; text-transform: uppercase;">Total Spent</div>
                <div id="fc-stat-cost" style="font-size: 22px; font-weight: bold; color: #34d399; margin-top: 4px;">$0.00</div>
              </div>
              <div style="background: #111827; padding: 14px; border-radius: 8px; border: 1px solid #374151;">
                <div style="font-size: 11px; color: #9ca3af; text-transform: uppercase;">Filament Consumed</div>
                <div id="fc-stat-grams" style="font-size: 22px; font-weight: bold; color: #60a5fa; margin-top: 4px;">0 g</div>
              </div>
              <div style="background: #111827; padding: 14px; border-radius: 8px; border: 1px solid #374151;">
                <div style="font-size: 11px; color: #9ca3af; text-transform: uppercase;">Total Prints</div>
                <div id="fc-stat-prints" style="font-size: 22px; font-weight: bold; color: #c084fc; margin-top: 4px;">0</div>
              </div>
            </div>
            <div style="font-size: 12px; color: #9ca3af;">Proportional cost calculation based on spool net weight and purchase price in USD.</div>
          </div>
        </div>

        <!-- Spools Inventory -->
        <div style="margin-bottom: 32px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
            <h3 style="font-size: 18px; font-weight: bold; margin: 0;">Spools Inventory</h3>
          </div>
          <div id="fc-spools-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px;">
            <!-- Spool cards -->
          </div>
        </div>

        <!-- History Table -->
        <div>
          <h3 style="font-size: 18px; font-weight: bold; margin-bottom: 16px;">Consumption History</h3>
          <div style="background: #1f2937; border: 1px solid #374151; border-radius: 12px; overflow: hidden;">
            <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 14px;">
              <thead>
                <tr style="background: #374151; color: #d1d5db; font-size: 12px; text-transform: uppercase;">
                  <th style="padding: 12px 16px;">Timestamp</th>
                  <th style="padding: 12px 16px;">Print / File</th>
                  <th style="padding: 12px 16px;">Spool</th>
                  <th style="padding: 12px 16px;">Consumed</th>
                  <th style="padding: 12px 16px;">Length</th>
                  <th style="padding: 12px 16px;">Cost (USD)</th>
                </tr>
              </thead>
              <tbody id="fc-history-tbody">
                <tr><td colspan="6" style="padding: 24px; text-align: center; color: #9ca3af;">No consumption history yet.</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Add Spool Modal -->
      <dialog id="fc-modal-spool" style="background: #1f2937; color: #f3f4f6; border: 1px solid #374151; border-radius: 12px; padding: 24px; width: 100%; max-width: 480px;">
        <h3 style="margin-top: 0; font-size: 18px; font-weight: bold; margin-bottom: 16px;">Add New Spool</h3>
        <form id="fc-form-spool" onsubmit="window._filamentApp.submitSpool(event)" style="display: flex; flex-direction: column; gap: 12px;">
          <div>
            <label style="font-size: 12px; color: #9ca3af; text-transform: uppercase; display: block; margin-bottom: 4px;">Spool Name</label>
            <input type="text" id="fc-s-name" required class="field-input" style="width: 100%; padding: 8px 12px; background: #111827; border: 1px solid #374151; border-radius: 6px; color: #fff;" placeholder="Ex: eSUN PLA+ Blue">
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
            <div>
              <label style="font-size: 12px; color: #9ca3af; text-transform: uppercase; display: block; margin-bottom: 4px;">Material</label>
              <select id="fc-s-material" style="width: 100%; padding: 8px 12px; background: #111827; border: 1px solid #374151; border-radius: 6px; color: #fff;">
                <option value="PLA">PLA</option>
                <option value="PETG">PETG</option>
                <option value="ABS">ABS</option>
                <option value="TPU">TPU</option>
                <option value="ASA">ASA</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div>
              <label style="font-size: 12px; color: #9ca3af; text-transform: uppercase; display: block; margin-bottom: 4px;">Color</label>
              <input type="color" id="fc-s-color" value="#3b82f6" style="width: 100%; height: 38px; background: #111827; border: 1px solid #374151; border-radius: 6px; cursor: pointer;">
            </div>
          </div>
          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;">
            <div>
              <label style="font-size: 12px; color: #9ca3af; text-transform: uppercase; display: block; margin-bottom: 4px;">Gross Weight (g)</label>
              <input type="number" id="fc-s-initial" value="1000" required style="width: 100%; padding: 8px 12px; background: #111827; border: 1px solid #374151; border-radius: 6px; color: #fff;">
            </div>
            <div>
              <label style="font-size: 12px; color: #9ca3af; text-transform: uppercase; display: block; margin-bottom: 4px;">Empty Spool (g)</label>
              <input type="number" id="fc-s-empty" value="200" required style="width: 100%; padding: 8px 12px; background: #111827; border: 1px solid #374151; border-radius: 6px; color: #fff;">
            </div>
            <div>
              <label style="font-size: 12px; color: #9ca3af; text-transform: uppercase; display: block; margin-bottom: 4px;">Price ($ USD)</label>
              <input type="number" step="0.01" id="fc-s-cost" value="19.99" required style="width: 100%; padding: 8px 12px; background: #111827; border: 1px solid #374151; border-radius: 6px; color: #fff;">
            </div>
          </div>
          <div>
            <label style="font-size: 12px; color: #9ca3af; text-transform: uppercase; display: block; margin-bottom: 4px;">Notes</label>
            <input type="text" id="fc-s-notes" style="width: 100%; padding: 8px 12px; background: #111827; border: 1px solid #374151; border-radius: 6px; color: #fff;" placeholder="Ex: Amazon purchase">
          </div>
          <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px;">
            <button type="button" class="btn btn-secondary" onclick="document.getElementById('fc-modal-spool').close()">Cancel</button>
            <button type="submit" class="btn btn-primary">Save Spool</button>
          </div>
        </form>
      </dialog>

      <!-- Simulate Modal -->
      <dialog id="fc-modal-simulate" style="background: #1f2937; color: #f3f4f6; border: 1px solid #374151; border-radius: 12px; padding: 24px; width: 100%; max-width: 400px;">
        <h3 style="margin-top: 0; font-size: 18px; font-weight: bold; margin-bottom: 16px;">Simulate Consumption</h3>
        <form onsubmit="window._filamentApp.submitConsume(event)" style="display: flex; flex-direction: column; gap: 12px;">
          <div>
            <label style="font-size: 12px; color: #9ca3af; text-transform: uppercase; display: block; margin-bottom: 4px;">Print / Part Name</label>
            <input type="text" id="fc-sim-name" required style="width: 100%; padding: 8px 12px; background: #111827; border: 1px solid #374151; border-radius: 6px; color: #fff;" placeholder="Ex: Bracket.gcode">
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
            <div>
              <label style="font-size: 12px; color: #9ca3af; text-transform: uppercase; display: block; margin-bottom: 4px;">Grams Used (g)</label>
              <input type="number" step="0.1" id="fc-sim-grams" required style="width: 100%; padding: 8px 12px; background: #111827; border: 1px solid #374151; border-radius: 6px; color: #fff;" placeholder="45.2">
            </div>
            <div>
              <label style="font-size: 12px; color: #9ca3af; text-transform: uppercase; display: block; margin-bottom: 4px;">Length (m)</label>
              <input type="number" step="0.1" id="fc-sim-meters" style="width: 100%; padding: 8px 12px; background: #111827; border: 1px solid #374151; border-radius: 6px; color: #fff;" placeholder="15.0">
            </div>
          </div>
          <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px;">
            <button type="button" class="btn btn-secondary" onclick="document.getElementById('fc-modal-simulate').close()">Cancel</button>
            <button type="submit" class="btn btn-primary">Record</button>
          </div>
        </form>
      </dialog>
    `;

    let appData = null;
    const API_PORT = 3030;
    const apiBase = `http://localhost:${API_PORT}`;

    async function refresh() {
      try {
        const res = await fetch(`${apiBase}/api/state`, { cache: 'no-store' });
        appData = await res.json();
        render();
      } catch (err) {
        console.error('Failed to fetch filament state:', err);
        document.getElementById('fc-printer-state').innerText = 'Offline (Start API)';
      }
    }

    function render() {
      if (!appData) return;

      if (appData.printerConnected) {
        document.getElementById('fc-printer-state').innerText = appData.printerStatus?.print_stats?.state || 'Connected';
        const file = appData.printerStatus?.print_stats?.filename || 'No file active';
        document.getElementById('fc-print-file').innerText = file;
        document.getElementById('fc-print-file').title = file;
        const used = appData.printerStatus?.print_stats?.filament_used || 0;
        document.getElementById('fc-filament-used').innerText = (used / 1000).toFixed(2) + ' m';
        const prog = appData.printerStatus?.virtual_sdcard?.progress || 0;
        document.getElementById('fc-print-progress').innerText = (prog * 100).toFixed(1) + '%';
      } else {
        document.getElementById('fc-printer-state').innerText = 'Disconnected (192.168.1.101:85)';
        document.getElementById('fc-print-file').innerText = '-';
        document.getElementById('fc-filament-used').innerText = '0.00 m';
        document.getElementById('fc-print-progress').innerText = '0%';
      }

      const active = appData.spools.find(s => s.id === appData.activeSpoolId) || appData.spools[0];
      if (active) {
        document.getElementById('fc-active-name').innerText = active.name;
        document.getElementById('fc-active-material').innerText = active.material;
        const netInit = active.initialWeightGrams - active.emptySpoolWeightGrams;
        const netCurr = Math.max(0, active.currentWeightGrams - active.emptySpoolWeightGrams);
        const pct = netInit > 0 ? Math.min(100, Math.max(0, (netCurr / netInit) * 100)) : 0;
        document.getElementById('fc-active-bar').style.width = pct + '%';
        document.getElementById('fc-active-weight').innerText = netCurr.toFixed(0) + 'g';
        document.getElementById('fc-active-total').innerText = netInit.toFixed(0) + 'g';
      } else {
        document.getElementById('fc-active-name').innerText = 'No spool available';
      }

      let totalCost = 0;
      let totalGrams = 0;
      appData.history.forEach(h => {
        totalCost += h.cost || 0;
        totalGrams += h.filamentUsedGrams || 0;
      });
      document.getElementById('fc-stat-cost').innerText = '$ ' + totalCost.toFixed(2);
      document.getElementById('fc-stat-grams').innerText = totalGrams.toFixed(1) + ' g';
      document.getElementById('fc-stat-prints').innerText = appData.history.length;

      const grid = document.getElementById('fc-spools-grid');
      grid.innerHTML = '';
      appData.spools.forEach(spool => {
        const isActive = spool.id === appData.activeSpoolId;
        const netInit = spool.initialWeightGrams - spool.emptySpoolWeightGrams;
        const netCurr = Math.max(0, spool.currentWeightGrams - spool.emptySpoolWeightGrams);
        const pct = netInit > 0 ? Math.min(100, Math.max(0, (netCurr / netInit) * 100)) : 0;

        const card = document.createElement('div');
        card.style.cssText = `background: #1f2937; border: 1px solid ${isActive ? '#6366f1' : '#374151'}; padding: 16px; border-radius: 12px; display: flex; flex-direction: column; justify-content: space-between; gap: 12px;`;
        card.innerHTML = `
          <div>
            <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 8px;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="width: 14px; height: 14px; border-radius: 50%; background: ${spool.color || '#3b82f6'}; display: inline-block;"></span>
                <h4 style="margin: 0; font-size: 16px; font-weight: bold; color: #fff;">${spool.name}</h4>
              </div>
              <span style="background: #312e81; color: #c7d2fe; padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: bold;">${spool.material}</span>
            </div>
            <p style="font-size: 12px; color: #9ca3af; margin: 0 0 12px 0;">${spool.notes || 'No notes'}</p>
            <div style="margin-bottom: 8px;">
              <div style="display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 4px;">
                <span style="color: #9ca3af;">Remaining:</span>
                <strong style="color: #fff;">${netCurr.toFixed(0)}g / ${netInit.toFixed(0)}g</strong>
              </div>
              <div style="background: #374151; border-radius: 9999px; height: 8px; overflow: hidden;">
                <div style="background: #6366f1; height: 100%; width: ${pct}%;"></div>
              </div>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 12px; color: #9ca3af;">
              <span>Price: $${spool.cost.toFixed(2)}</span>
              <span>Diameter: ${spool.diameterMm}mm</span>
            </div>
          </div>
          <div style="display: flex; gap: 8px; border-top: 1px solid #374151; paddingTop: 12px;">
            ${!isActive ? `<button class="btn btn-primary btn-sm" style="flex: 1;" onclick="window._filamentApp.setActive('${spool.id}')">Activate</button>` : `<span style="flex: 1; text-align: center; font-size: 12px; font-weight: bold; color: #818cf8; background: #312e81; padding: 6px; border-radius: 6px;">Active Spool</span>`}
            <button class="btn btn-secondary btn-sm" onclick="window._filamentApp.deleteSpool('${spool.id}')">🗑</button>
          </div>
        `;
        grid.appendChild(card);
      });

      const tbody = document.getElementById('fc-history-tbody');
      tbody.innerHTML = '';
      if (appData.history.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="padding: 24px; text-align: center; color: #9ca3af;">No consumption history yet.</td></tr>`;
      } else {
        appData.history.forEach(h => {
          const spool = appData.spools.find(s => s.id === h.spoolId);
          const tr = document.createElement('tr');
          tr.style.borderBottom = '1px solid #374151';
          tr.innerHTML = `
            <td style="padding: 12px 16px; color: #d1d5db; font-size: 13px;">${new Date(h.timestamp).toLocaleString()}</td>
            <td style="padding: 12px 16px; font-weight: bold; color: #fff;">${h.printName}</td>
            <td style="padding: 12px 16px; color: #d1d5db;">${spool ? spool.name : 'Removed Spool'}</td>
            <td style="padding: 12px 16px; color: #60a5fa; font-weight: bold;">+${h.filamentUsedGrams} g</td>
            <td style="padding: 12px 16px; color: #d1d5db;">${h.filamentUsedMeters} m</td>
            <td style="padding: 12px 16px; color: #34d399; font-weight: bold;">$${(h.cost || 0).toFixed(2)}</td>
          `;
          tbody.appendChild(tr);
        });
      }
    }

    window._filamentApp = {
      refresh,
      openAddSpool: () => document.getElementById('fc-modal-spool').showModal(),
      openSimulate: () => document.getElementById('fc-modal-simulate').showModal(),
      setActive: async (id) => {
        await fetch(`${apiBase}/api/active-spool`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ spoolId: id }) });
        refresh();
      },
      deleteSpool: async (id) => {
        if (!confirm('Delete this spool?')) return;
        await fetch(`${apiBase}/api/spools/${id}`, { method: 'DELETE' });
        refresh();
      },
      submitSpool: async (e) => {
        e.preventDefault();
        const payload = {
          name: document.getElementById('fc-s-name').value,
          material: document.getElementById('fc-s-material').value,
          color: document.getElementById('fc-s-color').value,
          initialWeightGrams: parseFloat(document.getElementById('fc-s-initial').value),
          emptySpoolWeightGrams: parseFloat(document.getElementById('fc-s-empty').value),
          currentWeightGrams: parseFloat(document.getElementById('fc-s-initial').value),
          cost: parseFloat(document.getElementById('fc-s-cost').value),
          notes: document.getElementById('fc-s-notes').value
        };
        await fetch(`${apiBase}/api/spools`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        document.getElementById('fc-modal-spool').close();
        document.getElementById('fc-form-spool').reset();
        refresh();
      },
      submitConsume: async (e) => {
        e.preventDefault();
        const payload = {
          printName: document.getElementById('fc-sim-name').value,
          grams: parseFloat(document.getElementById('fc-sim-grams').value),
          meters: parseFloat(document.getElementById('fc-sim-meters').value) || 0
        };
        await fetch(`${apiBase}/api/consume`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        document.getElementById('fc-modal-simulate').close();
        refresh();
      }
    };

    setInterval(refresh, 5000);
    refresh();
  }

  B.register({
    id: 'filament-control',
    name: 'Filament3D',
    icon: '🧊',
    badge: '3D',
    description: 'Printer filament consumption tracker (Klipper / Moonraker 192.168.1.101:85) in USD.',
    tagline: 'spools · Klipper · USD',
    init,
  });
})(window);
