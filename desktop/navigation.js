'use strict';
const { youtubeVideoId } = require('../youtube-info');
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be']);
function allowedPage(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      (YOUTUBE_HOSTS.has(url.hostname) || ['accounts.google.com', 'consent.google.com', 'consent.youtube.com'].includes(url.hostname));
  } catch (_) { return false; }
}
function navigationTarget(value = '') {
  const text = String(value).trim().slice(0, 2048);
  if (!text) return 'https://www.youtube.com/';
  const candidate = /^(?:www\.)?(?:youtube\.com|youtu\.be|music\.youtube\.com)\//i.test(text) ? 'https://' + text : text;
  if (/^[a-z][a-z\d+.-]*:/i.test(candidate)) {
    if (!allowedPage(candidate)) throw new Error('Utilisez une adresse YouTube ou recherchez un morceau.');
    return new URL(candidate).href;
  }
  return 'https://www.youtube.com/results?search_query=' + encodeURIComponent(text);
}
function videoUrl(value) {
  const id = youtubeVideoId(value);
  return id ? 'https://www.youtube.com/watch?v=' + id : null;
}
module.exports = { allowedPage, navigationTarget, videoUrl };
