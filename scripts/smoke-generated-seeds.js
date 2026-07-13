#!/usr/bin/env node
// Generated-music smoke: Song v3 identity + rrr_core composer purity/determinism.
// Pure Node — vm-loads src/seed.js + src/composer.js into a minimal global env
// (composer attaches CT_COMPOSERS to window/globalThis; Math.random is POISONED
// in the context so any decision-randomness in composer paths throws).
//
// Asserts:
//   - Song.V === 3; mint() -> '<phrase>-<code8>' (no target/idiom prefixes)
//   - 5000-mint uniqueness + title() strips the entropy code (new AND legacy slugs)
//   - CT_COMPOSERS.rrr_core = { V:3, compile(token)->Score, fingerprint(token)->fp }
//   - compile determinism: same token twice -> deep-equal Score (25 seeds)
//   - 500-seed fingerprint diversity: waveClass/grooveFamily histograms
//     non-degenerate (no bucket >60%)
//   - per-Score structure: hook onset <10s, 95-165s length, >=1 section e>=9,
//     events sorted + within totalBars
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SEED_FILE = path.join(ROOT, 'src', 'seed.js');
const COMPOSER_FILE = path.join(ROOT, 'src', 'composer.js');

const failures = [];
function fail(msg) { failures.push(msg); }
function assert(cond, msg) { if (!cond) fail(msg); }

// Local deterministic rng (mirror of seed.js internals) so the token corpus is
// reproducible run-to-run without depending on Song's private exports.
function mulberry32(a) {
  a = a >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- vm env -------------------------------------------------------------
function makeEnv() {
  const poisonedMath = Object.create(null);
  for (const k of Object.getOwnPropertyNames(Math)) poisonedMath[k] = Math[k];
  poisonedMath.random = () => { throw new Error('Math.random called in a composer/seed path (forbidden: determinism rule)'); };
  const ctx = {
    console, JSON, Date, Object, Array, String, Number, Boolean, RegExp, Error, TypeError, RangeError,
    Map, Set, Promise, Symbol, isFinite, isNaN, parseInt, parseFloat, NaN, Infinity, undefined: undefined,
    Uint8Array, Uint8ClampedArray, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array,
    Float32Array, Float64Array, ArrayBuffer, DataView,
    Math: poisonedMath,
    performance: { now: () => Date.now() },
    crypto: require('crypto').webcrypto // seed.js mint() uses crypto.getRandomValues for fresh entropy
  };
  ctx.window = ctx;
  ctx.self = ctx;
  vm.createContext(ctx);
  return ctx;
}

function loadInto(ctx, file) {
  vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: path.relative(ROOT, file) });
}

// ---- tolerant Score accessors (canonical fields per plan §B; aliases accepted
//      so this smoke stays useful while the composer schema settles) ----------
function num() { for (let i = 0; i < arguments.length; i++) { const v = arguments[i]; if (typeof v === 'number' && isFinite(v)) return v; } return null; }
function scoreBpm(s) { return num(s.bpm, s.tempo, s.groove && s.groove.bpm); }
function scoreTotalBars(s) { return num(s.totalBars, s.bars, s.lengthBars); }
function scoreBeatsPerBar(s) { return num(s.beatsPerBar, s.meter && s.meter.beats) || 4; }
function scoreSections(s) { const a = s.sections || s.arrangement || s.form; return Array.isArray(a) ? a : null; }
function sectionRole(s) { return String(s.role || s.name || s.kind || s.type || s.section || '').toLowerCase(); }
function sectionStart(s) { return num(s.atBar, s.bar, s.startBar, s.start, s.at); }
function sectionEnergy(s) { return num(s.e, s.energy); }
function scoreEvents(s) { return Array.isArray(s.events) ? s.events : null; }
// canonical event time is tBeat (BEATS); older/alt schemas used bar/t/time/at.
function eventTime(ev) { return num(ev.tBeat, ev.bar, ev.t, ev.time, ev.at); }
function scoreDurationSec(s) {
  const explicit = num(s.durationSec, s.seconds, s.lengthSec);
  if (explicit != null) return explicit;
  const bars = scoreTotalBars(s), bpm = scoreBpm(s);
  if (bars == null || !bpm) return null;
  return bars * scoreBeatsPerBar(s) * 60 / bpm;
}
function barToSec(s, bar) {
  const bpm = scoreBpm(s);
  return bpm ? bar * scoreBeatsPerBar(s) * 60 / bpm : null;
}

