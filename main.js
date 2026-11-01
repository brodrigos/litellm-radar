const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');

let logFile = path.join(app.getPath('userData'), 'litellm-cons-error.log');

function log(msg) {
  try {
    fs.appendFileSync(logFile, new Date().toISOString() + ' - ' + msg + '\n');
  } catch(e) {}
}

process.on('uncaughtException', (err) => {
  log('Uncaught Exception: ' + (err.stack || err.message));
});

let mainWindow = null;
let settingsWindow = null;

const defaultConfig = {
  maxRequestsByGroup: {
    default: 1500,
    'gemini-3.5-flash-lite': 1500,
    'groq-fast': 14400,
    'or-super-vl': 200,
    'or-flint': 200
  },
  litellmHost: '192.168.1.130',
  litellmPort: 4000,
  litellmApiKey: '1234'
};

function loadConfig() {
  const cfgPath = path.join(app.getPath('userData'), 'litellm-cons-config.json');
  try {
    if (fs.existsSync(cfgPath)) {
      return { ...defaultConfig, ...JSON.parse(fs.readFileSync(cfgPath, 'utf8')) };
    }
  } catch (e) { log('loadConfig error: ' + e.message); }
  return defaultConfig;
}

function saveConfig(cfg) {
  const cfgPath = path.join(app.getPath('userData'), 'litellm-cons-config.json');
  try {
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8');
  } catch (e) { log('saveConfig error: ' + e.message); }
}

let appConfig = loadConfig();

app.whenReady().then(() => {
  log('App ready');

  // Criar menu do app
  const template = [
    {
      label: 'Arquivo',
      submenu: [
        {
          label: 'Configurações',
          accelerator: 'CmdOrCtrl+,',
          click: () => openSettingsWindow()
        },
        { type: 'separator' },
        {
          label: 'Sair',
          role: 'quit'
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  createMainWindow();
}).catch(err => {
  log('App whenReady error: ' + err.message);
});

function createMainWindow() {
  try {
    mainWindow = new BrowserWindow({
      width: 500,
      height: 680,
      show: true,
      title: 'LiteLLM Cons - Monitor de Quota RPD',
      icon: path.join(__dirname, 'icon.png'),
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });

    let htmlPath = path.join(__dirname, 'tray-panel.html');
    if (!fs.existsSync(htmlPath) && process.resourcesPath) {
      htmlPath = path.join(process.resourcesPath, 'app', 'tray-panel.html');
    }

    mainWindow.loadFile(htmlPath);

    mainWindow.on('closed', () => {
      mainWindow = null;
      app.quit();
    });

    log('Main window created');
  } catch (e) {
    log('createMainWindow error: ' + e.message);
  }
}

function openSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  try {
    settingsWindow = new BrowserWindow({
      width: 520,
      height: 650,
      title: 'LiteLLM Cons - Configurações de Limites RPD',
      icon: path.join(__dirname, 'icon.png'),
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });

    let settingsHtml = path.join(__dirname, 'settings.html');
    if (!fs.existsSync(settingsHtml) && process.resourcesPath) {
      settingsHtml = path.join(process.resourcesPath, 'app', 'settings.html');
    }

    settingsWindow.loadFile(settingsHtml);

    settingsWindow.on('closed', () => {
      settingsWindow = null;
    });

    log('Settings window created');
  } catch (e) {
    log('openSettingsWindow error: ' + e.message);
  }
}

ipcMain.handle('get-config', () => {
  return appConfig;
});

ipcMain.handle('open-settings-window', () => {
  openSettingsWindow();
});

ipcMain.handle('save-config', (event, newCfg) => {
  appConfig = newCfg;
  saveConfig(appConfig);
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('config-updated', appConfig);
  }
  return true;
});

let cachedRequests = {};

ipcMain.handle('fetch-models', async () => {
  return new Promise((resolve) => {
    const host = appConfig.litellmHost || '192.168.1.130';
    const port = appConfig.litellmPort || 4000;
    const apiKey = appConfig.litellmApiKey || '1234';

    const req = http.get({
      hostname: host,
      port: port,
      path: '/models',
      headers: { 'Authorization': 'Bearer ' + apiKey },
      timeout: 10000
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const result = JSON.parse(d);
          let models = [];
          if (Array.isArray(result)) {
            models = result;
          } else if (result && Array.isArray(result.data)) {
            models = result.data;
          } else if (result && typeof result === 'object') {
            models = Object.keys(result);
          }
          const modelIds = models.map(m => (typeof m === 'string' ? m : (m.id || m.model_name || m.model))).filter(Boolean);
          resolve({ success: true, models: modelIds });
        } catch (e) {
          log('fetch-models error: ' + e.message);
          resolve({ success: false, error: e.message, models: [] });
        }
      });
    });
    req.on('error', err => {
      log('fetch-models network error: ' + err.message);
      resolve({ success: false, error: err.message, models: [] });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ success: false, error: 'Timeout de conexão (10s)', models: [] });
    });
  });
});

ipcMain.handle('fetch-usage', async () => {
  return new Promise((resolve) => {
    const host = appConfig.litellmHost || '192.168.1.130';
    const port = appConfig.litellmPort || 4000;
    const apiKey = appConfig.litellmApiKey || '1234';

    const req = http.get({
      hostname: host,
      port: port,
      path: '/spend/logs',
      headers: { 'Authorization': 'Bearer ' + apiKey },
      timeout: 60000
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const logs = JSON.parse(d);
          const now = new Date();
          
          // Janela do dia local (00:00:00 até 23:59:59 em horário local)
          const startOfLocalDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
          const endOfLocalDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);

          const reqCounts = {};
          let countToday = 0;

          if (Array.isArray(logs)) {
            logs.forEach(l => {
              if (!l.startTime) return;

              // Normaliza a string de data removendo microssegundos se houver (ex: .338000Z -> .338Z ou Z)
              let timeStr = l.startTime;
              if (timeStr.includes('.')) {
                timeStr = timeStr.replace(/\\.\\d+Z$/, 'Z');
              }

              const logTime = new Date(timeStr);
              if (isNaN(logTime.getTime())) return;

              // Verifica se a requisição ocorreu hoje no horário local
              if (logTime >= startOfLocalDay && logTime < endOfLocalDay) {
                const group = l.model_group || l.model;
                if (group) {
                  reqCounts[group] = (reqCounts[group] || 0) + 1;
                  countToday++;
                }
              }
            });
          }
          cachedRequests = reqCounts;
          log('Fetched usage: success. ' + countToday + ' requests today across ' + Object.keys(reqCounts).length + ' active groups.');
          resolve({ success: true, usage: reqCounts, totalLogsToday: countToday });
        } catch (e) {
          log('fetch-usage parse error: ' + e.message);
          resolve({ success: false, error: 'Erro ao analisar resposta do LiteLLM', usage: cachedRequests });
        }
      });
    });

    req.on('error', err => {
      log('fetch-usage network error: ' + err.message);
      resolve({ success: false, error: err.message, usage: cachedRequests });
    });

    req.on('timeout', () => {
      req.destroy();
      log('fetch-usage timeout (60s)');
      resolve({ success: false, error: 'Timeout de conexão (60s)', usage: cachedRequests });
    });
  });
});

app.on('window-all-closed', () => {
  app.quit();
});