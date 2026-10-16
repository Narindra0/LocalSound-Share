'use strict';
// Une image chargée remplace le macaron ; une erreur restaure le dessin original.
(() => {
  let current, revision = 0, failedUrl = null, nextRetry = 0;
  const labels = [...document.querySelectorAll('.record-label,.cassette-cover,.cd-cover,.reel-cover,.mp3-cover,.radio-cover')];
  function status(state,text) {
    document.body.dataset.artworkState=state;
    const hint=document.getElementById('artworkStatus');if(hint)hint.textContent=text;
  }
  window.updateRecordArtwork = metadata => {
    const candidate = metadata?.artwork;
    const url = typeof candidate === 'string' && /^\/api\/artwork\/[a-f0-9]{64}$/.test(candidate) ? candidate : null;
    if (url === current) return;
    if (url && url===failedUrl && Date.now()<nextRetry) return;
    current = url; const version = ++revision;
    for (const label of labels) label.classList.remove('has-artwork');
    if (!url) { status('missing','Aucune pochette reçue. Pour YouTube, collez le lien de la vidéo ci-dessus ; vous pouvez aussi choisir une image.');return; }
    status('loading','Chargement de la miniature…');
    const image = new Image();
    image.onload = () => {
      if (version !== revision) return;
      for (const label of labels) {
        let cover = label.querySelector('.record-artwork');
        if (!cover) { cover = document.createElement('img'); cover.className = 'record-artwork'; cover.alt = ''; label.appendChild(cover); }
        cover.src = url; label.classList.add('has-artwork');
      }
      failedUrl=null;status('ready','La miniature est chargée et partagée avec les auditeurs.');
    };
    image.onerror = () => { if (version === revision) {current=null;failedUrl=url;nextRetry=Date.now()+15000;status('error','La miniature n’a pas pu être chargée. Récupérez-la à nouveau depuis le lien YouTube ou choisissez une image.');} };
    image.src = url;
  };
})();
