// BALLOON FIGHT game-pack registration. Layers are in sibling files.
(function(){
  CT_GAMES.balloon = {
    key:'balloon',
    name:'BALLOON FIGHT',
    variants:2,
    sound:{
      bpm:132,
      root:50,
      scale:[0,2,3,5,7,9,10],
      octs:4,
      swing:0.04,
      leadWave:'triangle',
      leadDuty:0.5,
      leadSend:0.16,
      delayDiv:0.5,
      fb:0.22,
      send:0.14,
      leadFilter:{ type:'lowpass', freq:2200, q:1.2, sweepTo:3200 },
      chords:[
        { bass:38, tones:[57,62,65] },
        { bass:43, tones:[59,62,67] },
        { bass:41, tones:[60,65,69] },
        { bass:36, tones:[55,60,64] }
      ],
      fx:{
        flap:{ wave:'triangle', freq:300, dur:0.10, vel:0.16, glideTo:560, filter:{ type:'lowpass', freq:2400, q:2 } },
        pop:{ wave:'square', freq:680, dur:0.13, vel:0.30, glideTo:120, filter:{ type:'bandpass', freq:1200, q:2 } },
        boing:{ wave:'sine', freq:220, dur:0.18, vel:0.24, glideTo:520, vib:{ rate:18, depth:40 } },
        splash:{ wave:'noise', dur:0.34, vel:0.42, noiseType:'hat', filter:{ type:'highpass', freq:900, q:1 } },
        chomp:{ wave:'sawtooth', freq:160, dur:0.20, vel:0.38, glideTo:48 },
        win:{ wave:'square', freq:520, dur:0.22, vel:0.30, glideTo:1040 }
      },
      pools:{
        scales:{
          major:[0,2,4,5,7,9,11],
          lydian:[0,2,4,6,7,9,11],
          mixo:[0,2,4,5,7,9,10],
          penta:[0,2,4,7,9],
          dorian:[0,2,3,5,7,9,10],
          whole:[0,2,4,6,8,10]
        },
        waves:['triangle','pulse','pulse'],
        duties:[0.25,0.5,0.125],
        feels:['shuffle','straight8','offbeat','driving','triplet'],
        drums:['backbeat','four','busy','sparse'],
        basses:['walk','root','arp','oct'],
        keys:[0,0,5,7,2,-3],
        regs:[0,1,1,2]
      }
    },
    make:function(A, U, variant){
      return BalloonDefinition.make(A, U, variant);
    },
    frame:function(dt, U, A, IN, SND, st){
      return VisualizerGame.run(CT_GAMES.balloon, {
        key:'balloon',
        dt:dt,
        U:U,
        A:A,
        IN:IN,
        SND:SND,
        state:st
      });
    }
  };
  VisualizerGame.install(CT_GAMES.balloon, 'balloon');
})();
