// smoke-live-schedule.js — the LIVE shared-broadcast schedule must be a pure, portable
// function of wall-clock time. Verifies (in fresh child processes, so no shared state):
//   1. cross-process determinism: 50 blocks' playlists hash byte-identically
//   2. pinned-namespace regression vectors (an accidental seed-string change breaks every
//      listener's sync with deployed clients — this catches it in CI, not in production)
//   3. API.duration(token) === full-compile duration over 200 tokens (the schedule walks
//      durations; compile() is the engine's truth)
//   4. full-hour coverage: every second of 20 hours resolves with sane offsets, the last
//      track of each block straddles the boundary (no dead air), boundary semantics exact
// Run: node scripts/smoke-live-schedule.js
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');
const ROOT = path.join(__dirname, '..');

function die(msg){ console.error('smoke-live-schedule FAIL:', msg); process.exit(1); }

// ---- 1. cross-process determinism ----
const HASH_SRC = `
const Live = require(${JSON.stringify(path.join(ROOT, 'src', 'live.js'))});
const crypto = require('crypto');
const h = crypto.createHash('sha256');
for (let N = 495000; N < 495050; N++) h.update(JSON.stringify(Live.blockPlaylist(N)));
process.stdout.write(h.digest('hex'));
`;
const h1 = execFileSync(process.execPath, ['-e', HASH_SRC]).toString();
const h2 = execFileSync(process.execPath, ['-e', HASH_SRC]).toString();
if (!h1 || h1 !== h2) die('cross-process playlist hash mismatch: ' + h1 + ' vs ' + h2);

// ---- in-process checks ----
const Live = require(path.join(ROOT, 'src', 'live.js'));
const Song = require(path.join(ROOT, 'src', 'seed.js'));
const API = require(path.join(ROOT, 'src', 'composer.js'));

// 2. pinned regression vectors (namespace 'live:v3:<N>:<i>')
const VECTORS = [
  [493000, 0, 'copper-sirens-whisper-mist-b6jxnr2m'],
  [500123, 5, 'neon-dreamers-chase-echo-hdl8x1mg'],
];
for (const [N, i, want] of VECTORS) {
  const got = Live.mintToken(N, i);
  if (got !== want) die(`regression vector moved: mintToken(${N},${i}) = ${got}, pinned ${want} — the live namespace changed; deployed clients would desync`);
}

// 3. duration() === compile duration
for (let i = 0; i < 200; i++) {
  const tok = Song.mint({ random: Song._mulberry32(Song._hash32('livesmoke:' + i)) });
  const d = API.duration(tok);
  const score = API.compile(tok);
  const full = score.totalBars * 240 / score.bpm;
  if (Math.abs(d - full) > 1e-9) die(`duration mismatch for ${tok}: ${d} vs ${full}`);
}

// 4. coverage + boundary semantics
for (let b = 0; b < 20; b++) {
  const N = 490000 + b * 137;
  const pl = Live.blockPlaylist(N);
  const last = pl[pl.length - 1];
  if (last.start >= Live.BLOCK_SEC) die(`block ${N}: last start past boundary`);
  if (last.start + last.dur < Live.BLOCK_SEC) die(`block ${N}: dead air before boundary`);
  for (let s = 0; s < Live.BLOCK_SEC; s += 7) {
    const r = Live.resolveAt(N * Live.BLOCK_MS + s * 1000 + 500);
    if (r.blockN !== N) die(`block ${N} s=${s}: wrong blockN`);
    if (r.offsetSec < 0 || r.offsetSec > r.dur) die(`block ${N} s=${s}: offset ${r.offsetSec} outside [0,${r.dur}]`);
    if (Math.abs(r.startWallMs / 1000 + r.offsetSec - (N * 3600 + s + 0.5)) > 1e-6) die(`block ${N} s=${s}: wall math drift`);
  }
  const before = Live.resolveAt((N + 1) * Live.BLOCK_MS - 1);
  const atB = Live.resolveAt((N + 1) * Live.BLOCK_MS);
  if (!before.boundary) die(`block ${N}: straddler not boundary-flagged`);
  if (atB.i !== 0 || atB.blockN !== N + 1 || atB.offsetSec > 0.001) die(`block ${N}: hour open wrong`);
  if (before.nextToken !== atB.token) die(`block ${N}: boundary nextToken mismatch`);
  if (before.nextStartWallMs !== (N + 1) * Live.BLOCK_MS) die(`block ${N}: boundary nextStartWallMs wrong`);
}

console.log('smoke-live-schedule ok: cross-process hash', h1.slice(0, 12),
  '| 2 pinned vectors | 200 duration matches | 20-hour coverage + boundaries exact');
