'use strict';
(() => {
  const get = id => document.getElementById(id), clock = new RoomClock();
  const preferences = globalThis.LocalSoundPrefs || { read: (key, fallback) => fallback, write() {} };
  get('autoStartSource').checked = preferences.read('autoStartSource', true);
  get('autoMonitor').checked = preferences.read('autoMonitor', true);
  get('hostVolume').value = Math.max(0, Math.min(100, preferences.read('hostVolume', 80)));
  get('hostVolumeVal').textContent = get('hostVolume').value + ' %';
  let monitorCalibration = Math.max(-100, Math.min(300, preferences.read('hostCalibrationMs', 0)));
  get('hostCalibration').value = monitorCalibration; get('hostCalibrationVal').textContent = monitorCalibration + ' ms';
  for (const id of ['autoStartSource', 'autoMonitor']) get(id).addEventListener('change', () => preferences.write(id, get(id).checked));
  let socket, monitorContext, monitorGain, monitorPlayer, monitorEnabled = false;
  let sourceStream, sourceContext, sourceNode, publishing = false, publisherReady = false;
  let nativeCapture = false;
  let roomState = null, sourceOrigin = null, uploadBusy = false, reconnectTimer;
  const note = text => { get('sourceNotice').textContent = text; };
  const send = data => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data)); };
  const ping = () => send({ type: 'ping', clientTime: performance.now() });
  async function api(url, options = {}) {
    const response = await fetch(url, options); let data;
    try { data = await response.json(); } catch (_) { throw new Error('Le serveur a refusé la source audio.'); }
    if (!response.ok) throw new Error(data.error || 'Source audio indisponible.');
    return data;
  }
  async function ensureMonitor() {
    if (!monitorContext) {
      const AC = window.AudioContext || window.webkitAudioContext;
      monitorContext = new AC({ latencyHint: 'interactive', sampleRate: 48000 });
      monitorGain = monitorContext.createGain(); monitorGain.gain.value = Number(get('hostVolume').value) / 100;
      monitorGain.connect(monitorContext.destination);
      monitorPlayer = new SynchronizedPCMPlayer(monitorContext, monitorGain);
      monitorPlayer.targetMs = roomState?.syncDelayMs || 150;
    }
    await monitorContext.resume();
  }
  async function enableMonitor() {
    await ensureMonitor(); monitorEnabled = true; send({ type: 'listen' }); renderMonitor();
  }
  function disableMonitor() {
    monitorEnabled = false; send({ type: 'unlisten' }); monitorPlayer?.flush();
    monitorContext?.suspend().catch(() => {}); renderMonitor();
  }
  function renderMonitor() {
    get('hostListenBtn').disabled = !roomState?.synchronized || roomState?.sourceReady === false || socket?.readyState !== WebSocket.OPEN;
    get('hostListenBtn').textContent = monitorEnabled ? 'Couper l’écoute ici' : 'Écouter sur ce PC';
    get('monitorStatus').textContent = monitorEnabled ? 'Ce PC suit la même horloge que les auditeurs.' : 'Écoute locale désactivée.';
    window.refreshMiniPlayer?.();
  }
  function stopTab(notify = true) {
    const wasPublishing = publishing;
    publishing = false; publisherReady = false; sourceOrigin = null;
    nativeCapture = false;
    sourceNode?.disconnect(); sourceNode = null;
    sourceStream?.getTracks().forEach(track => track.stop()); sourceStream = null;
    sourceContext?.close().catch(() => {}); sourceContext = null;
    if (wasPublishing && notify) send({ type: 'unpublish' });
    get('stopTabBtn').hidden = true;
    window.dispatchEvent(new Event('localsound:tab-stopped'));
  }
  function applyState(state) {
    window.updateAppearance?.(state.appearance);
    window.updateThemeTrack?.(state.nowPlaying);
    if (roomState?.generation !== state.generation || roomState?.playing !== state.playing) monitorPlayer?.flush();
    roomState = state;
    if (monitorPlayer) monitorPlayer.targetMs = state.syncDelayMs;
    get('sourceLabel').textContent = state.sourceKind === 'file' ? (state.trackName || 'Fichier musical') : state.sourceKind === 'tab' ? 'Onglet partagé' : 'Son système';
    get('sourceLabel').title = get('sourceLabel').textContent;
    if (state.sourceKind !== 'tab' && publishing) stopTab(false);
    if (!state.synchronized && monitorEnabled) disableMonitor();
    if (!uploadBusy) note(state.sourceKind === 'system'
      ? 'Le son direct de Windows reste en avance. Pour éviter l’écho, choisissez un fichier ou un onglet synchronisé.'
      : state.sourceKind === 'file' ? 'Fichier synchronisé : écoutez ici et sur les autres appareils. Aucune lecture directe supplémentaire n’est nécessaire.'
      : 'Onglet synchronisé : sa lecture directe est supprimée pendant le partage. Gardez cette console ouverte.');
    get('stopTabBtn').hidden = !publishing;
    get('switchToSynced').hidden = state.sourceKind !== 'system';
    const noEchoToggle = get('noEchoToggle');
    if (noEchoToggle) noEchoToggle.checked = Boolean(state.synchronized);
    renderMonitor();
  }
  function connect() {
    socket = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
    socket.binaryType = 'arraybuffer';
    socket.onopen = () => {
      clock.reset(); send({ type: 'hello', role: 'host', protocol: 2 }); ping();
      if (monitorEnabled) send({ type: 'listen' });
      get('sourceTabBtn').disabled = false; renderMonitor();
    };
    socket.onmessage = ({ data }) => {
      if (data instanceof ArrayBuffer) {
        if (monitorEnabled && roomState?.synchronized) monitorPlayer?.pushPacket(data, clock, monitorCalibration);
        return;
      }
      let msg; try { msg = JSON.parse(data); } catch (_) { return; }
      if (msg.type === 'meta' || msg.type === 'state') applyState(msg);
      else if (msg.type === 'requests') window.renderSongRequests?.(msg);
      else if (msg.type === 'pong') clock.update(msg.clientTime, msg.serverTime);
      else if (msg.type === 'publisher-ready') {
        publisherReady = true;
        window.dispatchEvent(new Event('localsound:tab-ready'));
      }
      else if (msg.type === 'error') { note(msg.message); showToast(msg.message); }
    };
    socket.onclose = () => {
      monitorPlayer?.flush(); stopTab(false); get('sourceTabBtn').disabled = true; renderMonitor();
      clearTimeout(reconnectTimer); reconnectTimer = setTimeout(connect, 1000);
    };
    socket.onerror = () => {};
  }
  get('musicFile').addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file) return;
    if (uploadBusy) return;
    uploadBusy = true; get('sourceTabBtn').disabled = true; get('sourceSystemBtn').disabled = true; get('musicFile').disabled = true;
    try {
      if (file.size > 30 * 1024 * 1024) throw new Error('Choisissez un fichier de moins de 30 Mo et de 10 minutes maximum.');
      await ensureMonitor(); note('Préparation de « ' + file.name + ' »…');
      const bytes = await file.arrayBuffer();
      const [decoded, info] = await Promise.all([
        monitorContext.decodeAudioData(bytes.slice(0)),
        api('/api/track-info', { method:'POST', headers:{ 'Content-Type':'application/octet-stream' }, body:bytes }).catch(() => null),
      ]);
      if (decoded.duration > 600 || decoded.sampleRate !== 48000) throw new Error('Le fichier doit durer au maximum 10 minutes.');
      const pcm = new ArrayBuffer(decoded.length * 4), view = new DataView(pcm);
      const left = decoded.getChannelData(0), right = decoded.getChannelData(Math.min(1, decoded.numberOfChannels - 1));
      for (let i = 0; i < decoded.length; i++) {
        view.setInt16(i * 4, Math.round(Math.max(-1, Math.min(1, left[i])) * 32767), true);
        view.setInt16(i * 4 + 2, Math.round(Math.max(-1, Math.min(1, right[i])) * 32767), true);
        if (i && i % 480000 === 0) await new Promise(resolve => setTimeout(resolve, 0));
      }
      await api('/api/track', { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'X-Track-Name': encodeURIComponent(file.name), ...(info?.token ? { 'X-Track-Info':info.token } : {}) }, body: pcm });
      if (get('autoMonitor').checked) await enableMonitor(); else disableMonitor();
      if (get('autoStartSource').checked) await api('/api/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'play' }) });
      showToast(get('autoStartSource').checked ? 'Musique lancée sur l’horloge commune.' : 'Fichier prêt. Cliquez sur Démarrer pour le partager.');
    } catch (err) { note(err.message); showToast(err.message); }
    finally { uploadBusy = false; get('sourceTabBtn').disabled = socket?.readyState !== WebSocket.OPEN; get('sourceSystemBtn').disabled = false; get('musicFile').disabled = false; event.target.value = ''; }
  });
  get('sourceSystemBtn').addEventListener('click', async () => {
    try {
      await api('/api/source', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'system' }) });
      disableMonitor(); stopTab(false);
      if (get('autoStartSource').checked) await api('/api/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'play' }) });
      showToast(get('autoStartSource').checked ? 'Capture du son système activée.' : 'Son système prêt. Cliquez sur Démarrer.');
    } catch (err) { note(err.message); }
  });
  get('sourceTabBtn').addEventListener('click', async event => {
    try {
      if (!navigator.mediaDevices?.getDisplayMedia || !window.isSecureContext) throw new Error('Ouvrez cette console sur http://localhost avec Chrome ou Edge.');
      if (publishing) throw new Error('Arrêtez le partage actuel avant de choisir un autre onglet.');
      const desktopCapture = Boolean(event.detail?.desktopYoutube && window.localsoundDesktop);
      if (window.localsoundDesktop && !desktopCapture) throw new Error('Dans la version desktop, choisissez le navigateur YouTube. Pour un onglet externe, ouvrez la console dans Chrome ou Edge.');
      if (desktopCapture) await window.localsoundDesktop.prepareYoutubeCapture();
      // L’appel de partage doit partir directement du clic (activation utilisateur obligatoire).
      const streamPromise = navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'browser' }, audio: { suppressLocalAudioPlayback: true, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        selfBrowserSurface: 'exclude', systemAudio: 'exclude', surfaceSwitching: 'exclude', monitorTypeSurfaces: 'exclude',
      });
      sourceStream = await streamPromise; await ensureMonitor();
      const audio = sourceStream.getAudioTracks()[0];
      if (!audio) throw new Error('Choisissez un onglet et cochez « Partager l’audio de l’onglet ».');
      const isolatedNative = desktopCapture && await window.localsoundDesktop.confirmYoutubeCapture();
      if (!isolatedNative && audio.getSettings().suppressLocalAudioPlayback !== true) throw new Error('Le navigateur ne confirme pas la suppression du son direct. Utilisez Chrome/Edge et partagez un onglet, ou choisissez un fichier.');
      sourceContext = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' }); await sourceContext.resume();
      await sourceContext.audioWorklet.addModule('/capture-worklet.js');
      const input = sourceContext.createMediaStreamSource(new MediaStream([audio]));
      sourceNode = new AudioWorkletNode(sourceContext, 'tab-pcm-source', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
      input.connect(sourceNode); sourceNode.connect(sourceContext.destination);
      sourceNode.port.onmessage = ({ data }) => {
        if (!publisherReady || !publishing || !roomState?.playing || clock.offset === null || socket?.readyState !== WebSocket.OPEN || socket.bufferedAmount > 15360) return;
        const measuredOrigin = performance.now() + clock.offset - sourceContext.currentTime * 1000;
        if (sourceOrigin === null) sourceOrigin = measuredOrigin;
        else sourceOrigin += Math.max(-0.02, Math.min(0.02, measuredOrigin - sourceOrigin));
        const packet = new ArrayBuffer(16 + data.samples.byteLength), view = new DataView(packet);
        view.setUint32(0, 0x4e49534c, true); view.setFloat64(8, sourceOrigin + data.time * 1000, true);
        new Uint8Array(packet, 16).set(new Uint8Array(data.samples)); socket.send(packet);
      };
      publishing = true; nativeCapture = desktopCapture; send({ type: 'publish', play: get('autoStartSource').checked });
      if (get('autoMonitor').checked) await enableMonitor(); else disableMonitor();
      for (const track of sourceStream.getTracks()) track.addEventListener('ended', () => { stopTab(); note('Partage terminé. L’onglet retrouve sa lecture directe.'); });
      get('stopTabBtn').hidden = false; showToast(get('autoStartSource').checked ? 'Onglet partagé avec écoute synchronisée.' : 'Onglet prêt. Cliquez sur Démarrer pour le partager.');
    } catch (err) { stopTab(); note(err.name === 'NotAllowedError' ? 'Partage annulé ou refusé par le navigateur.' : err.message); }
  });
  get('stopTabBtn').addEventListener('click', () => { stopTab(); note('Partage terminé. L’onglet retrouve sa lecture directe.'); });
  window.addEventListener('localsound:desktop-source-closed', () => { if (nativeCapture) { stopTab(); note('Navigateur YouTube fermé. Partage terminé.'); } });
  get('hostListenBtn').addEventListener('click', async () => {
    try { if (monitorEnabled) disableMonitor(); else await enableMonitor(); } catch (err) { note(err.message); }
  });
  get('switchToSynced').addEventListener('click', () => get('chooseSourceBtn').click());
  get('hostVolume').addEventListener('input', () => {
    const value = Number(get('hostVolume').value);
    preferences.write('hostVolume', value); get('hostVolumeVal').textContent = value + ' %';
    if (monitorGain) monitorGain.gain.setTargetAtTime(value / 100, monitorContext.currentTime, 0.01);
  });
  get('hostCalibration').addEventListener('input', () => {
    monitorCalibration = Number(get('hostCalibration').value);
    get('hostCalibrationVal').textContent = monitorCalibration + ' ms';
    preferences.write('hostCalibrationMs', monitorCalibration); monitorPlayer?.flush();
  });
  get('noEchoToggle')?.addEventListener('change', async () => {
    const toggle = get('noEchoToggle');
    if (!toggle.checked) {
      try {
        await api('/api/source', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'system' }) });
        disableMonitor();
        stopTab(false);
        note('Son système : lecture directe, avec risque d’écho. Réactivez l’option et choisissez un fichier ou un onglet pour synchroniser.');
        showToast('Écoute synchronisée désactivée.');
      } catch (err) { note(err.message); toggle.checked = true; }
      return;
    }
    if (roomState?.sourceKind === 'system') {
      toggle.checked = false;
      note('Pour éviter l’écho, choisissez un fichier ou un onglet ci-dessous.');
      showToast('Choisissez une source synchronisée.');
      get('sharingModal')?.close();
      get('sourceModal').showModal();
    }
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) ping(); });
  setInterval(ping, 2000); connect();
})();
