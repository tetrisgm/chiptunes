// Writes an NES-panel test page into dist/ -- the composite pipeline with a
// synthetic pattern instead of a game, so a colour or legibility failure can be
// attributed to the signal model, the shader, or the pack art, rather than
// argued about from screenshots.
//
// The important part is the palette strip: 64 flat swatches, one per 2C02
// entry. A flat field must decode to exactly the colour nes-signal.js says it
// is, so reading the strip back off the GPU compares the shader's arithmetic
// against the JS model that generated the art in the first place. If those two
// ever drift, every colour on screen is wrong in a way no screenshot would
// settle. The readback comes from the NTSC pass's own framebuffer, not from the
// default one -- readPixels on the default framebuffer returns zeros once the
// browser has composited, which has already cost this project a working panel.
//
// Left out of the build on purpose: dist/ is deployed. Regenerate when needed.
//
//   node scripts/make-nes-test.js && open http://localhost:8099/_nestest.html
'use strict';
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const mods = ['nes-signal.js', 'nes-palette.js', 'nes-screen.js']
  .map(m => '<script>' + fs.readFileSync(path.join(root, 'src', m), 'utf8') + '</script>')
  .join('\n');

const page = `<!doctype html><meta charset=utf-8><title>nes panel test</title>
<style>html,body{margin:0;background:#000;overflow:hidden}#stage{position:fixed;inset:0}</style>
<canvas id=stage></canvas>
${mods}
<script>
var cv=document.getElementById('stage'),g=cv.getContext('2d'),W,H;
var nes=null, drew=0;
function fit(){
  var N=window.CT_NES_NATIVE;
  if(N){ W=N.w; H=N.h; } else { W=Math.floor((innerWidth||1280)/6); H=Math.floor((innerHeight||720)/6); }
  if(cv.width!==W||cv.height!==H){ cv.width=W; cv.height=H; }
  cv.style.width=(innerWidth||1280)+'px'; cv.style.height=(innerHeight||720)+'px';
  g.imageSmoothingEnabled=false;
}
window.__err='';
CT_NES_PALETTE.selectScheme(0);
nes=new CT_NES_SCREEN.NesScreen(cv,{});
document.body.appendChild(nes.canvas);
nes.load().then(function(){ nes.setMode(true); tick(); })
          .catch(function(e){ window.__err=String(e&&e.message||e); });

// SWATCH GEOMETRY, shared with the probe so the readback samples where the
// swatches actually are rather than where anyone assumed.
// A GRID, not a strip. Laid out in one row the swatches were 3 native pixels
// wide -- narrower than the chroma filter's own window, so every reading was
// contaminated by its neighbours and the measurement said the shader was broken
// when the test pattern was. Flat-field fidelity needs a flat field.
function swatch(i){
  var cols=8, w=Math.max(12,Math.floor(W/cols)-2), h=10;
  return {x:(i%cols)*(w+2), y:2+Math.floor(i/cols)*(h+2), w:w, h:h};
}

function pattern(){
  fit();
  // The strip is the REFERENCE and must not be quantised: these are already
  // exact entries, and the point is to compare the shader's decode against the
  // model. The hook is left installed by the previous frame, so it has to come
  // off explicitly -- with it on, every swatch was re-snapped into the active
  // 25 first and the measurement was of quantise(), not of the decoder.
  if(CT_NES_PALETTE.installed) CT_NES_PALETTE.uninstall();
  g.fillStyle=CT_NES_SIGNAL.css(0x0F,0); g.fillRect(0,0,W,H);
  for(var i=0;i<64;i++){ var s=swatch(i); g.fillStyle=CT_NES_SIGNAL.css(i,0); g.fillRect(s.x,s.y,s.w,s.h); }

  // Everything below IS drawn through the palette hook, the way a pack draws.
  if(!CT_NES_PALETTE.installed) CT_NES_PALETTE.install();
  CT_NES_PALETTE.beginFrame();
  var P=CT_NES_PALETTE;

  // A dense field of bordered blocks: the case where separation actually fails.
  var CELL=Math.max(8,Math.floor(W/26)), top=2+8*12+4;
  for(var cx=0;cx<Math.floor(W/CELL);cx++)for(var cy=0;cy<Math.floor((H-top-24)/CELL);cy++){
    var x=cx*CELL,y=top+cy*CELL;
    g.fillStyle=(cx+cy)%2?P.role('fore'):P.role('back'); g.fillRect(x,y,CELL-1,CELL-1);
    g.fillStyle=P.role('ink'); g.fillRect(x,y,CELL-1,1); g.fillRect(x,y,1,CELL-1);
  }
  // High-contrast vertical edges: where a composite decoder invents colours the
  // palette does not contain, and where dot crawl lives.
  for(var k=0;k<10;k++){
    g.fillStyle=k%2?CT_NES_SIGNAL.css(0x30,0):CT_NES_SIGNAL.css(0x0F,0);
    g.fillRect(4+k*2, H-22, 2, 18);
  }
  // ONE HARD EDGE with flat ground either side, for measuring bleed. Measuring
  // it off the block field instead was measuring the block spacing: the row
  // never settles there, so "how far does chroma run past luma" had nothing to
  // settle to and reported the two as equal.
  g.fillStyle=CT_NES_SIGNAL.css(0x0F,0); g.fillRect(0,H-40,W,14);
  g.fillStyle=CT_NES_SIGNAL.css(0x16,0); g.fillRect(Math.floor(W/2),H-40,W,14);
  // One-pixel detail, to see whether the filter eats it.
  g.fillStyle=CT_NES_SIGNAL.css(0x16,0);
  for(var d=0;d<40;d++) g.fillRect(40+d*3, H-14, 1, 1);
  drew++;
}
function tick(){ pattern(); if(nes) nes.frame(); requestAnimationFrame(tick); }
// requestAnimationFrame does not fire in a hidden tab, so a headless check would
// measure a single startup frame forever. Step by hand instead.
window.__step=function(n){ for(var i=0;i<(n||1);i++){ pattern(); if(nes) nes.frame(); } return drew; };

// Read the DECODED picture straight out of the NTSC pass, before the CRT pass
// tints it, and report what each swatch became.
window.__probe=function(){
  if(!nes||!nes.rtNtsc) return {err:'no target', why:window.__err};
  var gl=nes.gl, out=[];
  gl.bindFramebuffer(gl.FRAMEBUFFER, nes.rtNtsc.fbo);
  var px=new Uint8Array(4);
  for(var i=0;i<64;i++){
    var s=swatch(i);
    // centre of the swatch, mapped from native pixels to the NTSC target, which
    // is at OUTPUT resolution; y is flipped because framebuffer row 0 is bottom
    var fx=Math.round((s.x+s.w/2)/W*nes.rtNtsc.w);
    var fy=Math.round((1-(s.y+s.h/2)/H)*nes.rtNtsc.h);
    gl.readPixels(fx,fy,1,1,gl.RGBA,gl.UNSIGNED_BYTE,px);
    out.push({i:i, got:[px[0],px[1],px[2]], want:CT_NES_SIGNAL.bytes(i,0)});
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);
  return {frames:drew, native:[W,H], out:out, err:window.__err};
};
// The three things that make this a composite signal rather than an upscale.
// All read from the NTSC pass, before the CRT pass tints anything.
window.__measure=function(){
  if(!nes||!nes.rtNtsc) return {err:'no target'};
  var gl=nes.gl, T=nes.rtNtsc;
  function readRow(y0,x0,n){
    gl.bindFramebuffer(gl.FRAMEBUFFER,T.fbo);
    var buf=new Uint8Array(n*4);
    gl.readPixels(x0,y0,n,1,gl.RGBA,gl.UNSIGNED_BYTE,buf);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    var out=[]; for(var i=0;i<n;i++) out.push([buf[i*4],buf[i*4+1],buf[i*4+2]]);
    return out;
  }
  var sx=Math.round(T.w/W), sy=Math.round(T.h/H);
  // 1. ARTIFACT COLOUR: the stripe block is pure black and white, so any chroma
  //    in the decode was invented by the receiver -- which is the whole point.
  var stripeY=Math.round((1-(H-13)/H)*T.h);
  var stripe=readRow(stripeY, 4*sx, 22*sx);
  var chroma=0;
  stripe.forEach(function(c){ chroma=Math.max(chroma, Math.max.apply(null,c)-Math.min.apply(null,c)); });
  // 2. BLEED ASYMMETRY: at one hard edge, black to saturated red, chroma must
  //    take longer to arrive than luma. That asymmetry IS the format.
  var lum=function(c){return 0.299*c[0]+0.587*c[1]+0.114*c[2];};
  var sat=function(c){return Math.max.apply(null,c)-Math.min.apply(null,c);};
  var ey=Math.round((1-(H-33)/H)*T.h);
  var edge=Math.round(Math.floor(W/2)/W*T.w);
  var run=readRow(ey, edge-8*sx, 24*sx);
  function settle(f){
    var end=f(run[run.length-1]), i;
    for(i=0;i<run.length;i++) if(Math.abs(f(run[i])-end)<=6) break;
    return Math.round((i-8*sx)/sx*10)/10;   // native pixels past the edge
  }
  // 3. DOT CRAWL: the same pixel must differ between consecutive frames.
  var by=Math.round((1-(2+8*12+4+6)/H)*T.h);
  var a=readRow(by, 10*sx, 40); pattern(); nes.frame();
  var b=readRow(by, 10*sx, 40);
  var moved=0; for(var i=0;i<a.length;i++) if(Math.abs(lum(a[i])-lum(b[i]))>2||Math.abs(sat(a[i])-sat(b[i]))>2) moved++;
  return { artifactChroma:chroma, lumaBleedPx:settle(lum), chromaBleedPx:settle(sat),
           crawlPixels:moved+'/'+a.length, target:[T.w,T.h], native:[W,H] };
};
window.__tune=function(k,v){ if(nes){ if(v!=null) nes.tune[k]=v; return nes.tune; } };
window.__scheme=function(n){ CT_NES_PALETTE.selectScheme(n); return CT_NES_PALETTE.scheme.name; };
</script>`;
const dest = path.join(root, 'dist', '_nestest.html');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, page);
console.log('wrote ' + path.relative(root, dest) + ' (' + page.length + ' bytes)');
console.log('open http://localhost:8099/_nestest.html  -- then __probe() in the console');
