# Live music playback

The Create music API is in `src/audio.js`; the actual revision transition runs in
`src/lib/gb-chip-processor.js` through the shared `CT_GB_APU.Sequencer`.

## API

- `musicPlay(gb, {revision, loop, offsetFrames, boundaries})` returns a Promise
  resolving to `true` after posting; superseded initialization resolves `false`.
  Failures reject. Playback starts at the clamped offset, not a queued boundary.
- `musicQueue(gb, {revision, baseRevision, boundaries})` returns `true` after
  preparation/posting; invalid or stale input throws. It inherits audition looping.
- `musicCancel(revision)` cancels the pending occurrence of that revision.
- `musicPause(bool)` freezes/resumes the sample and boundary clocks.
- `musicSeek(frame)` cancels pending work and resets/reconstructs register state
  at the clamped frame, retaining paused state. It returns `false` without an
  acknowledged current revision, otherwise `true`.
- `musicStop()` invalidates pending initialization/queue work and stops the chip.
- `onMusicState(listener)` returns an unsubscribe function.
- `musicBoundaries(compiled, {fromFrame = 0, limit = 256})` selects upcoming bar
  frames. **For a queue, supply the currently playing revision's compiled result
  and latest acknowledged playhead**, not the edited revision or the first 256 bars.
  Conversion delegates exclusively to `CT_MUSIC_LANGUAGE.createClock(settings)`,
  the same function used by compilation. It returns a reusable `beatToFrame(beat)`
  function; the language also exposes `beatToFrame(settings, beat)` for one call.
  Notes rulers should use that shared clock, with zero-based bar `b` at beat `b*4`.

Revisions are nonempty strings up to 128 characters or safe integers. Undo/redo
may reuse a revision ID only for exactly the same canonical compiled GB data.
Each playback/queue attempt receives a distinct `activation` ID. The processor
also checks the base activation and session epoch, preventing stale attempts from
restarting playback or taking back radio ownership.

## Acknowledgment and boundaries

Return values mean submitted, not playing. Engine events contain
`{type: 'musicState', status, revision, activation, frame, epoch, ...}`.
`status: 'playing', reason: 'activate'` acknowledges the actual schedule swap;
`resetChannels` names explicitly reset hardware channels, indexed 0–3.
`declickSamples: 64` reports a changed-voice/gain output correction; zero means
this activation did not start a correction.
Pause/resume and seek also acknowledge transport state. `position` is a periodic
playhead observation. `prepared`, `queued`, `superseded`, `cancelled`, `stale`,
`loop`, `ended`, `stopped`, and `error` describe their respective engine outcomes.
Context `suspended`/`resumed` notifications are observations, not activation acks.
Ancillary events must not overwrite the UI's playing/paused transport state.

Boundaries are ascending integer GB frames on the old revision's timeline. The
processor swaps immediately before executing that frame's events. A missed
boundary is skipped; the next supplied one is used. Old song end is always a
fallback. Tempo edits retain the absolute GB frame, not the old beat/bar number.
The new schedule's future events then use its own compiled timing.

Shortening past the boundary clamps to the new end: finite playback ends there;
audition looping wraps to frame zero. Loop seams execute once on the sample
clock. Pausing or suspending processing cannot advance a queued activation.
Seek cancels pending activation and reconstructs state without replaying audio.
`playScore()` returns ownership to radio and invalidates pending music work;
legacy `playCreate` remains available with its existing restart semantics.

## Continuity and limits

Preparation, exact history comparison, register-state snapshots and kit synthesis
run on the page, never in the render callback. Unchanged channel histories carry
the existing APU, oscillator/envelope state, vibrato age, sample buffer/cycle
position, fractional frame clock and output capacitor. Future-only edits preserve
samples exactly until the changed event: tested waveform correlation **1**.

Changed histories/instruments/waves explicitly reset affected voices to prepared
register state. This is **not sample-accurate replay of the changed voice's past**.
For a live activation that resets a voice or changes gain, the processor captures
the previous output sample and adds `previous - new` to the first new sample.
That offset decays linearly to zero on the 64th sample (about 1.33 ms at 48 kHz).
This constant-work output correction removes the instantaneous boundary step;
it does not change APU state, replay audio, delay events or reconstruct the changed
instrument's musical history. No-op/future-only activations do not start it.
An already running correction continues across an intervening no-op activation.

This verifies waveform-transient smoothing, not universal perceptual click freedom
or changed-instrument musical continuity. Fast waveform slopes remain possible.
Initial play, seek, pause/stop and finite-end silence are not smoothed by this
activation correction. Seek resets voice state. Unaffected sustained voices are
not retriggered, although the summed output includes the brief correction offset.

`gb.gainScalar` defaults to 1 and accepts finite values 0–1. The shared Sequencer
scales output once, after APU mixing, for live and WAV rendering. Exporters must
not apply it again. Unity/omitted gain preserves existing samples exactly. The
64-sample live activation correction is outside the Sequencer and does not alter
standalone WAV exports.

Current live limits: 216000 frames; 50000 input events; 128 scheduled operations
per frame; 8 million serialized GB characters; 256 supplied boundaries (plus an
internal terminal fallback); eight retained unacknowledged/current schedules;
16 million canonical revision-identity characters per session. Preparation is
synchronous but bounded. The language source limit is 1048576 characters and
its duration limit is aligned to the live engine's 216000 frames.

`node scripts/verify-music-live.js` tests the actual processor with simulated
audio callbacks, including waveform continuity, long-song selection, transport,
stale messages, undo/redo, ownership and failures. It does not prove real-browser
background delivery, device output, listening acceptance or arbitrary-edit
click freedom. Release/browser acceptance remains separate from these checks.
