#!/usr/bin/env node
// Validates the folder-pack contract for Retro Rave Radio visualizer games.
//
// This is intentionally structural. `validate:games` audits the active music
// contract; this script also works on a single game folder before it ships.
// The roster is the directory scan: every packs/games/<id>/pack.json is a pack.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { GAME_LAYER_ORDER, scanGamePacks } = require('./game-roster.cjs');

const ROOT = path.resolve(__dirname, '..');
const GAMES_DIR = path.join(ROOT, 'packs', 'games');

const REACTION_TOKENS = [
  'entityRoles',
  'systems',
  'lead',
  'counter',
  'bass',
  'perc',
  'noise',
  'world',
  'phrase',
  'drop',
  'idle',
  'counterTarget',
  'percTarget',
  'noiseTarget',
  'dropTarget'
];

const OBSOLETE_TOKENS = [
  'VisualizerGame.frameAdapter',
  'legacy-canvas-index',
  'GamePackEngine.create',
  'packVersion: 1',
  'packVersion:1',
  'preserved-legacy-index'
];

function usage(exitCode){
  console.log('Usage: npm run validate:pack -- [--all | <game_key-or-packs/games/path> ...]');
  console.log('       npm run validate:pack:strict -- <game_key-or-packs/games/path> ...');
  console.log('Default: validate every scanned pack under packs/games/.');
  console.log('Strict mode fails legacy bridges and warning-level lifecycle gaps.');
  process.exit(exitCode);
}

