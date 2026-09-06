#!/usr/bin/env node
'use strict';

// PREMISE CHARACTER: energy, density and motion are bounded composer dials
// applied BEFORE a note is written, and the natural-language layer wires moods
// and references into them. This holds the feature to what it claims:
//
//   * the unprompted station is untouched -- a neutral dial is no premise at
//     all, byte for byte, so the pinned score digests elsewhere cannot move;
//   * density and motion make OBJECTIVE, musical changes to the actual lead and
//     bass across genres and seeds, without ever moving the tempo the band and
//     tempo words already own (not metric gaming: real note counts and interval
//     reach from the generated events);
//   * a bare mood with no song reaches the composer as a premise, in a single
//     compile, and a spoken tempo lands in the RESULT, not just the parse;
//   * a reference is merged by dimension, an owned-but-zero axis is not
//     refilled, an explicit typed key/mode/tempo/genre wins (including the
//     "cheerful D minor" mode-override regression), and an existing-song change
//     keeps its document-transform behaviour.
//
// Deterministic throughout: explicit tokens, no minted randomness, no timers.

const crypto = require('crypto');
const C = require('../src/composer.js');
const api = require('../src/api.js');

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fail++; };

const TOKENS = Array.from({ length: 24 }, (_, i) => 'char-song-' + i);

function leadOf(s) {
  return (s.events || []).filter(e => e.ch === 'lead' && e.midi != null)
    .sort((a, b) => (a.tBeat || 0) - (b.tBeat || 0));
}
function leadReach(s) {
  const l = leadOf(s); let sum = 0, n = 0;
  for (let i = 1; i < l.length; i++) { sum += Math.abs(l[i].midi - l[i - 1].midi); n++; }
  return n ? sum / n : 0;
}
function bassCount(s) { return (s.events || []).filter(e => e.ch === 'bass').length; }

/* ------------------------------------------- a neutral dial is no premise at all */
console.log('the unprompted station is untouched');
{
  let same = 0, noTracker = 0;
  TOKENS.forEach(t => {
    const base = JSON.stringify(C.compile(t));
    if (base === JSON.stringify(C.compile(t, { energy: 0, density: 0, motion: 0 }))) same++;
    if (base === JSON.stringify(C.compile(t, {}))) same++;
    if (C.compile(t).tracker.premise === undefined) noTracker++;
  });
  ok(same === TOKENS.length * 2, 'a neutral or empty premise is byte-identical to no premise (' + same + '/' + (TOKENS.length * 2) + ')');
  ok(noTracker === TOKENS.length, 'and an unprompted score records no premise');
  const tp = C.compile('char-song-0', { styles: ['anthem'], mode: null, bpmMin: 0, bpmMax: 999 }).tracker.premise;
  ok(JSON.stringify(Object.keys(tp)) === JSON.stringify(['styles', 'mode', 'bpmMin', 'bpmMax']),
     'and a plain premise surfaces no energy/density/motion keys');
  const bare = crypto.createHash('sha256').update(Array.from({ length: 12 }, (_, i) => JSON.stringify(C.compile('smoke-song-' + i))).join('\n')).digest('hex');
  const dialed = crypto.createHash('sha256').update(Array.from({ length: 12 }, (_, i) => JSON.stringify(C.compile('smoke-song-' + i, { energy: 0, density: 0, motion: 0 }))).join('\n')).digest('hex');
  ok(bare === dialed, 'the pinned smoke seeds are identical with a zero dial (digest guard)');
  ok(JSON.stringify(C.compile('bounded-dials', { energy: Infinity, density: NaN, motion: 'wide' })) ===
     JSON.stringify(C.compile('bounded-dials')), 'non-finite or nonnumeric dials are neutral');
  ok(JSON.stringify(C.compile('bounded-dials', { energy: 99, density: -99, motion: 99 })) ===
     JSON.stringify(C.compile('bounded-dials', { energy: 1, density: -1, motion: 1 })), 'finite dials clamp to [-1, 1]');
}

