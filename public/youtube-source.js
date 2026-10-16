'use strict';
(() => {
  const get = id => document.getElementById(id);
  const dialog = get('youtubeSourceModal');
  const desktop = window.localsoundDesktop;
  let nativeOpened = false;
  let playerWindow, videoUrl = '', sharingYoutube = false, preparing = false, importRevision = 0;
  const note = text => { get('youtubeSourceStatus').textContent = text; };
  function openDialog(url) {
    for (const other of document.querySelectorAll('dialog[open]')) other.close();
    if (url) get('embeddedYoutubeUrl').value = url;
    dialog.showModal();
  }
  window.openYoutubeSource = openDialog;
  get('sourceYoutubeBtn').addEventListener('click', () => openDialog());
  get('closeYoutubeSource').addEventListener('click', () => dialog.close());
  get('youtubeSourceForm').addEventListener('submit', async event => {
    event.preventDefault();
    const url = get('embeddedYoutubeUrl').value.trim();
    if (desktop) {
      try {
        await desktop.openYoutube(url); nativeOpened = true;
        get('shareYoutubePlayer').disabled = false;
        dialog.close();
        if (!sharingYoutube && !preparing) get('shareYoutubePlayer').click();
        note('YouTube utilise le partage synchronisé. L’écoute locale passe par le même salon que les auditeurs.');
      } catch (err) { note(err.message); }
      return;
    }
    // La validation exacte du lien se fait aussi dans le lecteur et sur le serveur.
    try {
      const parsed = new URL(url);
      if (!['https:', 'http:'].includes(parsed.protocol) || !['youtu.be', 'www.youtu.be', 'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'].includes(parsed.hostname) || parsed.username || parsed.password || parsed.port) throw new Error();
    } catch (_) { note('Collez un lien de vidéo YouTube valide.'); return; }
    playerWindow = window.open('/youtube-player.html?url=' + encodeURIComponent(url), 'localsound-youtube');
    if (!playerWindow) { note('Autorisez l’ouverture du lecteur dans le navigateur puis réessayez.'); return; }
    videoUrl = '';
    note('Lancez la vidéo dans le lecteur LocalSound, puis revenez ici pour partager son onglet.');
    get('shareYoutubePlayer').disabled = false;
  });
  async function importMetadata() {
    const revision = ++importRevision;
    if (!sharingYoutube || !videoUrl) return;
    try {
      const state = await (await fetch('/api/status', { cache: 'no-store' })).json();
      if (state.sourceKind !== 'tab' || revision !== importRevision) return;
      const response = await fetch('/api/youtube', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: videoUrl, generation: state.generation }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Titre indisponible.');
      if (revision === importRevision) note('Lecteur partagé. Son titre et sa miniature sont envoyés au salon.');
    } catch (err) { if (revision === importRevision) note('Le partage audio reste actif. ' + err.message); }
  }
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== playerWindow || event.data?.type !== 'localsound:youtube-video') return;
    if (!/^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}$/.test(event.data.url || '')) return;
    if (videoUrl === event.data.url) return;
    videoUrl = event.data.url; get('embeddedYoutubeUrl').value = videoUrl;
    if (sharingYoutube) importMetadata();
  });
  get('shareYoutubePlayer').addEventListener('click', () => {
    if (sharingYoutube || preparing) { dialog.close(); if (desktop) desktop.showYoutubePanel(true).catch(() => {}); return; }
    if (desktop ? !nativeOpened : !playerWindow || playerWindow.closed) { note('Ouvrez d’abord le lecteur YouTube.'); return; }
    if (get('sourceTabBtn').disabled) { note('Connexion au serveur en cours. Réessayez dans un instant.'); return; }
    preparing = true;
    dialog.close();
    if (desktop) get('sourceTabBtn').dispatchEvent(new CustomEvent('click', { detail: { desktopYoutube: true } }));
    else get('sourceTabBtn').click();
  });
  window.addEventListener('localsound:tab-ready', () => {
    sharingYoutube = preparing; preparing = false;
    if (sharingYoutube) importMetadata();
    if (sharingYoutube && desktop) desktop.showYoutubePanel(true).catch(() => {});
  });
  window.addEventListener('localsound:tab-stopped', () => { preparing = false; sharingYoutube = false; importRevision++; });
  if (desktop) {
    const input = get('embeddedYoutubeUrl'); input.type = 'text'; input.required = false;
    input.placeholder = 'Rechercher un morceau, coller un lien ou ouvrir l’accueil';
    dialog.querySelector('label[for="embeddedYoutubeUrl"]').textContent = 'Recherche ou adresse YouTube';
    get('youtubeSourceTitle').textContent = 'YouTube, dans votre console.';
    dialog.querySelector('.help').textContent = 'Un lecteur compact pour la musique, à agrandir pour explorer YouTube.';
    dialog.querySelector('.youtube-source-form + .field-hint').textContent = 'Le partage synchronisé démarre à l’ouverture. Choisissez votre vidéo : l’hôte et les auditeurs écoutent le même salon. Vous pouvez masquer le lecteur sans arrêter la musique.';
    const panelButton = document.createElement('button'); panelButton.id = 'toggleYoutubePanel'; panelButton.type = 'button'; panelButton.className = 'btn-ghost youtube-panel-toggle'; panelButton.hidden = true;
    panelButton.textContent = 'Afficher YouTube ↗';
    get('chooseSourceBtn').after(panelButton);
    let panelVisible = false;
    const panelStatus = data => { nativeOpened = Boolean(data.open); panelVisible = Boolean(data.visible); panelButton.hidden = !data.open; panelButton.textContent = data.visible ? 'Masquer YouTube' : 'Afficher YouTube ↗'; };
    desktop.onYoutubePanel(panelStatus); desktop.youtubePanelState().then(panelStatus).catch(() => {});
    panelButton.addEventListener('click', () => desktop.showYoutubePanel(!panelVisible).catch(err => note(err.message)));
    const syncOverlay = () => desktop.obscureYoutubePanel(Boolean(document.querySelector('dialog[open]'))).catch(() => {});
    const observer = new MutationObserver(syncOverlay);
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] }); syncOverlay();
    window.addEventListener('pagehide', () => observer.disconnect());
    desktop.onYoutubeVideo(data => {
      if (!/^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}$/.test(data?.url || '')) return;
      if (videoUrl === data.url) return;
      videoUrl = data.url; input.value = videoUrl;
      if (sharingYoutube) importMetadata();
    });
    desktop.onShareYoutube(() => { nativeOpened = true; get('shareYoutubePlayer').disabled = false; openDialog(); });
    desktop.onYoutubeClosed(() => {
      nativeOpened = false; get('shareYoutubePlayer').disabled = true;
      preparing = false; sharingYoutube = false; importRevision++; videoUrl = '';
      window.dispatchEvent(new Event('localsound:desktop-source-closed'));
      note('Navigateur fermé. Rouvrez-le pour partager une vidéo.');
    });
  }
})();
