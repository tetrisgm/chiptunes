#!/usr/bin/env node
// Pure-Node WAV analysis for rendered generated tracks. No deps.
// Metrics:
//   - integrated loudness (BS.1770-style K-weighting + gating) + short-term curve
//   - energyAt10sPct: K-weighted power around t=10s vs the track's loud regions
//     (gate: >=70% — the hook must have landed by 10s)
//   - drone detector: max spectral self-similarity over 20s windows
//   - onset density curve (spectral-flux peak picking)
//   - spectral centroid mean/std
//   - stereo correlation
//   - clip count + approximate true-peak (4x Catmull-Rom oversampling)
// Module API: { readWav, analyzeBuffer, analyzeWav, DEFAULTS }
// CLI: node scripts/audio-metrics.js <file.wav> [more.wav ...] [--json out.json]
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  fftSize: 1024,
  hop: 512,
  droneWindowSec: 20,
  droneBlockSec: 1,
  onsetBucketSec: 5,
  clipLevel: 0.999
};

// ---- WAV reader ------------------------------------------------------------
function readWav(file) {
  const buf = fs.readFileSync(file);
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(file + ': not a RIFF/WAVE file');
  }
  let pos = 12, fmt = null, dataOff = -1, dataLen = 0;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    if (id === 'fmt ') {
      fmt = {
        format: buf.readUInt16LE(pos + 8),
        channels: buf.readUInt16LE(pos + 10),
        sampleRate: buf.readUInt32LE(pos + 12),
        bits: buf.readUInt16LE(pos + 22)
      };
      if (fmt.format === 0xFFFE && size >= 40) fmt.format = buf.readUInt16LE(pos + 8 + 24); // extensible: first 2 bytes of subformat GUID
    } else if (id === 'data') {
      dataOff = pos + 8;
      dataLen = Math.min(size, buf.length - dataOff);
    }
    pos += 8 + size + (size & 1);
  }
  if (!fmt) throw new Error(file + ': no fmt chunk');
  if (dataOff < 0) throw new Error(file + ': no data chunk');
  const bytesPer = fmt.bits >> 3;
  const frames = Math.floor(dataLen / (bytesPer * fmt.channels));
  const channels = [];
  for (let c = 0; c < fmt.channels; c++) channels.push(new Float32Array(frames));
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < fmt.channels; c++) {
      const off = dataOff + (i * fmt.channels + c) * bytesPer;
      let v;
      if (fmt.format === 3 && fmt.bits === 32) v = buf.readFloatLE(off);
      else if (fmt.format === 3 && fmt.bits === 64) v = buf.readDoubleLE(off);
      else if (fmt.bits === 16) v = buf.readInt16LE(off) / 32768;
      else if (fmt.bits === 24) {
        const raw = buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16);
        v = (raw & 0x800000 ? raw - 0x1000000 : raw) / 8388608;
      } else if (fmt.bits === 32) v = buf.readInt32LE(off) / 2147483648;
      else if (fmt.bits === 8) v = (buf[off] - 128) / 128;
      else throw new Error(file + `: unsupported wav format (fmt=${fmt.format} bits=${fmt.bits})`);
      channels[c][i] = v;
    }
  }
  return { sampleRate: fmt.sampleRate, channels };
}

// ---- K-weighting (ITU-R BS.1770, coefficients recomputed for the file's fs) ----
function kWeightCoeffs(fs) {
  let f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
  let K = Math.tan(Math.PI * f0 / fs);
  const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const shelf = {
    b0: (Vh + Vb * K / Q + K * K) / a0, b1: 2 * (K * K - Vh) / a0, b2: (Vh - Vb * K / Q + K * K) / a0,
    a1: 2 * (K * K - 1) / a0, a2: (1 - K / Q + K * K) / a0
  };
  f0 = 38.13547087602444; Q = 0.5003270373238773;
  K = Math.tan(Math.PI * f0 / fs);
  a0 = 1 + K / Q + K * K;
  const hp = { b0: 1, b1: -2, b2: 1, a1: 2 * (K * K - 1) / a0, a2: (1 - K / Q + K * K) / a0 };
  return [shelf, hp];
}

function biquadFilter(x, c) {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i];
    const yi = c.b0 * xi + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    y[i] = yi;
    x2 = x1; x1 = xi; y2 = y1; y1 = yi;
  }
  return y;
}

function kWeight(x, fs) {
  const [shelf, hp] = kWeightCoeffs(fs);
  return biquadFilter(biquadFilter(x, shelf), hp);
}

