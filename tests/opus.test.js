'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { WebSocket } = require('ws');
const { OpusStream, MODES, FRAME, LOOKAHEAD } = require('../opus-stream');
const { createApp } = require('../server');
function music(frames, start = 0) {
  const pcm = Buffer.alloc(frames * 4);
  for (let i=0;i<frames;i++) {
    const time = (i+start)/48000;
    for (let c=0;c<2;c++) {
      const base = c ? 523.25 : 440;
      const value = .36*Math.sin(2*Math.PI*base*time) + .2*Math.sin(2*Math.PI*base*2*time) + .13*Math.sin(2*Math.PI*110*time) + .07*Math.sin(2*Math.PI*7000*time);
      pcm.writeInt16LE(Math.round(value*32767), i*4+c*2);
    }
  }
  return pcm;
}
for (const mode of ['high','standard','economy']) test('Opus réel ' + mode + ' : débit, stéréo, qualité du signal et compensation du délai', async t => {
  const { OpusDecoder } = await import('opus-decoder');
  const decoder = new OpusDecoder(); await decoder.ready; t.after(() => decoder.free());
  let receive;
  const stream = new OpusStream(packet => receive(packet), err => { throw new Error(err); }); t.after(() => stream.close());
  const input = music(48000*2), output = [[],[]]; let bytes=0;
  for (let i=0;i<input.length;i+=FRAME*4) {
    const result = new Promise(resolve => { receive=resolve; });
    const capturedAt=1000+i/192;
    stream.push(input.subarray(i,i+FRAME*2), capturedAt, capturedAt+150, 7, MODES[mode]);
    stream.push(input.subarray(i+FRAME*2,i+FRAME*4), capturedAt+10, capturedAt+160, 7, MODES[mode]);
    const packet = await result;
    assert.equal(packet.toString('ascii',0,4),'LSO3'); assert.equal(packet.readUInt32LE(28),7);
    assert.equal(packet.readDoubleLE(16),capturedAt+150); assert.equal(packet.readUInt16LE(34),120);
    assert.equal(packet.length-40,MODES[mode]/8/50);
    bytes += packet.length;
    const decoded = decoder.decodeFrame(packet.subarray(40)); assert.equal(decoded.errors.length,0); assert.equal(decoded.samplesDecoded,FRAME);
    output.forEach((samples,c) => samples.push(...decoded.channelData[c]));
  }
  for (let c=0;c<2;c++) {
    let power=0,error=0;
    for (let n=4800;n<output[c].length-LOOKAHEAD;n++) {
      const expected=input.readInt16LE(n*4+c*2)/32768, actual=output[c][n+LOOKAHEAD];
      assert.ok(Number.isFinite(actual) && Math.abs(actual)<1.05);
      power+=expected*expected; error+=(expected-actual)**2;
    }
    const snr=10*Math.log10(power/error);
    assert.ok(snr>(mode==='high'?26:mode==='standard'?23:20),'SNR '+snr+' dB');
    t.diagnostic('Canal '+c+' : SNR '+snr.toFixed(1)+' dB, débit avec en-têtes '+(bytes*8/2000)+' kbit/s');
  }
});
test('Opus : encodage partagé, anciens lecteurs PCM, réglage à chaud et pause sans trafic', async t => {
  let emit;
  class Capture { startSystemAudio(cb) { emit=cb; } stop() {} }
  const app=createApp({Capture}); await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve)); t.after(()=>app.close());
  const base='http://127.0.0.1:'+app.server.address().port;
  const peers=await Promise.all(['opus','opus','pcm'].map(async codec=>{
    const socket=new WebSocket(base.replace('http:','ws:')); t.after(()=>socket.terminate()); await once(socket,'open');
    const ready=new Promise(resolve=>socket.on('message',(data,binary)=>{if(!binary&&JSON.parse(data).type==='meta')resolve();}));
    socket.send(JSON.stringify({type:'hello',role:'client',protocol:2,codec})); socket.send(JSON.stringify({type:'listen'})); await ready; return socket;
  }));
  app.control('play');
  const next=socket=>new Promise(resolve=>{const cb=(data,binary)=>{if(binary){socket.off('message',cb);resolve(data);}};socket.on('message',cb);});
  let results=peers.map(next); emit(music(FRAME)); let packets=await Promise.all(results);
  assert.deepEqual(packets[0],packets[1]); assert.equal(packets[0].length,520); assert.equal(packets[2].length,FRAME*4+24);
  assert.equal(app.status().network.compressedFrames,1); assert.equal(app.status().network.opusListeners,2);
  let response=await fetch(base+'/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({networkMode:'economy'})}); assert.equal(response.status,200);
  results=peers.map(next); emit(music(FRAME,FRAME)); packets=await Promise.all(results); assert.equal(packets[0].length,280);
  response=await fetch(base+'/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({networkMode:'invalid'})}); assert.equal(response.status,400); assert.equal(app.status().network.mode,'economy');
  app.control('pause'); const count=app.status().network.compressedFrames; emit(music(FRAME));
  await new Promise(resolve=>setTimeout(resolve,40)); assert.equal(app.status().network.compressedFrames,count);
  await fetch(base+'/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({networkMode:'original'})}); app.control('play');
  results=peers.map(next); emit(music(FRAME)); packets=await Promise.all(results); assert.equal(packets[0].toString('ascii',0,4),'LSP2');
});
