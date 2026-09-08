# Phase 0 — Create fidelity audit

Audited 2026-09-08 on shared `main`, initial HEAD
`49ebfe68d6aacd9ec17c9cb500cbedf9b3219395`. Scope is characterization and the
representation contract only. No compiler, UI, playback, package, or migration
implementation is included. The pasted workspace plan's later phases remain
the main task's responsibility.

Other implementation work appeared in the shared checkout during the audit.
Those changes were not edited or reverted. Static findings below describe the
inspected legacy paths; the main task should re-run this characterization when
integrating its changes rather than treating this as a frozen checkout snapshot.

## Result

Neither readable API JSON nor packed Create state is an exact representation
of an arbitrary concrete `Score.gb`. Even `songFrom(score).gb` can differ from
`songOf(songFrom(score).code).gb`. Phase 1 needs an explicit event representation
carrying exact timing, ordered control streams, assets, and finite end, bypassing
the lossy grid import/rebuild when compiling explicit events. It can still feed
the existing player: this is a preserving representation of the existing score,
not another composer or musical runtime.

Run `node scripts/verify-create-fidelity.js` from the repository. It uses the
actual Node entry points and deterministic adversarial fixtures, makes no file
writes, and needs no build or browser. Each `LOSS` assertion passes when the
documented loss is reproduced; it is not a claim that fidelity passes. A future
fix should replace that characterization with a preservation assertion. The
script is deliberately not added to `package.json` or the existing suite.

## Boundaries and evidence

| Boundary | What survives | What does not |
| --- | --- | --- |
| `api.toJSON` → `api.fromJSON` (`src/api.js`, functions at 204/249 at audit start) | Base bpm, bars/grid, key/minor/swing; named lanes/pitch, grid len, already quantized velocity, instrument index, supported stamp/motion, dy/fd/wv/nz, explicit trigger true/false | `of`, `lf`, tempoAt/master, vb/sq/mp/pn/gl/kt/dt, noise width `ns`, exact sweep byte; combined motions reduce to one. No concrete streams/assets/end |
| `CT_CREATE.docFromState` → `docState` (`src/create.js`, encode/decode at 618/687) | Supported packed fields, including exact offset/duration within bit limits, tempoAt/master, sound/movement settings, trigger distinction | Arbitrary extra fields ignored; numbers quantized/masked/truncated; assets absent; title alphabet/length normalized; runtime `t` order labels reconstructed |
| `CT_CREATE.songFrom` (`importScore` / `buildSong`) | Non-overlapping melodic channel/pitch/instrument index, ordinary-tempo exact frame and melodic duration within limits, nonzero pulse sweep | Drum exact duration, detune, trigger state, priority/role, source bank bytes, explicit auto/vibOff/waveLoads/kit, gains, exact finite end, source groove/provenance. Overlap/no-pitch/out-of-grid events dropped |
| `CT_CREATE.songOf` (`buildSong`, at 452) | Deterministic reconstruction from supported packed state and current bundled bank | No arbitrary concrete event passthrough; drum `lf` ignored; channels can be reassigned on collision; conflicting voices muted; song end ignores tempo map |

`docState` and `docFromState` deep-copy via JSON; they do not expose or alias the
UI state. `songOf` returns null for an empty note list, including a kit-only song
whose materialization has no ordinary notes. Silence and kit-only compositions
therefore need an explicit valid finite-score contract, not a nonempty-notes test.

The existing `verify-song-document.js` onset matching checks channel/pitch/frame
with a percentage threshold; that does not establish exact duration, sound,
gain, controls, assets, or full-score equality. The readable fixture in
`verify-api.js` establishes its supported subset, not arbitrary-score fidelity.

## Reproduced characterization contracts

1. Packed `of=-32/+31`, `lf=1/4095` survive; rebuilding after a packed no-op is
   structurally identical. Readable no-op drops `of=3`, moving the onset three
   frames earlier, and replaces `lf=11` with a grid-derived duration.
2. Packed tempo changes `[[0,120],[16,80]]` and `master=5` survive; the latter
   becomes `gb.gainScalar=6/16`. Readable no-op resets the map to `[]`, master to
   null, and gain to undefined. Notes after a change move.
3. For four bars at 127 bpm with a change to 80 at row 16, note onsets use the
   piecewise clock but `totalFrames` remains `round(64 * baseFramesPerRow)`.
   It differs from the sum of the two tempo segments. `loopFrames` is set to
   that same total, coupling transport looping to the composition end.
