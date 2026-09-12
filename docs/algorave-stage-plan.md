# Algorave-first Chiptunes: music workspace and visual stage

Active owner goal, 2026-09-09. Supersedes the product-priority/presentation parts
of unified-create-plan.md, not its preservation, security or verification work.
Owner brief read in full from attachment
`397f142c-e62a-4818-b237-57c87cf57739/pasted-text-1.txt`.

## Product outcome

Chiptunes is a place to perform music by writing code or asking the agent to
write that same code. Code and its compiled notes are the central interaction.
Games are artistic visual output, not the main product or another source of
music. Preserve the existing deterministic compiler/player and fixed 14-game
roster. A visual scene is not a new game-pack/composer system.

The three surfaces have different jobs:

- Music source is the editable performance program.
- Note/pattern feedback explains what that program produces.
- The visual stage is artistic output for the musician and audience.

The default path must invite writing/running a readable groove or asking the
agent for one, not choosing a game or a mood-driven radio station. Keep existing
listening, song links, exact imports and finite exports available without letting
them displace this main workflow. No autoplay or compulsory second visual program.

## Reuse and known gaps

- 6d87aaa / 11c16ef already provide accurate source spans, pitch rows, inline
  rolls, shared preview/Run, collapsible conversation and optional presentation.
  Reuse these; do not build another editor or chat workspace.
- The earlier presentation was a fullscreen swap. Phase B mounts the same
  output beside music/notes; visual focus and stage-only fullscreen are layout
  changes. Phase D adds optional bounded visual code. This is not yet a separate
  audience window.
- Audio.musicVisualState reads acknowledged transport and measured internal
  pre-FX master analysis; it never drains onsets. Audio.musicEventReader gives
  each consumer a bounded cursor over actual sequencer commands. Semantic
  trigger strength remains distinct from measured master waveform/bands.
- The rolling recent-note window has been replaced with source-indexed,
  timestamped executed commands and explicit loop/seek/activation identities.
  docs/music-signals.md defines scope, loss reporting, catch-up and the fact
  that audio-render-context timestamps are not speaker-latency measurements.
- Background rendering currently stops when document.hidden. A popup alone
  cannot be claimed to solve audience output while the editor is backgrounded.
- Source-linked gate/velocity/transpose controls now use compiler descriptors
  through the existing worker/project/editor path. They patch exact source
  literals and remain drafts until Run; no separate mixer state is introduced.

## Layout and modes

Compose: preserve the existing music-side code/chart/inline arrangement. Add a
persistent resizable Visuals area on the right, starting around a 62/38 split
between music and visuals. Use a landscape 16:9 stage, compact scene/parameter
controls, and initially collapsed visual code. The ratio is a hypothesis to test.
Do not stretch artwork into a tall narrow canvas or replace the readable note
chart with a visual effect.

Keep the existing collapsible agent panel. At ample desktop widths it can occupy
a separate rightmost panel; otherwise use a drawer so the two creative surfaces
retain sensible minimum widths. A small window stacks/compacts the visual stage
below music instead of squeezing two illegible code editors. Panel changes never
recompose, restart audio, reset visual feedback or lose code/chat state.

Audiovisual edit: reveal visual code under its stage. Focused-editor evaluation
is explicit: Music Run never applies a visual draft, and Visual Apply never
re-evaluates music. Distinguish draft, compiling, pending boundary, live and error
states independently. An agent proposal remains reviewable and explicitly applied.

Perform/output: visuals-only or code-plus-visuals, optionally a note strip. Exclude
chat, provider/account settings, private history and editing/error chrome. Keep
audience layout independent of authoring layout. A same-session output window
must not load another composer/player or create another AudioContext. Preserve
one rendered feedback world when mirroring; do not assume two renderers agree.

## Sequenced implementation

### A. Preserve the musical foundation and audit the stage

- [x] Read the owner's new brief and supersede the prior priority order.
- [x] Preserve the tested code/chart/agent foundation and repo handoff.
- [x] Complete concrete entry/layout, visual-host, signal and persistence audits.
- [x] Specify stage/session/renderer interfaces and their ownership before
  changing canvas parents, routing or saved project versions.

Gate: named existing owners for music source, acknowledged time, scene state,
canvas, output and project persistence. No speculative replacement backend.

