// BLOCKS registration. Simulation lives in definition.js; rendering lives in renderer.js.
CT_GAMES.blocks = {
  key: 'blocks',
  name: 'BLOCKS',
  variants: 2,
  sound: {
    bpm: 132, root: 45, scale: [0,2,3,5,7,8,10], octs: 4, swing: 0.04,
    leadWave: 'pulse', leadDuty: 0.5, leadSend: 0.16,
    leadFilter: { type:'lowpass', freq: 2200, q: 4, sweepTo: 900 },
    leadVib: { rate: 5.5, depth: 5 }, leadGlide: 0.01,
    delayDiv: 0.375, fb: 0.26, send: 0.16,
    chords: [
      { bass: 33, tones:[57,60,64] },
      { bass: 41, tones:[60,65,69] },
      { bass: 36, tones:[55,60,63] },
      { bass: 40, tones:[55,59,62] }
    ],
    fx: {
      tick:  { wave:'pulse', duty:0.25, freq:520, dur:0.05, vel:0.16, glideTo:480 },
      blip:  { wave:'pulse', duty:0.5,  freq:680, dur:0.07, vel:0.18, glideTo:880, filter:{type:'bandpass',freq:1200,q:6} },
      drop:  { wave:'pulse', duty:0.25, freq:360, dur:0.08, vel:0.20, glideTo:180 },
      thunk: { wave:'triangle', freq:150, dur:0.13, vel:0.30, glideTo:62, filter:{type:'lowpass',freq:900,q:2} },
      sweep: { wave:'pulse', duty:0.5, freq:300, dur:0.22, vel:0.26, glideTo:1500, filter:{type:'lowpass',freq:2400,q:5,sweepTo:3200} },
      fanfare:{ wave:'sawtooth', freq:440, dur:0.42, vel:0.34, glideTo:1320, filter:{type:'lowpass',freq:2600,q:3} },
      topout:{ wave:'noise', dur:0.5, vel:0.5, noiseType:'lowsnare' }
    },
    pools: {
      scales: { minor:[0,2,3,5,7,8,10], harm:[0,2,3,5,7,8,11], dorian:[0,2,3,5,7,9,10], phrygian:[0,1,3,5,7,8,10], major:[0,2,4,5,7,9,11], mixo:[0,2,4,5,7,9,10] },
      waves:['pulse','triangle'], duties:[0.125,0.25,0.5],
      feels:['straight8','straight16','shuffle','triplet','driving'],
      drums:['four','backbeat','busy','break'], basses:['root','walk','oct','synco'],
      keys:[0,0,5,7,-5,-2], regs:[0,0,1,-1] }
  },
  make:function(A, U, variant){
    return BlocksDefinition.make(A, U, variant);
  },
  frame:function(dt, U, A, IN, SND, st){
    if (typeof VisualizerGame !== 'undefined' && VisualizerGame.run){
      return VisualizerGame.run(CT_GAMES.blocks, { key:'blocks', dt:dt, U:U, A:A, IN:IN, SND:SND, state:st });
    }
    var ctx = { dt:dt, U:U, A:A, IN:IN, SND:SND, state:st };
    BlocksDefinition.update(ctx);
    if (typeof BlocksRenderer !== 'undefined') return BlocksRenderer.render(A, U, st, ctx.blocksView || {});
  }
};

// Pack install hook: attaches this game folder to the shared visualizer runtime.
if (typeof VisualizerGame !== 'undefined' && typeof CT_GAMES !== 'undefined' && CT_GAMES.blocks) {
  VisualizerGame.install(CT_GAMES.blocks, 'blocks');
}
