// SUPER HEXAGON pack definition. Pattern rules and simulation only; no canvas drawing and no raw audio reads.
const HexagonDefinition = (function(){
  var SIDES = 6;
  var FULL_MASK = (1 << SIDES) - 1;
  var TAU = Math.PI * 2;
  var SEC = TAU / SIDES;
  // RedTopper/Super-Haxagon's first HEXAGON level stores speedCursor as TAU/60 per
  // 60fps dilation frame, which is exactly one revolution per second.
  var SOURCE_CURSOR_SPEED_FRAME = 0.10471975803375244;
  var CURSOR_SPEED_RAD_PER_SEC = SOURCE_CURSOR_SPEED_FRAME * 60;
  // The source cursor speed is the hard movement budget. Keep pattern transitions
  // 20% roomier than the old 10% margin so autoplay and keyboard play do not
  // depend on last-frame lane snaps.
  var CURSOR_SAFETY = 1.32;
  var FASTEST_GRID_STEP_SECONDS = 60 / 240 / 4;
  var MIN_PATTERN_BREAK_STEPS = 4;
  var MAX_PATTERN_BREAK_STEPS = 9;
  var MAX_TRANSITION_STEPS = 15;

  function mod(n){ n = n % SIDES; return n < 0 ? n + SIDES : n; }
  function bit(s){ return 1 << mod(s); }
  function hasWall(mask, s){ return !!(mask & bit(s)); }
  function openMask(open){
    var mask = FULL_MASK;
    for(var i=0;i<open.length;i++) mask &= ~bit(open[i]);
    return mask;
  }
  function wallMask(walls){
    var mask = 0;
    for(var i=0;i<walls.length;i++) mask |= bit(walls[i]);
    return mask;
  }
  function shiftMask(mask, shift){
    var out = 0;
    for(var s=0;s<SIDES;s++) if(hasWall(mask, s)) out |= bit(s + shift);
    return out;
  }
  function C(s){ return openMask([s]); }                    // C-shaped part: one open side.
  function D(a,b){ return openMask([a,b]); }                 // two open sides.
  function W(){ return wallMask(Array.prototype.slice.call(arguments)); }
  function pattern(name, masks, cadence, spin, thick, breakSteps){
    return {
      name:name,
      masks:masks,
      cadence:cadence || 2,
      spin:spin || 0,
      thick:thick || 1,
      breakSteps:breakSteps || 4
    };
  }

  // Authored six-sided pattern families based on Super Hexagon guide vocabulary:
  // Solo, Triple C, Whirlpool, Bat, Ladder, Stair, 321, 2/3-spin, Rain/cap, and quick reversals.
  function pSolo(b,d){ return pattern('Solo', [
    C(b), C(b), D(b+d,b+d*2), C(b+d*3), C(b+d*3)
  ], 2, 0, 1.00); }
  function pTripleC(b,d){ return pattern('Triple C', [
    C(b), C(b+d*3), C(b), C(b+d*3), D(b+d,b+d*4)
  ], 2, 0, 1.02); }
  function pWhirlpool(b,d){ return pattern('Whirlpool', [
    C(b), C(b+d), C(b+d*2), C(b+d*3), C(b+d*4), C(b+d*5), C(b)
  ], 1, d*0.030, 0.92); }
  function pBat(b,d){ return pattern('Bat', [
    D(b,b+d*3), D(b+d,b+d*4), C(b+d*2), C(b+d*5), D(b+d,b+d*4)
  ], 2, 0, 0.96); }
  function pLadder(b,d){ return pattern('Ladder', [
    C(b), C(b+d), C(b), C(b+d), C(b+d*2), C(b+d)
  ], 2, 0, 1.00); }
  function pStair(b,d){ return pattern('Stair', [
    D(b,b+d*3), D(b+d,b+d*4), D(b+d*2,b+d*5), D(b+d*3,b), D(b+d*4,b+d)
  ], 2, d*0.012, 0.95); }
  function p321(b,d){ return pattern('321', [
    C(b), C(b+d*3), C(b+d), C(b+d*2), C(b+d*5), C(b+d*3), D(b+d*2,b+d*5)
  ], 1, 0, 0.92); }
  function pSpin2(b,d){ return pattern('2-Spin', [
    C(b), C(b+d*2), C(b), C(b+d*2), C(b+d*4), C(b+d*2)
  ], 1, d*0.022, 0.92); }
  function pSpin3(b,d){ return pattern('3-Spin', [
    C(b), C(b+d*3), C(b), C(b+d*3), C(b+d), C(b+d*4)
  ], 1, d*0.026, 0.92); }
  function pRain(b,d){ return pattern('Rain', [
    W(b), W(b+d*2), W(b+d*4), W(b+d,b+d*3), W(b+d*5), W(b+d*2,b+d*4)
  ], 1, 0, 0.74); }
  function pCap(b,d){ return pattern('Cap', [
    W(b,b+d), W(b+d*2,b+d*3), W(b+d*4,b+d*5), W(b+d,b+d*2), W(b+d*3,b+d*4)
  ], 1, d*0.010, 0.78); }
  function pStack(b,d){ return pattern('Stack', [
    C(b), C(b), C(b), C(b+d), C(b+d), C(b+d*2)
  ], 2, 0, 1.05); }
  function pReverse(b,d){ return pattern('Reverse', [
    C(b), C(b+d), C(b+d*2), C(b+d), C(b), C(b-d)
  ], 1, -d*0.018, 0.95); }
  function pQuickShift(b,d){ return pattern('Quick Shift', [
    C(b), C(b+d*2), C(b-d), C(b+d), D(b+d*3,b), C(b+d*4)
  ], 1, 0, 0.95); }
  function pOneWayOut(b,d){ return pattern('One Way Out', [
    C(b), C(b), C(b), C(b+d*3), C(b+d*3), C(b+d)
  ], 2, 0, 1.08); }

  // Keep every authored pattern eligible from the first spawn. Difficulty is
  // chosen by a flat tier roll, not by time survived or by section energy.
  // Movement safety lives in transitionCadence/patternBreakSteps.
  var PATTERN_ALL = [
    pSolo,
    pTripleC,
    pWhirlpool,
    pBat,
    pLadder,
    pStair,
    p321,
    pSpin2,
    pSpin3,
    pRain,
    pCap,
    pStack,
    pReverse,
    pQuickShift,
    pOneWayOut
  ];
  var PATTERN_TIERS = [
    [pSolo, pTripleC, pStack],
    [pBat, pLadder, pStair, pCap],
    [pWhirlpool, p321, pSpin2, pSpin3, pRain, pReverse, pQuickShift, pOneWayOut]
  ];

  function safeSectors(mask){
    var out = [];
    for(var s=0;s<SIDES;s++) if(!hasWall(mask,s)) out.push(s);
    if(!out.length) out.push(0);
    return out;
  }
  function sectorDist(a,b){
    var d = Math.abs(mod(a) - mod(b));
    return Math.min(d, SIDES - d);
  }
  function maskMoveSectors(fromMask, toMask){
    if(fromMask == null || toMask == null) return 0;
    var from = safeSectors(fromMask), to = safeSectors(toMask), worst = 0;
    for(var i=0;i<from.length;i++){
      var nearest = SIDES;
      for(var j=0;j<to.length;j++) nearest = Math.min(nearest, sectorDist(from[i], to[j]));
      worst = Math.max(worst, nearest === SIDES ? 0 : nearest);
    }
    return worst;
  }
  function angleForSector(s, rot){ return s * SEC + SEC * 0.5 + rot; }
  function angleDist(a,b){ return Math.atan2(Math.sin(a-b), Math.cos(a-b)); }
  function closestSafeSector(mask, angle, rot){
    var safe = safeSectors(mask), best = safe[0], bd = 999;
    for(var i=0;i<safe.length;i++){
      var d = Math.abs(angleDist(angleForSector(safe[i], rot), angle));
      if(d < bd){ bd = d; best = safe[i]; }
    }
    return best;
  }
  function cursorSector(st){
    var rel = (st.cursorA || 0) - (st.rot || 0);
    rel = ((rel % TAU) + TAU) % TAU;
    return Math.floor(rel / SEC) % SIDES;
  }
  function alignPatternToCursor(st, p){
    if(!st || !p || !p.masks || !p.masks.length) return p;
    var current = cursorSector(st);
    var first = safeSectors(p.masks[0]);
    var best = first[0], bestDist = SIDES;
    for(var i=0;i<first.length;i++){
      var d = sectorDist(first[i], current);
      if(d < bestDist){ bestDist = d; best = first[i]; }
    }
    var shift = mod(current - best);
    if(!shift) return p;
    var masks = [];
    for(i=0;i<p.masks.length;i++) masks.push(shiftMask(p.masks[i], shift));
    var out = pattern(p.name, masks, p.cadence, p.spin, p.thick, p.breakSteps);
    out.tier = p.tier;
    return out;
  }
  function randInt(n){
    return Math.max(0, Math.min((n|0)-1, Math.floor(Math.random() * Math.max(1, n|0))));
  }
  function choosePatternFromPool(pool, base, dir, avoidName){
    pool = pool && pool.length ? pool : PATTERN_ALL;
    var pick = null;
    for(var tries=0; tries<8; tries++){
      pick = pool[randInt(pool.length)](base, dir);
      if(pool.length <= 1 || pick.name !== avoidName) break;
    }
    return pick || pool[0](base, dir);
  }
  function patternChoice(st, F, force){
    var hi = (F.lead && typeof F.lead.hi === 'number') ? F.lead.hi : F.bright;
    if(typeof hi !== 'number') hi = 0.5;
    var tier = force === 'drop' ? 2 : randInt(PATTERN_TIERS.length);
    var base = mod(Math.floor(hi * SIDES) + randInt(SIDES));
    var dir = Math.random() < 0.5 ? -1 : 1;
    var p = choosePatternFromPool(PATTERN_TIERS[tier], base, dir, st.lastPatternName);
    p.tier = tier;
    return p;
  }

  function stepSecondsFromGrid(grid, bpm){
    var step = grid && typeof grid.step16 === 'number' && grid.step16 > 0 ? grid.step16 : 0;
    if(!step){
      var spb = grid && typeof grid.spb === 'number' && grid.spb > 0 ? grid.spb : (60 / Math.max(55, Math.min(240, bpm || 165)));
      step = spb / 4;
    }
    return Math.max(0.045, Math.min(0.35, step));
  }

  function transitionCadence(st, fromMask, toMask, baseCadence, stepSeconds, idle){
    var moveSectors = maskMoveSectors(fromMask, toMask);
    var effectiveCursor = Math.max(0.001, (st.cursorSpeed || CURSOR_SPEED_RAD_PER_SEC) - Math.abs(st.currentRotSpeed || 0));
    var travelSeconds = (moveSectors * SEC) / effectiveCursor;
    var scheduleStepSeconds = Math.min(Math.max(0.001, stepSeconds), FASTEST_GRID_STEP_SECONDS);
    var required = moveSectors > 0 ? Math.ceil((travelSeconds * CURSOR_SAFETY) / scheduleStepSeconds) : 1;
    var steps = Math.max(baseCadence || 1, required, idle ? 4 : 1);
    steps = Math.min(MAX_TRANSITION_STEPS, steps);
    if(st.spacingAudit && moveSectors > 0){
      st.spacingAudit.transitions++;
      st.spacingAudit.maxMoveSectors = Math.max(st.spacingAudit.maxMoveSectors, moveSectors);
      st.spacingAudit.minRatio = Math.min(st.spacingAudit.minRatio, (steps * scheduleStepSeconds) / Math.max(0.001, travelSeconds));
    }
    return steps;
  }

  function patternBreakSteps(p, F, idle){
    var e = Math.max(0, Math.min(1, F && F.energy == null ? 0.45 : (F ? F.energy : 0.45)));
    var base = p.breakSteps || 4;
    if(e < 0.32) base += 1;
    if(e > 0.76) base -= 1;
    if(idle) base += 1;
    return Math.max(MIN_PATTERN_BREAK_STEPS, Math.min(MAX_PATTERN_BREAK_STEPS, base | 0));
  }

  function enqueuePattern(st, F, EVENT, force){
    var p = alignPatternToCursor(st, patternChoice(st, F, force));
    st.patternSerial++;
    st.patternName = p.name;
    st.lastPatternName = p.name;
    st.lastPatternTier = p.tier == null ? null : p.tier;
    st.patternCadence = Math.max(1, p.cadence | 0);
    for(var i=0;i<p.masks.length;i++){
      st.patternQueue.push({
        mask:p.masks[i],
        cadence:p.cadence,
        spin:p.spin,
        thick:p.thick,
        name:p.name
      });
    }
    st.patternQueue.push({
      gap:true,
      fromMask:p.masks[p.masks.length - 1],
      cadence:patternBreakSteps(p, F, !!(F && F.idle && !F.paused)),
      name:p.name + ' break'
    });
    if(st.patternQueue.length > 64) st.patternQueue.splice(0, st.patternQueue.length - 64);
    if(EVENT) EVENT(force === 'drop' ? 'major' : 'medium', force === 'drop' ? 8 : 4, { name:p.name });
  }



  function makeState(A, U, variant){
      var st={};
      st.v=variant|0;
      st.U=U;
      st.t=0;
      st.flash=0;
      st.shake=0;
      st.hit=0;
      st.A={x:A.x,y:A.y,w:A.w,h:A.h};
      st.cx=A.x+A.w*0.5;
      st.cy=A.y+A.h*0.5;
      st.maxR=Math.min(A.w,A.h)*0.52;
      st.coreR=Math.max(3,Math.min(A.w,A.h)*0.06);
      st.rot=-Math.PI/2 + (st.v ? SEC * 0.5 : 0);
      st.rotBase=st.v===1 ? 0.18 : 0.24;
      st.thick=(st.v===1?2.35:2.0)*U;
      st.cursorR=st.maxR*0.30;
      st.cursorA=-Math.PI/2;
      st.cursorSpeed=CURSOR_SPEED_RAD_PER_SEC;
      st.rings=[];
      st.maxRings=26;
      st.clears=0;
      st.patternQueue=[];
      st.patternName='Solo';
      st.patternSerial=0;
      st.patternCadence=2;
      st.nextSpawnStep=null;
      st.lastPhrase=-1;
      st.huePhase=(variant||0)*56;
      st.hueFamily=0;
      st.sectorParity=0;
      st.ringSpeedBase=st.maxR*0.56;
      st.currentRotSpeed=0;
      st.wallSpeed=0;
      st.spacingAudit={ minRatio:Infinity, maxMoveSectors:0, transitions:0 };
      st.dropLatch=false;
      st.bgFlip=false;
      st.col={
        bg0:'#0b0220',
        bg1:'#15043a',
        cursor:'#fdf500',
        coreEdge:'#ffffff',
        hitFlash:'#ffffff'
      };
      return st;
    
  }

  function update(ctx){
    ctx = ctx || {};
    var dt = ctx.dt;
    var U = ctx.U || 8;
    var A = ctx.A || {x:0, y:0, w:0, h:0};
    var IN = ctx.IN || {};
    var SND = ctx.SND || {};
    var st = ctx.state || ctx.st;
      try{
        if(!st) return;
        dt=Math.min(dt||0.016, 0.05);
        st.t+=dt;
        U=st.U||U;
        var col=st.col;
        var cx=st.cx=A.x+A.w*0.5;
        var cy=st.cy=A.y+A.h*0.5;
        var maxR=st.maxR=Math.min(A.w,A.h)*0.52;
        st.coreR=Math.max(3,Math.min(A.w,A.h)*0.06);
        st.cursorR=maxR*0.30;
        st.thick=(st.v===1?2.35:2.0)*U;
        st.ringSpeedBase=maxR*0.56;

        function EVENT(c,i,o){ if(SND && typeof SND.event==='function') try{ SND.event(c,i,o); }catch(e){} }
        var audio = ctx.audio || {};
        var F = audio.raw || {};
        var grid = F.gr || {gstep:0,phase:0,beat:0,bar:0,spb:0.36,step16:0.09,bpm:165};
        var cl = F.cl || {};
        var bpm = Math.max(55, Math.min(240, F.bpm || grid.bpm || 165));
        var energy = Math.max(0, Math.min(1, F.energy == null ? 0.45 : F.energy));
        var beatPulse = Math.max(0, Math.min(1, F.beatPulse || 0));
        var paused = !!F.paused;
        var idle = !!F.idle && !paused;
        var logicDt = paused ? 0 : dt;
        var dropEdge = !!F.dropEdge || (F.drop && !st.dropLatch);
        st.dropLatch = !!F.drop;

        var phrase = F.phrase || 0;
        if(st.lastPhrase !== phrase){
          st.lastPhrase = phrase;
          st.hueFamily = ((phrase % 5) * 48) | 0;
          st.sectorParity = phrase % 3;
          st.flash = Math.max(st.flash, 0.24 + energy * 0.20);
        }
        if(dropEdge){
          st.bgFlip = !st.bgFlip;
          st.flash = Math.max(st.flash, 0.82);
          st.shake = Math.min(1, st.shake + 0.55);
          enqueuePattern(st, F, EVENT, 'drop');
        }

        var rotSpeed = st.rotBase * (bpm/150) * (1 + beatPulse*0.25 + (F.drop?0.18:0));
        st.currentRotSpeed = rotSpeed + (st.rings[0] && st.rings[0].spin ? st.rings[0].spin : 0);
        st.rot += st.currentRotSpeed * logicDt;
        if(st.rot > TAU) st.rot -= TAU;
        else if(st.rot < 0) st.rot += TAU;

        var targetSpeed = st.ringSpeedBase * (bpm/165) * (idle ? 0.35 : (0.66 + energy*0.48));
        if(!paused) targetSpeed = Math.max(targetSpeed, st.ringSpeedBase * 0.18);
        if(!st.wallSpeed) st.wallSpeed = targetSpeed;
        var speedEase = paused ? 0 : Math.min(1, logicDt * 2.6);
        st.wallSpeed += (targetSpeed - st.wallSpeed) * speedEase;
        var speed = st.wallSpeed;
        for(var i=0;i<st.rings.length;i++) st.rings[i].r -= speed * logicDt;

        var stepNow = Math.floor(grid.gstep || 0);
        var stepSeconds = stepSecondsFromGrid(grid, bpm);
        if(st.nextSpawnStep == null) st.nextSpawnStep = stepNow + 1;
        var spawnBudget = 0, processBudget = 0;
        if(!paused){
          while(stepNow >= st.nextSpawnStep && spawnBudget < 3 && processBudget < 8){
            if(st.patternQueue.length <= 0) enqueuePattern(st, F, EVENT, null);
            var part = st.patternQueue.shift();
            processBudget++;
            if(part){
              if(part.gap){
                if(st.patternQueue.length <= 0) enqueuePattern(st, F, EVENT, null);
                var afterGap = st.patternQueue[0];
                var gapCadence = Math.max(idle ? 5 : MIN_PATTERN_BREAK_STEPS, part.cadence || MIN_PATTERN_BREAK_STEPS);
                if(afterGap && !afterGap.gap){
                  gapCadence = Math.max(gapCadence, transitionCadence(st, part.fromMask, afterGap.mask, 1, stepSeconds, idle));
                }
                st.nextSpawnStep += gapCadence;
                continue;
              }
              if(st.patternQueue.length <= 0) enqueuePattern(st, F, EVENT, null);
              var nextPart = st.patternQueue[0];
              var cadence = nextPart && !nextPart.gap
                ? transitionCadence(st, part.mask, nextPart.mask, part.cadence || st.patternCadence || 2, stepSeconds, idle)
                : Math.max(idle ? 5 : MIN_PATTERN_BREAK_STEPS, part.cadence || MIN_PATTERN_BREAK_STEPS);
              var spawnR = maxR + st.thick*2.0;
              st.rings.push({
                mask:part.mask,
                r:spawnR,
                crossed:false,
                name:part.name,
                cadence:cadence,
                spin:part.spin,
                thickScale:part.thick || 1
              });
              if(st.rings.length > st.maxRings) st.rings.splice(0, st.rings.length - st.maxRings);
              st.nextSpawnStep += cadence;
              spawnBudget++;
            } else {
              st.nextSpawnStep += 2;
            }
          }
        }

        var target=null, next=null, targetR=1e9, nextR=1e9;
        for(i=0;i<st.rings.length;i++){
          var Rr=st.rings[i];
          if(Rr.crossed || Rr.r <= st.cursorR - st.thick*1.5) continue;
          if(Rr.r < targetR){
            next = target;
            nextR = targetR;
            targetR = Rr.r;
            target = Rr;
          } else if(Rr.r < nextR){
            nextR = Rr.r;
            next = Rr;
          }
        }

        var human = !!(IN && IN.active);
        if(human && IN.keys){
          var hs=st.cursorSpeed || CURSOR_SPEED_RAD_PER_SEC;
          if(IN.keys.left) st.cursorA -= hs*dt;
          if(IN.keys.right) st.cursorA += hs*dt;
        } else if(!human && target && !paused){
          var cursorIntent = HexagonBehavior.decideCursor({
            st:st,
            target:target,
            next:next,
            safeSectors:safeSectors,
            angleForSector:angleForSector,
            angleDist:angleDist,
            closestSafeSector:closestSafeSector
          });
          var targetA = cursorIntent ? cursorIntent.targetAngle : st.cursorA;
          var da = angleDist(targetA, st.cursorA);
          var aiSpeed = st.cursorSpeed || CURSOR_SPEED_RAD_PER_SEC;
          var step = aiSpeed * dt;
          if(Math.abs(da) <= step) st.cursorA = targetA;
          else st.cursorA += (da > 0 ? 1 : -1) * step;
        }
        if(st.cursorA > TAU) st.cursorA -= TAU;
        else if(st.cursorA < 0) st.cursorA += TAU;

        function cursorSectorIndex(){
          var rel = st.cursorA - st.rot;
          rel = ((rel % TAU) + TAU) % TAU;
          return Math.floor(rel / SEC) % SIDES;
        }

        var survived = true, crossedAny = false, nearMiss = false;
        if(!paused){
          for(i=st.rings.length-1;i>=0;i--){
            var R = st.rings[i], thick = st.thick * (R.thickScale || 1);
            if(!R.crossed && R.r <= st.cursorR && R.r > st.cursorR - thick*1.18){
              R.crossed = true;
              crossedAny = true;
              var si = cursorSectorIndex();
              if(hasWall(R.mask, si)) survived = false;
              else {
                var nearest = closestSafeSector(R.mask, st.cursorA, st.rot);
                var off = Math.abs(angleDist(angleForSector(nearest, st.rot), st.cursorA));
                nearMiss = nearMiss || off > SEC*0.34;
              }
            }
          }
        }
        if(!survived){
          st.hit = 0.42;
          st.flash = 1;
          st.shake = 1;
          st.rings.length = 0;
          st.patternQueue.length = 0;
          st.nextSpawnStep = stepNow + 2;
          st.wallSpeed = 0;
          st.spacingAudit={ minRatio:Infinity, maxMoveSectors:0, transitions:0 };
          EVENT('major', 9, { name:'crash' });
        } else if(crossedAny){
          st.clears++;
          EVENT(nearMiss ? 'medium' : 'minor', nearMiss ? 5 : 2, { name:target && target.name });
          st.flash = Math.max(st.flash, (nearMiss ? 0.24 : 0.09) * (0.55 + energy) * (F.drop ? 1.65 : 1));
          if(nearMiss) st.shake = Math.min(1, st.shake + 0.10);
        }

        if(st.rings.length >= 18 && !st.hype){ st.hype = true; EVENT('state',7,{name:'hype',on:true}); }
        else if(st.hype && st.rings.length <= 9){ st.hype = false; EVENT('state',5,{name:'hype',on:false}); }

        for(i=st.rings.length-1;i>=0;i--) if(st.rings[i].r <= st.coreR*0.55) st.rings.splice(i,1);

        try{
          if(SND && !paused){
            if(F.newBeat){ EVENT('minor',1); if(SND.lead) SND.lead((grid.spb||0.36)*0.5, 0.10); }
            if(crossedAny && survived && SND.lead) SND.lead((grid.spb||0.36)*0.5, nearMiss ? 0.18 : 0.12);
            if(SND.act) SND.act(Math.min(1, st.rings.length/18));
          }
        }catch(e){}

        st.flash = Math.max(0, st.flash - dt*3.0);
        st.shake = Math.max(0, st.shake - dt*3.5);
        st.hit = Math.max(0, st.hit - dt);

        st.huePhase = (st.huePhase + logicDt*(bpm/60)*18) % 360;
        ctx.hexagonView = {
          A:A,
          U:U,
          st:st,
          col:col,
          cx:cx,
          cy:cy,
          maxR:maxR,
          F:F,
          cl:cl,
          grid:grid,
          bpm:bpm,
          energy:energy,
          beatPulse:beatPulse,
          paused:paused,
          logicDt:logicDt
        };
      }catch(e){}
    
  }

  return {
    makeState: makeState,
    update: update,
    SIDES: SIDES,
    FULL_MASK: FULL_MASK,
    TAU: TAU,
    SEC: SEC,
    hasWall: hasWall
  };
})();

