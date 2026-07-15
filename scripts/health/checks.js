// RRR's reliability check ladder for @stack/health-kit — wraps the existing smoke/verify/audition
// harnesses into unit / smoke-integration / reliability / eval checks that each emit a
// health-report@1 result. This is the RRR-specific adapter; the runner + schema are the shared kit.
'use strict';
const path = require('path');
const { commandCheck } = require('@stack/health-kit');
const ROOT = path.join(__dirname, '..', '..');
const NODE = process.execPath;

// a precondition-absent signature (no Chromium / no Web Audio in this env) => the check SKIPS, not fails.
const PW_ABSENT = (o) => /Executable doesn't exist|Please run.*playwright install|OfflineAudioContext\/AudioWorklet unavailable|browserType\.launch/i.test(o);

function check(id, category, script, args, o = {}) {
  return commandCheck(id, category, NODE, [path.join(ROOT, 'scripts', script)].concat(args || []),
    Object.assign({ cwd: ROOT, skipIf: PW_ABSENT }, o));
}
const num = (o, re) => { const m = String(o).match(re); return m ? +m[1] : undefined; };

module.exports = [
  // build the artifact first — everything downstream loads dist/ through the real loader
  commandCheck('build.artifact', 'unit', NODE, [path.join(ROOT, 'build.js')], {
    cwd: ROOT, timeoutMs: 60000, parse: (o) => { const b = num(o, /index\.html:\s*(\d+)\s*bytes/); return b ? { bundleBytes: b } : {}; },
  }),

  // ---- unit: pure, deterministic, content-blind round-trips of real product code ----
  check('seed.determinism', 'unit', 'smoke-generated-seeds.js', [], { timeoutMs: 120000,
    parse: (o) => { const u = num(o, /(\d+) unique/); return u ? { uniqueTokens: u } : {}; } }),
  check('live.schedule-determinism', 'unit', 'smoke-live-schedule.js', [], { timeoutMs: 60000,
    parse: (o) => { const d = num(o, /(\d+) duration matches/); return d ? { durationMatches: d } : {}; } }),
  check('packs.valid', 'unit', 'validate-game-pack.js', ['--all'], { timeoutMs: 60000,
    parse: (o) => { const n = num(o, /passed for (\d+) packs/); return n ? { packs: n } : {}; } }),
  check('games.music-driven', 'unit', 'audit-music-driven.js', [], { timeoutMs: 60000,
    parse: (o) => { const n = num(o, /passed for (\d+) games/); return n ? { games: n } : {}; } }),

  // ---- smoke-integration: boot the real artifact, exercise every surface, isolate corrupt input ----
  check('packs.load-and-corrupt-isolation', 'smoke', 'smoke-games.js', [], { timeoutMs: 150000,
    parse: (o) => { const n = num(o, /(\d+) packs loaded/); return n ? { packsLoaded: n } : {}; } }),

  // ---- reliability: two independent contexts converge on the shared live schedule ----
  check('live.two-browser-sync', 'reliability', 'verify-live-sync.js', [], { timeoutMs: 150000,
    parse: (o) => { const d = num(o, /Δ([\d.]+)s\)/); return d != null ? { offsetDeltaSec: d } : {}; } }),

  // ---- eval-with-metrics: render real audio, score vs thresholds ----
  check('live.seek-fidelity', 'eval', 'verify-live-seek.js', ['5'], { timeoutMs: 300000,
    parse: (o) => { const c = num(o, /corr>=([\d.]+)/); return c != null ? { minCorrGate: c } : {}; } }),
  check('audition.music-metrics', 'eval', 'audition-generated-music.js', ['--seeds', '40'], { timeoutMs: 120000 }),
];
