'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { MockContext } = require('../helpers/audio-mock');
const { ScheduledPCMPlayer } = require('../../public/pcm-player');
const { RoomClock, SynchronizedPCMPlayer } = require('../../public/sync-player');
function browser(secure, mediaSupported = false) {
  const elements = new Map();
  const classes = { toggle() {} };
  const document = { body: { classList: classes }, addEventListener() {},
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, { classList: classes, value: '80', addEventListener(type, cb) { this[type] = cb; } });
      return elements.get(id);
    },
  };
  const sockets = [], contexts = [];
  class Socket {
    static OPEN = 1;
    constructor() { this.readyState = 1; this.sent = []; sockets.push(this); }
    send(data) { this.sent.push(JSON.parse(data)); }
  }
  class Context extends MockContext {
    constructor() { super(); contexts.push(this); }
    get audioWorklet() { return { addModule: async () => {} }; }
  }
  class Worklet { constructor() { this.port = { postMessage() {} }; } connect() {} }
  const handlers = {}, mediaSession = { setActionHandler(action, handler) { handlers[action] = handler; } };
  const context = vm.createContext({ document, navigator:mediaSupported ? { mediaSession } : {}, MediaMetadata:class { constructor(data) { Object.assign(this, data); } }, URL, window: { isSecureContext: secure, AudioContext: Context },
    ScheduledPCMPlayer, RoomClock, SynchronizedPCMPlayer, WebSocket: Socket, AudioWorkletNode: Worklet, location: { protocol: 'http:', host: 'localhost:3000' },
    performance: { now: () => 1000 }, console, setTimeout() {}, setInterval() {}, ArrayBuffer, DataView, Float32Array });
  vm.runInContext(fs.readFileSync('public/client.js', 'utf8'), context);
  const socket = sockets[0]; socket.onopen();
  function state(playing) {
    socket.onmessage({ data: JSON.stringify({ type: 'state', host: 'Test', audio: { sampleRate: 48000 },
      active: true, playing, signal: playing, kbps: 100 }) });
  }
  state(true);
  return { socket, state, contexts, mediaSession, handlers, get: id => document.getElementById(id) };
}

