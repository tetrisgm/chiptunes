// Retro Rave Radio — generated-music synth worklet v2.
// Palette-driven chip engine: baked wavetables, LFSR noise (15/7-bit), tick engine
// (arp tables / stepped vibrato / duty envelopes / retrigger), per-voice SVF with
// envelope sweep, parameterized percussion, PCM sample voices, equal-power stereo,
// dual generation-tagged tempo-synced echo lines (gapless track boundaries).
// Deterministic: every phase/noise state derives from event seeds. No Math.random.
//
// Protocol (port messages in):
//   {type:'palette', generation, voices?, percs?, echo?, panLayout?, samples?}
//   {type:'events', generation?, events:[WEvent]}
//   {type:'echoTime', generation?, secondsPerBeat}
//   {type:'clearFuture', generation?, time?}
//   {type:'reset', generation?, paused?, mix?}
//   {type:'pause', paused} | {type:'mix', mix:{slot:gain, master?}} | {type:'panic'}
// Out: {type:'status', generation, queued, voices, paused, renderTimePerBlock}

const TWO_PI = Math.PI * 2;
const NOISE_PERIODS = [4, 8, 16, 32, 64, 96, 128, 160, 202, 254, 380, 508, 762, 1016, 2034, 4068];
const NOISE_CPU = 1789773; // NES CPU Hz; LFSR clock = CPU / period
const OSCS = { pulse: 1, tri: 1, saw: 1, sine: 1, wavetable: 1, noise: 1, sample: 1 };
const nowMs = (typeof performance !== 'undefined' && performance.now) ? () => performance.now() : () => Date.now();

// Per-kind percussion parameter defaults — defaults only; every field is
// overridable from the PercDef, no synthesis constants live in render code.
const PDEF = {
  kick:  { tone: { freq: 158, end: 43, sweepT: 0.042, level: 1.15, decT: 0.085, osc: 'sine' }, noise: { mode: 15, period: 5, level: 0, decT: 0.03, hp: 0 }, click: { level: 0.5, decT: 0.0035 } },
  snare: { tone: { freq: 196, end: 148, sweepT: 0.02, level: 0.34, decT: 0.05, osc: 'sine' }, noise: { mode: 15, period: 6, level: 0.85, decT: 0.08, hp: 0.3 }, click: { level: 0.18, decT: 0.003 } },
  hat:   { tone: { freq: 420, end: 420, sweepT: 0.01, level: 0, decT: 0.03, osc: 'sine' }, noise: { mode: 7, period: 1, level: 0.78, decT: 0.032, hp: 0.62 }, click: { level: 0, decT: 0.002 } },
  tom:   { tone: { freq: 176, end: 88, sweepT: 0.14, level: 1, decT: 0.16, osc: 'sine' }, noise: { mode: 15, period: 8, level: 0.1, decT: 0.04, hp: 0.1 }, click: { level: 0.2, decT: 0.003 } },
  zap:   { tone: { freq: 1240, end: 55, sweepT: 0.13, level: 0.9, decT: 0.13, osc: 'saw' }, noise: { mode: 15, period: 3, level: 0, decT: 0.03, hp: 0 }, click: { level: 0, decT: 0.002 } }
};

function clip(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }
function num(x, dflt) { return (typeof x === 'number' && isFinite(x)) ? x : dflt; }
function h32(x) {
  x = Math.imul(x ^ (x >>> 16), 2246822519);
  x = Math.imul(x ^ (x >>> 13), 3266489917);
  return (x ^ (x >>> 16)) >>> 0;
}

// Oscillator eval on normalized phase p in [0,1).
function oscEval(osc, p, duty, table) {
  if (osc === 'pulse') return p < duty ? 1 : -1;
  if (osc === 'tri') { const q = p - 0.25; return 1 - 4 * Math.abs(Math.round(q) - q); }
  if (osc === 'saw') return 2 * (p - Math.round(p));
  if (osc === 'sine') return Math.sin(p * TWO_PI);
  if (!table) return 0;
  const x = p * 128; const i = x | 0; const fr = x - i;
  const a = table[i & 127]; const b = table[(i + 1) & 127];
  return a + (b - a) * fr;
}

class RetroRaveGeneratedSynth extends AudioWorkletProcessor {
  constructor() {
    super();
    this.events = [];
    this.eventHead = 0;
    this.voices = [];
    this.generation = 1;
    this.paused = false;
    this.master = 1;
    this.mix = Object.create(null);
    this._mixKeys = 0;
    this.samples = Object.create(null);
    this.echoes = [];
    this._ticks = 0;
    this._lastSort = 0;
    this._rtAcc = 0;
    this._rtN = 0;
    this.palette = { voices: Object.create(null), percs: Object.create(null), echoDef: this._normEcho(null), panLayout: Object.create(null) };
    this._defaultPalette();
    this._newEchoLine(this.generation, this.palette.echoDef);
    this.port.onmessage = (ev) => this._message(ev.data || {});
  }

  // Fallback palette so slot events resolve before the first palette message.
  _defaultPalette() {
    const V = {
      lead:    { osc: 'pulse', duty: 0.5, detune: 7, env: { a: 0.004, d: 0.1, s: 0.6, r: 0.08 }, sendEcho: 0.18 },
      bass:    { osc: 'tri', env: { a: 0.003, d: 0.09, s: 0.72, r: 0.05 } },
      chord:   { osc: 'pulse', duty: 0.25, env: { a: 0.005, d: 0.12, s: 0.5, r: 0.09 }, sendEcho: 0.12, pan: -0.25 },
      pad:     { osc: 'tri', detune: 9, env: { a: 0.05, d: 0.3, s: 0.7, r: 0.28 }, sendEcho: 0.3, pan: 0.25 },
      counter: { osc: 'pulse', duty: 0.125, env: { a: 0.004, d: 0.08, s: 0.55, r: 0.07 }, sendEcho: 0.22, pan: 0.35 }
    };
    for (const k in V) this.palette.voices[k] = this._normVoice(V[k]);
    const P = { kick: { kind: 'kick' }, snare: { kind: 'snare' }, hat: { kind: 'hat' }, extra: { kind: 'tom' } };
    for (const k in P) this.palette.percs[k] = this._normPerc(P[k], k);
  }