// prefix sums of squared K-weighted power summed over channels -> O(1) window power
function powerPrefix(chans) {
  const n = chans[0].length;
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < chans.length; c++) { const v = chans[c][i]; s += v * v; }
    pre[i + 1] = pre[i] + s;
  }
  return pre;
}
function windowPower(pre, a, b) { // mean power over sample range [a,b)
  a = Math.max(0, a); b = Math.min(pre.length - 1, b);
  if (b <= a) return 0;
  return (pre[b] - pre[a]) / (b - a);
}
const LUFS = p => p > 0 ? -0.691 + 10 * Math.log10(p) : -Infinity;

function loudness(pre, sr) {
  const n = pre.length - 1;
  // momentary 400ms blocks, 75% overlap
  const block = Math.round(0.4 * sr), hop = Math.round(0.1 * sr);
  const blocks = [];
  for (let a = 0; a + block <= n; a += hop) blocks.push(windowPower(pre, a, a + block));
  const loud = blocks.map(LUFS);
  const abs = blocks.filter((p, i) => loud[i] > -70);
  let integrated = -Infinity;
  if (abs.length) {
    const relGate = LUFS(abs.reduce((s, p) => s + p, 0) / abs.length) - 10;
    const gated = blocks.filter((p, i) => loud[i] > -70 && loud[i] > relGate);
    if (gated.length) integrated = LUFS(gated.reduce((s, p) => s + p, 0) / gated.length);
  }
  // short-term 3s windows, 1s hop
  const stWin = Math.round(3 * sr), stHop = sr;
  const shortTerm = [];
  for (let a = 0; a + Math.min(stWin, n) <= n; a += stHop) {
    shortTerm.push({ t: +(a / sr).toFixed(2), lufs: +LUFS(windowPower(pre, a, a + stWin)).toFixed(2) });
    if (a + stWin >= n) break;
  }
  const momentaryMax = loud.length ? Math.max.apply(null, loud) : -Infinity;
  return { integratedLUFS: +integrated.toFixed(2), momentaryMaxLUFS: +momentaryMax.toFixed(2), shortTerm };
}

function energyAt10sPct(pre, sr) {
  const n = pre.length - 1;
  if (n < 14 * sr) return 100; // shorter than 14s: nothing to gate
  const p10 = windowPower(pre, Math.round(7 * sr), Math.round(13 * sr));
  // reference: 90th percentile of 3s-window powers (robust "loud region" level)
  const powers = [];
  const w = 3 * sr;
  for (let a = 0; a + w <= n; a += sr) powers.push(windowPower(pre, a, a + w));
  if (!powers.length) return 100;
  powers.sort((x, y) => x - y);
  const ref = powers[Math.min(powers.length - 1, Math.floor(powers.length * 0.9))];
  if (ref <= 0) return 100;
  return +Math.min(100, 100 * p10 / ref).toFixed(1);
}

// ---- FFT (iterative radix-2, real input packed as complex) ----
function fftMags(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cwr = 1, cwi = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cwr - im[i + k + len / 2] * cwi;
        const vi = re[i + k + len / 2] * cwi + im[i + k + len / 2] * cwr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const nwr = cwr * wr - cwi * wi;
        cwi = cwr * wi + cwi * wr; cwr = nwr;
      }
    }
  }
  const mags = new Float32Array(n / 2);
  for (let k = 0; k < n / 2; k++) mags[k] = Math.hypot(re[k], im[k]);
  return mags;
}

function spectrogram(mono, sr, N, hop) {
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
  const frames = [];
  const re = new Float32Array(N), im = new Float32Array(N);
  for (let a = 0; a + N <= mono.length; a += hop) {
    for (let i = 0; i < N; i++) { re[i] = mono[a + i] * win[i]; im[i] = 0; }
    frames.push(fftMags(re, im));
  }
  return { frames, frameHz: sr / hop, binHz: sr / N };
}

