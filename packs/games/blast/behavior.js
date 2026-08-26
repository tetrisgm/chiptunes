// BLAST autonomous behavior. AI intent only; no rendering and no raw audio reads.
var BlastBehavior = (function(){
  function enemyDist(ctx, c, r){
    var best = Infinity;
    for(var i = 0; i < ctx.st.enemies.length; i++){
      var e = ctx.st.enemies[i];
      var dd = Math.abs(e.c - c) + Math.abs(e.r - r);
      if(dd < best) best = dd;
    }
    return best;
  }

  function blastHitsEnemy(ctx, bc, br){
    var cells = ctx.blastCells(bc, br);
    for(var k = 0; k < cells.length; k++){
      if(ctx.enemyAt(cells[k].c, cells[k].r)) return true;
    }
    return false;
  }

  function safePath(ctx){
    return ctx.bfs(ctx.bm.c, ctx.bm.r, function(c, r){
      return !ctx.dangerNow(c, r);
    }, null);
  }

  function safeCalmPath(ctx){
    return ctx.bfs(ctx.bm.c, ctx.bm.r, function(c, r){
      return !ctx.dangerNow(c, r) && !ctx.enemyZone(c, r);
    }, function(c, r){
      return ctx.enemyZone(c, r);
    });
  }

  function escapeFromHypo(ctx, bc, br){
    return ctx.bfs(ctx.bm.c, ctx.bm.r, function(c, r){
      if(c === bc && r === br) return false;
      return !ctx.dangerHypo(c, r, bc, br) && !ctx.enemyZone(c, r);
    }, function(c, r){
      return ctx.dangerNow(c, r) || ctx.enemyZone(c, r);
    });
  }

  function takePath(ctx, path){
    if(path && path.length > 1){
      return ctx.stepBomber(path[1].c - ctx.bm.c, path[1].r - ctx.bm.r);
    }
    return false;
  }

  function fleeEnemies(ctx){
    var bestDir = null;
    var bestScore = -1;
    var here = enemyDist(ctx, ctx.bm.c, ctx.bm.r);
    for(var d = 0; d < 4; d++){
      var nc = ctx.bm.c + ctx.dirs4[d][0];
      var nr = ctx.bm.r + ctx.dirs4[d][1];
      if(!ctx.walkable(nc, nr)) continue;
      if(ctx.dangerNow(nc, nr) || ctx.enemyZone(nc, nr)) continue;
      var sc = enemyDist(ctx, nc, nr);
      if(sc > bestScore){ bestScore = sc; bestDir = ctx.dirs4[d]; }
    }
    if(bestDir && bestScore >= here){
      ctx.stepBomber(bestDir[0], bestDir[1]);
      return true;
    }
    return false;
  }

  function notLastSpot(ctx){
    return !(ctx.bm.c === ctx.bm.lastBombC && ctx.bm.r === ctx.bm.lastBombR);
  }

  function adjSoft(ctx){
    var bm = ctx.bm;
    return ctx.softAt(bm.c + 1, bm.r) || ctx.softAt(bm.c - 1, bm.r) ||
      ctx.softAt(bm.c, bm.r + 1) || ctx.softAt(bm.c, bm.r - 1);
  }

  function canPlaceUsefulBomb(ctx, ai){
    var bm = ctx.bm;
    return ctx.bombsOwnedBy('p') < bm.bombMax &&
      ctx.st.bombCd <= 0 &&
      ai.bombCd <= 0 &&
      notLastSpot(ctx) &&
      !ctx.dangerNow(bm.c, bm.r) &&
      (blastHitsEnemy(ctx, bm.c, bm.r) || adjSoft(ctx));
  }

  function updatePlayer(ctx){
    var st = ctx.st;
    var bm = ctx.bm;
    var ai = st.ai;
    ai.moveCd -= ctx.dt;
    if(ai.bombCd > 0) ai.bombCd -= ctx.dt;

    if(ai.moveCd > 0) return false;

    var acted = false;

    if(ctx.dangerNow(bm.c, bm.r)){
      if(!takePath(ctx, safeCalmPath(ctx)) && !takePath(ctx, safePath(ctx))){
        var bestD = null;
        var bestE = -1;
        for(var sd = 0; sd < 4; sd++){
          var s2 = ctx.dirs4[sd];
          var nc = bm.c + s2[0];
          var nr = bm.r + s2[1];
          if(ctx.walkable(nc, nr) && !ctx.dangerNow(nc, nr) && !ctx.enemyAt(nc, nr)){
            var e2 = enemyDist(ctx, nc, nr);
            if(e2 > bestE){ bestE = e2; bestD = s2; }
          }
        }
        if(bestD) ctx.stepBomber(bestD[0], bestD[1]);
      }
      ai.moveCd = 0.07;
      acted = true;
    }

    if(!acted && ai.holdUntil > st.t){
      if(canPlaceUsefulBomb(ctx, ai)){
        var escC = escapeFromHypo(ctx, bm.c, bm.r);
        if(escC && escC.length > 1 && ctx.placeBomb()){
          ai.bombCd = 0.22;
          ai.retreat = escC;
          ai.holdUntil = st.t + 1.2;
          var fc = escC[1];
          if(ctx.walkable(fc.c, fc.r) && !ctx.dangerNow(fc.c, fc.r) && !ctx.enemyZone(fc.c, fc.r)){
            ctx.stepBomber(fc.c - bm.c, fc.r - bm.r);
            ai.retreat.shift();
          }
          ai.moveCd = 0.09;
          acted = true;
        }
      }
      if(!acted){
        if(ai.retreat && ai.retreat.length > 1){
          var rstep = ai.retreat[1];
          if(ctx.walkable(rstep.c, rstep.r) && !ctx.dangerNow(rstep.c, rstep.r) && !ctx.enemyZone(rstep.c, rstep.r)){
            if(ctx.stepBomber(rstep.c - bm.c, rstep.r - bm.r)) ai.retreat.shift();
          } else {
            ai.retreat = null;
          }
        } else if(ctx.enemyZone(bm.c, bm.r)){
          if(!fleeEnemies(ctx)) takePath(ctx, safeCalmPath(ctx));
        }
        ai.moveCd = 0.09;
        acted = true;
      }
    }

    if(!acted && enemyDist(ctx, bm.c, bm.r) <= 1){
      var canBomb = blastHitsEnemy(ctx, bm.c, bm.r) &&
        st.bombCd <= 0 &&
        ai.bombCd <= 0 &&
        ctx.bombsOwnedBy('p') < bm.bombMax &&
        notLastSpot(ctx);
      var esc2 = canBomb ? escapeFromHypo(ctx, bm.c, bm.r) : null;
      if(esc2 && esc2.length > 1 && ctx.placeBomb()){
        ai.bombCd = 0.22;
        ai.retreat = esc2;
        ai.holdUntil = st.t + 1.2;
        var fst = esc2[1];
        if(ctx.walkable(fst.c, fst.r) && !ctx.dangerNow(fst.c, fst.r)){
          ctx.stepBomber(fst.c - bm.c, fst.r - bm.r);
          ai.retreat.shift();
        }
        ai.moveCd = 0.08;
        acted = true;
      } else if(fleeEnemies(ctx)){
        ai.moveCd = 0.07;
        acted = true;
      } else {
        var cp = safeCalmPath(ctx);
        if(cp && cp.length > 1){
          takePath(ctx, cp);
          ai.moveCd = 0.07;
          acted = true;
        }
      }
    }

    if(!acted){
      ai.retreat = null;
      ai.holdUntil = 0;

      var puStep = ctx.powerupStep(bm.c, bm.r, function(c, r){
        return ctx.dangerNow(c, r) || ctx.enemyZone(c, r);
      });

      var wantBomb = blastHitsEnemy(ctx, bm.c, bm.r);
      if(!wantBomb){
        var pupOpen = puStep && (puStep.dc || puStep.dr);
        if(!pupOpen){
          for(var d2 = 0; d2 < 4; d2++){
            var sc = bm.c + ctx.dirs4[d2][0];
            var sr = bm.r + ctx.dirs4[d2][1];
            if(ctx.softAt(sc, sr)){ wantBomb = true; break; }
          }
        }
      }

      if(wantBomb &&
        st.bombCd <= 0 &&
        ai.bombCd <= 0 &&
        ctx.bombsOwnedBy('p') < bm.bombMax &&
        notLastSpot(ctx)){
        var esc = escapeFromHypo(ctx, bm.c, bm.r);
        if(esc && esc.length > 1 && ctx.placeBomb()){
          ai.bombCd = 0.22;
          ai.retreat = esc;
          ai.holdUntil = st.t + 1.2;
          var first = esc[1];
          if(ctx.walkable(first.c, first.r) && !ctx.dangerNow(first.c, first.r)){
            ctx.stepBomber(first.c - bm.c, first.r - bm.r);
            ai.retreat.shift();
          }
          ai.moveCd = 0.10;
          acted = true;
        }
      }

      if(!acted){
        var step = null;
        if(puStep && (puStep.dc || puStep.dr)) step = puStep;
        if(!step && st.enemies.length > 0){
          var firePath = ctx.bfs(bm.c, bm.r, function(c, r){
            return !ctx.enemyZone(c, r) && !ctx.dangerNow(c, r) && blastHitsEnemy(ctx, c, r);
          }, function(c, r){
            return ctx.enemyZone(c, r) || ctx.dangerNow(c, r);
          });
          if(firePath && firePath.length > 1){
            step = { dc:firePath[1].c - bm.c, dr:firePath[1].r - bm.r };
          }
          if(!step) step = ctx.digStepToward(function(c, r){ return enemyDist(ctx, c, r) <= 1 && !ctx.enemyAt(c, r); });
          if(!step) step = ctx.digStepToward(function(c, r){ return !!ctx.enemyAt(c, r); });
        }
        if(!step) step = ctx.digStepToward(function(c, r){ return st.soft[r][c] === 1; });

        if(step && (step.dc || step.dr)){
          var tc2 = bm.c + step.dc;
          var tr2 = bm.r + step.dr;
          if(ctx.walkable(tc2, tr2) && !ctx.dangerNow(tc2, tr2) && !ctx.enemyZone(tc2, tr2)){
            ctx.stepBomber(step.dc, step.dr);
            ai.moveCd = 0.11;
            acted = true;
          } else if(ctx.softAt(tc2, tr2)){
            bm.dir = (step.dc > 0 ? 1 : step.dc < 0 ? 3 : step.dr > 0 ? 2 : 0);
            ai.moveCd = 0.05;
            acted = true;
          } else if(ctx.enemyZone(tc2, tr2)){
            if(fleeEnemies(ctx)){
              ai.moveCd = 0.09;
              acted = true;
            }
          }
        }

        if(!acted){
          for(var w = 0; w < 4; w++){
            var wd = ctx.dirs4[(((st.t * 2) | 0) + w) % 4];
            var ncw = bm.c + wd[0];
            var nrw = bm.r + wd[1];
            if(ctx.walkable(ncw, nrw) && !ctx.dangerNow(ncw, nrw) && !ctx.enemyZone(ncw, nrw)){
              ctx.stepBomber(wd[0], wd[1]);
              break;
            }
          }
          ai.moveCd = 0.16;
        }
      }
    }
    return acted;
  }

  return {
    updatePlayer:updatePlayer,
    enemyDist:enemyDist,
    blastHitsEnemy:blastHitsEnemy,
    escapeFromHypo:escapeFromHypo
  };
})();

(function(){
  VisualizerGame.layer('blast', 'behavior', {
    packVersion: 2,
    key: "blast",
    goals: [
      "route through destructible blocks",
      "place bombs only with verified escape paths",
      "avoid live and pending blast lines",
      "collect safe pickups",
      "attack enemies from bomb-line positions instead of body contact"
    ],
    perception: [
      "blast radius",
      "escape tiles",
      "enemy positions and next-step threat zones",
      "soft block value",
      "pickup safety"
    ],
    policies: [
      "survival checks run before aggression",
      "movement decisions stay grid-readable like the original",
      "bomb placement is denied without an escape route",
      "small imperfections come from path ties, not random suicide"
    ],
    musicInputsAllowed: [
      "energy",
      "dangerBoost",
      "aggression",
      "chaos",
      "speedBias"
    ],
    update:function(ctx){
      if(ctx && ctx.st) ctx.st.$blastBehaviorReady = true;
    }
  });
})();
