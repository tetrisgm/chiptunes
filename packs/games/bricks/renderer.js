// BRICKS renderer. Presentation only: consumes simulation state plus render modifiers.
// All "juice" here is read-only over the sim (timers/normals/pools the definition owns) and is
// deterministic + music-reactive: shake/jiggle come from hashed phases, colour from the bar hue.
const BricksRenderer = (function(){
  // compact 3x5 pixel font for the rising combo/score pops (headless-safe: pure rrects, no canvas text)
  var GLYPHS = {
    '0':['111','101','101','101','111'], '1':['010','110','010','010','111'],
    '2':['111','001','111','100','111'], '3':['111','001','111','001','111'],
    '4':['101','101','111','001','001'], '5':['111','100','111','001','111'],
    '6':['111','100','111','101','111'], '7':['111','001','010','010','010'],
    '8':['111','101','111','101','111'], '9':['111','101','111','001','111'],
    'x':['000','101','010','101','000'], '+':['000','010','111','010','000']
  };
  function glyph(ch,x,y,px,col){
    var rows=GLYPHS[ch]; if(!rows) return;
    for(var j=0;j<5;j++){ var r=rows[j]; for(var i=0;i<3;i++){ if(r[i]==='1') rrect(x+i*px,y+j*px,px,px,col); } }
  }
  function drawLabel(txt,cx,cy,px,col){
    var w=txt.length*4*px-px, sx=Math.round(cx-w/2), sy=Math.round(cy-2.5*px);
    for(var i=0;i<txt.length;i++) glyph(txt.charAt(i), sx+i*4*px, sy, px, col);
  }

  function render(ctx){
    ctx = ctx || {};
    if(!ctx.st && ctx.state){
      ctx = Object.assign({}, ctx, { st: ctx.state, V: ctx.state && ctx.state.v });
    }
    renderBackground(ctx);
    renderObjects(ctx);
  }

  function renderBackground(ctx){
    var A = ctx.A || {x:0,y:0,w:0,h:0};
    var U = ctx.U || 8;
    var st = ctx.st;
    if(!st) return;
    var V = ctx.V == null ? st.v : ctx.V;
    var lw = st.lw;

    if(V===0){ rrect(A.x,A.y,A.w,A.h,'#000000'); }
    else {
      rrect(A.x,A.y,A.w,A.h,'#05060f');
      rrect(A.x,A.y,A.w,Math.round(A.h*0.5),'#080a1a');
      for(var si=0;si<st.stars.length;si++){
        var s=st.stars[si];
        var sx=A.x+s.x*A.w, sy=A.y+s.y*A.h;
        g.globalAlpha=0.40+0.55*Math.abs(Math.sin(st.t*s.sp*4+s.tw));
        rrect(Math.round(sx),Math.round(sy),s.s,s.s,'#cdd6ff');
      }
      g.globalAlpha=1;
    }

    // COLOUR JUICE: a subtle top-gradient brighten that pulses on the beat and on breaks/drops.
    // st.bgPulse + st.barHue are computed in the sim from the shared music clock (deterministic).
    var bgp=Math.max(0,Math.min(1, st.bgPulse||0));
    if(bgp>0.01){
      g.globalAlpha=(V===0?0.05:0.07)*bgp*(0.5+0.5*(st.mvE||0.5));
      rrect(A.x,A.y,A.w,Math.round(A.h*0.62), hueRot(V===0?'#3a2a5a':'#24408a', st.barHue||0));
      g.globalAlpha=1;
    }

    // Collision still uses the inset playfield, but its rails are intentionally
    // invisible. Full-height light strips read as broken monitor borders when
    // this game is used as a desktop wallpaper.
  }

  function renderObjects(ctx){
    var A = ctx.A || {x:0,y:0,w:0,h:0};
    var U = ctx.U || 8;
    var st = ctx.st;
    if(!st) return;
    var V = ctx.V == null ? st.v : ctx.V;
    // SCREEN SHAKE: offset the whole draw by a deterministic 2-sine wobble (no Math.random),
    // scaled by st.shake (which the sim bumps per event and decays). Decay itself lives in the sim.
    var ox=0, oy=0, sh=st.shake||0;
    if (sh>0.01){
      var q=(st.t||0)*57.0;
      ox=(Math.sin(q*1.7)+Math.sin(q*2.9))*0.5*sh*U*1.2;
      oy=(Math.sin(q*2.3+1.7)+Math.sin(q*1.3+0.5))*0.5*sh*U*1.2;
    }
    g.save(); g.translate(ox,oy);

    drawBricks(st,U,V);
    for (var dc=0; dc<st.caps.length; dc++) drawCapsule(st.caps[dc],U);
    for (var dp=0; dp<st.parts.length; dp++){
      var pp=st.parts[dp];
      g.globalAlpha=Math.max(0,Math.min(1,pp.life/0.4));
      rrect(Math.round(pp.x),Math.round(pp.y),pp.s,pp.s,pp.col);
    }
    g.globalAlpha=1;
    drawPaddle(st,U,V);
    for (var db=0; db<st.balls.length; db++){
      drawBallFx(st.balls[db], st, U, V);
      drawBall(st.balls[db], st, U, V);
    }
    // COMBO / SCORE pops rise where bricks died (drawn on top of the field, inside the shake)
    for (var dq=0; dq<st.pops.length; dq++) drawPop(st.pops[dq], st);
    g.globalAlpha=1;
    g.restore();

    if (st.flash>0.01){
      g.globalAlpha=Math.min(0.5,st.flash);
      rrect(A.x,A.y,A.w,A.h,V===0?'#ffffff':'#9fb4ff');
      g.globalAlpha=1;
    }
  }

  function drawBallFx(bb, st, U, V){
    var r=Math.max(2,Math.round(bb.r));
    var sp=Math.hypot(bb.vx||0,bb.vy||0), spd=Math.min(1, sp/((st.baseSpeed||620)||1));
    var en=st.mvE||0.5;
    var bp=Math.max(0,Math.min(1,((st.beatPulse||1)-1)/0.06));   // beat pulse -> 0..1
    var glowCol = V===0 ? '#ffcf8c' : '#9fc6ff';
    // TRAIL: fading ghosts along recent positions, brighter with speed + energy (deterministic ring buffer)
    if(bb.trail){
      for(var k=0;k<7;k++){
        var idx=(bb.trailHead+1+k)%8, t=bb.trail[idx], frac=k/7;
        var rr=Math.max(1,Math.round(r*(0.35+0.6*frac)));
        g.globalAlpha=frac*0.42*(0.4+0.6*spd);
        rrect(Math.round(t.x-rr),Math.round(t.y-rr),rr*2,rr*2,glowCol);
      }
    }
    // GLOW: a soft halo behind the ball that breathes on the beat
    var gr=Math.round(r*(1.7+0.6*bp));
    g.globalAlpha=0.10+0.14*en+0.12*bp;
    rrect(Math.round(bb.x-gr),Math.round(bb.y-gr),gr*2,gr*2,glowCol);
    g.globalAlpha=1;
  }

  function drawBall(bb, st, U, V){
    var r=Math.max(2,Math.round(bb.r));
    // SQUASH & STRETCH: scale down along the contact normal, up along the tangent, for a few frames.
    var sqt=Math.max(0,Math.min(1,(bb.sqT||0)/0.13)), amt=0.42*sqt;
    var sx=1, sy=1;
    if(amt>0.001){ if(bb.snx){ sx=1-amt; sy=1+amt; } else { sx=1+amt; sy=1-amt; } }
    g.save();
    g.translate(bb.x,bb.y);
    if(amt>0.001) g.scale(sx,sy);
    if(V===0){ rrect(-r,-r,r*2,r*2,'#ffffff'); }
    else { rrect(-r,-r,r*2,r*2,'#f4f6ff'); rrect(-r,-r,r,r,'#ffffff'); }
    g.restore();
  }

  function drawPop(q, st){
    if(!q || q.life<=0) return;
    var a=Math.max(0,Math.min(1,q.life/(q.max||0.55)));
    var combo=q.combo|0;
    var px=Math.max(1,Math.round((q.s||3)*(combo>=3?1.15:0.9)));
    var txt=combo>=2 ? ('x'+combo) : '+';
    var col=combo>=3 ? '#fff2a8' : '#ffffff';
    g.globalAlpha=a*0.55;
    drawLabel(txt, q.x+px, q.y+px, px, '#20140a');   // drop shadow for readability on any brick colour
    g.globalAlpha=a;
    drawLabel(txt, q.x, q.y, px, col);
    g.globalAlpha=1;
  }

  function drawBricks(st,U,V){
    var gap=Math.max(1,Math.round(st.brickW*0.05));
    var pulse=st.beatPulse||1, bh=st.barHue||0;
    // bricks share a ~7-color palette and barHue is frame-constant: compute each distinct color's
    // hueRot + 4 shades ONCE per frame instead of per brick (same strings -> bit-identical output).
    var colCache={};
    for(var i=0;i<st.bricks.length;i++){
      var br=st.bricks[i];
      if(!br.a) continue;
      var R=brickRect(st,br);
      var x=Math.round(R.x), y=Math.round(R.y), w=Math.max(2,Math.round(R.w-gap)), h=Math.max(2,Math.round(R.h));
      var gw=Math.round(w*pulse), gh=Math.round(h*pulse);
      x-=Math.round((gw-w)/2); y-=Math.round((gh-h)/2); w=gw; h=gh;
      // NEIGHBOUR JIGGLE: a decaying wobble when an adjacent brick just broke (per-brick phase = deterministic)
      if(br.jig>0){
        var jp=br.gx*0.7+br.gy*1.3, ja=Math.max(1,U*0.5);
        x+=Math.round(Math.sin(st.t*38+jp)*br.jig*ja);
        y+=Math.round(Math.cos(st.t*33+jp)*br.jig*ja*0.7);
      }
      var cc=colCache[br.col];
      if(!cc){ var base=hueRot(br.col,bh); cc=colCache[br.col]={col:base,hi14:shade(base,1.4),hi125:shade(base,1.25),lo06:shade(base,0.6)}; }
      var col=cc.col;
      if(V===0){ rrect(x,y,w,h,col); }
      else {
        rrect(x,y,w,h,col);
        var bv=Math.max(1,Math.round(U*0.25));
        rrect(x,y,w,bv,cc.hi14);
        rrect(x,y,bv,h,cc.hi125);
        rrect(x,y+h-bv,w,bv,cc.lo06);
        rrect(x+w-bv,y,bv,h,cc.lo06);
        if((br.kind==='silver'||br.kind==='gold') && br.hp>=br.maxhp) rrect(x+bv*2,y+bv,Math.max(1,bv),Math.max(1,bv),'#ffffff');
      }
      // HIT FLASH: brick blanks to white on impact (survivors + break neighbours), fades in the sim
      if(br.flash>0){ g.globalAlpha=Math.min(0.85,br.flash); rrect(x,y,w,h,'#ffffff'); g.globalAlpha=1; }
    }
  }

  function drawCapsule(c,U){
    var x=Math.round(c.x),y=Math.round(c.y),w=Math.round(c.w),h=Math.round(c.h);
    var ph=0.5+0.5*Math.sin(c.spin*2);
    rrect(x,y,w,h,c.col);
    rrect(x,y,w,Math.max(1,Math.round(h*0.18)),shade(c.col,1.5));
    rrect(x,y+h-Math.max(1,Math.round(h*0.18)),w,Math.max(1,Math.round(h*0.18)),shade(c.col,0.55));
    var cw=Math.max(2,Math.round(w*0.22));
    g.globalAlpha=0.6+0.4*ph;
    if(c.kind==='expand'){
      rrect(x+Math.round(w*0.18),y+Math.round(h*0.4),Math.round(w*0.64),Math.max(1,Math.round(h*0.2)),'#ffffff');
    } else {
      rrect(x+Math.round(w/2-cw/2),y+Math.round(h*0.25),cw,Math.round(h*0.5),'#ffffff');
    }
    g.globalAlpha=1;
  }

  function drawPaddle(st,U,V){
    // SQUASH & TILT: the paddle briefly flattens (grows wide, thins) and tips toward the contact side
    // when it bounces the ball. st.padSq/st.padTilt are set on the bounce and eased out in the sim.
    var sq=Math.max(0,Math.min(1,st.padSq||0)), tilt=Math.max(-1,Math.min(1,st.padTilt||0));
    var cx=st.px+st.pw/2, cy=st.py+st.ph/2, transformed=false;
    if(sq>0.001){
      transformed=true;
      g.save();
      g.translate(cx,cy);
      g.rotate(tilt*sq*0.14);
      g.scale(1+0.12*sq, 1-0.22*sq);
      g.translate(-cx,-cy);
    }
    var x=Math.round(st.px),y=Math.round(st.py),w=Math.round(st.pw),h=Math.round(st.ph);
    // The PLAYER. Both variants paint the paddle in near-whites, which land on
    // the field shade -- it was a white bar on a white floor. On the panel it is
    // ink with a lit cap: the one object the player's eye has to track.
    var _PP=(typeof CT_PAL!=='undefined')&&CT_PAL;
    if(_PP&&_PP.installed){
      rrect(x,y,w,h,_PP.role('ink'));
      rrect(x+1,y+1,Math.max(1,w-2),Math.max(1,Math.round(h*0.45)),_PP.role('back'));
      if(transformed) g.restore();
      return;
    }
    if(V===0){ rrect(x,y,w,h,'#d8d8d8'); rrect(x,y,w,Math.max(1,Math.round(h*0.4)),'#ffffff'); }
    else {
      var cap=Math.max(3,Math.round(h*1.0));
      rrect(x+cap,y,w-cap*2,h,'#c43a2e');
      rrect(x+cap,y,w-cap*2,Math.max(1,Math.round(h*0.35)),'#e0584a');
      rrect(x+cap,y+h-Math.max(1,Math.round(h*0.3)),w-cap*2,Math.max(1,Math.round(h*0.3)),'#7a1f17');
      var deckW=Math.max(4,Math.round((w-cap*2)*0.4));
      rrect(x+Math.round(w/2-deckW/2),y,deckW,h,'#9aa0b8');
      rrect(x+Math.round(w/2-deckW/2),y,deckW,Math.max(1,Math.round(h*0.4)),'#c3c8de');
      var pulse=0.6+0.4*Math.abs(Math.sin(st.t*6));
      g.globalAlpha=pulse;
      rrect(x,y,cap,h,'#9fc6ff'); rrect(x+w-cap,y,cap,h,'#9fc6ff');
      g.globalAlpha=1;
      rrect(x+Math.round(cap*0.25),y+Math.round(h*0.25),Math.max(1,Math.round(cap*0.5)),Math.max(1,Math.round(h*0.5)),'#ffffff');
      rrect(x+w-cap+Math.round(cap*0.25),y+Math.round(h*0.25),Math.max(1,Math.round(cap*0.5)),Math.max(1,Math.round(h*0.5)),'#ffffff');
    }
    if(transformed) g.restore();
  }

  function brickRect(st,br){
    var lw=st.lw;
    return {
      x:st.ax+lw+br.gx*st.brickW,
      y:st.topY+br.gy*(st.brickH+st.brickGap),
      w:st.brickW,
      h:st.brickH
    };
  }

  function shade(hex, f){
    // On the four-shade panel a MULTIPLICATIVE darken is not a shade step:
    // 0.62 and 0.42 of the same colour routinely quantise onto the level the
    // face already had, and the solid loses its edges entirely -- the pyramid
    // had no visible playing field at all. Move whole shades instead.
    var _P = (typeof CT_PAL !== 'undefined') && CT_PAL;
    // Directional: f>1 is a HIGHLIGHT and must go one shade toward the field,
  // f<1 a shadow going one shade toward ink. Collapsing both onto the same
  // step gave every brick an identical top and bottom edge -- no relief, so
  // the wall read as flat tiles instead of bricks.
  if(_P && _P.installed) return _P.step(hex, f >= 1 ? -1 : 1);

    if(typeof hex!=='string'||hex[0]!=='#'||hex.length<7) return hex;
    var r=parseInt(hex.slice(1,3),16),gg=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
    r=Math.max(0,Math.min(255,Math.round(r*f)));
    gg=Math.max(0,Math.min(255,Math.round(gg*f)));
    b=Math.max(0,Math.min(255,Math.round(b*f)));
    var h=function(n){ return n.toString(16).padStart(2,'0'); };
    return '#'+h(r)+h(gg)+h(b);
  }

  return {
    render: render,
    renderBackground: renderBackground,
    renderObjects: renderObjects,
    drawBricks: drawBricks,
    drawCapsule: drawCapsule,
    drawPaddle: drawPaddle
  };
})();

(function(){
  VisualizerGame.layer('bricks', 'renderer', {
    packVersion: 2,
    key: "bricks",
    adapter: "custom-canvas-pack",
    presentation: [
      "brick grid",
      "pixel paddle/ball",
      "impact flashes",
      "pooled fragments",
      "strict multiball cap"
    ],
    performance: {
      oneActiveLoop: true,
      ownsAnimationLoop: false,
      maxEntities: 5000,
      maxParticles: 1800,
      maxEventsPerFrame: 64,
      usesReactStatePerFrame: false,
      allocations: "renderer owns all draw helpers and uses the shared pack runner"
    },
    drawContract: [
      "consume simulation state and render modifiers",
      "keep collision state separate from visual pulses",
      "pool or cap transient effects",
      "skip heavy visual work when the runtime enters background audio mode"
    ],
    render: BricksRenderer.render,
    dispose: function(){}
  });
})();
