# chiptunes handoff

## Current work — 2026-09-15

The owner updated the goal: music must equal Strudel and use its language;
visuals must equal Shadertoy and use its language; finish native/Chromium chat
acceptance and deploy publicly. Deployment is now requested, but parity is not
established: sample-loading/integration restrictions and missing shader channel/
pass types require work. Do not treat the earlier bounded compatibility contract
as satisfying this expanded goal. Chromium captured-reply UI checks now pass via
`scripts/verify-algorave-provider-ui.cjs`. Native Safari replay of all three OpenAI
responses now passes on `668ca3b9634e`; Anthropic native replay remains next.
Shader parity progress: removed the fixed 1080p output cap in favor of actual GL
device limits and corrected buffer iChannelTime to zero. Independent 2560×1440
pixel/uniform checks and the full preview suite pass on `668ca3b9634e`.

The active direction is [simple Strudel + GLSL Create](algorave-simple-workspace-plan.md).
The shared local build now opens the minimal Strudel/GLSL workspace at `/` and
`/create`. Chip projects, their saved data, links and export UI remain available
through secondary navigation; switching pages disposes the previous player.
[Runtime evidence](algorave-runtime-decisions.md) and the
[distribution/source record](algorave-distribution.md) describe the current build.
Entry, editor, workflow, preview, worker, source-rebuild and legacy preservation
checks pass. Native Safari basic editing/audio-texture/fullscreen/reload checks
passed on build `6e20fa4925dc`; full agent/external-display acceptance is incomplete.
Live provider capture/runtime results are recorded below. No public deployment occurred.

Code-plus-output fullscreen now works in all layouts; native Safari and Chromium
checks passed on build `869b21f502ab`, including editing and Stop inside fullscreen.

Next: finish full Mac/provider acceptance; review the recorded distribution details.
The baseline 1800-second run passed on build `869b21f502ab`; session `42681` is
finished and its browser/server closed. See the runtime record for measurements.
The newer sample-enabled build `48aa463e6fd2` now imports WAV files/public GitHub
raw URLs from a secondary menu, persists bytes in IndexedDB and exports portable
sample projects. Chromium import/playback/Undo/reload/fresh-context tests and the
preview/workflow/editor/worker/entry regressions pass. Native Safari sample checks
found and fixed startup/effect-module issues; see the native Safari
checkpoint in the runtime record. The sample-enabled 1800-second run passed on
build `1c68b1666ee5` / commit `fb20e3c`. Session `64814` exited successfully and
closed its browser/server. Measurements and limitations are in the runtime record;
the receipt is `.algorave-preview/sample-soak-receipt.json`.
The owner authorized testing with the existing keys. All six live requests
succeeded (three OpenAI, three Anthropic), and all captured candidates compiled,
played and restored exact Undo in Chromium. No retries. See the runtime record.
Native Safari external-display fullscreen passed on `1c68b1666ee5`; the local
test window/server are closed. Acoustic listening and the native end-to-end
sequence using the captured provider replies
remain open; see the runtime record for the display scope and limitations.
The [release preparation](algorave-release-candidate.md) records the implementation
candidate, remaining acceptance gates and coordinated web rollback requirements.
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
