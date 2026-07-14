// MEGA MAN 2 behavior: autonomous blue-robot runner intent.
(function(){
  var B={};
  B.update=function(ctx){
    var st=ctx.state,h=st&&st.hero,input=ctx.IN||{},keys=input.keys||{};
    if(!h) return;
    if(input.active){
      // Directional-only controls: up = jump (or climb at ladders), down = climb down.
      // Buster fire is AUTOMATIC on a steady tempo-synced cadence; pointer taps add extra shots.
      var um=st.music||{};
      st.userFireT=(st.userFireT||0)+(ctx.dt||0.016);
      var fireCad=Math.max(0.16,(um.spb||0.38)*0.5);
      var autoShoot=st.userFireT>=fireCad||!!um.fireAccent;
      if(autoShoot) st.userFireT=0;
      st.intent={left:!!keys.left,right:!!keys.right,up:!!keys.up,down:!!keys.down,jump:!!(keys.up||input.down),shoot:!!(autoShoot||input.click),speedBias:1};
      return;
    }
    if(ctx.audio&&ctx.audio.paused){ st.intent={left:false,right:false,up:false,down:false,jump:false,shoot:false,speedBias:1}; return; }
    var look=(typeof MegaMan2Definition!=='undefined'&&MegaMan2Definition.lookAhead)?MegaMan2Definition.lookAhead(st):{};
    var dt=ctx.dt||0.016;
    st.aiJumpCd=Math.max(0,(st.aiJumpCd||0)-dt);
    var lastX = st.aiLastX == null ? h.x : st.aiLastX;
    st.aiStuckT = Math.abs(h.x - lastX) < 0.25 && Math.abs(h.vx || 0) < 14 ? (st.aiStuckT || 0) + dt : 0;
    st.aiLastX = h.x;
    var ladderCenter = look.ladder ? (look.ladderX + 7) : 0;
    var heroCenter = h.x + h.w * 0.5;
    var ladderAligned = !!(look.ladder && Math.abs(heroCenter - ladderCenter) < 8);
    var routeNeedsLadder = !!(look.ladder && (look.mustClimb || look.upperPath || look.platformJump || (look.ladderTop && look.ladderTop < h.y - 18) || st.aiClimbT > 0));
    if(routeNeedsLadder && (h.onGround || h.climbing || ladderAligned || st.aiStuckT > 0.35)) st.aiClimbT=Math.max(st.aiClimbT||0,1.35);
    st.aiClimbT=Math.max(0,(st.aiClimbT||0)-dt);
    var climbUp=!!(routeNeedsLadder && ladderAligned && st.aiClimbT>0 && (!look.ladderTop || h.y+h.h>look.ladderTop+4));
    var alignLeft=!!(routeNeedsLadder && look.ladder && !ladderAligned && heroCenter > ladderCenter + 2);
    var alignRight=!!(routeNeedsLadder && look.ladder && !ladderAligned && heroCenter < ladderCenter - 2);
    var stuckJump=st.aiStuckT>0.42 && h.onGround && !routeNeedsLadder;
    var jump=((look.gap||look.wall||look.platformJump)||stuckJump)&&!routeNeedsLadder&&h.onGround&&st.aiJumpCd<=0;
    if(jump) st.aiJumpCd=0.34;
    var m=st.music||{};
    st.aiAimT=look.enemy?(st.aiAimT||0)+dt:0;
    var beatShot=!!m.fireAccent || (m.beat||0)>0.58;
    var measuredShot=look.enemy && st.aiAimT>Math.max(0.16,(m.spb||0.38)*0.55);
    var shoot=!!(look.enemy && (beatShot || measuredShot));
    if(shoot) st.aiAimT=0;
    if(climbUp && look.ladderTop && h.y+h.h<=look.ladderTop+5){ climbUp=false; st.aiClimbT=0; }
    st.intent={left:alignLeft,right:alignRight || (!climbUp && !alignLeft),up:climbUp,down:false,jump:jump&&!climbUp,shoot:shoot,speedBias:0.95+(m.energy||0)*0.22};
  };
  VisualizerGame.layer('mega_man_2','behavior',{packVersion:2,key:'mega_man_2',goals:['run right through compact industrial rooms','jump gaps and platforms with grounded arcs','climb only when the route requires an upper path','shoot readable enemies before collision'],perception:['gap ahead','solid obstruction ahead','enemy in firing corridor','required ladder and upper route','screen position'],policies:['music biases speed and fire cadence but never creates flight','ladders are ignored unless needed for traversal','enemy count stays sparse and readable','shots are capped'],musicInputsAllowed:['energy','beat','fireAccent'],update:B.update});
  if(typeof window!=='undefined') window.MegaMan2Behavior=B; else this.MegaMan2Behavior=B;
})();
