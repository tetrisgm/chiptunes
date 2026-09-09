#!/usr/bin/env node
'use strict';
// Acceptance against the existing shared dist: real workspace Run, compiler,
// AudioContext and AudioWorklet. No build, provider, microphone or forged events.
// Internal pre-FX measurements are not acoustic/speaker or Safari acceptance.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const dist = path.resolve(__dirname, '../dist');
const frameSeconds = 70224 / 4194304;
const source = `song({title:"Signal Lantern",tempo:180,bars:2});
pattern("melody",notes("C5 . E5 . G5 . B5 .").stepsPerBar(8).gate(0.7).velocity(0.8));
pattern("answer",notes(". C4 . G4 . E4 . G4").stepsPerBar(8).gate(0.6).velocity(0.6));
pattern("ground",notes("C2 . G2 .").stepsPerBar(4).gate(0.6));
pattern("ticks",notes("C2 . . . C2 . . .").stepsPerBar(8).gate(0.3));
track("lead").instrument("p0").play("melody",{repeat:2});
track("pad").instrument("p0").play("answer",{repeat:2});
track("bass").instrument("wave-bass").play("ground",{repeat:2});
track("drums").instrument("n-tick").play("ticks",{repeat:2});
`;
const replacement = source.replace('C5 . E5 . G5 . B5 .', 'D5 . F5 . A5 . C6 .');
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.slang': 'text/plain', '.slangp': 'text/plain' };

async function bounded(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error(label + ' timed out after ' + ms + 'ms')), ms);
    })]);
  } finally { clearTimeout(timer); }
}

