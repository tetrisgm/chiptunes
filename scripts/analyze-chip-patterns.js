#!/usr/bin/env node
/*
  Derive composition-pattern rules from the local chip corpus.

  Reads chip-originals/ only. Writes local derived analysis under chip-derived/
  by default, never mutating originals and never treating dist/ as canonical.

  Usage:
    node scripts/analyze-chip-patterns.js --platform nes,gameboy,genesis,snes --per-platform 300 --seconds 24
    node scripts/analyze-chip-patterns.js --platform nes --album Mario --limit 50
*/

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.resolve(__dirname, "..");
const SRC_ROOT = path.join(ROOT, "chip-originals");
const DERIVED_ROOT = path.join(ROOT, "chip-derived", "analysis");
const DIST_CHIP = path.join(ROOT, "dist", "chip");
const TRACK_DB = path.join(DIST_CHIP, "track-db.json");
const DEFAULT_OUTPUT = path.join(DERIVED_ROOT, "chip-patterns.json");
const DEFAULT_RULES = path.join(DERIVED_ROOT, "chip-pattern-rules.json");
const SAMPLE_RATE = 44100;
const VERSION = 1;
const DEFAULT_SECONDS = 32;

const VGM_EXTS = new Set([".vgm", ".vgz"]);
const SPC_EXTS = new Set([".spc"]);
const SUPPORTED_EXTS = new Set([...VGM_EXTS, ...SPC_EXTS]);

const args = parseArgs(process.argv.slice(2));
let libGmePromise = null;

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
});

async function main() {
  if (args.help) {
    printHelp();
    return;
  }
  if (!fs.existsSync(SRC_ROOT)) {
    throw new Error(`Missing ${rel(SRC_ROOT)}. This must run on the local corpus machine.`);
  }

  const options = {
    platforms: csvSet(args.platform),
    albumFilter: strLower(args.album),
    limit: clampInt(args.limit, 0, 1000000, 0),
    perPlatform: clampInt(args["per-platform"], 0, 1000000, 0),
    seconds: clampInt(args.seconds, 8, 90, DEFAULT_SECONDS),
    output: path.resolve(ROOT, args.output || DEFAULT_OUTPUT),
    rulesOutput: path.resolve(ROOT, args["rules-output"] || DEFAULT_RULES),
    dryRun: !!args["dry-run"],
  };

  const trackDb = loadTrackDb();
  const jobs = collectJobs(options);
  console.log(`chip originals: ${rel(SRC_ROOT)}`);
  console.log(`tracks queued: ${jobs.length}${options.perPlatform ? ` (${options.perPlatform}/platform sampled)` : ""}`);
  console.log(`analysis window: ${options.seconds}s`);
  console.log(`output: ${rel(options.output)}`);
  console.log(`rules: ${rel(options.rulesOutput)}`);
  if (options.dryRun) return;

  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.mkdirSync(path.dirname(options.rulesOutput), { recursive: true });

  const tracks = [];
  const startMs = Date.now();
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    let row;
    try {
      const dbRow = trackDb.get(job.id) || null;
      row = await analyzeJob(job, dbRow, options);
    } catch (err) {
      row = {
        id: job.id,
        platform: job.platform,
        albumSlug: job.albumSlug,
        file: job.file,
        ok: false,
        error: err && err.message ? err.message : String(err),
      };
    }
    tracks.push(row);
    if ((i + 1) % 100 === 0 || i + 1 === jobs.length) {
      const ok = tracks.filter((t) => t.ok).length;
      console.log(`[${i + 1}/${jobs.length}] ok=${ok} last=${job.platform}/${job.albumSlug}/${job.file}`);
    }
  }

  const aggregate = buildAggregate(tracks, options, Date.now() - startMs);
  const rules = buildRules(aggregate);
  writeJson(options.output, aggregate);
  writeJson(options.rulesOutput, rules);
  console.log(`done: ${aggregate.analysis.tracksOk}/${aggregate.analysis.tracksTotal} pattern rows`);
  for (const p of Object.keys(rules.profiles)) {
    const r = rules.profiles[p];
    console.log(`${p}: tempo ${r.tempo.p50 || 0} bpm, density ${r.noteDensity.p50 || 0}/s, top rhythm ${r.rhythmCells.slice(0, 3).map((x) => x.id).join(" | ")}`);
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    const key = a.slice(2, eq >= 0 ? eq : undefined);
    if (eq >= 0) out[key] = a.slice(eq + 1);
    else if (key === "help" || key === "dry-run") out[key] = true;
    else out[key] = argv[++i];
  }
  return out;
}

