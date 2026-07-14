# Retro Rave Radio

**Endless retro music that keeps making itself. Mini games that move to the
beat.** Open it, pick a station, that's the whole manual.

**▶ Play it: <https://retro-rave-radio.pages.dev>**

A generative chiptune composer writes an infinite, never-repeating DJ set —
real tracks with hooks, builds, and drops, not loops — while a classic arcade
game plays itself on screen, cut to the music. Swipe up to skip, double-tap
to like; likes steer what comes next.

## Stations

The home screen is one choice — the mood of the radio:

- **Everything!** — the full mix, every mood in rotation.
- **Mellow** — laid-back grooves; the melody appears only as a garnish, at
  half volume.
- **Instrumental** — pure grooves, no lead line at all. Background gold.
- **Melodic** — hook-driven chiptunes, front and center.

Every generated track is deterministic: its shareable `/track/<slug>` URL
plays back *identically*, note for note, forever (per composer version).

## The games

Sixteen arcade classics play **themselves** as the music video — each one an
original re-implementation with an autopilot that cuts to the track. Grab
the keys any time: **arrows or WASD are the only controls** (actions like
firing, sword swings, and bombs handle themselves). Stop touching, and the
autopilot takes back over.

`/watch` is wallpaper mode: the games rotate silently on an internal beat
clock, no audio ever. Optional room-mic reaction from the watch bar.

## What it never does

- **No accounts, no tracking, no server.** One static HTML file; all state
  lives in your browser.
- **No bundled or streamed recordings.** Every note is synthesized live by
  the in-browser engine. The repo ships zero audio content.
- **No non-determinism where it matters.** Same track link, same song, every
  time.

## Everything is a pack

Games and composers are runtime-loaded packs (`rrr-pack@3` — spec in
[docs/pack-format.md](docs/pack-format.md)). Sideload a zip by dragging it
onto the app, link a folder of packs, or PR one to this repo. A future Steam
Workshop item is exactly one pack folder.

### Make a game pack

A game is one folder with five small files:

```
packs/games/<id>/
  pack.json  definition.js  behavior.js  reactions.js  renderer.js  index.js
```

`definition.js` is the game's rules, `behavior.js` its autopilot,
`reactions.js` maps music roles (lead/bass/perc/drop/…) onto game systems,
`renderer.js` draws. Controls doctrine: directional-only — up/down/left/right
must be enough; anything else automates. Scaffold one with
`npm run scaffold:game -- my_game "My Game" "arcade"`, then read
[docs/game-pack-authoring.md](docs/game-pack-authoring.md). PRs welcome —
the roster is the directory tree, so a merged folder ships automatically.

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
Workshop support (games and composers as Workshop items) and DLC. The pack
format, the loader's directory-source interface, and the silent watch mode
are already built for that milestone.

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
| `npm run pack:tools` | the pack SDK CLI (game/composer build, validate, zip) |

Deploys are a static upload of `dist/` to Cloudflare Pages:
`npx wrangler pages deploy dist --project-name retro-rave-radio`.

Contributor architecture notes live in [AGENTS.md](AGENTS.md); docs index in
[docs/](docs/).

## License

App code: see repository license. Game likenesses are used with permission.
Packs carry their own `license` field.