  // ---------- messages ----------

  _message(msg) {
    const type = msg.type;
    if (type === 'events' && Array.isArray(msg.events)) {
      const gen = msg.generation || this.generation;
      if (gen !== this.generation) return;
      let needsSort = false;
      let lastTime = this.events.length > this.eventHead ? this.events[this.events.length - 1].time : -Infinity;
      for (let i = 0; i < msg.events.length; i++) {
        const ev = msg.events[i];
        if (!ev || !isFinite(ev.time)) continue;
        ev.generation = gen;
        if (ev.time < lastTime) needsSort = true;
        lastTime = ev.time;
        this.events.push(ev);
      }
      this._compactEvents(24000);
      if (needsSort) this._sortEvents();
      this._postStatus(false);
      return;
    }
    if (type === 'palette') { this._palette(msg); return; }
    if (type === 'echoTime') {
      if (msg.generation && msg.generation !== this.generation) return;
      const spb = num(msg.secondsPerBeat, num(msg.spb, 0));
      if (spb <= 0) return;
      const line = this._lineForGen(this.generation);
      if (!line || line.frozen) return;
      line.def.spb = clip(spb, 0.05, 4);
      if (line.def.timeS > 0) return; // absolute-time echo, tempo doesn't retime it
      this._retimeLine(line, line.def);
      return;
    }
    if (type === 'clearFuture') {
      if (msg.generation && msg.generation !== this.generation) return;
      const cutoff = isFinite(msg.time) ? +msg.time : currentTime;
      const kept = [];
      for (let i = this.eventHead; i < this.events.length; i++) {
        const ev = this.events[i];
        if (ev && ev.time < cutoff) kept.push(ev);
      }
      this.events = kept;
      this.eventHead = 0;
      this._postStatus(true);
      return;
    }
    if (type === 'reset') {
      this.generation = msg.generation || (this.generation + 1);
      this.events = [];
      this.eventHead = 0;
      this.voices = [];
      this.paused = !!msg.paused;
      if (msg.mix) this._setMix(msg.mix);
      for (let i = this.echoes.length - 1; i >= 0; i--) this._dropLine(this.echoes[i]);
      this._newEchoLine(this.generation, this.palette.echoDef);
      this._postStatus(true);
      return;
    }
    if (type === 'panic') {
      this.events = [];
      this.eventHead = 0;
      this.voices = [];
      for (let i = 0; i < this.echoes.length; i++) {
        const e = this.echoes[i];
        e.bufL.fill(0); e.bufR.fill(0);
        e.lpL = 0; e.lpR = 0; e.inL = 0; e.inR = 0; e.peak = 0;
      }
      this._postStatus(true);
      return;
    }
    if (type === 'pause') {
      this.paused = !!msg.paused;
      this._postStatus(true);
      return;
    }
    if (type === 'mix') {
      this._setMix(msg.mix || msg);
      return;
    }
  }

  _palette(msg) {
    const gen = num(msg.generation, this.generation);
    const newGen = gen !== this.generation;
    if (msg.samples) this._registerSamples(msg.samples);
    if (msg.voices && typeof msg.voices === 'object') {
      const m = Object.create(null);
      const keys = Object.keys(msg.voices).slice(0, 12);
      for (let i = 0; i < keys.length; i++) m[keys[i]] = this._normVoice(msg.voices[keys[i]]);
      this.palette.voices = m;
    }
    if (msg.percs && typeof msg.percs === 'object') {
      const m = Object.create(null);
      const keys = Object.keys(msg.percs).slice(0, 12);
      for (let i = 0; i < keys.length; i++) m[keys[i]] = this._normPerc(msg.percs[keys[i]], keys[i]);
      this.palette.percs = m;
    }
    if (msg.panLayout && typeof msg.panLayout === 'object') {
      const m = Object.create(null);
      const keys = Object.keys(msg.panLayout).slice(0, 24);
      for (let i = 0; i < keys.length; i++) {
        const val = +msg.panLayout[keys[i]];
        if (isFinite(val)) m[keys[i]] = clip(val, -1, 1);
      }
      this.palette.panLayout = m;
    }
    if (msg.echo) this.palette.echoDef = this._normEcho(msg.echo);
    if (newGen) {
      // Track boundary: stale queued events die, ringing voices keep their
      // snapshots, outgoing echo line freezes params and drains.
      this.events = [];
      this.eventHead = 0;
      const cur = this._lineForGen(this.generation);
      if (cur && !cur.frozen) { cur.frozen = true; cur.frozeAt = currentTime; cur.dieAt = currentTime + 12; }
      this.generation = gen;
      this._newEchoLine(gen, this.palette.echoDef);
    } else if (msg.echo) {
      const line = this._lineForGen(gen);
      if (line && !line.frozen) this._retimeLine(line, this.palette.echoDef);
      else if (!line) this._newEchoLine(gen, this.palette.echoDef);
    }
    this._postStatus(true);
  }

