import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';

import 'package:localsound_mobile/core/protocol.dart';
import 'package:localsound_mobile/host/host_server.dart';

/// Interface web factice : les tests n'ont pas d'assets compilés.
Future<Uint8List?> _assets(String path) async => switch (path) {
  'index.html' => Uint8List.fromList(
    utf8.encode('<html><body>salon</body></html>'),
  ),
  'client.js' => Uint8List.fromList(utf8.encode('console.log(1);')),
  _ => null,
};

Future<void> _waitFor(
  bool Function() condition, {
  Duration timeout = const Duration(seconds: 4),
}) async {
  final deadline = DateTime.now().add(timeout);
  while (!condition()) {
    if (DateTime.now().isAfter(deadline)) {
      fail('Délai dépassé en attendant le salon.');
    }
    await Future<void>.delayed(const Duration(milliseconds: 10));
  }
}

Future<({int status, String body})> _get(int port, String path) async {
  final client = HttpClient();
  try {
    final request = await client.get('127.0.0.1', port, path);
    final response = await request.close();
    return (
      status: response.statusCode,
      body: await utf8.decoder.bind(response).join(),
    );
  } finally {
    client.close(force: true);
  }
}

Future<({int status, String body})> _post(
  int port,
  String path,
  Object body,
) async {
  final client = HttpClient();
  try {
    final request = await client.post('127.0.0.1', port, path);
    request.headers.contentType = ContentType.json;
    request.write(jsonEncode(body));
    final response = await request.close();
    return (
      status: response.statusCode,
      body: await utf8.decoder.bind(response).join(),
    );
  } finally {
    client.close(force: true);
  }
}

/// Un bloc PCM stéréo de 480 trames (10 ms) rempli d'une valeur connue.
Uint8List _stereo(int left, int right, {int frames = 480}) {
  final data = ByteData(frames * 4);
  for (var i = 0; i < frames; i++) {
    data.setInt16(i * 4, left, Endian.little);
    data.setInt16(i * 4 + 2, right, Endian.little);
  }
  return data.buffer.asUint8List();
}

