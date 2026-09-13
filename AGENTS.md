# Chiptunes

Finite songs accompany a fixed 14-game roster: seed → `src/composer.js` → Score → `src/audio.js` → shared beat/energy → game.

- One composer, deterministic schedule, player, and `build.js` artifact across website, Electron, stream, and YouTube. No SKU forks, pack systems, taste models, stations, playlists, or alternate production composition pipelines.
- No ambient randomness, time, DOM, storage, or network state in the musical path of `src/composer.js` or `src/live.js`. Compose each seed once; fix bad output in the composer. Best-of-N selection is allowed only in the offline GB generator.
- Songs finish without long silent tails; games consume beats/energy, never compose. Render-parity correlation ≥ `0.995`.
- Visualizer packs/entities/sprites/palettes use generic genre names, never real games, characters, or companies. Retired packs stay excluded (`scripts/smoke-games.js`).
- Music prompts may name games as descriptive style hints, mapped only in `src/reference-styles.js`. State the interpreted musical attributes to users; never claim imitation or derived recordings.
- Generated song titles cannot match real cartridge names (`BLOCKED` in `src/seed.js`, `verify-chrome`).
- Never delete YouTube videos; make them private through the API.
- Release/store upload only when asked. `scripts/ship.sh` (`npm run ship`) stays manually invoked. No automatic build/sign/notarize/publish/deploy/reinstall jobs, commit triggers, or installers for them. Do not restart or reinstall the owner's app as a development side effect. Debug locally, never through stores/update feeds.
- No GitHub Actions workflows, secrets, or runners.
