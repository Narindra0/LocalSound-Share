/// Protocoles binaires échangés avec `server.js` et `opus-stream.js`.
///
/// Toutes les valeurs sont en little-endian et les horodatages sont des
/// millisecondes sur l'horloge monotone du serveur (`performance.now()`).
///
/// * `LSP1` : magic(4) + séquence u32 + capturedAt f64 + PCM s16le stéréo
/// * `LSP2` : magic(4) + séquence u32 + capturedAt f64 + playAt f64 + PCM s16le stéréo
/// * `LSO3` : magic(4) + séquence u32 + capturedAt f64 + playAt f64 + streamId u32
///   + generation u32 + frame u16 + lookahead u16 + bitrate u32 + payload Opus
///
/// Un paquet sans en-tête reconnu est du PCM nu (ancien protocole 0), exactement
/// comme le décide `public/client.js`.
library;

import 'dart:convert';
import 'dart:typed_data';

import 'requests.dart';
import 'state.dart';

const int _kLsp1 = 0x3150534C; // 'LSP1'
const int _kLsp2 = 0x3250534C; // 'LSP2'
const int _kLso3 = 0x334F534C; // 'LSO3'

/// Trames attendues par libopus pour ce flux : 20 ms à 48 kHz, lookahead verrouillé.
const int opusFrameSamples = 960;
const int opusLookahead = 120;
const int opusHeaderBytes = 40;
const int pcmFrameBytes = 4; // stéréo 16 bits

/// Un paquet audio décodé.
sealed class AudioFrame {
  const AudioFrame();
}

/// PCM s16le stéréo 48 kHz. [sequence], [capturedAt] et [playAt] sont absents
/// sur le protocole 0 (aucun en-tête).
class PcmFrame extends AudioFrame {
  const PcmFrame({
    this.sequence,
    this.capturedAt,
    this.playAt,
    required this.left,
    required this.right,
    required this.protocol,
  });

  final int? sequence;
  final double? capturedAt;

  /// Échéance commune en ms sur l'horloge du serveur ; nulle sur `LSP1`.
  final double? playAt;
  final Float32List left;
  final Float32List right;
  final int protocol;

  /// true si l'hôte a joint une échéance à respecter (lecture synchronisée).
  bool get synchronized => protocol >= 2 && playAt != null;
}

/// Trame Opus `LSO3`. Le payload seul part au décodeur ; l'en-tête sert à la
/// synchronisation et au rejet des trames d'une source antérieure.
class OpusFrame extends AudioFrame {
  const OpusFrame({
    required this.sequence,
    required this.capturedAt,
    required this.playAt,
    required this.streamId,
    required this.generation,
    required this.frameSamples,
    required this.lookahead,
    required this.bitrate,
    required this.payload,
  });

  final int sequence;
  final double capturedAt;
  final double playAt;
  final int streamId;
  final int generation;
  final int frameSamples;
  final int lookahead;
  final int bitrate;
  final Uint8List payload;
}

int _magic(Uint8List bytes) => bytes.length < 4
    ? -1
    : bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24);

/// Décode une trame audio reçue en binaire. Renvoie `null` quand la trame est
/// invalide ou trop ancienne pour être utile : l'appelant la jette alors sans
/// la pousser au lecteur.
AudioFrame? decodeAudioFrame(Uint8List bytes) {
  if (bytes.isEmpty) return null;
  final magic = _magic(bytes);

  if (magic == _kLso3) {
    if (bytes.length < opusHeaderBytes + 1) return null;
    final view = ByteData.sublistView(bytes);
    final playAt = view.getFloat64(16, Endian.little);
    if (!playAt.isFinite) return null;
    final frameSamples = view.getUint16(32, Endian.little);
    final lookahead = view.getUint16(34, Endian.little);
    if (frameSamples != opusFrameSamples || lookahead != opusLookahead) {
      return null;
    }
    return OpusFrame(
      sequence: view.getUint32(4, Endian.little),
      capturedAt: view.getFloat64(8, Endian.little),
      playAt: playAt,
      streamId: view.getUint32(24, Endian.little),
      generation: view.getUint32(28, Endian.little),
      frameSamples: frameSamples,
      lookahead: lookahead,
      bitrate: view.getUint32(36, Endian.little),
      payload: bytes.sublist(opusHeaderBytes),
    );
  }

  int offset;
  int protocol;
  if (magic == _kLsp2 && bytes.length >= 24) {
    offset = 24;
    protocol = 2;
  } else if (magic == _kLsp1 && bytes.length >= 16) {
    offset = 16;
    protocol = 1;
  } else {
    offset = 0;
    protocol = 0;
  }

  final usable = bytes.length - offset;
  final frames = usable ~/ pcmFrameBytes;
  if (frames == 0) return null;
  // L'en-tête se lit depuis l'origine du paquet, le PCM depuis sa charge utile :
  // les index d'un ByteData sont relatifs au début de la vue, pas au paquet.
  final header = ByteData.sublistView(bytes);
  final samples = ByteData.sublistView(
    bytes,
    offset,
    offset + frames * pcmFrameBytes,
  );
  final left = Float32List(frames), right = Float32List(frames);
  for (var i = 0; i < frames; i++) {
    left[i] = samples.getInt16(i * pcmFrameBytes, Endian.little) / 32768;
    right[i] = samples.getInt16(i * pcmFrameBytes + 2, Endian.little) / 32768;
  }

  final hasHeader = protocol >= 1;
  return PcmFrame(
    protocol: protocol,
    sequence: hasHeader ? header.getUint32(4, Endian.little) : null,
    capturedAt: hasHeader ? header.getFloat64(8, Endian.little) : null,
    playAt: protocol >= 2 ? header.getFloat64(16, Endian.little) : null,
    left: left,
    right: right,
  );
}

