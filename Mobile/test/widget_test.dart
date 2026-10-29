import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:localsound_mobile/host/host_controller.dart';
import 'package:localsound_mobile/room_controller.dart';
import 'package:localsound_mobile/ui/connect_screen.dart';

void main() {
  testWidgets('l’écran de connexion demande une adresse de salon', (
    tester,
  ) async {
    final controller = RoomController();
    addTearDown(controller.dispose);

    HostMode? hostRequested;
    await tester.pumpWidget(
      MaterialApp(
        home: ConnectScreen(
          controller: controller,
          onHost: (mode) => hostRequested = mode,
        ),
      ),
    );

    expect(find.text('LocalSound'), findsOneWidget);
    expect(find.text('Entrer dans le salon'), findsOneWidget);
    expect(find.text('Ma musique'), findsOneWidget);
    expect(find.text('Le micro du téléphone'), findsOneWidget);

    await tester.enterText(find.byType(TextField), 'pas une adresse :::');
    await tester.ensureVisible(find.text('Entrer dans le salon'));
    await tester.tap(find.text('Entrer dans le salon'));
    await tester.pumpAndSettle();

    expect(find.textContaining('Adresse invalide'), findsOneWidget);

    // Les deux rôles d'hôte sont plus bas dans la page : il faut y descendre.
    await tester.ensureVisible(find.text('Ma musique'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Ma musique'));
    expect(hostRequested, HostMode.library);

    await tester.ensureVisible(find.text('Le micro du téléphone'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Le micro du téléphone'));
    expect(hostRequested, HostMode.mic);
  });
}
