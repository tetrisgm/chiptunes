#!/usr/bin/env node
// DOES LSDJ PLAY OUR SONG THE WAY WE MEANT IT?
//
// Every other check in this repository is us reading our own bytes. This one
// boots the REAL LSDj ROM in mGBA, presses START, and watches the sound chip.
// The observer samples frame-end register shadows and decoded emulator state.
// It does not see every write or its sub-frame timing, and emulator behavior
// can differ from hardware (notably software envelopes). These bounded checks
// establish the properties asserted below, not full sound parity.
//
// It found the thing nothing else could: an LSDj GROOVE IS IN TICKS, and we
// were writing frame counts into it. A song exported as 128 bpm with a 7-frame
// row played at 8.17 frames a row -- 110 bpm, 17% slow, on every song we ever
// exported. Reading our own file back agreed with us perfectly the whole time,
// because both sides shared the same wrong assumption.
//
// ⚠️ THE ROM IS NOT IN THIS REPOSITORY AND MUST NEVER BE. LSDj is Johan
// Kotlinski's and is freeware for personal and educational use only; its licence
// forbids redistribution. Point this at your own copy:
//
//   LSDJ_ROM=/path/to/lsdj.gb node scripts/verify-lsdj-emulator.js
//
// and build the harness first (needs `brew install mgba`):
//
//   clang -I$(brew --prefix)/include -L$(brew --prefix)/lib -lmgba \
//         -o /tmp/lsdjtrace tools/lsdjtrace.c
//
// Without either, this SKIPS and says so loudly rather than passing quietly. A
// gate that silently does nothing is worse than no gate.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const ROOT = path.join(__dirname, '..');
['gb-hardware', 'gb-apu', 'gb-voices', 'chip-instruments', 'melody', 'style-corpus']
  .forEach(m => require(path.join(ROOT, 'src', m + '.js')));
const api = require(path.join(ROOT, 'src', 'api.js'));
const L = require(path.join(ROOT, 'src', 'lsdj.js'));

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fail++; };

const TRACE = process.env.LSDJ_TRACE || '/tmp/lsdjtrace';
const ROM = process.env.LSDJ_ROM || path.join(os.homedir(), 'Downloads', 'lsdj9_4_2.gb');
if (!fs.existsSync(TRACE) || !fs.existsSync(ROM)) {
  console.log('  SKIP  the emulator check needs both the harness and your own LSDj ROM');
  console.log('        harness: ' + TRACE + (fs.existsSync(TRACE) ? ' (found)' : ' (MISSING -- build tools/lsdjtrace.c)'));
  console.log('        rom:     ' + ROM + (fs.existsSync(ROM) ? ' (found)' : ' (MISSING -- set LSDJ_ROM)'));
  console.log('\nverify-lsdj-emulator: SKIPPED, so nothing here was proved');
  process.exit(0);
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lsdjparity-'));
const NOTE = n => ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][n % 12] + (Math.floor(n / 12) - 1);

// A RULER SONG: one note per row, no two neighbours alike, melody only. LSDj
// then writes a new period on every row, so the gap between writes IS the row
// length -- measured, with no alignment and nothing to fit.
function ruler(bpm, rows) {
  const j = { title: 'Ruler', grid: 16, bpm: bpm, bars: Math.ceil(rows / 16), notes: [] };
  for (let s = 0; s < rows; s++) j.notes.push({ lane: 'Melody', step: s, note: NOTE(60 + (s % 24)), len: 1 });
  return api.fromJSON(j);
}

