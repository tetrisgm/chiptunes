import { jwtVerify } from 'jose';
import { createClerkAuth, readClerkConfig } from './clerk-auth.mjs';
export { verifyAgentToken, authenticateBrowser } from './clerk-auth.mjs';

export const SCOPES = Object.freeze(['music:read', 'music:propose']);
export function readConfig(env = process.env) {
  return readClerkConfig(env);
}

// Explicit resolver injection retains real jose cryptographic tests only.
// Without it, production ALWAYS uses Clerk; no environment-selectable fallback.
export function createVerifier(config, keyResolver) {
  if (keyResolver === undefined) return createClerkAuth(config).verifyAgentToken;
  if (!config?.issuer || !config?.audience) throw new Error('auth_unavailable');
  return async token => {
    const { payload } = await jwtVerify(token, keyResolver, {
      issuer: config.issuer, audience: config.audience, algorithms: ['RS256', 'ES256'],
      requiredClaims: ['exp', 'iat', 'sub', 'client_id'],
    });
    for (const field of ['sub', 'client_id']) {
      if (typeof payload[field] !== 'string' || !payload[field].length || payload[field].length > 512) throw new Error('invalid_token');
    }
    if (typeof payload.scope !== 'string' || payload.iat > Date.now() / 1000) throw new Error('invalid_token');
    return Object.freeze({ issuer: payload.iss, subject: payload.sub, clientId: payload.client_id,
      expiresAt: payload.exp,
      scopes: Object.freeze(payload.scope.split(' ').filter(scope => SCOPES.includes(scope))) });
  };
}
