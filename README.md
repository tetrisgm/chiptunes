# Chiptunes.app

A register-level emulation of the Game Boy sound chip in the browser, a
composer that writes complete songs for it, and an exporter that turns any of
them into a 32 KB cartridge that boots on real hardware.

The browser and the cartridge are not two implementations of the same music.
They are checked against each other: the same register writes, on the same
frames, in the same order.

**[Open Chiptunes.app](https://chiptunes.app)** ·
**[Take the radio with you](https://chiptunes.app/radio)** ·
**[How it works](docs/how-it-works.md)**

![Chiptunes.app](https://chiptunes.app/og.png)

## The engineering

**The chip is emulated at the registers, twice, and the two are compared.**
Every note becomes writes to `$FF10`–`$FF3F`: duty, envelope, the sweep unit on
channel 1, the wave table on channel 3, the LFSR on channel 4. The browser
runs those through a Web Audio worklet; the cartridge runs them through a
driver executing on an emulated CPU. `npm run test:automation` plays a score
carrying every kind of automation through both and asserts that each register
receives the same values **in the same order** — not merely a similar sound.
`npm run test:rom-audio` then compares the two spectrally.

**Sampled drums are 4-bit PCM on channel 3, and the rate is chosen rather than
rounded.** The DMG has one DAC — 32 nibbles of wave RAM — so a sample is played
by rewriting that buffer while the channel runs. Channel 3 steps its nibbles at
`4194304 / ((2048 - period) * 2)`, so period 1792 is exactly 8192 Hz and one
buffer lasts exactly 1/256 s. The cartridge refills it from the **timer
interrupt**: the 4096 Hz clock with `TMA = 240` fires exactly 256 times a
second. The sample clock and the refill clock are the same clock, so nothing
drifts. Refilling once per frame instead — the obvious approach, no interrupts
needed — would have sampled at 1911 Hz for 955 Hz of bandwidth: muffled thuds,
no click, no sizzle.

Getting that working meant teaching the CPU emulator interrupts, the timer and
six more opcodes, and giving the driver an ISR at the `$0050` vector. A kit hit
steals the bass voice for its length, exactly as it does on hardware and in
LSDJ. `npm run test:kit` plays every drum through both paths and compares
spectrograms — they agree to 0.9918 correlation, 1.34 dB a band, and the two
clocks are asserted to be exactly in step.

**The composer is deterministic and single-pass.** One token in, one score out,
with no ambient randomness, no clock, no network and no best-of-N scoring
anywhere in the production path. The same document always produces the same
notes, the same timing and the same register schedule.

**Songs are documents, and a shared link carries the whole one** — packed into
the URL fragment, which browsers never send to a server. There is no database
behind sharing, nothing stored, and nothing to moderate. The station and the
tracker play the same document, so "edit what I am hearing" is that song note
for note rather than an approximation of it.

**Fourteen visualizers, and two display pipelines.** The games play themselves
from shared beat and energy data and never compose anything. The Game Boy LCD
and NES composite screens are WebGL shader pipelines that reconstruct the
artifacts of the real displays.

**One artifact.** The website, the WAV renderer, the cartridge exporter, the
radio stream and the video renderer are the same build. There is no per-target
fork to drift.

## Instant, free, and local

There is no queue, no account, and no server in the loop. A song is **composed
in your browser** by a deterministic algorithm, not fetched from a model.

| | measured |
| --- | --- |
| compose a complete song | **1.6 ms** |
| a thousand complete songs | **471 ms** |
| build a 32 KB cartridge | 1.2 ms |
| render the audio | 103 ms for 40.7 s — **395× faster than real time** |

Three consequences worth stating plainly, because they are unusual:

- **Nothing is uploaded to make a song.** Composition happens on your machine.
  A shared link carries the whole arrangement in the URL fragment, which
  browsers never send to a server, so sharing needs no database and stores
  nothing.
- **Nothing is metered.** No key, no quota, no cost per generation. Generating a
  hundred candidates and keeping one is a reasonable thing to do here.
- **Provenance is a readable algorithm**, in this repository, rather than a model
  trained on other people's recordings.

(The radio stream is a server, because listening in a car needs one. Making
music is not.)

## Verification

`npm test` runs 20 gates. Most of them exist because the thing they check was
once wrong, and the comment above each one says what went wrong.

| gate | what it holds | in `npm test` |
| --- | --- | --- |
| `test:automation` | every register write lands on the same frame, in the same order, in both players | yes |
| `test:song-document` | a song materialised from a document is the same song, note for note | yes |
| `test:share` | a shared link is the same song from either side | yes |
| `test:sync` | the picture sits on the sound, corrected for measured output latency | yes |
| `test:screens` | all three screen faces actually draw, and sleeping one frees its GPU targets | yes |
| `test:rom-audio` | browser chip vs. the ROM executing on the emulated CPU, spectrally | run on its own |
| `test:kit` | sampled drums match across both paths; the sample and refill clocks are in step | run on its own |
| `test:render-parity` | offline render matches live playback to ≥ 0.995 correlation | run on its own |

The three heavier comparisons render audio through both engines, so they are
run separately rather than on every pass.

`npm test` is a manual command. Nothing in this repository builds, signs,
publishes or deploys on a trigger.

## What you get as a listener

Pick a mood and it writes a complete song — a finite arrangement, not a loop —
then another. Open the tracker and every note, instrument and effect is
editable. Take the result away as a link, a WAV, or a `.gb` cartridge. The live
radio plays in browsers, radio apps, desktop players and cars over a stable MP3
stream with M3U and PLS endpoints.

```text
seed -> composer -> score -> emulated DMG audio -> speakers / WAV / cartridge
                      |
                   beat + energy -> self-playing game -> display pipeline
```

## Use it from a program, or an agent

Everything runs headless. There is no service to call and no key to get.

```bash
npx chiptunes brief --scene boss --seconds 45 --exclude Drums --out boss.doc
npx chiptunes variant boss.doc --mood sadder --out gameover.doc
npx chiptunes stems boss.doc --out stems/       # four exact WAVs, one per voice
npx chiptunes rom boss.doc --out boss.gb        # boots on hardware
npx chiptunes soundtrack --scenes title,overworld,battle,boss,game_over --key D --out ost/
npx chiptunes midi boss.doc --out boss.mid            # format 1, a track per voice
npx chiptunes variations --scene cave --n 10 --out options/
```

That last one is the interesting case: five cues in the same key, in about 60 ms.

```js
const chiptunes = require('chiptunes/src/api');
const cue = chiptunes.brief({ scene: 'battle', seconds: 30, exclude: ['Drums'] });
const sad = chiptunes.variant(cue.doc, { mood: 'sadder' });   // the death-screen version
```

**As an MCP server**, for a model that should be able to write music:

```json
{ "mcpServers": { "chiptunes": { "command": "node", "args": ["mcp/server.js"] } } }
```

It exposes `guide`, `brief`, `soundtrack`, `variations`, `variant`, `transform`,
`describe`, `song_to_json`, `json_to_song`, `validate`, `export_cartridge`,
`export_wav`, `export_stems`, `export_midi` and `share_link`. Songs are held by short id, reading is paged by
bar, and every transform returns a **new** song, so going back is free.

And in the product itself there is a field under the mood chips: type
*"a platformer overworld theme, arpeggiated, 40 seconds"* or *"make it much
slower and darker"* and it does that. It knows scenes, game genres, musical
genres, forms, techniques, moods, keys, tempi and lengths.

It will **not** pretend to imitate a named game or composer. Ask for "something
like Zelda" and it says so plainly and asks for the genre instead, because
nothing here is derived from anyone else's music and a franchise name could only
ever be a guess wearing a trademark. Same for the things the hardware cannot do:
a waltz, vocals, a guitar. It says which, and why. The parser is deterministic and lives in `src/api.js`, so it names
back exactly what it understood, says what it ignored, and refuses out loud
rather than composing something at random.

The page carries the same idea for the session you are looking at: `window.chiptunes`
plus WebMCP tool registration, so a browsing agent can pick a mood, skip, open
the tracker, or make the playing song sadder.

Design notes: [docs/AGENT_PLAN.md](docs/AGENT_PLAN.md).

## Run it locally

```bash
npm install
npm run build
npm test
```

The production artifact is written to `dist/`.

## Project status

An independent product experiment by Shokunin. The source is public so the
composition, emulation, visualizers, export path and verification harness can
be inspected and improved.

Game Boy is a trademark of Nintendo. Chiptunes.app is an independent project
and is not affiliated with or endorsed by Nintendo.

## License

MIT; see [LICENSE](LICENSE). The vendored Game Boy display shader pipeline is
Apache-2.0 and unmodified; see its NOTICE.
