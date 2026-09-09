'use strict';
// Pure compiler contract coverage: no editor bundle, browser, build or network.
const assert = require('node:assert/strict');
const L = require('../src/music-language.js');
const H = require('../src/gb-hardware.js');
let checks = 0;
function test(name, fn) { fn(); checks++; console.log('ok ' + name); }
function valid(source) {
  const result = L.compile(source);
  assert.ok(result.gb, JSON.stringify(result.diagnostics));
  assert.ok(Array.isArray(result.controls));
  assert.ok(Number.isInteger(result.controlsOmitted) && result.controlsOmitted >= 0 && result.controlsOmitted <= L.LIMITS.source);
  assert.ok(!result.diagnostics.some(d => d.severity === 'error'));
  let end = -1;
  for (const c of result.controls) {
    assert.ok(c.literalSpan.start.offset > end, 'unique calls in source order');
    end = c.literalSpan.end.offset;
  }
  return result;
}
function invalid(source, message) {
  const result = L.compile(source);
  assert.equal(result.gb, null);
  assert.deepEqual(result.controls, [], 'no partial or stale control authority');
  assert.equal(result.controlsOmitted, 0);
  assert.deepEqual(result.mapping, []);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].severity, 'error');
  if (message) assert.match(result.diagnostics[0].message, message);
  return result;
}
function span(source, from, to) {
  function pos(offset) {
    const before = source.slice(0, offset);
    return { offset, line: before.split('\n').length, column: offset - before.lastIndexOf('\n') };
  }
  return { start: pos(from), end: pos(to) };
}
function exactSpan(source, text, from = 0) {
  const at = source.indexOf(text, from);
  assert.ok(at >= 0, 'fixture text: ' + text);
  return span(source, at, at + text.length);
}
function slice(source, s) { return source.slice(s.start.offset, s.end.offset); }
function expected(source, type, name, owner, kind, call, literal, ownerFrom = 0, callFrom = 0) {
  const ownerAt = source.indexOf(owner, ownerFrom), callAt = source.indexOf(call, ownerAt + callFrom);
  const literalAt = source.indexOf(literal, callAt);
  assert.ok(ownerAt >= 0 && callAt >= ownerAt && literalAt >= callAt);
  assert.ok(callAt + call.length <= ownerAt + owner.length);
  const bounds = { gate: [.001, 1, false], velocity: [0, 1, false], transpose: [-128, 128, true] }[kind];
  return { kind, value: Number(literal), literalSpan: span(source, literalAt, literalAt + literal.length),
    callSpan: span(source, callAt, callAt + call.length), ownerSpan: span(source, ownerAt, ownerAt + owner.length),
    ownerType: type, ownerName: name, min: bounds[0], max: bounds[1], integer: bounds[2] };
}

test('exact UTF16 spans, decoded names, CRLF, multiline calls and comments', () => {
  const gate = '. /* dot 🎼 */ gate /* name */ (\r\n    /* before */ 9.123456e-1 /* after .gate(0) */\r\n  )';
  const velocity = '. // dot comment\r\n  velocity ( // before\r\n    0.70 // after\r\n  )';
  const transpose = '.transpose(/* 🎵 before */ -02 /* after */)';
  const pattern = String.raw`pattern("mel\u006fdy🎵", notes("C4 .")` + gate + velocity + transpose + '\r\n)';
  const track = String.raw`track("le\u0061d")` + '.transpose(2).instrument(0).play("melody🎵").transpose(-1E+1)';
  const source = '// 🎵 UTF16\r\nsong({tempo:120,bars:1});\r\n  ' + pattern + ' /* outside */;\r\n' + track + ' // tail 🎵\r\n';
  const result = valid(source);
  assert.equal(L.VERSION, '1', 'additive view metadata keeps the language version');
  assert.equal(result.controlsOmitted, 0);
  assert.deepEqual(result.controls, [
    expected(source, 'pattern', 'melody🎵', pattern, 'gate', gate, '9.123456e-1'),
    expected(source, 'pattern', 'melody🎵', pattern, 'velocity', velocity, '0.70'),
    expected(source, 'pattern', 'melody🎵', pattern, 'transpose', transpose, '-02'),
    expected(source, 'track', 'lead', track, 'transpose', '.transpose(2)', '2'),
    expected(source, 'track', 'lead', track, 'transpose', '.transpose(-1E+1)', '-1E+1')
  ]);
  assert.deepEqual(result.controls.map(c => slice(source, c.literalSpan)), ['9.123456e-1', '0.70', '-02', '2', '-1E+1']);
  assert.equal(result.gb.notes[0].midi, 60, 'transpose after final play is metadata, not retroactive music');
  assert.equal(result.gb.notes[0].vel, .7);
  assert.deepEqual(valid(source), result, 'deterministic and source spelling remains authoritative');
  const sameNumbers = source.replace('9.123456e-1', '.9123456').replace('0.70', '.7').replace('-02', '-2').replace('-1E+1', '-10');
  assert.deepEqual(valid(sameNumbers).gb, result.gb, 'spelling and comments do not change music');
});

