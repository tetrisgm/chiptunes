'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const L = require('../src/music-language.js');
const H = require('../src/gb-hardware.js');
let checks = 0;
function test(name, fn) { fn(); checks++; console.log('ok ' + name); }
function valid(source) { const r = L.compile(source); assert.ok(r.gb, JSON.stringify(r.diagnostics)); return r; }
function invalid(source) { const r = L.compile(source); assert.equal(r.gb, null); assert.equal(r.diagnostics[0].severity, 'error'); assert.ok(r.diagnostics[0].span.start.line >= 1); return r; }
const bank = H.buildBank([]);
const fixture = {
  notes: [
    { ch: 0, frame: 31, frames: 22, midi: 65, inst: 0, vel: 0.7, det: -2, sweep: 3, trigger: false, pri: 7, role: 'lead', extra: { values: [null, false, 1.25] } },
    { ch: 2, frame: 2, frames: 8, midi: 24, inst: 18, vel: 0.4 },
    { ch: 3, frame: 5, frames: 7, inst: 26, vel: 1 }
  ], bank, totalFrames: 100, loopFrames: 90, gainScalar: 0.6875,
  auto: [{ f: 4, r: 0x24, v: 0x77, reason: 'master' }],
  vibOff: [{ f: 31, ch: 0 }], waveLoads: [{ f: 8.25, slot: 1 }],
  kit: [{ f: 50, id: 2, asset: { data: [0, 3, 15] } }],
  instruments: { bass: 18 }, provenance: { seed: 'example' }, tempoMap: [{ frame: 0, bpm: 120 }]
};
test('version and exact fields/assets/order round trip', () => {
  assert.equal(L.VERSION, '1');
  const source = L.materialize(fixture, { seed: 'abc', prompt: 'bright', tempo: 120 });
  assert.match(source, /instruments\(/); assert.match(source, /waveLoad\(/);
  const result = valid(source);
  assert.deepEqual(result.gb, fixture);
  assert.equal(result.settings.prompt, 'bright');
  assert.deepEqual(valid(source), result);
  assert.equal(result.mapping.length, fixture.notes.length);
  assert.match(source.slice(result.mapping[0].span.start.offset, result.mapping[0].span.end.offset), /^event\(/);
});
test('empty and absent optional fields remain distinct', () => {
  for (const gb of [{ notes: [], totalFrames: 0 }, { notes: [], bank: {}, totalFrames: 1, auto: [], vibOff: [], kit: [], waveLoads: [] }])
    assert.deepEqual(valid(L.materialize(gb)).gb, gb);
});
const shorthand = `// finite phrase\nsong({tempo:120,bars:4})
pattern('a', notes('C2 . G2:2@0.5').stepsPerBar(8).gate(.7))
track('bass').instrument('wave-bass').play('a',{atBar:0,repeat:2});`;
test('shorthand clock, rests, lengths, velocity and mapping', () => {
  const r = valid(shorthand); assert.equal(r.gb.notes.length, 4);
  assert.equal(r.gb.notes[1].frame, H.beatToFrame(1, 120));
  assert.equal(r.gb.notes[1].frames, H.beatToFrame(1.7, 120) - H.beatToFrame(1, 120));
  assert.equal(r.gb.notes[1].vel, 0.5);
  assert.equal(r.mapping[2].pattern, 'a'); assert.equal(r.mapping[2].occurrence, 1);
  assert.equal(r.mapping[2].span.start.line, 3);
  assert.deepEqual(valid(L.materialize(r.gb)).gb, r.gb);
});
test('ordered register/transpose and track state at play', () => {
  const prefix = 'song({tempo:120,bars:4});';
  const a = valid(prefix + `pattern('p',notes('B2').transpose(1).register(3));track('bass').instrument(18).play('p').transpose(12).play('p',{atBar:1});`);
  const b = valid(prefix + `pattern('p',notes('B2').register(3).transpose(1));track('bass').instrument(18).play('p');`);
  assert.deepEqual(a.gb.notes.map(n => n.midi), [48, 60]); assert.equal(b.gb.notes[0].midi, 60);
});
test('overlap warns and retains every event', () => {
  const gb = structuredClone(fixture); gb.notes.push({ ...gb.notes[0], frame: 32 });
  const r = valid(L.materialize(gb)); assert.deepEqual(r.gb, gb);
  assert.equal(r.diagnostics[0].code, 'CHIP_OVERLAP');
});
test('browser global and Node return identical results', () => {
  const context = vm.createContext({});
  for (const file of ['gb-hardware.js', 'gb-kits.js', 'music-language.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), context);
  for (const source of [shorthand, L.materialize(fixture)])
    assert.deepEqual(JSON.parse(JSON.stringify(context.CT_MUSIC_LANGUAGE.compile(source))), JSON.parse(JSON.stringify(L.compile(source))));
});
test('malicious and malformed syntax is rejected with locations', () => {
  for (const source of ['globalThis.process.exit()', 'import("x")', 'song({bars:Infinity})', 'song({bars:1+1})', 'song({bars:1, bars:2})',
    'song({__proto__:{}})', 'song({constructor:1})', 'song({bars:1});while(true){}', 'song({bars:1});event(()=>1)', 'song({bars:1});notes("C4")',
    'song({bars:1});track("bass").constructor("x")', 'song({bars:1});__proto__({})', 'song({bars:1});toString({})',
    'song({bars:1});pattern("unused",notes("C4").constructor(1))', '/* unfinished', 'song({bars:"bad\nstring"})']) invalid(source);
  assert.equal(invalid('// hi\nunknown({})').diagnostics[0].span.start.line, 2);
});
test('source, nesting, number, repeat, event and finite end bounds', () => {
  invalid(' '.repeat(L.LIMITS.source + 1));
  invalid('song({bars:1,x:' + '['.repeat(40) + '0' + ']'.repeat(40) + '})');
  invalid('song({totalFrames:1e999})'); invalid('song({totalFrames:999999999})');
  invalid(`song({bars:1});pattern('p',notes('C2'));track('bass').instrument(18).play('p',{repeat:999999})`);
  invalid(`song({bars:1});pattern('p',notes('C2'));track('bass').instrument(18).play('p',{atBar:1})`);
  invalid(`song({bars:65536});pattern('p',notes('${Array(16).fill('C2').join(' ')}'));track('bass').instrument(18).play('p',{repeat:4096})`);
  invalid(`song({bars:1});pattern('p',notes('C0'));track('bass').instrument(18).play('p')`);
  invalid(`song({bars:1});pattern('p',notes('${Array(65536).fill('.').join(' ')}'));track('bass').instrument(18)${'.play("p")'.repeat(32)}`);
});
test('non-JSON data never silently disappears', () => {
  for (const extra of [NaN, Infinity, () => 1, new Uint8Array([1]), new Date()])
    assert.throws(() => L.materialize({ notes: [], totalFrames: 0, extra }));
  const cycle = {}; cycle.x = cycle; assert.throws(() => L.materialize(cycle));
  assert.throws(() => L.materialize({ notes: [], totalFrames: 0, extra: Array(2) }));
});
test('undefined metadata normalizes as JSON without losing values', () => {
  const gb = structuredClone(fixture); gb.gainScalar = undefined; gb.bank.meta[0].unused = undefined;
  assert.deepEqual(valid(L.materialize(gb)).gb, JSON.parse(JSON.stringify(gb)));
});
test('bank shapes and kit IDs are bounded and typed', () => {
  for (const value of [[Array(33).fill(0)], [Array(32).fill(16)], ['bad'], Array(33).fill(Array(32).fill(0))])
    invalid('song({totalFrames:1});waves(' + JSON.stringify(value) + ')');
  for (const value of [[[1, 2]], [[0, 0, 255, 'x']], Array(129).fill([0, 0, 255, 0])])
    invalid('song({totalFrames:1});instruments(' + JSON.stringify(value) + ')');
  invalid('song({totalFrames:1});kit({f:0,id:255})');
});
test('tempoAt uses shared Create boundaries and end duration', () => {
  const r = valid(`song({tempo:120,bars:2,stepsPerBar:16,tempoAt:[[8,180],[16,90]]});
    pattern('p',notes('C2 C2 C2 C2').stepsPerBar(4));
    track('bass').instrument('wave-bass').play('p',{repeat:2});`);
  const ticks = H.lsdjGrooveTicks(false, 16);
  function at(row) { if (row <= 8) return H.lsdjRowFrame(120, ticks, row); if (row <= 16) return H.lsdjRowFrame(120, ticks, 8) + H.lsdjRowFrame(180, ticks, row - 8); return H.lsdjRowFrame(120, ticks, 8) + H.lsdjRowFrame(180, ticks, 8) + H.lsdjRowFrame(90, ticks, row - 16); }
  assert.deepEqual(r.gb.notes.map(n => n.frame), Array.from({ length: 8 }, (_, i) => at(i * 4)));
  assert.equal(r.gb.totalFrames, at(32));
  invalid('song({bars:1,tempoAt:[[8,120],[4,150]]})');
});
test('shared exported clock matches original segment timing including fractional rows', () => {
  const settings = { tempo: 120, stepsPerBar: 16, swing: true, tempoAt: [[0,120],[19,180],[43,90]] };
  const clock = L.createClock(settings), ticks = H.lsdjGrooveTicks(true, 16);
  function original(beat) {
    const row = beat * 4; let f = 0, cur = 120, at = 0;
    for (const pair of settings.tempoAt) { if (pair[0] >= row) break; f += H.lsdjRowFrame(cur, ticks, pair[0] - at); cur = pair[1]; at = pair[0]; }
    const relative = row - at, floor = Math.floor(relative), start = H.lsdjRowFrame(cur, ticks, floor);
    return Math.round(f + start + (relative - floor) * (H.lsdjRowFrame(cur, ticks, floor + 1) - start));
  }
  for (let beat = 0; beat < 64; beat += 0.125) { assert.equal(clock(beat), original(beat)); assert.equal(L.beatToFrame(settings, beat), clock(beat)); }
  const before = clock(12); settings.tempoAt[2][1] = 200; assert.equal(clock(12), before, 'clock snapshots settings');
  assert.equal(L.beatToFrame({}, 4), H.beatToFrame(4, 120));
  for (const beat of [-1, Infinity, NaN, '4']) assert.throws(() => clock(beat));
});
test('aligned source/frame limits and indexed large-source spans', () => {
  assert.equal(L.LIMITS.source, 1048576); assert.equal(L.LIMITS.frames, 216000);
  valid('song({totalFrames:216000})'); invalid('song({totalFrames:216001})');
  const prefix = '// ' + 'x'.repeat(750000) + '\nsong({totalFrames:2000});\ninstruments([[128,240,255,0]]);\n';
  const events = Array.from({length:1000}, (_, i) => `event({ch:0,frame:${i},frames:1,midi:60,inst:0})`).join('\n');
  const source = prefix + events, start = process.hrtime.bigint(), result = valid(source);
  assert.equal(result.mapping.length, 1000);
  assert.equal(result.mapping[999].span.start.line, 1003);
  assert.equal(source.slice(result.mapping[999].span.start.offset, result.mapping[999].span.end.offset), events.split('\n')[999]);
  console.log('  large source: ' + source.length + ' chars, ' + Number(process.hrtime.bigint() - start) / 1e6 + ' ms');
});
test('real Create happy and concrete composer round trips, byte-identical APU PCM', () => {
  const api = require('../src/api.js'), create = require('../src/create.js');
  const composer = require('../src/composer.js'), apu = require('../src/gb-apu.js');
  const composed = composer.compile('music-language-fidelity');
  const fixtures = [fixture, create.songOf(api.ask('happy').doc).gb, composed.gb, create.songFrom(composed, 'Language fidelity').gb];
  for (const gb of fixtures) {
    const result = valid(L.materialize(gb));
    assert.deepEqual(result.gb, JSON.parse(JSON.stringify(gb)));
    const before = apu.render(gb, 8000), after = apu.render(result.gb, 8000);
    assert.deepEqual(Buffer.from(after.buffer), Buffer.from(before.buffer), 'no-op source must preserve the complete waveform');
    assert.ok(before.some(v => v !== 0), 'fixture must be audible');
  }
});
test('compact materialization uses readable event/asset rows and labeled blocks', () => {
  const source = L.materialize(fixture);
  assert.equal(source.split('\n').filter(line => line.startsWith('event({')).length, fixture.notes.length);
  assert.match(source, /\/\/ Note events/); assert.match(source, /instruments\(\[\n  \[\d+,\d+,\d+,\d+\],?\n/);
  assert.deepEqual(valid(source).gb, fixture);
  const composer = require('../src/composer.js');
  const generated = L.materialize(composer.compile('music-language-fidelity').gb);
  assert.ok(generated.length < 98000, 'representative generated song stays below context target');
  console.log('  representative source: ' + generated.length + ' chars / ' + generated.split('\n').length + ' lines');
});
console.log('music-language: ' + checks + ' groups passed');
