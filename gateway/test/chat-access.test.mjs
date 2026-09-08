import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import pg from 'pg';
import { createChatAccess } from '../lib/chat-access.mjs';

const origin = 'https://music.example';
const url = origin + '/api/music/chat/access';
const env = () => ({ CHAT_ORIGIN: origin, CHAT_OWNER_PASSWORD: randomBytes(32).toString('hex') });
const noDatabase = { connect() { throw Error('PRIVATE database should not be contacted'); } };
const request = (method, body, headers = {}, target = url) => new Request(target, { method,
  headers: { origin, 'content-type': 'application/json', ...headers },
  body: body === undefined ? undefined : JSON.stringify(body) });
const cookie = response => response.headers.get('set-cookie').split(';')[0];

test('six-hour signed owner cookie, strict scope, tamper/expiry/rotation and logout', async () => {
  const config = env(); let time = 1800000000000;
  const access = createChatAccess(noDatabase, config, { now: () => time });
  assert.equal(access.configured, true);
  assert.equal(access.auth(request('GET')), null);
  const login = await access.login(request('POST', { password: config.CHAT_OWNER_PASSWORD }));
  assert.equal(login.status, 200);
  assert.deepEqual(await login.json(), { ok: true });
  assert.equal(login.headers.get('cache-control'), 'no-store');
  const header = login.headers.get('set-cookie');
  for (const flag of ['__Host-ct-chat-owner=', 'Path=/', 'Secure', 'HttpOnly', 'SameSite=Strict', 'Max-Age=21600'])
    assert.equal(header.includes(flag), true);
  assert.equal(header.includes(config.CHAT_OWNER_PASSWORD), false);
  assert.equal(header.includes('Domain='), false);
  const token = cookie(login);
  assert.deepEqual(access.auth(request('GET', undefined, { cookie: token })), { subject: 'chat-owner' });
  assert.deepEqual(access.auth(request('POST', {}, { cookie: token })), { subject: 'chat-owner' });
  const tampered = token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a');
  assert.equal(access.auth(request('GET', undefined, { cookie: tampered })), null);
  assert.equal(access.auth(request('GET', undefined, { cookie: token + '; ' + token })), null);
  assert.equal(createChatAccess(noDatabase, env(), { now: () => time }).auth(request('GET', undefined, { cookie: token })), null);
  time += 21600000 - 1000;
  assert.ok(access.auth(request('GET', undefined, { cookie: token })));
  time += 1000;
  assert.equal(access.auth(request('GET', undefined, { cookie: token })), null);
  time = 1799999999000;
  assert.equal(access.auth(request('GET', undefined, { cookie: token })), null);
  const logout = access.logout(request('DELETE', undefined, { cookie: token }));
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal(access.logout(request('GET')).status, 405);
});

test('configuration, exact HTTPS origin, body shape, password and body limits fail closed', async () => {
  const config = env();
  for (const changes of [{ CHAT_ORIGIN: 'http://music.example' }, { CHAT_ORIGIN: origin + '/' },
    { CHAT_ORIGIN: origin + '?secret=x' }, { CHAT_OWNER_PASSWORD: '' }, { CHAT_OWNER_PASSWORD: 'short' }]) {
    const disabled = createChatAccess(noDatabase, { ...config, ...changes });
    assert.equal(disabled.configured, false);
    assert.equal((await disabled.login(request('POST', {}))).status, 503);
    assert.equal(disabled.auth(request('GET')), null);
  }
  const access = createChatAccess(noDatabase, config);
  for (const req of [request('POST', {}, {}, 'http://music.example/api/music/chat/access'),
    request('POST', {}, {}, 'https://evil.example/api/music/chat/access'),
    request('POST', {}, { origin: 'https://evil.example' }), request('POST', {}, { origin: 'null' }),
    request('POST', {}, { 'sec-fetch-site': 'same-site' }), request('POST', {}, { authorization: 'Bearer fixture' }),
    request('POST', {}, {}, url + '?password=redacted'),
    new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })])
    assert.equal((await access.login(req)).status, 403);
  assert.equal((await access.login(request('GET'))).status, 405);
  assert.equal((await access.login(request('POST', {}, { 'content-type': 'text/plain' }))).status, 415);
  for (const body of [{}, { password: 1 }, { password: config.CHAT_OWNER_PASSWORD, subject: 'forged' }, []])
    assert.equal((await access.login(request('POST', body))).status, 400);
  const wrong = await access.login(request('POST', { password: 'incorrect' }));
  assert.equal(wrong.status, 401); assert.equal(wrong.headers.has('set-cookie'), false);
  assert.equal((await access.login(request('POST', { password: 'x'.repeat(2049) }))).status, 413);
  assert.equal((await access.login(request('POST', {}, { 'content-length': '2049' }))).status, 413);
  const broken = new Request(url, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{PRIVATE' });
  assert.deepEqual(await (await access.login(broken)).json(), { ok: false, code: 'invalid_request' });
});

