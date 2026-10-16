'use strict';
const os = require('os');
const http = require('http');
const path = require('path');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const { Mp3Encoder } = require('./mp3shim');
const { cleanText, selectMetadata, createWindowsMediaInfo } = require('./media-info');
const { createArtworkStore } = require('./artwork');
const { readFileInfo } = require('./file-info');
const { randomUUID } = require('node:crypto');
const QRCode = require('qrcode');
const { readYoutubeInfo } = require('./youtube-info');
const { createSongRequests } = require('./song-requests');
const { DEFAULT_APPEARANCE, validAppearance, createAppearanceStore } = require('./appearance-config');
const AUDIO = Object.freeze({ sampleRate: 48000, channels: 2, bitDepth: 16, encoding: 's16le' });
const { OpusStream, MODES } = require('./opus-stream');

function splitStereo(chunk) {
  const frames = Math.floor(chunk.length / 4);
  const left = new Int16Array(frames), right = new Int16Array(frames);
  for (let i = 0; i < frames; i++) {
    left[i] = chunk.readInt16LE(i * 4);
    right[i] = chunk.readInt16LE(i * 4 + 2);
  }
  return { left, right };
}
function createApp({ Capture, Encoder = Mp3Encoder, mediaInfo = null, youtubeFetch = fetch, appearanceStore = null } = {}) {
  const peers = new Set(), streams = new Set();
  const capture = { instance: null, active: false, playing: false, kbps: 0, bytes: 0, lastChunkAt: 0, error: null };
  let encoder = null, previousBytes = 0;
  let sequence = 0;
  let sourceKind = 'system', track = null, fileTimer = null, filePosition = 0, fileBase = 0;
  let publisher = null, generation = 0;
  let syncDelayMs = 150;
  let networkMode = 'high', opusFailed = false, opusActive = false;
  let networkBytes = 0, previousNetworkBytes = 0, networkKbps = 0, compressedFrames = 0;
  const compression = new OpusStream(packet => {
    if (!capture.playing || packet.readUInt32LE(28) !== generation) return;
    compressedFrames++;
    for (const peer of peers) {
      if (peer.audioCodec !== 'opus' || !peer.wantsAudio || peer.readyState !== WebSocket.OPEN) continue;
      if (peer.bufferedAmount > 8192) { peer.terminate(); continue; }
      peer.send(packet, { binary:true }); networkBytes += packet.length;
    }
  }, () => {
    opusFailed = true; opusActive = false;
    for (const peer of peers) if (peer.audioCodec === 'opus') {
      peer.audioCodec = 'pcm'; peer.send(JSON.stringify({ type:'transport', codec:'pcm', fallback:true }));
    }
    broadcastState();
  });
  let mediaSnapshot = { available: false, sessions: [] }, manualMetadata = null;
  let manualArtwork = null;
  let youtubeMetadata = null, youtubeRequest = 0;
  const artworks = createArtworkStore(), preparedFiles = new Map(), shareCodes = new Map();
  const songRequests = createSongRequests();
  let appearance = validAppearance(appearanceStore?.load()) || {...DEFAULT_APPEARANCE};
  let appearanceSave = Promise.resolve();
  const app = express(), server = http.createServer(app);
  const wss = new WebSocketServer({ server, maxPayload: 16384, perMessageDeflate: false });
  // ws relaie aussi les erreurs du serveur HTTP (dont EADDRINUSE).
  // Les recevoir ici laisse le gestionnaire HTTP fermer proprement l'application.
  wss.on('error', err => { capture.error = err.message; });
  const isLocal = address => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);
  function automaticMetadata() {
    const detected = selectMetadata(mediaSnapshot, sourceKind);
    if (youtubeMetadata && (!detected.track || [youtubeMetadata.detectedTitle, youtubeMetadata.title].includes(detected.track.title))) {
      return { status:'youtube', track:{ title:youtubeMetadata.title, artist:detected.track?.artist || youtubeMetadata.artist, artwork:youtubeMetadata.artwork, source:'youtube' } };
    }
    return detected;
  }
  function currentMetadata() {
    if (sourceKind === 'tab' && !publisher) return { status: 'waiting', track: null };
    if (manualMetadata) return { status: 'manual', track: { ...manualMetadata, artwork:sourceKind === 'file' ? track?.artwork : automaticMetadata().track?.artwork, source: 'manual' } };
    if (sourceKind === 'file') return { status: 'file', track: track ? { title: track.title || track.name.replace(/\.(mp3|wav|flac|m4a|aac|ogg|opus|aiff|wma)$/i, ''), artist: track.artist || '', artwork:track.artwork || null, source: 'file' } : null };
    return automaticMetadata();
  }
  function status() {
    const metadata = currentMetadata();
    if (!metadata.track && manualArtwork) metadata.track = { title:'Le son du moment.', artist:'', source:'manual' };
    if (metadata.track) metadata.track = { ...metadata.track, artwork:manualArtwork || metadata.track.artwork || null };
    const port = server.address()?.port || Number(process.env.PORT || 3000);
    const urls = [...new Set(Object.values(os.networkInterfaces()).flat()
      .filter(net => net && net.family === 'IPv4' && !net.internal)
      .map(net => `http://${net.address}:${port}`))];
    return { application: 'localsound-share', version:require('./package.json').version, host: os.hostname(), urls, audio: AUDIO, active: capture.active, playing: capture.playing,
      clients: [...peers].filter(p => p.role === 'client' && p.wantsAudio).length + streams.size,
      kbps: capture.kbps, mp3Available: Boolean(Encoder), error: capture.error,
      sourceKind, synchronized: sourceKind !== 'system', syncDelayMs, generation,
      appearance:{...appearance},
      network:{ mode:networkMode, opusAvailable:!opusFailed, bitrate:MODES[networkMode], egressKbps:networkKbps, compressedFrames,
        opusListeners:[...peers].filter(p => p.role === 'client' && p.wantsAudio && p.audioCodec === 'opus').length,
        pcmListeners:[...peers].filter(p => p.role === 'client' && p.wantsAudio && p.audioCodec !== 'opus').length },
      requestCount:songRequests.snapshot().count,
      trackName: metadata.track?.title || null, nowPlaying: metadata.track, metadataStatus: metadata.status,
      sourceReady: sourceKind === 'system' ? Boolean(Capture) : sourceKind === 'file' ? Boolean(track) : Boolean(publisher),
      signal: capture.playing && capture.lastChunkAt > 0 && Date.now() - capture.lastChunkAt < 3000 };
  }
  function broadcastState() {
    const data = JSON.stringify({ type: 'state', ...status() });
    for (const peer of peers) if (peer.readyState === WebSocket.OPEN) peer.send(data);
  }
  function broadcastRequests() {
    const data = JSON.stringify({type:'requests',...songRequests.snapshot()});
    for (const peer of peers) if (peer.readyState === WebSocket.OPEN) peer.send(data);
  }
  function broadcastAudio(chunk, capturedAt = performance.now(), playAt = sourceKind === 'system' ? NaN : capturedAt + syncDelayMs) {
    if (!capture.playing || chunk.length < 4) return;
    const pcm = chunk.subarray(0, chunk.length - chunk.length % 4);
    capture.bytes += pcm.length; capture.lastChunkAt = Date.now();
    const wantsOpus = !opusFailed && [...peers].some(p => p.audioCodec === 'opus' && p.wantsAudio && p.readyState === WebSocket.OPEN);
    if (wantsOpus) compression.push(pcm, capturedAt, playAt, generation, MODES[networkMode]);
    else if (opusActive) compression.reset();
    opusActive = wantsOpus;
    let packet, syncPacket;
    for (const peer of peers) {
      if (!peer.wantsAudio || peer.readyState !== WebSocket.OPEN) continue;
      if (peer.audioCodec === 'opus') continue;
      // 250 ms en attente : repartir avec une connexion neuve, jamais plusieurs secondes de retard.
      if (peer.bufferedAmount > 48000) { peer.terminate(); continue; }
      if (peer.bufferedAmount > 15360) continue; // 80 ms : ne pas ajouter du son périmé.
      if (peer.protocolVersion === 2) {
        if (!syncPacket) {
          syncPacket = Buffer.allocUnsafe(24 + pcm.length);
          syncPacket.write('LSP2', 0, 'ascii'); syncPacket.writeUInt32LE(sequence >>> 0, 4);
          syncPacket.writeDoubleLE(capturedAt, 8); syncPacket.writeDoubleLE(playAt, 16);
          pcm.copy(syncPacket, 24);
        }
        peer.send(syncPacket, { binary: true }); if (peer.role === 'client') networkBytes += syncPacket.length;
      } else if (peer.protocolVersion === 1) {
        if (!packet) {
          packet = Buffer.allocUnsafe(16 + pcm.length);
          packet.write('LSP1', 0, 'ascii');
          packet.writeUInt32LE(sequence >>> 0, 4);
          packet.writeDoubleLE(capturedAt, 8);
          pcm.copy(packet, 16);
        }
        peer.send(packet, { binary: true }); if (peer.role === 'client') networkBytes += packet.length;
      } else { peer.send(pcm, { binary: true }); if (peer.role === 'client') networkBytes += pcm.length; }
    }
    sequence++;
    if (streams.size && Encoder) {
      try {
        // Même fréquence que la capture, un encodage partagé entre auditeurs.
        encoder ||= new Encoder(2, AUDIO.sampleRate, 128);
        const { left, right } = splitStereo(pcm);
        const bytes = Buffer.from(encoder.encodeBuffer(left, right));
        if (bytes.length) for (const stream of streams) {
          if (stream.writableLength > 128 * 1024) { streams.delete(stream); stream.destroy(); }
          else { stream.write(bytes); networkBytes += bytes.length; }
        }
      } catch (err) {
        capture.error = 'Encodage MP3 impossible : ' + err.message;
        for (const stream of streams) stream.destroy();
        streams.clear(); encoder = null;
      }
    }
  }
  function startCapture() {
    if (capture.active) { capture.playing = true; return; }
    if (!Capture) throw new Error('Module de capture indisponible. Vérifiez loopback-capture.');
    const instance = new Capture(); capture.playing = true;
    try { instance.startSystemAudio(chunk => { if (sourceKind === 'system' && capture.instance === instance) broadcastAudio(chunk); }); }
    catch (err) { capture.playing = false; try { instance.stop(); } catch (_) {} throw err; }
    Object.assign(capture, { instance, active: true, lastChunkAt: 0, error: null });
  }
  function stopCapture() {
    compression.reset();
    clearInterval(fileTimer); fileTimer = null;
    capture.playing = false;
    if (capture.instance) { try { capture.instance.stop(); } catch (_) {} }
    Object.assign(capture, { instance: null, active: false, lastChunkAt: 0 });
  }
  function startFile() {
    if (!track) throw new Error('Choisissez un fichier musical.');
    if (capture.playing) return;
    capture.active = true; capture.playing = true; capture.error = null;
    if (filePosition >= track.pcm.length / 4) filePosition = 0;
    fileBase = performance.now() + syncDelayMs - filePosition / 48;
    let cursor = filePosition;
    fileTimer = setInterval(() => {
      const now = performance.now(), frames = track.pcm.length / 4;
      // Ne pas rejouer une file de blocs devenus anciens après un blocage du serveur.
      if (fileBase + cursor / 48 < now + 20) cursor = Math.min(frames, Math.ceil((now + syncDelayMs - fileBase) * 48 / 480) * 480);
      while (cursor < frames && fileBase + cursor / 48 <= now + syncDelayMs) {
        const end = Math.min(cursor + 480, frames), playAt = fileBase + cursor / 48;
        broadcastAudio(track.pcm.subarray(cursor * 4, end * 4), playAt - syncDelayMs, playAt);
        cursor = end;
      }
      if (cursor >= frames && now >= fileBase + frames / 48) { stopCapture(); filePosition = 0; generation++; broadcastState(); }
    }, 5);
  }
  function selectSource(kind) {
    if (!['system', 'file', 'tab'].includes(kind)) throw new Error('Source inconnue.');
    stopCapture();
    if (publisher) { publisher.isPublisher = false; publisher = null; }
    for (const stream of streams) stream.end(); streams.clear(); encoder = null;
    sourceKind = kind; manualMetadata = null; manualArtwork = null; youtubeMetadata = null; youtubeRequest++; generation++; filePosition = 0;
    if (kind !== 'file') track = null;
    broadcastState();
  }
  function control(action) {
    if (action !== 'play' || !capture.playing) compression.reset();
    if (action === 'play') {
      if (sourceKind === 'system') startCapture();
      else if (sourceKind === 'file') startFile();
      else { if (!publisher) throw new Error('Sélectionnez un onglet à partager.'); capture.active = true; capture.playing = true; }
    } else if (action === 'pause') {
      if (sourceKind === 'file' && capture.playing) filePosition = Math.max(filePosition, Math.min(track.pcm.length / 4, Math.floor((performance.now() - fileBase) * 48)));
      clearInterval(fileTimer); fileTimer = null; capture.playing = false;
    } else if (action === 'stop') { stopCapture(); filePosition = 0; }
    else throw new Error('Action inconnue : ' + action);
    if (action !== 'play') {
      for (const stream of streams) stream.end();
      streams.clear(); encoder = null;
    }
    broadcastState();
  }
  const isHostEntry = req => isLocal(req.socket.remoteAddress) && ['localhost', '127.0.0.1', '::1', '[::1]'].includes(req.hostname.toLowerCase());
  app.get('/', (req, res) => {
    if (isHostEntry(req)) return res.redirect('/host');
    res.sendFile(path.join(__dirname, 'public/index.html'));
  });
  app.get('/listen', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));
  app.use(express.static(path.join(__dirname, 'public')));
  app.get('/host', (req, res) => res.sendFile(path.join(__dirname, 'public/host.html')));
  app.get('/home', (req, res) => res.redirect(isHostEntry(req) ? '/host' : '/listen'));
  app.get('/settings', (req, res) => res.redirect(isHostEntry(req) ? '/host#sharingSettings' : '/listen#audioSettings'));
  app.get('/api/status', (req, res) => { res.set('Cache-Control', 'no-store'); res.json(status()); });
  app.get('/api/artwork/:hash', (req, res) => {
    const image = artworks.get(req.params.hash);
    if (!image) return res.sendStatus(404);
    res.set({ 'Content-Type':image.type, 'Cache-Control':'public, max-age=86400, immutable', 'X-Content-Type-Options':'nosniff' }).send(image.data);
  });
  app.get('/api/share-code', async (req, res) => {
    const address = req.query.address;
    if (typeof address !== 'string' || !status().urls.includes(address)) return res.status(400).json({ error:'Choisissez une adresse réseau disponible.' });
    try {
      const target = address + '/listen';
      if (!shareCodes.has(target)) {
        const svg = await QRCode.toString(target, { type:'svg', errorCorrectionLevel:'M', margin:4, width:232, color:{ dark:'#292923', light:'#ffffff' } });
        if (shareCodes.size >= 8) shareCodes.clear();
        shareCodes.set(target, svg);
      }
      res.set({ 'Content-Type':'image/svg+xml', 'Cache-Control':'no-cache', 'X-Content-Type-Options':'nosniff' }).send(shareCodes.get(target));
    } catch (_) { res.status(500).json({ error:'QR code indisponible.' }); }
  });
  function hostOnly(req, res, next) {
    if (!isLocal(req.socket.remoteAddress)) return res.status(403).json({ error: 'Commandes réservées au PC hôte : ouvrez la console sur localhost.' });
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return res.status(403).json({ error: 'Origine non autorisée.' });
    next();
  }
  app.get('/api/requests', (req,res) => { res.set('Cache-Control','no-store').json(songRequests.snapshot()); });
  app.post('/api/requests', express.json({limit:'4kb'}), (req,res) => {
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return res.status(403).json({error:'Origine non autorisée.'});
    try {
      const item = songRequests.add(req.body,req.socket.remoteAddress);
      broadcastRequests(); res.status(201).json({item,...songRequests.snapshot()});
    } catch (err) { res.status(err.status || 400).json({error:err.message}); }
  });
  app.patch('/api/requests/:id', hostOnly, express.json({limit:'1kb'}), (req,res) => {
    try {
      songRequests.update(req.params.id,req.body?.status);
      broadcastRequests(); res.json(songRequests.snapshot());
    } catch (err) { res.status(err.status || 400).json({error:err.message}); }
  });
  app.post('/api/settings', hostOnly, express.json({ limit: '1kb' }), (req, res) => {
    const delay = req.body?.syncDelayMs ?? syncDelayMs;
    const nextMode = req.body?.networkMode ?? networkMode;
    if (![100, 150, 250].includes(delay)) return res.status(400).json({ error: 'Le délai commun doit être de 100, 150 ou 250 ms.' });
    if (!Object.hasOwn(MODES, nextMode)) return res.status(400).json({ error:'Qualité audio invalide.' });
    if (delay === syncDelayMs && nextMode === networkMode) return res.json(status());
    const resumeFile = sourceKind === 'file' && capture.playing;
    if (resumeFile) control('pause');
    syncDelayMs = delay;
    networkMode = nextMode; compression.reset();
    for (const peer of peers) {
      peer.audioCodec = peer.supportsOpus && MODES[networkMode] && !opusFailed ? 'opus' : 'pcm';
      if (peer.readyState === WebSocket.OPEN) peer.send(JSON.stringify({ type:'transport', codec:peer.audioCodec, bitrate:MODES[networkMode] }));
    }
    if (sourceKind !== 'system') generation++;
    if (resumeFile) control('play'); else broadcastState();
    res.json(status());
  });
  app.post('/api/appearance', hostOnly, express.json({limit:'1kb'}), async (req,res) => {
    const next = validAppearance(req.body);
    if (!next) return res.status(400).json({error:'Choisissez un thème et une couleur disponibles.'});
    const operation = appearanceSave.then(async()=>{
      await appearanceStore?.save(next);
      appearance=next;broadcastState();
    });
    appearanceSave=operation.catch(()=>{});
    try {await operation;res.json(status());}
    catch (_) {res.status(500).json({error:'Impossible d’enregistrer l’ambiance. Réessayez.'});}
  });
  app.post('/api/source', hostOnly, express.json({ limit: '1kb' }), (req, res) => {
    try { selectSource(req.body?.kind); res.json(status()); } catch (err) { res.status(400).json({ error: err.message }); }
  });
  app.post('/api/now-playing', hostOnly, express.json({ limit: '4kb' }), (req, res) => {
    const data = req.body;
    if (!data || !['auto', 'manual'].includes(data.mode) || (data.mode === 'manual' && (typeof data.title !== 'string' || !cleanText(data.title) || typeof data.artist !== 'string' || data.title.length > 200 || data.artist.length > 200))) return res.status(400).json({ error: 'Indiquez un titre et un artiste de 200 caractères maximum.' });
    if (data.generation !== generation) return res.status(409).json({ error: 'La source a changé. Rouvrez les réglages du titre.' });
    manualMetadata = data.mode === 'manual' ? { title: cleanText(data.title), artist: cleanText(data.artist) } : null;
    if (data.mode === 'auto') { youtubeMetadata = null; youtubeRequest++; }
    broadcastState(); res.json(status());
  });
  app.post('/api/youtube', hostOnly, express.json({ limit:'4kb' }), async (req, res) => {
    const sourceGeneration = req.body?.generation;
    if (sourceGeneration !== generation) return res.status(409).json({ error:'La source a changé. Rouvrez les réglages.' });
    if (sourceKind === 'file') return res.status(400).json({ error:'Choisissez le partage d’onglet ou le son système pour une vidéo YouTube.' });
    const requestId = ++youtubeRequest;
    const detectedTitle = selectMetadata(mediaSnapshot, sourceKind).track?.title || null;
    try {
      const info = await readYoutubeInfo(req.body?.url, youtubeFetch);
      if (sourceGeneration !== generation || requestId !== youtubeRequest) return res.status(409).json({ error:'La source ou les réglages ont changé pendant la récupération.' });
      // Ne pas associer la miniature à une vidéo suivante qui aurait démarré entre-temps.
      const currentTitle = selectMetadata(mediaSnapshot, sourceKind).track?.title || null;
      if (currentTitle !== detectedTitle) return res.status(409).json({ error:'Le morceau a changé. Vérifiez le lien YouTube et réessayez.' });
      youtubeMetadata = { title:info.title, artist:info.artist, artwork:artworks.add(info.image), detectedTitle, url:info.url };
      manualMetadata = null; manualArtwork = null;
      broadcastState(); res.json(status());
    } catch (err) { res.status(400).json({ error:err.name === 'TimeoutError' ? 'YouTube ne répond pas. Réessayez dans un instant.' : err.name === 'TypeError' ? 'YouTube est inaccessible ou la miniature est absente. Vérifiez le lien et la connexion Internet.' : err.message }); }
  });
  app.put('/api/artwork', hostOnly, express.raw({ type:'application/octet-stream', limit:'2mb' }), (req, res) => {
    if (Number(req.headers['x-source-generation']) !== generation) return res.status(409).json({ error:'La source a changé. Rouvrez les réglages.' });
    const url = artworks.add(req.body);
    if (!url) return res.status(400).json({ error:'Choisissez une image JPEG, PNG ou WebP de moins de 2 Mo.' });
    manualArtwork = url; broadcastState(); res.json(status());
  });
  app.delete('/api/artwork', hostOnly, (req, res) => {
    if (Number(req.headers['x-source-generation']) !== generation) return res.status(409).json({ error:'La source a changé. Rouvrez les réglages.' });
    manualArtwork = null; broadcastState(); res.json(status());
  });
  app.post('/api/track-info', hostOnly, express.raw({ type:'application/octet-stream', limit:'30mb' }), async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.sendStatus(400);
    const info = await readFileInfo(req.body);
    const token = randomUUID();
    for (const [key, item] of preparedFiles) if (Date.now() - item.time > 600000) preparedFiles.delete(key);
    while (preparedFiles.size >= 4) preparedFiles.delete(preparedFiles.keys().next().value);
    preparedFiles.set(token, { title:cleanText(info?.title), artist:cleanText(info?.artist), artwork:info?.artwork ? artworks.add(Buffer.from(info.artwork)) : null, time:Date.now() });
    res.json({ token });
  });
  app.put('/api/track', hostOnly, express.raw({ type: 'application/octet-stream', limit: '120mb' }), (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length || req.body.length % 4 || req.body.length > 48000 * 4 * 600) return res.status(400).json({ error: 'Fichier PCM stéréo 48 kHz invalide (10 minutes maximum).' });
    let name;
    try { name = decodeURIComponent(req.headers['x-track-name'] || 'Musique'); } catch (_) { return res.status(400).json({ error: 'Nom du fichier invalide.' }); }
    const token = req.headers['x-track-info'], info = preparedFiles.get(token);
    if (token && (!info || Date.now() - info.time > 600000)) return res.status(400).json({ error:'Les informations du fichier ont expiré. Choisissez à nouveau le fichier.' });
    preparedFiles.delete(token);
    selectSource('file'); track = { name: name.slice(0, 200), pcm: req.body, title:info?.title, artist:info?.artist, artwork:info?.artwork }; broadcastState(); res.json(status());
  });
  app.post('/api/control', (req, res, next) => {
    if (!isLocal(req.socket.remoteAddress)) return res.status(403).json({ error: 'Commandes réservées au PC hôte : ouvrez la console sur localhost.' });
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return res.status(403).json({ error: 'Origine non autorisée.' });
    next();
  }, express.json({ limit: '1kb' }), (req, res) => {
    try { control(req.body?.action); res.json(status()); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });
  app.get('/stream.mp3', (req, res) => {
    if (!Encoder) return res.status(503).send('Encodeur MP3 indisponible.');
    if (!capture.playing) return res.status(409).send('Diffusion en pause ou arrêtée.');
    res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.flushHeaders(); streams.add(res);
    res.on('close', () => { streams.delete(res); if (!streams.size) encoder = null; broadcastState(); });
    broadcastState();
  });
  wss.on('connection', (ws, req) => {
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) { ws.close(1008, 'Origine non autorisée'); return; }
    ws.role = 'observer'; ws.wantsAudio = false; peers.add(ws);
    req.socket.setNoDelay(true);
    ws.on('message', (data, binary) => {
      if (binary) {
        if (ws !== publisher || !ws.isPublisher || sourceKind !== 'tab' || data.length < 20 || data.length > 8192 || data.subarray(0, 4).toString() !== 'LSIN') return;
        const pcm = data.subarray(16);
        if (pcm.length % 4) return;
        const time = data.readDoubleLE(8), now = performance.now();
        if (!Number.isFinite(time) || time < now - 300 || time > now + 100) return;
        broadcastAudio(pcm, time); return;
      }
      let msg; try { msg = JSON.parse(data); } catch (_) { return; }
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'hello') {
        ws.role = msg.role === 'host' ? 'host' : 'client';
        ws.protocolVersion = [1, 2].includes(msg.protocol) ? msg.protocol : 0;
        ws.supportsOpus = msg.codec === 'opus' && ws.protocolVersion === 2;
        ws.audioCodec = ws.supportsOpus && MODES[networkMode] && !opusFailed ? 'opus' : 'pcm';
        ws.send(JSON.stringify({ type:'transport', codec:ws.audioCodec, bitrate:MODES[networkMode] }));
        ws.send(JSON.stringify({ type: 'meta', ...status() }));
        ws.send(JSON.stringify({type:'requests',...songRequests.snapshot()}));
      } else if (msg.type === 'publish') {
        if (!isLocal(req.socket.remoteAddress)) { ws.send(JSON.stringify({ type: 'error', message: 'La source doit être sur le PC hôte.' })); return; }
        selectSource('tab'); publisher = ws; ws.isPublisher = true;
        capture.active = true; capture.playing = msg.play !== false;
        ws.send(JSON.stringify({ type: 'publisher-ready' })); broadcastState();
      } else if (msg.type === 'unpublish' && publisher === ws) {
        ws.isPublisher = false; publisher = null; stopCapture(); generation++; broadcastState();
      } else if (msg.type === 'ping' && Number.isFinite(msg.clientTime)) {
        ws.send(JSON.stringify({ type: 'pong', clientTime: msg.clientTime, serverTime: performance.now() }));
      } else if (msg.type === 'listen' || msg.type === 'unlisten') {
        ws.wantsAudio = msg.type === 'listen'; broadcastState();
      } else if (msg.type === 'control') {
        try {
          if (!isLocal(req.socket.remoteAddress)) throw new Error('Commandes réservées au PC hôte.');
          control(msg.action);
        } catch (err) { ws.send(JSON.stringify({ type: 'error', message: err.message })); }
      }
    });
    ws.on('close', () => {
      peers.delete(ws);
      if (publisher === ws) { publisher = null; stopCapture(); generation++; }
      broadcastState();
    });
    ws.on('error', () => { peers.delete(ws); });
  });
  const timer = setInterval(() => {
    capture.kbps = Math.round((capture.bytes - previousBytes) * 8 / 1000); previousBytes = capture.bytes;
    networkKbps = Math.round((networkBytes - previousNetworkBytes) * 8 / 1000); previousNetworkBytes = networkBytes;
    if (peers.size) broadcastState();
  }, 1000);
  mediaInfo?.start(snapshot => {
    mediaSnapshot = { available:snapshot.available, sessions:(snapshot.sessions || []).map(item => ({ ...item, artwork:item.artworkBase64 && item.artworkBase64.length <= 2800000 ? artworks.add(Buffer.from(item.artworkBase64, 'base64')) : null, artworkBase64:undefined })) };
    if (youtubeMetadata) {
      const detected = selectMetadata(mediaSnapshot, sourceKind).track;
      if (detected && ![youtubeMetadata.detectedTitle, youtubeMetadata.title].includes(detected.title)) youtubeMetadata = null;
    }
    broadcastState();
  });
  async function close() {
    mediaInfo?.close();
    clearInterval(timer); stopCapture();
    await compression.close();
    for (const stream of streams) stream.destroy();
    streams.clear(); for (const peer of peers) peer.terminate();
    wss.close(); await new Promise(resolve => server.close(resolve));
  }
  return { server, status, control, close };
}
if (require.main === module) {
  let Capture;
  try { Capture = require('loopback-capture').LoopbackCapture; } catch (err) { console.error('[audio]', err.message); }
  const instance = createApp({ Capture, mediaInfo: createWindowsMediaInfo(), appearanceStore:createAppearanceStore(path.join(__dirname,'data','appearance.json')) });
  instance.server.on('error', err => {
    console.error('[serveur]', err.code === 'EADDRINUSE'
      ? `Le port ${err.port} est déjà utilisé. Si LocalSound est déjà lancé, ouvre http://localhost:${err.port}/host ; sinon, ferme le programme qui utilise ce port puis relance npm start.`
      : err.message);
    instance.close().finally(() => { process.exitCode = 1; });
  });
  instance.server.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => {
    console.log(`Console hôte : http://localhost:${instance.server.address().port}/host`);
    for (const url of instance.status().urls) console.log('Auditeurs    : ' + url);
    try { instance.control('play'); } catch (err) { console.error('[audio]', err.message); }
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => instance.close());
}
module.exports = { createApp, splitStereo };
