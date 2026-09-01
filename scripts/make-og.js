// Renders the 1200x630 social-share (OG/Twitter) card to assets/og.png using the project's Playwright.
// The card is REAL gameplay: it loads the built dist/ in broadcast mode (fullscreen game, no chrome) with a
// chosen game, lets it play a few seconds so the scene populates, then composites the Chiptunes.app wordmark +
// tagline over a bottom scrim for legibility. So the link preview in iMessage / social shows the actual product.
// Run: node scripts/make-og.js [game]   (default: platformer)  — then `node build.js` copies assets/og.png -> dist/.
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(ROOT, 'assets', 'og.png');
const GAME = process.argv[2] || 'platformer';
const W = 1200, H = 630;

const MIME = { '.html':'text/html', '.js':'application/javascript', '.mjs':'application/javascript',
  '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml',
  '.mp3':'audio/mpeg', '.woff2':'font/woff2', '.woff':'font/woff', '.ttf':'font/ttf', '.css':'text/css',
  '.wasm':'application/wasm', '.map':'application/json' };

// Tiny static server for dist/ (the app fetches packs/index.json etc. relative to origin — needs http, not file://).
function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent((req.url || '/').split('?')[0]);
      if (p === '/' || p.endsWith('/')) p += 'index.html';
      const fp = path.join(DIST, p);
      if (!fp.startsWith(DIST) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); return res.end('nf'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
      fs.createReadStream(fp).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

(async () => {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  if (!fs.existsSync(path.join(DIST, 'index.html'))) { console.error('dist/index.html missing — run `node build.js` first'); process.exit(1); }
  const srv = await serve();
  const port = srv.address().port;
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.warn('page error:', e.message));
  // broadcast=1 => fullscreen game, all chrome hidden (the exact mode the YouTube leg uses). rotate=0 keeps the chosen game.
  await page.goto(`http://127.0.0.1:${port}/?broadcast=1&game=${encodeURIComponent(GAME)}&rotate=0`, { waitUntil: 'load' });
  // nudge autoplay (broadcast mode arms audio on a gesture in some browsers), then let the scene populate.
  try { await page.mouse.click(W / 2, H / 2); } catch (e) {}
  await page.waitForTimeout(8000);

  // Grab the raw gameplay frame, then composite in a CLEAN page (broadcast mode's fullscreen canvas fights DOM
  // injection, so we don't overlay in-app — we screenshot the game and re-draw it as a background behind the wordmark).
  const shot = await page.screenshot({ clip: { x: 0, y: 0, width: W, height: H } });
  const bg = 'data:image/png;base64,' + shot.toString('base64');

  const page2 = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page2.setContent(`<!doctype html><html><head><meta charset="utf-8">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=VT323&display=swap" rel="stylesheet">
    <style>
      *{margin:0;box-sizing:border-box}
      html,body{width:${W}px;height:${H}px;overflow:hidden}
      .card{position:relative;width:${W}px;height:${H}px;
        background:#06040e url('${bg}') center/cover no-repeat;
        font-family:system-ui,-apple-system,"Segoe UI",sans-serif;}
      /* bottom scrim so the wordmark stays legible over any game/scene */
      .card::after{content:"";position:absolute;inset:0;
        background:linear-gradient(to top, rgba(6,4,14,.94) 0%, rgba(6,4,14,.68) 25%, rgba(6,4,14,.12) 50%, rgba(6,4,14,0) 68%);}
      .lockup{position:absolute;left:0;right:0;bottom:46px;z-index:1;text-align:center}
      .wm{font-family:"VT323",monospace;font-weight:400;font-size:120px;line-height:.86;letter-spacing:3px;
        color:#fcfcf8;text-shadow:5px 5px 0 #a80020, 10px 10px 0 #0000fc, 0 0 42px rgba(248,120,248,.55);}
      .wm .dot{color:#f878f8}
      .tag{margin-top:18px;font-size:30px;font-weight:650;color:#eae6fb;letter-spacing:-.01em;
        text-shadow:0 2px 12px rgba(0,0,0,.92)}
    </style></head>
    <body><div class="card"><div class="lockup">
      <div class="wm">CHIPTUNES<span class="dot">.</span>APP</div>
      <div class="tag">Create or listen to complete Game Boy songs — composed automatically in your browser.</div>
    </div></div></body></html>`, { waitUntil: 'networkidle' });
  try { await page2.evaluate(() => document.fonts && document.fonts.ready); } catch (e) {}
  await page2.waitForTimeout(300);

  await page2.screenshot({ path: OUT, clip: { x: 0, y: 0, width: W, height: H } });
  await browser.close();
  srv.close();
  const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
  console.log(`wrote ${path.relative(ROOT, OUT)} (${W}x${H}, ${kb}KB) — gameplay=${GAME}`);
})();
