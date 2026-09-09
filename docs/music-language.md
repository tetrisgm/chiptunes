# Restricted music language, version 1

This documents the implemented `src/music-language.js`, not the full set of
future capabilities in [the workspace plan](create-workspace-plan.md).
Source describes a finite, concrete Game Boy performance. Compilation never
calls the composer, evaluates JavaScript, loads source-specified assets, or
starts playback. The host owns editing, revisions, worker scheduling, playback,
exports, and persistence. Native LSDj documents remain a separate format.

## Host API

Node: `require('./src/music-language.js')`. Browser: load `gb-hardware.js` and
`gb-kits.js` before `music-language.js`; the global is `CT_MUSIC_LANGUAGE`.
The hardware dependency is mandatory. Kit events require the kit registry.

The frozen export contains exactly:

| Member | Contract |
| --- | --- |
| `VERSION` | String `'1'` |
| `LIMITS` | Frozen limits listed below |
| `compile(source)` | Synchronous `{gb, settings, mapping, diagnostics}` |
| `materialize(gb, meta)` | Readable source string; throws on unsupported data |
| `beatToFrame(settings, beat)` | Shared clock conversion; returns integer frame, throws on invalid clock/position |
| `createClock(settings)` | Validates/snapshots the clock once; returns reusable `(beat) => frame` |

On successful compilation, `gb` is the concrete performance, `settings` is
source metadata/settings, and `mapping` indexes `gb.notes`. Diagnostics are
empty unless chip overlaps produce warnings. On failure, `gb` is `null`,
`mapping` is empty, and diagnostics contains the first error. Returned settings
may be partially parsed; they are not a validated revision on failure.

`materialize` emits explicit calls, recompiles them, and checks normalized GB
equality before returning. Its optional object `meta` becomes
`song(...).settings`, not a GB property. Pass the original compiled settings
when preserving both settings and music. Seed, prompt, title, and provenance
are data: none invokes generation. Browser and Node share the implementation.

## Grammar and literals

The following is grammar notation, not executable source. `object`, `array`,
`string`, and `number` mean literal values.

```text
source       := { statement [ ";" ] }
statement    := "song" "(" object ")"
              | "instruments" "(" array ")"
              | "waves" "(" array ")"
              | "performance" "(" object ")"
              | eventCall "(" object ")"
              | "pattern" "(" string "," notesExpression ")"
              | "track" "(" string ")" { trackMethod }
eventCall    := "event" | "automation" | "vibratoOff" | "waveLoad" | "kit"
notesExpression := "notes" "(" string ")" { notesMethod }
notesMethod  := ".stepsPerBar(" number ")" | ".gate(" number ")"
              | ".velocity(" number ")" | ".transpose(" number ")"
              | ".register(" number ")"
trackMethod  := ".instrument(" (number | string) ")"
              | ".transpose(" number ")" | ".register(" number ")"
              | ".play(" string [ "," object ] ")"
```

Whitespace, `//` line comments, and non-nested `/* ... */` comments may separate
tokens. Semicolons are optional, but empty statements are not supported.
Calls and methods are case-sensitive. There is exactly one required `song()`;
`instruments()`, `waves()`, and `performance()` may each appear at most once.
Pattern names are unique strings. Patterns may be defined after their uses:
track expansion happens after parsing all statements.

Data literals are objects, arrays, strings, finite decimal numbers, `true`,
`false`, and `null`. Keys may be quoted or match `[A-Za-z_][A-Za-z_0-9]*`.
Duplicate keys and `__proto__`, `constructor`, or `prototype` keys are rejected
at every depth. Arrays/objects do not accept trailing commas or holes.
Strings use single or double quotes, JSON escapes plus `\'`, and `\uXXXX`;
literal control characters and template strings are invalid. Numbers accept
an optional minus, decimal point, and decimal exponent, including `.7` and
`1.`. Hexadecimal literals, leading plus, `NaN`, and `Infinity` are invalid.
Materialized arguments use ordinary JSON and decimal numbers: one event object
per line, one instrument/wave row per line, pretty-printed song settings, and
comments labeling blocks. No precision is discarded to shorten the source.

There are no variables, assignments, arithmetic expressions, function values,
user-defined functions, property access, indexing, imports, loops, recursive
patterns, random functions, global access, or arbitrary method calls. The only
nested musical call is `notes()` inside `pattern()`; other arguments are data.
Unknown metadata keys are preserved data, not additional language features.

## Song settings and timing

Two song forms are supported:

```music
song({tempo:120, bars:4, key:"C major"})
pattern("bassA", notes("C2 . G2 . E2 . G2 .").stepsPerBar(8).gate(.7))
track("bass").instrument("wave-bass").play("bassA", {atBar:0, repeat:4})
```