test('database errors are sanitized and invalid authority never enters a transaction', async () => {
  const access = createChatAccess(noDatabase, env());
  assert.deepEqual(await access.reserve('intruder', 'request'), { ok: false, code: 'unauthorized' });
  assert.deepEqual(await access.reserve('chat-owner', '../request'), { ok: false, code: 'invalid_request' });
  assert.deepEqual(await access.reserve('chat-owner', 'request'), { ok: false, code: 'access_unavailable' });
  assert.deepEqual(await access.release('chat-owner', 'request'), { ok: false, code: 'access_unavailable' });
});

test('real isolated PostgreSQL: global quota, concurrent replay, leases, failures, restart and rollover', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'ct-chat-access-'));
  let child, pool, exited;
  try {
    await fs.chmod(temporary, 0o700);
    execFileSync('initdb', ['-D', path.join(temporary, 'data'), '-A', 'trust', '--no-locale', '-E', 'UTF8'], { stdio: 'pipe' });
    child = spawn('postgres', ['-D', path.join(temporary, 'data'), '-k', temporary, '-c', 'listen_addresses='], { stdio: 'ignore' });
    exited = new Promise(resolve => { child.once('exit', resolve); child.once('error', resolve); });
    pool = new pg.Pool({ host: temporary, user: os.userInfo().username, database: 'postgres', max: 8, connectionTimeoutMillis: 1000 });
    const deadline = Date.now() + 10000;
    for (;;) {
      try { await pool.query('SELECT 1'); break; }
      catch { if (Date.now() > deadline) throw Error('isolated_database_unavailable'); await new Promise(r => setTimeout(r, 50)); }
    }
    await pool.query(await fs.readFile(new URL('../../server/music-chat-access.sql', import.meta.url), 'utf8'));
    // Deterministic DB clock fixture; all row locks, writes, constraints and
    // transaction isolation below execute in real PostgreSQL.
    let time = 1800000000000;
    const clockPool = { async connect() {
      const client = await pool.connect();
      return { release: error => client.release(error), query: (sql, args) =>
        sql === 'SELECT floor(extract(epoch FROM clock_timestamp())*1000)::float8 AS now'
          ? Promise.resolve({ rows: [{ now: time }] }) : client.query(sql, args) };
    } };
    const config = env(), first = createChatAccess(clockPool, config), second = createChatAccess(clockPool, config);
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) =>
      (i % 2 ? first : second).reserve('chat-owner', 'same-request')));
    assert.equal(results.filter(r => r.ok).length, 1);
    assert.equal(results.filter(r => r.code === 'duplicate_request').length, 7);
    assert.equal(results.find(r => r.ok).leaseUntil, time + 45000);
    const counts = async () => (await pool.query('SELECT * FROM music_chat_budget')).rows[0];
    assert.equal((await counts()).day_count, 1);
    assert.equal((await counts()).minute_count, 1);
    assert.equal((await first.reserve('chat-owner', 'other-request')).code, 'request_active');
    // Failed/cancelled model work retains its reservation and quota. No release
    // is needed for recovery after lease expiry; same ID is still never callable.
    time += 45000;
    assert.equal((await second.reserve('chat-owner', 'same-request')).code, 'duplicate_request');
    assert.equal((await second.reserve('chat-owner', 'other-request')).ok, true);
    await first.release('chat-owner', 'same-request'); // Late release cannot clear successor.
    assert.equal((await counts()).active_request, 'other-request');
    await second.release('chat-owner', 'other-request');
    await second.release('chat-owner', 'other-request'); // Idempotent; no refund.
    assert.equal((await counts()).day_count, 2);
    assert.equal((await first.reserve('chat-owner', 'third-request')).code, 'minute_limit');
    time = Math.floor(time / 60000) * 60000 + 60000;
    assert.equal((await first.reserve('chat-owner', 'third-request')).ok, true);
    await first.release('chat-owner', 'third-request');
    // Set one daily slot remaining without making20 model calls. Concurrent
    // admissions may never cross the global ceiling, even from fresh instances.
    await pool.query('UPDATE music_chat_budget SET day_count=19,minute_count=0');
    const last = await Promise.all([first.reserve('chat-owner', 'daily-last-a'), second.reserve('chat-owner', 'daily-last-b')]);
    assert.equal(last.filter(r => r.ok).length, 1);
    assert.equal((await counts()).day_count, 20);
    await first.release('chat-owner', last[0].ok ? 'daily-last-a' : 'daily-last-b');
    assert.equal((await second.reserve('chat-owner', 'daily-over')).code, 'daily_limit');
    const restarted = createChatAccess(clockPool, config);
    time += 60000;
    assert.equal((await restarted.reserve('chat-owner', 'daily-over')).code, 'daily_limit');
    time = Math.floor(time / 86400000) * 86400000 + 86400000;
    assert.equal((await restarted.reserve('chat-owner', 'same-request')).code, 'duplicate_request');
    assert.equal((await restarted.reserve('chat-owner', 'next-day')).ok, true);
    assert.equal((await counts()).day_count, 1);
    time -= 1;
    assert.equal((await restarted.reserve('chat-owner', 'regressed-clock')).code, 'clock_invalid');
    assert.equal((await counts()).day_count, 1);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM music_chat_requests')).rows[0].n, 5);
  } finally {
    if (pool) await pool.end();
    if (child && child.exitCode === null) { child.kill('SIGTERM'); await exited; }
    await fs.rm(temporary, { recursive: true, force: true });
  }
});
