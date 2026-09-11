# Source-backed Create workspace

This describes the current checkout's shared web/desktop artifact, not a claim
of production deployment. Release IDs and acceptance evidence are in HANDOFF.md;
the unified main-origin cutover still needs the owner's separate authorization.

`/create` opens one composition workspace with code and chart together beside a
collapsible agent conversation. `/create#music` remains compatible;
`/create#music=…` opens a bounded source share. Existing `#s=` song links use exact
materialization, preserving their concrete performance. Entry and import do not
autoplay. A saved draft resumes when there is no explicit import; explicit imports
use a protected temporary copy, not an overwrite of local recovery.

The native LSDj structure editor is separate. Opening a native document does
not convert it into source or claim faithful native playback.

## Write and apply

The live-coding entry starts new projects with a short, readable, multi-track
pattern loop. Play starts audio; Run (Cmd/Ctrl+Enter in Code) applies
the edited source. While playing, valid changes queue on the existing engine's
musical boundary. Invalid code leaves the last valid music playing.
New loop is an explicit replacement action with confirmation; saved and imported
projects are not silently changed into starter patterns. Continuous audition
does not change the finite duration of the source or exports.

Generate song uses the existing deterministic prompt interpreter/composer once.
It writes explicit musical events and assets—not a function that regenerates
the song when you press Apply. This button is not conversational Chat.

CodeMirror provides highlighting, folding, typing undo and function completion.
Its MIT notices and transitive dependency licenses are bundled in
`dist/lib/music-code-editor.LICENSE.txt`. The editor never executes JavaScript.
See [the language reference](music-language.md) for supported functions and
timing semantics.

Typing changes the draft and schedules a bounded preview through the same
compiler, without changing audio. Run validates the entire source and installs
one revision. Invalid drafts remain editable and saved with the last valid
revision; the previous valid chart remains, explicitly labelled. The chart is
read-only: selecting a note identifies its written pitch token (or exact event)
and occurrence. Orange notes warn about channel overlap; a Game Boy has
only four voices, so retaining an event does not make simultaneous notes on one
channel polyphonic.

The status line distinguishes draft, validated, queued and playing revisions.
Playing changes only after an audio-engine acknowledgment. Applied changes use
revision undo/redo, separate from typing undo. See
[live playback semantics](music-live-playback.md), including changed-voice resets
and transition limits. Audition looping is a transport choice, not infinite
source evaluation.

## Code and musical feedback

The chart has one row per semitone, labelled pitch ranges, and percussion rows
by instrument rather than fictitious pitched drums. Its time grid uses the same
tempo-map clock as compilation. A four-lane whole-song overview remains visible;
click it to inspect a four-bar region, or activate it by keyboard to inspect near
the current playback position. This only zooms the chart, never seeks audio.
Show full song returns to the finite overview. Dense regions retain counted
groups and drill-down instead of silently dropping notes.

Inline rolls beneath pattern declarations show compiler-derived occurrences.
The selector identifies track, call and repetition; the context includes written
transformations. Full occurrence bounds include leading/trailing rests and gate
gaps. Long projects have bounded widgets, occurrences and note buttons, with
omissions disclosed and the full chart still available. Exact event imports are
not forcibly converted to patterns or thousands of inline widgets.

Playback colour follows scheduled active notes in the acknowledged playing
source, including the sequencer's note-off ordering and native continuation
rows. It is not an amplitude/envelope meter. Channels affected by raw register
automation or wave kit samples omit token playback markers: those effects have
no mapped pitch identity/lifetime and can outlive later triggers. Their source
and chart remain editable. Generic velocity zero is not treated as a mute: the
chip's shared register encoder determines its level. Editing clears stale inline
mappings; a valid preview can
restore them but does not become sound until Run. Token/source selection and
visual decorations do not add musical revisions or typing-undo entries. The
optional visualizer shares the existing score/player and returns to this same
composition, selection, conversation and transport.

TidalCycles is the musical guide, not a claim of source compatibility. The
existing `notes` language still uses dot rests, `:length` and `@velocity`.
Cycle notation is implemented as a separate constructor, `cycleV1("…")`,
alongside `notes()` — see [the language reference](music-language.md) and
[cycle patterns v1](music-cycle-v1.md) for the exact supported subset. It is a
bounded dialect: do not paste arbitrary Tidal/Strudel code and assume it will
execute, because unsupported notation is a located error rather than an
approximation.

**Build a live set** is a disclosure above the code editor offering seven
ordered steps — groove, accompaniment, melody, variation, breakdown and
restoration — that load a readable cycle program into the draft. Loading a step
is one Undo entry and replaces the draft only; music keeps sounding until an
explicit Run, exactly as with hand-typed edits.

## Chat proposals

Chat is a conversation, with a scrollable transcript and a message composer at
the bottom. Enter sends; Shift+Enter inserts a newline. Settings opens a separate
modal for access, provider and edit constraints; Escape closes that modal without
leaving the workspace. Questions may receive text-only answers. Musical changes
appear as inline proposals and still need explicit Apply.

