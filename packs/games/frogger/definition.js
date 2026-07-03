// FROGGER pack definition. Owns lane layout, physics, collision, support checks, and round state.
// Renderer consumes ctx.froggerView from this layer; raw bus reads stay centralized in VisualizerGame.
const FroggerDefinition = (function(){
  function make(A, U, variant){
    var night = variant === 1;
    var carCols = night
      ? ['#f8f800','#f0a000','#58d8d8','#e0e0e0','#d83820']
      : ['#f8f800','#d83820','#58f858','#58d8d8','#f070b0'];

    var roadRows = [1,2,3,4,5];
    var riverRows = [7,8,9,10,11];

    function mkRoad(){
      var lanes = [];
      // dir:+1 moves right, -1 moves left. sp = cells/sec base. n = vehicle count.
      // more cars per lane (busier traffic), and mostly small cars — only one big truck for variety
      var specsD = [
        {dir:-1, sp:1.10, kind:'car',  col:carCols[0], n:3, len:1},
        {dir: 1, sp:0.85, kind:'car',  col:carCols[1], n:3, len:1},
        {dir:-1, sp:1.40, kind:'car',  col:carCols[2], n:4, len:1},
        {dir: 1, sp:0.95, kind:'truck',col:'#e0e0e0', n:2, len:2},
        {dir:-1, sp:1.25, kind:'car',  col:carCols[4], n:4, len:1}
      ];
      var specsN = [
        {dir: 1, sp:0.95, kind:'car',  col:carCols[3], n:3, len:1},
        {dir:-1, sp:1.35, kind:'car',  col:carCols[1], n:4, len:1},
        {dir: 1, sp:0.78, kind:'truck',col:'#c0c0c0', n:2, len:2},
        {dir:-1, sp:1.60, kind:'car',  col:carCols[2], n:4, len:1},
        {dir: 1, sp:1.10, kind:'car',  col:carCols[0], n:4, len:1}
      ];
      var specs = night ? specsN : specsD;
      for(var i=0;i<5;i++){
        var s = specs[i];
        var arr = [];
        for(var k=0;k<s.n;k++){
          arr.push({ pos: (k*9.0/s.n) + Math.random()*1.5 });
        }
        lanes.push({row:roadRows[i], dir:s.dir, sp:s.sp, kind:s.kind, col:s.col, len:s.len, cars:arr});
      }
      return lanes;
    }
    function mkRiver(){
      var rows = [];
      // Dense, mostly-non-diving rafts so a forward gap is almost always nearby
      // (faithful to Frogger's busy river) and the AI/player can chain hops up.
      // First river row (index 0) is a forgiving long log -> easy median entry.
      var specsD = [
        {dir: 1, sp:0.50, kind:'log',   len:4, n:4, dive:false},
        {dir:-1, sp:0.72, kind:'turtle',len:3, n:4, dive:false},
        {dir: 1, sp:0.52, kind:'log',   len:4, n:3, dive:false},
        {dir: 1, sp:0.88, kind:'turtle',len:3, n:4, dive:true},
        {dir:-1, sp:0.70, kind:'log',   len:4, n:3, dive:false}
      ];
      var specsN = [
        {dir:-1, sp:0.52, kind:'turtle',len:4, n:4, dive:false},
        {dir: 1, sp:0.58, kind:'turtle',len:3, n:4, dive:true},
        {dir:-1, sp:0.85, kind:'log',   len:4, n:3, dive:false},
        {dir: 1, sp:0.72, kind:'log',   len:3, n:4, dive:false},
        {dir: 1, sp:0.92, kind:'log',   len:4, n:3, dive:false}
      ];
      var specs = night ? specsN : specsD;
      for(var i=0;i<5;i++){
        var s = specs[i];
        var arr = [];
        // even spacing around the wrap span so gaps are predictable & crossable
        var span = 9 + s.len + 4;
        var gap = span / s.n;
        for(var k=0;k<s.n;k++){
          arr.push({ pos:(k*gap) - 1 + (Math.random()*0.4-0.2), phase: Math.random()*6.28, sub:false, _sval:1 });
        }
        rows.push({row:riverRows[i], dir:s.dir, sp:s.sp, kind:s.kind, len:s.len,
                   dive:!!s.dive, items:arr});
      }
      return rows;
    }

    return {
      night: night,
      cols: 9,
      rows: 13,
      slotCols: [0.5,2.0,3.7,5.4,7.2],   // left edge (col units) of each home bay (2-wide)
      bayW: 1.3,                           // bay opening width in cols
      road: mkRoad(),
      river: mkRiver(),
      homes: [false,false,false,false,false],
      level: 1,
      lives: 5,
      // frog grid state (discrete logical cell + smoothed draw position)
      col: 4,          // logical column the frog occupies (int 0..8)
      fcol: 4,         // drawn column (float; rides platforms continuously)
      row: 0,          // logical row (int 0..12)
      frow: 0,         // drawn row (float)
      facing: 0,       // 0 up,1 right,2 down,3 left
      // per-hop state machine
      hopT: 0,         // seconds left in current hop (0 = settled on ground)
      hopDur: 0.14,    // fixed hop duration (prediction == physics)
      fromCol: 4,      // logical col at hop start
      fromRow: 0,      // logical row at hop start
      carryV: 0,       // momentum carry (cells/sec) of the raft being left this hop
      rideV: 0,        // velocity of the raft currently carrying the frog (0 on land)
      // fx gates
      dead: 0,
      deadKind: 0,
      win: 0,
      hitX: 4, hitY: 0,
      hopGate: 0,     // input/AI gate between hops
      idleTimer: 0,
      flash: 0,
      kickPulse: 0,
      t: 0
    };
  }

  function update(ctx){
    ctx = ctx || {};
    var dt = ctx.dt;
    var U = ctx.U || 8;
    var A = ctx.A || {x:0,y:0,w:0,h:0};
    var IN = ctx.IN || {};
    var SND = ctx.SND || {};
    var st = ctx.state || ctx.st;
    if(!st) return;
    if(!(dt>0) || dt>0.2) dt = 0.016;
    if(!IN) IN = {};
    if(!IN.keys) IN.keys = {};
    var keys = IN.keys;
    var safeNote=function(){}, safeFx=function(){}, EVENT=function(){};
    if(SND){
      if(typeof SND.note==='function') safeNote=function(d,du,v){ SND.note(d,du,v); };
      if(typeof SND.fx==='function')   safeFx=function(n,s){ SND.fx(n,s); };
      if(typeof SND.event==='function') EVENT=function(c,i,o){ try{ SND.event(c,i,o); }catch(e){} };
    }

    st.t += dt;
    if(st.kickPulse>0) st.kickPulse = Math.max(0, st.kickPulse - dt*4);
    if(st.flash>0)     st.flash     = Math.max(0, st.flash - dt*3);
    if(st.hopGate>0)  st.hopGate  = Math.max(0, st.hopGate - dt);

    // ---- MUSIC-VIDEO clock: shared runtime snapshots the bus once per frame. ----
    var audio = ctx.audio || {};
    var raw = audio.raw || {};
    var cl = raw.cl || {};
    var dropEdge = audio.drop == null ? MV.isDrop(cl) : !!audio.drop;
    var bHue = audio.hue == null ? MV.barHue(cl) : audio.hue;
    var bPulse = MV.pulse(cl, dropEdge ? 0.055 : 0.03);
    var objPulse = MV.pulse(cl, dropEdge ? 0.24 : 0.15);
    var nrg = audio.energy == null ? MV.energy(cl) : audio.energy;
    // phrase variation: pick a stable lane/water "pattern family" per phrase
    if(st.mvPhrase === undefined) st.mvPhrase = -1;
    var phr = (cl && cl.phrase!=null) ? cl.phrase : 0;
    if(phr !== st.mvPhrase){
      st.mvPhrase = phr;
      // 4 phrase-stable pattern families (offsets layered onto procedural water/road sheen)
      st.mvWaterShift = MV.pidx(cl, 4);              // shifts the river sparkle pattern
      st.mvDashSkew   = MV.pick(cl, [0.9,0.75,1.05,0.6]) || 0.9;  // road dash spacing family
      st.mvHedgeFam   = MV.pidx(cl, 3);              // hedge tint family
    }

    var night = st.night;
    var viewX = A.x, viewY = A.y, viewW = A.w, viewH = A.h;
    var X = viewX, Y = viewY, W = viewW, H = viewH;
    var cols = st.cols, rows = st.rows;
    var slotCols = st.slotCols, bayW = st.bayW;
    var cell = Math.max(1, Math.min(W / cols, H / rows));
    W = cell * cols;
    H = cell * rows;
    X = viewX + (viewW - W) * 0.5;
    Y = viewY + (viewH - H) * 0.5;
    var cw = cell;
    var ch = cell;
    var spriteU = Math.max(1, Math.floor(cell / 10));
    function rowTopY(r){ return Y + H - (r+1)*ch; }
    function colX(c){ return X + c*cw; }

    // BAR = PALETTE: the base bands rotate hue smoothly over bars (subtle on dark tones).
    var grassCol = hueRot(night ? '#0a3a14' : '#187818', bHue);
    var roadCol  = night ? '#0c0c12' : '#181818';
    var riverCol = night ? '#081858' : '#0028b0';   // WATER is ONLY shades of blue — no bar hue-rotation (it used to drift to purple/teal)
    var riverLite= night ? '#1030a0' : '#3050d8';
    var riverGlow= night ? '#2848c8' : '#5878f8';   // brighter blue, flashed on strong beats so the water still reacts to the music
    var bgCol    = night ? '#02040f' : '#000000';

    // world speed-up per level. velocity helpers all use this same factor so the
    // AI's predictions and the physics agree exactly.
    var spdScale = 1 + (st.level-1)*0.08;   // gentle per-level speed-up (caps difficulty)
    function laneVel(sp, dir){ return sp * dir * spdScale * 1.6; }   // cells/sec

    // ---- advance traffic & river objects ----
    for(var i=0;i<st.road.length;i++){
      var ln = st.road[i];
      var v = laneVel(ln.sp, ln.dir);
      for(var c2=0;c2<ln.cars.length;c2++){
        var car = ln.cars[c2];
        car.pos += v*dt;
        var span = cols + ln.len + 3;
        while(car.pos > cols + ln.len + 1) car.pos -= span;
        while(car.pos < -ln.len - 2)       car.pos += span;
      }
    }
    for(var j=0;j<st.river.length;j++){
      var rw = st.river[j];
      var rv = laneVel(rw.sp, rw.dir);
      for(var o=0;o<rw.items.length;o++){
        var it = rw.items[o];
        it.pos += rv*dt;
        var span2 = cols + rw.len + 4;
        while(it.pos > cols + rw.len + 2) it.pos -= span2;
        while(it.pos < -rw.len - 2)       it.pos += span2;
        if(rw.kind==='turtle'){
          var sval = rw.dive ? Math.sin(st.t*1.3 + it.phase) : 1;
          it.sub = (sval <= -0.5);    // briefly submerged -> not a platform
          it._sval = sval;
        } else { it.sub=false; it._sval=1; }
      }
    }

    // ---- collision / support queries on the logical grid ----
    // frog footprint is [c+0.15, c+0.85]; objects span [pos, pos+len].
    function carHit(row, c){
      for(var a=0;a<st.road.length;a++){
        var L = st.road[a];
        if(L.row!==row) continue;
        for(var b=0;b<L.cars.length;b++){
          var cp = L.cars[b].pos;
          if(c+0.78 > cp+0.10 && c+0.22 < cp + L.len - 0.10) return true;
        }
      }
      return false;
    }
    // ride velocity (cells/sec) if a platform is under the given float CENTER,
    // else null. The frog's true center is fcol+0.5, so support is judged on the
    // FLOAT position (not the rounded cell) -> ride physics never falsely drowns.
    function platVelC(row, center){
      for(var a=0;a<st.river.length;a++){
        var R = st.river[a];
        if(R.row!==row) continue;
        for(var b=0;b<R.items.length;b++){
          var it = R.items[b];
          if(R.kind==='turtle' && it.sub) continue;
          var op = it.pos;
          if(center >= op+0.02 && center <= op + R.len - 0.02) return laneVel(R.sp, R.dir);
        }
      }
      return null;
    }

    var hoppingPre = st.hopT > 0;   // were we mid-hop coming into this frame?

    // =====================================================================
    //  BEHAVIOR : one discrete hop per trigger (only when settled)
    // =====================================================================
    var busy  = (st.dead>0 || st.win>0);
      FroggerBehavior.update({
        dt: dt,
        st: st,
        IN: IN,
        keys: keys,
        busy: busy,
        canHop: st.hopGate<=0,
        hoppingPre: hoppingPre,
        cols: cols,
        slotCols: slotCols,
      bayW: bayW,
      frogScreenX: colX(st.fcol)+cw*0.5,
      frogScreenY: rowTopY(st.row)+ch*0.5,
      laneVel: laneVel,
      applyHop: applyHop
    });

    // recompute AFTER input: applyHop may have started a new hop / changed row
    var hopping = st.hopT > 0;
    var onRiver = (st.row>=7 && st.row<=11);
    var onRoad  = (st.row>=1 && st.row<=5);

    // =====================================================================
    //  HOP / RIDE PHYSICS  (deterministic so AI predictions match)
    // =====================================================================
    if(hopping){
      st.hopT -= dt;
      var prog = 1 - Math.max(0, st.hopT)/st.hopDur;   // 0..1 across the hop
      if(prog>1) prog = 1;
      // logical cell interpolates to target; THEN add the constant departure
      // carry. The carry velocity is fixed at hop start (st.carryV), so the exact
      // landing center is col+0.5 + carryV*hopDur -> riverLanding() reproduces it.
      st.frow = st.fromRow + (st.row - st.fromRow)*prog;
      var baseInterp = st.fromCol + (st.col - st.fromCol)*prog;
      st.fcol = baseInterp + st.carryV * (st.hopDur - Math.max(0, st.hopT));
      if(st.hopT<=0){ st.hopT = 0; st.fcol = st.col + st.carryV*st.hopDur; landHop(); }
    } else if(!busy){
      // settled: snap row, ride the platform under us (river only)
      st.frow = st.row;
      if(onRiver){
        var ride = platVelC(st.row, st.fcol+0.5);     // support judged on FLOAT center
        if(ride!==null){
          st.rideV = ride;                            // remember it for the next hop
          st.fcol += ride*dt;
          st.col = Math.max(0, Math.min(cols-1, Math.round(st.fcol)));  // track for next hop's base
          // drifted off the visible board while riding -> drown
          if(st.fcol < -0.35 || st.fcol > cols-0.65) die(1);
        } else {
          // raft slid out / turtles dove -> drown
          st.rideV = 0;
          die(1);
        }
      } else {
        st.rideV = 0;
        // on land/road: drawn col eases to logical col
        var dc = st.col - st.fcol;
        st.fcol += dc * Math.min(1, dt*16);
        if(Math.abs(dc)<0.02) st.fcol = st.col;
        // a car can roll over a stationary frog on the road
        if(onRoad && carHit(st.row, st.col)) die(0);
      }
    } else {
      st.frow = st.row;   // busy (dead/win): freeze
    }
    st.fcol = Math.max(-0.6, Math.min(cols-0.4, st.fcol));

    // death / win gates
    if(st.win>0){
      st.win = Math.max(0, st.win - dt*1.6);
      if(st.win<=0) respawn();
    } else if(st.dead>0){
      st.dead = Math.max(0, st.dead - dt*2.2);
      if(st.dead<=0) respawn();
    }

    ctx.froggerView = {
      viewX: viewX, viewY: viewY, viewW: viewW, viewH: viewH,
      X: X, Y: Y, W: W, H: H,
      cw: cw, ch: ch, spriteU: spriteU,
      cols: cols, rows: rows, slotCols: slotCols, bayW: bayW,
      cl: cl, bHue: bHue, bPulse: bPulse, objPulse: objPulse, nrg: nrg,
      night: night,
      grassCol: grassCol, roadCol: roadCol, riverCol: riverCol,
      riverLite: riverLite, riverGlow: riverGlow, bgCol: bgCol,
      hopping: hopping,
      drop: dropEdge
    };

    // =====================================================================
    //  CORE ACTIONS
    // =====================================================================
    function applyHop(dir){
      st.facing = dir;
      // base on the frog's actual drifted cell (matters while riding a log)
      var baseC = Math.max(0, Math.min(cols-1, Math.round(st.fcol)));
      var nc = baseC, nr = st.row;
      if(dir===0)      nr = Math.min(12, st.row+1);
      else if(dir===2) nr = Math.max(0,  st.row-1);
      else if(dir===1) nc = Math.min(cols-1, baseC+1);
      else if(dir===3) nc = Math.max(0,       baseC-1);
      // sideways hop into a wall = no-op (counts as a wait)
      if(nc===baseC && nr===st.row){ return; }
      // momentum carry = velocity of the raft we are LEAVING (0 on land/median).
      // Use the cached rideV (the raft that actually carried us last frame) so the
      // AI's prediction and the physics sample the IDENTICAL value -> no boundary
      // ambiguity at raft edges. Fixed for the whole hop => deterministic landing.
      st.carryV = (st.row>=7 && st.row<=11) ? st.rideV : 0;
      st.fromCol = baseC; st.fromRow = st.row;
      st.col = nc; st.row = nr;
      st.fcol = baseC;            // start the arc from the true current cell
      st.hopT = st.hopDur;
      st.hopGate = 0.05;
      st.idleTimer = 0;
      // SIGNATURE hop sound: short rising blip; pitch climbs as you advance
      var deg = Math.max(0, Math.min(13, nr+2));
      safeFx('hop', Math.round((nr/12)*7));
      safeNote(deg, 0.10, 0.22);
      EVENT('minor', Math.round((nr/12)*7));   // each hop = a small, frequent step
      // EVENT JUICE: tiny hop bump on the green progress bar, scaled by section energy
      st.kickPulse = 0.4 + nrg*0.4;
    }

    // called once, the instant a hop settles
    function landHop(){
      st.hopGate = 0.07;          // brief pacing gate
      st.frow = st.row;
      // on land/road, snap the float to the landed cell; on the river KEEP the
      // carried float so support is judged where the frog actually is.
      if(!(st.row>=7 && st.row<=11)) st.fcol = st.col;
      st.col = Math.max(0, Math.min(cols-1, Math.round(st.fcol)));
      if(busy) return;
      if(st.row>=12){
        dockHome();
      } else if(st.row>=1 && st.row<=5){
        if(carHit(st.row, st.col)) die(0);
      } else if(st.row>=7 && st.row<=11){
        var sup = platVelC(st.row, st.fcol+0.5);   // judge support on the FLOAT center
        if(sup===null || st.fcol < -0.35 || st.fcol > cols-0.65){ die(1); }
        else { safeFx('tick', 0); safeNote(9, 0.05, 0.12); EVENT('minor', 2); }  // soft land-on-log tick
      }
      // row 0 (start) and row 6 (median) are always safe ground
    }

    function dockHome(){
      var center = st.fcol+0.5;
      var bestB=-1, bestD=99;
      for(var hb2=0;hb2<5;hb2++){
        if(st.homes[hb2]) continue;
        var bc = slotCols[hb2] + bayW*0.5;     // bay opening center
        var dd = Math.abs(bc - center);
        if(dd<bestD){ bestD=dd; bestB=hb2; }
      }
      if(bestB>=0 && bestD < (bayW*0.5 + 0.25)){
        st.homes[bestB]=true;
        st.col = Math.round(slotCols[bestB] + bayW*0.5 - 0.5);
        st.fcol = st.col;
        st.win = 1; st.flash = 0.8 + nrg*0.4;   // EVENT: reaching a bay flashes harder on hot sections
        // HOME jingle: rising arpeggio on the lead
        safeFx('home', 0);
        safeNote(7, 0.12, 0.24); safeNote(11, 0.12, 0.24); safeNote(14, 0.16, 0.26);
        EVENT('major', 8);                       // reached a home bay = big payoff
        var allF = st.homes[0]&&st.homes[1]&&st.homes[2]&&st.homes[3]&&st.homes[4];
        if(allF){ st.level++; st.flash = 1; if(typeof shake!=='undefined') shake = Math.min(1, shake + 0.4*(0.5+nrg)); EVENT('major', 10); }   // all bays filled = level complete
      } else {
        die(0);                 // smacked the hedge between bays
        st.hitY = 12;
      }
    }

    function die(kind){
      if(st.dead>0||st.win>0) return;
      st.dead = 1; st.deadKind = kind;
      st.hitX = Math.max(0, Math.min(cols-1, Math.round(st.fcol)));
      st.hitY = st.row;
      st.hopT = 0;
      st.lives = Math.max(0, st.lives-1);
      if(kind===1){ safeFx('splash',0); }   // fell in water
      else        { safeFx('splat',0);  }   // hit by a car / hedge
      safeNote(5, 0.10, 0.20); safeNote(2, 0.16, 0.20);  // descending splat tail
      EVENT('major', 9);                     // death (drown/squash) = big moment
      st.flash = 0.6 + nrg*0.3;              // EVENT: bigger flash on hot sections
      if(typeof shake!=='undefined') shake = Math.min(1, shake + 0.35*(0.5+nrg));   // micro screen-shake on the hit
    }

    function respawn(){
      st.col=4; st.fcol=4; st.row=0; st.frow=0; st.facing=0;
      st.fromCol=4; st.fromRow=0;
      st.hopT=0; st.dead=0; st.win=0; st.hopGate=0.18; st.idleTimer=0;
      if(st.lives<=0){
        st.lives = 5; st.homes=[false,false,false,false,false]; st.level=1;  // game over -> fresh board
      }
      var allF = st.homes[0]&&st.homes[1]&&st.homes[2]&&st.homes[3]&&st.homes[4];
      if(allF) st.homes=[false,false,false,false,false];   // level cleared -> new sheet of bays
    }

  }

  return {
    make: make,
    update: update
  };
})();

(function(){
  VisualizerGame.layer('frogger', 'definition', {
    packVersion: 3,
    key: "frogger",
    name: "FROGGER",
    family: "lane crossing",
    description: "Lane-crossing toy with roads, river logs, cars, turtles, and homes.",
    source: "split-pack-definition-rules",
    make: FroggerDefinition.make,
    update: FroggerDefinition.update,
    entities: [
      "frog",
      "car",
      "truck",
      "log",
      "turtle",
      "river",
      "road",
      "home",
      "splash",
      "scoreText"
    ],
    rules: [
      "grid hops",
      "vehicle collision",
      "river ride",
      "turtle sink timing",
      "home capture",
      "lane reset",
      "safe-zone progression"
    ],
    events: [
      "hop",
      "vehicleNear",
      "riverRide",
      "turtleSank",
      "homeReached",
      "splash",
      "roundAdvanced"
    ],
    simulation: {
      timestep: "shared runtime delta with local large-frame clamp",
      collision: "owned by FroggerDefinition.update",
      musicKnowledge: "normalized ctx.audio only; no raw bus reads"
    },
    watchdog: { mode:"single-objective", progress:70, motion:14, loop:16 }
  });
})();
