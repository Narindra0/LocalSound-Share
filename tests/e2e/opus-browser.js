'use strict';
const assert = require('node:assert/strict');
const os = require('node:os');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createApp } = require('../../server');
(async () => {
  const app=createApp(); let browser;
  try {
    await new Promise(resolve=>app.server.listen(0,'0.0.0.0',resolve));
    const local='http://127.0.0.1:'+app.server.address().port;
    const address=Object.values(os.networkInterfaces()).flat().find(n=>n?.family==='IPv4'&&!n.internal)?.address || '127.0.0.1';
    const lan='http://'+address+':'+app.server.address().port;
    browser=await chromium.launch({channel:'msedge',headless:true});
    const context=await browser.newContext(), errors=[];
    const host=await context.newPage(); await host.goto(local+'/host');
    const pcm=Buffer.alloc(48000*4*30);
    for(let i=0;i<pcm.length/4;i++) { pcm.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*440/48000)*16000),i*4); pcm.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*660/48000)*16000),i*4+2); }
    assert.equal((await fetch(local+'/api/track',{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:pcm})).status,200);
    const pages=await Promise.all([0,1].map(async()=>{
      const page=await context.newPage(); page.on('pageerror',err=>errors.push(err.message));
      await page.goto(lan+'/listen'); await page.waitForFunction(()=>state?.sourceKind==='file');
      await page.locator('#listenBtn').click(); await page.waitForFunction(()=>transportCodec==='opus'&&opusReady);
      await page.evaluate(()=>{window.decodedBlocks=[];const push=syncPlayer.pushAt.bind(syncPlayer);syncPlayer.pushAt=(left,right,when)=>{
        window.decodedBlocks.push({frames:left.length,power:left.reduce((s,v)=>s+v*v,0)/left.length,stereo:left.some((v,i)=>Math.abs(v-right[i])>.05),ahead:when-audioCtx.currentTime});push(left,right,when);
      };}); return page;
    }));
    await fetch(local+'/api/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'play'})});
    for(const page of pages) await page.waitForFunction(()=>window.decodedBlocks.length>=80);
    for(const page of pages) {
      const data=await page.evaluate(()=>({blocks:window.decodedBlocks,stats:syncPlayer.stats(),codec:transportCodec,secure:isSecureContext}));
      assert.equal(data.codec,'opus'); assert.ok(data.blocks.every(b=>b.frames===960));
      assert.ok(data.blocks.filter(b=>b.power>.02&&b.stereo).length>60);
      assert.ok(data.blocks.filter(b=>b.ahead>.003&&b.ahead<.3).length/data.blocks.length>.9,JSON.stringify(data.stats));
      assert.ok(data.stats.skewMs<4);
    }
    assert.equal(app.status().network.opusListeners,2);
    await host.locator('#openSharingModal').click(); await host.locator('#sharingSettings summary').click();
    await host.locator('#networkMode').selectOption('standard'); await host.locator('#saveSharingSettings').click();
    await pages[0].waitForFunction(()=>state.network.mode==='standard');
    await host.locator('#networkMode').selectOption('economy'); await host.locator('#saveSharingSettings').click();
    await pages[0].waitForFunction(()=>state.network.mode==='economy');
    await pages[0].waitForFunction(()=>document.getElementById('kbps').textContent.match(/^1[01][0-9] kbit/));
    assert.equal(await pages[0].evaluate(()=>transportCodec),'opus');
    await host.locator('#networkMode').selectOption('original'); await host.locator('#saveSharingSettings').click();
    await pages[0].waitForFunction(()=>transportCodec==='pcm');
    await host.locator('#networkMode').selectOption('high'); await host.locator('#saveSharingSettings').click();
    await pages[0].waitForFunction(()=>transportCodec==='opus');
    const compatible = await context.newPage();
    await compatible.addInitScript(() => { window.Worker = undefined; });
    await compatible.goto(lan+'/listen'); await compatible.waitForFunction(()=>state?.sourceKind==='file');
    await compatible.locator('#listenBtn').click();
    await compatible.waitForFunction(()=>transportCodec==='pcm'&&syncPlayer.nodes.size>0);
    assert.match(await compatible.locator('#unsupported').textContent(),/compatible PCM/);
    assert.equal(app.status().network.pcmListeners,1);
    await pages[0].evaluate(()=>stopListening());
    await pages[1].waitForFunction(()=>listening&&state.playing);
    assert.deepEqual(errors,[]);
    console.log('Deux navigateurs sur HTTP LAN : décodage WASM stéréo, horloge commune, débit réduit, quatre qualités à chaud et pause individuelle — OK');
  } finally {await browser?.close();await app.close();}
})().catch(err=>{console.error(err);process.exitCode=1;});
