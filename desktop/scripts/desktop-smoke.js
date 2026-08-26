'use strict';

const assert = require('assert');
const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WallpaperManager } = require('../wallpaper');
const { WallpaperPowerController } = require('../power');
const { SettingsStore } = require('../settings');
const { createWallpaperTray } = require('../tray');
const { AudioDiagnostics } = require('../audio-diagnostics');
const { makeDismissable } = require('../window-lifecycle');
const { preserveLegacyUserData } = require('../user-data');

class FakeWebContents extends EventEmitter {
  constructor() { super(); this.loading = false; this.messages = []; this.muted = false; }
  isLoading() { return this.loading; }
  send(channel, value) { this.messages.push([channel, value]); }
  setAudioMuted(value) { this.muted = value; }
  isAudioMuted() { return this.muted; }
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
  hide() { this.hidden = true; }
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

function testDismissableWindow() {
  const window = new FakeWindow({ x:0, y:0, width:800, height:600 });
  let quitting = false;
  makeDismissable(window, { platform:'darwin', isQuitting:() => quitting });
  let prevented = false;
  window.webContents.emit('before-input-event', { preventDefault(){ prevented = true; } },
    { meta:true, alt:false, control:false, key:'w' });
  assert.equal(prevented, true);
  assert.equal(window.hidden, true);
  window.hidden = false;
  window.emit('close', { preventDefault(){ prevented = true; } });
  assert.equal(window.hidden, true);
  quitting = true;
  window.hidden = false;
  window.emit('close', { preventDefault(){ throw new Error('quit close must not be prevented'); } });
  assert.equal(window.hidden, false);
}

function testLegacyUserDataMigration() {
  let selected = null;
  const app = {
    getPath(name) {
      return name === 'appData' ? '/Users/test/Library/Application Support' : '/Users/test/Library/Application Support/chiptunes-app-desktop';
    },
    setPath(name, value) { assert.equal(name, 'userData'); selected = value; },
  };
  const result = preserveLegacyUserData(app, {
    fs:{ existsSync:file => file.endsWith('/chiptunes-app-desktop/desktop-settings.json') },
    path,
  });
  assert.equal(result.migrated, true);
  assert.equal(selected, '/Users/test/Library/Application Support/chiptunes-app-desktop');
}

function testPopoverTrackTransport() {
  const runtime = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'runtime.js'), 'utf8');
  assert.ok(runtime.includes(
    "document.getElementById('pvPrev').onclick=function(){ ctl('transport',{dir:'prev'}); };"
  ), 'popover Previous must use the shared track transport');
  assert.ok(runtime.includes(
    "document.getElementById('pvNext').onclick=function(){ ctl('transport',{dir:'next'}); };"
  ), 'popover Next must use the shared track transport');
  assert.ok(runtime.includes('id="pvPrev" title="Previous track"'));
  assert.ok(runtime.includes('id="pvNext" title="Next track"'));
}

