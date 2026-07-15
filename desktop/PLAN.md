# Retro Rave Radio — Desktop App (Wallpaper-Engine-style Steam app)

## Overview

Build a Windows/macOS/Linux (incl. Steam Deck) desktop app that runs RRR's generative games+music either as an **animated desktop wallpaper** (behind icons, à la Wallpaper Engine) or in a **normal window**, with a Wallpaper-Engine-style **Settings** surface to choose mood/station per screen, and a **Steam Workshop** "get more games" pipeline.

Hard constraints that shape everything:

- **Extend, do not rewrite.** The renderer is the existing RRR web bundle at `/Users/shokunin/dev/mikutap/dist/` (built by `build.js`; the runtime lives in `src/runtime.js`, packs load via `src/packs.js`). The Electron shell is the steam-kit reference at `/Users/shokunin/dev/stack/steam-kit/profiles/client-web-app/electron/` — a complete Steam bootstrap + `window.steam` bridge we point at RRR's `dist/` and layer new windows/IPC onto.
- **Generic-vs-product boundary** from the steam-kit stays intact: anything product-agnostic (Steam bootstrap, `window.steam` bridge, wallpaper windowing, settings shell, tray) belongs upstream in steam-kit; anything RRR-specific (which dist, the `workshop` pack source, pack.json↔tag contract, the mood/station catalog) lives in mikutap.
- **No single cross-platform "be the wallpaper" API exists.** Native shims are unavoidable on Windows and macOS; Linux is X11-only via an EWMH hint; Wayland and Steam Deck Game Mode fundamentally can't host a foreign wallpaper window.

The app has **three surfaces** mirroring Wallpaper Engine 1:1:
1. **Windowed browser/preview** — the RRR shell in a normal `BrowserWindow` (library + live preview). Buildable now.
2. **Applied wallpaper render** — one borderless RRR window per monitor, attached to the OS desktop layer. Platform-specific shim.
3. **Settings + tray** — a settings `BrowserWindow` and a tray/menubar presence that keeps the wallpaper alive after the main window closes.

---

## Architecture

Electron **main process** owns all windowing, OS integration, Steam, and persistence. The **renderer** is unchanged RRR `dist/` in every window; a query param / injected global tells each renderer instance which role it plays (`?mode=wallpaper&monitor=1&station=mellow`, `?mode=window`, `?mode=preview`, `?mode=settings`). The renderer already knows how to boot a station from `src/runtime.js` + `src/packs.js`; the shell just feeds it config and listens for control messages.

```
main process
├── steam.js        ← lifted from steam-kit main.js (bootSteam: require→restartAppIfNecessary→init→runCallbacks ~30Hz→overlay flags)
├── windows/
│   ├── window.js       normal windowed mode (1280×800 BrowserWindow, loadFile dist/index.html?mode=window)
│   ├── preview.js      small live render embedded in settings (BrowserView or <webview>)
│   ├── settings.js     settings BrowserWindow (loadFile dist/... ?mode=settings, or a dedicated settings HTML)
│   └── wallpaper.js    ONE borderless, transparent, click-through BrowserWindow per display, attached to desktop layer
├── wallpaper/          per-OS "attach to desktop layer" shims (see next section)
│   ├── win.js   macos.js   linux.js
├── displays.js     screen.getAllDisplays() + display-added/removed/metrics-changed → recreate/reposition wallpaper windows
├── tray.js         tray/menubar: Open, Settings, Pause/Mute/Resume, Change station, Exit
├── rules.js        "other application fullscreen/maximized/focused" watcher → pause/mute/stop actions
├── power.js        battery/AC watcher (powerMonitor) → pause-on-battery
├── store.js        settings persistence (electron-store: per-monitor station, perf, autostart, rules)
├── workshop.js     window.steam.workshopList() → feed packs.js workshop source; watch ItemInstalled_t (Phase 2)
└── ipc.js          renderer control channel (pause/mute/stop/setStation/setFps) + settings read/write
```

