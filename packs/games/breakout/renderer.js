// BREAKOUT renderer. Presentation only: consumes simulation state plus render modifiers.
const BreakoutRenderer = (function(){
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

    if(V===0){
      rrect(st.ax,st.ay,lw,st.ah,'#bdbdbd');
      rrect(st.ax+st.aw-lw,st.ay,lw,st.ah,'#bdbdbd');
      rrect(st.ax,st.ay,st.aw,lw,'#bdbdbd');
    } else {
      rrect(st.ax,st.ay,lw,st.ah,'#7a7f96');
      rrect(st.ax+st.aw-lw,st.ay,lw,st.ah,'#7a7f96');
      rrect(st.ax,st.ay,st.aw,lw,'#7a7f96');
      var e=Math.max(2,U*0.3);
      rrect(st.ax+lw-e,st.ay+lw,e,st.ah-lw,'#c3c8de');
      rrect(st.ax+st.aw-lw,st.ay+lw,e,st.ah-lw,'#42465c');
      rrect(st.ax+lw,st.ay+lw-e,st.aw-lw*2,e,'#c3c8de');
      var bsz=Math.max(2,Math.round(U*0.5));
      for(var bx=st.ax+lw*1.5;bx<st.ax+st.aw-lw;bx+=lw*2.2)
        rrect(Math.round(bx),Math.round(st.ay+lw*0.4),bsz,bsz,'#cfd4ea');
      for(var by=st.ay+lw*1.6;by<st.ay+st.ah-lw;by+=lw*2.4){
        rrect(Math.round(st.ax+lw*0.4),Math.round(by),bsz,bsz,'#cfd4ea');
        rrect(Math.round(st.ax+st.aw-lw*0.6),Math.round(by),bsz,bsz,'#cfd4ea');
      }
    }
  }

  function renderObjects(ctx){
    var A = ctx.A || {x:0,y:0,w:0,h:0};
    var U = ctx.U || 8;
    var st = ctx.st;
    if(!st) return;
    var V = ctx.V == null ? st.v : ctx.V;
    var ox=0, oy=0;
    if (st.shake>0.01){ ox=(Math.random()-0.5)*st.shake*U*1.2; oy=(Math.random()-0.5)*st.shake*U*1.2; st.shake*=0.85; }
    else st.shake=0;
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
      var bb=st.balls[db];
      var r=Math.max(2,Math.round(bb.r));
      if(V===0){ rrect(Math.round(bb.x-r),Math.round(bb.y-r),r*2,r*2,'#ffffff'); }
      else { rrect(Math.round(bb.x-r),Math.round(bb.y-r),r*2,r*2,'#f4f6ff'); rrect(Math.round(bb.x-r),Math.round(bb.y-r),r,r,'#ffffff'); }
    }
    g.restore();

    drawHud(st,U,V);

    if (st.flash>0.01){
      g.globalAlpha=Math.min(0.5,st.flash);
      rrect(A.x,A.y,A.w,A.h,V===0?'#ffffff':'#9fb4ff');
      g.globalAlpha=1; st.flash*=0.82;
    } else st.flash=0;
  }

  function drawBricks(st,U,V){
    var gap=Math.max(1,Math.round(st.brickW*0.05));
    var pulse=st.beatPulse||1, bh=st.barHue||0;
    for(var i=0;i<st.bricks.length;i++){
      var br=st.bricks[i];
      if(!br.a) continue;
      var R=brickRect(st,br);
      var x=Math.round(R.x), y=Math.round(R.y), w=Math.max(2,Math.round(R.w-gap)), h=Math.max(2,Math.round(R.h));
      var gw=Math.round(w*pulse), gh=Math.round(h*pulse);
      x-=Math.round((gw-w)/2); y-=Math.round((gh-h)/2); w=gw; h=gh;
      var col=hueRot(br.col,bh);
      if(V===0){ rrect(x,y,w,h,col); }
      else {
        rrect(x,y,w,h,col);
        var bv=Math.max(1,Math.round(U*0.25));
        rrect(x,y,w,bv,shade(col,1.4));
        rrect(x,y,bv,h,shade(col,1.25));
        rrect(x,y+h-bv,w,bv,shade(col,0.6));
        rrect(x+w-bv,y,bv,h,shade(col,0.6));
        if((br.kind==='silver'||br.kind==='gold') && br.hp>=br.maxhp) rrect(x+bv*2,y+bv,Math.max(1,bv),Math.max(1,bv),'#ffffff');
      }
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
    var x=Math.round(st.px),y=Math.round(st.py),w=Math.round(st.pw),h=Math.round(st.ph);
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
  }

  function drawHud(st,U,V){
    var pad=Math.max(2,Math.round(U*0.6));
    var bw=Math.max(2,Math.round(U*0.9)), bh=Math.max(2,Math.round(U*0.9)), bg=Math.max(1,Math.round(U*0.4));
    var ly=st.ay+st.lw+pad;
    var rxr=st.ax+st.aw-st.lw-pad;
    for(var j=0;j<st.level && j<12;j++){
      rrect(rxr-(j+1)*(bw*0.6+bg), ly, Math.max(1,Math.round(bw*0.6)), bh, V===0?'#c9b328':'#caa23a');
    }
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

  function shade(hex,f){
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
    drawPaddle: drawPaddle,
    drawHud: drawHud
  };
})();

(function(){
  VisualizerGame.layer('breakout', 'renderer', {
    packVersion: 2,
    key: "breakout",
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
    render: BreakoutRenderer.render,
    dispose: function(){}
  });
})();