function printHelp() {
  console.log(`Usage: node scripts/analyze-chip-patterns.js [options]

Options:
  --platform nes,gameboy     Platforms to analyze. Defaults to all local platforms.
  --album text               Only albums whose folder contains text.
  --limit n                  Global job limit after sampling.
  --per-platform n           Deterministically sample n tracks per platform across the whole platform.
  --seconds n                Analysis window, 8..90 seconds. Default ${DEFAULT_SECONDS}.
  --output file              Full local output. Default ${rel(DEFAULT_OUTPUT)}.
  --rules-output file        Small distilled rules output. Default ${rel(DEFAULT_RULES)}.
  --dry-run                  Print queued work only.

Notes:
  VGM/VGZ platforms are command-parsed for channel/note/interval/rhythm data.
  SPC/SNES is analyzed by rendered audio-envelope onsets, so it contributes tempo/rhythm/density but not pitch intervals.`);
}

function collectJobs(options) {
  const byPlatform = new Map();
  const platforms = fs.readdirSync(SRC_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((p) => !options.platforms || options.platforms.has(p))
    .sort();

  for (const platform of platforms) {
    const rows = [];
    const platformDir = path.join(SRC_ROOT, platform);
    const albums = fs.readdirSync(platformDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort(naturalCompare);
    for (const albumSlug of albums) {
      if (options.albumFilter && !albumSlug.toLowerCase().includes(options.albumFilter)) continue;
      const albumDir = path.join(platformDir, albumSlug);
      for (const file of orderedTrackFiles(albumDir)) {
        const ext = path.extname(file).toLowerCase();
        if (!SUPPORTED_EXTS.has(ext)) continue;
        const abs = path.join(albumDir, file);
        const st = fs.statSync(abs);
        rows.push({
          id: `${platform}/${albumSlug}/${rows.filter((r) => r.albumSlug === albumSlug).length + 1}:${file}`,
          platform,
          albumSlug,
          file,
          abs,
          ext,
          source: { size: st.size, mtimeMs: Math.round(st.mtimeMs) },
        });
      }
    }
    byPlatform.set(platform, options.perPlatform ? spreadSample(rows, options.perPlatform) : rows);
  }

  let jobs = Array.from(byPlatform.values()).flat();
  if (options.limit) jobs = jobs.slice(0, options.limit);
  return jobs;
}

function orderedTrackFiles(albumDir) {
  const all = fs.readdirSync(albumDir).filter((f) => SUPPORTED_EXTS.has(path.extname(f).toLowerCase()));
  const orderPath = path.join(albumDir, "_tracks.json");
  if (!fs.existsSync(orderPath)) return all.sort(naturalCompare);
  try {
    const ordered = JSON.parse(fs.readFileSync(orderPath, "utf8"));
    if (!Array.isArray(ordered)) return all.sort(naturalCompare);
    const seen = new Set();
    const out = [];
    for (const f of ordered) {
      if (typeof f !== "string") continue;
      if (SUPPORTED_EXTS.has(path.extname(f).toLowerCase()) && fs.existsSync(path.join(albumDir, f))) {
        seen.add(f);
        out.push(f);
      }
    }
    for (const f of all.sort(naturalCompare)) if (!seen.has(f)) out.push(f);
    return out;
  } catch {
    return all.sort(naturalCompare);
  }
}

function spreadSample(rows, n) {
  if (!n || rows.length <= n) return rows;
  const out = [];
  const used = new Set();
  for (let i = 0; i < n; i++) {
    const idx = Math.min(rows.length - 1, Math.floor(i * rows.length / n));
    if (!used.has(idx)) {
      used.add(idx);
      out.push(rows[idx]);
    }
  }
  for (let i = 0; out.length < n && i < rows.length; i++) {
    if (!used.has(i)) {
      used.add(i);
      out.push(rows[i]);
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

async function analyzeJob(job, dbRow, options) {
  const bytes0 = fs.readFileSync(job.abs);
  const raw = job.ext === ".vgz" && bytes0[0] === 0x1f && bytes0[1] === 0x8b ? zlib.gunzipSync(bytes0) : bytes0;
  const base = {
    id: job.id,
    platform: job.platform,
    albumSlug: job.albumSlug,
    file: job.file,
    title: dbRow && dbRow.title || pretty(job.file),
    albumTitle: dbRow && dbRow.albumTitle || slugTitle(job.albumSlug),
    bpm: dbRow && dbRow.bpm || 0,
    durationSec: dbRow && dbRow.durationSec || 0,
    source: job.source,
  };

  if (VGM_EXTS.has(job.ext)) {
    return { ...base, ...summarizeEvents(scanVgm(raw, options.seconds), base) };
  }
  if (SPC_EXTS.has(job.ext)) {
    return { ...base, ...summarizeEvents(await analyzeSpcEnvelope(raw, options.seconds), base) };
  }
  return { ...base, ok: false, error: `unsupported extension ${job.ext}` };
}

function scanVgm(bytes, seconds) {
  if (bytes.length < 0x40 || bytes.toString("ascii", 0, 4) !== "Vgm ") {
    return { ok: false, error: "not a VGM stream", events: [] };
  }
  const dataOff = u32(bytes, 0x34);
  let p = dataOff ? 0x34 + dataOff : 0x40;
  let eof = u32(bytes, 0x04);
  eof = eof ? Math.min(bytes.length, eof + 4) : bytes.length;
  const totalSamples = u32(bytes, 0x18);
  const maxSample = Math.min(totalSamples || Infinity, Math.floor(seconds * SAMPLE_RATE));

  const state = newChipState();
  const events = [];
  let sample = 0;
  let unknown = 0;

  const rec = (ev) => {
    if (!ev) return;
    ev.t = round3(sample / SAMPLE_RATE);
    events.push(ev);
  };

  while (p < eof && sample < maxSample) {
    const c = bytes[p++];
    if (c === 0x66) break;
    if (c === 0x61) {
      sample += u16(bytes, p); p += 2; continue;
    }
    if (c === 0x62) { sample += 735; continue; }
    if (c === 0x63) { sample += 882; continue; }
    if (c >= 0x70 && c <= 0x7f) { sample += (c & 0x0f) + 1; continue; }
    if (c >= 0x80 && c <= 0x8f) { sample += (c & 0x0f); continue; }
    if (c === 0x67) {
      if (bytes[p] === 0x66) p++;
      p++; // type
      const size = u32(bytes, p); p += 4 + size;
      continue;
    }
    if (c === 0x68) { p += 11; continue; }
    if (c === 0x50) {
      rec(handlePsg(state, bytes[p++]));
      continue;
    }
    if (c === 0xb4) {
      rec(handleNes(state, bytes[p], bytes[p + 1]));
      p += 2;
      continue;
    }
    if (c === 0xb3) {
      rec(handleGb(state, bytes[p], bytes[p + 1]));
      p += 2;
      continue;
    }
    if (c === 0x52 || c === 0x53) {
      rec(handleYm2612(state, c === 0x53 ? 1 : 0, bytes[p], bytes[p + 1]));
      p += 2;
      continue;
    }
    p += commandOperandCount(c);
    unknown++;
  }

  return {
    ok: events.length > 0,
    method: "vgm-command-stream",
    durationSec: totalSamples ? round3(totalSamples / SAMPLE_RATE) : round3(sample / SAMPLE_RATE),
    events,
    unknownCommands: unknown,
  };
}

function commandOperandCount(c) {
  if (c === 0x4f) return 1;
  if (c >= 0x51 && c <= 0x5f) return 2;
  if (c >= 0xa0 && c <= 0xbf) return 2;
  if (c >= 0xc0 && c <= 0xdf) return 3;
  if (c === 0xe0 || c === 0xe1) return 4;
  if (c === 0x90 || c === 0x91) return 4;
  if (c === 0x92) return 5;
  if (c === 0x93) return 10;
  if (c === 0x94) return 1;
  if (c === 0x95) return 4;
  if (c >= 0x30 && c <= 0x3f) return 1;
  return 0;
}

function newChipState() {
  return {
    nes: {
      p1: { base: 0x4000, regs: [0, 0, 0, 0], lastMidi: -999 },
      p2: { base: 0x4004, regs: [0, 0, 0, 0], lastMidi: -999 },
      tri: { base: 0x4008, regs: [0, 0, 0, 0], lastMidi: -999 },
      noi: { base: 0x400c, regs: [0, 0, 0, 0] },
    },
    gb: {
      ch1: { regs: {}, lastMidi: -999 },
      ch2: { regs: {}, lastMidi: -999 },
      ch3: { regs: {}, lastMidi: -999 },
      ch4: { regs: {}, lastMidi: -999 },
    },
    psg: {
      latch: { ch: 0, type: 0 },
      tone: [0, 0, 0],
      vol: [0, 0, 0, 0],
      lastMidi: [-999, -999, -999],
    },
    ym: {
      fnum: [0, 0, 0, 0, 0, 0],
      block: [0, 0, 0, 0, 0, 0],
      lastMidi: [-999, -999, -999, -999, -999, -999],
    },
  };
}

function handleNes(state, addr, data) {
  const a = addr < 0x20 ? 0x4000 + addr : addr;
  const n = state.nes;
  if (a >= 0x4000 && a <= 0x4003) return nesPulseWrite(n.p1, "nes_pulse1", a, data);
  if (a >= 0x4004 && a <= 0x4007) return nesPulseWrite(n.p2, "nes_pulse2", a, data);
  if (a >= 0x4008 && a <= 0x400b) return nesTriWrite(n.tri, "nes_triangle", a, data);
  if (a >= 0x400c && a <= 0x400f) return nesNoiseWrite(n.noi, a, data);
  if (a >= 0x4010 && a <= 0x4013) return { channel: "nes_dmc", kind: "noise", volume: 0.5 };
  return null;
}

function nesPulseWrite(ch, name, addr, data) {
  ch.regs[addr - ch.base] = data;
  if ((addr - ch.base) !== 3) return null;
  const timer = ch.regs[2] | ((ch.regs[3] & 7) << 8);
  if (timer <= 7) return null;
  const freq = 1789773 / (16 * (timer + 1));
  const midi = hzToMidi(freq);
  const vol = (ch.regs[0] & 15) / 15;
  const duty = (ch.regs[0] >> 6) & 3;
  if (!Number.isFinite(midi) || midi < 12 || midi > 108 || vol <= 0.01) return null;
  ch.lastMidi = midi;
  return { channel: name, kind: "melodic", midi: round1(midi), volume: round3(vol), duty };
}

function nesTriWrite(ch, name, addr, data) {
  ch.regs[addr - ch.base] = data;
  if ((addr - ch.base) !== 3) return null;
  const timer = ch.regs[2] | ((ch.regs[3] & 7) << 8);
  if (timer <= 7) return null;
  const freq = 1789773 / (32 * (timer + 1));
  const midi = hzToMidi(freq);
  if (!Number.isFinite(midi) || midi < 12 || midi > 108) return null;
  ch.lastMidi = midi;
  return { channel: name, kind: "melodic", midi: round1(midi), volume: 0.7, duty: -1 };
}

function nesNoiseWrite(ch, addr, data) {
  ch.regs[addr - ch.base] = data;
  if ((addr - ch.base) !== 3) return null;
  const vol = (ch.regs[0] & 15) / 15;
  return vol > 0.01 ? { channel: "nes_noise", kind: "noise", volume: round3(vol), duty: -1 } : null;
}

function handleGb(state, addr, data) {
  const a = addr & 0xff;
  const g = state.gb;
  // VGM stores DMG writes as offsets from FF10:
  // 00..04 pulse 1, 06..09 pulse 2, 0a..0e wave, 10..13 noise,
  // 14..16 master/mix control, 20..2f wave RAM.
  if (a >= 0x00 && a <= 0x04) return gbWritePulse(g.ch1, "gb_pulse1", a, data, 0x00);
  if (a >= 0x06 && a <= 0x09) return gbWritePulse(g.ch2, "gb_pulse2", a, data, 0x05);
  if (a >= 0x0a && a <= 0x0e) return gbWriteWave(g.ch3, "gb_wave", a, data);
  if (a >= 0x10 && a <= 0x13) return gbWriteNoise(g.ch4, a, data);
  return null;
}

function gbWritePulse(ch, name, addr, data, base) {
  ch.regs[addr] = data;
  const hiAddr = base + 4;
  if (addr !== hiAddr || !(data & 0x80)) return null;
  const lo = ch.regs[base + 3] || 0;
  const hi = data & 7;
  const x = lo | (hi << 8);
  const freq = 131072 / Math.max(1, 2048 - x);
  const midi = hzToMidi(freq);
  const env = ch.regs[base + 2] || 0xf0;
  const vol = ((env >> 4) & 15) / 15;
  const duty = ((ch.regs[base + 1] || 0) >> 6) & 3;
  if (!Number.isFinite(midi) || midi < 12 || midi > 108 || vol <= 0.01) return null;
  return { channel: name, kind: "melodic", midi: round1(midi), volume: round3(vol), duty };
}

function gbWriteWave(ch, name, addr, data) {
  ch.regs[addr] = data;
  if (addr !== 0x0e || !(data & 0x80)) return null;
  const x = (ch.regs[0x0d] || 0) | ((data & 7) << 8);
  const freq = 65536 / Math.max(1, 2048 - x);
  const midi = hzToMidi(freq);
  const lvl = ((ch.regs[0x0c] || 0x20) >> 5) & 3;
  const vol = lvl === 0 ? 0 : [0, 1, 0.5, 0.25][lvl];
  if (!Number.isFinite(midi) || midi < 12 || midi > 108 || vol <= 0.01) return null;
  return { channel: name, kind: "melodic", midi: round1(midi), volume: round3(vol), duty: -1 };
}

function gbWriteNoise(ch, addr, data) {
  ch.regs[addr] = data;
  if (addr !== 0x13 || !(data & 0x80)) return null;
  const env = ch.regs[0x11] || 0xf0;
  const vol = ((env >> 4) & 15) / 15;
  return vol > 0.01 ? { channel: "gb_noise", kind: "noise", volume: round3(vol), duty: -1 } : null;
}

function handlePsg(state, data) {
  const p = state.psg;
  let ch = p.latch.ch;
  let type = p.latch.type;
  if (data & 0x80) {
    ch = (data >> 5) & 3;
    type = (data >> 4) & 1;
    p.latch = { ch, type };
    if (type) {
      p.vol[ch] = 15 - (data & 15);
      return null;
    }
    if (ch < 3) p.tone[ch] = (p.tone[ch] & 0x3f0) | (data & 15);
  } else if (!type && ch < 3) {
    p.tone[ch] = (p.tone[ch] & 15) | ((data & 0x3f) << 4);
  } else {
    return null;
  }
  if (ch >= 3 || p.vol[ch] <= 0) return null;
  const tone = p.tone[ch] || 1;
  const freq = 3579545 / (32 * tone);
  const midi = hzToMidi(freq);
  if (!Number.isFinite(midi) || midi < 12 || midi > 108) return null;
  return { channel: `psg_tone${ch + 1}`, kind: "melodic", midi: round1(midi), volume: round3(p.vol[ch] / 15), duty: 2 };
}

function handleYm2612(state, port, addr, data) {
  const ym = state.ym;
  const chBase = port ? 3 : 0;
  if (addr >= 0xa0 && addr <= 0xa2) {
    const ch = chBase + (addr - 0xa0);
    ym.fnum[ch] = (ym.fnum[ch] & 0x700) | data;
    return null;
  }
  if (addr >= 0xa4 && addr <= 0xa6) {
    const ch = chBase + (addr - 0xa4);
    ym.fnum[ch] = (ym.fnum[ch] & 0xff) | ((data & 7) << 8);
    ym.block[ch] = (data >> 3) & 7;
    return null;
  }
  if (port === 0 && addr === 0x28) {
    let ch = data & 3;
    if (ch === 3) return null;
    if (data & 4) ch += 3;
    const slots = (data >> 4) & 15;
    if (!slots) return null;
    const fnum = ym.fnum[ch] || 512;
    const block = ym.block[ch] || 4;
    const midi = 36 + block * 12 + 12 * Math.log2(Math.max(1, fnum) / 512);
    return { channel: `ym2612_ch${ch + 1}`, kind: "melodic", midi: round1(midi), volume: 0.75, duty: 4 };
  }
  return null;
}

async function analyzeSpcEnvelope(bytes, seconds) {
  const gme = await getLibGme();
  let dataPtr = 0;
  let outPtr = 0;
  let bufPtr = 0;
  let emu = 0;
  const frames = 512;
  const sampleCount = frames * 2;
  const blocks = Math.max(32, Math.floor(SAMPLE_RATE * seconds / frames));
  const env = [];

  try {
    dataPtr = gme._malloc(bytes.length);
    gme.HEAPU8.set(bytes, dataPtr);
    outPtr = gme._malloc(4);
    const err = gme.ccall("gme_open_data", "number", ["number", "number", "number", "number"], [dataPtr, bytes.length, outPtr, SAMPLE_RATE]);
    emu = gme.getValue(outPtr, "i32");
    if (err || !emu) throw new Error(`gme_open_data failed (${err || "no emulator"})`);
    gme._gme_start_track(emu, 0);
    if (gme._gme_set_fade) gme._gme_set_fade(emu, Math.max(8000, (seconds + 4) * 1000));
    bufPtr = gme._malloc(sampleCount * 2);
    for (let b = 0; b < blocks; b++) {
      gme._gme_play(emu, sampleCount, bufPtr);
      const heap = gme.HEAP16;
      const base = bufPtr >> 1;
      let sum = 0;
      let peak = 0;
      for (let i = 0; i < frames; i++) {
        const mono = ((heap[base + i * 2] || 0) + (heap[base + i * 2 + 1] || 0)) * 0.5 / 32768;
        const av = Math.abs(mono);
        sum += mono * mono;
        if (av > peak) peak = av;
      }
      env.push(Math.sqrt(sum / frames) * 0.72 + peak * 0.28);
      if (gme._gme_track_ended && gme._gme_track_ended(emu)) break;
    }
  } finally {
    if (emu) gme._gme_delete(emu);
    if (bufPtr) gme._free(bufPtr);
    if (outPtr) gme._free(outPtr);
    if (dataPtr) gme._free(dataPtr);
  }

  const dt = frames / SAMPLE_RATE;
  const onsets = detectEnvelopeOnsets(env, dt).map((t) => ({
    t: round3(t),
    channel: "snes_mix",
    kind: "audio_onset",
    volume: 0.7,
  }));
  return {
    ok: onsets.length > 0,
    method: "spc-audio-envelope",
    durationSec: round3(env.length * dt),
    events: onsets,
  };
}

function detectEnvelopeOnsets(env, dt) {
  if (!env.length) return [];
  const out = [];
  let slow = env[0] || 0;
  let fast = env[0] || 0;
  let cooldown = 0;
  for (let i = 1; i < env.length; i++) {
    const v = env[i] || 0;
    slow = slow * 0.96 + v * 0.04;
    fast = fast * 0.55 + v * 0.45;
    const diff = fast - slow;
    cooldown = Math.max(0, cooldown - dt);
    if (cooldown <= 0 && diff > Math.max(0.012, slow * 0.55) && v > 0.006) {
      out.push(i * dt);
      cooldown = 0.055;
    }
  }
  return out;
}

async function getLibGme() {
  if (!libGmePromise) {
    const createLibGme = require(path.join(ROOT, "dist", "lib", "libgme.js"));
    const wasmBinary = fs.readFileSync(path.join(ROOT, "dist", "lib", "libgme.wasm"));
    libGmePromise = createLibGme({ wasmBinary, print: () => {}, printErr: () => {} });
  }
  return libGmePromise;
}

function summarizeEvents(scan, base) {
  if (!scan || !scan.ok) {
    return { ok: false, method: scan && scan.method || "", error: scan && scan.error || "no events" };
  }
  const events = scan.events.filter((e) => e && e.t >= 0).sort((a, b) => a.t - b.t);
  const durationSec = scan.durationSec || base.durationSec || (events.length ? events[events.length - 1].t : 0);
  const bpm = base.bpm || 0;
  const melodic = events.filter((e) => e.kind === "melodic" && typeof e.midi === "number");
  const noise = events.filter((e) => e.kind === "noise" || e.kind === "audio_onset");
  const channelCounts = countBy(events, (e) => e.channel || "unknown");
  const dutyHistogram = countBy(events.filter((e) => e.duty != null && e.duty >= 0), (e) => String(e.duty));

  const rhythm = new Map();
  const intervals = new Map();
  const masks = new Map();
  const channelSeries = groupBy(events, (e) => e.channel || "mix");
  let ioiN = 0;
  let ioiMsSum = 0;
  let shortIoi = 0;
  let repeat = 0;
  let step = 0;
  let leap = 0;
  let intervalN = 0;
  let minMidi = Infinity;
  let maxMidi = -Infinity;

  for (const ev of melodic) {
    if (ev.midi < minMidi) minMidi = ev.midi;
    if (ev.midi > maxMidi) maxMidi = ev.midi;
  }

  for (const list of channelSeries.values()) {
    const seq = list.slice().sort((a, b) => a.t - b.t);
    const rhythmSteps = [];
    const intSteps = [];
    for (let i = 1; i < seq.length; i++) {
      const prev = seq[i - 1];
      const cur = seq[i];
      const ioi = cur.t - prev.t;
      if (ioi <= 0 || ioi > 4) continue;
      const q = quantizeIoi(ioi, bpm);
      rhythmSteps.push(q);
      ioiN++;
      ioiMsSum += ioi * 1000;
      if (ioi < 0.12) shortIoi++;
      if (typeof prev.midi === "number" && typeof cur.midi === "number") {
        const d = clampInt(Math.round(cur.midi - prev.midi), -24, 24, 0);
        intSteps.push(d);
        intervalN++;
        if (Math.abs(d) < 0.5) repeat++;
        else if (Math.abs(d) <= 2.5) step++;
        else if (Math.abs(d) >= 7) leap++;
      }
    }
    ngrams(rhythmSteps, 4).forEach((g) => inc(rhythm, g.join("-")));
    ngrams(intSteps, 4).forEach((g) => inc(intervals, g.join(",")));
    for (const mask of barMasks(seq, bpm)) inc(masks, mask);
  }

  return {
    ok: true,
    method: scan.method || "events",
    durationSec: round3(durationSec),
    eventCount: events.length,
    melodicCount: melodic.length,
    noiseCount: noise.length,
    noteDensity: round3(melodic.length / Math.max(1, durationSec || 1)),
    onsetDensity: round3(events.length / Math.max(1, durationSec || 1)),
    firstOnsetSec: round3(events.length ? events[0].t : 0),
    firstHookBars: bpm ? round3((events.length ? events[0].t : 0) / (60 / bpm * 4)) : 0,
    midiRange: Number.isFinite(minMidi) ? round1(maxMidi - minMidi) : 0,
    medianIoiMs: round1(ioiN ? ioiMsSum / ioiN : 0),
    shortIoiRate: round3(ioiN ? shortIoi / ioiN : 0),
    repeatRate: round3(intervalN ? repeat / intervalN : 0),
    stepRate: round3(intervalN ? step / intervalN : 0),
    leapRate: round3(intervalN ? leap / intervalN : 0),
    archetype: classifyTrack({ bpm, durationSec, melodic, events, shortIoiRate: ioiN ? shortIoi / ioiN : 0, leapRate: intervalN ? leap / intervalN : 0 }),
    topRhythmCells: topMap(rhythm, 12),
    topIntervalCells: topMap(intervals, 12),
    topBarMasks: topMap(masks, 8),
    channelCounts,
    dutyHistogram,
    unknownCommands: scan.unknownCommands || 0,
  };
}

function classifyTrack(s) {
  const density = s.melodic.length / Math.max(1, s.durationSec || 1);
  if ((s.durationSec && s.durationSec < 18) || s.events.length < 32) return "jingle";
  if (s.bpm >= 155 && density >= 5) return "action_drive";
  if (s.shortIoiRate > 0.42 && density >= 4) return "arpeggio_engine";
  if (s.leapRate > 0.22 && density >= 2.5) return "boss_or_fanfare";
  if (density < 1.2) return "sparse_atmosphere";
  if (density >= 3.2) return "melodic_stage";
  return "balanced_theme";
}

function quantizeIoi(ioiSec, bpm) {
  if (bpm) return Math.max(1, Math.min(16, Math.round(ioiSec / (60 / bpm / 4))));
  return Math.max(1, Math.min(16, Math.round(ioiSec / 0.125)));
}

function barMasks(seq, bpm) {
  if (!bpm) return [];
  const stepSec = 60 / bpm / 4;
  const byBar = new Map();
  for (const e of seq) {
    const q = Math.max(0, Math.round(e.t / stepSec));
    const bar = Math.floor(q / 16);
    const bit = q % 16;
    byBar.set(bar, (byBar.get(bar) || 0) | (1 << bit));
  }
  const out = [];
  for (const mask of byBar.values()) {
    const bits = countBits(mask);
    if (bits >= 2 && bits <= 10) out.push(mask.toString(16).padStart(4, "0"));
  }
  return out;
}

function buildAggregate(tracks, options, elapsedMs) {
  const ok = tracks.filter((t) => t.ok);
  const platforms = {};
  for (const p of Array.from(new Set(tracks.map((t) => t.platform))).sort()) {
    const rows = ok.filter((t) => t.platform === p);
    platforms[p] = summarizeGroup(rows);
  }
  return {
    schema: "retro-rave-chip-pattern-analysis-v1",
    generatedAt: new Date().toISOString(),
    sourceRoot: rel(SRC_ROOT),
    analysis: {
      version: VERSION,
      seconds: options.seconds,
      tracksTotal: tracks.length,
      tracksOk: ok.length,
      elapsedMs,
      commandLevelPlatforms: "VGM/VGZ",
      audioEnvelopePlatforms: "SPC/SNES",
    },
    platforms,
    tracks,
  };
}

function summarizeGroup(rows) {
  const rhythm = new Map();
  const intervals = new Map();
  const masks = new Map();
  const channels = new Map();
  const duties = new Map();
  const arch = new Map();
  for (const r of rows) {
    (r.topRhythmCells || []).forEach((x) => inc(rhythm, x.id, x.count));
    (r.topIntervalCells || []).forEach((x) => inc(intervals, x.id, x.count));
    (r.topBarMasks || []).forEach((x) => inc(masks, x.id, x.count));
    Object.entries(r.channelCounts || {}).forEach(([k, v]) => inc(channels, k, v));
    Object.entries(r.dutyHistogram || {}).forEach(([k, v]) => inc(duties, k, v));
    inc(arch, r.archetype || "unknown");
  }
  return {
    tracks: rows.length,
    tempo: dist(rows.map((r) => r.bpm).filter(Boolean)),
    durationSec: dist(rows.map((r) => r.durationSec).filter(Boolean)),
    noteDensity: dist(rows.map((r) => r.noteDensity).filter((x) => x != null)),
    onsetDensity: dist(rows.map((r) => r.onsetDensity).filter((x) => x != null)),
    firstHookBars: dist(rows.map((r) => r.firstHookBars).filter((x) => x > 0)),
    midiRange: dist(rows.map((r) => r.midiRange).filter((x) => x > 0)),
    shortIoiRate: dist(rows.map((r) => r.shortIoiRate).filter((x) => x != null)),
    stepRate: dist(rows.map((r) => r.stepRate).filter((x) => x != null)),
    leapRate: dist(rows.map((r) => r.leapRate).filter((x) => x != null)),
    rhythmCells: topMap(rhythm, 24),
    intervalCells: topMap(intervals, 24),
    barMasks: topMap(masks, 16),
    channelCounts: Object.fromEntries(topMap(channels, 20).map((x) => [x.id, x.count])),
    dutyHistogram: Object.fromEntries(topMap(duties, 8).map((x) => [x.id, x.count])),
    archetypes: topMap(arch, 8),
  };
}

function buildRules(aggregate) {
  const profiles = {};
  for (const [platform, g] of Object.entries(aggregate.platforms)) {
    profiles[platform] = {
      tracks: g.tracks,
      tempo: g.tempo,
      noteDensity: g.noteDensity,
      onsetDensity: g.onsetDensity,
      firstHookBars: g.firstHookBars,
      midiRange: g.midiRange,
      articulation: {
        shortIoiRate: g.shortIoiRate,
        stepRate: g.stepRate,
        leapRate: g.leapRate,
      },
      rhythmCells: g.rhythmCells.slice(0, 12),
      intervalCells: g.intervalCells.slice(0, 12),
      barMasks: g.barMasks.slice(0, 8),
      channelCounts: g.channelCounts,
      dutyHistogram: g.dutyHistogram,
      archetypes: g.archetypes,
    };
  }

  return {
    schema: "retro-rave-chip-pattern-rules-v1",
    generatedAt: aggregate.generatedAt,
    source: {
      tracks: aggregate.analysis.tracksOk,
      seconds: aggregate.analysis.seconds,
      note: "VGM/VGZ are parsed from chip register writes; SPC/SNES contributes rendered-envelope rhythm/density.",
    },
    profiles,
    composerGuidance: [
      "Start quickly: most game tracks expose a hook or clear rhythmic event in the first 0-2 bars; avoid long one-note intros.",
      "Separate hardware roles: pulse/PSG/FM lead carries short motif cells; triangle/sub bass anchors roots/fifths; noise/envelope onsets define action.",
      "Use short reusable cells, not endless melodies: pick 1-bar and 2-bar rhythm masks from the corpus, then answer/invert/develop them.",
      "Keep density section-aware: sparse cues can breathe, but stage/action cues sustain 2-6 melodic/onset events per second.",
      "Prefer stepwise motion with occasional leaps: leaps should mark fanfares, boss cues, or section boundaries rather than every note.",
      "Let the platform color the arrangement: NES/Game Boy should privilege pulse/triangle/wave/noise interplay; Genesis can lean on FM+PSG drive; SNES can contribute richer mixed-onset rhythms without implying chip-channel separation.",
    ],
  };
}

function loadTrackDb() {
  const map = new Map();
  if (!fs.existsSync(TRACK_DB)) return map;
  try {
    const db = JSON.parse(fs.readFileSync(TRACK_DB, "utf8"));
    for (const t of db.tracks || []) map.set(t.id, t);
  } catch (err) {
    console.warn(`warning: could not read ${rel(TRACK_DB)}: ${err.message}`);
  }
  return map;
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function groupBy(rows, fn) {
  const m = new Map();
  for (const r of rows) {
    const k = fn(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

function countBy(rows, fn) {
  const out = {};
  for (const r of rows) {
    const k = fn(r);
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

function inc(map, key, n = 1) {
  if (key == null || key === "") return;
  map.set(key, (map.get(key) || 0) + n);
}

function topMap(map, n) {
  return Array.from(map.entries())
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count || String(a.id).localeCompare(String(b.id)))
    .slice(0, n);
}

function ngrams(arr, n) {
  const out = [];
  if (!arr || arr.length < n) return out;
  for (let i = 0; i <= arr.length - n; i++) out.push(arr.slice(i, i + n));
  return out;
}

function dist(xs) {
  xs = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!xs.length) return { p25: 0, p50: 0, p75: 0, min: 0, max: 0 };
  return {
    min: round3(xs[0]),
    p25: round3(xs[Math.floor((xs.length - 1) * 0.25)]),
    p50: round3(xs[Math.floor((xs.length - 1) * 0.50)]),
    p75: round3(xs[Math.floor((xs.length - 1) * 0.75)]),
    max: round3(xs[xs.length - 1]),
  };
}

function countBits(n) {
  let c = 0;
  while (n) { n &= n - 1; c++; }
  return c;
}

function hzToMidi(hz) {
  return 69 + 12 * Math.log2(hz / 440);
}

function u16(b, p) {
  return (b[p] || 0) | ((b[p + 1] || 0) << 8);
}

function u32(b, p) {
  return ((b[p] || 0) | ((b[p + 1] || 0) << 8) | ((b[p + 2] || 0) << 16) | ((b[p + 3] || 0) << 24)) >>> 0;
}

function clampInt(v, lo, hi, fallback) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

function csvSet(v) {
  if (!v) return null;
  const parts = String(v).split(",").map((s) => s.trim()).filter(Boolean);
  return parts.length ? new Set(parts) : null;
}

function strLower(v) {
  return v ? String(v).toLowerCase() : "";
}

function pretty(file) {
  return path.basename(file, path.extname(file)).replace(/^\d+\s*/, "").replace(/[_-]+/g, " ").trim();
}

function slugTitle(slug) {
  return String(slug || "").replace(/__.+$/, "").replace(/[_-]+/g, " ").trim();
}

function naturalCompare(a, b) {
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

function rel(p) {
  return path.relative(ROOT, p) || ".";
}

function round1(x) {
  return Math.round((x || 0) * 10) / 10;
}

function round3(x) {
  return Math.round((x || 0) * 1000) / 1000;
}
