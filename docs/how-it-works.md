# How Chiptunes.app works

The long version. The short version is the README.

Every song is generated in your browser, played on an emulation of the DMG
sound chip, and can be downloaded as a **32 KB cartridge image that boots on
real hardware**. A bundled game plays along to the music, optionally rendered
through a port of a hardware-measured DMG display pipeline.

**Play:** <https://chiptunes.app>. The station starts on load; there is no
landing page. `?screen=nes` for the NES panel, `?screen=dmg` for the Game Boy
one, `?screen=crt` for the plain view, `?screen=mix` (the default) to have each
track pick one of the three at random.

```text
seed → composer → score → APU → audio          (and → .gb cartridge)
                     ↓
                  beat/energy → bundled game → DMG panel  or  NES panel
```

## Played on the chip, in your browser

`src/gb-apu.js` is a DMG APU at the register level: it accepts writes to
`$FF10-$FF3F` and turns them into samples. The browser reaches those registers
through a sequencer running in an AudioWorklet; an exported cartridge reaches
them by executing 8-bit code on the emulator in `scripts/gb-emu.js`. One
function in `src/gb-hardware.js` decides what a note writes, so a song cannot
mean two different things depending on where it is played.

That is recent, and it was not free. The browser used to play a *different
arrangement* (kick, hat, bass, pad, lead, snare, arp) through a general chip
engine with wavetables, per-voice filters, echo and stereo, none of which a Game
Boy has. Exported cartridges were faithful to the Game Boy score the whole time
and therefore sounded like a different piece of music.

## Composing *on* the chip, not for it

The first version wrote abstract music and squeezed it onto the hardware
afterwards. That is the wrong way round and it sounds like it. The composer now
writes onto the machine directly:

- Two pulse channels, one wave, one noise, and **voice allocation is a
  compositional act**, not a post-hoc fit. Notes carry priority; when a channel
  is contended, the loser is dropped at write time rather than mixed down.
- Octaves **fold** rather than clamp. A line that runs past the end of a
  channel stays music instead of piling onto the boundary note.
- Chords are written as **arpeggios**, because a DMG cannot sustain a triad.
- Pulse channels bottom out at MIDI 36 and the wave channel at 24, which is
  why bass belongs on the wave channel. The composer knows that.

Overlaps and out-of-range notes are zero by construction, not by validation.

## How a song gets written

The composer is deterministic end to end: the token in the URL seeds every
choice, so a slug is the same song forever, on every machine. There is no
model sampling at runtime and no server; the entire pipeline runs in the page.

A song draws a **style** first: one of fourteen archetypes (anthem, house,
trance, techno, dnb, breaks, arcade, rock, punk, funk, boombap, chill,
ballad, drone). The style owns its tempo band, kit signature, bass engine,
accompaniment texture, harmony type, swing and melody density, so a techno
seed and a ballad seed differ in kind, not just in dice.

The patterns inside a style are **measured, not invented**. A stdlib-only
Python miner (its own MIDI parser) walked a 74,552-file video-game MIDI
corpus and extracted, per drum-signature-and-tempo bucket: joint kit bars
(kick, snare and hats as one pattern, so they cohere the way a sequenced bar
does), bass onset masks, and 4-bar chord-root movements.
`scripts/distill-style-corpus.js` bakes the top pools into
`src/style-corpus.js`; most songs play a real mined bar as their kit.

Harmony comes from small functional grammars (with two-chord vamps and
static drones for the styles that want them), stated on the tonic and closed
with cadences that land. Melodies are built from **motifs**: a one-bar
rhythm-plus-shape cell stated on a chord tone, restated following the
harmony, developed, and closed with a stepwise run; strong beats snap to the
triad. Phrases return in an AABA-CCBA rotation because repetition is what
turns a phrase into a tune, and each return breathes (one note in seven sits
out).

