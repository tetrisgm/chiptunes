// Chiptunes.app self-report entry: run the check ladder, emit one health-report@1, record it locally
// (authoritative). Upload to the ingest Worker is a future best-effort step (HEALTH_ENDPOINT).
// Usage: npm run health   (or HEALTH_TRIGGER=postbuild node scripts/health/run.js)
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { runChecks } = require('@stack/health-kit');
const checks = require('./checks.js');
const ROOT = path.join(__dirname, '..', '..');

function git(cmd) { try { return execSync('git ' + cmd, { cwd: ROOT }).toString().trim(); } catch (e) { return ''; } }

(async () => {
  let version = '0.0.0';
  try { version = require(path.join(ROOT, 'package.json')).version || '0.0.0'; } catch (e) {}
  console.log('Chiptunes.app health ladder (' + checks.length + ' checks)…');
  const { report, exitCode } = await runChecks(checks, {
    log: (s) => console.log(s),
    identity: {
      app: 'rrr', channel: 'dev', version,
      build: git('rev-parse --short HEAD') || 'dev',
      sourceCommit: git('rev-parse HEAD'),
      artifact: 'static-web',
      trigger: process.env.HEALTH_TRIGGER || 'manual',
    },
  });

  const dir = path.join(ROOT, 'health');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'latest.json'), JSON.stringify(report, null, 2));

  const m = report.metrics;
  console.log('\nhealth: ' + report.status.toUpperCase() +
    '  (' + m.passed + ' pass / ' + m.warnings + ' warn / ' + m.failed + ' fail / ' + m.skipped + ' skip, ' +
    (m.totalDurationMs / 1000).toFixed(1) + 's)  ->  health/latest.json');
  process.exit(exitCode);
})();
