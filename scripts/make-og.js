// Renders the 1200x630 social-share (OG/Twitter) card to assets/og.png using the
// project's Playwright (same engine as the audition renders). The card mirrors
// the home screen: dark radial-glow ground, the glitch "RETRO RAVE RADIO" title
// (VT323 + the red/blue offset + magenta glow), the tagline, and the four
// station accent chips. Run: node scripts/make-og.js  (then `node build.js`).
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const OUT = path.join(__dirname, '..', 'assets', 'og.png');

const HTML = `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=VT323&display=swap" rel="stylesheet">
<style>
  *{margin:0;box-sizing:border-box}
  html,body{width:1200px;height:630px;overflow:hidden}
  .card{width:1200px;height:630px;position:relative;
    background:#0a0814;
    display:flex;flex-direction:column;align-items:center;justify-content:center;gap:40px;
    font-family:system-ui,-apple-system,"Segoe UI",sans-serif;}
  .card::before{content:"";position:absolute;inset:0;
    background:radial-gradient(120% 90% at 50% 42%, rgba(124,60,190,.42) 0%, rgba(60,20,90,.16) 42%, rgba(10,8,20,0) 70%);}
  .card>*{position:relative;z-index:1}
  h1{font-family:"VT323",monospace;font-weight:400;font-size:150px;line-height:.9;letter-spacing:4px;
    color:#fcfcf8;text-shadow:6px 6px 0 #a80020, 12px 12px 0 #0000fc, 0 0 44px rgba(248,120,248,.5);}
  h1 .rave{color:#f878f8}
  .sub{max-width:920px;text-align:center;font-size:34px;line-height:1.42;font-weight:600;color:#e6e1f7;letter-spacing:-.01em}
  .chips{display:flex;gap:22px;margin-top:6px}
  .chip{width:64px;height:64px;border-radius:16px;box-shadow:0 8px 0 rgba(0,0,0,.35), 0 0 30px currentColor}
</style></head>
<body>
  <div class="card">
    <h1>RETRO <span class="rave">RAVE</span> RADIO</h1>
    <div class="sub">Endless retro music that keeps making itself.<br>Mini games that move to the beat.</div>
    <div class="chips">
      <div class="chip" style="background:#ffd23e;color:#ffd23e"></div>
      <div class="chip" style="background:#5ee08a;color:#5ee08a"></div>
      <div class="chip" style="background:#4fd8f8;color:#4fd8f8"></div>
      <div class="chip" style="background:#ff5d5d;color:#ff5d5d"></div>
    </div>
  </div>
</body></html>`;

(async () => {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(HTML, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.screenshot({ path: OUT, clip: { x: 0, y: 0, width: 1200, height: 630 } });
  await browser.close();
  const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
  console.log(`wrote ${path.relative(path.join(__dirname, '..'), OUT)} (1200x630, ${kb}KB)`);
})();
