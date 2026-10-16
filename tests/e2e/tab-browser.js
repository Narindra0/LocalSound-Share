'use strict';
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createApp } = require('../../server');
(async () => {
  class Capture { startSystemAudio() {} stop() {} }
  const app = createApp({ Capture }); let browser;
  try {
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ channel: 'msedge', headless: true, ignoreDefaultArgs: ['--mute-audio'], args: [
      '--auto-select-tab-capture-source-by-title=LocalSound Synthetic Source', '--no-proxy-server',
    ] });
    const context = await browser.newContext(), source = await context.newPage(), host = await context.newPage(), listener = await context.newPage();
    const base = 'http://localhost:' + app.server.address().port, errors = [];
    for (const page of [source, host, listener]) page.on('pageerror', err => errors.push(err.message));
    await source.route('**/synthetic-source', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><title>LocalSound Synthetic Source</title><button id="tone">Son de test</button><canvas id="video" width="320" height="200"></canvas><script>document.getElementById('tone').onclick=async()=>{window.ctx=new AudioContext();await ctx.resume();const tone=ctx.createOscillator(),gain=ctx.createGain();tone.frequency.value=440;gain.gain.value=0.2;tone.connect(gain).connect(ctx.destination);tone.start();window.stopTone=()=>tone.stop();document.getElementById('tone').textContent='Actif';};</script>` }));
    await source.goto(base + '/synthetic-source');
    await host.goto(base + '/host'); await listener.goto(base + '/listen');
    await host.evaluate(() => {
      window.captureMax = 0;
      const Original = window.AudioWorkletNode;
      window.AudioWorkletNode = class extends Original {
        constructor(...args) { super(...args); if (args[1] === 'tab-pcm-source') {
          this.port.addEventListener('message', ({data}) => { const samples = new Int16Array(data.samples); for (const sample of samples) window.captureMax = Math.max(window.captureMax, Math.abs(sample)); });
          this.port.start();
        } }
      };
    });
    await host.locator('#openSharingModal').click(); await host.locator('#hostVolume').fill('0'); await host.locator('#closeSharingModal').click();
    await listener.locator('#volume').fill('0');
    await listener.evaluate(() => {
      const original = SynchronizedPCMPlayer.prototype.pushAt;
      SynchronizedPCMPlayer.prototype.pushAt = function(...args) {
        original.apply(this, args);
        if (!window.syncAnalyser) { window.syncAnalyser = this.context.createAnalyser(); window.syncAnalyser.fftSize = 1024; }
        if (this.previous) this.previous.gain.connect(window.syncAnalyser);
      };
    });
    await listener.getByRole('button', { name: 'Écouter', exact: false }).click();
    await host.getByRole('button', { name: 'Choisir une source', exact: false }).click();
    await host.getByRole('button', { name: 'Partager un onglet', exact: false }).click();
    try { await host.waitForFunction(() => document.getElementById('sourceLabel').textContent === 'Onglet partagé', { timeout: 15000 }); }
    catch (err) { console.error('État du partage : ' + await host.locator('#sourceNotice').textContent()); throw err; }
    await source.getByRole('button', { name: 'Son de test' }).click(); await listener.waitForFunction(() => state?.synchronized && syncPlayer?.previous);
    const result = await listener.evaluate(async () => {
      const analyser = window.syncAnalyser;
      const values = new Float32Array(1024); let maxRms = 0;
      for (let i = 0; i < 100; i++) {
        analyser.getFloatTimeDomainData(values); maxRms = Math.max(maxRms, Math.sqrt(values.reduce((sum, x) => sum + x * x, 0) / values.length));
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      return { maxRms, ...syncPlayer.stats() };
    });
    console.log(JSON.stringify({result, captureMax: await host.evaluate(() => window.captureMax), sourceState: await source.evaluate(() => ctx.state)})); assert.ok(result.maxRms > 0.02, 'Le signal capturé est absent');
    console.log('Partage natif d’un onglet synthétique : ' + JSON.stringify(result));
    await source.evaluate(() => window.stopTone()); await host.getByRole('button', { name: 'Terminer le partage' }).click();
    await listener.waitForFunction(() => !state.playing); assert.deepEqual(errors, []);
    console.log('Capture réelle de l’onglet et suppression locale confirmée par le navigateur — OK');
  } finally { await browser?.close(); await app.close(); }
})().catch(err => { console.error(err); process.exitCode = 1; });
