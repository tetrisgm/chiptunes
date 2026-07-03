// PAC-MAN registration. Simulation lives in definition.js; rendering lives in renderer.js.
CT_GAMES.pacman = {
  key: 'pacman',
  name: 'PAC-MAN',
  variants: 7,
  sound: {
    bpm: 132, root: 48, octs: 4, swing: 0.08,
    leadWave:'pulse', leadDuty:0.5, leadSend:0.16,
    leadFilter:{type:'lowpass', freq:2800, q:2, sweepTo:1200},
    delayDiv:0.375, fb:0.22, send:0.14,
    // PAC-MAN's UNIVERSE = its axis pools. The MOVEMENT engine arranges these into a song that
    // travels radically over minutes: bright/bouncy stretches (major/lydian/mixo/penta) that veer
    // into tense "chase" (harmonic-minor) and eerie chromatic/whole-tone breakdowns, swapping rhythm
    // FEEL (8ths→16ths→triplet→shuffle→half/double-time), timbre, key and register each movement.
    pools: {
      scales: { major:[0,2,4,5,7,9,11], lydian:[0,2,4,6,7,9,11], mixo:[0,2,4,5,7,9,10],
                penta:[0,2,4,7,9], chromq:[0,2,4,5,6,7,9,11], whole:[0,2,4,6,8,10],
                harm:[0,2,3,5,7,8,11], minpenta:[0,3,5,7,10] },
      waves:  ['pulse','pulse','pulse','triangle'],
      duties: [0.125,0.25,0.5],
      feels:  ['straight8','straight16','triplet','shuffle','driving','offbeat','double','halftime','sparse'],
      drums:  ['four','backbeat','break','busy','halftime','sparse'],
      basses: ['root','walk','oct','synco','arp'],
      keys:   [0,0,5,7,-5,2,-3],
      regs:   [0,0,1,1,-1,2] }
    // (no bed / no fixed sections: the movement engine drives a continuous, ever-evolving song)
  },

  make: function(A, U, variant){
    return PacmanDefinition.makeState(variant, this.sound);
  },

  frame: function(dt, U, A, IN, SND, st){
    if (typeof VisualizerGame !== 'undefined' && VisualizerGame.run) {
      return VisualizerGame.run(CT_GAMES.pacman, {
        key: 'pacman',
        dt: dt,
        U: U,
        A: A,
        IN: IN,
        SND: SND,
        state: st
      });
    }

    var ctx = { dt:dt, U:U, A:A, IN:IN, SND:SND, state:st };
    PacmanDefinition.update(ctx);
    if (typeof PacmanRenderer !== 'undefined') {
      return PacmanRenderer.render(A, U, st, ctx.pacmanView || {});
    }
    return undefined;
  }
};

// Pack install hook: attaches this game folder to the shared visualizer runtime.
if (typeof VisualizerGame !== 'undefined' && typeof CT_GAMES !== 'undefined' && CT_GAMES.pacman) {
  VisualizerGame.install(CT_GAMES.pacman, 'pacman');
}
