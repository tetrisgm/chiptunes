# Local chip composition study

This offline tool turns a local NES/Game Boy VGM/VGZ corpus into compact,
deterministic musical observations:

```bash
npm run study:chips -- \
  --input ~/Desktop/radio-content/chip-originals \
  --platform nes,gameboy
```

Outputs default to ignored `chip-derived/analysis/`:

- `chip-patterns.json`: per-track evidence for human inspection.
- `chip-composition-studies.json`: the compact corpus model.

The command parses hardware register writes, so the Mac can study voices
separately without recording system audio. It measures tempo, rhythmic and
interval cells, register and density, phrase articulation, texture, section
change, pulse duty/envelope/sweep recipes, noise recipes, and exact 32-sample
Game Boy wave-channel tables.

The model deliberately contains no rendered audio and no absolute note
sequences. It is design evidence for improving the one composer, not a second
runtime composer, melody database, candidate selector, or lookup system.
Original files are read-only and never copied into the app or Git.

To rebuild the small oscillator/register patch bank used by the synth:

```bash
npm run study:chips -- \
  --input ~/Desktop/radio-content/chip-originals \
  --platform nes,gameboy \
  --bank-output default
```

The generated `src/chip-instruments.js` is the compact trained runtime model. It
contains relative interval/rhythm n-grams by hardware role, percussion masks,
tempo and phrase/form distributions, plus pulse, envelope, sweep, noise, and
wave-channel patches. It contains no absolute melody, full-song event stream,
PCM, or NES DPCM sample bytes.

The single composer deterministically samples this model from the song seed:
trained bass transitions inform harmony, trained role-specific interval/rhythm
cells create motifs, trained percussion masks create grooves, and trained
tempo/form statistics shape the arrangement. The worklet recreates the selected
patches with native duty, stepped 4-bit wavetable, LFSR noise, hardware-rate
envelope approximations, and pulse sweep behavior.

Use `--per-platform 100` for a quick representative pass, `--seconds 300` for
long-form study, or `--album text` to investigate one soundtrack. Outputs are
content-fingerprinted, and identical inputs and options produce identical
musical observations.
