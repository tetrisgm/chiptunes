# Working notes

Plain, current working notes for whoever (or whatever) picks the project up
next. Infrastructure and operations live outside this repository.

## Where the music stands (musician-11)

- One deterministic composer (`src/composer.js`): a token maps to the same
  song forever. No randomness, time, DOM, or network in the musical path.
- Fourteen style archetypes (anthem, house, trance, techno, dnb, breaks,
  arcade, rock, punk, funk, boombap, chill, ballad, drone), each owning tempo
  band, kit signature, bass engine, accompaniment pool, harmony type, swing
  and melody density.
- Pattern pools are mined from a 74,552-file VGM MIDI corpus (joint kit bars,
  bass onset masks, 4-bar chord movements) via `scripts/distill-style-corpus.js`
  into `src/style-corpus.js`. The miner is a stdlib-only Python script with
  its own MIDI parser.
- The instrument bank pairs corpus patches with an authored palette
  (4 duties x 5 envelope characters, 6 wave shapes, 4 noises) in
  `src/gb-hardware.js`; a per-style TIMBRE table dresses each style.
- Hardware articulations run in BOTH engines: the channel-1 sweep unit
  (slides) and per-frame vibrato tables live in the browser Sequencer
  (`src/gb-apu.js`) and the generated cartridge driver (`src/gb-rom.js`),
  kept honest by `npm run test:rom-audio` (spectral comparison of the browser
  chip against the ROM executing on the CPU emulator).

## Invariants worth knowing before touching anything

- `verify-rom-audio` is the referee: any audio change must land in the
  Sequencer and the ROM driver together or parity breaks.
- Vibrato steps BEFORE each frame's events in both engines; the ordering is
  what keeps the two age counters frame-identical.
- The smoke contract (`scripts/smoke-generated-seeds.js`) holds the lead
  under 72% of bars and requires kick+snare from every kit.
- Indexed screens (Game Boy / NES): hueRot returns the base colour while a
  palette is installed; per-variant scheme hints (`st.nesSchemes`) outrank
  the static table; packs must read the live unit `U` every frame (a pinned
  make()-time unit rendered the climber gigantic after a face switch).

## Create (the editor at /create)

- The mood box and chips do parameter-space seed search, NOT curation: mood
  words map to the composer's own dials (style id, mode family, tempo band)
  and `composeIntoGrid` compiles random seeds (~0.4ms each, 140 cap) until
  one's declared parameters match. Owner asked for exactly this (2026-08-26);
  it never scores output quality, and Create never feeds the station.
- A composed roll plays the REAL score verbatim, full length (`liveScore`:
  its own bank, all instruments, no loop; at the end the same mood composes
  the next song). Editing is LOSSLESS: every projected cell carries the
  exact inst/midi/len/vel/ch/sweep (URL hash v3 serializes them), and
  buildSong plays cells from those fields, so a hand edit keeps the whole
  arrangement. The composer's bank IS buildBank(patches) -- pickBank only
  selects role indices from it -- which is why bare instrument indices
  survive the trip. Remaining loss: onsets/lengths step-quantize to 16ths,
  swing timing flattens, and same-column notes folding to one row drop.
- Drag right on a note stretches it (len steps); a tap removes it; leaving
  the row switches to line painting. The More drawer offers every melodic
  bank instrument as a generated waveform icon ('i<N>' stamps).
- Command stamps (one in hand at a time; cell flags): z Fall / u Rise
  (hardware sweep, claims pulse 1), q Arp, g Retrig, f Echo (echo defaults
  len 4; g/f work on drums). All expand in buildSong into ordinary chip
  notes -- no engine changes, parity untouched. URL hash v4 adds one cmd
  char per cell; v1-v3 links still decode.
- Channel lanes: P1/P2/WAV/NOI chips (click mutes, S solos) drive a
  chip-side 'chmute' message -- the Sequencer skips triggers for masked
  channels and note-offs the newly muted -- so muting bites instantly on
  grid songs AND verbatim compositions. Session-only, never serialized;
  playScore() clears the mask so the radio can never come back muted.
  Cells wear a left-edge tick in their resolved channel's color (rch,
  computed by buildSong) and dim while their lane is muted.
- The grid is a TIMELINE: the whole track as one strip of bar panels with a
  camera (follows the playhead; wheel/header-drag pans and disengages;
  play/resume re-engages). Bars are patterns: header glyphs duplicate and
  delete, the ghost "+" bar extends, up to 63 bars. URL hash v2 is 4 chars
  per cell (2-char columns); v1 links still decode.
