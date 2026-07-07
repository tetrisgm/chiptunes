# RETRO RAVE RADIO — working notes

An endless chiptune radio where classic games play themselves as the music
video. **The music is the master; gameplay is its music video.** Everything
third-party-addable is a runtime-loaded pack: games, music, and the composer
itself.

## Architecture — edit `src/` + `packs/games/`, the build outputs `dist/`

`node build.js` concatenates `src/` (+ the game packs) into **ONE inline
`<script>` in `dist/index.html`** and publishes every `packs/games/<id>/` as a
compiled pack to `dist/packs/games/<id>/{pack.json, pack.js, icon}` plus
`dist/packs/index.json`. **Never ship separate `<script src>` tags** — python
http.server truncates the request burst and games silently fail to load;
always bundle to one file. **`dist/` is the ONLY directory the servers
expose**; never hand-edit it. The always-on watcher `net.mikutap.build`
auto-rebuilds on save. No ES modules/import/export anywhere in `src/` — files
are concatenated, browser-IIFE style, and must pass `node --check`.

`dist/packs/` is **gitignored** (except what build publishes is regenerated);
`dist/lib/` (wasm decoders, worklets) is committed.

## Module map (`src/`, concatenation order matters — runtime.js loads LAST)

- `helpers.js` — rrect/pix/hsl/particles + `CT_GAMES` registry.
- `visualizer.js` — shared game lifecycle, normalized `MV` audio frame,
  watchdog, capped hot loop. The games' contract; don't churn it.
- `sprites.js`, `seed.js` (Song v3 tokens, hash32/mulberry32), `radio.js`
  (fingerprint-axis taste store: KNOBS
  `tempoBand/brightness/grooveFamily/waveClass/energy`, thumbs, localStorage
  `retrorave.radio.v2`).
- `audio.js` — engine: worklet facade (`Engine.*`), scheduler, master chain,
  analyser, `vis()`, `gameMelodyNote`/`reactNote`, external-audio path, SND
  bus. Public API signatures (`Audio.init/play/gotoTrack/nextMovement/
  trackToken/vis/setTempo/setPlaying/setMix/getMix/nowPlaying/trackInfo/
  onTrackReady/gameMelodyNote/reactNote/reactOK/playExternal/visExternal`)
  are frozen — games and shell depend on them.
- `composer.js` — **rrr_core**, pure token→Score, registers into
  `CT_COMPOSERS`, also published as the reference composer pack. Pure = no
  DOM/WebAudio/Math.random; Node-loadable via `vm`.
- `packs.js` — the pack loader (global `Packs`; served//OPFS/fsdir sources,
  IndexedDB `rrr-packs`, consent, error isolation) + `activeComposer()`.
  Loads before runtime.js.
- `library.js` — Browse = the sum of enabled music packs. No scraped-metadata
  entity pages; album cards show what tracks.json/meta provide.
- `runtime.js` — shell: 3-tile home, routes, scene loop, picker (derived from
  `CT_GAMES` after `Packs.init()`, re-rendered on `Packs.onChange`), queue,
  playbar, TikTok rail, watch mode, mic/file-drop, chip playback engine.
- `game-roster.js` — layer load order only. The roster itself is a directory
  scan: `scripts/game-roster.cjs` exports
  `scanGamePacks(root) → [{id, dir, manifest}]` + `GAME_LAYER_ORDER`. No
  hardcoded game key lists anywhere.
- `src/lib/` — worklets/workers copied to `dist/lib`:
  `generated-synth-worklet.js` (synth v2), `chip-pcm-worklet.js`,
  `chip-album-worker.js`, `pack-unzip-worker.js`, `bpm-worker.js`, wasm.

## Routes + determinism

`/` (3 tiles, locked wording: **Start Endless Radio / Browse My Music / Just
Watch the Games**) · `/radio` (mints via active composer → replaceState
`/track/<slug>`) · `/browse[/<packId>/<album>/<track>]` · `/watch` ·
`/track/<slug>`. Legacy `listen|play|create|wip` → home.

Determinism contract: token → `activeComposer().compile(token)` → identical
Score → identical audio, forever within a composer version. **No
`Math.random` in composer/worklet/engine paths, ever** — seeded rng streams
from the token only. `/track/` links are a product feature.

It's a true in-memory SPA: tab clicks swap instrument + scene, never reload;
the AudioContext and beat clock persist. Don't introduce anything that
reloads or recreates the context.

## Game packs (`packs/games/<id>/`)

5 layers (`definition/behavior/reactions/renderer/index.js`) + `pack.json`
(`rrr-pack@3`, `app.contract:3`). Adding/deleting a game = folder operation.
Commands: `npm run scaffold:game -- <id> "Name" "family"` ·
`npm run validate:pack -- <id>` (`:strict` for new packs; `-- --all` scans
everything) · `npm run validate:games` · `npm run smoke` (loads packs through
the REAL loader path — served pack.js eval, not re-inlined sources).
`balloon` is additionally inlined in the bundle as the never-brick fallback
(`INLINE_FALLBACK_KEYS` in game-roster).

