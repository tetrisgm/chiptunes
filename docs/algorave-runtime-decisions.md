# Algorave runtime checkpoint — 2026-09-14

Implementation of [the simple workspace plan](algorave-simple-workspace-plan.md)
has started. This is a local runtime proof, not the new default or a release.

## Selected boundaries

- Pin @strudel/web 1.3.0, which pins core/mini/tonal/transpiler 1.2.6 and
  webaudio 1.3.0. Use upstream initStrudel and its evaluator/scheduler/output.
  package-lock.json records the dependency graph. No cycleV1 translation.
- Bundle the music engine into an opaque-origin sandbox frame (allow-scripts,
  without allow-same-origin). srcdoc contains the local bundle and a restrictive
  CSP. Parent communication uses a private MessageChannel; structured incoming
  data is bounded and does not perform privileged actions. Parent DOM and local
  storage denial are verified in Chromium. Network access is currently denied;
  synths work, external sample loading is not implemented yet; the follow-up adds a local drum bank.
- src/algorave/music-runtime.mjs taps actual output through an analyser and records
  scheduled upstream events. The parent receives waveform/spectrum, cycle/time,
  tempo and bounded event data. The prototype uses spectrum in iChannel0.
  The follow-up below adds scheduled kick bindings and an output-time estimate;
  acoustic/display latency acceptance remains open.
- src/algorave/shader-runtime.mjs implements GLSL mainImage, uniforms, Common and
  Image/Buffer A-D routing. Feedback uses RGBA16F ping-pong targets: earlier passes
  are current-frame, self/later inputs are previous-frame. Compilation prepares
  the entire candidate before replacing working passes. The initial editor exposes
  Image only; buffer editing/channel assets are not exposed yet.
- build.js --algorave-preview writes only .algorave-preview, excluded from git and
  production dist. The normal build and existing Create route are unchanged.
  preview.mjs/preview.html are an executable shell proof to evolve into the main
  workspace, not an alternate production composition pipeline.

## License/distribution gate

The installed Strudel package declares AGPL-3.0-or-later and includes its license.
The current repository LICENSE is MIT. The official integration guidance at
https://strudel.cc/technical-manual/project-start/ calls out AGPL distribution and
corresponding-source obligations. The runtime source has been inspected to select
its public APIs. No existing license has been replaced and no integrated runtime
has been deployed. Before a distribution: inventory bundled dependency licenses,
confirm rights/visibility and the exact corresponding-source delivery mechanism,
and obtain any necessary owner decision on publication/relicensing. Keeping the
runtime in a frame is an execution boundary, not a claimed license exemption.

## Verification and limits

Run `npm run test:algorave-preview` on the Mac. Its Chromium test uses normal
browser autoplay policy, real Strudel synthesis and WebGL. Evidence covers:

- Stopped entry, user-click Play, measured nonzero audio, live source update,
  syntax-error retention and Stop.
- Frame denial of parent DOM/private local storage.
- Exact red pixel output, invalid shader retaining last-good output, feedback
  accumulation and preservation of negative/HDR intermediate values.
- Desktop and 390px layout screenshots and no horizontal page overflow.

The reviewed first screenshots exposed unwanted code wrapping; textarea wrapping
was disabled. This is still a basic editor, not final visual acceptance. Screenshots
are local generated files under .algorave-preview. One intermediate test failed
with `Image: null` during shader compilation; its standalone rerun passed. There
is no claimed runtime fix for that failure. The follow-up below adds forced context-loss recovery coverage; sustained
performance remains open.

Remaining work includes CodeMirror language feedback, external samples with a
bounded asset policy, channel UI,
phase/error transactional guarantees for arbitrary evaluated code, a recoverable
execution-time limit (a frame alone does not prevent main-thread stalls), custom
audio/event-role bindings, client dual-language Apply/Undo, persistence, legacy
entry preservation, native Safari, external display and sustained acceptance.
No live provider call, production deployment, desktop restart or broadcast change.

