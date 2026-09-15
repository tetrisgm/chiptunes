# Simple algorave workspace: Strudel music and Shadertoy visuals

Updated owner requirement, 2026-09-15: music MUST equal Strudel and use the same
language; visuals MUST equal Shadertoy and use the same language. The complete
chat → Apply → Undo flow must pass in native Safari and Chromium, followed by
public deployment. This supersedes acceptance of intentionally limited channel,
pass or music-integration support below. Existing checkmarks remain evidence for
their stated checks, not proof of full parity. Inventory and close those gaps
before claiming this updated objective is complete.

Owner direction, 2026-09-14: the current app is too complex. The agent must write
Strudel music, Shadertoy visuals, or both; the interface must be as simple as those
reference apps. This plan supersedes the completion claim and the custom-language
choices in [the earlier stage plan](algorave-stage-plan.md) and
[unified Create plan](unified-create-plan.md). Those documents remain historical
evidence, not acceptance for this goal.

## Product and completion contract

Open Create into a small playable music example and a working visual preview.
A compact header contains Music / Visuals / Both, Play/Stop, Run, and an Agent
toggle. Music is a real Strudel editor. Visuals is a GLSL editor with a Shadertoy
execution contract. Both reveals the two editors and their shared output without
adding a dashboard. Chat is collapsed initially and can edit either document.
Save, examples, imports, export and help live in one secondary menu. No compulsory
charts, scene lists, parameter panels, onboarding wizard, or provider configuration
in the initial creative surface. No autoplay. Keyboard evaluation targets the
focused editor; labels and errors use musical/visual language, not engine jargon.

A new visitor must be able to play the example with one click, change a pattern,
run it, switch to Visuals, change its code and see the result without opening
settings or reading a guide. Fullscreen shows output or code plus output.
Changing layouts never restarts playback. Chat remains optional for manual use.

The agent receives both current documents, their languages, runtime versions,
revision IDs and the signal contract. It chooses music, visuals or both from the
request. It produces runnable code in the actual supported languages, explains
unsupported features accurately, and preserves the unrequested document. A compact
proposal offers Apply and Undo; implementation diagnostics stay out of the chat
unless useful. Apply validates first and updates a playing session without an
unplanned restart. Paired edits validate both before activation.

## Architecture decisions and preservation

Use upstream Strudel packages with pinned versions; do not translate a small
subset into cycleV1 and call it Strudel. Investigate the upstream evaluator,
scheduler and Web Audio integration before choosing package boundaries. Keep the
existing CodeMirror shell only where it makes the experience simpler.

Implement a local WebGL shader runtime supporting Shadertoy's GLSL entry points,
standard uniforms, pass types and inputs. Image, Common and Buffer A-D are the
implemented starting point, not the final compatibility boundary. Keep additional
passes, media inputs and sampler settings behind secondary controls. Specify
and test iResolution, iTime, iTimeDelta, iFrame, iMouse, iDate, iSampleRate,
iChannel0-3, channel resolution/time and the audio texture layout against official
references. Explicitly document unsupported channel types and Sound/VR/cubemap
passes; do not promise arbitrary Shadertoy URLs work. No scraping shader galleries.
Use original or appropriately licensed examples and assets.

Expose Strudel's actual audio analysis and scheduled musical time to shaders.
Standard audio texture inputs provide waveform/spectrum; separately documented
extensions provide beat/cycle phase and explicit named event triggers. A request
for a kick-reactive tunnel must follow the actual kick events, not an unrelated
animation clock or a guess from bass energy. Timing remains stable across edits,
stop/resume, tempo changes and fullscreen.

The requested native Strudel runtime changes the earlier single chip-pipeline
assumption for the new Create experience. Do not constrain it to four voices or
finite chip Scores to preserve that old assumption. Preserve the existing
composer/player for saved chip songs, imports, radio and existing exports, with
explicit document types and mutually exclusive transport ownership. Do not fork
website/Electron/broadcast SKUs. Retain build.js as the shared build entry.
AGENTS.md itself is unchanged; this scoped owner direction does not authorize
unrelated changes to composer determinism, the fixed game roster or infrastructure.

