// BYTE MAZE music reaction map. This names semantic bus bindings; raw SND access stays out of this layer.
(function(){
  var MAZE_BINDINGS = [
  {
    system: "pellet path",
    bus: "roles.lead.notes + roles.lead.energy + note hi/band",
    effect: "lead notes brighten and pulse pellets along the current route"
  },
  {
    system: "drone pressure",
    bus: "roles.counter.notes + phrase",
    effect: "counter notes offset drone motion and glitched shimmer"
  },
  {
    system: "maze walls",
    bus: "roles.bass.energy/onset + bands.bass",
    effect: "bass applies wall weight, small shake, and tunnel pressure"
  },
  {
    system: "turn gates",
    bus: "roles.perc.onset + kick/snare",
    effect: "snare/kick accents make drones twitch and gates snap"
  },
  {
    system: "pellet sparkle",
    bus: "roles.noise.energy + hat/treble",
    effect: "treble/hat energy shimmers dots and fruit"
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
    effect: "drop triggers a clean power-pellet style color inversion"
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
  VisualizerGame.layer('maze', 'reactions', {
  packVersion: 2,
  key: "maze",
  bindingsRef: MAZE_BINDINGS,
  entityRoles: {
    lead: "pellets",
    counter: "drones",
    bass: "walls",
    perc: "gates",
    noise: "sparkles",
    world: "maze",
    phrase: "mazePalette",
    drop: "powerPulse",
    idle: "mouthIdle"
  },
  systems: {
    lead: "pellets",
    counter: "drones",
    bass: "walls",
    perc: "gates",
    noise: "sparkles",
    world: "maze",
    phrase: "mazePalette",
    drop: "powerPulse",
    idle: "mouthIdle"
  },
  targets: {
    leadTarget: "pellets",
    counterTarget: "drones",
    bassTarget: "walls",
    percTarget: "gates",
    noiseTarget: "sparkles",
    dropTarget: "powerPulse",
    idleTarget: "mouthIdle"
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
      system: "pellet path",
      bus: "roles.lead.notes + roles.lead.energy + note hi/band",
      effect: "lead notes brighten and pulse pellets along the current route"
    },
    {
      system: "drone pressure",
      bus: "roles.counter.notes + phrase",
      effect: "counter notes offset drone motion and glitched shimmer"
    },
    {
      system: "maze walls",
      bus: "roles.bass.energy/onset + bands.bass",
      effect: "bass applies wall weight, small shake, and tunnel pressure"
    },
    {
      system: "turn gates",
      bus: "roles.perc.onset + kick/snare",
      effect: "snare/kick accents make drones twitch and gates snap"
    },
    {
      system: "pellet sparkle",
      bus: "roles.noise.energy + hat/treble",
      effect: "treble/hat energy shimmers dots and fruit"
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
      effect: "drop triggers a clean power-pellet style color inversion"
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
