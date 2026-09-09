#!/usr/bin/env node
'use strict';
// Targeted source + actual delegated-handler execution with a fake DOM.
// No built artifact or browser layout claim; no build/network/audio side effects.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../src/create.js'), 'utf8');
const actionAt = source.indexOf("else if (k === 'livecoding')");
const start = source.lastIndexOf("root.addEventListener('click', function (ev) {", actionAt);
const end = source.indexOf('\n    });', actionAt) + '\n    });'.length;
assert.ok(actionAt > 0 && start > 0 && end > actionAt, 'actual delegated click handler found');
const handlerSource = source.slice(start, end);
function fixture(reject = false) {
  let listener, builds = 0;
  const calls = [], errors = [];
  const state = { bpm: 120, bars: 4, title: 'Existing song', tempoAt: [], cells: [{ c: 0, r: 1 }] };
  const score = { notes: [{ frame: 0, midi: 60 }] };
  const sandbox = { root: { addEventListener(type, fn) { assert.equal(type, 'click'); listener = fn; } },
    G: { CT_MUSIC_WORKSPACE: { open(...args) { calls.push(args); return reject ? Promise.reject(Error('Open failed')) : Promise.resolve(); } },
      _toast(message) { errors.push(message); } },
    S: state, liveScore: score, spb: () => 16,
    buildSong() { builds++; return score; },
  };
  vm.runInNewContext(handlerSource, sandbox, { filename: 'create.js:delegated-click-handler' });
  return { calls, errors, state, score, builds: () => builds,
    click(action) {
      const button = { dataset: { cr: action }, blur() {} };
      listener({ target: { closest(selector) { return selector === 'button' || selector === '[data-cr]' ? button : null; } } });
    } };
}
test('Live coding is a visible text button first in the top utility toolbar; existing entry remains', () => {
  assert.match(source, /'<div class="n-utils">' \+\s*'<button type="button" class="cr-btn" data-cr="livecoding"[^>]*>Live coding<\/button>/);
  assert.equal((source.match(/data-cr="livecoding"/g) || []).length, 1);
  assert.match(source, /data-cr="workspace">Chat \/ Code \/ Notes<\/button>/);
});
test('actual Live coding handler opens with no initial song and leaves legacy state untouched', async () => {
  const f = fixture(), before = JSON.stringify({ state: f.state, score: f.score });
  f.click('livecoding'); await Promise.resolve();
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].length, 0);
  assert.equal(f.builds(), 0);
  assert.equal(JSON.stringify({ state: f.state, score: f.score }), before);
  assert.deepEqual(f.errors, []);
});
test('existing Chat / Code / Notes handler still supplies current-song fallback and settings', async () => {
  const f = fixture(); f.click('workspace'); await Promise.resolve();
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].length, 1);
  const initial = f.calls[0][0];
  assert.equal(initial.gb, f.score);
  assert.deepEqual(JSON.parse(JSON.stringify(initial.settings)), { tempo: 120, bars: 4, title: 'Existing song', tempoAt: [], grid: 16 });
});
test('failed workspace open is surfaced without altering the legacy document', async () => {
  const f = fixture(true), before = JSON.stringify(f.state);
  f.click('livecoding'); await Promise.resolve();
  assert.deepEqual(f.errors, ['Open failed']);
  assert.equal(JSON.stringify(f.state), before); assert.equal(f.builds(), 0);
});
