# Chiptunes MCP gateway

Separate Next.js app. From this directory run `npm ci`, `npm test`,
`npm run build`, then `npm start`. Node >=20.9 required. No root package changes,
deployment, migration, account setup or recurring jobs are performed by these commands.
This app imports the shared `../server` registry/broker/repository and their core
dependencies; a standalone copy of gateway without the parent repo is insufficient.
Next traces from the repository root for that reason.

## Configuration and remaining integrations

Required server environment (never supplied by clients):

- `MCP_OAUTH_ISSUER`: exact HTTPS issuer.
- `MCP_OAUTH_AUDIENCE`: expected JWT audience.
- `MCP_OAUTH_JWKS_URL`: trusted HTTPS JWKS endpoint; RS256/ES256 only.
- `MCP_RESOURCE_URL`: canonical HTTPS URL ending exactly in `/api/mcp`.
- `DATABASE_URL`: a dedicated Postgres database connection; certificate validation
  is mandatory. SSL query parameters are rejected to prevent overriding TLS.
- `MCP_DATABASE_DEDICATED=true`: explicit confirmation this database is dedicated.

Missing identity or dedicated database configuration makes `/api/mcp` return 503.
No process-local music session store exists. Pool construction is lazy about actual
network access; database failure/missing migration returns a sanitized 503 at the
request grant check. Metadata requires identity config but does not claim an active
session or database connection. The schema in `../server/music-agent-schema.sql`
must be applied separately by an authorized operator, never automatically at startup.

Vercel + Clerk + a dedicated Postgres database is the intended integration, not a
completed connection. Clerk OAuth setup, audience/issuer/JWKS values, and token claim
mapping remain unconfigured. JWTs currently require `sub`, `client_id`, `exp`, `iat`,
`scope`, and **custom `music_grant_id`**. That custom claim is NOT a standard Clerk
OAuth claim. A reviewed issuer mapping or durable grant lookup by issuer/subject/
client must be implemented before claiming Clerk compatibility. There is no custom
OAuth issuer, token exchange, login or consent endpoint in this app.

`music_grant_id` selects the durable session row, never supplies authority. The
trusted browser consent integration must create records containing issuer, owner,
clientId, browserId, expiresAt (milliseconds), revoked, **scopes array**, and serialized
core state. Records without stored scopes fail closed. Owner/client/issuer, token and
record expiry, revocation and stored scope are checked in the same locked transaction
as each core operation. Missing browser publication/heartbeat/consent means no usable
song session. Browser publication, claim/application and acknowledgments are not
implemented here. No tool can apply or play a proposal.

## HTTP and authorization

`/api/mcp` mounts real mcp-handler 2.1.1 with SDK server 2.0.0. Discovery is at
`/.well-known/oauth-protected-resource/api/mcp`, also exposed at the root metadata
path. It uses the configured public URL, never forwarded headers. The actual request
origin must match that public origin; MCP path must be `/api/mcp`. Reverse proxy
configuration must preserve this canonical URL. No wildcard CORS or cookies are
supported; tokens belong only in Authorization headers. All query strings are
rejected. Infrastructure access logs must also redact headers and query strings;
this app cannot prevent an upstream proxy logging a rejected URL.

Scopes are `music:read` and `music:propose`; read is required for initialization and
every request, propose additionally for proposing. Four tools come directly from
`server/music-agent-tools.js`. Proposal id/generation/draftEpoch/baseRevision are
passed unchanged; never refreshed from current context. The broker enforces atomic
CAS and replay checks. See `lib/store.mjs` for the injectable store interface and
`lib/postgres-store.mjs` for the concrete broker mapping.

Requests have a 600,000-byte body limit and a 15-second total deadline, including
JWT verification, grant checks, reads and handler work. The deadline bounds response
waiting; it cannot roll back an already issued database operation. SQL uses bounded
connection/query/lock timeouts. An interrupted proposal may have committed: check
status using its original id; never retry by minting a different id automatically.
JWKS cache contains public keys only; transport is stateless, subscriptions disabled.
The adapter registers no logging callback and emits no prompts, source or tokens.

## Verification evidence and limits

`npm test` runs the official SDK client through Fetch Request/Response boundaries
against the actual mcp-handler and registry. Callback stores in transport tests are
explicit test fixtures; they do not prove database persistence or core compilation.
JWT tests use real jose signatures and a test-only local JWKS, checking invalid
signatures, issuer/audience/expiry/nbf/identity. Transport tests also use real signed
JWTs, not an auth success stub. Stalling functions exist only in deadline tests.
Tests cover discovery, list/call, proposal CAS forwarding, scope/owner/grant denial,
revocation, request limits and deadlines. Build verifies the Next routes compile.
No real identity provider, remote JWKS, Postgres server, Vercel deployment or browser
song round trip has been exercised.

API/version evidence inspected before implementation: npm package metadata and
installed declarations, [mcp-handler README](https://github.com/vercel/mcp-handler),
[authorization docs](https://github.com/vercel/mcp-handler/blob/main/docs/AUTHORIZATION.md),
and [Vercel MCP documentation](https://vercel.com/docs/mcp/deploy-mcp-servers-to-vercel).
The v2 handler requires the split `@modelcontextprotocol/server` SDK; the legacy
`@modelcontextprotocol/sdk` v1 package is not used. Lockfile is local to this app.
