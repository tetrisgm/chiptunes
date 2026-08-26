// Chiptunes.app desktop shell: normal Electron window + macOS animated wallpaper mode.
// The renderer is always the shared ../dist bundle; native code only positions macOS windows at
// the public desktop level and reports low-power/display-sleep state.
'use strict';

const { app, BrowserWindow, ipcMain, shell, screen, powerMonitor, Tray, Menu, nativeImage, dialog,
  desktopCapturer, session, webContents } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { SettingsStore } = require('./settings');
const { WallpaperManager } = require('./wallpaper');
const { WallpaperPowerController } = require('./power');
const { createWallpaperTray } = require('./tray');
const { AudioDiagnostics } = require('./audio-diagnostics');
const { makeDismissable } = require('./window-lifecycle');
const { preserveLegacyUserData } = require('./user-data');

const userData = preserveLegacyUserData(app);
if (userData.migrated) console.log('[desktop] preserving existing Chiptunes settings:', userData.path);

let autoUpdater = null;
try { ({ autoUpdater } = require('electron-updater')); }
catch (error) { console.log('[updater] unavailable:', error && error.message); }

const APP_ID = Number(process.env.RRR_STEAM_APPID || 480);   // 480 = Spacewar (dev; no partner account)
const DIST = process.env.RRR_WEB_APP_DIST || (app.isPackaged
  ? path.join(process.resourcesPath, 'web')
  : path.join(__dirname, '..', 'dist'));
const PRELOAD = path.join(__dirname, 'preload.js');

// OTA WEB CONTENT. The desktop's UI is just the web app, so prefer loading it LIVE from the site — then a web
// deploy updates the app with NO native rebuild ("push web/OTA, as few native updates as possible"). The bundled
// copy under DIST is the OFFLINE FALLBACK: any remote failure or a slow load (offline, CDN hiccup, error page)
// falls back to it, so the app can never be left blank. The preload's RRRNative bridge is injected regardless of
// origin, so every native feature keeps working over the live URL. RRR_WEB_OTA=0 forces the bundled copy (kill-switch).
const WEB_ORIGIN = (process.env.RRR_WEB_APP_ORIGIN || 'https://chiptunes.app').replace(/\/+$/, '');
const OTA_ENABLED = process.env.RRR_WEB_OTA !== '0';
const OTA_TIMEOUT_MS = Number(process.env.RRR_WEB_OTA_TIMEOUT_MS || 9000);
function _qs(query) { return Object.keys(query || {}).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(String(query[k]))).join('&'); }
// Load the web app into `win`, live-first with an embedded fallback. `onDeadEnd` (optional) runs only if BOTH the
// live URL AND the bundled copy fail to load — the caller's last-resort recovery. Returns nothing; never throws.
function loadApp(win, query, onDeadEnd) {
  query = query || {};
  const embedded = () => {
    const p = win.loadFile(path.join(DIST, 'index.html'), { query });
    if (p && typeof p.catch === 'function') p.catch(err => { console.error('[desktop] embedded load failed:', err && err.message); if (onDeadEnd) onDeadEnd(err); });
  };
  if (!OTA_ENABLED || win.isDestroyed()) { embedded(); return; }
  const wc = win.webContents;
  let settled = false;
  const timer = setTimeout(() => fallback('timeout'), OTA_TIMEOUT_MS);
  if (timer.unref) timer.unref();
  function done() { clearTimeout(timer); wc.removeListener('did-fail-load', onFail); wc.removeListener('did-finish-load', onOk); }
  function fallback(reason) { if (settled || win.isDestroyed()) { done(); return; } settled = true; done(); console.log('[desktop] OTA -> embedded bundle (' + reason + ')'); embedded(); }
  function onFail(_e, code, desc, _url, isMainFrame) { if (isMainFrame) fallback('did-fail-load ' + code + ' ' + desc); }
  function onOk() { if (settled) return; settled = true; done(); console.log('[desktop] OTA loaded live:', WEB_ORIGIN); }
  wc.on('did-fail-load', onFail);
  wc.once('did-finish-load', onOk);
  const p = win.loadURL(WEB_ORIGIN + '/' + (_qs(query) ? '?' + _qs(query) : ''));
  if (p && typeof p.catch === 'function') p.catch(err => fallback('loadURL rejected: ' + (err && err.message)));
}

