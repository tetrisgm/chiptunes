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

**Title:** `Show HN: Chiptunes.app – automatic Game Boy songs, editable and exportable as cartridges`

**First comment:**

I built Chiptunes.app to answer a narrow question: could a browser compose a
complete Game Boy song automatically, play it through an emulation of the
original four-channel sound chip, and then export the same arrangement as a
cartridge?

Pick a mood and it writes a finite song—not an endless loop—while one of fourteen
original games plays itself to the beat. You can open the tracker and change
every note, instrument, and effect, then share a link, download a WAV, or export
a 32 KB `.gb` file.

The browser player, WAV renderer, cartridge exporter, radio, and visualizers all
use one built artifact rather than separate implementations. The source includes
tests that compare the browser and cartridge register schedules:
https://github.com/tetrisgm/chiptunes

You can try it without an account: https://chiptunes.app

I would especially value feedback on the musical output, the tracker, and how
clearly the landing page explains what is actually happening.

**Useful answers for the thread:**

- The composer generates a finite score from a seed. It does not stream model
  output or choose among multiple production candidates.
- Browser audio and the exported cartridge follow the same note and register
  schedule. The test gate requires render-parity correlation of at least 0.995.
- The `.gb` export is a 32 KB ROM-only cartridge image and boots on compatible
  hardware or an emulator.
- The fourteen visualizers are original, generic game implementations. They
  consume shared beat and energy data; they do not generate the music.
- The site is free, public-source, usable without an account, and does not send
  song-generation requests to a server.

## Product Hunt

**Product URL:** `https://chiptunes.app`

**Name:** `Chiptunes.app`

**Tagline:** `Automatic Game Boy songs you can edit, share, and play anywhere`

**Description (239 characters):** Pick a mood and Chiptunes.app composes a
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
- [ ] Physical iPhone and Android checks. The attached iPhone and iPad were
  offline during the 2026-09-01 gate; no Android device was attached.
- [x] The demo is uploaded to YouTube as an unlisted, non-private video and its
  full URL is recorded above.
- [ ] Create or schedule the Product Hunt draft.
- [ ] Submit Product Hunt and Show HN after final owner approval.

Game Boy is a trademark of Nintendo. Chiptunes.app is an independent project
and is not affiliated with or endorsed by Nintendo.
