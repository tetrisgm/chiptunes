// TETRIS music reaction map. This names semantic bus bindings; raw SND access stays out of this layer.
(function(){
  var TETRIS_BINDINGS = [
  {
    system: "piece route",
    bus: "roles.lead.notes + roles.lead.energy + note hi/band",
    effect: "lead notes bias target columns and piece highlight"
  },
  {
    system: "next-piece lane",
    bus: "roles.counter.notes + phrase",
    effect: "counter notes animate preview and alternate rotation choices"
  },
  {
    system: "gravity and stack pressure",
    bus: "roles.bass.energy/onset + bands.bass",
    effect: "bass increases visual weight and controlled gravity pressure"
  },
  {
    system: "locks and clears",
    bus: "roles.perc.onset + kick/snare",
    effect: "percussion snaps locks, rotations, and row clear accents"
  },
  {
    system: "block sparkle",
    bus: "roles.noise.energy + hat/treble",
    effect: "treble adds grid glints and clear debris"
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
    effect: "drop executes a large but deterministic clear/flash moment"
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
  VisualizerGame.layer('tetris', 'reactions', {
  packVersion: 2,
  key: "tetris",
  bindingsRef: TETRIS_BINDINGS,
  entityRoles: {
    lead: "piece",
    counter: "preview",
    bass: "stack",
    perc: "lock",
    noise: "gridSparkle",
    world: "well",
    phrase: "piecePalette",
    drop: "lineBurst",
    idle: "fallingHover"
  },
  systems: {
    lead: "piece",
    counter: "preview",
    bass: "stack",
    perc: "lock",
    noise: "gridSparkle",
    world: "well",
    phrase: "piecePalette",
    drop: "lineBurst",
    idle: "fallingHover"
  },
  targets: {
    leadTarget: "piece",
    counterTarget: "preview",
    bassTarget: "stack",
    percTarget: "lock",
    noiseTarget: "gridSparkle",
    dropTarget: "lineBurst",
    idleTarget: "fallingHover"
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
      system: "piece route",
      bus: "roles.lead.notes + roles.lead.energy + note hi/band",
      effect: "lead notes bias target columns and piece highlight"
    },
    {
      system: "next-piece lane",
      bus: "roles.counter.notes + phrase",
      effect: "counter notes animate preview and alternate rotation choices"
    },
    {
      system: "gravity and stack pressure",
      bus: "roles.bass.energy/onset + bands.bass",
      effect: "bass increases visual weight and controlled gravity pressure"
    },
    {
      system: "locks and clears",
      bus: "roles.perc.onset + kick/snare",
      effect: "percussion snaps locks, rotations, and row clear accents"
    },
    {
      system: "block sparkle",
      bus: "roles.noise.energy + hat/treble",
      effect: "treble adds grid glints and clear debris"
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
      effect: "drop executes a large but deterministic clear/flash moment"
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
  transition: "reaction table is the stable DLC contract"
});
})();
