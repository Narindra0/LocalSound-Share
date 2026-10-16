'use strict';
const path = require('node:path');
const { app, BrowserWindow, WebContentsView, ipcMain, session, dialog, shell } = require('electron');
const { allowedPage, navigationTarget, videoUrl } = require('./navigation');
const { panelBounds } = require('./panel-layout');
const { miniWindowOptions, lockMiniWindow } = require('./mini-window');
const { createApp } = require('../server');
const { createWindowsMediaInfo } = require('../media-info');
const { createAppearanceStore } = require('../appearance-config');
const testMode = process.env.LOCALSOUND_DESKTOP_TEST === '1';
app.setName('LocalSound Share');
app.setPath('userData', path.join(app.getPath('appData'), 'LocalSound Share'));
if (process.env.LOCALSOUND_DESKTOP_PROFILE) app.setPath('userData', path.resolve(process.env.LOCALSOUND_DESKTOP_PROFILE));
if (testMode) app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
let hostWindow, toolbarView, youtubeView, instance, base, capturePendingUntil = 0, captured = false, quitting = false, browserError = '';
let panelExpanded = false, panelVisible = false, panelObscured = false, releaseYoutubeSession;
let miniWindow;
let youtubeTarget = '';
const toolbarHeight = 108;
const browserFile = path.join(__dirname, 'browser.html');
const appIcon = path.join(__dirname, '..', 'public', 'branding', 'icon-256.png');
const externalLinks = new Set(['mailto:ranjalahy.narindraa@gmail.com', 'tel:0328814081', 'https://narindraportfolio.netlify.app/', 'https://www.youtube.com/static?template=terms', 'https://policies.google.com/privacy?hl=fr', 'https://digital.gov.mg/2022/07/05/loi-n-2014-038-sur-la-protection-des-donnees-a-caractere-personnel/']);
const preferences = { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false };
function hostSender(event) { return hostWindow && event.sender === hostWindow.webContents && event.senderFrame === hostWindow.webContents.mainFrame && new URL(event.senderFrame.url).origin === base; }
function toolbarSender(event) { return toolbarView && event.sender === toolbarView.webContents && event.senderFrame === toolbarView.webContents.mainFrame; }
function sourceReady() {
  if (!youtubeView || youtubeView.webContents.isDestroyed()) return false;
  const url = youtubeView.webContents.getURL();
  return allowedPage(url) || ((!url || url === 'about:blank') && allowedPage(youtubeTarget));
}
function panelState() { return { open: Boolean(youtubeView), visible: Boolean(youtubeView && panelVisible && !panelObscured), expanded: panelExpanded, captured }; }
function layoutYoutube() {
  if (!hostWindow || hostWindow.isDestroyed() || !youtubeView || !toolbarView) return;
  const [width, height] = hostWindow.getContentSize(), rect = panelBounds(width, height, panelExpanded);
  const top = Math.min(toolbarHeight, rect.height);
  toolbarView.setBounds({ x: rect.x, y: rect.y, width: rect.width, height: top });
  youtubeView.setBounds({ x: rect.x, y: rect.y + top, width: rect.width, height: Math.max(1, rect.height - top) });
  const visible = panelVisible && !panelObscured;
  toolbarView.setVisible(visible); youtubeView.setVisible(visible);
}
function closeYoutube(notify = true) {
  const views = [toolbarView, youtubeView]; toolbarView = null; youtubeView = null;
  releaseYoutubeSession?.(); releaseYoutubeSession = null;
  capturePendingUntil = 0; captured = false; panelVisible = false; panelExpanded = false;
  youtubeTarget = '';
  for (const view of views) {
    if (!view) continue;
    if (hostWindow && !hostWindow.isDestroyed()) hostWindow.contentView.removeChildView(view);
    if (!view.webContents.isDestroyed()) view.webContents.close();
  }
  if (notify && hostWindow && !hostWindow.isDestroyed()) { hostWindow.webContents.send('desktop:youtube-closed'); hostWindow.webContents.send('desktop:youtube-panel', panelState()); }
}
function browserState() {
  const wc = youtubeView?.webContents;
  return wc && !wc.isDestroyed() ? { ...panelState(), url: wc.getURL(), title: wc.getTitle(), canGoBack: wc.navigationHistory.canGoBack(), canGoForward: wc.navigationHistory.canGoForward(), loading: wc.isLoading(), error: browserError } : panelState();
}
function sendBrowserState() {
  if (toolbarView && !toolbarView.webContents.isDestroyed()) toolbarView.webContents.send('browser:state', browserState());
  if (hostWindow && !hostWindow.isDestroyed()) hostWindow.webContents.send('desktop:youtube-panel', panelState());
  const url = sourceReady() && videoUrl(youtubeView.webContents.getURL());
  if (url && hostWindow && !hostWindow.isDestroyed()) hostWindow.webContents.send('desktop:youtube-video', { url });
}
function navigate(value) {
  const target = navigationTarget(value); browserError = '';
  youtubeTarget = target;
  youtubeView.webContents.loadURL(target).catch(err => { if (err.code !== 'ERR_ABORTED') { browserError = 'Page indisponible. Vérifiez la connexion puis actualisez.'; sendBrowserState(); } });
  return target;
}
function openYoutube(value) {
  const target = navigationTarget(value);
  if (youtubeView && !youtubeView.webContents.isDestroyed()) { panelVisible = true; layoutYoutube(); if (value) navigate(value); sendBrowserState(); return; }
  panelVisible = true; panelExpanded = false; browserError = '';
  toolbarView = new WebContentsView({ webPreferences: { ...preferences, preload: path.join(__dirname, 'browser-preload.js') } });
  youtubeView = new WebContentsView({ webPreferences: { ...preferences, partition: 'persist:localsound-youtube' } });
  hostWindow.contentView.addChildView(toolbarView); hostWindow.contentView.addChildView(youtubeView);
  layoutYoutube();
  const wc = youtubeView.webContents, remoteSession = wc.session;
  // An unshared preview must never leak an early copy through system loopback.
  wc.setAudioMuted(true);
  remoteSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  remoteSession.setPermissionCheckHandler(() => false);
  const denyDownload = event => event.preventDefault();
  remoteSession.on('will-download', denyDownload);
  releaseYoutubeSession = () => remoteSession.removeListener('will-download', denyDownload);
  wc.on('will-navigate', (event, url) => { if (!allowedPage(url)) { event.preventDefault(); browserError = 'Ce navigateur est réservé à YouTube.'; sendBrowserState(); } });
  wc.on('will-redirect', (event, url) => { if (!allowedPage(url)) event.preventDefault(); });
  wc.setWindowOpenHandler(({ url }) => { if (allowedPage(url)) navigate(url); return { action: 'deny' }; });
  for (const name of ['did-navigate', 'did-navigate-in-page', 'page-title-updated', 'did-start-loading', 'did-stop-loading']) wc.on(name, sendBrowserState);
  wc.on('did-fail-load', (_event, code, _desc, _url, mainFrame) => { if (mainFrame && code !== -3) { browserError = 'Page indisponible. Vérifiez la connexion puis actualisez.'; sendBrowserState(); } });
  wc.on('render-process-gone', () => { browserError = 'Le lecteur a été interrompu. Cliquez sur Actualiser.'; captured = false; sendBrowserState(); hostWindow?.webContents.send('desktop:youtube-closed'); });
  toolbarView.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  toolbarView.webContents.on('will-navigate', event => event.preventDefault());
  toolbarView.webContents.loadFile(browserFile).catch(err => console.error('[desktop]', err.message));
  navigate(target);
}
async function startServer() {
  const port = Number(process.env.PORT || 3000);
  if (port !== 0) {
    try { const response = await fetch(`http://127.0.0.1:${port}/api/status`, { signal: AbortSignal.timeout(800) }); const data = await response.json(); if (data.application === 'localsound-share' && data.version === require('../package.json').version) return `http://127.0.0.1:${port}`; } catch (_) { }
  }
  let Capture;
  try { Capture = require('loopback-capture').LoopbackCapture; } catch (err) { console.error('[audio]', err.message); }
  const makeServer = () => createApp({ Capture, mediaInfo: testMode ? null : createWindowsMediaInfo(), appearanceStore: testMode ? null : createAppearanceStore(app.isPackaged ? path.join(app.getPath('userData'), 'appearance.json') : path.join(__dirname, '..', 'data', 'appearance.json')) });
  const listen = chosen => new Promise((resolve, reject) => {
    instance.server.once('error', reject);
    instance.server.listen(chosen, '0.0.0.0', () => { instance.server.off('error', reject); resolve(); });
  });
  instance = makeServer();
  try { await listen(port); }
  catch (err) {
    if (err.code !== 'EADDRINUSE' || port === 0) throw err;
    await instance.close(); instance = makeServer(); await listen(0);
  }
  return 'http://127.0.0.1:' + instance.server.address().port;
}
function registerIpc() {
  ipcMain.handle('desktop:open-youtube', (event, value) => { if (!hostSender(event)) throw new Error('Console requise.'); openYoutube(value); return true; });
  ipcMain.handle('desktop:prepare-capture', event => { if (!hostSender(event) || !sourceReady()) throw new Error('Ouvrez le navigateur YouTube avant de partager.'); capturePendingUntil = Date.now() + 5000; captured = false; return true; });
  ipcMain.handle('desktop:confirm-capture', event => hostSender(event) && captured && sourceReady());
  ipcMain.handle('desktop:youtube-panel-state', event => { if (!hostSender(event)) throw new Error('Console requise.'); return panelState(); });
  ipcMain.handle('desktop:youtube-panel-visible', (event, visible) => { if (!hostSender(event)) throw new Error('Console requise.'); panelVisible = Boolean(visible); layoutYoutube(); sendBrowserState(); });
  ipcMain.handle('desktop:youtube-panel-obscured', (event, obscured) => { if (!hostSender(event)) throw new Error('Console requise.'); panelObscured = Boolean(obscured); layoutYoutube(); sendBrowserState(); });
  ipcMain.handle('desktop:mini-ready', event => {
    if (!hostSender(event) || !miniWindow || miniWindow.isDestroyed()) throw new Error('Mini-lecteur indisponible.');
    miniWindow.setAlwaysOnTop(true, 'floating');
    if (!testMode) miniWindow.show();
    hostWindow.hide();
    return true;
  });
  ipcMain.handle('browser:state', event => { if (!toolbarSender(event)) throw new Error('Navigateur requis.'); return browserState(); });
  ipcMain.handle('browser:navigate', (event, value) => { if (!toolbarSender(event)) throw new Error('Navigateur requis.'); return navigate(value); });
  ipcMain.handle('browser:action', (event, action) => {
    if (!toolbarSender(event) || !youtubeView) throw new Error('Navigateur requis.');
    const wc = youtubeView.webContents;
    if (action === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    else if (action === 'forward' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
    else if (action === 'reload') { browserError = ''; wc.reload(); }
    else if (action === 'home') navigate('');
    else if (action === 'expand') { panelExpanded = !panelExpanded; layoutYoutube(); sendBrowserState(); }
    else if (action === 'hide') { panelVisible = false; layoutYoutube(); sendBrowserState(); }
    else if (action === 'close') closeYoutube();
    else if (action === 'share') { panelVisible = false; layoutYoutube(); sendBrowserState(); hostWindow.webContents.send('desktop:share-youtube'); }
  });
}
async function start() {
  base = await startServer();
  hostWindow = new BrowserWindow({ icon: appIcon, width: 1380, height: 880, minWidth: 780, minHeight: 600, show: !testMode, backgroundColor: '#f4f0e7', title: 'LocalSound Share', webPreferences: { ...preferences, preload: path.join(__dirname, 'preload.js') } });
  hostWindow.setMenuBarVisibility(false);
  const localSession = hostWindow.webContents.session;
  localSession.setPermissionCheckHandler((wc, permission) => wc === hostWindow?.webContents && ['display-capture', 'clipboard-sanitized-write'].includes(permission));
  localSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    // Electron 44 nomme encore « media » la capture d'écran, sans mediaTypes.
    // Les versions suivantes emploient « display-capture ». Jamais caméra/micro.
    const displayCapture = permission === 'display-capture' || (permission === 'media' && Array.isArray(details.mediaTypes) && details.mediaTypes.length === 0);
    callback(wc === hostWindow?.webContents && details.isMainFrame && displayCapture && capturePendingUntil > Date.now());
  });
  localSession.setDisplayMediaRequestHandler((request, callback) => {
    if (!hostWindow || request.frame !== hostWindow.webContents.mainFrame || new URL(request.securityOrigin).origin !== base || Date.now() > capturePendingUntil || !sourceReady()) return callback(null);
    capturePendingUntil = 0;
    try {
      callback({ video: youtubeView.webContents.mainFrame, audio: youtubeView.webContents.mainFrame, enableLocalEcho: false });
      youtubeView.webContents.setAudioMuted(false); captured = true; sendBrowserState();
    }
    catch (_) { captured = false; callback(null); }
  });
  hostWindow.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== base) event.preventDefault(); });
  hostWindow.webContents.setWindowOpenHandler(({ url, frameName }) => {
    if (url === 'about:blank' && frameName === 'localsound-mini-host') return { action: 'allow', overrideBrowserWindowOptions: { ...miniWindowOptions(true), icon: appIcon, webPreferences: preferences } };
    if (url === 'about:blank' || url.startsWith(base + '/listen')) return { action: 'allow' };
    if (externalLinks.has(url)) shell.openExternal(url).catch(err => console.error('[lien]', err.message));
    return { action: 'deny' };
  });
  hostWindow.webContents.on('did-create-window', (child, details) => {
    if (details.frameName !== 'localsound-mini-host') return;
    miniWindow = child; lockMiniWindow(child);
    child.on('closed', () => {
      if (miniWindow === child) miniWindow = null;
      if (!quitting && hostWindow && !hostWindow.isDestroyed() && !testMode) { hostWindow.show(); hostWindow.focus(); }
    });
  });
  hostWindow.on('resize', layoutYoutube);
  hostWindow.on('closed', () => { miniWindow?.close(); closeYoutube(false); hostWindow = null; app.quit(); });
  registerIpc();
  await hostWindow.loadURL(base + '/host');
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (miniWindow && !miniWindow.isDestroyed()) { if (miniWindow.isMinimized()) miniWindow.restore(); miniWindow.show(); miniWindow.focus(); return; }
    if (hostWindow) { if (hostWindow.isMinimized()) hostWindow.restore(); hostWindow.show(); hostWindow.focus(); }
  });
  app.whenReady().then(start).catch(async err => { console.error('[desktop]', err.message); if (!testMode) dialog.showErrorBox('LocalSound Share', err.message); await instance?.close(); app.exit(1); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', event => {
    if (!quitting && instance) {
      event.preventDefault(); quitting = true;
      // Une requête de miniature en cours ne doit pas retenir la fermeture.
      const deadline = setTimeout(() => app.exit(0), 3000);
      instance.close().finally(() => { clearTimeout(deadline); instance = null; app.quit(); });
    }
  });
}
