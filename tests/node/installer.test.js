'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { validateManifest, sectionText } = require('../../scripts/build-setup');
const manifest = require('../../installer/payloads.json');

test('setup : les téléchargements sont épinglés à la version et aux empreintes attendues', () => {
  assert.doesNotThrow(() => validateManifest(manifest));
  for (const mutate of [
    data => { data.baseUrl = 'http://example.com/'; },
    data => { data.version = '0.0.0'; },
    data => { data.editions[0].sha256 = ''; },
    data => { data.editions[0].file = '../other.exe'; },
    data => { data.editions[0].installedName = '../other.exe'; },
    data => { data.editions[1].id = 'host'; }
  ]) {
    const copy = structuredClone(manifest); mutate(copy);
    assert.throws(() => validateManifest(copy));
  }
});

test('setup : les conditions reprennent les sections de l’application et leurs liens externes', () => {
  const html = fs.readFileSync('public/about.html', 'utf8');
  const cgu = sectionText(html, 'cgu'), privacy = sectionText(html, 'confidentialite');
  assert.match(cgu, /Ranjalahy Narindra/);
  assert.match(cgu, /https:\/\/www.youtube.com\/static\?template=terms/);
  assert.match(cgu, /Les dispositions|règles impératives/);
  assert.match(privacy, /Aucun enregistrement audio automatique/);
  assert.match(privacy, /%APPDATA%/);
  assert.doesNotMatch(cgu + privacy, /<\/?(?:section|p|a|h3)\b/);
  assert.throws(() => sectionText(html, 'absente'));
});
