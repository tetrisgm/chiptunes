// CROSSING autonomous behavior. Owns input/autoplay intent only; no rendering and no raw audio reads.
const CrossingBehavior = (function(){
  function update(ctx){
    var dt = ctx.dt || 0.016;
    var st = ctx.st;
    if(!st) return;

    var IN = ctx.IN || {};
    var keys = ctx.keys || IN.keys || {};
    var busy = !!ctx.busy;
    var hoppingPre = !!ctx.hoppingPre;
    var cols = ctx.cols || st.cols || 9;
    var roadEnd=ctx.roadEnd==null?(st.roadEnd||5):ctx.roadEnd;
    var medianRow=ctx.medianRow==null?(st.medianRow||6):ctx.medianRow;
    var riverStart=ctx.riverStart==null?(st.riverStart||7):ctx.riverStart;
    var riverEnd=ctx.riverEnd==null?(st.riverEnd||11):ctx.riverEnd;
    var applyHop = ctx.applyHop || function(){};
    var wantHop = false;
    var hopDir = 0;

    // DIRECTIONAL-ONLY controls: arrows/WASD hop ONE cell per press (rising
    // edge, classic Crossing — holding a key does not machine-gun hops). The
    // latch is only sampled while settled+active, which gives free input
    // buffering: a press during a hop triggers exactly one hop on landing.
    if(!st.keyLatch) st.keyLatch = {up:false, down:false, left:false, right:false};

    if(!busy && !hoppingPre && ctx.canHop){
      st.idleTimer += dt;
      if(IN.active){
        var latch = st.keyLatch;
        var kU = !!keys.up, kD = !!keys.down, kL = !!keys.left, kR = !!keys.right;
        if(kU && !latch.up){ wantHop=true; hopDir=0; }
        else if(kD && !latch.down){ wantHop=true; hopDir=2; }
        else if(kL && !latch.left){ wantHop=true; hopDir=3; }
        else if(kR && !latch.right){ wantHop=true; hopDir=1; }
        latch.up=kU; latch.down=kD; latch.left=kL; latch.right=kR;
        // pointer tap = OPTIONAL bonus hop toward the pointer (never required;
        // keyboard play is complete with directions alone)
        if(!wantHop && IN.click){
          wantHop=true;
          var px = (typeof IN.lx==='number') ? IN.lx : ctx.frogScreenX;
          var py = (typeof IN.ly==='number') ? IN.ly : ctx.frogScreenY;
          var fxp = ctx.frogScreenX;
          var fyp = ctx.frogScreenY;
          var ddx = px - fxp, ddy = py - fyp;
          if(Math.abs(ddx) > Math.abs(ddy)) hopDir = ddx>0 ? 1 : 3;
          else hopDir = ddy>0 ? 2 : 0;   // screen-y down == grid down
        }
      } else {
        var plan = aiPlan(ctx);
        if(plan.go){ wantHop=true; hopDir=plan.dir; }
      }
      if(wantHop) applyHop(hopDir);
    } else if(!busy && !hoppingPre){
      st.idleTimer += dt;
    }

    function aiPlan(planCtx){
      var noGo = {go:false, dir:0};
      var laneVel = planCtx.laneVel || function(sp, dir){ return sp * dir; };
      var slotCols = planCtx.slotCols || st.slotCols || [0.5,2.0,3.7,5.4,7.2];
      var bayW = planCtx.bayW || st.bayW || 1.3;
      var here = st.row;
      var fc = st.fcol;
      var rc = Math.max(0, Math.min(cols-1, Math.round(fc)));

      if(here>=riverStart && here<=riverEnd){
        if(here<riverEnd){
          var rOk = (rc+1<cols) && riverLanding(here, rc+1);
          var lOk = (rc-1>=0) && riverLanding(here, rc-1);
          var rv = st.rideV;
          var tgt = targetBayCol();
          var wantR = (tgt+0.5) > (fc+0.5+0.4);
          var wantL = (tgt+0.5) < (fc+0.5-0.4);
          if(riverLanding(here+1, rc) && !((wantR&&rOk)||(wantL&&lOk))) return {go:true, dir:0};
          if(riverLanding(here+1, rc)){
            if(wantR && rOk) return {go:true, dir:1};
            if(wantL && lOk) return {go:true, dir:3};
            return {go:true, dir:0};
          }
          if(rv>0 && fc > (cols-1)/2 && lOk && !wantR) return {go:true, dir:3};
          if(rv<0 && fc < (cols-1)/2 && rOk && !wantL) return {go:true, dir:1};
          if(fc > cols-2.0 && lOk) return {go:true, dir:3};
          if(fc < 1.0 && rOk) return {go:true, dir:1};
          if(wantR && rOk) return {go:true, dir:1};
          if(wantL && lOk) return {go:true, dir:3};
          var toCenRv = rc < (cols-1)/2;
          if(toCenRv){ if(rOk) return {go:true, dir:1}; if(lOk) return {go:true, dir:3}; }
          else { if(lOk) return {go:true, dir:3}; if(rOk) return {go:true, dir:1}; }
          return noGo;
        }

        var tb = nearestEmptyBay(fc);
        if(tb>=0){
          var bc = slotCols[tb] + bayW*0.5;
          if(Math.abs((fc+0.5)-bc) < bayW*0.5 - 0.05) return {go:true, dir:0};
          var topWantR = bc > (fc+0.5);
          var rOk2 = (rc+1<cols) && riverLanding(here, rc+1);
          var lOk2 = (rc-1>=0) && riverLanding(here, rc-1);
          if(topWantR && rOk2) return {go:true, dir:1};
          if(!topWantR && lOk2) return {go:true, dir:3};
          var topRv = st.rideV;
          if(topRv!==0){
            var distE = topRv>0 ? (cols-0.7 - fc) : (fc + 0.1);
            if(distE/Math.abs(topRv) < 0.5 && Math.abs((fc+0.5)-bc) < bayW) return {go:true, dir:0};
          }
          return noGo;
        }
        return noGo;
      }

      if(here===medianRow){
        var tgtM = targetBayCol();
        if(riverLanding(riverStart, rc)) return {go:true, dir:0};
        if(tgtM > rc && rc+1<cols) return {go:true, dir:1};
        if(tgtM < rc && rc-1>=0) return {go:true, dir:3};
        if(rc+1<cols && riverLanding(riverStart, rc+1)) return {go:true, dir:1};
        if(rc-1>=0 && riverLanding(riverStart, rc-1)) return {go:true, dir:3};
        return noGo;
      }

      if(here>=0 && here<=roadEnd){
        var nr = here+1;
        var curDanger = (here>=1 && here<=roadEnd) && !safeRoadCell(here, rc, 0);
        if(nr<=roadEnd){
          var fwdOk = safeRoadCell(nr, rc, 1);
          var sideR = (rc+1<cols) && safeRoadCell(here, rc+1, 0);
          var sideL = (rc-1>=0) && safeRoadCell(here, rc-1, 0);
          if(curDanger){
            if(fwdOk) return {go:true, dir:0};
            var toCenR = rc < (cols-1)/2;
            if(toCenR){ if(sideR) return {go:true, dir:1}; if(sideL) return {go:true, dir:3}; }
            else { if(sideL) return {go:true, dir:3}; if(sideR) return {go:true, dir:1}; }
            return {go:true, dir:0};
          }
          if(fwdOk) return {go:true, dir:0};
          var tgtR = targetBayCol();
          if(tgtR > rc+0.5 && sideR) return {go:true, dir:1};
          if(tgtR < rc-0.5 && sideL) return {go:true, dir:3};
          return noGo;
        }
        return {go:true, dir:0};
      }
      return noGo;

      function safeRoadCell(row, col, lookAhead){
        if(col<0||col>cols-1) return false;
        var horizon = 0.30 + 0.18*lookAhead;
        for(var a=0;a<st.road.length;a++){
          var L = st.road[a];
          if(L.row!==row) continue;
          var v = laneVel(L.sp, L.dir);
          for(var b=0;b<L.cars.length;b++){
            var cp = L.cars[b].pos;
            for(var s=0;s<=4;s++){
              var tt = horizon*(s/4);
              var fp = cp + v*tt;
              if(col+0.78 > fp+0.10 && col+0.22 < fp + L.len - 0.10) return false;
            }
          }
        }
        return true;
      }

      function riverLanding(row, col){
        if(col<0||col>cols-1) return false;
        var land = st.hopDur;
        var carryV = (st.row>=riverStart && st.row<=riverEnd) ? st.rideV : 0;
        var landCenter = col+0.5 + carryV*land;
        if(landCenter < 0.2 || landCenter > cols-0.2) return false;
        for(var a=0;a<st.river.length;a++){
          var R = st.river[a];
          if(R.row!==row) continue;
          var pv = laneVel(R.sp, R.dir);
          var m = Math.min(0.42, R.len*0.30);
          for(var b=0;b<R.items.length;b++){
            var it = R.items[b];
            if(R.kind==='turtle' && it.sub) continue;
            if(R.kind==='turtle' && R.dive){
              var sNow = it._sval, sSoon = Math.sin(st.t*1.3 + it.phase + 1.3*1.5);
              if(sNow < 0.3 || sSoon < -0.1) continue;
            }
            var p = it.pos + pv*land;
            if(landCenter >= p+m && landCenter <= p + R.len - m) return true;
          }
        }
        return false;
      }

      function nearestEmptyBay(fc2){
        var best=-1, bd=99;
        var center=fc2+0.5, mid=(cols-1)/2;
        for(var h=0;h<5;h++){
          if(st.homes[h]) continue;
          var bc2=slotCols[h]+bayW*0.5;
          var d=Math.abs(bc2-center)+Math.abs(bc2-mid)*0.35;
          if(d<bd){ bd=d; best=h; }
        }
        return best;
      }

      function targetBayCol(){
        var b = nearestEmptyBay(st.fcol);
        if(b<0) return Math.max(0, Math.min(cols-1, Math.round(st.fcol)));
        return Math.max(0, Math.min(cols-1, Math.round(slotCols[b] + bayW*0.5 - 0.5)));
      }
    }
  }

  return {
    update: update
  };
})();

(function(){
  VisualizerGame.layer('crossing', 'behavior', {
    packVersion: 2,
    key: "crossing",
    goals: [
      "advance one safe lane at a time",
      "wait for safe vehicle gaps",
      "ride logs across river",
      "target open homes",
      "backtrack only to avoid danger"
    ],
    perception: [
      "lane occupancy",
      "gap timing",
      "moving platforms",
      "home openings",
      "nearest hazard"
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
    ownedBy: "CrossingBehavior.update",
    update: CrossingBehavior.update
  });
})();
