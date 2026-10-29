# LocalSound Mobile

Deux rôles dans une seule app Android :

- **auditeur** — reçoit le PCM du salon par WebSocket, le joue à l'horloge
  commune et pilote la lecture à distance ;
- **hôte** — ouvre son propre salon et diffuse aux navigateurs du réseau soit
  sa **musique** (les fichiers du téléphone, avec une liste de lecture), soit le
  **micro** (le son de la pièce), avec la même page d'écoute que le PC hôte.

## Écouter

| Écran | Rôle |
| --- | --- |
| Connexion | Saisie de l'adresse affichée sur la console hôte (`http://192.168.x.y:3000`), conservée d'une session à l'autre. |
| Lecteur | Pochette, titre, transport `stop` / `play-pause`, volume local, état du flux (kb/s, codec, signal). |
| Réglages | Calibration ±80 ms, latence aller-retour, horloge synchronisée, compteurs, sortie du salon. |
| Demandes | Proposition d'un morceau (titre, lien, prénom) et suivi de la file. Les décisions restent sur le PC hôte. |

L'apparence (6 thèmes × 4 palettes) est imposée par l'hôte via `appearance`
dans les messages `meta`/`state`.

## Héberger

`Ma musique` ou `Le micro du téléphone` (écran de connexion) démarre un
serveur HTTP + WebSocket dans l'app, sur le port 3000 (3001…3004 si occupé).
Les deux sources passent par le même tuyau : blocs PCM stéréo 48 kHz de 20 ms,
échéance `playAt = capturedAt + 150 ms`, et un seul état de lecture.

| Ce que sert le téléphone | Détail |
| --- | --- |
| `/` et `/listen` | La page d'écoute web, identique au PC hôte. |
| `/api/status` | État complet du salon (`HostState`). |
| `/api/requests` | `GET` la file, `POST` une demande (mêmes règles que `song-requests.js`). |
| `/api/control` | `play` / `pause` / `stop`. |
| `/listen` (WebSocket) | `hello` → `transport` + `meta` + `requests`, puis trames `LSP2` et `ping`/`pong`. |

Le téléphone n'encode ni Opus ni MP3 : en réseau local, le PCM suffit, et un
encodeur Opus demanderait une dépendance native.

### Source : la musique du téléphone

`MusicLibrary.kt` lit la bibliothèque `MediaStore` (titre, artiste, album,
durée) hors du fil principal. La feuille « Ma musique » liste les morceaux ;
un appui lance la lecture. Le fichier choisi est décodé par
`MediaExtractor` + `MediaCodec` (MP3, AAC/M4A, FLAC, OGG/Vorbis, Opus, WAV…) et
rééchantillonné en stéréo 48 kHz 16 bits : le même PCM alimente l'`AudioTrack`
du téléphone **et** les auditeurs, qui entendent donc la même chose au même
moment. L'émission est cadencée sur 20 ms pour que chaque trame ait une durée
réelle, et le titre/artiste du morceau partent dans `nowPlaying` (la page web
affiche le morceau en cours). Le transport de la console gère précédent /
lecture-pause / suivant ; en fin de file, le salon reste ouvert, prêt pour un
autre choix.

Permissions : `READ_MEDIA_AUDIO` sur Android 13+, `READ_EXTERNAL_STORAGE`
jusqu'à Android 12. Un refus se voit dans la console, avec « Réessayer ».

### Source : le micro

48 kHz, 16 bits, mono capturé par `AudioRecord` (`MicCapture.kt`), dupliqué en
stéréo côté Dart.

Une seule règle tient l'ensemble : **la source suit l'état du serveur**. Mettre
en pause depuis un navigateur arrête `AudioRecord` ou suspend le lecteur ;
`play` les relance.

### Limites connues

- Pas de capture du son des autres applis : `AudioPlaybackCapture` demande
  Android 10, l'accord de l'appli source, et Spotify ou YouTube Music le
  refusent. D'où le lecteur intégré : c'est nous qui décodons le fichier.
- Mode musique : pas d'avance/retour dans un morceau ni de pochette sur la page
  web (le lecteur mobile montre une pochette imprimée), et la diffusion reste
  du PCM non compressé, parfait en Wi-Fi local seulement.
- Pas de service de premier plan : si l'écran s'éteint ou si l'app passe en
  arrière-plan, Android peut couper le micro ou la lecture. L'écran reste
  allumé pendant l'hébergement (`FLAG_KEEP_SCREEN_ON`).
- Le téléphone hôte ne rejoint pas un salon PC en même temps qu'il héberge.

## Architecture

