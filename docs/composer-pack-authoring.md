# Composer Pack Authoring

The generator itself is replaceable. A composer pack is a pure JS module that
turns a track token into a **Score** — the full deterministic event stream the
synth engine plays. The app's default composer, **`rrr_core`**
(`src/composer.js`), registers through the exact same registry and is published
to `dist/packs/composers/rrr_core/` at build time as the reference example.
Study it.

Companion docs: `docs/generated-music-architecture.md` (engine + pipeline
reference), `docs/pack-format.md` (manifest/distribution).

## 1. The contract

Your entry file (conventionally `composer.js`) registers:

```js
window.CT_COMPOSERS = window.CT_COMPOSERS || {};
CT_COMPOSERS['<id>'] = {
  V: 3,
  compile(token)     // -> Score
  fingerprint(token) // -> Fingerprint
};
```

- `compile(token)` — the whole track. Called by the audio engine when a track
  starts (`activeComposer().compile(token)`).
- `fingerprint(token)` — a cheap summary used by the radio queue: it mints K=8
  candidate tokens, fingerprints them all, and scores by novelty-distance vs
  the last 4 tracks + pacing arc + the user's radio biases + tempo
  neighborhood, then plays the argmax. Your fingerprint must be consistent
  with what compile actually produces, and much cheaper to compute (rrr_core
  runs only its first three stages for it).

**Fingerprint shape** (all axes required — the radio knobs bias on them):

```js
{ bpm,            // number
  keyPc,          // 0..11
  brightness,     // 0..1
  waveClass,      // string, e.g. 'square'|'saw'|...
  grooveFamily,   // string, e.g. 'four'|'backbeat'|'break'|'halftime'|'gallop'
  density,        // 0..1
  energyPeak,     // 0..10
  echoDepth }     // 0..1
```

**Tokens**: minted by the app as `<phrase>-<code8>` (Song v3). When your
composer is active (non-default), deep links carry your id:
`/track/<yourId>.<phrase>-<code8>`. You never parse meaning out of the token —
you hash it.

## 2. Determinism rules (non-negotiable)

- **Pure function**: no DOM, no WebAudio/AudioContext, no `fetch`/storage, no
  reading app globals. `pack-tools composer validate` rejects these statically.
- **No `Math.random`, ever.** Seed everything from the token. The idiom
  (rrr_core's, and the scaffold's) is one rng stream per stage:

```js
function rng(token, stage){ return mulberry32(hash32('<id>:3:' + token + ':' + stage)); }
```

  so editing one stage doesn't reshuffle the others.
- Same token → deep-equal Score, every time, forever within a version. The
  audition harness compiles twice and diffs. `/track/` links are a product
  feature; breaking determinism breaks them.
- Node-loadable: the entry is also loaded via `vm` by the symbolic audition
  tooling — keep it a plain IIFE against `window || globalThis`.

## 3. Score schema

```js
{ V: 3,
  token: '<the input token>',
  bpm: 138,
  beatsPerBar: 4,
  palette: {
    voices: { '<slot>': VoiceDef, ... },   // melodic slots, e.g. lead/bass/chord/pad/counter
    percs:  { '<slot>': PercDef, ... },    // percussion slots, e.g. kick/snare/hat/extra
    echo:   EchoDef | null,
    panLayout?: { '<slot>': pan }          // per-slot default pan, -1..1
  },
  sections: [ { name, startBeat, bars, energy }, ... ],  // form map for vis()
  events: [ WEvent, ... ] }                // time-ordered, beats or seconds per engine contract
```

Section `name`s use the composer vocabulary
`HOOK DEV CONTRAST STRIP BUILD PEAK OUT`; the runtime maps them onto the
games' existing section words (HOOK→'groove', DEV→'flow', CONTRAST→'bridge',
STRIP→'break', BUILD→'build', PEAK→'drop', OUT→'outro'). Only PEAK sections
should carry energy 9–10 (others ≤ 8) so the games' drop detection fires.

`src/lib/generated-synth-worklet.js` is normative for VoiceDef/PercDef/
EchoDef/WEvent — its `_normVoice`/`_normPerc`/`_normEcho` functions clamp and
default every field. Summary:

