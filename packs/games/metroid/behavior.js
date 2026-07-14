// METROID behavior: autonomous exploration. Music may time decisions, not invent them.
(function(){
  var B={};
  function doorAim(side,hero){
    if(side==='top')return 'up';
    if(side==='bottom')return 'down';
    if(side==='left')return 'left';
    if(side==='right')return 'right';
    return hero.dir<0?'left':'right';
  }
  B.update=function(ctx){
    var st=ctx.state,h=st&&st.hero,input=ctx.IN||{},keys=input.keys||{};
    if(!h)return;
    if(input.active){
      // Directional-only controls: up=jump, down=morph, left/right=run.
      // Beam fire is AUTOMATIC on the autopilot's musical cadence, still enemy/door-gated.
      var ulook=(typeof MetroidDefinition!=='undefined'&&MetroidDefinition.lookAhead)?MetroidDefinition.lookAhead(st):{};
      var udt=ctx.dt||.016,um=st.music||{};
      var uneed=!!(ulook.shootEnemy||ulook.shootDoor)&&!keys.down;
      st.userAimT=uneed?(st.userAimT||0)+udt:0;
      var ucadence=!!um.fireAccent||(um.beat||0)>.55||st.userAimT>Math.max(.16,(um.spb||.42)*.52);
      var autoShoot=uneed&&ucadence;
      if(autoShoot)st.userAimT=0;
      var autoAim=ulook.shootDoor?doorAim(ulook.doorSide,h):(ulook.enemyTarget?(ulook.enemyTarget.y<h.y-18?'up':(ulook.enemyTarget.x<h.x?'left':'right')):(h.dir<0?'left':'right'));
      st.intent={left:!!keys.left,right:!!keys.right,down:!!keys.down,morph:!!keys.down,jump:!!keys.up,shoot:!!(autoShoot||input.down),aim:keys.up?'up':(keys.down?'down':(autoShoot?autoAim:(h.dir<0?'left':'right'))),speedBias:1};
      return;
    }
    if(ctx.audio&&ctx.audio.paused){
      st.intent={left:false,right:false,down:false,morph:h.morph,jump:false,shoot:false,speedBias:1};
      return;
    }
    var look=(typeof MetroidDefinition!=='undefined'&&MetroidDefinition.lookAhead)?MetroidDefinition.lookAhead(st):{};
    var dt=ctx.dt||.016,m=st.music||{};
    st.aiJumpCd=Math.max(0,(st.aiJumpCd||0)-dt);
    var needShot=!!(look.shootEnemy||look.shootDoor);
    st.aiAimT=needShot?(st.aiAimT||0)+dt:0;
    if(look.tunnel)st.aiMorphT=Math.max(st.aiMorphT||0,.9);
    st.aiMorphT=Math.max(0,(st.aiMorphT||0)-dt);
    var nav=look.nav||null,navDx=nav?nav.x-(h.x+h.w*.5):80,navDy=nav?nav.y-(h.y+h.h*.5):0;
    var doorClose=look.door&&look.doorDist<54,doorVeryClose=look.door&&look.doorDist<36;
    var morph=look.tunnel||st.aiMorphT>0||(nav&&nav.action==='morph');
    if(nav&&nav.action==='unmorph')morph=false;
    var navAction=nav&&nav.action;
    var platformJump=!!(navAction==='jump'&&navDy<-10&&Math.abs(navDx)<44);
    var climbNeed=!!(nav&&navDy<-24&&Math.abs(navDx)<48);
    var emergencyGap=!!(look.gap&&Math.abs(navDx)<78);
    var jump=!morph&&(emergencyGap||platformJump||climbNeed)&&h.onGround&&st.aiJumpCd<=0;
    if(jump)st.aiJumpCd=.38;
    var beatShot=!!m.fireAccent||(m.beat||0)>.55;
    var measuredShot=st.aiAimT>Math.max(.16,(m.spb||.42)*.52);
    var shoot=!morph&&needShot&&(beatShot||measuredShot);
    if(shoot)st.aiAimT=0;
    var aim=look.shootDoor?doorAim(look.doorSide,h):(look.enemyTarget?(look.enemyTarget.y<h.y-18?'up':(look.enemyTarget.x<h.x?'left':'right')):(h.dir<0?'left':'right'));
    var right=navDx>7,left=navDx<-7;
    if(doorClose&&!look.doorOpen){right=false;left=false;}
    if(doorVeryClose&&look.doorSide==='top')jump=false;
    var dropThrough=!!(nav&&nav.action==='drop'&&navDy>12);
    if(dropThrough)jump=false;
    st.intent={left:left,right:right,down:morph,morph:morph,drop:dropThrough,jump:jump,jumpHigh:!!climbNeed,shoot:shoot,aim:aim,speedBias:.9+(m.energy||0)*.16};
  };
  VisualizerGame.layer('metroid','behavior',{packVersion:3,key:'metroid',goals:['move through bounded alien rooms','shoot hatches open before crossing room boundaries','follow vertical shaft waypoints','morph through low tunnels','jump through one-way platforms from below','fire only at doors or alien threats','collect energy orbs without stopping'],perception:['route waypoint','vertical climb target','low tunnel ahead','closed hatch side','enemy in beam lane'],policies:['music affects timing and pace only','morph ball is a real collision state','beam fire is enemy/door-gated','door proximity stops traversal until the hatch opens','hunter remains grounded and readable'],musicInputsAllowed:['energy','beat','fireAccent','spb'],update:B.update});
  if(typeof window!=='undefined')window.MetroidBehavior=B;else this.MetroidBehavior=B;
})();
