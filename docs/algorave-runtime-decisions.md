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

## Code-plus-output fullscreen — 2026-09-15

The secondary menu now offers Fullscreen code + visuals alongside Fullscreen
visuals. The code view retains the chosen Music/Visuals/Both layout, code editing,
Run/Stop and error status. Entering closes the menu and agent drawer and focuses
the selected editor. It does not activate a project, replace an engine or restart
playback. Leaving fullscreen returns to the existing layout. A missing/rejected
Fullscreen API is reported in the normal status area.

npm run test:algorave-fullscreen passes through the actual shared-build iframe:
all three code layouts, unchanged source on entry, keyboard shader evaluation,
visuals-only fullscreen, an unchanged audio epoch, exit and Stop. The editor suite
also passes. A screenshot revealed text showing through the transparent line-number
gutter on horizontally scrolled lines; the gutter now has the editor's opaque dark
background. The corrected Both layout was reviewed in fullscreen-code.png.

Native Safari on the Mac, local build `869b21f502ab`: entered code fullscreen while
playing, switched to Both without leaving fullscreen, edited and ran a shader with
Cmd-Enter, and observed nonzero audio texture data as green output. Stop remained
available in fullscreen; the audio-texture output settled to black, and Escape
returned to the same editors with Play available. The temporary tab/server were
closed. This is not an external-display, production or 30-minute performance test;
those acceptance requirements remain open.

## Historical chip recovery — 2026-09-15

A read-only native Safari console query of version metadata identified the real
production warning: saved language/compiler `1` and assets `5fba76c2aeb5e170`,
versus current assets `e84045bcb7186729`. No source/private data was printed or
changed. The console was closed after inspection.

Git history pins the old asset triplet to `11dd607c50b5`; `88062941bfbb` changed
only gb-apu.js within that triplet, adding scalar event observations and indices.
Hardware and instrument assets are identical. An independent local VM comparison
loaded the historical triplet with git show and the current files, verified both
SHA-256 prefixes, and compared complete Float32 PCM bytes for four-bar pulse,
wave-bass and n-tick source fixtures at 8000, 44100 and 48000 Hz. All nine renders
were nonzero and exactly equal. This supports only this specific hash pair.

Restore now accepts that pair with language/compiler exactly `1`, retaining the
original version metadata, drafts, validated source and private data. Unknown
hashes, language/compiler changes and the reverse pair still fail. No general
version bypass or lossy source migration was introduced.

All 26 project contract groups pass, including exact private-record serialization,
invalid-draft retention and rejection of future versions. The shared-build entry
browser test reopens a historical-hash fixture without autoplay or replacing its
saved bytes, alongside existing Strudel/chip handoff and cartridge-link checks.
All nine transfer protocol checks also pass. The production tab's original
record remains unchanged; this local fix has not been deployed or tested against
that private record's source in the new build.

## Sustained performance harness — 2026-09-15

`npm run test:algorave-soak` builds the shared artifact and runs 1800 seconds of
local Chromium playback. Every 30 seconds it changes Strudel tempo/notes and GLSL
through the real editors and Run button, then changes layout. It records scheduled
kick gaps, audio-signal delivery gaps, analyser silence, transport epochs, bounded
Undo history, worker counts, live WebGL program/texture counts, blob URL counts
and main-frame heap samples. It stops and closes its browser/server on completion
or failure. Run serially with other browser/audio suites.

The receipt is `.algorave-preview/soak-receipt.json`; it records elapsed time,
build identity, samples and terminal status. A 30-second harness check passed
(57 kicks, maximum scheduled kick gap 0.536 seconds, one worker, approximately
7 MiB main-frame heap). Its initial test-only `GLSL visuals` locator was corrected
to the actual `GLSL visual` label before this pass. A short run is explicitly
marked as a harness check and does not establish 30-minute acceptance.

These measurements cannot prove acoustic glitch freedom, whole-browser/GPU heap
usage, native Safari performance, or external-display behavior. The fixed original
drum bank is exercised; external sample loading remains separate work.

