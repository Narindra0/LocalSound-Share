'use strict';
const { Worker, isMainThread, parentPort } = require('node:worker_threads');
const MODES = Object.freeze({ high:192000, standard:128000, economy:96000, original:0 });
const FRAME = 960, LOOKAHEAD = 120; // Pinned libopus 1.4, RESTRICTED_LOWDELAY at 48 kHz (verified by signal tests).
if (isMainThread) {
  class OpusStream {
    constructor(onPacket, onError) { this.onPacket = onPacket; this.onError = onError; this.epoch = 1; this.pending = 0; this.worker = null; }
    reset() { this.epoch++; }
    push(pcm, capturedAt, playAt, generation, bitrate) {
      if (!this.worker) {
        const worker = this.worker = new Worker(__filename);
        worker.on('message', msg => {
          if (this.worker !== worker) return;
          if (msg.done) this.pending = Math.max(0, this.pending - msg.done);
          if (msg.epoch !== this.epoch) return;
          if (msg.packet) this.onPacket(Buffer.from(msg.packet));
          if (msg.error) this.fail(worker, msg.error);
        });
        worker.on('error', err => this.fail(worker, err.message));
        worker.on('exit', code => { if (this.worker === worker) this.fail(worker, 'Encodeur Opus interrompu (' + code + ').'); });
      }
      // At most 200 ms in flight. A stalled encoder must never build an unbounded delay.
      if (this.pending + pcm.length > 38400) { this.reset(); return; }
      const bytes = Uint8Array.from(pcm);
      this.pending += bytes.byteLength;
      this.worker.postMessage({ pcm:bytes.buffer, capturedAt, playAt, generation, bitrate, epoch:this.epoch }, [bytes.buffer]);
    }
    fail(worker, message) {
      if (this.worker !== worker) return;
      this.worker = null; this.reset(); worker.terminate(); this.onError(message);
    }
    async close() { const worker = this.worker; this.worker = null; this.reset(); await worker?.terminate(); }
  }
  module.exports = { OpusStream, MODES, FRAME, LOOKAHEAD };
} else {
  const Opus = require('opusscript');
  let encoder, epoch, streamID, remainder = Buffer.alloc(0), capturedAt, playAt, sequence = 0;
  parentPort.on('message', msg => {
    try {
      if (epoch !== msg.epoch) {
        encoder?.delete(); encoder = new Opus(48000, 2, Opus.Application.RESTRICTED_LOWDELAY);
        encoder.setBitrate(msg.bitrate); encoder.encoderCTL(4006, 0); encoder.encoderCTL(4010, 5);
        epoch = msg.epoch; streamID = (epoch * 65536) >>> 0; remainder = Buffer.alloc(0); sequence = 0;
      }
      if (!remainder.length) { capturedAt = msg.capturedAt; playAt = msg.playAt; }
      else if (Math.abs(msg.capturedAt - capturedAt - remainder.length / 192) > 35 || Number.isFinite(msg.playAt) !== Number.isFinite(playAt)) {
        encoder.encoderCTL(4028, 0); streamID = (streamID + 1) >>> 0; remainder = Buffer.alloc(0); capturedAt = msg.capturedAt; playAt = msg.playAt;
      }
      const pcm = Buffer.concat([remainder, Buffer.from(msg.pcm)]);
      let cursor = 0;
      while (cursor + FRAME * 4 <= pcm.length) {
        const encoded = encoder.encode(pcm.subarray(cursor, cursor + FRAME * 4), FRAME);
        const packet = Buffer.alloc(40 + encoded.length);
        packet.write('LSO3'); packet.writeUInt32LE(sequence++ >>> 0, 4);
        packet.writeDoubleLE(capturedAt + cursor / 192, 8); packet.writeDoubleLE(playAt + cursor / 192, 16);
        packet.writeUInt32LE(streamID, 24); packet.writeUInt32LE(msg.generation >>> 0, 28);
        packet.writeUInt16LE(FRAME, 32); packet.writeUInt16LE(LOOKAHEAD, 34); packet.writeUInt32LE(msg.bitrate, 36);
        encoded.copy(packet, 40);
        const transfer = Uint8Array.from(packet);
        parentPort.postMessage({ epoch, packet:transfer.buffer }, [transfer.buffer]); cursor += FRAME * 4;
      }
      remainder = Buffer.from(pcm.subarray(cursor)); capturedAt += cursor / 192; playAt += cursor / 192;
      parentPort.postMessage({ epoch:msg.epoch, done:msg.pcm.byteLength });
    } catch (err) { parentPort.postMessage({ epoch:msg.epoch, error:err.message }); }
  });
}
