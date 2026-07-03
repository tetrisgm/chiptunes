// MARIO reactions: normalized music bus -> visual/intent modifiers.
// This layer never reads console channel names and never mutates hitboxes.
(function(){
  function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }
  function roleEnergy(audio, name){
    var r = audio && audio.roles && audio.roles[name];
    return clamp(r && (r.energy != null ? r.energy : r.onset) || 0, 0, 1);
  }
  function roleHi(audio, name, fallback){
    var r = audio && audio.roles && audio.roles[name];
    return clamp(r && r.hi != null ? r.hi : fallback, 0, 1);
  }

  var MARIO_BINDINGS = [
    { system:'coin route', bus:'lead', effect:'lead energy and note height lift coin shimmer and future route family' },
    { system:'enemy cadence', bus:'counter', effect:'counter energy controls enemy hop intensity, not enemy count spam' },
    { system:'terrain weight', bus:'bass', effect:'bass gives ground, pipes, and blocks low-end bounce' },
    { system:'jump accents', bus:'perc', effect:'percussion accents the existing jump and block animation' },
    { system:'cloud sparkle', bus:'noise', effect:'treble animates clouds, coins, and tiny score flecks' },
    { system:'world pace', bus:'world', effect:'tempo and energy bias run pressure within platformer limits' },
    { system:'phrase palette', bus:'phrase', effect:'phrases pick sky and route color drift' },
    { system:'drop accent', bus:'drop', effect:'drop can emphasize sprite palette only, without standalone overlay art or collision changes' },
    { system:'idle hold', bus:'idle', effect:'paused audio stops progression but keeps an idle pose' },
    { system:'sound-out', bus:'shared event/note chokepoint', effect:'game events stay quiet and in-key through the shared engine path' }
  ];

  function apply(ctx){
    var st = ctx.state;
    var a = ctx.audio || {};
    var m = ctx.modifiers || {};
    if(!st) return;

    var lead = roleEnergy(a, 'lead');
    var counter = roleEnergy(a, 'counter');
    var bass = Math.max(a.bass || 0, roleEnergy(a, 'bass'));
    var perc = Math.max(a.beatStrength || 0, roleEnergy(a, 'perc'));
    var noise = Math.max(a.treble || 0, roleEnergy(a, 'noise'));
    var energy = clamp(a.energy || 0, 0, 1);
    var beat = clamp(a.beatStrength || 0, 0, 1);
    var bpmRate = clamp((a.bpm || 150) / 150, 0.72, 1.32);

    st.music = st.music || {};
    st.music.speedBias = clamp(bpmRate * (0.9 + energy * 0.22), 0.82, 1.28);
    st.music.leadHi = roleHi(a, 'lead', 0.5);
    st.music.phraseFamily = Math.max(0, Math.floor(((a.raw && a.raw.phrase) || 0) % 4));
    st.music.skyHue = a.hue || 0;
    st.music.beatScale = 1 + beat * 0.035 + energy * 0.018;
    st.music.coinHop = lead * 5.5 + noise * 2.2;
    st.music.enemyHop = counter * 3.2 + beat * 1.4;
    st.music.cloudHop = noise * 4.0;
    st.music.blockPulse = bass * 0.045 + perc * 0.035;
    st.music.groundBounce = bass * 0.35;

    m.scalePulse = st.music.beatScale - 1;
    m.paletteHue = st.music.skyHue;
    m.energy = energy;
    m.coinHop = st.music.coinHop;
    m.enemyHop = st.music.enemyHop;
    m.cloudHop = st.music.cloudHop;
    m.blockPulse = st.music.blockPulse;
    m.groundBounce = st.music.groundBounce;
    m.brightness = clamp(0.58 + energy * 0.26 + beat * 0.08, 0, 1);

    if(a.drop && ctx.emit) ctx.emit('paletteAccent', { energy:energy, bpm:a.bpm });
  }

  VisualizerGame.layer('mario', 'reactions', {
    packVersion: 2,
    key: 'mario',
    bindingsRef: MARIO_BINDINGS,
    entityRoles: {
      lead:'coins',
      counter:'enemies',
      bass:'ground',
      perc:'marioJumpAndBlocks',
      noise:'clouds',
      world:'levelCamera',
      phrase:'paletteFamily',
      drop:'paletteAccent',
      idle:'pausedRunPose'
    },
    systems: {
      lead:'coins',
      counter:'enemies',
      bass:'ground',
      perc:'marioJumpAndBlocks',
      noise:'clouds',
      world:'levelCamera',
      phrase:'paletteFamily',
      drop:'paletteAccent',
      idle:'pausedRunPose'
    },
    targets: {
      leadTarget:'coins',
      counterTarget:'enemies',
      bassTarget:'ground',
      percTarget:'marioJumpAndBlocks',
      noiseTarget:'clouds',
      dropTarget:'paletteAccent',
      idleTarget:'pausedRunPose'
    },
    normalizedSignals: ['beat','beatStrength','bass','mid','treble','energy','barProgress','sectionChanged','drop','silence','paused','bpm','roles'],
    bindings: MARIO_BINDINGS,
    apply: apply
  });

  if(typeof window !== 'undefined') window.MarioReactions = { apply:apply, bindings:MARIO_BINDINGS };
  else this.MarioReactions = { apply:apply, bindings:MARIO_BINDINGS };
})();
