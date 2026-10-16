'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createApp } = require('../server');
class Capture {
  startSystemAudio(callback) { this.timer = setInterval(() => callback(Buffer.alloc(1920)), 10); }
  stop() { clearInterval(this.timer); }
}
(async () => {
  const app = createApp({ Capture }); let browser;
  const output = path.resolve('artifacts/interface'); fs.mkdirSync(output, { recursive: true });
  try {
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); app.control('play');
    browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--mute-audio'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage(); const errors = [], remoteRequests = [];
    page.on('pageerror', err => errors.push(err.message));
    page.on('request', request => { if (!['127.0.0.1'].includes(new URL(request.url()).hostname)) remoteRequests.push(request.url()); });
    const base = 'http://127.0.0.1:' + app.server.address().port;
    async function checkLayout() {
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, 'Débordement horizontal');
      assert.equal(await page.locator('h1').count(), 1);
    }
    await page.goto(base + '/host'); await page.waitForFunction(() => document.getElementById('streamState').textContent === 'En direct' && document.getElementById('kbps').textContent !== '0 kbit/s');
    await checkLayout(); await page.screenshot({ path: path.join(output, 'host-desktop.png'), fullPage: true, animations: 'disabled' });
    await page.getByRole('button', { name: 'Choisir une source', exact: false }).click();
    assert.equal(await page.locator('#sourceModal').isVisible(), true);
    await page.screenshot({ path: path.join(output, 'source-selector.png'), fullPage: true, animations: 'disabled' });
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#sourceModal').isVisible(), false);
    await page.locator('#openSharingModal').click();
    await page.screenshot({ path: path.join(output, 'sharing-modal.png'), fullPage: true, animations: 'disabled' });
    await page.getByRole('button', { name: 'Copier', exact: true }).click();
    await page.waitForFunction(() => document.getElementById('toast').textContent.includes('Adresse copiée'));
    assert.match(await page.evaluate(() => navigator.clipboard.readText()), /^http:\/\//);
    await page.locator('#closeSharingModal').click();
    await page.getByRole('button', { name: 'Pause', exact: false }).click();
    await page.waitForFunction(() => document.getElementById('streamState').textContent === 'En pause');
    assert.equal(await page.locator('#liveTag').isVisible(), false);
    await page.getByRole('button', { name: 'Démarrer', exact: false }).click();
    await page.goto(base + '/listen');
    await page.waitForFunction(() => document.getElementById('connStatus').textContent === 'Connecté');
    await checkLayout(); await page.screenshot({ path: path.join(output, 'listener-desktop.png'), fullPage: true, animations: 'disabled' });
    await page.getByRole('button', { name: 'Écouter', exact: false }).click();
    await page.waitForFunction(() => document.body.classList.contains('is-joined'));
    await page.waitForFunction(() => document.getElementById('bufferMs').textContent !== '—');
    assert.equal(await page.locator('#listenHelp').isVisible(), false);
    await page.locator('#openAudioModal').click(); assert.equal(await page.locator('#playbackMode').isVisible(), true);
    await page.locator('#closeAudioModal').click();
    await page.setViewportSize({ width: 390, height: 844 });
    await checkLayout(); await page.screenshot({ path: path.join(output, 'listener-mobile.png'), fullPage: true, animations: 'disabled' });
    await page.getByRole('button', { name: 'Arrêter l’écoute', exact: false }).click();
    assert.equal(await page.locator('#listenHelp').isVisible(), true);
    await page.goto(base + '/host');
    await page.waitForFunction(() => document.getElementById('hostLine').textContent.includes('Hôte :'));
    await checkLayout(); await page.screenshot({ path: path.join(output, 'host-mobile.png'), fullPage: true, animations: 'disabled' });
    await page.locator('#openSharingModal').click();
    assert.equal(await page.locator('#sharingModal').isVisible(), true);
    await page.screenshot({ path: path.join(output, 'sharing-modal-mobile.png'), fullPage: true, animations: 'disabled' });
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 320, height: 740 }); await checkLayout();
    await page.goto(base + '/listen'); await checkLayout();
    assert.deepEqual(errors, []); assert.deepEqual(remoteRequests, []);
    console.log('Interface : desktop, mobile 390/320 px, navigation, copie, pause/reprise, écoute et détails — OK');
    console.log('Captures : ' + output);
  } finally { await browser?.close(); await app.close(); }
})().catch(err => { console.error(err); process.exitCode = 1; });
