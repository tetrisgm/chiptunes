// CONTRA reaction map: music controls pace, pulse, palette, and firing accents only.
(function(){
  var bindings=[
    {system:'medals and weapon crates',bus:'lead notes',effect:'pickup/crate hops'},
    {system:'enemy soldiers/runners/snipers/turrets/flyers/grenadiers/crawlers/jumpers/gunners/paratroopers/prone shooters/mortars/wall cannons/divers/heavy soldiers',bus:'counter energy',effect:'enemy pulse'},
    {system:'jungle bridge/platforms/watchtowers',bus:'bass/kick',effect:'ground glow'},
    {system:'rifle opportunity and powered shots',bus:'beat + perc onset',effect:'fire timing only if a target exists'},
    {system:'leaf specks',bus:'noise/treble',effect:'jungle twinkles'},
    {system:'pace',bus:'bpm/energy',effect:'running pressure'},
    {system:'palette',bus:'bar progress',effect:'jungle hue drift'},
    {system:'drop',bus:'drop edge',effect:'explosion flash'},
    {system:'idle',bus:'paused',effect:'freeze fight'}
  ];
  function apply(ctx){
    var st=ctx.state,a=ctx.audio||{},r=a.roles||{},lead=r.lead||{},perc=r.perc||{},noise=r.noise||{};
    st.music={
      beat:a.beatStrength||0,
      spb:a.spb||60/Math.max(1,a.bpm||164),
      bpm:a.bpm||164,
      hue:a.hue||0,
      energy:a.energy||0,
      fireAccent:!!(a.beat&&((perc.energy||0)>.16||(a.beatStrength||0)>.58)),
      enemyPulse:Math.max(a.beatStrength||0,(r.counter&&r.counter.energy)||0),
      pickupPulse:Math.max(lead.energy||0,a.beatStrength||0),
      spark:noise.energy||a.treble||0,
      drop:a.drop?1:0
    };
    if(st.pickups)for(var i=0;i<st.pickups.length;i++)st.pickups[i].pulse=Math.max(st.pickups[i].pulse||0,st.music.pickupPulse*.5);
    if(st.crates)for(i=0;i<st.crates.length;i++)st.crates[i].pulse=Math.max(st.crates[i].pulse||0,st.music.pickupPulse*.32);
  }
  VisualizerGame.layer('contra','reactions',{packVersion:3,key:'contra',bindings:bindings,
    systems:{leadTarget:'medals and weapon crates',counterTarget:'soldier enemy pressure',bassTarget:'jungle platforms and watchtowers',percTarget:'rifle and powered shot timing',noiseTarget:'leaf specks',worldTarget:'run pace',phraseTarget:'jungle palette',dropTarget:'explosion flash',idleTarget:'idle stance'},
    entityRoles:{lead:'medalsAndWeaponCrates',counter:'soldiersRunnersSnipersTurretsFlyersGrenadiersCrawlersJumpersGunnersParatroopersProneMortarsDiversHeavy',bass:'jungleGroundPlatformsAndWatchtowers',perc:'rifleSpreadLaserShotsAndWallCannons',noise:'leaves',world:'cameraRun',phrase:'palette',drop:'explosionFlash',idle:'idleStance'},normalizedSignals:['beat','beatStrength','bass','treble','energy','barProgress','drop','paused','bpm','spb','roles'],apply:apply});
})();