```music
song({totalFrames:240, loopFrames:0, settings:{tempo:120, title:"Exact frames"}})
instruments([[128, 240, 255, 0]])
event({ch:0, frame:7, frames:29, midi:60, inst:0, vel:0.8})
```

Without `totalFrames`, the song argument becomes `settings`; `bars` is required
and `tempo` defaults to 120. There are four beats per bar; `beatsPerBar`, if
provided for shorthand, must be 4. `key` is descriptive only: it neither
transposes nor quantizes pitches. `bpm` is not a timing alias for `tempo`.
Absent a supplied bank, shorthand uses `CT_GB.buildBank([])` (authored assets).
A partially supplied bank is not filled in from defaults.

With `totalFrames`, only `totalFrames`, optional `loopFrames`, and optional
`settings` are allowed in the song argument. `totalFrames` is an integer from
0 through the frame limit. `loopFrames`, if supplied, is an integer from 0
through `totalFrames`; its absence is preserved. Exact mode does not create a
default bank unless a track statement is present. Exact events always use
their literal frame values; changing settings never retimes those events.
Exact and shorthand events can coexist.

Bars and arrangement positions are zero-based. In the default clock, a beat
position becomes `CT_GB.beatToFrame(beat, tempo)`: round
`beat * 60 / tempo * 59.7275`. Onset and end are rounded independently, and a
shorthand note lasts at least one frame. `tempo` is finite, 1–1000 in this
clock. Shorthand sets `loopFrames = totalFrames`; transport audition looping
is a separate host decision. Compilation does not loop playback.

### Tempo maps and groove

Providing a non-null `settings.tempoAt` (including `[]`) selects the shared
LSDj row clock instead of the default beat clock:

```music
song({tempo:120, bars:4, stepsPerBar:16, swing:true,
      tempoAt:[[8,180], [24,90]]})
pattern("p", notes("C2 E2 G2 E2").stepsPerBar(4).gate(.8))
track("bass").instrument("wave-bass").play("p", {repeat:4})
```

Each pair is `[row, tempo]`: a nonnegative integer row, strictly increasing,
and an integer tempo 40–255. The initial `tempo` must also be an integer
40–255. Row 0 is allowed. Song-level `stepsPerBar` defaults to 16 and defines
tempo-map rows, independently of each pattern's step grid.

The groove is `CT_GB.lsdjGrooveTicks(settings.swing, settings.stepsPerBar)`.
Swing accepts booleans or a numeric ratio 0.5–0.8; the hardware helper uses its
default shuffle for truthy endpoints outside its strict ratio interval.
Without a tempo map, swing does not affect timing. Each change accumulates
`CT_GB.lsdjRowFrame(previousTempo, ticks, segmentRows)` and restarts the groove
phase, matching Create's segment-boundary convention. At the exact change row,
the prior segment ends; positions after it use the new tempo. Fractional rows
(for positions or gates) interpolate adjacent integer row frames, then round.
Thus this clock is not interchangeable with the default beat formula.

Shorthand notes extending beyond `totalFrames` are errors. Exact `event()`
notes may start before the finite end and sustain beyond it: compilation
preserves their full `frame` and `frames` and emits `SONG_END_CUT`. The finite
player end cuts playback, not the source event. Notes starting at or after
the finite end are errors in both forms. No source duration is truncated.
Every scheduled note end (`frame + frames`) must still be at most 216,000,
including exact tails, to respect the engine's global scheduled-frame bound.
Trailing rests in a pattern create no events and do not independently fail
the song-end check. Explicit auxiliary events may occur at `totalFrames`.

### Boundary API for host integration

The language's authoritative conversion is `beatToFrame(settings, beat)`.
For repeated lookups, use `const clock = createClock(settings)` followed by
`clock(bar * 4)`. Compilation uses that same implementation. Clock construction
precomputes tempo segments; each conversion binary-searches them. It preserves
fractional-row interpolation and groove resets. Settings are snapshotted, so
later mutation does not change an existing clock. Neither function is callable
from restricted source. Both throw on invalid input; they do not return diagnostics.

Beat positions are finite and nonnegative, bounded by
`4 * (65536 + 4096 * 65536)` (the largest permitted arrangement arithmetic);
tempo-map row positions must remain below 2,147,483,647. Conversion does not
clamp to a song end: the compiler separately enforces 216,000 frames.

