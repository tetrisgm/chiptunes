// PLATFORMER registration. The real pack lives in definition/behavior/reactions/renderer.
(function(){
  CT_GAMES.platformer = {
    name:'SUPER PLATFORMER',
    variants:3,
    key:'platformer',
    sound:{
      bpm:150,
      root:48,
      octs:4,
      swing:0.06,
      leadWave:'pulse',
      leadDuty:0.5,
      leadSend:0.16,
      leadFilter:{type:'lowpass', freq:3000, q:1.5, sweepTo:1400},
      delayDiv:0.375,
      fb:0.2,
      send:0.12,
      pools:{
        scales:{
          major:[0,2,4,5,7,9,11],
          mixo:[0,2,4,5,7,9,10],
          lydian:[0,2,4,6,7,9,11],
          penta:[0,2,4,7,9],
          minpenta:[0,3,5,7,10],
          dorian:[0,2,3,5,7,9,10],
          chrom:[0,2,4,5,7,8,9,11]
        },
        waves:['pulse','pulse','triangle'],
        duties:[0.125,0.25,0.5],
        feels:['straight8','straight16','driving','offbeat','double','triplet','shuffle','halftime'],
        drums:['four','backbeat','busy','break','halftime','sparse'],
        basses:['root','walk','oct','synco','arp','drone'],
        keys:[0,0,5,7,-5,2,-3],
        regs:[0,0,1,1,-1,2]
      }
    },
    make:function(A,U,variant){
      return (typeof PlatformerDefinition !== 'undefined' && PlatformerDefinition.make) ? PlatformerDefinition.make(A,U,variant) : {};
    },
    frame:function(dt, U, A, IN, SND, st){
      if(typeof VisualizerGame !== 'undefined' && VisualizerGame.run){
        return VisualizerGame.run(CT_GAMES.platformer, {
          key:'platformer',
          dt:dt,
          U:U,
          A:A,
          IN:IN,
          SND:SND,
          state:st
        });
      }
      return st;
    }
  };

  if(typeof VisualizerGame !== 'undefined') VisualizerGame.install(CT_GAMES.platformer, 'platformer');
})();
