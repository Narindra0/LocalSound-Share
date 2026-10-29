'use strict';
importScripts('/vendor/opus-decoder.min.js');
const decoder = new self['opus-decoder'].OpusDecoder({ channels:2, sampleRate:48000 });
let chain = decoder.ready.then(() => postMessage({ type:'ready' })), epoch = null, generation = null;
chain.catch(err => postMessage({ type:'error', message:err.message }));
onmessage = ({ data }) => {
  chain = chain.then(async () => {
    if (data.type === 'flush') { epoch = null; generation = null; return; }
    const view = new DataView(data.packet);
    const nextEpoch = view.getUint32(24, true), nextGeneration = view.getUint32(28, true);
    if (data.reset || epoch !== nextEpoch || generation !== nextGeneration) {
      await decoder.reset(); epoch = nextEpoch; generation = nextGeneration;
    }
    const decoded = decoder.decodeFrame(new Uint8Array(data.packet, 40));
    if (decoded.errors.length || decoded.samplesDecoded !== view.getUint16(32, true)) throw new Error('Trame Opus invalide.');
    const [left, right] = decoded.channelData;
    postMessage({ type:'audio', token:data.token, left, right,
      capturedAt:view.getFloat64(8, true), playAt:view.getFloat64(16, true) - view.getUint16(34, true) / 48 }, [left.buffer, right.buffer]);
  }).catch(err => postMessage({ type:'error', message:err.message }));
};
