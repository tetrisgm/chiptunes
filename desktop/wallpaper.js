'use strict';

const SECONDARY_FPS_CAP = 20;   // audio-less secondary displays run cooler than the focal one
const OCCLUDED_FPS_CAP = 5;     // covered wallpaper keeps the radio alive while barely rendering
const RENDERER_RECOVERY_BASE_MS = 250;
const RENDERER_RECOVERY_MAX_MS = 10000;
const RENDERER_FAILURE_WINDOW_MS = 60000;

class WallpaperManager {
  constructor({ BrowserWindow, screen, nativeBridge, dist, webOrigin, otaEnabled, otaTimeoutMs, preload, initialPerformance, station, displayMode, displayOverrides,
    initialUserMuted, volume, motionFrozen, systemAudioReactive, scanlineStrength, sceneSeconds, onDiagnostic }) {
    this.BrowserWindow = BrowserWindow;
    this.screen = screen;
    this.nativeBridge = nativeBridge;
    this.dist = dist;
    this.webOrigin = webOrigin || '';        // live site to load OTA from; '' or otaEnabled=false -> bundled copy only
    this.otaEnabled = !!otaEnabled && !!webOrigin;
    this.otaTimeoutMs = Number(otaTimeoutMs) || 9000;
    this.preload = preload;
    this.performance = initialPerformance || { paused: false, fpsCap: 30, reason: 'normal' };
    this.station = station || 'st-any';   // the mood the audio-owner display plays (popover-driven)
    this.userMuted = !!initialUserMuted;  // deliberate persisted mute, independent of battery/occlusion
    this.volume = Number.isFinite(Number(volume)) ? Math.max(0, Math.min(2, Number(volume))) : 0.4;
    this.motionFrozen = !!motionFrozen;  // user-requested held frame; audio continues independently
    this.systemAudioReactive = !!systemAudioReactive;
    this.scanlineStrength = Number.isFinite(Number(scanlineStrength)) ? Math.max(0, Math.min(1, Number(scanlineStrength))) : 0.3;
    this.sceneSeconds = Number.isFinite(Number(sceneSeconds)) ? Math.max(5, Math.min(600, Math.round(Number(sceneSeconds)))) : 30;  // game rotation interval
    this.onDiagnostic = typeof onDiagnostic === 'function' ? onDiagnostic : () => {};
    this.displayMode = displayMode === 'all' ? 'all' : 'primary';
    this.displayOverrides = new Map(Object.entries(displayOverrides || {}).map(([id, enabled]) => [String(id), !!enabled]));
    this.windows = new Map();
    this.occluded = false;          // true when EVERY wallpaper window is fully covered (e.g. a fullscreen app)
    this._appliedPaused = false;
    this.enabled = false;
    this.reconcileTimer = null;
    this.attachRetryTimer = null;
    this.attachRetryDelay = 250;
    this.rendererRecoveries = new Map();
    this.onDisplayChange = () => this.scheduleReconcile();
  }

