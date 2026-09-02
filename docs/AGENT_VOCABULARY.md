# Talking to it like a producer

**Status: plan.** The four agent surfaces exist (`src/api.js`, `bin/chiptunes.js`,
`mcp/server.js`, `src/webmcp.js`) and they can compose, read, edit, validate and
export. What they cannot do yet is take an instruction like *"make it happier and
a bit faster, then repeat the melody"* and act on it. This document works out
what people actually say, and what the surfaces need so a model can carry it out.

## The division of labour, decided first

The model does the **understanding**. The API provides the **verbs**. We are not
building a natural-language parser; we are building a vocabulary of small,
named, deterministic operations that an instruction decomposes into, plus the
guidance a model needs to decompose it well.

> *"make it more happy"* → `mode(major)` + `tempo(+8%)` + `register(Melody, +1 octave)`
> + `brightness(Melody, +1)` + `density(Drums, +1)`

That mapping is the interesting part, and it has to ship **with** the tools. A
model given only `transpose()` and `setTempo()` will guess at what "happier"
means and guess differently every time. A model given the table below will do it
the same way twice, which is the whole point of a deterministic instrument.

## The vocabulary

Collected from how people actually talk about writing chip music, then filtered
to what this system can really do. Anything here that the chip cannot express is
marked, because promising it and silently ignoring it is worse than refusing.

### 1. The brief — before a song exists

| what they say | what it means here |
| --- | --- |
| "something upbeat / sad / tense / dreamy" | a mood word, already supported |
| "a boss theme", "title screen", "shop music", "game over", "cave level" | **scene presets**: a named bundle of mode, tempo band, density, register and form. Not supported yet and probably the highest-value addition, because it is how people actually ask |
| "chiptune drum and bass", "something like a racing game" | style constraint, already supported as `styles` |
| "in D minor", "minor key", "modal" | key and mode constraint. Mode is supported; an explicit key root is not yet |
| "around 140", "fast", "slow", "half-time feel" | tempo band, supported as `bpmMin`/`bpmMax`; the words need a mapping |
| "about 30 seconds", "a short loop", "a full song" | length in bars or seconds. Not a composer input today |
| "leave room for sound effects" | sparser arrangement, fewer simultaneous voices |

### 2. Global moves — the whole song

| what they say | operation |
| --- | --- |
| "faster", "a bit faster", "way faster", "140" | `tempo(delta% \| absolute)` |
| "half time", "double time" | `tempo(×0.5 \| ×2)` |
| "up a tone", "down an octave", "in a higher key" | `transpose(semitones)` |
| "make it minor", "brighter key", "make it sad" | `mode(major \| minor \| dorian \| ...)` |
| "happier", "darker", "warmer", "more epic", "calmer" | **compound** — see the mood table below |
| "busier", "fill it out", "strip it back", "less going on" | `density(±)`, optionally per lane |
| "swing it", "straighten it out" | `swing(on \| off)` |
| "longer", "add 8 bars", "trim the intro", "cut it in half" | `length(bars)`, `trim(fromBar,toBar)` |
| "more intense towards the end" | `arc(build \| fade)` — density and register ramped across the song |

### 3. Structure and arrangement

| what they say | operation |
| --- | --- |
| "repeat the melody", "say that again" | `repeat(scope, times)` |
| "copy bars 1 to 4 into bar 9" | `copy(fromBar, toBar, atBar)` |
| "loop this bit" | `loop(scope)` |
| "add an intro / bridge / outro" | `section(add, kind, atBar)` |
| "bring the chorus back" | `recall(sectionName, atBar)` |
| "make it AABA" | `form('AABA')` |
| "build to a drop", "add a breakdown" | `arc()` plus `density()` on a scope |
| "vary the second half", "don't just repeat it" | `vary(scope, amount)` — repeat with controlled deviation |

### 4. Per part

| what they say | operation |
| --- | --- |
| "the drums are too busy" | `density('Drums', -1)` |
| "drop the drums for 4 bars" | `mute('Drums', scope)` |
| "mute the harmony", "solo the bass" | `mute(lane)` / `solo(lane)` |
| "add a counter-melody" | `generate('Harmony', scope, {relateTo:'Melody'})` |
| "give me a walking bassline" | `bassStyle('walking' \| 'root' \| 'octave' \| 'arpeggio')` |
| "put the melody up an octave" | `register(lane, ±1)` |
| "harmony in thirds under the melody" | `harmonise('Harmony', interval)` |

### 5. Melody

This is the category people care most about and the one with the least support
today.

| what they say | operation |
| --- | --- |
| "change the melody" | `rewrite('Melody', scope, {variation:n})` |
| "keep the rhythm, change the notes" | `rewrite(..., {keepRhythm:true})` |
| "keep the shape, move it" | `rewrite(..., {keepContour:true})` |
| "less jumpy", "more stepwise" | `contour(lane, scope, {leaps:-1})` |
| "make it more memorable", "catchier" | `motif(lane, {repeatEvery:bars})` — a real, mechanical reading: state a short figure and restate it |
| "end on the root", "make it resolve" | `cadence(scope, 'tonic')` |
| "start higher", "wider range" | `register()`, `range()` |
| "call and response" | `phrase(scope, 'call-response')` |

### 6. Rhythm

| what they say | operation |
| --- | --- |
| "more syncopated", "off the beat" | `syncopation(lane, ±)` |
| "four on the floor" | `pattern('Drums', 'four-on-floor')` |
| "add a fill before the chorus" | `fill('Drums', atBar)` |
| "simpler kick", "add hats" | `pattern('Drums', {kick:..., hat:...})` |
| "double-time the drums" | `rhythmScale('Drums', ×2)` |

