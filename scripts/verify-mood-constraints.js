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

// The optional premise must not rewrite the ordinary station. This checksum is
// the pre-refactor output of the existing 48-song smoke ensemble.
const rows = Array.from({ length: 48 }, (_, i) => JSON.stringify(C.compile('smoke-song-' + i)));
const digest = crypto.createHash('sha256').update(rows.join('\n') + '\n').digest('hex');
ok(digest === '72731f65bb59e30722a9ba09dd069f98d697c1de887375c21d043d355cfbf566',
  'unconstrained station scores remain byte-for-byte unchanged');

console.log(fail ? '\nverify-mood-constraints: ' + fail + ' FAILED'
                 : '\nverify-mood-constraints: one token, one constrained composition');
process.exit(fail ? 1 : 0);
