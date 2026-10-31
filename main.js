const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');

let logFile = 'litellm-cons-error.log';
try {
  if (app && typeof app.getPath === 'function') {
    logFile = path.join(app.getPath('userData'), 'litellm-cons-error.log');
  }
} catch(e) {}

function log(msg) {
  try {
    fs.appendFileSync(logFile, new Date().toISOString() + ' - ' + msg + '\n');
  } catch(e) {}
}

process.on('uncaughtException', (err) => {
  log('Uncaught Exception: ' + (err.stack || err.message));
});

let tray = null;
let mainWindow = null;
let settingsWindow = null;

function getConfigPath() {
  try {
    if (app && typeof app.getPath === 'function') {
      return path.join(app.getPath('userData'), 'litellm-cons-config.json');
    }
  } catch(e) {}
  return path.join(process.cwd(), 'litellm-cons-config.json');
}

function loadConfig() {
  const cfgPath = getConfigPath();
  try {
    if (fs.existsSync(cfgPath)) {
      return JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    }
  } catch (e) { log('loadConfig error: ' + e.message); }
  return {
    maxRequests: {
      default: 1500, // Default Free Tier RPD (Requests Per Day) limit (e.g. Google Gemini 1500 RPD)
      'groq-fast': 14400,
      'gemini-fallback': 1500,
      'gemini-3.5-flash': 1500,
      'gemini-3.6-flash': 1500,
      'gemini-3.5-flash-lite': 1500,
      'or-super-vl': 200,
      'or-flint': 200,
      'or-lightning': 200,
      'or-north': 200,
      'cloudflare-last': 1000
    },
    litellmHost: '192.168.1.130',
    litellmPort: 4000
  };
}

function saveConfig(cfg) {
  const cfgPath = getConfigPath();
  try {
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8');
  } catch (e) { log('saveConfig error: ' + e.message); }
}

let appConfig = loadConfig();

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

app.whenReady().then(() => {
  log('App ready');
  if (app.dock) app.dock.hide();

  createTray();
  createMainWindow();
}).catch(err => {
  log('App whenReady error: ' + err.message);
});

function createTrayIcon() {
  const iconDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAA9SURBVDhPY3gro/C/EgwM40pAnBoA2fB/4y34v+E2fCY3AGpAUqMDfS04eA2AKRpx6uInTxkG4pI4mU0UAD+OPl2P1yS9AAAAAElFTkSuQmCC';
  return nativeImage.createFromDataURL(iconDataUrl);
}

function createTray() {
  try {
    let iconPath = path.join(__dirname, 'icon.png');
    if (!fs.existsSync(iconPath) && process.resourcesPath) {
      iconPath = path.join(process.resourcesPath, 'app', 'icon.png');
    }

    let icon;
    if (fs.existsSync(iconPath)) {
      icon = nativeImage.createFromPath(iconPath);
    } else {
      icon = createTrayIcon();
    }

    tray = new Tray(icon);
    tray.setToolTip('LiteLLM Cons');
    updateTrayContextMenu();

    tray.on('click', (event, bounds) => {
      toggleMainWindow(bounds);
    });
    
    tray.on('double-click', (event, bounds) => {
      toggleMainWindow(bounds);
    });

    tray.on('right-click', () => {
      tray.popUpContextMenu();
    });
    log('Tray created successfully');
  } catch (e) {
    log('createTray error: ' + e.message);
  }
}

function updateTrayContextMenu() {
  if (!tray) return;
  const contextMenu = Menu.buildFromTemplate([
    { 
      label: 'LiteLLM Cons (Exibir/Ocultar)', 
      click: () => toggleMainWindow() 
    },
    { 
      label: 'Configurações (Limites RPD)', 
      click: () => openSettingsWindow() 
    },
    { type: 'separator' },
    { 
      label: 'Sair', 
      click: () => { 
        app.isQuitting = true; 
        app.quit(); 
      } 
    }
  ]);
  tray.setContextMenu(contextMenu);
}

function createMainWindow() {
  try {
    mainWindow = new BrowserWindow({
      width: 390,
      height: 560,
      show: true,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: false,
      resizable: false,
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

    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
    const windowWidth = 390;
    const windowHeight = 560;
    mainWindow.setPosition(screenWidth - windowWidth - 20, screenHeight - windowHeight - 20);

    mainWindow.on('close', (e) => {
      if (!app.isQuitting) {
        e.preventDefault();
        mainWindow.hide();
      }
    });

    log('Main window created');
  } catch (e) {
    log('createMainWindow error: ' + e.message);
  }
}

function toggleMainWindow(bounds) {
  if (!mainWindow) return;

  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    if (bounds && bounds.x && bounds.y) {
      const { x, y } = bounds;
      const windowWidth = 390;
      const windowHeight = 560;
      let posX = x - windowWidth / 2;
      let posY = y - windowHeight - 10;
      if (posY < 0) posY = y + 30;
      mainWindow.setPosition(Math.round(posX), Math.round(posY));
    } else {
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
      const windowWidth = 390;
      const windowHeight = 560;
      mainWindow.setPosition(screenWidth - windowWidth - 20, screenHeight - windowHeight - 20);
    }
    mainWindow.show();
    mainWindow.focus();
  }
}

function openSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  try {
    settingsWindow = new BrowserWindow({
      width: 480,
      height: 580,
      title: 'LiteLLM Cons - Configurações de Limites RPD',
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
  if (mainWindow) {
    mainWindow.webContents.send('config-updated', appConfig);
  }
  return true;
});

// Cache request counts per model today
let cachedRequests = {};

ipcMain.handle('fetch-usage', async () => {
  return new Promise((resolve) => {
    const host = appConfig.litellmHost || '192.168.1.130';
    const port = appConfig.litellmPort || 4000;
    
    const req = http.get({
      hostname: host,
      port: port,
      path: '/spend/logs',
      headers: { 'Authorization': 'Bearer 1234' },
      timeout: 15000
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const logs = JSON.parse(d);
          let today = new Date().toISOString().slice(0, 10);
          const reqCounts = {};
          if (Array.isArray(logs)) {
            logs.forEach(l => {
              if (l.startTime && !l.startTime.startsWith(today)) return;
              const group = l.model_group;
              const model = l.model || '';
              if (group) {
                reqCounts[group] = (reqCounts[group] || 0) + 1;
              }
              if (model) {
                reqCounts[model] = (reqCounts[model] || 0) + 1;
                const parts = model.split('/');
                const last = parts[parts.length - 1].split(':')[0];
                if (last) {
                  reqCounts[last] = (reqCounts[last] || 0) + 1;
                }
              }
            });
          }
          cachedRequests = reqCounts;
          resolve({ success: true, usage: reqCounts });
        } catch (e) {
          resolve({ success: true, usage: cachedRequests });
        }
      });
    });
    req.on('error', err => {
      log('fetch-usage error: ' + err.message);
      resolve({ success: true, usage: cachedRequests });
    });
    req.on('timeout', () => { 
      req.destroy(); 
      resolve({ success: true, usage: cachedRequests }); 
    });
  });
});

app.on('window-all-closed', (e) => {
  e.preventDefault();
});
