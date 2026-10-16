'use strict';
// Horloge commune en millisecondes monotones, indépendante de la date système.
class RoomClock {
  constructor() { this.reset(); }
  reset() { this.offset = null; this.rtt = Infinity; this.updatedAt = -Infinity; }
  update(clientTime, serverTime, now = performance.now()) {
    const rtt = now - clientTime;
    if (!Number.isFinite(rtt) || !Number.isFinite(serverTime) || rtt < 0 || rtt > 500) return;
    if (now - this.updatedAt > 15000) this.rtt = Infinity;
    if (rtt <= this.rtt) {
      const offset = serverTime - (clientTime + now) / 2;
      this.offset = this.offset === null ? offset : this.offset + Math.max(-1, Math.min(1, offset - this.offset));
      this.rtt = rtt; this.updatedAt = now;
    }
  }
  audioTime(context, serverTime, calibrationMs = 0) {
    if (this.offset === null) return null;
    const localTime = serverTime - this.offset + calibrationMs;
    const stamp = context.getOutputTimestamp?.();
    if (stamp && stamp.performanceTime > 0 && Number.isFinite(stamp.contextTime)) {
      return stamp.contextTime + (localTime - stamp.performanceTime) / 1000;
    }
    return context.currentTime + (localTime - performance.now()) / 1000 - (context.outputLatency || context.baseLatency || 0);
  }
}
class SynchronizedPCMPlayer {
  constructor(context, destination, { inputRate = 48000 } = {}) {
    this.context = context; this.destination = destination; this.inputRate = inputRate;
    this.nodes = new Set(); this.nextTime = 0; this.previous = null;
    this.latePackets = 0; this.resyncs = 0; this.underruns = 0; this.maxSkewMs = 0; this.targetMs = 150;
  }
  flush() {
    const now = this.context.currentTime;
    for (const node of this.nodes) {
      node.gain.gain.cancelScheduledValues(now);
      node.gain.gain.setValueAtTime(node.start > now ? 0 : 1, now);
      node.gain.gain.linearRampToValueAtTime(0, now + 0.003);
      try { node.source.stop(now + 0.003); } catch (_) {}
    }
    this.nodes.clear(); this.nextTime = 0; this.previous = null;
  }
  pushPacket(buffer, clock, calibrationMs = 0) {
    const view = new DataView(buffer);
    if (view.byteLength < 28 || view.getUint32(0, true) !== 0x3250534c) return false;
    const playAt = view.getFloat64(16, true);
    if (!Number.isFinite(playAt)) return false;
    const when = clock.audioTime(this.context, playAt, calibrationMs);
    if (when === null) return true;
    const frames = Math.floor((view.byteLength - 24) / 4);
    const left = new Float32Array(frames), right = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      left[i] = view.getInt16(24 + i * 4, true) / 32768;
      right[i] = view.getInt16(26 + i * 4, true) / 32768;
    }
    this.pushAt(left, right, when); return true;
  }
  pushAt(left, right, when) {
    const now = this.context.currentTime;
    if (this.context.state !== 'running' || !left.length) return;
    // Une échéance manquée reste manquée : ne jamais déplacer un seul auditeur en arrière.
    if (when < now + 0.003 || when > now + 0.6) { this.latePackets++; return; }
    const phase = when - this.nextTime;
    const continuous = this.previous && Math.abs(phase) < 0.004 && this.nextTime > now + 0.003;
    const start = continuous ? this.nextTime : when;
    const rate = continuous ? 1 - Math.max(-0.0003, Math.min(0.0003, phase * 0.02)) : 1;
    if (this.previous && !continuous) { this.resyncs++; if (phase > 0.004) this.underruns++; }
    this.maxSkewMs = Math.max(this.maxSkewMs, Math.abs(start - when) * 1000);
    const buffer = this.context.createBuffer(2, left.length, this.inputRate);
    buffer.getChannelData(0).set(left); buffer.getChannelData(1).set(right);
    const source = this.context.createBufferSource(), gain = this.context.createGain();
    source.buffer = buffer; source.playbackRate.value = rate; source.connect(gain); gain.connect(this.destination);
    const end = start + left.length / this.inputRate / rate;
    if (continuous && this.previous.end - now > 0.003) {
      this.previous.gain.gain.cancelScheduledValues(this.previous.end - 0.002);
      this.previous.gain.gain.setValueAtTime(1, this.previous.end - 0.002);
    }
    gain.gain.setValueAtTime(continuous ? 1 : 0, start);
    if (!continuous) gain.gain.linearRampToValueAtTime(1, start + Math.min(0.002, (end - start) / 2));
    gain.gain.setValueAtTime(1, Math.max(start, end - 0.002)); gain.gain.linearRampToValueAtTime(0, end);
    const node = { source, gain, start, end }; this.nodes.add(node); this.previous = node;
    source.onended = () => { this.nodes.delete(node); source.disconnect(); gain.disconnect(); };
    source.start(start); this.nextTime = end;
  }
  stats() {
    return { levelMs: Math.round(Math.max(0, this.nextTime - this.context.currentTime) * 1000), targetMs: this.targetMs,
      underruns: this.underruns, resyncs: this.resyncs + this.latePackets, skewMs: this.maxSkewMs };
  }
}
if (typeof module !== 'undefined') module.exports = { RoomClock, SynchronizedPCMPlayer };
