// node-render.js — pure-Node bridge to the app's canonical offline audio engine.
//
// src/audio.js deliberately owns the worklet protocol, event conversion, offline-render race
// handshake, and master-chain constants. To keep that browser/live source byte-identical, this
// module evaluates only its engine section in a small VM context backed by node-web-audio-api.
// The visual/runtime half of audio.js is never evaluated and no DOM or browser is created.
'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const AUDIO_SOURCE = path.join(ROOT, 'src', 'audio.js');
const WORKLET_SOURCE = path.join(ROOT, 'src', 'lib', 'generated-synth-worklet.js');
// The chip is plain arithmetic with no Web Audio dependency, so the offline
// renderer runs the identical module the browser does rather than a second
// implementation behind node-web-audio-api.
require(path.join(ROOT, 'src', 'gb-hardware.js'));
const GB_APU = require(path.join(ROOT, 'src', 'gb-apu.js'));
const WORKLET_URL = pathToFileURL(WORKLET_SOURCE).href;
const ENGINE_BOUNDARY = '/* ============================================================\n   VISUALS';

// web-audio-api-rs's compressor is slightly hotter than Chromium (the exact delta is program
// dependent) and permits inter-sample overs. This post-chain backend calibration preserves every
// live master constant while keeping corpus RMS within 0.5 dB and leaving true-peak headroom.
const NODE_BACKEND_TRIM = 0.98;
const SAMPLE_PEAK_CEILING = 0.998;
const TRUE_PEAK_CEILING = 0.997;
// Dense, fully procedural timelines can legitimately take tens of seconds to render at 48 kHz on a
// cold audio-worklet VM. Keep this guard comfortably above the measured healthy envelope: a tight
// timeout creates the very radio gap it is meant to prevent by killing valid work and retrying it.
// A genuinely wedged renderer is still bounded here, and broadcaster.js's output-liveness watchdog
// independently restarts the process if the aired stream stops advancing.
const RENDER_TIMEOUT_MS = 90000;

