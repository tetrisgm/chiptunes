// GALAGA renderer. Presentation only: consumes simulation state plus render inputs.
const GalagaRenderer = (function(){
  var BEE  = { Y:'#ffd400', y:'#ffaa00', B:'#1840ff', b:'#3a78ff', w:'#ffffff' };
  var BUT  = { R:'#ff2020', r:'#c00000', W:'#ffffff', Y:'#ffd400', b:'#2050ff' };
  var BOSS = { B:'#2858ff', b:'#1030c0', G:'#20e0c0', R:'#ff2020', W:'#ffffff', Y:'#ffd400' };
  var ROWHUE = 22;

  var bee = [
    '..B...B..','..b...b..','.Bb.Y.bB.','BbYYYYYbB','BYYwYwYYB',
    'BYYYYYYYB','bBYYYYYBb','..bYYYb..','...y.y...'
  ];
  var beeFlap = [
    'B.......B','B.......B','Bb.Y..bB.','.bYYYYYb.','BYYwYwYYB',
    'BYYYYYYYB','bBYYYYYBb','..bYYYb..','..b...b..'
  ];
  var butterfly = [
    'W.......W','rW.....Wr','rRW.Y.WRr','RRRRRRRRR','WRRRRRRRW',
    'rRRWRWRRr','.RRRRRRR.','.rR.R.Rr.','..r...r..'
  ];
  var butterflyFlap = [
    '.W.....W.','.rW...Wr.','WrRW.WRrW','rRRRRRRRr','WRRRRRRRW',
    'RRRWRWRRR','.RRRRRRR.','W.R.R.R.W','r.......r'
  ];
  var boss = [
    '..B...B..','..b.Y.b..','.BBBBBBB.','BBGGGGGBB','BGRRRRRGB',
    'BGRWRWRGB','bBRRRRRBb','.bBBBBBb.','..b.R.b..'
  ];
  var bossFlap = [
    'B.......B','b...Y...b','Bb.BBB.bB','.BBGGGBB.','BGRRRRRGB',
    'BGRWRWRGB','bBRRRRRBb','.bBBBBBb.','..b...b..'
  ];
  var shipRows = [
    '....W....','....W....','...WRW...','...WRW...','..WWRWW..',
    '.WWRRRWW.','WRWWRWWRW','WRWWWWWRW','R.W.W.W.R'
  ];

  function mapFor(base, key, hue, barHue, cache){
    var ck = key + '|' + (hue | 0);
    var hit = cache[ck];
    if (hit) return hit;
    var m = {};
    for (var mk in base) m[mk] = hueRot(base[mk], barHue + hue);
    cache[ck] = m;
    return m;
  }

  function drawEnemy(type, cx, cy, scale, flap, ang, hueExtra, barHue, cache){
    var rows, map;
    hueExtra = hueExtra || 0;
    if (type === 'bee'){
      rows = flap ? beeFlap : bee;
      map = mapFor(BEE, 'bee', hueExtra, barHue, cache);
    } else if (type === 'butterfly'){
      rows = flap ? butterflyFlap : butterfly;
      map = mapFor(BUT, 'but', hueExtra, barHue, cache);
    } else {
      rows = flap ? bossFlap : boss;
      map = mapFor(BOSS, 'boss', hueExtra, barHue, cache);
    }
    var px = scale;
    var w = rows[0].length * px;
    var h = rows.length * px;
    if (ang){
      g.save();
      g.translate(cx, cy);
      g.rotate(ang);
      pix(rows, (-w * 0.5) | 0, (-h * 0.5) | 0, px, map);
      g.restore();
    } else {
      pix(rows, (cx - w * 0.5) | 0, (cy - h * 0.5) | 0, px, map);
    }
  }

  function drawStars(A, U, st, view){
    var dt = view.dt || 0.016;
    var VIS = view.VIS || { energy: 0 };
    var bp = view.bp || 0;
    var barHue = view.barHue || 0;
    for (var s = 0; s < st.stars.length; s++){
      var star = st.stars[s];
      star.y += star.sp * dt * (1 + (VIS.energy || 0) * 0.4);
      if (star.y > A.y + A.h){
        star.y = A.y;
        star.x = A.x + Math.random() * A.w;
      }
      star.tw += dt * 4;
      if (Math.sin(star.tw) > -0.6){
        var ssz = star.sz + (bp > 0.55 ? 1 : 0);
        var scol = star.warm ? hsl(barHue + (star.hoff || 0), 80, 60 + bp * 32) : (bp > 0.6 ? '#ffffff' : '#c8d0ff');
        rrect((star.x | 0), (star.y | 0), ssz, ssz, scol);
      }
    }
  }

  function drawProjectiles(U, st){
    var bw = Math.max(1, (U * 0.35) | 0);
    var bh = Math.max(2, (U * 1.4) | 0);
    for (var b = 0; b < st.bullets.length; b++){
      var bl = st.bullets[b];
      rrect((bl.x) | 0, (bl.y) | 0, bw, bh, '#ffffff');
      rrect((bl.x) | 0, (bl.y + bh * 0.35) | 0, bw, Math.max(1, (bh * 0.4) | 0), '#ffe040');
    }
    for (var bb = 0; bb < st.bombs.length; bb++){
      var bm = st.bombs[bb];
      rrect((bm.x - U * 0.25) | 0, (bm.y) | 0, Math.max(1, (U * 0.5) | 0), Math.max(2, (U * 1.0) | 0), '#ff60ff');
      rrect((bm.x - U * 0.25) | 0, (bm.y + U * 0.4) | 0, Math.max(1, (U * 0.5) | 0), Math.max(1, (U * 0.4) | 0), '#ffffff');
    }
  }

  function drawBursts(U, st){
    for (var bu = 0; bu < st.bursts.length; bu++){
      var BU = st.bursts[bu];
      var pr = BU.t / 0.42;
      var rad = pr * U * (3.2 + (BU.e || 0) * 1.6);
      var col = pr < 0.4 ? '#ffffff' : (pr < 0.7 ? '#ffd040' : '#ff5020');
      var pts = 8;
      var bsz = Math.max(1, (U * 0.5) | 0);
      for (var pp = 0; pp < pts; pp++){
        var a = (pp / pts) * Math.PI * 2 + BU.t * 4;
        var px = BU.x + Math.cos(a) * rad;
        var py = BU.y + Math.sin(a) * rad;
        rrect((px - bsz * 0.5) | 0, (py - bsz * 0.5) | 0, bsz, bsz, col);
      }
      if (pr < 0.5) rrect((BU.x - bsz) | 0, (BU.y - bsz) | 0, bsz * 2, bsz * 2, '#ffffff');
    }
  }

  function drawShip(U, st, barHue){
    var sh = st.ship;
    var shipMap = {
      W:'#e8e8f0',
      R:hueRot('#ff2828', barHue),
      r:hueRot('#c00000', barHue),
      B:hueRot('#3a78ff', barHue)
    };
    if (sh.alive){
      var blink = sh.invuln > 0 && (Math.floor(st.t * 16) % 2 === 0);
      if (!blink){
        var sp = Math.max(1, (U * 0.7) | 0);
        var sw = shipRows[0].length * sp;
        var shh = shipRows.length * sp;
        pix(shipRows, (sh.x - sw * 0.5) | 0, (sh.y - shh * 0.5) | 0, sp, shipMap);
      }
    } else {
      var ep = 1 - Math.max(0, sh.respawn / 1.0);
      var er = ep * U * 3.5;
      for (var d = 0; d < 10; d++){
        var aa = (d / 10) * Math.PI * 2 + st.t * 6;
        rrect((sh.x + Math.cos(aa) * er) | 0, (sh.y + Math.sin(aa) * er) | 0,
          Math.max(1, (U * 0.6) | 0), Math.max(1, (U * 0.6) | 0),
          ep < 0.5 ? '#ffd040' : '#ff4020');
      }
    }
  }

  function drawHud(A, U, st){
    var pipN = Math.min(8, st.wave + 1);
    for (var wp = 0; wp < pipN; wp++){
      rrect((A.x + A.w - U * 1.4 - wp * U * 1.2) | 0, (A.y + U * 1.0) | 0,
        Math.max(1, (U * 0.8) | 0), Math.max(1, (U * 0.8) | 0),
        st.challenge ? '#b070ff' : '#40ff90');
    }
  }

  function render(A, U, st, view){
    view = view || {};
    var bp = view.bp || 0;
    var barHue = view.barHue || 0;
    var barF = view.barF || 0;
    var energy = view.energy || 0;
    var cache = {};
    var espx = Math.max(1, (U * 0.6) | 0);
    var swellAmt = view.swellAmt == null ? 0.28 : view.swellAmt;
    var espxDraw = Math.max(1, Math.round(espx * (1 + bp * swellAmt)));
    var flapPhase = Math.sin(st.t * 6.0) > 0;

    rrect(A.x, A.y, A.w, A.h, hsl(barHue + 210, 60, 7 + bp * 4));
    drawStars(A, U, st, view);

    if (st.challenge){
      for (var d = 0; d < st.divers.length; d++){
        var dv = st.divers[d];
        if (dv.phase < 0) continue;
        var cang = dv.ang == null ? Math.cos(dv.phase * 6) * 0.3 : dv.ang;
        drawEnemy(dv.type, dv.x, dv.y, espxDraw, flapPhase, cang, ((dv.y - st.topY) / st.gy) * ROWHUE, barHue, cache);
      }
    } else {
      for (var f = 0; f < st.formation.length; f++){
        var en = st.formation[f];
        if (!en.alive) continue;
        drawEnemy(en.type, en.x, en.y, espxDraw, flapPhase, 0, en.row * ROWHUE, barHue, cache);
      }
      for (var di = 0; di < st.divers.length; di++){
        var dvr = st.divers[di];
        drawEnemy(dvr.type, dvr.x, dvr.y, espxDraw, flapPhase, dvr.ang || 0, ((dvr.y - st.topY) / st.gy) * ROWHUE, barHue, cache);
      }
    }

    drawProjectiles(U, st);
    drawBursts(U, st);
    drawShip(U, st, barHue);
    drawHud(A, U, st);

    if (st.flash > 0){
      g.save();
      g.globalAlpha = Math.min(0.5, st.flash * 0.6);
      rrect(A.x, A.y, A.w, A.h, st.flashCol || (st.challenge ? '#9040ff' : '#ffffff'));
      g.restore();
    }
  }

  return {
    render: render,
    drawEnemy: drawEnemy
  };
})();

