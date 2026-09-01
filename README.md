# Chiptunes.app

Create or listen to complete Game Boy songs—composed automatically in your
browser and played through an emulation of the original sound chip.

**[Open Chiptunes.app](https://chiptunes.app)** ·
**[Take the radio with you](https://chiptunes.app/radio)**

![Chiptunes.app](https://chiptunes.app/og.png)

## What it does

- **Creates complete songs automatically.** Choose a mood and the composer
  writes a finite arrangement—not a loop—from pulse and wave instruments,
  noise, sampled drums, pitch sweeps, slides, arpeggios, and effects. When it
  ends, another begins.
- **Lets you make the result yours.** Open the tracker to edit every note,
  instrument, and effect, or begin with an empty song. Share the result as a
  link, WAV, or cartridge.
- **Models the original sound hardware.** Every note runs through a
  register-level emulation of the four-channel DMG audio processor. A song can
  be exported as a 32 KB `.gb` cartridge that boots on compatible hardware.
- **Turns listening into a visualizer.** Fourteen original, self-playing games
  react to the shared beat and energy data. Game Boy LCD and NES-style video
  pipelines reconstruct their characteristic displays with custom shaders.
- **Plays outside the website.** The live radio works in the browser, radio
  apps, desktop players, phones, and cars through a stable MP3 stream, M3U and
  PLS endpoints, Media Session metadata, and an Apple Broadcasts link.

## How it works

```text
seed -> composer -> score -> emulated DMG audio -> speakers / WAV / cartridge
                      |
                   beat + energy -> self-playing game -> display pipeline
```

The composer is deterministic: the same song document produces the same notes,
timing, and chip-register schedule. Shared song links carry that document, so
someone opening the link hears the song you shared rather than a newly generated
replacement.

The browser player, exported audio, cartridge, desktop build, stream, and video
renderer all use the same built artifact. Browser and cartridge output are
checked for render parity rather than maintained as separate implementations.

The full technical tour lives in
[docs/how-it-works.md](docs/how-it-works.md).

## Run it locally

```bash
npm install
npm run build
npm test
```

The production artifact is written to `dist/`.

## Project status

Chiptunes.app is an independent product experiment by Shokunin. The source is
public so the composition, emulation, visualizers, export path, and verification
harness can be inspected and improved.

Game Boy is a trademark of Nintendo. Chiptunes.app is an independent project
and is not affiliated with or endorsed by Nintendo.

## License

MIT; see [LICENSE](LICENSE). The vendored Game Boy display shader pipeline is
Apache-2.0 and unmodified; see its NOTICE.