function spectralFeatures(mono, sr, opts) {
  const { frames, frameHz, binHz } = spectrogram(mono, sr, opts.fftSize, opts.hop);
  const nF = frames.length;
  const flux = new Float32Array(nF);
  const centroid = new Float32Array(nF);
  for (let i = 0; i < nF; i++) {
    const m = frames[i];
    let cNum = 0, cDen = 0, fl = 0;
    for (let k = 1; k < m.length; k++) {
      cNum += k * binHz * m[k];
      cDen += m[k];
      if (i > 0) { const d = m[k] - frames[i - 1][k]; if (d > 0) fl += d; }
    }
    centroid[i] = cDen > 1e-9 ? cNum / cDen : 0;
    flux[i] = fl;
  }
  // onset picking: local max above adaptive mean+1.5*std (±1s neighborhood), min gap 50ms
  const nbh = Math.max(4, Math.round(frameHz));
  const onsets = [];
  const minGap = 0.05;
  for (let i = 2; i < nF - 2; i++) {
    if (flux[i] < flux[i - 1] || flux[i] < flux[i + 1]) continue;
    let s = 0, s2 = 0, cnt = 0;
    for (let j = Math.max(0, i - nbh); j < Math.min(nF, i + nbh); j++) { s += flux[j]; s2 += flux[j] * flux[j]; cnt++; }
    const mean = s / cnt;
    const std = Math.sqrt(Math.max(0, s2 / cnt - mean * mean));
    if (flux[i] > mean + 1.5 * std && flux[i] > 1e-6) {
      const t = i / frameHz;
      if (!onsets.length || t - onsets[onsets.length - 1] >= minGap) onsets.push(t);
    }
  }
  // centroid stats over audible frames
  let cSum = 0, cSum2 = 0, cN = 0;
  for (let i = 0; i < nF; i++) if (centroid[i] > 0) { cSum += centroid[i]; cSum2 += centroid[i] * centroid[i]; cN++; }
  const cMean = cN ? cSum / cN : 0;
  const cStd = cN ? Math.sqrt(Math.max(0, cSum2 / cN - cMean * cMean)) : 0;
  return { frames, frameHz, flux, onsets, centroidMeanHz: +cMean.toFixed(1), centroidStdHz: +cStd.toFixed(1) };
}

// Drone detector: average the spectrogram into 1s blocks (L2-normalized log
// spectra), then take the max over 20s windows of the mean pairwise cosine
// similarity of the blocks inside the window. -> 1.0 means 20s of an unchanging
// spectrum: a drone.
function droneScore(frames, frameHz, opts) {
  const perBlock = Math.max(1, Math.round(opts.droneBlockSec * frameHz));
  const nBins = frames.length ? frames[0].length : 0;
  const blocks = [];
  for (let a = 0; a + perBlock <= frames.length; a += perBlock) {
    const v = new Float32Array(nBins);
    for (let i = a; i < a + perBlock; i++) for (let k = 0; k < nBins; k++) v[k] += frames[i][k];
    let norm = 0;
    for (let k = 0; k < nBins; k++) { v[k] = Math.log1p(v[k] / perBlock); norm += v[k] * v[k]; }
    norm = Math.sqrt(norm) || 1;
    for (let k = 0; k < nBins; k++) v[k] /= norm;
    blocks.push(v);
  }
  const winBlocks = Math.round(opts.droneWindowSec / opts.droneBlockSec);
  if (blocks.length < winBlocks) return { maxSelfSimilarity: 0, atSec: 0 };
  let best = 0, bestAt = 0;
  for (let a = 0; a + winBlocks <= blocks.length; a++) {
    let sim = 0, pairs = 0;
    for (let i = a; i < a + winBlocks; i++) {
      for (let j = i + 1; j < a + winBlocks; j++) {
        let dot = 0;
        const u = blocks[i], v = blocks[j];
        for (let k = 0; k < nBins; k++) dot += u[k] * v[k];
        sim += dot; pairs++;
      }
    }
    const mean = pairs ? sim / pairs : 0;
    if (mean > best) { best = mean; bestAt = a * opts.droneBlockSec; }
  }
  return { maxSelfSimilarity: +best.toFixed(4), atSec: bestAt };
}

function stereoCorrelation(L, R) {
  if (L === R) return 1;
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, n = 0;
  for (let i = 0; i < L.length; i += 4) {
    const x = L[i], y = R[i];
    sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; n++;
  }
  const cov = sxy / n - (sx / n) * (sy / n);
  const vx = sxx / n - (sx / n) * (sx / n);
  const vy = syy / n - (sy / n) * (sy / n);
  const den = Math.sqrt(vx * vy);
  return den > 1e-12 ? +(cov / den).toFixed(4) : 0;
}

