# Unified Create: code, notes and an agent in one place

Owner direction: 2026-09-09. This is the active product plan, superseding the
separate editor tabs and user-facing hosted-chat/project-transfer workflow.

## Outcome

One composition workspace at chiptunes.app/create. The musical code and its
note chart are visible together. A collapsible right-hand conversation panel
lets the owner compose, ask questions and request changes to that same code.
The optional game/visualizer is a listening presentation, not another composer.

Code -> existing compiler -> compiled score -> note chart and existing player.
Manual edits and agent proposals enter through the same source/revision model.
No hidden agent composition, alternate runtime, duplicated project, or second
website that the user must visit. Keep finite songs/exports and optional loop
audition. Preserve the deterministic single composition pipeline and 14 games.

## Current facts and failure modes

- Baseline main is 67e1f94. Previous implementation and full regression are
  recorded in HANDOFF.md; the deployed Music build is fef7cf6ae28c.
- Ordinary /create and #s song links still reach the legacy editor with mood
  controls across the top. Only #music enters the newer workspace.
- music-workspace.js selectView hides Code or Notes; they are alternatives.
- The newer main-site workspace deliberately disables its message composer
  and requires a hosted-project transfer. Removing a banner alone cannot fix it.
- cloudflare/worker.js already owns chiptunes.app/api/* for presence; chat paths
  currently fall through to 404. Preserve its presence routes and Durable Object.
- Gateway Chat checks an exact configured origin, signed host-only cookie,
  request origin, quota and source constraints. A naive forwarding-header rewrite
  would undermine those guarantees; same-origin integration needs explicit tests.
- Existing source mappings, revisions, proposal validation, private history,
  cancellation and boundary-safe playback are reusable. Do not rebuild them.

## Layout and interaction contract

Desktop: compact shared transport above the composition area; note chart above
code, with an accessible adjustable divider; chat on the right with a persistent
show/hide button. Both chart and code are visible by default, not tabs. The chart
gets substantial space and shows track labels, pitches/rests, bar ruler, selection
and playhead. Code has usable line height and diagnostics rather than an event
dump pretending to be a readable pattern. Imported exact source is never silently
rewritten to create the appearance of simplicity.

Chat collapse restores the space to composition, preserves transcript, input,
request state and selection, and returns keyboard focus safely. Narrow screens
stack chart and code within the same composition surface; chat becomes a drawer.
No page-wide horizontal overflow; only the musical timeline scrolls horizontally.
Save/import/export and compatibility tools belong in a compact secondary menu.

Mood suggestions belong to the chat empty state. Clicking one fills an editable
request; sending is explicit. No separate top-of-page Write song form. The agent
can generate a complete arrangement or make a targeted source change; it never
changes playback directly. Partial/incomplete streamed code is not executable.

Composition is the default Create view. A Visualizer control can show the existing
game presentation using the same score and transport, then return without losing
source, selection, chat, undo or playback position. No extra composition on toggle.

## Sequenced build checklist

### 1. Canonical entry and preservation

- [ ] Route plain /create, Create actions and existing song links into one workspace.
- [ ] Import #s documents through the existing exact materialization path; retain
  timings, instruments, automation, samples, comments and title where represented.
- [ ] Reuse local recovery without overwriting a saved draft or importing twice.
- [ ] Keep explicit native-format compatibility tools accessible, not the default
  experience. Do not delete legacy formats or break exports merely to hide old UI.
- [ ] Replace public Live coding / Chat-Code-Notes forks with one Compose entry.

Gate: fresh entry, reload, song link, existing draft and invalid-draft recovery
all open the unified workspace. No unsolicited autoplay or extra composer call.

### 2. Shared chart/code composition surface

- [ ] Replace desktop Notes/Code tabs with simultaneous panes and an accessible
  divider; preserve independent scroll, editor typing undo and source selection.
- [ ] Render chart from compiler output with readable note names and per-track
  lanes; preserve exact timing and tempo-map positioning, including finite ends.
- [ ] Clicking a note reveals/selects its actual source without hiding the chart.
  Highlight corresponding occurrences when selecting mapped code; stale mappings
  never select the wrong text after edits.
- [ ] Use bounded, debounced compilation for draft preview. Mark preview versus
  queued/playing revision explicitly. Invalid draft retains the last valid chart
  and sound, with diagnostics; a superseded compilation cannot replace newer state.
- [ ] Run/Cmd-Enter and approved agent changes use existing validation and boundary
  activation. Playback highlights follow the acknowledged playing revision.
- [ ] Keep dense/large projects responsive (bounded rendering/virtualization as
  needed), and keep code, notes and controls reachable on small screens.

Gate: a known pattern's pitch/rhythm edit changes exactly the expected chart
events; Run changes audible score at the boundary. Invalid edits, undo, tempo
maps and late compilation preserve correct source/chart/audio relationships.

### 3. Collapsible standard agent chat

- [ ] Mount a single reusable conversation component in the shared web artifact.
  Evaluate Vercel AI Elements Conversation, Message and PromptInput first, using
  a small React boundary rather than rewriting the musical application in Next.
  Inspect license, dependencies and generated CSS before adopting pinned sources.
  Record the result; a compatibility obstacle must not create a second frontend.
- [ ] Provide transcript, bottom composer, suggestions, Send/Stop, Enter/newline,
  useful pending/error states, scroll-to-latest and collapse/restore behavior.
- [ ] Keep provider/access controls secondary; preserve server-only keys, private
  owner gate, quotas and local-only editing while Chat is unavailable.
- [ ] Preserve bounded contextual history and public-share exclusion. Render model
  content safely, with no remote HTML, automatic image requests or executable UI.
- [ ] Agent requests carry current source/revision, selected region and constraints.
  Explanations can be text-only; code changes appear as reviewed proposals. Apply
  is one source revision and undo restores code/chart together. Historical messages
  never revive actionable proposals. Cancel/close/import cannot accept late output.
- [ ] Complete-track requests produce valid finite musical source, not only tiny
  comment edits. Retain readable named patterns for new compositions. Use a bounded
  validated response; no automatic retries or model calls from mood selection.

Gate: complete-track creation and targeted edit fixtures change the visible source
and chart coherently; follow-ups, cancellation, stale Apply, collapse/reopen,
private reload and keyboard focus pass. Explicitly distinguish fixtures from
real provider acceptance. Do not represent buffered replies as token streaming.

### 4. Same-origin web Chat; backend stays behind the scenes

- [ ] Implement narrowly scoped handling for /api/music/chat and its access path
  on the existing product routing layer, forwarding to the existing gateway.
  Keep presence/WebSocket/external-count behavior untouched; no new account,
  tunnel, model backend, database or duplicated composition pipeline.
- [ ] Design a fixed upstream and exact path/method allowlist. Reject foreign
  origins, arbitrary destinations, redirect forwarding, spoofed forwarding
  headers and unexpected bodies. Bound bytes/deadlines and propagate cancellation.
- [ ] Adapt gateway validation deliberately for the canonical public origin and
  server-to-server request URL. Do not trust forwarded origin/host as authority,
  spoof a user's origin, relax auth or introduce wildcard CORS. Keep signed
  Secure/HttpOnly/host-only cookies on chiptunes.app and responses no-store.
- [ ] Preserve existing owner password, provider credentials and durable quotas;
  change product configuration only through existing authenticated deployment
  mechanisms. Any necessary new security credential requires owner approval.
- [ ] Enable the composer on chiptunes.app; remove the public handoff/popup path.
  Keep any old Vercel page only as compatibility during cutover, then redirect
  users safely to the canonical site. Do not lose origin-local saved drafts or
  silently transfer private history; provide explicit recovery/export if needed.

Gate: exact-origin browser integration performs unlock, Chat and logout through
chiptunes.app only; hostile origin, cookie/header spoof, direct upstream access,
quota, timeout and replay tests remain fail-closed. Presence tests remain green.
No navigation or manual project-copy step is needed to use Chat.

### 5. Optional visualizer and workflow cleanup

- [ ] Add a clearly secondary composition/visualizer toggle sharing one player.
- [ ] Remove redundant primary controls and instructions for obsolete two-editor
  workflows. Keep compatibility exports and native tooling in secondary controls.
- [ ] Verify toggling and returning while playing, paused and with an invalid
  draft; restore selection/scroll/chat and never recompose or restart audio.

Gate: one song, source, undo history and transport across both presentations.

### 6. Integration, acceptance and handoff

- [ ] Update existing tests rather than retaining assertions for obsolete tabs,
  top mood form and hosted transfer. Keep their preservation/security coverage.
- [ ] Add an end-to-end canonical workflow: enter /create -> request composition
  -> review/apply code -> see notes -> play -> manually edit code -> Run -> ask
  for a scoped variation -> Apply -> undo -> collapse chat -> visualizer ->
  composition -> save/reload, without leaving chiptunes.app.
- [ ] Test fresh and saved projects, large exact imports, private history, offline
  behavior, mobile/drawer, keyboard, genuine playback/boundary acknowledgement,
  finite exports and render-parity threshold >=0.995.
- [ ] Run full root regression plus gateway and routing tests before pushing.
  Commit small coherent pieces on shared main; preserve other sessions' work.
- [ ] Inspect actual rendered UI in local Safari; record exact build and which
  behaviors were physically exercised. Automated WebKit is not native proof.
- [ ] Keep HANDOFF and this checklist current with commit IDs, evidence and honest
  open gates. Never infer human musical listening acceptance from automated tests.

## Release boundary

The current request authorizes planning and executing implementation. The earlier
approval deployed the earlier release, not every future change. Prepare a single
coordinated web release of UI and same-origin API; request explicit authorization
before production deployment/configuration cutover. No desktop/broadcast restart.
After authorization, verify matching public build IDs, real Safari, main-origin
auth and a bounded real-provider composition/edit round trip. Record paid calls.
Do not call production adoption complete before these checks. If deployment or
listening approval is missing, name that gate rather than calling the whole
product complete or silently broadening authority.

## Execution order and parallel work

Entry/layout and backend-route work can proceed independently with disjoint file
ownership; one integrator owns music-workspace.js and build artifacts. Chat UI
dependency inspection and acceptance tests can run in parallel. Do not use
separate user-facing task threads or worktrees; reuse coordinated subagents.
Integrate route + UI before claiming same-origin success. Build shared dist only
from one coordinator to prevent concurrent test/build races.

## References inspected

- https://elements.ai-sdk.dev/components/conversation — conversation container,
  scroll behavior and React/AI SDK integration.
- https://elements.ai-sdk.dev/components/prompt-input — message composer controls.
- src/music-workspace.js, src/runtime.js, src/create.js, cloudflare/worker.js,
  gateway/lib/chat-production.mjs and gateway/lib/chat-access.mjs — current
  entry, rendering, request and security boundaries.
