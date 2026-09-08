'use strict';

/** Integration contract (Node runtime; no HTTP auth implementation here):
 * const service = createMusicAgentConnections({pool, authenticateBrowser});
 * authenticateBrowser(request) must use the host's auth SDK and CSRF/origin
 * protection, returning {issuer, subject, browserId} or null. browserId must be
 * bound by the trusted host to this browser, never copied from request JSON.
 * Next routes parse bounded JSON (<= LIMITS.inputBytes), then call
 * service.browser(request, operation, input). Identity is NEVER in input.
 * GET clients: {}; POST consent: {clientId, lifetimeMs} (1..3600000).
 * Consent is an explicit user action after showing the exact observed clientId;
 * listing, login, polling, and OAuth observation never create a session.
 * POST publish/heartbeat/claim/ack: {sessionId, value}; value is the unchanged
 * core publish/heartbeat/claim/acknowledge input. POST revoke: {sessionId}.
 * Service poll: {sessionId,value:{generation,baseRevision,draftEpoch}};
 * returns {ok,proposal?,pending}, with pending
 * {id,generation,baseRevision,draftEpoch,status}, never candidate/source.
 * Poll reads metadata then claims ONCE atomically. The optional separate claim
 * service method takes metadata without status. A candidate is NOT an Apply
 * receipt. Browser compares the full base to
 * its current draft immediately before applying once; ack separately reports
 * applied/rejected/failed with the core's required snapshot/null. A lost claim
 * response must not be automatically retried as Apply. Heartbeat every <30s.
 * All browser results are public {ok,...}; host sends no-store responses and
 * maps access_denied/invalid_input/service_unavailable to 403/400/503. Do not
 * log bodies, source, auth headers, driver errors or internal session records.
 *
 * Pass service.store to createGateway. Its principals come ONLY from the
 * gateway's trusted OAuth verifier: {issuer,subject,clientId,scopes,expiresAt?}.
 * expiresAt, when present, is token epoch seconds; verifier must validate token
 * lifetime on every request. No grantId/custom token claim is used or needed.
 * authorize observes a verified client even when no browser pairing exists and
 * permits initialization/help; observeClient(principal) aliases read authorization.
 * execute returns {ok:false,code:'not_paired'} until consent and resolves the active client from SQL each
 * time; input/session args never route agent authority. Browser and agent scopes
 * remain separate. Observed scope changes never expand an existing grant.
 *
 * Apply both SQL files explicitly before enabling routes; factory runs no DDL.
 * Supply the existing dedicated TLS pg pool with bounded connection timeouts.
 * Repository serializes each owner before session rows; all lifecycle writers
 * MUST use this service. Existing raw broker/repository APIs are host-private.
 * Expiry (including 30s lease) and revoke are terminal; reconnect needs explicit
 * consent and a new UUID. Up to 32 observed clients and 8 active sessions/user.
 * Client tombstones are retained, so the 32-client limit is not reset by revoke.
 */
const {randomUUID} = require('node:crypto');
const {createMusicAgentSession, LIMITS} = require('./music-agent-session');
const {createMusicAgentBroker} = require('./music-agent-broker');
const {createPostgresMusicAgentRepository} = require('./music-agent-postgres');
const denied = () => ({ok:false,code:'access_denied'});
const field = v => typeof v === 'string' && v.length > 0 && v.length <= 512;
const scopes = ['music:read','music:propose'];
const methods = {getContext:'readContext',propose:'propose',getProposalStatus:'status'};
const browserMethods = {publish:'publish',heartbeat:'heartbeat',poll:'peek',claim:'claim',ack:'acknowledge',revoke:'revoke'};
function shape(v, keys) {
  return v && Object.getPrototypeOf(v) === Object.prototype &&
    Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v,k));
}
function identity(p, agent = false) {
  return p && field(p.issuer) && field(p.subject) && (agent ? field(p.clientId) &&
    Array.isArray(p.scopes) && p.scopes.includes('music:read') : field(p.browserId));
}

