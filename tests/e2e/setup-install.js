'use strict';
// Opt-in Windows test: downloads the real public payloads and removes its test installation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const manifest = require('../../installer/payloads.json');
const root = path.resolve(__dirname, '../..');
const directory = path.join(root, 'artifacts', 'setup-install-test-' + process.pid);
const registry = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{CCCA0D77-56DC-4F06-A84B-A36D9952A38F}_is1';
const group = 'LocalSound Setup Test ' + process.pid;
const shortcutDir = path.join(process.env.APPDATA || '', 'Microsoft/Windows/Start Menu/Programs', group);
function installedRegistration() { return spawnSync('reg', ['query', registry], { windowsHide: true, stdio: 'ignore' }).status === 0; }
function run(file, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { windowsHide: true, stdio: 'ignore' });
    const timer = setTimeout(() => { child.kill(); reject(new Error('Installation trop longue')); }, 300000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('Code de sortie ' + code + ', consulter artifacts/setup-test-*.log')); });
  });
}
function verifyEdition(id) {
  const edition = manifest.editions.find(e => e.id === id);
  const buffer = fs.readFileSync(path.join(directory, edition.installedName));
  assert.equal(buffer.length, edition.bytes);
  assert.equal(crypto.createHash('sha256').update(buffer).digest('hex'), edition.sha256);
}
(async () => {
  assert.equal(process.platform, 'win32');
  assert.equal(installedRegistration(), false, 'Une vraie installation existe déjà : test interrompu pour la préserver.');
  const setup = path.join(root, 'release/setup/LocalSound-Setup-' + manifest.version + '-Windows-x64.exe');
  assert.ok(fs.existsSync(setup), 'Compiler le setup avant ce test.');
  fs.mkdirSync(directory, { recursive: true });
  const args = ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', '/DIR=' + directory, '/GROUP=' + group, '/TASKS='];
  try {
    await run(setup, [...args, '/TYPE=listener', '/COMPONENTS=lite', '/LOG=' + path.join(root, 'artifacts/setup-test-lite.log')]);
    verifyEdition('lite');
    assert.ok(!fs.existsSync(path.join(directory, manifest.editions.find(e => e.id === 'host').installedName)));
    assert.ok(!fs.existsSync(path.join(directory, manifest.editions.find(e => e.id === 'classic').installedName)));
    const legal = fs.readFileSync(path.join(directory, 'Conditions et confidentialite.txt'), 'utf8');
    assert.match(legal, /Ranjalahy Narindra/); assert.match(legal, /Aucun enregistrement audio automatique/);
    assert.ok(installedRegistration());
    assert.ok(fs.existsSync(path.join(shortcutDir, 'LocalSound Auditeur Léger.lnk')));
    console.log('Setup : Auditeur Léger seul, téléchargement réel, empreinte, conditions, raccourci et enregistrement Windows — OK');
    await run(setup, [...args, '/TYPE=custom', '/COMPONENTS=host,classic', '/LOG=' + path.join(root, 'artifacts/setup-test-host-classic.log')]);
    verifyEdition('host'); verifyEdition('classic'); verifyEdition('lite');
    assert.ok(fs.existsSync(path.join(shortcutDir, 'LocalSound Hôte.lnk')));
    assert.ok(fs.existsSync(path.join(shortcutDir, 'LocalSound Auditeur.lnk')));
    console.log('Setup : ajout Hôte et Auditeur classique, sélection multiple et empreintes — OK');
    fs.writeFileSync(path.join(directory, 'user-note.txt'), 'Donnée étrangère à conserver');
  } finally {
    const uninstaller = path.join(directory, 'unins000.exe');
    if (fs.existsSync(uninstaller)) await run(uninstaller, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/LOG=' + path.join(root, 'artifacts/setup-test-uninstall.log')]);
  }
  for (const edition of manifest.editions) assert.ok(!fs.existsSync(path.join(directory, edition.installedName)));
  assert.equal(installedRegistration(), false);
  assert.ok(!fs.existsSync(shortcutDir));
  assert.equal(fs.readFileSync(path.join(directory, 'user-note.txt'), 'utf8'), 'Donnée étrangère à conserver');
  console.log('Désinstallation : applications, raccourcis et enregistrement supprimés ; fichier utilisateur conservé — OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