**Renderer control channel.** Each wallpaper/window renderer exposes a tiny control API over `preload` (`window.rrr.on('control', …)`) so main can push `pause`/`resume`/`mute`/`unmute`/`stop`/`setStation`/`setFpsCap` without reloading. Map to RRR runtime primitives:
- **Pause** → stop the visual RAF loop **and** suspend the AudioContext / composer worklet (freeze both).
- **Mute** → keep visuals, `gainNode.gain=0` / composer silent (visuals only).
- **Stop (free resources)** → tear down the AudioWorklet + game sim and `win.destroy()` the wallpaper window; recreate on resume (reclaims CPU/GPU/RAM).
- **setFpsCap** → throttle the runtime's RAF (skip-frame to target FPS) + optionally lower particle/shader budget.

**Overlay/compositor flags** (already in steam-kit main.js, keep before `app.ready`): `in-process-gpu`, `disable-direct-composition`, `allowRendererProcessReuse=false`. These make the Steam overlay hookable and are harmless for a per-frame canvas app.

**Single-instance lock** (`app.requestSingleInstanceLock()`): second launch focuses the existing window rather than spawning a duplicate wallpaper stack.

---

## Wallpaper mode per OS

There is no unified API. Keep the renderer identical; only the "attach window to desktop layer" shim differs. All shims take `win.getNativeWindowHandle()`.

### Windows (best supported)
- **Technique:** the WorkerW/Progman trick. `SendMessageTimeout(Progman, 0x052C, 0, 0, …)` spawns a WorkerW behind the icons; `EnumWindows` to find the WorkerW that is sibling to the one hosting `SHELLDLL_DefView`; `SetWindowLong(hwnd, GWL_EXSTYLE, WS_EX_LAYERED)` + `SetParent(hwnd, workerW)` on the Electron HWND. This is Lively Wallpaper's exact method.
- **Native module:** **`meslzy/electron-as-wallpaper`** (maintained, napi-rs Rust addon, prebuilt binaries) — `attach(win, {transparent, forwardKeyboardInput, forwardMouseInput})` / `detach(win)` / `reset()`. Input-forwarding is what makes RRR's tap-to-play **interactive** as a wallpaper (a parented WorkerW child otherwise receives no input).
- **Fallback (no native build step):** replicate the sequence with **koffi** FFI against `user32.dll`. **Never `ffi-napi`** — broken on Electron ≥21 (V8 memory cage).
- **Multi-monitor:** WorkerW is ONE window spanning the whole virtual desktop. Size the Electron window to the virtual-screen bounding box and render each monitor's region ourselves (or, simpler for v1: one attached window per monitor sized to that monitor's bounds — validate WorkerW child clipping). Re-run `attach` on DPI/resolution/hotplug. Always `reset()`/`detach` on exit to avoid orphaned WorkerW + stuck icons. Handle both Win10/Win11 WorkerW layouts (the module already does).

### macOS
- **Technique:** overlay window at a level **between** the desktop picture and the icons. `type:'desktop'` in Electron is a **trap** — it sits at `kCGDesktopWindowLevel-1`, i.e. **below** the wallpaper (invisible). Instead set `NSWindow.level = CGWindowLevelForKey(.desktopWindow)+1` (below `kCGDesktopIconWindowLevel`), `collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]`, and `ignoresMouseEvents`. All **public** Core Graphics/AppKit APIs → stays **notarizable**.
- **Native module:** a small **Obj-C++/Swift N-API addon** (or koffi bridging AppKit/CoreGraphics) that takes the NSWindow handle and sets level + collectionBehavior. Electron alone cannot set a custom NSWindow level. Reference: `thusvill/LiveWallpaperMacOS`.
- **Honesty:** this is an overlay above the picture, **not** a replacement of the system wallpaper or lock screen (those need private APIs; out of scope). A true fullscreen app creates its own Space and covers it — expected. Interactivity is limited (desktop-level windows are non-interactive by design); windowed mode is the interactive path on Mac.

