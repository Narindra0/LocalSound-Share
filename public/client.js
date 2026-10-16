'use strict';
const $ = id => document.getElementById(id);
const listenBtn = $('listenBtn'), volume = $('volume');
let ws, audioCtx, playerNode, gainNode, scheduledPlayer;
let syncPlayer, calibrationMs = 0;
let opusDecoder, opusReady = false, transportCodec = 'pcm', wireBytes = 0;
const preferences = globalThis.LocalSoundPrefs || { read: (key, fallback) => fallback, write() {} };
volume.value = Math.max(0, Math.min(100, preferences.read('clientVolume', Number(volume.value))));
$('volumeVal').textContent = volume.value + ' %';
calibrationMs = Math.max(-80, Math.min(80, preferences.read('calibrationMs', 0)));
$('calibration').value = calibrationMs; $('calibrationVal').textContent = calibrationMs + ' ms';
const roomClock = new RoomClock();
let listening = false, starting = false, state = null, reconnectDelay = 500;
let mediaSessionEngaged = false;
let clockOffset = null, bestRtt = Infinity, dropped = 0, mode = '', lastSequence = null;
let lastClockSync = -Infinity;
function send(msg) { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); }
function status(kind, text) { $('dot').className = 'dot ' + kind; $('connStatus').textContent = text; }
function render() {
  listenBtn.disabled = starting || ws?.readyState !== WebSocket.OPEN;
  listenBtn.textContent = starting ? 'Démarrage…' : listening ? '■ Arrêter l’écoute' : '▶ Écouter';
  listenBtn.classList.toggle('listening', listening);
  document.body.classList.toggle('is-joined', listening);
  const live = listening && state?.playing && state?.signal && ws?.readyState === WebSocket.OPEN;
  $('liveTag').hidden = !live; document.body.classList.toggle('is-listening', Boolean(live));
  updateMediaSession();
  window.refreshMiniPlayer?.();
}
let mediaMetadataKey = '';
function updateMediaSession() {
  if (!('mediaSession' in navigator)) return;
  try {
    const item = state?.nowPlaying;
    const artwork = item?.artwork && /^\/api\/artwork\/[a-f0-9]{64}$/.test(item.artwork) ? [{ src:new URL(item.artwork, location.origin).href }] : [];
    const details = { title:item?.title || 'Le salon sonore', artist:item?.artist || 'LocalSound Share', album:'LocalSound Share / Live', artwork };
    const key = JSON.stringify(details);
    if (key !== mediaMetadataKey && typeof MediaMetadata !== 'undefined') { navigator.mediaSession.metadata = new MediaMetadata(details); mediaMetadataKey = key; }
    navigator.mediaSession.playbackState = mediaSessionEngaged ? (listening && state?.playing && ws?.readyState === WebSocket.OPEN ? 'playing' : 'paused') : 'none';
  } catch (_) { /* Les commandes restent utilisables dans la page. */ }
}
function message(text = '') { $('unsupported').textContent = text; $('unsupported').hidden = !text; }
function flush() { scheduledPlayer?.flush(); syncPlayer?.flush(); opusDecoder?.flush(); playerNode?.port.postMessage({ type: 'flush' }); lastSequence = null; }
function negotiateAudio() { send({ type:'hello', role:'client', protocol:2, codec:opusReady ? 'opus' : 'pcm' }); }
function pushDecoded({ left, right, capturedAt, playAt }) {
  if (!listening || !state?.playing || audioCtx?.state !== 'running') return;
  if (Number.isFinite(playAt)) {
    const when = roomClock.audioTime(audioCtx, playAt, calibrationMs);
    if (when !== null) syncPlayer.pushAt(left, right, when);
  } else if (clockOffset === null || performance.now() + clockOffset - capturedAt <= Math.max(120, bestRtt + 60)) {
    if (playerNode) playerNode.port.postMessage({ type:'pcm', left, right, audioTime:audioCtx.currentTime }, [left.buffer, right.buffer]);
    else scheduledPlayer.push(left, right);
  } else dropped++;
}
function showStats(stats) {
  $('bufferMs').textContent = stats.levelMs + ' ms';
  $('underruns').textContent = stats.underruns;
  $('targetMs').textContent = stats.targetMs + ' ms';
  $('resyncs').textContent = (stats.resyncs || 0) + dropped;
}
async function setupAudio() {
  if (audioCtx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) throw new Error('Ce navigateur ne prend pas en charge la lecture audio en direct.');
  audioCtx = new AC({ latencyHint: 'interactive' });
  try {
    await audioCtx.resume();
    gainNode = audioCtx.createGain(); gainNode.gain.value = Number(volume.value) / 100;
    gainNode.connect(audioCtx.destination);
    syncPlayer = new SynchronizedPCMPlayer(audioCtx, gainNode, { inputRate: state?.audio.sampleRate || 48000 });
    syncPlayer.targetMs = state?.syncDelayMs || 150;
    if (window.isSecureContext && audioCtx.audioWorklet) {
      try {
        await audioCtx.audioWorklet.addModule('/worklet.js');
        playerNode = new AudioWorkletNode(audioCtx, 'localsound-player', {
          numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
          processorOptions: { inputRate: state?.audio.sampleRate || 48000, targetMs: 40 },
        });
        playerNode.connect(gainNode);
        playerNode.port.onmessage = ({ data }) => { if (data.type === 'stats' && !state?.synchronized) showStats(data); };
        mode = 'PCM · AudioWorklet';
      } catch (_) { playerNode?.disconnect(); playerNode = null; }
    }
    if (!playerNode) {
      scheduledPlayer = new ScheduledPCMPlayer(audioCtx, gainNode, { inputRate: state?.audio.sampleRate || 48000, targetMs: 40 });
      mode = 'PCM · direct';
    }
    $('playbackMode').textContent = mode;
    const output = audioCtx.outputLatency ?? audioCtx.baseLatency;
    $('outputMs').textContent = Number.isFinite(output) ? Math.round(output * 1000) + ' ms' : 'Non mesurée';
    if (state?.network?.opusAvailable && typeof OpusStreamDecoder !== 'undefined') {
      opusDecoder = new OpusStreamDecoder(pushDecoded, () => {
        opusReady = false; negotiateAudio();
        message('Lecture compatible PCM activée sur cet appareil.');
      });
      try { await opusDecoder.ready; opusReady = true; } catch (_) { opusReady = false; }
    }
  } catch (err) { await audioCtx.close(); audioCtx = null; throw err; }
}
function pushAudio(buffer) {
  if (!listening || !state?.playing || audioCtx?.state !== 'running') return;
  if (opusDecoder?.pushPacket(buffer)) return;
  if (syncPlayer?.pushPacket(buffer, roomClock, calibrationMs)) return;
  const view = new DataView(buffer);
  let offset = 0;
  if (buffer.byteLength >= 24 && view.getUint32(0, true) === 0x3250534c) offset = 24;
  if (buffer.byteLength >= 16 && [0x3150534c, 0x3250534c].includes(view.getUint32(0, true))) {
    const sequence = view.getUint32(4, true), capturedAt = view.getFloat64(8, true);
    if (lastSequence !== null && sequence === lastSequence) return;
    lastSequence = sequence;
    // Le ping établit un décalage d’horloge ; éliminer les anciens paquets après un gel réseau/onglet.
    if (clockOffset !== null && performance.now() + clockOffset - capturedAt > Math.max(120, bestRtt + 60)) {
      dropped++; return;
    }
    offset = view.getUint32(0, true) === 0x3250534c ? 24 : 16;
  }
  const frames = Math.floor((buffer.byteLength - offset) / 4);
  if (!frames) return;
  const left = new Float32Array(frames), right = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    left[i] = view.getInt16(offset + i * 4, true) / 32768;
    right[i] = view.getInt16(offset + i * 4 + 2, true) / 32768;
  }
  if (playerNode) playerNode.port.postMessage({ type: 'pcm', left, right, audioTime: audioCtx.currentTime }, [left.buffer, right.buffer]);
  else scheduledPlayer.push(left, right);
}
function stopListening(keepMediaSession = false) {
  mediaSessionEngaged = keepMediaSession;
  listening = false; send({ type: 'unlisten' }); flush();
  if (audioCtx) audioCtx.suspend().catch(() => {}); render();
}
function applyState(next) {
  const changed = state?.playing !== next.playing || state?.generation !== next.generation; state = next;
  window.updateAppearance?.(state.appearance);
  window.updateThemeTrack?.(state.nowPlaying);
  $('sessionTitle').textContent = state.trackName || 'Le son du moment.';
  $('sessionTitle').title = $('sessionTitle').textContent;
  $('hostLine').textContent = state.nowPlaying?.artist || 'Connecté à la radio de ' + state.host;
  window.updateRecordArtwork?.(state.nowPlaying);
  $('playbackMode').textContent = (transportCodec === 'opus' ? 'Opus ' + (state.network?.bitrate || 192000) / 1000 + ' kbit/s' : 'PCM') + (state.synchronized ? ' · horloge commune' : ' · direct');
  $('syncNotice').hidden = !state.synchronized;
  $('streamState').textContent = !state.active ? 'Arrêtée' : !state.playing ? 'En pause' : state.signal ? 'En direct' : 'En attente de son';
  if (state.error) message(state.error);
  if (changed) flush(); render();
  window.updateMiniPlayer?.(state);
  if (syncPlayer) syncPlayer.targetMs = state.syncDelayMs || 150;
  $('sharedDelayNotice').textContent = 'Le délai commun de ' + (state.syncDelayMs || 150) + ' ms aligne les appareils.';
}
function ping() { send({ type: 'ping', clientTime: performance.now() }); }
function connect() {
  status('', 'Connexion…');
  const socket = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
  ws = socket; socket.binaryType = 'arraybuffer';
  socket.onopen = () => {
    reconnectDelay = 500; clockOffset = null; bestRtt = Infinity; lastClockSync = -Infinity;
    roomClock.reset();
    status('on', 'Connecté'); negotiateAudio(); ping();
    if (listening) send({ type: 'listen' }); render();
  };
  socket.onmessage = ({ data }) => {
    if (data instanceof ArrayBuffer) { wireBytes += data.byteLength; pushAudio(data); return; }
    let msg; try { msg = JSON.parse(data); } catch (_) { return; }
    if (msg.type === 'meta' || msg.type === 'state') applyState(msg);
    else if (msg.type === 'transport') { transportCodec = msg.codec; flush(); if (state) applyState(state); }
    else if (msg.type === 'requests') window.renderSongRequests?.(msg);
    else if (msg.type === 'pong') {
      const now = performance.now(), rtt = now - msg.clientTime;
      roomClock.update(msg.clientTime, msg.serverTime, now);
      if (now - lastClockSync > 30000) bestRtt = Infinity;
      if (rtt >= 0 && Number.isFinite(msg.serverTime) && rtt <= bestRtt) {
        bestRtt = rtt; clockOffset = msg.serverTime - (msg.clientTime + now) / 2;
        lastClockSync = now;
      }
      $('networkMs').textContent = Math.round(rtt) + ' ms';
    } else if (msg.type === 'error') { stopListening(); message(msg.message); }
  };
  socket.onclose = () => {
    if (socket !== ws) return;
    status('off', 'Déconnecté · reconnexion…'); flush(); render();
    setTimeout(connect, reconnectDelay); reconnectDelay = Math.min(reconnectDelay * 2, 5000);
  };
  socket.onerror = () => {};
}
async function startListening() {
  if (starting || listening) return;
  starting = true; message(); render();
  try {
    await setupAudio(); await audioCtx.resume(); flush(); listening = true; mediaSessionEngaged = true; negotiateAudio(); send({ type: 'listen' });
  } catch (err) { stopListening(); message(err.message); }
  finally { starting = false; render(); }
}
listenBtn.addEventListener('click', () => listening ? stopListening() : startListening());
if ('mediaSession' in navigator) {
  for (const [action, handler] of [['play', startListening], ['pause', () => stopListening(true)], ['stop', () => stopListening()]]) {
    try { navigator.mediaSession.setActionHandler(action, handler); } catch (_) { }
  }
}
volume.addEventListener('input', () => {
  preferences.write('clientVolume', Number(volume.value));
  $('volumeVal').textContent = volume.value + ' %';
  if (gainNode) gainNode.gain.setTargetAtTime(Number(volume.value) / 100, audioCtx.currentTime, 0.008);
});
$('resyncBtn').addEventListener('click', () => { flush(); ping(); });
$('calibration').addEventListener('input', () => {
  calibrationMs = Number($('calibration').value); $('calibrationVal').textContent = calibrationMs + ' ms'; flush();
  preferences.write('calibrationMs', calibrationMs);
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) { flush(); ping(); } });
setInterval(() => { if (state?.synchronized && syncPlayer) showStats(syncPlayer.stats()); else if (scheduledPlayer) showStats(scheduledPlayer.stats()); }, 500);
setInterval(ping, 2000);
setInterval(() => { $('kbps').textContent = Math.round(wireBytes * 8 / 1000) + ' kbit/s'; wireBytes = 0; }, 1000);
connect();
