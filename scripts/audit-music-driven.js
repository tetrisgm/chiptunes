#!/usr/bin/env node
// Static guardrails for the music-driven game contract.
// This is intentionally narrow: it enforces the shared bus architecture without
// trying to prove that every game design choice is musical.
const fs = require('fs');
const path = require('path');
const { GAME_LAYER_ORDER, scanGamePacks } = require('./game-roster.cjs');

const ROOT = path.resolve(__dirname, '..');
const GAMES_DIR = path.join(ROOT, 'packs', 'games');
const GAME_KEYS = scanGamePacks().map(pack => pack.id);

function read(rel){
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function stripComments(src){
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function fail(msg){
  failures.push(msg);
}

const failures = [];
const warnings = [];

const helpers = read('src/helpers.js');
const runtime = read('src/runtime.js');
const visualizer = fs.existsSync(path.join(ROOT, 'src/visualizer.js')) ? read('src/visualizer.js') : '';
const hasGamePackActiveGames = GAME_KEYS.some(key => {
  const idx = path.join(GAMES_DIR, key, 'index.js');
  return fs.existsSync(idx) && fs.readFileSync(idx, 'utf8').includes('GamePackEngine.create');
});
if(!/st\._mvFrame\s*=\s*out/.test(helpers)){
  fail('src/helpers.js: MV.frame must cache the frame on st._mvFrame');
}
if(!/state\._mvFrame\s*=\s*MV\.frame/.test(runtime)){
  fail('src/runtime.js: runGame must publish state._mvFrame before calling game.frame');
}
if(!/VisualizerGame\.run/.test(runtime)){
  fail('src/runtime.js: runGame must route through VisualizerGame.run');
}
if(!/_frameSND\s*=\s*\([^)]*paused/.test(runtime) && !/_frameSND\s*=/.test(runtime)){
  fail('src/runtime.js: frame loop must create a cached per-frame SND wrapper');
}
if(!/const\s+VisualizerGame\s*=/.test(visualizer) || !/function\s+audioSignals/.test(visualizer) || !/function\s+run/.test(visualizer)){
  fail('src/visualizer.js: missing shared VisualizerGame contract with audioSignals() and run()');
}
if(hasGamePackActiveGames){
  fail('active roster contains a generic GamePackEngine pack; new games must be bespoke sprite/tilemap implementations');
}

for(const key of GAME_KEYS){
  const staleFlat = path.join(GAMES_DIR, key + '.js');
  const dir = path.join(GAMES_DIR, key);
  if(fs.existsSync(staleFlat)){
    fail(`${key}: active games must be folder packs; found obsolete packs/games/${key}.js`);
    continue;
  }
  if(!fs.existsSync(dir)){
    fail(`${key}: missing extracted directory packs/games/${key}/`);
    continue;
  }
  for(const f of GAME_LAYER_ORDER){
    if(!fs.existsSync(path.join(dir, f))) fail(`${key}: missing ${f}`);
  }
  const files = GAME_LAYER_ORDER.filter(f => fs.existsSync(path.join(dir, f)));
  const raw = files.map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  const layerFiles = files.filter(f => f !== 'index.js');
  const pureLogicFiles = files.filter(f => f === 'definition.js' || f === 'behavior.js');
  const layerRaw = layerFiles.map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  const pureLogicRaw = pureLogicFiles.map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  const src = stripComments(raw);
  const layerSrc = stripComments(layerRaw);
  const pureLogicSrc = stripComments(pureLogicRaw);
  const rendererFile = fs.existsSync(path.join(dir, 'renderer.js')) ? fs.readFileSync(path.join(dir, 'renderer.js'), 'utf8') : '';
  const usesLegacyCanvasAdapter = /adapter\s*:\s*['"]legacy-canvas-index['"]/.test(rendererFile);
  const usesFrameAdapter = /VisualizerGame\.frameAdapter\s*\(/.test(rendererFile);
  const usesCustomCanvasPack = /adapter\s*:\s*['"]custom-canvas-pack['"]/.test(rendererFile) && /render\s*:/.test(rendererFile);
  for(const layerName of ['definition','behavior','reactions','renderer']){
    const layerPattern = new RegExp(`VisualizerGame\\.layer\\(['"]${key}['"],\\s*['"]${layerName}['"]`);
    if(!layerPattern.test(src)){
      fail(`${key}: missing ${layerName} layer registration`);
    }
  }
  if(!new RegExp(`CT_GAMES\\.${key}\\s*=`).test(src)){
    fail(`${key}: index.js does not register CT_GAMES.${key}`);
  }
  const registersWithVisualizer = new RegExp(`VisualizerGame\\.install\\(CT_GAMES\\.${key}\\s*,\\s*['"]${key}['"]\\)`).test(src);
  if(!registersWithVisualizer && !usesCustomCanvasPack){
    fail(`${key}: game must install through VisualizerGame or provide the standard custom-canvas-pack renderer adapter`);
  }
  if(usesLegacyCanvasAdapter){
    fail(`${key}: legacy-canvas-index renderer adapter is not allowed; use an explicit render bridge or a physical renderer`);
  }
  if(usesFrameAdapter){
    fail(`${key}: VisualizerGame.frameAdapter is obsolete; renderer.js must expose an explicit render(ctx) bridge or a physical renderer`);
  }
  if(usesCustomCanvasPack && !/dispose\s*:/.test(rendererFile)){
    fail(`${key}: custom renderer adapter must expose the standard dispose lifecycle`);
  }
  if(usesCustomCanvasPack && !/render\s*:/.test(rendererFile)){
    fail(`${key}: custom renderer adapter must expose the standard render lifecycle`);
  }
  const directSnd = pureLogicSrc.match(/\bSND\s*(?:&&|\?)?[^\n;{}]{0,120}\.(?:clock|grid|vis)\s*\(|\bSND\.(?:clock|grid|vis)\s*\(/g) || [];
  if(directSnd.length){
    fail(`${key}: direct SND bus read found in definition/behavior (${directSnd.slice(0, 3).join(' | ')})`);
  }
  const directAudio = pureLogicSrc.match(/\bAudio\.(?:clock|grid|vis)\s*\(/g) || [];
  if(directAudio.length){
    fail(`${key}: direct Audio bus read found in definition/behavior (${directAudio.slice(0, 3).join(' | ')})`);
  }
  const timerHints = layerRaw.match(/\b(?:spawnT|spawnTimer|peelTimer|sweepTimer|cooldown|cool)\b/g) || [];
  if(timerHints.length && !usesLegacyCanvasAdapter){
    fail(`${key}: timer/cooldown identifiers remain in extracted layer files`);
  } else if(timerHints.length){
    warnings.push(`${key}: legacy adapter layer still contains timer/cooldown identifiers (${Array.from(new Set(timerHints)).join(', ')})`);
  }
  const reactionFile = fs.existsSync(path.join(dir, 'reactions.js')) ? fs.readFileSync(path.join(dir, 'reactions.js'), 'utf8') : '';
  const hasExplicitBindingTable =
    /bindings\s*:\s*\[/.test(reactionFile) ||
    (/\b(?:const|let|var)\s+bindings\s*=\s*\[/.test(reactionFile) && (/\bbindings\s*,/.test(reactionFile) || /bindings\s*:\s*bindings\b/.test(reactionFile))) ||
    (/\b(?:const|let|var)\s+[A-Z0-9_]+_BINDINGS\s*=\s*\[/.test(reactionFile) && /bindings\s*:\s*[A-Z0-9_]+_BINDINGS\b/.test(reactionFile));
  if(!hasExplicitBindingTable){
    fail(`${key}: reactions.js missing explicit bindings table`);
  }
  for(const token of ['entityRoles', 'systems', 'lead', 'counter', 'bass', 'perc', 'noise', 'world', 'phrase', 'drop', 'idle']){
    if(!reactionFile.includes(token)){
      fail(`${key}: reactions.js missing ${token} binding/system declaration`);
    }
  }
  for(const targetKey of ['counterTarget', 'percTarget', 'noiseTarget', 'dropTarget']){
    if(!reactionFile.includes(targetKey)){
      fail(`${key}: reactions.js missing ${targetKey}`);
    }
  }
}

if(warnings.length){
  console.log('Warnings:');
  for(const w of warnings) console.log('  - ' + w);
}
if(failures.length){
  console.error('Music-driven audit failed:');
  for(const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log(`Music-driven audit passed for ${GAME_KEYS.length} games.`);