## Runtime recovery and agent contract checkpoint

The local proof now bundles three original PCM drum samples (bd/sd/hh), generated
once with deterministic synthesis and registered through the actual Strudel
sampler. The frame CSP permits local blob fetches, retaining external network
denial. The initial example uses those samples alongside synth patterns.

MusicSignals consumes actual scheduled bd events, epoch identity, cycle/tempo and
an audio output-time estimate. It aligns the kick envelope to each event deadline,
extrapolates between reports with a 250 ms cap, and rejects old/stopped events.
This is software timing evidence, not an acoustic/display-latency measurement.
The shader exposes ctKick/ctCycle/ctBeat; the current example still demonstrates
the measured spectrum. Custom event-role selection remains to be implemented.

ShaderRuntime now handles real WebGL context loss/restoration by rebuilding the
last applied shader document. Pending candidates are invalidated. Resize preserves
floating-point feedback with a blit, keeps the frame index, and bounds resolution
to 1920x1080. Pointer input supplies bottom-left pixel coordinates and signed click
state. The Chromium acceptance forces loss through WEBGL_lose_context, confirms
restored pixel output and continuing audio, checks feedback after resize and real
browser pointer input. This does not replace native Safari pointer acceptance.
The earlier unexplained compilation failure remains recorded; forced recovery is
now covered independently, not claimed as its established root-cause fix.

src/algorave/project.cjs defines a versioned, bounded audiovisual project and SHA-256
revision identity. Edits address music, Image/Common/A-D, or serialized channels.
The shared candidate validator rejects stale identity, invalid Unicode, overlap,
unknown documents, absent buffer references and explicit target violations.
Server music-chat-handler dispatches the explicit algorave kind through this
contract while preserving legacy compiler/constraint behavior. Its authentication,
origin, quota, deadline and replay controls remain shared. It never executes user
Strudel/GLSL on the server; native candidate evaluation/compilation is a client
acceptance gate before Apply, not something structural validation proves.

server/algorave-agent-guide.js supplies version-specific Strudel and GLSL guidance,
small examples, real sample names and signal bindings. Both provider adapters
translate unique text anchors within named documents into validated source edits.
No provider credentials or live requests were used. The new agent format is not
yet connected to the preview UI; client Apply/Undo and persistence remain next.

Checks: npm run test:algorave-preview; npm run test:algorave-agent (new audiovisual
contract/provider fixtures plus all 35 legacy chat groups); gateway suite 78/78.

## Client Apply/Undo and persistence — 2026-09-15

The preview now connects the typed gateway contract to a collapsed Agent drawer.
It supports both providers, optional access unlock, bounded/cancellable responses,
and review-before-Apply. Music-only, visual-only and paired proposals use the
same session model. Named shader passes and channel routing are editable behind
the visual editor's controls. Save/download, Undo and fullscreen visuals are in
one secondary menu; Undo is also available beside an agent proposal.

Music candidates use an upstream staging REPL without starting its scheduler.
The primary REPL remains the only scheduled player and uses the same AudioContext.
Candidate tempo, labels and ordinary pattern expressions are evaluated before
activation; representative pattern windows are queried. Prepared pattern closures
stay inside the opaque music frame. A failed candidate that calls setcpm before
an undefined function leaves the actual playing tempo/epoch unchanged. GLSL and
music are both prepared before paired Apply. Visual activation is restored to the
previous source if the subsequent music commit fails. These checks cover ordinary
Strudel proposals; arbitrary global side effects, unbounded code and adversarial
lazy pattern callbacks still need stronger execution control. No claim that a
staging REPL alone is a complete sandbox or a preemptive execution-time limit.

