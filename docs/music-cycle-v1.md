# Cycle patterns v1 — implementation contract

Implemented 2026-09-11 and covered by the verifiers named at the end of this
file. This is a bounded Chiptunes dialect guided by
[Tidal's mini notation](https://tidalcycles.org/docs/reference/mini_notation/),
[time transformations](https://tidalcycles.org/docs/reference/time/) and
[cycle conditions](https://tidalcycles.org/docs/reference/conditions/), not
Tidal source compatibility or a second synthesis engine. Existing notes()
semantics, finite exports and the chip's four channels remain unchanged.

## Authoring

```music
song({tempo:132,bars:8})
pattern("bass",cycleV1("C2 [E2 G2] ~ G2").gate(.65))
pattern("lead",cycleV1("<C4 E4> [G4 B4] E4 ~").every(4,"rev",3).gate(.55))
pattern("beat",cycleV1("C2(3,8)").gate(.15))
track("bass").instrument("wave-bass").play("bass",{repeat:8})
track("lead").instrument("p0").play("lead",{repeat:8})
track("drums").instrument("n-tick").play("beat",{repeat:8})
```

The new constructor is explicitly versioned. A sequence's slots divide a cycle
equally; brackets nest subdivisions, tilde is a rest, `*N` repeats inside its
slot, and `<...>` chooses one branch each cycle. A selected alternation branch
advances once per visit, so `<<C4 D4> E4>` plays C4, E4, D4, E4. Repetition
advances the repeated node's clock: `<C4 E4>*2` plays C4 then E4 each cycle.
Pitch atoms use scientific octave names, including accidentals (octave -128
through 128 before transforms; emitted notes still must fit the chip). Note
letters are case-insensitive and a following `b` is a flat, so `Bb2` is 46 while
a bare `b2` is the note B at 47 — the flat marker only ever follows a letter.
No sample names, dot rests, old length/velocity suffixes, weighting, stacking,
chance, callbacks or arbitrary expressions are inferred inside this notation.

`C2(k,n,r)` distributes k hits over n slots; r defaults to zero and rotates left.
Only a pitch atom can receive this suffix. `n` is 1–64, `k` is 0–n, and `r` is
0–n-1. Slot repetition accepts integers 1–16. Groups cannot be empty.

The chain supports `.fast(N)`, `.slow(N)` (integer 1–16), `.rev()` and
`.every(N,"rev",offset)` (integer period 1–64, explicit offset 0–N-1).
These wrap the preceding rhythmic expression in written order. Reversal is
cycle-local; `.every(4,"rev",3)` affects zero-based cycles 3 and 7. Alternation
receives transformed time, rather than being flattened before fast/slow.
The existing `.gate`, `.velocity`, `.transpose` and `.register` are available;
gate is applied after rhythmic transformations, and the last gate wins.
Pitch/register operations retain written order. `.stepsPerBar` belongs to
notes(), not cycleV1().

## Time, arrangement and boundaries

Cycle time is dimensionless. This version deliberately maps one output cycle
to one four-beat bar through the existing createClock, including tempo maps and
groove. A cycle is not inherently a bar in Tidal. Every rational onset/end is
converted from its absolute position, never by accumulating rounded durations.

cycleV1 is not special-cased for song mode. An exact song
(`song({totalFrames,…})`) reaches the same clock through `settings`, and with no
`settings.tempo` it uses the shared createClock default of 120 BPM and 16 steps
per bar — byte-for-byte the same frames notes() produces for the same material.
That default is a property of the language, not of this constructor, so the two
are pinned against each other rather than one of them rejecting exact mode.

For cycle patterns, play({atBar,repeat}) selects the finite onset window
[atBar, atBar+repeat); repeat counts output cycles, not complete repetitions of
a slowed or alternating expression. Phase is song-global, so starting a play at
bar 3 selects cycle 3 rather than restarting alternation. A window does not
manufacture a new onset for a sustain that started before it, and it does not
trim a note's duration at its end. Finite-song and chip-range checks remain
authoritative; a shorthand tail beyond the finite song is an error.

atBar is not restricted to integers: any value in [0, 65536] is accepted, so a
window may begin mid-cycle. `occurrence` on a cycle row counts output cycles
from that play's own start, and its occurrenceStartFrame/occurrenceEndFrame
span a fixed four beats — this differs from notes(), where an occurrence is one
whole repetition of the authored phrase. Cycle rows also publish
`patternType:'cycleV1'` and `cycleEvent`, a stable token@start/end rational
identity used to deduplicate fragments of one event inside a single play.
notes() rows carry no patternType at all, so a consumer must read an absent
patternType as notes(). Both fields are deliberate forward-compatible metadata
and currently have no product consumer.

Queries preserve full event intervals across cycle/window boundaries. Repeated
fragments of the same event are deduplicated inside one play, never across
separate authored play calls. Reversal of an event spanning its reversal cycle
is rejected with a located diagnostic; put rev before slow instead. This
explicit limitation avoids inventing retriggers by slicing sustained notes.
The audition loop intentionally repeats the compiled finite arrangement.

That rejection is evaluated per queried cycle, not as a static property of the
expression, so it depends on how much of the song is actually played.
`cycleV1("C2").slow(2).every(64,"rev",63)` compiles over eight bars and is
rejected over sixty-four, because only the longer window reaches the reversing
cycle. Lengthening a song can therefore surface the diagnostic on a pattern that
previously compiled. This is a real consequence of cycle-local reversal, not a
bug, but it is the one way a valid arrangement can stop compiling when nothing
about the pattern changed.

## Bounds and verification

The existing source, event, frame and compilation-work limits still apply.
Cycle parsing/evaluation additionally caps 4096 syntax nodes per pattern,
node depth at 16, 32 rhythmic wrappers, and 200,000 fragments. Rests and
discarded fragments consume work. Rational numerators and denominators use
bounded BigInt arithmetic (256 bits each); excess precision is an error, not
silent timing quantization.

Three of those numbers need their exact meaning stated, because the obvious
reading of each is wrong:

- The depth cap is 16 *nodes*, but the root sequence and the pitch atom each
  consume one level, so the deepest **authored** nesting is 14 brackets.
  `[[[…C2…]]]` compiles at 14 and fails at 15.
- `cycleWork` (200,000) carries two distinct meanings against one constant: the
  budget of visited query/tree fragments across the whole compilation
  (`Cycle compilation work limit`, charged across every pattern and play, not
  per pattern), and the maximum number of cycles a single query may span
  (`Cycle query work limit`). The two therefore cannot be tuned independently.
  Splitting them would add a key to the frozen public LIMITS export, so they are
  documented together rather than separated; see HANDOFF.md for the open call.
- The 256-bit bound is enforced on numerator and denominator alike, but only the
  denominator is reachable in practice. With rhythmic wrappers capped at 32 the
  largest reachable speed factor is 16^32 = 2^128, and atBar is capped at 65536,
  so a numerator cannot exceed roughly 2^144. The numerator half of the guard is
  deliberate defence in depth and has no fixture, because none can be written.

Every one of these bounds is pinned by a fixture that fails if the constant
moves: `cycleWork` 200,000 -> 1e9, `cycleBits` 256 -> 64/128/192, `cycleNodes`
4096 -> 100,000, `cycleDepth` 16 -> 64 and `cycleTransforms` 32 -> 256 were each
confirmed to turn the suite red. Rejections are matched against their exact
diagnostic rather than "some error", so a check cannot silently migrate to a
different failing stage.

Required evidence: exact grouping/repetition/alternation fixtures; transformed
clock order; cycle-local and periodic reversal; Euclidean rotation; triplets,
escaped UTF-16 token spans; sustained events and disjoint onset windows; tempo
maps/groove; finite-end/voice conflicts; resource-limit failures including rests;
old grammar/GB/PCM parity; real preview/Run/Undo/reload/materialized export; and
an eight-bar groove, accompaniment, melody, variation, breakdown/restoration
exercise using the same reviewed-proposal path as the sidebar.

## What is proven, and what is not

The executable record is `npm run test:music-cycles`, reachable from `npm test`
through `test:music-workspace` (the two Node lanes) and the `posttest`
`test:unified-create` lane (the browser one):

- `scripts/verify-music-cycles.js` — 25 groups: exact expected schedules,
  whole-event windows, every bound above, and compiler/PCM parity.
- `scripts/verify-music-cycle-examples.js` — 30 checks over the seven scenes in
  `src/music-cycle-examples.js`, against hand-written beat tables rather than
  compiler output, plus real APU PCM and exact materialization.
- `scripts/verify-music-cycles-browser.js` — the real shared artifact in
  Chromium: the seven-step live set, draft/Undo, preview/Run boundary audio,
  save/reload and private chat. This lane is Chromium-only; it is not a WebKit
  or Safari check.

Not proven here: acoustic listening, physical trackpad or pointer input,
deployed Safari, and second-display or backgrounded output. HANDOFF.md records
which build each of those was or was not observed against.
