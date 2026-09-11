'use strict';
// Pure, independent acceptance fixtures for docs/music-cycle-v1.md.
// Run directly with Node; no build, browser, audio device or external service.
// Pending cycle support is a failing compile check, never a silent pass.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const E = require('../src/music-cycle-examples.js');
const L = require('../src/music-language.js');
const H = require('../src/gb-hardware.js');

let passed = 0, failed = 0, skipped = 0;
const compiled = new Map();
function test(name, fn, dependencies = []) {
  const missing = dependencies.filter(id => !compiled.has(id));
  if (missing.length) {
    skipped++;
    console.log('skip ' + name + ' (compile required: ' + missing.join(', ') + ')');
    return;
  }
  try {
    fn();
    passed++;
    console.log('ok ' + name);
  } catch (error) {
    failed++;
    console.error('FAIL ' + name + '\n  ' + error.message);
  }
}

const ids = [
  'noise-groove', 'subdivided-bass', 'alternating-melody', 'periodic-reverse',
  'euclidean-drums', 'rest-breakdown', 'restore-arrangement'
];
const modulePath = path.join(__dirname, '../src/music-cycle-examples.js');
const moduleSource = fs.readFileSync(modulePath, 'utf8');

function frozenTree(value) {
  if (value === null || typeof value !== 'object') return;
  assert.ok(Object.isFrozen(value), 'every exported object must be frozen');
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    assert.ok('value' in descriptor, 'exports contain data, not accessors');
    frozenTree(descriptor.value);
  }
}

function immutable(api) {
  frozenTree(api);
  const before = JSON.stringify(api);
  // Array methods loaded in the VM throw that realm's TypeError prototype.
  const typeError = { name: 'TypeError' };
  assert.throws(() => { api.steps = []; }, typeError);
  assert.throws(() => { api.steps.push(api.steps[0]); }, typeError);
  assert.throws(() => { api.steps[0] = {}; }, typeError);
  for (const step of api.steps) {
    for (const key of ['id', 'title', 'description', 'source']) {
      assert.throws(() => { step[key] = 'changed'; }, typeError);
      assert.throws(() => { delete step[key]; }, typeError);
    }
    assert.throws(() => { step.extra = true; }, typeError);
  }
  assert.equal(JSON.stringify(api), before);
}

function isolatedModule(commonjs) {
  const sandbox = {};
  // Throw even on reads, including typeof, to expose ambient dependencies.
  for (const name of [
    'document', 'window', 'navigator', 'location', 'localStorage', 'sessionStorage',
    'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'Date', 'performance',
    'setTimeout', 'setInterval', 'requestAnimationFrame', 'crypto', 'process', 'require'
  ]) {
    Object.defineProperty(sandbox, name, {
      get() { throw new Error('Examples must not access ' + name); }
    });
  }
  const context = vm.createContext(sandbox);
  vm.runInContext(`Object.defineProperty(Math, 'random', {
    get() { throw new Error('Examples must not access Math.random'); }
  })`, context);
  if (commonjs) context.module = { exports: {} };
  vm.runInContext(moduleSource, context, { filename: modulePath });
  const api = context.CT_MUSIC_CYCLE_EXAMPLES;
  if (commonjs) assert.equal(context.module.exports, api);
  assert.deepEqual(Object.keys(context).sort(), commonjs
    ? ['CT_MUSIC_CYCLE_EXAMPLES', 'module'] : ['CT_MUSIC_CYCLE_EXAMPLES']);
  return api;
}

