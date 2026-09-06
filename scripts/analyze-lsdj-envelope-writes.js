'use strict';
// Offline, read-only analysis of what LSDj (owner ROM, format 22) actually
// WRITES to NR12 for a held pulse-1 note, across modern first-stage rates,
// targets, tempos and models. It is evidence about ORDERED REGISTER WRITES and
// their cycle timing ONLY. It never reads hardware volume (mGBA decay is not an
// oracle), invents no rate formula, and claims no playback parity. Last-write
// timing is NOT proof a note is still audible.
//
// The captured writes (e.g. the 09/11/18 held-update burst) are model-specific
// NRx2 "zombie" quirks our APU does not model; they are evidence, NOT something
// that can be replayed verbatim as env.ops on our engine.
//
// Why the ROM is in the loop: our codec only writes format 7, so to obtain a
// real modern instrument we upgrade a v7 base once per tempo via lsdjplay's
// LSDJ_BOOT_SONG dump, then overwrite only the MEASURED instrument bytes
// (byte 1 low nibble = 4-bit first-stage rate, high nibble = initial volume;
// byte 9 = stage-2 amplitude/target; byte A = 0 -- docs/HANDOFF.md 2026-09-05).
// The edited song is placed in the working-memory song at offset 0 of a real
// sav produced by the codec (the existing fixtures show LSDj plays offset 0),
// so no sav header offsets are hand-authored here.
//
// Requirements (all via env; no fetch, no writes outside a tmp dir unless --out
// is given):
//   LSDJ_ROM     owner ROM (never copied; only its writes are observed)
//   LSDJ_WRITES  cycle-ordered write probe (default /tmp/lsdjwrites)
//   LSDJPLAY     boot/upgrade probe        (default /tmp/lsdjplay)
// Optional narrowing flags (defaults cover the full requested matrix):
//   --rates=0-15  --targets=0,15  --tempos=80,160  --models=DMG,CGB
//   --frames=360  --out=<json path>
//
// Additive modes (self-contained; validate flags, then run and exit):
//   --selftest        no-ROM unit test of parse()/analyze()
//   --stages-matrix   probe stage-2 rate, stage-3 level/rate, and onset phase via
//     --initials, --stage1rates, --stage2levels, --stage2rates, --stage3levels,
//     --stage3rates, --steps (defaults keep the planned count <= --max, default
//     64). Later-stage bytes are RAW-BYTE experiments, not an asserted ADSR
//     formula; timestamps are raw mTiming ticks whose scale is not established.
//
// Output: machine-readable JSON (path printed) with every captured record plus
// a concise, hedged summary. No ROM bytes or sav bytes appear in the output.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');
const api = require('../src/api');
const L = require('../src/lsdj');

const TIMEOUT = 120000;                 // per spawned child, ms
const CH_ENV = 0x12, CH_TRIG = 0x14;    // pulse 1 (Melody lane): NR12 / NR14
// The current importer's finite-hold-then-cut table (known wrong for modern
// instruments); kept only to CONTRAST with the observed ongoing automation.
const ENVELOPE_HOLD = [0, 1, 1, 1, 1, 1, 2, 2, 3, 4, 5, 6, 8, 11, 15, 20];
const MAX_LIST = 1024;
// lsdjwrites captures 12 START + 12 release frames before the play window, so
// the last captured frame index is (24 + playFrames - 1). Truncation is judged
// against that real capture end, never against the last observed write.
const CAPTURE_LEAD = 24;
const TRUNC_MARGIN = 2;   // frames; an update this close to capture end may continue

function flags() {
  const a = {};
  for (const s of process.argv.slice(2)) {
    const m = /^--([\w-]+)(?:=(.*))?$/.exec(s);
    assert(m, 'unrecognized argument: ' + s);
    a[m[1]] = m[2] === undefined ? true : m[2];
  }
  return a;
}
// Expand comma lists and a-b ranges, but bound expansion BEFORE building it.
function rangeOf(v, def) {
  if (v == null) return def;
  const out = [];
  for (const part of v.split(',')) {
    const p = part.trim();
    const r = /^(\d+)-(\d+)$/.exec(p);
    if (r) {
      const lo = +r[1], hi = +r[2];
      assert(Number.isSafeInteger(lo) && Number.isSafeInteger(hi) && lo >= 0 && hi <= 15 && hi >= lo && hi - lo < MAX_LIST,
        'rate range must stay within 0..15: ' + p);
      for (let i = lo; i <= hi; i++) out.push(i);
    } else {
      const n = Number(p);
      assert(Number.isInteger(n), 'not an integer: ' + p);
      out.push(n);
    }
    assert(out.length <= MAX_LIST, 'expanded list too large');
  }
  return out;
}
function listOf(v, def, map) {
  if (v == null) return def;
  return v.split(',').map(s => s.trim()).filter(Boolean).map(map || (x => x));
}
function uniqInts(arr, lo, hi, label) {
  assert(Array.isArray(arr) && arr.length, '--' + label + ' must be a non-empty list');
  const seen = new Set();
  for (const v of arr) {
    assert(Number.isInteger(v) && v >= lo && v <= hi, '--' + label + ' value out of [' + lo + ',' + hi + ']: ' + v);
    assert(!seen.has(v), '--' + label + ' has a duplicate: ' + v);
    seen.add(v);
  }
  return arr;
}

