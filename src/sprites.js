// ===== sprites.js — SHARED pixel-sprite registry for the FAVICON + the game-dropdown icons. =====
// Each entry reproduces that game's ACTUAL in-app main character (same pixel grids / shapes / colours the
// game itself draws), so the tab favicon and the game-picker rows show the real character — Pac-Man, the
// Galaga ship, the frog, the Q*bert guy, Link, Mario, Bomberman, a Tetris piece, etc. One renderer drives
// both: `Sprites.favicon(ctx,key,vis,t)` paints a 32px beat-reactive icon (sprite PULSES on the beat,
// background FLASHES + the colour DRIFTS with the music hue, characters CHOMP/HOP/WALK to the beat);
// `Sprites.dataURL(key)` returns a small static PNG for the dropdown. Loads after helpers.js (uses hueRot).
var Sprites = (function(){
  function lite(hex,amt){ if(typeof hex!=='string'||hex[0]!=='#'||hex.length<7) return hex;
    var r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
    return 'rgb('+Math.round(r+(255-r)*amt)+','+Math.round(g+(255-g)*amt)+','+Math.round(b+(255-b)*amt)+')'; }
  function isDark(hex){ if(typeof hex!=='string'||hex[0]!=='#'||hex.length<7) return false;
    return (parseInt(hex.slice(1,3),16)+parseInt(hex.slice(3,5),16)+parseInt(hex.slice(5,7),16)) < 120; }
  // hue-DRIFT a colour by the music + brighten on the beat — but keep near-black detail (eyes/outlines) stable.
  function tintHex(hex, dyn, lift){ if(typeof hex!=='string'||hex[0]!=='#') return hex;
    if(isDark(hex)) return hex; return lite((typeof hueRot==='function')?hueRot(hex, dyn):hex, lift); }
  function fhex(g,x,y,r){ g.beginPath(); for(var i=0;i<6;i++){ var a=Math.PI/3*i-Math.PI/2, px=x+Math.cos(a)*r, py=y+Math.sin(a)*r; i?g.lineTo(px,py):g.moveTo(px,py); } g.closePath(); }
  function rrectPath(g,x,y,w,h,r){ g.beginPath(); g.moveTo(x+r,y); g.arcTo(x+w,y,x+w,y+h,r); g.arcTo(x+w,y+h,x,y+h,r); g.arcTo(x,y+h,x,y,r); g.arcTo(x,y,x+w,y,r); g.closePath(); }

  // draw a pixel grid centred in a square box; `tint` recolours each cell (identity for the static dropdown).
  function grid(g, rows, map, cx, cy, box, tint){
    var h=rows.length, w=0, j, i; for(j=0;j<h;j++) if(rows[j].length>w) w=rows[j].length;
    var cell=Math.max(1, Math.floor(Math.min(box/w, box/h)));
    var ox=Math.round(cx-w*cell/2), oy=Math.round(cy-h*cell/2);
    for(j=0;j<h;j++){ var rr=rows[j]; for(i=0;i<rr.length;i++){ var ch=rr[i]; if(ch===' '||ch==='.') continue; var c=map[ch]; if(!c) continue;
      g.fillStyle = tint?tint(c):c; g.fillRect(ox+i*cell, oy+j*cell, cell, cell); } }
  }
  // wrap a grid (or frame list) into a uniform sprite fn with beat animation: hop = lift + 2nd frame, walk = frame toggle.
  function gridSprite(frames, map, anim){ return function(g,cx,cy,box,e){
    var fi=0, dy=0;
    if(anim==='hop'){ if(e.p>0.35){ if(frames.length>1) fi=1; dy=-box*0.17*Math.min(1,e.p*1.3); } }
    else if(anim==='walk'){ fi=(e.p>0.5?1:0)%frames.length; }
    grid(g, frames[fi%frames.length], map, cx, cy+dy, box, e.tint); }; }

  // ---- per-game sprites: each is fn(ctx, cx, cy, box, env). env = {p,t,bar,dyn,liftAmt,tint(),bright()}. ----
  var GAL=['....W....','....W....','...WRW...','...WRW...','..WWRWW..','.WWRRRWW.','WRWWRWWRW','WRWWWWWRW','R.W.W.W.R'];
  var FROG_REST=['D...G...D','DD.GGG.DD','.GEPGPEG.','.GGGGGGG.','GGGGGGGGG','.GGGGGGG.','DG.G.G.GD','D.......D'];
  var FROG_HOP =['..D...D..','.DGGGGGD.','.GGGGGGG.','.GEPGPEG.','.GGGGGGG.','.DGGGGGD.','..DG.GD..','.........'];
  var QB=['..bbb..','.bbbbb.','bbbbbbb','beebebb','bppbpbn','bbbbbnn','.bbbbb.','.f...f.'];
  var MARIO_STAND=['....rrrr..','...rrrrrr.','...hhhss..','..hsskssk.','..hssksss.','...sssss..','..rbrrbr..','.rrbbbbrr.','.ssbbbbss.','...bb.bb..','..kkk.kkk.'];
  var MARIO_RUN  =['....rrrr..','...rrrrrr.','...hhhss..','..hsskssk.','..hssksss.','...sssss..','...rbbr...','..rbbbbr..','..sbbbbs..','...bbbb...','..kk.kk...'];
  var LINK=['.CCCCC.','.CCCCC.','.SSSSS.','.S.S.S.','TTSSSTT','TTTTTTT','.TTBTT.','.B...B.'];
  var BMAN0=['....A....','....W....','..WWWWW..','.WWWWWWW.','.WWWWWWW.','.WSSSSSW.','..BBBBB..','.BBLLLBB.','.BB.L.BB.','.OO...OO.','..O...OO.'];
  var BMAN1=['....A....','....W....','..WWWWW..','.WWWWWWW.','.WWWWWWW.','.WSSSSSW.','..BBBBB..','.BBLLLBB.','.BB.L.BB.','.OO...OO.','.OO...O..'];
  var BALL=['.bb...bb.','bbbb.bbbb','bbbb.bbbb','.bb...bb.','..s...s..','...fff...','..fkfkf..','...ggg...','...g.g...'];
  var DK_A=['.rrr.','rrrrr','.sss.','rrrrr','brrrb','bb.bb','.b.b.'];   // DK jumpman (the red plumber from dk.js) — legs apart
  var DK_B=['.rrr.','rrrrr','.sss.','rrrrr','brrrb','bb.bb','b...b'];   // ...legs together (2-frame walk on the beat)
  var MEGA=['..bbbb..','.bbccbb.','bbcwwcbb','bbckkcbb','.bccccb.','.BBccBB.','BBbYYbBB','..BYYB..','.BB..BB.'];
  var SAMUS=['..oooo..','.oorrroo','oorwwroo','..rkkr..','.rryyrr.','rryyyyrr','.bbyybb.','.bb..bb.'];
  var COMMANDO=['.gggg..','.gssg..','sskkss.','.ggggkk','.gGGgkk','bbGGbb.','.b..b..'];
  var EXBIKE=['.rrrr..','.rssr..','..ss...','.bbbbk.','bbyybkk','bbyyybb','.k..k..'];

  var SPRITES = {
    pacman:function(g,cx,cy,box,e){ var R=box*0.46, open=(0.10+0.60*e.p)*(Math.PI*0.5);
      g.fillStyle=e.tint('#ffe000'); g.beginPath(); g.moveTo(cx,cy); g.arc(cx,cy,R, open, Math.PI*2-open); g.closePath(); g.fill();
      g.fillStyle='#181018'; g.beginPath(); g.arc(cx+R*0.05, cy-R*0.46, R*0.14, 0, 7); g.fill(); },
    galaga:  gridSprite([GAL], {W:'#e8e8f0', R:'#ff2828', r:'#c00000'}, 'pulse'),
    frogger: gridSprite([FROG_REST, FROG_HOP], {G:'#58f858', D:'#108810', E:'#f8f8f8', P:'#101010'}, 'hop'),
    qbert:   gridSprite([QB], {b:'#f87800', e:'#ffffff', p:'#000000', n:'#f87800', f:'#48b800'}, 'hop'),
    tetris:function(g,cx,cy,box,e){ var COLS=['#00e8d8','#f8d878','#b048f8','#58d854','#f83800','#5078f8','#fca044'];
      var col=e.bright(COLS[e.bar%COLS.length]), s=box*0.27, cells=[[-1,-0.5],[0,-0.5],[1,-0.5],[0,0.5]];   // a T-piece
      for(var i=0;i<4;i++){ var bx=cx+cells[i][0]*s, by=cy+cells[i][1]*s*2;
        g.fillStyle=col; g.fillRect(bx-s*0.5,by-s*0.5,s*0.94,s*0.94);
        g.fillStyle='rgba(255,255,255,.32)'; g.fillRect(bx-s*0.5,by-s*0.5,s*0.94,s*0.26);
        g.fillStyle='rgba(0,0,0,.22)'; g.fillRect(bx-s*0.5,by+s*0.2,s*0.94,s*0.24); } },
    balloon: gridSprite([BALL], {b:'#e84020', s:'#cfcfcf', f:'#fcd8a8', k:'#101010', g:'#00a800'}, 'pulse'),
    hexagon:function(g,cx,cy,box,e){ var R=box*0.48; g.strokeStyle=e.tint('#ff2d7e'); g.lineWidth=Math.max(2,box*0.10);
      fhex(g,cx,cy,R*0.92); g.stroke(); g.fillStyle=e.tint('#ff2d7e'); fhex(g,cx,cy,R*0.30); g.fill();
      var a=e.t*2.0; g.fillStyle='#fdf500'; g.beginPath(); g.arc(cx+Math.cos(a)*R*0.66, cy+Math.sin(a)*R*0.66, R*0.13, 0, 7); g.fill(); },
    dk:      gridSprite([DK_A, DK_B], {r:'#d03020', s:'#fcb890', b:'#0058f8'}, 'walk'),
    frogger_alt:null,
    mario:   gridSprite([MARIO_STAND, MARIO_RUN], {r:'#d03020', b:'#0058f8', s:'#fcb890', k:'#000000', w:'#fcfcfc', h:'#882000'}, 'walk'),
    zelda:   gridSprite([LINK], {C:'#1e7818', T:'#00a800', S:'#fcb890', B:'#0040a0'}, 'pulse'),
    bomberman: gridSprite([BMAN0, BMAN1], {W:'#ffffff', P:'#f8b8d8', B:'#0058f8', L:'#3878fc', O:'#202020', S:'#d0d0d0', A:'#f83800', F:'#f8d8c0'}, 'walk'),
    mega_man_2: gridSprite([MEGA], {b:'#1438d8', B:'#1f78ff', c:'#75d8ff', w:'#ffffff', k:'#0b1038', Y:'#0f54b8'}, 'pulse'),
    metroid: gridSprite([SAMUS], {o:'#e07824', r:'#d03818', w:'#f8e080', k:'#080808', y:'#f0b030', b:'#2460c8'}, 'pulse'),
    contra: gridSprite([COMMANDO], {g:'#258c35', G:'#50c850', s:'#f0b890', k:'#0b0b0b', b:'#3058a8'}, 'walk'),
    excitebike: gridSprite([EXBIKE], {r:'#d03020', s:'#f0b890', b:'#3058d0', y:'#f8d040', k:'#101010'}, 'walk'),
    breakout:function(g,cx,cy,box,e){ var ATARI=['#d23b2e','#d77b27','#c9b328','#3f9e34'];
      var L=cx-box*0.5, T=cy-box*0.46, W=box, bh=box*0.13, gap=box*0.04, cols=3;
      for(var r=0;r<4;r++){ for(var c=0;c<cols;c++){ g.fillStyle=e.tint(ATARI[r]); g.fillRect(L+c*(W/cols)+1, T+r*(bh+1), W/cols-2, bh); } }
      g.fillStyle='#ffffff'; var bs=box*0.13; g.fillRect(cx-bs*0.5, cy+box*0.18, bs, bs);   // ball
      g.fillStyle=e.tint('#d8d8d8'); g.fillRect(cx-box*0.24, cy+box*0.38, box*0.48, box*0.12); },   // paddle
    random:function(g,cx,cy,box,e){ var R=box*0.5, k=5; g.fillStyle=e.tint('#fcd86a'); g.beginPath();
      for(var i=0;i<k*2;i++){ var rad=i%2?R*0.42:R*0.98, a=Math.PI*i/k-Math.PI/2; var px=cx+Math.cos(a)*rad, py=cy+Math.sin(a)*rad; i?g.lineTo(px,py):g.moveTo(px,py); } g.closePath(); g.fill(); }
  };
  SPRITES.smb3 = SPRITES.mario;
  delete SPRITES.frogger_alt;

  function envFor(p, t, bar, hue){ var dyn=Math.round((hue!=null?hue:0.5)*200-100 + bar*15), liftAmt=0.05+p*0.4;
    return { p:p, t:t, bar:bar, dyn:dyn, liftAmt:liftAmt,
      tint:function(h){ return tintHex(h, dyn, liftAmt); },
      bright:function(h){ return lite(h, liftAmt*0.7); } }; }

  // 32px beat-reactive favicon: rounded bg that FLASHES + hue-DRIFTS on the beat, sprite PULSES + animates.
  function favicon(g, key, v, t){ if(!v) return;
    var p=Math.max(0,Math.min(1, v.beatPulse||0)), bar=v.bar||0, hue=(v.hue!=null?v.hue:0.5);
    var dynBg=Math.round(hue*220-110 + bar*17);
    var bg=lite((typeof hueRot==='function')?hueRot('#241850', dynBg):'#241850', 0.02 + p*0.24);
    g.clearRect(0,0,32,32);
    g.fillStyle=bg; rrectPath(g,0.5,0.5,31,31,7); g.fill();
    var e=envFor(p, t, bar, hue);
    var box=25*(1+p*0.12), sp=SPRITES[key]||SPRITES.random;
    g.shadowColor=lite((typeof hueRot==='function')?hueRot('#ff60c0',e.dyn):'#ff60c0',0.2); g.shadowBlur=2+7*p;
    sp(g, 16, 16, box, e); g.shadowBlur=0;
  }
  // static PNG for the dropdown (true colours, frame 0, transparent bg) — cached per key+size.
  var _cache={};
  function drawStatic(g, key, cx, cy, box){ var e={ p:0, t:0, bar:0, dyn:0, liftAmt:0.06,
      tint:function(h){ return h; }, bright:function(h){ return h; } };
    (SPRITES[key]||SPRITES.random)(g, cx, cy, box, e); }
  function dataURL(key, px){ px=px||26; var ck=key+'@'+px; if(_cache[ck]) return _cache[ck];
    if(typeof document==='undefined') return '';
    var c=document.createElement('canvas'); c.width=c.height=px; var g=c.getContext('2d');
    drawStatic(g, key, px/2, px/2, px*0.92);
    var url=''; try{ url=c.toDataURL('image/png'); }catch(e){} _cache[ck]=url; return url; }

  return { SPRITES:SPRITES, favicon:favicon, drawStatic:drawStatic, dataURL:dataURL, keys:Object.keys(SPRITES) };
})();