test('numeric grammar, exact bounds, leading zeroes, exponent signs and negative zero', () => {
  const spellings = {
    gate: ['.001', '1.', '001e-3', '0.00001e+2', '9.123456e-1'],
    velocity: ['-0', '-0.0', '-.0', '.70', '0e999', '1E+0', '0001.'],
    transpose: ['-128', '128', '-02', '1e2', '-1E+2', '-0', '01.0', '0.']
  };
  for (const [kind, literals] of Object.entries(spellings)) for (const literal of literals) {
    const call = '.' + kind + '(/* pre */ ' + literal + ' /* post */)';
    for (const type of kind === 'transpose' ? ['pattern', 'track'] : ['pattern']) {
      const owner = type === 'pattern' ? 'pattern("p",notes(".")' + call + ')' : 'track("lead")' + call;
      const source = 'song({totalFrames:0});' + owner + ';';
      const result = valid(source);
      assert.deepEqual(result.controls, [expected(source, type, type === 'pattern' ? 'p' : 'lead', owner, kind, call, literal)]);
      assert.ok(Object.is(result.controls[0].value, Number(literal)), 'signed zero is preserved');
    }
  }
});

test('forward references, repeated plays and identical declarations emit each source call once', () => {
  const track = 'track("lead").transpose(0).instrument(0).play("p",{repeat:4})';
  const pattern = 'pattern("p",notes("C4 .").gate(.5).gate(.5).velocity(.7).transpose(0))';
  const source = 'song({bars:2});\n' + track + '\n' + pattern + '\n' + track;
  const result = valid(source);
  assert.deepEqual(result.controls, [
    expected(source, 'track', 'lead', track, 'transpose', '.transpose(0)', '0'),
    expected(source, 'pattern', 'p', pattern, 'gate', '.gate(.5)', '.5'),
    expected(source, 'pattern', 'p', pattern, 'gate', '.gate(.5)', '.5', 0, pattern.indexOf('.gate(.5)') + 1),
    expected(source, 'pattern', 'p', pattern, 'velocity', '.velocity(.7)', '.7'),
    expected(source, 'pattern', 'p', pattern, 'transpose', '.transpose(0)', '0'),
    expected(source, 'track', 'lead', track, 'transpose', '.transpose(0)', '0', source.lastIndexOf(track))
  ]);
  assert.equal(result.mapping.length, 8);
  assert.equal(result.diagnostics.filter(d => d.code === 'CHIP_OVERLAP').length, 4);
});

test('unused and all-rest patterns, empty tracks and post-play transforms retain controls', () => {
  const unused = 'pattern("unused",notes("C4").gate(.2).velocity(.3).transpose(-128))';
  const rest = 'pattern("rests",notes(".:65536").stepsPerBar(1).gate(.001).velocity(0).transpose(128))';
  const track = 'track("bass").transpose(-128).instrument(18).play("rests",{atBar:65536,repeat:4096}).transpose(128)';
  const empty = 'track("lead").transpose(7)';
  const source = 'song({bars:1});\n' + [unused, rest, track, empty].join(';\n');
  const result = valid(source);
  assert.deepEqual(result.gb.notes, []);
  assert.deepEqual(result.mapping, []);
  assert.deepEqual(result.controls.map(c => [c.ownerType, c.ownerName, c.kind, c.value]), [
    ['pattern', 'unused', 'gate', .2], ['pattern', 'unused', 'velocity', .3], ['pattern', 'unused', 'transpose', -128],
    ['pattern', 'rests', 'gate', .001], ['pattern', 'rests', 'velocity', 0], ['pattern', 'rests', 'transpose', 128],
    ['track', 'bass', 'transpose', -128], ['track', 'bass', 'transpose', 128], ['track', 'lead', 'transpose', 7]
  ]);
  for (const [owner, count] of [[unused, 3], [rest, 3], [track, 2], [empty, 1]])
    assert.equal(result.controls.filter(c => slice(source, c.ownerSpan) === owner).length, count);
  // The existing compiler only interprets note tokens on play. Metadata must
  // not introduce eager validation or alter that behavior for unused strings.
  for (const text of ['', 'not-a-note', '.gate(.5)']) {
    const s = 'song({bars:1});pattern("p",notes(' + JSON.stringify(text) + ').gate(.5))';
    assert.equal(valid(s).controls.length, 1);
    invalid(s + ';track("lead").instrument(0).play("p")');
  }
});

