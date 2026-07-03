// SUPER HEXAGON renderer. Presentation only; consumes HexagonDefinition's hexagonView payload.
const HexagonRenderer = (function(){
  function render(ctx){
    ctx = ctx || {};
    var view = ctx.hexagonView || ctx.view;
    if(!view || typeof g === 'undefined') return undefined;
    var A = view.A || {x:0, y:0, w:0, h:0};
    var U = view.U || 8;
    var st = view.st || ctx.state || ctx.st;
    if(!st) return undefined;
    var col = view.col || st.col || {};
    var cx = view.cx == null ? A.x + A.w * 0.5 : view.cx;
    var cy = view.cy == null ? A.y + A.h * 0.5 : view.cy;
    var maxR = view.maxR == null ? Math.min(A.w, A.h) * 0.52 : view.maxR;
    var F = view.F || {};
    var cl = view.cl || {};
    var bpm = Math.max(55, Math.min(240, view.bpm || 165));
    var energy = Math.max(0, Math.min(1, view.energy == null ? 0.45 : view.energy));
    var beatPulse = Math.max(0, Math.min(1, view.beatPulse || 0));
    var SEC = HexagonDefinition.SEC;
    var SIDES = HexagonDefinition.SIDES;
    var hasWall = HexagonDefinition.hasWall;
    var sh = st.shake * (4 + energy*4) * U;
    var ox = cx + Math.sin(st.t*31.1) * sh;
    var oy = cy + Math.cos(st.t*27.3) * sh;
    var barHue = (typeof MV !== 'undefined' && MV.barHue) ? MV.barHue(cl) : 0;
    var baseH = (((cl.hue||0.5)*360 + st.huePhase + barHue + st.hueFamily) % 360 + 360) % 360;
    var pul = beatPulse * 0.85 + (F.drop ? 0.22 : 0);
    var HS = function(h,s,l){ return 'hsl('+(Math.round(((h%360)+360)%360))+','+s+'%,'+Math.round(Math.min(96,Math.max(0,l)))+'%)'; };
    var bgA = HS(baseH + (st.bgFlip?120:0), 62, 7 + pul*5 + energy*4);
    var bgB = HS(baseH + 24 + (st.bgFlip?120:0), 58, 13 + pul*8 + energy*5);
    var wallA = HS(baseH + 150, 92, 54 + pul*18);
    var wallB = HS(baseH + 210, 95, 58 + pul*15);
    var wallC = HS(baseH + 58, 92, 56 + pul*12);
    var coreCol = HS(baseH + 150, 92, 58 + pul*18);

    rrect(A.x,A.y,A.w,A.h, bgA);
    for(var s=0;s<SIDES;s++){
      var a0=s*SEC+st.rot, a1=a0+SEC;
      g.beginPath();
      g.moveTo(ox,oy);
      g.lineTo(ox+Math.cos(a0)*maxR*1.65, oy+Math.sin(a0)*maxR*1.65);
      g.lineTo(ox+Math.cos(a1)*maxR*1.65, oy+Math.sin(a1)*maxR*1.65);
      g.closePath();
      g.fillStyle=(s%2===0) ? bgB : bgA;
      g.fill();
    }

    var zoom = beatPulse * (F.drop ? 0.075 : 0.035);
    function drawRing(R, idx){
      var rin = R.r * (1 + zoom), thick = st.thick * (R.thickScale || 1) * (1 + zoom*1.8), rout = rin + thick;
      if(rout <= 0) return;
      for(var s2=0;s2<SIDES;s2++){
        if(!hasWall(R.mask, s2)) continue;
        var b0=s2*SEC+st.rot, b1=b0+SEC;
        g.beginPath();
        g.moveTo(ox+Math.cos(b0)*rin, oy+Math.sin(b0)*rin);
        g.lineTo(ox+Math.cos(b0)*rout, oy+Math.sin(b0)*rout);
        g.lineTo(ox+Math.cos(b1)*rout, oy+Math.sin(b1)*rout);
        g.lineTo(ox+Math.cos(b1)*rin, oy+Math.sin(b1)*rin);
        g.closePath();
        g.fillStyle = (s2 + idx + st.sectorParity) % 3 === 0 ? wallC : (((idx+st.sectorParity)%2)===0 ? wallA : wallB);
        g.fill();
      }
    }
    for(var i=0;i<st.rings.length;i++) drawRing(st.rings[i], i);

    var cr = st.coreR * (1 + 0.16*(beatPulse || (view.paused ? 0.18 + 0.08*Math.sin(st.t*2.0) : 0)));
    g.beginPath();
    for(var h=0;h<SIDES;h++){
      var ha=h*SEC+st.rot;
      var px=ox+Math.cos(ha)*cr, py=oy+Math.sin(ha)*cr;
      if(h===0) g.moveTo(px,py); else g.lineTo(px,py);
    }
    g.closePath();
    g.fillStyle=coreCol;
    g.fill();
    g.lineWidth=Math.max(1,1.5*U);
    g.strokeStyle=col.coreEdge;
    g.stroke();

    var pa=st.cursorA, pr=st.cursorR;
    var tipR=pr+3.7*U, baseR=pr-0.6*U, hw=SEC*0.16;
    g.beginPath();
    g.moveTo(ox+Math.cos(pa)*tipR, oy+Math.sin(pa)*tipR);
    g.lineTo(ox+Math.cos(pa-hw)*baseR, oy+Math.sin(pa-hw)*baseR);
    g.lineTo(ox+Math.cos(pa+hw)*baseR, oy+Math.sin(pa+hw)*baseR);
    g.closePath();
    g.fillStyle=(st.hit>0 && (Math.floor(st.t*30)&1)) ? col.hitFlash : col.cursor;
    g.fill();

    if(st.flash>0){
      g.save();
      g.globalAlpha=st.flash*0.46;
      rrect(A.x,A.y,A.w,A.h, col.hitFlash);
      g.globalAlpha=1;
      g.restore();
    }
    return st;
  }

  return { render: render };
})();

(function(){
  VisualizerGame.layer('hexagon', 'renderer', {
    packVersion: 3,
    key: "hexagon",
    adapter: "custom-canvas-pack",
    presentation: [
      "radial mask-sector canvas paths",
      "pixel cursor",
      "scanline",
      "authored wall mask patterns",
      "no persistent layout mutation"
    ],
    performance: {
      oneActiveLoop: true,
      ownsAnimationLoop: false,
      maxEntities: 64,
      maxParticles: 0,
      maxEventsPerFrame: 64,
      usesReactStatePerFrame: false,
      allocations: "renderer consumes hexagonView from HexagonDefinition.update"
    },
    drawContract: [
      "consume simulation state and render modifiers",
      "keep collision state separate from visual pulses",
      "pool or cap transient effects",
      "skip heavy visual work when the runtime enters background audio mode"
    ],
    render: HexagonRenderer.render,
    dispose: function(ctx){
      if(ctx && ctx.state && ctx.state.$viz) ctx.state.$viz.disposed = true;
    }
  });
})();