const args = flags();
const rates = uniqInts(rangeOf(args.rates, [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15]), 0, 15, 'rates');
const targets = uniqInts(listOf(args.targets, [0, 15], Number), 0, 15, 'targets');
for (const t of targets) assert(t === 0 || t === 15, '--targets must be 0 or 15');
const tempos = uniqInts(listOf(args.tempos, [80, 160], Number), 40, 255, 'tempos');
const models = listOf(args.models, ['DMG', 'CGB']);
assert(models.length && new Set(models).size === models.length, '--models must be non-empty and unique');
for (const m of models) assert(m === 'DMG' || m === 'CGB', '--models must be DMG or CGB');
const frames = args.frames != null ? Number(args.frames) : 360;
assert(Number.isInteger(frames) && frames > 0 && frames <= 5000, '--frames out of range');

// Flags are fully validated above; the analyze/parse unit self-test needs no ROM.
if (args.selftest) { runSelfTest(); process.exit(0); }

const romPath = process.env.LSDJ_ROM;
const writesExplicit = process.env.LSDJ_WRITES != null, playExplicit = process.env.LSDJPLAY != null;
const writes = process.env.LSDJ_WRITES || '/tmp/lsdjwrites';
const play = process.env.LSDJPLAY || '/tmp/lsdjplay';
function skip(msg) { console.log('SKIP envelope-writes analysis: ' + msg); process.exit(0); }
if (romPath == null) skip('set LSDJ_ROM (and LSDJ_WRITES, LSDJPLAY)');
assert(fs.existsSync(romPath), 'LSDJ_ROM=' + romPath + ' does not exist');
const rom = romPath;
const wp = cp.spawnSync(writes, ['--selftest'], { encoding: 'utf8', timeout: TIMEOUT });
if (wp.error) { if (writesExplicit) assert.fail('LSDJ_WRITES=' + writes + ' not runnable: ' + wp.error.message); skip('build tools/lsdjwrites.c'); }
assert.strictEqual(wp.status, 0, wp.stderr || wp.stdout);
const pp = cp.spawnSync(play, [], { encoding: 'utf8', timeout: TIMEOUT });
if (pp.error) { if (playExplicit) assert.fail('LSDJPLAY=' + play + ' not runnable: ' + pp.error.message); skip('build tools/lsdjplay.c'); }

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chiptunes-envelope-writes-'));
function save(name, bytes) { const f = path.join(dir, name); fs.writeFileSync(f, bytes, { flag: 'wx' }); return f; }
function sha(f) { return crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'); }

// A v7 base sav with one long, un-KILLed pulse-1 note so a single trigger is
// followed by a long held window. The cleaned song is placed in working memory.
function base7(bpm, step) {
  step = step || 0;                                 // onset phase (note step position)
  // 16 bars so the arrangement does not loop (and re-trigger) inside the default
  // 360-frame window; larger --frames may still loop and is handled by analyze().
  const built = api.toLsdjSav([api.fromJSON({ bpm, bars: 16, notes: [
    { lane: 'Melody', step, note: 'C4', len: 48, stamp: 'trumpet', velocity: 8 / 15 }
  ] })]);
  const sav = Buffer.from(built.bytes);
  const m = L.readSong(sav), slot = L.playedNotes(m, 0)[0].instrument;
  m.instrumentParams[slot][3] = 0;
  m.phraseCommands.forEach(p => p.fill(0));       // drop KILL so the note holds
  m.phraseCommandVals.forEach(p => p.fill(0));
  sav.set(L.writeSong(m), 0);                      // working memory = cleaned v7
  return { sav, slot };
}
// Upgrade the base sav; return the pristine modern working-memory song image.
function upgrade(sav, tag) {
  const inFile = save('base-' + tag + '.sav', sav);
  const outSong = path.join(dir, 'upgraded-' + tag + '.song');   // must not pre-exist
  const before = sha(inFile);
  const r = cp.spawnSync(play, [rom, inFile, '400', '1'], {
    encoding: 'utf8', env: { ...process.env, LSDJ_BOOT_SONG: outSong }, timeout: TIMEOUT, maxBuffer: 16 * 1024 * 1024
  });
  assert.strictEqual(r.status, 0, r.stderr || r.stdout);
  assert.strictEqual(sha(inFile), before, 'upgrade must not rewrite its source sav');
  const raw = fs.readFileSync(outSong), m = L.readSong(raw);
  assert.strictEqual(m.formatVersion, 22, 'expected format 22 after upgrade, got ' + m.formatVersion);
  return raw;
}

// Strict CSV parse with the observer's invariants: contiguous indices,
// nondecreasing times and frames, register in FF10..FF3F.
function parse(stdout) {
  const lines = stdout.split('\n'), start = lines.indexOf('index,frame,time,doubleSpeed,reg,val');
  assert(start !== -1, 'missing CSV header from lsdjwrites');
  const rows = []; let prevTime = -1, prevFrame = -1;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]; if (line === '') continue;
    const f = line.split(','); assert.strictEqual(f.length, 6, 'bad row: ' + line);
    assert(/^\d+$/.test(f[0]) && Number(f[0]) === rows.length, 'indices must be contiguous from 0: ' + line);
    assert(/^\d+$/.test(f[1]) && /^\d+$/.test(f[2]), 'frame/time must be integers: ' + line);
    assert(/^[01]$/.test(f[3]), 'doubleSpeed must be 0 or 1: ' + line);
    assert(/^FF[0-9A-F]{2}$/.test(f[4]), 'reg must be FFxx: ' + line);
    assert(/^\d+$/.test(f[5]) && Number(f[5]) <= 255, 'val must be a byte: ' + line);
    const frame = Number(f[1]), time = Number(f[2]);
    assert(Number.isSafeInteger(time), 'time exceeds safe integer: ' + line);
    assert(time >= prevTime, 'times must be nondecreasing: ' + line); prevTime = time;
    assert(frame >= prevFrame, 'frames must be nondecreasing: ' + line); prevFrame = frame;
    const reg = parseInt(f[4].slice(2), 16); assert(reg >= 0x10 && reg <= 0x3F, 'reg out of range: ' + line);
    rows.push({ index: Number(f[0]), frame, time, ds: Number(f[3]), reg, val: Number(f[5]) });
  }
  return rows;
}

