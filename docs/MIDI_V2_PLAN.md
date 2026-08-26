# MIDI-v2 score pretraining → Game Boy specialization plan

Owner goal set 2026-08-14: properly test the original two-stage hypothesis.
First learn music from the complete approved MIDI score corpus without reducing
it to Game Boy hardware; only after that model generates coherent music, refine
the same score model on native Game Boy music and realize its four voices as a
real `.gbs`.

This is a clean lineage. It does not resume a previous checkpoint or use an
onset-only reduced corpus.

## 1. Why the previous attempt did not test the hypothesis

The superseded reducer recorded note-ons only. It did not pair note-offs,
resolve sustain, retain durations, or preserve simultaneous polyphony. Before
training it selected one bass and two dense melodic streams, dropped the rest,
collapsed each selected stream to one pitch per video frame, and assigned Game
Boy roles. The model saw reduced arrangements, not complete MIDI music.

A chip-only baseline answered a different question: it contained zero MIDI and
received no MIDI-to-GB transfer. It is not a foundation for this lineage.

## 2. Target system

```
all approved MIDI files
  → exact SMF parser and canonical full-score records
  → compound bar/beat/note representation
  → MIDI-only ScoreLM pretraining
  → neutral General MIDI generation and listening gate
  → native-GB full-score continuation/fine-tune
  → constrained two-pulse + wave + noise realization
  → real .gbs
  → anchored blind listening and pretrain-vs-scratch decision
```

Pretraining and specialization share score semantics—time, duration, pitch,
polyphony, part, and dynamics—but not source distribution. MIDI pretraining is
100% MIDI. GB specialization is 100% native Game Boy. Foreign scores are never
rendered into muffled Game Boy covers and presented as the learned target.

## 3. Phase A — MIDI-v2 canonical score

### A1. Parser and data contract

Create a separate `score-v2` schema. For every valid SMF format 0/1 file,
retain:

- note onset and matched note end/duration;
- all simultaneous notes—no skyline/floor reduction and no voice limit;
- track, MIDI channel, program changes, drum channel, pitch, and velocity;
- tempo map, time signatures, key signatures when declared, and PPQ/SMPTE
  timing;
- sustain-pedal semantics, including extended note ends;
- track names and source metadata with unknown fields represented as NULL;
- controller and pitch-bend streams in the canonical record, even if the first
  model pilot excludes uncommon performance controls after measuring them.

Note-on/off pairing must handle overlapping same-pitch notes with per-channel
stacks. Malformed events are reported, never silently repaired. The original
file hash and canonical score hash ride with every row.

The first validation source is every syntactically valid file in the owner-supplied
74,552-file video-game MIDI collection. No file is excluded because it has too
many parts or too much polyphony. Exact duplicates are removed; malformed,
empty, or trivially short files are rejected with counted reasons.

### A2. Deduplication and splits

Use three fingerprints:

1. source-byte SHA-256;
2. exact canonical-event SHA-256;
3. a tempo/transposition-normalized musical fingerprint for near-duplicate
   clustering.

All members of a duplicate/arrangement family belong to one split. Splits are
by musical family, not filename or individual file. The audit fails on exact or
normalized family leakage into validation/test.

### A3. Compound representation

Do not serialize each note into five distant flat tokens. One causal sequence
element is a compound musical event whose input embedding is the sum of
factor embeddings and whose output uses factor-specific heads:

- event kind;
- bar delta and position within the beat at 96 PPQ resolution;
- track/part and program family;
- pitch or drum key;
- note duration;
- velocity;
- tempo/meter changes.

Events are ordered by musical time, then part and pitch. Simultaneous chord
tones are adjacent, so harmony is local. BAR and BEAT events make metric
position explicit. Compound events make a 4,096-event context cover far more
music than a comparable flat-token context. Benchmark 4,096 and 8,192 events on
the 16 GB GPU and choose the largest configuration that does not spill.

### Gate A — preservation before training

The corpus cannot touch the GPU until all of these pass:

- 100% of paired valid notes survive canonical round-trip;
- tempo, meter, program, drum, and sustain counts reconcile;
- token decode reproduces every represented field;
- median onset error ≤5 ms and p99 ≤20 ms;
- median duration error ≤10 ms and p99 ≤40 ms;
- zero exact/family split leakage;
- receipt reports files considered/kept/rejected, notes, polyphony, controller
  prevalence, duration distribution, sources, hashes, and split totals.

Render 30 stratified original-vs-score-v2 round trips through the same pinned
General MIDI synthesizer and soundfont, losslessly. Include dense orchestral,
drum-heavy, tempo-changing, and sustain-heavy files plus hidden repeats. The
gate passes only if there is no systematic original preference and no repeated
audible loss. A failure returns to the parser/representation; it never becomes
“noise the model can learn around.”