Reuse the existing gateway authentication, request limits, provider adapters,
revision checking and Undo foundations. Extend their music-only request/proposal
schemas to typed music/visual documents. Existing source-scope validators cannot
simply be bypassed. New executable music code must run outside the privileged app
context: establish an isolation boundary with a narrow validated message protocol,
no provider credentials or private storage access, and explicit sample-loading
policy. A same-origin eval is not an acceptable shortcut. Shader compilation,
context loss and slow rendering must not break audio or trap the UI. Do not claim
that a JavaScript timeout can reliably preempt a stalled GPU shader.

Strudel's integration guide identifies AGPL-3.0 obligations. Before distributing
an integrated artifact, inspect exact package licenses, repository visibility,
compatible dependencies, notices and corresponding-source delivery. Record the
concrete distribution requirements; do not silently relicense existing code or
publish private source. Any owner decision needed here must be precise and follow
useful local work, not block research or prototypes.

### Full parity work after the owner's expanded requirement

The serialized worker has been replaced by upstream evaluation, scheduling and
Web Audio output together in the opaque sandbox frame. Executable callbacks,
custom Web Audio nodes and samples() now run without translation. Preserve and
verify candidate isolation, phase-preserving Apply and source/registry Undo.
Arbitrary JavaScript side effects cannot be completely rolled back, and infinite
loops no longer have the old worker termination boundary. Use the same program
text in the reference engine and workspace. The differential probe is
`scripts/probe-algorave-strudel-parity.cjs`; four passing programs establish those
behaviors only, not full REPL parity.
Add the reference REPL's sample banks and relevant sound/input packages, including
their normal source-language APIs, rather than requiring rewritten examples.

The visual runtime still lacks texture/media input lifecycles, sampler settings,
keyboard input, cube textures/passes, Sound and VR support. Implement and test
those against the official contracts, including persistence and resource cleanup;
do not turn their absence into the final product specification. A valid shader
must retain its GLSL rather than be rewritten to avoid an unsupported channel.
Original test programs and appropriately licensed assets must prove each behavior.
Neither a small fixture set nor matching syntax alone establishes full parity.

## Sequenced work and evidence

### 1. Runtime and interface proof

- [x] Inventory current entry, editor, project, chat, player, visual and build
  boundaries. Record the selected pinned packages, isolation design and license
  requirements in a short implementation decision record.
- [x] Build a local vertical slice: real Strudel groove, editable mainImage shader,
  real audio texture and the proposed minimal shell. Verify actual upstream code
  executes unchanged; use representative mini-notation, transforms, synths and
  samples, not only one trivial example.
- [x] Inspect the rendered shell at desktop and narrow widths. Resolve complexity
  here before expanding capability. Preserve the old experience during migration.

### 2. Music and shader execution

- [ ] Finish Strudel evaluation, diagnostics, sample loading, phase-preserving
  updates, stop and recovery. Invalid drafts preserve the last working music.
- [ ] Finish shader compilation with source-line errors and last-good output,
  standard uniforms, buffers/feedback and channels. Create original fixtures for
  animation, mouse input, audio reaction and multipass feedback.
- [ ] Implement measured audio and musical-event bindings, transport lifecycle,
  resize, context-loss recovery and bounded rendering/resource cleanup.
- [ ] Prove isolation of executable source and malformed message handling; test
  that source cannot access application credentials or private project storage.

### 3. Agent that knows both languages

- [x] Update client/server schemas, context and proposal validation for either
  document or coordinated changes. Bind replies to exact base revisions.
- [x] Supply version-matched language guidance, concise runnable examples and
  diagnostics for Strudel and GLSL, including our audio/event bindings. Eliminate
  custom-language instructions from this new workflow.