  start() {
    if (this.enabled) return;
    this.enabled = true;
    this.screen.on('display-added', this.onDisplayChange);
    this.screen.on('display-removed', this.onDisplayChange);
    this.screen.on('display-metrics-changed', this.onDisplayChange);
    // WebGL windows get NO automatic occlusion throttling from macOS, so we watch it ourselves and
    // drop their render rate when the wallpaper is fully covered. Audio remains independent: macOS
    // can report a desktop-level window as occluded while our own Settings window is merely open.
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
    if (this.attachRetryTimer) clearTimeout(this.attachRetryTimer);
    this.attachRetryTimer = null;
    this.attachRetryDelay = 250;
    for (const recovery of this.rendererRecoveries.values()) {
      if (recovery.timer) clearTimeout(recovery.timer);
    }
    this.rendererRecoveries.clear();
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
    const primaryId = String(this.screen.getPrimaryDisplay().id);
    const displays = this.screen.getAllDisplays().filter(d => this.isDisplayEnabled(String(d.id), primaryId));
    const enabledIds = displays.map(d => String(d.id));
    // Audio owner = the primary display when it is enabled, else the first enabled display.
    const audioOwnerId = enabledIds.includes(primaryId) ? primaryId : (enabledIds[0] || null);
    const expected = new Set(enabledIds);
    for (const id of this.rendererRecoveries.keys()) {
      if (!expected.has(id)) this.clearRendererRecovery(id);
    }
    for (const [id, entry] of this.windows) {
      const shouldOwnAudio = id === audioOwnerId;
      if (!expected.has(id) || entry.audioOwner !== shouldOwnAudio) {
        this.closeEntry(entry);
        this.windows.delete(id);
      }
    }
    for (const display of displays) {
      const id = String(display.id);
      let entry = this.windows.get(id);
      const recovery = this.rendererRecoveries.get(id);
      // A display/metrics event can arrive while a crashed renderer is in its recovery delay.
      // Do not let that unrelated reconciliation bypass the per-display backoff and turn a bad
      // renderer into a hot crash loop. The recovery timer clears itself immediately before it
      // calls reconcile(), which is the one pass allowed to recreate this display.
      if (!entry && recovery && recovery.timer) continue;
      if (!entry) {
        entry = this.createEntry(display, id === audioOwnerId);
        this.windows.set(id, entry);
      } else {
        entry.display = display;
        entry.window.setBounds(display.bounds, false);
        this.attach(entry);
      }
    }
    this.recomputeOcclusion();
    this.finishAttachPass();
  }

