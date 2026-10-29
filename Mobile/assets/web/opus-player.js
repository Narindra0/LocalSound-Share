'use strict';
// Bundled WASM decoder: works on local HTTP addresses, without WebCodecs or a CDN.
class OpusStreamDecoder {
  constructor(output, failure) {
    this.token = 0; this.pending = 0; this.failed = false; this.decodedFrames = 0;
    this.ready = new Promise((resolve, reject) => {
      const fail = () => {
        if (this.failed) return;
        this.failed = true; clearTimeout(timer); this.worker?.terminate();
        reject(new Error('Lecture Opus indisponible.')); failure();
      };
      const timer = setTimeout(fail, 8000);
      try {
        this.worker = new Worker('/opus-decode-worker.js');
        this.worker.onerror = event => { event.preventDefault(); fail(); };
        this.worker.onmessage = ({ data }) => {
          if (data.type === 'ready') { clearTimeout(timer); resolve(); }
          else if (data.type === 'error') fail();
          else if (data.type === 'audio' && data.token === this.token) { this.pending = Math.max(0, this.pending - 1); this.decodedFrames++; output(data); }
        };
      } catch (_) { fail(); }
    });
  }
  flush() { this.token++; this.pending = 0; if (!this.failed) this.worker.postMessage({ type:'flush' }); }
  pushPacket(packet) {
    if (packet.byteLength < 41 || new DataView(packet).getUint32(0, true) !== 0x334f534c) return false;
    const view = new DataView(packet);
    if (view.getUint16(32, true) !== 960 || view.getUint16(34, true) !== 120 || !Number.isFinite(view.getFloat64(8, true))) return true;
    if (this.failed) return true;
    if (this.pending >= 8) { this.needsReset = true; return true; }
    this.pending++; this.worker.postMessage({ type:'packet', packet, token:this.token, reset:this.needsReset }, [packet]);
    this.needsReset = false; return true;
  }
}
