'use strict';
// Chargeur pour lamejs en Node : le bundle partage tout via des globales
// (ancien code navigateur concaténé). On l'exécute dans un mini-contexte vm.
const fs = require('fs');
const vm = require('vm');
let Mp3Encoder = null;
try {
  const src = fs.readFileSync(require.resolve('lamejs/lame.all.js'), 'utf8');
  const box = {};
  vm.createContext(box);
  vm.runInContext(src, box, { filename: 'lame.all.js' });
  Mp3Encoder = (box.lamejs && box.lamejs.Mp3Encoder) || box.Mp3Encoder || null;
} catch (e) {
  console.error('[audio] chargement lamejs échoué :', e.message);
}
module.exports = { Mp3Encoder };
