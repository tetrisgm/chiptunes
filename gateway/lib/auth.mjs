import { createRemoteJWKSet, jwtVerify } from 'jose';

export const SCOPES = Object.freeze(['music:read', 'music:propose']);
export function readConfig(env = process.env) {
  const names = ['MCP_OAUTH_ISSUER', 'MCP_OAUTH_AUDIENCE', 'MCP_OAUTH_JWKS_URL', 'MCP_RESOURCE_URL'];
  if (names.some(name => !env[name])) return null;
  try {
    for (const name of ['MCP_OAUTH_ISSUER', 'MCP_OAUTH_JWKS_URL', 'MCP_RESOURCE_URL']) {
      const url = new URL(env[name]);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
    }
    if (new URL(env.MCP_RESOURCE_URL).pathname !== '/api/mcp') return null;
    return Object.freeze({ issuer: env.MCP_OAUTH_ISSUER, audience: env.MCP_OAUTH_AUDIENCE,
      jwksUrl: env.MCP_OAUTH_JWKS_URL, resource: env.MCP_RESOURCE_URL });
  } catch { return null; }
}

// keyResolver injection is for cryptographic tests; the route uses remote JWKS.
export function createVerifier(config, keyResolver = createRemoteJWKSet(new URL(config.jwksUrl), {
  timeoutDuration: 5000, cooldownDuration: 30000, cacheMaxAge: 600000,
})) {
  return async token => {
    const { payload } = await jwtVerify(token, keyResolver, {
      issuer: config.issuer, audience: config.audience, algorithms: ['RS256', 'ES256'],
      requiredClaims: ['exp', 'iat', 'sub', 'client_id', 'music_grant_id'],
    });
    for (const field of ['sub', 'client_id', 'music_grant_id']) {
      if (typeof payload[field] !== 'string' || !payload[field].length || payload[field].length > 512) throw new Error('invalid_token');
    }
    if (typeof payload.scope !== 'string' || payload.iat > Date.now() / 1000) throw new Error('invalid_token');
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(payload.music_grant_id)) throw new Error('invalid_token');
    return Object.freeze({ issuer: payload.iss, subject: payload.sub, clientId: payload.client_id,
      grantId: payload.music_grant_id, expiresAt: payload.exp,
      scopes: Object.freeze(payload.scope.split(' ').filter(scope => SCOPES.includes(scope))) });
  };
}
