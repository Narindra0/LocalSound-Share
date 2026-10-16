'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const yaml = require('js-yaml');
const root = path.resolve(__dirname, '..');
function git(args, options = {}) {
  const result = spawnSync('git', args, { cwd:root, encoding:'utf8', windowsHide:true, maxBuffer:8*1024*1024, ...options });
  if (result.error) throw new Error('Git est nécessaire : ' + result.error.message);
  return result;
}
function run(args, options) {
  const result = git(args, options);
  if (result.status !== 0) throw new Error(result.stderr.trim() || 'Échec de Git.');
  return result.stdout;
}
try {
  let prefix = [];
  const repository = git(['rev-parse', '--show-toplevel']);
  if (repository.status !== 0 || path.resolve(repository.stdout.trim()).toLowerCase() !== root.toLowerCase()) {
    // Audit a folder before git init without creating/staging a repository at its root.
    const metadata = path.join(root, 'artifacts', 'repository-audit.git');
    fs.mkdirSync(path.dirname(metadata), { recursive:true });
    run(['init', '--bare', '--quiet', '--initial-branch=main', metadata]);
    prefix = ['--git-dir=' + metadata, '--work-tree=' + root];
  }
  const execute = (args, options) => run([...prefix, ...args], options);
  const candidates = [...new Set(execute(['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean))];
  const errors = [];
  const required = [
    '.gitignore', '.gitattributes', '.editorconfig', '.nvmrc', 'README.md', 'LICENSE.txt',
    'package.json', 'package-lock.json', 'CONTRIBUTING.md', 'SECURITY.md', 'CHANGELOG.md',
    'docs/DEVELOPMENT.md', 'docs/PUBLISHING.md', 'docs/INSTALLER.md', '.github/workflows/ci.yml',
    'installer/LocalSound.iss', 'installer/payloads.json', 'scripts/build-setup.js',
    'server.js', 'opus-stream.js', 'desktop/main.js', 'desktop/listener-main.js',
    'desktop/lite/Launcher.cs', 'desktop/lite/ListenerForm.cs', 'desktop/lite/bridge.js',
    'scripts/build-lite.ps1', 'scripts/third-party-notices.js', 'scripts/check-repository.js',
    'public/client.js', 'public/opus-player.js', 'public/opus-decode-worker.js',
    'public/branding/logo.svg', 'public/branding/icon.ico', 'public/licenses/LGPL-3.0.txt',
    'public/licenses/GPL-3.0.txt', 'public/licenses/wasm-audio-decoders-MIT.txt', 'public/licenses/WebView2-SDK.txt', 'tests/fixtures/test-tone.wav'
  ];
  const selection = new Set(candidates);
  for (const file of required) if (!selection.has(file) || !fs.existsSync(path.join(root,file))) errors.push('Source nécessaire absente ou ignorée : ' + file);
  const ignored = ['node_modules/example.js', 'release/example.exe', 'artifacts/profile.json', 'data/appearance.json',
    '.env', '.env.production', 'certificate.pfx', 'private.pem', 'server.log', 'server.err',
    'recordings/session.wav', 'public/third-party.html', 'public/vendor/opus-decoder.min.js', 'public/licenses/chromium.html', 'public/licenses/lamejs-source.zip'];
  const ignoredResult = git([...prefix, 'check-ignore', '--no-index', '--stdin'], { input:ignored.join('\n') + '\n' });
  if (![0,1].includes(ignoredResult.status)) throw new Error(ignoredResult.stderr.trim());
  const ignoredSet = new Set(ignoredResult.stdout.trim().split(/\r?\n/));
  for (const file of ignored) if (!ignoredSet.has(file)) errors.push('Exclusion manquante : ' + file);
  const forbidden = /^(?:node_modules|release|artifacts|data|captures|recordings|coverage|dist|build|\.codex|\.agents)\/|(?:^|\/)\.env(?:\.|$)(?!.*\.example$)|(?:^|\/)\.npmrc$|\.(?:exe|dll|node|msi|msix|nupkg|asar|pdb|pfx|p12|pem|key|log|err)$/i;
  const generated = new Set(['public/third-party.html', 'public/vendor/opus-decoder.min.js', 'public/vendor/opus-decoder.min.js.map', 'public/licenses/chromium.html', 'public/licenses/lamejs-source.zip']);
  let bytes = 0;
  for (const file of candidates) {
    if (forbidden.test(file) || generated.has(file)) errors.push('Fichier local ou généré sélectionné : ' + file);
    const absolute = path.join(root,file);
    if (!fs.existsSync(absolute)) continue; // A staged deletion is allowed.
    const stat = fs.statSync(absolute); if (!stat.isFile()) continue;
    bytes += stat.size;
    if (stat.size > 50*1024*1024) errors.push('Fichier de plus de 50 Mio à sortir des sources : ' + file);
    if (stat.size <= 1024*1024 && !file.startsWith('public/branding/')) {
      const content = fs.readFileSync(absolute);
      if (!content.includes(0)) {
        const text = content.toString('utf8');
        if (/-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/.test(text) || /\b(?:ghp|github_pat)_[A-Za-z0-9_]{30,}\b/.test(text)) errors.push('Marqueur de secret à examiner : ' + file);
      }
    }
    if (/\.ya?ml$/i.test(file)) {
      try {
        const document = yaml.load(fs.readFileSync(absolute,'utf8'), { filename:file });
        if (file.startsWith('.github/workflows/') && (!document?.on || !document.jobs || typeof document.jobs !== 'object')) errors.push('Structure de workflow invalide : ' + file);
      } catch (error) { errors.push('YAML invalide : ' + error.message); }
    }
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'),'utf8'));
  if (pkg.version !== lock.version || pkg.version !== lock.packages[''].version) errors.push('Versions package.json / package-lock.json incohérentes.');
  if (pkg.private !== true) errors.push('Le projet doit rester privé pour la publication npm.');
  if (errors.length) { for (const error of errors) console.error('- ' + error); process.exitCode = 1; }
  else console.log('Dépôt prêt : ' + candidates.length + ' fichiers candidats, ' + (bytes/1024/1024).toFixed(2) + ' Mio ; sources, exclusions Git, versions et YAML vérifiés. Aucun marqueur de secret reconnu.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
