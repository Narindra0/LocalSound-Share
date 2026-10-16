'use strict';
const assert = require('node:assert/strict');
const path = require('node:path'), net = require('node:net');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
async function freePort() {
  const socket = net.createServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve)); return port;
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  let child, browser, host;
  try {
    const port = await freePort(), debugPort = await freePort();
    const env = { ...process.env, PORT: String(port), LOCALSOUND_DESKTOP_TEST: '1', LOCALSOUND_DESKTOP_PROFILE: path.resolve('artifacts/portable-test-profile') }; delete env.ELECTRON_RUN_AS_NODE;
    child = spawn(path.resolve('release/LocalSound-Share-' + require('../package.json').version + '-Windows-x64.exe'), ['--remote-debugging-port=' + debugPort], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let logs = ''; for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { logs = (logs + data).slice(-8000); });
    child.on('error', err => { logs += err.message; });
    const base = 'http://127.0.0.1:' + port; let state;
    const until = Date.now() + 60000;
    while (Date.now() < until) {
      try { const response = await fetch(base + '/api/status', { signal: AbortSignal.timeout(800) }); state = await response.json(); break; } catch (_) { await delay(250); }
    }
    assert.ok(state, 'Le .exe doit démarrer son serveur : ' + logs);
    assert.equal(state.application, 'localsound-share'); assert.equal(state.sourceReady, true);
    browser = await chromium.connectOverCDP('http://127.0.0.1:' + debugPort);
    host = browser.contexts()[0].pages().find(page => page.url().startsWith(base));
    assert.ok(host); await host.waitForSelector('#openAbout'); await host.locator('#openAbout').click();
    await host.frameLocator('#aboutModal iframe').locator('#presentation').waitFor();
    assert.equal(await host.frameLocator('#aboutModal iframe').locator('.about-version').textContent(), 'Version ' + require('../package.json').version);
    await host.frameLocator('#aboutModal iframe').locator('.about-navigation a[href="#createur"]').click();
    await host.frameLocator('#aboutModal iframe').locator('#createur h2').waitFor();
    assert.equal(await host.frameLocator('#aboutModal iframe').locator('#createur h2').textContent(), 'Ranjalahy Narindra');
    assert.equal((await fetch(base + '/branding/icon.ico')).status, 200);
    assert.equal((await fetch(base + '/licenses/LGPL-3.0.txt')).status, 200);
    await host.evaluate(() => window.close()); host = null;
    const deadline = Date.now() + 10000; while (child.exitCode === null && Date.now() < deadline) await delay(100);
    assert.equal(child.exitCode, 0, logs);
    console.log('Fichier portable .exe : extraction, lancement autonome, interface, icône, auteur, licences et fermeture — OK');
  } finally { if (host && !host.isClosed()) await host.evaluate(() => window.close()).catch(() => {}); await browser?.close(); if (child && child.exitCode === null) child.kill(); }
})().catch(err => { console.error(err); process.exitCode = 1; });
