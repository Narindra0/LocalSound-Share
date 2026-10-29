import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:web_socket_channel/status.dart' as ws_status;
import 'package:web_socket_channel/web_socket_channel.dart';

import 'package:localsound_mobile/core/protocol.dart';
import 'package:localsound_mobile/core/requests.dart';
import 'package:localsound_mobile/core/room_clock.dart';
import 'package:localsound_mobile/core/state.dart';

enum LinkState { disconnected, connecting, connected, reconnecting }

/// Transport WebSocket du salon : négociation, audio binaire, horloge commune
/// et commandes de lecture.
///
/// Le serveur (`server.js`) expose un unique point d'entrée `/listen` :
/// - on annonce `hello {protocol:2, codec:'pcm'}` puis `listen` ;
/// - il renvoie `transport`, `meta`, `requests` puis les trames binaires ;
/// - un `ping` toutes les 1,2 s alimente [RoomClock] via son `pong`.
///
/// Les trames binaires sont décodées par `core/protocol.dart` puis remises au
/// lecteur audio via [onAudioFrame]. Un paquet déjà trop vieux n'est jamais
/// réémis en retard : il est compté dans [droppedFrames] et jeté.
class Session extends ChangeNotifier {
  Session({required this.serverUrl});

  final String serverUrl;
  final RoomClock _clock = RoomClock();
  final SequenceGuard _sequence = SequenceGuard();
  final List<double> _latencies = [];

  WebSocketChannel? _channel;
  StreamSubscription<dynamic>? _subscription;
  Timer? _pingTimer;
  Timer? _reconnectTimer;
  int _attempt = 0;
  bool _disposed = false;
  bool _manuallyClosed = false;
  bool _established = false;

  LinkState _connection = LinkState.disconnected;
  bool _listening = false;
  double _calibrationMs = 0;
  String _codec = 'pcm';
  String? _error;
  HostState _state = const HostState();
  RequestsSnapshot _requests = const RequestsSnapshot();
  int _droppedFrames = 0;
  int _playedFrames = 0;

  /// Reçoit chaque trame audio jugée bonne pour la lecture.
  void Function(AudioFrame frame)? onAudioFrame;

  /// Appelé à chaque changement d'état de connexion.
  void Function(LinkState state)? onConnectionChanged;

  LinkState get connection => _connection;
  bool get connected => _connection == LinkState.connected;

  /// true dès qu'une connexion a abouti : seule une session déjà établie
  /// tente de revenir après une coupure. Une adresse erronée reste une erreur.
  bool get everConnected => _established;
  bool get listening => _listening;
  bool get clockReady => _clock.ready;
  String get codec => _codec;
  String? get error => _error;
  HostState get state => _state;
  RequestsSnapshot get requests => _requests;
  RoomClock get clock => _clock;
  double get calibrationMs => _calibrationMs;
  int get droppedFrames => _droppedFrames;
  int get playedFrames => _playedFrames;

  /// Dernier aller-retour mesuré, en ms (médiane des cinq dernières mesures).
  double? get latencyMs {
    if (_latencies.isEmpty) return null;
    final sorted = [..._latencies]..sort();
    return sorted[sorted.length ~/ 2];
  }

  /// Adresse HTTP du salon (pour les requêtes `fetch` et les pochettes).
  String get httpBase {
    final uri = Uri.parse(serverUrl);
    final port = uri.hasPort ? ':${uri.port}' : '';
    return '${uri.scheme == 'https' ? 'https' : 'http'}://${uri.host}$port';
  }

  Uri _listenUri() {
    final uri = Uri.parse(serverUrl);
    final port = uri.hasPort ? ':${uri.port}' : '';
    return Uri.parse('ws://${uri.host}$port/listen');
  }

