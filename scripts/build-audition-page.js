#!/usr/bin/env node
// Blind A/B listening page for the music-quality loop. LOCAL ONLY — emits
// chip-derived/analysis/audition/index.html (never dist/). Pairs golden renders
// (chip-derived/analysis/audition/renders/*.wav, produced by
// `node scripts/audition-generated-music.js --render`) against reference
// excerpts the user drops into chip-originals/refs/ (any audio files).
//
// The page is a static file:// page — keyboard-driven rating
// (1 = A better / 2 = equal / 3 = B better, then complaint tags
// d)rums m)elody x)mix f)orm, Enter = commit+next), sides blinded and shuffled
// deterministically, results accumulated in localStorage with an Export button
// that downloads results.json. No server, no Math.random (seeded shuffle).
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const AUDITION_DIR = path.join(ROOT, 'chip-derived', 'analysis', 'audition');
const RENDER_DIR = path.join(AUDITION_DIR, 'renders');
const REFS_DIR = path.join(ROOT, 'chip-originals', 'refs');
const OUT = path.join(AUDITION_DIR, 'index.html');

const AUDIO_EXT = /\.(wav|mp3|ogg|oga|m4a|aac|flac|opus|aiff?|webm)$/i;

function hash32(str) {
  str = '' + str;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(a) {
  a = a >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seededShuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

function listAudio(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (AUDIO_EXT.test(e.name)) out.push(p);
    }
  })(dir);
  out.sort();
  return out;
}

const renders = listAudio(RENDER_DIR);
// COPY refs into the audition subtree. The page is opened over file://, and
// Safari's local-file sandbox blocks subresources OUTSIDE the page's own
// directory tree — a ../../../chip-originals/refs/... path silently refuses to
// load ("nothing plays" on whichever blinded side is the ref). With the refs
// copied under audition/refs/ every path points downward and file:// works in
// every browser. Still local-only: chip-derived is gitignored and never served.
const REFS_LOCAL = path.join(AUDITION_DIR, 'refs');
const srcRefs = listAudio(REFS_DIR);
fs.mkdirSync(REFS_LOCAL, { recursive: true });
const wanted = new Set(srcRefs.map(f => path.basename(f)));
for (const f of fs.readdirSync(REFS_LOCAL)) { if (!wanted.has(f)) fs.unlinkSync(path.join(REFS_LOCAL, f)); }  // prune stale
for (const f of srcRefs) {
  const dst = path.join(REFS_LOCAL, path.basename(f));
  const st = fs.statSync(f);
  if (!fs.existsSync(dst) || fs.statSync(dst).size !== st.size) fs.copyFileSync(f, dst);
}
const refs = listAudio(REFS_LOCAL);

// Deterministic pairing: seed from the file lists so re-running with the same
// corpus builds the same session, and new renders/refs reshuffle predictably.
const seed = hash32(renders.map(f => path.basename(f)).join('|') + '#' + refs.map(f => path.basename(f)).join('|'));
const rng = mulberry32(seed);
const shuffledRefs = seededShuffle(refs, rng);
const pairs = renders.map((render, i) => {
  const ref = shuffledRefs.length ? shuffledRefs[i % shuffledRefs.length] : null;
  const renderIsA = rng() < 0.5; // blind side assignment
  return {
    id: `${path.basename(render)}__vs__${ref ? path.basename(ref) : 'none'}`,
    render: path.relative(AUDITION_DIR, render).split(path.sep).join('/'),
    ref: ref ? path.relative(AUDITION_DIR, ref).split(path.sep).join('/') : null,
    renderIsA
  };
}).filter(p => p.ref);

const emptyMsg = !renders.length
  ? 'No golden renders found. Run <code>node scripts/audition-generated-music.js --render</code> first.'
  : (!refs.length
    ? 'No reference tracks found. Drop LSDJ / Chipzel / VGM excerpts (any audio files) into <code>chip-originals/refs/</code> and re-run <code>node scripts/build-audition-page.js</code>.'
    : '');

