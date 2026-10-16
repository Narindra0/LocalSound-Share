'use strict';
(() => {
  const get = id => document.getElementById(id);
  let player, apiPromise, currentId = '', revision = 0;
  function videoId(value) {
    try {
      const url = new URL(value);
      if (!['https:', 'http:'].includes(url.protocol) || url.port || url.username || url.password) return null;
      let id;
      if (['youtu.be', 'www.youtu.be'].includes(url.hostname)) id = url.pathname.slice(1).split('/')[0];
      else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'www.youtube-nocookie.com', 'youtube-nocookie.com'].includes(url.hostname)) id = url.pathname === '/watch' ? url.searchParams.get('v') : /^\/(?:shorts|embed|live)\/([^/]+)/.exec(url.pathname)?.[1];
      return /^[\w-]{11}$/.test(id || '') ? id : null;
    } catch (_) { return null; }
  }
  function loadApi() {
    if (window.YT?.Player) return Promise.resolve();
    if (apiPromise) return apiPromise;
    apiPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('YouTube ne répond pas. Vérifiez la connexion puis réessayez.')), 12000);
      window.onYouTubeIframeAPIReady = () => { clearTimeout(timer); resolve(); };
      const script = document.createElement('script'); script.src = 'https://www.youtube.com/iframe_api';
      script.onerror = () => { clearTimeout(timer); reject(new Error('Le lecteur YouTube est inaccessible.')); };
      document.head.append(script);
    }).catch(err => { apiPromise = null; throw err; });
    return apiPromise;
  }
  function notify() {
    if (window.opener && !window.opener.closed) window.opener.postMessage({ type: 'localsound:youtube-video', url: 'https://www.youtube.com/watch?v=' + currentId }, location.origin);
  }
  async function load() {
    const id = videoId(get('videoUrl').value.trim());
    if (!id) { get('videoStatus').textContent = 'Collez un lien de vidéo YouTube valide.'; return; }
    const version = ++revision;
    get('videoStatus').textContent = 'Chargement du lecteur YouTube…';
    try {
      await loadApi(); if (version !== revision) return;
      currentId = id;
      if (player) { player.cueVideoById(id); notify(); }
      else player = new YT.Player('youtubePlayer', {
        host: 'https://www.youtube-nocookie.com', videoId: id,
        playerVars: { origin: location.origin, playsinline: 1, autoplay: 0 },
        events: {
          onReady: () => { get('videoStatus').textContent = 'Vidéo prête. Lancez la lecture, puis partagez cet onglet depuis la console.'; notify(); },
          onStateChange: () => { const next = videoId(player.getVideoUrl()); if (next && next !== currentId) { currentId = next; notify(); } },
          onError: event => { get('videoStatus').textContent = [101, 150].includes(event.data) ? 'Cette vidéo ne permet pas la lecture intégrée. Choisissez une autre vidéo ou utilisez le partage d’onglet YouTube classique.' : 'YouTube ne peut pas lire cette vidéo (code ' + event.data + '). Essayez une autre vidéo.'; }
        }
      });
      get('videoStatus').textContent = 'Vidéo chargée. Utilisez les commandes du lecteur YouTube.';
    } catch (err) { get('videoStatus').textContent = err.message; }
  }
  get('videoForm').addEventListener('submit', event => { event.preventDefault(); load(); });
  get('returnToHost').addEventListener('click', event => { if (window.opener && !window.opener.closed) { event.preventDefault(); window.opener.focus(); } });
  const initial = new URLSearchParams(location.search).get('url');
  if (initial) { get('videoUrl').value = initial; load(); }
  window.addEventListener('pagehide', () => player?.destroy());
})();
