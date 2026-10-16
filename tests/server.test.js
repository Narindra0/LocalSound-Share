'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createApp, splitStereo } = require('../server');
const { WebSocket } = require('ws');
const { Mp3Encoder } = require('../mp3shim');
const { spawn } = require('node:child_process');
const path = require('node:path');

async function fixture(t, options = {}) {
  let emit;
  class Capture { startSystemAudio(cb) { emit = cb; } stop() {} }
  const instance = createApp({ Capture, ...options });
  await new Promise(resolve => instance.server.listen(0, '127.0.0.1', resolve));
  t.after(() => instance.close());
  const base = 'http://127.0.0.1:' + instance.server.address().port;
  return { ...instance, base, emit: chunk => emit(chunk) };
}
function message(ws, type, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { ws.off('message', receive); reject(new Error('Message absent : ' + type)); }, 2000);
    function receive(data, binary) {
      const value = binary ? data : JSON.parse(data);
      if (((binary && type === 'binary') || value.type === type) && predicate(value)) {
        clearTimeout(timeout); ws.off('message', receive); resolve(value);
      }
    }
    ws.on('message', receive);
  });
}

test('démarrage sur un port occupé : message lisible et fermeture sans erreur non gérée', async t => {
  const app = createApp();
  await new Promise(resolve => app.server.listen(0, '0.0.0.0', resolve));
  t.after(() => app.close());
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(app.server.address().port) },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const timeout = setTimeout(() => child.kill(), 10000);
  t.after(() => clearTimeout(timeout));
  const [code] = await once(child, 'close');
  assert.equal(code, 1, output);
  assert.match(output, /Le port \d+ est déjà utilisé/);
  assert.doesNotMatch(output, /Unhandled|node:events|Emitted 'error'/);
  assert.equal((await fetch(base + '/host')).status, 200, 'La première instance reste accessible');
});

