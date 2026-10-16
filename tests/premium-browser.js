'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { PNG } = require('pngjs');
const jsQR = require('jsqr');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createApp } = require('../server');
const { coverPng, taggedMp3 } = require('./media-fixture');
class Capture {
  startSystemAudio(callback) { this.timer=setInterval(()=>callback(Buffer.alloc(1920)),10); }
  stop() { clearInterval(this.timer); }
}
(async()=>{
  let browser, update;
  const app=createApp({Capture,mediaInfo:{start(cb){update=cb},close(){}}});
  try {
    await new Promise(resolve=>app.server.listen(0,'0.0.0.0',resolve));app.control('play');
    browser=await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio']});
    const context=await browser.newContext({viewport:{width:1366,height:768}});
    await context.addInitScript(()=>{
      window.testMediaActions={};
      if('mediaSession' in navigator){
        const native=navigator.mediaSession.setActionHandler.bind(navigator.mediaSession);
        navigator.mediaSession.setActionHandler=(action,handler)=>{window.testMediaActions[action]=handler;return native(action,handler)};
      }
    });
    const host=await context.newPage(),listener=await context.newPage(),errors=[];
    for(const page of [host,listener])page.on('pageerror',e=>errors.push(e.message));
    const base='http://127.0.0.1:'+app.server.address().port;
    await host.goto(base+'/host');
    await host.waitForFunction(()=>document.getElementById('connStatus').textContent==='Serveur en ligne');
    await host.locator('#openSharingModal').click();
    await host.waitForFunction(()=>{const img=document.getElementById('shareQr');return !img.hidden&&img.complete&&img.naturalWidth>0});
    const address=await host.locator('#shareAddress').inputValue();
    const png=PNG.sync.read(await host.locator('#shareQr').screenshot());
    const decoded=jsQR(new Uint8ClampedArray(png.data),png.width,png.height);
    assert.equal(decoded?.data,address+'/listen','Le scan ouvre explicitement la page auditeur');
    await host.screenshot({path:path.resolve('artifacts/interface/qr-desktop.png')});
    await listener.goto(decoded.data);
    await listener.waitForFunction(()=>document.getElementById('connStatus').textContent==='Connecté');
    assert.equal(await listener.locator('#listenBtn').isVisible(),true);
    update({available:true,sessions:[{title:'Le salon en couleurs',artist:'LocalSound Ensemble',appId:'msedge.exe',playing:true,artworkBase64:coverPng().toString('base64')}]});
    await listener.waitForFunction(()=>document.querySelector('.record-label').classList.contains('has-artwork'));
    assert.equal(await listener.locator('.record-artwork').evaluate(img=>img.complete&&img.naturalWidth>0),true);
    await listener.locator('#listenBtn').click();
    await listener.waitForFunction(()=>navigator.mediaSession?.playbackState==='playing');
    const metadata=await listener.evaluate(()=>({title:navigator.mediaSession.metadata.title,artist:navigator.mediaSession.metadata.artist,artwork:navigator.mediaSession.metadata.artwork[0]?.src}));
    assert.equal(metadata.title,'Le salon en couleurs');assert.equal(metadata.artist,'LocalSound Ensemble');assert.ok(metadata.artwork.startsWith(address+'/api/artwork/'));
    await listener.evaluate(()=>window.testMediaActions.pause());
    await listener.waitForFunction(()=>navigator.mediaSession.playbackState==='paused');assert.equal(app.status().playing,true);
    await listener.evaluate(()=>window.testMediaActions.play());
    await listener.waitForFunction(()=>navigator.mediaSession.playbackState==='playing');
    await listener.evaluate(()=>window.testMediaActions.stop());
    await listener.waitForFunction(()=>navigator.mediaSession.playbackState==='none');assert.equal(app.status().playing,true);
    await host.locator('#metadataSettings > summary').click();
    const automatic=app.status().nowPlaying.artwork;
    await host.locator('#coverFile').setInputFiles({name:'pochette.png',mimeType:'image/png',buffer:coverPng()});
    await host.waitForFunction(()=>document.getElementById('coverResult').textContent==='Pochette envoyée aux auditeurs.');
    assert.notEqual(app.status().nowPlaying.artwork,automatic,'L’image a été recadrée et compressée');
    await host.locator('#autoArtwork').click();
    await host.waitForFunction(()=>document.getElementById('coverResult').textContent==='Pochette automatique réactivée.');
    assert.equal(app.status().nowPlaying.artwork,automatic);
    await host.setViewportSize({width:390,height:844});
    await host.locator('#sharingModal').evaluate(el=>{el.scrollTop=0});
    await host.screenshot({path:path.resolve('artifacts/interface/qr-mobile.png')});
    assert.equal(await host.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await host.locator('#closeSharingModal').click();
    await host.locator('#chooseSourceBtn').click();
    await host.locator('#musicFile').setInputFiles({name:'nom-de-fichier.mp3',mimeType:'audio/mpeg',buffer:taggedMp3()});
    await host.waitForFunction(()=>document.getElementById('sourceLabel').textContent==='Le salon en couleurs');
    assert.equal(app.status().nowPlaying.source,'file');assert.equal(app.status().nowPlaying.artist,'LocalSound Ensemble');
    await listener.setViewportSize({width:390,height:844});
    await listener.waitForFunction(()=>document.querySelector('.record-label').classList.contains('has-artwork'));
    await listener.screenshot({path:path.resolve('artifacts/interface/cover-mobile.png'),fullPage:true});
    assert.equal(await listener.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await host.locator('#chooseSourceBtn').click();await host.locator('#sourceSystemBtn').click();
    update({available:true,sessions:[]});
    await listener.waitForFunction(()=>!document.querySelector('.record-label').classList.contains('has-artwork'));
    assert.deepEqual(errors,[]);
    console.log('QR réellement décodé → auditeur HTTP LAN ; pochettes Windows simulées, upload et MP3 réel ; commandes MediaSession locales ; mobile — OK');
  } finally {await browser?.close();await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
