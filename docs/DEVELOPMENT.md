# Développement et compilation

## Environnement

- Windows 10 x64 version 2004 ou ultérieure, ou Windows 11, avec une sortie audio active.
- Node.js 24, version indiquée dans `.nvmrc`. Le lancement desktop demande au minimum Node.js 22.12.
- Git ; accès Internet pour l’installation initiale des dépendances et des SDK.
- Pour l’édition légère : compilateur .NET Framework de Windows et Runtime WebView2 pour l’exécution.

```powershell
npm ci
npm run setup:desktop
npm run notices
npm test
```

`npm ci` suit `package-lock.json`. Avec Electron 44, `npm run setup:desktop` lance explicitement l’installeur de ce paquet pour télécharger son moteur ; cette étape est nécessaire sur un nouveau clone. `npm run notices` copie ensuite le décodeur Opus, prépare les notices et les licences Chromium, et fournit l’archive des sources de lamejs. Ces sorties sont ignorées par Git. Les fichiers statiques sous `public/licenses/` et les éléments de `public/branding/` doivent être présents dans le dépôt.

## Organisation

| Emplacement | Rôle |
| --- | --- |
| `server.js` | API locale, sources audio, commandes et distribution WebSocket |
| `opus-stream.js` | Encodage Opus partagé dans un worker Node |
| `media-info.js`, `scripts/media-info.ps1` | Métadonnées du lecteur Windows |
| `file-info.js`, `artwork.js`, `youtube-info.js` | Métadonnées et pochettes |
| `public/` | Interfaces hôte/auditeur, synchronisation, décodeur, thèmes et pages légales |
| `desktop/` | Applications Electron, navigateur YouTube, mini-fenêtres et relais auditeur |
| `desktop/lite/` | Application WinForms/WebView2 légère et son pont limité |
| `scripts/` | Lancement, notices, préparation et compilation |
| `tests/node/` | Tests automatisés Node : API, signal audio et horloges |
| `tests/e2e/` | Essais navigateur et applications Windows |
| `tests/helpers/`, `tests/fixtures/` | Simulations et données synthétiques partagées |
| `tests/manual/` | Diagnostics volontaires de capture et de connexion |
| `docs/design/` | Références et maquette initiales |
| `artifacts/` | Profils de test, SDK téléchargés, captures et paquets intermédiaires ; ignoré |
| `release/` | Exécutables et livrables ; ignoré |
| `data/` | Préférences de session en développement ; ignoré |

Les anciennes références de conception sont regroupées dans [design/](design/README.md). Le README principal décrit le fonctionnement actuel.

## Lancer

```powershell
npm run desktop
npm run desktop:listener
```

Pour la console web seule :

```powershell
npm start
```

Ouvrir `http://localhost:3000/host`. Les auditeurs utilisent l’adresse réseau affichée et le chemin `/listen`. Si un port différent est choisi, reprendre l’adresse affichée par cette instance.

## Tests automatisés

```powershell
npm test
npm run check:repo
```

Voir le [guide des tests](../tests/README.md) pour les prérequis et les diagnostics manuels. Les commandes se lancent depuis la racine du projet.

Les tests Node couvrent notamment les API, les droits des commandes, les requêtes de morceaux, les canaux stéréo, la qualité numérique Opus, les débits, la compatibilité PCM, les files d’attente et les horloges. Les captures système sont simulées dans les tests d’API.

### Tests navigateur et Windows

Les scripts correspondants utilisent Playwright et Microsoft Edge. Pour un essai local sans modifier les dépendances verrouillées du projet :

```powershell
npm install --prefix artifacts/test-tools --no-package-lock --no-audit --no-fund playwright
$env:PLAYWRIGHT_MODULE = (Join-Path $PWD 'artifacts/test-tools/node_modules/playwright')
node tests/e2e/legal-browser.js
node tests/e2e/opus-browser.js
node tests/e2e/desktop-browser.js
node tests/e2e/listener-browser.js
```

Ces scripts créent leurs profils sous `artifacts/` et ferment les serveurs qu’ils démarrent. Le test Opus navigateur contacte l’adresse LAN du PC. Le test desktop remplace le contenu du site YouTube par une page de test, tout en utilisant les véritables vues et la capture audio Electron. Les essais de capture réelle sont à exécuter volontairement : ils peuvent utiliser la sortie audio du PC.

Après compilation :

```powershell
node tests/e2e/packaged-browser.js
node tests/e2e/portable-browser.js
node tests/e2e/portable-listener.js
node tests/e2e/lite-browser.js
```

Le lecteur léger doit être compilé avant `tests/e2e/lite-browser.js`, et WebView2 doit être disponible. Les simulations et tests de planification ne remplacent pas une écoute sur plusieurs appareils et une mesure acoustique si un alignement précis est requis.

## Compiler sous Windows

```powershell
npm run build:exe
npm run build:listener
npm run build:listener:lite
```

| Commande | Résultat pour la version 0.1.5 |
| --- | --- |
| `build:exe` | `release/LocalSound-Share-0.1.5-Windows-x64.exe` |
| `build:listener` | `release/auditeur/LocalSound-Auditeur-0.1.5-Windows-x64.exe` |
| `build:listener:lite` | `release/auditeur-leger/LocalSound-Auditeur-Leger-0.1.5-Windows-x64.exe` |

Les scripts régénèrent les notices. La compilation légère télécharge le SDK Microsoft WebView2 1.0.4258.31 depuis NuGet dans `artifacts/webview2-sdk/`, puis utilise `csc.exe` de .NET Framework. Ce SDK ne remplace pas le Runtime WebView2 partagé nécessaire sur le PC auditeur. Le paquet Electron embarque son propre moteur et conserve les langues française et anglaise.

Les clés et certificats de signature ne doivent pas être placés dans Git. Les compilations actuelles sont distribuées sans signature numérique. Le résultat compilé inclut les ressources générées et les notices, même si elles sont ignorées dans le dépôt des sources.

## Paramètres de développement

| Variable | Utilisation |
| --- | --- |
| `PORT` | Port du serveur hôte ; 3000 par défaut |
| `PLAYWRIGHT_MODULE` | Chemin d’un module Playwright installé pour les tests facultatifs |
| `LOCALSOUND_DESKTOP_TEST` | Mode de test desktop, utilisé par les scripts automatisés |
| `LOCALSOUND_DESKTOP_PROFILE` | Profil Electron isolé pour les tests |
| `LOCALSOUND_LISTENER_PORT` | Port du relais local de l’auditeur classique ; 3011 par défaut |
| `LOCALSOUND_LITE_PROFILE` | Dossier isolé du lecteur WebView2 pour les tests |
| `LOCALSOUND_LITE_TEST_PORT` | Débogage CDP local réservé au test du lecteur léger |

Aucun fichier `.env` n’est chargé automatiquement : les variables sont lues depuis l’environnement du processus. Ne pas activer les options de test ou de débogage dans une distribution normale.
