// Q*bert renderer. Presentation only: consumes simulation state plus render modifiers.
const QbertRenderer = (function(){
  function view(A, U, st, opts){
    opts = opts || {};
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
      stepDown: topH + faceH * 0.66,
      apexX: A.x + A.w * 0.5,
      apexY: A.y + A.h * 0.16
    };
  }

  function hue(viewCtx, hex, extra){
    return typeof hueRot === 'function' ? hueRot(hex, viewCtx.barHue + (extra || 0)) : hex;
  }

  function shade(hex, f){
    var n = parseInt(hex.slice(1), 16);
    var rr = (n >> 16) & 255;
    var gg = (n >> 8) & 255;
    var b = n & 255;
    return 'rgb(' + Math.round(rr * f) + ',' + Math.round(gg * f) + ',' + Math.round(b * f) + ')';
  }

  function cubePos(viewCtx, r, c){
    return {
      x: viewCtx.apexX + (c - r * 0.5) * 2 * viewCtx.halfW,
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
      for(var c=0; c<=r; c++){
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
    var ep = cubePos(viewCtx, er, d.side < 0 ? 0 : er);
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

  function drawFallingQbert(viewCtx){
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

  function qbertPosition(viewCtx){
    var st = viewCtx.st;
    if(st.onDisc){
      var ride = Math.min(1, st.discRide / 0.9);
      var startP = cubePos(viewCtx, 3, st.discSide < 0 ? 0 : 3);
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

  function drawQbert(viewCtx){
    var st = viewCtx.st;
    if(!(st.alive && !st.falling)) return;
    var P = viewCtx.P;
    var U = viewCtx.U;
    var qp = qbertPosition(viewCtx);
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
      ], qsx, qsy, U, {b:P.qbody, e:P.qeye, p:P.qpup, n:P.qnose, f:P.qfoot});
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
      ], qsx, qsy, U, {b:P.qbody, e:P.qeye, p:P.qpup, n:P.qnose, f:P.qfoot});
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
    var viewCtx = ctx.qbertView || ctx.view;
    if(!viewCtx) return undefined;
    var st = viewCtx.st;
    var A = viewCtx.A;
    var shx = viewCtx.shx || 0;
    var shy = viewCtx.shy || 0;
    var actors = ctx.qbertActors || {};
    g.save();
    if(shx || shy) g.translate(shx, shy);
    rrect(A.x-Math.abs(shx)-2, A.y-Math.abs(shy)-2, A.w+Math.abs(shx)*2+4, A.h+Math.abs(shy)*2+4, viewCtx.P.bg);
    drawPyramid(viewCtx);
    drawFlipEffects(viewCtx);
    drawDiscs(viewCtx, viewCtx.dt || ctx.dt || 0);
    var balls = actors.balls || [];
    for(var bi=0; bi<balls.length; bi++) drawBall(viewCtx, balls[bi].x, balls[bi].y, balls[bi].kind);
    if(actors.coily) drawCoily(viewCtx, actors.coily.co, actors.coily.x, actors.coily.y);
    if(actors.falling) drawFallingQbert(viewCtx);
    if(actors.qbert !== false) drawQbert(viewCtx);
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
    drawFallingQbert: drawFallingQbert,
    qbertPosition: qbertPosition,
    drawQbert: drawQbert,
    drawFlash: drawFlash,
    render: render
  };
})();

(function(){
  VisualizerGame.layer('qbert', 'renderer', {
    packVersion: 3,
    key: "qbert",
    adapter: "custom-canvas-pack",
    presentation: [
      "isometric pixel cubes",
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
      allocations: "renderer consumes qbertView and qbertActors from QbertDefinition.update"
    },
    drawContract: [
      "consume simulation state and render modifiers",
      "keep collision state separate from visual pulses",
      "pool or cap transient effects",
      "skip heavy visual work when the runtime enters background audio mode"
    ],
    render: QbertRenderer.render,
    dispose: function(){}
  });
})();
