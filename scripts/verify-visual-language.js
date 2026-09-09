#!/usr/bin/env node
'use strict';
// Read-only compiler contract/security checks. No build, renderer or UI writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const L = require('../src/visual-language.js');

let groups = 0, compilations = 0;
function test(name, run) {
  run(); groups++;
  process.stdout.write('ok ' + groups + ' - ' + name + '\n');
}
function frozen(value) {
  if (!value || typeof value !== 'object') return;
  assert(Object.isFrozen(value), 'all program data must be frozen');
  for (const child of Object.values(value)) frozen(child);
}
function compile(source, language = L) {
  compilations++;
  let result;
  assert.doesNotThrow(() => { result = language.compile(source); });
  assert.deepEqual(Object.keys(result).sort(), ['diagnostics', 'ok', 'program']);
  return result;
}
function valid(source, language = L) {
  const result = compile(source, language);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(result.diagnostics.length, 0);
  assert.equal(result.program.version, 1);
  frozen(result.program);
  return result.program;
}
function invalid(source, code, language = L) {
  const result = compile(source, language);
  assert.equal(result.ok, false, 'invalid input must fail');
  assert.equal(result.program, null, 'no partial program on failure');
  assert(result.diagnostics.length > 0);
  for (const diagnostic of result.diagnostics) {
    assert.equal(diagnostic.severity, 'error');
    assert.equal(typeof diagnostic.message, 'string');
    assert(diagnostic.message.length > 0);
    assert.notEqual(diagnostic.code, 'INTERNAL', 'invalid source must use a deliberate diagnostic');
    const { start, end } = diagnostic.span;
    for (const position of [start, end]) {
      assert(Number.isInteger(position.offset) && position.offset >= 0);
      assert(Number.isInteger(position.line) && position.line >= 1);
      assert(Number.isInteger(position.column) && position.column >= 1);
      assert(position.offset <= (typeof source === 'string' ? source.length : 0));
    }
    assert(end.offset >= start.offset);
  }
  if (code) assert.equal(result.diagnostics[0].code, code, result.diagnostics[0].message);
  return result.diagnostics[0];
}
const controlFields = { label: 'Motion', min: 0, max: 2, step: 0.01, value: 0.8 };
function control(name = 'motion', overrides = {}) {
  return `control(${JSON.stringify(name)},${JSON.stringify({ ...controlFields, ...overrides })});`;
}
function layer(fields = '', op = 'tunnel') { return `layer(${JSON.stringify(op)},{${fields}});`; }
function scene(fields = '', op = 'tunnel') { return 'visual({});' + layer(fields, op); }
function plain(value) { return JSON.parse(JSON.stringify(value)); }

test('version, exact defaults, operations and renderer schema match the contract', () => {
  assert.deepEqual(L.LIMITS, { sourceBytes: 32768, tokens: 4096, depth: 16, layers: 8,
    controls: 8, paletteMin: 2, paletteMax: 8, count: 128, totalCount: 512, primitivesPerItem: 4 });
  assert.deepEqual(L.OPERATIONS, ['tunnel', 'tiles', 'orbits', 'ribbons', 'sparks']);
  assert.deepEqual(L.BLENDS, ['source-over', 'lighter', 'screen']);
  assert.deepEqual(L.SIGNALS, ['audio.bass', 'audio.mid', 'audio.treble', 'audio.level', 'beat.phase', 'bar.phase',
    'lead.hit', 'lead.pitch', 'counter.hit', 'counter.pitch', 'bass.hit', 'bass.pitch', 'drums.hit']);
  const visual = { background: '#090615', palette: ['#84f3d5', '#b089ff', '#ffbf69'], feedback: 0.8, seed: 1 };
  assert.deepEqual(valid('visual({});'), { version: 1, visual, controls: [], layers: [] });
  assert.deepEqual(L.VISUAL_DEFAULTS, visual);
  const defaults = { count: 24, size: 0.5, speed: 0.5, spin: 0, spread: 0.7, hue: 0, opacity: 0.8,
    react: 0, thickness: 1, blend: 'source-over' };
  for (const op of L.OPERATIONS) assert.deepEqual(valid(scene('', op)).layers, [{ op, ...defaults }]);
  const bounds = { count: [1, 128], size: [0.01, 2], speed: [-4, 4], spin: [-4, 4], spread: [0, 2],
    hue: [-8, 8], opacity: [0, 1], react: [0, 2], thickness: [0.25, 8] };
  assert.deepEqual(Object.keys(L.LAYER_SCHEMA), Object.keys(defaults));
  for (const [key, schema] of Object.entries(L.LAYER_SCHEMA)) {
    assert.equal(schema.default, defaults[key]);
    assert.equal(schema.dynamic, !['count', 'blend'].includes(key));
    if (key === 'blend') assert.deepEqual(schema.values, L.BLENDS);
    else assert.deepEqual([schema.min, schema.max], bounds[key]);
  }
  assert.equal(L.LAYER_SCHEMA.count.integer, true);
  frozen(L);
});

