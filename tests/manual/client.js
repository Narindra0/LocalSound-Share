'use strict';
// Test de bout en bout : se connecte comme auditeur et compte les chunks PCM reçus.
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:3000');

let chunks = 0;
let bytes = 0;
let gotMeta = false;

ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'hello', role: 'client' }));
  ws.send(JSON.stringify({ type: 'listen' }));
});

ws.on('message', (data, isBinary) => {
  if (isBinary) {
    chunks++;
    bytes += data.length;
  } else {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'meta') { gotMeta = true; console.log('meta recu de :', msg.host); }
    if (msg.type === 'state') { /* etat */ }
  }
});

setTimeout(() => {
  console.log(`RESULTAT WS: ${chunks} chunks binaires, ${bytes} octets, meta=${gotMeta}`);
  ws.close();
  process.exit(chunks > 10 && gotMeta ? 0 : 2);
}, 4000);
