# Design de l’interface — LocalSound Share

## Objectif

Interface claire, légère et sans dépendance à un CDN. L’interface sépare les usages en plusieurs pages pour faciliter la navigation, tout en gardant les actions principales visibles immédiatement.

## Pages

| Page | Route | Rôle |
|---|---|---|
| Accueil | `/home` | Point d’entrée, liens vers la console et l’écoute. |
| Console hôte | `/host` | Pilotage de la diffusion, choix de la source, volume local et diagnostics. |
| Écoute | `/` | Connexion, lecture, volume personnel, calibration et détails audio. |
| Réglages | `/settings` | Repères sur les paramètres disponibles et navigation. |

Les pages partagent l’en-tête, le pied de page et le thème visuel. Aucun en-tête de choix entre “Console hôte” et “Vue auditeur” n’est présent.

## Navigation

- Liens discrets dans le pied de page : `Accueil`, `Réglages`.
- L’accueil propose deux actions principales : `Console hôte` et `Écouter`.
- Les routes directes restent utilisables : `/`, `/host`, `/home`, `/settings`.

## Thème visuel

- Fond : dégradé bleuté clair (`#f8fafc`, `#f2f8fe`, `#f2f3fd`).
- Surfaces : cartes blanches arrondies, ombres douces.
- Accent : bleu `#2563eb`.
- Typographie : `Inter`, `Segoe UI`, system-ui.
- Icônes : sprite local `/icons.svg`.
- Aucun CDN ni ressource externe.

## Console hôte (`/host`)

### Bloc principal

- Titre : `Console hôte`
- Statut de connexion : `Serveur en ligne`
- Ligne de session : `Hôte : <nom> · 48 kHz stereo`
- Tag : `EN DIRECT` lorsque le flux est actif.

### Adresse à donner aux auditeurs

- Libellé : `Adresse à donner aux auditeurs`
- Bouton : `Copier`
- Aide : `Ouvrez cette adresse sur les appareils du même Wi-Fi.`

### Source audio

Bloc `.source-box` :

- Réglage : case à cocher `Écoute sans écho entre appareils`
- Aide : `Les fichiers et les onglets utilisent une même horloge sur l’hôte et les auditeurs. Le son système reste direct, avec risque d’écho.`
- Boutons :
  - `♫ Choisir un fichier`
  - `Partager un onglet`
  - `Son système`
  - `Terminer le partage` (masqué si inactif)
- Source actuelle : `Source : <…>`
- Notification : `Choisissez une source pour l’écoute commune.`

### Écoute locale

- Bouton : `Écouter sur ce PC` / `Couper l’écoute ici`
- Volume : `Volume ici`
- Statut : `Écoute locale désactivée.` ou `Ce PC suit la même horloge que les auditeurs.`

### État du flux

- Carte noire : `Le son de votre PC`
- État : `Vérification du flux…`
- Égaliseur animé pendant la diffusion.

### Commandes

- `▶ Démarrer`
- `Ⅱ Pause`
- `■ Arrêter`

### Statistiques

- `Source de capture`
- `Connexion au serveur`
- `Auditeurs à l’écoute`
- `Débit de la source`

### Diagnostic

- Zone : `Vérification de la diffusion…`
- Texte secondaire : `En mode fichier, les commandes pilotent aussi la musique. Pour un onglet, elles pilotent le partage.`
- Détails repliables : `Applications Windows et écho`

## Page d’écoute (`/`)

### En-tête

- Titre principal : `Salon d’écoute`
- Statut : `Connexion à votre radio locale…` puis `Connecté à la radio de <hôte>`

### Écoute

- Aide : `Un clic pour retrouver le son de l’hôte. Installez-vous, on s’occupe de la musique.`
- Bouton : `▶ Écouter` / `■ Arrêter l’écoute`
- Indicateur : `Votre écoute est activée`
- Volume personnel : `Volume personnel`
- Aide volume : `Juste pour vous. Les autres gardent leur propre volume.`

### Détails audio

Section repliable : `Qualité et détails audio`

- `Lecture`
- `Tampon cible`
- `Réseau (aller-retour)`
- `Sortie audio estimée`
- `Débit de la source`
- `Coupures`
- Aide : `Le tampon s’adapte à votre Wi-Fi. Paquets anciens écartés / recalages : <n>.`
- Réglage enceinte : `Ajustement de cette enceinte : <n> ms`
- Aide : `En mode synchronisé, une valeur positive retarde cette enceinte. Ajustez si un léger écho subsiste entre appareils proches.`

### Messages

- `Lecture synchronisée avec l’hôte. Le délai commun de 150 ms aligne les appareils ; il ne correspond pas à un retard entre eux.`
- Bouton : `↻ Revenir au direct`
- Note : `Pour moins de décalage, privilégiez un casque filaire.`

## Notifications

Toast fixe en bas à droite, messages par exemple :

- `Adresse copiée. Partagez-la avec vos auditeurs.`
- `Diffusion démarrée`
- `Diffusion mise en pause`
- `Diffusion arrêtée`
- `Musique lancée sur l’horloge commune.`
- `Capture du son système activée.`
- `Onglet partagé avec écoute synchronisée.`

## Responsivité

- Mobile : en-tête et cartes s’adaptent, boutons peuvent occuper toute la largeur sous 380 px.
- Respect de `prefers-reduced-motion`.
- Scroll horizontal évité.

## Accessibilité

- Navigation et libellés textuels.
- `aria-current="page"` sur la page active.
- Cible clavier pour la copie d’adresse.
- Textes en français, simples et directs.

## Fichiers d’interface

- `public/host.html` : console hôte.
- `public/index.html` : page d’écoute.
- `public/home.html` : accueil.
- `public/settings.html` : repères réglages.
- `public/style.css` : thème et responsive.
- `public/ui.js` : notifications.
- `public/icons.svg` : icônes locales.
