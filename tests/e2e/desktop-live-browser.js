'use strict';
const assert = require('node:assert/strict');
const path = require('node:path'), fs = require('node:fs');
const { _electron } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  let desktop;
  try {
    const env = { ...process.env, PORT: '0', LOCALSOUND_DESKTOP_TEST: '1', LOCALSOUND_DESKTOP_PROFILE: path.resolve('artifacts/desktop-live-test-profile') };
    delete env.ELECTRON_RUN_AS_NODE;
    desktop = await _electron.launch({ executablePath: require('electron'), args: [path.resolve('desktop/main.js')], env });
    const host = await desktop.firstWindow();
    await host.waitForFunction(() => document.getElementById('connStatus')?.textContent === 'Serveur en ligne');
    await host.evaluate(() => window.localsoundDesktop.openYoutube('https://www.youtube.com/'));
    const result = await desktop.evaluate(async ({ webContents }) => {
      const until = Date.now() + 18000; let source;
      while (Date.now() < until) {
        source = webContents.getAllWebContents().find(wc => wc.getURL().startsWith('https://www.youtube.com/'));
        if (source && !source.isLoading()) break;
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      if (!source) throw new Error('Vue YouTube absente.');
      return { url: source.getURL(), title: source.getTitle(), hasContent: await source.executeJavaScript('Boolean(document.querySelector("ytd-app,ytm-app"))') };
    });
    console.log(JSON.stringify(result)); assert.equal(result.hasContent, true, 'Le vrai site YouTube est chargé');
    const shot = await desktop.evaluate(async ({ webContents }) => (await webContents.getAllWebContents().find(wc => wc.getURL().startsWith('https://www.youtube.com/')).capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG().toString('base64'));
    fs.writeFileSync(path.resolve('artifacts/interface/desktop-youtube-live.png'), Buffer.from(shot, 'base64'));
  } finally { await desktop?.close(); }
})().catch(err => { console.error(err); process.exitCode = 1; });
