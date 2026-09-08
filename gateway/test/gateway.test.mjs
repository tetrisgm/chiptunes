import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from 'jose';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { readConfig, createVerifier } from '../lib/auth.mjs';
import { createGateway, metadataResponse } from '../lib/gateway.mjs';
import { createBrokerStore, configuredStore } from '../lib/postgres-store.mjs';

const env = { MCP_OAUTH_ISSUER: 'https://identity.example', MCP_OAUTH_AUDIENCE: 'music',
  MCP_OAUTH_JWKS_URL: 'https://identity.example/jwks', MCP_RESOURCE_URL: 'https://music.example/api/mcp' };
// Explicit cryptographic fixture, never production environment configuration.
const config = {issuer:env.MCP_OAUTH_ISSUER,audience:env.MCP_OAUTH_AUDIENCE,resource:env.MCP_RESOURCE_URL};
const keys = await generateKeyPair('ES256');
const jwk = await exportJWK(keys.publicKey);
const verify = createVerifier(config, createLocalJWKSet({ keys: [{ ...jwk, kid: 'test', alg: 'ES256' }] }));
async function token(overrides = {}, key = keys.privateKey) {
  return new SignJWT({ scope: 'music:read music:propose', client_id: 'test-client', ...overrides })
    .setProtectedHeader({ alg: 'ES256', kid: 'test' }).setIssuer(overrides.iss ?? config.issuer)
    .setAudience(overrides.aud ?? config.audience).setSubject(overrides.sub ?? 'owner')
    .setIssuedAt().setExpirationTime(overrides.exp ?? '5m').sign(key);
}

test('real jose verifier checks signature, issuer, audience, expiry, nbf and identity claims', async () => {
  assert.equal((await verify(await token())).subject, 'owner');
  for (const claims of [{ iss: 'https://evil.example' }, { aud: 'other' }, { exp: 1 },
    { nbf: Math.floor(Date.now() / 1000) + 600 }, { sub: '' }, { client_id: '' }]) {
    const signed = await token(claims);
    await assert.rejects(() => verify(signed));
  }
  const wrong = await generateKeyPair('ES256');
  const forged = await token({}, wrong.privateKey);
  await assert.rejects(() => verify(forged));
});

test('missing or unsafe identity configuration fails closed; metadata is canonical', async () => {
  assert.equal(readConfig({}), null);
  for (const value of ['http://identity.example', 'https://x:y@identity.example', 'https://identity.example/?secret=x']) {
    assert.equal(readConfig({ ...env, MCP_OAUTH_ISSUER: value }), null);
  }
  const req = new Request(config.resource);
  assert.equal((await createGateway({ config, verify, store: null })(req)).status, 503);
  assert.equal(metadataResponse(req, null).status, 503);
  const response = metadataResponse(new Request(config.resource, { headers: { 'x-forwarded-host': 'evil.example' } }), config);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  const data = await response.json();
  assert.equal(data.resource, config.resource);
  assert.deepEqual(data.authorization_servers, [config.issuer]);
  assert.deepEqual(data.scopes_supported, ['music:read', 'music:propose']);
});