function hasWallpaperArg(argv = process.argv) {
  return process.env.RRR_MODE === 'wallpaper' || argv.includes('--wallpaper');
}

function fpsArg(argv = process.argv) {
  const arg = argv.find(value => /^--fps=/.test(value));
  const fps = Number(process.env.RRR_WALLPAPER_FPS || (arg && arg.slice(6)));
  return [15, 30, 60].includes(fps) ? fps : null;
}

// ---- Steam (best-effort; the app runs fine with no Steam client, just no identity/Workshop) ----
let steam = null;
let steamTimer = null;
function bootSteam() {
  try {
    const steamworks = require('steamworks.js');
    // Spacewar is the local development fallback, not this app's shipping identity. Asking Steam
    // to restart AppID 480 would launch Spacewar and make direct/notarized Chiptunes.app builds exit at boot.
    if (APP_ID !== 480 && steamworks.restartAppIfNecessary(APP_ID)) { app.quit(); return false; }
    steam = steamworks.init(APP_ID);
    steamTimer = setInterval(() => { try { steamworks.runCallbacks(); } catch (error) {} }, 34);
    console.log('[steam] init ok, appid', APP_ID);
  } catch (error) { console.log('[steam] unavailable:', error && error.message); steam = null; }
  return true;
}

// ---- Workshop -> packs.js bridge -------------------------------------------------------------
// listWorkshopDirs(): absolute install dirs of subscribed, installed Workshop items.
// readPackFile(dir, rel): GUARDED to a current subscribed install dir with no path traversal.
function subscribedWorkshopDirs() {
  if (!steam || !steam.workshop) return [];
  try {
    const ids = steam.workshop.getSubscribedItems ? steam.workshop.getSubscribedItems() : [];
    const dirs = [];
    for (const id of ids) {
      try {
        if (steam.workshop.state) steam.workshop.state(id);   // retained as the installed-state probe
        const info = steam.workshop.installInfo ? steam.workshop.installInfo(id) : null;
        const folder = info && (info.folder || info.installPath);
        if (folder && fs.existsSync(folder)) dirs.push(path.resolve(folder));
      } catch (error) {}
    }
    return dirs;
  } catch (error) { console.log('[workshop] list failed:', error && error.message); return []; }
}

function withinDir(dir, rel) {
  const base = path.resolve(dir);
  const full = path.resolve(base, rel);
  return (full === base || full.startsWith(base + path.sep)) ? full : null;
}

ipcMain.handle('rrr:workshopDirs', () => subscribedWorkshopDirs());
ipcMain.handle('rrr:readPackFile', async (_event, dir, rel) => {
  if (typeof dir !== 'string' || typeof rel !== 'string') return null;
  if (!subscribedWorkshopDirs().some(value => path.resolve(value) === path.resolve(dir))) return null;
  const full = withinDir(dir, rel);
  if (!full) return null;
  try {
    const buffer = await fsp.readFile(full);
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  } catch (error) { return null; }
});
ipcMain.handle('rrr:identity', () => {
  if (!steam || !steam.localplayer) return null;
  try {
    return {
      steamId: String(steam.localplayer.getSteamId().steamId64 || steam.localplayer.getSteamId()),
      name: steam.localplayer.getName(),
    };
  } catch (error) { return null; }
});
ipcMain.handle('rrr:openWorkshop', async () => {
  const url = 'steam://url/SteamWorkshopPage/' + APP_ID;
  if (steam && steam.overlay && steam.overlay.activateToWebPage) {
    try { steam.overlay.activateToWebPage(url); return true; }
    catch (error) { console.error('[workshop] overlay failed, using external handler:', error && error.message); }
  }
  try {
    await shell.openExternal(url);
    return true;
  } catch (error) { console.error('[workshop] open failed:', error && error.message); return false; }
});

