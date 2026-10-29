import 'package:flutter_test/flutter_test.dart';
import 'package:localsound_mobile/core/room_clock.dart';

void main() {
  group('mesure du décalage', () {
    test('un aller-retour de 40 ms situe l\'horloge serveur au milieu', () {
      final clock = RoomClock();
      expect(clock.ready, isFalse);

      // Ping émis à t=0 local, réponse serveur à t=1000 serveur, reçue à t=40 local.
      clock.update(clientTime: 0, serverTime: 1000, now: 40);

      expect(clock.ready, isTrue);
      expect(clock.bestRtt, 40);
      expect(clock.offset, 980);
      // L'échéance serveur 1000 tombe à 20 ms à l'instant local (le milieu du RTT).
      expect(clock.toLocal(1000), 20);
    });

    test('la calibration de l\'auditeur décale l\'échéance', () {
      final clock = RoomClock()
        ..update(clientTime: 0, serverTime: 1000, now: 40);
      expect(clock.toLocal(1000, calibrationMs: 30), 50);
      expect(clock.toLocal(1000, calibrationMs: -80), -60);
    });

    test('sans mesure, aucune échéance n\'est convertie', () {
      expect(RoomClock().toLocal(1000), isNull);
    });

    test('un RTT supérieur à 500 ms est rejeté', () {
      final clock = RoomClock();
      clock.update(clientTime: 0, serverTime: 1000, now: 600);
      expect(clock.ready, isFalse);
    });

    test('un aller-retour négatif est impossible', () {
      final clock = RoomClock();
      clock.update(clientTime: 100, serverTime: 1000, now: 50);
      expect(clock.ready, isFalse);
    });

    test('un horodatage invalide est ignoré', () {
      final clock = RoomClock();
      clock.update(clientTime: 0, serverTime: double.nan, now: 40);
      expect(clock.ready, isFalse);
      clock.update(clientTime: double.infinity, serverTime: 1000, now: 40);
      expect(clock.ready, isFalse);
    });
  });

  group('stabilité du décalage', () {
    test(
      'un saut d\'horloge n\'est rattrapé qu\'à raison de 1 ms par mesure',
      () {
        final clock = RoomClock()
          ..update(clientTime: 0, serverTime: 1000, now: 40);
        expect(clock.offset, 980);

        // Une mesure qui annoncerait 520 ms de plus ne doit pas tout déplacer.
        clock.update(clientTime: 1000, serverTime: 3000, now: 1040);
        expect(clock.offset, 981);
        clock.update(clientTime: 2000, serverTime: 5000, now: 2040);
        expect(clock.offset, 982);
      },
    );

    test('la meilleure mesure RTT l\'emporte, les autres sont ignorées', () {
      final clock = RoomClock()
        ..update(clientTime: 0, serverTime: 1000, now: 40);
      final offset = clock.offset;

      // Plus lent : ne doit pas modifier le décalage.
      clock.update(clientTime: 1000, serverTime: 5000, now: 1200);
      expect(clock.offset, offset);
      expect(clock.bestRtt, 40);

      // Plus rapide : doit être retenu.
      clock.update(clientTime: 2000, serverTime: 6000, now: 2012);
      expect(clock.bestRtt, 12);
      expect(clock.offset, isNot(offset));
    });

    test('après 15 s sans mesure, un canal meilleur peut être retenu', () {
      final clock = RoomClock()
        ..update(clientTime: 0, serverTime: 1000, now: 40);
      expect(clock.bestRtt, 40);

      clock.update(clientTime: 20000, serverTime: 60000, now: 20120);
      expect(clock.bestRtt, 120);
    });

    test('reset efface la mesure', () {
      final clock = RoomClock()
        ..update(clientTime: 0, serverTime: 1000, now: 40);
      clock.reset();
      expect(clock.ready, isFalse);
      expect(clock.bestRtt, double.infinity);
      expect(clock.toLocal(1000), isNull);
    });
  });

  group('paquets trop tard', () {
    /// Horloge serveur alignée sur l'horloge locale (décalage nul) pour que
    /// `capturedAt` et `now` soient directement comparables.
    RoomClock synced({double rtt = 40}) {
      final clock = RoomClock()
        ..update(clientTime: 1000, serverTime: 1000 + rtt / 2, now: 1000 + rtt);
      return clock;
    }

    test('sans synchro, aucun paquet n\'est déclaré périmé', () {
      expect(RoomClock().isStale(capturedAt: 0, now: 5000), isFalse);
    });

    test('un paquet récent reste jouable', () {
      final clock = synced();
      expect(clock.isStale(capturedAt: 99950, now: 100000), isFalse);
    });

    test('la fenêtre minimale est de 120 ms', () {
      final clock = synced(rtt: 10);
      expect(clock.isStale(capturedAt: 99900, now: 100000), isFalse); // 100 ms
      expect(clock.isStale(capturedAt: 99870, now: 100000), isTrue); // 130 ms
    });

    test('la fenêtre s\'élargit avec le RTT mesuré (RTT + 60 ms)', () {
      final clock = synced(rtt: 300);
      expect(clock.bestRtt, 300);
      expect(clock.isStale(capturedAt: 99650, now: 100000), isFalse); // 350 ms
      expect(clock.isStale(capturedAt: 99639, now: 100000), isTrue); // 361 ms
    });

    test('un horodatage invalide n\'est jamais périmé', () {
      final clock = synced();
      expect(clock.isStale(capturedAt: double.nan, now: 100000), isFalse);
    });
  });
}