function checkScoreStructure(token, score) {
  const local = [];
  if (!score || typeof score !== 'object') { fail(`${token}: compile() returned ${typeof score}`); return; }
  const dur = scoreDurationSec(score);
  if (dur == null) local.push('cannot derive duration (need bpm+totalBars or durationSec)');
  else if (dur < 95 || dur > 165) local.push(`length ${dur.toFixed(1)}s outside 95-165s`);

  const sections = scoreSections(score);
  if (!sections || !sections.length) local.push('no sections array on Score');
  else {
    // Composer emits sections already mapped to the vis() vocabulary; the HOOK is role 'groove'.
    if (!sections.some(s => sectionRole(s) === 'groove')) local.push("no hook ('groove') section in arrangement");
    // Cold-open: the earliest section must start within 10s (hook stated up front).
    const first = sections.slice().sort((a, b) => (sectionStart(a) || 0) - (sectionStart(b) || 0))[0];
    const startBar = sectionStart(first);
    const onset = startBar == null ? null : barToSec(score, startBar);
    if (onset == null) local.push('first section has no resolvable start bar');
    else if (onset >= 10) local.push(`hook onset ${onset.toFixed(1)}s >= 10s`);
    const energies = sections.map(sectionEnergy);
    if (energies.some(e => e == null)) local.push('section(s) missing energy field (e)');
    else if (!energies.some(e => e >= 9)) local.push(`no section with e>=9 (max ${Math.max.apply(null, energies)})`);
  }

  const events = scoreEvents(score);
  const totalBars = scoreTotalBars(score);
  if (!events || !events.length) local.push('no events array on Score');
  else {
    let prev = -Infinity, sorted = true, maxT = -Infinity, badTime = 0;
    for (const ev of events) {
      const t = eventTime(ev);
      if (t == null) { badTime++; continue; }
      if (t < prev) sorted = false;
      prev = t; if (t > maxT) maxT = t;
    }
    if (badTime) local.push(`${badTime} events with no resolvable time (tBeat/bar/t/time/at)`);
    if (!sorted) local.push('events not sorted by time');
    // tBeat is in BEATS; accept either bar-scaled or beat-scaled times within the track length.
    if (totalBars != null) {
      const totalBeats = totalBars * scoreBeatsPerBar(score);
      if (maxT > totalBars + 1e-6 && maxT > totalBeats + 1e-6) local.push(`event time ${maxT} beyond track length (${totalBars} bars / ${totalBeats} beats)`);
    }
  }
  for (const p of local) fail(`${token}: ${p}`);
}

