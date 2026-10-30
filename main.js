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
    maxTokens: {
      default: 100000,
      'groq-fast': 131072,
      'gemini-fallback': 1000000,
      'or-super-vl': 1000000,
      'or-flint': 100000,
      'or-lightning': 100000,
      'or-north': 100000,
      'cloudflare-last': 128000
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
  // Create a crisp 16x16 icon in memory so tray always renders even without icon.png
  const size = 16;
  const img = nativeImage.createEmpty();
  // We can use a clean SVG converted to data URL or a visible data URL PNG
  const iconDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAA9SURBVDhPY3gro/C/EgwM40pAnBoA2fB/4y34v+E2fCY3AGpAUqMDfS04eA2AKRpx6uInTxkG4pI4mU0UAD+OPl2P1yS9AAAAAElFTkSuQmCC';
  return nativeImage.createFromDataURL(iconDataUrl);
}

function createTray() {
  try {
    const iconPath = path.join(__dirname, 'icon.png');
    let icon;
    if (fs.existsSync(iconPath)) {
      icon = nativeImage.createFromPath(iconPath);
    } else {
      icon = createTrayIcon();
    }

    tray = new Tray(icon);
    tray.setToolTip('LiteLLM Cons (Clique para abrir)');
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
  const contextMenu = Menu.buildFromTemplate([
    { 
      label: 'LiteLLM Cons (Exibir/Ocultar)', 
      click: () => toggleMainWindow() 
    },
    { 
      label: 'Configurações (Max Tokens)', 
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
      width: 380,
      height: 520,
      show: true, // Show on launch so the user sees the floating panel right away!
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: false, // Keep in taskbar for easy access & visibility on Windows
      resizable: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });

    mainWindow.loadFile(path.join(__dirname, 'tray-panel.html'));

    // Position window in bottom right corner near tray on startup
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
    const windowWidth = 380;
    const windowHeight = 520;
    mainWindow.setPosition(screenWidth - windowWidth - 20, screenHeight - windowHeight - 20);

    // Prevent destruction on close
    mainWindow.on('close', (e) => {
      if (!app.isQuitting) {
        e.preventDefault();
        mainWindow.hide();
      }
    });

    mainWindow.on('blur', () => {
      if (mainWindow && mainWindow.isVisible() && (!settingsWindow || !settingsWindow.isVisible())) {
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
      const windowWidth = 380;
      const windowHeight = 520;
      let posX = x - windowWidth / 2;
      let posY = y - windowHeight - 10;
      if (posY < 0) posY = y + 30;
      mainWindow.setPosition(Math.round(posX), Math.round(posY));
    } else {
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
      const windowWidth = 380;
      const windowHeight = 520;
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
      height: 540,
      title: 'LiteLLM Cons - Configurações',
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });

    settingsWindow.loadFile(path.join(__dirname, 'settings.html'));

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

ipcMain.handle('save-config', (event, newCfg) => {
  appConfig = newCfg;
  saveConfig(appConfig);
  if (mainWindow) {
    mainWindow.webContents.send('config-updated', appConfig);
  }
  return true;
});

ipcMain.handle('fetch-usage', async () => {
  return new Promise((resolve) => {
    const host = appConfig.litellmHost || '192.168.1.130';
    const port = appConfig.litellmPort || 4000;
    
    const req = http.get({
      hostname: host,
      port: port,
      path: '/spend/logs',
      headers: { 'Authorization': 'Bearer 1234' },
      timeout: 5000
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const logs = JSON.parse(d);
          let today = new Date().toISOString().slice(0, 10);
          const counts = {};
          logs.forEach(l => {
            if (l.startTime && !l.startTime.startsWith(today)) return;
            const tokens = l.total_tokens || ((l.prompt_tokens || 0) + (l.completion_tokens || 0)) || 1;
            const group = l.model_group;
            const model = l.model || '';
            if (group) counts[group] = (counts[group] || 0) + tokens;
            if (model) {
              counts[model] = (counts[model] || 0) + tokens;
              const parts = model.split('/');
              const last = parts[parts.length - 1].split(':')[0];
              if (last) counts[last] = (counts[last] || 0) + tokens;
            }
          });
          resolve({ success: true, usage: counts });
        } catch (e) {
          resolve({ success: false, error: e.message, usage: {} });
        }
      });
    });
    req.on('error', err => resolve({ success: false, error: err.message, usage: {} }));
    req.on('timeout', () => { req.destroy(); resolve({ success: false, error: 'Timeout', usage: {} }); });
  });
});

app.on('window-all-closed', (e) => {
  e.preventDefault();
});
