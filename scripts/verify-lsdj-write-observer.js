'use strict';
// Independent evidence for the cycle-ordered write probe. The recorder/hook
// self-test runs without the ROM; the owner-ROM cases confirm the observer sees
// same-frame software-envelope NR12 bursts that frame-end snapshots miss. This
// records write order/timing only; it is not a claim of envelope playback parity.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');
const api = require('../src/api');
const L = require('../src/lsdj');

const writesExplicit = process.env.LSDJ_WRITES != null;
const writes = process.env.LSDJ_WRITES || '/tmp/lsdjwrites';
const romPath = process.env.LSDJ_ROM;
const TIMEOUT = 120000;   // per spawned child, ms

// Recorder + synthetic-hook self-test: needs the built binary, not the ROM.
const self = cp.spawnSync(writes, ['--selftest'], { encoding: 'utf8', timeout: TIMEOUT });
if (self.error) {
  // An explicitly supplied binary that is missing/unexecutable is a failure;
  // only the absent default may skip.
  if (writesExplicit) assert.fail('LSDJ_WRITES=' + writes + ' is not runnable: ' + self.error.message);
  console.log('SKIP write observer: build tools/lsdjwrites.c as ' + writes + ' (set LSDJ_WRITES)');
  process.exit(0);
}
assert.strictEqual(self.status, 0, self.stderr || self.stdout);

// An explicitly supplied ROM that is missing is a failure; an unset ROM skips.
if (romPath == null) {
  console.log('SKIP write observer owner-ROM cases: set LSDJ_ROM');
  process.exit(0);
}
assert(fs.existsSync(romPath), 'LSDJ_ROM=' + romPath + ' does not exist');
const rom = romPath;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chiptunes-write-observer-'));
// Legacy 81 at volume 8: measured to emit the 09/11/18 decrement, i.e. several
// NR12 writes within a single frame after the ROM upgrades the instrument.
function fixture(shape = 1, bpm = 128, volume = 8) {
  const bytes = Buffer.from(api.toLsdjSav([api.fromJSON({ bpm, bars: 4, notes: [
    { lane: 'Melody', step: 6, note: 'C4', len: 4, stamp: 'trumpet', velocity: volume / 15 }
  ] })]).bytes);
  const m = L.readSong(bytes), slot = L.playedNotes(m, 0)[0].instrument;
  m.instrumentParams[slot][1] = (volume << 4) | shape;
  m.instrumentParams[slot][3] = 0;
  m.phraseCommands.forEach(p => p.fill(0));
  m.phraseCommandVals.forEach(p => p.fill(0));
  bytes.set(L.writeSong(m));
  return bytes;
}
function save(name, bytes) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, bytes, { flag: 'wx' });
  return file;
}
function hash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function run(file, frames, env = {}) {
  const before = hash(file);
  const r = cp.spawnSync(writes, [rom, file, '400', String(frames)], {
    encoding: 'utf8', env: { ...process.env, ...env }, maxBuffer: 16 * 1024 * 1024, timeout: TIMEOUT
  });
  assert.strictEqual(r.status, 0, r.stderr || r.stdout);
  assert.strictEqual(hash(file), before, 'probe must not rewrite its source SAV; rebuild the tool');
  return r;
}