// ---- main ----------------------------------------------------------------
(function main() {
  const ctx = makeEnv();
  loadInto(ctx, SEED_FILE);
  const Song = ctx.Song;
  if (!Song) throw new Error('Song global was not created by src/seed.js');

  // -- Song v3 identity --
  assert(Song.V === 3, `Song.V expected 3, got ${Song.V}`);
  const seen = new Set();
  for (let i = 0; i < 5000; i++) {
    const slug = Song.mint();
    if (!/^[a-z][a-z0-9-]*-[0-9a-z]{8}$/.test(slug)) { fail(`bad v3 slug format: ${slug}`); break; }
    const code = slug.slice(-8);
    if (!/[0-9]/.test(code) || !/[a-z]/.test(code)) fail(`entropy code missing digit/letter mix: ${slug}`);
    const title = Song.title(slug);
    if (!title || /[0-9]/.test(title)) fail(`title leaked entropy suffix: ${slug} -> ${title}`);
    seen.add(slug);
  }
  assert(seen.size >= 4995, `too many mint collisions: ${seen.size}/5000 unique`);

  // -- title() on legacy (v2 target/idiom-prefixed) slugs: static legacy prefix
  //    list must strip old prefixes; entropy code always stripped. --
  const legacyCases = [
    ['nes-stage-velvet-tigers-drift-dusk-a1b2c3d4', 'Velvet Tigers Drift Dusk'],
    ['gameboy-lsdj-tech-house-neon-robots-race-dawn-9f8e7d6c', 'Neon Robots Race Dawn']
  ];
  for (const [slug, want] of legacyCases) {
    const got = Song.title(slug);
    if (/[0-9]/.test(got)) fail(`legacy title leaked entropy: ${slug} -> ${got}`);
    if (got !== want) fail(`legacy prefix not stripped: ${slug} -> "${got}" (want "${want}")`);
  }

  // -- seeded rng determinism kept --
  if (typeof Song.rng === 'function') {
    const a = Song.rng('velvet-tigers-drift-dusk-a1b2c3d4');
    const b = Song.rng('velvet-tigers-drift-dusk-a1b2c3d4');
    for (let i = 0; i < 20; i++) if (a() !== b()) { fail('Song.rng not repeatable for same token'); break; }
  }

  // -- composer pack --
  if (!fs.existsSync(COMPOSER_FILE)) {
    throw new Error('src/composer.js is missing — the rrr_core composer must exist for the generated-music smoke');
  }
  loadInto(ctx, COMPOSER_FILE);
  const reg = ctx.CT_COMPOSERS || (ctx.window && ctx.window.CT_COMPOSERS);
  if (!reg || !reg.rrr_core) throw new Error('composer did not register CT_COMPOSERS.rrr_core');
  const composer = reg.rrr_core;
  assert(composer.V === 3, `CT_COMPOSERS.rrr_core.V expected 3, got ${composer.V}`);
  assert(typeof composer.compile === 'function', 'rrr_core.compile is not a function');
  assert(typeof composer.fingerprint === 'function', 'rrr_core.fingerprint is not a function');

  // Deterministic token corpus (falls back to fresh mints if mint ignores {random}).
  function corpusToken(i) {
    try { return Song.mint({ random: mulberry32(0x52525233 ^ Math.imul(i + 1, 2654435761)) }); }
    catch (e) { return Song.mint(); }
  }

  // -- compile determinism + structure on 25 seeds --
  for (let i = 0; i < 25; i++) {
    const token = corpusToken(i);
    let s1, s2;
    try { s1 = composer.compile(token); s2 = composer.compile(token); }
    catch (e) { fail(`${token}: compile threw: ${e && e.stack || e}`); continue; }
    if (JSON.stringify(s1) !== JSON.stringify(s2)) fail(`${token}: compile is NOT deterministic (same token -> different Score)`);
    let f1, f2;
    try { f1 = composer.fingerprint(token); f2 = composer.fingerprint(token); }
    catch (e) { fail(`${token}: fingerprint threw: ${e && e.stack || e}`); continue; }
    if (JSON.stringify(f1) !== JSON.stringify(f2)) fail(`${token}: fingerprint is NOT deterministic`);
    checkScoreStructure(token, s1);
  }

  // -- 500-seed fingerprint diversity --
  const FP_FIELDS = ['bpm', 'keyPc', 'brightness', 'waveClass', 'grooveFamily', 'density', 'energyPeak', 'echoDepth', 'leadMode'];
  const hist = { waveClass: {}, grooveFamily: {} };
  let fpCount = 0, fieldMissing = new Set();
  for (let i = 0; i < 500; i++) {
    const token = corpusToken(1000 + i);
    let fp;
    try { fp = composer.fingerprint(token); } catch (e) { fail(`${token}: fingerprint threw: ${e && e.message || e}`); continue; }
    if (!fp || typeof fp !== 'object') { fail(`${token}: fingerprint returned ${typeof fp}`); continue; }
    fpCount++;
    for (const f of FP_FIELDS) if (fp[f] == null) fieldMissing.add(f);
    const bpm = num(fp.bpm);
    if (bpm != null && (bpm < 80 || bpm > 200)) fail(`${token}: fingerprint bpm ${bpm} outside sane range 80-200`);
    hist.waveClass[String(fp.waveClass)] = (hist.waveClass[String(fp.waveClass)] || 0) + 1;
    hist.grooveFamily[String(fp.grooveFamily)] = (hist.grooveFamily[String(fp.grooveFamily)] || 0) + 1;
  }
  for (const f of fieldMissing) fail(`fingerprint missing contract field across 500 seeds: ${f}`);
  for (const axis of ['waveClass', 'grooveFamily']) {
    const buckets = Object.entries(hist[axis]).filter(([k]) => k !== 'undefined' && k !== 'null');
    if (buckets.length < 2) { fail(`fingerprint ${axis} degenerate: ${buckets.length} bucket(s) over ${fpCount} seeds`); continue; }
    for (const [k, n] of buckets) {
      if (n / fpCount > 0.6) fail(`fingerprint ${axis} histogram degenerate: "${k}" = ${(100 * n / fpCount).toFixed(1)}% (> 60%)`);
    }
  }

  if (failures.length) {
    console.error(failures.slice(0, 60).join('\n'));
    if (failures.length > 60) console.error(`... and ${failures.length - 60} more`);
    process.exit(1);
  }
  const wc = Object.keys(hist.waveClass).length, gf = Object.keys(hist.grooveFamily).length;
  console.log(`generated seed smoke ok: ${seen.size} unique v3 tokens, 25-seed deterministic compile, 500-seed fp diversity (${wc} waveClass / ${gf} grooveFamily buckets)`);
})();