test('titres : publication immédiate, correction hôte, changement de morceau et de source', async t => {
  let update, closed = false;
  const app = await fixture(t, { mediaInfo: { start(cb) { update = cb; }, close() { closed = true; } } });
  const listener = new WebSocket(app.base.replace('http:', 'ws:'));
  t.after(() => listener.terminate()); await once(listener, 'open');
  const snapshot = title => ({ available:true, sessions:[{ title, artist:'Une chaîne', appId:'msedge.exe', playing:true }] });
  let reply = message(listener, 'state', s => s.trackName === 'Premier titre');
  update(snapshot('Premier titre')); assert.equal((await reply).nowPlaying.artist, 'Une chaîne');
  const generation = app.status().generation;
  const request = (body, origin) => fetch(app.base + '/api/now-playing', { method:'POST', headers:{ 'Content-Type':'application/json', ...(origin ? { Origin:origin } : {}) }, body:JSON.stringify(body) });
  assert.equal((await request({ mode:'manual', title:'Correction', artist:'Auteur', generation }, 'https://example.com')).status, 403);
  assert.equal((await request({ mode:'manual', title:'', artist:'', generation })).status, 400);
  assert.equal((await request({ mode:'manual', title:'x'.repeat(201), artist:'', generation })).status, 400);
  assert.equal((await request({ mode:'manual', title:'Correction', artist:'Auteur', generation })).status, 200);
  update(snapshot('Deuxième titre'));
  assert.equal(app.status().trackName, 'Correction');
  assert.equal(app.status().generation, generation, 'Le titre ne recale pas l’audio');
  await request({ mode:'auto', generation });
  assert.equal(app.status().trackName, 'Deuxième titre');
  await fetch(app.base + '/api/track', { method:'PUT', headers:{ 'Content-Type':'application/octet-stream', 'X-Track-Name':encodeURIComponent('Notre morceau.wav') }, body:Buffer.alloc(1920) });
  assert.equal(app.status().trackName, 'Notre morceau');
  assert.equal((await request({ mode:'manual', title:'Ancienne correction', artist:'', generation })).status, 409);
  await fetch(app.base + '/api/source', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ kind:'system' }) });
  assert.equal(app.status().trackName, 'Deuxième titre', 'Aucun ancien nom de fichier sur la source système');
  update({ available:true, sessions:[] }); assert.equal(app.status().trackName, null);
  await app.close(); assert.equal(closed, true);
});
test('sépare les canaux stéréo sans décalage ni rééchantillonnage', () => {
  const data = Buffer.alloc(9);
  [12000, -5000, -32768, 32767].forEach((v, i) => data.writeInt16LE(v, i * 2));
  const { left, right } = splitStereo(data);
  assert.deepEqual([...left], [12000, -32768]);
  assert.deepEqual([...right], [-5000, 32767]);
});
test('pages, commandes, pause et arrêt', async t => {
  const app = await fixture(t);
  for (const page of ['/', '/host', '/client.js', '/worklet.js']) assert.equal((await fetch(app.base + page)).status, 200);
  async function control(action, origin) {
    return fetch(app.base + '/api/control', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify({ action }) });
  }
  assert.equal((await control('invalid')).status, 400);
  assert.equal((await control('play', 'http://example.com')).status, 403);
  assert.equal((await control('play')).status, 200);
  assert.equal(app.status().playing, true);
  await control('pause'); assert.equal(app.status().playing, false); assert.equal(app.status().active, true);
  await control('stop'); assert.equal(app.status().active, false);
  assert.equal((await fetch(app.base + '/stream.mp3')).status, 409);
});
test('WebSocket : abonnement PCM, reprise et désabonnement', async t => {
  const app = await fixture(t); app.control('play');
  const ws = new WebSocket(app.base.replace('http:', 'ws:'));
  t.after(() => ws.terminate()); await once(ws, 'open');
  let reply = message(ws, 'meta'); ws.send(JSON.stringify({ type: 'hello', role: 'client' })); await reply;
  assert.equal(app.status().clients, 0);
  reply = message(ws, 'state'); ws.send(JSON.stringify({ type: 'listen' })); await reply;
  assert.equal(app.status().clients, 1);
  const pcm = Buffer.from([1, 0, 2, 0, 3, 0, 4, 0]);
  reply = message(ws, 'binary'); app.emit(pcm); assert.deepEqual(await reply, pcm);
  assert.equal(app.status().signal, true);
  app.control('pause'); app.emit(pcm); assert.equal(app.status().playing, false);
  app.control('play'); reply = message(ws, 'binary'); app.emit(pcm); assert.deepEqual(await reply, pcm);
  reply = message(ws, 'state'); ws.send(JSON.stringify({ type: 'unlisten' })); await reply;
  assert.equal(app.status().clients, 0);
});
test('MP3 : même bloc envoyé aux deux auditeurs avec un seul encodage', async t => {
  let calls = 0;
  class Encoder { encodeBuffer(left, right) { calls++; assert.equal(left[0], 12); assert.equal(right[0], -34); return new Int8Array([1, 2, 3]); } }
  const app = await fixture(t, { Encoder }); app.control('play');
  const controllers = [new AbortController(), new AbortController()];
  t.after(() => controllers.forEach(c => c.abort()));
  const responses = await Promise.all(controllers.map(c => fetch(app.base + '/stream.mp3', { signal: c.signal })));
  assert.equal(responses[0].headers.get('content-type'), 'audio/mpeg');
  assert.equal(app.status().clients, 2);
  const reads = responses.map(r => r.body.getReader().read());
  const pcm = Buffer.alloc(4); pcm.writeInt16LE(12); pcm.writeInt16LE(-34, 2); app.emit(pcm);
  const results = await Promise.all(reads);
  assert.equal(calls, 1); for (const result of results) assert.deepEqual([...result.value], [1, 2, 3]);
  app.control('pause'); assert.equal(app.status().clients, 0);
});
test('protocole faible latence : horloge, timestamp et séquence des paquets PCM', async t => {
  const app = await fixture(t); app.control('play');
  const ws = new WebSocket(app.base.replace('http:', 'ws:'));
  t.after(() => ws.terminate()); await once(ws, 'open');
  let reply = message(ws, 'meta'); ws.send(JSON.stringify({ type: 'hello', role: 'client', protocol: 1 })); await reply;
  reply = message(ws, 'pong'); ws.send(JSON.stringify({ type: 'ping', clientTime: 1234 }));
  const pong = await reply; assert.equal(pong.clientTime, 1234); assert.ok(Number.isFinite(pong.serverTime));
  reply = message(ws, 'state'); ws.send(JSON.stringify({ type: 'listen' })); await reply;
  const pcm = Buffer.alloc(1920);
  reply = message(ws, 'binary'); const before = performance.now(); app.emit(pcm); const first = await reply;
  assert.equal(first.subarray(0, 4).toString(), 'LSP1');
  assert.deepEqual(first.subarray(16), pcm);
  assert.ok(first.readDoubleLE(8) >= before && first.readDoubleLE(8) <= performance.now());
  reply = message(ws, 'binary'); app.emit(pcm); const second = await reply;
  assert.equal(second.readUInt32LE(4), first.readUInt32LE(4) + 1);
});
test('encodeur réel : produit un flux MP3 à 48 kHz', () => {
  assert.ok(Mp3Encoder);
  const encoder = new Mp3Encoder(2, 48000, 128);
  const left = new Int16Array(4800), right = new Int16Array(4800);
  for (let i = 0; i < left.length; i++) { left[i] = Math.sin(i * 2 * Math.PI * 440 / 48000) * 10000; right[i] = -left[i]; }
  const data = Buffer.concat([Buffer.from(encoder.encodeBuffer(left, right)), Buffer.from(encoder.flush())]);
  assert.ok(data.length > 1000); assert.equal(data[0], 255); assert.equal(data[1] & 0xe0, 0xe0);
});
test('capture absente : état stable et erreur explicite', async t => {
  const app = await fixture(t, { Capture: null });
  assert.throws(() => app.control('play'), /Module de capture indisponible/);
  assert.equal(app.status().active, false); assert.equal(app.status().playing, false);
});
test('fichier synchronisé : échéance commune, pause/reprise et retour à WASAPI', async t => {
  const app = await fixture(t); app.control('play');
  const ws = new WebSocket(app.base.replace('http:', 'ws:'));
  t.after(() => ws.terminate()); await once(ws, 'open');
  let reply = message(ws, 'meta'); ws.send(JSON.stringify({ type: 'hello', role: 'client', protocol: 2 })); await reply;
  reply = message(ws, 'state'); ws.send(JSON.stringify({ type: 'listen' })); await reply;
  const pcm = Buffer.alloc(48000 * 4); pcm.writeInt16LE(1234);
  const response = await fetch(app.base + '/api/track', { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'X-Track-Name': 'test.wav' }, body: pcm });
  assert.equal(response.status, 200); assert.equal(app.status().sourceKind, 'file');
  assert.equal(app.status().synchronized, true);
  reply = message(ws, 'binary'); app.control('play'); const packet = await reply;
  assert.equal(packet.subarray(0, 4).toString(), 'LSP2');
  assert.ok(Math.abs(packet.readDoubleLE(16) - packet.readDoubleLE(8) - 150) < 0.000001);
  assert.equal(packet.readInt16LE(24), 1234);
  app.control('pause'); assert.equal(app.status().playing, false);
  app.control('play'); assert.equal(app.status().playing, true);
  app.control('stop'); assert.equal(app.status().active, false);
  const sourceResponse = await fetch(app.base + '/api/source', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'system' }) });
  assert.equal(sourceResponse.status, 200); app.control('play'); assert.equal(app.status().sourceKind, 'system');
});
test('publication onglet : audio horodaté et arrêt à la déconnexion du diffuseur', async t => {
  const app = await fixture(t);
  const listener = new WebSocket(app.base.replace('http:', 'ws:')), publisher = new WebSocket(app.base.replace('http:', 'ws:'));
  t.after(() => { listener.terminate(); publisher.terminate(); });
  await Promise.all([once(listener, 'open'), once(publisher, 'open')]);
  let reply = message(listener, 'meta'); listener.send(JSON.stringify({ type: 'hello', role: 'client', protocol: 2 })); await reply;
  reply = message(listener, 'state'); listener.send(JSON.stringify({ type: 'listen' })); await reply;
  reply = message(publisher, 'publisher-ready'); publisher.send(JSON.stringify({ type: 'publish' })); await reply;
  assert.equal(app.status().sourceKind, 'tab');
  const input = Buffer.alloc(1936); input.write('LSIN'); input.writeDoubleLE(performance.now(), 8); input.writeInt16LE(-1234, 16);
  reply = message(listener, 'binary'); publisher.send(input); const output = await reply;
  assert.equal(output.readInt16LE(24), -1234); assert.ok(Math.abs(output.readDoubleLE(16) - output.readDoubleLE(8) - 150) < 0.000001);
  reply = message(listener, 'state'); publisher.close(); await reply; assert.equal(app.status().playing, false);
});

