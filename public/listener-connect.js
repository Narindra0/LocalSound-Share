'use strict';
(() => {
  const get = id => document.getElementById(id), api = window.localsoundListener;
  get('openJoinLegal').addEventListener('click', () => {
    const frame = get('joinLegal').querySelector('iframe');
    if (!frame.getAttribute('src')) frame.src = '/about.html';
    get('joinLegal').showModal();
  });
  get('closeJoinLegal').addEventListener('click', () => get('joinLegal').close());
  window.addEventListener('message', event => {
    if (event.origin === location.origin && event.source === get('joinLegal').querySelector('iframe').contentWindow && event.data === 'localsound:close-about') get('joinLegal').close();
  });
  if (!api) { get('joinStatus').textContent = 'Ouvrez cette page depuis l’application LocalSound Auditeur.'; get('joinRoom').disabled = true; return; }
  api.lastAddress().then(value => { get('roomAddress').value = value; }).catch(() => {});
  get('joinForm').addEventListener('submit', async event => {
    event.preventDefault(); get('joinRoom').disabled = true; get('joinStatus').textContent = 'Connexion au salon…';
    try { await api.connect(get('roomAddress').value); }
    catch (err) { get('joinStatus').textContent = err.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''); get('joinRoom').disabled = false; }
  });
})();
