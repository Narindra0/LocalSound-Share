'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createApp } = require('../server');
const { coverPng } = require('./media-fixture');
class Capture { startSystemAudio(cb) { this.timer = setInterval(() => cb(Buffer.alloc(1920)), 10); } stop() { clearInterval(this.timer); } }
(async () => {
  let browser, update;
  const id = 'jNQXAC9IVRw';
  const app = createApp({ Capture, mediaInfo: { start(cb) { update = cb; }, close() {} }, youtubeFetch: async url => url.startsWith('https://www.youtube.com/oembed?')
    ? new Response(JSON.stringify({ title: 'Artiste - Chanson (Official Audio)', author_name: 'La chaîne', thumbnail_url: 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg' })) : new Response(coverPng()) });
  try {
    await new Promise(resolve => app.server.listen(0, '0.0.0.0', resolve)); app.control('play');
    browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--mute-audio'] });
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    // Tester la fenêtre de repli réellement utilisée sur les connexions HTTP LAN.
    await context.addInitScript(() => Object.defineProperty(window, 'documentPictureInPicture', { value: undefined }));
    const errors = [], base = 'http://127.0.0.1:' + app.server.address().port;
    context.on('page', page => page.on('pageerror', err => errors.push(err.message)));
    const host = await context.newPage(), listener = await context.newPage();
    await host.goto(base + '/host'); await listener.goto(base + '/listen');
    await host.waitForFunction(() => document.getElementById('connStatus').textContent === 'Serveur en ligne');
    await listener.waitForFunction(() => document.getElementById('connStatus').textContent === 'Connecté');
    update({ available: true, sessions: [{ title: 'Notre morceau', artist: 'Ensemble', playing: true, appId: 'msedge.exe', artworkBase64: coverPng().toString('base64') }] });
    await listener.locator('#listenBtn').click();
    await listener.waitForFunction(() => document.body.classList.contains('is-listening'));
    const count = app.status().clients;
    const miniPromise = context.waitForEvent('page'); await listener.locator('#openMiniPlayer').click(); const mini = await miniPromise;
    await mini.waitForSelector('[data-mini-title]');
    await mini.waitForFunction(() => document.querySelector('[data-mini-title]').textContent === 'Notre morceau');
    await mini.waitForFunction(() => { const image = document.querySelector('.mini-disc img'); return !image.hidden && image.complete && image.naturalWidth > 0; });
    assert.equal(app.status().clients, count, 'Le mini-lecteur ne crée aucun abonnement audio');
    await mini.locator('input').fill('31'); await mini.locator('input').dispatchEvent('input');
    assert.equal(await listener.locator('#volume').inputValue(), '31');
    await mini.locator('[data-proxy=listenBtn]').click();
    await listener.waitForFunction(() => !document.body.classList.contains('is-joined'));
    assert.equal(app.status().playing, true, 'Une commande auditeur ne coupe pas le salon');
    await mini.locator('[data-proxy=listenBtn]').click();
    await listener.waitForFunction(() => document.body.classList.contains('is-joined'));
    await mini.screenshot({ path: path.resolve('artifacts/interface/mini-listener-desktop.png') });
    await mini.close(); await listener.waitForFunction(() => document.getElementById('openMiniPlayer').getAttribute('aria-expanded') === 'false');
    const hostMiniPromise = context.waitForEvent('page'); await host.locator('#openMiniPlayer').click(); const hostMini = await hostMiniPromise;
    await hostMini.waitForSelector('[data-proxy=pauseBtn]'); await hostMini.locator('[data-proxy=pauseBtn]').click();
    await host.waitForFunction(() => document.getElementById('streamState').textContent === 'En pause');
    await hostMini.locator('[data-proxy=playBtn]').click(); await host.waitForFunction(() => !document.getElementById('pauseBtn').disabled);
    await hostMini.screenshot({ path: path.resolve('artifacts/interface/mini-host-desktop.png') }); await hostMini.close();
    // Mobile : mini-lecteur local, commandes accessibles, pas de nouvelle fenêtre.
    await listener.setViewportSize({ width: 390, height: 844 }); await listener.locator('#openMiniPlayer').click();
    await listener.waitForSelector('.mini-inline');
    await listener.waitForFunction(() => { const image = document.querySelector('.mini-disc img'); return !image.hidden && image.complete && image.naturalWidth > 0; });
    assert.ok(await listener.locator('.mini-player').evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; }));
    await listener.screenshot({ path: path.resolve('artifacts/interface/mini-listener-mobile.png') });
    await listener.locator('[data-mini-close]').click();
    // Le lecteur intégré est testé avec un faux fournisseur : pas de dépendance au réseau YouTube.
    await context.route('https://www.youtube.com/iframe_api', route => route.fulfill({ contentType: 'application/javascript', body: `window.YT={Player:class{constructor(id,options){this.options=options;this.id=options.videoId;const frame=document.createElement('iframe');frame.id=id;frame.title='Lecteur YouTube';frame.srcdoc='<p>Lecteur YouTube de test</p>';document.getElementById(id).replaceWith(frame);window.testPlayer=this;setTimeout(()=>options.events.onReady(),0)}cueVideoById(id){this.id=id}getVideoUrl(){return 'https://www.youtube.com/watch?v='+this.id}destroy(){}}};window.onYouTubeIframeAPIReady();` }));
    await host.locator('#chooseSourceBtn').click(); await host.locator('#sourceYoutubeBtn').click();
    await host.locator('#embeddedYoutubeUrl').fill('https://youtu.be/' + id);
    const videoPromise = context.waitForEvent('page'); await host.locator('#youtubeSourceForm button[type=submit]').click(); const video = await videoPromise;
    await video.waitForSelector('iframe');
    assert.ok(video.url().startsWith(base + '/youtube-player.html'));
    await host.waitForFunction(() => document.getElementById('embeddedYoutubeUrl').value.startsWith('https://www.youtube.com/watch'));
    // Capture simulée : audio synthétique avec confirmation du silence local, même chemin PCM réel.
    await host.evaluate(() => {
      navigator.mediaDevices.getDisplayMedia = async () => {
        const ctx = new AudioContext(), dest = ctx.createMediaStreamDestination(), oscillator = ctx.createOscillator();
        oscillator.connect(dest); oscillator.start(); await ctx.resume();
        dest.stream.getAudioTracks()[0].getSettings = () => ({ suppressLocalAudioPlayback: true });
        dest.stream.getTracks()[0].addEventListener('ended', () => ctx.close());
        window.testCaptureContext = ctx;
        return dest.stream;
      };
    });
    await host.locator('#shareYoutubePlayer').click();
    await host.waitForFunction(() => document.getElementById('sourceLabel').textContent === 'Onglet partagé');
    await listener.waitForFunction(() => document.getElementById('sessionTitle').textContent === 'Artiste - Chanson');
    assert.equal(app.status().nowPlaying.source, 'youtube'); assert.equal(app.status().synchronized, true);
    await host.locator('#stopTabBtn').click();
    await host.evaluate(() => window.testCaptureContext.close());
    for (const page of [host, listener]) {
      for (const [width, height] of [[1366, 768], [960, 560], [390, 844], [320, 568]]) {
        await page.setViewportSize({ width, height });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Pas de débordement horizontal');
        if (width >= 960) assert.ok(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight), 'Pas de scroll desktop');
      }
    }
    await host.locator('#chooseSourceBtn').click(); await host.locator('#sourceYoutubeBtn').click();
    await host.screenshot({ path: path.resolve('artifacts/interface/youtube-source-mobile.png') });
    await video.setViewportSize({ width: 390, height: 844 }); await video.screenshot({ path: path.resolve('artifacts/interface/youtube-player-mobile.png') });
    await video.locator('#videoUrl').fill('https://example.com/'); await video.locator('#loadVideo').click();
    assert.match(await video.locator('#videoStatus').textContent(), /valide/);
    assert.deepEqual(errors, []);
    console.log('Mini-lecteurs hôte/auditeur, volume, commandes, mobile, YouTube et capture PCM simulée : OK');
  } finally { await browser?.close(); await app.close(); }
})().catch(err => { console.error(err); process.exitCode = 1; });
