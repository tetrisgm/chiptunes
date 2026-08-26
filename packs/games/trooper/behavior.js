// TROOPER behavior: autonomous run-and-gun decisions. Music times shots, targets choose shots.
(function(){
  var B={};
  B.update=function(ctx){
    var st=ctx.state,h=st&&st.hero,input=ctx.IN||{},keys=input.keys||{};
    if(!h)return;
    if(input.active){
      // Directional-only controls: left/right run, up jumps (and aims up), down aims down.
      // Fire is AUTOMATIC while active: definition's spb-based h.shootCd gates the cadence.
      var ax=(keys.left?-1:0)+(keys.right?1:0),ay=keys.up?-1:(keys.down?1:0);
      st.intent={left:!!keys.left,right:!!keys.right,jump:!!keys.up,shoot:!(h.noShoot>0),aimX:ax||h.dir||1,aimY:ay,speedBias:1};
      return;
    }
    if(ctx.audio&&ctx.audio.paused){st.intent={left:false,right:false,jump:false,shoot:false,aimX:h.aimX||h.dir||1,aimY:h.aimY||0,speedBias:1};return;}
    var look=(typeof TrooperDefinition!=='undefined'&&TrooperDefinition.lookAhead)?TrooperDefinition.lookAhead(st):{};
    var dt=ctx.dt||.016,m=st.music||{};
    st.aiJumpCd=Math.max(0,(st.aiJumpCd||0)-dt);
    st.aiAimT=look.enemy?(st.aiAimT||0)+dt:0;
    var jump=(look.gap||look.bullet||look.blocked||look.platform||(look.enemy&&look.aimY<0&&h.onGround&&look.target&&look.target.x-h.x<82))&&h.onGround&&st.aiJumpCd<=0;
    if(jump)st.aiJumpCd=look.platform||look.blocked ? .38 : .28;
    var beatShot=!!m.fireAccent||(m.beat||0)>.58;
    // Divide the old target gate by 1.5 alongside the hero's firing cadence so
    // autonomous volleys are genuinely 50% more frequent.
    var measuredShot=look.enemy&&st.aiAimT>Math.max(.12,(m.spb||.36)*.413);
    var shoot=!!(look.enemy&&(beatShot||measuredShot)&&!(h.noShoot>0));
    if(shoot)st.aiAimT=0;
    var speedBias=(h.hurt>0?0.75:1)+(m.energy||0)*.22;
    if(look.platform||(look.target&&look.target.y<h.y-20))speedBias*=.92;
    st.intent={left:false,right:true,jump:jump,shoot:shoot,aimX:look.aimX||h.dir||1,aimY:look.aimY||0,speedBias:speedBias};
  };
  VisualizerGame.layer('trooper','behavior',{packVersion:3,key:'trooper',goals:['run right at arcade pace','jump gaps, bullets, blockers, and upper platforms','shoot soldiers, snipers, turrets, flyers, grenadiers, crawlers, jumpers, gunners, paratroopers, prone shooters, mortars, wall cannons, divers, and heavy soldiers in their actual lane','cover straight, high, and low lanes with every spread volley','slow slightly when committing to an upper route','break weapon crates while retaining the spread shot','keep pushing forward after obstruction instead of backing into loops'],perception:['gap ahead','solid obstruction ahead','upper platform ahead','enemy target vector','enemy bullet lane','hit recovery lockout'],policies:['directional-only player controls: left/right run, up jumps and aims up, down aims down','player fire is an automatic three-way spread at the hero fire-gate cadence','music raises firing timing only when a target exists','shots and bullets are capped','jumping stays grounded','targets across multiple panes are valid','post-hit recovery slows movement and prevents firing'],musicInputsAllowed:['energy','beat','fireAccent','spb'],update:B.update});
  if(typeof window!=='undefined')window.TrooperBehavior=B;else this.TrooperBehavior=B;
})();
