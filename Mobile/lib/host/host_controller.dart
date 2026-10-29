/// Cerveau du mode hôte : ouvre le salon et choisit sa source.
///
/// Deux sources, un seul tuyau audio :
///
/// - `mic` : le son de la pièce (`MicCapture.kt`), dupliqué en stéréo ;
/// - `library` : un morceau du téléphone, déjà décodé en stéréo 48 kHz par
///   `MusicLibrary.kt`, joué sur le haut-parleur **et** diffusé.
///
/// Une seule règle évite les incohérences : la source suit toujours l'état du
/// serveur. Quand un auditeur met en pause depuis le web, la source s'arrête
/// aussi ; quand il relance, elle repart.
library;

import 'dart:async';

import 'package:flutter/foundation.dart';

import 'host_server.dart';
import 'library_queue.dart';
import 'library_source.dart';
import 'mic_source.dart';
import 'web_assets.dart';

/// Réserve de lecture du mode musique : plus large que les 150 ms du micro,
/// parce que le son traverse un décodeur avant d'être diffusé.
const int librarySyncDelayMs = 260;

/// D'où vient le son du salon.
enum HostMode {
  /// Le micro du téléphone : une pièce, une platine, une télé.
  mic,

  /// Les morceaux du téléphone, choisis dans la bibliothèque.
  library,
}

enum HostPhase {
  /// Aucun salon ouvert.
  idle,

  /// Ports, page web et autorisation en cours.
  starting,

  /// Salon ouvert, mais aucun morceau choisi (mode Bibliothèque).
  ready,

  /// Le salon diffuse.
  live,

  /// Salon ouvert, source en pause.
  paused,

  /// Le salon n'a pas pu démarrer (port occupé, autorisation refusée…).
  error,
}

class HostController extends ChangeNotifier {
  HostController({
    MicSource? mic,
    LibrarySource? librarySource,
    Future<Uint8List?> Function(String path)? loadAsset,
    this.hostName = 'Mon téléphone',
    this.trackTitle = 'Le direct du salon',
  }) : _library = librarySource,
       _mic = mic ?? MicSource(),
       _injectedLoader = loadAsset;

  final MicSource _mic;
  final LibrarySource? _library;
  final LibraryQueue _queue = LibraryQueue();
  final Future<Uint8List?> Function(String path)? _injectedLoader;
  final String hostName;
  final String trackTitle;

  HostServer? _server;
  StreamSubscription<Uint8List>? _frames;
  StreamSubscription<String>? _events;
  DateTime _lastLevel = DateTime.fromMillisecondsSinceEpoch(0);
  HostPhase _phase = HostPhase.idle;
  double _level = 0;
  String? _error;
  bool _disposed = false;

  HostPhase get phase => _phase;
  String? get error => _error;
  double get level => _level;
  int get listeners => _server?.listeners ?? 0;
  int get kbps => _server?.kbps ?? 0;
  List<String> get urls => _server?.urls ?? const [];
  int get port => _server?.port ?? 0;
  bool get live => _phase == HostPhase.live;

  bool get libraryMode => _library != null;
  HostMode get mode => libraryMode ? HostMode.library : HostMode.mic;
  List<Song> get songs => _queue.songs;
  Song? get currentSong => _queue.current;
  bool get hasNext => _queue.hasNext;
  bool get hasPrevious => _queue.hasPrevious;

  /// Adresse à ouvrir sur un PC : la première interface réseau du téléphone.
  String? get url {
    final urls = this.urls;
    return urls.isEmpty ? null : urls.first;
  }

  /// Salons ouverts simultanément sur le réseau, pour l'affichage.
  int get addressCount => urls.length;

  Future<void> start() async {
    if (_phase == HostPhase.starting || _phase == HostPhase.live) return;
    // Salon déjà ouvert (source interrompue, « Réessayer ») : on ne rouvre pas
    // un deuxième serveur, on relance seulement la diffusion.
    if (_server != null) {
      await resume();
      return;
    }
    _phase = HostPhase.starting;
    _error = null;
    _notify();

    final library = _library;
    final granted = library != null
        ? await library.requestPermission()
        : await _mic.requestPermission();
    if (!granted) {
      _fail(
        library != null ? const LibraryDenied().toString() : 'Micro refusé. Autorisez-le dans les réglages Android pour héberger un salon.',
      );
      return;
    }

    HostServer? server;
    try {
      final assets = _injectedLoader != null ? null : await WebAssets.load();
      server = HostServer(
        loadAsset: _injectedLoader ?? (path) => assets!.read(path),
        hostName: hostName,
        appearance: const {'theme': 'vinyl', 'palette': 'terracotta'},
      )..trackTitle = library != null ? 'Ma musique' : trackTitle;
      if (library != null) {
        server
          ..trackArtist = 'La musique du téléphone'
          ..sourceKind = 'file'
          // Décodage + passage par le fil principal : 110 ms de réserve en plus
          // du délai commun, sinon le moindre à-coup se traduit par un trou.
          ..syncDelayMs = librarySyncDelayMs;
      }
      server.onControl = _applyControl;
      server.onChanged = _notify;
      await server.start();
    } catch (err) {
      await server?.dispose();
      _fail(
        err is HostError ? err.message : 'Salon impossible à ouvrir : $err',
      );
      return;
    }

    _server = server;

    if (library != null) {
      await _openLibrary(library, server);
      return;
    }

    try {
      await _mic.start();
    } catch (err) {
      await server.dispose();
      _server = null;
      _fail(err.toString());
      return;
    }

    _frames = _mic.frames
        .map(monoStereo)
        .listen(
          (stereo) => _onBlock(server!, stereo),
          onError: (Object err) => _fail('Micro interrompu : $err'),
          cancelOnError: false,
        );
    await _mic.keepScreenOn(true);
    server.setPlayback(active: true, playing: true);
    _phase = HostPhase.live;
    _notify();
  }

