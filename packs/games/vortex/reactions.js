// SUPER VORTEX music reaction map. This names semantic bus bindings; raw SND access stays out of this layer.
(function(){
  var VORTEX_BINDINGS = [
  {
    system: "wall pattern",
    bus: "roles.lead.hi + phrase + energyLevel",
    effect: "lead pitch biases the base lane; each pattern roll chooses easy, medium, or hard tiers uniformly, so long/hard families can appear from the first spawn"
  },
  {
    system: "counter rotation",
    bus: "bpm + beatPulse + drop edge",
    effect: "rotation speed follows tempo with beat/drop surges"
  },
  {
    system: "tunnel contraction",
    bus: "grid bpm/spb + energyLevel",
    effect: "wall approach speed follows tempo and section energy"
  },
  {
    system: "wall spawns",
    bus: "grid gstep",
    effect: "each wall part is spawned on a quantized 16th-note cadence, clamped so the cursor can reach the next opening"
  },
  {
    system: "pattern intensity",
    bus: "energyLevel + drop edge",
    effect: "all Solo/Triple C/Whirlpool/Bat/Ladder/Stair/321/spin/Rain/Cap/Stack/Reverse/Quick Shift/One Way Out patterns are eligible immediately; difficulty tier is random, while energy affects spacing and speed, not access"
  },
  {
    system: "simulation pace",
    bus: "grid bpm/spb",
    effect: "scale autonomous pacing and scroll pressure from the deck tempo, with smoothed wall speed so music spikes do not invalidate hitboxes"
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
    effect: "drop queues a one-shot hard pattern, flash, shake, and background inversion"
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
  VisualizerGame.layer('vortex', 'reactions', {
  packVersion: 2,
  key: "vortex",
  bindingsRef: VORTEX_BINDINGS,
  entityRoles: {
    lead: "baseLane",
    counter: "rotation",
    bass: "tunnel",
    perc: "wallCadence",
    noise: "rainCaps",
    world: "radialField",
    phrase: "ringPalette",
    drop: "inversion",
    idle: "slowSpin"
  },
  systems: {
    lead: "baseLane",
    counter: "rotation",
    bass: "tunnel",
    perc: "wallCadence",
    noise: "rainCaps",
    world: "radialField",
    phrase: "ringPalette",
    drop: "inversion",
    idle: "slowSpin"
  },
  targets: {
    leadTarget: "baseLane",
    counterTarget: "rotation",
    bassTarget: "tunnel",
    percTarget: "wallCadence",
    noiseTarget: "rainCaps",
    dropTarget: "inversion",
    idleTarget: "slowSpin"
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
      system: "wall pattern",
      bus: "roles.lead.hi + phrase + energyLevel",
      effect: "lead pitch biases the base lane; each pattern roll chooses easy, medium, or hard tiers uniformly, so long/hard families can appear from the first spawn"
    },
    {
      system: "counter rotation",
      bus: "bpm + beatPulse + drop edge",
      effect: "rotation speed follows tempo with beat/drop surges"
    },
    {
      system: "tunnel contraction",
      bus: "grid bpm/spb + energyLevel",
      effect: "wall approach speed follows tempo and section energy"
    },
    {
      system: "wall spawns",
      bus: "grid gstep",
      effect: "each wall part is spawned on a quantized 16th-note cadence, clamped so the cursor can reach the next opening"
    },
    {
      system: "pattern intensity",
      bus: "energyLevel + drop edge",
      effect: "all Solo/Triple C/Whirlpool/Bat/Ladder/Stair/321/spin/Rain/Cap/Stack/Reverse/Quick Shift/One Way Out patterns are eligible immediately; difficulty tier is random, while energy affects spacing and speed, not access"
    },
    {
      system: "simulation pace",
      bus: "grid bpm/spb",
      effect: "scale autonomous pacing and scroll pressure from the deck tempo, with smoothed wall speed so music spikes do not invalidate hitboxes"
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
      effect: "drop queues a one-shot hard pattern, flash, shake, and background inversion"
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
  transition: "index.js now uses the mask pattern pack directly; future extraction can lift the same data into definition/reactions modules"
});
})();
