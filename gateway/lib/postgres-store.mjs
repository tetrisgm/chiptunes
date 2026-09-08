import pg from 'pg';
import brokerModule from '../../server/music-agent-broker.js';
import repositoryModule from '../../server/music-agent-postgres.js';

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

export function configuredStore(env = process.env) {
  // Explicit dedicated database opt-in; never fall back to another product DB.
  if (!env.DATABASE_URL || env.MCP_DATABASE_DEDICATED !== 'true') return null;
  try {
    const url = new URL(env.DATABASE_URL);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) return null;
    // pg connection-string SSL parameters override ssl config; forbid them.
    if ([...url.searchParams.keys()].some(key => key.toLowerCase().startsWith('ssl'))) return null;
    const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 3,
      ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000, statement_timeout: 5000, query_timeout: 6000 });
    pool.on('error', () => {}); // Never emit driver errors containing connection details.
    return createBrokerStore(repositoryModule.createPostgresMusicAgentRepository(pool));
  } catch { return null; }
}
