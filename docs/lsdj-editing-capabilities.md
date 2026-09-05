# LSDj editing capabilities audit

This is an evidence map, not a claim of full LSDj parity. It separates native
song/model fields, the JSON/document projection, Create controls, and what an
edit can preserve on a subsequent export.

## Executive summary

The native codec reads a 32 KiB song image into a structured model and retains
the original `raw` bytes. `writeSong(readSong(bytes))` is therefore byte
identical for fields outside the edit model as well as for mapped fields
(`src/lsdj.js`; the native round-trip cases are exercised in
`scripts/verify-lsdj-native.js`). That is preservation of bytes, not
proof that the browser can expose or play every field.

Create is a cell/grid editor. Its picker exposes named sound presets and a
small set of per-cell fields; it does not expose native phrase/chain editing,
raw command editing, instrument-slot editing, or arbitrary native instrument
bytes. The public native import path is `api.fromLsdsng` -> `toSongJSON` ->
`api.fromJSON` (`src/api.js`, `src/lsdj.js`, `src/api.js`), not
`create.js#importScore` (the separate Score-to-Create path). Rows/events which
have no cell equivalent are warned about or expanded where explicitly
supported.

The arrangement projection now uses canonical row-zero end-marker traversal,
not every stored reference: `arrangementRows` stops at sequence/chain ends,
and repeats independent channel cycles to their common period. Declared empty
tails survive document export and import, including wholly blank documents.
Raw `sequenceRows` and legacy `playedNotes` remain structural inspection APIs.
This does not interpret jumps or establish persistent sound/tempo state at the
final loop boundary. The flat document still limits row addresses to 4,096
and tempo commands to 63; imports exceeding those limits reject explicitly.
See `scripts/verify-lsdj-arrangement.js` for bounded native-ROM evidence.

## Capability matrix

| Area | Native/raw model | JSON / projection | Create control and edit preservation |
|---|---|---|---|
| Instrument selection vs trigger | `phraseInstruments` stores the raw per-row slot. `playedNotes` separately reports raw `instrument`, effective selected instrument, and `instrumentOnlyChange` (functions in `src/lsdj.js`). | Native instrument slot identity is not generally carried as a stable JSON authoring identity. A trigger boolean/`nt` is distinct from slot selection; empty instrument-only rows are structural input, not ordinary notes. | No native slot picker. Sound edits create/reuse a synthesized bank record; deleting/editing a cell can remove its exact native association. Trigger semantics are not a general Create control. |
| Pulse duty | Native instrument byte 7 is modeled; exporter writes duty for generated pulse instruments. | Cell `dy` / bank record can represent the four duty values. | `Shape` buttons edit `dy`; preserved for a generated/exported instrument (`src/create.js`, `soundPanel` and `editValue`; `src/lsdj.js`, `fromDocument`). Not a proof of arbitrary native bytes. |
| Envelope / fade | Native byte 1 is available in `instrumentParams`; importer interprets the envelope nibble as a measured hold-length table (`src/lsdj.js`, `ENVELOPE_HOLD`). | Cell `fd` represents the editor’s fade/hold abstraction. | `Fade` control edits the limited `FADE_STEPS`; it is not an arbitrary native envelope editor. The `fromDocument` exporter writes a plain sustain shape rather than reproducing arbitrary native envelope stepping. |
| Pan | Native instrument pan bits and phrase `O` command bytes are retained/modelled; command execution is separate from byte retention. | Native command rows retain command/value; Create cells use `pn` (`src/create.js`). | `Pan L` / `Pan R` are exposed as per-cell “while it sounds” moves. This is a document automation, not a general LSDj command-row editor; preservation of foreign pan command placement after a Create edit is not established. |
| Wave RAM versus tables | The `waves` region is a bank of 256 stored 16-byte waveform frames, distinct from the hardware's active 16-byte wave RAM. LSDj tables are separate mapped regions: `tables0..2` plus table command/value regions (`src/lsdj.js`, `FIELDS`). | `tableOf` reports an enabled table only when a transpose entry is nonzero; an enabled all-zero-transpose table whose commands change volume/duty is currently ignored. `expandTables` uses average groove timing and can skip ticks/cells when placement does not fit (`src/lsdj.js`, `tableOf` and `expandTables`). | Picker exposes a wave slot/name, not wave-RAM authoring or table-row authoring. `Morph` is a Create motion; it does not expose arbitrary table commands/values. Expanded table notes are not equivalent to preserving the original table program. |
| Noise | Native instrument params carry noise pitch/width and envelope bits. | JSON can carry drum identity through instrument-derived data. | Picker exposes `Noise` Free/Metal, pitch, fade, plus named noise presets (`src/create.js`). It also exposes optional kits. These controls preserve the editor’s synthesized noise record, not every native noise byte or command. |
| Kits | Native instrument type has a KIT value, but kit sample data is ROM/runtime-dependent; a `.sav` does not contain kit samples (comments and warnings in `src/lsdj.js` exporter; verification note at `scripts/verify-lsdj-native.js`). | Cell `kt` identifies a selected kit/sample path. | Kit buttons are exposed for drum cells; selecting one marks `kt` and bypasses noise settings (`src/create.js`, `1999-2007`). Exact native kit sample identity/ROM behavior is not proven by this audit. |
| Command-only rows | Native command/value arrays are mapped. `walkSequenceRows` returns rows with no note, including instrument-only and command-only rows (`src/lsdj.js`). | `toSongJSON` reports command-only events and warns for commands it cannot apply; `K` is used to recover note stopping. The focused fixtures verify instrument-only, `T` command-only, and `K` rows (`scripts/verify-lsdj-native.js`). | Create has no visible command-row grid. Some musical motions are represented as cell flags, but arbitrary command-only rows are not authorable or guaranteed to survive a cell edit. |
| Tables (as distinct from wave RAM) | Raw/model fields exist, and enabled table detection plus limited expansion exists. | Table notes can be expanded to frame-positioned cells using groove/tempo timing, with the `tableOf` and `expandTables` limitations above. | No table editor. Table expansion is not equivalent to preserving/editing the original table program. |
| Groove / tempo changes | Song tempo and raw grooves are modeled as 32 slots × 16 entries; phrase `T`/`M` command data is also modeled. `toSongJSON` derives tempo/groove information; native fixtures verify a mid-song `T` (`scripts/verify-lsdj-native.js`, the `T`/`M` fixture). | Base `bpm`/groove are represented; mid-song changes are not ordinary Create cell fields. | Create has a global speed control and uses its own document groove, but no visible per-row tempo-change editor. A foreign song’s mid-song tempo command is therefore not authorable through Create and its exact placement is not guaranteed after projection/edit. |
| Phrase / chain reuse | Sequence, chain phrase references, chain transpose, phrase allocation, and phrase rows are mapped. Structural walking preserves each occurrence’s source addresses (`src/lsdj.js`; `scripts/verify-lsdj-native.js`). | `toSongJSON` follows occurrences into a flat note/event projection; repeated phrases may be deduplicated/reused by native export, but the JSON is not a full phrase/chain authoring model. | Create edits a linear bar/cell timeline. Add/duplicate/delete bar operations operate on cells, not native phrase or chain slots. No UI control exposes phrase reuse, chain rows, per-occurrence transpose, or sequence order as LSDj structures (`src/create.js` bar operations). |

