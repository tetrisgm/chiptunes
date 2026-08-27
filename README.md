# Chiptunes.app

An endless Game Boy radio. Press play, put it on your second screen, and get
on with your day: <https://chiptunes.app>

![Chiptunes.app](https://chiptunes.app/og.png)

## Highlights

- **Every song is written in your browser, live.** No server, no model, no
  playlist. A deterministic composer generates each track from the token in
  the URL, so a link plays the same song forever, on any machine.
- **The sound chip is real.** A register-level emulation of the DMG APU: two
  pulse channels, one wave, one noise, the channel-1 hardware sweep unit, and
  per-frame vibrato tables. What you hear is what the silicon would do.
- **Every song is a cartridge.** Download ROM hands you the track you are
  hearing as a 32 KB `.gb` file that boots on real hardware. The browser chip
  and the cartridge are spectrally verified against each other in CI-grade
  tests (`npm run test:rom-audio`), so they cannot drift apart.
- **Make your own.** Create is a pocket tracker on the same chip: the song
  runs left to right as four lanes -- Melody, Harmony, Bass, Drums, the DMG's
  own voices -- and a note is a block you drag anywhere. Up and down for
  pitch, sideways in time, into another lane to change voice, by its right
  edge to make it longer, and it sounds as it moves. Each lane names the sound
  it is holding -- 31 of them, read off the chip's own bank: Square, Punch,
  Reed, Bell and Thin on the pulse voices, Round, Cello, Vox, Saw and Growl on
  the wave voice, Tick through Kick on the noise voice -- and any note can be
  given another, along with a motion -- Arp strums the chord, Roll ratchets it,
  Echo repeats and fades, Fall and Rise slide the pitch -- which expands into
  ordinary chip notes the way trackers have always done it. Tap a mood (happy, spooky, battle) and the radio's
  composer writes a whole track into the lanes, no AI involved, yours to edit
  note by note. Share it as a link, a WAV, or a real cartridge.
- **The music is measured, not guessed.** Songs draw one of fourteen styles
  (house, dnb, trance, rock, chill, and friends). The patterns inside them
  are mined from 74,552 video-game MIDI files: real kit bars, real bass
  lines, real chord movements.
- **53 instruments.** Corpus-learned patches plus an authored palette (four
  duties by five envelope characters, six wave shapes), dressed per style.
- **The games play themselves.** Fourteen bundled arcade-style games run on
  autopilot and react to the beat. They visualize; they never compose.
- **The screens are simulations, not filters.** The Game Boy face quantises
  every colour to four shades before a hardware-measured display pipeline
  draws it. The NES face modulates the picture into an NTSC signal and
  decodes it back; the palette is derived from the 2C02 waveform, not a
  table.
- **Take it anywhere.** Web radio stream, WAV/AAC export, a desktop app that
  runs as a living wallpaper (Mac, Windows, Linux), and the in-page Game Boy
  emulator that runs the exported cartridge.

## How it works, in one line

```text
seed -> composer -> score -> emulated DMG APU -> audio   (and -> .gb cartridge)
                      |
                   beat/energy -> self-playing game -> GB / NES / CRT screen
```

The full story, including the display pipelines, the cartridge driver, and
the verification harness, lives in [docs/how-it-works.md](docs/how-it-works.md).

## Development

```bash
npm install
node build.js            # builds dist/ (a single HTML file plus the worklets)
npm run smoke            # 48 deterministic songs + all 14 games advance
npm run test:rom-audio   # the cartridge and the browser make the same sound
```

## License

MIT; see [LICENSE](LICENSE). The vendored Game Boy display shader pipeline is
Apache-2.0 and unmodified; see its NOTICE.