Audit result: runtime.js owns route/presentation and scene identity; the sizing
section at the end of audio.js assumes window dimensions; shell.html includes
the stage plus sibling CRT/DMG/NES presentation layers. A docked container must
clip/size all chosen output layers, not just move a canvas. Keep simulation
dimensions stable during splitter drags. music-project.js serialize/restore
must both change before promising portable scene state; arbitrary extra fields
are currently discarded. The first slice will reuse game visuals and expose
their current scheduled-signal limits, not advertise lossless emitted onsets.

First-slice interface contract: music-workspace.js owns the host, panel geometry,
focus and Compose/visual-focus presentation. runtime.js owns the one visual
world, canvas/layer attachment and scene selection through
`CT_CREATE_PRESENTATION.mount(host)`, `unmount()`, `snapshot()` and
`setScene(id | 'off')`. A snapshot reports mounted/enabled state, selected scene,
the fixed roster and stable output dimensions. Off suspends visual rendering,
not music, and retains the selected world. A fixed-size internal surface is
scaled/letterboxed into its host: splitter/chat/fullscreen changes do not resize
simulation or feedback buffers. Existing native/CRT output layers travel with
the canvas and return to their original parents when leaving composition.

Audio remains the authority for acknowledged musical time. Stage operations
never call music play, pause, resume, queue or composition. An explicit Listen
action may hand back to the existing listening route; ordinary close/Escape
must not start a station. Layout preferences are local UI state, not musical
source or portable scene state. Audience windows and visual-project serialization
remain separate later gates, not claims made by mounting the stage.

