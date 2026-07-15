# RRR Desktop — Wallpaper Mode Design Doc (Mac-first)

> Source: a 5-agent research pass (Portal product teardown · macOS live-wallpaper mechanism ·
> settings/UX across Portal+Wallpaper Engine+Plash · differentiation). Comparable app: **Portal**
> (portal.app/mac). Items marked *(unverified)* must be sanity-checked before they become load-bearing.

**Decision posture: QUIET-BY-DEFAULT, LOUD-BY-INVITATION.** At rest RRR is a calm, muted,
battery-aware generative wallpaper that never embarrasses the user in a meeting. One tap away, it
becomes the loudest, most alive thing on any desktop — a playable chiptune radio. That contrast is
the product, and it's a promise Portal structurally cannot make.

Implementation home: `desktop/` (existing Electron app reusing `dist/`).

---

## 1. Portal as our comparable — match / beat

**Match (table stakes):** menu-bar control (station/sound/motion-freeze); behind-icons live
wallpaper + hide-desktop-icons; multi-display **render-once, mirror to all** (3 monitors ≠ 3× cost);
auto-pause when a display is fully obscured by a fullscreen app; one-tap "freeze to still"; **app
volume independent of macOS system volume**; "start on launch"; clean OS-wallpaper restore on
pause/quit.

**Beat:** **Generative/never-repeats** (Portal is a *filmed*, finite 4K–8K nature-loop library — its
loudest complaint is "library too thin for the price"; RRR *generates* infinitely). **Battery
citizenship** (Portal has no auto pause-on-battery / Low-Power-Mode + no published FPS throttle —
*unverified, absence of evidence*). **Audio-as-radio + interactivity (playable games)** — categories
nobody in Mac wallpapers holds. Different *job*, not a Portal-killer: Portal = cinematic calm; RRR =
playful generative chiptune. Complementary.

Portal facts (verified): Mac App Store only, sandboxed (inferred); $12.99/mo · $69.99/yr · $299.99
lifetime; pre-recorded video loops w/ Dolby-Atmos spatial audio; hardware-decoded on Apple Silicon;
zero interactivity.

---

## 2. Mac-first vs Windows-first — **Mac-first**

Owner is on Mac and Portal is the reference (quality bar + taste calls live here). The Mac path is the
hard, differentiated engineering (native NSWindow-level addon, occlusion, notarization); Windows is
comparatively solved — `meslzy/electron-as-wallpaper` (Rust+WinAPI, WorkerW re-parent) is a
maintained attach primitive. **ScreenPlay** is the existence proof that free+OSS+Steam+Workshop+macOS
ships. Linux/Steam Deck is a genuine open risk (X11 root-window re-parent works; **Wayland has no
standard mechanism** — *unverified*); keep **window mode** as the Deck fallback. Windows = fast-follow.

---

## 3. Mac wallpaper-mode implementation (the important section)

### Primary path — Electron `BrowserWindow` + tiny native N-API addon

Built-in `type:'desktop'` is **NOT sufficient**: Electron's `native_window_mac.mm` sets the level to
`kCGDesktopWindowLevel − 1` (−2147483624) — **one band too low** — which on modern macOS can render
*behind* the OS wallpaper (invisible), and it omits `.fullScreenNone`. *(exact 14/15 behavior
unverified — smoke-test on-device.)*

**Recipe (mirrors Plash — the closest sibling, a sandboxed WebView-on-desktop that ships on MAS):**

1. **One `BrowserWindow` per `NSScreen`**, `frame:false`, `hasShadow:false`, `transparent` as needed,
   loading `dist/`.
2. **Native addon `rrr-desktop.node`** (~40 lines `.mm` + `binding.gyp`). `win.getNativeWindowHandle()`
   is a `Buffer` wrapping an **`NSView*`** on macOS (treat as opaque — mis-casting NSView-vs-NSWindow
   has a segfault history), then:
   ```objc
   NSView  *view = *reinterpret_cast<NSView **>(buffer_data);
   NSWindow *win = [view window];
   win.level = (NSWindowLevel)CGWindowLevelForKey(kCGDesktopWindowLevelKey); // −2147483623
   win.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces
                          | NSWindowCollectionBehaviorStationary
                          | NSWindowCollectionBehaviorIgnoresCycle
                          | NSWindowCollectionBehaviorFullScreenNone;   // CRITICAL
   [win setIgnoresMouseEvents:YES];
   ```
   - `.desktopWindow` (−2147483623) = **above the static wallpaper, below the icons** (icons sit at
     `.desktopWindow + 20`).
   - `.canJoinAllSpaces | .stationary | .ignoresCycle` = every Space, unmoved by Mission Control,
     absent from ⌘-Tab.
   - **`.fullScreenNone` is critical** — without it the wallpaper renders over other apps' fullscreen
     Spaces.
