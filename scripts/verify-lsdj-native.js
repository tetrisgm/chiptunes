#!/usr/bin/env node
// HOW MUCH OF WHAT WE WRITE COULD LSDJ HAVE WRITTEN?
//
// The goal is not "we can export something LSDj opens" -- verify-lsdj already
// proves that, and proves it with liblsdj rather than with our own reader. The
// goal is that there is NO DIFFERENCE: a song made here and a song made in LSDj
// are the same kind of object, so export, re-import and round-trip are all
// identity rather than translation.
//
// Today they are not, and this gate is the distance. Every check below is a
// thing LSDJ CANNOT HOLD, counted over many songs, with a CEILING that is the
// measured value at the time it was written. It is a RATCHET: the numbers may
// only fall. That keeps the suite honest while the composer is moved onto the
// LSDj model piece by piece, instead of the work living in a branch nobody runs.
//
// What LSDj is, in the shape that matters here:
//
//   song     4 channels x 256 chain rows
//   chain    16 phrase slots, each with a transpose
//   phrase   16 ROWS. A row holds one note, one instrument, one command+value.
//            Not two notes. Not a note at 3/4 of a row.
//   groove   the tick counts a row lasts, so tempo is integers, never a float
//   instr    64 slots for the whole song, typed per channel family
//
// The three structural counts below are all consequences of "a row is the
// smallest thing there is". They are the ones that decide whether a note
// SURVIVES a round trip, so they are the ones that ratchet.
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
['gb-hardware', 'gb-apu', 'gb-voices', 'chip-instruments', 'melody', 'style-corpus']
  .forEach(m => require(path.join(ROOT, 'src', m + '.js')));
const C = require(path.join(ROOT, 'src', 'composer.js'));
const FPS = (globalThis.CT_GB_HARDWARE || globalThis.CT_GB).FPS;

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fail++; };

const SONGS = 60;
const ROW_TOL = 0.6;              // a note may sit this many frames off its row
const CH = ['PU1', 'PU2', 'WAV', 'NOI'];

let notes = 0, offRow = 0, subRow = 0, rowClash = 0;
let maxInstPerSong = 0, maxRows = 0, maxVolPerCh = 0;
const offByCh = [0, 0, 0, 0], subByCh = [0, 0, 0, 0];

for (let i = 0; i < SONGS; i++) {
  const s = C.compile('lsdj-native-' + i);
  // ASK THE SONG WHERE ITS ROWS ARE. A swung song's rows are deliberately
  // uneven, so dividing the bar into equal slices measures the swing as error
  // and reports a song that is exactly on the grid as 62% off it.
  // ⚠️ THE GROOVE IS IN LSDJ TICKS, so the row boundaries come from LSDj's own
  // clock -- ticks x 149.31875 / TEMPO, accumulated. Measuring against evenly
  // divided frames instead reports a song sitting perfectly on the grid as 83%
  // off it, which is exactly what happened the first time and again when the
  // units changed underneath. Ask the clock, never the average.
  const H = globalThis.CT_GB_HARDWARE || globalThis.CT_GB;
  const g = s.groove && s.groove.length ? s.groove : null;
  const rowFrames = g ? H.lsdjFramesPerRow(s.bpm, g) : (60 / s.bpm) * FPS / 4;
  const rowOf = f => {
    if (!g) return f / rowFrames;
    const lo = Math.max(0, Math.floor(f / rowFrames) - 2);
    let best = lo, bd = Infinity;
    for (let r = lo; r <= lo + 4; r++) {
      const d = Math.abs(H.lsdjRowFrame(s.bpm, g, r) - f);
      if (d < bd) { bd = d; best = r; }
    }
    return best + (f - H.lsdjRowFrame(s.bpm, g, best)) / rowFrames;  // integer on a row
  };
  const perCh = [[], [], [], []];
  const inst = new Set(), vol = [new Set(), new Set(), new Set(), new Set()];
  (s.gb.notes || []).forEach(n => {
    notes++;
    inst.add(n.ch + ':' + n.inst);
    vol[n.ch].add(Math.round(n.vel * 100));
    const r = rowOf(n.frame);
    if (Math.abs(r - Math.round(r)) * rowFrames > ROW_TOL) { offRow++; offByCh[n.ch]++; }
    perCh[n.ch].push({ row: Math.round(r), frame: n.frame });
  });
  maxInstPerSong = Math.max(maxInstPerSong, inst.size);
  for (let c = 0; c < 4; c++) {
    maxVolPerCh = Math.max(maxVolPerCh, vol[c].size);
    perCh[c].sort((a, b) => a.frame - b.frame);
    const seen = new Set();
    for (let j = 0; j < perCh[c].length; j++) {
      if (seen.has(perCh[c][j].row)) rowClash++;
      seen.add(perCh[c][j].row);
      // IN ROWS, NOT IN FRAMES. Comparing frame gaps against the average row
      // measures the swing: a [8,5] groove really does put some notes 5 frames
      // apart, and they are exactly on their rows. Two notes are too close only
      // if they want the SAME row, which is a thing LSDj cannot hold.
      if (j && perCh[c][j].row - perCh[c][j - 1].row < 1) { subRow++; subByCh[c]++; }
    }
    if (perCh[c].length) maxRows = Math.max(maxRows, perCh[c][perCh[c].length - 1].row + 1);
  }
}