  _registerSamples(arr) {
    if (!Array.isArray(arr)) return;
    for (let i = 0; i < arr.length && i < 24; i++) {
      const s = arr[i];
      if (!s || typeof s.id !== 'string') continue;
      let pcm = s.pcm;
      if (!(pcm instanceof Float32Array)) {
        if (Array.isArray(pcm)) pcm = Float32Array.from(pcm);
        else continue;
      }
      if (pcm.length < 8) continue;
      if (pcm.length > 480000) pcm = pcm.subarray(0, 480000);
      const len = pcm.length;
      let ls = Math.floor(num(s.loopStart, -1));
      let le = Math.min(Math.floor(num(s.loopEnd, -1)), len - 1); // len-1: loop read interpolates i..i+1
      if (!(ls >= 0 && le > ls + 4)) { ls = 0; le = 0; }
      this.samples[s.id] = {
        pcm, len,
        rate: clip(num(s.rate, sampleRate), 4000, 192000),
        baseFreq: clip(num(s.baseFreq, 261.626), 8, 4000),
        loopStart: ls, loopEnd: le
      };
    }
  }

  _setMix(mix) {
    if (!mix || typeof mix !== 'object') return;
    for (const k in mix) {
      if (k === 'type') continue;
      const val = mix[k];
      if (typeof val !== 'number' || !isFinite(val)) continue;
      if (k === 'master') { this.master = clip(val, 0, 2); continue; }
      if (!(k in this.mix)) {
        if (this._mixKeys >= 64) continue;
        this._mixKeys++;
      }
      this.mix[k] = clip(val, 0, 3);
    }
  }

  // ---------- normalization ----------

  _normVoice(def) {
    def = def || {};
    const env = def.env || {};
    const fl = def.filter || null;
    const chip = def.chip || {};
    const vib = def.vib || null;
    const nz = def.noise || {};
    const osc = OSCS[def.osc] ? def.osc : 'pulse';
    const arpHz = (chip.arpHz === 15 || chip.arpHz === 30 || chip.arpHz === 60) ? chip.arpHz : 30;
    const tickHz = clip(num(chip.tickHz, 60), 5, 240);
    const n = {
      osc,
      duty: clip(num(def.duty, 0.5), 0.03, 0.97),
      table: null,
      sampleId: typeof def.sampleId === 'string' ? def.sampleId : null,
      noiseMode: num(nz.mode, 15) === 7 ? 7 : 15,
      noisePeriod: clip(Math.round(num(nz.period, 8)), 0, 15),
      noiseFollow: !!nz.followFreq,
      detune: clip(num(def.detune, 0), -1200, 1200),
      sub: clip(num(def.sub, 0), 0, 1),
      a: clip(num(env.a, num(def.attack, 0.004)), 0.0005, 2),
      d: clip(num(env.d, num(def.decay, 0.08)), 0.002, 4),
      s: clip(num(env.s, num(def.sustain, 0.65)), 0, 1),
      r: clip(num(env.r, num(def.release, 0.06)), 0.004, 4),
      glideT: clip(num(def.glideT, num(def.glide, 0.05)), 0.001, 2),
      vibRate: vib ? clip(num(vib.rate, 5.2), 0.1, 16) : 0,
      vibDepth: vib ? clip(num(vib.depth, 0.3), 0, 12) : 0,
      vibDelay: vib ? clip(num(vib.delay, 0.12), 0, 4) : 0,
      arp: null,
      arpDiv: Math.max(1, Math.round(tickHz / arpHz)),
      tickHz,
      dutyEnv: null,
      dutyEnvLoop: !!chip.dutyEnvLoop,
      retrig: clip(Math.round(num(chip.retrig, 0)), 0, 240),
      fl: null,
      pan: def.pan == null ? null : clip(num(def.pan, 0), -1, 1),
      hardPan: def.hardPan == null ? null : (def.hardPan < 0 ? -1 : def.hardPan > 0 ? 1 : 0),
      sendEcho: clip(num(def.sendEcho, 0), 0, 1),
      drive: clip(num(def.drive, 0), 0, 8),
      gainMul: clip(num(def.gainMul, 1), 0, 4)
    };
    if (Array.isArray(chip.arp) && chip.arp.length) {
      n.arp = chip.arp.slice(0, 16).map((x) => clip(num(+x, 0), -48, 48));
    }
    if (Array.isArray(chip.dutyEnv) && chip.dutyEnv.length) {
      n.dutyEnv = chip.dutyEnv.slice(0, 32).map((x) => clip(num(+x, 0.5), 0.03, 0.97));
    }
    if (fl) {
      n.fl = {
        type: fl.type === 'hp' ? 'hp' : fl.type === 'bp' ? 'bp' : 'lp',
        cutHz: fl.cutHz > 0 ? clip(+fl.cutHz, 30, 16000) : 0,
        cutMul: fl.cutMul > 0 ? clip(+fl.cutMul, 0.25, 64) : 0,
        q: clip(num(fl.q, 0.8), 0.5, 9),
        envAmt: clip(num(fl.envAmt, 0), -6, 6),
        envT: clip(num(fl.envT, 0.12), 0.01, 3)
      };
    }
    if (osc === 'wavetable') n.table = this._bakeTable(def.partials, def.crunchBits);
    return n;
  }

