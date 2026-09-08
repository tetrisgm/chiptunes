'use strict';

// The repository MUST lock the session row and commit record + result atomically.
// transact(id, fn): fn(record|null) returns {record,result}; no external I/O inside
// fn. Authentication is performed by the host before creating the principal.
// Never expose this broker directly as an unauthenticated HTTP endpoint.
const {createMusicAgentSession} = require('./music-agent-session');
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const DENIED = Object.freeze({ok:false,code:'access_denied'});
function createMusicAgentBroker({repository, now = Date.now}) {
  if (!repository || typeof repository.transact !== 'function' || typeof now !== 'function')
    throw new TypeError('Transactional repository required');
  const browserMethods = new Set(['publish','heartbeat','peek','claim','acknowledge','revoke']);
  const agentMethods = new Set(['readContext','propose','status']);
  async function execute(principal, sessionId, method, input) {
    if (!principal || typeof sessionId !== 'string' || !ID.test(sessionId) || !['browser','agent'].includes(principal.kind) ||
        typeof principal.subject !== 'string' || !principal.subject ||
        !(principal.kind === 'browser' ? browserMethods : agentMethods).has(method)) return {...DENIED};
    try {
      return await repository.transact(sessionId, record => {
        let t;
        try { t = now(); } catch (_) { t = NaN; }
        if (!record || typeof principal.issuer !== 'string' || !principal.issuer || record.issuer !== principal.issuer ||
            record.owner !== principal.subject || record.revoked)
          return {record,result:{...DENIED}};
        // Expiry/clock failure is terminal, even if the host clock rolls back.
        if (!Number.isFinite(t) || !Number.isFinite(record.expiresAt) || t >= record.expiresAt)
          return {record:{...record,revoked:true,state:null},result:{...DENIED}};
        if (principal.kind === 'agent') {
          const scope = method === 'propose' ? 'music:propose' : 'music:read';
          if (typeof principal.clientId !== 'string' || record.clientId !== principal.clientId ||
              !Array.isArray(principal.scopes) || !principal.scopes.includes(scope))
            return {record,result:{...DENIED}};
        } else if (typeof principal.browserId !== 'string' || record.browserId !== principal.browserId) {
          return {record,result:{...DENIED}};
        }
        const core = createMusicAgentSession({now:()=>t,state:record.state});
        const result = core[method](input);
        const next = {...record,state:core.exportState(),revoked:method === 'revoke' || record.revoked};
        return {record:next,result};
      });
    } catch (_) { return {ok:false,code:'session_unavailable'}; }
  }
  return Object.freeze({execute});
}
module.exports = {createMusicAgentBroker};