// ---- desktop lifecycle ----------------------------------------------------------------------
let win = null;
let nativeBridge = null;
let nativeBridgeError = null;
let settings = null;
let wallpaper = null;
let power = null;
let wallpaperPerformance = { paused: false, fpsCap: 30, reason: 'normal' };
let trayController = null;
let popover = null;
let lastNowPlaying = null;
let quitting = false;
let confirmingQuit = false;
let wallpaperOnlyLaunch = false;
let desktopReady = false;
let pendingSecondInstanceArgs = null;
let updateCheckTimer = null;
let updateInitialTimer = null;
let updateCheckInFlight = null;
let updateInstallStarted = false;
let audioDiagnostics = null;
let systemAudioStatus = 'off';
let updateState = {
  enabled: process.platform === 'darwin' && app.isPackaged && !!autoUpdater,
  phase: 'idle',
  version: null,
};

function setUpdateState(patch) {
  updateState = { ...updateState, ...patch };
  refreshTray();
}

// manualCheck is true only while a check the USER triggered (the "Check for Updates…" menu item) is resolving,
// so the update events can pop a VISIBLE dialog — "you're on the latest version", "downloading", "restart now",
// or an error. Background/interval checks leave it false and stay silent. The terminal events (not-available /
// downloaded / error) clear it once they've reported, so it never leaks into a later background check.
let manualCheck = false;
function checkForUpdates(manual) {
  if (!updateState.enabled || !autoUpdater) {
    if (manual) dialog.showMessageBox({ type: 'info', noLink: true, message: 'Automatic updates are unavailable',
      detail: 'Update checks run only in the installed, signed Chiptunes.app.' });
    return Promise.resolve(null);
  }
  if (manual) manualCheck = true;
  if (updateCheckInFlight) return updateCheckInFlight;
  setUpdateState({ phase: 'checking' });
  console.log('[updater] checking for updates' + (manual ? ' (manual)' : ''));
  updateCheckInFlight = Promise.resolve()
    .then(() => autoUpdater.checkForUpdatesAndNotify())
    .catch(error => {
      console.log('[updater] check skipped:', error && error.message);
      // The 'error' event handler owns the manual error dialog; clearing the flag there de-dupes with this catch.
      if (updateState.phase !== 'ready') setUpdateState({ phase: 'idle', version: null });
      return null;
    })
    .finally(() => { updateCheckInFlight = null; });
  return updateCheckInFlight;
}

function setupAutoUpdater() {
  if (!updateState.enabled || !autoUpdater) {
    console.log('[updater] disabled for unpackaged or unsupported build');
    return;
  }
  try {
    autoUpdater.logger = console;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('checking-for-update', () => setUpdateState({ phase: 'checking' }));
    autoUpdater.on('update-available', info => {
      console.log('[updater] downloading version', info && info.version);
      setUpdateState({ phase: 'downloading', version: info && info.version || null });
      if (manualCheck) dialog.showMessageBox({ type: 'info', noLink: true, message: 'Update available — downloading now',
        detail: `Chiptunes ${info && info.version || ''} is downloading in the background. You'll be asked to restart when it's ready.` });
    });
    autoUpdater.on('update-not-available', () => {
      console.log('[updater] current version is up to date');
      setUpdateState({ phase: 'idle', version: null });
      if (manualCheck) {
        manualCheck = false;
        dialog.showMessageBox({ type: 'info', noLink: true, message: "You're on the latest version",
          detail: `Chiptunes ${app.getVersion()} is the newest version.` });
      }
    });
    autoUpdater.on('update-downloaded', info => {
      console.log('[updater] version ready; it will install on quit:', info && info.version);
      setUpdateState({ phase: 'ready', version: info && info.version || null });
      if (manualCheck) {
        manualCheck = false;
        dialog.showMessageBox({ type: 'info', noLink: true, buttons: ['Later', 'Restart now'], defaultId: 1, cancelId: 0,
          message: `Update ready — Chiptunes ${info && info.version || ''}`,
          detail: 'Restart now to use it, or it installs automatically the next time you quit.' })
          .then(r => { if (r && r.response === 1 && autoUpdater && !updateInstallStarted) {
            updateInstallStarted = true;
            try { autoUpdater.quitAndInstall(false, true); } catch (e) { console.error('[updater] install failed:', e && e.message); app.quit(); }
          } });
      }
    });
    autoUpdater.on('error', error => {
      console.log('[updater] update skipped:', error && error.message);
      if (updateInstallStarted) {
        setUpdateState({ phase: 'idle', version: null });
        setImmediate(() => app.quit());
        return;
      }
      if (manualCheck) {
        manualCheck = false;
        dialog.showMessageBox({ type: 'info', noLink: true, message: "Couldn't check for updates",
          detail: (error && error.message ? error.message : 'The update server could not be reached.') + '\n\nPlease try again in a moment.' });
      }
      if (updateState.phase !== 'ready') setUpdateState({ phase: 'idle', version: null });
    });

    // Let launch settle before the first network request, then re-check twice daily.
    updateInitialTimer = setTimeout(checkForUpdates, 15 * 1000);
    updateCheckTimer = setInterval(checkForUpdates, 6 * 60 * 60 * 1000);
    updateInitialTimer.unref();
    updateCheckTimer.unref();
  } catch (error) {
    console.log('[updater] setup skipped:', error && error.message);
    setUpdateState({ enabled: false, phase: 'idle', version: null });
  }
}

