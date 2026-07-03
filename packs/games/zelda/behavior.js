// ZELDA autonomous behavior contract. AI intent only; no rendering and no raw audio reads.
var ZeldaBehavior = (function(){
  function decideAuto(ctx){
    var st = ctx.st, link = ctx.link, grid = ctx.grid;
    var GW = ctx.GW, GH = ctx.GH, COLS = ctx.COLS, ROWS = ctx.ROWS;
    var cw = ctx.cw, ch = ctx.ch, dt = ctx.dt;
    var clk = ctx.clk || { spb: 0.45 };
    var dvec = ctx.dvec;
    var passable = ctx.passable;
    var faceTowardCell = ctx.faceTowardCell;
    var isOneTileAway = ctx.isOneTileAway;
    var attackCellForTarget = ctx.attackCellForTarget;
    var isCurrentRoomLocked = ctx.isCurrentRoomLocked;
    var currentRoomKey = ctx.currentRoomKey;
    var roomDegree = ctx.roomDegree;
    var bfsStep = ctx.bfsStep;
    var holdMoveDir = ctx.holdMoveDir;

    var moveDir = null, wantAtk = false, wantBomb = false;
    st.aiTimer -= dt;
    if(link.moveHold && link.swing <= 0) moveDir = link.moveHold;

    var best = 1e9, target = null, anyAlive = false, oi;
    for(oi = 0; oi < st.enemies.length; oi++){
      var o = st.enemies[oi];
      if(!o.alive) continue;
      anyAlive = true;
      var d0 = Math.abs(o.c - link.c) + Math.abs(o.r - link.r);
      if(d0 < best){ best = d0; target = o; }
    }

    var roomLockedActive = isCurrentRoomLocked();
    var exitGoal = null, exitBest = 1e9, exitOff = null;
    function exitInfo(dir){
      if(dir === 'left' && st.roomX > 0){
        var rL = st.world.horiz[(st.roomX - 1) + '_' + st.roomY];
        if(rL != null) return { gc: 0, gr: rL, gx: st.roomX - 1, gy: st.roomY, offDir: 'left' };
      }
      if(dir === 'right' && st.roomX < GW - 1){
        var rR = st.world.horiz[st.roomX + '_' + st.roomY];
        if(rR != null) return { gc: COLS - 1, gr: rR, gx: st.roomX + 1, gy: st.roomY, offDir: 'right' };
      }
      if(dir === 'up' && st.roomY > 0){
        var cU = st.world.vert[st.roomX + '_' + (st.roomY - 1)];
        if(cU != null) return { gc: cU, gr: 0, gx: st.roomX, gy: st.roomY - 1, offDir: 'up' };
      }
      if(dir === 'down' && st.roomY < GH - 1){
        var cD = st.world.vert[st.roomX + '_' + st.roomY];
        if(cD != null) return { gc: cD, gr: ROWS - 1, gx: st.roomX, gy: st.roomY + 1, offDir: 'down' };
      }
      return null;
    }

    var dirs = ['up', 'right', 'down', 'left'], di;
    var exitEdge = null;
    var unvisitedExit = false, exitCandidates = [];
    if(!(roomLockedActive && anyAlive)){
      for(di = 0; di < dirs.length; di++){
        var ec0 = exitInfo(dirs[di]);
        if(!ec0) continue;
        var key0 = ec0.gx + '_' + ec0.gy;
        if(!st.visited[key0]) unvisitedExit = true;
        exitCandidates.push(ec0);
      }
    }
    for(di = 0; di < exitCandidates.length; di++){
      var ec = exitCandidates[di];
      var key = ec.gx + '_' + ec.gy;
      var visits = (st.roomVisits && st.roomVisits[key]) || 0;
      var cost = (Math.abs(ec.gx - st.dunGX) + Math.abs(ec.gy - st.dunGY)) * 2;
      if(!st.visited[key]) cost -= 24;
      else cost += 10 + visits * 10;
      if(key === st.prevRoomKey && unvisitedExit) cost += 60;
      else if(key === st.prevRoomKey) cost += 16;
      if(st.visited[key] && roomDegree(ec.gx, ec.gy) <= 1) cost += 45;
      if(st.world.critical && st.world.critical[key]) cost -= 2;
      if(cost < exitBest){
        exitBest = cost;
        exitGoal = { c: ec.gc, r: ec.gr };
        exitOff = ec.offDir;
        exitEdge = { c: ec.gc, r: ec.gr };
      }
    }

    var exitInner = null;
    if(exitGoal){
      if(exitGoal.c <= 0) exitInner = { c: 1, r: exitGoal.r };
      else if(exitGoal.c >= COLS - 1) exitInner = { c: COLS - 2, r: exitGoal.r };
      else if(exitGoal.r <= 0) exitInner = { c: exitGoal.c, r: 1 };
      else if(exitGoal.r >= ROWS - 1) exitInner = { c: exitGoal.c, r: ROWS - 2 };
    }

    var goal = exitInner ? { c: exitInner.c, r: exitInner.r } : { c: Math.floor(COLS / 2), r: Math.floor(ROWS / 2) };
    var inDungeonRoom = (st.roomX === st.dunGX && st.roomY === st.dunGY);
    var itemGoal = null, ib = 1e9, pj0;
    for(pj0 = 0; pj0 < st.pickups.length; pj0++){
      var pp = st.pickups[pj0];
      var dpi = Math.abs(pp.c - link.c) + Math.abs(pp.r - link.r);
      if(dpi < ib){ ib = dpi; itemGoal = pp; }
    }

    var caveGoal = null, caveBest = 1e9, cr0, cc0;
    for(cr0 = 1; cr0 < ROWS - 1; cr0++){
      for(cc0 = 1; cc0 < COLS - 1; cc0++){
        if(grid[cr0][cc0] !== 4) continue;
        var cd0 = Math.abs(cc0 - link.c) + Math.abs(cr0 - link.r);
        if(cd0 < caveBest){ caveBest = cd0; caveGoal = { c: cc0, r: cr0 }; }
      }
    }

    var caveSeen = !!(st.caveVisits && st.caveVisits[currentRoomKey()]);
    var shouldGrabCloseItem = itemGoal && (ib <= 3 || (itemGoal.type === 'heart' && link.hp < link.maxhp && ib <= 6) || (itemGoal.type === 'bomb' && ib <= 5) || (itemGoal.type === 'key' && ib <= 7));
    var shouldVisitCave = caveGoal && (inDungeonRoom || (!caveSeen && !roomLockedActive && (!anyAlive || best > 2) && (caveBest <= 7 || !unvisitedExit)));
    if(inDungeonRoom){
      goal = caveGoal ? { c: caveGoal.c, r: caveGoal.r } : { c: 8, r: 2 };
      exitGoal = null;
      exitInner = null;
    }

    var attackMode = (anyAlive && target && (roomLockedActive || best <= 4) && !inDungeonRoom);
    var attackGoal = null;
    if(attackMode){
      if(isOneTileAway(target)){
        faceTowardCell(target.c, target.r);
        goal = { c: link.c, r: link.r };
      } else {
        attackGoal = attackCellForTarget(grid, target);
        if(attackGoal) goal = { c: attackGoal.c, r: attackGoal.r };
        else attackMode = false;
      }
    }

    if(!attackMode && shouldGrabCloseItem){
      goal = { c: itemGoal.c, r: itemGoal.r };
      exitGoal = null;
      exitInner = null;
    } else if(!attackMode && shouldVisitCave){
      goal = { c: caveGoal.c, r: caveGoal.r };
      exitGoal = null;
      exitInner = null;
    } else if(!attackMode && !exitGoal && itemGoal && ib <= 6){
      goal = { c: itemGoal.c, r: itemGoal.r };
    }

    var nearbyEnemies = 0, ni;
    for(ni = 0; ni < st.enemies.length; ni++){
      var ne = st.enemies[ni];
      if(ne.alive && Math.abs(ne.c - link.c) + Math.abs(ne.r - link.r) <= 2) nearbyEnemies++;
    }
    if((st.bombs || 0) > 0 && st.bombCd <= 0 && anyAlive && nearbyEnemies >= 2 && best <= 2 && !inDungeonRoom){
      wantBomb = true;
      if(target) faceTowardCell(target.c, target.r);
    }

    var danger = null, rk;
    for(rk = 0; rk < st.rocks.length; rk++){
      var p = st.rocks[rk];
      var pc = Math.floor(p.x / cw), pr = Math.floor(p.y / ch);
      if(Math.abs(pc - link.c) + Math.abs(pr - link.r) <= 1) danger = p;
    }

    if(st.aiTimer <= 0 && link.swing <= 0){
      st.aiTimer = Math.max(0.045, clk.spb * 0.18);
      var chosen = null;
      var atExit = exitGoal && !attackMode && ((Math.abs(link.px - exitEdge.c) < 0.48 && Math.abs(link.py - exitEdge.r) < 0.48) || (exitInner && Math.abs(link.px - exitInner.c) < 0.48 && Math.abs(link.py - exitInner.r) < 0.48));
      if(attackMode && isOneTileAway(target)){
        faceTowardCell(target.c, target.r);
        wantAtk = true;
      } else if(atExit){
        chosen = exitOff;
      } else {
        chosen = bfsStep(grid, link.c, link.r, goal.c, goal.r);
      }
      if(danger && chosen && !(attackMode && isOneTileAway(target))){
        var alt = (danger.x > (link.c + 0.5) * cw) ? 'left' : ((danger.x < (link.c + 0.5) * cw) ? 'right' : null);
        if(!alt) alt = (danger.y > (link.r + 0.5) * ch) ? 'up' : 'down';
        var av = dvec[alt];
        if(av && passable(grid, link.c + av[0], link.r + av[1])) chosen = alt;
      }
      if(!chosen && !(attackMode && isOneTileAway(target))){
        var fb = ['up', 'right', 'down', 'left'], fi;
        for(fi = 0; fi < 4; fi++){
          var fv = dvec[fb[fi]];
          if(passable(grid, link.c + fv[0], link.r + fv[1])){ chosen = fb[fi]; break; }
        }
      }
      if(chosen && !(attackMode && isOneTileAway(target))){
        holdMoveDir(chosen);
        moveDir = chosen;
      }
      if(attackMode && isOneTileAway(target)){
        faceTowardCell(target.c, target.r);
        wantAtk = true;
        moveDir = null;
        holdMoveDir(null);
      }
    }

    if(moveDir) link.dir = moveDir;
    return { moveDir: moveDir, wantAtk: wantAtk, wantBomb: wantBomb };
  }

  return { decideAuto: decideAuto };
})();

