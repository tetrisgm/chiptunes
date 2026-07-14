// MARIO behavior: autonomous intent only. No drawing and no raw audio reads.
(function(){
  function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }
  function groundY(st){
    return st && (st.groundY || (typeof MarioDefinition !== 'undefined' && MarioDefinition.GROUND_Y)) || 192;
  }
  function phys(){
    return (typeof MarioDefinition !== 'undefined' && MarioDefinition.PHYS) || {
      runCap:190, jumpMin:304, jumpRunBonus:44, holdGravity:980,
      releaseGravity:2300, fallGravity:2600, terminalFall:640
    };
  }
  function groundCovers(st, x){
    if(!st || !st.ground) return false;
    for(var i=0;i<st.ground.length;i++){
      var g = st.ground[i];
      if(x >= g.x && x <= g.x + g.w) return true;
    }
    return false;
  }
  function hasGapBefore(st, fromX, toX){
    var step = 8;
    for(var x=fromX; x<=toX; x+=step){
      if(!groundCovers(st, x)) return true;
    }
    return false;
  }
  function hasBlockingSolidBefore(st, enemy){
    if(!st || !st.mario || !enemy || typeof MarioDefinition === 'undefined' || !MarioDefinition.solidRects) return false;
    var m = st.mario;
    var minX = m.x + m.w;
    var maxX = enemy.x + enemy.w * 0.5;
    var solids = MarioDefinition.solidRects(st, m.x, maxX + 8);
    for(var i=0;i<solids.length;i++){
      var s = solids[i];
      if(s.kind === 'ground') continue;
      if(s.x <= minX + 2 || s.x >= maxX - 4) continue;
      if(s.y + s.h > m.y + 4) return true;
    }
    return false;
  }
  function estimateStompTime(st, enemy, hold, speedBias){
    var m = st.mario;
    var P = phys();
    var maxRun = (P.runCap || 190) * clamp(speedBias || 1, 0.82, 1.34);
    var runLift = clamp(Math.abs(m.vx || 0) / Math.max(1, maxRun), 0, 1);
    var vy = -((P.jumpMin || 304) + runLift * (P.jumpRunBonus || 44));
    var y = 0;
    var t = 0;
    var step = 1 / 180;
    var startBottom = m.y + m.h;
    var targetBottom = enemy.y + Math.min(9, enemy.h * 0.55);
    var targetRel = clamp(targetBottom - startBottom, -42, -4);
    var lastY = y;
    for(var i=0;i<190;i++){
      var gravity = vy < 0
        ? (t < hold ? (P.holdGravity || 980) : (P.releaseGravity || 2300))
        : (P.fallGravity || 2600);
      vy += gravity * step;
      if(vy > (P.terminalFall || 640)) vy = P.terminalFall || 640;
      lastY = y;
      y += vy * step;
      t += step;
      if(vy > 0 && lastY < targetRel && y >= targetRel) return t;
      if(y > 28) break;
    }
    return null;
  }
  function estimateTargetTime(st, target, hold, speedBias, aim){
    var m = st.mario;
    var P = phys();
    var maxRun = (P.runCap || 190) * clamp(speedBias || 1, 0.82, 1.34);
    var runLift = clamp(Math.abs(m.vx || 0) / Math.max(1, maxRun), 0, 1);
    var vy = -((P.jumpMin || 304) + runLift * (P.jumpRunBonus || 44));
    var y = 0;
    var t = 0;
    var step = 1 / 180;
    var marioAimY = aim === 'block' ? m.y + 2 : m.y + m.h * 0.50;
    var targetAimY = aim === 'block' ? target.y + target.h + 2 : target.y + target.h * 0.50;
    var targetRel = clamp(targetAimY - marioAimY, -92, 12);
    var best = { time:0.18, err:999, targetRel:targetRel };
    for(var i=0;i<230;i++){
      var gravity = vy < 0
        ? (t < hold ? (P.holdGravity || 980) : (P.releaseGravity || 2300))
        : (P.fallGravity || 2600);
      vy += gravity * step;
      if(vy > (P.terminalFall || 640)) vy = P.terminalFall || 640;
      y += vy * step;
      t += step;
      if(t > 0.045){
        var err = Math.abs(y - targetRel);
        if(err < best.err) best = { time:t, err:err, targetRel:targetRel };
      }
      if(y > 22 && vy > 0) break;
    }
    return best.err < (aim === 'block' ? 11 : 13) ? best : null;
  }
  function solveCollectArc(st, target, dx, aim, speedBias){
    var m = st.mario;
    var P = phys();
    var holds = [0.075, 0.105, 0.145, 0.19, 0.245, 0.305, 0.36];
    var speedModes = [0.52, 0.66, 0.82, 0.98, 1.10];
    var best = null;
    for(var hi=0; hi<holds.length; hi++){
      var arc = estimateTargetTime(st, target, holds[hi], speedBias, aim);
      if(!arc) continue;
      for(var si=0; si<speedModes.length; si++){
        var speedMode = speedModes[si];
        var projected = Math.max(34, Math.abs(m.vx || 0) * 0.28 + (P.runCap || 190) * clamp(speedBias || 1, 0.82, 1.34) * speedMode * 0.62);
        var timeToX = clamp((dx - (aim === 'block' ? 1 : 3)) / projected, 0, 1.4);
        var timingErr = Math.abs(timeToX - arc.time);
        var speedPenalty = speedMode < 0.68 ? 0.018 : speedMode > 1.02 ? 0.026 : 0;
        var holdPenalty = Math.abs(holds[hi] - 0.18) * 0.045;
        var score = timingErr + arc.err * 0.006 + speedPenalty + holdPenalty;
        if(!best || score < best.score){
          var untilJump = timeToX - arc.time;
          best = {
            hold:holds[hi],
            speedScale:speedMode,
            timeToX:timeToX,
            arcTime:arc.time,
            timingErr:timingErr,
            jumpNow:untilJump <= 0.055,
            waiting:untilJump > 0.055,
            score:score,
            targetRel:arc.targetRel
          };
        }
      }
    }
    return best;
  }
  function nextBeatDelay(audio){
    var bpm = clamp((audio && audio.bpm) || 150, 80, 220);
    var beatDur = 60 / bpm;
    var bar = clamp((audio && audio.barProgress) || 0, 0, 1);
    var beatPhase = (bar * 4) % 1;
    var delay = (1 - beatPhase) * beatDur;
    if(delay > beatDur - 0.035 || (audio && audio.beatStrength > 0.5)) return 0;
    return delay;
  }
  function planEnemyJump(st, audio, speedBias){
    if(!st || !st.mario || !st.enemies) return null;
    var m = st.mario;
    var gy = groundY(st);
    var mCenter = m.x + m.w * 0.5;
    var best = null;
    var nearestThreat = null;

    for(var i=0;i<st.enemies.length;i++){
      var e = st.enemies[i];
      if(!e || e.gone || e.squash > 0) continue;
      var eCenter = e.x + e.w * 0.5;
      var dist = eCenter - mCenter;
      if(dist < 6 || dist > 168) continue;
      if(!nearestThreat || dist < nearestThreat.dist) nearestThreat = { enemy:e, dist:dist };

      var onReadableGround = Math.abs((e.y + e.h) - gy) < 18 && groundCovers(st, eCenter);
      if(!onReadableGround) continue;
      if(e.stompable === false) continue;
      if(hasGapBefore(st, m.x + m.w * 0.5, eCenter - 4)) continue;
      if(hasBlockingSolidBefore(st, e)) continue;

      var closing = Math.max(112, (m.vx || 0) - (e.vx || 0) + 14);
      var timeToEnemy = clamp((dist - 1) / closing, 0, 1.2);
      var holds = [0.105, 0.155, 0.225];
      for(var h=0; h<holds.length; h++){
        var arc = estimateStompTime(st, e, holds[h], speedBias);
        if(arc == null) continue;
        var error = Math.abs(timeToEnemy - arc);
        var score = error + h * 0.012 + (dist < 22 ? 0.16 : 0);
        if(!best || score < best.score){
          best = { mode:'stomp', enemy:e, dist:dist, time:timeToEnemy, arc:arc, hold:holds[h], error:error, score:score };
        }
      }
    }

    if(best && best.time > 0.16 && best.error < 0.19){
      var untilJump = best.time - best.arc;
      var beatDelay = nextBeatDelay(audio);
      var canWaitForBeat = beatDelay > 0 && beatDelay < 0.085 && untilJump > beatDelay - 0.012;
      best.jumpNow = untilJump <= 0.035 || (best.time < best.arc + 0.075 && !canWaitForBeat);
      best.waiting = !best.jumpNow;
      best.hold = best.hold + (best.error > 0.11 ? 0.035 : 0);
      return best;
    }

    if(nearestThreat && nearestThreat.dist < 72){
      return {
        mode:'avoid',
        enemy:nearestThreat.enemy,
        dist:nearestThreat.dist,
        jumpNow:nearestThreat.dist < 56,
        hold:nearestThreat.dist < 30 ? 0.22 : 0.16
      };
    }
    return nearestThreat ? { mode:'watch', enemy:nearestThreat.enemy, dist:nearestThreat.dist, jumpNow:false, hold:0 } : null;
  }

  function ignoreCollect(st, id, seconds){
    if(!id) return;
    st.aiCollectIgnore = st.aiCollectIgnore || {};
    st.aiCollectIgnore[id] = (st.t || 0) + (seconds || 0.8);
  }
  function ignoredCollect(st, id){
    return !!(id && st.aiCollectIgnore && st.aiCollectIgnore[id] > (st.t || 0));
  }
  function planCollectible(st, audio, speedBias){
    if(!st || !st.mario) return null;
    var m = st.mario;
    var mCenter = m.x + m.w * 0.5;
    var best = null;

    function consider(plan){
      if(!plan) return;
      if(!best || plan.score < best.score) best = plan;
    }

    if(st.coins){
      for(var i=0;i<st.coins.length;i++){
        var c = st.coins[i];
        if(!c || c.got || c.pop > 0) continue;
        if(ignoredCollect(st, c.id)) continue;
        var cx = c.x + c.w * 0.5;
        var dx = cx - mCenter;
        if(dx < -10 || dx > 166) continue;
        if(dx > 0 && hasGapBefore(st, mCenter, cx - 4)) continue;
        var high = c.y < m.y - 10;
        var close = Math.abs(dx) < (high ? 54 : 24);
        var arcPlan = high ? solveCollectArc(st, c, dx, 'coin', speedBias) : null;
        if(high && !arcPlan && dx > 10) continue;
        var score = Math.abs(dx) * 0.52 + Math.max(0, m.y - c.y) * 0.18 + (dx < 0 ? 34 : 0) - (high ? 12 : 0);
        if(arcPlan) score += arcPlan.score * 58 + (arcPlan.waiting ? 5 : 0);
        consider({
          kind:'coin',
          id:c.id,
          ref:c,
          dx:dx,
          score:score,
          backtrack:false,
          slow:high || close || (dx > -4 && dx < 48),
          jumpNow:!!(arcPlan && arcPlan.jumpNow),
          waiting:!!(arcPlan && arcPlan.waiting),
          speedScale:arcPlan ? arcPlan.speedScale : (close ? 0.72 : 0.9),
          high:high,
          hold:arcPlan ? arcPlan.hold : (high ? 0.18 : 0.11),
          targetRel:arcPlan ? arcPlan.targetRel : 0
        });
      }
    }

    if(st.blocks){
      for(var b=0;b<st.blocks.length;b++){
        var block = st.blocks[b];
        if(!block || block.type !== 'question' || block.used) continue;
        if(ignoredCollect(st, block.id)) continue;
        var bx = block.x + block.w * 0.5;
        var bdx = bx - mCenter;
        if(bdx < -10 || bdx > 132) continue;
        if(bdx > 0 && hasGapBefore(st, mCenter, bx - 4)) continue;
        if(block.y > m.y - 24 || block.y < m.y - 112) continue;
        var blockArc = solveCollectArc(st, block, bdx, 'block', speedBias);
        if(!blockArc && bdx > 8) continue;
        consider({
          kind:'question',
          id:block.id,
          ref:block,
          dx:bdx,
          score:Math.abs(bdx) * 0.34 - 34 + (blockArc ? blockArc.score * 48 : 30),
          backtrack:false,
          slow:true,
          jumpNow:!!(blockArc && blockArc.jumpNow),
          waiting:!!(blockArc && blockArc.waiting),
          speedScale:blockArc ? blockArc.speedScale : 0.62,
          high:true,
          hold:blockArc ? blockArc.hold : 0.22,
          targetRel:blockArc ? blockArc.targetRel : 0
        });
      }
    }

    return best;
  }

  function planStillValid(plan, st){
    if(!plan || !plan.ref) return false;
    if(!st || !st.mario) return false;
    var m = st.mario;
    var mCenter = m.x + m.w * 0.5;
    if(plan.kind === 'coin'){
      if(plan.ref.got || plan.ref.pop > 0) return false;
      var cx = plan.ref.x + plan.ref.w * 0.5;
      return cx - mCenter > -12 && cx - mCenter < 176;
    }
    if(plan.kind === 'question'){
      if(plan.ref.used || plan.ref.broken) return false;
      var bx = plan.ref.x + plan.ref.w * 0.5;
      return bx - mCenter > -14 && bx - mCenter < 142;
    }
    return false;
  }
  function commitPlan(st, plan, dt, enemyPlan, dangerousGap, pipeSoon, wallSoon){
    var t = (st.t || 0);
    var current = st.aiObjective;
    if(current && plan && current.id === plan.id && current.kind === plan.kind && current.until > t){
      current.plan = plan;
      return plan;
    }
    if(current && current.until > t && current.plan && !planStillValid(current.plan, st)){
      ignoreCollect(st, current.id, 1.1);
      st.aiObjective = { kind:'forward', until:t + 0.44 };
      return null;
    }
    if(current && current.until > t && planStillValid(current.plan, st)){
      return current.plan;
    }
    if(current && current.until > t && current.kind === 'forward' && (!plan || current.until - t > 0.16)){
      return null;
    }
    st.aiObjective = null;
    if(!plan || !planStillValid(plan, st)) return null;

    var enemyAhead = enemyPlan && enemyPlan.dist != null && enemyPlan.dist < 128;
    var unsafeBacktrack = plan.backtrack && (enemyAhead || dangerousGap || pipeSoon || wallSoon);
    if(unsafeBacktrack || (plan.backtrack && Math.abs(plan.dx) > 38)){
      st.aiObjective = { kind:'forward', until:t + 0.62 };
      return null;
    }

    var commit = plan.kind === 'question' ? 0.95 : 0.62;
    st.aiObjective = { kind:plan.kind, id:plan.id, plan:plan, until:t + commit };
    return plan;
  }

  var B = {};

  B.update = function(ctx){
    var st = ctx.state;
    if(!st || !st.mario) return;

    var input = ctx.IN || {};
    var keys = input.keys || {};
    var m = st.mario;
    var audio = ctx.audio || {};
    var music = st.music || {};

    if(input.active){
      st.intent = {
        left:!!keys.left,
        right:!!keys.right,
        jump:!!(keys.up || input.down),
        jumpHeld:!!(keys.up || input.down),
        speedBias:1
      };
      return;
    }

    if(audio.paused){
      st.intent = { left:false, right:false, jump:false, jumpHeld:false, speedBias:1 };
      return;
    }

    var look = (typeof MarioDefinition !== 'undefined' && MarioDefinition.lookAhead) ? MarioDefinition.lookAhead(st) : {};
    var speedBias = clamp(music.speedBias || 1, 0.84, 1.28);
    var screenX = m.x - (st.cameraX || 0);
    var wantRight = true;
    var wantLeft = false;

    if(screenX > 164 && m.vx > 84) speedBias *= 0.82;
    if(screenX < 76) speedBias *= 1.14;

    var enemyPlan = planEnemyJump(st, audio, speedBias);
    if(enemyPlan && enemyPlan.mode === 'stomp'){
      if(enemyPlan.waiting && enemyPlan.time > enemyPlan.arc + 0.12) speedBias *= 1.04;
      else if(enemyPlan.waiting) speedBias *= 0.96;
    } else if(enemyPlan && enemyPlan.mode === 'avoid' && enemyPlan.dist < 28) {
      speedBias *= 0.88;
    }

    var obstacle = Math.min(
      look.gap == null ? Infinity : look.gap,
      look.pipe == null ? Infinity : look.pipe,
      look.wall == null ? Infinity : look.wall,
      look.enemy == null ? Infinity : look.enemy
    );
    var blockNear = look.block != null && look.block < 56;
    var pipeSoon = look.pipe != null && look.pipe < 64;
    var wallSoon = look.wall != null && look.wall < 62;
    var enemySoon = look.enemy != null && look.enemy < 52;
    var enemyNeedsAvoid = enemySoon && !(enemyPlan && (enemyPlan.mode === 'stomp' || enemyPlan.mode === 'watch'));
    if(enemyPlan && enemyPlan.mode === 'avoid') enemyNeedsAvoid = true;
    var gapSoon = look.gap != null && look.gap < 92;
    var dangerousGap = gapSoon && (look.gapWidth || 0) >= 24;
    var collectPlan = planCollectible(st, audio, speedBias);
    var committedCollect = commitPlan(st, collectPlan, ctx.dt || 0.016, enemyPlan, dangerousGap, pipeSoon, wallSoon);
    var collectActive = committedCollect && !dangerousGap && !(enemyNeedsAvoid && committedCollect.dx > -6) && !(pipeSoon && look.pipe < 30) && !(wallSoon && look.wall < 30);
    if(collectActive){
      collectPlan = committedCollect;
      if(collectPlan.backtrack && m.onGround){
        wantLeft = true;
        wantRight = false;
        speedBias *= 0.72;
      } else if(collectPlan.slow) {
        speedBias *= collectPlan.speedScale || (collectPlan.kind === 'question' ? 0.68 : 0.82);
        if(collectPlan.high && collectPlan.dx > -2 && collectPlan.dx < 15 && m.onGround && collectPlan.waiting){
          wantRight = false;
        }
      }
    }
    var jumpWindow = enemyNeedsAvoid || pipeSoon || wallSoon || dangerousGap || (blockNear && m.onGround && Math.abs(m.vx) > 68) || (collectActive && collectPlan.jumpNow);
    var highJump = dangerousGap || pipeSoon || wallSoon || (blockNear && m.onGround) || (collectActive && collectPlan.high) || (enemyPlan && enemyPlan.mode === 'avoid' && enemyPlan.dist < 34);

    st.aiJumpLock = Math.max(0, (st.aiJumpLock || 0) - (ctx.dt || 0.016));
    st.aiHold = Math.max(0, (st.aiHold || 0) - (ctx.dt || 0.016));
    var blockedClose = m.onGround && (look.wall < 18 || look.pipe < 18) && Math.abs(m.vx) < 18;
    var hardStopNear = look.wall < 22 || look.pipe < 22;
    var lastProgressX = st.aiLastProgressX == null ? m.x : st.aiLastProgressX;
    if(hardStopNear && m.x <= lastProgressX + 0.35) st.aiNoProgressT = (st.aiNoProgressT || 0) + (ctx.dt || 0.016);
    else st.aiNoProgressT = Math.max(0, (st.aiNoProgressT || 0) - (ctx.dt || 0.016) * 2.5);
    if(m.x > lastProgressX + 0.35) st.aiLastProgressX = m.x;
    st.aiStuckT = blockedClose ? (st.aiStuckT || 0) + (ctx.dt || 0.016) : Math.max(0, (st.aiStuckT || 0) - (ctx.dt || 0.016) * 2);

    if(enemyPlan && enemyPlan.mode === 'stomp' && enemyPlan.jumpNow && m.onGround && st.aiJumpLock <= 0){
      st.aiHold = Math.max(st.aiHold || 0, clamp(enemyPlan.hold, 0.105, 0.275));
      st.aiJumpLock = 0.28;
      st.aiStompX = enemyPlan.enemy ? enemyPlan.enemy.x : 0;
      st.aiStompT = 0.55;
    } else if(jumpWindow && m.onGround && st.aiJumpLock <= 0){
      var plannedHold = collectActive && collectPlan.jumpNow ? collectPlan.hold : (highJump ? 0.335 : 0.12);
      st.aiHold = clamp(plannedHold, 0.075, 0.38);
      st.aiJumpLock = highJump ? 0.36 : 0.24;
      if(collectActive && collectPlan.jumpNow) st.aiJumpLock = Math.max(st.aiJumpLock, 0.24 + st.aiHold * 0.42);
    }
    st.aiStompT = Math.max(0, (st.aiStompT || 0) - (ctx.dt || 0.016));

    if(blockedClose && st.aiJumpLock <= 0.08){
      st.aiHold = Math.max(st.aiHold || 0, st.aiStuckT > 0.3 ? 0.36 : 0.24);
      st.aiJumpLock = 0.28;
    }

    if((blockedClose && st.aiStuckT > 1.15) || st.aiNoProgressT > 0.75){
      st.aiForceRight = 0.72;
      st.aiHold = Math.max(st.aiHold || 0, 0.38);
      st.aiJumpLock = 0.38;
      st.aiStuckT = 0.35;
      st.aiNoProgressT = 0.1;
    }
    st.aiBack = Math.max(0, (st.aiBack || 0) - (ctx.dt || 0.016));
    st.aiForceRight = Math.max(0, (st.aiForceRight || 0) - (ctx.dt || 0.016));
    if(st.aiBack > 0){
      wantLeft = true;
      wantRight = false;
      st.aiHold = 0;
    } else if(st.aiForceRight > 0) {
      wantLeft = false;
      wantRight = true;
      speedBias = Math.max(speedBias, 1.05);
    } else if((wallSoon || pipeSoon) && m.onGround) {
      wantRight = true;
    }

    st.intent = {
      left:wantLeft,
      right:wantRight,
      jump:st.aiHold > 0,
      jumpHeld:st.aiHold > 0,
      speedBias:speedBias
    };
  };

  VisualizerGame.layer('mario', 'behavior', {
    packVersion: 2,
    key: 'mario',
    goals: [
      'run right at a readable platformer pace',
      'jump only from the ground',
      'clear gaps, pipes, blocks, and sparse enemies with real arcs',
      'time reachable enemy jumps so Mario lands on them from above',
      'modulate jump hold and run pressure to collect reachable coin routes',
      'stay within a camera-follow range without pinning the character to one screen coordinate'
    ],
    perception: [
      'gap distance ahead',
      'pipe or wall distance ahead',
      'enemy distance ahead',
      'enemy stomp arc timing and unsafe enemy avoidance',
      'coin and question-block vertical target timing',
      'block row distance above the run line',
      'screen position inside the camera window'
    ],
    policies: [
      'safety and level geometry decide jumps',
      'stomp enemies only when the physics arc can land from above',
      'commit briefly to reachable pickups, then abandon missed pickups and keep moving forward',
      'music can bias run pressure but cannot force double jumps or flight',
      'enemy spacing stays sparse enough to read as platform gameplay',
      'paused audio stops progression while preserving a small idle pose in rendering'
    ],
    musicInputsAllowed: ['energy','speedBias','phraseFamily'],
    update: B.update
  });

  if(typeof window !== 'undefined') window.MarioBehavior = B;
  else this.MarioBehavior = B;
})();
