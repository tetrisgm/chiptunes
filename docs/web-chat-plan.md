# Built-in web Chat release plan

Owner decision: Chat beside Code/Notes uses owner-funded OpenAI or Anthropic
inference through a same-origin server endpoint. No Clerk dependency for this
path. Preserve the optional external MCP implementation and the shared app
artifact; do not create a second composer or audio pipeline.

## Implemented; final release verification pending

- Server-only provider keys, provider selector, private owner unlock cookie.
- Strict same-origin routes, bounded input/output, no model tools or retries.
- Unique source-anchor proposals converted to deterministic edit offsets.
- Existing compiler, revision, selection/locks and explicit Apply/undo path.
- Durable paid-call reservation: 20/UTC day, 2/fixed UTC minute, one 45s lease,
  replay protection across restarts. Failed calls consume quota; uncertain
  cancellation keeps the lease. These are request limits, not a dollar cap.
- Tests for both provider contracts, admission/auth and frontend controls.

## Remaining release sequence and evidence

1. Finish full root tests and run `npm run test:music-chat-web`, then the Next
   production build. Record actual terminal results, including skipped ROM gates.
2. Dry-run Vercel upload and inspect the deny-by-default allowlist: routes and
   shared sources present; credentials/local caches/media absent. Commit/push
   only after tests pass, then deliberately deploy the gateway.
3. Verify deployed build ID and unauthenticated denial. Unlock privately; never
   put the unlock password or provider key in source, logs or conversation.
4. For each real provider, exercise a nonempty musical source through browser
   prompt, visible proposal, explicit Apply, acknowledged audible playback and
   undo restoring source/music. Confirm rejected/stale/locked edits cannot apply.
5. Verify deployed UI in real Safari on macOS. Headless engine/DOM checks alone
   do not prove native pointer/gesture or audible listening acceptance.
6. Make the web entry path clear from the main site, retaining same-origin
   authentication and one shared artifact. Do not silently expose owner-funded
   inference to anonymous visitors. Record the deployed URL and build in handoff.
7. Audit the original complete Create plan and remaining external-agent/desktop
   work before declaring the overall goal complete. Shipping built-in Chat alone
   does not prove all earlier pipeline requirements finished.
