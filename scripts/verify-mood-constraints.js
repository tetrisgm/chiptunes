#!/usr/bin/env node
'use strict';

// A mood constrains one composition. Production used to compile up to 140
// complete songs and keep the first metadata match, which was both the
// dominant interaction cost and forbidden best-of-N selection. These fixtures
// are naturally the wrong style, so an ignored second argument fails loudly.
const crypto = require('crypto');
const C = require('../src/composer.js');

let fail = 0;
const ok = (condition, message) => {
  console.log((condition ? '  ok   ' : '  FAIL ') + message);
  if (!condition) fail++;
};
const major = new Set(['ionian', 'mixolydian', 'lydian', 'pent-major']);

function constrained(token, premise, check, label) {
  const a = C.compile(token, premise);
  const b = C.compile(token, premise);
  ok(JSON.stringify(a) === JSON.stringify(b), label + ' is deterministic');
  ok(check(a), label + ' satisfies every requested axis (' +
    [a.style, a.tracker.mode, a.bpm].join(', ') + ')');
  ok(a.tracker && JSON.stringify(a.tracker.premise) === JSON.stringify(premise),
    label + ' records its normalized premise');
  ok(a.gb && a.gb.notes && a.gb.notes.length > 0, label + ' composes one playable score');
}

constrained('523e26qcl13jeeuu',
  { styles: ['anthem'], mode: null, bpmMin: 0, bpmMax: 999 },
  s => s.style === 'anthem', 'epic');
constrained('1nxedqps6or4ys5s',
  { styles: ['dnb', 'punk', 'techno'], mode: 'min', bpmMin: 0, bpmMax: 999 },
  s => ['dnb', 'techno'].includes(s.style) && !major.has(s.tracker.mode), 'battle');
constrained('64r1urcc5i1lsarc',
  { styles: null, mode: 'maj', bpmMin: 110, bpmMax: 999 },
  s => major.has(s.tracker.mode) && s.bpm >= 110, 'happy');

let contradicted = false;
try { C.compile('conflicting-premise', { styles: ['drone'], mode: null, bpmMin: 160, bpmMax: 999 }); }
catch (e) { contradicted = /premise/.test(String(e && e.message)); }
ok(contradicted, 'an impossible premise fails instead of returning a mislabeled song');

// The optional premise must not rewrite the ordinary station.
//
// UPDATED DELIBERATELY, 2026-09-03. The composer now picks its tempo from the
// eight the machine can actually hold (a step lasts a whole number of frames,
// so 179.2, 149.3, 128.0, 112.0, 99.5, 89.6, 81.4 and 74.7 are all there is),
// and the STYLES windows were widened so each spans two or three of them.
//
// Before this the composer chose freely and the player snapped at playback, up
// to 7% away -- so it wrote for one tempo and you heard another, and the gap was
// papered over with an uneven groove that put an audible limp on almost every
// song. Now the two are the same number everywhere and nothing is bent.
//
// Two further consequences of that were fixed in the same change, because a
// quantised tempo exposed them. Song length was a pure function of tempo, so
// eight tempi gave four song lengths where there had been six; it now varies
// per token as well. And the arpeggio stamped one figure every other bar for
// eight bars running -- on a plan with no free harmony channel that figure IS
// the lead channel -- which was 76% of every repeated bar in the arrangement.
// The figure still holds for the block; its anchor walks.
//
// UPDATED AGAIN, 2026-09-04, TWICE. First moving time onto rows; then
// removing the tempo ladder outright, because the real LSDj says there is no
// such thing. Measured off the ROM in mGBA: LSDj runs an ACCUMULATOR and plays
// every integer tempo, spending the remainder as a mix of two whole frame
// counts. Our eight rungs were ours, not the machine's, and offered 8 tempi
// where it offers 111. Across these 48 songs the distinct tempi went 7 -> 37;
// style, mode and titles are untouched.
//
// The first change, kept for the record: Swing was a fractional
// nudge on every offbeat -- a position LSDj has no way to write down, and 92%
// of everything in our output that could not survive an export. It is a GROOVE
// now: the rows themselves are a long-short pair of tick counts, the feel is
// the same, and every note sits exactly on a row. The frame-level arp became
// what it always was on the machine, a chord.
//
// Both changes were checked before the digest was replaced, and both times
// STYLE, MODE and TITLES were identical across all 48 songs. What moved is
// tempo (45 of 48, now free integers instead of eight rungs), length where it
// follows tempo, and note counts. That is what this checksum is for -- to make
// a change like this a decision rather than a surprise.
const rows = Array.from({ length: 48 }, (_, i) => JSON.stringify(C.compile('smoke-song-' + i)));
const digest = crypto.createHash('sha256').update(rows.join('\n') + '\n').digest('hex');
ok(digest === '7c633857806e19b0233892926c4d18766ad1c03013dcaa8db9c19cc22ad2fce2',
  'unconstrained station scores remain byte-for-byte unchanged');

console.log(fail ? '\nverify-mood-constraints: ' + fail + ' FAILED'
                 : '\nverify-mood-constraints: one token, one constrained composition');
process.exit(fail ? 1 : 0);
