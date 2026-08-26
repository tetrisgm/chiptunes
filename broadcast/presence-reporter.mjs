#!/usr/bin/env node
// presence-reporter.mjs — folds the OFF-website listener surfaces into the site's one true live count.
//
// The website already counts web + desktop listeners itself (each holds a WebSocket to the radio-presence
// Durable Object; the count is just getWebSockets().length). This reporter runs ON THE BOX and adds the
// two surfaces the Worker cannot see: the YouTube Live concurrent-viewer count and the internet-radio
// (Roon/VLC/hardware) listener count. Every ~45s it reads 127.0.0.1:1340/healthz (sum of per-channel
// stream listeners), asks the YouTube Data API for the current live broadcast's concurrentViewers, and
// POSTs {youtube, stream} to https://chiptunes.app/api/presence/external with a shared Bearer secret. The
// DO folds those into `listeners`, so the site shows web+desktop + youtube + stream as one number.
//
// ROBUSTNESS (this must NEVER crash-loop or wedge — it runs unattended on the box):
//   - unreachable healthz            -> stream = 0, keep going
//   - no live YouTube broadcast      -> youtube = 0, keep going
//   - missing creds / token failure  -> youtube = 0, keep going (drop the cached token, retry next tick)
//   - every network call is AbortController-bounded (HTTP_TIMEOUT_MS) — no unbounded hang
//   - stdin is closed; a wedged single call can never block the loop
//
// Modes:
//   node broadcast/presence-reporter.mjs           # loop forever, one tick every PRESENCE_INTERVAL_MS
//   node broadcast/presence-reporter.mjs --once     # one tick then exit (the systemd timer uses this)
//
// SECURITY: like youtube-live.mjs, this only ever USES an OAuth refresh token the owner minted once. It
// never handles a password. The presence secret comes from the env (PRESENCE_SECRET), never a file it writes.
'use strict';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const API = 'https://www.googleapis.com/youtube/v3';
const OAUTH = 'https://oauth2.googleapis.com/token';
const CREDS_PATH = process.env.YOUTUBE_CREDS || path.join(homedir(), '.config', 'stack', 'youtube.json');
const HEALTHZ_URL = process.env.CHIPTUNES_HEALTHZ_URL || process.env.RRR_HEALTHZ_URL || `http://127.0.0.1:${process.env.CHIPTUNES_STREAM_PORT || process.env.RRR_STREAM_PORT || 1340}/healthz`;
const PRESENCE_URL = process.env.PRESENCE_URL || 'https://chiptunes.app/api/presence/external';
const SECRET = process.env.PRESENCE_SECRET || '';
const INTERVAL_MS = Math.max(5000, +(process.env.PRESENCE_INTERVAL_MS || 45000));
const HTTP_TIMEOUT_MS = Math.max(2000, +(process.env.PRESENCE_HTTP_TIMEOUT_MS || 10000));
const ONCE = process.argv.includes('--once') || process.env.PRESENCE_ONCE === '1';

const log = (...a) => process.stdout.write('[presence-reporter ' + new Date().toISOString() + '] ' + a.join(' ') + '\n');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Every network call is bounded — a stuck socket must never block the tick or the loop.
async function fetchJson(url, opts = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), HTTP_TIMEOUT_MS);
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal });
    const json = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, json };
  } finally { clearTimeout(t); }
}

// --- internet-radio (Roon/VLC/hardware) listeners: sum the broadcaster's per-channel counts ---
async function readStreamListeners() {
  try {
    const { ok, json } = await fetchJson(HEALTHZ_URL);
    if (!ok || !Array.isArray(json.channels)) return 0;
    return json.channels.reduce((n, c) => n + (Number(c.listeners) || 0), 0);
  } catch (e) {
    log('healthz unreachable (' + HEALTHZ_URL + '): ' + (e && e.message || e));
    return 0;
  }
}

