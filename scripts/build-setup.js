'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const pkg = require('../package.json');
const manifest = require('../installer/payloads.json');
const stage = path.join(root, 'artifacts', 'setup');
const output = path.join(root, 'release', 'setup');

function validateManifest(data) {
  if (data.version !== pkg.version || data.baseUrl !== `https://github.com/Narindra0/LocalSound-Share/releases/download/v${pkg.version}/`) throw new Error('Version ou adresse des téléchargements incohérente.');
  if (data.editions?.length !== 3 || new Set(data.editions.map(e => e.id)).size !== 3) throw new Error('Les trois éditions sont nécessaires.');
  for (const edition of data.editions) {
    if (!['host', 'lite', 'classic'].includes(edition.id) || !/^[a-zA-Z0-9.-]+\.exe$/.test(edition.file) || !/^[a-zA-Z0-9 .-]+\.exe$/.test(edition.installedName) || !/^[a-f0-9]{64}$/.test(edition.sha256) || !Number.isSafeInteger(edition.bytes) || edition.bytes <= 0) throw new Error('Édition invalide : ' + edition.id);
    if (!edition.file.includes(`-${pkg.version}-Windows-x64.exe`)) throw new Error('Version de fichier incohérente.');
  }
}

function sectionText(html, id) {
  const section = html.match(new RegExp('<section\\b[^>]*\\bid="' + id + '"[^>]*>([\\s\\S]*?)</section>'))?.[1];
  if (!section) throw new Error('Section légale absente : ' + id);
  return section.replace(/<a\b[^>]*href="(https:[^"]+)"[^>]*>([\s\S]*?)<\/a>/g, '$2 ($1)')
    .replace(/<\/(?:h[1-6]|p|dd|dt|address)>|<br\s*\/?\s*>/g, '\n\n')
    .replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#(?:39|x27);/g, "'").replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Code-native bitmap illustration, so no extra graphics runtime is needed to build.
function bitmap(file, width, height, small = false) {
  const stride = (width * 3 + 3) & ~3;
  const buffer = Buffer.alloc(54 + stride * height);
  buffer.write('BM'); buffer.writeUInt32LE(buffer.length, 2); buffer.writeUInt32LE(54, 10);
  buffer.writeUInt32LE(40, 14); buffer.writeInt32LE(width, 18); buffer.writeInt32LE(height, 22);
  buffer.writeUInt16LE(1, 26); buffer.writeUInt16LE(24, 28); buffer.writeUInt32LE(stride * height, 34);
  const cx = width / 2, cy = small ? height / 2 : height * 0.44, radius = width * 0.41;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const distance = Math.hypot(x - cx, y - cy);
    let color = [239, 228, 208];
    if (distance < radius) color = Math.floor(distance / 4) % 2 ? [34, 37, 34] : [45, 48, 43];
    if (distance < radius * 0.36) color = [178, 76, 49];
    if (distance < radius * 0.06) color = [239, 228, 208];
    if (!small && y > height * 0.8 && y < height * 0.81 && x > width * 0.2 && x < width * 0.8) color = [178, 76, 49];
    const offset = 54 + (height - y - 1) * stride + x * 3;
    buffer[offset] = color[2]; buffer[offset + 1] = color[1]; buffer[offset + 2] = color[0];
  }
  fs.writeFileSync(file, buffer);
}

