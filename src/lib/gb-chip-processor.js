// The Game Boy, on the audio thread.
//
// This file is only the processor shell: build.js prepends src/gb-hardware.js
// and src/gb-apu.js to it to produce dist/lib/gb-chip-worklet.js, because an
// AudioWorklet has its own global scope and cannot import from the page. That
// concatenation is the point -- the chip making sound in your browser is the
// same source scripts/gb-emu.js runs the cartridge through, so the two cannot
// drift apart without the build noticing.
//
// It renders mono, because a DMG is mono, and copies it to both outputs.
class GbChipProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.seq = null;
    this.paused = false;
    this.gb = null;
    this.lead = 0;
    // 'score' plays the composition through the chip. 'rom' executes the actual
    // exported cartridge -- same APU, but the register writes come from 8-bit
    // code instead of a sequencer, which is what "try it on a Game Boy" means.
    this.mode = 'score';
    this.cpu = null; this.romApu = null; this.owed = 0; this.dead = false;
    this.port.onmessage = (ev) => {
      try { this._onmsg(ev); } catch (e) {
        // an exception here would otherwise vanish: the handler dies silently
        // and the chip just never plays. Say what happened.
        this.port.postMessage({ type: 'msgError', message: String((e && e.message) || e), in: (ev.data || {}).type });
      }
    };
    this._onmsg = (ev) => {
      const m = ev.data || {};
      if (m.type === 'play') {
        var prevSeq = this.seq;
        this.gb = m.gb || null;
        // loopFrames: the Create editor plays a short song forever. At the
        // boundary the sequencer is rebuilt (its state machine has no rewind)
        // with the fractional sample accumulator carried over, so the loop
        // seam stays on the grid.
        this.loopFrames = m.loopFrames > 0 ? (m.loopFrames | 0) : 0;
        this.seq = this.gb ? new globalThis.CT_GB_APU.Sequencer(this.gb, sampleRate) : null;
        // Carry the running chip into the new song: same APU, same output
        // capacitor. A fresh APU's power-on DAC writes are a DC step through
        // a reset capacitor -- an audible pop on every live edit and track
        // start. The wave-table cache resets so the next wave note reloads.
        if (this.seq && prevSeq) {
          this.seq.apu = prevSeq.apu; this.seq.waveSlot = -1;
          // the old song's held notes must not ring into the new one (or into
          // a pause host); ordinary note-offs, so no DAC pop
          this.seq.cutNotes();
        }
        if (this.seq && this.chMuteMask) this.seq.chMute = this.chMuteMask;
        // A live join starts mid-track. Applying the register writes up to that
        // frame without simulating the intervening audio is instant and leaves
        // every channel holding whatever the last note before the join set --
        // which is what a listener tuning in halfway would hear anyway.
        if (this.seq && m.offsetFrames > 0) this.seq.seek(m.offsetFrames | 0);
        // The live mixer and a pinned tempo survive a track change: reapply the
        // last known settings to every new sequencer.
        if (this.seq && m.rate != null) this.chipRate = +m.rate;
        if (this.seq && m.mix) this.chipMix = m.mix;
        if (this.seq && this.chipRate) this.seq.setRate(this.chipRate);
        if (this.seq && this.chipMix) this.seq.setMix(this.chipMix);
        // Decks open a fraction of a second in the future so the event scheduler
        // has lead time; the chip waits the same amount or the games run ahead
        // of their own music.
        this.lead = Math.max(0, Math.round((m.leadSec || 0) * sampleRate));
        this.paused = !!m.paused;
      } else if (m.type === 'rom') {
        const G = globalThis;
        this.mode = 'rom'; this.dead = false; this.owed = 0; this.lead = 0;
        this.romApu = new G.CT_GB_APU.Apu(sampleRate);
        this.cps = G.CT_GB_APU.MASTER / sampleRate;
        const apu = this.romApu;
        this.cpu = new G.CT_GB_CPU.Cpu(new Uint8Array(m.bytes), {
          onIo: (reg, val) => { if (reg >= 0x10 && reg <= 0x3F) apu.write(reg, val); },
          onCycles: (c) => { this.owed += c; }
        });
        this.paused = !!m.paused;
      } else if (m.type === 'score') {
        this.mode = 'score'; this.cpu = null; this.romApu = null;
      } else if (m.type === 'pause') {
        this.paused = !!m.paused;
      } else if (m.type === 'poke') {
        // audition one note NOW, through the same chip: write its registers
        // straight into the running sequencer's APU and schedule the note-off.
        if (this.seq && m.note && globalThis.CT_GB) {
          var pn = m.note, pch = pn.ch | 0;
          var base = 0x11 + pch * 5;
          if (pch === 2 && this.seq._loadWave) this.seq._loadWave(globalThis.CT_GB.waveSlotOf(this.seq.inst, pn.inst));
          if (pch === 0) this.seq.apu.write(0x10, pn.sweep || 0);
          var pr = globalThis.CT_GB.noteRegisters(pn, this.seq.bank);
          this.seq.apu.write(base, pr[0]); this.seq.apu.write(base + 1, pr[1]);
          this.seq.apu.write(base + 2, pr[2]); this.seq.apu.write(base + 3, pr[3]);
          // one pending note-off PER CHANNEL: a single slot meant that
          // auditioning a note on another channel orphaned the previous one,
          // and it sang on forever underneath the song
          this.pokeOffs = this.pokeOffs || [null, null, null, null];
          this.pokeOffs[pch] = this.seq.frame + Math.max(4, pn.frames | 0);
        }
      } else if (m.type === 'pokeoff') {
        // stop an audition now (the pointer let go, or moved to another voice)
        if (this.seq) {
          var offCh = m.ch == null ? -1 : (m.ch | 0);
          for (var oc = 0; oc < 4; oc++) {
            if (offCh >= 0 && oc !== offCh) continue;
            if (this.pokeOffs && this.pokeOffs[oc] == null) continue;
            var ob2 = 0x11 + oc * 5;
            this.seq.apu.write(ob2 + 1, 0x00); this.seq.apu.write(ob2 + 3, 0x80);
            if (this.pokeOffs) this.pokeOffs[oc] = null;
          }
        }
      } else if (m.type === 'rate') {
        this.chipRate = Math.max(0.25, Math.min(4, +m.rate || 1));
        if (this.seq) this.seq.setRate(this.chipRate);
      } else if (m.type === 'mix') {
        this.chipMix = m.mix || null;
        if (this.seq && this.chipMix) this.seq.setMix(this.chipMix);
      } else if (m.type === 'chmute') {
        // mute mask for the editor's lanes; silences a newly muted channel
        // immediately with an ordinary note-off (wave: level 0, DAC kept)
        var mask = m.mask || null;
        if (this.seq) {
          var prev = this.seq.chMute || [false, false, false, false];
          for (var mc = 0; mc < 4; mc++) if (mask && mask[mc] && !prev[mc]) {
            var mb = 0x11 + mc * 5;
            this.seq.apu.write(mb + 1, 0x00); this.seq.apu.write(mb + 3, 0x80);
          }
          this.seq.chMute = mask;
        }
        this.chMuteMask = mask;
      } else if (m.type === 'stop') {
        this.seq = null; this.gb = null;
      }
    };
  }
  // Report the level back about twice a second. Silence that should not be
  // silent is the failure mode this whole change guards against, and it is
  // invisible from the page otherwise.
  report(L, frame) {
    let peak = 0;
    for (let i = 0; i < L.length; i++) { const a = L[i] < 0 ? -L[i] : L[i]; if (a > peak) peak = a; }
    this.peak = Math.max(this.peak || 0, peak);
    this.blocks = (this.blocks || 0) + 1;
    if (this.blocks >= 40) {
      this.port.postMessage({ type: 'stat', peak: this.peak, frame: frame, mode: this.mode });
      this.peak = 0; this.blocks = 0;
    }
  }
  process(inputs, outputs) {
    const out = outputs[0];
    if (!out || !out.length) return true;
    const L = out[0], R = out.length > 1 ? out[1] : null;
    if (this.mode === 'rom') {
      if (!this.cpu || this.paused || this.dead) { L.fill(0); if (R) R.fill(0); return true; }
      try {
        for (let i = 0; i < L.length; i++) {
          while (this.owed < this.cps) this.cpu.step();
          this.owed -= this.cps;
          this.romApu._advance(this.cps);
          L[i] = this.romApu._mix();
        }
      } catch (e) {
        // An exception thrown out of process() destroys the processor and the
        // page goes silent with no explanation. Stop this cartridge, say why.
        this.dead = true; L.fill(0);
        this.port.postMessage({ type: 'romError', message: String((e && e.message) || e) });
      }
      if (R) R.set(L);
      this.report(L, this.cpu ? this.cpu.frame : 0);
      return true;
    }
    if (!this.seq || this.paused) { L.fill(0); if (R) R.fill(0); return true; }
    if (this.loopFrames && this.seq.frame >= this.loopFrames) this.seq.rewind();
    if (this.pokeOffs) {
      for (var pc = 0; pc < 4; pc++) {
        if (this.pokeOffs[pc] == null || this.seq.frame < this.pokeOffs[pc]) continue;
        var ob = 0x11 + pc * 5;
        this.seq.apu.write(ob + 1, 0x00); this.seq.apu.write(ob + 3, 0x80);
        this.pokeOffs[pc] = null;
      }
    }
    let at = 0;
    if (this.lead > 0) {
      const n = Math.min(this.lead, L.length);
      L.fill(0, 0, n); this.lead -= n; at = n;
      if (at >= L.length) { if (R) R.set(L); return true; }
    }
    this.seq.render(L, at, L.length - at);
    if (R) R.set(L);
    this.report(L, this.seq.frame);
    return true;
  }
}
registerProcessor('chiptunes-gb-chip', GbChipProcessor);