// --- YouTube Live concurrent viewers (replicates youtube-live.mjs's minimal refresh-token flow) ---
let cachedToken = null, tokenExpiresAt = 0;
function loadCfg() {
  if (!existsSync(CREDS_PATH)) throw new Error('no YouTube creds at ' + CREDS_PATH);
  return JSON.parse(readFileSync(CREDS_PATH, 'utf8'));
}
async function accessToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;
  const cfg = loadCfg();
  if (!cfg.client_id || !cfg.client_secret || !cfg.refresh_token) throw new Error('creds missing client_id/client_secret/refresh_token');
  const { ok, json } = await fetchJson(OAUTH, { method: 'POST', body: new URLSearchParams({
    client_id: cfg.client_id, client_secret: cfg.client_secret, refresh_token: cfg.refresh_token, grant_type: 'refresh_token' }) });
  if (!ok || !json.access_token) throw new Error('token refresh failed: ' + JSON.stringify(json));
  cachedToken = json.access_token;
  tokenExpiresAt = Date.now() + ((json.expires_in || 3600) - 300) * 1000;   // refresh a bit early
  return cachedToken;
}
async function ytApi(token, endpoint, params) {
  const url = new URL(API + endpoint);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const { ok, status, json } = await fetchJson(url, { headers: { authorization: 'Bearer ' + token } });
  if (!ok) throw new Error('GET ' + endpoint + ' -> ' + status + ': ' + JSON.stringify(json.error || json));
  return json;
}
async function readYouTubeViewers() {
  let token;
  try { token = await accessToken(); }
  catch (e) { log('youtube auth unavailable: ' + (e && e.message || e)); return 0; }
  try {
    // The channel's active live broadcast; its id IS the watch/video id used for liveStreamingDetails.
    const bc = await ytApi(token, '/liveBroadcasts', { part: 'id,status', broadcastStatus: 'active', maxResults: '10' });
    const live = (bc.items || []).find(b => b.status?.lifeCycleStatus === 'live');
    if (!live) return 0;                                   // nothing live right now
    const v = await ytApi(token, '/videos', { part: 'liveStreamingDetails', id: live.id });
    const cv = v.items?.[0]?.liveStreamingDetails?.concurrentViewers;
    return cv == null ? 0 : (parseInt(cv, 10) || 0);
  } catch (e) {
    log('youtube viewers unavailable: ' + (e && e.message || e));
    cachedToken = null;                                    // force a fresh token next tick (handles 401/expiry)
    return 0;
  }
}

async function tick() {
  const [stream, youtube] = await Promise.all([readStreamListeners(), readYouTubeViewers()]);
  try {
    const { ok, status, json } = await fetchJson(PRESENCE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + SECRET },
      body: JSON.stringify({ youtube, stream }),
    });
    if (!ok) log('POST ' + PRESENCE_URL + ' failed ' + status + ': ' + JSON.stringify(json));
    else log('reported youtube=' + youtube + ' stream=' + stream + ' -> listeners=' + (json.listeners ?? '?'));
  } catch (e) {
    log('POST error: ' + (e && e.message || e));
  }
}

async function main() {
  if (!SECRET) { log('FATAL: PRESENCE_SECRET not set — refusing to start (would POST unauthenticated)'); process.exit(1); }
  // Never read stdin — closing it means a spawned/piped context can never wedge waiting on input.
  try { process.stdin.pause(); process.stdin.destroy(); } catch (_) {}
  let stop = false;
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stop = true; log('caught ' + sig + ' — exiting'); process.exit(0); });
  log((ONCE ? 'single-shot' : 'loop') + ': healthz=' + HEALTHZ_URL + ' -> ' + PRESENCE_URL + (ONCE ? '' : ' every ' + Math.round(INTERVAL_MS / 1000) + 's'));
  do {
    try { await tick(); } catch (e) { log('tick error: ' + (e && e.stack || e)); }   // a bad tick must never kill the loop
    if (ONCE || stop) break;
    await sleep(INTERVAL_MS);
  } while (!stop);
}

main().catch(e => { log('fatal: ' + (e && e.stack || e)); process.exit(1); });
