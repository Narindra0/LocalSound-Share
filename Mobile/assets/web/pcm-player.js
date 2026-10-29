'use strict';
// Lecture PCM planifiée sur l’horloge audio, disponible aussi sur une IP LAN en HTTP.
// Les noeuds jouent dans le moteur audio ; aucun timer JS ne cadence les échantillons.
class ScheduledPCMPlayer {
  constructor(context, destination, { inputRate = 48000, targetMs = 40 } = {}) {
    this.context = context; this.destination = destination; this.inputRate = inputRate;
    this.target = targetMs / 1000; this.minimum = this.target;
    this.nextTime = 0; this.nodes = new Set(); this.underruns = 0; this.resyncs = 0;
    this.lastUnderrun = -Infinity; this.started = false; this.previous = null;
  }
  flush() {
    const now = this.context.currentTime;
    for (const entry of this.nodes) {
      entry.gain.gain.cancelScheduledValues(now);
      entry.gain.gain.setValueAtTime(entry.start > now ? 0 : 1, now);
      entry.gain.gain.linearRampToValueAtTime(0, now + 0.003);
      try { entry.source.stop(now + 0.003); } catch (_) {}
    }
    this.nodes.clear(); this.nextTime = 0; this.started = false; this.previous = null;
  }
  push(left, right) {
    if (!left.length || this.context.state !== 'running') return;
    const now = this.context.currentTime;
    let queued = this.nextTime - now;
    const maxQueue = Math.max(0.12, this.target + 0.06);
    if (queued > maxQueue) { this.flush(); this.resyncs++; queued = 0; }
    const recover = this.nextTime < now + 0.003;
    if (recover) {
      if (this.started) {
        this.underruns++;
        this.target = Math.min(0.10, this.target + 0.01);
        this.lastUnderrun = now;
      }
      this.nextTime = now + this.target;
    } else if (now - this.lastUnderrun > 10) {
      // Revenir lentement vers le délai minimal après une période stable.
      this.target = Math.max(this.minimum, this.target - left.length / this.inputRate * 0.001);
    }
    // Rattrapage doux de la dérive, limité à 0,3 % pour préserver la musique.
    const rate = Math.max(0.997, Math.min(1.003, 1 + (this.nextTime - now - this.target) * 0.05));
    const buffer = this.context.createBuffer(2, left.length, this.inputRate);
    buffer.getChannelData(0).set(left); buffer.getChannelData(1).set(right);
    const source = this.context.createBufferSource(), gain = this.context.createGain();
    source.buffer = buffer; source.playbackRate.value = rate;
    source.connect(gain); gain.connect(this.destination);
    const start = this.nextTime, end = start + left.length / this.inputRate / rate;
    // Annuler le fondu de fin du bloc précédent si la suite est arrivée à temps.
    if (!recover && this.previous && this.previous.end - now > 0.003) {
      this.previous.gain.gain.cancelScheduledValues(this.previous.end - 0.002);
      this.previous.gain.gain.setValueAtTime(1, this.previous.end - 0.002);
    }
    gain.gain.setValueAtTime(recover ? 0 : 1, start);
    if (recover) gain.gain.linearRampToValueAtTime(1, Math.min(start + 0.002, end));
    gain.gain.setValueAtTime(1, Math.max(start, end - 0.002));
    gain.gain.linearRampToValueAtTime(0, end);
    const entry = { source, gain, start, end };
    this.nodes.add(entry); this.previous = entry;
    source.onended = () => { this.nodes.delete(entry); source.disconnect(); gain.disconnect(); };
    source.start(start); this.nextTime = end; this.started = true;
  }
  stats() {
    return { levelMs: Math.round(Math.max(0, this.nextTime - this.context.currentTime) * 1000),
      targetMs: Math.round(this.target * 1000), underruns: this.underruns, resyncs: this.resyncs };
  }
}
if (typeof module !== 'undefined') module.exports = { ScheduledPCMPlayer };
