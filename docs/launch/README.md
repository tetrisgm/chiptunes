# Launch kit

Everything in this file is ready to paste. Publishing or scheduling still
requires the owner's final approval.

## Positioning

**One line:** Create or listen to complete Game Boy songs—composed automatically
in your browser and played through an emulation of the original sound chip.

**Short:** Pick a mood and Chiptunes.app writes a complete song for you, then
another. Open any song in the tracker, edit every note, and export a link, WAV,
or cartridge that boots on compatible hardware. Fourteen self-playing games
turn the music into a second-screen visualizer.

## Hacker News

**Submission URL:** `https://chiptunes.app`

**Title:** `Show HN: A Game Boy sound chip in the browser that exports real cartridges`

74 characters. HN truncates at 80, which the previous title (88) would have hit.
Alternate, if the verification angle is preferred as the hook:
`Show HN: Browser Game Boy music, verified to match the cartridge it compiles` (76).

**First comment:**

I wanted to know whether a browser could compose a complete Game Boy song, play
it through an emulation of the sound chip at the level of its hardware
registers, and then compile the same score into a cartridge that boots on the
real machine. Chiptunes.app is the answer to that.

The part I would point another developer at is the verification. The browser
player and the cartridge are not two implementations that happen to sound
alike. A test plays a score carrying every kind of automation through the Web
Audio worklet and through the cartridge driver executing on an emulated CPU,
then asserts that every APU register receives the same values, on the same
frames, in the same order. A second gate compares the two spectrally. Getting a
note wrong in one and not the other fails the build instead of shipping as a
difference nobody notices until a cartridge sounds wrong on hardware.

The drums were the interesting problem. The DMG has one sample buffer, 32
nibbles of wave RAM, so a sampled kit is played by rewriting that buffer while
channel 3 runs. Channel 3 steps its nibbles at 4194304/((2048-period)*2), so
period 1792 is exactly 8192 Hz and one buffer lasts exactly 1/256 s. The
cartridge refills it from the timer interrupt, where the 4096 Hz clock with
TMA=240 fires exactly 256 times a second. The sample clock and the refill clock
are the same clock, so nothing drifts. Refilling once a frame instead, which
needs no interrupts, gives 1911 Hz for 955 Hz of bandwidth: muffled thuds, no
click, no sizzle. Supporting the interrupt meant teaching the CPU emulator
interrupts, the timer and six more opcodes, and giving the driver an ISR at the
$0050 vector. A kit hit steals the bass voice for its length, as it does on
hardware and in LSDJ.

The composer is deterministic and single pass: one token in, one score out, no
randomness from the clock or the network, and no generating several songs and
keeping the best. A song is a document rather than a recording, so a shared link
carries the entire arrangement packed into the URL fragment, which browsers
never send to a server. Sharing has no database behind it and stores nothing.

It is also instant, free and local, which I did not expect to matter as much as
it does. A complete song is written in about 1.6 ms on the machine you are
sitting at; a thousand of them take 471 ms; the audio renders 395x faster than
real time. There is no queue, no account and nothing metered, and nothing is
uploaded to make music.

For a listener: pick a mood and it writes a finite arrangement rather than a
loop, then another. Open the tracker and every note, instrument and effect is
editable. Take it away as a link, a WAV, or a 32 KB .gb file. Fourteen
self-playing games read shared beat and energy data as visualizers.

Try it, no account needed: https://chiptunes.app
Source, including the tests above: https://github.com/tetrisgm/chiptunes

I would most value feedback on the musical output, and from anyone who runs an
exported cartridge on real hardware. If a song sounds wrong on a device I have
not tried, I would like to hear which one.

**Useful answers for the thread:**

- `npm test` runs 20 gates. `test:automation` is the register-order comparison;
  `test:rom-audio` and `test:kit` compare the two engines spectrally
  (the kit agrees to 0.9918 correlation at 1.34 dB a band); `test:render-parity`
  requires at least 0.995 correlation between the offline render and live
  playback. The three heavier ones run outside `npm test` because they render
  audio through both engines.
- The composer generates a finite score from a token. It does not stream model
  output and does not choose among candidates in production. The style pattern
  pools are distilled offline from a 74,552-file game-music MIDI corpus.
- The `.gb` export is a 32 KB ROM-only image. The cartridge carries 32 wave
  tables, four register bytes per note, and no instrument table.
- Yes, it drives real hardware: the cartridge is a normal ROM, and the driver
  is the same one the parity tests execute on the CPU emulator.
- The fourteen visualizers are original, generic implementations. They consume
  beat and energy data and never generate music. The Game Boy LCD and NES
  composite screens are WebGL shader pipelines.
- Free, public-source, usable without an account. Songs are composed in your
  browser, not on a server: a complete song takes about 1.6 ms to write, a
  thousand of them take 471 ms, and the audio renders 395x faster than real
  time. No queue, no key, nothing metered, nothing uploaded to make music.
- Provenance is a deterministic algorithm in a public repository rather than a
  model trained on recordings, which matters if you want to ship the output in
  something.