Doctrine: bind music through **semantic roles only**
(`lead/counter/bass/perc/noise/world/phrase/drop/idle`), never channel names.
SFX = quiet in-key melody notes routed through the one chokepoint
`gameMelodyNote` (audio.js); never a raw beep competing with the music. Games
must read correctly with no music. Editing one game reads its layer files,
not the bundle. Docs: `docs/game-pack-authoring.md`,
`docs/visualizer-game-architecture.md`, `docs/good-game-baselines.md`.

## Music packs — ZERO copyrighted content in the repo

The app ships no music. The user's converted library lives at
`dist/packs/music/<id>/` (gitignored) — built with
`node scripts/pack-tools.js music build|convert-chip` (spec:
`docs/pack-format.md`; walkthrough: `docs/music-pack-authoring.md`).
`chip-originals/` (raw rips) and `chip-derived/` (analysis, audition pages)
are LOCAL ONLY, gitignored, never under `dist/`. Never commit music content
or scraped metadata; never treat `dist/` as canonical. Music packs are
data-only by enforcement — a music manifest with `entry` is rejected.

## Composer packs

`CT_COMPOSERS[id] = { V:3, compile(token)→Score, fingerprint(token)→fp }`;
active one selected in the Packs panel, resolved by
`activeComposer()` (falls back to `rrr_core`). Radio queue = mint 8
candidates → fingerprint → novelty/pacing/bias argmax. Contract + Score
schema: `docs/composer-pack-authoring.md`; engine reference:
`docs/generated-music-architecture.md`. Tooling:
`node scripts/pack-tools.js composer scaffold|validate`.

## Watch mode clock contract

`/watch` never creates an AudioContext. Runtime owns `watchClockSND()`: a
wall-clock beat grid at **112 BPM** anchored at entry, with
`phrase = floor(bar/4)`, real beatPulse/barPhase/phrasePulse, energy ~0.16 /
energyLevel 2, slow hue drift, emit fns as no-ops, and crucially
`idle:false, paused:false` (→ `silence:false`) so games fully play — that IS
wallpaper mode. 60s scene rotation; pointer-reveal chrome; mic flips the
source to the real analyser.

## Verification ladder (run in order; the full set is the merge gate)

```
node build.js
npm run validate:pack -- --all
npm run validate:games
npm run smoke                       # real loader path
npm run audition:music -- --strict  # symbolic battery + determinism
```

Verify with text, NOT screenshots; the user watches the live server
(`radio.ramine.net`, `localhost:1338`). Only screenshot when asked.

## Serving

Always-on: `localhost:1338` (`net.mikutap.dev`, `scripts/serve.py` over
`dist/`) + `radio.ramine.net` (shared cloudflared tunnel → :1338), managed by
the `dev-site` CLI; `net.mikutap.build` is the build watcher. serve.py does
SPA fallback for app routes but returns **404 for missing paths under
`/packs/` and `/lib/`** (a fallback-200 would poison the pack loader; the
loader also magic-byte-checks). Servers expose ONLY `dist/` — `src/`,
`chip-originals/`, tooling stay private.

## Desktop-readiness rules (Tauri/Workshop milestone — enabled, not built)

- The pack format is frozen at `rrr-pack@3`; a Workshop item = a pack folder.
- New pack sources implement the same interface as the FSDir source
  (`src/packs.js`) — that IS the future NativeDirSource. Don't fork the
  loader.
- Keep the app one static bundle with no server dependencies beyond static
  file serving; keep all state in browser storage; keep `permissions: []`
  reserved (future sandbox tier). Nothing may assume an origin, a CDN, or a
  network at all once packs are local.

## Working style here

Use subagent fan-outs where files are disjoint (one-agent-per-game across
`packs/games/<id>/`); keep delicate shared-file work (`audio.js`,
`runtime.js`, `visualizer.js`, `packs.js`, build/tooling) coherent in the
main loop. Match effort to the task.

## Shared machinery lives in ~/dev/stack

The owner keeps proven, tested kits in `~/dev/stack` (also installed as the
`stack` Claude Code plugin: `/stack:add-signin`, `/stack:add-mac-app`,
`/stack:new-project`). auth-kit is a full NextAuth v5 sign-in surface
(Apple, Google, email magic links); mac-kit is a Swift package plus signed
installer/notarize/Sparkle release scripts; template/ bootstraps new
projects; runbooks/ cover the console and DNS work.

This app is a static bundle by doctrine, so the kits do NOT apply to its
current architecture. They apply the moment work grows service-shaped or
native: accounts/sync for packs, a companion or wrapper app beyond Tauri, or
a spun-off product. In those cases read the kit READMEs first and consume
the kits; never hand-roll sign-in, installers, or updaters. Improvements to
that machinery land in `~/dev/stack`, not in per-project copies.
