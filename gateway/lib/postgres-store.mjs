import pg from 'pg';
import brokerModule from '../../server/music-agent-broker.js';
import connectionsModule from '../../server/music-agent-connections.js';

const methods = Object.freeze({ getContext: 'readContext', propose: 'propose', getProposalStatus: 'status' });
function checked(record, principal, scope, now) {
  const matches = !!record && record.issuer === principal.issuer && record.owner === principal.subject &&
    record.clientId === principal.clientId;
  if (!matches) return { record, result: false };
  let time;
  try { time = now(); } catch { time = NaN; }
  if (!Number.isFinite(time) || !Number.isFinite(record.expiresAt) || time >= record.expiresAt) {
    return { record: { ...record, revoked: true, state: null }, result: false };
  }
  return { record, result: record.revoked === false && principal.expiresAt * 1000 > time &&
    principal.scopes.includes(scope) && Array.isArray(record.scopes) && record.scopes.includes(scope) };
}
// Legacy repository contract retained for existing isolated regression fixtures;
// production below never uses grantId routing or this adapter.
export function createBrokerStore(repository, { now = Date.now } = {}) {
  return Object.freeze({
    authorize: (principal, scope) => repository.transact(principal.grantId, record => checked(record, principal, scope, now)),
    execute: async ({ principal, scope, operation, input }) => {
      const method = methods[operation];
      if (!method || scope !== (method === 'propose' ? 'music:propose' : 'music:read')) throw new Error('forbidden');
      // Repeat grant checks inside the broker's SAME transaction, not only at
      // HTTP authorization time. grantId selects a row; it grants no authority.
      const guarded = { transact: (id, fn) => repository.transact(id, record => {
        const check = checked(record, principal, scope, now);
        if (!check.result) return { record: check.record, result: { ok: false, code: 'access_denied' } };
        return fn(record);
      }) };
      const broker = brokerModule.createMusicAgentBroker({ repository: guarded, now });
      const result = await broker.execute({ ...principal, kind: 'agent' }, principal.grantId, method, input);
      if (!result.ok) throw new Error('music_operation_failed');
      const { ok, ...data } = result;
      return data;
    },
  });
}

// Host-private options: never log or return these through an API. pg's URL SSL
// fields override explicit options; remove them before the driver sees the URL.
const sslParameters = new Set(['ssl', 'sslmode', 'sslcert', 'sslkey', 'sslrootcert',
  'sslnegotiation', 'uselibpqcompat']);
export function databasePoolOptions(env = process.env) {
  if (!env.DATABASE_URL || env.MCP_DATABASE_DEDICATED !== 'true') return null;
  try {
    const url = new URL(env.DATABASE_URL);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname ||
        !url.pathname || url.pathname === '/' || url.hash) return null;
    for (const key of [...url.searchParams.keys()]) {
      const lower = key.toLowerCase();
      if (sslParameters.has(lower)) url.searchParams.delete(key);
      else if (lower.startsWith('ssl')) return null;
    }
    return { connectionString: url.href, max: 3,
      ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000, statement_timeout: 5000, query_timeout: 6000 };
  } catch { return null; }
}

// Shared durable browser + MCP service. Construction does no DDL or network I/O.
// Expired source/rows are removed opportunistically on this owner's requests;
// explicit revoke unlinks and deletes its row. Idle expired source persists until
// owner activity. No guaranteed timed purge or automatic retention job exists.
export function configuredConnections(env = process.env, { authenticateBrowser, Pool = pg.Pool } = {}) {
  const options = databasePoolOptions(env);
  if (!options || typeof authenticateBrowser !== 'function') return null;
  try {
    const pool = new Pool(options);
    pool.on('error', () => {}); // Never emit driver errors containing connection details.
    return connectionsModule.createMusicAgentConnections({ pool, authenticateBrowser });
  } catch { return null; }
}

export function configuredStore(env = process.env, options) {
  return configuredConnections(env, options)?.store || null;
}
