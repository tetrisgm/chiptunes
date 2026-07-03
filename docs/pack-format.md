# rrr-pack@3 — Pack Format Specification

Normative spec for Retro Rave Radio packs. Everything third-party-addable is a
pack: **games** (JS), **music** (data-only), **composers** (JS). One manifest
schema, one loader, one zip layout. A future Steam Workshop item is exactly one
pack folder — no format changes.

The reference validator is `scripts/lib/pack-schema.js` (shared by pack-tools,
build.js, and the runtime loader). Where prose and validator disagree, the
validator wins.

## 1. Manifest (`pack.json`)

Every pack is a folder with a `pack.json` at its root:

```json
{ "schema": "rrr-pack@3",
  "kind": "game" | "music" | "composer",
  "id": "^[a-z][a-z0-9_]{1,31}$",
  "name": "Display Name",
  "version": "1.0.0",
  "author": "...",
  "license": "..." }
```

Plus per-kind fields:

| kind | required | optional |
|---|---|---|
| `game` | `app: {"contract": 3}` | `entry` (`.js`, distribution form), `icon`, `variants`, `permissions: []` |
| `composer` | `entry` (`.js`), `composerV: 3` | — |
| `music` | `decoder: "vgm"\|"gme"\|"openmpt"`, `platform` (label), `layout: "album-archive"\|"loose"`, `tracks` (path) | `albums` (path — required for `album-archive`), `covers` (dir path), `meta` (path) |

Hard rules enforced by the validator:

- `music` packs are **data-only by enforcement**: a `kind:"music"` manifest that
  names an `entry` is rejected outright; nothing from a music pack is ever
  evaluated. Music packs also must not carry `app`/`composerV`.
- `game`/`composer` packs must not carry music fields (`decoder`/`layout`).
- `id` must match the folder name and `^[a-z][a-z0-9_]{1,31}$`.
- Built distribution manifests additionally carry `entryHash`
  (`sha256-<hex>` of the built entry file), written by the shared build routine
  (`scripts/lib/pack-build.js`).

## 2. Game packs

**Authoring form** (what lives in this repo under `packs/games/<id>/` and what
you PR): `pack.json` + the five layer files, loaded in `GAME_LAYER_ORDER`:

```
definition.js  behavior.js  reactions.js  renderer.js  index.js
```

