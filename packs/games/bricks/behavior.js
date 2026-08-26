// BRICKS autonomous behavior. Owns paddle intent only; no rendering and no raw audio reads.
const BricksBehavior = (function(){
  function aiTarget(st){
    var lead=null, best=-1e9;
    for(var i=0;i<st.balls.length;i++){
      var b=st.balls[i];
      var sc=(b.vy>0?1:0)*1e6 + b.y;   // prefer descending + lowest ball
      if(sc>best){ best=sc; lead=b; }
    }
    var center=st.ax+st.aw/2;
    if(!lead) return center;
    var innerL=st.ax+st.lw, innerR=st.ax+st.aw-st.lw;
    if(st.onPaddle){
      return focusX(st, lead.x);
    }
    if(lead.vy<=0){
      return Math.max(innerL+st.pw/2, Math.min(innerR-st.pw/2, lead.x));
    }

    var x=lead.x, y=lead.y, vx=lead.vx, vy=lead.vy;
    if(vy<=0.001) return lead.x;
    var planeY=st.py - lead.r;
    var guard=0;
    while(y<planeY && guard++<300){
      var tY=(planeY-y)/vy;
      var tX=Infinity;
      if(vx>0.001) tX=((innerR-lead.r)-x)/vx;
      else if(vx<-0.001) tX=((innerL+lead.r)-x)/vx;
      if(tX<tY && tX>0){ x+=vx*tX; y+=vy*tX; vx=-vx; }
      else { x+=vx*tY; y+=vy*tY; break; }
    }
    var landing=Math.max(innerL+lead.r, Math.min(innerR-lead.r, x));
    var dxCol=focusX(st, landing);
    var off=Math.max(-1,Math.min(1,(dxCol-landing)/(st.aw*0.5)));
    var target=landing - off*(st.pw*0.42);
    return Math.max(innerL+st.pw/2, Math.min(innerR-st.pw/2, target));
  }

  function aiServeAngle(st){
    var src=st.balls.length?st.balls[0].x:(st.ax+st.aw/2);
    var dx=focusX(st, src);
    var center=st.ax+st.aw/2;
    var d=(dx-center)/(st.aw*0.5);
    return Math.max(-0.6,Math.min(0.6, d*0.6));
  }

  function focusX(st, refx){
    var counts=new Array(st.cols);
    for(var c=0;c<st.cols;c++) counts[c]=0;
    var any=false;
    for(var i=0;i<st.bricks.length;i++){
      var br=st.bricks[i];
      if(br.a){ counts[br.gx]++; any=true; }
    }
    if(!any) return st.ax+st.aw/2;
    var bestC=-1,bestScore=-1e9;
    for(var c2=0;c2<st.cols;c2++){
      if(counts[c2]===0) continue;
      var cx=st.ax+st.lw+(c2+0.5)*st.brickW;
      var score=counts[c2]*10 - Math.abs(cx-refx)/st.brickW;
      if(score>bestScore){ bestScore=score; bestC=c2; }
    }
    if(bestC<0) return st.ax+st.aw/2;
    return st.ax+st.lw+(bestC+0.5)*st.brickW;
  }

  return {
    aiTarget: aiTarget,
    aiServeAngle: aiServeAngle,
    focusX: focusX
  };
})();

(function(){
  VisualizerGame.layer('bricks', 'behavior', {
    packVersion: 2,
    key: "bricks",
    goals: [
      "track ball intercept",
      "aim returns into dense brick fields",
      "recover from side bounces",
      "collect safe powerups",
      "keep multiball readable"
    ],
    perception: [
      "ball trajectory",
      "paddle target",
      "brick density",
      "powerup fall path",
      "danger of miss"
    ],
    policies: [
      "prefer readable brick-breaker paddle motion over random visualizer motion",
      "predict descending ball intercepts and steer returns toward full columns",
      "serve into the chosen focus column so the game keeps making progress",
      "launch one deterministic extra ball every one to three seconds while play is active",
      "leave ball physics and collision in the rules layer"
    ],
    musicInputsAllowed: [
      "energy",
      "dangerBoost",
      "aggression",
      "chaos",
      "speedBias"
    ],
    ownedBy: "BricksBehavior",
    aiTarget: BricksBehavior.aiTarget,
    aiServeAngle: BricksBehavior.aiServeAngle
  });
})();
