import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Private owner-access gate; no Clerk, provider SDK, or credential provisioning.
 * createChatAccess(pool, env) -> {configured, auth, login, logout, reserve, release}
 * env: CHAT_ORIGIN (exact canonical HTTPS origin), CHAT_OWNER_PASSWORD (random
 * server-provisioned secret, 32..1024 UTF-8 bytes). No API keys enter this module.
 * pool: dedicated TLS pg-compatible pool with bounded connection/query timeouts.
 * Run server/music-chat-access.sql separately before enablement. No factory DDL.
 *
 * login(Request POST JSON {password}) -> Fetch Response with six-hour signed
 * __Host-ct-chat-owner cookie. logout(POST or DELETE) expires the cookie; it does
 * not invalidate a copied cookie elsewhere. Rotating CHAT_OWNER_PASSWORD does.
 * auth(Request) -> {subject:'chat-owner'} | null, rejects cross-origin/non-HTTPS
 * requests and bearer credentials. POST Origin is mandatory. No browser subject
 * or request argument is ever identity. Login body is bounded to 2048 bytes/5s.
 *
 * reserve(subject, requestId) -> {ok:true,leaseUntil} ONLY for first admission;
 * failures {ok:false,code}: unauthorized, invalid_request, duplicate_request,
 * request_active, daily_limit, minute_limit, clock_invalid, access_unavailable.
 * It commits global UTC-day max20, UTC-minute max2, and replay evidence BEFORE
 * the model call. Fixed windows permit a double burst across minute boundaries.
 * One global active lease lasts at most45s. Duplicate IDs never authorize a new
 * call, consume another quota slot, or renew a lease, including after failure,
 * release, restart, day rollover, or lease expiration. Quota is never refunded.
 * release(subject, requestId) -> {ok:true} (idempotent), or fixed failure; call
 * only once provider work/stream has finished. Abort alone is not proof. A late release
 * cannot clear another request's lease. It never deletes replay evidence.
 *
 * Integrating server/music-chat-handler.js: authenticate = access.auth. Its
 * rateLimit callback precedes body parsing and cannot reserve by request ID.
 * Supply reserveRequest(subject,id) and attach release only on ok:true; the
 * handler invokes it after validation and invokes the provider only on ok:true.
 * Do not retry an uncertain reservation/model call.
 * Release after provider work finishes (including stream consumption), not on
 * receipt of stream headers. Keep handler/provider timeout <=30s and honor abort
 * signals so work ends before the45s lease. No auto-retry of failed calls.
 * Routes map duplicate/active to409, quota to429, configuration/DB to503.
 * Never log passwords, cookies, SQL errors, or provider data. This is private
 * owner proof, not a public identity/account system. Replay rows store metadata
 * only and are retained indefinitely; no background cleanup is installed.
 */
const SUBJECT = 'chat-owner';
const COOKIE = '__Host-ct-chat-owner';
const SESSION_SECONDS = 21600;
const hash = value => createHash('sha256').update(value).digest();
const failed = code => ({ ok: false, code });
const response = (status, body, cookie) => Response.json(body, { status, headers: {
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  ...(cookie ? { 'Set-Cookie': cookie } : {}),
} });
const cookieValue = (value, age) => `${COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${age}`;

