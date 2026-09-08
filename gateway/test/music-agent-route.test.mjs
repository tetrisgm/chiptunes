import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createProductionHandlers, handleBrowser } from '../lib/production.mjs';
import { databasePoolOptions, configuredConnections } from '../lib/postgres-store.mjs';
import * as route from '../app/api/music-agent/route.js';
import { createClerkAuth } from '../lib/clerk-auth.mjs';
import connectionsModule from '../../server/music-agent-connections.js';
import sessionModule from '../../server/music-agent-session.js';

const config = { issuer: 'https://identity.example', resource: 'https://music.example/api/mcp' };
const url = 'https://music.example/api/music-agent';
const headers = { origin: 'https://music.example', 'content-type': 'application/json',
  'X-Music-Tab': 'a'.repeat(64),
  'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty', cookie: '__session=fixture' };
const post = (body = { action: 'create', clientId: 'fixture-client' }, extra = {}) =>
  new Request(url, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(body) });
function fixture(overrides = {}) {
  const calls = [];
  const connections = { store: { authorize: async () => true, execute: async () => ({}) },
    handleBrowser: async request => {
      calls.push({ method: request.method, cookie: request.headers.get('cookie'),
        authorization: request.headers.get('authorization'),
        body: request.method === 'POST' ? await request.json() : null });
      return Response.json({ ok: true, clients: [{ clientId: 'fixture-client' }] });
    } };
  return { calls, ...createProductionHandlers({ config, verify: async () => null, connections, ...overrides }) };
}
async function status(handler, request, expected) {
  const response = await handler(request);
  assert.equal(response.status, expected);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.equal(JSON.stringify(await response.json()).includes('PRIVATE'), false);
}

test('route exports exact shared Node handlers; GET and POST preserve cookies and payload', async () => {
  assert.equal(route.GET, handleBrowser); assert.equal(route.POST, handleBrowser);
  assert.equal(route.runtime, 'nodejs'); assert.equal(route.dynamic, 'force-dynamic');
  const f = fixture();
  await status(f.handleBrowser, new Request(url, { headers: { cookie: '__session=fixture' } }), 200);
  for (const body of [{ action: 'create', clientId: 'fixture-client' },
    { action: 'publish', sessionId: 'session', snapshot: { source: 'song({bars:1})' } },
    { action: 'heartbeat', sessionId: 'session', generation: 1, baseRevision: 'r1', draftEpoch: 0 },
    { action: 'poll', sessionId: 'session', generation: 1, baseRevision: 'r1', draftEpoch: 0 },
    { action: 'acknowledge', sessionId: 'session', id: 'p1', generation: 1, baseRevision: 'r1', draftEpoch: 0, status: 'rejected', snapshot: null },
    { action: 'revoke', sessionId: 'session' }]) {
    await status(f.handleBrowser, post(body), 200);
    assert.deepEqual(f.calls.at(-1).body, body);
    assert.equal(f.calls.at(-1).cookie, '__session=fixture');
  }
  await status(f.handleBrowser, post({}, { authorization: 'Bearer fixture-session' }), 200);
  assert.equal(f.calls.at(-1).authorization, 'Bearer fixture-session');
});

test('browser route denies foreign URL/origin and unsafe Fetch Metadata before service', async () => {
  const f = fixture();
  for (const request of [new Request('https://evil.example/api/music-agent'),
    new Request(url + '?source=PRIVATE'), new Request('https://music.example/api/other'),
    post({}, { origin: 'https://evil.example' }), post({}, { origin: 'null' }),
    ...['cross-site', 'same-site', 'none'].map(site => post({}, { 'sec-fetch-site': site })),
    ...['navigate', 'no-cors', 'websocket'].map(mode => post({}, { 'sec-fetch-mode': mode })),
    post({}, { 'sec-fetch-dest': 'document' }),
    new Request(url, { headers: { origin: 'https://evil.example', 'x-forwarded-host': 'music.example' } })]) {
    await status(f.handleBrowser, request, 400);
  }
  const missingOrigin = new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  await status(f.handleBrowser, missingOrigin, 403);
  await status(f.handleBrowser, new Request(url, { method: 'DELETE' }), 405);
  await status(f.handleBrowser, post({}, { 'content-type': 'text/plain' }), 415);
  assert.equal(f.calls.length, 0);
});

test('browser route bounds declared and chunked body bytes before invoking service', async () => {
  const f = fixture();
  await status(f.handleBrowser, post({}, { 'content-length': String(sessionModule.LIMITS.browserBytes + 1) }), 413);
  await status(f.handleBrowser, post({}, { 'content-length': 'invalid' }), 400);
  let cancelled = false;
  const request = new Request(url, { method: 'POST', headers, duplex: 'half',
    body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(sessionModule.LIMITS.browserBytes + 1)); },
      cancel() { cancelled = true; return new Promise(() => {}); } }) });
  await status(f.handleBrowser, request, 413);
  assert.equal(cancelled, true); assert.equal(f.calls.length, 0);
});