### Linux (X11 only)
- **Technique:** set EWMH `_NET_WM_WINDOW_TYPE = _NET_WM_WINDOW_TYPE_DESKTOP` on the Electron X11 window (the xwinwrap approach; xwinwrap `-fdt`). Electron doesn't expose this hint.
- **How:** (a) a launcher that runs `xprop`/`xdotool`/`wmctrl` on the window id after launch (no compiled addon), or (b) a tiny xcb/Xlib `XChangeProperty` addon, or (c) reparent via `xwinwrap`.
- **Caveat:** KWin (KDE) and Mutter (GNOME) both paint their **own** wallpaper on top, so a foreign desktop-type window can be occluded — best on lightweight X11 WMs. The robust route for KDE is a **Plasma wallpaper plugin** (QML + WebEngineView), like `linux-wallpaperengine`. GNOME is the least cooperative (budget a Shell extension if GNOME must work).
- **Wayland: unsupported for a foreign window.** No client-settable desktop window type, no portable background-layer protocol (`wlr-layer-shell` is wlroots-only, not GNOME/KDE, and Electron can't speak it). Fall back to **XWayland** (run as X11, set the hint — partial under KWin/Mutter) or a compositor plugin. Note KDE Plasma 6.8 drops the X11 session (~into 2027), so this path has a shelf life.

### Steam Deck
- **Game Mode = one fullscreen app.** gamescope is a micro-compositor showing exactly one fullscreen surface with no desktop, no icons, no wallpaper concept. **There is no wallpaper mode in Game Mode.** Ship RRR as a **normal fullscreen app** there (non-Steam shortcut; gamescope fullscreens it). This is windowed/fullscreen mode, not wallpaper mode.
- **Desktop Mode = KDE Plasma**, where wallpaper is a concept. Best delivered as a **Plasma wallpaper plugin** (as above), not a foreign X11 window (Plasma paints over it). SteamOS 3.7 still defaults the desktop session to X11 (Wayland optional).
- **Net Deck story:** Game Mode → fullscreen app; Desktop Mode → optional Plasma-plugin wallpaper. Document this explicitly; don't promise "live wallpaper on the Deck" without the Desktop-Mode qualifier.

---

## Settings spec (Wallpaper-Engine-style, adapted to RRR)

Six panes. Load-bearing primitives to copy verbatim from WE: the **action set** `{Keep running, Pause, Mute, Stop (free resources)}` and the **condition set** `{running, focused, maximized, fullscreen, playing audio}`. Treat exact FPS defaults / quality-preset labels as approximate.

**1) Output / Monitors pane** (WE "Choose Monitor" → RRR output targets)
- Enumerate displays via `screen.getAllDisplays()`; render a monitor-layout picker (bounds, scaleFactor, primary flag).
- Per-monitor **Enable wallpaper** toggle.
- Projection mode: **Station per monitor** (different station each display — default), **Span single station** (one render across all displays — cheapest), **Clone** (mirror one station everywhere).
- Per-target **station/mood** assignment (replaces "pick a file").
- **Apply to all monitors** action + "set as default for new monitors".

**2) Station / Mood selector** (replaces the WE thumbnail-of-a-file grid)
- Pick from RRR's existing channels — **Everything / Mellow / Instrumental / Melodic** (per `src/live.js` / broadcaster) — plus **per-station seed/energy**. Selecting a station == "assign wallpaper to this monitor".
- Game selection combo (which pack/game visual drives the station) sourced from installed packs via `packs.js`.

