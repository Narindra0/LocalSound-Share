import 'package:flutter/material.dart';

/// Apparence choisie par l'utilisateur, mémorisée entre deux lancements.
///
/// `system` suit le réglage du téléphone ; les deux autres le forcent, ce qui
/// permet de garder le lecteur sombre même en plein jour.
enum AppearanceMode { system, light, dark }

/// Traduit le choix en clair/sombre, sachant ce que dit le système.
extension AppearanceModeBrightness on AppearanceMode {
  bool isDark(Brightness platform) => switch (this) {
    AppearanceMode.system => platform == Brightness.dark,
    AppearanceMode.light => false,
    AppearanceMode.dark => true,
  };
}

/// Ambiances du salon, reprises de `public/themes.css`.
///
/// L'hôte choisit un **thème** (l'objet affiché : vinyle, cassette, CD, bande,
/// MP3, radio) et une **palette** (les couleurs). Le mobile applique la palette
/// telle quelle et se sert du thème pour l'illustration du lecteur.
class RoomPalette {
  const RoomPalette({
    required this.id,
    required this.label,
    required this.accent,
    required this.accentDark,
    required this.tint,
  });

  final String id;
  final String label;
  final Color accent;
  final Color accentDark;
  final Color tint;
}

const Map<String, RoomPalette> roomPalettes = {
  'terracotta': RoomPalette(
    id: 'terracotta',
    label: 'Terracotta',
    accent: Color(0xFFA34B32),
    accentDark: Color(0xFF7B3622),
    tint: Color(0xFFF3E4DC),
  ),
  'forest': RoomPalette(
    id: 'forest',
    label: 'Sous-bois',
    accent: Color(0xFF46664F),
    accentDark: Color(0xFF314E39),
    tint: Color(0xFFDCE5D6),
  ),
  'ocean': RoomPalette(
    id: 'ocean',
    label: 'Océan',
    accent: Color(0xFF315E78),
    accentDark: Color(0xFF23465B),
    tint: Color(0xFFDAE5EB),
  ),
  'plum': RoomPalette(
    id: 'plum',
    label: 'Prune',
    accent: Color(0xFF79506C),
    accentDark: Color(0xFF59384F),
    tint: Color(0xFFE9DCE4),
  ),
};

RoomPalette paletteFor(String? id) =>
    roomPalettes[id] ?? roomPalettes['terracotta']!;

/// Le support affiché par l'hôte. Sert de titre au lecteur et d'icône.
class RoomTheme {
  const RoomTheme({
    required this.id,
    required this.label,
    required this.hint,
    required this.icon,
  });

  final String id;
  final String label;
  final String hint;
  final IconData icon;
}

const Map<String, RoomTheme> roomThemes = {
  'vinyl': RoomTheme(
    id: 'vinyl',
    label: 'Vinyle',
    hint: '33 tours, craquements optionnels',
    icon: Icons.album_outlined,
  ),
  'cassette': RoomTheme(
    id: 'cassette',
    label: 'Cassette',
    hint: 'Face A, rembobinage manuel',
    icon: Icons.radio_outlined,
  ),
  'cd': RoomTheme(
    id: 'cd',
    label: 'Compact Disc',
    hint: 'Piste 01, lecture numérique',
    icon: Icons.album,
  ),
  'reel': RoomTheme(
    id: 'reel',
    label: 'Bande magnétique',
    hint: 'Bobine 19 cm/s',
    icon: Icons.blur_circular,
  ),
  'mp3': RoomTheme(
    id: 'mp3',
    label: 'MP3',
    hint: '128 kbps, oreillettes fournies',
    icon: Icons.headphones_outlined,
  ),
  'radio': RoomTheme(
    id: 'radio',
    label: 'Radio FM',
    hint: 'Fréquence libre du salon',
    icon: Icons.radio,
  ),
};

RoomTheme themeFor(String? id) => roomThemes[id] ?? roomThemes['vinyl']!;

/// Couleurs et formes dérivées de la palette du salon.
class RoomStyle {
  RoomStyle({required this.palette, required this.isDark});

  factory RoomStyle.of({String? palette, bool isDark = false}) =>
      RoomStyle(palette: paletteFor(palette), isDark: isDark);

  final RoomPalette palette;
  final bool isDark;

  Color get accent => palette.accent;
  Color get accentDark => palette.accentDark;

  /// Accent lisible **sur la surface courante** : icônes, libellés, bordures.
  ///
  /// En sombre, `accentDark` disparaît sur le charbon : on éclaircit l'accent
  /// au lieu de l'assombrir.
  Color get accentText => isDark
      ? Color.alphaBlend(Colors.white.withValues(alpha: 0.42), palette.accent)
      : palette.accentDark;

  /// Charbon chaud teinté par la palette, assez clair pour que les cartes se
  /// détachent (l'ancien fond noir + cartes noires se confondaient).
  Color get background => isDark
      ? Color.alphaBlend(
          palette.accent.withValues(alpha: 0.09),
          const Color(0xFF131110),
        )
      : palette.tint;

  Color get surface => isDark
      ? Color.alphaBlend(
          palette.accent.withValues(alpha: 0.07),
          const Color(0xFF221D19),
        )
      : Colors.white.withValues(alpha: 0.72);

  Color get text => isDark ? const Color(0xFFF5EFE8) : const Color(0xFF2A211C);
  Color get muted => isDark
      ? const Color(0xFFB2A59B)
      : palette.accentDark.withValues(alpha: 0.7);

  /// Ombre des cartes : noire sur le charbon, teintée sur le papier.
  Color get shadow => isDark
      ? Colors.black.withValues(alpha: 0.38)
      : palette.accentDark.withValues(alpha: 0.06);

  ThemeData themeData() {
    final scheme = ColorScheme.fromSeed(
      seedColor: accent,
      brightness: isDark ? Brightness.dark : Brightness.light,
    ).copyWith(surface: surface, primary: accent);
    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: background,
      textTheme:
          (isDark
                  ? Typography.material2021().white
                  : Typography.material2021().black)
              .apply(bodyColor: text, displayColor: text),
      appBarTheme: AppBarTheme(
        backgroundColor: Colors.transparent,
        foregroundColor: text,
        elevation: 0,
        centerTitle: false,
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: accent,
          foregroundColor: Colors.white,
          minimumSize: const Size(0, 52),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
          ),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: accentText,
          minimumSize: const Size(0, 52),
          side: BorderSide(
            color: accentText.withValues(alpha: isDark ? 0.45 : 0.4),
          ),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
          ),
        ),
      ),
      sliderTheme: SliderThemeData(
        activeTrackColor: accent,
        thumbColor: accentText,
        inactiveTrackColor: accent.withValues(alpha: isDark ? 0.3 : 0.2),
      ),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: isDark ? const Color(0xFF332B25) : accentDark,
        contentTextStyle: const TextStyle(color: Colors.white),
        behavior: SnackBarBehavior.floating,
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: isDark
            ? Color.alphaBlend(Colors.black.withValues(alpha: 0.28), surface)
            : Colors.white.withValues(alpha: 0.75),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: BorderSide(color: accentText.withValues(alpha: 0.3)),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: BorderSide(color: accentText.withValues(alpha: 0.3)),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: BorderSide(color: accentText, width: 1.6),
        ),
      ),
    );
  }
}
