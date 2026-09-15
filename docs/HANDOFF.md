# Chiptunes handoff

## Current work — 2026-09-15

Owner requested restoration of the shipped WebMCP app and deployment to
https://chiptunes.app after moving subsequent work into a separate project.

- Restore target: `76c9df8` (2026-09-03), the deployed WebMCP submission snapshot.
- Original deployment: `bb6f1016-934a-4abe-813f-7d1c335acba2`.
- Later implementation and its historical notes remain in Git at `f779abc`.
- Previous production deployment: `39d9b6b2-1453-4af0-b40f-b24268a87481`
  (source `149217d`).
- Current agent contract retained. Web deployment only.

Verification: original npm test passed through latency. The visible Chromium
screen test twice lost its window; the same screen assertions passed using
headless Chromium on the Mac Metal GPU, without source changes. Remaining
48-song smoke, 14-game smoke, and music-driven audit passed.

Deployed restore commit `18e5376` to Cloudflare Pages:
https://51c853c8.retro-rave-radio.pages.dev (production: https://chiptunes.app).
Live WebMCP verification passed, including all 15 tools, cold orientation,
late-host registration and real tool execution. Production HTML and
`app.a41aa43f43dc.js` match the local restored artifact byte for byte.

No remaining rollback work. Later-work local artifacts (`.algorave-preview/`,
`.env.local`, `.vercel/`, and residual `gateway/`) were left untouched and are
untracked under the restored ignore rules; do not add them to commits.