function testWallpaperManager() {
  FakeWindow.instances = [];
  const first = display(1, 0, 1440), second = display(2, 1440, 1920);
  const screen = new FakeScreen([first, second], 1);
  const nativeBridge = { attachWindow: () => ({ level: -2147483623, ignoresMouseEvents: true }) };
  const manager = new WallpaperManager({
    BrowserWindow: FakeWindow, screen, nativeBridge, dist: '/web', preload: '/preload.js',
    initialPerformance: { paused: false, fpsCap: 30, reason: 'normal' },
    displayMode: 'all',
    systemAudioReactive: true,
    scanlineStrength: 0.62,
  });
  manager.start();
  assert.equal(manager.windows.size, 2);
  assert.equal(manager.windows.get('1').audioOwner, true);
  assert.equal(manager.windows.get('2').audioOwner, false);
  assert.deepEqual(manager.windows.get('2').window.bounds, second.bounds);
  assert.equal(manager.windows.get('1').window.query.mode, 'wallpaper');
  assert.equal(manager.windows.get('2').window.query.audio, '0');
  assert.equal(manager.windows.get('1').window.query.systemAudio, '1');
  assert.equal(manager.windows.get('1').window.query.scanlines, '0.62');
  manager.setVolume(0.65);
  assert.deepEqual(manager.windows.get('1').window.webContents.messages.at(-1),
    ['rrr:command', { type: 'masterVol', value: 0.65 }]);
  manager.setMix('lead', 0.55);
  assert.deepEqual(manager.windows.get('1').window.webContents.messages.at(-1),
    ['rrr:command', { type: 'mix', role: 'lead', value: 0.55 }]);
  manager.resetMix();
  assert.deepEqual(manager.windows.get('1').window.webContents.messages.at(-1),
    ['rrr:command', { type: 'resetMix' }]);
  manager.setTempo(111);
  assert.deepEqual(manager.windows.get('1').window.webContents.messages.at(-1),
    ['rrr:command', { type: 'tempo', value: 111 }]);
  manager.setTempo(null);
  assert.deepEqual(manager.windows.get('1').window.webContents.messages.at(-1),
    ['rrr:command', { type: 'tempo', value: null }]);
  manager.setSystemAudioReactive(false);
  assert.deepEqual(manager.windows.get('1').window.webContents.messages.at(-1),
    ['rrr:command', { type: 'systemAudio', value: false }]);
  manager.setScanlineStrength(0.48);
  for (const entry of manager.windows.values()) {
    assert.deepEqual(entry.window.webContents.messages.at(-1),
      ['rrr:command', { type: 'scanlines', value: 0.48 }]);
  }
  manager.cycleVisualizer(-1);
  assert.deepEqual(manager.windows.get('1').window.webContents.messages.at(-1),
    ['rrr:command', { type: 'visualizer', dir: -1 }]);
  manager.setUserMuted(true);
  assert.equal(manager.windows.get('1').window.webContents.muted, true);
  manager.setUserMuted(false);
  manager.setMotionFrozen(true);
  assert.equal(manager.effectivePerformance().frozen, true);
  assert.equal(manager.effectivePerformance().paused, false);
  assert.equal(manager.windows.get('1').window.webContents.muted, false);  // held visuals keep the radio playing

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

function testOcclusion() {
  FakeWindow.instances = [];
  const a = display(1, 0, 1440), b = display(2, 1440, 1920);
  const screen = new FakeScreen([a, b], 1);
  const nativeBridge = { attachWindow: () => ({ level: -2147483623, ignoresMouseEvents: true }) };
  const manager = new WallpaperManager({
    BrowserWindow: FakeWindow, screen, nativeBridge, dist: '/web', preload: '/preload.js',
    initialPerformance: { paused: false, fpsCap: 30, reason: 'normal' },
    displayMode: 'all',
  });
  manager.start();
  // the real bridge supplies windowNumber via attachWindow; stamp deterministic ones for the fake.
  let n = 100;
  for (const entry of manager.windows.values()) entry.attached = { windowNumber: n++ };
  const nums = [...manager.windows.values()].map(entry => entry.attached.windowNumber);
  const owner = [...manager.windows.values()].find(entry => entry.audioOwner);

  manager.onOcclusion({ windowNumber: nums[0], visible: false });
  assert.equal(manager.occluded, false);                       // one covered display is not full occlusion
  nums.forEach(num => manager.onOcclusion({ windowNumber: num, visible: false }));
  assert.equal(manager.occluded, true);                        // every display covered -> occluded
  assert.equal(owner.window.webContents.muted, false);         // occlusion never interrupts the radio
  assert.equal(owner.window.webContents.messages.at(-1)[1].paused, false);
  assert.equal(owner.window.webContents.messages.at(-1)[1].fpsCap, 5);      // covered visuals are heavily throttled

  manager.setPerformance({ paused: true, audioMuted: true, fpsCap: 30, reason: 'display-sleep' });
  assert.equal(owner.window.webContents.muted, true);                       // real power pauses still stop audio
  assert.equal(owner.window.webContents.messages.at(-1)[1].paused, true);
  manager.setPerformance({ paused: false, audioMuted: false, fpsCap: 30, reason: 'normal' });

  manager.onOcclusion({ windowNumber: nums[0], visible: true });
  assert.equal(manager.occluded, false);                       // a visible display lifts occlusion
  manager.stop();
}

function testOcclusionAcrossDisplayChanges() {
  FakeWindow.instances = [];
  const a = display(1, 0, 1440), b = display(2, 1440, 1920);
  const attachVisibility = [false, true];
  let nextWindowNumber = 200;
  const nativeBridge = {
    attachWindow: () => ({ windowNumber: nextWindowNumber++, level: -2147483623, ignoresMouseEvents: true,
      visible: attachVisibility.shift() }),
  };
  const screen = new FakeScreen([a, b], 1);
  const manager = new WallpaperManager({
    BrowserWindow: FakeWindow, screen, nativeBridge, dist: '/web', preload: '/preload.js',
    initialPerformance: { paused: false, fpsCap: 30, reason: 'normal' },
    displayMode: 'all',
  });
  manager.start();
  assert.equal(manager.occluded, false);

  screen.displays = [a];
  screen.primary = 1;
  attachVisibility.push(false);
  manager.reconcile();
  assert.equal(manager.occluded, true);                         // removing the only visible display throttles immediately
  assert.equal(manager.windows.get('1').window.webContents.muted, false);
  assert.equal(manager.windows.get('1').window.webContents.messages.at(-1)[1].fpsCap, 5);

  screen.displays = [a, b];
  attachVisibility.push(false, true);
  manager.reconcile();
  assert.equal(manager.occluded, false);                        // adding a visible display resumes without another event
  manager.stop();
}

function testTransientNativeAttachFailure() {
  FakeWindow.instances = [];
  const first = display(1, 0, 1440);
  const screen = new FakeScreen([first], 1);
  let attempts = 0;
  const nativeBridge = {
    attachWindow: () => {
      attempts++;
      if (attempts < 3) throw new Error('NSView is temporarily unavailable');
      return { windowNumber: 301, level: -2147483623, ignoresMouseEvents: true, visible: true };
    },
  };
  const manager = new WallpaperManager({
    BrowserWindow: FakeWindow, screen, nativeBridge, dist: '/web', preload: '/preload.js',
    initialPerformance: { paused: false, fpsCap: 30, reason: 'normal' },
  });

  assert.doesNotThrow(() => manager.start());
  const entry = manager.windows.get('1');
  assert.equal(entry.attached, null);
  assert.equal(entry.visible, false);                                // never play behind an unattached/invisible window
  assert.match(entry.attachError, /temporarily unavailable/);
  assert.equal(manager.occluded, true);

  assert.doesNotThrow(() => manager.reassertAll());                  // a second transient failure is contained too
  assert.equal(entry.attachFailures, 2);
  assert.doesNotThrow(() => manager.reassertAll());
  assert.equal(entry.attachError, null);
  assert.equal(entry.attachFailures, 0);
  assert.equal(entry.visible, true);
  assert.equal(manager.occluded, false);
  assert.equal(manager.attachRetryTimer, null);                      // recovery cancels the pending backoff
  manager.stop();
}

function testRendererCrashRecovery() {
  FakeWindow.instances = [];
  const first = display(1, 0, 1440);
  const screen = new FakeScreen([first], 1);
  let nextWindowNumber = 400;
  const nativeBridge = {
    attachWindow: () => ({ windowNumber: nextWindowNumber++, level: -2147483623,
      ignoresMouseEvents: true, visible: true }),
  };
  const manager = new WallpaperManager({
    BrowserWindow: FakeWindow, screen, nativeBridge, dist: '/web', preload: '/preload.js',
    initialPerformance: { paused: false, fpsCap: 30, reason: 'normal' },
    station: 'st-any',
  });
  manager.start();
  const failed = manager.windows.get('1');
  failed.window.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 9 });
  assert.equal(failed.window.destroyed, true);
  assert.equal(manager.windows.size, 0);                              // dead renderer is retired immediately
  assert.equal(manager.occluded, false);                             // no phantom window holds global occlusion
  assert.equal(manager.rendererRecoveries.get('1').attempts, 1);

  manager.reconcile();
  assert.equal(manager.windows.size, 0);                              // unrelated display passes cannot bypass backoff
  const recovery = manager.rendererRecoveries.get('1');
  clearTimeout(recovery.timer);
  recovery.timer = null;                                             // simulate the recovery delay expiring
  manager.reconcile();
  const recovered = manager.windows.get('1');
  assert.notEqual(recovered, failed);
  assert.equal(recovered.audioOwner, true);
  assert.equal(recovered.window.query.station, 'st-any');             // replacement preserves playback configuration
  recovered.window.webContents.emit('did-finish-load');
  assert.equal(manager.rendererRecoveries.get('1').timer, null);      // healthy load cancels the pending retry

  recovered.window.webContents.emit('render-process-gone', {}, { reason: 'oom', exitCode: 9 });
  assert.equal(manager.rendererRecoveries.get('1').attempts, 2);      // repeated failures back off, not hot-loop
  manager.stop();
  assert.equal(manager.rendererRecoveries.size, 0);
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
  assert.equal(changes.at(-1).fpsCap, 60);            // owner default: battery keeps visuals smooth...
  assert.equal(changes.at(-1).audioMuted, true);      // ...and mutes audio instead
  controller.setPowerSaver(true);
  assert.equal(changes.at(-1).fpsCap, 15);            // the lower-FPS saver is opt-in
  controller.setPowerSaver(false);
  nativeCallback({ lowPowerMode: true, screensSleeping: false });
  assert.equal(changes.at(-1).fpsCap, 12);
  nativeCallback({ lowPowerMode: true, screensSleeping: true });
  assert.equal(changes.at(-1).paused, true);
  assert.match(changes.at(-1).reason, /display-sleep/);
  controller.stop();
}

