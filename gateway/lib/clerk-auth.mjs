import { createClerkClient } from '@clerk/backend';
import { decodeJwt } from 'jose';

const MUSIC_SCOPES = Object.freeze(['music:read', 'music:propose']);
const identity = value => typeof value === 'string' && value.length > 0 && value.length <= 512;
const invalid = () => { throw new Error('invalid_token'); };

// Only these four environment values configure identity. No fixture or legacy mode.
export function readClerkConfig(env = process.env) {
  try {
    const { CLERK_SECRET_KEY: secretKey, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: publishableKey,
      MCP_OAUTH_ISSUER: issuer, MCP_RESOURCE_URL: resource } = env;
    if (!/^sk_(test|live)_.+$/.test(secretKey || '') || !/^pk_(test|live)_.+$/.test(publishableKey || '')) return null;
    const issuerUrl = new URL(issuer);
    const resourceUrl = new URL(resource);
    for (const url of [issuerUrl, resourceUrl]) {
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
    }
    if (issuer !== issuerUrl.origin || resourceUrl.pathname !== '/api/mcp') return null;
    // Bind the declared issuer to Clerk's publishable-key instance hostname.
    const host = atob(publishableKey.slice(8));
    if (host !== `${issuerUrl.host}$` || secretKey.split('_')[1] !== publishableKey.split('_')[1]) return null;
    return Object.freeze({ issuer, resource: resourceUrl.href, secretKey, publishableKey,
      authorizedParties: Object.freeze([resourceUrl.origin]) });
  } catch { return null; }
}

// Explicit SDK injection is for labeled unit tests, never selected by environment.
export function createClerkAuth(config, { client: injectedClient } = {}) {
  let client;
  function getClient() {
    if (!config?.secretKey || !config?.publishableKey || !config?.issuer || !config?.resource ||
        !config?.authorizedParties?.length) throw new Error('auth_unavailable');
    return client ||= injectedClient || createClerkClient({ secretKey: config.secretKey,
      publishableKey: config.publishableKey, telemetry: { disabled: true } });
  }

  async function verifyAgentToken(token) {
    const sdk = getClient();
    try {
      if (typeof token !== 'string' || !token.length || token.length > 16384 || /\s/.test(token)) invalid();
      let subject, clientId, expiresAt, scopes;
      if (token.startsWith('oat_')) {
        // Maintained SDK calls Clerk's OAuth-only verification endpoint. Its
        // resource includes expiration (milliseconds), omitted by toAuth().
        const verified = await sdk.idPOAuthAccessToken.verify(token);
        if (verified.type !== 'oauth_token' || verified.revoked !== false || verified.expired !== false ||
            !Number.isFinite(verified.expiration)) invalid();
        ({ subject, clientId, scopes } = verified);
        expiresAt = verified.expiration / 1000;
        // Opaque tokens have no issuer claim; Clerk verifies against the instance
        // selected by our server-side secret, never a caller-selected endpoint.
      } else {
        const request = new Request(config.resource, { headers: { authorization: `Bearer ${token}` } });
        const state = await sdk.authenticateRequest(request, { acceptsToken: 'oauth_token', clockSkewInMs: 0 });
        if (!state.isAuthenticated) invalid();
        const auth = state.toAuth();
        if (!auth?.isAuthenticated || auth.tokenType !== 'oauth_token') invalid();
        // Decode ONLY after the SDK verifies this exact JWT as an OAuth token.
        // Claims here cannot establish identity or bypass signature verification.
        const claims = decodeJwt(token);
        if (claims.iss !== config.issuer || claims.sub !== auth.userId || claims.client_id !== auth.clientId) invalid();
        subject = auth.userId;
        ({ clientId, scopes } = auth);
        expiresAt = claims.exp;
      }
      if (!identity(subject) || !identity(clientId) || !Number.isFinite(expiresAt) ||
          expiresAt <= Date.now() / 1000 || !Array.isArray(scopes) || scopes.some(scope => typeof scope !== 'string')) invalid();
      return Object.freeze({ issuer: config.issuer, subject, clientId, expiresAt,
        scopes: Object.freeze([...new Set(scopes.filter(scope => MUSIC_SCOPES.includes(scope)))]) });
    } catch { throw new Error('invalid_token'); }
  }

  async function authenticateBrowser(request) {
    const sdk = getClient();
    try {
      if (new URL(request.url).origin !== new URL(config.resource).origin) invalid();
      const nonce = request.headers.get('x-music-tab');
      if (typeof nonce !== 'string' || !/^[0-9a-fA-F]{64}$/.test(nonce)) invalid();
      // The tab capability stays local to this request, not in Clerk request
      // metadata. Only its digest becomes part of the persisted browser identity.
      const headers = new Headers(request.headers);
      headers.delete('x-music-tab');
      const identityRequest = new Request(request.url, { method: request.method, headers });
      const state = await sdk.authenticateRequest(identityRequest, { acceptsToken: 'session_token',
        authorizedParties: config.authorizedParties, clockSkewInMs: 0 });
      if (!state.isAuthenticated) invalid();
      const auth = state.toAuth({ treatPendingAsSignedOut: true });
      if (!auth?.isAuthenticated || auth.tokenType !== 'session_token' || !identity(auth.userId) ||
          !identity(auth.sessionId) || auth.sessionClaims?.iss !== config.issuer ||
          !Number.isFinite(auth.sessionClaims?.exp) || auth.sessionClaims.exp <= Date.now() / 1000) invalid();
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(nonce));
      const tabHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
      return Object.freeze({ issuer: config.issuer, subject: auth.userId,
        browserId: `${auth.sessionId}:${tabHash}` });
    } catch { throw new Error('invalid_token'); }
  }
  return Object.freeze({ verifyAgentToken, authenticateBrowser });
}

export async function verifyAgentToken(token) {
  return createClerkAuth(readClerkConfig()).verifyAgentToken(token);
}
export async function authenticateBrowser(request) {
  return createClerkAuth(readClerkConfig()).authenticateBrowser(request);
}
