'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { WebSocket } = require('ws');
const { listenerAddress } = require('../desktop/listener-address');
const { createListenerServer } = require('../desktop/listener-server');
const { miniWindowOptions } = require('../desktop/mini-window');
const { createApp } = require('../server');
test('auditeur : adresse normalisée et mini-lecteur compact non agrandissable', () => {
  assert.equal(listenerAddress('192.168.1.3:3000/host'), 'http://192.168.1.3:3000');
  assert.equal(listenerAddress('https://salon.local:8443/listen?q=1'), 'https://salon.local:8443');
  for (const value of ['', 'file:///C:/Windows', 'javascript:alert(1)', 'http://user:secret@localhost:3000', 'http://foo bar']) assert.throws(() => listenerAddress(value));
  for (const host of [true, false]) { const options = miniWindowOptions(host); assert.equal(options.resizable, false); assert.equal(options.maximizable, false); assert.equal(options.fullscreenable, false); assert.ok(options.width <= 340 && options.height < 250); }
});
test('auditeur : PCM et horloge relayés, aucune commande hôte accessible', async t => {
  class Capture { startSystemAudio(cb) { this.timer = setInterval(() => cb(Buffer.alloc(1920, 1)), 10); } stop() { clearInterval(this.timer); } }
  const host = createApp({ Capture }); await new Promise(resolve => host.server.listen(0, '127.0.0.1', resolve)); t.after(() => host.close()); host.control('play');
  const bridge = createListenerServer(); await new Promise(resolve => bridge.server.listen(0, '127.0.0.1', resolve)); t.after(() => bridge.close());
  const base = 'http://127.0.0.1:' + bridge.server.address().port;
  await bridge.connect('http://127.0.0.1:' + host.server.address().port);
  assert.equal((await fetch(base + '/listen')).status, 200);
  assert.equal((await (await fetch(base + '/api/status')).json()).playing, true);
  assert.equal((await fetch(base + '/api/control', { method:'POST', body:JSON.stringify({ action:'stop' }) })).status, 403);
  assert.equal((await fetch(base + '/api/requests/test', { method:'PATCH', body:'{}' })).status, 403);
  const socket = new WebSocket(base.replace('http:', 'ws:')); t.after(() => socket.terminate()); await once(socket, 'open');
  const packet = new Promise(resolve => socket.on('message', (data, binary) => { if (binary) resolve(data); }));
  socket.send(JSON.stringify({ type:'hello', role:'host', protocol:2 }));
  socket.send(JSON.stringify({ type:'control', action:'stop' })); socket.send(JSON.stringify({ type:'publish', play:true }));
  socket.send(JSON.stringify({ type:'listen' }));
  assert.ok((await packet).byteLength > 24); assert.equal(host.status().playing, true); assert.equal(host.status().sourceKind, 'system');
  socket.send(JSON.stringify({ type:'unlisten' }));
  assert.equal((await fetch(base + '/api/requests', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ name:'Auditeur', title:'Un morceau', url:'' }) })).status, 201);
});
