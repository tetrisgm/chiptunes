// RACER reactions: music colors/pulses the motocross world without changing lane hitboxes.
(function(){
  var bindings=[
    {system:'ramp highlights',bus:'lead role + beat',effect:'ramps hop visually before jump opportunities'},
    {system:'opponent riders',bus:'counter role',effect:'opponent bikes pulse while staying in lane'},
    {system:'track dirt and mud',bus:'bass',effect:'dirt bands darken and mud glistens'},
    {system:'engine vibration',bus:'perc role + beat',effect:'bike shakes and exhaust pops'},
    {system:'crowd and flags',bus:'noise/treble',effect:'background flags flutter'},
    {system:'scroll speed',bus:'bpm + energy',effect:'track pace follows tempo safely'},
    {system:'palette',bus:'bar progress',effect:'NES dirt/sky hue drifts by bar'},
    {system:'drop',bus:'drop edge',effect:'finish-line flash and crowd pop'},
    {system:'idle',bus:'paused',effect:'hold bike pose'}
  ];
  function apply(ctx){
    var st=ctx.state,a=ctx.audio||{},r=a.roles||{},lead=r.lead||{},counter=r.counter||{},perc=r.perc||{},noise=r.noise||{};
    st.music={
      beat:a.beatStrength||0,
      hue:a.hue||0,
      energy:a.energy||0,
      bpm:a.bpm||154,
      spb:a.spb||60/(a.bpm||154),
      rampPulse:Math.max(lead.energy||0,a.beatStrength||0),
      opponentPulse:Math.max(counter.energy||0,a.mid||0),
      engine:Math.max(perc.energy||0,a.beatStrength||0),
      mud:Math.max(a.bass||0,0),
      spark:Math.max(noise.energy||0,a.treble||0),
      drop:a.drop?1:0
    };
    if(st.elements){
      for(var i=0;i<st.elements.length;i++){
        var e=st.elements[i];
        if(e.type==='ramp'||e.type==='tabletop'||e.type==='whoops')e.pulse=Math.max(e.pulse||0,st.music.rampPulse*.42);
        else if(e.type==='opponent')e.pulse=Math.max(e.pulse||0,st.music.opponentPulse*.32);
      }
    }
  }
  VisualizerGame.layer('racer','reactions',{
    packVersion:2,key:'racer',bindings:bindings,
    systems:{leadTarget:'ramp highlights',counterTarget:'opponent motorbikes',bassTarget:'mud and dirt bands',percTarget:'engine vibration',noiseTarget:'crowd flags',worldTarget:'track scroll speed',phraseTarget:'NES dirt and sky palette',dropTarget:'finish-line flash',idleTarget:'bike idle'},
    entityRoles:{lead:'slopeAndTabletopRamps',counter:'opponentMotorbikes',bass:'mudAndDirt',perc:'engineAndLaneMarkers',noise:'crowdFlags',world:'trackScroll',phrase:'palette',drop:'finishFlash',idle:'bikeIdle'},
    normalizedSignals:['beat','beatStrength','bass','mid','treble','energy','barProgress','drop','paused','bpm','spb','roles'],
    apply:apply
  });
})();
