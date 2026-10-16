'use strict';
globalThis.LocalSoundPrefs = {
  read(key, fallback) {
    try {
      const raw = localStorage.getItem('localsound.' + key);
      if (raw === null) return fallback;
      const value = JSON.parse(raw);
      return typeof value === typeof fallback && (typeof value !== 'number' || Number.isFinite(value)) ? value : fallback;
    } catch (_) { return fallback; }
  },
  write(key, value) { try { localStorage.setItem('localsound.' + key, JSON.stringify(value)); } catch (_) {} },
};