function stopUpdateChecks() {
  if (updateInitialTimer) clearTimeout(updateInitialTimer);
  if (updateCheckTimer) clearInterval(updateCheckTimer);
  updateInitialTimer = null;
  updateCheckTimer = null;
}

function loadNativeBridge() {
  if (process.platform !== 'darwin') return;
  try { nativeBridge = require(path.join(__dirname, 'build', 'Release', 'rrr_wallpaper.node')); }
  catch (error) {
    nativeBridgeError = error;
    console.error('[wallpaper] native bridge unavailable:', error && error.message);
  }
}

function createWindow() {
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return win;
  }
  if (process.platform === 'darwin' && app.dock) app.dock.show();
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#0a0814',
    title: 'Chiptunes.app',
    // backgroundThrottling:false keeps the game animating at full rate even when the window is not the
    // focused/active one — so you can park it on the side and keep watching the games play themselves.
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: false, backgroundThrottling: false },
  });
  makeDismissable(win, { isQuitting: () => quitting });
  loadApp(win, { mode: 'browse' });   // Portal-style desktop control center — live-first, embedded fallback
  win.on('closed', () => {
    win = null;   // keep the dock icon (the app lives in BOTH the dock and the menu bar)
  });
  return win;
}

function refreshTray() {
  if (trayController) trayController.refresh();
  pushDesktopState();
}

function setWallpaperEnabled(enabled) {
  enabled = !!enabled;
  if (enabled && (!nativeBridge || process.platform !== 'darwin')) {
    console.error('[wallpaper] cannot enable:', nativeBridgeError && nativeBridgeError.message || 'macOS is required');
    refreshTray();
    return false;
  }
  settings.update({ wallpaperEnabled: enabled });
  if (enabled) wallpaper.start();
  else wallpaper.stop();
  // dock icon stays visible whether or not the wallpaper is running (app lives in dock AND menu bar)
  refreshTray();
  return true;
}

function setFpsCap(fpsCap) {
  settings.update({ fpsCap });
  if (power) power.setFpsCap(settings.value.fpsCap);
  refreshTray();
}

function setPowerSaver(powerSaver) {
  settings.update({ powerSaver: !!powerSaver });
  if (power) power.setPowerSaver(settings.value.powerSaver);
  refreshTray();
}

function setMotionFrozen(frozen) {
  settings.update({ motionFrozen: !!frozen });
  if (wallpaper) wallpaper.setMotionFrozen(settings.value.motionFrozen);
  refreshTray();
}

function setStation(id) {
  settings.update({ station: id });
  if (wallpaper) wallpaper.setStation(settings.value.station);
  refreshTray();
}

function setAudioMuted(muted) {
  settings.update({ audioMuted: !!muted });
  if (wallpaper) wallpaper.setUserMuted(settings.value.audioMuted);
  refreshTray();
}

function setVolume(volume) {
  settings.update({ volume });
  if (wallpaper) wallpaper.setVolume(settings.value.volume);
  refreshTray();
}

