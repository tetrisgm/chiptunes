# chiptunes handoff

## Current work — 2026-09-15

The active direction is [simple Strudel + GLSL Create](algorave-simple-workspace-plan.md).
The shared local build now opens the minimal Strudel/GLSL workspace at `/` and
`/create`. Chip projects, their saved data, links and export UI remain available
through secondary navigation; switching pages disposes the previous player.
[Runtime evidence](algorave-runtime-decisions.md) and the
[distribution/source record](algorave-distribution.md) describe the current build.
Entry, editor, workflow, preview, worker, source-rebuild and legacy preservation
checks pass. Native Safari basic editing/audio-texture/fullscreen/reload checks
passed on build `6e20fa4925dc`; full agent/external-display acceptance is incomplete.
No live provider request or public deployment occurred.

Code-plus-output fullscreen now works in all layouts; native Safari and Chromium
checks passed on build `869b21f502ab`, including editing and Stop inside fullscreen.

Next: finish asset handling, the 30-minute performance run and full Mac/provider acceptance; review the recorded distribution details.
The sustained-performance harness is committed as `815e9e5`. A full 1800-second
run is active in exec session `42681`; its first 30-second sample passed. Poll
that handle and read `.algorave-preview/soak-receipt.json` before deciding whether
it is finished. Do not start another browser/audio suite while this run is live.
The short harness check passed; full acceptance is not yet established.
Sample preparation now has tested download/content/WAV helpers and an immutable
audio-bank manager with cumulative PCM reservations; runtime wiring and project
asset persistence are still pending. See the runtime record.
The prepared six-call provider test is awaiting the owner's authorization.
The production Safari warning was traced read-only to asset hash `5fba76c2aeb5e170`.
The local build now accepts that exact observation-only APU update and preserves
the complete old record; see the historical recovery evidence in the runtime record.
The production record remains untouched and the fix is not deployed.

2026-09-13: Instruction-only cleanup; application behavior unchanged. Earlier notes are preserved verbatim in [HANDOFF-history-2026-09-13.md](HANDOFF-history-2026-09-13.md). Read the relevant section when resuming its topic; historical release/status claims need revalidation.

## Recent recorded checkpoints

- [2026-09-12 — Algorave web release live and verified](HANDOFF-history-2026-09-13.md#2026-09-12--algorave-web-release-live-and-verified)
- [2026-09-11 — Bounded Tidal-guided cycle patterns (local checkpoint)](HANDOFF-history-2026-09-13.md#2026-09-11--bounded-tidal-guided-cycle-patterns-local-checkpoint)
- [2026-09-11 — Audiovisual persistence, Phase E checkbox 1 (local checkpoint)](HANDOFF-history-2026-09-13.md#2026-09-11--audiovisual-persistence-phase-e-checkbox-1-local-checkpoint)

## Follow-up records to revalidate

- [2026-09-08 — Source-backed Create workspace (live provider still pending)](HANDOFF-history-2026-09-13.md#2026-09-08--source-backed-create-workspace-live-provider-still-pending)
- [2026-09-05 — pushed checkpoint and next import checks](HANDOFF-history-2026-09-13.md#2026-09-05--pushed-checkpoint-and-next-import-checks)
- [Next sound-parity evidence: the envelope hold table is wrong](HANDOFF-history-2026-09-13.md#next-sound-parity-evidence-the-envelope-hold-table-is-wrong)

For other topics, search `HANDOFF-history-2026-09-13.md` by term, then read that section. Implementation and checks are in their source files and git history; this entry point does not duplicate them.

The earlier full suite timed out in `scripts/verify-screens.js` (180-second screenshot); it did not establish an application regression. This prose-only change is checked independently and does not claim that suite passed.
