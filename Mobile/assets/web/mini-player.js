'use strict';
(() => {
  const host = document.body.classList.contains('host-page');
  const desktop = window.localsoundDesktop || window.localsoundListener;
  const get = id => document.getElementById(id);
  let state, miniWindow, panel, timer, opening = false;
  const launcher = document.createElement('button');
  launcher.id = 'openMiniPlayer'; launcher.className = 'personal-style-button mini-launcher';
  launcher.type = 'button'; launcher.textContent = 'Mini-lecteur ↗';
  document.querySelector('.header-inner').append(launcher);
  function close() {
    const embedded = document.body.classList.contains('mini-native-embedded');
    clearInterval(timer); timer = null;
    if (miniWindow && !miniWindow.closed) miniWindow.close();
    miniWindow = null; panel?.remove(); panel = null;
    if (embedded) { document.body.classList.remove('mini-native-embedded', 'mini-window', 'mini-compact'); desktop.restorePlayer().catch(() => {}); }
    launcher.textContent = 'Mini-lecteur ↗'; launcher.setAttribute('aria-expanded', 'false');
  }
  function sync() {
    if (!panel) return;
    const doc = panel.ownerDocument;
    doc.body.dataset.palette = document.body.dataset.palette || 'terracotta';
    panel.querySelector('[data-mini-title]').textContent = state?.trackName || 'Le son du moment.';
    panel.querySelector('[data-mini-artist]').textContent = state?.nowPlaying?.artist || 'LocalSound Share';
    panel.querySelector('[data-mini-status]').textContent = get('connStatus').textContent + ' · ' + get('streamState').textContent;
    const art = state?.nowPlaying?.artwork;
    const image = panel.querySelector('img');
    const url = /^\/api\/artwork\/[a-f0-9]{64}$/.test(art || '') ? new URL(art, location.origin).href : '';
    image.hidden = !url;
    if (url && image.src !== url) image.src = url;
    panel.classList.toggle('mini-active', document.body.classList.contains(host ? 'is-live' : 'is-listening'));
    for (const button of panel.querySelectorAll('[data-proxy]')) {
      const original = get(button.dataset.proxy);
      button.disabled = original.disabled; button.textContent = original.textContent;
      if (desktop) {
        button.title = original.textContent; button.setAttribute('aria-label', original.textContent);
        button.textContent = button.dataset.proxy === 'listenBtn' ? (original.classList.contains('listening') ? 'Ⅱ Pause' : '▶ Écouter') : ({ playBtn:'▶', pauseBtn:'Ⅱ', stopBtn:'■', hostListenBtn: original.textContent.startsWith('Couper') ? 'Couper ici' : 'Écouter ici' })[button.dataset.proxy];
      }
    }
    const original = get(host ? 'hostVolume' : 'volume');
    const range = panel.querySelector('input');
    if (doc.activeElement !== range) range.value = original.value;
    panel.querySelector('output').textContent = range.value + ' %';
  }
  function build(doc, floating) {
    panel = doc.createElement('section'); panel.className = 'mini-player';
    panel.setAttribute('aria-label', host ? 'Mini-lecteur hôte' : 'Mini-lecteur auditeur');
    panel.innerHTML = `<div class="mini-top"><span>LOCAL SOUND / ${host ? 'LA PLATINE' : 'LE SALON'}</span><button type="button" data-mini-close aria-label="Fermer le mini-lecteur">×</button></div>
      <div class="mini-track"><div class="mini-disc"><span>LS</span><img alt="Pochette du morceau" hidden></div><div><h2 data-mini-title></h2><p data-mini-artist></p><small data-mini-status role="status"></small></div></div>
      <div class="mini-controls">${(host ? ['playBtn', 'pauseBtn', 'stopBtn', 'hostListenBtn'] : ['listenBtn']).map(id => `<button type="button" data-proxy="${id}"></button>`).join('')}</div>
      <label class="mini-volume">Volume ici <output></output><input type="range" min="0" max="100" aria-label="Volume du mini-lecteur"></label>
      <button type="button" class="mini-return">Revenir au salon ↗</button>`;
    panel.querySelector('[data-mini-close]').addEventListener('click', close);
    panel.querySelector('.mini-return').addEventListener('click', () => { window.focus(); close(); launcher.focus(); });
    for (const button of panel.querySelectorAll('[data-proxy]')) button.addEventListener('click', () => { get(button.dataset.proxy).click(); sync(); });
    panel.querySelector('input').addEventListener('input', event => {
      const range = get(host ? 'hostVolume' : 'volume'); range.value = event.target.value;
      range.dispatchEvent(new Event('input', { bubbles: true })); sync();
    });
    if (!floating) panel.classList.add('mini-inline');
    doc.body.append(panel); sync(); timer = setInterval(sync, 400);
    launcher.textContent = 'Fermer le mini-lecteur'; launcher.setAttribute('aria-expanded', 'true');
  }
  launcher.addEventListener('click', async () => {
    if (opening) return;
    if (panel) { close(); return; }
    opening = true;
    try {
      if (desktop?.nativeCompact) {
        document.body.classList.add('mini-native-embedded', 'mini-window', 'mini-compact');
        build(document, true);
        try { await desktop.miniPlayerReady(); } catch (err) { close(); showToast(err.message); }
        return;
      }
      // Le PiP conserve le moteur audio dans la page d'origine, sans nouvel abonnement.
      if (desktop) {
        miniWindow = window.open('', 'localsound-mini-' + (host ? 'host' : 'listener'), 'popup,width=' + (host ? 340 : 320) + ',height=' + (host ? 246 : 216));
      } else if (window.documentPictureInPicture && window.isSecureContext && innerWidth >= 700) {
        try { miniWindow = await documentPictureInPicture.requestWindow({ width: 420, height: host ? 340 : 300 }); }
        catch (_) { miniWindow = null; }
      } else if (innerWidth >= 700) {
        miniWindow = window.open('', 'localsound-mini-' + (host ? 'host' : 'listener'), 'popup,width=420,height=340');
      }
      if (miniWindow) {
        const doc = miniWindow.document; doc.head.replaceChildren(); doc.body.replaceChildren();
        doc.title = 'LocalSound — Mini-lecteur'; doc.documentElement.lang = 'fr';
        const css = doc.createElement('link'); css.rel = 'stylesheet'; css.href = new URL('/player-tools.css', location.origin).href; doc.head.append(css);
        doc.body.className = desktop ? 'mini-window mini-compact' : 'mini-window';
        miniWindow.addEventListener('pagehide', () => { miniWindow = null; close(); }, { once: true });
        build(doc, true);
        if (desktop) {
          try { await desktop.miniPlayerReady(); }
          catch (err) { close(); showToast(err.message); }
        }
      } else { build(document, false); showToast('Mini-lecteur affiché dans le salon.'); }
    } finally { opening = false; }
  });
  window.updateMiniPlayer = next => { state = next; sync(); };
  window.refreshMiniPlayer = sync;
  window.closeEmbeddedMiniPlayer = close;
  window.addEventListener('pagehide', close);
})();
