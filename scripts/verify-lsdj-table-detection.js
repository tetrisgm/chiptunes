#!/usr/bin/env node
// AN ENABLED TABLE IS NOT INVISIBLE JUST BECAUSE IT DOES NOT TRANSPOSE.
//
// LSDj turns a per-instrument table on with instrument byte 6 = 0x20 | index.
// The table's columns are read into the model as tables0 (transpose), tables1,
// tables2 and the tableCommands/tableValues command pair. `tableOf` used to
// test ONLY the transpose column, so an enabled table that moved no pitch but
// ran volume or duty commands was classified absent: no note carried it, no
// warning named it, and the round trip looked as if the song used no table at
// all (docs/HANDOFF.md 2026-09-05, "tableOf ignores enabled tables with zero
// transpose even if they contain other modulation").
//
// This gate pins the corrected contract WITHOUT claiming table execution:
//   * a DISABLED table is absent even with transpose data present,
//   * an ENABLED zero-transpose table with volume/duty commands is DETECTED and
//     surfaced as an honest "detected but not executed" warning -- never as a
//     fabricated arpeggio, and never silently dropped,
//   * an ENABLED transpose table keeps its existing arpeggio approximation,
//   * an ENABLED but wholly EMPTY table stays honestly absent,
//   * a table-free song raises no table warning at all.
//
// Nothing here executes a table. It checks detection and warning honesty only.
'use strict';
const path = require('path');
const L = require(path.join(__dirname, '..', 'src', 'lsdj.js'));

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fail++; };

const PROJECTED = /projected approximately from transpose rows/;
const DETECTED = /detected but not executed/;
const ANY_TABLE = /table/;
const has = (warnings, re) => warnings.some(w => re.test(w));

// A minimal native song image: one pitched note on channel 0, played by
// instrument 0, everything else silent. Every table column starts empty so a
// case only ever sees the modulation it pokes in.
function oneNoteModel() {
  const m = L.readSong(L.emptySong());
  m.sequence.forEach(r => r.fill(255));
  m.chainPhrases.forEach(r => r.fill(255));
  m.chainTranspose.forEach(r => r.fill(0));
  m.phraseNotes.forEach(r => r.fill(0));
  m.phraseInstruments.forEach(r => r.fill(255));
  m.phraseCommands.forEach(r => r.fill(0));
  m.phraseCommandVals.forEach(r => r.fill(0));
  [m.tables0, m.tables1, m.tables2, m.tableCommands, m.tableValues]
    .forEach(region => region.forEach(row => row.fill(0)));
  m.sequence[0][0] = 0;              // channel 0 -> chain 0
  m.chainPhrases[0][0] = 0;          // chain 0 -> phrase 0
  m.phraseNotes[0][0] = 25;          // MIDI 60 on a pulse
  m.phraseInstruments[0][0] = 0;     // instrument 0 triggers the note
  return m;
}

// Import as LSDj would see it after a save: through the codec and back into the
// model, so the check exercises the same bytes an import walks.
const importOf = (m, name) => L.toSongJSON(L.readSong(L.writeSong(m)), { name: name });

console.log('LSDj table detection: enabled zero-transpose tables are not ignored\n');

// ---- disabled table, transpose data present -------------------------------
{
  const m = oneNoteModel(), idx = 3;
  m.instrumentParams[0][6] = 0x03;                       // table OFF (default)
  for (let i = 0; i < 16; i++) m.tables0[idx][i] = [0, 4, 7, 12][i % 4];
  ok(L.tableOf(m, 0) === null,
     'a disabled instrument reports no table even with transpose data present');
  const rep = importOf(m, 'Disabled');
  ok(!has(rep.warnings, ANY_TABLE), 'and no table warning is raised for it');
  ok(rep.tableNotes.length === 0, 'and nothing is expanded from it');
}

// ---- ENABLED zero-transpose table with volume/duty commands ----------------
// The exact case the old code dropped: enabled, no pitch movement, real
// modulation in the command pair.
{
  const m = oneNoteModel(), idx = 7;
  m.instrumentParams[0][6] = 0x20 | idx;                 // table ON
  for (let i = 0; i < 16; i++) m.tables0[idx][i] = 0;    // moves no pitch
  m.tableCommands[idx][0] = L.COMMANDS.E; m.tableValues[idx][0] = 0xA0; // volume
  m.tableCommands[idx][1] = L.COMMANDS.W; m.tableValues[idx][1] = 0x02; // duty
  ok(L.tableOf(m, 0) === idx,
     'an enabled all-zero-transpose table with commands is detected, not absent');
  ok(L.tableTransposes(m, idx) === false, 'and is reported as moving no pitch');
  const rep = importOf(m, 'CmdOnly');
  ok(has(rep.warnings, DETECTED),
     'toSongJSON warns its modulation is detected but not executed');
  ok(!has(rep.warnings, PROJECTED),
     'and does not claim a transpose projection it never made');
  ok(rep.tableNotes.length === 0,
     'and fabricates no arpeggio/tick expansion for it');
}

// ---- ENABLED transpose table: existing approximation preserved -------------
{
  const m = oneNoteModel(), idx = 2;
  m.instrumentParams[0][6] = 0x20 | idx;
  for (let i = 0; i < 16; i++) m.tables0[idx][i] = [0, 4, 7, 12][i % 4];
  ok(L.tableOf(m, 0) === idx, 'an enabled transpose table is still detected');
  ok(L.tableTransposes(m, idx) === true, 'and reported as moving the pitch');
  const rep = importOf(m, 'Transpose');
  ok(has(rep.warnings, PROJECTED),
     'toSongJSON still warns it is a transpose approximation');
  ok(rep.tableNotes.some(t => t.table === idx),
     'and still hands the transpose table to the arpeggio expansion');
}

// ---- ENABLED but wholly empty table: honestly absent -----------------------
{
  const m = oneNoteModel();
  m.instrumentParams[0][6] = 0x20 | 9;                   // enabled, table 9 empty
  ok(L.tableOf(m, 0) === null,
     'an enabled but wholly empty table is honestly absent, not a phantom');
  ok(!has(importOf(m, 'EmptyTable').warnings, ANY_TABLE),
     'and raises no table warning');
}

// ---- regression: a table-free song is silent about tables ------------------
{
  const m = oneNoteModel();                              // byte 6 default, tables empty
  ok(L.tableOf(m, 0) === null, 'a table-free instrument reports no table');
  ok(!has(importOf(m, 'Plain').warnings, ANY_TABLE),
     'and a table-free song raises no table warning');
}

// ---- detection and projection do not mutate the native image ---------------
{
  const m = oneNoteModel();
  m.instrumentParams[0][6] = 0x20 | 5;
  m.tableCommands[5][0] = L.COMMANDS.E; m.tableValues[5][0] = 0x30;
  const before = Buffer.from(L.writeSong(m));
  L.tableOf(m, 0);
  L.toSongJSON(m, { name: 'NoMutate' });
  ok(Buffer.from(L.writeSong(m)).equals(before),
     'detection and projection do not mutate the native image');
}

console.log('\nverify-lsdj-table-detection: ' +
  (fail ? fail + ' FAILED' : 'enabled tables are detected honestly, executed by nothing'));
process.exit(fail ? 1 : 0);