ProjectSession tracks draft and applied projects separately, with a bounded Undo
history. ct-algorave-project-v1 is separate from legacy project storage. Reload
restores unfinished code plus the last applied shader and never starts music.
Malformed saved data is kept; automatic saving refuses to overwrite it. Saving
also compares the last read value to detect another tab's update. Explicit Save
can replace an unreadable record; download exports the current portable project.
Imported files/legacy navigation and full corresponding-source delivery are still
outstanding. Chat credentials/history are not written into the project record.

Checks passed on the Mac:

- npm run test:algorave-workflow: session recovery/Undo, failed activation,
  corrupt/cross-tab preservation, cancelled/stalled/oversize agent responses;
  real browser and gateway handler with six fixture requests for music, visuals,
  paired edits, invalid candidates and stale proposals; unchanged live clock;
  rendered pixels after rejection/layout changes; exact save/reload without autoplay.
- npm run test:algorave-preview: existing real audio, drums/signals, shader pixels,
  resize/context recovery, pointer, narrow layout and Stop checks remain passing.

The first workflow screenshot captured a blank output around a layout change.
The final test waits for actual nonzero pixels from the normal animation loop
before screenshotting (without forcing a render); the reviewed output is visible.
The desktop footer overflow found during review is corrected. This is still the
basic editor shell; CodeMirror highlighting, richer error feedback and final
simplicity/native Safari acceptance are not complete. No live provider request
or deployment occurred.

## Code editors and portable project opening — 2026-09-15

The two code surfaces now use a small CodeMirror configuration with dark-theme
syntax highlighting, line numbers, bracket support and concise language-specific
completions. GLSL uses @codemirror/legacy-modes 6.5.4 (MIT); existing CodeMirror
versions are unchanged. Compiler line diagnostics decorate the current source
when the runtime supplies a usable line location. Runtime errors without a reliable
location stay in the status text rather than being placed on a guessed line.
Cmd/Ctrl Enter evaluates the focused language, with higher priority than the
editor's default insert-blank-line binding. Tab remains available for navigation.
Shader passes retain separate editing histories; project import clears those
histories so keyboard Undo cannot pull text across project boundaries. App Undo
still restores the full previous project.

The secondary menu now opens/downloads the versioned audiovisual JSON project,
provides three original examples (groove, kick pulse, feedback trails), and shows
short contextual help. Imported/example code is validated before activation and
starts stopped, even when replacing a playing project. Unsupported or malformed
files leave the existing project intact; this is not a chip-song conversion path.
The existing chip import UI still needs explicit preserved navigation when the
new default route is integrated. File reads are bounded and reject concurrent
draft changes. The selected visual editor returns to Image for an opened project.

npm run test:algorave-editor passes in real Chromium: syntax highlighting,
accessible editor fields, keyboard Run and Tab, GLSL line errors, per-pass history,
completions, all three examples through actual engines, stopped import, download
round-trip, import Undo, rejected legacy-shaped input and narrow-page layout.
The editor test caught and corrected shortcut precedence and malformed example
option markup. Reviewed screenshots use the running renderer after layout settles.
npm run test:algorave-workflow and npm run test:algorave-preview also pass with the
code editors. Native Safari, live providers and deployment remain unperformed.

## Terminable pattern execution — 2026-09-15

User music now evaluates in a dedicated worker per candidate, using the pinned
upstream core REPL, transpiler, mini-notation and tonal functions. Pattern closures
stay in that worker. A failed candidate cannot replace or hang the active pattern.
Only bounded serializable onset/control records cross a private MessageChannel to
the opaque audio frame. Both ends check controls; arbitrary audio callbacks,
stateful triggers, custom audio nodes and executable control values are rejected.
Normal Strudel pattern transformations still execute upstream, without translation
into the legacy language. The agent guide records the boundary. Samples remain
the bundled original drums; there is no external network or parent storage access.

The audio frame uses upstream createClock and superdough with one AudioContext.
An adapter queries contiguous cycle windows asynchronously, schedules whole-event
onsets and note durations, preserves cycle position during live replacement, and
anchors tempo windows using tick multiplication to avoid accumulating rounding.
Waveform/spectrum and kick deadlines still come from actual audio output. Cycle
signals follow the audible scheduling timeline with the existing output timestamp
estimate; this does not establish acoustic/display latency acceptance.

