'use strict';
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createApp } = require('../../server');
function wav() {
  const frames = 48000 * 20, data = Buffer.alloc(44 + frames * 4);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(2, 22);
  data.writeUInt32LE(48000, 24); data.writeUInt32LE(192000, 28); data.writeUInt16LE(4, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(frames * 4, 40);
  for (let i = 0; i < frames; i++) {
    const sample = Math.round(Math.sin(i * Math.PI * 2 * 440 / 48000) * 10000);
    data.writeInt16LE(sample, 44 + i * 4); data.writeInt16LE(sample, 46 + i * 4);
  }
  return data;
}
(async () => {
  class Capture { startSystemAudio() {} stop() {} }
  const app = createApp({ Capture }); let browser;
  try {
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); app.control('play');
    browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--mute-audio'] });
    const context = await browser.newContext(), host = await context.newPage(), listener = await context.newPage();
    const base = 'http://localhost:' + app.server.address().port, errors = [];
    for (const page of [host, listener]) page.on('pageerror', err => errors.push(err.message));
    await host.goto(base + '/settings');
    assert.match(host.url(), /\/host#sharingSettings$/);
    assert.equal(await host.locator('#sharingSettings').getAttribute('open'), '');
    await host.locator('#autoStartSource').uncheck(); await host.locator('#autoMonitor').uncheck();
    await host.locator('#syncDelay').selectOption('250'); await host.waitForTimeout(1100);
    assert.equal(await host.locator('#syncDelay').inputValue(), '250', 'Le polling ne doit pas effacer une modification');
    await host.locator('#saveSharingSettings').click();
    await host.waitForFunction(() => document.getElementById('sharingSettingsStatus').textContent.includes('250'));
    assert.equal(app.status().syncDelayMs, 250);
    await host.locator('#hostVolume').fill('35');
    await host.locator('#closeSharingModal').click();
    await host.locator('#chooseSourceBtn').click();
    const chooserPromise = host.waitForEvent('filechooser'); await host.locator('label[for=musicFile]').click();
    await (await chooserPromise).setFiles({ name: 'controle-partage.wav', mimeType: 'audio/wav', buffer: wav() });
    await host.waitForFunction(() => document.getElementById('sourceLabel').textContent === 'controle-partage');
    await host.waitForFunction(() => document.getElementById('sourceNotice').textContent.includes('Fichier synchronisé'));
    assert.equal(app.status().playing, false, 'La préparation ne doit pas démarrer la lecture');
    assert.equal(await host.locator('#hostListenBtn').textContent(), 'Écouter sur ce PC');
    await listener.goto(base + '/listen'); await listener.locator('#listenBtn').click();
    await host.evaluate(() => {
      const original = SynchronizedPCMPlayer.prototype.pushPacket;
      SynchronizedPCMPlayer.prototype.pushPacket = function(...args) { window.hostPlayer = this; return original.apply(this, args); };
    });
    await host.locator('#playBtn').click(); await listener.waitForFunction(() => state?.playing);
    await host.locator('#openSharingModal').click();
    await host.locator('#hostListenBtn').click(); await host.waitForFunction(() => window.hostPlayer?.previous);
    assert.match(await host.locator('#hostListenBtn').textContent(), /Couper/);
    await host.locator('#hostVolume').fill('20'); await host.waitForTimeout(200);
    assert.ok(Math.abs(await host.evaluate(() => window.hostPlayer.destination.gain.value) - 0.2) < 0.005, 'Le volume doit agir sur le graphe audio');
    await host.locator('#closeSharingModal').click();
    await host.locator('#pauseBtn').click(); await listener.waitForFunction(() => !state.playing && state.active);
    await host.waitForFunction(() => document.getElementById('playBtn').textContent.includes('Reprendre'));
    assert.match(await host.locator('#playBtn').textContent(), /Reprendre/);
    await host.locator('#playBtn').click(); await listener.waitForFunction(() => state.playing);
    await host.locator('#stopBtn').click(); await listener.waitForFunction(() => !state.playing && !state.active);
    await host.waitForFunction(() => document.getElementById('pauseBtn').disabled && !document.getElementById('playBtn').disabled);
    assert.equal(await host.locator('#pauseBtn').isDisabled(), true); assert.equal(await host.locator('#playBtn').isEnabled(), true);
    await host.reload(); await host.waitForFunction(() => document.getElementById('hostLine').textContent.includes('Hôte :'));
    assert.equal(await host.locator('#autoStartSource').isChecked(), false); assert.equal(await host.locator('#autoMonitor').isChecked(), false);
    assert.equal(await host.locator('#hostVolume').inputValue(), '20');
    await listener.locator('#openAudioModal').click();
    await listener.locator('#volume').fill('45'); await listener.locator('#calibration').fill('12');
    await listener.reload(); await listener.waitForFunction(() => document.getElementById('connStatus').textContent === 'Connecté');
    assert.equal(await listener.locator('#volume').inputValue(), '45'); assert.equal(await listener.locator('#calibration').inputValue(), '12');
    assert.equal(await listener.locator('#sharedDelayNotice').textContent(), 'Le délai commun de 250 ms aligne les appareils.');
    assert.deepEqual(errors, []);
    console.log('Partage : préparation sans lecture, démarrage, volume réel, pause/reprise, arrêt, délai commun et préférences mémorisées — OK');
  } finally { await browser?.close(); await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
