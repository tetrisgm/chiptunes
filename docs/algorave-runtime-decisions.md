# Algorave runtime record

## Current upstream runtime — 2026-09-15

Scope update: the owner explicitly excluded VR on 2026-09-15. Earlier checkpoint
references to remaining VR work are historical and no longer apply.

The current build executes upstream @strudel/web 1.3.0 evaluation, scheduling and
Web Audio together in the opaque-origin sandbox. It replaces the serialized
pattern worker and custom transport. Source is parsed during preparation and
executed exactly once on Apply; executable onTrigger closures, registerSound,
samples() and dough() retain their upstream JavaScript behavior. The output tap
observes normal AudioContext destination connections, including custom nodes.
No provider credentials, parent DOM, localStorage or IndexedDB are available in
the music frame. HTTPS sample loading uses browser CORS and the frame CSP.

Failure restores the last pattern, tempo, playing state and sound registry. Undo
keeps bounded runtime registry checkpoints alongside source history. Immutable
portable sample aliases survive registry restoration. Manual Run Undo restores
the focused editor's prior applied source while preserving unrun work in the other
editor; Agent Undo retains drafts that preceded its proposal. Opening a project
parses and restores assets but defers source execution until Play. Stop cancels a
pending asynchronous evaluation and prevents it from restarting playback later.
Scheduled upstream diagnostics, including missing sounds, appear in the status
area; missing sound names are no longer rejected by a custom preflight query.

This is full upstream execution, not complete strudel.cc ecosystem parity yet.
The reference REPL's default banks, soundfonts/ZZFX and xen tuning are now
integrated (see the sound-library checkpoint below). Additional input/drawing
scope remains open. Four original programs now play in
both unmodified upstream and the workspace: core synth/mini-notation, custom
Web Audio sound, onTrigger closure and samples() loading a local CORS WAV. This
closes the three demonstrated failures recorded below, not every parity gap.

There is no terminable worker around evaluation now. An infinite JavaScript loop
can block the frame/event loop; asynchronous cancellation cannot preempt it.
General JavaScript/network side effects and in-place mutations of arbitrary
objects are not fully reversible through source/registry Undo. The retired worker
verifier fails immediately with a pointer to `test:algorave-runtime`, avoiding its
infinite-loop fixtures against the new architecture. Earlier worker isolation,
30-minute soak and native browser receipts below do not cover this replacement.

Chromium verification now explicitly selects the Web Audio silent sink through
`scripts/algorave-browser-audio.cjs`. Real synthesis, scheduling and analyser data
continue, but these checks make no speaker assertion. Set
`ALGORAVE_AUDIO_DEVICE=default` for actual default-device checks. This test helper
is absent from production and native Safari. Repeated headless default-device
runs observed a suspended clock at zero; unmodified upstream also reported an
audio-device/WebAudio-renderer error. No service restart or infrastructure repair
was attempted. Native/default-device acceptance remains open.

The new test entry is `npm run test:algorave-runtime`. Sample persistence and exact
Run Undo, captured OpenAI/Anthropic chat → Apply → Undo → re-Apply → save/reload,
four-program differential checks and agent contract/35 legacy chat groups passed
on build `3d78fc0bf069`. The six saved real replies were reused with zero new API
calls. Runtime/preview/workflow checks passed again after rebuilding that exact
preview. All 16 sample unit groups passed. The source archive reproduced both
browser bundles byte-for-byte with a fresh npm ci. Owned-source whitespace checks
pass; generated upstream template-literal whitespace is intentionally preserved.

Native Safari replay on visible local build `3d78fc0bf069` passed all three
captured OpenAI replies: bass, kick-reactive tunnel, and paired darker music/blue
visuals. Each proposal remained unapplied until Apply; Undo visibly restored its
previous source(s). The music case included Stop → Play → one Undo. The saved
post-Undo project reloaded with its bass source and tunnel output, showing Play
and Ready without autoplay. Native Safari reported audio output, and screenshots
showed the tunnel/color changes. There was no silent-sink injection, but no acoustic
listening or latency measurement is claimed. Native input automation had clipboard
timeouts and one incomplete prompt; exact text was inspected and replayed without
any provider call. The temporary tab and local server were closed. Anthropic native
replay on this replacement and final public/browser acceptance remain pending.

The build follows upstream web.mjs source dependencies to preserve complete
notices and corresponding source (81 packages), rather than hiding transitive
inputs in a prebundle. See [distribution](algorave-distribution.md).

Shadertoy still needs media lifecycles,
Sound and VR support. Volume inputs and Cubemap output are now integrated (see below). HTTPS image textures,
sampler settings, keyboard and local image imports are covered by the newer checkpoints below. Image/Common/A-D,
floating-point feedback, standard uniform and high-resolution checks are a
starting point. Finish native and Chromium acceptance on the final build and the
new-runtime performance run, then deploy the authorized static site and gateway
together. No public deployment has occurred.

## Standard sound libraries — 2026-09-15

The runtime now registers Strudel's standard piano, VCSL, drum-machine, uzu drum,
wavetable and mridangam catalogs, its Dirt subset and drum-machine aliases. It
uses the same public CDN bases as upstream prebake.mjs. Catalogs load once at
startup; actual sound bytes load through upstream on demand. Each catalog fetch
has an eight-second deadline. Failed catalogs produce a visible diagnostic while
local synths, portable imports and original fallback drums remain usable. When
online, the normal bd/sd/hh names use upstream's uzu bank; the fallback does not
replace or rename those sounds. Registry Undo snapshots are taken after prebake.

@strudel/soundfonts 1.3.0 registers GM instruments and exposes its ordinary source
APIs, including setSoundfontUrl/loadSoundfont and .soundfont(). ZZFX is registered
through upstream. The REPL piano helper preserves its default clip, release and
pitch-aware pan. @strudel/xen 1.2.6 supplies edo/xen/tuning and Pattern.tune, with
no new language or note translation. Agent guidance, editor help and sound credits
now describe the available banks. Source/notice delivery includes these packages
and the preferred sfumato TypeScript source missing from its npm distribution.

