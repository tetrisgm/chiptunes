// GALAGA pack definition. Owns formation rules, shots, collisions, and wave progression.
// Renderer consumes ctx.galagaView from this layer; raw bus reads stay centralized in VisualizerGame.
const GalagaDefinition = (function(){
  function make(A, U, variant){
    var v = variant | 0;
    var challenge = v === 1; // variant 1 = non-shooting "challenging stage" sweeper wave
    var cols = 12;                    // LARGER pattern (more ships) — generously spaced so sprites never touch
    var gx = U * 6.4, gy = U * 5.8;   // spacing > sprite footprint (~5.6U at peak pulse) => clear gaps, easy to read
    var topY = A.y + A.h * 0.07;
    var startX = A.x + A.w * 0.5 - (cols - 1) * gx * 0.5;

    var st = {
      v: v, challenge: challenge,
      t: 0, breathe: 0,
      sway: 0, swayDir: 1,
      flash: 0, flashCol: '#ffffff',
      stars: [],
      formation: [],
      divers: [],
      bullets: [],   // player shots (up)
      bombs: [],      // enemy shots (down)
      bursts: [],
      cols: cols, gx: gx, gy: gy, topY: topY, startX: startX,
      wave: 0,
      waveSpeed: 1,          // ramps up each wave
      diveGate: 1.2,        // gate until next alien peels off to dive
      sweepGate: 0.6,       // challenge-stage spawn gate
      sweepIdx: 0,
      // player ship
      ship: {
        x: A.x + A.w * 0.5, tx: A.x + A.w * 0.5,
        y: A.y + A.h * 0.82,
        alive: true, lives: 3, respawn: 0, invuln: 0,
        fireGate: 0
      },
      score: 0,
      // AI memory
      aiFireWish: 0,
      win: 0              // brief win banner duration
    };

    // ---- starfield ----
    var nStars = 48;
    for (var i = 0; i < nStars; i++){
      var tint;
      if (challenge){
        var pr = Math.random();
        tint = pr < 0.5 ? '#b070ff' : (pr < 0.78 ? '#ffffff' : (pr < 0.9 ? '#ff5a8a' : '#7a9bff'));
      } else {
        var r = Math.random();
        tint = r < 0.55 ? '#ffffff' : (r < 0.78 ? '#5a8cff' : (r < 0.9 ? '#ff4040' : '#ffd040'));
      }
      st.stars.push({
        x: A.x + Math.random() * A.w,
        y: A.y + Math.random() * A.h,
        sp: 24 + Math.random() * 70,
        sz: Math.random() < 0.3 ? 2 : 1,
        c: tint, tw: Math.random() * 6.28, on: true,
        warm: Math.random() < 0.5, hoff: (Math.random() * 120) | 0   // half the stars take the shifting bar hue
      });
    }

    // ---- build first wave formation ----
    // 8 formation SHAPES (masks over an 11x7 grid) — a random one is picked each wave, so the
    // swarm is a block / two blocks / pyramid / inverted pyramid / three triangles / diamond /
    // hourglass / ring instead of always the same rectangle.
    var GW = 11, GH = 7, GCX = 5;
    var SHAPES = [
      function(c,r){ return r<5 && c>=1 && c<=GW-2; },                              // 0 block
      function(c,r){ return r<5 && (c<=3 || c>=GW-4); },                            // 1 two blocks
      function(c,r){ return r<6 && Math.abs(c-GCX) <= r; },                         // 2 pyramid (point up)
      function(c,r){ return r<6 && Math.abs(c-GCX) <= (5-r); },                     // 3 inverted pyramid
      function(c,r){ var ctr=[2,5,8]; for(var k=0;k<3;k++){ var d=Math.abs(c-ctr[k]), dp=(k===1)?(3-r):r; if(r<4 && dp>=0 && d<=Math.min(dp,1)) return true; } return false; }, // 4 three triangles (middle inverted)
      function(c,r){ return (Math.abs(c-GCX) + Math.abs(r-3)) <= 4; },              // 5 diamond
      function(c,r){ return r<=3 ? Math.abs(c-GCX) <= (3-r) : Math.abs(c-GCX) <= (r-3); }, // 6 hourglass / figure-8
      function(c,r){ var dx=c-GCX, dy=(r-3)*1.5, d=Math.sqrt(dx*dx+dy*dy); return (d<=3.6 && d>=1.9) || (c===GCX && r===3); } // 7 big ring + core
    ];
    function buildFormation(shapeIdx){
      st.formation.length = 0;
      var sx0 = A.x + A.w * 0.5 - (GW - 1) * gx * 0.5;   // centre the shape grid
      // phrase picks the shape when given; otherwise random (wave clears)
      var sid = (shapeIdx == null) ? ((Math.random() * SHAPES.length) | 0) : (((shapeIdx % SHAPES.length) + SHAPES.length) % SHAPES.length);
      var mask = SHAPES[sid];
      st.shapeId = sid;
      for (var r=0; r<GH; r++) for (var c=0; c<GW; c++){
        if (!mask(c,r)) continue;
        var type = r<=1 ? 'boss' : (r<=3 ? 'butterfly' : 'bee');
        st.formation.push({ type:type, row:r, col:c,
          hx:sx0+c*gx, hy:topY+r*gy, x:sx0+c*gx, y:topY+r*gy,
          alive:true, phaseDelay:1+Math.random()*3 });
      }
      if (!st.formation.length){   // safety: never spawn an empty wave
        for (var c2=2;c2<=8;c2++) st.formation.push({type:'bee',row:2,col:c2,hx:sx0+c2*gx,hy:topY+2*gy,x:sx0+c2*gx,y:topY+2*gy,alive:true,phaseDelay:2});
      }
    }
    st.buildFormation = buildFormation;
    buildFormation();

    return st;
  
  }

  function update(ctx){
    ctx = ctx || {};
    var dt = ctx.dt;
    var U = ctx.U || 8;
    var A = ctx.A || { x:0, y:0, w:0, h:0 };
    var IN = ctx.IN || {};
    var SND = ctx.SND || {};
    var st = ctx.state || ctx.st;
    if (!st) return;

    if (!(dt > 0)) dt = 0.016;
    if (dt > 0.05) dt = 0.05;
    st.t += dt;
    st.breathe += dt;
    if (st.flash > 0) st.flash -= dt * 3.2;
    if (st.win > 0) st.win -= dt;

    // guards
    IN = IN || {};
    var keys = IN.keys || {};
    SND = SND || {};
    var snote = SND.note ? function(d, du, ve){ SND.note(d, du, ve); } : function(){};
    var sfx = SND.fx ? function(n, s){ SND.fx(n, s || 0); } : function(){};
    function EVENT(c,i,o){ if(SND && typeof SND.event==='function') try{ SND.event(c,i,o); }catch(e){} }

    var x0 = A.x, y0 = A.y, W = A.w, H = A.h;
    var espx = Math.max(1, (U * 0.6) | 0);
    var hitRad = espx * 4.2;
    var hitX = espx * 2.3, hitY = espx * 1.6;   // TIGHT bullet<->enemy hitbox: a shot only bursts when genuinely over an enemy (not in empty space beside/below it)

    // ---- MUSIC CLOCK: beat drives FIRING + enemy PULSE; bar drives SWAY + the colour palette ----
    var audio = ctx.audio || {};
    var raw = audio.raw || {};
    var cl = raw.cl || {};   // MV clock snapshot, read once by shared runtime
    var energyMV = audio.energy == null ? MV.energy(cl) : audio.energy;
    var dropMV = audio.drop == null ? MV.isDrop(cl) : !!audio.drop;
    var GRID = raw.gr || {gstep:0, phase:0, beat:0, bar:0, bpm:116};
    var VIS  = raw.vis || {pulse:audio.beatStrength || 0, hue:0.5, energy:energyMV};
    // PHRASE = VARIATION: when the phrase changes, rebuild the formation in a phrase-STABLE shape.
    if (st._lastPhrase == null) st._lastPhrase = (cl.phrase||0);
    if ((cl.phrase||0) !== st._lastPhrase){
      st._lastPhrase = (cl.phrase||0);
      st._phraseShape = MV.pidx(cl, 8);          // pick a formation SHAPE for this phrase (0..7)
      if (st.buildFormation) st.buildFormation(st._phraseShape);   // re-form swarm into the new silhouette
      st.flash = Math.max(st.flash, 0.3); st.flashCol = st.challenge ? '#9040ff' : '#60d0ff';   // phrase-change shimmer
    }
    var barF = (GRID.gstep + (GRID.phase||0)) / 16;            // continuous bar position
    var barHue = barF * 50;                                    // palette rotates with the BAR (like Pac-Man)
    var newBeat = (st._lastBeat !== GRID.beat); st._lastBeat = GRID.beat;
    var g8 = GRID.gstep >> 1, newEighth = (st._lastG8 !== g8); st._lastG8 = g8;
    if (newBeat){ st.beatPulse = 1; st.flash = Math.max(st.flash, 0.10); if (typeof shake !== 'undefined') shake = Math.min(1, shake + 0.3); }
    st.beatPulse = Math.max(0, (st.beatPulse || 0) - dt * 5);
    var bp = st.beatPulse || 0;
    // BEAT = PULSE: enemies swell on the beat; stronger swell on drops (MV.isDrop), scaled by section energy
    var swellAmt = (dropMV ? 0.42 : 0.28) * (0.6 + energyMV * 0.6);

    // ---- formation sway (left-right) locked to the BAR + gentle breathe ----
    st.sway = Math.sin(barF * Math.PI / 2) * U * 2.4;          // one full left-right sway per 4 bars
    var br = 1 + Math.sin(barF * Math.PI) * 0.05;

    // ============================================================
    // PLAYER / AI INPUT
    // ============================================================
    var sh = st.ship;
    GalagaBehavior.updateShip({
      dt: dt,
      U: U,
      A: A,
      IN: IN,
      st: st,
      keys: keys,
      hitRad: hitRad,
      hitX: hitX,
      newEighth: newEighth,
      sfx: sfx,
      EVENT: EVENT
    });

    // ============================================================
    // WAVE LOGIC
    // ============================================================
    var aliveCount = 0;
    for (var fc = 0; fc < st.formation.length; fc++) if (st.formation[fc].alive) aliveCount++;

    // A CHALLENGE stage (variant 1) loops its sweeps endlessly, so it never satisfies the kill-everything win below — it used to
    // idle the FULL 30s scene duration every time ("takes forever"). Give it a bounded run: after ~12s the stage ENDS (bonus tally),
    // fires st.win, and the scene rotates on the normal "beaten" path — same cadence as the standard wave.
    if (st.challenge) st.chTime = (st.chTime || 0) + dt;
    var challengeOver = st.challenge && (st.chTime || 0) > 12;

    // WIN: wave cleared (or a challenge stage's time is up) -> fanfare, next wave (faster)
    if ((aliveCount === 0 && st.divers.length === 0) || challengeOver){
      // fanfare: ascending arpeggio
      sfx('fanf', 0); sfx('fanf', 4); sfx('fanf', 7);
      snote(7, 0.18, 0.5); snote(11, 0.2, 0.5);
      EVENT('major', 9);        // wave cleared -> big payoff
      EVENT('state', 8, {name:'danger', on:false});   // wave done -> any swarm danger ends
      st.flash = 0.7; st.flashCol = st.challenge ? '#9040ff' : '#ffffff';
      st.win = 1.0;
      st.wave++;
      st.waveSpeed = Math.min(1.7, 1 + st.wave * 0.10);   // gentler aggression ramp
      if (st.buildFormation) st.buildFormation(st._phraseShape);   // keep this phrase's silhouette across waves
      st.bombs.length = 0;
      st.diveGate = 2.4 / st.waveSpeed;
      st.sweepGate = 0.5;
      st.sweepIdx = 0;
      st.chTime = 0;        // reset the challenge clock for the next stage
    }

    // ============================================================
    // ENEMIES
    // ============================================================
    if (st.challenge){
      // ===== CHALLENGING STAGE: non-shooting looping sweep waves =====
      st.sweepGate -= dt;
      if (st.sweepGate <= 0 && st.divers.length < 26){
        st.sweepGate = (1.3 - Math.min(0.6, st.wave * 0.08)) / st.waveSpeed;
        // pull a batch of living formation members into a curved sweep
        var pool0 = [];
        for (var fp = 0; fp < st.formation.length; fp++) if (st.formation[fp].alive) pool0.push(fp);
        if (pool0.length){
          var side = (st.sweepIdx % 2) === 0 ? -1 : 1;
          var startEdgeX = side < 0 ? (x0 - U * 4) : (x0 + W + U * 4);
          var entryY = y0 + H * 0.18 + (st.sweepIdx % 3) * U * 3;
          var n = Math.min(6, pool0.length);
          for (var k = 0; k < n; k++){
            var slotIdx = pool0[k];
            var en = st.formation[slotIdx];
            en.alive = false; // it's now flying the sweep
            st.divers.push({
              type: en.type, home: slotIdx, sweep: true,
              phase: -k * 0.16,
              speed: (0.20 + Math.random() * 0.05) * st.waveSpeed,
              side: side, entryY: entryY,
              ex: startEdgeX, amp: U * 4 + Math.random() * U * 3,
              x: startEdgeX, y: entryY, returns: true
            });
          }
          sfx('dive', 0);
          if (!st._danger){ st._danger = true; EVENT('state', 6, {name:'danger', on:true}); }   // sweep swarm bearing down
          st.sweepIdx++;
        }
      }
      for (var d = st.divers.length - 1; d >= 0; d--){
        var dv = st.divers[d];
        dv.phase += dv.speed * dt;
        var p = dv.phase;
        if (p < 0){ dv.x = dv.ex; dv.y = dv.entryY; }
        else if (p > 1.15){
          // sweep complete -> return to its formation slot (so wave can be cleared by shooting)
          var slot = st.formation[dv.home];
          if (slot) slot.alive = true;
          st.divers.splice(d, 1); continue;
        } else {
          var travel = p;
          var sX2 = dv.side < 0 ? (x0 - U * 3) : (x0 + W + U * 3);
          var eX2 = dv.side < 0 ? (x0 + W + U * 3) : (x0 - U * 3);
          dv.x = sX2 + (eX2 - sX2) * travel;
          dv.y = dv.entryY + Math.sin(travel * Math.PI * 3) * dv.amp + Math.sin(travel * Math.PI) * U * 2;
        }
        dv.ang = Math.cos(dv.phase * 6) * 0.3;
      }

    } else {
      // ===== STANDARD WAVE: formation + peel-off dives + bombs =====
      // dive gate -> an alien dives
      st.diveGate -= dt;
      if (st.diveGate <= 0 && st.divers.length < 5 && aliveCount > 2){   // keep the last 1-2 in formation = always clearable
        st.diveGate = (2.8 + Math.random() * 1.6) / st.waveSpeed;   // dives much less often
        // prefer peeling from the bottom rows (zako) like the real game,
        // bosses dive less often
        var pool = [];
        for (var fp2 = 0; fp2 < st.formation.length; fp2++){
          var ee = st.formation[fp2];
          if (!ee.alive) continue;
          var weight = ee.type === 'boss' ? 1 : (ee.type === 'butterfly' ? 2 : 3);
          for (var wq = 0; wq < weight; wq++) pool.push(fp2);
        }
        if (pool.length){
          var pick = pool[(Math.random() * pool.length) | 0];
          var en2 = st.formation[pick];
          en2.alive = false; // flying now
          st.divers.push({
            type: en2.type, home: pick, sweep: false,
            t: 0, dur: (3.4 + Math.random() * 0.8) / (0.7 + st.waveSpeed * 0.3),   // slower, more readable dives
            sx: en2.x, sy: en2.y,
            dir: Math.random() < 0.5 ? -1 : 1,
            x: en2.x, y: en2.y,
            bombAt: 0.3 + Math.random() * 0.4, // fraction of dive when it drops a bomb
            bombed: false
          });
          sfx('dive', 0); // descending whoosh
          EVENT('minor', 3);   // enemy peels into a dive
          if (st.divers.length >= 3 && !st._danger){ st._danger = true; EVENT('state', 6, {name:'danger', on:true}); }   // heavy dive-bomb swarm
        }
      }

      // formation update
      var cxF = x0 + W * 0.5;
      for (var f = 0; f < st.formation.length; f++){
        var en3 = st.formation[f];
        en3.x = cxF + (en3.hx - cxF) * br + st.sway;
        en3.y = st.topY + (en3.hy - st.topY) * br;
      }

      // divers update (swoop down curved toward the ship, drop a bomb, loop home)
      for (var di2 = st.divers.length - 1; di2 >= 0; di2--){
        var dvr = st.divers[di2];
        dvr.t += dt;
        var u = dvr.t / dvr.dur;
        if (u >= 1){
          var slot2 = st.formation[dvr.home];
          if (slot2) slot2.alive = true; // returned to formation
          st.divers.splice(di2, 1);
          continue;
        }
        var homeSlot = st.formation[dvr.home];
        var hx = homeSlot ? homeSlot.x : dvr.sx;
        var hy = homeSlot ? homeSlot.y : dvr.sy;
        var prevX = dvr.x, prevY = dvr.y;
        if (u < 0.55){
          var uu = u / 0.55;
          var ang = uu * Math.PI * 2.2 * dvr.dir;
          // curve down and drift toward the ship's column, like a real strafing dive
          var curveX = dvr.sx + Math.sin(ang) * W * 0.30 + dvr.dir * uu * W * 0.12;
          dvr.x = curveX + (sh.x - curveX) * (uu * uu * 0.5);
          dvr.y = dvr.sy + uu * H * 0.66 + Math.sin(uu * Math.PI) * H * 0.06;
        } else {
          var vv = (u - 0.55) / 0.45;
          var lowX = dvr.sx + Math.sin(Math.PI * 2.2 * dvr.dir) * W * 0.30 + dvr.dir * W * 0.12;
          lowX = lowX + (sh.x - lowX) * 0.5;
          var lowY = dvr.sy + H * 0.66;
          dvr.x = lowX + (hx - lowX) * vv;
          dvr.y = lowY + (hy - lowY) * (vv * vv);
        }
        // drop a bomb partway down the dive => BOMB sound
        if (!dvr.bombed && u >= dvr.bombAt && u < 0.85 && dvr.y < y0 + H * 0.8 && st.bombs.length < 10){
          dvr.bombed = true;
          var aimAt = sh.x;
          var bvx = Math.max(-W * 0.5, Math.min(W * 0.5, (aimAt - dvr.x) * 0.8));
          st.bombs.push({ x: dvr.x, y: dvr.y, vy: H * 1.0, vx: bvx * 0.4 });
          sfx('bomb', 0);
          EVENT('minor', 3);   // enemy drops a bomb
        }
        var vang = Math.atan2(dvr.y - prevY, (dvr.x - prevX) || 0.0001) - Math.PI / 2;
        // keep rotation gentle/clamped
        if (vang > 1.2) vang = 1.2; if (vang < -1.2) vang = -1.2;
        dvr.ang = vang * 0.5;
      }
    }

    // danger mode reconciles to the sky: the swarm threat ends once nobody is diving
    if (st._danger && st.divers.length === 0){ st._danger = false; EVENT('state', 4, {name:'danger', on:false}); }

    // ============================================================
    // PLAYER BULLETS update + collision (alien hit => explosion, pitch by row)
    // ============================================================
    for (var b = st.bullets.length - 1; b >= 0; b--){
      var bl = st.bullets[b];
      var bly0 = bl.y; bl.y += bl.vy * dt;   // remember pre-move y for SWEPT collision (fast bullets tunnel otherwise)
      if (bl.y < y0 - U){ st.bullets.splice(b, 1); continue; }

      var hit = false;
      // formation hits
      for (var ce = 0; ce < st.formation.length; ce++){
        var EN = st.formation[ce];
        if (!EN.alive) continue;
        if (Math.abs(EN.x - bl.x) < hitX && EN.y <= bly0 + hitY && EN.y >= bl.y - hitY){
          EN.alive = false; hit = true;
          if (st.bursts.length < 24) st.bursts.push({ x: EN.x, y: EN.y, t: 0, e: energyMV });
          if (typeof shake !== 'undefined') shake = Math.min(1, shake + 0.16 + energyMV * 0.16);   // kill punch scaled by energy
          sfx('boom', GalagaBehavior.rowPitch(EN.row));         // explosion, pitch by row
          snote(GalagaBehavior.rowPitch(EN.row), 0.1, 0.4);
          EVENT('medium', EN.type === 'boss' ? 6 : 4);   // enemy destroyed (boss = bigger)
          st.score += 10;
          break;
        }
      }
      // diver hits
      if (!hit){
        for (var cd = 0; cd < st.divers.length; cd++){
          var DV2 = st.divers[cd];
          if (st.challenge && DV2.phase < 0) continue;
          if (Math.abs(DV2.x - bl.x) < hitX && DV2.y <= bly0 + hitY && DV2.y >= bl.y - hitY){
            if (st.bursts.length < 24) st.bursts.push({ x: DV2.x, y: DV2.y, t: 0, e: energyMV });
            // killing a diver removes it from formation permanently (its home stays empty)
            sfx('pop', DV2.sweep ? 2 : 0);
            sfx('boom', 4);
            snote(9, 0.1, 0.45);
            EVENT('medium', 5);   // diving enemy destroyed
            st.score += 20;
            st.divers.splice(cd, 1);
            hit = true; break;
          }
        }
      }
      // PENETRATING shots: a bullet is NOT consumed on a hit — the enemy explodes but the bullet KEEPS TRAVELLING up,
      // killing whatever else is in its path. It is removed ONLY when it flies off the top of the screen (above).
    }

    // ============================================================
    // ENEMY BOMBS update + collision with ship
    // ============================================================
    for (var bb = st.bombs.length - 1; bb >= 0; bb--){
      var bm = st.bombs[bb];
      bm.y += bm.vy * dt;
      bm.x += (bm.vx || 0) * dt;
      if (bm.y > y0 + H + U){ st.bombs.splice(bb, 1); continue; }
      // hit ship
      if (sh.alive && sh.invuln <= 0 &&
          Math.abs(bm.x - sh.x) < hitRad * 0.8 && Math.abs(bm.y - sh.y) < hitRad * 0.8){
        GalagaBehavior.killShip({ st: st, sh: sh, SND: SND, U: U, EVENT: EVENT });
        st.bombs.splice(bb, 1);
        continue;
      }
    }

    // ============================================================
    // DIVER -> SHIP collision (a diver crashing into you kills you)
    // ============================================================
    if (sh.alive && sh.invuln <= 0){
      for (var dc = 0; dc < st.divers.length; dc++){
        var DD = st.divers[dc];
        if (st.challenge && DD.phase < 0) continue;
        if (Math.abs(DD.x - sh.x) < hitRad * 0.9 && Math.abs(DD.y - sh.y) < hitRad * 0.9){
          if (st.bursts.length < 24) st.bursts.push({ x: DD.x, y: DD.y, t: 0 });
          st.divers.splice(dc, 1);
          GalagaBehavior.killShip({ st: st, sh: sh, SND: SND, U: U, EVENT: EVENT });
          break;
        }
      }
    }

    // ---- bursts (starburst explosion) ----
    for (var bu = st.bursts.length - 1; bu >= 0; bu--){
      var BU = st.bursts[bu];
      BU.t += dt;
      if (BU.t > 0.42){ st.bursts.splice(bu, 1); continue; }
    }

    ctx.galagaView = {
      dt: dt,
      bp: bp,
      barHue: barHue,
      barF: barF,
      energy: energyMV,
      swellAmt: swellAmt,
      VIS: VIS
    };

  }

  return {
    make: make,
    update: update
  };
})();

(function(){
  VisualizerGame.layer('galaga', 'definition', {
    packVersion: 2,
    key: "galaga",
    name: "GALAGA",
    family: "fixed shooter",
    description: "Formation shooter with enemy rows, dives, shots, stars, and explosions.",
    source: "split-pack-definition-rules",
    entities: [
      "playerShip",
      "alien",
      "formationSlot",
      "enemyShot",
      "playerShot",
      "star",
      "explosion",
      "captureBeam",
      "scoreText"
    ],
    rules: [
      "horizontal player movement",
      "formation occupancy",
      "dive paths",
      "shot collision",
      "enemy destruction",
      "wave refill",
      "capture beam threat"
    ],
    events: [
      "enemyDived",
      "enemyDestroyed",
      "shotFired",
      "nearMiss",
      "formationRebuilt",
      "captureBeam",
      "waveCleared"
    ],
    simulation: {
      timestep: "dt-clamped local update behind shared runtime",
      collision: "owned by GalagaDefinition.update",
      musicKnowledge: "normalized ctx.audio only; no raw clock reads"
    },
    make: GalagaDefinition.make,
    update: GalagaDefinition.update
  });
})();
