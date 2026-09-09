## September 9 correction: code as a live musical instrument

The owner supplied Speccy as the concrete algorave reference:
https://mccormick.cx/news/entries/live-code-8-bit-algorave-music-in-browser-with-cljs
and https://github.com/chr15m/speccy/ . The previous delivery exposed exact
events but missed the intended approachable, looping live-coding experience.
Passing infrastructure tests did not satisfy that product requirement.

Implementation sequence:

1. **Readable entry point:** open new projects in Code with a short, authored,
   multi-channel pattern groove using the existing restricted language and
   instrument bank. Provide an explicit New loop action; never replace saved
   or imported source automatically. Generated exact songs remain lossless.
2. **Live iteration:** explicit Play starts loop audition. Run and Cmd/Ctrl+Enter
   validate and queue edits at the existing engine's musical boundary. Invalid
   drafts keep the last valid performance sounding; Stop remains immediate.
3. **Musical feedback:** show beat/bar progress alongside code and distinguish
   edited/queued/live states in plain language. Keep Notes available. Put
   advanced connection and document controls behind secondary disclosure.
4. **Agent collaboration:** preserve named patterns and make targeted edits to
   the same source, with existing proposal validation, explicit approval and
   undo. No new provider/authentication layer or alternative audio runtime.
5. **Verification:** test fresh entry, repeated loop playback, live edit,
   invalid edit, undo, saved-project recovery, and unchanged exact imports.
   Review the actual interface in native Safari; deployment remains a separate
   authorized release action. Automated state/PCM tests are not listening proof.

Finite composition and export remain separate from continuous audition.
This correction is implemented locally and passes the full project regression,
including real-audio live-loop browser checks. It has not shipped; deployment,
production Safari verification and musical acceptance remain open.

## September 9 priority: built-in owner-funded web Chat

The owner clarified that embedded Chat using their OpenAI and Anthropic API
keys is the primary web path. See `web-chat-plan.md`. The external MCP work
below remains optional and its Clerk setup does not block built-in Chat.

## September 8 extension: bring your existing agent (superseded priority)

The implementation sequence now includes [the complete web agent connection
pipeline](agent-connection-plan.md). External-agent MCP connection is the primary
agent onboarding path; embedded paid-model Chat is no longer a prerequisite.
The same source, proposal validation, explicit Apply and audio engine remain.

Original plan follows:

---

## Goal: implement the complete Chat/Code/Notes Create workspace

Implement this plan in Chiptunes. This is an implementation request, not another planning exercise. Work through the phases, verify each, commit/push coherent changes, and maintain `docs/HANDOFF.md`. Do not call the goal complete while required functionality remains unimplemented.

Respect the repository contract: shared `main` checkout, no worktrees, preserve others’ changes, tests before push, no unrequested infrastructure changes or persistent jobs. **Deployment, release, and app restarts require separate explicit authorization.** When blocked on a necessary owner decision, explain it precisely and continue independent work.

### Product intent

Create becomes one musical workspace:

- **Chat:** express musical intent and collaborate with an agent.
- **Code:** the actual editable musical definition.
- **Notes:** a visualization of what that code produces.
- **Playback and exports:** derived from the same validated composition.

Example workflow:

> “Make something happy” → editable musical code and corresponding notes → manually change the bass → ask “simplify the drums, keep the melody” → inspect/apply the targeted change → undo → save/reopen with the same result.

This is **live coding with an agent collaborator**, not a generator whose output is decorated with a code display. Users must be able to write and edit musical functions themselves.

### Architecture decision

Keep the existing composer, musical document machinery, and player. Add a small, versioned declarative music language and revision-aware editing.

Do not introduce Strudel/Gibber’s separate musical runtime into production as part of this implementation. Do not add an alternate composition pipeline.

Reuse a suitable mature code-editor component after dependency/license review. Do not build a general-purpose programming environment.

### Important inspection findings to verify

Relevant files:

- `src/api.js`: composition, capabilities, transformations, readable document API.
- `src/create.js`: grid, document serialization, playback, UI state.
- `src/audio.js`: Create playback and audio ownership.
- `src/lib/gb-chip-processor.js`: sequencer/APU transitions.
- `src/composer.js`: deterministic composition.

The readable `toJSON`/`fromJSON` API is **not yet established as lossless**: inspection showed omitted exact timing and other fields carried elsewhere in the document machinery. Audit offsets, exact durations, tempo changes, master volume, automation, instruments, wave loads, kits, and trigger state.

Current Create editing reposts playback at the current position. The chip processor rebuilds the sequencer and cuts held notes. This is not proof of seamless revision handover or preservation of unaffected sustained notes.

These were inspection findings, not freshly reproduced bugs.

## 1. UI

Main body:

