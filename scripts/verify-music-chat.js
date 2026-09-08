#!/usr/bin/env node
'use strict';
// Test adapters below are deterministic fixtures, never presented as a model.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createMusicChatHandler, LIMITS, SYSTEM } = require('../server/music-chat-handler.js');
const { Client } = require('../src/music-chat.js');
const language = require('../src/music-language.js');
const project = require('../src/music-project.js');
const origin = 'https://music.example';
const source = '// keep 🎵 comments\nsong({totalFrames:120})\ninstruments([[128,240,255,0]])\n' +
  'event({ch:0,frame:0,frames:10,midi:60,inst:0,vel:1})\n';
const offset = source.indexOf('midi:60') + 5;
const context = (id = 'request-1') => ({ id, request: 'Raise the melody two semitones', source, baseRevision: 'r1', constraints: { locks: [] } });
const proposal = (c = context()) => ({ id: c.id, baseRevision: c.baseRevision,
  edits: [{ from: c.source.indexOf('midi:60') + 5, to: c.source.indexOf('midi:60') + 7, text: '62' }], explanation: 'Proposed pitch change 🎵' });
function stream(value, chunkSize = 19) {
  const b = typeof value === 'string' ? Buffer.from(value) : Buffer.from(JSON.stringify(value));
  let at = 0;
  return new ReadableStream({ pull(c) {
    if (at === b.length) return c.close();
    c.enqueue(b.subarray(at, at += Math.min(chunkSize, b.length - at)));
  } });
}
function request(c = context(), opts = {}) {
  return new Request(origin + '/api/music/chat', { method: 'POST', headers: {
    origin, 'content-type': 'application/json', ...opts.headers
  }, body: opts.body || JSON.stringify(c), ...(opts.signal ? { signal: opts.signal } : {}), duplex: 'half' });
}
function configured(overrides = {}) {
  return createMusicChatHandler({ origin, authenticate: async () => ({ subject: 'test-user' }),
    rateLimit: async () => true, adapter: { authorized: true, propose: async a => stream(proposal(JSON.parse(a.input))) }, ...overrides });
}
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
async function status(handler, c, expected, opts) {
  const r = await handler(request(c, opts)); assert.equal(r.status, expected, await r.clone().text()); return r;
}
const cases = [];
function test(name, fn) { cases.push([name, fn]); }