// Group raw held NR12 writes into logical up/down events: a single 08 write is a
// portable +1 (Pan Docs), the 09/11/18 triple is LSDj's optimized -1. These are
// PATTERN inferences over raw writes, NOT measured hardware volumes; anything
// else is kept as an unclassified raw write with no ADSR meaning asserted.
function groupLogical(held) {
  const events = [];
  for (let i = 0; i < held.length;) {
    const w = held[i];
    if (w.val === 0x08) {
      events.push({ kind: 'up', inferred: 'portable +1 via a single 08 write (logical, not a measured level)',
        atRelCycle: w.relCycle, atRelFrame: w.relFrame, ds: w.ds, rawVals: [w.val], rawIndices: [w.absIndex] });
      i += 1;
    } else if (held[i + 1] && held[i + 2] && w.val === 0x09 && held[i + 1].val === 0x11 && held[i + 2].val === 0x18) {
      events.push({ kind: 'down', inferred: 'LSDj optimized -1 via the 09/11/18 triple (logical, not a measured level)',
        atRelCycle: w.relCycle, atRelFrame: w.relFrame, ds: w.ds,
        rawVals: [0x09, 0x11, 0x18], rawIndices: [held[i].absIndex, held[i + 1].absIndex, held[i + 2].absIndex] });
      i += 3;
    } else {
      events.push({ kind: 'other', inferred: 'unclassified raw NR12 write (no ADSR meaning asserted)',
        atRelCycle: w.relCycle, atRelFrame: w.relFrame, ds: w.ds, rawVals: [w.val], rawIndices: [w.absIndex] });
      i += 1;
    }
  }
  return events;
}

// Per-interval cadence in RAW timestamp ticks plus dimensionless interval ratios
// (unit-independent, so they reveal the nonlinear shape without asserting a tick
// scale or the doubleSpeed relationship, which must come from tools/mGBA/docs).
function cadenceOf(events) {
  const t = events.map(e => e.atRelCycle);
  const intervals = t.slice(1).map((v, i) => v - t[i]);
  const base = intervals.length ? intervals[0] : null;
  return {
    count: events.length,
    kinds: events.map(e => e.kind),
    phaseRelCycle: t.length ? t[0] : null,
    intervalsRaw: intervals,
    intervalRatios: base ? intervals.map(v => +(v / base).toFixed(4)) : intervals.map(() => null),
    unit: 'raw mGBA mTiming timestamp ticks; scale and doubleSpeed relation NOT established here'
  };
}