async function serve() {
  assert(fs.existsSync(path.join(dist, 'index.html')), 'Shared dist is missing; main must build it before running this check');
  const server = http.createServer((request, response) => {
    try {
      const url = new URL(request.url, 'http://fixture');
      if (url.pathname.startsWith('/api/')) {
        const access = url.pathname === '/api/music/chat/access' && request.method === 'GET';
        response.writeHead(access ? 200 : 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify(access ? { ok: true, authenticated: false, providers: [] } : { ok: false }));
        return;
      }
      let file = path.resolve(dist, '.' + decodeURIComponent(url.pathname));
      if (!file.startsWith(dist + path.sep) && file !== dist) { response.writeHead(403); response.end(); return; }
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html');
      response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'text/html', 'Cache-Control': 'no-store' });
      const stream = fs.createReadStream(file);
      stream.on('error', error => response.destroy(error));
      stream.pipe(response);
    } catch (_) { response.writeHead(400); response.end(); }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

// Runs in the real page. Only observations are retained; the producer, message
// port, reader implementation and audio commands are never replaced.
function installProbe() {
  const check = (ok, message) => { if (!ok) throw Error(message); };
  const counter = value => Number.isSafeInteger(value) && value >= 0;
  const unit = value => Number.isFinite(value) && value >= 0 && value <= 1;
  const p = window.musicSignalProbe = { error: null, states: [], frames: [], frameVisits: 0,
    sameFrameVisits: 0, lastFrameSeq: null, independentLag: false, snapshots: 0,
    measured: {}, fast: { events: [], batches: 0, resets: 0 }, slow: { events: [], batches: 0, resets: 0 } };
  const readers = [];
  let timer, originalScene, observedScene, originalTick, observedTick, unsubscribe;
  p.close = () => {
    clearInterval(timer);
    if (observedScene && scnGame === observedScene) scnGame = originalScene;
    if (observedTick && _visualSession.tick === observedTick) _visualSession.tick = originalTick;
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    readers.forEach(reader => reader.close());
  };
  // Both exist BEFORE the first Run. The fast reader uses the default limit;
  // the slow reader deliberately reads one record at a time between checkpoints.
  readers.push(Audio.musicEventReader(), Audio.musicEventReader({ replay: true }));
  check(readers[0] !== readers[1], 'readers must be independent objects');
  function read(which, limit) {
    const log = p[which], reader = readers[which === 'fast' ? 0 : 1];
    const batch = limit === undefined ? reader.read() : reader.read(limit);
    check(Array.isArray(batch.events) && batch.events.length <= (limit === undefined ? 256 : limit), 'bounded reader batch');
    check(counter(batch.dropped) && batch.dropped === 0, which + ': sparse fixture lost reader events');
    check(typeof batch.reset === 'boolean' && counter(batch.generation) && counter(batch.cursor), 'reader metadata');
    if (log.last) {
      check(batch.cursor >= log.last.cursor && batch.generation >= log.last.generation, 'reader counters went backwards');
      check(batch.reset === (batch.generation !== log.last.generation), 'reset must report a new generation once');
    }
    check(log.events.length + batch.events.length <= 8192, 'event observation budget exceeded');
    const context = musicSignalIO.contexts[0];
    for (const event of batch.events) if (event.kind !== 'transport') {
      check(context && Number.isFinite(event.contextTime) && event.contextTime <= context.currentTime + 256 / context.sampleRate,
        'reader received a future prediction instead of an emitted event');
    }
    log.events.push(...batch.events); log.batches++; log.resets += Number(batch.reset);
    log.last = { cursor: batch.cursor, generation: batch.generation };
    return batch;
  }
  function drain(which) {
    for (let i = 0; i < 32; i++) {
      const batch = read(which, 512);
      if (!batch.events.length) return batch;
    }
    throw Error('reader did not drain within its finite budget');
  }
  function snapshot() {
    const state = Audio.musicVisualState();
    check(state && state.clock, 'workspace music visual snapshot is available');
    check(Array.isArray(state.clock.noteOns) && state.clock.noteOns.length === 0, 'snapshot synthesized or drained noteOns');
    check(counter(state.epoch) && counter(state.discontinuity), 'snapshot epoch/discontinuity');
    check(Number.isFinite(state.renderContextTime) && state.renderContextTime >= 0, 'render context time');
    const stream = state.eventStream;
    check(stream && stream.available === true && counter(stream.nextSequence), 'event stream must be available');
    check(stream.sourceDropped === 0 && stream.rejectedBatches === 0 && stream.exhausted === false, 'event producer reported loss, rejection or exhaustion');
    const a = state.clock.analysis;
    check(a && typeof a.available === 'boolean', 'analysis availability');
    check(a.tap === 'internal-master-pre-fx' && a.frequencyScale === 'normalized-decibel-magnitude', 'analysis must label its real tap and scale');
    check(unit(a.rms) && unit(a.peak) && a.rms <= a.peak + 1e-12, 'bounded measured RMS/peak');
    check(a.bands && ['bass', 'mid', 'treble'].every(key => unit(a.bands[key])), 'bounded measured bands');
    if (a.available) {
      check(Array.isArray(a.waveform) && a.waveform.length === 160 && a.waveform.every(x => Number.isFinite(x) && Math.abs(x) <= 1), '160 bounded waveform samples');
      check(Array.isArray(a.spectrum) && a.spectrum.length === 64 && a.spectrum.every(unit), '64 normalized spectrum bins');
      check(Number.isFinite(a.sampleRate) && a.sampleRate > 0 && a.sampleRate === musicSignalIO.contexts[0]?.sampleRate, 'analysis uses the real AudioContext sample rate');
      check(Number.isInteger(a.fftSize) && a.fftSize >= 32 && a.fftSize <= 32768 && (a.fftSize & (a.fftSize - 1)) === 0, 'analysis FFT size');
      check(Number.isFinite(a.contextTime) && a.contextTime >= 0 && a.contextTime <= state.renderContextTime + 256 / a.sampleRate, 'measured context timestamp');
      check(Number.isFinite(a.spectrumBinHz) && a.spectrumBinHz > 0 && a.spectrumBinHz <= a.sampleRate / 2, 'spectrum frequency metadata');
      check(Number.isFinite(a.minDecibels) && Number.isFinite(a.maxDecibels) && a.minDecibels < a.maxDecibels, 'frequency decibel range');
      if (a.rms > 0.001 && a.peak > 0.001 && a.waveform.some(x => x !== 0) && a.spectrum.some(x => x > 0) && Object.values(a.bands).some(x => x > 0))
        p.measured[state.revision] = { rms: a.rms, peak: a.peak, sampleRate: a.sampleRate };
    }
    p.snapshots++;
    return state;
  }
  const safely = fn => { if (!p.error) try { fn(); } catch (error) { p.error = error.stack || String(error); } };
  function captureFrame(rx = _frameRX, renderer = 'game') {
    if (!rx) return;
    p.frameVisits++;
    check(counter(_frameSeq), 'runtime frame sequence is available');
    if (_frameSeq === p.lastFrameSeq) { p.sameFrameVisits++; return; }
    check(p.lastFrameSeq === null || _frameSeq > p.lastFrameSeq, 'draw frame sequence went backwards');
    p.lastFrameSeq = _frameSeq;
    const delivery = rx.eventDelivery, state = Audio.musicVisualState();
    check(delivery && counter(delivery.dropped) && counter(delivery.pending) && delivery.pending <= 512 && counter(delivery.generation), 'bounded runtime eventDelivery metadata');
    check(Array.isArray(rx.noteOns) && rx.noteOns.length <= 64, 'bounded runtime onset delivery');
    check(p.frames.length < 4096, 'draw observation budget exceeded');
    p.frames.push({ frameSeq: _frameSeq, renderer, delivery: { ...delivery }, epoch: state.epoch,
      activation: state.activation, discontinuity: state.discontinuity, paused: state.paused,
      renderContextTime: state.renderContextTime, notes: rx.noteOns.map(e => ({ ...e })) });
  }
  // _frameRX is cleared before the next rAF callback. Observe inside the real
  // scene draw, leaving its arguments/result intact. Two observations of the
  // SAME frame are intentional: only the first may count towards delivery.
  originalScene = scnGame;
  observedScene = function (...args) {
    safely(captureFrame);
    try { return originalScene.apply(this, args); }
    finally { safely(captureFrame); }
  };
  scnGame = observedScene;
  // The procedural scene bypasses scnGame. Observe its real tick with the exact
  // shared onset object supplied by runtime, without replacing any signals or
  // drawing a second frame. Its input precedes assignment of _frameRX.
  originalTick = _visualSession.tick;
  observedTick = function (...args) {
    const visual = this.snapshot(), procedural = visual.enabled && !visual.frozen && visual.scene.startsWith('visual:');
    if (procedural) safely(() => captureFrame(args[1], 'procedural'));
    try { return originalTick.apply(this, args); }
    finally { if (procedural) safely(() => captureFrame(args[1], 'procedural')); }
  };
  _visualSession.tick = observedTick;
  unsubscribe = Audio.onMusicState(e => safely(() => {
    check(p.states.length < 4096, 'transport observation budget exceeded');
    p.states.push({ status: e.status, reason: e.reason, revision: e.revision, activation: e.activation,
      epoch: e.epoch, discontinuity: e.discontinuity, frame: e.frame, contextTime: e.contextTime });
  }));
  let ticks = 0;
  timer = setInterval(() => safely(() => {
    read('fast');
    if (++ticks % 3 === 0) read('slow', 1);
    if (p.fast.events.length !== p.slow.events.length) p.independentLag = true;
    snapshot();
  }), 40);
  // Synchronous checkpoint: worklet message handlers cannot interleave here.
  // Snapshot/analysis reads must neither append events nor steal the slow
  // reader's backlog. Compare full independent histories on the Node side.
  p.checkpoint = () => {
    check(!p.error, p.error);
    const before = drain('fast'), state = snapshot();
    const stable = value => JSON.stringify([value.revision, value.activation, value.epoch,
      value.discontinuity, value.frame, value.status, value.eventStream]);
    for (let i = 0; i < 32; i++) {
      CT_MUSIC_WORKSPACE.snapshot();
      check(stable(snapshot()) === stable(state), 'snapshot reads changed transport/event stream');
    }
    const after = read('fast');
    check(after.events.length === 0 && after.cursor === before.cursor && after.generation === before.generation && !after.reset, 'snapshot reads appended/replayed events or moved the reader');
    const slow = drain('slow');
    check(slow.cursor === after.cursor && slow.generation === after.generation, 'independent readers did not catch up to the same journal cursor');
    return { fast: p.fast, slow: p.slow, states: p.states, frames: p.frames, state,
      independentLag: p.independentLag, sameFrameVisits: p.sameFrameVisits, snapshots: p.snapshots, measured: p.measured };
  };
  read('fast'); read('slow', 1); snapshot();
}

const identity = e => [e.epoch, e.activation, e.discontinuity].join(':');
const onset = e => e.strength > 0 && (e.kind === 'noteOn' || e.kind === 'sample' ||
  (e.kind === 'register' && [0x14, 0x19, 0x1e, 0x23].includes(e.register) && (e.value & 0x80)));
const counter = value => Number.isSafeInteger(value) && value >= 0;

function verifyTrace(trace, revisions) {
  assert(trace.independentLag, 'readers exercised different drain rates');
  assert.deepEqual(trace.slow.events, trace.fast.events, 'independent readers see matching IDs and records after bounded catch-up');
  assert(trace.fast.resets >= 1 && trace.slow.resets >= 1, 'pre-Run readers observe the playback generation reset');
  const events = trace.fast.events, ids = new Map(), segments = new Map();
  let lastContextTime = -1;
  for (const e of events) {
    assert(['transport', 'noteOn', 'noteOff', 'continuation', 'sample', 'register', 'gap'].includes(e.kind), 'known record kind');
    assert.notEqual(e.kind, 'gap', 'sparse acceptance must not lose source events');
    assert(counter(e.epoch) && counter(e.activation) && counter(e.discontinuity) && e.discontinuity > 0, 'event activation identity');
    assert(revisions.has(e.revision), 'only explicitly Run revisions emit events');
    assert(Number.isFinite(e.contextTime) && e.contextTime >= 0, 'event AudioContext timestamp');
    const key = identity(e);
    if (e.kind === 'transport') {
      assert(['activate', 'loop'].includes(e.reason), 'only requested activation/loop markers');
      assert(!segments.has(key), 'each discontinuity has one explicit start marker');
      segments.set(key, { marker: e, events: [] });
      continue;
    }
    const segment = segments.get(key);
    assert(segment, 'actual events follow an explicit transport marker');
    assert.equal(e.revision, segment.marker.revision, 'events retain their activation revision');
    assert.equal(typeof e.id, 'string'); assert(e.id.length > 0, 'actual event ID');
    assert(!ids.has(e.id), 'event ID delivered twice: ' + e.id); ids.set(e.id, e);
    assert(counter(e.sequence) && counter(e.sourceIndex), 'source sequence and index');
    assert.equal(e.sequence, segment.events.length, 'no duplicate/missing source sequence within a discontinuity');
    assert(e.contextTime >= lastContextTime, 'actual event context times are monotonic across loops/replacement');
    lastContextTime = e.contextTime;
    const compiled = revisions.get(e.revision), n = compiled.gb.notes[e.sourceIndex];
    // This named-pattern fixture has ordinary notes only. Other command kinds
    // are recognized above but must never be invented for these source rows.
    assert(['noteOn', 'noteOff'].includes(e.kind), 'plain patterns emit only actual note on/off commands');
    assert(n, 'source index identifies a compiled note');
    assert.equal(e.channel, n.ch, 'executed channel matches source index');
    assert.equal(e.frame, e.kind === 'noteOn' ? n.frame : n.frame + n.frames, 'executed frame matches compiled note timing');
    assert.equal(e.midi, e.kind === 'noteOn' ? n.midi : null, 'executed pitch matches compiled source');
    assert.equal(e.durationFrames, e.kind === 'noteOn' ? n.frames : 0, 'executed duration matches compiled source');
    assert.equal(e.velocity, e.kind === 'noteOn' ? (n.vel == null ? 1 : n.vel) : null, 'executed velocity matches compiled source');
    assert(Number.isFinite(e.strength) && e.strength >= 0 && e.strength <= 1, 'executed strength is bounded');
    const sampleRate = trace.measured[e.revision]?.sampleRate;
    assert(sampleRate > 0, 'nonzero measured analysis for each activated revision');
    // Source-frame timing is exact above. contextTime is the observed audio
    // clock, not an affine conversion of chip frames: real Chromium startup
    // can advance that clock across render gaps. Require ordered real times,
    // simultaneous commands at one frame, and no predicted future events.
    const tolerance = 256 / sampleRate;
    assert(e.contextTime >= segment.marker.contextTime, 'actual command does not precede its transport marker');
    const previous = segment.events[segment.events.length - 1];
    if (previous) {
      assert(e.frame >= previous.frame, 'compiled source frames advance within a discontinuity');
      if (e.frame === previous.frame) assert.equal(e.contextTime, previous.contextTime, 'same-frame commands share the emitted timestamp');
      else assert(e.contextTime > previous.contextTime, 'advancing source frames advance the emitted timestamp');
    }
    assert(e.contextTime <= trace.state.renderContextTime + tolerance, 'onset is not a scheduled future prediction');
    segment.events.push(e);
  }
  assert(events.some(e => e.kind === 'noteOff'), 'actual note-offs were emitted');
  assert.deepEqual([...new Set(events.filter(onset).map(e => e.channel))].sort(), [0, 1, 2, 3], 'clear positive onsets on all four source channels');
  const drawn = new Set();
  assert(trace.sameFrameVisits > 0 && trace.frames.length > 2, 'sampled real draws and ignored repeated observations of the same frameSeq');
  for (const frame of trace.frames) {
    for (const e of frame.notes) {
      assert(onset(e), 'runtime exposes only positive actual note/sample/explicit register triggers');
      assert(!drawn.has(e.id), 'runtime repeated an onset ID in a later draw: ' + e.id); drawn.add(e.id);
      assert.equal(frame.paused, false, 'paused draws do not replay onsets');
      for (const field of ['epoch', 'activation', 'discontinuity'])
        assert.equal(e[field], frame[field], 'draw discards retired ' + field);
      assert(e.contextTime <= frame.renderContextTime && frame.renderContextTime - e.contextTime <= 0.25 + 256 / trace.measured[e.revision].sampleRate,
        'draw consumes a newly rendered onset within its delivery window');
      const emitted = ids.get(e.id);
      assert(emitted, 'runtime onset has an actually emitted reader ID');
      for (const field of ['kind', 'epoch', 'activation', 'revision', 'discontinuity', 'sequence', 'sourceIndex',
        'frame', 'contextTime', 'channel', 'midi', 'durationFrames', 'velocity', 'strength'])
        assert.equal(e[field], emitted[field], 'runtime preserves emitted ' + field);
    }
  }
  for (const revision of revisions.keys())
    assert(trace.frames.some(frame => frame.notes.some(e => e.revision === revision)), 'runtime consumes actual onsets for ' + revision);
  return { events, segments, drawn: drawn.size };
}

function verifyLoops(trace, revision, compiled, count) {
  const markers = trace.fast.events.filter(e => e.kind === 'transport' && e.revision === revision);
  const start = markers.find(e => e.reason === 'activate');
  assert(start, 'explicit activation marker');
  const loops = markers.filter(e => e.reason === 'loop');
  assert(loops.length >= count, 'explicit loop markers');
  let previous = start;
  for (const loop of loops) {
    assert.equal(loop.epoch, start.epoch); assert.equal(loop.activation, start.activation);
    assert(loop.discontinuity > previous.discontinuity, 'loop starts a new discontinuity without a new activation');
    assert.equal(loop.frame, 0, 'loop marker rewinds the source frame');
    assert(loop.contextTime > previous.contextTime, 'loop advances the rendered context time');
    // A live replacement can begin in the middle of the song. Complete loop
    // passes must contain each compiled source onset and note-off exactly once.
    if (previous.frame === 0) for (const kind of ['noteOn', 'noteOff']) {
      const pass = trace.fast.events.filter(e => identity(e) === identity(previous) && e.kind === kind);
      assert.deepEqual(pass.map(e => e.sourceIndex).sort((a, b) => a - b),
        compiled.gb.notes.map((_, index) => index), 'complete loop delivers every compiled ' + kind + ' once');
    }
    previous = loop;
  }
}

async function verify(page, origin) {
  await page.goto(origin + '/?screen=crt', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#musicworkspace:not([hidden]) .cm-content');
  await page.waitForFunction(() => window.CT_MUSIC_WORKSPACE?.snapshot()?.validated && window.CT_CREATE_PRESENTATION?.snapshot().mounted);
  assert.equal(await page.evaluate(() => typeof Audio.musicEventReader), 'function', 'Requires main\'s rebuilt music event artifact');
  const editor = page.locator('#musicworkspace .cm-content');
  const snapshot = () => page.evaluate(() => CT_MUSIC_WORKSPACE.snapshot());
  const checkpoint = () => page.evaluate(() => musicSignalProbe.checkpoint());
  async function waitFor(predicate, arg) {
    await page.waitForFunction(predicate, arg, { timeout: 15000, polling: 40 });
    assert.equal(await page.evaluate(() => musicSignalProbe.error), null, 'live observation failed');
  }
  const initial = await snapshot();
  assert.equal(initial.playing, null); assert.equal(initial.pending, null, 'root is stopped');
  await page.locator('.mw-scene').selectOption('platformer');
  await page.locator('[data-action=visual-apply]').click();
  await page.waitForFunction(() => CT_CREATE_PRESENTATION.snapshot().visual.scene === 'platformer');
  await page.locator('.mw-loop').check();
  await editor.fill(source);
  await page.waitForFunction(text => CT_MUSIC_WORKSPACE.snapshot().draft === text, source);
  const compiled = await page.evaluate(text => CT_MUSIC_LANGUAGE.compile(text), source);
  assert(compiled.gb, JSON.stringify(compiled.diagnostics));
  assert(compiled.gb.notes.length > 8 && compiled.gb.totalFrames * frameSeconds < 4, 'known sparse, short loop');
  await page.evaluate(installProbe);
  await editor.press('ControlOrMeta+Enter');
  await waitFor(() => {
    if (musicSignalProbe.error) return true;
    const s = CT_MUSIC_WORKSPACE.snapshot();
    return s.playing === s.validated.id && Audio.musicVisualState()?.status === 'playing' &&
      musicSignalProbe.states.filter(e => e.status === 'loop').length >= 2;
  });
  const first = await snapshot();
  assert.equal(first.validated.source, source);
  assert.deepEqual(first.validated.compiled.gb, compiled.gb, 'Run used the real compiled source');
  const revisions = new Map([[first.validated.id, compiled]]);
  let trace = await checkpoint();
  verifyTrace(trace, revisions); verifyLoops(trace, first.validated.id, compiled, 2);
  assert.equal(trace.states.filter(e => e.status === 'playing' && e.reason === 'activate').length, 1, 'initial Run activates exactly once');
  console.log('  ok real Run; independent readers; complete loops; source-index/frame/pitch/duration timing; bounded measured analysis; once-per-draw onsets');

  await page.locator('.mw-scene').selectOption('visual:neon-tunnel');
  await page.locator('[data-action=visual-apply]').click();
  await page.waitForFunction(() => CT_CREATE_PRESENTATION.snapshot().visual.scene === 'visual:neon-tunnel');
  const beforeInvalid = { activation: trace.state.activation, epoch: trace.state.epoch, states: trace.states.length };
  await editor.fill(source + '\ninvalid(');
  await editor.press('ControlOrMeta+Enter');
  await page.waitForFunction(() => /error/i.test(document.querySelector('.mw-diagnostics')?.textContent || ''));
  await waitFor(start => musicSignalProbe.error || musicSignalProbe.states.slice(start).some(e => e.status === 'loop'), beforeInvalid.states);
  const invalid = await snapshot();
  assert.equal(invalid.draft, source + '\ninvalid(');
  assert.equal(invalid.validated.id, first.validated.id); assert.equal(invalid.playing, first.validated.id);
  assert.equal(invalid.pending, null, 'invalid draft cannot queue');
  trace = await checkpoint();
  assert.equal(trace.state.activation, beforeInvalid.activation); assert.equal(trace.state.epoch, beforeInvalid.epoch);
  assert(trace.states.slice(beforeInvalid.states).every(e => ['position', 'loop'].includes(e.status)), 'invalid Run issues no extra prepare/queue/activation');
  verifyTrace(trace, revisions);
  for (const renderer of ['game', 'procedural'])
    assert(trace.frames.some(frame => frame.renderer === renderer && frame.notes.length), renderer + ' consumes actual emitted onsets');
  console.log('  ok invalid draft/Run leaves the real loop active; repeated snapshot/analysis reads preserve both reader histories');

  const beforeQueue = await page.evaluate(() => ({ states: musicSignalProbe.states.length,
    boundaries: Array.from(Audio.musicBoundaries(CT_MUSIC_WORKSPACE.snapshot().validated.compiled)) }));
  await editor.fill(replacement);
  await editor.press('ControlOrMeta+Enter');
  await waitFor(id => {
    if (musicSignalProbe.error) return true;
    const s = CT_MUSIC_WORKSPACE.snapshot();
    return s.validated.id !== id && s.playing === s.validated.id &&
      musicSignalProbe.states.filter(e => e.status === 'loop' && e.revision === s.validated.id).length >= 2;
  }, first.validated.id);
  const next = await snapshot();
  assert.equal(next.validated.source, replacement); assert.equal(next.pending, null);
  assert.notEqual(next.validated.id, first.validated.id);
  assert.notDeepEqual(next.validated.compiled.gb.notes, compiled.gb.notes, 'replacement changes actual pitches');
  revisions.set(next.validated.id, next.validated.compiled);
  trace = await checkpoint();
  const transition = trace.states.slice(beforeQueue.states);
  const activated = transition.filter(e => e.status === 'playing' && e.reason === 'activate');
  assert.equal(activated.length, 1, 'live Run has exactly one activation acknowledgement');
  assert.equal(activated[0].revision, next.validated.id);
  assert(beforeQueue.boundaries.includes(activated[0].frame), 'replacement activates on the sounding source musical boundary');
  assert(transition.some(e => e.status === 'queued' && e.revision === next.validated.id), 'live replacement was really queued');
  assert.equal(trace.state.epoch, beforeInvalid.epoch, 'queue stays in the original playback epoch');
  assert.notEqual(trace.state.activation, beforeInvalid.activation, 'queue acknowledges a new activation');
  const summary = verifyTrace(trace, revisions);
  verifyLoops(trace, next.validated.id, next.validated.compiled, 2);
  const at = summary.events.findIndex(e => e.kind === 'transport' && e.reason === 'activate' && e.revision === next.validated.id);
  assert(at >= 0 && summary.events.slice(at).every(e => e.revision === next.validated.id), 'no retired activation leaks after replacement');
  console.log(`  ok live queued replacement; ${summary.events.length} matching records, ${summary.drawn} unique drawn onsets, ${trace.snapshots} read-only snapshots`);
}

async function main() {
  const { server, origin } = await serve();
  let browser, context, page;
  const errors = [], providerRequests = [], externalRequests = [];
  try {
    const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
    console.log('Shared artifact: ' + ([...html.matchAll(/(?:src|href)="([^"]*(?:app\.|music-workspace)[^"]*)"/g)].map(m => m[1]).join(', ') || 'dist/index.html'));
    browser = await chromium.launch({ headless: true, timeout: 15000,
      args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader'] });
    context = await browser.newContext({ viewport: { width: 1800, height: 1000 }, serviceWorkers: 'block' });
    await context.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      if (url.pathname === '/api/music/chat' || request.headers()['x-music-provider']) {
        providerRequests.push(request.method() + ' ' + url.origin + url.pathname);
        return route.abort();
      }
      if (url.origin !== origin) {
        // The existing page asks for a decorative font and public star count.
        // Abort these too, but distinguish them from unexpected/provider IO.
        const decorative = request.method() === 'GET' && (
          (url.hostname === 'fonts.googleapis.com' && request.resourceType() === 'stylesheet') ||
          (url.hostname === 'fonts.gstatic.com' && request.resourceType() === 'font') ||
          (url.origin === 'https://api.github.com' && url.pathname === '/repos/tetrisgm/chiptunes'));
        if (!decorative) externalRequests.push(url.origin + url.pathname);
        return route.abort();
      }
      return route.continue();
    });
    await context.addInitScript(() => {
      window.musicSignalIO = { contexts: [], getUserMedia: 0 };
      for (const key of ['AudioContext', 'webkitAudioContext']) {
        if (!window[key]) continue;
        window[key] = new Proxy(window[key], { construct(Target, args) {
          const context = Reflect.construct(Target, args); musicSignalIO.contexts.push(context); return context;
        } });
      }
      if (navigator.mediaDevices?.getUserMedia) navigator.mediaDevices.getUserMedia = function () {
        musicSignalIO.getUserMedia++; return Promise.reject(Error('Microphone access is forbidden in this acceptance'));
      };
      for (const key of ['getUserMedia', 'webkitGetUserMedia', 'mozGetUserMedia']) {
        if (typeof navigator[key] === 'function') navigator[key] = function () {
          musicSignalIO.getUserMedia++; throw Error('Legacy microphone access is forbidden in this acceptance');
        };
      }
    });
    page = await context.newPage();
    page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    await bounded(verify(page, origin), 60000, 'music signal browser acceptance');
    assert.deepEqual(await page.evaluate(() => ({ contexts: musicSignalIO.contexts.length, getUserMedia: musicSignalIO.getUserMedia })),
      { contexts: 1, getUserMedia: 0 }, 'one real AudioContext and no microphone acquisition');
    assert.deepEqual(providerRequests, [], 'no provider requests');
    assert.deepEqual(externalRequests, [], 'no unexpected external/provider requests; decorative requests were blocked');
    assert.deepEqual(errors, [], 'no uncaught browser errors');
    console.log('PASS verify-music-signal-browser: local shared-dist Chromium event pipeline and internal pre-FX measurements; no acoustic, deployed or Safari claim');
  } catch (error) {
    if (page && !page.isClosed()) {
      try { console.error('Workspace:', await bounded(page.locator('.mw-status,.mw-diagnostics').allTextContents(), 2000, 'failure diagnostics')); }
      catch (_) { /* Original failure remains authoritative. */ }
    }
    throw error;
  } finally {
    // Close only this test's readers, listener, sampler, AudioContexts and
    // isolated browser context. The owner's running application is untouched.
    try {
      if (page && !page.isClosed()) await bounded(page.evaluate(async () => {
        try { window.musicSignalProbe?.close(); }
        finally { await Promise.allSettled((window.musicSignalIO?.contexts || []).map(c => c.state === 'closed' ? undefined : c.close())); }
      }), 3000, 'probe cleanup');
    } finally {
      try { if (context) await bounded(context.close(), 5000, 'context cleanup'); }
      finally {
        try { if (browser) await bounded(browser.close(), 5000, 'browser cleanup'); }
        finally {
          await bounded(new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }), 3000, 'server cleanup');
        }
      }
    }
  }
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