The preregistered oracle is 30 unique pairs—six each from dense, drum-heavy,
tempo-changing, sustain-heavy, and duration-stratified general music—plus six
hidden repeats. A/B sides are independently randomized. The listening portion
passes only when original is preferred on at most 6/30 unique pairs and at
most 2/6 in every stratum, at least 5/6 hidden repeats agree after choices are
mapped back to semantic sides, and the owner reports no repeated audible loss.
These are preservation/non-inferiority limits, not a claim that failure to
detect a difference proves mathematical identity; PCM hashes are reported
separately for every pair.

Execution record, 2026-08-15: the complete 74,552-file VGM-MIDI source audit
kept 42,669 family-deduplicated scores containing 112,327,372 notes. The exact
machine audit and all four corpus-wide timing limits passed with zero
cross-split family leakage. The 30-song listening oracle is rendered with six
hidden repeats; all 30 original/round-trip PCM pairs are bit-identical. The
owner listening/consistency verdict is the only unfinished part of Gate A, and
no GPU training from this lineage has started. Compact immutable receipts are
in `data/experiments/midi-v2-vgm90k-20260815/`.

The bounded ScoreLM checks then passed on the RTX 4080 SUPER: a 32-score,
500-step overfit reduced loss from 3.685 to 0.866, and the 100-step
production-shape benchmark remained finite while reducing loss from 3.618 to
1.688 at 16.88 steps/second and 697 MB peak allocation. The full-corpus 0.10
epoch pilot is not yet claimed: the streaming runner was added, but the shared
PC's current Windows Python environment developed stuck PyTorch import
processes before that pilot could start. No reboot or shared-infrastructure
repair was performed.

That pilot subsequently completed in the fresh isolated environment: 7,599
steps covering 0.10 of the 155,616,422 train-event budget took 1,471 seconds;
loss remained finite and fell from 3.834 to 1.008 (minimum 0.216). This is a
plumbing/early-collapse check, not evidence that the model has learned music;
the next required artifact is a neutral MIDI generation batch with anchors and
repeats.

The first neutral batch is now rendered locally: 12 generated MIDI samples from
the 0.10-epoch checkpoint plus four real MIDI anchors. All 12 generated files
parse as valid SMF; one is notably sparse (five notes), so this is an early
quality diagnostic, not a Gate-B pass. The generation receipt is preserved in
`data/experiments/midi-v2-generation-20260815/`.

Owner review of that batch failed decisively: all 12 generated songs received
1/9, while the four real MIDI anchors averaged 8.75/9. This is the first Gate-B
failure. It is not evidence to start a longer run or add more data; the next
step is to diagnose the generation/representation path and make one bounded
correction before repeating the neutral MIDI gate.

### A4. Build the complete approved MIDI corpus

After the representation passes Gate A on the first collection, inventory every
locally available or proposed MIDI source. Lakh, MetaMIDI, GigaMIDI, and any
other collection are candidates, not implicitly approved. A source enters the
combined corpus only after its access terms and intended-use eligibility are
recorded and the owner approves that use. Distribution-license metadata must
not be treated as proof of rights in every underlying composition. Ingest every
approved source through the exact same parser and record source, provenance,
license/permission status, raw/kept/rejected counts, and source version. Run
byte-level, canonical, and normalized-family deduplication across the combined
corpus—not independently within each source.

Repeat the machine audit and a stratified round-trip sample across every source.
Gate-B pretraining uses this full combined approved corpus. Its receipt reports
coverage separately for each source. “All MIDI” means every valid,
deduplicated, approved score is eligible and actually scheduled; it does not
mean silently including malformed files, duplicates, or material without
recorded authority.

## 4. Phase B — prove that MIDI pretraining learns music

### B1. Model

Create `ScoreLM` by reusing the measured RoPE/RMSNorm/SwiGLU/efficient-SDPA
Transformer blocks, initialization sanity check, atomic checkpoints, rollback,
and progress receipts from `gb_lm2.py`/`gb_pretrain.py`. Replace the flat
token embedding/head with compound field embeddings and field-specific output
heads plus a grammar mask.

Start with the existing ~53M-parameter scale. Model size is not increased until
the representation and end-to-end pilot pass. Transposition augmentation may
shift pitches and declared keys, but may not alter drums, durations, or chord
relationships.

### B2. Coverage, not “randomly sampled for a while”

Training uses a deterministic shuffled coverage schedule. A corpus epoch means
every eligible training track contributed at least one window; long tracks
contribute all non-overlapping windows before reshuffle. The receipt reports:

- unique tracks and events seen versus eligible;
- corpus-epoch fraction;
- optimizer step, loss, learning rate, events/second, and ETA;
- checkpoint step/age, host boot identity, GPU state, skipped batches, and
  stale threshold.

Process presence is never progress. The runner is manual, bounded to one
milestone, installs no task/trigger, and exits after generating its evaluation
set.

### B3. Cheap correctness ladder

1. Unit/property tests on tempo maps, overlapping notes, sustain, chords,
   drums, program changes, quantization, compound encode/decode, masking, and
   family splits.
2. Overfit 32 varied songs. Loss must approach the expected floor and seeded
   continuations must reproduce valid score structure. This tests plumbing,
   not generalization.