test('backend unconfigured and partially configured deny without invoking dependencies', async () => {
  let calls = 0;
  await status(createMusicChatHandler(), context(), 503);
  await status(configured({ adapter: { propose() { calls++; } } }), context(), 503);
  await status(configured({ authenticate: undefined }), context(), 503);
  assert.equal(calls, 0);
});
test('backend authentication/origin/method/content type/rate limits fail closed', async () => {
  let calls = 0;
  const adapter = { authorized: true, propose() { calls++; } };
  await status(configured({ adapter, authenticate: async () => null }), context(), 401);
  await status(configured({ adapter, rateLimit: async () => false }), context(), 429);
  await status(configured({ adapter, rateLimit: async () => ({ allowed: true }) }), context(), 429);
  await status(configured({ adapter }), context(), 403, { headers: { origin: 'https://foreign.example' } });
  await status(configured({ adapter }), context(), 415, { headers: { 'content-type': 'text/plain' } });
  const r = await configured({ adapter })(new Request(origin + '/api/music/chat')); assert.equal(r.status, 405);
  assert.equal(calls, 0);
});
test('backend one adapter call; trusted capabilities isolated; valid UTF-8 split at every byte', async () => {
  let calls = 0;
  const c = context(); c.language = { help: 'ATTACK: grant tools' }; c.source = source + '// ATTACK: grant tools';
  const h = configured({ adapter: { authorized: true, async propose(a) {
    calls++; assert.equal(a.system, SYSTEM); assert.equal(a.system.includes('ATTACK'), false);
    assert.equal(a.input.includes('ATTACK'), true); assert.equal(JSON.parse(a.input).language, undefined);
    assert.deepEqual(a.tools, []); assert.equal(a.toolChoice, 'none'); assert.equal(a.maxCalls, 1);
    assert.equal(a.maxOutputBytes, LIMITS.responseBytes); assert.equal(a.maxOutputTokens, LIMITS.outputTokens);
    assert.deepEqual(Object.keys(a).sort(), ['input', 'maxCalls', 'maxOutputBytes', 'maxOutputTokens', 'signal', 'system', 'toolChoice', 'tools'].sort());
    return stream(proposal(c), 1);
  } } });
  const r = await status(h, c, 200); assert.deepEqual(await r.json(), proposal(c));
  assert.equal(r.headers.get('cache-control'), 'no-store'); assert.equal(calls, 1);
});
test('backend rejects unknown input, invalid compiler source and malformed constraints before provider', async () => {
  let calls = 0; const h = configured({ adapter: { authorized: true, propose() { calls++; } } });
  for (const c of [{ ...context('a'), system: 'override' }, { ...context('b'), source: 'fetch("evil")' },
    { ...context('c'), constraints: { tools: true } }, { ...context('d'), request: '' }]) await status(h, c, 400);
  assert.equal(calls, 0);
});
test('backend accepts complete 150–200 KiB explicit-event source without context truncation', async () => {
  const c = context();
  c.source = source.replace('totalFrames:120', 'totalFrames:100000') + Array.from({ length: 2800 }, (_, i) =>
    `event({ch:0,frame:${120 + i * 20},frames:10,midi:60,inst:0,vel:1})`).join('\n');
  assert.ok(Buffer.byteLength(c.source) > 150 * 1024 && Buffer.byteLength(c.source) < 200 * 1024);
  let input;
  const h = configured({ adapter: { authorized: true, propose: async a => { input = JSON.parse(a.input); return stream(proposal(c)); } } });
  await status(h, c, 200); assert.equal(input.source, c.source);
});
test('backend bounded incoming bytes, malformed UTF-8, nested JSON and unsafe keys', async () => {
  await status(configured(), context(), 413, { body: stream(' '.repeat(LIMITS.requestBytes + 1)) });
  await status(configured(), context(), 413, { body: new ReadableStream({ start(c) { c.enqueue(Uint8Array.of(0xFF)); c.close(); } }) });
  await status(configured(), context(), 400, { body: '['.repeat(40) + '0' + ']'.repeat(40) });
  await status(configured(), context(), 400, { body: '{"__proto__":{}}' });
  await status(configured(), context(), 413, { headers: { 'content-length': String(LIMITS.requestBytes + 1) } });
  await status(configured(), { ...context(), source: '🎵'.repeat(LIMITS.sourceBytes / 4 + 1) }, 413);
});
test('oversized valid source is explicit and never reserves or invokes paid inference', async () => {
  const c = { ...context(), source: source + '// ' + 'x'.repeat(LIMITS.sourceBytes) };
  assert(language.compile(c.source).gb, 'source remains a valid editable project');
  let reservations = 0, calls = 0;
  const h = configured({ reserveRequest: async () => { reservations++; return { ok: true }; },
    adapter: { authorized: true, propose() { calls++; } } });
  const r = await status(h, c, 413);
  assert.deepEqual(await r.json(), { error: 'source_too_large' });
  assert.equal(reservations, 0); assert.equal(calls, 0);
  const client = new Client({ fetch() { calls++; } });
  await assert.rejects(client.request(c), /512 KiB UTF-8.*no request was sent/);
  assert.equal(calls, 0); assert.equal(client.active, null); assert.equal(client.requests.size, 0);
  const unicode = { ...context(), source: source + '// ' + '🎵'.repeat(LIMITS.sourceBytes / 4) };
  assert(unicode.source.length < LIMITS.sourceBytes, 'limit counts UTF-8 bytes, not JS length');
  await assert.rejects(client.request(unicode), /512 KiB UTF-8/); assert.equal(calls, 0);
});
test('backend strict localized response rejects malformed edits, wrong ids, tools and invalid music', async () => {
  const variants = [
    { ...proposal(), id: 'other' }, { ...proposal(), baseRevision: 'r2' }, { ...proposal(), tools: [] },
    { ...proposal(), edits: [] }, { ...proposal(), edits: [{ from: -1, to: 0, text: 'x' }] },
    { ...proposal(), edits: [{ from: offset, to: offset + 2, text: 'bad' }] },
    { ...proposal(), edits: [{ from: 0, to: source.length, text: source.replace('midi:60', 'midi:62') }] },
    { ...proposal(), edits: [proposal().edits[0], proposal().edits[0]] },
    { ...proposal(), edits: [{ ...proposal().edits[0], command: 'execute' }] },
    { ...proposal(), edits: [{ from: source.indexOf('🎵') + 1, to: source.indexOf('🎵') + 1, text: 'x' }] },
    { ...proposal(), edits: [{ from: offset, to: offset + 2, text: '60' }] },
    { ...proposal(), edits: [{ from: 0, to: 0, text: ' '.repeat(LIMITS.editBytes + 1) }] }
  ];
  for (const v of variants) await status(configured({ adapter: { authorized: true, propose: async () => stream(v) } }), context(), 502);
});
test('backend recompiles and enforces musical locks and scope', async () => {
  await status(configured(), { ...context(), constraints: { locks: [{ type: 'track', tracks: [0] }] } }, 502);
  await status(configured(), { ...context(), constraints: { scope: { tracks: [3] } } }, 502);
  await status(configured(), { ...context(), constraints: { scope: { tracks: [0], fromFrame: 0, toFrame: 20 } } }, 200);
});
test('backend output byte limits without length header, invalid UTF-8 and no error-body disclosure', async () => {
  let cancelled = false;
  await status(configured({ adapter: { authorized: true, propose: async () => new ReadableStream({
    start(c) { c.enqueue(new Uint8Array(LIMITS.responseBytes + 1)); }, cancel() { cancelled = true; }
  }) } }), context(), 502); assert.equal(cancelled, true);
  await status(configured({ adapter: { authorized: true, propose: async () => new ReadableStream({
    start(c) { c.enqueue(Uint8Array.of(0xC3)); c.close(); }
  }) } }), context(), 502);
  const r = await status(configured({ adapter: { authorized: true, propose: async () => { throw Error('PRIVATE_PROVIDER_DETAIL'); } } }), context(), 502);
  assert.equal((await r.text()).includes('PRIVATE_PROVIDER_DETAIL'), false);
});
test('backend timeout aborts hung provider and stalled body without waiting for cooperation', async () => {
  let signal;
  const h = configured({ timeoutMs: 15, adapter: { authorized: true, propose: a => { signal = a.signal; return new Promise(() => {}); } } });
  const r = await status(h, context(), 504); assert.equal((await r.json()).error, 'timeout'); assert.equal(signal.aborted, true);
  await status(configured({ timeoutMs: 15 }), context(), 504, { body: new ReadableStream({ pull() { return new Promise(() => {}); } }) });
  await status(configured({ timeoutMs: 15, adapter: { authorized: true, propose: async () => new ReadableStream({ pull() { return new Promise(() => {}); } }) } }), context(), 504);
});
test('backend cancellation, concurrent request and replay rejection; no retry', async () => {
  const entered = deferred(), hold = deferred(), controller = new AbortController(); let calls = 0, signal;
  const h = configured({ adapter: { authorized: true, propose(a) { calls++; signal = a.signal; entered.resolve(); return hold.promise; } } });
  const pending = h(request(context(), { signal: controller.signal })); await entered.promise;
  await status(h, context('second'), 409);
  controller.abort(); assert.equal((await pending).status, 499); assert.equal(signal.aborted, true);
  await status(h, context(), 409); assert.equal(calls, 1);
  hold.resolve(stream(proposal()));
});
test('backend replay also rejected after success and failures', async () => {
  const h = configured(); await status(h, context(), 200); await status(h, context(), 409);
  const bad = configured({ adapter: { authorized: true, propose: async () => stream('{}') } });
  await status(bad, context(), 502); await status(bad, context(), 409);
});