## Important preservation boundaries

* A native import can be byte-preserved by the codec while still losing
  authoring semantics when converted to Create. `raw` is the safety net for a
  native model round trip, not for a Create edit.
* Instrument selection is stateful in LSDj: an empty-note instrument row can
  change the selected instrument for a later note. The importer explicitly
  distinguishes this from a trigger; do not summarize `inst` as “the note
  triggered that instrument.” `effectiveInstrument`/`instrumentOnlyChange` are
  native projection facts; JSON trigger/`nt` state is separate from them.
* Create’s `vol` is a cell-level UI level and its sound record is synthesized
  from the editor fields. LSDj’s native volume/envelope behavior is not the
  same abstraction; no claim of arbitrary envelope fidelity is supported.
* Native commands, tables, and kit behavior can be retained in raw bytes or
  represented as warnings/derived cells without being editable in the Create
  UI. The verification script itself calls out unsupported table/command
  execution and checks warnings (`scripts/verify-lsdj-native.js`).

## Explicit unknowns / not established here

1. Whether every foreign instrument parameter byte, including uncommon pulse
   sweep/length/transpose combinations, survives a Create import followed by
   an edit and export.
2. Whether all native command interactions (especially stateful commands and
   cross-channel timing) can be reconstructed from the flat JSON projection.
3. Whether a foreign table can be edited and re-exported as the same table
   program rather than as expanded notes. Known current behavior is narrower:
   `tableOf` misses enabled all-zero-transpose tables whose commands alter
   volume/duty, while `expandTables` uses average groove timing and may skip
   cells.
4. Whether native kit/sample behavior can be reproduced without the original
   ROM/runtime assets.
5. Whether phrase/chain identity and reuse survive any particular Create bar
   edit; the UI evidence shows cell operations, not native structural edits.
6. Whether foreign mid-song groove/tempo changes survive a Create edit; only
   native model parsing and focused `T` verification establish those fields,
   not Create authoring parity.

This audit intentionally does not infer fidelity from a passing codec round
trip, a rendered sound, or the existence of a JSON field alone.
