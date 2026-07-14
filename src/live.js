// ===== live.js — the shared broadcast schedule: a pure function of wall-clock UTC. =====
// "What's on air right now" needs NO server: time divides into 1-hour blocks aligned to
// UTC hours; block N deterministically mints a playlist of tokens (namespace 'live:v<V>:<N>:<i>')
// whose durations come from the composer's cheap duration() stage-walk. Every client — and the
// broadcaster daemon (Node) — computes the identical {token, offset} for any instant, so all
// listeners hear the same track at the same moment with zero coordination.
//
// BOUNDARY RULE (fixed boundary + crossfade): the last track of block N straddles the hour
// boundary; at exactly the boundary instant, block N+1's track 0 cold-opens (startTrack-style
// killAll fade) while the straddler's tail fades under it. Block N is a pure function of N
// alone — no recursion into N-1 — so join cost is O(one block) and every second is covered
// (the walk only stops once cumulative start >= BLOCK_SEC, so the last track's end >= boundary).
//
// COMPOSER UPGRADE PROTOCOL: LIVE_VERSIONS below is APPEND-ONLY. When composer V bumps,
// freeze the old composer as a versioned pack, append {fromBlock:<top-of-hour >=24h out>,
// v:<new>, composerId:...}. The v is baked into the mint seed (so the token SEQUENCE flips
// at the boundary) and composerId routes compile/duration (never activeComposer() — a user's
// custom composer pack must not put them in a parallel universe while live).
//
// Pure + dual-environment: in the bundle it reads the shared Song/CT_COMPOSERS bindings;
// under Node it requires ./seed.js and ./composer.js. No DOM, no engine, no Date.now() —
// callers pass nowMs (clock policy, e.g. presence server-time correction, lives in runtime).
var Live = (function(){
'use strict';
var G = typeof globalThis!=='undefined' ? globalThis : (typeof window!=='undefined' ? window : this);
var isNode = typeof module!=='undefined' && !!module.exports;
var Song = G.Song || (isNode ? require('./seed.js') : null);
function composers(){
  if (!G.CT_COMPOSERS && isNode) require('./composer.js');   // populates G.CT_COMPOSERS
  return G.CT_COMPOSERS || {};
}

var BLOCK_SEC = 3600;                 // UTC-hour blocks: blockN = floor(nowMs/3600000)
var BLOCK_MS  = BLOCK_SEC * 1000;
// The broadcaster's slot length is the beat-grid duration (identical to the site's deck end
// math); Engine.render's echo tail beyond it is overlap-added under the next slot's head.
var RENDER_TAIL_SEC = 1.8;

// append-only activation table — see COMPOSER UPGRADE PROTOCOL above.
var LIVE_VERSIONS = [
  { fromBlock: 0, v: 3, composerId: 'rrr_core' }
];

function versionFor(blockN){
  var e = LIVE_VERSIONS[0];
  for (var i = 1; i < LIVE_VERSIONS.length; i++)
    if (LIVE_VERSIONS[i].fromBlock <= blockN) e = LIVE_VERSIONS[i];
  return e;
}
function composerFor(blockN){
  var e = versionFor(blockN), c = composers()[e.composerId];
  if (!c) throw new Error('live: composer "' + e.composerId + '" not registered');
  return c;
}
function mintToken(blockN, i){
  var e = versionFor(blockN);
  return Song.mint({ random: Song._mulberry32(Song._hash32('live:v' + e.v + ':' + blockN + ':' + i)) });
}

// ---- block playlist: [{token, start, dur}] — memoized (join reads 2, boundary reads 2) ----
var _plCache = {}, _plOrder = [];
function blockPlaylist(blockN){
  if (_plCache[blockN]) return _plCache[blockN];
  var comp = composerFor(blockN), out = [], start = 0, i = 0;
  while (start < BLOCK_SEC && i < 200){                 // 200 = pathological-grammar guard
    var tok = mintToken(blockN, i), dur = comp.duration(tok);
    out.push({ token: tok, start: start, dur: dur });
    start += dur; i++;
  }
  _plCache[blockN] = out; _plOrder.push(blockN);
  while (_plOrder.length > 4) delete _plCache[_plOrder.shift()];
  return out;
}

// ---- resolve an instant -> what's on air ----
// {blockN, i, token, dur, offsetSec, startWallMs, nextToken, nextStartWallMs, boundary}
// boundary=true means the NEXT transition is the hour cold-open (next starts at the fixed
// boundary, cutting the straddler's tail) rather than the natural gapless deck chain.
function resolveAt(nowMs){
  var blockN = Math.floor(nowMs / BLOCK_MS);
  var t = (nowMs - blockN * BLOCK_MS) / 1000;
  var pl = blockPlaylist(blockN), i = pl.length - 1;
  for (var k = 0; k < pl.length; k++)
    if (t >= pl[k].start && (k === pl.length - 1 || t < pl[k + 1].start)) { i = k; break; }
  var cur = pl[i], last = i === pl.length - 1;
  return {
    blockN: blockN, i: i, token: cur.token, dur: cur.dur,
    offsetSec: t - cur.start,
    startWallMs: blockN * BLOCK_MS + cur.start * 1000,
    nextToken: last ? blockPlaylist(blockN + 1)[0].token : pl[i + 1].token,
    nextStartWallMs: last ? (blockN + 1) * BLOCK_MS : blockN * BLOCK_MS + pl[i + 1].start * 1000,
    boundary: last
  };
}

var API = {
  BLOCK_SEC: BLOCK_SEC, BLOCK_MS: BLOCK_MS, RENDER_TAIL_SEC: RENDER_TAIL_SEC,
  LIVE_VERSIONS: LIVE_VERSIONS,
  versionFor: versionFor, composerFor: composerFor,
  mintToken: mintToken, blockPlaylist: blockPlaylist, resolveAt: resolveAt
};
if (isNode) module.exports = API;
return API;
})();
