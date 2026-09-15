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

Production deployment and live WebMCP verification are pending.