function escRegExp(value){
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function rel(file){
  return path.relative(ROOT, file);
}

function isGameKey(value){
  return /^[a-z][a-z0-9_]*$/.test(value);
}

function stripComments(src){
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function read(file, failures){
  try {
    return fs.readFileSync(file, 'utf8');
  } catch(err){
    failures.push(`${rel(file)}: ${err.message}`);
    return '';
  }
}

function unique(values){
  return Array.from(new Set(values));
}

function resolveTargets(args){
  const targetArgs = args.filter(arg => arg !== '--strict');
  if(targetArgs.includes('--help') || targetArgs.includes('-h')) usage(0);
  if(targetArgs.length === 0 || targetArgs.includes('--all') || targetArgs.includes('--active')){
    return scanGamePacks().map(pack => ({ key: pack.id, dir: pack.dir, active: true }));
  }

  return targetArgs.map(arg => {
    const clean = arg.replace(/\/+$/g, '');
    if(isGameKey(clean)){
      return { key: clean, dir: path.join(GAMES_DIR, clean), active: true };
    }
    const dir = path.resolve(ROOT, clean);
    return { key: path.basename(dir), dir, active: true };
  });
}

function hasBindingTable(reactionFile){
  return /bindings\s*:\s*\[/.test(reactionFile) ||
    (/\b(?:const|let|var)\s+bindings\s*=\s*\[/.test(reactionFile) &&
      (/\bbindings\s*,/.test(reactionFile) || /bindings\s*:\s*bindings\b/.test(reactionFile))) ||
    (/\b(?:const|let|var)\s+[A-Z0-9_]+_BINDINGS\s*=\s*\[/.test(reactionFile) &&
      /bindings\s*:\s*[A-Z0-9_]+_BINDINGS\b/.test(reactionFile)) ||
    /bindingsRef\s*:/.test(reactionFile);
}

function validateSyntax(file, src, failures){
  try {
    new vm.Script(src, { filename: file });
  } catch(err){
    failures.push(`${rel(file)}: syntax error: ${err.message}`);
  }
}

function pushIssue(target, message, failures, warnings){
  if(target.strict) failures.push(message);
  else warnings.push(message);
}

function validateManifest(target, failures){
  const manifestPath = path.join(target.dir, 'pack.json');
  if(!fs.existsSync(manifestPath)){
    failures.push(`${rel(manifestPath)}: missing pack.json manifest`);
    return;
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch(err){
    failures.push(`${rel(manifestPath)}: invalid JSON: ${err.message}`);
    return;
  }
  if(manifest.schema !== 'rrr-pack@3') failures.push(`${rel(manifestPath)}: schema must be rrr-pack@3`);
  if(manifest.kind !== 'game') failures.push(`${rel(manifestPath)}: kind must be "game"`);
  if(manifest.id !== target.key) failures.push(`${rel(manifestPath)}: id "${manifest.id}" does not match folder "${target.key}"`);
  if(!/^[a-z][a-z0-9_]{1,31}$/.test(String(manifest.id || ''))) failures.push(`${rel(manifestPath)}: id must match ^[a-z][a-z0-9_]{1,31}$`);
  if(!manifest.name) failures.push(`${rel(manifestPath)}: missing name`);
  if(!/^\d+\.\d+\.\d+$/.test(String(manifest.version || ''))) failures.push(`${rel(manifestPath)}: version must be semver (x.y.z)`);
  if(!manifest.app || manifest.app.contract !== 3) failures.push(`${rel(manifestPath)}: app.contract must be 3`);
}

function validatePack(target){
  const { key, dir, active } = target;
  const failures = [];
  const warnings = [];

  if(!isGameKey(key)){
    failures.push(`${rel(dir)}: game key must be lowercase snake_case`);
    return { key, failures, warnings };
  }

  const flatFile = path.join(GAMES_DIR, `${key}.js`);
  if(fs.existsSync(flatFile)){
    failures.push(`${rel(flatFile)}: obsolete flat game file; packs must live in packs/games/${key}/`);
  }
  if(!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()){
    failures.push(`${rel(dir)}: missing game pack directory`);
    return { key, failures, warnings };
  }

  validateManifest(target, failures);

  const missing = GAME_LAYER_ORDER.filter(file => !fs.existsSync(path.join(dir, file)));
  for(const file of missing) failures.push(`${rel(path.join(dir, file))}: missing required layer`);

  const files = GAME_LAYER_ORDER
    .map(file => ({ name: file, path: path.join(dir, file) }))
    .filter(file => fs.existsSync(file.path));

  const byName = {};
  for(const file of files){
    byName[file.name] = read(file.path, failures);
    validateSyntax(file.path, byName[file.name], failures);
  }

  const combined = files.map(file => byName[file.name]).join('\n');
  const logic = stripComments([byName['definition.js'], byName['behavior.js']].filter(Boolean).join('\n'));
  const renderer = byName['renderer.js'] || '';
  const reactions = byName['reactions.js'] || '';
  const index = byName['index.js'] || '';

  for(const token of OBSOLETE_TOKENS){
    if(combined.includes(token)) failures.push(`${key}: obsolete token found: ${token}`);
  }

  for(const layer of ['definition', 'behavior', 'reactions', 'renderer']){
    const layerPattern = new RegExp(`VisualizerGame\\.layer\\(\\s*['"]${escRegExp(key)}['"]\\s*,\\s*['"]${layer}['"]`);
    if(!layerPattern.test(combined)) failures.push(`${key}: missing VisualizerGame ${layer} layer registration`);
  }

  for(const file of ['definition.js', 'behavior.js', 'reactions.js', 'renderer.js']){
    const src = byName[file] || '';
    if(src && !/packVersion\s*:\s*(?:[2-9]|\d{2,})\b/.test(src)){
      failures.push(`${rel(path.join(dir, file))}: missing packVersion >= 2`);
    }
  }

  const ctGameDot = new RegExp(`CT_GAMES\\.${escRegExp(key)}\\s*=`);
  const ctGameBracket = new RegExp(`CT_GAMES\\[\\s*['"]${escRegExp(key)}['"]\\s*\\]\\s*=`);
  if(index && !ctGameDot.test(index) && !ctGameBracket.test(index)){
    failures.push(`${rel(path.join(dir, 'index.js'))}: missing CT_GAMES.${key} registration`);
  }

  if(target.strict && index){
    const hasFrame = /\bframe\s*(?:\([^)]*\)|:)/.test(index);
    const emptyFrame =
      /\bframe\s*:\s*function\s*\([^)]*\)\s*\{\s*\}/.test(index) ||
      /\bframe\s*\([^)]*\)\s*\{\s*\}/.test(index);
    const delegatesToRunner = /VisualizerGame\.run\s*\(/.test(index);
    if(hasFrame && !emptyFrame && !delegatesToRunner){
      failures.push(`${rel(path.join(dir, 'index.js'))}: strict packs must keep frame empty or delegate to VisualizerGame.run; move simulation into definition.js`);
    }
    if(index.includes('throw new Error(')){
      failures.push(`${rel(path.join(dir, 'index.js'))}: strict pack still contains scaffold throw`);
    }
  }

  const installDot = new RegExp(`VisualizerGame\\.install\\(\\s*CT_GAMES\\.${escRegExp(key)}\\s*,\\s*['"]${escRegExp(key)}['"]\\s*\\)`);
  const installBracket = new RegExp(`VisualizerGame\\.install\\(\\s*CT_GAMES\\[\\s*['"]${escRegExp(key)}['"]\\s*\\]\\s*,\\s*['"]${escRegExp(key)}['"]\\s*\\)`);
  if(index && !installDot.test(index) && !installBracket.test(index)){
    failures.push(`${rel(path.join(dir, 'index.js'))}: missing VisualizerGame.install registration`);
  }

  const rawAudioReads = logic.match(/\b(?:SND|Audio)\.(?:clock|grid|vis)\s*\(/g) || [];
  const indirectAudioReads = logic.match(/\bSND\s*(?:&&|\?)?[^\n;{}]{0,120}\.(?:clock|grid|vis)\s*\(/g) || [];
  const badReads = unique(rawAudioReads.concat(indirectAudioReads));
  if(badReads.length){
    failures.push(`${key}: definition/behavior must not read raw audio bus (${badReads.slice(0, 3).join(', ')})`);
  }

  if(reactions && !hasBindingTable(reactions)){
    failures.push(`${rel(path.join(dir, 'reactions.js'))}: missing explicit bindings table`);
  }
  for(const token of REACTION_TOKENS){
    if(reactions && !reactions.includes(token)){
      failures.push(`${rel(path.join(dir, 'reactions.js'))}: missing ${token}`);
    }
  }

  if(renderer){
    const hasRenderLifecycle = /render\s*:/.test(renderer) || /\brender\s*(?:,|\})/.test(renderer);
    if(!hasRenderLifecycle){
      failures.push(`${rel(path.join(dir, 'renderer.js'))}: missing render lifecycle`);
    }
    if(!/dispose\s*:/.test(renderer)){
      pushIssue(target, `${rel(path.join(dir, 'renderer.js'))}: add dispose lifecycle when this pack is next touched`, failures, warnings);
    }
    if(!/performance\s*:/.test(renderer)){
      failures.push(`${rel(path.join(dir, 'renderer.js'))}: missing performance caps`);
    }
    const caps = ['maxEntities', 'maxParticles', 'maxEventsPerFrame'];
    const presentCaps = caps.filter(cap => renderer.includes(cap));
    if(presentCaps.length < 2){
      failures.push(`${rel(path.join(dir, 'renderer.js'))}: performance block needs at least two caps (${caps.join(', ')})`);
    } else if(presentCaps.length < caps.length){
      pushIssue(target, `${rel(path.join(dir, 'renderer.js'))}: add ${caps.filter(cap => !presentCaps.includes(cap)).join(', ')} when this pack is next touched`, failures, warnings);
    }
    if(!/usesReactStatePerFrame\s*:\s*false/.test(renderer)){
      pushIssue(target, `${rel(path.join(dir, 'renderer.js'))}: should declare usesReactStatePerFrame: false`, failures, warnings);
    }
    if(/legacyFrame/.test(renderer)){
      pushIssue(target, `${rel(path.join(dir, 'renderer.js'))}: explicit legacyFrame bridge remains; physical extraction still pending`, failures, warnings);
    }
  }

  if(active && failures.length === 0 && index.includes('throw new Error(')){
    failures.push(`${rel(path.join(dir, 'index.js'))}: active pack still contains scaffold throw`);
  }
  if(active && failures.length === 0 && renderer.includes('throw new Error(')){
    failures.push(`${rel(path.join(dir, 'renderer.js'))}: active pack still contains scaffold throw`);
  }
  if(target.strict && renderer.includes('throw new Error(')){
    failures.push(`${rel(path.join(dir, 'renderer.js'))}: strict pack still contains scaffold throw`);
  }

  return { key, failures, warnings };
}

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const targets = resolveTargets(args).map(target => Object.assign({}, target, { strict }));
const results = targets.map(validatePack);
const failures = results.flatMap(result => result.failures);
const warnings = results.flatMap(result => result.warnings);

if(warnings.length){
  console.log('Warnings:');
  for(const warning of warnings) console.log('  - ' + warning);
}

if(failures.length){
  console.error('Game pack validation failed:');
  for(const failure of failures) console.error('  - ' + failure);
  process.exit(1);
}

console.log(`Game pack validation passed for ${targets.length} pack${targets.length === 1 ? '' : 's'}${strict ? ' in strict mode' : ''}.`);
