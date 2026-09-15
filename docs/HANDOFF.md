# chiptunes handoff

## Current work — 2026-09-15

The active goal requires full Strudel and Shadertoy capability in their languages,
real AI chat → Apply → Undo in native Safari and Chromium, and public deployment.
VR is excluded at the owner’s explicit request on 2026-09-15.
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
The upstream `edoScale` module is also integrated from pinned source; see the
[EDO checkpoint](algorave-runtime-decisions.md#edo-scale-module--2026-09-15).
Upstream gamepad pattern inputs are integrated; see the
[gamepad checkpoint](algorave-runtime-decisions.md#gamepad-pattern-inputs--2026-09-15).
Published upstream MIDI input/output is integrated; Chromium simulated-port checks
and native Safari unsupported-browser recovery pass on `fbc2ea1f320f`. See the
[MIDI checkpoint](algorave-runtime-decisions.md#midi-inputoutput--2026-09-15).
Published upstream OSC output is integrated with browser loopback permission and
visible connection errors; secure Chromium and native Safari wire tests pass on
`324ab00cd821`. See the [OSC checkpoint](algorave-runtime-decisions.md#osc-output--2026-09-15).
Strudel drawing APIs now display their canvas below the music editor and retain
it across failed edits; see the [drawing checkpoint](algorave-runtime-decisions.md#visible-strudel-drawing--2026-09-15).

Image texture and keyboard inputs plus per-channel sampler controls are now
implemented; see the [image/keyboard checkpoint](algorave-runtime-decisions.md#image-and-keyboard-channels--2026-09-15).
Local image files now survive Run/Undo, reload and portable project transfer; see
the [local-image checkpoint](algorave-runtime-decisions.md#local-image-projects--2026-09-15).
Six-face cube inputs now use samplerCube without rewriting GLSL; see the
[cube-texture checkpoint](algorave-runtime-decisions.md#cube-texture-inputs--2026-09-15).
Generated Cubemap A passes now support standard mainCubemap, feedback, editor
Run/Undo and portable projects; Chromium and native Safari pass on `e5092eb0e567`.
See the [cube-output checkpoint](algorave-runtime-decisions.md#cubemap-output-pass--2026-09-15).
Volume inputs now support standard sampler3D, local/HTTPS .bin data and portable
projects, verified in Chromium and native Safari on `6e2c54863c46`; see the
[volume checkpoint](algorave-runtime-decisions.md#volume-texture-inputs--2026-09-15).

Video texture inputs now support HTTPS/local media, playback, standard uniforms,
Run/Undo and portable persistence. Chromium passes on `0555234bba84`; native Safari
playback/editing and final stopped reload pass locally. See the
[video checkpoint](algorave-runtime-decisions.md#video-texture-inputs--2026-09-15).

Camera inputs are integrated with Play-only permission, shared capture, and track
release on Stop. Full Chromium fixture capture and native Safari denial/synthetic
stream checks pass locally on `9c8e3981729b`; no physical camera was used. See the
[camera checkpoint](algorave-runtime-decisions.md#camera-texture-input--2026-09-15).

External file audio and microphone channels are integrated; file persistence,
waveform/spectrum output and capture cleanup pass in Chromium and native Safari
with controlled audio fixtures on `4a5ca1bf34ea`. See the
[external-audio checkpoint](algorave-runtime-decisions.md#external-audio-inputs--2026-09-15).
The Strudel bridge now matches the external audio FFT settings (2048 samples,
512 exposed bins); a real 220 Hz DSP tone verifies the frequency-bin mapping.

Sound is integrated into the pass editor, project format and transactional
Run/Undo flow. Chromium checks cover actual playback, failed-compile retention,
stopped reload and an image-driven Sound track. Dynamic Sound inputs and native
Safari acceptance remain pending. See the
[Sound renderer checkpoint](algorave-runtime-decisions.md#sound-renderer-foundation--2026-09-15).

Next: complete the remaining Strudel input/drawing/module scope and Shadertoy
media and Sound contracts; complete final browser/acoustic
acceptance and check performance appropriate to subsequent changes. Chromium DSP checks use an explicit
silent sink after default-device failures also affected upstream. Six saved real
provider replies are available for zero-call replay. Native OpenAI music, visual
and paired Apply/Undo plus stopped reload pass on `3d78fc0bf069`; Anthropic
Apply/Undo and stopped saved reload pass on `5d59d4f4f9c2`.
The captured Claude palette still cycles through warm colors despite its
blue/violet explanation; guide updated, new provider output still unverified.
The 30-minute upstream runtime check passed on `d793b1d18718`, including changing
samples, Strudel drawings, tempo, GLSL and layout. It uses an explicit silent sink;
speaker quality and separate audio-frame heap remain unmeasured. See the
[performance checkpoint](algorave-runtime-decisions.md#upstream-performance-harness--2026-09-15).
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
