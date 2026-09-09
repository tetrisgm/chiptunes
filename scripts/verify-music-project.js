'use strict';
// Pure Node + browser-global contract tests. Compiler stub deliberately accepts
// arbitrary explicit GB fields, so proposal checks cannot rely on model claims.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const P = require('../src/music-project.js');
let tests = 0;
function test(name, fn) { fn(); tests++; console.log('ok ' + name); }
const fixture = {
  gb: {
    totalFrames: 240, loopFrames: 0, masterVolume: 0.75,
    notes: [
      {ch: 0, frame: 1.25, frames: 80.5, midi: 60, inst: 0, vel: 0.8, pri: 8, trigger: false},
      {ch: 3, frame: 120, frames: 12, midi: null, inst: 1, vel: 1, pri: 9}
    ],
    auto: [{f: 20, r: 0x13, v: 7}], vibOff: [{f: 20, ch: 0}],
    waveLoads: [{f: 30, slot: 2}], kit: [{f: 100, id: 0}],
    bank: {instruments: [[1, 2, 3]], waves: [[0, 15, 3]], kit: [[1, 4]]},
    tempoMap: [{frame: 0, bpm: 123}, {frame: 90, bpm: 97}]
  }, settings: {tempo: 123, key: 'C major'}, mapping: [{from: 8, to: 12, note: 0}]
};
const header = '// keep comments 🎵\r\n  ';
const source = header + JSON.stringify(fixture, null, 2) + '\n';
function compile(s) {
  const parsed = JSON.parse(s.slice(s.indexOf('{')));
  return {...parsed, diagnostics: []};
}
const options = {compile, assetsVersion: 'bank-1', languageVersion: '1', compilerVersion: '1'};
function fresh() { return P.create(source, options); }
function change(p, id, from, to, constraints) {
  const base = p.beginRequest(id); assert.equal(base.ok, true);
  const offset = base.baseSource.indexOf(from); assert.ok(offset >= 0);
  return p.propose({id, baseRevision: base.baseRevision, baseSource: base.baseSource,
    edits: [{from: offset, to: offset + from.length, text: to}]}, constraints);
}
test('source, compiled timing/automation fidelity and detached state', () => {
  const p = fresh(); assert.equal(p.draft, source); assert.equal(p.validated.source, source);
  assert.deepEqual(p.validated.compiled.gb, fixture.gb);
  const view = p.validated; view.compiled.gb.notes[0].frame = 999;
  assert.equal(p.validated.compiled.gb.notes[0].frame, 1.25);
  assert.equal(p.applyDraft().unchanged, true);
  assert.deepEqual(p.validate().compiled, p.validated.compiled);
});
test('invalid draft preserves audio, validated source and recovery', () => {
  const p = fresh(), revision = p.validated;
  const q = p.queue(revision.id).pending;
  assert.equal(p.playing, null); assert.equal(p.ack(q.revisionId, q.queueId).ok, true);
  p.editDraft(source + ' broken'); assert.equal(p.applyDraft().ok, false);
  assert.equal(p.playing, revision.id); assert.deepEqual(p.validated, revision);
  const serialized = p.serialize(), recovered = P.restore(serialized, options);
  assert.equal(recovered.ok, true); assert.equal(recovered.project.draft, source + ' broken');
  assert.deepEqual(recovered.project.validated, revision);
  assert.equal(recovered.project.playing, null); assert.equal(recovered.project.pending, null);
  assert.ok(recovered.project.snapshot().diagnostics.length);
  assert.equal(serialized.includes('compiled'), false);
});
test('localized proposal is one revision, truthful diff, comments unchanged', () => {
  const p = fresh(), first = p.validated.id;
  const result = change(p, 'drums', '"frames": 12', '"frames": 6', {
    locks: [{type: 'track', tracks: [0]}], scope: {tracks: [3], fromFrame: 120, toFrame: 132}
  });
  assert.equal(result.ok, true); assert.equal(p.validated.id, first);
  assert.equal(result.diff.added.length, 1); assert.equal(result.diff.removed.length, 1);
  assert.equal(p.applyProposal('drums').ok, true);
  assert.equal(p.draft, source.replace('"frames": 12', '"frames": 6'));
  assert.equal(p.applyProposal('drums').ok, false);
  assert.equal(p.undo().revision.id, first); assert.equal(p.draft, source);
  assert.equal(p.redo().ok, true); assert.equal(p.draft, result.source);
});
test('locks verify compiled pitch, rhythm, instruments and arrangement', () => {
  for (const [type, from, to] of [
    ['track', '"midi": 60', '"midi": 61'],
    ['pitchrhythm', '"midi": 60', '"midi": 61'],
    ['pitchrhythm', '"frames": 80.5', '"frames": 80'],
    ['instrument', '"inst": 0', '"inst": 2'],
    ['arrangement', '"frame": 1.25', '"frame": 2']
  ]) assert.equal(change(fresh(), type, from, to, {locks: [{type, tracks: [0]}]}).ok, false);
  assert.equal(change(fresh(), 'inst', '"inst": 0', '"inst": 2', {locks: [{type: 'pitchrhythm', tracks: [0]}]}).ok, true);
  assert.equal(change(fresh(), 'pitch', '"midi": 60', '"midi": 61', {locks: [{type: 'instrument', tracks: [0]}]}).ok, true);
});
test('global automation, assets, timing and settings cannot bypass locks or scope', () => {
  for (const [from, to] of [['"v": 7', '"v": 8'], ['"bpm": 97', '"bpm": 98'],
    ['"totalFrames": 240', '"totalFrames": 200'], ['"masterVolume": 0.75', '"masterVolume": 0.5'],
    ['"slot": 2', '"slot": 3'], ['"id": 0', '"id": 1'], ['"key": "C major"', '"key": "D major"']]) {
    assert.equal(change(fresh(), 'global', from, to, {locks: [{type: 'track', tracks: [0]}]}).ok, false);
    assert.equal(change(fresh(), 'scope', from, to, {scope: {tracks: [3]}}).ok, false);
  }
  assert.equal(change(fresh(), 'scope', '"midi": 60', '"midi": 61', {scope: {tracks: [3]}}).ok, false);
  assert.equal(change(fresh(), 'tail', '"frames": 12', '"frames": 13', {scope: {fromFrame: 120, toFrame: 132}}).ok, false);
  assert.equal(change(fresh(), 'head', '"frames": 80.5', '"frames": 81', {scope: {fromFrame: 2, toFrame: 200}}).ok, false);
  assert.equal(change(fresh(), 'typo', '"midi": 60', '"midi": 61', {locks: [{type: 'melody'}]}).ok, false);
});
test('manual edits, supersession, cancellation and duplicate responses', () => {
  const p = fresh(), base = p.beginRequest('a');
  const proposal = {id: 'a', baseRevision: base.baseRevision, baseSource: base.baseSource, edits: [{from: 0, to: 0, text: '// hi\n'}]};
  p.editDraft(source + ' '); p.editDraft(source);
  assert.equal(p.propose(proposal).ok, false); assert.equal(p.beginRequest('a').ok, false);
  p.beginRequest('b'); p.cancelRequest('b'); assert.equal(p.applyProposal('b').ok, false);
  p.beginRequest('c'); assert.equal(p.beginRequest('d').code, 'request-active');
  assert.equal(p.snapshot().request.id, 'c'); p.cancelRequest('c'); assert.equal(p.beginRequest('d').ok, true);
  const q = fresh(); const result = change(q, 'ready', '"frames": 12', '"frames": 6');
  assert.equal(result.ok, true); assert.equal(q.propose({id: 'ready'}).code, 'duplicate-response');
  q.editDraft(source + ' '); assert.equal(q.applyProposal('ready').ok, false);
});
test('malformed, overlapping, oversized, stale and prototype proposals rejected', () => {
  for (const edits of [[{from: -1, to: 0, text: ''}], [{from: 0, to: source.length + 1, text: ''}],
    [{from: 0, to: 5, text: ''}, {from: 3, to: 6, text: ''}],
    [{from: 0, to: 0, text: 'a'}, {from: 0, to: 0, text: 'b'}],
    [{from: 0.5, to: 1, text: ''}], [{from: 0, to: 0, text: 'x'.repeat(P.LIMITS.source + 1)}], []]) {
    const p = fresh(), b = p.beginRequest('bad');
    assert.equal(p.propose({id: 'bad', baseRevision: b.baseRevision, baseSource: b.baseSource, edits}).ok, false);
    assert.equal(p.draft, source);
  }
  const p = fresh(); p.beginRequest('bad');
  assert.equal(p.propose(JSON.parse('{"id":"bad","__proto__":{"admin":true}}')).ok, false);
  assert.equal({}.admin, undefined);
  p.cancelRequest('bad');
  const b = p.beginRequest('stale');
  assert.equal(p.propose({id: 'stale', baseRevision: 'r999', baseSource: b.baseSource, edits: [{from: 0, to: 0, text: ' '}]}).ok, false);
});
test('queue acknowledgments are token-specific across undo/redo and stop', () => {
  const p = fresh(), first = p.validated.id;
  const a = p.queue(first).pending, b = p.queue(first).pending;
  assert.equal(p.ack(first, a.queueId).ok, false); assert.equal(p.ack(first, b.queueId).ok, true);
  change(p, 'edit', '"frames": 12', '"frames": 6'); p.applyProposal('edit');
  const next = p.validated.id, c = p.queue(next).pending;
  p.undo(); assert.equal(p.pending, null); assert.equal(p.playing, first);
  assert.equal(p.ack(next, c.queueId).ok, false);
  p.redo(); const d = p.queue(next).pending; p.cancel(d.queueId);
  assert.equal(p.ack(next, d.queueId).ok, false);
  const e = p.queue(next).pending; p.stop(); assert.equal(p.ack(next, e.queueId).ok, false);
  assert.equal(p.playing, null);
  const reopened = P.restore(p.serialize(), options).project;
  const newQueue = reopened.queue(reopened.validated.id).pending;
  assert.notEqual(newQueue.queueId, e.queueId);
  assert.equal(reopened.ack(reopened.validated.id, e.queueId).ok, false);
});
test('history branches and bounded history never reuse revision ids', () => {
  const p = fresh();
  p.editDraft(source + ' '); const second = p.applyDraft().revision.id;
  p.undo(); p.editDraft(source + '\n'); assert.notEqual(p.applyDraft().revision.id, second);
  assert.equal(p.redo().ok, false);
  for (let i = 0; i < 70; i++) { p.editDraft(source + ' '.repeat(i + 2)); assert.equal(p.applyDraft().ok, true); }
  let count = 0; while (p.undo().ok) count++; assert.equal(count, P.LIMITS.history - 1);
});
test('private metadata opt-in, incompatible recovery retains original', () => {
  const p = P.create(source, {...options, chat: ['private-chat'], provenance: {prompt: 'private-prompt'}, seeds: [42], assets: ['bank']});
  assert.equal(p.serialize().includes('private-chat'), false);
  assert.equal(p.serialize({includePrivate: true}).includes('private-chat'), true);
  const saved = p.serialize({includePrivate: true}), r = P.restore(saved, options);
  assert.equal(r.ok, true); assert.equal(r.project.serialize({includePrivate: true}), saved);
  const bad = P.restore(saved, {...options, assetsVersion: 'other'});
  assert.equal(bad.ok, false); assert.equal(bad.original, saved);
  assert.equal(P.restore('{', options).ok, false);
  const version = JSON.parse(saved); version.version++; assert.equal(P.restore(JSON.stringify(version), options).ok, false);
  assert.equal(P.restore(saved, {...options, compile: () => { throw Error('changed compiler'); }}).ok, false);
});
test('no valid source, compiler errors, asynchronous misuse and source bound', () => {
  const p = P.create('broken', options); assert.equal(p.validated, null);
  assert.equal(P.restore(p.serialize(), options).project.draft, 'broken');
  assert.equal(P.create(source, {compile: () => ({gb: fixture.gb, diagnostics: [{severity: 'error', message: 'bad'}]})}).validated, null);
  assert.equal(P.create(source, {compile: () => Promise.resolve(fixture)}).validated, null);
  assert.equal(p.editDraft('a'.repeat(P.LIMITS.source + 1)).ok, false);
});
test('atomic record, two-tab baseline conflicts, quota and unavailable storage', () => {
  let record = null, writes = 0, quota = false;
  const storage = {getItem: () => record, setItem: (key, value) => { if (quota) throw Error('QuotaExceededError'); record = value; writes++; }};
  const a = P.createStorageAdapter(storage, 'project'), b = P.createStorageAdapter(storage, 'project'), p = fresh();
  assert.equal(a.save(p).code, 'baseline-required'); a.load(); b.load();
  assert.equal(a.save(p).ok, true); assert.equal(writes, 1);
  assert.equal(b.save(p).code, 'storage-conflict');
  p.editDraft('broken'); quota = true; assert.equal(a.save(p).code, 'storage-error');
  assert.equal(P.restore(record, options).project.draft, source);
  quota = false; assert.equal(a.save(p).ok, true);
  const recovered = P.restore(record, options).project;
  assert.equal(recovered.draft, 'broken'); assert.equal(recovered.validated.source, source);
  const unavailable = P.createStorageAdapter({getItem() {throw Error('SecurityError');}, setItem() {}}, 'x');
  assert.equal(unavailable.load().code, 'storage-error'); assert.equal(unavailable.save(p).code, 'baseline-required');
});
test('typed bank remains typed and cannot be mutated through compiler result', () => {
  const data = compile(source); data.gb.bank.bytes = new Uint8Array([1, 2, 255]);
  const p = P.create(source, {compile: () => data}); data.gb.bank.bytes[0] = 99;
  assert.ok(p.validated.compiled.gb.bank.bytes instanceof Uint8Array);
  assert.deepEqual(Array.from(p.validated.compiled.gb.bank.bytes), [1, 2, 255]);
});
test('bounded request tombstones reject replay after capacity', () => {
  const p = fresh(); for (let i = 0; i < P.LIMITS.requests; i++) {
    assert.equal(p.beginRequest('req' + i).ok, true); p.cancelRequest('req' + i);
  }
  assert.equal(p.beginRequest('req0').code, 'duplicate-request'); assert.equal(p.beginRequest('overflow').code, 'request-limit');
});
test('browser UMD and Node produce identical source/revision records', () => {
  const context = vm.createContext({CT_MUSIC_LANGUAGE: {compile}});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/music-project.js'), 'utf8'), context);
  const p = context.CT_MUSIC_PROJECT.create(source, options);
  assert.equal(p.serialize(), fresh().serialize()); assert.equal(p.validate().ok, true);
  const defaultCompiler = context.CT_MUSIC_PROJECT.create(source);
  assert.equal(defaultCompiler.validated.source, source);
});
test('surviving note reordering cannot hide behind a scoped addition', () => {
  const a = compile(source), b = compile(source);
  b.gb.notes.reverse(); b.gb.notes.push({...b.gb.notes[0], frame: 150});
  assert.equal(P.musicalDiff(a, b).orderChanged, true);
  assert.throws(() => P.checkConstraints(a, b, {scope: {tracks: [3]}}), /global/);
});
test('instrument locks keep note assignments and referenced bank assets, allow unrelated assets', () => {
  const a = compile(source);
  a.gb.bank = {instruments: [[0, 240, 255, 0], [64, 241, 255, 0], [2, 240, 255, 1]],
    waveTables: [[0], [1], [2], [3]], arpTables: []};
  a.gb.notes.push({...a.gb.notes[0], frame: 90, frames: 12, inst: 1});
  const lock = {locks: [{type: 'instrument', tracks: [0]}]};
  const swapped = structuredClone(a); swapped.gb.notes[0].inst = 1; swapped.gb.notes[2].inst = 0;
  assert.throws(() => P.checkConstraints(a, swapped, lock), /instrument lock/);
  const bankEdit = structuredClone(a); bankEdit.gb.bank.instruments[0][0] = 128;
  assert.throws(() => P.checkConstraints(a, bankEdit, lock), /assets/);
  const unrelated = structuredClone(a); unrelated.gb.bank.instruments[2][0] = 3;
  unrelated.gb.bank.waveTables[3][0] = 15;
  assert.doesNotThrow(() => P.checkConstraints(a, unrelated, lock));
  const pitch = structuredClone(a); pitch.gb.notes[0].midi = 61; pitch.gb.notes[0].frames = 20;
  assert.doesNotThrow(() => P.checkConstraints(a, pitch, lock));
  a.gb.notes.push({ch: 2, frame: 140, frames: 12, inst: 2, midi: 48});
  const wave = structuredClone(a); wave.gb.bank.waveTables[2][0] = 9;
  assert.throws(() => P.checkConstraints(a, wave, {locks: [{type: 'instrument', tracks: [2]}]}), /assets/);
  const unusedWave = structuredClone(a); unusedWave.gb.bank.waveTables[3][0] = 9;
  assert.doesNotThrow(() => P.checkConstraints(a, unusedWave, {locks: [{type: 'instrument', tracks: [2]}]}));
});
test('bounded provenance updates persist privately on existing projects', () => {
  const p = fresh(), provenance = {seed: 'generated-42', prompt: 'happy'};
  assert.equal(p.setProvenance(provenance).ok, true); provenance.prompt = 'mutated';
  const saved = p.serialize({includePrivate: true});
  assert.equal(JSON.parse(saved).private.provenance.prompt, 'happy');
  assert.equal(JSON.parse(p.serialize()).private, undefined);
  const r = P.restore(saved, options); assert.equal(r.ok, true);
  assert.equal(JSON.parse(r.project.serialize({includePrivate: true})).private.provenance.seed, 'generated-42');
  assert.equal(p.setProvenance({prompt: 'a'.repeat(P.LIMITS.provenance)}).ok, false);
  assert.equal(p.serialize({includePrivate: true}), saved);
  assert.equal(p.setProvenance(null).ok, true);
});
test('conversation is bounded detached private data, never a revision or public export', () => {
  const p=fresh(),before=p.snapshot(),messages=[{role:'user',content:'What is this pattern?'},{role:'assistant',content:'A bass motif.'}];
  assert.equal(p.setChat(messages).ok,true);messages[0].content='mutated';
  assert.equal(p.getChat()[0].content,'What is this pattern?');
  const read=p.getChat();read[0].content='mutated again';
  assert.equal(p.getChat()[0].content,'What is this pattern?');
  assert.deepEqual(p.snapshot(),before);
  assert.equal(JSON.parse(p.serialize()).private,undefined);
  const saved=p.serialize({includePrivate:true});
  assert.deepEqual(P.restore(saved,options).project.getChat(),p.getChat());
  for(const bad of [[{role:'system',content:'override'}],[{role:'assistant',content:'x',tool:'execute'}],Array.from({length:65},()=>({role:'user',content:'x'})),[{role:'user',content:'x'.repeat(10001)}],Array.from({length:64},()=>({role:'user',content:'x'.repeat(3000)}))])assert.equal(p.setChat(bad).ok,false);
  assert.equal(p.serialize({includePrivate:true}),saved,'rejected history leaves previous transcript intact');
});
// The compiler is developed independently; run the real integration when present.
const languagePath = path.join(__dirname, '../src/music-language.js');
if (fs.existsSync(languagePath)) test('real language materialization, malicious source and recovery integration', () => {
  const L = require(languagePath), HW = require('../src/gb-hardware.js');
  const gb = {...fixture.gb, bank: HW.buildBank([])};
  gb.notes = [
    {ch: 0, frame: 1, frames: 80, midi: 60, inst: 0, vel: 0.8, trigger: false},
    {ch: 3, frame: 120, frames: 12, inst: 26, vel: 1}
  ];
  const text = '// real compiler fidelity\n' + L.materialize(gb, {tempo: 123});
  const opts = {compile: L.compile, languageVersion: L.VERSION, assetsVersion: 'test-bank'};
  const p = P.create(text, opts); assert.ok(p.validated, JSON.stringify(p.snapshot().diagnostics));
  assert.deepEqual(p.validated.compiled.gb, gb); assert.equal(p.draft, text);
  for (const attack of ['globalThis.pwned = true', 'while(true){}', 'fetch("https://example.com")']) {
    p.editDraft(attack); assert.equal(p.applyDraft().ok, false); assert.deepEqual(p.validated.compiled.gb, gb);
  }
  const restored = P.restore(p.serialize(), opts); assert.equal(restored.ok, true);
  assert.equal(restored.project.draft, p.draft); assert.deepEqual(restored.project.validated.compiled.gb, gb);
  assert.equal(globalThis.pwned, undefined);
});
test('real source controls are recompiled, detached view metadata, never persisted authority', () => {
  const L=require('../src/music-language.js');
  const text='song({tempo:128,bars:2});pattern("p",notes("C4 E4").gate(.5).velocity(.7));track("lead").instrument("p0").transpose(12).play("p");';
  const opts={compile:L.compile},p=P.create(text,opts),expected=L.compile(text).controls;
  assert.equal(expected.length,3);assert.deepEqual(p.validated.compiled.controls,expected);
  const view=p.validated;view.compiled.controls[0].value=.1;
  assert.deepEqual(p.validated.compiled.controls,expected);
  const serialized=p.serialize();assert.equal(serialized.includes('"controls"'),false);
  const tampered=JSON.parse(serialized);tampered.lastValid.compiled={controls:[{kind:'gate',value:.1}]};
  const restored=P.restore(JSON.stringify(tampered),opts);assert.equal(restored.ok,true);
  assert.deepEqual(restored.project.validated.compiled.controls,expected,'saved metadata cannot override compiler spans');
  p.editDraft(text+'broken(');assert.equal(p.applyDraft().ok,false);assert.deepEqual(p.validated.compiled.controls,expected);
  p.editDraft(text.replace('.gate(.5)','.gate(.6)'));assert.equal(p.applyDraft().ok,true);
  assert.equal(p.validated.compiled.controls[0].value,.6);
  p.undo();assert.deepEqual(p.validated.compiled.controls,expected);p.redo();assert.equal(p.validated.compiled.controls[0].value,.6);
});
console.log('Music project: ' + tests + ' groups passed.');