/// Filtre les réémissions : le serveur incrémente `sequence` à chaque bloc
/// envoyé, une répétition exacte vient d'un paquet rejoué par la pile réseau.
class SequenceGuard {
  int? _last;

  bool accept(int? sequence) {
    if (sequence == null) return true;
    if (_last != null && sequence == _last) return false;
    _last = sequence;
    return true;
  }

  void reset() => _last = null;
}

// ---------------------------------------------------------------------------
// Messages texte (JSON)
// ---------------------------------------------------------------------------

/// Première commande de la connexion : négocie protocole et codec.
String buildHello({
  required int protocol,
  required String codec,
  String role = 'client',
}) => jsonEncode({
  'type': 'hello',
  'role': role,
  'protocol': protocol,
  'codec': codec,
});

String buildListen() => jsonEncode({'type': 'listen'});

String buildUnlisten() => jsonEncode({'type': 'unlisten'});

String buildPing(double clientTime) =>
    jsonEncode({'type': 'ping', 'clientTime': clientTime});

String buildControl(String action) =>
    jsonEncode({'type': 'control', 'action': action});

sealed class ServerMessage {
  const ServerMessage();
}

/// `transport` : codec retenu pour cette connexion après négociation.
class TransportMessage extends ServerMessage {
  const TransportMessage({
    required this.codec,
    this.bitrate,
    this.fallback = false,
  });

  final String codec;
  final int? bitrate;
  final bool fallback;
}

/// `state` et `meta` : l'état complet de l'hôte, identiques à `GET /api/status`.
class StateMessage extends ServerMessage {
  const StateMessage(this.state);

  final HostState state;
}

/// `requests` : snapshot de la file de demandes de morceaux.
class RequestsMessage extends ServerMessage {
  const RequestsMessage(this.snapshot);

  final RequestsSnapshot snapshot;
}

/// `pong` : mesure aller-retour utilisée par l'horloge commune.
class PongMessage extends ServerMessage {
  const PongMessage({required this.clientTime, required this.serverTime});

  final double clientTime;
  final double serverTime;
}

class ErrorMessage extends ServerMessage {
  const ErrorMessage(this.message);

  final String message;
}

/// Analyse un message texte du serveur. Renvoie `null` si le JSON est illisible
/// ou si le type est inconnu : l'appelant ignore silencieusement.
ServerMessage? parseServerMessage(String raw) {
  Object? decoded;
  try {
    decoded = jsonDecode(raw);
  } catch (_) {
    return null;
  }
  if (decoded is! Map<String, dynamic>) return null;
  final json = decoded;
  final type = json['type'];
  if (type is! String) return null;

  switch (type) {
    case 'transport':
      return TransportMessage(
        codec: json['codec'] is String ? json['codec'] as String : 'pcm',
        bitrate: json['bitrate'] is num
            ? (json['bitrate'] as num).toInt()
            : null,
        fallback: json['fallback'] == true,
      );
    case 'state':
    case 'meta':
      return StateMessage(HostState.fromJson(json));
    case 'requests':
      return RequestsMessage(RequestsSnapshot.fromJson(json));
    case 'pong':
      final clientTime = json['clientTime'], serverTime = json['serverTime'];
      if (clientTime is! num || serverTime is! num) return null;
      return PongMessage(
        clientTime: clientTime.toDouble(),
        serverTime: serverTime.toDouble(),
      );
    case 'error':
      return ErrorMessage(
        json['message'] is String
            ? json['message'] as String
            : 'Erreur du serveur.',
      );
    default:
      return null;
  }
}