  /// Le salon s'ouvre sans musique : l'hôte choisit ensuite un morceau.
  Future<void> _openLibrary(LibrarySource library, HostServer server) async {
    try {
      _queue.replace(await library.loadSongs());
    } catch (err) {
      _error = err.toString();
    }
    _events = library.notifications.listen(_onLibraryEvent);
    _frames = library.frames.listen(
      (stereo) => _onBlock(server, stereo),
      onError: (Object err) => _fail('Lecture interrompue : $err'),
      cancelOnError: false,
    );
    await library.keepScreenOn(true);
    server.setPlayback(active: true, playing: false);
    _phase = HostPhase.ready;
    _notify();
  }

  void _onBlock(HostServer server, Uint8List stereo) {
    if (server != _server || !server.playing) return;
    server.pushPcm(stereo);
    final now = DateTime.now();
    _level = pcmLevel(stereo).clamp(_level * 0.72, 1.0).toDouble();
    if (now.difference(_lastLevel) > const Duration(milliseconds: 90)) {
      _lastLevel = now;
      _notify();
    }
  }

  /// Joue un morceau de la bibliothèque et met le salon en direct.
  Future<void> playSong(Song song) async {
    final library = _library;
    final server = _server;
    if (library == null || server == null) return;
    _queue.select(song);
    await _startTrack(song, server);
  }

  Future<void> next() async => _step(1);
  Future<void> previous() async => _step(-1);

  /// Relit la bibliothèque (fichiers ajoutés pendant que le salon tourne).
  Future<void> reloadLibrary() async {
    final library = _library;
    if (library == null) return;
    try {
      _queue.replace(await library.loadSongs());
      _error = null;
    } catch (err) {
      _error = err.toString();
    }
    _notify();
  }

  Future<void> _startTrack(Song song, HostServer server) async {
    final library = _library;
    if (library == null) return;
    try {
      await library.play(song);
    } catch (err) {
      _fail(err.toString());
      return;
    }
    server
      ..trackTitle = song.title
      ..trackArtist = song.subtitle.isEmpty
          ? 'La musique du téléphone'
          : song.subtitle;
    server.setPlayback(active: true, playing: true);
    _error = null;
    _phase = HostPhase.live;
    _notify();
  }

  void _onLibraryEvent(String type) {
    switch (type) {
      case 'ended':
        unawaited(_step(1));
      case 'error':
        _fail('Ce morceau n’a pas pu être lu. Choisis-en un autre.');
    }
  }

  /// Morceau suivant/précédent ; en bout de file, le salon attend un choix.
  Future<void> _step(int delta) async {
    final library = _library;
    final server = _server;
    if (library == null || server == null) return;
    final song = _queue.step(delta);
    if (song == null) {
      await library.stop();
      server.setPlayback(active: true, playing: false);
      _level = 0;
      _phase = HostPhase.ready;
      _notify();
      return;
    }
    await _startTrack(song, server);
  }

  Future<void> _applyControl(String action) async {
    final server = _server;
    if (server == null) return;
    final library = _library;
    if (library != null) {
      if (action == 'play') {
        final current = _queue.current;
        if (current == null) {
          server.setPlayback(active: true, playing: false);
          _phase = HostPhase.ready;
          _notify();
          return;
        }
        // Fin de file ou morceau illisible : le lecteur a été libéré, on
        // relance le morceau courant au lieu d'affirmer qu'il joue.
        if (_phase == HostPhase.ready || _phase == HostPhase.error) {
          await _startTrack(current, server);
          return;
        }
        await library.resume();
        server.setPlayback(active: true, playing: true);
        _phase = HostPhase.live;
        _notify();
        return;
      }
      await library.pause();
      _level = 0;
      // `stop` ferme la diffusion mais garde la pièce ouverte : elle se
      // reprend depuis l'écran, sans changer d'adresse pour les auditeurs.
      server.setPlayback(active: action != 'stop', playing: false);
      _phase = HostPhase.paused;
      _notify();
      return;
    }

    if (action == 'play') {
      try {
        await _mic.start();
        _level = 0;
      } catch (err) {
        server.setPlayback(active: true, playing: false, error: err.toString());
        _phase = HostPhase.error;
        _error = err.toString();
        _notify();
        return;
      }
      server.setPlayback(active: true, playing: true);
      _phase = HostPhase.live;
    } else {
      await _mic.stop();
      _level = 0;
      server.setPlayback(active: action != 'stop', playing: false);
      _phase = HostPhase.paused;
    }
    _notify();
  }

  Future<void> pause() async => _guard(_server?.control('pause'));
  Future<void> resume() async => _guard(_server?.control('play'));
  Future<void> _guard(Future<void>? operation) async {
    try {
      await operation;
    } catch (err) {
      _fail(err.toString());
    }
  }

  /// Ferme le salon et libère la source (micro ou lecteur).
  Future<void> stop() async {
    final library = _library;
    if (library != null) {
      await library.stop();
      await library.keepScreenOn(false);
    } else {
      await _mic.stop();
      await _mic.keepScreenOn(false);
    }
    await _events?.cancel();
    _events = null;
    await _frames?.cancel();
    _frames = null;
    final server = _server;
    _server = null;
    await server?.dispose();
    _phase = HostPhase.idle;
    _level = 0;
    _error = null;
    _notify();
  }

  void _fail(String message) {
    _error = message;
    _phase = HostPhase.error;
    _level = 0;
    _notify();
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _events?.cancel();
    _frames?.cancel();
    _mic.keepScreenOn(false);
    _library?.keepScreenOn(false);
    _server?.dispose();
    super.dispose();
  }
}
