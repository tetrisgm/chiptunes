// A DMG APU, at the register level.
//
// This used to be a note player: it took the score's notes and synthesised
// something chip-flavoured from them. It sounded close, and "close" is exactly
// the problem -- a cartridge built from the same score sounded like a different
// piece of music, because nothing forced the two to agree. Measured, the old
// synth ran the noise channel at a quarter of the hardware's LFSR clock (two
// octaves flat across 42% of the notes), ignored NR32 so the wave channel always
// played at full level, and ran an envelope on channel 3, which has none.
//
// So it is a chip now. It accepts REGISTER WRITES -- the same $FF10-$FF3F the
// cartridge driver performs -- and turns them into samples. The browser reaches
// those registers through Sequencer (below) and the cartridge reaches them by
// executing 8-bit code, but the thing making the sound is this file either way,
// so "the ROM is a serialisation of what you heard" is true by construction
// rather than by calibration. scripts/verify-rom-audio.js runs both and
// compares the waveforms.
//
//   CH1/CH2  square, four duty cycles, 11-bit period, 15-step volume envelope
//   CH3      32 samples of 4-bit wave RAM and four output levels: mute, full,
//            half, quarter. No envelope, no arbitrary volume.
//   CH4      LFSR noise, 15- or 7-bit, clocked at 4194304 / (divisor << shift)
//
// The frame sequencer runs at 512 Hz; envelopes step at 64 Hz. There is no
// filter, no reverb, no saw wave and no sample playback, because a Game Boy has
// none of those. Everything you hear has to be composed, not effected.
(function (G) {
  'use strict';
  var H = (typeof require !== 'undefined' && typeof module !== 'undefined')
    ? require('./gb-hardware.js') : (G.CT_GB_HARDWARE || G.CT_GB);

  var MASTER = 4194304;                    // master clock, Hz
  var FRAME_CYCLES = 70224;                // one LCD frame; 4194304/70224 = 59.7275 = H.FPS
  var SEQ_CYCLES = 8192;                   // frame sequencer, 512 Hz

  var DUTY = [
    [0,0,0,0,0,0,0,1],   // 12.5%
    [1,0,0,0,0,0,0,1],   // 25%
    [1,0,0,0,0,1,1,1],   // 50%
    [0,1,1,1,1,1,1,0]    // 75%
  ];
  // NR43's divisor codes, in master cycles. r=0 is 8, not 0: at shift 0 that is
  // the documented maximum LFSR rate of 524288 Hz, which is the anchor the old
  // synth missed by a factor of four.
  var DIVISORS = [8, 16, 32, 48, 64, 80, 96, 112];

  function Apu(sampleRate) {
    this.sr = sampleRate || 44100;
    this.cps = MASTER / this.sr;           // master cycles per output sample
    this.reset();
  }

  Apu.prototype.reset = function () {
    this.wave = new Uint8Array(16);
    this.seqAcc = 0; this.seqStep = 0;
    this.swPace = 0; this.swDir = 0; this.swShift = 0;
    this.swShadow = 0; this.swTimer = 0; this.swEnabled = false;
    this.nr50 = 0x77; this.nr51 = 0xFF; this.power = true;
    this.hp = 0;                           // DC blocker (the DMG's output capacitor)
    this.ch = [
      { dac:false, on:false, freq:0, duty:2, pos:0, t:0, vol:0, vol0:0, dir:0, pace:0, ec:0, envActive:false },
      { dac:false, on:false, freq:0, duty:2, pos:0, t:0, vol:0, vol0:0, dir:0, pace:0, ec:0, envActive:false },
      { dac:false, on:false, freq:0, pos:0, t:0, level:0 },
      { dac:false, on:false, lfsr:0x7FFF, width:0, div:8, shift:0, t:0, vol:0, vol0:0, dir:0, pace:0, ec:0, envActive:false }
    ];
  };

  // `reg` is an offset from $FF00, so $FF11 is 0x11 -- the same numbers the
  // cartridge's `ldh [$FF00+c],a` writes.
  Apu.prototype.write = function (reg, val) {
    val &= 0xFF;
    if (reg >= 0x30 && reg <= 0x3F) { this.wave[reg - 0x30] = val; return; }
    var c = this.ch;
    switch (reg) {
      // The sweep unit, channel 1 only. This existed on every DMG ever made
      // and the emulation simply never modelled it; with it, a single register
      // byte gives the classic LSDJ zips and falls on both the browser chip
      // and the cartridge, with no driver code at all.
      case 0x10: this.swPace = (val >> 4) & 7; this.swDir = (val >> 3) & 1; this.swShift = val & 7; break;
      case 0x11: c[0].duty = (val >> 6) & 3; break;
      case 0x16: c[1].duty = (val >> 6) & 3; break;
      case 0x12: this._env(c[0], val); break;
      case 0x17: this._env(c[1], val); break;
      case 0x21: this._env(c[3], val); break;
      case 0x13: c[0].freq = (c[0].freq & 0x700) | val; break;
      case 0x18: c[1].freq = (c[1].freq & 0x700) | val; break;
      case 0x1D: c[2].freq = (c[2].freq & 0x700) | val; break;
      case 0x14: c[0].freq = (c[0].freq & 0xFF) | ((val & 7) << 8); if (val & 0x80) this._trigger(0); break;
      case 0x19: c[1].freq = (c[1].freq & 0xFF) | ((val & 7) << 8); if (val & 0x80) this._trigger(1); break;
      case 0x1E: c[2].freq = (c[2].freq & 0xFF) | ((val & 7) << 8); if (val & 0x80) this._trigger(2); break;
      // Channel 3's DAC is a single bit, not an envelope. Clearing it is how the
      // driver silences the channel.
      case 0x1A: c[2].dac = !!(val & 0x80); if (!c[2].dac) c[2].on = false; break;
      case 0x1C: c[2].level = (val >> 5) & 3; break;
      case 0x22: c[3].shift = (val >> 4) & 0x0F; c[3].width = (val >> 3) & 1; c[3].div = DIVISORS[val & 7]; break;
      case 0x23: if (val & 0x80) this._trigger(3); break;
      case 0x24: this.nr50 = val; break;
      case 0x25: this.nr51 = val; break;
      case 0x26: this.power = !!(val & 0x80); break;
    }
  };

  // NRx2. The upper five bits are the DAC: all zero and the channel is not
  // merely quiet, it is switched off. That is precisely how a note ends.
  Apu.prototype._env = function (ch, val) {
    // Portable manual volume control: an unlocked, held increasing envelope
    // increments modulo 16 when another x8 value is written, without a trigger.
    // Pan Docs, Audio details / Obscure Behavior. This is the common operation
    // across tested DMG/CGB units; arbitrary NRx2 transitions are model-specific
    // and are NOT implemented here (including LSDj's shorter 09/11/18 decrement).
    if (ch.on && ch.envActive && ch.pace === 0 && ch.dir === 1 && (val & 15) === 8)
      ch.vol = (ch.vol + 1) & 15;
    ch.vol0 = (val >> 4) & 15;
    ch.dir = (val >> 3) & 1;
    ch.pace = val & 7;
    ch.dac = (val & 0xF8) !== 0;
    if (!ch.dac) ch.on = false;
  };

  Apu.prototype._trigger = function (i) {
    var ch = this.ch[i];
    ch.on = ch.dac;                        // triggering a dead DAC does nothing
    if (i !== 2) ch.envActive = ch.on;
    if (i === 2) { ch.pos = 0; ch.t = (2048 - ch.freq) * 2; }
    else if (i === 3) { ch.lfsr = 0x7FFF; ch.t = ch.div << ch.shift; ch.vol = ch.vol0; ch.ec = ch.pace; }
    else { ch.t = (2048 - ch.freq) * 4; ch.vol = ch.vol0; ch.ec = ch.pace; }
    if (i === 0) {
      this.swShadow = ch.freq;
      this.swTimer = this.swPace || 8;
      this.swEnabled = !!(this.swPace || this.swShift);
      if (this.swShift) {
        var nf0 = this.swShadow + (this.swDir ? -(this.swShadow >> this.swShift) : (this.swShadow >> this.swShift));
        if (nf0 > 2047) { ch.on = false; this.swEnabled = false; }
      }
    }
  };

  Apu.prototype._clockSweep = function () {
    var ch = this.ch[0];
    if (!ch.on || !this.swEnabled) return;
    if (--this.swTimer > 0) return;
    this.swTimer = this.swPace || 8;
    if (!this.swPace) return;
    var nf = this.swShadow + (this.swDir ? -(this.swShadow >> this.swShift) : (this.swShadow >> this.swShift));
    if (nf > 2047) { ch.on = false; this.swEnabled = false; return; }
    if (nf >= 0 && this.swShift) {
      this.swShadow = nf; ch.freq = nf;
      var nf2 = nf + (this.swDir ? -(nf >> this.swShift) : (nf >> this.swShift));
      if (nf2 > 2047) { ch.on = false; this.swEnabled = false; }
    }
  };

  Apu.prototype._clockEnv = function () {
    var idx = [0, 1, 3], k, ch, v;
    for (k = 0; k < 3; k++) {
      ch = this.ch[idx[k]];
      if (!ch.pace || !ch.on || !ch.envActive) continue;
      if (--ch.ec > 0) continue;
      ch.ec = ch.pace;
      v = ch.vol + (ch.dir ? 1 : -1);
      if (v >= 0 && v <= 15) ch.vol = v;
      else ch.envActive = false;           // overflow stops updates until trigger
    }
  };

  // Advance every timer by `cy` master cycles. The pulse and wave positions are
  // advanced by division rather than a per-cycle loop -- at 44.1kHz a sample is
  // 95 cycles, and looping them all would be ~500M iterations for a two-minute
  // song. The LFSR has to be stepped one at a time because each step depends on
  // the last, but at its fastest that is only ~12 steps per sample.
  Apu.prototype._advance = function (cy) {
    var c = this.ch, ch, per, steps, k, b;
    this.seqAcc += cy;
    while (this.seqAcc >= SEQ_CYCLES) {
      this.seqAcc -= SEQ_CYCLES;
      this.seqStep = (this.seqStep + 1) & 7;
      if (this.seqStep === 7) this._clockEnv();
      if (this.seqStep === 2 || this.seqStep === 6) this._clockSweep();
    }
    for (k = 0; k < 2; k++) {
      ch = c[k]; if (!ch.on) continue;
      per = (2048 - ch.freq) * 4; if (per <= 0) continue;
      ch.t -= cy;
      if (ch.t <= 0) { steps = 1 + Math.floor(-ch.t / per); ch.t += steps * per; ch.pos = (ch.pos + steps) & 7; }
    }
    ch = c[2];
    if (ch.on) {
      per = (2048 - ch.freq) * 2;
      if (per > 0) { ch.t -= cy;
        if (ch.t <= 0) { steps = 1 + Math.floor(-ch.t / per); ch.t += steps * per; ch.pos = (ch.pos + steps) & 31; } }
    }
    ch = c[3];
    if (ch.on) {
      per = ch.div << ch.shift;
      if (per > 0) { ch.t -= cy;
        while (ch.t <= 0) {
          ch.t += per;
          b = ((ch.lfsr & 1) ^ ((ch.lfsr >> 1) & 1)) & 1;
          ch.lfsr = (ch.lfsr >> 1) | (b << 14);
          if (ch.width) ch.lfsr = (ch.lfsr & ~0x40) | (b << 6);
        } }
    }
  };

  Apu.prototype._mix = function () {
    var c = this.ch, acc = 0, ch, v, nib, k;
    for (k = 0; k < 2; k++) {
      ch = c[k];
      if (!ch.dac) continue;
      v = (ch.on && DUTY[ch.duty][ch.pos]) ? ch.vol : 0;
      acc += v / 7.5 - 1;
    }
    ch = c[2];
    if (ch.dac) {
      nib = ch.on ? ((this.wave[ch.pos >> 1] >> ((ch.pos & 1) ? 0 : 4)) & 0x0F) : 0;
      v = ch.level === 0 ? 0 : (nib >> (ch.level - 1));
      acc += v / 7.5 - 1;
    }
    ch = c[3];
    if (ch.dac) {
      v = (ch.on && !(ch.lfsr & 1)) ? ch.vol : 0;
      acc += v / 7.5 - 1;
    }
    var master = ((this.nr50 & 7) + 1) / 8;
    var raw = acc * master * 0.25;
    // The console's output capacitor. Without it, a channel whose DAC is on but
    // whose digital output is zero sits at -1 and every note-off is a thump.
    var out = raw - this.hp;
    this.hp = raw - out * 0.999958;
    return out;
  };

  Apu.prototype.render = function (out, from, count) {
    for (var i = 0; i < count; i++) { this._advance(this.cps); out[from + i] = this._mix(); }
  };

  // ------------------------------------------------------------- sequencer
  // Turns a score into register writes on the LCD frame grid -- the same events,
  // in the same order, at the same frames as the cartridge driver. Note-off
  // before note-on within a frame, because a retrigger would otherwise silence
  // the note that just started.
  // Live-mixer roles, recovered from note priority. The composer assigns each
  // role a unique priority when it places notes on the machine, so the chip can
  // know what a note IS without the score carrying a role field it otherwise
  // never needs: 9 kick, 8 lead, 7 snare, 6 extra(->lead), 5 bass, 4 arp,
  // 3 hat, 2 pad.
  var PRI_ROLE = { 9:'kick', 8:'lead', 7:'snare', 6:'lead', 5:'bass', 4:'arp', 3:'hat', 2:'pad' };
  // The vibrato table, identical byte-for-byte to the one in the cartridge
  // driver (gb-rom.js 'vibtbl'): period offsets walked every 2 frames from 16
  // frames into a sustained pulse note.
  var VIBTBL = [0, 2, 3, 2, 0, -2, -3, -2];
  function Sequencer(gb, sampleRate) {
    this.apu = new Apu(sampleRate);
    this.sr = sampleRate;
    this.samplesPerFrame = sampleRate / (MASTER / FRAME_CYCLES);
    this.rate = 1;               // tempo scale: pinned bpm / native bpm
    this.mix = null;             // {kick,snare,hat,bass,lead,arp,pad} in 0..3
    this.vib = [{ on: false, base: 0, age: 0 }, { on: false, base: 0, age: 0 }];
    this.frame = 0; this.acc = 0;
    this.waveSlot = -1;
    this.bank = gb && gb.bank;
    // AUTOMATION: register writes on their own frames, and the flag that hands
    // a note's pitch over from the driver's vibrato. An instrument on this chip
    // is what gets written every frame, not just what a note-on says, so these
    // ride in the score and BOTH players read the same array.
    var auto = this.auto = {}, vibOff = this.vibOffAt = {};
    (gb && gb.auto || []).forEach(function (w) {
      (auto[w.f | 0] = auto[w.f | 0] || []).push({ r: w.r & 0xFF, v: w.v & 0xFF });
    });
    (gb && gb.vibOff || []).forEach(function (w) {
      (vibOff[w.f | 0] = vibOff[w.f | 0] || []).push(w.ch | 0);
    });
    // a wave table can be swapped under a sounding note: that is wavetable
    // synthesis, and it is the wave channel's only way to change timbre
    var wl = this.waveAt = {};
    (gb && gb.waveLoads || []).forEach(function (w) { wl[w.f | 0] = w.slot | 0; });
    // KIT SAMPLES: four-bit PCM streamed into wave RAM, buffer by buffer. The
    // cartridge does this from its timer interrupt; here the same writes are
    // made at the same cycle counts, which is what makes the two agree.
    var ka = this.kitAt = {};
    (gb && gb.kit || []).forEach(function (k) { ka[k.f | 0] = k.id | 0; });
    this.kit = null; this.kitPos = 0; this.kitLeft = 0; this.kitCyc = 0;
    var byFrame = this.byFrame = {};
    var inst = (this.bank && this.bank.instruments) || [];
    var scoreNotes = gb && gb.notes || [], offFrames = H.noteOffFrames(scoreNotes);
    scoreNotes.forEach(function (n, index) {
      var f = n.frame | 0, off = offFrames[index];
      (byFrame[f] = byFrame[f] || []).push({ t: 1, n: n });
      if (off != null) (byFrame[off] = byFrame[off] || []).push({ t: 0, ch: n.ch | 0 });
    });
    Object.keys(byFrame).forEach(function (k) {
      byFrame[k].sort(function (a, b) { return a.t - b.t; });
    });
    this.inst = inst;
    // Power on, everything to both speakers, full volume, channel 3 DAC on --
    // byte for byte what the cartridge's init does.
    this.apu.write(0x26, 0x80);
    this.apu.write(0x25, 0xFF);
    this.apu.write(0x24, 0x77);
    this.apu.write(0x1A, 0x80);
  }

  Sequencer.prototype._loadWave = function (slot) {
    if (slot === this.waveSlot) return;
    this.waveSlot = slot;
    var tables = (this.bank && this.bank.waveTables) || [], w = tables[slot] || [];
    for (var i = 0; i < 16; i++)
      this.apu.write(0x30 + i, (((w[i * 2] || 0) & 15) << 4) | ((w[i * 2 + 1] || 0) & 15));
  };

  // one 32-nibble buffer, exactly as the cartridge's kitFill writes it
  Sequencer.prototype._kitFill = function () {
    var K = G.CT_GB_KITS;
    if (!this.kit || this.kitLeft <= 0) {
      this.kit = null;
      this.apu.write(0x1C, 0x00);            // channel 3 quiet again
      return;
    }
    var d = this.kit, p = this.kitPos;
    this.apu.write(0x1A, 0x00);              // DAC off while wave RAM changes
    for (var i = 0; i < 16; i++)
      this.apu.write(0x30 + i, ((d[p + i * 2] & 15) << 4) | (d[p + i * 2 + 1] & 15));
    this.apu.write(0x1A, 0x80);
    this.apu.write(0x1E, 0x80 | ((K.PERIOD >> 8) & 7));   // trigger
    this.kitPos += 32;
    this.kitLeft--;
    this.waveSlot = -1;                      // wave RAM is a sample now, not a table
  };
  Sequencer.prototype._kitStart = function (id) {
    var K = G.CT_GB_KITS;
    if (!K) return;
    var k = K.byId(id);
    this.kit = k.data; this.kitPos = 0; this.kitLeft = k.buffers;
    this.apu.write(0x1C, 0x20);              // NR32: full output
    this.apu.write(0x1D, K.PERIOD & 0xFF);   // NR33: 8192 samples a second
    this._kitFill();
    this.kitCyc = K.BUF * (2048 - K.PERIOD) * 2;   // one buffer, in cycles
  };
  Sequencer.prototype.setRate = function (rate) {
    this.rate = Math.max(0.25, Math.min(4, +rate || 1));
  };
  Sequencer.prototype.setMix = function (mix) {
    if (!mix || typeof mix !== 'object') return;
    var m = this.mix || (this.mix = {});
    for (var k in mix) { var v = +mix[k]; if (isFinite(v)) m[k] = Math.max(0, Math.min(3, v)); }
  };
  Sequencer.prototype._runFrame = function () {
    // Vibrato steps BEFORE this frame's events, exactly like the cartridge
    // driver's frame loop (vblank, draw, vibrato, events) -- the order is what
    // keeps age progression frame-identical between the two.
    for (var vc = 0; vc < 2; vc++) {
      var vs = this.vib[vc];
      if (!vs.on) continue;
      if (vs.age < 250) vs.age++;
      var dAge = vs.age - 16;
      if (dAge < 0) continue;
      var per = (vs.base + VIBTBL[(dAge >> 1) & 7]) & 0x7FF;   // wrap, matching the 8-bit math
      this.apu.write(0x13 + vc * 5, per & 0xFF);
      this.apu.write(0x14 + vc * 5, (per >> 8) & 7);
    }
    var evs = this.byFrame[this.frame], i, e, base, r, note, g;
    if (evs) for (i = 0; i < evs.length; i++) {
      e = evs[i];
      base = 0x11 + (e.t ? (e.n.ch | 0) : e.ch) * 5;
      if (e.t === 0) {
        this.apu.write(base + 1, 0x00); this.apu.write(base + 3, 0x80);
        if ((e.ch | 0) < 2) this.vib[e.ch | 0].on = false;
        continue;
      }
      note = e.n; g = 1;
      if (note.trigger === false && (note.ch | 0) < 2) {
        r = H.noteRegisters(note, this.bank);
        this.apu.write(base + 2, r[2]);
        this.apu.write(base + 3, r[3] & 7);
        this.vib[note.ch | 0].on = false;
        continue;
      }
      // live channel mute (the Create editor's lanes): skip the trigger, let
      // note-offs still run. Never set on the radio or offline paths.
      if (this.chMute && this.chMute[note.ch | 0]) continue;
      if (this.mix) {
        var role = PRI_ROLE[note.pri | 0];
        if (role != null && this.mix[role] != null) g = this.mix[role];
        // Velocity has a 35% floor inside noteRegisters (an instrument at vel 0
        // still speaks), so a fader at zero must SKIP the trigger to be a mute.
        if (g <= 0.01) continue;
        // Scale velocity on a copy so hardware fields such as detune and sweep
        // survive the mixer, without mutating the stored score note.
        if (g !== 1) note = Object.assign({}, note, {
          vel: (note.vel == null ? 1 : note.vel) * g
        });
      }
      if ((note.ch | 0) === 2) this._loadWave(H.waveSlotOf(this.inst, note.inst));
      // channel 1 carries its sweep byte with the note; zero clears it so a
      // slide never leaks onto the note after it
      if ((note.ch | 0) === 0) this.apu.write(0x10, note.sweep || 0);
      r = H.noteRegisters(note, this.bank);
      this.apu.write(base, r[0]); this.apu.write(base + 1, r[1]);
      this.apu.write(base + 2, r[2]); this.apu.write(base + 3, r[3]);
      if ((note.ch | 0) < 2) {
        var vst = this.vib[note.ch | 0];
        vst.base = ((r[3] & 7) << 8) | r[2];
        vst.age = 0;
        vst.on = note.trigger == null && !((note.ch | 0) === 0 && note.sweep);
      }
    }
    // ...then this frame's automation, after the note-ons it belongs to
    var vo = this.vibOffAt[this.frame];
    if (vo) for (i = 0; i < vo.length; i++) if (vo[i] < 2) this.vib[vo[i]].on = false;
    var wls = this.waveAt[this.frame];
    if (wls != null) this._loadWave(wls);
    var kid = this.kitAt[this.frame];
    if (kid != null) this._kitStart(kid);
    var aw = this.auto[this.frame];
    if (aw) for (i = 0; i < aw.length; i++) this.apu.write(aw[i].r, aw[i].v);
    this.frame++;
  };

  // Ordinary note-offs on all four voices: instant silence with no DAC
  // power-cycle (the wave's NR32 goes to level 0; its DAC bit is untouched).
  Sequencer.prototype.cutNotes = function () {
    for (var ch = 0; ch < 4; ch++) {
      var base = 0x11 + ch * 5;
      this.apu.write(base + 1, 0x00); this.apu.write(base + 3, 0x80);
    }
    this.vib[0].on = false; this.vib[1].on = false;
  };

  // Loop wrap, cartridge style: fire the note-offs that were due exactly at
  // the boundary, wrap the counter, and keep the chip breathing. Building a
  // fresh APU here instead re-fires the power-on DAC writes with a reset
  // output capacitor, and that DC swing is an audible pop at every seam.
  Sequencer.prototype.rewind = function () {
    var evs = this.byFrame[this.frame], i, e, base;
    if (evs) for (i = 0; i < evs.length; i++) {
      e = evs[i];
      if (e.t !== 0) continue;
      base = 0x11 + (e.ch | 0) * 5;
      this.apu.write(base + 1, 0x00); this.apu.write(base + 3, 0x80);
      if ((e.ch | 0) < 2) this.vib[e.ch | 0].on = false;
    }
    this.frame = 0;
  };

  // Jump to a frame without rendering the audio in between: apply every register
  // write up to it and leave the chip in the state the last note set. Simulating
  // the skipped time would be exact but costs ~100ms for a two-minute offset,
  // and on the audio thread that is a dropout.
  Sequencer.prototype.seek = function (frame) {
    while (this.frame < frame) this._runFrame();
    this.acc = 0;
  };

  Sequencer.prototype.render = function (out, from, count) {
    // rate scales the FRAME clock only: a pinned tempo plays the score faster
    // or slower without touching pitch, exactly like a tracker's speed setting.
    // Envelopes and sweeps stay in real time, which is what the hardware does.
    var K = G.CT_GB_KITS;
    for (var i = 0; i < count; i++) {
      if (this.acc <= 0) { this._runFrame(); this.acc += this.samplesPerFrame / this.rate; }
      this.acc -= 1;
      // a sample refill lands mid-sample, so the advance is SPLIT at it: the
      // cartridge's interrupt is exact and this has to be too
      var cy = this.apu.cps;
      while (this.kit && this.kitCyc <= cy) {
        this.apu._advance(this.kitCyc);
        cy -= this.kitCyc;
        this._kitFill();
        this.kitCyc = K.BUF * (2048 - K.PERIOD) * 2;
      }
      if (this.kit) this.kitCyc -= cy;
      this.apu._advance(cy);
      out[from + i] = this.apu._mix();
    }
  };

  function render(gb, sampleRate) {
    sampleRate = sampleRate || 44100;
    var seq = new Sequencer(gb, sampleRate);
    var frames = (gb.totalFrames || 0) + 30;
    var total = Math.ceil(frames / (MASTER / FRAME_CYCLES) * sampleRate);
    var out = new Float32Array(total);
    seq.render(out, 0, total);
    return out;
  }

  var API = { render: render, Apu: Apu, Sequencer: Sequencer, DUTY: DUTY, DIVISORS: DIVISORS,
              MASTER: MASTER, FRAME_CYCLES: FRAME_CYCLES };
  G.CT_GB_APU = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : window);
