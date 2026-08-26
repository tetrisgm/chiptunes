// BRICKS music reaction map. This names semantic bus bindings; raw SND access stays out of this layer.
(function(){
  var BRICKS_BINDINGS = [
  {
    system: "brick targets",
    bus: "roles.lead.notes + roles.lead.energy + note hi/band",
    effect: "lead notes mark brick columns and hit priorities"
  },
  {
    system: "ball trails",
    bus: "roles.counter.notes + phrase",
    effect: "counter notes add secondary ball trail colors and target offsets"
  },
  {
    system: "paddle/ball mass",
    bus: "roles.bass.energy/onset + bands.bass",
    effect: "bass changes render weight and bounce emphasis"
  },
  {
    system: "impacts",
    bus: "roles.perc.onset + kick/snare",
    effect: "percussion lands paddle hits, brick hits, and clear snaps"
  },
  {
    system: "brick glitter",
    bus: "roles.noise.energy + hat/treble",
    effect: "treble emits small glassy brick fragments"
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
    effect: "drop triggers a capped multiball or row clear moment"
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
  VisualizerGame.layer('bricks', 'reactions', {
  packVersion: 2,
  key: "bricks",
  bindingsRef: BRICKS_BINDINGS,
  entityRoles: {
    lead: "bricks",
    counter: "ballTrail",
    bass: "mass",
    perc: "hits",
    noise: "fragments",
    world: "court",
    phrase: "brickPalette",
    drop: "multiBall",
    idle: "ballHover"
  },
  systems: {
    lead: "bricks",
    counter: "ballTrail",
    bass: "mass",
    perc: "hits",
    noise: "fragments",
    world: "court",
    phrase: "brickPalette",
    drop: "multiBall",
    idle: "ballHover"
  },
  targets: {
    leadTarget: "bricks",
    counterTarget: "ballTrail",
    bassTarget: "mass",
    percTarget: "hits",
    noiseTarget: "fragments",
    dropTarget: "multiBall",
    idleTarget: "ballHover"
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
      system: "brick targets",
      bus: "roles.lead.notes + roles.lead.energy + note hi/band",
      effect: "lead notes mark brick columns and hit priorities"
    },
    {
      system: "ball trails",
      bus: "roles.counter.notes + phrase",
      effect: "counter notes add secondary ball trail colors and target offsets"
    },
    {
      system: "paddle/ball mass",
      bus: "roles.bass.energy/onset + bands.bass",
      effect: "bass changes render weight and bounce emphasis"
    },
    {
      system: "impacts",
      bus: "roles.perc.onset + kick/snare",
      effect: "percussion lands paddle hits, brick hits, and clear snaps"
    },
    {
      system: "brick glitter",
      bus: "roles.noise.energy + hat/treble",
      effect: "treble emits small glassy brick fragments"
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
      effect: "drop triggers a capped multiball or row clear moment"
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
