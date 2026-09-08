// MOCKED SDK contract tests. These do not prove real Clerk login, OAuth
// issuance, remote signature verification, or provisioned instance settings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { generateKeyPair, SignJWT, jwtVerify } from 'jose';
import { createClerkAuth, readClerkConfig } from '../lib/clerk-auth.mjs';
import { createVerifier, readConfig } from '../lib/auth.mjs';

const issuer = 'https://clerk.example';
const env = { CLERK_SECRET_KEY: 'sk_test_mock_only',
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: `pk_test_${btoa('clerk.example$')}`,
  MCP_OAUTH_ISSUER: issuer, MCP_RESOURCE_URL: 'https://music.example/api/mcp' };
const config = readClerkConfig(env);
const expiration = Date.now() + 300000;
const opaque = { type: 'oauth_token', subject: 'user_owner', clientId: 'client_agent',
  scopes: ['openid', 'music:read', 'music:propose', 'music:read'], revoked: false,
  expired: false, expiration };
const session = { isAuthenticated: true, tokenType: 'session_token', userId: 'user_owner',
  sessionId: 'sess_verified', sessionClaims: { iss: issuer, exp: expiration / 1000 } };
const state = auth => ({ isAuthenticated: true, toAuth: () => auth });
const tabNonce = 'ab'.repeat(32);
const tabHeaders = { 'X-Music-Tab': tabNonce };
const browserId = `sess_verified:${createHash('sha256').update(tabNonce).digest('hex')}`;