The transcript is private project data. Local recovery and full project downloads
retain a bounded recent history; public links and first-party transfers exclude
it. Requests include at most 12 recent messages and 16 KiB of conversation text.
Current source/revision remains authoritative, not statements in past messages.
Restored messages do not restore actionable proposals. Replies are shown after
validation; the UI does not pretend that buffered replies are token-streamed.

Chat uses the owner's existing server-side providers and requires owner unlock.
The current checkout routes requests through narrowly scoped same-origin paths;
the prepared main-origin deployment/configuration cutover is separately gated.
Normal use no longer asks the user to visit a second editor or copy a project.
The old hosted address retains explicit recovery for its origin-local drafts.
An unavailable request reports an error while Code and playback continue working.
Consumer Claude/ChatGPT credits
are not treated as API authorization. No browser provider keys are supported.

A proposal carries its base revision and localized source edits. The project
compiles the candidate, computes its actual musical diff, and enforces scope
and locks before offering Apply. Model explanations are not verification.
Editing during a request supersedes it; a late reply cannot overwrite newer
source. One proposal is one revision transaction. Melody locks separately
cover whole track, pitch/rhythm, instrument or arrangement.

## Keep and export work

Local recovery stores one atomic record containing draft and last valid source.
Compiled music is re-derived on restore. The record also carries the applied
visual scene, its edited source and its named control values, so reopening a
project restores the audiovisual composition rather than only the music.
Unapplied visual drafts, a queued scene boundary, Freeze and Blackout are
session state and deliberately do not travel with the project. The `visual`
record key is optional and the record version is unchanged, so a project saved
before visuals were persisted still opens, and a project saved with them still
opens on a build that predates them — as music, with the visual block ignored.
A saved visual that is malformed or no longer compiles is dropped: the music
opens untouched and the stage falls back to its default scene and says so.

**Focus visuals** enters audience output: the same session, laid out for people
watching rather than for editing. The chooser beside it offers two layouts —
visuals only, or code plus visuals, which keeps the readable performance program
beside the stage. Both exclude chat, account and provider settings, private
history, project tools, the live guide, help, diagnostics and every editing
affordance. Entering, switching or leaving output never recomposes, restarts
audio, creates a second audio engine or resets the visual world; Escape returns
to the authoring layout. Stage-only fullscreen is separate and unchanged. This
is a same-window output path: a separate output window or second display is not
supported, because background rendering still stops when the page is hidden.

Panel geometry — the music/visuals split, the chart/code split, desktop and
mobile chat state, the visual-code disclosure and the chosen output layout — is
remembered under its own `ct-music-layout-v1` key. It is a local viewing preference, never part of the
project record, so it is not downloaded, shared or transferred: a link carries
what the music and visuals are, not how your window happened to be arranged. Storage failure and conflicting tabs
are reported; download the project before replacing or reloading conflicted
work. Downloaded project files can include private provenance; public links
exclude private provenance/chat by default. Self-contained links are limited
to 12,000 UTF-8 bytes; larger projects use files, not automatic cloud storage.
Visual source may be up to 32 KiB, larger than the whole link budget, so a link
that cannot fit its visuals omits them and says so rather than refusing to share
the music; download a project file to keep them.
Opening a shared project does not overwrite an existing local draft; download
the shared project to keep it, then explicitly import the file to replace a
locally recovered project.

Exports name the validated revision, even if the current draft is invalid.
WAV uses the shared chip sequencer. MIDI requires acknowledgment of timbral and
automation limitations. ROM and LSDj run capability checks; unsupported features
are rejected rather than silently stripped. In particular, source-to-LSDj
conversion is not established as faithful, so native export remains in the
native editor and legacy Create retains its own exporter.

Unknown project, language/compiler or instrument-asset versions are reported
without silently migrating sound or replacing the original saved record. If a
saved project uses notation this build does not know — a record written by a
newer dialect, opened on an older build — the report names the build and carries
the compiler's own reason, rather than saying the music no longer compiles as
though the source were at fault. The original record is handed back untouched.

## Verification

`npm run test:music-workspace` runs the focused fidelity, compiler, revision,
live-engine, export, Chat-contract and browser tests. `npm test` covers existing
product regressions; `npm run test:render-parity` compares the shared renderers.
`npm run test:music-cycles` runs the cycle dialect lanes — exact schedules and
bounds, the seven live-set scenes against hand-written beat tables and real APU
PCM, and the Chromium live-set workflow. All three are reachable from `npm test`
(the two Node lanes through `test:music-workspace`, the browser lane through the
`posttest` `test:unified-create`); the browser lane is Chromium-only and is not a
WebKit or Safari check.
Automated structural/waveform tests do not substitute for listening acceptance.
Deployment and real Safari acceptance remain separate owner-authorized steps.

`node scripts/audition-music-workspace.js` writes three finite local WAV/source
examples (original, manual bass edit, simplified drums) into a temporary directory
for listening acceptance; it never starts audio or uploads anything.

Large clipboard paste is tested separately with
`node scripts/verify-music-editor.js paste 1048576 --pretty`. This uses a real
clipboard event and verifies exact text and undo. Playwright's direct native
`fill`/`insertText` bypasses CodeMirror's paste transaction and can stall Chromium
layout for multiline documents; that automation path is not a normal paste test.
