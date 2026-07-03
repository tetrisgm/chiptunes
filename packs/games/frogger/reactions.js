// FROGGER music reaction map. This names semantic bus bindings; raw SND access stays out of this layer.
(function(){
  var FROGGER_BINDINGS = [
  {
    system: "hop path",
    bus: "roles.lead.notes + roles.lead.energy + note hi/band",
    effect: "lead notes mark target hops and home lanes"
  },
  {
    system: "river platforms",
    bus: "roles.counter.notes + phrase",
    effect: "counter notes vary logs and turtle patterns"
  },
  {
    system: "traffic pressure",
    bus: "roles.bass.energy/onset + bands.bass",
    effect: "bass changes vehicle mass and lane flow weight"
  },
  {
    system: "lane hazards",
    bus: "roles.perc.onset + kick/snare",
    effect: "percussion triggers car snaps, turtle dips, and hop accents"
  },
  {
    system: "water foam",
    bus: "roles.noise.energy + hat/treble",
    effect: "treble adds river sparkle and roadside glints"
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
    effect: "drop opens a readable fast crossing moment"
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
  VisualizerGame.layer('frogger', 'reactions', {
  packVersion: 2,
  key: "frogger",
  bindingsRef: FROGGER_BINDINGS,
  entityRoles: {
    lead: "frogPath",
    counter: "logs",
    bass: "traffic",
    perc: "cars",
    noise: "foam",
    world: "lanes",
    phrase: "lanePalette",
    drop: "clearCrossing",
    idle: "frogIdle"
  },
  systems: {
    lead: "frogPath",
    counter: "logs",
    bass: "traffic",
    perc: "cars",
    noise: "foam",
    world: "lanes",
    phrase: "lanePalette",
    drop: "clearCrossing",
    idle: "frogIdle"
  },
  targets: {
    leadTarget: "frogPath",
    counterTarget: "logs",
    bassTarget: "traffic",
    percTarget: "cars",
    noiseTarget: "foam",
    dropTarget: "clearCrossing",
    idleTarget: "frogIdle"
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
      system: "hop path",
      bus: "roles.lead.notes + roles.lead.energy + note hi/band",
      effect: "lead notes mark target hops and home lanes"
    },
    {
      system: "river platforms",
      bus: "roles.counter.notes + phrase",
      effect: "counter notes vary logs and turtle patterns"
    },
    {
      system: "traffic pressure",
      bus: "roles.bass.energy/onset + bands.bass",
      effect: "bass changes vehicle mass and lane flow weight"
    },
    {
      system: "lane hazards",
      bus: "roles.perc.onset + kick/snare",
      effect: "percussion triggers car snaps, turtle dips, and hop accents"
    },
    {
      system: "water foam",
      bus: "roles.noise.energy + hat/treble",
      effect: "treble adds river sparkle and roadside glints"
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
      effect: "drop opens a readable fast crossing moment"
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
  transition: "index samples the music bus once; renderer consumes normalized render modifiers; behavior remains audio-free"
});
})();
