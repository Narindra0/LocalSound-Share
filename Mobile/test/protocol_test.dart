import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:localsound_mobile/core/protocol.dart';
import 'package:localsound_mobile/core/state.dart';

/// Reproduit exactement l'encapsulage de `server.js` (broadcastAudio) et de
/// `opus-stream.js` (worker), pour vérifier que Dart lit ce que Node écrit.
Uint8List pcmPacket({
  required String magic,
  required int sequence,
  required double capturedAt,
  double? playAt,
  required List<int> samples,
}) {
  final header = playAt != null ? 24 : 16;
  final bytes = Uint8List(header + samples.length * 2);
  final view = ByteData.sublistView(bytes);
  for (var i = 0; i < 4; i++) {
    bytes[i] = magic.codeUnitAt(i);
  }
  view.setUint32(4, sequence, Endian.little);
  view.setFloat64(8, capturedAt, Endian.little);
  if (playAt != null) {
    view.setFloat64(16, playAt, Endian.little);
  }
  for (var i = 0; i < samples.length; i++) {
    view.setInt16(header + i * 2, samples[i], Endian.little);
  }
  return bytes;
}

Uint8List opusPacket({
  int sequence = 7,
  double capturedAt = 1000.5,
  double playAt = 1150.5,
  int streamId = 65536,
  int generation = 3,
  int frameSamples = opusFrameSamples,
  int lookahead = opusLookahead,
  int bitrate = 192000,
  List<int> payload = const [1, 2, 3, 4, 5],
}) {
  final bytes = Uint8List(opusHeaderBytes + payload.length);
  final view = ByteData.sublistView(bytes);
  for (var i = 0; i < 4; i++) {
    bytes[i] = 'LSO3'.codeUnitAt(i);
  }
  view.setUint32(4, sequence, Endian.little);
  view.setFloat64(8, capturedAt, Endian.little);
  view.setFloat64(16, playAt, Endian.little);
  view.setUint32(24, streamId, Endian.little);
  view.setUint32(28, generation, Endian.little);
  view.setUint16(32, frameSamples, Endian.little);
  view.setUint16(34, lookahead, Endian.little);
  view.setUint32(36, bitrate, Endian.little);
  bytes.setAll(opusHeaderBytes, payload);
  return bytes;
}

