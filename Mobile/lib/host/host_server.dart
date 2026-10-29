/// Salon hébergé par le téléphone.
///
/// Portage du sous-ensemble de `server.js` utile à un hôte mobile : la page
/// d'écoute web, `GET /api/status`, la file de demandes et le WebSocket
/// `/listen` avec le protocole binaire `LSP2` (PCM s16le stéréo 48 kHz et
/// échéance commune `playAt`). Aucun encodage Opus ni MP3 : le débit d'un
/// réseau local suffit, et un flux mono/Opus demanderait un encodeur natif.
///
/// Les auditeurs reçoivent `playAt = capturedAt + syncDelayMs`, exactement
/// comme le PC hôte : le lecteur web les aligne sur l'horloge du salon.
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'host_requests.dart';
import 'web_assets.dart';

const int hostSampleRate = 48000;
const int hostChannels = 2;
const int hostSyncDelayMs = 150;
const String hostAppVersion = '1.1.0';

/// Durée d'un bloc envoyé aux auditeurs : 20 ms, la trame du PC hôte.
const int hostFrameMs = 20;

class HostError implements Exception {
  HostError(this.message);
  final String message;

  @override
  String toString() => message;
}

String _describe(Object error) =>
    error is HostError ? error.message : error.toString();

class _Peer {
  _Peer(this.socket);
  final WebSocket socket;

  /// 2 (échéance commune), 1 (horodatage seul) ou 0 (PCM nu), selon `hello`.
  int protocol = 0;
  bool wantsAudio = false;
}

class HostServer {
  HostServer({
    required this.loadAsset,
    this.hostName = 'LocalSound',
    HostRequests? requests,
    Map<String, String> appearance = const {
      'theme': 'vinyl',
      'palette': 'terracotta',
    },
  }) : requests = requests ?? HostRequests(),
       _appearance = Map<String, String>.from(appearance);

  /// Lit un fichier de l'interface web (`index.html`, `client.js`…).
  final AssetLoader loadAsset;
  final String hostName;
  final HostRequests requests;

  Map<String, String> _appearance;
  final Map<WebSocket, _Peer> _peers = {};
  final Stopwatch _clock = Stopwatch()..start();
  HttpServer? _server;
  Timer? _ticker;
  List<String> _urls = const [];
  int _sequence = 0, _generation = 1;
  int _bytes = 0,
      _egressBytes = 0,
      _previousBytes = 0,
      _previousEgressBytes = 0;
  int _kbps = 0, _egressKbps = 0;
  bool _active = false, _playing = false;
  String? _error;
  DateTime? _lastAudioAt;

  /// Écart entre capture et lecture : la réserve qui absorbe la gigue du réseau.
  int syncDelayMs = hostSyncDelayMs;

  /// Prochaine échéance théorique du flux audio, alignée sur les trames et
  /// non sur l'heure d'arrivée de chaque bloc.
  double _nextCaptureMs = 0;

  /// Titre affiché aux auditeurs ; l'hôte peut le changer à tout moment.
  String trackTitle = 'Le direct du salon';
  String trackArtist = 'Micro du téléphone';

  /// `system` (micro, capture de la pièce) ou `file` (morceau du téléphone).
  String sourceKind = 'system';

  /// Appelé quand un auditeur demande play/pause/stop depuis le web.
  Future<void> Function(String action)? onControl;

  /// Notifié à chaque changement visible (auditeurs, lecture, erreur).
  void Function()? onChanged;

  bool get active => _active;
  bool get playing => _playing;
  String? get error => _error;
  int get port => _server?.port ?? 0;

  /// Débit du micro, en kbit/s.
  int get kbps => _kbps;

  /// Débit envoyé aux auditeurs, en kbit/s.
  int get egressKbps => _egressKbps;
  int get generation => _generation;
  List<String> get urls => List.unmodifiable(_urls);