test('only supported direct calls produce descriptors; object data and fake calls do not', () => {
  const source = `// pattern("fake",notes("C4").gate(.5))
song({totalFrames:20,settings:{tempo:120,hint:".transpose(12)",gate:.7}});
instruments([[128,240,255,0]]);
performance({gate:.4,velocity:.9,transpose:2,note:".velocity(.7)"});
pattern(".gate(.8)",notes("C4@0.2").stepsPerBar(8).register(3));
track("lead").instrument(0).play(".gate(.8)",{atBar:0,repeat:1});
event({ch:0,frame:0,frames:5,midi:60,inst:0,vel:.4,gate:.2,transpose:-2});`;
  const result = valid(source);
  assert.deepEqual(result.controls, []);
  assert.equal(result.gb.notes.length, 2);
  assert.equal(result.gb.gate, .4);
  assert.equal(result.gb.notes[0].transpose, -2, 'exact extra fields retain existing order and values');
  assert.deepEqual(valid('song({totalFrames:0})').controls, []);
});

test('GB, settings, complete legacy mappings, materialization and PCM match known music', () => {
  const settings = { tempo:120, bars:2 };
  const pattern = 'pattern("p",notes("B2 . C3:2@0.4").stepsPerBar(8).transpose(1).register(3).gate(.5).velocity(.6))';
  const play1 = '.play("p",{repeat:2})', play2 = '.play("p",{atBar:1})';
  const track = 'track("bass").transpose(12).instrument(18)' + play1 + '.transpose(-12)' + play2 + '.transpose(128)';
  const source = 'song({tempo:120,bars:2});\n' + pattern + ';\n' + track + ' /* legacy tail 🎵 */\n';
  const result = valid(source);
  // Recorded from the pre-descriptor compiler, using the GB frame clock.
  const notes = [[0,7,60],[30,15,61],[60,7,60],[90,15,61],[119,8,48],[149,15,49]]
    .map(([frame,frames,midi]) => ({ch:2,frame,frames,midi,inst:18,vel:.6}));
  const gb = { notes, totalFrames:239, loopFrames:239, bank:H.buildBank([]) };
  assert.deepEqual(result.gb, gb);
  assert.deepEqual(result.settings, settings);
  assert.deepEqual(result.diagnostics, []);
  const trackAt = source.indexOf(track), secondAt = source.indexOf(play2, trackAt);
  const mappings = notes.map((n, i) => {
    const playAt = i < 4 ? source.indexOf(play1, trackAt) : secondAt, rep = Math.floor(i / 2);
    return { noteIndex:i, span:exactSpan(source, pattern), pattern:'p', occurrence:i < 4 ? Math.floor(i / 2) : 0,
      patternNote:i % 2, track:'bass', occurrenceSpan:span(source, playAt + 1, source.length),
      tokenSpan:exactSpan(source, i % 2 ? 'C3' : 'B2'),
      playSpan:span(source, playAt, playAt + (i < 4 ? play1 : play2).length),
      trackSpan:span(source, trackAt, source.length), occurrenceStartFrame:[0,60,119][rep], occurrenceEndFrame:[60,119,179][rep] };
  });
  assert.deepEqual(result.mapping, mappings, 'mapping still includes legacy trailing trivia');
  assert.deepEqual(result.controls.map(c => slice(source, c.ownerSpan)), [pattern, pattern, pattern, track, track, track]);
  const materialized = valid(L.materialize(gb, settings));
  assert.deepEqual(materialized.controls, []);
  assert.deepEqual(materialized.gb, gb);
  const apu = require('../src/gb-apu.js'), before = apu.render(gb, 8000), after = apu.render(result.gb, 8000);
  assert.ok(before.some(n => n !== 0), 'known fixture is audible');
  assert.deepEqual(Buffer.from(after.buffer), Buffer.from(before.buffer), 'byte-identical PCM');
});