// Segment by ORDERED WRITE INDEX after the actual NR14 bit-7 trigger, through the
// next trigger (or the real capture end). Same-frame post-trigger held writes are
// retained; the next note's onset setup -- the TRAILING run of NR12 writes equal
// to the onset env byte -- is excluded even when other-channel writes interleave.
// A next trigger does NOT prove the previous envelope completed.
function analyze(rows, captureEndFrame, opts) {
  opts = opts || {};
  const expected = opts.expectedLogicalEvents != null ? opts.expectedLogicalEvents : null;
  const trigIdx = [];
  for (let i = 0; i < rows.length; i++) if (rows[i].reg === CH_TRIG && (rows[i].val & 0x80)) trigIdx.push(i);
  if (!trigIdx.length) return { note: 'no NR14 trigger captured', heldUpdateCount: 0, held: [], bursts: [],
    nextOnsetSetup: [], logicalEvents: [], cadence: null, boundary: 'no-trigger',
    captureEndFrame: captureEndFrame == null ? null : captureEndFrame, lastHeldFrame: null,
    possiblyTruncated: false, completionStatus: 'no-observations', expectedLogicalEvents: expected };
  const t0 = trigIdx[0], t1 = trigIdx.find(i => i > t0);
  const end = t1 == null ? rows.length : t1;
  const trigTime = rows[t0].time, trigFrame = rows[t0].frame;

  // Confirmed onset env byte: the last NR12 written at or before the first trigger.
  let onsetEnvByte = null;
  for (let i = t0; i >= 0; i--) if (rows[i].reg === CH_ENV) { onsetEnvByte = rows[i].val; break; }

  // NR12 writes strictly inside the segment, in order (interleaved other-channel
  // writes are ignored). The TRAILING run whose value equals the onset env byte
  // is the next note's onset setup and is excluded from held updates -- robust to
  // other-channel writes interleaved into that setup block.
  const envWrites = [];
  for (let i = t0 + 1; i < end; i++) if (rows[i].reg === CH_ENV) envWrites.push({
    absIndex: i, frame: rows[i].frame, relFrame: rows[i].frame - trigFrame,
    time: rows[i].time, relCycle: rows[i].time - trigTime, ds: rows[i].ds, val: rows[i].val });
  let cut = envWrites.length;
  if (t1 != null && onsetEnvByte != null) while (cut > 0 && envWrites[cut - 1].val === onsetEnvByte) cut--;
  const held = envWrites.slice(0, cut);
  const nextOnsetSetup = envWrites.slice(cut);
  for (let i = 0; i < held.length; i++) held[i].dCycle = i ? held[i].time - held[i - 1].time : null;

  const bursts = [];
  for (let k = 0; k < held.length;) {
    let j = k; while (j + 1 < held.length && held[j + 1].frame === held[k].frame) j++;
    if (j > k) bursts.push({ relFrame: held[k].relFrame, vals: held.slice(k, j + 1).map(h => h.val),
      relCycles: held.slice(k, j + 1).map(h => h.relCycle) });
    k = j + 1;
  }

  const logicalEvents = groupLogical(held);
  const cadence = cadenceOf(logicalEvents);
  const classifiedCount = logicalEvents.filter(e => e.kind !== 'other').length;

  const boundary = t1 != null ? 'next-trigger' : 'capture-end';
  const lastHeldFrame = held.length ? held[held.length - 1].frame : null;
  // Truncation is judged against the REAL capture end, never the last write.
  const possiblyTruncated = boundary === 'capture-end' && held.length > 0 &&
    captureEndFrame != null && (captureEndFrame - lastHeldFrame) <= TRUNC_MARGIN;

  // Completion is asserted only when an explicit expected logical-event count is
  // reached; a next trigger is a possible interruption, never proof of completion.
  let completionStatus;
  if (!held.length) completionStatus = 'no-observations';
  else if (expected != null && classifiedCount === expected) completionStatus = 'reached-expected';
  else if (boundary === 'next-trigger') completionStatus = 'interrupted-next-trigger';
  else if (possiblyTruncated) completionStatus = 'truncated-capture-end';
  else completionStatus = 'ended-unverified';

  return { triggerAbsIndex: t0, triggerFrame: trigFrame, nextTriggerAbsIndex: t1 == null ? null : t1,
    onsetEnvByte, heldUpdateCount: held.length, distinctHeldVals: [...new Set(held.map(h => h.val))],
    held, bursts, nextOnsetSetup, logicalEvents, cadence, boundary, captureEndFrame,
    lastHeldFrame, possiblyTruncated, completionStatus, expectedLogicalEvents: expected };
}