3. **JS belt-and-suspenders:** `setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:false})` +
   `setIgnoreMouseEvents(true,{forward:true})`.
4. **Multi-monitor:** reposition/rebuild all windows on the `screen` module's
   `display-added`/`display-removed`/`display-metrics-changed`.
5. **Click-through toggle is load-bearing** (interactivity is the differentiator): flip
   `setIgnoresMouseEvents` off to enter "Play Mode", on to return to passive. Mac constraint: desktop
   icons still intercept clicks over themselves even in Play Mode → Play Mode should bring RRR
   *forward as an overlay* for a deliberate session, not pretend you can play cleanly behind icons.
6. **Build universal** (arm64+x64) via `node-gyp`/`prebuild`; sign every dylib + hardened-runtime for
   notarization.

**Entitlements:** `NSWindow.level` + `collectionBehavior` are **public AppKit** — no special
entitlement, no SIP, no accessibility grant. Plash ships **sandboxed on the Mac App Store**. RRR does
NOT read the user's wallpaper file (it visually replaces it), so the sandbox file-read gotcha doesn't
bite the *window*. *(App-Store review discretion for an Electron desktop-level app is unverified — no
Electron precedent found; Plash's precedent is Swift.)*

### Occlusion & battery pausing — **you must implement this yourself**

Critical: macOS auto occlusion/power-savings **do NOT apply to OpenGL/WebGL** windows — the system
assumes GL windows are always visible, so `NSWindowOcclusionState` will **not** auto-throttle RRR's
`requestAnimationFrame`. In the addon, observe `NSWindow.occlusionState` (AND with
`NSWindowOcclusionStateVisible`; unset ⇒ fully covered), forward a `visible/occluded` event to the
renderer to **stop rAF + suspend the WebAudio graph**. Gate battery/AC via Electron `powerMonitor`
(`onBatteryPower`) / low-power-mode → cap FPS, mute, or pause. Because RRR is a **radio**,
occlusion/battery must also **duck or pause audio** — a concern silent wallpapers never have.

### Fallbacks (robustness order)

1. *Weak:* built-in `type:'desktop'` — only if on-device testing shows it visible (expect it below the
   wallpaper/invisible on 14/15).
2. *Strong:* a thin **Swift host** that owns the desktop `NSWindow` and hosts RRR in a `WKWebView`,
   sidestepping Electron — heavier lift, most robust; literally the Plash architecture. Escape hatch
   if the addon proves fragile across macOS versions.
3. *Universal:* **window mode** (no desktop takeover) — guaranteed fallback for locked-down displays
   and Steam Deck gaming mode.

### Top risks (sanity-check first)

`type:'desktop'` visibility on modern macOS *(unverified — on-device test)* · Plash recipe from
cached/historical reads, repo now source-stripped *(high-confidence, not freshly re-verified)* ·
native-addon NSView-cast fragility + signing every dylib · **interactive-behind-icons input routing =
biggest unknown, treat as a spike** · Wayland/Steam Deck no standard mechanism · App-Store review
discretion for an Electron desktop app *(unverified)*.

---

## 4. Settings spec (v1)  ·  defaults in **bold**  ·  `[LATER]` = fast-follow

**Audio-by-default — DECIDED (owner): audio ON at launch + a persistent menu-bar TOGGLE** to
activate/deactivate sound at any time (not just first-run). RRR is a radio and should sound like one
out of the box; the always-available menu-bar toggle (plus mute-on-battery below) is the escape valve
so it never ambushes a meeting. *(This overrides the research's mute-by-default recommendation.)*

- **Pane 1 — Station & Content:** station/mood (Everything·Mellow·Instrumental·Melodic → **Everything**);
  scenes/games (All-shuffle·pick·single → **All shuffle**); scene cadence (**Follow music**·every-N·lock);
  Workshop packs (**all enabled**; full manager `[LATER]`); skip/regenerate button+hotkey;
  **Live vs Generative** (**Generative** default · Live = same clock-derived broadcast as
  radio.ramine.net via `src/live.js`, zero new infra — "10,000 desktops on the same song").
- **Pane 2 — Displays:** enable per-display (**primary on, others off**); same-on-all vs independent
  (**Same on all**); per-display station/FPS override `[LATER]`.
- **Pane 3 — Audio (signature pane):** master (**on at launch** + persistent menu-bar toggle); volume
  independent of OS (**~40%**); duck-when-other-audio (Keep·Duck·**Mute**, fade not cut); **mute on
  battery** on; audio-only-on-focused-display `[LATER]`; respect Focus/DND `[LATER]`.
- **Pane 4 — Playback & Pause:** pause on fullscreen app (Keep·**Pause**·Stop-free-GPU); pause when
  fully occluded (**on**); battery behavior (**Good FPS + mute**·Lower-FPS-power-saver·Pause) —
  default keeps visuals smooth and only mutes audio; the lower-FPS power-saver is opt-in.
- **Pane 5 — Performance:** FPS cap (24·**30**·60 + battery preset); quality scale (Low·Med·High·**Auto**).
- **Pane 6 — Interaction:** interactive "Play Mode" vs **click-through** (toggle + global hotkey);
  auto-return-to-click-through-after-idle `[LATER]` (30s).
- **Pane 7 — General/System:** launch at login (**off**, first-run prompt); menu-bar controls (**on**);
  restore OS wallpaper on quit/pause (**on**, verify target still exists); window mode (off; first-class
  Deck fallback).

---

## 5. Distribution — **Steam primary · direct-notarized secondary**

- **Steam (Win/Mac/Linux) — PRIMARY.** ScreenPlay proof; native Workshop (RRR already wired);
  cross-platform incl. Deck; no Apple sandbox; existing Electron/Spacewar (appid 480) scaffold. Still
  self-sign + notarize the Mac build for Gatekeeper.
- **Direct download, Developer-ID notarized — SECONDARY.** Full features, no sandbox, fits the
  free-hosting ethos + existing `dist` pipeline.
- **Mac App Store (sandboxed) — OPTIONAL, LATER, STRIPPED.** ⚠️ The sandbox does NOT block the
  desktop-attach *window* (Plash proves it) — it blocks the **Workshop/Steam content pipeline**
  (reading subscribed game folders) and Steam integration. A MAS build is **generative + live-broadcast
  only**. Pursue only for discoverability, never as primary.

---

## 6. Roadmap delta — reordered desktop phases

1. **SPIKE (highest risk first): native `rrr-desktop.node`** — set `.desktopWindow` level +
   collectionBehavior on the `getNativeWindowHandle()` NSView; prove a **visible, behind-icons,
   all-Spaces** window on the owner's *actual* macOS. Kills "is it even visible" + handle-casting.
2. **Occlusion + battery gating** — `occlusionState` → renderer rAF/audio suspend; `powerMonitor`.
3. **Multi-monitor** — one window per `NSScreen`, render-once/mirror, reposition on display events.
4. **Audio pane + audio-on-by-default + persistent menu-bar toggle + duck/mute-on-battery.**
5. **Menu-bar controls + click-through/Play-Mode toggle + hotkey + launch-at-login + wallpaper-restore.**
6. **Station/scene picker absorbing the existing Steam Workshop packs.**
7. **FPS/quality settings pane.**
8. **Direct-notarized Mac build** (Developer ID, hardened runtime, universal, signed dylibs) → ship.
9. **Steam Mac build** on the Spacewar scaffold.
10. **Windows build** via `meslzy/electron-as-wallpaper`.
11. **"Live" shared-broadcast station** as an explicit choice (nearly free — same bundle + `src/live.js`).

**Deprioritized:** windowed-only app as the headline (→ fallback/Deck path); per-monitor overrides,
per-app rules, quiet-hours, opacity, hotkey editor, Focus/DND (all `[LATER]`); MAS carrying the whole
thing (dropped — sandbox blocks Workshop+Steam); Linux/Deck desktop-attach (parked behind window-mode
until Wayland resolved).

---

## 7. Open questions for the owner (recommended defaults)

1. **First target macOS for the addon smoke-test?** → *the owner's current machine; treat that OS as
   the reference.* (Note: owner is on a macOS newer than the 14/15 the research verified against, so
   this test is *more* essential, not less.)
2. **Live shared-broadcast in v1 or fast-follow?** → *ship the plumbing in v1 but keep it a non-default
   station; Generative stays default.*
3. **Build the Swift/WKWebView host as a hedge now?** → *no; keep window-mode as the cheap fallback,
   escalate only if the addon breaks across macOS versions.*
4. **MAS stripped build worth the review overhead?** → *skip for v1; Steam + direct-notarized cover the
   audience without amputating Workshop/Steam.*
5. **Battery default — DECIDED (owner):** *Good FPS + mute audio (keep visuals smooth on battery);
   the lower-FPS power-saver and full-pause are both opt-in settings.*
6. **Pricing** — audience pays $50–70/yr or ~$300 lifetime for polish+audio, but "library thinness" is
   the top complaint, which RRR's infinite generative content answers → *default free (Steam + direct),
   generative/Workshop as the differentiator not a paywall.* Owner call.
