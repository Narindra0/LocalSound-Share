import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'audio/pcm_player.dart';
import 'core/requests.dart';
import 'core/state.dart';
import 'session.dart';
import 'ui/appearance.dart';

/// Assemble le transport ([Session]) et le lecteur ([PcmPlayer]) et garde les
/// préférences de l'auditeur : dernière adresse, volume, calibration, prénom.
class RoomController extends ChangeNotifier {
  RoomController() {
    _player.addListener(_onPlayerChanged);
    _session.addListener(_onSessionChanged);
    _session.onAudioFrame = _player.push;
  }

  static const _kServer = 'serverUrl';
  static const _kVolume = 'volume';
  static const _kCalibration = 'calibration';
  static const _kName = 'requestName';
  static const _kAppearance = 'appearanceMode';

  final PcmPlayer _player = PcmPlayer();
  Session _session = Session(serverUrl: _defaultServer);
  String _serverUrl = _defaultServer;
  String _listenerName = '';
  bool _busy = false;
  String? _notice;
  AppearanceMode _appearance = AppearanceMode.system;

  static const _defaultServer = 'http://192.168.1.10:3000';

  Session get session => _session;
  PcmPlayer get player => _player;
  String get serverUrl => _serverUrl;
  String get listenerName => _listenerName;
  bool get busy => _busy;
  String? get notice => _notice;

  /// Clair, sombre, ou comme le téléphone. Le choix survit au redémarrage.
  AppearanceMode get themeMode => _appearance;

  HostState get state => _session.state;
  RequestsSnapshot get requests => _session.requests;

  /// true dès qu'une connexion a abouti : la reconnexion garde le lecteur à
  /// l'écran plutôt que de renvoyer l'auditeur vers la saisie d'adresse.
  bool get inRoom => _session.everConnected;

  Future<void> loadPreferences() async {
    final prefs = await SharedPreferences.getInstance();
    _serverUrl = prefs.getString(_kServer) ?? _defaultServer;
    _listenerName = prefs.getString(_kName) ?? '';
    final saved = prefs.getString(_kAppearance);
    _appearance = AppearanceMode.values.firstWhere(
      (mode) => mode.name == saved,
      orElse: () => AppearanceMode.system,
    );
    await _player.setVolume(prefs.getDouble(_kVolume) ?? 0.9);
    _openSession(_serverUrl);
    _session.setCalibration(prefs.getDouble(_kCalibration) ?? 0);
    notifyListeners();
  }

  /// Remplace la connexion courante en conservant l'écouteur audio.
  void _openSession(String url) {
    _session.removeListener(_onSessionChanged);
    _session.dispose();
    _session = Session(serverUrl: url);
    _session.onAudioFrame = _player.push;
    _session.addListener(_onSessionChanged);
  }

  /// Se connecte puis demande le flux. Renvoie `true` si le salon répond.
  Future<bool> connect(String url) async {
    final normalized = _normalize(url);
    if (normalized == null) {
      _notice = 'Adresse invalide. Exemple : http://192.168.1.12:3000';
      notifyListeners();
      return false;
    }
    _busy = true;
    _notice = null;
    notifyListeners();

    await _player.pause();
    _openSession(normalized);
    _serverUrl = normalized;

    final ok = await _session.connect();
    _busy = false;
    if (!ok) {
      _notice = _session.error ?? 'Salon injoignable.';
      notifyListeners();
      return false;
    }
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kServer, normalized);

    _session.listen();
    await _player.prepare(sampleRate: state.sampleRate);
    await _player.play();
    notifyListeners();
    return true;
  }

  Future<void> disconnect() async {
    await _player.pause();
    _session.unlisten();
    await _session.disconnect();
    notifyListeners();
  }

  void control(String action) => _session.control(action);

  Future<void> setVolume(double value) async {
    await _player.setVolume(value);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setDouble(_kVolume, _player.volume);
  }

  Future<void> setCalibration(double ms) async {
    _session.setCalibration(ms);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setDouble(_kCalibration, _session.calibrationMs);
  }

  void setListenerName(String value) => _listenerName = value.trim();

  Future<void> setThemeMode(AppearanceMode mode) async {
    if (_appearance == mode) return;
    _appearance = mode;
    notifyListeners();
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kAppearance, mode.name);
  }

  Future<void> submitRequest({required String title, String url = ''}) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kName, _listenerName);
    await _session.submitRequest(title: title, name: _listenerName, url: url);
  }

  Future<void> refreshRequests() async {
    try {
      await _session.fetchRequests();
    } catch (err) {
      _notice = err.toString().replaceFirst('HttpException: ', '');
      notifyListeners();
    }
  }

  void clearNotice() {
    if (_notice == null) return;
    _notice = null;
    notifyListeners();
  }

  String? _normalize(String raw) {
    var value = raw.trim();
    if (value.isEmpty) return null;
    if (!value.startsWith('http://') && !value.startsWith('https://')) {
      value = 'http://$value';
    }
    final uri = Uri.tryParse(value);
    if (uri == null || uri.host.isEmpty) return null;
    return '${uri.scheme}://${uri.host}${uri.hasPort ? ':${uri.port}' : ''}';
  }

  void _onSessionChanged() => notifyListeners();
  void _onPlayerChanged() => notifyListeners();

  @override
  void dispose() {
    _session.removeListener(_onSessionChanged);
    _player.removeListener(_onPlayerChanged);
    _session.dispose();
    _player.dispose();
    super.dispose();
  }
}