// No-ROM unit self-test for parse() and analyze(): same-frame held writes are
// retained, the next note's onset setup is excluded, a settled quiet tail is not
// truncated while updates near the real capture end are, and malformed CSV is
// rejected. Run with --selftest (flags are validated before this, no ROM needed).
function runSelfTest() {
  let idx, t, rows;
  const mk = (frame, reg, val) => ({ index: idx++, frame, time: (t += 100), ds: 0, reg, val });
  const reset = () => { idx = 0; t = 1000; rows = []; };

  // (a) same-frame held writes retained; (b) next-onset setup excluded.
  reset();
  rows.push(mk(10, 0x12, 0x88), mk(10, 0x14, 0x86), mk(10, 0x12, 0x08), mk(10, 0x12, 0x08),
    mk(11, 0x12, 0x08), mk(12, 0x12, 0x08),
    mk(300, 0x11, 0x80), mk(300, 0x12, 0x88), mk(300, 0x13, 0x00), mk(300, 0x14, 0x86));
  let a = analyze(rows, 383);
  assert.strictEqual(a.heldUpdateCount, 4, 'selftest: same-frame held writes retained after trigger');
  assert.deepStrictEqual(a.held.map(h => h.val), [8, 8, 8, 8], 'selftest: held values are the increments');
  assert.strictEqual(a.nextOnsetSetup.length, 1, 'selftest: next-onset NR12 setup excluded from held');
  assert.strictEqual(a.boundary, 'next-trigger', 'selftest: bounded by the next trigger');
  assert.strictEqual(a.possiblyTruncated, false, 'selftest: next-trigger boundary is not truncated');
  assert.strictEqual(a.bursts.length, 1, 'selftest: one same-frame burst on the trigger frame');
  assert.deepStrictEqual(a.bursts[0].vals, [8, 8], 'selftest: burst holds the two same-frame writes');

  // (c) settled sequence with a long quiet tail is NOT truncated.
  reset();
  rows.push(mk(10, 0x12, 0x88), mk(10, 0x14, 0x86), mk(10, 0x12, 0x08), mk(11, 0x12, 0x08), mk(12, 0x12, 0x08));
  a = analyze(rows, 383);
  assert.strictEqual(a.heldUpdateCount, 3, 'selftest: held updates counted with no next trigger');
  assert.strictEqual(a.boundary, 'capture-end', 'selftest: capture-end boundary without a next trigger');
  assert.strictEqual(a.captureEndFrame, 383, 'selftest: capture end recorded');
  assert.strictEqual(a.possiblyTruncated, false, 'selftest: a quiet tail before capture end is not truncated');

  // (d) still updating near the real capture end IS truncated.
  reset();
  rows.push(mk(10, 0x12, 0x88), mk(10, 0x14, 0x86), mk(10, 0x12, 0x08), mk(20, 0x12, 0x08), mk(30, 0x12, 0x08));
  a = analyze(rows, 31);
  assert.strictEqual(a.captureEndFrame, 31, 'selftest: capture end marked from caller');
  assert.strictEqual(a.boundary, 'capture-end', 'selftest: capture-end boundary');
  assert.strictEqual(a.possiblyTruncated, true, 'selftest: updates within margin of capture end are truncated');

  // (e) malformed CSV is rejected; a good row parses.
  assert.strictEqual(parse('index,frame,time,doubleSpeed,reg,val\n0,10,1000,0,FF12,136\n').length, 1, 'selftest: good CSV parses');
  assert.throws(() => parse('nope\n0,10,1000,0,FF12,136\n'), /header/, 'selftest: missing header rejected');
  assert.throws(() => parse('index,frame,time,doubleSpeed,reg,val\n1,10,1000,0,FF12,1\n'), /contiguous/, 'selftest: non-contiguous index rejected');
  assert.throws(() => parse('index,frame,time,doubleSpeed,reg,val\n0,10,1000,0,GG12,1\n'), /reg/, 'selftest: bad register rejected');
  assert.throws(() => parse('index,frame,time,doubleSpeed,reg,val\n0,10,1000,0,FF12,1\n1,10,999,0,FF12,1\n'), /nondecreasing/, 'selftest: nondecreasing time enforced');

  // (f) next-onset setup with interleaved OTHER-channel writes is still excluded.
  reset();
  rows.push(mk(10, 0x12, 0x88), mk(10, 0x14, 0x86), mk(10, 0x12, 0x08), mk(11, 0x12, 0x08),
    mk(300, 0x11, 0x80), mk(300, 0x12, 0x88), mk(300, 0x21, 0xF0), mk(300, 0x25, 0x11), mk(300, 0x14, 0x86));
  a = analyze(rows, 383, { expectedLogicalEvents: 2 });
  assert.strictEqual(a.heldUpdateCount, 2, 'selftest: interleaved other-channel writes do not swallow held updates');
  assert.strictEqual(a.nextOnsetSetup.length, 1, 'selftest: next-onset NR12 excluded despite interleaving');
  assert.deepStrictEqual(a.held.map(h => h.val), [8, 8], 'selftest: only the two 08 increments are held');

  // (g) a next trigger is an interruption, never proof of completion.
  reset();
  rows.push(mk(10, 0x12, 0x88), mk(10, 0x14, 0x86), mk(10, 0x12, 0x08), mk(11, 0x12, 0x08),
    mk(50, 0x12, 0x88), mk(50, 0x14, 0x86));
  a = analyze(rows, 383, { expectedLogicalEvents: 7 });
  assert.strictEqual(a.boundary, 'next-trigger', 'selftest: bounded by a next trigger');
  assert.strictEqual(a.completionStatus, 'interrupted-next-trigger', 'selftest: next trigger with fewer than expected events is interrupted, not completed');
  a = analyze(rows, 383, { expectedLogicalEvents: 2 });
  assert.strictEqual(a.completionStatus, 'reached-expected', 'selftest: reaching the explicit expected count is completion');

  // (h) logical grouping: 08 => up, 09/11/18 => down, anything else => other.
  reset();
  rows.push(mk(10, 0x12, 0x81), mk(10, 0x14, 0x86),
    mk(11, 0x12, 0x09), mk(11, 0x12, 0x11), mk(11, 0x12, 0x18), mk(20, 0x12, 0x08), mk(30, 0x12, 0x77));
  a = analyze(rows, 383);
  assert.deepStrictEqual(a.logicalEvents.map(e => e.kind), ['down', 'up', 'other'], 'selftest: triple, single 08, and an odd byte classify correctly');
  assert.deepStrictEqual(a.logicalEvents[0].rawVals, [9, 17, 24], 'selftest: down event keeps its raw 09/11/18 triple');
  assert.strictEqual(a.cadence.count, 3, 'selftest: cadence counts logical events');

  console.log('PASS analyze/parse selftest: same-frame held retained, next-onset excluded (incl. interleaved), interrupt-not-completion, logical up/down grouping, truncation, bad-CSV counters');
}

function runCase(savFile, model, opts) {
  const before = sha(savFile);
  const r = cp.spawnSync(writes, [rom, savFile, '400', String(frames)], {
    encoding: 'utf8', env: { ...process.env, LSDJ_MODEL: model }, timeout: TIMEOUT, maxBuffer: 32 * 1024 * 1024
  });
  assert.strictEqual(r.status, 0, r.stderr || r.stdout);
  assert.strictEqual(sha(savFile), before, 'probe must not rewrite its source sav');
  const mm = /MODEL=(\S+)/.exec(r.stderr); assert(mm && mm[1] === model, 'stderr model mismatch');
  const rows = parse(r.stdout);
  return { rows, analysis: analyze(rows, CAPTURE_LEAD + frames - 1, opts || {}) };
}

