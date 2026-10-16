'use strict';
// Script de validation : lance un ton WAV puis capture le loopback WASAPI.
const { exec } = require('child_process');
const path = require('path');

const wav = path.join(__dirname, '../fixtures/test-tone.wav');
exec(`powershell -NoProfile -Command "(New-Object System.Media.SoundPlayer '${wav}').PlaySync()"`);

const loopback = require('loopback-capture');
const capture = new loopback.LoopbackCapture();

let chunks = 0;
let bytes = 0;
let firstSize = 0;

capture.startSystemAudio((buf) => {
  chunks++;
  bytes += buf.length;
  if (chunks === 1) { firstSize = buf.length; console.log('Premier chunk :', buf.length, 'octets'); }
  if (chunks >= 100) {
    console.log(`SUCCES : ${chunks} chunks, ${bytes} octets recus`);
    capture.stop();
    process.exit(0);
  }
});

setTimeout(() => {
  console.log(`RESULTAT : ${chunks} chunks, ${bytes} octets (premier=${firstSize})`);
  capture.stop();
  process.exit(chunks > 0 ? 0 : 2);
}, 5000);
