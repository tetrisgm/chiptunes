# Retro Rave Radio

**An endless chiptune radio where classic games play themselves as the music
video.** Open it, press one of three buttons.

- **Start Endless Radio** — a generative chiptune composer writes an infinite,
  never-repeating DJ set (real tracks with hooks, builds, and drops — not
  loops), while an arcade game plays itself on screen, cut to the music.
  Swipe to skip, double-tap to like; likes steer what comes next.
- **Browse My Music** — your own chip-music library (NES, Game Boy, Genesis,
  SNES, Amiga mods, …) as albums, played through the same game visualizers.
  The app ships with no music: you add **music packs** (zip import or a linked
  folder) and browse the sum of what's installed.
- **Just Watch the Games** — the radio without the radio: silent wallpaper
  mode. Games play themselves on a fixed internal clock, rotating scenes,
  no audio ever. Flip on the mic and they dance to whatever your room hears.

Everything runs in the browser from one HTML file. Music can also come from
your microphone or a dropped audio file — the games visualize any source.

## What it never does

- **No accounts, no tracking, no server.** It's a static file; all state is
  local to your browser.
- **No bundled copyrighted music.** The app ships zero content — bring your
  own packs, built from your own rips with the included tools.
- **No non-determinism where it matters.** Every generated track has a
  shareable `/track/<slug>` link that plays back *identically*, note for
  note, for anyone on the same composer version.

## Everything is a pack

Games, music, and even the composer are runtime-loaded packs
(`rrr-pack@3` — spec in [docs/pack-format.md](docs/pack-format.md)).
Sideload a zip by dragging it onto the app, link a folder of packs, or PR one
to this repo. A future Steam Workshop item is exactly one pack folder.

### Make a game pack

A game is one folder with five small files:

```
packs/games/<id>/
  pack.json  definition.js  behavior.js  reactions.js  renderer.js  index.js
```

`definition.js` is the game's rules, `behavior.js` its autopilot,
`reactions.js` maps music roles (lead/bass/perc/drop/…) onto game systems,
`renderer.js` draws. Scaffold one with
`npm run scaffold:game -- my_game "My Game" "arcade"`, then read
[docs/game-pack-authoring.md](docs/game-pack-authoring.md). PRs welcome —
the roster is the directory tree, so a merged folder ships automatically.
Workshop publishing comes with the desktop app.

### Make (or get) music packs

Point pack-tools at a folder of rips and it does the rest — album archives,
tag extraction, optional per-track BPM analysis:

```bash
node scripts/pack-tools.js music build ~/rips/nes --id my_nes --name "My NES" --bpm
node scripts/pack-tools.js zip dist/packs/music/my_nes
```

Drag the zip onto the app. Full walkthrough:
[docs/music-pack-authoring.md](docs/music-pack-authoring.md).

### Make a composer pack

The generator itself is replaceable. A composer is a pure function
`token → Score` registered into `CT_COMPOSERS`; the app's own composer
(`rrr_core`) is published as a pack and is the reference implementation.
Scaffold with `node scripts/pack-tools.js composer scaffold my_comp`, study
[docs/composer-pack-authoring.md](docs/composer-pack-authoring.md) and
[docs/generated-music-architecture.md](docs/generated-music-architecture.md),
and select your composer in the Packs panel.

## Roadmap

Web now → desktop later, on the Wallpaper Engine model: a Steam app with
Workshop support (games / music / composers as Workshop items) and DLC. The
pack format, the loader's directory-source interface, and the silent watch
mode are already built for that milestone.

## Development

No framework, no bundler magic: plain JS concatenated into a single inline
`dist/index.html`.

```bash
node build.js                      # src/ + packs/games/ -> dist/
python3 scripts/serve.py           # serve dist/ (SPA fallback + /packs hardening)
```

| command | what |
|---|---|
| `npm run build` | build `dist/index.html` + publish `dist/packs/` |
| `npm run smoke` | generated-seed smoke + real-loader game smoke |
| `npm run validate:games` | music-driven audit across the roster |
| `npm run validate:pack -- <id>` \| `-- --all` | game-pack contract checks (`:strict` variant) |
| `npm run audition:music` | symbolic composer battery |
| `npm run scaffold:game -- <id> "Name" "family"` | new game pack |
| `npm run pack:tools` | the pack SDK CLI (game/music/composer build, validate, zip) |

Contributor architecture notes live in [AGENTS.md](AGENTS.md); docs index in
[docs/](docs/).

## License

App code: see repository license. Packs carry their own `license` field —
music packs built from commercial rips are for personal use and must not be
redistributed through this repo.
