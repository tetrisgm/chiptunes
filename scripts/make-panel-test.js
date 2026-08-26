// Writes a panel-only test page into dist/ — the DMG pipeline with a synthetic
// board instead of a game, so a legibility failure can be attributed to the
// shader chain or to the pack art rather than argued about from screenshots.
//
// It is how the shade-collapse and the resize crash were found: drive frames by
// hand, gl.readPixels the panel, and measure. Left out of the build on purpose —
// dist/ is deployed, so regenerate this when you need it and delete it after.
//
//   node scripts/make-panel-test.js && open http://localhost:8099/_paneltest.html
'use strict';
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const mods = ['dmg-palette.js', 'slang-webgl.js', 'dmg-screen.js']
  .map(m => '<script>' + fs.readFileSync(path.join(root, 'src', m), 'utf8') + '</script>')
  .join('\n');

const page = `<!doctype html><meta charset=utf-8><title>panel test</title>
<style>html,body{margin:0;background:#000;overflow:hidden}#stage{position:fixed;inset:0}</style>
<canvas id=stage></canvas>
${mods}
<script>
var cv=document.getElementById('stage'),g=cv.getContext('2d'),W,H,DPR;
function fit(){ W=innerWidth||1280; H=innerHeight||720; DPR=Math.min(2,devicePixelRatio||1);
  cv.width=Math.floor(W*DPR); cv.height=Math.floor(H*DPR);
  cv.style.width=W+'px'; cv.style.height=H+'px'; g.setTransform(DPR,0,0,DPR,0,0); }
fit();
CT_DMG_PALETTE.install();
var dmg=new CT_DMG_SCREEN.DmgScreen(cv,{});
document.body.appendChild(dmg.canvas);
window.__err='';
dmg.load().then(function(){ dmg.setMode(true); board(); tick(); })
          .catch(function(e){ window.__err=String(e&&e.message||e); });
var NES=['#00e8d8','#f8d878','#b048f8','#58d854','#f83800','#5078f8','#fca044'];
// a dense field of bordered blocks: the case where separation actually fails
function board(){ fit();
  var CELL=40, bw=Math.max(1,(window.CT_DMG_CELL||8)/DPR);
  g.fillStyle='#080828'; g.fillRect(0,0,W,H);
  for(var cx=0;cx<Math.floor(W/CELL);cx++)for(var cy=0;cy<Math.floor(H/CELL);cy++){
    var x=cx*CELL,y=cy*CELL, base=NES[(cx+cy)%NES.length];
    g.fillStyle=CT_DMG_PALETTE.step(base); g.fillRect(x,y,CELL,CELL);
    g.fillStyle=base; g.fillRect(x+bw,y+bw,CELL-bw*2,CELL-bw*2); } }
// four raw levels as full-height bands: the panel's transfer function
function bands(){ fit(); g.setTransform(DPR,0,0,DPR,0,0);
  for(var i=0;i<4;i++){ var v=Math.round(CT_DMG_PALETTE.LEVELS[i]*255);
    g.fillStyle='rgb('+v+','+v+','+v+')'; g.fillRect(i*(W/4),0,W/4,H); } }
// rAF is throttled in a background tab; call tick() by hand when driving this
// from a tool, and let it run normally when a human has the tab open.
function tick(){ dmg.frame(); requestAnimationFrame(tick); }
window.board=board; window.bands=bands; window.dmg=dmg;
</script>`;
const out = path.join(root, 'dist', '_paneltest.html');
fs.writeFileSync(out, page);
console.log('wrote ' + path.relative(root, out) + ' (debug artifact — do not deploy)');
