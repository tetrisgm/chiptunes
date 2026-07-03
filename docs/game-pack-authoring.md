# Game Pack Authoring

How to build a Retro Rave Radio game pack — a game that plays itself as the
music video for whatever is playing. Format spec: `docs/pack-format.md`.
Engine/lifecycle contract: `docs/visualizer-game-architecture.md`. Layer
ownership rules: `packs/games/README.md`.

## Layout

A game pack is one folder:

```
packs/games/<id>/
  pack.json        rrr-pack@3 manifest
  definition.js    nouns, level shape, rules, collisions, semantic events
  behavior.js      autonomous intent (the autopilot)
  reactions.js     music-role -> game-system binding table
  renderer.js      presentation, sprites, performance caps
  index.js         registration glue (CT_GAMES.<id> + VisualizerGame.install)
  icon.png         (optional, referenced from pack.json "icon")
```

The roster IS the directory tree: every `packs/games/<id>/` with a valid
`pack.json` is discovered by the build, validator, audit, and smoke test
(`scripts/game-roster.cjs` scanner). Adding or deleting a game is a folder
operation — there is no key list to edit.

`pack.json`:

```json
{ "schema": "rrr-pack@3", "kind": "game", "id": "<id>",
  "name": "DISPLAY NAME", "version": "1.0.0",
  "author": "you", "license": "MIT",
  "app": { "contract": 3 },
  "icon": "icon.png",
  "permissions": [] }
```

`id` must match the folder name and `^[a-z][a-z0-9_]{1,31}$`.

## Scaffold

```bash
npm run scaffold:game -- <id> "Display Name" "family"
# same thing: node scripts/pack-tools.js game scaffold <id> "Display Name" "family"
```

## Validate

```bash
npm run validate:pack -- <id>            # folder contract
npm run validate:pack:strict -- <id>     # required gate for new packs
npm run validate:pack -- --all           # every folder under packs/games/
npm run validate:games                   # music-driven audit across the roster
npm run smoke                            # loads packs through the real loader path
```

Strict mode rejects compatibility bridges and lifecycle gaps, so new games
cannot inherit the old monolithic frame pattern. Run `node --check` on each
layer file after syntax-heavy hand edits.

## Build & distribute

Authoring form (the 5 layers) is what lives in the repo and what you PR.
Distribution form is a single `pack.js` — the layers concatenated in
`GAME_LAYER_ORDER` and wrapped in one IIFE — built by the same shared routine
(`scripts/lib/pack-build.js`) whether `build.js` or you do it:

```bash
node scripts/pack-tools.js game build packs/games/<id> [--out dir]
node scripts/pack-tools.js zip <builtPackDir>            # -> <id>.zip
```

Publishing paths:

1. **PR to this repo** — the pack lands in `packs/games/<id>/`, the build
   publishes it to `dist/packs/games/<id>/` automatically, and it appears in
   everyone's picker. Gate: `validate:pack:strict`, `validate:games`, `smoke`,
   and the quality bar below.
2. **Sideload** — share the zip; users drag it onto the app (one-time consent:
   game packs are code). Steam Workshop later uses the same folder, unchanged.

## Quality bar

- Build from the design brief directly: physics, scale, pacing, camera,
  sprite language, and level grammar before code. No generic
  rectangle/entity demos.
- Build a game first; layer music reactivity on top. The game must still read
  correctly with no music (watch mode runs every game silently).
- Bind music through **semantic roles only** — `lead`, `counter`, `bass`,
  `perc`, `noise`, `world`, `phrase`, `drop`, `idle` — never console-specific
  channel names. The music may be generated, a chip rip, a mic, or a dropped
  file; roles are the only stable surface.
- Deterministic seeds for level generation where possible; one active loop;
  bounded particles/pathfinding; caps on everything.
- `index.js` stays thin. Rules in `definition.js`, intent in `behavior.js`,
  audio mapping in `reactions.js`, drawing in `renderer.js`.

Aim for one complete NES/Game-Boy-scale slice (one level, one stage, one
board) rather than a sprawl. `packs/games/balloon/` is the reference
implementation.
