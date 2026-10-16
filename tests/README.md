# Tests et diagnostics

Lancer les commandes depuis la racine du projet, après l’installation décrite dans [DEVELOPMENT.md](../docs/DEVELOPMENT.md).

| Dossier | Contenu | Exécution |
| --- | --- | --- |
| `node/` | Tests automatisés des API, de l’audio, des horloges et des règles desktop | `npm test`, également exécuté en CI |
| `e2e/` | Scénarios navigateur, Electron, WebView2 et exécutables compilés | Scripts individuels, avec Playwright et les prérequis Windows |
| `helpers/` | Contexte audio simulé et générateur de métadonnées/pochettes | Importés par les tests |
| `fixtures/` | Signal WAV synthétique pour le diagnostic de capture | Utilisé par `manual/capture.js` |
| `manual/` | Diagnostics locaux volontaires | Commandes ci-dessous |

## Vérifications automatisées

```powershell
npm test
npm run check:repo
```

Les tests Node simulent la capture système et démarrent leurs propres serveurs. Ils ne nécessitent pas un salon existant ni de vrais fichiers musicaux.

## Interface et exécutables

Les prérequis Playwright, Edge, Electron et WebView2, ainsi que les commandes de compilation, sont détaillés dans le [guide de développement](../docs/DEVELOPMENT.md#tests-navigateur-et-windows).

Exemples :

```powershell
node tests/e2e/legal-browser.js
node tests/e2e/opus-browser.js
node tests/e2e/desktop-browser.js
node tests/e2e/listener-browser.js
```

Après compilation des éditions correspondantes :

```powershell
node tests/e2e/portable-browser.js
node tests/e2e/portable-listener.js
node tests/e2e/lite-browser.js
node tests/e2e/setup-install.js
```

Les profils, captures et fichiers produits vont dans `artifacts/`, ignoré par Git. `desktop-live-browser.js` contacte réellement YouTube ; les autres scénarios peuvent simuler le contenu ou les sources selon le test. Les essais de capture réelle peuvent utiliser la sortie audio du PC.

## Diagnostics manuels

Le [test du setup](../docs/INSTALLER.md#vérifier) télécharge les véritables applications et vérifie installation, ajout d’éditions et désinstallation dans un dossier de test. Il ne se lance pas en CI.

```powershell
node tests/manual/mp3.js      # Vérifie l’encodeur MP3
node tests/manual/capture.js  # Joue un signal puis vérifie la capture WASAPI
node tests/manual/client.js   # Vérifie un salon déjà actif sur localhost:3000
```

Le diagnostic client attend une diffusion en cours. La capture demande Windows et une sortie audio active. Ces scripts ne font pas partie de `npm test` et ne sont pas lancés en CI.