**3) General pane**
- **Launch on startup**: normal autostart (default) + advanced "high-priority" service variant (flag it as less reliable per WE's own docs).
- **Start minimized to tray/menubar.**
- Language, **display identification** overlay (number each screen), tray-icon show/hide.

**4) Performance pane** (port directly)
- **Playback Quality** preset (Performance↔Quality, or Low/Med/High/Ultra) → scales particle count / shader passes / render resolution in the RRR runtime.
- **FPS cap** slider (default ~30; allow 15–20 for weak HW).
- **Anti-aliasing** (Off/2×/4×/8×) — maps to canvas/devicePixelRatio + MSAA where available.
- **Other-application handling**: three global conditions — **Fullscreen / Maximized / Focused** — each → `{Keep running, Pause, Mute, Stop}`. Default Fullscreen = **Pause** (games auto-pause the wallpaper). Implemented in `rules.js` by polling foreground-window state per OS (Windows: `GetForegroundWindow`/`GetWindowPlacement`; macOS: `NSWorkspace` frontmost + window level; Linux X11: `_NET_ACTIVE_WINDOW`/`_NET_WM_STATE_FULLSCREEN`).
- **Pause/mute per monitor** toggle (keep playing on monitor A while paused on the display the fullscreen app covers). Test the maximized+fullscreen-on-different-monitors matrix — historically buggy in WE.
- **Application Rules**: per-app override list. Pick a running process → condition `{running/focused/maximized/fullscreen/playing audio}` → action `{keep/pause/mute/stop}`. Overrides the global defaults.
- **Battery (laptop/Deck)**: "Pause on battery" via `powerMonitor` (`on-battery`/`on-ac`) — triggers on **unplug** (document this; not Windows Battery Saver). Optional lower-FPS-on-battery profile.

**5) Audio pane**
- Master **Mute** + **volume** for the generative composer.
- **React to system audio** capture toggle (WE recording-device + volume + threshold analog) so visuals react to other apps' sound. **Honesty:** system loopback capture cannot isolate one app — any per-app audio behavior is done via the Application Rules "is playing audio" condition, not stream isolation.

**6) Per-station Properties panel** (right-hand, WE Properties analog)
- Expose station knobs as WE property types: **Color/scheme** (picker), **Volume** (slider), **Playback rate/BPM** (slider), **Alignment/Position/zoom** of the game visual, plus generative sliders — **energy, density, chaos**; **key/scale** (combo), **game-select** (combo); **visual-effect** checkboxes.
- Save as **Presets** (shareable — Workshop Phase 2). Support **"apply to all stations / all new stations"** defaults exactly like WE global properties.

Persist everything in `store.js` (electron-store JSON). Settings changes push over IPC to the live wallpaper renderers without reload where possible.

---

## Workshop ingest

RRR's Workshop == the existing per-pack `.tar.zst` distribution, surfaced through Steam UGC. The steam-kit `window.steam.workshopList()` already returns `{items:[{publishedFileID, title, installPath, sizeOnDisk}], installDirs:[]}` from `getSubscribedItems()`→`getItemInstallInfo()`.

**Ingest flow:**
1. Main calls `workshopList()`; for each installed item take `installInfo(id).folder` (the absolute path — never hard-construct `steamapps/workshop/content/<appid>/…`; users have multiple library drives).
2. Feed each `installPath` into `src/packs.js` as a **`workshop` source** — a thin variant of the existing `fsdir` source: reuse the exact scan-and-load code, add a `SRC_RANK` entry so Workshop packs rank alongside bundled/local packs. `packs.js` already comments that its fsdir source is "the interface a future Tauri/Workshop NativeDirSource fills."
3. Each pack folder carries a **`pack.json`** whose fields map to Workshop **tags/metadata** (game/music/composer type, mood, title). This pack.json↔tag contract is RRR-owned (scaffold/validate reuse from the existing pack tooling).
4. **Consent gate:** run installed Workshop packs through RRR's existing pack **consent/consent-gate** before loading executable/game logic (untrusted UGC). Do not auto-run a newly-installed pack without the gate.
5. **Hot-add (Phase 2):** watch `DownloadItemResult_t` / `ItemInstalled_t` via the runCallbacks pump and inject the pack into the live library without restart. MVP: rescan on app focus / manual "refresh."
6. **"Get more games":** a Browse/Discover/Workshop-equivalent set of tabs in the windowed browser + a **deep-link** to the Steam Workshop (`steam://url/SteamWorkshopPage/<appid>` and the item-details overlay via `steamworks` `activateGameOverlayToWebPage`). Subscribe on Steam → Steam auto-downloads → item appears in Installed → `packs.js` picks it up.

**Publish (Phase 2):** `workshopPublish` is in the target `window.steam` API but absent from today's preload; add `CreateItem`→`StartItemUpdate`→`updateItem`→`SubmitItemUpdate` + the legal-agreement overlay. Presets become shareable Workshop items too.