4. Packed vb/sq/pn/gl/dt/sweep, wave mp, and noise ns survive. Readable JSON
   omits them. The fixture actually generates nonempty auto, vibOff and
   waveLoads; the readable no-op removes those streams. A named `fall` retains
   the gesture but changes an explicit `sweep=0x12` into `0x3E`.
5. Packed `kt=1` emits a kit event; readable JSON turns the cell into an ordinary
   noise hit. Kit selector storage is not kit-asset preservation.
6. Explicit trigger true, false, and absent survive packed/readable paths on
   plain pulse cells. Concrete score import drops false, turning a pitch-only
   event into an ordinary note. Absence must not be normalized to true:
   `gb-apu.js` and `gb-hardware.js` use presence for native envelope/vibrato and
   continuation behavior. Motion expansion is a separate path, not covered by
   this plain-cell preservation claim.
7. Packed velocity 0.731 becomes `round(0.731*63)/63`. Overflow silently maps
   offset 32 to -32, exact duration 4096 to absent, detune 48 to -16, and grid
   length 65 to implicit 1. A 64-entry tempo map truncates to 63; row 4096 wraps
   to zero. These are codec limits, not hardware limits.
8. Adding bank, auto, vibOff, waveLoads, kit, totalFrames or gainScalar to plain
   state does not preserve them: encode ignores those fields.
9. Concrete import preserves fixture melodic frame 31, duration 13 and sweep
   0x12, but loses detune 7, trigger false and priority 8 (becomes 5). Noise
   duration 17 is rebuilt from the drum default. `songFrom` builds before
   decoding its encoded string, so its 0.731 velocity differs from reopening.
10. Concrete import drops all four independently supplied control streams and
    both fixture gains (outer Score and gb). End frame 300 is rounded up to
    whole bars and loopFrames 0 becomes a nonzero loop length.
11. Changing the source instrument bytes and wave table while retaining the
    same instrument index does not survive import: the rebuilt song uses the
    bundled bank. An index alone is not instrument identity. Arp tables also
    come from the bundled bank (`freshSongBank`).
12. Same-channel overlapping source events silently reduce to one imported
    note. Distinct one-frame notes at frames 28 and 30 in the same display
    column both survive: preserve this useful existing behavior.
13. A drum `lf=37` is serialized faithfully but does not produce duration 37.
14. Repeated packed materialization is deterministic in one loaded runtime;
    input state and decoded copies remain detached.

## Packed inventory and limits

This is an inventory, not a recommendation to make the new language inherit
these limits. Bounds below follow the bit layout; the tests exercise the
critical timing/tempo/velocity edges above.

| State data | Current encoding |
| --- | --- |
| bpm | Integer 70–180; truncated/clamped |
| bars; cell c; tempo row | 12 bits; bars decode clamps to 1–4095; cell/tempo row wraps modulo 4096 |
| grid | Enumerated `GRIDS`; default 16; swing one bit |
| key/minor | Key decoded modulo 12; minor one bit |
| title | 48 characters maximum, restricted `TITLE_A` alphabet, trims on decode |
| tempoAt | First 63 accepted pairs; tempo 40–255; ordering not validated/sorted |
| master | Null or four-bit value 0–15; gain `(master+1)/16` |
| r/st/z/w | Row/stamp/fall/legacy long-note flags |
| inst | 8-bit index+1; representable explicit indices 0–254 |
| midi/ch | Seven-bit MIDI; channel+1 encoding; channel meaning also inferred from bank/stamp |
| len/vel/sweep | 1–64 integer steps; 64 velocity levels; 8-bit sweep |
| dy/fd/wv/nz/ns | Duty 2 bits; envelope 4; wave slot 5; noise pitch 4; noise width 1, with presence flags |
| u/q/g/f | One encoded command; z separate; arbitrary combinations are not preserved |
| vb/sq/mp/pn/gl | Boolean movement flags and 2-bit pan |
| kt/dt/of/lf | Kit selector 4 bits (build uses `(kt-1)&7`); detune -16–47; offset -32–31; exact length 1–4095, zero means absent |
| nt | 1=true, 2=false; absent is semantically distinct; version 15 |

State also contains editor/cache fields (cur/cmd/wob, t, rch/x, groove cache).
They are not an independent sound authority. Input array order must nevertheless
remain stable because allocation and coincident events can depend on order.

## Exact preserving representation required for Phase 1

Use a versioned, readable explicit-score form alongside shorthand. The minimal
musical payload must be able to express the following without passing through
the packed grid codec:

