// Renders a 1024x1024 station avatar for Chiptunes.app (Roon "Add station" image,
// and any square logo need). Circle-SAFE: all content sits inside the centered ~74% disc
// because Roon masks station art to a circle. Same glitch language as the OG card
// (VT323 + red/blue offset + magenta glow) on the dark radial-glow ground, with the four
// station accent chips. Run: node scripts/make-station-icon.js
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const OUT = path.join(__dirname, '..', 'assets', 'station-icon.png');
const S = 1024;

const HTML = `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=VT323&display=swap" rel="stylesheet">
<style>
  *{margin:0;box-sizing:border-box}
  html,body{width:${S}px;height:${S}px;overflow:hidden}
  .card{width:${S}px;height:${S}px;position:relative;background:#0a0814;
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    font-family:"VT323",monospace;overflow:hidden}
  /* radial glow ground */
  .card::before{content:"";position:absolute;inset:0;
    background:radial-gradient(70% 70% at 50% 44%, rgba(124,60,190,.55) 0%, rgba(60,20,90,.22) 46%, rgba(10,8,20,0) 72%);}
  /* CRT scanlines */
  .card::after{content:"";position:absolute;inset:0;pointer-events:none;
    background:repeating-linear-gradient(0deg, rgba(0,0,0,0) 0 3px, rgba(0,0,0,.16) 3px 4px);}
  /* corner vignette so the circle mask edge stays dark */
  .vig{position:absolute;inset:0;background:radial-gradient(circle at 50% 50%, rgba(0,0,0,0) 58%, rgba(0,0,0,.55) 78%);z-index:2}
  .wm{position:relative;z-index:3;text-align:center;line-height:.86;letter-spacing:2px;
    color:#fcfcf8;text-shadow:5px 5px 0 #a80020, 10px 10px 0 #0000fc, 0 0 40px rgba(248,120,248,.6);}
  .wm .l{display:block;font-size:210px}
  .wm .rave{color:#f878f8}
  .chips{position:relative;z-index:3;display:flex;gap:26px;margin-top:54px}
  .chip{width:52px;height:52px;border-radius:13px;box-shadow:0 6px 0 rgba(0,0,0,.35), 0 0 26px currentColor}
</style></head>
<body>
  <div class="card">
    <div class="wm"><span class="l">RETRO</span><span class="l rave">RAVE</span><span class="l">RADIO</span></div>
    <div class="chips">
      <div class="chip" style="background:#ffd23e;color:#ffd23e"></div>
      <div class="chip" style="background:#5ee08a;color:#5ee08a"></div>
      <div class="chip" style="background:#4fd8f8;color:#4fd8f8"></div>
      <div class="chip" style="background:#ff5d5d;color:#ff5d5d"></div>
    </div>
    <div class="vig"></div>
  </div>
</body></html>`;

(async () => {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: S, height: S }, deviceScaleFactor: 1 });
  await page.setContent(HTML, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.screenshot({ path: OUT, clip: { x: 0, y: 0, width: S, height: S } });
  await browser.close();
  const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
  console.log(`wrote ${path.relative(path.join(__dirname, '..'), OUT)} (${S}x${S}, ${kb}KB)`);
})();
