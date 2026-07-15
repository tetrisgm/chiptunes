'use strict';

class WallpaperManager {
  constructor({ BrowserWindow, screen, nativeBridge, dist, preload, initialPerformance }) {
    this.BrowserWindow = BrowserWindow;
    this.screen = screen;
    this.nativeBridge = nativeBridge;
    this.dist = dist;
    this.preload = preload;
    this.performance = initialPerformance || { paused: false, fpsCap: 30, reason: 'normal' };
    this.windows = new Map();
    this.enabled = false;
    this.reconcileTimer = null;
    this.onDisplayChange = () => this.scheduleReconcile();
  }

  start() {
    if (this.enabled) return;
    this.enabled = true;
    this.screen.on('display-added', this.onDisplayChange);
    this.screen.on('display-removed', this.onDisplayChange);
    this.screen.on('display-metrics-changed', this.onDisplayChange);
    this.reconcile();
  }

  stop() {
    if (!this.enabled) return;
    this.enabled = false;
    this.screen.removeListener('display-added', this.onDisplayChange);
    this.screen.removeListener('display-removed', this.onDisplayChange);
    this.screen.removeListener('display-metrics-changed', this.onDisplayChange);
    if (this.reconcileTimer) clearTimeout(this.reconcileTimer);
    this.reconcileTimer = null;
    for (const entry of this.windows.values()) this.closeEntry(entry);
    this.windows.clear();
  }

  scheduleReconcile() {
    if (this.reconcileTimer) clearTimeout(this.reconcileTimer);
    this.reconcileTimer = setTimeout(() => {
      this.reconcileTimer = null;
      if (this.enabled) this.reconcile();
    }, 200);
  }

  reconcile() {
    const displays = this.screen.getAllDisplays();
    const primaryId = String(this.screen.getPrimaryDisplay().id);
    const expected = new Set(displays.map(display => String(display.id)));
    for (const [id, entry] of this.windows) {
      const shouldOwnAudio = id === primaryId;
      if (!expected.has(id) || entry.audioOwner !== shouldOwnAudio) {
        this.closeEntry(entry);
        this.windows.delete(id);
      }
    }
    for (const display of displays) {
      const id = String(display.id);
      let entry = this.windows.get(id);
      if (!entry) {
        entry = this.createEntry(display, id === primaryId);
        this.windows.set(id, entry);
      } else {
        entry.display = display;
        entry.window.setBounds(display.bounds, false);
        this.attach(entry);
      }
    }
  }

  createEntry(display, audioOwner) {
    const window = new this.BrowserWindow({
      ...display.bounds,
      show: false,
      frame: false,
      type: 'desktop',
      backgroundColor: '#0a0814',
      title: 'Retro Rave Radio Wallpaper',
      transparent: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      enableLargerThanScreen: true,
      webPreferences: {
        preload: this.preload,
        contextIsolation: true,
        sandbox: false,
        backgroundThrottling: false,
        autoplayPolicy: 'no-user-gesture-required',
      },
    });
    const entry = { window, display, audioOwner, attached: null };
    window.setIgnoreMouseEvents(true);
    this.attach(entry);
    window.webContents.on('did-finish-load', () => {
      this.applyPerformanceTo(entry);
      this.attach(entry);
      window.showInactive();
      this.attach(entry);
    });
    window.on('closed', () => {
      const id = String(display.id);
      if (this.windows.get(id) === entry) this.windows.delete(id);
    });
    window.loadFile(this.dist + '/index.html', {
      query: {
        mode: 'wallpaper',
        display: String(display.id),
        audio: audioOwner ? '1' : '0',
      },
    });
    return entry;
  }

  attach(entry) {
    if (entry.window.isDestroyed()) return;
    entry.window.setIgnoreMouseEvents(true);
    entry.attached = this.nativeBridge.attachWindow(entry.window.getNativeWindowHandle());
  }

  reassertAll() {
    if (!this.enabled) return;
    for (const entry of this.windows.values()) {
      if (!entry.window.isDestroyed()) {
        entry.window.setBounds(entry.display.bounds, false);
        this.attach(entry);
      }
    }
  }

  setPerformance(performance) {
    const wasPaused = !!this.performance.paused;
    this.performance = performance;
    for (const entry of this.windows.values()) this.applyPerformanceTo(entry);
    if (wasPaused && !performance.paused) this.reassertAll();
  }

  applyPerformanceTo(entry) {
    if (entry.window.isDestroyed()) return;
    entry.window.webContents.setAudioMuted(!entry.audioOwner || !!this.performance.paused);
    if (!entry.window.webContents.isLoading()) {
      entry.window.webContents.send('rrr:wallpaper-performance', this.performance);
    }
  }

  closeEntry(entry) {
    if (entry.window && !entry.window.isDestroyed()) entry.window.destroy();
  }

  state() {
    return {
      enabled: this.enabled,
      displays: [...this.windows.values()].map(entry => ({
        id: String(entry.display.id),
        bounds: entry.display.bounds,
        audioOwner: entry.audioOwner,
        native: entry.attached,
      })),
      performance: this.performance,
    };
  }
}

module.exports = { WallpaperManager };
