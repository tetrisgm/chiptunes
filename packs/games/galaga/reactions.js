// GALAGA music reaction map. This names semantic bus bindings; raw SND access stays out of this layer.
(function(){
  var GALAGA_BINDINGS = [
  {
    system: "enemy formation",
    bus: "roles.lead.notes + roles.lead.energy + note hi/band",
    effect: "lead notes light formation lanes and choose dive candidates"
  },
  {
    system: "counter formations",
    bus: "roles.counter.notes + phrase",
    effect: "counter melody produces secondary alien offsets and call-response sweeps"
  },
  {
    system: "starfield and boss weight",
    bus: "roles.bass.energy/onset + bands.bass",
    effect: "bass deepens star scroll and boss alien mass"
  },
  {
    system: "shots and dives",
    bus: "roles.perc.onset + kick/snare",
    effect: "percussion launches shots, dives, and snap turns"
  },
  {
    system: "star sparkle",
    bus: "roles.noise.energy + hat/treble",
    effect: "treble adds stars, sparks, and small shot glints"
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
    effect: "drop creates a synchronized formation dive with capped explosions"
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
  VisualizerGame.layer('galaga', 'reactions', {
  packVersion: 2,
  key: "galaga",
  bindingsRef: GALAGA_BINDINGS,
  entityRoles: {
    lead: "formation",
    counter: "wingmen",
    bass: "bossWeight",
    perc: "shots",
    noise: "stars",
    world: "space",
    phrase: "waveStyle",
    drop: "formationDive",
    idle: "shipDrift"
  },
  systems: {
    lead: "formation",
    counter: "wingmen",
    bass: "bossWeight",
    perc: "shots",
    noise: "stars",
    world: "space",
    phrase: "waveStyle",
    drop: "formationDive",
    idle: "shipDrift"
  },
  targets: {
    leadTarget: "formation",
    counterTarget: "wingmen",
    bassTarget: "bossWeight",
    percTarget: "shots",
    noiseTarget: "stars",
    dropTarget: "formationDive",
    idleTarget: "shipDrift"
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
      system: "enemy formation",
      bus: "roles.lead.notes + roles.lead.energy + note hi/band",
      effect: "lead notes light formation lanes and choose dive candidates"
    },
    {
      system: "counter formations",
      bus: "roles.counter.notes + phrase",
      effect: "counter melody produces secondary alien offsets and call-response sweeps"
    },
    {
      system: "starfield and boss weight",
      bus: "roles.bass.energy/onset + bands.bass",
      effect: "bass deepens star scroll and boss alien mass"
    },
    {
      system: "shots and dives",
      bus: "roles.perc.onset + kick/snare",
      effect: "percussion launches shots, dives, and snap turns"
    },
    {
      system: "star sparkle",
      bus: "roles.noise.energy + hat/treble",
      effect: "treble adds stars, sparks, and small shot glints"
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
      effect: "drop creates a synchronized formation dive with capped explosions"
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
