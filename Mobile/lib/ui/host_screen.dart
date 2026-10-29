import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'package:localsound_mobile/host/host_controller.dart';
import 'package:localsound_mobile/ui/appearance.dart';
import 'package:localsound_mobile/ui/surfaces.dart';

/// Console de l'hôte mobile : le vinyle en rotation, l'adresse à partager,
/// le micro et les auditeurs. Rien à saisir : tout se lit d'un coup d'œil.
class HostScreen extends StatefulWidget {
  const HostScreen({
    super.key,
    required this.controller,
    required this.onClose,
  });

  final HostController controller;
  final VoidCallback onClose;

  @override
  State<HostScreen> createState() => _HostScreenState();
}

class _HostScreenState extends State<HostScreen> with TickerProviderStateMixin {
  late final AnimationController _spin = AnimationController(
    vsync: this,
    duration: const Duration(seconds: 9),
  );
  late final AnimationController _pulse = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1100),
  );

  @override
  void initState() {
    super.initState();
    widget.controller.start();
    _pulse.repeat(reverse: true);
    _syncSpin();
    widget.controller.addListener(_syncSpin);
  }

  /// Le disque ne tourne que lorsque le micro diffuse vraiment.
  void _syncSpin() {
    if (!mounted) return;
    if (widget.controller.live) {
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

  Future<void> _copy() async {
    final url = widget.controller.url;
    if (url == null) return;
    await Clipboard.setData(ClipboardData(text: '$url/listen'));
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Adresse copiée. Collez-la dans le navigateur du PC.'),
      ),
    );
  }

  Future<void> _close() async {
    await widget.controller.stop();
    widget.onClose();
  }

  Future<void> _openLibrary() async {
    final style = RoomStyle.of(
      palette: 'terracotta',
      isDark: MediaQuery.platformBrightnessOf(context) == Brightness.dark,
    );
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: style.background,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (_) => _LibrarySheet(controller: widget.controller),
    );
  }

  @override
  Widget build(BuildContext context) {
    final style = RoomStyle.of(
      palette: 'terracotta',
      isDark: MediaQuery.platformBrightnessOf(context) == Brightness.dark,
    );
    return AnimatedBuilder(
      animation: Listenable.merge([widget.controller, _pulse]),
      builder: (context, _) {
        final controller = widget.controller;
        return Scaffold(
          body: RoomBackdrop(
            style: style,
            child: SafeArea(
              child: Column(
                children: [
                  _TopBar(
                    style: style,
                    controller: controller,
                    pulse: _pulse,
                    onClose: _close,
                  ),
                  Expanded(
                    child: SingleChildScrollView(
                      padding: const EdgeInsets.fromLTRB(20, 4, 20, 28),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          _Hero(
                            style: style,
                            controller: controller,
                            spin: _spin,
                          ),
                          const SizedBox(height: 16),
                          _Ticket(
                            style: style,
                            controller: controller,
                            onCopy: _copy,
                          ),
                          const SizedBox(height: 16),
                          Row(
                            children: [
                              Expanded(
                                child: _Stat(
                                  style: style,
                                  label: 'Auditeurs',
                                  value: '${controller.listeners}',
                                  hint: controller.listeners == 0
                                      ? 'personne encore'
                                      : 'à l’écoute',
                                  icon: Icons.people_outline,
                                ),
                              ),
                              const SizedBox(width: 12),
                              Expanded(
                                child: _Stat(
                                  style: style,
                                  label: 'Micro',
                                  value: '${controller.kbps}',
                                  hint: 'kbit/s',
                                  icon: Icons.graphic_eq,
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 20),
                          _Actions(
                            style: style,
                            controller: controller,
                            onClose: _close,
                            onLibrary: _openLibrary,
                          ),
                          const SizedBox(height: 18),
                          _Notes(style: style),
                        ],
                      ),
                    ),
                  ),
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
    required this.controller,
    required this.pulse,
    required this.onClose,
  });

  final RoomStyle style;
  final HostController controller;
  final AnimationController pulse;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    final (String label, Color color) = switch (controller.phase) {
      HostPhase.idle => ('salon fermé', style.muted),
      HostPhase.starting => ('ouverture…', const Color(0xFFB4832B)),
      HostPhase.ready => ('prêt', const Color(0xFFB4832B)),
      HostPhase.live => ('en direct', const Color(0xFF3E8E5A)),
      HostPhase.paused => ('en pause', style.accentText),
      HostPhase.error => ('erreur', const Color(0xFF9A4B3D)),
    };
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 14, 10, 10),
      child: Row(
        children: [
          Text(
            'LocalSound',
            style: TextStyle(
              fontSize: 17,
              fontWeight: FontWeight.w700,
              color: style.text,
            ),
          ),
          const SizedBox(width: 4),
          Text(
            'Share.',
            style: TextStyle(
              fontSize: 17,
              fontWeight: FontWeight.w700,
              color: style.accentText,
            ),
          ),
          const SizedBox(width: 10),
          RoomPill(
            label: label,
            color: color,
            pulse: controller.phase == HostPhase.live,
            animation: pulse.drive(Tween(begin: 0.25, end: 1.0)),
          ),
          const Spacer(),
          IconButton(
            tooltip: 'Fermer le salon',
            onPressed: onClose,
            icon: Icon(Icons.close, color: style.muted),
          ),
        ],
      ),
    );
  }
}

class _Hero extends StatelessWidget {
  const _Hero({
    required this.style,
    required this.controller,
    required this.spin,
  });

  final RoomStyle style;
  final HostController controller;
  final AnimationController spin;

  @override
  Widget build(BuildContext context) {
    final song = controller.currentSong;
    final String title = controller.libraryMode
        ? (song?.title ?? 'Choisis un morceau.')
        : switch (controller.phase) {
            HostPhase.idle => 'Le salon est fermé.',
            HostPhase.starting => 'On ouvre la salle…',
            HostPhase.ready => 'On ouvre la salle…',
            HostPhase.live => 'Le direct\ndu téléphone.',
            HostPhase.paused => 'Le micro\nse repose.',
            HostPhase.error => 'Le salon\nn’a pas pu ouvrir.',
          };
    final String caption = controller.libraryMode
        ? (controller.phase == HostPhase.error
              ? (controller.error ?? 'Le salon n’a pas pu ouvrir.')
              : song == null
              ? 'Ta musique du téléphone part vers les auditeurs. Choisis un morceau.'
              : controller.phase == HostPhase.paused
              ? '« ${song.title} » est en pause, les auditeurs gardent la place.'
              : '${song.subtitle.isEmpty ? song.title : song.subtitle} · lecture sur '
                    'le téléphone et diffusion en direct.')
        : switch (controller.phase) {
            HostPhase.idle =>
              'Appuie sur « Rouvrir » pour relancer la diffusion.',
            HostPhase.starting => 'Ports, page web et autorisation du micro.',
            HostPhase.ready => 'Le salon est prêt.',
            HostPhase.live =>
              controller.listeners == 0
                  ? 'Personne à l’écoute. Partage l’adresse du salon.'
                  : 'Le son de la pièce arrive chez tes auditeurs.',
            HostPhase.paused =>
              'Les auditeurs gardent la place, le micro est coupé.',
            HostPhase.error => controller.error ?? 'Réessaie dans un instant.',
          };
    return RoomCard(
      style: style,
      accent: true,
      padding: const EdgeInsets.fromLTRB(18, 20, 18, 20),
      child: LayoutBuilder(
        builder: (context, constraints) => Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            VinylDisc(
              accent: style.accent,
              label: 'LOCAL\nSOUND',
              size: constraints.maxWidth < 330 ? 104 : 132,
              rotation: spin,
            ),
            const SizedBox(width: 18),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  RoomOverline(
                    controller.libraryMode
                        ? (controller.live
                              ? 'ma musique / en direct'
                              : 'ma musique / salon ouvert')
                        : (controller.phase == HostPhase.live
                              ? 'le salon / en direct'
                              : 'le salon / micro du téléphone'),
                    style: style,
                  ),
                  const SizedBox(height: 8),
                  Text(
                    title,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 23,
                      height: 1.12,
                      fontWeight: FontWeight.w700,
                      letterSpacing: -0.4,
                      color: style.text,
                    ),
                  ),
                  const SizedBox(height: 10),
                  Text(
                    caption,
                    style: TextStyle(
                      fontSize: 12.5,
                      height: 1.35,
                      color: style.muted,
                    ),
                  ),
                  const SizedBox(height: 14),
                  LevelBars(
                    level: controller.live ? controller.level : 0,
                    color: style.accent,
                    height: 22,
                    bars: 7,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Ticket extends StatelessWidget {
  const _Ticket({
    required this.style,
    required this.controller,
    required this.onCopy,
  });

  final RoomStyle style;
  final HostController controller;
  final VoidCallback onCopy;

  @override
  Widget build(BuildContext context) {
    final url = controller.url;
    return RoomCard(
      style: style,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Icon(Icons.wifi_tethering, size: 15, color: style.accentText),
              const SizedBox(width: 8),
              RoomOverline('adresse à partager', style: style),
            ],
          ),
          const SizedBox(height: 12),
          SelectableText(
            url ?? 'Recherche du réseau…',
            style: TextStyle(
              fontSize: 21,
              height: 1.15,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.2,
              color: url == null ? style.muted : style.text,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            controller.addressCount > 1
                ? '${controller.addressCount} adresses sur ce Wi-Fi — ouvre n’importe laquelle.'
                : 'Ouvre cette adresse sur un PC du même Wi-Fi.',
            style: TextStyle(fontSize: 12, color: style.muted),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 14),
            child: DashedRule(color: style.accentText.withValues(alpha: 0.35)),
          ),
          Row(
            children: [
              Icon(Icons.link, size: 15, color: style.accentText),
              const SizedBox(width: 7),
              Expanded(
                child: Text(
                  'Le lien ouvre la page d’écoute.',
                  style: TextStyle(fontSize: 12, color: style.muted),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          FilledButton.icon(
            onPressed: url == null ? null : onCopy,
            style: FilledButton.styleFrom(
              backgroundColor: style.accent,
              minimumSize: const Size(0, 46),
            ),
            icon: const Icon(Icons.copy_all_outlined, size: 18),
            label: const Text('Copier le lien'),
          ),
        ],
      ),
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({
    required this.style,
    required this.label,
    required this.value,
    required this.hint,
    required this.icon,
  });

  final RoomStyle style;
  final String label;
  final String value;
  final String hint;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return RoomCard(
      style: style,
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 15, color: style.accentText),
              const SizedBox(width: 7),
              RoomOverline(label, style: style),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              Text(
                value,
                style: TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.w700,
                  height: 1,
                  color: style.text,
                ),
              ),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  hint,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(fontSize: 11.5, color: style.muted),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _Actions extends StatelessWidget {
  const _Actions({
    required this.style,
    required this.controller,
    required this.onClose,
    required this.onLibrary,
  });

  final RoomStyle style;
  final HostController controller;
  final VoidCallback onClose;
  final VoidCallback onLibrary;

  @override
  Widget build(BuildContext context) {
    if (controller.libraryMode) return _libraryActions();

    final live = controller.phase == HostPhase.live;
    final failed = controller.phase == HostPhase.error;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (live)
          OutlinedButton.icon(
            onPressed: controller.pause,
            icon: const Icon(Icons.pause, size: 20),
            label: const Text('Mettre le micro en pause'),
          )
        else
          FilledButton.icon(
            onPressed: failed || controller.phase == HostPhase.idle
                ? controller.start
                : controller.resume,
            icon: Icon(
              failed || controller.phase == HostPhase.idle
                  ? Icons.refresh
                  : Icons.play_arrow,
              size: 20,
            ),
            label: Text(failed ? 'Réessayer' : 'Reprendre la diffusion'),
          ),
        const SizedBox(height: 10),
        OutlinedButton.icon(
          onPressed: onClose,
          style: OutlinedButton.styleFrom(
            foregroundColor: style.muted,
            side: BorderSide(color: style.accent.withValues(alpha: 0.22)),
          ),
          icon: const Icon(Icons.call_end, size: 18),
          label: const Text('Fermer le salon'),
        ),
      ],
    );
  }

  Widget _libraryActions() {
    final playing = controller.phase == HostPhase.live;
    final hasSong = controller.currentSong != null;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            _DiscButton(
              style: style,
              icon: Icons.skip_previous_rounded,
              tooltip: 'Morceau précédent',
              onPressed: controller.hasPrevious ? controller.previous : null,
            ),
            const SizedBox(width: 18),
            _DiscButton(
              style: style,
              primary: true,
              icon: playing ? Icons.pause_rounded : Icons.play_arrow_rounded,
              tooltip: playing
                  ? 'Mettre la musique en pause'
                  : 'Diffuser la musique',
              onPressed: hasSong
                  ? (playing ? controller.pause : controller.resume)
                  : null,
            ),
            const SizedBox(width: 18),
            _DiscButton(
              style: style,
              icon: Icons.skip_next_rounded,
              tooltip: 'Morceau suivant',
              onPressed: controller.hasNext ? controller.next : null,
            ),
          ],
        ),
        const SizedBox(height: 14),
        if (controller.phase == HostPhase.error)
          FilledButton.icon(
            onPressed: controller.start,
            icon: const Icon(Icons.refresh, size: 20),
            label: const Text('Réessayer'),
          )
        else
          FilledButton.icon(
            onPressed: onLibrary,
            icon: const Icon(Icons.library_music_outlined, size: 20),
            label: Text(
              controller.songs.isEmpty
                  ? 'Choisir un morceau'
                  : 'Ma musique (${controller.songs.length})',
            ),
          ),
        const SizedBox(height: 8),
        OutlinedButton.icon(
          onPressed: onClose,
          style: OutlinedButton.styleFrom(
            foregroundColor: style.muted,
            side: BorderSide(color: style.accent.withValues(alpha: 0.22)),
          ),
          icon: const Icon(Icons.call_end, size: 18),
          label: const Text('Fermer le salon'),
        ),
      ],
    );
  }
}

class _Notes extends StatelessWidget {
  const _Notes({required this.style});

  final RoomStyle style;

  static const List<(IconData, String)> _lines = [
    (
      Icons.mic_none,
      'Le son partagé est celui du micro : pose le téléphone près de la platine, de la télé ou du groupe.',
    ),
    (
      Icons.lightbulb_outline,
      'Garde l’écran allumé : Android met le micro en veille en arrière-plan.',
    ),
    (
      Icons.group_outlined,
      'Tout le monde peut mettre le micro en pause depuis la page d’écoute.',
    ),
  ];

  @override
  Widget build(BuildContext context) {
    return RoomCard(
      style: style,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          RoomOverline('à savoir', style: style),
          const SizedBox(height: 10),
          for (var i = 0; i < _lines.length; i++) ...[
            if (i > 0) const SizedBox(height: 10),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(_lines[i].$1, size: 16, color: style.accentText),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    _lines[i].$2,
                    style: TextStyle(
                      fontSize: 12.5,
                      height: 1.35,
                      color: style.muted,
                    ),
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

/// Bouton rond de transport, comme sur le lecteur.
class _DiscButton extends StatelessWidget {
  const _DiscButton({
    required this.style,
    required this.icon,
    required this.tooltip,
    required this.onPressed,
    this.primary = false,
  });

  final RoomStyle style;
  final IconData icon;
  final String tooltip;
  final VoidCallback? onPressed;
  final bool primary;

  @override
  Widget build(BuildContext context) {
    final enabled = onPressed != null;
    final size = primary ? 58.0 : 46.0;
    return Tooltip(
      message: tooltip,
      child: Material(
        color: primary
            ? (enabled ? style.accent : style.accent.withValues(alpha: 0.35))
            : Color.alphaBlend(
                style.accentText.withValues(alpha: 0.08),
                style.surface,
              ),
        shape: primary
            ? const CircleBorder()
            : CircleBorder(
                side: BorderSide(
                  color: style.accentText.withValues(alpha: 0.3),
                ),
              ),
        child: InkWell(
          customBorder: const CircleBorder(),
          onTap: onPressed,
          child: SizedBox(
            width: size,
            height: size,
            child: Icon(
              icon,
              size: primary ? 30 : 22,
              color: primary ? Colors.white : style.accentText,
            ),
          ),
        ),
      ),
    );
  }
}

/// Bibliothèque du téléphone, en feuille : un appui lance le morceau.
class _LibrarySheet extends StatelessWidget {
  const _LibrarySheet({required this.controller});

  final HostController controller;

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: controller,
      builder: (context, _) {
        final style = RoomStyle.of(
          palette: 'terracotta',
          isDark: MediaQuery.platformBrightnessOf(context) == Brightness.dark,
        );
        final songs = controller.songs;
        final current = controller.currentSong;
        return SizedBox(
          height: MediaQuery.sizeOf(context).height * 0.72,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const SizedBox(height: 10),
              Center(
                child: Container(
                  width: 38,
                  height: 4,
                  decoration: BoxDecoration(
                    color: style.accentText.withValues(alpha: 0.3),
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 16, 10, 8),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          RoomOverline('ma musique', style: style),
                          const SizedBox(height: 6),
                          Text(
                            songs.isEmpty
                                ? 'Aucun morceau trouvé.'
                                : 'Choisis un morceau.',
                            style: TextStyle(
                              fontSize: 19,
                              height: 1.15,
                              fontWeight: FontWeight.w700,
                              letterSpacing: -0.3,
                              color: style.text,
                            ),
                          ),
                        ],
                      ),
                    ),
                    IconButton(
                      tooltip: 'Relire la bibliothèque',
                      onPressed: controller.reloadLibrary,
                      icon: Icon(
                        Icons.refresh_rounded,
                        size: 20,
                        color: style.accentText,
                      ),
                    ),
                  ],
                ),
              ),
              if (songs.isEmpty)
                Expanded(
                  child: _EmptyLibrary(style: style, message: controller.error),
                )
              else
                Expanded(
                  child: ListView.separated(
                    padding: const EdgeInsets.fromLTRB(10, 2, 10, 18),
                    itemCount: songs.length,
                    separatorBuilder: (_, _) => Divider(
                      height: 1,
                      color: style.accent.withValues(alpha: 0.1),
                    ),
                    itemBuilder: (context, index) {
                      final song = songs[index];
                      final selected = current != null && song.id == current.id;
                      final subtitle = [
                        if (song.subtitle.isNotEmpty) song.subtitle,
                        if (song.durationLabel.isNotEmpty) song.durationLabel,
                      ].join(' · ');
                      return ListTile(
                        onTap: () {
                          controller.playSong(song);
                          Navigator.of(context).maybePop();
                        },
                        contentPadding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 2,
                        ),
                        leading: Container(
                          width: 36,
                          height: 36,
                          decoration: BoxDecoration(
                            color: style.accent.withValues(
                              alpha: selected ? 0.16 : 0.07,
                            ),
                            shape: BoxShape.circle,
                          ),
                          child: Icon(
                            selected ? Icons.graphic_eq : Icons.music_note,
                            size: 18,
                            color: style.accentText,
                          ),
                        ),
                        title: Text(
                          song.title,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w600,
                            color: selected ? style.accentText : style.text,
                          ),
                        ),
                        subtitle: subtitle.isEmpty
                            ? null
                            : Text(
                                subtitle,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  fontSize: 11.5,
                                  color: style.muted,
                                ),
                              ),
                        trailing: selected
                            ? Icon(
                                Icons.volume_up_rounded,
                                size: 18,
                                color: style.accent,
                              )
                            : null,
                      );
                    },
                  ),
                ),
            ],
          ),
        );
      },
    );
  }
}

class _EmptyLibrary extends StatelessWidget {
  const _EmptyLibrary({required this.style, this.message});

  final RoomStyle style;
  final String? message;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(28, 12, 28, 28),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.library_music_outlined,
            size: 32,
            color: style.accentText.withValues(alpha: 0.55),
          ),
          const SizedBox(height: 12),
          Text(
            message ?? 'Aucun fichier audio trouvé sur le téléphone.',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 12.5, height: 1.4, color: style.muted),
          ),
          const SizedBox(height: 6),
          Text(
            'Copie des morceaux dans l’appareil, puis appuie sur ↻.',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 11.5, height: 1.35, color: style.muted),
          ),
        ],
      ),
    );
  }
}
