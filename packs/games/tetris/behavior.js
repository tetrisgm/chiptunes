// TETRIS autonomous behavior. Owns input/autoplay intent only; no rendering and no raw audio reads.
const TetrisBehavior = (function(){
  function update(ctx){
    var dt = ctx.dt || 0.016;
    var COLS = ctx.COLS || 10;
    var st = ctx.st;
    var IN = ctx.IN || {};
    var K = ctx.K || IN.keys || {};
    var act = !!ctx.act;
    var gStep = ctx.gStep || 0.5;
    var tryMove = ctx.tryMove;
    var tryRotate = ctx.tryRotate;
    var hardDrop = ctx.hardDrop;
    var lockPiece = ctx.lockPiece;
    var computePlan = ctx.computePlan;
    var fx = ctx.fx || function(){};

    if (!st || !st.piece) return;

    if (act){
      if (typeof IN.x === 'number'){
        st.lastTarget = Math.max(0, Math.min(COLS - 1, (IN.x * COLS) | 0));
      }
      st.shiftHold -= dt;
      st.softHold -= dt;

      if (K.left && st.shiftHold <= 0){
        if (tryMove(-1, 0, 0)) fx('tick');
        st.shiftHold = 0.10;
      } else if (K.right && st.shiftHold <= 0){
        if (tryMove(1, 0, 0)) fx('tick');
        st.shiftHold = 0.10;
      }
      if (!K.left && !K.right) st.shiftHold = 0;

      if (K.up || K.action){
        if (!st._upHeld){
          if (tryRotate()) fx('blip');
          st._upHeld = true;
        }
      } else {
        st._upHeld = false;
      }

      if (K.down && st.softHold <= 0){
        if (tryMove(0, 1, 0)){
          st.score += 1;
          fx('tick', 5);
          st.lockT = 0;
        } else {
          lockPiece();
        }
        st.softHold = 0.05;
      }
      if (!K.down) st.softHold = 0;

      if (IN.click){
        var guard = 0;
        while (st.piece.x < st.lastTarget && guard++ < COLS){ if (!tryMove(1, 0, 0)) break; }
        while (st.piece.x > st.lastTarget && guard++ < COLS){ if (!tryMove(-1, 0, 0)) break; }
        hardDrop();
      } else {
        st.grav += dt;
        if (st.grav >= gStep){
          st.grav = 0;
          if (!tryMove(0, 1, 0)) lockPiece();
        }
      }
      return;
    }

    if (!st.plan || st.planFor !== st.pieceCount) computePlan();
    st.lastTarget = st.plan ? st.plan.x : st.lastTarget;
    st.moveT += dt;
    if (st.moveT < st.moveStep) return;

    st.moveT = 0;
    if (st.plan && st.piece.r !== st.plan.r){
      if (tryRotate()) fx('blip');
      else st.plan.r = st.piece.r;
    } else if (st.plan && st.piece.x !== st.plan.x){
      var dirn = st.plan.x > st.piece.x ? 1 : -1;
      if (tryMove(dirn, 0, 0)) fx('tick');
      else st.plan.x = st.piece.x;
    } else {
      hardDrop();
    }
  }

  return {
    update: update
  };
})();

(function(){
  VisualizerGame.layer('tetris', 'behavior', {
    packVersion: 2,
    key: "tetris",
    goals: [
      "place pieces into safe wells",
      "avoid holes when possible",
      "clear lines opportunistically",
      "keep stack height under pressure",
      "prefer visually readable rotations"
    ],
    perception: [
      "board columns",
      "holes",
      "well depth",
      "piece shape",
      "landing scores",
      "danger height"
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
    ownedBy: "TetrisBehavior.update"
  });
})();
