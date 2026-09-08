# Bring your agent to Chiptunes

Updated 2026-09-08. Extension of `create-workspace-plan.md`, not a replacement
for the compiler, project revisions, audio engine or exports.

## Outcome and scope

Open Create on the web, connect an existing MCP-compatible agent, authorize
one song session, request an edit in that agent, see the proposal in the
browser, audition/apply/reject and undo. No Chiptunes desktop installation,
model key or source copying. The external agent owns conversation and inference;
embedded model-backed Chat is optional, not a prerequisite.

Desktop eventually exposes the same musical tools locally. Wallpaper changes,
broadcast-box deployment and automatic app reinstalls are outside this scope.

## Verified baseline and pending decisions

- Shared main was clean and pulled before implementation.
- Cloudflare Pages serves the site; `cloudflare/worker.js` owns `/api/*` and
  the Presence Durable Object. This is not a Vercel application.
- Source authority, epochs, revisions, proposals, local recovery, undo and
  acknowledged audio handover exist. The model-backed Chat handler is unmounted.
- No end-user identity provider was identified in the inspected frontend/Worker.
  Listener counting and reporter secrets are not user authentication.
- Owner clarified hosting is not a constraint. Decision: Vercel agent gateway
  using mcp-handler; existing static site/presence need not migrate. Browser
  gateway origin must be explicitly configured and authenticated, not wildcard
  CORS. Durable session state needs a transactional store, not function memory.
- Existing identity-provider account remains to be established.
  No accounts, OAuth clients, secrets, domains or persistent jobs are created
  implicitly. Use maintained authentication libraries, not handwritten OAuth.

## Architecture

```text
External agent -- scoped OAuth / MCP --> gateway --> song session
Browser Create -- authenticated live synchronization --> song session
Proposal --> browser compiler + locks + revision check --> explicit Apply
         --> shared audio handover --> engine acknowledgment
```

Browser remains song authority in this release. Server holds an explicitly
shared temporary snapshot, not a second editable song database. Offline sessions
cannot accept edits. Source comments are data, never trusted instructions.

Check authenticated principal, client, resource audience, scope, session grant
and revocation on every operation. Agent-supplied IDs are not authority. Browser
credentials and agent grants are separate: agents cannot publish snapshots,
acknowledge Apply or silently expand their own scope.

## A. Session and musical tool contracts

1. Build host-neutral session core: injected clock, online TTL, one snapshot,
   one pending proposal, bounded replay tombstones, terminal revocation.
2. Snapshot binds source, validated revision, draft epoch, selection, constraints,
   compiler/assets version and transport context. Unapplied drafts are not
   eligible for proposals. Revision IDs alone are not globally unique.
3. Change context generation on source/selection/lock changes. Undo must not
   resurrect old proposals. Playback-position updates do not invalidate edits.
4. Tools: read context, get language help, propose localized edits, read proposal
   status. No shell/filesystem/network/eval/deployment/automatic Apply tools.
5. Descriptions explain UTF-16 offsets, exact base context, shared musical clock,
   finite songs, explicit Apply and conflict recovery.

Gate: tests for bounds, deep copies, stale/replayed edits, offline/revoke,
tampered authority, malformed proposals and status truthfulness. This is library
evidence, not a working hosted MCP connection.

## B. Browser synchronization and Connect panel

1. Add accessible/mobile Connect panel with disconnected, connecting, connected,
   offline, expired, revoked and error states. Name the connected agent/session.
2. Explain shared data; obtain consent before uploading source. Opening Create
   or a public song link must never automatically publish private source/chat.
3. Bind authenticated session to this tab/project instance. Publish debounced
   source/context updates and lightweight presence. Stop on close/replacement.
   Resolve browser authentication topology before implementation: prefer serving
   Create from the gateway origin using the exact shared build.js artifact, so
   login cookies are first-party. If keeping the editor on the Pages origin,
   design and test explicit pairing/CSRF/CORS without relying on third-party
   cookies. The agent MCP endpoint is not the browser session endpoint.
4. Receive proposals through existing beginRequest/validateProposal/renderProposal.
   One active request including local Chat; report busy rather than overwrite it.
5. Keep locks in browser-owned policy state. Changing locks invalidates a ready
   proposal; validate again before Apply. Selection alone is not an enforced scope.
6. Use existing applied() path to synchronize editor, notes, recovery and audio.
   Delivered/ready/applied/queued/playing are distinct acknowledgments.
7. Disconnect leaves local editor/audio usable. Reconnect republishes fresh
   context, never replays Apply. Two tabs cannot silently take over a session.

Gate: browser integration covers delivery/diff/Apply/reject/undo, manual edit
and lock races, local Chat contention, project replacement, network loss,
reconnect, revoke, two tabs, mobile focus and keyboard controls.

## C. Identity and consent

1. Reuse approved existing login provider; supported OAuth discovery/PKCE and
   client registration via maintained SDK/provider integration.
2. Consent names client and one song/session, with read-context/propose-edit
   scopes. No whole-library grants initially; no model-provider token reuse.
3. Validate issuer/signature/audience/expiry/scopes and durable ownership/grants.
   Revocation is enforced across all instances and reconnects.