test('client offline, unconfigured and rate-limited errors release active request', async () => {
  for (const code of [404, 503, 429]) {
    const c = new Client({ fetch: async () => new Response('', { status: code }) });
    await assert.rejects(c.request(context()), code === 429 ? /rate limited/ : /not configured/); assert.equal(c.active, null);
  }
  const c = new Client({ fetch: async () => { throw new TypeError('offline'); } });
  await assert.rejects(c.request(context()), /offline/); assert.equal(c.active, null);
});
test('client backend round trip, explicit proposal validation/apply and duplicate rejection', async () => {
  const h = configured(), p = project.create(source, { compile: language.compile });
  const base = p.beginRequest('request-1'); assert.equal(base.ok, true);
  const c = new Client({ fetch: async (_, init) => h(request(context(), { body: init.body, signal: init.signal })) });
  const answer = await c.request(context());
  const v = { id: answer.id, baseRevision: answer.baseRevision, baseSource: base.baseSource, edits: answer.edits };
  assert.equal(p.validateProposal(v).ok, true);
  assert.equal(p.validateProposal(v).code, 'duplicate-response');
  assert.equal(p.applyProposal(answer.id).ok, true); assert.equal(p.applyProposal(answer.id).ok, false);
  assert.equal(p.validated.compiled.gb.notes[0].midi, 62);
});
test('client late cancelled response cannot overwrite newer active request', async () => {
  const old = deferred(), next = deferred(); let calls = 0;
  const c = new Client({ fetch: () => ++calls === 1 ? old.promise : next.promise });
  const a = c.request(context()); await assert.rejects(c.request(context('busy')), /already active/);
  c.cancel(); const b = c.request(context('new'));
  old.resolve(new Response(JSON.stringify(proposal()))); await assert.rejects(a, /cancelled/);
  assert.ok(c.active); next.resolve(new Response(JSON.stringify(proposal(context('new')))));
  assert.equal((await b).id, 'new'); assert.equal(c.active, null);
});
test('manual edit and project cancellation reject otherwise valid late client proposals', async () => {
  for (const action of ['edit', 'cancel']) {
    const p = project.create(source, { compile: language.compile }), base = p.beginRequest('request-1');
    const delayed = deferred(), c = new Client({ fetch: () => delayed.promise });
    const pending = c.request(context());
    if (action === 'edit') p.editDraft(source + '// manual edit'); else p.cancelRequest('request-1');
    delayed.resolve(new Response(JSON.stringify(proposal()))); const answer = await pending;
    assert.equal(p.validateProposal({ id: answer.id, baseRevision: answer.baseRevision, baseSource: base.baseSource, edits: answer.edits }).ok, false);
    assert.equal(p.validated.source, source);
  }
});

