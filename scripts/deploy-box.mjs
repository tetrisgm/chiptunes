#!/usr/bin/env node
// scripts/deploy-box.mjs — keep the Oracle broadcaster box in lock-step with the website.
//
// WHY: the live stream (stream.chiptunes.app / Roon) and the website are the SAME deterministic
// broadcast — the box renders the schedule from the same code the browser runs. If the site ships a
// new composer/live/render version but the box stays behind, stream listeners silently drift from
// website listeners. This makes "update the box on every version" automatic instead of a step you
// have to remember. It is IDEMPOTENT: it only rebuilds + restarts the stream when the audio/render
// code actually changed, so it is safe to run on every `npm run deploy` and won't bounce the stream
// for a UI-only change. If the box is unreachable it WARNS but never fails the site deploy.
//
//   node scripts/deploy-box.mjs            # sync; rebuild + restart chiptunes-stream only if code changed
//   node scripts/deploy-box.mjs --check     # dry-run: show what WOULD change, touch nothing
//   node scripts/deploy-box.mjs --force      # rebuild + restart even if nothing changed
//   node scripts/deploy-box.mjs --no-restart # sync + rebuild but don't bounce the running stream
//
// Config (env): CHIPTUNES_BOX=user@host  CHIPTUNES_BOX_PATH=/opt/retro-rave-radio
//               CHIPTUNES_BOX_APPUSER=rrr  CHIPTUNES_STREAM_UNIT=rrr-stream
//
// These defaults are what the box actually runs. They said /opt/chiptunes and
// chiptunes-stream after the project was renamed, neither of which exists
// there, so every deploy rsynced a partial tree into a fresh empty directory
// and restarted a unit that was never defined. The site and the stream have
// been drifting apart ever since.
'use strict';
import { spawnSync } from 'node:child_process';

const BOX = process.env.CHIPTUNES_BOX || process.env.RRR_BOX || '';
if (!BOX) { console.error('[deploy-box] set CHIPTUNES_BOX=user@host'); process.exit(1); }
const REPO = process.env.CHIPTUNES_BOX_PATH || process.env.RRR_BOX_PATH || '/opt/retro-rave-radio';
const APPUSER = process.env.CHIPTUNES_BOX_APPUSER || process.env.RRR_BOX_APPUSER || 'rrr';
const STREAM_UNIT = process.env.CHIPTUNES_STREAM_UNIT || 'rrr-stream';
// The VIDEO LEG, not the guardian. This said rrr-youtube-guardian, which is a
// oneshot timer job that runs for two seconds every three minutes and is
// "inactive" the rest of the time -- so an encoder change restarted nothing and
// the is-active guard below dutifully reported "inactive (skipped)" forever.
// rrr-youtube.service is the long-running unit that owns chrome + ffmpeg.
const YT_UNIT = process.env.CHIPTUNES_YT_UNIT || 'rrr-youtube';
const CHECK = process.argv.includes('--check');
const FORCE = process.argv.includes('--force');
const NO_RESTART = process.argv.includes('--no-restart');
const SSH_OPTS = ['-o', 'ConnectTimeout=10', '-o', 'BatchMode=yes'];

// The audio/schedule + render code that the broadcaster's output depends on. src/ feeds `node
// build.js` -> dist/ (what the broadcaster + video leg serve); broadcast/*.js is the render/encode
// path itself. Anything here changing means the stream must be rebuilt to match the site.
const BROADCAST_FILES = ['broadcast/broadcaster.js', 'broadcast/renderer.js', 'broadcast/node-render.js', 'broadcast/video.js', 'broadcast/youtube-live.mjs'];

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
  // Directories carry no content, and rsync lists them whenever an mtime drifts.
  // Left in, four bare "lib/shaders/..." entries made every --check report
  // "CHANGES pending" and every deploy rebuild dist on a box already in sync.
  const files = (r.stdout || '').split('\n').map((s) => s.trim())
    .filter((s) => s && s !== './' && !s.endsWith('/'));
  return files;
}

