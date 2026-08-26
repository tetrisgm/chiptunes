// Preload — exposes the narrow, guarded native bridges to the Chiptunes.app renderer (contextIsolation on).
// window.RRRNative is exactly what src/packs.js's `workshop` source consumes; window.steam mirrors
// the steam-kit identity surface. Everything is IPC to the main process — no Node in the renderer.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('RRRNative', {
  // packs.js workshop source contract:
  listWorkshopDirs: () => ipcRenderer.invoke('rrr:workshopDirs'),
  readPackFile: (dir, rel) => ipcRenderer.invoke('rrr:readPackFile', dir, rel),
  // "get more games" -> the Steam Workshop page (overlay or browser)
  openWorkshop: () => ipcRenderer.invoke('rrr:openWorkshop'),
  // Generic wallpaper control surface. The callback returns an unsubscribe function.
  wallpaperState: () => ipcRenderer.invoke('rrr:wallpaperState'),
  onWallpaperPerformance: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('rrr:wallpaper-performance', listener);
    ipcRenderer.invoke('rrr:wallpaperState').then(state => {
      if (state && state.performance) callback(state.performance);
    }).catch(() => {});
    return () => ipcRenderer.removeListener('rrr:wallpaper-performance', listener);
  },
  // --- menu-bar popover control surface ---
  control: cmd => ipcRenderer.invoke('rrr:control', cmd),                 // popover -> main (station, transport, mixer, updates, settings, quit)
  desktopState: () => ipcRenderer.invoke('rrr:wallpaperState'),
  onDesktopState: callback => {                                          // popover <- main (station, now-playing, toggles)
    if (typeof callback !== 'function') return () => {};
    const listener = (_e, s) => callback(s);
    ipcRenderer.on('rrr:desktop-state', listener);
    ipcRenderer.invoke('rrr:wallpaperState').then(s => callback(s)).catch(() => {});
    return () => ipcRenderer.removeListener('rrr:desktop-state', listener);
  },
  onCommand: callback => {                                               // wallpaper renderer <- main (enterStation, transport)
    if (typeof callback !== 'function') return () => {};
    const listener = (_e, cmd) => callback(cmd);
    ipcRenderer.on('rrr:command', listener);
    return () => ipcRenderer.removeListener('rrr:command', listener);
  },
  reportNowPlaying: info => ipcRenderer.invoke('rrr:now-playing', info),  // audio-owner renderer -> main
  reportAudioDiagnostic: info => ipcRenderer.invoke('rrr:audio-diagnostic', info),
  isDesktop: true,
});

contextBridge.exposeInMainWorld('steam', {
  identity: () => ipcRenderer.invoke('rrr:identity'),
});
