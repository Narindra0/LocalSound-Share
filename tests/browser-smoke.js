'use strict';
// Vérification navigateur facultative : nécessite Playwright et Microsoft Edge.
const assert = require('node:assert/strict');
const os = require('node:os');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createApp } = require('../server');
const { performance } = require('node:perf_hooks');
let cursor = 0;
class Capture {
  startSystemAudio(callback) {
    const start = performance.now();
    this.timer = setInterval(() => {
      while (cursor + 480 <= (performance.now() - start) * 48) {
        const data = Buffer.alloc(1920);
        for (let i = 0; i < 480; i++) {
          data.writeInt16LE(Math.round(Math.sin((cursor + i) * Math.PI * 2 * 440 / 48000) * 10000), i * 4);
          data.writeInt16LE(Math.round(Math.sin((cursor + i) * Math.PI * 2 * 660 / 48000) * 10000), i * 4 + 2);
        }
        cursor += 480; callback(data);
      }
    }, 5);
  }
  stop() { clearInterval(this.timer); }
}
(async () => {
  const app = createApp({ Capture }); let browser;
  try {
    await new Promise(resolve => app.server.listen(0, '0.0.0.0', resolve)); app.control('play');
    browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--mute-audio', '--no-proxy-server'] });
    const port = app.server.address().port;
    const lan = Object.values(os.networkInterfaces()).flat().find(n => n.family === 'IPv4' && !n.internal)?.address;
    assert.ok(lan, 'Adresse réseau local absente : test HTTP LAN impossible');
    for (const host of ['localhost', lan]) {
      const page = await browser.newPage(); const errors = [];
      page.on('pageerror', err => errors.push(err.message));
      await page.goto(`http://${host}:${port}/listen`);
      await page.getByRole('button', { name: 'Écouter', exact: false }).click();
      await page.waitForFunction(() => document.getElementById('listenBtn').textContent.includes('Arrêter'));
      await page.waitForTimeout(1000);
      const result = await page.evaluate(async () => {
        const analyser = audioCtx.createAnalyser(); analyser.fftSize = 1024; gainNode.connect(analyser);
        const samples = new Float32Array(1024); let minRms = Infinity, maxRms = 0, maxBuffer = 0;
        for (let i = 0; i < 100; i++) {
          analyser.getFloatTimeDomainData(samples);
          if (i > 5) {
            const rms = Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length);
            minRms = Math.min(minRms, rms); maxRms = Math.max(maxRms, rms);
          }
          maxBuffer = Math.max(maxBuffer, Number.parseInt(document.getElementById('bufferMs').textContent) || 0);
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        gainNode.disconnect(analyser);
        return { secure: isSecureContext, mode, minRms, maxRms, maxBuffer, context: audioCtx.state,
          underruns: document.getElementById('underruns').textContent };
      });
      console.log(host + ': ' + JSON.stringify(result));
      assert.equal(result.context, 'running'); assert.ok(result.maxRms > 0.02, 'Aucun son PCM dans le moteur audio');
      assert.ok(result.minRms > 0.005, 'Silence pendant la lecture continue');
      assert.ok(result.maxBuffer <= 120, 'Tampon trop grand');
      if (host === lan) { assert.equal(result.secure, false); assert.equal(result.mode, 'PCM · direct'); }
      else assert.match(result.mode, /AudioWorklet/);
      // Simuler un gel de l’onglet ; les paquets anciens doivent être abandonnés.
      await page.evaluate(() => { const until = performance.now() + 300; while (performance.now() < until) {} });
      await page.waitForTimeout(500);
      const queue = await page.locator('#bufferMs').textContent(); assert.ok(Number.parseInt(queue) <= 160);
      app.control('pause'); await page.waitForFunction(() => document.getElementById('streamState').textContent === 'En pause');
      app.control('play'); await page.waitForFunction(() => document.getElementById('streamState').textContent === 'En direct');
      await page.getByRole('button', { name: 'Revenir au direct', exact: true }).click();
      await page.getByRole('button', { name: 'Arrêter l’écoute', exact: false }).click();
      assert.equal(await page.evaluate(() => audioCtx.state), 'suspended');
      assert.deepEqual(errors, []); await page.close();
    }
    console.log('Navigateur réel : PCM audible dans le graphe, tampon borné, pause/reprise et arrêt — OK');
  } finally { await browser?.close(); await app.close(); }
})().catch(err => { console.error(err); process.exitCode = 1; });
