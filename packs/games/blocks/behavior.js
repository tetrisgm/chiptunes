// BLOCKS autonomous behavior. Owns input/autoplay intent only; no rendering and no raw audio reads.
// Drives ONE faller (an active piece) on the shared full-width board — free to move/land anywhere across [0,COLS).
const BlocksBehavior = (function(){
  function update(ctx){
    var dt = ctx.dt || 0.016;
    var COLS = ctx.COLS || 10;
    var st = ctx.st;
    var F = ctx.faller || (st && st.pieces && st.pieces[0]);
    var IN = ctx.IN || {};
    var K = ctx.K || IN.keys || {};
    var act = !!ctx.act;
    var gStep = ctx.gStep || 0.5;
    var tryMove = ctx.tryMove;
    var tryRotate = ctx.tryRotate;
    var tryMoveBoard = ctx.tryMoveBoard || ctx.tryMove;        // board-only fallbacks (slip past a sibling that blocks a trek)
    var tryRotateBoard = ctx.tryRotateBoard || ctx.tryRotate;
    var hardDrop = ctx.hardDrop;
    var lockPiece = ctx.lockPiece;
    var computePlan = ctx.computePlan;
    var fx = ctx.fx || function(){};

    if (!st || !F || !F.piece) return;

    if (act){
      if (typeof IN.x === 'number'){
        F.lastTarget = Math.max(0, Math.min(COLS - 1, (IN.x * COLS) | 0));
      }
      F.shiftHold -= dt;
      F.softHold -= dt;

      if (K.left && F.shiftHold <= 0){
        if (tryMove(-1, 0, 0)) fx('tick');
        F.shiftHold = 0.10;
      } else if (K.right && F.shiftHold <= 0){
        if (tryMove(1, 0, 0)) fx('tick');
        F.shiftHold = 0.10;
      }
      if (!K.left && !K.right) F.shiftHold = 0;

      // UP = rotate (modern standard). Directional-only keyboard: no action key exists.
      if (K.up){
        if (!F._upHeld){
          if (tryRotate()) fx('blip');
          F._upHeld = true;
        }
      } else {
        F._upHeld = false;
      }

      if (K.down && F.softHold <= 0){
        if (tryMove(0, 1, 0)){
          st.score += 1;
          fx('tick', 5);
          F.lockT = 0;
        } else {
          lockPiece();
        }
        F.softHold = 0.05;
      }
      if (!K.down) F.softHold = 0;

      // Pointer tap = bonus rotate (mouse/touch extra; never required for play).
      if (IN.click && !F._upHeld){
        if (tryRotate()) fx('blip');
      }

      F.grav += dt;
      if (F.grav >= gStep){
        F.grav = 0;
        if (!tryMove(0, 1, 0)) lockPiece();
      }
      return;
    }

    if (!F.plan || F.planFor !== F.pieceCount) computePlan();
    F.lastTarget = F.plan ? F.plan.x : F.lastTarget;
    F.moveT += dt;
    if (F.moveT < st.moveStep) return;

    F.moveT = 0;
    // A faller may target ANY column (whole-board cooperation), so it often treks across the board and can meet a
    // sibling mid-air. Prefer a normal sibling-aware move (no overlap); if a sibling directly blocks the trek, SLIP
    // PAST it with a board-only move (a brief 1-frame overlap up top) so the piece still reaches its planned,
    // hole-free column instead of abandoning the plan and burying a hole. Only a real wall/board block settles it.
    if (F.plan && F.piece.r !== F.plan.r){
      if (tryRotate() || tryRotateBoard()) fx('blip');
      else F.plan.r = F.piece.r;
    } else if (F.plan && F.piece.x !== F.plan.x){
      var dirn = F.plan.x > F.piece.x ? 1 : -1;
      if (tryMove(dirn, 0, 0)) fx('tick');
      else if (tryMoveBoard(dirn)) fx('tick');            // sibling in the way -> slip past it
      else F.plan.x = F.piece.x;                           // wall/board blocks the path -> settle here
    } else {
      hardDrop();
    }
  }

  return {
    update: update
  };
})();

(function(){
  VisualizerGame.layer('blocks', 'behavior', {
    packVersion: 2,
    key: "blocks",
    goals: [
      "complete and score horizontal lines as the primary objective",
      "place pieces into safe wells only when that supports a line clear",
      "avoid holes when possible",
      "prefer immediate line clears over speculative setup",
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
      "keep placements deliberate and row-building; visual variety must never sabotage the run",
      "when paused, stop progression and keep only restrained idle animation"
    ],
    musicInputsAllowed: [
      "energy",
      "dangerBoost",
      "aggression",
      "chaos",
      "speedBias"
    ],
    ownedBy: "BlocksBehavior.update"
  });
})();