**Distribution form** (what the loader consumes): `pack.json` + a single
`pack.js` — the five layers concatenated in order and wrapped in **one IIFE**
(so top-level `const`s in one pack can't collide with another). Compiled by
`buildGamePack()` in `scripts/lib/pack-build.js`; both `build.js` (first-party)
and `pack-tools` (`game build`) call the same routine, so the two can't drift.

Loader behavior: the entry is evaluated (globals available: `CT_GAMES`,
`VisualizerGame`, `MV`), then the loader asserts `CT_GAMES[id]` exists with
`make`/`frame`. `window.onerror` is captured during eval; on failure the pack
is flagged broken and everything else proceeds. See
`docs/game-pack-authoring.md` for the contract.

## 3. Composer packs

`pack.json` + `entry` (conventionally `composer.js`). The entry registers:

```js
window.CT_COMPOSERS = window.CT_COMPOSERS || {};
CT_COMPOSERS['<id>'] = { V: 3, compile(token) => Score, fingerprint(token) => Fingerprint };
```

Composers are **pure**: no DOM, no WebAudio, no `Math.random`, no I/O — same
token must always yield the same Score (`pack-tools composer validate` checks
this statically). See `docs/composer-pack-authoring.md` for the full contract
and `docs/generated-music-architecture.md` for the engine it drives.

Track tokens minted under a non-default composer carry its id
(`<composerId>.<phrase>-<code8>`); the default composer (`rrr_core`) omits the
prefix. Deep links stay deterministic per composer.

## 4. Music packs

Data-only. Two layouts:

- **`album-archive`** — for sequenced chip formats (VGM, SPC). Each album is a
  single `.tar.zst` archive (`<albumDir>/_album.tar.zst`, zstd magic
  `0x28B52FFD`; `.vgz` inputs are gunzipped to `.vgm` before tar-ing). The pack
  root carries `albums.json`: `[[albumDir, trackCount], …]`. Within-album skips
  are zero-fetch.
- **`loose`** — for tracker formats (mod/xm/it/s3m/med): raw files, addressed
  individually by URL.

`decoder` picks the playback engine: `vgm` → libvgm.wasm, `gme` → libgme.wasm
(SPC), `openmpt` → libopenmpt/chiptune3.

### tracks.json (`rrr-tracks@1`)

```json
{ "schema": "rrr-tracks@1",
  "albums": [ { "dir": "<albumDir, or \"\" for loose>", "title": "...",
                "system"?: "...", "composer"?: "...", "year"?: 1990,
                "cover"?: "path", "bpm"?: 128, "conf"?: 0.8,
                "tracks": [ { "title": "...", "file"?: "...",
                              "len"?: 123.4, "bpm"?: 128, "conf"?: 0.8 } ] } ] }
```

Each track needs `title` or `file`. `bpm`/`conf` come from the pack-tools
`--bpm` analysis (`scripts/lib/bpm-kernel.js`); if absent, the app estimates
tempo lazily in a worker and caches it in IndexedDB.

Optional extras: `covers` (a directory of album art), `meta` (extra JSON shown
inline on album cards — there are no scraped-metadata encyclopedia pages; the
library is the sum of installed packs, nothing more).

## 5. Distribution forms

1. **Served** — a folder under the app's `/packs/` (`dist/packs/<kind>s/<id>/`)
   listed in `/packs/index.json`. This is how first-party games, the `rrr_core`
   composer, and the user's own converted music library are installed.
   GitHub PR → merged pack → served. `dist/packs/` is gitignored except what
   `build.js` publishes.
2. **Zip sideload** — `pack-tools zip <dir>` produces a store-only zip with
   `pack.json` at the zip root. Users drag-drop the `.zip` onto the app (or use
   the Packs panel import button); it is unzipped in a worker into OPFS.
3. **Linked directory** — Chromium only: File System Access directory picker;
   the handle is persisted with a "reconnect" chip. This same interface is the
   future Tauri/Steam Workshop `NativeDirSource`.

## 6. Loader behavior (`src/packs.js`, global `Packs`)

- Sources, in duplicate-id precedence order: **inline** (bundled fallback,
  e.g. the `balloon` game) > **served** (`fetch('/packs/index.json')`) >
  **fsdir** (linked directories) > **opfs** (zip imports). A losing duplicate
  gets state `shadowed`.
- `Packs.init()` runs all sources with `Promise.allSettled` + a 3s/source
  timeout and **never rejects** — the home screen never waits on a broken
  source. Registry, directory handles, and the bpm cache live in IndexedDB
  `rrr-packs`. `navigator.storage.persist()` is requested on first import.
- Served fetches defend against SPA-fallback-200 responses with schema checks
  and magic-byte checks (zstd `0x28B52FFD`, `"Vgm "`, `"SNES-SPC700"`).
- Pack states: `ready` · `disabled` · `needs-consent` · `needs-permission`
  (fsdir handle lost) · `shadowed` · `error`. A corrupted `pack.json`/`pack.js`
  isolates to that pack (error chip in the Packs panel); nothing else breaks.
- Game/composer entries are evaluated with error capture; broken packs are
  skipped by scene rotation and the picker.

API surface: `Packs.init() → Promise`, `list() → PackInfo[]`,
`get(id) → PackHandle | null`, `setEnabled(id, on)`, `importZip(file)`,
`linkDirectory()`, `remove(id)`, `onChange(cb)`, `activeComposerId()`,
`setActiveComposer(id)`.

`PackHandle = { manifest, readFile(rel)→Promise<ArrayBuffer>, readJSON(rel),
fileURL(rel)→Promise<string>, loadGame(), loadComposer(), albums(),
tracksIndex() }`.

`PackInfo = { id, kind, name, version, author, source, state, error?,
manifest }` with `source: 'inline'|'served'|'fsdir'|'opfs'`.

## 7. Trust model

- **Music packs run no code, ever** — rejected at the manifest if they try.
  No consent needed.
- **Sideloaded game/composer packs are code with full access to the app.** On
  first enable the user sees one plain consent confirm ("this pack runs code
  with full access to the app"); the answer is persisted. There is no
  hash-pinning or sandboxing apparatus today — the `permissions: []` manifest
  field is reserved for a future sandbox tier.
- Size caps and defensive parsing apply to everything the loader reads.
- The app itself ships **zero copyrighted content**. Music packs built from
  commercial rips are the user's own business, kept local; do not PR them.

## 8. Steam Workshop mapping (future, format-frozen)

A Workshop item = one pack folder, exactly as specified here. The desktop
(Tauri) shell adds a `NativeDirSource` implementing the same interface as
today's linked-directory source, pointed at the Workshop content directory.
Subscribe = the folder appears; unsubscribe = it disappears. `pack.json` `id`,
`version`, `author`, `license` map to Workshop item metadata. Nothing about
the format changes between web sideload today and Workshop later.
