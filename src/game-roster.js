// Game roster contract. There is NO hardcoded game list anymore:
// - build time: scripts/game-roster.cjs scans packs/games/*/pack.json
// - runtime: GAMES derives from window.CT_GAMES after Packs.init()
// Only the layer concatenation order and the never-brick inline fallback live here.
const GAME_LAYER_ORDER = ['definition.js', 'behavior.js', 'reactions.js', 'renderer.js', 'index.js'];
// Packs inlined into the bundle so the app always has at least one working game
// even when every pack source fails. The loader skips already-registered ids.
const INLINE_FALLBACK_KEYS = ['balloon'];
