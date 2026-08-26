#!/usr/bin/env node
/*
  Derive composition studies and reusable oscillator patches from a local chip corpus.

  Reads originals without modifying them. Writes derived observations under
  chip-derived/ by default, never treating them as runtime composer input.

  Usage:
    node scripts/analyze-chip-patterns.js --input ~/Desktop/radio-content/chip-originals --platform nes,gameboy --per-platform 300
    node scripts/analyze-chip-patterns.js --platform nes --album <album-name> --limit 50
*/

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_SRC_ROOT = path.join(ROOT, "chip-originals");
const DERIVED_ROOT = path.join(ROOT, "chip-derived", "analysis");
const DEFAULT_OUTPUT = path.join(DERIVED_ROOT, "chip-patterns.json");
const DEFAULT_STUDIES = path.join(DERIVED_ROOT, "chip-composition-studies.json");
const DEFAULT_BANK = path.join(ROOT, "src", "chip-instruments.js");
const SAMPLE_RATE = 44100;
const VERSION = 1;
const DEFAULT_SECONDS = 120;

const VGM_EXTS = new Set([".vgm", ".vgz"]);
const SUPPORTED_EXTS = VGM_EXTS;

const args = parseArgs(process.argv.slice(2));

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
});

async function main() {
  if (args.help) {
    printHelp();
    return;
  }
  const sourceRoot = path.resolve(expandHome(args.input || DEFAULT_SRC_ROOT));
  if (!fs.existsSync(sourceRoot)) throw new Error(`Missing corpus directory: ${sourceRoot}`);
  const options = {
    sourceRoot,
    platforms: csvSet(args.platform),
    albumFilter: strLower(args.album),
    limit: clampInt(args.limit, 0, 1000000, 0),
    perPlatform: clampInt(args["per-platform"], 0, 1000000, 0),
    seconds: clampInt(args.seconds, 8, 300, DEFAULT_SECONDS),
    output: path.resolve(ROOT, args.output || DEFAULT_OUTPUT),
    studiesOutput: path.resolve(ROOT, args["studies-output"] || args["rules-output"] || DEFAULT_STUDIES),
    bankOutput: args["bank-output"] ? path.resolve(ROOT, args["bank-output"] === "default" ? DEFAULT_BANK : args["bank-output"]) : "",
    dryRun: !!args["dry-run"],
  };

  const jobs = collectJobs(options);
  console.log(`chip originals: ${options.sourceRoot}`);
  console.log(`tracks queued: ${jobs.length}${options.perPlatform ? ` (${options.perPlatform}/platform sampled)` : ""}`);
  console.log(`analysis window: ${options.seconds}s`);
  console.log(`output: ${rel(options.output)}`);
  console.log(`studies: ${rel(options.studiesOutput)}`);
  if (options.bankOutput) console.log(`instrument bank: ${rel(options.bankOutput)}`);
  if (options.dryRun) return;

  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.mkdirSync(path.dirname(options.studiesOutput), { recursive: true });

  const tracks = [];
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    let row;
    try {
      row = await analyzeJob(job, options);
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

  const aggregate = buildAggregate(tracks, options);
  const studies = buildStudies(aggregate);
  writeJson(options.output, aggregate);
  writeJson(options.studiesOutput, studies);
  if (options.bankOutput) writeInstrumentBank(options.bankOutput, studies);
  console.log(`done: ${aggregate.analysis.tracksOk}/${aggregate.analysis.tracksTotal} pattern rows`);
  for (const p of Object.keys(studies.platforms)) {
    const r = studies.platforms[p];
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
  --input directory          Corpus root containing platform/album/files.
  --platform nes,gameboy     Platforms to analyze. Defaults to all folders.
  --album text               Only albums whose folder contains text.
  --limit n                  Global job limit after sampling.
  --per-platform n           Deterministically sample n tracks per platform across the whole platform.
  --seconds n                Analysis window, 8..300 seconds. Default ${DEFAULT_SECONDS}.
  --output file              Full local output. Default ${rel(DEFAULT_OUTPUT)}.
  --studies-output file      Compact copyright-safe studies. Default ${rel(DEFAULT_STUDIES)}.
  --bank-output file         Emit a compact runtime synth bank; use "default" for src/chip-instruments.js.
  --dry-run                  Print queued work only.

Notes:
  The supplied NES and Game Boy corpus is VGM/VGZ: chip register writes are
  command-parsed into channel/note/interval/rhythm/form observations.
  Absolute note sequences and rendered audio are never written.
`);
}

function collectJobs(options) {
  const byPlatform = new Map();
  const platforms = fs.readdirSync(options.sourceRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((p) => !options.platforms || options.platforms.has(p))
    .sort();

  for (const platform of platforms) {
    const rows = [];
    const platformDir = path.join(options.sourceRoot, platform);
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

async function analyzeJob(job, options) {
  const bytes0 = fs.readFileSync(job.abs);
  job.source.sha256 = crypto.createHash("sha256").update(bytes0).digest("hex");
  const raw = job.ext === ".vgz" && bytes0[0] === 0x1f && bytes0[1] === 0x8b ? zlib.gunzipSync(bytes0) : bytes0;
  const base = {
    id: job.id,
    platform: job.platform,
    albumSlug: job.albumSlug,
    file: job.file,
    title: pretty(job.file),
    albumTitle: slugTitle(job.albumSlug),
    bpm: 0,
    durationSec: 0,
    source: job.source,
  };

  return { ...base, ...summarizeEvents(scanVgm(raw, options.seconds), base) };
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
      ch3: { regs: {}, wave: new Array(32).fill(8), lastMidi: -999 },
      ch4: { regs: {}, lastMidi: -999 },
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
  const ctrl = ch.regs[0];
  const sweep = ch.regs[1];
  const patch = {type:"pulse",system:"nes",duty:[0.125,0.25,0.5,0.75][duty],
    envelope:{initial:vol,rate:ctrl&15,constant:!!(ctrl&0x10),loop:!!(ctrl&0x20)},
    sweep:{period:(sweep>>4)&7,shift:sweep&7,direction:sweep&8?"down":"up",enabled:!!(sweep&0x80)}};
  return {
    channel: name, kind: "melodic", midi: round1(midi), volume: round3(vol), duty,
    instrument: patchId(patch), patch,
  };
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
  const period = ch.regs[2] || 0;
  const patch = {type:"noise",system:"nes",mode:period&0x80?7:15,period:period&15,
    envelope:{initial:vol,rate:ch.regs[0]&15,constant:!!(ch.regs[0]&0x10),loop:!!(ch.regs[0]&0x20)}};
  return vol > 0.01 ? {
    channel: "nes_noise", kind: "noise", volume: round3(vol), duty: -1,
    instrument: patchId(patch), patch,
  } : null;
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
  if (a >= 0x20 && a <= 0x2f) {
    g.ch3.wave[(a - 0x20) * 2] = (data >> 4) & 15;
    g.ch3.wave[(a - 0x20) * 2 + 1] = data & 15;
  }
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
  const envDir = env & 8 ? "up" : "down";
  const sweep = ch.regs[0] || 0;
  const patch = {type:"pulse",system:"gameboy",duty:[0.125,0.25,0.5,0.75][duty],
    envelope:{initial:vol,rate:env&7,direction:envDir},
    sweep:{period:(sweep>>4)&7,shift:sweep&7,direction:sweep&8?"down":"up"}};
  return {
    channel: name, kind: "melodic", midi: round1(midi), volume: round3(vol), duty,
    instrument: patchId(patch), patch,
  };
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
  const patch = {type:"wave",system:"gameboy",level:vol,
    table4bit:ch.wave.slice(),table:ch.wave.map((v)=>round3((v-7.5)/7.5))};
  return {
    channel: name, kind: "melodic", midi: round1(midi), volume: round3(vol), duty: -1,
    instrument: patchId(patch), patch,
  };
}

function gbWriteNoise(ch, addr, data) {
  ch.regs[addr] = data;
  if (addr !== 0x13 || !(data & 0x80)) return null;
  const env = ch.regs[0x11] || 0xf0;
  const vol = ((env >> 4) & 15) / 15;
  const poly = ch.regs[0x12] || 0;
  const patch = {type:"noise",system:"gameboy",mode:poly&8?7:15,period:poly&7,clockShift:poly>>4,
    envelope:{initial:vol,rate:env&7,direction:env&8?"up":"down"}};
  return vol > 0.01 ? {
    channel: "gb_noise", kind: "noise", volume: round3(vol), duty: -1,
    instrument: patchId(patch), patch,
  } : null;
}

function waveShapeDescriptor(wave) {
  const mean = wave.reduce((a, b) => a + b, 0) / wave.length;
  let lo = 15, hi = 0, crossings = 0, symmetry = 0;
  for (let i = 0; i < wave.length; i++) {
    lo = Math.min(lo, wave[i]); hi = Math.max(hi, wave[i]);
    if (i && (wave[i - 1] < mean) !== (wave[i] < mean)) crossings++;
    symmetry += Math.abs(wave[i] - wave[wave.length - 1 - i]);
  }
  return `range${Math.round((hi - lo) / 3)}:cross${Math.min(7, Math.round(crossings / 2))}:sym${Math.min(7, Math.round(symmetry / wave.length / 2))}`;
}

function patchId(patch) {
  if (patch.type === "wave") return `wave:${patch.system}:${waveShapeDescriptor(patch.table4bit)}:${patch.table4bit.join("")}`;
  return JSON.stringify(patch);
}

function summarizeEvents(scan, base) {
  if (!scan || !scan.ok) {
    return { ok: false, method: scan && scan.method || "", error: scan && scan.error || "no events" };
  }
  const events = scan.events.filter((e) => e && e.t >= 0).sort((a, b) => a.t - b.t);
  const durationSec = scan.durationSec || base.durationSec || (events.length ? events[events.length - 1].t : 0);
  const bpm = base.bpm || estimateEventBpm(events);
  const melodic = events.filter((e) => e.kind === "melodic" && typeof e.midi === "number");
  const noise = events.filter((e) => e.kind === "noise" || e.kind === "audio_onset");
  const channelCounts = countBy(events, (e) => e.channel || "unknown");
  const dutyHistogram = countBy(events.filter((e) => e.duty != null && e.duty >= 0), (e) => String(e.duty));
  const instrumentHistogram = countBy(events.filter((e) => e.instrument), (e) => e.instrument);
  const patchById = new Map();
  for (const e of events) if (e.instrument && e.patch) patchById.set(e.instrument, e.patch);

  const rhythm = new Map();
  const intervals = new Map();
  const masks = new Map();
  const roleMaps = new Map();
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
  const phraseBars = [];
  let motifWindows = 0;
  const motifKinds = new Set();

  for (const ev of melodic) {
    if (ev.midi < minMidi) minMidi = ev.midi;
    if (ev.midi > maxMidi) maxMidi = ev.midi;
  }

  for (const list of channelSeries.values()) {
    const seq = list.slice().sort((a, b) => a.t - b.t);
    const role = channelRole(seq);
    if (!roleMaps.has(role)) roleMaps.set(role, {rhythm:new Map(),intervals:new Map(),masks:new Map()});
    const roleMap = roleMaps.get(role);
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
    ngrams(rhythmSteps, 4).forEach((g) => {const id=g.join("-");inc(rhythm,id);inc(roleMap.rhythm,id);});
    ngrams(intSteps, 4).forEach((g) => {const id=g.join(",");inc(intervals,id);inc(roleMap.intervals,id);});
    ngrams(intSteps, 8).forEach((g) => { motifWindows++; motifKinds.add(g.join(",")); });
    for (const mask of barMasks(seq, bpm)) {inc(masks, mask);inc(roleMap.masks, mask);}
    if (bpm && seq.length) {
      let phraseStart = seq[0].t;
      const gap = Math.max(0.45, 60 / bpm * 1.5);
      for (let i = 1; i <= seq.length; i++) {
        if (i === seq.length || seq[i].t - seq[i - 1].t >= gap) {
          phraseBars.push((seq[i - 1].t - phraseStart + 60 / bpm / 2) / (60 / bpm * 4));
          if (i < seq.length) phraseStart = seq[i].t;
        }
      }
    }
  }

  return {
    ok: true,
    method: scan.method || "events",
    bpm,
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
    phraseBars: dist(phraseBars.filter((x) => x >= 0.125 && x <= 16)),
    motifRecurrenceRate: round3(motifWindows ? 1 - motifKinds.size / motifWindows : 0),
    coordination: summarizeCoordination(channelSeries),
    archetype: classifyTrack({ bpm, durationSec, melodic, events, shortIoiRate: ioiN ? shortIoi / ioiN : 0, leapRate: intervalN ? leap / intervalN : 0 }),
    topRhythmCells: topMap(rhythm, 48),
    topIntervalCells: topMap(intervals, 48),
    topBarMasks: topMap(masks, 24),
    roleModels:Object.fromEntries(Array.from(roleMaps,([role,m])=>[role,{
      rhythmCells:topMap(m.rhythm,32),intervalCells:topMap(m.intervals,32),barMasks:topMap(m.masks,16)
    }])),
    channelCounts,
    dutyHistogram,
    instrumentHistogram,
    instrumentPatches: Object.entries(instrumentHistogram).map(([id,count])=>({id,count,patch:patchById.get(id)}))
      .sort((a,b)=>b.count-a.count||a.id.localeCompare(b.id)).slice(0,48),
    texture: summarizeTexture(events, durationSec),
    sections: summarizeSections(events, durationSec),
    unknownCommands: scan.unknownCommands || 0,
  };
}

function channelRole(seq) {
  const name = seq[0] && seq[0].channel || "";
  if (name.includes("noise") || name.includes("dmc")) return "percussion";
  if (name.includes("triangle")) return "bass";
  const notes=seq.filter((e)=>Number.isFinite(e.midi)).map((e)=>e.midi).sort((a,b)=>a-b);
  const med=notes.length?notes[Math.floor(notes.length/2)]:60;
  if (med < 52) return "bass";
  if (name.includes("pulse2") || name.includes("wave")) return med < 62 ? "harmony" : "counter";
  return "lead";
}

function summarizeCoordination(channelSeries) {
  const channels = Array.from(channelSeries.values()).map((xs) => xs.map((x) => x.t).sort((a, b) => a - b));
  let pairs = 0, aligned = 0;
  for (let a = 0; a < channels.length; a++) {
    for (let b = a + 1; b < channels.length; b++) {
      let j = 0;
      for (const t of channels[a]) {
        while (j + 1 < channels[b].length && channels[b][j + 1] <= t) j++;
        const d = Math.min(Math.abs((channels[b][j] ?? Infinity) - t), Math.abs((channels[b][j + 1] ?? Infinity) - t));
        pairs++;
        if (d <= 0.025) aligned++;
      }
    }
  }
  return { alignedOnsetRate: round3(pairs ? aligned / pairs : 0) };
}

function estimateEventBpm(events) {
  if (events.length < 24) return 0;
  const binSec = 0.025;
  const end = Math.min(90, events[events.length - 1].t || 0);
  const bins = new Float64Array(Math.max(1, Math.ceil(end / binSec)));
  for (const e of events) {
    const i = Math.floor(e.t / binSec);
    if (i >= 0 && i < bins.length) bins[i] += e.kind === "noise" ? 1.25 : 1;
  }
  let best = { bpm: 0, score: -Infinity };
  for (let bpm = 70; bpm <= 190; bpm++) {
    const step = 60 / bpm / binSec;
    let score = 0;
    for (let i = 0; i < bins.length; i++) {
      if (!bins[i]) continue;
      const phase = i / step;
      const d = Math.abs(phase - Math.round(phase));
      const eighth = Math.abs(phase * 2 - Math.round(phase * 2));
      score += bins[i] * (Math.exp(-d * d * 90) + 0.45 * Math.exp(-eighth * eighth * 90));
    }
    score /= Math.max(1, events.length);
    if (score > best.score) best = { bpm, score };
  }
  return best.score > 0.16 ? best.bpm : 0;
}

function summarizeTexture(events, durationSec) {
  const slices = new Map();
  for (const e of events) {
    const i = Math.floor(e.t / 0.25);
    if (!slices.has(i)) slices.set(i, new Set());
    slices.get(i).add(e.channel);
  }
  const active = Array.from(slices.values(), (s) => s.size);
  return {
    medianActiveVoices: percentile(active, 0.5),
    p90ActiveVoices: percentile(active, 0.9),
    activityRate: round3(active.length / Math.max(1, durationSec * 4)),
  };
}

function summarizeSections(events, durationSec) {
  const windowSec = 4;
  const windows = [];
  for (let start = 0; start < durationSec; start += windowSec) {
    const row = events.filter((e) => e.t >= start && e.t < start + windowSec);
    const melodic = row.filter((e) => e.kind === "melodic");
    windows.push({
      density: round1(row.length / windowSec),
      melodicShare: round3(row.length ? melodic.length / row.length : 0),
      voices: new Set(row.map((e) => e.channel)).size,
    });
  }
  let changes = 0;
  for (let i = 1; i < windows.length; i++) {
    const a = windows[i - 1], b = windows[i];
    if (Math.abs(a.density - b.density) > Math.max(1.5, a.density * 0.35) ||
        Math.abs(a.melodicShare - b.melodicShare) > 0.25 ||
        Math.abs(a.voices - b.voices) >= 2) changes++;
  }
  return {
    windowSec,
    count: windows.length ? changes + 1 : 0,
    changeRatePerMinute: round3(changes / Math.max(1 / 60, durationSec / 60)),
    densityContour: windows.map((w) => w.density),
    voiceContour: windows.map((w) => w.voices),
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

function buildAggregate(tracks, options) {
  const ok = tracks.filter((t) => t.ok);
  const platforms = {};
  for (const p of Array.from(new Set(tracks.map((t) => t.platform))).sort()) {
    const rows = ok.filter((t) => t.platform === p);
    platforms[p] = summarizeGroup(rows);
  }
  return {
    schema: "chiptunes-composition-analysis-v2",
    corpusFingerprint: crypto.createHash("sha256")
      .update(tracks.map((t) => t.source && t.source.sha256 || "").sort().join("\n"))
      .digest("hex"),
    sourceRoot: options.sourceRoot,
    analysis: {
      version: VERSION,
      seconds: options.seconds,
      tracksTotal: tracks.length,
      tracksOk: ok.length,
      method: "NES and Game Boy VGM/VGZ chip-register parsing",
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
  const instruments = new Map();
  const patchById = new Map();
  const roleModels = new Map();
  for (const r of rows) {
    (r.topRhythmCells || []).forEach((x) => inc(rhythm, x.id, x.count));
    (r.topIntervalCells || []).forEach((x) => inc(intervals, x.id, x.count));
    (r.topBarMasks || []).forEach((x) => inc(masks, x.id, x.count));
    Object.entries(r.channelCounts || {}).forEach(([k, v]) => inc(channels, k, v));
    Object.entries(r.dutyHistogram || {}).forEach(([k, v]) => inc(duties, k, v));
    Object.entries(r.instrumentHistogram || {}).forEach(([k, v]) => inc(instruments, k, v));
    (r.instrumentPatches || []).forEach((x) => { if (x.patch) patchById.set(x.id, x.patch); });
    for (const [role,model] of Object.entries(r.roleModels||{})) {
      if(!roleModels.has(role))roleModels.set(role,{rhythm:new Map(),intervals:new Map(),masks:new Map()});
      const m=roleModels.get(role);
      (model.rhythmCells||[]).forEach((x)=>inc(m.rhythm,x.id,x.count));
      (model.intervalCells||[]).forEach((x)=>inc(m.intervals,x.id,x.count));
      (model.barMasks||[]).forEach((x)=>inc(m.masks,x.id,x.count));
    }
    inc(arch, r.archetype || "unknown");
  }
  return {
    tracks: rows.length,
    tempo: dist(rows.map((r) => r.bpm).filter(Boolean)),
    tempoCells: topMap(new Map(Object.entries(countBy(rows.filter((r)=>r.bpm),(r)=>String(Math.round(r.bpm/4)*4))).map(([k,v])=>[k,v])),40),
    durationSec: dist(rows.map((r) => r.durationSec).filter(Boolean)),
    noteDensity: dist(rows.map((r) => r.noteDensity).filter((x) => x != null)),
    onsetDensity: dist(rows.map((r) => r.onsetDensity).filter((x) => x != null)),
    firstHookBars: dist(rows.map((r) => r.firstHookBars).filter((x) => x > 0)),
    midiRange: dist(rows.map((r) => r.midiRange).filter((x) => x > 0)),
    shortIoiRate: dist(rows.map((r) => r.shortIoiRate).filter((x) => x != null)),
    stepRate: dist(rows.map((r) => r.stepRate).filter((x) => x != null)),
    leapRate: dist(rows.map((r) => r.leapRate).filter((x) => x != null)),
    activeVoices: dist(rows.map((r) => r.texture && r.texture.medianActiveVoices).filter((x) => x != null)),
    sectionChangeRate: dist(rows.map((r) => r.sections && r.sections.changeRatePerMinute).filter((x) => x != null)),
    phraseBars: mergeDists(rows.map((r) => r.phraseBars)),
    motifRecurrenceRate: dist(rows.map((r) => r.motifRecurrenceRate).filter((x) => x != null)),
    alignedOnsetRate: dist(rows.map((r) => r.coordination && r.coordination.alignedOnsetRate).filter((x) => x != null)),
    rhythmCells: topMap(rhythm, 24),
    intervalCells: topMap(intervals, 24),
    barMasks: topMap(masks, 16),
    channelCounts: Object.fromEntries(topMap(channels, 20).map((x) => [x.id, x.count])),
    dutyHistogram: Object.fromEntries(topMap(duties, 8).map((x) => [x.id, x.count])),
    instrumentRecipes: topMap(instruments, 96).map((x)=>({...x,patch:patchById.get(x.id)})),
    roleModels:Object.fromEntries(Array.from(roleModels,([role,m])=>[role,{
      rhythmCells:topMap(m.rhythm,96),intervalCells:topMap(m.intervals,96),barMasks:topMap(m.masks,48)
    }])),
    archetypes: topMap(arch, 8),
  };
}

function buildStudies(aggregate) {
  const platforms = {};
  for (const [platform, g] of Object.entries(aggregate.platforms)) {
    platforms[platform] = {
      tracks: g.tracks,
      tempo: g.tempo,
      tempoCells:g.tempoCells,
      noteDensity: g.noteDensity,
      onsetDensity: g.onsetDensity,
      firstHookBars: g.firstHookBars,
      midiRange: g.midiRange,
      articulation: {
        shortIoiRate: g.shortIoiRate,
        stepRate: g.stepRate,
        leapRate: g.leapRate,
      },
      activeVoices: g.activeVoices,
      sectionChangeRate: g.sectionChangeRate,
      phraseBars: g.phraseBars,
      motifRecurrenceRate: g.motifRecurrenceRate,
      alignedOnsetRate: g.alignedOnsetRate,
      rhythmCells: g.rhythmCells.slice(0, 64),
      intervalCells: g.intervalCells.slice(0, 64),
      barMasks: g.barMasks.slice(0, 32),
      roleModels:g.roleModels,
      channelCounts: g.channelCounts,
      dutyHistogram: g.dutyHistogram,
      instrumentRecipes: g.instrumentRecipes,
      archetypes: g.archetypes,
    };
  }

  return {
    schema: "chiptunes-composition-studies-v2",
    corpusFingerprint: aggregate.corpusFingerprint,
    source: {
      tracks: aggregate.analysis.tracksOk,
      seconds: aggregate.analysis.seconds,
      note: "NES and Game Boy VGM/VGZ are parsed directly from chip register writes.",
    },
    privacy: {
      containsAudio: false,
      containsAbsoluteNoteSequences: false,
      intendedUse: "Human-guided composer design studies; never runtime lookup or melody reproduction.",
    },
    platforms,
  };
}

function writeInstrumentBank(file, studies) {
  const rows = [];
  for (const [platform, study] of Object.entries(studies.platforms)) {
    const byType = groupBy(study.instrumentRecipes || [], (x) => x.patch && x.patch.type || "unknown");
    for (const [type, recipes] of byType) {
      const seen = new Set();
      for (const row of recipes) {
        if (!row.patch) continue;
        const family = type === "wave" ? waveShapeDescriptor(row.patch.table4bit) :
          `${row.patch.duty || ""}:${row.patch.mode || ""}:${row.patch.period || ""}:${row.patch.envelope && row.patch.envelope.rate || 0}`;
        if (seen.has(family)) continue;
        seen.add(family);
        rows.push({id:`${platform}-${type}-${seen.size}`,weight:row.count,patch:row.patch});
        if (seen.size >= (type === "wave" ? 16 : 12)) break;
      }
    }
  }
  const source = `// Generated by npm run study:chips -- --bank-output default.\n` +
    `// Relative composition grammar + oscillator patches; no absolute melodies, PCM, or DPCM samples.\n` +
    `(function(G){'use strict';G.CT_CHIP_INSTRUMENTS=${JSON.stringify({
      schema:"chiptunes-trained-chip-model-v1",corpusFingerprint:studies.corpusFingerprint,patches:rows,
      composition:Object.fromEntries(Object.entries(studies.platforms).map(([platform,s])=>[platform,{
        tracks:s.tracks,tempoCells:s.tempoCells,tempo:s.tempo,phraseBars:s.phraseBars,
        motifRecurrenceRate:s.motifRecurrenceRate,sectionChangeRate:s.sectionChangeRate,
        roleModels:s.roleModels,rhythmCells:s.rhythmCells,intervalCells:s.intervalCells,barMasks:s.barMasks
      }]))
    })};})(typeof globalThis!=='undefined'?globalThis:window);\n`;
  fs.mkdirSync(path.dirname(file), {recursive:true});
  fs.writeFileSync(file, source);
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

function percentile(xs, q) {
  if (!xs.length) return 0;
  const sorted = xs.slice().sort((a, b) => a - b);
  return round3(sorted[Math.floor((sorted.length - 1) * q)]);
}

function mergeDists(rows) {
  return dist(rows.flatMap((r) => r ? [r.min, r.p25, r.p50, r.p75, r.max] : []).filter((x) => x > 0));
}

function expandHome(p) {
  if (p === "~") return require("os").homedir();
  return String(p).replace(/^~(?=\/)/, require("os").homedir());
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