- **Notes** tab: arrangement/grid, lanes, bars, selection, playhead.
- **Code** tab: highlighting, completion, function help, diagnostics, foldable patterns.
- Shared transport, Apply, undo/redo, immediate stop.
- Clear distinction between draft, queued, and currently playing code.

Chat sidebar:

- Visible context: selected track/region and base revision.
- Proposals with explanation, diff, Apply/Reject.
- Status: proposed, invalid, ready, queued, playing, rejected, superseded.
- Chat snippets are previews—not another authoritative copy of the composition.

Mobile:

- Full-width Notes/Code/Chat views sharing state and transport.
- No cramped permanent desktop sidebar.
- Space in text inputs must not toggle playback; scope all shortcuts correctly.

Do not execute partial code on every keystroke. Default to explicit Apply.

## 2. Source language and compiler

Implement a restricted, declarative, function-based language. Illustrative syntax, not a mandatory grammar:

```js
song({ tempo: 128, key: "C major", bars: 16 })

pattern("bassA",
  notes("C2 . G2 . E2 . G2 .")
    .stepsPerBar(8)
    .gate(0.7)
)

track("bass")
  .instrument("wave-bass")
  .play("bassA", { atBar: 1, repeat: 16 })
```

Initial capabilities:

- Song settings and finite length.
- Existing lanes/instruments.
- Notes, rests, lengths, velocities.
- Named patterns, finite repeats, arrangement.
- Transpose/register and a small set of supported transformations.
- Advanced explicit-event representation preserving musical details that shorthand cannot express.

Define timing, indexing, pitch semantics, transformation order, overlap rules, and song-end behavior explicitly.

No arbitrary JavaScript, `eval`, `new Function`, browser globals, network imports, package loading, recursion, arbitrary DSP, or infinite evaluation.

Bound source size, nesting, expansion, event count, song duration, compile time, and memory. Parse/compile away from the audio thread.

### Generation

A prompt invokes the existing composer **once**, then materializes its concrete output into editable source.

Do not represent the whole song as opaque `makeSong("happy")` code that reruns generation on Apply.

Record seed/prompt provenance. Compact repeated material only when lossless. Do not hide essential musical information in an unexplained packed blob.

### Determinism

Same source, compiler version, instrument assets, and explicit seeds must produce the same result.

Any random pattern functions must be seeded and stable by pattern identity/position; editing drums must not unexpectedly reroll melody.

Use one authoritative timing conversion shared by compilation, Notes, playback, and exports. Preserve exact event timing where required.

Respect chip constraints. Surface conflicts instead of silently dropping notes while drawing them as playable.

Finite composition length remains separate from transport audition looping.

## 3. Project and revision model

Saved project includes:

- Format/language/compiler/instrument-bank versions.
- Source with comments and formatting.
- Seeds and necessary assets/references.
- Last validated revision.
- Recoverable unfinished draft.
- Optional chat/provenance, excluded from public shares by default.

Explicit states:

1. Draft source.
2. Validated revision.
3. Playing revision.
4. Pending revision queued for activation.

Compiled scores are derived artifacts, not independently editable authority.

Invalid drafts remain editable and recoverably saved. Last valid audio continues. No partial or invalid result replaces the project.

Use editor undo for typing and coherent project revisions for applied changes. One agent proposal is one undoable transaction.

Preserve user formatting/comments with localized edits; do not reprint the entire file for every change.

## 4. Notes/source mapping

For initial code-backed projects, Notes is **read-only but selectable**. Clicking notes identifies their generating source block/pattern occurrence.

Preserve legacy grid editing for existing projects until migration is proven.

Do not attempt arbitrary code↔piano-roll round-tripping immediately: editing one note in a repeated/generated phrase has ambiguous meaning.

Graphical editing is a later expansion:

- Literal-note edits first.
- Explicit “this occurrence” versus “all repetitions.”
- Visible local overrides where necessary.

## 5. Agent integration

Existing `ask()` is a deterministic interpreter, not a general conversational model. Reuse useful existing interpretation/operations, but implement genuine model-assisted editing through an authorized backend/provider connection.

Do not assume Claude/ChatGPT consumer subscriptions fund embedded website API requests. Provider access, billing, and public abuse policy are real owner decisions. Never expose provider credentials in browser code.

Agent receives:

- Request.
- Relevant source and selection.
- Base revision.
- Language/capability definitions.
- Locks.
- Relevant diagnostics.

Prefer structured localized proposals carrying the base revision.

Before Apply:

1. Validate response structure.
2. Parse source.
3. Validate capabilities/resource limits.
4. Compile.
5. Compute musical diff.
6. Enforce locks and requested scope.
7. Present verified proposal.

One active request per project initially. Bound retries, time, and cost. Cancellation and duplicate-response handling must prevent late/double application.

If the user edits during a request, never overwrite newer work. Rebase only demonstrably independent edits; otherwise report conflict or regenerate against the current revision.

### Locks and truthful reporting

