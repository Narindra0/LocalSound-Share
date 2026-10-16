'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { selectMetadata, cleanTrackTitle, createWindowsMediaInfo } = require('../../media-info');
const session = (title, appId, playing = true) => ({ title, artist: 'Artiste', appId, playing });
test('titres vidéo : retire les mentions promotionnelles et conserve les versions musicales', () => {
  for (const suffix of ['(Clip officiel)','[Official Audio]','(Official Music Video)',' - Official Video',' | Vidéo officielle',' Official Audio','(Official Video HD)','[OFFICIAL LYRIC VIDEO]']) {
    assert.equal(cleanTrackTitle('Artiste - Chanson '+suffix),'Artiste - Chanson',suffix);
  }
  assert.equal(cleanTrackTitle('Artiste - Chanson (Official Video) [Official Audio]'),'Artiste - Chanson');
  for (const suffix of ['(Visualizer)','[Visualiser]','(Visualiseur)','(Vizualiser)','(Official Visualizer)','[Official Visualiser]',' - Audio Visualizer',' | Visualizer officiel','(Music Visualizer 4K)']) {
    assert.equal(cleanTrackTitle('Artiste - Chanson '+suffix),'Artiste - Chanson',suffix);
    assert.equal(cleanTrackTitle('Artiste - Chanson (Live) '+suffix),'Artiste - Chanson (Live)',suffix);
  }
  assert.equal(cleanTrackTitle('Visualizer'),'Visualizer');
  assert.equal(cleanTrackTitle('Visualizer of Dreams'),'Visualizer of Dreams');
  for (const suffix of ['(Live à Paris)','(Remix)','(Acoustic Version)','(Instrumental)','(feat. Invitée)','(Remastered 2024)']) {
    assert.equal(cleanTrackTitle('Artiste - Chanson '+suffix+' [Official Audio]'),'Artiste - Chanson '+suffix);
  }
  assert.equal(cleanTrackTitle('Official Audio'),'Official Audio');
  assert.equal(cleanTrackTitle('(Official Audio)'),'(Official Audio)');
  assert.equal(selectMetadata({available:true,sessions:[session('Chanson (Official Audio)','chrome.exe')]},'tab').track.title,'Chanson');
  assert.equal(selectMetadata({available:true,sessions:[session('Chanson (Official Audio)','Spotify.exe')]},'system').track.title,'Chanson (Official Audio)');
});
test('titres : distingue les navigateurs, les lecteurs multiples et les lecteurs en pause', () => {
  const snapshot = { available: true, sessions: [session('Vidéo YouTube', 'msedge.exe'), session('Autre morceau', 'Spotify.exe')] };
  assert.equal(selectMetadata(snapshot, 'tab').track.title, 'Vidéo YouTube');
  assert.equal(selectMetadata(snapshot, 'system').status, 'ambiguous');
  snapshot.sessions[1].playing = false;
  assert.equal(selectMetadata(snapshot, 'system').track.title, 'Vidéo YouTube');
  snapshot.sessions[0].playing = false;
  assert.equal(selectMetadata(snapshot, 'tab').track.title, 'Vidéo YouTube');
  snapshot.sessions = [session('Musique native', 'VLC.exe')];
  assert.equal(selectMetadata(snapshot, 'tab').track, null);
  assert.equal(selectMetadata({ available:false }, 'system').status, 'unavailable');
  assert.equal(selectMetadata({ available:true, sessions:[] }, 'system').status, 'waiting');
});
test('titres : nettoie les métadonnées et se replie sans Windows', () => {
  const result = selectMetadata({ available:true, sessions:[session('  Titre\u0000\n suivant ', 'chrome.exe')] }, 'tab');
  assert.equal(result.track.title, 'Titre suivant');
  let value;
  const reader = createWindowsMediaInfo({ platform:'linux', spawnProcess:() => assert.fail('Aucun processus hors Windows') });
  reader.start(snapshot => { value = snapshot; }); reader.close();
  assert.equal(value.available, false);
});