### External-sample integration constraints

Checked the [upstream sample contract](https://strudel.cc/learn/samples/) and
the pinned `node_modules/superdough/sampler.mjs` implementation. `samples` accepts
named URL maps, sample lists and a base URL; it can also fetch a JSON map. The
current worker does not expose this API. Merely exposing it in the audio frame
would not preserve the existing execution/network boundary.

The pinned sampler's module-private `loadCache` and `bufferCache` retain promises
and decoded buffers by URL without an eviction API. Revoking a blob URL does not
release that decoded buffer. A per-load byte limit alone therefore cannot bound
a long performance. Integration needs a cumulative resident-byte/count budget,
content reuse, and a clear capacity error that preserves playing audio. Include
failed attempts in the accounting where the upstream cache retains them.

`registerSound` replaces a global name in `soundMap`. Preparing a new bank under
existing names would change the previous pattern before Apply, and queued slices
can still belong to a retired pattern client. Use immutable internal bank names
and resolve each event against its own validated client's mapping; retain the
logical sound name for kick/event signals. Validate/download/decode before
activation. Saved source alone preserves URL text, not the original sample bytes;
portable assets need content identity and a reload/export policy as well.

These are inspected implementation constraints, not completed external-sample
support. The active soak continues against the unchanged fixed-bank artifact.

### Prepared live-provider capture

`node scripts/verify-algorave-provider.mjs --plan` prints the exact three prompts,
effective model names and limits without sending requests. `--self-test` passes
both real provider adapters and the shared handler with six fixture responses,
checking exact document targets and required edits. These are not live calls.

After owner authorization, `--live openai` or `--live anthropic` captures three
requests for that provider, using the original bundled groove and each preceding
data-validated candidate. It uses inherited credentials only, no tools, no private
project/chat, no retries, at most 4096 output tokens per request and a 30-second
handler deadline. The prepared models are `gpt-5.4-mini-2026-03-17` and
`claude-sonnet-4-6`. An existing live receipt prevents accidental repeat charges;
a failed request records the partial attempt and stops.

Receipts under `.algorave-preview/provider-<provider>.json` retain contexts,
proposals and candidates for subsequent local runtime/UI acceptance. A captured
reply is explicitly not compilation, musical quality or browser acceptance.
Live calls remain unauthorized until the owner approves this bounded test.

### Sample preparation implementation

`src/algorave/sample-assets.mjs` now supplies bounded sample fetching, immutable
content storage and WAV preflight. It is not yet connected to the music bridge,
sample-bank activation or persistence, so the app still exposes the original
three-sample bank. The running soak artifact is unchanged.

The initial remote policy accepts public HTTPS raw.githubusercontent.com files
with no credentials/query/fragment; requests omit credentials and referrers,
require CORS, reject redirects and stop after ten seconds. Both declared and
actual streamed bytes are bounded at 4 MiB. The content store uses SHA-256 IDs,
deduplicates identical bytes, returns copies and caps encoded residency at 32
files/16 MiB. This is not a decoded-audio memory claim.

WAV preflight accepts mono/stereo uncompressed PCM (8/16/24/32-bit) or float32,
8–96 kHz input and at most 30 seconds. It validates chunk bounds/alignment, RIFF
length, rate/block consistency and the single data chunk before decoding. The
decoded-memory reservation accounts for resampling to the supplied AudioContext
rate (8–192 kHz), rounding frames upward. Compressed, extensible and RF64 formats
remain unsupported by this bounded path.

`node --test scripts/verify-algorave-sample-assets.mjs`: seven groups pass for
malformed/oversized WAVs, resampling, URL policy, credential/referrer omission,
stream/declared limits, cancellation/stalled headers and body, known SHA-256,
concurrent deduplication, mutation isolation and byte/count capacity. These tests
use injected responses; no external sample was downloaded. Remaining integration
must enforce cumulative decoded residency, keep worker isolation, use immutable
bank mappings and persist/export content alongside its source references.

### Immutable audio sample-bank preparation

`src/algorave/sample-bank.mjs` prepares content-identified sample lists under
immutable internal names. A bank resolves logical sound names (including bank
prefixes) to its own registered names while preserving sample indices and other
controls. Preparing a different `bd` list cannot overwrite the old bank's `bd`.
The caller must keep using the logical name for musical-event signals.

One manager belongs to one audio frame. Defaults cap reservations at 32 assets,
64 list variations and 64 MiB of decoded PCM, including the target sample rate.
Content is hash-checked before loading. Identical lists/content share registrations
and buffers; failed decode/registration attempts retain their reservations and
are not retried silently. Closing revokes URLs and prevents late registration;
it does not claim to clear upstream's private decoded cache. Reclaim that cache
by disposing the audio frame, not by resetting the manager in a live frame.

The combined asset/bank Node checks pass 13 groups, covering bank isolation,
indices/prefixes, concurrent deduplication, caller mutation during preparation,
quota failures, content mismatch, failed-attempt accounting, unexpected decode
dimensions and closing during a pending decode. Audio loading/registration are
injected in these checks. Actual upstream-browser integration and project asset
persistence remain pending; this module is not yet wired into the playing build.

## Sample-enabled workspace checkpoint — 2026-09-15

Build `48aa463e6fd2` wires the asset and bank managers into the actual audio frame.
Add sample lives in the secondary project menu. It accepts a local WAV or a public
GitHub raw WAV URL and a logical name. Adding a sample validates/loads it before
activation, leaves a stopped project stopped, and preserves phase when playing.
An existing name can be replaced; exact Undo restores its old bank mapping.
Unknown sound names now fail preflight with an Add sample hint while retaining
the last working music. Lazy unknown names also stop safely through the existing
transport-error path.

Projects optionally contain a bounded `samples` map of names to SHA-256 IDs.
Sample bytes remain outside the agent context. The original three drums also use
the immutable bank manager; queued slices resolve against their own pattern
client, while event signals retain logical names such as bd. The audio frame's
32-asset limit includes those original drums.

IndexedDB stores content before the source record refers to it. Read/write
transactions merge new identities without overwriting existing content, enforce
the encoded byte/count limits against concurrent additions, and reject conflicting
bytes. Loading rechecks content hashes. Download project includes referenced
sample bytes in a versioned archive; Open validates its hashes/WAVs before
activation and starts stopped. Older sample-free project files keep their shape.
Archives are capped at 24 MiB; audio bytes are never sent in agent requests.

`npm run test:algorave-samples` passes 16 Node groups and actual Chromium coverage
of file import, upstream sample playback, missing-sound retention, phase-preserving
bank replacement, exact Undo, IndexedDB reload, metadata-only agent context,
exact-byte export, fresh-context restore and damaged-archive retention. URL import
uses a intercepted public-URL fixture with no credentials; this is not a live
GitHub download. The narrow modal screenshot was reviewed; controls and errors
fit 390×844. Preview, agent workflow, editor, worker and shared-entry browser
regressions pass serially. Native Safari sample behavior and a sample-enabled
long performance run are not yet verified.

## Completed baseline performance run

The unchanged fixed-bank build `869b21f502ab` completed 1800.008 seconds, 3600
scheduled kicks and repeated tempo/music/shader/layout edits. It kept one audio
epoch; maximum scheduled kick gap was 0.535715 seconds, signal-delivery gap
0.0734 seconds, and observed analyser silence 99.7 ms. Steady state retained one
worker (peak two during preparation), one WebGL program, two textures and three
sample blob URLs. Main-frame heap samples ranged from 8,293,568 to 11,288,676 bytes.
The terminal receipt is `.algorave-preview/soak-receipt.json`; the runner stopped
audio and closed its browser/server. This establishes the fixed-bank baseline,
not long-run acceptance of the subsequently changed sample path, acoustic glitch
freedom, whole-browser/GPU memory, native Safari or an external display.

## Native Safari sample startup and effects — 2026-09-15

A fresh local Safari tab imported the public WAV linked by the upstream sample
documentation (`tidalcycles/Dirt-Samples/master/bd/BT0AADA.wav` on GitHub raw).
This was an actual CORS download, not the Chromium route fixture. A pattern using
only that imported name produced nonzero audio texture data in a diagnostic GLSL
shader. Reload retained source/sample identity and stayed stopped, but subsequent
Play exposed an audio-startup stall in build `48aa463e6fd2`.

An early resume alone did not reliably fix repeated reloads. Final startup creates
the output graph and initializes built-in AudioWorklets before enabling Play.
Play/keyboard Run sends an early parent-window unlock, with the reply on the
private port, before reading IndexedDB or preparing the pattern. This initializes
audio without scheduling music on reload.

Safari also rejected Strudel's embedded data-script effects under the frame CSP.
A blob-URL adaptation failed CORS from the opaque frame and was removed. The
frame now allows data scripts for the bundled AudioWorklets. It remains opaque;
source workers remain blob-only, connect-src remains blob-only, and neither
credentials nor application storage is available to music code. Worker tests
check both directives exactly and verify IndexedDB denial in addition to the
existing private-state checks.

Native build `88267011bb90` passed repeated reload -> Play and reload -> keyboard
Run with the persisted sample and `.crush(4)`. The diagnostic output was green
while playing and black after Stop. Inspector confirmed AudioWorklets loaded.
The final `1c68b1666ee5` differs only by a comment clarification. The temporary
tab/server were closed; the original production tab was left intact. This is
local native evidence, not deployment, acoustic listening or external-display
acceptance. Chromium sample tests now exercise `.crush(4)` too; preview, worker,
workflow and entry regressions pass serially.

The updated soak harness alternates two imported sample identities under bd,
repeatedly applies bit crushing, and retains the previous music/shader/tempo
checks. Its new receipt is `.algorave-preview/sample-soak-receipt.json`, preserving
the completed fixed-bank baseline. It attempts a separate audio-frame CDP heap
measurement and records whether that scope is available.

### Sample-enabled 30-minute result — 2026-09-15

Session `64814` exited 0 after 1800.010 seconds on build `1c68b1666ee5`,
implementation commit `fb20e3c`. The browser and local server closed. Sixty
observations cover repeated imported sample replacement, `.crush(4)`, tempo/note
edits and shader changes. The receipt is
`.algorave-preview/sample-soak-receipt.json`, SHA-256
`7a9ad54d9dfaa255af096d470909e586fd1da47917ee5b8ab37e68dd8ab0b362`.

The transport retained one epoch through 3599 scheduled kicks. Maximum kick gap
was 0.535715 seconds, maximum signal delivery gap 82.900 ms, and maximum analyser
silence 201.200 ms. There was one steady worker (two during replacement), one GL
program, two textures, five audio blob URLs and a history capped at 20. Main-frame
heap ranged from 8,593,396 to 11,786,428 bytes; its post-warmup spread was
2,262,740 bytes. All harness thresholds passed.

Separate audio-frame CDP heap measurement was unavailable and is recorded as
false/null, not zero memory use. Decoded-buffer limits have separate unit/browser
evidence; this result does not measure whole-process or GPU memory. It establishes
the planned local sustained-edit run, not acoustic listening, physical display
latency, native Safari endurance or live-provider quality.

### Native Safari external display — 2026-09-15

The Mac reported its built-in display and an online, non-mirrored PHL 241B7Q at
1920×1080 logical resolution / 60 Hz. A fresh local origin on port 53828 loaded
visible build `1c68b1666ee5`, stopped. The temporary tab was separated with
Safari's Move Tab to New Window, then moved with Move to PHL 241B7Q. After the
checks, Safari's menu offered Move to Built-in Retina Display, confirming the
test window remained on the external display.

Play, code-plus-output fullscreen, editing Strudel and Cmd+Enter Run succeeded.
The editor showed the changed 32-cpm source and Music updated status. Escape
returned to the window while the Stop control remained available. Output-only
fullscreen filled the display after Safari's transition; successive screenshots
showed different rendered ring/color frames. Escape and Stop returned the visible
Stopped state. The temporary window and server session `73932` were then closed;
the original production project window remained intact.

This verifies visible local external-display operation, not projector-distance
readability, acoustic quality, production deployment or every macOS Spaces
configuration. Hidden/minimized documents may have animation frames throttled or
suspended; continuous visual output requires the presentation window to remain
visible. No independent background-output window or hidden-rendering guarantee
is claimed. Live-provider end-to-end acceptance remains separate.

### Authorized live provider test — 2026-09-15

The owner's explicit instruction to test with existing keys authorized the
prepared bounded capture. Existing Keychain API keys were passed only through
child-process environment, never source, logs or arguments. OpenAI
`gpt-5.4-mini-2026-03-17` and Anthropic `claude-sonnet-4-6` each completed all three
requests: syncopated bass, kick-reactive tunnel, coordinated darker music/colors.
Six total requests, max 4096 output tokens each, zero retries. Captures are
`.algorave-preview/provider-openai.json` and `provider-anthropic.json`.

All replies passed the actual gateway proposal contract, revision and scope
checks. A serial Chromium runtime check on build `1c68b1666ee5` activated all
six candidates, allowed playback for 2.5 seconds per candidate, checked nonzero
audio analysis, and verified exact restoration of the preceding project through
Undo. Both providers passed all three cases. Runtime receipts are adjacent
`provider-openai-runtime.json` and `provider-anthropic-runtime.json`. The first
local harness attempt accessed frequency before the first signal and failed;
an optional-chain guard corrected that harness race. No API call was repeated.

This proves existing API keys authenticate and real generated Strudel/GLSL
candidates compile and play. It does not establish acoustic quality, native
Safari execution of these replies, or the full visible chat sequence. In
particular, OpenAI's generated shader uses reversed smoothstep edges, so
successful compilation is not a blanket shader-portability assurance. Captures
remain original evidence; no generated source was silently repaired.

### Captured real replies through Chromium UI

`node scripts/verify-algorave-provider-ui.cjs` passed for both providers. The
local server requires the exact captured request and source, validates revision
and candidate, and rebinds only the request ID. No API calls occur. Each of the
six replies traversed chat submission, visible proposal, Apply, exact UI Undo,
re-Apply and final save/reload without autoplay. An initial harness reused a
stale status string while applying; it now waits for the matching response and
exact applied candidate. Both complete sequences then passed. `--serve openai`
or `--serve anthropic` exposes the same replay for native Safari verification.

The owner's expanded parity requirement remains unproven. Current source
explicitly excludes executable/stateful output callbacks and custom audio nodes;
its sample path is not Strudel's full samples()/bank ecosystem. Shader channels
currently allow only audio and A-D buffer references, with sampler2D uniforms.
External textures/video, cubemap and VR passes are absent. These are concrete
implementation gaps, not items that passing candidate compilation can close.

### Display resolution and channel clock parity

The shader runtime no longer reduces every output to at most 1920×1080. It uses
the requested size constrained by the device's MAX_TEXTURE_SIZE,
MAX_RENDERBUFFER_SIZE and MAX_VIEWPORT_DIMS. This preserves gl_FragCoord and
iResolution at higher display sizes rather than silently changing shader scale.
Lost/disposed contexts are rejected before querying device limits.

Shadertoy's [input reference](https://www.shadertoy.com/view/XsfcWj) defines
iChannelTime for video/sound inputs. The runtime now advances this uniform only
for its audio channel; buffer and absent inputs remain zero. Preview tests render
at 2560×1440 and use independent expected RGBA pixels to check resolution and
three distinct channel clocks. Build `668ca3b9634e` passes those and the existing
feedback, resize, mouse, context recovery and audio checks. The first expanded
test left the canvas at the next test's destination size; restoring a distinct
size fixed that test setup, without weakening resize-invalidation coverage.
The earlier 30-minute receipt predates this rendering change and is not a
high-resolution performance result. Other channel/pass/music parity gaps remain.
