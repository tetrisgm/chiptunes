#!/usr/bin/env node
// youtube-live.mjs — programmatic start/stop/status of the channel's YouTube Live broadcast, so the box
// (or a person) never has to click "Go Live" in Studio again. Pure Node (global fetch, node:http/os/fs) —
// no npm deps, so it runs identically on the Mac and the Oracle box.
//
// SECURITY: this only ever USES an OAuth refresh token the OWNER minted by approving the app once. It never
// handles a password and never performs the consent itself. Creds live in a JSON file (default
// ~/.config/stack/youtube.json, override with YOUTUBE_CREDS) holding { client_id, client_secret,
// refresh_token }. The file is read, never printed.
//
// Commands:
//   node broadcast/youtube-live.mjs auth      # ONE-TIME: owner clicks Allow in the browser -> saves refresh_token
//   node broadcast/youtube-live.mjs status    # show the reusable ingest stream + any active broadcast
//   node broadcast/youtube-live.mjs start     # create a broadcast, bind it to the box's stream, go LIVE
//   node broadcast/youtube-live.mjs stop      # end the active broadcast
// `start` flags: --title "..."  --privacy public|unlisted|private (default public)
'use strict';
import http from 'node:http';
import { exec } from 'node:child_process';
import { readFileSync, writeFileSync, renameSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const API = 'https://www.googleapis.com/youtube/v3';
const OAUTH = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/youtube';
const CREDS_PATH = process.env.YOUTUBE_CREDS || path.join(homedir(), '.config', 'stack', 'youtube.json');
const DEFAULT_TITLE = 'Chiptunes.app 👾 endless generative chiptune radio · 24/7 live';

function die(msg) { process.stderr.write('youtube-live: ' + msg + '\n'); process.exit(1); }
function log(...a) { process.stdout.write(a.join(' ') + '\n'); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const runCommand = (command, timeout = 30000) => new Promise((resolve, reject) => {
  exec(command, { timeout }, error => error ? reject(error) : resolve());
});

function loadCfg() {
  if (!existsSync(CREDS_PATH)) die(`no creds at ${CREDS_PATH}. Create it with {"client_id":"...","client_secret":"..."} from Google Cloud → Credentials → OAuth client ID (type "Desktop app"), then run \`auth\`.`);
  try { return JSON.parse(readFileSync(CREDS_PATH, 'utf8')); }
  catch (e) { die(`creds file ${CREDS_PATH} is not valid JSON: ${e.message}`); }
}
function saveCfg(cfg) {
  mkdirSync(path.dirname(CREDS_PATH), { recursive: true });
  writeFileSync(CREDS_PATH, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
}

async function accessToken(cfg) {
  if (!cfg.client_id || !cfg.client_secret) die('creds missing client_id/client_secret');
  if (!cfg.refresh_token) die('no refresh_token — run `auth` first (owner approves once).');
  const r = await fetch(OAUTH, { method: 'POST', body: new URLSearchParams({
    client_id: cfg.client_id, client_secret: cfg.client_secret, refresh_token: cfg.refresh_token, grant_type: 'refresh_token' }) });
  const j = await r.json();
  if (!r.ok) die('token refresh failed: ' + JSON.stringify(j));
  return j.access_token;
}
async function api(token, method, endpoint, { params, body } = {}) {
  const url = new URL(API + endpoint);
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url, { method, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  // throw (not die): callers like apiTry can soften errors; uncaught ones still exit via the top-level catch
  if (!r.ok) throw new Error(`${method} ${endpoint} -> ${r.status}: ${JSON.stringify(j.error || j)}`);
  return j;
}

// One-time consent via the installed-app loopback flow. The owner clicks Allow in their browser; we capture
// the redirect on localhost and exchange the code for a refresh token. We never touch their password or
// approve on their behalf — that click is theirs.
async function cmdAuth() {
  const cfg = loadCfg();
  if (!cfg.client_id || !cfg.client_secret) die(`put client_id + client_secret in ${CREDS_PATH} first.`);
  const server = http.createServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const redirectUri = `http://127.0.0.1:${server.address().port}`;
  const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: cfg.client_id, redirect_uri: redirectUri, response_type: 'code',
    scope: SCOPE, access_type: 'offline', prompt: 'consent' });
  log('\n1) A browser tab should open; if not, paste this URL:\n\n' + authUrl + '\n');
  log('2) Sign in as the Chiptunes.app channel owner and click Allow. Waiting…\n');
  runCommand((process.platform === 'darwin' ? 'open ' : 'xdg-open ') + JSON.stringify(authUrl), 10000)
    .catch(e => log('could not open a browser automatically: ' + e.message));
  const code = await new Promise((resolve) => {
    server.on('request', (req, res) => {
      const c = new URL(req.url, 'http://127.0.0.1').searchParams.get('code');
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(c ? '<h2>Chiptunes.app: authorized ✓</h2><p>Close this tab and return to the terminal.</p>'
                : '<h2>No code received.</h2>');
      if (c) resolve(c);
    });
  });
  server.close();
  const r = await fetch(OAUTH, { method: 'POST', body: new URLSearchParams({
    client_id: cfg.client_id, client_secret: cfg.client_secret, code, grant_type: 'authorization_code', redirect_uri: redirectUri }) });
  const j = await r.json();
  if (!r.ok || !j.refresh_token) die('token exchange failed (no refresh_token — remove any prior grant + retry): ' + JSON.stringify(j));
  cfg.refresh_token = j.refresh_token;
  saveCfg(cfg);
  const tok = await accessToken(cfg);
  const ch = await api(tok, 'GET', '/channels', { params: { part: 'snippet', mine: 'true' } });
  log(`\n✓ authorized — refresh token saved to ${CREDS_PATH}. Never asks again.`);
  log(`Connected channel: ${ch.items?.[0]?.snippet?.title || '(unknown)'}`);
}

// The reusable ingest stream the box pushes to. Prefer one titled "Default stream", else the first.
async function getStream(token) {
  const j = await api(token, 'GET', '/liveStreams', { params: { part: 'id,snippet,cdn,status', mine: 'true', maxResults: '50' } });
  const items = j.items || [];
  if (!items.length) die('no reusable ingest stream on the channel — set up the "Default stream" in Studio once.');
  return items.find(s => /default/i.test(s.snippet?.title || '')) || items[0];
}
async function broadcastSnapshot(token, streamId) {
  // `active` reliably finds a long-running live even after it falls out of the recent-broadcast page,
  // but EXCLUDES liveStarting (verified 2026-07-17). Use it first, then inspect recent entries for wedges.
  const active = await api(token, 'GET', '/liveBroadcasts', {
    // broadcastStatus and mine are mutually exclusive; the status filter already scopes to our channel.
    params: { part: 'id,snippet,status,contentDetails', broadcastStatus: 'active', maxResults: '50' },
  });
  const live = (active.items || []).find(b =>
    b.status?.lifeCycleStatus === 'live' && b.contentDetails?.boundStreamId === streamId) || null;
  // Always inspect recent broadcasts too: a successful replacement may already be live while the just-ended
  // incident corpse is still public. The guardian cleans that archive on its next healthy tick.
  const j = await api(token, 'GET', '/liveBroadcasts', {
    params: { part: 'id,snippet,status,contentDetails', mine: 'true', maxResults: '50' },
  });
  const recent = j.items || [];
  const items = recent.filter(b => {
    if (!['ready', 'liveStarting', 'testing'].includes(b.status?.lifeCycleStatus)) return false;
    const bound = b.contentDetails?.boundStreamId;
    // An unbound default-title `ready` is our own interrupted create->bind sequence. Never adopt an
    // unrelated scheduled broadcast or one explicitly bound to somebody else's ingest stream.
    return bound === streamId || (!bound && b.status?.lifeCycleStatus === 'ready' && b.snippet?.title === DEFAULT_TITLE);
  });
  items.sort((a, b) => {
    const ab = a.contentDetails?.boundStreamId === streamId ? 0 : 1;
    const bb = b.contentDetails?.boundStreamId === streamId ? 0 : 1;
    if (ab !== bb) return ab - bb;
    const rank = x => x === 'liveStarting' ? 0 : (x === 'testing' ? 1 : 2);
    const ar = rank(a.status?.lifeCycleStatus), br = rank(b.status?.lifeCycleStatus);
    if (ar !== br) return ar - br;
    return Date.parse(b.snippet?.scheduledStartTime || 0) - Date.parse(a.snippet?.scheduledStartTime || 0);
  });
  return {
    live,
    pending: live ? null : (items[0] || null),
    // If YouTube ended the public broadcast while ffmpeg remained wedged, the next guardian tick sees no
    // active/pending broadcast. Carry the latest completed item bound to this ingest into that recovery path
    // so its archived video is made private before a replacement is created. Never DELETE a video/broadcast.
    ended: recent.filter(b => b.status?.lifeCycleStatus === 'complete' &&
      (b.contentDetails?.boundStreamId === streamId || b.snippet?.title === DEFAULT_TITLE))
      .sort((a, b) => Date.parse(b.snippet?.actualEndTime || b.snippet?.scheduledStartTime || 0)
        - Date.parse(a.snippet?.actualEndTime || a.snippet?.scheduledStartTime || 0))[0] || null,
  };
}
async function cmdStatus() {
  const token = await accessToken(loadCfg());
  const stream = await getStream(token);
  const snap = await broadcastSnapshot(token, stream.id), active = snap.live || snap.pending;
  log(`stream: "${stream.snippet?.title}"  ingest=${stream.status?.streamStatus}  (id ${stream.id})`);
  log(active ? `${active.status?.lifeCycleStatus}: "${active.snippet?.title}"  https://youtube.com/live/${active.id}` : 'no active broadcast');
}

async function adoptPending(token, pending, stream) {
  const bound = pending.contentDetails?.boundStreamId;
  if (!bound) {
    await api(token, 'POST', '/liveBroadcasts/bind', { params: { id: pending.id, part: 'id,contentDetails', streamId: stream.id } });
    pending.contentDetails = { ...(pending.contentDetails || {}), boundStreamId: stream.id };
    log(`recovered + bound interrupted broadcast ${pending.id}`);
  }
  log(`adopting pending broadcast ${pending.id} (${pending.status?.lifeCycleStatus})`);
  return goLive(token, pending, stream);
}

async function cmdStart(opts) {
  const token = await accessToken(loadCfg());
  const stream = await getStream(token);
  const snap = await broadcastSnapshot(token, stream.id);
  if (snap.live) { log(`already live: https://youtube.com/live/${snap.live.id}`); return; }
  if (snap.pending) return adoptPending(token, snap.pending, stream);
  const b = await api(token, 'POST', '/liveBroadcasts', {
    params: { part: 'snippet,status,contentDetails' },
    body: {
      snippet: { title: opts.title || DEFAULT_TITLE, scheduledStartTime: new Date().toISOString() },
      status: { privacyStatus: opts.privacy || 'public', selfDeclaredMadeForKids: false },
      // ALWAYS-ON-ENCODER doctrine (learned the hard way):
      // - autoStart OFF: it only fires on an ingest inactive->active EDGE, which a 24/7 push never
      //   produces (YouTube's inactive detection outlasts an encoder restart) — AND while it is on,
      //   manual transitions return invalidTransition. Explicit transition is the reliable path.
      // - monitorStream OFF: otherwise ready->live is rejected (YouTube demands a testing stage).
      // - autoStop OFF: a brief box blip must not end the broadcast (we stop explicitly via `stop`).
      // - latency NORMAL: a 24/7 radio wants jitter-absorbing buffers, not low latency — with 'low', any
      //   ingest/transcode hiccup starves the live edge and every viewer sees a spinner.
      contentDetails: { enableAutoStart: false, enableAutoStop: false, latencyPreference: 'normal', enableDvr: true,
        monitorStream: { enableMonitorStream: false } },
    },
  });
  await api(token, 'POST', '/liveBroadcasts/bind', { params: { id: b.id, part: 'id,contentDetails', streamId: stream.id } });
  log(`broadcast ${b.id} created + bound`);
  return goLive(token, b, stream);
}

// Take a bound broadcast to VERIFIED live: wait for active ingest, pre-roll, transition, poll the
// lifecycle, and bounce the encoder if it wedges. Used by the create path AND to adopt wedged broadcasts
// (for those the transition is a harmless no-op via apiTry — they are already past 'ready').
async function goLive(token, b, stream) {
  log('waiting for the box\'s ingest to go active…');
  let active = false;
  for (let i = 0; i < 40 && !active; i++) {
    const s = await api(token, 'GET', '/liveStreams', { params: { part: 'status', id: stream.id } });
    active = s.items?.[0]?.status?.streamStatus === 'active';
    if (!active) await sleep(3000);
  }
  if (!active) die(`ingest never went active — is the box pushing to the stream key? (stream ${stream.id})`);
  // PRE-ROLL: transitioning the instant the ingest looks active races YouTube's first-segment processing
  // and can wedge the broadcast in 'liveStarting' ("will begin in a few moments", forever). Let the bound
  // ingest run ~20s first, then transition, then VERIFY the lifecycle actually reaches 'live'.
  log('ingest active — 20s pre-roll before transition…');
  await sleep(20000);
  const lifeCycle = b.status?.lifeCycleStatus;
  const transition = { params: { broadcastStatus: 'live', id: b.id, part: 'id,status' } };
  // liveStarting means a prior transition is already in flight. Every earlier state (including testing)
  // still requires a successful transition; hiding that error only turns it into three minutes of polling.
  if (lifeCycle !== 'liveStarting') await api(token, 'POST', '/liveBroadcasts/transition', transition);
  // VERIFY the lifecycle actually reaches 'live'. A broadcast bound to an ALREADY-flowing ingest reliably
  // wedges in 'liveStarting' ("will begin in a few moments", forever): YouTube wants a FRESH RTMP handshake
  // after the bind. The cure, proven live: bounce the encoder while the broadcast waits. YT_BOUNCE_CMD
  // (e.g. "ssh ubuntu@<box> 'sudo systemctl restart chiptunes-youtube'") automates it after ~32s stuck.
  let bounced = false;
  for (let i = 0; i < 45; i++) {
    await sleep(4000);
    const st = (await api(token, 'GET', '/liveBroadcasts', { params: { part: 'status', id: b.id } })).items?.[0]?.status?.lifeCycleStatus;
    if (st === 'live') { log(`✓ LIVE (verified): https://youtube.com/live/${b.id}`); return; }
    if (i % 5 === 4) log(`…lifecycle=${st} (waiting for 'live')`);
    if (!bounced && i >= 8 && st === 'liveStarting' && process.env.YT_BOUNCE_CMD) {
      bounced = true;
      log('stuck in liveStarting — bouncing the encoder (YT_BOUNCE_CMD)…');
      try { await runCommand(process.env.YT_BOUNCE_CMD); } catch (e) { log('bounce failed: ' + e.message); }
    }
  }
  die(`broadcast ${b.id} stuck in liveStarting — bounce the encoder (systemctl restart chiptunes-youtube on the box) and re-check \`status\`; if still stuck, \`stop\` + \`start\` fresh.`);
}

async function cmdStop() {
  const token = await accessToken(loadCfg());
  const stream = await getStream(token);
  const snap = await broadcastSnapshot(token, stream.id), active = snap.live || snap.pending;
  if (!active) { log('nothing live to stop.'); return; }
  const done = await apiTry(token, 'POST', '/liveBroadcasts/transition', { params: { broadcastStatus: 'complete', id: active.id, part: 'id,status' } });
  if (!done) throw new Error(`could not complete broadcast ${active.id}; it was left intact (videos are never deleted)`);
  log(`✓ ended broadcast ${active.id}`);
}

// ---- guardian (`ensure`): self-healing keep-alive, run from a systemd timer on the box ----
// Decision tree (each branch proven by hand on 2026-07-17):
//   ingest not active            -> encoder off/starting: not our job, exit
//   broadcast live               -> healthy, clear state
//   broadcast wedged (<4 min)    -> bounce the encoder (fresh RTMP handshake un-wedges liveStarting)
//   broadcast wedged (>=4 min)   -> cycle: complete+private the corpse, fresh verified go-live
//   no broadcast at all          -> fresh verified go-live
// Flap guard: at most one cycle per 10 minutes (state file survives timer runs).
const STATE_PATH = process.env.YT_GUARDIAN_STATE || '/tmp/chiptunes-yt-guardian.json';
function readState() { try { return JSON.parse(readFileSync(STATE_PATH, 'utf8')); } catch (e) { return {}; } }
function writeState(s) {
  const tmp = STATE_PATH + '.' + process.pid + '.tmp';
  try {
    writeFileSync(tmp, JSON.stringify(s), { mode: 0o600 });
    renameSync(tmp, STATE_PATH);                         // atomic: a killed tick cannot leave partial JSON
  } catch (e) {
    try { unlinkSync(tmp); } catch (e2) {}
    throw new Error(`guardian state write failed (${STATE_PATH}): ${e.message}`);
  }
}
async function apiTry(token, method, endpoint, opts) {
  try { return await api(token, method, endpoint, opts); } catch (e) { return null; }
}
async function privateVideo(token, id) {
  let v = null;
  for (let i = 0; i < 3 && !v; i++) {
    v = (await apiTry(token, 'GET', '/videos', { params: { part: 'status', id } }))?.items?.[0] || null;
    if (!v && i < 2) await sleep(2000);                  // completion can race video finalization
  }
  if (!v) throw new Error(`guardian could not look up completed video ${id} to make it private`);
  if (v.status?.privacyStatus === 'private') { log(`guardian: completed video ${id} already private`); return; }
  // videos.update replaces the mutable status part and rejects read-only fields such as uploadStatus.
  // Preserve writable settings, intentionally drop any old publishAt, and make the corpse private.
  const status = { privacyStatus: 'private' };
  for (const k of ['embeddable', 'license', 'publicStatsViewable', 'selfDeclaredMadeForKids', 'containsSyntheticMedia']) {
    if (v.status?.[k] !== undefined) status[k] = v.status[k];
  }
  await api(token, 'PUT', '/videos', { params: { part: 'status' }, body: { id, status } });
  log(`guardian: completed video ${id} made private`);
}
async function cmdEnsure() {
  const token = await accessToken(loadCfg());
  const stream = await getStream(token);
  if (stream.status?.streamStatus !== 'active') { log('guardian: ingest not active (encoder off/starting) — nothing to ensure'); return; }
  const st = readState(), now = Date.now();
  const snap = await broadcastSnapshot(token, stream.id);
  if (snap.live) {
    if (snap.ended?.status?.privacyStatus !== 'private') await privateVideo(token, snap.ended.id);
    if (st.wedgeSince || st.wedgeId) writeState({ lastCycle: st.lastCycle });
    log('guardian: healthy — live ' + snap.live.id);
    return;
  }
  const cooled = !st.lastCycle || (now - st.lastCycle) > 10 * 60000;
  if (snap.pending?.status?.lifeCycleStatus === 'ready') {
    log(`guardian: recovering ready broadcast ${snap.pending.id}`);
    await adoptPending(token, snap.pending, stream);
    return;
  }
  const active = snap.pending;
  if (active) {
    const sameWedge = st.wedgeId === active.id && st.wedgeSince;
    const since = sameWedge ? st.wedgeSince : now;
    if (!sameWedge) writeState({ ...st, wedgeId: active.id, wedgeSince: since });
    const wedgedS = Math.round((now - since) / 1000);
    if (wedgedS < 240) {
      log(`guardian: broadcast ${active.id} wedged (${active.status?.lifeCycleStatus}, ${wedgedS}s) — bouncing encoder`);
      if (process.env.YT_BOUNCE_CMD) {
        try { await runCommand(process.env.YT_BOUNCE_CMD); }
        catch (e) { log('guardian: encoder bounce failed: ' + e.message); }
      }
      return;                                            // next tick re-evaluates
    }
    if (!cooled) { log('guardian: wedged but cycle cooldown active — waiting'); return; }
    log(`guardian: still wedged after bounce — cycling broadcast ${active.id}`);
    const done = await apiTry(token, 'POST', '/liveBroadcasts/transition', { params: { broadcastStatus: 'complete', id: active.id, part: 'id,status' } });
    if (!done) throw new Error(`guardian could not complete wedged broadcast ${active.id}; it was left intact (videos are never deleted)`);
    await privateVideo(token, active.id);
    writeState({ lastCycle: now });
    await cmdStart({});
    return;
  }
  // This is the incident path: YouTube already completed the broadcast, but the encoder stayed alive and
  // wedged. Privatize that ended public archive before replacing it. If finalization/API update is delayed,
  // fail this tick loudly and retry on the next timer tick rather than abandoning a public corpse.
  if (snap.ended) await privateVideo(token, snap.ended.id);
  if (!cooled) { log('guardian: no broadcast but cycle cooldown active — waiting'); return; }
  log('guardian: encoder pushing with NO broadcast — going live');
  writeState({ lastCycle: now });
  await cmdStart({});
}

const cmd = process.argv[2];
const flags = {};
for (let i = 3; i < process.argv.length; i++) if (process.argv[i].startsWith('--')) flags[process.argv[i].slice(2)] = process.argv[i + 1];
const run = { auth: cmdAuth, status: cmdStatus, start: () => cmdStart(flags), stop: cmdStop, ensure: cmdEnsure }[cmd];
if (!run) { log('usage: youtube-live.mjs auth | status | start [--title .. --privacy public] | stop | ensure'); process.exit(cmd ? 1 : 0); }
run().catch(e => die(e && e.stack || String(e)));
