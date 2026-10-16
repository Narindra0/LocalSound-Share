'use strict';
function listenerAddress(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048) throw new Error('Saisissez l’adresse du salon fournie par l’hôte.');
  const input = value.trim();
  let url;
  try { url = new URL(/^https?:\/\//i.test(input) ? input : 'http://' + input); } catch (_) { throw new Error('Adresse de salon invalide. Exemple : http://192.168.1.10:3000'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || /[\\\s]/.test(input) || /^[a-z]+:/i.test(input) && !/^https?:\/\//i.test(input) && !/^[\w.-]+:\d+(?:\/|$)/.test(input)) throw new Error('Utilisez une adresse HTTP ou HTTPS sans identifiants.');
  return url.origin;
}
module.exports = { listenerAddress };