// Callback fixture only: no durable storage or core compiler is claimed here.
// Transport tests still use real signed JWTs, the real verifier, mcp-handler,
// and the official SDK client over a Fetch Request/Response boundary.
function fixture() {
  let revoked = false;
  const calls = [];
  const context = { source: 'song({tempo:120,bars:4})', baseRevision: 'r1', generation: 3, draftEpoch: 4 };
  const allowed = (p, scope) => !revoked && p.subject === 'owner' && p.clientId === 'test-client' &&
    p.issuer === config.issuer && p.scopes.includes(scope);
  return { calls, revoke: () => { revoked = true; }, store: {
    authorize: async (p, scope) => allowed(p, scope),
    execute: async ({ principal, scope, operation, input }) => {
      if (!allowed(principal, scope)) throw new Error('denied');
      calls.push({ operation, input });
      if (operation === 'getContext') return context;
      if (operation === 'propose') return { id: input.id, status: 'pending' };
      return { id: input.id, status: 'pending' };
    },
  } };
}
async function connect(store, signed) {
  const handler = createGateway({ config, verify, store });
  const transport = new StreamableHTTPClientTransport(new URL(config.resource), {
    authProvider: { token: async () => signed },
    fetch: async (url, init) => handler(new Request(url, init)),
  });
  const client = new Client({ name: 'gateway-test', version: '1.0.0' });
  await client.connect(transport);
  return client;
}
test('SDK initializes, lists actual registry and calls context/help/proposal/status; preserves CAS', async () => {
  const f = fixture(); const client = await connect(f.store, await token());
  try {
    assert.equal((await client.listTools()).tools.length, 4);
    assert.equal((await client.callTool({ name: 'music_get_context', arguments: {} })).isError, false);
    assert.equal((await client.callTool({ name: 'music_get_help', arguments: {} })).isError, false);
    const proposal = { id: '12345678-1234-1234-1234-123456789abc', generation: 3, draftEpoch: 4,
      baseRevision: 'r1', edits: [{ from: 12, to: 13, text: '3' }], explanation: 'test' };
    assert.equal((await client.callTool({ name: 'music_propose_edit', arguments: proposal })).isError, false);
    assert.deepEqual(f.calls.find(c => c.operation === 'propose').input, proposal);
    assert.equal((await client.callTool({ name: 'music_get_proposal_status', arguments: { id: proposal.id } })).isError, false);
    assert.equal((await client.callTool({ name: 'music_propose_edit', arguments: { ...proposal, generation: 2 } })).isError, true);
    assert.equal(f.calls.filter(c => c.operation === 'propose').length, 1);
    f.revoke();
    await assert.rejects(() => client.callTool({ name: 'music_get_context', arguments: {} }));
  } finally { await client.close(); }
});
test('read-only token cannot propose; foreign owner or client cannot connect', async () => {
  const f = fixture(); const client = await connect(f.store, await token({ scope: 'music:read' }));
  try {
    const result = await client.callTool({ name: 'music_propose_edit', arguments: {
      id: '12345678-1234-1234-1234-123456789abc', generation: 3, draftEpoch: 4, baseRevision: 'r1',
      edits: [{ from: 12, to: 13, text: '3' }],
    } });
    assert.equal(result.isError, true);
    assert.equal(f.calls.length, 0);
  } finally { await client.close(); }
  for (const claims of [{ sub: 'stranger' }, { client_id: 'wrong' }]) {
    const signed = await token(claims);
    await assert.rejects(() => connect(f.store, signed));
  }
});
test('rejects URL credentials, cookies, cross-origin, missing auth and oversized chunked input', async () => {
  const handler = createGateway({ config, verify, store: fixture().store });
  const authorization = `Bearer ${await token()}`;
  for (const req of [new Request(`${config.resource}?access_token=blocked`),
    new Request('https://evil.example/api/mcp'), new Request('https://music.example/other'),
    new Request(config.resource, { headers: { cookie: 'x=y' } }),
    new Request(config.resource, { headers: { origin: 'https://evil.example' } })]) {
    assert.equal((await handler(req)).status, 400);
  }
  const denied = await handler(new Request(config.resource));
  assert.equal(denied.status, 401);
  assert.match(denied.headers.get('www-authenticate'), /resource_metadata="https:\/\/music.example/);
  assert.equal(denied.headers.get('access-control-allow-origin'), null);
  const large = await handler(new Request(config.resource, { method: 'POST', headers: { authorization }, body: 'x'.repeat(600001) }));
  assert.equal(large.status, 413);
});

test('total deadline bounds stalled verifier, store and chunked body with stalled cancel', async () => {
  const never = () => new Promise(() => {});
  const authorization = `Bearer ${await token()}`;
  const options = { config, verify, store: fixture().store, deadlineMs: 25 };
  const requests = [
    [createGateway({ ...options, verify: never }), new Request(config.resource, { headers: { authorization } })],
    [createGateway({ ...options, store: { ...options.store, authorize: never } }), new Request(config.resource, { headers: { authorization } })],
    [createGateway(options), new Request(config.resource, { method: 'POST', headers: { authorization },
      body: new ReadableStream({ pull: never, cancel: never }), duplex: 'half' })],
  ];
  for (const [handler, request] of requests) {
    const started = Date.now();
    assert.equal((await handler(request)).status, 503);
    assert.ok(Date.now() - started < 1000);
  }
});

test('broker store requires persisted scope and rechecks revoked grant inside execute transaction', async () => {
  const principal = {...await verify(await token()),grantId:'grant'};
  let record = { issuer: config.issuer, owner: 'owner', clientId: 'test-client',
    revoked: false, expiresAt: Date.now() + 60000, scopes: ['music:read'] };
  // Transaction fixture, not a database persistence test.
  const repository = { transact: async (id, fn) => {
    assert.equal(id, 'grant'); const outcome = fn(record); record = outcome.record; return outcome.result;
  } };
  const store = createBrokerStore(repository);
  assert.equal(await store.authorize(principal, 'music:read'), true);
  assert.equal(await store.authorize(principal, 'music:propose'), false);
  record.revoked = true;
  await assert.rejects(() => store.execute({ principal, scope: 'music:read', operation: 'getContext', input: {} }));
  record.revoked = false; delete record.scopes;
  assert.equal(await store.authorize(principal, 'music:read'), false);
  assert.equal(configuredStore({}), null);
  assert.equal(configuredStore({ DATABASE_URL: 'postgres://localhost/example' }), null);
});

test('grant expiration and invalid clocks persist terminal state before broker, resisting rollback', async () => {
  const principal = {...await verify(await token()),grantId:'grant'};
  for (const operation of ['authorize', 'execute']) {
    for (const expiredTime of [2000, NaN]) {
      let time = expiredTime;
      let record = { issuer: config.issuer, owner: 'owner', clientId: 'test-client', revoked: false,
        expiresAt: 2000, scopes: ['music:read'], state: { fixture: true } };
      const repository = { transact: async (_, fn) => { const next = fn(record); record = next.record; return next.result; } };
      const store = createBrokerStore(repository, { now: () => time });
      if (operation === 'authorize') assert.equal(await store.authorize(principal, 'music:read'), false);
      else await assert.rejects(() => store.execute({ principal, scope: 'music:read', operation: 'getContext', input: {} }));
      assert.equal(record.revoked, true); assert.equal(record.state, null);
      time = 1000;
      assert.equal(await store.authorize(principal, 'music:read'), false);
    }
  }
});
