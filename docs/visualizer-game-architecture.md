# Visualizer Game Architecture

Retro Rave Radio games are music-reactive toy simulations. The music bus is the master; the game is the music video.

Every game is described by four layers:

1. `definition`: nouns and rules. Entities, level shape, collisions, scoring/progress, loop/win conditions, and semantic events. This layer does not read music.
2. `behavior`: autonomous player/agent intent. Goals, perception, threat evaluation, priorities, pathfinding, mistakes, and personality. This layer receives interpreted game state, not raw FFT.
3. `reactions`: music bindings. Normalized audio signals map to transient modifiers such as scale, palette, shake, glow, trails, spawn pressure, and one-shot drop moments. This layer should not permanently mutate collision geometry.
4. `renderer`: presentation. Sprites, canvas drawing, camera, particles, CRT, palette, trails, and scaling. Rendering consumes state plus transient modifiers.

Runtime lifecycle:

```text
definition state
  + behavior intent
  + shared audio snapshot
  -> rules update
  -> semantic events
  -> audio reactions / transient modifiers
  -> renderer
```

The shared runtime module is `src/visualizer.js`. It owns the contract/lifecycle wrapper, normalized audio snapshot, layer installer, pack manifests, deterministic RNG, fixed-step helpers, collision helpers, entity pools, camera helpers, and default transient modifiers. Each game is physically split into its own layer files. `index.js` should only register the pack and delegate through `VisualizerGame.run`.

`packs/games/balloon/` is the reference extracted pack. Its `index.js` is only registration; gameplay rules live in `definition.js`, autonomous flight lives in `behavior.js`, normalized music bindings live in `reactions.js`, and canvas drawing lives in `renderer.js`.

`docs/good-game-baselines.md` defines the preservation baselines: Pac-Man, Galaga, Tetris, Frogger, and Bomberman. Those games should be physically extracted behind the shared contract without losing their existing feel. They are the quality reference for recognizable gameplay, sprite scale, object density, and music-reactive presentation.

Game file rule:

```text
packs/games/<key>/
  definition.js            nouns, rules, emitted events
  behavior.js              autonomous goals, priorities, safety policy
  reactions.js             normalized music bindings and target systems
  renderer.js              presentation kind, palette, visual caps
  index.js                 CT_GAMES.<key> registration and thin pack assembly
```

Flat monolithic files such as `packs/games/<key>.js` are obsolete. The audit fails if one is reintroduced for an existing game.

The shared contract keeps the frame loop predictable:

```text
src/runtime.js
  cache one MV frame on state._mvFrame
  call VisualizerGame.run(...)
  run the active game's extracted definition/behavior/reactions/renderer layers
  keep inactive games unmounted from the hot loop
```

Performance contract:

- One active animation loop.
- Inactive games do not update.
- Audio analysis is shared globally and normalized once per frame.
- Game simulation stays out of React/UI state.
- Effects, particles, trails, and events are capped.
- Persistent state and transient visual modifiers remain separate.
- Background tabs should stop visual work and keep audio isolated.
- Music and mic input must feed the same normalized signal shape.

Acceptance checks:

```bash
node scripts/audit-music-driven.js
node build.js
npm run smoke
```