  Future<bool> connect() async {
    if (_connection == LinkState.connected ||
        _connection == LinkState.connecting) {
      return false;
    }
    _manuallyClosed = false;
    _setConnection(
      _attempt == 0 ? LinkState.connecting : LinkState.reconnecting,
    );
    _error = null;
    try {
      final channel = WebSocketChannel.connect(_listenUri());
      await channel.ready.timeout(const Duration(seconds: 6));
      _channel = channel;
      _subscription = channel.stream.listen(
        _handleData,
        onError: _handleDone,
        onDone: _handleDone,
        cancelOnError: false,
      );
      _attempt = 0;
      _established = true;
      _setConnection(LinkState.connected);
      _send(buildHello(protocol: 2, codec: 'pcm'));
      _startPinging();
      if (_listening) _send(buildListen());
      return true;
    } catch (err) {
      _error = 'Connexion impossible à $serverUrl.';
      _setConnection(LinkState.disconnected);
      if (_established) _scheduleReconnect();
      return false;
    }
  }

  Future<void> disconnect() async {
    _manuallyClosed = true;
    _established = false;
    _reconnectTimer?.cancel();
    _pingTimer?.cancel();
    _listening = false;
    await _subscription?.cancel();
    _subscription = null;
    await _channel?.sink.close(ws_status.normalClosure);
    _channel = null;
    _clock.reset();
    _sequence.reset();
    _setConnection(LinkState.disconnected);
  }

  void _handleData(dynamic raw) {
    if (raw is String) {
      _handleText(raw);
      return;
    }
    final bytes = raw is Uint8List
        ? raw
        : raw is List<int>
        ? Uint8List.fromList(raw)
        : null;
    if (bytes == null) return;
    final frame = decodeAudioFrame(bytes);
    if (frame == null) return;
    if (!_sequence.accept(
      frame is PcmFrame ? frame.sequence : (frame as OpusFrame).sequence,
    )) {
      return;
    }
    if (frame is PcmFrame) {
      final capturedAt = frame.capturedAt;
      if (capturedAt != null &&
          _clock.isStale(capturedAt: capturedAt, now: _now())) {
        _droppedFrames++;
        return;
      }
    }
    _playedFrames++;
    onAudioFrame?.call(frame);
  }

  void _handleText(String raw) {
    final message = parseServerMessage(raw);
    if (message == null) return;
    switch (message) {
      case TransportMessage():
        _codec = message.codec;
      case StateMessage():
        _state = message.state;
      case RequestsMessage():
        if (message.snapshot.revision >= _requests.revision) {
          _requests = message.snapshot;
        }
      case PongMessage():
        final now = _now();
        _clock.update(
          clientTime: message.clientTime,
          serverTime: message.serverTime,
          now: now,
        );
        _latencies.add(now - message.clientTime);
        if (_latencies.length > 5) _latencies.removeAt(0);
      case ErrorMessage():
        _error = message.message;
    }
    notifyListeners();
  }

  void _handleDone([Object? error]) {
    _pingTimer?.cancel();
    _subscription = null;
    _channel = null;
    _listening = false;
    if (error != null) _error = 'Connexion interrompue.';
    _setConnection(LinkState.disconnected);
    if (_established) _scheduleReconnect();
  }

  void _scheduleReconnect() {
    if (_manuallyClosed || _disposed) return;
    _reconnectTimer?.cancel();
    _attempt++;
    final seconds = (1 << (_attempt.clamp(1, 4) - 1)).clamp(1, 10);
    _setConnection(LinkState.reconnecting);
    _reconnectTimer = Timer(Duration(seconds: seconds), connect);
  }

  void _startPinging() {
    _pingTimer?.cancel();
    _pingTimer = Timer.periodic(const Duration(milliseconds: 1200), (_) {
      if (!connected) return;
      _send(buildPing(_now()));
    });
  }

  void _send(String message) {
    try {
      _channel?.sink.add(message);
    } catch (_) {
      // La reconnexion prend le relais.
    }
  }

  void _setConnection(LinkState value) {
    if (_connection == value) return;
    _connection = value;
    onConnectionChanged?.call(value);
    notifyListeners();
  }

  double _now() => DateTime.now().millisecondsSinceEpoch.toDouble();