`test:algorave-default-sounds` verifies catalog/alias registration, piano control
values, 19-EDO frequencies and actual playback from each sound family. The live
portion uses real CDN audio and GM font responses; a separate blocked-CDN fixture
checks the visible startup diagnostic and local synth recovery. It uses the
Chromium silent sink and is not an acoustic or native Safari assertion. The
initial nine-family sound check passed on 796453bf744f; preview, workflow, sample
persistence, all six saved real reply UI flows and agent/35 legacy chat groups
also passed on that build. All ten families, including microtonal tuning, plus
runtime cancellation/isolation/Undo passed on ac0fff50d0c8. The final editor/help
build 92b46347ca27 passed exact archive rebuild, editor keyboard/completion/import
checks and agent/35 legacy chat groups. The editor suite used the default audio
device and measured signal for its examples; this does not establish acoustic
quality or broad native acceptance. All browsers and local test servers closed.

Upstream website/src/repl/util.mjs additionally loads draw, edoScale, codemirror
helpers, hydra, serial, csound, tidal, gamepad, motion, mqtt, mondo, dough, MIDI and
OSC modules. Inventory their user-facing APIs and integrate the remaining runtime
scope with appropriate browser/device boundaries. The unpublished @strudel/edo
package is now integrated from pinned source (see the EDO checkpoint below). Native bank acceptance,
new-runtime soak, Shadertoy inputs/passes and public site/gateway deployment still
remain. This library checkpoint does not establish full parity by itself.

## EDO scale module — 2026-09-15

The music evaluation scope now includes upstream `edoScale`, both as a standalone
function and the Pattern method. Ordinary Strudel source such as
`n("0 2 4 6").edoScale("A3:LLsLLLs:2:1").s("triangle")` executes without
translation. This is the REPL's scale-degree mapping, separate from xen's
equal-step tuning API. It preserves upstream frequency rounding, pattern timing,
other controls, and scale metadata. No additional scale validation was inserted;
an invalid string does not necessarily throw synchronously in upstream.

