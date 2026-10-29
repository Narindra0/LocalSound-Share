import 'package:flutter/material.dart';
import 'package:localsound_mobile/host/host_controller.dart';
import 'package:localsound_mobile/room_controller.dart';
import 'package:localsound_mobile/ui/appearance.dart';
import 'package:localsound_mobile/ui/surfaces.dart';

/// Entrée de l'app : rejoindre le salon d'un PC, ou héberger le sien depuis le
/// micro du téléphone. Les deux rôles occupent la même page, sans menu caché.
class ConnectScreen extends StatefulWidget {
  const ConnectScreen({
    super.key,
    required this.controller,
    required this.onHost,
  });

  final RoomController controller;

  /// Ouvre la console d'hébergement du téléphone, avec la source choisie.
  final ValueChanged<HostMode> onHost;

  @override
  State<ConnectScreen> createState() => _ConnectScreenState();
}

class _ConnectScreenState extends State<ConnectScreen> {
  late final TextEditingController _url = TextEditingController(
    text: widget.controller.serverUrl,
  );
  String? _error;

  @override
  void dispose() {
    _url.dispose();
    super.dispose();
  }

  Future<void> _connect() async {
    FocusScope.of(context).unfocus();
    setState(() => _error = null);
    final ok = await widget.controller.connect(_url.text);
    if (!ok && mounted) {
      setState(() => _error = widget.controller.notice ?? 'Salon injoignable.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final style = RoomStyle.of(
      palette: widget.controller.state.appearance['palette'] as String?,
      isDark: MediaQuery.platformBrightnessOf(context) == Brightness.dark,
    );
    return Scaffold(
      body: RoomBackdrop(
        style: style,
        child: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(22, 26, 22, 32),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 460),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    _Wordmark(style: style),
                    const SizedBox(height: 26),
                    _Headline(style: style),
                    const SizedBox(height: 26),
                    _JoinCard(
                      style: style,
                      controller: widget.controller,
                      url: _url,
                      error: _error,
                      onSubmit: _connect,
                    ),
                    const SizedBox(height: 18),
                    _OrDivider(style: style),
                    const SizedBox(height: 18),
                    _HostCard(style: style, onHost: widget.onHost),
                    const SizedBox(height: 26),
                    _Footnotes(style: style),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _Wordmark extends StatelessWidget {
  const _Wordmark({required this.style});

  final RoomStyle style;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        VinylDisc(accent: style.accent, label: 'LS', size: 56, dark: false),
        const SizedBox(width: 14),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              FittedBox(
                fit: BoxFit.scaleDown,
                alignment: Alignment.centerLeft,
                child: Row(
                  children: [
                    Text(
                      'LocalSound',
                      style: TextStyle(
                        fontSize: 19,
                        fontWeight: FontWeight.w700,
                        letterSpacing: -0.2,
                        color: style.text,
                      ),
                    ),
                    const SizedBox(width: 4),
                    Text(
                      'Share.',
                      style: TextStyle(
                        fontSize: 19,
                        fontWeight: FontWeight.w700,
                        color: style.accentText,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 3),
              RoomOverline('le salon sonore du réseau', style: style),
            ],
          ),
        ),
      ],
    );
  }
}

class _Headline extends StatelessWidget {
  const _Headline({required this.style});

  final RoomStyle style;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Le même son,',
          style: TextStyle(
            fontSize: 34,
            height: 1.05,
            fontWeight: FontWeight.w700,
            letterSpacing: -1,
            color: style.text,
          ),
        ),
        Text(
          'dans ta poche.',
          style: TextStyle(
            fontSize: 34,
            height: 1.05,
            fontWeight: FontWeight.w400,
            fontStyle: FontStyle.italic,
            letterSpacing: -0.8,
            color: style.accentText,
          ),
        ),
        const SizedBox(height: 12),
        Text(
          'Rejoins le salon d’un PC du Wi-Fi, ou ouvre le tien avec le micro '
          'du téléphone.',
          style: TextStyle(fontSize: 13.5, height: 1.45, color: style.muted),
        ),
      ],
    );
  }
}

class _JoinCard extends StatelessWidget {
  const _JoinCard({
    required this.style,
    required this.controller,
    required this.url,
    required this.error,
    required this.onSubmit,
  });