// 1. Preflight: is the box reachable? A down box must not fail the site deploy.
const ping = ssh('echo ok');
if (ping.status !== 0 || !String(ping.stdout).includes('ok')) {
  warn(`box ${BOX} unreachable (${(ping.stderr || '').trim() || 'ssh failed'}).`);
  warn('SKIPPED box sync — the website is deployed, but stream.chiptunes.app may now be STALE.');
  warn('Re-run `npm run deploy:box` once the box is back to resync the stream.');
  process.exit(0);
}

// 1b. Snapshot the box's current src/ + broadcast/ + packs/games/ so a bad deploy can be rolled back.
if (!CHECK) {
  const snap = ssh(`sudo rm -rf ${REPO}/.deploy-prev && sudo mkdir -p ${REPO}/.deploy-prev/packs && sudo cp -a ${REPO}/src ${REPO}/broadcast ${REPO}/.deploy-prev/ && sudo cp -a ${REPO}/packs/games ${REPO}/.deploy-prev/packs/ && echo snap-ok`);
  if (!String(snap.stdout || '').includes('snap-ok')) warn('rollback snapshot failed (continuing without rollback safety):', (snap.stderr || '').trim());
}

// 2. Sync EVERYTHING the box's `node build.js` consumes so its dist is IDENTICAL to the site/desktop dist.
// The video leg (YouTube) serves this dist. packs/games/ + the build tooling were previously NOT synced,
// so the box rebuilt STALE game visuals (letterboxed games on YouTube while the site/desktop were current).
const srcChanged = rsync(['src/'], 'src/');
const bcChanged = rsync(BROADCAST_FILES, 'broadcast/');
const packsChanged = rsync(['packs/games/'], 'packs/games/');
const buildChanged = [
  ...(rsync(['build.js'], '') || []),
  ...(rsync(['scripts/game-roster.cjs'], 'scripts/') || []),
];
if (srcChanged === null || bcChanged === null || packsChanged === null) { warn('sync incomplete — site deploy unaffected; fix box access and re-run `npm run deploy:box`.'); process.exit(0); }
const changedFiles = [...srcChanged, ...bcChanged, ...packsChanged, ...buildChanged];
const changed = changedFiles.length > 0;

if (CHECK) {
  if (changed) { log('CHANGES pending (a real run would rebuild dist/ + restart chiptunes-stream):'); changedFiles.forEach((f) => log('   ~', f)); }
  else log('box already in sync — nothing would change.');
  process.exit(0);
}
if (!changed && !FORCE) {
  log('box already in sync — no audio/render code changed; skipping rebuild/restart (stream undisturbed).');
  process.exit(0);
}

// 3. Rebuild dist/ on the box, then restart ONLY what the change actually requires:
//    - AUDIO-affecting change  -> restart the broadcaster (chiptunes-stream), else the stream diverges from the site
//    - ENCODER change (broadcast/video.js) -> restart the video leg (chiptunes-youtube)
//    - purely VISUAL change (game packs, UI) -> restart NOTHING: the video leg hot-reloads its page in place
//      off the rebuilt dist, so the YouTube RTMP feed never drops (viewers see a ~1s repaint, not a reconnect).
//    Conservative by design: any src .js that isn't a known visual-only file counts as audio (never skip a
//    real audio change), preserving the broadcaster<->website sync invariant.
const VISUAL_ONLY_SRC = ['runtime.js', 'shell.html', 'sprites.js', 'presence.js'];
const someMatch = (arr, re) => (arr || []).some((f) => re.test(f));
const audioChanged = (srcChanged || []).some((f) => /\.js$/.test(f) && !VISUAL_ONLY_SRC.some((v) => f.includes(v)))
  || someMatch(bcChanged, /broadcaster\.js|renderer\.js|node-render\.js/)
  || someMatch(buildChanged, /./);   // build tooling can shift the generated audio pack -> be safe
const encoderChanged = someMatch(bcChanged, /video\.js/);
const streamRestart = audioChanged || FORCE;
const legRestart = encoderChanged || FORCE;
log((streamRestart || legRestart)
  ? `code changed (${changedFiles.length} file(s)) — rebuild dist + restart [${[streamRestart && STREAM_UNIT, legRestart && YT_UNIT].filter(Boolean).join(', ')}]…`
  : `visual-only change (${changedFiles.length} file(s)) — rebuild dist; video leg HOT-RELOADS in place, no restart (stream uninterrupted)…`);
