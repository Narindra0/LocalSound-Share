'use strict';
// Vérifie le chargeur utilisé par le serveur avec un signal stéréo à 48 kHz.
const assert = require('node:assert/strict');
const { Mp3Encoder } = require('../../mp3shim');
assert.ok(Mp3Encoder, 'Encodeur MP3 indisponible');
const encoder = new Mp3Encoder(2, 48000, 128);
const samples = new Int16Array(4800);
for (let i = 0; i < samples.length; i++) samples[i] = Math.sin(2 * Math.PI * 440 * i / 48000) * 12000;
const data = Buffer.concat([Buffer.from(encoder.encodeBuffer(samples, samples)), Buffer.from(encoder.flush())]);
assert.ok(data.length > 1000);
console.log('MP3 : ' + data.length + ' octets encodés — OK');
