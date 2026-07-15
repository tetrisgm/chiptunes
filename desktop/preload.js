// Preload — exposes the narrow, guarded native bridges to the RRR renderer (contextIsolation on).
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
  isDesktop: true,
});

contextBridge.exposeInMainWorld('steam', {
  identity: () => ipcRenderer.invoke('rrr:identity'),
});
