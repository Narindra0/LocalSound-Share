'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { youtubeVideoId, readYoutubeInfo } = require('../youtube-info');
const { createApp } = require('../server');
const { coverPng } = require('./media-fixture');
const id = 'jNQXAC9IVRw', url = 'https://www.youtube.com/watch?v='+id;
const fixtureFetch = async address => address.startsWith('https://www.youtube.com/oembed?')
  ? new Response(JSON.stringify({title:'Artiste - Chanson (Official Audio)',author_name:'Une chaîne',thumbnail_url:'https://i.ytimg.com/vi/'+id+'/hqdefault.jpg'}))
  : new Response(coverPng());
test('YouTube : liens acceptés et miniature récupérée sur les domaines attendus', async () => {
  for (const value of [url,'https://youtu.be/'+id+'?si=test','https://music.youtube.com/watch?v='+id,'https://www.youtube.com/shorts/'+id,'https://www.youtube.com/live/'+id,'https://www.youtube-nocookie.com/embed/'+id]) assert.equal(youtubeVideoId(value),id);
  for (const value of ['https://youtube.com.evil.example/watch?v='+id,'http://localhost/watch?v='+id,'https://www.youtube.com@localhost/watch?v='+id,'https://www.youtube.com:444/watch?v='+id,'https://youtube.com/playlist?list=test','https://youtu.be/short']) assert.equal(youtubeVideoId(value),null);
  const calls=[];
  const info=await readYoutubeInfo(url,(address,options)=>{calls.push(address);assert.equal(options.redirect,'error');return fixtureFetch(address)});
  assert.equal(info.title,'Artiste - Chanson');assert.equal(info.artist,'Une chaîne');assert.deepEqual(info.image,coverPng());
  assert.equal(calls.length,2);assert.equal(new URL(calls[0]).searchParams.get('url'),url);
  await assert.rejects(readYoutubeInfo(url,async()=>new Response(JSON.stringify({title:'Titre',thumbnail_url:'http://127.0.0.1/picture'}))),/miniature/);
  await assert.rejects(readYoutubeInfo(url,async()=>new Response('introuvable',{status:404})),/indisponible/);
});
test('YouTube : miniature partagée sans décaler l’audio, puis retirée au changement de vidéo', async t => {
  let update;
  const app=createApp({youtubeFetch:fixtureFetch,mediaInfo:{start(cb){update=cb},close(){}}});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));t.after(()=>app.close());
  const base='http://127.0.0.1:'+app.server.address().port;
  const snapshot=title=>({available:true,sessions:[{title,artist:'Artiste',appId:'msedge.exe',playing:true}]});
  update(snapshot('Artiste - Chanson (Official Video)'));
  const generation=app.status().generation;
  const apply=(body,origin)=>fetch(base+'/api/youtube',{method:'POST',headers:{'Content-Type':'application/json',...(origin?{Origin:origin}:{})},body:JSON.stringify(body)});
  assert.equal((await apply({url,generation},'https://example.com')).status,403);
  assert.equal((await apply({url,generation})).status,200);
  assert.equal(app.status().trackName,'Artiste - Chanson');assert.equal(app.status().nowPlaying.source,'youtube');
  const artwork=app.status().nowPlaying.artwork;assert.match(artwork,/^\/api\/artwork\//);
  assert.equal(app.status().generation,generation);
  assert.deepEqual(Buffer.from(await fetch(base+artwork).then(r=>r.arrayBuffer())),coverPng());
  update(snapshot('Artiste - Le morceau suivant (Clip officiel)'));
  assert.equal(app.status().trackName,'Artiste - Le morceau suivant');assert.equal(app.status().nowPlaying.artwork,null);
  assert.equal((await apply({url:'https://example.com/video',generation})).status,400);
  assert.equal(app.status().trackName,'Artiste - Le morceau suivant');
});
test('YouTube : une requête tardive ne remplace pas la nouvelle source', async t => {
  let release, entered; const pending=new Promise(resolve=>{release=resolve}), started=new Promise(resolve=>{entered=resolve});
  const app=createApp({youtubeFetch:async address=>{entered();await pending;return fixtureFetch(address)}});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));t.after(()=>app.close());
  const base='http://127.0.0.1:'+app.server.address().port;
  const generation=app.status().generation;
  const request=fetch(base+'/api/youtube',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url,generation})});
  // Attendre l’entrée dans le téléchargement, puis remplacer la source.
  await started;
  await fetch(base+'/api/source',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'system'})});
  release();assert.equal((await request).status,409);assert.equal(app.status().nowPlaying,null);
});