// Additive stage-parameter probe. Sweeps initial level, stage-1 rate, stage-2
// level/rate, stage-3 level/rate and onset phase (note step) across the models
// and tempos, with a hard-capped planned count. Later stages are RAW-BYTE
// experiments (no ADSR formula). It writes its own JSON and exits.
function runStagesMatrix() {
  const bnd = (v, def, label) => uniqInts(rangeOf(v, def), 0, 15, label);
  const initials = bnd(args.initials, [8], 'initials');
  const stage1rates = bnd(args.stage1rates, [1, 15], 'stage1rates');
  const stage2levels = bnd(args.stage2levels, [0, 15], 'stage2levels');
  const stage2rates = bnd(args.stage2rates, [0, 4], 'stage2rates');
  const stage3levels = bnd(args.stage3levels, [0], 'stage3levels');
  const stage3rates = bnd(args.stage3rates, [0], 'stage3rates');
  const steps = uniqInts(listOf(args.steps, [0, 6], Number), 0, 63, 'steps');
  const hardCap = 256, cap = args.max != null ? Number(args.max) : 64;
  assert(Number.isInteger(cap) && cap > 0 && cap <= hardCap, '--max must be 1..' + hardCap);
  const planned = initials.length * stage1rates.length * stage2levels.length * stage2rates.length *
    stage3levels.length * stage3rates.length * steps.length * tempos.length * models.length;
  console.error('stages-matrix planned cases: ' + planned + ' (cap ' + cap + ')');
  assert(planned <= cap, 'planned ' + planned + ' exceeds --max ' + cap + '; narrow the stage lists or raise --max');

  const bases = {};
  for (const bpm of tempos) for (const step of steps) {
    const b = base7(bpm, step);
    bases[bpm + '/' + step] = { raw: upgrade(b.sav, 't' + bpm + 's' + step), slot: b.slot, sav: b.sav };
  }

  const cases = []; let done = 0;
  for (const step of steps) for (const bpm of tempos)
  for (const initial of initials) for (const rate1 of stage1rates)
  for (const level2 of stage2levels) for (const rate2 of stage2rates)
  for (const level3 of stage3levels) for (const rate3 of stage3rates) {
    const b = bases[bpm + '/' + step], m = L.readSong(b.raw), slot = b.slot;
    m.instrumentParams[slot][1] = (initial << 4) | rate1;
    m.instrumentParams[slot][9] = (level2 << 4) | rate2;
    m.instrumentParams[slot][10] = (level3 << 4) | rate3;
    const edited = L.writeSong(m), rt = L.readSong(edited);
    assert.strictEqual(rt.formatVersion, 22, 'edited song must stay format 22');
    const slotBytesAfter = Array.from(rt.instrumentParams[slot]);
    assert.strictEqual(slotBytesAfter[1], (initial << 4) | rate1, 'byte 1 round-trip');
    assert.strictEqual(slotBytesAfter[9], (level2 << 4) | rate2, 'byte 9 round-trip');
    assert.strictEqual(slotBytesAfter[10], (level3 << 4) | rate3, 'byte A round-trip');
    const savBytes = Buffer.from(b.sav); savBytes.set(edited, 0);
    const savFile = save('st-i' + initial + 'r' + rate1 + '-s2l' + level2 + 'r' + rate2 +
      '-s3l' + level3 + 'r' + rate3 + '-b' + bpm + '-p' + step + '.sav', savBytes);
    // Expected logical events only for a clean single-stage rise/fall (stage-2
    // rate 0 and no stage-3); multi-stage/raw-byte experiments assert nothing.
    const singleStage = rate2 === 0 && level3 === 0 && rate3 === 0;
    const expectedLogicalEvents = singleStage ? Math.abs(level2 - initial) : null;
    for (const model of models) {
      const { rows, analysis } = runCase(savFile, model, { expectedLogicalEvents });
      cases.push({ probe: 'stages', model, tempo: bpm, step,
        initial, stage1rate: rate1, stage2level: level2, stage2rate: rate2, stage3level: level3, stage3rate: rate3,
        singleStage, rawByteExperiment: !singleStage,
        instrumentBytes: { b1: (initial << 4) | rate1, b9: (level2 << 4) | rate2, bA: (level3 << 4) | rate3 },
        slotBytesAfter, formatVersion: 22, analysis, records: rows });
      done++;
    }
    console.error('  ' + done + '/' + planned);
  }

  // Onset-phase check: identical instrument/model/tempo at different note steps.
  // Two music-grid onsets can share a global scheduler phase. Similar delays
  // therefore do not distinguish trigger-relative from global-tick scheduling.
  // Ratio equality below is exact after rounding, and is sensitive to jitter.
  const key = c => [c.model, c.tempo, c.initial, c.stage1rate, c.stage2level, c.stage2rate, c.stage3level, c.stage3rate].join('|');
  const groups = {};
  for (const c of cases) (groups[key(c)] = groups[key(c)] || []).push(c);
  const phaseComparison = [];
  for (const k of Object.keys(groups)) {
    const g = groups[k].filter(c => c.analysis.cadence && c.analysis.cadence.count > 0);
    if (g.length < 2) continue;
    const bySteps = g.map(c => ({ step: c.step, phaseRelCycle: c.analysis.cadence.phaseRelCycle,
      intervalRatios: c.analysis.cadence.intervalRatios, kinds: c.analysis.cadence.kinds }));
    const ref = bySteps[0];
    const intervalRatiosMatchAcrossSteps = bySteps.every(s => JSON.stringify(s.intervalRatios) === JSON.stringify(ref.intervalRatios));
    const phaseDeltas = bySteps.map(s => (s.phaseRelCycle != null && ref.phaseRelCycle != null) ? s.phaseRelCycle - ref.phaseRelCycle : null);
    phaseComparison.push({ group: k, bySteps, intervalRatiosMatchAcrossSteps, phaseDeltas,
      note: 'Exact rounded-ratio comparison is jitter-sensitive; aligned music-grid onsets do not distinguish trigger-relative from global-tick scheduling' });
  }

  const report = {
    note: 'Stages-matrix RAW-WRITE experiment. Stage-2 rate and stage-3 level/rate bytes are raw-byte ' +
          'experiments, NOT an asserted ADSR formula (no local manual/source meaning is claimed here). ' +
          'No hardware-volume oracle: up/down are pattern inferences (08 = +1, 09/11/18 = -1) over raw ' +
          'writes. Timestamp unit is unestablished mTiming ticks. A next trigger does not prove completion.',
    rom: path.basename(rom), frames, captureEndFrame: CAPTURE_LEAD + frames - 1,
    tempos, models, steps, initials, stage1rates, stage2levels, stage2rates, stage3levels, stage3rates,
    plannedCases: planned, phaseComparison, cases
  };
  const outFile = args.out || path.join(dir, 'envelope-stages.json');
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2), { flag: 'wx' });

  console.log('=== LSDj stages-matrix RAW-WRITE experiment (' + planned + ' cases) ===');
  for (const c of cases) {
    const cad = c.analysis.cadence;
    console.log('  b1=' + c.instrumentBytes.b1.toString(16) + ' b9=' + c.instrumentBytes.b9.toString(16) +
      ' bA=' + c.instrumentBytes.bA.toString(16) + ' ' + c.model + '/' + c.tempo + ' step=' + c.step +
      ' logical=' + (cad ? cad.count : 0) + '[' + (cad ? cad.kinds.join('') : '') + ']' +
      ' phase=' + (cad ? cad.phaseRelCycle : 'n/a') +
      ' ratios=' + (cad ? JSON.stringify(cad.intervalRatios) : '[]') +
      ' ' + c.analysis.completionStatus + (c.rawByteExperiment ? ' RAW-EXPERIMENT' : ''));
  }
  console.log('phase-comparison groups: ' + phaseComparison.length + '; interval-ratios match across steps in ' +
    phaseComparison.filter(p => p.intervalRatiosMatchAcrossSteps).length);
  console.log('Timestamp unit is raw mTiming ticks (scale/doubleSpeed relation NOT established here; derive');
  console.log('from tools/mGBA/local docs). Later-stage bytes are raw experiments; no ADSR formula asserted');
  console.log('and no hardware volume observed.');
  console.log('JSON: ' + outFile + (args.out ? ' (outside tmp; --out override)' : ''));
  console.log('fixtures (immutable, tmp): ' + dir);
}

