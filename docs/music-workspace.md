# Source-backed Create workspace

This is a development feature in the shared web/desktop artifact. It has not
been deployed or released. From Create, choose **Chat / Code / Notes** to copy
the actual generated/Create performance into source. A saved source project
resumes instead when one exists. Opening the workspace adopts `/create#music`,
so reload returns to the same source project without legacy autoplay.
`/create#music` opens a silent source workspace;
`/create#music=…` opens a bounded project share without autoplay. Existing `#s=`
links and the legacy editable grid retain their existing behavior.

The native LSDj structure editor is separate. Opening a native document does
not convert it into source or claim faithful native playback.

## Write and apply

Generate song uses the existing deterministic prompt interpreter/composer once.
It writes explicit musical events and assets—not a function that regenerates
the song when you press Apply. This button is not conversational Chat.

CodeMirror provides highlighting, folding, typing undo and function completion.
Its MIT notices and transitive dependency licenses are bundled in
`dist/lib/music-code-editor.LICENSE.txt`. The editor never executes JavaScript.
See [the language reference](music-language.md) for supported functions and
timing semantics.

Typing changes only the draft. Apply validates the entire source and installs
one revision. Invalid drafts remain editable and saved with the last valid
revision. Notes is read-only: selecting a note identifies the source event or
pattern occurrence. Orange notes warn about channel overlap; a Game Boy has
only four voices, so retaining an event does not make simultaneous notes on one
channel polyphonic.

The status line distinguishes draft, validated, queued and playing revisions.
Playing changes only after an audio-engine acknowledgment. Applied changes use
revision undo/redo, separate from typing undo. See
[live playback semantics](music-live-playback.md), including changed-voice resets
and transition limits. Audition looping is a transport choice, not infinite
source evaluation.

## Chat proposals

Chat requires a separately authorized server/provider connection. There is no
configured model provider in this checkout; an unavailable request reports an
error while Code and playback continue working. Consumer Claude/ChatGPT credits
are not treated as API authorization. No browser provider keys are supported.

A proposal carries its base revision and localized source edits. The project
compiles the candidate, computes its actual musical diff, and enforces scope
and locks before offering Apply. Model explanations are not verification.
Editing during a request supersedes it; a late reply cannot overwrite newer
source. One proposal is one revision transaction. Melody locks separately
cover whole track, pitch/rhythm, instrument or arrangement.

## Keep and export work

Local recovery stores one atomic record containing draft and last valid source.
Compiled music is re-derived on restore. Storage failure and conflicting tabs
are reported; download the project before replacing or reloading conflicted
work. Downloaded project files can include private provenance; public links
exclude private provenance/chat by default. Self-contained links are limited
to 12,000 UTF-8 bytes; larger projects use files, not automatic cloud storage.
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
without silently migrating sound or replacing the original saved record.

## Verification

`npm run test:music-workspace` runs the focused fidelity, compiler, revision,
live-engine, export, Chat-contract and browser tests. `npm test` covers existing
product regressions; `npm run test:render-parity` compares the shared renderers.
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