test('the contract example compiles to data with complete defaults', () => {
  const program = valid(`
visual({background: "#090615", palette: ["#84f3d5", "#b089ff", "#ffbf69"], feedback: 0.84, seed: 17});
control("motion", {label: "Motion", min: 0, max: 2, step: 0.01, value: 0.8});
control("intensity", {label: "Intensity", min: 0, max: 1, step: 0.01, value: 0.7});
layer("tunnel", {count: 24, speed: param("motion"), size: 0.8, spin: signal("lead.pitch", 0.6), react: signal("bass.hit", 0.9), opacity: param("intensity")});
layer("orbits", {count: 18, speed: 0.4, size: 0.12, spread: 0.8, react: signal("drums.hit"), blend: "lighter"});`);
  assert.deepEqual(program.controls, [{ name: 'motion', ...controlFields },
    { name: 'intensity', label: 'Intensity', min: 0, max: 1, step: 0.01, value: 0.7 }]);
  assert.deepEqual(program.layers[0], { op: 'tunnel', count: 24, size: 0.8,
    speed: { type: 'param', name: 'motion' }, spin: { type: 'signal', name: 'lead.pitch', scale: 0.6, offset: 0 },
    spread: 0.7, hue: 0, opacity: { type: 'param', name: 'intensity' },
    react: { type: 'signal', name: 'bass.hit', scale: 0.9, offset: 0 }, thickness: 1, blend: 'source-over' });
  assert.deepEqual(program.layers[1].react, { type: 'signal', name: 'drums.hit', scale: 1, offset: 0 });
});

test('three readable, composed presets are deterministic and remixable', () => {
  assert.deepEqual(L.PRESETS.map(p => p.id), ['visual:neon-tunnel', 'visual:pulse-grid', 'visual:orbit-loom']);
  const ops = new Set(), routes = new Set();
  for (const preset of L.PRESETS) {
    assert.deepEqual(Object.keys(preset).sort(), ['id', 'label', 'source']);
    assert(preset.label.length > 0 && preset.source.includes('//') && preset.source.split('\n').length >= 20);
    const program = valid(preset.source);
    assert.deepEqual(valid(preset.source), program);
    assert(program.layers.length >= 3 && new Set(program.layers.map(l => l.op)).size >= 2);
    assert(program.controls.length >= 2);
    for (const item of program.layers) {
      ops.add(item.op);
      for (const value of Object.values(item)) if (value && value.type === 'signal') routes.add(value.name);
    }
    assert(program.layers.some(l => l.blend !== 'source-over'));
    assert(program.layers.reduce((n, l) => n + l.count, 0) <= 512);
    const remix = preset.source.replace(/"#[0-9a-f]{6}"/, '"#102030"');
    assert.equal(valid(remix).visual.background, '#102030');
    const first = 'layer("' + program.layers[0].op + '"';
    const changedOp = program.layers[0].op === 'tiles' ? 'tunnel' : 'tiles';
    assert.equal(valid(preset.source.replace(first, 'layer("' + changedOp + '"')).layers[0].op, changedOp);
  }
  assert.deepEqual([...ops].sort(), [...L.OPERATIONS].sort());
  assert(routes.has('drums.hit') && routes.has('bass.hit') && routes.has('lead.pitch') && routes.has('audio.mid'));
});

