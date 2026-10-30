# Mettre LocalSound sur GitHub

## 1. Vérifier les sources

Depuis le dossier du projet :

```powershell
npm ci
npm run setup:desktop
npm run notices
npm run check:repo
npm test
```

Le contrôle du dépôt vérifie les exclusions Git, les fichiers nécessaires, la taille des candidats et les erreurs de syntaxe des workflows. Il complète la revue manuelle des fichiers ; il ne constitue pas un détecteur exhaustif de secrets.

Les sources, la documentation, les icônes, les licences statiques et `package-lock.json` doivent être conservés. Les dossiers `node_modules/`, `release/`, `artifacts/`, `data/` et les ressources régénérées sont ignorés. Ne pas ajouter ces dossiers avec `git add -f`.

## 2. Créer le dépôt local

Si le dossier n’est pas encore un dépôt Git :

```powershell
git init -b main
```

Vérifier l’identité Git et la définir localement si nécessaire. Utiliser une adresse de contribution publique ou l’adresse privée de contribution fournie par GitHub selon votre préférence.

```powershell
git config user.name "Ranjalahy Narindra"
git config user.email "VOTRE_ADRESSE_DE_CONTRIBUTION"
git add --dry-run .
git add .
git diff --cached --stat
git diff --cached --check
git commit -m "Prepare LocalSound Share 0.1.5 for GitHub"
```

La commande `git add --dry-run .` permet d’examiner la sélection avant la mise en index réelle. Ne pas inclure de données personnelles de test, fichiers musicaux, cookies, identifiants ou certificats.

## 3. Créer le dépôt distant

Sur GitHub, créer un dépôt vide, par exemple `localsound-share`, avec la visibilité souhaitée. Ne pas générer un autre README, `.gitignore` ou fichier de licence à cette étape : ils sont déjà présents dans les sources.

Le dépôt de ce projet est `Narindra0/LocalSound-Share`. Pour publier une copie sous un autre compte, adapter l’URL suivante :

```powershell
git remote add origin https://github.com/Narindra0/LocalSound-Share.git
git remote -v
git push -u origin main
```

Une authentification GitHub doit être configurée pour l’envoi. Si `origin` existe déjà, vérifier `git remote -v` avant toute modification. Si le dépôt distant contient déjà des commits, examiner et intégrer son historique avant de pousser ; ces étapes visent un dépôt distant vide.

Voir la [documentation officielle GitHub](https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github).

## 4. Publier une version

Les exécutables et les SDK ne font pas partie de l’historique des sources. Une GitHub Release permet de joindre les fichiers compilés et leurs instructions séparément du code.

### Publication automatique

Le workflow [release.yml](../.github/workflows/release.yml) construit et publie la Release dès qu’un tag `v*` est poussé : contrôles du dépôt, tests Node, les trois EXE Windows (`build:exe`, `build:listener`, `build:listener:lite`), tests et APK Android, puis `SHA256SUMS.txt`. Le corps de la Release reprend la section correspondante de [CHANGELOG.md](../CHANGELOG.md) ; le workflow échoue si `package.json` et le tag ne portent pas la même version.

```powershell
# 1. Mettre la même version dans package.json et dans CHANGELOG.md
# 2. Committer, taguer, pousser
git tag -a v0.1.6 -m "LocalSound Share 0.1.6"
git push origin main
git push origin v0.1.6
```

Le workflow peut aussi être relancé à la main (onglet Actions → « Publier une version » → Run workflow) : il relit la version dans `package.json` et réécrit la Release du tag correspondant. Le setup en ligne reste hors du workflow : il se compile après publication et vérification des EXE (voir [INSTALLER.md](INSTALLER.md)).

### Publication manuelle, en secours

1. Compiler les éditions nécessaires selon [DEVELOPMENT.md](DEVELOPMENT.md).
2. Vérifier la version de `package.json`, le changelog et les pages À propos. Si la version change, reconstruire toutes les éditions à distribuer.
3. Exécuter les tests des véritables paquets et les essais audio adaptés.
4. Créer un tag correspondant au commit vérifié :

   ```powershell
   git tag -a v0.1.5 -m "LocalSound Share 0.1.5"
   git push origin v0.1.5
   ```

5. En secours seulement : créer la Release à la main depuis ce tag, en reprenant les changements de [CHANGELOG.md](../CHANGELOG.md).
6. Joindre les exécutables souhaités, un fichier d’instructions et leurs empreintes SHA-256. Pour 0.1.5 :

   - `release/LocalSound-Share-0.1.5-Windows-x64.exe`
   - `release/auditeur-leger/LocalSound-Auditeur-Leger-0.1.5-Windows-x64.exe`
   - `release/auditeur/LocalSound-Auditeur-0.1.5-Windows-x64.exe`, comme alternative classique

Pour calculer une empreinte en PowerShell :

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath release/LocalSound-Share-0.1.5-Windows-x64.exe
```

Mentionner dans les instructions : Windows x64, absence de signature numérique, besoin éventuel de WebView2 pour le lecteur léger, hôte minimum 0.1.5 et limite de synchronisation du son système brut. Le Runtime partagé et les caches ne sont pas compris dans le poids de l’EXE léger.

Le workflow `ci.yml` exécute les contrôles et les tests à chaque envoi ; `release.yml` publie la Release. Consulter également la [documentation officielle des Releases](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository).

Le [setup en ligne](INSTALLER.md) se compile après publication et vérification des EXE auxquels son manifeste fait référence. Joindre son EXE, son fichier `.sha256` et ses instructions à la release. Le tag `setup-v0.1.5` identifie les sources de cet assistant ; les EXE des applications restent ceux du tag `v0.1.5`.

## Présentation du dépôt

Description suggérée : « Partage audio local synchronisé pour Windows, avec YouTube intégré, lecteurs personnalisables et auditeur léger WebView2. »

Sujets possibles : `audio`, `windows`, `electron`, `webview2`, `opus`, `local-network`.

La licence actuelle de [LICENSE.txt](../LICENSE.txt) est conservée. La visibilité publique des sources ne remplace pas les autorisations de ce fichier ; les licences tierces restent applicables à leurs composants.
