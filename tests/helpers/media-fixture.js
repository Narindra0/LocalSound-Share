'use strict';
const { PNG } = require('pngjs');
const { Mp3Encoder } = require('../../mp3shim');
function coverPng() {
  const image = new PNG({ width:256, height:256 });
  for (let y=0; y<256; y++) for (let x=0; x<256; x++) {
    const i=(y*256+x)*4, ring=Math.floor(Math.hypot(x-128,y-128)/18)%2;
    const color=ring ? [163,75,50] : [232,210,166];
    image.data.set([...color,255], i);
  }
  return PNG.sync.write(image);
}
function taggedMp3(picture = coverPng()) {
  const frame = (id, data) => { const header=Buffer.alloc(10); header.write(id);header.writeUInt32BE(data.length,4);return Buffer.concat([header,data]); };
  const text = (id, value) => frame(id, Buffer.concat([Buffer.from([0]),Buffer.from(value,'latin1')]));
  const payload=Buffer.concat([text('TIT2','Le salon en couleurs'),text('TPE1','LocalSound Ensemble'),frame('APIC',Buffer.concat([Buffer.from([0]),Buffer.from('image/png\0'),Buffer.from([3,0]),picture]))]);
  const header=Buffer.from([73,68,51,3,0,0,0,0,0,0]);
  for(let i=0;i<4;i++) header[9-i]=(payload.length >>> (7*i))&127;
  const encoder=new Mp3Encoder(2,48000,128), samples=new Int16Array(1152), parts=[header,payload];
  for(let i=0;i<50;i++) parts.push(Buffer.from(encoder.encodeBuffer(samples,samples)));
  parts.push(Buffer.from(encoder.flush()));
  return Buffer.concat(parts);
}
module.exports={coverPng,taggedMp3};
