// The LR35902, enough of it to run our own cartridges.
//
// Lives in src/ rather than scripts/ because it has to ship: "Try on Game Boy"
// loads the exported ROM into an emulator in the page, and an AudioWorklet
// cannot import from anywhere -- build.js concatenates this into
// dist/lib/gb-chip-worklet.js beside the APU. scripts/gb-emu.js requires the
// same file, so the cartridge you hear in the browser and the one the tests
// execute are run by identical code.
//
// It implements exactly the opcodes src/gb-rom.js emits and THROWS on anything
// else, deliberately: an unimplemented opcode means the assembler produced
// something the driver was not supposed to contain. This is not a general Game
// Boy emulator and does not pretend to be one -- there is no PPU and no MBC.
// It does model the LY counter the driver polls for vblank, and the TIMER and
// its interrupt, because kit samples are streamed into wave RAM from the timer
// ISR: 256 refills a second, which is the only way to feed channel 3 at a rate
// worth listening to.
(function (G) {
  'use strict';

  // --------------------------------------------------------------------- CPU
  // `onIo(reg, val)` is called for every write to $FF00-$FFFF; `onCycles(n)` for
  // every instruction's cycle cost, in order, so a caller can clock hardware
  // alongside. Both are optional.
  function Cpu(rom, opts) {
    opts = opts || {};
    this.rom = rom;
    this.onIo = opts.onIo || null;
    this.onCycles = opts.onCycles || null;
    this.io = new Uint8Array(0x100);
    this.hram = new Uint8Array(0x80);
    // VRAM: $8000-$9FFF. The audio-only driver never touched it, so it used to
    // be dropped on the floor. The cartridge draws a level meter now, and
    // src/gb-ppu.js turns what lands here into the picture on the LCD.
    this.vram = new Uint8Array(0x2000);
    this.A = 0; this.B = 0; this.C = 0; this.D = 0; this.E = 0; this.H = 0; this.L = 0;
    this.SP = 0; this.PC = 0x100; this.Z = false; this.CY = false;
    this.ly = 0; this.dot = 0; this.frame = 0; this.cycles = 0;
    this.steps = 0;
    this.ime = false; this.divCyc = 0; this.timCyc = 0;
  }

  Cpu.prototype.rd = function (a) {
    if (a < 0x8000) return this.rom[a];
    if (a < 0xA000) return this.vram[a - 0x8000];
    return a >= 0xFF80 ? this.hram[a - 0xFF80] : this.io[a & 0xFF];
  };
  Cpu.prototype.wr = function (a, v) {
    if (a >= 0x8000 && a < 0xA000) { this.vram[a - 0x8000] = v; return; }
    if (a >= 0xFF80 && a < 0xFFFF) { this.hram[a - 0xFF80] = v; return; }
    if (a >= 0xFF00) { this.io[a & 0xFF] = v; if (this.onIo) this.onIo(a & 0xFF, v); }
  };
  Cpu.prototype.tick = function (n) {
    this.cycles += n;
    if (this.onCycles) this.onCycles(n);
    // The LCD is the only thing the driver observes: it polls LY for vblank.
    // 456 dots per line, 154 lines per frame -- which is what makes a "frame" here
    // the same unit the score counts in.
    this.dot += n;
    while (this.dot >= 456) {
      this.dot -= 456; this.ly++;
      if (this.ly > 153) { this.ly = 0; this.frame++; }
    }
    this.io[0x44] = this.ly;
    // DIV counts at 16384 Hz; the timer at whichever of the four rates TAC
    // selects, raising bit 2 of IF when TIMA wraps through TMA.
    this.divCyc += n;
    while (this.divCyc >= 256) { this.divCyc -= 256; this.io[0x04] = (this.io[0x04] + 1) & 0xFF; }
    var tac = this.io[0x07];
    if (tac & 4) {
      var sel = [1024, 16, 64, 256][tac & 3];
      this.timCyc += n;
      while (this.timCyc >= sel) {
        this.timCyc -= sel;
        var tv = (this.io[0x05] + 1) & 0xFF;
        if (tv === 0) { tv = this.io[0x06]; this.io[0x0F] |= 0x04; }
        this.io[0x05] = tv;
      }
    }
  };

  Cpu.prototype.step = function () {
    if (++this.steps > 2e9) throw new Error('gb-emu: CPU ran away (no progress)');
    // an enabled, requested interrupt takes the CPU before the next opcode
    var pend = this.ime ? (this.io[0xFF] & this.io[0x0F] & 0x1F) : 0;
    if (pend) {
      for (var ib = 0; ib < 5; ib++) {
        if (!(pend & (1 << ib))) continue;
        this.io[0x0F] &= ~(1 << ib);
        this.ime = false;
        this.SP = (this.SP - 2) & 0xFFFF;
        this.wr(this.SP, this.PC & 0xFF); this.wr(this.SP + 1, (this.PC >> 8) & 0xFF);
        this.PC = 0x40 + ib * 8;
        this.tick(20);
        return;
      }
    }
    const rd = a => this.rd(a), wr = (a, v) => this.wr(a, v), t = n => this.tick(n);
    const hl = () => (this.H << 8) | this.L, setHL = v => { this.H = (v >> 8) & 0xFF; this.L = v & 0xFF; };
    const op = rd(this.PC++);
    switch (op) {
      case 0x00: t(4); break;                                          // nop
      case 0xF3: this.ime = false; t(4); break;                        // di
      case 0xFB: this.ime = true; t(4); break;                         // ei
      case 0xD9: this.PC = rd(this.SP) | (rd(this.SP + 1) << 8); this.SP = (this.SP + 2) & 0xFFFF;
                 this.ime = true; t(16); break;                        // reti
      case 0xD5: this.SP = (this.SP - 2) & 0xFFFF; wr(this.SP, this.E); wr(this.SP + 1, this.D); t(16); break;
      case 0xD1: this.E = rd(this.SP); this.D = rd(this.SP + 1); this.SP = (this.SP + 2) & 0xFFFF; t(12); break;
      case 0x2B: setHL((hl() - 1) & 0xFFFF); t(8); break;              // dec hl
      case 0x09: setHL((hl() + ((this.B << 8) | this.C)) & 0xFFFF); t(8); break;   // add hl,bc
      case 0x6F: this.L = this.A; t(4); break;
      case 0x67: this.H = this.A; t(4); break;
      case 0x7D: this.A = this.L; t(4); break;
      case 0x7C: this.A = this.H; t(4); break;
      case 0x5D: this.E = this.L; t(4); break;
      case 0x54: this.D = this.H; t(4); break;
      case 0x6B: this.L = this.E; t(4); break;
      case 0x62: this.H = this.D; t(4); break;
      case 0x76: t(4); this.PC--; break;                               // halt: spin
      case 0x31: this.SP = rd(this.PC) | (rd(this.PC + 1) << 8); this.PC += 2; t(12); break;
      case 0x21: setHL(rd(this.PC) | (rd(this.PC + 1) << 8)); this.PC += 2; t(12); break;
      case 0x3E: this.A = rd(this.PC++); t(8); break;
      case 0x06: this.B = rd(this.PC++); t(8); break;
      case 0x0E: this.C = rd(this.PC++); t(8); break;
      case 0x16: this.D = rd(this.PC++); t(8); break;
      case 0x1E: this.E = rd(this.PC++); t(8); break;
      case 0xE0: wr(0xFF00 + rd(this.PC++), this.A); t(12); break;
      case 0xF0: this.A = rd(0xFF00 + rd(this.PC++)); t(12); break;
      case 0xE2: wr(0xFF00 + this.C, this.A); t(8); break;
      case 0x2A: this.A = rd(hl()); setHL((hl() + 1) & 0xFFFF); t(8); break;
      case 0x23: setHL((hl() + 1) & 0xFFFF); t(8); break;
      case 0x22: wr(hl(), this.A); setHL((hl() + 1) & 0xFFFF); t(8); break;   // ld [hl+],a
      case 0x19: setHL((hl() + ((this.D << 8) | this.E)) & 0xFFFF); t(8); break; // add hl,de
      case 0x0D: this.C = (this.C - 1) & 0xFF; this.Z = (this.C === 0); t(4); break;
      case 0x3C: this.A = (this.A + 1) & 0xFF; this.Z = (this.A === 0); t(4); break;   // inc a
      case 0xC6: { const s0 = this.A + rd(this.PC++); this.CY = s0 > 0xFF; this.A = s0 & 0xFF; this.Z = (this.A === 0); t(8); break; } // add a,n
      case 0x0C: this.C = (this.C + 1) & 0xFF; this.Z = (this.C === 0); t(4); break;
      case 0x13: { let de = (((this.D << 8) | this.E) + 1) & 0xFFFF; this.D = de >> 8; this.E = de & 0xFF; t(8); break; }
      case 0x1A: this.A = rd((this.D << 8) | this.E); t(8); break;
      case 0x7E: this.A = rd(hl()); t(8); break;
      case 0x77: wr(hl(), this.A); t(8); break;
      case 0x11: this.E = rd(this.PC); this.D = rd(this.PC + 1); this.PC += 2; t(12); break;
      case 0x01: this.C = rd(this.PC); this.B = rd(this.PC + 1); this.PC += 2; t(12); break;
      case 0xC5: this.SP = (this.SP - 2) & 0xFFFF; wr(this.SP, this.C); wr(this.SP + 1, this.B); t(16); break;
      case 0xC1: this.C = rd(this.SP); this.B = rd(this.SP + 1); this.SP = (this.SP + 2) & 0xFFFF; t(12); break;
      case 0x47: this.B = this.A; t(4); break;
      case 0x4F: this.C = this.A; t(4); break;
      case 0x57: this.D = this.A; t(4); break;
      case 0x5F: this.E = this.A; t(4); break;
      case 0x78: this.A = this.B; t(4); break;
      case 0x79: this.A = this.C; t(4); break;
      case 0x7A: this.A = this.D; t(4); break;
      case 0x7B: this.A = this.E; t(4); break;
      case 0xB7: this.Z = (this.A === 0); this.CY = false; t(4); break;                 // or a
      case 0xE6: this.A &= rd(this.PC++); this.Z = (this.A === 0); this.CY = false; t(8); break;
      // Added for the vibrato driver: the emulator had no carry flag at all,
      // and per-frame signed period math needs a real one.
      case 0xD6: { const n = rd(this.PC++); this.CY = (this.A < n); this.A = (this.A - n) & 0xFF; this.Z = (this.A === 0); t(8); break; } // sub n
      case 0x88: { const s0 = this.A + this.B + (this.CY ? 1 : 0); this.CY = s0 > 0xFF; this.A = s0 & 0xFF; this.Z = (this.A === 0); t(4); break; } // adc a,b
      case 0x1F: { const c0 = this.A & 1; this.A = ((this.A >> 1) | (this.CY ? 0x80 : 0)) & 0xFF; this.CY = !!c0; t(4); break; } // rra
      case 0x38: { const d = (rd(this.PC++) << 24) >> 24; if (this.CY) { this.PC += d; t(12); } else t(8); break; } // jr c
      case 0x30: { const d = (rd(this.PC++) << 24) >> 24; if (!this.CY) { this.PC += d; t(12); } else t(8); break; } // jr nc
      case 0xFE: { const n = rd(this.PC++); this.Z = (this.A === n); this.CY = (this.A < n); t(8); break; }
      case 0x07: this.A = ((this.A << 1) | (this.A >> 7)) & 0xFF; t(4); break;   // rlca
      case 0x87: { const s0 = this.A + this.A; this.CY = s0 > 0xFF; this.A = s0 & 0xFF; this.Z = (this.A === 0); t(4); break; }
      case 0x81: { const s0 = this.A + this.C; this.CY = s0 > 0xFF; this.A = s0 & 0xFF; this.Z = (this.A === 0); t(4); break; }
      case 0x80: { const s0 = this.A + this.B; this.CY = s0 > 0xFF; this.A = s0 & 0xFF; this.Z = (this.A === 0); t(4); break; }
      case 0x05: this.B = (this.B - 1) & 0xFF; this.Z = (this.B === 0); t(4); break;
      case 0x15: this.D = (this.D - 1) & 0xFF; this.Z = (this.D === 0); t(4); break;
      case 0x3D: this.A = (this.A - 1) & 0xFF; this.Z = (this.A === 0); t(4); break;
      case 0xF5: this.SP = (this.SP - 2) & 0xFFFF; wr(this.SP, this.Z ? 0x80 : 0); wr(this.SP + 1, this.A); t(16); break;
      case 0xF1: { const lo = rd(this.SP), hi = rd(this.SP + 1); this.SP = (this.SP + 2) & 0xFFFF; this.A = hi; this.Z = !!(lo & 0x80); t(12); break; }
      case 0xE5: this.SP = (this.SP - 2) & 0xFFFF; wr(this.SP, this.L); wr(this.SP + 1, this.H); t(16); break;
      case 0xE1: this.L = rd(this.SP); this.H = rd(this.SP + 1); this.SP = (this.SP + 2) & 0xFFFF; t(12); break;
      case 0x18: { const d = (rd(this.PC++) << 24) >> 24; this.PC += d; t(12); break; }
      case 0x28: { const d = (rd(this.PC++) << 24) >> 24; if (this.Z) { this.PC += d; t(12); } else t(8); break; }
      case 0x20: { const d = (rd(this.PC++) << 24) >> 24; if (!this.Z) { this.PC += d; t(12); } else t(8); break; }
      case 0xC3: this.PC = rd(this.PC) | (rd(this.PC + 1) << 8); t(16); break;
      case 0xCD: { const to = rd(this.PC) | (rd(this.PC + 1) << 8); this.PC += 2;
                   this.SP = (this.SP - 2) & 0xFFFF; wr(this.SP, this.PC & 0xFF); wr(this.SP + 1, this.PC >> 8);
                   this.PC = to; t(24); break; }
      case 0xC9: this.PC = rd(this.SP) | (rd(this.SP + 1) << 8); this.SP = (this.SP + 2) & 0xFFFF; t(16); break;
      default:
        throw new Error('gb-emu: unimplemented opcode $' + op.toString(16) +
                        ' at $' + (this.PC - 1).toString(16) + ' -- the driver emitted something unexpected');
    }
  };

  var API = { Cpu: Cpu };
  G.CT_GB_CPU = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : window);
