// SUPER HEXAGON registration. Pattern simulation lives in definition.js; renderer owns the radial canvas draw pass.
CT_GAMES.hexagon = {
  key: 'hexagon',
  name: 'SUPER HEXAGON',
  variants: 2,
  sound: {
      bpm:165, root:45, octs:4, swing:0.04,
      leadWave:'sawtooth', leadDuty:0.25, leadSend:0.10,
      leadFilter:{type:'lowpass', freq:2800, q:4, sweepTo:6200},
      delayDiv:0.375, fb:0.20, send:0.12,
      pools:{
        scales:{
          minorPenta:[0,3,5,7,10],
          phrygian:[0,1,3,5,7,8,10],
          harmonic:[0,2,3,5,7,8,11],
          wholeTone:[0,2,4,6,8,10],
          minor:[0,2,3,5,7,8,10],
          hirajoshi:[0,2,3,7,8],
          dorian:[0,2,3,5,7,9,10]
        },
        waves:['sawtooth','pulse'],
        duties:[0.125,0.25,0.5],
        feels:['double','straight16','driving','offbeat','busy','triplet'],
        drums:['four','busy','break','backbeat'],
        basses:['oct','root','synco','drone','walk'],
        keys:[0,0,5,7,-5,-2,3,-3,2],
        regs:[0,0,1,-1,2]
      }
    },

  make: function(A, U, variant){
    return HexagonDefinition.makeState(A, U, variant);
  },

  frame: function(dt, U, A, IN, SND, st){
    if (typeof VisualizerGame !== 'undefined' && VisualizerGame.run) {
      return VisualizerGame.run(CT_GAMES.hexagon, {
        key: 'hexagon',
        dt: dt,
        U: U,
        A: A,
        IN: IN,
        SND: SND,
        state: st
      });
    }

    var ctx = { dt:dt, U:U, A:A, IN:IN, SND:SND, state:st };
    HexagonDefinition.update(ctx);
    if (typeof HexagonRenderer !== 'undefined') return HexagonRenderer.render(ctx);
    return undefined;
  }
};

// Pack install hook: attaches definition/behavior/reaction/renderer metadata.
if (typeof VisualizerGame !== 'undefined' && typeof CT_GAMES !== 'undefined' && CT_GAMES.hexagon) {
  VisualizerGame.install(CT_GAMES.hexagon, 'hexagon');
}