Tidal guide checked again on 2026-09-09: adopt its small, composable patterns and
live transformation workflow, not a second Haskell/SuperDirt backend. The bounded
Chiptunes dialect must name its supported subset and keep cycles distinct from
bars. The [official introduction](https://tidalcycles.org/docs/) motivates the
workflow; compatibility is established only by our compiler tests.

### B. First vertical slice: music-first entry and simultaneous stage

- [x] Make the public entry prioritize code or agent composition; preserve
  explicit existing listening/song-link routes and browser recovery.
- [x] Introduce the resizable music/stage split with a landscape live preview,
  initially reusing the existing renderer/game visuals behind a stage adapter.
- [x] Keep code, notes and stage visible together; chat stays collapsible.
- [x] Preserve renderer identity and music phase across resizing, chat collapse,
  visual focus and return from stage-only fullscreen. Phase D additionally
  verifies visual-code disclosure without resetting the running world.
- [x] Separate scene selection from the choice to compose or play a song.

Gate: a fresh or saved pattern starts one player, drives the already-configured
stage and remains editable beside it. No mood/game setup wall or navigation to
another composition workspace. Verify desktop, narrow and mobile layouts.

Local Phase B acceptance: real Chromium checks pass for CRT/DMG/NES, fixed
simulation/canvas/feedback allocations, one AudioContext, Off/same-scene restore,
desktop split, narrow/mobile stacking and stage-only fullscreen. Native local
Safari on Music c08ec19abe2a visibly verified the combined layout, Run, keyboard
split resize and fullscreen/Escape while playback continued. These are local
checks, not deployed native acceptance or hidden-editor audience output.
The final route/transport build (Music f2162e2cc5c5) additionally passed native
local stopped entry, cold Listen, Pause retaining track/position, and resume.
The consent-layout-only successor (Music a5e7a94fb4e7) passed the complete unified
aggregate, all three renderer modes and native local stopped entry/Run/Stop.

### C. Shared musical signals and safe renderer evaluation

- [x] Normalize acknowledged transport and stable native onset identity with
  source index, frame/time, duration, pitch, channel/part and strength.
- [x] Give each visual consumer its own bounded cursor. Handle loop/seek/revision
  epochs explicitly; no duplicate onsets from a rolling look-back window.
- [x] Expose measured internal master waveform/bands/level where available;
  distinguish measurements from semantic event estimates. No microphone prompt.
- [x] Evaluate hydra-synth against the existing artifact: license/dependencies,
  instance isolation, supplied canvas, explicit ticks, memory/GPU load, errors
  and Safari behavior. Do not embed the whole Hydra website or adopt by name alone.
- [x] Choose an explicit bounded visual-language boundary. Do not eval arbitrary
  agent/user JavaScript in the application realm. Restrict available operations,
  signals, assets, resource use and source size; assess worker/renderer isolation.
  Unsupported input must fail clearly without a musical change.

Gate: one known note drives a predictable visual event through tempo changes and
live replacement. Drafts never emit events. A runaway/rejected visual program
cannot be called isolated merely because it is wrapped in try/catch.

Signal implementation: native source indices survive schedule preparation without
affecting sonic-history comparisons. The processor observes actual triggers,
note-offs, pulse continuations, sample starts and authored register writes;
loop-boundary note-offs precede the discontinuity marker. The page checks the
acknowledged epoch/activation/revision/discontinuity, sequence and source reference
before publication. The journal retains 2048 records with independent cursors and
explicit overflow/reset; the runtime consumes once per draw with bounded catch-up.
Observations leave PCM byte-identical in live source tests, including temporary
delivery failure. Measured waveform/RMS/peak and normalized dB-bin bands come
from the existing internal master tap before EQ/compression/limiting, with
separate analysis buffers. No microphone or extra AudioContext is created.
The precise API and limits are in docs/music-signals.md. The subsequent renderer
decision and its evidence boundaries are recorded below.

Local signal acceptance on app.1ce49d6d016e.js / Music 67cdfdad0f71: 20 journal,
15 executed-pipeline and 31 live-audio source checks pass. Real Chromium checked
250 matching records across independently drained readers, 123 unique drawn
onsets and 437 read-only snapshots, including complete loops, invalid Run and
live replacement. Measured analysis was nonzero and bounded; the check created
one AudioContext and requested neither microphone nor provider. These are local
command/render observations, not speaker-latency or deployed/native Safari proof.

Hydra source preflight (not an adoption/performance test) inspected upstream
commit `9d29a9f4fd8f9081b9759943f38db36f05b9a88f`, manifest 1.4.0. It carries
AGPL licensing, while this project is MIT; distribution needs deliberate license
review before incorporation. Stock construction also initializes Array prototype
helpers and an eval-based sandbox even with `makeGlobal:false`. Direct embedding
therefore does not satisfy the planned application-realm boundary. No Hydra
dependency or upstream code was installed. Keep the adapter boundary; compare a
small bounded native visual language with an explicitly adapted/isolated Hydra
spike before choosing. Do not label either GPU-safe without measured budgets.
Sources: [upstream manifest](https://github.com/hydra-synth/hydra-synth/blob/9d29a9f4fd8f9081b9759943f38db36f05b9a88f/package.json),
[constructor](https://github.com/hydra-synth/hydra-synth/blob/9d29a9f4fd8f9081b9759943f38db36f05b9a88f/src/hydra-synth.js),
[sandbox](https://github.com/hydra-synth/hydra-synth/blob/9d29a9f4fd8f9081b9759943f38db36f05b9a88f/src/lib/sandbox.js).

Decision, 2026-09-09: use the bounded native Canvas language described in
visual-language.md; do not incorporate stock Hydra. The isolated pinned-source
probe in hydra-renderer-evaluation.md exercised supplied canvases, independent
manual ticks, feedback, actual music events, errors and Metal/SwiftShader
timings. Small-graph performance was acceptable; shared prototype effects,
eval/CSP requirements, edit/reset resource growth and licensing prevent direct
adoption. Hydra Safari and long-session/GPU-isolation checks were not completed
and are not transferred from the native renderer's evidence. The candidate is
rejected for this implementation, not declared universally unsuitable.

The native compiler constructs immutable bounded data, never JavaScript. Five
composable drawing operations, named controls, explicit internal-audio/event/
transport signal references, palettes and feedback are supported. Source is
32 KiB UTF-8 / 4096 tokens / depth 16; 8 layers and 512 static items total.
Two fixed <=960x540 canvases and bounded geometry prevent source-authored
allocation/loop growth. This is not process/GPU performance isolation, Hydra
syntax compatibility or a second music engine. Compiler/parser and renderer
unit checks plus real browser pixels exercise those specific boundaries.

### D. Scenes, visual code and performance controls

- [x] Provide a small strong collection of editable scenes suitable for the
  chosen renderer, alongside the existing generic game visuals. Start with
  geometric/pixel/feedback directions that actually fit the implementation.
- [x] Declare named visual parameters and mappings separately from code. Sliders
  change declared saved parameter values, not secretly rewrite visual source.
- [x] Add optional visual code with explicit Apply and last-working retention
  on recoverable parser/shader errors; music continues unaffected.
  Opening/closing the visual editor must retain the running visual world.
- [x] Support immediate or selected-boundary scene activation, visible queued
  scene/time and cancellation. Define pause/seek/revision behavior explicitly.
- [x] Implement distinct Stop music, Freeze visuals, Blackout output, Reset visual
  state and Global panic operations. Blackout is not an audio stop.
- [x] Integrate the prepared music gate/velocity/transpose literal controls.
- [x] Finish the Tidal-guided bounded pattern subset/live build-up from the music plan.

Gate: code and named state have one declared source of truth, errors keep the
last usable output, and each performance control has independently tested effects.

The implemented scene programs are Neon Tunnel, Pulse Grid and Orbit Loom;
they remain editable layered source and sit alongside the unchanged 14 generic
game visuals. New composition configures Neon Tunnel before playback. Scene
selection prepares a draft; separate Apply is immediate or next acknowledged
bar. Pause holds a queue; stop/seek/loop/new activation cancels it. An existing
audio-state subscription updates queue state even when drawing is hidden/Off;
it adds no timer or sound engine. Freeze reanchors without catch-up, Blackout
masks all mounted output layers while rendering continues, Reset invalidates
visual feedback only, and Panic explicitly invokes the music Stop operation.
Off and returning to the same scene retain its edited live program/parameters.

Visual Code is a disclosure using the existing CodeMirror artifact with its own
help/completions and focused Cmd/Ctrl-Enter Apply. The stage stays pinned above
the editor inside its pane; code/chart/chat remain independent. Parser errors
retain the live graph; recoverable draw failures retain the last complete front
buffer. Named control values do not rewrite source. These are session values
only at this checkpoint: the UI says so explicitly, and Phase E is not complete.

Music controls are a different source-of-truth contract: the compiler describes
direct gate/velocity/transpose literals, and each widget edits that exact source
span. Preview and Run use the same compiler. At most 24 widgets are shown, with
explicit omissions; invalid/foreign drafts, project replacement and close revoke
old controls. Slow pointer/key gestures are one Undo entry, including focused
Cmd/Ctrl-Z. Unchanged mounting retains numeric spelling, comments and precision.
Descriptors are recompiled view metadata, never restored project authority.
The complete unified suite and local native Safari on Music 825b6f3ddb9a verify
source-only editing, native range/numeric input, grouped Undo, continued sounding
revision and explicit Run to a new boundary. That slice did not yet enable cycleV1.

cycleV1 is now implemented and is the last Phase D item. It is an explicitly
versioned second pattern constructor, never a reinterpretation of saved notes()
strings: `pattern("bass",cycleV1("C2 [E2 G2] ~ G2").gate(.65))`. Equal slots
divide a cycle; brackets nest, `~` rests, `*N` repeats inside its slot, `<...>`
alternates one branch per visit, and `C2(k,n,r)` distributes k hits over n slots
with left rotation. The chain adds `.fast/.slow` (integer 1–16), `.rev()` and
`.every(N,"rev",offset)`, wrapping the preceding expression in written order;
the existing gate/velocity/transpose/register still apply, and `.stepsPerBar`
is rejected as belonging to notes(). Evaluation uses bounded BigInt rationals
with absolute endpoint conversion through the existing createClock, so tempo
maps and groove are honoured without accumulating rounded durations. One output
cycle maps to one four-beat bar in this version; a cycle is not inherently a bar
in Tidal, and the mapping is a deliberate Chiptunes choice. play({atBar,repeat})
selects the finite onset window with song-global phase, never manufacturing a
retrigger by slicing a sustain and never trimming a tail. Reversal of an event
crossing its reversal cycle is rejected with a located diagnostic rather than
approximated. Cycle parsing/evaluation carries its own bounds (4096 nodes,
depth 16, 32 wrappers, 200,000 visited fragments, 256-bit rationals) on top of
the existing source/event/work limits; rests and discarded fragments are charged
work. The contract is docs/music-cycle-v1.md; the editor help, the trusted
server chat system text and src/music-cycle-examples.js all describe the same
subset, and unsupported Tidal notation fails closed instead of being inferred.

This is a bounded Chiptunes dialect guided by Tidal, not Tidal compatibility and
not a second synthesis engine. The deterministic single compiler/player, finite
exports and the chip's four channels are unchanged; notes() semantics and old
saved projects are untouched.

### E. Save the audiovisual composition and create audience output

- [x] Version/save visual source, selected scene, parameters, mappings and
  supported assets with the musical project; preserve old music-only projects.
- [x] Keep local panel/window geometry separate from portable composition data.
  Preserve existing private-history/public-share boundaries and explicit import.
- [x] Provide fullscreen and a same-session output path with visuals-only and
  code-plus-visuals choices. Never expose the entire app DOM as audience output.
  Output is a layout of the SAME session, chosen independently of the authoring
  layout: visuals-only (the existing stage presentation) or code-plus-visuals,
  which keeps the readable performance program beside the stage. Both exclude
  chat, account and provider settings, private history, project tools, the live
  guide, help, diagnostics and every editing affordance; the browser check
  asserts each of those is not visible rather than trusting the CSS, and
  removing any one of them from the hidden set turns it red. Stage-only
  fullscreen is unchanged. Entering, switching and leaving output never
  recompose, never restart audio, never create a second AudioContext and reuse
  the same visual world -- all asserted while music is actually playing. The
  chosen layout is a local preference under the layout key, never portable
  composition data. Escape leaves output and restores the authoring surfaces.
  Evidence boundary: this is a same-session, same-window output path, which is
  what this checkbox asks for. A SEPARATE output window or a second display is
  checkbox 4 below and is explicitly NOT claimed here -- background rendering
  still stops when document.hidden, so a popup would freeze behind the editor.
- [x] Verify the single renderer/output strategy under backgrounding and a second
  display; if a simple mirror freezes, fix ownership before claiming acceptance.
  Native acceptance 2026-09-12: the same Safari output window was moved to the
  PHL 241B7Q and fullscreened on Music 64b20ba3ce16. With System Settings focused,
  captures over two minutes show new scene frames and advancing chart/playhead.
  Separate Spaces was Off and left unchanged. This accepts visible external
  output losing app focus, not a minimized/hidden document or a private editor
  window. Actual projector-distance readability remains a venue check.
  STRATEGY DECIDED 2026-09-11, and the conditional clause turns out not to fire:
  ownership never needed fixing. There is exactly one visual session, the
  renderer's two 960x540 canvases are private buffers reaching the screen
  through a single drawImage, and mount/unmount moves the whole layer stack with
  ownerDocument enforced. The freeze this checkbox anticipates is a DRIVER
  problem, not an ownership problem -- so the answer is the shape that does not
  create a second owner: ONE window, one document, one renderer, one mount host,
  with the chosen output layout fullscreened onto the projector. The performer
  works on the audience surface, which is the algorave idiom rather than a
  compromise.
  Three alternatives were examined against this codebase and rejected. Rendering
  while hidden is inert on its own, because requestAnimationFrame does not fire
  in a hidden document; making it real means a worker tick, a second blanking
  mechanism, re-deriving the vsync frame divisor and re-labelling diagnostics
  three existing verifiers read -- and it is the single most dangerous shape to
  accept on headless evidence, because Playwright never produces document.hidden
  and would confirm exactly what fails on a real machine. OffscreenCanvas is a
  rewrite, not a change: it moves rendering to a worker rather than a window, it
  cannot even be applied because a 2D context is taken on #stage at module load,
  and the audience picture is a CSS stack of #stage plus WebGL panels and
  blended layers, not one canvas. A captureStream/drawImage mirror inherits the
  freeze rather than fixing it, and mirrors the wrong layer in DMG/NES modes
  where #stage is deliberately hidden -- and this plan already forbids assuming
  two renderers agree.
  Landed for it: fullscreen now takes the whole output layout, so code-plus-
  visuals keeps its code half; output carries its own on-screen build identifier
  (a NEW element, never an unhide of the footer) so an observation can name the
  build it was made against; and the naive popup mirror is a permanent red-able
  regression -- it ticks its own frame loop and produces zero new frames once
  the source stops, so nobody ships it as an output path by accident.
  scripts/verify-audience-clock-browser.js also asserts the thing nothing
  asserted before: acknowledged musical time keeps advancing across a real
  editor blur, with no second audio engine.
  WHAT REMAINS IS OWNER-ONLY, and it is the whole checkbox: whether a window
  fullscreened on display 2 reports document.hidden when the operator switches
  Spaces or another window occludes it, on this Mac with its current "Displays
  have separate Spaces" setting. Playwright cannot produce document.hidden by
  any of six routes tried, so no headless check may stand in for this. Also
  owner-only: whether the letterboxed 960x540 surface fills a real projector at
  its resolution and refresh, whether the code half is legible at projection
  distance, all Safari behaviour, and whether a set-length session holds frame
  rate and musical time. The owner acceptance checklist is in HANDOFF.md.

Gate: reopen restores the audiovisual composition; output has one audio engine,
no private UI, stable visual state and independent presentation choices.

Checkbox 1 is implemented. visual-stage.js gained serialize()/restoreSaved() and
an options.restore, so a session no longer always boots on presets[0]. Saving
captures only portable composition data -- the LIVE scene, its edited source and
its named control values. Drafts, queued boundaries, freeze and blackout are
session state and deliberately do not travel; restore-then-save is a fixed
point. music-project.js carries an OPTIONAL `visual` record key and VERSION
stays 1, which is what makes this non-breaking in both directions: a record
written by an older build restores here with no visual block, and a record
written here restores on an older build as music with the visual key ignored.
There is no assets item to do -- the visual language forbids external assets.

A saved visual is treated as untrusted input from a project record. A malformed,
oversized, hostile or no-longer-compiling block is dropped and the music still
opens with its source untouched; the stage falls back to the default scene and
says so. Absent is distinguished from malformed, so a music-only project opens
silently rather than claiming a failed restore. Saved control values are clamped
to the program's declared range. A preset this build no longer ships keeps the
saved program rather than discarding the work, relabelled visual:custom so
selectDraft still accepts it. Visuals never block a music save.

The workspace now wires the missing save path, and the rule that makes it safe
is OWNERSHIP rather than a flag: the workspace records the exact project the
stage was last handed over to, and neither the ct-visual-state listener nor
save() may write visuals unless that project is still the current one. The
handover runs on every path that replaces the project -- open, file import,
transfer accept, new loop and generate -- so any future path that forgets it is
read-only by default instead of writing one project's visuals into another.
Share links carry visuals when they fit; because visual source may be 32 KiB
against a 12,000-byte link budget, an oversized visual is omitted and the user
is told, rather than refusing to share the music at all. Private history remains
excluded from shares exactly as before.

An adversarial review of this slice found four data-loss defects before it
landed, all from one collision: serialize() returning null meant both "the stage
is at its untouched default" and "delete what is stored". The fixes, each with a
regression test:

- A saved visual that could not be restored was written back as null by the next
  save, permanently destroying a composition a different build could still read.
  A failed restore is now recorded, and while it stands an empty stage never
  deletes the stored block -- though authoring a real visual still replaces it.
- Opening a project file, accepting a transfer, starting a new loop or
  generating a song replaced the project without re-syncing, so the outgoing
  stage was written into the incoming project. Ownership plus the added handover
  calls fix all four.
- Saving while the scene was Off discarded the applied program entirely, because
  Off serialized as an empty scene. Off now carries the suspended program and
  reopens Off with it intact.

One of those regression tests was itself vacuous at first: it drove a music edit
by typing into CodeMirror, which Playwright cannot do (docs/music-workspace.md
records the same limitation for paste), so no save ever ran and the check passed
against the unfixed code. It now clicks the real Save action, and was confirmed
by mutation -- removing the guard turns it red.

Checkbox 2 is implemented. The music/visuals split, the chart/code split, the
desktop and mobile chat state and the visual-code disclosure are durable, under
their own `ct-music-layout-v1` key, loaded before the first render and clamped by
the same setters that bound live interaction, so a hand-edited or stale record
cannot produce an unusable layout. They are deliberately NOT in the project
record: a record that carried them would ship one machine's window arrangement
to everyone who opened the link. The browser check asserts both halves -- the
geometry survives a reload, and the project record contains none of those field
names. A broken or unavailable layout preference is swallowed; it is a
convenience and must never block the workspace or report an error. The existing
private-history and public-share boundaries and explicit import are unchanged.

Not done in this slice: checkboxes 3 and 4. Checkbox 4 remains the hardest and
ends in owner-only evidence -- runtime.js returns early on document.hidden above
its only tick call, so a backgrounded editor window stops rendering, and a second
physical display is not expressible in Playwright.

### F. Performance and release acceptance

- [x] Define and measure resolution/frame-rate/resource budgets; reduce visual
  work before degrading audio. Test high-density displays and long sessions.
  The budgets are now explicit constants rather than assumptions: resolution is
  the two fixed 960x540 canvases, item count is capped at 512 by the compiler,
  and VISUAL_BUDGET_MS (6 ms) is the share of a 60fps frame the stage may take
  before it must draw less. The split matters: the renderer deliberately owns no
  clock and no ambient services -- verify-visual-renderer.js forbids Date and
  performance inside it -- so it cannot measure its own cost. runtime.js measures
  actual frame cost around the stage tick, keeps a slow EMA so one expensive
  frame does not visibly thin the scene, and hands back a quality level; the
  renderer only spends it. Recovery is deliberately slower than shedding so the
  level does not oscillate on a marginal machine.
  Shedding scales every layer's item count, which is the loop every draw
  operation runs, so it reduces real canvas primitives rather than merely
  reporting a smaller number; MIN_QUALITY (0.25) and a one-item-per-layer floor
  keep a shed frame the same composition, thinner, never a blank stage. Audio is
  never the thing that gives way: nothing in this path touches transport, and the
  browser check asserts the music keeps playing and no second AudioContext
  appears while visuals are being budgeted.
  Evidence: verify-visual-renderer.js covers shedding, clamping in both
  directions, invalid hints that must not fail a frame, and a 5,000-frame
  session with rotating transport identity, quality and onsets that allocates no
  canvas, resizes none, keeps phase wrapped and never exceeds the declared
  program. High density is exercised at deviceScaleFactor 2 by the existing
  browser checks. verify-visual-persistence-browser.js asserts the budget is
  declared, that real cost is measured rather than assumed, and that a shed frame
  really draws fewer items; removing the cost measurement turns it red.
  Evidence boundary: this is a bounded work budget measured in Chromium. It is
  not a multi-hour real session, not a physical high-DPI display, and not a GPU
  memory measurement.
- [x] Exercise resize, collapse, focused evaluation, error retention, scene
  queue/cancel, freeze/blackout/reset/panic, save/reload and output lifecycle.
  All nine are covered on every gate. Output lifecycle was the last one and is
  now closed by verify-audience-output-browser.js, which enters output, switches
  layout while it is showing, leaves by button and by Escape, and reloads --
  asserting throughout that nothing recomposes, restarts audio, adds an
  AudioContext or rebuilds the visual world. The other eight:
  resize and collapse in verify-music-visual-stage.js and verify-unified-layout.js
  (keyboard and pointer splitters, chat collapse, each asserting audio is
  unchanged); focused evaluation, scene queue/cancel and
  freeze/blackout/reset/panic in verify-visual-code-browser.js; error retention
  in both verify-visual-code-browser.js (a rejected program keeps the last
  working scene) and verify-music-cycles-browser.js (an invalid draft keeps the
  sounding revision and its chart); save/reload in
  verify-visual-persistence-browser.js and verify-music-cycles-browser.js. Do
  not re-derive these.
- [x] Perform a repeatable groove -> accompaniment -> melody -> variation ->
  breakdown -> full arrangement exercise using manual code and reviewed agent
  proposals, with visible note/visual correspondence and continuous music phase.
  scripts/verify-music-cycles-browser.js is that exercise, and it runs on every
  gate rather than being performed once: seven ordered steps from a noise groove
  through subdivided bass, alternating melody, periodic reversal, Euclidean
  drums and a rest breakdown to full restoration, driven both by hand-typed code
  and by a reviewed agent proposal that is explicitly applied. Phase continuity
  is asserted structurally -- a Run over sounding music issues musicQueue rather
  than musicPlay and activates on the sounding song clock -- and the visual half
  asserts that while the restored arrangement sounds the stage is drawing, has
  published a complete frame, and its music-derived signals move, with no new
  activation or revision. scripts/verify-music-cycle-examples.js proves the same
  seven scores offline against hand-written beat tables and real APU PCM.
  Evidence boundary: this is Chromium, and it shows both surfaces live on one
  acknowledged clock -- not a pixel-level causal proof, not acoustic listening,
  and not Safari.
- [x] Run project, gateway and affected renderer/export/parity regressions;
  verify actual rendered layouts and native Safari with visible build IDs.
  Completed 2026-09-12 in the ordered segments documented in HANDOFF.md;
  parity 10/10 at minimum correlation 1.000000, gateway now 78/78 including
  actual browser Fetch Metadata, worklet boundary green. Native local and
  deployed Safari showed the exact build, Run and fullscreen code-plus-visuals.
  No single aggregate covers this. The sequence that actually does, established
  2026-09-11, is four invocations plus one environment variable:

      export LC_ALL=C          # gateway only; see below
      npm test                 # runs posttest -> test:unified-create
      npm run test:render-parity
      npm run test:music-chat-web
      npm run test:worklet-boundary

  Three facts about that sequence, each of which has cost a session real time:
  `npm test` does NOT include gateway, render-parity or worklet-boundary.
  Gateway fails 3 of 77 on macOS without LC_ALL, because the isolated postmaster
  it spawns dies with "postmaster became multithreaded during startup" under
  PostgreSQL 17; with LC_ALL=C it is 77/77. And THREE checks are load-sensitive rather than
  flaky-by-design: verify-sync compares a measured clock correction against a
  120 ms tolerance, verify-frame-pacing measures the display refresh interval
  and fails when it reads 0 ms, and verify-chrome times the home reel's cut
  cadence against a 2 s target (observed 2638 ms under load, 2000 ms idle).
  All three pass standalone and all three fail under a loaded machine, so do not
  run agents, builds or a second browser suite concurrently with the gate. When
  one fails, re-run it alone before treating it as a regression, and record which
  invocations were used rather than claiming one uninterrupted green run. Note
  verify-chrome is the FIRST command after verify-sync, so a flake there skips
  the rest of that segment; re-run from the command after it.
- [x] Prepare the coordinated web release, then obtain the owner's separate
  deployment/configuration authorization and perform bounded real-provider and
  deployed native acceptance. No desktop/broadcast restart as a side effect.
  Owner approved 2026-09-12. Pages/gateway share app.ad4d5a3cf0dd.js; canonical
  CHAT_ORIGIN and the fixed-path Worker proxy are live. Both real providers,
  explicit Apply, scoped notes, exact Undo/recovery/logout and deployed Safari
  passed; exactly two model requests, no retries. Release/rollback IDs are in
  HANDOFF.md. No desktop or broadcast deployment.

Full Tidal/Hydra/Strudel compatibility, collaboration, arbitrary pane grids,
camera/video inputs, node graphs, a preset marketplace and elaborate 3D/VJ mixing
are not initial-scope requirements. Do not add accounts, tunnels or services to
solve a frontend presentation problem.

## Reference and evidence boundaries

The owner's brief is research/design input, not evidence that these features
already exist. TidalCycles remains the musical guide. The Hydra evaluation led
to the bounded native-renderer decision above. Neither embedding options nor
the native renderer's tests establish Hydra isolation or Safari compatibility.

- [TidalCycles](https://tidalcycles.org/)
- [Hydra embedding and manual rendering](https://hydra.ojack.xyz/docs/docs/learning/guides/how-to/hydra-in-a-webpage/)
- [Strudel visual feedback](https://strudel.cc/learn/visual-feedback/)
- [Strudel/Hydra integration](https://strudel.cc/learn/hydra/)
- [Flok](https://munshkr.github.io/flok/)
- [Mercury Playground](https://github.com/tmhglnd/mercury-playground)
- [P5LIVE](https://github.com/ffd8/P5LIVE)

Track exact implementations, tests, build IDs and open gates in HANDOFF.md.
Do not mark this goal complete while these required surfaces or acceptance
checks are missing.