const prefix = 'song({bars:1});pattern("p",notes("C4").gate(.5).velocity(.7).transpose(0));';
test('invalid literal syntax and bounds never expose earlier valid controls', () => {
  const bad = {
    gate: ['0', '-0', '-.1', '1.01', 'true', 'null', '".5"', '[.5]', '{value:.5}', '.5,.6', '.5+.1', '(.5)', '+.5', 'value', '1e999', '1e', '0x1', '/*empty*/'],
    velocity: ['-.001', '1.001', 'false', 'Infinity', 'NaN', '0_1', '.5*1', '.5,'],
    transpose: ['-129', '129', '1.5', '+02', '- 2', '-/*gap*/2', '2e-1', '2+1', 'null', '[2]', '"2"', '']
  };
  for (const [kind, literals] of Object.entries(bad)) for (const literal of literals) {
    invalid(prefix + 'pattern("bad",notes("C4").' + kind + '(' + literal + '))');
    if (kind === 'transpose') invalid(prefix + 'track("lead").transpose(' + literal + ')');
  }
  invalid(prefix + 'pattern("bad",notes("C4").gate(.5).constructor(1))');
  for (const kind of ['gate', 'velocity']) invalid(prefix + 'track("lead").' + kind + '(.5)');
});

test('every validation phase fails closed, and warnings alone retain controls', () => {
  for (const suffix of [
    'unknown({})', '/* unclosed', 'pattern("p",notes("C4").gate(.5))', 'song({bars:1})',
    'track("unknown").transpose(0)', 'track("lead").play("p").transpose(0)',
    'track("lead").instrument(999).transpose(0)', 'track("lead").instrument(0).play("missing").transpose(0)',
    'track("lead").instrument(0).play("p",{repeat:4097}).transpose(0)',
    'track("lead").instrument(0).play("p",{atBar:1}).transpose(0)',
    'track("lead").transpose(128).instrument(0).play("p")',
    'pattern("long",notes("C4:8").stepsPerBar(4).gate(1));track("lead").instrument(0).play("long")',
    'instruments([[0,0,0]])', 'waves([[16]])',
    'event({ch:0,frame:0,frames:1,midi:60,inst:0,vel:2})',
    'automation({f:0,r:99,v:0})', 'vibratoOff({f:0,ch:2})', 'waveLoad({f:0,slot:99})', 'kit({f:0,id:255})'
  ]) invalid(prefix + suffix);
  invalid(prefix.replace('song({bars:1});', ''), /song/);
  invalid(prefix.replace('bars:1', 'bars:65536'), /totalFrames/);
  invalid(prefix.replace('bars:1', 'bars:1,tempo:0'), /tempo/);
  invalid(prefix.replace('bars:1', 'bars:1,tempoAt:[[8,120],[4,150]]'), /tempoAt/);
  for (const source of [null, undefined, 42, {}, '']) invalid(source);
  const warnings = 'song({totalFrames:10});instruments([[128,240,255,0]]);pattern("p",notes(".").gate(.5));' +
    'event({ch:0,frame:0,frames:15,midi:60,inst:0});event({ch:0,frame:1,frames:1,midi:64,inst:0});';
  const result = valid(warnings);
  assert.deepEqual(result.diagnostics.map(d => d.code), ['SONG_END_CUT', 'CHIP_OVERLAP']);
  assert.equal(result.controls.length, 1);
  invalid(warnings + 'automation({f:0,r:99,v:0})');
  assert.equal(valid(prefix).controls.length, 3, 'failures cannot poison later compiles');
});

test('source, data, nesting, step, event and work budgets also clear descriptors', () => {
  invalid(prefix + 'performance({data:' + '['.repeat(L.LIMITS.depth + 1) + '0' + ']'.repeat(L.LIMITS.depth + 1) + '})', /Data resource/);
  invalid(prefix + 'performance({data:[' + '0,'.repeat(L.LIMITS.nodes) + '0]})', /Data resource/);
  invalid(prefix + 'pattern("long",notes(".:65537").gate(.5));track("lead").instrument(0).play("long")', /length/);
  invalid(prefix + 'pattern("many",notes("' + Array(13).fill('C4').join(' ') + '").gate(.5));track("lead").instrument(0).play("many",{repeat:4096})', /Event expansion/);
  const rests = Array(L.LIMITS.steps).fill('.').join(' ');
  invalid('song({bars:1});pattern("rests",notes("' + rests + '").gate(.5));track("lead").instrument(0)' + '.play("rests")'.repeat(16), /Compilation work/);
  const head = 'song({totalFrames:0});\npattern("p",notes(".").gate(/*🎵\n', tail = '\n*/ .50))';
  const source = head + 'x'.repeat(L.LIMITS.source - head.length - tail.length) + tail;
  const result = valid(source);
  assert.equal(source.length, L.LIMITS.source);
  assert.equal(result.controls.length, 1);
  assert.deepEqual(result.controls[0].literalSpan, exactSpan(source, '.50'));
  assert.deepEqual(result.controls[0].callSpan, span(source, source.indexOf('.gate'), source.length - 1));
  invalid(source + ' ', /Source size/);
});