- Game Boy is a trademark of Nintendo. This is an independent project, not
  affiliated with or endorsed by Nintendo.

## Product Hunt

**Product URL:** `https://chiptunes.app`

**Name:** `Chiptunes.app`

**Tagline:** `Automatic Game Boy songs you can edit, share, and play anywhere`

**Description (223 characters):** Pick a mood and Chiptunes.app composes a
complete song in your browser, plays it through an emulation of the original
sound chip, and pairs it with a self-playing game. Edit every note, then share a
link, WAV, or cartridge.

**Topics:** `Music`, `Open Source`, `Developer Tools`, `Games`

**Pricing:** `Free`

**Status:** `Available now`

**Thumbnail:** `assets/station-icon.png` (1024×1024 PNG)

**Gallery order:**

1. `docs/launch/gallery/01-landing.png` — compose automatically or start empty
2. `docs/launch/gallery/02-playing.png` — listen with a self-playing game
3. `docs/launch/gallery/03-create.png` — edit the complete song in the tracker
4. YouTube demo — https://www.youtube.com/watch?v=ElY6I0Eucb8

All three gallery images are 1270×760. The video is a 12-second, 1280×720 H.264
MP4 with AAC audio and is under 6 MB.

**Maker comment:**

I made Chiptunes.app because I wanted Game Boy music that could sit in the
background without becoming generic ambience—and still be real enough to take
apart.

Pick a mood and it composes a complete finite song automatically. Every note is
played through a register-level emulation of the original four-channel sound
chip, while one of fourteen original games plays itself to the beat. Open the
tracker and the result is not a flattened recording: every note, instrument,
and effect is editable. The same song can leave the browser as a link, WAV, or
32 KB cartridge.

It is free, works without an account, and the implementation and verification
harness are public. I would love to hear which songs and visualizers work for
you, and where the editor still gets in your way.

## Demo-video upload copy

**YouTube title:** `Chiptunes.app — automatic Game Boy songs you can edit`

**YouTube description:**

Create or listen to complete Game Boy songs, composed automatically in your
browser. Open any song in the tracker, edit every note, and export a link, WAV,
or cartridge.

Try it: https://chiptunes.app
Source: https://github.com/tetrisgm/chiptunes

Game Boy is a trademark of Nintendo. Chiptunes.app is an independent project
and is not affiliated with or endorsed by Nintendo.

**Visibility:** `Unlisted` (Product Hunt accepts a non-private full YouTube URL.)

**Uploaded:** https://www.youtube.com/watch?v=ElY6I0Eucb8

## Launch-day runbook

1. Confirm the production homepage, one generated song, Create, `/radio`, and
   the direct stream before posting.
2. Launch Product Hunt at its scheduled 12:01 AM Pacific window and immediately
   add the prepared maker comment.
3. Post Show HN separately when the maker can stay available to answer
   technical questions. Do not ask for votes or coordinate comments.
4. Watch the production error/health view, stream response, and both discussion
   threads. Reproduce reports before changing production.
5. Keep the fair-use clarification visible in the README, site footer, and
   video description.

## Verified launch state — 2026-09-01

- [x] Repository is public; `main` and `origin/main` point to the launch-prep
  commit and the working tree was clean before this document update.
- [x] Production root opens the landing page in real Safari on macOS.
- [x] Real Safari generated a song and exposed title, sharing, transport,
  progress, volume, full-screen, export, and radio controls.
- [x] Real Safari opened Create at `/create` with tracker controls and a visible
  `Back to game` action.
- [x] Real Safari opened `/radio` with browser playback, radio-app, copy,
  Broadcasts, PLS, direct-stream, and QR actions.
- [x] `/listen.m3u` returns `audio/x-mpegurl; charset=utf-8` and
  `/listen.pls` returns `audio/x-scpls`, both pointing to the permanent HTTPS
  stream.
- [x] The stream returns `audio/mpeg`, CORS, no-cache, 256 kbps audio info, and
  ICY station name, description, genre, homepage, and logo metadata.
- [x] The responsive 390×844 production path and browser interactions are
  covered by the checked-in Playwright verification gate.
- [x] Product Hunt has three 1270×760 gallery images and a square 1024×1024
  thumbnail.
- [x] Product copy, maker comment, Show HN copy, technical answers, and launch
  monitoring steps are prepared here.
- [x] Physical iPhone checks. The owner verified the deployed build on a real
  iPhone on 2026-09-02: the phone player bar, the Create sheet, the credit, the
  centred landing hero, the per-track screen-face re-roll, and the fix for the
  white screen in Modern mode. Android is still unchecked; no device attached.
- [x] The demo is uploaded to YouTube as an unlisted, non-private video and its
  full URL is recorded above.
- [ ] Create or schedule the Product Hunt draft.
- [ ] Submit Product Hunt and Show HN after final owner approval.

Game Boy is a trademark of Nintendo. Chiptunes.app is an independent project
and is not affiliated with or endorsed by Nintendo.
