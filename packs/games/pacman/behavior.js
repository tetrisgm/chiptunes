// PAC-MAN autonomous behavior contract. AI intent only; no rendering and no raw audio reads.
const PacmanBehavior = (function(){
  const DC = [0, 1, 0, -1];
  const DR = [-1, 0, 1, 0];

  function cellType(st, c, r){ return PacmanDefinition.cellType(st, c, r); }
  function wrapC(st, c){ return PacmanDefinition.wrapC(st, c); }
  function pacPass(st, c, r){ return PacmanDefinition.pacPass(st, c, r); }
  function ghostPass(st, c, r){ return PacmanDefinition.ghostPass(st, c, r); }

  function activeGhostDistanceMap(st){
    const dmap = {};
    const q = [];
    let head = 0;
    for(let i=0; i<st.ghosts.length; i++){
      const g = st.ghosts[i];
      if(g.mode === 'eyes' || g.mode === 'fright' || g.inPen) continue;
      const key = g.c + ',' + g.r;
      if(!(key in dmap)){
        dmap[key] = 0;
        q.push({ c:g.c, r:g.r });
      }
    }
    while(head < q.length){
      const cur = q[head++];
      const cd = dmap[cur.c + ',' + cur.r];
      for(let d=0; d<4; d++){
        const nc = wrapC(st, cur.c + DC[d]);
        const nr = cur.r + DR[d];
        if(nr < 0 || nr >= st.rows) continue;
        if(!ghostPass(st, nc, nr)) continue;
        const key = nc + ',' + nr;
        if(key in dmap) continue;
        dmap[key] = cd + 1;
        q.push({ c:nc, r:nr });
      }
    }
    return dmap;
  }

  function buildForgottenWeightMap(st){
    const compSize = {};
    const seen = {};
    for(let r=0; r<st.rows; r++){
      for(let c=0; c<st.cols; c++){
        const t = cellType(st, c, r);
        const seedKey = c + ',' + r;
        if((t !== '.' && t !== 'o') || seen[seedKey]) continue;
        const stack = [[c, r]];
        const members = [];
        seen[seedKey] = 1;
        while(stack.length){
          const cur = stack.pop();
          members.push(cur);
          for(let d=0; d<4; d++){
            const nc = wrapC(st, cur[0] + DC[d]);
            const nr = cur[1] + DR[d];
            if(nr < 0 || nr >= st.rows) continue;
            const nt = cellType(st, nc, nr);
            const key = nc + ',' + nr;
            if((nt === '.' || nt === 'o') && !seen[key]){
              seen[key] = 1;
              stack.push([nc, nr]);
            }
          }
        }
        for(let i=0; i<members.length; i++){
          compSize[members[i][0] + ',' + members[i][1]] = members.length;
        }
      }
    }

    const weights = {};
    for(let r=0; r<st.rows; r++){
      for(let c=0; c<st.cols; c++){
        const t = cellType(st, c, r);
        if(t !== '.' && t !== 'o') continue;
        const key = c + ',' + r;
        const size = compSize[key] || 1;
        if(size > 5){
          weights[key] = 0;
          continue;
        }
        let empty = 0;
        for(let er=-3; er<=3; er++){
          for(let ec=-3; ec<=3; ec++){
            if(Math.abs(er) + Math.abs(ec) > 3) continue;
            if(cellType(st, wrapC(st, c + ec), r + er) === ' ') empty++;
          }
        }
        weights[key] = (6 - size) * 3 + empty;
      }
    }
    return weights;
  }

  function safeBfsFromPac(st, dangerAt){
    const pac = st.pac;
    const dist = {};
    const prev = {};
    const q = [{ c:pac.c, r:pac.r }];
    let head = 0;
    dist[pac.c + ',' + pac.r] = 0;
    while(head < q.length){
      const cur = q[head++];
      const cd = dist[cur.c + ',' + cur.r];
      for(let d=0; d<4; d++){
        const nc = wrapC(st, cur.c + DC[d]);
        const nr = cur.r + DR[d];
        if(nr < 0 || nr >= st.rows) continue;
        if(!pacPass(st, nc, nr)) continue;
        if(dangerAt(nc, nr) <= 2) continue;
        const key = nc + ',' + nr;
        if(key in dist) continue;
        dist[key] = cd + 1;
        prev[key] = cur.c + ',' + cur.r;
        q.push({ c:nc, r:nr });
      }
    }
    return { dist, prev };
  }

  function blueDistance(st, sc, sr){
    const blue = {};
    let any = false;
    for(let i=0; i<st.ghosts.length; i++){
      const g = st.ghosts[i];
      if(g.mode === 'fright'){
        blue[g.c + ',' + g.r] = 1;
        any = true;
      }
    }
    if(!any) return 99;
    const seen = {};
    const q = [{ c:sc, r:sr, d:0 }];
    let head = 0;
    seen[sc + ',' + sr] = 1;
    while(head < q.length){
      const cur = q[head++];
      if(blue[cur.c + ',' + cur.r]) return cur.d;
      for(let d=0; d<4; d++){
        const nc = wrapC(st, cur.c + DC[d]);
        const nr = cur.r + DR[d];
        if(nr < 0 || nr >= st.rows) continue;
        if(!pacPass(st, nc, nr)) continue;
        const key = nc + ',' + nr;
        if(seen[key]) continue;
        seen[key] = 1;
        q.push({ c:nc, r:nr, d:cur.d + 1 });
      }
    }
    return 99;
  }

  function choosePacDirection(st){
    const pac = st.pac;
    const pc = pac.c;
    const pr = pac.r;
    const danger = activeGhostDistanceMap(st);
    const dangerAt = function(c, r){
      const v = danger[wrapC(st, c) + ',' + r];
      return v == null ? 99 : v;
    };
    const degreeAt = function(c, r){
      let n = 0;
      for(let d=0; d<4; d++){
        const nc = wrapC(st, c + DC[d]);
        const nr = r + DR[d];
        if(nr >= 0 && nr < st.rows && pacPass(st, nc, nr)) n++;
      }
      return n;
    };
    const clusterAt = function(c, r){
      let n = 0;
      for(let rr=-4; rr<=4; rr++){
        for(let cc=-4; cc<=4; cc++){
          if(Math.abs(rr) + Math.abs(cc) > 4) continue;
          const t = cellType(st, wrapC(st, c + cc), r + rr);
          if(t === '.' || t === 'o') n++;
        }
      }
      return n;
    };

    const forgottenWeights = buildForgottenWeightMap(st);
    const bfs = safeBfsFromPac(st, dangerAt);

    if(st.pacGoal){
      const goalType = cellType(st, st.pacGoal.c, st.pacGoal.r);
      if((goalType !== '.' && goalType !== 'o') || !((st.pacGoal.c + ',' + st.pacGoal.r) in bfs.dist)){
        st.pacGoal = null;
      }
    }
    if(!st.pacGoal){
      let best = null;
      let bestValue = -1e9;
      for(let r=0; r<st.rows; r++){
        for(let c=0; c<st.cols; c++){
          const t = cellType(st, c, r);
          if(t !== '.' && t !== 'o') continue;
          const key = c + ',' + r;
          const dist = bfs.dist[key];
          if(dist == null || dist === 0) continue;
          const value = (forgottenWeights[key] || 0) * 2 + 40 - dist * 1.5;
          if(value > bestValue){
            bestValue = value;
            best = { c, r };
          }
        }
      }
      st.pacGoal = best;
    }

    let goalDir = -1;
    if(st.pacGoal){
      let node = st.pacGoal.c + ',' + st.pacGoal.r;
      let parent = bfs.prev[node];
      while(parent !== undefined && parent !== (pc + ',' + pr)){
        node = parent;
        parent = bfs.prev[node];
      }
      if(parent === (pc + ',' + pr)){
        const parts = node.split(',');
        const gx = +parts[0];
        const gy = +parts[1];
        for(let d=0; d<4; d++){
          if(wrapC(st, pc + DC[d]) === gx && pr + DR[d] === gy){
            goalDir = d;
            break;
          }
        }
      }
    }

    const pacDanger = dangerAt(pc, pr);
    const rev = (pac.dir + 2) % 4;
    const survival = pacDanger <= 5;
    const fright = st.fright > 0;
    const candidates = [];
    for(let d=0; d<4; d++){
      const nc = wrapC(st, pc + DC[d]);
      const nr = pr + DR[d];
      if(nr < 0 || nr >= st.rows) continue;
      if(!pacPass(st, nc, nr)) continue;
      const nd = dangerAt(nc, nr);
      const deg = degreeAt(nc, nr);
      const t = cellType(st, nc, nr);
      let score = 0;
      if(survival){
        score = nd * 100 + deg * 12;
        if(deg <= 1) score -= 600;
        if(t === 'o') score += 220;
      } else {
        score = (d === goalDir ? 120 : 0) + clusterAt(nc, nr) * 1 + deg * 2 + Math.min(nd, 12) * 4;
        if(t === '.' || t === 'o') score += 22;
        if(nd <= 3) score -= (4 - nd) * 80;
        if(fright){
          const huntDistance = blueDistance(st, nc, nr);
          if(huntDistance < 99) score += Math.max(0, 90 - huntDistance * 9);
        }
        if(deg <= 1 && nd < 6) score -= 300;
        if(t === 'o' && pacDanger <= 10) score += 130;
      }
      if(d === rev) score -= 40;
      if(d === pac.dir) score += 6;
      candidates.push({ d, score, danger:nd });
    }
    if(!candidates.length) return null;

    const safe = candidates.filter(function(c){ return c.danger >= 2; });
    const use = safe.length ? safe : candidates;
    use.sort(function(a, b){ return b.score - a.score; });
    const top = use[0].score;
    const pool = [];
    for(let i=0; i<use.length; i++){
      if(top - use[i].score < 10) pool.push(use[i]);
    }
    return pool[(Math.abs(pc * 7 + pr * 13) + (st.ghEaten || 0)) % pool.length].d;
  }

  function updateGhosts(st, opts){
    opts = opts || {};
    const rows = st.rows;
    const pac = st.pac;
    const globalMode = opts.globalMode || (st.fright > 0 ? 'fright' : ((st.modePhase % 2 === 0) ? 'scatter' : 'chase'));
    const gfg = opts.gridFloat != null ? opts.gridFloat : 0;
    const dt = opts.dt > 0 ? opts.dt : 0.016;

    for(let gi2=0; gi2<st.ghosts.length; gi2++){
      const gh = st.ghosts[gi2];

      if(gh.inPen){
        gh.penTimer -= dt;
        if(gh.penTimer <= 0){
          gh.inPen = false;
          gh.dir = 0;
          gh.mode = (st.fright > 0) ? 'fright' : globalMode;
          // Walk out through the door instead of teleporting out of the pen.
          gh.r = Math.round(gh.sr + (gh.r - gh.sr) * (gh.off || 0));
          gh.sc = gh.c;
          gh.sr = gh.r;
          gh.off = 0;
          gh.moveStart = undefined;
        } else {
          gh.off += dt * 2.2;
          if(gh.off >= 1){
            gh.off = 0;
            const alt = (gh.r === st.penR ? st.penR + 1 : st.penR);
            if(cellType(st, gh.c, alt) === 'P'){
              gh.sr = gh.r;
              gh.r = alt;
            }
          }
          continue;
        }
      }

      if(gh.mode !== 'eyes'){
        if(st.fright > 0) gh.mode = 'fright';
        else gh.mode = (st.modePhase % 2 === 0) ? 'scatter' : 'chase';
      }

      const per = (st.ghPer || 3) * (gh.mode === 'eyes' ? 0.45 : gh.mode === 'fright' ? 1.7 : (1 + 0.05 * gi2));
      if(gh.moveStart === undefined) gh.moveStart = gfg;
      if(gh.perPrev !== undefined && per !== gh.perPrev) gh.moveStart = gfg - (gh.off || 0) * per;
      gh.perPrev = per;
      if(gfg - gh.moveStart > per * 8) gh.moveStart = gfg - per;

      let gguard = 0;
      while(gfg - gh.moveStart >= per && gguard < 10){
        gguard++;
        gh.moveStart += per;
        gh.sc = gh.c;
        gh.sr = gh.r;

        if(gh.mode === 'eyes' && cellType(st, gh.c, gh.r) === 'P'){
          gh.mode = st.fright > 0 ? 'fright' : globalMode;
          gh.inPen = true;
          gh.penTimer = 0.5;
          break;
        }

        let tc, tr;
        const atPenOrDoor = (cellType(st, gh.c, gh.r) === 'P' || cellType(st, gh.c, gh.r) === '-');
        if(gh.mode === 'eyes'){
          tc = st.penC;
          tr = st.penR;
        } else if(atPenOrDoor){
          tc = st.penC;
          tr = st.doorR - 1;
        } else if(gh.mode === 'fright'){
          tc = -1;
          tr = -1;
        } else if(gh.mode === 'scatter'){
          tc = gh.corner.c;
          tr = gh.corner.r;
        } else {
          tc = pac.c;
          tr = pac.r;
          if(gi2 === 1){
            tc = pac.c + DC[pac.dir] * 4;
            tr = pac.r + DR[pac.dir] * 4;
          } else if(gi2 === 2){
            const rc = pac.c + DC[pac.dir] * 2;
            const rr2 = pac.r + DR[pac.dir] * 2;
            const bx = st.ghosts[0].c;
            const by = st.ghosts[0].r;
            tc = rc + (rc - bx);
            tr = rr2 + (rr2 - by);
          } else if(gi2 === 3){
            const dman2 = Math.abs(gh.c - pac.c) + Math.abs(gh.r - pac.r);
            if(dman2 < 8){
              tc = gh.corner.c;
              tr = gh.corner.r;
            }
          }
        }

        const rev = (gh.dir + 2) % 4;
        const opts2 = [];
        const canEnterPen = (gh.mode === 'eyes' || atPenOrDoor);
        for(let d=0; d<4; d++){
          if(d === rev) continue;
          const nc = wrapC(st, gh.c + DC[d]);
          const nr = gh.r + DR[d];
          if(nr < 0 || nr >= rows) continue;
          const nt = cellType(st, nc, nr);
          if(nt === '#') continue;
          if((nt === '-' || nt === 'P') && !canEnterPen) continue;
          opts2.push({ d, c:nc, r:nr });
        }
        if(opts2.length === 0){
          const nc3 = wrapC(st, gh.c + DC[rev]);
          const nr3 = gh.r + DR[rev];
          if(nr3 >= 0 && nr3 < rows && ghostPass(st, gh.c + DC[rev], nr3)){
            opts2.push({ d:rev, c:nc3, r:nr3 });
          }
        }
        if(opts2.length){
          let chosen;
          if(gh.mode === 'fright'){
            chosen = opts2[(Math.floor(st.time * 97 + gi2 * 13 + gh.c * 7 + gh.r * 3)) % opts2.length];
          } else {
            chosen = opts2[0];
            let bd = 1e9;
            for(let oi=0; oi<opts2.length; oi++){
              const o = opts2[oi];
              const ddt = (o.c - tc) * (o.c - tc) + (o.r - tr) * (o.r - tr);
              if(ddt < bd){
                bd = ddt;
                chosen = o;
              }
            }
          }
          gh.dir = chosen.d;
          gh.c = chosen.c;
          gh.r = chosen.r;
          if(Math.abs(gh.c - gh.sc) > 1){
            gh.sc = gh.c;
            gh.sr = gh.r;
          }
        } else {
          gh.moveStart = gfg;
          break;
        }
      }
      gh.off = Math.max(0, Math.min(1, (gfg - gh.moveStart) / per));
    }
  }

  return {
    choosePacDirection,
    updateGhosts,
    activeGhostDistanceMap,
    buildForgottenWeightMap
  };
})();

(function(){
  VisualizerGame.layer('pacman', 'behavior', {
  packVersion: 2,
  key: "pacman",
  goals: [
    "seek the nearest safe pellet cluster",
    "avoid ghosts inside danger radius",
    "prefer power pellets when trapped",
    "use tunnels for escapes",
    "keep turns visually varied",
    "allow small route imperfections"
  ],
  perception: [
    "grid passability",
    "pellet density",
    "ghost distance and heading",
    "power pellet availability",
    "tunnel exits"
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
  ownedBy: "PacmanBehavior.choosePacDirection for autonomous player decisions; PacmanBehavior.updateGhosts for chase/scatter/fright/eyes ghost movement"
});
})();