- [ ] Test music-only, shader-only and combined requests; compile generated
  candidates, preserve unrelated source, reject stale proposals and verify exact
  Undo. No automatic paid retries. Test fixtures do not count as live providers.

Local evidence for the first two items and fixture-based Apply/Undo is in
[the runtime checkpoint](algorave-runtime-decisions.md). Live provider acceptance
remains open; fixture responses are not model-quality evidence.

### 4. Persistence and a simpler default

- [ ] Save a versioned project containing both sources, runtime versions, channel
  assets/buffer configuration and bindings. Recover after reload without autoplay.
  Keep panel geometry local. Preserve old saved projects and links without lossy
  conversion; legacy chip exports remain available only for applicable documents.
- [x] Make the minimal workspace the default Create entry. Remove obsolete panels
  from this default, with secondary access to preserved legacy functionality.
- [x] Add small original examples and concise contextual help. Support keyboard
  navigation, readable errors, accessible buttons and narrow screens.
- [x] Finish fullscreen output and code-plus-output. Verify a visible external
  display on the Mac; document hidden/minimized-window limitations honestly.

### 5. Acceptance and delivery

- [ ] On the Mac, perform: open -> Play -> edit groove -> Run -> edit shader ->
  Run -> ask for bass -> Apply -> ask for kick-reactive tunnel -> Apply -> ask for
  a coordinated change -> Apply -> Undo -> save/reload -> fullscreen. Record
  visible build identity and evidence for both Chromium and native Safari.
- [ ] Validate representative Strudel programs and original Shadertoy-contract
  fixtures, including multipass feedback, against independent expected results.
  Check audio/event correspondence and listen to representative musical output.
- [ ] Run relevant editor, project, gateway, security and browser checks; retain
  legacy composer/export/render-parity checks where affected. Update obsolete UI
  expectations to this brief rather than retaining clutter to satisfy old tests.
  Run browser/audio suites serially; record reruns and unresolved failures.
- [ ] Repeat the earlier sustained 30-minute local performance on the new upstream
  runtime with edits, bounded sample
  resources and shader changes; observe audio continuity and resource growth.
- [ ] Verify real provider behavior with bounded calls when authorized; otherwise
  identify that acceptance gate explicitly. Do not infer authorization from old
  release notes. Keep secrets out of logs, source and tool arguments.
- [ ] Commit and push coherent, passing implementation on main. Prepare a concrete
  web release with rollback references. The updated goal authorizes public
  deployment; no desktop reinstall, broadcast restart or store upload.

Complete means the demonstrably simple app, full music/visual runtime parity,
agent support and persistence are verified and deployed at the public link.
Deployment is authorized by the updated goal. Local checks and checked feature
boxes alone cannot establish completion; verify the actual public artifact.

## Starting points and references

- src/music-workspace.js, src/music-workspace.css, src/music-code-editor.mjs:
  current shell and editor.
- src/music-project.js, src/music-project-transfer.js: document persistence.
- src/music-chat.js, src/music-chat-ui.jsx, server/music-chat-handler.js,
  gateway/lib/chat-providers.mjs: agent client and server boundaries.
- src/visual-language.js, src/visual-renderer.js, src/visual-stage.js:
  existing bounded visual language; not GLSL compatibility.
- src/audio.js, src/music-event-stream.js, docs/music-signals.md: existing signals.
- build.js and package.json: shared artifact and verification entry points.
- [Strudel integration](https://strudel.cc/technical-manual/project-start/):
  upstream embedding/package options and license guidance, checked 2026-09-14.
- [Strudel learning reference](https://strudel.cc/learn/getting-started/).
- [Shadertoy specification/help](https://www.shadertoy.com/howto): authoritative
  compatibility reference to inspect during phase 1; automated retrieval was
  unavailable during planning, so exact contracts still require verification.