  /// Nombre d'appareils qui écoutent réellement le flux.
  int get listeners => _peers.values.where((peer) => peer.wantsAudio).length;

  /// true si une trame audio est arrivée récemment : « EN DIRECT » côté web.
  bool get signal =>
      _lastAudioAt != null &&
      DateTime.now().difference(_lastAudioAt!) <
          const Duration(milliseconds: 1500);

  /// Horloge du salon, en ms : monotone, jamais calée sur l'heure système.
  double get nowMs => _clock.elapsedMicroseconds / 1000;

  Map<String, dynamic> get state {
    final count = listeners;
    return {
      'application': 'localsound-share',
      'version': hostAppVersion,
      'host': hostName,
      'urls': _urls,
      'audio': {
        'sampleRate': hostSampleRate,
        'channels': hostChannels,
        'bitDepth': 16,
        'encoding': 's16le',
      },
      'active': _active,
      'playing': _playing,
      'clients': count,
      'kbps': _kbps,
      'mp3Available': false,
      'error': _error,
      'sourceKind': sourceKind,
      'synchronized': true,
      'syncDelayMs': syncDelayMs,
      'generation': _generation,
      'appearance': _appearance,
      'network': {
        'mode': 'high',
        'opusAvailable': false,
        'bitrate': hostSampleRate * hostChannels * 16,
        'egressKbps': _egressKbps,
        'compressedFrames': 0,
        'opusListeners': 0,
        'pcmListeners': count,
      },
      'requestCount': requests.snapshot['count'],
      'trackName': trackTitle,
      'nowPlaying': {
        'title': trackTitle,
        'artist': trackArtist,
        'source': 'manual',
      },
      'metadataStatus': 'manual',
      'sourceReady': true,
      'signal': signal,
    };
  }

