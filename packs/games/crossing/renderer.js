// CROSSING renderer. Presentation only: consumes simulation state plus render inputs.
const CrossingRenderer = (function(){
  function render(ctx){
    ctx = ctx || {};
    var A = ctx.A || {x:0,y:0,w:0,h:0};
    var st = ctx.state || ctx.st;
    if(!st) return;

    var view = ctx.crossingView || ctx.view || {};
    var cl = view.cl || {};
    var viewX = view.viewX == null ? A.x : view.viewX;
    var viewY = view.viewY == null ? A.y : view.viewY;
    var viewW = view.viewW == null ? A.w : view.viewW;
    var viewH = view.viewH == null ? A.h : view.viewH;
    var X = view.X == null ? viewX : view.X;
    var Y = view.Y == null ? viewY : view.Y;
    var W = view.W == null ? viewW : view.W;
    var H = view.H == null ? viewH : view.H;
    // Stretched across 16:9 the board gave 28px-wide columns against 11px-tall
    // lanes, so every vehicle drew 26x8 -- a letterbox slot no silhouette can
    // survive. Keep the board Game-Boy-shaped and centred; the sides show field,
    // which is what a handheld crossing game looks like on a wide screen.
    // NOTE: an earlier attempt clamped X/W here to force Game Boy proportions.
    // It desynced the board: the lane backgrounds moved with X/W while vehicles
    // and logs keep their own world coordinates through the definition, so the
    // water rows and the road rows drew at different widths. The board's layout
    // belongs to the definition; the renderer only simplifies what it draws.
    var _GB = (typeof CT_DMG_NATIVE !== 'undefined') && !!CT_DMG_NATIVE;
    var cw = view.cw || Math.max(1, W / (st.cols || 9));
    var ch = view.ch || Math.max(1, H / (st.rows || 13));
    if(_GB){
      // SQUARE cells. 9 columns across 260px against 13 rows in 135px gives
      // 29x10 tiles -- every car a letterbox slot, which is what made the board
      // look wrong. Deriving cw from ch and re-centring keeps lanes, vehicles
      // and logs on the SAME grid (the last attempt moved only the lanes and
      // the board tore in half).
      cw = ch;
      var bw2 = cw * (st.cols || 9);
      X = X + Math.round(((view.W == null ? viewW : view.W) - bw2) * 0.5);
      W = bw2;
    }
    var cols = view.cols || st.cols || 9;
    var roadEnd=view.roadEnd==null?(st.roadEnd||5):view.roadEnd;
    var medianRow=view.medianRow==null?(st.medianRow||6):view.medianRow;
    var riverStart=view.riverStart==null?(st.riverStart||7):view.riverStart;
    var riverEnd=view.riverEnd==null?(st.riverEnd||11):view.riverEnd;
    var homeRow=view.homeRow==null?(st.homeRow||12):view.homeRow;
    var slotCols = view.slotCols || st.slotCols || [0.5,2.0,3.7,5.4,7.2];
    var bayW = view.bayW || st.bayW || 1.3;
    var spriteU = view.spriteU || Math.max(1, Math.floor(cw / 10));
    var bHue = view.bHue == null ? MV.barHue(cl) : view.bHue;
    var objPulse = view.objPulse == null ? MV.pulse(cl, view.drop ? 0.24 : 0.15) : view.objPulse;
    var hopping = !!view.hopping;
    var night = view.night == null ? !!st.night : !!view.night;
    var _PX0 = (typeof CT_PAL !== 'undefined') && CT_PAL;
    var _rolesOn = _PX0 && _PX0.installed;
    // Authored in colour the grass is 0.34 luma and the road near-black, so the
    // road quantised to the FIELD and the grass to dark ink -- the board came
    // out inverted, everything dark except the frog. Assign the surfaces.
    // The ROAD takes the field shade and the grass steps in one. The frog is a
    // hero, so it is drawn from ink / fore / back -- with the road on 'back' it
    // shared a shade with the thing standing on it and vanished into the tarmac.
    // The field shade is the one surface no character can ever occupy.
    var grassCol = _rolesOn ? _PX0.role('back')  : (view.grassCol || hueRot(night ? '#0a3a14' : '#187818', bHue));
    var roadCol  = _rolesOn ? _PX0.role('field') : (view.roadCol || (night ? '#0c0c12' : '#181818'));
    var riverCol = _rolesOn ? _PX0.role('ink')  : (view.riverCol || (night ? '#081858' : '#0028b0'));
    var riverLite = view.riverLite || (night ? '#1030a0' : '#3050d8');
    var riverGlow = view.riverGlow || (night ? '#2848c8' : '#5878f8');
    var bgCol = view.bgCol || (night ? '#02040f' : '#000000');

    function rowTopY(r){ return Y + H - (r+1)*ch; }
    function colX(c){ return X + c*cw; }

    rrect(viewX, viewY, viewW, viewH, bgCol);
    rrect(X, Y, W, H, bgCol);
    rrect(X, rowTopY(0), W, ch, grassCol);
    rrect(X, rowTopY(medianRow), W, ch, grassCol);
    rrect(X, rowTopY(roadEnd), W, ch*roadEnd, roadCol);

    var dashCol = hueRot(night ? '#383848' : '#c8c800', bHue);
    for(var lr=1; lr<roadEnd; lr++){
      var ly = rowTopY(lr);
      var step = cw*(st.mvDashSkew||0.9);
      var dn = Math.floor(W/step)+2;
      var shift = (st.t*10) % step;
      for(var d=0; d<dn; d++){
        var dx = X + d*step - shift;
        if(dx >= X-step && dx < X+W-cw*0.3){
          if(!isSimple()) rrect(Math.floor(dx), Math.floor(ly), Math.max(2,spriteU*0.7), 2, dashCol);
        }
      }
    }

    rrect(X, rowTopY(riverEnd), W, ch*(riverEnd-riverStart+1), riverCol);
    var beat = MV.beat(cl);
    for(var rr2=riverStart; rr2<=riverEnd; rr2++){
      var ry = rowTopY(rr2);
      for(var sx=0; sx<W; sx+=cw){
        var shp = Math.sin((sx*0.02) + st.t*2 + rr2 + (st.mvWaterShift||0)*1.7)*0.5+0.5;
        if(shp>0.6){
          if(!isSimple()) rrect(Math.floor(X+sx), Math.floor(ry+ch*0.5), Math.max(2,spriteU*0.6), Math.max(2, Math.round(2+beat*4)), (beat>0.4?riverGlow:riverLite));
        }
      }
    }

    var bayY = rowTopY(homeRow);
    var hedgeBase = (night ? ['#582888','#3a4898','#883060'] : ['#a020c0','#3060d0','#c03070'])[st.mvHedgeFam||0];
    var hedge = hueRot(hedgeBase, bHue);
    var bayDark = night ? '#020a04' : '#031003';
    rrect(X, bayY, W, ch, hedge);
    for(var hb=0; hb<5; hb++){
      var hx = colX(slotCols[hb]);
      rrect(Math.floor(hx), Math.floor(bayY+ch*0.06), Math.ceil(cw*bayW), Math.ceil(ch*0.88), bayDark);
      if(st.homes[hb]){
        drawFrog(Math.floor(hx+cw*0.1), Math.floor(bayY+ch*0.16), spriteU*0.95, 0, 0, false);
      }
    }
    rrect(X, Y, W, Math.max(2,ch*0.12), hedge);

    for(var ii=0;ii<st.road.length;ii++){
      var ln2 = st.road[ii];
      var ly2 = rowTopY(ln2.row);
      var laneHue = hueRot(ln2.col, bHue);
      for(var c3=0;c3<ln2.cars.length;c3++){
        var vx = colX(ln2.cars[c3].pos);
        var vcol = hueRot(laneHue, (c3 - (ln2.cars.length-1)/2) * 11);
        drawVehicle(vx, ly2, ch, cw, ln2.kind, vcol, ln2.dir, night, objPulse);
      }
    }

    for(var jj=0;jj<st.river.length;jj++){
      var rw2 = st.river[jj];
      var ry2 = rowTopY(rw2.row);
      var objW = cw*rw2.len;
      for(var oo=0;oo<rw2.items.length;oo++){
        var it2 = rw2.items[oo];
        var ox = colX(it2.pos);
        if(rw2.kind==='log'){
          drawLog(ox, ry2, objW, ch, night, objPulse);
        } else {
          drawTurtles(ox, ry2, rw2.len, cw, ch, night, (it2._sval===undefined?1:it2._sval), objPulse);
        }
      }
    }

    if(st.win<=0 || (Math.floor(st.t*12)%2===0)){
      if(st.dead>0){
        drawSplat(colX(st.hitX), rowTopY(st.hitY), cw, ch, st.dead, st.deadKind, night, spriteU);
      } else {
        var fpx = colX(st.fcol) + cw*0.08;
        var fpy = rowTopY(st.frow) + ch*0.1;
        var hopAmt = hopping ? Math.sin((1 - Math.max(0,st.hopT)/st.hopDur)*Math.PI) : 0;
        var hopLift = hopAmt * ch*0.34;
        drawFrog(Math.floor(fpx), Math.floor(fpy - hopLift), spriteU, hopAmt, st.facing, true);
      }
    }

    if(st.flash>0){
      g.globalAlpha = st.flash*0.4;
      rrect(X, Y, W, H, night ? '#3050ff' : '#ffffff');
      g.globalAlpha = 1;
    }
  }

  function drawFrog(px, py, u, hop, facing, alive){
    var map = {
      'G': alive ? '#58f858' : '#40c040',
      'D': alive ? '#108810' : '#0a5808',
      'E': '#f8f8f8',
      'P': '#101010'
    };
    var rowsArt;
    if(hop>0.4){
      rowsArt = [
        '..D...D..',
        '.DGGGGGD.',
        '.GGGGGGG.',
        '.GEPGPEG.',
        '.GGGGGGG.',
        '.DGGGGGD.',
        '..DG.GD..',
        '.........'
      ];
    } else {
      rowsArt = [
        'D...G...D',
        'DD.GGG.DD',
        '.GEPGPEG.',
        '.GGGGGGG.',
        'GGGGGGGGG',
        '.GGGGGGG.',
        'DG.G.G.GD',
        'D.......D'
      ];
    }
    // The PLAYER: white body, hard black outline, and a size bump so it stands
    // out from a screen full of vehicles and logs.
    var _PC=(typeof CT_PAL!=='undefined')&&CT_PAL, _ch=_PC&&_PC.installed;
    pix(rowsArt, px, py, Math.max(1,Math.floor(u*(_ch?1.35:1))), _ch?_PC.heroMap(map):map);
  }

  // On the Game Boy panel a wheel, a headlight or a grain line is ONE cell.
  // Drawing them adds noise where a Game Boy artist would draw a silhouette: a
  // solid body, one window, an outline, nothing else. SIMPLE turns off every
  // detail finer than a couple of cells.
  // Evaluated PER FRAME. As a load-time constant this was captured before the
  // panel existed, so it was always false and none of the simplification ran.
  function isSimple(){ return (typeof CT_DMG_NATIVE !== 'undefined') && !!CT_DMG_NATIVE; }

  function drawVehicle(vx, vy, vch, vcw, kind, col, dir, nt, pul){
    pul = pul||1;
    // 0.72 of an 11px lane is 8px of body; at Game Boy size a vehicle needs the
    // lane it occupies or it is a dash, not a car.
    var bh0 = vch*(isSimple()?0.9:0.72), bh = bh0*pul, yoff = (bh0-bh)*0.5;
    var x = Math.floor(vx), y = Math.floor(vy + vch*0.12 + yoff);
    bh = Math.floor(bh);
    if(isSimple()){
      // FLAT rectangles. The real thing draws its traffic as plain horizontal
      // lozenges -- a body and an outline, nothing else. The cabin-and-wheels
      // profile I built before is more drawing than the format holds and read
      // as clutter rather than as vehicles.
      var P2 = (typeof CT_PAL!=='undefined') && CT_PAL;
      var on = P2 && P2.installed;
      var ink  = on ? P2.role('ink')  : '#000000';
      var body = on ? P2.role('fore') : col;
      var lite = on ? P2.role('back') : col;
      var ws = Math.floor(vcw*(kind==='truck'?1.9:kind==='doze'?1.5:1.0));
      rrect(x, y, ws, bh, ink);
      rrect(x+1, y+1, Math.max(1,ws-2), Math.max(1,bh-2), body);
      // One light band for the cabin, inset from both ends so the nose and tail
      // stay solid. That single stripe is the difference between a lozenge and
      // something that reads as a car -- any more detail than this and 10px of
      // lane height turns back into clutter.
      var cabI = Math.max(2, Math.round(ws*(kind==='truck'?0.30:0.22)));
      var cabY = y + Math.max(1, Math.round(bh*0.22));
      var cabH = Math.max(1, Math.round(bh*0.34));
      if(ws - cabI*2 >= 3 && bh >= 5)
        rrect(x+cabI, cabY, ws-cabI*2, cabH, lite);
      return;
    }
    if(kind==='truck'){
      var w = Math.floor(vcw*1.9);
      rrect(x, y, w, bh, col);
      rrect(x+(dir>0?Math.floor(w*0.7):0), y, Math.floor(w*0.3), bh, nt?'#606060':'#404040');
      rrect(x+Math.floor(w*0.1), y+bh, Math.max(2,vcw*0.15), Math.max(2,bh*0.2), '#000000');
      rrect(x+Math.floor(w*0.75), y+bh, Math.max(2,vcw*0.15), Math.max(2,bh*0.2), '#000000');
    } else if(kind==='doze'){
      var w2 = Math.floor(vcw*1.5);
      rrect(x, y, w2, bh, col);
      rrect(x+(dir>0?w2:-Math.floor(vcw*0.2)), y, Math.floor(vcw*0.2), bh, '#f8f800');
      rrect(x+Math.floor(w2*0.15), y+bh, Math.max(2,vcw*0.2), Math.max(2,bh*0.2), '#000000');
      rrect(x+Math.floor(w2*0.65), y+bh, Math.max(2,vcw*0.2), Math.max(2,bh*0.2), '#000000');
    } else {
      var w3 = Math.floor(vcw*0.92);
      rrect(x, y, w3, bh, col);
      rrect(x+Math.floor(w3*0.25), y+Math.floor(bh*0.15), Math.floor(w3*0.5), Math.floor(bh*0.4), nt?'#203050':'#88c0f0');
      rrect(x+Math.floor(w3*0.1), y+bh, Math.max(2,w3*0.16), Math.max(2,bh*0.18), '#000000');
      rrect(x+Math.floor(w3*0.7), y+bh, Math.max(2,w3*0.16), Math.max(2,bh*0.18), '#000000');
    }
    if(nt){
      var hxp = dir>0 ? x + (kind==='truck'?vcw*1.85:(kind==='doze'?vcw*1.45:vcw*0.85)) : x;
      rrect(Math.floor(hxp), Math.floor(y+bh*0.3), Math.max(2,vcw*0.12), Math.max(2,bh*0.3), '#fff8c0');
    }
  }

  function drawLog(ox, oy, ow, och, nt, pul){
    pul = pul||1;
    var h0=och*0.64, h=Math.floor(h0*pul), yc=(h0-h0*pul)*0.5;
    var x=Math.floor(ox), y=Math.floor(oy+och*0.18+yc);
    // Light logs on dark water. Both were authored dark, so the entire river
    // section came out as one flat mass with nothing to step on -- on the real
    // thing the logs are the LIGHT elements and the water is the dark ground.
    var _PL2 = (typeof CT_PAL!=='undefined') && CT_PAL;
    var _on2 = _PL2 && _PL2.installed;
    // The river is drawn in role('ink'), so a log whose STRIPES are also ink
    // melts into the water, and a body in role('field') shares its colour with
    // the road two lanes down. On the water, a log is the brightest thing
    // there is: body 'fore', detail 'back'. Never ink.
    var body = _on2 ? _PL2.role('fore') : (nt ? '#5a3410' : '#7c4a14');
    var dark = _on2 ? _PL2.role('back') : (nt ? '#3a2008' : '#5a3410');
    rrect(x, y, Math.floor(ow), h, isSimple() ? dark : body);
    if(isSimple()){ rrect(x+2, y+2, Math.max(1,Math.floor(ow)-4), Math.max(1,h-4), body); }
    else for(var s=och*0.25;s<ow;s+=Math.max(4, och*0.28)){
      rrect(x+Math.floor(s), y, 2, h, dark);
    }
    rrect(x, y, Math.max(2,och*0.12), h, dark);
    rrect(x+Math.floor(ow)-Math.max(2,Math.floor(och*0.12)), y, Math.max(2,Math.floor(och*0.12)), h, dark);
  }

  function drawTurtles(ox, oy, len, tcw, och, nt, sval, pul){
    pul = pul||1;
    // Same rule as the logs: whatever the frog can stand on is LIGHT against
    // the dark river, or the row is just more water.
    var _PT2 = (typeof CT_PAL!=='undefined') && CT_PAL;
    var _on3 = _PT2 && _PT2.installed;
    // Turtles must read apart from BOTH the water (ink) and the logs (fore):
    // shells sit in 'back' with a 'fore' highlight, heads in 'fore', and
    // nothing on the river ever wears 'field' or 'ink'.
    var shellTop = _on3 ? _PT2.role('fore')  : (nt ? '#108858' : '#30c040');
    var shell    = _on3 ? _PT2.role('back')  : (nt ? '#0a5838' : '#d07820');
    var head     = _on3 ? _PT2.role('fore')  : (nt ? '#0c6840' : '#e09030');
    var th0 = och*0.64*pul, tyc = (och*0.64 - th0)*0.5;
    for(var t=0;t<len;t++){
      var tx = Math.floor(ox + t*tcw + tcw*0.06);
      var ty = Math.floor(oy + och*0.18 + tyc);
      var tw = Math.floor(tcw*0.86);
      var th = Math.floor(th0);
      var depth = sval;
      if(depth < -0.5) continue;
      var aShrink = depth<0 ? (1+depth*0.6) : 1;
      var hh = Math.max(2, Math.floor(th*aShrink));
      var yy = ty + (th-hh);
      rrect(tx, yy, tw, hh, shell);
      rrect(tx+Math.floor(tw*0.2), yy+Math.floor(hh*0.2), Math.floor(tw*0.6), Math.floor(hh*0.5), shellTop);
      rrect(tx+Math.floor(tw*0.85), yy+Math.floor(hh*0.3), Math.max(2,tcw*0.16), Math.max(2,hh*0.4), head);
    }
  }

  function drawSplat(sx, sy, scw, sch, amt, kind, nt, spriteU){
    var x=Math.floor(sx), y=Math.floor(sy);
    var col = kind===1 ? (nt?'#3050ff':'#3050d8') : '#d02020';
    var map = { 'X':col, 'W':'#ffffff' };
    var artA = [
      'X.W.W.X',
      '.XWWWX.',
      '.WXXXW.',
      '.XWWWX.',
      'X.W.W.X'
    ];
    pix(artA, x+Math.floor(scw*0.15), y+Math.floor(sch*0.2), Math.max(1,Math.floor(spriteU*0.85)), map);
  }

  return {
    render: render
  };
})();

(function(){
  VisualizerGame.layer('crossing', 'renderer', {
    packVersion: 2,
    key: "crossing",
    adapter: "custom-canvas-pack",
    presentation: [
      "orthographic pixel lanes",
      "frog sprite",
      "vehicle/log sprites",
      "water shimmer",
      "capped splash effects"
    ],
    performance: {
      oneActiveLoop: true,
      ownsAnimationLoop: false,
      maxEntities: 96,
      maxParticles: 0,
      maxEventsPerFrame: 32,
      usesReactStatePerFrame: false,
      allocations: "renderer owns canvas presentation and uses bounded lane arrays from state"
    },
    drawContract: [
      "consume simulation state and render modifiers",
      "keep collision state separate from visual pulses",
      "skip heavy visual work when the runtime enters background audio mode"
    ],
    render: CrossingRenderer.render,
    dispose: function(){}
  });
})();
