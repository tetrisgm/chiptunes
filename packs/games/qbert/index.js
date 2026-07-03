// Q*BERT registration. Simulation lives in definition.js; renderer draws the queued board/actor payload.
CT_GAMES.qbert = {
  key: 'qbert',
  name: 'Q*BERT',
  variants: 2,
  sound: {
    bpm: 132, root: 50, scale:[0,2,3,5,7,9,10], octs: 4, swing: 0.08,
    leadWave:'pulse', leadDuty:0.5, leadSend:0.14, delayDiv:0.5, fb:0.22, send:0.14,
    leadFilter:{type:'lowpass', freq:2600, q:2, sweepTo:1400},
    chords:[ {bass:38,tones:[62,65,69]}, {bass:43,tones:[67,70,74]}, {bass:41,tones:[65,69,72]}, {bass:36,tones:[60,63,67]} ],
    fx: {
      boop:  { wave:'pulse', duty:0.5, freq:280, dur:0.07, vel:0.16, glideTo:520 },
      thunk: { wave:'triangle', freq:150, dur:0.10, vel:0.26, glideTo:80 },
      blip:  { wave:'pulse', duty:0.25, freq:660, dur:0.09, vel:0.20, glideTo:990, filter:{type:'highpass',freq:400,q:1} },
      fall:  { wave:'sawtooth', freq:540, dur:0.5, vel:0.24, glideTo:70, filter:{type:'lowpass',freq:1800,q:3} },
      growl: { wave:'sawtooth', freq:70, dur:0.18, vel:0.30, glideTo:48, filter:{type:'lowpass',freq:420,q:6} },
      disc:  { wave:'triangle', freq:300, dur:0.34, vel:0.18, glideTo:1200, vib:{rate:18,depth:40} },
      win:   { wave:'pulse', duty:0.5, freq:523, dur:0.16, vel:0.22, glideTo:1046 },
    },
    pools: {
      scales: { whole:[0,2,4,6,8,10], penta:[0,2,4,7,9], lydian:[0,2,4,6,7,9,11], chromq:[0,2,4,5,6,7,9,11], mixo:[0,2,4,5,7,9,10], minpenta:[0,3,5,7,10], harm:[0,2,3,5,7,8,11] },
      waves:['pulse','triangle','sawtooth'], duties:[0.125,0.25,0.5],
      feels:['offbeat','triplet','shuffle','sparse','straight8'],
      drums:['backbeat','sparse','four','break'], basses:['synco','root','arp','off'],
      keys:[0,5,-5,3,7,-2], regs:[0,1,2,-1] },
  },

  make: function(A, U, variant){
    return QbertDefinition.makeState(A, U, variant);
  },

  frame: function(dt, U, A, IN, SND, st){
    if (typeof VisualizerGame !== 'undefined' && VisualizerGame.run) {
      return VisualizerGame.run(CT_GAMES.qbert, {
        key: 'qbert',
        dt: dt,
        U: U,
        A: A,
        IN: IN,
        SND: SND,
        state: st
      });
    }

    var ctx = { dt:dt, U:U, A:A, IN:IN, SND:SND, state:st };
    QbertDefinition.update(ctx);
    if (typeof QbertRenderer !== 'undefined') return QbertRenderer.render(ctx);
    return undefined;
  }
};

// Pack install hook: attaches this game folder to the shared visualizer runtime.
if (typeof VisualizerGame !== 'undefined' && typeof CT_GAMES !== 'undefined' && CT_GAMES.qbert) {
  VisualizerGame.install(CT_GAMES.qbert, 'qbert');
}
