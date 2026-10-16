'use strict';
const assert = require('node:assert/strict');
const path = require('node:path'), net = require('node:net');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createApp } = require('../server');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  let browser, child, page;
  class Capture { startSystemAudio(cb) { this.timer = setInterval(() => cb(Buffer.alloc(1920, 1)), 10); } stop() { clearInterval(this.timer); } }
  const host = createApp({ Capture });
  try {
    await new Promise(resolve => host.server.listen(0, '127.0.0.1', resolve)); host.control('play');
    const reserve = net.createServer(); await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve)); const debug = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
    const version = require('../package.json').version;
    const env = { ...process.env, LOCALSOUND_DESKTOP_TEST:'1', LOCALSOUND_LISTENER_PORT:'0', LOCALSOUND_DESKTOP_PROFILE:path.resolve('artifacts/portable-listener-test-profile') }; delete env.ELECTRON_RUN_AS_NODE;
    child = spawn(path.resolve('release/auditeur/LocalSound-Auditeur-' + version + '-Windows-x64.exe'), ['--remote-debugging-port=' + debug], { env, windowsHide:true, stdio:['ignore','pipe','pipe'] });
    let logs = ''; for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { logs = (logs + data).slice(-8000); }); child.on('error', err => { logs += err.message; });
    const until = Date.now() + 60000; let ready = false;
    while (Date.now() < until) { try { ready = (await fetch('http://127.0.0.1:' + debug + '/json/version', { signal:AbortSignal.timeout(800) })).ok; if (ready) break; } catch (_) {} await pause(200); }
    assert.ok(ready, logs); browser = await chromium.connectOverCDP('http://127.0.0.1:' + debug);
    for (let i=0; i<50; i++) { page = browser.contexts()[0].pages().find(p => /\/connect$/.test(p.url())); if (page) break; await pause(100); }
    assert.ok(page); await page.waitForSelector('#joinRoom');
    await page.locator('#openJoinLegal').click();
    await page.frameLocator('#joinLegal iframe').locator('#presentation').waitFor();
    assert.equal(await page.frameLocator('#joinLegal iframe').locator('.about-version').textContent(), 'Version ' + version);
    await page.locator('#closeJoinLegal').click();
    await page.locator('#roomAddress').fill('http://127.0.0.1:' + host.server.address().port); await page.locator('#joinRoom').click();
    await page.waitForSelector('#listenBtn'); await page.waitForFunction(() => document.getElementById('connStatus').textContent === 'Connecté');
    await page.locator('#listenBtn').click(); await page.waitForFunction(() => document.body.classList.contains('is-listening'));
    await page.waitForFunction(() => transportCodec === 'opus' && opusDecoder.decodedFrames > 5);
    await page.locator('#openAboutHeader').click();
    const about = page.frameLocator('#aboutModal iframe');
    await about.locator('.about-navigation a[href="#licences"]').click();
    await about.frameLocator('iframe').locator('.license-entry').first().waitFor();
    assert.equal(host.status().playing, true);
    assert.equal(await page.evaluate(() => document.body.classList.contains('is-listening')), true);
    await page.locator('#aboutModal .close-dialog').click();
    const next = browser.contexts()[0].waitForEvent('page'); await page.locator('#openMiniPlayer').click(); const mini = await next; await mini.waitForSelector('.mini-player');
    assert.deepEqual(await mini.evaluate(() => [innerWidth, innerHeight]), [320,216]);
    await mini.locator('[data-proxy=listenBtn]').click(); assert.equal(host.status().playing, true);
    await mini.locator('.mini-return').click(); await page.waitForFunction(() => document.getElementById('openMiniPlayer').getAttribute('aria-expanded') === 'false');
    await page.evaluate(() => window.close()); page = null;
    const deadline = Date.now() + 10000; while (child.exitCode === null && Date.now() < deadline) await pause(100);
    assert.equal(child.exitCode, 0, logs);
    console.log('EXE Auditeur portable : lancement autonome, connexion, audio, mini compact, pause locale et fermeture — OK');
  } finally { if (page && !page.isClosed()) await page.evaluate(() => window.close()).catch(() => {}); await browser?.close(); if (child && child.exitCode === null) child.kill(); await host.close(); }
})().catch(err => { console.error(err); process.exitCode = 1; });