test('forward references resolve without changing declaration or layer order', () => {
  const source = layer('speed:param("later"),spin:param("constructor")', 'sparks') +
    control('later') + layer('opacity:param("later")', 'tiles') + 'visual({seed:42});' + control('constructor');
  const program = valid(source);
  assert.deepEqual(program.layers.map(l => l.op), ['sparks', 'tiles']);
  assert.deepEqual(program.controls.map(c => c.name), ['later', 'constructor']);
  assert.deepEqual(program.layers[0].spin, { type: 'param', name: 'constructor' });
  assert.equal(program.visual.seed, 42);
  invalid(scene('speed:param("later")'), 'UNKNOWN_CONTROL');
  invalid(scene('speed:param("toString")'), 'CONTROL_NAME');
  invalid(scene('speed:param("constructor")'), 'UNKNOWN_CONTROL');
  invalid('visual({});' + control('same') + control('same'), 'DUPLICATE_CONTROL');
  invalid('visual({});' + control('motion') + String.raw`control("mo\u0074ion",{label:"X",min:0,max:1,step:1,value:0});`, 'DUPLICATE_CONTROL');
});

test('every signal and every dynamic property use the specified reference shape', () => {
  for (const name of L.SIGNALS) {
    for (const [tail, scale, offset] of [['', 1, 0], [',0', 0, 0], [',-16,16', -16, 16], [',16,-16', 16, -16]]) {
      assert.deepEqual(valid(scene(`react:signal(${JSON.stringify(name)}${tail})`)).layers[0].react,
        { type: 'signal', name, scale, offset });
    }
  }
  for (const [key, schema] of Object.entries(L.LAYER_SCHEMA)) {
    if (!schema.dynamic) continue;
    assert.deepEqual(valid(scene(`${key}:param("motion")`) + control()).layers[0][key], { type: 'param', name: 'motion' });
    assert.deepEqual(valid(scene(`${key}:signal("audio.level")`)).layers[0][key],
      { type: 'signal', name: 'audio.level', scale: 1, offset: 0 });
  }
  for (const value of ['signal()', 'signal("lead.hit",1,0,1)', 'param()', 'param("motion",1)'])
    invalid(scene('react:' + value) + control(), 'ARITY');
  for (const name of ['drums.pitch', 'audio.peak', 'audio.rms', 'beat', 'lead', 'constructor', '__proto__', 'Lead.hit', 'lead.hit '])
    invalid(scene(`react:signal(${JSON.stringify(name)})`), 'UNKNOWN_SIGNAL');
  for (const value of ['signal(1)', 'param(1)', 'signal("lead.hit","1")', 'signal("lead.hit",1,[])',
    'signal("lead.hit",param("motion"))', 'param(signal("lead.hit"))']) invalid(scene('react:' + value) + control(), 'TYPE');
  for (const value of ['signal("lead.hit",16.001)', 'signal("lead.hit",-16.001)',
    'signal("lead.hit",1,16.001)', 'signal("lead.hit",1,-16.001)']) invalid(scene('react:' + value), 'RANGE');
});

test('literal evaluation ranges clamp while static parameters reject excesses', () => {
  for (const [key, schema] of Object.entries(L.LAYER_SCHEMA)) {
    if (!schema.dynamic) continue;
    for (const [input, expected] of [[schema.min, schema.min], [schema.max, schema.max], [-1e308, schema.min], [1e308, schema.max]])
      assert.equal(valid(scene(`${key}:${input}`)).layers[0][key], expected);
    for (const value of ['"1"', '[]', '{}', '{type:"param",name:"motion"}', '{type:"signal",name:"lead.hit",scale:1,offset:0}'])
      invalid(scene(`${key}:${value}`) + control(), 'TYPE');
  }
  for (const blend of L.BLENDS) assert.equal(valid(scene(`blend:"${blend}"`)).layers[0].blend, blend);
  for (const blend of ['multiply', 'copy', 'destination-out', 'constructor', 'SCREEN']) invalid(scene(`blend:"${blend}"`), 'BLEND');
  for (const value of ['param("motion")', 'signal("lead.hit")', '"24"', '[]', '{}']) invalid(scene('count:' + value) + control(), 'TYPE');
  invalid(scene('blend:param("motion")') + control(), 'TYPE');
  invalid(scene('blend:1'), 'TYPE');
});

test('source byte bound is exact for ASCII, multibyte text and surrogate pairs', () => {
  const base = 'visual({});', prefix = base + '//';
  const atLimit = base + ' '.repeat(32768 - Buffer.byteLength(base));
  valid(atLimit);
  invalid(atLimit + ' ', 'SOURCE_LIMIT');
  invalid(' '.repeat(32769), 'SOURCE_LIMIT');
  for (const text of ['é', '雪', '🎵', '\ud800', '\udfff']) {
    const remaining = 32768 - Buffer.byteLength(prefix), width = Buffer.byteLength(text);
    const source = prefix + text.repeat(Math.floor(remaining / width)) + ' '.repeat(remaining % width);
    assert.equal(Buffer.byteLength(source), 32768);
    valid(source);
    invalid(source + text, 'SOURCE_LIMIT');
  }
  const enormous = '🎵'.repeat(1000000);
  assert.equal(invalid(enormous, 'SOURCE_LIMIT').span.start.offset, 16384);
});

