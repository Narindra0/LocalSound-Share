import 'package:flutter/material.dart';

import 'package:localsound_mobile/host/host_controller.dart';
import 'package:localsound_mobile/host/library_source.dart';
import 'package:localsound_mobile/room_controller.dart';
import 'package:localsound_mobile/ui/appearance.dart';
import 'package:localsound_mobile/ui/connect_screen.dart';
import 'package:localsound_mobile/ui/host_screen.dart';
import 'package:localsound_mobile/ui/player_screen.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final controller = RoomController();
  await controller.loadPreferences();
  runApp(LocalSoundApp(controller: controller));
}

/// Racine de l'app : deux rôles, écouter un salon du réseau ou héberger le sien.
class LocalSoundApp extends StatefulWidget {
  const LocalSoundApp({super.key, required this.controller});

  final RoomController controller;

  @override
  State<LocalSoundApp> createState() => _LocalSoundAppState();
}

class _LocalSoundAppState extends State<LocalSoundApp> {
  HostController? _host;

  void _openHost(HostMode mode) {
    if (_host != null) return;
    setState(
      () => _host = HostController(
        trackTitle: 'Le direct du salon',
        librarySource: mode == HostMode.library ? LibrarySource() : null,
      ),
    );
  }

  void _closeHost() {
    final host = _host;
    _host = null;
    host?.dispose();
    setState(() {});
  }

  @override
  void dispose() {
    _host?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final controller = widget.controller;
    return AnimatedBuilder(
      animation: controller,
      builder: (context, _) {
        final style = RoomStyle.of(
          palette: controller.state.appearance['palette'] as String?,
          isDark:
              WidgetsBinding.instance.platformDispatcher.platformBrightness ==
              Brightness.dark,
        );
        final host = _host;
        return MaterialApp(
          title: 'LocalSound',
          debugShowCheckedModeBanner: false,
          theme: style.themeData(),
          home: host != null
              ? HostScreen(controller: host, onClose: _closeHost)
              : controller.inRoom
              ? PlayerScreen(controller: controller)
              : ConnectScreen(controller: controller, onHost: _openHost),
        );
      },
    );
  }
}