(function(){
  VisualizerGame.layer('zelda', 'behavior', {
    packVersion: 2,
    key: "zelda",
    goals: [
      "collect safe pickups",
      "kite enemies",
      "approach enemies from one cardinal tile away",
      "attack only after facing the adjacent enemy",
      "avoid projectiles",
      "follow the critical path toward the cave/goal",
      "enter short side branches for nearby rewards",
      "use graph-valid doors only",
      "prefer unvisited exits and avoid immediately bouncing back to the room just visited",
      "clear locked one-exit rooms before leaving unless a key is available",
      "keep path readable"
    ],
    perception: [
      "enemy vectors",
      "pickup value",
      "projectile lines",
      "door positions",
      "locked room state",
      "key inventory",
      "critical-path distance to goal",
      "side-branch reward rooms",
      "safe tiles"
    ],
    policies: [
      "prefer readable classic-game motion over random visualizer motion",
      "treat the room graph as authored structure, not a random maze",
      "cap decisions per frame and avoid per-frame pathfinding unless the scene changed",
      "allow small imperfections so the toy feels alive without sabotaging the run",
      "choose adjacent attack tiles instead of walking onto enemy tiles",
      "when paused, stop progression and keep only restrained idle animation"
    ],
    musicInputsAllowed: [
      "energy",
      "dangerBoost",
      "aggression",
      "chaos",
      "speedBias"
    ],
    update: function(ctx){
      if(ctx && ctx.state) ctx.state.$zeldaBehaviorReady = true;
    }
  });
})();
