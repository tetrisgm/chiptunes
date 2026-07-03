# Music Pack Authoring

How to turn a folder of chip-music rips into an installable Retro Rave Radio
music pack. Music packs are **data-only** (see `docs/pack-format.md` §4/§7) —
you never write code, and the app never runs any from a music pack.

Prereqs: Node, and the system `zstd` binary on PATH
(`brew install zstd` / `apt install zstd`).

## 1. From a folder of rips

Lay your source out as one subfolder per album (game):

```
my-nes-rips/
  Mega Man 2/     *.vgm or *.vgz
  Ducktales/      ...
  loose-mods/     (tracker files can also sit loose at the top level)
```

Then:

```bash
node scripts/pack-tools.js music build my-nes-rips \
  --id my_nes --name "My NES Mix" --platform "NES / Famicom" --bpm
```

What it does:

- **Layout is auto-detected** (`--layout auto`): subfolders of VGM/SPC become
  `.tar.zst` **album archives** (`.vgz` is gunzipped to `.vgm` first; raw bytes
  tar'd; `zstd --ultra -19 --long=24`); loose tracker files
  (mod/xm/it/s3m/med) become a **loose** pack.
- **Decoder is auto-detected** (`--decoder auto`) from file magic/extensions:
  `vgm` (libvgm), `gme` (SPC → libgme), `openmpt` (trackers). Override if the
  guess is wrong.
- **Metadata**: track titles and lengths are read from VGM **GD3** and SPC
  **ID666** tags into `tracks.json` (`rrr-tracks@1`).
- **`--bpm`**: renders ~30s of each track through the shipped decoders
  (`dist/lib/libvgm.js`/`libgme.js`) and estimates tempo with
  `scripts/lib/bpm-kernel.js`, writing `bpm`/`conf` per track. Slower, but the
  app then beat-syncs games without analysing on first play. Tune with
  `--seconds N`.
- Writes `pack.json` (`rrr-pack@3`, `kind:"music"`), `albums.json` (for
  album-archive layout), `tracks.json`, and the archives, to `--out` (default
  `dist/packs/music/<id>/`).

Other flags: `--author`, `--license`.

## 2. Covers and extra metadata

- Put album art in a `covers/` directory inside the pack and reference each
  file via the album's `cover` field in `tracks.json` (the builder carries
  covers over automatically when converting the existing library).
- An optional `meta` JSON file can add per-album fields (`system`, `composer`,
  `year`). Whatever is there shows inline on album cards — there are no
  metadata-scraping pipelines or encyclopedia pages anymore.

## 3. Converting a library in the app's legacy served layout

If you have a library in the pre-pack layout
(`<plat>/<album>/_album.tar.zst` + `albums.json` + `games.json`):

```bash
node scripts/pack-tools.js music convert-chip <distChipDir> --out dist/packs/music
# subset / smoke:
node scripts/pack-tools.js music convert-chip <distChipDir> --out /tmp/packs --only nes,amiga --limit 3
```

This is the FAST path: existing archives are hardlinked/copied (no
recompression), `games.json` + `track-db.json`/`track-tempo.json` are merged
into `tracks.json`, and covers are carried over. Produces one pack per
platform: `nes gameboy genesis snes turbografx neogeo neogeopocket` +
`amiga demoscene keygen` (loose).

## 4. Validate, zip, install

```bash
node scripts/pack-tools.js validate dist/packs/music/my_nes
node scripts/pack-tools.js zip dist/packs/music/my_nes        # -> my_nes.zip
```

Install options (see `docs/pack-format.md` §5):

- **Drag the `.zip` onto the app** (or Packs panel → Import pack). Stored in
  browser OPFS; works in Chrome and Safari.
- **Packs panel → Link packs folder** (Chromium): point at a directory of
  pack folders; edits on disk show up on reload.
- **Serve it**: drop the pack folder under the server's `/packs/` and list it
  in `/packs/index.json` (this is how your own converted library is installed
  locally — `dist/packs/` is gitignored).

Do **not** PR music packs to the repo: the repo ships zero copyrighted
content. Share packs as zips at your own discretion and risk.
