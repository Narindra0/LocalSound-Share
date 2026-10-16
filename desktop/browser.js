'use strict';
(() => {
  const get = id => document.getElementById(id), api = window.youtubeBrowser;
  let current;
  api.onState(state => {
    current = state;
    get('expand').setAttribute('aria-label', state.expanded ? 'Réduire le lecteur' : 'Agrandir le lecteur');
    get('expand').title = state.expanded ? 'Réduire le lecteur' : 'Agrandir le lecteur';
    get('expand').textContent = state.expanded ? '⤡' : '⤢';
    if (document.activeElement !== get('address')) get('address').value = state.url || '';
    get('back').disabled = !state.canGoBack; get('forward').disabled = !state.canGoForward;
    get('status').textContent = state.error || (state.loading ? 'Chargement…' : state.captured ? 'YouTube · Partage synchronisé' : 'YouTube · Son direct coupé, cliquez sur Diffuser');
    get('pageTitle').textContent = state.title || 'Votre sélection.';
  });
  get('navigationForm').addEventListener('submit', async event => {
    event.preventDefault();
    try { await api.navigate(get('address').value); get('address').blur(); }
    catch (err) { get('status').textContent = err.message; }
  });
  for (const action of ['back', 'forward', 'reload', 'home', 'expand', 'hide', 'close']) get(action).addEventListener('click', () => api.action(action).catch(err => { get('status').textContent = err.message; }));
  get('shareBrowser').addEventListener('click', () => api.action('share'));
  get('address').addEventListener('keydown', event => { if (event.key === 'Escape') { get('address').value = current?.url || ''; get('address').blur(); } });
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') { event.preventDefault(); get('address').focus(); get('address').select(); }
  });
})();
