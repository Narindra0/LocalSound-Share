import 'package:flutter/material.dart';

import 'package:localsound_mobile/core/state.dart';
import 'package:localsound_mobile/room_controller.dart';
import 'package:localsound_mobile/session.dart';
import 'package:localsound_mobile/ui/appearance.dart';
import 'package:localsound_mobile/ui/requests_screen.dart';
import 'package:localsound_mobile/ui/surfaces.dart';

/// Le lecteur : pochette, titre, transport, volume et accès aux demandes.
class PlayerScreen extends StatefulWidget {
  const PlayerScreen({super.key, required this.controller});

  final RoomController controller;

  @override
  State<PlayerScreen> createState() => _PlayerScreenState();
}

class _PlayerScreenState extends State<PlayerScreen>
    with TickerProviderStateMixin {
  /// Le disque sort de la pochette et ne tourne qu'en lecture.
  late final AnimationController _spin = AnimationController(
    vsync: this,
    duration: const Duration(seconds: 14),
  );
  late final AnimationController _pulse = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1100),
  );

  @override
  void initState() {
    super.initState();
    _pulse.repeat(reverse: true);
    widget.controller.addListener(_syncSpin);
    _syncSpin();
  }

  void _syncSpin() {
    if (!mounted) return;
    if (widget.controller.state.playing) {
      if (!_spin.isAnimating) _spin.repeat();
    } else if (_spin.isAnimating) {
      _spin.stop();
    }
  }

  @override
  void dispose() {
    widget.controller.removeListener(_syncSpin);
    _spin.dispose();
    _pulse.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: widget.controller,
      builder: (context, _) {
        final state = widget.controller.state;
        final session = widget.controller.session;
        final style = RoomStyle.of(
          palette: state.appearance['palette'] as String?,
          isDark: MediaQuery.platformBrightnessOf(context) == Brightness.dark,
        );
        final roomTheme = themeFor(state.appearance['theme'] as String?);
        return Scaffold(
          body: RoomBackdrop(
            style: style,
            child: SafeArea(
              child: Column(
                children: [
                  _TopBar(
                    style: style,
                    session: session,
                    roomTheme: roomTheme,
                    state: state,
                    pulse: _pulse,
                  ),
                  Expanded(
                    child: LayoutBuilder(
                      builder: (context, constraints) => SingleChildScrollView(
                        padding: const EdgeInsets.fromLTRB(20, 6, 20, 20),
                        child: ConstrainedBox(
                          constraints: BoxConstraints(
                            minHeight: constraints.maxHeight - 26,
                          ),
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              _SleeveWithDisc(
                                style: style,
                                state: state,
                                roomTheme: roomTheme,
                                session: session,
                                spin: _spin,
                              ),
                              const SizedBox(height: 24),
                              _TrackInfo(style: style, state: state),
                              const SizedBox(height: 16),
                              _Deck(
                                style: style,
                                state: state,
                                controller: widget.controller,
                              ),
                              const SizedBox(height: 14),
                              _StatusRow(
                                style: style,
                                state: state,
                                session: session,
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
                  _FooterBar(style: style, controller: widget.controller),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}

class _TopBar extends StatelessWidget {
  const _TopBar({
    required this.style,
    required this.session,
    required this.roomTheme,
    required this.state,
    required this.pulse,
  });

  final RoomStyle style;
  final Session session;
  final RoomTheme roomTheme;
  final HostState state;
  final AnimationController pulse;

  @override
  Widget build(BuildContext context) {
    final (label, color) = switch (session.connection) {
      LinkState.connected => ('en direct', const Color(0xFF3E8E5A)),
      LinkState.connecting => ('connexion…', const Color(0xFFB4832B)),
      LinkState.reconnecting => ('reconnexion…', const Color(0xFFB4832B)),
      LinkState.disconnected => ('hors ligne', const Color(0xFF9A4B3D)),
    };
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 14, 20, 10),
      child: Row(
        children: [
          Container(
            width: 34,
            height: 34,
            decoration: BoxDecoration(
              color: style.accent.withValues(alpha: 0.1),
              shape: BoxShape.circle,
            ),
            child: Icon(roomTheme.icon, size: 18, color: style.accent),
          ),
          const SizedBox(width: 11),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Salon ${roomTheme.label}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    letterSpacing: -0.2,
                    color: style.text,
                  ),
                ),
                const SizedBox(height: 1),
                Text(
                  state.host.isEmpty
                      ? session.serverUrl
                      : '${state.host} · ${state.clients} auditeur(s)',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(fontSize: 11.5, color: style.muted),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          RoomPill(
            label: label,
            color: color,
            pulse: session.connection == LinkState.connected,
            animation: pulse.drive(Tween(begin: 0.3, end: 1.0)),
          ),
        ],
      ),
    );
  }
}

/// Pochette posée sur un vinyle qui dépasse : l'objet du salon, pas une vignette.
class _SleeveWithDisc extends StatelessWidget {
  const _SleeveWithDisc({
    required this.style,
    required this.state,
    required this.roomTheme,
    required this.session,
    required this.spin,
  });

  final RoomStyle style;
  final HostState state;
  final RoomTheme roomTheme;
  final Session session;
  final Animation<double> spin;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final sleeve = (constraints.maxWidth * 0.68).clamp(150.0, 238.0);
        final disc = sleeve * 0.86;
        return SizedBox(
          height: sleeve,
          child: Stack(
            clipBehavior: Clip.none,
            children: [
              Positioned(
                right: 0,
                top: (sleeve - disc) / 2,
                child: VinylDisc(
                  accent: style.accent,
                  label: 'LOCAL\nSOUND',
                  size: disc,
                  rotation: spin,
                ),
              ),
              Positioned(
                left: 0,
                top: 0,
                child: _Sleeve(
                  style: style,
                  state: state,
                  roomTheme: roomTheme,
                  session: session,
                  size: sleeve,
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _Sleeve extends StatelessWidget {
  const _Sleeve({
    required this.style,
    required this.state,
    required this.roomTheme,
    required this.session,
    required this.size,
  });

  final RoomStyle style;
  final HostState state;
  final RoomTheme roomTheme;
  final Session session;
  final double size;

  @override
  Widget build(BuildContext context) {
    final artwork = session.resolveUri(state.nowPlaying?.artwork);
    const radius = BorderRadius.all(Radius.circular(18));
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        borderRadius: radius,
        color: style.accentDark,
        boxShadow: [
          BoxShadow(
            color: style.accentDark.withValues(
              alpha: style.isDark ? 0.5 : 0.24,
            ),
            blurRadius: 22,
            spreadRadius: -4,
            offset: const Offset(0, 12),
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: radius,
        child: artwork == null
            ? _PrintedSleeve(style: style, roomTheme: roomTheme, size: size)
            : Image.network(
                artwork.toString(),
                fit: BoxFit.cover,
                errorBuilder: (_, _, _) => _PrintedSleeve(
                  style: style,
                  roomTheme: roomTheme,
                  size: size,
                ),
              ),
      ),
    );
  }
}

/// Pochette imprimée quand le salon ne fournit pas d'image.
class _PrintedSleeve extends StatelessWidget {
  const _PrintedSleeve({
    required this.style,
    required this.roomTheme,
    required this.size,
  });

  final RoomStyle style;
  final RoomTheme roomTheme;
  final double size;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [style.accent, style.accentDark],
        ),
      ),
      child: Stack(
        children: [
          Positioned.fill(
            child: Padding(
              padding: EdgeInsets.all(size * 0.1),
              child: DecoratedBox(
                decoration: BoxDecoration(
                  border: Border.all(
                    color: Colors.white.withValues(alpha: 0.22),
                  ),
                  borderRadius: BorderRadius.circular(6),
                ),
              ),
            ),
          ),
          Center(
            child: Icon(
              roomTheme.icon,
              size: size * 0.3,
              color: Colors.white.withValues(alpha: 0.9),
            ),
          ),
          Positioned(
            left: size * 0.12,
            right: size * 0.12,
            bottom: size * 0.12,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'LOCAL SOUND',
                  style: TextStyle(
                    fontSize: size * 0.042,
                    letterSpacing: size * 0.008,
                    fontWeight: FontWeight.w700,
                    color: Colors.white.withValues(alpha: 0.8),
                  ),
                ),
                SizedBox(height: size * 0.012),
                Text(
                  roomTheme.label.toUpperCase(),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: size * 0.034,
                    letterSpacing: size * 0.006,
                    color: Colors.white.withValues(alpha: 0.6),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _TrackInfo extends StatelessWidget {
  const _TrackInfo({required this.style, required this.state});

  final RoomStyle style;
  final HostState state;

  @override
  Widget build(BuildContext context) {
    final track = state.nowPlaying;
    final title = track?.title.isNotEmpty == true
        ? track!.title
        : state.trackName ?? 'Rien en cours';
    final artist = [
      if (track?.artist.isNotEmpty == true) track!.artist,
      if (state.sourceKind == 'file') 'fichier local',
      if (state.sourceKind == 'tab') 'onglet partagé',
      if (state.sourceKind == 'system') 'son du système',
    ].join(' · ');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        RoomOverline(track == null ? 'le salon' : 'à l’écoute', style: style),
        const SizedBox(height: 8),
        Text(
          title,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            fontSize: 25,
            height: 1.14,
            fontWeight: FontWeight.w700,
            letterSpacing: -0.6,
            color: style.text,
          ),
        ),
        const SizedBox(height: 5),
        Text(
          artist.isEmpty ? 'En attente du salon' : artist,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(fontSize: 13, color: style.muted),
        ),
      ],
    );
  }
}

/// La platine : transport au centre, volume sous un filet pointillé.
class _Deck extends StatelessWidget {
  const _Deck({
    required this.style,
    required this.state,
    required this.controller,
  });

  final RoomStyle style;
  final HostState state;
  final RoomController controller;

  @override
  Widget build(BuildContext context) {
    final playing = state.playing;
    final enabled = state.canPlay || playing;
    final muted = controller.player.volume == 0;

    Widget round({
      required IconData icon,
      required String tooltip,
      required VoidCallback onPressed,
      bool primary = false,
    }) {
      final size = primary ? 64.0 : 46.0;
      return Tooltip(
        message: tooltip,
        child: Material(
          color: primary
              ? (enabled ? style.accent : style.accent.withValues(alpha: 0.4))
              : Color.alphaBlend(
                  style.accent.withValues(alpha: 0.05),
                  style.surface,
                ),
          shape: primary
              ? const CircleBorder()
              : CircleBorder(
                  side: BorderSide(color: style.accent.withValues(alpha: 0.24)),
                ),
          child: InkWell(
            customBorder: const CircleBorder(),
            onTap: primary ? (enabled ? onPressed : null) : onPressed,
            child: SizedBox(
              width: size,
              height: size,
              child: Icon(
                icon,
                size: primary ? 32 : 20,
                color: primary ? Colors.white : style.accentText,
              ),
            ),
          ),
        ),
      );
    }

    return RoomCard(
      style: style,
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 10),
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              round(
                icon: Icons.stop_rounded,
                tooltip: 'Arrêter la source sur le PC hôte',
                onPressed: () => controller.control('stop'),
              ),
              const SizedBox(width: 22),
              round(
                icon: playing ? Icons.pause_rounded : Icons.play_arrow_rounded,
                tooltip: playing
                    ? 'Pause sur le PC hôte'
                    : 'Lecture sur le PC hôte',
                onPressed: () => controller.control(playing ? 'pause' : 'play'),
                primary: true,
              ),
              const SizedBox(width: 22),
              round(
                icon: muted
                    ? Icons.volume_off_rounded
                    : Icons.volume_up_rounded,
                tooltip: muted
                    ? 'Rétablir le son'
                    : 'Couper le son sur cet appareil',
                onPressed: () => controller.setVolume(muted ? 0.9 : 0),
              ),
            ],
          ),
          const SizedBox(height: 12),
          DashedRule(color: style.accent.withValues(alpha: 0.22)),
          Row(
            children: [
              Icon(Icons.volume_down_rounded, size: 18, color: style.muted),
              Expanded(
                child: SliderTheme(
                  data: SliderTheme.of(context).copyWith(
                    trackHeight: 3,
                    thumbShape: const RoundSliderThumbShape(
                      enabledThumbRadius: 7,
                    ),
                    overlayShape: const RoundSliderOverlayShape(
                      overlayRadius: 16,
                    ),
                  ),
                  child: Slider(
                    value: controller.player.volume,
                    onChanged: controller.setVolume,
                  ),
                ),
              ),
              SizedBox(
                width: 38,
                child: Text(
                  '${(controller.player.volume * 100).round()}%',
                  textAlign: TextAlign.end,
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: style.muted,
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _StatusRow extends StatelessWidget {
  const _StatusRow({
    required this.style,
    required this.state,
    required this.session,
  });

  final RoomStyle style;
  final HostState state;
  final Session session;

  @override
  Widget build(BuildContext context) {
    final waiting = !state.playing;
    final silent = state.playing && !state.signal;
    final text = waiting
        ? 'Le PC hôte est à l’arrêt.'
        : silent
        ? 'En attente de son…'
        : 'Flux ${session.codec.toUpperCase()} · '
              '${state.kbps > 0 ? '${state.kbps} kb/s' : 'débit inconnu'}';
    return Row(
      children: [
        if (silent || waiting)
          Icon(
            waiting ? Icons.pause_circle_outline : Icons.hourglass_empty,
            size: 17,
            color: style.muted,
          )
        else
          LevelBars(
            level: 1,
            color: style.accent,
            bars: 5,
            height: 16,
            width: 3,
          ),
        const SizedBox(width: 9),
        Expanded(
          child: Text(text, style: TextStyle(fontSize: 12, color: style.muted)),
        ),
      ],
    );
  }
}

class _FooterBar extends StatelessWidget {
  const _FooterBar({required this.style, required this.controller});

  final RoomStyle style;
  final RoomController controller;

  @override
  Widget build(BuildContext context) {
    final count = controller.requests.count;
    return Container(
      padding: const EdgeInsets.fromLTRB(20, 10, 20, 12),
      decoration: BoxDecoration(
        color: style.background.withValues(alpha: 0.9),
        border: Border(
          top: BorderSide(color: style.accent.withValues(alpha: 0.14)),
        ),
      ),
      child: Row(
        children: [
          Expanded(
            child: OutlinedButton.icon(
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => RequestsScreen(controller: controller),
                ),
              ),
              icon: const Icon(Icons.queue_music, size: 20),
              label: Text(count == 0 ? 'Demandes' : 'Demandes ($count)'),
            ),
          ),
          const SizedBox(width: 10),
          Tooltip(
            message: 'Réglages et synchronisation',
            child: OutlinedButton(
              onPressed: () => showModalBottomSheet<void>(
                context: context,
                isScrollControlled: true,
                backgroundColor: style.background,
                shape: const RoundedRectangleBorder(
                  borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
                ),
                builder: (_) => _SettingsSheet(controller: controller),
              ),
              style: OutlinedButton.styleFrom(
                minimumSize: const Size(54, 52),
                padding: EdgeInsets.zero,
              ),
              child: const Icon(Icons.tune, size: 20),
            ),
          ),
        ],
      ),
    );
  }
}

class _SettingsSheet extends StatelessWidget {
  const _SettingsSheet({required this.controller});

  final RoomController controller;

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: controller,
      builder: (context, _) {
        final session = controller.session;
        final player = controller.player;
        final style = RoomStyle.of(
          palette: controller.state.appearance['palette'] as String?,
          isDark: MediaQuery.platformBrightnessOf(context) == Brightness.dark,
        );
        return SingleChildScrollView(
          padding: EdgeInsets.fromLTRB(
            20,
            10,
            20,
            20 + MediaQuery.viewInsetsOf(context).bottom,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Center(
                child: Container(
                  width: 38,
                  height: 4,
                  decoration: BoxDecoration(
                    color: style.accent.withValues(alpha: 0.25),
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              const SizedBox(height: 18),
              RoomOverline('synchronisation', style: style),
              const SizedBox(height: 8),
              Text(
                'Régler le direct',
                style: TextStyle(
                  fontSize: 21,
                  height: 1.15,
                  fontWeight: FontWeight.w700,
                  letterSpacing: -0.3,
                  color: style.text,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                'Ajustez si votre appareil est en avance ou en retard sur le salon '
                '(${session.calibrationMs.round()} ms).',
                style: TextStyle(
                  fontSize: 12.5,
                  height: 1.4,
                  color: style.muted,
                ),
              ),
              const SizedBox(height: 6),
              Slider(
                value: session.calibrationMs,
                min: -80,
                max: 80,
                divisions: 32,
                label: '${session.calibrationMs.round()} ms',
                onChanged: controller.setCalibration,
              ),
              const SizedBox(height: 6),
              DashedRule(color: style.accent.withValues(alpha: 0.25)),
              const SizedBox(height: 6),
              _StatRow(
                style: style,
                label: 'Aller-retour',
                value: session.latencyMs == null
                    ? '—'
                    : '${session.latencyMs!.round()} ms',
              ),
              _StatRow(
                style: style,
                label: 'Horloge du salon',
                value: session.clockReady ? 'synchronisée' : 'en attente',
              ),
              _StatRow(style: style, label: 'Codec', value: session.codec),
              _StatRow(
                style: style,
                label: 'Blocs reçus',
                value: '${player.blocks} · ${session.droppedFrames} en retard',
              ),
              _StatRow(style: style, label: 'Salon', value: session.serverUrl),
              if (player.error != null) ...[
                const SizedBox(height: 12),
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: style.accent.withValues(alpha: 0.08),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(
                      color: style.accent.withValues(alpha: 0.28),
                    ),
                  ),
                  child: Text(
                    player.error!,
                    style: TextStyle(
                      color: style.accentText,
                      fontSize: 12,
                      height: 1.35,
                    ),
                  ),
                ),
              ],
              const SizedBox(height: 20),
              OutlinedButton.icon(
                onPressed: () async {
                  Navigator.of(context).pop();
                  await controller.disconnect();
                },
                style: OutlinedButton.styleFrom(
                  foregroundColor: style.muted,
                  side: BorderSide(color: style.accent.withValues(alpha: 0.22)),
                ),
                icon: const Icon(Icons.logout, size: 18),
                label: const Text('Quitter le salon'),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _StatRow extends StatelessWidget {
  const _StatRow({
    required this.style,
    required this.label,
    required this.value,
  });

  final RoomStyle style;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: TextStyle(fontSize: 13, color: style.muted),
            ),
          ),
          Flexible(
            child: Text(
              value,
              textAlign: TextAlign.end,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: style.text,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