void main() {
  late HostServer server;
  var port = 0;

  setUp(() async {
    server = HostServer(loadAsset: _assets, hostName: 'salon-test');
    // Le port 0 laisse le système en choisir un libre.
    port = await server.start(port: 0, attempts: 1);
  });

  tearDown(() async {
    await server.dispose();
  });

  test('sert la page d’écoute et l’état du salon', () async {
    final page = await _get(port, '/');
    expect(page.status, 200);
    expect(page.body, contains('salon'));

    final script = await _get(port, '/client.js');
    expect(script.status, 200);
    expect(script.body, contains('console.log'));

    final status = jsonDecode(
      (await _get(port, '/api/status')).body,
    ) as Map<String, dynamic>;
    expect(status['application'], 'localsound-share');
    expect(status['host'], 'salon-test');
    expect(status['audio'], {
      'sampleRate': 48000,
      'channels': 2,
      'bitDepth': 16,
      'encoding': 's16le',
    });
    expect(status['playing'], isFalse);
    expect((await _get(port, '/autre-chose')).status, 404);
  });

  test(
    'accueille un auditeur, négocie et lui envoie des trames LSP2',
    () async {
      final messages = <dynamic>[];
      final socket = await WebSocket.connect('ws://127.0.0.1:$port/listen');
      addTearDown(socket.close);
      socket.listen(messages.add);

      socket.add(
        jsonEncode({
          'type': 'hello',
          'role': 'client',
          'protocol': 2,
          'codec': 'pcm',
        }),
      );
      await _waitFor(() => messages.length >= 3);
      final transport =
          jsonDecode(messages.first as String) as Map<String, dynamic>;
      expect(transport['type'], 'transport');
      expect(transport['codec'], 'pcm');
      expect(
        (jsonDecode(messages[1] as String) as Map<String, dynamic>)['type'],
        'meta',
      );
      expect(
        (jsonDecode(messages[2] as String) as Map<String, dynamic>)['type'],
        'requests',
      );

      socket.add(jsonEncode({'type': 'listen'}));
      await _waitFor(() => server.listeners == 1);

      server.setPlayback(active: true, playing: true);
      messages.clear();
      server.pushPcm(_stereo(1200, -2400));
      await _waitFor(() => messages.isNotEmpty);

      await _waitFor(() => messages.any((message) => message is List<int>));
      final frame = decodeAudioFrame(
        Uint8List.fromList(
          messages.firstWhere((message) => message is List<int>) as List<int>,
        ),
      );
      expect(frame, isA<PcmFrame>());
      final pcm = frame as PcmFrame;
      expect(pcm.protocol, 2);
      expect(pcm.synchronized, isTrue);
      expect(pcm.left.length, 480);
      expect(pcm.left.first, closeTo(1200 / 32768, 0.0001));
      expect(pcm.right.first, closeTo(-2400 / 32768, 0.0001));
      // L'échéance commune est le délai du salon après la capture.
      expect(
        pcm.playAt! - pcm.capturedAt!,
        closeTo(hostSyncDelayMs.toDouble(), 1),
      );
      expect(server.state['signal'], isTrue);
    },
  );

  test('répond aux pings et applique les commandes des auditeurs', () async {
    final messages = <dynamic>[];
    final socket = await WebSocket.connect('ws://127.0.0.1:$port/listen');
    addTearDown(socket.close);
    socket.listen(messages.add);

    socket.add(jsonEncode({'type': 'hello', 'protocol': 2, 'codec': 'pcm'}));
    await _waitFor(() => messages.length >= 3);
    final pingAt = server.nowMs;
    socket.add(jsonEncode({'type': 'ping', 'clientTime': 42.0}));
    await _waitFor(
      () => messages.any(
        (message) =>
            message is String &&
            (jsonDecode(message) as Map<String, dynamic>)['type'] == 'pong',
      ),
    );
    final pong = jsonDecode(
      messages.lastWhere(
        (message) =>
            (jsonDecode(message as String) as Map<String, dynamic>)['type'] ==
            'pong',
      ) as String,
    ) as Map<String, dynamic>;
    expect(pong['clientTime'], 42.0);
    expect(pong['serverTime'], greaterThanOrEqualTo(pingAt));

    server.setPlayback(active: true, playing: true);
    socket.add(jsonEncode({'type': 'control', 'action': 'pause'}));
    await _waitFor(() => !server.playing);
    expect(server.active, isTrue);

    socket.add(jsonEncode({'type': 'control', 'action': 'stop'}));
    await _waitFor(() => !server.active);
  });

  test('n’accepte que les requêtes de la même origine', () async {
    // `dart:io` n'expose pas l'en-tête Host dans `headers` : l'origine est
    // reconstruite depuis `requestedUri`, sans quoi le web du salon serait
    // refusé alors qu'il vient bien de cette page.
    final socket = await WebSocket.connect(
      'ws://127.0.0.1:$port/listen',
      headers: {'origin': 'http://127.0.0.1:$port'},
    );
    await socket.close();

    await expectLater(
      WebSocket.connect(
        'ws://127.0.0.1:$port/listen',
        headers: {'origin': 'http://ailleurs.test'},
      ),
      throwsA(isA<WebSocketException>()),
    );
  });

  test('cadence les trames sur l’horloge audio, pas sur l’arrivée', () async {
    final messages = <dynamic>[];
    final socket = await WebSocket.connect('ws://127.0.0.1:$port/listen');
    addTearDown(socket.close);
    socket.listen(messages.add);

    socket.add(jsonEncode({'type': 'hello', 'protocol': 2, 'codec': 'pcm'}));
    await _waitFor(() => messages.length >= 3);
    socket.add(jsonEncode({'type': 'listen'}));
    await _waitFor(() => server.listeners == 1);

    // Mode musique : réserve plus large que le micro.
    server.syncDelayMs = 260;
    server.setPlayback(active: true, playing: true);
    messages.clear();

    // Deux blocs poussés d'un coup : seule leur durée audio doit les séparer.
    server.pushPcm(_stereo(1200, -2400));
    server.pushPcm(_stereo(1200, -2400));
    await _waitFor(() => messages.whereType<List<int>>().length >= 2);

    final frames = [
      for (final message in messages.whereType<List<int>>())
        decodeAudioFrame(Uint8List.fromList(message)),
    ].cast<PcmFrame>();
    expect(frames.length, greaterThanOrEqualTo(2));
    // Bloc de 480 trames à 48 kHz : 10 ms, malgré deux envois simultanés.
    expect(
      frames[1].playAt! - frames[0].playAt!,
      closeTo(10, 0.6),
      reason: 'deux trames ne doivent jamais partager la même échéance',
    );
    expect(frames[0].playAt! - frames[0].capturedAt!, closeTo(260, 1));
    expect(server.state['syncDelayMs'], 260);
  });

  test('accepte les demandes de morceaux du web', () async {
    final created = await _post(port, '/api/requests', {
      'title': 'Artiste — Titre',
      'name': 'Nina',
    });
    expect(created.status, 201);
    final body = jsonDecode(created.body) as Map<String, dynamic>;
    expect(body['count'], 1);
    expect((body['item'] as Map<String, dynamic>)['status'], 'pending');

    final same = await _post(port, '/api/requests', {
      'title': 'Artiste — Titre',
    });
    expect(same.status, 409, reason: 'un doublon est refusé');

    final empty = await _post(port, '/api/requests', {'title': '   '});
    expect(empty.status, 400);

    final snapshot = jsonDecode(
      (await _get(port, '/api/requests')).body,
    ) as Map<String, dynamic>;
    expect(snapshot['count'], 1);
    expect((snapshot['items'] as List).single['name'], 'Nina');
    expect(server.state['requestCount'], 1);
  });
}
