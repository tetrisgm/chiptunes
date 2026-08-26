// chiptunes-monitor — OFF-BOX uptime monitor for the radio. A Cloudflare Worker on a Cron Trigger (every
// 2 min) that watches BOTH the public MP3 stream (real audio bytes) and the website, from outside the
// Oracle box — so it catches a box deadlock the local watchdog misses, a dead cloudflared tunnel, or a
// dead box, none of which the on-box checks can see. Alerts the owner only when a check transitions
// to DOWN (2-strike debounced), via Cloudflare Email Routing. Healthy checks and recoveries stay
// silent.
//
// KNOWN BLIND SPOT: the Worker's subrequest to stream.chiptunes.app stays inside Cloudflare's network, so
// a public-internet-only edge/DNS issue can read healthy. It DOES catch the dominant modes (render
// deadlock, tunnel down, box dead, blank deploy). See monitor/README.md.

import { sendSmtp } from './smtp.js';

const STREAM = 'https://stream.chiptunes.app/radio.mp3';
const SITE = 'https://chiptunes.app/';
const MIN_BYTES = 40000;          // ~2s of 192kbps audio; a stalled/down stream yields ~0
const PROBE_MS = 6000;
const ALERT_TO = (typeof ALERT_EMAIL !== 'undefined' && ALERT_EMAIL) || '';   // set via Worker env var

// Pull the live MP3 and count real audio bytes. NEVER res.text() the endless stream — read the body
// with a reader, stop as soon as we have enough bytes or the probe window elapses, then cancel.
async function probeStream() {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), PROBE_MS);
  try {
    const res = await fetch(STREAM, { signal: ac.signal, headers: { 'icy-metadata': '0' }, cf: { cacheTtl: 0 } });
    if (!res.ok || !res.body) return { ok: false, detail: 'HTTP ' + res.status };
    const ct = res.headers.get('content-type') || '';
    const reader = res.body.getReader();
    let bytes = 0;
    while (bytes < MIN_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value ? value.byteLength : 0;
    }
    try { await reader.cancel(); } catch (e) {}
    const ctWarn = /audio\/mpeg/i.test(ct) ? '' : ' (unexpected content-type: ' + ct + ')';
    return { ok: bytes >= MIN_BYTES, detail: bytes + 'B in <' + (PROBE_MS / 1000) + 's' + ctWarn };
  } catch (e) {
    return { ok: false, detail: (e && e.name === 'AbortError') ? 'stalled — too few audio bytes in ' + (PROBE_MS / 1000) + 's' : ('fetch: ' + (e && e.message || e)) };
  } finally { clearTimeout(timer); }
}

async function probeSite() {
  try {
    const res = await fetch(SITE, { signal: AbortSignal.timeout(PROBE_MS), cf: { cacheTtl: 0 } });
    if (!res.ok) return { ok: false, detail: 'HTTP ' + res.status };
    const html = await res.text();
    const ok = /Chiptunes/i.test(html);
    return { ok, detail: ok ? 'ok' : 'page marker missing' };
  } catch (e) { return { ok: false, detail: 'fetch: ' + (e && e.message || e) }; }
}

async function loadState(env) { try { return JSON.parse(await env.STATE.get('state')) || {}; } catch (e) { return {}; } }
// Persist only MEANINGFUL state, and only when it changed — an unconditional put every 2-min cron run
// burned ~720 KV writes/day against the 1,000/day free quota (Cloudflare's "50% of daily limit" emails).
// Streaks are capped just past the 2-strike debounce threshold (beyond that the count is meaningless),
// and the ephemeral lastCheck payload is never persisted (the /check endpoint recomputes live anyway).
// Steady state performs no KV writes; only a debounce streak or up/down transition changes state.
function persistable(s) {
  const cap = (x) => x ? { up: x.up, streak: Math.min(x.streak || 0, 3), since: x.since } : undefined;
  return JSON.stringify({ stream: cap(s.stream), site: cap(s.site), alerts: s.alerts });
}
async function saveState(env, s, loadedSnapshot) {
  const next = persistable(s);
  if (loadedSnapshot !== undefined && next === loadedSnapshot) return;   // nothing meaningful changed
  await env.STATE.put('state', next);
}

