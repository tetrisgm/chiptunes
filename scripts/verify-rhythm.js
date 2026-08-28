// The station must not have a favourite rhythm.
//
// Reported from listening, and exactly right: "it plays one two three four and
// the fourth note is longer, and it does that a lot, and it reuses the pattern
// in the same structure -- 1234 1234 1234 12 -- and that pattern is in so many
// songs." Four things were causing it, and all four were structural:
//
//  1. The rhythm corpus is mined by sliding a window over real Game Boy leads,
//     so a 32-note run of straight sixteenths emits 29 overlapping '1-1-1-1'
//     cells. Weighting by raw count therefore measured how LONG a figure ran,
//     not how often it was chosen: '1-1-1-1' held 69% of the draw and a 96-cell
//     corpus had an effective vocabulary of 5.7 cells.
//  2. The phrase builder truncated every bar to four notes -- `i < shape.length
//     + 1`, and every contour in the pool is three long. Literally one, two,
//     three, four.
//  3. One rhythm stamped all of bars 0-2 of every phrase, unvaried.
//  4. The cadence bar was the hardcoded [0,4,8] in every phrase of every song
//     ever generated -- a quarter of all melodic bars, three notes then a held
//     one.
//
// This measures the ensemble, not one song: a single song may repeat a figure
// as much as it likes -- repetition is what makes a tune -- but the STATION
// must not keep reaching for the same handful.
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
globalThis.CT_GB_HARDWARE = require(path.join(ROOT, 'src', 'gb-hardware.js'));
const Song = require(path.join(ROOT, 'src', 'seed.js'));
globalThis.Song = Song;
require(path.join(ROOT, 'src', 'gb-voices.js'));
require(path.join(ROOT, 'src', 'chip-instruments.js'));
require(path.join(ROOT, 'src', 'melody.js'));
require(path.join(ROOT, 'src', 'style-corpus.js'));
const C = require(path.join(ROOT, 'src', 'composer.js'));
const FPS = globalThis.CT_GB_HARDWARE.FPS;

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fail++; };

const SONGS = 200;
const bars = {}, runs = {}, gaps = {};
let sssl = 0, fourRuns = 0, repeats = 0, solidBars = 0, notes = 0, melodicBars = 0;

for (let i = 0; i < SONGS; i++) {
  const s = C.compile('rhythm-gate-' + i);
  const six = (60 / s.bpm) / 4;
  const byBar = {};
  (s.gb.notes || []).filter(n => n.ch === 0).forEach(n => {
    notes++;
    const t = (n.frame / FPS) / six, d = Math.max(1, Math.round((n.frames / FPS) / six));
    const b = Math.floor(t / 16);
    (byBar[b] = byBar[b] || []).push([Math.round(t) % 16, Math.min(16, d)]);
  });
  const shapes = [];
  Object.keys(byBar).map(Number).sort((a, b) => a - b).forEach(k => {
    const l = byBar[k]; l.sort((a, b) => a[0] - b[0]); melodicBars++;
    bars[l.map(x => x[0]).join(',')] = (bars[l.map(x => x[0]).join(',')] || 0) + 1;
    for (let j = 1; j < l.length; j++) { const g = l[j][0] - l[j - 1][0]; gaps[g] = (gaps[g] || 0) + 1; }
    for (let j = 3; j < l.length; j++) {
      fourRuns++;
      const d = [l[j - 3][1], l[j - 2][1], l[j - 1][1], l[j][1]];
      runs[d.join('-')] = (runs[d.join('-')] || 0) + 1;
      // three short, then one at least three times longer: the reported shape
      if (d[0] <= 2 && d[1] <= 2 && d[2] <= 2 && d[3] >= Math.max(6, 3 * Math.max(d[0], d[1], d[2]))) sssl++;
    }
    shapes.push(l.length >= 3 ? l.map(x => x[0]).join(',') : null);
  });
  for (let j = 1; j < shapes.length; j++) {
    if (!shapes[j]) continue;
    solidBars++;
    if (shapes[j] === shapes[j - 1]) repeats++;
  }
}

// effective vocabulary = exp(entropy): how many patterns you EFFECTIVELY get,
// which is the number that matters. A 96-cell corpus offering 5.7 of them in
// practice is the whole bug in one figure.
function effective(o) {
  const e = Object.values(o), tot = e.reduce((a, c) => a + c, 0);
  let H = 0; e.forEach(v => { const p = v / tot; if (p > 0) H -= p * Math.log(p); });
  return { eff: Math.exp(H), distinct: e.length, top: 100 * Math.max(...e) / tot };
}
const B = effective(bars), R = effective(runs), G = effective(gaps);

console.log('         ' + SONGS + ' songs, ' + notes + ' lead notes, ' + melodicBars + ' melodic bars');
ok(B.eff > 100, 'bar rhythms: ' + B.distinct + ' distinct, effective vocabulary ' +
   B.eff.toFixed(1) + ' (was 54.2)');
ok(B.top < 12, 'no single bar rhythm dominates (' + B.top.toFixed(1) + '% at most)');
ok(R.eff > 45, 'four-note duration runs: effective vocabulary ' + R.eff.toFixed(1) + ' (was 26.8)');
ok(R.top < 30, 'and no single run shape dominates (' + R.top.toFixed(1) + '%)');
ok(100 * sssl / fourRuns < 11,
   'the reported short-short-short-LONG shape is ' + (100 * sssl / fourRuns).toFixed(1) +
   '% of runs (was 17.7)');
ok(100 * repeats / solidBars < 14,
   'consecutive bars repeat their rhythm ' + (100 * repeats / solidBars).toFixed(1) +
   '% of the time (was 16.3)');
// ...but NOT flattened into noise: a tune needs its common spacings
ok(G.eff > 5 && G.eff < 11,
   'note spacing stays musical rather than uniform-random (vocabulary ' + G.eff.toFixed(1) + ')');
ok(repeats > 0, 'and phrases still do repeat -- repetition is what makes a tune (' +
   (100 * repeats / solidBars).toFixed(1) + '%)');

console.log(fail ? '\nverify-rhythm: ' + fail + ' FAILED'
                 : '\nverify-rhythm: the station is not playing one rhythm');
process.exit(fail ? 1 : 0);