test('4096-token bound counts punctuation and excludes comments and EOF', () => {
  // 3 prefix + 2046 value tokens + 2044 commas + 3 suffix = 4096.
  // Schema-invalid arrays exercise the lexical ceiling without another budget.
  const values = ['[]', ...Array(2044).fill('0')];
  const source = 'visual([' + values.join(',') + ']);';
  invalid(source, 'TYPE');
  invalid('// visual({}); signal("x",1);\n' + source + '// trailing tokens are commentary', 'TYPE');
  invalid(source.replace('visual([[]', 'visual([[0]'), 'TOKEN_LIMIT');
  invalid('visual([' + Array(2200).fill('0').join(',') + ']);', 'TOKEN_LIMIT');
});

test('depth 16 is accepted by parsing and depth 17 fails before validation', () => {
  for (const [open, close] of [['[', ']'], ['{x:', '}'], ['param(', ')']]) {
    const atLimit = 'visual(' + open.repeat(16) + '0' + close.repeat(16) + ');';
    invalid(atLimit, open === '{x:' ? 'UNKNOWN_KEY' : 'TYPE');
    invalid('visual(' + open.repeat(17) + '0' + close.repeat(17) + ');', 'DEPTH_LIMIT');
  }
  invalid('visual({palette:' + '['.repeat(15) + '0' + ']'.repeat(15) + '});', 'PALETTE_LIMIT');
  invalid('visual({palette:' + '['.repeat(16) + '0' + ']'.repeat(16) + '});', 'DEPTH_LIMIT');
  invalid('visual(' + '['.repeat(1000) + '0' + ']'.repeat(1000) + ');', 'DEPTH_LIMIT');
});

test('layer, control and total primitive budgets cover exact boundaries', () => {
  const eight = 'visual({});' + layer('count:64').repeat(8);
  const program = valid(eight);
  assert.equal(program.layers.length, 8);
  assert.equal(program.layers.reduce((sum, l) => sum + l.count, 0), 512);
  assert.equal(program.layers.reduce((sum, l) => sum + l.count * L.LIMITS.primitivesPerItem, 0), 2048);
  invalid(eight + layer('count:1'), 'LAYER_LIMIT');
  valid('visual({});' + layer('count:128').repeat(4));
  invalid('visual({});' + layer('count:128').repeat(4) + layer('count:1'), 'COUNT_LIMIT');
  invalid('visual({});' + layer('count:128').repeat(4) + layer(), 'COUNT_LIMIT');
  for (const count of [1, 128]) assert.equal(valid(scene('count:' + count)).layers[0].count, count);
  for (const count of [0, -1, 129, 0.5, 127.5, 1e308]) invalid(scene('count:' + count), 'RANGE');
  const controls = Array.from({ length: 8 }, (_, i) => control('knob_' + i)).join('');
  assert.equal(valid('visual({});' + controls).controls.length, 8);
  invalid('visual({});' + controls + control('ninth'), 'CONTROL_LIMIT');
  valid('visual({});' + layer('count:64').repeat(8) + controls);
});

test('palette, color, feedback and seed bounds are static and exact', () => {
  for (const count of [2, 8]) {
    const palette = Array(count).fill('#AbC012');
    assert.deepEqual(valid(`visual({palette:${JSON.stringify(palette)}});`).visual.palette, palette);
  }
  for (const count of [0, 1, 9]) invalid(`visual({palette:${JSON.stringify(Array(count).fill('#123456'))}});`, 'PALETTE_LIMIT');
  for (const color of ['#fff', '#12345678', '#gggggg', '123456', 'red', '#123456 ', 'url(https://example.invalid/x)']) {
    invalid(`visual({background:${JSON.stringify(color)}});`, 'COLOR');
    invalid(`visual({palette:["#123456",${JSON.stringify(color)}]});`, 'COLOR');
  }
  for (const value of ['1', '[]', '{}', 'param("motion")']) invalid(`visual({background:${value}});` + control(), 'TYPE');
  for (const value of ['"#123456"', '{}', 'param("motion")']) invalid(`visual({palette:${value}});` + control(), 'TYPE');
  invalid('visual({palette:[1,2]});', 'TYPE');
  for (const feedback of [0, 0.95]) assert.equal(valid(`visual({feedback:${feedback}});`).visual.feedback, feedback);
  for (const feedback of [-0.001, 0.951, 1]) invalid(`visual({feedback:${feedback}});`, 'RANGE');
  for (const seed of [0, 65535]) assert.equal(valid(`visual({seed:${seed}});`).visual.seed, seed);
  for (const seed of [-1, 65536, 0.5]) invalid(`visual({seed:${seed}});`, 'RANGE');
  for (const key of ['feedback', 'seed']) {
    for (const value of ['"1"', 'param("motion")', 'signal("beat.phase")']) invalid(`visual({${key}:${value}});` + control(), 'TYPE');
  }
});

