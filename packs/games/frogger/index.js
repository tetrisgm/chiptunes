// FROGGER registration. Simulation lives in definition.js; rendering lives in renderer.js.
CT_GAMES.frogger = {
  key: 'frogger',
  name: 'FROGGER',
  variants: 2,
  sound: {
    bpm: 132, root: 50, scale:[0,2,3,5,7,9,10], octs: 4, swing: 0.06,
    leadWave:'pulse', leadDuty:0.5, leadSend:0.12,
    leadFilter:{type:'lowpass',freq:2200,q:2,sweepTo:1400},
    delayDiv:0.375, fb:0.22, send:0.14,
    chords:[
      {bass:38,tones:[62,65,69]},
      {bass:43,tones:[67,70,74]},
      {bass:41,tones:[65,69,72]},
      {bass:36,tones:[60,64,67]}
    ],
    fx: {
      hop:    { wave:'pulse', duty:0.5, freq:300, dur:0.10, vel:0.20, glideTo:680, filter:{type:'lowpass',freq:2600,q:1} },
      tick:   { wave:'triangle', freq:520, dur:0.05, vel:0.12, glideTo:430 },
      home:   { wave:'pulse', duty:0.25, freq:520, dur:0.30, vel:0.26, glideTo:1040, filter:{type:'lowpass',freq:3200,q:2} },
      splat:  { wave:'sawtooth', freq:380, dur:0.38, vel:0.40, glideTo:48, filter:{type:'lowpass',freq:1200,q:4} },
      splash: { wave:'noise', dur:0.34, vel:0.42, noiseType:'lowsnare' },
      wait:   { wave:'triangle', freq:200, dur:0.04, vel:0.06, glideTo:170 }
    },
    pools: {
      scales: { major:[0,2,4,5,7,9,11], penta:[0,2,4,7,9], mixo:[0,2,4,5,7,9,10], lydian:[0,2,4,6,7,9,11], minor:[0,2,3,5,7,8,10], dorian:[0,2,3,5,7,9,10] },
      waves:['pulse','triangle','pulse'], duties:[0.25,0.5,0.125],
      feels:['straight8','shuffle','driving','offbeat','straight16'],
      drums:['four','backbeat','busy'], basses:['root','walk','oct','synco'],
      keys:[0,0,5,7,-5,2], regs:[0,0,1,2] }
  },
  make:function(A, U, variant){
    return FroggerDefinition.make(A, U, variant);
  },
  frame:function(dt, U, A, IN, SND, st){
    if (typeof VisualizerGame !== 'undefined' && VisualizerGame.run){
      return VisualizerGame.run(CT_GAMES.frogger, { key:'frogger', dt:dt, U:U, A:A, IN:IN, SND:SND, state:st });
    }
    var ctx = { dt:dt, U:U, A:A, IN:IN, SND:SND, state:st };
    FroggerDefinition.update(ctx);
    if (typeof FroggerRenderer !== 'undefined') return FroggerRenderer.render({ A:A, state:st, froggerView:ctx.froggerView || {} });
  }
};

// Pack install hook: attaches this game folder to the shared visualizer runtime.
if (typeof VisualizerGame !== 'undefined' && typeof CT_GAMES !== 'undefined' && CT_GAMES.frogger) {
  VisualizerGame.install(CT_GAMES.frogger, 'frogger');
}
