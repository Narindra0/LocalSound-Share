![LocalSound Share — Le salon sonore](public/branding/logo.svg)

# LocalSound Share

Partagez la musique d’un PC Windows avec les appareils du même réseau local. L’hôte choisit la source ; chaque auditeur règle son volume, son style et son mini-lecteur.

**Version actuelle : 0.1.5** · Projet personnel gratuit · Créé à Madagascar par **Ranjalahy Narindra**.

## Fonctionnalités

- YouTube dans un navigateur intégré, fichiers musicaux, partage d’onglet et capture du son système Windows.
- Lecture synchronisée pour les fichiers et les onglets ; partage synchronisé automatique à l’ouverture de YouTube intégré.
- Audio Opus stéréo 48 kHz : haute qualité 192 kbit/s par défaut, modes 128 et 96 kbit/s, et option PCM sans compression.
- Volume et pause individuels, correction d’alignement, reconnexion et mini-lecteur fixe au premier plan dans les applications Windows.
- Thèmes vinyle, K7, CD, bandes, MP3 et radio ; palettes personnelles et ambiance du salon.
- Titre, artiste, pochette, demandes de morceaux, adresse de connexion et QR code.
- Interface desktop et mobile, page À propos, CGU, confidentialité et licences intégrées.

## Choisir une édition Windows

