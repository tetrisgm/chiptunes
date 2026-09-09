# Create workspace acceptance record

Scope: `create-workspace-plan.md`, with the owner's September 9 decision that
built-in owner-funded OpenAI/Claude Chat is primary and external MCP is optional.
This is an evidence record, not a replacement or reduction of that plan.

## Current release and open gates

Final follow-up is deployed: implementation 2aaada4 / release 3ab136f, both
origins on app.f715dcc08d84.js / Music eb6281febd20. Full root regression
finished with exit 0; the dedicated UI, workspace, Chat/provider/gateway and
production-build gates also passed. Native Safari verified the final main-site
controls and popup handoff, the stale-offset explanation without incorrect
source selection, Code/mobile Chat/wide Code focus restoration and arrow-key
navigation across a page-zoom breakpoint, retained draft, and validated Play/Stop.
Thus the follow-up regression/deployment/native checks below are complete.
Listening remains the sole unverified core acceptance gate. This does not
claim physical phone/trackpad testing or native reference-ROM playback.

Release 0f9d576 is deployed to chiptunes.app and the Vercel Chat workspace,
shared artifact `app.5d7aa87e1f8a.js`, visible Music build `93fb190587e0`.
Full root tests exited 0 before release. Native Safari transfer/save/reload and
transport checks passed on that exact build; details are in `HANDOFF.md`.

Follow-up correctness changes passed full root regression (exit 0, session
27680), the 65-test gateway suite and Next production build, but are not yet deployed:
stale Notes-to-draft offsets, mobile Chat-to-desktop tab focus/ARIA associations,
main-site Chat handoff clarity, and oversized Chat source preflight. A new real
processor test covers actual tempo-map replacement rather than merely changing
a note duration. Final native verification must use the follow-up build.

Listening acceptance remains unverified. Render correlation, PCM equality,
engine acknowledgments and screenshots do not substitute for listening.

## Requirement-to-evidence map