function testPrimaryOnlyDisplayDefault() {
  FakeWindow.instances = [];
  const a = display(1, 0, 1440), b = display(2, 1440, 1920);
  const screen = new FakeScreen([a, b], 1);
  const nativeBridge = { attachWindow: () => ({ level: -2147483623, ignoresMouseEvents: true, visible: true }) };
  const manager = new WallpaperManager({
    BrowserWindow: FakeWindow, screen, nativeBridge, dist: '/web', preload: '/preload.js',
    initialPerformance: { paused: false, fpsCap: 30, reason: 'normal' },
  });
  manager.start();
  assert.deepEqual([...manager.windows.keys()], ['1']);               // fresh installs stay on the primary display

  manager.setDisplayEnabled('2', true);
  assert.deepEqual([...manager.windows.keys()], ['1', '2']);          // explicit secondary opt-in takes effect
  screen.primary = 2;
  manager.reconcile();
  assert.deepEqual([...manager.windows.keys()], ['2']);               // the unpinned former primary returns to off
  assert.equal(manager.windows.get('2').audioOwner, true);            // audio follows the current primary

  manager.setDisplayEnabled('1', false);
  screen.displays.push(display(3, 3360, 1280));
  manager.reconcile();
  assert.deepEqual([...manager.windows.keys()], ['2']);               // newly attached secondary displays remain off
  manager.stop();
}

