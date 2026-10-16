'use strict';
// Capture de l’onglet : sortie volontairement silencieuse, aucun microphone utilisé.
class TabPCMSource extends AudioWorkletProcessor {
  constructor() { super(); this.samples = new Int16Array(960); this.frames = 0; this.startTime = 0; }
  process(inputs) {
    const input = inputs[0];
    if (!input?.length || !input[0]?.length) return true;
    const left = input[0], right = input[1] || left;
    for (let i = 0; i < left.length; i++) {
      if (!this.frames) this.startTime = currentTime + i / sampleRate;
      this.samples[this.frames * 2] = Math.round(Math.max(-1, Math.min(1, left[i])) * 32767);
      this.samples[this.frames * 2 + 1] = Math.round(Math.max(-1, Math.min(1, right[i])) * 32767);
      this.frames++;
      if (this.frames === 480) {
        this.port.postMessage({ samples: this.samples.buffer, time: this.startTime }, [this.samples.buffer]);
        this.samples = new Int16Array(960); this.frames = 0;
      }
    }
    return true;
  }
}
registerProcessor('tab-pcm-source', TabPCMSource);