function prepare() {
  validateManifest(manifest);
  fs.mkdirSync(stage, { recursive: true }); fs.mkdirSync(output, { recursive: true });
  const html = fs.readFileSync(path.join(root, 'public/about.html'), 'utf8');
  const legal = fs.readFileSync(path.join(root, 'LICENSE.txt'), 'utf8').trim() + '\n\n' + ['cgu', 'confidentialite', 'mentions'].map(id => sectionText(html, id)).join('\n\n');
  fs.writeFileSync(path.join(stage, 'conditions.txt'), '\ufeff' + legal);
  fs.writeFileSync(path.join(stage, 'welcome.txt'), '\ufeff' + [
    'LocalSound Share — Le salon sonore',
    'Imaginé et développé par Ranjalahy Narindra. Projet personnel gratuit — Madagascar.',
    'ranjalahy.narindraa@gmail.com · 0328814081\nhttps://narindraportfolio.netlify.app/',
    'Choisissez Hôte pour diffuser, Auditeur Léger pour écouter avec WebView2, ou Auditeur classique pour disposer du moteur Electron embarqué. Plusieurs éditions peuvent être sélectionnées.',
    'Seules les applications choisies sont téléchargées depuis la release GitHub 0.1.5, puis contrôlées par SHA-256. Internet est requis pendant l’installation.',
    'Installation pour votre compte Windows, sans droits administrateur. Les applications et ce setup ne sont pas signés numériquement.',
    'L’Auditeur Léger demande .NET Framework 4.6.2+ et WebView2. Si WebView2 manque, une option propose la page Microsoft à la fin. Aucun composant Microsoft n’est installé automatiquement.',
    'Les préférences et les sessions YouTube restent dans vos dossiers utilisateur. La désinstallation retire les applications installées et leurs raccourcis ; les données personnelles sont conservées.'
  ].join('\n\n'));
  bitmap(path.join(stage, 'wizard.bmp'), 164, 314);
  bitmap(path.join(stage, 'wizard-small.bmp'), 55, 55, true);
  const quote = value => '"' + value.replaceAll('"', '""') + '"';
  const defines = { AppVersion: pkg.version, BrandImage: path.join(stage, 'wizard.bmp'), BrandSmallImage: path.join(stage, 'wizard-small.bmp'), BrandIcon: path.join(root, 'public/branding/icon.ico'), ConditionsFile: path.join(stage, 'conditions.txt'), WelcomeFile: path.join(stage, 'welcome.txt'), OutputPath: output };
  fs.writeFileSync(path.join(stage, 'payloads.iss'), Object.entries(defines).map(([key, value]) => '#define ' + key + ' ' + quote(value)).join('\n'));
  fs.writeFileSync(path.join(stage, 'files.iss'), manifest.editions.map(e => `Source: "{tmp}\\${e.file}"; DestDir: "{app}"; DestName: "${e.installedName}"; Components: ${e.id}; ExternalSize: ${e.bytes}; Flags: external ignoreversion`).join('\n'));
  fs.writeFileSync(path.join(stage, 'downloads.iss'), manifest.editions.map(e => `if WizardIsComponentSelected('${e.id}') then DownloadPage.Add('${manifest.baseUrl}${e.file}', '${e.file}', '${e.sha256}');`).join('\n'));
  fs.copyFileSync(path.join(root, 'installer/LocalSound.iss'), path.join(stage, 'LocalSound.iss'));
}

function build() {
  prepare();
  const candidates = [process.env.ISCC_PATH, path.join(root, 'artifacts/inno-setup/ISCC.exe'), ...['ProgramFiles(x86)', 'ProgramFiles', 'LOCALAPPDATA'].filter(key => process.env[key]).flatMap(key => [path.join(process.env[key], 'Inno Setup 6/ISCC.exe'), path.join(process.env[key], 'Programs/Inno Setup 6/ISCC.exe'), path.join(process.env[key], 'Inno Setup 7/ISCC.exe')])].filter(Boolean);
  const compiler = candidates.find(file => fs.existsSync(file));
  if (!compiler) throw new Error('Installez Inno Setup 6.7.3+ (https://jrsoftware.org/isdl.php), puis définissez ISCC_PATH si nécessaire.');
  const result = spawnSync(compiler, [path.join(stage, 'LocalSound.iss')], { cwd: stage, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Compilation du setup échouée.');
  const name = `LocalSound-Setup-${pkg.version}-Windows-x64.exe`, file = path.join(output, name);
  const digest = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  fs.writeFileSync(file + '.sha256', digest + '  ' + name + '\n');
  console.log(JSON.stringify({ setup: file, bytes: fs.statSync(file).size, sha256: digest }, null, 2));
}

module.exports = { validateManifest, sectionText };
if (require.main === module) { try { build(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