const file = save('rate1-vol8.sav', fixture());
const HEADER = 'index,frame,time,doubleSpeed,reg,val';
// Exact CSV shape, one row at a time, so a malformed field fails here rather
// than being coerced away by a loose regex.
function parse(stdout) {
  const lines = stdout.split('\n');
  const start = lines.indexOf(HEADER);
  assert(start !== -1, 'exact CSV header "' + HEADER + '" missing');
  const rows = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === '') continue;
    const f = line.split(',');
    assert.strictEqual(f.length, 6, 'row must have six fields: ' + line);
    assert(/^\d+$/.test(f[0]), 'index integer: ' + line);
    assert(/^\d+$/.test(f[1]), 'frame integer: ' + line);
    assert(/^\d+$/.test(f[2]), 'time integer: ' + line);
    assert(/^[01]$/.test(f[3]), 'doubleSpeed is 0 or 1: ' + line);
    assert(/^FF[0-9A-F]{2}$/.test(f[4]), 'reg is upper-hex FFxx: ' + line);
    const reg = parseInt(f[4].slice(2), 16);
    assert(reg >= 0x10 && reg <= 0x3F, 'reg within FF10..FF3F: ' + line);
    assert(/^\d+$/.test(f[5]) && Number(f[5]) <= 255, 'val is a byte: ' + line);
    rows.push({ index: Number(f[0]), frame: Number(f[1]), time: BigInt(f[2]),
                ds: Number(f[3]), reg, val: Number(f[5]) });
  }
  return rows;
}
// Timing diagnostics parser: stderr carries key=value TIMING lines; stdout CSV is
// parsed separately by parse() above and is unaffected.
function parseTiming(stderr) {
  const t = {};
  for (const line of stderr.split('\n')) {
    if (!line.startsWith('TIMING ')) continue;
    for (const kv of line.slice(7).trim().split(/\s+/)) {
      const eq = kv.indexOf('=');
      if (eq !== -1) t[kv.slice(0, eq)] = kv.slice(eq + 1);
    }
  }
  return t;
}
// The measured legacy-81 manual update is a model-independent write sequence:
// the ROM emits the same NR12 09/11/18 triple whether or not the model's decay
// interprets it the same way, so require it under BOTH models.
function check(model) {
  const res = run(file, 240, { LSDJ_MODEL: model });
  const mm = /MODEL=(\S+)/.exec(res.stderr);
  assert(mm, 'tool must report the actual model on stderr');
  assert.strictEqual(mm[1], model, 'actual model must match the requested model');
  const actual = mm[1];
  const rows = parse(res.stdout);
  assert(rows.length > 0, 'no writes captured for ' + model);
  // Contiguous indices from zero; ordered timestamps; nondecreasing frames.
  rows.forEach((r, i) => assert.strictEqual(r.index, i, 'write indices must be contiguous'));
  for (let i = 1; i < rows.length; i++) {
    assert(rows[i].time >= rows[i - 1].time, 'timestamps must be ordered');
    assert(rows[i].frame >= rows[i - 1].frame, 'frames must be nondecreasing');
  }
  // ds must correspond to the actual model: DMG has no double-speed mode.
  if (actual === 'DMG') rows.forEach(r => assert.strictEqual(r.ds, 0, 'DMG is never double-speed'));
  else rows.forEach(r => assert(r.ds === 0 || r.ds === 1, 'doubleSpeed is a flag'));
  // Capture began at the onset: a NR14 ($FF14) trigger (bit 7) is present.
  const firstTrigger = rows.findIndex(r => r.reg === 0x14 && (r.val & 0x80));
  assert(firstTrigger !== -1, 'note-onset trigger was not captured for ' + model);
  // A contiguous NR12 subsequence 09,11,18 within a single frame.
  const nr12 = rows.map((r, i) => ({ r, i })).filter(x => x.r.reg === 0x12);
  let hit = -1;
  for (let k = 0; k + 2 < nr12.length; k++) {
    const a = nr12[k].r, b = nr12[k + 1].r, c = nr12[k + 2].r;
    if (a.val === 0x09 && b.val === 0x11 && c.val === 0x18 &&
        a.frame === b.frame && b.frame === c.frame) { hit = k; break; }
  }
  assert(hit !== -1, 'legacy-81 NR12 09/11/18 same-frame burst not observed on ' + model);
  const lo = nr12[hit].i, hi = nr12[hit + 2].i;
  assert(lo > firstTrigger, 'the manual-update burst must follow the onset trigger');
  assert(nr12[hit].r.time <= nr12[hit + 1].r.time && nr12[hit + 1].r.time <= nr12[hit + 2].r.time,
    'burst timestamps must be ordered');
  // No retrigger (NR14 bit 7) interleaved across the burst: this is a manual
  // volume update, not a re-onset.
  for (let i = lo; i <= hi; i++)
    assert(!(rows[i].reg === 0x14 && (rows[i].val & 0x80)), 'no retrigger within the manual-update burst');

  // Timing calibration diagnostics live on stderr; the stdout CSV above is
  // unchanged. Verify they are well-formed and model-consistent, then return the
  // measured ticks-per-frame for the empirical cross-model comparison below.
  const t = parseTiming(res.stderr);
  assert.strictEqual(t.model, actual, 'timing diagnostics must report the actual model');
  const field = (k) => { assert(/^\d+$/.test(t[k]), 'timing ' + k + ' must be an integer: ' + t[k]); return Number(t[k]); };
  const freq = field('freq'), frameCycles = field('frameCycles');
  assert(freq > 0 && frameCycles > 0, 'freq and frameCycles must be positive');
  const leadFrames = field('leadFrames'), playFramesReported = field('playFrames');
  const captureFrames = field('captureFrames'), windowFrames = field('windowFrames');
  assert.strictEqual(playFramesReported, 240, 'reported playFrames must match the request');
  assert.strictEqual(windowFrames, 240, 'stable window must span the play phase');
  assert(windowFrames >= 60, 'stable window must be at least 60 frames');
  assert.strictEqual(captureFrames, leadFrames + playFramesReported, 'captureFrames must equal lead + play');
  // The measured lead is what the analyzer should consume instead of hardcoding 24.
  assert(leadFrames > 0, 'measured lead must be positive');
  assert.strictEqual(leadFrames, 24, 'current press/release schedule leads by 24 frames');
  // Raw ticks must be nondecreasing across the capture and telescope exactly.
  const startTick = BigInt(t.captureStartTick), playTick = BigInt(t.playStartTick), endTick = BigInt(t.captureEndTick);
  assert(playTick >= startTick && endTick >= playTick, 'raw ticks must be nondecreasing across the capture');
  assert.strictEqual(BigInt(t.captureTickDelta), endTick - startTick, 'captureTickDelta must be end-start');
  assert.strictEqual(BigInt(t.windowTickDelta), endTick - playTick, 'windowTickDelta must span the play phase');
  // Empirical ticks per video frame: min <= ratio <= max, all positive.
  const tpfMin = BigInt(t.ticksPerFrameMin), tpfMax = BigInt(t.ticksPerFrameMax);
  assert(tpfMin > 0n && tpfMax >= tpfMin, 'ticks-per-frame bounds must be positive and ordered');
  const parts = t.ticksPerFrameRatio.split('/');
  assert.strictEqual(parts.length, 2, 'ticksPerFrameRatio must be a rational num/den: ' + t.ticksPerFrameRatio);
  const rn = BigInt(parts[0]), rd = BigInt(parts[1]);
  assert(rn > 0n && rd > 0n, 'ticks-per-frame ratio must be a positive rational');
  const tpf = Number(rn) / Number(rd);
  assert(tpf >= Number(tpfMin) - 1 && tpf <= Number(tpfMax) + 1, 'ratio must lie within the observed min/max');
  // ds must be model-consistent: DMG never enters double-speed.
  const dsFirst = field('dsFirst'), dsLast = field('dsLast'), dsChanges = field('dsChanges');
  assert(dsFirst === 0 || dsFirst === 1, 'dsFirst must be a flag');
  assert(dsLast === 0 || dsLast === 1, 'dsLast must be a flag');
  const firstDsChangeFrame = Number(t.firstDsChangeFrame);
  assert(Number.isInteger(firstDsChangeFrame) && firstDsChangeFrame >= -1 && firstDsChangeFrame < captureFrames,
    'firstDsChangeFrame must be -1 or a valid frame index');
  if (actual === 'DMG') {
    assert(dsFirst === 0 && dsLast === 0 && dsChanges === 0, 'DMG must never enter double-speed');
    assert.strictEqual(firstDsChangeFrame, -1, 'DMG must report no ds transition');
  }
  return { actual, freq, frameCycles, tpf, dsWindow: dsLast, impliedFps: freq / frameCycles };
}
const dmg = check('DMG');
const cgb = check('CGB');

