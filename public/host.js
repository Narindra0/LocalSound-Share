'use strict';

/** Console hôte : pilotage Play / Pause / Stop, copie des URL, statuts en direct. */

const $ = (id) => document.getElementById(id);

let lastUrls = [];
let controlBusy = false, lastStatus = null;
let settingsDirty = false;
let metadataGeneration = null, metadataDirty = false;
let qrAddress = '', qrOptions = '';

async function refresh() {
  try {
    const res = await fetch('/api/status', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    render(await res.json());
  } catch (err) {
    $('dot').className = 'dot off';
    $('connStatus').textContent = 'Serveur injoignable';
    $('liveTag').hidden = true;
    document.body.classList.remove('is-live');
    for (const id of ['playBtn', 'pauseBtn', 'stopBtn']) $(id).disabled = true;
  }
}

function render(s) {
  if (lastStatus && (lastStatus.generation !== s.generation || (lastStatus.metadataStatus === 'youtube' && s.metadataStatus === 'detected'))) {
    $('youtubeUrl').value = ''; $('youtubeResult').textContent = '';
  }
  lastStatus = s;
  window.updateMiniPlayer?.(s);
  window.updateAppearance?.(s.appearance);
  window.updateThemeTrack?.(s.nowPlaying);
  $('dot').className = 'dot on';
  $('connStatus').textContent = 'Serveur en ligne';
  $('nowPlayingTitle').textContent = s.trackName || 'Le son du moment.';
  $('nowPlayingTitle').title = $('nowPlayingTitle').textContent;
  window.updateRecordArtwork(s.nowPlaying);
  $('hostLine').textContent = s.nowPlaying?.artist || 'Hôte : ' + s.host + ' · ' + s.audio.sampleRate / 1000 + ' kHz stereo';
  $('hostLine').title = $('hostLine').textContent;
  $('metadataStatus').textContent = ({ manual: 'Titre défini manuellement pour cette source.', file: 'Titre du fichier musical.', youtube: 'Miniature récupérée depuis le lien YouTube.', detected: 'Titre détecté dans le lecteur Windows.', ambiguous: 'Plusieurs lecteurs sont ouverts : indiquez le titre à afficher.', waiting: 'En attente du titre du lecteur.', unavailable: 'Détection Windows indisponible. Vous pouvez indiquer le titre.' })[s.metadataStatus] || '';
  if (!metadataDirty && metadataGeneration === s.generation) fillMetadata(s);

  lastUrls = s.urls.length ? s.urls : ['http://<IP-du-pc>:' + location.port];
  renderShareCode(s.urls);
  const list = $('urlList');
  list.innerHTML = '';
  for (const u of lastUrls) {
    const li = document.createElement('li');
    li.textContent = u;
    list.appendChild(li);
  }

  $('captureState').textContent = s.active ? s.sourceKind === 'file' ? 'Fichier synchronisé' : s.sourceKind === 'tab' ? 'Onglet synchronisé' : 'WASAPI actif' : 'Arrêtée';
  $('streamState').textContent = !s.active ? 'Arrêtée' : !s.playing ? 'En pause' : s.signal ? 'En direct' : 'En attente de son';
  $('playBtn').disabled = controlBusy || s.playing || s.sourceReady === false;
  $('playBtn').textContent = s.active && !s.playing ? '▶ Reprendre' : '▶ Démarrer';
  $('playBtn').setAttribute('aria-label', 'Démarrer ou reprendre la diffusion');
  $('pauseBtn').disabled = controlBusy || !s.playing;
  $('stopBtn').disabled = controlBusy || !s.active;
  if (!settingsDirty && document.activeElement !== $('syncDelay')) $('syncDelay').value = String(s.syncDelayMs);
  if (!settingsDirty && s.network) $('networkMode').value = s.network.mode;
  const network = s.network;
  $('networkDiagnostic').textContent = network ? 'Audio envoyé : ' + network.egressKbps + ' kbit/s au total · ' + network.opusListeners + ' écoute(s) Opus · ' + network.pcmListeners + ' écoute(s) PCM. ' + (network.opusAvailable ? '' : 'Le mode compatible PCM est actif.') : '';
  $('sharingSummary').textContent = s.synchronized ? 'Lecture synchronisée · délai commun ' + s.syncDelayMs + ' ms' : 'Son système · capture directe';
  $('diagnostic').textContent = s.error || (s.sourceReady === false ? 'Choisissez un fichier ou un onglet pour commencer le partage.' : s.playing && !s.signal
    ? 'Lancez de la musique sur ce PC. Si le silence persiste, vérifiez la sortie audio par défaut de Windows.'
    : s.playing ? s.synchronized ? 'Horloge commune active. L’hôte et les auditeurs suivent les mêmes dates de lecture.' : 'Le son de ce PC est partagé sur votre réseau local.' : 'La diffusion est interrompue. Cliquez sur Démarrer pour reprendre.');
  $('clients').textContent = String(s.clients);
  $('kbps').textContent = s.kbps + ' kbit/s';

  const tag = $('liveTag');
  tag.hidden = !(s.playing && s.signal);
  document.body.classList.toggle('is-live', s.playing && s.signal);
  window.refreshMiniPlayer?.();
}
function renderShareCode(addresses) {
  const key = JSON.stringify(addresses), select = $('shareAddress');
  if (key !== qrOptions) {
    const previous = select.value; select.replaceChildren();
    for (const address of addresses) { const option = document.createElement('option'); option.value = address; option.textContent = address; select.appendChild(option); }
    if (addresses.includes(previous)) select.value = previous;
    qrOptions = key;
  }
  select.hidden = !addresses.length;
  if (!addresses.length) {
    qrAddress = ''; $('shareQr').hidden = true; $('qrLink').hidden = true;
    $('qrStatus').textContent = 'Connectez le PC au réseau pour inviter vos auditeurs.';
    return;
  }
  if (select.value === qrAddress) return;
  qrAddress = select.value; $('qrStatus').textContent = 'Préparation du QR code…';
  $('shareQr').hidden = false;
  $('shareQr').src = '/api/share-code?address=' + encodeURIComponent(qrAddress);
  $('qrLink').href = qrAddress + '/listen'; $('qrLink').hidden = false;
}
$('shareAddress').addEventListener('change', () => renderShareCode(lastStatus?.urls || []));
$('shareQr').addEventListener('load', () => { $('qrStatus').textContent = 'Scannez pour rejoindre le salon.'; });
$('shareQr').addEventListener('error', () => { $('shareQr').hidden = true; $('qrStatus').textContent = 'QR code indisponible. Utilisez l’adresse du salon.'; qrAddress = ''; });

async function control(action) {
  if (controlBusy) return;
  controlBusy = true;
  if (lastStatus) render(lastStatus);
  try {
    const res = await fetch('/api/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: action }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status);
    render(data);
    showToast(action === 'play' ? 'Diffusion démarrée' : action === 'pause' ? 'Diffusion mise en pause' : 'Diffusion arrêtée');
  } catch (err) {
    $('connStatus').textContent = 'Erreur : ' + err.message;
    $('dot').className = 'dot off';
    showToast(err.message);
  } finally { controlBusy = false; if (lastStatus) render(lastStatus); }
}

$('syncDelay').addEventListener('change', () => { settingsDirty = true; });
$('networkMode').addEventListener('change', () => { settingsDirty = true; });
function fillMetadata(s) {
  $('trackTitle').value = s.nowPlaying?.title || '';
  $('trackArtist').value = s.nowPlaying?.artist || '';
}
$('openSharingModal').addEventListener('click', () => {
  metadataDirty = false; metadataGeneration = lastStatus?.generation ?? null;
  if (lastStatus) fillMetadata(lastStatus);
  $('metadataResult').textContent = '';
});
for (const id of ['trackTitle', 'trackArtist']) $(id).addEventListener('input', () => { metadataDirty = true; });
async function saveMetadata(mode) {
  $('saveMetadata').disabled = true; $('autoMetadata').disabled = true;
  try {
    const response = await fetch('/api/now-playing', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ mode, title:$('trackTitle').value, artist:$('trackArtist').value, generation:metadataGeneration }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Titre non enregistré.');
    metadataDirty = false; render(data);
    $('metadataResult').textContent = mode === 'auto' ? 'Détection automatique réactivée.' : 'Titre envoyé aux auditeurs.';
  } catch (err) { $('metadataResult').textContent = err.message; }
  finally { $('saveMetadata').disabled = false; $('autoMetadata').disabled = false; }
}
$('metadataForm').addEventListener('submit', event => { event.preventDefault(); saveMetadata('manual'); });
$('autoMetadata').addEventListener('click', () => saveMetadata('auto'));
$('youtubeForm').addEventListener('submit', async event => {
  event.preventDefault(); $('importYoutube').disabled = true;
  $('youtubeResult').textContent = 'Récupération de la miniature…';
  try {
    const response = await fetch('/api/youtube', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ url:$('youtubeUrl').value.trim(), generation:metadataGeneration }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Miniature indisponible.');
    metadataDirty = false; render(data);
    $('youtubeResult').textContent = 'Titre et miniature YouTube envoyés aux auditeurs.';
  } catch (err) { $('youtubeResult').textContent = err.message; }
  finally { $('importYoutube').disabled = false; }
});
async function changeArtwork(file) {
  const generation = metadataGeneration;
  $('coverFile').disabled = true; $('autoArtwork').disabled = true;
  let objectUrl;
  try {
    let blob;
    if (file) {
      if (file.size > 10 * 1024 * 1024 || !['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('Choisissez une image JPEG, PNG ou WebP de moins de 10 Mo.');
      objectUrl = URL.createObjectURL(file);
      const img = new Image(); img.src = objectUrl; await img.decode();
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
      const ctx = canvas.getContext('2d'), size = Math.min(img.naturalWidth, img.naturalHeight);
      ctx.fillStyle = '#f4f0e7'; ctx.fillRect(0,0,512,512);
      ctx.drawImage(img, (img.naturalWidth-size)/2, (img.naturalHeight-size)/2, size, size, 0,0,512,512);
      blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .88));
      if (!blob) throw new Error('Cette image ne peut pas être utilisée.');
    }
    const response = await fetch('/api/artwork', { method:file ? 'PUT' : 'DELETE', headers:{ 'X-Source-Generation':String(generation), ...(file ? { 'Content-Type':'application/octet-stream' } : {}) }, ...(file ? { body:blob } : {}) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Pochette indisponible.');
    render(data); $('coverResult').textContent = file ? 'Pochette envoyée aux auditeurs.' : 'Pochette automatique réactivée.';
  } catch (err) { $('coverResult').textContent = err.message; }
  finally { if (objectUrl) URL.revokeObjectURL(objectUrl); $('coverFile').disabled = false; $('autoArtwork').disabled = false; $('coverFile').value = ''; }
}
$('coverFile').addEventListener('change', event => { if (event.target.files[0]) changeArtwork(event.target.files[0]); });
$('autoArtwork').addEventListener('click', () => changeArtwork(null));
$('sharingSettingsForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('saveSharingSettings'); button.disabled = true;
  $('networkMode').disabled = true; $('syncDelay').disabled = true;
  try {
    const response = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ syncDelayMs: Number($('syncDelay').value), networkMode:$('networkMode').value }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Réglages non enregistrés.');
    settingsDirty = false; render(data); $('sharingSettingsStatus').textContent = 'Réglages appliqués : ' + $('networkMode').selectedOptions[0].textContent + ' · délai commun ' + data.syncDelayMs + ' ms.';
    showToast('Réglages de partage appliqués.');
  } catch (err) { $('sharingSettingsStatus').textContent = err.message; showToast(err.message); }
  finally { button.disabled = false; $('networkMode').disabled = false; $('syncDelay').disabled = false; }
});

// Copie de la première adresse dans le presse-papiers
$('copyBtn').addEventListener('click', async () => {
  const url = $('shareAddress').value ? $('shareAddress').value + '/listen' : lastUrls[0] || '';
  if (!url || url.includes('<')) { showToast('Aucune adresse réseau disponible. Vérifiez la connexion Wi-Fi.'); return; }
  try {
    try { await navigator.clipboard.writeText(url); }
    catch (_) {
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      let copied;
      try { copied = document.execCommand('copy'); } finally { ta.remove(); $('copyBtn').focus(); }
      if (!copied) throw new Error('Copie impossible. Sélectionnez l’adresse pour la copier.');
    }
    $('copyBtn').textContent = 'Copié ✓';
    showToast('Adresse copiée. Partagez-la avec vos auditeurs.');
  } catch (err) { showToast(err.message); }
  setTimeout(() => { $('copyBtn').textContent = 'Copier'; }, 1500);
});

$('playBtn').addEventListener('click', () => control('play'));
$('pauseBtn').addEventListener('click', () => control('pause'));
$('stopBtn').addEventListener('click', () => control('stop'));

refresh();
setInterval(refresh, 1000);