const html = `<!doctype html>
<meta charset="utf-8">
<title>Chiptunes.app blind A/B audition</title>
<style>
  :root { color-scheme: dark; }
  body { background:#0c0c14; color:#e8e8f0; font:15px/1.5 ui-monospace, Menlo, monospace; max-width:820px; margin:32px auto; padding:0 16px; }
  h1 { font-size:18px; letter-spacing:2px; }
  .card { background:#161624; border:1px solid #2a2a44; border-radius:10px; padding:20px; margin:16px 0; }
  .sides { display:flex; gap:16px; }
  .side { flex:1; background:#101020; border:2px solid #2a2a44; border-radius:8px; padding:14px; text-align:center; cursor:pointer; }
  .side.playing { border-color:#f878f8; }
  .side h2 { margin:0 0 8px; font-size:22px; color:#58d8f8; }
  .verdict button, .tags button, .nav button, #export { background:#22223a; color:#e8e8f0; border:1px solid #3a3a5c; border-radius:6px; padding:8px 14px; margin:4px; cursor:pointer; font:inherit; }
  .verdict button.sel, .tags button.sel { background:#f878f8; color:#10101c; border-color:#f878f8; }
  .keyhint { color:#8888aa; font-size:12px; }
  #progress { color:#b8f818; }
  #reveal { min-height:1.4em; color:#fca044; }
  .stat { font-size:11px; margin-top:6px; color:#8888aa; min-height:1.2em; }
  .stat.err { color:#f85858; }
  .stat.ready { color:#78f8a8; }
  .muted { color:#8888aa; }
  audio { display:none; }
</style>
<h1>Chiptunes.app — blind A/B</h1>
${emptyMsg ? `<div class="card">${emptyMsg}</div>` : `
<div class="card">
  <div id="progress"></div>
  <div class="sides">
    <div class="side" id="sideA" onclick="playSide('A')"><h2>A</h2><span class="keyhint">press a</span><div class="stat" id="statA"></div></div>
    <div class="side" id="sideB" onclick="playSide('B')"><h2>B</h2><span class="keyhint">press b</span><div class="stat" id="statB"></div></div>
  </div>
  <div class="verdict">
    <button id="v1" onclick="setVerdict('A')">1 · A better</button>
    <button id="v2" onclick="setVerdict('equal')">2 · equal</button>
    <button id="v3" onclick="setVerdict('B')">3 · B better</button>
  </div>
  <div class="tags">
    complaints (about the generated track):
    <button id="tdrums" onclick="toggleTag('drums')">d · drums</button>
    <button id="tmelody" onclick="toggleTag('melody')">m · melody</button>
    <button id="tmix" onclick="toggleTag('mix')">x · mix</button>
    <button id="tform" onclick="toggleTag('form')">f · form</button>
  </div>
  <div class="nav">
    <button onclick="commit()">Enter · commit &amp; next</button>
    <button onclick="skip()">s · skip</button>
    <button id="export" onclick="exportResults()">Export results.json</button>
  </div>
  <div id="reveal"></div>
  <div class="keyhint">a/b play sides · 1/2/3 verdict · d/m/x/f tags · Enter commit · s skip · space stop</div>
  <div class="muted" id="summary"></div>
