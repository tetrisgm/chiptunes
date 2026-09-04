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
  const H = globalThis.CT_GB_HARDWARE || globalThis.CT_GB;
  const g = s.groove && s.groove.length ? s.groove : null;
  const rowFrames = g ? H.framesPerRow(g) : (60 / s.bpm) * FPS / 4;
  const rowOf = f => {
    if (!g) return f / rowFrames;
    const lo = Math.max(0, Math.floor(f / rowFrames) - 2);
    let best = lo, bd = Infinity;
    for (let r = lo; r <= lo + 4; r++) {
      const d = Math.abs(H.rowFrame(g, r) - f);
      if (d < bd) { bd = d; best = r; }
    }
    return best + (f - H.rowFrame(g, best)) / rowFrames;   // integer when on a row
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

console.log('\nverify-lsdj-native: ' + (fail ? fail + ' FAILED' : 'the distance from LSDj is not growing'));
process.exit(fail ? 1 : 0);
