/// Conversion Float32 normalisé → PCM 16 bits entrelacé, tel que l'attend
/// `AudioTrack` en `ENCODING_PCM_16BIT`.
///
/// Les trames arrivent séparées (gauche/droite) depuis `protocol.dart`, alors que
/// le flux natif attend G0 D0 G1 D1… C'est exactement le format que le serveur
/// produit (`splitStereo` dans `server.js`).
library;

import 'dart:typed_data';

Float32List? _normalize(Float32List left, Float32List right) {
  if (left.isEmpty) return null;
  return right.length == left.length ? right : null;
}

/// Entrelace deux canaux de même longueur. Le canal droit est dupliqué sur la
/// gauche si les longueurs diffèrent : mieux vaut du mono que du silence.
Uint8List interleaveToPcm16(Float32List left, Float32List right) {
  final channels = _normalize(left, right);
  final frames = left.length;
  final samples = Int16List(frames * 2);
  for (var i = 0; i < frames; i++) {
    samples[i * 2] = _toInt16(left[i]);
    samples[i * 2 + 1] = _toInt16(channels == null ? left[i] : channels[i]);
  }
  return samples.buffer.asUint8List(
    samples.offsetInBytes,
    samples.lengthInBytes,
  );
}

int _toInt16(double value) {
  if (value.isNaN) return 0;
  final scaled = value * 32767.0;
  if (scaled >= 32767) return 32767;
  if (scaled <= -32768) return -32768;
  return scaled.round();
}

/// Durée d'un bloc PCM, en ms.
double blockDurationMs(int frames, int sampleRate) =>
    sampleRate <= 0 ? 0 : frames * 1000 / sampleRate;
