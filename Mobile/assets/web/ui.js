'use strict';
let toastTimeout;
function showToast(text) {
  let toast = document.getElementById('toast');
  if (!toast) { toast = document.createElement('div'); toast.id = 'toast'; toast.className = 'toast'; toast.setAttribute('role', 'status'); document.body.appendChild(toast); }
  toast.textContent = text; toast.hidden = false;
  clearTimeout(toastTimeout); toastTimeout = setTimeout(() => { toast.hidden = true; }, 3000);
}

const sourceDialog = document.getElementById('sourceModal');
document.getElementById('chooseSourceBtn')?.addEventListener('click', () => sourceDialog.showModal());
document.getElementById('closeSourceModal')?.addEventListener('click', () => sourceDialog.close());
const sharingDialog = document.getElementById('sharingModal');
const diagnosticDialog = document.getElementById('diagnosticModal');
const audioDialog = document.getElementById('audioModal');
const requestsDialog = document.getElementById('requestsModal');
const personalStyleDialog = document.getElementById('personalStyleModal');
const youtubeSourceDialog = document.getElementById('youtubeSourceModal');
document.getElementById('openPersonalStyle')?.addEventListener('click', () => personalStyleDialog.showModal());
document.getElementById('closePersonalStyle')?.addEventListener('click', () => personalStyleDialog.close());
document.getElementById('openRequestsModal')?.addEventListener('click', () => requestsDialog.showModal());
document.getElementById('closeRequestsModal')?.addEventListener('click', () => requestsDialog.close());
document.getElementById('openSharingModal')?.addEventListener('click', () => sharingDialog.showModal());
document.getElementById('closeSharingModal')?.addEventListener('click', () => sharingDialog.close());
document.getElementById('openDiagnosticModal')?.addEventListener('click', () => diagnosticDialog.showModal());
document.getElementById('closeDiagnosticModal')?.addEventListener('click', () => diagnosticDialog.close());
document.getElementById('openAudioModal')?.addEventListener('click', () => audioDialog.showModal());
document.getElementById('closeAudioModal')?.addEventListener('click', () => audioDialog.close());
for (const dialog of [sourceDialog, sharingDialog, diagnosticDialog, audioDialog, requestsDialog, personalStyleDialog, youtubeSourceDialog]) dialog?.addEventListener('click', event => {
  if (event.target === dialog) {
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  }
});
for (const id of ['sourceTabBtn', 'sourceSystemBtn', 'stopTabBtn']) document.getElementById(id)?.addEventListener('click', () => sourceDialog?.close());
document.getElementById('musicFile')?.addEventListener('change', () => sourceDialog?.close());
document.querySelector('label[for="musicFile"]')?.addEventListener('keydown', event => {
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); document.getElementById('musicFile').click(); }
});

const requestedSection = document.getElementById(location.hash.slice(1));
if (requestedSection?.tagName === 'DETAILS') {
  const parentDialog = requestedSection.closest('dialog');
  if (parentDialog && !parentDialog.open) parentDialog.showModal();
  requestedSection.open = true; requestedSection.scrollIntoView({ block: 'start' });
}
