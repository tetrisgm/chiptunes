# Bundled fonts

Both are SIL Open Font License 1.1. `OFL.txt` is the full licence and ships with
them, which the licence requires. Neither is a Nintendo typeface and neither
reproduces a trademarked wordmark — they are era-appropriate pixel faces.

| file | family | author |
|---|---|---|
| `press-start-2p.woff2` | Press Start 2P | CodeMan38 |
| `silkscreen.woff2`, `silkscreen-ext.woff2` | Silkscreen | Jason Kottke |

Self-hosted rather than linked from Google Fonts: the Electron app and the
wallpaper run offline, and a webfont that 404s off-network would fall back to a
proportional face and silently undo the whole look.
