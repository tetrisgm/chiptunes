// DUNGEON music reaction map. This names semantic bus bindings; raw SND access stays out of this layer.
(function(){
  var DUNGEON_BINDINGS = [
  {
    system: "pickup path",
    bus: "roles.lead.notes + roles.lead.energy + note hi/band",
    effect: "lead notes reveal pickups and route glints"
  },
  {
    system: "enemy motion",
    bus: "roles.counter.notes + phrase",
    effect: "counter notes steer enemies and projectile cadence"
  },
  {
    system: "room pressure",
    bus: "roles.bass.energy/onset + bands.bass",
    effect: "bass darkens walls and hazard weight"
  },
  {
    system: "attacks/hazards",
    bus: "roles.perc.onset + kick/snare",
    effect: "percussion fires projectiles and hazard pulses"
  },
  {
    system: "gem/sparkle",
    bus: "roles.noise.energy + hat/treble",
    effect: "treble adds pickup sparkle and small sword glints"
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
    effect: "pulse enemies, trees, and pickups as render modifiers only"
  },
  {
    system: "water",
    bus: "energy + beatPulse + bar position",
    effect: "move lake tiles like shallow waves without changing passability"
  },
  {
    system: "drop/peak",
    bus: "drop edge + energyLevel",
    effect: "drop opens one room-clear burst"
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
  VisualizerGame.layer('dungeon', 'reactions', {
  packVersion: 2,
  key: "dungeon",
  bindingsRef: DUNGEON_BINDINGS,
  entityRoles: {
    lead: "pickups",
    counter: "enemies",
    bass: "room",
    perc: "projectiles",
    noise: "sparkles",
    world: "overworld",
    phrase: "roomPalette",
    drop: "roomClear",
    idle: "shieldIdle"
  },
  systems: {
    lead: "pickups",
    counter: "enemies",
    bass: "room",
    perc: "projectiles",
    noise: "sparkles",
    world: "overworld",
    phrase: "roomPalette",
    drop: "roomClear",
    idle: "shieldIdle"
  },
  targets: {
    leadTarget: "pickups",
    counterTarget: "enemies",
    bassTarget: "room",
    percTarget: "projectiles",
    noiseTarget: "sparkles",
    dropTarget: "roomClear",
    idleTarget: "shieldIdle"
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
      system: "pickup path",
      bus: "roles.lead.notes + roles.lead.energy + note hi/band",
      effect: "lead notes reveal pickups and route glints"
    },
    {
      system: "enemy motion",
      bus: "roles.counter.notes + phrase",
      effect: "counter notes steer enemies and projectile cadence"
    },
    {
      system: "room pressure",
      bus: "roles.bass.energy/onset + bands.bass",
      effect: "bass darkens walls and hazard weight"
    },
    {
      system: "attacks/hazards",
      bus: "roles.perc.onset + kick/snare",
      effect: "percussion fires projectiles and hazard pulses"
    },
    {
      system: "gem/sparkle",
      bus: "roles.noise.energy + hat/treble",
      effect: "treble adds pickup sparkle and small sword glints"
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
      effect: "drop opens one room-clear burst"
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