Timbre is a bank of 53 instruments: corpus patches plus an authored palette
(four duties crossed with five envelope characters, six wave shapes, four
noises). Each style dresses itself from a TIMBRE table, and two hardware
articulations run identically in the browser chip and the cartridge: the
channel-1 **sweep unit** (slides, latched per note) and per-frame **vibrato
tables** (an 8-entry period walk, 16 frames into any sustained pulse note).

## The cartridge is real

`npm run test:rom` builds a ROM and **executes it on an emulated LR35902**,
capturing every write the driver makes to the sound registers and checking them
against what the score says should happen. It is the only honest way to back
"runs on hardware" without an oscilloscope.

`npm run test:rom-audio` goes further and checks the cartridge *sounds* right:
it runs the ROM on the emulator in `scripts/gb-emu.js` and compares the audio
against the browser's own render. Not as waveforms: the driver writes its
events one after another inside a frame while the browser writes them at the
frame boundary, so triggers land a fraction of a millisecond apart, and a 500 Hz
pulse has an 88-sample period. Measured, that is 0.52 waveform correlation on
identical notes. What the ear compares is the short-time spectrum, so that is
what the test compares: **1.0 dB per band, 0.99 spectrogram correlation.**

`node scripts/gb-emu.js <seed>` writes `rom.wav` and `site.wav` for listening.

**Try on Game Boy emulator** runs that cartridge in the page: the CPU in
`src/gb-cpu.js` drives the APU on the audio thread for sound and `src/gb-ppu.js`
for the picture. The ROM draws its own screen, a title and a bar per channel,
because a music cartridge with no video shows a blank LCD, which looks broken
rather than minimal. The boot logo still says Nintendo; the DMG's boot ROM
compares those 48 bytes against its own copy and refuses to start if they
differ, so that one is not ours to change.

**Download WAV** and **Download AAC** are separate buttons and each hands you
exactly the format it names. No browser exposes an MP3 *encoder* (WebCodecs
reports `mp3` unsupported everywhere) and every JavaScript one is a port of
LAME under the LGPL, which is not a thing to staple to an MIT single-file
artifact for one button. WebCodecs encodes AAC natively, in ADTS frames that
concatenate into a playable file with no container to write; the AAC button
only appears in browsers that can actually produce it.

The exporter does all the arithmetic, so the on-cartridge driver is about 200
bytes that copy four bytes into four registers. It leans on one piece of luck:
the four channels' register blocks begin at `$FF11`, `$FF16`, `$FF1B` and
`$FF20` (an arithmetic progression of five), so selecting a channel is
`$11 + ch*5` and the four writes are an `inc c` apart.

That harness has already earned itself: it caught the driver applying each
event's delay *after* the event instead of before it, sliding the whole song one
event out of step.

## Two consoles, simulated rather than filtered

Both screens apply the console's constraints **before** the display simulation,
not after. Running 24-bit artwork through a nice-looking filter gets you 24-bit
artwork that looks slightly blurry; the hardware never had those colours to
send in the first place. So the Game Boy path quantises every colour a game sets
to one of four shades, and the NES path snaps it into the twenty-five a 2C02 has
selected at any moment. One hook on the 2D context does it for all fourteen
packs without touching their code.

## The Game Boy panel

`src/lib/shaders/brickboy/` is vendored **unmodified** (Apache-2.0; see its
NOTICE). All six passes, their constants and their 85 tuned parameters are
upstream's work, derived from measurements of real hardware. This repository
translates the RetroArch slang dialect to GLSL ES 300 at load time and adapts
the geometry to a modern display.

Two bugs in that adaptation cost most of the image quality, and neither was
visible by reading the code:

- Every pass rendered with a y-**down** texcoord into a y-**up** framebuffer, so
  each output landed flipped against the buffer it was written to. Nothing
  noticed until `color-correct.slang` read `Original` (never flipped) and
  `PassOutput0` (flipped once) at the same coordinate and blended them: every
  game composited with a mirror of itself. One asymmetric test pattern found it.
