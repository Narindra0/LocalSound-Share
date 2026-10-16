'use strict';

/**
 * AudioWorklet : lecture du flux PCM reçu (48 kHz, stereo, s16le déjà converti en Float32).
 * - Tampon de gigue (jitter buffer) pour absorber la variabilité réseau
 * - Pré-roll : ne pas démarrer avant d'avoir assez de données
 * - Régulation de latence : purge si le tampon dépasse le maximum, léger
 *   ajustement du pas de lecture (resampling linéaire) pour compenser la
 *   dérive entre l'horloge de capture et l'horloge de restitution.
 */
class LocalSoundPlayer extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    this.inputRate = opts.inputRate || 48000;

    this.minimumS = (opts.targetMs || 40) / 1000;
    this.targetS = this.minimumS;
    this.prerollS = this.targetS;
    this.maxS = 0.12;
    this.resyncs = 0;
    this.lastUnderrun = -Infinity;
    this.fade = 0;

    this.baseStep = this.inputRate / sampleRate;
    this.cap = Math.ceil(this.inputRate * 0.5);
    this.bufL = new Float32Array(this.cap);
    this.bufR = new Float32Array(this.cap);
    this.written = 0; // frames cumulés écrits
    this.read = 0;    // frames cumulés lus (peut être fractionnaire)

    this.underruns = 0;
    this.starved = false;
    this.primed = false;
    this.lastStatsAt = 0;

    this.port.onmessage = (e) => {
      const msg = e.data || {};
      if (msg.type === 'pcm') {
        if (Number.isFinite(msg.audioTime) && currentTime - msg.audioTime > 0.12) { this.resyncs++; return; }
        this.write(msg.left, msg.right);
      } else if (msg.type === 'flush') {
        this.read = this.written; // vide le tampon (reprise après pause)
        this.primed = false;
        this.starved = false;
        this.fade = 0;
      } else if (msg.type === 'config' && msg.inputRate) {
        this.inputRate = msg.inputRate;
        this.baseStep = this.inputRate / sampleRate;
      }
    };
  }

  write(left, right) {
    if (left.length > this.cap) {
      left = left.subarray(left.length - this.cap);
      right = right.subarray(right.length - this.cap);
    }
    const n = left.length;
    if (!n) return;
    // Espace insuffisant : on perd les données les plus anciennes.
    if (this.written - this.read + n > this.cap) {
      this.read = this.written + n - this.cap;
    }
    const start = this.written % this.cap;
    const first = Math.min(n, this.cap - start);
    for (let i = 0; i < first; i++) {
      this.bufL[start + i] = left[i];
      this.bufR[start + i] = right[i];
    }
    for (let i = first; i < n; i++) {
      this.bufL[i - first] = left[i];
      this.bufR[i - first] = right[i];
    }
    this.written += n;
  }

  process(inputs, outputs) {
    const out = outputs[0];
    const outL = out[0];
    const outR = out.length > 1 ? out[1] : out[0];
    const n = outL.length;

    let level = this.written - this.read; // frames disponibles
    let levelS = level / this.inputRate;

    // Purge si le tampon déborde (dérive horloge / reprise après pause)
    if (levelS > Math.max(this.maxS, this.targetS + 0.06)) {
      this.read = this.written - this.targetS * this.inputRate;
      level = this.written - this.read;
      levelS = level / this.inputRate;
      this.resyncs++;
      this.fade = 0;
    }

    // Pas encore de données ou pré-roll en cours : silence
    if (level < 2 || (!this.primed && levelS < this.prerollS)) {
      if (this.primed) this.markUnderrun();
      outL.fill(0);
      outR.fill(0);
      this.reportStats(levelS);
      return true;
    }
    this.primed = true;
    if (currentTime - this.lastUnderrun > 10) {
      this.targetS = Math.max(this.minimumS, this.targetS - n / sampleRate * 0.001);
      this.prerollS = this.targetS;
    }

    // Ajustement fin du pas pour maintenir la latence proche de la cible
    const err = levelS - this.targetS;
    let adj = err * 0.05;
    if (adj > 0.003) adj = 0.003;
    else if (adj < -0.003) adj = -0.003;
    const step = this.baseStep * (1 + adj);

    let produced = 0;
    let underrun = false;
    for (let i = 0; i < n; i++) {
      const pos = this.read;
      const i0 = Math.floor(pos);
      if (i0 + 1 >= this.written) { // fin des données -> silence
        underrun = true;
        break;
      }
      const frac = pos - i0;
      const a = i0 % this.cap;
      const b = (i0 + 1) % this.cap;
      outL[i] = this.bufL[a] + (this.bufL[b] - this.bufL[a]) * frac;
      outR[i] = this.bufR[a] + (this.bufR[b] - this.bufR[a]) * frac;
      // Fondu court à la reprise et au bord du silence pour limiter les claquements.
      this.fade = Math.min(1, this.fade + 1 / (sampleRate * 0.002));
      const edge = Math.min(1, (this.written - pos - 1) / (this.inputRate * 0.002));
      outL[i] *= this.fade * edge;
      outR[i] *= this.fade * edge;
      this.read = pos + step;
      produced++;
    }
    if (produced < n) {
      for (let i = produced; i < n; i++) { outL[i] = 0; outR[i] = 0; }
      // Un seul décompte par épisode de coupure (et non par bloc de 2,7 ms).
      if (underrun) this.markUnderrun();
    } else {
      this.starved = false;
    }

    this.reportStats((this.written - this.read) / this.inputRate);
    return true;
  }

  markUnderrun() {
    if (!this.starved) {
      this.starved = true; this.underruns++;
      this.targetS = Math.min(0.10, this.targetS + 0.01);
      this.prerollS = this.targetS;
      this.lastUnderrun = currentTime;
    }
    this.primed = false;
    this.fade = 0;
  }

  reportStats(levelS) {
    if (currentTime - this.lastStatsAt < 0.5) return;
    this.lastStatsAt = currentTime;
    this.port.postMessage({
      type: 'stats',
      levelMs: Math.round(levelS * 1000),
      underruns: this.underruns,
      targetMs: Math.round(this.targetS * 1000),
      resyncs: this.resyncs,
      rate: sampleRate,
    });
  }
}

registerProcessor('localsound-player', LocalSoundPlayer);
