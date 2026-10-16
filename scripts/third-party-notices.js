'use strict';
const fs = require('node:fs'), path = require('node:path');
const { createRequire } = require('node:module');
const { ZipFile } = require('yazl');
const root = path.resolve(__dirname, '..'), publicDir = path.join(root, 'public');
fs.mkdirSync(path.join(publicDir, 'vendor'), { recursive:true });
for (const file of ['opus-decoder.min.js', 'opus-decoder.min.js.map']) fs.copyFileSync(path.join(root, 'node_modules/opus-decoder/dist', file), path.join(publicDir, 'vendor', file));
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const seen = new Set(), packages = [];
function dependencyDir(name, from) {
  let entry;
  const resolve = createRequire(path.join(from, 'package.json')).resolve;
  try { entry = resolve(name + '/package.json'); } catch (_) { entry = resolve(name); }
  let dir = path.dirname(entry);
  while (dir !== path.dirname(dir)) {
    const file = path.join(dir, 'package.json');
    if (fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).name === name) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('Licence introuvable : ' + name);
}
function visit(name, from) {
  const dir = dependencyDir(name, from); if (seen.has(dir)) return; seen.add(dir);
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const texts = fs.readdirSync(dir).filter(file => /^(licen[cs]e|copying|notice)([.-]|$)/i.test(file) && fs.statSync(path.join(dir, file)).isFile()).map(file => file + '\n\n' + fs.readFileSync(path.join(dir, file), 'utf8')).join('\n\n');
  const supplement = ['opus-decoder','@wasm-audio-decoders/common'].includes(pkg.name) ? fs.readFileSync(path.join(publicDir, 'licenses/wasm-audio-decoders-MIT.txt'), 'utf8') : '';
  packages.push({ name: pkg.name, version: pkg.version, license: typeof pkg.license === 'string' ? pkg.license : JSON.stringify(pkg.license || 'Voir les fichiers du composant'), texts:texts || supplement });
  for (const child of Object.keys(pkg.dependencies || {})) visit(child, dir);
}
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
for (const name of Object.keys(pkg.dependencies)) visit(name, root);
visit('electron', root);
packages.push({ name:'libopus (OpusScript)', version:'1.4', license:'BSD-3-Clause', texts:fs.readFileSync(path.join(root, 'node_modules/opusscript/build/COPYING.libopus'), 'utf8') });
packages.push({ name:'Microsoft WebView2 SDK (Auditeur Léger)', version:'1.0.4258.31', license:'Microsoft WebView2 SDK License', texts:fs.readFileSync(path.join(publicDir, 'licenses/WebView2-SDK.txt'), 'utf8') });
packages.sort((a, b) => a.name.localeCompare(b.name));
fs.mkdirSync(path.join(publicDir, 'licenses'), { recursive: true });
const zip = new ZipFile(), sourceDir = path.join(root, 'node_modules/lamejs');
function addSources(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) addSources(file);
    else if (entry.isFile()) zip.addFile(file, 'lamejs/' + path.relative(sourceDir, file).replace(/\\/g, '/'));
  }
}
addSources(sourceDir);
const output = fs.createWriteStream(path.join(publicDir, 'licenses/lamejs-source.zip'));
output.on('error', err => { console.error(err); process.exitCode = 1; });
zip.outputStream.on('error', err => { console.error(err); process.exitCode = 1; });
zip.outputStream.pipe(output); zip.end();
const chromium = path.join(root, 'node_modules/electron/dist/LICENSES.chromium.html');
if (!fs.existsSync(chromium)) throw new Error('Les licences Chromium doivent être installées avant la compilation.');
fs.copyFileSync(chromium, path.join(publicDir, 'licenses/chromium.html'));
const body = packages.map(item => `<article class="license-entry"><h2>${escape(item.name)} ${escape(item.version)}</h2><p>Licence : ${escape(item.license)}</p>${item.texts ? '<details><summary>Texte de licence et notices</summary><pre>' + escape(item.texts) + '</pre></details>' : '<p>Le composant est fourni avec ses métadonnées et sa licence dans les dépendances du logiciel.</p>'}</article>`).join('\n');
fs.writeFileSync(path.join(publicDir, 'third-party.html'), `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LocalSound — Licences tierces</title><link rel="stylesheet" href="/legal.css"></head><body><main class="legal-document"><a href="/about.html">← À propos et informations légales</a><p class="eyebrow">LES COMPOSANTS DU SALON</p><h1>Licences et crédits.</h1><p>Les composants ci-dessous conservent leurs auteurs, droits et licences. Leurs licences prévalent sur les conditions de l’application pour ces composants.</p><p><a href="/licenses/chromium.html">Notices Chromium et composants associés</a> · <a href="/licenses/lamejs-source.zip" download>Sources de lamejs 1.2.1 (LGPL-3.0)</a></p><p>LocalSound utilise l’encodeur LAME via lamejs. Projet LAME : <a href="https://lame.sourceforge.io/" target="_blank" rel="noopener noreferrer">lame.sourceforge.io</a>. Textes complets : <a href="/licenses/LGPL-3.0.txt">GNU LGPL 3.0</a> et <a href="/licenses/GPL-3.0.txt">GNU GPL 3.0</a>.</p><p>Les sources de lamejs sont fournies sans modification. Le fichier mp3shim.js de l’application configure ce module à l’exécution ; la bibliothèque reste séparée et remplaçable. Les droits d’étude, de modification et de débogage prévus par sa licence sont conservés. Les sources non minifiées et leurs avis sont aussi présentes dans le paquet de l’application.</p>${body}</main></body></html>`);
console.log(packages.length + ' notices de composants générées.');