```
lib/
  core/protocol.dart   trames LSP1/LSP2/LSO3, SequenceGuard, messages JSON
  core/state.dart      HostState (état du salon)
  core/room_clock.dart décalage d'horloge, règle « jamais rejouer en retard »
  core/requests.dart   file de demandes
  session.dart         WebSocket : hello, listen, ping, reconnexion, HTTP
  room_controller.dart assemblage session + lecteur + préférences
  audio/pcm_encoder.dart  Float32 → s16le entrelacé
  audio/pcm_player.dart   canal natif `localsound/audio`
  host/host_server.dart   serveur du salon : HTTP, WebSocket, trames LSP2
  host/host_requests.dart file de demandes du téléphone hôte
  host/mic_source.dart    canal `localsound/mic`, mono → stéréo, vumètre
  host/library_queue.dart morceaux, file de lecture (sans Flutter, testée seule)
  host/library_source.dart canaux `localsound/library[_stream|_events]`
  host/web_assets.dart    lecture des pages web embarquées
  host/host_controller.dart source (musique ou micro) + serveur + écran hôte
  ui/surfaces.dart     briques visuelles : carte papier, billet, vinyle, vumètre
  ui/                  connexion, lecteur, demandes, mon salon, thèmes
android/app/src/main/kotlin/…/LocalSoundAudio.kt   AudioTrack (MODE_STREAM)
android/app/src/main/kotlin/…/MicCapture.kt        AudioRecord 48 kHz mono
android/app/src/main/kotlin/…/MusicLibrary.kt     MediaStore, MediaCodec, AudioTrack, rééchantillonnage
```

Décisions de lecture :

- l'app annonce `codec: 'pcm'`, le serveur ne lui envoie donc pas d'Opus ;
- une trame dont l'âge dépasse `max(120 ms, RTT + 60 ms)` est jetée, jamais
  rejouée en retard (même règle que `public/sync-player.js`) ;
- `AudioTrack` en flux continu : un bloc manquant produit du silence, pas de
  retard accumulé.
- côté hôte, l'échéance des trames suit une **horloge audio continue** (durée
  du bloc), jamais l'heure d'arrivée : deux blocs livrés d'un coup restent
  espacés de leur durée réelle, au lieu de partager une échéance puis de
  laisser un trou. Au-delà de 400 ms de retard, on repart de l'horloge réelle.
- en mode musique, `syncDelayMs` passe de 150 à **260 ms** : la réserve absorbe
  le décodage et le passage par le fil principal sans saccader les auditeurs.

## Design

L'app reprend la matière du web : fond de papier chaud teinté par la palette
du salon, étiquettes en petites capitales, cartes à bord fin et ombre douce.
En sombre, même structure avec deux jetons distincts : un **charbon chaud**
pour le fond, une surface plus claire pour les cartes, et `accentText` —
l'accent éclairci — pour les icônes et libellés, parce que `accentDark`
disparaissait sur le noir.
`ui/surfaces.dart` porte ces briques (fond, carte, étiquette, pastille d'état,
billet pointillé, vumètre, vinyle dessiné) et les quatre écrans s'y appuient :

- **entrée** : les deux rôles annoncés côte à côte, séparés par un filet
  pointillé ;
- **lecteur** : une pochette posée sur un vinyle qui dépasse et ne tourne qu'en
  lecture, puis une platine (transport + volume) et l'accès aux demandes ;
- **console hôte** : vinyle en rotation **seulement** quand la source diffuse,
  titre du morceau ou niveau du micro, billet d'adresse, tuiles auditeurs/débit,
  transport de la musique et feuille « Ma musique » ;
- **demandes** : formulaire en carte, sections en capitales, chaque proposition
  dans sa carte avec sa pastille d'état.

Aucune image : tout est peint (gradients, `CustomPainter`), donc net à toutes
les densités et sans poids dans l'APK.

## Interface web embarquée

L'APK contient une copie de `public/` (`assets/web/`) plus la liste
`assets/web_manifest.json`, pour servir la page d'écoute sans ordinateur.
Après toute modification de `public/`, régénérer la copie depuis la racine :

```bash
npm run mobile:web      # copie public/ → Mobile/assets/web + manifeste
```

Sans cette étape, l'APK sert l'ancienne interface (les tests ne le voient pas).

## Développement

```bash
flutter pub get
flutter analyze
flutter test          # 59 tests, aucun appareil requis
(cd android && ./gradlew :app:testDebugUnitTest)   # 6 tests du rééchantillonnage PCM
flutter build apk --release --split-per-abi
```

Pour tester sur téléphone : démarrer le serveur sur le PC hôte (`npm start`),
brancher l'appareil (débogage USB actif), puis `flutter run`. Le téléphone doit
être sur le même Wi-Fi ; Android autorise le HTTP en clair pour ces adresses
(`usesCleartextTraffic`).

## Réseau et sécurité

En mode auditeur, le serveur accepte les commandes de lecture
(`play`/`pause`/`stop`) depuis une adresse privée du LAN, en plus de
localhost : n'importe quel appareil du réseau peut donc piloter la lecture.
Les routes qui touchent aux fichiers, aux réglages et aux décisions de
demandes restent réservées à localhost.

En mode hôte, le téléphone n'accepte que les requêtes de même origine pour
`/api/requests` et `/api/control`, et ouvre le micro après autorisation
Android explicite. Toute personne du réseau peut ouvrir le salon, écouter et
mettre le micro en pause : c'est le principe d'une pièce partagée, et cela
s'arrête en fermant le salon.
