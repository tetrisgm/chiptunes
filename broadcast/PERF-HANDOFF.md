# Codex work order — broadcaster performance refactor

**Goal:** cut the broadcaster's CPU + RAM by eliminating the headless-Chromium render farm.
Today one audio channel costs **~1.65 cores** and **~370 MB** — measured as two `headless_shell`
processes at ~83% CPU each — which caps a 2-core box at ~2 channels and blocks running the
YouTube video leg + the audio stream on one box. **The entire cost is the offline audio render
running inside headless Chromium.** The `node` broadcaster (3.5%) and `ffmpeg` (2.7%) are trivial.

Owner will run this on **Codex (background)**. This doc is the spec. Do NOT touch `src/live.js`
(the shared clock schedule — it's deployed to the website and must stay byte-identical) or the
website (`src/runtime.js`, `src/audio.js` live playback path). This is a broadcaster-only refactor.

---

## Where the cost is
`broadcast/renderer.js` boots a headless Chromium (`playwright`), loads `dist/index.html`, and per
track calls the app's `Audio.Engine.render(score)` (in `src/audio.js`, ~line 166) — an
**OfflineAudioContext** render through the AudioWorklet (`src/lib/generated-synth-worklet.js`) plus
the master chain (voicing EQ → compressor → makeup → brick-wall limiter, must match live init()).
It ships PCM back over a Playwright `exposeFunction` base64 channel. `broadcast/broadcaster.js` then
splices/streams it. Chromium is doing the DSP; that's the ~1.65 cores.

## Primary approach — render in pure Node (drop Chromium)
Port the offline render to **`node-web-audio-api`** (the Rust-backed npm Web Audio implementation),
so `renderer.js` renders PCM in-process with **no browser**. Expected win: the ~1.65-core / 370 MB
`headless_shell` cost collapses to a fraction, letting one 2-core box run all 4 mood channels and/or
the video leg.

**Feasibility gates to resolve FIRST (spike before committing):**
1. Does `node-web-audio-api` support **`AudioWorklet` + `audioWorklet.addModule()`**? The synth is a
   custom `AudioWorkletProcessor` (`src/lib/generated-synth-worklet.js`). If yes, load it unchanged.
   If NOT, the fallback is to run the worklet's DSP directly (it's plain math — wavetables, LFSR
   noise, SVF, echo, sample voices; portable) via a `ScriptProcessor`-style or manual render loop.
2. Does it cover the **master-chain nodes** `OfflineAudioContext`, `GainNode`, `BiquadFilter`
   (peaking + highshelf), `DynamicsCompressor`? These are standard; verify parity of the compressor
   in particular.
3. Reproduce the **offline-render-race fix** (`src/audio.js` ~lines 200–218): `suspend(0)` →
   ping/pong worklet ack → `resume()` → `startRendering()`. Whatever the Node context needs so the
   palette+events are processed before rendering (a mis-order ships pure silence — that bug hit ~40%
   of renders historically).

## The parity bar (non-negotiable — the refactor is done only when these pass)
The new render must be **audibly identical** to the Chromium render. Verify with the EXISTING tools:
- `node scripts/audition-generated-music.js --render` — renders goldens through the harness; the
  per-band RMS / stereo width / drone / peak metrics (`scripts/audio-metrics.js`) must match the
  Chromium render within tolerance. **Add a direct A/B**: render the same ~10 tokens both ways
  (Chromium `Engine.render` vs the new Node path) and assert cross-correlation ≈ 1.0, |RMSΔ| < 0.5 dB.
- The **hard silence gate** (`peak == 0`) stays as a permanent pre-air check in `renderer.js`.
- **`npm run health`** (the new `@stack/health-kit` ladder) stays green — especially
  `audition.music-metrics` and `live.seek-fidelity`.
- Master EQ constants must stay identical to live `init()` (the memory: voicing EQ is duplicated in
  both `init()` and `Engine.render` — keep them in sync).

## Scope + constraints
- **Files:** `broadcast/renderer.js` (the port), maybe a small `broadcast/node-render.js`. Keep the
  `Renderer` public API (`start()`, `render(token, composerId) → {sampleRate, frames, pcm}`, `stop()`,
  the serialization mutex) so `broadcaster.js` is unchanged.
- **Composer:** compile the token via the version-pinned composer id in-process (require
  `src/composer.js` directly in Node — it already `module.exports` — instead of in-page).
- Keep the shared render farm serialized (one render at a time) OR make it concurrent if pure-Node
  renders are cheap enough — but don't regress determinism/quality.
- Target: **2-core ARM (Ubuntu aarch64)** — that's where it runs. Test there or note ARM caveats.
- If `node-web-audio-api` proves infeasible for the worklet, the acceptable fallback is a **direct
  Node port of the worklet DSP** (deterministic, same output) — bigger, but the parity bar is the same.

## Follow-on (SEPARATE, note only — do not do in this pass)
Once the audio renders in Node, the **YouTube video leg** (`broadcast/video.js`) can be unified with
the audio stream: one live `/radio` headless page captures audio+video once and fans out to BOTH
YouTube RTMP and the MP3 stream (`Audio.captureStream()` already exists). That's an architecture
change, not this perf refactor — leave it for a follow-up work order.

## Definition of done
`renderer.js` renders with no `headless_shell` process; `npm run health` green; the A/B parity check
passes; box CPU for one channel drops well below the current ~1.65 cores (measure on the ARM box);
`broadcaster.js` and the stream output are unchanged to listeners.
