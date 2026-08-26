// Twenty-five colours, at the point the art is drawn.
//
// The famous NES limit is not "64 colours". It is that only ONE backdrop plus
// four three-colour background sub-palettes plus four three-colour sprite
// sub-palettes are selected at a time -- twenty-five entries for the whole
// screen, in families of three. That restriction is what makes NES art look
// like NES art: colours repeat, scenery shares a ramp with other scenery, and
// nothing on screen is off on its own.
//
// So, exactly as src/dmg-palette.js does for the Game Boy's four shades, the
// constraint is applied UPSTREAM of the display simulation. Feeding 24-bit art
// through an NTSC filter gets you 24-bit art that looks slightly blurry; the
// hardware never had those colours to send.
//
// The sub-palettes are FIXED per track and hand-authored, the way a game's
// artist picks them. An earlier design in dmg-palette.js learned the mapping
// from whatever colours a pack happened to set, which made it depend on drawing
// order and re-map the screen mid-frame; that lesson transfers directly.
//
// This module deliberately duplicates dmg-palette.js's context hooks rather
// than sharing them. They are ~80 lines, the two modules are mutually exclusive
// (src/palette.js enforces that), and the Game Boy path is working -- rewriting
// it to share machinery risks the one mode that is already right.
(function (G) {
  'use strict';

  var SIG = G.CT_NES_SIGNAL || (typeof require !== 'undefined' && require('./nes-signal.js'));

  // Sub-palette sets. Each is [backdrop, 4 background triples, 4 sprite
  // triples], written as 2C02 indices -- (level << 4) | hue -- because that is
  // what the hardware selects and it keeps the ramps honest: a triple that runs
  // 0x06,0x16,0x26 is one hue at three levels, which is how NES artists built
  // nearly every ramp they used.
  //
  // Our packs draw bright art on a near-black field, which happens to be how
  // NES games are lit too, so unlike the Game Boy panel nothing has to be
  // inverted. The backdrop is dark and everything reads against it.
  var SCHEMES = [
    { name: 'overworld', backdrop: 0x01,
      bg: [[0x09,0x19,0x29], [0x07,0x17,0x27], [0x01,0x11,0x21], [0x00,0x10,0x20]],
      sp: [[0x06,0x16,0x26], [0x08,0x18,0x28], [0x0A,0x1A,0x2A], [0x06,0x16,0x37]] },
    // sp[3] is reserved for the PLAYER in every scheme, so it is written as a
    // real three-step ramp -- dark outline, saturated body, light highlight --
    // the way a hero's sub-palette is drawn on hardware. It cannot be a hue-0
    // grey ramp: levels 2 and 3 of hue 0 are BOTH pure white (the signal is
    // clamped high at both), so [0x10,0x20,0x30] gives a two-tone hero.
    { name: 'cavern', backdrop: 0x0F,
      bg: [[0x03,0x13,0x23], [0x00,0x10,0x20], [0x0C,0x1C,0x2C], [0x04,0x14,0x24]],
      sp: [[0x17,0x27,0x37], [0x11,0x21,0x31], [0x1A,0x2A,0x3A], [0x02,0x12,0x30]] },
    { name: 'inferno', backdrop: 0x0F,
      bg: [[0x06,0x16,0x26], [0x07,0x17,0x27], [0x08,0x18,0x28], [0x00,0x10,0x20]],
      sp: [[0x17,0x27,0x37], [0x18,0x28,0x38], [0x06,0x16,0x26], [0x07,0x18,0x38]] },
    { name: 'ice', backdrop: 0x01,
      bg: [[0x0C,0x1C,0x2C], [0x01,0x11,0x21], [0x00,0x10,0x20], [0x02,0x12,0x22]],
      sp: [[0x16,0x26,0x36], [0x17,0x27,0x37], [0x1C,0x2C,0x3C], [0x01,0x11,0x30]] },
    { name: 'neon', backdrop: 0x0F,
      bg: [[0x04,0x14,0x24], [0x02,0x12,0x22], [0x0C,0x1C,0x2C], [0x0A,0x1A,0x2A]],
      sp: [[0x14,0x24,0x34], [0x1C,0x2C,0x3C], [0x18,0x28,0x38], [0x04,0x14,0x34]] },
    // A top-down adventure needs green for foliage and a pale earth to walk on,
    // and four of the six schemes above contain no green whatsoever -- so on two
    // thirds of tracks a wood came out pink or violet. A real cartridge ships
    // its own palettes rather than inheriting the console's; games ask for a
    // family by name through CT_NES_PALETTE.selectScheme(n, allowed).
    { name: 'woodland', backdrop: 0x0F,
      bg: [[0x09,0x19,0x29],   // foliage: dark, mid, light green
           [0x07,0x17,0x37],   // earth: brown up to pale sand
           [0x08,0x18,0x38],   // ground: olive up to cream
           [0x00,0x10,0x20]],  // rock
      sp: [[0x06,0x16,0x26], [0x11,0x21,0x31], [0x0A,0x1A,0x2A], [0x09,0x19,0x37]] },
    { name: 'dusk', backdrop: 0x03,
      bg: [[0x05,0x15,0x25], [0x07,0x17,0x27], [0x03,0x13,0x23], [0x00,0x10,0x20]],
      sp: [[0x18,0x28,0x38], [0x16,0x26,0x36], [0x11,0x21,0x31], [0x05,0x15,0x36]] }
  ];

  function lum(c) { return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255; }
  function cssOf(idx) { return SIG.css(idx, 0); }

  var scheme = null, active = null, ranked = null, roleCss = null;
  var cache = Object.create(null), spriteCache = Object.create(null);

  // Roles are derived from CONTRAST AGAINST THE BACKDROP, not hand-assigned per
  // scheme. Hand-assigning them meant every new scheme was a fresh chance to
  // pick an "ink" that happened to sit near its own backdrop and vanish -- the
  // exact failure the Game Boy path spent several rounds fixing. Ranking by
  // distance from the field cannot produce an invisible role in any scheme.
  // `allowed` is an optional list of scheme names to choose among -- a game
  // saying which palettes its art was drawn for. The index still comes from the
  // track, so a given song and game always land on the same one.
  function selectScheme(n, allowed) {
    var pool = SCHEMES;
    if (allowed && allowed.length) {
      var want = SCHEMES.filter(function (x) { return allowed.indexOf(x.name) >= 0; });
      if (want.length) pool = want;
    }
    var s = pool[((n | 0) % pool.length + pool.length) % pool.length];
    if (scheme === s) return;
    scheme = s;
    cache = Object.create(null); spriteCache = Object.create(null);
    var idx = [s.backdrop], i;
    for (i = 0; i < s.bg.length; i++) idx = idx.concat(s.bg[i]);
    for (i = 0; i < s.sp.length; i++) idx = idx.concat(s.sp[i]);
    var seen = {}, uniq = [];
    idx.forEach(function (k) { if (!seen[k]) { seen[k] = 1; uniq.push(k); } });
    active = uniq.map(function (k) {
      var b = SIG.bytes(k, 0);
      var hs = hueSat(b);
      return { idx: k, rgb: b, css: 'rgb(' + b[0] + ',' + b[1] + ',' + b[2] + ')', l: lum(b),
               hue: hs[0], sat: hs[1] };
    });
    // Roles rank over the BACKGROUND families only, never the sprite ones.
    // Ranking over all twenty-five let scenery reach a sprite colour, and it
    // showed: the ice scheme drew its playfield in the orange reserved for
    // enemies, because that orange happened to sit at the right contrast from
    // the backdrop. On hardware a background tile simply cannot address a
    // sprite sub-palette, and honouring that is also what makes a scheme look
    // like the thing it is named after. Sprite families stay reachable through
    // spriteMap and heroMap, which is how a sprite reaches them on hardware.
    var bgIdx = [s.backdrop], bi;
    for (bi = 0; bi < s.bg.length; bi++) bgIdx = bgIdx.concat(s.bg[bi]);
    var bl = lum(SIG.bytes(s.backdrop, 0));
    ranked = active.filter(function (a) { return bgIdx.indexOf(a.idx) >= 0; })
                   .sort(function (a, b) { return Math.abs(a.l - bl) - Math.abs(b.l - bl); });
    var n2 = ranked.length;
    roleCss = {
      field: cssOf(s.backdrop),
      back:  ranked[Math.min(n2 - 1, Math.round(n2 * 0.35))].css,
      fore:  ranked[Math.min(n2 - 1, Math.round(n2 * 0.68))].css,
      ink:   ranked[n2 - 1].css
    };
  }
  selectScheme(0);

  // --- colour parsing (same grammar the packs actually use) -----------------
  function parse(css) {
    if (typeof css !== 'string') return null;
    var s = css.trim(), m;
    m = /^#([0-9a-f]{3})$/i.exec(s);
    if (m) return [parseInt(m[1][0]+m[1][0],16), parseInt(m[1][1]+m[1][1],16), parseInt(m[1][2]+m[1][2],16), 1];
    m = /^#([0-9a-f]{6})$/i.exec(s);
    if (m) return [parseInt(m[1].slice(0,2),16), parseInt(m[1].slice(2,4),16), parseInt(m[1].slice(4,6),16), 1];
    m = /^#([0-9a-f]{8})$/i.exec(s);
    if (m) return [parseInt(m[1].slice(0,2),16), parseInt(m[1].slice(2,4),16), parseInt(m[1].slice(4,6),16), parseInt(m[1].slice(6,8),16)/255];
    m = /^rgba?\(([^)]+)\)$/i.exec(s);
    if (m) { var p = m[1].split(',').map(parseFloat); if (p.length >= 3) return [p[0],p[1],p[2], p.length>3?p[3]:1]; }
    m = /^hsla?\(([^)]+)\)$/i.exec(s);
    if (m) {
      var q = m[1].split(',').map(parseFloat);
      if (q.length >= 3) {
        var hh = ((q[0]%360)+360)%360/360, ss = q[1]/100, ll = q[2]/100;
        var cc = (1-Math.abs(2*ll-1))*ss, xx = cc*(1-Math.abs(((hh*6)%2)-1));
        var mm = ll-cc/2, seg = Math.floor(hh*6)%6;
        var rgb = [[cc,xx,0],[xx,cc,0],[0,cc,xx],[0,xx,cc],[xx,0,cc],[cc,0,xx]][seg];
        return [(rgb[0]+mm)*255, (rgb[1]+mm)*255, (rgb[2]+mm)*255, q.length>3?q[3]:1];
      }
    }
    return null;
  }

  // The NES cannot blend either: a pixel is one palette entry or it is the
  // backdrop. Alpha carried in a colour is as unrepresentable as globalAlpha.
  function bitAlpha(a) { return (typeof a === 'number' && a < 0.5) ? 0 : 1; }

  var BG_MAX = 0.06;      // only this dark may collapse into the backdrop

  function hueSat(b) {
    var r = b[0]/255, g = b[1]/255, bl = b[2]/255;
    var mx = Math.max(r,g,bl), mn = Math.min(r,g,bl), d = mx-mn;
    if (d === 0) return [0, 0];
    var h = mx===r ? ((g-bl)/d)%6 : mx===g ? (bl-r)/d+2 : (r-g)/d+4;
    return [((h*60)%360+360)%360, d/Math.max(0.0001,mx)];
  }

  // Nearest entry in the ACTIVE SET, weighted toward luma. Chroma is cheap to
  // get slightly wrong -- the eye forgives a green that lands one hue over --
  // but luma carries the shape, so matching brightness first is what keeps an
  // outline separable from its fill after twenty-five colours have absorbed
  // several hundred.
  function nearest(c, allowField) {
    var l = lum(c), best = null, bd = Infinity;
    var hs = hueSat(c), ch = hs[0], cs = hs[1];
    for (var i = 0; i < active.length; i++) {
      var a = active[i];
      if (!allowField && a.idx === scheme.backdrop) continue;
      var dl = (a.l - l), dr = (a.rgb[0]-c[0])/255, dg = (a.rgb[1]-c[1])/255, db = (a.rgb[2]-c[2])/255;
      var d = dl*dl*6 + dr*dr + dg*dg + db*db;
      // A saturated colour must not land on a VIVID WRONG hue -- a dark purple
      // that comes back teal reads as a bug, where the same purple coming back
      // grey just reads as a muted screen. Grey entries carry no penalty, so
      // when the scheme has nothing in the input's hue family the match
      // degrades to luma honestly instead of lying about hue.
      if (cs > 0.25 && a.sat > 0.25) {
        var hd = Math.abs(a.hue - ch); if (hd > 180) hd = 360 - hd;
        d += (hd/180)*(hd/180) * 3 * cs * a.sat;
      }
      if (d < bd) { bd = d; best = a; }
    }
    return (best || active[0]).css;
  }

  function quantize(css) {
    if (css in cache) return cache[css];
    var c = parse(css), out = css;
    if (c) {
      if (!bitAlpha(c[3])) out = 'rgba(0,0,0,0)';
      // Near-black IS the backdrop -- not "allowed to be": the runtime clears to
      // #000 and the packs paint their fields dark, and on hardware that is
      // literally what the backdrop register shows. Letting it merely compete
      // sent the frame clear to whichever active colour happened to sit nearest
      // in the metric, which for the overworld scheme was a dark GREEN.
      // Everything above the threshold is spread over the other twenty-four, so
      // nothing a pack draws can quietly become the background and vanish.
      else if (lum(c) <= BG_MAX) out = role('field');
      else out = nearest(c, false);
    }
    cache[css] = out;
    return out;
  }

  function role(name) { return roleCss[name] || roleCss.field; }

  // --- role-aware maps, same vocabulary the packs already call --------------
  // A sprite's own colours are ranked and handed a sub-palette, dark to light.
  // Ranking within the sprite rather than by absolute luma is what stops five
  // colours that are all dark from collapsing into one blob.
  function ramp(kind, n) {
    var tri = kind === 'sprite' ? scheme.sp : scheme.bg;
    return tri[n % tri.length].map(cssOf);
  }

  function onActive(css) {
    var c = parse(css); if (!c || c[3] < 1) return false;
    for (var i = 0; i < active.length; i++)
      if (active[i].rgb[0] === c[0] && active[i].rgb[1] === c[1] && active[i].rgb[2] === c[2]) return true;
    return false;
  }

  function rankOf(map) {
    var vals = [], k, uniq = [], l = {};
    for (k in map) if (typeof map[k] === 'string') vals.push(map[k]);
    vals.forEach(function (c) {
      if (uniq.indexOf(c) < 0) { uniq.push(c); var p = parse(c); l[c] = p ? lum(p) : 0.5; }
    });
    var order = uniq.slice().sort(function (a, b) { return l[a] - l[b]; });
    var rank = {}, n = order.length;
    order.forEach(function (c, i) { rank[c] = n > 1 ? i / (n - 1) : 0; });
    return { rank: rank, n: n };
  }

  function spriteMap(map) {
    if (!map) return map;
    var vals = [], k;
    for (k in map) if (typeof map[k] === 'string') vals.push(map[k]);
    if (!vals.length) return map;
    // Colours already assigned by role() were chosen deliberately; re-ranking
    // them by relative brightness flips them and can hand a deliberate "ink" the
    // backdrop. Pass those through untouched.
    var allOn = true;
    for (var z = 0; z < vals.length; z++) if (!onActive(vals[z])) { allOn = false; break; }
    if (allOn) return map;

    var ck = vals.join('|');
    var hit = spriteCache[ck];
    if (!hit) {
      var r = rankOf(map);
      // Which sprite sub-palette this sprite gets is decided by its own hue, so
      // a red enemy lands in the red family and a blue one in the blue family --
      // consistent between frames because it depends only on the colours, not
      // on when the sprite was drawn.
      var hueAcc = 0, cnt = 0;
      vals.forEach(function (c) { var p = parse(c); if (p) { hueAcc += p[0]*3 + p[1]*5 + p[2]*7; cnt++; } });
      var pal = ramp('sprite', cnt ? Math.round(hueAcc / cnt) : 0);
      hit = {};
      Object.keys(r.rank).forEach(function (c) {
        hit[c] = pal[Math.max(0, Math.min(pal.length - 1, Math.round(r.rank[c] * (pal.length - 1))))];
      });
      spriteCache[ck] = hit;
    }
    var out = {};
    for (k in map) out[k] = (typeof map[k] === 'string' && hit[map[k]]) ? hit[map[k]] : map[k];
    return out;
  }

  // THE PLAYER. On an NES the main character owns the most contrasting sprite
  // sub-palette on screen and never shares it with scenery. Ranking a hero like
  // any other sprite is what made every pack's player read as one more enemy on
  // the Game Boy panel; the same would happen here.
  function heroMap(map) {
    if (!map) return map;
    var r = rankOf(map), out = {}, k;
    if (!r.n) return map;
    var pal = ramp('sprite', 3);            // the high-contrast family, reserved
    for (k in map) {
      var v = map[k];
      if (typeof v !== 'string') { out[k] = v; continue; }
      var t = r.rank[v];
      out[k] = t < 0.25 ? pal[0] : (t < 0.62 ? pal[1] : pal[2]);
    }
    return out;
  }

  // BACKGROUND DECOR sits in a background family, never a sprite one, so it can
  // never be mistaken for something that matters. Depth on this hardware is
  // which sub-palette you are in.
  function decorMap(map) {
    if (!map) return map;
    var r = rankOf(map), out = {}, k;
    if (!r.n) return map;
    var pal = ramp('bg', 0);
    for (k in map) {
      var v = map[k];
      out[k] = (typeof v !== 'string') ? v
             : (r.rank[v] < 0.5 ? role('field') : pal[Math.min(pal.length - 1, 1)]);
    }
    return out;
  }

  // An outline drawn as `base * 0.55` is a multiplicative step and lands on its
  // own fill once the palette has quantised both. Step by RANK inside the
  // scheme's contrast ordering instead, reflecting off the ends.
  function step(css, n) {
    var c = parse(css); if (!c) return css;
    var l = lum(c), at = 0, bd = Infinity;
    for (var i = 0; i < ranked.length; i++) {
      var d = Math.abs(ranked[i].l - l); if (d < bd) { bd = d; at = i; }
    }
    var k = (n == null ? 6 : n * 3);
    var to = at + k;
    if (to > ranked.length - 1) to = at - k;
    to = Math.max(1, Math.min(ranked.length - 1, to));
    return ranked[to].css;
  }

  // --- the field claim ------------------------------------------------------
  var FIELD_FRACTION = 0.5;
  var fieldArea = 0;
  function beginFrame() { fieldArea = 0; }

  // --- context hooks --------------------------------------------------------
  var flatStops = (typeof WeakMap !== 'undefined') ? new WeakMap() : null;
  var PROPS = ['fillStyle', 'strokeStyle', 'shadowColor'];
  var installed = false, saved = null, savedStop = null, savedRect = null, savedAlpha = null;

  function install() {
    if (installed || typeof CanvasRenderingContext2D === 'undefined') return;
    var proto = CanvasRenderingContext2D.prototype;
    saved = {};
    PROPS.forEach(function (prop) {
      var desc = Object.getOwnPropertyDescriptor(proto, prop);
      if (!desc || !desc.set) return;
      saved[prop] = desc;
      Object.defineProperty(proto, prop, {
        configurable: true, enumerable: desc.enumerable, get: desc.get,
        set: function (v) { desc.set.call(this, typeof v === 'string' ? quantize(v) : v); }
      });
    });
    var ga = Object.getOwnPropertyDescriptor(proto, 'globalAlpha');
    if (ga && ga.set) {
      savedAlpha = ga;
      Object.defineProperty(proto, 'globalAlpha', {
        configurable: true, enumerable: ga.enumerable, get: ga.get,
        set: function (v) { ga.set.call(this, (this.canvas && this.canvas.id === 'stage') ? bitAlpha(v) : v); }
      });
    }
    savedRect = proto.fillRect;
    proto.fillRect = function (x, y, w, h) {
      if (installed && this.canvas && this.canvas.id === 'stage') {
        var area = this.canvas.width * this.canvas.height;
        var already = this.fillStyle;
        var isClear = (already === '#000000' || already === '#000' || already === 'rgb(0,0,0)');
        var rect = Math.abs(w * h);
        // After the field is claimed, a near-full-screen fill is a FLASH, and
        // with 1-bit alpha every flash snaps opaque and blanks the screen.
        if (!isClear && area > 0 && fieldArea > 0 && rect >= area * 0.9) return;
        if (!isClear && area > 0 && rect >= area * FIELD_FRACTION && rect > fieldArea) {
          fieldArea = rect;
          var prev = this.fillStyle;
          if (saved.fillStyle) saved.fillStyle.set.call(this, role('field'));
          savedRect.call(this, x, y, w, h);
          this.fillStyle = prev;
          return;
        }
      }
      return savedRect.call(this, x, y, w, h);
    };
    if (typeof CanvasGradient !== 'undefined' && CanvasGradient.prototype.addColorStop) {
      savedStop = CanvasGradient.prototype.addColorStop;
      CanvasGradient.prototype.addColorStop = function (off, col) {
        if (typeof col !== 'string') return savedStop.call(this, off, col);
        var first = flatStops.get(this);
        if (first === undefined) { first = quantize(col); flatStops.set(this, first); }
        return savedStop.call(this, off, first);
      };
    }
    installed = true;
  }

  function uninstall() {
    if (!installed) return;
    cache = Object.create(null);
    var proto = CanvasRenderingContext2D.prototype;
    PROPS.forEach(function (prop) { if (saved[prop]) Object.defineProperty(proto, prop, saved[prop]); });
    if (savedStop) { CanvasGradient.prototype.addColorStop = savedStop; savedStop = null; }
    if (savedRect) { proto.fillRect = savedRect; savedRect = null; }
    if (savedAlpha) { Object.defineProperty(proto, 'globalAlpha', savedAlpha); savedAlpha = null; }
    installed = false; saved = null;
  }

  var API = { install: install, uninstall: uninstall, quantize: quantize, step: step,
              beginFrame: beginFrame, role: role, spriteMap: spriteMap, heroMap: heroMap,
              decorMap: decorMap, selectScheme: selectScheme, SCHEMES: SCHEMES,
              get scheme() { return scheme; },
              get active() { return active.map(function (a) { return a.css; }); },
              get installed() { return installed; } };
  G.CT_NES_PALETTE = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : window);
