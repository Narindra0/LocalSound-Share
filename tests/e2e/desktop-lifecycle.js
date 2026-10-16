'use strict';
const assert = require('node:assert/strict');
const http = require('node:http'), path = require('node:path');
const { _electron } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createApp } = require('../../server');
async function launch(port, profile) {
  const env = { ...process.env, PORT: String(port), LOCALSOUND_DESKTOP_TEST: '1', LOCALSOUND_DESKTOP_PROFILE: path.resolve('artifacts/' + profile) }; delete env.ELECTRON_RUN_AS_NODE;
  const desktop = await _electron.launch({ executablePath: require('electron'), args: [path.resolve('desktop/main.js')], env });
  const host = await desktop.firstWindow(); await host.waitForFunction(() => document.getElementById('connStatus')?.textContent === 'Serveur en ligne');
  return { desktop, base: new URL(host.url()).origin };
}
(async () => {
  let desktop, blocker, shared;
  try {
    blocker = http.createServer((_req, res) => res.end('{}'));
    await new Promise(resolve => blocker.listen(0, '0.0.0.0', resolve));
    const occupied = blocker.address().port;
    let run = await launch(occupied, 'desktop-port-test-profile'); desktop = run.desktop;
    assert.notEqual(Number(new URL(run.base).port), occupied);
    assert.equal((await (await fetch(run.base + '/api/status')).json()).error, null);
    await desktop.close(); desktop = null;
    await assert.rejects(fetch(run.base + '/api/status', { signal: AbortSignal.timeout(1000) }));
    await new Promise(resolve => blocker.close(resolve)); blocker = null;
    shared = createApp(); await new Promise(resolve => shared.server.listen(0, '0.0.0.0', resolve));
    const port = shared.server.address().port;
    run = await launch(port, 'desktop-reuse-test-profile'); desktop = run.desktop;
    assert.equal(Number(new URL(run.base).port), port);
    await desktop.close(); desktop = null;
    assert.equal((await fetch(run.base + '/api/status')).status, 200, 'Le serveur existant reste disponible après fermeture');
    console.log('Desktop : port occupé géré, serveur créé arrêté, serveur existant réutilisé et conservé — OK');
  } finally { await desktop?.close(); await shared?.close(); if (blocker) await new Promise(resolve => blocker.close(resolve)); }
})().catch(err => { console.error(err); process.exitCode = 1; });