// 2-strike debounce: only flip the recorded state after 2 consecutive same observations (rejects one
// blip). Returns { up, streak, since, changed }.
function step(prev, okNow) {
  prev = prev || { up: true, streak: 0, since: 0 };
  if (okNow === prev.up) return { up: prev.up, streak: 0, since: prev.since || 0, changed: false };
  const streak = (prev.streak || 0) + 1;
  if (streak >= 2) return { up: okNow, streak: 0, since: 1, changed: true };
  return { up: prev.up, streak, since: prev.since || 0, changed: false };
}

// AUTH_EMAIL_SERVER comes from the account-level "stack" Secrets Store (a .get() accessor shared by
// every product), but tolerate a plain-string binding too so it works either way.
async function resolveSecret(binding) {
  if (!binding) return null;
  if (typeof binding === 'string') return binding;
  if (typeof binding.get === 'function') { try { return await binding.get(); } catch (e) { return null; } }
  return null;
}
async function alertEmail(env, subject, text) {
  const server = await resolveSecret(env.AUTH_EMAIL_SERVER);
  if (!server) return { sent: false, reason: 'AUTH_EMAIL_SERVER not populated in the "stack" secrets store yet' };
  try { return await sendSmtp(server, 'Chiptunes.app Monitor', ALERT_TO, subject, text); }
  catch (e) { return { sent: false, reason: String(e && e.message || e) }; }
}

async function runChecks(env, nowMs) {
  const now = nowMs || Date.now();
  const [stream, site] = await Promise.all([probeStream(), probeSite()]);
  const st = await loadState(env);
  const loadedSnapshot = persistable(st);
  const s2 = step(st.stream, stream.ok);
  const site2 = step(st.site, site.ok);
  const transitions = [];
  if (s2.changed) transitions.push(['STREAM (stream.chiptunes.app)', s2.up, stream.detail]);
  if (site2.changed) transitions.push(['SITE (chiptunes.app)', site2.up, site.detail]);
  for (const [what, up, detail] of transitions) {
    let mail = { sent: false, reason: 'healthy recovery — email suppressed' };
    if (!up) {
      const subject = '[Chiptunes.app] ' + what + ' — DOWN';
      const body = what + ' is DOWN.\n\ndetail: ' + detail +
        '\nstream: ' + JSON.stringify(stream) + '\nsite: ' + JSON.stringify(site) +
        '\nat: ' + new Date(now).toISOString();
      mail = await alertEmail(env, subject, body);
    }
    (st.alerts = st.alerts || []).unshift({ what, up, detail, at: now, mail });
    st.alerts = st.alerts.slice(0, 30);
  }
  st.stream = { up: s2.up, streak: s2.streak, since: s2.changed ? now : (st.stream && st.stream.since) || now };
  st.site = { up: site2.up, streak: site2.streak, since: site2.changed ? now : (st.site && st.site.since) || now };
  st.lastCheck = { at: now, stream, site };
  await saveState(env, st, loadedSnapshot);
  return st;
}

export default {
  async scheduled(event, env, ctx) { ctx.waitUntil(runChecks(env)); },
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/status') {
      const st = await loadState(env);
      return new Response(JSON.stringify(st, null, 2), { headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' } });
    }
    if (url.pathname === '/check') {   // manual run (for testing the probes + email)
      const st = await runChecks(env);
      return new Response(JSON.stringify(st, null, 2), { headers: { 'content-type': 'application/json' } });
    }
    return new Response('chiptunes-monitor — GET /status (current) or /check (run now)', { headers: { 'content-type': 'text/plain' } });
  },
};