// Optional clock injection is for tests only; never configured from HTTP/env.
export function createChatAccess(pool, env = process.env, { now = Date.now } = {}) {
  let origin, passwordHash, signingKey;
  try {
    const url = new URL(env.CHAT_ORIGIN);
    if (url.protocol !== 'https:' || url.origin !== env.CHAT_ORIGIN || url.username || url.password || url.search || url.hash)
      throw Error('invalid_configuration');
    const password = env.CHAT_OWNER_PASSWORD;
    if (typeof password !== 'string' || Buffer.byteLength(password) < 32 || Buffer.byteLength(password) > 1024)
      throw Error('invalid_configuration');
    origin = url.origin;
    passwordHash = hash(password);
    signingKey = createHmac('sha256', passwordHash).update('chiptunes:owner-cookie:v1').digest();
  } catch { origin = null; }
  const configured = !!origin && typeof pool?.connect === 'function' && typeof now === 'function';
  const safe = request => {
    try {
      const url = new URL(request.url);
      const site = request.headers.get('sec-fetch-site');
      return configured && url.protocol === 'https:' && url.origin === origin && !url.username && !url.password &&
        !url.search && !request.headers.has('authorization') &&
        (site === null || site === 'same-origin') &&
        (!request.headers.has('origin') || request.headers.get('origin') === origin) &&
        (['GET', 'HEAD'].includes(request.method) || request.headers.get('origin') === origin);
    } catch { return false; }
  };
  const sign = text => createHmac('sha256', signingKey).update(text).digest();
  function auth(request) {
    if (!safe(request)) return null;
    try {
      const cookies = (request.headers.get('cookie') || '').split(';').map(s => s.trim())
        .filter(s => s.startsWith(COOKIE + '='));
      if (cookies.length !== 1 || cookies[0].length > 256) return null;
      const token = cookies[0].slice(COOKIE.length + 1);
      const match = /^v1\.(\d{1,12})\.(\d{1,12})\.([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(token);
      if (!match) return null;
      const [, issued, expires] = match, current = Math.floor(now() / 1000);
      if (!Number.isSafeInteger(current) || current < Number(issued) || current >= Number(expires) ||
          Number(expires) - Number(issued) !== SESSION_SECONDS) return null;
      const signed = token.slice(0, token.lastIndexOf('.'));
      if (!timingSafeEqual(sign(signed), Buffer.from(match[4], 'hex'))) return null;
      return { subject: SUBJECT };
    } catch { return null; }
  }
  async function login(request) {
    if (!configured) return response(503, failed('access_unavailable'));
    if (request.method !== 'POST') return response(405, failed('method_not_allowed'));
    if (!safe(request)) return response(403, failed('origin_denied'));
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') || ''))
      return response(415, failed('json_required'));
    let reader, timer;
    try {
      const length = request.headers.get('content-length');
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > 2048)) return response(413, failed('request_too_large'));
      if (!request.body) return response(400, failed('invalid_request'));
      reader = request.body.getReader();
      const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(Error('timeout')), 5000); });
      const chunks = []; let size = 0;
      for (;;) {
        const { done, value } = await Promise.race([reader.read(), timeout]);
        if (done) break;
        size += value.byteLength;
        if (size > 2048) return response(413, failed('request_too_large'));
        chunks.push(value);
      }
      const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
      if (!body || Array.isArray(body) || Object.keys(body).length !== 1 || typeof body.password !== 'string')
        return response(400, failed('invalid_request'));
      if (!timingSafeEqual(hash(body.password), passwordHash)) return response(401, failed('unauthorized'));
      const issued = Math.floor(now() / 1000);
      if (!Number.isSafeInteger(issued) || issued < 0) throw Error('clock_invalid');
      const payload = `v1.${issued}.${issued + SESSION_SECONDS}.${randomBytes(16).toString('hex')}`;
      return response(200, { ok: true }, cookieValue(`${payload}.${sign(payload).toString('hex')}`, SESSION_SECONDS));
    } catch { return response(400, failed('invalid_request')); }
    finally { clearTimeout(timer); if (reader) void reader.cancel().catch(() => {}); }
  }
  function logout(request) {
    if (!configured) return response(503, failed('access_unavailable'));
    if (!['POST', 'DELETE'].includes(request.method)) return response(405, failed('method_not_allowed'));
    if (!safe(request)) return response(403, failed('origin_denied'));
    return response(200, { ok: true }, cookieValue('', 0));
  }
  async function transaction(run) {
    let client, discard;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout = '5s'");
      await client.query("SET LOCAL lock_timeout = '2s'");
      const locked = await client.query('SELECT * FROM music_chat_budget WHERE singleton=true FOR UPDATE');
      if (locked.rows.length !== 1) throw Error('missing_migration');
      const time = await client.query('SELECT floor(extract(epoch FROM clock_timestamp())*1000)::float8 AS now');
      const current = time.rows[0].now;
      let result;
      if (!Number.isSafeInteger(current) || current < Number(locked.rows[0].last_time)) result = failed('clock_invalid');
      else {
        await client.query('UPDATE music_chat_budget SET last_time=$1 WHERE singleton=true', [current]);
        result = await run(client, locked.rows[0], current);
      }
      await client.query('COMMIT');
      return result;
    } catch {
      if (client) try { await client.query('ROLLBACK'); } catch { discard = Error('rollback_failed'); }
      return failed('access_unavailable');
    } finally { client?.release(discard); }
  }
  const valid = (subject, requestId) => {
    if (!configured) return 'access_unavailable';
    if (subject !== SUBJECT) return 'unauthorized';
    if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(requestId)) return 'invalid_request';
    return null;
  };
  async function reserve(subject, requestId) {
    const invalid = valid(subject, requestId); if (invalid) return failed(invalid);
    return transaction(async (client, budget, current) => {
      const replay = await client.query('SELECT request_id FROM music_chat_requests WHERE request_id=$1', [requestId]);
      if (replay.rows.length) return failed('duplicate_request');
      if (budget.active_request && Number(budget.lease_until) > current) return failed('request_active');
      const day = Math.floor(current / 86400000) * 86400000;
      const minute = Math.floor(current / 60000) * 60000;
      const dayCount = Number(budget.day_start) === day ? budget.day_count : 0;
      const minuteCount = Number(budget.minute_start) === minute ? budget.minute_count : 0;
      if (dayCount >= 20) return failed('daily_limit');
      if (minuteCount >= 2) return failed('minute_limit');
      const leaseUntil = current + 45000;
      await client.query('INSERT INTO music_chat_requests (request_id,subject,reserved_at,lease_until) VALUES ($1,$2,$3,$4)',
        [requestId, subject, current, leaseUntil]);
      await client.query(`UPDATE music_chat_budget SET day_start=$1,day_count=$2,
        minute_start=$3,minute_count=$4,active_request=$5,lease_until=$6 WHERE singleton=true`,
      [day, dayCount + 1, minute, minuteCount + 1, requestId, leaseUntil]);
      return { ok: true, leaseUntil };
    });
  }
  async function release(subject, requestId) {
    const invalid = valid(subject, requestId); if (invalid) return failed(invalid);
    return transaction(async (client, _budget, current) => {
      await client.query('UPDATE music_chat_requests SET released_at=COALESCE(released_at,$3) WHERE request_id=$1 AND subject=$2',
        [requestId, subject, current]);
      await client.query('UPDATE music_chat_budget SET active_request=NULL,lease_until=0 WHERE singleton=true AND active_request=$1', [requestId]);
      return { ok: true };
    });
  }
  return Object.freeze({ configured, auth, login, logout, reserve, release });
}
