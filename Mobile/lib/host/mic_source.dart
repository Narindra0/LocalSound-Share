/// Micro du téléphone côté Dart.
///
/// Android livre des blocs mono s16le 48 kHz (`MicCapture.kt`) ; le salon
/// attend du stéréo entrelacé. [monoStereo] fait la conversion, exactement comme
/// un chunk de capture système qui n'aurait qu'un canal.
library;

import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/services.dart';

class MicDenied implements Exception {
  const MicDenied();
  @override
  String toString() => 'Micro refusé. Autorisez-le dans les réglages Android.';
}

class MicSource {
  MicSource();

  static const MethodChannel _methods = MethodChannel('localsound/mic');
  static const EventChannel _stream = EventChannel('localsound/mic_stream');

  Stream<Uint8List>? _frames;

  /// Blocs mono s16le de 20 ms, dans l'ordre d'arrivée.
  Stream<Uint8List> get frames => _frames ??= _stream
      .receiveBroadcastStream()
      .where((event) => event is Uint8List)
      .cast<Uint8List>();

  Future<bool> requestPermission() async {
    try {
      return await _methods.invokeMethod<bool>('requestPermission') ?? false;
    } on PlatformException {
      return false;
    }
  }

  Future<void> start() async {
    try {
      await _methods.invokeMethod<void>('start');
    } on PlatformException catch (err) {
      if (err.code == 'permission') throw const MicDenied();
      throw Exception(err.message ?? 'Micro indisponible.');
    }
  }

  Future<void> stop() async {
    try {
      await _methods.invokeMethod<void>('stop');
    } on PlatformException {
      // Le micro est déjà arrêté.
    }
  }

  /// Garde l'écran allumé : Android endort la capture d'une app en arrière-plan.
  Future<void> keepScreenOn(bool on) async {
    try {
      await _methods.invokeMethod<void>('keepScreenOn', {'on': on});
    } on PlatformException {
      // Sans cette option, le salon reste utilisable, écran éteint à la main.
    }
  }
}

/// Duplique un bloc mono sur deux canaux : G0 D0 G1 D1…
Uint8List monoStereo(Uint8List mono) {
  final samples = mono.length ~/ 2;
  final out = Uint8List(samples * 4);
  final source = ByteData.sublistView(mono);
  final target = ByteData.sublistView(out);
  for (var i = 0; i < samples; i++) {
    final value = source.getInt16(i * 2, Endian.little);
    target.setInt16(i * 4, value, Endian.little);
    target.setInt16(i * 4 + 2, value, Endian.little);
  }
  return out;
}

/// Niveau 0…1 d'un bloc PCM s16le, pour le vumètre de l'hôte.
double pcmLevel(Uint8List pcm) {
  final samples = pcm.length ~/ 2;
  if (samples == 0) return 0;
  final view = ByteData.sublistView(pcm);
  var peak = 0;
  for (var i = 0; i < samples; i++) {
    final value = view.getInt16(i * 2, Endian.little).abs();
    if (value > peak) peak = value;
  }
  return (peak / 32768).clamp(0.0, 1.0);
}