The unpublished package is vendored unchanged from commit
`8f81463b9cb5ddd5f117ed7baef6a1fde9445dc2`, with its tests, metadata, original
license and Git blob hashes. See the [distribution record](algorave-distribution.md).
The REPL module inventory was re-read from
[upstream util.mjs](https://codeberg.org/uzu/strudel/src/commit/8f81463b9cb5ddd5f117ed7baef6a1fde9445dc2/website/src/repl/util.mjs).

`test:algorave-edo` checks every copied file against its upstream Git blob hash,
then checks exact scheduling and independently calculated 12/16-EDO frequencies,
both source API forms, retained controls/context, colon-notation playback, Undo,
and stopped reload. Chromium uses the explicit silent sink for DSP checks.
These tests do not establish native speaker acceptance or full REPL parity.

Build `5d59d4f4f9c2` passes EDO, upstream runtime, workflow, agent contract and
all 35 legacy chat groups. Its source archive rebuilds both browser bundles
byte-for-byte with a fresh npm ci and includes the EDO notice/provenance files.

Native Safari on that visibly identified local build replayed all three captured
Anthropic replies: bass, kick-reactive tunnel and paired darker music/palette.
Each waited for Apply; Undo visibly restored the preceding source(s). The bass
case also passed Stop → Play → one Undo. Screenshots showed the tunnel replacing
the rings and Undo restoring them. Safari showed its audio-output indicator;
there was no silent-sink injection, acoustic listening or latency measurement.
The paired capture's cosine palette still cycles through warm colors despite its
blue/violet explanation: this proves edit-flow behavior, not color fidelity.
The agent guide now calls for mixing explicit colors for a restricted palette,
and no longer incorrectly says external image textures are unsupported. New
provider output under that guidance is unverified, so color fidelity remains
open. After a temporary computer-use app-change
guard interruption, Save → reload also passed: the restored bass source and
tunnel returned with Play/Ready and no autoplay. The temporary tab was closed.
No new provider call was made.

The subsequent drawing checkpoint below makes the music canvas visible and
handles Run/Undo/Stop. Inline editor widgets and the remaining REPL modules,
Shadertoy inputs/passes, native acceptance, soak and deployment remain in scope.

## MIDI input/output — 2026-09-15

Published `@strudel/midi` 1.3.0 now shares the installed Strudel core and Web Audio
engine. Its `.midi()`, `midin()`, `midikeys()`, maps and controller helpers are in
the music evaluation scope. The only upstream source change resolves the broken
monorepo-relative `scheduleAtTime` import to the installed `superdough` package;
`src/algorave/vendor/midi/UPSTREAM.json` records original hashes and the change.
The exact dependency is locked and the modified preferred source and license
are included in the source archive/notices.

The opaque frame delegates browser MIDI permission without changing its origin
or application isolation. No permission is requested merely by loading a project;
MIDI expressions trigger the upstream request. Permission denial reaches the
existing status area. Stop uses the existing `strudel-stop` event to send MIDI
Stop, and reload retains source without activating ports.

`node scripts/verify-algorave-midi.cjs` passes on `fbc2ea1f320f`: actual secure
Chromium API/permission policy and denial, then simulated MIDIAccess ports through
unmodified WebMidi message conversion. It checks channel/velocity/note bytes,
CC values, scheduled note-off, channel-specific controller input, keyboard input,
Run/Undo output changes, Stop and stopped reload. It checks the one-line source
difference against the published module. No real device is enumerated or sent
messages in this test. Physical devices, hot-plug behavior and acoustic output
have not been verified. Upstream midikeys retains its fixed-duration limitation.

Native Safari on the same local build displays “Your Browser does not support
WebMIDI.” for `note('c3').midi()`. Replacing it with a normal sine pattern and Run
recovers to Stop/Music updated; Stop/reload retains that source with Play/Ready.
The owned native tab and temporary listener were closed. This is browser fallback
verification, not a claim that Safari supports MIDI or a production-origin test.

The upstream runtime regression, six captured real-provider UI replays (zero new
API calls), agent contract and source-archive rebuild checks also pass. This is
a module checkpoint; remaining Strudel/Shadertoy scope and public deployment
remain open.

## OSC output — 2026-09-15

The music scope now exposes the unchanged published @strudel/osc 1.3.2 module,
including .osc(), oscTrigger and parseControlsFromHap. Its dependency is the same
@strudel/core 1.2.6 used by this runtime. Current repository-main OSC source instead
requires newer Web Audio clock APIs absent from the published audio package; the
published matching module is used without approximating those APIs. The build
bundles its preferred osc.mjs source, and the corresponding source archive also
contains its server.js. No OSC bridge or persistent service is installed/started.

The module opens ws://localhost:8080 only when an OSC pattern triggers. Its
/dirt/play payload, control conversion, destination fields and clock-collated
Unix-millisecond timestamps retain upstream behavior. External SuperDirt/
SuperCollider setup remains the same prerequisite described in
[Strudel's OSC documentation](https://strudel.cc/learn/input-output/).
A source Undo changes future events; it cannot retract already transmitted
messages or reverse state in external instruments.

The opaque frame retains sandbox=allow-scripts. Its CSP admits that fixed loopback
WebSocket endpoint, and its allow policy delegates the browser's loopback-network
and legacy local-network-access permission. This does not grant permission on the
user's behalf. Chromium's denial was observed as
ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS; granting permission to the top-level
test origin allowed real traffic from the opaque frame. See the
[Local Network Access specification](https://wicg.github.io/local-network-access/).
Asynchronous rejected trigger promises now reach the status area, including a
bridge/browser-permission hint for an unavailable OSC connection.

Build `324ab00cd821` passes `test:algorave-osc`: actual secure-page WebSocket
traffic to a temporary loopback receiver, opaque origin, control conversion,
timestamps/destinations, denied permission with no traffic followed by a granted
permission, connection reuse/reconnect, Run/Undo note changes, Stop, deferred
reload, resumed output and visible unavailable-bridge errors. The test binds its
own receiver before playing; if port 8080 is occupied it fails without connecting
to the existing service. It never forwards UDP or drives a synthesizer.
Runtime isolation/cancellation/rollback, all six real captured provider UI flows
and the agent contract also pass. No new provider calls were made.

Native Safari on local visible `324ab00cd821` sent the original c3/e3/g3/b3
pattern to that temporary receiver, changed to c4/e4/g4/b4 with Run, then restored
the prior source and transmitted notes with Undo. Receiver logs confirmed the
changes. Stop and reload produced no further messages; reload retained source
with Play/Ready. The temporary native tab and both local listeners closed.
This proves local Safari and secure Chromium integration, not physical synth
output or final production-origin permission acceptance. Full remaining scope
includes other Strudel REPL modules, shader media/Sound/VR and public deployment.

## Gamepad pattern inputs — 2026-09-15

The music scope now exposes the unchanged upstream @strudel/gamepad 1.2.6 module
from commit `8f81463b9cb5ddd5f117ed7baef6a1fde9445dc2`. `gamepad(index)` returns
ordinary Strudel patterns for axes, bipolar axes, analog button values, button
toggles and sequence gates. Both named aliases and indexed buttons work directly
in musical controls. Source, metadata, README, license and Git blob hashes ship
in the corresponding-source archive; the notice inventory now has 87 packages.

The opaque music frame explicitly delegates the browser Gamepad feature while
retaining its existing sandbox and no parent storage/DOM access. The upstream
module polls through navigator.getGamepads when its patterns are queried; it does
not start a separate polling timer. Controller event listeners and toggle state
retain upstream page/module lifetime. Source Undo does not rewind physical input,
toggle history or arbitrary JavaScript side effects. Browser support and controller
availability still determine actual hardware access.

Build `d2c1aff761a4` passes `test:algorave-gamepad`: pinned-file hashes, actual
Chromium permissions-policy/native API access in the opaque frame, simulated
independent controllers, unipolar/bipolar axes, analog values, toggle edges,
sequence aliases, musical pan/gain and scheduling, Run/Undo, stopped reload, and
playback after removing the simulated input. The initial sequence fixture used
up instead of down; correcting its index required no upstream source change.
Runtime cancellation/rollback/isolation and agent/35 legacy chat checks pass.
These checks use a silent Web Audio sink; no physical-controller, native Safari
controller or acoustic acceptance is claimed. Remaining REPL modules, inline
widgets, Shadertoy scope, final native acceptance, soak and public deployment
remain open.

## Visible Strudel drawing — 2026-09-15

Upstream pianoroll, scope/fscope/spectrum, punchcard, spiral, pitchwheel, draw and
animate now render below the music editor, without modifying GLSL. The isolated
music frame is revealed only when source creates a drawing. Only a boolean
visibility message crosses into the parent; callbacks and DOM stay in the opaque
frame. The draw module is exposed in the normal source evaluation scope.

Drawing callbacks, accumulated haps, theme and canvas nodes are checkpointed
before evaluation. The previous image stays visible as a frozen canvas copy
during asynchronous evaluation. On failure, the original canvases/callbacks are
restored without evaluating the old source again. On success, retired canvases'
resize listeners are released. Stop pauses both drawing and shape-animation
callbacks; Play evaluates the current source normally. Open remains deferred and
stopped. Undo reconstructs the restored source once, like music Undo.

onPaint functions use upstream Drawer with the scheduler's haps and painters.
Shape animations read current dimensions on each frame so first activation from
a hidden frame and subsequent resizing do not lock them to zero/stale dimensions.
These are lifecycle additions to the pinned draw package; original sources and
hashes are preserved as described in the [distribution record](algorave-distribution.md).

`test:algorave-drawing` exercises all seven standard drawing methods, cyan-pixel
output from a first-run shape animation, original-file hashes, failed async Run
with retained pixels/canvas/callbacks, source execution counts, removing drawings
and Undo, Stop/Play, deferred Open, animation stop and narrow layout. These are
Chromium checks with an explicit silent audio sink; native/public acceptance is
separate. Inline underscore widgets, editor highlighting/markcss integration,
and other upstream REPL modules remain unfinished. This checkpoint does not
establish full Strudel parity or general JavaScript side-effect reversibility.

Build `b7a618362b2a` passes drawing, runtime and workflow checks, the exact-source
archive rebuild, both providers' six captured Apply/Undo/re-Apply/reload cases,
and agent contract checks. Editor/preview checks passed on the preceding drawing
build `ac3bc95d381f`; later changes add retained pending pixels and unconditional
drawing rollback after audio restoration. No new provider calls were made.

Native Safari on the visibly identified local `b7a618362b2a` rendered the cyan
shape animation as its first drawing and then a labeled c3/eb3/g3/bb3 pianoroll.
Screenshots show both beneath the music editor alongside the separate GLSL rings.
Safari reported audio output for the pianoroll, without silent-sink injection;
no acoustic or latency measurement is claimed. The active Safari tab changed
during further checking, so native scope/Undo remains pending. Only the temporary
test tab was closed and its replay server stopped. Final public acceptance and
the new-runtime soak remain open.

## Upstream performance harness — 2026-09-15

The sustained harness now uses the same explicit Chromium silent sink as the
other upstream-runtime tests and records that scope in its receipt. It alternates
pianoroll/scope while replacing the playing bd sample, editing tempo/notes and
changing GLSL/layout. It also counts live GL samplers and drawing canvases, in
addition to textures/programs, blob URLs, workers, history, analyser silence,
scheduled kicks, signal delivery and heaps. Audio remains real Web Audio DSP;
`acousticAcceptance` is explicitly false.

Receipts use `.algorave-preview/upstream-soak-<seconds>s-receipt.json`, preserving
the old sample-worker receipts. Runs below 1800 seconds only validate the harness.
The 30-second check on `d793b1d18718` passed with 57 scheduled kicks, maximum kick
gap 1.036 seconds, signal gap 0.046 seconds, and analyser silence 0.102 seconds.
It retained one program, three textures, four samplers, one drawing canvas and
four audio-frame blob URLs, with no workers. This first iteration exercises the
pianoroll; sustained alternation still requires the full run. A separate audio
frame CDP heap session is unavailable in this browser configuration; that scope
remains explicitly unmeasured. The 30-minute run and acoustic/native acceptance
are not established by the short check.

The full 1800-second run on `d793b1d18718` subsequently passed and exited cleanly.
Its receipt records 3599 kicks in one epoch, maximum kick gap 0.536 seconds,
signal gap 0.115 seconds and analyser silence 0.200 seconds. Post-warmup observed
main-frame heap range was 10.31 MiB. Final resources were three textures, one
program, four samplers, one drawing canvas and five audio-frame blob URLs;
history reached its bound of 20 and no workers were created. Stop and browser/
server cleanup completed before starting the next shader suite. This establishes
the sustained DSP/resource check for that build, not separate audio-frame heap,
speaker quality or later shader additions. Receipt:
`.algorave-preview/upstream-soak-1800s-receipt.json`.

## External audio inputs — 2026-09-15

`{type:'music',src:...}` supplies an audible looping external audio file, from
HTTPS or the portable asset store. `{type:'mic'}` supplies microphone analysis
without speaker monitoring. Both use a 512×2 R8 texture: the first row contains
512 bins from a 2048-sample FFT; the second contains byte waveform values centered
at 128. Channel time/resolution and the analysis context's sample rate are exposed
through the standard GLSL uniforms. Audio file and Microphone choices remain
inside the Channels disclosure.

Loading uses OfflineAudioContext decoding and makes no live context or permission
request. Play unlocks one shared analysis/output context from the user gesture.
Files pause/resume at their previous offset and identical inputs are shared across
passes and source edits. Stop stops file nodes and all microphone tracks; late
permission responses after Stop are released. Projects save encoded audio bytes,
never microphone recordings or device IDs. Existing 16 MiB per-file/64 MiB asset
limits apply, plus 32 million decoded samples across active file inputs. Browser
codec support still determines which encoded files decode.

`node scripts/verify-algorave-audio-input.cjs` passes on `4a5ca1bf34ea`. Original
1000 Hz WAV data verifies offline decode, portable bytes, actual frequency-bin and
waveform values, GL row data, time, pause/resume and shared live edits. Full Chromium
uses fake audio-device/file flags for permission denial/grant and microphone data;
Stop and late-result cleanup leave all tracks ended. Workspace checks cover local
file input, channel Run/Undo and stopped reload. Camera regression and six captured
real-provider UI replays also pass, with zero new provider calls. Chromium output
uses the explicit silent sink, not acoustic verification.

Native Safari on the same local build opened the audio project stopped and showed
its spectrum-driven color after Play. A separate original oscillator stream drove
the microphone texture; live GLSL Run and Undo kept requests/live tracks at 1/1,
Stop changed that to 1/0, and reload showed 0/0 with Play/Ready. The native `--serve`
harness substitutes the microphone request and mutes the final speaker path;
this is native signal-processing/UI evidence, not physical microphone permission
or speaker-quality evidence. Its owned tab and temporary listener were closed.

Reference: [Web Audio analyser specification](https://webaudio.github.io/web-audio-api/).
The existing Strudel signal bridge still uses a 1024-sample FFT; reconcile its
frequency-axis contract with these external inputs during final visual acceptance.
Sound output and remaining Strudel integrations are still open; VR is excluded.

## Camera texture input — 2026-09-15

`{type:'webcam'}` now supplies a standard sampler2D camera texture, channel
resolution/time, flip, sRGB and sampler settings. Camera is an option inside the
existing Channels disclosure; its descriptor contains no URL, device ID or image
bytes. Only Play requests browser permission, with audio disabled. Stop releases
all capture tracks. Loading/preparing/opening a project does not request capture.
Frames remain local to WebGL and are not included in project or agent payloads.

Camera ownership is shared across pass/sampler variants and unchanged inputs
retain the stream across live shader edits and Undo. Discarded candidates do not
start capture. Late permission results after Stop/disposal are immediately
released. Permission denial is reported once, with an explicit Stop/Play retry;
ended tracks, graphics-context loss and runtime disposal release capture too.

`node scripts/verify-algorave-camera.cjs` passes on `9c8e3981729b`. It uses full
Chromium (`channel: 'chromium'`) with a generated Y4M capture fixture; the lightweight
headless shell returns NotSupportedError even with fake-device flags. Tests cover
actual browser permission denial/grant and capture, GL pixels/flip, shared streams,
Run/rollback continuity, late-result cancellation, Stop, context loss/disposal,
workspace channel Run/Undo and stopped reload. No physical camera/microphone is
used. The video regression and six captured provider UI replays also pass; the
provider checks make zero additional API calls.

Native Safari on the same local build displayed a genuine camera permission
prompt, which was declined; the app displayed the denial without activating a
camera. The separate `--serve` harness replaces only the camera-request call in
its served workspace with an original canvas stream and displays request/live
track counts. In that harness, Open/reload showed 0 requests/0 active tracks;
Play showed moving colors and 1/1; a live inverted-color Run and Undo kept 1/1;
Stop changed to 1/0. This proves Safari media-stream/WebGL/UI behavior, not actual
hardware capture or a granted Safari camera permission. An initial deferred music
Open timed out; reloading the test tab and reopening succeeded after other browser
checks had finished. The owned Safari tab and temporary servers were closed.

Reference: [Media Capture and Streams](https://www.w3.org/TR/mediacapture-streams/).
External audio inputs and Sound output remain open; VR is explicitly excluded.

## Video texture inputs — 2026-09-15

Video channels now accept HTTPS URLs or portable imported assets, with standard
sampler2D GLSL, real iChannelTime and iChannelResolution, flip, sRGB, filtering and
wrap settings. The existing Channels disclosure has a Video choice and URL/file
controls. Videos loop silently while Play is active and pause on Stop. Loading or
opening a saved project never starts video playback. Browser codec support applies;
MP4, WebM and Ogg containers are accepted, with the existing 16 MiB file bound.

The loader fetches without credentials/referrers, validates decoded dimensions,
and releases temporary blob URLs/decoders on cancellation or failure. Media has
reference-counted ownership across prepared textures and retained transactions.
Unchanged video inputs retain playback position across shader edits. Failed
activation restores the old media; context loss/disposal releases decoders before
recovery. Imported video bytes share the immutable asset store and portable
archive with image/volume inputs.

`node scripts/verify-algorave-video.cjs` passes on `0555234bba84`. It generates an
original four-second H.264 fixture with ffmpeg and checks actual decoded GL pixels,
seek/play/pause, flip/mips, channel uniforms, shared multipass media, transactional
position retention, failed shader retention, context loss/recovery and disposal.
Workspace checks cover portable Open, local file input, channel Run/Undo, download,
stopped reload and narrow layout. This is an MP4 fixture test, not proof that every
codec/file plays in every browser. Chromium audio uses the explicit silent sink.

Native Safari on `24e6f3e0af9a` imported the original portable MP4 project, showed
the red/blue first frame stopped, advanced to green/blue with Play, applied an
inverted-color GLSL edit and restored the original shader/output with Undo.
Final `19396882d9c7` also loaded the saved first frame with Play/Ready. Native
verification was local; its owned tab and temporary listener were closed.
Volume/image regression checks and six captured real-provider UI replays (zero
new API calls) pass. Camera/external audio inputs and Sound output remain open;
VR is excluded by the owner's request.

References: [WebGL video upload rules](https://registry.khronos.org/webgl/specs/latest/1.0/)
and [Shadertoy channel-time declaration](https://www.shadertoy.com/view/MtV3W1).

## Volume texture inputs — 2026-09-15

Channels now offers Volume texture with HTTPS or local `.bin` input. The renderer
provides sampler3D without changing the GLSL language; texture, textureLod and
texelFetch operate on real WebGL 3D textures. iChannelResolution includes depth.
Unsigned-byte R, RG, RGB and RGBA data use tightly packed rows, including odd
widths. Per-channel nearest/linear/mipmap filtering and S/T/R wrap apply normally.
Vertical flip reverses rows within each depth slice; sRGB conversion preserves
missing-channel defaults and alpha. Shared assets allocate one texture across
passes; cube, 2D and volume samplers can coexist in the same shader.

The file layout is `BIN` plus newline, four little-endian uint32 values for
width/height/depth/components, then x-fastest unsigned-byte voxels. This follows
the [volume reader in Tellusim's Shadertoy renderer](https://github.com/Tellusim/Shadertoy/blob/main/main.py)
and the [reported Shadertoy file header](https://shadertoyunofficial.wordpress.com/2019/07/23/shadertoy-media-files/).
Direct Shadertoy asset requests returned 402/403, so current hosted preset files
were not downloaded or used as parity evidence. Fixtures are original 3D grids.

Volume bytes use the existing immutable visual-asset store and portable archive.
Validation rejects a bad signature, unsupported component count, zero/overflowing
dimensions, truncated/trailing bytes and files over 16 MiB. Images and volumes
share the existing 32-file/64-MiB collection bound. CPU/GPU volume totals count
voxels, with a 64-million pixel/voxel combined bound and the actual device's 3D
texture dimension limit. Failed preparation retains the current passes; rollback,
context recovery and disposal follow the existing image lifecycle. A volume file
cannot be imported as an image (or vice versa) through the channel picker.

Build `6e2c54863c46` passes `test:algorave-volume`: byte/header/archive validation,
all eight voxel corners, R/RG/RGB/RGBA row alignment, interpolation/mipmaps/depth
wrap/sRGB, uniforms, mixed/shared passes, failed download retention, rollback,
context recovery/disposal, actual local picker import, Run/Undo, download, fresh
profile Open, stopped reload and narrow layout. Image input, cube-image input,
Cube output, image persistence and all six captured provider UI flows also pass;
agent and image archive unit checks pass. These are zero-provider-call checks.

Native Safari on visible local `6e2c54863c46` opened the portable volume archive,
rendered a magenta voxel, changed Flip vertically via the channel controls and
Run to produce white, then restored magenta and the unchecked setting with Undo.
Reload retained magenta with Play/Ready. The temporary native tab/server closed.
Full parity still requires media channels, Sound/VR and remaining Strudel modules,
followed by final acceptance and the authorized public site/gateway deployment.

## Cubemap output pass — 2026-09-15

The optional `Cube` source document appears as Cubemap A in the existing pass
selector. It uses `mainCubemap(out vec4, in vec2, in vec3, in vec3)` and supplies
pixel coordinates, zero ray origin and a normalized direction for each cube face.
Common and the usual uniforms remain available. A `Cube` channel reference or
`{type:"buffer",source:"Cube"}` declares samplerCube. Static six-face image inputs
remain a separate channel type; neither requires a different shader language.

Two RGBA16F cube targets retain negative/HDR data and previous-frame feedback.
Each face is 1024 square, reduced only by the device's cube/renderbuffer limit.
Display resize preserves the cube targets. Pass order is A–D, Cube, Image; earlier
inputs use the current frame, self/later inputs use the previous frame. All six
faces finish before the new cube becomes visible to Image. Filtering and mipmaps
use the existing per-channel samplers. Compile failure, retained transactions,
context recovery and disposal share the existing pass lifecycle.

The direction construction inverts the cube selection coordinates documented by
[OpenGL ES 3.0, table 3.21](https://registry.khronos.org/OpenGL/specs/es/3.0/es_spec_3.0.pdf#page=164).
Shadertoy's how-to and runtime source returned 402/403 during this checkpoint;
there is no claim of a live differential test against its current renderer.

`test:algorave-cube-output` covers original GLSL fixtures for axes and off-axis
orientation, Common/uniforms, HDR values, mipmaps, mixed cube/2D dependencies,
self-feedback, resize, failure retention, transaction rollback and context loss.
It also exercises agent pass creation, the real editor's Run/Undo, portable Open,
download, stopped reload and narrow layout. It passes on `e5092eb0e567`, alongside
cube-image inputs, the existing runtime/feedback preview suite, both providers'
six captured real chat/Apply/Undo flows, image archive unit tests and agent checks.
The exact source archive rebuild reproduces both browser bundles. No new provider
calls were made. An initial framebuffer allocation check exposed that all six
faces must be allocated before checking completeness; this is fixed. A verifier
read of the contenteditable editor was corrected to use its visible text.

Native Safari on the visibly identified local `e5092eb0e567` opened the original
project through the macOS picker, displayed its green +Y sample, selected Cubemap
A, edited and ran the cube source to produce purple, then restored the prior
source and green output with Undo. Reload retained green with Play/Ready and no
autoplay. Only the temporary native tab/server were closed. These checks establish
local functionality; full ecosystem parity and final public acceptance remain
open, including media/volume/Sound/VR, remaining Strudel modules and deployment.

## Cube texture inputs — 2026-09-15

Channels now offers six-face cube textures alongside 2D images, audio, keyboard
and buffers. A cube descriptor is `{type:"cubemap",faces:[+X,-X,+Y,-Y,+Z,-Z]}`,
where each face is an HTTPS URL or local `asset:<hash>` image reference. Faces
must be square and equal-sized. The renderer declares samplerCube for that
channel, preserving ordinary `texture(iChannel,vec3Direction)`, textureLod and
legacy textureCube calls. Other channels retain sampler2D declarations, including
when both kinds occur in the same shader. GLSL source is not translated.

Face URLs/imports live inside the existing Channels disclosure. Filtering,
vertical flip and sRGB use the same options as 2D images. Cube uploads respect
the device's cube size limit and the combined 64-megapixel allocation bound;
all six faces count toward GPU use even when encoded content is shared. Failed
faces or shader compilation retain the previous GL passes. Prepared/retained cube
textures participate in rollback, disposal and context recovery. Local cube faces
are included exactly once by identity in portable project archives, using the
existing image store and full image validation before Open.

References: [WebGL 2 specification](https://registry.khronos.org/webgl/specs/2.0/)
and [Shadertoy's published input declaration](https://www.shadertoy.com/view/NdS3WK)
(the indexed header describes samplerXX as 2D/Cube). Shadertoy's full howto page
returned 402 again. This implements cube **inputs**; Cubemap output-pass behavior
remains a separate open requirement.

Build `d793b1d18718` passes `test:algorave-cubemap`: all six directions, face
orientation/vertical flip, legacy sampling alias, mipmaps, sRGB, resolution/time,
mixed sampler types, wrong-size face rejection with retained pixels, transaction
rollback and graphics-context recovery. Real UI checks import six original PNGs,
Run/Undo, reload stopped, download and Open in a fresh profile, and narrow layout.
The wait for a second Run uses the applied source rather than a previous identical
status message, so asynchronous decoding must finish before asserting pixels.
Local-image/mixed-WAV archive and existing shader-input suites also pass on this
build. Image archive unit tests and the agent contract pass. Chromium audio checks
use the explicit silent sink; no acoustic result is claimed.

Native Safari on visible local `d793b1d18718` opened the six-face fixture through
the macOS picker. +Y sampled blue, editing to -Y and Run sampled yellow, and Undo
restored blue and the prior GLSL. Reload retained blue with Play/Ready and no
autoplay. The temporary native tab and replay server closed. Final public/browser
acceptance, media/volume/Cubemap-output/Sound/VR scope, remaining Strudel modules,
new-runtime soak and deployment still remain.

## Local image projects — 2026-09-15

Channels now accepts local PNG/JPEG/WebP/AVIF/GIF/BMP files. Imports use the same
GLSL sampler and options as HTTPS textures. Bytes are identified by SHA-256,
validated by their signature and a browser decode, then stored immutably in
IndexedDB. Project channels carry `asset:<hash>` references; the agent sees those
references without image bytes. The normal controls show “Imported image (saved)”
instead of displaying hashes. Set channels stages the input; Run applies it.

The image collection allows 32 files/64 MiB encoded, with the existing 16 MiB and
16-megapixel individual-image limits. Saves merge immutable records across tabs
and retain old images for Undo. A missing cached reference refreshes storage once.
Invalid imports leave the current visual active. Project downloads with local
images include exactly their referenced images and WAV samples in a versioned
asset archive, bounded to 112 MiB. Older plain and sample-only projects retain
their format and import behavior. Imported archive images are fully decoded
before persistence or project activation; no image upload service is involved.

Build `03ea27fdf73d` passes `test:algorave-image-project`'s data and Chromium checks:
byte identity/isolation, mixed WAV/image archive restoration, malformed and missing
content rejection, agent context, real file input, sampled pixels and flip,
Run/Undo, reload, fresh-profile portable Open, stopped restoration and WAV playback,
failed-decode retention, multi-tab immutable merge and narrow layout. Chromium
uses the explicit silent sink; these are DSP checks, not acoustic evidence.
Workflow and both providers' six saved real chat → Apply → Undo → re-Apply → reload
cases pass on this build, with zero new provider calls. The agent contract and
older sample archive checks pass. The broader image/keyboard/sampler/context-loss
suite passed on the preceding `b830f601d214`; the final changes only make input
byte copying safe for Node Buffers and include new modules in the build hash.
Exact source checksums and a fresh-npm-ci byte-for-byte browser rebuild pass.

Native Safari on visibly identified local `03ea27fdf73d` passed the macOS file
picker, Set channels → Run, vertical flip → Run, project Undo and reload. The
original 2×2 PNG produced red, then blue, then red again; reload retained red with
Play/Ready and no autoplay. One clipboard timeout in the file picker was recovered
through its native path field. The temporary Safari tab and replay server closed.
This covers local-image interaction; final public acceptance, remaining Shadertoy
media/texture/pass scope, remaining Strudel modules and the new-runtime soak are
still required. Nothing has been deployed by this checkpoint.

## Image and keyboard channels — 2026-09-15

The renderer now supports public HTTPS image textures and a 256×3 keyboard input
alongside audio and A-D buffers. Existing string channel configurations remain
valid. Typed descriptors carry image URLs or buffer names and per-channel
nearest/linear/mipmap filtering and clamp/repeat/mirror wrapping. Image options
also include vertical flip and sRGB decoding. Four input controls for the selected
pass live inside Channels; raw channel JSON is in a nested optional disclosure.
The GLSL stays unchanged. Keyboard input requires output focus and ignores editor
typing; rows represent held, one-frame press and toggle state by browser keyCode.

Images load and decode before GL activation using credential-free, referrer-free
CORS fetches without redirects. Limits are 16 MiB per encoded image, 16 megapixels
per decoded bitmap and 64 megapixels for combined decoded/uploaded textures, with
a 15-second candidate deadline. Dimension checks happen after browser decoding;
these limits are not a claim of a preemptive decoder memory bound. Duplicate
images within a candidate share decoding and texture storage. Per-channel WebGL
samplers prevent one input's filtering from changing another view of a buffer.
Dynamic mipmaps are refreshed after writes. Static image/keyboard channel clocks
are zero and their resolutions reflect their actual texture sizes.

Apply retains the prior GL passes until the paired music transaction succeeds.
Failure can restore those passes without another download, including their
feedback state. Retained targets resize with the canvas. After context loss,
rollback rebuilds the prior document and does not pass dead handles into the new
context. Prepared downloads abort on disposal/context loss and decoded bitmaps,
textures and samplers are released. A missing saved image on reload keeps the
saved source, reports the failure and shows the default visual so music can still
start. Pressing Stop during texture preparation prevents a later paired commit
from restarting music. Manual visual Run retries unchanged texture URLs.

`test:algorave-shader-inputs` uses original 2×2 and gray PNG fixtures for independent
pixel expectations: orientation, linear/nearest, wrap, mip levels, sRGB conversion,
channel dimensions/clocks, distinct samplers on one buffer, keyboard edges/repeat
and editor isolation. It also exercises failed fetch retention, rollback/context
recovery, actual input controls, saved reload/Undo and Stop during a delayed
paired agent fixture. It does not call a provider or count fixture images as
real Shadertoy gallery content. Native Safari and the official reference-site
comparison remain unverified for these additions. Automated retrieval of
shadertoy.com/howto and its client source returned 402/403 during this work; the
implemented keyboard semantics still require final reference/browser acceptance.

Build `d7b050ab6d65` passes the input pixel/lifecycle suite, preview, workflow,
editor and upstream runtime checks. Session and agent contract checks plus all
35 legacy chat groups pass. The normal distribution was rebuilt, and its source
archive reproduced both browser bundles byte-for-byte after a fresh npm ci.
All six captured real OpenAI/Anthropic replies also pass chat → Apply → exact Undo
→ re-Apply → save/reload on this build, with zero new provider calls.
Chromium audio checks use the explicit silent sink; native acceptance and speaker
output are not established by these results.

Image URLs remain external references in saved/downloaded projects. Subsequent
checkpoints above add local image imports and cube texture inputs. Video/camera/audio
media lifecycles, volume textures and Cubemap/Sound/VR output passes remain outstanding. This is progress toward the
expanded visual goal, not a revised final compatibility boundary.

## Historical checkpoints

The following records preserve evidence for earlier implementations. Their
runtime boundaries, build identities and limitations apply only to those builds.

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

### Native Safari captured OpenAI replies

On visible build `668ca3b9634e`, a fresh local Safari tab used the replay server
from `verify-algorave-provider-ui.cjs --serve openai`, port 62314. Play and Agent
opened the original groove and chat. The exact captured bass request produced a
proposal without changing source; Apply added the captured bass layer and Undo
restored the original visible source. Re-Apply established the next captured
base. The visual-only reply changed the Image source while leaving music intact;
Undo restored the original Image. The paired reply changed both visible sources
and rendered the dark blue/violet tunnel; Undo restored both prior documents.
The restored project was saved and reload showed Play, collapsed chat, the saved
bass source and Ready status without autoplay. The tab and server session 30518
were closed; the preexisting production project tab remained untouched.

These were real captured provider outputs replayed through native chat/Apply/
Undo, not fresh provider calls, Safari automation through WebKit, or public-site
verification. The Anthropic continuation and broader parity work follow below.

### Native Safari captured Anthropic replies and recovery findings

On `668ca3b9634e`, local replay port 63029 completed the same three captured
Claude requests: bass-only, kick-driven Image-only and paired dark music/colors.
Visible source inspection confirmed each applied proposal and restoration of both
documents after the combined edit. Save/reload retained the restored bass project,
showed Play and Ready, and did not autoplay. The tab and server 75799 were closed.
No additional provider calls were made; the original production tab was untouched.

The paired case was stopped when inspected after Apply. Starting it succeeded,
but the first Undo then restored an identical project; a second restored the
pre-proposal music and shader. `ProjectSession.activate` recorded unchanged Play
as an edit. It now activates the runtime without adding history when both draft
and applied documents are unchanged. The session check and six Chromium captured
reply cases on `1f18011ed5b2` pass with an added Stop/Play before each single Undo.
Native Safari on that build also restored the original bass source with one Undo
after Play, but playback had stopped with “Audio scheduling fell behind.” The
local tab and server 45574 were closed. This is not a continuous-playback pass.

The custom transport queued every overdue upstream clock callback until its
32-slice guard stopped playback. It now coalesces contiguous expired slices,
advances their exact cycle count and queries only slices whose deadlines remain
current. This follows upstream Cyclist's missed-window behavior without resetting
its clock inside the catch-up loop. A deterministic 50-second/1000-slice burst
proves bounded queuing, continued transport, correct future deadline and no late
note burst. The worker browser check on `57f1ee3f9b7d` also passed a forced
2.5-second audio-frame event-loop delay with resumed analyser activity and the
transport still playing, followed by its existing infinite/async/recursive
candidate and lazy-query recovery checks. The first run timed out at initial
audio startup; adding a bounded failure snapshot and rerunning passed. No cause
for that initial timeout is established. Native recovery verification is pending.

### Direct upstream music differential probe

`node scripts/probe-algorave-strudel-parity.cjs` on `57f1ee3f9b7d` executes the same
original source programs in unmodified `@strudel/web` 1.3.0 initStrudel (including
its scheduler and Web Audio output), then in the workspace. The browser instances
play serially and close after each case. The sample fixture uses an original drum
WAV served locally with CORS; it does not prove arbitrary remote-bank availability.

| Program | Upstream measured audio | Workspace |
| --- | --- | --- |
| Synth with mini-notation | Nonzero | Nonzero |
| registerSound with an AudioContext oscillator | Nonzero | registerSound is not defined |
| onTrigger closure | Nonzero; callback executed | Explicitly rejected by worker |
| samples() called in source | Nonzero | samples is not defined |

Receipt: `.algorave-preview/strudel-parity-probe.json`. These are demonstrated
compatibility failures, not a broad parity score. The selected integration must
retain executable closures and the upstream Web Audio scope together, outside
the privileged app. The updated plan calls for replacing the serialization-only
boundary rather than teaching the agent to avoid these normal Strudel programs.
Default REPL banks, additional packages and wider reference programs remain open.

## Shared FFT settings — 2026-09-15

The Strudel output analyser now uses the same 2048-point FFT, 0.8 smoothing
and -100/-30 dB range as file/microphone inputs. The shader receives the first
512 spectrum bins and 512 waveform samples. Previously Strudel used a 1024-point
FFT, putting a given frequency at half the expected texture position.

`verify-algorave-runtime.cjs` checks a real 220 Hz dough DSP tone against
`220 * 2048 / sampleRate`, as well as the waveform and fixed texture-row sizes.
Chromium passes on `bdef744db0a3` with an explicit silent sink; this is analysis
evidence, not speaker or native Safari acceptance. Sound output remains open.

## Sound renderer foundation — 2026-09-15

`shader-sound.mjs` compiles the modern `vec2 mainSound(int samp,float time)`
entry point and Common code in a separate temporary WebGL 2 context. It renders
stereo PCM in 65,536-sample blocks, yielding for cancellation between blocks,
and releases the context after success or failure. Default duration is 180 seconds.
An AudioBuffer is returned without opening a live audio context or playing it.

`npm run test:algorave-sound` verifies original sine/ramp programs against CPU
reference samples across block boundaries at 48 kHz, stereo separation, clipping,
Common, cancellation, compile errors and subsequent recovery in Chromium.
The error bounds are 0.001 for the sine and 0.00004 for the sample-index ramp.
This does not prove upstream differential fidelity, native Safari or playback.

The implementation remains unconnected to the editor and transport. Next wire
Sound documents, input textures and uniforms, transactional prepare/rollback,
Play/Stop and finite playback. Preserve existing visuals while rendering and
retain previous audio when a candidate fails. Verify the complete UI and native
Safari before claiming Sound support. Legacy one-argument mainSound remains
unverified. Reference: [Shadertoy Sound help](https://www.shadertoy.com/view/XsfcWj)
and an [independent native renderer](https://gist.github.com/camthesaxman/0af28359307a2f122417010e5ddecfb2).

### Finite Sound playback

The shared audio resource accepts `loop:false` for generated Sound buffers.
It preserves the offset on Stop, resumes on Play, stops at buffer duration,
clears the analysis texture when ended, and restarts after a Stop/Play cycle.
Existing external file inputs keep their looping behavior. The Sound renderer's
`iDate` month now matches the existing visual runtime's zero-based month.

The Sound test renders an original one-second sine shader, plays its actual
AudioBuffer into Chromium's explicit silent sink, verifies nonzero FFT output,
then checks exact stopped offset, resume, finite end, silence and replay.
The full external-audio/microphone suite also passes on `c98f4e88d40d`, including
channel Run/Undo, permission fixture cleanup and saved reload. No physical
microphone or speaker verification was performed. The editor and transactional
Sound integration remain pending; this is not a user-facing Sound release.

### Sound workspace integration

The optional Sound document is now available in the existing pass selector and
agent edit contract. Preparation renders its 180-second AudioBuffer before
committing the visual transaction. A failed Sound compile retains the prior
playing resource. Unchanged Sound/Common/channel source reuses that resource
across unrelated visual edits. Stop cancels pending generation; disposal and
context loss release its audio alongside the visual resources.

Image, cube and volume inputs use the existing texture decoders and sampler
settings in the separate Sound context. Other Sound channel types currently
fail explicitly and remain implementation work, not excluded scope.

`test:algorave-sound` now includes a real workspace Open → Play → Run → Undo
flow, invalid compilation retaining the actual resource, Stop and saved reload.
An original local red texture also generates the expected waveform through an
actual 180-second Sound buffer. Chromium uses a silent sink. Native Safari,
additional channel types, cancellation/rollback stress and final production
acceptance remain pending.
