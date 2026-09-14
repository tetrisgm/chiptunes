# chiptunes handoff

## Current work — 2026-09-15

The active direction is [simple Strudel + GLSL Create](algorave-simple-workspace-plan.md).
Local implementation now has native language runtimes, code editors, audio-reactive
shader buffers/recovery, staged agent Apply/Undo, draft/applied persistence,
portable project opening/download, three original examples, and terminable music
evaluation/query workers in a minimal shell.
[Runtime decisions and evidence](algorave-runtime-decisions.md) record the boundaries.
Worker recovery/clock, editor, workflow, preview and agent checks pass; provider
responses are fixtures.
Production Create is unchanged and no live provider call or deployment occurred.

Next: finish asset handling and performance acceptance, preserve legacy navigation
while replacing the default entry, resolve distribution obligations, and complete
native Safari/external-display/sustained performance acceptance. Historical web
release acceptance does not establish completion of this revised product.

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