The audio implementation exposes
`Audio.musicBoundaries(compiled, {fromFrame, limit})`, which consumes this shared
language clock and contains only boundary selection, not copied conversion math.
It returns ascending frame boundaries
at/after `fromFrame`, bounded by `limit` (default/max 256), and includes the
finite song end when room remains. Hosts should consume this existing helper
for live application rather than recomputing bars with a fixed BPM.

The workspace consumes `createClock()` for its ruler and `musicBoundaries()`
for queued activation on the sounding revision's clock. Those integrations
are owned by the workspace/audio tasks; the language has no UI dependency.

## Patterns, transformations, and tracks

The `notes()` string contains whitespace-separated tokens:

```text
token := (pitch | ".") [ ":" length ] [ "@" velocity ]
pitch := A–G (either case), optional # or b, signed decimal octave
```

Examples: `C2`, `F#3`, `Bb4:2@0.5`, `.:2`, `G2:0.5`.
Octave C4 is MIDI 60. Length defaults to 1 step, velocity to 1. Length is
0.001–65536 steps; velocity is 0–1. Token suffixes use unsigned decimal digits
with optional fractional digits, not exponent notation or a leading decimal
point (`@0.5`, not `@.5`). Rests advance the cursor; their velocity is ignored.
No chord token or drum-name token exists. Noise tracks accept pitch tokens,
but the chip's noise instrument determines the sound.

| Method | Meaning and range |
| --- | --- |
| `.stepsPerBar(n)` | Integer 1–256; default 16; controls the pattern step size |
| `.gate(n)` | 0.001–1; default 1; multiplies each note's sounding length, not cursor advance |
| `.velocity(n)` | 0–1; replaces token velocities |
| `.transpose(n)` | Integer −128–128 semitones, applied to current pitches |
| `.register(n)` | Integer −128–128 octave; sets octave while preserving current pitch class |

Methods apply left to right. Repeated grid/gate/velocity setters use their last
value; transpose/register operations compose. For example, B2 followed by
`.transpose(1).register(3)` becomes C3; reversing those methods yields C4.
Pitch validation occurs after transformations: pulse channels require MIDI
36–108; wave requires 24–96. No silent clamping occurs.

| Track names | Chip channel |
| --- | --- |
| `lead`, `pulse1` | 0, first pulse |
| `arp`, `pad`, `pulse2` | 1, second pulse |
| `bass`, `wave` | 2, wave |
| `drums`, `noise` | 3, noise |

Aliases share the same physical channel. Set `.instrument()` before `.play()`.
An index must address the supplied bank. A name must uniquely match
`bank.meta[].name`, `.id`, or `.patch.authored`. `wave-bass` is an alias for
`w-triangle`; unknown/ambiguous names fail. Instrument names do not load assets.

`.play(name, {atBar:0, repeat:1})` supports only those two options. `atBar` may
be fractional, 0–65536; repeat is an integer 1–4096. Each repetition starts
after the full pattern length, including rests. Repeats are not implicitly
one bar. Each play defaults to bar 0 rather than appending after a prior play.
Track transpose/register methods affect subsequent plays only; the pattern's
own transformations apply first. Each track statement starts fresh instrument
and transformation state. A later method cannot alter already expanded notes.

Explicit notes are emitted first, in source order, then track notes in track,
play, repetition, and token order. The result is not sorted by frame. Unused
patterns do not emit notes; their token text is validated when played, while
their method names/arguments are checked during parsing.

## Explicit events, assets, and metadata

| Source call | GB destination | Validated core fields |
| --- | --- | --- |
| `event({...})` | `notes[]` | `ch` integer 0–3, nonnegative integer `frame`, positive integer `frames`, numeric instrument index `inst`; tonal `midi` within channel range; optional `vel` 0–1 and boolean `trigger` |
| `automation({...})` | `auto[]` | `f`, integer register `r` 16–63, integer byte `v` 0–255 |
| `vibratoOff({...})` | `vibOff[]` | `f`, integer pulse channel `ch` 0–1 |
| `waveLoad({...})` | `waveLoads[]` | `f`, integer `slot` indexing bank wave tables |
| `kit({...})` | `kit[]` | `f`, integer `id` actually present in `CT_GB_KITS.kits()` |

Auxiliary `f` accepts finite fractional frames from 0 through `totalFrames`
to preserve existing Create output. Downstream scheduler interpretation is
unchanged. Kit lookup validation does not use `byId()`'s modulo fallback.
Register numbers in source are decimal, even when hardware documentation uses
hexadecimal. Noise events may omit `midi` or preserve a null pitch.

