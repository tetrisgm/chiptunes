// Build the one shared artifact used by web, desktop, and broadcast. The fixed
// game roster is concatenated directly; there is no runtime pack platform.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = __dirname;
const { GAME_LAYER_ORDER, scanGamePacks } = require('./scripts/game-roster.cjs');

function die(msg) { console.error('build:', msg); process.exit(1); }
// A small, fixed visual roster is a product choice, not an extension API.
const BUNDLED_GAMES = [
  'hover', 'blast', 'bricks', 'trooper', 'climber', 'racer', 'crossing',
  'squadron', 'vortex', 'platformer', 'maze', 'pyramid', 'blocks', 'dungeon'
];
const allGamePacks = scanGamePacks();
const gamePacks = BUNDLED_GAMES.map(id => {
  const pack = allGamePacks.find(row => row.id === id);
  if (!pack) die('bundled game missing: packs/games/' + id + '/');
  return pack;
});

// ---- inline bundle: app core + the never-brick fallback game(s) ----
// Load order (shared global scope): seed/composer/audio first (define Song, CT_COMPOSERS,
// Audio), then radio/helpers/visualizer/sprites (CT_GAMES + VisualizerGame + MV),
// game-roster + packs (the loader), the inlined fallback game layers, then runtime
// LAST (it derives GAMES from CT_GAMES after Packs.init() and wires the UI).
const inlineGameSources = [];
for (const key of BUNDLED_GAMES) {
  for (const f of GAME_LAYER_ORDER) {
    const rel = 'packs/games/' + key + '/' + f;
    if (!fs.existsSync(path.join(ROOT, rel))) die('missing inline game layer ' + rel);
    inlineGameSources.push(rel);
  }
}
const ORDER = [
  'src/seed.js',
  // The composer writes onto the machine, so the hardware model, the voice
  // allocator and the melodic writer must exist before it loads. Under Node
  // composer.js requires these itself; in the browser they are plain scripts.
  'src/gb-hardware.js',   // periods, frame grid, instrument bank
  'src/gb-voices.js',     // four-channel allocation
  'src/melody.js',        // phrase writer
  'src/gb-kits.js',       // four-bit drum samples for channel 3, synthesised
  'src/gb-apu.js',        // the chip: shared by the worklet and offline render
  'src/gb-rom.js',        // export a song as a real cartridge image
  'src/gb-cpu.js',        // LR35902: runs an exported cartridge in the page
  'src/gb-ppu.js',        // background layer: what the cartridge draws on the LCD
  'src/create.js',
  'src/style-corpus.js',
  'src/chip-instruments.js',
  'src/composer.js',
  'src/live.js',        // the shared broadcast schedule (pure fn of wall clock; needs Song + CT_COMPOSERS)
  'src/audio.js',
  'src/radio.js',
  'src/reference-styles.js',  // "like Castlevania" -> genre dials, read back out loud
  'src/api.js',         // the agent API, also reachable in the page as CT_API
  'src/webmcp.js',      // window.chiptunes + WebMCP tools: an agent driving the live page
  'src/helpers.js',
  'src/visualizer.js',
  'src/sprites.js',
  'src/dmg-palette.js',    // 4-shade quantisation at draw time
  'src/nes-signal.js',     // the 2C02 composite waveform; the NES palette is derived from it
  'src/nes-palette.js',    // 25-colour sub-palette restriction at draw time
  'src/palette.js',        // which console's colour rules are in force (must follow both)
  'src/slang-webgl.js',   // RetroArch slang -> WebGL2 GLSL ES 300
  'src/dmg-screen.js',   // WebGL DMG panel post-process (opt-in screen mode)
  'src/nes-screen.js',   // WebGL NTSC composite + CRT (opt-in screen mode)
  'src/packs.js',
  ...inlineGameSources,
  'src/webmcp-demo.js',   // the /webmcp explainer panel, mounted only on that route
  'src/runtime.js'
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
// A FUNCTION, not a string. String.replace treats $', $`, $& and $$ in the
// replacement as special patterns, so any source containing one of them is
// silently corrupted -- and the corruption is not local: `$'` splices in
// everything AFTER the match, so a `$'` inside a JS string literal in any
// bundled file injects `</body></html>` into the middle of that literal and the
// whole page stops parsing. It first bit when src/gb-cpu.js threw an error
// message containing "opcode $". A replacer function disables the patterns
// entirely, which is the only reliable fix.
// THE BUNDLE IS A FILE, NOT A STRING IN THE PAGE. Inlined, it was 1.8MB of
// script the browser had to re-download and re-parse on every visit, because
// nothing in an HTML document can be cached on its own -- and it blocked the
// first paint while it compiled (231ms in WebKit, 638ms in Chromium, on
// localhost with no network at all). As a hashed file it is cached forever,
// compiled once, and `defer` lets the page draw first.
const bundleHash = crypto.createHash('sha256').update(js).digest('hex').slice(0, 12);
const bundleName = 'app.' + bundleHash + '.js';
const html = shell.replace('__SCRIPTS__', () => '<script src="' + bundleName + '" defer></script>');
// Prove the page's script survived templating -- the corruption this guards
// against produced a perfectly plausible artifact that simply did not run.
{
  const emitted = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g;
  let m, n = 0;
  while ((m = emitted.exec(html))) {
    n++;
    try { new Function(m[1]); }
    catch (e) { die('emitted inline script block ' + n + ' does not parse: ' + e.message); }
  }
  if (!html.includes('src="' + bundleName + '"')) die('the bundle tag was altered while being templated into the shell');
}
// clear yesterday's bundles so dist/ never accumulates them
for (const f of fs.readdirSync(DIST)) if (/^app\.[0-9a-f]+\.js$/.test(f) && f !== bundleName) fs.unlinkSync(path.join(DIST, f));
fs.writeFileSync(path.join(DIST, bundleName), js);
let pageHtml;
// ---- PRE-HYDRATION WEBMCP REGISTRAR ---------------------------------------
// The bundle is `defer`red, so it runs AFTER the document is parsed. An agent
// that enumerates the page's tools while it is still parsing would find none.
// This inline script registers the real descriptors immediately, with execute
// stubs that wait for the bundle's dispatcher (`window.chiptunes.call`) and
// then fail politely rather than hanging.
//
// The descriptors come from src/webmcp.js itself, so the inline copy and the
// module can never disagree about what the tools are or what they accept.
{
  const { descriptors } = require('./src/webmcp.js');
  if (!descriptors || !descriptors.length) throw new Error('build: webmcp descriptors missing');
  const registrar = `<script>
(function(G){
  var D=${JSON.stringify(descriptors)};
  function hosts(){var o=[];try{if(document.modelContext)o.push(['document',document.modelContext]);}catch(e){}
    try{if(G.navigator&&G.navigator.modelContext)o.push(['navigator',G.navigator.modelContext]);}catch(e){}
    try{if(G.modelContext)o.push(['window',G.modelContext]);}catch(e){}return o;}
  // Wait for the real implementation, then hand the call straight to it. Ten
  // seconds is generous for a script that is already downloading; after that a
  // readable failure beats a silent hang.
  function call(name,args){
    return new Promise(function(res){
      var n=0,t=setInterval(function(){
        var s=G.chiptunes,fn=s&&(s.callFromAgent||s.call);
        if(typeof fn==='function'){clearInterval(t);
          var out;try{out=fn.call(s,name,args||{});}catch(e){out={ok:false,error:String(e&&e.message||e)};}
          var bad=!!(out&&(out.ok===false||out.error));
          res({content:[{type:'text',text:JSON.stringify(out,null,2)}],isError:bad});return;}
        if(++n>100){clearInterval(t);
          res({content:[{type:'text',text:'The page is still loading. Try this tool again in a moment.'}],isError:true});}
      },100);
    });
  }
  var done=[],where=[];
  hosts().forEach(function(p){
    var mc=p[1];
    if(done.indexOf(mc)>=0||typeof mc.registerTool!=='function')return;
    var n=0;
    D.forEach(function(d){
      try{mc.registerTool({name:d.name,description:d.description,inputSchema:d.inputSchema,
        execute:function(a){return call(d.name,a);}});n++;}catch(e){}
    });
    if(n){done.push(mc);where.push(p[0]+'.modelContext.registerTool');}
  });
  if(done.length)G.__ctWebmcpPre={hosts:done,where:where,count:D.length};
})(typeof globalThis!=='undefined'?globalThis:window);
</` + `script>`;
  // First thing in <body>: it executes at parse time, which is early enough,
  // and it leaves <head> alone.
  // ANCHORED AT THE START OF A LINE. A bare /<body[^>]*>/ matched the text
  // "<body ...>" inside a CSS COMMENT in the inline stylesheet, so the registrar
  // was inserted into the middle of a comment and never ran -- while the page
  // looked completely normal. The gate below is what caught it.
  const bodyTag = /^[ \t]*<body[^>]*>/m;
  const found = html.match(bodyTag);
  if (!found) throw new Error('build: could not find the <body> tag for the WebMCP registrar');
  // found.index, NOT indexOf(found[0]) -- the string "<body>" also appears in
  // that CSS comment, so searching by text finds the wrong one and this guard
  // would fire on a correct match.
  if (found.index < html.lastIndexOf('</style>'))
    throw new Error('build: matched a <body> inside the stylesheet, not the document body');
  pageHtml = html.replace(bodyTag, found[0] + '\n' + registrar);
}
fs.writeFileSync(path.join(DIST, 'index.html'), pageHtml);

// /radio is the public “listen anywhere” page.
const radioHtml = fs.readFileSync(path.join(ROOT, 'src', 'listen-anywhere.html'), 'utf8');

// route entrypoints + stale-route cleanup
// '/' is the player; /get is the platform page; /radio is the player under its own
// name (kept: it is in links people have shared).
// /webmcp is the same app with the WebMCP explainer on top of it. It has to be
// the REAL page rather than a standalone explainer: an agent arriving there
// reads the top document's modelContext, and tools registered inside an iframe
// would be invisible to it.
const ROUTES = ['get', 'gameboy', 'create', 'webmcp'];
for (const stale of ['player', 'create', 'listen', 'play', 'wip', 'watch']) {
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
for (const route of ROUTES) {
  fs.mkdirSync(path.join(DIST, route), { recursive: true });
  // one level down, so the bundle is one level up.
  // pageHtml, not html: every route needs the pre-hydration registrar too --
  // /webmcp most of all, since that is the one an agent is pointed at.
  fs.writeFileSync(path.join(DIST, route, 'index.html'),
                   pageHtml.replace('src="' + bundleName + '"', 'src="../' + bundleName + '"'));
}
fs.mkdirSync(path.join(DIST, 'radio'), { recursive: true });
fs.writeFileSync(path.join(DIST, 'radio', 'index.html'), radioHtml);

// worklets + workers (+ anything else under src/lib) → dist/lib/, recursively:
// lib/shaders/brickboy holds the vendored .slang passes + grain texture, which
// are fetched at runtime rather than inlined.
(function copyLib(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, entry.name), d = path.join(to, entry.name);
    if (entry.isDirectory()) copyLib(s, d);
    else if (entry.isFile()) fs.copyFileSync(s, d);
  }
})(path.join(ROOT, 'src', 'lib'), path.join(DIST, 'lib'));
// The chip worklet is ASSEMBLED, not copied: an AudioWorklet has its own global
// scope and cannot import from the page, so the hardware model and the APU are
// prepended to the processor shell. Doing it here rather than keeping a second
// copy of the chip is what stops the browser and scripts/gb-emu.js drifting
// apart -- they are literally the same source.
{
  const parts = ['src/gb-hardware.js', 'src/gb-kits.js', 'src/gb-apu.js', 'src/gb-cpu.js', 'src/lib/gb-chip-processor.js']
    .map(f => fs.readFileSync(path.join(ROOT, f), 'utf8'));
  fs.writeFileSync(path.join(DIST, 'lib', 'gb-chip-worklet.js'),
    '// GENERATED by build.js from ' + ['src/gb-hardware.js', 'src/gb-kits.js', 'src/gb-apu.js', 'src/gb-cpu.js', 'src/lib/gb-chip-processor.js'].join(' + ') + '\n' +
    '// Do not edit: edit those and rebuild.\n' + parts.join('\n'));
  fs.unlinkSync(path.join(DIST, 'lib', 'gb-chip-processor.js'));   // the shell alone is not loadable
}
// static assets (og.png etc., generated by scripts/make-og.js) → dist/ root
const assetsSrc = path.join(ROOT, 'assets');
if (fs.existsSync(assetsSrc)) {
  for (const entry of fs.readdirSync(assetsSrc, { withFileTypes: true })) {
    // Directories too: the fonts live in assets/fonts/ and used to be skipped
    // here in silence, so @font-face pointed at a 404 and every pixel face fell
    // back to a proportional one -- the look gone, with nothing failing.
    if (entry.isDirectory()) {
      const sd = path.join(assetsSrc, entry.name), dd = path.join(DIST, entry.name);
      fs.mkdirSync(dd, { recursive: true });
      for (const f of fs.readdirSync(sd, { withFileTypes: true })) {
        if (f.isFile()) fs.copyFileSync(path.join(sd, f.name), path.join(dd, f.name));
      }
      continue;
    }
    if (entry.isFile()) fs.copyFileSync(path.join(assetsSrc, entry.name), path.join(DIST, entry.name));
  }
}
// the shared BPM kernel lives in scripts/lib (used by pack-tools too); serve it so the in-app

fs.rmSync(path.join(DIST, 'packs'), { recursive: true, force: true });

console.log('built dist/index.html:', html.length, 'bytes from', ORDER.length, 'sources (', js.length, 'B JS )',
  '+ routes ' + ROUTES.join('/') + ' + dist/lib +', gamePacks.length, 'bundled games');