| Plan requirement | Implementation and assertion evidence | Status |
| --- | --- | --- |
| Architecture: one composer/player/artifact, no arbitrary runtime | `music-language.js` restricted parser; `music-workspace.js` materializes one composer call; `build.js` and `gateway/prepare-studio.mjs` share the artifact. Workspace test counts generation calls. | Implemented/tested |
| Phase 0 / fidelity inspection | `verify-create-fidelity.js` reproduces 18 legacy preservation/loss groups. `music-language.md` defines the concrete preservation contract instead of assuming legacy readable JSON is lossless. | Verified characterization |
| §1 Code editor: highlighting, completion, folding, help, diagnostics, typing undo | Bundled MIT CodeMirror in `music-code-editor`; editor paste tests preserve 1 MiB text and edit/undo; workspace tests exercise diagnostics and completion dismissal. | Implemented/tested |
| §1 Notes/Code/Chat, transport, status, proposals | `music-workspace.js/css`; workspace and provider UI tests inspect tabs, revision states, explicit Apply/Reject, scope controls and offline behavior. Native Safari checks rendered Notes/Code, Chat-first layout and Play/Stop. | Follow-up UI regression/deployment pending |
| §1 mobile/accessibility/keyboard | Workspace tests cover phone views and text-input shortcut isolation. `verify-music-workspace-ui.js` checks labelled panels, mobile Chat to desktop normalization, keyboard focus, source and typing-undo retention across resize. | New edge-case fix under regression |
| §2 declarative syntax, finite arrangement, exact events/assets, semantics and bounds | `music-language.md`; language tests cover shorthand order, notes/rests, tempo maps, malicious syntax, expansion limits, exact banks and event arrays. 400 generated seed/mood cases compare whole scores; Node/browser and no-op APU PCM comparisons assert determinism. | Implemented/tested |
| §3 source/draft/validated/queued/playing model, recovery and transactions | `music-project.js`; project tests retain invalid drafts and last valid state, reject stale activation, round-trip versions/assets/comments, and undo coherent applied changes. Workspace tests exercise actual persisted drafts and audio revision acknowledgments. | Implemented/tested |
| §4 selectable read-only Notes/source mapping; retain legacy/native editors | Language mapping tests identify patterns/occurrences. Workspace tests navigate notes to source; new UI test inserts a leading comment and requires stale navigation to be refused while retaining selection. Legacy/native routes remain separate. | New stale-offset fix under regression |
| §5 genuine authorized models, no exposed keys | Production server-only OpenAI/Anthropic adapters and private owner cookie. Both providers passed real deployed nonempty-source proposal/Apply/playback acknowledgment/undo tests. Gateway tests validate request contracts; anonymous production Chat returns 401. | Implemented/live verified; listening separate |
| §5 structured localized proposals, verified diff/locks, races and cancellation | `music-project.js`, `music-chat.js`, server handler; tests reject altered pitch/rhythm/instrument/arrangement, global lock bypasses, malformed responses, stale/duplicate/cancelled proposals and manual-edit races. Applied summaries derive from compiled musical differences. | Implemented/tested |
| §5 bounded time/cost, offline independence | No automatic provider retries/tools. Durable 20/day, 2/fixed-minute quota and single lease tested on real isolated PostgreSQL. 29 Chat tests include oversized valid source rejected before fetch/reservation/provider. Existing Code/playback survives denied or unavailable Chat. | Preflight follow-up under regression |
| §6 live prepare/queue/cancel/activate, old audio retained, engine ack | Real processor/APU tests compare samples across unchanged sustained voices and boundary events, selective voice resets, wave/gain changes, samples, stale/superseded activations, undo/redo, seek/pause/suspension, loops, shortened end, radio ownership and failure. | Implemented/tested |
| §6 tempo maps and missed deadline | New real-processor tests compile two different maps, compare every sample to independently rendered replacement PCM, require old audio before activation, retain frame/subframe clock and acknowledge the next old-map boundary once after late delivery. | 31 live checks pass; included in current regression |
| §7 atomic persistence, quota failure, tabs, download/share/import | Project/workspace tests preserve unfinished source and last-valid revision, storage failure and conflicting-tab state. Exact-origin popup tests cover >150 KiB Unicode, consent, private-field exclusion, cancelled/stale import and explicit save replacement. Native Safari verified a 244363-byte transfer and reload without autoplay. | Implemented/tested/live handoff verified |
| §7 exports from a named validated revision, no silent loss | Export tests compare every WAV sample, mutate source while rendering to prove detached revision isolation, compare shared ROM bytes/CPU writes, and explicitly reject unsupported MIDI noise, ROM timing/waves and uncertified LSDj conversion. Generated export matrix covers 100 songs. | Implemented with explicit capability limits |
| §8 native boundary | Native byte-preserving editor is separate; compiler/export paths refuse implicit flattening. Native structural and parser suites are in root tests. Native playback is explicitly not a Create prerequisite. | Preserved |
| §9/10 existing regressions and render parity | Released full root suite exit 0; reference-ROM-dependent checks explicitly skip when ROM absent. Ten-song browser/broadcast comparison: minimum correlation 1.000000, max RMS difference 0.175 dB, no clipping. | Released gate green; follow-up gate pending |
| §9/10 representative musical listening | `audition-music-workspace.js` renders original/manual-bass/simplified-drums variants. No human listening result has been received or inferred. | Unverified |

## Explicit capability limits

The compiler permits 1,048,576 UTF-16 code units and 216,000 frames. This does
not guarantee that every project fits a paid model context or browser export
allocation. Built-in Chat accepts 512 KiB UTF-8 source and 1 MiB total request
JSON; audio/file export accepts at most 600 seconds, with additional documented
format constraints. No source is truncated and no song is shortened to fit.
Larger projects remain editable/playable and downloadable as project files.
These restrictions must be shown truthfully; they are not claims of full-range
model context or audio export support.

The core completion claim remains withheld until the listening gate is resolved.
Follow-up regression and deployed native checks are complete as recorded above.
Optional external MCP
OAuth/client acceptance is not a blocker for the owner's selected built-in path.
