// EXCITEBIKE behavior: autonomous rider keeps speed, changes lanes, hits ramps, and avoids bikes/mud.
(function(){
  var B={};
  B.update=function(ctx){
    var st=ctx.state,b=st&&st.bike,input=ctx.IN||{},keys=input.keys||{};
    if(!b)return;
    if(input.active){
      var target=b.targetLane;
      if(keys.up)target=Math.max(0,target-1);
      if(keys.down)target=Math.min(3,target+1);
      st.intent={targetLane:target,up:false,down:false,throttle:!!(keys.right||input.down),engineBrake:!!keys.left};
      return;
    }
    if(ctx.audio&&ctx.audio.paused){
      st.intent={targetLane:b.targetLane,up:false,down:false,throttle:false,engineBrake:true};
      return;
    }
    var look=(typeof ExcitebikeDefinition!=='undefined'&&ExcitebikeDefinition.lookAhead)?ExcitebikeDefinition.lookAhead(st):{targetLane:b.targetLane};
    var m=st.music||{};
    st.intent={
      targetLane:look.targetLane,
      up:false,down:false,
      throttle:b.heat<.86 || !!look.ramp,
      engineBrake:b.heat>.72 && !look.ramp,
      speedBias:1+(m.energy||0)*.18
    };
  };
  VisualizerGame.layer('excitebike','behavior',{
    packVersion:2,key:'excitebike',
    goals:['keep motocross pace high','change lanes before mud and opponent bikes','seek readable ramps and tabletops','ease the engine before overheating','land without breaking lane logic'],
    perception:['upcoming mud by lane','upcoming opponent bike by lane','upcoming ramp by lane','engine heat','current airborne state'],
    policies:['lane choice is authored and sparse, not random clutter','music raises pressure but does not invalidate bike physics','rider remains on a motorbike at all times'],
    musicInputsAllowed:['energy','beat','rampPulse','bpm'],update:B.update
  });
  if(typeof window!=='undefined')window.ExcitebikeBehavior=B;else this.ExcitebikeBehavior=B;
})();
