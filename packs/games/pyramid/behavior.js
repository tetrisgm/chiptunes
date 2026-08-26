// Pyramid autonomous behavior. AI intent only; no rendering and no raw audio reads.
const PyramidBehavior = (function(){
  function inBounds(st, r, c){
    return !!st && r >= 0 && r < st.ROWS && !!st.cubes[r] && c >= 0 && c < st.cubes[r].length;
  }

  function legalTargets(r, c){
    return [
      { r:r + 1, c:c,     d:'dl' },
      { r:r + 1, c:c + 1, d:'dr' },
      { r:r - 1, c:c - 1, d:'ul' },
      { r:r - 1, c:c,     d:'ur' }
    ];
  }

  function allDone(st){
    for(var rr=0; rr<st.ROWS; rr++){
      for(var cc=0; cc<st.cubes[rr].length; cc++){
        if(st.cubes[rr][cc] < st.target) return false;
      }
    }
    return true;
  }

  function countDone(st){
    var n = 0;
    for(var rr=0; rr<st.ROWS; rr++){
      for(var cc=0; cc<st.cubes[rr].length; cc++){
        if(st.cubes[rr][cc] >= st.target) n++;
      }
    }
    return n;
  }

  function distanceToWork(st, sr, sc){
    if(!inBounds(st, sr, sc)) return 99;
    if(st.cubes[sr][sc] < st.target) return 0;
    var seen = {};
    var q = [[sr, sc, 0]];
    var qi = 0;
    seen[sr + ',' + sc] = 1;
    while(qi < q.length){
      var cur = q[qi++];
      var r = cur[0], c = cur[1], dist = cur[2];
      var nbr = legalTargets(r, c);
      for(var i=0; i<nbr.length; i++){
        var o = nbr[i];
        if(!inBounds(st, o.r, o.c)) continue;
        var key = o.r + ',' + o.c;
        if(seen[key]) continue;
        if(st.cubes[o.r][o.c] < st.target) return dist + 1;
        seen[key] = 1;
        q.push([o.r, o.c, dist + 1]);
      }
    }
    return 50;
  }

  function coilyDistance(st, r, c){
    var co = st.coily;
    if(!co || !co.active || co.egg) return 99;
    return Math.abs(co.r - r) + Math.abs(co.c - c);
  }

  function ballDanger(st, r, c){
    var dng = 0;
    for(var bi=0; bi<st.balls.length; bi++){
      var bl = st.balls[bi];
      if(bl.c === c && bl.r === r) dng += 90;
      else if(bl.r === r - 1 && (bl.c === c || bl.c === c - 1)) dng += 34;
      else if(bl.r === r && Math.abs(bl.c - c) <= 1) dng += 16;
    }
    return dng;
  }

  function threatAt(st, r, c){
    var dng = ballDanger(st, r, c);
    var cd = coilyDistance(st, r, c);
    if(cd <= 0) dng += 140;
    else if(cd === 1) dng += 80;
    else if(cd === 2) dng += 26;
    return dng;
  }

  function coilyNextDistanceTo(st, r, c){
    var co = st.coily;
    if(!co || !co.active || co.egg) return 99;
    var nr = co.r, nc = co.c;
    if(co.r < r){
      nr = co.r + 1;
      nc = co.c + (c > co.c ? 1 : 0);
    } else if(co.r > r){
      nr = co.r - 1;
      nc = co.c - (c < co.c ? 1 : 0);
    } else if(c > co.c){
      nr = co.r + 1;
      nc = co.c + 1;
    } else if(c < co.c){
      nr = co.r + 1;
      nc = co.c;
    } else {
      nr = co.r - 1;
      nc = co.c;
    }
    if(nr < 0) nr = 0;
    if(nr >= st.ROWS) nr = st.ROWS - 1;
    if(nc < 0) nc = 0;
    if(nc >= st.cubes[nr].length) nc = st.cubes[nr].length - 1;
    return Math.abs(nr - r) + Math.abs(nc - c);
  }

  function discReachable(st, o){
    for(var i=0; i<st.discs.length; i++){
      var dd = st.discs[i];
      if(dd.used) continue;
      if(dd.side < 0 && o.c < 0 && o.r >= 1 && o.r <= 4) return i + 1;
      if(dd.side > 0 && o.r >= 0 && st.cubes[o.r] && o.c >= st.cubes[o.r].length && o.r >= 1 && o.r <= 4) return i + 1;
    }
    return 0;
  }

  function chooseMove(st){
    var opts = legalTargets(st.qr, st.qc);
    var bestDir = null;
    var bestScore = -1e9;
    var cdNow = coilyDistance(st, st.qr, st.qc);
    var coilyOn = st.coily.active && !st.coily.egg;
    var nearCoily = coilyOn && cdNow <= 4;
    var hereWork = distanceToWork(st, st.qr, st.qc);
    for(var i=0; i<opts.length; i++){
      var o = opts[i];
      var score;
      if(!inBounds(st, o.r, o.c)){
        var discIndex = discReachable(st, o);
        if(discIndex > 0 && coilyOn && cdNow <= 3) score = 600 + Math.random();
        else continue;
      } else {
        var lvl = st.cubes[o.r][o.c];
        score = lvl < st.target ? 80 : 1;
        var wAfter = distanceToWork(st, o.r, o.c);
        score += (hereWork - wAfter) * 24;
        score -= wAfter * 6;
        score -= threatAt(st, o.r, o.c) * 1.6;
        if(nearCoily){
          score += coilyDistance(st, o.r, o.c) * 16;
          var after = coilyNextDistanceTo(st, o.r, o.c);
          if(after <= 0) score -= 320;
          else if(after === 1) score -= 90;
          else score += after * 7;
          if(o.r < st.coily.r) score -= 34;
          for(var d2=0; d2<st.discs.length; d2++){
            var dd2 = st.discs[d2];
            if(dd2.used) continue;
            if(dd2.side < 0 && o.c <= 1 && o.r >= 2 && o.r <= 4) score += 20;
            if(dd2.side > 0 && o.c >= o.r - 1 && o.r >= 2 && o.r <= 4) score += 20;
          }
        } else if(coilyOn){
          for(var d3=0; d3<st.discs.length; d3++){
            var dd3 = st.discs[d3];
            if(dd3.used) continue;
            if(dd3.side < 0 && o.c <= 1) score += 2;
            if(dd3.side > 0 && o.c >= o.r - 1) score += 2;
          }
        }
        score += Math.random() * 2;
      }
      if(score > bestScore){
        bestScore = score;
        bestDir = o.d;
      }
    }
    return bestDir;
  }

  return {
    inBounds: inBounds,
    legalTargets: legalTargets,
    allDone: allDone,
    countDone: countDone,
    distanceToWork: distanceToWork,
    coilyDistance: coilyDistance,
    ballDanger: ballDanger,
    threatAt: threatAt,
    coilyNextDistanceTo: coilyNextDistanceTo,
    discReachable: discReachable,
    chooseMove: chooseMove
  };
})();