- The app's `Audio` is a top-level `const`: a global lexical binding, never a
  `window` property. `window.Audio` is the native HTMLAudioElement
  constructor. Always reference the bare name.
- dmg/nes palette systems quantize fillStyle/strokeStyle on the GLOBAL canvas
  prototype; UI canvases must set `canvas.__ctpalRaw = true` or translucent
  fills silently vanish while a panel face is active.
- The chip never rebuilds at a loop seam (`Sequencer.rewind()`) or track
  swap (APU carry + `cutNotes()`): a fresh APU's power-on DAC writes through
  a reset output capacitor are an audible pop.

## Create: the alive posture (Nanoloop wave 1, 2026-08-26)

- The editor is ALWAYS running: open() starts the transport (silent until
  the first gesture resumes audio), and a first visit with no draft
  composes a gentle song immediately -- never a blank page.
- Loop-a-bar: tapping a bar's number loops just that bar (a sliced song,
  sliceForBar) while editing; tapping again releases to the whole song.
  currentSong() is the one source for playback/repost; exports still use
  the full song.
- Notes: body-drag moves (exact midis shift diatonically; drums adopt the
  new lane), right-edge drag stretches, tap removes. cellSpanAt hit-tests
  the whole tail. Cells pulse as the playhead fires them.
- The hint bar (.cr-hint) narrates: data-tip hover mirrors into it, first
  placement and the first sulk explain themselves once.
- Touch: coarse pointers get 32px cells; two-finger pinch zooms the
  timeline width (cwZoom).
- URL v5: bpm rides as (bpm-70)/2. Plain bpm/2 overflowed six bits for
  tempos >= 128 and every such link loaded at ~70 (bug existed since v1).

## Create wave 2 (2026-08-26)

- Queue-next-bar: while a bar loops, tapping another bar's number queues it
  (amber outline) and it takes over exactly at the loop wrap. Tapping the
  looping bar still releases to the whole song.
- Accents: double-tap a note to cycle soft/normal/loud (vel 0.5/0.8/1.0);
  a single tap still removes, deferred 260ms to leave room for the second
  tap. Icon size follows velocity.
- The sound pad: every melodic instrument plotted on a brightness-by-
  sustain map inside the More drawer (padPoints/drawPad/padPick); dragging
  snaps to the nearest sound and auditions as you go.
- The Songs shelf ('Songs' in the toolbar): save/load/delete named songs in
  localStorage ('ct-create-shelf', encode strings, cap 30).
- URL v6: the cell extension rides whenever ANY exact field exists
  (v5 gated it on inst alone and silently dropped hand-placed stretches
  and accents from links); inst encodes as inst+1 so 0 means none.

## Create wave 3 (2026-08-26)

- First-run tour: three anchored cards (grid / bar loop / moods), each
  advancing on the real action or Next; 'ct-create-tour' in localStorage
  gates it forever after. Shown only on the fresh-visit path.
- Phone: the mood chips and palette are single scrolling rows (hidden
  scrollbars), chrome tightens, the title hides, touch-action:manipulation
  kills double-tap zoom, and the grid canvas owns its gestures
  (touch-action:none).

## Create rebuilt as a pocket tracker (2026-08-26)

- The timeline/palette UI is gone. One screen: a 4x4 step grid shows one
  bar of one voice (tap toggles, vertical drag pitches diatonically,
  horizontal drag stretches, drums drag between kick/snare/hat); four
  channel buttons (tap switches, tap the lit one mutes, hold opens the
  sound map scoped to that voice, picked per channel in chInst[]); a bar
  strip walks the song (tap views, the ring button loops the current bar,
  tapping another bar while looping queues it for the wrap); mood row and
  Share (link/WAV/ROM) on top. The whole engine (cells, buildSong,
  liveScore, encode v1-6, shelf, chip glue) is unchanged.
- Command stamps, eraser, accents, and solo lost their UI; cells carrying
  those flags still play. Channel view mapping: explicit ch, else rch from
  buildSong, else P1; the composer assigns pulse channels per seed, so a
  seed may use only one of P1/P2 -- the views report what is real.
- Decode bug fixed: the cell extension's channel read (e1>>3)&7, swallowing
  the midi flag into the channel since v3, so decoded links corrupted
  explicit channels (playback survived via the budget fallback). The
  encoder always wrote correct bits, so old links heal on load.

## Create legibility pass (2026-08-26)