test('all control fields, names, labels, endpoints and increments are bounded', () => {
  valid('visual({});' + control('a') + control('a' + '1'.repeat(23)));
  for (const name of ['', 'A', '_a', '1a', 'a-b', 'a.b', 'é', 'a'.repeat(25), '__proto__'])
    invalid('visual({});' + control(name), 'CONTROL_NAME');
  for (const label of ['x', 'x'.repeat(40), '🎵'.repeat(40)]) valid('visual({});' + control('motion', { label }));
  for (const label of ['', 'x'.repeat(41), '🎵'.repeat(41)]) invalid('visual({});' + control('motion', { label }), 'CONTROL_LABEL');
  for (const value of [-16, 16]) valid('visual({});' + control('motion', { min: -16, max: 16, step: 32, value }));
  valid('visual({});' + control('motion', { step: 5e-324 }));
  valid('visual({});' + control('motion', { value: 0.805 })); // No unspecified step-alignment restriction.
  for (const overrides of [{ min: -16.001 }, { max: 16.001 }, { min: 2, max: 2 }, { min: 3, max: 2 },
    { step: 0 }, { step: -1 }, { step: 2.001 }, { value: -0.001 }, { value: 2.001 }])
    invalid('visual({});' + control('motion', overrides));
  for (const key of Object.keys(controlFields)) {
    const incomplete = { ...controlFields }; delete incomplete[key];
    invalid('visual({});control("motion",' + JSON.stringify(incomplete) + ');', 'MISSING_KEY');
    invalid('visual({});' + control('motion', { [key]: key === 'label' ? 1 : '1' }), 'TYPE');
    const fields = Object.entries(controlFields).map(([k, value]) => k + ':' + (k === key ? 'param("other")' : JSON.stringify(value))).join(',');
    invalid('visual({});control("motion",{' + fields + '});' + control('other'), 'TYPE');
  }
});

test('unknown and duplicate keys fail in every object scope without prototype pollution', () => {
  for (const key of ['unknown', '__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty', 'width', 'height',
    'resolution', 'shader', 'canvas', 'asset', 'url', 'microphone']) {
    invalid(`visual({${JSON.stringify(key)}:1});`, 'UNKNOWN_KEY');
    invalid(scene(JSON.stringify(key) + ':1'), 'UNKNOWN_KEY');
    invalid('visual({});' + control('motion', { [key]: 1 }), 'UNKNOWN_KEY');
  }
  invalid('visual({feedback:0.8,feedback:0.9});', 'DUPLICATE_KEY');
  invalid(scene('count:1,"count":2'), 'DUPLICATE_KEY');
  invalid(String.raw`visual({feed\u0062ack:0.8});`);
  invalid(String.raw`visual({feedback:0.8,"feed\u0062ack":0.9});`, 'DUPLICATE_KEY');
  invalid('visual({});control("motion",{label:"A",label:"B",min:0,max:1,step:1,value:0});', 'DUPLICATE_KEY');
  invalid('visual({palette:[{x:1,x:2},"#123456"]});', 'DUPLICATE_KEY');
  invalid('visual({"__proto__":{},"__proto__":{}});', 'DUPLICATE_KEY');
  const source = 'visual({"__proto__":{polluted:1}});';
  invalid(source, 'UNKNOWN_KEY');
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(({}).polluted, undefined);
  valid('visual({});' + control('constructor') + control('prototype') + layer('speed:param("prototype")'));
});

