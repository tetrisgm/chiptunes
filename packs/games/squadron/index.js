// SQUADRON registration. Simulation lives in definition.js; rendering lives in renderer.js.
CT_GAMES.squadron = {
  key: 'squadron',
  name: 'SQUADRON',
  variants: 2,
  sound: {
    bpm: 116, root: 50, scale:[0,2,3,5,7,8,10], octs: 4, swing: 0,
    leadWave:'pulse', leadDuty:0.5, leadSend:0.14,
    leadFilter:{ type:'lowpass', freq:2600, q:5, sweepTo:1300 },
    leadVib:{ rate:7, depth:5 }, leadGlide:0,
    delayDiv:0.375, fb:0.22, send:0.16,
    chords:[
      {bass:38, tones:[50,53,57]},
      {bass:43, tones:[55,58,62]},
      {bass:41, tones:[53,56,60]},
      {bass:36, tones:[48,51,55]}
    ],
    fx: {
      blip:  { wave:'pulse', duty:0.5, freq:880, dur:0.07, vel:0.16, glideTo:1500, filter:{type:'highpass',freq:600,q:2} },
      boom:  { wave:'noise', dur:0.30, vel:0.5, noiseType:'snare', filter:{type:'lowpass',freq:1800,q:1,sweepTo:300} },
      pop:   { wave:'noise', dur:0.18, vel:0.4, noiseType:'hat' },
      dive:  { wave:'sawtooth', freq:760, dur:0.34, vel:0.2, glideTo:120, filter:{type:'lowpass',freq:2200,q:6,sweepTo:300} },
      bomb:  { wave:'triangle', freq:300, dur:0.16, vel:0.16, glideTo:90 },
      death: { wave:'noise', dur:0.6, vel:0.6, noiseType:'lowsnare', filter:{type:'lowpass',freq:1400,q:1,sweepTo:120} },
      fanf:  { wave:'pulse', duty:0.25, freq:660, dur:0.16, vel:0.22, glideTo:990, filter:{type:'lowpass',freq:3000,q:4} }
    },
    pools: {
      scales: { minor:[0,2,3,5,7,8,10], dorian:[0,2,3,5,7,9,10], mixo:[0,2,4,5,7,9,10], penta:[0,2,4,7,9], minpenta:[0,3,5,7,10], harm:[0,2,3,5,7,8,11] },
      waves:['pulse','pulse','triangle'], duties:[0.25,0.5,0.125],
      feels:['straight8','driving','offbeat','shuffle','straight16'],   // calmer: no double-time / fewer 16ths
      drums:['four','backbeat','busy','break'], basses:['root','oct','walk','synco'],
      keys:[0,0,0,5,7,-5], regs:[0,0,1,-1] }
  },
  make:function(A, U, variant){
    return SquadronDefinition.make(A, U, variant);
  },
  frame:function(dt, U, A, IN, SND, st){
    if (typeof VisualizerGame !== 'undefined' && VisualizerGame.run){
      return VisualizerGame.run(CT_GAMES.squadron, { key:'squadron', dt:dt, U:U, A:A, IN:IN, SND:SND, state:st });
    }
    var ctx = { dt:dt, U:U, A:A, IN:IN, SND:SND, state:st };
    SquadronDefinition.update(ctx);
    if (typeof SquadronRenderer !== 'undefined') return SquadronRenderer.render(A, U, st, ctx.squadronView || {});
  }
};

// Pack install hook: attaches this game folder to the shared visualizer runtime.
if (typeof VisualizerGame !== 'undefined' && typeof CT_GAMES !== 'undefined' && CT_GAMES.squadron) {
  VisualizerGame.install(CT_GAMES.squadron, 'squadron');
}
