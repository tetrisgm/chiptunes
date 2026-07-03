# Good Game Baselines

These games are preservation targets. They are the examples the user called out as already working well: Pac-Man, Galaga, Tetris, Frogger, and Bomberman. Their extraction must keep their existing look, scale, pacing, and readable gameplay. Do not rewrite them into generic entity demos, abstract rectangle fields, or new visualizer concepts.

Use Balloon as the reference for physical layer separation. Use these five games as the reference for quality and game feel.

## Shared Rule

For each preservation game:

- Keep recognizable sprites, tile scale, movement cadence, camera framing, and object density.
- Move code behind `definition`, `behavior`, `reactions`, and `renderer` without changing gameplay first.
- Preserve the current reactive visual language unless a change is explicitly needed for performance or correctness.
- Audio reactions may pulse, tint, shake, and modulate presentation, but must not rewrite collision boxes, pathing rules, or readable gameplay spacing.
- Keep deterministic randomness where possible so a seed reproduces the same level, maze, or sequence.
- Add performance caps during extraction, not after: events, particles, pathfinding, and transient effects must be bounded.

## Pac-Man

Preserve:

- Single-screen maze readability, pellet grid, power pellets, tunnels, and ghost pen behavior.
- Existing maze variants and phrase-stable maze morphing.
- Grid-step movement using the existing beat/grid cadence.
- Ghost chase, scatter, frightened, and pen-release behavior.
- Pac-Man mouth animation, ghost eyes, frightened colors, score text, and compact arcade framing.

Extraction map:

- `definition`: maze data, passability, pellet state, power pellet rules, tunnel wrapping, collision, ghost mode state, score/progress events.
- `behavior`: Pac-Man target selection, ghost route priorities, frightened chase/avoid rules, tunnel escape choices.
- `reactions`: beat pulse, phrase maze morph, palette shift, frightened/drop boost, pellet shimmer, idle fallback.
- `renderer`: maze draw, pellets, sprites, ghost eyes, score HUD, CRT/passive effects.

Risks:

- Breaking ghost-pen routes.
- Allowing maze morphs to trap Pac-Man or ghosts.
- Replacing grid cadence with smooth generic movement.

## Galaga

Preserve:

- Enemy formation masks, row colors, formation sway, and dive paths.
- Player cannon at the bottom, discrete shots, and readable alien density.
- Challenge/sweeper variant behavior.
- Music-driven formation rebuilds at phrase boundaries.
- Beat pulses and starfield depth without overwhelming the screen.

Extraction map:

- `definition`: formation slots, enemy states, shots, divers, collisions, wave/progress events.
- `behavior`: cannon aim/fire choice, diver target choice, challenge sweep timing.
- `reactions`: beat swelling, bar sway, phrase formation rebuild, drop dive pressure, treble/star shimmer.
- `renderer`: arcade starfield, formation sprites, player ship, shots, explosions, score/variant presentation.

Risks:

- Turning dives into random free movement.
- Spawning too many entities for the screen to remain legible.
- Losing phrase-bound formation changes.

## Tetris

Preserve:

- Board dimensions, tetromino shapes, rotation/collision rules, lock timing, line clears, and 7-bag randomizer.
- Existing two-piece lookahead AI and Tetris-well preference.
- Game Boy-like palette option and compact board framing.
- Music-reactive line clear effects without mutating the board itself.

Extraction map:

- `definition`: board, pieces, bag, gravity/lock/clear rules, score/progress events.
- `behavior`: placement scoring, lookahead, hold/drop intent, imperfect-but-readable choices.
- `reactions`: beat gravity/pulse, line-clear burst, phrase palette shift, drop flash, idle piece bob.
- `renderer`: board cells, active/ghost piece, next preview if present, line clear animation, score text.

Risks:

- Introducing per-frame board allocation or React state.
- Changing the AI heuristic enough that it stops looking competent.
- Letting music alter collision/grid geometry.

## Frogger

Preserve:

- Road/river lane structure, car/log/turtle scale, lane speed readability, and water/road split.
- Smoothed frog position over a grid-based plan.
- Raft carry behavior, safe lily/home goals, and crossing strategy.
- Lane pulses and vehicle/log music reactivity without stretching sprites.

Extraction map:

- `definition`: lanes, hazards, rafts, homes, collisions, carry rules, progress/death/home events.
- `behavior`: next-lane planning, timing gaps, raft targeting, home selection, safe retreat.
- `reactions`: beat lane pulses, bass traffic pressure, treble water shimmer, phrase palette shift, idle lane drift.
- `renderer`: road, river, logs, turtles, cars, frog sprite, home row, subtle CRT effects.

Risks:

- Mobile resizing stretching cars/logs instead of preserving aspect ratio.
- Replacing lane timing with random obstacle motion.
- Making the frog move continuously in a way that no longer reads as Frogger.

## Bomberman

Preserve:

- Tile maze, solid blocks, soft blocks, bombs, fuse timing, flame cross, powerups, and exit logic.
- Safety-aware pathfinding around blasts.
- Rival bombermen mode and enemy spacing.
- Beat pulse, phrase flash, and explosion effects while keeping blast rules deterministic.

Extraction map:

- `definition`: tile map, blocks, bombs, flames, powerups, exit, collision/blast rules, score/progress events.
- `behavior`: BFS safety, target soft blocks/enemies/powerups/exit, rival placement and escape logic.
- `reactions`: beat tile pulse, bass blast weight, perc bomb spark, phrase room tint, drop explosion emphasis.
- `renderer`: tilemap, bomber sprites, bombs/flames, soft-block cracks, powerups, exit, rival/enemy sprites.

Risks:

- Allowing blast safety to depend on visual pulse size.
- Spawning rivals/enemies too densely.
- Letting arrays of bombs/flames/effects grow without caps.

## Migration Order

Extract in this order when doing preservation work:

1. Pac-Man, because it proves maze/grid AI and phrase morphing.
2. Tetris, because it proves deterministic board rules and AI planning.
3. Frogger, because it proves lane timing and mobile-safe sprite scaling.
4. Bomberman, because it proves tile safety/pathfinding and capped blast effects.
5. Galaga, because it proves formation choreography and dive-pattern reactivity.

The first pass for each game should be a no-design-change extraction. Improve performance and file boundaries first, then do music-reactivity upgrades in a separate pass with a before/after smoke test.