```js
// Schema sketch only; not executable language or an implemented API.
{
  formatVersion, languageVersion, compilerVersion,
  timing: { clockVersion, masterHz: 4194304, cyclesPerFrame: 70224,
            bpm, beatsPerBar, grooveTicks, tempoMap },
  endFrame, // exact finite boundary, separate from audition-loop transport
  gain: { scoreGainScalar, gbGainScalar }, // retain origin until semantics unified
  bank: { version, contentHash, instruments, waveTables, arpTables, meta },
  kitAssets: { version, contentHash, samples, rate, period },
  notes: [{ id, ch, frame, frames, midi, inst, vel, pri, det, sweep, trigger }],
  auto: [{ f, r, v }],
  vibOff: [{ f, ch }],
  waveLoads: [{ f, slot }],
  kit: [{ f, id }],
  provenance: { seed, prompt, composerRevision, instrumentBankFingerprint }
}
```

Requirements for that schema/compiler contract:

- Preserve exact integer frame onsets and durations on every channel, including
  noise. Grid rows are a derived view. No offset bit limits, duration saturation,
  cell deduplication, implicit rerouting, velocity rounding or role rewriting.
  Bound resources and reject unsupported values with diagnostics instead of
  silently masking. Preserve optional-field presence where meaningful.
- Preserve every note's physical channel, resolved instrument, MIDI, detune in
  period units, sweep byte, numeric velocity, priority/mixer role, and tri-state
  trigger. Retain explicit zero-volume triggers. Store stable IDs for source
  mapping/diffs separately from array order.
- Carry arbitrary explicit auto/vibOff/waveLoads/kit events, not only movement
  switches that approximate them. Preserve array order at coincident frames.
  The current sequencer applies note-offs before note-ons, then vibOff, wave
  load, kit, and register automation; automation retains same-frame order,
  while waveLoads/kit currently select the last array entry at a frame. Encode
  and test this policy before changing it. Do not sort by register or deduplicate
  writes as a presumed optimization.
- Carry actual instrument records and wave/arp tables, or immutable versioned,
  content-addressed assets that resolve to identical bytes. Preserve bank meta
  where lane/instrument interpretation uses it. Kit IDs need the same asset
  guarantee: kit PCM/rate is supplied externally by `CT_GB_KITS`, not by `gb`.
  Missing/mismatched assets must be an error. An unexplained packed document or
  regenerating a seed is not an explicit preserving representation.
- Keep tempo/groove and exact finite end. Use one authoritative shared clock
  conversion for shorthand, Notes, playback and exports. Existing Create
  uses `lsdjRowFrame` with per-segment rounding; an explicit no-op must not
  reinterpret already resolved frame events through that clock. Arbitrary tempo
  change positions need an explicit unit and phase policy. Preserve imported
  groove/provenance rather than inferring them from bpm alone.
- Resolve gain semantics explicitly. Composer emits outer `Score.gainScalar`;
  Create master emits `gb.gainScalar`. Inspection of `Audio.playCreate` shows
  neither forwarded gain nor gain application there (chip gain set to 1), and
  the APU renderer does not consume gainScalar. Merely preserving the field
  cannot prove audible master fidelity. This is static evidence, not a fresh
  browser/listening test; a later playback contract must define where gain acts.
- Keep finite song end distinct from audition looping. Define handling of
  events/tails beyond the end and accept finite silence. Reject or explicitly
  report chip conflicts; never draw silently dropped notes as playable.
- Preserve comments/draft/source independently of derived score. Provenance is
  explanatory, not a directive to compose again. NativeDocument byte-preserving
  imports remain a separate authority and must not be flattened by this schema.

For legacy state migration, compile the *decoded* document once and materialize
that actual score into explicit events; report known historical losses without
claiming to recover discarded information. For newly generated scores,
materialize the composer's concrete output directly before `songFrom` loses it.
Never use readable `toJSON` as the canonical intermediate for either path.

## Verification scope

Observed checks: all 18 characterization groups passed; `node --check` passed.
Existing `verify-automation.js` passed its browser-engine/cartridge register
checks, and `verify-apu-manual-envelope.js` passed 54 channel/volume/lock cases,
retriggers and three write-order cases. These checks do not launch a browser.

The standalone characterization is structural Node evidence. It does not claim
new compiler acceptance, browser/Node equivalence, audio correlation ≥0.995,
seamless revision handover, native LSDj conversion fidelity, or listening/Safari
acceptance. Those remain subsequent gates. Full `npm test` invokes a build and
many unrelated suites; this scoped audit does not modify its registration or
generate a new web artifact.