/* ------------------------------- density and motion change the actual arrangement */
console.log('density and motion make objective lead/bass changes across genres');
{
  const GENRES = ['rock', 'anthem', 'techno', 'chill'];
  const SEEDS = Array.from({ length: 8 }, (_, i) => 'char-seed-' + i);
  let leadHi = 0, leadLo = 0, reachHi = 0, reachLo = 0, bassHi = 0, bassLo = 0, held = 0, n = 0;
  GENRES.forEach(g => SEEDS.forEach(seed => {
    const t = g + '-' + seed;
    const base = C.compile(t, { styles: [g] });
    const dHi = C.compile(t, { styles: [g], density: 0.9 });
    const dLo = C.compile(t, { styles: [g], density: -0.9 });
    const mHi = C.compile(t, { styles: [g], motion: 0.9 });
    const mLo = C.compile(t, { styles: [g], motion: -0.9 });
    leadHi += leadOf(dHi).length; leadLo += leadOf(dLo).length;
    bassHi += bassCount(dHi); bassLo += bassCount(dLo);
    reachHi += leadReach(mHi); reachLo += leadReach(mLo);
    if (dHi.bpm === base.bpm && dLo.bpm === base.bpm && mHi.bpm === base.bpm && mLo.bpm === base.bpm) held++;
    n++;
  }));
  ok(held === n, 'neither density nor motion moves the tempo across genres (' + held + '/' + n + ')');
  ok(leadHi > leadLo, 'dense writes more lead notes than sparse, summed over seeds and genres (' + leadHi + ' vs ' + leadLo + ')');
  ok(bassHi >= bassLo, 'and at least as many bass onsets (' + bassHi + ' vs ' + bassLo + ')');
  ok(reachHi > reachLo, 'high motion widens the average lead interval, low narrows it (' +
     reachHi.toFixed(1) + ' vs ' + reachLo.toFixed(1) + ' semitones)');
}

/* ------------------------------- a bare mood reaches the composer, once, as premise */
console.log('a bare mood with no song reaches the premise in a single compile');
{
  ['a calm song', 'a sparse song', 'a frantic song'].forEach(text => {
    const s = api.interpret(text).spec;
    ok(s.energy != null || s.density != null || s.motion != null,
       '"' + text + '" reaches a premise dial (' + JSON.stringify({ e: s.energy, d: s.density, m: s.motion }) + ')');
  });
  const compile = C.compile;
  let calls = [];
  C.compile = function (t, p) { calls.push(p); return compile.apply(this, arguments); };
  try {
    calls = [];
    const r = api.ask('a calm song', { brief: { token: 'calm-token' } });
    ok(r.ok, 'a bare mood composes');
    ok(calls.length === 1, 'and reaches the composer exactly once (' + calls.length + ')');
    ok(calls[0] && calls[0].energy < 0 && calls[0].density < 0 && calls[0].motion < 0,
       'with the calm premise actually applied before generation (' + JSON.stringify(calls[0]) + ')');
  } finally { C.compile = compile; }
  ok(api.ask('a frantic song', { brief: { token: 'frantic-token' } }).doc ===
     api.ask('a frantic song', { brief: { token: 'frantic-token' } }).doc,
     'the same request and token give the same song, byte for byte');
  const bt = api.ask('a frantic shmup stage, 150 bpm', { brief: { token: 'bpm-token' } });
  ok(bt.ok && api.describe(bt.doc).bpm === 150,
     'a spoken tempo lands in the RESULT, not just the parse (' + api.describe(bt.doc).bpm + ' bpm)');
}

/* ----------------------------------------- typed key/mode/tempo/genre win */
console.log('an explicit typed dial wins over a mood or a reference');
{
  const cm = api.ask('a cheerful song in D minor', { brief: { token: 'cheer-dmin' } });
  const a = api.analyse(cm.doc);
  ok(cm.ok && a.mode === 'minor' && a.key === 'D',
     'a cheerful song in D minor STAYS in D minor -- the mood no longer overrides the typed key (' + a.key + ' ' + a.mode + ')');
  const sCM = api.interpret('a cheerful song in D minor').spec;
  ok(sCM.mode === 'minor' && sCM.energy > 0,
     'and cheerful still lifts the energy premise, it just cannot flip the typed mode (energy ' + sCM.energy + ')');
  ok(api.analyse(api.ask('a cheerful song in C major', { brief: { token: 'cheer-cmaj' } }).doc).mode === 'major',
     'the same request in C major is major, so mode tracks what was typed');
  ok((api.interpret('a platformer like metroid').spec.styles || []).join(',') === 'arcade,anthem',
     'a typed genre beats the reference (platformer over metroidvania)');
}