  // partials[] -> normalized 128-sample one-cycle wavetable; optional bit-crunch.
  _bakeTable(partials, crunchBits) {
    const N = 128;
    const t = new Float32Array(N);
    const P = (Array.isArray(partials) && partials.length) ? partials.slice(0, 32) : [1, 0.5, 0.33, 0.25, 0.2, 0.16];
    let mx = 0;
    for (let n = 0; n < N; n++) {
      let s = 0;
      for (let k = 0; k < P.length; k++) {
        const a = +P[k] || 0;
        if (a) s += a * Math.sin(TWO_PI * (k + 1) * n / N);
      }
      t[n] = s;
      const ab = s < 0 ? -s : s;
      if (ab > mx) mx = ab;
    }
    if (mx > 0) { for (let n = 0; n < N; n++) t[n] /= mx; }
    const bits = clip(Math.round(num(crunchBits, 0)), 0, 8);
    if (bits >= 2) {
      const L = (1 << bits) - 1;
      for (let n = 0; n < N; n++) t[n] = (Math.round((t[n] * 0.5 + 0.5) * L) / L) * 2 - 1;
    }
    return t;
  }

  _normPerc(d, slotHint) {
    d = d || {};
    const kind = PDEF[d.kind] ? d.kind : (PDEF[slotHint] ? slotHint : 'kick');
    const base = PDEF[kind];
    const tn = d.tone || {}, nz = d.noise || {}, ck = d.click || {};
    return {
      kind,
      tone: {
        freq: clip(num(tn.freq, base.tone.freq), 20, 8000),
        end: clip(num(tn.end, base.tone.end), 20, 8000),
        sweepT: clip(num(tn.sweepT, base.tone.sweepT), 0.004, 1),
        level: clip(num(tn.level, base.tone.level), 0, 2),
        decT: clip(num(tn.decT, base.tone.decT), 0.005, 1.2),
        osc: (tn.osc === 'tri' || tn.osc === 'saw' || tn.osc === 'pulse' || tn.osc === 'sine') ? tn.osc : base.tone.osc
      },
      noise: {
        mode: num(nz.mode, base.noise.mode) === 7 ? 7 : 15,
        period: clip(Math.round(num(nz.period, base.noise.period)), 0, 15),
        level: clip(num(nz.level, base.noise.level), 0, 2),
        decT: clip(num(nz.decT, base.noise.decT), 0.004, 1.2),
        hp: clip(num(nz.hp, base.noise.hp), 0, 1)
      },
      click: {
        level: clip(num(ck.level, base.click.level), 0, 2),
        decT: clip(num(ck.decT, base.click.decT), 0.0008, 0.05)
      },
      gainMul: clip(num(d.gainMul, 1), 0, 4),
      pan: d.pan == null ? null : clip(num(d.pan, 0), -1, 1),
      hardPan: d.hardPan == null ? null : (d.hardPan < 0 ? -1 : d.hardPan > 0 ? 1 : 0),
      sendEcho: clip(num(d.sendEcho, 0), 0, 1),
      drive: clip(num(d.drive, 0), 0, 8)
    };
  }

  _normEcho(d) {
    d = d || {};
    return {
      beats: clip(num(d.beats, 0.75), 0.03, 8),
      spb: clip(num(d.secondsPerBeat, 0.5), 0.05, 4),
      timeS: d.timeS > 0 ? clip(+d.timeS, 0.01, 1.9) : 0,
      fb: clip(num(d.fb, 0.32), 0, 0.7),
      damp: clip(num(d.damp, 0.4), 0, 1),
      level: clip(num(d.level, 0.2), 0, 1),
      ping: !!d.pingPong,
      spreadMs: clip(num(d.spreadMs, 12), 0, 60)
    };
  }

  // ---------- echo lines ----------

  _newEchoLine(gen, def) {
    const sr = sampleRate;
    const size = Math.ceil(sr * 2) + 8;
    const time = clip((def.timeS > 0 ? def.timeS : def.beats * def.spb) * sr, 32, size - 8);
    const line = {
      gen, def, size,
      bufL: new Float32Array(size), bufR: new Float32Array(size),
      w: 0, time, timeTarget: time, timeStep: 0,
      fb: def.fb, dampA: clip(1 - 0.92 * def.damp, 0.05, 1), level: def.level, ping: def.ping,
      spread: Math.round(def.spreadMs * 0.001 * sr),
      lpL: 0, lpR: 0, inL: 0, inR: 0, outL: 0, outR: 0, peak: 0,
      frozen: false, frozeAt: 0, dieAt: Infinity, dead: false
    };
    this.echoes.push(line);
    while (this.echoes.length > 2) this._dropLine(this.echoes[0]);
    return line;
  }

  _retimeLine(line, def) {
    line.def = def;
    line.fb = def.fb;
    line.dampA = clip(1 - 0.92 * def.damp, 0.05, 1);
    line.level = def.level;
    line.ping = def.ping;
    line.spread = Math.round(def.spreadMs * 0.001 * sampleRate);
    const t = clip((def.timeS > 0 ? def.timeS : def.beats * def.spb) * sampleRate, 32, line.size - 8);
    line.timeTarget = t;
    line.timeStep = (t - line.time) / (0.035 * sampleRate); // ~35ms tape-slew
  }

  _lineForGen(g) {
    for (let i = this.echoes.length - 1; i >= 0; i--) {
      if (this.echoes[i].gen === g) return this.echoes[i];
    }
    return null;
  }

  _dropLine(e) {
    e.dead = true;
    const i = this.echoes.indexOf(e);
    if (i >= 0) this.echoes.splice(i, 1);
    for (let j = 0; j < this.voices.length; j++) {
      if (this.voices[j].echo === e) this.voices[j].echo = null;
    }
  }

