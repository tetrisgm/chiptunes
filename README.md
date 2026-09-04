# Chiptunes.app

A register-level emulation of the Game Boy sound chip in the browser, a
composer that writes complete songs for it, and an exporter that turns any of
them into a 32 KB cartridge that boots on real hardware.

The browser and the cartridge are not two implementations of the same music.
They are checked against each other: the same register writes, on the same
frames, in the same order.

**[Open Chiptunes.app](https://chiptunes.app)** ·
**[Drive it with an agent (WebMCP)](https://chiptunes.app/webmcp)** ·
**[Take the radio with you](https://chiptunes.app/radio)** ·
**[How it works](docs/how-it-works.md)**

---

### 🤖 A Game Boy studio your agent can drive

**[chiptunes.app/webmcp](https://chiptunes.app/webmcp)** — built for the
[WebMCP Challenge](https://webmcp.devpost.com).

The composer, a register-level Game Boy sound chip, the MIDI writer and the
cartridge builder are **already running in the tab**, because the website needs
them. `src/webmcp.js` exposes them as **16 tools** on `document.modelContext`.
So an agent that can open a tab can write music — **no server, no API key, no
account, nothing metered.**

| an agent can | tool |
| --- | --- |
| find out what this page is, before anything has loaded | `what_can_i_do_here` |
| ask in plain English: *"a dungeon theme like Castlevania, 40 seconds, no drums"* | `chiptunes_ask` |
| **check its own work** — it can't listen, so it measures | `chiptunes_analyse` |
| get **twelve complete, different songs in ~70 ms**, unranked | `chiptunes_variations` |
| recompose the exact song on air: *"make it gloomier"* | `chiptunes_variant` |
| hand over a share link, a MIDI file, a **32 KB `.gb` cartridge**, or an **LSDj `.lsdsng`** | `chiptunes_export` |
| **fill a Game Boy cartridge** with a starting point in every slot | `chiptunes_lsdj_cart` |
| drive the session the user is watching — play, skip, screen, tracker | 8 more |

Three things follow that a hosted model behind a key cannot do:

- **Breadth is free.** A song is 1.6 ms, so offering a real choice costs
  nothing. Against a metered API nobody generates twenty candidates; here it is
  the obvious move.
- **The agent can judge without listening.** `analyse()` reports how major or
  minor the pitch material is, whether phrases climb or fall, how much the
  melody agrees with the chords under it. Blind generation becomes a loop.
- **You and the agent share one session.** The tools are thin calls into the
  same functions the buttons call, so you hear every step and can take the mouse
  at any time. Agent actions are announced on screen — *🤖 agent: switched the
  screen to nes* — and your own clicks are not.

Full write-up, including which work landed inside the submission window:
**[docs/WEBMCP.md](docs/WEBMCP.md)**. Gated by
[`scripts/verify-webmcp.js`](scripts/verify-webmcp.js), which installs the spec's
`document.modelContext` before any page script (as an agent browser does) and
calls all 15 tools for real — locally and against production
(`npm run test:webmcp:live`).

---

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

## For people who write on the hardware

```bash
npx chiptunes lsdjcart --scenes title,overworld,battle,boss,cave --out cart.sav
npx chiptunes lsdsng song.doc --out song.lsdsng
```

**A `.sav` is the cartridge.** Copy it to a flash cart and every slot already
has an arrangement in it to argue with — up to 32 of them, written in about
40 ms. That is the shortest distance between *"I want to write something"* and
actually writing. An agent can do it in one call (`chiptunes_lsdj_cart`), and
`.lsdsng` is there for one song at a time, from the CLI, the *Download LSDj*
button in the tracker, or `chiptunes_export`.

It is one LSDj song, the unit LSDj musicians pass around. What arrives is an
**arrangement to keep writing**: the notes laid out in phrases and chains, the
sequence, the tempo and the groove. An arpeggio arrives as a `C` command rather
than as three spelled-out notes, so the phrase is one a person can read.

This is faithful rather than converted, because the composer already works the
way a tracker does: sixteen steps to a bar, four channels that map one-to-one
onto PU1/PU2/WAV/NOI, and a step that lasts a whole number of frames with a
groove for the rest. A bar **is** a phrase. Nothing is quantised on the way out.

Two things do not survive, and the export says so rather than letting you find
them by ear:

- **Drums move to the noise channel.** Ours are 4-bit PCM streamed into wave RAM
  — the same technique LSDj kits use — but a `.sav` cannot carry samples,
  because kits live in the ROM.
- **Instruments are stock defaults, one per channel.** Deliberately: voicing is
  the part an LSDj composer enjoys and is better at than a translator would be.

`npm run test:lsdj` reads the output back with **liblsdj itself**, and, given a
copy of the LSDj ROM, **boots it in mGBA and checks the pitches LSDj actually
plays** — every note in the document is played, and nothing is played that we
did not write. Neither check uses our own reader — the same
mistake that once let a WebMCP registration ship against the wrong API is
exactly what a self-round-trip would repeat.

## Verification

`npm test` runs 23 gates. Most of them exist because the thing they check was
once wrong, and the comment above each one says what went wrong.

| gate | what it holds | in `npm test` |
| --- | --- | --- |
| `test:automation` | every register write lands on the same frame, in the same order, in both players | yes |
| `test:song-document` | a song materialised from a document is the same song, note for note | yes |
| `test:share` | a shared link is the same song from either side | yes |
| `test:sync` | the picture sits on the sound, corrected for measured output latency | yes |
| `test:screens` | all three screen faces actually draw, and sleeping one frees its GPU targets | yes |
| `test:language` | every claim the prompt parser makes about a sentence is true, and every title composes with the genre it named | yes |
| `test:webmcp` | the tools register on `document.modelContext` and all 16 work, called for real against the built bundle | yes |
| `test:lsdj` | the `.lsdsng` export opens in LSDj, checked by reading it back with liblsdj | yes |
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
*"a dungeon theme like Castlevania, 40 seconds, no drums"* or *"make it much
slower and darker"* and it does that. It knows scenes, game genres, musical
genres, forms, techniques, moods, keys, tempi, lengths, and about a hundred
Game Boy and NES titles.

**A title is read as a genre and a character, and the reading is always said
back.** "Like Castlevania" resolves to *platformer, rock/punk, minor, 145-172
bpm, menacing, intense, arpeggiated*, and that sentence is what you see. The
character is the part that matters: a game is not only a genre, so naming one
next to a genre still changes the music. Asked for the same platformer from the
same seed, one word apart:

| | tempo | notes |
| --- | --- | --- |
| a platformer | 149 bpm | 185 |
| a platformer like Metroid | **112 bpm** | 241, minor, sparse, echoing |
| a platformer like Castlevania | 150 bpm | **985**, minor, arpeggiated |
| a platformer like Recca | **176 bpm** | 184 |

It is not an imitation and cannot be: nothing here is trained on or derived from
anybody's recordings, and a title can only reach dials you could type yourself,
which [`src/reference-styles.js`](src/reference-styles.js) makes visible and the
gate asserts. Explicit words still beat the reference, so *"a platformer like
Metroid"* keeps the platformer's styles, and a named scene keeps its own mode,
so a dungeon stays minor.

**And the words move the notes, which is checked rather than claimed.** A mood
used to be three settings (mode, tempo, octave), so a happy song and a sad song
were the same tune under different lighting. Four operations now change how the
music is *written*: `chordtones` (consonance against the chord underneath),
`arc` (whether a phrase climbs or falls, counted in scale degrees so it reshapes
rather than detunes), `smooth` (leaps into steps) and `accent` (emphasis on the
beat). `analyse()` measures the result, so the claim is falsifiable:

| over 22 songs each | happy | sad |
| --- | --- | --- |
| major-flavoured pitch material | 0.94 | 0.00 |
| tempo | 144 bpm | 120 bpm |
| phrase climbs or falls | **+1.8** | **−1.6** |
| melody agrees with the chord under it | **0.99** | 0.64 |
| where the tune sits | 84 | 69 |

`npm run test:language` asserts every one of those gaps, and that each song is
sorted correctly **93% of the time by the writing alone** — with major/minor and
tempo excluded from the classifier, since those are the easy half.

Everything else is refused out loud rather than quietly dropped: a name that is
not on the list, a waltz, vocals, a guitar, a Dorian mode, reverb. It says which,
and why. The parser is deterministic and lives in `src/api.js`, so it names back
exactly what it understood, says what it ignored, and never composes something
at random and lets the phrasing imply it worked.

**And the page itself is a WebMCP server.** `src/webmcp.js` registers **14 tools**
on `document.modelContext`, in two groups: ones that operate the session you are
looking at (what is on air, skip, put this song on the deck, open the tracker,
change the display), and ones that compose without a server at all
(`capabilities`, `ask`, `compose`, `variations`, `analyse`, `export`).

That second group is the interesting half. The composer is already in the page,
so an agent that can open a tab can write music with no key, no account and
nothing metered — and because a song is 1.6 ms, `chiptunes_variations` hands
back **twelve complete, different songs in about 80 ms**. An agent cannot
listen, so `chiptunes_analyse` lets it measure what it made instead. The user
hears every step as it happens and can take the mouse at any time, because the
tools are thin calls into the same functions the buttons call.

See [docs/WEBMCP.md](docs/WEBMCP.md). The same tools are on `window.chiptunes`
in any browser: try `chiptunes.tools` in the console.

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

MIT; see [LICENSE](LICENSE) — kept as unmodified MIT text so GitHub detects it.
The vendored Game Boy display shader pipeline is Apache-2.0 and unmodified; its
terms are in [NOTICE](NOTICE).