function peaks(chans, clipLevel) {
  let clipped = 0, truePeak = 0, overs = 0;
  for (const x of chans) {
    for (let i = 0; i < x.length; i++) {
      const a = Math.abs(x[i]);
      if (a >= clipLevel) clipped++;
      if (a > truePeak) truePeak = a;
      // 4x Catmull-Rom oversampling between i and i+1
      if (i >= 1 && i + 2 < x.length) {
        const p0 = x[i - 1], p1 = x[i], p2 = x[i + 1], p3 = x[i + 2];
        for (let s = 1; s < 4; s++) {
          const t = s / 4;
          const v = 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
          const av = Math.abs(v);
          if (av > truePeak) truePeak = av;
          if (av > 1.0) overs++;
        }
      }
    }
  }
  return {
    clippedSamples: clipped,
    truePeakDb: truePeak > 0 ? +(20 * Math.log10(truePeak)).toFixed(2) : -Infinity,
    truePeakOvers: overs
  };
}

// ---- top level ------------------------------------------------------------
function analyzeBuffer(wav, options) {
  const opts = Object.assign({}, DEFAULTS, options || {});
  const sr = wav.sampleRate;
  const L = wav.channels[0];
  const R = wav.channels[1] || L;
  const durationSec = +(L.length / sr).toFixed(2);

  const kw = wav.channels.slice(0, 2).map(ch => kWeight(ch, sr));
  const pre = powerPrefix(kw.length === 1 ? [kw[0], kw[0]] : kw);
  const loud = loudness(pre, sr);
  const e10 = energyAt10sPct(pre, sr);

  const mono = new Float32Array(L.length);
  for (let i = 0; i < L.length; i++) mono[i] = (L[i] + R[i]) / 2;
  const spec = spectralFeatures(mono, sr, opts);
  const drone = droneScore(spec.frames, spec.frameHz, opts);

  const bucket = opts.onsetBucketSec;
  const nBuckets = Math.max(1, Math.ceil(durationSec / bucket));
  const curve = new Array(nBuckets).fill(0);
  for (const t of spec.onsets) curve[Math.min(nBuckets - 1, Math.floor(t / bucket))]++;
  const onsetCurve = curve.map((n, i) => ({ t: i * bucket, perSec: +(n / bucket).toFixed(2) }));
  const onsetMeanPerSec = +(spec.onsets.length / Math.max(1e-6, durationSec)).toFixed(2);

  return {
    durationSec,
    sampleRate: sr,
    channels: wav.channels.length,
    loudness: loud,
    energyAt10sPct: e10,
    drone,
    onsets: { count: spec.onsets.length, meanPerSec: onsetMeanPerSec, curve: onsetCurve },
    centroid: { meanHz: spec.centroidMeanHz, stdHz: spec.centroidStdHz },
    stereoCorrelation: stereoCorrelation(L, R),
    peaks: peaks(wav.channels.slice(0, 2), opts.clipLevel)
  };
}

function analyzeWav(file, options) {
  return analyzeBuffer(readWav(file), options);
}

module.exports = { readWav, analyzeBuffer, analyzeWav, DEFAULTS };

// ---- CLI -------------------------------------------------------------------
if (require.main === module) {
  const args = process.argv.slice(2);
  const files = [];
  let jsonOut = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--json') { jsonOut = args[++i]; continue; }
    if (args[i].startsWith('--json=')) { jsonOut = args[i].slice(7); continue; }
    files.push(args[i]);
  }
  if (!files.length) {
    console.error('usage: node scripts/audio-metrics.js <file.wav> [more.wav ...] [--json out.json]');
    process.exit(2);
  }
  const out = {};
  for (const f of files) {
    try {
      const m = analyzeWav(f);
      out[f] = m;
      console.log(`${path.basename(f)}: ${m.durationSec}s  int ${m.loudness.integratedLUFS} LUFS  e@10s ${m.energyAt10sPct}%  drone ${m.drone.maxSelfSimilarity}  onsets ${m.onsets.meanPerSec}/s  centroid ${m.centroid.meanHz}±${m.centroid.stdHz}Hz  corr ${m.stereoCorrelation}  clip ${m.peaks.clippedSamples}  tp ${m.peaks.truePeakDb}dB`);
    } catch (e) {
      out[f] = { error: String(e && e.message || e) };
      console.error(`${f}: ${e && e.message || e}`);
      process.exitCode = 1;
    }
  }
  if (jsonOut) {
    fs.mkdirSync(path.dirname(path.resolve(jsonOut)), { recursive: true });
    fs.writeFileSync(jsonOut, JSON.stringify(out, null, 2) + '\n');
    console.log(`wrote ${jsonOut}`);
  }
}
