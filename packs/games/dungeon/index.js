// DUNGEON registration. Simulation lives in definition.js; rendering lives in renderer.js.
CT_GAMES.dungeon = {
  key: 'dungeon',
  name: 'DUNGEON QUEST',
  variants: 2,
  sound: {
    bpm:132, root:48, octs:4, swing:0.08,
    leadWave:'pulse', leadDuty:0.5, leadSend:0.12,
    leadFilter:{type:'lowpass', freq:2600, q:1.2, sweepTo:4200},
    delayDiv:0.375, fb:0.2, send:0.13,
    pools:{
      scales:{
        major:[0,2,4,5,7,9,11], lydian:[0,2,4,6,7,9,11], mixolydian:[0,2,4,5,7,9,10],
        minor:[0,2,3,5,7,8,10], dorian:[0,2,3,5,7,9,10], harmonicMinor:[0,2,3,5,7,8,11],
        majPent:[0,2,4,7,9], minPent:[0,3,5,7,10]
      },
      waves:['pulse','triangle','sawtooth'],
      duties:[0.125,0.25,0.5],
      feels:['straight8','straight16','driving','offbeat','double','triplet','halftime'],
      drums:['four','backbeat','busy','break','halftime','sparse'],
      basses:['root','walk','oct','synco','arp','drone'],
      keys:[0,0,5,7,-5,2,-3],
      regs:[0,0,1,-1,2]
    }
  },

  make: function(A, U, variant){
    return DungeonDefinition.makeState(A, U, variant);
  },

  frame: function(dt, U, A, IN, SND, st){
    if(typeof VisualizerGame !== 'undefined' && VisualizerGame.run){
      return VisualizerGame.run(CT_GAMES.dungeon, {
        key: 'dungeon',
        dt: dt,
        U: U,
        A: A,
        IN: IN,
        SND: SND,
        state: st
      });
    }

    var ctx = { dt:dt, U:U, A:A, IN:IN, SND:SND, state:st };
    DungeonDefinition.update(ctx);
    if(typeof DungeonRenderer !== 'undefined') return DungeonRenderer.render(ctx);
    return undefined;
  }
};

if(typeof VisualizerGame !== 'undefined' && typeof CT_GAMES !== 'undefined' && CT_GAMES.dungeon){
  VisualizerGame.install(CT_GAMES.dungeon, 'dungeon');
}
