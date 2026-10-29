/// File de demandes de morceaux, telle que la diffuse `GET /api/requests` et
/// le message WebSocket `requests`.
///
/// Les règles de tri et de conservation sont le port de `public/song-requests.js`
/// : les demandes actives d'abord (les acceptées en tête, par ordre de mise à
/// jour), puis l'historique des dix dernières décisions par date de mise à jour.
library;

int _asInt(Object? value, int fallback) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  return fallback;
}

String? _asString(Object? value) => value is String ? value : null;

class SongRequest {
  const SongRequest({
    required this.id,
    required this.title,
    required this.name,
    this.url,
    required this.status,
    required this.createdAt,
    required this.updatedAt,
  });

  factory SongRequest.fromJson(Map<String, dynamic> json) => SongRequest(
    id: _asString(json['id']) ?? '',
    title: _asString(json['title']) ?? '',
    name: _asString(json['name']) ?? 'Un auditeur',
    url: _asString(json['url']),
    status: _asString(json['status']) ?? 'pending',
    createdAt: _asInt(json['createdAt'], 0),
    updatedAt: _asInt(json['updatedAt'], 0),
  );

  final String id;
  final String title;
  final String name;
  final String? url;

  /// `pending`, `accepted`, `played` ou `declined`.
  final String status;
  final int createdAt;
  final int updatedAt;

  bool get isActive => status == 'pending' || status == 'accepted';
}

class RequestsSnapshot {
  const RequestsSnapshot({
    this.items = const [],
    this.count = 0,
    this.revision = 0,
  });

  factory RequestsSnapshot.fromJson(Map<String, dynamic> json) {
    final raw = json['items'];
    final items = raw is List
        ? raw
              .whereType<Map<String, dynamic>>()
              .map(SongRequest.fromJson)
              .toList(growable: false)
        : const <SongRequest>[];
    return RequestsSnapshot(
      items: items,
      count: _asInt(json['count'], items.where((item) => item.isActive).length),
      revision: _asInt(json['revision'], 0),
    );
  }

  final List<SongRequest> items;

  /// Nombre de demandes encore en attente ou acceptées, tel que calculé par le serveur.
  final int count;

  /// Incrémenté à chaque changement ; un snapshot plus vieux est ignoré.
  final int revision;

  /// À afficher en tête de liste : les acceptées restent en tête, dans l'ordre
  /// où l'hôte les a engagées, puis les propositions dans l'ordre d'arrivée.
  List<SongRequest> get activeItems {
    final active = items.where((item) => item.isActive).toList();
    active.sort((a, b) {
      final accepted =
          (b.status == 'accepted' ? 1 : 0) - (a.status == 'accepted' ? 1 : 0);
      if (accepted != 0) return accepted;
      if (a.status == 'accepted') return a.updatedAt.compareTo(b.updatedAt);
      return a.createdAt.compareTo(b.createdAt);
    });
    return active;
  }

  List<SongRequest> get historyItems {
    final history = items.where((item) => !item.isActive).toList();
    history.sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
    return history;
  }
}

/// Traduit un statut en libellé d'interface, comme `public/song-requests.js`.
const Map<String, String> requestStatusLabels = {
  'pending': 'En attente',
  'accepted': 'À écouter',
  'played': 'Joué',
  'declined': 'Non retenu',
};
