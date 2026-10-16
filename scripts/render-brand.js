'use strict';
const fs = require('node:fs'), path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const dir = path.resolve(__dirname, '../public/branding');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    const svg = fs.readFileSync(path.join(dir, 'icon.svg'), 'utf8');
    const images = [];
    for (const size of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) {
      await page.setViewportSize({ width: size, height: size });
      await page.setContent('<style>html,body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style>' + svg);
      const png = await page.screenshot({ omitBackground: true });
      fs.writeFileSync(path.join(dir, 'icon-' + size + '.png'), png);
      if (size <= 256) images.push({ size, png });
    }
    const header = Buffer.alloc(6 + images.length * 16); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
    let offset = header.length;
    images.forEach(({ size, png }, i) => {
      const pos = 6 + i * 16; header[pos] = header[pos + 1] = size === 256 ? 0 : size;
      header.writeUInt16LE(1, pos + 4); header.writeUInt16LE(32, pos + 6); header.writeUInt32LE(png.length, pos + 8); header.writeUInt32LE(offset, pos + 12); offset += png.length;
    });
    fs.writeFileSync(path.join(dir, 'icon.ico'), Buffer.concat([header, ...images.map(item => item.png)]));
    await page.setViewportSize({ width: 1120, height: 280 });
    await page.setContent('<style>html,body{margin:0;background:transparent}svg{display:block}</style>' + fs.readFileSync(path.join(dir, 'logo.svg'), 'utf8'));
    fs.writeFileSync(path.join(dir, 'logo.png'), await page.screenshot({ omitBackground: true }));
    console.log('Logo SVG/PNG et icône Windows multi-résolution générés.');
  } finally { await browser.close(); }
})().catch(err => { console.error(err); process.exitCode = 1; });
