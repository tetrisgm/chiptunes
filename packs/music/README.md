# Music Packs

**This directory ships no content, and never will.** The app contains zero
copyrighted music; the library you browse in-app is the sum of the music
packs *you* install. Do not commit or PR music content here.

A music pack is pure data (`rrr-pack@3`, `kind:"music"` — the loader rejects
any music manifest that names executable code): a `pack.json`, a
`tracks.json` index, and either `.tar.zst` album archives (VGM/SPC) or loose
tracker files (mod/xm/it/...). Spec: `docs/pack-format.md` §4.

## Get packs

- Import a pack `.zip` — drag it onto the app, or Packs panel → Import.
- Link a folder of packs (Chromium) — Packs panel → Link packs folder.
- Serve them — put pack folders under the server's `/packs/` and list them in
  `/packs/index.json` (locally: `dist/packs/music/`, which is gitignored).

## Build your own

From a folder of your own rips:

```bash
node scripts/pack-tools.js music build ~/rips/nes --id my_nes --name "My NES" --bpm
node scripts/pack-tools.js zip dist/packs/music/my_nes
```

From a library in the app's legacy served layout:

```bash
node scripts/pack-tools.js music convert-chip <distChipDir> --out dist/packs/music
```

Full walkthrough (layouts, tags, BPM analysis, covers, meta):
`docs/music-pack-authoring.md`. Prereq: system `zstd` on PATH.

Packs built from commercial rips are for your own use — redistribute at your
own discretion and risk, never through this repo.
