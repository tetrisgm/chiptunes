#!/usr/bin/env node
'use strict';
// Source-loaded Chromium acceptance. In-memory UI bundles only: no shared dist
// writes, provider requests, real audio or native Safari interaction claims.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..'), origin = 'https://chiptunes.app';
const names = ['gb-hardware.js', 'gb-kits.js', 'music-language.js', 'music-project.js', 'music-chat.js',
  'music-preview.js', 'music-preview-worker.js', 'music-chart-index.js', 'music-workspace.js', 'music-workspace.css', 'music-chat-ui.css'];
const source = Object.fromEntries(names.map(name => [name, fs.readFileSync(path.join(root, 'src', name), 'utf8')]));
const sourceId = crypto.createHash('sha256').update(names.map(name => source[name]).join('\n')).digest('hex').slice(0, 12);
const bundle = (entry, globalName) => esbuild.buildSync({ absWorkingDir: root, entryPoints: ['src/' + entry],
  bundle: true, write: false, format: 'iife', globalName, define: { 'process.env.NODE_ENV': '"production"' } }).outputFiles[0].text;
// Editor installs its own window global; unlike the exported chat mount, an
// esbuild globalName would overwrite that API with the empty module result.
const editorBundle = bundle('music-code-editor.mjs');
const chatBundle = bundle('music-chat-ui.jsx', 'CT_MUSIC_CHAT_UI');
const near = (actual, expected, message, tolerance = 1) => assert(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected}`);
const cases = [];
const test = (name, run) => cases.push({ name, run });

async function boot(browser, initial) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.setDefaultTimeout(12000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.context().setOffline(true);
  await page.context().route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === '/create') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
    const name = path.basename(url.pathname);
    if (url.pathname.startsWith('/lib/') && ['music-preview-worker.js', 'gb-hardware.js', 'gb-kits.js', 'music-language.js'].includes(name))
      return route.fulfill({ contentType: 'text/javascript', body: source[name] });
    return route.abort();
  });
  await page.goto(origin + '/create');
  for (const name of names.filter(name => name.endsWith('.js') && !['music-workspace.js', 'music-preview-worker.js'].includes(name)))
    await page.addScriptTag({ content: source[name] });
  await page.addScriptTag({ content: editorBundle }); await page.addScriptTag({ content: chatBundle });
  await page.evaluate(() => {
    window.fixture = { audio: [], requests: 0, callback: null, last: null };
    window.Audio = {
      musicStop() { fixture.audio.push('stop'); }, enterCreate() { fixture.audio.push('enter'); },
      onMusicState(callback) { fixture.callback = callback; return () => { fixture.callback = null; }; },
      musicPlay(gb, options) { fixture.audio.push('play'); fixture.last = { gb, options }; return { ok: true }; },
      musicQueue() { fixture.audio.push('queue'); throw Error('Chart must not queue audio'); },
      musicSeek() { fixture.audio.push('seek'); throw Error('Chart must not seek audio'); },
      musicPause() { fixture.audio.push('pause'); throw Error('Chart must not pause audio'); }
    };
    window.CT_CREATE = {};
    window.fetch = async url => {
      if (url === '/api/music/chat/access') return new Response(JSON.stringify({ ok: true, authenticated: false,
        providers: [{ id: 'openai', label: 'OpenAI' }], limits: { dailyCalls: 20 } }));
      fixture.requests++; throw Error('Unexpected fixture network request');
    };
  });
  await page.addScriptTag({ content: source['music-workspace.js'] });
  for (const name of ['music-workspace.css', 'music-chat-ui.css']) await page.addStyleTag({ content: source[name] });
  await page.evaluate(initial => initial ? CT_MUSIC_WORKSPACE.open({ source: initial, explicit: true }) : CT_MUSIC_WORKSPACE.open(), initial);
  await page.waitForSelector('.cm-content');
  return { page, errors, snapshot: () => page.evaluate(() => CT_MUSIC_WORKSPACE.snapshot()) };
}
async function geometry(page) {
  return page.locator('.mw-notes').evaluate(pane => {
    const inner = pane.firstElementChild.getBoundingClientRect();
    return {
      notes: [...pane.querySelectorAll('.mw-note')].map(note => {
        const rect = note.getBoundingClientRect(), lane = note.closest('.mw-lane').getBoundingClientRect();
        return { index: Number(note.dataset.note), pitch: Number(note.dataset.pitch), instrument: Number(note.dataset.instrument),
          ch: Number(note.closest('.mw-lane').dataset.channel), x: rect.x - inner.x, y: rect.y - lane.y,
          width: rect.width, height: rect.height, label: note.getAttribute('aria-label'), text: note.textContent };
      }),
      rows: [...pane.querySelectorAll('.mw-pitch-row')].map(row => {
        const rect = row.getBoundingClientRect(), lane = row.closest('.mw-lane').getBoundingClientRect();
        return { ch: Number(row.closest('.mw-lane').dataset.channel), pitch: row.dataset.pitch == null ? null : Number(row.dataset.pitch),
          y: rect.y - lane.y, height: rect.height, text: row.textContent };
      }),
      grids: [...pane.querySelectorAll('.mw-time-grid')].map(line => ({ frame: Number(line.dataset.frame),
        strength: line.dataset.strength, x: line.getBoundingClientRect().x - inner.x }))
    };
  });
}
const chartState = page => page.evaluate(() => {
  const s = CT_MUSIC_WORKSPACE.snapshot();
  return { draft: s.draft, validated: s.validated.id, playing: s.playing, pending: s.pending,
    scope: CT_MUSIC_WORKSPACE.agentContext().policy.selection, audio: fixture.audio.slice() };
});
async function acknowledge(page, frame) {
  await page.locator('[data-action=play]').click();
  await page.waitForFunction(() => fixture.last);
  assert.equal(await page.evaluate(() => CT_MUSIC_WORKSPACE.snapshot().playing), null, 'Play requires an acknowledgement');
  await page.evaluate(frame => fixture.callback({ status: 'playing', reason: 'activate', revision: fixture.last.options.revision, frame }), frame);
}

test('true semitone rows, twelve-row octaves, wide-register separation and exact labels', async browser => {
  const pitches = [36, 60, 61, 72, 96];
  const text = 'song({tempo:120,bars:2})\n' + pitches.map((midi, i) => `event({ch:0,frame:${i * 30},frames:24,midi:${midi},inst:0,vel:1})`).join('\n');
  const f = await boot(browser, text);
  try {
    const g = await geometry(f.page), rows = g.rows.filter(row => row.ch === 0), notes = g.notes;
    assert.equal(notes.length, pitches.length);
    for (const note of notes) {
      const row = rows.find(row => row.pitch === note.pitch); assert(row);
      assert(note.y >= row.y && note.y + note.height <= row.y + row.height + 1, 'note is contained in its semitone row');
      assert.equal(note.label, `Melody note ${note.pitch} frame ${note.index * 30} length 24`);
    }
    const at = pitch => notes.find(note => note.pitch === pitch), step = rows[0].height;
    near(at(60).y - at(61).y, step, 'one semitone moves one row');
    near(at(60).y - at(72).y, 12 * step, 'an octave moves twelve rows');
    near(at(36).y - at(96).y, 60 * step, 'distant pitches never clamp into the same row');
    assert.equal(rows.find(row => row.pitch === 60).text, 'C4');
    assert.equal(rows.find(row => row.pitch === 61).text, 'C♯4');
    assert.deepEqual(f.errors, []);
  } finally { await f.page.close(); }
});

test('percussion rows use instrument identity and ignore MIDI pitch', async browser => {
  const f = await boot(browser, `song({tempo:120,bars:2})
