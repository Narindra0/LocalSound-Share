'use strict';
const { randomUUID } = require('node:crypto');
const { cleanText } = require('./media-info');
const { youtubeVideoId } = require('./youtube-info');
function createSongRequests({ now = Date.now } = {}) {
  let items = [];
  let revision = 0;
  const lastSubmission = new Map();
  const active = item => ['pending','accepted'].includes(item.status);
  const failure = (status, message) => { const error = new Error(message); error.status = status; throw error; };
  return {
    snapshot() {
      return { items:items.map(item=>({...item})), count:items.filter(active).length, revision };
    },
    add(data, address) {
      if (!data || typeof data.title !== 'string' || !cleanText(data.title) || data.title.length > 160 || (data.name != null && (typeof data.name !== 'string' || data.name.length > 32)) || (data.url != null && (typeof data.url !== 'string' || data.url.length > 2048))) failure(400,'Indiquez un titre de 160 caractères maximum et un prénom de 32 caractères maximum.');
      const title = cleanText(data.title,160), name = cleanText(data.name,32) || 'Un auditeur';
      const id = data.url?.trim() ? youtubeVideoId(data.url.trim()) : null;
      if (data.url?.trim() && !id) failure(400,'Le lien doit être une vidéo YouTube valide.');
      const url = id ? 'https://www.youtube.com/watch?v='+id : null;
      const duplicate = items.some(item=>active(item) && ((url && item.url === url) || item.title.toLocaleLowerCase() === title.toLocaleLowerCase()));
      if (duplicate) failure(409,'Ce morceau figure déjà dans les demandes.');
      if (items.filter(active).length >= 30) failure(409,'La liste est pleine. Attendez que l’hôte traite quelques demandes.');
      const time = now();
      if (lastSubmission.has(address) && time-lastSubmission.get(address) < 10000) failure(429,'Attendez quelques secondes avant de proposer un autre morceau.');
      for (const [key, submitted] of lastSubmission) if (time-submitted >= 10000) lastSubmission.delete(key);
      if (lastSubmission.size >= 256 && !lastSubmission.has(address)) failure(429,'Beaucoup de demandes arrivent. Réessayez dans quelques secondes.');
      lastSubmission.set(address,time);
      const item = { id:randomUUID(), title, name, url, status:'pending', createdAt:time, updatedAt:time };
      items.push(item); revision++; return {...item};
    },
    update(id, status) {
      const item = items.find(value=>value.id === id);
      if (!item) failure(404,'Cette demande n’est plus disponible.');
      if (!['accepted','played','declined'].includes(status)) failure(400,'Choisissez une action valide.');
      if (!((item.status === 'pending' && ['accepted','declined'].includes(status)) || (item.status === 'accepted' && ['played','declined'].includes(status)))) failure(409,'Cette demande a déjà été traitée.');
      item.status = status; item.updatedAt = now();
      const history = items.filter(value=>!active(value)).sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,10);
      items = items.filter(value=>active(value) || history.includes(value));
      revision++;
      return {...item};
    },
  };
}
module.exports = { createSongRequests };