---

## Distribution

**electron-builder**, three OS targets, but for **Steam** upload the **unpacked app** (target `dir` / `tar.gz`) to a **SteamPipe depot** — Steam runs the executable directly; nsis/dmg/AppImage/deb are only for off-Steam distribution.

- **Windows:** `nsis` (off-Steam) + `dir` depot. Bundle `steam_api64.dll`. `asarUnpack` the `steamworks.js` `.node` and `electron-as-wallpaper` native binary so they can be `dlopen`'d.
- **macOS:** `dmg`+`zip` (off-Steam) + `dir` depot. **Codesign + notarize** with hardened runtime (reuse mac-kit `notarytool`); prefer **universal (x64+arm64)**. Un-notarized `.app` fails Gatekeeper even when launched via Steam. Bundle `libsteam_api.dylib` + the mac wallpaper addon.
- **Linux:** `AppImage`/`tar.gz` (off-Steam) + a **native Linux depot** for the Deck. **Blocker:** a default electron-builder Linux build **won't launch in the default Steam Linux Runtime (soldier)** — Chromium needs `libcups` (`undefined symbol: cupsEnumDests`). Fix by **targeting the `sniper` runtime** and/or **bundling `libcups.so.2`** (and likely more SONAMEs). Bundle `libsteam_api.so`.
- **Steam Deck pragmatic path:** if a native Linux depot is too fragile, ship **Windows-only** and let the Deck run it under **Proton** (Electron runs cleanly under Proton; no Linux depot ⇒ Deck auto-uses Proton). Invest in the native Linux/sniper depot only for a first-class Desktop-Mode/Plasma experience.
- **Steamworks packaging:** ship the redistributable next to the binary; include `steam_appid.txt` **only for dev** (delete for prod — Steam injects the appid). Steam client must be running + account must own the app for `init()`.
- **SteamPipe:** reuse steam-kit's `scripts/steampipe/` VDFs; one depot per OS + the app/launch config; Workshop appid == the app appid.

**Controller / Steam Input (plan from day one):** Electron ≥27 + Steam Input ON breaks `navigator.getGamepads()` — **unavoidable on the Deck** (Game Mode forces Steam Input on). Options: (a) build a **keyboard-navigable UI** (spatial/grid focus, focus-layer stack for modals/dropdowns, Enter/Escape) and ship a **Steam Input keyboard mapping** config; and/or (b) **pin Electron 26.6.10** if you need raw Gamepad API. Recommend (a) as primary. RRR gameplay is mostly tap/point — map controller → pointer via Steam Input.

**Multi-monitor / hotplug:** `screen.getAllDisplays()` after `ready`; subscribe to `display-added`/`display-removed`/`display-metrics-changed` and recreate/reposition wallpaper windows. Watch per-display `scaleFactor` (docked Deck drives an external screen at non-1.0 scale).

---

## Generic (steam-kit) vs RRR (mikutap) split

**Belongs upstream in steam-kit `client-web-app/electron` (product-agnostic):**
- The whole Steam bootstrap (`bootSteam`, overlay flags, ~30 Hz `runCallbacks` pump, `restartAppIfNecessary`, single-instance lock) — already there.
- The `window.steam` contextBridge (`identity`, `webAuthTicket`, `workshopList`, + future `workshopPublish`) — already there minus publish.
- **New generic additions to contribute upstream:** the **wallpaper windowing layer** (per-OS attach shims + per-monitor borderless windows), the **tray/menubar** presence, the **settings shell** skeleton, the **Application-Rules/foreground-watcher** engine, the **battery watcher**, and the **renderer control channel** — all generic to any web app that wants a wallpaper mode.
- Web ticket verifier + `scripts/steampipe/` VDFs — already there.

