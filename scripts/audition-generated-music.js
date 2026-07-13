#!/usr/bin/env node
// Audition v2 — quality gate for the generated-music pipeline.
//
//   symbolic (default): pure Node, vm-loads src/seed.js + src/composer.js
//     (any composer pack via --composer <file> [--composer-id <id>]) and checks
//     N seeds (--seeds, default 200):
//       hook onset <10s · 95-165s length · >=1 section e>=9 · events sorted +
//       within totalBars · register collisions 0 · novelty diff >=2 between
//       consecutive sections · hook restatements >=3 · same-token determinism ·
//       corpus histograms (waveClass/grooveFamily <=60% per bucket) · pairwise
//       fingerprint distance floor (near-duplicate fps <1%)
//   --golden: run the fixed 24-token golden list (always included in --render)
//   --render: Playwright boots dist/, renders each golden seed offline via
//     Audio.Engine.render -> WAV in chip-derived/analysis/audition/renders/,
//     then runs scripts/audio-metrics.js gates (energy@10s >=70%, drone
//     detector zero flags, no clipping)
//   --strict: threshold violations set a non-zero exit code (hard failures —
//     compile throws, broken determinism — always do)
//   --json <file>: report path (default chip-derived/analysis/audition/report.json)
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const AUDITION_DIR = path.join(ROOT, 'chip-derived', 'analysis', 'audition');
const RENDER_DIR = path.join(AUDITION_DIR, 'renders');