Additional JSON-valued event properties are preserved verbatim. Existing
examples include note `det` (period detuning), `sweep`, `pri`, and `trigger`
(pitch continuation/retrigger state), plus annotations and asset metadata.
The compiler does not validate every advanced field's hardware meaning:
retaining an unknown property is not a promise that playback or an exporter
implements it. Use the existing player/export capability checks.

`instruments([...])` defines `bank.instruments`: at most 50,128 records, exactly
four integer bytes per record. The hardware layout is
`[dutyOrWaveSlotOrNoisePolynomial, envelope, arpId, flags]`.
`waves([...])` defines `bank.waveTables`: at most 32 tables, each exactly
32 integer nibbles (0–15). These are literal arrays, not encoded blobs.

The stock bank has 128 records, but Create appends records for sound variants.
Those indices are ordinary array addresses, not seven-bit IDs. The bound allows
the stock bank plus one record for each of the 50,000 permitted notes; source
and data limits still apply. No records are truncated, renumbered, or deduplicated.
All four bytes, including flags, preserve the full 0–255 range. Metadata need
not exist for appended records, and `_by` variant lookup metadata is preserved.

`performance({...})` preserves remaining GB fields, including `gainScalar`,
top-level instrument-role metadata, provenance, and asset descriptions.
Its optional `bank` object holds everything except `instruments` and
`waveTables`, which must use their dedicated calls. Known bank fields validate:

- `arpTables`: at most 256 arrays, at most 256 integers −128–255 per array.
- `meta`: at most as many objects as instrument records; integer `index` must
  address an existing instrument record; `type` is `pulse`, `wave`,
  or `noise`; optional `patch` is an object. A patch's `table4bit`, if present,
  is exactly 32 nibbles. Other finite JSON metadata is retained.

`notes`, `totalFrames`, and `loopFrames` are reserved in `performance()`.
Optional event arrays may appear there only as empty arrays to preserve their
presence; nonempty arrays require individual event calls. Declare an empty
array before adding its event calls; redeclaring it after events is an error.

```music
song({totalFrames:120, loopFrames:0, settings:{title:"Register detail"}})
instruments([[128,240,255,0]])
waves([[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,
        15,14,13,12,11,10,9,8,7,6,5,4,3,2,1,0]])
performance({gainScalar:0.75, bank:{arpTables:[],
  meta:[{index:0,type:"pulse",name:"square"}]}, kit:[]})
event({ch:0,frame:0,frames:40,midi:60,inst:0,vel:0.8,
       det:2,sweep:0,pri:5,trigger:true})
automation({f:10,r:37,v:255})
vibratoOff({f:0,ch:0})
waveLoad({f:60,slot:0})
kit({f:80,id:0})
```

## Diagnostics and source mapping

Each diagnostic has `severity`, `code`, `message`, and `span`. Errors use
`INVALID_SOURCE` and stop compilation. Some whole-score validation errors point
to offset 0; precise spans are not guaranteed for every semantic error.
Overlaps use `CHIP_OVERLAP`, severity `warning`, and `noteIndex`. Overlapping
same-channel note intervals are retained, not made polyphonic. Adjacent notes
are not overlaps. This check covers notes, not kit/wave/automation collisions.
Notes consumers should visibly mark conflicts rather than draw all overlapping
events as independently playable.

Exact-event tails use `SONG_END_CUT`, severity `warning`, with `noteIndex`,
the source `span`, `cutFrame` (the finite song end), and `noteEndFrame` (the
unmodified event end). Notes should visually clamp to the finite end and mark
the cut while preserving the source duration. This warning does not make an
overlong event exportable to every format: WAV remains finite, MIDI may report
capped note-offs, and ROM capability checks may reject the tail.

Every mapping entry has `noteIndex`, `span`, `pattern`, and `occurrence`.
Explicit events use null pattern/occurrence and span their event call.
Shorthand entries also have `patternNote` (index among sounding tokens),
`track`, and `occurrenceSpan`. Their main span covers the entire pattern
definition; occurrence is the zero-based repeat index within that play.
`occurrenceSpan` starts at the play method name and ends at the track statement
end, potentially including later methods. It is not a token-level edit range.

Additional visual mappings preserve those older fields:

- `tokenSpan` covers the written pitch, including any raw string escapes, but
  not its `:length` or `@velocity` suffix. Repeats/transforms point to the same
  original token, even when the compiled pitch differs.
- `playSpan` covers precisely the dot through this play call's closing `)`;
  `trackSpan` covers the full track declaration and its ordered transforms.
- `occurrenceStartFrame` and `occurrenceEndFrame` bound the full repeated
  pattern on the shared clock, including leading/trailing rests and gate gaps.
  These are visual timing bounds, not new song-end constraints. A trailing rest
  can extend beyond the finite song; rounding can collapse a very short interval.

