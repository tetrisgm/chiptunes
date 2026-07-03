# Game Packs (authoring form)

Every folder here is one game pack — the PR target for new games. Full
authoring guide: `docs/game-pack-authoring.md`; format spec:
`docs/pack-format.md`; engine contract: `docs/visualizer-game-architecture.md`.

```text
packs/games/<id>/
  pack.json        rrr-pack@3 manifest (kind:"game", app.contract:3, id == folder)
  definition.js    nouns, level shape, rules, collisions, progress, semantic events
  behavior.js      autonomous player/enemy intent, safety policies, music knobs
  reactions.js     normalized music roles -> game systems binding table
  renderer.js      presentation, sprites, performance caps
  index.js         registers CT_GAMES.<id>, delegates to VisualizerGame, stays thin
  icon.png         optional, referenced from pack.json "icon"
```

**The roster is this directory.** `scripts/game-roster.cjs` scans
`packs/games/*/pack.json`; the build, validator, audit, and smoke test all
enumerate through it. Adding or deleting a game is a folder operation — there
is no key list to edit. At build time each pack is compiled to a single
IIFE-wrapped `pack.js` and published to `dist/packs/games/<id>/`
(`balloon` is additionally inlined in the bundle as the never-brick
fallback).

## Layer ownership

- `definition.js` must not read audio or draw.
- `behavior.js` must not draw or read raw audio.
- `reactions.js` binds to semantic roles ONLY — `lead`, `counter`, `bass`,
  `perc`, `noise`, `world`, `phrase`, `drop`, `idle` — never
  console-specific channel names.
- `renderer.js` must not own game rules.
- `index.js` is registration glue: no simulation, drawing, or compat bridges.

`src/visualizer.js` provides the shared helpers (`rng(seed)`, `fixedStep`,
`rectsOverlap`, `entityPool`, `camera`, `clamp`); prefer them over per-game
copies. Games must still read correctly with no music — watch mode runs
every game silently.

## Workflow

```bash
npm run scaffold:game -- <id> "Display Name" "family"
npm run validate:pack -- <id>
npm run validate:pack:strict -- <id>     # required gate for new packs
npm run validate:pack -- --all
npm run validate:games && npm run smoke && node build.js
```

## Submitting a PR

1. One folder, one game, all five layers real — no generic
   rectangle/entity demos, no monolithic frame functions (strict validation
   rejects them).
2. `pack.json` complete: `id` matching the folder, `name`, `version`,
   `author`, `license`, `app.contract: 3`.
3. The full ladder green: `validate:pack:strict`, `validate:games`, `smoke`,
   `node build.js`.
4. Bounded everything: one active loop, capped particles/pathfinding,
   deterministic seeds for level generation where possible.

`balloon/` is the reference implementation. Pac-Man, Galaga, Tetris, Frogger,
and Bomberman are preservation baselines — read `docs/good-game-baselines.md`
before structural changes and keep their recognizable gameplay, scale,
pacing, and music-reactive feel intact.

Prefer not to PR? `node scripts/pack-tools.js game build packs/games/<id>`
then `zip` it — users can sideload the zip directly. Steam Workshop
publishing (same folder, unchanged) comes with the desktop app.
