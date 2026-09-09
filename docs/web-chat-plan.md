# Built-in web Chat release plan

Release update: owner authorized deployment of b7a6d0d. Both public origins now
serve Music fef7cf6ae28c, with compact conversational Chat verified in native
Safari on the hosted origin. Settings dismissal preserves the message/workspace;
anonymous model calls remain denied. New live-provider conversation and human
listening acceptance have not been claimed. This supersedes the pending-release
status in the implementation checkpoint below.

Current correction: replace setup-form-first Chat with a normal conversation,
message composer, follow-up context and inline edit approvals. Settings are a
separate dialog. Text-only replies do not modify music. This change and the
preceding live-coding correction are local/pushed work pending an authorized
web release; historical release checks below do not prove the new UX shipped.

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

Final follow-up: implementation 2aaada4 / release 3ab136f passed full root
regression and is deployed on both origins, app.f715dcc08d84.js / Music
eb6281febd20. Real Safari confirmed the main-site handoff-only controls,
consent-gated transfer, stale-draft source-navigation guard, native responsive
breakpoint focus restoration, preserved draft, and explicit validated Play/Stop.
All independently executable core gates in the acceptance record are now
verified; representative listening remains unverified and requires a result.

September 9 release update: full root tests exited 0, candidate pushed as
0f9d576 and deployed to both first-party origins with the same
`app.5d7aa87e1f8a.js` / visible Music build `93fb190587e0`. Gateway access
reports both providers while locked, and anonymous Chat is denied with 401.
Native Safari private-window verification passed main-site popup handoff,
244363-byte explicit consent, accepted validated song without autoplay,
explicit confirmed local save and reload, bass-note-to-Code navigation,
acknowledged playback and Stop. Screenshot confirms Chat before collapsed MCP.
This completes the handoff and native layout checks, not listening acceptance
or every original-plan requirement. Full-plan source/test audit is in progress.

Checkpoint: steps 1–3 completed at 5439dc8; deployed Chromium verifies step 4's
real-provider proposal/Apply/playback acknowledgment/undo path. Listening remains
unverified. Native Safari on macOS showed build 7fe57941c401, generated concrete
source, switched Notes/Code, acknowledged playing r2 with an advancing playhead,
and stopped cleanly. This is partial native evidence, not proof of every gesture,
model interaction or listening acceptance. Its screenshot also exposed optional
MCP setup burying built-in Chat below the fold; fix and reverify that layout.

The main-site entry must preserve the current project, including an unfinished
draft, without auto-submitting it to a model or overwriting an existing hosted
draft. Existing self-contained share links reject projects over 12 KB; typical
generated explicit-event sources exceed that. A bare link to a blank hosted
editor does not meet this handoff requirement. Keep the source tab intact and
require explicit transfer to the exact first-party hosted origin.

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
