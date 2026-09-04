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

## Create layout, owner pass (2026-08-27)

Screen order is now: utility row (undo/redo/copy link/WAV/cartridge/close),
the mood band (the star: large label + big chips), voice tabs sitting
directly on the track, the bars, the note panel, and a player-style
transport bar at the foot (Start / Play / Speed). Gone: the hint line, the
caption line, every tooltip.

Per bar: the tools row moved BELOW the grid with a 16px gap and carries
worded buttons (Earlier / Later / Loop / Copy / Delete, no bar number);
under it sits the bar's name ("bar 3 of 48", plus "looping"), shown for
the bar you are on. Panning is a drag anywhere on a bar that is not a
step or a button.

The note panel is columned and worded: This/Next note, Voice, Pitch
(Octave down / Lower / value / Higher / Octave up), Volume (Softer /
Louder), Length (Shorter / Longer), Sound (Choose...), Remove note.
sizeTrack() reserves room for the tools row and the label, and the tools
row scrolls rather than wraps on phones.

- Autoplay honesty: a freshly loaded /create (a shared link, a refresh) has
  no user gesture, so the audio context is suspended. startPlayback() now
  refuses to claim it is playing in that state -- it parks as paused with a
  pulsing Play button and arms a one-shot capture-phase gesture listener
  that resumes audio and starts the song on the first touch anywhere. The
  listener skips auto-starting when the gesture IS the Play button, or the
  button's own handler would immediately pause it again.

- The voice tabs are attached to the bar you are on: the strip is the bar's
  width and applyCam() slides it with the camera every frame (it must live
  there, not in renderBars, which only fires on bar changes). Tab waveform
  icons are gone so the names fit; on phones the strip widens to the
  viewport since the bar nearly fills it anyway.

- Projection keeps nearly everything now: an overflow note (a third pulse, a
  second wave, a second drum in one 16th) slides to the next free step for
  its voice instead of being dropped -- up to 2 steps for melodic voices,
  1 for drums, never past the song end. Measured over six seeds, notes kept
  went from 96.7% to 99.1%; chords land as quick strums, stacked drums as
  flams.

- /create boots straight into the editor: the boot route and the product
  route both set _createStandalone and call _openCreate() with no
  _startEndlessRadio(), so no game frame is ever drawn behind it. The
  station starts on close instead (_closeCreateReturn), which is also when
  the URL hands back to /.
- The track carries half a screen of padding at each end (--trackpad), so
  the first and last bars centre exactly like the ones between them; camMax
  reads the track's scrollWidth, and the tab strip and barUnderCamera both
  offset by trackPad.

## Create: the note picker (2026-08-27)

- Tapping a square opens a picker ON that square: the four instruments as
  coloured buttons, one octave of the song's own scale as note names (with
  octave arrows), Volume and Length as eight-block meters, and Remove.
  Tapping a note name places (or repitches) the note; tapping another
  instrument moves the note to that voice. The old bottom panel and the
  "pen" idea are gone: there is no mode to remember.
- Guard worth keeping: a grid re-render detaches the element that was
  clicked, so the outside-click check must not fire for the click that
  opened the picker (pickOpenedAt, 60ms).
- Bars: no separators, no Loop/Copy actions, the number sits under the
  actions as "#3", and the voice tabs no longer travel -- they stay above
  the middle of the screen. The mute control is a drawn speaker.

## Create as four lanes (2026-08-27)

The 4x4 bar blocks and the voice tabs are gone. The song is four
horizontal lanes -- Melody, Harmony, Bass, Drums -- named down a fixed
left gutter (each with its speaker), running left to right through the
whole song under one camera. Notes are absolutely positioned blocks in
their lane: left = step, width = length, HEIGHT = pitch (mapped from the
note's own midi over C2..C7, not the old fifteen-row grid, or a flat
scale would pin everything above C5 to the ceiling), label = note or drum
name. Rows carry the step/beat/bar gridlines and faint horizontal rules
as a background gradient, so the DOM holds one node per note rather than
per step. The ruler numbers the bars; the bar strip under the lanes names
the bar you are on and carries Earlier / Later / Delete / Add.

Tapping empty lane space opens the note picker there with THAT lane's
instrument preselected; tapping a note opens it for editing. Dragging
anywhere in the lanes travels; the wheel does too.

Watch out: old bar-block CSS (.n-track display:flex) survived the
rewrite and stacked all four lanes on top of each other -- when
replacing a view wholesale, delete its stylesheet rules in the same
pass.

- Performance: the lane gridlines must NOT be painted across the song. Rows
  were var(--songw) wide (26,000px at 48 bars) with four repeating gradients,
  which made scrolling stutter badly. They now live on one viewport-sized
  .n-bg layer translated by (sidePad - camX) mod barW (the pattern repeats
  every bar), so scrolling is a composited nudge; rows are 1px wide and only
  host their absolutely positioned notes. Measured: flat 8.3ms frames while
  playing and while dragging, zero long frames.
- body.create-open now hides #stage/.crt/#hud/#now/#presets, the editor
  background is fully opaque, and arriving directly at /create skips the
  fade (class 'instant'). Before this the game showed through Create's
  200ms fade-in on every refresh.

- The song starts at the left edge (sidePad 0); centring only happens when
  the camera follows a bar mid-song.
- The first gesture ONLY unlocks the audio device. Music starts when the
  user asks: Play, the spacebar, or a mood chip (which composes and plays).
  A stray click or keypress never starts playback.

- Notes are draggable: pointerdown on a .n-note starts a note drag (pan is
  suppressed), vertical position sets the pitch straight from the lane
  geometry (or the drum lane), horizontal sets the step, and crossing into
  another lane changes the voice, keeping pitch/drum/volume/length. It
  auditions as it moves (throttled 110ms), and the drag suppresses the click
  that would otherwise open the picker.
- pickVoice() now remembers pitch, drum lane, volume and length BEFORE
  deleting the old cell -- a trip through Drums and back used to lose the
  pitch, because a drum row has no pitch to read back.
- Clicking empty lane space with the picker open dismisses it (a second
  click there opens a fresh one); the outside-click guard tests .n-note now
  that .n-step is gone.
- Earlier/Later bar shifting is gone: dragging a note moves it in time.

- The chip keeps ONE PENDING NOTE-OFF PER CHANNEL (pokeOffs[4]) and accepts a
  'pokeoff' message. The single-slot version meant auditioning on a second
  channel orphaned the first one's note-off, so a note dragged between lanes
  sang on forever and fought the song. Drags now audition briefly (0.35s),
  silence the old voice when crossing lanes, and stop everything on release.
- A note's right 14px is a resize handle: dragging it sets the length.
- The bar you are on is banded across all four lanes; Delete bar asks once
  (the button arms for 4 seconds); Add bar inserts an empty bar AT the
  current position and pushes the rest right.

- The note panel is Volume and Remove only: instrument, pitch and length are
  all set by dragging (lane, height, right edge), so listing them twice was
  clutter. Clicking empty lane space places a note AT the height you clicked
  and opens that panel.

- BAR CONTROLS LIVE ON THE RULER, not in a row underneath. The current bar's
  label carries them -- "#4  + insert  x" -- and only the current bar shows
  them, at the same 11px as the number itself; every other bar is just its
  number. The ruler is 30px tall to hold them -- .n-bg, .n-barhl and .n-ph all
  hang off that height, and sizeTrack subtracts it from the lane maths. The x arms for 4 seconds
  ("x sure?") before it deletes, and + insert opens an empty bar at that bar
  and pushes the rest right. The old .n-barbar row is gone.

- THE PLAYHEAD AND THE CAMERA BOTH CARRY FRACTIONS. updatePh took a floored
  column and centerOn took a bar index, so the line hopped once per sixteenth
  and the camera lurched then stood still for the rest of each bar -- 60fps
  frames, stuttering motion. The playhead now takes the fractional column and
  moves by transform; the follow uses followCol(col), which keeps the playhead
  centred; the track, the gridline layer and the scrollbar thumb are all
  positioned sub-pixel. Measured while following: every frame moves, camera
  2.38px +/- 0.099, zero stalls in 480 frames. Never round a position that a
  frame loop writes -- rounding is what puts the steps back.

- The camera FOLLOWS THE MUSIC, and a hand scroll KEEPS it. There is no timer
  (an earlier 3-second auto-resume was wrong: it yanks the view away mid-edit,
  and no DAW does it -- Ableton, Logic, Reaper and Renoise all disengage on a
  hand scroll and re-engage only on an explicit event). Every gesture goes
  through handScrolled(), which hands the camera back when the playhead is on
  screen (8%..92% of the pane); camCatch then holds the view where your hand
  left it and decays 0.86 a frame so the centring is a glide, not a snap.
  Play, Start and a new mood also hand it back.

- A note joining a lane (dragged there, or placed there) takes the
  instrument its NEIGHBOURS in that lane use (laneInstAt: nearest cell by
  column, then chInst, then the stamp default). Composed songs change patch
  from section to section, so falling back to Create's default made the same
  written note sound unlike the notes beside it -- the owner heard a dragged
  D2 differ from the D2 next to it. Notes also carry data-inst now, which
  makes this checkable from a test.


- THE PALETTE IS READ OFF THE BANK, NOT TYPED OUT: 31 named sounds (11 pulse,
  10 wave, 10 noise) built at resolveBank() time. A pulse sound is a duty x
  envelope-class cell of the bank's own grid (75% duty is 25% inverted -- the
  same timbre -- so it only fills an envelope 25% lacks). A wave sound is one
  table, deduped by the SHAPE of its harmonic series with loudness and phase
  divided out, then named roundest-first. A noise sound is one patch, ordered
  bright hiss to low boom, and it carries the lane row it belongs at, so
  height and sound stay in step.

- THE NULLS IN THOSE NAME TABLES ARE MEASURED. Every candidate is rendered
  through this repo's own APU (a ~60 line Node harness: gb-hardware +
  chip-instruments + gb-apu, one note each) and compared to the ones already
  kept on two axes -- a 64-band spectrum of the sustain (mean subtracted) and a
  24-point AMPLITUDE envelope. Anything within 0.10 of a keeper is dropped: the
  Ghost character (identical to Hold but quieter, and level is what Volume is
  for), Sine (Round), Hiss (Snare), Clank (Bleep). Sort the names you want to
  keep -- Snare, Kick, Hat -- to the front, or a keeper loses to a lookalike
  that happened to sort earlier. The shipped 64 are all audible and their
  closest pair is 0.104 apart. Redo the measurement before adding names: a name
  you cannot hear the difference of is clutter, and a sustain spectrum ALONE
  will not catch it, because two of these differ only in their envelope.

- SOUNDS ARE NAMED AND VISIBLE. The chip's timbres used to live behind a
  long-press on the lane name, which opened a scatter pad of unlabelled dots:
  the owner never found it and read the editor as having no instruments at
  all. Each lane now carries the name of the sound it is holding (Square, Punch,
  Soft, Hold, Swell, Reed, Airy, Drone, Rise, Bell, Thin on the pulse lanes;
  Round, Sine, Cello, Vox, Wood, Reed, Thin, Saw, Growl, Ring on the wave
  lane; Tick, Hat, Hiss, Shaker, Wash, Snare, Sizzle, Tom, Rumble, Kick on the
  drum lane, which also moves the note to the height that sound belongs at). Clicking that name sets
  what the NEXT note there will use; the note panel sets the note in front of
  you and the lane together. SOUNDS resolves against the live bank the same
  way STAMPS does, and DEDUPES -- two names for one instrument is a lie the
  ear catches at once.

- laneInstAt now answers chInst FIRST. It used to prefer the nearest
  neighbour's instrument (that fix stops a dragged note sounding unlike the
  notes beside it), but a sound you picked by hand has to win, or choosing one
  does nothing you can hear.

- THE PANEL CLOSES: an x on its header, Escape (CT_CREATE.escape() runs before
  runtime closes the whole editor), and a click anywhere off it. That last one
  listens on the DOCUMENT, not on the editor -- a click on the lane column or
  the transport is still a click away. Two traps live here: (1) a handler that
  re-renders leaves the clicked node DETACHED, so closest('.n-pick') finds
  nothing and the click reads as "outside" -- hence the isConnected guard, and
  hence the lane popover marks its buttons instead of rebuilding them; (2)
  renderEdit() must preserve pickOpenedAt, or every refresh looks like a fresh
  open and the click-away guard never expires.

- FOLLOW IS A BUTTON, in the transport, lit while the camera is riding the
  music. Anything that scrolls turns it off; pressing it (or Play, Start, a new
  mood) turns it back on and glides to the playhead. An earlier version re-armed
  the follow by itself whenever the playhead came into view, and it fought the
  hand: dragging the scrollbar left to reach bar 1 snapped the view away before
  you got there.

- MOTION IS THE OTHER HALF OF AN INSTRUMENT, and it already existed: the build
  path has expanded x.q (arp), x.g (retrig), x.f (echo) and x.z / x.u (sweep
  down / up on channel 1) into ordinary chip notes since the command-stamp
  work, and the link format has carried them since v4. The panel-slimming pass
  removed every way to reach them, which is why 31 static timbres still felt
  minimal -- nothing moved. The note panel now has a Motion row beside Sound:
  Plain, Arp, Roll, Echo, Fall, Rise.

- WHAT EACH LANE CAN DO IS NOT THE SAME. A pitch slide needs channel 1's sweep
  unit, and compileCells only writes note.sweep when the note lands on channel
  0 -- so Fall and Rise are Melody's alone (a Harmony cell carries x.ch = 1 and
  would silently ignore them). Drums have no arp. MOTIONS carries a per-lane
  mask, and setCellVoice drops a motion the new lane cannot play rather than
  leaving invisible state on the cell.

- A MOTION PREVIEW HAS TO BE A SEQUENCE. auditionCell pokes the chip once,
  which makes Arp, Roll and Echo all sound like a plain note; previewMotion
  schedules the real hits instead. It is skipped while dragging (auditionCell's
  maxFrames argument marks a drag), or a drag would fire a timer storm.

- THE CARTRIDGE NOW CARRIES 32 WAVE TABLES, not 16. The driver never had the
  limit -- doWave walks waveAddr forward index*16 with an 8-bit counter -- it
  was our instrument record masking byte0 to a nibble. WAVE_SLOTS in
  gb-hardware.js is the one number both sides read; waveBytes() writes that
  many tables (16 bytes each, so 32 costs 512 bytes of a 32 KiB cart, and a
  1000-note song still leaves ~22 KB free).

- WIDENING THAT MASK EXPOSED A REAL BUG, and the fix is the flag bit. The
  composer sometimes lands a PULSE instrument on channel 3 (velvet-engines-
  melt-tide-1a2b3c4d does), and a pulse record's byte0 is its duty -- 0x80.
  Masked to a nibble that read as slot 0 and nobody noticed; as a full byte it
  read as slot 128, and the cartridge walked 2 KB into ROM for a wave table.
  patchToInstrument now sets flags bit 0 on wave records and waveSlotOf returns
  0 unless that bit is set, which keeps the old behaviour exactly. The composer
  bug itself is left alone ON PURPOSE: those songs are published, and changing
  which instrument a seed uses would rewrite them.

- gb-rom now RELOADS the wave table when a song changes bass sound mid-way.
  It used to load only the first wave note's table, which was fine when the
  composer picked one wave instrument per song -- but the editor lets you give
  every note its own, and the cartridge would have played the first one
  throughout. The browser's Sequencer reloads per note; the two must match.