function testSettings() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rrr-desktop-'));
  try {
    const store = new SettingsStore(directory);
    store.update({ wallpaperEnabled: true, fpsCap: 60, motionFrozen: true, audioMuted: true, volume: 0.65,
      systemAudioReactive: true, scanlineStrength: 0.72 });
    assert.deepEqual(new SettingsStore(directory).value, { wallpaperEnabled: true, fpsCap: 60,
      powerSaver: false, motionFrozen: true, audioMuted: true, volume: 0.65,
      systemAudioReactive: true, scanlineStrength: 0.72, sceneSeconds: 30, station: 'st-any',
      displayMode: 'primary', displayOverrides: {} });
    store.update({ volume: 7 });
    assert.equal(store.value.volume, 2);

    fs.writeFileSync(store.file, JSON.stringify({ wallpaperEnabled: true, disabledDisplays: ['2'] }));
    const migrated = new SettingsStore(directory).value;
    assert.equal(migrated.displayMode, 'all');                         // legacy users keep their all-display default
    assert.deepEqual(migrated.displayOverrides, { '2': false });
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

async function testAudioDiagnostics() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rrr-audio-diag-'));
  try {
    const diagnostics = new AudioDiagnostics({ directory, appVersion: '9.8.7', maxBytes: 80, keepFiles: 3 });
    diagnostics.record('heartbeat', { token: 'test-token', nested: { state: 'running' } });
    diagnostics.record('silence-start', { silentMs: 12000, detail: 'x'.repeat(300) });
    await diagnostics.flush();
    assert.equal(fs.existsSync(diagnostics.file), true);
    assert.equal(fs.existsSync(diagnostics.file + '.1'), true);       // bounded log remains recoverable across rotation
    const rows = fs.readFileSync(diagnostics.file, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(rows.at(-1).event, 'silence-start');
    assert.equal(rows.at(-1).appVersion, '9.8.7');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

function testUpdateTrayState() {
  class FakeTray extends EventEmitter {
    setToolTip(value) { this.toolTip = value; }
    setContextMenu(value) { this.menu = value; }
    // The tray now opens the settings menu via popUpContextMenu on right-click (left-click is the
    // Portal popover), so capture the menu here too.
    popUpContextMenu(value) { this.menu = value; }
    getBounds() { return { x: 0, y: 0, width: 18, height: 18 }; }
  }
  const image = { setTemplateImage() {} };
  const nativeImage = { createFromBuffer: () => image };
  const Menu = { buildFromTemplate: template => template };
  let checks = 0, applies = 0, popoverOpens = 0;
  const state = {
    appVersion: '1.2.3',
    wallpaperEnabled: false, wallpaperAvailable: true, audioMuted: false, motionFrozen: false,
    fpsCap: 30, powerSaver: false, openAtLogin: false,
    update: { enabled: true, phase: 'idle', version: null },
  };
  const controller = createWallpaperTray({
    Tray: FakeTray, Menu, nativeImage, getState: () => state,
    onToggle() {}, onOpen() {}, onFps() {}, onPowerSaver() {}, onMotionFrozen() {},
    onAudioMuted() {}, onLogin() {}, onQuit() {}, onClick() { popoverOpens++; },
    onCheckForUpdates: () => { checks++; }, onApplyUpdate: () => { applies++; },
  });
  // Left-click opens the Portal popover; right-click surfaces the settings menu (NOT setContextMenu,
  // which would make left-click open the menu and hide the popover).
  controller.tray.emit('click');
  assert.equal(popoverOpens, 1);
  controller.tray.emit('right-click');
  assert.equal(controller.tray.menu[0].label, 'Chiptunes.app · v1.2.3');
  assert.equal(controller.tray.menu[0].enabled, false);
  assert.equal(controller.tray.toolTip, 'Chiptunes.app v1.2.3');
  let updateItem = controller.tray.menu.find(item => item.label === 'Check for Updates…');
  assert.equal(updateItem.enabled, true);
  updateItem.click();
  assert.equal(checks, 1);

  state.update = { enabled: true, phase: 'ready', version: '9.9.9' };
  controller.refresh();
  controller.tray.emit('right-click');
  assert.match(controller.tray.toolTip, /Update ready/);
  assert.match(controller.tray.toolTip, /Chiptunes\.app v1\.2\.3/);
  updateItem = controller.tray.menu.find(item => item.label === 'Update ready — relaunch to apply');
  updateItem.click();
  assert.equal(applies, 1);
}

async function main() {
  testDismissableWindow();
  testLegacyUserDataMigration();
  testPopoverTrackTransport();
  testWallpaperManager();
  testOcclusion();
  testOcclusionAcrossDisplayChanges();
  testTransientNativeAttachFailure();
  testRendererCrashRecovery();
  testPowerController();
  testPrimaryOnlyDisplayDefault();
  testSettings();
  testUpdateTrayState();
  await testAudioDiagnostics();
  console.log('desktop smoke: settings migration, dismissable window, popover track transport, displays, renderer recovery, audio ownership/diagnostics, visual controls, power, settings, and updater tray state passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