test('browser route passes session bearer to Clerk but rejects SDK OAuth identity before any DB access', async () => {
  let verified = 0;
  const auth = createClerkAuth({ ...config, secretKey: 'sk_test_fixture', publishableKey: 'pk_test_fixture',
    authorizedParties: ['https://music.example'] }, { client: {
    authenticateRequest: async (request, options) => {
      verified++;
      assert.equal(request.headers.get('authorization'), 'Bearer fixture-oauth');
      assert.equal(options.acceptsToken, 'session_token');
      return { isAuthenticated: true, toAuth: () => ({ isAuthenticated: true,
        tokenType: 'oauth_token', userId: 'owner', sessionId: 'fixture',
        sessionClaims: { iss: config.issuer, exp: Date.now() / 1000 + 300 } }) };
    },
  } });
  const connections = connectionsModule.createMusicAgentConnections({
    pool: { connect() { assert.fail('OAuth identity must never reach browser persistence'); } },
    authenticateBrowser: request => auth.authenticateBrowser(request).catch(() => null),
  });
  const f = fixture({ connections });
  await status(f.handleBrowser, post(undefined, { authorization: 'Bearer fixture-oauth' }), 403);
  assert.equal(verified, 1);
});

test('total route deadline bounds stalled body/cancel and service; errors never expose details', async () => {
  const never = () => new Promise(() => {});
  const f = fixture({ deadlineMs: 25 });
  const stalled = new Request(url, { method: 'POST', headers, duplex: 'half',
    body: new ReadableStream({ pull: never, cancel: never }) });
  const before = Date.now();
  await status(f.handleBrowser, stalled, 503);
  assert.ok(Date.now() - before < 1000); assert.equal(f.calls.length, 0);
  for (const run of [never, async () => { throw Error('PRIVATE database'); }]) {
    const slow = fixture({ deadlineMs: 25, connections: { handleBrowser: run } });
    await status(slow.handleBrowser, post(), 503);
  }
  await status(fixture({ config: null }).handleBrowser, post(), 503);
  await status(fixture({ connections: null }).handleBrowser, post(), 503);
});

test('Neon SSL URL normalization preserves strict TLS in actual pg client parsing', async () => {
  const env = { MCP_DATABASE_DEDICATED: 'true',
    DATABASE_URL: 'postgresql://localhost/music?sslmode=require&channel_binding=require' };
  for (const suffix of ['', '&ssl=false&sslmode=no-verify&uselibpqcompat=true',
    '&sslcert=/nonexistent-fixture&sslkey=/nonexistent-fixture&sslrootcert=/nonexistent-fixture',
    '&SSLMODE=disable&sslnegotiation=direct']) {
    const options = databasePoolOptions({ ...env, DATABASE_URL: env.DATABASE_URL + suffix });
    assert.ok(options);
    const parsed = new URL(options.connectionString);
    assert.equal(parsed.searchParams.get('channel_binding'), 'require');
    assert.equal([...parsed.searchParams.keys()].some(k => k.toLowerCase().startsWith('ssl')), false);
    const client = new pg.Client(options); // No connection or credentials required.
    assert.deepEqual(client.connectionParameters.ssl, { rejectUnauthorized: true });
    assert.equal(options.connectionTimeoutMillis, 5000);
    assert.equal(options.statement_timeout, 5000);
  }
  for (const changes of [{ MCP_DATABASE_DEDICATED: 'false' }, { DATABASE_URL: 'PRIVATE invalid' },
    { DATABASE_URL: 'https://localhost/music' }, { DATABASE_URL: 'postgres://localhost/' },
    { DATABASE_URL: env.DATABASE_URL + '&sslunknown=unsafe' }])
    assert.equal(databasePoolOptions({ ...env, ...changes }), null);
  assert.equal(databasePoolOptions({}), null);
  let created = 0;
  class FixturePool {
    constructor(options) { created++; assert.equal(options.ssl.rejectUnauthorized, true); }
    on(name, callback) { assert.equal(name, 'error'); callback(Error('PRIVATE')); }
    connect() { assert.fail('factory must not connect or migrate'); }
  }
  assert.equal(configuredConnections(env), null);
  const service = configuredConnections(env, { authenticateBrowser: async () => null, Pool: FixturePool });
  assert.equal(created, 1);
  assert.equal(typeof service.handleBrowser, 'function');
  assert.equal(typeof service.store.observeClient, 'function');
  assert.equal(typeof service.store.authorize, 'function');
  assert.equal(typeof service.store.execute, 'function');
});
