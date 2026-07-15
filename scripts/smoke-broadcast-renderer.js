#!/usr/bin/env node
// One-track deployment preflight for the pure-Node broadcaster renderer. This intentionally does
// not import Playwright: success proves the native Web Audio binary + worklet path on the host.
'use strict';

const { Renderer } = require('../broadcast/renderer.js');

(async () => {
  const renderer = new Renderer({ sampleRate: 48000, log: message => console.error(message) });
  await renderer.start();
  try {
    const started = process.hrtime.bigint();
    const rendered = await renderer.render('velvet-tigers-drift-dusk-7k3m9q2x', 'rrr_core');
    if (!rendered || !rendered.frames || !rendered.pcm || !rendered.pcm.length) {
      throw new Error('renderer returned no PCM');
    }
    const elapsed = Number(process.hrtime.bigint() - started) / 1e9;
    const audioSeconds = rendered.frames / rendered.sampleRate;
    console.log(`broadcast renderer smoke ok: ${audioSeconds.toFixed(1)}s audio in ${elapsed.toFixed(2)}s (${(audioSeconds / elapsed).toFixed(1)}x realtime), ${rendered.frames} frames`);
  } finally {
    await renderer.stop();
  }
})().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