test('50,000 descriptors stay ordered; overflow reports omissions without rejecting music', () => {
  assert.equal(L.LIMITS.controls, 50000, 'matches the editor descriptor contract');
  const head = 'song({totalFrames:0});\npattern("p🎵",notes(".")', call = '.gate(.5)\n';
  const source = head + call.repeat(L.LIMITS.controls) + ')';
  const result = valid(source), owner = span(source, source.indexOf('pattern'), source.length);
  assert.equal(result.controls.length, L.LIMITS.controls);
  assert.equal(result.controlsOmitted, 0);
  assert.deepEqual(result.gb, {notes:[],totalFrames:0});
  for (let i = 0; i < result.controls.length; i++) {
    const c = result.controls[i], at = head.length + i * call.length;
    const column = i ? 1 : head.length - head.lastIndexOf('\n');
    assert.deepEqual(c.literalSpan, {start:{offset:at+6,line:i+2,column:column+6},end:{offset:at+8,line:i+2,column:column+8}});
    assert.deepEqual(c.callSpan, {start:{offset:at,line:i+2,column},end:{offset:at+9,line:i+2,column:column+9}});
    assert.deepEqual(c.ownerSpan, owner);
    assert.equal(c.value, .5);
  }
  const overflow = valid(head + call.repeat(L.LIMITS.controls + 1) + ')');
  assert.equal(overflow.controls.length, L.LIMITS.controls);
  assert.equal(overflow.controlsOmitted, 1);
  for (const key of ['gb', 'settings', 'mapping', 'diagnostics']) assert.deepEqual(overflow[key], result[key]);
  assert.equal(overflow.controls.at(-1).literalSpan.start.offset, result.controls.at(-1).literalSpan.start.offset);
  const split = 'song({totalFrames:0});pattern("p",notes(".")' + '.gate(.5)'.repeat(25000) + ');';
  const aggregate = valid(split + 'track("lead")' + '.transpose(0)'.repeat(25001));
  assert.equal(aggregate.controls.length, L.LIMITS.controls);
  assert.equal(aggregate.controlsOmitted, 1);
  assert.equal(aggregate.controls[24999].ownerType, 'pattern');
  assert.equal(aggregate.controls[25000].ownerType, 'track');
  assert.deepEqual(aggregate.gb, {notes:[],totalFrames:0,bank:H.buildBank([])});
  invalid(head + call.repeat(L.LIMITS.controls + 1) + ');automation({f:0,r:99,v:0})', /register write/);
});

test('omitted pattern and track controls still apply their complete musical transformations', () => {
  const pattern = 'pattern("p",notes("C4")' + '.gate(.5)'.repeat(L.LIMITS.controls) + '.gate(.25))';
  const track = 'track("lead").transpose(12).instrument(0).play("p").transpose(128)';
  const source = 'song({bars:1});' + pattern + ';' + track;
  const result = valid(source);
  const compact = valid('song({bars:1});pattern("p",notes("C4").gate(.25));' + track);
  assert.equal(result.controls.length, L.LIMITS.controls);
  assert.equal(result.controlsOmitted, 3);
  assert.equal(result.controls.at(-1).value, .5, 'the final gate and both track transposes were omitted');
  assert.deepEqual(result.gb, compact.gb, 'omissions cannot discard actual transformations');
  assert.deepEqual(result.settings, compact.settings);
  assert.deepEqual(result.diagnostics, compact.diagnostics);
  assert.equal(result.gb.notes[0].midi, 72);
  assert.equal(result.gb.notes[0].frames, 2);
  assert.deepEqual(result.mapping[0].span, exactSpan(source, pattern));
  assert.deepEqual(result.mapping[0].tokenSpan, exactSpan(source, 'C4'));
  assert.deepEqual(result.mapping[0].playSpan, exactSpan(source, '.play("p")'));
  assert.deepEqual(result.mapping[0].trackSpan, exactSpan(source, track));
});

console.log('music-control-descriptors: ' + checks + ' groups passed');