</div>
<audio id="audA"></audio>
<audio id="audB"></audio>
`}
<script>
const PAIRS = ${JSON.stringify(pairs)};
const STORE_KEY = 'rrr.audition.v2';   // v2: round-6 renders (v1 session was contaminated by silent renders)
let idx = 0, verdict = null, tags = new Set();
const $ = id => document.getElementById(id);

// localStorage can be DENIED (strict cookie/site-data settings, some file://
// contexts). Ratings must never be lost to that: keep an in-memory copy as the
// source of truth and mirror to localStorage when possible.
let MEM = null;
function store() {
  if (MEM) return MEM;
  try { MEM = JSON.parse(localStorage.getItem(STORE_KEY) || '{"ratings":[]}'); }
  catch (e) { MEM = { ratings: [] }; }
  return MEM;
}
function save(s) {
  MEM = s;
  try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); }
  catch (e) { /* storage denied: in-memory only — Export still works; warn in summary */
    const el = $('summary'); if (el && !el.dataset.warned) { el.dataset.warned = '1'; el.textContent = 'NOTE: browser storage is blocked — ratings live only in this tab. Export before closing!'; }
  }
}
function ratedIds() { return new Set(store().ratings.map(r => r.pair)); }

function firstUnrated() {
  const done = ratedIds();
  for (let i = 0; i < PAIRS.length; i++) if (!done.has(PAIRS[i].id)) return i;
  return PAIRS.length;
}

function srcFor(side) {
  const p = PAIRS[idx];
  const isRender = (side === 'A') === p.renderIsA;
  return encodeURI(isRender ? p.render : p.ref);   // spaces/quotes in ref names
}

// Preload BOTH sides when a pair becomes current, with visible per-side status —
// a side that fails to load says ERROR instead of silently playing nothing, and
// buffering happens before the first keypress instead of stuttering after it.
const ERR_NAMES = { 1: 'aborted', 2: 'network', 3: 'decode failed', 4: 'file not found / unsupported' };
function wireAudio(side) {
  const a = $(side === 'A' ? 'audA' : 'audB'), st = $('stat' + side);
  a.preload = 'auto';
  a.addEventListener('error', () => { st.textContent = 'ERROR: ' + (ERR_NAMES[(a.error || {}).code] || 'load failed'); st.className = 'stat err'; });
  a.addEventListener('canplaythrough', () => { if (st.className !== 'stat err') { st.textContent = 'ready'; st.className = 'stat ready'; } });
  a.addEventListener('waiting', () => { st.textContent = 'buffering…'; st.className = 'stat'; });
  a.addEventListener('stalled', () => { if (st.className !== 'stat ready') { st.textContent = 'stalled — still loading'; st.className = 'stat'; } });
  a.addEventListener('ended', () => $('side' + side).classList.remove('playing'));
}
function loadPair() {
  if (idx >= PAIRS.length) return;
  for (const side of ['A', 'B']) {
    const a = $(side === 'A' ? 'aud' + side : 'aud' + side), st = $('stat' + side);
    st.textContent = 'loading…'; st.className = 'stat';
    a.src = srcFor(side);
    a.load();
  }
}

function stopAll() {
  for (const id of ['audA', 'audB']) { const a = $(id); a.pause(); }
  $('sideA').classList.remove('playing');
  $('sideB').classList.remove('playing');
}

function playSide(side) {
  if (idx >= PAIRS.length) return;
  const a = $(side === 'A' ? 'audA' : 'audB'), other = $(side === 'A' ? 'audB' : 'audA');
  other.pause();
  $('side' + (side === 'A' ? 'B' : 'A')).classList.remove('playing');
  // re-pressing the playing side restarts it; first press just plays (src is preloaded)
  if (!a.paused) a.currentTime = 0;
  else if (a.ended) a.currentTime = 0;
  a.play().catch(() => {});
  $('side' + side).classList.add('playing');
}

function setVerdict(v) {
  verdict = v;
  for (const [id, val] of [['v1', 'A'], ['v2', 'equal'], ['v3', 'B']]) $(id).classList.toggle('sel', verdict === val);
}
function toggleTag(t) {
  if (tags.has(t)) tags.delete(t); else tags.add(t);
  for (const t2 of ['drums', 'melody', 'mix', 'form']) $('t' + t2).classList.toggle('sel', tags.has(t2));
}

function resolveVerdict(p, v) {
  if (v === 'equal') return 'equal';
  const generatedWon = (v === 'A') === p.renderIsA;
  return generatedWon ? 'better' : 'worse';
}

function commit() {
  if (idx >= PAIRS.length || !verdict) return;
  const p = PAIRS[idx];
  const s = store();
  s.ratings = s.ratings.filter(r => r.pair !== p.id);
  s.ratings.push({
    pair: p.id, render: p.render, ref: p.ref,
    verdictRaw: verdict, verdict: resolveVerdict(p, verdict),
    tags: Array.from(tags), ratedAt: new Date().toISOString()
  });
  save(s);
  $('reveal').textContent = 'generated was ' + (p.renderIsA ? 'A' : 'B') + ' -> rated ' + resolveVerdict(p, verdict);
  setTimeout(next, 900);
}
function skip() { next(); }
function next() {
  stopAll();
  verdict = null; tags = new Set();
  setVerdict(null); for (const t of ['drums', 'melody', 'mix', 'form']) $('t' + t).classList.remove('sel');
  idx = Math.min(PAIRS.length, idx + 1);
  loadPair();
  render();
}

function exportResults() {
  const s = store();
  const counts = { better: 0, equal: 0, worse: 0 };
  const tagCounts = {};
  for (const r of s.ratings) {
    counts[r.verdict] = (counts[r.verdict] || 0) + 1;
    for (const t of r.tags) tagCounts[t] = (tagCounts[t] || 0) + 1;
  }
  const out = { exportedAt: new Date().toISOString(), pairs: PAIRS.length, counts, tagCounts, ratings: s.ratings };
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'results.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

function render() {
  if (!PAIRS.length) return;
  const done = ratedIds().size;
  if (idx >= PAIRS.length) {
    $('progress').textContent = 'Done — ' + done + '/' + PAIRS.length + ' rated. Export and feed the top-2 complaint tags back into the composer round.';
  } else {
    $('progress').textContent = 'pair ' + (idx + 1) + '/' + PAIRS.length + ' (' + done + ' rated)';
  }
  $('reveal').textContent = '';
  const s = store();
  const counts = { better: 0, equal: 0, worse: 0 };
  for (const r of s.ratings) counts[r.verdict] = (counts[r.verdict] || 0) + 1;
  $('summary').textContent = 'so far: generated better ' + counts.better + ' · equal ' + counts.equal + ' · worse ' + counts.worse;
}

document.addEventListener('keydown', e => {
  if (!PAIRS.length || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'a') { playSide('A'); e.preventDefault(); }
  else if (k === 'b') { playSide('B'); e.preventDefault(); }
  else if (k === '1') setVerdict('A');
  else if (k === '2') setVerdict('equal');
  else if (k === '3') setVerdict('B');
  else if (k === 'd') toggleTag('drums');
  else if (k === 'm') toggleTag('melody');
  else if (k === 'x') toggleTag('mix');
  else if (k === 'f') toggleTag('form');
  else if (k === 'enter') { commit(); e.preventDefault(); }
  else if (k === 's') skip();
  else if (k === ' ') { stopAll(); e.preventDefault(); }
});

if (PAIRS.length) { wireAudio('A'); wireAudio('B'); idx = firstUnrated(); loadPair(); render(); }
</script>
`;

fs.mkdirSync(AUDITION_DIR, { recursive: true });
fs.writeFileSync(OUT, html);
console.log(`audition page: ${pairs.length} blind pair(s) (${renders.length} renders x ${refs.length} refs) -> ${path.relative(ROOT, OUT)}`);
if (emptyMsg) console.log('note: ' + emptyMsg.replace(/<[^>]+>/g, ''));