  final RoomStyle style;
  final RoomController controller;
  final TextEditingController url;
  final String? error;
  final Future<void> Function() onSubmit;

  @override
  Widget build(BuildContext context) {
    return RoomCard(
      style: style,
      padding: const EdgeInsets.fromLTRB(18, 18, 18, 18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Icon(Icons.speaker_outlined, size: 15, color: style.accentText),
              const SizedBox(width: 8),
              RoomOverline('rejoindre un salon', style: style),
            ],
          ),
          const SizedBox(height: 14),
          TextField(
            controller: url,
            keyboardType: TextInputType.url,
            autocorrect: false,
            textInputAction: TextInputAction.go,
            onSubmitted: (_) => onSubmit(),
            decoration: const InputDecoration(
              labelText: 'Adresse du salon',
              hintText: 'http://192.168.1.12:3000',
            ),
          ),
          const SizedBox(height: 14),
          AnimatedBuilder(
            animation: controller,
            builder: (context, _) {
              final connecting = controller.busy;
              return FilledButton.icon(
                onPressed: connecting ? null : onSubmit,
                icon: connecting
                    ? const SizedBox(
                        width: 17,
                        height: 17,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Icon(Icons.login, size: 19),
                label: Text(connecting ? 'Connexion…' : 'Entrer dans le salon'),
              );
            },
          ),
          if (error != null) ...[
            const SizedBox(height: 14),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: style.accent.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: style.accentText.withValues(alpha: 0.32),
                ),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(Icons.wifi_off, size: 16, color: style.accentText),
                  const SizedBox(width: 9),
                  Expanded(
                    child: Text(
                      error!,
                      style: TextStyle(
                        color: style.accentText,
                        fontSize: 12.5,
                        height: 1.35,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _OrDivider extends StatelessWidget {
  const _OrDivider({required this.style});

  final RoomStyle style;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(child: DashedRule(color: style.accent.withValues(alpha: 0.3))),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12),
          child: RoomOverline('ou', style: style),
        ),
        Expanded(child: DashedRule(color: style.accent.withValues(alpha: 0.3))),
      ],
    );
  }
}

class _HostCard extends StatelessWidget {
  const _HostCard({required this.style, required this.onHost});

  final RoomStyle style;
  final ValueChanged<HostMode> onHost;

  @override
  Widget build(BuildContext context) {
    return RoomCard(
      style: style,
      accent: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Icon(Icons.podcasts, size: 15, color: style.accentText),
              const SizedBox(width: 8),
              RoomOverline('héberger', style: style),
            ],
          ),
          const SizedBox(height: 12),
          Text(
            'Ouvre ton salon.',
            style: TextStyle(
              fontSize: 20,
              height: 1.15,
              fontWeight: FontWeight.w700,
              letterSpacing: -0.3,
              color: style.text,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Ta musique joue dans la pièce et part vers les auditeurs — ou '
            'prends le son de la pièce au micro.',
            style: TextStyle(fontSize: 12.5, height: 1.4, color: style.muted),
          ),
          const SizedBox(height: 14),
          OutlinedButton.icon(
            onPressed: () => onHost(HostMode.library),
            icon: const Icon(Icons.library_music_outlined, size: 19),
            label: const Text('Ma musique'),
          ),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: () => onHost(HostMode.mic),
            icon: const Icon(Icons.mic_none, size: 19),
            label: const Text('Le micro du téléphone'),
          ),
        ],
      ),
    );
  }
}

class _Footnotes extends StatelessWidget {
  const _Footnotes({required this.style});

  final RoomStyle style;

  static const List<(IconData, String)> _lines = [
    (Icons.cast, 'Même Wi-Fi que l’hôte. Rien à installer sur le PC.'),
    (
      Icons.volume_up_outlined,
      'Le son suit l’horloge du salon, au volume de ton choix.',
    ),
    (Icons.play_arrow_outlined, 'La lecture se pilote depuis le téléphone.'),
  ];

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (var i = 0; i < _lines.length; i++) ...[
          if (i > 0) const SizedBox(height: 10),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(_lines[i].$1, size: 15, color: style.muted),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  _lines[i].$2,
                  style: TextStyle(
                    fontSize: 12,
                    height: 1.35,
                    color: style.muted,
                  ),
                ),
              ),
            ],
          ),
        ],
      ],
    );
  }
}
