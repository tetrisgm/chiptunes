// RACER behavior: autonomous rider keeps speed, changes lanes, hits ramps, and avoids bikes/mud.
(function(){
  var B={};
  B.update=function(ctx){
    var st=ctx.state,b=st&&st.bike,input=ctx.IN||{},keys=input.keys||{};
    if(!b)return;
    if(input.active){
      var target=b.targetLane;
      if(keys.up)target=Math.max(0,target-1);
      if(keys.down)target=Math.min(3,target+1);
      st.intent={targetLane:target,up:false,down:false,throttle:!!(keys.right||input.down),boost:!!(keys.right&&input.down),engineBrake:!!keys.left};
      return;
    }
    if(ctx.audio&&ctx.audio.paused){
      st.intent={targetLane:b.targetLane,up:false,down:false,throttle:false,boost:false,engineBrake:true};
      return;
    }
    var look=(typeof RacerDefinition!=='undefined'&&RacerDefinition.lookAhead)?RacerDefinition.lookAhead(st):{targetLane:b.targetLane};
    var m=st.music||{};
    var boostWindow=(Math.floor((st.t||0)/1.7)%3)===0;
    st.intent={
      targetLane:look.targetLane,
      up:false,down:false,
      throttle:b.heat<.86 || !!look.ramp,
      boost:boostWindow&&b.heat<.64&&!look.mud&&!look.bike,
      engineBrake:b.heat>.72 && !look.ramp,
      speedBias:1+(m.energy||0)*.18
    };
  };
  VisualizerGame.layer('racer','behavior',{
    packVersion:2,key:'racer',
    goals:['keep motocross pace high','change lanes before mud and opponent bikes','seek readable ramps and tabletops','ease the engine before overheating','land without breaking lane logic'],
    perception:['upcoming mud by lane','upcoming opponent bike by lane','upcoming ramp by lane','engine heat','current airborne state'],
    policies:['lane choice is authored and sparse, not random clutter','autoplay uses readable boost bursts and wheelies','music raises pressure but does not invalidate bike physics','rider remains on a motorbike at all times'],
    musicInputsAllowed:['energy','beat','rampPulse','bpm'],update:B.update
  });
  if(typeof window!=='undefined')window.RacerBehavior=B;else this.RacerBehavior=B;
})();