function flag(name) { return process.argv.includes(`--${name}`); }
function arg(name, fallback) {
  const ix = process.argv.indexOf(`--${name}`);
  if (ix >= 0 && process.argv[ix + 1] && !process.argv[ix + 1].startsWith('--')) return process.argv[ix + 1];
  const hit = process.argv.find(v => v.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const SEEDS = Math.max(1, Number(arg('seeds', 200)) || 200);
const STRICT = flag('strict');
const RENDER = flag('render');
const GOLDEN = flag('golden') || RENDER;
const JSON_OUT = path.resolve(ROOT, arg('json', path.join(AUDITION_DIR, 'report.json')));
const COMPOSER_FILE = path.resolve(ROOT, arg('composer', path.join('src', 'composer.js')));
const COMPOSER_ID = arg('composer-id', 'rrr_core');

const THRESHOLDS = {
  hookOnsetSec: 10,
  minDurationSec: 95,
  maxDurationSec: 165,
  minPeakEnergy: 9,
  maxRegisterCollisions: 0,
  minSectionNoveltyDiff: 2,
  minRestatements: 3,
  histogramMaxShare: 0.6,
  maxDupFpShare: 0.01,
  minEnergyAt10sPct: 70,
  maxDroneSelfSimilarity: 0.985,
  maxClippedSamples: 0,
  maxTruePeakOvers: 8
};

// Fixed golden corpus: 24 v3 tokens ('<phrase>-<code8>'), stable across rounds
// so renders are comparable listening round to listening round.
const GOLDEN_TOKENS = [
  'velvet-tigers-drift-dusk-7k3m9q2x', 'neon-robots-race-dawn-4h8s1w6p',
  'golden-comets-spin-rain-9d2f7j5m', 'hollow-sirens-burn-glass-3q6n8b1z',
  'restless-wolves-rise-static-8m4c2v7t', 'silent-sparrows-glide-fog-5w9k3r6h',
  'electric-dreamers-chase-snow-2p7g4x9s', 'frozen-angels-fade-fire-6b3t8n1q',
  'molten-machines-bloom-dust-1z5h7d4w', 'lonely-shadows-shiver-silence-9r2j6f8c',
  'gentle-sailors-soar-thunder-4v8m1k3p', 'savage-dancers-echo-ocean-7t2q9w5b',
  'ancient-rebels-drown-sky-3f6x8h2n', 'distant-ghosts-wake-void-8c1s4d7r',
  'secret-lanterns-roam-mist-5j9b2g6v', 'endless-engines-sway-storm-2n7w4t9k',
  'fragile-horses-melt-tide-6h3p8q1f', 'radiant-pilots-gleam-ash-9x5c2m7j',
  'weary-gardens-tremble-smoke-4d8r1v3s', 'fearless-mountains-whisper-twilight-7q2k6b9h',
  'crimson-rivers-collide-horizon-1w5f8n4t', 'cobalt-towers-scatter-harbor-8g3j7c2p',
  'amber-circuits-linger-desert-5m9v1x6d', 'violet-satellites-ascend-midnight-3b7h4s8w'
];

function mulberry32(a) {
  a = a >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- vm composer env (Math.random poisoned: determinism rule) --------------
function loadComposer() {
  const poisonedMath = Object.create(null);
  for (const k of Object.getOwnPropertyNames(Math)) poisonedMath[k] = Math[k];
  poisonedMath.random = () => { throw new Error('Math.random called in a composer path (forbidden)'); };
  const ctx = {
    console, JSON, Date, Object, Array, String, Number, Boolean, RegExp, Error, TypeError, RangeError,
    Map, Set, Promise, Symbol, isFinite, isNaN, parseInt, parseFloat,
    Uint8Array, Uint8ClampedArray, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array,
    Float32Array, Float64Array, ArrayBuffer, DataView,
    Math: poisonedMath,
    performance: { now: () => Date.now() },
    crypto: require('crypto').webcrypto
  };
  ctx.window = ctx;
  ctx.self = ctx;
  vm.createContext(ctx);
  for (const file of [path.join(ROOT, 'src', 'seed.js'), COMPOSER_FILE]) {
    if (!fs.existsSync(file)) throw new Error(`missing ${path.relative(ROOT, file)}`);
    vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: path.relative(ROOT, file) });
  }
  const reg = ctx.CT_COMPOSERS;
  if (!reg || !reg[COMPOSER_ID]) throw new Error(`composer did not register CT_COMPOSERS.${COMPOSER_ID}`);
  const composer = reg[COMPOSER_ID];
  if (typeof composer.compile !== 'function' || typeof composer.fingerprint !== 'function') {
    throw new Error(`CT_COMPOSERS.${COMPOSER_ID} must expose compile() and fingerprint()`);
  }
  return { composer, Song: ctx.Song };
}

// ---- tolerant Score accessors (canonical fields per plan §B) ----------------
function num() { for (let i = 0; i < arguments.length; i++) { const v = arguments[i]; if (typeof v === 'number' && isFinite(v)) return v; } return null; }
function scoreBpm(s) { return num(s.bpm, s.tempo, s.groove && s.groove.bpm); }
function scoreTotalBars(s) { return num(s.totalBars, s.bars, s.lengthBars); }
function scoreBeatsPerBar(s) { return num(s.beatsPerBar, s.meter && s.meter.beats) || 4; }
function scoreSections(s) { const a = s.sections || s.arrangement || s.form; return Array.isArray(a) ? a : null; }
function sectionName(s) { return String(s.role || s.name || s.kind || s.type || s.section || '').toUpperCase(); }
function sectionRole(s) { return String(s.role || s.name || s.kind || s.type || s.section || '').toLowerCase(); }
function sectionStart(s) { return num(s.atBar, s.bar, s.startBar, s.start, s.at); }
function sectionBars(s) { return num(s.bars, s.len, s.length, s.dur); }
function sectionEnergy(s) { return num(s.e, s.energy); }
function scoreEvents(s) { return Array.isArray(s.events) ? s.events : []; }
// canonical event time is tBeat (in BEATS); sections are in bars, so convert when comparing.
function eventTime(ev) { return num(ev.tBeat, ev.bar, ev.t, ev.time, ev.at); }
function eventRole(ev) { return String(ev.role || ev.voice || ev.ch || ev.channel || ''); }
function eventPitch(ev) { return num(ev.midi, ev.note, ev.pitch); }
function eventDur(ev) { const d = num(ev.dur, ev.len, ev.duration); return d == null ? 0.25 : d; }
function scoreDurationSec(s) {
  const explicit = num(s.durationSec, s.seconds, s.lengthSec);
  if (explicit != null) return explicit;
  const bars = scoreTotalBars(s), bpm = scoreBpm(s);
  if (bars == null || !bpm) return null;
  return bars * scoreBeatsPerBar(s) * 60 / bpm;
}
const PERC_RE = /kick|snare|hat|clap|tom|perc|drum|noise/i;
const LEAD_RE = /lead|mel/i;

// ---- symbolic metrics -------------------------------------------------------
function structureProblems(score) {
  const p = [];
  const dur = scoreDurationSec(score);
  if (dur == null) p.push('cannot derive duration (need bpm+totalBars or durationSec)');
  else if (dur < THRESHOLDS.minDurationSec || dur > THRESHOLDS.maxDurationSec) p.push(`length ${dur.toFixed(1)}s outside ${THRESHOLDS.minDurationSec}-${THRESHOLDS.maxDurationSec}s`);
  const bpm = scoreBpm(score), bpb = scoreBeatsPerBar(score);
  const sections = scoreSections(score);
  if (!sections || !sections.length) p.push('no sections array on Score');
  else {
    // Composer maps HOOK -> role 'groove'; the cold-open hook is the earliest section.
    if (!sections.some(s => sectionRole(s) === 'groove')) p.push("no hook ('groove') section in arrangement");
    const first = sections.slice().sort((a, b2) => (sectionStart(a) || 0) - (sectionStart(b2) || 0))[0];
    const b = sectionStart(first);
    const onset = (b == null || !bpm) ? null : b * bpb * 60 / bpm;
    if (onset == null) p.push('first section has no resolvable start bar');
    else if (onset >= THRESHOLDS.hookOnsetSec) p.push(`hook onset ${onset.toFixed(1)}s >= ${THRESHOLDS.hookOnsetSec}s`);
    const energies = sections.map(sectionEnergy);
    if (energies.some(e => e == null)) p.push('section(s) missing energy field (e)');
    else if (!energies.some(e => e >= THRESHOLDS.minPeakEnergy)) p.push(`no section with e>=${THRESHOLDS.minPeakEnergy} (max ${Math.max.apply(null, energies)})`);
  }
  const events = scoreEvents(score);
  const totalBars = scoreTotalBars(score);
  if (!events.length) p.push('no events array on Score');
  else {
    let prev = -Infinity, sorted = true, maxT = -Infinity, badTime = 0;
    for (const ev of events) {
      const t = eventTime(ev);
      if (t == null) { badTime++; continue; }
      if (t < prev) sorted = false;
      prev = t; if (t > maxT) maxT = t;
    }
    if (badTime) p.push(`${badTime} events with no resolvable time`);
    if (!sorted) p.push('events not sorted by time');
    // tBeat is in beats; accept up to totalBars*beatsPerBar.
    if (totalBars != null && maxT > totalBars * scoreBeatsPerBar(score) + 1e-6) p.push(`event time ${maxT} beyond track length (${totalBars * scoreBeatsPerBar(score)} beats)`);
  }
  return p;
}

// Register collision = two overlapping melodic events of DIFFERENT roles landing
// on the exact same midi pitch (unison masking between bass/chords/lead layers).
function registerCollisions(score) {
  const evs = scoreEvents(score)
    .filter(ev => eventPitch(ev) != null && !PERC_RE.test(eventRole(ev)))
    .map(ev => ({ t: eventTime(ev), end: (eventTime(ev) || 0) + eventDur(ev), pitch: eventPitch(ev), role: eventRole(ev) }))
    .filter(ev => ev.t != null);
  evs.sort((a, b) => a.t - b.t);
  let collisions = 0;
  for (let i = 0; i < evs.length; i++) {
    for (let j = i + 1; j < evs.length && evs[j].t < evs[i].end; j++) {
      if (evs[j].pitch === evs[i].pitch && evs[j].role !== evs[i].role) collisions++;
    }
  }
  return collisions;
}

// Per-section descriptor over 5 axes approximating the plan's novelty contract
// {layers, register, motif-op, drum variant, loop position(~density)}.
function sectionDescriptor(score, section, index) {
  const bpb = scoreBeatsPerBar(score);
  const start = sectionStart(section);
  const bars = sectionBars(section);
  // event times are in beats; section boundaries in bars -> convert to beats.
  const s0 = (start != null ? start : 0) * bpb;
  const s1 = bars != null ? s0 + bars * bpb : Infinity;
  const evs = scoreEvents(score).filter(ev => { const t = eventTime(ev); return t != null && t >= s0 - 1e-6 && t < s1 - 1e-6; });
  const roles = Array.from(new Set(evs.map(eventRole))).sort();
  const leadEvs = evs.filter(ev => LEAD_RE.test(eventRole(ev)) && eventPitch(ev) != null);
  const leadMean = leadEvs.length ? leadEvs.reduce((s, e) => s + eventPitch(e), 0) / leadEvs.length : -1;
  const register = leadMean < 0 ? 'none' : String(Math.round(leadMean / 6)); // half-octave buckets
  const intervals = [];
  for (let i = 1; i < Math.min(leadEvs.length, 9); i++) intervals.push(eventPitch(leadEvs[i]) - eventPitch(leadEvs[i - 1]));
  const motif = intervals.join(',') || 'none';
  const drumEvs = evs.filter(ev => PERC_RE.test(eventRole(ev)));
  const drumSlots = new Set(drumEvs.map(ev => `${eventRole(ev)}@${Math.round((((eventTime(ev) - s0) % bpb) / bpb) * 16)}`));
  const drum = Array.from(drumSlots).sort().join('|') || 'none';
  const density = bars ? String(Math.round(evs.length / bars)) : String(evs.length);
  return { index, name: sectionName(section), layers: roles.join('+'), register, motif, drum, density };
}

function sectionNoveltyProblems(score) {
  const sections = scoreSections(score);
  if (!sections || sections.length < 2) return [];
  const descs = sections.map((s, i) => sectionDescriptor(score, s, i));
  const problems = [];
  for (let i = 1; i < descs.length; i++) {
    let diff = 0;
    for (const axis of ['layers', 'register', 'motif', 'drum', 'density']) {
      if (descs[i][axis] !== descs[i - 1][axis]) diff++;
    }
    if (diff < THRESHOLDS.minSectionNoveltyDiff) {
      problems.push(`sections ${i - 1}(${descs[i - 1].name})->${i}(${descs[i].name}) differ on only ${diff}/5 axes (< ${THRESHOLDS.minSectionNoveltyDiff})`);
    }
  }
  return problems;
}

function restatements(score) {
  const sections = scoreSections(score);
  if (!sections || !sections.length) return 0;
  // hook statements = the mapped hook role ('groove') plus its late payoff ('drop').
  const named = sections.filter(s => sectionRole(s) === 'groove' || sectionRole(s) === 'drop').length;
  if (named) return named;
  // no names: fall back to motif recurrence vs the first section's lead motif
  const descs = sections.map((s, i) => sectionDescriptor(score, s, i));
  const ref = descs.find(d => d.motif !== 'none');
  if (!ref) return 0;
  return descs.filter(d => d.motif === ref.motif).length;
}

function analyzeToken(composer, token) {
  const row = { token, problems: [], hard: [] };
  let score;
  try {
    score = composer.compile(token);
    const again = composer.compile(token);
    if (JSON.stringify(score) !== JSON.stringify(again)) row.hard.push('compile is NOT deterministic (same token -> different Score)');
  } catch (e) {
    row.hard.push(`compile threw: ${e && e.message || e}`);
    return row;
  }
  try {
    row.fp = composer.fingerprint(token);
  } catch (e) {
    row.hard.push(`fingerprint threw: ${e && e.message || e}`);
  }
  row.problems.push(...structureProblems(score));
  const coll = registerCollisions(score);
  row.registerCollisions = coll;
  if (coll > THRESHOLDS.maxRegisterCollisions) row.problems.push(`${coll} register collisions (unison masking between roles)`);
  row.problems.push(...sectionNoveltyProblems(score));
  const rest = restatements(score);
  row.restatements = rest;
  if (rest < THRESHOLDS.minRestatements) row.problems.push(`hook restated ${rest}x (< ${THRESHOLDS.minRestatements})`);
  const dur = scoreDurationSec(score);
  row.durationSec = dur == null ? null : +dur.toFixed(1);
  row.bpm = scoreBpm(score);
  row.eventCount = scoreEvents(score).length;
  return row;
}

// ---- corpus-level checks ----------------------------------------------------
function fpVector(fp) {
  return [
    (num(fp.bpm) || 0) / 200,
    (num(fp.keyPc) || 0) / 12,
    num(fp.brightness) || 0,
    num(fp.density) || 0,
    (num(fp.energyPeak) || 0) / 10,
    num(fp.echoDepth) || 0
  ];
}
function corpusProblems(rows) {
  const problems = [];
  const withFp = rows.filter(r => r.fp);
  if (!withFp.length) { problems.push('no fingerprints produced'); return problems; }
  for (const axis of ['waveClass', 'grooveFamily']) {
    const hist = {};
    for (const r of withFp) { const k = String(r.fp[axis]); hist[k] = (hist[k] || 0) + 1; }
    const buckets = Object.entries(hist).filter(([k]) => k !== 'undefined' && k !== 'null');
    if (buckets.length < 2) problems.push(`fingerprint ${axis} degenerate: ${buckets.length} bucket(s)`);
    for (const [k, n] of buckets) {
      if (n / withFp.length > THRESHOLDS.histogramMaxShare) problems.push(`fingerprint ${axis} degenerate: "${k}" = ${(100 * n / withFp.length).toFixed(1)}% (> ${THRESHOLDS.histogramMaxShare * 100}%)`);
    }
  }
  // pairwise fingerprint distance floor: near-identical fps (numeric distance
  // < 0.02 AND same categorical axes) must stay under maxDupFpShare
  let dups = 0, pairs = 0;
  const cap = Math.min(withFp.length, 200); // O(n^2) guard
  for (let i = 0; i < cap; i++) {
    const vi = fpVector(withFp[i].fp);
    for (let j = i + 1; j < cap; j++) {
      pairs++;
      const vj = fpVector(withFp[j].fp);
      let d = 0;
      for (let k = 0; k < vi.length; k++) d += (vi[k] - vj[k]) * (vi[k] - vj[k]);
      if (Math.sqrt(d) < 0.02 &&
        String(withFp[i].fp.waveClass) === String(withFp[j].fp.waveClass) &&
        String(withFp[i].fp.grooveFamily) === String(withFp[j].fp.grooveFamily)) dups++;
    }
  }
  if (pairs && dups / pairs > THRESHOLDS.maxDupFpShare) {
    problems.push(`fingerprint space too clumped: ${(100 * dups / pairs).toFixed(2)}% near-duplicate pairs (> ${THRESHOLDS.maxDupFpShare * 100}%)`);
  }
  return problems;
}

// ---- rendered pass ----------------------------------------------------------
function mimeFor(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (file.endsWith('.json')) return 'application/json; charset=utf-8';
  if (file.endsWith('.wasm')) return 'application/wasm';
  return 'application/octet-stream';
}
function startServer() {
  const http = require('http');
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      let rel = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
      if (!rel || rel.endsWith('/')) rel += 'index.html';
      let file = path.normalize(path.join(DIST, rel));
      const noFallback = rel.startsWith('packs/') || rel.startsWith('lib/');
      if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        if (noFallback) { res.writeHead(404); res.end('not found'); return; }
        file = path.join(DIST, 'index.html');
      }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(500); res.end(String(err.message || err)); return; }
        res.writeHead(200, { 'content-type': mimeFor(file), 'cache-control': 'no-store' });
        res.end(buf);
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/` }));
  });
}

async function renderGolden(tokens, report) {
  const audioMetrics = require('./audio-metrics.js');
  if (!fs.existsSync(path.join(DIST, 'index.html'))) throw new Error('dist/index.html missing. Run `node build.js` first.');
  const { chromium } = require('playwright');
  fs.mkdirSync(RENDER_DIR, { recursive: true });
  const { server, url } = await startServer();
  const browser = await chromium.launch({ headless: true });
  const rendered = [];
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    let engineReady = false;
    try {
      await page.waitForFunction(
        // the app's Audio is a lexical global (window.Audio is the built-in HTMLAudioElement)
        () => typeof Audio !== 'undefined' && Audio.Engine && typeof Audio.Engine.render === 'function',
        null, { timeout: 15000 }
      );
      engineReady = true;
    } catch (e) { /* Engine.render absent: guarded skip below */ }
    if (!engineReady) {
      report.renderSkipped = 'Audio.Engine.render is not available in this build — rendered pass skipped';
      console.warn('WARN: ' + report.renderSkipped);
      return rendered;
    }
    const chunks = [];
    await page.exposeFunction('__auditionEmit', b64 => { chunks.push(Buffer.from(b64, 'base64')); });
    for (const token of tokens) {
      const wavFile = path.join(RENDER_DIR, token.replace(/[^a-z0-9-]/g, '_') + '.wav');
      const row = { token, wav: path.relative(ROOT, wavFile), problems: [], hard: [] };
      chunks.length = 0;
      try {
        const meta = await page.evaluate(async (token) => {
          const comp = (typeof activeComposer === 'function') ? activeComposer()
            : (window.CT_COMPOSERS && (window.CT_COMPOSERS.rrr_core || Object.values(window.CT_COMPOSERS)[0]));
          if (!comp) throw new Error('no composer registered (activeComposer/CT_COMPOSERS missing)');
          const score = comp.compile(token);
          const buf = await Audio.Engine.render(score);
          let sr, data;
          if (buf && buf.left) {                                  // {left,right,sampleRate} (the app's Engine.render)
            sr = buf.sampleRate || 48000;
            data = [buf.left, buf.right || buf.left];
          } else if (buf && typeof buf.getChannelData === 'function') {
            sr = buf.sampleRate;
            data = [];
            for (let c = 0; c < Math.min(2, buf.numberOfChannels); c++) data.push(buf.getChannelData(c));
          } else if (buf && Array.isArray(buf.channels)) {
            sr = buf.sampleRate;
            data = buf.channels.slice(0, 2);
          } else {
            throw new Error('Engine.render returned an unrecognized buffer shape');
          }
          if (data.length === 1) data.push(data[0]);
          const len = data[0].length;
          const bytes = new Uint8Array(44 + len * 4);
          const dv = new DataView(bytes.buffer);
          const wstr = (off, s) => { for (let i = 0; i < s.length; i++) bytes[off + i] = s.charCodeAt(i); };
          wstr(0, 'RIFF'); dv.setUint32(4, 36 + len * 4, true); wstr(8, 'WAVE');
          wstr(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 2, true);
          dv.setUint32(24, sr, true); dv.setUint32(28, sr * 4, true); dv.setUint16(32, 4, true); dv.setUint16(34, 16, true);
          wstr(36, 'data'); dv.setUint32(40, len * 4, true);
          for (let i = 0; i < len; i++) {
            for (let c = 0; c < 2; c++) {
              let v = Math.max(-1, Math.min(1, data[c][i]));
              dv.setInt16(44 + (i * 2 + c) * 2, Math.round(v * 32767), true);
            }
          }
          const CHUNK = 1 << 20;
          for (let off = 0; off < bytes.length; off += CHUNK) {
            const slice = bytes.subarray(off, Math.min(bytes.length, off + CHUNK));
            let s = '';
            for (let i = 0; i < slice.length; i += 0x8000) s += String.fromCharCode.apply(null, slice.subarray(i, Math.min(slice.length, i + 0x8000)));
            await window.__auditionEmit(btoa(s));
          }
          return { sr, len, seconds: +(len / sr).toFixed(1) };
        }, token);
        fs.writeFileSync(wavFile, Buffer.concat(chunks));
        row.seconds = meta.seconds;
        // SILENCE GATE (hard): a full-length all-zero render shipped 10/24 goldens
        // once (offline worklet message race) and every downstream metric + the
        // blind A/B silently consumed them. Peak==0 can never be a soft problem.
        {
          const wb = fs.readFileSync(wavFile);
          let pk = 0;
          for (let i = 44; i < wb.length - 1; i += 128) { const s = Math.abs(wb.readInt16LE(i)); if (s > pk) pk = s; }
          if (pk === 0) { row.hard.push('rendered file is PURE SILENCE (peak sample 0) — offline render failed'); }
        }
        const m = audioMetrics.analyzeWav(wavFile);
        row.metrics = m;
        if (m.energyAt10sPct < THRESHOLDS.minEnergyAt10sPct) row.problems.push(`energy@10s ${m.energyAt10sPct}% < ${THRESHOLDS.minEnergyAt10sPct}%`);
        if (m.drone.maxSelfSimilarity >= THRESHOLDS.maxDroneSelfSimilarity) row.problems.push(`drone flag: self-similarity ${m.drone.maxSelfSimilarity} @ ${m.drone.atSec}s`);
        if (m.peaks.clippedSamples > THRESHOLDS.maxClippedSamples) row.problems.push(`${m.peaks.clippedSamples} clipped samples`);
        if (m.peaks.truePeakOvers > THRESHOLDS.maxTruePeakOvers) row.problems.push(`true-peak overs ${m.peaks.truePeakOvers} (> ${THRESHOLDS.maxTruePeakOvers})`);
        console.log(`rendered ${token}: ${meta.seconds}s  e@10s ${m.energyAt10sPct}%  drone ${m.drone.maxSelfSimilarity}  int ${m.loudness.integratedLUFS} LUFS${row.problems.length ? '  PROBLEMS: ' + row.problems.join('; ') : ''}`);
      } catch (e) {
        row.hard.push(`render failed: ${e && e.message || e}`);
        console.error(`render ${token} FAILED: ${e && e.message || e}`);
      }
      rendered.push(row);
    }
    await page.close();
  } finally {
    await browser.close();
    server.close();
  }
  return rendered;
}

// ---- main --------------------------------------------------------------------
(async () => {
  const report = {
    generatedAt: new Date().toISOString(),
    composer: path.relative(ROOT, COMPOSER_FILE),
    composerId: COMPOSER_ID,
    seeds: SEEDS,
    strict: STRICT,
    thresholds: THRESHOLDS
  };

  const { composer, Song } = loadComposer();
  if (!Song || typeof Song.mint !== 'function') throw new Error('Song.mint missing from src/seed.js');
  function corpusToken(i) {
    try { return Song.mint({ random: mulberry32(0xA0D17103 ^ Math.imul(i + 1, 2654435761)) }); }
    catch (e) { return Song.mint(); }
  }

  // symbolic pass
  const tokens = [];
  for (let i = 0; i < SEEDS; i++) tokens.push(corpusToken(i));
  if (GOLDEN) for (const t of GOLDEN_TOKENS) if (!tokens.includes(t)) tokens.push(t);
  const rows = tokens.map(t => analyzeToken(composer, t));
  const symbolicProblems = [];
  for (const r of rows) {
    for (const h of r.hard) symbolicProblems.push({ token: r.token, hard: true, err: h });
    for (const p of r.problems) symbolicProblems.push({ token: r.token, hard: false, err: p });
  }
  for (const p of corpusProblems(rows)) symbolicProblems.push({ token: 'corpus', hard: false, err: p });

  report.symbolic = {
    count: rows.length,
    withProblems: rows.filter(r => r.problems.length || r.hard.length).length,
    problems: symbolicProblems,
    histograms: (() => {
      const h = { waveClass: {}, grooveFamily: {} };
      for (const r of rows) if (r.fp) for (const axis of ['waveClass', 'grooveFamily']) {
        const k = String(r.fp[axis]); h[axis][k] = (h[axis][k] || 0) + 1;
      }
      return h;
    })(),
    rows: rows.map(r => ({ token: r.token, bpm: r.bpm, durationSec: r.durationSec, events: r.eventCount, registerCollisions: r.registerCollisions, restatements: r.restatements, fp: r.fp, problems: r.problems, hard: r.hard }))
  };

  // rendered pass (golden seeds only)
  if (RENDER) {
    report.rendered = await renderGolden(GOLDEN_TOKENS, report);
  }

  const hardFailures = symbolicProblems.filter(p => p.hard).length +
    ((report.rendered || []).reduce((n, r) => n + r.hard.length, 0));
  const softFailures = symbolicProblems.filter(p => !p.hard).length +
    ((report.rendered || []).reduce((n, r) => n + r.problems.length, 0));

  report.pass = hardFailures === 0 && (!STRICT || softFailures === 0);

  fs.mkdirSync(path.dirname(JSON_OUT), { recursive: true });
  fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2) + '\n');

  const shown = symbolicProblems.slice(0, 40);
  for (const p of shown) console.error(`${p.hard ? 'HARD' : 'gate'}  ${p.token}: ${p.err}`);
  if (symbolicProblems.length > shown.length) console.error(`... and ${symbolicProblems.length - shown.length} more (see ${path.relative(ROOT, JSON_OUT)})`);
  console.log(`audition: ${rows.length} seeds symbolic${report.rendered ? `, ${report.rendered.length} golden rendered` : ''} — ${hardFailures} hard, ${softFailures} gate problem(s) -> ${path.relative(ROOT, JSON_OUT)}`);
  if (!report.pass) process.exit(1);
})().catch(err => {
  console.error(err && err.stack || err);
  process.exit(1);
});