test('configuration fails closed without Clerk; legacy env does not select a fallback', async () => {
  assert.ok(config);
  assert.equal(readConfig({ MCP_OAUTH_ISSUER: issuer, MCP_RESOURCE_URL: env.MCP_RESOURCE_URL,
    MCP_OAUTH_AUDIENCE: 'old', MCP_OAUTH_JWKS_URL: `${issuer}/jwks` }), null);
  for (const name of Object.keys(env)) assert.equal(readClerkConfig({ ...env, [name]: '' }), null);
  for (const changes of [{ MCP_OAUTH_ISSUER: 'https://other.example' },
    { MCP_RESOURCE_URL: 'http://music.example/api/mcp' },
    { MCP_RESOURCE_URL: 'https://music.example/api/mcp?secret=bad' },
    { MCP_RESOURCE_URL: 'https://music.example/other' },
    { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_invalid' }]) {
    assert.equal(readClerkConfig({ ...env, ...changes }), null);
  }
  const unavailable = createClerkAuth(null, { client: {} });
  await assert.rejects(() => unavailable.verifyAgentToken('oat_mock'), /auth_unavailable/);
  await assert.rejects(() => unavailable.authenticateBrowser(new Request(config.resource)), /auth_unavailable/);
  await assert.rejects(() => createVerifier(null)('token'), /auth_unavailable/);
});

test('MOCKED SDK: opaque OAuth uses dedicated maintained verifier and standard fields', async () => {
  const calls = [];
  const auth = createClerkAuth(config, { client: { idPOAuthAccessToken: {
    verify: async token => { calls.push(token); return opaque; },
  } } });
  assert.deepEqual(await auth.verifyAgentToken('oat_mock'), {
    issuer, subject: 'user_owner', clientId: 'client_agent', expiresAt: expiration / 1000,
    scopes: ['music:read', 'music:propose'],
  });
  assert.deepEqual(calls, ['oat_mock']);
});

test('MOCKED SDK: opaque expiry, revocation, identity and malformed scopes fail closed', async () => {
  for (const changes of [{ revoked: true }, { expired: true }, { expiration: null },
    { expiration: Date.now() - 1 }, { subject: '' }, { clientId: '' }, { scopes: 'music:read' },
    { scopes: [null] }, { type: 'session_token' }, { revoked: undefined }]) {
    const auth = createClerkAuth(config, { client: { idPOAuthAccessToken: {
      verify: async () => ({ ...opaque, ...changes }),
    } } });
    await assert.rejects(() => auth.verifyAgentToken('oat_mock'), /invalid_token/);
  }
  const auth = createClerkAuth(config, { client: { idPOAuthAccessToken: {
    verify: async () => { throw new Error('sensitive SDK details'); },
  } } });
  await assert.rejects(() => auth.verifyAgentToken('oat_mock'), { message: 'invalid_token' });
  for (const token of ['', null, 'oat_ token', 'x'.repeat(16385)]) {
    await assert.rejects(() => auth.verifyAgentToken(token), /invalid_token/);
  }
});

const keys = await generateKeyPair('ES256');
async function signed(claims = {}) {
  return new SignJWT({ iss: issuer, sub: 'user_owner', client_id: 'client_agent',
    exp: Math.floor(expiration / 1000), scope: 'music:read music:propose', ...claims })
    .setProtectedHeader({ alg: 'ES256', typ: 'at+jwt' }).setIssuedAt().sign(keys.privateKey);
}

test('MOCKED SDK boundary with real jose signatures: OAuth JWT is verified before mapping', async () => {
  const auth = createClerkAuth(config, { client: { authenticateRequest: async (request, options) => {
    assert.equal(options.acceptsToken, 'oauth_token');
    assert.equal(request.headers.get('cookie'), null);
    const { payload } = await jwtVerify(request.headers.get('authorization').slice(7), keys.publicKey);
    return state({ isAuthenticated: true, tokenType: 'oauth_token', userId: payload.sub,
      clientId: payload.client_id, scopes: payload.scope.split(' ') });
  } } });
  assert.deepEqual(await auth.verifyAgentToken(await signed()), { issuer, subject: 'user_owner',
    clientId: 'client_agent', expiresAt: Math.floor(expiration / 1000), scopes: ['music:read', 'music:propose'] });
  for (const changes of [{ iss: 'https://evil.example' }, { exp: 1 }, { sub: '' }, { client_id: '' }]) {
    const token = await signed(changes);
    await assert.rejects(() => auth.verifyAgentToken(token), /invalid_token/);
  }
  const token = await signed();
  const parts = token.split('.');
  parts[1] = Buffer.from(JSON.stringify({ sub: 'forged' })).toString('base64url');
  await assert.rejects(() => auth.verifyAgentToken(parts.join('.')), /invalid_token/);
});

test('MOCKED SDK: JWT decode cannot turn unauthenticated or session auth into OAuth', async () => {
  for (const result of [{ isAuthenticated: false }, state(session), state(null)]) {
    const auth = createClerkAuth(config, { client: { authenticateRequest: async () => result } });
    await assert.rejects(() => auth.verifyAgentToken('not.a.jwt'), /invalid_token/);
  }
});

test('MOCKED SDK: browser identity binds verified session to hashed tab nonce; nonce never reaches SDK', async () => {
  for (const headers of [{ cookie: '__session=mock_cookie' }, { authorization: 'Bearer mock_session' }]) {
    const request = new Request('https://music.example/api/session', { method: 'POST',
      headers: { ...headers, ...tabHeaders }, body: '{"action":"heartbeat"}' });
    const auth = createClerkAuth(config, { client: { authenticateRequest: async (received, options) => {
      assert.equal(received.url, request.url);
      assert.equal(received.method, request.method);
      assert.equal(received.headers.get('x-music-tab'), null);
      for (const [name, value] of Object.entries(headers)) assert.equal(received.headers.get(name), value);
      assert.deepEqual(options, { acceptsToken: 'session_token', authorizedParties: ['https://music.example'], clockSkewInMs: 0 });
      return state(session);
    } } });
    assert.deepEqual(await auth.authenticateBrowser(request), { issuer, subject: 'user_owner', browserId });
    assert.equal(await request.text(), '{"action":"heartbeat"}');
  }
});

test('MOCKED SDK: browser rejects OAuth, pending/unauthenticated sessions, wrong issuer and origin', async () => {
  for (const result of [{ isAuthenticated: false }, state({ ...session, isAuthenticated: false }),
    state({ ...session, tokenType: 'oauth_token' }), state({ ...session, sessionId: '' }),
    state({ ...session, sessionClaims: { iss: 'https://evil.example', exp: expiration / 1000 } }),
    state({ ...session, sessionClaims: { iss: issuer, exp: 1 } })]) {
    const auth = createClerkAuth(config, { client: { authenticateRequest: async () => result } });
    await assert.rejects(() => auth.authenticateBrowser(new Request(config.resource, { headers: tabHeaders })), /invalid_token/);
  }
  const auth = createClerkAuth(config, { client: { authenticateRequest: async () => { assert.fail('must not call SDK'); } } });
  await assert.rejects(() => auth.authenticateBrowser(new Request('https://evil.example/api/session')), /invalid_token/);
});

test('MOCKED SDK: same Clerk user/session with different tab nonces gets distinct stable browser IDs', async () => {
  const auth = createClerkAuth(config, { client: { authenticateRequest: async () => state(session) } });
  const authenticate = nonce => auth.authenticateBrowser(new Request(config.resource, { headers: { 'X-Music-Tab': nonce } }));
  const first = await authenticate(tabNonce);
  const second = await authenticate('cd'.repeat(32));
  assert.equal(first.subject, second.subject);
  assert.notEqual(first.browserId, second.browserId);
  assert.deepEqual(await authenticate(tabNonce), first);
  assert.equal(first.browserId, browserId);
  assert.ok(!JSON.stringify(first).includes(tabNonce));
  const otherSession = createClerkAuth(config, { client: { authenticateRequest: async () => state({ ...session, sessionId: 'sess_other' }) } });
  const other = await otherSession.authenticateBrowser(new Request(config.resource, { headers: tabHeaders }));
  assert.notEqual(first.browserId, other.browserId);
});

test('MOCKED SDK: missing or malformed tab nonce fails before Clerk; nonce cannot replace session verification', async () => {
  const auth = createClerkAuth(config, { client: { authenticateRequest: async () => assert.fail('must not call SDK') } });
  for (const nonce of [null, '', 'ab'.repeat(31), 'ab'.repeat(33), 'g'.repeat(64), `${tabNonce},${tabNonce}`]) {
    const request = new Request(config.resource, { headers: nonce === null ? {} : { 'X-Music-Tab': nonce } });
    await assert.rejects(() => auth.authenticateBrowser(request), { message: 'invalid_token' });
  }
  const signedOut = createClerkAuth(config, { client: { authenticateRequest: async () => ({ isAuthenticated: false }) } });
  await assert.rejects(() => signedOut.authenticateBrowser(new Request(config.resource, { headers: tabHeaders })), /invalid_token/);
});

test('real jose legacy resolver injection accepts standard identity without any song claim', async () => {
  const verify = createVerifier({ issuer, audience: 'music' }, keys.publicKey);
  const token = await signed({ aud: 'music' });
  const principal = await verify(token);
  assert.equal(principal.clientId, 'client_agent');
  assert.equal(Object.hasOwn(principal, 'grantId'), false);
  await assert.rejects(() => verify(token.replace(/.$/, '!')));
});
