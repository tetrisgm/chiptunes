// Dependency-free BPM estimation: onset envelope + normalized autocorrelation.
// Extracted from the old scripts/analyze-chip-bpm.js so the Node CLI (pack-tools)
// and the in-app fallback worker (src/lib/bpm-worker.js, via importScripts) share
// one kernel. No Math.random, no I/O — pure function of the samples.
// Dual export: module.exports (Node) + self.BPM_KERNEL (worker/global).
(function (root) {
  'use strict';

  var BLOCK_FRAMES = 1024;

  // analyze(float32Mono, sampleRate) -> { bpm, conf }
  // float32Mono: Float32Array (or plain array) of mono samples in [-1, 1].
  function analyze(samples, sampleRate) {
    var n = samples ? samples.length : 0;
    if (!n || !(sampleRate > 0)) return { bpm: 0, conf: 0 };
    var env = envelope(samples, BLOCK_FRAMES);
    return estimateFromEnvelope(env, BLOCK_FRAMES / sampleRate);
  }

  // Per-block onset envelope: rms*0.78 + peak*0.22 (matches the shipped analyzers).
  function envelope(samples, blockFrames) {
    blockFrames = blockFrames || BLOCK_FRAMES;
    var n = samples.length;
    var blocks = Math.floor(n / blockFrames);
    var env = new Array(blocks);
    for (var b = 0; b < blocks; b++) {
      var base = b * blockFrames;
      var sum = 0;
      var peak = 0;
      for (var i = 0; i < blockFrames; i++) {
        var v = samples[base + i] || 0;
        var av = v < 0 ? -v : v;
        sum += v * v;
        if (av > peak) peak = av;
      }
      env[b] = Math.sqrt(sum / blockFrames) * 0.78 + peak * 0.22;
    }
    return env;
  }

  // estimateFromEnvelope(env, blockDurSeconds) -> { bpm, conf }
  function estimateFromEnvelope(env, blockDur) {
    var n = (env && env.length) || 0;
    if (n < 32 || !(blockDur > 0)) return { bpm: 0, conf: 0 };
    var smooth = new Array(n);
    var flux = new Array(n);
    var maxEnv = 0;
    var sm = 0;
    var i;
    for (i = 0; i < n; i++) {
      sm = sm * 0.62 + (env[i] || 0) * 0.38;
      smooth[i] = sm;
      if (sm > maxEnv) maxEnv = sm;
    }
    if (maxEnv < 0.0025) return { bpm: 0, conf: 0 };

    var mean = 0;
    var count = 0;
    for (i = 1; i < n; i++) {
      var d = smooth[i] - smooth[i - 1];
      if (d < 0) d = 0;
      if (smooth[i] < maxEnv * 0.045) d *= 0.35;
      flux[i] = d;
      mean += d;
      count++;
    }
    mean = count ? mean / count : 0;

    var minLag = Math.max(2, Math.round(60 / (220 * blockDur)));
    var maxLag = Math.min(Math.floor(n / 2), Math.round(60 / (55 * blockDur)));
    var bestLag = 0;
    var bestScore = 0;
    for (var lag = minLag; lag <= maxLag; lag++) {
      var score = 0;
      var normA = 0;
      var normB = 0;
      for (i = lag; i < n; i++) {
        var a = (flux[i] || 0) - mean * 0.35; if (a < 0) a = 0;
        var b = (flux[i - lag] || 0) - mean * 0.35; if (b < 0) b = 0;
        score += a * b;
        normA += a * a;
        normB += b * b;
      }
      if (normA <= 0 || normB <= 0) continue;
      score /= Math.sqrt(normA * normB);
      var bpm = 60 / (lag * blockDur);
      if (bpm < 70) score *= 0.94;
      if (bpm > 180) score *= 0.96;
      if (score > bestScore) {
        bestScore = score;
        bestLag = lag;
      }
    }
    if (!bestLag || bestScore < 0.055) return { bpm: 0, conf: round3(bestScore) };
    return {
      bpm: normalizeTempo(60 / (bestLag * blockDur)),
      conf: round3(Math.max(0, Math.min(1, bestScore)))
    };
  }

  // Fold octaves into the useful dance band, then clamp to a sane integer BPM.
  function normalizeTempo(bpm) {
    bpm = Number(bpm);
    if (!isFinite(bpm) || bpm <= 0) return 0;
    while (bpm < 82 && bpm * 2 <= 220) bpm *= 2;
    while (bpm > 188 && bpm / 2 >= 55) bpm /= 2;
    return clampTempo(bpm);
  }

  function clampTempo(bpm) {
    bpm = Number(bpm);
    return isFinite(bpm) && bpm >= 50 && bpm <= 240 ? Math.round(bpm) : 0;
  }

  function round3(v) {
    return Math.round((Number(v) || 0) * 1000) / 1000;
  }

  var BPM_KERNEL = {
    BLOCK_FRAMES: BLOCK_FRAMES,
    analyze: analyze,
    envelope: envelope,
    estimateFromEnvelope: estimateFromEnvelope,
    normalizeTempo: normalizeTempo,
    clampTempo: clampTempo
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = BPM_KERNEL;
  if (typeof self !== 'undefined') self.BPM_KERNEL = BPM_KERNEL;
  else if (typeof window !== 'undefined') window.BPM_KERNEL = BPM_KERNEL;
  else if (root && typeof root === 'object') root.BPM_KERNEL = BPM_KERNEL;
})(this);
