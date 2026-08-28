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
