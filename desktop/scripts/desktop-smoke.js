'use strict';

const assert = require('assert');
const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WallpaperManager } = require('../wallpaper');
const { WallpaperPowerController } = require('../power');
const { SettingsStore } = require('../settings');

class FakeWebContents extends EventEmitter {
  constructor() { super(); this.loading = false; this.messages = []; this.muted = false; }
  isLoading() { return this.loading; }
  send(channel, value) { this.messages.push([channel, value]); }
  setAudioMuted(value) { this.muted = value; }
}

class FakeWindow extends EventEmitter {
  static instances = [];
  constructor(options) {
    super();
    this.options = options;
    this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height };
    this.webContents = new FakeWebContents();
    this.destroyed = false;
    FakeWindow.instances.push(this);
  }
  setIgnoreMouseEvents(value) { this.ignoresMouse = value; }
  getNativeWindowHandle() { return Buffer.alloc(8); }
  setBounds(bounds) { this.bounds = bounds; }
  loadFile(file, options) { this.file = file; this.query = options.query; }
  showInactive() { this.shown = true; }
  isDestroyed() { return this.destroyed; }
  destroy() { this.destroyed = true; this.emit('closed'); }
}

class FakeScreen extends EventEmitter {
  constructor(displays, primary) { super(); this.displays = displays; this.primary = primary; }
  getAllDisplays() { return this.displays; }
  getPrimaryDisplay() { return this.displays.find(display => display.id === this.primary); }
}

class FakePowerMonitor extends EventEmitter {
  isOnBatteryPower() { return false; }
  getCurrentThermalState() { return 'nominal'; }
}

function display(id, x, width) {
  return { id, bounds: { x, y: 0, width, height: 900 } };
}

function testWallpaperManager() {
  FakeWindow.instances = [];
  const first = display(1, 0, 1440), second = display(2, 1440, 1920);
  const screen = new FakeScreen([first, second], 1);
  const nativeBridge = { attachWindow: () => ({ level: -2147483623, ignoresMouseEvents: true }) };
  const manager = new WallpaperManager({
    BrowserWindow: FakeWindow, screen, nativeBridge, dist: '/web', preload: '/preload.js',
    initialPerformance: { paused: false, fpsCap: 30, reason: 'normal' },
  });
  manager.start();
  assert.equal(manager.windows.size, 2);
  assert.equal(manager.windows.get('1').audioOwner, true);
  assert.equal(manager.windows.get('2').audioOwner, false);
  assert.deepEqual(manager.windows.get('2').window.bounds, second.bounds);
  assert.equal(manager.windows.get('1').window.query.mode, 'wallpaper');
  assert.equal(manager.windows.get('2').window.query.audio, '0');

  second.bounds = { x: 1200, y: 0, width: 1600, height: 1000 };
  manager.reconcile();
  assert.deepEqual(manager.windows.get('2').window.bounds, second.bounds);

  screen.displays = [second];
  screen.primary = 2;
  manager.reconcile();
  assert.equal(manager.windows.size, 1);
  assert.equal(manager.windows.get('2').audioOwner, true);
  manager.setPerformance({ paused: true, fpsCap: 12, reason: 'display-sleep' });
  assert.equal(manager.windows.get('2').window.webContents.muted, true);
  manager.stop();
  assert.equal(manager.windows.size, 0);
}

function testPowerController() {
  const monitor = new FakePowerMonitor();
  let nativeCallback = null;
  const nativeBridge = {
    startPowerMonitor: callback => { nativeCallback = callback; return { lowPowerMode: false, screensSleeping: false }; },
    stopPowerMonitor: () => {},
  };
  const changes = [];
  const controller = new WallpaperPowerController({
    powerMonitor: monitor, nativeBridge, fpsCap: 60, onChange: value => changes.push(value),
  });
  controller.start();
  assert.equal(changes.at(-1).fpsCap, 60);
  monitor.emit('on-battery');
  assert.equal(changes.at(-1).fpsCap, 15);
  nativeCallback({ lowPowerMode: true, screensSleeping: false });
  assert.equal(changes.at(-1).fpsCap, 12);
  nativeCallback({ lowPowerMode: true, screensSleeping: true });
  assert.equal(changes.at(-1).paused, true);
  assert.match(changes.at(-1).reason, /display-sleep/);
  controller.stop();
}

function testSettings() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rrr-desktop-'));
  try {
    const store = new SettingsStore(directory);
    store.update({ wallpaperEnabled: true, fpsCap: 60 });
    assert.deepEqual(new SettingsStore(directory).value, { wallpaperEnabled: true, fpsCap: 60 });
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

testWallpaperManager();
testPowerController();
testSettings();
console.log('desktop smoke: per-display lifecycle, audio ownership, power policy, and settings passed');