// Additive mode: probe stages/phase and exit; the default rate/target matrix
// below is unchanged when --stages-matrix is absent.
if (args['stages-matrix']) { runStagesMatrix(); process.exit(0); }

// ---- run the matrix -------------------------------------------------------
const total = tempos.length * rates.length * targets.length * models.length;
console.error('envelope-writes: ' + total + ' cases (' + tempos.length + 'x' + rates.length + 'x' +
  targets.length + 'x' + models.length + '), ' + frames + ' frames each');
const perTempo = {};
for (const bpm of tempos) {
  const b = base7(bpm), raw = upgrade(b.sav, 't' + bpm), m = L.readSong(raw);
  perTempo[bpm] = { raw, slot: b.slot, sav: b.sav, slotBytesBefore: Array.from(m.instrumentParams[b.slot]) };
}

const cases = []; let done = 0;
for (const bpm of tempos) for (const target of targets) for (const rate of rates) {
  const { raw, slot, sav, slotBytesBefore } = perTempo[bpm];
  const m = L.readSong(raw);                        // fresh model from pristine image
  m.instrumentParams[slot][1] = 0x80 | rate;        // initial volume 8 + first-stage rate
  m.instrumentParams[slot][9] = target === 15 ? 0xF0 : 0x00;   // stage-2 amplitude/target
  m.instrumentParams[slot][10] = 0;                 // no third stage
  const edited = L.writeSong(m);
  const roundtrip = L.readSong(edited);
  assert.strictEqual(roundtrip.formatVersion, 22, 'edited song must stay format 22');
  const slotBytesAfter = Array.from(roundtrip.instrumentParams[slot]);
  assert.strictEqual(slotBytesAfter[1], 0x80 | rate, 'byte 1 did not round-trip');
  assert.strictEqual(slotBytesAfter[9], target === 15 ? 0xF0 : 0x00, 'byte 9 did not round-trip');
  assert.strictEqual(slotBytesAfter[10], 0, 'byte A did not round-trip');
  const savBytes = Buffer.from(sav); savBytes.set(edited, 0);   // play from working memory
  const savFile = save('r' + rate + '-t' + target + '-' + bpm + '.sav', savBytes);
  for (const model of models) {
    const { rows, analysis } = runCase(savFile, model, { expectedLogicalEvents: Math.abs(target - 8) });
    cases.push({ model, tempo: bpm, rate, target,
      instrumentByte1: 0x80 | rate, instrumentByte9: target === 15 ? 0xF0 : 0x00,
      formatVersion: 22, slotBytesBefore, slotBytesAfter,
      importerHoldFrames: ENVELOPE_HOLD[rate], analysis, records: rows });
    done++;
  }
  console.error('  ' + done + '/' + total);
}

