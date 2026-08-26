// PLATFORMER behavior: autonomous intent only. No drawing and no raw audio reads.
(function(){
  function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }
  function groundY(st){
    return st && (st.groundY || (typeof PlatformerDefinition !== 'undefined' && PlatformerDefinition.GROUND_Y)) || 192;
  }
  function phys(){
    return (typeof PlatformerDefinition !== 'undefined' && PlatformerDefinition.PHYS) || {
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
    var lo=Math.min(fromX,toX),hi=Math.max(fromX,toX);
    for(var x=lo; x<=hi; x+=step){
      if(!groundCovers(st, x)) return true;
    }
    return false;
  }
  function hasBlockingSolidBefore(st, enemy){
    if(!st || !st.platformer || !enemy || typeof PlatformerDefinition === 'undefined' || !PlatformerDefinition.solidRects) return false;
    var m = st.platformer;
    var mCenter=m.x+m.w*0.5,eCenter=enemy.x+enemy.w*0.5;
    var minX=Math.min(mCenter,eCenter),maxX=Math.max(mCenter,eCenter);
    var solids = PlatformerDefinition.solidRects(st, minX-8, maxX+8);
    for(var i=0;i<solids.length;i++){
      var s = solids[i];
      if(s.kind === 'ground') continue;
      if(s.x+s.w <= minX+4 || s.x >= maxX-4) continue;
      if(s.y + s.h > m.y + 4) return true;
    }
    return false;
  }
  function estimateStompTime(st, enemy, hold, speedBias){
    var m = st.platformer;
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
    var m = st.platformer;
    var P = phys();
    var maxRun = (P.runCap || 190) * clamp(speedBias || 1, 0.82, 1.34);
    var runLift = clamp(Math.abs(m.vx || 0) / Math.max(1, maxRun), 0, 1);
    var vy = -((P.jumpMin || 304) + runLift * (P.jumpRunBonus || 44));
    var y = 0;
    var t = 0;
    var step = 1 / 180;
    var platformerAimY = aim === 'block' ? m.y + 2 : m.y + m.h * 0.50;
    var targetAimY = aim === 'block' ? target.y + target.h + 2 : target.y + target.h * 0.50;
    var targetRel = clamp(targetAimY - platformerAimY, -92, 12);
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
    var m = st.platformer;
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
        var timeToX = clamp((Math.abs(dx) - (aim === 'block' ? 1 : 3)) / projected, 0, 1.4);
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
  // --- enemy target lock -------------------------------------------------------------------
  // Platformer picks ONE enemy and keeps it until it dies or the lock is genuinely invalid. Re-scoring
  // every enemy every frame is what made him oscillate between a walker on his left and one on his
  // right: the two scores stayed within a hair of each other, so timing noise flipped the winner
  // frame after frame and he never committed to either.
  var ENEMY_LOCK_MAX = 2.4;          // hard cap on chasing one enemy (forward progress wins)
  var ENEMY_LOCK_BACK_MAX = 1.1;     // a backwards chase blocks the auto-run: give up much sooner
  var ENEMY_LOCK_MIN_DWELL = 0.3;    // no challenger is even looked at before this
  var ENEMY_STEAL_RATIO = 0.55;      // and then only if it is interposed at <55% of the distance
  var ENEMY_STEAL_MARGIN = 0.25;     // and clearly better scoring, never "marginally closer"
  var ENEMY_PASSED_SLACK = 18;       // target crossed to the far side by this much -> we passed it

  function enemyAlive(e){ return !!(e && !e.gone && !(e.squash > 0)); }
  // Same visible window the renderer culls enemies with (renderer.js: ex < -28 || ex > nativeW + 28),
  // minus the draw slack — an enemy the viewer cannot see is never a legal target.
  function enemyOnScreen(st, e){
    if(!st || !e) return false;
    var ex = e.x - (st.cameraX || 0);
    return ex > -(e.w || 16) && ex < (st.nativeW || 256);
  }
  function findEnemy(st, id){
    if(!id || !st || !st.enemies) return null;
    for(var i=0;i<st.enemies.length;i++){ if(st.enemies[i] && st.enemies[i].id === id) return st.enemies[i]; }
    return null;
  }
  function releaseEnemyLock(st, ignoreSeconds){
    if(ignoreSeconds && st.aiEnemyLockId) ignoreEnemy(st, st.aiEnemyLockId, ignoreSeconds);
    st.aiEnemyLockId = null; st.aiEnemyLockT = null; st.aiEnemyLockDir = 0;
  }
  // Age of the current lock. Never `||` this: a lock taken on frame one has aiEnemyLockT === 0,
  // and a falsy-zero fallback would freeze the age at 0 and make the give-up cap unreachable.
  function enemyLockAge(st){
    return (st.t || 0) - (st.aiEnemyLockT == null ? (st.t || 0) : st.aiEnemyLockT);
  }
  function takeEnemyLock(st, cand){
    st.aiEnemyLockId = cand.enemy.id;
    st.aiEnemyLockT = st.t || 0;
    st.aiEnemyLockDir = cand.dir;
  }
  // One enemy's stomp candidacy: legality (visible, alive, stompable, standing on readable ground with
  // no gap/solid between us) plus the best jump-arc timing. Returns null when it is not a legal target.
  function evalEnemyStomp(st, e, speedBias){
    if(!enemyAlive(e) || !enemyOnScreen(st, e)) return null;
    if(e.stompable === false) return null;
    var m = st.platformer;
    var gy = groundY(st);
    var mCenter = m.x + m.w * 0.5;
    var eCenter = e.x + e.w * 0.5;
    var dist = eCenter - mCenter;
    var absDist = Math.abs(dist), dir = dist < 0 ? -1 : 1;
    if(dist < -128 || dist > 196) return null;
    if(Math.abs((e.y + e.h) - gy) >= 18 || !groundCovers(st, eCenter)) return null;
    if(hasGapBefore(st, mCenter, eCenter - 4)) return null;
    if(hasBlockingSolidBefore(st, e)) return null;

    var closing = Math.max(112, Math.abs(m.vx || 0)*0.28 + (phys().runCap||190)*0.62 + Math.max(0,-dir*(e.vx||0)));
    var timeToEnemy = clamp((absDist - 1) / closing, 0, 1.35);
    var holds = [0.105, 0.155, 0.225];
    var best = null;
    for(var h=0; h<holds.length; h++){
      var arc = estimateStompTime(st, e, holds[h], speedBias);
      if(arc == null) continue;
      var error = Math.abs(timeToEnemy - arc);
      // Deterministic scoring, no randomness: arc-timing error first, then a nudge away from
      // point-blank targets and away from backtracking (he auto-runs right).
      var score = error + h * 0.012 + (absDist < 22 ? 0.16 : 0) + (dir < 0 ? 0.10 : 0);
      if(!best || score < best.score){
        best = { mode:'stomp', enemy:e, dist:dist, absDist:absDist, dir:dir, backtrack:dir<0,
          time:timeToEnemy, arc:arc, hold:holds[h], error:error, score:score };
      }
    }
    return best;
  }

  function planEnemyJump(st, audio, speedBias){
    if(!st || !st.platformer || !st.enemies) return null;
    var m = st.platformer;
    var mCenter = m.x + m.w * 0.5;
    var best = null;
    var nearestThreat = null;
    var i, e;

    // Threat scan for avoidance — visible enemies only; something off-screen cannot hit him.
    for(i=0;i<st.enemies.length;i++){
      e = st.enemies[i];
      if(!enemyAlive(e) || !enemyOnScreen(st, e)) continue;
      var d = (e.x + e.w * 0.5) - mCenter;
      if(d < 6 || d > 196) continue;
      if(!nearestThreat || d < nearestThreat.dist) nearestThreat = { enemy:e, dist:d };
    }

    // Hold the existing lock unless it is genuinely dead, invisible, passed, unreachable or stale.
    var locked = findEnemy(st, st.aiEnemyLockId);
    if(st.aiEnemyLockId && !enemyAlive(locked)) releaseEnemyLock(st, 0);           // stomped / culled
    else if(locked && !enemyOnScreen(st, locked)) releaseEnemyLock(st, 0);         // left the screen
    else if(locked && ignoredEnemy(st, locked.id)) releaseEnemyLock(st, 0);
    else if(locked){
      var lockedDist = (locked.x + locked.w * 0.5) - mCenter;
      var lockDir = st.aiEnemyLockDir || (lockedDist < 0 ? -1 : 1);
      if(lockedDist * lockDir < -ENEMY_PASSED_SLACK) releaseEnemyLock(st, 1.2);    // clearly passed it
      else if(enemyLockAge(st) > (lockDir < 0 ? ENEMY_LOCK_BACK_MAX : ENEMY_LOCK_MAX)) releaseEnemyLock(st, 3);
      else {
        best = evalEnemyStomp(st, locked, speedBias);
        if(!best) releaseEnemyLock(st, 0.9);        // no longer reachable -> drop it and move on
        else { best.dir = lockDir; best.backtrack = lockDir < 0; }   // frozen approach side: no in-place flip
      }
    }

    // Pick a target only when unlocked. A locked target can change hands ONLY to an enemy that is
    // interposed on the same side at well under half the distance and clearly better scoring, so a
    // marginally-closer twin can never steal the lock and steals can only ever shorten the chase.
    var stealLimit = best ? best.absDist * ENEMY_STEAL_RATIO : Infinity;
    if(!best || enemyLockAge(st) > ENEMY_LOCK_MIN_DWELL){
      var pick = null;
      for(i=0;i<st.enemies.length;i++){
        e = st.enemies[i];
        if(!e || (best && e === best.enemy)) continue;
        if(ignoredEnemy(st, e.id)) continue;        // gave up on this one recently; still avoided above
        var cand = evalEnemyStomp(st, e, speedBias);
        if(!cand || cand.absDist < 6) continue;
        if(best && !(cand.dir === best.dir && cand.absDist < stealLimit)) continue;
        if(!pick || cand.score < pick.score) pick = cand;
      }
      if(pick && (!best || pick.score < best.score - ENEMY_STEAL_MARGIN)){
        takeEnemyLock(st, pick);
        best = pick;
      }
    }

    if(best && best.time > 0.06 && best.error < 0.30){
      var untilJump = best.time - best.arc;
      best.jumpNow = untilJump <= 0.065 || best.time < best.arc + 0.105;
      best.waiting = !best.jumpNow;
      best.hold = best.hold + (best.error > 0.11 ? 0.035 : 0);
      return best;
    }
    if(best){
      best.mode='hunt';best.jumpNow=false;best.waiting=true;
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
  function ignoreEnemy(st, id, seconds){ if(!id) return; st.aiEnemyIgnore = st.aiEnemyIgnore || {}; st.aiEnemyIgnore[id] = (st.t || 0) + (seconds || 2.5); }
  function ignoredEnemy(st, id){ return !!(id && st.aiEnemyIgnore && st.aiEnemyIgnore[id] > (st.t || 0)); }
  function planCollectible(st, audio, speedBias){
    if(!st || !st.platformer) return null;
    var m = st.platformer;
    var mCenter = m.x + m.w * 0.5;
    var best = null;

    function consider(plan){
      if(!plan) return;
      if(!best || plan.priority < best.priority || (plan.priority===best.priority && plan.score < best.score)) best = plan;
    }

    // Stars outrank everything: route toward a live star so the hero grabs the invincibility power-up.
    if(st.stars){
      for(var s=0;s<st.stars.length;s++){
        var star = st.stars[s];
        if(!star || star.got || star.pop > 0) continue;
        if(ignoredCollect(st, star.id)) continue;
        var stx = star.x + star.w * 0.5;
        var sdx = stx - mCenter;
        if(sdx < -150 || sdx > 280) continue;
        if(sdx > 0 && hasGapBefore(st, mCenter, stx - 4)) continue;
        if(sdx < 0 && hasGapBefore(st, stx + 4, mCenter)) continue;
        var sHigh = star.y < m.y - 12;
        var sArc = sHigh ? solveCollectArc(st, star, sdx, 'coin', speedBias) : null;
        consider({
          kind:'star',
          priority:0,
          id:star.id,
          ref:star,
          dx:sdx,
          score:Math.abs(sdx) * 0.3 - 80,
          backtrack:sdx < -8,
          slow:false,
          jumpNow:!!(sArc && sArc.jumpNow),
          waiting:!!(sArc && sArc.waiting),
          speedScale:1.12,
          high:sHigh,
          hold:sArc ? sArc.hold : 0.12,
          targetRel:sArc ? sArc.targetRel : 0
        });
      }
    }

    if(st.coins){
      for(var i=0;i<st.coins.length;i++){
        var c = st.coins[i];
        if(!c || c.got || c.pop > 0) continue;
        if(ignoredCollect(st, c.id)) continue;
        var cx = c.x + c.w * 0.5;
        var dx = cx - mCenter;
        if(dx < -128 || dx > 210) continue;
        if(dx > 0 && hasGapBefore(st, mCenter, cx - 4)) continue;
        if(dx < 0 && hasGapBefore(st,cx+4,mCenter))continue;
        var high = c.y < m.y - 10;
        var close = Math.abs(dx) < (high ? 54 : 24);
        var arcPlan = high ? solveCollectArc(st, c, dx, 'coin', speedBias) : null;
        if(high && !arcPlan && dx > 10) continue;
        var backtrack=dx < -8;
        var score = Math.abs(dx) * 0.52 + Math.max(0, m.y - c.y) * 0.18 + (backtrack ? 8 : 0) - (high ? 12 : 0);
        if(arcPlan) score += arcPlan.score * 58 + (arcPlan.waiting ? 5 : 0);
        consider({
          kind:'coin',
          priority:1,
          id:c.id,
          ref:c,
          dx:dx,
          score:score,
          backtrack:backtrack,
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
        if(bdx < -96 || bdx > 190) continue;
        if(bdx > 0 && hasGapBefore(st, mCenter, bx - 4)) continue;
        if(bdx < 0 && hasGapBefore(st,bx+4,mCenter))continue;
        if(block.y > m.y - 24 || block.y < m.y - 112) continue;
        var blockArc = solveCollectArc(st, block, bdx, 'block', speedBias);
        if(!blockArc && bdx > 8) continue;
        consider({
          kind:'question',
          priority:2,
          id:block.id,
          ref:block,
          dx:bdx,
          score:Math.abs(bdx) * 0.34 - 34 + (blockArc ? blockArc.score * 48 : 30),
          backtrack:bdx < -8,
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
    if(!st || !st.platformer) return false;
    var m = st.platformer;
    var mCenter = m.x + m.w * 0.5;
    if(plan.kind === 'star'){
      if(plan.ref.got || plan.ref.pop > 0) return false;
      var stx = plan.ref.x + plan.ref.w * 0.5;
      return stx - mCenter > -170 && stx - mCenter < 300;
    }
    if(plan.kind === 'coin'){
      if(plan.ref.got || plan.ref.pop > 0) return false;
      var cx = plan.ref.x + plan.ref.w * 0.5;
      return cx - mCenter > -136 && cx - mCenter < 220;
    }
    if(plan.kind === 'question'){
      if(plan.ref.used || plan.ref.broken) return false;
      var bx = plan.ref.x + plan.ref.w * 0.5;
      return bx - mCenter > -104 && bx - mCenter < 200;
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

    var unsafeBacktrack = plan.backtrack && hasGapBefore(st, plan.ref.x+plan.ref.w*0.5, st.platformer.x+st.platformer.w*0.5);
    if(unsafeBacktrack || (plan.backtrack && Math.abs(plan.dx) > 136)){
      st.aiObjective = { kind:'forward', until:t + 0.62 };
      return null;
    }

    var commit = plan.kind === 'question' ? 1.35 : (plan.backtrack?1.15:0.92);
    if(plan.backtrack)st.aiTurnbacks=(st.aiTurnbacks||0)+1;
    st.aiObjective = { kind:plan.kind, id:plan.id, plan:plan, until:t + commit };
    return plan;
  }

  var B = {};

  B.update = function(ctx){
    var st = ctx.state;
    if(!st || !st.platformer) return;

    var input = ctx.IN || {};
    var keys = input.keys || {};
    var m = st.platformer;
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

    var look = (typeof PlatformerDefinition !== 'undefined' && PlatformerDefinition.lookAhead) ? PlatformerDefinition.lookAhead(st) : {};
    var speedBias = clamp(music.speedBias || 1, 0.84, 1.28);
    var screenX = m.x - (st.cameraX || 0);
    var wantRight = true;
    var wantLeft = false;

    if(screenX > Math.min(164, st.nativeW * 0.68) && m.vx > 84) speedBias *= 0.82;
    if(screenX < Math.min(76, st.nativeW * 0.31)) speedBias *= 1.14;

    var enemyPlan = planEnemyJump(st, audio, speedBias);
    var enemyObjective=!!(enemyPlan && (enemyPlan.mode==='stomp'||enemyPlan.mode==='hunt'));
    if(enemyPlan && enemyPlan.mode === 'stomp'){
      if(enemyPlan.waiting && enemyPlan.time > enemyPlan.arc + 0.12) speedBias *= 1.04;
      else if(enemyPlan.waiting) speedBias *= 0.96;
    } else if(enemyPlan && enemyPlan.mode === 'hunt'){
      speedBias *= 0.92;
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
    var collectPlan = enemyObjective ? null : planCollectible(st, audio, speedBias);
    var committedCollect = enemyObjective ? null : commitPlan(st, collectPlan, ctx.dt || 0.016, enemyPlan, dangerousGap, pipeSoon, wallSoon);
    if(enemyObjective){
      st.aiObjective={kind:'enemy',id:enemyPlan.enemy&&enemyPlan.enemy.id,until:(st.t||0)+0.8};
      wantLeft=enemyPlan.dir<0;wantRight=!wantLeft;
    }
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
    st.aiFocus=enemyObjective?'enemy':(collectActive?collectPlan.kind:'progress');
    var forwardSafety=wantRight&&!wantLeft;
    var jumpWindow = enemyNeedsAvoid || (forwardSafety&&(pipeSoon || wallSoon || dangerousGap || (blockNear && m.onGround && Math.abs(m.vx) > 68))) || (collectActive && collectPlan.jumpNow);
    var highJump = dangerousGap || pipeSoon || wallSoon || (blockNear && m.onGround) || (collectActive && collectPlan.high) || (enemyPlan && enemyPlan.mode === 'avoid' && enemyPlan.dist < 34);

    st.aiJumpLock = Math.max(0, (st.aiJumpLock || 0) - (ctx.dt || 0.016));
    st.aiHold = Math.max(0, (st.aiHold || 0) - (ctx.dt || 0.016));
    var blockedClose = forwardSafety && m.onGround && (look.wall < 18 || look.pipe < 18) && Math.abs(m.vx) < 18;
    var hardStopNear = forwardSafety && (look.wall < 22 || look.pipe < 22);
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
    if(st.aiBack > 0 && !enemyObjective && !collectActive){
      wantLeft = true;
      wantRight = false;
      st.aiHold = 0;
    } else if(st.aiForceRight > 0 && !enemyObjective && !collectActive) {
      wantLeft = false;
      wantRight = true;
      speedBias = Math.max(speedBias, 1.05);
    } else if((wallSoon || pipeSoon) && m.onGround && !wantLeft) {
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

  VisualizerGame.layer('platformer', 'behavior', {
    packVersion: 2,
    key: 'platformer',
    goals: [
      'route toward and collect a star power-up ahead of coins and question blocks whenever no enemy demands attention',
      'hunt and eliminate every safely reachable stompable enemy before prioritizing forward progress',
      'collect reachable coins before pursuing question blocks or empty ground',
      'hit reachable question blocks before resuming forward progress',
      'jump only from the ground',
      'clear gaps, pipes, blocks, and sparse enemies with real arcs',
      'time reachable enemy jumps so Platformer lands on them from above',
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
      'enemy targets outrank coins, question blocks, and empty forward progress',
      'stomp enemies only when the physics arc can land from above, but turn back to hunt safe targets',
      'coins outrank question blocks; both allow safe backtracking and longer objective commitments',
      'music can bias run pressure but cannot force double jumps or flight',
      'enemy spacing stays sparse enough to read as platform gameplay',
      'paused audio stops progression while preserving a small idle pose in rendering'
    ],
    musicInputsAllowed: ['energy','speedBias','phraseFamily'],
    update: B.update
  });

  if(typeof window !== 'undefined') window.PlatformerBehavior = B;
  else this.PlatformerBehavior = B;
})();
