'use strict';

const fs = require('fs');
const path = require('path');

const STATIONS = ['st-any', 'st-full', 'st-sparse', 'st-none'];

const DEFAULTS = Object.freeze({
  wallpaperEnabled: false,
  fpsCap: 30,
  powerSaver: false,
  station: 'st-any',
});

function normalize(input) {
  const fps = Number(input && input.fpsCap);
  return {
    wallpaperEnabled: !!(input && input.wallpaperEnabled),
    fpsCap: [15, 30, 60].includes(fps) ? fps : DEFAULTS.fpsCap,
    powerSaver: !!(input && input.powerSaver),
    station: STATIONS.includes(input && input.station) ? input.station : DEFAULTS.station,
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
