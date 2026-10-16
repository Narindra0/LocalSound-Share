'use strict';
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const cleanText = (value, max = 200) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
const browserApp = appId => /chrome|msedge|firefox|brave|opera|vivaldi/i.test(appId || '');
const visualLabel = '(?:(?:audio|music)\\s+)?(?:visuali[sz]er|vizuali[sz]er|visualiseur)';
const promoWords = '(?:(?:official|officiel|officielle)\\s+(?:music\\s+)?(?:video|audio|clip|' + visualLabel + '|lyrics?(?:\\s+video)?)|(?:music\\s+video|video\\s+clip|clip|video|audio|' + visualLabel + ')\\s+(?:official|officiel|officielle)|' + visualLabel + ')(?:\\s+(?:hd|uhd|4k|1080p))*';
const fold = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function cleanTrackTitle(value) {
  const original = cleanText(value, 1000).normalize('NFC');
  let title = original.replace(/\(([^()]*)\)|\[([^\[\]]*)\]|\{([^{}]*)\}/g, (block, a, b, c) => {
    const label = fold(a || b || c || '').replace(/[|,:–—-]/g, ' ').replace(/\s+/g, ' ').trim();
    return new RegExp('^' + promoWords + '$', 'i').test(label) ? '' : block;
  }).replace(/\s+/g, ' ').trim();
  // Hors parenthèses, seules les mentions finales complètes sont supprimées.
  for (let i = 0; i < 5; i++) {
    const normalized = fold(title);
    const match = new RegExp('(?:\\s*[-–—|:]\\s*|\\s+)(?:' + promoWords + ')$', 'i').exec(normalized);
    if (!match) break;
    title = title.slice(0, match.index).trim();
  }
  title = title.replace(/\s*[-–—|:]\s*$/, '').trim();
  return cleanText(title || original);
}

function selectMetadata(snapshot, kind) {
  if (!snapshot?.available) return { status: 'unavailable', track: null };
  let sessions = (snapshot.sessions || []).filter(s => cleanText(s.title));
  // Un onglet ne doit pas hériter du titre d’un lecteur natif (VLC, Spotify…).
  if (kind === 'tab') sessions = sessions.filter(s => browserApp(s.appId));
  const playing = sessions.filter(s => s.playing);
  const candidates = playing.length ? playing : sessions;
  if (candidates.length !== 1) return { status: candidates.length > 1 ? 'ambiguous' : 'waiting', track: null };
  const item = candidates[0];
  return { status: 'detected', track: { title: browserApp(item.appId) ? cleanTrackTitle(item.title) : cleanText(item.title), artist: cleanText(item.artist), source: 'windows', ...(item.artwork ? { artwork:item.artwork } : {}) } };
}

function createWindowsMediaInfo({ spawnProcess = spawn, platform = process.platform } = {}) {
  let child, watchdog, closed = false;
  return {
    start(onUpdate) {
      if (platform !== 'win32') { onUpdate({ available: false, sessions: [] }); return; }
      let pending = '', lastSeen = Date.now();
      const unavailable = () => onUpdate({ available: false, sessions: [] });
      try {
        const script = fs.readFileSync(path.join(__dirname, 'scripts/media-info.ps1'), 'utf8');
        child = spawnProcess('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', chunk => {
          pending += chunk;
          if (pending.length > 4 * 1024 * 1024) { pending = ''; unavailable(); return; }
          let index;
          while ((index = pending.indexOf('\n')) !== -1) {
            const line = pending.slice(0, index); pending = pending.slice(index + 1);
            try {
              const data = JSON.parse(line);
              if (typeof data.available === 'boolean' && Array.isArray(data.sessions)) { lastSeen = Date.now(); onUpdate(data); }
            } catch (_) { /* Une ligne incomplète n’affecte jamais la lecture audio. */ }
          }
        });
        child.stderr.resume();
        child.on('error', unavailable);
        child.on('exit', () => { clearInterval(watchdog); if (!closed) unavailable(); });
        watchdog = setInterval(() => { if (Date.now() - lastSeen > 7000) unavailable(); }, 3000);
        watchdog.unref();
      } catch (_) { unavailable(); }
    },
    close() { closed = true; clearInterval(watchdog); child?.kill(); },
  };
}
module.exports = { cleanText, cleanTrackTitle, selectMetadata, createWindowsMediaInfo };
