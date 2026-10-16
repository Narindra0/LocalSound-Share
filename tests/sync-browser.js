'use strict';
const assert = require('node:assert/strict');
const os = require('node:os');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createApp } = require('../server');
function wav(seconds = 20) {
  const frames = 48000 * seconds, buffer = Buffer.alloc(44 + frames * 4);
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(2, 22);
  buffer.writeUInt32LE(48000, 24); buffer.writeUInt32LE(192000, 28); buffer.writeUInt16LE(4, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(frames * 4, 40);
  for (let i = 0; i < frames; i++) {
    buffer.writeInt16LE(Math.round(Math.sin(i * Math.PI * 2 * 440 / 48000) * 10000), 44 + i * 4);
    buffer.writeInt16LE(Math.round(Math.sin(i * Math.PI * 2 * 660 / 48000) * 10000), 46 + i * 4);
  }
  return buffer;
}
(async () => {
  class Capture { startSystemAudio() {} stop() {} }
  const app = createApp({ Capture }); let browser;
  try {
    await new Promise(resolve => app.server.listen(0, '0.0.0.0', resolve)); app.control('play');
    browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--mute-audio', '--no-proxy-server'] });
    const port = app.server.address().port, base = 'http://localhost:' + port;
    const lan = Object.values(os.networkInterfaces()).flat().find(n => n.family === 'IPv4' && !n.internal)?.address;
    const host = await browser.newPage(), listener = await browser.newPage(), listener2 = await browser.newPage();
    const pages = [host, listener, listener2], errors = [];
    for (const page of pages) page.on('pageerror', error => errors.push(error.message));
    await host.goto(base + '/host'); await listener.goto(`http://${lan}:${port}`); await listener2.goto(base + '/listen');
    for (const page of pages) await page.evaluate(() => {
      window.syncTimings = []; const original = SynchronizedPCMPlayer.prototype.pushPacket;
      SynchronizedPCMPlayer.prototype.pushPacket = function(buffer, clock, calibration) {
        const result = original.call(this, buffer, clock, calibration);
        const view = new DataView(buffer);
        if (view.byteLength >= 28 && this.previous && Number.isFinite(view.getFloat64(16, true))) {
          window.syncPlayerInstance = this;
          const stamp = this.context.getOutputTimestamp();
          const physical = (this.previous.start - stamp.contextTime) * 1000 + stamp.performanceTime + clock.offset;
          window.syncTimings.push({ seq: view.getUint32(4, true), physical, deadline: view.getFloat64(16, true) });
          if (window.syncTimings.length > 500) window.syncTimings.shift();
        }
        return result;
      };
    });
    for (const page of [listener, listener2]) await page.getByRole('button', { name: 'Écouter', exact: false }).click();
    await host.getByRole('button', { name: 'Choisir une source', exact: false }).click();
    const chooserPromise = host.waitForEvent('filechooser');
    await host.locator('label[for=musicFile]').click();
    const chooser = await chooserPromise;
    await chooser.setFiles({ name: 'synchronisation-test.wav', mimeType: 'audio/wav', buffer: wav() });
    await host.waitForFunction(() => document.getElementById('sourceLabel').textContent === 'synchronisation-test');
    await host.waitForFunction(() => document.getElementById('hostListenBtn').textContent.includes('Couper'));
    await Promise.all(pages.map(page => page.waitForFunction(() => window.syncTimings.length > 50)));
    const measurements = await Promise.all(pages.map(page => page.evaluate(async () => {
      const player = window.syncPlayerInstance, analyser = player.context.createAnalyser(); analyser.fftSize = 1024;
      player.destination.connect(analyser); const samples = new Float32Array(1024);
      let minRms = Infinity, maxRms = 0;
      for (let i = 0; i < 80; i++) {
        analyser.getFloatTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length);
        if (i > 5) { minRms = Math.min(minRms, rms); maxRms = Math.max(maxRms, rms); }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      player.destination.disconnect(analyser);
      return { minRms, maxRms, timings: window.syncTimings.slice(-100), stats: player.stats() };
    })));
    for (const measured of measurements) {
      assert.ok(measured.minRms > 0.005, 'Coupure dans le signal audio');
      assert.ok(measured.maxRms > 0.02, 'Signal absent'); assert.ok(measured.stats.levelMs < 220);
    }
    const reference = new Map(measurements[0].timings.map(t => [t.seq, t]));
    let maxDelta = 0, compared = 0;
    for (const measured of measurements.slice(1)) for (const timing of measured.timings) {
      if (!reference.has(timing.seq)) continue;
      maxDelta = Math.max(maxDelta, Math.abs(timing.physical - reference.get(timing.seq).physical)); compared++;
    }
    assert.ok(compared > 20); assert.ok(maxDelta < 8, 'Écart planifié excessif : ' + maxDelta);
    console.log(JSON.stringify({ plannedOutputDeltaMs: maxDelta, comparedPackets: compared,
      players: measurements.map(m => ({ minRms: m.minRms, maxRms: m.maxRms, ...m.stats })) }));
    await host.getByRole('button', { name: 'Pause', exact: false }).click();
    await listener.waitForFunction(() => document.getElementById('streamState').textContent === 'En pause');
    await host.getByRole('button', { name: 'Démarrer', exact: false }).click();
    await listener.waitForFunction(() => document.getElementById('streamState').textContent === 'En direct');
    assert.deepEqual(errors, []);
    console.log('Fichier : hôte + deux auditeurs, signal continu et échéances communes — OK (mesure logicielle, pas acoustique)');
  } finally { await browser?.close(); await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
