// build.js — bundle src/*.js into a single self-contained dist/index.html AND
// publish every first-party pack to dist/packs/ (games via the shared pack-build
// routine, the rrr_core composer as the reference composer pack, plus an index.json
// covering any user music packs already sitting in dist/packs/music/).
// We AUTHOR in src/ + packs/games/ (cheap per-file edits) but SERVE one inline
// <script> (one request, robust over python http.server) + runtime-loaded packs.
// Run `node build.js` after editing any src or pack file.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = __dirname;
const { GAME_LAYER_ORDER, INLINE_FALLBACK_KEYS, scanGamePacks } = require('./scripts/game-roster.cjs');
const { buildGamePack } = require('./scripts/lib/pack-build.js');

function die(msg) { console.error('build:', msg); process.exit(1); }
function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

// ---- roster: scan packs/games/*/pack.json (no hardcoded game list) ----
const gamePacks = scanGamePacks();
if (!gamePacks.length) die('no game packs found under packs/games/');
for (const key of INLINE_FALLBACK_KEYS) {
  if (!gamePacks.some(p => p.id === key)) die('inline fallback pack missing: packs/games/' + key + '/');
}

// ---- inline bundle: app core + the never-brick fallback game(s) ----
// Load order (shared global scope): seed/composer/audio first (define Song, CT_COMPOSERS,
// Audio), then radio/helpers/visualizer/sprites (CT_GAMES + VisualizerGame + MV),
// game-roster + packs (the loader), the inlined fallback game layers, then runtime
// LAST (it derives GAMES from CT_GAMES after Packs.init() and wires the UI).
const inlineGameSources = [];
for (const key of INLINE_FALLBACK_KEYS) {
  for (const f of GAME_LAYER_ORDER) {
    const rel = 'packs/games/' + key + '/' + f;
    if (!fs.existsSync(path.join(ROOT, rel))) die('missing inline game layer ' + rel);
    inlineGameSources.push(rel);
  }
}
const ORDER = [
  'src/seed.js',
  'src/composer.js',
  'src/audio.js',
  'src/radio.js',
  'src/helpers.js',
  'src/visualizer.js',
  'src/sprites.js',
  'src/game-roster.js',
  'src/packs.js',
  ...inlineGameSources,
  'src/runtime.js',
  'src/library.js'
];

const shellPath = path.join(ROOT, 'src', 'shell.html');
if (!fs.existsSync(shellPath)) die('missing src/shell.html (the HTML template with the __SCRIPTS__ marker)');
const shell = fs.readFileSync(shellPath, 'utf8');
if (!shell.includes('__SCRIPTS__')) die('src/shell.html has no __SCRIPTS__ marker');

const js = ORDER.map(f => {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) die('missing source ' + f);
  return '/* ===== ' + f + ' ===== */\n' + fs.readFileSync(p, 'utf8');
}).join('\n');

// fail loud before writing if the bundle doesn't parse
try { new Function(js); } catch (e) { die('ABORTED — bundle syntax error: ' + e.message); }

// ---- publish dist/ — the ONLY directory the dev server exposes ----
const DIST = path.join(ROOT, 'dist');
fs.mkdirSync(path.join(DIST, 'lib'), { recursive: true });
const html = shell.replace('__SCRIPTS__', '<script>\n' + js + '\n</script>');
fs.writeFileSync(path.join(DIST, 'index.html'), html);

// route entrypoints + stale-route cleanup
for (const stale of ['create', 'listen', 'play', 'wip']) {
  fs.rmSync(path.join(DIST, stale), { recursive: true, force: true });
}

// serve docs/ so the Browse empty-state + packs-panel authoring links resolve
{
  const docsSrc = path.join(ROOT, 'docs'), docsDst = path.join(DIST, 'docs');
  fs.rmSync(docsDst, { recursive: true, force: true });
  fs.mkdirSync(docsDst, { recursive: true });
  for (const entry of fs.readdirSync(docsSrc, { withFileTypes: true })) {
    if (entry.isFile()) fs.copyFileSync(path.join(docsSrc, entry.name), path.join(docsDst, entry.name));
  }
}
for (const route of ['radio', 'browse', 'watch']) {
  fs.mkdirSync(path.join(DIST, route), { recursive: true });
  fs.writeFileSync(path.join(DIST, route, 'index.html'), html);
}