Exact events have none of these pattern-only fields. Unplayed/all-rest patterns
produce no note mappings. Consumers must not fabricate note identities for them
or assume every declaration has a sounding occurrence.

Spans have `start` and `end`, each `{offset,line,column}`. Offsets are zero-based
UTF-16 string offsets; end is exclusive. Lines/columns are one-based; LF starts
a new line. The editor selects with
`source.slice(mapping.span.start.offset, mapping.span.end.offset)` semantics.
Mapping supports selection; it does not implement localized rewriting.

## Limits and execution

| Limit | Value |
| --- | --- |
| Source length | 1,048,576 UTF-16 code units (aligned with project source limit) |
| Data nesting | Depth 32; root literal depth 0 |
| Parsed data values | 500,000 |
| Combined explicit and generated events | 50,000 |
| Instrument records | 50,128; metadata entries at most the actual record count |
| Maximum frame coordinate / total frames | 216,000 (aligned with the engine; about 3,616 seconds) |
| Repeat count per play | 4,096 |
| Tokens / cumulative steps per played pattern | 65,536 each |
| Shorthand bars / maximum `atBar` | 65,536 |
| Tempo changes | 4,096; row at most 65,536 |
| Deterministic expansion work budget | 2,000,000 units |

Work charges token processing times transformation count and repeated note
expansion times tempo-map size. These are operation budgets, not a measured
wall-clock timeout or a byte-accurate memory quota. Compilation is synchronous;
the host must schedule it away from the audio render thread. Bounded internal
parser recursion handles literal data; source-defined recursion is impossible.
The 600-second export capability cap is separate and may reject an otherwise
valid longer composition. Source limits do not guarantee that a whole backend
request fits a smaller context budget. Built-in Chat currently accepts at most
512 KiB of UTF-8 source and 1 MiB of total request JSON, independently of the
compiler's UTF-16 limit. Oversized source is rejected before upload or paid
inference; Code, playback and downloadable projects remain available. An
integration accepting the entire compiler range would need the corresponding
UTF-8 capacity plus escaped JSON/settings/proposal overhead, not merely 1 MB.
Compact materialization aims
to keep typical generated songs below 98,000 characters; longer songs/assets
remain legitimate and must not be truncated to that target.

Source location lookup builds newline offsets once, then binary-searches them
for every span endpoint. It does not slice/split the source prefix per note.

## Preservation contract and verification

For supported inputs, compiling materialized source produces deep equality
with the original GB after JSON normalization. Array order, exact note timing,
duration, optional empty arrays versus absence, bank records and metadata,
automation, wave loads, kits, and additional JSON fields survive. Object-key
ordering is immaterial. Undefined object properties are omitted and negative
zero normalizes to zero. Undefined array entries, sparse/decorated arrays,
non-finite numbers, functions, symbols, accessors, typed arrays, class instances,
and cyclic structures are unsupported. Use plain enumerable data properties.

This preserves the concrete input GB, not losses that occurred before it was
materialized. Source comments/formatting and original shorthand are not
preserved by materialization; it prints fresh explicit source. It does not
compact repetitions or regenerate composition. Lossless NativeDocument byte
editing and faithful arbitrary native-song conversion are outside this API.

Run `node scripts/verify-music-language.js`. The verifier covers restricted
syntax, resource/asset limits, mapping, transformation order, overlap retention,
tempo-map boundaries, deterministic recompilation, and browser-global/Node
parity. It also checks JSON-normalized real Create `ask('happy')`, a concrete
composer score, and that score imported through Create. Their full 8 kHz APU
renders, plus an advanced-event fixture, are byte-identical before/after the
no-op round-trip. This is a deterministic renderer check, not listening
acceptance, browser interaction acceptance, or proof of live handover behavior.

The generated-bank regression matrix additionally covers 100 deterministic
tokens across all four moods (`chill`, `happy`, `dreamy`, `funky`): 400 complete
Create-to-source-to-GB round trips, including `ThunderFalconX`. It asserts that
appended records and indices above 127 are actually exercised, and reports
observed record/metadata/index maxima and flags. A synthetic 257-record bank
also verifies metadata/index boundaries and no-op waveform preservation.

The language verifier also shares the export scan's 100 deterministic source
IDs `music-exports-real-000` through `music-exports-real-099`, cycling `chill`,
`happy`, `boss`, `cave`, `sad`, `title`, `battle`, `peaceful`, `fast`, and
`no drums`. Every actual Create GB must materialize without failure and remain
JSON-normalized deep-equal; every exact tail must have a matching `SONG_END_CUT`.