function rowFramesFromEmulator(savPath, playFrames) {
  const out = cp.execFileSync(TRACE, [ROM, savPath, '400', String(playFrames)],
    { maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  // mGBA logs to stdout as well, so keep only what looks like our CSV
  const lines = out.split('\n').filter(l => /^(frame,|\d+,)/.test(l));
  if (lines.length < 8) return null;
  const head = lines[0].split(','), lo = head.indexOf('NR13'), hi = head.indexOf('NR14');
  const ev = [];
  let last = -1;
  for (const l of lines.slice(1)) {
    const r = l.split(',').map(Number), p = r[lo] | ((r[hi] & 7) << 8);
    if (p !== last) { ev.push(r[0]); last = p; }
  }
  if (ev.length < 8) return null;
  // drop the first, which is a partial row: the trace starts mid-row
  const gaps = ev.slice(2).map((f, i) => f - ev[i + 1]).filter(x => x > 0);
  if (!gaps.length) return null;
  return { mean: gaps.reduce((a, b) => a + b, 0) / gaps.length, n: gaps.length, ev: ev.length };
}

console.log('         ROM: ' + path.basename(ROM) + '\n');

// A period register can retain a note long after its hardware length counter
// silences it. Measure decoded active AND nonzero volume state, including KILL.
for (const [lane, channel] of [['Melody', 1], ['Harmony', 2]]) {
  const doc = api.fromJSON({ title: 'Sustain', bpm: 128, bars: 2, notes: [
    { lane, step: 6, note: 'C4', len: 8, stamp: 'flute' }
  ] });
  const savPath = path.join(TMP, 'duration-' + channel + '.sav');
  fs.writeFileSync(savPath, Buffer.from(api.toLsdjSav([doc]).bytes));
  const rows = cp.execFileSync(TRACE, [ROM, savPath, '400', '110'], {
    stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8', maxBuffer: 1 << 20
  }).split('\n').filter(l => /^(frame,|\d+,)/.test(l));
  const header = rows.shift().split(',');
  const on = header.indexOf('ON' + channel), vol = header.indexOf('VOL' + channel);
  if (on < 0 || vol < 0) throw new Error('Rebuild tools/lsdjtrace.c: decoded activity and volume columns are required');
  let start = null, end = null;
  for (const line of rows) {
    const r = line.split(',').map(Number), sounding = r[on] && r[vol] > 0;
    if (start == null && sounding) start = r[0];
    else if (start != null && !sounding) { end = r[0]; break; }
  }
  const note = require('../src/create.js').songOf(doc).gb.notes.find(n => n.ch === channel - 1);
  ok(start != null && end != null && Math.abs(end - start - note.frames) <= 1,
    lane + ' sustains until KILL (' + (end == null || start == null ? 'no complete sounding span' : end - start) +
    ' frames; browser ' + note.frames + ')');
}

// Pulse sweep bytes in the file are complemented by LSDj before NR10.
// Verify at the real register: a file round trip cannot catch a shared error.
for (const [motion, expected, custom] of [['plain', 0], ['fall', 0x3E], ['rise', 0x36], ['plain', 0x12, true]]) {
  let doc = api.fromJSON({ title: 'Sweep', bpm: 128, bars: 2, notes: [
    { lane: 'Melody', step: 6, note: 'A5', len: 8, motion }
  ] });
  if (custom) {
    const state = require('../src/create.js').docState(doc);
    state.cells[0].sweep = expected;
    doc = require('../src/create.js').docFromState(state);
  }
  const savPath = path.join(TMP, 'sweep-' + motion + '-' + expected + '.sav');
  fs.writeFileSync(savPath, Buffer.from(api.toLsdjSav([doc]).bytes));
  const rows = cp.execFileSync(TRACE, [ROM, savPath, '400', '80'], {
    stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8', maxBuffer: 1 << 20
  }).split('\n').filter(l => /^(frame,|\d+,)/.test(l));
  const header = rows.shift().split(',');
  const sweep = header.indexOf('NR10'), volume = header.indexOf('NR12');
  const seen = [...new Set(rows.map(l => l.split(',').map(Number))
    .filter(r => r[volume] > 0).map(r => r[sweep] & 0x7F))];
  ok(seen.length > 0 && seen.every(v => v === expected),
    motion + ' reaches NR10 as ' + expected + ' (observed ' + seen.join(',') + ')');
}

// LSDj's own timing, measured rather than assumed:
//   ticks per second = 0.4 x TEMPO,  frames per tick = 149.31875 / TEMPO
// so a row of `ticks` lasts ticks * 149.31875 / TEMPO frames, and the default
// groove of 6 makes that 895.9125/TEMPO -- ordinary bpm with four rows a beat.
const FRAMES_PER_TICK_NUM = 149.31875;

let checked = 0;
for (const bpm of [90, 112, 128, 150]) {
  const doc = ruler(bpm, 128);
  const cart = api.toLsdjSav([doc]);
  const savPath = path.join(TMP, 'ruler-' + bpm + '.sav');
  fs.writeFileSync(savPath, Buffer.from(cart.bytes));

  const m = L.readSong(new Uint8Array(cart.bytes.buffer, cart.bytes.byteOffset, L.SONG_BYTES));
  const ticks = Array.from(m.grooves[0]).filter(x => x > 0);
  const avgTicks = ticks.reduce((a, b) => a + b, 0) / ticks.length;
  const predicted = avgTicks * FRAMES_PER_TICK_NUM / m.tempo;

  const got = rowFramesFromEmulator(savPath, 2000);
  if (!got) { ok(false, bpm + ' bpm: the emulator produced no notes to measure'); continue; }
  checked++;

  // 1.5% covers the integer TEMPO byte (LSDj cannot store a fractional tempo
  // either) plus one frame of sampling jitter in the trace.
  const errPct = 100 * Math.abs(got.mean - predicted) / predicted;
  ok(errPct < 1.5,
    bpm + ' bpm: LSDj plays ' + got.mean.toFixed(3) + ' frames a row, we predict ' +
    predicted.toFixed(3) + ' (TEMPO ' + m.tempo + ', groove ' + JSON.stringify(ticks) +
    ', off by ' + errPct.toFixed(2) + '%)');
}

ok(checked > 0, 'the emulator was actually driven (' + checked + ' tempi measured)');

// ---- NOTE_BASE, measured instead of believed --------------------------------
//
// An LSDj note byte is an INDEX into what that channel can play, so it is a
// different pitch on each one, and the base was derived by reading a period
// table out of the ROM. src/lsdj.js has carried a warning ever since saying the
// number could not be proved from a file and had to be heard on the machine.
// This is that proof, and it costs one note.
//
// ⚠️ ONE NOTE IN THE WHOLE SONG, deliberately. A ruler of ascending notes cannot
// do this job: the pattern repeats, the trace starts mid-phrase, and lining the
// two up wrong reports a clean, believable, WRONG octave. It did exactly that
// here -- a repeating ruler said every base was 12 too low, and a single note
// said they were right all along. Anything that can be misaligned will be.
function pitchOfSingleNote(ch, noteByte) {
  const song = L.emptySong(), O = L.OFFSETS;
  song[O.PHRASE_NOTES + 0] = noteByte;
  song[O.PHRASE_INSTRUMENTS + 0] = 0;
  song[O.PHRASE_ALLOC] |= 1;
  for (let i = 0; i < 16; i++) { song[O.CHAIN_PHRASES + i] = i === 0 ? 0 : 0xFF; song[O.CHAIN_TRANSPOSE + i] = 0; }
  song[O.CHAIN_ALLOC] |= 1;
  for (let r = 0; r < 256; r++) for (let c = 0; c < 4; c++) song[O.SEQUENCE + r * 4 + c] = 0xFF;
  song[O.SEQUENCE + ch] = 0;
  song[O.TEMPO] = 128;
  for (let i = 0; i < 16; i++) song[O.GROOVES + i] = i === 0 ? 6 : 0;
  song[O.INSTRUMENT_ALLOC] |= 1;

  const sav = new Uint8Array(L.SAV_SIZE);
  sav.set(song, 0);
  sav[0x8000 + 288 + 30] = 0x6A; sav[0x8000 + 288 + 31] = 0x6B;   // the 'jk' marker
  const p = path.join(TMP, 'one-' + ch + '-' + noteByte + '.sav');
  fs.writeFileSync(p, Buffer.from(sav));

  const out = cp.execFileSync(TRACE, [ROM, p, '400', '240'],
    { maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  const head = (out.split('\n').find(l => /^frame,/.test(l)) || '').split(',');
  const pair = ch === 2 ? ['NR33', 'NR34'] : ch === 1 ? ['NR23', 'NR24'] : ['NR13', 'NR14'];
  const lo = head.indexOf(pair[0]), hi = head.indexOf(pair[1]);
  if (lo < 0) return null;
  const seen = new Set();
  for (const l of out.split('\n')) {
    if (!/^\d+,/.test(l)) continue;
    const r = l.split(',').map(Number), per = r[lo] | ((r[hi] & 7) << 8);
    const hz = per >= 2048 ? 0 : (ch === 2 ? 65536 : 131072) / (2048 - per);
    if (hz > 20) seen.add(Math.round(69 + 12 * Math.log2(hz / 440)));
  }
  return seen.size === 1 ? [...seen][0] : null;
}

console.log('');
for (const [ch, name] of [[0, 'PU1'], [1, 'PU2'], [2, 'WAV']]) {
  const bases = [];
  for (const nb of [1, 13, 25]) {
    const midi = pitchOfSingleNote(ch, nb);
    if (midi != null) bases.push(midi - (nb - 1));
  }
  const agreed = bases.length === 3 && bases.every(b => b === bases[0]);
  ok(agreed && bases[0] === L.NOTE_BASE[ch],
    name + ': note byte 1 sounds MIDI ' + (bases[0] != null ? bases[0] : '?') +
    ', and NOTE_BASE says ' + L.NOTE_BASE[ch] +
    (agreed ? ' (three octaves apart all agree)' : ' -- the three probes disagreed: ' + JSON.stringify(bases)));
}

// ---- ROW BY ROW, NOT JUST ON AVERAGE ---------------------------------------
//
// Matching the average row length is the easy half: it only says the song ends
// at the right time. LSDj reaches a tempo between two whole frame counts with an
// ACCUMULATOR, so at tempo 120 its rows come out 7,8,7,8,7,7,8..., and two
// players agreeing on the mean while disagreeing about WHICH rows get the spare
// frame do not sound the same.
//
// The constant here is measured, not derived. 15 x FPS = 895.9125 is the
// physical value and it disagreed with LSDj on up to 20% of rows; fitting the
// real thing over eight tempi and a hundred gaps each lands on round(k *
// 895.88 / TEMPO), which reproduces 796 of 800.
{
  const H = globalThis.CT_GB_HARDWARE || globalThis.CT_GB;
  let differ = 0, total = 0, perfect = 0, cases = 0;
  for (const bpm of [128, 120, 135, 110]) {
    const doc = ruler(bpm, 128);
    const cart = api.toLsdjSav([doc]);
    const savPath = path.join(TMP, 'rows-' + bpm + '.sav');
    fs.writeFileSync(savPath, Buffer.from(cart.bytes));
    const out = cp.execFileSync(TRACE, [ROM, savPath, '420', '1400'],
      { maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    const lines = out.split('\n').filter(l => /^(frame,|\d+,)/.test(l));
    const head = lines[0].split(','), lo = head.indexOf('NR13'), hi = head.indexOf('NR14');
    const ev = [];
    let last = -1;
    for (const l of lines.slice(1)) {
      const r = l.split(',').map(Number), p = r[lo] | ((r[hi] & 7) << 8);
      if (p !== last) { ev.push(r[0]); last = p; }
    }
    // drop two: the trace starts mid-row
    const obs = ev.slice(2).map((f, i) => f - ev[i + 1]).filter(x => x > 0).slice(0, 80);
    if (obs.length < 40) continue;
    const m = L.readSong(new Uint8Array(cart.bytes.buffer, cart.bytes.byteOffset, L.SONG_BYTES));
    const ticks = Array.from(m.grooves[0]).filter(x => x > 0);
    const mine = [];
    for (let k = 0; k < obs.length + 40; k++)
      mine.push(H.lsdjRowFrame(m.tempo, ticks, k + 1) - H.lsdjRowFrame(m.tempo, ticks, k));
    let bad = Infinity;
    for (let p = 0; p < 40; p++) {
      let x = 0;
      for (let i = 0; i < obs.length; i++) if (obs[i] !== mine[i + p]) x++;
      bad = Math.min(bad, x);
    }
    differ += bad; total += obs.length; cases++;
    if (bad === 0) perfect++;
  }
  ok(cases > 0 && total > 0 && differ / total <= 0.02,
     'our clock puts the spare frames where LSDj does (' + (total - differ) + ' of ' + total +
     ' row gaps identical, ' + perfect + ' of ' + cases + ' tempi exact)');
}

// ---- AND THE DRUMS MAKE A SOUND -------------------------------------------
//
// ⚠️ A NOISE NOTE IS A PITCH, AND THE WRONG ONE IS SILENCE. Every drum used to
// be exported as note 25, on the reasoning that noise is not melodic. LSDj
// writes nothing to NR43 for any noise note below 33, so every drum this
// project ever exported was SILENT -- and nothing caught it, because the file
// was structurally perfect and our own reader agreed with every byte.
//
// The three drums must sound, and must sound DIFFERENT.
{
  const dj = { title: 'Kit', grid: 16, bpm: 128, bars: 2, notes: [] };
  ['kick', 'snare', 'hat', 'hat', 'kick', 'snare', 'hat', 'hat']
    .forEach((d, i) => dj.notes.push({ lane: 'Drums', step: i * 4, drum: d }));
  const cart = api.toLsdjSav([api.fromJSON(dj)]);
  const savPath = path.join(TMP, 'kit.sav');
  fs.writeFileSync(savPath, Buffer.from(cart.bytes));

  const out = cp.execFileSync(TRACE, [ROM, savPath, '420', '260'],
    { maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  const lines = out.split('\n').filter(l => /^(frame,|\d+,)/.test(l));
  const head = lines[0].split(','), i43 = head.indexOf('NR43');
  const colours = new Set();
  for (const l of lines.slice(1)) {
    const v = l.split(',').map(Number)[i43];
    if (v) colours.add(v);
  }
  ok(colours.size >= 3,
     'the drums reach the noise channel, in three different colours (' +
     [...colours].map(v => '0x' + v.toString(16)).join(' ') + ')');
}

// ---- AND THE BASS IS MADE OF OUR WAVE -------------------------------------
//
// A wave voice's whole timbre is its 32-nibble table. Without writing it, the
// export handed LSDj a bass playing the right notes through LSDj's DEFAULT
// waveform -- the correct tune in somebody else's voice, and a register trace
// limited to NR10..NR51 could never have said so, because the pitch was right.
//
// Left alone LSDj also ANIMATES through a run of frames -- that is its wave
// synth. Byte 9 pins the instrument to one frame, and that frame is ours.
{
  const bj = { title: 'Bass', grid: 16, bpm: 128, bars: 2, notes: [] };
  for (let s = 0; s < 8; s++)
    bj.notes.push({ lane: 'Bass', step: s * 4, note: NOTE(36 + s), len: 3, stamp: 'bassg' });
  const doc = api.fromJSON(bj);
  const cart = api.toLsdjSav([doc]);
  const savPath = path.join(TMP, 'wave.sav');
  fs.writeFileSync(savPath, Buffer.from(cart.bytes));

  const ours = Array.from(L.readSong(new Uint8Array(
    cart.bytes.buffer, cart.bytes.byteOffset, L.SONG_BYTES)).waves[0]);

  const out = cp.execFileSync(TRACE, [ROM, savPath, '420', '200'],
    { maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  const lines = out.split('\n').filter(l => /^(frame,|\d+,)/.test(l));
  const head = lines[0].split(','), w0 = head.indexOf('W0');
  const loaded = new Set();
  for (const l of lines.slice(1)) {
    const r = l.split(',').map(Number);
    loaded.add(r.slice(w0, w0 + 16).join(','));
  }
  ok(w0 >= 0 && loaded.has(ours.join(',')),
     'the wave channel is loaded with OUR table, not LSDj\'s default ' +
     '(' + loaded.size + ' distinct waveform' + (loaded.size === 1 ? '' : 's') + ' seen)');
}

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* scratch only */ }

console.log('\nverify-lsdj-emulator: ' + (fail ? fail + ' FAILED' : 'LSDj plays what we wrote, at the tempo we wrote it'));
process.exit(fail ? 1 : 0);