pattern("ticks",notes("C2 C5 . .").stepsPerBar(4))
pattern("hats",notes("C2 . . .").stepsPerBar(4))
track("drums").instrument("n-tick").play("ticks")
track("drums").instrument("n-hat").play("hats",{atBar:1})`);
  try {
    const g = await geometry(f.page), notes = g.notes.filter(n => n.ch === 3), rows = g.rows.filter(r => r.ch === 3);
    assert.equal(notes.length, 3); assert.equal(rows.length, 2);
    assert(rows.every(row => row.pitch === null), 'percussion labels are not piano pitches');
    assert.equal(notes[0].instrument, notes[1].instrument); assert.notEqual(notes[0].pitch, notes[1].pitch);
    near(notes[0].y, notes[1].y, 'different MIDI notes on one instrument share a row');
    assert.equal(notes[0].pitch, notes[2].pitch); assert.notEqual(notes[0].instrument, notes[2].instrument);
    assert(Math.abs(notes[0].y - notes[2].y) >= rows[0].height, 'same MIDI pitch on different instruments occupies distinct rows');
    assert.equal(notes[0].text, notes[1].text); assert.notEqual(notes[0].text, notes[2].text);
    assert(rows.every(row => notes.some(note => note.text === row.text)), 'instrument names appear in row labels and notes');
    assert.deepEqual(f.errors, []);
  } finally { await f.page.close(); }
});

test('full lengths, gate tails and explicit rests leave proportional time gaps', async browser => {
  const f = await boot(browser, `song({tempo:120,bars:2})
