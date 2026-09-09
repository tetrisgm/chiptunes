# Phase C: stock hydra-synth evaluation

2026-09-09. **Close the Phase C renderer choice on the bounded native Canvas
language; leave stock Hydra unadopted.** Hydra's small-graph hardware performance
passed this probe. Its application-realm effects, resource lifecycle and
licensing require adaptation/review. Main reports passing native Canvas browser
and native Safari checks; this report evaluates only the Hydra candidate.

Tested unmodified upstream source at
[`9d29a9f4fd8f9081b9759943f38db36f05b9a88f`](https://github.com/hydra-synth/hydra-synth/tree/9d29a9f4fd8f9081b9759943f38db36f05b9a88f),
manifest **1.4.0**, with locked runtime dependencies, entirely inside
`/tmp/chiptunes-hydra-evaluation.x1IBZg`. Used
`npm ci --omit=dev --ignore-scripts --no-audit --no-fund`, isolated npm
configuration/cache, and project esbuild 0.28.2 with the Browserify-style
`global: globalThis` alias required by `right-now/browser.js`.

| Question | Concrete evidence | Decision consequence |
| --- | --- | --- |
| License/dependencies | [Manifest](https://github.com/hydra-synth/hydra-synth/blob/9d29a9f4fd8f9081b9759943f38db36f05b9a88f/package.json): AGPL; [LICENSE](https://github.com/hydra-synth/hydra-synth/blob/9d29a9f4fd8f9081b9759943f38db36f05b9a88f/LICENSE): AGPL v3; app: MIT. Installed 40 packages, including meyda 5.6.3, raf-loop 1.1.3, regl 1.7.0. Fresh bundle: 489,071 bytes unminified / 87,277 gzip. | License review outstanding; no security audit. |
| Canvas/ticks/instances | Two supplied 960×540 canvases, no extra canvases or automatic rAF. Clocks stayed still for 200 ms; manual ticks advanced A/B to 0.30/0.04 s independently. A's color/speed/resize preserved B. Mouse object shared. | [Embedding interface](https://hydra.ojack.xyz/docs/docs/learning/guides/how-to/hydra-in-a-webpage/) works; output independence is not complete isolation. |
| Realm effects | Import exposed `Meyda` and window listeners. With `makeGlobal:false`, construction still evaluated an empty string and added enumerable Array helpers `fast/smooth/ease/offset/fit`; second construction replaced them. Normal-script construction failed under `script-src 'self'`. | [Stock constructor](https://github.com/hydra-synth/hydra-synth/blob/9d29a9f4fd8f9081b9759943f38db36f05b9a88f/src/hydra-synth.js) is not an application-realm sandbox. |
| Audio/capture | `detectAudio:false`: zero AudioContexts/media requests. Defaults nevertheless created one `captureStream(25)` video track and detached video per instance. `enableStreamCapture:false` eliminated these. | Disable capture explicitly. |
| Memory/lifecycle | Each instance: 8 full-size RGBA8 FBO textures, four 1×1 textures, 6 vertex buffers. Stable while ticking; 24 distinct patches grew shaders 4→28, five `hush()` calls grew textures 12→32. `regl.destroy()` cleared tracked resources; no public Hydra destroy. | Texture estimate **15.82 MiB each / 31.64 MiB for two**, plus nominal 1.98 MiB default-framebuffer color each. Depth/MSAA/compositor/driver residency excluded. Editing/reset residency is not bounded by this test. |
| Errors | `osc(NaN).out(o0)` retained the previous green pixels/draw; valid magenta replacement recovered. Errors were console-only; `out()` returned undefined without throwing. Repeated throwing update callbacks were caught while time advanced. | Recoverable case passes; host diagnostics and runaway isolation remain necessary. |
| Actual artifact | **app.1ce49d6d016e.js / Music 67cdfdad0f71**, read-only local hosting using existing Playwright patterns. C5 loop → **3 unique flashes** through an independent event reader; zero duplicates/drops. RMS reached 0.103. Visual failures preserved epoch/activation; **one AudioContext**, no media/provider requests or uncaught page errors. | Existing signals work in a temporary overlay; no shipped-adapter claim. |

Hardware timing: Apple M4, 16 GiB, macOS 27.0 (26A5425a); project Playwright
1.61.1 / Chromium 149.0.7827.55, Node 22.19.0. Headed Chromium with
`--use-angle=metal --enable-gpu` reported **ANGLE Metal Renderer: Apple M4**.
Each case: 30 warm-up + 120 measured frames, `tick(1000/60)`, one active output,
stock four-output/four-source allocations, capture off. Both instances stayed
allocated. Completion measurement includes a 1-pixel readback per active canvas.

| Active instances / graph | All ticks: submission median / p95 | All ticks + finish/readback: median / p95 |
| --- | --- | --- |
| 1 / oscillator | 0.1 / 0.2 ms | 1.8 / 2.5 ms |
| 1 / feedback | 0.1 / 0.2 ms | 2.3 / 4.6 ms |
| 2 / oscillator | 0.1 / 0.2 ms | 2.5 / 3.4 ms |
| 2 / feedback | 0.1 / 0.2 ms | 3.1 / 4.5 ms |

Oscillator: `h.osc(20,.1,1.2).out(h.o0)`; feedback adds rotation, noise modulation
and 85% previous-output blend. Hardware rAF median/p95: **16.7/18.3 ms**, zero
intervals over 25 ms. First/second construction: **497.5/12.0 ms**, single
observations. Readback includes browser/IPC overhead, **not GPU timer-query time**.
Headless Chromium instead selected SwiftShader; two-instance oscillator/feedback
rAF p95 was **33.6/34.2 ms**. Backend selection materially changes the result.

The native dialect must retain bounded syntax/resources and the acknowledged
transport/independent-reader contract in `music-signals.md`. Claim **neither
Hydra/Tidal compatibility nor GPU isolation**. Canvas and separate realms can
share browser graphics infrastructure. Hydra would require license review,
adapted execution boundaries and resource reclamation before reconsideration.

**Untested for Hydra:** native Safari/iOS, context loss/restoration, runaway
programs, multi-output transactional recovery, GPU isolation/resident memory,
long-session behavior, hidden/audience output, speaker latency/underruns, and
tempo/seek/live-replacement mapping. Native Canvas's Safari result does not
transfer to Hydra. No arbitrary user JS, credentials, product dependencies,
build/release/config changes, commits or pushes were involved.

Receipts/scripts/screenshots: `/tmp/chiptunes-hydra-evaluation.x1IBZg`;
`results.json`, `hardware-results.json`, `build-receipt.json`, **csp-results.json**.
The last supersedes an invalid preliminary debugger-evaluation CSP check.
Browsers, capture tracks and the temporary HTTP listener were closed.
