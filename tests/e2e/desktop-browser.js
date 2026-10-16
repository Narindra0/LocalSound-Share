'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { once } = require('node:events');
const { _electron } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { WebSocket } = require('ws');
(async () => {
  let desktop, socket;
  try {
    const env = { ...process.env, PORT: '0', LOCALSOUND_DESKTOP_TEST: '1', LOCALSOUND_DESKTOP_PROFILE: path.resolve('artifacts/desktop-test-profile') };
    delete env.ELECTRON_RUN_AS_NODE;
    const executable = process.env.LOCALSOUND_TEST_EXE;
    desktop = await _electron.launch({ executablePath: executable ? path.resolve(executable) : require('electron'), args: executable ? [] : [path.resolve('desktop/main.js')], env, timeout: 30000 });
    desktop.process().stdout.on('data', data => process.stdout.write(data));
    const host = await desktop.firstWindow();
    host.on('pageerror', error => console.error('Console desktop :', error.message));
    await host.waitForFunction(() => document.getElementById('connStatus')?.textContent === 'Serveur en ligne');
    const base = new URL(host.url()).origin;
    // Véritables WebContentsView et capture audio Electron ; seul le site distant est simulé.
    await desktop.evaluate(({ session }) => {
      session.fromPartition('persist:localsound-youtube').protocol.handle('https', request => {
        const url = new URL(request.url);
        const title = url.pathname === '/watch' ? 'Une vidéo du salon' : url.pathname === '/results' ? 'Résultats YouTube' : 'Accueil YouTube';
        return new Response(`<!doctype html><meta charset="utf-8"><title>${title}</title><style>body{font:20px sans-serif;background:#fafafa;padding:40px}a,button{display:block;margin:20px}</style><h1>${title}</h1><a id="video-link" href="https://www.youtube.com/watch?v=jNQXAC9IVRw">Choisir une vidéo</a><button id="tone" onclick="window.ctx=new AudioContext();const osc=ctx.createOscillator(),g=ctx.createGain();g.gain.value=.0001;osc.connect(g);g.connect(ctx.destination);osc.start();ctx.resume()">Lancer le son de test</button>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      });
    });
    await host.locator('#chooseSourceBtn').click(); await host.locator('#sourceYoutubeBtn').click();
    assert.equal(await host.locator('#embeddedYoutubeUrl').getAttribute('type'), 'text');
    await host.locator('#youtubeSourceForm button[type=submit]').click();
    const toolbar = {
      async evaluate(code) { return desktop.evaluate(async ({ webContents }, source) => {
        const wc = webContents.getAllWebContents().find(w => w.getURL().endsWith('/desktop/browser.html'));
        return wc ? wc.executeJavaScript(source, true) : null;
      }, code); },
      async waitForFunction(fn) { const until=Date.now()+10000; while(Date.now()<until) { try { if(await this.evaluate('('+fn.toString()+')()')) return; } catch {} await new Promise(r=>setTimeout(r,50)); } throw new Error('Barre YouTube : attente expirée'); },
      locator(selector) { return { fill: value => this.evaluate('document.querySelector('+JSON.stringify(selector)+').value='+JSON.stringify(value)), click: () => this.evaluate('document.querySelector('+JSON.stringify(selector)+').click()') }; }
    };
    await toolbar.waitForFunction(() => Boolean(document.getElementById('address')));
    assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1, 'YouTube ne crée aucune nouvelle fenêtre');
    await toolbar.waitForFunction(() => document.getElementById('address').value === 'https://www.youtube.com/');
    try { await host.waitForFunction(() => !document.getElementById('stopTabBtn').hidden, null, {timeout:10000}); }
    catch (_) { throw new Error('Partage automatique : '+await host.locator('#sourceNotice').textContent()+' / '+await host.locator('#youtubeSourceStatus').textContent()); }
    assert.equal((await (await fetch(base+'/api/status')).json()).sourceKind,'tab','Ouvrir YouTube doit quitter automatiquement le son système.');
    await host.evaluate(() => {
      window.monitorCorrections = [];
      const original = SynchronizedPCMPlayer.prototype.pushPacket;
      SynchronizedPCMPlayer.prototype.pushPacket = function(buffer, clock, correction) { window.monitorCorrections.push(correction); return original.call(this, buffer, clock, correction); };
    });
    await host.locator('#openSharingModal').click();
    await host.locator('#hostCalibration').fill('35'); await host.locator('#hostCalibration').dispatchEvent('input');
    assert.equal(await host.evaluate(() => LocalSoundPrefs.read('hostCalibrationMs',0)),35);
    await host.locator('#closeSharingModal').click();
    await toolbar.locator('#address').fill('jazz dans le salon'); await toolbar.locator('#go').click();
    await toolbar.waitForFunction(() => document.getElementById('address').value.includes('/results?search_query='));
    await toolbar.waitForFunction(() => !document.getElementById('back').disabled);
    await toolbar.locator('#back').click(); await toolbar.waitForFunction(() => document.getElementById('address').value === 'https://www.youtube.com/');
    await toolbar.locator('#forward').click(); await toolbar.waitForFunction(() => document.getElementById('address').value.includes('/results?'));
    await toolbar.locator('#address').fill('https://www.youtube.com/watch?v=jNQXAC9IVRw'); await toolbar.locator('#go').click();
    await toolbar.waitForFunction(() => document.getElementById('pageTitle').textContent === 'Une vidéo du salon');
    assert.equal(await desktop.evaluate(({ webContents }) => {
      const source = webContents.getAllWebContents().find(wc => wc.getURL().startsWith('https://www.youtube.com/'));
      const settings = source.getLastWebPreferences();
      return settings.sandbox && settings.contextIsolation && !settings.nodeIntegration && !settings.preload;
    }), true, 'Le site distant est isolé de Node et des API de la console');
    await desktop.evaluate(async ({ webContents }) => {
      const source = webContents.getAllWebContents().find(wc => wc.getURL().startsWith('https://www.youtube.com/'));
      await source.executeJavaScript("document.getElementById('tone').click()", true);
    });
    await toolbar.locator('#shareBrowser').click();
    await host.locator('#youtubeSourceModal').waitFor({ state: 'visible' });
    await host.evaluate(() => {
      window.captureTrace = [];
      const original = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getDisplayMedia = async options => {
        window.captureTrace.push('request');
        try { const stream = await original(options); window.captureTrace.push(stream.getTracks().map(t => ({ kind: t.kind, readyState: t.readyState, settings: t.getSettings() }))); return stream; }
        catch (err) { window.captureTrace.push(err.name + ': ' + err.message); throw err; }
      };
    });
    await host.locator('#shareYoutubePlayer').click();
    try { await host.waitForFunction(() => document.getElementById('stopTabBtn').hidden === false, null, { timeout: 15000 }); }
    catch (err) { throw new Error('Capture native : ' + await host.locator('#sourceNotice').textContent() + ' ' + JSON.stringify(await host.evaluate(() => window.captureTrace)), { cause: err }); }
    socket = new WebSocket(base.replace('http:', 'ws:')); await once(socket, 'open');
    let audiblePackets = 0;
    socket.on('message', (data, binary) => { if (binary && data.subarray(24).some(value => value !== 0)) audiblePackets++; });
    socket.send(JSON.stringify({ type: 'hello', role: 'client', protocol: 2 }));
    const packet = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Aucun PCM reçu du navigateur natif')), 10000);
      socket.on('message', (data, binary) => { if (binary && data.subarray(24).some(value => value !== 0)) { clearTimeout(timeout); resolve(data); } });
    });
    socket.send(JSON.stringify({ type: 'listen' }));
    assert.ok((await packet).length > 24);
    await host.waitForFunction(() => window.monitorCorrections.includes(35));
    const state = await (await fetch(base + '/api/status')).json();
    assert.equal(state.sourceKind, 'tab'); assert.equal(state.synchronized, true);
    const idBefore = await desktop.evaluate(({webContents}) => webContents.getAllWebContents().find(w => w.getURL().startsWith('https://www.youtube.com/')).id);
    await toolbar.locator('#expand').click();
    await toolbar.waitForFunction(() => document.getElementById('expand').getAttribute('aria-label') === 'Réduire le lecteur');
    await toolbar.locator('#expand').click();
    await toolbar.locator('#hide').click();
    await host.waitForFunction(async () => !(await window.localsoundDesktop.youtubePanelState()).visible);
    const hiddenCount = audiblePackets; await new Promise(resolve => setTimeout(resolve, 300));
    assert.ok(audiblePackets > hiddenCount, 'L’audio continue quand YouTube est masqué');
    assert.equal((await (await fetch(base + '/api/status')).json()).playing, true);
    await host.locator('#toggleYoutubePanel').click();
    await host.waitForFunction(async () => (await window.localsoundDesktop.youtubePanelState()).visible);
    await host.locator('#openSharingModal').click();
    await host.waitForFunction(async () => !(await window.localsoundDesktop.youtubePanelState()).visible);
    await host.locator('#closeSharingModal').click();
    await host.waitForFunction(async () => (await window.localsoundDesktop.youtubePanelState()).visible);
    assert.equal(await desktop.evaluate(({webContents}) => webContents.getAllWebContents().find(w => w.getURL().startsWith('https://www.youtube.com/')).id), idBefore, 'Les changements de vue conservent la source audio');
    const toolbarShot = await desktop.evaluate(async ({ webContents }) => (await webContents.getAllWebContents().find(wc => wc.getURL().endsWith('/desktop/browser.html')).capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG().toString('base64'));
    fs.writeFileSync(path.resolve('artifacts/interface/youtube-integrated-toolbar.png'), Buffer.from(toolbarShot, 'base64'));
    await desktop.evaluate(({BrowserWindow}) => { const win = BrowserWindow.getAllWindows()[0]; win.setPosition(-20000, -20000); win.showInactive(); });
    assert.equal(await desktop.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].isVisible()), true);
    const miniPromise = desktop.waitForEvent('window'); await host.locator('#openMiniPlayer').click(); const mini = await miniPromise;
    await mini.waitForSelector('.mini-player');
    assert.equal(await desktop.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().find(w => w.webContents.getTitle().includes('Mini-lecteur')).isAlwaysOnTop()), true);
    assert.equal(await desktop.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('/host')).isVisible()), false);
    const miniCount = audiblePackets; await new Promise(resolve => setTimeout(resolve, 300));
    assert.ok(audiblePackets > miniCount, 'L’audio continue quand la grande fenêtre est masquée');
    await mini.locator('[data-proxy=pauseBtn]').click();
    await host.waitForFunction(() => document.getElementById('streamState').textContent === 'En pause');
    await mini.locator('[data-proxy=playBtn]').click();
    await host.waitForFunction(() => !document.getElementById('pauseBtn').disabled);
    await mini.locator('.mini-return').click(); await host.waitForFunction(() => document.getElementById('openMiniPlayer').getAttribute('aria-expanded') === 'false');
    assert.equal((await (await fetch(base + '/api/status')).json()).playing, true);
    await toolbar.locator('#close').click();
    await host.waitForFunction(() => document.getElementById('stopTabBtn').hidden);
    console.log('Desktop : YouTube intégré, compact/agrandi, masquage, audio natif, mini-lecteur au premier plan et retour — OK');
  } finally { socket?.terminate(); await desktop?.close(); }
})().catch(err => { console.error(err); process.exitCode = 1; });