pattern("full",notes("C4:2 . D4 . . . .").stepsPerBar(4).gate(1))
pattern("gated",notes("C4:2 . D4 . . . .").stepsPerBar(4).gate(0.5))
track("lead").instrument("p0").play("full")
track("pad").instrument("p1").play("gated")`);
  try {
    const compiled = (await f.snapshot()).validated.compiled, g = await geometry(f.page);
    const full = g.notes.filter(n => n.ch === 0), gated = g.notes.filter(n => n.ch === 1);
    assert.equal(full.length, 2); assert.equal(gated.length, 2, 'rests never render as sounding notes');
    const notes = compiled.gb.notes, scale = (full[1].x - full[0].x) / (notes[full[1].index].frame - notes[full[0].index].frame);
    for (const note of g.notes) near(note.width, notes[note.index].frames * scale, 'note width follows complete compiled duration');
    near(full[0].width, 2 * gated[0].width, 'half gate halves held duration', 2);
    near(full[1].x, gated[1].x, 'gate never moves the next onset');
    assert(full[1].x > full[0].x + full[0].width, 'explicit rest leaves a visible gap');
    assert(gated[1].x - gated[0].x - gated[0].width > full[1].x - full[0].x - full[0].width, 'gating adds silence before the existing rest');
    const end = compiled.gb.totalFrames;
    assert(end > notes.at(-1).frame + notes.at(-1).frames, 'trailing rests retain the finite song extent');
    assert.deepEqual(f.errors, []);
  } finally { await f.page.close(); }
});

test('tempo-map beats and subdivisions align with frame geometry across the tempo change', async browser => {
  const f = await boot(browser, `song({tempo:120,bars:2,stepsPerBar:16,tempoAt:[[16,60]]})
pattern("clock",notes("C4 C4 C4 C4 C4 C4 C4 C4").stepsPerBar(4).gate(0.5))
track("lead").instrument("p0").play("clock")`);
  try {
    const g = await geometry(f.page), compiled = (await f.snapshot()).validated.compiled;
    const beats = await f.page.evaluate(() => {
      const clock = CT_MUSIC_LANGUAGE.createClock(CT_MUSIC_WORKSPACE.snapshot().validated.compiled.settings);
      return Array.from({ length: 9 }, (_, i) => clock(i));
    });
    assert(beats[5] - beats[4] > (beats[1] - beats[0]) * 1.8, 'fixture actually slows at the second bar');
    const first = g.notes.find(n => n.index === 0), second = g.notes.find(n => n.index === 1);
    const scale = (second.x - first.x) / (beats[1] - beats[0]);
    for (let i = 0; i < 8; i++) {
      assert.equal(compiled.gb.notes[i].frame, beats[i]);
      const note = g.notes.find(n => n.index === i), grid = g.grids.find(line => line.frame === beats[i]);
      assert(grid, 'every beat has a grid boundary');
      near(grid.x, first.x + beats[i] * scale, 'grid follows the tempo-mapped clock');
      near(note.x, grid.x, 'note onsets align with beat grid');
      assert.equal(grid.strength, i % 4 === 0 ? 'bar' : 'beat');
    }
    for (const grid of g.grids) near(grid.x, first.x + grid.frame * scale, 'all visible subdivisions use the same frame scale');
    assert.deepEqual(f.errors, []);
  } finally { await f.page.close(); }
});

test('overview pointer/Enter zoom preserves source, revision, selection and acknowledged audio', async browser => {
  const f = await boot(browser, `song({tempo:120,bars:16})
