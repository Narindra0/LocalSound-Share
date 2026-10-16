'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {createApp}=require('../../server');
const {coverPng}=require('../helpers/media-fixture');
class Capture{startSystemAudio(cb){this.timer=setInterval(()=>cb(Buffer.alloc(1920)),10)}stop(){clearInterval(this.timer)}}
(async()=>{
  let browser,update;
  const app=createApp({Capture,mediaInfo:{start(cb){update=cb},close(){}}});
  try{
    await new Promise(resolve=>app.server.listen(0,'0.0.0.0',resolve));app.control('play');
    browser=await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio']});
    const context=await browser.newContext({viewport:{width:1366,height:768}}),host=await context.newPage(),listener=await context.newPage(),errors=[];
    for(const page of [host,listener])page.on('pageerror',err=>errors.push(err.message));
    const base='http://127.0.0.1:'+app.server.address().port;
    await host.goto(base+'/host');await listener.goto((app.status().urls[0]||base)+'/listen');
    await host.waitForFunction(()=>document.getElementById('connStatus').textContent==='Serveur en ligne');
    update({available:true,sessions:[{title:'Le morceau du salon',artist:'LocalSound Ensemble',appId:'msedge.exe',playing:true,artworkBase64:coverPng().toString('base64')}]});
    await listener.locator('#listenBtn').click();await listener.waitForFunction(()=>document.body.classList.contains('is-listening'));
    const generation=app.status().generation;
    for(const [theme,palette] of [['vinyl','terracotta'],['cassette','forest'],['reel','plum'],['mp3','ocean'],['radio','terracotta'],['cd','ocean']]){
      await host.setViewportSize({width:1366,height:768});await host.locator('#openSharingModal').click();
      if(!await host.locator('#appearanceSettings').evaluate(el=>el.open))await host.locator('#appearanceSettings > summary').click();
      await host.locator('input[name=sessionTheme][value='+theme+']').check();await host.locator('input[name=sessionPalette][value='+palette+']').check();
      await host.waitForTimeout(1100);assert.equal(await host.locator('input[name=sessionTheme]:checked').inputValue(),theme,'La sélection résiste aux mises à jour');
      await host.locator('#saveAppearance').click();await host.waitForFunction(()=>document.getElementById('appearanceResult').textContent.includes('mémorisée'));
      await listener.waitForFunction(({theme,palette})=>document.body.dataset.theme===theme&&document.body.dataset.palette===palette,{theme,palette});
      await host.locator('#appearanceSettings').scrollIntoViewIfNeeded();await host.screenshot({path:path.resolve('artifacts/interface/theme-picker-'+theme+'.png')});
      await host.locator('#closeSharingModal').click();
      assert.equal(app.status().generation,generation);assert.equal(app.status().playing,true);
      const target={vinyl:'.record-label',cassette:'.cassette-cover',cd:'.cd-cover',reel:'.reel-cover',mp3:'.mp3-cover',radio:'.radio-cover'}[theme];
      await listener.waitForFunction(selector=>document.querySelector(selector).classList.contains('has-artwork'),target);
      assert.equal(await listener.locator(target+' .record-artwork').evaluate(el=>el.complete&&el.naturalWidth>0),true);
      const motion={vinyl:'.vinyl',cassette:'.tape-reel',cd:'.cd-disc',reel:'.open-reel',mp3:'.mp3-activity i',radio:'.radio-signal i'}[theme];
      assert.equal(await listener.locator(motion).first().evaluate(el=>getComputedStyle(el).animationPlayState),'running');
      await listener.emulateMedia({reducedMotion:'reduce'});assert.equal(await listener.locator(motion).first().evaluate(el=>getComputedStyle(el).animationName),'none');await listener.emulateMedia({reducedMotion:'no-preference'});
      for(const [width,height] of [[1920,1080],[1366,768],[1024,600],[960,560],[390,844],[320,568],[768,1024]]){
        for(const [role,page] of [['host',host],['listen',listener]]){
          await page.setViewportSize({width,height});
          const result=await page.evaluate(role=>{
            const ids=role==='host'?['playBtn','pauseBtn','stopBtn','chooseSourceBtn','openSharingModal','openRequestsModal']:['listenBtn','volume','resyncBtn','openRequestsModal'];
            return {sw:document.documentElement.scrollWidth,sh:document.documentElement.scrollHeight,controls:ids.map(id=>{const el=document.getElementById(id),r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {id,bottom:r.bottom,top:r.top,reachable:hit===el||el.contains(hit)}})};
          },role);
          assert.ok(result.sw<=width+1,`${theme} ${role} ${width}: débordement horizontal`);
          if(width>=960){assert.ok(result.sh<=height+1,`${theme} ${role} ${width}×${height}: défilement`);for(const c of result.controls)assert.ok(c.top>=0&&c.bottom<=height&&c.reachable,`${theme} ${c.id} recouvert`);}
          if(width===1366||width===390)await page.screenshot({path:path.resolve(`artifacts/interface/theme-${theme}-${role}-${width}.png`),fullPage:true,animations:'disabled'});
        }
      }
      console.log('Thème '+theme+' : partagé, pochette et sept formats — OK');
    }
    await listener.setViewportSize({width:390,height:844});
    await listener.getByRole('button',{name:'Mon style'}).click();
    for(const theme of ['reel','mp3','radio']){
      await listener.locator('input[name=personalThemeChoice][value='+theme+']').check();
      assert.equal(await listener.locator('body').getAttribute('data-theme'),theme);
      assert.equal(app.status().appearance.theme,'cd');
    }
    await listener.locator('input[name=personalThemeChoice][value=cassette]').check();
    await listener.locator('input[name=personalPaletteChoice][value=plum]').check();
    assert.equal(await listener.locator('body').getAttribute('data-theme'),'cassette');assert.equal(await listener.locator('body').getAttribute('data-palette'),'plum');
    assert.deepEqual(app.status().appearance,{theme:'cd',palette:'ocean'});
    await listener.locator('#personalStyleModal').evaluate(el=>{el.scrollTop=0});
    await listener.screenshot({path:path.resolve('artifacts/interface/personal-style-mobile.png')});
    await listener.keyboard.press('Escape');await listener.reload();
    await listener.waitForFunction(()=>document.body.dataset.theme==='cassette'&&document.body.dataset.palette==='plum'&&document.getElementById('connStatus').textContent==='Connecté');
    const otherContext=await browser.newContext(),other=await otherContext.newPage();
    await other.goto((app.status().urls[0]||base)+'/listen');await other.waitForFunction(()=>document.body.dataset.theme==='cd'&&document.body.dataset.palette==='ocean');await otherContext.close();
    await listener.getByRole('button',{name:'Mon style'}).click();await listener.locator('#resetPersonalAppearance').click();await listener.keyboard.press('Escape');
    assert.equal(await listener.locator('body').getAttribute('data-theme'),'cd');assert.equal(await listener.locator('body').getAttribute('data-palette'),'ocean');
    await listener.locator('#listenBtn').click();await listener.waitForFunction(()=>document.body.classList.contains('is-listening'));
    await listener.locator('#openAudioModal').click();await listener.locator('#personalTheme').selectOption('cassette');await listener.keyboard.press('Escape');
    assert.equal(await listener.locator('body').getAttribute('data-theme'),'cassette');assert.equal(app.status().appearance.theme,'cd');
    assert.equal(await listener.locator('.tape-reel').first().evaluate(el=>getComputedStyle(el).animationPlayState),'running');
    await listener.emulateMedia({reducedMotion:'reduce'});assert.equal(await listener.locator('.tape-reel').first().evaluate(el=>getComputedStyle(el).animationName),'none');
    await listener.emulateMedia({reducedMotion:'no-preference'});
    await listener.reload();await listener.waitForFunction(()=>document.body.dataset.theme==='cassette'&&document.getElementById('connStatus').textContent==='Connecté');
    assert.equal(await listener.locator('.tape-reel').first().evaluate(el=>getComputedStyle(el).animationPlayState),'paused');
    await listener.locator('#openAudioModal').click();await listener.locator('#personalTheme').selectOption('room');await listener.keyboard.press('Escape');
    assert.equal(await listener.locator('body').getAttribute('data-theme'),'cd');
    await listener.locator('#listenBtn').click();await listener.waitForFunction(()=>getComputedStyle(document.querySelector('.cd-disc')).animationPlayState==='running');
    await listener.emulateMedia({reducedMotion:'reduce'});assert.equal(await listener.locator('.cd-disc').evaluate(el=>getComputedStyle(el).animationName),'none');
    await listener.emulateMedia({reducedMotion:'no-preference'});
    await host.setViewportSize({width:1366,height:768});await host.locator('#pauseBtn').click();await listener.waitForFunction(()=>getComputedStyle(document.querySelector('.cd-disc')).animationPlayState==='paused');
    assert.deepEqual(errors,[]);
    console.log('Thèmes : choix personnel mémorisé, retour au salon, animations et réduction des mouvements — OK');
  }finally{await browser?.close();await app.close()}
})().catch(err=>{console.error(err);process.exitCode=1});