function setSystemAudioReactive(enabled) {
  settings.update({ systemAudioReactive: !!enabled });
  systemAudioStatus = settings.value.systemAudioReactive ? 'starting' : 'off';
  if (wallpaper) wallpaper.setSystemAudioReactive(settings.value.systemAudioReactive);
  if (audioDiagnostics) audioDiagnostics.record('system-audio-setting', { enabled: settings.value.systemAudioReactive });
  refreshTray();
}

function setScanlineStrength(value) {
  settings.update({ scanlineStrength: value });
  if (wallpaper) wallpaper.setScanlineStrength(settings.value.scanlineStrength);
  refreshTray();
}

function setSceneSeconds(value) {
  settings.update({ sceneSeconds: value });
  if (wallpaper) wallpaper.setSceneSeconds(settings.value.sceneSeconds);
  refreshTray();
}

function setDisplayEnabled(id, on) {
  id = String(id);
  const overrides = { ...(settings.value.displayOverrides || {}) };
  const primaryId = String(screen.getPrimaryDisplay().id);
  const defaultEnabled = settings.value.displayMode === 'all' || id === primaryId;
  if (!!on === defaultEnabled) delete overrides[id];
  else overrides[id] = !!on;
  settings.update({ displayOverrides: overrides });
  if (wallpaper) wallpaper.setDisplayEnabled(id, on);
  refreshTray();
}

// All displays (for the browse view's per-monitor cards) with enabled + primary + audio-owner flags.
function displayList() {
  if (process.platform !== 'darwin' || !screen) return [];
  const primaryId = String(screen.getPrimaryDisplay().id);
  const all = screen.getAllDisplays();
  const mode = settings && settings.value.displayMode === 'all' ? 'all' : 'primary';
  const overrides = settings && settings.value.displayOverrides || {};
  const enabled = id => Object.prototype.hasOwnProperty.call(overrides, id)
    ? !!overrides[id]
    : mode === 'all' || id === primaryId;
  const enabledIds = all.map(d => String(d.id)).filter(enabled);
  const audioOwnerId = enabledIds.includes(primaryId) ? primaryId : (enabledIds[0] || null);
  return all.map(d => {
    const id = String(d.id);
    return { id, label: d.label || ('Display ' + id), width: d.bounds.width, height: d.bounds.height,
      primary: id === primaryId, enabled: enabled(id), audioOwner: id === audioOwnerId };
  });
}

function setOpenAtLogin(openAtLogin) {
  app.setLoginItemSettings({ openAtLogin: !!openAtLogin, openAsHidden: !!openAtLogin });
  refreshTray();
}

function quitApp() {
  quitting = true;
  app.quit();
}

