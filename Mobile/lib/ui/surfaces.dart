/// Briques visuelles communes, calquées sur l'interface web : papier chaud,
/// étiquettes en petites capitales, cartes à bord fin, pastilles d'état.
///
/// Tout est dérivé de [RoomStyle] : changer la palette du salon change ces
/// surfaces sans toucher aux écrans.
library;

import 'package:flutter/material.dart';

import 'appearance.dart';

/// Fond de page : un dégradé de papier, avec un halo de la couleur du salon.
class RoomBackdrop extends StatelessWidget {
  const RoomBackdrop({super.key, required this.style, required this.child});

  final RoomStyle style;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [
            Color.alphaBlend(
              style.accent.withValues(alpha: style.isDark ? 0.14 : 0.1),
              style.background,
            ),
            style.background,
          ],
          stops: const [0, 0.45],
        ),
      ),
      child: child,
    );
  }
}

/// Petite étiquette en capitales espacées : « ADRESSE DU SALON ».
/// Trois façons de choisir l'apparence : suivre le système, clair, sombre.
///
/// Le choix est gardé par le contrôleur ; ce widget ne fait que l'afficher.
class AppearanceSwitch extends StatelessWidget {
  const AppearanceSwitch({
    super.key,
    required this.style,
    required this.mode,
    required this.onChanged,
  });

  final RoomStyle style;
  final AppearanceMode mode;
  final ValueChanged<AppearanceMode> onChanged;

  static const List<(AppearanceMode, IconData, String)> _options = [
    (AppearanceMode.system, Icons.brightness_auto_outlined, 'Auto'),
    (AppearanceMode.light, Icons.light_mode_outlined, 'Clair'),
    (AppearanceMode.dark, Icons.dark_mode_outlined, 'Sombre'),
  ];

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: Color.alphaBlend(
          Colors.black.withValues(alpha: style.isDark ? 0.22 : 0.04),
          style.surface,
        ),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: style.accentText.withValues(alpha: 0.16)),
      ),
      child: Row(
        children: [
          for (final (value, icon, label) in _options)
            Expanded(
              child: _AppearanceOption(
                style: style,
                selected: value == mode,
                icon: icon,
                label: label,
                onTap: () => onChanged(value),
              ),
            ),
        ],
      ),
    );
  }
}

