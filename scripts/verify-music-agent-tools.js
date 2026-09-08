'use strict';

// Offline boundary tests using labeled fake session callbacks; no model/network.
const assert = require('node:assert/strict');
const { createMusicAgentTools, LIMITS } = require('../server/music-agent-tools');
const language = require('../src/music-language');

async function main() {
  const calls = [];
  const source = 'song({tempo:120,bars:4})\n// 😀\n';
  let context = { generation: 1, draftEpoch: 0, baseRevision: 'r1', source };
  let fail = false;
  const tools = createMusicAgentTools({
    getContext: async (...args) => { calls.push(['fake:getContext', args]); if (fail) throw Error('SECRET backend details'); return context; },
    propose: async p => { calls.push(['fake:propose', p]); return { id: 'p1', status: 'ready' }; },
    getProposalStatus: async p => { calls.push(['fake:getProposalStatus', p]); return { id: p.id, status: 'queued' }; }
  });
  // The host owns schema conversion. This fake records the SDK registerTool shape.
  const registered = new Map();
  const fakeServer = { registerTool(name, config, handler) { registered.set(name, { config, handler }); } };
  for (const { name, handler, ...config } of tools) fakeServer.registerTool(name, config, handler);
  assert.deepEqual([...registered.keys()], ['music_get_context', 'music_propose_edit', 'music_get_proposal_status', 'music_get_help']);
  assert(Object.isFrozen(tools));
  for (const t of tools) {
    assert(Object.isFrozen(t.inputSchema));
    assert.equal(t.inputSchema.additionalProperties, false);
    assert.equal(t.annotations.destructiveHint, false);
  }
  const invoke = (name, args) => registered.get(name).handler(args, { sessionId: 'UNTRUSTED SDK extra' });
  const data = r => JSON.parse(r.content[0].text);
  const edit = () => ({ id: '12345678-1234-1234-1234-123456789abc', generation: 1, draftEpoch: 0,
    baseRevision: 'r1', edits: [{ from: 12, to: 15, text: '140' }], explanation: 'Faster' });
  const good = await invoke('music_get_context', {});
  assert.deepEqual(data(good), context);
  assert.deepEqual(calls.pop(), ['fake:getContext', []]);
  const p = edit();
  const pending = invoke('music_propose_edit', p);
  p.edits[0].text = 'TAMPER';
  assert.deepEqual(data(await pending), { id: 'p1', status: 'ready' });
  assert.equal(calls.at(-1)[1].edits[0].text, '140');
  assert.deepEqual(calls.at(-1)[1], edit());
  const status = await invoke('music_get_proposal_status', { id: 'p1' });
  assert.deepEqual(data(status), { id: 'p1', status: 'queued' });
  assert.deepEqual(calls.at(-1), ['fake:getProposalStatus', { id: 'p1' }]);
  assert(!JSON.stringify(status).includes('applied'));

  async function reject(name, args, callbackAllowed = false) {
    const before = calls.length;
    const r = await invoke(name, args);
    assert.equal(r.isError, true, 'Expected rejection for ' + name);
    assert.match(data(r).error, /^(invalid_arguments|music_tool_failed)$/);
    if (!callbackAllowed) assert.equal(calls.length, before);
    else assert(!calls.slice(before).some(c => c[0] === 'fake:propose'));
  }
  for (const field of ['sessionId', 'userId', 'constraints', 'apply', 'playback', 'shell', 'export', '__proto__', 'constructor', 'prototype']) {
    const a = edit(); Object.defineProperty(a, field, { value: 'tamper', enumerable: true });
    await reject('music_propose_edit', a);
    await reject('music_get_context', JSON.parse('{"' + field + '":"tamper"}'));
    await reject('music_get_proposal_status', { id: 'p1', [field]: 'tamper' });
    await reject('music_get_help', { [field]: 'tamper' });
  }
  for (const a of [null, [], 'text', 1, Object.create({ inherited: true }), new Date()]) await reject('music_get_context', a);
  let getterCalled = false;
  const accessor = edit();
  Object.defineProperty(accessor, 'baseRevision', { get() { getterCalled = true; return 'r1'; }, enumerable: true });
  await reject('music_propose_edit', accessor); assert.equal(getterCalled, false);
  const symbol = edit(); symbol[Symbol('hidden')] = true; await reject('music_propose_edit', symbol);
  assert.deepEqual(tools[1].inputSchema.required, ['id', 'generation', 'draftEpoch', 'baseRevision', 'edits']);
  for (const field of ['id', 'generation', 'draftEpoch']) {
    const missing = edit(); delete missing[field]; await reject('music_propose_edit', missing);
  }
  for (const field of ['generation', 'draftEpoch']) {
    for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1', null]) {
      await reject('music_propose_edit', { ...edit(), [field]: value });
    }
  }
  for (const value of ['', 'p1', 'not-a-uuid', 'x'.repeat(100), null]) {
    await reject('music_propose_edit', { ...edit(), id: value });
  }
  // Same revision/source after lock/selection refresh, context replacement or undo
  // must not upgrade old preconditions to the latest server state.
  for (const change of [{ generation: 2 }, { draftEpoch: 1 }, { generation: 2, draftEpoch: 0 }]) {
    const before = context;
    context = { ...context, ...change };
    await reject('music_propose_edit', edit(), true);
    context = before;
  }
  for (const n of [NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER, '12']) {
    const a = edit(); a.edits[0].from = n; await reject('music_propose_edit', a);
  }
  for (const edits of [[], new Array(1), Array(33).fill({ from: 0, to: 1, text: '' }),
    [{ from: 15, to: 12, text: '' }], [{ from: 1, to: 4, text: '' }, { from: 3, to: 5, text: '' }],
    [{ from: 1, to: 1, text: 'a' }, { from: 1, to: 1, text: 'b' }],
    [{ from: 1, to: 2, text: '\ud800' }], [{ from: 1, to: 2, text: 'é'.repeat(LIMITS.editBytes) }],
    [{ from: 1, to: 2, text: 'a', constraints: {} }]]) {
    await reject('music_propose_edit', { ...edit(), edits });
  }
  for (const a of [ { ...edit(), baseRevision: 'old' },
    { ...edit(), edits: [{ from: source.length, to: source.length + 1, text: 'x' }] },
    { ...edit(), edits: [{ from: source.indexOf('😀') + 1, to: source.indexOf('😀') + 1, text: 'x' }] },
    { ...edit(), edits: [{ from: 0, to: source.length, text: 'replacement' }] },
    { ...edit(), edits: [{ from: 12, to: 15, text: '120' }] } ]) await reject('music_propose_edit', a, true);
  context = { ...context, source: 'a'.repeat(20000) };
  await reject('music_propose_edit', { ...edit(), edits: [{ from: 1, to: 18000, text: 'b' }] }, true);
  context = { ...context, source };
  fail = true;
  const failure = await invoke('music_get_context', {});
  assert.equal(JSON.stringify(failure).includes('SECRET'), false);
  fail = false;
  const help = data(await invoke('music_get_help', {}));
  assert.equal(help.languageVersion, language.VERSION);
  assert(help.guidance.includes('never means applied'));
  assert(language.compile('song({tempo:120,bars:4}); pattern("p",notes("C2 . G2 .").stepsPerBar(4).gate(0.7)); track("bass").instrument("wave-bass").play("p",{atBar:0,repeat:4})').gb);
  const badResults = [undefined, { error: new Error('SECRET') }, { value: Infinity }, JSON.parse('{"__proto__":{}}')];
  for (const result of badResults) {
    const fakes = createMusicAgentTools({ getContext: () => result, propose: () => ({}), getProposalStatus: () => ({}) });
    assert.equal((await fakes[0].handler({})).isError, true);
  }
  // Labeled atomic fake core: the wrapper must preserve stale evidence even if
  // host state changes between its context read and the core's atomic check.
  let epoch = 0;
  const seen = new Set();
  let race = true;
  const atomic = createMusicAgentTools({
    getContext: () => {
      const snapshot = { ...context, draftEpoch: epoch };
      if (race) epoch++;
      return snapshot;
    },
    propose: p => {
      assert.equal(p.generation, 1);
      assert.equal(p.id, edit().id);
      if (p.draftEpoch !== epoch) return { ok: false, code: 'stale_context' };
      if (seen.has(p.id)) return { ok: false, code: 'duplicate_proposal' };
      seen.add(p.id); return { ok: true, id: p.id, status: 'pending' };
    },
    getProposalStatus: () => ({ status: 'pending' })
  });
  const stale = await atomic[1].handler(edit());
  assert.equal(data(stale).code, 'stale_context');
  assert.equal(stale.isError, true);
  race = false;
  const fresh = { ...edit(), draftEpoch: epoch };
  assert.equal(data(await atomic[1].handler(fresh)).status, 'pending');
  const duplicate = await atomic[1].handler(fresh);
  assert.equal(data(duplicate).code, 'duplicate_proposal');
  assert.equal(duplicate.isError, true);
  console.log('PASS music agent tools: fake callbacks, strict bounds, authority tamper rejection, proposal-only status, restricted help');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
