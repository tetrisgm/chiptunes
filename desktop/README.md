# Chiptunes.app — desktop app

The Electron shell runs the shared Chiptunes.app web build (`../dist`) either in its original window or as a
macOS animated wallpaper. Wallpaper mode creates one non-activating, click-through renderer per
display, behind Finder's desktop icons and across Spaces. It does not fork the web app or its audio
and schedule engines.

## Run

```bash
node ../build.js
cd desktop
npm install
npm start                         # original 1280x800 window
npm run wallpaper                 # menu-bar app + wallpaper on every display
RRR_MODE=wallpaper npm start      # equivalent entry point
RRR_WALLPAPER_FPS=15 npm run wallpaper
```

The menu-bar item can turn the wallpaper on/off, freeze its current frame without stopping the radio,
open the normal radio window, choose a 15/30/60 FPS cap, configure launch at login, and quit. Wallpaper,
freeze, audio, volume, and FPS settings persist in Electron's user-data directory. Without Steam,
identity and Workshop gracefully remain unavailable.

## macOS mechanism

Electron's useful `type: 'desktop'` behavior is retained because it makes the window non-key and adds
`canJoinAllSpaces | stationary | ignoresCycle`. Its built-in level is
`kCGDesktopWindowLevel - 1`, however. On current macOS that is the same layer as WindowManager's
system wallpaper, so ordering can make an Electron renderer disappear after a wallpaper refresh or
display transition.

`native/mac_wallpaper.mm` receives Electron's `NSView*` handle, resolves its `NSWindow`, and moves it
to the public `kCGDesktopWindowLevel` used by Portal and Übersicht. Finder's icon layer is
`kCGDesktopIconWindowLevel`, 20 levels higher. The bridge also reasserts the all-Spaces behavior,
borderless/click-through properties, and observes the public screen-sleep and Low Power Mode
notifications. No private API, accessibility permission, SIP change, or wallpaper-file access is
used.

## Performance behavior

- Normal cap: persisted 15, 30 (default), or 60 FPS.
- Battery: mute audio while keeping the selected FPS; optional Battery Saver caps visuals at 15 FPS.
- Low Power Mode: cap at 12 FPS.
- Fair/serious thermals: cap at 24/15 FPS; critical thermals pause.
- Display or system sleep: stop the renderer frame loop and mute the wallpaper audio; wake reattaches
  the windows and resumes live rendering.
- Only the primary display owns audio. Other displays use the existing silent watch clock, avoiding
  overlapping copies of the radio.
- Fresh installs enable only the primary display. Secondary and newly attached displays stay off until
  explicitly enabled in the control center, avoiding surprise playback on projectors and unnecessary
  renderer/GPU cost. Upgrades preserve the user's existing per-display choices.
- Freeze Motion holds every display's current frame while the audio-owner keeps the radio playing.

When all wallpaper windows are occluded (for example by fullscreen apps), rendering and audio DSP pause;
either becoming visible again resumes them without recreating the renderer.

Display transitions can briefly invalidate Electron's native `NSView` handle while AppKit rebuilds a
window. Native attach failures are contained per display and retried with capped exponential backoff;
an already-attached window keeps its last known-good state, while a first attach stays muted until it
is genuinely visible at the desktop level.

If a wallpaper renderer crashes, is killed by the OS, or fails to load the shared bundle, only that
display is retired and recreated. Repeated failures use a per-display capped backoff so a bad renderer
cannot become a hot crash loop; the replacement keeps the display's audio ownership and station.

## Build and verification

```bash
npm run check
npm run build:native:arm64
npm run test:native
npm run test:desktop
npm run pack:mac                    # signed arm64 .app when a Developer ID is available
npm run dist:mac                    # signed arm64 DMG + ZIP
APP_NOTARY_PROFILE=pp-notary npm run release:mac  # verify, notarize, staple, package, install
```

The native build targets the installed Electron release headers, not the host Node ABI. Packaging
copies the shared `../dist` bundle into `Contents/Resources/web` and unpacks native `.node` files from
ASAR. The app uses public AppKit/CoreGraphics APIs and can be Developer-ID signed and notarized.

Signed releases poll `https://updates.chiptunes.app/latest-mac.yml` through `electron-updater`; unpackaged
development runs disable update checks. The release script installs locally as before, then
`scripts/publish-mac-update.mjs` uploads the immutable versioned ZIP to the `chiptunes-updates` R2
bucket and replaces `latest-mac.yml` last. The tray can check manually and shows when an update will
be applied on quit.

Manual macOS checklist:

- Wallpaper is visible above the system picture and behind Finder desktop icons.
- Desktop icons remain clickable; the wallpaper never becomes key or accepts pointer input.
- Every connected display gets exactly one correctly bounded renderer; hotplug and resolution/scale
  changes relayout without a relaunch.
- The wallpaper follows normal Spaces and does not overlay fullscreen application content.
- Battery/Low Power Mode lower the effective FPS; display sleep pauses and wake restores rendering.
- The menu-bar toggle destroys/recreates all wallpaper windows, launch-at-login persists, and Quit
  leaves no Electron desktop-level window.
- `npm start` still opens the original interactive window and can coexist with wallpaper mode.

## Distribution and sandbox note

Arbitrary public `NSWindow.level` values are not categorically forbidden by App Sandbox; Plash is a
Mac App Store counterexample. A MAS build would still require App Sandbox and would conflict with
Chiptunes.app's current Steam/Workshop model because subscribed pack folders are outside the app container.
Steam or Developer-ID/notarized direct distribution remains the intended full-feature path. App
Store review policy is a separate product-review risk, not a window-level entitlement limitation.
