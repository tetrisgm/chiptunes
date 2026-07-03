// TETRIS pack definition. Rules, board state, collision, and simulation update.
// Rendering consumes ctx.tetrisView from this layer; this file never draws and never reads raw SND clocks.
const TetrisDefinition = (function(){
  function make(A, U, variant){
    var COLS = 10, ROWS = 20;
    // base orientation cells per piece (in its NxN box)
    var SHAPES = {
      I: [[0,1],[1,1],[2,1],[3,1]],
      O: [[1,0],[2,0],[1,1],[2,1]],
      T: [[1,0],[0,1],[1,1],[2,1]],
      S: [[1,0],[2,0],[0,1],[1,1]],
      Z: [[0,0],[1,0],[1,1],[2,1]],
      J: [[0,0],[0,1],[1,1],[2,1]],
      L: [[2,0],[0,1],[1,1],[2,1]]
    };
    var keys = ['I','O','T','S','Z','J','L'];
    var board = [];
    for (var y=0;y<ROWS;y++){ var row=[]; for (var x=0;x<COLS;x++) row.push(0); board.push(row); }

    function rnd7(){ return keys[(Math.random()*7)|0]; }
    // 7-BAG randomiser: each of the 7 pieces appears once per shuffled bag, so an I-piece (needed for Tetrises)
    // is guaranteed within ~7 pieces — never a long drought. This is what makes the Tetris-seeking AI viable.
    function bagShuffle(){ var b=keys.slice(),i,j,t; for(i=b.length-1;i>0;i--){ j=(Math.random()*(i+1))|0; t=b[i];b[i]=b[j];b[j]=t; } return b; }
    var bag = bagShuffle();
    var firstK = bag.shift(); if(!bag.length) bag = bagShuffle(); var firstNext = bag.shift();

    return {
      v: variant, gb: variant === 1, gbBase: Math.random() < 0.5,   // gbBase = which palette this run OPENS on (random, independent of variant/speed)
      COLS: COLS, ROWS: ROWS, SHAPES: SHAPES, keys: keys, board: board, bag: bag,
      piece: { k: firstK, x: 3, y: 0, r: 0 },
      next: firstNext,
      // AI plan for the current piece (target column + rotation), recomputed on each spawn
      plan: null, planFor: -1,
      // timers
      grav: 0,            // gravity accumulator (player mode)
      gravStep: variant === 1 ? 0.42 : 0.62,  // v1 faster
      moveT: 0,           // AI move cadence accumulator
      moveStep: 0.07,     // AI makes one move per this interval (drives the rhythm)
      lockT: 0,
      softHold: 0,        // player soft-drop repeat throttle
      shiftHold: 0,       // player L/R repeat throttle
      _upHeld: false,
      // fx / state
      flash: [],          // rows currently clearing (capped <=4)
      flashT: 0,          // clear animation timer
      clearN: 0,          // how many rows in the active clear (for sweep pitch)
      shake: 0,
      topFlash: 0,        // top-out white-out
      tphase: 0,
      score: 0, lines: 0, level: 0,
      pieceCount: 0,
      lastTarget: 5       // pointer/ai target column
    };
  
  }

  function update(ctx){
    ctx = ctx || {};
    var dt = ctx.dt;
    var U = ctx.U || 8;
    var A = ctx.A || { x:0, y:0, w:0, h:0 };
    var IN = ctx.IN || {};
    var SND = ctx.SND || {};
    var st = ctx.state || ctx.st;

    if (!st || !st.board) return;
    if (!dt || dt < 0) dt = 0.016;
    if (dt > 0.05) dt = 0.05;
    st.tphase += dt;

    var COLS = st.COLS, ROWS = st.ROWS, SHAPES = st.SHAPES, keys = st.keys, board = st.board;

    // ---- guards on IN / SND ----
    IN = IN || {};
    var K = IN.keys || {};
    var act = !!IN.active;
    var snd = SND || {};
    function fx(n, s){ if (snd && typeof snd.fx === 'function') snd.fx(n, s||0); }
    function EVENT(c,i,o){ if (snd && typeof snd.event === 'function') try{ snd.event(c,i,o); }catch(e){} }

    // ===================== piece geometry =====================
    function boxN(kk){ return (kk === 'I' || kk === 'O') ? 4 : 3; }
    function rotCells(kk, r){
      var src = SHAPES[kk] || SHAPES.O, c = [], i;
      for (i=0;i<src.length;i++) c.push([src[i][0], src[i][1]]);
      var n = boxN(kk), rr = ((r % 4) + 4) % 4, t;
      for (t=0;t<rr;t++){ for (i=0;i<c.length;i++){ var cx=c[i][0], cy=c[i][1]; c[i][0]=n-1-cy; c[i][1]=cx; } }
      return c;
    }
    function cellsOf(p){
      var c = rotCells(p.k, p.r), out = [], i;
      for (i=0;i<c.length;i++) out.push([p.x + c[i][0], p.y + c[i][1]]);
      return out;
    }
    function collide(p){
      var c = cellsOf(p), i;
      for (i=0;i<c.length;i++){
        var x=c[i][0], y=c[i][1];
        if (x < 0 || x >= COLS || y >= ROWS) return true;
        if (y >= 0 && board[y][x]) return true;
      }
      return false;
    }
    function tryMove(dx, dy, dr){
      var p = { k: st.piece.k, x: st.piece.x + dx, y: st.piece.y + dy, r: (st.piece.r + (dr||0) + 4) % 4 };
      if (!collide(p)){ st.piece = p; return true; }
      return false;
    }
    // rotate with simple wall-kicks
    function tryRotate(){
      if (st.piece.k === 'O') return false;
      var kicks = [0,-1,1,-2,2], i;
      for (i=0;i<kicks.length;i++){
        var p = { k: st.piece.k, x: st.piece.x + kicks[i], y: st.piece.y, r: (st.piece.r + 1) % 4 };
        if (!collide(p)){ st.piece = p; return true; }
      }
      return false;
    }

    function resetBoard(){ for (var y=0;y<ROWS;y++) for (var x=0;x<COLS;x++) board[y][x]=0; }

    function drawNext(){ if(!st.bag || !st.bag.length){ var b=keys.slice(),i,j,t; for(i=b.length-1;i>0;i--){ j=(Math.random()*(i+1))|0; t=b[i];b[i]=b[j];b[j]=t; } st.bag=b; } return st.bag.shift(); }
    function spawn(){
      st.piece = { k: st.next, x: 3, y: (st.next === 'I' || st.next === 'O') ? -1 : 0, r: 0 };
      st.next = drawNext();
      st.plan = null; st.planFor = -1;          // force AI replan for the new piece
      st.lockT = 0;
      st.pieceCount++;
      if (collide(st.piece)){                    // FAILURE: top out
        st.topFlash = 0.6; st.shake = 0.5; fx('topout');
        EVENT('major', 9);
        if (st._danger){ EVENT('state', 6, {name:'danger', on:false}); st._danger = false; }
        resetBoard();
        st.score = 0; st.lines = 0; st.level = 0;
      }
    }

    // lock current piece, detect full rows (flash starts; collapse on flashT end)
    function lockPiece(){
      var c = cellsOf(st.piece), i, aboveTop = false;
      for (i=0;i<c.length;i++){
        var x=c[i][0], y=c[i][1];
        if (y < 0){ aboveTop = true; continue; }   // a cell locked above the top
        if (y >= 0 && y < ROWS && x >= 0 && x < COLS) board[y][x] = st.piece.k;
      }
      if (aboveTop){                                // FAILURE: locked out the top
        st.topFlash = 0.6; st.shake = 0.5; fx('topout');
        EVENT('major', 9);
        if (st._danger){ EVENT('state', 6, {name:'danger', on:false}); st._danger = false; }
        resetBoard(); st.score=0; st.lines=0; st.level=0; spawn(); return;
      }
      fx('thunk');
      EVENT('minor', 3);                              // piece lock = small frequent action
      st.shake = Math.max(st.shake, 0.12);
      // find full rows
      var full = [];
      for (var y2=0;y2<ROWS;y2++){
        var fr = true;
        for (var x2=0;x2<COLS;x2++){ if (!board[y2][x2]){ fr=false; break; } }
        if (fr) full.push(y2);
      }
      if (full.length){
        st.flash = full; st.flashT = 0.28; st.clearN = full.length;
        st.lineHue = (st.lineHue || 0) + full.length * 46;   // each cleared line jumps the colour palette
        st.lines += full.length;
        st.level = (st.lines / 10) | 0;
        // scoring: classic-ish (40,100,300,1200) * (level+1)
        var pts = [0,40,100,300,1200][full.length] || 0;
        st.score += pts * (st.level + 1);
        st.shake = Math.max(st.shake, 0.16 + 0.08*full.length);
        // SOUND: ascending sweep, higher for more rows; 4-row = fanfare
        if (full.length >= 4) fx('fanfare');
        else fx('sweep', (full.length - 1) * 4);   // +0/+4/+8 semis
        // EVENT: single/double = medium accent; triple/TETRIS = major payoff
        if (full.length >= 3) EVENT('major', full.length >= 4 ? 10 : 8);
        else EVENT('medium', full.length === 2 ? 6 : 4);
      } else {
        spawn();
      }
    }

    // collapse cleared rows after the flash
    function doCollapse(){
      var rows = st.flash.slice(0); rows.sort(function(a,b){ return a-b; });
      for (var i=0;i<rows.length;i++){
        var ry = rows[i];
        for (var y=ry;y>0;y--){ for (var x=0;x<COLS;x++) board[y][x] = board[y-1][x]; }
        for (var x4=0;x4<COLS;x4++) board[0][x4] = 0;
      }
      st.flash = []; st.clearN = 0;
      spawn();
    }

    // hard-drop the current piece to the floor, then lock (player tap & AI both use this)
    function hardDrop(){
      var moved = 0;
      while (tryMove(0,1,0)) moved++;
      if (moved > 0) st.score += moved;
      fx('drop');
      EVENT('minor', 4);                            // hard-drop = small action (the lock chord follows)
      lockPiece();
    }

    // ===================== AI: TWO-PIECE-LOOKAHEAD heuristic placement =====================
    // Evaluate every legal placement of the current piece; for each, evaluate every legal placement of the
    // NEXT piece; choose the current move that leads to the best board after BOTH. Priorities, in order:
    // survive, make safe Tetrises, keep a clean Tetris well, flat/clean boards. (No T-spin goal — dropped by design.)
    var VERY_SAFE_H = 10, SAFE_H = 12, WARN_H = 15, DANGER_H = 17;
    var CUR_W = 0.35, NXT_W = 0.65;                       // the board after BOTH pieces dominates the choice
    function colHeights(b){ var h=new Array(COLS),x,y; for(x=0;x<COLS;x++){ h[x]=0; for(y=0;y<ROWS;y++){ if(b[y][x]){ h[x]=ROWS-y; break; } } } return h; }
    function cleanTetrisWell(b, h){                       // an EDGE column open >=4 below every other column, stack stable, well hole-free
      h = h || colHeights(b);
      var edges=[COLS-1,0], i, e, x, y;                   // right edge preferred, then left
      for(i=0;i<edges.length;i++){ e=edges[i];
        var omin=Infinity, omax=0;
        for(x=0;x<COLS;x++){ if(x===e) continue; if(h[x]<omin) omin=h[x]; if(h[x]>omax) omax=h[x]; }
        if(omin - h[e] < 4) continue;                     // every other column must sit >=4 above the well floor
        if(omax > WARN_H) continue;                       // neighbouring stack not dangerously high
        var seen=false, holeInWell=false;
        for(y=0;y<ROWS;y++){ if(b[y][e]) seen=true; else if(seen){ holeInWell=true; break; } }
        if(holeInWell) continue;                          // no buried holes beside/in the well
        return true;
      }
      return false;
    }
    function analyzeBoard(b){
      var h=colHeights(b), agg=0, maxh=0, bump=0, holes=0, covered=0, wells=0, x, y;
      for(x=0;x<COLS;x++){ agg+=h[x]; if(h[x]>maxh) maxh=h[x];
        var seen=false, above=0;
        for(y=0;y<ROWS;y++){ if(b[y][x]){ seen=true; above++; } else if(seen){ holes++; covered+=above; } }
      }
      for(x=0;x<COLS-2;x++) bump+=Math.abs(h[x]-h[x+1]);   // exclude the well edge (col 8↔9) so a deep Tetris well isn't scored as "bumpy"/unsafe
      for(x=0;x<COLS;x++){ var L=(x===0)?ROWS:h[x-1], R=(x===COLS-1)?ROWS:h[x+1], lo=Math.min(L,R); if(lo>h[x]) wells+=(lo-h[x]); }
      // Tetris-well readiness: with the RIGHT edge held open (no blocks in it), count rows that are full in every
      // OTHER column — these are rows an I-piece dropped in the well would clear (up to 4 at once = a Tetris).
      var wellCol=COLS-1, ready=0, wellBlocks=0, yy, xx;
      for(yy=0;yy<ROWS;yy++) if(b[yy][wellCol]) wellBlocks++;
      if(wellBlocks===0){ for(yy=0;yy<ROWS;yy++){ var full=true; for(xx=0;xx<COLS-1;xx++){ if(!b[yy][xx]){ full=false; break; } } if(full) ready++; } }
      return { columnHeights:h, maxHeight:maxh, aggregateHeight:agg, averageHeight:agg/COLS,
        holes:holes, coveredHoles:covered, bumpiness:bump, wells:wells, tetrisReadyRows:ready, wellBlocks:wellBlocks,
        hasCleanTetrisWell:cleanTetrisWell(b,h),
        topOutRisk:(maxh>=DANGER_H || holes>=8 || covered>=16),
        isVerySafe:(maxh<=VERY_SAFE_H && holes<=2 && bump<=10 && covered<=4),
        isSafe:(maxh<=SAFE_H && holes<=4 && bump<=16 && covered<=8) };
    }
    function collideOn(b, p){ var c=cellsOf(p),i; for(i=0;i<c.length;i++){ var x=c[i][0],y=c[i][1]; if(x<0||x>=COLS||y>=ROWS) return true; if(y>=0 && b[y][x]) return true; } return false; }
    // hard-drop (k,r,x) into a COPY of board b, place + CLEAR full rows -> {board, linesCleared, top, landY} or null
    function simDropOn(b, k, r, x){
      var c0=cellsOf({k:k,x:x,y:0,r:r}), i;
      for(i=0;i<c0.length;i++){ if(c0[i][0]<0 || c0[i][0]>=COLS) return null; }    // out of bounds horizontally
      var py=-2; while(!collideOn(b,{k:k,x:x,y:py+1,r:r})) py++;
      var cells=cellsOf({k:k,x:x,y:py,r:r}), nb=[], yy;
      for(yy=0;yy<ROWS;yy++) nb.push(b[yy].slice(0));
      var top=false;
      for(i=0;i<cells.length;i++){ var cx=cells[i][0], cy=cells[i][1]; if(cy<0){ top=true; continue; } nb[cy][cx]=k; }
      if(top) return { board:nb, linesCleared:0, top:true, landY:py };
      var lines=0;
      for(yy=ROWS-1; yy>=0; ){ var fr=true, xx; for(xx=0;xx<COLS;xx++){ if(!nb[yy][xx]){ fr=false; break; } }
        if(fr){ nb.splice(yy,1); nb.unshift(new Array(COLS).fill(0)); lines++; } else yy--; }
      return { board:nb, linesCleared:lines, top:false, landY:py };
    }
    // score a board after a move (pre/post analyses + move{linesCleared}); higher = better
    function evaluateAfter(before, after, move){
      if(after.topOutRisk) return -Infinity;
      var s=0;
      // DE-RISK FIRST: if the board ALREADY has holes (gaps buried under blocks), abandon the Tetris ambition and
      // go into RECOVERY — the only priority is digging those gaps out (clearing the rows covering them), NOT
      // building a well or chasing other lines. Stacking a well on a holey board is what turns a slip into a top-out.
      var recovery = before.holes > 0;
      if(after.maxHeight>=18) s-=15000;
      if(after.holes>=10) s-=10000;
      if(move.linesCleared===4 && after.isSafe) s+=6000;                               // TETRIS — the primary goal
      if(after.hasCleanTetrisWell && !after.isSafe) s-=1500;                            // never preserve a well while going dangerous
      // BUILD toward a Tetris (the well column is SACRED) — but ONLY from a clean board. With holes present we skip
      // all of this so the bot doesn't stack onto the mess; it fixes the gaps first.
      if(!recovery){
        if(after.hasCleanTetrisWell && after.isSafe) s+=1200;                            // keep the well
        if(after.isSafe){
          s += Math.min(after.tetrisReadyRows, 4) * 360;                                // build/maintain a 4-deep Tetris well (low floor = safer)
          if(move.linesCleared < 4) s -= after.wellBlocks * 350;                        // keep the well pristine (only an I-Tetris fills it)
        }
        if(move.linesCleared >= 1 && move.linesCleared < 4 && after.isSafe)
          s -= Math.max(0, before.tetrisReadyRows - after.tetrisReadyRows) * 600;        // don't burn a Tetris setup for a small clear
      }
      if(after.maxHeight > SAFE_H) s -= (after.maxHeight - SAFE_H) * 700;                 // progressive penalty above the safe line -> keep the board low, clear/tetris BEFORE danger
      if(after.maxHeight >= WARN_H) s -= 3000;                                            // hard cliff at the warning height -> definitively clear before the danger zone
      if(move.linesCleared===1) s+=100; else if(move.linesCleared===2) s+=250; else if(move.linesCleared===3) s+=500;
      s -= after.holes*400; s -= after.coveredHoles*150; s -= after.bumpiness*45; s -= after.maxHeight*30; s -= after.aggregateHeight*8;
      s -= Math.max(0, after.holes-before.holes)*700;
      s -= Math.max(0, after.coveredHoles-before.coveredHoles)*200;
      s -= Math.max(0, after.bumpiness-before.bumpiness)*60;
      s -= Math.max(0, after.maxHeight-before.maxHeight)*80;
      s += Math.max(0, before.holes-after.holes) * (recovery?1600:700);                 // RECOVERY: removing a buried gap is the single top priority
      s += Math.max(0, before.coveredHoles-after.coveredHoles) * (recovery?550:250);     // clearing the rows that cover a gap = de-risk ASAP
      s += Math.max(0, before.bumpiness-after.bumpiness)*70;
      return s;
    }
    function legalPlacements(b, k){
      var rmax=(k==='O')?1:4, out=[], r, x;
      for(r=0;r<rmax;r++) for(x=-2;x<=COLS;x++){ var res=simDropOn(b,k,r,x); if(res) out.push({ r:r, x:x, res:res }); }
      return out;
    }
    function computePlan(){
      var k=st.piece.k, nk=st.next, beforeRoot=analyzeBoard(board);
      var curMoves=legalPlacements(board,k), best=null, bestScore=-Infinity, fallback=null, fbMax=Infinity, i, j;
      for(i=0;i<curMoves.length;i++){
        var cm=curMoves[i], cres=cm.res; if(cres.top) continue;
        var afterCur=analyzeBoard(cres.board);
        if(afterCur.maxHeight<fbMax){ fbMax=afterCur.maxHeight; fallback={ r:cm.r, x:cm.x }; }   // survival fallback if all play is "danger"
        var curScore=evaluateAfter(beforeRoot, afterCur, { linesCleared:cres.linesCleared });
        if(curScore===-Infinity) continue;
        var nxt=legalPlacements(cres.board,nk), bestNext=-Infinity;
        for(j=0;j<nxt.length;j++){
          var nm=nxt[j], nres=nm.res; if(nres.top) continue;
          var ns=evaluateAfter(afterCur, analyzeBoard(nres.board), { linesCleared:nres.linesCleared });
          if(ns>bestNext) bestNext=ns;
        }
        if(bestNext===-Infinity) bestNext=curScore;        // next piece has no safe spot -> judge on the current move alone
        var total=curScore*CUR_W + bestNext*NXT_W;
        if(total>bestScore){ bestScore=total; best={ r:cm.r, x:cm.x }; }
      }
      if(!best) best = fallback || { r: st.piece.r, x: st.piece.x };
      st.plan = best; st.planFor = st.pieceCount;
    }

    // ===================== UPDATE =====================
    // resolve active clear animation first
    if (st.flashT > 0){
      st.flashT -= dt;
      if (st.flashT <= 0){ st.flashT = 0; doCollapse(); }
    }
    var locked = st.flashT > 0;

    // decay overlays
    if (st.shake > 0) st.shake = Math.max(0, st.shake - dt * 1.6);
    if (st.topFlash > 0) st.topFlash = Math.max(0, st.topFlash - dt * 1.4);

    // gravity speeds up with level
    var gStep = Math.max(0.10, st.gravStep - st.level * 0.04);

    if (!locked){
      TetrisBehavior.update({
        dt: dt,
        COLS: COLS,
        st: st,
        IN: IN,
        K: K,
        act: act,
        gStep: gStep,
        tryMove: tryMove,
        tryRotate: tryRotate,
        hardDrop: hardDrop,
        lockPiece: lockPiece,
        computePlan: computePlan,
        fx: fx
      });
    }

    // re-read in case a lock this frame just started a line-clear flash
    locked = st.flashT > 0;

    // DANGER state: stack creeping into the danger zone -> mode enter/exit (sparingly)
    var stackTop = ROWS;
    for (var dcx=0; dcx<COLS; dcx++){ for (var dcy=0; dcy<ROWS; dcy++){ if (board[dcy][dcx]){ if (dcy < stackTop) stackTop = dcy; break; } } }
    var stackH = ROWS - stackTop;
    var inDanger = stackH >= 16;
    if (inDanger && !st._danger){ st._danger = true; EVENT('state', 7, {name:'danger', on:true}); }
    else if (!inDanger && st._danger && stackH <= 13){ st._danger = false; EVENT('state', 5, {name:'danger', on:false}); }

    var audio = ctx.audio || {};
    var raw = audio.raw || {};
    var cl = raw.cl || {};
    var GRID = raw.gr || { gstep:0, phase:0, beat:0, bar:0, bpm:120 };
    ctx.tetrisView = {
      dt: dt,
      cl: cl,
      GRID: GRID,
      energy: audio.energy == null ? MV.energy(cl) : audio.energy,
      drop: audio.drop == null ? MV.isDrop(cl) : !!audio.drop,
      locked: locked,
      collide: collide
    };

  }

  return {
    make: make,
    update: update
  };
})();

(function(){
  VisualizerGame.layer('tetris', 'definition', {
    packVersion: 2,
    key: "tetris",
    name: "TETRIS",
    family: "falling blocks",
    description: "Self-playing block stack with pieces, locks, clears, and board pressure.",
    source: "split-pack-definition-rules",
    entities: [
      "well",
      "fallingPiece",
      "ghostPiece",
      "lockedBlock",
      "nextPiece",
      "clearFlash",
      "scoreText"
    ],
    rules: [
      "piece spawn",
      "grid movement",
      "rotation kicks",
      "collision with stack",
      "lock delay",
      "line clear",
      "top-out recovery"
    ],
    events: [
      "pieceSpawned",
      "pieceMoved",
      "pieceRotated",
      "pieceLocked",
      "lineCleared",
      "combo",
      "dangerStack"
    ],
    simulation: {
      timestep: "dt-clamped local update behind shared runtime",
      collision: "owned by TetrisDefinition.update and exposed to renderer through ctx.tetrisView",
      musicKnowledge: "normalized ctx.audio only; no raw clock reads"
    },
    make: TetrisDefinition.make,
    update: TetrisDefinition.update
  });
})();