### 7. Sound — where this instrument is unusual

These map straight onto chip registers, which means they are exact rather than
metaphorical, and they are the vocabulary a chip musician reaches for first.

| what they say | operation |
| --- | --- |
| "brighter lead", "thinner", "fatter" | `shape(lane, duty)` — 12.5 / 25 / 50 / 75% |
| "shorter notes", "let it ring", "plucky", "swelling" | `fade(lane, env)` — the LSDJ envelope nibble |
| "warmer bass", "growlier" | `wave(lane, table)` |
| "add vibrato", "wobble" | `motion(lane, 'wobble')` |
| "arpeggiate it", "chiptune chords" | `motion(scope, 'arp')` |
| "slide into it", "pitch drop" | `motion('Melody', 'fall' \| 'rise')` — Melody only; it needs channel 1's sweep unit |
| "echo", "delay" | `motion(scope, 'echo')` |
| "punchier drums", "snappier snare" | `drumSound(kind, {noise, fade})` |
| "pan it", "wider" | `pan(lane, position)` — a running NR51 write |

### 8. Iteration and judgement

The conversation is mostly this, and it is cheap to support because every
transform already returns a **new** song id and leaves the old one alone.

| what they say | what it needs |
| --- | --- |
| "go back", "the previous one was better" | version history per session |
| "keep the drums, redo the melody" | scoped rewrite (already covered) |
| "somewhere between those two" | `blend(a, b, amount)` — worth prototyping, may not be musical |
| "give me three options" | `variations(song, op, n)` |
| "what changed?" | `diff(a, b)` |
| "play it" | already there in WebMCP |

## The compound-word table

The part that makes or breaks this. Each adjective is a **named recipe of
primitives**, shipped in `capabilities()` so a model applies it consistently
instead of inventing one.

| word | recipe |
| --- | --- |
| happier | mode → major · tempo +8% · Melody register +1 · duty 50% · drums +1 density |
| sadder | mode → minor/aeolian · tempo −10% · Melody register −1 · longer fades · drums −1 |
| darker | mode → phrygian/minor · register −1 · wave table warmer · fewer high hats |
| brighter | duty 12.5–25% · register +1 · more hats |
| more epic | density +1 all lanes · Bass octave doubling · slower harmonic rhythm · builds |
| calmer | density −1 · swing on · tempo −10% · softer velocities |
| more intense | tempo +10% · density +1 · syncopation +1 · drums four-on-floor |
| dreamier | echo motion on Melody · longer fades · sparser drums · slower harmonic rhythm |
| more retro | narrower duty · arps instead of chords · no wave-table variety |
| funkier | swing on · syncopation +1 · sparser kick · ghost snares |

Two rules for this table:

1. **Every recipe is a list of primitives.** No recipe reaches into the composer
   directly, so anything a word does can be inspected, undone and explained.
2. **A word never means two things.** "Brighter" is timbre, not key. Where a word
   is genuinely ambiguous the tool asks rather than guessing.

## What this needs from each surface

**`src/api.js`** — a `transform(doc, ops)` entry point taking a list of
operations and returning a new document, plus `scopes` (bars, lanes, sections),
`vocabulary()` returning the tables above, and `diff(a, b)`. Sections need to
survive into the JSON so "the chorus" is addressable at all.

**MCP** — three new tools rather than forty:
- `transform(song, ops[])` — the primitives, applied in order
- `interpret(song, instruction)` → the ops it *would* apply, without applying
  them, so the model can show its working and the user can correct it
- `vocabulary()` — the tables, so the model reads the recipes instead of
  improvising

Plus session history for "go back", which the id map already gives us for free.

**CLI** — `chiptunes transform song.doc --ops ops.json`. Mostly for testing the
primitives without a model in the loop.

**WebMCP** — the same transforms against the song on air, so "make it happier"
works while you are listening to it. This is the demo that sells the idea.

## Order I would build it

1. **Scopes and structure in the JSON.** Nothing else is expressible until "bars
   9–16", "the Melody lane" and "the chorus" can be named.
2. **The unambiguous primitives**: tempo, transpose, mode, register, mute, copy,
   repeat, trim, length. All mechanical, all testable, no taste required.
3. **`vocabulary()` and the compound recipes**, built on 2. This is where
   "happier" starts working.
4. **Density and rhythm**: density, syncopation, fills, drum patterns.
5. **Melody rewriting**: rewrite with keepRhythm / keepContour / variation.
   Hardest to make good, needs the most listening.
6. **Sound design**: shape, fade, wave, motions, pan. Easy mechanically because
   they are register writes; the work is the word-to-register mapping.
7. **`interpret()`** last, once the primitives are trustworthy.

## Things to be careful about

- **Determinism must survive.** "Change the melody" has to be a *seeded*
  variation, not randomness, or you cannot get back the one you liked. Every
  transform takes an optional `variation` integer.
- **Never silently ignore an instruction.** If a word maps to nothing, say so.
  A model that reports "done" after doing nothing is the worst outcome here.
- **The chip's limits are not negotiable.** Four voices, one note at a time per
  lane, 32 KB. Transforms must validate and refuse rather than produce a song
  that will not fit or will not play.
- **This is production composition, not best-of-N.** The product contract allows
  candidate selection only in the offline generator. `variations()` returning
  three options for a person to choose between is a person choosing, which is
  fine; a transform silently generating ten and keeping one is not.
