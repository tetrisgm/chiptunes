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

## Primary musical guide: TidalCycles

Owner direction, 2026-09-09: "Use this as our guide https://tidalcycles.org/".
TidalCycles is now the primary reference for musical concepts, pattern semantics,
live transformation and learning progression. The Strudel/video references below
remain the guide for browser presentation, inline feedback and controls. The
product remains Chiptunes with its current compiler, chip engine and agent sidebar.
This direction does not select a Haskell/SuperCollider installation or claim
Tidal source compatibility.

Official references reviewed:

- [Overview](https://tidalcycles.org/docs/) — composing by combining and transforming patterns.
- [Cycles](https://tidalcycles.org/docs/reference/cycles/) — a shared cycle with independent subdivisions.
- [Mini notation](https://tidalcycles.org/docs/reference/mini_notation/) — grouping, rests, repetition and alternation.
- [Pattern model](https://tidalcycles.org/docs/innards/what_is_a_pattern/) — querying events within a musical time interval.
- [Workshop](https://tidalcycles.org/docs/patternlib/tutorials/workshop/) — small experiments progressing into transformations and variation.

Implementation interpretation, not a claim these features are already present:

- Prioritize compact composable patterns over larger event lists. First define a
  bounded subset: nested subdivision, repetition, multi-cycle alternation, time
  scaling, reversal, periodic transformation and Euclidean rhythm. Document each
  supported operation with a small executable example and exact timing fixture.
- Keep one phase-preserving musical clock for all tracks. Resolve fractional
  pattern positions through the existing tempo map/frame conversion. Compare
  simple three-/four-way subdivisions and nested timing to the documented model;
  do not introduce per-track timers or accumulate rounding drift across repeats.
- Preserve existing source semantics. Tidal uses `~` for rests, `.` for grouping,
  `@` for duration weighting and `:` for sample selection; our existing notes
  use dot rests, `:length` and `@velocity`. Introduce any cycle notation through
  an explicit/versioned syntax boundary, not automatic reinterpretation of old
  notes strings. No promise of full Tidal syntax or unrestricted function support.
- Treat variation and parameters as musical patterns where chip capabilities
  permit. Add seeded chance only with explicit source-carried identity and
  cycle/event indexing; preview, live playback and finite exports must agree.
  Simultaneous pattern layers still obey the chip's voice limits and existing
  overlap diagnostics, not an implicit unlimited synthesizer.
- Reuse one compilation path: musical patterns lower into the existing Score
  and source maps. Inline rolls and token highlighting show those results;
  code-linked controls and agent proposals edit that same source. Live audition
  can loop, while the arrangement and downloads retain a defined finite end.
- Teach the performance workflow incrementally: one rhythm, one bass pattern,
  a melody, then a periodic variation and a breakdown. The agent uses the same
  documented subset as the person, with explicit Apply and no automatic paid
  retries. Unsupported Tidal features must be explained, never fabricated.

Acceptance adds exact pattern-semantics fixtures and a repeatable live build-up
exercise to the reference pass below. An attractive editor alone does not close
this gate. Determine the explicit syntax boundary before adding these operators;
readable pitch/inline feedback remains the first implementation slice.

## Owner's live-coding references — 2026-09-09 clarification

After the implementation checkpoint ef9f674, the owner supplied four videos
with the direction "This but for our app":

- DJ_Dave, [Making dance music with code](https://www.youtube.com/shorts/5OYiOGxHxTQ).
- Switch Angel, [Coding DRUM and BASS](https://www.youtube.com/shorts/AJ7atBkisOU).
- ion.the.way, [Live coding Phone Down](https://www.youtube.com/shorts/3XhS6_BZ53U).
- Switch Angel, [Coding Trance Music from Scratch (Again)](https://www.youtube.com/watch?v=iu5rnQkfO6M).

Reviewed the visible code/video frames of all four and the long video's exported
auto-captions; not a claim of complete audiovisual listening acceptance. The
references show compact pattern code, embedded piano rolls/scopes, highlighted
musical tokens and direct controls. The long video's captions describe building
lead, drums and bass, manipulating sound, and developing a breakdown/progression.
[Strudel visual-feedback docs](https://strudel.cc/learn/visual-feedback/) and
[slider documentation](https://strudel.cc/blog/) confirm that these are code-linked
inline visuals/widgets, not a separate piano-roll application.

That checkpoint implemented the shared project and transport foundation, not the
complete performance experience. Its chart compressed pitches into fixed-height
lanes and had no inline pattern rolls or code-linked widgets. The pitch/inline
feedback slice below is now implemented locally; controls, pattern semantics and
the full performance demonstration remain outstanding implementation gates.

### Reference-matching implementation pass

1. [x] Make pitch and rhythm legible: proper semitone rows and time grid, useful
   pitch range per melodic track, percussion-specific rows, clear rests and
   sounding notes. Keep a whole-song overview without making a long song unreadable.
2. [x] Add bounded inline pattern/track piano rolls beside their code declarations
   using the existing compiler mappings. Shared patterns must show which track,
   transform and occurrence is represented. Derive display from the same compiled
   source, never recompile through a parallel musical engine. Exact imports remain
   exact and use their overview/source mappings without forced conversion.
3. [x] Highlight the actual playing token/occurrence where mappings support it,
   not only the entire declaration. Retain the existing distinction between draft
   preview and acknowledged playing source; incomplete code never becomes audio.
   Verified with exact escaped-token/repeat/transform mappings, an isolated
   CodeMirror suite, nine integrated pitch/tempo/overview/source-guard cases,
   and native Safari note selection, preview and Undo. Inline rolls are one per
   pattern with an explicit compiled track/call/occurrence selector, not duplicate
   rolls for every invocation. At most 11 declarations, 24 representative
   occurrences per declaration and 128 notes per roll; omissions are disclosed.
   Playback markers follow the shared sequencer's scheduled off/trigger order,
   not note-interval overlap or a velocity-zero assumption. They are not meters;
   channels with raw register/sample ownership omit markers with a disclosure.
   Full chart remains bounded/zoomable. Native playing and the complete live
   performance demo are not implied by these narrower checks.
4. [ ] Provide inline controls for existing supported parameters (initially gate,
   velocity and transposition). Each gesture changes a bounded source literal,
   preserves unrelated text and groups undo; Run/Apply keeps the current musical
   boundary contract. A control is not hidden mixer state or permission for an
   agent response to apply itself. Unsupported/ambiguous expressions stay code-only.
5. [ ] Make the live build-up workflow easy through short readable pattern edits
   and the existing sidebar: start a groove, add/alter an accompaniment, vary the
   melody, create a breakdown and restore the full arrangement while looping.
   Add only the minimal deterministic language support a verified fixture needs;
   preserve finite arrangements/exports and the one chip engine. Do not silently
   import Strudel's unrestricted runtime, external samples or incompatible FX.
   Follow the TidalCycles guide above: specify the supported pattern subset and
   its compatibility boundary, then implement operators with exact timing/source-
   mapping tests before advertising them in completion or agent instructions.
6. [ ] Acceptance demo: play once, then manually and via reviewed agent proposals
   build and vary a chip track with visible code/notes correspondence, no lost
   playback phase, no navigation and no hidden musical edits. Include invalid
   source, shared-pattern ambiguity, undo, reload and exact export checks; verify
   local Safari before the separately authorized production/provider acceptance.

This is an extension of the existing Create plan, not another workspace or an
authorization to deploy the previous checkpoint. Start with readable pitch/inline
feedback, then source widgets, then the complete performance demonstration.

## Baseline facts and failure modes (before implementation)

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

- [x] Route plain /create, Create actions and existing song links into one workspace.
- [x] Import #s documents through the existing exact materialization path; retain
  timings, instruments, automation, samples, comments and title where represented.
- [x] Reuse local recovery without overwriting a saved draft or importing twice.
- [x] Keep explicit native-format compatibility tools accessible, not the default
  experience. Do not delete legacy formats or break exports merely to hide old UI.
- [x] Replace public Live coding / Chat-Code-Notes forks with one Compose entry.

Gate: fresh entry, reload, song link, existing draft and invalid-draft recovery
all open the unified workspace. No unsolicited autoplay or extra composer call.

### 2. Shared chart/code composition surface

- [x] Replace desktop Notes/Code tabs with simultaneous panes and an accessible
  divider; preserve independent scroll, editor typing undo and source selection.
- [x] Render chart from compiler output with readable note names and per-track
  lanes; preserve exact timing and tempo-map positioning, including finite ends.
- [x] Clicking a note reveals/selects its actual source without hiding the chart.
  Highlight corresponding occurrences when selecting mapped code; stale mappings
  never select the wrong text after edits.
- [x] Use bounded, debounced compilation for draft preview. Mark preview versus
  queued/playing revision explicitly. Invalid draft retains the last valid chart
  and sound, with diagnostics; a superseded compilation cannot replace newer state.
- [x] Run/Cmd-Enter and approved agent changes use existing validation and boundary
  activation. Playback highlights follow the acknowledged playing revision.
- [x] Keep dense/large projects responsive (bounded rendering/virtualization as
  needed), and keep code, notes and controls reachable on small screens.

Gate: a known pattern's pitch/rhythm edit changes exactly the expected chart
events; Run changes audible score at the boundary. Invalid edits, undo, tempo
maps and late compilation preserve correct source/chart/audio relationships.

### 3. Collapsible standard agent chat

- [x] Mount a single reusable conversation component in the shared web artifact.
  Evaluate Vercel AI Elements Conversation, Message and PromptInput first, using
  a small React boundary rather than rewriting the musical application in Next.
  Inspect license, dependencies and generated CSS before adopting pinned sources.
  Record the result; a compatibility obstacle must not create a second frontend.
- [x] Provide transcript, bottom composer, suggestions, Send/Stop, Enter/newline,
  useful pending/error states, scroll-to-latest and collapse/restore behavior.
- [x] Keep provider/access controls secondary; preserve server-only keys, private
  owner gate, quotas and local-only editing while Chat is unavailable.
- [x] Preserve bounded contextual history and public-share exclusion. Render model
  content safely, with no remote HTML, automatic image requests or executable UI.
- [x] Agent requests carry current source/revision, selected region and constraints.
  Explanations can be text-only; code changes appear as reviewed proposals. Apply
  is one source revision and undo restores code/chart together. Historical messages
  never revive actionable proposals. Cancel/close/import cannot accept late output.
- [x] Complete-track requests produce valid finite musical source, not only tiny
  comment edits. Retain readable named patterns for new compositions. Use a bounded
  validated response; no automatic retries or model calls from mood selection.
  Implemented and exercised with a real-handler/mock-provider full-track fixture;
  production provider quality and musical listening are still open release gates.

Gate: complete-track creation and targeted edit fixtures change the visible source
and chart coherently; follow-ups, cancellation, stale Apply, collapse/reopen,
private reload and keyboard focus pass. Explicitly distinguish fixtures from
real provider acceptance. Do not represent buffered replies as token streaming.

### 4. Same-origin web Chat; backend stays behind the scenes

- [x] Implement narrowly scoped handling for /api/music/chat and its access path
  on the existing product routing layer, forwarding to the existing gateway.
  Keep presence/WebSocket/external-count behavior untouched; no new account,
  tunnel, model backend, database or duplicated composition pipeline.
- [x] Design a fixed upstream and exact path/method allowlist. Reject foreign
  origins, arbitrary destinations, redirect forwarding, spoofed forwarding
  headers and unexpected bodies. Bound bytes/deadlines and propagate cancellation.
- [x] Adapt gateway validation deliberately for the canonical public origin and
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

- [x] Add a clearly secondary composition/visualizer toggle sharing one player.
- [x] Remove redundant primary controls and instructions for obsolete two-editor
  workflows. Keep compatibility exports and native tooling in secondary controls.
- [x] Verify toggling and returning while playing, paused and with an invalid
  draft; restore selection/scroll/chat and never recompose or restart audio.

Gate: one song, source, undo history and transport across both presentations.

### 6. Integration, acceptance and handoff

- [x] Update existing tests rather than retaining assertions for obsolete tabs,
  top mood form and hosted transfer. Keep their preservation/security coverage.
- [x] Add an end-to-end canonical workflow: enter /create -> request composition
  -> review/apply code -> see notes -> play -> manually edit code -> Run -> ask
  for a scoped variation -> Apply -> undo -> collapse chat -> visualizer ->
  composition -> save/reload, without leaving chiptunes.app.
- [x] Test fresh and saved projects, large exact imports, private history, offline
  behavior, mobile/drawer, keyboard, genuine playback/boundary acknowledgement,
  finite exports and render-parity threshold >=0.995.
- [x] Run full root regression plus gateway and routing tests before pushing.
  Commit small coherent pieces on shared main; preserve other sessions' work.
  Root's pre-workspace stages passed; corrected outdated fixtures, then reran
  the entire workspace tail and unified posttest to exit zero. Gateway: 77/77;
  Next build passes. Private-ROM-only checks explicitly skip; see HANDOFF.
- [x] Inspect actual rendered UI in local Safari; record exact build and which
  behaviors were physically exercised. Automated WebKit is not native proof.
- [x] Keep HANDOFF and this checklist current with commit IDs, evidence and honest
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

Prepared cutover, not yet authorized or executed:

1. Deploy the existing gateway with canonical `CHAT_ORIGIN=https://chiptunes.app`
   and the tested public/transport-origin normalization. Preserve owner secret,
   provider keys, durable quota database and all unrelated MCP configuration.
2. Deploy the existing presence Worker with the two bounded chat routes and the
   shared web artifact. Verify presence and its WebSocket path still work.
3. Retain the old Vercel page's explicit download/recovery notice; do not blindly
   redirect away from origin-local drafts or move private history automatically.
4. Verify main-origin unlock, denied anonymous/foreign requests, cookie scope,
   logout and quota behavior. Then make only the explicitly authorized bounded
   provider composition/edit calls, applying proposals in the browser.
5. Verify the exact public Music build in real Safari, including composition,
   chat collapse, playing/paused visualizer return and local recovery. Record
   deployment IDs, calls and evidence. If rollback is needed, restore the prior
   coordinated artifact/routing/origin configuration, never browser project data.

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
