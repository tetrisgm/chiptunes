// Which console's colour rules are in force.
//
// The packs do not care whether they are drawing for a Game Boy or an NES. They
// care about the same four things either way: what the FIELD is, what recedes
// into the BACKGROUND, what sits in the FOREGROUND, and what has to read at any
// cost. Both consoles answer those four questions, in four shades or in
// twenty-five colours, so the packs ask this module and it forwards.
//
// It also enforces the one invariant neither palette module can enforce alone:
// exactly one of them may have the canvas hooked at a time. They install the
// same property descriptors on CanvasRenderingContext2D.prototype, so a second
// install would capture the first one's hooks as its "original" and an
// uninstall would then restore a wrapper instead of the real setter -- every
// colour on the page quantised forever, including after the panel was turned
// off.
(function (G) {
  'use strict';

  var MODES = {};
  var current = null;

  function register(name, mod) { if (mod) MODES[name] = mod; }
  register('dmg', G.CT_DMG_PALETTE);
  register('nes', G.CT_NES_PALETTE);

  // Returns true if the installed vocabulary CHANGED, which the caller needs to
  // know: the sprite atlas is baked through the hook, and drawImage does not go
  // through it, so an atlas baked under one console keeps its colours under the
  // next one unless it is re-baked.
  function use(name) {
    var next = name ? MODES[name] : null;
    if (next === current) return false;
    if (current && current.uninstall) current.uninstall();
    current = next || null;
    if (current && current.install) current.install();
    return true;
  }

  function active() { return current; }

  // Forwarders. With no console installed these are identities, so a pack can
  // call them unconditionally and get its own colours back in the normal view.
  function role(n) { return current ? current.role(n) : '#ffffff'; }
  function quantize(c) { return current ? current.quantize(c) : c; }
  function step(c, n) { return current ? current.step(c, n) : c; }
  function spriteMap(m) { return current ? current.spriteMap(m) : m; }
  function heroMap(m) { return current ? current.heroMap(m) : m; }
  function decorMap(m) { return current ? current.decorMap(m) : m; }
  function beginFrame() { if (current && current.beginFrame) current.beginFrame(); }

  var API = { use: use, active: active, register: register,
              role: role, quantize: quantize, step: step,
              spriteMap: spriteMap, heroMap: heroMap, decorMap: decorMap,
              beginFrame: beginFrame,
              get installed() { return !!(current && current.installed); },
              get name() { var k; for (k in MODES) if (MODES[k] === current) return k; return null; } };
  G.CT_PAL = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : window);