void main() {
  group('trames PCM', () {
    test('LSP1 : horodatage de capture sans échéance, PCM normalisé', () {
      final frame = decodeAudioFrame(
        pcmPacket(
          magic: 'LSP1',
          sequence: 42,
          capturedAt: 1234.5,
          samples: [0, 32767, -32768, 16384],
        ),
      ) as PcmFrame;

      expect(frame.protocol, 1);
      expect(frame.sequence, 42);
      expect(frame.capturedAt, 1234.5);
      expect(frame.playAt, isNull);
      expect(frame.synchronized, isFalse);
      // Deux trames stéréo entrelacées : (0, 32767) puis (-32768, 16384).
      expect(frame.left, [0.0, -1.0]);
      expect(frame.right, [closeTo(32767 / 32768, 1e-6), 0.5]);
    });

    test('LSP2 : porte une échéance commune, lecture synchronisée', () {
      final frame = decodeAudioFrame(
        pcmPacket(
          magic: 'LSP2',
          sequence: 9,
          capturedAt: 500.0,
          playAt: 650.0,
          samples: List.filled(8, 1000),
        ),
      ) as PcmFrame;

      expect(frame.protocol, 2);
      expect(frame.playAt, 650.0);
      expect(frame.synchronized, isTrue);
      expect(frame.left, hasLength(4));
      expect(frame.right, hasLength(4));
    });

    test('une trame stéréo incomplète est coupée, jamais devinée', () {
      // 6 octets PCM = 1 trame complète et demie : seule la première est lue.
      final bytes = pcmPacket(
        magic: 'LSP2',
        sequence: 1,
        capturedAt: 1.0,
        playAt: 2.0,
        samples: [100, -100, 100],
      );
      final frame = decodeAudioFrame(bytes) as PcmFrame;
      expect(frame.left, hasLength(1));
      expect(frame.left[0], closeTo(100 / 32768, 1e-6));

      // 2 octets seulement : même un en-tête valide ne produit aucun échantillon.
      expect(decodeAudioFrame(bytes.sublist(0, 24 + 2)), isNull);
    });

    test('PCM sans en-tête (protocole 0) est lu tel quel', () {
      final bytes = Uint8List.fromList([
        for (var i = 0; i < 4; i++) 0,
        0x00,
        0x40,
        0x00,
        0xC0,
      ]);
      final frame = decodeAudioFrame(bytes) as PcmFrame;
      expect(frame.protocol, 0);
      expect(frame.sequence, isNull);
      expect(frame.capturedAt, isNull);
      // (0, 0) puis (16384, -16384) : deux trames stéréo entrelacées.
      expect(frame.left, [0.0, 0.5]);
      expect(frame.right, [0.0, -0.5]);
    });

    test('un buffer vide est refusé', () {
      expect(decodeAudioFrame(Uint8List(0)), isNull);
    });
  });

  group('trames Opus', () {
    test('LSO3 : en-tête complet et payload isolé', () {
      final frame = decodeAudioFrame(opusPacket()) as OpusFrame;
      expect(frame.sequence, 7);
      expect(frame.capturedAt, 1000.5);
      expect(frame.playAt, 1150.5);
      expect(frame.streamId, 65536);
      expect(frame.generation, 3);
      expect(frame.frameSamples, 960);
      expect(frame.lookahead, 120);
      expect(frame.bitrate, 192000);
      expect(frame.payload, [1, 2, 3, 4, 5]);
    });

    test('une trame à la mauvaise taille de trame libopus est jetée', () {
      expect(decodeAudioFrame(opusPacket(frameSamples: 480)), isNull);
      expect(decodeAudioFrame(opusPacket(lookahead: 0)), isNull);
    });

    test('une échéance non finie invalide la trame', () {
      expect(decodeAudioFrame(opusPacket(playAt: double.nan)), isNull);
    });

    test('un en-tête tronqué est jeté', () {
      final bytes = opusPacket();
      expect(decodeAudioFrame(bytes.sublist(0, opusHeaderBytes - 1)), isNull);
    });
  });

  group('dédoublonnage', () {
    test('une réémission exacte est refusée, une séquence neuve acceptée', () {
      final guard = SequenceGuard();
      expect(guard.accept(1), isTrue);
      expect(guard.accept(1), isFalse);
      expect(guard.accept(2), isTrue);
      guard.reset();
      expect(guard.accept(1), isTrue);
    });

    test('les trames sans séquence passent toujours', () {
      final guard = SequenceGuard();
      expect(guard.accept(null), isTrue);
      expect(guard.accept(null), isTrue);
    });
  });

  group('messages sortants', () {
    test('hello porte rôle, protocole et codec attendus par le serveur', () {
      expect(jsonDecode(buildHello(protocol: 2, codec: 'pcm')), {
        'type': 'hello',
        'role': 'client',
        'protocol': 2,
        'codec': 'pcm',
      });
    });

    test('ping, listen et control suivent le format de server.js', () {
      expect(jsonDecode(buildPing(12.5)), {'type': 'ping', 'clientTime': 12.5});
      expect(jsonDecode(buildListen()), {'type': 'listen'});
      expect(jsonDecode(buildUnlisten()), {'type': 'unlisten'});
      expect(jsonDecode(buildControl('pause')), {
        'type': 'control',
        'action': 'pause',
      });
    });
  });

  group('messages entrants', () {
    test('transport annonce le codec retenu', () {
      final message = parseServerMessage(
        jsonEncode({'type': 'transport', 'codec': 'pcm', 'bitrate': 0}),
      ) as TransportMessage;
      expect(message.codec, 'pcm');
      expect(message.bitrate, 0);
      expect(message.fallback, isFalse);
    });

    test('state et meta portent le même état hôte', () {
      final payload = {
        'application': 'localsound-share',
        'version': '0.1.5',
        'host': 'PC-SONORE',
        'urls': ['http://192.168.1.12:3000', 'localhost'],
        'audio': {
          'sampleRate': 48000,
          'channels': 2,
          'bitDepth': 16,
          'encoding': 's16le',
        },
        'active': true,
        'playing': true,
        'clients': 3,
        'kbps': 208,
        'error': null,
        'sourceKind': 'file',
        'synchronized': true,
        'syncDelayMs': 150,
        'generation': 4,
        'appearance': {'theme': 'cassette', 'palette': 'forest'},
        'network': {
          'mode': 'high',
          'opusAvailable': true,
          'bitrate': 192000,
          'egressKbps': 624,
          'compressedFrames': 120,
          'opusListeners': 2,
          'pcmListeners': 1,
        },
        'requestCount': 2,
        'trackName': 'Morimou Traibe',
        'nowPlaying': {
          'title': 'Morimou Traibe',
          'artist': 'Rossy',
          'artwork': '/api/artwork/abc',
          'source': 'file',
        },
        'metadataStatus': 'file',
        'sourceReady': true,
        'signal': true,
      };

      final state = (parseServerMessage(
        jsonEncode({'type': 'state', ...payload}),
      ) as StateMessage).state;
      expect(state.version, '0.1.5');
      expect(state.host, 'PC-SONORE');
      expect(state.urls, ['http://192.168.1.12:3000', 'localhost']);
      expect(state.sampleRate, 48000);
      expect(state.playing, isTrue);
      expect(state.sourceKind, 'file');
      expect(state.synchronized, isTrue);
      expect(state.syncDelayMs, 150);
      expect(state.generation, 4);
      expect(state.appearance['theme'], 'cassette');
      expect(state.network.bitrate, 192000);
      expect(state.network.pcmListeners, 1);
      expect(state.requestCount, 2);
      expect(state.nowPlaying?.title, 'Morimou Traibe');
      expect(state.nowPlaying?.artwork, '/api/artwork/abc');
      expect(state.signal, isTrue);

      final meta = (parseServerMessage(
        jsonEncode({'type': 'meta', ...payload}),
      ) as StateMessage).state;
      expect(meta.generation, state.generation);

      expect(HostState.fromJson(const {}).syncDelayMs, 150);
      expect(HostState.fromJson(const {}).appearance['theme'], 'vinyl');
      expect(HostState.fromJson(const {}).urls, isEmpty);
    });

    test('pong sert de mesure aller-retour à l\'horloge', () {
      final message = parseServerMessage(
        jsonEncode({'type': 'pong', 'clientTime': 10.5, 'serverTime': 995.25}),
      ) as PongMessage;
      expect(message.clientTime, 10.5);
      expect(message.serverTime, 995.25);
    });

    test('error expose le message serveur', () {
      final message = parseServerMessage(
        jsonEncode({
          'type': 'error',
          'message': 'Commandes réservées au PC hôte.',
        }),
      ) as ErrorMessage;
      expect(message.message, 'Commandes réservées au PC hôte.');
    });

    test('JSON illisible ou type inconnu est ignoré', () {
      expect(parseServerMessage('{pas du json'), isNull);
      expect(parseServerMessage('[1, 2, 3]'), isNull);
      expect(
        parseServerMessage(jsonEncode({'type': 'publisher-ready'})),
        isNull,
      );
      expect(parseServerMessage(jsonEncode({'nope': true})), isNull);
      expect(
        parseServerMessage(jsonEncode({'type': 'pong', 'clientTime': 'x'})),
        isNull,
      );
    });
  });
}