  _echoStep(e) {
    if (e.timeStep !== 0) {
      e.time += e.timeStep;
      if (e.timeStep > 0 ? e.time >= e.timeTarget : e.time <= e.timeTarget) {
        e.time = e.timeTarget;
        e.timeStep = 0;
      }
    }
    const size = e.size, w = e.w;
    let p = w - e.time;
    if (p < 0) p += size;
    let i0 = p | 0, fr = p - i0, i1 = i0 + 1;
    if (i1 >= size) i1 -= size;
    const rL = e.bufL[i0] + (e.bufL[i1] - e.bufL[i0]) * fr;
    let dR = e.time + e.spread; // right tap offset for width; keep inside buffer span
    if (dR > size - 4) dR = size - 4;
    p = w - dR;
    if (p < 0) p += size;
    i0 = p | 0; fr = p - i0; i1 = i0 + 1;
    if (i1 >= size) i1 -= size;
    const rR = e.bufR[i0] + (e.bufR[i1] - e.bufR[i0]) * fr;
    e.lpL += (rL - e.lpL) * e.dampA;
    e.lpR += (rR - e.lpR) * e.dampA;
    const fL = e.lpL, fR = e.lpR;
    e.bufL[w] = e.inL + (e.ping ? fR : fL) * e.fb;
    e.bufR[w] = e.inR + (e.ping ? fL : fR) * e.fb;
    e.w = w + 1 >= size ? 0 : w + 1;
    e.inL = 0; e.inR = 0;
    e.outL = fL * e.level;
    e.outR = fR * e.level;
    const m = (fL < 0 ? -fL : fL) + (fR < 0 ? -fR : fR);
    e.peak = m > e.peak ? m : e.peak * 0.9995;
  }

  // ---------- event queue plumbing ----------

  _sortEvents() {
    if (this.eventHead > 0) {
      this.events = this.events.slice(this.eventHead);
      this.eventHead = 0;
    }
    if (this.events.length < 2) return;
    this.events.sort((a, b) => a.time - b.time);
    this._lastSort = currentTime;
  }

  _compactEvents(maxQueued) {
    if (this.eventHead > 0 && (this.eventHead > 4096 || this.eventHead > this.events.length / 2)) {
      this.events = this.events.slice(this.eventHead);
      this.eventHead = 0;
    }
    const queued = this.events.length - this.eventHead;
    if (queued > maxQueued) {
      this.events = this.events.slice(this.events.length - maxQueued);
      this.eventHead = 0;
    }
  }

  _postStatus(force) {
    if (!force && (++this._ticks % 128) !== 0) return;
    const rt = this._rtN ? this._rtAcc / this._rtN : 0;
    this._rtAcc = 0;
    this._rtN = 0;
    this.port.postMessage({
      type: 'status',
      generation: this.generation,
      queued: Math.max(0, this.events.length - this.eventHead),
      voices: this.voices.length,
      paused: this.paused,
      renderTimePerBlock: rt
    });
  }

  // ---------- note start ----------

  _start(ev, t) {
    if ((ev.generation || this.generation) !== this.generation) return;
    const slot = typeof ev.slot === 'string' ? ev.slot : 'lead';
    const pd = this.palette.percs[slot];
    if (pd) { this._startPerc(ev, t, slot, pd); return; }
    const vd = this.palette.voices[slot];
    if (vd) this._startVoice(ev, t, slot, vd);
  }

  _addVoice(v) {
    if (this.voices.length >= 32) {
      let qi = 0, qa = Infinity;
      for (let i = 0; i < this.voices.length; i++) {
        const a = this.voices[i]._amp;
        if (a < qa) { qa = a; qi = i; }
      }
      const old = this.voices[qi];
      if (old.echo) old.echo = null;
      this.voices[qi] = v;
    } else {
      this.voices.push(v);
    }
  }

  _seedOf(ev, salt) {
    const base = (typeof ev.seed === 'number' && isFinite(ev.seed)) ? (ev.seed >>> 0) : ((ev.time * 1024) >>> 0);
    return h32(base + salt);
  }

  _panOf(ev, def, slot) {
    let pan = num(ev.pan, NaN);
    if (!isFinite(pan)) {
      pan = def.hardPan != null ? def.hardPan
        : def.pan != null ? def.pan
        : num(this.palette.panLayout[slot], 0);
    }
    return clip(pan || 0, -1, 1);
  }