(function(){
  function render(ctx){
    ctx = ctx || {};
    var st = ctx.state || ctx.st;
    if(!st) return undefined;
    var audio = ctx.audio || {};
    var raw = audio.raw || {};
    var view = ctx.galagaView || {
      dt: ctx.dt || 0.016,
      bp: audio.beatStrength || 0,
      barHue: audio.hue || 0,
      barF: audio.barProgress || 0,
      energy: audio.energy || 0,
      swellAmt: 0.28,
      VIS: raw.vis || { energy: audio.energy || 0, pulse: audio.beatStrength || 0, hue:0.5 }
    };
    return GalagaRenderer.render(ctx.A || { x:0, y:0, w:0, h:0 }, ctx.U || 8, st, view);
  }

  VisualizerGame.layer('galaga', 'renderer', {
    packVersion: 2,
    key: "galaga",
    adapter: "custom-canvas-pack",
    draw: GalagaRenderer.render,
    presentation: [
      "pixel ships",
      "formation grid",
      "starfield",
      "sprite explosions",
      "capped projectile and particle pools"
    ],
    performance: {
      oneActiveLoop: true,
      ownsAnimationLoop: false,
      maxEntities: 5000,
      maxParticles: 1800,
      maxEventsPerFrame: 64,
      usesReactStatePerFrame: false,
      allocations: "renderer consumes the definition-owned per-frame view through the shared pack runner"
    },
    drawContract: [
      "consume simulation state and render modifiers",
      "keep collision state separate from visual pulses",
      "pool or cap transient effects",
      "skip heavy visual work when the runtime enters background audio mode"
    ],
    render: render,
    dispose: function(ctx){
      if(ctx && ctx.state && ctx.state.$viz) ctx.state.$viz.disposed = true;
    }
  });
})();
