'use strict';

// Inject a pg-compatible TLS pool. Never accept connection URLs from clients.
// Run music-agent-schema.sql as an explicit migration, not on each request.
const MAX_RECORD_BYTES = 8 * 1024 * 1024;
const validId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id);
function encoded(record) {
  const result = JSON.stringify(record);
  if (!result || Buffer.byteLength(result) > MAX_RECORD_BYTES) throw Error('record_limit');
  return result;
}
function createPostgresMusicAgentRepository(pool) {
  if (!pool || typeof pool.connect !== 'function') throw new TypeError('Postgres pool required');
  return Object.freeze({
    async transact(id, fn) {
      if (!validId(id) || typeof fn !== 'function') throw Error('invalid_transaction');
      const client = await pool.connect();
      let discard;
      try {
        await client.query('BEGIN');
        await client.query("SET LOCAL statement_timeout = '5s'");
        await client.query("SET LOCAL lock_timeout = '2s'");
        const rows = await client.query('SELECT record FROM music_agent_sessions WHERE id = $1 FOR UPDATE', [id]);
        const previous = rows.rows[0]?.record || null;
        const next = fn(previous);
        // Awaiting user code while holding the row lock is deliberately forbidden.
        if (!next || typeof next.then === 'function' || !Object.hasOwn(next,'record') || !Object.hasOwn(next,'result'))
          throw Error('invalid_transaction_result');
        if (next.record !== null) {
          if (!previous) throw Error('session_missing');
          await client.query('UPDATE music_agent_sessions SET record = $2::jsonb WHERE id = $1', [id,encoded(next.record)]);
        } else if (previous) throw Error('deletion_not_supported');
        await client.query('COMMIT');
        return next.result;
      } catch (_) {
        try { await client.query('ROLLBACK'); } catch (_) { discard = Error('rollback_failed'); }
        throw Error('session_transaction_failed');
      } finally { client.release(discard); }
    },
    // Trusted consent handler only. Database primary key prevents overwriting an
    // existing grant. Session IDs must be cryptographically random at the host.
    async create(id, record) {
      if (!validId(id) || !record || typeof record.issuer !== 'string' || !record.issuer || typeof record.owner !== 'string' || !record.owner ||
          typeof record.browserId !== 'string' || !record.browserId ||
          typeof record.clientId !== 'string' || !record.clientId || record.revoked !== false ||
          !Number.isFinite(record.expiresAt) || !record.state) throw Error('invalid_session');
      const text = encoded(record), client = await pool.connect();
      try {
        await client.query('INSERT INTO music_agent_sessions (id, record) VALUES ($1, $2::jsonb)', [id,text]);
      } catch (_) { throw Error('session_create_failed'); }
      finally { client.release(); }
    }
  });
}
module.exports = {createPostgresMusicAgentRepository};
