// BLOCKS renderer. Presentation only: consumes simulation state plus render inputs.
const BlocksRenderer = (function(){
  var NES_FAMS = [
    { I:'#00e8d8', O:'#f8d878', T:'#b048f8', S:'#58d854', Z:'#f83800', J:'#5078f8', L:'#fca044' },
    { I:'#3cbcfc', O:'#fcfc00', T:'#f878f8', S:'#00b800', Z:'#f80000', J:'#0058f8', L:'#fc7800' },
    { I:'#58f8d8', O:'#f8b800', T:'#9838f8', S:'#7cfc00', Z:'#e84038', J:'#6888fc', L:'#f8a038' },
    { I:'#48d0f0', O:'#e8e848', T:'#c060f0', S:'#48e070', Z:'#f85060', J:'#4060e0', L:'#f0a050' }
  ];
  var GB4 = ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'];
  // GB4 IS the Game Boy's four-shade palette, so on the panel it maps by INDEX
  // -- darkest tone to ink, lightest to the field. Hue-rotating it per song and
  // then re-measuring by luminance scrambled the very relationships that make it
  // a four-shade palette: #8bac0f (0.566) and #9bbc0f (0.621) both landed on the
  // same shade, so a block's fill matched its own highlight and the stack drew
  // as one solid mass.
  var GB4_ROLE = ['ink', 'fore', 'back', 'field'];
  function G4(i, hue){
    var P = (typeof CT_PAL !== 'undefined') && CT_PAL;
    if(P && P.installed) return P.role(GB4_ROLE[i]);
    return hueRot(GB4[i], hue);
  }

  function boxN(kk){
    return (kk === 'I' || kk === 'O') ? 4 : 3;
  }

  function rotCells(SHAPES, kk, r){
    var src = SHAPES[kk] || SHAPES.O;
    var c = [];
    var i;
    for (i = 0; i < src.length; i++) c.push([src[i][0], src[i][1]]);
    var n = boxN(kk);
    var rr = ((r % 4) + 4) % 4;
    for (var t = 0; t < rr; t++){
      for (i = 0; i < c.length; i++){
        var cx = c[i][0];
        var cy = c[i][1];
        c[i][0] = n - 1 - cy;
        c[i][1] = cx;
      }
    }
    return c;
  }

  function cellsOf(SHAPES, p){
    var c = rotCells(SHAPES, p.k, p.r);
    var out = [];
    for (var i = 0; i < c.length; i++) out.push([p.x + c[i][0], p.y + c[i][1]]);
    return out;
  }

  function lighten(hex){
    var r = parseInt(hex.substr(1, 2), 16);
    var gn = parseInt(hex.substr(3, 2), 16);
    var b = parseInt(hex.substr(5, 2), 16);
    r = Math.min(255, r + 90);
    gn = Math.min(255, gn + 90);
    b = Math.min(255, b + 90);
    return '#' + ((1 << 24) + (r << 16) + (gn << 8) + b).toString(16).slice(1);
  }

  function darken(hex){
    // On the DMG panel a multiplicative darken can land on the fill's own shade
    // -- a bright piece and its outline both quantise to white -- and the block
    // loses its border. One shade step is separation by construction.
    var P = (typeof CT_PAL !== 'undefined') && CT_PAL;
    if (P && P.installed) return P.step(hex, 2);
    var r = parseInt(hex.substr(1, 2), 16);
    var gn = parseInt(hex.substr(3, 2), 16);
    var b = parseInt(hex.substr(5, 2), 16);
    r = (r * 0.55) | 0;
    gn = (gn * 0.55) | 0;
    b = (b * 0.55) | 0;
    return '#' + ((1 << 24) + (r << 16) + (gn << 8) + b).toString(16).slice(1);
  }

  function render(A, U, st, view){
    view = view || {};
    if (!st || !st.board) return;

    var dt = view.dt || 0.016;
    var cl = view.cl || {};
    var GRID = view.GRID || { gstep:0, phase:0, beat:0, bar:0 };
    var energy = view.energy == null ? MV.energy(cl) : view.energy;
    var drop = view.drop == null ? MV.isDrop(cl) : !!view.drop;
    var phFam = view.phFam || MV.pick(cl, NES_FAMS) || NES_FAMS[0];

    if (st._lastPhrase !== cl.phrase){
      st._lastPhrase = cl.phrase;
      st.phraseFlash = 0.18;
    }
    if (st.phraseFlash > 0) st.phraseFlash = Math.max(0, st.phraseFlash - dt * 2);

    var barF = (GRID.gstep + (GRID.phase || 0)) / 16;
    var palHue = barF * 44 + (st.lineHue || 0);
    var newBeat = (st._lastBeat !== GRID.beat);
    st._lastBeat = GRID.beat;
    if (newBeat) st.beatPulse = 1;
    st.beatPulse = Math.max(0, (st.beatPulse || 0) - dt * 5);
    var bp = (st.beatPulse || 0) * (drop ? 1.6 : 1);

    var gbPhrase = ((GRID.bar || 0) / 4) | 0;
    var gb = (gbPhrase & 1) ? !st.gbBase : st.gbBase;
    var NES = phFam;
    var board = st.board;
    var COLS = st.COLS;
    var ROWS = st.ROWS;
    var SHAPES = st.SHAPES;
    var locked = !!view.locked;
    var collide = view.collide || function(){ return false; };

    if (gb){
      rrect(A.x, A.y, A.w, A.h, G4(3, 0));
    } else {
      rrect(A.x, A.y, A.w, A.h, '#000000');
      rrect(A.x, A.y, A.w, A.h, '#101038');
    }

    var sx = 0, sy = 0;
    if (st.shake > 0){
      var shAmp = st.shake * (8 + 6 * energy);
      sx = ((Math.random() * 2 - 1) * shAmp) | 0;
      sy = ((Math.random() * 2 - 1) * shAmp) | 0;
    }

    var sidePaddingCols = st.sidePaddingCols == null ? 2 : st.sidePaddingCols;
    var wallCols = st.wallCols == null ? 1 : st.wallCols;
    var frameCols = (sidePaddingCols + wallCols) * 2;
    var cell = Math.floor(Math.min(A.w/(COLS+frameCols),A.h/(ROWS+2)));
    if (cell < 3) cell = 3;
    var wellW = COLS * cell;
    var wellH = ROWS * cell;
    var ox = Math.floor(A.x + A.w * 0.5 - wellW * 0.5) + sx;
    // Sit the well LOW: most of the spare vertical space (a wide board leaves a lot) goes ABOVE the well as fall
    // headroom, and only a small margin below, so the stack sits near the bottom instead of floating mid-screen.
    var oy = Math.floor(A.y + (A.h - wellH) * 0.72) + sy;

    if (!gb){
      for (var s = 0; s < 26; s++){
        var px = A.x + ((s * 97 + 13) % 1000) / 1000 * A.w;
        var py = A.y + ((s * 53 + 7) % 1000) / 1000 * A.h;
        var tw = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(st.tphase * 2 + s));
        g.globalAlpha = tw * 0.8;
        rrect(px | 0, py | 0, 2, 2, palColor(s));
      }
      g.globalAlpha = 1;
    } else {
      for (var dgx = A.x; dgx < A.x + A.w; dgx += 6){
        for (var dgy = A.y; dgy < A.y + A.h; dgy += 6){
          if (((dgx + dgy) & 7) === 0) rrect(dgx | 0, dgy | 0, 1, 1, G4(2, 0));
        }
      }
    }

    if (gb){
      var wf1 = G4(0, palHue);
      var wf3 = G4(2, palHue);
      drawWalls(wf1,wf3);
      rrect(ox, oy, wellW, wellH, wf3);
      g.globalAlpha=0.14;
      for(var ggx=1;ggx<COLS;ggx++)rrect(ox+ggx*cell,oy,1,wellH,wf1);
      for(var ggy=1;ggy<ROWS;ggy++)rrect(ox,oy+ggy*cell,wellW,1,wf1);
      g.globalAlpha=1;
    } else {
      drawWalls('#15164c','#5078f8');
      rrect(ox, oy, wellW, wellH, '#080828');
      g.globalAlpha = 0.18;
      for (var gx = 1; gx < COLS; gx++) rrect(ox + gx * cell, oy, 1, wellH, '#283088');
      for (var gy = 1; gy < ROWS; gy++) rrect(ox, oy + gy * cell, wellW, 1, '#283088');
      g.globalAlpha = 1;
    }

    function drawWalls(edge,face){
      var left=ox-wallCols*cell,right=ox+wellW;
      rrect(left,oy,wallCols*cell,wellH,edge);
      rrect(right,oy,wallCols*cell,wellH,edge);
      for(var wy=0;wy<ROWS;wy++){
        var yy=oy+wy*cell,inset=Math.max(1,Math.floor(cell*.12));
        rrect(left+inset,yy+inset,wallCols*cell-inset*2,cell-inset*2,face);
        rrect(right+inset,yy+inset,wallCols*cell-inset*2,cell-inset*2,face);
        rrect(left+inset,yy+inset,wallCols*cell-inset*2,Math.max(1,Math.floor(cell*.16)),'#ffffff');
        rrect(right+inset,yy+inset,wallCols*cell-inset*2,Math.max(1,Math.floor(cell*.16)),'#ffffff');
      }
    }

    function drawBlock(cx, cy, kk, flashing, pul){
      if (cy < 0) return;
      var x = ox + cx * cell;
      var y = oy + cy * cell;
      var w = cell;
      var h = cell;
      if (flashing){
        rrect(x, y, w, h, '#ffffff');
        return;
      }
      if (gb){
        var g1 = G4(0, palHue);   // border   -> ink
        var g2 = G4(2, palHue);   // body     -> light
        var g3 = G4(1, palHue);   // top band -> mid
        var g4 = G4(3, palHue);   // centre   -> field
        rrect(x, y, w, h, g1);
        rrect(x + 1, y + 1, w - 2, h - 2, g2);
        rrect(x + 1, y + 1, w - 2, Math.max(1, (h * 0.25) | 0), g3);
        var inset = Math.max(1, (w * 0.3) | 0);
        rrect(x + inset, y + inset, Math.max(1, w - inset * 2), Math.max(1, h - inset * 2), g1);
        rrect(x + inset + 1, y + inset + 1, Math.max(1, w - inset * 2 - 2), Math.max(1, h - inset * 2 - 2), g4);
      } else {
        var base = hueRot(NES[kk] || '#f8f8f8', palHue);
        var hi = lighten(base);
        var dk = darken(base);
        // On the DMG panel a one-pixel outline is finer than a cell and is
        // erased by the downsample, so neighbouring pieces fuse into one mass.
        // Widen the border to a whole cell when the panel is on.
        var bw = Math.max(1, (typeof CT_DMG_CELL !== 'undefined' && CT_DMG_CELL) ? CT_DMG_CELL : 1);
        rrect(x, y, w, h, dk);
        rrect(x + bw, y + bw, Math.max(1, w - bw * 2), Math.max(1, h - bw * 2), base);
        rrect(x + bw, y + bw, Math.max(1, w - bw * 2), Math.max(1, (h * 0.22) | 0), hi);
        rrect(x + bw, y + bw, Math.max(1, (w * 0.22) | 0), Math.max(1, h - bw * 2), hi);
        var p = Math.max(1, (w * 0.28) | 0);
        rrect(x + (w >> 1) - (p >> 1), y + (h >> 1) - (p >> 1), p, p, '#ffffff');
      }
      if (pul > 0){
        g.globalAlpha = Math.min(0.5, pul);
        rrect(x, y, w, h, '#ffffff');
        g.globalAlpha = 1;
      }
    }

    var fX0 = st.flashX0 || 0, fX1 = (st.flashX1 == null ? COLS : st.flashX1);   // clearing row span (full width now)
    for (var by = 0; by < ROWS; by++){
      var flrow = false;
      for (var fyi = 0; fyi < st.flash.length; fyi++){
        if (st.flash[fyi] === by){ flrow = true; break; }
      }
      var showFlash = flrow && (((st.flashT * 30) | 0) % 2 === 0);
      for (var bx = 0; bx < COLS; bx++){
        var inFlash = showFlash && bx >= fX0 && bx < fX1;
        if (board[by][bx]) drawBlock(bx, by, board[by][bx], inFlash, bp * 0.3);
        else if (inFlash) drawBlock(bx, by, 'I', true);
      }
    }

    if (!locked){
      var pieces=st.pieces||[];
      for(var li=0;li<pieces.length;li++){
        var piece=pieces[li].piece;
        if(!piece)continue;
        var ghost = { k:piece.k, x:piece.x, y:piece.y, r:piece.r };
        while (!collide({ k:ghost.k, x:ghost.x, y:ghost.y + 1, r:ghost.r })) ghost.y++;
        var gc = cellsOf(SHAPES, ghost);
        g.globalAlpha = 0.22;
        for (var gi = 0; gi < gc.length; gi++) drawBlock(gc[gi][0], gc[gi][1], piece.k, false);
        g.globalAlpha = 1;
        var ac = cellsOf(SHAPES, piece);
        for (gi = 0; gi < ac.length; gi++) drawBlock(ac[gi][0], ac[gi][1], piece.k, false, bp * 0.6);
      }
    }

    if (st.flashT > 0 && ((st.flashT * 30) | 0) % 2 === 0){
      var clearJuice = 0.10 + 0.05 * energy + 0.02 * (st.clearN || 0);
      g.globalAlpha = Math.min(0.30, clearJuice);
      rrect(A.x, A.y, A.w, A.h, gb ? G4(3, 0) : '#ffffff');
      g.globalAlpha = 1;
    }
    if (st.phraseFlash > 0){
      g.globalAlpha = Math.min(0.10, st.phraseFlash * (0.4 + 0.6 * energy));
      rrect(A.x, A.y, A.w, A.h, gb ? G4(2, 0) : hueRot('#ffffff', palHue));
      g.globalAlpha = 1;
    }
    if (st.topFlash > 0){
      g.globalAlpha = Math.min(0.6, st.topFlash);
      rrect(A.x, A.y, A.w, A.h, gb ? G4(0, 0) : '#f83800');
      g.globalAlpha = 1;
    }
  }

  return {
    render: render,
    rotCells: rotCells,
    cellsOf: cellsOf
  };
})();

(function(){
  function render(ctx){
    ctx = ctx || {};
    var st = ctx.state || ctx.st;
    if(!st || !st.board) return undefined;
    var audio = ctx.audio || {};
    var raw = audio.raw || {};
    var view = ctx.blocksView || {
      dt: ctx.dt || 0.016,
      cl: raw.cl || {},
      GRID: raw.gr || { gstep:0, phase:0, beat:0, bar:0, bpm:120 },
      energy: audio.energy || 0,
      drop: !!audio.drop,
      locked: !!(st.flashT > 0),
      collide: function(){ return false; }
    };
    return BlocksRenderer.render(ctx.A || { x:0, y:0, w:0, h:0 }, ctx.U || 8, st, view);
  }

  VisualizerGame.layer('blocks', 'renderer', {
    packVersion: 2,
    key: "blocks",
    adapter: "custom-canvas-pack",
    draw: BlocksRenderer.render,
    presentation: [
      "pixel well",
      "block sprites",
      "clear flashes",
      "CRT scanline",
      "pooled sparks"
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
    ownedBy: "BlocksRenderer.render",
    render: render,
    dispose: function(ctx){
      if(ctx && ctx.state && ctx.state.$viz) ctx.state.$viz.disposed = true;
    }
  });
})();
