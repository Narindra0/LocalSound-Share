'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createApp } = require('../../server');
(async () => {
  const app = createApp(); let browser;
  try {
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext(), page = await context.newPage();
    const base = 'http://127.0.0.1:' + app.server.address().port;
    for (const role of ['host', 'listen']) {
      await page.goto(base + '/' + role); await page.waitForSelector('#openAboutHeader');
      for (const [width, height] of [[1366, 768], [960, 560], [390, 844], [320, 568]]) {
        await page.setViewportSize({ width, height });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        if (width >= 960) assert.ok(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight));
        await page.locator('#openAboutHeader').click();
        const legal = page.frameLocator('#aboutModal iframe'); await legal.locator('#presentation').waitFor();
        assert.ok(await legal.locator('.legal-logo').evaluate(el => el.complete && el.naturalWidth > 0));
        assert.ok(await page.locator('#aboutModal').evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; }));
        assert.ok(await legal.locator('body').evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        assert.equal(await legal.locator('[data-about-panel]:visible').count(), 1);
        if (role === 'host' && [1366, 390].includes(width)) await page.screenshot({ path: path.resolve('artifacts/interface/legal-' + width + '.png') });
        for (const id of ['createur', 'cgu', 'confidentialite', 'mentions', 'licences', 'presentation']) {
          await legal.locator('.about-navigation a[href="#' + id + '"]').click();
          await legal.locator('#' + id).waitFor();
          assert.equal(await legal.locator('[data-about-panel]:visible').count(), 1);
          assert.equal(await legal.locator('a[aria-current="page"]').getAttribute('href'), '#' + id);
          assert.ok(await legal.locator('body').evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight));
          if (id === 'createur') assert.equal(await legal.locator('#createur h2').textContent(), 'Ranjalahy Narindra');
          if (id === 'licences') await legal.frameLocator('iframe').locator('.license-entry').first().waitFor();
        }
        await legal.locator('.about-navigation a').first().press('Escape');
        await page.waitForFunction(() => !document.getElementById('aboutModal').open);
        await page.locator('#openAbout').click();
        await page.locator('#aboutModal .close-dialog').click();
      }
    }
    console.log('Page À propos intégrée : six rubriques, licences, contacts, clavier, hôte et auditeur, desktop et mobile — OK');
  } finally { await browser?.close(); await app.close(); }
})().catch(err => { console.error(err); process.exitCode = 1; });
