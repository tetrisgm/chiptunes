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
const api = require(path.join(ROOT, 'src', 'api.js'));
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
// LSDj HAS NO PER-NOTE VOLUME COLUMN. Volume lives in the instrument, so an
// accent is not a louder note -- it is a different instrument.
//
// This used to be a ceiling on how many volumes we emit, which was the wrong
// way round: it asked the music to be simpler. The LSDj answer is to have MORE
// INSTRUMENTS, which is what the 64 slots are for and what a musician does by
// hand. So the check is that every distinct (voice, volume) a song plays gets
// its own slot and they all FIT -- the accents survive the export instead of
// being flattened into one level.
console.log('');
{
  const NAMES2 = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const L0 = require(path.join(ROOT, 'src', 'lsdj.js'));
  let worst = 0, capped = 0, checked = 0;
  for (let i = 0; i < 12; i++) {
    const made = api.brief({ scene: ['battle', 'cave', 'title', 'boss'][i % 4], seconds: 40, token: 'inst-' + i });
    const m = L0.readSong(L0.parseLsdsng(api.toLsdsng(made.doc).bytes).song);
    let n = 0;
    for (let k = 0; k < 64; k++) if (m.instrumentAlloc[k]) n++;
    worst = Math.max(worst, n);
    if (n >= 64) capped++;
    checked++;
  }
  ok(checked === 12 && capped === 0,
     'every voice and every playing level gets its own instrument, and they fit (' +
     worst + ' of 64 at worst across ' + checked + ' songs)');
}
ok(maxVolPerCh <= 24,
  'distinct note volumes on one channel: ' + maxVolPerCh + ' (ceiling 24, which is ' +
  'what still fits in 64 slots alongside the other voices)');

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

