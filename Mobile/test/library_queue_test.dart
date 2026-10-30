import 'package:flutter_test/flutter_test.dart';

import 'package:localsound_mobile/host/library_queue.dart';

Song song(int id, {String? artist, int durationMs = 0}) => Song(
  id: id,
  title: 'Morceau $id',
  artist: artist ?? 'Artiste $id',
  album: 'Album',
  durationMs: durationMs,
  uri: 'content://media/external/audio/media/$id',
);

void main() {
  group('recherche', () {
    final songs = [
      Song(
        id: 1,
        title: 'Café du coin',
        artist: 'Éléonore',
        album: 'Été',
        uri: 'content://media/external/audio/media/1',
      ),
      Song(
        id: 2,
        title: 'Nuit blanche',
        artist: 'Les Œillets',
        album: 'Hiver',
        uri: 'content://media/external/audio/media/2',
      ),
    ];

    test('trouve par titre sans accent ni casse', () {
      expect(filterSongs(songs, 'cafe').map((song) => song.id), [1]);
      expect(filterSongs(songs, 'CAFÉ').map((song) => song.id), [1]);
    });

    test('trouve par artiste et par album', () {
      expect(filterSongs(songs, 'eleonore').map((song) => song.id), [1]);
      expect(filterSongs(songs, 'oeillets').map((song) => song.id), [2]);
      expect(filterSongs(songs, 'hiver').map((song) => song.id), [2]);
    });

    test('une requête vide ou blanche rend toute la bibliothèque', () {
      expect(filterSongs(songs, '').length, 2);
      expect(filterSongs(songs, '   ').length, 2);
    });

    test('aucun morceau ne correspond', () {
      expect(filterSongs(songs, 'jazz'), isEmpty);
    });
  });

  group('file de lecture', () {
    test('vide : aucun morceau courant et aucun suivant', () {
      final queue = LibraryQueue();
      expect(queue.isEmpty, isTrue);
      expect(queue.current, isNull);
      expect(queue.step(1), isNull);
      expect(queue.hasNext, isFalse);
    });

    test('step avance puis recule sans sortir de la file', () {
      final queue = LibraryQueue([song(1), song(2), song(3)]);
      expect(queue.current, isNull);
      expect(queue.step(1)?.id, 1);
      expect(queue.step(1)?.id, 2);
      expect(queue.step(1)?.id, 3);
      expect(queue.hasNext, isFalse);
      expect(queue.step(1), isNull);
      expect(queue.current?.id, 3);
      expect(queue.step(-1)?.id, 2);
      expect(queue.hasPrevious, isTrue);
      expect(queue.step(-2), isNull);
      expect(queue.current?.id, 2);
    });

    test('select retrouve le morceau par identifiant', () {
      final queue = LibraryQueue([song(1), song(2)]);
      expect(queue.select(song(2)), isTrue);
      expect(queue.current?.id, 2);
      expect(queue.hasNext, isFalse);
      expect(queue.select(song(9)), isFalse);
      expect(queue.current?.id, 2);
    });

    test('replace conserve le morceau courant s’il existe encore', () {
      final queue = LibraryQueue([song(1), song(2), song(3)]);
      queue.select(song(2));
      queue.replace([song(3), song(2)]);
      expect(queue.current?.id, 2);
      queue.replace([song(1)]);
      expect(queue.current, isNull);
    });
  });

  group('morceau', () {
    test('sous-titre : artiste, sinon album', () {
      expect(song(1, artist: 'A').subtitle, 'A');
      expect(const Song(id: 1, title: 'T', album: 'B', uri: 'u').subtitle, 'B');
    });

    test('durée lisible en minutes:secondes', () {
      expect(song(1, durationMs: 187000).durationLabel, '3:07');
      expect(song(1, durationMs: 65000).durationLabel, '1:05');
      expect(song(1).durationLabel, '');
    });

    test('lecture d’un morceau venu du natif', () {
      final parsed = Song.fromMap({
        'id': 42,
        'title': 'Nuit blanche',
        'artist': 'Alma',
        'album': 'Sillages',
        'durationMs': 241000,
        'uri': 'content://media/external/audio/media/42',
      });
      expect(parsed.id, 42);
      expect(parsed.title, 'Nuit blanche');
      expect(parsed.uri, endsWith('/42'));
      expect(parsed.durationLabel, '4:01');
    });
  });
}
