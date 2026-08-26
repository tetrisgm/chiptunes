// SQUADRON autonomous behavior contract. AI intent only; no rendering and no raw audio reads.
const SquadronBehavior = (function(){
  function rowPitch(row){
    return (4 - (row | 0)) * 2;
  }

  function updateShip(ctx){
    var dt = ctx.dt;
    var U = ctx.U;
    var A = ctx.A;
    var IN = ctx.IN || {};
    var st = ctx.st;
    var keys = ctx.keys || IN.keys || {};
    var sfx = ctx.sfx || function(){};
    var EVENT = ctx.EVENT || function(){};
    var x0 = A.x, y0 = A.y, W = A.w, H = A.h;
    var sh = st.ship;
    var hitRad = ctx.hitRad;
    var hitX = ctx.hitX;
    var newEighth = !!ctx.newEighth;
    var minX = x0 + W * 0.16;
    var maxX = x0 + W * 0.84;
    var human = !!IN.active;

    if (!sh.alive){
      sh.respawn -= dt;
      if (sh.respawn <= 0){
        sh.alive = true;
        sh.x = x0 + W * 0.5;
        sh.tx = sh.x;
        sh.invuln = 1.4;
      }
    } else {
      if (sh.invuln > 0) sh.invuln -= dt;
      if (sh.fireGate > 0) sh.fireGate -= dt;
    }

    var lowestDiver = null;
    var lowestDiverY = -1e9;
    for (var di = 0; di < st.divers.length; di++){
      var d0 = st.divers[di];
      if (st.challenge && d0.phase < 0) continue;
      if (d0.y > lowestDiverY){
        lowestDiverY = d0.y;
        lowestDiver = d0;
      }
    }

    var dangerBomb = null;
    var dangerBombDist = 1e9;
    for (var bi = 0; bi < st.bombs.length; bi++){
      var bm = st.bombs[bi];
      if (bm.y < sh.y - U * 0.5){
        var dxb = Math.abs(bm.x - sh.x);
        var pdist = dxb + (sh.y - bm.y) * 0.15;
        if (pdist < dangerBombDist){
          dangerBombDist = pdist;
          dangerBomb = bm;
        }
      }
    }

    var fireNow = false;

    if (human && sh.alive){
      if (keys.left) sh.tx -= W * 0.95 * dt;
      else if (keys.right) sh.tx += W * 0.95 * dt;
      else if (typeof IN.x === 'number' && (IN.down || IN.x !== 0.5)){
        sh.tx = x0 + Math.max(0, Math.min(1, IN.x)) * W;
      }
      // DIRECTIONAL-ONLY controls: firing is AUTOMATIC while the player steers (classic
      // arcade-autoplay feel). Cadence is unchanged — sh.fireGate (0.22s) and the bullet
      // cap below already gate the rate. No action key / click is ever required.
      fireNow = true;
    } else if (sh.alive){
      var aimX = sh.x;
      var mustDodge = false;
      var dodgeDir = 0;

      if (dangerBomb && Math.abs(dangerBomb.x - sh.x) < hitRad * 1.6 && dangerBomb.y > sh.y - H * 0.4){
        mustDodge = true;
        dodgeDir = dangerBomb.x > sh.x ? -1 : 1;
      }
      if (!mustDodge && lowestDiver && lowestDiver.y > sh.y - H * 0.32 && Math.abs(lowestDiver.x - sh.x) < hitRad * 1.8){
        mustDodge = true;
        dodgeDir = lowestDiver.x > sh.x ? -1 : 1;
      }

      if (mustDodge){
        aimX = sh.x + dodgeDir * W * 0.4;
        st.aiTarget = null;
      } else {
        var tgt = st.aiTarget;
        var live = tgt && tgt.alive && st.formation.indexOf(tgt) >= 0;
        if (!live){
          var best = null;
          var bestScore = -1e9;
          for (var fi = 0; fi < st.formation.length; fi++){
            var en = st.formation[fi];
            if (!en.alive) continue;
            var sc = en.y * 4 - Math.abs(en.x - sh.x);
            if (sc > bestScore){
              bestScore = sc;
              best = en;
            }
          }
          st.aiTarget = best;
          tgt = best;
        }
        if (tgt) aimX = tgt.x;
        else if (lowestDiver) aimX = lowestDiver.x;
        else aimX = x0 + W * 0.5;
      }

      sh.tx = Math.abs(aimX - sh.x) < hitRad * 0.5 ? sh.x : aimX;

      var tol = U + hitX;
      var overhead = false;
      for (var oh = 0; oh < st.formation.length && !overhead; oh++){
        var eo = st.formation[oh];
        if (eo.alive && eo.y < sh.y && Math.abs(eo.x - sh.x) < tol) overhead = true;
      }
      for (var od = 0; od < st.divers.length && !overhead; od++){
        var dOver = st.divers[od];
        if (st.challenge && dOver.phase < 0) continue;
        if (dOver.y < sh.y && Math.abs(dOver.x - sh.x) < tol) overhead = true;
      }
      // Fire on the ship's own cadence (fireGate, 0.22s) whenever a target is overhead — NOT gated on
      // the composer's musical eighth-note grid. That grid barely advances on the MP3-driven broadcast,
      // so the old `newEighth` gate left the ship parked under a live target it never shot (still + silent).
      if (overhead && sh.fireGate <= 0) fireNow = true;
    }

    if (sh.tx < minX) sh.tx = minX;
    if (sh.tx > maxX) sh.tx = maxX;
    sh.y = y0 + H * 0.82;
    var shipSpd = W * 0.42;
    var sdx = sh.tx - sh.x;
    var smv = shipSpd * dt;
    if (Math.abs(sdx) <= smv) sh.x = sh.tx;
    else sh.x += sdx > 0 ? smv : -smv;

    if (fireNow && sh.alive && sh.fireGate <= 0 && st.bullets.length < 8){
      st.bullets.push({ x: sh.x - U * 1.0, y: sh.y - U * 1.6, vy: -H * 2.0 });
      st.bullets.push({ x: sh.x + U * 1.0, y: sh.y - U * 1.6, vy: -H * 2.0 });
      sh.fireGate = 0.22;
      sfx('blip', 0);
      EVENT('minor', 2);
    }
  }

  function killShip(ctx){
    var st = ctx.st;
    var sh = ctx.sh;
    var SND = ctx.SND || {};
    var EVENT = ctx.EVENT || function(){};

    sh.alive = false;
    sh.lives = Math.max(0, sh.lives - 1);
    sh.respawn = 1.0;
    sh.invuln = 0;
    st.flash = 0.6;
    st.flashCol = '#ff3030';
    if (st.bursts.length < 24) st.bursts.push({ x: sh.x, y: sh.y, t: 0 });
    if (SND && SND.fx) SND.fx('death', 0);
    EVENT('major', 8);
    if (st._danger){
      st._danger = false;
      EVENT('state', 6, { name: 'danger', on: false });
    }
    if (sh.lives <= 0){
      sh.lives = 3;
      st.score = 0;
      st.wave = 0;
      st.waveSpeed = 1;
      st.bombs.length = 0;
      st.divers.length = 0;
      if (st.buildFormation) st.buildFormation();
    }
  }

  return {
    rowPitch: rowPitch,
    updateShip: updateShip,
    killShip: killShip
  };
})();

(function(){
  VisualizerGame.layer('squadron', 'behavior', {
    packVersion: 2,
    key: "squadron",
    goals: [
      "track open lanes",
      "shoot safe targets",
      "dodge incoming shots",
      "prioritize diving enemies",
      "keep ship centered after danger"
    ],
    perception: [
      "enemy formation",
      "incoming shot lanes",
      "safe horizontal gaps",
      "dive timing",
      "screen bounds"
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
    ownedBy: "SquadronBehavior.updateShip / SquadronBehavior.killShip"
  });
})();
