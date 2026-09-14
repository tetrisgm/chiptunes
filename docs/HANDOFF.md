# chiptunes handoff

## Current work — 2026-09-14

Owner rejected the current Create experience as too complex and specified actual
Strudel music plus Shadertoy-style GLSL visuals, with one agent able to edit either
or both. [The new implementation plan](algorave-simple-workspace-plan.md) is the
active direction. The first local runtime proof implements pinned upstream
Strudel in an opaque-origin frame and a GLSL renderer with feedback buffers.
[Runtime decisions and verification](algorave-runtime-decisions.md) record current
evidence and remaining work. Run `npm run test:algorave-preview`; production Create
is unchanged. Runtime now includes original drums, scheduled kick signals, mouse
input, resize retention and forced-context-loss recovery. The shared gateway now
validates typed Strudel/GLSL proposals; both provider adapters have fixture coverage.
Next: connect this contract to client Apply/Undo and persistence, finish execution
timeout recovery/external assets, then replace the default entry and perform native
acceptance. Earlier release acceptance below does not
establish completion of this revised product.

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