**Installation guidée :** téléchargez `LocalSound-Setup-0.1.5-Windows-x64.exe` dans les [Releases](https://github.com/Narindra0/LocalSound-Share/releases/latest). Ce petit setup en ligne d’environ **2,28 Mo** présente les conditions et permet de choisir Hôte, Auditeur Léger, Auditeur classique ou plusieurs éditions. Il crée les raccourcis et une entrée de désinstallation Windows, sans demander les droits administrateur. Internet est nécessaire pour télécharger les éditions choisies. Les EXE portables restent disponibles séparément.

| Édition | Usage | Taille indicative de l’EXE 0.1.5 |
| --- | --- | ---: |
| Hôte | Diffuser et utiliser le navigateur YouTube intégré | 99 Mo |
| Auditeur Léger | Écouter avec le Runtime WebView2 partagé de Windows | 6,53 Mo |
| Auditeur classique | Écouter avec le moteur Electron embarqué | 96,5 Mo |
| Navigateur | Écouter depuis l’adresse du salon, sur ordinateur ou mobile | Aucun EXE |

[Télécharger les applications dans Releases](https://github.com/Narindra0/LocalSound-Share/releases/latest). Le lecteur léger demande un hôte **0.1.5 ou ultérieur**. Il utilise .NET Framework 4.6.2 ou ultérieur et le Runtime Microsoft WebView2 ; si ce dernier manque, il propose la page officielle d’installation. Le moteur partagé et les données locales ne sont pas compris dans la taille de l’EXE.

Les applications Windows distribuées ne nécessitent pas d’installation de Node.js. Les exécutables actuels ne sont pas signés numériquement.

## Écouter ensemble

1. Ouvrir l’application **Hôte** sur un PC Windows 10 x64 (2004 ou ultérieur) ou Windows 11.
2. Dans **Choisir une source**, sélectionner YouTube intégré, un fichier ou un onglet pour une écoute synchronisée. Le partage d’un onglet externe se fait depuis la console web dans Chrome/Edge sur localhost.
3. Communiquer l’adresse réseau affichée dans **Partage et sortie** aux appareils connectés au même Wi-Fi ou réseau Ethernet.
4. Ouvrir cette adresse dans leur navigateur, ou la saisir dans l’application Auditeur, puis cliquer sur **Écouter**.

L’hôte commande Démarrer, Pause et Arrêter. Chaque auditeur dispose de son propre volume et de sa pause locale. La préférence d’écoute automatique de l’hôte est respectée ; **Écouter sur ce PC** active son retour synchronisé.

### Synchronisation et limites

Le délai commun est de **150 ms** par défaut, réglable à 100 ou 250 ms. Les appareils suivent des échéances communes ; un paquet trop tardif n’est pas rejoué avec un retard supplémentaire. Dans **Partage et sortie**, augmenter **Aligner le son de ce PC** retarde le retour synchronisé de l’hôte. Les auditeurs disposent aussi d’un ajustement de leur enceinte.

**Le son système brut reste direct.** Windows joue la source avant sa capture : LocalSound ne peut pas retarder ce son déjà produit sans routage vers une sortie séparée. Pour des enceintes proches, privilégier YouTube intégré, un fichier ou un onglet synchronisé. La précision acoustique dépend du matériel, du navigateur, du réseau et de la position des enceintes ; le Bluetooth peut ajouter du délai.

Les fichiers sont limités à **30 Mo et 10 minutes**. Les formats lisibles dépendent du décodeur du navigateur. Le PCM décodé est gardé en mémoire sur l’hôte jusqu’à son remplacement ou à l’arrêt du serveur.

### Qualité audio et réseau

| Mode | Audio | Débit par auditeur avec en-têtes LocalSound* |
| --- | ---: | ---: |
| Haute qualité, défaut | Opus 192 kbit/s | 208 kbit/s |
| Standard | Opus 128 kbit/s | 144 kbit/s |
| Économique | Opus 96 kbit/s | 112 kbit/s |
| Qualité originale | PCM stéréo 48 kHz / 16 bits | Plus de 1 536 kbit/s |

*Hors surcoûts WebSocket, TCP et Wi-Fi. YouTube et les pochettes ont leur propre trafic.*

Opus utilise une compression avec pertes. Le mode PCM conserve le signal original. Aucune baisse automatique de qualité n’est appliquée ; les lecteurs incompatibles ou anciens continuent en PCM. La haute qualité réduit le trafic audio d’environ **86 %** par rapport au PCM brut.

## Lancer depuis les sources

Prérequis : **Windows x64**, **Git** et **Node.js 24** (version utilisée en CI ; minimum desktop 22.12). Une connexion Internet est nécessaire pour installer les dépendances et accéder à YouTube. Le partage de fichiers et la lecture sur le réseau local ne nécessitent pas de service cloud LocalSound.

Depuis le dossier du projet :

~~~powershell
npm ci
npm run setup:desktop
npm run notices
npm run desktop
~~~

Autres commandes :

~~~powershell
npm run desktop:listener   # Auditeur classique
npm start                  # Serveur et console web
npm test                   # Tests automatisés
npm run check:repo         # Vérifier les fichiers destinés à GitHub
~~~

Avec le serveur seul, ouvrir [localhost:3000/host](http://localhost:3000/host) sur le PC hôte. Pour choisir un autre port en PowerShell :

~~~powershell
$env:PORT = '3001'
npm start
~~~

**npm run setup:desktop** télécharge le moteur Electron de la version verrouillée, une étape explicite sur un nouveau clone. Les fichiers générés par **npm run notices** sont nécessaires à la lecture Opus et aux pages de licences ; ils ne sont pas versionnés.

## Compiler les exécutables

~~~powershell
npm run build:exe             # Hôte Electron
npm run build:listener        # Auditeur classique Electron
npm run build:listener:lite   # Auditeur Léger WebView2
npm run build:setup           # Setup en ligne, avec Inno Setup
~~~

Les résultats sont écrits dans **release/**, dossier ignoré par Git. La compilation légère télécharge le SDK officiel WebView2 épinglé à la version 1.0.4258.31 et utilise le compilateur .NET Framework de Windows. Voir [Développement et compilation](docs/DEVELOPMENT.md) et [Publication sur GitHub](docs/PUBLISHING.md).

## Dépannage

- **Salon inaccessible :** vérifier l’adresse affichée par l’hôte, le réseau commun et le pare-feu Windows sur le réseau privé. Les réseaux invités peuvent isoler les appareils.
- **Port 3000 occupé :** fermer un ancien serveur si nécessaire, ou utiliser un autre port. L’application desktop conserve un ancien serveur et démarre sur un port libre si sa version ne correspond pas ; utiliser sa nouvelle adresse affichée.
- **Écho avec Windows :** passer du son système direct à YouTube intégré, un onglet ou un fichier synchronisé.
- **Pas de son local :** vérifier Écouter sur ce PC, les volumes et la sortie audio Windows. Après un changement de sortie système, arrêter puis relancer le partage.
- **WebView2 absent :** suivre la page Microsoft proposée par le lecteur léger ou utiliser l’auditeur classique.

## Documentation

- [Développement, architecture et tests](docs/DEVELOPMENT.md)
- [Organisation et exécution des tests](tests/README.md)
- [Installateur Windows et compilation du setup](docs/INSTALLER.md)
- [Préparer le dépôt et publier une version](docs/PUBLISHING.md)
- [Historique des versions](CHANGELOG.md)
- [Contribuer](CONTRIBUTING.md)
- [Signaler une vulnérabilité](SECURITY.md)

La CI Windows installe les dépendances verrouillées, régénère les ressources, contrôle le contenu du dépôt et lance les tests automatisés. Les tests navigateur, desktop et les essais sur plusieurs appareils complètent ces vérifications.

## Réseau et confidentialité

LocalSound est prévu pour un **réseau local de confiance**. Aucune authentification d’auditeur n’est fournie : tout appareil pouvant atteindre le salon peut le rejoindre. Ne pas rediriger son port vers Internet. Les commandes de diffusion sont réservées aux accès locaux du PC hôte.

Le créateur ne reçoit pas automatiquement l’audio des sessions. YouTube peut contacter les services Google et conserve sa propre politique de confidentialité. Les CGU, les données traitées et les emplacements de stockage sont décrits dans [public/about.html](public/about.html) et accessibles dans l’application.

## Créateur et licence

**Ranjalahy Narindra** · Madagascar · Projet personnel gratuit.

- Courriel : [ranjalahy.narindraa@gmail.com](mailto:ranjalahy.narindraa@gmail.com)
- Téléphone : 0328814081
- Portfolio : [narindraportfolio.netlify.app](https://narindraportfolio.netlify.app/)

Les conditions d’utilisation du projet sont définies dans [LICENSE.txt](LICENSE.txt). Les composants tiers conservent leurs propres licences ; les notices et les sources correspondantes sont préparées par **npm run notices**. LocalSound n’est pas affilié à YouTube, Google ou Microsoft.
