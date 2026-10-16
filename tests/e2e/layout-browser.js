'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createApp } = require('../../server');
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
    const page = await browser.newPage();
    const base = 'http://127.0.0.1:' + app.server.address().port;
    for (const [width, height] of [[1920,1080],[1440,900],[1366,768],[1280,720],[1024,600],[960,560],[320,568],[360,640],[390,844],[430,932],[768,1024],[844,390]]) {
      await page.setViewportSize({ width, height });
      for (const role of ['host', 'listen']) {
        await page.goto(base + '/' + role);
        await page.waitForFunction(role => document.getElementById('connStatus').textContent === (role === 'host' ? 'Serveur en ligne' : 'Connecté'), role);
        const check = async state => {
          const metrics = await page.evaluate(role => {
            const ids = role === 'host' ? ['playBtn','pauseBtn','stopBtn','chooseSourceBtn','openSharingModal','openDiagnosticModal'] : ['listenBtn','volume','resyncBtn','openAudioModal'];
            return { width:innerWidth, height:innerHeight, scrollWidth:document.documentElement.scrollWidth, scrollHeight:document.documentElement.scrollHeight,
              controls:ids.map(id => { const el = document.getElementById(id), r = el.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width/2, r.y + r.height/2); return { id, x:r.x, y:r.y, width:r.width, height:r.height, bottom:r.bottom, reachable:hit === el || el.contains(hit) }; }) };
          }, role);
          assert.ok(metrics.scrollWidth <= width + 1, `${role} ${width}×${height} ${state}: horizontal ${JSON.stringify(metrics)}`);
          if (width >= 960 && height >= 560) {
            assert.ok(metrics.scrollHeight <= height + 1, `${role} ${width}×${height} ${state}: vertical ${JSON.stringify(metrics)}`);
            for (const c of metrics.controls) assert.ok(c.y >= 0 && c.bottom <= height && c.width > 0 && c.reachable, `${c.id} hors écran ou recouvert`);
          }
        };
        await check('initial');
        if (role === 'host') {
          await page.locator('#stopTabBtn').evaluate(el => { el.hidden = false; });
          await check('partage en cours');
          await page.locator('#stopTabBtn').evaluate(el => { el.hidden = true; });
        } else {
          await page.locator('#listenBtn').click();
          await page.waitForFunction(() => document.body.classList.contains('is-joined'));
          await check('écoute');
          await page.locator('#syncNotice').evaluate(el => { el.hidden = false; });
          await check('synchronisé');
        }
        if ((width === 1366 && height === 768) || width === 390) await page.screenshot({ path:path.join(output,`${role}-responsive-${width}.png`), fullPage:true, animations:'disabled' });
        const open = role === 'host' ? '#openSharingModal' : '#openAudioModal';
        const dialog = role === 'host' ? '#sharingModal' : '#audioModal';
        await page.locator(open).click();
        assert.equal(await page.locator(dialog).isVisible(), true);
        const bounds = await page.locator(dialog).boundingBox();
        assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y + bounds.height <= height + 1, 'Modale hors écran');
        await page.keyboard.press('Escape');
        await page.evaluate(role => {
          document.getElementById(role === 'host' ? 'sourceLabel' : 'sessionTitle').textContent = 'Une longue compilation de musique pour partager un moment ensemble — '.repeat(4);
        }, role);
        await check('titre long');
      }
      console.log(`Disposition ${width}×${height} : OK`);
    }
  } finally { await browser?.close(); await app.close(); }
})().catch(err => { console.error(err); process.exitCode = 1; });
