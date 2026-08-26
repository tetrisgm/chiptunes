// BRICKS registration. Simulation lives in definition.js; rendering lives in renderer.js.
CT_GAMES.bricks = {
  key: 'bricks',
  name: 'BRICKTAP',
  variants: 2,
  sound: {
    bpm: 132, root: 48, scale:[0,2,3,5,7,8,10], octs: 4, swing: 0.04,
    leadWave:'pulse', leadDuty:0.25, leadSend:0.16, delayDiv:0.375, fb:0.22, send:0.14,
    leadFilter:{type:'lowpass',freq:2600,q:4,sweepTo:5200},
    chords:[ {bass:36,tones:[60,63,67]}, {bass:41,tones:[65,68,72]}, {bass:43,tones:[67,70,74]}, {bass:39,tones:[63,67,70]} ],
    fx: {
      pad:   { wave:'triangle', freq:300, dur:0.05, vel:0.22, glideTo:360, filter:{type:'lowpass',freq:1800,q:2} },
      wall:  { wave:'pulse', duty:0.5, freq:520, dur:0.035, vel:0.12, glideTo:560 },
      brick: { wave:'pulse', duty:0.25, freq:440, dur:0.10, vel:0.24, filter:{type:'lowpass',freq:3200,q:5,sweepTo:4800} },
      cap:   { wave:'triangle', freq:660, dur:0.18, vel:0.20, glideTo:990, vib:{rate:14,depth:18} },
      lose:  { wave:'sawtooth', freq:300, dur:0.40, vel:0.34, glideTo:70, filter:{type:'lowpass',freq:1400,q:3} },
      clear: { wave:'pulse', duty:0.125, freq:520, dur:0.30, vel:0.30, glideTo:1040, vib:{rate:9,depth:24} },
    },
    pools: {
      scales: { major:[0,2,4,5,7,9,11], mixo:[0,2,4,5,7,9,10], minor:[0,2,3,5,7,8,10], dorian:[0,2,3,5,7,9,10], lydian:[0,2,4,6,7,9,11], penta:[0,2,4,7,9] },
      waves:['pulse','pulse','sawtooth'], duties:[0.125,0.25,0.5],
      feels:['straight16','driving','double','offbeat','straight8'],
      drums:['four','busy','break','backbeat'], basses:['root','oct','synco','walk'],
      keys:[0,0,5,7,-5], regs:[0,1,1,2] },
  },
  make: function(A, U, variant){
    return BricksDefinition.make(A, U, variant);
  },
  frame: function(dt, U, A, IN, SND, st){
    if(typeof VisualizerGame !== 'undefined' && VisualizerGame.run){
      return VisualizerGame.run(CT_GAMES.bricks, { key:'bricks', dt:dt, U:U, A:A, IN:IN, SND:SND, state:st });
    }
    BricksDefinition.update({ dt:dt, U:U, A:A, IN:IN, SND:SND, state:st });
    if(typeof BricksRenderer !== 'undefined') return BricksRenderer.render({ A:A, U:U, state:st });
  }
};

// Pack install hook: attaches this game folder to the shared visualizer runtime.
if (typeof VisualizerGame !== 'undefined' && typeof CT_GAMES !== 'undefined' && CT_GAMES.bricks) {
  VisualizerGame.install(CT_GAMES.bricks, 'bricks');
}
