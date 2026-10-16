'use strict';
const path = require('node:path'), fs = require('node:fs');
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const { createListenerServer } = require('./listener-server');
const { miniWindowOptions, lockMiniWindow } = require('./mini-window');
const testMode = process.env.LOCALSOUND_DESKTOP_TEST === '1';
app.setName('LocalSound Auditeur');
app.setPath('userData', path.join(app.getPath('appData'), 'LocalSound Auditeur'));
if (process.env.LOCALSOUND_DESKTOP_PROFILE) app.setPath('userData', path.resolve(process.env.LOCALSOUND_DESKTOP_PROFILE));
let mainWindow, miniWindow, bridge, origin, quitting = false;
const prefsFile = path.join(app.getPath('userData'), 'listener.json');
const icon = path.join(__dirname, '..', 'public/branding/icon-256.png');
const webPreferences = { contextIsolation:true, sandbox:true, nodeIntegration:false, backgroundThrottling:false, preload:path.join(__dirname, 'listener-preload.js') };
function sender(event) { return mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents && event.senderFrame === mainWindow.webContents.mainFrame && new URL(event.senderFrame.url).origin === origin; }
function showMain() { if (mainWindow && !mainWindow.isDestroyed() && !quitting && !testMode) { mainWindow.show(); mainWindow.focus(); } }
async function start() {
  bridge = createListenerServer();
  const listen = port => new Promise((resolve, reject) => { bridge.server.once('error', reject); bridge.server.listen(port, '127.0.0.1', () => { bridge.server.off('error', reject); resolve(); }); });
  try { await listen(Number(process.env.LOCALSOUND_LISTENER_PORT || 3011)); }
  catch (err) { if (err.code !== 'EADDRINUSE') throw err; await listen(0); }
  origin = 'http://127.0.0.1:' + bridge.server.address().port;
  mainWindow = new BrowserWindow({ title:'LocalSound — Auditeur', icon, width:1120, height:820, minWidth:740, minHeight:560, show:!testMode, backgroundColor:'#f4f0e7', webPreferences });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  mainWindow.webContents.session.setPermissionCheckHandler(() => false);
  mainWindow.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== origin) event.preventDefault(); });
  mainWindow.webContents.setWindowOpenHandler(({ url, frameName }) => {
    if (url === 'about:blank' && frameName === 'localsound-mini-listener') return { action:'allow', overrideBrowserWindowOptions:{ ...miniWindowOptions(false), icon, webPreferences } };
    if (['mailto:ranjalahy.narindraa@gmail.com', 'tel:0328814081', 'https://narindraportfolio.netlify.app/', 'https://www.youtube.com/static?template=terms', 'https://policies.google.com/privacy?hl=fr', 'https://digital.gov.mg/2022/07/05/loi-n-2014-038-sur-la-protection-des-donnees-a-caractere-personnel/'].includes(url)) shell.openExternal(url).catch(() => {});
    return { action:'deny' };
  });
  mainWindow.webContents.on('did-create-window', (child, details) => {
    if (details.frameName !== 'localsound-mini-listener') return;
    miniWindow = child; lockMiniWindow(child);
    child.on('closed', () => { if (miniWindow === child) miniWindow = null; showMain(); });
  });
  mainWindow.on('closed', () => { miniWindow?.close(); mainWindow = null; app.quit(); });
  ipcMain.handle('listener:last-address', event => {
    if (!sender(event)) throw new Error('Fenêtre auditeur requise.');
    try { return JSON.parse(fs.readFileSync(prefsFile, 'utf8')).address || ''; } catch (_) { return ''; }
  });
  ipcMain.handle('listener:connect', async (event, value) => {
    if (!sender(event)) throw new Error('Fenêtre auditeur requise.');
    const address = await bridge.connect(value);
    fs.mkdirSync(path.dirname(prefsFile), { recursive:true }); fs.writeFileSync(prefsFile, JSON.stringify({ address }));
    setImmediate(() => mainWindow?.loadURL(origin + '/listen').catch(() => {})); return true;
  });
  ipcMain.handle('listener:change-room', event => {
    if (!sender(event)) throw new Error('Fenêtre auditeur requise.');
    miniWindow?.close(); bridge.disconnect();
    setImmediate(() => mainWindow?.loadURL(origin + '/connect').catch(() => {})); return true;
  });
  ipcMain.handle('listener:mini-ready', event => {
    if (!sender(event) || !miniWindow || miniWindow.isDestroyed()) throw new Error('Mini-lecteur indisponible.');
    lockMiniWindow(miniWindow); if (!testMode) miniWindow.show(); mainWindow.hide(); return true;
  });
  await mainWindow.loadURL(origin + '/connect');
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { const win = miniWindow || mainWindow; if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
  app.whenReady().then(start).catch(err => { console.error('[auditeur]', err.message); if (!testMode) dialog.showErrorBox('LocalSound Auditeur', err.message); app.exit(1); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', event => { if (!quitting && bridge) { event.preventDefault(); quitting = true; const timeout = setTimeout(() => app.exit(0), 3000); bridge.close().finally(() => { clearTimeout(timeout); bridge = null; app.quit(); }); } });
}
