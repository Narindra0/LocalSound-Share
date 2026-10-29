/// File de demandes de morceaux du téléphone hôte.
///
/// Portage de `song-requests.js` : mêmes champs, mêmes règles de validation et
/// mêmes limites, sans dépendance Node. La file vit en mémoire du salon : elle
/// disparaît quand l'hôte ferme la pièce, comme un salon qu'on éteint.
library;

import 'dart:math';

import '../core/requests.dart';

class _Failure implements Exception {
  _Failure(this.status, this.message);
  final int status;
  final String message;
}

class HostRequests {
  HostRequests({DateTime Function()? now}) : _now = now ?? DateTime.now;

  final DateTime Function() _now;
  final List<Map<String, dynamic>> _items = [];
  final Map<String, DateTime> _lastSubmission = {};
  int _revision = 0;

  static const _maxActive = 30;
  static const _cooldown = Duration(seconds: 10);

  static bool _active(Map<String, dynamic> item) =>
      item['status'] == 'pending' || item['status'] == 'accepted';

  Map<String, dynamic> get snapshot => {
    'items': _items.map((item) => Map<String, dynamic>.from(item)).toList(),
    'count': _items.where(_active).length,
    'revision': _revision,
  };

  /// Même découpage que `RequestsSnapshot`, pour l'interface du téléphone.
  RequestsSnapshot get parsed => RequestsSnapshot.fromJson(snapshot);

  /// Corps JSON déjà décodé. Lève [_Failure] avec le code HTTP attendu.
  Map<String, dynamic> add(Object? body, {String address = ''}) {
    if (body is! Map<String, dynamic>) {
      throw _Failure(400, 'Indiquez le titre du morceau.');
    }
    final title = _clean(body['title'], 160);
    final name = _clean(body['name'], 32) ?? 'Un auditeur';
    final rawUrl = body['url'] is String ? (body['url'] as String).trim() : '';
    if (title == null) {
      throw _Failure(400, 'Indiquez un titre de 160 caractères maximum.');
    }
    if (body['name'] != null && _clean(body['name'], 32) == null) {
      throw _Failure(400, 'Le prénom doit faire 32 caractères maximum.');
    }
    if (rawUrl.length > 2048) {
      throw _Failure(400, 'Le lien est trop long.');
    }
    if (rawUrl.isNotEmpty) {
      final uri = Uri.tryParse(rawUrl);
      if (uri == null || !(uri.isScheme('http') || uri.isScheme('https'))) {
        throw _Failure(400, 'Le lien doit commencer par http:// ou https://.');
      }
    }
    final url = rawUrl.isEmpty ? null : rawUrl;
    final lower = title.toLowerCase();
    final duplicate = _items.any(
      (item) =>
          _active(item) &&
          ((url != null && item['url'] == url) ||
              (item['title'] as String).toLowerCase() == lower),
    );
    if (duplicate) {
      throw _Failure(409, 'Ce morceau figure déjà dans les demandes.');
    }
    if (_items.where(_active).length >= _maxActive) {
      throw _Failure(
        409,
        'La liste est pleine. Attendez que l’hôte traite quelques demandes.',
      );
    }
    final time = _now();
    final previous = _lastSubmission[address];
    if (previous != null && time.difference(previous) < _cooldown) {
      throw _Failure(
        429,
        'Attendez quelques secondes avant de proposer un autre morceau.',
      );
    }
    _lastSubmission.removeWhere(
      (_, submitted) => time.difference(submitted) >= _cooldown,
    );
    if (_lastSubmission.length >= 256 &&
        !_lastSubmission.containsKey(address)) {
      throw _Failure(
        429,
        'Beaucoup de demandes arrivent. Réessayez dans quelques secondes.',
      );
    }
    _lastSubmission[address] = time;
    final item = <String, dynamic>{
      'id': _identifier(),
      'title': title,
      'name': name,
      'url': url,
      'status': 'pending',
      'createdAt': time.millisecondsSinceEpoch,
      'updatedAt': time.millisecondsSinceEpoch,
    };
    _items.add(item);
    _revision++;
    return Map<String, dynamic>.from(item);
  }

  /// `accepted`, `played` ou `declined`. Lève [_Failure] si la transition est
  /// impossible, exactement comme la version Node.
  Map<String, dynamic> update(String id, String? status) {
    final index = _items.indexWhere((item) => item['id'] == id);
    if (index < 0) throw _Failure(404, 'Cette demande n’est plus disponible.');
    final item = _items[index];
    if (!const ['accepted', 'played', 'declined'].contains(status)) {
      throw _Failure(400, 'Choisissez une action valide.');
    }
    final current = item['status'];
    final allowed =
        (current == 'pending' &&
            const ['accepted', 'declined'].contains(status)) ||
        (current == 'accepted' &&
            const ['played', 'declined'].contains(status));
    if (!allowed) throw _Failure(409, 'Cette demande a déjà été traitée.');
    item['status'] = status;
    item['updatedAt'] = _now().millisecondsSinceEpoch;
    final history = _items.where((value) => !_active(value)).toList()
      ..sort(
        (a, b) => (b['updatedAt'] as int).compareTo(a['updatedAt'] as int),
      );
    final keep = history.take(10).toSet();
    _items.removeWhere((value) => !_active(value) && !keep.contains(value));
    _revision++;
    return Map<String, dynamic>.from(item);
  }

  /// Nettoie comme `cleanText` côté Node : espaces compactés, longueur bornée.
  static String? _clean(Object? value, int max) {
    if (value is! String) return null;
    final text = value.replaceAll(RegExp(r'\s+'), ' ').trim();
    if (text.isEmpty || text.length > max) return null;
    return text;
  }

  static String _identifier() {
    final random = Random.secure();
    final bytes = List<int>.generate(16, (_) => random.nextInt(256));
    final hex = bytes
        .map((byte) => byte.toRadixString(16).padLeft(2, '0'))
        .join();
    return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-'
        '${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
  }
}

/// Rend le statut HTTP et le message d'une [_Failure], `null` sinon.
({int status, String message})? hostRequestFailure(Object error) =>
    error is _Failure ? (status: error.status, message: error.message) : null;
