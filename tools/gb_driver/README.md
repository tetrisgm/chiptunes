# Game Boy output path

The model's tokens **are** this driver's song format, so generation needs no
translation layer: sample tokens, write a `.gbs`, and a real Game Boy plays it.

- `tracker.asm` — the driver. Instruments carry the per-frame character (duty,
  hardware envelope, arpeggio tables) so the model emits ~15 notes/second
  instead of the ~200 register writes/second a Game Boy actually makes.
  Measured: raw register streams need 20-36k tokens per 60s song, which no
  practical context fits. The driver is where that compression lives.
- `notetab.inc` — generated GB frequency registers for MIDI 24..108.
- `write_tracker_gbs.py` — driver blob + note events -> valid `.gbs`.
- `driver.asm` — a minimal register-replay driver, kept as the simplest possible
  proof of the output chain.

Build (needs `rgbds`):

    rgbasm -o tracker.o tracker.asm && rgblink -o tracker.gb -n tracker.sym tracker.o

## Traps that cost hours

- **Writing `NRx2` without a retrigger does not change the running volume.**
  That is why instruments use the hardware envelope rather than per-frame
  volume writes.
- Arpeggio writes frequency **without** the trigger bit, or every frame
  re-attacks the note.
- `gbsplay` is an interactive player: it blocks forever unless stdin is
  redirected from `/dev/null`. Its `iodumper` only flushes on close, so
  `SIGKILL` loses the entire dump — use `SIGTERM`.
- A `.gb` ROM can be built from any `.gbs` with `gbs-master`. Its CLI wants
  GBDK-2020, but Homebrew's `sdcc` works if you build a `bin/` of symlinks
  including `.exe`-suffixed copies (SDCC derives helper names from its own
  executable name).

## v2: learned timbre

`tracker2.asm` replaces v1's 16 hand-picked instruments with **banks patched per
song**: 128 instruments, 16 wave tables, 16 arpeggio tables, all learned from the
corpus by `learn_instruments.py`. The v3 extractor discarded the two things that
most define Game Boy character — the wave table (channel 3's entire voice) and
arpeggio runs, which a collapse step was deleting as noise. Measured on the real
corpus: **20.3% of notes are ornamented** and there are **6,336 distinct wave
tables**.

Trap: the wave DAC (`NR30`) must be **off** while writing `$FF30-$FF3F` or the
writes are ignored, and reloading the same table mid-note clicks — so the driver
caches which table is loaded.

Instrument assignment quantises the envelope (volume and direction matter, the
exact period step does not), which cuts 26,058 distinct pulse timbres to 923.
Exact match still only covers 29.3% of notes, so tokenisation falls back to
**nearest timbre** rather than a default. The corpus used 63 of 64 instruments
in the historical bank; the current bank has 128 slots, and `check_chain.py`
verifies that the bank, tokenizer, writer, source, and assembled ROM agree.
The most common instrument remains only 10.9%, so the bank is genuinely
exercised — if generated output collapses onto a few instruments, that is
undertraining or greedy sampling, not the corpus.

## Note release (fixed 2026-08-11)

`NoteOff` originally wrote `$08` to NRx2. That leaves the DAC enabled (it is on
whenever `NRx2 & $F8` is non-zero) and, per the trap above, an NRx2 write
without a retrigger does not change a running note's volume — so the release
was a **measured no-op**: identical WAV output with and without it. The
correct sequence is `NRx2 = $00` (kill the DAC) followed by `NRx4 = $80`
(retrigger, which latches the channel off). Verified with `gbsplay -o iodumper`:
the release now emits `ff12=00` then `ff14=80` and no further writes.

`write_gbs_v2.build()` also never emitted note-offs at all — every channel's
last note ran to the end of the stream. It now holds for `tail` frames
(default 24) and then releases each channel that played. Note that `$00` is
**restart**, not stop: a `.gbs` loops forever by design, and the player decides
duration. Continuous audio past the song length is the loop, not a stuck note.