test('commandes multimédias : pause et reprise locales sans piloter le partage', async () => {
  const app = browser(false, true);
  await app.get('listenBtn').click();
  assert.equal(app.mediaSession.playbackState, 'playing');
  assert.equal(app.mediaSession.metadata.album, 'LocalSound Share / Live');
  app.handlers.pause();
  assert.equal(app.mediaSession.playbackState, 'paused');
  assert.equal(app.contexts[0].state, 'suspended');
  await app.handlers.play();
  assert.equal(app.mediaSession.playbackState, 'playing');
  assert.equal(app.contexts.length, 1);
  app.state(false); assert.equal(app.mediaSession.playbackState, 'paused');
  app.state(true); assert.equal(app.mediaSession.playbackState, 'playing');
  app.handlers.stop(); assert.equal(app.mediaSession.playbackState, 'none');
  assert.equal(app.socket.sent.some(m => m.type === 'control'), false);
});
test('bouton PCM : abonnement sur connexion déjà ouverte et arrêt individuel', async () => {
  const app = browser(true); await app.get('listenBtn').click();
  assert.equal(app.socket.sent.at(-1).type, 'listen'); assert.match(app.get('playbackMode').textContent, /AudioWorklet/);
  await app.get('listenBtn').click(); assert.equal(app.socket.sent.at(-1).type, 'unlisten');
});
test('HTTP LAN : PCM direct sans MP3, volume et suppression du son en pause', async () => {
  const app = browser(false); await app.get('listenBtn').click();
  assert.equal(app.socket.sent.at(-1).type, 'listen'); assert.equal(app.get('playbackMode').textContent, 'PCM · direct');
  app.socket.onmessage({ data: new ArrayBuffer(1920) });
  assert.equal(app.contexts[0].sources.length, 1);
  app.get('volume').value = '25'; app.get('volume').input();
  app.state(false); assert.ok(app.contexts[0].sources[0].stopTime <= 0.003);
  app.state(true); app.socket.onmessage({ data: new ArrayBuffer(1920) });
  assert.equal(app.contexts[0].sources.length, 2);
  await app.get('listenBtn').click(); assert.equal(app.contexts[0].state, 'suspended');
});
test('paquets trop anciens : rejet après une interruption réseau', async () => {
  const app = browser(false); await app.get('listenBtn').click();
  app.socket.onmessage({ data: JSON.stringify({ type: 'pong', clientTime: 1000, serverTime: 1000 }) });
  const packet = new ArrayBuffer(1936), view = new DataView(packet);
  view.setUint32(0, 0x3150534c, true); view.setUint32(4, 1, true); view.setFloat64(8, 500, true);
  app.socket.onmessage({ data: packet }); assert.equal(app.contexts[0].sources.length, 0);
  view.setUint32(4, 2, true); view.setFloat64(8, 1000, true);
  app.socket.onmessage({ data: packet }); assert.equal(app.contexts[0].sources.length, 1);
});
function worklet() {
  let Player;
  class Processor { constructor() { this.port = { postMessage() {} }; } }
  const scope = { AudioWorkletProcessor: Processor, sampleRate: 48000, currentTime: 0, Float32Array,
    registerProcessor(name, value) { Player = value; } };
  vm.runInNewContext(fs.readFileSync('public/worklet.js', 'utf8'), scope);
  return { player: new Player({}), scope };
}
test('worklet : démarre avec 40 ms, pas de réserve cachée de 200 ms', () => {
  const { player } = worklet(); const samples = new Float32Array(1920).fill(0.25);
  player.write(samples, samples);
  const out = [new Float32Array(128), new Float32Array(128)]; player.process([], [out]);
  assert.ok(out[0][127] > 0); assert.equal(player.targetS, 0.04);
});
test('worklet : résorbe un retard de 500 ms et traite un paquet géant sans débordement', () => {
  const { player } = worklet(); const samples = new Float32Array(48000).fill(0.25);
  player.write(samples, samples); assert.ok(player.written - player.read <= player.cap);
  player.process([], [[new Float32Array(128), new Float32Array(128)]]);
  assert.ok((player.written - player.read) / player.inputRate < 0.05); assert.equal(player.resyncs, 1);
});
test('PCM HTTP : 3 minutes de Wi-Fi simulé, gigue et dérive, sans retard cumulatif', () => {
  const context = new MockContext(), player = new ScheduledPCMPlayer(context, {});
  const samples = new Float32Array(480).fill(0.25);
  let peak = 0;
  for (let i = 0; i < 18000; i++) {
    const jitter = (i % 7) * 0.001; // 0–6 ms de gigue ; horloge 100 ppm plus rapide.
    context.advance(i * 0.010001 + jitter); player.push(samples, samples);
    peak = Math.max(peak, player.stats().levelMs);
  }
  assert.equal(player.underruns, 0); assert.equal(player.resyncs, 0);
  assert.ok(peak <= 60, 'Tampon maximal : ' + peak + ' ms');
  assert.ok(context.sources.length < 10, 'Les sources terminées sont libérées');
});
test('PCM HTTP : s’adapte aux coupures, borne le tampon et recale après un afflux', () => {
  const context = new MockContext(), player = new ScheduledPCMPlayer(context, {});
  const samples = new Float32Array(480).fill(0.25);
  player.push(samples, samples); context.advance(0.2); player.push(samples, samples);
  assert.equal(player.underruns, 1); assert.equal(player.stats().targetMs, 50);
  for (let i = 0; i < 200; i++) player.push(samples, samples);
  assert.ok(player.resyncs > 0); assert.ok(player.stats().levelMs <= 140);
  player.flush(); assert.equal(player.stats().levelMs, 0);
});

test('worklet : 60 secondes avec gigue et dérive, sans coupure ni retard cumulatif', () => {
  const { player, scope } = worklet();
  const chunk = new Float32Array(480).fill(0.25);
  const output = [[new Float32Array(128), new Float32Array(128)]];
  let packet = 0, peak = 0;
  for (let quantum = 0; quantum < 22500; quantum++) {
    const now = quantum * 128 / 48000; scope.currentTime = now;
    while (packet * 0.010001 + (packet % 7) * 0.001 <= now) { player.write(chunk, chunk); packet++; }
    player.process([], output);
    peak = Math.max(peak, (player.written - player.read) / 48);
  }
  assert.equal(player.underruns, 0); assert.equal(player.resyncs, 0); assert.ok(peak < 60);
});
test('worklet : une coupure augmente le tampon, puis reprise avec fondu', () => {
  const { player } = worklet(); const chunk = new Float32Array(1920).fill(0.25);
  player.write(chunk, chunk);
  for (let i = 0; i < 30; i++) player.process([], [[new Float32Array(128), new Float32Array(128)]]);
  assert.equal(player.underruns, 1); assert.equal(Math.round(player.targetS * 1000), 50);
  assert.equal(player.primed, false);
  const refill = new Float32Array(2400).fill(0.25); player.write(refill, refill);
  const output = [[new Float32Array(128), new Float32Array(128)]]; player.process([], output);
  assert.ok(output[0][0][0] < output[0][0][100]);
});
