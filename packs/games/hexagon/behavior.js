// SUPER HEXAGON autonomous behavior. AI intent only; no rendering and no raw audio reads.
var HexagonBehavior = (function(){
  function decideCursor(ctx){
    var st = ctx.st;
    var target = ctx.target;
    if(!st || !target) return null;

    var safeSectors = ctx.safeSectors;
    var angleForSector = ctx.angleForSector;
    var angleDist = ctx.angleDist;
    var closestSafeSector = ctx.closestSafeSector;
    if(typeof safeSectors !== 'function' || typeof angleForSector !== 'function' ||
      typeof angleDist !== 'function' || typeof closestSafeSector !== 'function') return null;

    var safe = safeSectors(target.mask);
    var best = safe[0];
    var bestScore = Infinity;
    for(var i = 0; i < safe.length; i++){
      var angle = angleForSector(safe[i], st.rot);
      var score = Math.abs(angleDist(angle, st.cursorA));
      if(ctx.next){
        var nextSafe = closestSafeSector(ctx.next.mask, angle, st.rot);
        score += Math.abs(angleDist(angleForSector(nextSafe, st.rot), angle)) * 0.72;
      }
      if(score < bestScore){
        bestScore = score;
        best = safe[i];
      }
    }

    return {
      targetAngle: angleForSector(best, st.rot),
      targetSector: best,
      score: bestScore
    };
  }

  return {
    decideCursor: decideCursor
  };
})();

(function(){
  VisualizerGame.layer('hexagon', 'behavior', {
    packVersion: 2,
    key: "hexagon",
    goals: [
      "rotate toward the safest sector in the nearest wall mask",
      "avoid over-correcting",
      "anticipate the next incoming wall mask",
      "keep motion legible at high tempo"
    ],
    perception: [
      "nearest wall masks",
      "incoming wall arcs",
      "rotation velocity",
      "safe angular corridors",
      "pattern cadence"
    ],
    policies: [
      "prefer readable Super Hexagon-style lane turns over random visualizer motion",
      "choose intent only; source cursor speed limits movement",
      "anticipate the next mask without teleporting between sectors",
      "when paused, stop progression and keep only restrained idle animation"
    ],
    musicInputsAllowed: [
      "energy",
      "dangerBoost",
      "aggression",
      "chaos",
      "speedBias"
    ],
    update:function(ctx){
      if(ctx && ctx.state) ctx.state.$hexagonBehaviorReady = true;
    }
  });
})();