// ---- cross-tempo comparison (matching sequences only; hedged) --------------
function compare(model, rate, target) {
  if (tempos.length < 2) return { model, rate, target, verdict: 'single-tempo-no-comparison' };
  const per = tempos.map(bpm => cases.find(c => c.model === model && c.rate === rate && c.target === target && c.tempo === bpm));
  if (per.some(c => !c)) return null;
  const seqs = per.map(c => c.analysis.held.map(h => h.val));
  const relCycles = per.map(c => c.analysis.held.map(h => h.relCycle));
  const phase = per.map(c => (c.analysis.held.length ? c.analysis.held[0].relCycle : null));
  if (seqs.some(s => s.length === 0)) return { model, rate, target, verdict: 'inconclusive-no-observations', heldValsByTempo: seqs };
  if (per.some(c => c.analysis.possiblyTruncated)) return { model, rate, target, verdict: 'inconclusive-truncated', heldValsByTempo: seqs };
  if (per.some(c => c.analysis.completionStatus === 'interrupted-next-trigger')) return { model, rate, target, verdict: 'inconclusive-interrupted', heldValsByTempo: seqs };
  const sameLen = seqs.every(s => s.length === seqs[0].length);
  const sameVals = sameLen && seqs.every(s => s.every((v, i) => v === seqs[0][i]));
  if (!sameVals) return { model, rate, target, verdict: 'update-sequences-differ', heldValsByTempo: seqs };
  const ref = relCycles[0];
  const consistent = relCycles.every(rc => rc.every((v, i) => Math.abs(v - ref[i]) <= Math.max(2000, Math.abs(ref[i]) * 0.02)));
  return { model, rate, target, verdict: consistent ? 'cycle-consistent-across-tempo' : 'cycle-differs-across-tempo',
    heldValsByTempo: seqs, relCyclesByTempo: relCycles, phaseByTempo: phase };
}
const comparisons = [];
for (const model of models) for (const target of targets) for (const rate of rates) { const c = compare(model, rate, target); if (c) comparisons.push(c); }
const verdicts = {};
for (const c of comparisons) verdicts[c.verdict] = (verdicts[c.verdict] || 0) + 1;

// Observed register-write cadence per rate, reported ALONGSIDE (not against) the
// importer's current hold table. Write presence alone does not establish audible
// note length, so this is context, not a refutation.
const importerContext = rates.map(rate => ({
  rate,
  importerHoldFramesReference: ENVELOPE_HOLD[rate],
  observed: cases.filter(c => c.rate === rate).map(c => ({
    model: c.model, tempo: c.tempo, target: c.target,
    heldUpdateCount: c.analysis.heldUpdateCount,
    heldRelFrames: c.analysis.held.map(h => h.relFrame),
    boundary: c.analysis.boundary, possiblyTruncated: c.analysis.possiblyTruncated
  }))
}));

const report = {
  note: 'Ordered NR12 write evidence only; no hardware-volume claim, no rate formula, not parity. ' +
        'Captured NRx2 quirk writes are evidence, not directly replayable env.ops for our APU. ' +
        'Write presence does not establish audible note length; the importer hold table is context only.',
  rom: path.basename(rom), frames, captureEndFrame: CAPTURE_LEAD + frames - 1,
  tempos, rates, targets, models,
  verdictTally: verdicts, importerContext, comparisons, cases
};
const outFile = args.out || path.join(dir, 'envelope-writes.json');
fs.writeFileSync(outFile, JSON.stringify(report, null, 2), { flag: 'wx' });   // never overwrite

// ---- concise, hedged summary ----------------------------------------------
const short = a => (a.length <= 8 ? a.join(',') : a.slice(0, 8).join(',') + ',…(' + a.length + ')');
console.log('=== LSDj modern-envelope NR12 write analysis (evidence only) ===');
for (const model of models) for (const target of targets) {
  console.log('-- ' + model + ' target=' + target + ' --');
  for (const rate of rates) {
    const c0 = cases.find(c => c.model === model && c.target === target && c.rate === rate && c.tempo === tempos[0]);
    const cmp = comparisons.find(c => c.model === model && c.rate === rate && c.target === target);
    if (!c0) continue;
    const a = c0.analysis;
    console.log('  rate ' + String(rate).padStart(2) +
      ' held=' + String(a.heldUpdateCount).padStart(3) +
      ' vals=[' + short((a.distinctHeldVals || []).map(v => v.toString(16))) + ']' +
      ' bursts=' + a.bursts.length +
      (a.possiblyTruncated ? ' TRUNC?' : '') +
      ' bound=' + a.boundary +
      ' tempo=' + (cmp ? cmp.verdict : 'n/a') +
      ' importerHold(ctx)=' + ENVELOPE_HOLD[rate] + 'f');
  }
}
console.log('verdict tally: ' + JSON.stringify(verdicts));
console.log('Interpretation is limited to matching, untruncated update sequences bounded by a next');
console.log('trigger or judged against the real capture end; empty or truncated captures are');
console.log('inconclusive and last-write timing is not a note-alive proof. Where update sequences match');
console.log('with consistent relative-cycle offsets across tempo, the write cadence does not scale with');
console.log('song tempo under these fixtures. The importer ENVELOPE_HOLD table is reported as separate');
console.log('context only; write presence does not by itself establish audible note length.');
console.log('Measured relative cycles between NR12 writes characterize the format-22 first-stage RATE as');
console.log('register-write TIMING only (when writes occur relative to the trigger), which can inform a');
console.log('version-22 rate model with NO hardware-volume claim, since amplitude is never observed.');
console.log('JSON: ' + outFile + (args.out ? ' (outside tmp; --out override)' : ''));
console.log('fixtures (immutable, tmp): ' + dir);
