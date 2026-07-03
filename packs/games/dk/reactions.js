// DONKEY KONG music reaction map. This names semantic bus bindings; raw SND access stays out of this layer.
(function(){
  var DK_BINDINGS = [
  {
    system: "ladder route",
    bus: "roles.lead.notes + roles.lead.energy + note hi/band",
    effect: "lead notes highlight next ladder/platform goals"
  },
  {
    system: "barrel lanes",
    bus: "roles.counter.notes + phrase",
    effect: "counter notes vary barrel routes and fireball patrols"
  },
  {
    system: "girder weight",
    bus: "roles.bass.energy/onset + bands.bass",
    effect: "bass flexes girders and stage pressure"
  },
  {
    system: "barrel spawns",
    bus: "roles.perc.onset + kick/snare",
    effect: "percussion releases barrels and jump accents"
  },
  {
    system: "sparks",
    bus: "roles.noise.energy + hat/treble",
    effect: "treble adds oil/fire sparks and ladder glints"
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
    effect: "drop triggers one readable barrel wave, not a flood"
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
  VisualizerGame.layer('dk', 'reactions', {
  packVersion: 2,
  key: "dk",
  bindingsRef: DK_BINDINGS,
  entityRoles: {
    lead: "route",
    counter: "barrels",
    bass: "girders",
    perc: "barrelHits",
    noise: "sparks",
    world: "construction",
    phrase: "girderPalette",
    drop: "barrelWave",
    idle: "climbIdle"
  },
  systems: {
    lead: "route",
    counter: "barrels",
    bass: "girders",
    perc: "barrelHits",
    noise: "sparks",
    world: "construction",
    phrase: "girderPalette",
    drop: "barrelWave",
    idle: "climbIdle"
  },
  targets: {
    leadTarget: "route",
    counterTarget: "barrels",
    bassTarget: "girders",
    percTarget: "barrelHits",
    noiseTarget: "sparks",
    dropTarget: "barrelWave",
    idleTarget: "climbIdle"
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
      system: "ladder route",
      bus: "roles.lead.notes + roles.lead.energy + note hi/band",
      effect: "lead notes highlight next ladder/platform goals"
    },
    {
      system: "barrel lanes",
      bus: "roles.counter.notes + phrase",
      effect: "counter notes vary barrel routes and fireball patrols"
    },
    {
      system: "girder weight",
      bus: "roles.bass.energy/onset + bands.bass",
      effect: "bass flexes girders and stage pressure"
    },
    {
      system: "barrel spawns",
      bus: "roles.perc.onset + kick/snare",
      effect: "percussion releases barrels and jump accents"
    },
    {
      system: "sparks",
      bus: "roles.noise.energy + hat/treble",
      effect: "treble adds oil/fire sparks and ladder glints"
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
      effect: "drop triggers one readable barrel wave, not a flood"
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
  transition: "index.js still applies DK's existing visual reactions internally; behavior and renderer now expose explicit split-pack entry points"
});
})();
