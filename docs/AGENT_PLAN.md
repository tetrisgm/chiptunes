# The agent API, reworked around what people actually ask for

**Status: plan.** Supersedes `AGENT_VOCABULARY.md`, which is folded in below as
the last tier rather than the first.

The first plan was a DAW: verbs like *"make it happier"*, *"repeat the melody"*.
That is what somebody **already holding a track** says. It is not what people ask
a music-generation service for, and it is not where this project's advantages
are. This is the rework.

## What people actually ask a music generator for

Watch how the audio-model services get used and the same handful of requests
come up:

1. **"Background music for my video / stream / game."** By far the most common.
   Wants: right length, right mood, no vocals, loops, and no licensing anxiety.
2. **"A whole soundtrack that hangs together."** Menu, overworld, battle, boss,
   game over. The hard part is not any one cue, it is that six cues sound like
   they came from the same game.
3. **"Exactly 45 seconds, and it has to loop."** Constraint satisfaction. People
   fight generators over this constantly and mostly lose.
4. **"The same theme, but sad, for the death screen."** Variation with lineage —
   recognisably the same music, different feeling.
5. **"Can I get the stems?"** For mixing, for ducking under dialogue, and for
   adaptive game audio.
6. **"Can I use this commercially, and can I prove where it came from?"**
7. **"Can I get that exact track back?"** Reproducibility.
8. **"Give me twenty and I'll pick."** Breadth, cheaply.

Almost none of that is note editing.

## Where this project is structurally better, and where it is not

Chiptunes cannot compete on fidelity, vocals, or breadth of genre. It should
stop trying. What it has instead is unusual and mostly unavailable elsewhere:

| | Chiptunes | an audio-model service |
| --- | --- | --- |
| Output | a **symbolic document**: notes, instruments, register schedule | an opaque waveform |
| Reproducible | the same token gives the same bytes, forever | usually not |
| Cost and latency | **1.6 ms**, free, local | tens of seconds, per-generation cost |
| Stems | **exact**, four hardware channels, verified below | ML separation, approximate, often paid |
| Loop points | native — a song carries `loopFrames` | inferred, or absent |
| Size | ~10 KB document, 32 KB cartridge | megabytes |
| Provenance | a deterministic algorithm you can read | a model trained on a corpus |
| Transpose / retempo / restructure | exact, symbolic | re-generate and hope |

Two of those are commercially decisive for the likeliest audience, which is
**people making retro games**:

- **Stems are free and perfect.** Measured, isolating each channel from one
  composed song: Melody peak 0.500, Harmony 0.250, Bass 0.250, Drums 0.251, each
  with real energy. This is not source separation, it is the four voices
  rendered apart. Elsewhere this is a paid, imperfect feature.
- **Provenance is clean.** The music comes from a deterministic composer in a
  public repository, not a model trained on other people's recordings. For a
  game developer worried about shipping AI music, that is the whole ballgame,
  and it should be stated in the API, the docs and the launch copy.

Also worth saying plainly: **generation is so cheap that breadth is free**, and
this should be the headline of the API rather than a footnote. Measured:

| | |
| --- | --- |
| compose a complete song | 1.6 ms |
| a thousand complete songs | 471 ms |
| build a 32 KB cartridge | 1.2 ms |
| render the audio | 103 ms for 40.7 s, i.e. 395x real time |

An agent can generate two hundred candidates, describe them all and present
five, inside the time a hosted model takes to acknowledge one request — and at
no cost. Nothing is uploaded to make music, there is no key and nothing is
metered, so an agent needs no credentials and cannot run up a bill. For an
agent-facing product those three properties matter more than any single
feature: **instant, free, and local** is what makes an iterative loop possible
at all.

> ⚠️ **Contract question for the owner.** `AGENTS.md` says production composes
> each seed once and best-of-N stays in the offline generator. An API consumer
> generating many and choosing is arguably a person pressing "next" quickly, not
> the product scoring its own output — but it is close enough to the line that I
> want a ruling before building `generate_many`. Everything else here is
> unaffected.

## The reworked shape

Five tiers, in the order people reach for them. The old plan was tier 5.

### Tier 1 — The brief

Not "compose(token)". A brief is what someone has in their head:

```
compose({
  scene: 'boss',              // the vocabulary game devs already use
  mood: 'tense',
  seconds: 45,                // or bars
  loop: true,
  key: 'D', mode: 'minor',
  exclude: ['Drums'],         // "leave room for sound effects"
  variation: 3                // seeded: explore without losing reproducibility
})
```