**WEvent** — one note/hit:
`{ time, slot, freq, vel, dur, seed?, accent?, pan?, from?/slideSemis? (glide),
arp? (override), dutyStart?, cut?/cutMul?/q?/drive?/sendEcho? (per-event
overrides), data? }`. Give every event a `seed` — the engine derives all its
per-note phase/noise state from it.

**VoiceDef** — a melodic instrument:
`{ osc: 'pulse'|'tri'|'saw'|'sine'|'wavetable'|'noise'|'sample',
duty, partials?/crunchBits? (wavetable: additive partials baked to a one-cycle
table, optional 4-bit GB grit), sampleId?, noise?: {mode:15|7, period:0..15,
followFreq}, detune, sub, env: {a,d,s,r}, glideT,
vib?: {rate, depth, delay}, chip?: {arp:[semis...], arpHz:15|30|60, tickHz,
dutyEnv:[...], dutyEnvLoop, retrig},
filter?: {type:'lp'|'hp'|'bp', cutHz|cutMul, q, envAmt, envT},
pan?/hardPan?, sendEcho, drive, gainMul }`.
`chip.arp` at 30/60Hz is THE LSDJ sound — use it.

**PercDef** — a parameterized drum:
`{ kind: 'kick'|'snare'|'hat'|'tom'|'zap',
tone: {freq, end, sweepT, level, decT, osc},
noise: {mode:15|7, period, level, decT, hp},
click: {level, decT}, gainMul, pan?/hardPan?, sendEcho, drive }`.
Design your drums per track — there are no fixed drums in the engine.

**EchoDef** — the tempo-synced stereo delay bus:
`{ beats, fb, damp, level, pingPong, spreadMs, timeS? (absolute override) }`.

## 4. Workflow

```bash
node scripts/pack-tools.js composer scaffold my_comp --name "My Composer"
#   -> packs/composers/my_comp/{pack.json, composer.js}  (registering stub)
node scripts/pack-tools.js composer validate packs/composers/my_comp
node scripts/pack-tools.js zip packs/composers/my_comp
```

`composer validate` checks the manifest, that the entry registers
`compile`/`fingerprint` into `CT_COMPOSERS`, and the purity rules (no
document/AudioContext/Math.random/app-Audio/fetch).

Test it end to end: sideload the zip (drag onto the app), pick it in the Packs
panel's active-composer picker, and hit Start Endless Radio. The symbolic
audition harness (`scripts/audition-generated-music.js`) can vm-load any
composer pack and run the same battery rrr_core faces: hook inside 10s,
restatements, novelty diffs, zero register collisions, ≥1 section at energy
≥9, 90–180s length, non-degenerate 200-seed histograms, same-token
determinism.

## 5. How rrr_core is organized (steal this structure)

Six seeded stages, one rng stream each:

- **A palette** — samples a continuous engine space (brightness / grit /
  era-flavor macros) into per-role VoiceDefs/PercDefs/EchoDef + pan; register
  plan bass 36–52 / chords 52–76 / lead 60–88; gain budget.
- **B groove** — tempo ~N(138,22) clamped 92–188; swing; drums generated
  *within* abstract skeleton families {four, backbeat, break, halftime,
  gallop}; fills derived from the track's own pattern (never a fixed 4/8-bar
  grid).
- **C harmony** — key uniform; mode weighted by brightness; degree-walk
  chord-loop grammar with a guaranteed cadence; optional final LIFT.
- **D motifs** — a 1–2 bar hook from contour-shape / corpus-cell /
  chord-tone-skeleton generators, with a singability reject-resample; bass,
  arp, and counter lines derived from the hook; invert / retrograde /
  fragment / augment as the variation vocabulary.
- **E arrangement** — form grammar `HOOK DEV HOOK' CONTRAST STRIP BUILD PEAK
  [LIFT] OUT`, 95–165s, hook inside 2 bars; consecutive sections must differ
  in ≥2 of {layers, register, motif-op, drum variant, loop position} — novelty
  by construction.
- **F compile** — the deterministic event stream + gain normalization.

`fingerprint()` = stages A–C only.

## 6. Sharing

Composer packs are code — sideloading one shows the user a one-time consent
confirm (see `docs/pack-format.md` §7). Share as a zip today; PRs adding
first-party composers are welcome if they pass `composer validate` and the
audition battery. Steam Workshop distribution later uses the same folder,
unchanged.