  _startVoice(ev, t, slot, def) {
    const sr = sampleRate;
    const seed = this._seedOf(ev, 0x9e3779b9);
    const freq = clip(num(ev.freq, 220), 16, 12000);
    let vel = clip(num(ev.vel, 0.1), 0, 2.5);
    if (ev.accent) vel *= typeof ev.accent === 'number' ? clip(ev.accent, 0.25, 3) : 1.3;
    const dur = clip(num(ev.dur, 0.15), 0.012, 12);
    // glide (event `from` Hz -> freq over def.glideT) + per-note slide
    let f0 = freq, glideMul = 1;
    const from = num(ev.from, 0);
    if (from > 15 && Math.abs(from - freq) > 0.5) {
      f0 = clip(from, 16, 12000);
      glideMul = Math.pow(freq / f0, 1 / Math.max(1, def.glideT * sr));
    }
    const slide = clip(num(ev.slideSemis, 0), -48, 48);
    const slideMul = slide ? Math.pow(2, slide / (12 * Math.max(1, dur * sr))) : 1;
    const pan = this._panOf(ev, def, slot);
    const ang = (pan + 1) * (Math.PI / 4);
    // filter: def.filter and/or per-event cut/cutMul/q (events can introduce one)
    const fl = def.fl;
    const hasEvF = ev.cut > 0 || ev.cutMul > 0 || ev.q > 0;
    const flOn = !!fl || hasEvF;
    let flHz = 8000, flQ = 0.8, flEnvAmt = 0, flEnvT = 0.12, flType = 0;
    if (flOn) {
      if (fl) {
        flType = fl.type === 'hp' ? 2 : fl.type === 'bp' ? 1 : 0;
        flQ = fl.q; flEnvAmt = fl.envAmt; flEnvT = fl.envT;
        flHz = fl.cutHz > 0 ? fl.cutHz : (fl.cutMul > 0 ? fl.cutMul : 4) * freq;
      }
      if (ev.cut > 0) flHz = +ev.cut;
      else if (ev.cutMul > 0) flHz = ev.cutMul * freq;
      if (ev.q > 0) flQ = +ev.q;
      flHz = clip(flHz, 30, sr * 0.24);
      flQ = clip(flQ, 0.5, 9);
    }
    const flDamp = clip(1 / flQ, 0.12, 2);
    const fc0 = flOn ? clip(flHz * (flEnvAmt ? Math.pow(2, flEnvAmt) : 1), 30, sr * 0.24) : 0;
    const drive = clip(num(ev.drive, def.drive), 0, 8);
    const sendEcho = clip(num(ev.sendEcho, def.sendEcho), 0, 1);
    let arp = def.arp;
    if (Array.isArray(ev.arp) && ev.arp.length) {
      arp = ev.arp.slice(0, 16).map((x) => clip(num(+x, 0), -48, 48));
    }
    const v = {
      perc: false, slot,
      start: t, dur, r: def.r, end: t + dur + def.r + 0.03, envX0: 0,
      vel: vel * def.gainMul,
      _mixG: typeof this.mix[slot] === 'number' ? this.mix[slot] : 1,
      osc: def.osc,
      duty: ev.dutyStart != null ? clip(num(+ev.dutyStart, def.duty), 0.03, 0.97) : def.duty,
      table: def.table,
      detR: def.detune ? Math.pow(2, def.detune / 1200) : 0,
      sub: def.sub,
      phase: (seed & 0xffff) / 65536,
      phase2: ((seed >>> 16) & 0xffff) / 65536,
      subPhase: ((seed >>> 8) & 0xffff) / 65536,
      f: f0, fTarget: freq, glideMul, slideMul,
      a: def.a, d: def.d, s: def.s,
      tick: -1, tickHz: def.tickHz, tickMult: 1,
      arp, arpDiv: def.arpDiv,
      vibRate: def.vibRate, vibDepth: def.vibDepth, vibDelay: def.vibDelay,
      dutyEnv: def.dutyEnv, dutyEnvLoop: def.dutyEnvLoop, retrig: def.retrig,
      fl: flOn, flType, flHz, flDamp,
      flComp: clip(0.38 + 0.62 * flDamp, 0.38, 1),
      flCoef: flOn ? Math.min(1.2, 2 * Math.sin(Math.PI * fc0 / sr)) : 0,
      flEnvAmt, flEnvV: 1,
      flEnvK: Math.exp(-1 / (Math.max(0.01, flEnvT) * def.tickHz)),
      flLow: 0, flBand: 0,
      drive, driveK: 1 + drive, driveN: 1 / (1 + drive * 0.35),
      gL: Math.cos(ang), gR: Math.sin(ang),
      sendEcho, echo: sendEcho > 0 ? this._lineForGen(this.generation) : null,
      nshort: def.noiseMode === 7,
      lfsr: (seed & 0x7fff) || 0x4a1b,
      nphase: 0, nval: 0, nRate: 0, nFollow: def.noiseFollow, nPeriod: def.noisePeriod,
      smp: null, smpPos: 0, smpK: 0, smpLoop: false, smpLS: 0, smpLE: 0,
      _amp: vel * def.gainMul + 0.001
    };
    if (def.osc === 'noise') this._setNoiseRate(v, freq);
    else if (def.osc === 'sample') {
      const sm = def.sampleId ? this.samples[def.sampleId] : null;
      if (!sm) return; // sample not registered -> drop event
      v.smp = sm;
      v.smpK = sm.rate / (sm.baseFreq * sr);
      if (sm.loopEnd > sm.loopStart) { v.smpLoop = true; v.smpLS = sm.loopStart; v.smpLE = sm.loopEnd; }
    }
    this._addVoice(v);
  }

  _startPerc(ev, t, slot, def) {
    const sr = sampleRate;
    const seed = this._seedOf(ev, 0x51ed270b);
    let vel = clip(num(ev.vel, 0.5), 0, 2.5);
    if (ev.accent) vel *= typeof ev.accent === 'number' ? clip(ev.accent, 0.25, 3) : 1.3;
    const tn = def.tone, nz = def.noise, ck = def.click;
    const ratio = (ev.freq > 0 && tn.freq > 0) ? clip(ev.freq / tn.freq, 0.05, 12) : 1;
    const f0 = tn.freq * ratio, f1 = tn.end * ratio;
    const pan = this._panOf(ev, def, slot);
    const ang = (pan + 1) * (Math.PI / 4);
    const drive = clip(num(ev.drive, def.drive), 0, 8);
    const sendEcho = clip(num(ev.sendEcho, def.sendEcho), 0, 1);
    const tail = 8 * Math.max(tn.level > 0 ? tn.decT : 0, nz.level > 0 ? nz.decT : 0, ck.level > 0 ? ck.decT : 0, 0.02);
    const v = {
      perc: true, slot,
      start: t, end: t + Math.min(2.5, tail) + 0.02,
      vel: vel * def.gainMul,
      _mixG: typeof this.mix[slot] === 'number' ? this.mix[slot] : 1,
      gL: Math.cos(ang), gR: Math.sin(ang),
      sendEcho, echo: sendEcho > 0 ? this._lineForGen(this.generation) : null,
      drive, driveK: 1 + drive, driveN: 1 / (1 + drive * 0.35),
      tLevel: tn.level, tFreq: f0, tEnd: f1, tOsc: tn.osc,
      tSweepK: (tn.level > 0 && f0 !== f1) ? Math.pow(f1 / f0, 1 / Math.max(1, tn.sweepT * sr)) : 1,
      tPhase: (seed & 0xffff) / 65536,
      tEnv: 1, tDecK: Math.exp(-1 / (tn.decT * sr)),
      nLevel: nz.level, nshort: nz.mode === 7,
      lfsr: (seed & 0x7fff) || 0x4a1b,
      nphase: 0, nval: 0,
      nRate: Math.min(8, (NOISE_CPU / NOISE_PERIODS[nz.period]) / sr),
      nEnv: 1, nDecK: Math.exp(-1 / (nz.decT * sr)),
      nHpA: nz.hp > 0 ? clip(nz.hp * 0.55, 0.02, 0.6) : 0, nHp: 0,
      cLevel: ck.level,
      clf: ((seed >>> 12) & 0x7fff) || 0x2a5a,
      cEnv: 1, cDecK: Math.exp(-1 / (ck.decT * sr)),
      _amp: vel * def.gainMul + 0.001
    };
    this._addVoice(v);
  }

