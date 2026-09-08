// Real temporary PostgreSQL and SDK transport. Clerk boundary is explicitly
// injected; this does not prove real Clerk issuance/login or touch Neon.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import pg from 'pg';
import { generateKeyPair, SignJWT, jwtVerify } from 'jose';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createVerifier } from '../lib/auth.mjs';
import { createClerkAuth } from '../lib/clerk-auth.mjs';
import { createProductionHandlers } from '../lib/production.mjs';
import connectionsModule from '../../server/music-agent-connections.js';

test('shared production handlers: standard OAuth discovery -> browser consent -> durable musical tools -> revoke', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'ct-route-pg-'));
  let child, pool, exited, mcp;
  try {
    await fs.chmod(temporary, 0o700);
    execFileSync('initdb', ['-D', path.join(temporary, 'data'), '-A', 'trust', '--no-locale', '-E', 'UTF8'], { stdio: 'pipe' });
    child = spawn('postgres', ['-D', path.join(temporary, 'data'), '-k', temporary, '-c', 'listen_addresses='], { stdio: 'ignore' });
    exited = new Promise(resolve => { child.once('exit', resolve); child.once('error', resolve); });
    pool = new pg.Pool({ host: temporary, user: os.userInfo().username, database: 'postgres', max: 4, connectionTimeoutMillis: 1000 });
    const deadline = Date.now() + 10000;
    for (;;) {
      try { await pool.query('SELECT 1'); break; }
      catch { if (Date.now() > deadline) throw Error('isolated_database_unavailable'); await new Promise(r => setTimeout(r, 50)); }
    }
    for (const name of ['music-agent-schema.sql', 'music-agent-connections.sql'])
      await pool.query(await fs.readFile(new URL(`../../server/${name}`, import.meta.url), 'utf8'));
    const config = { issuer: 'https://identity.example', audience: 'music', resource: 'https://music.example/api/mcp',
      secretKey: 'sk_test_fixture', publishableKey: 'pk_test_fixture', authorizedParties: ['https://music.example'] };
    const keys = await generateKeyPair('ES256');
    const sign = payload => new SignJWT(payload).setProtectedHeader({ alg: 'ES256' })
      .setIssuer(config.issuer).setSubject('owner').setAudience('music').setIssuedAt().setExpirationTime('5m').sign(keys.privateKey);
    const oauth = await sign({ client_id: 'agent-client', scope: 'music:read music:propose' });
    const session = await sign({ sid: 'browser-session' });
    const auth = createClerkAuth(config, { client: { authenticateRequest: async (request, options) => {
      assert.equal(options.acceptsToken, 'session_token');
      const { payload } = await jwtVerify(request.headers.get('authorization').slice(7), keys.publicKey,
        { issuer: config.issuer, audience: config.audience });
      return { isAuthenticated: true, toAuth: () => ({ isAuthenticated: true,
        tokenType: payload.sid ? 'session_token' : 'oauth_token', userId: payload.sub,
        sessionId: payload.sid, sessionClaims: payload }) };
    } } });
    const connections = connectionsModule.createMusicAgentConnections({ pool,
      authenticateBrowser: request => auth.authenticateBrowser(request).catch(() => null) });
    const handlers = createProductionHandlers({ config, connections, verify: createVerifier(config, keys.publicKey) });
    const browser = async (body, token = session) => {
      const response = await handlers.handleBrowser(new Request('https://music.example/api/music-agent', {
        method: body ? 'POST' : 'GET', headers: { origin: 'https://music.example',
          'X-Music-Tab': 'a'.repeat(64),
          'content-type': 'application/json', authorization: `Bearer ${token}`, 'sec-fetch-site': 'same-origin' },
        body: body ? JSON.stringify(body) : undefined,
      }));
      assert.equal(response.headers.get('cache-control'), 'no-store');
      return response.json();
    };
    mcp = new Client({ name: 'isolated-route-test', version: '1.0.0' });
    await mcp.connect(new StreamableHTTPClientTransport(new URL(config.resource), {
      authProvider: { token: async () => oauth }, fetch: (url, init) => handlers.handleMcp(new Request(url, init)),
    }));
    assert.equal((await mcp.listTools()).tools.length, 4);
    const tool = async (name, args = {}) => {
      const result = await mcp.callTool({ name, arguments: args });
      return { result, data: JSON.parse(result.content[0].text) };
    };
    assert.equal((await tool('music_get_help')).result.isError, false);
    assert.equal((await tool('music_get_context')).data.code, 'not_paired');
    assert.equal((await browser()).clients[0].clientId, 'agent-client');
    assert.equal((await browser({ action: 'create', clientId: 'agent-client' }, oauth)).code, 'access_denied');
    const { sessionId } = await browser({ action: 'create', clientId: 'agent-client' });
    assert.ok(sessionId);
    const snapshot = { source: 'song({tempo:120,bars:1})\n', baseRevision: 'r1', draftEpoch: 0, selection: null, constraints: {} };
    assert.equal((await browser({ action: 'publish', sessionId, snapshot })).ok, true);
    const context = (await tool('music_get_context')).data;
    assert.equal(context.source, snapshot.source);
    const base = { generation: context.generation, baseRevision: snapshot.baseRevision, draftEpoch: context.draftEpoch };
    const agentBase = { ...base, baseRevision: context.baseRevision };
    assert.match(context.baseRevision, /^[a-f0-9]{64}$/);
    assert.notEqual(context.baseRevision, snapshot.baseRevision);
    const id = '12345678-1234-4234-8234-123456789abc';
    assert.equal((await tool('music_propose_edit', { id, ...agentBase, edits: [{ from: 0, to: 0, text: '// edit\n' }] })).data.status, 'pending');
    const polls = await Promise.all([browser({ action: 'poll', sessionId, ...base }), browser({ action: 'poll', sessionId, ...base })]);
    assert.equal(polls.filter(p => p.proposal).length, 1);
    assert.equal((await tool('music_get_proposal_status', { id })).data.status, 'claimed');
    assert.equal((await browser({ action: 'acknowledge', sessionId, id, ...base, status: 'rejected', snapshot: null })).status, 'rejected');
    assert.equal((await tool('music_get_proposal_status', { id })).data.status, 'rejected');
    // Raw source is within 512KiB, while its escaped JSON exceeds MCP's 600k.
    const large = { ...snapshot, source: snapshot.source + '//' + '"'.repeat(310000), baseRevision: 'r2', draftEpoch: 1 };
    assert.ok(Buffer.byteLength(JSON.stringify(large)) > 600000);
    assert.equal((await browser({ action: 'publish', sessionId, snapshot: large })).ok, true);
    assert.equal((await tool('music_get_context')).data.source, large.source);
    assert.equal((await browser({ action: 'revoke', sessionId })).ok, true);
    assert.equal((await tool('music_get_context')).data.code, 'not_paired');
    assert.equal((await tool('music_get_help')).result.isError, false);
  } finally {
    if (mcp) await mcp.close();
    if (pool) await pool.end();
    if (child && child.exitCode === null) { child.kill('SIGTERM'); await exited; }
    await fs.rm(temporary, { recursive: true, force: true });
  }
});