// ---- AND BACK AGAIN: import ------------------------------------------------
// Export alone makes this a place songs leave. Reading LSDj's own files is what
// lets them come back, and it is the same walk LSDj does -- sequence to chains
// to phrases to rows. The test is not "it parsed" but that the song SURVIVES:
// same notes, same tempo, same groove, and importing twice changes nothing.
{
  const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const nm = n => NAMES[n % 12] + (Math.floor(n / 12) - 1);
  const j = { title: 'RoundTrip', grid: 16, bpm: 131, bars: 6, notes: [] };
  for (let s = 0; s < 80; s++) j.notes.push({ lane: 'Melody', step: s, note: nm(60 + (s % 13)), len: 1 });
  for (let s = 0; s < 24; s++) j.notes.push({ lane: 'Bass', step: s * 3, note: nm(36 + (s % 7)), len: 2 });
  const doc = api.fromJSON(j);
  const sng = api.toLsdsng(doc);
  const back = api.fromLsdsng(sng.bytes);

  ok(back.bpm === j.bpm, 'an exported song comes back at the tempo it left (' + back.bpm + ')');
  ok(JSON.stringify(back.groove) === JSON.stringify(sng.groove),
     'and with its groove (' + JSON.stringify(back.groove) + ' ticks)');

  // Compare as SETS of (lane, step, pitch). The two lists are ordered
  // differently -- what we sent is grouped by lane, what comes back is sorted by
  // step across all of them -- and comparing them positionally tests the sort,
  // not the song.
  const key = n => n.lane + '|' + n.step + '|' + n.note;
  const sent = j.notes.filter(n => n.note).map(key).sort();
  const got = api.toJSON(back.doc).notes.filter(n => n.note).map(key).sort();
  ok(got.length === sent.length,
     'and every pitched note (' + got.length + '/' + sent.length + ')');
  const missing = sent.filter(k => got.indexOf(k) < 0);
  ok(missing.length === 0,
     'on the same lane, at the same step, at the same pitch' +
     (missing.length ? ' -- ' + missing.length + ' missing, first ' + missing[0] : ''));

  // A FIXED POINT, which is the property that makes import safe to use twice.
  // If importing changed the song a little, every round trip would drift.
  const back2 = api.fromLsdsng(api.toLsdsng(back.doc).bytes);
  ok(JSON.stringify(api.toJSON(back.doc).notes) === JSON.stringify(api.toJSON(back2.doc).notes),
     'and importing it again changes nothing at all');

  // The .sav path reads the working-memory song, which is what a cart opens on.
  const cart = api.fromLsdsng(api.toLsdjSav([doc]).bytes);
  ok(cart.notes === back.notes && cart.bpm === back.bpm,
     'a whole .sav imports the same way a .lsdsng does (' + cart.notes + ' notes)');

  // AND WHICH DRUM IT WAS. Every drum sounds on the noise channel as the same
  // pitch, because a .sav carries no kit samples -- they live in the ROM -- so
  // for a while a kick and a hat came back indistinguishable. Each drum gets its
  // own instrument slot now, which is both what an LSDj musician does by hand
  // and the only thing in the file that can still tell them apart.
  const dj = { title: 'Kit', grid: 16, bpm: 128, bars: 2, notes: [] };
  ['kick', 'hat', 'snare', 'hat', 'kick', 'hat', 'snare', 'hat']
    .forEach((d, i) => dj.notes.push({ lane: 'Drums', step: i * 4, drum: d }));
  for (let s = 0; s < 8; s++) dj.notes.push({ lane: 'Melody', step: s * 4, note: nm(60 + s), len: 2 });
  const dBack = api.fromLsdsng(api.toLsdsng(api.fromJSON(dj)).bytes);
  const sentD = dj.notes.filter(x => x.drum).map(x => x.step + ':' + x.drum).join(' ');
  const gotD = api.toJSON(dBack.doc).notes.filter(x => x.drum).map(x => x.step + ':' + x.drum).join(' ');
  ok(sentD === gotD, 'and a kick comes back a kick, a hat a hat (' + gotD + ')');

  // AND HOW LONG EACH NOTE LASTED. LSDj stores no length -- a note runs until
  // the next note or a K command -- so this was written off as unrecoverable.
  // It is not: a length IS "where it stops", the export says so with a KILL, and
  // the import reads it back. Without the KILL a staccato note exported as a
  // sustained one, which is a different piece of music and was audible on
  // anything with space in it; verified in mGBA, the volume now drops one row
  // after the note instead of holding to the next.
  const lj = { title: 'Lengths', grid: 16, bpm: 128, bars: 2, notes: [] };
  [1, 2, 1, 4, 1, 2, 3, 1].forEach((len, s) =>
    lj.notes.push({ lane: 'Melody', step: s * 4, note: nm(60 + s), len }));
  const lBack = api.fromLsdsng(api.toLsdsng(api.fromJSON(lj)).bytes);
  const sentL = lj.notes.map(n => n.len).join(' ');
  const gotL = api.toJSON(lBack.doc).notes.filter(n => n.note).map(n => n.len).join(' ');
  ok(sentL === gotL, 'and every note lasts as long as it did (' + gotL + ')');

  // AND THE VOICE IT WAS PLAYED WITH. Without this an imported song comes back
  // in OUR default timbre at OUR default loudness -- the app performing somebody
  // else's notes rather than playing their song. The instrument in the file says
  // both: byte 1's high nibble is the volume, byte 7's top bits are the duty.
  const vj = { title: 'Voices', grid: 16, bpm: 128, bars: 2, notes: [
    { lane: 'Melody', step: 0, note: nm(60), len: 2, velocity: 0.40, stamp: 'bell' },
    { lane: 'Melody', step: 4, note: nm(62), len: 2, velocity: 0.93, stamp: 'trumpet' },
    { lane: 'Melody', step: 8, note: nm(64), len: 2, velocity: 0.67, stamp: 'piano' },
    { lane: 'Bass',   step: 0, note: nm(36), len: 4, velocity: 0.80, stamp: 'bassg' }
  ] };
  const vBack = api.toJSON(api.fromLsdsng(api.toLsdsng(api.fromJSON(vj)).bytes).doc).notes;
  const find = (lane, step) => vBack.find(n => n.lane === lane && n.step === step);
  const voiceOk = vj.notes.every(n => {
    const g = find(n.lane, n.step);
    // a 15th is LSDj's own volume resolution, so that is the tolerance
    return g && g.stamp === n.stamp && Math.abs(g.velocity - n.velocity) <= 1 / 15;
  });
  ok(voiceOk, 'and each one keeps its timbre and its loudness (' +
     vj.notes.map(n => { const g = find(n.lane, n.step); return g ? g.stamp + '@' + g.velocity.toFixed(2) : '?'; }).join(' ') + ')');

  // AND THE GESTURE. An arpeggio is the C command and a roll is R; the export
  // wrote both and the import read neither, so a song came home with its
  // gestures flattened by the very round trip that had just written them.
  const mj = { title: 'Motion', grid: 16, bpm: 128, bars: 3, notes: [
    { lane: 'Melody', step: 0,  note: nm(60), len: 2, motion: 'arp' },
    { lane: 'Melody', step: 4,  note: nm(62), len: 2, motion: 'roll' },
    { lane: 'Melody', step: 8,  note: nm(64), len: 2, motion: 'plain' },
    { lane: 'Melody', step: 12, note: nm(65), len: 2, motion: 'arp' },
    // A fall and a rise are a hardware SWEEP, and the sweep unit belongs to PU1
    // alone -- so only this lane can carry them, which is the machine's own
    // limit rather than one we added. NR10 rides in instrument byte 4.
    { lane: 'Melody', step: 16, note: nm(67), len: 2, motion: 'fall' },
    { lane: 'Melody', step: 20, note: nm(69), len: 2, motion: 'rise' }
  ] };
  const mBack = api.toJSON(api.fromLsdsng(api.toLsdsng(api.fromJSON(mj)).bytes).doc).notes.filter(n => n.note);
  const sentM = mj.notes.map(n => n.motion).join(' ');
  const gotM = mBack.map(n => n.motion || 'plain').join(' ');
  ok(sentM === gotM, 'and the gesture it was played with (' + gotM + ')');

  // AN ECHO IS TWO NOTES, and LSDj has no flag for it. Ours renders as the note
  // shortened to a row plus a quieter repeat one row later, so that is what gets
  // written -- and a musician opening the file sees the repeat, which is what is
  // actually happening. Written as a flag it was simply lost.
  const ej = { title: 'Echo', grid: 16, bpm: 128, bars: 2, notes: [
    { lane: 'Melody', step: 0, note: nm(60), len: 2, motion: 'echo' },
    { lane: 'Melody', step: 8, note: nm(64), len: 2, motion: 'plain' }
  ] };
  const eBack = api.toJSON(api.fromLsdsng(api.toLsdsng(api.fromJSON(ej)).bytes).doc)
    .notes.filter(n => n.note);
  const echoed = eBack.length === 3 &&
    eBack[0].step === 0 && eBack[1].step === 1 &&
    eBack[1].note === eBack[0].note && eBack[1].velocity < eBack[0].velocity;
  ok(echoed, 'and an echo arrives as the quieter repeat it is (' +
     eBack.map(n => n.step + ':' + n.note + '@' + n.velocity.toFixed(2)).join(' ') + ')');
}

// How much of a song we UNDERSTAND rather than carry verbatim. A ratchet the
// other way up: this may rise and must not fall.
const cov = L.coverage();
ok(cov.percent >= 84.0,
  'the field map understands ' + cov.bytes + ' of ' + cov.total + ' song bytes (' +
  cov.percent.toFixed(1) + '%, floor 84.0); the rest round-trips verbatim');

console.log('\nverify-lsdj-native: ' + (fail ? fail + ' FAILED' : 'the distance from LSDj is not growing'));
process.exit(fail ? 1 : 0);
