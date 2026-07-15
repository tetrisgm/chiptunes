'use strict';

class WallpaperPowerController {
  constructor({ powerMonitor, nativeBridge, fpsCap, onChange }) {
    this.powerMonitor = powerMonitor;
    this.nativeBridge = nativeBridge;
    this.baseFpsCap = fpsCap;
    this.onChange = onChange;
    this.powerSaver = false;   // opt-in: drop FPS on battery. Off by default (owner: keep visuals smooth).
    this.listeners = [];
    this.state = {
      onBattery: false,
      lowPowerMode: false,
      screensSleeping: false,
      suspended: false,
      thermalState: 'unknown',
    };
    this.performance = null;
  }

  start() {
    this.state.onBattery = this.powerMonitor.isOnBatteryPower();
    if (this.powerMonitor.getCurrentThermalState) {
      this.state.thermalState = this.powerMonitor.getCurrentThermalState();
    }
    const listen = (event, handler) => {
      this.powerMonitor.on(event, handler);
      this.listeners.push([event, handler]);
    };
    listen('on-battery', () => { this.state.onBattery = true; this.recompute(); });
    listen('on-ac', () => { this.state.onBattery = false; this.recompute(); });
    listen('suspend', () => { this.state.suspended = true; this.recompute(); });
    listen('resume', () => { this.state.suspended = false; this.recompute(); });
    listen('thermal-state-change', details => {
      this.state.thermalState = details && details.state || 'unknown';
      this.recompute();
    });
    const nativeState = this.nativeBridge.startPowerMonitor(state => {
      this.state.lowPowerMode = !!state.lowPowerMode;
      this.state.screensSleeping = !!state.screensSleeping;
      this.recompute();
    });
    this.state.lowPowerMode = !!nativeState.lowPowerMode;
    this.state.screensSleeping = !!nativeState.screensSleeping;
    this.recompute();
  }

  stop() {
    for (const [event, handler] of this.listeners) this.powerMonitor.removeListener(event, handler);
    this.listeners = [];
    try { this.nativeBridge.stopPowerMonitor(); } catch (error) {}
  }

  setFpsCap(fpsCap) {
    this.baseFpsCap = fpsCap;
    this.recompute();
  }

  setPowerSaver(on) {
    this.powerSaver = !!on;
    this.recompute();
  }

  recompute() {
    let fpsCap = this.baseFpsCap;
    const reasons = [];
    // Owner's decided default: on battery keep visuals SMOOTH and only MUTE audio. The lower-FPS
    // power-saver is OPT-IN (this.powerSaver), not automatic.
    if (this.state.onBattery) {
      reasons.push('battery');
      if (this.powerSaver) { fpsCap = Math.min(fpsCap, 15); reasons.push('battery-saver'); }
    }
    if (this.state.lowPowerMode) { fpsCap = Math.min(fpsCap, 12); reasons.push('low-power-mode'); }
    if (this.state.thermalState === 'fair') { fpsCap = Math.min(fpsCap, 24); reasons.push('thermal-fair'); }
    if (this.state.thermalState === 'serious') { fpsCap = Math.min(fpsCap, 15); reasons.push('thermal-serious'); }
    const paused = this.state.suspended || this.state.screensSleeping || this.state.thermalState === 'critical';
    if (this.state.suspended) reasons.push('system-suspend');
    if (this.state.screensSleeping) reasons.push('display-sleep');
    if (this.state.thermalState === 'critical') reasons.push('thermal-critical');
    // Audio is muted when paused OR on battery (the owner's "mute on battery" default). Visuals are
    // unaffected by the mute — only fpsCap (above) governs them.
    const audioMuted = paused || this.state.onBattery;
    const next = { paused, fpsCap, audioMuted, powerSaver: this.powerSaver, reason: reasons.join(',') || 'normal', ...this.state };
    if (JSON.stringify(next) === JSON.stringify(this.performance)) return;
    this.performance = next;
    this.onChange(next);
  }
}

module.exports = { WallpaperPowerController };
