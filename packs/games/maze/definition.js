// BYTE MAZE pack definition. Rules and nouns only; no audio reads and no drawing.
const MazeDefinition = (function(){
  const MAZES = [
    [
      "###################",
      "#........#........#",
      "#o##.###.#.###.##o#",
      "#.................#",
      "#.##.#.#####.#.##.#",
      "#.................#",
      "####.##.#.#.##.####",
      "   #.#.......#.#   ",
      "####.#.##-##.#.####",
      "    .#.#PPP#.#.    ",
      "####.#.#PPP#.#.####",
      "   #.#.#####.#.#   ",
      "####.#.#####.#.####",
      "#........#........#",
      "#.##.###.#.###.##.#",
      "#o.#.........#...o#",
      "##.#.#.#####.#.#.##",
      "#....#...#...#....#",
      "#.######.#.######.#",
      "#........#........#",
      "###################"
    ],
    [
      "###################",
      "#o...............o#",
      "#.#.#.#.#.#.#.#.#.#",
      "#.................#",
      "#.######.#.######.#",
      "#.................#",
      "####.##.#.#.##.####",
      "   #.#.......#.#   ",
      "####.#.##-##.#.####",
      "    .#.#PPP#.#.    ",
      "####.#.#PPP#.#.####",
      "   #.#.#####.#.#   ",
      "####.#.#####.#.####",
      "#.................#",
      "#.######.#.######.#",
      "#.................#",
      "#.#.#.#.#.#.#.#.#.#",
      "#o...............o#",
      "#.######.#.######.#",
      "#........#........#",
      "###################"
    ],
    [
      "###################",
      "#........#........#",
      "#.##.###.#.###.##.#",
      "#o##.....#.....##o#",
      "#.##.###.#.###.##.#",
      "#.................#",
      "####.##.#.#.##.####",
      "   #.#.......#.#   ",
      "####.#.##-##.#.####",
      "    .#.#PPP#.#.    ",
      "####.#.#PPP#.#.####",
      "   #.#.#####.#.#   ",
      "####.#.#####.#.####",
      "#........#........#",
      "#.##.###.#.###.##.#",
      "#o.#.........#...o#",
      "##.#.#.#####.#.#.##",
      "#....#...#...#....#",
      "#.######.#.######.#",
      "#........#........#",
      "###################"
    ],
    [
      "###################",
      "#........#........#",
      "#o##.#.#.#.#.#.##o#",
      "#........#........#",
      "#.##.#.#.#.#.#.##.#",
      "#........#........#",
      "####.#.#.#.#.#.####",
      "   #.#.......#.#   ",
      "####.#.##-##.#.####",
      "    .#.#PPP#.#.    ",
      "####.#.#PPP#.#.####",
      "   #.#.#####.#.#   ",
      "####.#.#####.#.####",
      "####.#.#.#.#.#.####",
      "#........#........#",
      "#.##.#.#.#.#.#.##.#",
      "#........#........#",
      "#o##.#.#.#.#.#.##o#",
      "#........#........#",
      "#........#........#",
      "###################"
    ],
    [
      "###################",
      "#........#........#",
      "#.####.#.#.#.####.#",
      "#o#....#.#.#....#o#",
      "#.#.##.#.#.#.##.#.#",
      "#.#....#.#.#....#.#",
      "####.#.#.#.#.#.####",
      "   #.#.......#.#   ",
      "####.#.##-##.#.####",
      "    .#.#PPP#.#.    ",
      "####.#.#PPP#.#.####",
      "   #.#.#####.#.#   ",
      "####.#.#####.#.####",
      "####.#.#.#.#.#.####",
      "#.#....#.#.#....#.#",
      "#.#.##.#.#.#.##.#.#",
      "#o#....#.#.#....#o#",
      "#.####.#.#.#.####.#",
      "#........#........#",
      "#........#........#",
      "###################"
    ],
    [
      "###################",
      "#........#........#",
      "#o#.#.#..#..#.#.#o#",
      "#........#........#",
      "#.#.#.#..#..#.#.#.#",
      "#........#........#",
      "####.#.#.#.#.#.####",
      "   #.#.......#.#   ",
      "####.#.##-##.#.####",
      "    .#.#PPP#.#.    ",
      "####.#.#PPP#.#.####",
      "   #.#.#####.#.#   ",
      "####.#.#####.#.####",
      "####.#.#.#.#.#.####",
      "#........#........#",
      "#.#.#.#..#..#.#.#.#",
      "#........#........#",
      "#o#.#.#..#..#.#.#o#",
      "#........#........#",
      "#........#........#",
      "###################"
    ],
    [
      "###################",
      "#........#........#",
      "#.##..##.#.##..##.#",
      "#o#....#.#.#....#o#",
      "#....#.......#....#",
      "#.#....#.#.#....#.#",
      "####.#.#.#.#.#.####",
      "   #.#.......#.#   ",
      "####.#.##-##.#.####",
      "    .#.#PPP#.#.    ",
      "####.#.#PPP#.#.####",
      "   #.#.#####.#.#   ",
      "####.#.#####.#.####",
      "####.#.#.#.#.#.####",
      "#.#....#.#.#....#.#",
      "#....#.......#....#",
      "#o#....#.#.#....#o#",
      "#.##..##.#.##..##.#",
      "#........#........#",
      "#........#........#",
      "###################"
    ]
  ];
  // The removed V1 layout opened the corridor below the ghost pen and caused a pen-orbit loop.
  const WALL_COLORS = ['#2121de','#f878f8','#00c8c8','#ff8030','#a248ff','#28c878','#e85070','#d8c020'];
  const DOOR_COLORS = ['#ffb8ae','#ffb8ff','#b8fff8','#ffe0b8','#e8c8ff','#c8ffd8','#ffd0d8','#fff4c0'];
  const DOT_COLORS = ['#ffb8ae','#ffd8f8','#b8fff8','#ffe0b8'];
  const DRONE_COLORS = ['#ff4f9a','#7ef29a','#ffca4b','#8f7cff'];

  function layoutSize(A){
    A=A||{w:19,h:21};
    const base=Math.max(1,Math.min(A.w/19,A.h/21));
    const rawRows=A.h/base;
    // Stretching the maze across a 16:9 screen gave 37 columns where an arcade
    // maze has 28 and a Game Boy one has ~19, so every cell shrank and the board
    // read as noise from far away. Cap the width at Game Boy proportions; the
    // renderer centres what is left, which is what a handheld maze looks like on
    // a wide display.
    // Fewer, bigger cells on the panel. 21 rows into 144 gives 6px cells that
    // read as noise; 17 rows gives 8px, which is what a handheld maze uses.
    const DMG=(typeof CT_DMG_NATIVE!=='undefined'&&CT_DMG_NATIVE);
    const MAXC=DMG?21:Math.round(A.w/base);
    let rawCols=Math.min(A.w/base,MAXC);
    let cols=Math.max(DMG?17:19,Math.round(rawCols));
    let rows=Math.max(DMG?17:21,Math.round(DMG?Math.min(rawRows,17):rawRows));
    if(!(cols&1)) cols+=rawCols<cols?-1:1;
    if(!(rows&1)) rows+=rawRows<rows?-1:1;
    return {cols,rows};
  }
  function ghostTarget(cols){
    // One classic quartet is right for the original/narrow maze. Widescreen
    // boards add another quartet per ~30 columns so the expanded corridors
    // contain actual chase pressure, not just pellets. Keep the pool bounded:
    // later quartets are staggered out of the shared pen and run slower.
    return Math.min(16, Math.max(4, Math.ceil(Math.max(1,cols)/30)*4));
  }
  function buildMaze(cols, rows, variant){
    const grid=[];
    for(let r=0;r<rows;r++){
      const row=[];
      for(let c=0;c<cols;c++){
        const edge=r===0||r===rows-1||c===0||c===cols-1;
        const pillar=!edge&&r%2===0&&c%2===0;
        row.push(edge||pillar?'#':'.');
      }
      grid.push(row);
    }
    // Add short deterministic wall strokes without closing the open corridor
    // network. Variants shift their cadence but never consume random state.
    for(let r=3;r<rows-3;r+=4){
      const shift=(r+variant*2)%6;
      for(let c=3+shift;c<cols-3;c+=8){
        grid[r][c]='#';
        if(c+1<cols-1)grid[r][c+1]='#';
      }
    }
    const penC=(cols/2)|0,penR=Math.max(4,((rows/2)|0)-1);
    for(let c=penC-2;c<=penC+2;c++)grid[penR-1][c]='#';
    grid[penR-1][penC]='-';
    for(let r=penR;r<=penR+1;r++){
      grid[r][penC-2]='#';grid[r][penC+2]='#';
      for(let c=penC-1;c<=penC+1;c++)grid[r][c]='P';
    }
    for(let c=penC-2;c<=penC+2;c++)grid[penR+2][c]='#';
    grid[penR-2][penC]='.';
    if(penR>2)grid[penR-3][penC]='.';
    // Side tunnel and EIGHT power pellets (2x): the four expanded corners + four along the top/bottom rows.
    const tunnelR=(rows/2)|0;
    grid[tunnelR][0]=' ';grid[tunnelR][cols-1]=' ';
    grid[1][1]=grid[1][cols-2]=grid[rows-2][1]=grid[rows-2][cols-2]='o';
    const qx=Math.max(3, cols>>2);
    function pow(r,c){ if(grid[r]&&grid[r][c]==='.') grid[r][c]='o'; }
    pow(1,qx); pow(1,cols-1-qx); pow(rows-2,qx); pow(rows-2,cols-1-qx);
    return {src:grid.map(function(row){return row.join('');}),penC,penR,doorR:penR-1};
  }

  function cloneMaze(src){
    return src.map(function(row){ return row.split(''); });
  }
  function countDots(grid){
    let dots = 0;
    for(let r=0;r<grid.length;r++){
      for(let c=0;c<grid[r].length;c++){
        const t = grid[r][c];
        if(t === '.' || t === 'o') dots++;
      }
    }
    return dots;
  }
  function passOpen(grid, c, r){
    if(r < 0 || r >= grid.length || c < 0 || c >= grid[0].length) return false;
    const t = grid[r][c];
    return t !== '#' && t !== '-' && t !== 'P';
  }
  function findSpawn(grid, centerC, centerR){
    for(let rad=0; rad<12; rad++){
      for(let r=centerR-rad; r<=centerR+rad; r++){
        if(r<0 || r>=grid.length) continue;
        for(let c=centerC-rad; c<=centerC+rad; c++){
          if(c<0 || c>=grid[0].length) continue;
          if(passOpen(grid, c, r)) return { c, r };
        }
      }
    }
    return { c:1, r:1 };
  }
  function makeState(A, variant, sound){
    variant = ((variant || 0) % MAZES.length + MAZES.length) % MAZES.length;
    const size=layoutSize(A),built=buildMaze(size.cols,size.rows,variant);
    const src = built.src;
    const grid = cloneMaze(src);
    const rows = grid.length;
    const cols = grid[0].length;
    const penC=built.penC,penR=built.penR,doorR=built.doorR;
    const pStart = findSpawn(grid,penC,Math.min(rows-2,penR+4));
    const pac = { c:pStart.c, r:pStart.r, dir:3, want:3, off:0, mouth:0, sc:pStart.c, sr:pStart.r };
    const corners = [ {c:cols-2,r:1}, {c:1,r:1}, {c:cols-2,r:rows-2}, {c:1,r:rows-2} ];
    const penSpots = [ {c:penC,r:penR},{c:penC-1,r:penR+1},{c:penC,r:penR+1},{c:penC+1,r:penR+1} ];
    const ghosts = [];
    const ghostCount=ghostTarget(cols);
    for(let i=0;i<ghostCount;i++){
      const persona=i%4, wave=(i/4)|0;
      const ps = penSpots[persona];
      ghosts.push({
        c:ps.c, r:ps.r, dir:0, off:0,
        sc:ps.c, sr:ps.r,
        col:DRONE_COLORS[persona],
        mode:'scatter',
        corner:corners[persona],
        persona:persona, wave:wave,
        penTimer:i * 0.9,
        inPen:i > 0
      });
    }
    const dots = countDots(grid);
    sound = sound || {};
    return {
      variant, grid, src, allMazes:MAZES, rows, cols, dots, totalDots:dots,
      lastPhrase:-1, eatFlash:0, eatX:0, eatY:0,
      pac, ghosts,
      penC, penR, doorR, spawn:pStart, penSpots,
      fright:0, frightMax:6.0, ghEaten:0,
      modeT:0, modePhase:0,
      lives:3, dead:0, win:0, freeze:0,
      wakaTog:0, sirenT:0, arpT:0, arpStep:0,
      time:0, kick:0, flash:0, score:0,
      wallCol:WALL_COLORS[variant] || WALL_COLORS[0],
      doorCol:DOOR_COLORS[variant] || DOOR_COLORS[0],
      dotCol:DOT_COLORS[variant] || DOT_COLORS[0],
      pacSpeed:5.6, ghSpeed:4.7,
      movePer:1.67, ghPer:2.5,   // ~1.2x faster whole-game pace (Pac + ghosts)
      melIdx:0,
      melodyArr:sound.melody || [0,2,3,2,4,2,3,4,2,0,2,3,4,3,2,0],
      bassArr:sound.bass || [0,0,3,2]
    };
  }

  function cellType(st, c, r){
    if(r < 0 || r >= st.rows) return '#';
    if(c < 0 || c >= st.cols) return ' ';
    const row = st.grid[r];
    if(!row) return '#';
    return row[c];
  }
  function isWall(st, c, r){
    return cellType(st, c, r) === '#';
  }
  function pacPass(st, c, r){
    const t = cellType(st, c, r);
    return t !== '#' && t !== '-' && t !== 'P';
  }
  function ghostPass(st, c, r){
    return cellType(st, c, r) !== '#';
  }
  function wrapC(st, c){
    if(c < 0) return st.cols - 1;
    if(c >= st.cols) return 0;
    return c;
  }
  function resetEntities(st){
    const pac = st.pac;
    pac.c = st.spawn.c; pac.r = st.spawn.r;
    pac.sc = pac.c; pac.sr = pac.r;
    pac.off = 0; pac.dir = 3; pac.want = 3;
    for(let gi=0; gi<st.ghosts.length; gi++){
      const g = st.ghosts[gi];
      const ps = st.penSpots[(g.persona==null?gi:g.persona)%st.penSpots.length];
      g.c = ps.c; g.r = ps.r;
      g.sc = ps.c; g.sr = ps.r;
      g.off = 0; g.mode = 'scatter';
      g.inPen = gi > 0;
      g.penTimer = gi * 0.9;
      g.dir = 0;
    }
    st.fright = 0;
    st.modeT = 0;
    st.modePhase = 0;
    st.ghEaten = 0;
  }
  function regenBoard(st){
    for(let r=0; r<st.rows; r++){
      for(let c=0; c<st.cols; c++){
        st.grid[r][c] = st.src[r][c];
      }
    }
    const dots = countDots(st.grid);
    st.dots = dots;
    st.totalDots = dots;
  }
  function morphMaze(st, newSrc){
    for(let r=0; r<st.rows; r++){
      for(let c=0; c<st.cols; c++){
        const was = st.grid[r][c];
        const nt = newSrc[r][c];
        if(nt === '#' || nt === '-' || nt === 'P'){
          st.grid[r][c] = nt;
        } else if(was === '#' || was === '-' || was === 'P'){
          st.grid[r][c] = ' ';
        }
      }
    }
    st.src = newSrc;
    st.dots = countDots(st.grid);
  }
  function update(ctx){
    ctx = ctx || {};
    var dt = ctx.dt;
    var U = ctx.U || 8;
    var A = ctx.A || {x:0, y:0, w:0, h:0};
    var IN = ctx.IN || {};
    var SND = ctx.SND || {};
    var st = ctx.state || ctx.st;
    if(!st) return;
    var wanted=layoutSize(A);
    if(st.cols!==wanted.cols||st.rows!==wanted.rows){
      var fresh=makeState(A,st.variant,{melody:st.melodyArr,bass:st.bassArr}),keepViz=st.$viz;
      var keepTime=st.time||0,keepScore=st.score||0,keepLives=st.lives==null?3:st.lives;
      for(var oldKey in st)if(oldKey!=='$viz'&&Object.prototype.hasOwnProperty.call(st,oldKey))delete st[oldKey];
      for(var newKey in fresh)if(Object.prototype.hasOwnProperty.call(fresh,newKey))st[newKey]=fresh[newKey];
      if(keepViz)st.$viz=keepViz;
      st.time=keepTime;st.score=keepScore;st.lives=keepLives;
    }
    if(!(dt>0)) dt=0.016;
    if(dt>0.05) dt=0.05;
    if(!IN) IN={x:0.5,y:0.5,down:false,click:false,active:false,keys:{}};
    if(!IN.keys) IN.keys={};
    var snd = SND || {};
    function NOTE(d,du,v){ if(snd.note) try{ snd.note(d,du,v); }catch(e){} }
    function FX(n,s){ if(snd.fx) try{ snd.fx(n,s||0); }catch(e){} }
    function ACT(a){ if(snd.act) try{ snd.act(a); }catch(e){} }
    function BASS(d,du,v){ if(snd.bass) try{ snd.bass(d,du,v); }catch(e){} }
    function HAT(v){ if(snd.drum) try{ snd.drum('hat',v); }catch(e){} }
    function LEAD(du,v){ if(snd.lead) try{ snd.lead(du,v); } catch(e){} else NOTE(0,du,v); }
    function EVENT(c,i,o){ if(snd && typeof snd.event==='function') try{ snd.event(c,i,o); }catch(e){} }

    var rows=st.rows, cols=st.cols, grid=st.grid;
    st.time += dt;
    if(st.kick>0){ st.kick-=dt*6; if(st.kick<0)st.kick=0; }
    if(st.flash>0){ st.flash-=dt*4; if(st.flash<0)st.flash=0; }
    if(st.eatFlash>0){ st.eatFlash-=dt*5; if(st.eatFlash<0)st.eatFlash=0; }

    // ===== MUSIC-VIDEO CLOCK (beat=pulse, bar=palette, phrase=variation, event=juice) =====
    var audio = ctx.audio || {};
    var raw = audio.raw || {};
    var cl = raw.cl || {};
    var sharedGrid = raw.gr || {gstep:0, phase:0, beat:0, bar:0, bpm:132};

    var DC=[0,1,0,-1], DR=[-1,0,1,0];
    var DEF = MazeDefinition;
    function cellType(c,r){ return DEF.cellType(st, c, r); }
    function isWall(c,r){ return DEF.isWall(st, c, r); }
    function pacPass(c,r){ return DEF.pacPass(st, c, r); }
    function ghPass(c,r){ return DEF.ghostPass(st, c, r); }
    function wrapC(c){ return DEF.wrapC(st, c); }

    var ts = Math.ceil(Math.max((A.w)/cols, (A.h)/rows));
    if(ts<3) ts=3;
    var mazeW=ts*cols, mazeH=ts*rows;
    var ox=A.x+(A.w-mazeW)/2, oy=A.y+(A.h-mazeH)/2;
    function CX(c){ return ox+(c+0.5)*ts; }
    function CY(r){ return oy+(r+0.5)*ts; }

    var pac=st.pac;

    if(st.fright>0){
      st.fright -= dt;
      if(st.fright<=0){ st.fright=0; EVENT('state',8,{name:'powered',on:false}); }   // powered mode wears off
    } else {
      st.modeT += dt;
      var dur = (st.modePhase%2===0) ? 6.0 : 16.0;
      if(st.modeT>=dur){ st.modeT=0; st.modePhase++; }
    }
    var globalMode = (st.fright>0) ? 'fright' : ((st.modePhase%2===0) ? 'scatter' : 'chase');

    function resetEntities(){
      DEF.resetEntities(st);
    }
    function regenBoard(){
      DEF.regenBoard(st);
    }
    // PHRASE = VARIATION: at each phrase boundary re-shape the MAZE WALLS to a phrase-stable variant
    // (the ghost-house/door is identical across all 8 layouts, so entities never get trapped). Already-eaten
    // pellets stay eaten — only the wall silhouette morphs, so the board stays recognizable & clearable.
    function morphMaze(newSrc){
      DEF.morphMaze(st, newSrc);
    }

    if(st.freeze>0){
      st.freeze -= dt;
      if(st.freeze<=0){
        st.freeze=0;
        if(st.dead){
          st.dead=0;
          if(st.lives<=0){ regenBoard(); st.lives=3; st.score=0; }
          resetEntities();
        }
      }
    }

    if(st.win>0){
      st.win -= dt;
      if(st.win<=0){
        st.win=0;
        regenBoard();
        resetEntities();
      }
    }

    var frozen = (st.freeze>0) || (st.win>0);

    // (The maze no longer morphs mid-play. It used to re-shape on every phrase boundary and re-seat the runner and drones
    //  at their start tiles each time, which looked like random respawns. Layout changes now happen on the scene TIMER:
    //  the runtime re-makes Byte Maze with a fresh maze every ~30s.)
    st.lastPhrase = cl.phrase;

    // SAFETY GUARD: if the runner is ever found inside a wall/blocked tile (any path that mutated the
    // layout without re-seating him), snap him back to the canonical start rather than leaving him stuck.
    if(!frozen && !st.dead && !pacPass(pac.c, pac.r)){
      resetEntities(); pac.moveStart = undefined;
    }

    var pfx = pac.sc + (pac.c-pac.sc)*pac.off;
    var pfy = pac.sr + (pac.r-pac.sr)*pac.off;

    var humanActive = !!IN.active;
    if(humanActive && !frozen){
      if(IN.keys.left) pac.want=3;
      else if(IN.keys.right) pac.want=1;
      else if(IN.keys.up) pac.want=0;
      else if(IN.keys.down) pac.want=2;
      else if(IN.down || IN.click){
        var psx=CX(pfx), psy=CY(pfy);
        var px=(IN.lx!=null?IN.lx:(A.x+A.w*(IN.x!=null?IN.x:0.5)));
        var py=(IN.ly!=null?IN.ly:(A.y+A.h*(IN.y!=null?IN.y:0.5)));
        var dx=px-psx, dy=py-psy;
        if(Math.abs(dx)>Math.abs(dy)) pac.want = dx>0?1:3;
        else pac.want = dy>0?2:0;
      }
    } else if(!frozen && pac.off < 0.18){
      var behaviorWant = MazeBehavior.choosePacDirection(st);
      if(behaviorWant != null) pac.want = behaviorWant;
    }

    if(!frozen){
      // MOVEMENT LOCKED TO THE MUSIC: Pac advances exactly one tile per `movePer` sixteenth-notes,
      // so his steps + every pellet eaten land on the beat (the eats are the melody on the grid).
      var GR = sharedGrid;
      var gf = GR.gstep + GR.phase;
      if(pac.moveStart===undefined) pac.moveStart = gf;
      var movePer = st.movePer || 2;
      var guard=0;
      while(gf - pac.moveStart >= movePer && guard<8){
        guard++;
        pac.moveStart += movePer;
        pac.sc=pac.c; pac.sr=pac.r;
        // the full song (drums/bass/arp/lead) plays continuously via the composer and NEVER stops.
        // gameplay only MODULATES it: eating energizes the music (brighter + busier) + a bright sparkle.
        st.kick=1;
        var row=grid[pac.r];
        var here = row && row[pac.c];
        if(here==='.'){
          row[pac.c]=' '; st.dots--; st.score+=10; ACT(0.5); NOTE(0, 0.05, 0.045); EVENT('minor',2);   // SFX: every small pellet = a quiet on-beat tick (the waka layer)
          st.eatFlash=1; st.eatX=pac.c; st.eatY=pac.r;   // EVENT juice: tiny local sparkle at the eaten pellet
        } else if(here==='o'){
          row[pac.c]=' '; st.dots--; st.score+=50; st.flash=0.8;
          st.fright = st.frightMax; st.ghEaten=0;
          st.arpStep=0; st.arpT=0;
          FX('power', 12); EVENT('major',9); EVENT('state',8,{name:'powered',on:true});   // SFX: big pellet = a major payoff + enter powered mode
          for(var gp=0; gp<st.ghosts.length; gp++){ var gpp=st.ghosts[gp]; if(gpp.mode!=='eyes' && !gpp.inPen){ gpp.mode='fright'; gpp.dir=(gpp.dir+2)%4; } }
        }
        if(st.dots<=0 && st.win<=0){
          st.win=2.0; st.flash=1; st.score+=200;
          FX('clear', 7); EVENT('major',10);   // SFX: board/maze clear = a major payoff
          break;
        }
        var nxt=null;
        var wc=wrapC(pac.c+DC[pac.want]), wr=pac.r+DR[pac.want];
        if(wr>=0 && wr<rows && pacPass(pac.c+DC[pac.want], wr)){ pac.dir=pac.want; nxt={c:wc,r:wr}; }
        else {
          var fc=wrapC(pac.c+DC[pac.dir]), fr=pac.r+DR[pac.dir];
          if(fr>=0 && fr<rows && pacPass(pac.c+DC[pac.dir], fr)) nxt={c:fc,r:fr};
        }
        if(nxt){ pac.c=nxt.c; pac.r=nxt.r;
          if(Math.abs(pac.c-pac.sc)>1){ pac.sc=pac.c; pac.sr=pac.r; } }   // tunnel wrap -> snap across, don't slide the whole maze
        else { pac.moveStart = gf; break; }       // blocked: pause on-grid, retry next slot
      }
      pac.off = Math.max(0, Math.min(1, (gf - pac.moveStart)/movePer));
    }
    pac.mouth = (Math.sin(st.time*16)*0.5+0.5);


    if(!frozen){
      var GHOST_GRID = sharedGrid;
      MazeBehavior.updateGhosts(st, {
        dt: dt,
        gridFloat: GHOST_GRID.gstep + GHOST_GRID.phase,
        globalMode: globalMode
      });
    }

    if(!frozen && !st.dead){
      var pfx2 = pac.sc+(pac.c-pac.sc)*pac.off;
      var pfy2 = pac.sr+(pac.r-pac.sr)*pac.off;
      for(var ci=0; ci<st.ghosts.length; ci++){
        var gc=st.ghosts[ci];
        if(gc.inPen || gc.mode==='eyes') continue;
        var gfx3=gc.sc+(gc.c-gc.sc)*gc.off, gfy3=gc.sr+(gc.r-gc.sr)*gc.off;
        if(Math.abs(gfx3-pfx2)<0.6 && Math.abs(gfy3-pfy2)<0.6){
          if(gc.mode==='fright'){
            gc.mode='eyes'; st.ghEaten++; st.score += 200*st.ghEaten; st.flash=0.6;
            // eat-ghost = a SPECIAL bright rising note run, higher each chained ghost (no SFX)
            FX('eatghost', 12); EVENT('major',8);   // SFX: killing a ghost = a major payoff
            ACT(1);
          } else {
            // caught: just RESET the scene and keep the music going — no death sound, no freeze/stop
            var wasPowered = st.fright>0;
            st.lives--; if(st.lives<=0) st.lives=3;
            st.flash=0.7; FX('death', -12); EVENT('major',9);   // SFX: dying (caught) = a major payoff
            if(wasPowered) EVENT('state',8,{name:'powered',on:false});   // powered mode ends on death-reset
            resetEntities(); pac.moveStart = undefined;
            break;
          }
        }
      }
    }

    var renderGrid = sharedGrid;
    ctx.mazeView = {
      cl: cl,
      V: { pulse: audio.beatStrength == null ? MV.beat(cl) : audio.beatStrength },
      GR: renderGrid
    };
  
  }

  return {
    mazes:MAZES,
    cloneMaze,
    countDots,
    passOpen,
    findSpawn,
    ghostTarget,
    makeState,
    update,
    cellType,
    isWall,
    pacPass,
    ghostPass,
    wrapC,
    resetEntities,
    regenBoard,
    morphMaze
  };
})();

