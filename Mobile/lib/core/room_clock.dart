import 'dart:math' as math;

/// Horloge commune du salon, en millisecondes monotones.
///
/// Port fidèle de `RoomClock` dans `public/sync-player.js` : le serveur répond
/// à un ping avec son horloge, l'écart médian entre départ et retour donne le
/// décalage local↔serveur. Le décalage ne bouge jamais de plus d'après 1 ms
/// par mesure, ce qui absorbe la gigue réseau sans à-coups.
///
/// Une seule règle prime sur toutes les autres : **un paquet trop tard reste
/// manqué**, on ne recule jamais la lecture d'un auditeur.
class RoomClock {
  double? _offset;
  double _bestRtt = double.infinity;
  double _updatedAt = -double.infinity;

  /// Décalage serveur−local, en ms. `null` tant que la synchro n'a pas eu lieu.
  double? get offset => _offset;

  /// Meilleur aller-retour mesuré depuis la dernière remise à zéro.
  double get bestRtt => _bestRtt;

  bool get ready => _offset != null;

  void reset() {
    _offset = null;
    _bestRtt = double.infinity;
    _updatedAt = -double.infinity;
  }

  /// Intègre un `pong`.
  ///
  /// [clientTime] est l'horloge locale émise au moment du ping, [serverTime]
  /// l'horloge serveur à réception, [now] l'horloge locale à réception.
  void update({
    required double clientTime,
    required double serverTime,
    required double now,
  }) {
    final roundTrip = now - clientTime;
    if (!clientTime.isFinite || !serverTime.isFinite || !roundTrip.isFinite) {
      return;
    }
    if (roundTrip < 0 || roundTrip > 500) return;
    // Un canal redevenu bon après une longue pause doit pouvoir être retenu.
    if (now - _updatedAt > 15000) _bestRtt = double.infinity;
    if (roundTrip > _bestRtt) return;

    final next = serverTime - (clientTime + now) / 2;
    final current = _offset;
    _offset = current == null
        ? next
        : current + (next - current).clamp(-1.0, 1.0);
    _bestRtt = roundTrip;
    _updatedAt = now;
  }

  /// Convertit une échéance serveur en temps local monotone (ms), corrigée de
  /// [calibrationMs] réglée par l'auditeur. Renvoie `null` tant que le décalage
  /// est inconnu : le lecteur pousse alors en flux direct.
  double? toLocal(double serverTime, {double calibrationMs = 0}) {
    final offset = _offset;
    if (offset == null || !serverTime.isFinite) return null;
    return serverTime - offset + calibrationMs;
  }

  /// Décide si un paquet horodaté [capturedAt] est déjà trop vieux pour être
  /// joué : l'âge est mesuré sur l'horloge du serveur, avec une fenêtre de
  /// [floorMs] au minimum et de `meilleur RTT + 60 ms` au maximum.
  bool isStale({
    required double capturedAt,
    required double now,
    double floorMs = 120,
  }) {
    final offset = _offset;
    if (offset == null || !capturedAt.isFinite) return false;
    return now + offset - capturedAt > math.max(floorMs, _bestRtt + 60);
  }
}