  /// Demande le flux audio. Sans cela le serveur n'envoie rien.
  void listen() {
    if (_listening) return;
    _listening = true;
    _send(buildListen());
    // Un ping immédiat accélère la première synchro d'horloge.
    _send(buildPing(_now()));
    notifyListeners();
  }

  void unlisten() {
    if (!_listening) return;
    _listening = false;
    _send(buildUnlisten());
    notifyListeners();
  }

  /// `play`, `pause` ou `stop`. Le serveur répond `state` (ou `error`).
  void control(String action) {
    if (!connected) {
      _error = 'Hors ligne : impossible de piloter le salon.';
      notifyListeners();
      return;
    }
    _send(buildControl(action));
  }

  void setCalibration(double ms) {
    final clamped = ms.clamp(-80.0, 80.0);
    if (clamped == _calibrationMs) return;
    _calibrationMs = clamped;
    notifyListeners();
  }

  void clearError() {
    if (_error == null) return;
    _error = null;
    notifyListeners();
  }

  // ---------------------------------------------------------------------
  // Requêtes HTTP (file de demandes, pochette)
  // ---------------------------------------------------------------------

  /// Récupère la file complète sans attendre le WebSocket.
  Future<RequestsSnapshot?> fetchRequests() async {
    final data = await _http('GET', '/api/requests');
    if (data == null) return null;
    final snapshot = RequestsSnapshot.fromJson(data);
    _requests = snapshot;
    notifyListeners();
    return snapshot;
  }

  /// Envoie une proposition de morceau. Le serveur choisit de la retenir.
  Future<RequestsSnapshot?> submitRequest({
    required String title,
    String name = '',
    String url = '',
  }) async {
    final data = await _http('POST', '/api/requests', {
      'title': title.trim(),
      if (name.trim().isNotEmpty) 'name': name.trim(),
      if (url.trim().isNotEmpty) 'url': url.trim(),
    });
    if (data == null) return null;
    final snapshot = RequestsSnapshot.fromJson(data);
    if (snapshot.revision >= _requests.revision) {
      _requests = snapshot;
      notifyListeners();
    }
    return snapshot;
  }

  /// `GET`/`POST` JSON simple ; lève une exception lisible en cas d'échec.
  Future<Map<String, dynamic>?> _http(
    String method,
    String path, [
    Map<String, dynamic>? body,
  ]) async {
    final client = HttpClient()..connectionTimeout = const Duration(seconds: 5);
    try {
      final request = await client.openUrl(method, Uri.parse('$httpBase$path'));
      request.headers.set(HttpHeaders.acceptHeader, 'application/json');
      if (body != null) {
        request.headers.contentType = ContentType.json;
        request.write(jsonEncode(body));
      }
      final response = await request.close().timeout(
        const Duration(seconds: 8),
      );
      final text = await response.transform(utf8.decoder).join();
      final decoded = text.isEmpty ? null : jsonDecode(text);
      if (response.statusCode >= 400) {
        final message = decoded is Map && decoded['error'] is String
            ? decoded['error'] as String
            : 'Erreur ${response.statusCode}.';
        throw HttpException(message);
      }
      return decoded is Map<String, dynamic> ? decoded : null;
    } on HttpException {
      rethrow;
    } catch (err) {
      _error = 'Le salon ne répond pas.';
      notifyListeners();
      throw HttpException(_error!);
    } finally {
      client.close(force: true);
    }
  }

  /// Pochette ou avatar : chemin `/api/artwork/…` ou URL absolue.
  Uri? resolveUri(String? value) {
    if (value == null || value.isEmpty) return null;
    final uri = Uri.tryParse(value);
    if (uri == null) return null;
    if (uri.hasScheme) return uri;
    return Uri.tryParse('$httpBase$value');
  }

  @override
  void dispose() {
    _disposed = true;
    _manuallyClosed = true;
    _pingTimer?.cancel();
    _reconnectTimer?.cancel();
    _subscription?.cancel();
    _channel?.sink.close(ws_status.normalClosure);
    super.dispose();
  }
}