  createEntry(display, audioOwner) {
    const window = new this.BrowserWindow({
      ...display.bounds,
      show: false,
      frame: false,
      type: 'desktop',
      backgroundColor: '#0a0814',
      title: 'Chiptunes.app Wallpaper',
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
    // Until the native desktop-level attach succeeds the Electron `desktop`
    // window may be below the system wallpaper. Treat it as not visible so a
    // failed first attach cannot leave an invisible renderer playing audio.
    const entry = { window, display, audioOwner, attached: null, visible: false, attachError: null,
      attachFailures: 0, closing: false };
    window.setIgnoreMouseEvents(true);
    this.attach(entry);
    window.webContents.on('did-finish-load', () => {
      if (entry.closing || window.isDestroyed()) return;
      this.markRendererReady(String(entry.display.id));
      this.applyPerformanceTo(entry);
      if (entry.audioOwner) window.webContents.send('rrr:command', { type: 'masterVol', value: this.volume });
      window.webContents.send('rrr:command', { type: 'scanlines', value: this.scanlineStrength });
      window.webContents.send('rrr:command', { type: 'sceneSeconds', value: this.sceneSeconds });
      if (entry.audioOwner) window.webContents.send('rrr:command', { type: 'systemAudio', value: this.systemAudioReactive });
      this.onDiagnostic('renderer-ready', { displayId: String(entry.display.id), audioOwner: entry.audioOwner });
      this.attach(entry);
      window.showInactive();
      this.attach(entry);
      this.finishAttachPass();
    });
    window.webContents.on('render-process-gone', (_event, details) => {
      this.recoverRenderer(entry, details && details.reason || 'renderer-process-gone');
    });
    window.on('closed', () => {
      const id = String(entry.display.id);
      if (this.windows.get(id) === entry) this.windows.delete(id);
      if (!entry.closing && this.enabled) {
        entry.visible = false;
        this.recomputeOcclusion();
        this.scheduleRendererRecovery(id, 'window-closed');
      }
    });
    const query = {
      mode: 'wallpaper',
      display: String(display.id),
      audio: audioOwner ? '1' : '0',
      station: this.station,
      systemAudio: this.systemAudioReactive && audioOwner ? '1' : '0',
      scanlines: String(this.scanlineStrength),
      rotate: String(this.sceneSeconds),
    };
    // LIVE-FIRST (OTA) with the bundled copy as the offline fallback: a web deploy updates the wallpaper with no
    // native rebuild. Only after BOTH the live URL and the bundled copy fail do we escalate to recoverRenderer.
    const embedded = () => {
      const p = window.loadFile(this.dist + '/index.html', { query });
      if (p && typeof p.catch === 'function') p.catch(error => this.recoverRenderer(entry, 'load-failed: ' + String(error && error.message || error)));
    };
    if (!this.otaEnabled) { embedded(); return entry; }
    const wc = window.webContents;
    let settled = false;
    const qs = Object.keys(query).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(String(query[k]))).join('&');
    const timer = setTimeout(() => fallback('timeout'), this.otaTimeoutMs);
    if (timer.unref) timer.unref();
    function cleanup() { clearTimeout(timer); wc.removeListener('did-fail-load', onFail); wc.removeListener('did-finish-load', onOk); }
    function onFail(_e, code, desc, _url, isMainFrame) { if (isMainFrame) fallback('did-fail-load ' + code + ' ' + desc); }
    function onOk() { if (settled) return; settled = true; cleanup(); }
    const self = this;
    function fallback(reason) {
      if (settled || window.isDestroyed()) { cleanup(); return; }
      settled = true; cleanup();
      console.log('[wallpaper] OTA -> embedded bundle (' + reason + ')');
      self.onDiagnostic('wallpaper-ota-fallback', { displayId: String(display.id), reason });
      embedded();
    }
    wc.on('did-fail-load', onFail);
    wc.once('did-finish-load', onOk);
    const load = window.loadURL(this.webOrigin + '/?' + qs);
    if (load && typeof load.catch === 'function') load.catch(error => fallback('loadURL rejected: ' + String(error && error.message || error)));
    return entry;
  }

  recoverRenderer(entry, reason) {
    if (!this.enabled || !entry || entry.closing) return;
    const id = String(entry.display.id);
    if (this.windows.get(id) !== entry) return;
    console.error('[wallpaper] renderer failed for display', id + ':', reason);
    this.onDiagnostic('renderer-failed', { displayId: id, audioOwner: entry.audioOwner, reason });
    this.windows.delete(id);
    entry.visible = false;
    this.closeEntry(entry);
    this.recomputeOcclusion();
    this.scheduleRendererRecovery(id, reason);
  }

  scheduleRendererRecovery(id) {
    if (!this.enabled) return;
    id = String(id);
    const now = Date.now();
    const previous = this.rendererRecoveries.get(id);
    if (previous && previous.timer) return;
    const attempts = previous && now - previous.lastFailureAt < RENDERER_FAILURE_WINDOW_MS
      ? previous.attempts + 1
      : 1;
    const delay = Math.min(RENDERER_RECOVERY_BASE_MS * (2 ** (attempts - 1)), RENDERER_RECOVERY_MAX_MS);
    const recovery = { attempts, lastFailureAt: now, timer: null };
    recovery.timer = setTimeout(() => {
      recovery.timer = null;
      if (this.enabled) this.reconcile();
    }, delay);
    this.rendererRecoveries.set(id, recovery);
  }

  markRendererReady(id) {
    id = String(id);
    const recovery = this.rendererRecoveries.get(id);
    if (!recovery || !recovery.timer) return;
    clearTimeout(recovery.timer);
    recovery.timer = null;
  }

  clearRendererRecovery(id) {
    id = String(id);
    const recovery = this.rendererRecoveries.get(id);
    if (recovery && recovery.timer) clearTimeout(recovery.timer);
    this.rendererRecoveries.delete(id);
  }

  attach(entry) {
    if (entry.window.isDestroyed()) return;
    try {
      entry.window.setIgnoreMouseEvents(true);
      const attached = this.nativeBridge.attachWindow(entry.window.getNativeWindowHandle());
      entry.attached = attached;
      entry.visible = attached && typeof attached.visible === 'boolean' ? attached.visible : true;
      if (entry.attachError) console.log('[wallpaper] native attach recovered for display', entry.display.id);
      entry.attachError = null;
      entry.attachFailures = 0;
      return true;
    } catch (error) {
      const message = String(error && error.message || error || 'native attach failed');
      entry.attachFailures++;
      if (entry.attachError !== message) console.error('[wallpaper] native attach failed for display', entry.display.id + ':', message);
      entry.attachError = message;
      // Preserve a previously-good native attachment: a reassertion failure
      // does not prove AppKit detached the window. A first attach has no such
      // fallback and remains non-visible until a retry succeeds.
      if (!entry.attached) entry.visible = false;
      this.scheduleAttachRetry();
      return false;
    }
  }

  scheduleAttachRetry() {
    if (!this.enabled || this.attachRetryTimer) return;
    const delay = this.attachRetryDelay;
    this.attachRetryDelay = Math.min(delay * 2, 5000);
    this.attachRetryTimer = setTimeout(() => {
      this.attachRetryTimer = null;
      if (this.enabled) this.reassertAll();
    }, delay);
  }

  finishAttachPass() {
    const failed = [...this.windows.values()].some(entry => !!entry.attachError);
    if (failed) { this.scheduleAttachRetry(); return; }
    if (this.attachRetryTimer) clearTimeout(this.attachRetryTimer);
    this.attachRetryTimer = null;
    this.attachRetryDelay = 250;
  }

  reassertAll() {
    if (!this.enabled) return;
    for (const entry of this.windows.values()) {
      if (!entry.window.isDestroyed()) {
        entry.window.setBounds(entry.display.bounds, false);
        this.attach(entry);
      }
    }
    this.recomputeOcclusion();
    this.finishAttachPass();
  }

  setPerformance(performance) {
    this.performance = performance;
    this.applyAll();
  }

  // Fold live occlusion into the power controller's performance. Treat the native signal as a
  // rendering hint only: desktop-level windows can appear occluded while ordinary windows are open,
  // so tying it to the transport makes the radio silently pause whenever Settings is shown.
  effectivePerformance() {
    const base = this.performance || {};
    const effective = { ...base, frozen: this.motionFrozen };
    if (!this.occluded) return effective;
    return { ...effective, fpsCap: Math.min(Number(effective.fpsCap) || 30, OCCLUDED_FPS_CAP),
      reason: (base.reason ? base.reason + ',' : '') + 'occluded' };
  }

  onOcclusion(event) {
    if (!event || !this.enabled) return;
    const number = Number(event.windowNumber);
    for (const entry of this.windows.values()) {
      if (entry.attached && Number(entry.attached.windowNumber) === number) { entry.visible = !!event.visible; break; }
    }
    this.recomputeOcclusion();
  }

  recomputeOcclusion() {
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
    entry.window.webContents.setAudioMuted(!entry.audioOwner || !!eff.audioMuted || !!eff.paused || this.userMuted);
    // Each display is its own renderer (no shared-surface mirroring across Electron windows), so cap
    // the audio-less secondary displays lower — they're ambient visuals, not the focal screen.
    const perf = entry.audioOwner ? eff : { ...eff, fpsCap: Math.min(Number(eff.fpsCap) || 30, SECONDARY_FPS_CAP) };
    if (!entry.window.webContents.isLoading()) {
      entry.window.webContents.send('rrr:wallpaper-performance', perf);
    }
  }

  // --- popover-driven station / transport / mute, routed to the audio-owner display ---
  _audioOwnerWindow() {
    for (const entry of this.windows.values()) {
      if (entry.audioOwner && entry.window && !entry.window.isDestroyed()) return entry.window;
    }
    return null;
  }

  _sendToAudioOwner(cmd) {
    const w = this._audioOwnerWindow();
    if (w && !w.webContents.isLoading()) w.webContents.send('rrr:command', cmd);
  }

  _sendToAll(cmd) {
    for (const entry of this.windows.values()) {
      if (!entry.window.isDestroyed() && !entry.window.webContents.isLoading()) entry.window.webContents.send('rrr:command', cmd);
    }
  }

  setStation(id) {
    this.station = id || 'st-any';                                        // future windows boot to it via the query param
    this._sendToAudioOwner({ type: 'enterStation', id: this.station });    // live-switch the current audio owner
  }

  transport(dir) {
    this._sendToAudioOwner({ type: 'transport', dir: dir === 'prev' ? 'prev' : dir === 'toggle' ? 'toggle' : 'next' });
  }

  setUserMuted(muted) {
    this.userMuted = !!muted;
    this.applyAll();
  }

  setMotionFrozen(frozen) {
    this.motionFrozen = !!frozen;
    this.applyAll();
  }

  setVolume(volume) {
    const value = Number(volume);
    if (!Number.isFinite(value)) return;
    this.volume = Math.max(0, Math.min(2, value));
    this._sendToAudioOwner({ type: 'masterVol', value: this.volume });
  }

  setSystemAudioReactive(enabled) {
    this.systemAudioReactive = !!enabled;
    this._sendToAudioOwner({ type: 'systemAudio', value: this.systemAudioReactive });
  }

  setScanlineStrength(value) {
    value = Number(value);
    if (!Number.isFinite(value)) return;
    this.scanlineStrength = Math.max(0, Math.min(1, value));
    this._sendToAll({ type: 'scanlines', value: this.scanlineStrength });
  }

  setSceneSeconds(value) {
    value = Number(value);
    if (!Number.isFinite(value)) return;
    this.sceneSeconds = Math.max(5, Math.min(600, Math.round(value)));   // future windows boot to it via ?rotate; live-update the rest
    this._sendToAll({ type: 'sceneSeconds', value: this.sceneSeconds });
  }

  cycleVisualizer(dir) {
    this._sendToAudioOwner({ type: 'visualizer', dir: dir < 0 ? -1 : 1 });
  }

  isAudioOwnerWebContents(contents) {
    if (!contents) return false;
    for (const entry of this.windows.values()) {
      if (entry.audioOwner && entry.window && !entry.window.isDestroyed() && entry.window.webContents === contents) return true;
    }
    return false;
  }

  diagnosticStateFor(contents) {
    for (const entry of this.windows.values()) {
      if (!entry.window || entry.window.isDestroyed() || entry.window.webContents !== contents) continue;
      return {
        displayId: String(entry.display.id),
        audioOwner: !!entry.audioOwner,
        electronMuted: typeof contents.isAudioMuted === 'function' ? !!contents.isAudioMuted() : null,
        performance: this.effectivePerformance(),
      };
    }
    return { displayId: null, audioOwner: false, electronMuted: null, performance: this.effectivePerformance() };
  }

  setMix(role, value) {
    const roles = ['lead', 'bass', 'kick', 'snare', 'hat', 'arp', 'pad', 'fx'];
    if (!roles.includes(role)) return;
    value = Number(value);
    if (!Number.isFinite(value)) return;
    this._sendToAudioOwner({ type: 'mix', role, value: Math.max(0, Math.min(2, value)) });
  }

  resetMix() {
    this._sendToAudioOwner({ type: 'resetMix' });
  }

  setTempo(value) {
    value = value == null ? null : Number(value);
    if (value != null && !Number.isFinite(value)) return;
    this._sendToAudioOwner({ type: 'tempo', value });
  }

  setDisplayEnabled(id, on) {
    id = String(id);
    const primaryId = String(this.screen.getPrimaryDisplay().id);
    const defaultEnabled = this.displayMode === 'all' || id === primaryId;
    if (!!on === defaultEnabled) this.displayOverrides.delete(id);
    else this.displayOverrides.set(id, !!on);
    if (this.enabled) this.reconcile();
  }

  isDisplayEnabled(id, primaryId) {
    id = String(id);
    if (this.displayOverrides.has(id)) return this.displayOverrides.get(id);
    return this.displayMode === 'all' || id === String(primaryId);
  }

  closeEntry(entry) {
    entry.closing = true;
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
        attachError: entry.attachError,
        attachFailures: entry.attachFailures,
      })),
      performance: this.effectivePerformance(),
      motionFrozen: this.motionFrozen,
      audioMuted: this.userMuted,
      volume: this.volume,
      systemAudioReactive: this.systemAudioReactive,
      scanlineStrength: this.scanlineStrength,
      sceneSeconds: this.sceneSeconds,
      occluded: this.occluded,
    };
  }
}

module.exports = { WallpaperManager };
