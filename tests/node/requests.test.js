'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { WebSocket } = require('ws');
const { createSongRequests } = require('../../song-requests');
const { createApp } = require('../../server');
test('demandes : validation, doublons, cadence, modération et historique borné', () => {
  let time=0;const queue=createSongRequests({now:()=>time});
  assert.throws(()=>queue.add({title:'',name:''},'a'),{status:400});
  assert.throws(()=>queue.add({title:'Titre',url:'javascript:alert(1)'},'a'),{status:400});
  const item=queue.add({title:'Artiste - Morceau',name:'Léa',url:'https://youtu.be/jNQXAC9IVRw?si=tracking'},'a');
  assert.equal(item.url,'https://www.youtube.com/watch?v=jNQXAC9IVRw');
  assert.throws(()=>queue.add({title:'Autre titre',url:item.url},'b'),{status:409});
  assert.throws(()=>queue.add({title:'artiste - morceau'},'b'),{status:409});
  assert.throws(()=>queue.add({title:'Un autre morceau'},'a'),{status:429});
  assert.throws(()=>queue.update(item.id,'played'),{status:409});
  queue.update(item.id,'accepted');assert.equal(queue.snapshot().count,1);
  queue.update(item.id,'played');assert.equal(queue.snapshot().count,0);
  assert.throws(()=>queue.update(item.id,'accepted'),{status:409});
  for(let i=0;i<12;i++){time+=10000;const next=queue.add({title:'Morceau '+i},'a');queue.update(next.id,'declined');}
  assert.equal(queue.snapshot().items.length,10);
  for(let i=0;i<30;i++){time+=10000;queue.add({title:'À suivre '+i},'a');}
  assert.equal(queue.snapshot().count,30);
  assert.throws(()=>queue.add({title:'Au-delà'},'b'),{status:409});
});
test('demandes : proposition publique, diffusion WebSocket et décisions réservées à l’hôte', async t => {
  const app=createApp();await new Promise(resolve=>app.server.listen(0,'0.0.0.0',resolve));t.after(()=>app.close());
  const base='http://127.0.0.1:'+app.server.address().port;
  const ws=new WebSocket(base.replace('http:','ws:'));t.after(()=>ws.terminate());await once(ws,'open');
  ws.send(JSON.stringify({type:'hello',role:'client'}));
  const request=(route,method,body,origin)=>fetch(base+route,{method,headers:{'Content-Type':'application/json',...(origin?{Origin:origin}:{})},body:JSON.stringify(body)});
  assert.equal((await request('/api/requests','POST',{title:'Test'},'https://example.com')).status,403);
  const broadcast=new Promise(resolve=>ws.on('message',data=>{const value=JSON.parse(data);if(value.type==='requests'&&value.count===1)resolve(value)}));
  const response=await request('/api/requests','POST',{title:'Le prochain morceau',name:'Léa'});assert.equal(response.status,201);
  const data=await response.json();assert.equal((await broadcast).items[0].title,'Le prochain morceau');
  const id=data.item.id,generation=app.status().generation;
  const lan=app.status().urls[0];
  if(lan)assert.equal((await fetch(lan+'/api/requests/'+id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'accepted'})})).status,403);
  assert.equal((await request('/api/requests/'+id,'PATCH',{status:'accepted'})).status,200);
  const snapshot=await fetch(base+'/api/requests').then(r=>r.json());assert.equal(snapshot.items[0].status,'accepted');
  assert.equal(app.status().generation,generation);
  assert.equal((await request('/api/requests/'+id,'PATCH',{status:'played'})).status,200);
  assert.equal((await fetch(base+'/api/requests').then(r=>r.json())).count,0);
});
