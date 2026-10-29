import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

import 'package:localsound_mobile/audio/pcm_encoder.dart';
import 'package:localsound_mobile/core/protocol.dart';

/// Lecture des trames PCM du salon via `AudioTrack` (Android).
///
/// Le serveur envoie des blocs s16le stéréo 48 kHz : [push] entrelace les deux
/// canaux puis pousse les octets au canal natif, qui les écrit dans un flux
/// continu. Les trames `LSO3` (Opus) ne sont pas décodées : l'app s'annonce en
/// `codec: 'pcm'` et le serveur respecte ce choix.
///
/// La fraîcheur des paquets est décidée en amont par [Session] ; ici on ne garde
/// qu'un garde-fou : un bloc reçu alors que le flux n'est pas armé est ignoré,
/// jamais rejoué plus tard.
class PcmPlayer extends ChangeNotifier {
  static const MethodChannel _channel = MethodChannel('localsound/audio');

  bool _prepared = false;
  bool _playing = false;
  bool _muted = false;
  String? _error;
  int _sampleRate = 48000;
  int _channels = 2;
  int _blocks = 0;
  int _bytes = 0;
  double _volume = 1;
  Timer? _watchdog;
  double _lastBlockAt = 0;
  bool _starved = false;

  bool get prepared => _prepared;
  bool get playing => _playing;
  bool get muted => _muted;
  bool get starved => _starved;
  String? get error => _error;
  int get sampleRate => _sampleRate;
  int get blocks => _blocks;
  int get bytes => _bytes;
  double get volume => _volume;

  /// Prépare l'`AudioTrack` natif. `true` si le flux est prêt à recevoir du son.
  Future<bool> prepare({
    int sampleRate = 48000,
    int channels = 2,
    int bufferMs = 160,
  }) async {
    if (_prepared) return true;
    _sampleRate = sampleRate;
    _channels = channels;
    try {
      final ok = await _channel.invokeMethod<bool>('prepare', {
        'sampleRate': sampleRate,
        'channels': channels,
        'bufferMs': bufferMs,
      });
      _prepared = ok ?? false;
      if (!_prepared) _error = 'Carte son indisponible sur cet appareil.';
    } on PlatformException catch (err) {
      _prepared = false;
      _error = err.message ?? 'Carte son indisponible sur cet appareil.';
    } on MissingPluginException {
      _prepared = false;
      _error = 'Lecture audio native non disponible sur cette plateforme.';
    }
    notifyListeners();
    return _prepared;
  }

  /// Démarre la lecture et le chien de garde qui signale une source muette.
  Future<bool> play() async {
    if (!_prepared &&
        !await prepare(sampleRate: _sampleRate, channels: _channels)) {
      return false;
    }
    try {
      await _channel.invokeMethod<void>('start');
      _playing = true;
      _lastBlockAt = _now();
      _starved = false;
      _watchdog?.cancel();
      _watchdog = Timer.periodic(
        const Duration(seconds: 1),
        (_) => _checkAudio(),
      );
    } on PlatformException catch (err) {
      _error = err.message ?? 'Lecture impossible.';
      _playing = false;
    }
    notifyListeners();
    return _playing;
  }

  Future<void> pause() async {
    _watchdog?.cancel();
    if (!_playing) return;
    _playing = false;
    try {
      await _channel.invokeMethod<void>('pause');
    } on PlatformException {
      // Un flux déjà arrêté côté natif ne doit pas remonter en erreur d'UI.
    }
    notifyListeners();
  }

  /// Vide le tampon natif : à faire lors d'un changement de piste ou de source,
  /// pour ne pas jouer le reste de l'ancien morceau.
  Future<void> flush() async {
    _blocks = 0;
    _bytes = 0;
    if (!_prepared) return;
    try {
      await _channel.invokeMethod<void>('flush');
    } on PlatformException {
      // Sans effet si le flux est arrêté.
    }
    notifyListeners();
  }

  Future<void> setVolume(double value) async {
    _volume = value.clamp(0.0, 1.0);
    _muted = _volume == 0;
    if (_prepared) {
      try {
        await _channel.invokeMethod<void>('setVolume', {'volume': _volume});
      } on PlatformException {
        // Le volume système reste la référence si le canal refuse.
      }
    }
    notifyListeners();
  }

  /// Pousse une trame décodée. Les trames Opus sont ignorées : le salon n'en
  /// envoie pas quand le client annonce `pcm`.
  void push(AudioFrame frame) {
    if (frame is! PcmFrame || !_prepared || !_playing) return;
    final bytes = interleaveToPcm16(frame.left, frame.right);
    if (bytes.isEmpty) return;
    _blocks++;
    _bytes += bytes.length;
    _lastBlockAt = _now();
    _starved = false;
    _write(bytes);
  }

  void _write(Uint8List bytes) {
    _channel.invokeMethod<void>('write', bytes).catchError((Object err) {
      if (err is PlatformException) {
        _error = err.message ?? 'Écriture audio refusée.';
      }
      return;
    });
  }

  void _checkAudio() {
    final stale = _now() - _lastBlockAt > 1500;
    if (stale == _starved) return;
    _starved = stale;
    notifyListeners();
  }

  double _now() => DateTime.now().millisecondsSinceEpoch.toDouble();

  Future<void> release() async {
    _watchdog?.cancel();
    _playing = false;
    _prepared = false;
    try {
      await _channel.invokeMethod<void>('release');
    } on PlatformException {
      // Rien à libérer.
    } on MissingPluginException {
      // Plateforme sans canal natif.
    }
    notifyListeners();
  }

  @override
  void dispose() {
    _watchdog?.cancel();
    if (_prepared) {
      _channel.invokeMethod<void>('release').catchError((Object _) {});
    }
    super.dispose();
  }
}
