# Generated Music Architecture

Reference for the generated-music path: **composer** (pure token → Score) →
**engine** (Score → sound) → **radio queue** (fingerprints → what plays next).
Authoring guide: `docs/composer-pack-authoring.md`.

## The pipeline

```
token '<phrase>-<code8>'         (src/seed.js, Song.V = 3)
   │  activeComposer()           (src/packs.js: CT_COMPOSERS[selected] || CT_COMPOSERS.rrr_core)
   ▼
compile(token) → Score           (src/composer.js = rrr_core, or any composer pack)
   ▼
Engine (src/audio.js facade) → generated-synth worklet v2 (src/lib/generated-synth-worklet.js)
   ▼
master chain (compressor → makeup → limiter) → analyser → vis() → games
```

Determinism is end-to-end: composers use per-stage seeded rng streams
(`mulberry32(hash32('rrr3:' + V + ':' + token + ':' + stage))` in rrr_core),
the worklet derives all per-note phase/noise state from event seeds, and
neither contains a single `Math.random`. Same token → identical Score →
identical audio. That's what makes `/track/<slug>` links shareable.

## Worklet v2 (`src/lib/generated-synth-worklet.js`)

Single-file AudioWorkletProcessor; the **only** synthesis path (the old
node-graph fallback is gone — `playRecipe`/`gameMelodyNote` route through it
too). Message protocol in:

```
{type:'palette', generation, voices?, percs?, echo?, panLayout?, samples?}
{type:'events',  generation?, events:[WEvent]}
{type:'echoTime', generation?, secondsPerBeat}
{type:'clearFuture', generation?, time?}
{type:'reset', generation?, paused?, mix?}
{type:'pause', paused} | {type:'mix', mix} | {type:'panic'}
```

Out: `{type:'status', generation, queued, voices, paused, renderTimePerBlock}`.

Capabilities (the timbre space composers design in):

- **Palette registration** — per-slot VoiceDefs/PercDefs + EchoDef, swapped
  atomically per generation. `partials[]` are baked to 128-sample one-cycle
  wavetables; optional `crunchBits` (4-bit = GB wave grit).
- **LFSR noise**, 15/7-bit with NES period table — authentic chip percussion
  and noise-voice identity.
- **Tick engine** (default 60Hz, per-voice `tickHz`): **arp tables**
  (`chip.arp:[0,3,7]` at `arpHz` 15/30/60 — the LSDJ chord), stepped vibrato,
  duty envelopes, retrigger.
- **Per-voice 2-pole resonant SVF** (lp/hp/bp) with envelope sweep
  (`envAmt`/`envT`).
- **Echo bus**: tempo-synced stereo delay with feedback, damping, ping-pong,
  stereo spread; per-voice/per-event `sendEcho`. **Dual generation-tagged
  lines**: at a track boundary the outgoing line freezes and drains while the
  incoming one starts fresh, and voices snapshot their line at note-start —
  true gapless transitions.
- **Stereo + pan**: equal-power panning, optional `hardPan` -1/0/1 (GB
  register style), per-slot `panLayout` defaults.
- **Parameterized percussion** (PercDef: pitch sweep, LFSR mode/period, body,
  click) — drums are designed per track, not fixed.
- **Sample voices**: registered PCM one-shots and short looped melodic
  samples (`osc:'sample'` + `sampleId`) — the SNES leg of the sound.
- **Per-event overrides** (`cut/cutMul/q/drive/sendEcho/pan/arp/dutyStart`),
  glide (`from`/`slideSemis`), per-event `seed`s; zero decision-randomness in
  the worklet.
- **32-voice cap**, quietest-steal.

Engine facade in `src/audio.js`:
`Engine.loadPalette / note / perc / setTempo / killAll / clearFuture / setMix`
plus `Engine.render(score)` → offline WAV via OfflineAudioContext **including
the master chain**, so rendered audio matches live loudness (used by the
audio-metrics harness).

## Composer v2 (`src/composer.js` — ships as the `rrr_core` pack)

Pure, Node-loadable via `vm`, registered as `CT_COMPOSERS.rrr_core`. Six
seeded stages: **A palette → B groove → C harmony → D motifs → E arrangement →
F compile** (details + rules in `docs/composer-pack-authoring.md` §5). Key
structural guarantees:

- Fills/breathers derive from the track's own pattern — nothing sits on a
  fixed 4/8-bar grid.
- Form grammar `HOOK DEV HOOK' CONTRAST STRIP BUILD PEAK [LIFT] OUT`, 95–165s,
  hook inside the first 2 bars; consecutive sections differ in ≥2 of {layers,
  register, motif-op, drum variant, loop position} — novelty by construction,
  no runtime watchdogs.
- PEAK sections carry energy 9–10; everything else ≤8 (drives `MV.isDrop`).
- Motif corpus cells are a single merged weighted pool — no per-platform
  keys survive into the composer.

`fingerprint(token)` runs stages A–C only →
`{bpm, keyPc, brightness, waveClass, grooveFamily, density, energyPeak,
echoDepth}`.

## Radio queue (fingerprint-driven continuity)

One mechanism, `src/runtime.js` + `src/radio.js`:

1. Mint K=8 candidate tokens (`Song.mint()`).
2. `activeComposer().fingerprint(t)` for each.
3. Score each candidate: novelty-distance vs the last 4 played fingerprints
   + a pacing arc + `Radio.bias(axis)` (user thumbs, stored per fp axis:
   `KNOBS = ['tempoBand','brightness','grooveFamily','waveClass','energy']`)
   + tempo neighborhood.
4. Play the argmax; `Radio.setCurrent(fp)`; thumbs up/down adjust the biases
   (localStorage `retrorave.radio.v2`).

There are no genres, stations, or instrument pickers — continuity and taste
both live in fingerprint space.

## What games see (unchanged contract)

`Audio.vis()` stays analyser-derived (bands, semantic roles, spectrum) plus
the composer-fed beat grid, `energyLevel`, hue/pulse, and `section` mapped
into the games' vocabulary: HOOK→'groove', DEV→'flow', CONTRAST→'bridge',
STRIP→'break', BUILD→'build', PEAK→'drop', OUT→'outro'.
`gameMelodyNote(vel, semis)` / `reactNote` keep their exact signatures over
the new engine state.

## Verification machinery

- **Symbolic** (pure Node): `scripts/audition-generated-music.js` vm-loads any
  composer pack — hook <10s, restatements ≥3, novelty diffs, zero register
  collisions, ≥1 section with energy ≥9, 90–180s; 200-seed histograms
  non-degenerate + a pairwise fingerprint distance floor; same-token
  determinism (compile twice, deep-equal).
- **Rendered**: `Engine.render` → WAV → `scripts/audio-metrics.js`: loudness
  curve (energy at 10s ≥70% of peak), spectral-flux self-similarity (drone
  detector), onset density, centroid variance, stereo correlation, clip check.
  ~24 golden seeds re-rendered every tuning round.
- **Human A/B**: `scripts/build-audition-page.js` builds a local blind page
  (`chip-derived/analysis/audition/`, never in dist/) against reference tracks
  in `chip-originals/refs/`.
