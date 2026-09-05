// Export a song as a real Game Boy cartridge image.
//
// The claim this file has to earn is "download it and play it on hardware", so
// nothing here approximates. The output is a 32 KiB ROM-only image with a valid
// header, a hand-written LR35902 driver, and the song as frame-scheduled
// register writes. scripts/verify-rom.js runs it on an emulated CPU and checks
// the APU writes match what src/gb-apu.js produces for the same score.
//
// The design decision that makes the driver small: every value the hardware
// needs is computed HERE, at export time, and stored ready to write. The
// cartridge never divides, never looks anything up, never computes a period --
// it copies four bytes into four registers. That is why the driver is ~200
// bytes and why there is very little of it that can be wrong.
//
// It leans on one piece of luck in the hardware: the four channels' register
// blocks start at $FF11, $FF16, $FF1B and $FF20 -- an arithmetic progression of
// five -- so selecting a channel is `$11 + ch*5` and the four writes are an
// `inc c` apart.
(function (G) {
  'use strict';

  // ---------------------------------------------------------------- assembler
  // A tiny emitter rather than a parser: each instruction is a method that
  // appends its own bytes. No text to mis-tokenise, and label fixups are the
  // only arithmetic. It covers exactly the opcodes the driver below uses.
  function Asm() { this.b = []; this.labels = {}; this.fix = []; }
  Asm.prototype = {
    byte: function (v) { this.b.push(v & 0xFF); return this; },
    word: function (v) { this.byte(v & 0xFF); this.byte((v >> 8) & 0xFF); return this; },
    label: function (n) { this.labels[n] = this.b.length; return this; },

    di:        function () { return this.byte(0xF3); },
    ei:        function () { return this.byte(0xFB); },
    reti:      function () { return this.byte(0xD9); },
    push_de:   function () { return this.byte(0xD5); },
    pop_de:    function () { return this.byte(0xD1); },
    ld_l_a:    function () { return this.byte(0x6F); },
    ld_h_a:    function () { return this.byte(0x67); },
    ld_a_l:    function () { return this.byte(0x7D); },
    ld_a_h:    function () { return this.byte(0x7C); },
    add_hl_bc: function () { return this.byte(0x09); },
    dec_a:     function () { return this.byte(0x3D); },
    halt:      function () { return this.byte(0x76); },
    ret:       function () { return this.byte(0xC9); },
    rlca:      function () { return this.byte(0x07); },
    or_a:      function () { return this.byte(0xB7); },          // or a
    push_af:   function () { return this.byte(0xF5); },
    pop_af:    function () { return this.byte(0xF1); },
    push_hl:   function () { return this.byte(0xE5); },
    pop_hl:    function () { return this.byte(0xE1); },
    push_bc:   function () { return this.byte(0xC5); },
    pop_bc:    function () { return this.byte(0xC1); },

    ld_a_n:    function (n) { return this.byte(0x3E).byte(n); },
    ld_b_n:    function (n) { return this.byte(0x06).byte(n); },
    ld_c_n:    function (n) { return this.byte(0x0E).byte(n); },
    ld_d_n:    function (n) { return this.byte(0x16).byte(n); },
    ld_e_n:    function (n) { return this.byte(0x1E).byte(n); },
    ld_a_b:    function () { return this.byte(0x78); },
    ld_a_c:    function () { return this.byte(0x79); },
    ld_a_d:    function () { return this.byte(0x7A); },
    ld_a_e:    function () { return this.byte(0x7B); },
    ld_b_a:    function () { return this.byte(0x47); },
    ld_c_a:    function () { return this.byte(0x4F); },
    ld_d_a:    function () { return this.byte(0x57); },
    ld_e_a:    function () { return this.byte(0x5F); },
    ld_a_hl:   function () { return this.byte(0x7E); },          // ld a,[hl]
    ld_a_hli:  function () { return this.byte(0x2A); },          // ld a,[hl+]
    ld_hl_a:   function () { return this.byte(0x77); },          // ld [hl],a
    inc_hl:    function () { return this.byte(0x23); },
    ld_hli_a:  function () { return this.byte(0x22); },          // ld [hl+],a
    add_hl_de: function () { return this.byte(0x19); },
    inc_a:     function () { return this.byte(0x3C); },
    add_a_n:   function (n) { return this.byte(0xC6).byte(n); },
    dec_c:     function () { return this.byte(0x0D); },
    inc_c:     function () { return this.byte(0x0C); },
    inc_de:    function () { return this.byte(0x13); },
    dec_b:     function () { return this.byte(0x05); },
    dec_d:     function () { return this.byte(0x15); },
    add_a_a:   function () { return this.byte(0x87); },
    add_a_b:   function () { return this.byte(0x80); },
    add_a_c:   function () { return this.byte(0x81); },
    and_n:     function (n) { return this.byte(0xE6).byte(n); },
    cp_n:      function (n) { return this.byte(0xFE).byte(n); },
    ld_a_de:   function () { return this.byte(0x1A); },          // ld a,[de]
    sub_n:     function (n) { return this.byte(0xD6).byte(n); },
    adc_a_b:   function () { return this.byte(0x88); },
    rra:       function () { return this.byte(0x1F); },          // a>>1 when carry is clear

    ld_sp_nn:  function (nn) { return this.byte(0x31).word(nn); },
    ld_hl_nn:  function (nn) { return this.byte(0x21).word(nn); },
    ld_de_nn:  function (nn) { return this.byte(0x11).word(nn); },
    ld_bc_nn:  function (nn) { return this.byte(0x01).word(nn); },

    ldh_n_a:   function (n) { return this.byte(0xE0).byte(n); }, // ldh [$FF00+n],a
    ldh_a_n:   function (n) { return this.byte(0xF0).byte(n); }, // ldh a,[$FF00+n]
    ldh_c_a:   function () { return this.byte(0xE2); },          // ldh [$FF00+c],a

    // relative jumps, resolved after the body is emitted
    _jr: function (op, lbl) {
      this.byte(op); this.fix.push({ at: this.b.length, lbl: lbl, rel: true }); return this.byte(0);
    },
    jr:    function (l) { return this._jr(0x18, l); },
    jr_z:  function (l) { return this._jr(0x28, l); },
    jr_nz: function (l) { return this._jr(0x20, l); },
    jr_c:  function (l) { return this._jr(0x38, l); },
    jr_nc: function (l) { return this._jr(0x30, l); },
    ld_hl_lbl: function (lbl) {
      this.byte(0x21); this.fix.push({ at: this.b.length, lbl: lbl, rel: false });
      return this.word(0);
    },
    jp: function (lbl) {
      this.byte(0xC3); this.fix.push({ at: this.b.length, lbl: lbl, rel: false });
      return this.word(0);
    },
    call: function (lbl) {
      this.byte(0xCD); this.fix.push({ at: this.b.length, lbl: lbl, rel: false });
      return this.word(0);
    },

    // `base` is where this code will live in the address space
    link: function (base) {
      for (var i = 0; i < this.fix.length; i++) {
        var f = this.fix[i], t = this.labels[f.lbl];
        if (t == null) throw new Error('gb-rom: unresolved label ' + f.lbl);
        if (f.rel) {
          var d = t - (f.at + 1);
          if (d < -128 || d > 127) throw new Error('gb-rom: jr out of range to ' + f.lbl);
          this.b[f.at] = d & 0xFF;
        } else {
          var abs = base + t;
          this.b[f.at] = abs & 0xFF; this.b[f.at + 1] = (abs >> 8) & 0xFF;
        }
      }
      this.b.labels = this.labels;
      return this.b;
    }
  };

  // ------------------------------------------------------------------- layout
  var ORG_CODE = 0x0150;          // execution starts here, after the header
  var ROM_SIZE = 0x8000;          // 32 KiB, no mapper

  // hardware registers, as offsets from $FF00
  var R = { NR50: 0x24, NR51: 0x25, NR52: 0x26, NR30: 0x1A, LY: 0x44, WAVE: 0x30,
            LCDC: 0x40, SCY: 0x42, SCX: 0x43, BGP: 0x47 };
  // HRAM the driver keeps for the display: a level per channel and its
  // complement, so the drawing loops are plain "repeat N times" counters. The
  // CPU model has no carry flag, so a >= comparison is not available and every
  // loop has to count down to zero instead.
  var H_LEVEL = 0x80, H_BLANK = 0x84, H_CH = 0x88, BAR_H = 15;
  // Vibrato state, one slot per pulse channel: base period lo/hi captured at
  // note-on, an age counter, an active flag, and the channel-1 sweep latch
  // that suppresses vibrato on a sliding note.
  var H_VLO = 0x90, H_VHI = 0x92, H_VAGE = 0x94, H_VON = 0x96, H_SWP = 0x98;
  // the kit streamer's state: where the sample is, and how many 32-nibble
  // buffers of it are left
  var H_KITLO = 0x9A, H_KITHI = 0x9B, H_KITN = 0x9C;
  var KIT_PERIOD = 1792, KIT_TMA = 240;   // 8192 samples a second, 256 buffers
  var BAR_COL = [2, 7, 12, 17];              // 4 bars, 3 tiles wide, on a 20-tile screen
  var BAR_TOP = 2;                           // row 0 is the title, row 17 the labels

  // A 5x7 font, one byte a row, bit 7 leftmost. Only the glyphs the screen
  // actually uses -- the cartridge is a music ROM, not a text terminal, and 14
  // letters cost 224 bytes where a full ASCII set would cost 1.5K for nothing.
  //
  // The boot logo says Nintendo because the DMG's boot ROM compares those 48
  // bytes against its own copy and refuses to start if they differ; that one is
  // not ours to change. Everything after it is.
  var GLYPHS = {
    C:[0x70,0x88,0x80,0x80,0x80,0x88,0x70,0x00],
    H:[0x88,0x88,0x88,0xF8,0x88,0x88,0x88,0x00],
    I:[0x70,0x20,0x20,0x20,0x20,0x20,0x70,0x00],
    P:[0xF0,0x88,0x88,0xF0,0x80,0x80,0x80,0x00],
    T:[0xF8,0x20,0x20,0x20,0x20,0x20,0x20,0x00],
    U:[0x88,0x88,0x88,0x88,0x88,0x88,0x70,0x00],
    N:[0x88,0xC8,0xA8,0x98,0x88,0x88,0x88,0x00],
    E:[0xF8,0x80,0x80,0xF0,0x80,0x80,0xF8,0x00],
    S:[0x78,0x80,0x80,0x70,0x08,0x08,0xF0,0x00],
    '.':[0x00,0x00,0x00,0x00,0x00,0x20,0x20,0x00],
    A:[0x70,0x88,0x88,0xF8,0x88,0x88,0x88,0x00],
    '1':[0x20,0x60,0x20,0x20,0x20,0x20,0x70,0x00],
    '2':[0x70,0x88,0x08,0x10,0x20,0x40,0xF8,0x00],
    W:[0x88,0x88,0x88,0xA8,0xA8,0xD8,0x88,0x00]
  };
  var GLYPH_ORDER = ['C','H','I','P','T','U','N','E','S','.','A','1','2','W'];
  var TILE_BLANK = 0, TILE_SOLID = 1, TILE_FIRST_GLYPH = 2;
  function glyphTile(ch){ var i = GLYPH_ORDER.indexOf(ch); return i < 0 ? TILE_BLANK : TILE_FIRST_GLYPH + i; }

  // 16 tiles x 16 bytes: blank, solid, then the font. A glyph sets BOTH
  // bitplanes so it comes out as colour 3 -- the darkest shade -- against the
  // reflector.
  function tileBytes() {
    var out = [], i, r;
    for (i = 0; i < 16; i++) out.push(0x00);                      // 0: blank
    for (i = 0; i < 16; i++) out.push(0xFF);                      // 1: solid
    GLYPH_ORDER.forEach(function (ch) {
      var g = GLYPHS[ch];
      for (r = 0; r < 8; r++) { out.push(g[r]); out.push(g[r]); } // lo and hi plane
    });
    while (out.length < 16 * 16) out.push(0x00);
    return out;
  }

  // The two static rows: the title across the top, and a label under each bar
  // saying which voice it is.
  function screenBytes() {
    var title = 'CHIPTUNES.APP', row0 = [], row17 = [], i;
    var start = Math.max(0, Math.floor((20 - title.length) / 2));
    for (i = 0; i < 20; i++) row0.push(TILE_BLANK);
    for (i = 0; i < title.length && start + i < 20; i++) row0[start + i] = glyphTile(title.charAt(i));
    for (i = 0; i < 20; i++) row17.push(TILE_BLANK);
    ['1', '2', 'W', 'N'].forEach(function (ch, k) { row17[BAR_COL[k] + 1] = glyphTile(ch); });
    return row0.concat(row17);
  }

  // The boot ROM refuses to run a cartridge whose header does not carry this
  // exact 48-byte sequence -- it is compared byte for byte before control is
  // handed over. Every Game Boy cartridge ever made contains it, homebrew
  // included; there is no way to produce a booting ROM without it.
  var NINTENDO_LOGO = [
    0xCE,0xED,0x66,0x66,0xCC,0x0D,0x00,0x0B,0x03,0x73,0x00,0x83,0x00,0x0C,0x00,0x0D,
    0x00,0x08,0x11,0x1F,0x88,0x89,0x00,0x0E,0xDC,0xCC,0x6E,0xE6,0xDD,0xDD,0xD9,0x99,
    0xBB,0xBB,0x67,0x63,0x6E,0x0E,0xEC,0xCC,0xDD,0xDC,0x99,0x9F,0xBB,0xB9,0x33,0x3E
  ];

  // ------------------------------------------------------------------- driver
  // Command byte: (channel << 6) | type.  type 0 = note off, 1 = note on,
  // 2 = load wave RAM, 3 = NR10 sweep byte (channel 1 slides/zips),
  // 4 = write one sound register (the automation lane: duty, panning, period,
  // anything the hardware has), 5 = hand this channel's pitch over from the
  // driver's vibrato, because the note is steering it itself.
  // $FF ends the song and loops it.
  //
  //   [initialDelay] then, repeating: [cmd][payload...][delayToNextEvent]
  //     on:   cmd, nrx1, nrx2, nrx3, nrx4
  //     off:  cmd
  //     wave: cmd, index
  //
  // The delay FOLLOWS its event. Putting it in front reads naturally but the
  // driver has to execute before it can honour it, which applied each event's
  // delay after the event instead of before it and slid the whole song one
  // event out of step -- the emulator caught it as noise notes landing late.
  function driver(dataAddr, waveAddr, tileAddr, screenAddr, kitAddr) {
    var a = new Asm();

    a.di();
    a.ld_sp_nn(0xFFFE);
    a.ld_a_n(0x80).ldh_n_a(R.NR52);      // APU on
    a.ld_a_n(0xFF).ldh_n_a(R.NR51);      // every channel to both speakers
    a.ld_a_n(0x77).ldh_n_a(R.NR50);      // full volume, both sides
    a.ld_a_n(0x80).ldh_n_a(R.NR30);      // channel 3 DAC on
    // ---- the picture -------------------------------------------------------
    // A music cartridge with no video shows a blank screen, which looks broken
    // rather than minimal. Four bars, one per channel, struck on every note and
    // decaying a row a frame: it is the smallest display that makes it obvious
    // the sound is coming from these four voices and not from a recording.
    a.ld_a_n(0x00).ldh_n_a(R.LCDC);       // LCD off: VRAM is ours to write
    a.ld_hl_nn(0x8000);                   // 16 tiles: blank, solid, and the font
    a.ld_de_nn(tileAddr); a.ld_b_n(0);    // 256 bytes (b=0 -> 256 iterations)
    a.label('tiles'); a.ld_a_de(); a.ld_hli_a(); a.inc_de(); a.dec_b(); a.jr_nz('tiles');
    a.ld_hl_nn(0x9800);                   // clear the tilemap: 4 x 256 bytes
    a.ld_d_n(4);
    a.label('clrOuter'); a.ld_b_n(0); a.ld_a_n(0x00);
    a.label('clrInner'); a.ld_hli_a(); a.dec_b(); a.jr_nz('clrInner');
    a.dec_d(); a.jr_nz('clrOuter');
    a.ld_hl_nn(0xFF00 + H_LEVEL);         // levels 0, complements full
    a.ld_b_n(4); a.ld_a_n(0);
    a.label('lvl0'); a.ld_hli_a(); a.dec_b(); a.jr_nz('lvl0');
    a.ld_b_n(4); a.ld_a_n(BAR_H);
    a.label('lvl1'); a.ld_hli_a(); a.dec_b(); a.jr_nz('lvl1');
    a.ld_hl_nn(0xFF00 + H_VLO);           // vibrato state + sweep latch: all zero
    a.ld_b_n(9); a.ld_a_n(0);
    a.label('vib0'); a.ld_hli_a(); a.dec_b(); a.jr_nz('vib0');
    a.ld_hl_nn(0x9800);                   // the title row
    a.ld_de_nn(screenAddr); a.ld_b_n(20);
    a.label('row0'); a.ld_a_de(); a.ld_hli_a(); a.inc_de(); a.dec_b(); a.jr_nz('row0');
    a.ld_hl_nn(0x9800 + 17 * 32);         // the labels under the bars
    a.ld_b_n(20);
    a.label('row17'); a.ld_a_de(); a.ld_hli_a(); a.inc_de(); a.dec_b(); a.jr_nz('row17');
    a.ld_a_n(0xE4).ldh_n_a(R.BGP);        // the ordinary four-shade palette
    a.ld_a_n(0x00).ldh_n_a(R.SCY); a.ld_a_n(0x00).ldh_n_a(R.SCX);
    a.ld_a_n(0x91).ldh_n_a(R.LCDC);       // LCD on, BG on, tiles at $8000, map at $9800

    a.ld_hl_nn(dataAddr);
    a.ld_a_hli().ld_b_a();                // b = delay before the first event

    a.label('frame');
    a.call('vblank');
    // Drawing happens inside vblank and clobbers hl/bc/de, all of which the
    // audio loop is holding: hl is the song cursor and b is the frames left to
    // wait. Save them rather than reordering the loop around the display.
    a.push_hl(); a.push_bc();
    a.call('draw'); a.call('decay'); a.call('vibrato');
    a.pop_bc(); a.pop_hl();
    a.ld_a_b().or_a();
    a.jr_nz('waiting');
    a.call('events');
    a.jr('frame');
    a.label('waiting');
    a.dec_b();
    a.jr('frame');

    // --- execute every event scheduled for this frame -----------------------
    // Reads pairs until one carries a non-zero delay, which becomes the wait.
    a.label('events');
    a.label('nextEvent');
    a.ld_a_hli();                         // cmd
    a.cp_n(0xFF);
    // the events section outgrew a relative jump's reach when the vibrato
    // hooks landed; a jp costs one byte and never goes out of range
    a.jr_nz('notRestart');
    a.jp('restart');
    a.label('notRestart');

    a.push_af();
    a.and_n(0xC0);                        // channel in the top two bits
    a.rlca().rlca();                      // -> 0..3
    a.ldh_n_a(H_CH);                      // ...and keep it: the display wants it too
    a.ld_c_a();
    a.add_a_a().add_a_a();                // ch*4
    a.add_a_c();                          // ch*5
    a.ld_c_a();
    a.ld_a_n(0x11).add_a_c();             // $11 + ch*5 -> NRx1 for this channel
    a.ld_c_a();
    a.pop_af();

    a.and_n(0x3F);                        // type
    a.cp_n(0x02);
    a.jr_nz('notWave'); a.jp('doWave'); a.label('notWave');
    a.cp_n(0x03);
    a.jr_z('doSweep');
    // absolute jumps: the handlers below have outgrown a relative jump's reach
    a.cp_n(0x04);
    a.jr_nz('notWrite'); a.jp('doWrite'); a.label('notWrite');
    a.cp_n(0x05);
    a.jr_nz('notVibOff'); a.jp('doVibOff'); a.label('notVibOff');
    a.cp_n(0x06);
    a.jr_nz('notKit'); a.jp('doKit'); a.label('notKit');
    a.or_a();
    a.jr_z('doOff');

    // note on: four bytes straight into NRx1..NRx4, keeping the period bytes
    // in d/e for the vibrato state
    a.ld_a_hli().ldh_c_a().inc_c();
    a.ld_a_hli().ldh_c_a().inc_c();
    a.ld_a_hli().ld_d_a().ldh_c_a().inc_c();
    a.ld_a_hli().ld_e_a().ldh_c_a();
    // pulse channels arm vibrato: base period, age zero, on -- unless this is
    // channel 1 carrying a sweep, whose pitch the sweep unit owns
    a.ldh_a_n(H_CH); a.cp_n(2); a.jr_nc('onNoVib');
    a.add_a_n(H_VLO); a.ld_c_a();
    a.ld_a_d(); a.ldh_c_a();
    a.ld_a_c(); a.add_a_n(2); a.ld_c_a();
    a.ld_a_e(); a.and_n(7); a.ldh_c_a();
    a.ld_a_c(); a.add_a_n(2); a.ld_c_a();
    a.ld_a_n(0x00); a.ldh_c_a();
    a.ld_a_c(); a.add_a_n(2); a.ld_c_a();
    a.ldh_a_n(H_CH); a.or_a(); a.jr_nz('onVibYes');
    a.ldh_a_n(H_SWP); a.or_a(); a.jr_z('onVibYes');
    a.ld_a_n(0x00); a.ldh_c_a(); a.jr('onNoVib');
    a.label('onVibYes'); a.ld_a_n(0x01); a.ldh_c_a();
    a.label('onNoVib');
    // strike this channel's bar to full height
    a.ldh_a_n(H_CH).add_a_n(H_LEVEL).ld_c_a();
    a.ld_a_n(BAR_H).ldh_c_a();
    a.ldh_a_n(H_CH).add_a_n(H_BLANK).ld_c_a();
    a.ld_a_n(0x00).ldh_c_a();
    a.jp('afterEvent');

    // sweep: one byte straight into NR10, ahead of the note-on it belongs to
    a.label('doSweep');
    a.ld_a_hli();
    a.ldh_n_a(0x10);
    a.or_a(); a.jr_z('swpStore');
    a.ld_a_n(0x01);
    a.label('swpStore'); a.ldh_n_a(H_SWP);
    a.jp('afterEvent');

    // note off: silence the DAC, then retrigger so the channel actually stops.
    // Writing $08 leaves the DAC powered and the channel audible -- that cost a
    // long evening once, so it is $00 followed by a trigger, deliberately.
    a.label('doOff');
    a.inc_c();
    a.ld_a_n(0x00).ldh_c_a();             // NRx2 = 0
    a.inc_c().inc_c();
    a.ld_a_n(0x80).ldh_c_a();             // NRx4 trigger
    a.ldh_a_n(H_CH); a.cp_n(2); a.jr_nc('offNoVib');
    a.add_a_n(H_VON); a.ld_c_a();
    a.ld_a_n(0x00); a.ldh_c_a();
    a.label('offNoVib');
    a.jp('afterEvent');

    // automation: one register, one value. The channel bits are unused -- the
    // register says which channel it belongs to.
    a.label('doWrite');
    a.ld_a_hli();                         // register, low byte of $FF00
    a.ld_c_a();
    a.ld_a_hli();                         // value
    a.ldh_c_a();
    a.jp('afterEvent');

    // the note is steering its own pitch: stop the driver's vibrato on it
    a.label('doVibOff');
    a.ldh_a_n(H_CH);
    a.cp_n(2);
    a.jr_nc('vibOffDone');
    a.add_a_n(H_VON); a.ld_c_a();
    a.ld_a_n(0x00); a.ldh_c_a();
    a.label('vibOffDone');
    a.jp('afterEvent');

    // KIT: start a sample. The four-bit data streams into wave RAM from the
    // timer interrupt, 32 nibbles at a time, 256 times a second -- which is
    // exactly 8192 samples a second at channel 3's period 1792, so the sample
    // clock and the refill clock never drift apart.
    a.label('doKit');
    a.di();                               // no interrupt while we set this up
    a.ld_a_hli();                         // sample id
    a.push_hl();
    a.ld_c_a(); a.add_a_a(); a.add_a_c(); // id*3: the table is lo, hi, buffers
    a.ld_c_a(); a.ld_b_n(0);
    a.ld_hl_nn(kitAddr);
    a.add_hl_bc();
    a.ld_a_hli(); a.ldh_n_a(H_KITLO);
    a.ld_a_hli(); a.ldh_n_a(H_KITHI);
    a.ld_a_hli(); a.ldh_n_a(H_KITN);
    a.ld_a_n(0x20); a.ldh_n_a(0x1C);      // NR32: full output
    a.ld_a_n(KIT_PERIOD & 0xFF); a.ldh_n_a(0x1D);   // NR33: the rate
    a.call('kitFill');                    // buffer zero now...
    a.ld_a_n(KIT_TMA); a.ldh_n_a(0x06);   // TMA
    a.ld_a_n(KIT_TMA); a.ldh_n_a(0x05);   // TIMA: the next one lands a buffer later
    a.ld_a_n(0x04); a.ldh_n_a(0x07);      // TAC: on, 4096 Hz
    a.ld_a_n(0x04); a.ldh_n_a(0xFF);      // IE: timer only
    a.ei();
    a.pop_hl();
    a.jp('afterEvent');

    // one buffer into wave RAM. The DAC goes off around the writes: on a DMG
    // wave RAM is not reliably writable while the channel is running.
    a.label('kitFill');
    a.ldh_a_n(H_KITN); a.or_a();
    a.jr_z('kitStop');
    a.ldh_a_n(H_KITLO); a.ld_l_a();
    a.ldh_a_n(H_KITHI); a.ld_h_a();
    a.ld_a_n(0x00); a.ldh_n_a(0x1A);      // NR30: DAC off
    a.ld_c_n(0x30);
    for (var kb = 0; kb < 16; kb++) { a.ld_a_hli(); a.ldh_c_a(); a.inc_c(); }
    a.ld_a_n(0x80); a.ldh_n_a(0x1A);      // NR30: DAC on
    a.ld_a_n(0x80 | ((KIT_PERIOD >> 8) & 7)); a.ldh_n_a(0x1E);   // NR34: trigger
    a.ld_a_l(); a.ldh_n_a(H_KITLO);
    a.ld_a_h(); a.ldh_n_a(H_KITHI);
    a.ldh_a_n(H_KITN); a.dec_a(); a.ldh_n_a(H_KITN);
    a.ret();
    a.label('kitStop');
    a.ld_a_n(0x00);
    a.ldh_n_a(0x07);                      // timer off
    a.ldh_n_a(0x1C);                      // and channel 3 quiet until the song wants it
    a.ret();

    // the timer interrupt itself, reached from the vector at $0050
    a.label('kitIsr');
    a.push_af(); a.push_hl(); a.push_bc();
    a.call('kitFill');
    a.pop_bc(); a.pop_hl(); a.pop_af();
    a.reti();

    // wave: copy 16 bytes (32 nibbles) into wave RAM
    a.label('doWave');
    a.ld_a_hli();                         // wave index
    a.push_hl();
    a.ld_hl_nn(waveAddr);
    a.ld_c_a();
    a.label('waveOffset');                // hl += index*16
    a.ld_a_c().or_a();
    a.jr_z('waveCopy');
    a.ld_d_n(16);
    a.label('waveStep');
    a.inc_hl(); a.dec_d();
    a.ld_a_d().or_a();
    a.jr_nz('waveStep');
    a.ld_a_c().byte(0x3D);                // dec a
    a.ld_c_a();
    a.jr('waveOffset');

    a.label('waveCopy');
    a.ld_c_n(R.WAVE);
    a.ld_d_n(16);
    a.label('waveByte');
    a.ld_a_hli().ldh_c_a().inc_c();
    a.dec_d();
    a.ld_a_d().or_a();
    a.jr_nz('waveByte');
    a.pop_hl();

    a.label('afterEvent');
    a.ld_a_hli();                         // delay to the NEXT event
    a.ld_b_a();
    a.or_a();
    a.jr_nz('eventsDone');                // same frame, keep going
    a.jp('nextEvent');
    a.label('eventsDone');
    a.dec_b();                            // this frame is spoken for
    a.ret();

    a.label('restart');
    a.ld_hl_nn(dataAddr);
    a.ld_a_hli().ld_b_a();
    a.ret();

    // --- the display --------------------------------------------------------
    // Per channel: write `blanks` rows of tile 0 from the top, then `level` rows
    // of tile 1, three tiles wide. de = 29 carries hl to the next row after the
    // three writes have already advanced it by three.
    a.label('draw');
    a.ld_de_nn(29);
    for (var bc = 0; bc < 4; bc++) {
      var top = 'bar' + bc, sol = 'sol' + bc, done = 'bard' + bc, bl = 'blk' + bc, sl = 'sll' + bc;
      a.ld_hl_nn(0x9800 + BAR_TOP * 32 + BAR_COL[bc]);
      a.ldh_a_n(H_BLANK + bc); a.ld_b_a(); a.or_a(); a.jr_z(sol);
      a.ld_a_n(TILE_BLANK);
      a.label(bl); a.ld_hli_a().ld_hli_a().ld_hli_a(); a.add_hl_de(); a.dec_b(); a.jr_nz(bl);
      a.label(sol);
      a.ldh_a_n(H_LEVEL + bc); a.ld_b_a(); a.or_a(); a.jr_z(done);
      a.ld_a_n(TILE_SOLID);
      a.label(sl); a.ld_hli_a().ld_hli_a().ld_hli_a(); a.add_hl_de(); a.dec_b(); a.jr_nz(sl);
      a.label(done);
    }
    a.ret();

    // One row a frame, so a struck channel falls back over about a third of a
    // second -- fast enough to read as a hit, slow enough to see.
    a.label('decay');
    for (var dc = 0; dc < 4; dc++) {
      var skip = 'dec' + dc;
      a.ldh_a_n(H_LEVEL + dc); a.or_a(); a.jr_z(skip);
      a.byte(0x3D);                              // dec a
      a.ldh_n_a(H_LEVEL + dc);
      a.ldh_a_n(H_BLANK + dc); a.inc_a(); a.ldh_n_a(H_BLANK + dc);
      a.label(skip);
    }
    a.ret();

    // --- vibrato ------------------------------------------------------------
    // Once per frame, per pulse channel: after 16 frames of a note, walk an
    // 8-entry period-offset table every 2 frames and rewrite NRx3/NRx4 with
    // the trigger bit clear, so the pitch bends without restarting the note.
    // The browser Sequencer runs the SAME table and the same rule, in the same
    // order relative to events, which is what keeps the cartridge and the chip
    // in byte agreement.
    [0, 1].forEach(function (vch) {
      if (vch === 0) a.label('vibrato');
      var L = function (n) { return 'vb' + vch + n; };
      a.ldh_a_n(H_VON + vch); a.or_a(); a.jr_z(L('done'));
      a.ldh_a_n(H_VAGE + vch); a.cp_n(250); a.jr_nc(L('aged'));
      a.inc_a(); a.ldh_n_a(H_VAGE + vch);
      a.label(L('aged'));
      a.ldh_a_n(H_VAGE + vch); a.sub_n(16); a.jr_c(L('done'));
      a.or_a(); a.rra(); a.and_n(7);              // idx = ((age-16)>>1)&7
      a.ld_c_a();
      a.ld_hl_lbl('vibtbl');
      a.label(L('seek')); a.ld_a_c(); a.or_a(); a.jr_z(L('read'));
      a.inc_hl(); a.dec_c(); a.jr(L('seek'));
      a.label(L('read')); a.ld_a_hl();            // two's-complement offset
      a.ld_c_a(); a.and_n(0x80); a.jr_z(L('pos'));
      a.ld_b_n(0xFF); a.jr(L('sx'));
      a.label(L('pos')); a.ld_b_n(0x00);
      a.label(L('sx'));
      a.ldh_a_n(H_VLO + vch); a.add_a_c(); a.ld_d_a();
      a.ldh_a_n(H_VHI + vch); a.adc_a_b(); a.and_n(7); a.ld_e_a();
      a.ld_a_d(); a.ldh_n_a(vch === 0 ? 0x13 : 0x18);
      a.ld_a_e(); a.ldh_n_a(vch === 0 ? 0x14 : 0x19);
      a.label(L('done'));
    });
    a.ret();
    a.label('vibtbl');
    [0x00, 0x02, 0x03, 0x02, 0x00, 0xFE, 0xFD, 0xFE].forEach(function (v) { a.byte(v); });

    // --- one frame ----------------------------------------------------------
    // Poll LY rather than using interrupts: no handlers, no timing subtleties,
    // and the driver is the only thing running.
    a.label('vblank');
    a.label('waitLow');
    a.ldh_a_n(R.LY);
    a.cp_n(144);
    a.jr_z('waitHigh');
    a.jr('waitLow');
    a.label('waitHigh');
    a.ldh_a_n(R.LY);
    a.cp_n(144);
    a.jr_z('waitHigh');
    a.ret();

    return a.link(ORG_CODE);
  }

  // ------------------------------------------------------------------ encoder
  // A note-on becomes the four bytes the hardware wants, computed here.
  function encode(score) {
    var gb = score && score.gb;
    // a song may be nothing but kit hits -- that is a drum machine, and a
    // perfectly good cartridge
    if (!gb || !gb.notes || (!gb.notes.length && !(gb.kit && gb.kit.length)))
      throw new Error('gb-rom: score has no gb data');
    var HW = G.CT_GB_HARDWARE || G.CT_GB;
    if (!HW || !HW.noteRegisters || !HW.waveSlotOf)
      throw new Error('gb-rom: gb-hardware.js not loaded');

    var inst = (gb.bank && gb.bank.instruments) || [];
    var evs = [];

    var offFrames = HW.noteOffFrames(gb.notes);
    gb.notes.forEach(function (n, index) {
      var ch = n.ch | 0;
      var regs = HW.noteRegisters(n, gb.bank);

      if (ch < 2 && n.trigger === false) {
        evs.push({ f: n.frame | 0, ch: ch, type: 4, d: [0x13 + ch * 5, regs[2]] });
        evs.push({ f: n.frame | 0, ch: ch, type: 4, d: [0x14 + ch * 5, regs[3] & 7] });
        if (offFrames[index] != null) evs.push({ f: offFrames[index], ch: ch, type: 0, d: [] });
        return;
      }

      // channel 1's sweep byte rides ahead of every note-on (zero clears), the
      // exact write the browser Sequencer makes -- the two cannot disagree
      if (ch === 0) evs.push({ f: n.frame | 0, ch: 0, type: 3, d: [(n.sweep || 0) & 0xFF] });
      evs.push({ f: n.frame | 0, ch: ch, type: 1, d: regs });
      if (offFrames[index] != null) evs.push({ f: offFrames[index], ch: ch, type: 0, d: [] });
    });

    // Channel 3 needs a table in wave RAM before it can make a sound. Pick the
    // slot the first wave note actually asks for.
    // The slot comes from HW.waveSlotOf, never from byte0 directly: the two
    // sides have to answer this question the same way or the cartridge loads a
    // different table than the browser does.
    var firstWave = null, lastWave = null;
    for (var wi = 0; wi < gb.notes.length; wi++) {
      var wn = gb.notes[wi];
      if ((wn.ch | 0) !== 2) continue;
      var wslot = HW.waveSlotOf(inst, wn.inst);
      if (firstWave === null) { firstWave = wslot; lastWave = wslot; continue; }
      if (wslot === lastWave) continue;
      lastWave = wslot;
      // a song that changes bass sound mid-way needs the table reloaded, which
      // is exactly what the browser's Sequencer does
      evs.push({ f: wn.frame | 0, ch: 2, type: 2, d: [wslot] });
    }
    evs.push({ f: 0, ch: 2, type: 2, d: [firstWave === null ? 0 : firstWave] });

    // the automation lane: raw register writes, and vibrato hand-offs
    (gb.auto || []).forEach(function (w) {
      evs.push({ f: w.f | 0, ch: 0, type: 4, d: [w.r & 0xFF, w.v & 0xFF] });
    });
    (gb.vibOff || []).forEach(function (w) {
      evs.push({ f: w.f | 0, ch: w.ch & 3, type: 5, d: [] });
    });
    (gb.waveLoads || []).forEach(function (w) {
      evs.push({ f: w.f | 0, ch: 2, type: 2, d: [w.slot & 0xFF] });
    });
    (gb.kit || []).forEach(function (k) {
      evs.push({ f: k.f | 0, ch: 2, type: 6, d: [k.id & 7] });
    });

    // At one frame: offs first, wave loads, then sweep, then note-ons, and
    // automation last -- a duty change on a note's own frame has to land AFTER
    // the note-on that would otherwise overwrite it.
    var TYPEW = { 0: 0, 2: 1, 3: 2, 1: 3, 5: 4, 4: 5, 6: 6 };
    evs.sort(function (a, b) { return a.f - b.f || TYPEW[a.type] - TYPEW[b.type]; });

    var out = [], i;
    // Long gaps need splitting: the delay is one byte. A channel-3 note-off is
    // the filler because retriggering a silent channel is inaudible.
    function pushDelay(d) {
      while (d > 254) { out.push(254, 0xC0); d -= 254; }
      out.push(d & 0xFF);
    }
    pushDelay(evs.length ? evs[0].f : 0);
    for (i = 0; i < evs.length; i++) {
      var e = evs[i];
      out.push(((e.ch & 3) << 6) | (e.type & 0x3F));
      for (var k = 0; k < e.d.length; k++) out.push(e.d[k] & 0xFF);
      var gap = (i + 1 < evs.length) ? (evs[i + 1].f - e.f) : 0;
      while (gap > 254) { out.push(254, 0xC0); gap -= 254; }   // filler event carries the overflow
      out.push(gap & 0xFF);
    }
    out.push(0, 0xFF);
    return out;
  }

  function waveBytes(score) {
    var gb = score.gb, tables = (gb.bank && gb.bank.waveTables) || [];
    var HW2 = G.CT_GB_HARDWARE || G.CT_GB || {};
    var slots = Math.max(16, HW2.WAVE_SLOTS || 16);
    var out = [];
    for (var t = 0; t < slots; t++) {
      var w = tables[t] || [];
      for (var i = 0; i < 16; i++) {
        var hi = (w[i * 2] || 0) & 15, lo = (w[i * 2 + 1] || 0) & 15;
        out.push((hi << 4) | lo);
      }
    }
    return out;
  }

  // The kit table is eight entries of [lo, hi, buffers] followed by the packed
  // samples the song actually uses; an unused id points at zero buffers, which
  // kitFill treats as "already finished".
  function kitBytes(score, base) {
    var K = G.CT_GB_KITS;
    var used = {}, order = [];
    ((score.gb && score.gb.kit) || []).forEach(function (k) {
      var id = k.id | 0;
      if (used[id] == null) { used[id] = true; order.push(id); }
    });
    var table = [], data = [], at = base + 24;    // 8 entries x 3 bytes
    var addrOf = {}, lenOf = {};
    order.forEach(function (id) {
      var bytes = K ? K.packed(id) : new Uint8Array(0);
      addrOf[id] = at; lenOf[id] = bytes.length / 16;   // buffers of 16 bytes
      for (var i = 0; i < bytes.length; i++) data.push(bytes[i]);
      at += bytes.length;
    });
    for (var id2 = 0; id2 < 8; id2++) {
      var ad = addrOf[id2] || 0, ln = lenOf[id2] || 0;
      table.push(ad & 0xFF, (ad >> 8) & 0xFF, ln & 0xFF);
    }
    return table.concat(data);
  }

  // -------------------------------------------------------------------- build
  function buildRom(score, opts) {
    opts = opts || {};
    var rom = new Uint8Array(ROM_SIZE);     // ROM-only carts read $FF where unused
    var i;

    rom[0x0100] = 0x00;                     // nop
    rom[0x0101] = 0xC3;                     // jp $0150
    rom[0x0102] = ORG_CODE & 0xFF;
    rom[0x0103] = (ORG_CODE >> 8) & 0xFF;
    for (i = 0; i < 48; i++) rom[0x0104 + i] = NINTENDO_LOGO[i];

    var title = String(opts.title || 'CHIPTUNES').toUpperCase().replace(/[^A-Z0-9 ]/g, '').slice(0, 15);
    for (i = 0; i < 16; i++) rom[0x0134 + i] = i < title.length ? title.charCodeAt(i) : 0;
    rom[0x0147] = 0x00;                     // ROM only
    rom[0x0148] = 0x00;                     // 32 KiB
    rom[0x0149] = 0x00;                     // no cartridge RAM
    rom[0x014A] = 0x01;                     // non-Japanese
    rom[0x014B] = 0x33;
    rom[0x014C] = 0x00;

    var data = encode(score);
    var waves = waveBytes(score);
    var kits = kitBytes(score, 0);          // length is stable; addresses come below
    var tiles = tileBytes();
    var screen = screenBytes();
    // The driver's length depends on the addresses it is given (16-bit operands
    // do not change size, but the label fixups do), so it is linked twice and
    // the second pass is a fixed point.
    var code = driver(0, 0, 0, 0, 0), dataAddr, waveAddr, kitAddr, tileAddr, screenAddr;
    for (var pass = 0; pass < 2; pass++) {
      dataAddr = ORG_CODE + code.length;
      waveAddr = dataAddr + data.length;
      kitAddr = waveAddr + waves.length;
      tileAddr = kitAddr + kits.length;
      screenAddr = tileAddr + tiles.length;
      code = driver(dataAddr, waveAddr, tileAddr, screenAddr, kitAddr);
    }
    dataAddr = ORG_CODE + code.length;
    waveAddr = dataAddr + data.length;
    kitAddr = waveAddr + waves.length;
    tileAddr = kitAddr + kits.length;
    screenAddr = tileAddr + tiles.length;
    kits = kitBytes(score, kitAddr);        // now the pointers can be real

    var end = screenAddr + screen.length;
    if (end > ROM_SIZE) {
      throw new Error('gb-rom: song needs ' + end + ' bytes, a ROM-only cartridge holds ' + ROM_SIZE);
    }
    for (i = 0; i < code.length; i++)   rom[ORG_CODE + i] = code[i];
    for (i = 0; i < data.length; i++)   rom[dataAddr + i] = data[i];
    for (i = 0; i < waves.length; i++)  rom[waveAddr + i] = waves[i];
    for (i = 0; i < kits.length; i++)   rom[kitAddr + i] = kits[i];
    // the timer interrupt vector: the streamer lives inside the driver
    if (code.labels && code.labels.kitIsr != null) {
      var isr = ORG_CODE + code.labels.kitIsr;
      rom[0x0050] = 0xC3; rom[0x0051] = isr & 0xFF; rom[0x0052] = (isr >> 8) & 0xFF;
    }
    for (i = 0; i < tiles.length; i++)  rom[tileAddr + i] = tiles[i];
    for (i = 0; i < screen.length; i++) rom[screenAddr + i] = screen[i];

    // header checksum -- the boot ROM verifies this one and halts if it is wrong
    var x = 0;
    for (i = 0x0134; i <= 0x014C; i++) x = (x - rom[i] - 1) & 0xFF;
    rom[0x014D] = x;
    // global checksum: not verified by hardware, but tools show it
    var sum = 0;
    for (i = 0; i < ROM_SIZE; i++) { if (i === 0x014E || i === 0x014F) continue; sum = (sum + rom[i]) & 0xFFFF; }
    rom[0x014E] = (sum >> 8) & 0xFF;
    rom[0x014F] = sum & 0xFF;

    return rom;
  }

  var API = { buildRom: buildRom, encode: encode, driver: driver, ORG_CODE: ORG_CODE, ROM_SIZE: ROM_SIZE };
  G.CT_GB_ROM = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : window);
