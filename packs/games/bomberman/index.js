// BOMBERMAN registration. Simulation lives in definition.js; rendering lives in renderer.js.
CT_GAMES.bomberman = {
  key:'bomberman',
  name:'BOMBERMAN',
  variants:2,
  sound:{
    bpm: 132, root: 48, scale:[0,2,3,5,7,8,10], octs: 4, swing: 0.04,
    leadWave:'pulse', leadDuty:0.25, leadSend:0.12,
    leadFilter:{ type:'lowpass', freq:2200, q:4, sweepTo:600 },
    leadVib:{ rate:6, depth:5 }, leadGlide:0.01,
    delayDiv:0.375, fb:0.22, send:0.14,
    chords:[
      {bass:36,tones:[48,51,55]},
      {bass:41,tones:[53,56,60]},
      {bass:43,tones:[55,58,62]},
      {bass:39,tones:[51,55,58]}
    ],
    fx: {
      step:  { wave:'pulse', duty:0.125, freq:520, dur:0.04, vel:0.10, glideTo:600, send:0.05 },
      fuse:  { wave:'pulse', duty:0.5,  freq:760, dur:0.05, vel:0.16, glideTo:540, filter:{type:'lowpass',freq:1800,q:2} },
      blast: { wave:'noise', dur:0.34, vel:0.55, noiseType:'snare', filter:{type:'lowpass',freq:1400,q:1} },
      tom:   { wave:'triangle', freq:150, dur:0.20, vel:0.40, glideTo:54 },
      kill:  { wave:'pulse', duty:0.25, freq:880, dur:0.10, vel:0.26, glideTo:1500 },
      hurt:  { wave:'sawtooth', freq:300, dur:0.30, vel:0.40, glideTo:70, filter:{type:'lowpass',freq:900,q:3} },
      win:   { wave:'triangle', freq:520, dur:0.18, vel:0.30, glideTo:1040 }
    },
    pools: {
      scales: { major:[0,2,4,5,7,9,11], mixo:[0,2,4,5,7,9,10], lydian:[0,2,4,6,7,9,11], dorian:[0,2,3,5,7,9,10], penta:[0,2,4,7,9], minor:[0,2,3,5,7,8,10] },
      waves:['pulse','triangle','pulse'], duties:[0.25,0.5,0.125],
      feels:['shuffle','straight8','driving','offbeat','straight16'],
      drums:['four','backbeat','busy','break'], basses:['walk','root','oct','arp'],
      keys:[0,0,5,7,2,-3], regs:[0,0,1,2] }
  },

  make:function(A,U,variant){
    return BombermanDefinition.makeState(A,U,variant);
  },

  frame:function(dt,U,A,IN,SND,st){
    if(typeof VisualizerGame !== 'undefined' && VisualizerGame.run){
      return VisualizerGame.run(CT_GAMES.bomberman, {
        key:'bomberman',
        dt:dt,
        U:U,
        A:A,
        IN:IN,
        SND:SND,
        state:st
      });
    }

    var ctx={dt:dt,U:U,A:A,IN:IN,SND:SND,state:st};
    BombermanDefinition.update(ctx);
    if(typeof BombermanRenderer !== 'undefined') return BombermanRenderer.render(ctx);
    return undefined;
  }
};

if(typeof VisualizerGame !== 'undefined' && typeof CT_GAMES !== 'undefined' && CT_GAMES.bomberman){
  VisualizerGame.install(CT_GAMES.bomberman, 'bomberman');
}