(function(){
  VisualizerGame.layer('hexagon', 'definition', {
    packVersion: 3,
    key: "hexagon",
    name: "SUPER HEXAGON",
    family: "radial dodger",
    description: "Radial survival game with six-sided authored wall patterns, rotating lanes, incoming wall arcs, gaps, and tunnel pulse.",
    source: "physical-pattern-pack",
    entities: [
      "playerCursor",
      "wallArc",
      "safeGap",
      "wallMask",
      "patternQueue",
      "ring",
      "tunnel",
      "spark",
      "dangerFlash"
    ],
    rules: [
      "radial rotation",
      "wall approach",
      "gap avoidance",
      "collision with arcs",
      "authored pattern sequencing",
      "cursor-speed-feasible lane transitions",
      "BPM-quantized breathers between pattern families",
      "mask-based sector collision",
      "speed ramp",
      "safe wrap"
    ],
    events: [
      "gapPassed",
      "nearMiss",
      "wallMaskSpawned",
      "patternChanged",
      "collisionAvoided",
      "dropTunnel"
    ],
    simulation: {
      timestep: "spawn decisions are locked to the shared 16th-note grid; transition cadence is clamped by the original one-revolution-per-second cursor speed plus safety margin",
      collision: "six-sector wall masks; render pulse never changes hit sectors",
      patternFamilies: [
        "Solo",
        "Triple C",
        "Whirlpool",
        "Bat",
        "Ladder",
        "Stair",
        "321",
        "2-Spin",
        "3-Spin",
        "Rain",
        "Cap",
        "Stack",
        "Reverse",
        "Quick Shift",
        "One Way Out"
      ],
      musicKnowledge: "normalized ctx.audio only; no raw bus reads",
      watchdog: { mode:"survival", progress:45, motion:10, loop:16 }
    },
    make: HexagonDefinition.makeState,
    update: HexagonDefinition.update
  });
})();