- Channels wear plain words (Melody / Harmony / Bass / Drums) plus a small
  waveform icon of their current sound (chanIcon, cached per inst); the
  hardware names live in the tips. Active squares print their note name
  (C3, E2...) or drum name (Kick/Snare/Hat); corners carry step numbers
  1-16; a caption above the grid says "<voice> - bar N of M (looping)".

## Create pattern-mode parity pass (2026-08-26)

Studied the reference tutorial in depth and adopted its editing model:
- A parameter row under the grid (Note / Vol / Len): vertical drag on a
  step edits the SELECTED parameter. Volume to zero is a rest: the square
  shows '=', dotted border, and buildSong skips vel===0 notes on every
  channel.
- Multi-tapping the selected parameter randomizes it across this voice's
  bar (more taps, more random; one snapshot per burst, in-key for pitch).
- Pattern tools: shift left/right (wrapping nudge), octave up/down for the
  voice's bar, a Swing toggle (S.swing), and a return-to-top transport
  button.
- Not adopted: meta steps (flick gestures), their pattern-number song
  screen (our linear bars + mood compose stay), and their visual identity
  (ours is note names, waveform icons, plain words).

## Create: 48-bar cap and the scrolling timeline (2026-08-27)

- Songs cap at 48 bars everywhere (decode clamps and drops out-of-range
  cells, compose clips S.bars AND the verbatim liveScore to the same
  frame count, add/duplicate stop at 48).
- The numbered bar buttons are a canvas timeline: every bar side by side
  as a small panel with its notes drawn as ticks in the four voices'
  colours, a white playhead line, and a camera that eases to follow the
  playing bar. Drag or wheel pans (dropping the follow); play re-engages
  it; a tap picks the bar (or queues it while looping). The canvas needs
  __ctpalRaw or a DMG face greys its colours.

## Create: the song scrolls in the main area (2026-08-27)

- The centre of the screen IS the song now: one 4x4 block per bar laid
  end to end in .n-track (translateX camera), neighbours dimmed, the
  playing/looping/queued bar marked on its head strip. Drag a bar's head
  or wheel to pan (drops the follow); play re-engages it. The bottom
  timeline canvas and the numbered strip are gone. Steps carry data-col
  (absolute), so every bar is editable in place without a "current bar".
- An All tab (viewCh -1) draws every voice in each step as labelled pills
  (Melody/Harmony/Bass/Drums, colour-coded, tails faint); tapping a note
  dives into that voice. Tools and multi-tap randomize act on all four
  voices while All is selected.
- Channel tabs carry a speaker icon: tap the tab to select, tap the
  speaker to mute (browser-tab style). The old select-then-tap-again
  muting is gone.
- Composed notes with no pitch are dropped at projection (they showed as
  bogus 'C-1' squares and played subsonic).

## Create simplified to buttons (2026-08-27)

- Default tab is All. Tabs are real tabs above the track, each with a
  speaker icon that mutes that voice; holding a tab still opens its sound
  map. Empty slots in All draw nothing (sustained notes get a hairline).
- Tapping a square selects it: an empty square on a voice tab adds a note,
  a note (or a pill in All) opens the note editor under the track. All
  editing is labelled buttons -- Note -/+ and -/+ octave (real semitones on
  the note's own midi, so the two-octave display never traps a pitch),
  Volume -/+ (0 = a silent step, dropped from the song), Length -/+, drum
  Sound as Hat/Snare/Kick, and Remove this note. No drag-to-edit.
- Each bar head carries nudge left/right, loop, duplicate, remove; a dashed
  block after the last bar adds one (capped at 48 with a hint).
- Removed: the mood text field, the dice, the Songs shelf, the Share menu
  (Copy link / WAV / ROM sit in the top bar), the parameter row, multi-tap
  randomize, and the instrument drawer list.

- Create owns /create while it is open. syncRoute() (which replaceStates
  /track/<slug> on every radio track change) now returns early when
  CT_CREATE.isOpen(), and the editor re-asserts '/create#s=<song>' from its
  ticker if anything else moves the URL. A refresh lands back in the editor
  with the same song (hash first, localStorage draft as the fallback).

- The panel under the track is always live. With nothing selected it is the
  PEN (voice / note / volume / length) and tapping any empty square places
  exactly that, in any view including All; with a note selected it edits
  that note and the pen follows it, so the next note matches the last.
  Clicking a note (or any square inside its tail) selects and auditions it
  for its real length (capped at 600 frames).

