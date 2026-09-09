#!/usr/bin/env node
'use strict';
// Run directly; --browser additionally checks real Chromium pixels in memory.
// The core verifier needs no DOM, audio, timer, browser, build, or compiler.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const Renderer = require('../src/visual-renderer.js');
const source = fs.readFileSync(require.resolve('../src/visual-renderer.js'), 'utf8');
const OPS = ['tunnel', 'tiles', 'orbits', 'ribbons', 'sparks'];
const SIGNALS = ['audio.bass', 'audio.mid', 'audio.treble', 'audio.level', 'beat.phase', 'bar.phase',
  'lead.hit', 'lead.pitch', 'counter.hit', 'counter.pitch', 'bass.hit', 'bass.pitch', 'drums.hit'];
const clone = value => JSON.parse(JSON.stringify(value));
const param = name => ({ type: 'param', name });
const signal = (name, scale = 1, offset = 0) => ({ type: 'signal', name, scale, offset });
const control = (name = 'motion', value = 0.8) => ({ name, label: 'Motion', min: 0, max: 2, step: 0.01, value });
function program(layers = [{ op: 'tunnel', speed: param('motion'), react: signal('bass.hit') }]) {
  return { version: 1, visual: { background: '#090615', palette: ['#84f3d5', '#b089ff', '#ffbf69'], feedback: 0.84, seed: 17 },
    controls: [control()], layers };
}
function input(contextTime = 0, extra = {}) {
  return { contextTime, paused: false, identity: 'epoch:activation:revision:discontinuity',
    grid: { gstep: 21, phase: 0.5, bar: 1, bpm: 120 }, clock: { noteOns: [] }, ...extra };
}
function hash(text, initial = 2166136261) {
  let value = initial;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619) >>> 0;
  return value;
}

