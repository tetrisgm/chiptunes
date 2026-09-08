/**
 * DurableMusicStore interface (all methods asynchronous):
 *
 * authorize(principal, scope) -> true | false
 * execute({ principal, scope, operation, input }) -> public JSON
 *
 * principal = {issuer, subject, clientId, grantId, expiresAt, scopes} from JWT.
 * operation = 'getContext' | 'propose' | 'getProposalStatus'.
 * input = {} | the registry's unmodified proposal | {id}.
 *
 * Both methods MUST resolve the stored grant, check issuer/subject/clientId,
 * session ownership, scope, expiry and revocation; never trust grantId alone.
 * execute MUST repeat those checks in the same durable transaction as the core
 * operation, load/save persisted state, serialize competing requests, and enforce
 * offline/heartbeat/replay/CAS checks. No snapshot read followed by blind write.
 * propose preserves id/generation/draftEpoch/baseRevision supplied by the caller.
 * Returned data must be public JSON; exceptions must not contain source/secrets.
 * Help/list/initialization also require authorize; callbacks use execute afresh.
 * No process-local session fallback is allowed.
 */
export function isStore(store) {
  return !!store && typeof store.authorize === 'function' && typeof store.execute === 'function';
}

// Production provider is configuredStore in postgres-store.mjs. Missing dedicated
// database configuration returns null; no fixture is imported by production.
