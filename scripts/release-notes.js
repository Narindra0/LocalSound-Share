#!/usr/bin/env node
'use strict';

// Compose le corps de la Release publiée par .github/workflows/release.yml :
// la section du CHANGELOG correspondant à la version, puis la liste des
// livrables et la façon de vérifier les empreintes.

const fs = require('node:fs');
const path = require('node:path');

const version = (process.argv[2] || '').trim();
const output = process.argv[3];

if (!/^\d+\.\d+\.\d+$/.test(version) || !output) {
  console.error('Usage : node scripts/release-notes.js <version> <fichier-de-sortie>');
  process.exit(1);
}

const changelog = path.join(__dirname, '..', 'CHANGELOG.md');
const lines = fs.readFileSync(changelog, 'utf8').replace(/\r\n/g, '\n').split('\n');

function section(heading) {
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start < 0) return null;
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  const text = lines.slice(start + 1, end < 0 ? lines.length : end).join('\n').trim();
  return text === '' ? null : text;
}

const exact = section('## ' + version);
const pending = section('## À venir');
const changes = exact || pending;

if (!exact) {
  console.warn('CHANGELOG.md ne contient pas de section « ' + version + ' » ; reprise de « À venir ».');
}

const body = `${changes ? '## Nouveautés\n\n' + changes : '## Nouveautés\n\nConsulter CHANGELOG.md pour l’historique complet.'}

## Livrables ${version}

- \`LocalSound-Share-${version}-Windows-x64.exe\` — hôte Windows : ouvre le salon et partage l’audio.
- \`LocalSound-Auditeur-Leger-${version}-Windows-x64.exe\` — auditeur léger WebView2 (Runtime WebView2 et .NET Framework 4.6.2 requis).
- \`LocalSound-Auditeur-${version}-Windows-x64.exe\` — auditeur classique, moteur Electron embarqué.
- \`LocalSound-Mobile-${version}-arm64.apk\` et \`LocalSound-Mobile-${version}-arm32.apk\` — application Android (hôte micro ou musique, auditeur).
- \`SHA256SUMS.txt\` — empreintes SHA-256 des fichiers ci-dessus.

Les exécutables ne sont pas signés numériquement. Pour vérifier un téléchargement :

\`\`\`powershell
Get-FileHash -Algorithm SHA256 -LiteralPath .\\LocalSound-Share-${version}-Windows-x64.exe
\`\`\`
`;

fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
fs.writeFileSync(output, body);
console.log('Notes de version écrites dans ' + output);