pattern("walk",notes("C4 D4 E4 F4").stepsPerBar(4).gate(0.8))
track("lead").instrument("p0").play("walk",{repeat:16})`);
  try {
    const s = await f.snapshot(), frame = s.validated.compiled.gb.notes[25].frame + 1;
    await acknowledge(f.page, frame);
    await f.page.locator('.mw-note').first().click();
    const before = await chartState(f.page), overview = f.page.locator('.mw-overview');
    const box = await overview.boundingBox();
    await overview.click({ position: { x: box.width * 0.7, y: box.height / 2 } });
    const range = () => f.page.locator('.mw-playhead').evaluate(el => ({ from: Number(el.dataset.rangeStart), to: Number(el.dataset.rangeEnd) }));
    const clicked = await range(), total = s.validated.compiled.gb.totalFrames;
    assert(clicked.from <= total * 0.7 && clicked.to > total * 0.7, 'pointer location selects its time region');
    assert(clicked.to - clicked.from < total);
    assert.deepEqual(await chartState(f.page), before, 'pointer zoom mutates presentation only');
    await f.page.locator('.mw-chart-reset').click();
    await overview.focus(); await overview.press('Enter');
    const keyboard = await range();
    assert(keyboard.from <= frame && keyboard.to > frame, 'Enter zooms around acknowledged playback');
    assert(keyboard.to - keyboard.from < total);
    assert.deepEqual(await chartState(f.page), before, 'keyboard zoom never seeks, plays or changes agent scope');
    assert.equal(await overview.locator('canvas').count(), 1, 'overview reuses one canvas');
    assert.deepEqual(f.errors, []);
  } finally { await f.page.close(); }
});

test('mixed exact/pattern token selection and sounding guards retain agent scope', async browser => {
  const text = `song({tempo:120,bars:2})
pattern("phrase",notes("C4 . D4 .").stepsPerBar(4).gate(0.5))
track("lead").instrument("p0").play("phrase",{repeat:2})
event({ch:1,frame:10,frames:12,midi:67,inst:1,vel:1})`;
  const f = await boot(browser, text);
  try {
    const s = await f.snapshot(), compiled = s.validated.compiled;
    const mapped = compiled.mapping.find(m => m.pattern), exact = compiled.mapping.find(m => !m.pattern);
    assert(mapped?.tokenSpan && mapped?.playSpan, 'pattern compiler exposes token and play spans'); assert(exact);
    const note = compiled.gb.notes[mapped.noteIndex];
    await f.page.locator(`.mw-note[data-note="${mapped.noteIndex}"]`).click();
    await f.page.waitForFunction(() => getSelection().toString() === 'C4');
    assert.deepEqual(await f.page.evaluate(() => CT_MUSIC_WORKSPACE.agentContext().policy.selection), { ch: note.ch, fromFrame: note.frame, toFrame: note.frame + note.frames });
    const policy = (await chartState(f.page)).scope;
    assert(await f.page.locator('.mw-source-selected').count() >= 2, 'one selected token highlights its repeated occurrences');
    await acknowledge(f.page, note.frame + 1);
    assert.equal(await f.page.locator(`.mw-note[data-note="${mapped.noteIndex}"]`).evaluate(el => el.classList.contains('mw-note-sounding')), true);
    assert.equal(await f.page.locator('.cm-music-sounding').textContent(), 'C4', 'sounding source highlight is the pitch token');
    await f.page.evaluate(frame => fixture.callback({ status: 'position', frame }), note.frame + note.frames + 1);
    assert.equal(await f.page.locator('.mw-lane[data-channel="0"] .mw-note-sounding').count(), 0, 'melody gate ends while the independent exact note continues');
    const event = compiled.gb.notes[exact.noteIndex];
    assert.equal(await f.page.locator(`.mw-note[data-note="${exact.noteIndex}"]`).evaluate(el => el.classList.contains('mw-note-sounding')), true, 'mixed exact harmony still sounds across the melody gate');
    await f.page.evaluate(frame => fixture.callback({ status: 'position', frame }), Math.max(note.frame + note.frames, event.frame + event.frames) + 1);
    assert.equal(await f.page.locator('.mw-note-sounding').count(), 0, 'gate/rest region has no sounding note');
    assert.equal(await f.page.locator('.cm-music-sounding').count(), 0);
    assert.equal(await f.page.locator(`.mw-note[data-note="${exact.noteIndex}"]`).getAttribute('aria-label'), `Harmony note 67 frame 10 length 12`);
    await f.page.locator(`.mw-note[data-note="${exact.noteIndex}"]`).click();
    await f.page.waitForFunction(() => getSelection().toString().startsWith('event('));
    assert.deepEqual((await chartState(f.page)).scope, { ch: event.ch, fromFrame: event.frame, toFrame: event.frame + event.frames });
    const editor = f.page.locator('.cm-content');
    await editor.fill('invalid(');
    await f.page.waitForFunction(() => document.querySelector('.mw-chart-status').textContent.includes('draft has errors'));
    await f.page.locator(`.mw-note[data-note="${mapped.noteIndex}"]`).click();
    assert.equal(await f.page.evaluate(() => getSelection().toString()), '', 'invalid draft never receives stale source offsets');
    assert.match(await f.page.locator('.mw-selection').textContent(), /Source navigation unavailable/);
    assert.deepEqual((await chartState(f.page)).scope, policy, 'chart selection still provides the correct musical agent scope');
    await f.page.evaluate(frame => fixture.callback({ status: 'position', frame }), note.frame + 1);
    assert.equal(await f.page.locator('.cm-music-sounding').count(), 0, 'sounding source guards reject stale draft offsets');
    assert.equal((await f.snapshot()).playing, s.validated.id, 'typing never changes acknowledged playback');
    assert.deepEqual(f.errors, []);
  } finally { await f.page.close(); }
});

test('inline rolls fit real workspace rows and retain their selected variant across chart renders', async browser => {
  const text = `song({tempo:120,bars:16})
