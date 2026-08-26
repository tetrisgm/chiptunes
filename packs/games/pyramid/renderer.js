// Pyramid renderer. Presentation only: consumes simulation state plus render modifiers.
const PyramidRenderer = (function(){
  function view(A, U, st, opts){
    opts = opts || {};
    var bottomCols = Math.max(1, (st.topCols || 1) + (st.ROWS || 1) - 1);
    // Keep at least two full cube widths clear on each side, including on
    // very wide wallpaper displays.
    U = Math.min(U, A.w * 0.72 / (bottomCols * 12));
    var halfW = U * 6;
    var topH = U * 3;
    var faceH = U * 6;
    return {
      A: A,
      U: U,
      st: st,
      P: st.pal,
      barHue: opts.barHue || 0,
      beatPulse: opts.beatPulse || 1,
      energy: opts.energy || 0,
      halfW: halfW,
      topH: topH,
      faceH: faceH,
      boardWidth: bottomCols * 12 * U,
      sidePadding: (A.w - bottomCols * 12 * U) * 0.5,
      stepDown: topH + faceH * 0.66,
      apexX: A.x + A.w * 0.5,
      apexY: A.y + Math.max(A.h * 0.08, U * 12)
    };
  }

  function hue(viewCtx, hex, extra){
    return typeof hueRot === 'function' ? hueRot(hex, viewCtx.barHue + (extra || 0)) : hex;
  }

  function shade(hex, f){
    // On the four-shade panel a MULTIPLICATIVE darken is not a shade step:
    // 0.62 and 0.42 of the same colour routinely quantise onto the level the
    // face already had, and the solid loses its edges entirely -- the pyramid
    // had no visible playing field at all. Move whole shades instead.
    var _P = (typeof CT_PAL !== 'undefined') && CT_PAL;
    if(_P && _P.installed) return _P.step(hex, Math.max(1, Math.min(3, Math.round((1 - f) * 3))));

    var n = parseInt(hex.slice(1), 16);
    var rr = (n >> 16) & 255;
    var gg = (n >> 8) & 255;
    var b = n & 255;
    return 'rgb(' + Math.round(rr * f) + ',' + Math.round(gg * f) + ',' + Math.round(b * f) + ')';
  }

  function cubePos(viewCtx, r, c){
    var row = viewCtx.st.cubes[Math.max(0, Math.min(viewCtx.st.cubes.length - 1, r))];
    return {
      x: viewCtx.apexX + (c - (row.length - 1) * 0.5) * 2 * viewCtx.halfW,
      y: viewCtx.apexY + r * viewCtx.stepDown
    };
  }

  function goalColor(viewCtx){
    var st = viewCtx.st;
    var P = viewCtx.P;
    var gi = Math.min(st.target - 1, P.goal.length - 1);
    return hue(viewCtx, P.goal[gi], st.goalScheme * 42);
  }

  function drawCube(viewCtx, cx, cy, lvl){
    var st = viewCtx.st;
    var P = viewCtx.P;
    var top = hue(viewCtx, P.top);
    var left = hue(viewCtx, P.topL);
    var right = hue(viewCtx, P.topR);
    // The three face colours are picked to read as one lit solid in colour, but
    // their LUMINANCES are 0.27 / 0.15 / 0.09 -- all three quantise to the same
    // shade, so every cube became a flat blob and the whole pyramid fused into
    // one mass with no visible structure. On the panel, derive the two side
    // faces from the top by whole shade steps so a cube always has three.
    var _P4 = (typeof CT_PAL !== 'undefined') && CT_PAL;
    if(_P4 && _P4.installed){
      // The whole game is "this tile changed" -- and on a four-shade panel a
      // colour change is invisible, because colour is exactly what the hardware
      // discards. Each state gets its own BRIGHTNESS instead: untouched cubes
      // dark, stepped cubes mid, completed cubes light. Read at a glance.
      var stg = (lvl <= 0) ? 0 : (lvl < st.target ? 1 : 2);
      top   = _P4.role(stg === 0 ? 'fore' : stg === 1 ? 'back'  : 'field');
      left  = _P4.role(stg === 0 ? 'ink'  : stg === 1 ? 'fore'  : 'back');
      right = _P4.role(stg === 0 ? 'ink'  : stg === 1 ? 'fore'  : 'back');
    }
    if(lvl > 0 && lvl < st.target){
      var inter = hue(viewCtx, P.inter);
      top = inter;
      left = shade(inter, 0.62);
      right = shade(inter, 0.42);
    } else if(lvl >= st.target){
      var goal = goalColor(viewCtx);
      top = goal;
      left = shade(goal, 0.62);
      right = shade(goal, 0.42);
    }
    var s = lvl >= st.target ? viewCtx.beatPulse : (1 + (viewCtx.beatPulse - 1) * 0.35);
    var hw = viewCtx.halfW * s;
    var th = viewCtx.topH * s;
    var fh = viewCtx.faceH;
    g.fillStyle = top;
    g.beginPath();
    g.moveTo(cx, cy - th);
    g.lineTo(cx + hw, cy);
    g.lineTo(cx, cy + th);
    g.lineTo(cx - hw, cy);
    g.closePath();
    g.fill();
    g.fillStyle = left;
    g.beginPath();
    g.moveTo(cx - hw, cy);
    g.lineTo(cx, cy + th);
    g.lineTo(cx, cy + th + fh);
    g.lineTo(cx - hw, cy + fh);
    g.closePath();
    g.fill();
    g.fillStyle = right;
    g.beginPath();
    g.moveTo(cx + hw, cy);
    g.lineTo(cx, cy + th);
    g.lineTo(cx, cy + th + fh);
    g.lineTo(cx + hw, cy + fh);
    g.closePath();
    g.fill();
  }

  function drawPyramid(viewCtx){
    var st = viewCtx.st;
    for(var r=0; r<st.ROWS; r++){
      for(var c=0; c<st.cubes[r].length; c++){
        var p = cubePos(viewCtx, r, c);
        drawCube(viewCtx, p.x, p.y, st.cubes[r][c]);
      }
    }
  }

  function drawFlipEffects(viewCtx){
    var st = viewCtx.st;
    if(!st.flipFx.length) return;
    g.save();
    for(var ff=0; ff<st.flipFx.length; ff++){
      var fo = st.flipFx[ff];
      g.globalAlpha = Math.min(0.8, fo.a);
      var sp = 1 + (0.6 - Math.min(0.6, fo.a)) * 1.4;
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.moveTo(fo.x, fo.y - viewCtx.topH * sp);
      g.lineTo(fo.x + viewCtx.halfW * sp, fo.y);
      g.lineTo(fo.x, fo.y + viewCtx.topH * sp);
      g.lineTo(fo.x - viewCtx.halfW * sp, fo.y);
      g.closePath();
      g.fill();
    }
    g.restore();
  }

  function discPos(viewCtx, d){
    var er = 3;
    var ep = cubePos(viewCtx, er, d.side < 0 ? 0 : viewCtx.st.cubes[er].length - 1);
    return {
      x: ep.x + d.side * viewCtx.halfW * 1.9,
      y: ep.y - viewCtx.topH
    };
  }

  function drawDiscs(viewCtx, dt){
    var st = viewCtx.st;
    var P = viewCtx.P;
    var U = viewCtx.U;
    for(var di=0; di<st.discs.length; di++){
      var d = st.discs[di];
      if(d.used) continue;
      d.rot += (dt || 0) * 4;
      var dp = discPos(viewCtx, d);
      var dw = U * 3.6;
      var px = Math.max(1, Math.round(dw * 2 / 8));
      var radius = 4 * px;
      pix(["..####..",".######.","########","########","########","########",".######.","..####.."], dp.x - radius, dp.y - radius, px, {'#':hue(viewCtx, P.disc)});
      var rw = Math.max(1, Math.round((Math.abs(Math.sin(d.rot)) * 0.7 + 0.12) * radius * 2));
      rrect(dp.x - Math.round(rw / 2), dp.y - Math.round(radius * 0.6), rw, Math.max(1, Math.round(radius * 1.2)), hue(viewCtx, P.discB));
    }
  }

  function drawBall(viewCtx, bx, by, kind){
    var P = viewCtx.P;
    var px = Math.max(1, Math.round(viewCtx.U * 0.55));
    var radius = 4 * px;
    var col = kind === 'red' ? P.ballR : P.ballG;
    pix(["..####..",".######.","########","########","########","########",".######.","..####.."], bx - radius, by - radius, px, {'#':col});
    rrect(bx - radius * 0.5, by - radius * 0.5, Math.max(1, Math.round(px * 1.6)), Math.max(1, Math.round(px * 1.6)), '#ffffff');
  }

  function drawCoily(viewCtx, co, ccx, ccy){
    if(!co.active || viewCtx.st.win) return;
    var P = viewCtx.P;
    var U = viewCtx.U;
    if(co.egg){
      g.fillStyle = P.coily;
      g.beginPath();
      g.arc(ccx, ccy - viewCtx.topH - U * 2, U * 2.4, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = P.coilyEye;
      g.beginPath();
      g.arc(ccx - U * 0.7, ccy - viewCtx.topH - U * 2.4, U * 0.7, 0, Math.PI * 2);
      g.fill();
    } else {
      pix([
        '..pp..',
        '.peep.',
        '.pkpk.',
        '.pppp.',
        '..pp..',
        '.pppp.',
        'p.pp.p'
      ], ccx - U * 3, ccy - viewCtx.topH - U * 8, U, {p:P.coily, e:P.coilyEye, k:'#000000'});
    }
  }

  function drawFallingPyramid(viewCtx){
    var st = viewCtx.st;
    var P = viewCtx.P;
    var U = viewCtx.U;
    g.save();
    g.translate(st.fallX, st.fallY);
    g.rotate(st.fallT * 8 * (st.fallVX < 0 ? -1 : 1));
    pix([
      '..bbb..',
      '.bbbbb.',
      'bbbbbbb',
      'beebebb',
      'bppbpbn',
      'bbbbbnn',
      '.bbbbb.',
      '.f...f.'
    ], -U * 3.5, -U * 4, U, {b:P.qbody, e:P.qeye, p:P.qpup, n:P.qnose, f:P.qfoot});
    g.restore();
  }

  function pyramidPosition(viewCtx){
    var st = viewCtx.st;
    if(st.onDisc){
      var ride = Math.min(1, st.discRide / 0.9);
      var startP = cubePos(viewCtx, 3, st.discSide < 0 ? 0 : st.cubes[3].length - 1);
      var sx0 = startP.x + st.discSide * viewCtx.halfW * 1.9;
      var sy0 = startP.y - viewCtx.topH;
      var apexP = cubePos(viewCtx, 0, 0);
      return {
        x: sx0 + (apexP.x - sx0) * ride,
        y: sy0 + (apexP.y - sy0) * ride
      };
    }
    var qpf = cubePos(viewCtx, st.hopr, st.hopc);
    var qpt = cubePos(viewCtx, st.qr, st.qc);
    if(st.hopT < 1){
      return {
        x: qpf.x + (qpt.x - qpf.x) * st.hopT,
        y: qpf.y + (qpt.y - qpf.y) * st.hopT - st.qhopH
      };
    }
    return { x:qpt.x, y:qpt.y };
  }

  // The PLAYER: ink outline, solid body, light detail -- never the field, so it
  // cannot match the cube face it is standing on.
  function _heroPal(P){
    var m = {b:P.qbody, e:P.qeye, p:P.qpup, n:P.qnose, f:P.qfoot};
    var _P = (typeof CT_PAL !== 'undefined') && CT_PAL;
    return (_P && _P.installed) ? _P.heroMap(m) : m;
  }

  function drawHopper(viewCtx){   // the PLAYER, not the level. Named drawQbert
  // until the generic-naming rename turned it into a second drawPyramid that
  // shadowed the one drawing the cubes -- the pyramid has not rendered since.
    var st = viewCtx.st;
    if(!(st.alive && !st.falling)) return;
    var P = viewCtx.P;
    var U = viewCtx.U;
    var qp = pyramidPosition(viewCtx);
    var qsx = qp.x - U * 3.5;
    var qsy = qp.y - viewCtx.topH - U * 8.5;
    if(st.face >= 0){
      pix([
        '..bbb..',
        '.bbbbb.',
        'bbbbbbb',
        'beebebb',
        'bppbpbn',
        'bbbbbnn',
        '.bbbbb.',
        '.f...f.'
      ], qsx, qsy, U, _heroPal(P));
    } else {
      pix([
        '..bbb..',
        '.bbbbb.',
        'bbbbbbb',
        'bbebeeb',
        'nbpbppb',
        'nnbbbbb',
        '.bbbbb.',
        '.f...f.'
      ], qsx, qsy, U, _heroPal(P));
    }
  }

  function drawFlash(viewCtx){
    var st = viewCtx.st;
    var A = viewCtx.A;
    if(st.flash <= 0) return;
    if(!st.win) st.flash = Math.max(0, st.flash - (viewCtx.dt || 0) * 3);
    g.save();
    g.globalAlpha = Math.min(0.6, st.flash * 0.5);
    rrect(A.x, A.y, A.w, A.h, st.win ? '#ffff00' : '#ffffff');
    g.restore();
  }

  function render(ctx){
    ctx = ctx || {};
    var viewCtx = ctx.pyramidView || ctx.view;
    if(!viewCtx) return undefined;
    var st = viewCtx.st;
    var A = viewCtx.A;
    var shx = viewCtx.shx || 0;
    var shy = viewCtx.shy || 0;
    var actors = ctx.pyramidActors || {};
    g.save();
    if(shx || shy) g.translate(shx, shy);
    rrect(A.x-Math.abs(shx)-2, A.y-Math.abs(shy)-2, A.w+Math.abs(shx)*2+4, A.h+Math.abs(shy)*2+4, viewCtx.P.bg);
    drawPyramid(viewCtx);
    drawFlipEffects(viewCtx);
    drawDiscs(viewCtx, viewCtx.dt || ctx.dt || 0);
    var balls = actors.balls || [];
    for(var bi=0; bi<balls.length; bi++) drawBall(viewCtx, balls[bi].x, balls[bi].y, balls[bi].kind);
    if(actors.coily) drawCoily(viewCtx, actors.coily.co, actors.coily.x, actors.coily.y);
    if(actors.falling) drawFallingPyramid(viewCtx);
    if(actors.pyramid !== false) drawHopper(viewCtx);
    drawFlash(viewCtx);
    g.restore();
    return st;
  }

  return {
    view: view,
    cubePos: cubePos,
    goalColor: goalColor,
    shade: shade,
    drawCube: drawCube,
    drawPyramid: drawPyramid,
    drawFlipEffects: drawFlipEffects,
    discPos: discPos,
    drawDiscs: drawDiscs,
    drawBall: drawBall,
    drawCoily: drawCoily,
    drawFallingPyramid: drawFallingPyramid,
    pyramidPosition: pyramidPosition,
    drawHopper: drawHopper,
    drawFlash: drawFlash,
    render: render
  };
})();

(function(){
  VisualizerGame.layer('pyramid', 'renderer', {
    packVersion: 3,
    key: "pyramid",
    adapter: "custom-canvas-pack",
    presentation: [
      "centered isometric pixel cubes with generous side padding",
      "sprite hops",
      "shadow offsets",
      "pooled sparks",
      "visual-only cube pulses"
    ],
    performance: {
      oneActiveLoop: true,
      ownsAnimationLoop: false,
      maxEntities: 5000,
      maxParticles: 1800,
      maxEventsPerFrame: 64,
      usesReactStatePerFrame: false,
      allocations: "renderer consumes pyramidView and pyramidActors from PyramidDefinition.update"
    },
    drawContract: [
      "consume simulation state and render modifiers",
      "keep collision state separate from visual pulses",
      "pool or cap transient effects",
      "skip heavy visual work when the runtime enters background audio mode"
    ],
    view: PyramidRenderer.view,
    render: PyramidRenderer.render,
    dispose: function(){}
  });
})();
