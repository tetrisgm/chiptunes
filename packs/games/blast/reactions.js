// BLAST music reaction map. This names semantic bus bindings; raw SND access stays out of this layer.
(function(){
  var BLAST_BINDINGS = [
  {
    system: "pickup path",
    bus: "roles.lead.notes + roles.lead.energy + note hi/band",
    effect: "lead notes reveal route pickups and safe tile hints"
  },
  {
    system: "enemy patrols",
    bus: "roles.counter.notes + phrase",
    effect: "counter notes steer enemy patrol rhythm and offsets"
  },
  {
    system: "blast weight",
    bus: "roles.bass.energy/onset + bands.bass",
    effect: "bass thickens flames and screen pressure"
  },
  {
    system: "bomb fuses",
    bus: "roles.perc.onset + kick/snare",
    effect: "percussion places bombs, fuse ticks, and blast accents"
  },
  {
    system: "embers",
    bus: "roles.noise.energy + hat/treble",
    effect: "treble creates sparks and block debris"
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
    effect: "drop detonates an ordered chain reaction within caps"
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
  VisualizerGame.layer('blast', 'reactions', {
  packVersion: 2,
  key: "blast",
  bindingsRef: BLAST_BINDINGS,
  entityRoles: {
    lead: "pickups",
    counter: "enemies",
    bass: "flames",
    perc: "bombs",
    noise: "embers",
    world: "maze",
    phrase: "blockPalette",
    drop: "chainBlast",
    idle: "fuseIdle"
  },
  systems: {
    lead: "pickups",
    counter: "enemies",
    bass: "flames",
    perc: "bombs",
    noise: "embers",
    world: "maze",
    phrase: "blockPalette",
    drop: "chainBlast",
    idle: "fuseIdle"
  },
  targets: {
    leadTarget: "pickups",
    counterTarget: "enemies",
    bassTarget: "flames",
    percTarget: "bombs",
    noiseTarget: "embers",
    dropTarget: "chainBlast",
    idleTarget: "fuseIdle"
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
      effect: "lead notes reveal route pickups and safe tile hints"
    },
    {
      system: "enemy patrols",
      bus: "roles.counter.notes + phrase",
      effect: "counter notes steer enemy patrol rhythm and offsets"
    },
    {
      system: "blast weight",
      bus: "roles.bass.energy/onset + bands.bass",
      effect: "bass thickens flames and screen pressure"
    },
    {
      system: "bomb fuses",
      bus: "roles.perc.onset + kick/snare",
      effect: "percussion places bombs, fuse ticks, and blast accents"
    },
    {
      system: "embers",
      bus: "roles.noise.energy + hat/treble",
      effect: "treble creates sparks and block debris"
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
      effect: "drop detonates an ordered chain reaction within caps"
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
