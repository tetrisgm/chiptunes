'use strict';

const path = require('path');

if (process.platform !== 'darwin') {
  console.log('native smoke: skipped (macOS only)');
  process.exit(0);
}

const bridge = require(path.join(__dirname, '..', 'build', 'Release', 'rrr_wallpaper.node'));
const levels = bridge.getDesktopLevels();
const power = bridge.getPowerState();
if (!(levels.desktop < levels.desktopIcon && levels.desktopIcon < levels.normal)) {
  throw new Error('unexpected macOS desktop levels: ' + JSON.stringify(levels));
}
if (typeof power.lowPowerMode !== 'boolean' || typeof power.screensSleeping !== 'boolean') {
  throw new Error('unexpected power state: ' + JSON.stringify(power));
}
console.log('native smoke:', JSON.stringify({ arch: process.arch, levels, power }));
