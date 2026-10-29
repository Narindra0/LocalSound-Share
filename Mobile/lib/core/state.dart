/// États renvoyés par `GET /api/status` et par les messages `state`/`meta`.
///
/// Tous les champs sont optionnels côté serveur selon la source : les valeurs
/// par défaut correspondent à un salon prêt mais inactif.
library;

int _asInt(Object? value, int fallback) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  return fallback;
}

bool _asBool(Object? value, bool fallback) => value is bool ? value : fallback;

String? _asString(Object? value) => value is String ? value : null;

Map<String, dynamic> _asMap(Object? value) =>
    value is Map<String, dynamic> ? value : const <String, dynamic>{};

/// Le morceau en cours, quelle qu'en soit la source (fichier, YouTube, manuel…).
class NowPlaying {
  const NowPlaying({
    required this.title,
    this.artist = '',
    this.artwork,
    this.source,
  });

  factory NowPlaying.fromJson(Map<String, dynamic> json) => NowPlaying(
    title: _asString(json['title']) ?? '',
    artist: _asString(json['artist']) ?? '',
    artwork: _asString(json['artwork']),
    source: _asString(json['source']),
  );

  final String title;
  final String artist;

  /// Chemin `/api/artwork/<sha256>` ou URL absolue ; `null` s'il n'y a pas de pochette.
  final String? artwork;
  final String? source;
}

/// Débit et ventilation PCM/Opus des auditeurs connectés.
class NetworkInfo {
  const NetworkInfo({
    this.mode = 'high',
    this.opusAvailable = true,
    this.bitrate = 192000,
    this.egressKbps = 0,
    this.compressedFrames = 0,
    this.opusListeners = 0,
    this.pcmListeners = 0,
  });

  factory NetworkInfo.fromJson(Map<String, dynamic> json) => NetworkInfo(
    mode: _asString(json['mode']) ?? 'high',
    opusAvailable: _asBool(json['opusAvailable'], true),
    bitrate: _asInt(json['bitrate'], 192000),
    egressKbps: _asInt(json['egressKbps'], 0),
    compressedFrames: _asInt(json['compressedFrames'], 0),
    opusListeners: _asInt(json['opusListeners'], 0),
    pcmListeners: _asInt(json['pcmListeners'], 0),
  );

  final String mode;
  final bool opusAvailable;
  final int bitrate;
  final int egressKbps;
  final int compressedFrames;
  final int opusListeners;
  final int pcmListeners;
}

class HostState {
  const HostState({
    this.application = 'localsound-share',
    this.version = '',
    this.host = '',
    this.urls = const [],
    this.sampleRate = 48000,
    this.active = false,
    this.playing = false,
    this.clients = 0,
    this.kbps = 0,
    this.error,
    this.sourceKind = 'system',
    this.synchronized = false,
    this.syncDelayMs = 150,
    this.generation = 0,
    this.appearance = const {'theme': 'vinyl', 'palette': 'terracotta'},
    this.network = const NetworkInfo(),
    this.requestCount = 0,
    this.trackName,
    this.nowPlaying,
    this.metadataStatus = '',
    this.sourceReady = false,
    this.signal = false,
  });

  factory HostState.fromJson(Map<String, dynamic> json) {
    final nowPlaying = json['nowPlaying'];
    final appearance = <String, dynamic>{..._asMap(json['appearance'])}
      ..putIfAbsent('theme', () => 'vinyl')
      ..putIfAbsent('palette', () => 'terracotta');
    return HostState(
      application: _asString(json['application']) ?? 'localsound-share',
      version: _asString(json['version']) ?? '',
      host: _asString(json['host']) ?? '',
      urls: json['urls'] is List
          ? (json['urls'] as List).whereType<String>().toList(growable: false)
          : const [],
      sampleRate: _asInt(_asMap(json['audio'])['sampleRate'], 48000),
      active: _asBool(json['active'], false),
      playing: _asBool(json['playing'], false),
      clients: _asInt(json['clients'], 0),
      kbps: _asInt(json['kbps'], 0),
      error: _asString(json['error']),
      sourceKind: _asString(json['sourceKind']) ?? 'system',
      synchronized: _asBool(json['synchronized'], false),
      syncDelayMs: _asInt(json['syncDelayMs'], 150),
      generation: _asInt(json['generation'], 0),
      appearance: appearance,
      network: NetworkInfo.fromJson(_asMap(json['network'])),
      requestCount: _asInt(json['requestCount'], 0),
      trackName: _asString(json['trackName']),
      nowPlaying: nowPlaying is Map<String, dynamic>
          ? NowPlaying.fromJson(nowPlaying)
          : null,
      metadataStatus: _asString(json['metadataStatus']) ?? '',
      sourceReady: _asBool(json['sourceReady'], false),
      signal: _asBool(json['signal'], false),
    );
  }

  final String application;
  final String version;
  final String host;

  /// Adresses LAN proposées aux auditeurs, sans chemin.
  final List<String> urls;
  final int sampleRate;
  final bool active;
  final bool playing;
  final int clients;
  final int kbps;
  final String? error;

  /// `system`, `file` ou `tab`.
  final String sourceKind;

  /// true si la source suit l'échéance commune (fichier ou onglet).
  final bool synchronized;
  final int syncDelayMs;
  final int generation;

  /// `{theme, palette}` — vinyle, cassette, cd, reel, mp3, radio.
  final Map<String, dynamic> appearance;
  final NetworkInfo network;
  final int requestCount;
  final String? trackName;
  final NowPlaying? nowPlaying;
  final String metadataStatus;
  final bool sourceReady;

  /// Le flux porte réellement du son (sinon : « En attente de son »).
  final bool signal;

  /// L'hôte est-il en mesure de diffuser selon la source sélectionnée.
  bool get canPlay => sourceKind == 'system'
      ? active || error == null
      : sourceKind == 'file'
      ? trackName != null
      : sourceReady;

  HostState copyWith({
    bool? playing,
    int? generation,
    int? syncDelayMs,
    String? error,
  }) => HostState(
    application: application,
    version: version,
    host: host,
    urls: urls,
    sampleRate: sampleRate,
    active: active,
    playing: playing ?? this.playing,
    clients: clients,
    kbps: kbps,
    error: error ?? this.error,
    sourceKind: sourceKind,
    synchronized: synchronized,
    syncDelayMs: syncDelayMs ?? this.syncDelayMs,
    generation: generation ?? this.generation,
    appearance: appearance,
    network: network,
    requestCount: requestCount,
    trackName: trackName,
    nowPlaying: nowPlaying,
    metadataStatus: metadataStatus,
    sourceReady: sourceReady,
    signal: signal,
  );
}
