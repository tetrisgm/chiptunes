# Contributing

Issues and pull requests are welcome.

## Reporting a song

Every track is reproducible from its link. Press **share** in the player and
paste the link into the issue — it carries the seed and, for edited songs, the
whole document, so the exact thing you heard can be played back.

## Running it

```sh
npm install
node build.js
python3 scripts/serve.py 8099
```

Then open <http://localhost:8099>.

## Before you open a pull request

```sh
npm test
```

Green tests are the gate. A few things the tests enforce, so they are worth
knowing before you write code:

- **The composer is deterministic.** `src/composer.js` and `src/live.js` must
  not read the clock, the DOM, storage, the network, or unseeded randomness.
  The same seed has to produce the same song on every machine, forever.
- **One composition path.** No pack systems, taste models, stations, playlists,
  or alternate pipelines — production composes each seed once.
- **Game packs carry generic, genre-descriptive names.** `platformer`, `maze`,
  `dungeon`. Never a real game, character, or company, in a pack id, a sprite,
  a palette, or any string that reaches the screen.
- **Render parity.** The offline renderer and the live player must stay
  correlated at 0.995 or better; `npm test` checks it.

`AGENTS.md` has the longer version.
