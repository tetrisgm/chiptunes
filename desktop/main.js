// Retro Rave Radio desktop shell: normal Electron window + macOS animated wallpaper mode.
// The renderer is always the shared ../dist bundle; native code only positions macOS windows at
// the public desktop level and reports low-power/display-sleep state.
'use strict';

const { app, BrowserWindow, ipcMain, shell, screen, powerMonitor, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { SettingsStore } = require('./settings');
const { WallpaperManager } = require('./wallpaper');
const { WallpaperPowerController } = require('./power');
const { createWallpaperTray } = require('./tray');

const APP_ID = Number(process.env.RRR_STEAM_APPID || 480);   // 480 = Spacewar (dev; no partner account)
const DIST = process.env.RRR_WEB_APP_DIST || (app.isPackaged
  ? path.join(process.resourcesPath, 'web')
  : path.join(__dirname, '..', 'dist'));
const PRELOAD = path.join(__dirname, 'preload.js');

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
    // to restart AppID 480 would launch Spacewar and make direct/notarized RRR builds exit at boot.
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
ipcMain.handle('rrr:openWorkshop', () => {
  const url = 'steam://url/SteamWorkshopPage/' + APP_ID;
  try {
    if (steam && steam.overlay && steam.overlay.activateToWebPage) steam.overlay.activateToWebPage(url);
    else shell.openExternal(url);
  } catch (error) { shell.openExternal(url); }
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
let wallpaperOnlyLaunch = false;

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
    title: 'Retro Rave Radio',
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: false },
  });
  win.loadFile(path.join(DIST, 'index.html'), { query: { mode: 'browse' } });   // Portal-style desktop control center
  win.on('closed', () => {
    win = null;
    if (!quitting && wallpaper && wallpaper.enabled && process.platform === 'darwin' && app.dock) app.dock.hide();
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
  if (enabled && !win && process.platform === 'darwin' && app.dock) app.dock.hide();
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

function setStation(id) {
  settings.update({ station: id });
  if (wallpaper) wallpaper.setStation(settings.value.station);
  refreshTray();
}

function setAudioMuted(muted) {
  if (wallpaper) wallpaper.setUserMuted(muted);
  refreshTray();
}

function setDisplayEnabled(id, on) {
  id = String(id);
  const cur = new Set((settings.value.disabledDisplays || []).map(String));
  if (on) cur.delete(id); else cur.add(id);
  settings.update({ disabledDisplays: [...cur] });
  if (wallpaper) wallpaper.setDisplayEnabled(id, on);
  refreshTray();
}

// All displays (for the browse view's per-monitor cards) with enabled + primary + audio-owner flags.
function displayList() {
  if (process.platform !== 'darwin' || !screen) return [];
  const disabled = new Set(((settings && settings.value.disabledDisplays) || []).map(String));
  const primaryId = String(screen.getPrimaryDisplay().id);
  const all = screen.getAllDisplays();
  const enabledIds = all.map(d => String(d.id)).filter(id => !disabled.has(id));
  const audioOwnerId = enabledIds.includes(primaryId) ? primaryId : (enabledIds[0] || null);
  return all.map(d => {
    const id = String(d.id);
    return { id, label: d.label || ('Display ' + id), width: d.bounds.width, height: d.bounds.height,
      primary: id === primaryId, enabled: !disabled.has(id), audioOwner: id === audioOwnerId };
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

function desktopState() {
  const login = app.getLoginItemSettings();
  return {
    wallpaperAvailable: process.platform === 'darwin' && !!nativeBridge,
    wallpaperEnabled: !!(wallpaper && wallpaper.enabled),
    fpsCap: settings ? settings.value.fpsCap : 30,
    powerSaver: settings ? settings.value.powerSaver : false,
    station: settings ? settings.value.station : 'st-any',
    audioMuted: !!(wallpaper && wallpaper.userMuted),
    displays: displayList(),
    nowPlaying: lastNowPlaying,
    openAtLogin: !!login.openAtLogin,
    performance: wallpaperPerformance,
    wallpaper: wallpaper ? wallpaper.state() : null,
    nativeError: nativeBridgeError ? nativeBridgeError.message : null,
  };
}

ipcMain.handle('rrr:wallpaperState', () => desktopState());
ipcMain.handle('rrr:now-playing', (_event, info) => { lastNowPlaying = info || null; pushDesktopState(); return true; });
ipcMain.handle('rrr:control', (_event, cmd) => {
  if (!cmd || typeof cmd.action !== 'string') return false;
  switch (cmd.action) {
    case 'setStation': setStation(String(cmd.id || 'st-any')); break;
    case 'transport': if (wallpaper) wallpaper.transport(cmd.dir); break;
    case 'setWallpaperEnabled': setWallpaperEnabled(!!cmd.value); break;
    case 'setFps': setFpsCap(cmd.value); break;
    case 'setPowerSaver': setPowerSaver(!!cmd.value); break;
    case 'setAudioMuted': setAudioMuted(!!cmd.value); break;
    case 'setDisplayEnabled': setDisplayEnabled(cmd.id, !!cmd.value); break;
    case 'setLogin': setOpenAtLogin(!!cmd.value); break;
    case 'openWindow': createWindow(); break;
    case 'quit': quitApp(); break;
    default: return false;
  }
  return true;
});

function pushDesktopState() {
  if (popover && !popover.isDestroyed() && !popover.webContents.isLoading()) {
    try { popover.webContents.send('rrr:desktop-state', desktopState()); } catch (error) {}
  }
}

// The Portal-style menu-bar popover: a frameless, transparent, all-Spaces window anchored under the
// tray icon; dismisses on blur. Preloaded hidden so the first tray click is instant.
function createPopover() {
  if (popover && !popover.isDestroyed()) return popover;
  popover = new BrowserWindow({
    width: 320, height: 448, show: false, frame: false, resizable: false,
    transparent: true, backgroundColor: '#00000000', hasShadow: true, skipTaskbar: true,
    fullscreenable: false, minimizable: false, maximizable: false, alwaysOnTop: true,
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: false },
  });
  popover.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  popover.loadFile(path.join(DIST, 'index.html'), { query: { mode: 'popover' } });
  popover.on('blur', () => { if (popover && !popover.isDestroyed()) popover.hide(); });
  popover.on('closed', () => { popover = null; });
  return popover;
}

function togglePopover(bounds) {
  const pop = createPopover();
  if (pop.isVisible()) { pop.hide(); return; }
  try {
    if (bounds && bounds.width) {
      const { width } = pop.getBounds();
      pop.setPosition(Math.round(bounds.x + bounds.width / 2 - width / 2), Math.round(bounds.y + bounds.height + 4), false);
    }
  } catch (error) {}
  pushDesktopState();
  pop.show();
}

function setupDesktop() {
  settings = new SettingsStore(app.getPath('userData'));
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
      preload: PRELOAD,
      initialPerformance: wallpaperPerformance,
      station: settings.value.station,
      disabledDisplays: settings.value.disabledDisplays,
    });
    power = new WallpaperPowerController({
      powerMonitor,
      nativeBridge,
      fpsCap: settings.value.fpsCap,
      onChange: performance => {
        wallpaperPerformance = performance;
        wallpaper.setPerformance(performance);
      },
    });
    power.start();
    power.setPowerSaver(settings.value.powerSaver);
    if (settings.value.wallpaperEnabled) wallpaper.start();
  }

  trayController = createWallpaperTray({
    Tray,
    Menu,
    nativeImage,
    getState: desktopState,
    onToggle: setWallpaperEnabled,
    onOpen: createWindow,
    onFps: setFpsCap,
    onPowerSaver: setPowerSaver,
    onLogin: setOpenAtLogin,
    onQuit: quitApp,
    onClick: togglePopover,
  });
  createPopover();   // preload the popover so the first tray click is instant

  const login = app.getLoginItemSettings();
  if (wallpaperOnlyLaunch || login.wasOpenedAtLogin || login.wasOpenedAsHidden) {
    if (process.platform === 'darwin' && app.dock) app.dock.hide();
  } else {
    createWindow();
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    if (hasWallpaperArg(argv)) setWallpaperEnabled(true);
    else createWindow();
  });
  app.whenReady().then(() => {
    if (!bootSteam()) return;
    setupDesktop();
    app.on('activate', () => createWindow());
  });
  app.on('before-quit', () => {
    quitting = true;
    if (power) power.stop();
    if (wallpaper) wallpaper.stop();
    if (popover && !popover.isDestroyed()) popover.destroy();
    if (steamTimer) clearInterval(steamTimer);
    steamTimer = null;
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