4. Browser mutations require same-origin/CSRF protection and secure HTTP-only
   cookies as appropriate. No credentials in URLs, setup commands, source,
   browser storage, prompts or logs. Reject arbitrary redirects and downgrade.
5. Treat token expiry/refresh/provider failure explicitly; fail closed.

Gate: real two-identity cross-user/song denial tests, expired/wrong-audience/
revoked token tests, guessed IDs, malicious Origins and measured revoke latency.
Injected always-true authentication fixtures do not satisfy this gate.

## D. Hosted MCP and durable coordination

1. Mount supported Streamable HTTP MCP transport, SDK negotiation/discovery,
   schemas and errors; do not implement a partial homemade JSON-RPC protocol.
2. Preserve presence routes. OAuth well-known paths must reach the gateway,
   not the Pages SPA fallback. Verify production response types, not only 200s.
3. Use one durable coordination instance per session, never global Presence.
   Serialize conflicts; persist security/replay state before acknowledging.
4. Bound source/request/proposal bytes, CPU, sessions/user, connections, rate,
   replay memory and retention. Browser delivery uses authenticated WebSockets
   or bounded polling supported by the runtime. Process memory is not durability.
5. Eviction/restart/reconnect cannot reauthorize revoked grants or admit replay.
   Keep only aggregate operational metrics; never log source/prompts/tokens.

Gate: actual MCP SDK client initializes/lists/reads/proposes through real runtime;
browser-confirmed status returns to client. Exercise restart, expiry and limits.

## E. Frictionless client onboarding

1. Show verified endpoint, documented client install shortcuts where available,
   and copyable credential-free configuration otherwise. No universal one-click
   claims; test each claimed supported client.
2. Authenticate through supported OAuth, never copied subscription tokens.
3. Offer read-only connection test and first prompt for the current selection.
4. Ship versioned agent instructions matching actual compiler capabilities;
   descriptive game style hints remain descriptive, not imitation claims.
5. Desktop local-MCP parity follows the web contract. No new daemon, tunnel,
   persistent job or owner-app restart as a side effect.

Gate: clean installations of two intended clients can authorize, read the open
song and propose a real targeted edit using only the displayed instructions.

## F. Acceptance and controlled release

1. Run all protocol/security/browser tests and full npm test; render parity
   remains >=0.995 and production still composes each seed once.
2. Real agents: simplify drums with melody locked, narrow selection, invalid
   proposal, manual race, cancel, undo, export, reconnect and revoke. Fixtures
   are not real-model acceptance. Listen to representative musical changes.
3. Verify exact visible deployed build in real macOS Safari, mobile/focus,
   storage recovery and radio handoff; engine state is not visible acceptance.
4. Deploy gateway disabled first, configure approved auth, verify discovery and
   grants, enable owner-only, then verify real clients before wider availability.
5. Kill switch disables agent access without disabling Code/Notes/radio. Rollback
   must preserve existing local projects and presence routes; revoke grants if
   auth is compromised. Document retention and operational limits.
6. Commit coherent pieces; project's tests must be green before push. Record
   deployed build, tested clients and exact remaining limitations in HANDOFF.
   Do not invoke npm run deploy wholesale: it also changes the broadcast box.

## Status / definition of done

Implemented development slices (not a production completion claim):

- A: bounded session core, persisted state import/export, four tool specifications,
  scoped transactional broker and replay/ownership tests.
- B: workspace bridge, opt-in Connect panel and same-origin transport implemented;
  browser fixtures cover explicit Apply acknowledgments, stale I/O and disconnect.
  Hosted round-trip acceptance remains pending.
- C: maintained Clerk SDK authenticates separate browser session and OAuth token
  types. Standard issuer/subject/client identity maps to durable grants; no custom
  song token claim. Real Clerk installation requires owner marketplace terms
  acceptance. Browser session refresh and hosted consent remain under integration.
- D: Vercel Next.js MCP transport builds and is exercised by the real SDK client;
  Dedicated free-tier Neon database provisioned and schemas migrated over verified
  TLS. Real isolated PostgreSQL tests cover pairing races, ownership and revoke.
- E/F: real client onboarding, browser delivery, listening, public deployment and
  real Safari acceptance remain pending.

Vercel project chiptunes-agent-gateway and Neon chiptunes-agent-sessions were
created with owner approval. No paid plan, legal terms acceptance or persistent
job was created. Clerk marketplace terms are the external setup gate.
Existing editor tests are prior evidence, not hosted-pipeline acceptance.

Done means a website user without the desktop app connects a supported existing
agent, authorizes one song, receives a real validated targeted proposal, applies
it intentionally, hears it, undoes it and revokes access. Production auth,
onboarding and browser delivery must all work. Scaffolding is not completion.

References checked 2026-09-08:
- https://vercel.com/i/mcp-server-oauth-authorization
- https://developers.cloudflare.com/agents/model-context-protocol/protocol/authorization/
- https://developers.cloudflare.com/agents/model-context-protocol/guides/remote-mcp-server/
- https://developers.cloudflare.com/agents/model-context-protocol/apis/handler-api/