test('seven ordered examples have unique IDs and plain readable source records', () => {
  assert.equal(globalThis.CT_MUSIC_CYCLE_EXAMPLES, E);
  assert.deepEqual(Object.keys(E), ['steps']);
  assert.equal(E.steps.length, 7);
  assert.deepEqual(E.steps.map(step => step.id), ids);
  assert.equal(new Set(E.steps.map(step => step.id)).size, 7);
  for (const [index, step] of E.steps.entries()) {
    assert.deepEqual(Object.keys(step).sort(), ['description', 'id', 'source', 'title']);
    for (const value of Object.values(step)) assert.ok(typeof value === 'string' && value.trim().length);
    assert.match(step.id, /^[a-z]+(?:-[a-z]+)*$/);
    assert.ok(step.source.length < 1000, 'each scene stays readable');
    assert.equal(step.source.split('\n')[0], 'song({tempo:132,bars:8})');
    const names = Array.from(step.source.matchAll(/^pattern\("([a-z]+)",cycleV1\(/gm), m => m[1]);
    const plays = Array.from(step.source.matchAll(/^track\("([a-z]+)"\)\.instrument\("([a-z0-9-]+)"\)\.play\("([a-z]+)",\{repeat:8\}\)$/gm));
    const lanes = [
      ['drums', 'n-tick', 'beat'], ['bass', 'wave-bass', 'bass'], ['lead', 'p0', 'lead']
    ].slice(0, Math.min(index + 1, 3));
    assert.deepEqual(plays.map(match => match.slice(1)), lanes);
    assert.deepEqual(names, lanes.map(lane => lane[2]));
  }
});

test('CommonJS exports are deeply immutable', () => immutable(E));
test('isolated browser and CommonJS exports match without DOM, network, time or randomness', () => {
  for (const commonjs of [false, true]) {
    const api = isolatedModule(commonjs);
    assert.deepEqual(JSON.parse(JSON.stringify(api)), E);
    immutable(api);
  }
});
test('restoration source equals step 5 exactly', () => {
  assert.equal(E.steps[6].source, E.steps[4].source);
  assert.notEqual(E.steps[5].source, E.steps[4].source);
});

// Handwritten beat tables, not parsed source or transformed compiler output.
// Tuples are [onset within the four-beat bar, ungated length in beats, MIDI].
const quarterTicks = [[0, 1, 36], [1, 1, 36], [2, 1, 36], [3, 1, 36]];
const subdividedBass = [[0, 1, 36], [1, 0.5, 40], [1.5, 0.5, 43], [3, 1, 43]];
const euclideanTicks = [[0, 0.5, 36], [1.5, 0.5, 36], [3, 0.5, 36]];
const breakdownBass = [[0, 1, 36], [3, 1, 43]];
function forwardLead(cycle) {
  return [[0, 1, cycle % 2 === 0 ? 60 : 64], [1, 0.5, 67], [1.5, 0.5, 71], [2, 1, 64]];
}
// Only odd cycles 3 and 7 reverse in this performance. Reflect the ungated
// slots first, including the final rest; gate then shortens each new interval.
const reversedLead = [[1, 1, 64], [2, 0.5, 71], [2.5, 0.5, 67], [3, 1, 64]];
function sparseLead(cycle) {
  return cycle === 3 || cycle === 7
    ? [[2.5, 0.5, 67], [3, 1, 64]]
    : [[0, 1, cycle % 2 === 0 ? 60 : 64], [1, 0.5, 67]];
}

const tempo = 132, bars = 8;
const frameAt = beat => H.beatToFrame(beat, tempo);
const totalFrames = frameAt(bars * 4);
const bank = H.buildBank([]);
function instrument(authored) {
  const matches = bank.meta.filter(meta => meta.patch.authored === authored);
  assert.equal(matches.length, 1, 'stock voice ' + authored);
  return matches[0].index;
}
const voices = {
  drums: { ch: 3, inst: instrument('n-tick'), gate: 0.15 },
  bass: { ch: 2, inst: instrument('w-triangle'), gate: 0.65 },
  lead: { ch: 0, inst: instrument('p0'), gate: 0.55 }
};

function expectedLane(lane, cycle, rows) {
  const { ch, inst, gate } = voices[lane];
  return rows.map(([offset, length, midi]) => {
    const beat = cycle * 4 + offset, frame = frameAt(beat);
    // Round both ABSOLUTE positions, not a duration or an accumulated bar.
    return { ch, inst, frame, frames: Math.max(1, frameAt(beat + length * gate) - frame), midi, vel: 1 };
  });
}
function expectedScene(index) {
  const notes = [];
  for (let cycle = 0; cycle < bars; cycle++) {
    const breakdown = index === 5;
    const drums = breakdown ? [[0, 1, 36]] : index >= 4 ? euclideanTicks : quarterTicks;
    notes.push(...expectedLane('drums', cycle, drums));
    if (index >= 1) notes.push(...expectedLane('bass', cycle, breakdown ? breakdownBass : subdividedBass));
    if (index >= 2) {
      const lead = breakdown ? sparseLead(cycle)
        : index >= 3 && (cycle === 3 || cycle === 7) ? reversedLead : forwardLead(cycle);
      notes.push(...expectedLane('lead', cycle, lead));
    }
  }
  return notes;
}
function ordered(notes) {
  return notes.slice().sort((a, b) => a.ch - b.ch || a.frame - b.frame || a.midi - b.midi);
}
function laneNotes(result, ch, cycle) {
  return ordered(result.gb.notes.filter(note => note.ch === ch && (cycle === undefined ||
    note.frame >= frameAt(cycle * 4) && note.frame < frameAt((cycle + 1) * 4))));
}
function valid(source) {
  const result = L.compile(source);
  assert.ok(result.gb, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.diagnostics, [], 'examples must compile without warnings');
  return result;
}

for (const [index, step] of E.steps.entries()) {
  test('compile ' + step.id, () => {
    const result = valid(step.source);
    assert.deepEqual(L.compile(step.source), result, 'repeat compilation is deterministic');
    compiled.set(step.id, result);
  });
  test('independent beats, pitches, gates and complete eight-bar clock: ' + step.id, () => {
    const result = compiled.get(step.id), gb = result.gb;
    assert.deepEqual(result.settings, { tempo, bars });
    assert.equal(gb.totalFrames, totalFrames);
    assert.equal(gb.loopFrames, totalFrames);
    assert.deepEqual(gb.bank, bank);
    assert.equal(gb.notes.length, [32, 64, 96, 96, 88, 40, 88][index]);
    assert.deepEqual(ordered(gb.notes), ordered(expectedScene(index)));
    for (let cycle = 0; cycle < bars; cycle++) {
      const inBar = gb.notes.filter(note => note.frame >= frameAt(cycle * 4) && note.frame < frameAt((cycle + 1) * 4));
      assert.ok(inBar.length, 'each of the eight bars has real onsets');
      assert.ok(inBar.every(note => note.frame + note.frames <= frameAt((cycle + 1) * 4)), 'short gates stay inside their bar');
    }
    const lastEnd = Math.max(...gb.notes.map(note => note.frame + note.frames));
    assert.ok(lastEnd <= totalFrames);
    assert.ok(totalFrames - lastEnd <= frameAt(1) + 1, 'no more than one beat of trailing silence');
  }, [step.id]);
  test('exact materialized GB round trip: ' + step.id, () => {
    const result = compiled.get(step.id);
    const source = L.materialize(result.gb, result.settings);
    const back = valid(source);
    assert.deepEqual(back.gb, result.gb);
    assert.deepEqual(back.settings, result.settings);
    assert.equal(L.materialize(back.gb, back.settings), source);
  }, [step.id]);
}

test('reversal changes only melody cycles 3 and 7 relative to the preceding scene', () => {
  const before = compiled.get('alternating-melody'), after = compiled.get('periodic-reverse');
  assert.deepEqual(laneNotes(after, 2), laneNotes(before, 2), 'bass is unaffected');
  assert.deepEqual(laneNotes(after, 3), laneNotes(before, 3), 'drums are unaffected');
  for (let cycle = 0; cycle < bars; cycle++) {
    const previous = laneNotes(before, 0, cycle), current = laneNotes(after, 0, cycle);
    assert.deepEqual(previous, ordered(expectedLane('lead', cycle, forwardLead(cycle))));
    if (cycle === 3 || cycle === 7) {
      assert.notDeepEqual(current, previous, 'reversal must be audible at cycle ' + cycle);
      assert.deepEqual(current, ordered(expectedLane('lead', cycle, reversedLead)));
    } else assert.deepEqual(current, previous, 'unchanged melody at cycle ' + cycle);
  }
}, ['alternating-melody', 'periodic-reverse']);

test('C2(3,8) hits at 0, 3/8 and 6/8 of every bar without changing bass or melody', () => {
  const before = compiled.get('periodic-reverse'), after = compiled.get('euclidean-drums');
  for (const ch of [0, 2]) assert.deepEqual(laneNotes(after, ch), laneNotes(before, ch));
  for (let cycle = 0; cycle < bars; cycle++) {
    const positions = [0, 3 / 8, 6 / 8].map(position => frameAt((cycle + position) * 4));
    assert.deepEqual(laneNotes(after, 3, cycle).map(note => note.frame), positions);
  }
}, ['periodic-reverse', 'euclidean-drums']);

test('breakdown removes events in every voice while retaining a real melody each bar', () => {
  const full = compiled.get('euclidean-drums'), breakdown = compiled.get('rest-breakdown');
  assert.ok(breakdown.gb.notes.length < full.gb.notes.length);
  for (const ch of [0, 2, 3]) assert.ok(laneNotes(breakdown, ch).length < laneNotes(full, ch).length);
  for (let cycle = 0; cycle < bars; cycle++) {
    const remaining = laneNotes(breakdown, 0, cycle), previous = laneNotes(full, 0, cycle);
    assert.equal(remaining.length, 2);
    assert.equal(new Set(remaining.map(note => note.midi)).size, 2, 'two real pitches survive in every bar');
    for (const note of remaining) {
      assert.ok(note.vel > 0 && note.frames > 0);
      assert.ok(previous.some(candidate => JSON.stringify(candidate) === JSON.stringify(note)), 'melody notes actually survive from the full scene');
    }
  }
}, ['euclidean-drums', 'rest-breakdown']);

test('restoration reproduces the full compiled arrangement', () => {
  assert.deepEqual(compiled.get('restore-arrangement'), compiled.get('euclidean-drums'));
}, ['euclidean-drums', 'restore-arrangement']);

test('short actual APU PCM matches independent notes and exact materialization', () => {
  const A = require('../src/gb-apu.js');
  const sampleRate = 8000;
  // Four bars include alternation and cycle 3's reversal, about 7.3 seconds.
  // Sequencer avoids render()'s optional 30-frame tail and any audio device.
  const samples = Math.ceil(H.frameToSec(frameAt(16)) * sampleRate);
  function pcm(gb) {
    const out = new Float32Array(samples);
    new A.Sequencer(gb, sampleRate).render(out, 0, out.length);
    return out;
  }
  for (const index of [4, 5]) {
    const result = compiled.get(ids[index]);
    const actual = pcm(result.gb);
    const expected = pcm({ notes: expectedScene(index), bank, totalFrames, loopFrames: totalFrames });
    const roundTrip = pcm(valid(L.materialize(result.gb, result.settings)).gb);
    assert.ok(actual.every(Number.isFinite));
    assert.ok(actual.some(sample => sample !== 0), 'actual chip output must be audible');
    assert.deepEqual(actual, expected, 'PCM agrees with the independently timed score');
    assert.deepEqual(actual, roundTrip, 'materialization preserves every PCM sample');
  }
}, ['euclidean-drums', 'rest-breakdown']);

test("the contract document's own authoring example compiles", () => {
  // docs/music-cycle-v1.md is the spec this file implements, and nothing else
  // reads it. Extract its ```music fence and compile it, so the doc cannot
  // drift into describing notation the compiler does not accept.
  const doc = fs.readFileSync(path.join(__dirname, '../docs/music-cycle-v1.md'), 'utf8');
  const fences = [...doc.matchAll(/```music\n([\s\S]*?)\n```/g)].map(m => m[1]);
  assert.equal(fences.length, 1, 'expected exactly one music fence in the contract');
  const result = valid(fences[0]);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.gb.notes.length, 88);
  // Every constructor the fence advertises is exercised by it.
  for (const feature of ['cycleV1(', '[', '<', '~', '(3,8)', '.every(', '.gate('])
    assert.ok(fences[0].includes(feature), feature);
});

console.log('verify-music-cycle-examples: ' + passed + ' passed, ' + failed + ' failed, ' + skipped + ' skipped');
if (failed || skipped) process.exitCode = 1;
