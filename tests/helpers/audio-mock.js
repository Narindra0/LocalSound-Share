'use strict';
class Param {
  constructor(value = 1) { this.value = value; this.events = []; }
  setValueAtTime(value, time) { this.events.push({ value, time }); this.value = value; }
  linearRampToValueAtTime(value, time) { this.events.push({ value, time }); }
  cancelScheduledValues(time) { this.events = this.events.filter(e => e.time < time); }
  setTargetAtTime(value) { this.value = value; }
}
class MockContext {
  constructor() { this.currentTime = 0; this.state = 'running'; this.sources = []; this.destination = {}; }
  resume() { this.state = 'running'; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
  createGain() { return { gain: new Param(), connect() {}, disconnect() {} }; }
  createBuffer(channels, frames, rate) {
    const data = Array.from({ length: channels }, () => new Float32Array(frames));
    return { getChannelData(i) { return data[i]; }, duration: frames / rate };
  }
  createBufferSource() {
    const source = { playbackRate: new Param(), connect() {}, disconnect() {},
      start(time) { this.startTime = time; }, stop(time) { this.stopTime = time; } };
    this.sources.push(source); return source;
  }
  advance(time) {
    this.currentTime = time;
    for (const source of this.sources) {
      if (!source.ended && (source.stopTime ?? (source.startTime + source.buffer.duration / source.playbackRate.value)) <= time) {
        source.ended = true; source.onended?.();
      }
    }
    this.sources = this.sources.filter(s => !s.ended);
  }
}
module.exports = { MockContext };
