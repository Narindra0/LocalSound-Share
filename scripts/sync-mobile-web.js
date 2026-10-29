'use strict';
// Recopie l'interface web (`public/`) dans les assets de l'app mobile : le
// téléphone hôte sert exactement les mêmes pages que le PC hôte, sans réseau.
//
//   npm run mobile:web     (à relancer après toute modification de public/)
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'public');
const target = path.join(root, 'Mobile', 'assets', 'web');
// Fichiers générés à la construction du PC : inutiles dans l'APK.
const skip = new Set(['third-party.html', 'vendor/opus-decoder.min.js', 'vendor/opus-decoder.min.js.map']);

const copied = [];

function copy(directory, prefix = '') {
  fs.mkdirSync(path.join(target, prefix), { recursive: true });
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relative = prefix ? prefix + '/' + entry.name : entry.name;
    if (skip.has(relative)) continue;
    if (entry.isDirectory()) { copy(path.join(directory, entry.name), relative); continue; }
    fs.copyFileSync(path.join(directory, entry.name), path.join(target, relative));
    copied.push(relative);
  }
}

if (!fs.existsSync(source)) {
  console.error('Interface web introuvable : ' + source);
  process.exitCode = 1;
} else {
  fs.rmSync(target, { recursive: true, force: true });
  copy(source);
  copied.sort();
  // Liste lue par l'app à l'exécution : Flutter ne sait pas énumérer ses assets.
  fs.writeFileSync(path.join(root, 'Mobile', 'assets', 'web_manifest.json'), JSON.stringify(copied, null, 2) + '\n');
  console.log(`${copied.length} fichier(s) copié(s) vers Mobile/assets/web`);
}