(function(){
  VisualizerGame.layer('pyramid', 'behavior', {
    packVersion: 2,
    key: "pyramid",
    goals: [
      "flip unvisited cubes",
      "avoid enemy diagonals",
      "use discs only when trapped",
      "prefer flowing zig-zag routes",
      "recover from edges"
    ],
    perception: [
      "cube color states",
      "enemy vectors",
      "safe diagonals",
      "disc positions",
      "edge risk"
    ],
    policies: [
      "prefer readable classic-game motion over random visualizer motion",
      "cap decisions per frame and avoid per-frame pathfinding unless the scene changed",
      "allow small imperfections so the toy feels alive without sabotaging the run",
      "when paused, stop progression and keep only restrained idle animation"
    ],
    musicInputsAllowed: [
      "energy",
      "dangerBoost",
      "aggression",
      "chaos",
      "speedBias"
    ],
    ownedBy: "PyramidBehavior",
    update: function(ctx){
      if(!ctx || !ctx.state || !ctx.state.coily) return null;
      ctx.state.$vizIntent = PyramidBehavior.chooseMove(ctx.state);
      return ctx.state.$vizIntent;
    },
    helpers: {
      legalTargets: PyramidBehavior.legalTargets,
      allDone: PyramidBehavior.allDone,
      countDone: PyramidBehavior.countDone,
      threatAt: PyramidBehavior.threatAt,
      discReachable: PyramidBehavior.discReachable
    }
  });
})();
