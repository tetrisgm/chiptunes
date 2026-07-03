# Composer Packs

The generator is replaceable: a composer pack is a pure JS module —
`CT_COMPOSERS[id] = { V:3, compile(token)→Score, fingerprint(token)→Fingerprint }`
— that writes the endless radio. No DOM, no WebAudio, no `Math.random`; same
token → same Score, always. The active composer is picked in the Packs panel;
the radio queue ranks candidate tracks by *your* `fingerprint`.

**The reference implementation is `rrr_core`** (`src/composer.js`): the app's
bundled default, published at build time to `dist/packs/composers/rrr_core/`
as an ordinary pack through the same registry. Study its six seeded stages
(palette → groove → harmony → motifs → arrangement → compile) before writing
your own.

## Workflow

```bash
node scripts/pack-tools.js composer scaffold my_comp --name "My Composer"
#   -> packs/composers/my_comp/{pack.json, composer.js}
node scripts/pack-tools.js composer validate packs/composers/my_comp
node scripts/pack-tools.js zip packs/composers/my_comp
```

Sideload the zip (drag onto the app — composer packs are code, so users see a
one-time consent confirm), select it in the Packs panel, press Start Endless
Radio.

## Docs

- `docs/composer-pack-authoring.md` — the contract: compile/fingerprint
  signatures, Score/VoiceDef/PercDef/EchoDef/WEvent schemas, determinism
  rules, how rrr_core is organized, the audition battery.
- `docs/generated-music-architecture.md` — the engine your Scores drive
  (worklet v2 capabilities) and the fingerprint radio queue.
- `docs/pack-format.md` — manifest (`kind:"composer"`, `entry`,
  `composerV:3`), distribution, trust model.

First-party PRs are welcome here if they pass `composer validate` and the
symbolic audition battery (`scripts/audition-generated-music.js` vm-loads any
composer pack).
