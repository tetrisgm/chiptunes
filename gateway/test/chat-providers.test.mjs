// EXPLICIT MOCK FETCH TESTS. No real provider, API key, billing, network or
// structured-output service is exercised. Only test-owned sentinel keys are used.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createChatProvider, availableChatProviders } from '../lib/chat-providers.mjs';
const require = createRequire(import.meta.url);
const { createMusicChatHandler, SYSTEM, LIMITS } = require('../../server/music-chat-handler.js');

const env = { OPENAI_API_KEY: 'sk-MOCK-OPENAI-NOT-A-CREDENTIAL',
  ANTHROPIC_API_KEY: 'sk-MOCK-CLAUDE-NOT-A-CREDENTIAL',
  CHAT_OPENAI_MODEL: 'mock-openai-model', CHAT_ANTHROPIC_MODEL: 'mock-claude-model' };
const origin = 'https://music.example';
const source = '// keep this 🎵 comment\nsong({totalFrames:120})\ninstruments([[128,240,255,0]])\n' +
  'event({ch:0,frame:0,frames:10,midi:60,inst:0,vel:1})\n';
const context = { id: 'mock-request', baseRevision: 'r1', source,
  request: 'Raise pitch two semitones', constraints: { locks: [] } };
const offset = source.indexOf('midi:60') + 5;
const proposal = { id: context.id, baseRevision: context.baseRevision,
  edits: [{ from: offset, to: offset + 2, text: '62' }], explanation: 'Suggested edit 🎵' };
const anchoredProposal = { ...proposal, edits: [{ oldText: '60', newText: '62' }] };
const providerSystem = SYSTEM.replace(
  'Each edit has only from, to, text. Offsets are\nUTF-16 code units in the supplied source, half-open, non-overlapping and sorted.',
  'Each edit has only oldText and newText. oldText must be a nonempty exact substring of source occurring exactly once; include enough surrounding context to make it unique. newText replaces that substring. Do not calculate numeric offsets. Edits must not overlap.');
const expectedSchema = { type: 'object', additionalProperties: false,
  properties: { id: { type: 'string' }, baseRevision: { type: 'string' }, explanation: { type: 'string' },
    edits: { type: 'array', items: { type: 'object', additionalProperties: false,
      properties: { oldText: { type: 'string' }, newText: { type: 'string' } },
      required: ['oldText', 'newText'] } } }, required: ['id', 'baseRevision', 'edits', 'explanation'] };
function envelope(provider, text = JSON.stringify(anchoredProposal)) {
  return provider === 'openai'
    ? { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text }] }] }
    : { stop_reason: 'end_turn', content: [{ type: 'text', text }] };
}
function mockAdapter(provider, implementation) {
  const calls = [];
  return { calls, adapter: createChatProvider(provider, env, { fetch: async (url, init) => {
    calls.push({ url, init });
    return implementation ? implementation(url, init) : Response.json(envelope(provider));
  } }) };
}
function args(overrides = {}) {
  return { system: SYSTEM, input: JSON.stringify(context), signal: new AbortController().signal,
    maxOutputTokens: LIMITS.outputTokens, maxOutputBytes: LIMITS.responseBytes,
    maxCalls: 1, tools: [], toolChoice: 'none', ...overrides };
}
function handler(adapter, overrides = {}) {
  // Authentication/rate-limit fixtures only; actual handler + compiler + adapter.
  return createMusicChatHandler({ origin, adapter, authenticate: async () => ({ subject: 'mock-owner' }),
    rateLimit: async () => true, ...overrides });
}
function request(signal) {
  return new Request(`${origin}/api/music/chat`, { method: 'POST', signal,
    headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(context) });
}
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }

test('MOCK FETCH: absent/invalid provider configuration fails closed without network; public list omits keys', () => {
  const fetch = () => assert.fail('configuration must not invoke fetch');
  for (const provider of ['openai', 'anthropic']) {
    for (const badEnv of [{}, { OPENAI_API_KEY: 'bad', ANTHROPIC_API_KEY: 'bad' },
      { ...env, CHAT_OPENAI_MODEL: 'bad/model', CHAT_ANTHROPIC_MODEL: 'bad/model' }]) {
      assert.equal(createChatProvider(provider, badEnv, { fetch }), null);
    }
  }
  assert.equal(createChatProvider('other', env, { fetch }), null);
  assert.deepEqual(availableChatProviders({}), []);
  assert.deepEqual(availableChatProviders(env), [{ id: 'openai', label: 'OpenAI' }, { id: 'anthropic', label: 'Claude' }]);
});