- A NOTE'S SOUND IS NOW THE CHIP'S OWN SETTINGS, not a name off a list. Sixty
  four invented timbre names read as harder to understand than LSDJ, whose
  instrument is two or three fields, so the panel is those fields: a pulse note
  has Shape (12.5/25/50/75% duty) and Fade (LSDJ's ENV nibble: 0 holds, 1-7
  fades out fastest-first, 9-F swells); a bass note has Wave (one of the
  cartridge's tables); a drum has Noise (Free = 15-bit, Metal = 7-bit), Pitch
  and Fade. Cells carry dy / fd / wv / nz / ns, and paramsOf() answers for a
  COMPOSED note by reading its bank record back, so the panel always shows what
  the note actually is.

- THOSE SETTINGS ARE MATERIALISED INTO A PER-SONG BANK. instOf() appends a
  record for each distinct setting to a copy of the shared bank (reusing an
  existing record when the bytes already match) and buildSong hands that bank
  out. This is free: the cartridge stores four register bytes PER NOTE and no
  instrument table at all, so the only real limit is the 32 wave tables. The
  128-instrument pad in buildBank is a browser-side convention, not hardware.

- AUDITION CARRIES THE RECORD, NOT THE INDEX. A drag auditions long before the
  song is reposted, so a hand-set sound would not be in the chip's bank yet.
  pokeCreate notes may carry rec: [4 bytes] and the worklet builds a one-entry
  bank from it. Without that, every edit sounded like the note's OLD instrument
  until you released the mouse.

- LINK FORMAT v7 adds those settings: bit 3 of the per-cell command char says
  "four more chars follow" -- fade+present flags, duty+shape+present flags,
  wave slot, noise pitch. v1-v6 still decode.

- REMOVED WITH THE PALETTE: chanIcon, soundBtns, soundsFor, laneInst,
  laneInstAt, chInst, PULSE_FAM / FAM_ORDER / CHAR_ORDER / pulseChar /
  NOISE_NAMES / METAL_NAMES / LANE_SOUND, and the editValue branches they fed.
  buildSounds now only names the WAVE tables, which the Bass picker still
  needs; a table it cannot name shows as "wave N" rather than marking nothing.

- NAMES SIT ON TOP OF THE SETTINGS, and pressing one MOVES them. LSDJ has no
  presets -- you learn the chip -- but "Shape 75%, Fade out 6" means nothing
  until you have heard it, and the owner read the parameter panel as having
  fewer sounds than the name list it replaced (it has far more: 4 shapes x 15
  fades against 30 names). So each panel opens with a Sounds row -- Pluck,
  Bell, Stab, Reed, Organ, Thin, Soft, Swell for the pulse lanes; Kick, Snare,
  Hat, Clap, Tom, Rumble, Ping, Zap for drums -- and picking one writes the
  settings underneath, which is what teaches them. The Bass lane needs no
  presets: its Wave row is already a list of names. presetOn() marks the name
  whose settings the note currently matches, so a composed note shows as
  "Organ" when that is what it is.

- THE AUTOMATION LANE. A Game Boy instrument is not a note-on, it is what the
  driver writes on every frame after it, so a score can now carry three arrays
  beside its notes: gb.auto ([{f, r, v}] raw register writes), gb.waveLoads
  ([{f, slot}] a table swapped under a sounding note) and gb.vibOff ([{f, ch}]
  the note taking its own pitch over from the driver's vibrato). BOTH players
  read the same arrays -- the Sequencer applies them at the end of _runFrame,
  after that frame's note-ons -- so they cannot drift by construction.

- THE CARTRIDGE GREW TWO OPCODES for it: event type 4 is [reg, val] straight to
  $FF00+reg, type 5 clears this channel's vibrato flag. Ordering matters and is
  encoded in TYPEW: offs, wave loads, sweep, note-ons, vibrato hand-offs, then
  raw writes LAST -- a duty change on a note's own frame has to land after the
  note-on that would otherwise overwrite it.

- npm run test:automation is the gate. It builds a score using every kind of
  automation, runs the browser chip and the real ROM on the emulated CPU, and
  compares: each write lands on its frame in both, and each register gets the
  same values in the SAME ORDER. Ignore each player's power-on writes (frame <
  5) -- the browser's happen inside the Sequencer's constructor. An editor song
  was also checked end to end this way: 45 writes, 9 wave swaps, 164 period
  writes, identical order on both sides.

- WHAT THE EDITOR EMITS: Wobble writes the period every 3 frames from a small
  table (and hands vibrato off, or the driver's own vibrato fights it); Sweep
  walks NRx1's duty bits every 5 frames from the note's own duty; Morph swaps
  wave tables every 6 frames; Pan is a RUNNING NR51 -- one byte for the whole
  machine, so panWrites() collects every note's wish, sorts by frame and writes
  the byte only where it changes. Moves need room: they are skipped on notes
  shorter than 6-8 frames, because there is nothing to move through.

- A jr COULDN'T REACH doWave once the two new handlers landed. The assembler
  throws on that (gb-rom: jr out of range), which is why it is a guard and not
  a silent wrap; the dispatch now uses jp for that one branch.

- THE GRID IS A NUMBER NOW, not the constant 16. S.grid is steps in a bar (16,
  24 or 32) and spb() answers it; framesPer16() returns frames in ONE STEP,
  which is (60/bpm)*4/spb()*FPS, so a bar is four beats however finely it is
  cut. Everything that used to multiply or divide by 16 -- cols, the ruler, the
  bar highlight, addBar/delBar/shiftBar, camera maths, the gridline layer's
  modulo -- asks spb(). Changing it RESCALES the cells (c and len by the ratio)
  so the music stays where it is in time; coarsening can land two notes on one
  step of a lane and setGrid says how many, because the chip has one voice
  there and dropping one quietly would be a lie.

- FREE PITCH: a note may carry dt (detune, +/-16 period units) and gl (glide).
  noteRegisters adds det to the period for channels 1-3 and clamps to 11 bits,
  so BOTH players and the ROM builder get it from the one place that decides
  registers. Glide is automation: the period walks from the previous note in
  that lane to this one over the first frames, which is the only slide the chip
  has away from channel 1's sweep unit. moves.last[ch] tracks the lane's last
  period -- every melodic note updates it, move or no move, or a glide would
  start from whatever note last happened to have one.

- LINK v9 puts the grid in the header (index into GRIDS), so cells start at
  char 7 rather than 6; dt and gl ride in the v8 blocks.

- PRESSING PLAY IS THE GESTURE. startPlayback used to only ARM the audio unlock
  when nothing had been touched yet and return silent, so a first press could
  do nothing; togglePlay (and a mood tap) now set gestured and resume audio
  inside the handler, which is what browsers allow and what every player does.
  The rule that a stray key must not start music still holds -- nothing else
  sets it.

- KIT SAMPLES: FOUR-BIT PCM ON CHANNEL 3, the last thing the editor could not
  say. The DMG has one DAC -- 32 nibbles of wave RAM -- and every Game Boy game
  that plays a sample plays it there, by rewriting that buffer while the channel
  runs. src/gb-kits.js SYNTHESISES the drums (oscillators and a seeded LFSR, so
  the same kit everywhere and nothing lifted); 8 samples, 3.5 KB packed.

- THE RATE IS CHOSEN, NOT ROUNDED, and that is the whole design. Channel 3
  steps its 32 nibbles at 4194304/((2048-period)*2), so period 1792 is exactly
  8192 samples a second and one buffer is exactly 1/256 s. The cartridge
  refills from the TIMER interrupt: the 4096 Hz clock with TMA=240 fires
  exactly 256 times a second. Sample clock and refill clock are the same clock,
  so nothing drifts. The alternative -- refilling once a frame, no interrupts --
  is 1911 Hz and 955 Hz of bandwidth: muffled thuds, no click, no sizzle.

- WHAT IT COST, all of it deliberate: the CPU emulator learned interrupts, the
  timer and six opcodes (it throws on anything the driver did not emit, so the
  additions are exactly what is used); the driver gained doKit, kitFill and an
  ISR at the $0050 vector; and a kit hit STEALS THE BASS VOICE for its length,
  exactly as on hardware and in LSDJ. Create emits a waveLoads entry after each
  hit to give the bass its table back, since wave RAM now holds a sample.

- npm run test:kit is the gate, and it is the strongest one here: the two sides
  reach the sound by completely different routes (a cycle counter versus a real
  interrupt on an emulated CPU), so it plays every drum through both and
  compares spectrograms -- 0.9918 correlation, 1.34 dB a band -- and asserts the
  two clocks are exactly in step.

- The dispatch in the driver now uses jp for every handler: the event section
  outgrew a relative jump's reach twice in one day. If you add a handler and see
  'gb-rom: jr out of range', that is the assembler's guard doing its job.

- THE GRID DRAWS ONLY WHAT IS ON SCREEN. Forty-eight bars is 26,000 pixels of
  track and the pane shows about 1,200, so renderGrid was building a thousand
  elements to show forty -- and every edit re-ran it. Measured in WebKit on a
  48-bar song: opening the note panel 56ms, changing a setting 77ms, worst
  frame 75ms. With a visible-range filter (visRange(), one bar of margin, and
  applyCam re-rendering when the window no longer covers the pane): 62 elements
  drawn, panel 8ms, setting 13ms, worst frame 33ms. Chromium went 33/37ms to
  4/2ms. If you add anything that renders per cell, keep it inside that filter.

- SELECTING A NOTE IS A CLASS, not a rebuild. selectNote used to call
  renderGrid for the sake of one '.sel'.

- CLICKING A NOTE OPENED NOTHING, and pointer capture is why: the drag handler
  takes setPointerCapture on the scroller, so the CLICK that follows is
  delivered with the scroller as its target and closest('.n-note') finds
  nothing. Synthetic .click() in a test still worked, which is how it survived
  a whole session of tests -- use a real mouse (page.mouse.click) when checking
  this path. The press now remembers its note (pressedNote) and the click uses
  that.

- resumeCtx WROTE TO THE DOM ON EVERY CALL. Its diagnostic stringifies an
  object into documentElement.dataset, which invalidates style on the document
  element -- and pokeCreate calls resume before every audition, which now
  happens on hover. It leaves early and silently when the context is already
  running.

- playCreate WAS DROPPING HALF THE SONG. It built its message from
  {notes, bank, totalFrames} only, so automation, wave swaps, vibrato hand-offs
  and kit hits never reached the browser chip -- they only ever played on the
  cartridge. Anything added to a score has to be added there too.

- AN AUDITION HAS A FLOOR. Previews used to play at the note's own velocity for
  the note's own length: a composed note at vel 0.2 lasting a sixteenth is a
  blip, and the owner reported hearing nothing at all on hover or click.
  HEARD_VEL (0.75) and HEARD_FRAMES (about 0.28s) are the floor; measured in
  WebKit the peak went 0.09 -> 0.19. Note that while the SONG is playing, an
  audition on a busy channel is cut by the next note there -- four voices is
  four voices, and that part is not a bug.

- THE PAGE NO LONGER CARRIES ITS OWN JAVASCRIPT. build.js used to inline the
  whole bundle into index.html: 1.8MB that no browser can cache on its own, so
  every visit re-downloaded and re-compiled it, blocking the first paint
  (measured on localhost with no network: 231ms of parse in WebKit, 638ms in
  Chromium). It is now dist/app.<hash>.js, referenced with defer, cached
  immutable via assets/_headers. index.html is 109KB. Interactive went 251->143ms
  in WebKit and 645->160ms in Chromium, and a repeat visit pays nothing at all.

- THE TAG IS RELATIVE, AND THE ROUTE COPIES REWRITE IT to '../app.<hash>.js'.
  The desktop app's offline fallback does win.loadFile(dist/index.html) -- over
  file:// an absolute '/app.js' is the filesystem root. Keep it relative.

- WHAT THE RADIO IS ACTUALLY SPENDING TIME ON: not JavaScript. A CPU profile of
  three seconds of playback is 99.2% '(program)' -- the main thread is idle and
  the work is the WebGL screen shader, the canvas and the audio worklet thread.
  The stage canvas is already capped (DPR <= 2, 3.2 megapixels) and the screen
  shaders cap DPR at 2. Frames measured 8.2ms median in Chromium and 17ms in
  WebKit with only 317 DOM nodes. If the radio feels heavy, look at pixels and
  at boot, not at the frame loop.

- CLOSING A COLD-BOOTED /create LEFT THE STATION SILENT, and that was the bug
  reported from the wild. _closeCreateReturn has two branches: the ordinary one
  calls Audio.playScore() to take the chip back off the editor, and the
  _createStandalone one -- /create opened directly, station never started --
  returned BEFORE it. So the worklet kept holding the editor's song and nothing
  reposted a score; pause and play could not rescue it because neither reposts
  either. It calls playScore() now.

- npm run test:handover stands over it: it drives a real browser out of the
  editor four ways (after an edit, with every lane muted, with a sample left in
  wave RAM, and mid-playback) plus the cold /create route, and asserts the
  station is audible after Close AND after pause/play. It caught this on the
  first run, having failed to reproduce by hand all afternoon.

- MOVES SCALE WITH THE NOTE. Wobble, Sweep and Morph used to need 6-8 frames,
  and a sixteenth at 150bpm is about six -- so switching one on for an ordinary
  note did nothing at all. The step is now len/6, len/4 and len/4, floored at
  two or three frames: a one-step note gets two or three writes. Only something
  under three frames is genuinely too short to move through.

- EVERY WAVE SLOT HAS A NAME. The picker lists one table per timbre, but a
  composed note can hold one of the near-duplicates the dedupe dropped, and the
  panel used to label those "wave 7". SLOTNAME names them after the timbre they
  are a variant of ("Cello 2").

- THE CARTRIDGE BUDGET IS ESTIMATED WHILE YOU EDIT (romBytes, in buildSong) and
  hinted at 30000 of 32768, because learning that a song will not fit from a
  failed download is learning it too late. For scale: 48 bars, 1045 chip notes
  and all eight sampled drums came to 13054 bytes, so this only bites at the
  extremes. hint() only surfaces messages carrying consequence -- the filter now
  includes 'cartridge' and 'share a step', which were being swallowed.

- THE EDITOR CAN NOW HOLD WHAT THE COMPOSER WRITES, which is the precondition
  for making Create the source of the station's songs rather than a side door.
  Three things were quantising the music away on import:
    * S.bpm was rounded to the nearest EVEN value, which moves every frame in
      the song. It keeps the exact tempo now (link v11 carries 7 bits).
    * note starts were snapped to the sixteenth grid. A cell carries `of`, an
      offset in frames (+/-32), and cellFrame() is colFrame + of. The note is
      DRAWN at the offset too, so what you see is where it sounds.
    * note lengths were whole steps. A cell carries `lf`, an exact length in
      frames, whenever the grid cannot say it.
  Clashes are judged by whether two notes on a lane overlap IN TIME, not by
  counting notes per column -- the old rule threw away notes that never
  collided on the hardware.

- MEASURED, one 803-note song: 102 notes fall past the 48-bar cap, 10 are
  emitted by the composer with midi null (a melodic note with no pitch -- the
  composer should probably not do that), and of the 691 that can be placed,
  685 land on the exact frame. 99.1%. Before this work, four moods measured
  98.2 / 73.0 / 85.1 / 25.1% surviving; 'chill' was losing three notes in four.

- The 48-bar cap is now the largest single source of loss on import. If the
  station's songs are to come out of Create, that cap has to rise or go.

- THE STATION AND THE EDITOR PLAY THE SAME SONGS. compileScore() now hands every
  composed Score to CT_CREATE.songFrom(), which runs the editor's own import on
  a scratch state and returns a playable gb plus the document code; score.gb is
  replaced with it and score.doc carries the code. The chip plays the DOCUMENT.
  The Score stays for the visuals, the sections and the games, which read
  events rather than notes. Cost: 1-3ms a track.

- Consequences, all deliberate: pressing Create hands the editor the song on
  air (Audio.currentDoc() -> CT_CREATE.open(code)), so "edit what I am hearing"
  is that song note for note. The address bar no longer carries the generated
  name -- _generatedRoute() returns the product route -- because a name is a
  label now, not a seed. A song worth keeping is shared as a document.

- THE LAST QUANTISERS ARE GONE, and two composer bugs came out with them:
    * the 48-bar cap (import kept 48 bars of a 57-bar song),
    * per-COLUMN voice allocation in buildSong -- notes carry frame offsets now,
      so two notes in one column may not overlap at all and two in different
      columns may. Voices are claimed by time, like the import does it.
    * the composer put a WAVE instrument on a pulse channel when a plan routed
      bass there (the mirror of the channel-3 bug fixed earlier). Both
      directions are guarded now: the instrument has to belong to the channel.
    * Voices.place() refuses a melodic note with no pitch. The composer emitted
      a few per song; on the hardware they are a period-0 click.
  Measured after: twelve songs, 100% of notes on the exact frame, every one.

- npm run test:song-document is the gate. It materialises twelve songs and
  compares note for note, round-trips a document through the URL into the
  editor, and checks the song on air has a document behind it.

- THE FRAME LOOP PACED ITSELF BADLY, and that -- not rendering cost -- is what
  "performance is extremely poor" was. The cap was `now - lastFrame <
  _frameTarget - 1`, wall-clock. A vsync tick arriving 1ms early is dropped
  WHOLE and the next lands a refresh later, so the cadence beats between 16.7
  and 25ms. Fed measured timings: 51.9fps with 15.5% of frames hitching at +-1ms
  of tick jitter, 43.6fps / 20.0% at +-2ms. The render itself costs 1-2ms.
  It now counts vsync ticks -- learn the display's interval, draw every Nth --
  which is exact by construction: 60.0fps, 0% hitches, at 60Hz and 120Hz alike,
  and the 120Hz case (previously 55.6fps) is right for free.
  Backoff steps are whole multiples of a 60fps frame now (16.7/33.4/50.1, so
  60/30/20fps). The old middle step asked for 42fps, which no 60Hz display can
  show evenly -- it only ever meant uneven frames.

- Why every benchmark here missed it: headless browsers tick like metronomes,
  so the jitter that triggers it does not exist in them. npm run test:pacing
  therefore asserts the RULE against jittered timings rather than measuring fps
  in a browser that rasterises in software at single-digit frame rates.

- `__rrrFrame.seq` counted ticks SEEN, not frames drawn -- it incremented
  before the cap. `.drawn` is the real one; `.tick` and `.every` show what the
  loop measured and chose.

- Smaller, from the same pass: hueRot re-parsed hex, rebuilt two closures per
  call and ran per sprite per frame (~5% of samples during play) -- memoised on
  colour plus whole degree, verified identical on 10087 colour/angle pairs. The
  Media Session artwork cache grew by one 512x512 PNG data URL per track
  forever; it keeps 8.

- Checked and NOT problems, so nobody re-litigates them: canvases do not
  accumulate (two console panels, cached deliberately, inactive one display:
  none); Create does not rewrite the URL per frame (the guard needs a route it
  never has); songFrom costs 1-3ms a track; the heap is flat across track
  changes. The long tasks a headless profile shows are software rasterisation,
  not JS.

- THE TOKEN IS ENTROPY; THE NAME IS A LABEL MINTED FROM IT. Song.mint() used to
  return four words plus an 8-char nonce, and compile(token) hashes whatever it
  is given -- style, key, tempo, form, harmony, groove, motifs, channel plan and
  instrument bank all come off that string. Measured before changing anything:
  holding the phrase FIXED and varying only the nonce gives the same spread of
  styles and tempos as varying everything (anthem 28/23, house 23/23, techno
  20/20, bpm 74/134/171 vs 75/134/170), because 41 bits of nonce dominate the
  hash. So the words were not audibly coercing the music. The coupling was still
  wrong: a song could not be renamed without becoming a different song, and
  editing SLOTS would have silently rewritten every future composition.
  mint() is 16 base36 characters now (~82 bits) and Song.nameFor(token) derives
  the words one way, at the end. Causality is token->music and token->name; the
  words cannot reach the composer. Deriving rather than storing the name keeps
  it stable across a reload and carries it through a shared link for free.
  Song.title() still reads old word-slugs out as themselves.
  looksLikeCode() widened to 24 chars for the longer token -- it demands both a
  digit and a letter, so a real word still never matches.
  Downloads and cartridge headers take _curName now; a file named after 16
  characters of base36 is no use to anybody.

- THE IDLE CHROME HOLDS FOR THREE SECONDS AGAIN. It had been 350ms plus a 2.9s
  dissolve, on the theory that the fade could BE the countdown. It cannot: the
  chrome starts dimming while you are still looking at it, and it reads as being
  yanked away the moment you stop moving. 3000ms then a 0.42s fade. The wait has
  to be a wait.

- SHARING IS ONE ACT WITH ONE RESULT. The share button copied location.href,
  which only ever worked because the generated name was in the path and the name
  was the seed. Both are gone, so it was copying the bare station. A link
  carries the DOCUMENT now -- packed and in the FRAGMENT, which no browser sends
  to a server, so there is no request limit, no edge config, nothing stored and
  nothing to moderate. 9.5 KB of document deflates to about 2.9 KB, so a shared
  song is a 1600-4400 character URL. Long, but it works everywhere and cannot
  rot.
  Deliberately NOT token-when-unedited/document-when-edited: that is two
  behaviours switched invisibly, where the same button gives a 40-character link
  or a 4000-character one depending on whether you nudged a note.
  Short links (/s/ab12cd + OG preview cards) were designed and declined for now
  -- they need a KV store, which gives the product a backend, persistence and a
  moderation surface it does not currently have. The fragment format stays the
  fallback underneath if that is ever added.

- v13 documents carry the TITLE. Names derive from the token and a document has
  no token, so without this a shared song opened under a different name than the
  sender saw. CT_CREATE.songOf(code) is the inverse of songFrom: a document
  straight to a playable song with no editor. Audio.playDoc() puts it on the
  deck as a real track -- visuals, games, sections, transport -- with the events
  the visuals read rebuilt from the notes.

- Two traps on the way in, both of which produced "it played SOMETHING, just not
  the right song": (1) playDoc returned deckCur.tok, which is '' for a document,
  so every success read as a failure and the caller fell back to a random mint;
  (2) LiveCtl's broadcast tick re-seeks the station every few seconds and seeked
  straight off the top of the shared song half a second in. window.
  _sharedSongPlaying holds it off until the station moves on by itself.

- npm run test:share is the gate, and it checks BOTH directions, because "the
  same from either side" is the actual requirement.

- THE STATION HAD A FAVOURITE RHYTHM, and the report was exact: "it plays one
  two three four and the fourth is longer, and it reuses that pattern in the
  same structure, and it is in so many songs." Measured before touching
  anything: 17.7% of every four-note run in the lead was short-short-short-LONG,
  56.8% of songs contained it, half of all bar rhythms were 14 patterns out of
  531, and the exact figure `0/1 1/1 2/1 3/10` was 4.2% of all bars on its own.
  FOUR structural causes, all of them found in the code rather than guessed at:

  1. THE CORPUS COUNTS WINDOWS, NOT DECISIONS. rhythmCells were mined by sliding
     a window over real GB leads, so a 32-note run of straight sixteenths emits
     29 overlapping '1-1-1-1' cells. Weighting by raw count measures how LONG a
     figure ran, not how often anyone chose it: '1-1-1-1' took 69% of the draw
     and the effective vocabulary of a 96-cell corpus was 5.7 CELLS. Compressed
     by sqrt (what chipPatch already does to instrument weights) -> 58.4, with
     the straight run still the most common single figure at 16%, which is true
     of the genre. This was the single biggest lever.
  2. A HARD FOUR-NOTE CAP. `i < shape.length + 1`, and every contour in
     MOTIF_SHAPE is three long, so every bar of every song was truncated to four
     notes however much rhythm the cell carried. Literally one, two, three,
     four. The contour cycles now instead of severing the figure.
  3. ONE RHYTHM STAMPED ON BARS 0-2 of every phrase. Bar 1 is a varied
     restatement now (head literal, tail moved) and bar 2 develops the rhythm
     as well as the pitch -- displacement, fragmentation, augmentation,
     truncation, which are the standard ways of restating a figure.
  4. THE CADENCE BAR WAS HARDCODED [0,4,8] in every phrase of every song ever
     generated -- a quarter of all melodic bars, three notes then a held one,
     which IS the reported shape. Ten cadence rhythms now; the run still walks
     stepwise onto the goal tone, because that is what makes it a cadence.

  Also: figures are sometimes stated at the eighth rather than the sixteenth
  (the corpus is mined at the sixteenth, so every gap in every song was a 1 or a
  2); the fallback pool went from 8 figures, 6 of them on the 0/4/8/12 grid, to
  20 including anacrusis and syncopation; long even runs get thinned; and
  makeMotif drew a random gap, pushed it, then overwrote it on the next line --
  dead code that made the cell cycle from index 0 forever.

  Result, same measurements: short-short-short-LONG 17.7% -> 7.9%, songs
  containing it 56.8% -> 41.6%, consecutive bars repeating their rhythm
  16.3% -> 11.1%, bar-rhythm effective vocabulary 54.2 -> 167.6, four-run
  vocabulary 26.8 -> 62.3, distinct bar rhythms 299 -> 941.

  NOT flattened into randomness: note spacing is still peaked on 1, 2 and 4
  sixteenths, because that is what the genre is made of, and phrases still
  repeat 10.8% of the time -- repetition is what turns a phrase into a tune, and
  the gate asserts BOTH directions so nobody 'fixes' this into noodling.

- npm run test:rhythm measures the ENSEMBLE, not one song. A single song may
  repeat a figure as much as it likes; the station must not keep reaching for
  the same handful. REV is musician-12.

- THE CRT VIGNETTE WAS TWO DARK VERTICAL BARS on a wide window, and the cause is
  geometric: `radial-gradient(ellipse at center, ...)` fits itself to the box, so
  at 1990x1250 the falloff runs out horizontally long before it runs out
  vertically and the darkening lands as a band down each side instead of in the
  corners. THREE layers were stacked -- the CSS radial, an inset box-shadow, and
  the per-frame canvas radial in _vignette(). Measured on the baked gain mask:
  the edge column sat at 50.9% of centre brightness. A CIRCLE sized to the
  longer axis keeps the falloff in the corners at any aspect ratio; strengths
  cut to roughly a third. Edge is 86.5% of centre now and nothing darkens before
  90% of the width.

- VIG_BG/SCAN_BG in runtime.js MIRROR the .scanlines/.vignette rules in
  shell.html: the first bakes the gain map the CRT actually uses, the second is
  the legacy fallback stack, and scripts/crt-diff.mjs exists to prove they are
  the same pixels. They had already drifted -- crt-diff was failing at max
  channel diff 103 BEFORE this change, and it is not in the npm gate list, so
  nothing was watching. Editing one and not the other took it to 184. Both are
  scaled together now and crt-diff reports 0. If you touch either, run it.

- CREATE IS A VIEW OF THE STATION, NOT A SECOND PLAYER. Owner, 2026-08-28: "make
  it that create and the radio are the same mode -- we are enabling the view of
  the notes or focusing on the visualizer. Two tabs of the same thing." That is
  now literally what it is, and it removed a whole class of bug.
  What it used to do: _openCreate called Audio.enterCreate(), which posts
  {type:'stop'} to the worklet -- so merely OPENING the editor killed the chip
  before the editor had decided anything -- then Create armed the chip with a
  silent host song and started its OWN transport from bar one. Closing reversed
  it. Every silence anyone has reported lived in that swap, and it also meant
  pressing Create dropped you at the start of a song you were in the middle of.
  Since the merge the station is ALREADY playing this exact document, so there
  is nothing to hand over. `owning` is the line: while it is false the station
  is the player and this is a view of it. open() follows what is sounding (same
  song, same position, no gap), pause/play drive the SHARED transport, and the
  chip is taken only when you actually change something. close() on a view that
  never owned calls _closeCreateView() -- visuals only -- instead of
  _closeCreateReturn(), because there is nothing to give back.
  Measured: chip owner stays 'radio' with the editor open, the deck runs
  continuously across the open, the editor lands on bar 34 of 53 rather than
  bar 1, and it SOUNDS without pressing play.

- Second cause of the same silence: Create's `gestured` flag is module-local and
  knew nothing about the click that had already started the radio, so
  startPlayback refused to start ("nothing can sound yet: stay honest") while
  armChip had already stopped the station. audioLive() seeds it.

- scripts/crt-diff.mjs IS FLAKY -- the same build gives different verdicts run
  to run (seen passing at 0 and failing at 101 on the same code, DPR 2). It is
  not in the npm gate list and nothing watches it. Do not read a single run as
  a regression, in either direction, and do not claim a fix from one pass.

- THE TRACK RIBBON. Owner asked for the horizontal strip of notes back, at the
  bottom, narrow, showing the whole track -- and then: "conceptually this is
  like showing the waveform of the music, where the progress bar usually is."
  So it is both. A music player draws a waveform under the scrubber; a Game
  Boy's waveform is its NOTES, and since the merge the station plays a document,
  so they are simply there to read off score.gb.notes. Every note of the track
  at once, x = frame/totalFrames, y = pitch (drums on their own band at the
  foot), colour = the editor's four lane colours, bar lines behind. What has
  played is lit and what is coming is dimmed, which is the progress bar.
  52px tall (40 under 820px), bottom:0, and the bottom chrome steps up over it
  via body.ribbon-on.
  Baked ONCE per track into two offscreen canvases (lit + dim) and blitted
  twice a frame with a clip, because a thousand notes redrawn every frame is
  exactly the kind of thing the pacing work was about. Frame cost stays ~1ms.
  It is the station's: hidden with the editor open (which has its own grid), in
  wallpaper/popover/browse, and until the playbar is up -- Audio.started is not
  the same question as "is the player up", because the deck compiles a track
  before anyone presses anything.
  npm run test:ribbon holds the geometry, that the played part grows, that the
  baked track does NOT get redrawn, and the frame cost.

- Not built, deliberately: scrubbing. It looks like a scrubber and a listener
  will try to drag it. gotoTrackAtOffset exists but a document deck has no
  token, so seeking a shared or edited song needs its own path. Ask before
  wiring it rather than half-wiring it.

- THE STRIP MOVED INTO THE PLAYER BAR, with the transport, the way a music
  player groups them (owner's reference: Roon). #playbar .pb-ctrl is a two-row
  group now -- prev/play/next above, elapsed | track | total below -- and over
  the game that pill becomes a column instead of a 142px lozenge. It fades with
  the rest of the chrome, because idle means gone here.
  TRAP: a canvas reports its BUFFER width as its intrinsic size, so `flex:1 1
  auto` let the buffer decide the layout that decided the buffer. The measured
  size changed every frame, the bake key with it, and the strip re-baked a
  thousand notes sixty times a second -- 41ms a frame. `flex:1 1 0%; width:0`
  breaks the loop; the key is also rounded to 4 device pixels. And
  getBoundingClientRect() in the frame loop forces layout every frame: measured
  once every 45 frames and on resize instead. __rrrFrame.rib times the strip on
  its own (0.02-0.03ms) because the frame EMA is dominated by the game.

- FOUR LANES, NOT ONE PITCH BAND. The first cut mapped every melodic voice into
  a single band with drums beneath. Drums are usually more than half the notes
  in a song, so it came out 69% purple and read as one colour rather than four
  voices -- reported as "it does not have the colour coding of create mode".
  Melody / Harmony / Bass / Drums now each own a quarter of the strip in the
  editor's own lane colours, each scaled to its own pitch range so a bass line
  uses its whole lane. The gate matches rendered pixels against those four
  colours and fails if any one voice takes more than 75%.

- NOTHING PLAYS UNTIL YOU ASK. A cold load minted a random track and started it
  -- or joined the scheduled broadcast, which amounts to the same -- answering a
  question nobody had put. The station holds (Audio.holdForPick) and the moods
  are the question: they sit in the middle of the screen, do not fade, and shrink
  back to the top strip once something is on. Deep links (/track/<slug>, #s=)
  still play immediately; the broadcast is still reachable, it just does not grab
  the room on the way in.

- THE WAY INTO THE EDITOR IS THE STRIP ITSELF. Owner asked for a good idea here;
  this is it. The strip is already a miniature of the editor's grid, so clicking
  it opens the full one ON THAT SONG -- no separate button to find, and the
  gesture is "pull these notes up". A hover chevron says so. "From scratch" sits
  at the end of the moods and opens an empty grid (CT_CREATE.openBlank), which
  needed a flag because the build path deliberately composes something when it
  finds no cells.

- The handover gate had encoded an assumption that is no longer true: it pressed
  play after opening the editor, which now PAUSES, because the editor opens
  following what is already sounding. It picks a mood to start and only presses
  play if the editor is not already running.

- THE WAITING SCREEN IS A LANDING PAGE. Name, one line of what this is, then the
  choice -- centred, in that order. The big play button and its paragraph
  ("An endless Game Boy radio. Press play...") are hidden while waiting: the
  moods are the entry now and two calls to action in the same square of screen
  is one too many. The rail stops repeating the title while the hero shows it
  (its How-it-works button stays), and the hero's brand is display:none the
  moment something plays.

- Rail, by owner instruction 2026-08-28: no Create button (the strip of notes is
  the way into the editor, and it opens the song you are actually hearing), the
  Game Boy emulator first, "Download as Game Boy ROM" directly under it -- the
  cartridge belongs under the offer to run it, not beside a WAV -- then WAV, Web
  radio, GitHub, then a "Made by TetrisGM @GitHub @Twitter" credit under the
  offers. The screen pill says "Graphics: <face>" rather than a bare face name.
  "Start from scratch", not "from scratch".

  ⚠ The Twitter URL is a GUESS: nothing in this repo records one, so it matches
  the GitHub handle (twitter.com/tetrisgm). Correct it if that is wrong.

- Three gates encoded the old entry (a click anywhere starts music) and two
  found the editor by looking for a button whose text says "create". Both
  assumptions are gone: they pick a mood to start, and they open the editor by
  clicking the strip, which is what a person now does.

- THE PLAYER BAR IS FURNITURE. It used to appear only once a track was on, so
  the first thing a visitor saw was a page with no transport and the bar arrived
  under them the moment they picked a mood. _updatePlaybar shows it from the
  first paint; the strip has a real EMPTY state (the lanes, no notes, 0:00 /
  0:00) rather than being absent, and the hero centres in what is left above it.
  With nothing loaded the play button means "surprise me" -- it clicks one of
  the moods, because that is the only way anything starts now. Clicking the
  empty strip opens an empty editor.
  "How it works" is a plain .plink again: it had been overridden to 32px with a
  smaller label, so the one button in the masthead read as a different family of
  control from the five under it.

- THE STRIP WAS BEING REPAINTED BY THE CONSOLE PALETTE. CT_PAL hooks fillStyle
  on CanvasRenderingContext2D.prototype and quantises EVERY canvas to the Game
  Boy's four shades or the NES palette while one of those screens is on. The
  screen face is random per track, so the lane colours were correct on the CRT
  and snapped to something else on the other two -- reported as "no colour
  coding", fixed, and then still wrong on two thirds of tracks without anyone
  seeing it. canvas.__ctpalRaw is the existing opt-out (Create's grid already
  used it); the strip and its two offscreen bakes set it now.
  This is why verify-ribbon checks rendered PIXELS against the four colours
  rather than trusting the fillStyle it asked for.

- Four reports, four causes, 2026-08-28:
  * The transport read as PLAYING on a cold load. _transportIsPaused() knew
    about gating and about Audio.isPaused but not about the new hold, so a
    station that was waiting to be asked showed a pause button and ran the game.
    Holding is paused.
  * "Start from scratch" opened a page full of notes. open('') falls through the
    URL to the saved localStorage draft, so it opened whatever you were last
    working on -- in answer to a request for nothing. wantBlank skips the draft.
  * A note sounded for no reason on opening the editor. The editor opens UNDER a
    cursor that has not moved; the first pointermove is the browser reporting
    where the pointer already was, and if a note arrived beneath it, it played.
    Hover audition arms on real movement (3px) now.
  * "Pausing the music should pause the gameplay" -- and the sim WAS frozen
    (2.2% of pixels still moving on the CRT, which is the decay tail). The
    console panels quantise a ~500px framebuffer up to the whole window, so that
    2% flipped whole blocks and the picture read as alive: 22.9% on the NES face.
    The panel holds its last frame two frames after a pause now: 1.9-2.3%,
    the same as the CRT.

- The masthead ("Chiptunes.app ... How it works") collapses to just its button
  once music is playing. Saying what the page is answers a question only an
  arriving visitor has; with a song on it is a panel of prose over the game.

- THE PLAYER BAR IS DOCKED, full width, the shape a music player uses. It had
  been four pills floating in the corners over the game; it is one bar now --
  track on the left, transport with the song's own notes in the middle, and the
  desk on the right: Display, BPM, Volume, then the advanced mixer. Display and
  BPM sliders sit LEFT of Volume, each with its number, and the whole bar fades
  as one unit on idle rather than four things on four schedules.
  #pbBpm drives Radio.setTempo; #pbVol drives window._sessionMixSet('master').
  #pbAdv opens the same mix panel the volume icon does -- verified: volume 100
  to 30 halves the measured peak, BPM 101 to 150 reaches Radio.state.tempo.
  The screen pill had been fixed-positioned at 50%+81px from when it lived
  outside the bar, so it floated over the strip until that was neutralised; it
  says "Display: CRT/Game Boy/NES/Random" now.
  Sliders drop first on a narrow window, then BPM, then the Display label -- the
  numbers survive longest.

- "TAP ANYWHERE TO START" WAS STILL WIRED, and it undid the hold from a
  distance. _gestureShouldResumePaused fires on any pointerdown when the
  transport is paused; holding correctly reports as paused (nothing IS
  playing), so every stray click on the background read as "resume", reached
  _transportToggle, and took its surprise-me branch -- a random mood, started by
  someone who had clicked nothing in particular. Reported from the wild as "I
  went to the page and it just started playing music".
  That handler stands down while holding. The play button keeps the surprise-me
  branch, because pressing play is a deliberate act; a click on the page is not.
  npm run test:entry is the gate: four clicks that mean nothing must start
  nothing, and the two that mean something must still work.

- The credit reads "An AI product experiment by Shokunin" with three round icon
  buttons: GitHub, X and Hacker News, all github.com/tetrisgm,
  twitter.com/tetrisgm, news.ycombinator.com/user?id=tetrisgm (owner confirmed
  the handle; the earlier guess was right). Icons are drawn inline -- nothing
  here loads a third-party asset.

- The How-it-works LABEL did not match the other rail labels even after the pill
  did: `#plinks .plhead span`, written for the masthead's description paragraph,
  is a descendant selector, so it also caught the spans INSIDE the button and
  beat .plink-t on specificity -- 15px/400 against everything else at 13.5px/600.
  It is `> span` now. If you add anything else to the masthead, remember that
  rule reaches into it.

- THE BAR OWNS THE BOTTOM; EVERYTHING ELSE IS CONTAINED ABOVE IT. The stage was
  inset:0 and sized from innerHeight, so the game ran underneath the player bar
  and the bottom of the picture sat permanently behind it. --barh is the bar's
  MEASURED height (0 in wallpaper/popover/browse, where it is not shown),
  published by _syncBarInset() every 32 frames and on show/hide; the stage, the
  CRT layers and the editor all end there, and resize() subtracts it.
  Three things had to follow:
  * .crt is a CANVAS for the gain layer -- a replaced element, so with
    height:auto its intrinsic buffer size wins and the bottom inset is simply
    ignored. It needs a stated height:calc(100vh - var(--barh)).
  * the gain map bakes to the PICTURE's size, so publishing --barh dispatches a
    resize; otherwise its vignette sat a bar's height too low.
  * html.audio-background hides the playbar, and opening the editor parks the
    frame loop into exactly that mode -- so the bar under the editor was there,
    laid out, opacity 1, and invisible. Exempted while create-open.
  The STRIP STAYS while the editor is open: the bar must be the same height in
  both views or the thing contained above it jumps when you open one. And the
  editor's own play/rewind are hidden -- the bar carries the transport; the
  editor's row keeps only what the bar has no business knowing (Follow, Speed,
  Grid).

- THE CRT VIGNETTE, MEASURED PROPERLY AT LAST. Reported as a dark vertical bar
  slightly right of centre. Column analysis of a screenshot is useless here --
  it is dominated by the game's own walls and floor. The way to see the EFFECT
  is to freeze the scene (pause), capture with __rrrScreenMode('crt') and then
  ('off'), and divide: that ratio IS the effect's transmission curve, free of
  content. It showed a smooth falloff, NO sharp step anywhere -- so there was
  never a bar, there was a vignette strong enough to read as one: 0.846 in the
  middle against 0.694 at the edges. Cut to 0.846 / 0.789, a 6% falloff.
  scripts/... the isolate technique is worth keeping: freeze, toggle, divide.

- Rail: the lone GitHub row is gone -- the credit carries GitHub, Twitter and
  Hacker News as full rail pills (icon and label, 46px, same as every other
  offer) rather than bare circles. The desktop card says "Use these games as an
  animated wallpaper" and sits at bottom:calc(var(--barh) + 18px), inside the
  picture: the player bar owns the bottom of the window on its own, and nothing
  that belongs to the game may overlap it.

- THE PICTURE RAN AHEAD OF THE SOUND, reported as "the music plays almost 1 sec
  after" the strip. Measured, and the report was literally right: 1026ms in one
  session. The cause is a clock mismatch, not a latency. A deck opens 0.18s in
  the future and gbPlay tells the chip to wait the same leadSec -- but the
  worklet starts counting that lead when the AUDIO THREAD receives the message,
  not when the main thread posted it, and how late that is depends on what the
  machine was doing at the instant the track started. Measured across sessions:
  20ms, 206ms, 1026ms. It is NOT a constant, so no constant can correct it.
  The chip already reports its true frame ~9 times a second (report() every 40
  blocks). The difference between that and the deck's clock IS the correction,
  taken live and per track. Audio.audiblePosition() is deckPosition() minus it;
  the strip and the editor's playhead use it. ANYTHING SCHEDULING AUDIO MUST
  KEEP USING deckPosition -- that is the clock the scheduler runs on, and
  correcting it would move the music rather than the picture.
  Residual is ~100ms, which is the anchor's own report interval: the floor
  without making the worklet talk more often.
  MEASUREMENT TRAP: comparing a fresh deck clock against whatever __rrrChip
  happens to hold measures the report interval, not the lag. Sample only when
  the reported frame CHANGES. That mistake made the same bug read as 206ms once
  and 1026ms the next time.
  npm run test:sync holds it.

- THE HOME DOES NOT FADE, and its bar is a transport and nothing else. Idle-hide
  exists so that watching the game leaves only the game; on the home there is no
  game yet, and a landing page whose offers vanish three seconds after you
  arrive cannot be read. Everything holds until something is playing.
  The bar drops Now playing, the elapsed/total of a track that does not exist,
  the tempo and volume of silence, and a screen control for a picture that has
  not started -- all readings of a song. The strip stays (an empty box) so the
  bar keeps one height across both states and nothing above it jumps.
  The empty strip is NOT a door either: clicking it used to open a blank editor,
  which is what "Start from scratch" is for, and it is what a stray click in the
  middle of the bar landed on.
  The "this is a background radio, just listen" hint waits for a radio. It fired
  on any key or click, over the very buttons that would give you something to
  listen to.

- On the home the credit holds the MIDDLE and the ask sits in the corner (owner's
  choice, offered against two other arrangements). Done by moving the nodes
  (_syncHomeLayout, on the frame loop's 32-frame tick) rather than positioning
  from a distance: the hero is a centred flex column of unknown height and a
  fixed element cannot be told to sit inside one. .rmood-ask wraps the label and
  the pills so they travel together.

- Full screen is a rail pill with a label, 46px, like everything else; it was a
  54px circle with a bare glyph. The credit line is 600 13.5px, the same type as
  every button label beside it.

- verify-create-handover is INTERMITTENTLY FLAKY -- seen failing once and passing
  on the next run across several unrelated changes. Re-run before believing it.

- THE HOME: credit TOP CENTRE, the ask BOTTOM LEFT, and a bar that is only a
  transport. The strip goes too -- with nothing loaded it was an empty rounded
  box in the middle of the bar and read as a control.

- TWO BUGS FOUND DOING IT, both worth remembering:
  * Placing the credit inside the hero was done by MOVING the node into #rmoods
    (the hero is a centred column of unknown height, which a fixed element
    cannot be told to sit inside). That is a timing dependency: on the deployed
    build the move had not happened yet while `position:static` had already
    applied, so a body-level element fell into normal document flow and landed
    at x0-1180, y6 -- full width across the top. Fixed + translateX(-50%) needs
    no move and cannot race. Prefer placement over reparenting.
  * --barh was NEVER PUBLISHED on the home. The call was gated on
    `(_frameSeq & 31)===0`, but _frameSeq counts TICKS while that line only runs
    on DRAWN frames -- the loop draws every second tick, so drawn frames all had
    one parity and multiples of 32 had the other. It never fired. Everything
    anchored to `calc(var(--barh) + 18px)` fell back to 18px and sat under the
    bar. It has its own counter now (_barhTick), and _updatePlaybar publishes it
    eagerly the moment the bar is shown rather than waiting half a second for a
    tick. If you gate anything else on a frame counter, check which frames the
    line actually runs on.

- NO PLAYER BAR ON THE LANDING PAGE (owner reversed the earlier "always the same
  bar" call after seeing it): stripped of now-playing, clock, tempo, volume and
  the strip, what was left was three buttons and an empty band across a landing
  page. --barh goes to 0 with it, so the ask, the card and the picture run to
  the bottom of the window.
  TRAP: `body.awaiting-mood #playbar.show{display:none !important}` LOST to
  `body.ai-visual #playbar.show{display:grid !important}` -- identical
  specificity, and the ai-visual rule is further down the file, so source order
  decided it. Prefixing `html` broke the tie. Two !important rules of equal
  weight are decided by position, which is not obvious when they are 1000 lines
  apart.

- THE SWAP WAS FOR THE PLAYING SCREEN, not the landing page (owner had to say so
  twice; the first reading cost a round trip). Credit at the top in BOTH states;
  the moods are the hero's last line on the landing page and the bottom-left
  corner while a song plays.

- THE LANDING PAGE IS A REEL: the wallpaper game cuts every 2s through the
  roster. One game for as long as somebody reads the page says "here is a game";
  cutting says "here are fourteen, and they play themselves", which is the
  product. Runs only while awaiting-mood, never when a game is pinned, never
  while the tab is hidden, and stops the moment a mood is picked. 0.5ms a frame.

- THE LAG BEFORE A SONG STARTS WAS latencyHint:'playback'. That asks the browser
  for the largest output buffer it likes: glitch resistance bought with delay
  before anything is heard. It is why "start a mood" and "click next" felt late,
  and it is also why the playhead correction measured 20ms in one session and
  1026ms in another -- the buffer is negotiated per context. 'interactive' now.
  The chip runs on the AUDIO thread, so it was never the one at risk from a busy
  main thread. Measured after: deck-vs-chip 32-65ms (was 20-1026ms), skip to
  audible 229ms median, which is the deck's own 0.18s lead plus the hop.
  Also measured, so nobody optimises the wrong thing: the mood search over 140
  candidates is 7ms, a composer compile is 1ms, a document materialisation 1ms.
  None of those were ever the delay.

- THE PLAYER BAR IS APPLE MUSIC'S SHAPE: transport and volume on the left, a
  now-playing panel in the middle -- the track name over a thin scrubber with
  the clock at either end -- and what changes the PICTURE on the right (Display,
  BPM, the mixer). 79px tall, down from 111; the strip is 26px, down from 44.
  Every element that was there is still there; it was the arrangement.
  The volume readout sits beside its own slider now: on the far side of the bar
  from it, next to the BPM number, it rendered as "104100".

- LANDING PAGE: no bar, no full-screen button, no desktop card, credit in the
  bottom-left, moods in the hero, and the wallpaper game cutting every 2s
  (verified: racer -> squadron -> trooper -> vortex -> blast in 8s).
  __rrrFrame.game reports the current pack -- window.curGameKey is not a global
  and selGame.key is empty, which cost two bad probes before this was added.

- scripts/crt-diff.mjs: ITS PASSES USED TO BE VACUOUS. Both screenshots were
  solid black -- the stage was never painted, or was cleared by a resize between
  paint and capture -- so the two CRT paths were compared over nothing and every
  "ok" meant nothing. I reported one of those passes as proof the paths agreed;
  it was not. There is now a blank-frame guard: a comparison of an unpainted
  frame is an ERROR, not a pass. It also repaints immediately before each
  capture and stops the 700ms UI tick, because _updatePlaybar -> _syncBarInset
  -> resize() clears the stage.
  With real ink in the frames the paths DID differ, and that was mine: softening
  the vignette, I scaled VIG_BG (which bakes the gain map) and the .vignette CSS
  (the legacy layer) by two separate guesses. They are the same layer and must
  be identical strings. They are now, and DPR 2 diffs at exactly 0.
  STILL FLAKY AT DPR 1: sometimes 0, sometimes ~95 LSB, same code -- a race
  where the gain path is captured against a stale map that __rrrCrtReady does
  not catch. NOT in the npm gate list, and it should not go in until that is
  understood. Do not read a single run either way.

- THE LANDING PAGE'S BACKDROP WAS A FLAT FILL, not a game -- reported as "this
  is not currently happening", and it was not. The reel WAS cycling packs every
  2s (the key changed: squadron, trooper, vortex, blast, blocks) but every one
  of them drew its empty first frame and stopped: four distinct colours on the
  whole stage. Cause: _transportIsPaused() returns true while the station is
  holding -- correct for the play icon, since nothing is playing -- and the
  frame loop feeds that same flag into simDt. Pausing a SONG should stop the
  games; having no song yet should not. The loop distinguishes them now, and
  the stage draws 385 colours.
  MEASUREMENT NOTE: "the game key is changing" is not "a game is drawing". The
  first check only proved showGame() was being called. Count distinct colours on
  the stage, or the reel can look healthy while the page is one flat rectangle.

- A SCRIM behind the hero: with a game running under it, the name, the line and
  the pills were competing with a platform every two seconds. Radial and centred
  on the hero so the artwork still reads at the edges, where nothing is text.

## The furniture pass (2026-08-29)

- THE REEL DID NOT DEPEND ON THE RENDERER, and now it does not. `_syncReel()`
  was called from exactly one place: the frame loop, every 32 drawn ticks. That
  is fine while the loop runs -- but the loop is what parks itself when the tab
  becomes a background audio source, so entering the home in that state left the
  wallpaper on one frozen game forever. It is called on the state change too
  now. Measured cadence 2002/1998/2004ms over the 14-game roster.
  GATE NOTE: timing the reel by SAMPLING `_reelAt` from the page is skewed by
  `showGame()` itself -- a pack that takes 900ms to load blocks the sampler, so
  the cut is detected late and the next one looks early (923, 2911, 1995 on a
  perfectly regular 2s timer). Check the mean and the count, not each gap.

- `offsetParent` IS NULL FOR `position:fixed`, however plainly the element is on
  screen. The desktop card's wallpaper used `if(!card.offsetParent) return` as
  its "am I visible" test and therefore skipped every single frame: the canvas
  stayed at one colour and nothing moved. `getClientRects().length` is the test
  that works for fixed elements. Anything else in here guarding work on
  visibility should be read with this in mind.

- THE DOCKED PLAYER BAR'S RULES COME BEFORE THE FLOATING ONES in shell.html, and
  both are `body.ai-visual #playbar ...` -- same specificity, so source order
  decides and the floating pill wins every tie. That is why the docked overrides
  in that block all carry `!important` (`position:static !important` and
  friends). A docked-only change to a property the floating rules also set has
  to say `!important` or it silently does nothing. The Display button's height
  is the newest member of that group.

- TRACK NAMES ARE A TRADEMARK SURFACE. The generator now assembles NES/Game Boy
  era words, which is what was asked for and reads right -- but era vocabulary
  is exactly the vocabulary real cartridges used, so combinations WILL land on
  real titles by chance. `BLOCKED` in src/seed.js lists the ones this word pool
  can actually reach; `nameFor` re-rolls on a hit, deterministically, and the
  last attempt uses a shape that cannot collide. 200k samples, zero hits, held
  by `npm run test:chrome`. If you widen the word lists, widen BLOCKED with them
  and re-run that gate -- this is the same hazard as pack naming (AGENTS.md) and
  a complaint lands on the repository, not the string.

- `npm test` EXISTS NOW: build, the browser gates in the order they were
  written, the two smokes, the game audit. It is a manual command. Nothing
  invokes it on a trigger and nothing may be made to. `crt-diff` is still out of
  it, for the reason recorded above.

## The picture was leading the sound (2026-08-29)

Reported as "the performance is really bad again and when I click next it takes
a second for audio to come out, whereas the games and the visual progress of
things being played happens instantly."

- THE OUTPUT LATENCY WAS NEVER MEASURED. `ctx.currentTime` is where the graph is
  RENDERING; the sample rendered at T is not heard until T plus the device's
  output buffer. Every visual clock in audio.js was timed against
  `ctx.currentTime`, so on a device with a real buffer the games, the beat grid
  and the playhead all ran that far ahead of the music. On this Mac's own
  speakers that is 34ms and invisible. Over AirPods it is routinely 150-250ms
  and over AirPlay it can exceed a second — which is exactly the report.
  `outLatency()` in src/audio.js measures it and three visual clocks now carry
  it: `consumeEvents()` (the single choke point for every audio-timed visual,
  so the games come with it), `gridNow()`'s phase, and `audiblePosition()`.
  `deckCur.origin` is UNCHANGED and must stay that way — the scheduler runs on
  it, and moving it would queue every note late.
  WHY `getOutputTimestamp()` AND NOT `ctx.outputLatency`: WebKit has never
  shipped `outputLatency`, and Safari is the browser this matters most on.
  Take the LARGER of the two signals — Playwright's WebKit returns a
  `getOutputTimestamp` whose contextTime equals currentTime (a latency of
  exactly zero, which no real output has) while its `outputLatency` says 15.8ms,
  and preferring the timestamp threw the only real number away.
  `__ctDiag()` in the console reports it, because this number cannot be measured
  from a test runner: Playwright's WebKit is not Safari and neither is playing
  through the owner's actual output device.

- ONE PRESS OF NEXT STARTED TWO TRACKS. `_ensureGeneratedTransport()` guards on
  `!Audio.trackToken()` meaning "nothing is loaded" — but a mood and a shared
  link both enter through `playDoc`, which starts a real deck with an EMPTY
  token, because a document has no seed to be named by. So the first Next after
  a mood minted a token, compiled it and started it, and then the next line
  called `Radio.next()` and started a different song 30ms later. It takes a
  `startOne` argument now, and the skip paths pass false. Guarded by
  `npm run test:latency`.

- WHAT WAS *NOT* THE CAUSE, all measured: `leadSec` is a constant 0.18 (by
  design, and the chip is still told exactly that); composer.compile 4.8ms;
  CT_CREATE.songFrom 10ms; `new Sequencer(gb)` on the audio thread 0.1-0.5ms;
  structuredClone of the 126KB payload 0.5-1.3ms; the whole click handler
  5-15ms; `_deskShotFrame`'s blit and getComputedStyle 0.2ms each.

- ⚠️ HEADLESS CHROMIUM HAS NO GPU AND WILL LIE TO YOU ABOUT THIS PROJECT.
  It runs WebGL through SwiftShader, in software. Measured there, the `dmg` and
  `nes` screen faces showed 1.2 and 2.8 fps, 879ms long tasks, a main thread
  100% busy, and worklet stat messages arriving in bursts — a completely
  convincing performance regression that does not exist. The same build headed
  with `--use-angle=metal` on the M4: 57-60fps on all three faces, zero long
  tasks, stats on a clean 116.1ms cadence. `dmg-screen.js` and `nes-screen.js`
  are WebGL shader pipelines; anything that touches them must be measured on a
  real GPU. Check with `WEBGL_debug_renderer_info` before believing a number.
  The same artifact makes the desktop-card wallpaper check flaky: at 2fps a
  fixed 900ms window legitimately contains no new frame, so `verify-chrome`
  polls for the change instead. Its colour-count assertion was wrong for a
  related reason — it failed at 4 and 8 tones and passed at 107 on identical
  code, because it was really asking whether the game showing at that instant
  happens to be colourful. It compares the wallpaper's palette to the stage's
  now, which is the claim that was meant.

## The performance pass (2026-08-29)

Reported as "severe performance issues running the website overall", in Safari.

- **FIRST, THE ENVIRONMENT.** The owner's Mac was compiling Chromium (`siso` out
  of `~/dev/webweb/upstream/chromium/src`, 12 clang processes, **load average
  ~100-115**) for the whole investigation. That alone makes every browser on the
  machine stutter, and it contaminated every Safari measurement taken that day
  in BOTH directions -- the "before" baseline as much as the "after". Before
  concluding anything about this site's performance from a local measurement,
  run `uptime`. A load average over ~10 on this machine means stop and wait.
- **HEADLESS CHROMIUM HAS NO GPU.** It runs the DMG/NES WebGL panels through
  SwiftShader, where they measure 1.2 and 2.8 fps with 879ms long tasks and a
  main thread pinned at 100%: a completely convincing performance regression
  that does not exist. Headed with `--use-angle=metal` the same build is 57-60fps
  with zero long tasks. `verify-screens.js` asserts it is not on SwiftShader
  before it measures anything, because this fooled a whole afternoon once.
- Safari's real numbers, read off an on-screen probe (`?perf=1`, and
  `?perf=1&noblur=1` for the backdrop-filter A/B) because **Safari cannot be
  profiled from a session here**: `safaridriver` needs an authorisation we must
  not create, Safari has no `longtask` observer, and Playwright's WebKit is not
  Safari. The probe measures rAF deltas, which every engine reports alike.
  Safari's output latency measured **5.8-11.6ms** -- so the earlier theory that
  Safari was buffering ~1s was wrong.

### What was actually fixed

- **Inactive screen pipelines are freed.** `setMode(false)` set `display:none`
  and released nothing, so once the default "Random" had shown all three faces
  the page held CRT, DMG and NES render targets simultaneously -- on the order
  of 300MB at the 2400x1500 these run at. `sleep()`/`wake()` drop every
  full-resolution target and shrink the drawing buffer to 1x1; the compiled
  programs and parsed preset stay, because those are what is expensive to
  rebuild. Held by `npm run test:screens`.
- **The vignette cache is bounded in BYTES, not entries.** `_VIG_LRU=12` was
  chosen when the entries were small; each is a full device-resolution RGBA
  canvas, so the real bound was ~154MB. Now 48MB, and dropped entirely whenever
  the CRT is not the face on screen.
- **Uniform locations are looked up once per program, not once per frame.** The
  DMG preset has 86 parameters; with MVP, three sizes, FrameCount and the
  samplers that was ~145 `getUniformLocation` calls per frame, ~8,700 driver
  queries a second, for answers fixed at link time.
  ⚠️ The regex that made this change also rewrote the cache's OWN lookup into a
  call to itself. It parsed fine and would have infinitely recursed on first
  frame, killing both panels. If you do a sweep like this, check the helper.
- **`resize()` stopped forcing layout every frame.** Both panels read
  `clientWidth/clientHeight` in `frame()`. A ResizeObserver sets a dirty flag
  instead -- it catches the `--barh` inset moving, which a window-resize
  listener would not.
- **The CRT gain map is built when the CRT is the face**, not at module
  evaluation. Two `getImageData`, a `putImageData` and a ~3.6M-iteration JS loop
  ran on every load, including the two loads in three where the toss picks a
  panel and the map is never shown.
- The desktop card's wallpaper is a recorded WebP, not a live blit of the stage.

### Known and NOT fixed

- **16 backdrop-filter surfaces** can be on screen at once over a continuously
  repainting canvas. Chromium/M4 absorbs it entirely (118 -> 120fps with them
  forced off, p95 unchanged), so it cannot be judged from here. `?perf=1&noblur=1`
  is the A/B; it needs a quiet Mac and real Safari.
- **Safari backdrop-filter A/B completed (2026-08-29).** At 1800x737 CSS px,
  DPR 2, blur on measured 59.9fps / 18.0ms p95 / 18.0ms max; blur off measured
  60.9fps / 18.0ms p95 / 18.0ms max. The long-stall counts varied slightly
  between runs (5 vs 4 over 50ms), so there is no material backdrop-filter cost
  to remove at this viewport. Keep `?perf=1&noblur=1` as the diagnostic for
  future Safari regressions.

### Closed in the 2026-08-29 pass

- `_renderEMA` now measures after the panel, ribbon and periodic layout-sync
  work, so its JS cost covers the drawn frame. The rAF-gap probe remains the
  GPU/compositor complement.
- DMG and NES backing dimensions are capped at roughly 2,000,000 pixels per
  surface. The screen source texture is allocated on dimension changes and
  updated with `texSubImage2D` thereafter.
- The editor's animation path uses cached track metrics instead of reading
  layout on every frame. Bar insertion and duplication now respect the actual
  steps-per-bar and the 48-bar limit.
- `verify-ribbon` now asserts the shipped docked transport geometry rather than
  the obsolete viewport-centering layout. `crt-diff.mjs` passed all ten cases
  (including DPR 1 and DPR 2), and the complete `npm test` suite is green.

## One-pass mood composition (2026-08-30)

- Landing and editor moods formerly compiled as many as 140 complete songs and
  kept the first whose style, mode and tempo metadata matched. Nothing listened
  to those candidates, so this was both the dominant mood-click cost and a
  production best-of-N path in conflict with the product contract.
- A mood is now a normalized `{styles, mode, bpmMin, bpmMax}` premise passed to
  the one composer. The existing style, mode and tempo choices are constrained
  before generation; one opaque token is minted and one score is compiled.
  Impossible combinations fail instead of silently returning a mislabeled
  partial match. The normalized premise is recorded at `score.tracker.premise`.
- `compile(token)` without a premise is byte-for-byte unchanged. The 48-song
  smoke ensemble retains SHA-256
  `72731f65bb59e30722a9ba09dd069f98d697c1de887375c21d043d355cfbf566`.
  `verify-mood-constraints` holds the constraint behavior and checksum;
  `verify-entry` holds the production interaction to exactly one compiler call.

## Complete chip-song exports (2026-08-30)

- Create ROM/WAV and station WAV/AAC wrappers used to reconstruct a chip song
  from only `notes`, `bank` and `totalFrames`. That silently discarded `auto`,
  `vibOff`, `waveLoads` and `kit`, so exported performances could lose duty,
  pan and pitch motion, let vibrato overwrite glides, miss wave-table changes,
  or omit sampled drums even though live playback retained them.
- Export and offline-render boundaries now pass the complete `gb` song object
  rather than enumerating its current schema. The same invariant covers the
  browser engine, Node broadcast renderer and ROM-audio comparison helpers;
  kit-only chip scores are accepted by both renderer entry points.
- `verify-export-boundaries` edits a real song until it contains all four data
  classes, intercepts the actual Create ROM/WAV buttons, and checks the shared
  station WAV/AAC boundary with sentinels. It is part of the main test gate.

### Still worth doing when the environment permits

- A quiet-machine performance capture at other viewport sizes could still be
  useful, but the real Safari A/B at the shipped size found no actionable cost.
- The radio endpoint should be rechecked if the reported 404 returns; the
  current probe on 2026-08-29 returned HTTP 200 audio from
  `https://radio.chiptunes.app` and valid `.pls`/`.m3u` responses.
## Wallpaper product extraction (2026-08-30)

- The animated desktop wallpaper is now a separate product in
  `github.com/tetrisgm/wallpaper`. Chiptunes no longer contains the Electron
  application, native wallpaper bridge, update publisher, wallpaper download
  assets, platform download offer, or the in-player wallpaper promotion card.
- The Chiptunes game packs remain because they are still the music player's
  visualizers. The new Wallpaper repository owns its own copy of the initial
  14-scene roster and drives it with a visual-only clock; it does not bundle the
  composer, audio engine, radio, editor, or music export paths.
# 2026-08-31 — Listen Anywhere and track-change presentation

- `/radio` is the standalone “Take CHIPTUNES.APP with you” page; generated visual playback uses `/player`.
- The permanent public MP3 endpoint remains `https://radio.chiptunes.app`.
- Canonical app playlists are `/listen.m3u` and `/listen.pls`; legacy `/radio.m3u` and `/radio.pls` remain available.
- The stream advertises CHIPTUNES.APP, “Endless Game Boy radio,” the requested genre set, square artwork, and `Game Boy - Track Title` ICY titles.
- Every generated track-ready event produces a 300 ms CRT/noise transition, covering both skips and natural handoffs.
- The player-bar track title uses the same 25 px/600 system type treatment as the rest of the playing UI and the bar contents are vertically centred.
- The playing dock is a single baseline with three non-overlapping zones: a 420 px metadata lane that keeps Share visible, a flexible transport/progress lane, and volume/fullscreen on the right.
- The root landing page opens directly on the Game Boy chooser; the separate CHIPTUNES.APP introductory splash overlay was removed.
- The Game Boy landing copy now leads with “Create or listen”: mood choices automatically compose complete songs one after another, while the next sections distinguish full arrangements from loops and explain the register-level hardware model.
- Radio Browser accepted the public station as UUID `967010ce-34f5-460d-beb4-67a196c49d9b`.

# 2026-08-31 — Root routing and Create sheet

- `/player` is retired. Generated playback remains at `/`, the build no longer emits a player route, and legacy `/player` requests replace themselves with `/` before boot.
- The playing credit again shows GitHub, X, and Hacker News as icon-only links.
- Create is a 93-dvh bottom sheet over the still-visible game. It hides the unrelated station dock, owns its transport, uses a real share icon, and closes through a labelled “Back to game” control.
- Route, editor geometry, editor/audio handoff, social-credit, and station-dock behavior are held by the browser verification suite.

# 2026-08-31 — Remotion portfolio preview

- `promo-video/` is the reproducible 12-second, 1280×720 Remotion composition used by the chiptunes.app card on ramine.net.
- `npm run capture` refreshes its landing, playing, and Create reference frames from the current local build. `npm run render` and `npm run poster` produce the portfolio MP4 and WebP in the ignored `promo-video/out/` directory.
- The cut leads with automatic creation/listening, shows continuous generated playback, opens the tall Create tracker sheet, and closes on real four-channel sound plus cartridge export.

# 2026-08-31 — GitHub Star control

- The site credit keeps PartyParty's useful `GitHub · Star · count` structure, pointed at the public `tetrisgm/chiptunes` repository, but uses the same cream moulded Game Boy material as the Twitter and Hacker News controls. It starts with the last verified public count and refreshes from GitHub's public repository API.

# 2026-09-01 — Launch-readiness pass

- The public story is now “create or listen to complete Game Boy songs,” with
  automatic composition, editable song documents, register-level chip
  emulation, cartridge export, self-playing visualizers, and listen-anywhere
  radio described consistently across the site, README, metadata, and GitHub.
- The landing page and README clarify that Game Boy is a Nintendo trademark
  and that Chiptunes.app is an independent project, not affiliated with or
  endorsed by Nintendo.
- A final 390 px layout owns the phone landing and playing surfaces. The title,
  product story, mood controls, share, transport, volume, and fullscreen remain
  visible without horizontal overflow; `verify-chrome` holds those facts.
- Static crawler/install assets now include `robots.txt`, `sitemap.xml`,
  `manifest.webmanifest`, `favicon.ico`, and the existing square station icon.
- `docs/launch/` contains the HN and Product Hunt copy, launch checklist, and
  three 1270×760 gallery frames. The 12-second Remotion demo remains the current
  video asset; uploading or submitting it is a separate public launch action.
- The public GitHub repository description, homepage, and discovery topics now
  match the product.

# 2026-09-01 — Listen-anywhere Safari playback

- `/radio/` now explicitly loads and awaits the live audio stream when “Play
  here” is pressed, exposes a connecting state, and shows a usable retry/error
  state instead of discarding Safari's rejected playback promise.
- Production commit `2ca0b6d` was deployed site-only and verified in real
  Safari: both the page button and native audio control changed from Play to
  Pause while `https://radio.chiptunes.app` played.

# 2026-09-01 — The phone playing screen

Reported from a real iPhone on the production site: the question ran into its
first answer, the song strip and the NEXT button were missing, there was a hole
after full screen, and the product name and source links had gone.

- **THE ASK IS TWO LINES ON A PHONE.** "Write me a song that is…" and the moods
  are one running sentence on a wide window and wrap as one, which is right
  there. In a 390px column the label alone is ~214px, so exactly one mood fit
  beside it and the rest fell to a second row — a phrase broken after its first
  answer, which reads as an accident. The label takes the full width and every
  mood sits together underneath it.

- **THE BAR IS TWO ROWS.** One row could not hold it, and both symptoms were the
  same width problem:
  * the song strip was a 7px absolutely-positioned sliver along the bar's bottom
    edge that measured **24px wide with a zero-width canvas** — the notes, which
    are the whole point of the strip, were not drawn at all;
  * the transport wanted 112px in a 105px column, so **NEXT was laid out
    underneath the volume dial**.
  Row 1 is now the song end to end with its own Edit key; row 2 is the title,
  the transport, and volume/full-screen. `display:contents` on `.pb-center`
  promotes its two children to grid items so they can take different rows
  without touching the desktop markup.

- **THE EDIT KEY IS A KEY, NOT A HOVER HINT.** `.pb-expand` was a
  `pointer-events:none` span at opacity 0 that the scrub row revealed on hover.
  A phone has no hover, so the only way into the editor from the playing screen
  was invisible there. It is a real `<button id="pbExpand">` sharing the
  ribbon's handler, standing and labelled on the phone layout and still a
  reveal-on-hover chevron on a pointer.

- **NO HOLE AFTER FULL SCREEN.** `.pb-right` was pinned to `width:77px` and then
  pulled `translateX(-12px)` off the right edge, which left a gap the width of a
  button — and that fixed width is what hid NEXT. It sizes to what it holds and
  ends where the bar ends. `VOL` (a `::before` on the dial, 48px next to a
  speaker icon that already says it) comes off the phone and the track name
  takes the width.

- **THE CREDIT STAYS ON A PHONE.** It was `display:none` here, which also
  removed the only place the playing screen says what this is and where the
  source is — name, GitHub star, X and Hacker News exist nowhere else once a
  song is on. Compact: name at reading size, links as icons, tagline and legal
  line still off (those are the landing page's job). The rail drops to `top:54px`.

- **`justify-self:start` SIZES A GRID ITEM TO ITS MAX-CONTENT.** Found doing the
  above and worth remembering: `.pb-left` carried it, so the title lane grew with
  the track name instead of staying in its `minmax(0,1fr)` column — a long name
  carried the share button 300px along, under the transport and outside
  `.pb-left`'s own `overflow:hidden`, so **Share simply vanished on some
  tracks**. `justify-self:stretch` plus `overflow:hidden` on `.pb-info` and
  `.pb-titleline` (the desktop bar sets those `visible`, harmless in a 420px
  lane) makes the name ellipsise instead. The gate forces a long title inside
  the same evaluate that measures, because the bar's ticker rewrites the title
  and the check was otherwise passing or failing by luck of the draw.

- `verify-chrome` holds all of it: NEXT clear of the volume, full screen against
  the right edge, the strip on its own row with the notes actually drawn in it,
  the standing Edit key, the credit above the rail, and the ask's two lines.

- **`verify-export-boundaries` IS INTERMITTENTLY FLAKY**, like
  `verify-create-handover`. It edits whatever song Create happens to compose
  until the score carries automation, a vibrato hand-off, a wave reload and a
  kit hit; seen failing once with `auto:0, vibOff:0` on a 572-note song and
  passing on the next four runs of the same build. Re-run before believing it.

- **Deployed site-only on 2026-09-01** (owner asked after seeing the old layout
  still on the phone). `npm run deploy:site`; production went from
  `app.28e8709b4775.js` to `app.b432657d7129.js` and the edge cache was purged.
  The deployed build was re-probed at 390px, not just checked by hash: strip
  370px on its own row with the notes drawn (286x26), the Edit key standing
  beside them, NEXT clear of the volume, full screen against the right edge, the
  credit at the top, and the ask on two lines. Still owed: the same look on the
  owner's real iPhone Safari — headless Chromium is not that, and this repo has
  been fooled by that difference before.

# 2026-09-02 — The face never re-rolled after a mood

Reported from a phone as "it seems to stick to one render mode and never change
after — eg it plays in game boy for every song".

- **A NEW TRACK IS A NEW DECK, NOT A NEW SLUG.** `_setGeneratedNowPlaying`
  decided a track had changed with `slug !== _curSlug`. A DOCUMENT HAS NO TOKEN
  — `playDoc` calls `startCompiled({tok:'', ...})` — and **picking a mood
  composes a document**, so that test was false for every mood the visitor
  tapped, and the two things gated on it never ran: `_rollScreenMode()` and
  `_pickNesScheme()`. Someone driving the station by tapping moods therefore sat
  on whichever face the boot toss happened to pick, for the entire session.
  `publishTrackReady` now carries the deck's `generation` as a second argument
  (it is a fresh number per started deck whether or not there is a token) and
  `changed` reads that first.

- **WHAT WAS NOT WRONG, all measured, so nobody re-litigates it:** there is no
  persisted screen preference to latch on (the boot IIFE *deletes* `rrrScreen`,
  and nothing writes it); `_rollScreenMode` and `_tossScreen` are correct; and
  the natural end-of-song hand-off ALWAYS re-rolled — watched over six minutes
  of real playback it went nes -> dmg -> crt at 92s and 172s. Skipping with Next
  worked too. Only the document path was broken, which is why this looked like
  "it never changes" to someone tapping moods and like "works fine" from a test
  that skips tracks.

- `npm run test:screens` now covers it, and it is the gap that let this ship:
  every other check in that file drives `__rrrScreenMode()` with a PINNED face,
  so nothing watched the coin toss and nothing advanced a track. The new block
  stubs `Math.random` so the toss is deterministic, taps three moods and asserts
  the face follows — verified to FAIL on the old code (`nes -> nes -> nes`).

# 2026-09-02 — Phone landing and the Create close control

- **THE GAME BOY IS CENTRED ON A PHONE, VIA AUTO MARGINS.** It was pinned 8px
  from the top with all its free space below (136px at 844 tall, 224px at 932).
  `align-items:center` is the wrong tool: the container is a scroller, and
  centring a flex item TALLER than its line splits the overflow both ways and
  puts the top out of reach — which is what the `flex-start` was there to avoid.
  Auto margins resolve to ZERO when free space is negative, so the case centres
  when it fits and top-aligns when it does not. Measured: 67/77 at 844, 111/121
  at 932, and still top-aligned and scrollable at 620.

- **CLOSE IS AN X IN THE TOP-RIGHT CORNER.** "Back to game" was a worded pill at
  the end of the utility row; on a phone that row wraps, so the one control that
  LEAVES took a second line and read as one more export action beside Download
  WAV and Download ROM. It is absolutely positioned in the sheet's corner, 40px,
  icon-only with an aria-label, and `.n-utils` reserves 58px of right padding so
  the row cannot slide a button under it. The size properties carry `!important`
  because `.n-utils .cr-btn` (a 30px pill) is one class more specific and the
  button still lives in that row.
  `verify-create-handover` asserted `closeText === 'Back to game'`, which would
  have kept passing on the hidden span; it now asserts the corner geometry, the
  icon-only rendering, the accessible label and the reserved room.

# 2026-09-02 — Four reports from the phone

## The white screen (Modern only, intermittent)

- **`.crt.gain` IS AN OPAQUE, ALMOST ENTIRELY WHITE, FULL-VIEWPORT CANVAS whose
  only reason for being invisible is `mix-blend-mode:multiply`.** Read the two
  CRT paths side by side: the legacy divs are BLACK based (`.scanlines` is
  rgba(0,0,0,.62) stripes at opacity .3, `.vignette` a black radial with no
  blend mode at all), so a dropped blend darkens them very slightly. The gain
  canvas is the opposite, and it is z-index 5 over the whole window. It is the
  one element on this page that can turn the screen white, and Modern is the
  only face that shows it — which is the report, exactly.
- **WebKit now gets the legacy divs and no gain canvas is built there at all.**
  The gain layer exists as a PERFORMANCE optimisation for the GPU-less Linux
  broadcast box (a backdrop copy and two full-screen blends per frame, ~1.34ms).
  An iPhone has a GPU. Trading that, on the one engine this project cannot
  profile or reproduce, against "the screen can go white" is not a close call.
  Chromium keeps the baked map. `window.__rrrCrtDiag()` reports which path is
  live, because this was invisible from outside.
- **The build also measures its own output now.** `cssLayerImg` rasterises HTML
  inside an SVG `foreignObject` through an `<img>`; where an engine declines to
  render that, `onload` still fires with a BLANK image — no error, no `catch`.
  Two blank layers bake to 255,255,255 everywhere. A map with no pixel below 250
  in it is refused and the legacy divs stay on.
- ✅ **CONFIRMED FIXED ON THE OWNER'S IPHONE (2026-09-02)** — "no more white
  screen" after the deploy of `app.13ad90d728d1.js`. That is the only evidence
  that counts here and it is now in hand.
- ⚠️ **It was never reproduced HERE, so do not read a green local run as
  covering this.** Playwright's WebKit rasterises the layers fine
  (`blank:false`) and shows none of the symptom, and `scripts/crt-diff.mjs` has
  only ever run Chromium. The change was reasoned from the two paths' failure
  modes and then confirmed on the device. If white screens ever return,
  `__rrrCrtDiag()` is the first thing to read, and the next suspect is
  `#track-transition` (a 72%-white sheet at `mix-blend-mode:screen`,
  `steps(6,end)` so its last step holds opacity .58, cleared only by a 310ms
  timeout — if that timer is throttled it stays up).
- **The general lesson, which is bigger than the CRT:** an overlay that is
  invisible only because of a blend mode is a bet on the compositor. Make the
  layer's FAILURE mode safe — black-based layers degrade to "slightly darker",
  white-based ones degrade to "the product is gone". If you add a full-viewport
  overlay here, check what it looks like with its blend mode removed.
- A build-in-flight guard (one build per key) was tried here to stop
  `_applyScreenMode`'s two `apply()` calls doing the work twice. **It broke
  crt-diff — 100% of pixels differing at DPR 2** — because the two calls do not
  always ask for the same key and suppressing the second left the overlay built
  for the wrong one. Reverted; the doubled build is wasteful and harmless.
- crt-diff's BLANK FRAME flakiness is PRE-EXISTING, measured either side of this
  change: baseline 0/2/2 blank cases over three runs, after 2/2/4. Every case
  that actually painted diffs at 0 LSB on both.

## The credit was never on a phone at all

- `_buildPlayerLinks()` bailed out on `_homeIsMobile()` before building EITHER
  the rail or the credit, on the theory that a hamburger menu carried them —
  the hamburger has been gone since 2026-08. So on a real phone the playing
  screen had no product name, no GitHub, no X, no Hacker News, and the CSS
  written last session to show the credit there was styling an element that did
  not exist.
- **`_homeIsMobile()` tests the USER AGENT and touch support, never the width**,
  which is why a 390px desktop Playwright page built the credit exactly as a
  wide one did and every headless check reported it present. `verify-chrome`'s
  phone section now runs in a real `devices['iPhone 13']` context. Anything
  claiming to test "the phone" must, or it is testing a narrow window.
- The credit is built on every device now; the RAIL stays desktop-only (four
  full-width action pills would take the top half of a phone), and the gate
  asserts both halves of that.

## Create: the ask first, one row of actions, no gap above

- The mood row is the FIRST line — writing a song is what the screen is for;
  Undo/Redo and the three exports are what you do to one afterwards.
- `.n-utils` is one nowrap row that scrolls, like the mood row above it. NOTE:
  it uses `justify-content:flex-start` with `margin-left:auto` on the first
  pill, NOT `flex-end` — end-alignment in a scroller pushes the overflow off the
  START edge where it cannot be scrolled back to, and the row opened on Download
  ROM with Undo and Redo lost off the left. Same trap as the landing hero.
- The sheet is 100dvh on a phone. The 7dvh strip of game above it was the "this
  is a sheet" affordance and the only visible way out; the corner X says both,
  and a tracker wants every pixel of height. Desktop keeps the 93dvh sheet.
- The close X is centred on the first row (`--cr-row1`), and the ask reserves
  `--cr-closew` on its right so a chip cannot come to rest under it.

# 2026-09-02 — The watch-only hint is desktop-only

- `watchOnlyToast()` ("the games are the visualiser... nothing to control: sit
  back and listen") answers **"why can't I steer the character?"**, which is a
  question an ARROW KEY asks. A phone has no arrow keys, so the only thing that
  ever fired it there was a tap on the picture — and on a phone that tap is the
  gesture that wakes the idle chrome. The one action whose entire purpose is to
  reveal the transport, the credit and the moods was covering them with a big
  panel of text. Reported from the owner's iPhone.
- It returns early on `_homeIsMobile()` now. Held both ways by `verify-chrome`:
  a synthesised touch pointerdown on `#stage` in the iPhone context must NOT
  raise `#rtoast`, and an ArrowLeft on the desktop page still must. Verified to
  FAIL on the old code.

# 2026-09-02 — How it works, reachable and about the engineering

- **IT HAD TWO BEHAVIOURS AND NO WAY IN.** `_toggleHowModal()` swapped the
  landing hero's LCD for a four-paragraph "how-page" when `#rmoods .rmood-brand`
  existed, and opened `#howmodal` otherwise — so the same control did different
  things depending on where you pressed it. And it could not be pressed: the
  button lived in `.plhead`, which is `display:none` on the landing, inside
  `#plinks`, which is never built on a phone. The explanation existed and nobody
  could open it. One control, one modal, both states, every device.
- The button is a SELECT-key pill in the ask row (`.rmood-how`), beside Start
  from scratch. That row is the only chrome on screen in both states on every
  device; the rail is desktop-only. The rail's copy and the `.how-page` branch
  and CSS are gone.
- The modal now carries the engineering: registers `$FF10`–`$FF3F`, the
  browser/cartridge same-values-same-frames-same-order check, the
  timer-interrupt PCM with its numbers, the deterministic single-pass composer,
  the song document in the URL fragment, the shader screens, one build, 20
  gates. Same story as the README.
- Its card keeps the green Game Boy cartridge-page look and the pixel heading,
  but the BODY COPY is now the UI face. The pixel font was chosen when this was
  three short lines; a screenful of technical prose in a bitmap face is a wall.

- ⚠️ **REMOVING A RULE FROM A MULTI-SELECTOR LEFT A DANGLING SELECTOR, and it
  silently applied the NEXT rule's declarations.** Deleting
  `body.ai-visual.controls-active #plinks .plhead .plhow{ pointer-events:auto; }`
  left the line above it —
  `body.ai-visual.controls-active #plinks .plrow,` — ending in a comma, so the
  selector list ran on into `#navmenu{ display:none; ... }` and **the entire
  action rail became display:none on the playing screen**. Caught only because
  `verify-chrome`'s rail-gap assertion went to 0. When deleting a selector,
  check whether it was carrying the braces for the ones above it.
  (That assertion also had to be repaired: it measured the first two `.plink`s,
  which worked only because the How-it-works button happened to be first. It
  measures `.plrow` gaps now, which is what "breathing room" means.)

# 2026-09-02 — The agent surfaces

Four faces of one API, so a program (or a model) can make songs without a
browser, and drive the running page when there is one.

- **THE WHOLE PIPELINE ALREADY RAN HEADLESS**, which is why this is exposure
  rather than new machinery: `create.js`, `composer.js`, `seed.js`, `gb-rom.js`
  and `gb-apu.js` all `require()` in plain Node. Compose → document → cartridge
  → rendered audio works with no DOM. What was missing was a CONTRACT.
- **`src/api.js`** — the versioned facade: `capabilities`, `compose`, `load`,
  `toJSON`, `fromJSON`, `validate`, `describe`, `buildCartridge`, `renderWav`,
  `shareUrl`. Documents in, documents out; the editor's underscore-private
  internals stay private.
- **`bin/chiptunes.js`** — the CLI over the same facade (`npx chiptunes`).
- **`mcp/server.js`** — MCP over stdio, hand-rolled JSON-RPC rather than an SDK
  dependency (this repo has one runtime dependency and the protocol needed is
  three methods). Two ergonomics decisions that matter: songs are held by SHORT
  ID because a document is ~10k characters and returning one per call burns the
  caller's context, and `song_to_json` is PAGED BY BAR so an agent can work a
  section at a time.
- **`src/webmcp.js`** — `window.chiptunes` plus `navigator.modelContext`
  registration when the browser has it. This drives the live SESSION (now
  playing, transport, moods, editor, screen), which is a different job from
  making tracks.
- **`create.js` gained three agent hooks only**: `docState`, `docFromState`,
  `tables`. Everything readable is built on those in `api.js`.

- ⚠️ **`Audio` IS A LEXICAL const IN THE BUNDLE, NOT A WINDOW PROPERTY**, and
  `webmcp.js` walked straight into it: `G.Audio` resolves to the browser's
  native `HTMLAudioElement` constructor, which has no `currentDoc` and no
  `playDoc`, so it returned nothing instead of throwing. The page reported "no
  song" while a song was playing. Use the bare name behind a `typeof` guard.
  This is the trap already recorded further up this file; it caught me anyway.
- A hand-authored song round-trips JSON → document → JSON **losslessly**, and
  re-encoding the read-back gives the identical document. Composed songs lose a
  few notes to the projection rules, which is expected and documented.
- `npm run test:api` holds all of it: the surface, determinism, the round trip,
  the error text (which IS the interface an agent iterates on), a cartridge with
  a real boot logo and header checksum, an audible WAV, the MCP protocol over a
  real stdio process, and the in-page tools with a stubbed `modelContext`.

- **`verify-entry` has a low-rate timing flake**: `pressing play starts one
  anyway` clicks play, waits 3.5s and samples the audio peak. Seen failing once
  in nine runs, and nothing in this change touches playback. Re-run before
  believing it, like `verify-create-handover` and `verify-export-boundaries`.

- **`docs/AGENT_PLAN.md` is the plan for the next layer.** It replaced
  `AGENT_VOCABULARY.md`, which planned a DAW — "make it happier", "repeat the
  melody" — and that is what somebody ALREADY HOLDING A TRACK says, not what
  people ask a music generator for. The rework leads with briefs, guaranteed
  constraints, cohesive SETS and deliverables, and demotes the editing verbs to
  the last tier. The old vocabulary tables are good and survive in git history.
- **STEMS ARE FREE AND EXACT HERE, and that is the strongest unbuilt feature.**
  `Sequencer` already carries a per-channel `chMute`, so rendering each voice
  alone is four renders and no new engine work. Measured on one composed song:
  Melody peak 0.500, Harmony 0.250, Bass 0.250, Drums 0.251, each with real
  energy. Elsewhere stem separation is an ML approximation and usually paid.
  Songs also already carry `loopFrames`, so seamless-loop metadata is plumbing.
- The other structural advantages worth building the API around: the output is
  SYMBOLIC (transpose, retempo and restructure are exact), composition is ~5ms
  and free (breadth costs nothing), it is deterministic (a token reproduces a
  song byte for byte), and its provenance is a readable algorithm rather than a
  model trained on other people's recordings — which is the decisive point for
  a game developer worried about shipping AI music.
- ⚠️ **Open contract question**: `AGENTS.md` keeps best-of-N out of production
  composition. An API consumer generating many candidates and choosing is close
  to that line. Needs an owner ruling before `generate_many` is built; nothing
  else in the plan depends on it.

# 2026-09-02 — Instant, free and local, with the numbers

Measured on this Mac rather than asserted, and now stated in the README, the
How-it-works modal, the Show HN copy and the agent plan:

| | |
| --- | --- |
| `composer.compile` | 0.61 ms |
| score to document | 1.51 ms |
| a complete `compose()` | **1.6 ms** |
| document back to a song | 0.77 ms |
| build a 32 KB cartridge | 1.19 ms |
| render audio | 103 ms for 40.7 s, **395x real time** |
| **a thousand complete songs** | **471 ms** |

Why it is worth leading with rather than burying: against a hosted music model
this is the difference in kind, not degree. No queue, no account, no key,
nothing metered, and nothing uploaded to make music. Generating a hundred
candidates and keeping one becomes a reasonable thing to do, and an agent needs
no credentials and cannot run up a bill.

**Keep the claim precise.** The honest sentence is that COMPOSITION and SHARING
are local: songs are written in the browser and a shared link carries the whole
arrangement in the URL fragment, which browsers never send anywhere. The radio
stream is a server, and the site itself is hosted. Every place this is written
says so in the same breath; do not let it drift into "there are no servers".

# 2026-09-02 — The agent layer people actually asked for

Built on the four surfaces: scenes, briefs, constraints, sets, variants, stems.

- **`brief({scene, seconds, exclude, ...})`** — 11 scenes (`title`, `menu`,
  `overworld`, `town`, `shop`, `cave`, `battle`, `boss`, `victory`,
  `game_over`, `credits`), each a bundle of premise plus constraints, so the
  word behaves the same way every time. It reports what it could NOT meet in
  `unmet` rather than pretending.
- **`soundtrack({scenes, key})`** — several cues pulled into one key. Five cues
  in 58 ms. This is the thing an audio model cannot do, because you cannot
  transplant a key between two waveforms.
- **`variant(doc, {mood})`** — eight published recipes (`sadder`, `intense`,
  `calmer`...) over exact primitives, so a word means one thing twice. Returns a
  NEW document; the original is untouched, which is free undo.
- **`transform(doc, ops)`** — tempo, transpose, register, mode, velocity, thin,
  drop, trim, repeat, swing, motion, shape, fade. All mechanical. Deliberately
  no `thicken`: adding notes is composing, not transforming.
  `mode` moves the third, sixth and seventh relative to the song's key, which is
  what makes "make it sad" actually work rather than just slowing it down.
- **`renderStems(doc)`** — four WAVs with a `smpl` loop chunk. Not separation:
  the other channels are muted per render, so the stems sum to the mix.
- **`guide()`** — the answers an agent would otherwise invent, licensing above
  all. It says plainly that it is not legal advice and points at the LICENSE.

- ⚠️⚠️ **THE BUNDLE IS CONCATENATED CLASSIC SCRIPTS, SO A TOP-LEVEL `var` IN ANY
  SOURCE FILE IS A GLOBAL.** `api.js` was written as a Node module and shipped
  into the page unwrapped: 47 top-level names including `Song`, `compose`,
  `load`, `describe` and `validate`. It overwrote seed.js's `Song` and **killed
  the audio chip** — `chipDiag()` reported `chip:false, chipGain:0` with the
  context running. It passed standalone eight times and failed the FULL SUITE
  three times running, which is what finally isolated it: baseline suite green,
  mine red. Both agent files are IIFEs now, and `verify-api` asserts the page
  leaks none of those names and that `Song` is still seed.js. Every file in
  `build.js`'s list must be wrapped.
- **`verify-entry`'s audio assertions were a fixed-window race** and are now
  `audibleWithin(20s)`: they return as soon as sound appears. The old form
  failed about one run in nine. Absence still samples a full window.

# 2026-09-02 — Say what you want, and the bug that hid behind a flaky test

## The field

There is now a text field under the mood chips, in both states, on every device.
It is **not decoration**: `CT_API.interpret()` is a deterministic parser (there is
no model in the page) and `CT_API.ask()` carries the reading out.

- It handles scenes, lengths, keys, modes, tempo words, register, lanes to leave
  out, repeat, swing and the eight mood recipes, and it distinguishes a NEW piece
  ("a boss theme, 30 seconds, no drums") from a CHANGE to what is playing
  ("make it much slower").
- **It always says what it did**, names anything it ignored, and refuses out
  loud when it understood nothing rather than composing something at random.
  That last rule is the whole difference between this and a decorative box.
- `verify-api` pins the phrase → reading table, `ask()` end to end, and the field
  in the page including that nonsense changes nothing.

## ⚠️ `.rmood` IS A LOOK, NOT A MEANING — and this cost most of a session

`_transportToggle` starts a song when the station is holding by picking a random
element from `#rmoods .rmood:not(.rmood-scratch)` and clicking it. That was
correct when the only pills in that row were moods and Start from scratch. Today
the row also gained **How it works** and **Make it**, both of which wear
`.rmood` for the pill styling and both of which correctly do nothing when
clicked with no input.

So pressing play had a **one-in-three chance of clicking a control that starts
nothing**, and the station simply never began.

It surfaced as `verify-entry` failing intermittently, and **I misdiagnosed it
twice**: first as an audio timing race (and "fixed" it by making the assertion
wait 20s, which was a real improvement but not the cause), then as a bundle
global leak (which WAS a real, separate bug — see the IIFE note above). The rate
tracked the number of non-mood pills: clean before How it works, ~1 in 5 after
it, ~1 in 3 once Make it landed.

**The fix is a marker, not a blocklist.** Real moods carry `data-mood`, and
anything meaning "pick a mood" selects on that. `verify-entry` now asserts that
every pickable control is a real mood AND that the row does contain non-mood
pills, so the assertion cannot quietly become vacuous. `verify-chrome`'s two
mood-line checks use the same marker; they had been maintaining their own
blocklist, which is the same mistake one layer up.

If you add another pill to that row, it needs no thought — just do not give it
`data-mood`.

# 2026-09-02 — MIDI, and the best-of-N question answered

- **`toMidi(doc)`** — Standard MIDI format 1: a tempo track plus one track per
  hardware voice, so the file carries the stems too, with drums on channel 10
  using General MIDI numbers. `file(1)` recognises it. This export exists only
  because the music is symbolic; an audio model has nothing to hand you here.
  The gate walks every chunk and requires the lengths to land exactly on the end
  of the file, rather than trusting the header.
- **`variations(spec, n)` resolves the contract question without a ruling.**
  `AGENTS.md` forbids the product *scoring* candidates — "fix bad output in the
  composer rather than hiding it behind candidate scoring". Composing n songs
  from n tokens and returning **all** of them, unranked, scores nothing; it is
  pressing "next" n times, and the choosing has always been the caller's. There
  is deliberately no `best` argument and `verify-api` asserts there is not one.
  Automatic selection is the thing that would need an owner ruling.
- `docs/AGENT_PLAN.md` now marks the build order done or not, and states plainly
  what is still open: a shared MOTIF across a soundtrack (shared key, mode and
  tempo are done; the palette and motif are not), `resolve:true` actually
  forcing a tonic ending, intensity layers beyond the four stems, and increasing
  density — `thin` has no opposite on purpose, because adding notes is composing
  and belongs in the composer rather than in a transform.

# 2026-09-02 — Variety is now a gate, and the DMG is not negotiable

## `scripts/verify-diversity.js` — the build fails if the music gets samey

Every cohesion device is a way to make a generator boring: shared keys, scene
presets, mood recipes, shared motifs. Each is individually reasonable and the
cumulative effect is that everything sounds alike. That is the failure the owner
cares about most, so it is **measured on every run** rather than argued about.

Measured today, with the ceilings the gate enforces in brackets:

| | distinct openings | pitch-class similarity |
| --- | --- | --- |
| free composition | 30/30 | 0.33 (ceiling 0.55) |
| brief: boss | 30/30 | 0.25 (0.6) |
| brief: cave | 30/30 | 0.40 (0.6) |
| ten different games' title themes | 10/10 | 0.29 (0.65) |
| thirty songs made "sadder" | 30/30 | 0.33 (0.7) |

Thresholds are floors with headroom, not today's numbers rounded down — a gate
set to the current measurement fails on noise and gets deleted.

**The signature was wrong twice, in opposite directions, and both are instructive.**
Flattening every lane into one sequence is fine for identity but useless for
INTERVALS, because it interleaves a bass line into the melody and produces
intervals that are an artefact of the reader (`-29,24,3,-27,29`). Filtering to
Melody only looks more precise and is worse: plenty of cues have no melody in
their opening bars, so every one of those produced an EMPTY signature and
collided with all the others. It is lane-TAGGED now, over sixteen notes.

## The shared motif is opt-in, and varied rather than copied

Reversed from the previous entry after the owner's objection, which was right.
Shared KEY already makes cues belong together and costs no variety; a recurring
figure is a stronger, riskier claim, so `motif: true` is required. When it is on,
each cue gets the figure at a different transposition (the octave, the fifth, the
fourth below), so the cues are related the way a leitmotif is related. The gate
compares INTERVAL SHAPE, not pitches, because that is what survives
transposition and what a listener recognises. Two different soundtracks never
share anything.

If the first cue has no melodic phrase at all — a drone, a percussion-led piece —
it says so in `motifSkipped` rather than sharing silence.

## ⚠️ THE FOUR CHANNELS ARE NOT INTERCHANGEABLE

`double` (octave doubling, the density-up operation) exposed two hardware facts
in one afternoon:

1. **One voice per channel.** An octave copy left on its own lane sounds at the
   same instant as the note it came from, and the voice allocator correctly drops
   one, so the operation silently did nothing. A double has to land on a
   DIFFERENT lane that is free at that moment, and says so when none is.
2. **An instrument record belongs to one channel.** Copying a cell wholesale
   carried its `inst` across, putting a wave table on a pulse channel — exactly
   the fault recorded further up this file as guarded. Moving a note between
   lanes now drops `inst`, `dy`, `fd`, `wv`, `nz`, `ns`, and the channel-1 sweep
   flags, and lets the stamp speak.

`verify-api` now asserts, over composed, doubled AND transformed songs, that
**every note is on a channel its instrument belongs to**. That invariant is
cheap and it is the one that keeps this a Game Boy rather than a synthesiser
with four arbitrary voices.

## Eight intensity layers, which is why density had to exist

Lane presence alone gives four steps, too coarse to fade an action scene up.
Density is the second axis: each voice arrives thinned before it arrives whole,
and the bass doubles at the top. `ambient · pulse · groove · drive · colour ·
rise · lead · full`. A layer that adds nothing to the one below **says so** —
plenty of songs have no Harmony, and returning two identical layers as an
intensity step is a quiet lie.

## MIDI is in the product

Create has a Download MIDI button beside WAV and ROM. `toMidi` returns a Node
Buffer where there is one and a `Uint8Array` in the browser, same bytes.

# 2026-09-02 — "like zelda" is refused out loud

The owner typed **"dungeon song like zelda"** and got back
*"Made it: scene: cave (ignored: zelda)"*. The parser had matched one word —
`dungeon` → the cave scene — and thrown the rest away, and the quiet bracketed
apology read as though the reference had been taken into account.

- **A reference is now detected and refused explicitly.** `interpret()` returns
  `reference` for "like X", "in the style of X", "similar to X", "sounds like
  X", and the field says: *"I cannot do 'like zelda'. I match words, not
  references: there is no model reading this, and I will not pretend to imitate
  something I was not built from."* It still composes the part it did
  understand, and says which part that was.
- **Adding game names to the vocabulary is NOT the fix, and must not be done.**
  It would be a false claim — nothing here is trained on or derived from that
  music — and `AGENTS.md` forbids naming anything in this product after a real
  game or company. `seed.js` already carries a `BLOCKED` list so generated
  TITLES cannot land on real cartridge names; a trademark in the *prompt
  vocabulary* is the same hazard one step earlier. `verify-api` asserts no real
  game or company appears in the scenes or mood words.
- **The vocabulary is much wider instead**, with honest descriptors that map to
  real dials: heroic, mysterious, menacing, frantic, playful, solemn, tense,
  plus wistful/nostalgic/grim/hopeful/serene/driving and friends. Each compound
  is a published recipe of primitives, so a word means one thing twice. Bare
  "slow" and "fast" work now; only "slower"/"faster" did.
- Anything not understood is stated in the sentence rather than in brackets,
  and points at How it works for the words that do exist.

**⚠️ `verify-sync` is load-sensitive and will fail on a busy machine.** It failed
three assertions during this pass at load average 51 (from my own back-to-back
Playwright runs) and passed 2/2 standalone immediately after. The rule already
recorded further up this file applies to the test suite as well as to
performance work: run `uptime` first, and a load average over ~10 means the
measurement is not about the code.

# 2026-09-02 — The vocabulary, widened without franchise names

The owner asked for franchise names in the prompt vocabulary ("in the style of
this game or that game"), on the grounds that no code or IP is being lifted.
Two separate objections, and only one of them is legal:

1. **It would not be true.** There is no model here and nothing is derived from
   anyone else's music, so a mapping from a franchise name to musical dials
   would be an invention — my impression of what a series sounds like, wearing
   a trademark as a label. The product's whole pitch, in the README and the Show
   HN post, is that it is honest about what it does; a fake style mapping
   undercuts the one thing that differentiates it.
2. **It reverses a documented decision.** `AGENTS.md`: "Never name a pack,
   entity, sprite, palette or display string after a real game, character or
   company... Renamed wholesale 2026-08-12 for exactly this reason." `seed.js`
   carries `BLOCKED` so generated TITLES cannot land on real ones, held by
   `verify-chrome`. A trademark in the prompt vocabulary is the same hazard one
   step earlier. That contract is the owner's to change, not an agent's.

**What was built instead**, which gets most of what somebody means by naming a
game, and is true:

- **Game genres** (15): platformer, shmup, racing, puzzle, rpg, adventure,
  horror, roguelike, fighting, stealth, strategy, sports, metroidvania...
- **Musical genres** (28) mapped onto the composer's own fourteen styles, so
  the mapping is a statement of fact rather than a guess.
- **Forms** (6): fanfare, lullaby, dirge, hymn, march, sting.
- **Techniques** (17): arpeggiated, staccato, legato, syncopated, punchy,
  muted, rolled, echoing, doubled, halftime...
- Plus the compound moods added earlier: heroic, mysterious, menacing, frantic,
  playful, solemn, tense.

So *"a platformer overworld theme, arpeggiated, 40 seconds"* lands completely.

**And it now says what it CANNOT do, rather than dropping it silently:** a
different time signature (everything is in four; there is no meter dial),
vocals, or a real instrument. Same treatment as a franchise reference. Held by
`verify-api`, which also asserts the published vocabulary is broad and that a
fully-understood sentence reports nothing ignored.

# 2026-09-02 (later) — Named games ARE in the vocabulary now, read as genres

The owner scoped the `AGENTS.md` naming rule: it was written for the visualizer
PACKS, which are original code that looks like somebody's game, and it does not
govern the music. `AGENTS.md` now says so, and names three separate things that
kept being confused:

1. **A title in a prompt** is a genre description and is allowed.
2. **A generated song title** landing on a real cartridge name is passing off,
   not describing, and stays forbidden — `BLOCKED` in `seed.js`, held by
   `verify-chrome`.
3. **A visualizer pack** named after a real game is the takedown hazard the
   original rule was written for — held by `smoke-games.js`.

## What was built

`src/reference-styles.js`: 115 titles, aliases included, mapping onto genre,
composer styles, major/minor, a tempo band, a mood and one technique. Nothing
else — and `verify-language.js` asserts the entry shape, so a future edit cannot
smuggle in anything that would stop it being a genre reading.

The summary always states the reading, never a resemblance: *"like Castlevania
(platformer), used for: rock/punk, 145-172 bpm, menacing, arpeggiated"*. And it
names only what the title **actually set** — see the precedence below.

## Three things that fought each other, and how they were settled

- **An explicit word beats the reference.** "a platformer like Metroid" is a
  platformer. The title's span is BLANKED before ordinary vocabulary matching,
  because otherwise "Kirby's Adventure" also fires the game genre *adventure*
  and "Metal Gear" fires the genre *metal*, and the summary contradicts itself.
- **A named scene keeps its own mode.** A scene is a functional requirement (a
  game-over cue must not come out jaunty); a title is an atmosphere hint. So a
  dungeon "like Zelda" is minor. Typing "major" still beats both.
- **A title's mood goes in as ops with its tempo and mode stripped**, because
  both were already decided by things that outrank it.

## Two real bugs this uncovered

**Forty-eight of the 115 titles were silently losing their genre.** Ten of the
composer's fourteen styles are `modes:'maj'`, so a premise of `styles:['rock',
'punk']` plus `mode:'minor'` leaves `pickStyle()` an empty pool. `brief()`'s
fallback then deletes `styles` and keeps the mode — discarding the one part of a
reference a listener can actually hear, while the summary went on naming it. Fix:
a title's mode is applied as a `mode` TRANSFORM after composing, exactly as the
mood recipes already do. Twelve more had tempo bands no listed style could
reach; those were corrected, and `_bandIsReachable()` now drops an unreachable
band rather than letting it cost the genre. `composer.styles()` was added
(read-only) so that check has something true to consult.

**`brief()` never honoured `SCENES`' own `resolve: true`.** It had been there
since scenes were added, so `victory` and `game_over` — the two cues that most
need a clean ending — were the two not getting one.

## Parser work, generally

Shared normalisation with the title table (hyphens, apostrophes, `&`, roman
numerals), so "boss-fight" and "castlevania iii" match. `unsupported` is tested
against punctuation-bearing text, which is why the `3/4` check can now fire at
all — the slash had previously been replaced by a space before it ran. Written
numbers ("forty five seconds", "a minute and a half"), flats mapped to sharps,
"just bass and drums", "leave out the harmony", loop and resolve, and five
categories of honest refusal (time signature, vocals, real instruments, modes
beyond major/minor, studio effects).

Every rule that fires now **eats its own words** (`consumed`), instead of a
hand-maintained list of function words growing by one entry every time the
ignored line cried wolf about "leave" or "half" or "brisk".

## Gate

`scripts/verify-language.js`, in `npm test`. It walks all 115 titles for
compose-ability AND genre retention, checks alias/sequel/apostrophe resolution,
the precedence rules above, sixteen ordinary sentences that must be understood
*completely*, the refusals, determinism, and a global-leak guard. Its strongest
assertion is the general one: **everything a summary lists under "used for" is
really in force** — that is what catches the next false claim, whatever shape it
takes.

`verify-diversity`'s "thirty songs made sadder" assertion was demanding 30/30
from a randomly seeded batch. Measured over 60 batches: one collided, worst case
29/30. It was failing ~1.7% of runs for no reason, so it now has a floor of 28
with the measurement recorded next to it.

# 2026-09-02 (third pass) — A title is a CHARACTER, not just a genre

The owner disputed the precedence rule from the pass above, and was right. "A
platformer like Metroid" is not just a platformer: Metroid is gloomy, sparse and
about exploring, and those words have to reach the notes or naming the game did
nothing. The shipped behaviour reported `used for: mysterious` and nothing else
— an explicit genre took the styles, a genre DEFAULT of `mode:'major'` blocked
the title's minor, and the reachability guard discarded the tempo band. Naming
Metroid was very nearly decoration.

**Genre says what a piece is FOR; character says what it FEELS like.** They are
orthogonal, so they now compose instead of competing.

- Each title carries a **character of two to four traits** drawn from the same
  published mood vocabulary a user can type, not one mood. Metroid is
  `mysterious, sparser, calmer, darker`; Mario is `playful, happier, brighter`;
  Castlevania is `menacing, intense`.
- **Character applies whether or not a genre was named.** Only a mood the user
  typed themselves suppresses it, being the more specific request.
- **A genre's default mode no longer blocks a title's.** `platformer` carries
  `mode:'major'` as a default, and treating that as the user's own word is what
  made "like Metroid" come out cheerful. Only a TYPED mode, or a scene's
  functional requirement, outranks a reference now (`modeTyped`).
- **An unreachable tempo band pulls instead of vanishing.** A platformer cannot
  sit at Metroid's 88-118, but it can be dragged 25% towards it, and the summary
  says that is what happened rather than claiming the band.
- **Traits blend, they do not stack.** Three recipes concatenated raw would move
  the melody three octaves and the tempo by half. Additive dials are summed then
  clamped (±1 octave a lane, ±25% tempo, ±0.25 velocity); structural ops (thin,
  subdivide, motion, swing, shape) are taken once each; `mode` is dropped from
  the blend because the title's own major/minor already said it.

## The user's own adjectives got the same treatment

Only the FIRST mood word in a sentence was ever taken, so "gloomy and
exploratory" silently discarded one of them. All of them are taken now (up to
three) and blended the same way. An explicit tempo word suppresses the blend's
own tempo, because "a cheerful fast platformer" was compounding "fast" with
`happier`'s +8% and arriving at 180 bpm, which neither word asked for.

Two vocabulary changes fell out of the owner's own example, "a gloomy song about
exploring a cave":

- `gloomy` did not exist. Added, along with moody, murky, adventurous, daring,
  whimsical, somber, majestic, atmospheric, spacious, wandering, roaming.
- **`exploring` was a SCENE word meaning overworld**, and being the longer
  phrase it beat "cave" in that very sentence. Exploring is a feeling, not a
  place. It is a mood now — `exploratory`, a new recipe: unhurried, thin
  underneath, sustained notes, and an echoing melody. The overworld still has
  four other ways to ask for it.

## Gate

`verify-language` now measures the MUSIC rather than the summary. Same token,
same "a platformer, 30 seconds", one word different: Metroid 112 bpm, Mario 149,
Castlevania 150 at 985 notes, Recca 176. All four differ from the untitled
platformer and from each other, compared on note CONTENT — an earlier version
compared bpm and note count and called Mario "unchanged", because swing, duty
and register move none of those. It also asserts the blend never piles up,
across all 115 titles.

# 2026-09-02 (fourth pass) — The words have to move the notes

The owner's point: "if I say write a happy song, it should write a happy song...
those things need to have an actual effect on the music." He is not asking for a
model — he said so — but for the mapping a human has from a word to the shape of
the MIDI.

He was right that this did not exist. A mood was three settings — mode, tempo,
octave — applied to an already-written song. A happy song and a sad song were
the same tune under different lighting: same contour, same leaps, same
consonance, same cadence.

## Four operations that WRITE rather than set

- **`chordtones`** — a melody note that clashes with the chord sounding under it
  moves to the nearest pitch that does not, at most a whole tone. Exact: the
  harmony is already in the song, so nothing is invented.
- **`arc`** — ramps a phrase up or down in SCALE DEGREES, not semitones, so it
  reshapes the line instead of detuning it. Gated on both counts.
- **`smooth`** — leaps become steps by octave displacement, which preserves the
  pitch class and so leaves the harmony alone. This is what makes a lullaby.
- **`accent`** — metric emphasis: downbeat loudest, half-bar next, offbeats
  quieter. Clamped at 0.05 rather than 0, because velocity 0 is a REST and is
  dropped from the song, so accenting an offbeat must never delete it.

All sixteen mood recipes were rewritten around these. `_blendMoods` emits in a
MUSICAL order (reshape, then fix consonance, then texture, then dynamics)
because snapping to chord tones *before* arcing a phrase just moves the notes
back off the chord, while every individual op still reports success.

## `analyse(doc)`, and the bug it found immediately

`describe()` gives the facts of a song; `analyse()` gives its character:
majorness, phrase arc, consonance, step ratio, mean pitch, density, whether it
ends on the tonic. It exists so a claim like "happier" can be checked instead of
trusted.

It immediately exposed a real musical error. **Consonance was defined as
pitch-class set membership** — a melody note counted as consonant only if its
pitch class was already IN the sounding chord. A third above the bass is
consonant. So is a sixth. The same wrong definition was in the operation AND in
the measurement, so they agreed with each other and both were wrong: a good tune
measured 0.19, `chordtones` shoved half of it onto the root, and where only a
bass note was sounding it could find no legal target and **silently gave up**,
reporting nothing left to snap while the measure still said the music was
dissonant. It is one shared `_isConsonant` now (unison, thirds, fourth, fifth,
sixths), and the op reports what it could not fix rather than returning quietly.

A second measurement bug: `arc` ramps WITHIN each phrase, and `analyse` measured
first-half-vs-second-half of the whole piece, which a per-phrase ramp does not
move. A working operation looked like a no-op. `melody.phraseArc` measures what
the operation controls; `melody.arc` keeps the whole-piece figure.

## The gate

`verify-language` now measures batches. Over 22 songs each, happy vs sad:
majorness 0.94/0.00, tempo 144/120, phrase arc +1.8/−1.6, consonance 0.99/0.64,
mean pitch 84/69. Each gap is asserted.

The strongest assertion is per-song and deliberately excludes **both** majorness
and tempo, since those are one flag and one number set directly by the recipe:
on the WRITING alone, each song is classified correctly **93%** of the time.
Features are standardised before being summed — an earlier version added them
raw at wildly different scales, scored 77%, and that said more about the
arithmetic than about the music. Floor set at 80%.

Each operation is also asserted individually to do what it says, to stay in key,
never to silence a note into a rest, and to remain deterministic.

# 2026-09-02 (fifth pass) — WebMCP, and the bug that would have sunk it

Aimed at the OpenAI WebMCP Challenge (webmcp.devpost.com). **Submissions close
2026-09-03, 13:00 PT.** Judging is four equally weighted criteria: WebMCP
leverage, execution, potential impact, creativity.

## The bug

`src/webmcp.js` registered on **`navigator.modelContext`**. The spec surface is
**`document.modelContext`**. In the ChatGPT desktop app's in-app browser and in
Chrome with `chrome://flags/#enable-webmcp-testing`, not one tool would have
registered — and nothing would have looked wrong. `window.chiptunes` worked, the
page was healthy, and `verify-api.js` passed because its shim had been written
against the same wrong surface. The test and the code agreed with each other and
were both wrong, which is the same failure shape as the consonance bug a pass
earlier.

Registration now tries `document` first, `navigator` second, `registerTool` then
`provideContext`, and **polls for ~10 s** because an agent browser can inject the
API after page scripts run — a one-shot check loses that race silently.

## Six new tools, and why they are the point

The eight that existed only OPERATED the session. The six added compose,
measure and export **in the page**: `capabilities`, `ask`, `compose`,
`variations`, `analyse`, `export`. That is the WebMCP argument in one line: the
composer is already in the bundle, so an agent that can open a tab writes music
with no key, no account and nothing metered — and a song is 1.6 ms, so
`variations` returns twelve complete different songs in ~80 ms. `analyse` closes
the loop: an agent cannot listen, so it measures instead.

`export` does link / midi / rom in the page. WAV is Node-only — `renderWav`
calls `needBuffer`.

## The gate

`scripts/verify-webmcp.js`, in `npm test`. It installs the SPEC shim before any
page script runs, exactly as an agent browser does, then calls all 14 tools for
real against the built bundle. It found a second live bug immediately:
`variations()` returns an envelope `{asked, count, candidates, note}`, not an
array, and the tool called `.map` on it — a failure that would only ever have
appeared at the agent.

## Submission material

`docs/WEBMCP.md` carries the four required description points and the
**prior-work vs new-work** table the rules demand for a pre-existing project.
Note for anyone checking: this repository's first commit is 2026-08-26 because
the public repo was initialised then, but the project is older (AGENTS.md
records decisions from July), so it is submitted as pre-existing and extended,
not as new. Every agent- and WebMCP-related commit is dated 2026-09-02, inside
the window.

**Still owner-only:** the Devpost entry itself and the demo video (under three
minutes, on YouTube, with audio, showing the tools working).

# 2026-09-02 (sixth pass) — /webmcp, a dedicated path for the demo

Owner: the site needs a path geared for the WebMCP demo without hijacking the
product. So `/webmcp` is a route, and `src/webmcp-demo.js` mounts an explainer
panel there.

**It is the REAL app, not a standalone page, and that is not a style choice.** An
agent landing on /webmcp reads the TOP document's `modelContext`. An explainer
page framing the app in an iframe would register its tools inside the frame,
where no agent would ever find them. Building it as a route entry (`ROUTES` in
build.js) means registration happens exactly where it is looked for, and what a
judge tests is the same page everybody else uses. The panel is a passenger:
close it and the station is playing underneath, because it always was.

The panel carries:

- **live status** — "WebMCP is live, 14 tools on document.modelContext" or, in
  an ordinary browser, how to get it (ChatGPT desktop in-app browser, or Chrome
  149+ with `chrome://flags/#enable-webmcp-testing`). It re-checks for 30s,
  because the agent browser injects the API on its own schedule and a panel
  stuck on "not supported" would be lying about a page that had registered.
- **five prompts to copy** for the agent.
- **"Try it right now, agent or not"** — buttons calling the same
  `window.chiptunes` implementation the agent reaches, with the JSON shown and
  the station audibly responding. This matters: most visitors, and possibly a
  judge in a hurry, have no WebMCP browser, and the capability should be
  visible before anybody installs anything.
- **the 14 tools**, read from the live surface rather than duplicated in copy.

A "For agents" pill sits next to "How it works" on the landing page. That is the
whole of the home-page change — a link into a different reading of the product,
not a different product.

`verify-webmcp` covers the route: the panel mounts, the tools still register on
`document.modelContext` there (the point of not using an iframe), every tool is
listed, a tool call from the panel really composes, and closing it lands on `/`.

# 2026-09-03 — WebMCP hardening, against a playbook from another project

The owner passed on a field playbook from TreeTree (github.com/tetrisgm/treetree).
Most of it named things that were live gaps here. What changed:

**Both surfaces, not one.** Registration picked the FIRST of document /
navigator / window and stopped. Now it registers on every surface present,
deduped by object identity. A host exposing one object in two places gets one
registration; two genuinely different objects both get tools.

**Schemas.** `type`, `properties` AND `additionalProperties` are all required —
ChatGPT enforces it, and a malformed inputSchema is the commonest silent
registration failure. Normalised centrally in `describeTool` rather than in
fourteen hand-written literals, and gated.

**`isError: true`** on failing results, so a model can tell a failure from an
answer instead of reading `{"ok":false}` as success.

**Per-tool try/catch**, so one descriptor a host rejects cannot take the other
thirteen with it.

**Pre-hydration registrar — the real gap.** The bundle is `defer`red, so it runs
AFTER the document parses; an agent enumerating tools during parse would find
none. `build.js` now inlines a registrar as the first child of `<body>`,
generated from `src/webmcp.js`'s own descriptors (it exports them under Node) so
the two cannot drift. Its execute stubs poll for the dispatcher for 10s, then
fail politely.

⚠️ **The bug that cost the most time here**: `/(<body[^>]*>)/` matched the text
`<body>` inside a CSS COMMENT in the inline stylesheet, so the registrar was
inserted into the middle of a comment and never ran, while the page looked
perfectly normal. Anchored to start-of-line now, with a guard that the match is
after the last `</style>` — and note the guard must use `found.index`, not
`indexOf(found[0])`, because that string also occurs in the comment.

**Agent calls are narrated.** `surface.callFromAgent` is a separate dispatcher
that runs the tool and shows "🤖 agent: …". The pre-hydration stub forwards
there; the demo panel's own buttons use plain `call`, so the toast says "agent"
only when that is true. Gated both ways.

## Field notes worth keeping

- **ChatGPT's browser gates site tools behind Settings → Browser → Permissions →
  Enable site tools.** Check that before blaming code — it is very likely the
  explanation for the earlier "I haven't been given one" result.
- Any browser can be made a host by hand for testing: assign
  `{registerTool}` to `navigator.modelContext` in the console and the page's
  polling picks it up within half a second.

Not applicable to this codebase, from the same playbook: the Next.js `<head>`
hydration crash, and ref-authoritative state for React (our state is the audio
deck, read synchronously).

# 2026-09-03 (second pass) — orientation, late hosts, agent mode

More from the TreeTree playbook. What was still missing:

**`what_can_i_do_here` — the orientation tool.** WebMCP has no page-to-agent
instruction channel: `provideContext` was removed from the spec, so a page's
only voice is tool names, descriptions and results. This tool is named as the
question a person types, and returns prose meant to be relayed rather than JSON.

⚠️ **It must answer on a COLD LOAD.** It is the tool most likely to be called
first, and "still loading" is a worse greeting than silence. Our pre-hydration
stubs wait for the bundle, so this one is special-cased: the text is a constant
inlined into the registrar by build.js, sourced from `src/webmcp.js`'s own
`INTRO` export. Gated with the bundle deliberately delayed 9 s — it answered in
under 1.5 s with 15 tools registered.

**Late hosts, tested.** New gate case: load with no model context, inject one
afterwards, assert the polling registers within 1.5 s and the tools really work.
That is the closest automatable stand-in for ChatGPT's browser, and the same
window that lets a person paste a mock `{registerTool}` into the console.

**`VERIFY_URL=https://chiptunes.app npm run test:webmcp:live`** runs the whole
gate against production. A gate that only ever sees `dist/` cannot tell you the
page judges open works.

**Agent mode on /webmcp.** With a host present the explainer demotes to a corner
bar; the station is visible and audible behind it. Set once — a host appearing
later must not snatch the panel from a person who asked for it.

⚠️ **Which exposed a real bug**: `/webmcp` is not a route `runtime.js` knows, so
the station never entered its landing state. Nobody noticed while the panel
covered the whole screen; the moment it demoted, the page behind was EMPTY. Fixed
by rewriting to `/#webmcp` at bundle-execution time (before runtime.js runs, and
too late if done at mount): the app gets the root route it understands, the hash
still matches the demo route so a reload comes back, and the address still says
what the page is.

**Error messages teach the next step** — "No song is loaded yet. Compose one
first with chiptunes_ask (\"a boss theme, 30 seconds\")" rather than "nothing is
playing yet".

Still not applicable: the Next.js `<head>` crash, and ref-authoritative state
(no framework; tools read the audio deck synchronously).

# 2026-09-03 — Time is ticks, and LSDj composers can open our songs

Two changes, and the first is what makes the second honest.

## Time

`framesPer16()` returned a float and `colFrame()` rounded the running total, so
a "6.27 frame step" was really some steps of 6 frames and some of 7 in whatever
pattern the rounding produced. Unintentional swing that drifted with tempo.
Measured across 40 songs, **only 7 sat within a tenth of a frame of an integer
step** — our tempi were not reachable on the machine at all.

A step now lasts a whole number of frames and the unevenness is a **groove**: a
short repeating list of tick counts, capped at four steps. That one mechanism
reaches the tempi between the rungs AND carries swing, which is why trackers
work this way.

- **32 playable tempi** at a 16th grid; the composer reaches **27** of them. I
  expected to lose most of the range and lost almost none, because grooves give
  quarter-frame resolution.
- The groove is chosen by **constrained search**, not arithmetic. Rounding put
  70bpm on a 32nd grid at 68.9 — below the storable minimum — where the header
  wrote a negative offset that wrapped through the mask and returned 179.
- Tempo snaps on **write** as well as read, so the round trip is a fixed point.
  Verified across 3 grids x 2 feels x 111 tempi.
- `describe()` reports the groove; `capabilities().tempo` publishes the ladder.

Two gates were asserting properties the hardware does not have. Tempo spread
wanted 40% distinct of 30 on a *continuum*; it now checks a floor of 8 plus a
real spread across the ladder. The per-scene uniqueness check wanted 30/30 from
a random draw, where the measured collision rate over a pool of 2400 boss cues
gives a batch of thirty a **0.8% chance** of one pair.

## The LSDj export

`src/lsdj.js` writes a `.lsdsng` — one song, the unit LSDj musicians pass
around. Reachable from `api.toLsdsng()`, `npx chiptunes lsdsng`, the tracker's
*Download LSDj* button, the MCP `export_lsdsng` tool and `chiptunes_export`
with `format: "lsdsng"`.

It is faithful rather than converted, and only because of the work above: a bar
IS a phrase (16 steps), channels map one-to-one, and the groove goes across
intact. An arpeggio exports as a `C` command because the document carries the
gesture as a flag and only the player expands it — so the phrase is readable
rather than 300 rows of spelled-out notes.

**What does not survive, stated in `warnings` rather than discovered by ear:**
drums move to the noise channel (a `.sav` cannot carry kit samples, which live
in the ROM), and instruments are stock defaults one per channel, on purpose.

### The gate, and why it is shaped like this

`scripts/verify-lsdj.js` reads the output back with **liblsdj itself** and
compares counts. A self round-trip — our compressor feeding our decompressor —
would repeat the WebMCP mistake exactly: code and test agreeing with each other
and both wrong. Build the reader with the two commands in that file's header;
without it the gate runs the structural checks and says loudly that the strong
check was skipped.

⚠️ **One constant it cannot prove.** `NOTE_ZERO_MIDI` maps MIDI 36 to LSDj note
1. liblsdj reports the note BYTE and never claims which pitch it sounds — only
LSDj does. It is a named constant for exactly that reason: **confirm it once by
ear on hardware**, and if it is off, one number moves.

`tools/lsdjcheck.c` is the reader harness. liblsdj is MIT and attributed in
NOTICE along with the embedded empty-song image.

## And a whole cart (same day)

`.lsdsng` is one song and still needs importing. **`.sav` IS the cartridge**, so
`api.toLsdjSav()` writes up to 32 songs into one file: copy it to a flash cart
and every slot already holds an arrangement. Ten songs take about 40 ms.

Reachable from `npx chiptunes lsdjcart`, the MCP `export_lsdj_cart` tool, and
`chiptunes_lsdj_cart` in the page — which is the one an LSDj musician actually
wants, because it is one sentence to an agent and a cart full of starting
points.

Layout: the working-memory song (which is song 0, so the cart opens on
something), a 512-byte header, then 191 blocks of 512. **Blocks are numbered
from 1 and block N lives at (N-1)*512** — that is the off-by-one, and the gate
checks the block table accounts for exactly the blocks used and points only at
slots that exist. The `jk` marker at header+318 is what tells LSDj this is a
save rather than 128 KB of noise.

### Two counts, because they answer different questions

`notes` is what lives in the unique phrases — what LSDj shows, and what liblsdj
counts, since identical bars share a phrase. `sequencedNotes` follows the
sequence through its chains and counts what a listener hears. Reporting only the
first made a 217-note song look like a 61-note one and made the gate assert the
wrong thing.

### Range

A straight pitch mapping clamped 111 notes of a busy boss cue: our composer
writes down to MIDI 24 and LSDj's note 1 sits higher. **A clamped note is worse
than a missing one** — it is a wrong note that looks deliberate. The export
shifts by whole octaves instead, keeping every interval and pitch class, and
says so. Across 32 songs: nothing lost, seven transposed.

### The note base, resolved from the hardware rather than guessed

I shipped `NOTE_ZERO_MIDI = 36` as one constant for every channel and flagged it
as the thing only a real Game Boy could settle. It was wrong, and the machine
settled it without one.

The DMG computes pulse frequency as `131072/(2048-x)` and wave as half that, so
the lowest note a pulse can hold is 65.41 Hz and the wave channel reaches a full
octave below. `gb-hardware` agrees exactly: **pulse spans MIDI 36..108, wave
24..96.** Two lines of Kotlinski's manual finish it — pressing A on an empty
step enters **"C-2"**, and C2 is 65.41 Hz to the decimal; and the noise kick
recipe says to play at **"C-0"**, below pulse's floor, which proves the note
NAMES are per channel rather than one shared absolute scale.

So the byte is an index into what THAT channel can play: `NOTE_BASE = [36, 36,
24, 36]`.

The corroboration is that a workaround disappeared. With one constant, six or
seven songs in every 32 had to be transposed by an octave to escape the floor.
Per channel, **none do** — the bass sits in the wave channel's range in the file
exactly as it does on the hardware. `verify-lsdj` now asserts the table against
`gb-hardware.inRange()` directly, and that no song needs a shift; if either
starts firing, the table is wrong.

What is left for a real Game Boy is one octave on one channel, not the mapping.

### Measured, not inferred (LSDj 9.4.2 ROM)

The owner downloaded LSDj and asked to settle the octave in the emulator. Our
emulator cannot run it -- `gb-cpu.js` is 192 lines with no MBC and no PPU, and
LSDj is a 1 MB MBC5 application with a UI. Building one that could is a project,
not a check.

It did not need running. LSDj must carry a table of 16-bit DMG period values to
play a note at all, so the answer is static: scan the ROM for a long monotonic
run in [0,2047] whose implied frequencies step by a semitone. One table, at
0x40FA in 9.4.2:

    note 1 through 131072/(2048-x)  ->  65.41 Hz  =  C2, MIDI 36, 0.0 cents
    note 1 through  65536/(2048-x)  ->  32.70 Hz  =  C1, MIDI 24, 0.0 cents

One table serves both channels; the wave channel's halved formula puts it an
octave down. `NOTE_BASE = [36, 36, 24, 36]` confirmed exactly, and it agrees
with `gb-hardware`'s own floors to the note.

**And it caught a real bug.** `NOTE_MAX` was 0x6F (111), a round number I
invented. The table stops climbing after **89** entries. Our highest note is
index 73 so nothing was ever wrong in practice, but an index past the end of a
period table is not a wrong note -- it is whatever bytes follow it. NOTE_MAX is
the measured length now, and `verify-lsdj` checks our range against it.

A second table sits at 0x41D2, consistently ~40 cents flat. We did not need to
identify it and did not.

⚠️ **The ROM is not in this repository and must not be.** LSDj is freeware for
personal and educational use and its licence forbids copying or distributing it.
What is recorded above is two frequencies and a count -- measurements, not
content. The ROM stayed in a scratch directory outside the checkout.

### LSDj actually plays it (mGBA, 2026-09-03)

The last unverified claim -- that LSDj ACCEPTS the save and plays it -- is now
checked. Our own `gb-cpu.js` cannot do it (no MBC, no PPU, and it throws on any
opcode our driver does not emit), so this uses **mGBA's library** headlessly:
boot the real ROM with one of our `.sav` files, press START, and read the
decoded channel state.

**Result: every note in the document is played, and nothing is played that we
did not write.**

Two gotchas worth keeping:

- **mGBA faults without a video buffer and without `mCoreInitConfig`.** Both
  crash in `reset` with SIGBUS and no message.
- **NR13/NR23/NR33 are WRITE-ONLY.** Reading them back through `busRead8`
  returns nothing (mGBA says so on stderr). Read `gb->audio.chN.control.frequency`
  instead.

The harness reports two sets because neither is complete alone. `HZ` samples
every frame regardless of channel state: it catches every note, and also idle
channels and mid-transition reads, so it is the set to check for MISSING notes.
`TRIG` samples only while a channel reports playing: it misses notes, but what
it reports is real, so it is the set to check for WRONG ones. Gating on the
playing flag alone found 9 of 12 -- a fault in the observer, which is why both
are kept.

`tools/lsdjplay.c` is committed; **the ROM is not and must not be**. Run it with
`LSDJPLAY=/tmp/lsdjplay LSDJ_ROM=~/lsdj.gb npm run test:lsdj`; without both the
gate skips loudly.

# 2026-09-03 — The groove regression, and what it taught

The owner reported the station sounding "lower quality, very noisy" after the
tick rewrite. It was not noise and it was not the engine: **51 songs in 60 had
picked up an audible limp.**

Ruled out first, with measurements rather than guesses: no clipping, no sample
discontinuities, per-channel levels identical to the previous build to within
0.5%, high-frequency content identical, render parity 1.000000, and the kit gate
still at 0.9918 correlation.

The cause was my own groove selection. To reach any tempo it made k of every
four steps one tick longer -- [6,7,7,7], [5,5,5,6] -- one step up to **19% off
the average, repeating every four steps, forever**. The float rounding it
replaced spread the same total error quasi-randomly, so it never formed a
pattern and never became audible. **The thing worth preserving was not the
drift; it was the absence of a repeating shape.** The ear locks onto anything
that repeats every bar.

Grooves are now [n] or [n, n+1] only -- even, or a symmetric shuffle, which is a
feel a musician would choose. Even wins unless it would miss the target tempo by
more than 3%. Result: 60 straight, 20 shuffled, **0 lopsided** out of 80.

## The constraint underneath, which is the hardware's

At fast tempos the even rungs are far apart -- 179.2, 149.3, 128.0, 112.0 -- and
the tempi that fill the gaps carry 9-18% swing. **On this machine you cannot
have both fine tempo and a straight feel up there.** The ladder went from 32
rungs to 16, and that is the honest price of not imposing a feel nobody asked
for.

⚠️ **One consequence to weigh:** a style's bpm window is narrow, and some windows
now contain exactly one rung. `title` is anthem and arcade, 140-158, which holds
only 149.3 -- so every title cue has the same tempo. If that becomes the next
complaint, the fix is to widen the STYLES bpm ranges in composer.js so each
spans two rungs, which keeps everything straight. It changes each style's tempo
character, so it is the owner's call.

## Three gates were asserting numbers instead of properties

All three failed on this change and all three were wrong, not the code:

- `verify-diversity` demanded three tempi per scene. On a quantised ladder some
  scenes can only reach one. It checks that a scene's tempi are real rungs now,
  and that the spread holds across scenes.
- `verify-api` required at least 20 rungs. There are 16.
- `verify-language` asserted "a cheerful fast platformer" stays under 175 bpm. It
  came out at 179 -- not compounding, just the top rung. It compares against
  "a fast platformer" alone now, which is the property it meant.

And two gates were failing on machine load alone. `verify-screens` timed a
3200x2000 capture out at 60s and took the whole run down as an uncaught error
with no failing assertion; it has 180s now, because the assertion is that a face
DRAWS. `verify-sync` compared two independently sampled latencies against a flat
160ms, which cannot hold when the quantity ranges from 20ms to over 1000ms; the
tolerance scales with the magnitude now.

## LSDj is the model now, not the export format (2026-09-04)

Owner, this day: *"I need our entire way of working to be entirely compatible
and indistinguishable from LSDJ... if I export what I've made in this app to
the LSDJ format, it will have no difference whatsoever. And if I decide later
to recreate something that I made in LSDJ here, there's no difference. And if
later we decide to do an import feature, there's no difference either."*

That is a change of relationship, not a feature. `lsdj.js` TRANSLATES: it takes
whatever the composer wrote, finds the nearest LSDj-shaped thing, and reports
what it lost in `warnings`. As long as translation is the relationship, round
trip cannot be identity. The end state is that the LSDj document IS the song --
the composer writes one, the web player renders one, and `lsdj.js` only
serialises it -- and then export, import and round trip are all identity for
free, because there is nothing left to translate.

### Two decisions the owner made, so they do not get relitigated

- **Drums are kits, read from the owner's own LSDj ROM**, with noise-only as the
  fallback when no ROM is loaded. Kits live in the ROM and a `.sav` only
  references them by index, so the export is correct for anyone with LSDj; the
  web player needs the samples to match, and the only lawful source is the
  user's own copy. Never vendor them.
- **The back catalogue just changes.** Every seed re-composes under the LSDj
  model and old shared links will sound different. No second renderer, no
  document version flag -- a second code path is exactly how the player and the
  exporter drifted apart in the first place.

### `verify-lsdj-native` is the distance, and it is a RATCHET

Every check is a thing LSDj cannot hold, counted over 60 songs. Ceilings are
whatever it measured that day and may only fall. **Never raise one to make a
change fit** -- a raise means the export moved further from LSDj, which is the
whole thing the file exists to catch.

Where it started, and where it is after the first pass:

```
notes not on a phrase row     11.83%  ->  0.00%   (locked at 0)
notes closer than one row      4.31%  ->  0.00%   (locked at 0)
two notes on one channel+row   1.17%  ->  0.00%   (locked at 0)
instruments in one song            7      inside LSDj's 64
longest channel             895 rows      inside 256 chain rows of 16
note volumes on a channel         10      STILL OPEN -- see below
```

### Swing was 92% of it, and it was one line

`sw8()` slid every offbeat eighth late by a fraction of a beat. It sounds right
and it cannot be written down: **LSDj has no position between two rows**, so
4514 of our 4894 un-exportable notes were that one nudge.

A tracker swings by making the ROWS uneven -- a long-short pair of tick counts,
which is a groove. Same feel, every note still exactly on a row. What comes out
is what an LSDj musician would have typed: `[8,6]` for house at 128, `[12,8]`
for boombap at 90, `[n]` for everything straight. The remaining 380 were the
frame-level arp, three notes 0.05 beats apart -- a chord on the machine and a
chord in LSDj, so it is written as one note with an arpeggio now.

⚠️ **The groove travels on the score (`s.groove`, and `s.gb.groove`).** With
swing the rows are deliberately uneven, so "which row is this note on" is
unanswerable without it. Any reader that divides the bar into equal slices --
exporter, player, or gate -- measures the swing as error: the conformance gate
did exactly that on its first run and reported a song sitting perfectly on the
grid as 62% off it.

⚠️ **The groove maths lives in `gb-hardware.js`** (`grooveFor`, `bpmOfGroove`,
`rowFrame`, `framesPerRow`, `grooveSpread`) and `create.js` holds handles on it.
It used to be written out in the editor as well. Two copies of a clock is how a
player comes to disagree with its own exporter, and the composer needed the same
maths the moment swing became a groove.

### What is still not LSDj, in the order it matters

1. **Per-note velocity does not exist in LSDj.** Volume is the instrument's
   envelope; changing it mid-phrase spends the row's one command. We emit up to
   10 distinct volumes per channel. This is the one that will MOVE THE SOUND
   when it is fixed, and it is not a count to grind down -- it is the instrument
   model arriving.
2. **The instrument model itself.** `chip-instruments.js` has things a DMG never
   had, including a low-pass cutoff. LSDj instruments are pulse (duty, envelope,
   sweep, phase, table, vibrato, transpose), wave (synth or drawn frames, play
   mode, length, repeat), kit and noise. Ours has to become exactly that set.
3. **Note length.** LSDj stores none -- a note runs until the next one or a KILL
   command. Ours carries `frames`, which is a rendering detail today and has to
   become a command or an envelope.
4. **Import.** Once the model is the document this is a parser and two identity
   gates: parse -> serialise is byte-identical, and compose -> serialise ->
   parse -> serialise is byte-identical.

### The proof, when it comes, is not ours to mark

`tools/lsdjplay.c` already boots the real ROM in mGBA and reads the APU
registers frame by frame. Render the same song through our player and through
LSDj itself, diff the two register streams, and that is what indistinguishable
MEANS. Anything short of it is our code agreeing with our code -- the WebMCP
mistake, which this repository has already made once.

## There was never a tempo ladder (2026-09-04, later)

This session invented one and spent a long time defending it. The reasoning was
that a row lasts a whole number of frames, so only tempi whose rows divide
evenly are playable -- 179.2, 149.3, 128.0, 112.0, 99.5, 89.6, 81.4, 74.7 -- and
anything between has to be faked with an uneven groove, which is a feel nobody
asked for. The STYLES windows were widened to span several rungs to buy back the
variety the snap had taken away.

**The first half is true and the conclusion was wrong.** Asked directly, in
mGBA, LSDj plays tempo 120 as rows of 7 frames and 8 frames INTERLEAVED. It runs
an accumulator, reaches every integer tempo, and spends the remainder as a mix of
two whole frame counts. It has done this for twenty years and nobody calls it
lopsided, because an accumulator has no short period.

What DID sound like a limp -- and did, on 51 of 60 songs -- was a four-step
pattern with one step out, `[6,7,7,7]`, repeating every bar. The ear locks onto
that instantly. **Uneven rows were never the problem; a repeating shape was.**

So the ladder was ours, not the machine's, and it offered 8 tempi where LSDj
offers 111. Parity does not allow being more restrictive than the thing you are
matching, and the ladder is gone: `reachableBpms()` returns every integer in the
style bands, and `create.js` no longer snaps on encode or decode.

### The numbers, measured off the ROM

```
ticks per second = 0.4 x TEMPO
frames per tick  = 149.31875 / TEMPO        (149.31875 = 2.5 x FPS)
frames per row   = ticks x 149.31875 / TEMPO
```

LSDj's default groove of 6 ticks makes a row `895.9125/TEMPO` frames, so TEMPO
is ordinary bpm with four rows to the beat -- our own constant. `gb-hardware.js`
holds this as `lsdjRowFrame`, `lsdjFramesPerRow`, `lsdjTempoForRow` and
`lsdjGrooveTicks`; the composer, the editor and the exporter all read it.

⚠️ **A GROOVE IS IN TICKS.** We were writing FRAME counts into that field, so a
song exported as 128 bpm with a 7-frame row played at 8.17 frames a row -- 110
bpm, 17% slow, on every song this project ever exported. Nothing could have
caught it from inside: reading our own file back agreed with us perfectly
because both sides shared the assumption, and liblsdj would have agreed too --
the bytes were valid, they just meant something else.

### What is proved, and what is only close

- **Tempo**: exact. LSDj plays 9.955, 8.000, 7.000 and 5.970 frames a row where
  we predict 9.955, 7.999, 6.999 and 5.973.
- **Pitch**: exact. `NOTE_BASE` is CONFIRMED rather than believed -- byte 1
  sounds MIDI 36 on both pulses and 24 on the wave.
- **Row-by-row frame pattern**: within ONE FRAME, not identical. Our accumulator
  and LSDj's disagree about which individual rows get the spare frame, on 0-20%
  of rows depending on tempo. The averages match to 0.01%. Bit-exactness would
  need LSDj's integer arithmetic, which was not recovered; a search over
  fixed-point shifts got to 12.5% mismatch and no further. **Do not claim
  bit-identical timing.** It is inaudible sub-17ms jitter of the same kind LSDj
  itself produces, ordered differently.

### ⚠️ Two traps this cost real time to learn

- **Anything that can be misaligned will be.** A ruler song of ascending notes
  repeats, the trace starts mid-phrase, and the sequences line up three notches
  out -- which reported every NOTE_BASE an octave low, twice, and would have had
  us "fix" a constant that was right. Measure pitch with ONE note in the song.
- **A gate that divides the bar into equal slices measures the swing as error.**
  Both conformance gates did this, once when swing became a groove and again
  when the groove changed units, each time reporting a song sitting perfectly on
  the grid as 62% and then 83% off it. Ask the clock, never the average.

`scripts/verify-lsdj-emulator.js` is the harness. It needs mGBA and the owner's
own ROM (`LSDJ_ROM=...`), and SKIPS loudly without them. **The ROM is Johan
Kotlinski's, freeware for personal and educational use, and must never enter
this repository.**

## Where LSDj parity actually stands (2026-09-04, end of session)

Owner's bar: *"It needs to sound exactly the same. It needs to behave exactly
the same. It cannot have more stuff or less stuff."* Here is what is true and
what is not, because the difference matters more than the progress.

### Proved against the real ROM in mGBA

- **Tempo.** LSDj plays 9.955, 8.000, 7.000 and 5.970 frames a row where we
  predict 9.955, 7.999, 6.999 and 5.973.
- **Pitch.** `NOTE_BASE` measured, not believed: byte 1 sounds MIDI 36 on both
  pulses and 24 on the wave.
- **Instrument bytes.** Byte 0 type, byte 1 high nibble volume, byte 3 length,
  byte 4 sweep, byte 7 duty and pan, byte 11 transpose -- each found by varying
  one byte and watching which APU register moved.

### Proved in the suite

- The codec is lossless on random bytes, escape bytes, long runs and the default
  wave, not just on the empty song.
- A song image survives read -> write byte-for-byte; 71.5% of it is understood
  by name and the rest is carried verbatim.
- Export -> import returns the same tempo, groove, and every pitched note on the
  same lane at the same step at the same pitch; importing again changes nothing.
- A kick comes back a kick.

### NOT parity yet, in the order it matters

1. **LSDj's envelope is SOFTWARE.** It rewrites NR12 as a note plays rather than
   setting the hardware pace once, so byte 1's low nibble is LSDj's own envelope
   shape and not a DMG field. We write a plain sustain. Matching its characters
   means reproducing its per-tick stepping. **This is the biggest remaining
   audible difference.**
2. **Kits.** The owner chose kits read from his own ROM, with noise-only as the
   fallback. We still write NOISE instruments for drums. They survive a round
   trip by name, but they do not sound like LSDj's kits, and nothing reads the
   ROM's samples yet.
3. **Tables and commands.** LSDj's 32 tables and most of its command set are
   unused. We emit C, R and V only.
4. **Wave instruments.** LSDj's wave voices use its own soft-synth; ours use our
   wave tables. The channel is right, the timbre is ours.
5. **Row-by-row frame pattern**, within one frame -- see the tempo section
   above. Inaudible, but not identity.

### What is NOT a gap, checked so it does not get re-litigated

- **The renderer is already register-level.** The chip worklet connects straight
  to gain with no filters between; `verify-rom` proves every note reaches the
  hardware as the APU would write it. The biquads in `audio.js` are on other
  paths, not the GB one.
- **Per-note volume is not un-LSDj.** Volume lives in the instrument, so an
  accent is a different instrument -- and LSDj has 64 slots for exactly that.
  The export writes one per (voice, level); real songs use about 11. Do not
  "fix" this by flattening the music, which was the first instinct and was
  backwards.

### The envelope, MEASURED (2026-09-04, later)

Byte 1 is `volume<<4 | shape`, and both halves are measured off the ROM.

- **High nibble is the initial volume.** 0x3F sounds volume 3, 0x7F sounds 7,
  0xBF sounds 11, 0xFF sounds 15.
- **Low nibble is a HOLD, in frames, before the note is cut.** 0 sustains
  forever; 1..f hold for 1, 1, 1, 1, 1, 2, 2, 3, 4, 5, 6, 8, 11, 15, 20 frames.

So LSDj's envelope is not a decay curve, it is "this loud, for this long". Shape
0 -- sustain until something stops the note -- is what a tracker uses and what we
write.

**How it was finally measured, after two failures.** Notes RETRIGGERING every few
rows, at tempo 40 with 15-tick rows, traced per frame. mGBA's `io[]` entry for
NR12 tracks the LIVE volume rather than only the last write, so a per-frame trace
of it IS the envelope -- as long as the note lasts long enough for the steps to
land on different frames. A single note at a normal tempo shows one value and
reads as "LSDj wrote 1 and stopped". That is the trace being too coarse, not LSDj
being silent.

⚠️ **Two tools were built and deleted on the way. Do not rebuild them.**

- An instruction-stepping probe. `core->step` does not advance the GB core in
  mGBA 0.10.5 here, and `core->frameCounter()` does not count frames the way the
  name suggests, so a frame-budgeted loop ends after a few dozen instructions.
- A PCM dumper. mGBA emitted digital silence of exactly the right length through
  both the polled blip buffers and an `mAVStream` callback, with the core volume
  options and the APU's own `masterVolume` set. Whatever is missing was not
  found.

**Both failed by producing a plausible EMPTY result, which reads identically to
"LSDj does nothing here".** That is the shape of every wrong answer this
measurement produces, including the two that said NOTE_BASE was an octave low.

## Note length survives now, and it was the audible gap

LSDj stores no note length -- a note runs until the next note or a `K` command --
so ours were dropped, and every staccato note exported as a SUSTAINED one. That
is a different piece of music, and it was audible on anything with space in it.

The envelope cannot fix it: the hold tops out at twenty frames and belongs to the
instrument rather than the note. A tracker says it with a command, so the export
writes `K` on the row a note stops and the import reads the length back off it.

Verified in mGBA: with the KILL the volume drops one row after the note; without
it, it held to the next one.

⚠️ **Not on drums** -- they are one-shots and killing them cuts the sample short.
And only where the row is FREE, because a row holds one command and an arpeggio
already sitting there is the more musical thing to keep.

### So the round trip now preserves

tempo, groove, pitch, lane, step, which drum it was, and how long each note
lasted. The last of those was written down as unrecoverable two commits earlier.


## Every exported drum was SILENT (2026-09-04)

A noise note is a PITCH, and the wrong one is silence. The export wrote note 25
for every drum, on the reasoning that noise is not melodic. Measured against the
ROM one note at a time: **LSDj writes nothing to NR43 for any noise note below
33**, so every drum this project ever exported made no sound -- and had they
sounded, all three would have been the same pitch, because they shared the note.

Measured note bytes, and the divisor is the pitch:

```
note 33 -> NR43 0xde   divisor 6   low    -> kick
note 49 -> NR43 0xdb   divisor 3   middle -> snare
note 61 -> NR43 0xd1   divisor 1   high   -> hat
```

Confirmed in mGBA: three distinct NR43 values where there had been none.

⚠️ **And the header of `src/lsdj.js` was wrong about our drums.** It said "ours
are 4-bit PCM streamed into wave RAM -- the same technique LSDj kits use", and
they are not: the composer puts drums on CHANNEL 3, NOISE, with `midi: null` and
no kit data on the score at all. That stale claim is what made "drums are a real
loss" look inevitable and sent this session looking at kits. Kits are not needed
-- LSDj noise plays noise, and drums-on-noise is an ordinary LSDj arrangement.
Kits would cost the WAVE channel, which is where the bass lives.

## Three gates were measuring badly, not measuring something bad

Worth reading together, because they fail the same way: the measurement moves,
the thing being measured does not.

- **verify-sync** compared a single instantaneous `lag`, read after the sampling
  loop, against a MEDIAN of `raw` taken across it -- two samples of a moving
  quantity from different moments. The tolerance was widened twice and it still
  failed a fourth run, at 418 against 642. Both sides are medians over the same
  window now: 629 against 601, and the allowance could go back DOWN.
- **verify-export-boundaries** drove the editor on flat 80ms delays. Idle, fine;
  loaded, the picker had not opened, the click landed on nothing, and the
  fixture came back with no kit and no wave load -- reporting that the editor was
  broken when it was merely slower than the test's stopwatch. It waits for the
  panel now.
- **verify-latency** pinned the scheduler lead to 0.18 exactly, which is computed
  from two clock reads and arrives as 0.17999999999999972.

The pattern: **a gate that races a stopwatch is measuring the machine's mood.**
Wait for the condition, or compare like with like.


## The bass was playing in LSDj's voice, not ours (2026-09-04)

A wave voice's whole timbre is its 32-nibble table, and the export never wrote
one. LSDj played the right notes through its own default waveform: the correct
tune in somebody else's voice. A register trace limited to NR10..NR51 could
never have said so, because the PITCH was right -- which is why `lsdjtrace` now
runs through 0xFF3F and carries wave RAM.

**WAVES live at 0x6000**, 256 frames of 16 bytes. Found by looking rather than
guessing: the default wave appears in the empty song at exactly 256 contiguous
slots from 0x6000 to 0x6FF0, which is precisely the gap the field map had.
Confirmed on the machine -- a marker table planted at frame 0 comes back out of
LSDj's wave RAM byte for byte.

⚠️ **A wave instrument ANIMATES by default.** Left alone it walks a run of
frames -- that is LSDj's wave synth, and it is a lovely thing that is not what
our bass sounds like. **Byte 9 = 0x03 pins it to frame 0**, measured; byte 11
does not select the frame, so a pinned instrument holds frame 0 specifically and
a song using two wave voices has to share one table. The export says so in
`warnings` rather than leaving it to be noticed by ear.

Field-map coverage went 71.5% -> 84.0% with the wave region named.

## A gate cannot edit a song that is not there

`verify-export-boundaries` opened bare `/create` and edited whatever the editor
happened to put on screen -- a different song every run. One run in several has
no DRUMS at all, so the kit loop had nothing to click and the fixture came back
with no kit and no wave data. The gate then reported that exports drop data,
when the truth was the fixture never had any.

It loads a KNOWN song through the URL fragment now (`/create#s=<code>`) with
melody, bass and drums in it, and waits for the editor's panel instead of racing
an 80ms timer. Three consecutive runs return byte-identical fixture counts.


## Every gesture now carries (2026-09-04, end)

The document's six motions, and where each lives in LSDj:

```
plain   nothing
arp     command C
roll    command R
fall    instrument byte 4 = NR10, bit 3 set   (frequency decreases)
rise    instrument byte 4 = NR10, bit 3 clear
echo    TWO NOTES -- LSDj has no echo flag
```

`fall` and `rise` are a hardware SWEEP, and the sweep unit belongs to PU1 alone,
so only the Melody lane can carry them. That is the machine's limit, not one we
added.

`echo` is the interesting one. Ours renders as the note shortened to a row plus
a quieter repeat one row later on the same channel -- so that is what gets
written, rather than a flag LSDj has no way to store. Both play the same thing,
and a musician opening the file sees the repeat, which is what is actually
happening.

### The full list of what survives a round trip

tempo, groove, pitch, lane, step, note length, which drum it was, the timbre,
the loudness, and the gesture. All of it verified against the real ROM in mGBA.

### And what still does not

- **LSDj's envelope SHAPES.** Byte 1's low nibble is a hold in frames; we write 0
  (sustain), which is what a tracker uses, and say where a note stops with a KILL
  instead. Its other shapes are unused. This is a thing LSDj can do that we do
  not, not a thing we do that it cannot.
- **TABLES.** LSDj's 32 tables are a per-instrument modulation sequence.
  Nothing here writes or reads one, so importing a foreign song that uses them
  loses the modulation.
- **Row-by-row frame pattern**, within one frame. Averages agree to 0.01%.


## Tables: located, not yet played (2026-09-04)

Found by probing the running ROM, not by reading a header:

- **Instrument byte 6 = 0x20 turns a table on.** The default is 0x03 and nothing
  runs; with 0x20 a held note starts moving in pitch.
- **The data is in 0x3480..0x3E80**, five 512-byte regions of 32 tables x 16
  rows. Filling every OTHER unmapped gap in the song changes nothing.
- **Regions 3 and 4 (0x3A80, 0x3C80) are the command/value pair.** A table runs
  with those two and with no other pairing.

Named in the field map now, which took coverage 84.0% -> 91.9% and leaves the
round trip exact. `toSongJSON` warns when an imported song uses one.

### The full table spec, measured

```
instrument byte 6 = 0x20 | index    turns table `index` on (default 0x03, off)
transposes        0x3480 + table*16 + row      signed semitones
one row per TICK  six to a row, looping through all sixteen
```

Verified: a table of [0,2,4,5,7,9,11,12] on a MIDI 72 note plays
72,74,76,77,79,81,83,84 and loops, one step every 2.49 frames at tempo 60 --
which is exactly a tick.

### And they play EXACTLY

The first attempt called a table an arpeggio and warned that it was an
approximation, on the reasoning that a table steps every TICK while the document
is ROW-based, so there was nowhere to put the intermediate steps. **That was
wrong, and the thing that makes it wrong was already in the format.**

A cell carries `of` -- an offset in FRAMES -- alongside `midi` (an exact pitch)
and `lf` (an exact length in frames). Between them they can put a note wherever
the machine can, and that is the same mechanism a composed song already uses to
survive import at frame resolution.

So a note running a table is played OUT into notes, one per tick, each at the
pitch that tick sounds and the frame that tick starts on. Verified: transposes
[0,4,7,12] on a MIDI 60 note give 60,64,67,72,60,64 at frames 0,1,2,3,5,6 --
1.167 frames a tick at tempo 128, which is the tick.

**No document format change and no audio-engine change was needed.** The
approximation had been justified by a limit the format did not actually have.

## The other two gaps are closed

**The envelope** carries on import. Byte 1's low nibble is a hold in FRAMES --
measured 0 sustains, 1..f hold 1,1,1,1,1,2,2,3,4,5,6,8,11,15,20 -- and reading it
as a note length (which our document already speaks) makes a shape-9 instrument a
1-row note at 128bpm instead of one sustaining to the next note.

**The clock** puts the spare frames where LSDj puts them. The physical constant
15 x FPS = 895.9125 with a ceil disagreed on up to 20% of rows; fitting the real
thing over eight tempi and a hundred gaps each gives

    row k starts at round(k * 895.88 / TEMPO)

and a fresh trace matches **320 of 320 row gaps across four tempi, all four
exact**. The averages were always right -- this is about the ORDER of the spare
frames, which is what makes two players sound identical rather than merely equal
in tempo.


## Every LSDj command that moves a register (2026-09-04, last)

Measured by playing each one and watching the chip -- one run per command,
comparing against the same song with no command:

```
C -> NR13          chord / arpeggio      carried as motion 'arp'
R -> NR12, NR14    retrig                carried as motion 'roll'
V -> NR13          vibrato               carried as the cell's `vb`
K -> (none)        kill                  carried as the note's LENGTH
E -> NR12          envelope, a volume    carried as `vel`
O -> NR51          panning               carried as `pn`
S -> NR10, NR14    sweep                 carried as `sweep`
P -> NR13, NR14    pitch bend            carried as `dt`
M -> NR50          MASTER volume         not carried: it is global, and the
                                         document has no per-song master
A D F G H L T W Z  moved no register at all in that measurement
```

So every command that made the chip do something has a home in the document
already, and none of them is reported as unplayable any more.

### Following that caveat through

The nine "moved nothing" were measured with one value on a sustained note, and
several are structural. Re-measured with a RULER -- a note on every row, watching
the song's SHAPE -- two of them move plenty:

```
L  100 rows -> 112, mean gap 6.98 -> 6.23    a pitch SLIDE, filling in between
T  100 rows ->  56, mean gap 6.98 -> 12.32   a mid-song TEMPO change
```

So **every command that does anything measurable is now carried**:

```
L -> the cell's `gl` (glide)
T -> the document's tempoAt list, and colFrame integrates across it
M -> the document's master, which leaves as the score's gainScalar
```

### ⚠️ "A D F G H W Z moved nothing" WAS WRONG. Four of them move.

That claim was committed three times and it came from a flawed measurement: the
probe watched **channel 1's PITCH registers only**. A duty change, a wave-RAM
change, or anything on the wave or noise channel was invisible to it by
construction. Re-run across all four channels, comparing every register plus the
pitch SEQUENCE:

```
W  sets NR11's duty. Value 1, 2, 3 -> duty 1, 2, 3, directly.   CARRIED as `dy`
H  changes the pitch SEQUENCE on every channel -- a hop, so the
   song plays a different order                                 not carried
D  shortens the sequence, and on WAV rewrites ALL of wave RAM    not carried
F  moves NR13, but only on a dense phrase (a note every row)     not carried
A G Z  still nothing, on either test, on any channel
```

**The lesson is the measurement, not the commands.** Three separate write-ups
said those seven did nothing, each one repeating the first probe's blind spot. A
negative result from a probe that cannot see the effect looks exactly like a
negative result from a command that has none.

H is a HOP and the document has no jump; D touches wave RAM and looks
kit-related; F needs a denser context than one note per four rows to show what it
is. All three are SEEN and named as unread rather than claimed inert.

### Document version 14

`tempoAt` (a list of [row, tempo]) and `master` (one byte) are song-level fields
added for T and M. ⚠️ **A document using neither still encodes as v13** -- the
version byte is only raised when one of them is present -- so nothing composed
here grew by a character.

`colFrame` is PIECEWISE now: with no tempo changes it is the single call it
always was, and with them the frame of a row is the sum over the segments before
it. Verified: halving the tempo at row 32 makes every later gap exactly 2.00x.
