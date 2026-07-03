// MEGA MAN 2 reaction map: music changes sprite pulse, pace, fire accents, and palette only.
(function(){
  var bindings=[
    {system:'weapon-energy capsules',bus:'roles.lead.notes + lead energy',effect:'rare pickup glints only, not coin-route behavior'},
    {system:'enemy pressure',bus:'roles.counter.energy',effect:'enemy pulse and modest spawn pressure'},
    {system:'steel floors',bus:'roles.bass.energy + kick',effect:'floor lighting and bass glow'},
    {system:'buster fire',bus:'roles.perc.onset + beat',effect:'extra fire opportunities and muzzle glow'},
    {system:'city sparks',bus:'roles.noise.energy + treble',effect:'small background pixel twinkles'},
    {system:'run pace',bus:'bpm + energy',effect:'autonomous speed bias without changing physics constants'},
    {system:'palette',bus:'barProgress + phrase',effect:'blue/cyan palette drift'},
    {system:'drop',bus:'drop edge',effect:'brief lab-light flash'},
    {system:'idle',bus:'paused/silence',effect:'freeze rules, keep helmet idle pose only'}
  ];
  function apply(ctx){
    var st=ctx.state,a=ctx.audio||{},r=a.roles||{},lead=r.lead||{},perc=r.perc||{},noise=r.noise||{};
    st.music={
      beat:a.beatStrength||0,
      spb:a.spb || 60/Math.max(1,a.bpm||156),
      bpm:a.bpm||156,
      hue:a.hue||0,
      energy:a.energy||0,
      speedBias:0.92+(a.energy||0)*0.32,
      fireAccent:!!(a.beat&&((perc.energy||0)>0.18 || (a.beatStrength||0)>0.55)),
      enemyPulse:Math.max(a.beatStrength||0,(r.counter&&r.counter.energy)||0),
      capsulePulse:Math.max((lead.energy||0),a.beatStrength||0),
      spark:noise.energy||a.treble||0,
      drop:a.drop?1:0
    };
    if(st.pickups) for(var i=0;i<st.pickups.length;i++) st.pickups[i].pulse=Math.max(st.pickups[i].pulse||0,st.music.capsulePulse*0.6);
  }
  VisualizerGame.layer('mega_man_2','reactions',{packVersion:2,key:'mega_man_2',bindings:bindings,
    systems:{leadTarget:'weapon-energy capsules',counterTarget:'robot enemy pressure',bassTarget:'steel floor glow',percTarget:'buster fire accents',noiseTarget:'city sparks',worldTarget:'run pace',phraseTarget:'palette drift',dropTarget:'lab-light flash',idleTarget:'helmet idle'},
    entityRoles:{lead:'weaponEnergyCapsules',counter:'robotEnemies',bass:'steelPlatforms',perc:'busterShots',noise:'citySparks',world:'cameraRun',phrase:'palette',drop:'labFlash',idle:'helmetIdle'},normalizedSignals:['beat','beatStrength','bass','mid','treble','energy','barProgress','drop','paused','bpm','roles'],apply:apply});
})();
