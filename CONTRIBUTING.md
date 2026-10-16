# Contribuer à LocalSound Share

Merci de décrire le problème ou l’amélioration avant une modification importante. Le projet est personnel, gratuit et développé à Madagascar par Ranjalahy Narindra. Les conditions de [LICENSE.txt](LICENSE.txt) s’appliquent ; les composants tiers conservent leurs licences.

## Préparer l’environnement

Sur Windows 10 x64 (2004 ou ultérieur) ou Windows 11, avec Node.js 24 et Git :

```powershell
npm ci
npm run setup:desktop
npm run notices
npm test
npm run desktop
```

La [documentation de développement](docs/DEVELOPMENT.md) présente les dossiers, les tests navigateur et la compilation des trois éditions Windows.

## Proposer une modification

1. Créer une branche à partir de la version actuelle.
2. Limiter la modification au problème annoncé et respecter le style du fichier existant.
3. Exécuter les vérifications adaptées : `npm test`, tests d’interface ou tests Windows selon le changement.
4. Pour une modification audio, vérifier les canaux stéréo, la pause locale, les échéances de lecture et la compatibilité PCM. Une modification du codec doit aussi être vérifiée au débit réel.
5. Décrire dans la pull request le comportement corrigé, les vérifications effectuées et les limites restantes.

Les tests de capture réelle peuvent lire le son du PC. Les lancer volontairement dans une session de test. Les tests navigateur et desktop créent leurs profils sous `artifacts/`.

## Fichiers du dépôt

Conserver les sources, `package-lock.json`, les configurations, les licences statiques et les fichiers de marque sous `public/branding/`.

Les dépendances, SDK téléchargés, profils, préférences, journaux, fichiers musicaux et exécutables sont ignorés. `tests/fixtures/test-tone.wav` est une exception volontaire : c’est le signal synthétique utilisé par `tests/manual/capture.js`. Les fichiers produits par `npm run notices` sont régénérés après installation.

Avant une contribution ou une publication :

```powershell
npm run check:repo
git diff --check
git diff --cached --stat
```

## Signaler un problème

Utiliser le modèle de rapport de bug pour les problèmes ordinaires, en précisant la version, l’édition, la source audio, le type de sortie et les étapes de reproduction. Pour une vulnérabilité, suivre [SECURITY.md](SECURITY.md).