function createMusicAgentConnectionRepository(pool) {
  if (!pool || typeof pool.connect !== 'function') throw TypeError('Postgres pool required');
  return Object.freeze({async withOwner(p, run) {
    const client = await pool.connect();
    let discard;
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout = '5s'");
      await client.query("SET LOCAL lock_timeout = '2s'");
      await client.query('INSERT INTO music_agent_connection_owners (issuer,subject) VALUES ($1,$2) ON CONFLICT DO NOTHING', [p.issuer,p.subject]);
      await client.query('SELECT subject FROM music_agent_connection_owners WHERE issuer=$1 AND subject=$2 FOR UPDATE', [p.issuer,p.subject]);
      const time = await client.query('SELECT floor(extract(epoch FROM clock_timestamp())*1000)::float8 AS now');
      const now = time.rows[0].now;
      // Persist terminal expiry before any lookup, consent or publication.
      await client.query(`UPDATE music_agent_sessions s SET record = s.record || '{"revoked":true,"state":null}'::jsonb
        FROM music_agent_connections c WHERE c.issuer=$1 AND c.subject=$2 AND c.session_id=s.id
        AND ((s.record->>'expiresAt')::float8 <= $3 OR (s.record->>'leaseExpiresAt')::float8 <= $3
          OR (s.record->'state'->>'revoked')::boolean = true)`, [p.issuer,p.subject,now]);
      await client.query(`UPDATE music_agent_connections c SET session_id=NULL FROM music_agent_sessions s
        WHERE c.issuer=$1 AND c.subject=$2 AND c.session_id=s.id AND (s.record->>'revoked')::boolean=true`, [p.issuer,p.subject]);
      // Reuse the existing PostgreSQL repository inside this owner transaction.
      // Its transaction is a savepoint, never a second connection/early commit.
      const nestedPool = {connect:async()=>({release(){},query(sql,args) {
        const nested = {BEGIN:'SAVEPOINT music_core',COMMIT:'RELEASE SAVEPOINT music_core',ROLLBACK:'ROLLBACK TO SAVEPOINT music_core'};
        return client.query(nested[sql] || sql,args);
      }})};
      const repository = createPostgresMusicAgentRepository(nestedPool);
      const result = await run({client,repository,now});
      await client.query('COMMIT');
      return result;
    } catch (_) {
      try { await client.query('ROLLBACK'); } catch (_) { discard = Error('rollback_failed'); }
      throw Error('connection_transaction_failed');
    } finally { client.release(discard); }
  }});
}