**Belongs in RRR (mikutap), product-specific:**
- Pointing `STEAM_WEB_APP_DIST` at `dist/` (and injecting `?mode=…&station=…`).
- The `packs.js` **`workshop` source** binding (`installPath` → scan source, `SRC_RANK`).
- The **pack.json ↔ Workshop tag/metadata** contract + scaffold/validate.
- The **mood/station catalog** (Everything/Mellow/Instrumental/Melodic + seed/energy), the station-Properties knob set, and which packs ship in the box.
- The RRR consent gate wiring for UGC packs.
- The real **partner AppID** (⛔ owner-blocked) and the shipped depot config.

---

## Ordered build plan

Everything through Phase 3 is buildable **now against Spacewar AppID 480** (Valve's public test app) with no partner account.

**Phase 0 — Wire the shell to RRR (buildable now).**
1. Copy the steam-kit `electron/` reference into the mikutap repo (or add as a submodule/dep). `npm install` (`electron ^31`, `steamworks.js ^0.4`).
2. Point `STEAM_WEB_APP_DIST=/Users/shokunin/dev/mikutap/dist`; confirm the RRR shell loads in the windowed `BrowserWindow` and a station plays. Verify `window.steam.identity()` / `workshopList()` degrade gracefully with/without a running Steam client.
3. Add `?mode=window` role param + the renderer **control channel** in preload (`pause/mute/stop/setStation/setFpsCap`).

**Phase 1 — Windowed app + Settings + tray (buildable now).**
4. `store.js` (electron-store) + the six settings panes as a settings `BrowserWindow` — start with General (autostart via `app.setLoginItemSettings`), Performance (FPS cap, quality preset), Audio, and the Station selector wired to `packs.js` channels.
5. Tray/menubar (`tray.js`): Open, Settings, Pause/Mute/Resume, Change station, Exit; keep-alive after window close; single-instance lock.
6. `displays.js` + `rules.js` + `power.js` — foreground-app watcher and battery watcher driving pause/mute/stop on the (still windowed) renderer. This is fully testable without wallpaper mode.

**Phase 2 — Workshop load vs Spacewar 480 (buildable now).**
7. Implement the `packs.js` **`workshop` source** + `SRC_RANK`; feed `workshopList().items[].installPath`. Subscribe a test item to Spacewar's Workshop and confirm it loads through the consent gate.
8. "Get more games" tab + Steam Workshop deep-link/overlay.
9. Manual "refresh library"; then hot-add on `ItemInstalled_t`.

**Phase 3 — Wallpaper mode, per OS (buildable now, native modules).**
10. **Windows first** (highest payoff): integrate `electron-as-wallpaper`; per-monitor borderless transparent windows; input-forwarding for interactivity; re-attach on display changes; `reset()` on exit. Wire the Output/Monitors pane (enable-per-monitor, station-per-monitor, span/clone).
11. **macOS**: Obj-C++/Swift N-API addon setting NSWindow level+collectionBehavior; overlay wallpaper; document the "above picture, below icons; not lock screen" limits.
12. **Linux X11**: launcher/addon setting `_NET_WM_WINDOW_TYPE_DESKTOP`; document Wayland=XWayland-fallback.

**Phase 4 — Packaging + Deck.**
13. electron-builder configs for all three OSes; `asarUnpack` native `.node`/wallpaper binaries; bundle Steam redistributables.
14. macOS codesign+notarize (mac-kit notarytool), universal build.
15. Deck: ship the **Windows build under Proton** path first (fullscreen in Game Mode); keyboard-navigable UI + Steam Input keyboard mapping (or pin Electron 26.6.10). Optional native Linux/`sniper` depot with bundled `libcups.so.2` + a Plasma wallpaper plugin for Desktop Mode.
16. SteamPipe depots per OS.

**Phase 5 — ⛔ Owner-blocked (needs the real partner AppID + Steamworks partner account):**
- ⛔ Replace AppID 480 with the real partner AppID; delete `steam_appid.txt` for prod.
- ⛔ Create the Steam **Workshop** for the app; publish the initial pack catalog.
- ⛔ In-app **publish** (`workshopPublish`: CreateItem→StartItemUpdate→updateItem→SubmitItemUpdate + legal-agreement overlay) and shareable Presets.
- ⛔ Store page, depot config finalize, Deck compatibility submission, code-signing certs (Windows EV / Apple Developer ID) provisioning.
- ⛔ Avatar support (steamworks.js has no avatar fn — needs a napi binding extension for `GetMediumFriendAvatar`; steam-kit issue #104).

---

## Risks

- **Electron ≥27 + Steam Input** kills the Gamepad API — unavoidable on the Deck. Mitigate with keyboard-first nav + Steam Input keyboard mapping, or pin Electron 26.6.10 (loses newer Chromium/security fixes). This is the single biggest Deck gotcha.
- **Native Linux Electron won't run in the soldier runtime** (libcups). Either target sniper + bundle libs (fragile, historically needed a Valve engineer to enable the sniper container) or punt to Proton (Windows build). Budget for Proton as the default Deck path.
- **Wayland has no foreign-wallpaper path.** As GNOME/KDE move to Wayland (Plasma 6.8 drops X11 ~2027), the Linux wallpaper story degrades to XWayland or a compositor plugin. Wallpaper mode on Linux is inherently the weakest of the three.
- **macOS overlay ≠ system wallpaper.** Fullscreen apps cover it; no lock-screen. If the owner expects a true system-wallpaper replacement on Mac, that needs private APIs and breaks notarization — out of scope.
- **Windows WorkerW fragility** across Win10/Win11 builds and multi-monitor (single WorkerW over virtual desktop). Orphaned WorkerW / stuck icons if teardown misfires — always `reset()`/`detach`. Rely on the maintained module that handles both layouts.
- **Parented/desktop-level windows are non-interactive by default** — interactivity needs input re-injection (Windows only, via the module); Mac/Linux wallpaper is view-only. Tap-to-play RRR is only fully interactive in windowed mode + on Windows wallpaper.
- **Per-monitor pause with mixed maximized+fullscreen** is historically buggy in WE — test the matrix.
- **We own the Workshop hosting/moderation** (unlike WE, which gets Steam's for free) — but reusing RRR's existing `.tar.zst` + Cloudflare pipeline is the escape hatch; Steam UGC is the primary channel.
- **Generative CPU/GPU cost as a persistent wallpaper** (audio worklet + game sim on every display, always on) — the Stop/Mute/Pause + FPS-cap + quality-preset controls are load-bearing for battery/thermals, especially on the Deck.

## Open decisions

1. **Steam Deck delivery:** Windows-under-Proton (low friction, no wallpaper) vs native Linux/sniper depot (enables Desktop-Mode Plasma wallpaper, high effort). Recommend Proton first, native later.
2. **Electron version:** pin 26.6.10 for raw Gamepad API, or take latest + keyboard-first nav. Recommend latest + keyboard-first.
3. **macOS interactivity:** accept view-only wallpaper, or invest in a windowed-interactive "desktop widget" compromise.
4. **Windows multi-monitor rendering:** one window over the virtual desktop rendering per-region (matches WorkerW reality) vs one attached window per monitor (simpler, needs clipping validation). Recommend prototype both.
5. **Settings UI tech:** reuse RRR's own shell/`shell.html` styling for the settings window, or a separate lightweight settings HTML. Recommend reuse for visual consistency.
6. **Where the wallpaper shims live:** contribute upstream to steam-kit as generic modules (recommended) vs keep in mikutap short-term.
7. **"React to system audio"** on macOS/Linux (loopback capture needs extra permissions/virtual devices) — ship Windows-only initially?
8. **Battery trigger** semantics: on-unplug (WE parity, simple) vs OS battery-saver mode (nicer, more per-OS work).

---

Key paths: renderer bundle `/Users/shokunin/dev/mikutap/dist/`; pack loader `/Users/shokunin/dev/mikutap/src/packs.js` (add the `workshop` source here); channels/schedule `/Users/shokunin/dev/mikutap/src/live.js`; runtime `/Users/shokunin/dev/mikutap/src/runtime.js`; Electron shell to extend `/Users/shokunin/dev/stack/steam-kit/profiles/client-web-app/electron/` (`main.js`, `preload.js`).