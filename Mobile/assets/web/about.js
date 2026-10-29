'use strict';
(() => {
  const footer = document.querySelector('.site-footer');
  if (!footer) return;
  const button = document.createElement('button'); button.type = 'button'; button.id = 'openAbout'; button.className = 'about-launcher';
  button.textContent = 'À propos · CGU · Confidentialité'; button.setAttribute('aria-haspopup', 'dialog'); button.setAttribute('aria-controls', 'aboutModal');
  footer.lastElementChild.replaceWith(button);
  const dialog = document.createElement('dialog'); dialog.id = 'aboutModal'; dialog.className = 'sharing-dialog about-dialog'; dialog.setAttribute('aria-labelledby', 'aboutTitle');
  dialog.innerHTML = '<div class="source-dialog-heading"><span id="aboutTitle" class="overline">LOCALSOUND / À PROPOS</span><button class="close-dialog" type="button" aria-label="Revenir au lecteur">×</button></div><iframe title="À propos de LocalSound" loading="lazy"></iframe>';
  document.body.append(dialog);
  function open() { const frame = dialog.querySelector('iframe'); if (!frame.getAttribute('src')) frame.src = '/about.html'; if (!dialog.open) dialog.showModal(); }
  button.addEventListener('click', open);
  const header = document.querySelector('.header-inner');
  if (header) {
    const shortcut = document.createElement('button');
    shortcut.type = 'button'; shortcut.id = 'openAboutHeader'; shortcut.className = 'about-header-button';
    shortcut.textContent = 'À propos'; shortcut.setAttribute('aria-haspopup', 'dialog'); shortcut.setAttribute('aria-controls', 'aboutModal');
    shortcut.addEventListener('click', open); header.append(shortcut);
  }
  dialog.querySelector('button').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target !== dialog) return; const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); });
  window.addEventListener('message', event => {
    if (event.origin === location.origin && event.source === dialog.querySelector('iframe').contentWindow && event.data === 'localsound:close-about') dialog.close();
  });
})();