  _setNoiseRate(v, f) {
    let idx = v.nPeriod;
    if (v.nFollow && f > 0) {
      const target = NOISE_CPU / Math.max(200, f * 64);
      idx = 0;
      let best = Infinity;
      for (let i = 0; i < 16; i++) {
        const d = Math.abs(NOISE_PERIODS[i] - target);
        if (d < best) { best = d; idx = i; }
      }
    }
    v.nRate = Math.min(8, (NOISE_CPU / NOISE_PERIODS[idx]) / sampleRate);
  }

  // ---------- per-voice render ----------

  _tickVoice(v, k, x) {
    v.tick = k;
    let semis = 0;
    if (v.arp) semis = v.arp[((k / v.arpDiv) | 0) % v.arp.length];
    if (v.vibDepth > 0 && x >= v.vibDelay) {
      semis += v.vibDepth * Math.sin(TWO_PI * v.vibRate * (k / v.tickHz));
    }
    v.tickMult = semis === 0 ? 1 : Math.pow(2, semis / 12);
    const de = v.dutyEnv;
    if (de) {
      const n = de.length;
      v.duty = de[v.dutyEnvLoop ? k % n : (k < n ? k : n - 1)];
    }
    if (v.retrig > 0 && k > 0 && k % v.retrig === 0) {
      v.envX0 = x;
      v.phase = 0;
      v.phase2 = 0;
    }
    if (v.nFollow && v.osc === 'noise') this._setNoiseRate(v, v.f * v.tickMult);
    if (v.fl && v.flEnvAmt !== 0) {
      v.flEnvV *= v.flEnvK;
      const fc = clip(v.flHz * Math.pow(2, v.flEnvAmt * v.flEnvV), 30, sampleRate * 0.24);
      v.flCoef = Math.min(1.2, 2 * Math.sin(Math.PI * fc / sampleRate));
    }
  }

  _renderVoice(v, t) {
    const x = t - v.start;
    if (x < 0) return 0;
    const k = (x * v.tickHz) | 0;
    if (k !== v.tick) this._tickVoice(v, k, x);
    if (v.glideMul !== 1) {
      v.f *= v.glideMul;
      if (v.glideMul > 1 ? v.f >= v.fTarget : v.f <= v.fTarget) {
        v.f = v.fTarget;
        v.glideMul = 1;
      }
    }
    if (v.slideMul !== 1 && x < v.dur) { v.f *= v.slideMul; v.fTarget *= v.slideMul; }
    const freq = v.f * v.tickMult;
    const osc = v.osc;
    let s;
    if (osc === 'noise') {
      let acc = v.nphase + v.nRate;
      if (acc >= 1) {
        let steps = acc | 0;
        acc -= steps;
        if (steps > 8) steps = 8;
        let lf = v.lfsr;
        const tap = v.nshort ? 6 : 1;
        while (steps-- > 0) {
          const b = (lf ^ (lf >> tap)) & 1;
          lf = ((lf >> 1) | (b << 14)) & 0x7fff;
        }
        v.lfsr = lf;
        v.nval = (lf & 1) ? 0.8 : -0.8;
      }
      v.nphase = acc;
      s = v.nval;
    } else if (osc === 'sample') {
      const sm = v.smp;
      let pos = v.smpPos + freq * v.smpK;
      if (v.smpLoop) {
        const len = v.smpLE - v.smpLS;
        while (pos >= v.smpLE) pos -= len;
      }
      v.smpPos = pos;
      if (pos >= sm.len - 1) s = 0;
      else {
        const i = pos | 0;
        const fr = pos - i;
        const pc = sm.pcm;
        s = pc[i] + (pc[i + 1] - pc[i]) * fr;
      }
    } else {
      const inc = freq / sampleRate;
      let p = v.phase + inc;
      if (p >= 1) p -= 1;
      v.phase = p;
      s = oscEval(osc, p, v.duty, v.table);
      if (v.detR) {
        let p2 = v.phase2 + inc * v.detR;
        if (p2 >= 1) p2 -= 1;
        v.phase2 = p2;
        s = (s + oscEval(osc, p2, v.duty, v.table) * 0.85) * 0.62;
      }
      if (v.sub) {
        let ps = v.subPhase + inc * 0.5;
        if (ps >= 1) ps -= 1;
        v.subPhase = ps;
        s += Math.sin(ps * TWO_PI) * v.sub * 0.55;
      }
    }
    // ADSR: linear attack/decay to sustain; release keyed to absolute gate end.
    let e;
    const xr = x - v.envX0;
    if (xr < v.a) e = xr / v.a;
    else {
      const dd = (xr - v.a) / v.d;
      e = dd >= 1 ? v.s : 1 + (v.s - 1) * dd;
    }
    if (x >= v.dur) {
      const rr = 1 - (x - v.dur) / v.r;
      e *= rr > 0 ? rr : 0;
    }
    if (v.fl) {
      v.flLow += v.flCoef * v.flBand;
      const hi = s - v.flLow - v.flDamp * v.flBand;
      v.flBand += v.flCoef * hi;
      if (v.flBand > 8) v.flBand = 8; else if (v.flBand < -8) v.flBand = -8;
      s = (v.flType === 2 ? hi : v.flType === 1 ? v.flBand : v.flLow) * v.flComp;
    }
    if (v.drive) s = Math.tanh(s * v.driveK) * v.driveN;
    s = s * e * v.vel * v._mixG;
    v._amp = s < 0 ? -s : s;
    return s;
  }