/* ------------------------------- explicit edit of a song in hand, no recompile */
console.log('an explicit edit of a song in hand transposes in place, without recompiling');
{
  const doc0 = api.brief({ scene: 'town', token: 'exist-doc' }).doc;
  const before = api.toJSON(doc0);
  const compileFn = C.compile; let calls = [];
  C.compile = function (t, p) { calls.push(p); return compileFn.apply(this, arguments); };
  let mk;
  try { calls = []; mk = api.ask('make it cheerful in D minor', { doc: doc0, brief: { token: 'mk-dmin' } }); }
  finally { C.compile = compileFn; }
  const a = api.analyse(mk.doc), after = api.toJSON(mk.doc);
  ok(mk.kind === 'change', "'make it cheerful in D minor' with a song in hand is a CHANGE, not a regenerate");
  ok(calls.length === 0, 'and does not recompile (' + calls.length + ' compiles)');
  ok(a.key === 'D' && a.mode === 'minor', 'the document is transposed to D and recoloured minor (' + a.key + ' ' + a.mode + ')');
  const shape = j => j.notes.map(n => n.lane[0] + '@' + n.step + ':' + (n.drum || '')).sort().join(',');
  ok(shape(before) === shape(after), 'while the rhythm and arrangement -- lanes, onsets, drums -- are unchanged');
}

/* ------------------------------- a stronger mode overrides a reference mode */
console.log('a mood or opts.brief mode overrides a reference mode, consistently');
{
  const cc = api.ask('a cheerful song like castlevania', { brief: { token: 'editcheck' } });
  ok(cc.ok && api.analyse(cc.doc).mode === 'major',
     "'a cheerful song like castlevania' is MAJOR -- the mood's major is not overridden by the title's minor (" + api.analyse(cc.doc).mode + ')');
  ok(cc.understood.every(u => !/used for:.*\bminor\b/.test(u)),
     'and the read-back never claims the minor it did not apply');
  const bm = api.ask('like castlevania', { brief: { token: 'editcheck', mode: 'major' } });
  ok(bm.ok && api.analyse(bm.doc).mode === 'major',
     'an explicit opts.brief.mode wins over the reference mode (' + api.analyse(bm.doc).mode + ')');
  ok((bm.skipped || []).some(s => /gave way to your major/.test(s)),
     'and the override is reported as skipped, not silently dropped');
}

/* ------------------------------- a reference is merged per dimension */
console.log('a reference fills the axes a mood left open, per dimension');
{
  const sparse = api.interpret('a sparse song').spec;
  const castle = api.interpret('like castlevania').spec;
  const merged = api.interpret('a sparse song like castlevania').spec;
  ok(sparse.density === -0.5 && sparse.energy == null, "'a sparse song' owns only the density axis");
  ok(castle.energy > 0, "'like castlevania' fills energy from the reference (" + castle.energy + ')');
  ok(merged.density === sparse.density && merged.energy === castle.energy,
     'merged keeps the user density and fills energy from the reference, rather than discarding it');
  const owned = api.interpret('a bright dark song like castlevania').spec;
  ok(owned.energy == null && owned.energy !== castle.energy,
     'bright+dark cancel energy to zero, which is OWNED and the reference does not refill it');
}

/* ------------------------------- an existing-song change keeps its transform */
console.log('an existing-song change keeps document-transform behaviour');
{
  const base = api.brief({ scene: 'battle', seconds: 20, token: 'chg-base' });
  ok(api.analyse(base.doc).mode === 'minor', 'a battle cue starts minor');
  const hap = api.ask('make it happier', { doc: base.doc });
  ok(hap.kind === 'change' && hap.ok && api.analyse(hap.doc).mode === 'major',
     'and "make it happier" still flips it to major as a transform (keepMode holds for changes)');
  ok(api.ask('make it happier', { doc: base.doc }).doc === hap.doc, 'deterministically');
}

