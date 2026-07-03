// Shared pack build routine. build.js and pack-tools both require this so
// first-party and third-party game packs are compiled by the exact same code.
// buildGamePack(authoringDir) -> { manifest, code }
//   code = the 5 authoring layers concatenated in GAME_LAYER_ORDER, wrapped in
//   ONE IIFE (top-level consts in one pack cannot collide with another pack).
// buildComposerPack(srcFile[, manifest]) -> { manifest, code }
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const schema = require('./pack-schema.js');

// Canonical order; game-roster.cjs stays the source of truth when loadable.
const FALLBACK_LAYER_ORDER = ['definition.js', 'behavior.js', 'reactions.js', 'renderer.js', 'index.js'];

function gameLayerOrder() {
  try {
    const roster = require('../game-roster.cjs');
    if (roster && Array.isArray(roster.GAME_LAYER_ORDER) && roster.GAME_LAYER_ORDER.length) {
      return roster.GAME_LAYER_ORDER.slice();
    }
  } catch (e) { /* roster missing or mid-rewrite: fall back */ }
  return FALLBACK_LAYER_ORDER.slice();
}

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function readManifest(dir) {
  const file = path.join(dir, 'pack.json');
  if (!fs.existsSync(file)) throw new Error('missing ' + file);
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(file + ': invalid JSON (' + e.message + ')');
  }
  return manifest;
}

function assertValid(manifest, kind, where) {
  const res = schema.validateManifest(manifest);
  if (!res.ok) throw new Error(where + ': invalid manifest:\n  - ' + res.errors.join('\n  - '));
  if (manifest.kind !== kind) throw new Error(where + ': expected kind "' + kind + '", got "' + manifest.kind + '"');
}

function wrapIIFE(body) {
  return '(function(){\n' + body + '\n})();\n';
}

function buildGamePack(authoringDir) {
  const dir = path.resolve(authoringDir);
  const manifest = readManifest(dir);
  assertValid(manifest, 'game', dir);

  const order = gameLayerOrder();
  const parts = [];
  const missing = [];
  for (const layer of order) {
    const file = path.join(dir, layer);
    if (!fs.existsSync(file)) { missing.push(layer); continue; }
    const src = fs.readFileSync(file, 'utf8').replace(/\s+$/, '');
    parts.push('// === ' + manifest.id + '/' + layer + ' ===\n' + src);
  }
  if (missing.length) {
    throw new Error(dir + ': missing layer file(s): ' + missing.join(', '));
  }

  const code = wrapIIFE("'use strict';\n" + parts.join('\n\n'));
  const out = Object.assign({}, manifest, {
    entry: 'pack.js',
    entryHash: 'sha256-' + sha256(code)
  });
  return { manifest: out, code };
}

function buildComposerPack(srcFile, manifest) {
  const file = path.resolve(srcFile);
  if (!fs.existsSync(file)) throw new Error('missing ' + file);
  const src = fs.readFileSync(file, 'utf8').replace(/\s+$/, '');

  if (!manifest) {
    const packJson = path.join(path.dirname(file), 'pack.json');
    if (fs.existsSync(packJson)) manifest = JSON.parse(fs.readFileSync(packJson, 'utf8'));
  }
  if (!manifest) throw new Error(file + ': no manifest (pass one, or put pack.json next to the source)');
  manifest = Object.assign({ entry: 'composer.js', composerV: 3 }, manifest);
  assertValid(manifest, 'composer', file);

  const code = wrapIIFE("'use strict';\n// === " + manifest.id + '/' + path.basename(file) + ' ===\n' + src);
  const out = Object.assign({}, manifest, {
    entry: 'composer.js',
    entryHash: 'sha256-' + sha256(code)
  });
  return { manifest: out, code };
}

module.exports = {
  FALLBACK_LAYER_ORDER,
  gameLayerOrder,
  buildGamePack,
  buildComposerPack,
  sha256
};
