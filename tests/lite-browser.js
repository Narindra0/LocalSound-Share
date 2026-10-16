'use strict';
const assert = require('node:assert/strict');
const path = require('node:path'), net = require('node:net');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createApp } = require('../server');
const pause = ms => new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
  const host=createApp(); let child,browser,page;
  try {
    await new Promise(resolve=>host.server.listen(0,'127.0.0.1',resolve));
    const base='http://127.0.0.1:'+host.server.address().port;
    const pcm=Buffer.alloc(48000*4*30);for(let i=0;i<pcm.length/4;i++){pcm.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*440/48000)*15000),i*4);pcm.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*660/48000)*15000),i*4+2);}
    await fetch(base+'/api/track',{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:pcm});host.control('play');
    const reserve=net.createServer();await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));const debug=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));
    const version=require('../package.json').version;
    child=spawn(path.resolve('release/auditeur-leger/LocalSound-Auditeur-Leger-'+version+'-Windows-x64.exe'),[],{
      windowsHide:true,env:{...process.env,LOCALSOUND_LITE_PROFILE:path.resolve('artifacts/lite-test-profile'),LOCALSOUND_LITE_TEST_PORT:String(debug)},stdio:['ignore','pipe','pipe']
    });
    let logs='';child.on('error',err=>logs+=err.message);for(const stream of [child.stdout,child.stderr])stream.on('data',data=>logs+=data);
    const until=Date.now()+30000;let ready=false;while(Date.now()<until){try{ready=(await fetch('http://127.0.0.1:'+debug+'/json/version',{signal:AbortSignal.timeout(700)})).ok;if(ready)break;}catch(_){}await pause(100);}
    assert.ok(ready,'Le lecteur WebView2 doit démarrer : '+logs);
    browser=await chromium.connectOverCDP('http://127.0.0.1:'+debug);
    for(let i=0;i<100;i++){page=browser.contexts()[0].pages().find(p=>p.url().includes('/listener-connect.html'));if(page)break;await pause(100);}
    assert.ok(page);await page.waitForSelector('#joinRoom');
    await page.locator('#openJoinLegal').click();await page.frameLocator('#joinLegal iframe').locator('#presentation').waitFor();await page.locator('#closeJoinLegal').click();
    await page.locator('#roomAddress').fill('http://127.0.0.1:1');await page.locator('#joinRoom').click();await page.waitForFunction(()=>!document.getElementById('joinRoom').disabled);assert.match(await page.locator('#joinStatus').textContent(),/injoignable/);
    await page.locator('#roomAddress').fill(base);await page.locator('#joinRoom').click();await page.waitForSelector('#listenBtn');
    await page.waitForFunction(()=>state?.sourceKind==='file');await page.locator('#listenBtn').click();await page.waitForFunction(()=>transportCodec==='opus'&&opusDecoder.decodedFrames>10);
    const clients=host.status().clients;
    await page.locator('#openMiniPlayer').click();await page.waitForSelector('.mini-native-embedded');
    const native=await page.evaluate(()=>window.localsoundListener.nativeState());assert.equal(native.compact,true);assert.equal(native.top,true);assert.equal(native.maximize,false);assert.equal(native.resize,false);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight),true,'Le mini-lecteur doit tenir dans la fenêtre.');
    assert.equal(host.status().clients,clients);assert.equal(browser.contexts()[0].pages().length,1);
    await page.screenshot({path:path.resolve('artifacts/interface/listener-lite-mini.png')});
    await page.locator('.mini-player input').fill('31');await page.locator('.mini-player input').dispatchEvent('input');assert.equal(await page.locator('#volume').inputValue(),'31');
    await page.locator('.mini-player [data-proxy=listenBtn]').click();await page.waitForFunction(()=>!listening);assert.equal(host.status().playing,true);
    await page.locator('.mini-return').click();assert.equal((await page.evaluate(()=>window.localsoundListener.nativeState())).compact,false);
    await page.locator('#changeListenerRoom').click();await page.waitForSelector('#joinRoom');assert.equal(await page.locator('#roomAddress').inputValue(),base);
    await page.evaluate(()=>window.localsoundListener.testExit());page=null;const deadline=Date.now()+10000;while(child.exitCode===null&&Date.now()<deadline)await pause(100);assert.equal(child.exitCode,0,logs);
    console.log('EXE WebView2 léger : connexion, CGU hors ligne, lecture Opus synchronisée, mini unique fixe et au premier plan, volume, pause locale, changement de salon et fermeture — OK');
  } finally {if(page&&!page.isClosed())await page.evaluate(()=>window.close()).catch(()=>{});await browser?.close();if(child&&child.exitCode===null)child.kill();await host.close();}
})().catch(err=>{console.error(err);process.exitCode=1;});
