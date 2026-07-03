// METROID reaction map: music controls pace, pulse, palette, and beam accents only.
(function(){
  var bindings=[
    {system:'energy orbs',bus:'lead notes',effect:'orb shimmer'},
    {system:'aliens',bus:'counter energy',effect:'enemy pulse'},
    {system:'cavern platforms',bus:'bass',effect:'wall glow and tile lift'},
    {system:'beam/door timing',bus:'beat + perc onset',effect:'extra fire opportunity when a door/enemy is present'},
    {system:'cave dust',bus:'noise/treble',effect:'small cave specks'},
    {system:'pace',bus:'bpm/energy',effect:'run pressure'},
    {system:'palette',bus:'bar/phrase',effect:'cavern hue drift'},
    {system:'drop',bus:'drop edge',effect:'brief hatch flash'},
    {system:'idle',bus:'paused',effect:'freeze traversal'}
  ];
  function apply(ctx){
    var st=ctx.state,a=ctx.audio||{},r=a.roles||{},lead=r.lead||{},perc=r.perc||{},noise=r.noise||{};
    st.music={
      beat:a.beatStrength||0,
      spb:a.spb||60/Math.max(1,a.bpm||142),
      bpm:a.bpm||142,
      hue:a.hue||0,
      energy:a.energy||0,
      fireAccent:!!(a.beat&&((perc.energy||0)>.16||(a.beatStrength||0)>.55)),
      enemyPulse:Math.max(a.beatStrength||0,(r.counter&&r.counter.energy)||0),
      orbPulse:Math.max(lead.energy||0,a.beatStrength||0),
      spark:noise.energy||a.treble||0,
      drop:a.drop?1:0
    };
    if(st.pickups)for(var i=0;i<st.pickups.length;i++)st.pickups[i].pulse=Math.max(st.pickups[i].pulse||0,st.music.orbPulse*.6);
  }
  VisualizerGame.layer('metroid','reactions',{packVersion:2,key:'metroid',bindings:bindings,
    systems:{leadTarget:'energy-orb shimmer',counterTarget:'alien pulse',bassTarget:'cavern wall glow',percTarget:'beam and hatch accents',noiseTarget:'cave dust',worldTarget:'room traversal pace',phraseTarget:'cavern palette',dropTarget:'hatch flash',idleTarget:'idle pose'},
    entityRoles:{lead:'energyOrbs',counter:'aliens',bass:'cavern',perc:'beamShotsAndHatches',noise:'dust',world:'rooms',phrase:'palette',drop:'doorFlash',idle:'idlePose'},normalizedSignals:['beat','beatStrength','bass','treble','energy','barProgress','drop','paused','bpm','spb','roles'],apply:apply});
})();
