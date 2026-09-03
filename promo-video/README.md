# promo-video

Remotion compositions and the capture script that feeds them. Everything here is
generated from the **built site**, so the media can never show a version of the
product that does not exist.

```bash
cd .. && node build.js && cd promo-video   # the compositions shoot dist/
npm run capture                            # stills + a recorded agent session
npm run webmcp                             # out/chiptunes-webmcp.mp4  (the submission video)
npm run thumbnail                          # out/thumbnail.png         (Devpost, 1200x800, 3:2)
npm run logo                               # out/logo.png              (512x512)
npm run render                             # out/chiptunes-promo.mp4   (the older product promo)
```

## What `capture` does

Stills of the landing page, a playing track, the tracker, and `/webmcp` (both
with and without the detection panel open). Then the part that matters:

**It records a real agent session.** A mock model context is installed exactly
as an agent browser installs one, the fifteen WebMCP tools are called through
it, and the page reacts on camera — the toasts, the music, the visuals and the
cartridge export in `agent-session.mp4` are the product working, not a mockup.

Every call is **timestamped against the start of the recording** and written to
`public/timeline.json`. `WebMcp.tsx` places its captions from that file, because
page-load time differs on every capture and positions eyeballed from one
recording are wrong in the next — which showed up as a caption naming one tool
while the app's own toast named another.

## Compositions

| id | what |
| --- | --- |
| `WebMcpDemo` | the WebMCP Challenge submission video. Title, the explainer, the detection probe, then the recorded session with captions. **Silent on purpose** — narration is recorded over it; the script is in `docs/SUBMISSION.md`. |
| `Thumbnail` | Devpost thumbnail, 1200×800 (3:2). |
| `Logo` | 512×512 square mark. |
| `ChiptunesPromo` | the original product promo, three stills and an end card. |