An external deadline terminates evaluation after three seconds or a stalled query
after one second. Candidate errors retain previous playback. A later lazy query
failure stops transport, reports the error, preserves the draft and permits Run
with repaired code. The stress test exposed a re-entrant clock-stop bug: resetting
upstream phase within its catch-up callback could loop indefinitely. Queue draining
and overload failure now occur after that callback returns. A dedicated regression
checks this and rejects stale worker failures after a new playback generation.
This protects the UI from music JavaScript loops; it does not claim preemption of
GPU shaders or hard real-time/resource isolation against arbitrary hostile code.

Evidence on the Mac:
- npm run test:algorave-worker: actual isolated workers and audio, infinite loop,
  unresolved async evaluation and recursion with prior audio intact, native onset
  and sustained-note expectations, lazy-loop stop and repaired Run; deterministic
  clock tests cover 1000 windows, tempo/live swaps, missed windows and overload.
- Preview, workflow and editor browser checks cover existing audio/GLSL behavior,
  paired Apply/Undo, examples, imports and persistence through the worker adapter.
- Agent/legacy gateway checks remain fixture-only with no paid provider requests.

The local build bundles the worker inside the music frame artifact and includes
its source in the build identifier. Production/default entry, native Safari,
external-display/sustained acceptance and the distribution gate remain open.

## Minimal default and preserved chip entry — 2026-09-15

The normal shared build now chooses the workspace before loading an engine.
Fresh `/` and `/create` entries show the small same-origin audiovisual UI frame;
the legacy 2.6 MB app bundle is not requested. Its CSS and runtime cannot add
panels to the new creative surface. The music execution frame remains opaque and
worker-isolated. Existing `#s`, `#music` and transfer links, broadcast and listening
routes retain their original runtime and URLs. Chip projects and Listen are in the
secondary menu. Chip projects offers a return to Strudel/GLSL. A full navigation
and explicit Stop dispose the departing engine; a failed save blocks navigation.
The preserved chip workspace retains its compiler, imports and applicable exports.

The same builder supplies both `dist/algorave` and the local preview. The
[distribution record](algorave-distribution.md) records public repository visibility,
license metadata, notices and exact source delivery. The source archive's checksums
pass and a fresh npm ci/build from it reproduces both browser bundles exactly.
Original MIT licensing is unchanged; bundled AGPL dependencies are disclosed with
license text and source access in Help. No deployment was performed.

Evidence:
- npm run test:algorave-entry: default shell, no legacy bundle on new entry, real
  playback, stopped page handoff, chip recovery, exact saved-chip bytes left intact,
  existing consumed source links and native cartridge-note links, reload and narrow
  layout. Reviewed default-entry.png/default-entry-narrow.png in the preview folder.
- npm run test:algorave-source: archive contents/checksums/notices and independent
  dependency installation plus byte-identical browser rebuild in a temporary tree.
- Preview, workflow and editor suites pass serially on the current source. Existing
  unified entry and preservation checks also pass. Agent responses remain fixtures.

Native Safari was tested through its actual macOS UI on a fresh local origin,
visible build `6e20fa4925dc`, in a separate tab. Play produced Safari's audio indicator;
Cmd-Enter applied an edited original groove. A GLSL diagnostic showed green only
when the actual frequency texture contained a nonzero signal. The screenshot was
green during playback and fullscreen. An invalid shader displayed a line-1 syntax
error while retaining that green output. Keyboard Undo/Run repaired the draft;
Save and reload retained the edited music with Play restored and no audio indicator.
The test tab and temporary server were closed. This is local native-browser evidence,
not production verification, acoustic listening, external-display acceptance, a
30-minute soak, or a live-provider test. Those requirements remain open.
