/// Musique du téléphone côté Dart.
///
/// `MusicLibrary.kt` liste les morceaux, décode le fichier choisi et pousse des
/// blocs PCM **stéréo** s16le 48 kHz de 20 ms, déjà au format du salon (aucune
/// conversion à faire ici, contrairement au micro).
library;

import 'dart:async';

import 'package:flutter/services.dart';

import 'library_queue.dart';

class LibraryDenied implements Exception {
  const LibraryDenied();
  @override
  String toString() =>
      'Accès à la musique refusé. Autorisez-le dans les réglages Android pour héberger un salon.';
}

class LibrarySource {
  LibrarySource();

  static const MethodChannel _methods = MethodChannel('localsound/library');
  static const EventChannel _stream = EventChannel('localsound/library_stream');
  static const EventChannel _events = EventChannel('localsound/library_events');

  Stream<Uint8List>? _frames;
  Stream<String>? _notifications;

  /// Blocs PCM stéréo s16le 48 kHz, dans l'ordre d'arrivée.
  Stream<Uint8List> get frames => _frames ??= _stream
      .receiveBroadcastStream()
      .where((event) => event is Uint8List)
      .cast<Uint8List>();

  /// `started`, `ended` ou `error`, selon le lecteur natif.
  Stream<String> get notifications => _notifications ??= _events
      .receiveBroadcastStream()
      .where((event) => event is Map)
      .map(
        (event) =>
            (event as Map)['type'] is String ? event['type'] as String : '',
      )
      .where((type) => type.isNotEmpty);

  Future<bool> requestPermission() async {
    try {
      return await _methods.invokeMethod<bool>('requestPermission') ?? false;
    } on PlatformException {
      return false;
    }
  }

  Future<List<Song>> loadSongs() async {
    try {
      final raw = await _methods.invokeMethod<List<Object?>>('songs');
      if (raw == null) return const [];
      return [
        for (final item in raw)
          if (item is Map) Song.fromMap(item),
      ];
    } on PlatformException catch (err) {
      throw Exception(err.message ?? 'Bibliothèque illisible.');
    }
  }

  Future<void> play(Song song) async {
    try {
      await _methods.invokeMethod<void>('play', {'uri': song.uri});
    } on PlatformException catch (err) {
      throw Exception(err.message ?? 'Morceau illisible.');
    }
  }

  Future<void> pause() async {
    try {
      await _methods.invokeMethod<void>('pause');
    } on PlatformException {
      // Le lecteur est déjà arrêté.
    }
  }

  Future<void> resume() async {
    try {
      await _methods.invokeMethod<void>('resume');
    } on PlatformException {
      // Rien à reprendre : le morceau suivant repartira de zéro.
    }
  }

  Future<void> stop() async {
    try {
      await _methods.invokeMethod<void>('stop');
    } on PlatformException {
      // Déjà arrêté.
    }
  }

  Future<void> keepScreenOn(bool on) async {
    try {
      await _methods.invokeMethod<void>('keepScreenOn', {'on': on});
    } on PlatformException {
      // Sans cette option, le salon reste utilisable, écran éteint à la main.
    }
  }
}