console.log('caller constraints survive every later mood/reference tempo operation');
{
  const prompts = ['a calm song', 'a cheerful song', 'a frantic song',
    'like castlevania', 'like metroid', 'a calm song, 100 bpm',
    'a cheerful song, much slower', 'like metroid, double time'];
  const compile = C.compile;
  for (const text of prompts) {
    let calls = 0;
    C.compile = function () { calls++; return compile.apply(this, arguments); };
    let r;
    try { r = api.ask(text, { brief: { token: 'caller-proof', mode: 'major', bpmMin: 150, bpmMax: 150 } }); }
    finally { C.compile = compile; }
    ok(api.describe(r.doc).bpm === 150 && api.analyse(r.doc).mode === 'major', text + ': caller 150 BPM/major survives');
    ok(calls === 1, text + ': exactly one composition, including style fallback');
    ok(!r.understood.some(s => /^tempo: 100/.test(s)), text + ': reading does not retain discarded tempo');
    const uses = r.reference && r.reference.uses || [];
    ok(!uses.some(u => u.kind === 'mode' || u.kind === 'tempo'), text + ': no superseded reference mode/range claimed');
  }
  for (const [text, band, accepts] of [
    ['like metroid', { bpmMin: 130 }, b => b >= 130],
    ['like castlevania', { bpmMax: 130 }, b => b <= 130]
  ]) {
    const r = api.ask(text, { brief: { token: 'half-band', ...band } });
    ok(accepts(api.describe(r.doc).bpm), 'a one-sided caller band does not inherit the reference\'s opposite bound');
    ok(!r.reference.uses.some(u => u.kind === 'tempo'), 'the replaced reference band is absent from the reading');
  }
  const caller = api.ask('like castlevania in D minor, 100 bpm', {
    brief: { token: 'all-overrides', styles: ['house'], key: 'F', mode: 'major', bpmMin: 120, bpmMax: 120,
      energy: 0, density: 0, motion: 0 }
  });
  ok(api.analyse(caller.doc).key === 'F' && api.analyse(caller.doc).mode === 'major' && api.describe(caller.doc).bpm === 120,
     'caller key/mode/tempo override the sentence in the actual document');
  ok(caller.understood.includes('mode: major') && caller.understood.includes('key: F') && caller.understood.includes('genre: house'),
     'visible reading reports the effective caller settings');
  ok(!caller.reference.uses.some(u => u.kind === 'styles' || u.kind === 'mode' || u.kind === 'tempo' || u.axes.length),
     'caller overrides, including explicit zero premise dials, remove reference attribution');
  ok(caller.applied.find(s => /^like /.test(s)) === caller.understood.find(s => /^like /.test(s)),
     'applied and understood reference readings agree');
}

console.log('partial reference hints are attributed by surviving dimension');
{
  const r = api.ask('a cheerful song like castlevania', { brief: { token: 'partial-proof' } });
  const menacing = r.reference.uses.find(u => u.text === 'menacing');
  ok(menacing && menacing.dimensions.includes('register:Bass') && !menacing.dimensions.includes('register:Melody') && !menacing.dimensions.includes('arc:Melody'),
     'cheerful owns melody register/contour; menacing contributes only its surviving axes');
  const line = r.understood.find(s => /^like /.test(s));
  ok(/menacing \(hints:/.test(line) && !/minor|145-172 bpm/.test(line), 'partial character is explicitly labelled; overridden mode/tempo are absent');
  const raw = api.interpret('like metroid, 150 bpm');
  ok(!raw.reference.uses.some(u => u.kind === 'tempo'), 'explicit sentence tempo blocks the reference band before it is claimed');
  const actual = api.ask('like metroid, 150 bpm', { brief: { token: 'spoken-proof' } });
  ok(api.describe(actual.doc).bpm === 150, 'the explicit sentence tempo also wins in the result');
}

console.log('caller precedence across the entire published reference vocabulary');
{
  const REF = require('../src/reference-styles');
  const bad = []; let count = 0;
  for (const title of REF.names()) for (const prefix of ['', 'a cheerful song ', 'a calm song ']) {
    const text = prefix + 'like ' + title, compile = C.compile; let calls = 0;
    C.compile = function () { calls++; return compile.apply(this, arguments); };
    try {
      const r = api.ask(text, { brief: { token: 'all-reference-pins', styles: ['house'], mode: 'major', bpmMin: 120, bpmMax: 120 } });
      if (api.describe(r.doc).bpm !== 120 || api.analyse(r.doc).mode !== 'major' || calls !== 1 ||
          r.reference.uses.some(u => ['styles', 'mode', 'tempo'].includes(u.kind))) bad.push(text);
      count++;
    } catch (e) { bad.push(text + ': ' + e.message); }
    finally { C.compile = compile; }
  }
  ok(!bad.length, count + ' reference/mood combinations preserve caller settings in one composition' + (bad.length ? ': ' + bad.slice(0, 3).join('; ') : ''));
}

console.log(fail ? '\nverify-composition-character: ' + fail + ' FAILED'
                 : '\nverify-composition-character: energy/density/motion steer real generation, typed dials win, defaults unchanged');
process.exit(fail ? 1 : 0);
