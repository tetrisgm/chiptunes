# Native Game Boy extraction foundations

This directory retains only the source-data machinery that can support the
native-GB score-v2 adapter in
[`../../docs/MIDI_V2_PLAN.md`](../../docs/MIDI_V2_PLAN.md):

- exact VGM/VGZ register and trigger extraction;
- dataset construction and source hygiene;
- soundtrack-family hygiene and leakage-safe grouping;
- timing hypotheses and fine-timing preservation;
- composition/performance factorization;
- register round-trip verification; and
- training-split patch vocabulary construction.

Historical model architectures, training runners, probes, autopilots, packaged
executables, and prior plans were removed. None of the retained modules is an
active model-training entry point. The active learned-music design and its
bounded gates live in `docs/MIDI_V2_PLAN.md`.