test('réglages : validation, origine et délai partagé sans perdre la lecture', async t => {
  const app = await fixture(t);
  const pcm = Buffer.alloc(48000 * 4);
  await fetch(app.base + '/api/track', { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: pcm });
  app.control('play');
  async function settings(value, origin) {
    return fetch(app.base + '/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify({ syncDelayMs: value }) });
  }
  assert.equal((await settings(0)).status, 400); assert.equal(app.status().syncDelayMs, 150);
  assert.equal((await settings(250, 'https://example.com')).status, 403);
  const generation = app.status().generation;
  assert.equal((await settings(250)).status, 200); assert.equal(app.status().syncDelayMs, 250);
  assert.equal(app.status().playing, true); assert.ok(app.status().generation > generation);
  const ws = new WebSocket(app.base.replace('http:', 'ws:')); t.after(() => ws.terminate()); await once(ws, 'open');
  let reply = message(ws, 'meta'); ws.send(JSON.stringify({ type: 'hello', role: 'client', protocol: 2 })); await reply;
  reply = message(ws, 'binary'); ws.send(JSON.stringify({ type: 'listen' })); const packet = await reply;
  assert.ok(Math.abs(packet.readDoubleLE(16) - packet.readDoubleLE(8) - 250) < 0.000001);
});
test('onglet préparé : ne diffuse qu’après Démarrer, puis coupure complète', async t => {
  const app = await fixture(t), publisher = new WebSocket(app.base.replace('http:', 'ws:'));
  t.after(() => publisher.terminate()); await once(publisher, 'open');
  let reply = message(publisher, 'publisher-ready'); publisher.send(JSON.stringify({ type: 'publish', play: false })); await reply;
  assert.equal(app.status().active, true); assert.equal(app.status().playing, false);
  app.control('play'); assert.equal(app.status().playing, true);
  app.control('pause'); assert.equal(app.status().playing, false);
  app.control('play'); app.control('stop'); assert.equal(app.status().active, false);
  app.control('play'); assert.equal(app.status().playing, true);
  const oldGeneration = app.status().generation;
  reply = message(publisher, 'state', value => value.generation > oldGeneration); publisher.send(JSON.stringify({ type: 'unpublish' })); await reply;
  assert.equal(app.status().active, false); assert.throws(() => app.control('play'), /onglet/);
});