// Cross-model calibration: compare the two models EMPIRICALLY instead of
// hardcoding a physical tick unit from the double-speed flag. Physically the raw
// mTiming ticks per video frame can differ only by a small GB clock rational, so
// we assert the ratio is ~1 or ~2 and REPORT which -- together with the observed
// ds -- so the unit is labeled from BOTH models, never claimed cycle-exact from a
// single flag. Whether the flag changes the tick UNIT is exactly what one flag
// cannot prove, so no coupling between ds and the ratio is asserted here.
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const ratio = cgb.tpf / dmg.tpf;
assert(isFinite(ratio) && ratio > 0, 'cross-model ticks-per-frame ratio must be finite and positive');
const isOne = near(ratio, 1, 0.02), isTwo = near(ratio, 2, 0.05);
assert(isOne || isTwo, 'cross-model ticks/frame ratio must be a GB clock rational (~1 or ~2): ' + ratio);
const unit = isTwo ? '2x between models (CPU-clock-like)' : '1x between models (video-clock-like)';
console.log('TIMING cross-model: DMG tpf=' + dmg.tpf + ' ds=' + dmg.dsWindow +
  ', CGB tpf=' + cgb.tpf + ' ds=' + cgb.dsWindow + ', ratio=' + ratio.toFixed(4) +
  ' -> raw mTiming ticks scale ' + unit + ', inferred from BOTH models not the ds flag');

// Negative and malformed frame arguments must exit 2 (parsed before the ROM).
for (const arg of ['-5', '12x', '', '1e3', '99999999999999999999']) {
  const b = cp.spawnSync(writes, [rom, file, arg, '1'], { encoding: 'utf8', timeout: TIMEOUT });
  assert.strictEqual(b.status, 2, 'bad bootFrames "' + arg + '" must exit 2');
  const p = cp.spawnSync(writes, [rom, file, '400', arg], { encoding: 'utf8', timeout: TIMEOUT });
  assert.strictEqual(p.status, 2, 'bad playFrames "' + arg + '" must exit 2');
}

// A missing input must fail without being created.
const missing = path.join(dir, 'missing.sav');
const mres = cp.spawnSync(writes, [rom, missing, '400', '1'], { encoding: 'utf8', timeout: TIMEOUT });
assert.notStrictEqual(mres.status, 0);
assert(!fs.existsSync(missing), 'a missing save must not be created');

// An unknown model must fail explicitly rather than silently picking one.
const bad = cp.spawnSync(writes, [rom, file, '400', '1'], {
  encoding: 'utf8', env: { ...process.env, LSDJ_MODEL: 'TYPO' }, timeout: TIMEOUT
});
assert.strictEqual(bad.status, 2);

console.log('PASS write observer: self-test (recorder/hook-forward-both/timing), DMG+CGB 09/11/18 same-frame ' +
  'burst after onset with no retrigger, strict CSV, contiguous indices, ordered time, nondecreasing frames, ' +
  'model-consistent ds, well-formed timing diagnostics, empirical cross-model tick ratio, ' +
  'immutable/missing/invalid-model/bad-frame-args; ' + dir);
