import { readConfig, createVerifier, authenticateBrowser } from './auth.mjs';
import { createGateway, metadataResponse } from './gateway.mjs';
import { configuredConnections } from './postgres-store.mjs';
import sessionModule from '../../server/music-agent-session.js';

const MAX_BODY = sessionModule.LIMITS.browserBytes;
const json = (status, code) => Response.json({ ok: false, code }, {
  status, headers: { 'Cache-Control': 'no-store' },
});

// Test injection only; deployed handlers below always use Clerk + dedicated PG.
export function createProductionHandlers({ config, verify, connections, deadlineMs = 15000 }) {
  const handleMcp = createGateway({ config, verify, store: connections?.store, deadlineMs });
  async function handleBrowser(request) {
    if (!config || !connections) return json(503, 'gateway_not_configured');
    let timer, reader;
    try {
      const url = new URL(request.url), origin = new URL(config.resource).origin;
      const site = request.headers.get('sec-fetch-site');
      const mode = request.headers.get('sec-fetch-mode');
      const dest = request.headers.get('sec-fetch-dest');
      if (url.origin !== origin || url.pathname !== '/api/music-agent' || url.search || url.username || url.password ||
          (site !== null && site !== 'same-origin') ||
          (mode !== null && !['cors', 'same-origin'].includes(mode)) ||
          (dest !== null && dest !== 'empty') ||
          (request.headers.has('origin') && request.headers.get('origin') !== origin))
        return json(400, 'invalid_request');
      if (!['GET', 'POST'].includes(request.method)) return json(405, 'method_not_allowed');
      // Browser mutations require exact Origin, including cookie-auth requests.
      // Forwarded headers confer no authority. Authorization is passed unchanged
      // to Clerk's acceptsToken:'session_token' verifier; OAuth cannot authorize it.
      if (request.method === 'POST' && request.headers.get('origin') !== origin)
        return json(403, 'access_denied');
      if (request.method === 'POST' &&
          request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json')
        return json(415, 'invalid_content_type');
      if (request.method === 'GET' && request.body) return json(400, 'invalid_request');
      const length = request.headers.get('content-length');
      if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length))))
        return json(400, 'invalid_request');
      if (Number(length) > MAX_BODY) return json(413, 'request_too_large');
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('deadline')), deadlineMs);
      });
      const bounded = promise => Promise.race([promise, deadline]);
      let body;
      if (request.method === 'POST') {
        if (!request.body) return json(400, 'invalid_input');
        reader = request.body.getReader();
        const chunks = []; let size = 0;
        for (;;) {
          const { done, value } = await bounded(reader.read());
          if (done) break;
          size += value.byteLength;
          if (size > MAX_BODY) return json(413, 'request_too_large');
          chunks.push(value);
        }
        body = Buffer.concat(chunks);
      }
      const headers = new Headers(request.headers);
      if (request.method === 'POST') headers.set('content-type', 'application/json');
      const boundedRequest = new Request(request.url, { method: request.method, headers, body });
      // Deadline bounds waiting, not SQL already issued. Reconcile uncertain
      // mutations; never retry a lost claim response as an automatic Apply.
      const response = await bounded(connections.handleBrowser(boundedRequest));
      response.headers.set('Cache-Control', 'no-store');
      return response;
    } catch { return json(503, 'request_unavailable'); }
    finally {
      clearTimeout(timer);
      if (reader) void reader.cancel().catch(() => {});
    }
  }
  return Object.freeze({ handleMcp, handleBrowser,
    handleMetadata: request => metadataResponse(request, config) });
}

const config = readConfig();
const connections = config ? configuredConnections(process.env, {
  authenticateBrowser: async request => {
    try { return await authenticateBrowser(request); }
    catch { return null; }
  },
}) : null;
const handlers = createProductionHandlers({ config,
  verify: config ? createVerifier(config) : null, connections });
export const { handleMcp, handleBrowser, handleMetadata } = handlers;