// This canvas deliberately exposes only the drawing vocabulary we support.
// Pixels use a content fingerprint; a partially painted back buffer is visible
// to the fixture even when the injected native drawing failure comes afterward.
function fixture(options = {}, api = Renderer) {
  const canvases = [], metrics = { allocations: 0, contexts: 0, resizes: 0 }, trace = [];
  let failure = null;
  function createCanvas(width, height) {
    metrics.allocations++;
    const canvas = { id: canvases.length, fingerprint: 0, requested: [width, height] };
    let actualWidth = 0, actualHeight = 0;
    for (const key of ['width', 'height']) Object.defineProperty(canvas, key, {
      get() { return key === 'width' ? actualWidth : actualHeight; },
      set(value) {
        assert(Number.isInteger(value) && value >= 1 && value <= (key === 'width' ? 960 : 540));
        metrics.resizes++; canvas.fingerprint = 0;
        if (key === 'width') actualWidth = value; else actualHeight = value;
      }
    });
    let state = { globalAlpha: 1, globalCompositeOperation: 'source-over', strokeStyle: '#000000', fillStyle: '#000000',
      lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', shadowBlur: 0, transform: [1, 0, 0, 1, 0, 0] };
    const stack = [], ctx = { calls: 0, primitives: 0, maximumDepth: 0, maximumPath: 0, path: [] };
    Object.defineProperty(ctx, 'depth', { get: () => stack.length });
    for (const key of Object.keys(state).filter(k => k !== 'transform')) Object.defineProperty(ctx, key, {
      get: () => state[key],
      set(value) {
        if (key === 'globalAlpha') assert(Number.isFinite(value) && value >= 0 && value <= 1, 'finite bounded alpha');
        if (key === 'lineWidth') assert(Number.isFinite(value) && value > 0 && value <= 256, 'bounded line width');
        if (key === 'shadowBlur') assert.equal(value, 0, 'no unbounded blur');
        if (key === 'globalCompositeOperation') assert(['source-over', 'lighter', 'screen'].includes(value), 'known blend');
        if (key === 'strokeStyle' || key === 'fillStyle') assert.match(value, /^(#[\da-f]{6}|rgb\(\d+,\d+,\d+\))$/i);
        state[key] = value;
      }
    });
    function record(name, args, primitive = false) {
      ctx.calls++;
      const data = Array.from(args, v => v && typeof v === 'object' && 'fingerprint' in v ? ['pixels', v.fingerprint] : v);
      for (const v of data) if (typeof v === 'number') assert(Number.isFinite(v) && Math.abs(v) < 1e8, name + ': finite bounded coordinate');
      if (trace.length < 40000) trace.push({ canvas, name, args: data, alpha: state.globalAlpha,
        blend: state.globalCompositeOperation, color: state.strokeStyle, width: state.lineWidth });
      if (primitive) {
        ctx.primitives++;
        if (name === 'fillRect' && state.globalAlpha === 1 && state.globalCompositeOperation === 'source-over' &&
            args[0] === 0 && args[1] === 0 && args[2] === canvas.width && args[3] === canvas.height &&
            state.transform.join(',') === '1,0,0,1,0,0') canvas.fingerprint = 0;
        canvas.fingerprint = hash(JSON.stringify([name, data, state, /^(stroke|fill)$/.test(name) ? ctx.path : null]), canvas.fingerprint);
      }
      if (failure && failure.name === name && --failure.remaining === 0) {
        failure = null;
        throw Error('Injected ' + name + ' failure');
      }
    }
    ctx.save = function () {
      record('save', []); stack.push({ ...state, transform: state.transform.slice() });
      ctx.maximumDepth = Math.max(ctx.maximumDepth, stack.length);
    };
    ctx.restore = function () { record('restore', []); assert(stack.length > 0, 'balanced restore'); state = stack.pop(); };
    ctx.setTransform = function (...args) { record('setTransform', args); state.transform = args; };
    ctx.translate = function (x, y) {
      record('translate', [x, y]); const [a, b, c, d, e, f] = state.transform;
      state.transform = [a, b, c, d, e + a * x + c * y, f + b * x + d * y];
    };
    ctx.rotate = function (angle) {
      record('rotate', [angle]); const [a, b, c, d, e, f] = state.transform, s = Math.sin(angle), co = Math.cos(angle);
      state.transform = [a * co + c * s, b * co + d * s, c * co - a * s, d * co - b * s, e, f];
    };
    ctx.beginPath = function () { record('beginPath', []); ctx.path = []; };
    for (const name of ['moveTo', 'lineTo', 'closePath', 'arc', 'ellipse', 'bezierCurveTo']) ctx[name] = function (...args) {
      record(name, args);
      if (name === 'arc') assert(args[2] >= 0);
      if (name === 'ellipse') assert(args[2] >= 0 && args[3] >= 0);
      ctx.path.push([name, ...args]); ctx.maximumPath = Math.max(ctx.maximumPath, ctx.path.length);
      assert(ctx.path.length <= 8, 'every path has a static segment bound');
    };
    for (const name of ['stroke', 'fill', 'fillRect', 'strokeRect', 'drawImage']) ctx[name] = function (...args) {
      if (name === 'drawImage') {
        assert(canvases.includes(args[0]) && args[0] !== canvas, 'only the other owned canvas supplies feedback');
        assert.equal(args.length, 5, 'bounded feedback copy');
      }
      record(name, args, true);
    };
    canvas.ctx = ctx;
    canvas.getContext = type => { metrics.contexts++; assert.equal(type, '2d'); return ctx; };
    canvases.push(canvas); return canvas;
  }
  const renderer = api.create({ createCanvas, ...options });
  function begin() {
    trace.length = 0;
    for (const c of canvases) { c.ctx.calls = 0; c.ctx.primitives = 0; c.ctx.maximumPath = 0; }
  }
  function render(frame) { begin(); return renderer.render(frame); }
  function bounded(count) {
    assert.equal(metrics.allocations, 2); assert.equal(metrics.contexts, 2); assert.equal(metrics.resizes, 4);
    assert(canvases.every(c => c.ctx.depth === 0 && c.ctx.maximumDepth <= 2), 'context stack is restored even after failures');
    const primitiveCount = canvases.reduce((sum, c) => sum + c.ctx.primitives, 0);
    assert(primitiveCount <= count * 4 + 2, `at most four primitives per item plus background/feedback (${primitiveCount})`);
    assert(canvases.reduce((sum, c) => sum + c.ctx.calls, 0) <= count * 40 + 100, 'all native calls are bounded, including path work');
  }
  return { renderer, canvases, metrics, trace, render, bounded,
    fail(name, remaining = 1) { failure = { name, remaining }; } };
}

test('CommonJS and browser global export create; loading/rendering own no ambient services', () => {
  assert.deepEqual(Object.keys(Renderer), ['create']);
  const sandbox = {};
  for (const name of ['document', 'window', 'navigator', 'performance', 'Date', 'AudioContext', 'webkitAudioContext',
    'setTimeout', 'setInterval', 'requestAnimationFrame', 'fetch', 'WebSocket', 'Worker', 'OffscreenCanvas', 'Image', 'Path2D'])
    Object.defineProperty(sandbox, name, { get() { throw Error('Ambient service accessed: ' + name); } });
  vm.createContext(sandbox); vm.runInContext(source, sandbox);
  vm.runInContext('Math.random = function () { throw Error("Ambient randomness"); };', sandbox);
  assert.equal(typeof sandbox.CT_VISUAL_RENDERER.create, 'function');
  const f = fixture({}, sandbox.CT_VISUAL_RENDERER);
  // A real browser compiler and renderer share a realm; pass that realm's IR.
  f.renderer.apply(vm.runInContext('(' + JSON.stringify(program()) + ')', sandbox));
  assert.equal(f.render(input()).error, null);
  assert.equal(f.render(input(0.1)).error, null);
  f.bounded(24);
});

test('exactly two canvases are fixed, independently capped, and safe at tiny dimensions', () => {
  for (const [options, expected] of [[{}, [960, 540]], [{ width: 4000, height: 234.9 }, [960, 234]],
    [{ width: 199.8, height: 4000 }, [199, 540]], [{ width: 0, height: -1 }, [1, 1]],
    [{ width: NaN, height: Infinity }, [960, 540]], [{ width: '900', height: 1 }, [960, 1]]]) {
    const f = fixture(options);
    assert.deepEqual(f.canvases.map(c => [c.width, c.height]), [expected, expected]);
    assert.deepEqual(f.canvases.map(c => c.requested), [expected, expected]);
    f.renderer.apply(program(OPS.map(op => ({ op }))));
    assert.equal(f.render(input()).error, null); f.bounded(120);
    assert.equal(f.renderer.snapshot().canvasCount, 2);
  }
  assert.throws(() => Renderer.create(), /createCanvas/);
  const canvas = {};
  assert.throws(() => Renderer.create({ createCanvas: () => canvas }), /distinct/);
  assert.throws(() => Renderer.create({ createCanvas: () => ({ getContext: () => null }) }), /contexts/);
});

test('each operation has bounded, distinct, moving geometry without analysis or onsets', () => {
  const shapes = new Set();
  for (const op of OPS) {
    const f = fixture();
    const p = program([{ op, count: 128, speed: 1, spin: 0.3, blend: 'lighter' }]); p.visual.feedback = 0;
    f.renderer.apply(p);
    const first = f.render(input(1)); assert.equal(first.error, null); f.bounded(128);
    const initial = first.canvas.fingerprint;
    assert(first.canvas.ctx.primitives >= 128 * 2 + 1, op + ': real geometric items');
    const next = f.render(input(1.1)); assert.equal(next.error, null); f.bounded(128);
    assert.notEqual(next.canvas.fingerprint, initial, op + ': internal musical time animates geometry');
    shapes.add(next.canvas.fingerprint);
    assert.equal(f.renderer.snapshot().signals['audio.level'], 0);
  }
  assert.equal(shapes.size, 5, 'five different drawing operations');
});

test('layer order, blend, parameter controls, seed and palette affect the composition', () => {
  const layers = [{ op: 'tiles', count: 3, blend: 'source-over' }, { op: 'orbits', count: 2, blend: 'screen' },
    { op: 'sparks', count: 1, blend: 'lighter', speed: param('motion') }];
  function draw(p, value) {
    const f = fixture(); f.renderer.apply(p);
    if (value !== undefined) f.renderer.setControl('motion', value);
    f.render(input()); const result = f.render(input(0.1)); assert.equal(result.error, null); f.bounded(6);
    return { f, fingerprint: result.canvas.fingerprint };
  }
  const base = program(layers), first = draw(base);
  const blends = first.f.trace.filter(op => ['stroke', 'fill', 'strokeRect'].includes(op.name)).map(op => op.blend);
  assert(blends.indexOf('source-over') < blends.indexOf('screen') && blends.indexOf('screen') < blends.indexOf('lighter'));
  assert.notEqual(first.fingerprint, draw(program(layers.slice().reverse())).fingerprint);
  assert.notEqual(first.fingerprint, draw(base, 1.7).fingerprint);
  const recolored = clone(base); recolored.visual.palette = ['#ff0000', '#0000ff'];
  assert.notEqual(first.fingerprint, draw(recolored).fingerprint);
  const reseeded = clone(base); reseeded.visual.seed++;
  assert.notEqual(first.fingerprint, draw(reseeded).fingerprint);
});

test('maximum layer/item counts keep resources, primitives and context depth static across frames and Applies', () => {
  const f = fixture({ width: 480, height: 270 });
  const p = program(Array.from({ length: 8 }, (_, i) => ({ op: OPS[i % OPS.length], count: 64, size: 2,
    speed: -4, spin: 4, spread: 2, hue: -8, opacity: 1, react: 2, thickness: 8, blend: 'lighter' })));
  for (let frame = 0; frame < 240; frame++) {
    if (frame % 20 === 0) f.renderer.apply(p);
    if (frame % 61 === 0) f.renderer.reset();
    assert.equal(f.render(input(frame / 60)).error, null);
    f.bounded(512);
  }
  const state = f.renderer.snapshot();
  assert.equal(state.items, 512); assert.equal(state.layers, 8); assert.equal(state.frames, 240);
});

test('untrusted IR is rejected atomically before any graph, value, pixel or diagnostic mutation', () => {
  const f = fixture(); f.renderer.apply(program()); f.render(input()); f.render(input(0.1));
  f.renderer.setControl('motion', 1.2);
  const state = f.renderer.snapshot(), pixels = f.canvases.map(c => c.fingerprint);
  const mutations = [
    p => { p.version = 2; }, p => { p.surprise = true; }, p => { delete p.visual; }, p => { p.visual.feedback = 0.96; },
    p => { p.visual.seed = -1; }, p => { p.visual.seed = 1.1; }, p => { p.visual.width = 2000; },
    p => { p.visual.background = 'red'; }, p => { p.visual.palette = ['#000000']; },
    p => { p.visual.palette = Array(9).fill('#ffffff'); }, p => { p.visual.palette[1] = 'url(x)'; },
    p => { delete p.visual.palette[1]; }, p => { p.controls = Array(9).fill(control()); },
    p => { p.controls.push(control()); }, p => { p.controls[0].name = '__proto__'; },
    p => { p.controls[0].name = 'a'.repeat(25); }, p => { p.controls[0].label = 'x'.repeat(41); },
    p => { p.controls[0].label = '🎛'.repeat(41); }, p => { p.controls[0].min = 3; },
    p => { p.controls[0].max = Infinity; }, p => { p.controls[0].step = 0; }, p => { p.controls[0].step = 3; },
    p => { p.controls[0].value = 3; }, p => { p.layers = Array(9).fill({ op: 'tiles' }); },
    p => { p.layers = Array(5).fill({ op: 'sparks', count: 128 }); }, p => { p.layers[0].count = 129; },
    p => { p.layers[0].count = 0; }, p => { p.layers[0].count = 1.1; }, p => { p.layers[0].count = param('motion'); },
    p => { p.layers[0].op = 'shader'; }, p => { p.layers[0].blend = 'copy'; }, p => { p.layers[0].size = NaN; },
    p => { p.layers[0].speed = Infinity; }, p => { p.layers[0].spread = null; }, p => { p.layers[0].blur = 10; },
    p => { p.layers[0].react = signal('unknown'); }, p => { p.layers[0].react = signal('lead.hit', 17); },
    p => { p.layers[0].react = signal('lead.hit', 1, -17); }, p => { p.layers[0].speed = param('absent'); },
    p => { p.layers[0].speed = { ...param('motion'), scale: 2 }; },
    p => { p.layers[0].size = { type: 'function', name: 'size' }; }, p => { p.layers[0].size = p; },
    p => { Object.setPrototypeOf(p.layers[0], { count: 128 }); },
    p => { Object.defineProperty(p.layers[0], 'size', { get() { throw Error('Getter must never execute'); } }); },
    p => { Object.defineProperty(p.visual.palette, '0', { get() { throw Error('Palette getter must never execute'); } }); },
    p => { p.layers[Symbol('extra')] = 1; }, p => { p.layers.extra = 1; },
    p => { p[Symbol('extra')] = 1; }, p => { delete p.controls; }
  ];
  for (const mutate of mutations) {
    const p = program(); mutate(p);
    assert.throws(() => f.renderer.apply(p), e => e instanceof TypeError && !/must never execute/.test(e.message));
    assert.deepEqual(f.renderer.snapshot(), state); assert.deepEqual(f.canvases.map(c => c.fingerprint), pixels);
  }
  for (const invalid of [null, undefined, [], true, () => program(), new Date()]) assert.throws(() => f.renderer.apply(invalid));
  for (const values of [{ motion: Infinity }, { motion: '1' }, { missing: 1 }, null,
    Object.defineProperty({}, 'motion', { get() { throw Error('must never execute'); } })]) {
    assert.throws(() => f.renderer.apply(program(), values)); assert.deepEqual(f.renderer.snapshot(), state);
  }
  f.bounded(24);
});

test('accepted programs and snapshots are detached; saved values survive Apply and clamp independently', () => {
  const f = fixture(), p = program();
  p.controls[0].label = '🎛'.repeat(40);
  f.renderer.apply(p, { motion: 1.25 });
  p.layers[0].count = 9000; p.layers[0].speed.name = 'invalid'; p.controls[0].max = -1; p.visual.palette[0] = 'invalid';
  assert.equal(f.render(input()).error, null);
  const first = f.renderer.snapshot(); assert.equal(first.values.motion, 1.25);
  first.values.motion = -99; first.signals['bass.hit'] = 99; first.grid.gstep = -1;
  assert.equal(f.renderer.snapshot().values.motion, 1.25); assert.equal(f.renderer.snapshot().signals['bass.hit'], 0);
  assert.notEqual(f.renderer.snapshot().grid.gstep, -1);
  f.renderer.apply(program()); assert.equal(f.renderer.snapshot().values.motion, 1.25);
  assert.equal(f.renderer.setControl('motion', 99).value, 2);
  assert.equal(f.renderer.setControl('motion', -99).value, 0);
  for (const value of [NaN, Infinity, null, '1', {}]) assert.equal(f.renderer.setControl('motion', value).ok, false);
  assert.equal(f.renderer.setControl('missing', 1).ok, false);
  const safeName = program([{ op: 'tiles', speed: param('constructor') }]); safeName.controls = [control('constructor')];
  f.renderer.apply(safeName, { constructor: 1.8 });
  assert.equal(f.renderer.snapshot().values.constructor, 1.8); assert.equal(f.render(input(0.1)).error, null);
  const defaults = { version: 1, visual: {}, controls: [], layers: [{ op: 'sparks' }] };
  f.renderer.apply(defaults); assert.deepEqual(f.renderer.snapshot().values, {});
  assert.equal(f.render(input(0.2)).error, null); f.bounded(24);
});

test('all finite numeric and referenced values clamp to evaluation ranges before geometry', () => {
  for (const extreme of [-1e308, 1e308]) {
    const f = fixture();
    f.renderer.apply(program(OPS.map(op => ({ op, count: 2, size: extreme, speed: extreme, spin: extreme, spread: extreme,
      hue: extreme, opacity: 1, react: extreme, thickness: extreme }))));
    assert.equal(f.render(input()).error, null); assert.equal(f.render(input(0.1)).error, null); f.bounded(10);
  }
  const f = fixture();
  f.renderer.apply(program(OPS.map(op => ({ op, count: 2, size: signal('lead.hit', 16, 16),
    speed: signal('lead.pitch', -16, -16), thickness: signal('bass.hit', 16, 16), opacity: signal('drums.hit', 16, 1) }))));
  assert.equal(f.render(input(0, { clock: { noteOns: [{ role: 'lead', midi: 108, mag: 9 }, { role: 'bass', mag: 8 }] } })).error, null);
  f.bounded(10);
});

test('musical clock reanchors pause, resume, identity jumps and invalid/backwards time with finite catch-up', () => {
  const f = fixture(); f.renderer.apply(program());
  f.render(input(100)); assert.equal(f.renderer.snapshot().phase, 0);
  f.render(input(100.05)); assert(Math.abs(f.renderer.snapshot().phase - 0.05) < 1e-12);
  const playing = f.renderer.snapshot(), frame = f.render(input(101, { paused: true }));
  const fingerprint = frame.canvas.fingerprint, frameCount = f.renderer.snapshot().frames;
  for (let n = 0; n < 20; n++) {
    assert.equal(f.render(input(200 + n, { paused: true })).canvas, frame.canvas);
    assert.equal(frame.canvas.fingerprint, fingerprint);
  }
  assert.equal(f.renderer.snapshot().phase, playing.phase); assert.equal(f.renderer.snapshot().frames, frameCount);
  f.render(input(400)); assert.equal(f.renderer.snapshot().phase, playing.phase);
  f.render(input(800, { identity: 'new revision' })); assert.equal(f.renderer.snapshot().phase, playing.phase);
  f.render(input(900, { identity: 'new revision' })); assert.equal(f.renderer.snapshot().dt, 0.1);
  f.render(input(899, { identity: 'new revision' })); assert.equal(f.renderer.snapshot().dt, 0);
  for (const time of [Infinity, NaN, -1, '900', {}, null]) {
    assert.equal(f.render(input(time)).error, null); assert.equal(f.renderer.snapshot().dt, 0);
    assert(Number.isFinite(f.renderer.snapshot().phase));
  }
  f.render(input(900)); assert.equal(f.renderer.snapshot().dt, 0);
  f.render(input(900.02)); assert(Math.abs(f.renderer.snapshot().dt - 0.02) < 1e-12);
});

test('actual fresh positive onsets drive decaying hits and retained MIDI pitch; roles/energy are not onsets', () => {
  const f = fixture(); f.renderer.apply(program());
  const notes = [{ role: 'lead', kind: 'noteOn', midi: 66, strength: 0.8, velocity: 0 },
    { role: 'counter', midi: 108, mag: 0.6 }, { role: 'bass', midi: 24, mag: 0.7 },
    { role: 'perc', kind: 'sample', midi: null, mag: 0.4 }, { role: 'noise', mag: 0.9 }];
  f.render(input(0, { clock: { noteOns: notes } }));
  const a = f.renderer.snapshot().signals;
  assert.equal(a['lead.hit'], 0.8); assert.equal(a['lead.pitch'], 0.5);
  assert.equal(a['counter.hit'], 0.6); assert.equal(a['counter.pitch'], 1);
  assert.equal(a['bass.hit'], 0.7); assert.equal(a['bass.pitch'], 0); assert.equal(a['drums.hit'], 0.9);
  f.render(input(0.1, { clock: { energy: 1, roles: { lead: { energy: 1, onset: 1, notes } }, noteOns: [] } }));
  const b = f.renderer.snapshot().signals;
  assert(Math.abs(b['lead.hit'] - 0.8 * Math.exp(-0.8)) < 1e-12);
  assert(Math.abs(b['bass.hit'] - 0.7 * Math.exp(-0.5)) < 1e-12);
  assert.equal(b['lead.pitch'], 0.5);
  f.render(input(0.1, { clock: { noteOns: [{ role: 'lead', kind: 'register', midi: null, mag: 1 },
    { role: 'counter', midi: 20, strength: 0, mag: 1 }, { role: 'bass', midi: 96, mag: -1 },
    { role: 'noise', kind: 'noteOff', mag: 1 }, { role: 'unknown', mag: 1 }, { role: 'lead', kind: 'continuation', midi: 108, mag: 1 }] } }));
  const c = f.renderer.snapshot().signals;
  assert.equal(c['lead.hit'], 1); assert.equal(c['lead.pitch'], 0.5);
  assert.equal(c['counter.pitch'], 1); assert.equal(c['bass.pitch'], 0); assert.equal(c['drums.hit'], b['drums.hit']);
  f.render(input(3, { paused: true, clock: { noteOns: [{ role: 'lead', midi: 108, mag: 1 }] } }));
  assert.equal(f.renderer.snapshot().signals['lead.pitch'], 0.5); assert.equal(f.renderer.snapshot().signals['lead.hit'], 1);
  // The reader guarantees freshness: even repeated/missing ids are not an
  // excuse to drop a legitimate command supplied on a later draw.
  f.render(input(4, { clock: { noteOns: [{ id: 'same', role: 'lead', midi: 80, mag: 0.5 }] } }));
  f.render(input(4.1, { clock: { noteOns: [{ id: 'same', role: 'lead', midi: 84, mag: 1 }] } }));
  assert.equal(f.renderer.snapshot().signals['lead.hit'], 1);
  assert.equal(f.renderer.snapshot().signals['lead.pitch'], (84 - 24) / 84);
  f.bounded(24);
});

test('event inspection has a strict 64-trigger bound and retains no unbounded command records', () => {
  const f = fixture(); f.renderer.apply(program());
  const notes = Array.from({ length: 64 }, (_, i) => ({ role: 'lead', midi: 24 + i, mag: 0.8 }));
  Object.defineProperty(notes, 64, { get() { throw Error('Exceeded the consumer frame limit'); } });
  assert.equal(f.render(input(0, { clock: { noteOns: notes } })).error, null);
  assert.equal(f.renderer.snapshot().signals['lead.pitch'], 63 / 84);
  assert.deepEqual(Object.keys(f.renderer.snapshot().signals).sort(), SIGNALS.slice().sort());
  for (let i = 1; i <= 24; i++) f.render(input(i * 0.1));
  assert.equal(f.renderer.snapshot().signals['lead.hit'], 0, 'decay reaches zero without retriggering stale notes');
});

test('analysis comes only from the documented measured pre-FX snapshot; grid phases use acknowledged steps', () => {
  const f = fixture(); f.renderer.apply(program());
  const clock = { noteOns: [], energy: 1, bands: { bass: 1, mid: 1, treble: 1 },
    analysis: { available: true, tap: 'internal-master-pre-fx', rms: 0.125, peak: 0.9,
      bands: { bass: 0.2, mid: 0.4, treble: 0.6 } } };
  f.render(input(0, { clock, grid: { gstep: 27, phase: 0.5, bar: 1, bpm: 137 } }));
  let s = f.renderer.snapshot();
  assert.equal(s.signals['audio.level'], 0.125); assert.equal(s.signals['audio.bass'], 0.2);
  assert.equal(s.signals['audio.mid'], 0.4); assert.equal(s.signals['audio.treble'], 0.6);
  assert.equal(s.signals['beat.phase'], 3.5 / 4); assert.equal(s.signals['bar.phase'], 11.5 / 16);
  assert.deepEqual(s.grid, { gstep: 27, phase: 0.5, bar: 1, bpm: 137 });
  assert.equal(s.signals['lead.hit'], 0, 'measured audio does not invent events');
  f.render(input(0.1, { clock: { ...clock, analysis: { ...clock.analysis, available: false } } }));
  s = f.renderer.snapshot();
  for (const name of ['audio.level', 'audio.bass', 'audio.mid', 'audio.treble']) assert.equal(s.signals[name], 0);
  f.render(input(0.2, { clock, paused: true })); assert.equal(f.renderer.snapshot().signals['audio.level'], 0);
  assert.equal(f.render(input(0.3, { clock: { analysis: { available: true, rms: Infinity, bands: { bass: -1, mid: 4, treble: NaN } } },
    grid: { gstep: NaN, phase: Infinity, bar: -1, bpm: '120' } })).error, null);
  s = f.renderer.snapshot(); assert.equal(s.signals['audio.level'], 0); assert.equal(s.signals['audio.mid'], 1);
  assert(Object.values(s.signals).every(v => Number.isFinite(v) && v >= 0 && v <= 1));
});

test('Apply and live controls retain phase/feedback; Reset invalidates feedback without discarding graph or controls', () => {
  const f = fixture(); f.renderer.apply(program()); f.render(input(0)); f.render(input(0.1));
  const before = f.renderer.snapshot();
  f.renderer.apply(program([{ op: 'orbits', count: 12, speed: param('motion') }]), { motion: 1.3 });
  assert.equal(f.renderer.snapshot().phase, before.phase); assert.equal(f.renderer.snapshot().frames, before.frames);
  f.render(input(0.2)); assert.equal(f.trace.filter(op => op.name === 'drawImage').length, 1, 'Apply keeps prior composition feedback');
  f.renderer.setControl('motion', 1.6); f.render(input(0.2, { paused: true }));
  assert.equal(f.renderer.snapshot().values.motion, 1.6); assert.equal(f.trace.filter(op => op.name === 'drawImage').length, 1);
  const frames = f.renderer.snapshot().frames, pixels = f.canvases.map(c => c.fingerprint);
  f.renderer.reset(); const s = f.renderer.snapshot();
  assert.equal(s.phase, 0); assert.equal(s.frames, frames); assert.equal(s.values.motion, 1.6);
  assert.deepEqual(f.canvases.map(c => c.fingerprint), pixels, 'published last-good remains available until the next completed draw');
  assert(Object.values(s.signals).every(v => v === 0));
  assert.equal(f.render(input(999)).error, null);
  assert.equal(f.trace.filter(op => op.name === 'drawImage').length, 0, 'Reset cannot resurrect old feedback');
  assert.equal(f.renderer.snapshot().phase, 0); f.bounded(12);
});

test('every draw failure retains the last complete front, restores context state and recovers without allocations', () => {
  for (const [op, method, remaining] of [['tunnel', 'stroke', 2], ['tiles', 'strokeRect', 2],
    ['orbits', 'ellipse', 2], ['ribbons', 'bezierCurveTo', 2], ['sparks', 'fillRect', 2],
    ['tunnel', 'drawImage', 1], ['tiles', 'translate', 1], ['orbits', 'fillRect', 1]]) {
    const f = fixture(); f.renderer.apply(program([{ op, count: 4, blend: 'screen' }]));
    const a = f.render(input(0)); assert.equal(a.error, null);
    const pixels = a.canvas.fingerprint, frames = f.renderer.snapshot().frames;
    f.fail(method, remaining);
    const b = f.render(input(0.1)); assert.match(b.error, /^Injected /);
    assert.equal(b.canvas, a.canvas, op + ': failed back never published');
    assert.equal(b.canvas.fingerprint, pixels, op + ': front pixels untouched');
    assert.equal(f.renderer.snapshot().frames, frames); assert.equal(f.renderer.snapshot().error, b.error);
    assert.equal(f.renderer.snapshot().renderErrors, 1); f.bounded(4);
    const c = f.render(input(0.2)); assert.equal(c.error, null); assert.notEqual(c.canvas, a.canvas);
    assert.equal(f.renderer.snapshot().frames, frames + 1); assert.equal(f.renderer.snapshot().error, null); f.bounded(4);
    const d = f.render(input(0.3)); assert.equal(d.canvas, a.canvas, 'the same two resources ping-pong');
    const good = d.canvas.fingerprint;
    f.renderer.reset(); f.fail('stroke', 1);
    // Tiles uses strokeRect, so trigger its native fill instead.
    if (op === 'tiles') f.fail('fillRect', 2);
    const e = f.render(input(0.4)); assert(e.error); assert.equal(e.canvas, d.canvas); assert.equal(e.canvas.fingerprint, good);
    assert.equal(f.render(input(0.5)).error, null); f.bounded(4);
  }
});

test('input exceptions and unknown identities fail closed without changing published pixels', () => {
  const f = fixture(); f.renderer.apply(program()); const good = f.render(input());
  const fingerprint = good.canvas.fingerprint;
  for (const bad of [{}, 'x'.repeat(257), Symbol('id')]) {
    const out = f.render(input(0.1, { identity: bad })); assert(out.error); assert.equal(out.canvas, good.canvas);
    assert.equal(out.canvas.fingerprint, fingerprint);
  }
  const hostile = Object.defineProperty({}, 'role', { get() { throw Error('Bad externally supplied event'); } });
  const out = f.render(input(0.2, { clock: { noteOns: [hostile] } }));
  assert.equal(out.canvas, good.canvas); assert.equal(out.canvas.fingerprint, fingerprint); assert(out.error);
  assert.equal(f.render(input(0.3)).error, null); f.bounded(24);
});

if (process.argv.includes('--browser')) test('real Chromium draws every compiler preset with non-flat pixels and reactive motion', async () => {
  const { chromium } = require('playwright');
  const languageSource = fs.readFileSync(require.resolve('../src/visual-language.js'), 'utf8');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<body style="margin:0;background:#090615"></body>');
    await page.addScriptTag({ content: languageSource }); await page.addScriptTag({ content: source });
    const results = await page.evaluate(() => {
      const results = [];
      for (const preset of CT_VISUAL_LANGUAGE.PRESETS) {
        const compiled = CT_VISUAL_LANGUAGE.compile(preset.source);
        if (!compiled.ok) throw Error('Preset failed: ' + preset.id);
        let allocations = 0;
        const renderer = CT_VISUAL_RENDERER.create({ width: 480, height: 270,
          createCanvas: () => { allocations++; return document.createElement('canvas'); } });
        renderer.apply(compiled.program);
        let first, output;
        for (let frame = 0; frame < 100; frame++) {
          output = renderer.render({ contextTime: frame / 60, identity: 'fixture', paused: false,
            grid: { gstep: Math.floor(frame / 8), phase: (frame % 8) / 8, bar: 0, bpm: 112 },
            clock: { noteOns: frame % 15 === 0 ? [{ role: 'bass', midi: 36, strength: 0.8 },
              { role: 'lead', midi: 60 + (frame % 24), strength: 0.75 }, { role: 'noise', strength: 0.65 }] : [],
              analysis: { available: true, rms: 0.15, bands: { bass: 0.45, mid: 0.28, treble: 0.12 } } } });
          if (output.error) throw Error(output.error);
          if (frame === 0) first = output.canvas.toDataURL();
        }
        const pixels = output.canvas.getContext('2d').getImageData(0, 0, 480, 270).data, colors = new Set();
        let lit = 0;
        for (let i = 0; i < pixels.length; i += 16) {
          const [r, g, b] = pixels.slice(i, i + 3); colors.add((r << 16) | (g << 8) | b);
          if (Math.max(r, g, b) > 60) lit++;
        }
        results.push({ id: preset.id, colors: colors.size, lit, moved: first !== output.canvas.toDataURL(),
          allocations, frames: renderer.snapshot().frames, canvasCount: renderer.snapshot().canvasCount });
      }
      return results;
    });
    for (const r of results) {
      assert(r.colors > 100 && r.lit > 150 && r.moved, r.id + ': colored geometric motion');
      assert.equal(r.allocations, 2); assert.equal(r.canvasCount, 2); assert.equal(r.frames, 100);
    }
    console.log('Chromium pixels:', JSON.stringify(results));
  } finally { await browser.close(); }
});
