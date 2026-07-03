#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const GAMES_DIR = path.join(ROOT, 'packs', 'games');

function die(msg){
  console.error(msg);
  process.exit(1);
}

function titleFromKey(key){
  return key
    .split(/[_-]+/g)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function symbolFromKey(key){
  return key
    .split(/[_-]+/g)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function writeNew(file, contents){
  if(fs.existsSync(file)) die(`Refusing to overwrite ${path.relative(ROOT, file)}`);
  fs.writeFileSync(file, contents);
}

const args = process.argv.slice(2);
if(args.length < 1 || args.includes('--help') || args.includes('-h')){
  console.log('Usage: npm run scaffold:game -- <game_key> ["Display Name"] ["family"]');
  console.log('Example: npm run scaffold:game -- sky_kid "Sky Kid" "side-scrolling flyer"');
  process.exit(args.length < 1 ? 1 : 0);
}

const key = args[0];
if(!/^[a-z][a-z0-9_]{1,31}$/.test(key)){
  die('Game key must be lowercase snake_case, start with a letter, contain only a-z, 0-9, or _, and be 2-32 chars.');
}

const name = args[1] || titleFromKey(key);
const family = args[2] || 'retro arcade';
const sym = symbolFromKey(key);
const dir = path.join(GAMES_DIR, key);

if(fs.existsSync(path.join(GAMES_DIR, `${key}.js`))){
  die(`Obsolete flat game file already exists: packs/games/${key}.js`);
}
if(fs.existsSync(dir)){
  die(`Game pack already exists: packs/games/${key}/`);
}

fs.mkdirSync(dir, { recursive: true });

writeNew(path.join(dir, 'pack.json'), JSON.stringify({
  schema: 'rrr-pack@3',
  kind: 'game',
  id: key,
  name: name,
  version: '0.1.0',
  author: 'unknown',
  license: 'MIT',
  app: { contract: 3 },
  permissions: []
}, null, 2) + '\n');

writeNew(path.join(dir, 'definition.js'), `// ${name} definition. Nouns and rules only; no drawing and no raw audio reads.
(function(){
  VisualizerGame.layer(${JSON.stringify(key)}, 'definition', {
    packVersion: 2,
    key: ${JSON.stringify(key)},
    name: ${JSON.stringify(name)},
    family: ${JSON.stringify(family)},
    description: 'Replace this with the specific one-screen or one-level game slice.',
    source: 'scaffold-authored-pack',
    entities: [
      'player',
      'primaryCollectible',
      'enemy',
      'hazard',
      'terrain',
      'particle'
    ],
    rules: [
      'deterministic level setup',
      'player movement',
      'collision',
      'enemy behavior',
      'collection/progress',
      'loop or level complete'
    ],
    events: [
      'entitySpawned',
      'pickupCollected',
      'enemyAvoided',
      'enemyDefeated',
      'nearMiss',
      'levelAdvanced'
    ],
    simulation: {
      timestep: 'fixed by shared runtime; clamp large dt locally',
      collision: 'implemented in this pack before shipping',
      musicKnowledge: 'none in this layer'
    }
  });
})();
`);

writeNew(path.join(dir, 'behavior.js'), `// ${name} autonomous behavior. AI intent only; no rendering and no raw audio reads.
var ${sym}Behavior = (function(){
  function update(ctx){
    if(ctx && ctx.state) ctx.state.$${key}BehaviorReady = true;
  }

  return { update: update };
})();

(function(){
  VisualizerGame.layer(${JSON.stringify(key)}, 'behavior', {
    packVersion: 2,
    key: ${JSON.stringify(key)},
    goals: [
      'play the game toward a clear objective',
      'avoid obvious death loops',
      'prefer readable movement over visualizer noise',
      'make occasional human-like imperfect choices'
    ],
    perception: [
      'player position',
      'nearby enemies',
      'safe paths',
      'collectible value',
      'objective progress'
    ],
    policies: [
      'do not read raw audio here',
      'return or mutate only game intent/state',
      'cap pathfinding and expensive choices',
      'when paused, stop progression and keep only idle animation'
    ],
    musicInputsAllowed: [
      'energy',
      'dangerBoost',
      'aggression',
      'chaos',
      'speedBias'
    ],
    update: ${sym}Behavior.update
  });
})();
`);

writeNew(path.join(dir, 'reactions.js'), `// ${name} audio reactions. Normalized music roles map to game-native systems.
(function(){
  var ${sym.toUpperCase()}_BINDINGS = [
    { system: 'primary path or collectible', bus: 'roles.lead.notes + note hi/band', effect: 'main visible gameplay element tracks melody contour' },
    { system: 'secondary motif', bus: 'roles.counter.notes + phrase', effect: 'counter-melody controls secondary movement or variants' },
    { system: 'world weight', bus: 'roles.bass.energy/onset + bands.bass', effect: 'stage weight, floor, camera, or low threats' },
    { system: 'hazards and accents', bus: 'roles.perc.onset + kick/snare', effect: 'game-native hazards, gates, or impacts' },
    { system: 'small details', bus: 'roles.noise.energy + hat/treble', effect: 'small particles, glints, or UI-safe details' },
    { system: 'simulation pace', bus: 'grid bpm/spb', effect: 'tempo scales game pace without changing hitboxes unpredictably' },
    { system: 'palette', bus: 'bar hue + phrase', effect: 'section-stable palette movement' },
    { system: 'scale/pulse', bus: 'beatPulse + role energy', effect: 'sprites pulse visually, not physically' },
    { system: 'drop/peak', bus: 'drop edge + energyLevel', effect: 'single synchronized peak moment' },
    { system: 'idle', bus: 'idle flag', effect: 'calm alive state without fake progression' },
    { system: 'sound-out', bus: 'SND.event/SND.note chokepoint', effect: 'quiet in-key game responses only' }
  ];

  VisualizerGame.layer(${JSON.stringify(key)}, 'reactions', {
    packVersion: 2,
    key: ${JSON.stringify(key)},
    bindings: ${sym.toUpperCase()}_BINDINGS,
    entityRoles: {
      lead: ['player objective', 'primary collectible'],
      counter: ['secondary enemy or motif'],
      bass: ['terrain/world pressure'],
      perc: ['hazards', 'impacts'],
      noise: ['small details'],
      world: ['palette', 'camera', 'background'],
      phrase: ['level variation'],
      drop: ['peak event'],
      idle: ['paused/idle life']
    },
    systems: {
      lead: 'main playable path',
      counter: 'secondary motion',
      bass: 'world pressure',
      perc: 'hazards',
      noise: 'detail layer',
      world: 'camera/palette',
      phrase: 'variant selection',
      drop: 'edge-latched peak',
      idle: 'alive but not progressing'
    },
    targets: {
      counterTarget: 'secondary motif',
      percTarget: 'hazards',
      noiseTarget: 'small details',
      dropTarget: 'peak event'
    },
    counterTarget: 'secondary motif',
    percTarget: 'hazards',
    noiseTarget: 'small details',
    dropTarget: 'peak event',
    apply: function(ctx){
      VisualizerGame.defaultReaction(ctx);
    }
  });
})();
`);

writeNew(path.join(dir, 'renderer.js'), `// ${name} renderer. Replace with real sprites/tilemaps before shipping.
(function(){
  function render(){
    throw new Error(${JSON.stringify(`${key}: implement renderer before shipping this pack`)});
  }

  VisualizerGame.layer(${JSON.stringify(key)}, 'renderer', {
    packVersion: 2,
    key: ${JSON.stringify(key)},
    adapter: 'custom-canvas-pack',
    presentation: [
      'real sprite/tilemap renderer required',
      'stable camera',
      'pooled particles',
      'music pulse never changes hitboxes'
    ],
    performance: {
      oneActiveLoop: true,
      ownsAnimationLoop: false,
      maxEntities: 256,
      maxParticles: 128,
      maxEventsPerFrame: 64,
      usesReactStatePerFrame: false,
      allocations: 'cap arrays and avoid per-frame object churn'
    },
    drawContract: [
      'consume simulation state and render modifiers',
      'keep collision state separate from visual pulses',
      'pool or cap transient effects',
      'skip heavy visual work when the runtime enters background audio mode'
    ],
    render: render,
    dispose: function(ctx){
      if(ctx && ctx.state && ctx.state.$viz) ctx.state.$viz.disposed = true;
    }
  });
})();
`);

writeNew(path.join(dir, 'index.js'), `// ${name} registration. Implement make/frame before shipping this pack.
CT_GAMES.${key} = {
  name: ${JSON.stringify(name)},
  variants: ['main'],
  sound: { wave: 'pulse', root: 0, mode: 'major', tempo: 132, feels: ['straight8'], keys: [0, 5, 7] },
  make: function(){
    return { t: 0, entities: [], particles: [], events: [] };
  },
  frame: function(){
    throw new Error(${JSON.stringify(`${key}: implement game rules before shipping this pack`)});
  }
};

if(typeof VisualizerGame !== 'undefined' && typeof CT_GAMES !== 'undefined' && CT_GAMES.${key}){
  VisualizerGame.install(CT_GAMES.${key}, ${JSON.stringify(key)});
}
`);

console.log(`Created packs/games/${key}/ (pack.json + 5 layers)`);
console.log('The roster is a directory scan: this pack is discovered as soon as pack.json exists.');
console.log('Next: implement real rules/sprites, run node --check on the files, then npm run validate:pack -- ' + key + ' && npm run validate:games && npm run smoke.');
