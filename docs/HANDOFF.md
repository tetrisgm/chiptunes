# chiptunes handoff

## Current work — 2026-09-15

The active goal requires full Strudel and Shadertoy capability in their languages,
real AI chat → Apply → Undo in native Safari and Chromium, and public deployment.
Do not close it using the earlier limited compatibility contract.

The serialized music worker has been replaced by upstream evaluation, scheduler
and Web Audio in the opaque sandbox. Closures, custom nodes and samples() now
pass the same four programs as upstream. Source/sound-registry Undo, asynchronous
Stop and deferred project Open are implemented. Manual Run Undo now restores the
editor as well as playback. This architecture no longer preempts infinite loops;
see the [current runtime checkpoint](algorave-runtime-decisions.md#current-upstream-runtime--2026-09-15)
for limits, exact verification scopes and remaining work.

Standard Strudel catalogs, ZZFX, GM soundfonts, the piano helper and xen tuning
are integrated; see the [sound-library checkpoint](algorave-runtime-decisions.md#standard-sound-libraries--2026-09-15).

Next: complete the remaining Strudel input/drawing/module scope and Shadertoy
media, sampler, keyboard, cubemap, Sound and VR contracts; repeat native acceptance
and sustained performance on the replacement. Chromium DSP checks use an explicit
silent sink after default-device failures also affected upstream. Six saved real
provider replies are available for zero-call replay. Native OpenAI music, visual
and paired Apply/Undo plus stopped reload now pass on `3d78fc0bf069`; Anthropic
replay on the replacement remains open. Old soak receipts are historical.
The public simpler app has not been deployed. Deployment of both
site and gateway is already authorized; no box/desktop/store changes.

References: [plan](algorave-simple-workspace-plan.md),
[distribution/source](algorave-distribution.md),
[release procedure](algorave-release-candidate.md). The minimal workspace is the
local default at `/` and `/create`; legacy chip data/exports remain secondary.
The production Safari recovery warning was traced to asset hash `5fba76c2aeb5e170`;
the local observation-only APU recovery preserves the old record. That fix remains
undeployed and production data was not modified; see the historical runtime record.

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
