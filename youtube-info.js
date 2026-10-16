'use strict';
const { cleanText, cleanTrackTitle } = require('./media-info');
const { imageType } = require('./artwork');
function youtubeVideoId(value) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase();
    let id;
    if (['youtu.be', 'www.youtu.be'].includes(host)) id = url.pathname.slice(1).split('/')[0];
    else if (['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com','www.youtube-nocookie.com','youtube-nocookie.com'].includes(host)) {
      id = url.pathname === '/watch' ? url.searchParams.get('v') : /^\/(?:shorts|embed|live)\/([^/]+)/.exec(url.pathname)?.[1];
    }
    return /^[A-Za-z0-9_-]{11}$/.test(id || '') ? id : null;
  } catch (_) { return null; }
}
async function limitedBytes(response, limit) {
  if (!response.ok) throw new Error('Vidéo ou miniature YouTube indisponible.');
  const parts = []; let size = 0;
  for await (const part of response.body) {
    size += part.length;
    if (size > limit) throw new Error('La réponse YouTube est trop volumineuse.');
    parts.push(Buffer.from(part));
  }
  return Buffer.concat(parts);
}
async function readYoutubeInfo(value, fetchImpl = fetch) {
  const id = youtubeVideoId(value);
  if (!id) throw new Error('Collez un lien de vidéo YouTube valide.');
  const url = 'https://www.youtube.com/watch?v=' + id;
  const options = { signal:AbortSignal.timeout(8000), redirect:'error' };
  const response = await fetchImpl('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(url), options);
  const data = JSON.parse((await limitedBytes(response, 65536)).toString('utf8'));
  if (typeof data.title !== 'string' || !cleanText(data.title)) throw new Error('Le titre de cette vidéo est indisponible.');
  const thumbnail = new URL(data.thumbnail_url);
  if (thumbnail.protocol !== 'https:' || thumbnail.hostname !== 'i.ytimg.com' || thumbnail.username || thumbnail.password || thumbnail.port || !thumbnail.pathname.startsWith('/vi/' + id + '/')) throw new Error('La miniature de cette vidéo est indisponible.');
  const image = await limitedBytes(await fetchImpl(thumbnail.href, options), 2 * 1024 * 1024);
  if (!imageType(image)) throw new Error('La miniature YouTube ne peut pas être affichée.');
  return { title:cleanTrackTitle(data.title), artist:cleanText(data.author_name), image, url };
}
module.exports = { youtubeVideoId, readYoutubeInfo };
