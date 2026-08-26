// CLIMBER autonomous behavior. AI intent only; no rendering and no raw audio reads.
var ClimberBehavior = (function(){
  function decideIntent(ctx){
    var st = ctx.st;
    var jm = ctx.jm;
    var U = ctx.U || 8;
    var A = ctx.A || (st && st.A) || { x:0, y:0, w:100, h:100 };
    var intent = { left:false, right:false, up:false, down:false, jump:false, face:(jm && jm.face) || 1 };
    if(!st || !jm || jm.dead > 0 || jm.win > 0) return intent;

    if(jm.onLadder){
      intent.up = true;
      return intent;
    }
    if(jm.jumping) return intent;

    var ladderIndex = typeof ctx.upLadder === 'function' ? ctx.upLadder(jm.tier) : -1;
    if(ladderIndex >= 0){
      var ladder = st.ladders[ladderIndex];
      var ladderX = typeof ctx.ladX === 'function' ? ctx.ladX(ladder) : (A.x + A.w * (ladder.fx || 0.5));
      if(jm.x < ladderX - 1.6 * U){
        intent.right = true;
        intent.face = 1;
      } else if(jm.x > ladderX + 1.6 * U){
        intent.left = true;
        intent.face = -1;
      } else {
        intent.up = true;
      }
    } else {
      var goalX = A.x + A.w * ((st.captive && st.captive.fx) || 0.62);
      if(jm.x < goalX - 1.6 * U){
        intent.right = true;
        intent.face = 1;
      } else if(jm.x > goalX + 1.6 * U){
        intent.left = true;
        intent.face = -1;
      }
    }

    for(var i = 0; i < st.barrels.length; i++){
      var barrel = st.barrels[i];
      if(!barrel || barrel.tier !== jm.tier || barrel.falling || barrel.release > 0) continue;
      var dx = barrel.x - jm.x;
      var approaching = barrel.dir * (-dx) > 0;
      if(approaching && Math.abs(dx) < 5.8 * U){
        intent.jump = true;
        intent.face = dx > 0 ? 1 : -1;
        break;
      }
    }

    return intent;
  }

  return {
    decideIntent: decideIntent
  };
})();

(function(){
  VisualizerGame.layer('climber', 'behavior', {
    packVersion: 2,
    key: "climber",
    goals: [
      "move toward ladders and goal",
      "time jumps over barrels",
      "climb when safe",
      "keep movement readable on sloped girders",
      "avoid barrel clusters without random pathfinding"
    ],
    perception: [
      "barrel lanes",
      "ladder openings",
      "girder slopes",
      "goal distance",
      "incoming barrel danger"
    ],
    policies: [
      "prefer readable classic-game motion over random visualizer motion",
      "produce intent only; rules own movement and collision",
      "jump only for incoming barrels on the current lane",
      "when paused, the runtime freezes progression and leaves only restrained idle animation"
    ],
    musicInputsAllowed: [
      "energy",
      "dangerBoost",
      "aggression",
      "chaos",
      "speedBias"
    ],
    update:function(ctx){
      if(ctx && ctx.state) ctx.state.$climberBehaviorReady = true;
    }
  });
})();