**Scenes are the single highest-value addition.** `title`, `menu`, `overworld`,
`battle`, `boss`, `cave`, `town`, `shop`, `victory`, `game_over`, `credits`.
Each is a named bundle of mode, tempo band, density, register and form. It is
how the audience actually asks, and it collapses a paragraph of prompt into a
word that behaves the same way every time.

### Tier 2 — Constraints that are guaranteed

The pitch is not "we try to hit your duration". It is that a symbolic composer
**can** hit it, and will tell you when it cannot:

- exact `seconds` or `bars`
- `loop: true` — seamless, with the loop point reported in samples and frames
- lane presence: no drums, bass only, melody plus bass
- `maxBytes` for the cartridge
- `resolve: true` — end on the tonic

Every one of these is checkable before returning, so the API either satisfies
the constraint or names the one it could not meet. That alone is better than
what people currently get.

### Tier 3 — Sets, which is the real differentiator

Nobody does this well, and it is the actual job:

```
soundtrack({
  scenes: ['title','overworld','battle','boss','game_over'],
  key: 'D', mode: 'minor',
  palette: 'shared',    // the same instruments across every cue
  motif: 'shared'       // and the same melodic figure, transformed per scene
})
```

A shared key, a shared instrument palette and a **shared motif** are what make
six tracks sound like one game. This is only possible because the music is
symbolic — you cannot transplant a motif between two waveforms.

### Tier 4 — Variants with lineage, and adaptive layers

```
variant(song, { mood: 'sad', keepMelody: true })     // the game-over version
variant(song, { intensity: +1 })                     // combat escalation
layers(song)                                          // vertical remix stems
```

Game audio middleware calls this vertical remixing: the same cue at several
intensities, or as layers you fade in as the action rises. Chiptunes can emit
the layer set natively because the layers **are** the four channels.

### Tier 5 — Deliverables

What actually leaves the building, and the metadata that makes it usable:

- `wav`, and `stems` → four WAVs, exact
- `rom` → the 32 KB cartridge
- `midi` → **proposed, new work**; the strongest missing export for anyone who
  wants to take it into a DAW or an engine
- loop metadata: sample and frame loop points, and a WAV `smpl` chunk so engines
  read the loop automatically
- a sidecar: token, key, bpm, bars, seconds, loop points, lane inventory,
  cartridge bytes, provenance line

### Tier 6 — Editing verbs (the old plan)

Still wanted, still last. Once someone has a track they like, they will want to
say *"the drums are too busy"* or *"repeat that bit"*. The vocabulary table, the
compound-word recipes (`happier` = major + 8% faster + register up + brighter
duty), and the scope model all stand — see the git history of
`AGENT_VOCABULARY.md`. The division of labour is unchanged: **the model
understands, the API provides the verbs.**

## The tools an agent needs, restated

Fewer and larger than the old plan:

| tool | why |
| --- | --- |
| `guide()` | The answers to the eight questions above: licensing and provenance, determinism, looping, formats, stems, constraints. An agent that has to guess these guesses wrong and tells the user something false. |
| `compose(brief)` | Tier 1 and 2 together. |
| `soundtrack(brief)` | Tier 3. |
| `variant(song, how)` | Tier 4. |
| `describe(song)` | Already built. The agent cannot listen; this is how it judges. |
| `export(song, what, path)` | Tier 5, including stems and loop metadata. |
| `transform(song, ops)` | Tier 6. |
| `song_to_json` / `json_to_song` / `validate` | Already built. The escape hatch to exact editing. |

## Build order

1. **`guide()` and provenance copy.** Cheapest thing here and it changes what an
   agent tells a user about licensing. Do it first.
2. **Stems and loop metadata.** Both already work at the engine level; this is
   plumbing plus a WAV `smpl` chunk. High value, low risk.
3. **Constraints**: exact seconds/bars, loop, lane exclusion, resolve.
4. **Scenes**, then `compose(brief)` on top of 3.
5. **`soundtrack()`** with shared key, palette and motif.
6. **`variant()`** and intensity layers.
7. **MIDI export**, if wanted.
8. **Tier 6 transforms**, last.

## What I got wrong the first time, kept here on purpose

The first plan optimised for the person editing a track and ignored the person
asking for one. It also ignored that this project's advantages are structural —
symbolic, deterministic, instant, license-clean, stem-native — and none of those
show up in a list of DAW verbs. If a future pass is tempted to lead with editing
again, the reason not to is that editing is the smallest part of how these
services are used.
