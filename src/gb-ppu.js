// The picture, from VRAM.
//
// Enough of a DMG PPU to display what our own cartridge draws: the background
// layer, tiles from $8000 or $8800, the map at $9800 or $9C00, scrolled by
// SCX/SCY, through BGP. No sprites and no window, because the driver uses
// neither -- this is a display for a music cartridge, not a general emulator,
// and pretending otherwise would be code nothing exercises.
//
// The four shades are the ones src/dmg-palette.js already calls the DMG's, so a
// cartridge shown here and a game shown on the Game Boy panel are the same green.
(function (G) {
  'use strict';

  // The DMG's four shades, lightest first, as the reflector actually looks.
  var SHADES = [[0xE0, 0xE8, 0xB0], [0x88, 0xA0, 0x50], [0x38, 0x60, 0x30], [0x10, 0x20, 0x10]];

  function Ppu(opts) {
    opts = opts || {};
    this.w = 160; this.h = 144;
    this.shades = opts.shades || SHADES;
    this.rgba = new Uint8ClampedArray(this.w * this.h * 4);
    for (var i = 3; i < this.rgba.length; i += 4) this.rgba[i] = 255;
  }

  // `vram` is the 8KB block starting at $8000; `io` is the $FF00 page.
  Ppu.prototype.render = function (vram, io) {
    var lcdc = io[0x40], bgp = io[0x47], scy = io[0x42], scx = io[0x43];
    var on = !!(lcdc & 0x80), bgOn = !!(lcdc & 0x01);
    var mapBase = (lcdc & 0x08) ? 0x1C00 : 0x1800;
    var signed = !(lcdc & 0x10);                 // $8800 addressing uses signed indices
    var px = this.rgba, sh = this.shades, x, y;
    // Shades come out of BGP two bits at a time: it maps colour NUMBERS to
    // shades, which is what lets a game fade by rewriting one register.
    var pal = [bgp & 3, (bgp >> 2) & 3, (bgp >> 4) & 3, (bgp >> 6) & 3];
    for (y = 0; y < this.h; y++) {
      var sy = (y + scy) & 255, ty = sy >> 3, fy = sy & 7;
      for (x = 0; x < this.w; x++) {
        var c = 0;
        if (on && bgOn) {
          var sx = (x + scx) & 255, tx = sx >> 3, fx = sx & 7;
          var idx = vram[mapBase + ty * 32 + tx];
          var tile = signed ? (0x1000 + (((idx << 24) >> 24) * 16)) : (idx * 16);
          var lo = vram[tile + fy * 2], hi = vram[tile + fy * 2 + 1];
          var b = 7 - fx;
          c = ((lo >> b) & 1) | (((hi >> b) & 1) << 1);
        }
        var s = sh[pal[c]], o = (y * this.w + x) * 4;
        px[o] = s[0]; px[o + 1] = s[1]; px[o + 2] = s[2];
      }
    }
    return px;
  };

  var API = { Ppu: Ppu, SHADES: SHADES };
  G.CT_GB_PPU = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : window);
