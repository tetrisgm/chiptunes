# Chiptunes.app agent contract

## Product

Chiptunes generates finite songs while one bundled game plays:

```text
seed -> src/composer.js -> Score -> src/audio.js -> beat/energy -> bundled game
```

- There is one composer, deterministic schedule, player, shared web artifact,
  and fixed 14-game roster.
- Do not add pack systems, taste models, stations, playlists, or alternate
  composition pipelines to the product. Owner decision 2026-08-09: the
  *offline* GB generator may use candidate selection (generate several,
  keep one); production stays single-path.
- `build.js` creates the artifact used by the website, Electron app, stream, and
  YouTube renderer. Do not fork behavior by SKU.
- `src/composer.js` and `src/live.js` must not use ambient randomness, time,
  DOM, storage, or network state in the musical path.
- Production composes each seed once; fix bad output in the composer rather
  than hiding it behind candidate scoring. Best-of-N curation is allowed only
  in the offline generator (owner decision 2026-08-09), before anything
  reaches the product.
- Songs are finite and hand off without a long silent tail.
- Games consume shared beat/energy information and never compose music.
- Render-parity correlation remains at least `0.995`.
- **The VISUALIZER PACKS carry generic, genre-descriptive names only**
  (`platformer`, `maze`, `blocks`, `dungeon`, `climber`, ...). Never name a
  pack, entity, sprite or palette after a real game, character or company: the
  packs are original code that LOOKS like somebody's game, and a trademarked
  identity on top of that turns the whole repository into a takedown target --
  a DMCA lands on the repo, not the file. Renamed wholesale 2026-08-12 for
  exactly this reason. The two packs cut earlier stay cut --
  `scripts/smoke-games.js` fails the build if a pack with either retired id is
  ever bundled again.
- **This rule is about the packs, not about the music** (owner, 2026-09-02).
  The prompt vocabulary MAY name real games as descriptive style hints -- "in
  the style of X" reads as a genre and a set of composer dials. Two conditions,
  and they are what keep it descriptive rather than a claim of association:
  the reading is stated back to the user ("read as: adventure, major, brisk"),
  and it is never presented as imitation, because nothing here is derived from
  anyone's recordings. `src/reference-styles.js` is the one place those
  mappings live.
- **Generated SONG TITLES still may not land on real cartridge names.** That is
  a different hazard -- a song called "Double Dragon" is passing off, not
  description -- and `BLOCKED` in `src/seed.js` plus `verify-chrome` keep it
  impossible.
- Never delete YouTube videos; make them private through the API.

## Releasing

**Releases and store uploads happen only when the owner asks.** Releasing is a
decision, not a trigger.

- No launchd job, cron entry, CI schedule, file watcher, or git hook may build,
  sign, notarize, publish, deploy, or reinstall this project on its own. Nothing
  ships in response to a commit or a timer.
- Do not install such automation, and do not add a script whose purpose is to
  install one. `scripts/ship.sh` exists as a deliberate, manually invoked
  capability (`npm run ship`) — it is never wired to an automatic trigger.
- Do not reinstall or restart the owner's running desktop app as a side effect
  of development.
- Debug locally. Never diagnose by pushing a build to a store or an update feed;
  a real user receiving a debug build is the failure this rule prevents.

History: a launchd agent (`app.chiptunes.autorelease`, previously
`net.rrr.autorelease`) fired every 5 minutes and on load. Its log records 66
"shipping", 119 "publishing", 141 notarizations and 105 installs between
2026-07-18 and 2026-07-31 — unrequested releases produced by ordinary
development. The agent, its installer and its plist were removed on 2026-08-03.

- GitHub Actions is never used in this repo: no workflow files, secrets, or runners. Verification is merge-gate on the PC Linux lane (stack/runbooks/workflow.md); GitHub is a git host only.
