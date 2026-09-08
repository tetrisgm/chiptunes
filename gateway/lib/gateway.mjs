import { createMcpHandler, generateProtectedResourceMetadata } from 'mcp-handler';
import { fromJsonSchema } from '@modelcontextprotocol/server';
import registry from '../../server/music-agent-tools.js';
import { SCOPES } from './auth.mjs';
import { isStore } from './store.mjs';

export const METADATA_PATH = '/.well-known/oauth-protected-resource/api/mcp';
const MAX_BODY = 600000;
const toolScopes = Object.freeze({ music_get_context: 'music:read', music_get_help: 'music:read',
  music_get_proposal_status: 'music:read', music_propose_edit: 'music:propose' });
const failure = code => ({ isError: true, content: [{ type: 'text', text: JSON.stringify({ error: code }) }] });
function json(status, error, headers = {}) {
  return Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}
function denied(config, status) {
  const metadata = new URL(METADATA_PATH, config.resource).href;
  return json(status, status === 401 ? 'invalid_token' : 'insufficient_scope', {
    'WWW-Authenticate': `Bearer resource_metadata="${metadata}", scope="${SCOPES.join(' ')}", error="${status === 401 ? 'invalid_token' : 'insufficient_scope'}"`,
  });
}
function safeRequest(request, config) {
  const url = new URL(request.url);
  return url.origin === new URL(config.resource).origin && !url.search && !url.username && !url.password && !request.headers.has('cookie') &&
    (!request.headers.has('origin') || request.headers.get('origin') === new URL(config.resource).origin);
}
export function metadataResponse(request, config) {
  if (!config) return json(503, 'identity_not_configured');
  if (!safeRequest(request, config)) return json(400, 'invalid_request');
  return Response.json(generateProtectedResourceMetadata({ authServerUrls: [config.issuer], resourceUrl: config.resource,
    additionalMetadata: { scopes_supported: SCOPES, bearer_methods_supported: ['header'] } }),
  { headers: { 'Cache-Control': 'no-store' } });
}

// Dependency injection exists for host integration/tests, never via HTTP/env.
export function createGateway({ config, verify, store, deadlineMs = 15000 }) {
  return async request => {
    let timer;
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('deadline')), deadlineMs); });
    const bounded = promise => Promise.race([promise, deadline]);
    try { return await bounded(handle(request, bounded)); }
    catch { return json(503, 'request_unavailable'); }
    finally { clearTimeout(timer); }
  };
  async function handle(request, bounded) {
    if (!config || !verify || !isStore(store)) return json(503, 'gateway_not_configured');
    if (!safeRequest(request, config) || new URL(request.url).pathname !== '/api/mcp') return json(400, 'invalid_request');
    if (!['GET', 'POST', 'DELETE'].includes(request.method)) return json(405, 'method_not_allowed');
    const bearer = /^Bearer ([A-Za-z0-9._~-]+)$/i.exec(request.headers.get('authorization') || '');
    if (!bearer || bearer[1].length > 16384) return denied(config, 401);
    let principal;
    try { principal = await bounded(verify(bearer[1])); } catch { return denied(config, 401); }
    if (!principal || principal.expiresAt <= Date.now() / 1000) return denied(config, 401);
    if (!principal.scopes.includes('music:read')) return denied(config, 403);
    try {
      if (await bounded(store.authorize(principal, 'music:read')) !== true) return denied(config, 403);
    } catch { return json(503, 'store_unavailable'); }
    try {
      // Bound chunked bodies before mcp-handler clones/parses JSON.
      let body;
      if (request.body) {
        const reader = request.body.getReader();
        let size = 0; const chunks = [];
        for (;;) {
          let chunk;
          try { chunk = await bounded(reader.read()); }
          catch { void reader.cancel().catch(() => {}); throw new Error('deadline'); }
          const { done, value } = chunk; if (done) break;
          size += value.byteLength;
          if (size > MAX_BODY) { void reader.cancel().catch(() => {}); return json(413, 'request_too_large'); }
          chunks.push(value);
        }
        body = Buffer.concat(chunks);
      }
      const transportRequest = new Request(request.url, { method: request.method, headers: request.headers, body });
      const run = (operation, scope) => async (input = {}) => {
        if (principal.expiresAt <= Date.now() / 1000 || !principal.scopes.includes(scope)) throw new Error('forbidden');
        return bounded(store.execute({ principal, scope, operation, input }));
      };
      const specs = registry.createMusicAgentTools({ getContext: run('getContext', 'music:read'),
        propose: run('propose', 'music:propose'), getProposalStatus: run('getProposalStatus', 'music:read') });
      const handler = createMcpHandler(server => {
        for (const spec of specs) {
          const scope = toolScopes[spec.name];
          if (!scope) throw new Error('unknown_tool');
          server.registerTool(spec.name, { description: spec.description, annotations: spec.annotations,
            inputSchema: fromJsonSchema(spec.inputSchema) }, async input => {
            try {
              if (principal.expiresAt <= Date.now() / 1000 || !principal.scopes.includes(scope) ||
                await bounded(store.authorize(principal, scope)) !== true) return failure('forbidden');
              return await spec.handler(input);
            } catch { return failure('music_tool_failed'); }
          });
        }
      }, { serverInfo: { name: 'chiptunes-music', version: '0.1.0' }, verboseLogs: false, maxSubscriptions: 0 });
      const response = await bounded(handler(transportRequest));
      response.headers.set('Cache-Control', 'no-store');
      return response;
    } catch { return json(500, 'gateway_error'); }
  }
}