// worklets + workers (+ anything else under src/lib) → dist/lib/
for (const entry of fs.readdirSync(path.join(ROOT, 'src', 'lib'), { withFileTypes: true })) {
  if (!entry.isFile()) continue;
  fs.copyFileSync(path.join(ROOT, 'src', 'lib', entry.name), path.join(DIST, 'lib', entry.name));
}
// the shared BPM kernel lives in scripts/lib (used by pack-tools too); serve it so the in-app
// fallback worker can importScripts('/lib/bpm-kernel.js').
{
  const bpmKernel = path.join(ROOT, 'scripts', 'lib', 'bpm-kernel.js');
  if (fs.existsSync(bpmKernel)) fs.copyFileSync(bpmKernel, path.join(DIST, 'lib', 'bpm-kernel.js'));
}

// ---- publish packs: every first-party game becomes a runtime-loaded pack ----
const builtAt = new Date().toISOString();
const indexPacks = [];
for (const pack of gamePacks) {
  const { manifest, code } = buildGamePack(pack.dir);
  const outDir = path.join(DIST, 'packs', 'games', pack.id);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const dist = Object.assign({}, manifest, {
    entry: 'pack.js',
    entryHash: sha256(code),
    builtAt
  });
  fs.writeFileSync(path.join(outDir, 'pack.js'), code);
  fs.writeFileSync(path.join(outDir, 'pack.json'), JSON.stringify(dist, null, 2) + '\n');
  const icon = path.join(pack.dir, 'icon.png');
  if (fs.existsSync(icon)) fs.copyFileSync(icon, path.join(outDir, 'icon.png'));
  indexPacks.push({ id: dist.id, kind: 'game', dir: 'games/' + dist.id, name: dist.name, version: dist.version });
}

// composer reference pack: rrr_core = the shipped src/composer.js, published so the
// community has a working example of the composer-pack contract.
{
  const composerSrc = fs.readFileSync(path.join(ROOT, 'src', 'composer.js'), 'utf8');
  const outDir = path.join(DIST, 'packs', 'composers', 'rrr_core');
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const manifest = {
    schema: 'rrr-pack@3',
    kind: 'composer',
    id: 'rrr_core',
    name: 'RRR Core Composer',
    version: '1.0.0',
    author: 'Retro Rave Radio',
    license: 'MIT',
    entry: 'composer.js',
    composerV: 3,
    entryHash: sha256(composerSrc),
    builtAt
  };
  fs.writeFileSync(path.join(outDir, 'composer.js'), composerSrc);
  fs.writeFileSync(path.join(outDir, 'pack.json'), JSON.stringify(manifest, null, 2) + '\n');
  indexPacks.push({ id: 'rrr_core', kind: 'composer', dir: 'composers/rrr_core', name: manifest.name, version: manifest.version });
}

// music packs are user content (built by pack-tools into dist/packs/music/, never in
// git) — scan whatever is installed so the served index makes them discoverable.
const musicRoot = path.join(DIST, 'packs', 'music');
if (fs.existsSync(musicRoot)) {
  for (const entry of fs.readdirSync(musicRoot, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) {
    if (!entry.isDirectory()) continue;
    const mPath = path.join(musicRoot, entry.name, 'pack.json');
    if (!fs.existsSync(mPath)) continue;
    let m;
    try { m = JSON.parse(fs.readFileSync(mPath, 'utf8')); }
    catch (e) { console.error('build: skipping music pack with bad pack.json:', entry.name, '(' + e.message + ')'); continue; }
    if (m.kind !== 'music' || m.id !== entry.name) {
      console.error('build: skipping music pack with mismatched manifest:', entry.name);
      continue;
    }
    indexPacks.push({ id: m.id, kind: 'music', dir: 'music/' + m.id, name: m.name, version: m.version });
  }
}

fs.writeFileSync(path.join(DIST, 'packs', 'index.json'),
  JSON.stringify({ schema: 'rrr-pack-index@1', packs: indexPacks }, null, 2) + '\n');

console.log('built dist/index.html:', html.length, 'bytes from', ORDER.length, 'sources (', js.length, 'B JS )',
  '+ routes radio/browse/watch + dist/lib +', gamePacks.length, 'game packs + rrr_core composer pack +',
  indexPacks.filter(p => p.kind === 'music').length, 'music packs in dist/packs/index.json');
