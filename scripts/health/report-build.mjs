// RRR postbuild self-report — the LIGHTWEIGHT sibling of `npm run health`.
//
// The full ladder (scripts/health/run.js) boots dist/ through Playwright and renders real audio — a
// ~72s job you don't want on every build. This collector emits a fast, trigger=postbuild report:
//   • build.attestation  — re-validate the visible version/build/source against an embedded receipt
//   • bundle.size        — the built dist/index.html bytes as a numeric metric (no rebuild)
//   • the FAST unit checks — the deterministic, Chromium-free `unit` subset of the ladder
// then records it locally (authoritative) and BEST-EFFORT POSTs to HEALTH_ENDPOINT.
//
// Opt-in by design: it returns immediately unless HEALTH_ENDPOINT or HEALTH_TRIGGER=postbuild is set,
// so a bare `node build.js` (and `npm run build`) stays instant. A network failure NEVER fails the
// build. Set HEALTH_STRICT=1 to exit non-zero when a check actually fails (for CI gates).
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');

// --- opt-in gate: a bare build must stay instant ---
if (!process.env.HEALTH_ENDPOINT && process.env.HEALTH_TRIGGER !== 'postbuild') process.exit(0);

const kit = require('@stack/health-kit');                                  // runChecks (+ commandCheck via checks.js)
const { attestationResult } = require('@stack/health-kit/attestation/check.js');
const ladder = require('./checks.js');                                     // the full RRR ladder

function git(args) { try { return execFileSync('git', args, { cwd: ROOT }).toString().trim(); } catch (e) { return ''; } }
function pkgVersion() { try { return require(path.join(ROOT, 'package.json')).version || '0.0.0'; } catch (e) { return '0.0.0'; } }

// The embedded build receipt, if the artifact carries one (RRR doesn't ship one yet -> the check
// SKIPS gracefully rather than failing). Looked for in the usual spots.
function loadReceipt() {
  for (const p of [path.join(ROOT, 'dist', 'attestation.json'), path.join(ROOT, 'health', 'attestation.json'),
    process.env.HEALTH_ATTESTATION || '']) {
    try { if (p && fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { /* ignore */ }
  }
  return null;
}

function dirBytes(dir) {
  let total = 0;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) total += dirBytes(p);
      else if (e.isFile()) total += fs.statSync(p).size;
    }
  } catch (e) { /* dist missing -> 0 */ }
  return total;
}

const INDEX_BUDGET_BYTES = 1_200_000;   // warn (not fail) above this — a soft bundle budget

// bundle.size: measure the ALREADY-built dist (postbuild runs after build.js). No rebuild.
const bundleCheck = {
  id: 'bundle.size', category: 'unit',
  run: async () => {
    const indexPath = path.join(ROOT, 'dist', 'index.html');
    if (!fs.existsSync(indexPath)) return { status: 'skip', metrics: { built: 0 } };
    const indexHtmlBytes = fs.statSync(indexPath).size;
    const distTotalBytes = dirBytes(path.join(ROOT, 'dist'));
    const metrics = { indexHtmlBytes, distTotalBytes, budgetBytes: INDEX_BUDGET_BYTES };
    return { status: indexHtmlBytes > INDEX_BUDGET_BYTES ? 'warning' : 'pass', metrics };
  },
};

// build.attestation: content-blind re-validation of the visible identity vs the embedded receipt.
const visible = { version: pkgVersion(), build: git(['rev-parse', '--short', 'HEAD']) || 'dev', sourceCommit: git(['rev-parse', 'HEAD']) };
const attestCheck = { id: 'build.attestation', category: 'unit', run: async () => attestationResult(loadReceipt(), visible) };

// the FAST unit checks: the deterministic, Chromium-free `unit` subset — excluding build.artifact
// (we do NOT rebuild in postbuild) and the heavy smoke/reliability/eval render ladder.
const fastUnit = ladder.filter((c) => c.category === 'unit' && c.id !== 'build.artifact');

const checks = [attestCheck, bundleCheck, ...fastUnit];

(async () => {
  console.log('RRR postbuild self-report (' + checks.length + ' fast checks; trigger=postbuild)…');
  const { report, exitCode } = await kit.runChecks(checks, {
    log: (s) => console.log(s),
    identity: {
      app: 'rrr', channel: process.env.HEALTH_CHANNEL || 'dev', version: visible.version,
      build: visible.build, sourceCommit: visible.sourceCommit,
      artifact: 'static-web', trigger: 'postbuild',
    },
  });

  // record locally FIRST (authoritative; health/ is gitignored)
  const dir = path.join(ROOT, 'health');
  fs.mkdirSync(dir, { recursive: true });
  const local = path.join(dir, 'latest-postbuild.json');
  fs.writeFileSync(local, JSON.stringify(report, null, 2));

  const m = report.metrics;
  console.log('\npostbuild health: ' + report.status.toUpperCase() +
    '  (' + m.passed + ' pass / ' + m.warnings + ' warn / ' + m.failed + ' fail / ' + m.skipped + ' skip, ' +
    (m.totalDurationMs / 1000).toFixed(1) + 's)  ->  health/latest-postbuild.json');

  // best-effort upload — a network error NEVER fails the build (record-then-upload)
  const endpoint = process.env.HEALTH_ENDPOINT;
  if (endpoint) {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 8000);
      const headers = { 'content-type': 'application/json' };
      if (process.env.HEALTH_TOKEN) headers['authorization'] = 'Bearer ' + process.env.HEALTH_TOKEN;
      const res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(report), signal: ctrl.signal });
      clearTimeout(to);
      console.log('postbuild health: uploaded -> ' + res.status);
    } catch (e) {
      console.log('postbuild health: upload skipped (' + (e && e.name || 'error') + ') — local report kept, build unaffected');
    }
  } else {
    console.log('postbuild health: HEALTH_ENDPOINT unset — local-only');
  }

  // non-blocking by default; opt into a hard gate with HEALTH_STRICT=1
  process.exit(process.env.HEALTH_STRICT === '1' ? exitCode : 0);
})().catch(() => process.exit(0));   // never let the reporter fail the build