function createMusicAgentConnections({pool, authenticateBrowser}) {
  if (typeof authenticateBrowser !== 'function') throw TypeError('Trusted browser authentication required');
  const connections = createMusicAgentConnectionRepository(pool);
  const tokenValid = (p,t) => p.expiresAt === undefined || (Number.isFinite(p.expiresAt) && p.expiresAt*1000 > t);
  async function lookup(tx,p) {
    const r = await tx.client.query('SELECT client_id,scopes,session_id FROM music_agent_connections WHERE issuer=$1 AND subject=$2 AND client_id=$3', [p.issuer,p.subject,p.clientId]);
    return r.rows[0];
  }
  async function executeCore(tx,p,id,method,input,scope) {
    const guarded = {transact:(key,fn)=>tx.repository.transact(key, record=>{
      if (!record || record.issuer!==p.issuer || record.owner!==p.subject || record.revoked ||
          (p.kind==='browser' ? record.browserId!==p.browserId : record.clientId!==p.clientId ||
            !tokenValid(p,tx.now) || !p.scopes.includes(scope) || !record.scopes.includes(scope)))
        return {record,result:denied()};
      const next = fn(record);
      if (next.record?.state?.revoked) next.record = {...next.record,revoked:true,state:null};
      if (next.result.ok && ['publish','heartbeat','acknowledge'].includes(method) && next.record.state?.expires)
        next.record.leaseExpiresAt = Math.min(next.record.expiresAt,next.record.state.expires);
      return next;
    })};
    return createMusicAgentBroker({repository:guarded,now:()=>tx.now}).execute(p,id,method,input);
  }
  const store = Object.freeze({
    async authorize(p,scope) {
      if (!identity(p,true) || !scopes.includes(scope) || !p.scopes.includes(scope)) return false;
      return connections.withOwner(p,async tx=>{
        if (!tokenValid(p,tx.now)) return false;
        let c = await lookup(tx,p);
        if (!c) {
          const count = await tx.client.query('SELECT count(*)::int AS n FROM music_agent_connections WHERE issuer=$1 AND subject=$2',[p.issuer,p.subject]);
          if (count.rows[0].n>=32) return false;
          await tx.client.query('INSERT INTO music_agent_connections (issuer,subject,client_id,scopes) VALUES ($1,$2,$3,$4::jsonb)',[p.issuer,p.subject,p.clientId,JSON.stringify(p.scopes.filter(s=>scopes.includes(s)))]);
          return true;
        }
        await tx.client.query('UPDATE music_agent_connections SET scopes=$4::jsonb,observed_at=clock_timestamp() WHERE issuer=$1 AND subject=$2 AND client_id=$3',[p.issuer,p.subject,p.clientId,JSON.stringify(p.scopes.filter(s=>scopes.includes(s)))]);
        return true;
      });
    },
    async execute({principal:p,scope,operation,input}) {
      const method = methods[operation];
      if (!identity(p,true) || !method || scope!==(method==='propose'?'music:propose':'music:read') || !p.scopes.includes(scope)) throw Error('forbidden');
      const result = await connections.withOwner(p,async tx=>{
        const c = await lookup(tx,p);
        if (!c?.session_id) return {ok:false,code:'not_paired'};
        return executeCore(tx,{...p,kind:'agent'},c.session_id,method,input,scope);
      });
      if (!result.ok) return {ok:false,code:result.code==='not_paired'?'not_paired':'music_operation_failed'};
      const {ok,...data} = result; return data;
    }
    ,async observeClient(p) { return store.authorize(p,'music:read'); }
  });
  const service = {store,async browser(request,operation,input) {
    try {
      const principal = await authenticateBrowser(request);
      if (!identity(principal)) return denied();
      const p = {...principal,kind:'browser'};
      const keys = operation==='clients'?[]:operation==='consent'?['clientId','lifetimeMs']:
        operation==='revoke'?['sessionId']:['sessionId','value'];
      if ((!Object.hasOwn(browserMethods,operation) && !['clients','consent'].includes(operation)) || !shape(input,keys))
        return {ok:false,code:'invalid_input'};
      return await connections.withOwner(p,async tx=>{
        if (operation==='clients') {
          const rows = await tx.client.query(`SELECT c.client_id AS "clientId", c.scopes,
            CASE WHEN s.record->>'browserId'=$3 THEN c.session_id ELSE NULL END AS "sessionId"
            FROM music_agent_connections c LEFT JOIN music_agent_sessions s ON s.id=c.session_id
            WHERE c.issuer=$1 AND c.subject=$2 ORDER BY c.client_id`,[p.issuer,p.subject,p.browserId]);
          return {ok:true,clients:rows.rows};
        }
        if (operation==='consent') {
          if (!field(input.clientId) || !Number.isInteger(input.lifetimeMs) || input.lifetimeMs<1 || input.lifetimeMs>3600000)
            return {ok:false,code:'invalid_input'};
          const c = await lookup(tx,{...p,clientId:input.clientId});
          if (!c || c.session_id || !c.scopes.includes('music:read')) return denied();
          const count = await tx.client.query('SELECT count(*)::int AS n FROM music_agent_connections WHERE issuer=$1 AND subject=$2 AND session_id IS NOT NULL',[p.issuer,p.subject]);
          if (count.rows[0].n>=8) return {ok:false,code:'session_limit'};
          const sessionId=randomUUID(), expiresAt=tx.now+input.lifetimeMs;
          await tx.repository.create(sessionId,{issuer:p.issuer,owner:p.subject,browserId:p.browserId,clientId:c.client_id,
            scopes:c.scopes,expiresAt,leaseExpiresAt:Math.min(expiresAt,tx.now+LIMITS.ttlMs),revoked:false,
            state:createMusicAgentSession({now:()=>tx.now}).exportState()});
          await tx.client.query('UPDATE music_agent_connections SET session_id=$4 WHERE issuer=$1 AND subject=$2 AND client_id=$3 AND session_id IS NULL',[p.issuer,p.subject,c.client_id,sessionId]);
          return {ok:true,sessionId,expiresAt,ttlMs:LIMITS.ttlMs};
        }
        // SQL ownership + active pairing check precedes the broker's row lock.
        const owned = await tx.client.query(`SELECT s.id FROM music_agent_sessions s JOIN music_agent_connections c ON c.session_id=s.id
          WHERE s.id=$1 AND c.issuer=$2 AND c.subject=$3 AND s.record->>'browserId'=$4`,[input.sessionId,p.issuer,p.subject,p.browserId]);
        if (!owned.rows.length) return denied();
        const result = await executeCore(tx,p,input.sessionId,browserMethods[operation],input.value);
        if (operation==='poll' && result.ok) {
          const pending = ['pending','claimed'].includes(result.status) ? {...result} : null;
          if (pending) delete pending.ok;
          if (pending?.status==='pending') {
            if (!shape(input.value,['generation','baseRevision','draftEpoch'])) return {ok:false,code:'invalid_input'};
            const claimed = await executeCore(tx,p,input.sessionId,'claim',{id:pending.id,...input.value});
            return {...claimed,pending};
          }
          return {ok:true,pending};
        }
        return result;
      });
    } catch (_) { return {ok:false,code:'service_unavailable'}; }
  }};
  /** Next GET/POST: return service.handleBrowser(request). Node runtime.
   * GET -> clients. POST accepts Pauli's flat {action,...} contract:
   * create {clientId}; publish {sessionId,snapshot}; heartbeat/poll
   * {sessionId,generation,baseRevision,draftEpoch}; acknowledge
   * {sessionId,id,generation,baseRevision,draftEpoch,status,snapshot}; revoke
   * {sessionId}. create uses the fixed maximum 60-minute lifetime, with a 30s
   * initial lease. poll peeks metadata then claims once in ONE SQL transaction;
   * returns {ok,proposal?,pending}. Claimed work is never re-delivered.
   * Host callback must reject cross-origin mutations using its auth framework.
   */
  service.handleBrowser = async request => {
    let result;
    try {
      let operation,input;
      if (request.method==='GET') { operation='clients'; input={}; }
      else if (request.method==='POST') {
        if (request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')
          return Response.json({ok:false,code:'invalid_input'},{status:400,headers:{'Cache-Control':'no-store'}});
        const reader=request.body?.getReader(), chunks=[]; let size=0;
        if (!reader) throw Error('invalid_input');
        for (;;) {
          const {done,value}=await reader.read(); if (done) break;
          size+=value.byteLength;
          if (size>LIMITS.inputBytes) { await reader.cancel(); throw Error('invalid_input'); }
          chunks.push(value);
        }
        const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const fields={create:['clientId'],publish:['sessionId','snapshot'],
          heartbeat:['sessionId','generation','baseRevision','draftEpoch'],poll:['sessionId','generation','baseRevision','draftEpoch'],
          acknowledge:['sessionId','id','generation','baseRevision','draftEpoch','status','snapshot'],revoke:['sessionId']};
        if (!body || !Object.hasOwn(fields,body.action) || !shape(body,['action',...fields[body.action]])) throw Error('invalid_input');
        const {action,sessionId,...value}=body;
        operation=action==='create'?'consent':action==='acknowledge'?'ack':action;
        input=action==='create'?{clientId:body.clientId,lifetimeMs:3600000}:
          action==='revoke'?{sessionId}:{sessionId,value:action==='publish'?body.snapshot:value};
      } else return Response.json({ok:false,code:'method_not_allowed'},{status:405,headers:{'Cache-Control':'no-store'}});
      result=await service.browser(request,operation,input);
    } catch (_) { result={ok:false,code:'invalid_input'}; }
    return Response.json(result,{status:result.ok?200:result.code==='service_unavailable'?503:result.code==='access_denied'?403:400,
      headers:{'Cache-Control':'no-store'}});
  };
  return Object.freeze(service);
}
module.exports = {createMusicAgentConnectionRepository,createMusicAgentConnections};
