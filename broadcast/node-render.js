// node-render.js — pure-Node bridge to the app's canonical offline audio engine.
//
// src/audio.js deliberately owns the worklet protocol, event conversion, offline-render race
// handshake, and master-chain constants. To keep that browser/live source byte-identical, this
// module evaluates only its engine section in a small VM context backed by node-web-audio-api.
// The visual/runtime half of audio.js is never evaluated and no DOM or browser is created.
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const AUDIO_SOURCE = path.join(ROOT, 'src', 'audio.js');
const WORKLET_SOURCE = path.join(ROOT, 'src', 'lib', 'generated-synth-worklet.js');
const ENGINE_BOUNDARY = '/* ============================================================\n   VISUALS';

// web-audio-api-rs's compressor is slightly hotter than Chromium (the exact delta is program
// dependent) and permits inter-sample overs. This post-chain backend calibration preserves every
// live master constant while keeping corpus RMS within 0.5 dB and leaving true-peak headroom.
const NODE_BACKEND_TRIM = 0.98;
const SAMPLE_PEAK_CEILING = 0.998;
const TRUE_PEAK_CEILING = 0.997;

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
    const audio = await this.engine.render(score, {
      sampleRate,
      workletUrl: WORKLET_SOURCE,
    });
    const left = audio && audio.left;
    const right = audio && (audio.right || audio.left);
    if (!left || !right || left.length !== right.length) {
      throw new Error('node render returned invalid stereo PCM');
    }

    const frames = left.length;
    const interleaved = new Float32Array(frames * 2);
    let peak = 0;
    for (let i = 0; i < frames; i++) {
      const l = Math.max(-SAMPLE_PEAK_CEILING, Math.min(SAMPLE_PEAK_CEILING, left[i] * NODE_BACKEND_TRIM));
      const r = Math.max(-SAMPLE_PEAK_CEILING, Math.min(SAMPLE_PEAK_CEILING, right[i] * NODE_BACKEND_TRIM));
      interleaved[2 * i] = l;
      interleaved[2 * i + 1] = r;
      const p = Math.max(Math.abs(l), Math.abs(r));
      if (p > peak) peak = p;
    }
    // Permanent pre-air gate: the historical worklet message race produced full zero tracks.
    if (peak === 0) throw new Error('render is PURE SILENCE (peak 0)');
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