“Keep melody” must become validated constraints, not merely prompt text.

Distinguish pitch/rhythm, instrument, whole-track, and arrangement locks. Global tempo/key changes may conflict with locks and must be explained.

Generate applied summaries from actual musical diffs:

> “Removed six drum hits in bars 9–16. Melody unchanged.”

Do not trust model claims of success.

Treat source comments/imported metadata as untrusted content, not authority. Agent tools are music-editing tools—not shell, browser, publishing, or account-management access.

Code/playback must keep working when chat is offline, rate-limited, cancelled, or unavailable.

## 6. Live playback

Implement prepare/queue/cancel/activate with revision identifiers and audio-engine acknowledgment.

- Compile before queuing.
- Keep old revision sounding until new one is ready.
- Apply at an eligible musical boundary.
- If deadline is missed, use a later boundary.
- Display “playing” only after engine acknowledgment.
- Explicitly handle superseded queued revisions.

Test and define:

- Sustained notes across edits.
- Changed instruments/wave data.
- Tempo-map changes.
- Shortening a song past the current playhead.
- Loop boundaries.
- Stop/pause/seek.
- Background tabs/audio suspension.
- Rapid updates and stale messages.
- Audio-engine failure.
- Leaving Create and returning audio ownership to radio.

Do not confuse click-free transitions with musically continuous transitions. Both require verification.

Initial internal milestone may apply while stopped; live operation is required before completing the core plan.

## 7. Persistence, sharing, exports

- Atomically save draft and last valid revision.
- Handle quota failure/unavailable storage honestly.
- Recover unfinished code after reload.
- Detect conflicting edits from multiple tabs.
- Provide downloadable project files.
- Preserve existing song/share URLs.
- Bound self-contained share size; no automatic cloud storage infrastructure.
- Do not autoplay shared content.

Version migration preserves original files and reports incompatibility rather than changing sound silently.

Exports use a clearly identified validated revision:

- WAV through shared renderer.
- MIDI with its documented limitations.
- ROM/LSDj capability checks.
- No silent feature loss or export of invalid drafts.

## 8. Native LSDj boundary

NativeDocument’s byte-preserving editing is separate from generated/Create compositions.

Do not flatten native imports into this language or imply unsupported commands have faithful representations.

Initial Code mode supports generated/Create projects. Native projects remain in their native editor. Future conversion must be explicit, create a copy, and report losses.

Native playback completion is not a prerequisite for the Chat/Code/Notes workspace.

## 9. Implementation order and acceptance gates

### Phase 0: Fidelity audit

Inventory fields and create adversarial fixtures.

**Gate:** documented exact preservation requirements and tests identifying existing losses.

### Phase 1: Document layer and language

Extract pure reusable logic from UI state; implement versioned project format, parser/compiler, explicit events, then shorthand.

**Gate:** supported musical information survives round-trip; Node/browser results agree.

### Phase 2: Code/Notes workspace

Editor, diagnostics, mapping, revisions, recovery, stopped application.

**Gate:** generate, edit, visualize, play, undo, save, reload faithfully.

### Phase 3: Chat

Authorized integration, scoped proposals, locks, diffs, validation, conflict handling.

**Gate:** real requests produce editable material and targeted changes without disturbing protected content.

### Phase 4: Live application

Revision-aware audio boundary handover.

**Gate:** reliable transitions, correct acknowledgments, no stale events or unexplained resets.

### Phase 5: Hardening

Migration, exports, accessibility, mobile, storage/provider failures, existing regressions.

**Gate:** project tests pass; render parity remains ≥0.995; listening acceptance passes. Deployment and real Safari acceptance wait for explicit owner authorization and remain honestly marked pending.

### Optional later scope—not required to finish the core

Arbitrary graphical round-tripping, richer language, external MIDI/synchronization, broader synthesis, plugin hosting, collaborative multiplayer editing.

## 10. Required verification

Add tests for:

- No-op fidelity including timing, instruments, automation.
- Deterministic recompilation.
- Invalid/malicious source and resource limits.
- Locked-scope preservation.
- Manual-edit/agent-response races.
- Duplicate/cancelled/stale proposals.
- Undo across applied and queued revisions.
- Boundary note duplication/drop and sustained-note continuity.
- Tempo, looping, seek, backgrounding, radio handoff.
- Draft recovery, storage failure, two-tab conflicts.
- Existing shares and exports.
- Keyboard focus, mobile editing, accessibility.
- Truthful applied summaries and playback state.

Listen to representative musical changes; passing structural tests does not prove musical quality.

### Definition of done

A user can open Create, request a song, inspect and manually edit its real source, see matching notes, collaborate through chat, safely apply changes during playback, undo, save/reopen, and export the selected validated revision.

No mock agent presented as real, no hidden regenerated song, no silently lossy representation, no claimed live continuity without testing. Document remaining owner-gated release steps explicitly.

---