3. Run 100 timed GPU steps to measure memory and throughput and set the
   one-epoch wall-clock estimate.
4. Train to 0.10 epoch only to catch collapse/divergence and render four smoke
   samples.
5. If structurally healthy, train to exactly 1.00 epoch of the full combined
   approved MIDI corpus—every eligible track seen—then stop and render the
   listening batch.

### Gate B — neutral MIDI music

Render 12 uniformly sampled gate-valid generations through the pinned General
MIDI synthesizer, mixed blindly with four real MIDI anchors and four hidden
repeats. Machine gates may reject broken files but may not rank survivors.
Report raw usable yield over every generated seed.

Go to Game Boy specialization only if:

- usable yield is at least 75%;
- generated median is at least 4/9;
- at least 3/12 unique generations score at least 5/9;
- generated mean is within 2.5 points of the same-batch MIDI anchors;
- every hidden repeat agrees within one point, or the batch is repeated.

If this fails, the model has not learned music. No Game Boy conversion, larger
corpus, preference training, or multi-day run is allowed to obscure that fact.
One representation/debug correction is permitted; a second failed Gate B ends
this lineage.

## 5. Phase C — native Game Boy specialization

### C1. Native-GB score-v2

Build a native-GB adapter from exact hardware logs. Derive note starts and
durations from triggers, volume/DAC state, releases, and the next note; retain
hardware channel, instrument/wave/noise identity, frames, and metadata. Encode
the resulting four parts in the same compound score fields used by MIDI.

Before training, decode a stratified native-GB sample back through the existing
128-instrument driver/writer and compare it with the source event stream and
lossless source render. This is a separate oracle gate; no MIDI file is involved.

### C2. Controlled transfer experiment

Train two identical target-domain arms with equal GB tracks, windows, optimizer
steps, schedule, seed, and generation settings:

- **transfer:** initialize ScoreLM from the Gate-B MIDI checkpoint;
- **scratch:** initialize ScoreLM randomly.

Both arms train only on native GB score-v2. Generate matched seeds. Record all
four machine-yield outcomes (both usable, transfer-only, scratch-only, neither)
before conditionally sampling jointly usable songs.

### Gate C — did MIDI pretraining help Game Boy music?

1. A blind matched-seed A/B batch: 30 unique jointly usable pairs plus at least
   6 hidden repeats. Transfer must receive at least 21 choices across the 30
   unique pairs, win at least 70% of non-ties, and the two-sided exact test must
   be below 0.05; repeat agreement must be at least 75%.
2. A separate anchored absolute batch from the transfer arm: 12 unique
   generated songs, four real GB anchors, and four repeats.
3. Transfer-arm raw usable yield must be at least 50%.
4. Absolute generated median must be at least 4/9, at least 3/12 must reach
   5/9, and at least one must reach 6/9.

Gate C passes only when relative transfer benefit and absolute musical quality
both pass. A good A/B result between two bad arms is not success.

## 6. Compute and waiting budget

Before Gate C passes:

- no cloud GPU;
- no model larger than the measured pilot;
- no unbounded or multi-day training invocation;
- at most one MIDI corpus epoch for Gate B;
- target-domain arms stop at identical predetermined event coverage;
- status is checked through receipts at least every checkpoint, not inferred
  from Python/GPU presence.

The 100-step benchmark sets real ETAs before authorization. If any pre-Gate-C
GPU stage projects beyond six hours, reduce the pilot corpus/model while
preserving the causal comparison; do not begin and hope.

## 7. Files and durable artifacts

Expected new tools:

- `midi_score_v2.py` — SMF parse and canonical score writer;
- `audit_score_v2.py` — fidelity, dedupe, family-split, and coverage audit;
- `tokenize_score_v2.py` — compound-event corpus;
- `score_lm.py`, `train_score_lm.py`, `generate_score_v2.py`;
- `render_score_v2.py` — canonical score → MIDI for the neutral oracle/gate;
- `extract_gb_score_v2.py`, `score_v2_to_gbs.py`;
- manual bounded PowerShell runners and one combined status command.

Reuse unchanged where possible:

- efficient Transformer blocks and initialization checks;
- atomic progress/checkpoint/generation receipts;
- 128-slot GB instrument bank, driver, writer, and chain check;
- FLAC batch builder, blind review server, anchors, repeats, and verdict store.

Every gate lands a machine-readable receipt under `data/experiments/` and
owner verdicts under `data/verdicts/`. Large corpora, checkpoints, MIDI,
tokens, and audio stay on the PC/review storage and are never committed.

## 8. Final make-it-or-go decision

The project earns a full-scale MIDI corpus/model and preference stage only by
passing Gates A, B, and C in order. Gate C is the proof that full-score MIDI
pretraining caused better Game Boy music and that the result is independently
good enough to continue.

If Gate B fails twice, or Gate C fails after a valid Gate B, stop this learned
generation lineage. Preserve the renderer and evidence, but do not respond with
more data, more steps, or a larger model. At that point the honest product path
is a deterministic/hierarchical composer rather than another neural training
loop.
