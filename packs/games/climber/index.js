// CLIMBER registration. Simulation lives in definition.js; rendering lives in renderer.js.
CT_GAMES.climber = {
  key:'climber',
  name:'CLIMBER',
  variants:2,
  sound:{
    bpm:142, root:45, octs:4, swing:0.08,
    leadWave:'pulse', leadDuty:0.25, leadSend:0.08,
    leadFilter:{type:'lowpass', freq:2600, q:3, sweepTo:5200},
    delayDiv:0.375, fb:0.22, send:0.12,
    pools:{
      scales:{
        minor:[0,2,3,5,7,8,10],
        dorian:[0,2,3,5,7,9,10],
        harmonic:[0,2,3,5,7,8,11],
        phrygian:[0,1,3,5,7,8,10],
        penta:[0,3,5,7,10],
        pentaMaj:[0,2,4,7,9]
      },
      waves:['pulse','triangle'],
      duties:[0.125,0.25,0.5],
      feels:['driving','straight16','offbeat','double','busy','straight8'],
      drums:['four','busy','break','backbeat'],
      basses:['root','walk','synco','oct'],
      keys:[0,0,5,7,-5,-2,3,-3],
      regs:[0,0,1,-1,2]
    }
  },

  make:function(A,U,variant){
    return ClimberDefinition.makeState(A,U,variant);
  },

  frame:function(dt,U,A,IN,SND,st){
    if(typeof VisualizerGame !== 'undefined' && VisualizerGame.run){
      return VisualizerGame.run(CT_GAMES.climber, {
        key:'climber',
        dt:dt,
        U:U,
        A:A,
        IN:IN,
        SND:SND,
        state:st
      });
    }

    var ctx={dt:dt,U:U,A:A,IN:IN,SND:SND,state:st};
    ClimberDefinition.update(ctx);
    if(typeof ClimberRenderer !== 'undefined') return ClimberRenderer.render(ctx);
    return undefined;
  }
};

if(typeof VisualizerGame !== 'undefined' && typeof CT_GAMES !== 'undefined' && CT_GAMES.climber){
  VisualizerGame.install(CT_GAMES.climber, 'climber');
}