const pct = n => (100 * n / notes);
console.log('         %d songs, %d notes\n', SONGS, notes);

// ---- the ratchet. Ceilings are the measured values on 2026-09-04. ----------
// Lower one whenever the composer gets closer; never raise one to make a change
// fit. A raise means the export got further from LSDj, which is the whole thing
// this file exists to stop.
ok(pct(offRow) === 0,
  'notes that do not sit on a phrase row: ' + pct(offRow).toFixed(2) + '% (must be 0) ' +
  CH.map((n, i) => n + '=' + offByCh[i]).join(' '));
ok(pct(subRow) === 0,
  'notes closer together than one row: ' + pct(subRow).toFixed(2) + '% (must be 0) ' +
  CH.map((n, i) => n + '=' + subByCh[i]).join(' '));
ok(pct(rowClash) === 0,
  'two notes on one channel and row: ' + pct(rowClash).toFixed(2) + '% (must be 0)');

// ---- limits that are hard: over these, a song does not FIT. ----------------
ok(maxInstPerSong <= 64,
  'instruments in one song: ' + maxInstPerSong + ' (LSDj has 64 slots)');
ok(maxRows <= 256 * 16,
  'longest channel: ' + maxRows + ' rows (LSDj holds 256 chain rows of 16)');

// ---- and the one that is not a count, but a MODEL difference. --------------
// LSDj has no per-note volume column. Volume is the instrument's envelope, and
// changing it mid-phrase costs the row's one command. Every distinct velocity
// we emit past the first is either an instrument LSDj would need a slot for or
// a command we have not written.
console.log('');
ok(maxVolPerCh <= 24,
  'distinct note volumes on one channel: ' + maxVolPerCh + ' (ceiling 24; LSDj ' +
  'keeps volume in the INSTRUMENT, so each one is a slot or a command)');

// ---- THE FORMAT ITSELF, both directions -----------------------------------
// Parity is a round trip, not an export. These check the codec and the model on
// data chosen to break them, because the only thing ever round-tripped through
// here before was the EMPTY SONG -- which compresses to under one block and so
// never took a block jump. The reader jumped to `a * 512` instead of
// (a-1) * 512 and silently lost 512 bytes at every boundary; a real song is
// five blocks, so it was wrong on everything anyone would actually export.
console.log('');
const L = require(path.join(ROOT, 'src', 'lsdj.js'));

const rnd = s => { let a = s; return () => { a = (a * 1103515245 + 12345) & 0x7fffffff; return (a >>> 16) & 0xff; }; };
const DEF_WAVE = [0x8E, 0xCD, 0xCC, 0xBB, 0xAA, 0xA9, 0x99, 0x88, 0x87, 0x76, 0x66, 0x55, 0x54, 0x43, 0x32, 0x31];
const IMAGES = {
  'the empty song': () => L.emptySong(),
  'random bytes': () => { const r = rnd(7), b = new Uint8Array(L.SONG_BYTES); for (let i = 0; i < b.length; i++) b[i] = r(); return b; },
  // 0xC0 and 0xE0 are the two escapes, so a buffer made of them is the worst
  // case for the encoder and the one that first exposed the block bug.
  'nothing but escapes': () => { const b = new Uint8Array(L.SONG_BYTES); for (let i = 0; i < b.length; i++) b[i] = [0xC0, 0xE0, 0xFF, 0x00][i & 3]; return b; },
  'long runs': () => { const b = new Uint8Array(L.SONG_BYTES); for (let i = 0; i < b.length; i++) b[i] = (i >> 5) & 0xff; return b; },
  'the default wave, repeated': () => { const b = new Uint8Array(L.SONG_BYTES); for (let i = 0; i < b.length; i++) b[i] = DEF_WAVE[i & 15]; return b; }
};
const firstDiff = (a, b) => { for (let i = 0; i < L.SONG_BYTES; i++) if (a[i] !== b[i]) return i; return -1; };

Object.keys(IMAGES).forEach(name => {
  const img = IMAGES[name]();
  const codec = firstDiff(img, L.decompress(L.compress(img, 1)));
  ok(codec < 0, 'compress then decompress returns ' + name + ' unchanged' +
    (codec < 0 ? '' : ' (first difference at 0x' + codec.toString(16) + ')'));
  // The whole chain a real import takes: bytes off disk, into the model, back
  // out. If this is exact then nothing an LSDj song carries is lost by passing
  // through us, whether we understand the field or merely keep it.
  const chain = firstDiff(img, L.writeSong(L.readSong(L.decompress(L.compress(img, 1)))));
  ok(chain < 0, 'and survives the model round trip: ' + name +
    (chain < 0 ? '' : ' (first difference at 0x' + chain.toString(16) + ')'));
});

// How much of a song we UNDERSTAND rather than carry verbatim. A ratchet the
// other way up: this may rise and must not fall.
const cov = L.coverage();
ok(cov.percent >= 71.5,
  'the field map understands ' + cov.bytes + ' of ' + cov.total + ' song bytes (' +
  cov.percent.toFixed(1) + '%, floor 71.5); the rest round-trips verbatim');

console.log('\nverify-lsdj-native: ' + (fail ? fail + ' FAILED' : 'the distance from LSDj is not growing'));
process.exit(fail ? 1 : 0);
