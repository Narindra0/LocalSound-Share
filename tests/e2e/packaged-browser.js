'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { _electron } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { taggedMp3 } = require('../helpers/media-fixture');
const { WebSocket } = require('ws');
const { once } = require('node:events');
(async () => {
  let desktop, listener;
  const exe = path.resolve(process.env.LOCALSOUND_TEST_EXE || 'release/win-unpacked/LocalSound Share.exe');
  try {
    const env = { ...process.env, PORT: '0', LOCALSOUND_DESKTOP_TEST: '1', LOCALSOUND_DESKTOP_PROFILE: path.resolve('artifacts/packaged-test-profile') }; delete env.ELECTRON_RUN_AS_NODE;
    desktop = await _electron.launch({ executablePath: exe, args: [], env, timeout: 60000 });
    const host = await desktop.firstWindow(), errors = [];
    host.on('pageerror', err => errors.push(err.message));
    await host.waitForFunction(() => document.getElementById('connStatus')?.textContent === 'Serveur en ligne');
    const base = new URL(host.url()).origin;
    const state = await (await fetch(base + '/api/status')).json();
    assert.equal(state.sourceReady, true, 'Le module audio natif est embarqué et chargé');
    assert.equal(await desktop.evaluate(({ app }) => app.isPackaged), true);
    assert.equal(await desktop.evaluate(({ app }) => app.getName()), 'LocalSound Share');
    assert.equal(await desktop.evaluate(({ app }) => app.getVersion()), require('../../package.json').version);
    const response = await fetch(base + '/api/track-info', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: taggedMp3() });
    const info = await response.json();
    assert.equal(response.status, 200); assert.ok(info.token, 'Le worker de métadonnées fonctionne dans le paquet');
    await host.locator('#openAbout').click();
    const legal = host.frameLocator('#aboutModal iframe');
    await legal.locator('.about-navigation a[href="#createur"]').click();
    await legal.locator('#createur h2').waitFor();
    assert.equal(await legal.locator('#createur h2').textContent(), 'Ranjalahy Narindra');
    assert.equal(await legal.getByRole('link', { name: 'ranjalahy.narindraa@gmail.com', exact: true }).getAttribute('href'), 'mailto:ranjalahy.narindraa@gmail.com');
    assert.equal(await legal.getByRole('link', { name: '0328814081', exact: true }).getAttribute('href'), 'tel:0328814081');
    await legal.locator('.about-navigation a[href="#cgu"]').click(); await legal.locator('#cgu').waitFor();
    await legal.locator('.about-navigation a[href="#confidentialite"]').click(); await legal.locator('#confidentialite').waitFor();
    const licenses = await fetch(base + '/third-party.html'); assert.equal(licenses.status, 200); assert.match(await licenses.text(), /LGPL-3.0/);
    const sources = await fetch(base + '/licenses/lamejs-source.zip'); assert.equal(sources.status, 200); assert.equal(Buffer.from(await sources.arrayBuffer()).readUInt16LE(0), 0x4b50);
    await host.locator('#aboutModal .close-dialog').click();
    const pcm = Buffer.alloc(48000 * 4 * 2);
    for (let i=0;i<pcm.length/4;i++) { const sample=Math.round(Math.sin(i*2*Math.PI*440/48000)*12000);pcm.writeInt16LE(sample,i*4);pcm.writeInt16LE(-sample,i*4+2); }
    assert.equal((await fetch(base+'/api/track',{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:pcm})).status,200);
    listener = new WebSocket(base.replace('http:','ws:')); await once(listener,'open');
    const opus = new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Le worker Opus doit fonctionner dans le paquet Electron.')),4000);
      listener.on('message',(data,binary)=>{if(binary){clearTimeout(timer);resolve(data);}});
    });
    listener.send(JSON.stringify({type:'hello',role:'client',protocol:2,codec:'opus'})); listener.send(JSON.stringify({type:'listen'}));
    await fetch(base+'/api/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'play'})});
    const packet=await opus; assert.equal(packet.toString('ascii',0,4),'LSO3'); assert.equal(packet.length,520);
    await fetch(base+'/api/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'stop'})});
    listener.terminate(); listener=null;
    const miniPromise = desktop.waitForEvent('window');
    await host.locator('#openMiniPlayer').click(); const mini = await miniPromise;
    await mini.waitForSelector('.mini-player');
    assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.webContents.getTitle().includes('Mini-lecteur')).isAlwaysOnTop()), true);
    assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('/host')).isVisible()), false);
    await mini.locator('.mini-return').click();
    await host.waitForFunction(() => document.getElementById('openMiniPlayer').getAttribute('aria-expanded') === 'false');
    for (const [width, height] of [[1366, 768], [960, 560], [390, 844]]) {
      await host.setViewportSize({ width, height });
      assert.ok(await host.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      if (width >= 960) assert.ok(await host.evaluate(() => document.documentElement.scrollHeight <= innerHeight));
    }
    const brand = await (await fetch(base + '/branding/icon-256.png')).arrayBuffer(); assert.ok(brand.byteLength > 1000);
    assert.deepEqual(errors, []);
    console.log(path.basename(exe) + ' : application autonome, audio natif, worker, identité, CGU et licences — OK');
  } finally { listener?.terminate(); await desktop?.close(); }
})().catch(err => { console.error(err); process.exitCode = 1; });
