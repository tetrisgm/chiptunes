'use strict';

const SECONDARY_FPS_CAP = 20;   // audio-less secondary displays run cooler than the focal one

class WallpaperManager {
  constructor({ BrowserWindow, screen, nativeBridge, dist, preload, initialPerformance }) {
    this.BrowserWindow = BrowserWindow;
    this.screen = screen;
    this.nativeBridge = nativeBridge;
    this.dist = dist;
    this.preload = preload;
    this.performance = initialPerformance || { paused: false, fpsCap: 30, reason: 'normal' };
    this.windows = new Map();
    this.occluded = false;          // true when EVERY wallpaper window is fully covered (e.g. a fullscreen app)
    this._appliedPaused = false;
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
    // WebGL windows get NO automatic occlusion throttling from macOS, so we watch it ourselves and
    // pause the render loop + audio when the wallpaper is fully covered (e.g. a fullscreen app).
    if (this.nativeBridge.startOcclusionMonitor) {
      try { this.nativeBridge.startOcclusionMonitor(event => this.onOcclusion(event)); } catch (error) {}
    }
    this.reconcile();
  }

  stop() {
    if (!this.enabled) return;
    this.enabled = false;
    try { if (this.nativeBridge.stopOcclusionMonitor) this.nativeBridge.stopOcclusionMonitor(); } catch (error) {}
    this.occluded = false;
    this._appliedPaused = false;
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
    const entry = { window, display, audioOwner, attached: null, visible: true };
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
    this.performance = performance;
    this.applyAll();
  }

  // Fold live occlusion into the power controller's performance: when every window is covered we
  // force paused + audioMuted so the render loop and audio actually stop (macOS won't do it for us).
  effectivePerformance() {
    const base = this.performance || {};
    if (!this.occluded) return base;
    return { ...base, paused: true, audioMuted: true, reason: (base.reason ? base.reason + ',' : '') + 'occluded' };
  }

  onOcclusion(event) {
    if (!event || !this.enabled) return;
    const number = Number(event.windowNumber);
    for (const entry of this.windows.values()) {
      if (entry.attached && Number(entry.attached.windowNumber) === number) { entry.visible = !!event.visible; break; }
    }
    const windows = [...this.windows.values()];
    const occluded = windows.length > 0 && windows.every(entry => entry.visible === false);
    if (occluded === this.occluded) return;
    this.occluded = occluded;
    this.applyAll();
  }

  applyAll() {
    const eff = this.effectivePerformance();
    for (const entry of this.windows.values()) this.applyPerformanceTo(entry, eff);
    if (this._appliedPaused && !eff.paused) this.reassertAll();
    this._appliedPaused = !!eff.paused;
  }

  applyPerformanceTo(entry, eff) {
    if (entry.window.isDestroyed()) return;
    eff = eff || this.effectivePerformance();
    entry.window.webContents.setAudioMuted(!entry.audioOwner || !!eff.audioMuted || !!eff.paused);
    // Each display is its own renderer (no shared-surface mirroring across Electron windows), so cap
    // the audio-less secondary displays lower — they're ambient visuals, not the focal screen.
    const perf = entry.audioOwner ? eff : { ...eff, fpsCap: Math.min(Number(eff.fpsCap) || 30, SECONDARY_FPS_CAP) };
    if (!entry.window.webContents.isLoading()) {
      entry.window.webContents.send('rrr:wallpaper-performance', perf);
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
      occluded: this.occluded,
    };
  }
}

module.exports = { WallpaperManager };