const chown = `sudo chown -R ${APPUSER}:${APPUSER} ${REPO}/src ${REPO}/broadcast`;
const build = `sudo -u ${APPUSER} bash -lc 'cd ${REPO} && node build.js'`;
const restartParts = [];
if (streamRestart) restartParts.push(`sudo systemctl restart ${STREAM_UNIT} && echo "restarted ${STREAM_UNIT}"`);
if (legRestart) restartParts.push(`(systemctl is-active --quiet ${YT_UNIT} && sudo systemctl restart ${YT_UNIT} && echo "restarted ${YT_UNIT}" || echo "${YT_UNIT} inactive (skipped)")`);
const restart = NO_RESTART
  ? 'echo "(--no-restart: services keep running old code until next restart)"'
  : restartParts.length ? restartParts.join(' && ')
  : 'echo "content-only: dist rebuilt; video leg hot-reloads its page (no restart, stream uninterrupted)"';
const r = ssh(`${chown} && ${build} && ${restart}`);
process.stdout.write(r.stdout || ''); if ((r.stderr || '').trim()) process.stderr.write(r.stderr);
if (r.status !== 0) { warn(`box rebuild/restart FAILED — stream may be down or on old code. Check: ssh ${BOX} 'journalctl -u ${STREAM_UNIT} -n 50'`); process.exit(1); }

// 4. VERIFY audio only when we actually restarted the broadcaster (a visual-only hot-reload never touches it).
//    Probe the real MP3 output — not just {ok:true}, which lied during the deadlock — and ROLL BACK on silence.
if (streamRestart && !NO_RESTART) {
  const MIN = Number(process.env.CHIPTUNES_WATCHDOG_MIN_BYTES || process.env.RRR_WATCHDOG_MIN_BYTES) || 50000;
  const probe = () => Number(String(ssh('curl -s --max-time 8 http://127.0.0.1:1340/radio.mp3 2>/dev/null | head -c 400000 | wc -c').stdout || '0').trim()) || 0;
  // The render farm (headless Chromium) takes up to ~60s to produce its first
  // MP3 bytes after a restart. An 11-second verify declared a warming stream
  // silent and rolled back a perfectly good deploy; poll with a real budget.
  let bytes = probe();
  for (let waited = 0; bytes < MIN && waited < 90; waited += 6) { ssh('sleep 6'); bytes = probe(); }
  if (bytes >= MIN) {
    log(`stream verified: ${bytes}B of live audio after restart.`);
  } else {
    warn(`stream is SILENT after restart (${bytes}B < ${MIN}) — ROLLING BACK to the previous code.`);
    // ${STREAM_UNIT}, not a hardcoded name: this said chiptunes-stream (the
    // pre-rename unit that does not exist), so no rollback ever actually
    // restarted the broadcaster -- the "restored" stream every rollback
    // reported was the NEW process still running with rolled-back files on
    // disk, an inconsistency a later restart would silently regress into.
    const roll = ssh(`sudo rm -rf ${REPO}/src ${REPO}/broadcast ${REPO}/packs/games && sudo cp -a ${REPO}/.deploy-prev/src ${REPO}/.deploy-prev/broadcast ${REPO}/ && sudo cp -a ${REPO}/.deploy-prev/packs/games ${REPO}/packs/ && sudo chown -R ${APPUSER}:${APPUSER} ${REPO}/src ${REPO}/broadcast ${REPO}/packs/games && sudo -u ${APPUSER} bash -lc 'cd ${REPO} && node build.js' && sudo systemctl restart ${STREAM_UNIT} && echo rolled-back`);
    process.stdout.write(roll.stdout || ''); if ((roll.stderr || '').trim()) process.stderr.write(roll.stderr);
    ssh('sleep 4');
    const after = probe();
    if (after >= MIN) { warn(`ROLLED BACK — stream restored (${after}B). The new code was NOT kept on the box; fix it and re-run \`npm run deploy:box\`.`); process.exit(1); }
    warn(`ROLLBACK ALSO FAILED (${after}B) — stream is DOWN. Investigate: ssh ${BOX} 'journalctl -u chiptunes-stream -n 80'`); process.exit(1);
  }
}
log('box sync complete.');
