// Retro Rave Radio — desktop app (Electron). PHASE 0-2 foundation: boots Steam, opens the RRR
// web bundle (../dist) in a window, and bridges Steam WORKSHOP game packs into the renderer's
// packs.js `workshop` source via a guarded RRRNative IPC. Wallpaper mode + the full settings panes
// are the next phases (see desktop/PLAN.md). Built on the steam-kit client-web-app Electron pattern.
'use strict';
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;

const APP_ID = Number(process.env.RRR_STEAM_APPID || 480);   // 480 = Spacewar (dev; no partner account)
const DIST = process.env.RRR_WEB_APP_DIST || path.join(__dirname, '..', 'dist');

// ---- Steam (best-effort; the app runs fine with no Steam client, just no identity/Workshop) ----
let steam = null;
function bootSteam() {
  try {
    const steamworks = require('steamworks.js');
    if (steamworks.restartAppIfNecessary(APP_ID)) { app.quit(); return false; }
    steam = steamworks.init(APP_ID);
    setInterval(() => { try { steamworks.runCallbacks(); } catch (e) {} }, 34);   // ~30Hz callback pump
    console.log('[steam] init ok, appid', APP_ID);
  } catch (e) { console.log('[steam] unavailable:', e && e.message); steam = null; }
  return true;
}

// ---- Workshop -> packs.js bridge -------------------------------------------------------------
// listWorkshopDirs(): absolute install dirs of subscribed, installed Workshop items.
// readPackFile(dir, rel): read a file within a Workshop pack dir — GUARDED: dir must be a current
// subscribed install dir and rel must resolve inside it (no path traversal from the renderer).
function subscribedWorkshopDirs() {
  if (!steam || !steam.workshop) return [];
  try {
    const ids = steam.workshop.getSubscribedItems ? steam.workshop.getSubscribedItems() : [];
    const dirs = [];
    for (const id of ids) {
      try {
        const st = steam.workshop.state ? steam.workshop.state(id) : null;   // installed?
        const info = steam.workshop.installInfo ? steam.workshop.installInfo(id) : null;
        const folder = info && (info.folder || info.installPath);
        if (folder && fs.existsSync(folder)) dirs.push(path.resolve(folder));
      } catch (e) {}
    }
    return dirs;
  } catch (e) { console.log('[workshop] list failed:', e && e.message); return []; }
}
function withinDir(dir, rel) {
  const base = path.resolve(dir);
  const full = path.resolve(base, rel);
  return (full === base || full.startsWith(base + path.sep)) ? full : null;
}
ipcMain.handle('rrr:workshopDirs', () => subscribedWorkshopDirs());
ipcMain.handle('rrr:readPackFile', async (_ev, dir, rel) => {
  if (typeof dir !== 'string' || typeof rel !== 'string') return null;
  if (!subscribedWorkshopDirs().some(d => path.resolve(d) === path.resolve(dir))) return null;   // only subscribed dirs
  const full = withinDir(dir, rel);
  if (!full) return null;
  try { const b = await fsp.readFile(full); return new Uint8Array(b.buffer, b.byteOffset, b.byteLength); }
  catch (e) { return null; }
});
ipcMain.handle('rrr:identity', () => {
  if (!steam || !steam.localplayer) return null;
  try { return { steamId: String(steam.localplayer.getSteamId().steamId64 || steam.localplayer.getSteamId()), name: steam.localplayer.getName() }; }
  catch (e) { return null; }
});
ipcMain.handle('rrr:openWorkshop', () => {   // "get more games" -> the app's Steam Workshop page
  const url = 'steam://url/SteamWorkshopPage/' + APP_ID;
  try { if (steam && steam.overlay && steam.overlay.activateToWebPage) steam.overlay.activateToWebPage(url); else shell.openExternal(url); }
  catch (e) { shell.openExternal(url); }
});

// ---- window --------------------------------------------------------------------------------
let win = null;
function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 800, backgroundColor: '#0a0814', title: 'Retro Rave Radio',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false },
  });
  win.loadFile(path.join(DIST, 'index.html'), { query: { mode: 'window' } });
  win.on('closed', () => { win = null; });
}

if (!app.requestSingleInstanceLock()) { app.quit(); }
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => {
    if (!bootSteam()) return;
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