test('comments, JSON escapes and quoted keys are data with no execution', () => {
  for (const newline of ['\n', '\r\n', '\r', '\u2028', '\u2029']) {
    valid('// ignored: while(true){}' + newline + '\tvisual // header' + newline + '( { } ) ; // trailing');
  }
  valid('\ufeff\u00a0visual({});\u2003');
  const labels = ['quote " slash / backslash \\', '\b\f\n\r\t', '🎵 orbit', '// not a comment', 'line\u2028break',
    'globalThis.__visualExecuted = 1;'];
  for (const label of labels) assert.equal(valid('visual({});' + control('motion', { label })).controls[0].label, label);
  const escaped = String.raw`visual({"back\u0067round":"\u0023090615",palette:["#ABCDEF","#123456"]});
control("mo\u0074ion",{label:"\u004d\uD83C\uDFB5\/\"\\",min:0,max:1,step:.1,value:1.});
layer("tun\u006eel",{speed:param("motion"),react:signal("lead\u002ehit")});`;
  const program = valid(escaped);
  assert.equal(program.visual.background, '#090615');
  assert.equal(program.controls[0].label, 'M🎵/"\\');
  assert.equal(program.layers[0].op, 'tunnel');
  for (const raw of [String.raw`\x41`, String.raw`\v`, String.raw`\0`, String.raw`\'`, String.raw`\uZZZZ`, String.raw`\u123`, '\\' + '\n'])
    invalid('visual({background:"' + raw + '"});', 'STRING_SYNTAX');
  for (let c = 0; c < 32; c++) invalid('visual({background:"abc' + String.fromCharCode(c) + 'def"});', 'STRING_SYNTAX');
  invalid('visual({background:"unterminated});', 'STRING_SYNTAX');
  invalid('visual({background:"ends in \\', 'STRING_SYNTAX');
  invalid('/* block comments are not part of this language */ visual({});', 'SYNTAX');
});

test('finite decimal literals accept fractions and exponents, never expressions', () => {
  for (const [literal, expected] of [['.5', 0.5], ['-.5', -0.5], ['1.', 1], ['1e-2', 0.01], ['1E+0', 1], ['-4.0e0', -4], ['0e999', 0]])
    assert.equal(valid(scene('speed:' + literal)).layers[0].speed, expected);
  for (const value of ['1e309', '-1e309', '9'.repeat(400)]) invalid(scene('speed:' + value), 'NUMBER_FINITE');
  for (const value of ['NaN', 'Infinity', '-Infinity', '+1', '01', '-01', '0x10', '0b10', '0o10', '1_000',
    '1n', '1e', '1e+', '.', '-', '1.2.3', '1+2', '1-2', '1/2', '1*2', '(1)', 'true', 'false', 'null', 'undefined'])
    invalid(scene('speed:' + value));
});

test('statement arity, semicolons, restricted values and complete input are enforced', () => {
  for (const source of ['', ' ', '// only a comment']) invalid(source, 'MISSING_VISUAL');
  invalid(layer(), 'MISSING_VISUAL');
  invalid('visual({});visual({});', 'DUPLICATE_VISUAL');
  for (const source of ['visual({})', 'visual({})\n' + layer(), 'visual({});;', 'visual();', 'visual({},{});',
    'visual([]);', 'visual(1);', 'visual("x");', 'visual({feedback:.8,});', 'visual({palette:["#123456","#654321",]});',
    'visual({,});', 'visual({feedback .8});', 'visual({0:.8});', 'visual({["feedback"]:.8});',
    'visual({});layer("tunnel");', 'visual({});layer("tunnel",{},1);', 'visual({});layer("tunnel",[]);',
    'visual({});layer(tunnel,{});', 'visual({});layer(1,{});', 'visual({});control("motion");',
    'visual({});control("motion",{},{});', 'visual({});layer("tunnel",{react:signal("lead.hit",)});',
    'visual({});layer("tunnel",{size:[,]});', "visual({'feedback':0.8});", 'visual({feedback:`x`});',
    'visual({}); }', 'visual({}); garbage', 'visual({}); /* trailing */']) invalid(source);
  for (const op of ['grid', 'orb', 'TUNNEL', '__proto__', 'constructor', 'tunnel ']) invalid(scene('', op), 'OPERATION');
  for (const call of ['unknown', 'constructor', 'toString', '__proto__']) invalid(call + '({});', 'STATEMENT');
  const complete = 'visual({});' + control() + layer('speed:param("motion")');
  for (let end = 0; end < complete.length; end++) {
    const prefix = complete.slice(0, end), result = compile(prefix);
    if (result.ok) { assert(prefix.endsWith(';')); frozen(result.program); }
    else assert.notEqual(result.diagnostics[0].code, 'INTERNAL');
  }
});

