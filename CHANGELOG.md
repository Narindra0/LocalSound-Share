# Historique des versions

## À venir

- Setup Windows en ligne : choix des éditions, acceptation des conditions, téléchargements vérifiés, raccourcis et désinstallation pour le compte courant.
- Tests classés par usage, diagnostics déplacés hors de la racine et références de conception regroupées dans `docs/design/`.
- Documentation réorganisée pour GitHub : installation, développement, compilation, publication et contribution.
- Exclusions Git, règles de fins de ligne, modèles d’issues/pull requests et CI Windows.
- Contrôle des fichiers destinés au dépôt avant publication.

## 0.1.6

- Application Android : sélecteur d’apparence clair / sombre / auto mémorisé, appliqué à tous les écrans.
- Mode sombre retravaillé : fond charbon, cartes distinctes, accents éclaircis pour les icônes et les libellés.
- Recherche dans la bibliothèque du téléphone par titre, artiste ou album, sans tenir compte des accents.
- Diffusion musique fluide : échéance des trames alignée sur une horloge audio continue, réserve de 260 ms.
- Releases publiées automatiquement par GitHub Actions à chaque tag `v*` : EXE Windows, APK Android et empreintes SHA-256.

## 0.1.5

- Partage synchronisé automatique à l’ouverture de YouTube intégré ; prévisualisation muette avant capture.
- Correction mémorisée du retour audio de l’hôte, de −100 à +300 ms.
- Édition Auditeur Léger WebView2, avec un EXE d’environ 6,53 Mo et un mini-lecteur dans la même fenêtre.
- Paquets Electron limités aux langues française et anglaise.
- Limite du son système direct signalée dans l’interface.

## 0.1.4

- Encodage Opus partagé dans un worker ; décodage WASM embarqué compatible avec les adresses LAN HTTP.
- Haute qualité 192 kbit/s par défaut, modes Standard 128 et Économique 96, et option PCM sans compression.
- Compteurs de débit, compatibilité des lecteurs PCM et changement de qualité pendant la lecture.

## 0.1.3

- Page À propos intégrée, organisée en présentation, créateur, CGU, confidentialité, mentions légales et licences.

## 0.1.2

- Édition Windows dédiée aux auditeurs.
- Mini-lecteurs fixes, non maximisables, maintenus au premier plan ; restauration du grand lecteur à leur fermeture.

## 0.1.1

- Navigateur YouTube dans un panneau de la fenêtre principale, avec formats compact/agrandi et masquage.
- Mini-lecteur natif permettant de conserver l’audio avec la grande fenêtre masquée.

## 0.1.0

- Première édition Windows portable de LocalSound Share.
- Diffusion locale, sources audio, horloge commune, thèmes, pochettes et propositions de morceaux.
- Identité visuelle, coordonnées du créateur et informations légales intégrées.