(function(){
  VisualizerGame.layer('maze', 'definition', {
  packVersion: 3,
  key: "maze",
  name: "BYTE MAZE",
  family: "maze chase",
  description: "Neon circuit-maze chase with data bits, tunnels, overclock states, and readable drone pressure.",
  source: "definition-extracted-state",
  entities: [
    "player",
    "drone",
    "wall",
    "pellet",
    "overclockCore",
    "tunnel",
    "droneDock",
    "fruit",
    "particle"
  ],
  rules: [
    "grid-constrained movement",
    "wall collision",
    "pellet collection",
    "power pellet mode",
    "drone collision and overclock state",
    "tunnel wrapping",
    "level refill after clear"
  ],
  events: [
    "pelletCollected",
    "powerPelletCollected",
    "droneNear",
    "droneGlitched",
    "droneCollision",
    "tunnelUsed",
    "levelCleared",
    "fruitSpawned"
  ],
  simulation: {
    timestep: "fixed by shared runtime; game code clamps large dt locally",
    stateConstruction: "owned by MazeDefinition.makeState",
    collision: "owned by MazeDefinition.update and the cell/pass helpers",
    resetAndRefill: "owned by MazeDefinition.resetEntities, regenBoard, and morphMaze",
    musicKnowledge: "normalized ctx.audio only; no raw bus reads",
    watchdog: { mode:"single-objective", progress:70, motion:14, loop:16 }
  },
  make: function(A,U,v){return MazeDefinition.makeState(A,v);},
  update: MazeDefinition.update
});
})();
