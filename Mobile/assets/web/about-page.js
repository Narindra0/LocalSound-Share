'use strict';
(() => {
  const links = [...document.querySelectorAll('.about-navigation a')];
  const panels = [...document.querySelectorAll('[data-about-panel]')];
  const content = document.querySelector('.about-content');
  function select() {
    const id = location.hash.slice(1) || 'presentation';
    const active = panels.find(panel => panel.id === id) || panels[0];
    for (const panel of panels) panel.hidden = panel !== active;
    for (const link of links) {
      if (link.hash === '#' + active.id) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    if (active.id === 'licences') {
      const frame = active.querySelector('iframe');
      if (!frame.getAttribute('src')) frame.src = '/third-party.html';
    }
    content.scrollTop = 0;
  }
  window.addEventListener('hashchange', select);
  document.addEventListener('click', event => {
    const link = event.target.closest('a');
    if (link?.getAttribute('href') === '/third-party.html') { event.preventDefault(); location.hash = 'licences'; }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && parent !== window) { event.preventDefault(); parent.postMessage('localsound:close-about', location.origin); }
  });
  select();
})();
