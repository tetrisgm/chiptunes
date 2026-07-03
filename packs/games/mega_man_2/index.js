// MEGA MAN 2 registration.
(function(){
  CT_GAMES.mega_man_2 = {
    name:'MEGA MAN 2',
    variants:2,
    key:'mega_man_2',
    sound:{ bpm:156, root:50, octs:4, swing:0.02, leadWave:'pulse', leadDuty:0.25, leadSend:0.18, delayDiv:0.375, fb:0.24, send:0.16,
      pools:{ scales:{minor:[0,2,3,5,7,8,10],dorian:[0,2,3,5,7,9,10],phryg:[0,1,3,5,7,8,10]}, waves:['pulse','pulse','sawtooth'], duties:[0.125,0.25,0.5], feels:['driving','straight16','double','offbeat'], drums:['four','busy','break','backbeat'], basses:['oct','root','synco','arp'], keys:[0,0,5,7,-5], regs:[0,1,1,2] } },
    make:function(A,U,variant){ return MegaMan2Definition.make(A,U,variant); },
    frame:function(){}
  };
  if(typeof VisualizerGame!=='undefined') VisualizerGame.install(CT_GAMES.mega_man_2,'mega_man_2');
})();
