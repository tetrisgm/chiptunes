#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const { createMusicAgentSession, hydrateMusicAgentSession, LIMITS } = require('../server/music-agent-session.js');
const source = '// keep 🎵 comments\nsong({totalFrames:120})\ninstruments([[128,240,255,0]])\n' +
  'event({ch:0,frame:0,frames:10,midi:60,inst:0,vel:1})\n';
const offset = source.indexOf('midi:60') + 5;
const snapshot = () => ({ source, baseRevision: 'r1', draftEpoch: 1, selection: null, constraints: {} });
let count = 0;
function test(name, fn) { fn(); count++; console.log('ok ' + name); }
function fixture(options = {}) {
  let time = 0;
  const s = createMusicAgentSession({ now: () => time, ...options });
  assert.equal(s.publish(snapshot()).ok, true);
  const base = () => {
    const c = s.readContext(); assert.equal(c.ok, true);
    return { generation: c.generation, baseRevision: c.baseRevision, draftEpoch: c.draftEpoch };
  };
  const proposal = (id = 'p1') => ({ id, ...base(), edits: [{ from: offset, to: offset + 2, text: '62' }], explanation: 'Raise pitch' });
  return { s, base, proposal, time: t => { time = t; } };
}
function fail(r, code) { assert.equal(r.ok, false, JSON.stringify(r)); if (code) assert.equal(r.code, code); assert.deepEqual(Object.keys(r).sort(), ['code', 'ok']); }
test('offline until publish, required bounded options', () => {
  fail(createMusicAgentSession({ now: () => 0 }).readContext(), 'offline');
  assert.throws(() => createMusicAgentSession());
  for (const o of [{ ttlMs: 0 }, { maxReplay: LIMITS.replay + 1 }, { ttlMs: Infinity }])
    assert.throws(() => createMusicAgentSession({ now: () => 0, ...o }));
});
test('one-shot claim and applied receipt; duplicate cannot apply twice', () => {
  const { s, base, proposal } = fixture(); const p = proposal(), b = base();
  assert.equal(s.propose(p).status, 'pending');
  const claim = s.claim({ id: p.id, ...b }); assert.equal(claim.proposal.status, 'claimed');
  fail(s.claim({ id: p.id, ...b }), 'stale_claim');
  const receipt = { id: p.id, ...b, status: 'applied', snapshot: { ...snapshot(),
    source: claim.proposal.candidate, baseRevision: 'r2', draftEpoch: 2 } };
  assert.equal(s.acknowledge(receipt).status, 'applied');
  fail(s.acknowledge(receipt), 'stale_snapshot'); fail(s.propose(p), 'duplicate_proposal');
  assert.equal(s.status({ id: p.id }).status, 'applied');
  assert.equal(s.readContext().source, source.replace('midi:60', 'midi:62'));
});
test('manual changes including selection and same-revision ABA invalidate claims', () => {
  for (const change of [{}, { draftEpoch: 2 }, { selection: { ch: 1, fromFrame: 0, toFrame: 20 } },
    { constraints: { locks: [{ type: 'track', tracks: [0] }] } }, { source: source + '// edit' }]) {
    const { s, proposal, base } = fixture(); const p = proposal(), b = base(); s.propose(p); s.claim({ id: p.id, ...b });
    assert.equal(s.publish({ ...snapshot(), ...change }).ok, true);
    fail(s.acknowledge({ id: p.id, ...b, status: 'failed', snapshot: null }), 'stale_snapshot');
    assert.equal(s.status({ id: p.id }).status, 'superseded');
    fail(s.propose({ ...proposal('fresh'), generation: b.generation }), 'stale_snapshot');
  }
});
test('TTL boundary, heartbeat cannot resurrect, reconnect never reuses generation', () => {
  const { s, proposal, base, time } = fixture(); const b = base(); s.propose(proposal());
  time(LIMITS.ttlMs - 1); assert.equal(s.heartbeat(b).ok, true);
  time(2 * LIMITS.ttlMs - 1); fail(s.readContext(), 'offline'); fail(s.heartbeat(b), 'offline');
  assert.equal(s.publish(snapshot()).ok, true); assert.ok(base().generation > b.generation);
  assert.equal(s.status({ id: 'p1' }).status, 'offline'); fail(s.propose(proposal()), 'duplicate_proposal');
});
test('revoke permanently denies every access; backward/broken clocks fail closed', () => {
  const { s, proposal, base } = fixture(); const p = proposal(), b = base(); s.propose(p); s.revoke();
  for (const run of [() => s.readContext(), () => s.publish(snapshot()), () => s.propose(p),
    () => s.claim({ id: p.id, ...b }), () => s.heartbeat(b), () => s.status({ id: p.id }),
    () => s.acknowledge({ id: p.id, ...b, status: 'failed', snapshot: null })]) fail(run(), 'revoked');
  for (const t of [-1, NaN, Infinity]) { const f = fixture(); f.time(t); fail(f.s.readContext(), 'revoked'); }
});
test('pending and replay capacity fail closed without tombstone eviction', () => {
  const { s, proposal, base } = fixture({ maxReplay: 3 }); const p = proposal();
  s.propose(p); fail(s.propose(proposal('p2')), 'pending_proposal');
  s.claim({ id: p.id, ...base() });
  assert.equal(s.acknowledge({ id: p.id, ...base(), status: 'rejected', snapshot: null }).ok, true);
  fail(s.propose(proposal('p2')), 'duplicate_proposal');
  fail(s.propose({ ...proposal('p3'), edits: [] }), 'invalid_proposal');
  fail(s.propose(proposal('p4')), 'replay_limit'); fail(s.propose(p), 'duplicate_proposal');
});
test('revision/epoch mismatch and ack-before-claim cannot advance state', () => {
  for (const change of [{ baseRevision: 'r2' }, { draftEpoch: 2 }, { generation: 0 }]) {
    const { s, proposal } = fixture(); fail(s.propose({ ...proposal(), ...change }), 'stale_snapshot');
  }
  const { s, proposal, base, time } = fixture(); const p = proposal(); s.propose(p);
  fail(s.acknowledge({ id: p.id, ...base(), status: 'rejected', snapshot: null }), 'stale_claim');
  const b = base(); time(LIMITS.ttlMs);
  fail(s.propose({ ...p, id: 'offline' }), 'offline');
  fail(s.claim({ id: p.id, ...b }), 'offline');
  fail(s.acknowledge({ id: p.id, ...b, status: 'failed', snapshot: null }), 'offline');
});
test('compiler enforces explicit browser scope and locks; agent cannot override', () => {
  for (const change of [{ constraints: { scope: { tracks: [1] } } },
    { constraints: { locks: [{ type: 'track', tracks: [0] }] } },
    { constraints: { scope: { tracks: [0], fromFrame: 1, toFrame: 20 } } }]) {
    const { s, proposal } = fixture(); s.publish({ ...snapshot(), ...change }); fail(s.propose(proposal()));
  }
  const { s, proposal } = fixture(); fail(s.propose({ ...proposal(), constraints: {} }), 'invalid_input');
  s.publish({ ...snapshot(), constraints: { scope: { tracks: [0], fromFrame: 0, toFrame: 10 } } });
  assert.equal(s.propose(proposal('within')).ok, true);
});
test('selection is contextual only for proposals and restored pending work', () => {
  for (const selection of [{ ch: 1, fromFrame: 0, toFrame: 20 }, { ch: 0, fromFrame: 1, toFrame: 20 }]) {
    const { s, proposal } = fixture();
    assert.equal(s.publish({ ...snapshot(), selection }).ok, true);
    assert.deepEqual(s.readContext().selection, selection);
    assert.equal(s.propose(proposal()).ok, true);
    const restored = createMusicAgentSession({ now: () => 0, state: s.exportState() });
    assert.equal(restored.peek().status, 'pending');
    assert.deepEqual(restored.readContext().selection, selection);
    const constraints = { scope: { tracks: [selection.ch], fromFrame: selection.fromFrame, toFrame: selection.toFrame } };
    assert.equal(s.publish({ ...snapshot(), selection, constraints }).ok, true);
    fail(s.propose(proposal('explicit-scope')));
  }
});
test('malformed/locality/Unicode/byte bounds and compiler errors are redacted', () => {
  const attacks = [[], [{ from: 0, to: source.length, text: source + '// replacement' }],
    [{ from: offset, to: offset + 2, text: 'fetch("SECRET")' }],
    [{ from: offset, to: offset, text: 'é'.repeat(LIMITS.editBytes) }],
    [{ from: source.indexOf('🎵') + 1, to: source.indexOf('🎵') + 1, text: 'x' }],
    [{ from: offset, to: offset + 2, text: '62' }, { from: offset, to: offset, text: 'x' }]];
  for (const edits of attacks) { const { s, proposal } = fixture(); fail(s.propose({ ...proposal(), edits })); }
  const { s, proposal } = fixture(); s.propose(proposal());
  fail(s.publish({ ...snapshot(), source: 'é'.repeat(LIMITS.sourceBytes) })); fail(s.readContext(), 'offline');
  const bad = createMusicAgentSession({ now: () => 0, compile() { throw Error('SECRET_SOURCE'); } });
  const r = bad.publish(snapshot()); fail(r); assert.ok(!JSON.stringify(r).includes('SECRET'));
  let accessed = false; const v = snapshot(); Object.defineProperty(v, 'source', { enumerable: true, get() { accessed = true; return source; } });
  fail(s.publish(v)); assert.equal(accessed, false);
  const cycle = snapshot(); cycle.constraints = cycle; fail(s.publish(cycle));
});
test('detached input/output and ack source/revision/epoch tamper', () => {
  const { s, base, proposal } = fixture(); const input = snapshot(); s.publish(input); input.constraints.locks = [{ type: 'track' }];
  const context = s.readContext(); context.constraints.locks = [{ type: 'track' }];
  const p = proposal(); assert.equal(s.propose(p).ok, true); p.edits[0].text = '70';
  const claim = s.claim({ id: p.id, ...base() }); const candidate = claim.proposal.candidate; claim.proposal.candidate = 'tamper';
  for (const change of [{ source }, { baseRevision: 'r1' }, { draftEpoch: 1 }])
    fail(s.acknowledge({ id: p.id, ...base(), status: 'applied', snapshot: {
      ...snapshot(), source: candidate, baseRevision: 'r2', draftEpoch: 2, ...change } }), 'invalid_ack');
  assert.equal(s.acknowledge({ id: p.id, ...base(), status: 'failed', snapshot: null }).status, 'failed');
});
const restore = (state, time = 0, options = {}) => createMusicAgentSession({ now: () => time, ...options, state });
const copy = v => JSON.parse(JSON.stringify(v));
test('private export is plain, detached, minimal and round trips exactly', () => {
  const { s, proposal } = fixture(); s.propose(proposal());
  const state = s.exportState();
  assert.deepEqual(copy(state), state);
  assert.deepEqual(Object.keys(state).sort(), ['format', 'version', 'ttlMs', 'maxReplay', 'revoked',
    'generation', 'lastTime', 'expires', 'snapshot', 'pending', 'seen'].sort());
  assert.equal(state.pending.candidate, undefined); assert.equal(state.pending.proposal.candidate, undefined);
  assert.equal(state.snapshot.compiled, undefined);
  const r = restore(state); assert.deepEqual(r.exportState(), state);
  assert.deepEqual(r.readContext(), s.readContext());
  state.pending.proposal.edits[0].text = '70'; state.snapshot.source = 'tampered';
  assert.equal(r.exportState().pending.proposal.edits[0].text, '62');
  assert.equal(s.exportState().snapshot.source, source);
  const serialized = r.serialize(); assert.equal(serialized.ok, true);
  const hydrated = hydrateMusicAgentSession(serialized.serialized, { now: () => 0 });
  assert.equal(hydrated.ok, true); assert.deepEqual(hydrated.session.exportState(), r.exportState());
});
test('browser peek exposes only claim metadata and remains detached', () => {
  const { s, proposal, base } = fixture(); assert.equal(s.peek().status, 'idle');
  assert.equal(s.peek().id, undefined); s.propose(proposal());
  const peek = s.peek(); assert.deepEqual(peek, { ok: true, id: 'p1', ...base(), status: 'pending' });
  assert.equal(s.readContext().pending, undefined); assert.equal(s.readContext().candidate, undefined);
  peek.id = 'mutated'; const { ok, status, ...claim } = s.peek();
  assert.equal(s.claim(claim).ok, true); assert.equal(s.peek().status, 'claimed');
  assert.equal(restore(s.exportState()).peek().status, 'claimed');
});
test('claimed work remains one-shot through multiple restarts and ack persists', () => {
  const { s, proposal, base } = fixture(); const p = proposal(), b = base(); s.propose(p);
  const r = restore(s.exportState()); const claimed = r.claim({ id: p.id, ...b });
  assert.equal(claimed.ok, true);
  const r2 = restore(r.exportState()); fail(r2.claim({ id: p.id, ...b }), 'stale_claim');
  const receipt = { id: p.id, ...b, status: 'applied', snapshot: { ...snapshot(),
    source: claimed.proposal.candidate, baseRevision: 'r2', draftEpoch: 2 } };
  assert.equal(r2.acknowledge(receipt).ok, true);
  const r3 = restore(r2.exportState()); assert.equal(r3.status({ id: p.id }).status, 'applied');
  fail(r3.acknowledge(receipt), 'stale_snapshot'); fail(r3.propose(p), 'duplicate_proposal');
  assert.equal(r3.readContext().generation, b.generation + 1);
});
test('offline terminal statuses survive persistence without context access', () => {
  const { s, proposal, base } = fixture({ ttlMs: 10 }); const p = proposal(), b = base(); s.propose(p);
  const state = s.exportState(); const r = restore(state, 10);
  fail(r.readContext(), 'offline'); assert.equal(r.status({ id: p.id }).status, 'offline');
  assert.deepEqual(r.peek(), { ok: true, generation: b.generation, status: 'offline' });
  assert.equal(r.exportState().snapshot, null); assert.equal(r.exportState().pending, null);
  const r2 = restore(r.exportState(), 11); assert.equal(r2.status({ id: p.id }).status, 'offline');
  fail(r2.heartbeat(b), 'offline'); r2.publish(snapshot());
  assert.equal(r2.readContext().generation, b.generation + 1);
  fail(r2.claim({ id: p.id, ...b }), 'stale_snapshot'); fail(r2.propose(p), 'duplicate_proposal');
});
test('restore never renews a lease or loses configured bounds', () => {
  const { s } = fixture({ ttlMs: 10, maxReplay: 2 });
  const r = restore(s.exportState(), 9, { ttlMs: LIMITS.ttlMs, maxReplay: LIMITS.replay });
  assert.equal(r.readContext().ok, true); assert.equal(r.exportState().expires, 10);
  assert.equal(r.exportState().ttlMs, 10); assert.equal(r.exportState().maxReplay, 2);
  fail(restore(r.exportState(), 10).readContext(), 'offline');
});
test('applied, rejected and failed terminal results remain observable offline after restart', () => {
  for (const status of ['applied', 'rejected', 'failed']) {
    const { s, proposal, base } = fixture({ ttlMs: 10 }); s.propose(proposal());
    const claim = s.claim({ id: 'p1', ...base() });
    const next = status === 'applied' ? { ...snapshot(), source: claim.proposal.candidate,
      baseRevision: 'r2', draftEpoch: 2 } : null;
    assert.equal(s.acknowledge({ id: 'p1', ...base(), status, snapshot: next }).ok, true);
    const r = restore(s.exportState(), 10);
    assert.deepEqual(r.status({ id: 'p1' }), { ok: true, id: 'p1', status });
    fail(r.readContext(), 'offline'); assert.equal(r.peek().id, undefined);
    assert.equal(restore(r.exportState(), 11).status({ id: 'p1' }).status, status);
  }
});
test('revoke survives JSON round trips and retains replay without sensitive source', () => {
  const { s, proposal } = fixture(); s.propose(proposal()); s.revoke();
  const state = s.exportState(); assert.equal(state.revoked, true);
  assert.equal(state.snapshot, null); assert.equal(state.pending, null);
  assert.deepEqual(state.seen, [['p1', 'revoked']]);
  const r = restore(copy(state)); fail(r.publish(snapshot()), 'revoked'); fail(r.peek(), 'revoked');
  fail(r.readContext(), 'revoked'); assert.equal(r.exportState().revoked, true);
  assert.equal(restore(r.exportState()).exportState().revoked, true);
});
test('regressed, throwing, nonfinite and overflow clocks persist revocation', () => {
  const { s, time } = fixture(); time(100); s.readContext(); const state = s.exportState();
  for (const badTime of [99, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
    const r = restore(state, badTime); fail(r.readContext(), 'revoked');
    const record = r.exportState(); assert.equal(record.revoked, true); assert.equal(record.lastTime, 100);
    fail(restore(record, 101).publish(snapshot()), 'revoked');
  }
  const r = createMusicAgentSession({ now() { throw Error('private clock detail'); }, state });
  assert.equal(r.exportState().revoked, true);
  assert.equal(restore(r.exportState(), 101).exportState().revoked, true);
});
test('malformed durable imports fail closed without source or compiler diagnostics', () => {
  const { s, proposal } = fixture(); s.propose(proposal()); const state = s.exportState();
  const mutations = [v => { v.version = 2; }, v => { v.revoked = 'false'; },
    v => { v.generation = -1; }, v => { v.generation = 0; }, v => { v.lastTime = null; },
    v => { v.lastTime = Infinity; }, v => { v.expires = v.lastTime; },
    v => { v.expires += LIMITS.ttlMs; }, v => { v.maxReplay = 0; }, v => { v.ttlMs = 0; },
    v => { v.seen.push(v.seen[0]); }, v => { v.seen[0][1] = 'unknown'; },
    v => { v.seen.push(['fake-revoke', 'revoked']); }, v => { v.seen.length++; },
    v => { v.pending = null; }, v => { v.pending.status = 'applied'; },
    v => { v.pending.proposal.generation++; }, v => { v.pending.proposal.baseRevision = 'r9'; },
    v => { v.pending.proposal.draftEpoch++; }, v => { v.pending.proposal.candidate = source; },
    v => { v.snapshot = null; }, v => { v.snapshot.source = 'PRIVATE_INVALID_SOURCE'; },
    v => { v.snapshot.constraints = { locks: [{ type: 'track', tracks: [0] }] }; },
    v => { v.snapshot.constraints = { scope: { tracks: [1], fromFrame: 0, toFrame: 120 } }; },
    v => { v.pending.proposal.edits[0].text = 'PRIVATE_INVALID_SOURCE'; },
    v => { v.revoked = true; }, v => { v.extra = 'PRIVATE'; }];
  for (const mutate of mutations) {
    const v = copy(state); mutate(v);
    assert.throws(() => restore(v), { name: 'TypeError', message: 'invalid_storage' });
  }
  for (const raw of ['{PRIVATE', ' '.repeat(LIMITS.storageBytes + 1), 'null', '{"__proto__":{}}'])
    fail(hydrateMusicAgentSession(raw, { now: () => 0 }), 'invalid_storage');
  let accessed = false; const accessor = copy(state);
  Object.defineProperty(accessor, 'snapshot', { enumerable: true, get() { accessed = true; return state.snapshot; } });
  assert.throws(() => restore(accessor), /invalid_storage/); assert.equal(accessed, false);
  const cycle = copy(state); cycle.snapshot.constraints = cycle;
  assert.throws(() => restore(cycle), /invalid_storage/);
});
test('terminal replay capacity and invalid IDs persist, no reset on hydration', () => {
  const { s, proposal } = fixture({ maxReplay: 2 });
  fail(s.propose({ ...proposal('bad'), edits: [] })); s.propose(proposal('good')); s.publish(snapshot());
  const r = restore(s.exportState());
  assert.equal(r.status({ id: 'bad' }).status, 'invalid'); assert.equal(r.status({ id: 'good' }).status, 'superseded');
  fail(r.propose(proposal('bad')), 'duplicate_proposal'); fail(r.propose(proposal('new')), 'replay_limit');
  const over = r.exportState(); over.seen.push(['overflow', 'invalid']); assert.throws(() => restore(over), /invalid_storage/);
});
test('full replay bound serializes and exhausted generations never wrap', () => {
  const { s } = fixture(); const state = s.exportState();
  state.seen = Array.from({ length: LIMITS.replay }, (_, i) => ['id' + i, 'invalid']);
  state.generation = Number.MAX_SAFE_INTEGER;
  const r = restore(state); assert.deepEqual(r.exportState(), state);
  assert.ok(Buffer.byteLength(JSON.stringify(r.exportState())) < LIMITS.storageBytes);
  fail(r.publish(snapshot()), 'generation_limit');
  const r2 = restore(r.exportState()); fail(r2.publish(snapshot()), 'generation_limit');
  assert.equal(r2.exportState().generation, Number.MAX_SAFE_INTEGER);
});
test('large private source plus maximum replay table remains bounded and restorable', () => {
  const { s } = fixture(); const large = { ...snapshot(), source: source + '//' + 'x'.repeat(500000) };
  assert.equal(s.publish(large).ok, true);
  const state = s.exportState();
  state.seen = Array.from({ length: LIMITS.replay }, (_, i) => [String(i).padEnd(128, 'x'), 'invalid']);
  const r = restore(state); assert.deepEqual(r.exportState(), state);
  assert.ok(Buffer.byteLength(r.serialize().serialized) <= LIMITS.storageBytes);
  const tooLarge = copy(state); tooLarge.snapshot.source += 'x'.repeat(LIMITS.storageBytes);
  assert.throws(() => restore(tooLarge), /invalid_storage/);
});
console.log('Music agent session: ' + count + ' groups passed.');
