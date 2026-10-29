import 'package:flutter_test/flutter_test.dart';
import 'package:localsound_mobile/core/requests.dart';

void main() {
  SongRequest item({
    required String id,
    required String status,
    required int createdAt,
    int? updatedAt,
  }) => SongRequest(
    id: id,
    title: 'Titre $id',
    name: 'Auditeur',
    status: status,
    createdAt: createdAt,
    updatedAt: updatedAt ?? createdAt,
  );

  group('snapshot', () {
    test('lit le format renvoyé par le serveur', () {
      final snapshot = RequestsSnapshot.fromJson({
        'items': [
          {
            'id': 'a',
            'title': 'Morimou Traibe',
            'name': 'Noro',
            'url': 'https://www.youtube.com/watch?v=abc',
            'status': 'pending',
            'createdAt': 100,
            'updatedAt': 100,
          },
        ],
        'count': 1,
        'revision': 3,
      });

      expect(snapshot.items, hasLength(1));
      expect(snapshot.count, 1);
      expect(snapshot.revision, 3);
      expect(snapshot.items.first.name, 'Noro');
      expect(snapshot.items.first.isActive, isTrue);
      expect(snapshot.items.first.url, 'https://www.youtube.com/watch?v=abc');
    });

    test('un items manquant ou mal formé ne casse pas le snapshot', () {
      final snapshot = RequestsSnapshot.fromJson({
        'items': ['pas une map', 42],
        'count': 0,
      });
      expect(snapshot.items, isEmpty);
      expect(snapshot.count, 0);
      expect(snapshot.revision, 0);
      expect(const RequestsSnapshot().items, isEmpty);
    });
  });

  group('classement', () {
    test('les acceptées passent en tête, puis les plus récentes', () {
      final snapshot = RequestsSnapshot(
        items: [
          item(id: 'old-pending', status: 'pending', createdAt: 10),
          item(id: 'new-pending', status: 'pending', createdAt: 90),
          item(id: 'accepted', status: 'accepted', createdAt: 5, updatedAt: 40),
          item(id: 'played', status: 'played', createdAt: 70, updatedAt: 80),
          item(
            id: 'declined',
            status: 'declined',
            createdAt: 60,
            updatedAt: 95,
          ),
        ],
      );

      expect(snapshot.activeItems.map((e) => e.id), [
        'accepted',
        'old-pending',
        'new-pending',
      ]);
      expect(snapshot.historyItems.map((e) => e.id), ['declined', 'played']);
      expect(snapshot.activeItems.every((e) => e.isActive), isTrue);
      expect(snapshot.historyItems.every((e) => !e.isActive), isTrue);
    });

    test('les acceptées restent dans l\'ordre où l\'hôte les a engagées', () {
      final snapshot = RequestsSnapshot(
        items: [
          item(id: 'first', status: 'accepted', createdAt: 1, updatedAt: 10),
          item(id: 'second', status: 'accepted', createdAt: 2, updatedAt: 100),
        ],
      );
      expect(snapshot.activeItems.map((e) => e.id), ['first', 'second']);
    });

    test('libellés d\'état alignés sur l\'interface web', () {
      expect(requestStatusLabels['pending'], 'En attente');
      expect(requestStatusLabels['declined'], 'Non retenu');
    });
  });
}
