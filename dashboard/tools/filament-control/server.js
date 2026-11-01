const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 3030;
const DATA_FILE = path.join(__dirname, 'data.json');

function loadData() {
    if (!fs.existsSync(DATA_FILE)) {
        const defaultData = {
            spools: [
                {
                    id: "1",
                    name: "PLA White Generic",
                    material: "PLA",
                    color: "#FFFFFF",
                    initialWeightGrams: 1000,
                    emptySpoolWeightGrams: 200,
                    currentWeightGrams: 1000,
                    densityGcm3: 1.24,
                    diameterMm: 1.75,
                    cost: 19.99,
                    notes: "Main prototype spool",
                    createdAt: new Date().toISOString()
                }
            ],
            activeSpoolId: "1",
            history: [],
            settings: {
                printerUrl: "http://192.168.1.101:85",
                lowFilamentThresholdGrams: 100
            }
        };
        fs.writeFileSync(DATA_FILE, JSON.stringify(defaultData, null, 2));
    }
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function saveData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function fetchPrinterStatus(printerUrl, callback) {
    const parsed = url.parse(`${printerUrl}/printer/objects/query?print_stats&virtual_sdcard&toolhead`);
    const req = http.get({
        hostname: parsed.hostname,
        port: parsed.port || 80,
        path: parsed.path,
        timeout: 3000
    }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
            try {
                const json = JSON.parse(body);
                callback(null, json.result.status);
            } catch (e) {
                callback(e);
            }
        });
    });
    req.on('error', err => callback(err));
    req.on('timeout', () => { req.destroy(); callback(new Error('Timeout connecting to printer')); });
}

const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    if (pathname === '/api/state' && req.method === 'GET') {
        const data = loadData();
        fetchPrinterStatus(data.settings.printerUrl, (err, printerStatus) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                ...data,
                printerConnected: !err,
                printerStatus: printerStatus || null,
                printerError: err ? err.message : null
            }));
        });
        return;
    }

    if (pathname === '/api/spools' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const newSpoolData = JSON.parse(body);
                const data = loadData();
                const newSpool = {
                    id: Date.now().toString(),
                    name: newSpoolData.name || 'New Spool',
                    material: newSpoolData.material || 'PLA',
                    color: newSpoolData.color || '#cccccc',
                    initialWeightGrams: parseFloat(newSpoolData.initialWeightGrams) || 1000,
                    emptySpoolWeightGrams: parseFloat(newSpoolData.emptySpoolWeightGrams) || 200,
                    currentWeightGrams: parseFloat(newSpoolData.currentWeightGrams) || 1000,
                    densityGcm3: parseFloat(newSpoolData.densityGcm3) || 1.24,
                    diameterMm: parseFloat(newSpoolData.diameterMm) || 1.75,
                    cost: parseFloat(newSpoolData.cost) || 0.0,
                    notes: newSpoolData.notes || '',
                    createdAt: new Date().toISOString()
                };
                data.spools.push(newSpool);
                saveData(data);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, spool: newSpool }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: e.message }));
            }
        });
        return;
    }

    if (pathname === '/api/active-spool' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { spoolId } = JSON.parse(body);
                const data = loadData();
                const spool = data.spools.find(s => s.id === spoolId);
                if (!spool) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: 'Spool not found' }));
                    return;
                }
                data.activeSpoolId = spoolId;
                saveData(data);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, activeSpoolId: spoolId }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: e.message }));
            }
        });
        return;
    }

    if (pathname === '/api/consume' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { grams, meters, printName } = JSON.parse(body);
                const data = loadData();
                const spool = data.spools.find(s => s.id === data.activeSpoolId);
                if (!spool) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: 'No active spool selected' }));
                    return;
                }

                const consumedGrams = parseFloat(grams) || 0;
                const consumedMeters = parseFloat(meters) || 0;
                spool.currentWeightGrams = Math.max(0, spool.currentWeightGrams - consumedGrams);

                const netWeight = spool.initialWeightGrams - spool.emptySpoolWeightGrams;
                const costPerGram = netWeight > 0 ? (spool.cost / netWeight) : 0;
                const cost = consumedGrams * costPerGram;

                const historyItem = {
                    id: Date.now().toString(),
                    spoolId: spool.id,
                    printName: printName || 'Manual Consumption / Print',
                    filamentUsedMeters: consumedMeters,
                    filamentUsedGrams: consumedGrams,
                    cost: parseFloat(cost.toFixed(2)),
                    timestamp: new Date().toISOString()
                };

                data.history.unshift(historyItem);
                saveData(data);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, spool, historyItem }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: e.message }));
            }
        });
        return;
    }

    if (pathname.startsWith('/api/spools/') && req.method === 'DELETE') {
        const spoolId = pathname.split('/')[3];
        const data = loadData();
        data.spools = data.spools.filter(s => s.id !== spoolId);
        if (data.activeSpoolId === spoolId) {
            data.activeSpoolId = data.spools.length > 0 ? data.spools[0].id : null;
        }
        saveData(data);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Filament Control running at http://localhost:${PORT}`);
});
