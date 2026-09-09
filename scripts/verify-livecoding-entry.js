#!/usr/bin/env node
'use strict';
// Explicit legacy compatibility actions, executed with a fake DOM.
// Canonical /create routing is covered by verify-unified-entry. The legacy
// editor offers one Compose action; the old livecoding action is API-only.
// No built artifact or browser layout claim; no build/network/audio side effects.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const language = require('../src/music-language.js');
const source = fs.readFileSync(path.join(__dirname, '../src/create.js'), 'utf8');
const actionAt = source.indexOf("else if (k === 'livecoding')");
const start = source.lastIndexOf("root.addEventListener('click', function (ev) {", actionAt);
const end = source.indexOf('\n    });', actionAt) + '\n    });'.length;
assert.ok(actionAt > 0 && start > 0 && end > actionAt, 'actual delegated click handler found');
const handlerSource = source.slice(start, end);
function fixture(useLiveScore = true) {
  let listener, builds = 0, opened = false, resolveOpen, rejectOpen;
  const pending = new Promise((resolve, reject) => { resolveOpen = resolve; rejectOpen = reject; });
  const classes = new Set(['show']);
  const calls = [], errors = [];
  const state = { bpm: 120, bars: 4, title: 'Existing song ♪', tempoAt: [[16, 128]], cells: [{ c: 0, r: 1 }] };
  const score = language.compile('song({totalFrames:240})\ninstruments([[128,240,255,0]])\nevent({ch:0,frame:3,frames:13,midi:60,inst:0,vel:1})\n').gb;
  assert.ok(score);
  const unexpectedAudio = () => { throw Error('Compose must not start or restart playback'); };
  const sandbox = { root: {
    addEventListener(type, fn) { assert.equal(type, 'click'); listener = fn; },
    classList: { remove(name) { classes.delete(name); } }
  },
    G: { CT_MUSIC_WORKSPACE: { open(...args) { calls.push(args); return pending; }, isOpen() { return opened; } },
      // Normalize VM metadata into the compiler realm, matching the browser's
      // single realm. The real materializer and compiler verify the round trip.
      CT_MUSIC_LANGUAGE: { materialize(gb, settings) { return language.materialize(gb, JSON.parse(JSON.stringify(settings))); } },
      Audio: { playScore: unexpectedAudio, musicPlay: unexpectedAudio },
      _toast(message) { errors.push(message); } },
    S: state, liveScore: useLiveScore ? score : null, spb: () => 16,
    startPlayback: unexpectedAudio, togglePlay: unexpectedAudio, armChip: unexpectedAudio,
    buildSong() { builds++; return score; },
  };
  vm.runInNewContext(handlerSource, sandbox, { filename: 'create.js:delegated-click-handler' });
  return { calls, errors, state, score, builds: () => builds,
    legacyVisible: () => classes.has('show'),
    async finish(visible = true) { opened = visible; resolveOpen(); await new Promise(setImmediate); },
    async reject() { rejectOpen(Error('Open failed')); await new Promise(setImmediate); },
    click(action) {
      const button = { dataset: { cr: action }, blur() {} };
      listener({ target: { closest(selector) { return selector === 'button' || selector === '[data-cr]' ? button : null; } } });
    } };
}
test('legacy editor exposes one Compose action without a second Live coding fork', () => {
  assert.match(source, /<button[^>]*data-cr="workspace"[^>]*>Compose<\/button>/);
  assert.equal((source.match(/data-cr="workspace"/g) || []).length, 1);
  assert.equal((source.match(/data-cr="livecoding"/g) || []).length, 0);
});
test('compatibility Live coding handler opens with no initial song and leaves legacy state untouched', async () => {
  const f = fixture(), before = JSON.stringify({ state: f.state, score: f.score });
  f.click('livecoding'); await f.finish();
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].length, 0);
  assert.equal(f.builds(), 0);
  assert.equal(JSON.stringify({ state: f.state, score: f.score }), before);
  assert.deepEqual(f.errors, []);
});
test('Compose imports the exact current song as protected source and hides legacy only after successful open', async () => {
  for (const useLiveScore of [true, false]) {
    const f = fixture(useLiveScore), before = JSON.stringify({ state: f.state, score: f.score });
    f.click('workspace');
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0].length, 1);
    const initial = f.calls[0][0], compiled = language.compile(initial.source);
    assert.equal(initial.explicit, true, 'current song cannot be replaced by a recovered workspace draft');
    assert.deepEqual(compiled.gb, f.score, 'all native score fields survive materialization');
    assert.deepEqual(compiled.settings, { tempo: 120, bars: 4, title: 'Existing song ♪', tempoAt: [[16, 128]], stepsPerBar: 16 });
    assert.equal(f.builds(), useLiveScore ? 0 : 1, 'reuse live score or materialize the edited legacy song once');
    assert.equal(f.legacyVisible(), true, 'pending open keeps the legacy editor available');
    await f.finish();
    assert.equal(f.legacyVisible(), false, 'successful workspace replaces the legacy surface');
    assert.equal(JSON.stringify({ state: f.state, score: f.score }), before);
    assert.deepEqual(f.errors, []);
  }
});
test('failed workspace open is surfaced without altering the legacy document', async () => {
  const f = fixture(), before = JSON.stringify(f.state);
  f.click('workspace'); await f.reject();
  assert.deepEqual(f.errors, ['Open failed']);
  assert.equal(JSON.stringify(f.state), before); assert.equal(f.builds(), 0);
  assert.equal(f.legacyVisible(), true, 'failed open never strands the user behind a hidden editor');
});
test('superseded workspace open that resolves without opening retains the legacy surface', async () => {
  const f = fixture(); f.click('workspace'); await f.finish(false);
  assert.equal(f.legacyVisible(), true);
  assert.deepEqual(f.errors, []);
});