class _AppearanceOption extends StatelessWidget {
  const _AppearanceOption({
    required this.style,
    required this.selected,
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final RoomStyle style;
  final bool selected;
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final color = selected ? style.accentText : style.muted;
    return InkWell(
      borderRadius: BorderRadius.circular(10),
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 160),
        padding: const EdgeInsets.symmetric(vertical: 8),
        decoration: BoxDecoration(
          color: style.accent.withValues(
            alpha: selected ? (style.isDark ? 0.26 : 0.12) : 0,
          ),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Column(
          children: [
            Icon(icon, size: 18, color: color),
            const SizedBox(height: 4),
            Text(
              label,
              style: TextStyle(
                fontSize: 11.5,
                fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                color: color,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class RoomOverline extends StatelessWidget {
  const RoomOverline(this.text, {super.key, required this.style, this.color});

  final String text;
  final RoomStyle style;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    return Text(
      text.toUpperCase(),
      style: TextStyle(
        fontSize: 10.5,
        height: 1.2,
        letterSpacing: 1.6,
        fontWeight: FontWeight.w700,
        color: color ?? style.muted,
      ),
    );
  }
}

/// Carte de papier : bord fin, coins arrondis, ombre très douce.
class RoomCard extends StatelessWidget {
  const RoomCard({
    super.key,
    required this.style,
    required this.child,
    this.padding = const EdgeInsets.all(18),
    this.accent = false,
  });

  final RoomStyle style;
  final Widget child;
  final EdgeInsets padding;

  /// Carte mise en avant : fond teinté et bord plus marqué.
  final bool accent;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: padding,
      decoration: BoxDecoration(
        color: accent
            ? Color.alphaBlend(
                style.accent.withValues(alpha: style.isDark ? 0.16 : 0.07),
                style.surface,
              )
            : style.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: style.accentText.withValues(alpha: accent ? 0.32 : 0.16),
        ),
        boxShadow: [
          BoxShadow(
            color: style.shadow,
            blurRadius: 22,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: child,
    );
  }
}

/// Pastille d'état : point coloré + libellé.
class RoomPill extends StatelessWidget {
  const RoomPill({
    super.key,
    required this.label,
    required this.color,
    this.pulse = false,
    this.animation,
  });

  final String label;
  final Color color;
  final bool pulse;
  final Animation<double>? animation;

  @override
  Widget build(BuildContext context) {
    final dot = Container(
      width: 7,
      height: 7,
      decoration: BoxDecoration(color: color, shape: BoxShape.circle),
    );
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(30),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (pulse && animation != null)
            FadeTransition(opacity: animation!, child: dot)
          else
            dot,
          const SizedBox(width: 7),
          Flexible(
            child: Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 11.5,
                fontWeight: FontWeight.w600,
                color: color,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Séparateur pointillé, façon billet détachable.
class DashedRule extends StatelessWidget {
  const DashedRule({super.key, required this.color, this.height = 1});

  final Color color;
  final double height;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: height,
      width: double.infinity,
      child: CustomPaint(painter: _DashesPainter(color)),
    );
  }
}

class _DashesPainter extends CustomPainter {
  _DashesPainter(this.color);

  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..strokeWidth = 1;
    const dash = 4.0, gap = 4.0;
    for (var x = 0.0; x < size.width; x += dash + gap) {
      canvas.drawLine(Offset(x, 0.5), Offset(x + dash, 0.5), paint);
    }
  }

  @override
  bool shouldRepaint(_DashesPainter oldDelegate) => oldDelegate.color != color;
}

/// Barres de niveau animées : visuel « ondes » du salon en direct.
class LevelBars extends StatelessWidget {
  const LevelBars({
    super.key,
    required this.level,
    required this.color,
    this.bars = 5,
    this.height = 26,
    this.width = 3.4,
  });

  final double level;
  final Color color;
  final int bars;
  final double height;
  final double width;

  /// Répartition fixe des crêtes : sans elle, toutes les barres bougeraient
  /// ensemble et le vumètre ressemblerait à un simple rectangle.
  static const List<double> _shape = [0.55, 0.9, 1, 0.72, 0.45, 0.85, 0.6];

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        for (var i = 0; i < bars; i++) ...[
          if (i > 0) const SizedBox(width: 3),
          AnimatedContainer(
            duration: const Duration(milliseconds: 140),
            curve: Curves.easeOut,
            width: width,
            height: (height * (0.16 + level * _shape[i % _shape.length])).clamp(
              2.0,
              height,
            ),
            decoration: BoxDecoration(
              color: color,
              borderRadius: BorderRadius.circular(width),
            ),
          ),
        ],
      ],
    );
  }
}

/// Disque vinyle dessiné à la main : sillons, étiquette, axe.
class VinylDisc extends StatelessWidget {
  const VinylDisc({
    super.key,
    required this.accent,
    required this.label,
    this.size = 150,
    this.rotation,
    this.dark = true,
  });

  final Color accent;
  final String label;
  final double size;
  final Animation<double>? rotation;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    final disc = Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: SweepGradient(
          colors: dark
              ? [
                  const Color(0xFF17140F),
                  const Color(0xFF2A241C),
                  const Color(0xFF141210),
                  const Color(0xFF26201A),
                  const Color(0xFF17140F),
                ]
              : [
                  accent.withValues(alpha: 0.85),
                  accent,
                  accent.withValues(alpha: 0.75),
                  accent,
                  accent.withValues(alpha: 0.85),
                ],
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.12),
            blurRadius: 12,
            spreadRadius: -3,
            offset: const Offset(0, 5),
          ),
        ],
      ),
      child: Stack(
        alignment: Alignment.center,
        children: [
          CustomPaint(size: Size.square(size), painter: _GroovePainter(accent)),
          Container(
            width: size * 0.36,
            height: size * 0.36,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: accent,
              border: Border.all(
                color: Colors.white.withValues(alpha: 0.35),
                width: 1.2,
              ),
            ),
            alignment: Alignment.center,
            padding: EdgeInsets.all(size * 0.03),
            child: Text(
              label,
              textAlign: TextAlign.center,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: Colors.white,
                fontSize: size * 0.055,
                height: 1.1,
                fontWeight: FontWeight.w700,
                letterSpacing: 0.6,
              ),
            ),
          ),
          Container(
            width: size * 0.035,
            height: size * 0.035,
            decoration: const BoxDecoration(
              color: Color(0xFF0D0B09),
              shape: BoxShape.circle,
            ),
          ),
        ],
      ),
    );
    if (rotation == null) return disc;
    return RotationTransition(turns: rotation!, child: disc);
  }
}

class _GroovePainter extends CustomPainter {
  _GroovePainter(this.accent);

  final Color accent;

  @override
  void paint(Canvas canvas, Size size) {
    final center = size.center(Offset.zero);
    final paint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 0.7;
    for (var i = 1; i <= 9; i++) {
      final radius = size.width * (0.18 + i * 0.037);
      paint.color = Colors.white.withValues(alpha: i.isEven ? 0.09 : 0.05);
      canvas.drawCircle(center, radius, paint);
    }
    paint.color = accent.withValues(alpha: 0.55);
    paint.strokeWidth = 1.2;
    canvas.drawCircle(center, size.width * 0.415, paint);
  }

  @override
  bool shouldRepaint(_GroovePainter oldDelegate) =>
      oldDelegate.accent != accent;
}