pattern("shared",notes("C4 D4 E4 F4").stepsPerBar(4).gate(.5))
track("lead").instrument("p0").play("shared",{repeat:16})
track("bass").instrument("wave-bass").transpose(-12).play("shared",{repeat:16})`;
  const f = await boot(browser, text);
  try {
    const roll = f.page.locator('.cm-inline-roll').first();
    await roll.scrollIntoViewIfNeeded();
    const box = await roll.evaluate(el => {
      const row = el.querySelector('.cm-inline-row').getBoundingClientRect();
      const note = el.querySelector('.cm-inline-note').getBoundingClientRect();
      return { rowHeight: row.height, noteHeight: note.height };
    });
    assert(box.noteHeight > 0 && box.noteHeight <= box.rowHeight, 'workspace button styles must not inflate inline notes beyond their rows');
    const choices = await roll.locator('select option').allTextContents();
    const bass = String(choices.findIndex(choice => choice.includes('Bass'))); assert.notEqual(bass, '-1');
    await roll.locator('select').selectOption(bass);
    const notes = await roll.locator('.cm-inline-note').evaluateAll(elements => elements.map(el => el.dataset.noteIndex));
    const before = await chartState(f.page);
    await f.page.locator('.mw-overview').click();
    await f.page.locator('.mw-chart-reset').click();
    await f.page.locator('.mw-notes').evaluate(el => { el.scrollLeft = el.scrollWidth; });
    await f.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await roll.locator('select').inputValue(), bass, 'detached project snapshots do not reset the occurrence selector');
    assert.deepEqual(await roll.locator('.cm-inline-note').evaluateAll(elements => elements.map(el => el.dataset.noteIndex)), notes);
    assert.deepEqual(await chartState(f.page), before);
    await acknowledge(f.page, 1);
    assert.equal(await roll.locator('.cm-inline-note[data-sounding=true]').count(), 1, 'inline selected bass follows host chip-voice winners');
    await f.page.evaluate(() => fixture.callback({ status: 'paused', frame: 1 }));
    assert.equal(await roll.locator('.cm-inline-note[data-sounding=true]').count(), 0, 'pause clears inline sounding marks');
    await f.page.locator('.cm-content').fill(text + '\ninvalid(');
    await f.page.waitForFunction(() => document.querySelectorAll('.cm-inline-roll').length === 0);
    await f.page.locator('.cm-content').press('ControlOrMeta+z');
    await f.page.waitForSelector('.cm-inline-roll');
    assert.equal((await f.snapshot()).draft, text, 'workspace undo rebuilds source-matched rolls without adding an edit');
    assert.deepEqual(f.errors, []);
  } finally { await f.page.close(); }
});

test('scheduled voice activity matches real sequencer off ordering and pitch-only lineage', async browser => {
  const kits = require('../src/gb-kits.js');
  const language = require('../src/music-language.js'), { Sequencer } = require('../src/gb-apu.js');
  const header = 'song({totalFrames:60});instruments([[128,240,255,0]]);';
  const event = (frame, frames, midi, extra = '') => `event({ch:0,frame:${frame},frames:${frames},midi:${midi},inst:0,vel:1${extra}});`;
  const fixtures = [
    { name: 'sample arrangement never attributes wave tokens, including triggers after kit onset; lead remains active',
      text: header + event(0, 50, 60) +
        'event({ch:2,frame:0,frames:8,midi:48,inst:0,vel:1});' +
        'event({ch:2,frame:10,frames:30,midi:50,inst:0,vel:1});' +
        `kit({f:5,id:${kits.kits()[0].id}});`,
      probes: [[0, [0]], [5, [0]], [10, [0]], [20, [0]], [40, [0]], [50, []]],
      sample: true },
    { name: 'generic p0 velocity zero still triggers volume five',
      text: 'song({tempo:120,bars:1});pattern("p",notes("C4@0 . . .").stepsPerBar(4));track("lead").instrument("p0").play("p");',
      probes: [[0, [0]], [12, [0]]], volume: 5 },
    { name: 'older off cuts the newer overlapping voice',
      text: header + event(0, 20, 60) + event(10, 30, 62),
      order: [[0, ['on:0']], [10, ['on:1']], [20, ['off:0']], [40, ['off:0']]],
      probes: [[0, [0]], [10, [1]], [19, [1]], [20, []], [25, []], [40, []]] },
    { name: 'pitch-only after a real gap cannot revive a cut voice',
      text: header + event(0, 5, 60) + event(10, 20, 62, ',trigger:false'),
      order: [[0, ['on:0']], [5, ['off:0']], [10, ['on:1']], [30, ['off:0']]],
      probes: [[0, [0]], [5, []], [10, []], [20, []], [30, []]] },
    { name: 'contiguous pitch-only continuation suppresses predecessor off but has its own off',
      text: header + event(0, 10, 60) + event(10, 20, 62, ',trigger:false'),
      order: [[0, ['on:0']], [10, ['on:1']], [30, ['off:0']]],
      probes: [[9, [0]], [10, [1]], [29, [1]], [30, []]] },
    { name: 'per-voice automation disables arrangement attribution without pretending modulation is silence',
      text: header + event(0, 20, 60) + event(20, 10, 62) + 'automation({f:5,r:19,v:42});',
      probes: [[0, [], true], [5, [], true], [19, [], true], [20, [], true], [30, [], false]] },
    { name: 'automation runs after same-frame trigger and DAC cut prevents pitch-only revival',
      text: header + event(0, 10, 60) + event(10, 20, 62, ',trigger:false') + 'automation({f:0,r:18,v:0});',
      probes: [[0, [], false], [10, [], false], [29, [], false], [30, [], false]] },
    { name: 'global routing automation disables arrangement attribution even before writes and after retrigger',
      text: header + event(0, 20, 60) + event(20, 10, 62) + 'automation({f:5,r:37,v:255});',
      probes: [[0, [], true], [5, [], true], [19, [], true], [20, [], true], [30, [], false]] },
    { name: 'same-frame off precedes retrigger and ties retain source order',
      text: header + event(0, 10, 60) + event(10, 20, 62) + event(10, 25, 64),
      order: [[0, ['on:0']], [10, ['off:0', 'on:1', 'on:2']], [30, ['off:0']], [35, ['off:0']]],
      probes: [[9, [0]], [10, [2]], [29, [2]], [30, []], [35, []]] }
  ];
  const failures = [];
  for (const item of fixtures) {
    let f;
    try {
      const compiled = language.compile(item.text);
      assert(compiled.gb, JSON.stringify(compiled.diagnostics));
      const sequencer = new Sequencer(compiled.gb, 44100);
      if (item.order) assert.deepEqual(Object.entries(sequencer.byFrame).map(([frame, events]) =>
        [Number(frame), events.map(e => e.t ? 'on:' + compiled.gb.notes.indexOf(e.n) : 'off:' + e.ch)]), item.order);
      f = await boot(browser, item.text);
      assert.deepEqual((await f.snapshot()).validated.compiled.gb.notes, compiled.gb.notes);
      const before = await chartState(f.page);
      for (const [frame, indices, chipActive = indices.length > 0] of item.probes) {
        // Register-event scheduling proof, not cycle/envelope simulation or a
        // human-listening claim. Process the target frame's off/on writes too.
        while (sequencer.frame <= frame) sequencer._runFrame();
        const voice = sequencer.apu.ch[0];
        assert.equal(voice.on && voice.dac && voice.vol > 0, chipActive, `${item.name} chip frame ${frame}`);
        if (item.sample && frame === 10) {
          assert(sequencer.kit, 'real sequencer has started the sample');
          assert(sequencer.apu.ch[2].on && sequencer.apu.ch[2].dac && sequencer.apu.ch[2].level > 0,
            'post-kit wave trigger is active at register level, not safely attributable to a token');
        }
        if (item.volume != null) assert.equal(voice.vol, item.volume);
        if (frame === item.probes[0][0]) await acknowledge(f.page, frame);
        else await f.page.evaluate(frame => fixture.callback({ status: 'position', frame }), frame);
        assert.deepEqual(await f.page.locator('.mw-note-sounding').evaluateAll(nodes => nodes.map(n => Number(n.dataset.note))),
          indices, `${item.name} chart frame ${frame}`);
        assert.equal(await f.page.locator('.cm-music-sounding').count(), indices.length, `${item.name} source frame ${frame}`);
      }
      const after = await chartState(f.page);
      assert.equal(after.draft, before.draft); assert.equal(after.validated, before.validated);
      assert.deepEqual(after.scope, before.scope);
      assert.deepEqual(after.audio, before.audio.concat('play'), 'acknowledgements never issue additional audio commands');
      assert.deepEqual(f.errors, []);
    } catch (error) { failures.push(item.name + ': ' + error.message); }
    finally { if (f) await f.page.close(); }
  }
  assert.deepEqual(failures, [], 'all schedule/UI regressions must pass');
});

test('large dense multi-track chart bounds event, row, grid and overview nodes', async browser => {
  const text = 'song({tempo:128,bars:256})\npattern("dense",notes("' + Array(16).fill('C4').join(' ') + '").stepsPerBar(16).gate(0.5))\n' +
    [['lead', 'p0'], ['pad', 'p1'], ['bass', 'wave-bass'], ['drums', 'n-tick']].map(([lane, instrument]) => `track("${lane}").instrument("${instrument}").play("dense",{repeat:256})`).join('\n');
  const f = await boot(browser, text);
  try {
    assert.equal((await f.snapshot()).validated.compiled.gb.notes.length, 16384);
    const before = await chartState(f.page);
    async function bounded() {
      assert(await f.page.locator('.mw-note,.mw-note-group').count() <= 400, 'event/group budget stays bounded');
      assert(await f.page.locator('.mw-pitch-row').count() <= 401, 'pitch and percussion rows have a finite alphabet');
      assert(await f.page.locator('.mw-time-grid').count() <= 4096, 'grid subdivisions remain bounded');
      assert(await f.page.locator('.mw-notes *').count() < 5500, 'chart DOM does not scale with sixteen thousand notes');
      assert.equal(await f.page.locator('.mw-overview canvas').count(), 1);
    }
    await bounded();
    assert(await f.page.locator('.mw-note-group').count() > 0, 'dense viewport is represented by counted groups');
    assert.match(await f.page.locator('.mw-chart-status').textContent(), /counted groups/);
    await f.page.locator('.mw-note-group').first().click(); await bounded();
    assert(await f.page.locator('.mw-note').count() > 0, 'group zoom reveals original notes');
    assert.deepEqual(await chartState(f.page), before, 'dense inspection changes no source, revision or audio');
    await f.page.locator('.mw-chart-reset').click(); await bounded();
    assert.equal(await f.page.evaluate(() => fixture.requests), 0);
    assert.deepEqual(f.errors, []);
  } finally { await f.page.close(); }
});

(async () => {
  const browser = await chromium.launch({ headless: true }); let failures = 0;
  try {
    for (const item of cases) {
      try { await item.run(browser); console.log('PASS ' + item.name); }
      catch (error) { failures++; console.error('FAIL ' + item.name + '\n' + (error.stack || error)); }
    }
  } finally { await browser.close(); }
  console.log(`verify-music-pitch-chart: ${cases.length - failures}/${cases.length} passed; source ${sourceId}; Chromium geometry and explicit audio fixture`);
  if (failures) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