for (const provider of ['openai', 'anthropic']) {
  test(`MOCK FETCH ${provider}: exact endpoint, headers, JSON schema and text-only request body`, async () => {
    const f = mockAdapter(provider);
    const input = args();
    assert.deepEqual(JSON.parse(await new Response(await f.adapter.propose(input)).text()), proposal);
    assert.equal(f.calls.length, 1);
    const { url, init } = f.calls[0];
    assert.equal(url, provider === 'openai' ? 'https://api.openai.com/v1/responses' : 'https://api.anthropic.com/v1/messages');
    assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'error'); assert.equal(init.signal, input.signal);
    assert.deepEqual(init.headers, provider === 'openai'
      ? { 'content-type': 'application/json', authorization: `Bearer ${env.OPENAI_API_KEY}` }
      : { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' });
    const body = JSON.parse(init.body);
    assert.deepEqual(body, provider === 'openai'
      ? { model: env.CHAT_OPENAI_MODEL, store: false, instructions: providerSystem,
        input: [{ role: 'user', content: input.input }], max_output_tokens: 4096,
        text: { format: { type: 'json_schema', name: 'music_proposal', strict: true, schema: expectedSchema } } }
      : { model: env.CHAT_ANTHROPIC_MODEL, max_tokens: 4096, system: providerSystem,
        messages: [{ role: 'user', content: input.input }], output_config: { format: { type: 'json_schema', schema: expectedSchema } } });
    for (const name of ['tools', 'tool_choice', 'functions', 'function_call', 'code_execution', 'computer', 'mcp_servers']) {
      assert.equal(Object.hasOwn(body, name), false, `must not enable ${name}`);
    }
    assert.ok(!init.body.includes(env.OPENAI_API_KEY)); assert.ok(!init.body.includes(env.ANTHROPIC_API_KEY));
  });

  test(`MOCK FETCH ${provider}: respects smaller output-token budget and never calls after pre-abort/bad call budget`, async () => {
    const f = mockAdapter(provider);
    await f.adapter.propose(args({ maxOutputTokens: 123 }));
    const body = JSON.parse(f.calls[0].init.body);
    assert.equal(body.max_tokens ?? body.max_output_tokens, 123);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(() => f.adapter.propose(args({ signal: controller.signal })), /provider_unavailable/);
    for (const maxCalls of [0, 2, undefined]) await assert.rejects(() => f.adapter.propose(args({ maxCalls })), /provider_unavailable/);
    assert.equal(f.calls.length, 1);
  });

  test(`MOCK FETCH ${provider}: HTTP/network errors are redacted and never retried`, async () => {
    for (const status of [400, 401, 429, 500, 503]) {
      const f = mockAdapter(provider, () => new Response('PRIVATE_PROVIDER_ERROR', { status, headers: { 'retry-after': '0' } }));
      await assert.rejects(() => f.adapter.propose(args()), { message: 'provider_unavailable' });
      assert.equal(f.calls.length, 1);
    }
    const f = mockAdapter(provider, () => { throw Error('PRIVATE_NETWORK_DETAIL'); });
    const response = await handler(f.adapter)(request());
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: 'backend_failure' });
    assert.equal(f.calls.length, 1);
  });

  test(`MOCK FETCH ${provider}: refusal, token truncation and malformed response fail closed`, async () => {
    const variants = provider === 'openai' ? [
      { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: envelope(provider).output },
      { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'PRIVATE_REFUSAL' }] }] },
      { status: 'failed', error: { message: 'PRIVATE_ERROR' } },
      { status: 'completed', output: [] },
      { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 123 }] }] },
    ] : [
      { stop_reason: 'max_tokens', content: envelope(provider).content },
      { stop_reason: 'refusal', content: [{ type: 'text', text: 'PRIVATE_REFUSAL' }] },
      { stop_reason: 'end_turn', content: [] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 123 }] },
    ];
    for (const variant of variants) {
      const f = mockAdapter(provider, () => Response.json(variant));
      await assert.rejects(() => f.adapter.propose(args()), { message: 'provider_unavailable' });
      assert.equal(f.calls.length, 1);
    }
    for (const body of ['{"incomplete":', Uint8Array.of(0xff)]) {
      const f = mockAdapter(provider, () => new Response(body));
      await assert.rejects(() => f.adapter.propose(args()), { message: 'provider_unavailable' });
      assert.equal(f.calls.length, 1);
    }
  });

  test(`MOCK FETCH ${provider}: rejects executable response blocks even alongside valid text`, async () => {
    const value = envelope(provider);
    if (provider === 'openai') value.output.push({ type: 'function_call', name: 'execute', arguments: '{}' });
    else value.content.push({ type: 'tool_use', id: 'mock-tool', name: 'execute', input: {} });
    const f = mockAdapter(provider, () => Response.json(value));
    await assert.rejects(() => f.adapter.propose(args()), { message: 'provider_unavailable' });
    assert.equal(f.calls.length, 1);
  });

  test(`MOCK FETCH ${provider}: byte limits cover output UTF-8 and streamed envelope; oversized stream cancelled`, { timeout: 2000 }, async () => {
    const text = JSON.stringify({ ...anchoredProposal, explanation: '🎵'.repeat(5) });
    const f = mockAdapter(provider, () => Response.json(envelope(provider, text)));
    await assert.rejects(() => f.adapter.propose(args({ maxOutputBytes: Buffer.byteLength(text) - 1 })), /provider_unavailable/);
    const accepted = await f.adapter.propose(args({ maxOutputBytes: Buffer.byteLength(text) }));
    assert.equal(JSON.parse(await new Response(accepted).text()).explanation, '🎵'.repeat(5));
    let cancelled = false;
    const large = mockAdapter(provider, () => new Response(new ReadableStream({
      start(c) { c.enqueue(new Uint8Array(131072)); c.enqueue(new Uint8Array(131073)); },
      cancel() { cancelled = true; },
    })));
    await assert.rejects(() => large.adapter.propose(args()), /provider_unavailable/);
    assert.equal(cancelled, true); assert.equal(large.calls.length, 1);
  });

  test(`MOCK FETCH ${provider}: real handler validates localized proposal and never retries consumed request`, async () => {
    const f = mockAdapter(provider);
    const handle = handler(f.adapter);
    const response = await handle(request());
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), proposal);
    assert.equal((await handle(request())).status, 409); assert.equal(f.calls.length, 1);
    for (const invalid of [
      { ...anchoredProposal, edits: [{ oldText: '60', newText: 'fetch("https://evil.example")' }] },
      { ...anchoredProposal, edits: [{ oldText: source, newText: source.replace('60', '62') }] },
      { ...anchoredProposal, edits: [{ oldText: '60', newText: '60' }] }]) {
      const bad = mockAdapter(provider, () => Response.json(envelope(provider, JSON.stringify(invalid))));
      const badHandler = handler(bad.adapter);
      const rejected = await badHandler(request());
      assert.equal(rejected.status, 502); assert.deepEqual(await rejected.json(), { error: 'invalid_proposal' });
      assert.equal((await badHandler(request())).status, 409); assert.equal(bad.calls.length, 1);
    }
  });

  test(`MOCK FETCH ${provider}: exact unique anchors resolve UTF-16 offsets, independent of model ordering`, async () => {
    const value = { ...anchoredProposal, edits: [{ oldText: '60', newText: '62' }, { oldText: '120', newText: '140' }] };
    const f = mockAdapter(provider, () => Response.json(envelope(provider, JSON.stringify(value))));
    const resolved = JSON.parse(await new Response(await f.adapter.propose(args())).text());
    assert.deepEqual(resolved.edits, [
      { from: source.indexOf('120'), to: source.indexOf('120') + 3, text: '140' }, proposal.edits[0],
    ]);
    assert.equal(source.slice(resolved.edits[1].from, resolved.edits[1].to), '60');
    assert.notEqual(offset, [...source.slice(0, offset)].length, 'emoji means code-point counting would give a wrong offset');
  });

  test(`MOCK FETCH ${provider}: empty, absent, ambiguous, malformed anchors and mismatched echoes reject`, async () => {
    for (const value of [
      { ...anchoredProposal, id: 'wrong' }, { ...anchoredProposal, baseRevision: 'wrong' },
      ...[{ oldText: '', newText: '62' }, { oldText: 'not in source', newText: '62' },
        { oldText: '0', newText: '1' }, { oldText: '60', newText: 62 },
        { oldText: '60', newText: '62', command: 'execute' }, proposal.edits[0], null]
        .map(edit => ({ ...anchoredProposal, edits: [edit] })),
    ]) {
      const f = mockAdapter(provider, () => Response.json(envelope(provider, JSON.stringify(value))));
      await assert.rejects(() => f.adapter.propose(args()), { message: 'provider_unavailable' });
      assert.equal(f.calls.length, 1);
    }
  });

  test(`MOCK FETCH ${provider}: overlapping anchors and extra executable fields cannot pass handler`, async () => {
    for (const value of [
      { ...anchoredProposal, edits: [{ oldText: 'midi:60', newText: 'midi:62' }, { oldText: '60', newText: '64' }] },
      { ...anchoredProposal, tools: [{ command: 'execute' }] },
    ]) {
      const f = mockAdapter(provider, () => Response.json(envelope(provider, JSON.stringify(value))));
      const response = await handler(f.adapter)(request());
      assert.equal(response.status, 502);
      assert.equal(f.calls.length, 1);
    }
  });

  test(`MOCK FETCH ${provider}: handler cancellation aborts provider fetch, redacts error and prevents replay`, async () => {
    const started = deferred(); const controller = new AbortController();
    const f = mockAdapter(provider, (_, init) => new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => reject(Error('PRIVATE_ABORT_DETAIL')), { once: true });
      started.resolve();
    }));
    const handle = handler(f.adapter);
    const pending = handle(request(controller.signal));
    await started.promise; controller.abort();
    const response = await pending;
    assert.equal(response.status, 499); assert.deepEqual(await response.json(), { error: 'cancelled' });
    assert.equal(f.calls[0].init.signal.aborted, true);
    assert.equal((await handle(request())).status, 409); assert.equal(f.calls.length, 1);
  });

  test(`MOCK FETCH ${provider}: handler deadline bounds noncooperating fetch without retry`, async () => {
    const f = mockAdapter(provider, () => new Promise(() => {}));
    const response = await handler(f.adapter, { timeoutMs: 40 })(request());
    assert.equal(response.status, 504); assert.deepEqual(await response.json(), { error: 'timeout' });
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0].init.signal.aborted, true);
  });
}
