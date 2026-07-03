// Game roster scanner. The roster IS the directory tree: every packs/games/<id>/
// with a valid pack.json is a game pack. Build, validate, audit, and smoke all
// enumerate through scanGamePacks() — adding/removing a game is a folder operation.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const GAME_LAYER_ORDER = ['definition.js', 'behavior.js', 'reactions.js', 'renderer.js', 'index.js'];
// Must match src/game-roster.js: packs inlined in the bundle as the never-brick fallback.
const INLINE_FALLBACK_KEYS = ['balloon'];

function scanGamePacks(root) {
  const base = root || path.join(ROOT, 'packs', 'games');
  if (!fs.existsSync(base)) return [];
  const out = [];
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const id = entry.name;
    if (!/^[a-z][a-z0-9_]{1,31}$/.test(id)) continue;
    const dir = path.join(base, id);
    const manifestPath = path.join(dir, 'pack.json');
    if (!fs.existsSync(manifestPath)) continue;
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (err) {
      throw new Error('game-roster: invalid JSON in ' + path.relative(ROOT, manifestPath) + ': ' + err.message);
    }
    if (manifest.kind !== 'game') continue;
    if (manifest.id !== id) {
      throw new Error('game-roster: pack.json id "' + manifest.id + '" does not match folder ' + path.relative(ROOT, dir));
    }
    out.push({ id, dir, manifest });
  }
  out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

module.exports = { GAME_LAYER_ORDER, INLINE_FALLBACK_KEYS, scanGamePacks };