// Match scripts/audio-metrics.js's 4x Catmull-Rom true-peak approximation. The Rust compressor's
// sample peaks can be legal while interpolation between samples exceeds 0 dBFS, so apply one
// transparent whole-render safety gain when necessary (normally 0 to about -0.5 dB).
function estimatedTruePeak(interleaved, frames) {
  let peak = 0;
  for (let channel = 0; channel < 2; channel++) {
    for (let i = 0; i < frames; i++) {
      const p1 = interleaved[2 * i + channel];
      const samplePeak = Math.abs(p1);
      if (samplePeak > peak) peak = samplePeak;
      if (i < 1 || i + 2 >= frames) continue;
      const p0 = interleaved[2 * (i - 1) + channel];
      const p2 = interleaved[2 * (i + 1) + channel];
      const p3 = interleaved[2 * (i + 2) + channel];
      // Exact early-out: the Catmull-Rom basis L1-norm at t=1/4,1/2,3/4 maxes at 1.25 (t=1/2), so
      // |interpolated| <= 1.25 * max(|p0..p3|). Windows below the running peak provably cannot raise
      // it — skip the cubic. Returned peak is bit-identical; typical tracks skip >95% of windows.
      const m = Math.max(Math.abs(p0), samplePeak, Math.abs(p2), Math.abs(p3));
      if (m * 1.25 <= peak) continue;
      for (let step = 1; step < 4; step++) {
        const t = step / 4;
        const value = 0.5 * ((2 * p1) + (-p0 + p2) * t +
          (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
          (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
        const interpolatedPeak = Math.abs(value);
        if (interpolatedPeak > peak) peak = interpolatedPeak;
      }
    }
  }
  return peak;
}

function nodeMajor() {
  return Number(String(process.versions.node || '0').split('.')[0]) || 0;
}

function createEngine() {
  if (nodeMajor() < 22) {
    throw new Error(`node-web-audio-api requires Node 22+ (running ${process.version})`);
  }
  const webAudio = require('node-web-audio-api');
  const source = fs.readFileSync(AUDIO_SOURCE, 'utf8');
  const boundary = source.indexOf(ENGINE_BOUNDARY);
  if (boundary < 0) throw new Error('src/audio.js engine boundary marker missing');

  const sandbox = {
    ...webAudio,
    console,
    Date,
    Math,
    Promise,
    performance,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    setImmediate,
    clearImmediate,
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(
    source.slice(0, boundary) + '\nglobalThis.__rrrNodeEngine = Audio.Engine;\n',
    sandbox,
    { filename: AUDIO_SOURCE }
  );
  if (!sandbox.__rrrNodeEngine || typeof sandbox.__rrrNodeEngine.render !== 'function') {
    throw new Error('src/audio.js did not expose Audio.Engine.render');
  }
  return sandbox.__rrrNodeEngine;
}

function composerRegistry() {
  const builtin = require(path.join(ROOT, 'src', 'composer.js'));
  const registry = globalThis.CT_COMPOSERS || {};
  if (!registry.rrr_core) registry.rrr_core = builtin;
  return registry;
}

class NodeRenderEngine {
  constructor() {
    this.engine = null;
    this.composers = null;
  }

  start() {
    if (!fs.existsSync(AUDIO_SOURCE)) throw new Error('src/audio.js missing');
    if (!fs.existsSync(WORKLET_SOURCE)) throw new Error('generated synth worklet missing');
    this.composers = composerRegistry();
    this.engine = createEngine();
  }

  reset() {
    this.engine = createEngine();
  }

  async render(token, composerId, sampleRate) {
    if (!this.engine) this.start();
    composerId = composerId || 'rrr_core';
    const composer = this.composers[composerId];
    if (!composer || typeof composer.compile !== 'function') {
      throw new Error(`composer ${composerId} not registered`);
    }
    const score = composer.compile(token);
    let timer;
    let audio;
    const isGb = !!(score && score.gb && ((score.gb.notes && score.gb.notes.length) ||
                                          (score.gb.kit && score.gb.kit.length)));
    if (isGb) {
      // identical arithmetic to the browser; everything downstream (silence
      // gate, peak checks, interleave) still applies
      const sr = sampleRate || 48000;
      const mono = GB_APU.render(score.gb, sr);
      audio = { left: mono, right: mono, sampleRate: sr };
    } else {
      try {
        audio = await Promise.race([
          this.engine.render(score, { sampleRate, workletUrl: WORKLET_URL }),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('engine.render timeout (' + RENDER_TIMEOUT_MS + 'ms)')), RENDER_TIMEOUT_MS); }),
        ]);
      } finally { clearTimeout(timer); }
    }
    const left = audio && audio.left;
    const right = audio && (audio.right || audio.left);
    if (!left || !right || left.length !== right.length) {
      throw new Error('node render returned invalid stereo PCM');
    }

    const frames = left.length;
    const interleaved = new Float32Array(frames * 2);
    let peak = 0, silentRun = 0, longestSilentRun = 0;
    for (let i = 0; i < frames; i++) {
      if (!Number.isFinite(left[i]) || !Number.isFinite(right[i])) {
        throw new Error(`render produced non-finite PCM at frame ${i} (${(i / (audio.sampleRate || sampleRate)).toFixed(3)}s)`);
      }
      const l = Math.max(-SAMPLE_PEAK_CEILING, Math.min(SAMPLE_PEAK_CEILING, left[i] * NODE_BACKEND_TRIM));
      const r = Math.max(-SAMPLE_PEAK_CEILING, Math.min(SAMPLE_PEAK_CEILING, right[i] * NODE_BACKEND_TRIM));
      interleaved[2 * i] = l;
      interleaved[2 * i + 1] = r;
      const p = Math.max(Math.abs(l), Math.abs(r));
      if (p > peak) peak = p;
      if (p < 1e-7) { silentRun++; if (silentRun > longestSilentRun) longestSilentRun = silentRun; }
      else silentRun = 0;
    }
    // Permanent pre-air gate: the historical worklet message race produced full zero tracks.
    if (peak === 0) throw new Error('render is PURE SILENCE (peak 0)');
    if (longestSilentRun > (audio.sampleRate || sampleRate) * 5) {
      throw new Error(`render contains ${(longestSilentRun / (audio.sampleRate || sampleRate)).toFixed(2)}s of continuous digital silence`);
    }
    const truePeak = estimatedTruePeak(interleaved, frames);
    if (truePeak > TRUE_PEAK_CEILING) {
      const safetyGain = TRUE_PEAK_CEILING / truePeak;
      for (let i = 0; i < interleaved.length; i++) interleaved[i] *= safetyGain;
    }

    return {
      sampleRate: audio.sampleRate || sampleRate,
      frames,
      pcm: Buffer.from(interleaved.buffer, interleaved.byteOffset, interleaved.byteLength),
    };
  }

  stop() {
    this.engine = null;
    this.composers = null;
  }
}

module.exports = { NodeRenderEngine, NODE_BACKEND_TRIM };
