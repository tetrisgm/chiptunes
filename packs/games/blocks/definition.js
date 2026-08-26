// BLOCKS pack definition. Rules, board state, collision, and simulation update.
// Rendering consumes ctx.blocksView from this layer; this file never draws and never reads raw SND clocks.
//
// ONE BOARD, ONE WELL (classic Blocks) with MULTIPLE cooperating fallers. The board is wide because it fills a
// landscape viewport; a single Blocks well sits at the right edge (COLS-1). Each faller is assigned a slice of
// columns it may PLACE into (so the N pieces spread across the width and never trek far), but every faller SCORES
// the whole shared board — keeping all columns flat + hole-free and the one well open — so together they build the
// bottom rows up across the full width until an I dropped in the well clears 4 complete rows = a real full-width
// Blocks. Line clears are FULL-WIDTH. hardDrop rests on the SETTLED board (fallers are processed sequentially each
// frame) so a piece never welds mid-air onto a sibling.
const BlocksDefinition = (function(){
  var TIME_SCALE = 1.0;   // real-time fall (was 1.5 — blocks fell 1.5x too fast)
  var SIDE_PADDING_COLS = 2;
  var WALL_COLS = 1;

  function gridSize(A){
    A=A||{w:10,h:20};
    // Reserve one wall plus two empty cell-widths outside it on both sides.
    // COLS is only the playable well, so collision and line clears stop at
    // visible boundaries instead of treating the viewport edge as an abyss.
    var frameCols=(SIDE_PADDING_COLS+WALL_COLS)*2;
    var base=Math.max(1,Math.min(A.w/(10+frameCols),A.h/20));
    return {cols:Math.max(10,Math.round(A.w/base)-frameCols),rows:Math.max(20,Math.round(A.h/base))};
  }
  // Multiple fallers on ONE shared board — 3 on a normal viewport. Measured: 3 fallers keep the wide board almost
  // hole-free (~0.2 holes) and top out ~once/2min while landing frequent full-width Blockses; MORE fallers interfere
  // (they bury holes at the lane boundaries and top the board out). Scale to 4 only on an ultra-wide board.
  function pieceCount(COLS){ return Math.max(3, Math.min(4, Math.round(COLS/26))); }
  function shuffledBag(keys){
    var b=keys.slice(),i,j,t;
    // 2x the long "bar" (I-piece) rate: bars are the piece that scores a Blocks. Add a guaranteed 2nd I, plus a 3rd
    // ~40% of the time, so on average ~1.4 extra I per bag -> P(I) ~= 2/7 (~29%), double the standard 1/7. The AI
    // hoards them for the well (see the "save the bar" rule in evaluateAfter).
    b.push('I');
    if(Math.random()<0.4) b.push('I');
    for(i=b.length-1;i>0;i--){ j=(Math.random()*(i+1))|0; t=b[i];b[i]=b[j];b[j]=t; }
    return b;
  }
  // Spread the N spawn points evenly across the top so pieces visually cover the width; they're free to move anywhere.
  function spawnX(idx, N, COLS){ return Math.max(0, Math.min(COLS-4, Math.floor((idx+0.5)*COLS/N) - 2)); }
  function makeFaller(keys, idx, N, COLS){
    var bag=shuffledBag(keys),first=bag.shift(),next=bag.shift(),sx=spawnX(idx,N,COLS);
    return {
      id:idx, bag:bag,
      piece:null, next:first, preview:next, spawnQueued:false,
      plan:null, planFor:-1, planVer:-1, claim:null, claimCells:null, pieceCount:0,
      grav:0, moveT:0, lockT:0, softHold:0, shiftHold:0, _upHeld:false,
      lastTarget:sx
    };
  }
  function configureLayout(st,A){
    var dims=gridSize(A),oldCols=st.COLS,oldRows=st.ROWS;
    if(dims.cols===oldCols&&dims.rows===oldRows)return;
    var next=[],x,y;
    for(y=0;y<dims.rows;y++)next.push(new Array(dims.cols).fill(0));
    var dx=Math.floor((dims.cols-oldCols)/2),dy=dims.rows-oldRows;
    for(y=0;y<oldRows;y++)for(x=0;x<oldCols;x++){
      var nx=x+dx,ny=y+dy;
      if(st.board[y][x]&&nx>=0&&nx<dims.cols&&ny>=0&&ny<dims.rows)next[ny][nx]=st.board[y][x];
    }
    st.COLS=dims.cols;st.ROWS=dims.rows;st.board=next;
    st.flash=st.flash.map(function(r){return r+dy;}).filter(function(r){return r>=0&&r<dims.rows;});
    var N=pieceCount(dims.cols),old=st.pieces||[],pieces=[],i;
    for(i=0;i<N;i++){
      if(old[i]){
        var f=old[i];f.id=i;
        // shift the faller with the board and keep its whole 4x4 box on-screen; force a replan on the new grid
        if(f.piece)f.piece.x=Math.max(0,Math.min(dims.cols-4,f.piece.x+dx));
        f.lastTarget=Math.max(0,Math.min(dims.cols-1,(f.lastTarget||0)+dx));
        f.plan=null;f.planFor=-1;f.planVer=-1;f.claim=null;f.claimCells=null;
        pieces.push(f);
      } else {
        pieces.push(makeFaller(st.keys,i,N,dims.cols));
      }
    }
    st.pieces=pieces;st.N=N;st.boardVer=(st.boardVer||0)+1;
    st.spawnQueue=(st.spawnQueue||[]).filter(function(id){return id>=0&&id<N;});
    for(i=0;i<pieces.length;i++)if(!pieces[i].piece&&!pieces[i].spawnQueued){pieces[i].spawnQueued=true;st.spawnQueue.push(i);}
    if(st.pieceAwait>=N)st.pieceAwait=-1;
  }
  function make(A, U, variant){
    var dims=gridSize(A),COLS=dims.cols,ROWS=dims.rows;
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

    // One active piece preserves normal Blocks planning even on a wide board.
    // 7-BAG randomiser per piece: each of the 7 shapes appears once per shuffled bag, so an I-piece (needed for
    // Blockses) is guaranteed within ~7 pieces — never a long drought.
    var N=pieceCount(COLS),pieces=[];
    for(var pi=0;pi<N;pi++)pieces.push(makeFaller(keys,pi,N,COLS));

    return {
      v: variant, gb: variant === 1, gbBase: Math.random() < 0.5,   // gbBase = which palette this run OPENS on (random, independent of variant/speed)
      COLS: COLS, ROWS: ROWS, SHAPES: SHAPES, keys: keys, board: board,
      sidePaddingCols:SIDE_PADDING_COLS, wallCols:WALL_COLS,
      pieces:pieces, N:N, boardVer:0,
      spawnQueue:pieces.map(function(f){f.spawnQueued=true;return f.id;}),
      spawnCooldown:0, spawnClock:0, spawnTick:0, spawnCount:0, spawnHistory:[], overlapViolations:0,
      // Shared timing constants; accumulators and plans live on each faller.
      gravStep: variant === 1 ? 0.42 : 0.62,  // v1 faster
      moveStep: 0.025,    // near-frame-cadence grid movement; never quantized to the music
      // fx / state
      flash: [],          // rows currently clearing (capped <=4)
      flashT: 0,          // clear animation timer
      flashX0: 0, flashX1: COLS,   // column range currently clearing — full width (one board, full-width line clears)
      clearN: 0,          // how many rows in the active clear (for sweep pitch)
      shake: 0,
      topFlash: 0,        // top-out white-out
      tphase: 0,
      score: 0, lines: 0, level: 0,
      pieceAwait: -1,     // index of the faller whose clear-flash is resolving (respawns after collapse)
      lastTarget: 5       // pointer/ai target column (mirrors the player-controlled faller)
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
    configureLayout(st,A);
    if (!dt || dt < 0) dt = 0.016;
    if (dt > 0.05) dt = 0.05;
    dt *= TIME_SCALE;
    st.tphase += dt;
    st.spawnTick++;
    st.spawnClock+=dt;
    st.spawnCooldown=Math.max(0,(st.spawnCooldown||0)-dt);

    var COLS = st.COLS, ROWS = st.ROWS, SHAPES = st.SHAPES, keys = st.keys, board = st.board;
    // Each faller owns a contiguous column slice [lo,hi) it may PLACE into (keeps the N pieces spread across the
    // wide board, no long treks). It's only a placement lane — the WELL and line-clears are shared/full-width.
    function zoneBounds(id){ var N=st.N||1; return { lo: Math.floor(id*COLS/N), hi: (id===N-1)?COLS:Math.floor((id+1)*COLS/N) }; }

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
    function collideBoard(p){
      var c = cellsOf(p), i;
      for (i=0;i<c.length;i++){
        var x=c[i][0], y=c[i][1];
        if (x < 0 || x >= COLS || y >= ROWS) return true;
        if (y >= 0 && board[y][x]) return true;
      }
      return false;
    }
    function overlapsPiece(p, ignore){
      var c=cellsOf(p), occupied={},i,j,other,oc;
      for(i=0;i<c.length;i++)occupied[c[i][0]+':'+c[i][1]]=1;
      for(i=0;i<st.pieces.length;i++){
        other=st.pieces[i];
        if(other===ignore||!other.piece)continue;
        oc=cellsOf(other.piece);
        for(j=0;j<oc.length;j++)if(occupied[oc[j][0]+':'+oc[j][1]])return true;
      }
      return false;
    }
    function collide(p, ignore){return collideBoard(p)||overlapsPiece(p,ignore);}
    // The faller currently being driven (behavior/hard-drop/lock all read this).
    var F = st.pieces[0];
    function tryMove(dx, dy, dr){
      var p = { k: F.piece.k, x: F.piece.x + dx, y: F.piece.y + dy, r: (F.piece.r + (dr||0) + 4) % 4 };
      if (!collide(p,F)){ F.piece = p; return true; }
      return false;
    }
    // rotate with simple wall-kicks
    function tryRotate(){
      if (F.piece.k === 'O') return false;
      var kicks = [0,-1,1,-2,2], i;
      for (i=0;i<kicks.length;i++){
        var p = { k: F.piece.k, x: F.piece.x + kicks[i], y: F.piece.y, r: (F.piece.r + 1) % 4 };
        if (!collide(p,F)){ F.piece = p; return true; }
      }
      return false;
    }
    // Board-only (ignore siblings) move/rotate — used by autoplay ONLY as a fallback when a sibling directly blocks a
    // trek, so the piece can slip past it (a brief 1-frame overlap up top) and still reach its planned, hole-free
    // column instead of abandoning the plan and burying a hole. Landing is still sequential on the SETTLED board.
    function tryMoveBoard(dx){
      var p = { k: F.piece.k, x: F.piece.x + dx, y: F.piece.y, r: F.piece.r };
      if (!collideBoard(p)){ F.piece = p; return true; }
      return false;
    }
    function tryRotateBoard(){
      if (F.piece.k === 'O') return false;
      var kicks = [0,-1,1,-2,2], i;
      for (i=0;i<kicks.length;i++){
        var p = { k: F.piece.k, x: F.piece.x + kicks[i], y: F.piece.y, r: (F.piece.r + 1) % 4 };
        if (!collideBoard(p)){ F.piece = p; return true; }
      }
      return false;
    }

    function resetBoard(){
      for (var y=0;y<ROWS;y++) for (var x=0;x<COLS;x++) board[y][x]=0;
      st.boardVer++;
      for(var i=0;i<st.pieces.length;i++){ var p=st.pieces[i]; p.plan=null;p.planFor=-1;p.planVer=-1;p.claim=null;p.claimCells=null; }
    }

    function drawNext(f){ if(!f.bag || !f.bag.length)f.bag=shuffledBag(keys);return f.bag.shift(); }
    function queueSpawn(f){
      f.piece=null;f.plan=null;f.planFor=-1;f.planVer=-1;f.claim=null;f.claimCells=null;f.lockT=0;f.grav=0;
      if(!f.spawnQueued){f.spawnQueued=true;st.spawnQueue.push(f.id);}
    }
    function spawnCandidate(f){
      // Spawn INSIDE the faller's own slice so it never appears in a neighbour's well (planning confines it there too).
      var k=f.next,sy=(k==='I'||k==='O')?-1:0,Z=zoneBounds(f.id),lo=Z.lo,hi=Z.hi;
      var loX=Math.max(0,lo),hiX=Math.min(COLS-4,hi-4); if(hiX<loX)hiX=loX;
      var base=Math.max(loX,Math.min(hiX,spawnX(f.id,st.N,COLS))),span=(hiX-loX)*2+2,d,x,p;
      for(d=0;d<=span;d++){
        x=base+(d===0?0:(d%2?Math.ceil(d/2):-Math.ceil(d/2)));
        if(x<loX||x>hiX)continue;
        p={k:k,x:x,y:sy,r:0};
        if(!collide(p,f))return p;
      }
      return null;
    }
    function processSpawnQueue(){
      if(st.spawnCooldown>0||!st.spawnQueue.length)return;
      var id=st.spawnQueue[0],f=st.pieces[id],p=f&&spawnCandidate(f);
      if(!f){st.spawnQueue.shift();return;}
      if(!p){ topOut(); return; }   // a faller can't spawn — the shared board is packed to the top: reset the board
      st.spawnQueue.shift();f.spawnQueued=false;f.piece=p;
      f.next=f.preview;f.preview=drawNext(f);f.pieceCount++;
      f.plan=null;f.planFor=-1;f.planVer=-1;f.claim=null;f.claimCells=null;f.lockT=0;f.grav=0;f.moveT=0;
      st.spawnCooldown=0.06;   // rapid cadence — the next piece drops right on the heels of the last
      st.spawnCount++;
      st.spawnHistory.push({tick:st.spawnTick,time:st.spawnClock,id:f.id,x:p.x});
      if(st.spawnHistory.length>32)st.spawnHistory.shift();
    }
    function topOut(){
      st.topFlash = 0.6; st.shake = 0.5; fx('topout');
      EVENT('major', 9);
      if (st._danger){ EVENT('state', 6, {name:'danger', on:false}); st._danger = false; }
      resetBoard();st.score=0;st.lines=0;st.level=0;st.flash=[];st.flashT=0;st.flashX0=0;st.flashX1=st.COLS;st.pieceAwait=-1;
      st.spawnQueue.length=0;
      for(var i=0;i<st.pieces.length;i++){st.pieces[i].spawnQueued=false;queueSpawn(st.pieces[i]);}
    }
    // lock the active faller F into the shared board, detect full rows (flash starts; collapse on flashT end)
    function lockPiece(){
      var c = cellsOf(F.piece), i, aboveTop = false;
      for (i=0;i<c.length;i++){
        var x=c[i][0], y=c[i][1];
        if (y < 0){ aboveTop = true; continue; }   // a cell locked above the top
        if (y >= 0 && y < ROWS && x >= 0 && x < COLS) board[y][x] = F.piece.k;
      }
      if (aboveTop){                                // FAILURE: locked out the top of the shared board
        topOut();return;
      }
      st.boardVer++;                                // the shared board changed — every faller must re-plan
      fx('thunk');
      EVENT('minor', 3);                              // piece lock = small frequent action
      st.shake = Math.max(st.shake, 0.12);
      // find FULL-WIDTH rows (ONE board, ONE well: a line clears only when it is full across the WHOLE width, so a
      // 4-line Blocks is a real full-width clear — the fallers cooperate to fill every column toward it).
      var full = [];
      for (var y2=0;y2<ROWS;y2++){
        var fr = true;
        for (var x2=0;x2<COLS;x2++){ if (!board[y2][x2]){ fr=false; break; } }
        if (fr) full.push(y2);
      }
      if (full.length){
        F.piece=null;
        st.flash = full; st.flashT = 0.28; st.clearN = full.length;
        st.flashX0 = 0; st.flashX1 = COLS;
        st.pieceAwait=F.id;
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
        // EVENT: single/double = medium accent; triple/BLOCKS = major payoff
        if (full.length >= 3) EVENT('major', full.length >= 4 ? 10 : 8);
        else EVENT('medium', full.length === 2 ? 6 : 4);
      } else {
        queueSpawn(F);
      }
    }

    // collapse cleared rows after the flash — full width (one board; flashX0..X1 span the whole width now)
    function doCollapse(){
      var rows = st.flash.slice(0); rows.sort(function(a,b){ return a-b; });
      var x0 = st.flashX0||0, x1 = (st.flashX1==null?COLS:st.flashX1);
      for (var i=0;i<rows.length;i++){
        var ry = rows[i];
        for (var y=ry;y>0;y--){ for (var x=x0;x<x1;x++) board[y][x] = board[y-1][x]; }
        for (var x4=x0;x4<x1;x4++) board[0][x4] = 0;
      }
      st.flash = []; st.clearN = 0; st.flashX0 = 0; st.flashX1 = COLS; st.boardVer++;
      for(var pi=0;pi<st.pieces.length;pi++){var p=st.pieces[pi];p.plan=null;p.planFor=-1;p.planVer=-1;p.claim=null;p.claimCells=null;}
      var awaitId=st.pieceAwait;st.pieceAwait=-1;
      var aw=st.pieces[Math.max(0,Math.min(st.pieces.length-1,awaitId))];
      queueSpawn(aw);
    }

    // hard-drop the active faller F to the floor, then lock (player tap & AI both use this).
    // The drop collides with the LOCKED board only (not sibling in-flight fallers): fallers are processed
    // sequentially each frame, so a piece rests on the settled stack instead of welding in mid-air onto a
    // sibling that's about to move on — which is what produced floating holes and killed line clears.
    function hardDrop(){
      var moved = 0;
      while (!collideBoard({ k:F.piece.k, x:F.piece.x, y:F.piece.y+1, r:F.piece.r })){ F.piece.y++; moved++; }
      if (moved > 0) st.score += moved;
      fx('drop');
      EVENT('minor', 4);                            // hard-drop = small action (the lock chord follows)
      lockPiece();
    }

    // ===================== AI: ONE SHARED BOARD, ONE WELL — cooperative full-width Blocks =====================
    // The classic model: a single well at the board's right edge (COLS-1). Each faller PLACES only within its own
    // slice [lo,hi) — so the N pieces spread across the wide board and never trek far — but SCORES the WHOLE board:
    // every faller works to keep all columns flat + hole-free and the shared well open, so together they build the
    // bottom rows up across the full width until an I dropped in the well clears 4 complete rows = a real BLOCKS.
    // (A wide viewport forces a wide board; cooperation is what makes a full-width Blocks reachable on it.)
    var VERY_SAFE_H = 10, SAFE_H = 12, WARN_H = 15, DANGER_H = 17;
    var CUR_W = 0.35, NXT_W = 0.65;                       // the slice after BOTH pieces dominates the choice
    // Analyze a single slice [lo,hi): heights/holes/bumpiness/rows are all computed over just those columns,
    // with the Blocks well at the slice's right edge (hi-1).
    function analyzeZone(b, lo, hi){
      var well=hi-1, width=hi-lo, x, y;
      var h=new Array(COLS).fill(0), agg=0, maxh=0, bump=0, holes=0, covered=0;
      for(x=lo;x<hi;x++){ var seen=false, above=0;
        for(y=0;y<ROWS;y++){ if(b[y][x]){ if(!seen){ h[x]=ROWS-y; seen=true; } above++; } else if(seen){ holes++; covered+=above; } }
        agg+=h[x]; if(h[x]>maxh) maxh=h[x]; }
      for(x=lo;x<well;x++) bump+=Math.abs(h[x]-h[x+1]);   // exclude the well edge from bumpiness
      var rowProgress=0, nearRows=0;
      for(y=0;y<ROWS;y++){ var filled=0; for(x=lo;x<hi;x++) if(b[y][x]) filled++; rowProgress+=filled*filled; if(filled>=width-2) nearRows++; }
      // Blocks-well readiness: with the right edge held open, count rows full in every OTHER slice column.
      var ready=0, wellBlocks=0;
      for(y=0;y<ROWS;y++) if(b[y][well]) wellBlocks++;
      if(wellBlocks===0){ for(y=0;y<ROWS;y++){ var fullr=true; for(x=lo;x<well;x++){ if(!b[y][x]){ fullr=false; break; } } if(fullr) ready++; } }
      // clean well: right edge >=4 below every other slice column, neighbours not dangerously high, well hole-free
      var omin=Infinity, omax=0; for(x=lo;x<hi;x++){ if(x===well) continue; if(h[x]<omin) omin=h[x]; if(h[x]>omax) omax=h[x]; }
      var wseen=false, wHole=false; for(y=0;y<ROWS;y++){ if(b[y][well]) wseen=true; else if(wseen){ wHole=true; break; } }
      var cleanWell=(omin-h[well]>=4) && (omax<=WARN_H) && !wHole;
      // count-based thresholds scale with the board width (one wide shared board now, not a ~10-wide slice).
      return { width:width, maxHeight:maxh, aggregateHeight:agg, holes:holes, coveredHoles:covered,
        bumpiness:bump, rowProgress:rowProgress, nearRows:nearRows, blocksReadyRows:ready, wellBlocks:wellBlocks,
        hasCleanBlocksWell:cleanWell,
        topOutRisk:(maxh>=DANGER_H || holes>=Math.round(width*0.45) || covered>=Math.round(width*1.6)),
        isVerySafe:(maxh<=VERY_SAFE_H && holes<=Math.round(width*0.06) && bump<=Math.round(width*0.9) && covered<=Math.round(width*0.35)),
        isSafe:(maxh<=SAFE_H && holes<=Math.round(width*0.3) && bump<=Math.round(width*1.3) && covered<=Math.round(width*0.7)) };
    }
    function collideOn(b, p){ var c=cellsOf(p),i; for(i=0;i<c.length;i++){ var x=c[i][0],y=c[i][1]; if(x<0||x>=COLS||y>=ROWS) return true; if(y>=0 && b[y][x]) return true; } return false; }
    // hard-drop (k,r,x) into a COPY of b; place-restricted to the faller's slice [lo,hi); clear FULL-WIDTH rows
    // (one board, one well) -> {board, linesCleared, top, landY, cols} or null if the piece can't sit in the slice.
    function simDropOn(b, k, r, x, lo, hi){
      var c0=cellsOf({k:k,x:x,y:0,r:r}), i;
      for(i=0;i<c0.length;i++){ var cx0=c0[i][0]; if(cx0<lo || cx0>=hi) return null; }   // must stay inside the slice
      var py=-2; while(!collideOn(b,{k:k,x:x,y:py+1,r:r})) py++;
      var cells=cellsOf({k:k,x:x,y:py,r:r}), nb=[], yy, cols={};
      for(yy=0;yy<ROWS;yy++) nb.push(b[yy].slice(0));
      var top=false;
      for(i=0;i<cells.length;i++){ var cx=cells[i][0], cy=cells[i][1]; cols[cx]=1; if(cy<0){ top=true; continue; } nb[cy][cx]=k; }
      if(top) return { board:nb, linesCleared:0, top:true, landY:py, cols:cols };
      var lines=0;
      for(yy=ROWS-1; yy>=0; ){ var fr=true, xx; for(xx=0;xx<COLS;xx++){ if(!nb[yy][xx]){ fr=false; break; } }   // FULL WIDTH
        if(fr){ nb.splice(yy,1); nb.unshift(new Array(COLS).fill(0)); lines++; } else yy--; }
      return { board:nb, linesCleared:lines, top:false, landY:py, cols:cols };
    }
    // score a slice after a move (pre/post analyses + move{linesCleared}); higher = better.
    // The well column (slice right edge) is kept clean by a HARD placement filter (see computePlan), so the build
    // region [lo,well) can pack flat and, when 4 rows there are full, a vertical I dropped in the well = a BLOCKS.
    function evaluateAfter(before, after, move){
      if(after.topOutRisk) return -Infinity;
      var s=0, lc=move.linesCleared, survive = before.maxHeight >= 13, tall = before.maxHeight >= 16;
      // A BLOCKS dwarfs every smaller clear; smaller clears are for SURVIVAL — worth more the taller the board is, so
      // when the stack creeps up the bot cashes whatever it can (fills the well) instead of towering to a top-out.
      if(lc===4) s+=60000;
      else if(lc===3) s+= tall?16000:survive?9000:2500;
      else if(lc===2) s+= tall?11000:survive?5000:1200;
      else if(lc===1) s+= tall?8000:survive?4000:500;
      // SAVE THE BAR: an I-piece is the only piece that scores a Blocks (a vertical bar dropped into the well clears
      // 4 rows). Never sink one into the well for a smaller clear — HOLD it (lay it flat in the build) until 4 rows
      // are ready, then cash the Blocks. Exception: when the board is TALL, survival wins — use whatever clears.
      if(move.k==='I' && lc<4 && !tall && after.wellBlocks>before.wellBlocks) s -= 50000;
      // Build the well toward exactly 4 deep, but DON'T reward stacking above that — extra height just courts holes.
      s += Math.min(after.blocksReadyRows,4) * 900;
      s += (after.nearRows+lc-before.nearRows)*300;
      // SOFT well reservation: keep the right-edge column open (so an I can cash a Blocks) — a PREFERENCE, not a ban.
      // A block in the well (not clearing ≥4) costs points, but far less than a buried hole. And once the board is
      // TALL we stop protecting the well entirely, so the bot freely fills it to clear rows and de-stack (survival).
      if(lc<4 && !tall) s -= after.wellBlocks * 650;
      // FLATNESS + NO GAPS are the user's headline complaint — these dominate the score; height is punished hard so
      // slices stay shallow (~4-6) and cash a Blocks promptly instead of towering up.
      s -= after.holes*1400;
      s -= after.coveredHoles*160;
      s -= after.bumpiness*140;                                                          // build-region flatness (well edge excluded in analyzeZone)
      s -= after.maxHeight*80;
      s -= after.aggregateHeight*12;
      s -= Math.max(0, after.holes-before.holes)*2400;                                   // creating a new buried gap is nearly a veto
      s -= Math.max(0, after.coveredHoles-before.coveredHoles)*220;
      s -= Math.max(0, after.bumpiness-before.bumpiness)*140;                            // never spike the surface
      s -= Math.max(0, after.maxHeight-before.maxHeight)*80;
      s += Math.max(0, before.holes-after.holes)*1700;                                   // digging a gap back out is a top priority
      s += Math.max(0, before.bumpiness-after.bumpiness)*90;
      return s;
    }
    function legalPlacements(b, k, lo, hi){
      var rmax=(k==='O')?1:4, out=[], r, x;
      for(r=0;r<rmax;r++) for(x=lo-1;x<=hi;x++){ var res=simDropOn(b,k,r,x,lo,hi); if(res) out.push({ r:r, x:x, res:res }); }
      return out;
    }
    function computePlan(){
      var k=F.piece.k, px=(F.piece?F.piece.x:0);
      // NO LANES: every faller may place its piece ANYWHERE across the shared board and scores the WHOLE board
      // (well = COLS-1). So the fallers cooperatively build GLOBALLY flat — a piece goes wherever keeps the whole
      // board lowest + flattest, never just its own third. (Confining pieces to lanes let one region tower while
      // others stayed empty; global scoring already prefers low+flat, so filling the lowest region always wins.)
      // A tiny locality term only breaks near-ties, so a piece won't trek the full width when an equally-good spot
      // is nearby. 1-ply lookahead (no next-piece) keeps a whole-board search cheap enough for the GPU-less box.
      var beforeRoot=analyzeZone(board, 0, COLS);
      var curMoves=legalPlacements(board,k,0,COLS), best=null, bestScore=-Infinity, fallback=null, fbHoles=Infinity, fbMax=Infinity, i;
      for(i=0;i<curMoves.length;i++){
        var cm=curMoves[i], cres=cm.res; if(cres.top) continue;
        var afterCur=analyzeZone(cres.board, 0, COLS);
        // Fallback = the least-bad move if EVERY real option is vetoed: fewest new holes, then lowest board.
        var newHoles=Math.max(0, afterCur.holes-beforeRoot.holes);
        if(newHoles<fbHoles || (newHoles===fbHoles && afterCur.maxHeight<fbMax)){ fbHoles=newHoles; fbMax=afterCur.maxHeight; fallback={ r:cm.r, x:cm.x, landY:cres.landY }; }
        // HARD hole veto: on a wide one-well board a buried gap can NEVER be cleared (full-width rows only), so it
        // guarantees a top-out. Never place a piece that opens a new buried hole unless the fallback forces it.
        if(newHoles>0 && cres.linesCleared<4) continue;
        var curScore=evaluateAfter(beforeRoot, afterCur, { linesCleared:cres.linesCleared, k:k });
        if(curScore===-Infinity) continue;
        // Locality: prefer placing near the piece's current column so pieces mostly build where they spawn and only
        // trek across the board when it clearly helps global flatness (the global height/hole terms dwarf this for a
        // genuinely better far spot). Tuned to ~60: keeps the board flat everywhere (spread ~4) yet minimises the
        // cross-board treks that make two pieces briefly overlap in mid-air. Lower => flatter but more crossings;
        // higher => fewer crossings but each faller starts hoarding its own region again (the "divided" look).
        curScore -= Math.abs(cm.x - px) * 60;
        if(curScore>bestScore){ bestScore=curScore; best={ r:cm.r, x:cm.x, landY:cres.landY }; }
      }
      if(!best) best = fallback || { r: F.piece.r, x: F.piece.x, landY: F.piece.y };
      F.plan = { r:best.r, x:best.x };
      F.claimCells = cellsOf({ k:k, x:best.x, y:best.landY, r:best.r });
      F.claim = F.claimCells.map(function(cell){ return cell[0]; });
      F.planFor = F.pieceCount; F.planVer = st.boardVer;
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
      processSpawnQueue();
      // The single active faller is player-driven when input is active, otherwise it autoplays.
      var selectedPiece=0;
      if(act&&typeof IN.x==='number')selectedPiece=Math.max(0,Math.min(st.pieces.length-1,(IN.x*st.pieces.length)|0));
      for(var fi=0;fi<st.pieces.length;fi++){
        F=st.pieces[fi];
        if(!F.piece)continue;
        // A shared-board change (a sibling locked / a clear collapsed) invalidates this faller's plan.
        if(F.planVer!==st.boardVer){ F.plan=null; F.planFor=-1; }
        BlocksBehavior.update({
          dt: dt,
          COLS: COLS,
          st: st,
          faller: F,
          IN: IN,
          K: K,
          act: act&&fi===selectedPiece,
          gStep: gStep,
          tryMove: tryMove,
          tryRotate: tryRotate,
          tryMoveBoard: tryMoveBoard,
          tryRotateBoard: tryRotateBoard,
          hardDrop: hardDrop,
          lockPiece: lockPiece,
          computePlan: computePlan,
          fx: fx
        });
        st.lastTarget=F.lastTarget;
        if(st.flashT>0)break;   // a lock this frame started a clear -> freeze the rest until collapse
      }
    }

    // re-read in case a lock this frame just started a line-clear flash
    locked = st.flashT > 0;

    // DANGER state: stack creeping into the danger zone -> mode enter/exit (sparingly)
    var stackTop = ROWS;
    for (var dcx=0; dcx<COLS; dcx++){ for (var dcy=0; dcy<ROWS; dcy++){ if (board[dcy][dcx]){ if (dcy < stackTop) stackTop = dcy; break; } } }
    var stackH = ROWS - stackTop;
    var inDanger = stackH >= Math.round(ROWS*0.8);
    if (inDanger && !st._danger){ st._danger = true; EVENT('state', 7, {name:'danger', on:true}); }
    else if (!inDanger && st._danger && stackH <= Math.round(ROWS*0.65)){ st._danger = false; EVENT('state', 5, {name:'danger', on:false}); }

    var audio = ctx.audio || {};
    var raw = audio.raw || {};
    var cl = raw.cl || {};
    var GRID = raw.gr || { gstep:0, phase:0, beat:0, bar:0, bpm:120 };
    ctx.blocksView = {
      dt: dt,
      cl: cl,
      GRID: GRID,
      energy: audio.energy == null ? MV.energy(cl) : audio.energy,
      drop: audio.drop == null ? MV.isDrop(cl) : !!audio.drop,
      locked: locked,
      collide: collideBoard
    };

  }

  return {
    make: make,
    update: update
  };
})();

(function(){
  VisualizerGame.layer('blocks', 'definition', {
    packVersion: 2,
    key: "blocks",
    name: "BLOCKS",
    family: "falling blocks",
    description: "Self-playing block stack with pieces, locks, clears, and board pressure.",
    source: "split-pack-definition-rules",
    entities: [
      "well",
      "fallingPiece",
      "ghostPiece",
      "lockedBlock",
      "clearFlash"
    ],
    rules: [
      "piece spawn",
      "single paced spawn queue",
      "one active piece at a time",
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
      collision: "settled and airborne collision owned by BlocksDefinition.update; board collision exposed to the ghost renderer through ctx.blocksView",
      musicKnowledge: "normalized ctx.audio only; no raw clock reads"
    },
    make: BlocksDefinition.make,
    update: BlocksDefinition.update
  });
})();
