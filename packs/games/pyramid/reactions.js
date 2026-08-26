// PYRAMID music reaction map. This names semantic bus bindings; raw SND access stays out of this layer.
(function(){
  var PYRAMID_BINDINGS = [
  {
    system: "cube route",
    bus: "roles.lead.notes + roles.lead.energy + note hi/band",
    effect: "lead notes choose and pulse route cubes by pitch"
  },
  {
    system: "enemy diagonals",
    bus: "roles.counter.notes + phrase",
    effect: "counter notes drive enemy hops and board offsets"
  },
  {
    system: "board tilt",
    bus: "roles.bass.energy/onset + bands.bass",
    effect: "bass tilts cube shadows and adds weight to landings"
  },
  {
    system: "hops and impacts",
    bus: "roles.perc.onset + kick/snare",
    effect: "percussion snaps hops, enemy drops, and disc launches"
  },
  {
    system: "cube sparkle",
    bus: "roles.noise.energy + hat/treble",
    effect: "treble shimmers cube faces and particles"
  },
  {
    system: "simulation pace",
    bus: "grid bpm/spb",
    effect: "scale autonomous pacing and scroll pressure from the deck tempo"
  },
  {
    system: "palette",
    bus: "bar hue + phrase",
    effect: "rotate the palette by musical section without changing hitboxes"
  },
  {
    system: "scale/pulse",
    bus: "beatPulse + role energy",
    effect: "pulse sprites and props as render modifiers only"
  },
  {
    system: "drop/peak",
    bus: "drop edge + energyLevel",
    effect: "drop sends a safe disc-escape visual burst"
  },
  {
    system: "idle",
    bus: "idle/paused flag",
    effect: "hold progression while keeping a restrained alive pose"
  },
  {
    system: "sound-out",
    bus: "SND.event/SND.note chokepoint",
    effect: "quiet in-key game responses only"
  }
];
  VisualizerGame.layer('pyramid', 'reactions', {
  packVersion: 2,
  key: "pyramid",
  bindingsRef: PYRAMID_BINDINGS,
  entityRoles: {
    lead: "cubeRoute",
    counter: "enemies",
    bass: "boardTilt",
    perc: "hops",
    noise: "sparkles",
    world: "pyramid",
    phrase: "cubePalette",
    drop: "discBurst",
    idle: "pyramidBounce"
  },
  systems: {
    lead: "cubeRoute",
    counter: "enemies",
    bass: "boardTilt",
    perc: "hops",
    noise: "sparkles",
    world: "pyramid",
    phrase: "cubePalette",
    drop: "discBurst",
    idle: "pyramidBounce"
  },
  targets: {
    leadTarget: "cubeRoute",
    counterTarget: "enemies",
    bassTarget: "boardTilt",
    percTarget: "hops",
    noiseTarget: "sparkles",
    dropTarget: "discBurst",
    idleTarget: "pyramidBounce"
  },
  normalizedSignals: [
    "beat",
    "beatStrength",
    "bass",
    "mid",
    "treble",
    "energy",
    "barProgress",
    "sectionChanged",
    "drop",
    "silence",
    "paused",
    "bpm",
    "roles"
  ],
  bindings: [
    {
      system: "cube route",
      bus: "roles.lead.notes + roles.lead.energy + note hi/band",
      effect: "lead notes choose and pulse route cubes by pitch"
    },
    {
      system: "enemy diagonals",
      bus: "roles.counter.notes + phrase",
      effect: "counter notes drive enemy hops and board offsets"
    },
    {
      system: "board tilt",
      bus: "roles.bass.energy/onset + bands.bass",
      effect: "bass tilts cube shadows and adds weight to landings"
    },
    {
      system: "hops and impacts",
      bus: "roles.perc.onset + kick/snare",
      effect: "percussion snaps hops, enemy drops, and disc launches"
    },
    {
      system: "cube sparkle",
      bus: "roles.noise.energy + hat/treble",
      effect: "treble shimmers cube faces and particles"
    },
    {
      system: "simulation pace",
      bus: "grid bpm/spb",
      effect: "scale autonomous pacing and scroll pressure from the deck tempo"
    },
    {
      system: "palette",
      bus: "bar hue + phrase",
      effect: "rotate the palette by musical section without changing hitboxes"
    },
    {
      system: "scale/pulse",
      bus: "beatPulse + role energy",
      effect: "pulse sprites and props as render modifiers only"
    },
    {
      system: "drop/peak",
      bus: "drop edge + energyLevel",
      effect: "drop sends a safe disc-escape visual burst"
    },
    {
      system: "idle",
      bus: "idle/paused flag",
      effect: "hold progression while keeping a restrained alive pose"
    },
    {
      system: "sound-out",
      bus: "SND.event/SND.note chokepoint",
      effect: "quiet in-key game responses only"
    }
  ],
  transition: "index samples the music bus once; extracted behavior is audio-free and renderer consumes normalized visual modifiers"
});
})();
