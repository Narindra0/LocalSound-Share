# Installateur Windows

Le setup en ligne installe les applications portables déjà publiées dans la release 0.1.5. Il pèse environ 2,28 Mo et télécharge uniquement les éditions choisies.

## Parcours utilisateur

1. Accueil LocalSound, nom du créateur et présentation.
2. Conditions, confidentialité et mentions légales, reprises de la page À propos. L’installation interactive demande leur acceptation.
3. Informations sur les éditions et prérequis.
4. Dossier d’installation, éditions à installer et raccourcis.
5. Téléchargement avec progression et contrôle SHA-256, puis installation.
6. Ouverture facultative des applications choisies. Si WebView2 manque, une option permet d’ouvrir la page Microsoft.

Le profil Auditeur Léger est proposé par défaut. Le profil Personnaliser permet d’installer plusieurs éditions. Au moins une édition doit être sélectionnée.

L’installation est limitée au compte Windows courant, sans demande d’élévation, sous `%LOCALAPPDATA%\Programs\LocalSound Share` par défaut. Elle ajoute une entrée dans les applications installées de Windows et des raccourcis dans le menu Démarrer ; les raccourcis du Bureau sont facultatifs. Aucun démarrage automatique, règle de pare-feu ou pilote n’est ajouté.

Le setup ne contient pas les moteurs Electron ou WebView2. Il nécessite Internet ; le poids final dépend des éditions installées et des caches. Le lecteur léger nécessite .NET Framework 4.6.2+ et WebView2, les éditions Electron ont leur propre moteur. Les exécutables et le setup ne sont pas signés numériquement.

Relancer le setup permet d’ajouter une édition. Décocher une édition déjà installée ne la supprime pas : utiliser la désinstallation Windows pour retirer l’ensemble. Les préférences et données de navigation dans les dossiers utilisateur restent conservées, ainsi que les fichiers étrangers au programme.

## Compiler

Installer [Inno Setup](https://jrsoftware.org/isdl.php), version 6.7.3 ou ultérieure. Son utilisation personnelle non commerciale est gratuite ; respecter ses propres conditions. Le compilateur et ses téléchargements ne doivent pas être ajoutés au dépôt.

```powershell
npm ci
$env:ISCC_PATH = 'C:\Program Files (x86)\Inno Setup 6\ISCC.exe'
npm run build:setup
```

Le script détecte aussi les emplacements habituels d’Inno Setup et `artifacts/inno-setup/ISCC.exe`. La compilation du setup ne nécessite pas de reconstruire les applications : les EXE doivent déjà être publiés aux adresses du manifeste.

Sorties ignorées par Git :

- `artifacts/setup/` : script généré, conditions en texte et illustrations BMP.
- `release/setup/LocalSound-Setup-0.1.5-Windows-x64.exe`
- `release/setup/LocalSound-Setup-0.1.5-Windows-x64.exe.sha256`

Le manifeste [installer/payloads.json](../installer/payloads.json) épingle la version, les noms, tailles et empreintes des trois EXE. Lors d’une nouvelle version, publier et vérifier les applications, puis actualiser ce manifeste avant de compiler et de publier le setup. Le manifeste porte la version de la release qu’il installe : le nom du setup et sa version affichée en découlent, et il n’est pas tenu de suivre `package.json`, qui peut déjà préparer la version suivante. Une empreinte ne doit pas être récupérée dynamiquement pendant l’installation : elle est embarquée dans le setup. Le téléchargement HTTPS ou la vérification échoués interrompent la préparation avant la copie des applications.

Le texte des conditions est généré depuis `LICENSE.txt` et les sections CGU, confidentialité et mentions légales de `public/about.html`, pour éviter une seconde version éditée à la main.

## Vérifier

```powershell
npm test
npm run check:repo
node tests/e2e/setup-install.js
```

Le dernier test est volontaire, réservé à Windows. Il télécharge les véritables EXE, installe le lecteur léger dans un dossier isolé, ajoute les autres éditions, contrôle les empreintes et raccourcis puis désinstalle l’ensemble. Il s’interrompt si une installation normale existe déjà afin de la préserver. Les téléchargements représentent environ 209 Mo. Les journaux et fichiers de test sont sous `artifacts/` ; aucune application n’est ouverte à la fin du test silencieux.

Avant publication, vérifier également le parcours interactif et le refus des conditions sur un PC Windows de test. Les paramètres silencieux standards d’Inno Setup sont destinés aux déploiements administrés et sautent les pages interactives ; l’acceptation des conditions relève alors du responsable du déploiement.