async function confirmQuit() {
  if (confirmingQuit) return false;
  confirmingQuit = true;
  const parent = popover && !popover.isDestroyed() && popover.isVisible()
    ? popover
    : (win && !win.isDestroyed() ? win : null);
  const options = {
    type: 'question',
    buttons: ['Cancel', 'Quit Chiptunes.app'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    message: 'Quit Chiptunes.app?',
    detail: 'The music and animated wallpaper will stop.',
  };
  try {
    const result = parent
      ? await dialog.showMessageBox(parent, options)
      : await dialog.showMessageBox(options);
    if (result.response !== 1) return false;
    quitApp();
    return true;
  } finally { confirmingQuit = false; }
}

function desktopState() {
  const login = app.getLoginItemSettings();
  return {
    appVersion: app.getVersion(),
    wallpaperAvailable: process.platform === 'darwin' && !!nativeBridge,
    wallpaperEnabled: !!(wallpaper && wallpaper.enabled),
    fpsCap: settings ? settings.value.fpsCap : 30,
    powerSaver: settings ? settings.value.powerSaver : false,
    motionFrozen: settings ? settings.value.motionFrozen : false,
    station: settings ? settings.value.station : 'st-any',
    audioMuted: settings ? settings.value.audioMuted : false,
    volume: settings ? settings.value.volume : 0.4,
    systemAudioReactive: settings ? settings.value.systemAudioReactive : false,
    systemAudioStatus,
    scanlineStrength: settings ? settings.value.scanlineStrength : 0.3,
    sceneSeconds: settings ? settings.value.sceneSeconds : 30,
    audioDiagnosticLog: audioDiagnostics ? audioDiagnostics.file : null,
    displays: displayList(),
    nowPlaying: lastNowPlaying,
    openAtLogin: !!login.openAtLogin,
    performance: wallpaper ? wallpaper.effectivePerformance() : wallpaperPerformance,
    wallpaper: wallpaper ? wallpaper.state() : null,
    nativeError: nativeBridgeError ? nativeBridgeError.message : null,
    update: { ...updateState },
  };
}

ipcMain.handle('rrr:wallpaperState', () => desktopState());
ipcMain.handle('rrr:now-playing', (_event, info) => { lastNowPlaying = info || null; pushDesktopState(); return true; });
ipcMain.handle('rrr:audio-diagnostic', (event, payload) => {
  if (!audioDiagnostics || !wallpaper || !wallpaper.isAudioOwnerWebContents(event.sender)) return false;
  payload = payload && typeof payload === 'object' ? payload : {};
  const name = typeof payload.event === 'string' ? payload.event : 'heartbeat';
  if (name === 'system-audio-state') {
    systemAudioStatus = ['off', 'starting', 'active', 'error'].includes(payload.status) ? payload.status : 'error';
    pushDesktopState();
  }
  return audioDiagnostics.record(name, payload, {
    rendererId: event.sender.id,
    rendererUrl: event.sender.getURL(),
    ...wallpaper.diagnosticStateFor(event.sender),
  });
});
ipcMain.handle('rrr:control', async (_event, cmd) => {
  if (!cmd || typeof cmd.action !== 'string') return false;
  switch (cmd.action) {
    case 'setStation': setStation(String(cmd.id || 'st-any')); break;
    case 'transport': if (wallpaper) wallpaper.transport(cmd.dir); break;
    case 'cycleVisualizer': if (wallpaper) wallpaper.cycleVisualizer(Number(cmd.dir) || 1); break;
    case 'setWallpaperEnabled': setWallpaperEnabled(!!cmd.value); break;
    case 'setFps': setFpsCap(cmd.value); break;
    case 'setPowerSaver': setPowerSaver(!!cmd.value); break;
    case 'setMotionFrozen': setMotionFrozen(!!cmd.value); break;
    case 'setAudioMuted': setAudioMuted(!!cmd.value); break;
    case 'setVolume': setVolume(cmd.value); break;
    case 'setSystemAudioReactive': setSystemAudioReactive(!!cmd.value); break;
    case 'setScanlineStrength': setScanlineStrength(cmd.value); break;
    case 'setSceneSeconds': setSceneSeconds(cmd.value); break;
    case 'setMix':
      if (String(cmd.role) === 'master') setVolume(cmd.value);
      else if (wallpaper) wallpaper.setMix(String(cmd.role || ''), cmd.value);
      break;
    case 'resetMix': if (wallpaper) wallpaper.resetMix(); break;
    case 'setTempo': if (wallpaper) wallpaper.setTempo(cmd.value == null ? null : cmd.value); break;
    case 'setDisplayEnabled': setDisplayEnabled(cmd.id, !!cmd.value); break;
    case 'setLogin': setOpenAtLogin(!!cmd.value); break;
    case 'openWindow': createWindow(); break;
    case 'checkForUpdates': await checkForUpdates(true); break;   // user-initiated -> show a visible result
    case 'confirmQuit': return confirmQuit();
    case 'quit': quitApp(); break;
    default: return false;
  }
  return true;
});

function pushDesktopState() {
  const state = desktopState();
  for (const target of [popover, win]) {
    if (!target || target.isDestroyed() || target.webContents.isLoading()) continue;
    try { target.webContents.send('rrr:desktop-state', state); } catch (error) {}
  }
}

// Electron 39+ uses Apple's CoreAudio Tap for loopback on macOS 14.2+. The renderer receives a
// system-owned MediaStream and feeds it to Web Audio's analyser only; no samples are persisted or
// transmitted. Restrict the grant to the wallpaper's single audio-owner renderer.
function setupSystemAudioCapture() {
  if (process.platform !== 'darwin' || !session.defaultSession) return;
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    let settled = false;
    const finish = value => { if (!settled) { settled = true; callback(value); } };
    Promise.resolve().then(async () => {
      let requester = null;
      try { requester = request.frame && webContents.fromFrame(request.frame); } catch (error) {}
      if (!requester && request.frame && request.frame.top) {
        const owner = wallpaper && wallpaper._audioOwnerWindow && wallpaper._audioOwnerWindow();
        if (owner && request.frame.top === owner.webContents.mainFrame) requester = owner.webContents;
      }
      const allowed = !!(settings && settings.value.systemAudioReactive && wallpaper &&
        wallpaper.isAudioOwnerWebContents(requester));
      if (!allowed || request.audioRequested === false) throw new Error('system audio capture request denied');
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 0, height: 0 },
        fetchWindowIcons: false,
      });
      if (!sources.length) throw new Error('no screen capture source available');
      const primaryId = String(screen.getPrimaryDisplay().id);
      const source = sources.find(item => String(item.display_id || item.displayId || '') === primaryId) || sources[0];
      if (audioDiagnostics) audioDiagnostics.record('system-audio-granted', {
        source: source.name,
        displayId: source.display_id || source.displayId || null,
      });
      finish({ video: source, audio: 'loopback' });
    }).catch(error => {
      if (audioDiagnostics) audioDiagnostics.record('system-audio-denied', { error: String(error && error.message || error) });
      finish({});
    });
  }, { useSystemPicker: false });
}

