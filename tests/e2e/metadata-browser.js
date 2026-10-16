'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createApp } = require('../../server');
class Capture {
  startSystemAudio(callback) { this.timer = setInterval(() => callback(Buffer.alloc(1920)), 10); }
  stop() { clearInterval(this.timer); }
}
(async () => {
  let update, browser;
  const app = createApp({ Capture, mediaInfo:{ start(cb) { update = cb; }, close() {} } });
  const snapshot = (title, artist = 'Une chaîne YouTube') => ({ available:true, sessions:[{ title, artist, appId:'msedge.exe', playing:true }] });
  try {
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); app.control('play');
    browser = await chromium.launch({ channel:'msedge', headless:true, args:['--mute-audio'] });
    const context = await browser.newContext({ viewport:{ width:1366, height:768 } });
    const host = await context.newPage(), listener = await context.newPage();
    const errors = []; for (const page of [host, listener]) page.on('pageerror', error => errors.push(error.message));
    const base = 'http://127.0.0.1:' + app.server.address().port;
    await host.goto(base + '/host'); await listener.goto(base + '/listen');
    await listener.waitForFunction(() => document.getElementById('connStatus').textContent === 'Connecté');
    update(snapshot('Un morceau en direct'));
    await listener.waitForFunction(() => document.getElementById('sessionTitle').textContent === 'Un morceau en direct');
    assert.equal(await listener.locator('#hostLine').textContent(), 'Une chaîne YouTube');
    await host.waitForFunction(() => document.getElementById('nowPlayingTitle').textContent === 'Un morceau en direct');
    const generation = app.status().generation;
    update(snapshot('Le morceau suivant'));
    await listener.waitForFunction(() => document.getElementById('sessionTitle').textContent === 'Le morceau suivant');
    await host.locator('#openSharingModal').click();
    await host.locator('#metadataSettings > summary').click();
    await host.locator('#trackTitle').fill('Une correction <b>en texte</b>');
    await host.locator('#trackArtist').fill('Notre artiste');
    await host.waitForTimeout(1200);
    assert.equal(await host.locator('#trackTitle').inputValue(), 'Une correction <b>en texte</b>', 'Le rafraîchissement conserve la saisie');
    await host.locator('#saveMetadata').click();
    await listener.waitForFunction(() => document.getElementById('sessionTitle').textContent === 'Une correction <b>en texte</b>');
    assert.equal(await listener.locator('#sessionTitle b').count(), 0);
    assert.equal(await listener.locator('#hostLine').textContent(), 'Notre artiste');
    assert.equal(app.status().generation, generation);
    update(snapshot('Titre automatique suivant'));
    assert.equal(app.status().trackName, 'Une correction <b>en texte</b>');
    await host.locator('#autoMetadata').click();
    await listener.waitForFunction(() => document.getElementById('sessionTitle').textContent === 'Titre automatique suivant');
    await host.locator('#closeSharingModal').click();
    update(snapshot('Un très long titre de musique — '.repeat(7), 'Un artiste au nom particulièrement long '.repeat(6)));
    await host.waitForTimeout(1100);
    for (const page of [host, listener]) {
      assert.equal(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight || document.documentElement.scrollWidth > innerWidth), false);
    }
    await listener.setViewportSize({ width:390, height:844 });
    assert.equal(await listener.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    update(snapshot('Le morceau du moment', 'Artiste invité'));
    await listener.waitForFunction(() => document.getElementById('sessionTitle').textContent === 'Le morceau du moment');
    await listener.screenshot({ path:path.resolve('artifacts/interface/listener-track-mobile.png'), fullPage:true });
    update({ available:false, sessions:[] });
    await listener.waitForFunction(() => document.getElementById('sessionTitle').textContent === 'Le son du moment.');
    assert.deepEqual(errors, []);
    console.log('Titres : mise à jour automatique simulée, artiste, correction manuelle, reprise automatique, texte sécurisé et mobile — OK');
  } finally { await browser?.close(); await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
