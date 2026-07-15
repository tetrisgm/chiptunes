# Retro Rave Radio — desktop app

A Wallpaper-Engine-style Steam app: run the generative games + music as an animated **desktop
wallpaper** or in a **window**, pick the **mood/station per screen**, and **download more games from
Steam Workshop**. Ships to Windows / macOS / Linux (+ Steam Deck). Full design: **[PLAN.md](PLAN.md)**.

It **reuses the RRR web bundle** (`../dist`) as the renderer — this is the native shell around it,
built on the steam-kit `client-web-app/electron` reference.

## Status (this pass — Phase 0–2 foundation)
- ✅ **Windowed app** — boots `../dist/index.html?mode=window`, single-instance, best-effort Steam init.
- ✅ **Workshop ingest path** — `RRRNative` bridge (`main.js` + `preload.js`) feeds subscribed Steam
  Workshop pack dirs into the renderer's `src/packs.js` **`workshop` source** (guarded file reads;
  only subscribed install dirs, no path traversal; loads through the existing consent gate).
- ✅ **"Get more games"** — `RRRNative.openWorkshop()` deep-links to the app's Steam Workshop page.
- ⏳ Next: wallpaper mode (per-OS native attach), the 6 Wallpaper-Engine settings panes, tray, per-screen stations, packaging.

## Run it (needs the Steam client running + a display)
```bash
cd desktop
npm install            # electron + steamworks.js (fetches the prebuilt native binding)
npm run check          # syntax check (no display needed)
node ../build.js       # ensure ../dist exists
npm start              # launches the windowed app; steam_appid.txt=480 attaches as Spacewar (no partner account)
```
- With no Steam client: the window still runs; identity + Workshop are simply empty.
- To test Workshop ingest: subscribe an item to **Spacewar's** Workshop, then launch — it appears in
  the library via `packs.js` (behind the consent prompt). Real content needs the partner AppID (owner-blocked).

## Architecture (foundation)
`main.js` (Electron main): single-instance lock → `bootSteam()` (restartAppIfNecessary → init →
~30 Hz runCallbacks) → `BrowserWindow(../dist/index.html?mode=window)` → IPC: `rrr:workshopDirs`
(getSubscribedItems → installInfo), `rrr:readPackFile` (fs, **guarded**), `rrr:identity`,
`rrr:openWorkshop`. `preload.js`: `contextBridge` → `window.RRRNative` (the packs.js contract) +
`window.steam`. The renderer is unchanged RRR.

## Generic vs product
The wallpaper windowing / settings shell / tray / rules engine are **generic** and should be
contributed upstream to `stack/steam-kit/profiles/client-web-app/electron/`. This `desktop/` dir holds
the **RRR-specific** wiring (which dist, the `RRRNative` Workshop bridge, the mood/station catalog).