// The Portal-style menu-bar popover: a frameless, transparent, all-Spaces window anchored under the
// tray icon; dismisses on blur. Preloaded hidden so the first tray click is instant.
function createPopover() {
  if (popover && !popover.isDestroyed()) return popover;
  popover = new BrowserWindow({
    width: 700, height: 1050, show: false, frame: false, resizable: false,
    transparent: true, backgroundColor: '#00000000', hasShadow: true, skipTaskbar: true,
    fullscreenable: false, minimizable: false, maximizable: false, alwaysOnTop: true,
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: false },
  });
  popover.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  loadApp(popover, { mode: 'popover' });   // live-first, embedded fallback
  popover.on('blur', () => { if (!confirmingQuit && popover && !popover.isDestroyed()) popover.hide(); });
  popover.on('closed', () => { popover = null; });
  return popover;
}

function togglePopover(bounds) {
  const pop = createPopover();
  if (pop.isVisible()) { pop.hide(); return; }
  try {
    if (bounds && bounds.width) {
      const display = screen.getDisplayNearestPoint({
        x: Math.round(bounds.x + bounds.width / 2),
        y: Math.round(bounds.y + bounds.height / 2),
      });
      const area = display.workArea;
      const width = Math.max(320, Math.min(700, area.width - 16));
      const height = Math.max(480, Math.min(1050, area.height - 8));
      const x = Math.max(area.x + 8, Math.min(
        Math.round(bounds.x + bounds.width / 2 - width / 2),
        area.x + area.width - width - 8,
      ));
      const y = Math.max(area.y, Math.min(
        Math.round(bounds.y + bounds.height + 4),
        area.y + area.height - height,
      ));
      pop.setBounds({ x, y, width, height }, false);
    }
  } catch (error) {}
  pushDesktopState();
  pop.show();
}