  _renderPerc(v, t) {
    const x = t - v.start;
    if (x < 0) return 0;
    let s = 0;
    if (v.tLevel > 0) {
      let p = v.tPhase + v.tFreq / sampleRate;
      if (p >= 1) p -= 1;
      v.tPhase = p;
      if (v.tSweepK !== 1) {
        v.tFreq *= v.tSweepK;
        if (v.tSweepK < 1 ? v.tFreq <= v.tEnd : v.tFreq >= v.tEnd) {
          v.tFreq = v.tEnd;
          v.tSweepK = 1;
        }
      }
      s += oscEval(v.tOsc, p, 0.5, null) * v.tEnv * v.tLevel;
      v.tEnv *= v.tDecK;
    }
    if (v.nLevel > 0) {
      let acc = v.nphase + v.nRate;
      if (acc >= 1) {
        let steps = acc | 0;
        acc -= steps;
        if (steps > 8) steps = 8;
        let lf = v.lfsr;
        const tap = v.nshort ? 6 : 1;
        while (steps-- > 0) {
          const b = (lf ^ (lf >> tap)) & 1;
          lf = ((lf >> 1) | (b << 14)) & 0x7fff;
        }
        v.lfsr = lf;
        v.nval = (lf & 1) ? 0.85 : -0.85;
      }
      v.nphase = acc;
      let nzv = v.nval;
      if (v.nHpA > 0) {
        v.nHp += (nzv - v.nHp) * v.nHpA;
        nzv -= v.nHp;
      }
      s += nzv * v.nEnv * v.nLevel;
      v.nEnv *= v.nDecK;
    }
    if (v.cLevel > 0) {
      const b = (v.clf ^ (v.clf >> 1)) & 1;
      v.clf = ((v.clf >> 1) | (b << 14)) & 0x7fff;
      s += ((v.clf & 1) ? 0.9 : -0.9) * v.cEnv * v.cLevel;
      v.cEnv *= v.cDecK;
    }
    if (v.drive) s = Math.tanh(s * v.driveK) * v.driveN;
    s = s * v.vel * v._mixG;
    v._amp = s < 0 ? -s : s;
    return s;
  }

  // ---------- main render ----------

  process(inputs, outputs) {
    const t0 = nowMs();
    const out = outputs[0];
    const L = out && out[0];
    const R = out && (out[1] || out[0]);
    if (!L || !R) return true;
    if (this.paused) {
      L.fill(0);
      R.fill(0);
      this._postStatus(false);
      return true;
    }
    const sr = sampleRate;
    const n = L.length;
    // block-top: refresh cached mix gains; retire drained frozen echo lines
    for (let j = 0; j < this.voices.length; j++) {
      const v = this.voices[j];
      const g = this.mix[v.slot];
      v._mixG = typeof g === 'number' ? g : 1;
    }
    for (let j = this.echoes.length - 1; j >= 0; j--) {
      const e = this.echoes[j];
      if (e.frozen && (currentTime > e.dieAt || (e.peak < 1e-5 && currentTime > e.frozeAt + 0.25))) {
        this._dropLine(e);
      }
    }
    const master = this.master;
    for (let i = 0; i < n; i++) {
      const t = currentTime + i / sr;
      while (this.eventHead < this.events.length && this.events[this.eventHead].time <= t + 0.0008) {
        this._start(this.events[this.eventHead++], t);
      }
      let sL = 0, sR = 0;
      for (let j = this.voices.length - 1; j >= 0; j--) {
        const v = this.voices[j];
        if (t > v.end) {
          this.voices[j] = this.voices[this.voices.length - 1];
          this.voices.pop();
          continue;
        }
        const s = v.perc ? this._renderPerc(v, t) : this._renderVoice(v, t);
        if (s !== 0) {
          const l = s * v.gL, r = s * v.gR;
          sL += l;
          sR += r;
          const e = v.echo;
          if (e !== null && !e.dead) {
            e.inL += l * v.sendEcho;
            e.inR += r * v.sendEcho;
          }
        }
      }
      for (let j = 0; j < this.echoes.length; j++) {
        const e = this.echoes[j];
        this._echoStep(e);
        sL += e.outL;
        sR += e.outR;
      }
      sL *= master;
      sR *= master;
      L[i] = Math.tanh(sL * 1.7) * 0.58;
      R[i] = Math.tanh(sR * 1.7) * 0.58;
    }
    while (this.eventHead < this.events.length && this.events[this.eventHead].time < currentTime - 1) this.eventHead++;
    this._compactEvents(24000);
    this._rtAcc += nowMs() - t0;
    this._rtN++;
    this._postStatus(false);
    return true;
  }
}

registerProcessor('retro-rave-generated-synth', RetroRaveGeneratedSynth);
