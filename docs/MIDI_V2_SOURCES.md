# MIDI-v2 source registry

Snapshot: 2026-08-14. This registry separates four facts that must never be
collapsed into one checkbox: a collection is accessible, its files are valid,
its distribution terms permit the intended use, and the owner has approved it
for this experiment. Musical validity is measured by the score-v2 audit;
access and intended-use eligibility are recorded here before acquisition.

This is a provenance record, not legal advice. A dataset-level license or
access agreement does not by itself establish rights in every underlying
composition or arrangement.

## Admission states

- `proposed`: identified but not acquired or approved;
- `available`: bytes are locally available with a recorded source;
- `audited`: the score-v2 machine and preservation gates passed;
- `approved`: the owner has approved the recorded intended use;
- `eligible`: available, audited, and approved, with no known access-term
  conflict for the intended use.

Only `eligible` sources may be scheduled for Gate-B pretraining. The combined
receipt must name each source version and report its raw, rejected, duplicate,
family, split, and scheduled counts. Cross-source deduplication happens before
splitting, so the same song or arrangement family cannot leak through a second
collection.

## Current registry

### Owner-supplied VGM-MIDI collection

- Local identity: `<training-root>/Corpus-Midi\vgm-90k`
- Observed size: 74,552 `.mid`/`.midi` files.
- State: `available`; full score-v2 audit running. Not yet `audited` or
  `eligible`.
- Role: first preservation corpus and video-game-heavy component, not evidence
  by itself that a model has learned broad musical form.
- Authority note: owner supplied the local collection for this project. The
  final receipt still needs an explicit intended-use approval field rather
  than inferring approval from filesystem presence.

### Lakh MIDI Dataset v0.1 / LMD-full

- Official page: <https://colinraffel.com/projects/lmd/>
- Published facts: 176,581 MD5-deduplicated MIDI files; the publisher warns
  that a few thousand are likely corrupt. The dataset page declares CC BY 4.0,
  requests citation to Colin Raffel's 2016 thesis, says the files were scraped
  from publicly available sources, and notes that per-file copyright metadata
  is inconsistent.
- State: `proposed`; not downloaded and not owner-approved for Gate B.
- Technical role if approved: broad general-MIDI pretraining candidate. Use
  `LMD-full`, not the matched/aligned subsets, because this project needs MIDI
  scores rather than Million Song Dataset audio linkage.
- Required before use: record the downloaded archive's URL, version, size, and
  SHA-256; preserve the requested attribution; obtain the owner's explicit
  intended-use decision; run the same parser/oracle gates and cross-source
  family deduplication.

### MetaMIDI Dataset

- Official repository: <https://github.com/Metacreation-Lab/MetaMIDI-Dataset>
- Published facts: 436,631 MIDI files. Access is through Zenodo and prospective
  users must provide their name, institutional affiliation/contact, project
  name and location, and acknowledge that they will not share or distribute
  the dataset. Its maintainers now identify GigaMIDI as a superset.
- State: `proposed` and access-blocked. No request has been submitted and no
  acknowledgement has been made on the owner's behalf.
- Decision rule: do not invent institutional facts, accept terms, or acquire
  this source without the owner. Even if approved, measure its incremental
  unique-family yield after Lakh/VGM rather than assuming 436,631 useful new
  works.

### GigaMIDI v2.0.0

- Official repository: <https://github.com/Metacreation-Lab/GigaMIDI-Dataset>
- Official distribution: <https://huggingface.co/datasets/Metacreation/GigaMIDI>
- Published facts: 2,136,218 files and 6,891,738 tracks. The current release
  includes MetaMIDI, Lakh MIDI, and other sources. It is distributed under CC
  BY-NC 4.0, access requires sharing contact information and accepting stated
  conditions, and its declared use is non-commercial research or education.
- State: `proposed` and not eligible for a product-intended training lineage
  under the published non-commercial terms. It has not been accessed.
- Decision rule: do not combine it naively with Lakh or MetaMIDI; it already
  contains them. It may become a separately approved research-only experiment,
  but that decision must explicitly address the non-commercial restriction and
  whether its result can serve the intended product.

## Current corpus decision

Finish Gate A on the owner-supplied VGM collection before acquiring another
large source. If Gate A passes, adjudicate intended use and source eligibility,
then add the smallest source set that supplies real incremental musical-family
coverage. Based on currently published facts, LMD-full is the first candidate;
MetaMIDI and GigaMIDI are not automatic next steps. This avoids spending days
auditing redundant or unusable data before the representation itself is proven.