function setupDesktop() {
  try { app.setAppLogsPath(); } catch (error) {}
  audioDiagnostics = new AudioDiagnostics({ directory: app.getPath('logs'), appVersion: app.getVersion() });
  audioDiagnostics.record('session-start', {
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  });
  console.log('[audio-diag] persistent log:', audioDiagnostics.file);
  settings = new SettingsStore(app.getPath('userData'));
  systemAudioStatus = settings.value.systemAudioReactive ? 'starting' : 'off';
  const requestedFps = fpsArg();
  if (requestedFps) settings.update({ fpsCap: requestedFps });
  if (hasWallpaperArg()) settings.update({ wallpaperEnabled: true });
  wallpaperOnlyLaunch = hasWallpaperArg();

  loadNativeBridge();
  if (nativeBridge) {
    wallpaper = new WallpaperManager({
      BrowserWindow,
      screen,
      nativeBridge,
      dist: DIST,
      webOrigin: WEB_ORIGIN,
      otaEnabled: OTA_ENABLED,
      otaTimeoutMs: OTA_TIMEOUT_MS,
      preload: PRELOAD,
      initialPerformance: wallpaperPerformance,
      station: settings.value.station,
      displayMode: settings.value.displayMode,
      displayOverrides: settings.value.displayOverrides,
      initialUserMuted: settings.value.audioMuted,
      volume: settings.value.volume,
      motionFrozen: settings.value.motionFrozen,
      systemAudioReactive: settings.value.systemAudioReactive,
      scanlineStrength: settings.value.scanlineStrength,
      sceneSeconds: settings.value.sceneSeconds,
      onDiagnostic: (event, data) => {
        if (audioDiagnostics) audioDiagnostics.record(event, data);
      },
    });
    power = new WallpaperPowerController({
      powerMonitor,
      nativeBridge,
      fpsCap: settings.value.fpsCap,
      onChange: performance => {
        wallpaperPerformance = performance;
        wallpaper.setPerformance(performance);
        if (audioDiagnostics) audioDiagnostics.record('power-performance', performance);
      },
    });
    power.start();
    power.setPowerSaver(settings.value.powerSaver);
    if (settings.value.wallpaperEnabled) wallpaper.start();
  }
  setupSystemAudioCapture();

  trayController = createWallpaperTray({
    Tray,
    Menu,
    nativeImage,
    getState: desktopState,
    onToggle: setWallpaperEnabled,
    onOpen: createWindow,
    onFps: setFpsCap,
    onSceneSeconds: setSceneSeconds,
    onPowerSaver: setPowerSaver,
    onMotionFrozen: setMotionFrozen,
    onAudioMuted: setAudioMuted,
    onLogin: setOpenAtLogin,
    onCheckForUpdates: () => checkForUpdates(true),   // tray/menu "Check for Updates" -> visible result
    onApplyUpdate: quitApp,
    onQuit: confirmQuit,
    onClick: togglePopover,
  });
  createPopover();   // preload the popover so the first tray click is instant

  // App lives in BOTH the dock and the menu bar: always keep the dock icon; only auto-open the window
  // on a normal (non-login/hidden) launch.
  if (process.platform === 'darwin' && app.dock) app.dock.show();
  const login = app.getLoginItemSettings();
  if (!(wallpaperOnlyLaunch || login.wasOpenedAtLogin || login.wasOpenedAsHidden)) {
    createWindow();
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  const handleSecondInstance = argv => {
    if (hasWallpaperArg(argv)) setWallpaperEnabled(true);
    else createWindow();
  };
  app.on('second-instance', (_event, argv) => {
    if (!desktopReady) { pendingSecondInstanceArgs = argv; return; }
    handleSecondInstance(argv);
  });
  app.whenReady().then(() => {
    if (!bootSteam()) return;
    setupDesktop();
    setupAutoUpdater();
    desktopReady = true;
    if (pendingSecondInstanceArgs) {
      const argv = pendingSecondInstanceArgs; pendingSecondInstanceArgs = null;
      handleSecondInstance(argv);
    }
    app.on('activate', () => createWindow());
  }).catch(error => { console.error('[desktop] boot failed:', error); app.quit(); });
  app.on('before-quit', event => {
    quitting = true;
    if (audioDiagnostics) audioDiagnostics.record('session-stop', { updatePhase: updateState.phase });
    stopUpdateChecks();
    if (power) power.stop();
    if (wallpaper) wallpaper.stop();
    if (popover && !popover.isDestroyed()) popover.destroy();
    if (steamTimer) clearInterval(steamTimer);
    steamTimer = null;
    if (updateState.phase === 'ready' && autoUpdater && !updateInstallStarted) {
      event.preventDefault();
      updateInstallStarted = true;
      console.log('[updater] applying downloaded update on quit');
      setImmediate(() => {
        try { autoUpdater.quitAndInstall(false, false); }
        catch (error) {
          console.error('[updater] install failed; quitting normally:', error && error.message);
          app.quit();
        }
      });
    }
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