- The palette ranged the art across 0..1 and the blit ranged it **again** over
  0.02..0.55, clipping the top half. Levels 0.68 and 1.00 both arrived as the
  same shade, so a block's fill was indistinguishable from its own outline.
  Four shades were doing the work of three.

The shade bins are calibrated against native 160×144 captures of real Game Boy
games (Link's Awakening 39/31/17/13, Donkey Kong '94 50/35/0/15, Trip World
57/20/13/10) because every one of them spends about half the screen on the
lightest shade and uses ink sparingly. Alpha is 1-bit in both forms and
gradients flatten, because the hardware cannot blend.

The games draw at the console's own resolution, 256×144, one canvas pixel per
LCD cell. Rendering at display resolution and downsampling afterwards is the
graphics version of the mistake the composer used to make.

## The NES panel

An NES has no display. It has a *modulator*, and what you remember seeing is a
composite signal being decoded badly by a television. The equivalent job is
not to filter the picture but to **transmit it and receive it back**.

The 2C02 has no RGB palette either. It has a 6-bit index (four luma levels by
sixteen hues) and emits a square wave that is high for six of the twelve
subcarrier phase steps, with the hue choosing where the transition falls. The
colours everyone recognises are whatever an NTSC decoder makes of that. So
`src/nes-signal.js` models the waveform and the palette is **derived** from it;
there is no table of 64 triples to get subtly wrong, and the on-screen filter
and the colour quantiser cannot disagree, because both are that one model.

Everything that reads as "NES" falls out of the round trip rather than being
added on top:

- Chroma is carried at a quarter of the luma bandwidth, so colour smears
  sideways while edges stay sharp. Measured on the GPU: luma settles at the
  edge, chroma takes 1.3 NES pixels.
- Each scanline starts four phase steps after the one above, so the residual
  subcarrier that leaks into luma marches diagonally. That one line *is* dot
  crawl.
- A pure black-and-white stripe pattern comes back **coloured**: 194/255 of
  chroma out of art that has none. Games used that on purpose.

The one constraint not modelled is per-tile sub-palette assignment: real
hardware picks one of four families per 8×8 tile, and here the families are
chosen by role instead. Everything else is the signal.

`npm run test:nes` fits the decoder's two receiver settings against a published
2C02 measurement, checks the structure the silicon guarantees (the hue wheel
rotates, hue 0 carries no chroma, emphasis only ever attenuates), and proves the
windowed filter the shader uses integrates whole subcarrier periods, with a
Gaussian of similar width, a flat field strobes by 119/255 as the sub-pixel
phase walks. On the GPU, all 64 entries decode to their palette colour exactly.

## Design rules

- One composer, one deterministic schedule, one shared web artifact, a fixed
  fourteen-game roster. No packs, taste models, stations, playlists, or
  alternate pipelines.
- `src/composer.js` uses no ambient randomness, time, DOM, storage or network
  state in the musical path. A `/track/<slug>` link reproduces the same score.
- Songs are finite and hand off without a silent tail.
- Games consume beat/energy and never compose music.
- Game packs carry generic, genre-descriptive names only. The code is original;
  a trademarked identity would make the whole repository a target.

## Development

```bash
npm install
npm run build
npm run smoke              # 48 deterministic finite songs + 14 games
npm run validate:games
npm run test:rom           # execute an exported cartridge on an emulated CPU
npm run test:rom-audio     # ...and check it makes the same sound as the browser
npm run test:dmg-panel     # the four shades stay four shades
npm run test:nes           # the composite model reproduces the 2C02 palette
npm run test:render-parity # browser and node render bit-comparable audio
npm run panel:test         # a Game Boy panel harness, no game, for measuring
npm run panel:test-nes     # the same for the NES panel, with a 64-entry probe
```

`build.js` produces the shared artifact used by the website and broadcaster.

## License

MIT; see [LICENSE](LICENSE). The vendored shader pipeline is Apache-2.0 and
keeps its own LICENSE, NOTICE and attribution headers.