test('diagnostics point at offending tokens, including Unicode and CRLF', () => {
  for (const newline of ['\n', '\r\n', '\r', '\u2028', '\u2029']) {
    const prefix = '// 🎵' + newline + 'visual({});' + newline + '  ';
    const source = prefix + 'layer("tunnel", {bogus: 1});';
    const diagnostic = invalid(source, 'UNKNOWN_KEY'), offset = source.indexOf('bogus');
    assert.deepEqual(diagnostic.span, { start: { offset, line: 3, column: 20 },
      end: { offset: offset + 5, line: 3, column: 25 } });
  }
  const source = 'visual({});\nlayer("tunnel", {speed:param("missing")});';
  const diagnostic = invalid(source, 'UNKNOWN_CONTROL');
  assert.equal(source.slice(diagnostic.span.start.offset, diagnostic.span.end.offset), '"missing"');
  const missing = 'visual({})';
  assert.deepEqual(invalid(missing, 'SYNTAX').span.start, { offset: missing.length, line: 1, column: missing.length + 1 });
  const utf16 = 'visual({});' + control('motion', { label: '🎵' }) + layer('bogus:1');
  const at = utf16.indexOf('bogus');
  assert.equal(invalid(utf16, 'UNKNOWN_KEY').span.start.column, at + 1);
});

const attacks = [
  'globalThis.__visualExecuted=1;', 'process.exit(1);', 'require("node:fs");', 'import("node:fs");',
  'visual({});while(true){}', 'visual({});for(;;){}', 'visual({});function f(){}',
  'visual({});(()=>{globalThis.__visualExecuted=1})()', 'visual({});eval("globalThis.__visualExecuted=1");',
  'visual({});Function("globalThis.__visualExecuted=1")();', 'visual({});new Function("return 1")();',
  'visual({});fetch("https://example.invalid");', 'visual({});document.createElement("canvas");',
  'visual({});navigator.mediaDevices.getUserMedia({audio:true});', 'visual({});setInterval("x",0);',
  'visual({});layer("tunnel",{size:Math.random()});', 'visual({});layer("tunnel",{size:Date.now()});',
  'visual({});layer("tunnel",{size:param("motion").value});',
  'visual({});layer("tunnel",{size:signal["constructor"]("return this")()});',
  'visual({});layer("tunnel",{size:{}.constructor.constructor("return this")()});',
  'visual({});layer("tunnel",{size:(globalThis.__visualExecuted=1)});',
  'visual({});layer("tunnel",{size:1?2:3});', 'visual({});layer("tunnel",{get size(){return 1}});',
  'visual({});layer("tunnel",{...{size:1}});', 'visual({});layer("tunnel",{size:/x/.test("x")});',
  'visual({});layer("tunnel",{size:`${globalThis.__visualExecuted=1}`});'
];
test('hostile source cannot execute, access resources or spoof dynamic nodes', () => {
  const before = Object.getOwnPropertyDescriptor(globalThis, '__visualExecuted');
  for (const source of attacks) invalid(source);
  assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, '__visualExecuted'), before);
  assert.equal(Object.prototype.polluted, undefined);
  const moduleSource = fs.readFileSync(path.join(__dirname, '../src/visual-language.js'), 'utf8');
  assert(!/\b(?:eval|Function)\s*\(/.test(moduleSource));
  assert(!/\b(?:require|import|fetch|setTimeout|setInterval|requestAnimationFrame)\s*\(/.test(moduleSource));
});

test('non-string input is rejected without coercion, getters or proxy traps', () => {
  let touched = 0;
  const malicious = { toString() { touched++; throw Error('coerced'); }, get source() { touched++; throw Error('read'); } };
  const trapped = new Proxy({}, { get() { touched++; throw Error('trap'); }, ownKeys() { touched++; throw Error('keys'); } });
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  for (const value of [undefined, null, 0, 1, NaN, Infinity, true, Symbol('source'), 1n, [], {},
    new String('visual({});'), () => {}, malicious, trapped, revoked.proxy]) invalid(value, 'SOURCE_TYPE');
  assert.equal(touched, 0);
});

