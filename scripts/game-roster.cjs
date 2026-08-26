// Source-directory scanner for the fixed bundled roster.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const GAME_LAYER_ORDER = ['definition.js', 'behavior.js', 'reactions.js', 'renderer.js', 'index.js'];
const INLINE_FALLBACK_KEYS = ['hover'];

function scanGamePacks(root) {
  const base = root || path.join(ROOT, 'packs', 'games');
  if (!fs.existsSync(base)) return [];
  const out = [];
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const id = entry.name;
    if (!/^[a-z][a-z0-9_]{1,31}$/.test(id)) continue;
    const dir = path.join(base, id);
    if (!GAME_LAYER_ORDER.every(file => fs.existsSync(path.join(dir, file)))) continue;
    out.push({ id, dir });
  }
  out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

module.exports = { GAME_LAYER_ORDER, INLINE_FALLBACK_KEYS, scanGamePacks };