  /// Ouvre le salon. Renvoie le port réellement écouté ; en cas de port occupé
  /// (PC hôte sur le même réseau, autre instance), les suivants sont essayés.
  Future<int> start({int port = 3000, int attempts = 5}) async {
    if (_server != null) return _server!.port;
    for (var candidate = port; candidate < port + attempts; candidate++) {
      try {
        _server = await HttpServer.bind(InternetAddress.anyIPv4, candidate);
        break;
      } on SocketException {
        // Port déjà pris : essayer le suivant.
      }
    }
    final server = _server;
    if (server == null) {
      throw HostError(
        'Aucun port libre entre $port et ${port + attempts - 1}.',
      );
    }
    server.serverHeader = 'LocalSound';
    server.listen(_handle, onError: (Object _) {});
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) => _tick());
    await _discoverUrls();
    return server.port;
  }

  Future<void> _discoverUrls() async {
    try {
      final interfaces = await NetworkInterface.list(
        type: InternetAddressType.IPv4,
        includeLoopback: false,
      );
      _urls = [
        for (final interface in interfaces)
          for (final address in interface.addresses)
            'http://${address.address}:$port',
      ];
    } catch (_) {
      _urls = const [];
    }
    onChanged?.call();
  }

  // -------------------------------------------------------------------------
  // Audio
  // -------------------------------------------------------------------------

  /// Diffuse un bloc PCM s16le stéréo (micro ou morceau du téléphone).
  ///
  /// L'échéance suit une horloge audio continue (20 ms par bloc de 20 ms),
  /// pas l'heure d'arrivée : un décodage ou un passage par le fil principal
  /// qui livre deux blocs d'un coup ne doit pas produire deux échéances
  /// quasi identiques puis un trou. Au-delà de 400 ms de retard, on repart de
  /// l'horloge réelle plutôt que de courir après le passé.
  void pushPcm(Uint8List stereo) {
    if (!_playing || stereo.length < 4) return;
    final frames = stereo.length ~/ 4;
    final usable = frames * 4;
    final duration = frames * 1000 / hostSampleRate;
    var capturedAt = nowMs;
    if (_nextCaptureMs > 0) {
      final drift = capturedAt - _nextCaptureMs;
      if (drift < 0 && drift > -400) {
        capturedAt = _nextCaptureMs;
      } else if (drift > 400) {
        _nextCaptureMs = 0;
      }
    }
    _nextCaptureMs = capturedAt + duration;
    final playAt = capturedAt + syncDelayMs;
    final packet = Uint8List(24 + usable);
    final view = ByteData.sublistView(packet);
    packet[0] = 0x4C;
    packet[1] = 0x53;
    packet[2] = 0x50;
    packet[3] = 0x32; // 'LSP2'
    view.setUint32(4, _sequence++ & 0xFFFFFFFF, Endian.little);
    view.setFloat64(8, capturedAt, Endian.little);
    view.setFloat64(16, playAt, Endian.little);
    packet.setRange(24, 24 + usable, stereo);

    _bytes += usable;
    _lastAudioAt = DateTime.now();
    var recipients = 0;
    for (final peer in _peers.values) {
      if (!peer.wantsAudio) continue;
      try {
        peer.socket.add(packet);
        recipients++;
      } catch (_) {
        _drop(peer);
      }
    }
    _egressBytes += packet.length * recipients;
  }

  /// Met à jour l'état diffusé (le contrôleur suit le micro réel).
  void setPlayback({
    required bool active,
    required bool playing,
    String? error,
  }) {
    if (active != _active) _generation++;
    _active = active;
    _playing = playing;
    _error = error;
    if (!playing) {
      _lastAudioAt = null;
      _nextCaptureMs = 0;
    }
    _broadcastState();
  }

  void setError(String? message) {
    _error = message;
    _broadcastState();
  }

  void setAppearance(Map<String, String> appearance) {
    _appearance = Map<String, String>.from(appearance);
    _broadcastState();
  }

  /// Applique play/pause/stop, puis laisse le contrôleur piloter le micro.
  Future<void> control(String action) async {
    if (action == 'play') {
      _active = true;
      _playing = true;
      _error = null;
    } else if (action == 'pause') {
      _playing = false;
    } else if (action == 'stop') {
      _playing = false;
      _active = false;
      _lastAudioAt = null;
    } else {
      throw HostError('Action inconnue : $action');
    }
    _broadcastState();
    await onControl?.call(action);
  }

  // -------------------------------------------------------------------------
  // HTTP
  // -------------------------------------------------------------------------

  Future<void> _handle(HttpRequest request) async {
    final path = request.uri.path;
    try {
      // `public/client.js` se connecte à `ws://hôte/`, racine comprise : le
      // serveur Node accepte n'importe quel chemin, on fait pareil.
      if (WebSocketTransformer.isUpgradeRequest(request)) {
        await _upgrade(request);
        return;
      }
      if (request.method != 'GET' && request.method != 'POST') {
        await _text(
          request.response,
          HttpStatus.methodNotAllowed,
          'Méthode non autorisée.',
        );
        return;
      }
      switch (path) {
        case '/api/status':
          await _json(request.response, HttpStatus.ok, state);
          return;
        case '/api/requests':
          if (request.method == 'GET') {
            await _json(request.response, HttpStatus.ok, requests.snapshot);
          } else {
            await _addRequest(request);
          }
          return;
        case '/api/control':
          await _httpControl(request);
          return;
        case '/':
        case '/listen':
          await _static(request, 'index.html');
          return;
        case '/host':
        case '/home':
          request.response.redirect(Uri.parse('/listen'));
          await request.response.close();
          return;
        case '/settings':
          request.response.redirect(Uri.parse('/listen#audioSettings'));
          await request.response.close();
          return;
      }
      await _static(request, path);
    } catch (error) {
      await _text(
        request.response,
        HttpStatus.internalServerError,
        _describe(error),
      );
    }
  }

  Future<void> _static(HttpRequest request, String path) async {
    final name = path.startsWith('/') ? path.substring(1) : path;
    if (name.isEmpty || name.contains('..') || name.startsWith('/')) {
      return _text(request.response, HttpStatus.badRequest, 'Chemin invalide.');
    }
    final bytes = await loadAsset(name);
    if (bytes == null) {
      return _text(request.response, HttpStatus.notFound, 'Page introuvable.');
    }
    final response = request.response;
    response.statusCode = HttpStatus.ok;
    response.headers.contentType = ContentType.parse(contentTypeFor(name));
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set(
      'Cache-Control',
      name.endsWith('.html') ? 'no-store' : 'public, max-age=3600',
    );
    response.add(bytes);
    await response.close();
  }

  Future<void> _addRequest(HttpRequest request) async {
    if (!_sameOrigin(request)) {
      return _json(request.response, HttpStatus.forbidden, {
        'error': 'Origine non autorisée.',
      });
    }
    final body = await _readBody(request);
    if (body == null) {
      return _json(request.response, HttpStatus.badRequest, {
        'error': 'Requête illisible.',
      });
    }
    Object? decoded;
    try {
      decoded = jsonDecode(body);
    } catch (_) {
      return _json(request.response, HttpStatus.badRequest, {
        'error': 'Requête illisible.',
      });
    }
    Map<String, dynamic>? item;
    ({int status, String message})? failure;
    try {
      item = requests.add(
        decoded,
        address: request.connectionInfo?.remoteAddress.address ?? '',
      );
    } catch (error) {
      failure = hostRequestFailure(error);
    }
    if (item == null) {
      await _json(request.response, failure?.status ?? HttpStatus.badRequest, {
        'error': failure?.message ?? 'Demande refusée.',
      });
      return;
    }
    _broadcastRequests();
    _broadcastState();
    await _json(request.response, HttpStatus.created, {
      'item': item,
      ...requests.snapshot,
    });
  }

  Future<void> _httpControl(HttpRequest request) async {
    if (!_sameOrigin(request)) {
      return _json(request.response, HttpStatus.forbidden, {
        'error': 'Origine non autorisée.',
      });
    }
    final body = await _readBody(request);
    Object? decoded;
    try {
      decoded = body == null ? null : jsonDecode(body);
    } catch (_) {
      decoded = null;
    }
    final action = decoded is Map<String, dynamic> ? decoded['action'] : null;
    if (action is! String) {
      return _json(request.response, HttpStatus.badRequest, {
        'error': 'Action manquante.',
      });
    }
    try {
      await control(action);
    } catch (error) {
      await _json(request.response, HttpStatus.badRequest, {
        'error': _describe(error),
      });
      return;
    }
    await _json(request.response, HttpStatus.ok, state);
  }

  /// Origine attendue, reconstruite depuis l'en-tête `Host` : `dart:io`
  /// n'expose pas `Host` dans `headers`, mais dans [HttpRequest.requestedUri].
  String _expectedOrigin(HttpRequest request) {
    final uri = request.requestedUri;
    return '${uri.scheme}://${uri.authority}';
  }

  bool _sameOrigin(HttpRequest request) {
    final origin = request.headers.value('origin');
    return origin == null || origin == _expectedOrigin(request);
  }

  Future<String?> _readBody(HttpRequest request, {int limit = 8192}) async {
    final builder = BytesBuilder(copy: false);
    await for (final chunk in request) {
      builder.add(chunk);
      if (builder.length > limit) return null;
    }
    return utf8.decode(builder.takeBytes(), allowMalformed: true);
  }

  Future<void> _json(HttpResponse response, int status, Object data) async {
    response.statusCode = status;
    response.headers.contentType = ContentType(
      'application',
      'json',
      charset: 'utf-8',
    );
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.write(jsonEncode(data));
    await response.close();
  }

  Future<void> _text(HttpResponse response, int status, String message) async {
    response.statusCode = status;
    response.headers.contentType = ContentType(
      'text',
      'plain',
      charset: 'utf-8',
    );
    response.headers.set('Cache-Control', 'no-store');
    response.write(message);
    await response.close();
  }

  // -------------------------------------------------------------------------
  // WebSocket
  // -------------------------------------------------------------------------

  Future<void> _upgrade(HttpRequest request) async {
    if (!_sameOrigin(request)) {
      return _text(
        request.response,
        HttpStatus.forbidden,
        'Origine non autorisée.',
      );
    }
    final socket = await WebSocketTransformer.upgrade(request);
    final peer = _Peer(socket);
    _peers[socket] = peer;
    socket.listen(
      (message) => _onMessage(peer, message),
      onDone: () => _drop(peer),
      onError: (Object _) => _drop(peer),
      cancelOnError: false,
    );
    // Pas d'état avant `hello` : la négociation commence par `transport`.
  }

  void _onMessage(_Peer peer, dynamic message) {
    if (message is! String) return; // le téléphone ne reçoit pas d'audio
    Object? decoded;
    try {
      decoded = jsonDecode(message);
    } catch (_) {
      return;
    }
    if (decoded is! Map<String, dynamic>) return;
    final socket = peer.socket;
    switch (decoded['type']) {
      case 'hello':
        final protocol = decoded['protocol'];
        peer.protocol = protocol is int && (protocol == 1 || protocol == 2)
            ? protocol
            : 0;
        _send(socket, {
          'type': 'transport',
          'codec': 'pcm',
          'bitrate': hostSampleRate * hostChannels * 16,
        });
        _send(socket, {'type': 'meta', ...state});
        _send(socket, {'type': 'requests', ...requests.snapshot});
      case 'listen':
        peer.wantsAudio = true;
        _broadcastState();
      case 'unlisten':
        peer.wantsAudio = false;
        _broadcastState();
      case 'ping':
        final clientTime = decoded['clientTime'];
        if (clientTime is num) {
          _send(socket, {
            'type': 'pong',
            'clientTime': clientTime,
            'serverTime': nowMs,
          });
        }
      case 'control':
        final action = decoded['action'];
        if (action is! String) return;
        control(action).catchError((Object error) {
          _send(socket, {'type': 'error', 'message': _describe(error)});
        });
      case 'publish':
        _send(socket, {
          'type': 'error',
          'message': 'Le téléphone ne relaie pas un autre flux : il diffuse son micro.',
        });
    }
  }

  void _send(WebSocket socket, Map<String, dynamic> message) {
    try {
      socket.add(jsonEncode(message));
    } catch (_) {
      // La connexion s'en va : onDone fera le ménage.
    }
  }

  void _drop(_Peer peer) {
    peer.wantsAudio = false;
    if (_peers.remove(peer.socket) != null) _broadcastState();
  }

  void _tick() {
    _kbps = ((_bytes - _previousBytes) * 8 / 1000).round();
    _previousBytes = _bytes;
    _egressKbps = ((_egressBytes - _previousEgressBytes) * 8 / 1000).round();
    _previousEgressBytes = _egressBytes;
    if (_peers.isNotEmpty) _broadcastState();
    onChanged?.call();
  }

  void _broadcastState() {
    final message = jsonEncode({'type': 'state', ...state});
    for (final peer in _peers.values) {
      try {
        peer.socket.add(message);
      } catch (_) {
        _drop(peer);
      }
    }
    onChanged?.call();
  }

  void _broadcastRequests() {
    final message = jsonEncode({'type': 'requests', ...requests.snapshot});
    for (final peer in _peers.values) {
      try {
        peer.socket.add(message);
      } catch (_) {
        _drop(peer);
      }
    }
  }

  Future<void> dispose() async {
    _ticker?.cancel();
    _ticker = null;
    for (final peer in _peers.values.toList()) {
      await peer.socket
          .close(WebSocketStatus.goingAway, 'Salon fermé')
          .catchError((Object _) {});
    }
    _peers.clear();
    final server = _server;
    _server = null;
    await server?.close(force: true);
  }
}
