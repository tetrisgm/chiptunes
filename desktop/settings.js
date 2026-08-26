'use strict';

const fs = require('fs');
const path = require('path');

const STATIONS = ['st-any'];   // one merged station — any stale mood-station id coerces to Everything (st-any)

const DEFAULTS = Object.freeze({
  wallpaperEnabled: false,
  fpsCap: 30,
  powerSaver: false,
  motionFrozen: false,
  audioMuted: false,
  volume: 0.4,
  systemAudioReactive: false,
  scanlineStrength: 0.3,
  sceneSeconds: 30,          // how often the wallpaper rotates to another game (seconds)
  station: 'st-any',
  displayMode: 'primary',
  displayOverrides: {},
});

function normalize(input) {
  const fps = Number(input && input.fpsCap);
  let displayMode = input && input.displayMode === 'all' ? 'all' : DEFAULTS.displayMode;
  let displayOverrides = {};
  if (input && input.displayOverrides && typeof input.displayOverrides === 'object' && !Array.isArray(input.displayOverrides)) {
    for (const [id, enabled] of Object.entries(input.displayOverrides)) {
      if (typeof enabled === 'boolean') displayOverrides[String(id)] = enabled;
    }
  } else if (Array.isArray(input && input.disabledDisplays)) {
    // v0.1.17 and earlier enabled every display unless it appeared in this denylist. Preserve that
    // behavior during migration; fresh installs use the safer primary-only default.
    displayMode = 'all';
    for (const id of input.disabledDisplays) displayOverrides[String(id)] = false;
  }
  return {
    wallpaperEnabled: !!(input && input.wallpaperEnabled),
    fpsCap: [15, 30, 60].includes(fps) ? fps : DEFAULTS.fpsCap,
    powerSaver: !!(input && input.powerSaver),
    motionFrozen: !!(input && input.motionFrozen),
    audioMuted: !!(input && input.audioMuted),
    volume: Number.isFinite(Number(input && input.volume))
      ? Math.max(0, Math.min(2, Number(input.volume)))
      : DEFAULTS.volume,
    systemAudioReactive: !!(input && input.systemAudioReactive),
    scanlineStrength: Number.isFinite(Number(input && input.scanlineStrength))
      ? Math.max(0, Math.min(1, Number(input.scanlineStrength)))
      : DEFAULTS.scanlineStrength,
    sceneSeconds: Number.isFinite(Number(input && input.sceneSeconds))
      ? Math.max(5, Math.min(600, Math.round(Number(input.sceneSeconds))))
      : DEFAULTS.sceneSeconds,
    station: STATIONS.includes(input && input.station) ? input.station : DEFAULTS.station,
    displayMode,
    displayOverrides,
  };
}

class SettingsStore {
  constructor(userDataDir) {
    this.file = path.join(userDataDir, 'desktop-settings.json');
    this.value = this.read();
  }

  read() {
    try { return normalize(JSON.parse(fs.readFileSync(this.file, 'utf8'))); }
    catch (error) { return { ...DEFAULTS }; }
  }

  update(patch) {
    this.value = normalize({ ...this.value, ...patch });
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = this.file + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(this.value, null, 2) + '\n');
    fs.renameSync(temporary, this.file);
    return this.value;
  }
}

module.exports = { SettingsStore };
