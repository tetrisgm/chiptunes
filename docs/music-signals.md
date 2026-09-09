# Live music signals for the visual stage

Local implementation, 2026-09-09. This is the music-to-visual interface, not a
second player, a source evaluator, or a claim of Tidal/Hydra compatibility.

## Authority and ownership

The existing GB sequencer is the only command source. Its optional observation
buffer is enabled by the live-music processor, after page preparation and seek
replay. Offline, radio and cartridge rendering do not enable that buffer.
Observation adds no register writes, oscillator resets, random decisions or
callbacks into user code. Page preparation retains source indices but excludes
that metadata from sonic-history comparisons during live handover.

The processor batches observations and announces activation, loop and seek
discontinuities. The page accepts only the audio-acknowledged epoch, activation,
revision and discontinuity, checks sequence continuity and source references,
then publishes detached scalar records to a bounded journal. A pending revision,
invalid draft or preview compilation cannot publish sounding events.

## Independent event readers

`Audio.musicEventReader({replay:false})` creates a tailing reader. `replay:true`
starts at the oldest currently retained record. Each reader owns its cursor;
there are no subscriptions, reader registry, callbacks or timers.

```js
const reader = Audio.musicEventReader();
const {events, dropped, reset, generation, cursor} = reader.read(256);
// Consume this result once. A second read returns only newer records.
reader.close();
```

`read` defaults to 256 records and permits 1–512. The journal retains at most
2048 records (the generic module supports a configured 1–4096). `dropped` counts
that reader's unread journal overflows exactly, once, including overflows before
unseen clears. `reset` distinguishes an intentional clear from overflow.
`generation` changes on clear; `cursor` is the internal journal sequence, **not**
the source `event.sequence`. Stop/new Play and acknowledged seek clear history.
Activation and loop retain ordered transport markers so readers can inspect
the transition. A closed reader cannot read again.

Each executed-command record includes:

| Field | Meaning |
| --- | --- |
| `id` | `epoch:activation:discontinuity:sequence`; unique occurrence, including loops |
| `revision`, `activation` | Validated music revision and its particular acknowledged activation |
| `sequence` | Monotonic command number within this discontinuity, starting at zero |
| `sourceIndex` | Original index in `gb.notes`, `gb.auto`, or `gb.kit`, according to kind |
| `frame`, `contextTime` | Native song frame and audio-render-context time in seconds |
| `channel` | Native channel 0–3; -1 for global register writes |
| `midi`, `durationFrames` | Declared note pitch/duration; null/zero when not declared |
| `velocity` | Effective post-mixer note velocity, or null for non-note commands |
| `strength` | Immediate chip channel level estimate, normalized 0–1 |
| `register`, `value` | Authored register write, or sample identifier in `value`; otherwise null |

Kinds are `noteOn`, `noteOff`, `continuation`, `sample` and `register`.
Muted/skipped note triggers are absent. Pulse pitch-only continuations are not
note-ons. A zero authored velocity can still produce positive chip strength:
the existing hardware conversion has a velocity floor. Multiple commands on
one channel/frame remain separate actual commands in execution order.

These are **executed commands**, not a promise each becomes an audible note.
Later same-frame writes, routing, envelopes, wave content and output processing
can change or silence their result. The stream does not manufacture pitches or
durations for raw register retriggers or samples. It does not enumerate the
automatic vibrato/kit-refill register traffic; sample starts and explicitly
authored writes are observed. Finite end/Stop are transport actions, not invented
source-indexed note-offs on all channels. Loop-boundary authored note-offs are
observed before the loop marker.

Transport records have `kind:'transport'`, identity, frame/contextTime and a
reason (`activate`, `loop`, `seek`, `playing`, `paused`, `ended`, etc.). A
processor batch retains at most 256 observations. Overflow advances source
sequence and is published as `kind:'gap', reason:'processor-capacity'`, with
`count`, `firstSequence` and `nextSequence`. It is separate from reader overflow.
Observation delivery failures retain that bounded buffer for a later attempt;
they do not throw through the PCM render loop. Exhausted observation/journal
counters fail closed rather than wrap and reuse identities.

## Read-only transport and measured audio

`Audio.musicVisualState()` returns the current acknowledged native frame,
revision, activation, epoch/discontinuity, status, derived musical grid and
`renderContextTime`. Reading never advances transport or drains a reader.
`eventStream` reports availability, accepted sequence, processor drops, rejected
batches and exhaustion. Its `clock.noteOns` is deliberately empty: a snapshot
cannot stand in for a consumable onset stream.

`clock.analysis` reads the existing internal master analyser **before EQ,
compression and limiting**. It does not create another AudioContext or request
a microphone. Analysis uses independent scratch buffers, without modifying the
radio's spectrum/onset detector. It returns detached values, cached for 1/30
second between transport discontinuities:

- `available`, `tap:'internal-master-pre-fx'`, `contextTime`;
- byte-waveform-derived `rms` and `peak`, plus 160 signed waveform samples;
- 64 averaged spectrum bins, sample rate, FFT size and spectrum-bin spacing;
- bass (20–250 Hz), mid (250–2000 Hz) and treble (2000–16000 Hz) band values,
  clipped to available FFT bins;
- `frequencyScale:'normalized-decibel-magnitude'` and analyser dB bounds.

The frequency values are averages of normalized byte/dB bins, **not linear
spectral power**. The [AnalyserNode frequency-data contract](https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode/getByteFrequencyData)
defines that scale. `clock.energy` is a bounded visual mapping of measured RMS,
not a per-channel measurement. Paused, suspended or unavailable analysis returns
zero level and empty arrays, never substitutes semantic note strengths.

`contextTime` refers to graph rendering. It does not compensate for speaker,
Bluetooth or display latency; this interface alone does not prove audiovisual
alignment at the audience's ears.

## Existing stage consumer

The runtime owns one independent reader and reads once per **draw**, not per
transport/snapshot query. It exposes fresh positive-strength note/sample
triggers and authored NRx4 retriggers through that frame's `clock.noteOns` and
role lanes. Register events retain their kind and unknown pitch/duration.
`roleSignal:'executed-command-strength-estimate'` distinguishes these role
signals from the measured master bands. Repeated reads do not spawn new notes.

The consumer accepts at most 512 pending triggers and 64 delivered triggers per
draw, waits for future context timestamps, and discards events more than 250 ms
late, paused events and obsolete epoch/activation/discontinuity records. Its
`eventDelivery` reports accumulated consumer drops, pending count and journal
generation. A hidden/Off stage resumes at the current performance rather than
replaying an unlimited burst. This is bounded visual catch-up, not lossless
audience rendering while the editor is hidden; that remains a separate gate.

Source verification lives in `verify-music-event-stream.js`,
`verify-music-executed-events.js` and the existing live/presentation checks.
`verify-music-signal-browser.js` tests the built app with real Chromium Web Audio.
Neither test class substitutes for deployed native Safari or physical output
latency/trackpad checks.
