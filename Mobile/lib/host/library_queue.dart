/// Morceau du téléphone et file de lecture du mode Bibliothèque.
///
/// Le décodage et la sortie audio sont natifs (`MusicLibrary.kt`) ; cette file
/// ne garde que l'ordre : quel morceau joue, lequel vient ensuite. Elle est
/// volontairement sans dépendance Flutter pour être testable seule.
library;

class Song {
  const Song({
    required this.id,
    required this.title,
    this.artist = '',
    this.album = '',
    this.durationMs = 0,
    required this.uri,
  });

  factory Song.fromMap(Map<Object?, Object?> map) {
    int asInt(Object? value) =>
        value is int ? value : (value is num ? value.toInt() : 0);
    String asText(Object? value) => value is String ? value : '';
    return Song(
      id: asInt(map['id']),
      title: asText(map['title']),
      artist: asText(map['artist']),
      album: asText(map['album']),
      durationMs: asInt(map['durationMs']),
      uri: asText(map['uri']),
    );
  }

  final int id;
  final String title;
  final String artist;
  final String album;
  final int durationMs;

  /// `content://media/external/audio/media/<id>`, lu par le lecteur natif.
  final String uri;

  /// Ligne secondaire des listes : artiste, sinon album.
  String get subtitle => artist.isNotEmpty ? artist : album;

  /// « 3:07 » ; vide si la durée est inconnue.
  String get durationLabel {
    if (durationMs <= 0) return '';
    final total = durationMs ~/ 1000;
    final minutes = total ~/ 60;
    final seconds = (total % 60).toString().padLeft(2, '0');
    return '$minutes:$seconds';
  }
}

class LibraryQueue {
  LibraryQueue([List<Song> songs = const []]) : _songs = List<Song>.of(songs);

  List<Song> _songs;
  int _index = -1;

  List<Song> get songs => List.unmodifiable(_songs);
  int get index => _index;
  bool get isEmpty => _songs.isEmpty;

  Song? get current =>
      _index >= 0 && _index < _songs.length ? _songs[_index] : null;

  bool get hasNext => _index + 1 < _songs.length;
  bool get hasPrevious => _index > 0;

  /// Remplace la bibliothèque en gardant le morceau courant s'il existe encore.
  void replace(List<Song> songs) {
    final currentId = current?.id;
    _songs = List<Song>.of(songs);
    if (currentId == null) {
      _index = -1;
      return;
    }
    final found = _songs.indexWhere((song) => song.id == currentId);
    _index = found;
  }

  /// Sélectionne un morceau de la file ; renvoie `false` s'il n'y figure pas.
  bool select(Song song) {
    final found = _songs.indexWhere(
      (item) => item.id == song.id && item.uri == song.uri,
    );
    if (found < 0) return false;
    _index = found;
    return true;
  }

  /// Morceau à `delta` crans d'ici, sans boucle : `null` en bout de file.
  ///
  /// Sans morceau courant, « suivant » prend le premier, « précédent » n'a
  /// rien à donner.
  Song? step(int delta) {
    if (_songs.isEmpty) return null;
    final target = _index < 0 ? (delta >= 0 ? 0 : -1) : _index + delta;
    if (target < 0 || target >= _songs.length) return null;
    _index = target;
    return _songs[_index];
  }
}