test('successful programs and shared schema are deeply frozen and detached', () => {
  const source = scene('speed:param("motion"),react:signal("lead.hit")') + control();
  const first = valid(source), second = valid(source);
  assert.deepEqual(first, second);
  function detached(a, b) {
    if (!a || typeof a !== 'object') return;
    assert.notEqual(a, b, 'each compilation owns all nested program data');
    for (const key of Object.keys(a)) detached(a[key], b[key]);
  }
  detached(first, second);
  assert.notEqual(first.visual.palette, L.VISUAL_DEFAULTS.palette);
  for (const mutate of [() => { first.version = 2; }, () => { first.visual.palette[0] = '#000000'; },
    () => first.layers.push({}), () => { first.controls[0].value = 0; }, () => { first.layers[0].speed.name = 'other'; },
    () => { first.layers[0].react.scale = 100; }, () => { first.layers[0].extra = 1; },
    () => { delete first.visual.seed; }, () => { L.LAYER_SCHEMA.speed.max = 999; },
    () => { L.PRESETS[0].source = 'bad'; }, () => L.SIGNALS.push('evil'), () => { L.LIMITS.tokens = 99999; }])
    assert.throws(mutate, TypeError);
  const externalValues = Object.fromEntries(first.controls.map(c => [c.name, c.value]));
  externalValues.motion = 1.7;
  assert.equal(first.controls[0].value, 0.8);
  const copy = plain(first); copy.visual.palette[0] = '#000000'; copy.layers[0].react.scale = 16;
  assert.deepEqual(valid(source), first);
  const failed = compile('invalid'); failed.diagnostics[0].span.start.line = 999;
  assert.equal(invalid('invalid').span.start.line, 1);
});

test('browser, CommonJS and AMD agree with string code generation disabled', () => {
  const moduleSource = fs.readFileSync(path.join(__dirname, '../src/visual-language.js'), 'utf8');
  // Only this trusted module is loaded as JS. Authored visual text is always
  // passed as data into compile; the VM prohibits dynamic code generation.
  const options = { codeGeneration: { strings: false, wasm: false } };
  const browser = vm.createContext({}, options);
  vm.runInContext(moduleSource, browser, { timeout: 1000 });
  assert.deepEqual(Object.keys(browser), ['CT_VISUAL_LANGUAGE']);
  const common = vm.createContext({ module: { exports: {} } }, options);
  vm.runInContext(moduleSource, common, { timeout: 1000 });
  let amd;
  const define = (dependencies, factory) => { assert.equal(dependencies.length, 0); amd = factory(); };
  define.amd = {};
  const amdContext = vm.createContext({ define }, options);
  vm.runInContext(moduleSource, amdContext, { timeout: 1000 });
  assert(amd && !amdContext.CT_VISUAL_LANGUAGE);
  for (const language of [browser.CT_VISUAL_LANGUAGE, common.module.exports, amd]) {
    for (const preset of L.PRESETS) assert.deepEqual(plain(valid(preset.source, language)), plain(valid(preset.source)));
    for (const source of attacks) {
      const actual = invalid(source, undefined, language), expected = invalid(source);
      assert.deepEqual(plain(actual), plain(expected));
    }
    assert.deepEqual(plain(language.LAYER_SCHEMA), plain(L.LAYER_SCHEMA));
    frozen(language);
  }
  assert.equal(browser.__visualExecuted, undefined);
});

test('deterministic malformed-input corpus never throws or returns partial IR', () => {
  let state = 0x71c49e2b;
  const alphabet = 'visualcontrolayersignpm0123456789_{}[](),:;"\\/-+.*= \n\ré🎵';
  function random(max) { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) % max; }
  for (let i = 0; i < 1000; i++) {
    let source = '';
    const length = random(300);
    for (let j = 0; j < length; j++) source += alphabet[random(alphabet.length)];
    invalid(source);
  }
  const source = L.PRESETS[0].source;
  for (let i = 0; i < 250; i++) {
    const at = random(source.length), edited = source.slice(0, at) + alphabet[random(alphabet.length)] + source.slice(at + 1);
    const result = compile(edited);
    if (result.ok) {
      frozen(result.program);
      assert(result.program.layers.length <= 8 && result.program.controls.length <= 8);
      assert(result.program.layers.reduce((sum, l) => sum + l.count, 0) <= 512);
    } else {
      assert.equal(result.program, null);
      assert.notEqual(result.diagnostics[0].code, 'INTERNAL');
    }
  }
});

process.stdout.write(`Visual language verified: ${groups} groups, ${compilations} compilations.\n`);