// Execute the actual client source in a VM solely to replace its 30s timer;
// this does not rewrite production code or wait 30 seconds per fixture.
function timedClient(fetch) {
  let tick;
  const box = { AbortController, TextDecoder, TextEncoder, setTimeout(fn) { tick = fn; return 1; }, clearTimeout() {}, module: { exports: {} } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/music-chat.js'), 'utf8'), box);
  return { client: new box.module.exports.Client({ fetch }), fire: () => tick() };
}
test('default fetch is bound to the global receiver; injected fetch identity is unchanged',async()=>{
  const box={AbortController,TextDecoder,TextEncoder,setTimeout,clearTimeout,module:{exports:{}},reply:()=>new Response(JSON.stringify(proposal()))};
  vm.createContext(box);
  vm.runInContext('globalThis.fetch=function(){if(this!==globalThis)throw Error("Illegal invocation");return Promise.resolve(reply());}',box);
  vm.runInContext(fs.readFileSync(require.resolve('../src/music-chat.js'),'utf8'),box);
  const c=new box.module.exports.Client();assert.equal((await c.request(context())).id,'request-1');
  const injected=async()=>new Response(JSON.stringify(proposal()));
  const custom=new box.module.exports.Client({fetch:injected});assert.equal(custom.fetch,injected);
  assert.equal((await custom.request(context())).id,'request-1');
});
test('timeout and explicit cancel settle stalled reads/text/fetch and clean up without awaiting cancellation',async()=>{
  for(const mode of ['timeout','cancel'])for(const stage of ['fetch','read','text']){
    const entered=deferred();let cancelled=false,released=false,signal;
    const reader={read(){entered.resolve();return new Promise(()=>{});},cancel(){cancelled=true;return new Promise(()=>{});},releaseLock(){released=true;}};
    const t=timedClient((_,opts)=>{
      signal=opts.signal;
      if(stage==='fetch'){entered.resolve();return new Promise(()=>{});}
      return Promise.resolve({ok:true,headers:new Headers(),body:stage==='read'?{getReader:()=>reader}:null,
        text(){entered.resolve();return new Promise(()=>{});}});
    });
    const pending=t.client.request(context());await entered.promise;
    if(mode==='timeout')t.fire();else t.client.cancel();
    await assert.rejects(pending,mode==='timeout'?/timed out/:/cancelled/);
    assert.equal(t.client.active,null);assert.equal(signal.aborted,true);
    if(stage==='read'){assert.equal(cancelled,true);assert.equal(released,true);}
    await assert.rejects(t.client.request(context()),/Duplicate/);
  }
});
test('client checks reply against detached wire context despite caller mutation',async()=>{
  const hold=deferred(),c=new Client({fetch:()=>hold.promise}),ctx=context();
  const pending=c.request(ctx);ctx.id='other';ctx.baseRevision='r2';ctx.source='changed';
  hold.resolve(new Response(JSON.stringify(proposal())));assert.equal((await pending).id,'request-1');
});
test('client cancels unread error/header-oversize bodies and releases invalid UTF-8 reader',async()=>{
  for(const mode of ['http','length','utf8']){
    let cancelled=false,signal;
    const body=new ReadableStream({start(c){if(mode==='utf8')c.enqueue(Uint8Array.of(0xFF));},cancel(){cancelled=true;}});
    const c=new Client({fetch:async(_,opts)=>{signal=opts.signal;return new Response(body,{status:mode==='http'?503:200,
      headers:mode==='length'?{'content-length':'1048577'}:{}});}});
    await assert.rejects(c.request(context()));assert.equal(cancelled,true);assert.equal(signal.aborted,true);assert.equal(body.locked,false);
  }
});
test('client timeout works when fetch cooperates with AbortSignal', async () => {
  const t = timedClient((_, opts) => new Promise((_, reject) => opts.signal.addEventListener('abort', () => reject(Error('aborted')), { once: true })));
  const pending = t.client.request(context()); await new Promise(resolve=>setImmediate(resolve));t.fire(); await assert.rejects(pending, /timed out/); assert.equal(t.client.active, null);
});
test('client timeout settles uncooperative fetch and cancels its late body', async () => {
  const delayed = deferred(), t = timedClient(() => delayed.promise);let cancelled=false;
  const pending = t.client.request(context());await new Promise(resolve=>setImmediate(resolve));
  t.fire(); await assert.rejects(pending,/timed out/);assert.equal(t.client.active,null);
  delayed.resolve(new Response(new ReadableStream({cancel(){cancelled=true;}})));
  await new Promise(resolve=>setImmediate(resolve));assert.equal(cancelled,true);
});
test('client rejects wrong response id and stale base revision', async () => {
  for (const value of [{ ...proposal(), id: 'other' }, { ...proposal(), baseRevision: 'r2' }]) {
    const c = new Client({ fetch: async () => new Response(JSON.stringify(value)) });
    await assert.rejects(c.request(context()), /Invalid chat proposal/);
  }
});
test('client rejects unknown envelope fields and malformed localized edits', async () => {
  const edits=[[],[{from:-1,to:0,text:'x'}],[{from:offset,to:offset+2,text:7}],
    [{from:0,to:source.length,text:'replacement'}],[proposal().edits[0],proposal().edits[0]],
    [{...proposal().edits[0],tools:[]}],[{from:offset,to:source.length+1,text:'62'}],
    [{from:source.indexOf('🎵')+1,to:source.indexOf('🎵')+1,text:'x'}],
    [{from:offset,to:offset+2,text:'\uD800'}],[{from:offset,to:offset+2,text:'60'}]];
  for(const bad of [{...proposal(),tools:[]},...edits.map(edits=>({...proposal(),edits}))]){
    const c = new Client({ fetch: async () => new Response(JSON.stringify(bad)) });
    await assert.rejects(c.request(context()),/Invalid chat proposal/);
  }
});
test('client replay tombstones deny duplicate successes and failures and fail closed at 1024', async () => {
  const c = new Client({ fetch: async () => new Response(JSON.stringify(proposal())) });
  assert.equal((await c.request(context())).id, 'request-1');
  await assert.rejects(c.request(context()),/Duplicate/);
  let calls=0;const failed=new Client({fetch:async()=>{calls++;throw Error('offline');}});
  for(let i=0;i<1024;i++)await assert.rejects(failed.request(context('id-'+i)),/offline/);
  await assert.rejects(failed.request(context('id-0')),/Duplicate/);
  await assert.rejects(failed.request(context('new-id')),/limit reached/);assert.equal(calls,1024);
});
test('client streamed response byte ceiling works independently of content-length', async () => {
  const c = new Client({ fetch: async () => new Response(new ReadableStream({ start(s) { s.enqueue(new Uint8Array(1048577)); s.close(); } })) });
  await assert.rejects(c.request(context()), /too large/); assert.equal(c.active, null);
});
test('client non-stream fallback and request body use UTF-8 byte bounds', async () => {
  // Whitespace outside JSON must be ASCII; put multibyte padding in an unchecked field.
  const payload = JSON.stringify({ ...proposal(), padding: '🎵'.repeat(270000) });
  assert.ok(Buffer.byteLength(payload) > 1048576 && payload.length < 1048576);
  const c = new Client({ fetch: async () => ({ ok: true, headers: new Headers(), text: async () => payload }) });
  await assert.rejects(c.request(context()), /too large/);
  let calls = 0; const out = new Client({ fetch: () => { calls++; } });
  await assert.rejects(out.request({ ...context(), source: '🎵'.repeat(270000) }), /too large/);
  assert.equal(calls, 0);
});
test('client rejects invalid UTF-8 and aborts oversize stream without awaiting cancel', async () => {
  const invalid = new Client({ fetch: async () => new Response(new ReadableStream({ start(c) { c.enqueue(Uint8Array.of(0xFF)); c.close(); } })) });
  await assert.rejects(invalid.request(context()));
  let signal, cancelled = false;
  const c = new Client({ fetch: async (_, opts) => {
    signal = opts.signal;
    return new Response(new ReadableStream({ start(s) { s.enqueue(new Uint8Array(1048577)); },
      cancel() { cancelled = true; return new Promise(() => {}); } }));
  } });
  await assert.rejects(c.request(context()), /too large/); assert.equal(signal.aborted, true); assert.equal(cancelled, true);
});

(async () => {
  let failures = 0;
  for (const [name, fn] of cases) {
    try { await fn(); console.log('PASS ' + name); }
    catch (e) { failures++; console.error('FAIL ' + name + '\n' + e.stack); }
  }
  console.log(`\n${cases.length - failures}/${cases.length} groups passed. No real provider used.`);
  process.exitCode = failures ? 1 : 0;
})();
