#!/usr/bin/env node
// Direct production-renderer A/B: the same tokens through Chromium Audio.Engine.render and the
// pure-Node broadcaster path. The two Web Audio backends have a small fixed compressor lookahead
// difference, so correlation is measured after finding (and reporting) a bounded sample latency.
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');
const { Renderer } = require('../broadcast/renderer.js');
const { analyzeBuffer } = require('./audio-metrics.js');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const DEFAULT_TOKENS = [
  'velvet-tigers-drift-dusk-7k3m9q2x',
  'neon-robots-race-dawn-4h8s1w6p',
  'golden-comets-spin-rain-9d2f7j5m',
  'hollow-sirens-burn-glass-3q6n8b1z',
  'restless-wolves-rise-static-8m4c2v7t',
  'silent-sparrows-glide-fog-5w9k3r6h',
  'electric-dreamers-chase-snow-2p7g4x9s',
  'frozen-angels-fade-fire-6b3t8n1q',
  'molten-machines-bloom-dust-1z5h7d4w',
  'lonely-shadows-shiver-silence-9r2j6f8c',
];

function arg(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && process.argv[at + 1]) return process.argv[at + 1];
  const inline = process.argv.find(value => value.startsWith(`--${name}=`));
  return inline ? inline.slice(name.length + 3) : fallback;
}

function mimeFor(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (file.endsWith('.json')) return 'application/json; charset=utf-8';
  if (file.endsWith('.wasm')) return 'application/wasm';
  return 'application/octet-stream';
}

function startDistServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      let rel = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
      if (!rel || rel.endsWith('/')) rel += 'index.html';
      let file = path.normalize(path.join(DIST, rel));
      const noFallback = rel.startsWith('packs/') || rel.startsWith('lib/');
      if (!file.startsWith(DIST + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        if (noFallback) { res.writeHead(404); res.end('not found'); return; }
        file = path.join(DIST, 'index.html');
      }
      fs.readFile(file, (error, data) => {
        if (error) { res.writeHead(500); res.end(String(error.message || error)); return; }
        res.writeHead(200, { 'content-type': mimeFor(file), 'cache-control': 'no-store' });
        res.end(data);
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}/` });
    });
  });
}

class ChromiumReference {
  constructor(sampleRate) {
    this.sampleRate = sampleRate;
    this.chunks = [];
  }

  async start() {
    const served = await startDistServer();
    this.server = served.server;
    this.browser = await chromium.launch({
      headless: true,
      args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
    });
    this.page = await this.browser.newPage();
    await this.page.goto(served.url, { waitUntil: 'domcontentloaded' });
    await this.page.waitForFunction(
      () => typeof Audio !== 'undefined' && Audio.Engine &&
        typeof Audio.Engine.render === 'function' && window.CT_COMPOSERS,
      null,
      { timeout: 20000 }
    );
    await this.page.exposeFunction('__rrrParityPcm', data => {
      this.chunks.push(Buffer.from(data, 'base64'));
    });
  }

  async render(token, composerId) {
    this.chunks.length = 0;
    const meta = await this.page.evaluate(async ({ token, composerId, sampleRate }) => {
      const composer = window.CT_COMPOSERS && window.CT_COMPOSERS[composerId];
      if (!composer) throw new Error(`composer ${composerId} not registered`);
      const audio = await Audio.Engine.render(composer.compile(token), { sampleRate });
      const left = audio.left;
      const right = audio.right || audio.left;
      const interleaved = new Float32Array(left.length * 2);
      for (let i = 0; i < left.length; i++) {
        interleaved[2 * i] = left[i];
        interleaved[2 * i + 1] = right[i];
      }
      const bytes = new Uint8Array(interleaved.buffer);
      const chunkSize = 1 << 20;
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        const slice = bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize));
        let binary = '';
        for (let i = 0; i < slice.length; i += 0x8000) {
          binary += String.fromCharCode.apply(null, slice.subarray(i, Math.min(slice.length, i + 0x8000)));
        }
        await window.__rrrParityPcm(btoa(binary));
      }
      return { sampleRate: audio.sampleRate || sampleRate, frames: left.length };
    }, { token, composerId, sampleRate: this.sampleRate });
    return { ...meta, pcm: Buffer.concat(this.chunks) };
  }

  async stop() {
    try { if (this.page) await this.page.close(); } catch (e) {}
    try { if (this.browser) await this.browser.close(); } catch (e) {}
    try { if (this.server) this.server.close(); } catch (e) {}
  }
}

function monoAt(pcm, frame) {
  const offset = frame * 8;
  return (pcm.readFloatLE(offset) + pcm.readFloatLE(offset + 4)) * 0.5;
}

function correlationWindow(reference, candidate, sampleRate, lag, step) {
  const frames = Math.min(reference.length, candidate.length) / 8;
  const start = Math.max(Math.round(sampleRate * 8), -lag);
  const end = Math.min(frames, frames - lag, start + Math.round(sampleRate * 2));
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, count = 0;
  for (let frame = start; frame < end; frame += step) {
    const x = monoAt(reference, frame);
    const y = monoAt(candidate, frame + lag);
    sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; count++;
  }
  const covariance = sxy - sx * sy / count;
  const varianceX = sxx - sx * sx / count;
  const varianceY = syy - sy * sy / count;
  return covariance / Math.sqrt(varianceX * varianceY);
}

function bestLatency(reference, candidate, sampleRate) {
  let best = { lag: 0, correlation: -Infinity };
  for (let lag = -512; lag <= 512; lag += 8) {
    const correlation = correlationWindow(reference, candidate, sampleRate, lag, 8);
    if (correlation > best.correlation) best = { lag, correlation };
  }
  const coarseLag = best.lag;
  for (let lag = coarseLag - 12; lag <= coarseLag + 12; lag++) {
    const correlation = correlationWindow(reference, candidate, sampleRate, lag, 4);
    if (correlation > best.correlation) best = { lag, correlation };
  }
  return best.lag;
}

function alignedCorrelation(reference, candidate, lag) {
  const referenceFrames = reference.length / 8;
  const candidateFrames = candidate.length / 8;
  const start = Math.max(0, -lag);
  const end = Math.min(referenceFrames, candidateFrames - lag);
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, count = 0;
  for (let frame = start; frame < end; frame++) {
    for (let channel = 0; channel < 2; channel++) {
      const x = reference.readFloatLE(frame * 8 + channel * 4);
      const y = candidate.readFloatLE((frame + lag) * 8 + channel * 4);
      sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; count++;
    }
  }
  const covariance = sxy - sx * sy / count;
  const varianceX = sxx - sx * sx / count;
  const varianceY = syy - sy * sy / count;
  return covariance / Math.sqrt(varianceX * varianceY);
}

function pcmStats(pcm) {
  let peak = 0, sumSquares = 0;
  const samples = pcm.length / 4;
  for (let offset = 0; offset < pcm.length; offset += 4) {
    const value = pcm.readFloatLE(offset);
    peak = Math.max(peak, Math.abs(value));
    sumSquares += value * value;
  }
  return { peak, rms: Math.sqrt(sumSquares / samples) };
}

function metricBuffer(rendered) {
  const left = new Float32Array(rendered.frames);
  const right = new Float32Array(rendered.frames);
  for (let i = 0; i < rendered.frames; i++) {
    left[i] = rendered.pcm.readFloatLE(i * 8);
    right[i] = rendered.pcm.readFloatLE(i * 8 + 4);
  }
  return { sampleRate: rendered.sampleRate, channels: [left, right] };
}

function compareMetrics(reference, candidate) {
  const a = analyzeBuffer(metricBuffer(reference));
  const b = analyzeBuffer(metricBuffer(candidate));
  return {
    reference: a,
    candidate: b,
    loudnessDeltaDb: b.loudness.integratedLUFS - a.loudness.integratedLUFS,
    stereoDelta: b.stereoCorrelation - a.stereoCorrelation,
    droneDelta: b.drone.maxSelfSimilarity - a.drone.maxSelfSimilarity,
    centroidDeltaHz: b.centroid.meanHz - a.centroid.meanHz,
    onsetDeltaPerSec: b.onsets.meanPerSec - a.onsets.meanPerSec,
  };
}

(async () => {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    throw new Error('dist/index.html missing — run `node build.js` first');
  }
  const count = Math.max(1, Math.min(DEFAULT_TOKENS.length, Number(arg('tokens', 10)) || 10));
  const tokens = DEFAULT_TOKENS.slice(0, count);
  const sampleRate = 48000;
  const reference = new ChromiumReference(sampleRate);
  const candidate = new Renderer({ sampleRate, log: message => console.error(message) });
  const rows = [];
  await reference.start();
  await candidate.start();
  try {
    for (const token of tokens) {
      const browser = await reference.render(token, 'rrr_core');
      const node = await candidate.render(token, 'rrr_core');
      if (!node) throw new Error(`${token}: Node renderer returned null`);
      const browserStats = pcmStats(browser.pcm);
      const nodeStats = pcmStats(node.pcm);
      const lag = bestLatency(browser.pcm, node.pcm, sampleRate);
      const correlation = alignedCorrelation(browser.pcm, node.pcm, lag);
      const rmsDeltaDb = 20 * Math.log10(nodeStats.rms / browserStats.rms);
      const metrics = compareMetrics(browser, node);
      const failures = [];
      if (browser.frames !== node.frames) failures.push(`frame mismatch ${browser.frames} != ${node.frames}`);
      if (browser.sampleRate !== node.sampleRate) failures.push(`sample-rate mismatch ${browser.sampleRate} != ${node.sampleRate}`);
      if (nodeStats.peak === 0) failures.push('Node render is PURE SILENCE');
      if (correlation < 0.995) failures.push(`correlation ${correlation.toFixed(6)} < 0.995`);
      if (Math.abs(rmsDeltaDb) >= 0.5) failures.push(`|RMS delta| ${Math.abs(rmsDeltaDb).toFixed(3)} dB >= 0.5 dB`);
      if (Math.abs(metrics.loudnessDeltaDb) >= 0.5) failures.push(`|LUFS delta| ${Math.abs(metrics.loudnessDeltaDb).toFixed(2)} >= 0.5`);
      if (Math.abs(metrics.stereoDelta) >= 0.01) failures.push(`|stereo corr delta| ${Math.abs(metrics.stereoDelta).toFixed(4)} >= 0.01`);
      if (Math.abs(metrics.droneDelta) >= 0.005) failures.push(`|drone delta| ${Math.abs(metrics.droneDelta).toFixed(4)} >= 0.005`);
      if (Math.abs(metrics.centroidDeltaHz) >= 50) failures.push(`|centroid delta| ${Math.abs(metrics.centroidDeltaHz).toFixed(1)} Hz >= 50 Hz`);
      // The onset picker is threshold/discrete (unlike the waveform and loudness metrics), so a
      // few transients crossing opposite sides of its threshold can move this secondary count.
      if (Math.abs(metrics.onsetDeltaPerSec) >= 0.5) failures.push(`|onset delta| ${Math.abs(metrics.onsetDeltaPerSec).toFixed(2)}/s >= 0.5/s`);
      if (metrics.candidate.peaks.clippedSamples !== 0) failures.push(`${metrics.candidate.peaks.clippedSamples} clipped Node samples`);
      if (metrics.candidate.peaks.truePeakOvers > 8) failures.push(`${metrics.candidate.peaks.truePeakOvers} Node true-peak overs > 8`);
      rows.push({ token, lag, correlation, rmsDeltaDb, metrics, failures });
      console.log(`${failures.length ? 'FAIL' : 'PASS'} ${token}  corr ${correlation.toFixed(6)}  lag ${lag} samples  RMSΔ ${rmsDeltaDb.toFixed(3)} dB  LUFSΔ ${metrics.loudnessDeltaDb.toFixed(2)} dB  clip ${metrics.candidate.peaks.clippedSamples}  TP ${metrics.candidate.peaks.truePeakDb.toFixed(2)} dB`);
      for (const failure of failures) console.error(`  ${failure}`);
    }
  } finally {
    await candidate.stop();
    await reference.stop();
  }

  const failed = rows.filter(row => row.failures.length);
  const minCorrelation = Math.min(...rows.map(row => row.correlation));
  const maxRmsDelta = Math.max(...rows.map(row => Math.abs(row.rmsDeltaDb)));
  console.log(`parity: ${failed.length ? 'FAIL' : 'PASS'} ${rows.length - failed.length}/${rows.length}  min corr ${minCorrelation.toFixed(6)}  max |RMSΔ| ${maxRmsDelta.toFixed(3)} dB`);
  if (failed.length) process.exitCode = 1;
})().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
