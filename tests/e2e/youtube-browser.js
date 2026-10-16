'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createApp } = require('../../server');
const { coverPng } = require('../helpers/media-fixture');
class Capture {
  startSystemAudio(callback) { this.timer=setInterval(()=>callback(Buffer.alloc(1920)),10); }
  stop() { clearInterval(this.timer); }
}
(async()=>{
  let update, browser;
  const id='jNQXAC9IVRw';
  const app=createApp({Capture,mediaInfo:{start(cb){update=cb},close(){}},youtubeFetch:async url=>url.startsWith('https://www.youtube.com/oembed?')
    ? new Response(JSON.stringify({title:'Artiste - Chanson (Official Audio)',author_name:'La chaîne',thumbnail_url:'https://i.ytimg.com/vi/'+id+'/hqdefault.jpg'}))
    : new Response(coverPng())});
  const snapshot=(title,art=false)=>({available:true,sessions:[{title,artist:'Artiste',appId:'msedge.exe',playing:true,...(art?{artworkBase64:coverPng().toString('base64')}:{})}]});
  try {
    await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));app.control('play');
    browser=await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio']});
    const context=await browser.newContext({viewport:{width:1366,height:768}});
    const host=await context.newPage(),listener=await context.newPage(),errors=[];
    for(const page of [host,listener])page.on('pageerror',error=>errors.push(error.message));
    const base='http://127.0.0.1:'+app.server.address().port;
    await host.goto(base+'/host');await listener.goto(base+'/listen');
    await listener.waitForFunction(()=>document.getElementById('connStatus').textContent==='Connecté');
    update(snapshot('Artiste - Chanson (Clip officiel)',true));
    await listener.waitForFunction(()=>document.getElementById('sessionTitle').textContent==='Artiste - Chanson'&&document.querySelector('.record-label').classList.contains('has-artwork'));
    await host.waitForFunction(()=>document.getElementById('nowPlayingTitle').textContent==='Artiste - Chanson');
    assert.equal(await listener.evaluate(()=>navigator.mediaSession.metadata.title),'Artiste - Chanson');
    update(snapshot('Artiste - Chanson [Official Music Video]'));
    await listener.waitForFunction(()=>!document.querySelector('.record-label').classList.contains('has-artwork'));
    await host.locator('#openSharingModal').click();await host.locator('#metadataSettings > summary').click();
    await host.locator('#youtubeUrl').fill('https://youtu.be/'+id);
    const generation=app.status().generation;
    await host.locator('#importYoutube').click();
    await host.waitForFunction(()=>document.getElementById('youtubeResult').textContent==='Titre et miniature YouTube envoyés aux auditeurs.');
    await listener.waitForFunction(()=>document.querySelector('.record-label').classList.contains('has-artwork'));
    assert.equal(app.status().nowPlaying.source,'youtube');assert.equal(app.status().generation,generation);
    for(const page of [host,listener])assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await host.setViewportSize({width:390,height:844});
    await host.locator('#youtubeUrl').scrollIntoViewIfNeeded();
    await host.screenshot({path:path.resolve('artifacts/interface/youtube-settings-mobile.png')});
    await listener.setViewportSize({width:390,height:844});
    await listener.screenshot({path:path.resolve('artifacts/interface/youtube-clean-title-mobile.png'),fullPage:true});
    update(snapshot('Artiste - Nouveau morceau (Live) (Official Video)'));
    await listener.waitForFunction(()=>document.getElementById('sessionTitle').textContent==='Artiste - Nouveau morceau (Live)'&&!document.querySelector('.record-label').classList.contains('has-artwork'));
    await host.locator('#youtubeUrl').fill('http://localhost/video');await host.locator('#importYoutube').click();
    await host.waitForFunction(()=>document.getElementById('youtubeResult').textContent.includes('lien de vidéo YouTube valide'));
    assert.equal(app.status().trackName,'Artiste - Nouveau morceau (Live)');
    assert.deepEqual(errors,[]);
    console.log('YouTube : titre nettoyé, miniature automatique et lien de secours simulés, changement de vidéo, MediaSession et mobile — OK');
  } finally {await browser?.close();await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
