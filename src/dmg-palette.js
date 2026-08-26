// Four shades, at the point the art is drawn.
//
// The panel simulation quantises luminance, but it can only separate what the
// artwork already separates: our packs are authored in colour, and colours
// picked to look distinct in hue often sit within a few percent of each other
// in LUMINANCE. Fed through a DMG they collapse into one flat shade -- which is
// exactly what happened.
//
// So the fix belongs upstream of the shader: every colour a game sets is
// snapped to one of four well-spaced levels, the way a Game Boy artist had to
// choose one of four. One hook on the 2D context does this for all fourteen
// packs without touching their code, and lifting the hook restores them.
(function (G) {
  'use strict';

  // Four levels with deliberate spacing. Not evenly spread: the darkest step is
  // wider because ink reads as ink, and mid-tones need room to stay distinct.
  var LEVELS = [0.00, 0.38, 0.68, 1.00];

  var cache = Object.create(null);
  // Colours chosen to differ in HUE often sit within a few percent of each
  // other in luminance, so the mapping has to stretch before it quantises or an
  // outline and its fill land on the same shade. The range it stretches over is
  // FIXED, and deliberately so: an earlier version learned it from the colours
  // each pack happened to set, which made the mapping depend on drawing order
  // and re-map the whole picture whenever a new colour appeared -- the screen
  // visibly jumping darker mid-game. A Game Boy artist picks from a fixed
  // palette; so do we. The bounds are the range our packs actually draw in
  // (near-black fields, mid-to-bright sprites), measured off the stage.
  // Measured over all 621 colour literals in the fourteen packs: the art spans
  // the full range (p25 0.28, p50 0.52, p75 0.82), so the mapping is 1:1 and
  // the level spacing below bins it near-evenly (16/36/26/23% per shade).
  var SRC_LO = 0.00, SRC_HI = 1.00;
  var BG_MAX = 0.06;      // only this dark reads as "the field"
  // Bin edges for the three ink shades, calibrated against REAL Game Boy games.
  // Measured off native 160x144 captures (Link's Awakening 39/31/17/13, Donkey
  // Kong '94 50/35/0/15, Trip World 57/20/13/10, Balloon Kid 64/17/14/5): about
  // half the screen is the lightest shade, a strong second shade carries the
  // texture, and the two dark shades together are only 15-30%. Ink is spent
  // sparingly. Equal-third bins gave the opposite -- eleven of our fourteen
  // packs used essentially NO second shade while piling up dark ink -- so these
  // are the quantiles of our own art (measured by pixel area over all fourteen
  // packs) that reproduce the reference proportions: 50% of non-field pixels to
  // shade 1, 30% to shade 2, 20% to shade 3.
  var INK_EDGES = [0.275, 0.557];

  // Which of the four shades a luminance belongs to. Level 0 is the field and
  // is reserved for near-black, so nothing a pack draws can vanish into it.
  function inkLevel(raw) {
    if (raw <= BG_MAX) return 0;
    return raw < INK_EDGES[0] ? 1 : (raw < INK_EDGES[1] ? 2 : 3);
  }

  function parse(css) {
    if (typeof css !== 'string') return null;
    var s = css.trim();
    var m = /^#([0-9a-f]{3})$/i.exec(s);
    if (m) return [parseInt(m[1][0] + m[1][0], 16), parseInt(m[1][1] + m[1][1], 16),
                   parseInt(m[1][2] + m[1][2], 16), 1];
    m = /^#([0-9a-f]{6})$/i.exec(s);
    if (m) return [parseInt(m[1].slice(0,2),16), parseInt(m[1].slice(2,4),16),
                   parseInt(m[1].slice(4,6),16), 1];
    m = /^#([0-9a-f]{8})$/i.exec(s);
    if (m) return [parseInt(m[1].slice(0,2),16), parseInt(m[1].slice(2,4),16),
                   parseInt(m[1].slice(4,6),16), parseInt(m[1].slice(6,8),16)/255];
    m = /^rgba?\(([^)]+)\)$/i.exec(s);
    if (m) {
      var p = m[1].split(',').map(function (x) { return parseFloat(x); });
      if (p.length >= 3) return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
    }
    // hsl() is a colour like any other and the packs use it -- vortex draws
    // ENTIRELY in hsl, so without this every one of its pixels sailed past the
    // quantiser unchanged: 100% of that game was off-palette.
    m = /^hsla?\(([^)]+)\)$/i.exec(s);
    if (m) {
      var q = m[1].split(',').map(function (x) { return parseFloat(x); });
      if (q.length >= 3) {
        var hh = ((q[0] % 360) + 360) % 360 / 360, ss = q[1] / 100, ll = q[2] / 100;
        var cc = (1 - Math.abs(2 * ll - 1)) * ss;
        var xx = cc * (1 - Math.abs(((hh * 6) % 2) - 1));
        var mm = ll - cc / 2, seg = Math.floor(hh * 6) % 6;
        var rgb = [[cc,xx,0],[xx,cc,0],[0,cc,xx],[0,xx,cc],[xx,0,cc],[cc,0,xx]][seg];
        return [(rgb[0] + mm) * 255, (rgb[1] + mm) * 255, (rgb[2] + mm) * 255,
                q.length > 3 ? q[3] : 1];
      }
    }
    return null;
  }

  // Byte values of the four levels, so a colour that is ALREADY one of them is
  // passed through untouched. Without this quantize is not idempotent -- 97 maps
  // to 173 and 173 to 255 -- so any code that reads a quantised colour back and
  // re-sets it walks a shade darker every time. Sprite baking does exactly that.
  var LEVEL_BYTES = LEVELS.map(function (v) { return Math.round(v * 255); });
  function onPalette(c) {
    return c[3] >= 1 && c[0] === c[1] && c[1] === c[2] && LEVEL_BYTES.indexOf(c[0]) >= 0;
  }
  // A Game Boy pixel is drawn or it is not, and that applies to alpha carried in
  // the COLOUR exactly as it does to globalAlpha. The packs use rgba() for
  // shadows and sheens -- racer has ten, dungeon thirteen -- and leaving that
  // alpha intact put a fifth of some frames between shades.
  function bitAlpha(a) { return (typeof a === 'number' && a < 0.5) ? 0 : 1; }

  function quantize(css) {
    if (css in cache) return cache[css];
    var c = parse(css);
    var out = css;
    if (c && onPalette(c)) { cache[css] = css; return css; }
    if (c) {
      var raw = (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
      // Level 0 is the BACKGROUND -- the packs clear to black and the panel
      // inverts, so level 0 becomes the bare reflector. Anything else that
      // quantises to level 0 is therefore invisible, which is not a subtle
      // wash but a disappearance: the pyramid's cubes were drawn, in a colour
      // that landed on level 0, and the game showed no playing field at all.
      // So only near-black reaches level 0; every colour a pack actually draws
      // is spread over the remaining three, the way Game Boy art uses one
      // shade for the field and three for everything on it.
      var l = LEVELS[inkLevel(raw)];
      var best = 0, bd = 9;
      for (var i = 0; i < LEVELS.length; i++) {
        var d = Math.abs(LEVELS[i] - l);
        if (d < bd) { bd = d; best = i; }
      }
      var v = Math.round(LEVELS[best] * 255);
      out = bitAlpha(c[3]) ? 'rgb(' + v + ',' + v + ',' + v + ')'
                           : 'rgba(0,0,0,0)';
    }
    cache[css] = out;
    return out;
  }

  // A fill that covers most of the screen IS the field, whatever colour it was
  // authored in, and on a Game Boy the field is the lightest shade -- that is
  // what every sprite and every piece of terrain reads against. Our packs paint
  // skies, floors and arena backgrounds in mid-tones, which quantised to a
  // mid-ink shade and left nothing for the art to contrast with: the screen
  // filled with detail that had no ground to sit on. Routing the full-screen
  // fill to level 0 restores the convention, and it depends only on the rect's
  // size, so it cannot shimmer between frames the way a learned rule would.
  // Only the FIRST screen-covering fill of a frame is the field. Packs layer
  // several (clear, sky, arena floor, an overscanned backdrop); treating all of
  // them as the field painted the whole screen flat and the games vanished.
  var FIELD_FRACTION = 0.5;
  var FIELD_CSS = 'rgb(0,0,0)';          // level 0 -> the bare reflector
  var fieldArea = 0;
  function beginFrame() { fieldArea = 0; }

  // A Game Boy cannot blend. Every pixel is one of four shades, full stop --
  // measured on a real Link's Awakening frame: 4 shades, zero intermediate
  // values. Our packs lean on globalAlpha for fades and glows, and the result
  // was 89% of the platformer and 98% of vortex landing BETWEEN shades, which is
  // most of why they read as smeared modern art rather than Game Boy art.
  // Hardware would flicker a sprite on alternate frames instead; the honest
  // equivalent here is 1-bit alpha.
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
        configurable: true, enumerable: desc.enumerable,
        get: desc.get,
        set: function (v) {
          // gradients and patterns are objects; only strings are colours.
          // __ctpalRaw marks a canvas that is UI, not console art (the Create
          // editor's grid): its colours pass through, because 1-bit alpha
          // silently deletes every translucent fill it makes.
          desc.set.call(this, (typeof v === 'string' && !(this.canvas && this.canvas.__ctpalRaw)) ? quantize(v) : v);
        }
      });
    });
    var ga = Object.getOwnPropertyDescriptor(proto, 'globalAlpha');
    if (ga && ga.set) {
      savedAlpha = ga;
      Object.defineProperty(proto, 'globalAlpha', {
        configurable: true, enumerable: ga.enumerable, get: ga.get,
        set: function (v) {
          ga.set.call(this, (this.canvas && this.canvas.id === 'stage') ? bitAlpha(v) : v);
        }
      });
    }

    // Scoped to the stage: offscreen canvases (the sprite atlas) legitimately
    // have single pixels covering a large fraction of a tiny bitmap.
    savedRect = proto.fillRect;
    proto.fillRect = function (x, y, w, h) {
      if (installed && this.canvas && this.canvas.id === 'stage') {
        var area = this.canvas.width * this.canvas.height;
        // A black screen-covering fill is the frame CLEAR, not the field: the
        // runtime clears to #000 before the pack draws, and letting that take
        // the claim left every pack's real background -- a dungeon floor, an
        // arena -- to quantise as ordinary mid-ink with nothing to read against.
        // It is already level 0, so drawing it unchanged is correct anyway.
        var already = this.fillStyle;
        var isClear = (already === FIELD_CSS || already === '#000000' || already === '#000');
        var rect = Math.abs(w * h);
        // A screen-covering fill AFTER the field has been claimed is a flash,
        // not scenery -- an attack blink, a level-clear wash, a hit tint. Four
        // packs do it, and with 1-bit alpha every one of them snaps to fully
        // opaque and blanks the screen: the dungeon lost its whole room on each
        // sword swing. Hardware flickers the sprite instead, so drop it.
        // A FLASH covers essentially the whole canvas. A band covering half of
        // it is scenery -- Frogger's river is 59% and its road 59%, so treating
        // anything over half as a flash silently deleted the entire water
        // section once the road had claimed the field. Only near-full-screen
        // fills after the claim are dropped.
        if (!isClear && area > 0 && fieldArea > 0 && rect >= area * 0.9) return;
        if (!isClear && area > 0 && rect >= area * FIELD_FRACTION && rect > fieldArea) {
          fieldArea = rect;
          var prev = this.fillStyle;
          if (saved.fillStyle) saved.fillStyle.set.call(this, FIELD_CSS);
          savedRect.call(this, x, y, w, h);
          this.fillStyle = prev;
          return;
        }
      }
      return savedRect.call(this, x, y, w, h);
    };

    // A gradient is an object, so its colours never pass through the property
    // hook. But the deeper point is that a Game Boy cannot draw a gradient at
    // all -- there are four shades and no blending. The platformer painted its
    // sky as two gradients covering the whole screen, which is what left it with
    // no field and 91% of the frame on one mid shade. Flatten every gradient to
    // its first stop: one shade, the way the hardware would have it.
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
    PROPS.forEach(function (prop) {
      if (saved[prop]) Object.defineProperty(proto, prop, saved[prop]);
    });
    if (savedStop) { CanvasGradient.prototype.addColorStop = savedStop; savedStop = null; }
    if (savedRect) { proto.fillRect = savedRect; savedRect = null; }
    if (savedAlpha) { Object.defineProperty(proto, 'globalAlpha', savedAlpha); savedAlpha = null; }
    installed = false; saved = null;
  }

  // An outline drawn as `base * 0.55` is a MULTIPLICATIVE step, so a colour
  // already near either end of the range has nowhere to go and lands on its
  // own fill's shade -- 34% of the packs' fill/outline pairs did exactly that,
  // which is why adjacent blocks fused into one mass. `step` moves a fixed
  // number of SHADES instead, reflecting off the ends rather than clamping, so
  // a fill and its outline are always distinguishable on a four-shade panel.
  // n defaults to TWO shades, not one. On this panel adjacent shades land about
  // 20 luminance points apart, so a one-shade border is technically present and
  // practically invisible; two shades roughly doubles it (39 -> 52 on the dense
  // block measurement) and is what Game Boy art actually does -- dark outline,
  // light fill, no intermediate step.
  // Shade by ROLE, the way a Game Boy artist assigns them, for the cases a
  // size heuristic cannot see -- a floor drawn as a thousand tiles is still the
  // field. 0 field, 1 background detail, 2 foreground/terrain, 3 ink.
  var ROLES = { field: 0, back: 1, fore: 2, ink: 3 };
  function role(name) {
    var i = ROLES[name]; if (i == null) i = 0;
    var v = LEVEL_BYTES[i];
    return 'rgb(' + v + ',' + v + ',' + v + ')';
  }

  // The same per-sprite rank the sprite atlas uses, for inline pixel art drawn
  // through pix(): rank a sprite's OWN colours and hand the darkest the outline
  // shade, the lightest the interior, never the field. Squadron's enemies had
  // five colours of which three quantised to the darkest shade by absolute
  // luminance, so every ship was one solid blob. Memoised on the colour set,
  // since packs rebuild these little maps every frame.
  var spriteCache = Object.create(null);
  function spriteMap(map) {
    if (!map) return map;
    var keys = [], vals = [], k;
    for (k in map) { var v = map[k]; if (typeof v === 'string') { keys.push(k); vals.push(v); } }
    if (!keys.length) return map;
    // Colours that are ALREADY exact palette shades were assigned deliberately
    // by role() and must not be re-ranked: ranking two role colours flips them
    // by relative brightness, which turned a wall body assigned "ink" into the
    // field shade and deleted it. Rank only real, unquantised art.
    var allOn = true;
    for (var z = 0; z < vals.length; z++) {
      var pc = parse(vals[z]);
      if (!pc || !onPalette(pc)) { allOn = false; break; }
    }
    if (allOn) return map;

    var ck = vals.join('|');
    var hit = spriteCache[ck];
    if (!hit) {
      var uniq = [];
      for (var i = 0; i < vals.length; i++) if (uniq.indexOf(vals[i]) < 0) uniq.push(vals[i]);
      var lum = {};
      uniq.forEach(function (col) {
        var c = parse(col);
        lum[col] = c ? (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255 : 0.5;
      });
      var order = uniq.slice().sort(function (a, b) { return lum[a] - lum[b]; });
      hit = {};
      order.forEach(function (col, idx) {
        var t = order.length > 1 ? idx / (order.length - 1) : 0;
        // All FOUR shades, including the lightest. Reserving the field shade for
        // the background was wrong for sprites: a Game Boy sprite uses white for
        // eyes and highlights and holds its silhouette with the black outline,
        // not by avoiding white. Excluding it left every sprite in three mid
        // shades -- which is why eyes never read and why sprites looked oddly
        // tinted next to the real thing.
        var v2 = LEVEL_BYTES[Math.max(0, Math.min(3, 3 - Math.round(t * 3)))];
        hit[col] = 'rgb(' + v2 + ',' + v2 + ',' + v2 + ')';
      });
      spriteCache[ck] = hit;
    }
    var out = {};
    for (k in map) out[k] = (typeof map[k] === 'string' && hit[map[k]]) ? hit[map[k]] : map[k];
    return out;
  }

  // THE PLAYER. On a Game Boy the main character is the highest-contrast sprite
  // on screen -- a light body inside a hard black outline -- so it never reads
  // as one more enemy. Ranking a hero's colours like any other sprite spreads it
  // across the middle shades and it disappears into the crowd, which is exactly
  // what happened: every pack's player looked like a small enemy.
  function heroMap(map) {
    if (!map) return map;
    var vals = [], k;
    for (k in map) if (typeof map[k] === 'string') vals.push(map[k]);
    if (!vals.length) return map;
    var lum = {}, uniq = [];
    vals.forEach(function (c) {
      if (uniq.indexOf(c) < 0) { uniq.push(c);
        var pc = parse(c);
        lum[c] = pc ? (0.299 * pc[0] + 0.587 * pc[1] + 0.114 * pc[2]) / 255 : 0.5; }
    });
    var order = uniq.slice().sort(function (a, b) { return lum[a] - lum[b]; });
    // Darkest -> ink (the outline), LIGHTEST -> field (eyes and highlights),
    // everything between -> foreground. Mapping all non-darkest colours to the
    // field made the body white, and the field IS white: the player became a
    // white shape on a white floor held together by a hairline, which is why
    // Pac-Man and Mario were invisible. The body has to carry weight.
    // Three shades, NONE of them the field. Putting the lightest colour on the
    // field shade meant that wherever the sprite was light it matched the floor
    // and disappeared -- the squadron ship lost its hull and read as three
    // detached fragments. A hero is drawn ON the field, so it uses the other
    // three: ink outline, solid body, light detail.
    // BANDED by rank, not "darkest / lightest / everything else". A sprite with
    // fourteen colours -- the platformer's hero has red, blue, brown and black,
    // every one of them in the dark half of the range -- put twelve of them in
    // the single middle band and drew as one solid blob. Splitting by position
    // in the sprite's own ordering gives it an outline, a body and a highlight
    // whatever its authored colours happen to be. None of them is the field, so
    // it can never match the floor it stands on.
    var out = {}, n = order.length;
    var rank = {};
    order.forEach(function (c, i) { rank[c] = n > 1 ? i / (n - 1) : 0; });
    for (k in map) {
      var v = map[k];
      if (typeof v !== 'string') { out[k] = v; continue; }
      var t = rank[v];
      out[k] = t < 0.25 ? role('ink') : (t < 0.62 ? role('fore') : role('back'));
    }
    return out;
  }

  // BACKGROUND DECOR. Scenery uses only the two light shades, so it recedes and
  // can never be confused with something that matters. A bush is two greens;
  // ranked like any sprite the darker one becomes ink -- the same shade as an
  // enemy -- and the player cannot tell shrubbery from a thing that kills them.
  // Depth on this hardware is shade, and the background gets the light half.
  function decorMap(map) {
    if (!map) return map;
    var uniq = [], lum = {}, k;
    for (k in map) {
      var v = map[k];
      if (typeof v !== 'string' || uniq.indexOf(v) >= 0) continue;
      uniq.push(v);
      var c = parse(v);
      lum[v] = c ? (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255 : 0.5;
    }
    if (!uniq.length) return map;
    var order = uniq.slice().sort(function (a, b) { return lum[a] - lum[b]; });
    var out = {}, n = order.length, rank = {};
    order.forEach(function (c, i) { rank[c] = n > 1 ? i / (n - 1) : 0; });
    for (k in map) {
      var v2 = map[k];
      out[k] = (typeof v2 !== 'string') ? v2 : (rank[v2] < 0.5 ? role('back') : role('field'));
    }
    return out;
  }

  function step(css, n) {
    var c = parse(css);
    if (!c) return css;
    var raw = (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
    var at = inkLevel(raw);
    var to = at + (n == null ? 2 : n);
    if (to > LEVELS.length - 1 || to < 0) to = at - (n == null ? 2 : n);   // reflect
    // never step onto the background shade: an outline there is an outline gone
    to = Math.max(at === 0 ? 0 : 1, Math.min(LEVELS.length - 1, to));
    var v = Math.round(LEVELS[to] * 255);
    return c[3] >= 1 ? 'rgb(' + v + ',' + v + ',' + v + ')'
                     : 'rgba(' + v + ',' + v + ',' + v + ',' + c[3] + ')';
  }

  var API = { install: install, uninstall: uninstall, quantize: quantize, step: step, beginFrame: beginFrame, role: role, spriteMap: spriteMap, heroMap: heroMap, decorMap: decorMap,
              LEVELS: LEVELS, LEVEL_BYTES: LEVEL_BYTES,
              get installed() { return installed; } };
  G.CT_DMG_PALETTE = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : window);
