#!/usr/bin/env node
// scripts/deploy-box.mjs — keep the Oracle broadcaster box in lock-step with the website.
//
// WHY: the live stream (stream.ramine.net / Roon) and the website are the SAME deterministic
// broadcast — the box renders the schedule from the same code the browser runs. If the site ships a
// new composer/live/render version but the box stays behind, stream listeners silently drift from
// website listeners. This makes "update the box on every version" automatic instead of a step you
// have to remember. It is IDEMPOTENT: it only rebuilds + restarts the stream when the audio/render
// code actually changed, so it is safe to run on every `npm run deploy` and won't bounce the stream
// for a UI-only change. If the box is unreachable it WARNS but never fails the site deploy.
//
//   node scripts/deploy-box.mjs            # sync; rebuild + restart rrr-stream only if code changed
//   node scripts/deploy-box.mjs --check     # dry-run: show what WOULD change, touch nothing
//   node scripts/deploy-box.mjs --force      # rebuild + restart even if nothing changed
//   node scripts/deploy-box.mjs --no-restart # sync + rebuild but don't bounce the running stream
//
// Config (env): RRR_BOX=ubuntu@146.235.201.5  RRR_BOX_PATH=/opt/retro-rave-radio  RRR_BOX_APPUSER=rrr
'use strict';
import { spawnSync } from 'node:child_process';

const BOX = process.env.RRR_BOX || 'ubuntu@146.235.201.5';
const REPO = process.env.RRR_BOX_PATH || '/opt/retro-rave-radio';
const APPUSER = process.env.RRR_BOX_APPUSER || 'rrr';
const CHECK = process.argv.includes('--check');
const FORCE = process.argv.includes('--force');
const NO_RESTART = process.argv.includes('--no-restart');
const SSH_OPTS = ['-o', 'ConnectTimeout=10', '-o', 'BatchMode=yes'];

// The audio/schedule + render code that the broadcaster's output depends on. src/ feeds `node
// build.js` -> dist/ (what the broadcaster + video leg serve); broadcast/*.js is the render/encode
// path itself. Anything here changing means the stream must be rebuilt to match the site.
const BROADCAST_FILES = ['broadcast/broadcaster.js', 'broadcast/renderer.js', 'broadcast/node-render.js', 'broadcast/video.js'];

const log = (...a) => console.log('[deploy-box]', ...a);
const warn = (...a) => console.warn('[deploy-box] ⚠', ...a);
function ssh(remoteCmd) {
  return spawnSync('ssh', [...SSH_OPTS, BOX, remoteCmd], { encoding: 'utf8' });
}
// rsync a source spec to the box, returning the list of files it (would) update. --out-format=%n
// prints one line per UPDATED item and nothing for unchanged files, so an empty result == in sync.
function rsync(sources, destSub) {
  const args = ['-az', '--out-format=%n', '--rsync-path=sudo rsync'];
  if (CHECK) args.push('--dry-run');
  const r = spawnSync('rsync', [...args, ...sources, `${BOX}:${REPO}/${destSub}`], { encoding: 'utf8' });
  if (r.status !== 0) { warn(`rsync ${destSub} failed:`, (r.stderr || '').trim() || `exit ${r.status}`); return null; }
  const files = (r.stdout || '').split('\n').map((s) => s.trim()).filter((s) => s && s !== './');
  return files;
}

// 1. Preflight: is the box reachable? A down box must not fail the site deploy.
const ping = ssh('echo ok');
if (ping.status !== 0 || !String(ping.stdout).includes('ok')) {
  warn(`box ${BOX} unreachable (${(ping.stderr || '').trim() || 'ssh failed'}).`);
  warn('SKIPPED box sync — the website is deployed, but stream.ramine.net may now be STALE.');
  warn('Re-run `npm run deploy:box` once the box is back to resync the stream.');
  process.exit(0);
}

// 2. Sync the code and detect whether anything actually changed.
const srcChanged = rsync(['src/'], 'src/');
const bcChanged = rsync(BROADCAST_FILES, 'broadcast/');
if (srcChanged === null || bcChanged === null) { warn('sync incomplete — site deploy unaffected; fix box access and re-run `npm run deploy:box`.'); process.exit(0); }
const changedFiles = [...srcChanged, ...bcChanged];
const changed = changedFiles.length > 0;

if (CHECK) {
  if (changed) { log('CHANGES pending (a real run would rebuild dist/ + restart rrr-stream):'); changedFiles.forEach((f) => log('   ~', f)); }
  else log('box already in sync — nothing would change.');
  process.exit(0);
}
if (!changed && !FORCE) {
  log('box already in sync — no audio/render code changed; skipping rebuild/restart (stream undisturbed).');
  process.exit(0);
}

// 3. Rebuild dist/ on the box and restart the stream (+ the YouTube leg iff it's already live).
log(changed ? `code changed (${changedFiles.length} file(s)) — rebuilding dist/ on the box + restarting the stream…` : 'forcing rebuild/restart…');
const chown = `sudo chown -R ${APPUSER}:${APPUSER} ${REPO}/src ${REPO}/broadcast`;
const build = `sudo -u ${APPUSER} bash -lc 'cd ${REPO} && node build.js'`;
const restart = NO_RESTART
  ? 'echo "(--no-restart: services keep running old code until next restart)"'
  : `sudo systemctl restart rrr-stream && (systemctl is-active --quiet rrr-youtube && sudo systemctl restart rrr-youtube && echo "restarted rrr-youtube" || echo "rrr-youtube inactive (skipped)")`;
const r = ssh(`${chown} && ${build} && ${restart}`);
process.stdout.write(r.stdout || ''); if ((r.stderr || '').trim()) process.stderr.write(r.stderr);
if (r.status !== 0) { warn(`box rebuild/restart FAILED — stream may be down or on old code. Check: ssh ${BOX} 'journalctl -u rrr-stream -n 50'`); process.exit(1); }

// 4. Confirm the stream came back on-air.
if (!NO_RESTART) {
  const h = ssh('curl -s --max-time 6 127.0.0.1:1340/healthz || true');
  const body = String(h.stdout || '').trim();
  if (/"ok"\s*:\s*true/.test(body) || /\bok\b/.test(body)) log('stream healthy after restart:', body);
  else warn('stream health check did not confirm OK (got:', body || '<empty>', '). Verify manually.');
}
log('box sync complete.');
