#!/usr/bin/env node
// Retro Rave Radio pack author SDK — one CLI for game, music, and composer packs.
//
//   node scripts/pack-tools.js music build <srcDir> --id nes_mix --name "My NES Mix" [--decoder auto] [--platform "NES"] [--layout auto] [--bpm] [--out dir]
//   node scripts/pack-tools.js music convert-chip <distChipDir> --out <dir> [--only nes,amiga] [--limit N]
//   node scripts/pack-tools.js game scaffold <key> ["Name"] ["family"]
//   node scripts/pack-tools.js game build <authoringDir> [--out dir]
//   node scripts/pack-tools.js game validate <key|dir> [--strict]
//   node scripts/pack-tools.js composer scaffold <id> [--name "Name"] [--out dir]
//   node scripts/pack-tools.js composer validate <dir|file>
//   node scripts/pack-tools.js validate <packDir> [--strict]
//   node scripts/pack-tools.js zip <packDir> [--out file.zip]
//
// No npm deps. zstd comes from the system binary (brew install zstd / apt install zstd).
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');
const schema = require('./lib/pack-schema.js');
const packBuild = require('./lib/pack-build.js');
const BPM_KERNEL = require('./lib/bpm-kernel.js');

const ROOT = path.resolve(__dirname, '..');
const SAMPLE_RATE = 44100;
const ZSTD_MAGIC = 0x28b52ffd;
const VGM_EXTS = new Set(['.vgm', '.vgz']);
const GME_EXTS = new Set(['.spc']);
const TRACKER_EXTS = new Set(['.mod', '.xm', '.it', '.s3m', '.med', '.mmd0', '.mmd1', '.mmd2', '.mmd3']);
const MUSIC_EXTS = new Set([...VGM_EXTS, ...GME_EXTS, ...TRACKER_EXTS]);
const ARCHIVE_WARN_BYTES = 24 * 1024 * 1024;

// The user's shipped library layout (dist/chip) -> per-platform pack defs.
const CHIP_ALBUM_PLATS = {
  nes: { decoder: 'vgm', label: 'NES / Famicom' },
  gameboy: { decoder: 'vgm', label: 'Game Boy' },
  genesis: { decoder: 'vgm', label: 'Sega Genesis / Mega Drive' },
  snes: { decoder: 'gme', label: 'Super Nintendo' },
  turbografx: { decoder: 'vgm', label: 'TurboGrafx-16 / PC Engine' },
  neogeo: { decoder: 'vgm', label: 'Neo Geo' },
  neogeopocket: { decoder: 'vgm', label: 'Neo Geo Pocket' }
};
const CHIP_LOOSE_PLATS = {
  amiga: { decoder: 'openmpt', label: 'Amiga' },
  demoscene: { decoder: 'openmpt', label: 'Demoscene' },
  keygen: { decoder: 'openmpt', label: 'Keygen / Cracktro' }
};

let libVgmPromise = null;
let libGmePromise = null;

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0] || '--help';
  if (cmd === '--help' || cmd === '-h' || cmd === 'help') return usage(0);

  if (cmd === 'music') {
    const sub = argv[1];
    if (sub === 'build') return musicBuild(parseArgs(argv.slice(2)));
    if (sub === 'convert-chip') return musicConvertChip(parseArgs(argv.slice(2)));
    return usage(1, 'unknown music subcommand: ' + sub);
  }
  if (cmd === 'game') {
    const sub = argv[1];
    if (sub === 'scaffold') return passthrough('scaffold-game-pack.js', argv.slice(2));
    if (sub === 'build') return gameBuild(parseArgs(argv.slice(2)));
    if (sub === 'validate') return gameValidate(argv.slice(2));
    return usage(1, 'unknown game subcommand: ' + sub);
  }
  if (cmd === 'composer') {
    const sub = argv[1];
    if (sub === 'scaffold') return composerScaffold(parseArgs(argv.slice(2)));
    if (sub === 'validate') return composerValidate(parseArgs(argv.slice(2)));
    return usage(1, 'unknown composer subcommand: ' + sub);
  }
  if (cmd === 'validate') return validatePack(parseArgs(argv.slice(1)));
  if (cmd === 'zip') return zipPack(parseArgs(argv.slice(1)));
  return usage(1, 'unknown command: ' + cmd);
}

function usage(code, msg) {
  if (msg) console.error('pack-tools: ' + msg + '\n');
  console.log(`pack-tools — Retro Rave Radio pack SDK (rrr-pack@3)

  music build <srcDir> --id <id> --name <name>
      [--decoder auto|vgm|gme|openmpt] [--platform <label>] [--layout auto|album-archive|loose]
      [--bpm] [--seconds 30] [--author <a>] [--license <l>] [--out <dir>]
    Build a music pack from a folder of rips. Subfolders become .tar.zst album
    archives (vgz is gunzipped to vgm); loose tracker files become a loose pack.
    Titles/lengths come from VGM GD3 + SPC ID666 tags. --bpm renders each track
    via dist/lib/libvgm.js|libgme.js and estimates tempo (scripts/lib/bpm-kernel.js).

  music convert-chip <distChipDir> --out <dir> [--only nes,amiga] [--limit N]
    FAST repackage of the existing dist/chip library into per-platform packs
    (${Object.keys(CHIP_ALBUM_PLATS).join(' ')} + ${Object.keys(CHIP_LOOSE_PLATS).join(' ')}).
    Reuses the existing _album.tar.zst archives (hardlink/copy, no recompression),
    merges <plat>/games.json + track-db.json|track-tempo.json into tracks.json,
    and carries covers over. --limit N caps albums/files per pack (smoke tests).

  game scaffold <key> ["Name"] ["family"]     (wraps scripts/scaffold-game-pack.js)
  game build <authoringDir> [--out <dir>]     5 layers -> single-IIFE pack.js + manifest
  game validate <key|dir> [--strict]          (wraps scripts/validate-game-pack.js)

  composer scaffold <id> [--name <n>] [--out <dir>]
  composer validate <dir|file>                registration + purity check (no document/
                                              AudioContext/Math.random/window.audio)

  validate <packDir> [--strict]               manifest + per-kind structure checks
  zip <packDir> [--out <file.zip>]            store-only zip, pack.json at zip root

Prereq for music build: system 'zstd' on PATH (brew install zstd / apt install zstd).`);
  process.exitCode = code;
}

// ---------------------------------------------------------------- arg parsing

const BOOL_FLAGS = new Set(['bpm', 'strict', 'help', 'force']);

function parseArgs(list) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const eq = a.indexOf('=');
    if (eq >= 0) { out.flags[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const key = a.slice(2);
    if (BOOL_FLAGS.has(key) || i + 1 >= list.length || list[i + 1].startsWith('--')) out.flags[key] = true;
    else out.flags[key] = list[++i];
  }
  return out;
}

function die(msg) {
  console.error('pack-tools: ' + msg);
  process.exit(1);
}

// ---------------------------------------------------------------- fs helpers

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}

function writeJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
}

function linkOrCopy(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  try { fs.unlinkSync(dst); } catch (e) { /* fresh */ }
  try { fs.linkSync(src, dst); } catch (e) { fs.copyFileSync(src, dst); }
}

function naturalCompare(a, b) {
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

function clean(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

function prettyTitle(file) {
  const base = path.basename(file).replace(/\.[^.]+$/, '').replace(/_/g, ' ');
  // Strip track-number prefixes ("01 Foo", "01 - Foo", "01. Foo") but leave
  // names that merely start with a digit ("2Unlimited", "3dGalaxy") alone.
  return clean(base.replace(/^\d+\s*[-.]\s+/, '').replace(/^\d+\s+/, '')) || clean(base);
}

function coverName(plat, albumDir) {
  return (plat + '/' + albumDir).replace(/[^A-Za-z0-9]/g, '_') + '.jpg';
}

function walkFiles(dir, base) {
  base = base || dir;
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => naturalCompare(a.name, b.name))) {
    if (ent.name.startsWith('.')) continue;
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkFiles(abs, base));
    else if (ent.isFile()) out.push(path.relative(base, abs));
  }
  return out;
}

// ---------------------------------------------------------------- zstd + tar

function needZstd() {
  const r = spawnSync('zstd', ['--version'], { stdio: 'ignore' });
  if (r.error || r.status !== 0) {
    die("system 'zstd' binary not found on PATH. Install it first: `brew install zstd` (macOS) or `apt install zstd` (Linux).");
  }
}

function zstdCompressTo(buf, outFile) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const r = spawnSync('zstd', ['-q', '--ultra', '-19', '--long=24', '-f', '-o', outFile, '-'], {
    input: buf,
    maxBuffer: 1 << 30
  });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error('zstd failed (' + r.status + '): ' + String(r.stderr || ''));
}

// Minimal deterministic POSIX ustar writer (mtime 0, fixed mode) — the browser
// unpacks these with the same untar path used for the original repack archives.
function tarArchive(entries) {
  const blocks = [];
  for (const ent of entries) {
    const nameBytes = Buffer.byteLength(ent.name, 'utf8');
    if (nameBytes > 100) throw new Error('tar entry name too long (>100 bytes): ' + ent.name);
    const hdr = Buffer.alloc(512);
    hdr.write(ent.name, 0, 100, 'utf8');
    hdr.write('0000644\0', 100); // mode
    hdr.write('0000000\0', 108); // uid
    hdr.write('0000000\0', 116); // gid
    hdr.write(ent.data.length.toString(8).padStart(11, '0') + '\0', 124); // size
    hdr.write('00000000000\0', 136); // mtime 0 (deterministic)
    hdr.write('        ', 148); // chksum placeholder = spaces
    hdr.write('0', 156); // typeflag: regular file
    hdr.write('ustar\0', 257);
    hdr.write('00', 263);
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += hdr[i];
    hdr.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    blocks.push(hdr, ent.data);
    const pad = ent.data.length % 512;
    if (pad) blocks.push(Buffer.alloc(512 - pad));
  }
  blocks.push(Buffer.alloc(1024)); // end-of-archive
  return Buffer.concat(blocks);
}

// ---------------------------------------------------------------- tag parsers
// Ported from build-games-index.py / the old analyze-chip-bpm.js.

function gunzipMaybe(buf) {
  if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    try { return zlib.gunzipSync(buf); } catch (e) { return buf; }
  }
  return buf;
}

function u32(buf, off) { return off + 4 <= buf.length ? buf.readUInt32LE(off) : 0; }

function vgmMeta(b) {
  if (b.length < 0x40 || b.slice(0, 4).toString('ascii') !== 'Vgm ') return null;
  const totalSamples = u32(b, 0x18);
  const durationSec = totalSamples ? Math.round(totalSamples / 44100) : 0;
  const gd3Offset = u32(b, 0x14);
  let f = [];
  if (gd3Offset && 0x14 + gd3Offset + 12 <= b.length) {
    const p = 0x14 + gd3Offset;
    if (b.slice(p, p + 4).toString('ascii') === 'Gd3 ') {
      const len = u32(b, p + 8);
      f = b.slice(p + 12, p + 12 + len).toString('utf16le').split('\u0000').map(clean);
    }
  }
  const yearMatch = String(f[8] || '').match(/(19|20)\d\d/);
  return {
    trackTitle: f[0] || '', gameTitle: f[2] || '', system: f[4] || '', composer: f[6] || '',
    year: yearMatch ? Number(yearMatch[0]) : 0, durationSec
  };
}

function spcMeta(b) {
  if (b.length < 0x100 || b.slice(0, 27).toString('ascii') !== 'SNES-SPC700 Sound File Data') return null;
  const fld = (o, n) => clean(b.slice(o, o + n).toString('latin1').split('\u0000')[0]);
  const yearMatch = fld(0x9e, 11).match(/(19|20)\d\d/);
  const durationText = fld(0xa9, 3).replace(/\D/g, '');
  return {
    trackTitle: fld(0x2e, 32), gameTitle: fld(0x4e, 32),
    system: 'Super Nintendo Entertainment System', composer: fld(0xb1, 32),
    year: yearMatch ? Number(yearMatch[0]) : 0,
    durationSec: durationText ? Number(durationText) : 0
  };
}

function fileMeta(name, raw) {
  const ext = path.extname(name).toLowerCase();
  if (ext === '.spc') return spcMeta(raw);
  if (VGM_EXTS.has(ext)) return vgmMeta(raw);
  return null;
}

// ---------------------------------------------------------------- BPM (Node)

async function getLibVgm() {
  if (!libVgmPromise) {
    const js = path.join(ROOT, 'dist', 'lib', 'libvgm.js');
    const wasm = path.join(ROOT, 'dist', 'lib', 'libvgm.wasm');
    if (!fs.existsSync(js) || !fs.existsSync(wasm)) throw new Error('missing dist/lib/libvgm.{js,wasm} (needed for --bpm on vgm)');
    const create = require(js);
    libVgmPromise = create({ wasmBinary: fs.readFileSync(wasm), print: () => {}, printErr: () => {} });
  }
  return libVgmPromise;
}

async function getLibGme() {
  if (!libGmePromise) {
    const js = path.join(ROOT, 'dist', 'lib', 'libgme.js');
    const wasm = path.join(ROOT, 'dist', 'lib', 'libgme.wasm');
    if (!fs.existsSync(js) || !fs.existsSync(wasm)) throw new Error('missing dist/lib/libgme.{js,wasm} (needed for --bpm on spc)');
    const create = require(js);
    libGmePromise = create({ wasmBinary: fs.readFileSync(wasm), print: () => {}, printErr: () => {} });
  }
  return libGmePromise;
}

async function bpmForVgm(raw, seconds) {
  const vgm = await getLibVgm();
  let ptr = 0;
  try {
    ptr = vgm._malloc(raw.length);
    vgm.HEAPU8.set(raw, ptr);
    const err = vgm.ccall('vgm_load', 'number', ['number', 'number', 'number'], [ptr, raw.length, SAMPLE_RATE]);
    if (err) {
      // Fallback: wasm-side envelope analysis.
      const bpm = vgm.ccall('vgm_analyze_bpm', 'number', ['number', 'number', 'number', 'number'], [ptr, raw.length, SAMPLE_RATE, seconds]);
      return { bpm: BPM_KERNEL.clampTempo(bpm), conf: bpm ? 0.7 : 0 };
    }
    const frames = 1024;
    const blocks = Math.max(32, Math.floor(SAMPLE_RATE * seconds / frames));
    const mono = new Float32Array(blocks * frames);
    const bufPtr = vgm._malloc(frames * 2 * 2);
    let written = 0;
    try {
      for (let b = 0; b < blocks; b++) {
        vgm._vgm_render(bufPtr, frames);
        const base = bufPtr >> 1;
        const heap = vgm.HEAP16;
        for (let i = 0; i < frames; i++) {
          mono[written++] = (((heap[base + i * 2] || 0) + (heap[base + i * 2 + 1] || 0)) * 0.5) / 32768;
        }
        if (vgm._vgm_ended && vgm._vgm_ended()) break;
      }
    } finally {
      vgm._free(bufPtr);
      vgm._vgm_free();
    }
    return BPM_KERNEL.analyze(mono.subarray(0, written), SAMPLE_RATE);
  } finally {
    if (ptr) vgm._free(ptr);
  }
}

async function bpmForSpc(raw, seconds) {
  const gme = await getLibGme();
  let dataPtr = 0, outPtr = 0, bufPtr = 0, emu = 0;
  const frames = 1024;
  const sampleCount = frames * 2;
  const blocks = Math.max(32, Math.floor(SAMPLE_RATE * seconds / frames));
  const mono = new Float32Array(blocks * frames);
  let written = 0;
  try {
    dataPtr = gme._malloc(raw.length);
    gme.HEAPU8.set(raw, dataPtr);
    outPtr = gme._malloc(4);
    const err = gme.ccall('gme_open_data', 'number', ['number', 'number', 'number', 'number'], [dataPtr, raw.length, outPtr, SAMPLE_RATE]);
    emu = gme.getValue(outPtr, 'i32');
    if (err || !emu) throw new Error('gme_open_data failed (' + (err || 'no emulator') + ')');
    gme._gme_start_track(emu, 0);
    if (gme._gme_set_fade) gme._gme_set_fade(emu, Math.max(8000, (seconds + 4) * 1000));
    bufPtr = gme._malloc(sampleCount * 2);
    for (let b = 0; b < blocks; b++) {
      gme._gme_play(emu, sampleCount, bufPtr);
      const base = bufPtr >> 1;
      const heap = gme.HEAP16;
      for (let i = 0; i < frames; i++) {
        mono[written++] = (((heap[base + i * 2] || 0) + (heap[base + i * 2 + 1] || 0)) * 0.5) / 32768;
      }
      if (gme._gme_track_ended && gme._gme_track_ended(emu)) break;
    }
  } finally {
    if (emu) gme._gme_delete(emu);
    if (bufPtr) gme._free(bufPtr);
    if (outPtr) gme._free(outPtr);
    if (dataPtr) gme._free(dataPtr);
  }
  return BPM_KERNEL.analyze(mono.subarray(0, written), SAMPLE_RATE);
}

async function bpmForFile(name, raw, seconds) {
  const ext = path.extname(name).toLowerCase();
  try {
    if (ext === '.spc') return await bpmForSpc(raw, seconds);
    if (ext === '.vgm' || ext === '.vgz') return await bpmForVgm(gunzipMaybe(raw), seconds);
  } catch (e) {
    console.error('  bpm failed for ' + name + ': ' + e.message);
  }
  return { bpm: 0, conf: 0 }; // trackers: no Node decoder shipped
}

// ---------------------------------------------------------------- music build

function orderedTrackFiles(albumDir) {
  const all = fs.readdirSync(albumDir).filter((f) => MUSIC_EXTS.has(path.extname(f).toLowerCase()));
  const orderPath = path.join(albumDir, '_tracks.json');
  if (!fs.existsSync(orderPath)) return all.sort(naturalCompare);
  const ordered = readJSON(orderPath, null);
  if (!Array.isArray(ordered)) return all.sort(naturalCompare);
  const seen = new Set();
  const out = [];
  for (const f of ordered) {
    if (typeof f === 'string' && MUSIC_EXTS.has(path.extname(f).toLowerCase()) && fs.existsSync(path.join(albumDir, f))) {
      seen.add(f);
      out.push(f);
    }
  }
  for (const f of all.sort(naturalCompare)) if (!seen.has(f)) out.push(f);
  return out;
}

function detectDecoder(files) {
  let vgm = 0, gme = 0, trk = 0;
  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    if (VGM_EXTS.has(ext)) vgm++;
    else if (GME_EXTS.has(ext)) gme++;
    else if (TRACKER_EXTS.has(ext)) trk++;
  }
  if (trk >= vgm && trk >= gme && trk > 0) return 'openmpt';
  if (gme > vgm) return 'gme';
  return 'vgm';
}

async function musicBuild(args) {
  const srcDir = args._[0] && path.resolve(args._[0]);
  if (!srcDir || !fs.existsSync(srcDir)) return usage(1, 'music build: missing/bad <srcDir>');
  const id = args.flags.id;
  if (!id || !schema.ID_RE.test(id)) die('music build: --id required, matching ' + String(schema.ID_RE));
  const name = args.flags.name || id;
  const outDir = path.resolve(args.flags.out || path.join(ROOT, 'dist', 'packs', 'music', id));
  const wantBpm = !!args.flags.bpm;
  const seconds = Math.max(8, Math.min(45, parseInt(args.flags.seconds, 10) || 30));

  // Layout: subfolders with music files -> album-archive; loose files -> loose.
  const rootEntries = fs.readdirSync(srcDir, { withFileTypes: true }).filter((e) => !e.name.startsWith('.'));
  const albumDirs = rootEntries.filter((e) => e.isDirectory() && orderedTrackFiles(path.join(srcDir, e.name)).length)
    .map((e) => e.name).sort(naturalCompare);
  const looseFiles = rootEntries.filter((e) => e.isFile() && MUSIC_EXTS.has(path.extname(e.name).toLowerCase()))
    .map((e) => e.name).sort(naturalCompare);
  let layout = args.flags.layout && args.flags.layout !== 'auto' ? args.flags.layout
    : (albumDirs.length ? 'album-archive' : 'loose');
  if (layout !== 'album-archive' && layout !== 'loose') die('music build: bad --layout ' + layout);
  if (layout === 'album-archive' && !albumDirs.length) die('music build: no album subfolders with music files in ' + srcDir);
  if (layout === 'loose' && !looseFiles.length) die('music build: no loose music files in ' + srcDir);

  const sampleFiles = layout === 'album-archive'
    ? albumDirs.flatMap((d) => orderedTrackFiles(path.join(srcDir, d)))
    : looseFiles;
  const decoder = args.flags.decoder && args.flags.decoder !== 'auto' ? args.flags.decoder : detectDecoder(sampleFiles);
  if (schema.DECODERS.indexOf(decoder) < 0) die('music build: bad --decoder ' + decoder);

  fs.mkdirSync(outDir, { recursive: true });
  const albumsIndex = [];
  const tracksAlbums = [];

  if (layout === 'album-archive') {
    needZstd();
    for (const album of albumDirs) {
      const dir = path.join(srcDir, album);
      const files = orderedTrackFiles(dir);
      const entries = [];
      const tracks = [];
      for (const f of files) {
        let raw = fs.readFileSync(path.join(dir, f));
        let outName = f;
        if (/\.vgz$/i.test(f)) {
          raw = gunzipMaybe(raw);
          outName = f.replace(/\.vgz$/i, '.vgm');
        }
        entries.push({ name: outName, data: raw });
        const meta = fileMeta(outName, raw);
        const track = { file: outName, title: (meta && meta.trackTitle) || prettyTitle(f), len: (meta && meta.durationSec) || 0 };
        if (wantBpm) {
          const est = await bpmForFile(outName, raw, seconds);
          if (est.bpm) { track.bpm = est.bpm; track.conf = est.conf; }
        }
        track._meta = meta;
        tracks.push(track);
      }
      const tar = tarArchive(entries);
      const archive = path.join(outDir, 'albums', album, '_album.tar.zst');
      zstdCompressTo(tar, archive);
      const zBytes = fs.statSync(archive).size;
      if (zBytes > ARCHIVE_WARN_BYTES) console.error('  WARN: ' + album + ' archive is ' + (zBytes >> 20) + 'MB (>24MB hosting caps)');

      const counts = { game: new Map(), sys: new Map(), comp: new Map(), year: new Map() };
      for (const t of tracks) {
        const m = t._meta;
        if (!m) continue;
        for (const [key, val] of [['game', m.gameTitle], ['sys', m.system], ['comp', m.composer], ['year', m.year]]) {
          if (val) counts[key].set(val, (counts[key].get(val) || 0) + 1);
        }
      }
      const top = (m) => { let best = null, n = 0; for (const [k, v] of m) if (v > n) { best = k; n = v; } return best; };
      const albumRec = {
        dir: album,
        title: top(counts.game) || clean(album.replace(/_/g, ' ')),
        system: top(counts.sys) || '',
        composer: top(counts.comp) || '',
        year: top(counts.year) || 0,
        tracks: tracks.map((t) => { const c = Object.assign({}, t); delete c._meta; return c; })
      };
      const withBpm = albumRec.tracks.filter((t) => t.bpm);
      if (withBpm.length) {
        albumRec.bpm = withBpm.map((t) => t.bpm).sort((a, b) => a - b)[Math.floor(withBpm.length / 2)];
        albumRec.conf = Math.round(withBpm.reduce((s, t) => s + (t.conf || 0), 0) / withBpm.length * 1000) / 1000;
      }
      tracksAlbums.push(albumRec);
      albumsIndex.push([album, tracks.length]);
      console.log('  ' + album + ': ' + tracks.length + ' tracks -> ' + (zBytes >> 10) + 'KB');
    }
  } else {
    const tracks = [];
    for (const f of looseFiles) {
      const raw = fs.readFileSync(path.join(srcDir, f));
      fs.mkdirSync(path.join(outDir, 'files'), { recursive: true });
      fs.writeFileSync(path.join(outDir, 'files', f), raw);
      const track = { file: 'files/' + f, title: prettyTitle(f) };
      if (wantBpm) {
        const est = await bpmForFile(f, raw, seconds);
        if (est.bpm) { track.bpm = est.bpm; track.conf = est.conf; }
      }
      tracks.push(track);
    }
    tracksAlbums.push({ dir: '', title: name, tracks });
    console.log('  loose: ' + tracks.length + ' files');
  }

  const manifest = {
    schema: schema.MANIFEST_SCHEMA,
    kind: 'music',
    id,
    name,
    version: args.flags.version || '1.0.0',
    author: args.flags.author || '',
    license: args.flags.license || '',
    decoder,
    platform: args.flags.platform || name,
    layout,
    tracks: 'tracks.json'
  };
  if (layout === 'album-archive') manifest.albums = 'albums.json';
  finishMusicPack(outDir, manifest, albumsIndex, tracksAlbums);
}

function finishMusicPack(outDir, manifest, albumsIndex, tracksAlbums) {
  const tracksDoc = { schema: schema.TRACKS_SCHEMA, albums: tracksAlbums };
  const mRes = schema.validateManifest(manifest);
  if (!mRes.ok) die('generated manifest invalid (bug): ' + mRes.errors.join('; '));
  const tRes = schema.validateTracks(tracksDoc);
  if (!tRes.ok) die('generated tracks.json invalid (bug): ' + tRes.errors.join('; '));
  if (manifest.layout === 'album-archive') writeJSON(path.join(outDir, 'albums.json'), albumsIndex);
  writeJSON(path.join(outDir, 'tracks.json'), tracksDoc);
  writeJSON(path.join(outDir, 'pack.json'), manifest);
  const nTracks = tracksAlbums.reduce((s, a) => s + a.tracks.length, 0);
  console.log('pack ' + manifest.id + ': ' + tracksAlbums.length + ' album(s), ' + nTracks + ' tracks -> ' + path.relative(process.cwd(), outDir));
}

// -------------------------------------------------------- music convert-chip

function loadTempoIndex(chipDir) {
  // Prefer track-db.json (has trackNo); fall back to the slim track-tempo.json.
  const byAlbum = new Map(); // 'plat/slug' -> { bpm, conf, tracks: [{file,bpm,conf}] in track order }
  const dbFile = path.join(chipDir, 'track-db.json');
  if (fs.existsSync(dbFile)) {
    try {
      const db = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
      for (const a of db.albums || []) {
        const tracks = (a.tracks || []).slice().sort((x, y) => (x.trackNo || 0) - (y.trackNo || 0))
          .map((t) => ({ file: t.file || '', bpm: t.bpm || 0, conf: t.bpmConfidence || 0 }));
        byAlbum.set(a.platform + '/' + a.slug, { bpm: a.bpm || 0, conf: a.bpmConfidence || 0, tracks });
      }
      console.log('tempo source: track-db.json (' + byAlbum.size + ' albums)');
      return byAlbum;
    } catch (e) {
      console.error('track-db.json unreadable (' + e.message + '), trying track-tempo.json');
    }
  }
  const tempo = readJSON(path.join(chipDir, 'track-tempo.json'), null);
  if (tempo && Array.isArray(tempo.albums)) {
    for (const [plat, slug, bpm, conf] of tempo.albums) {
      byAlbum.set(plat + '/' + slug, { bpm: bpm || 0, conf: conf || 0, tracks: [] });
    }
    for (const [plat, slug, file, bpm, conf] of tempo.tracks || []) {
      const rec = byAlbum.get(plat + '/' + slug);
      if (rec) rec.tracks.push({ file: file || '', bpm: bpm || 0, conf: conf || 0 });
    }
    for (const rec of byAlbum.values()) rec.tracks.sort((a, b) => naturalCompare(a.file, b.file));
    console.log('tempo source: track-tempo.json (' + byAlbum.size + ' albums)');
  } else {
    console.log('tempo source: none (no bpm fields will be emitted)');
  }
  return byAlbum;
}

async function musicConvertChip(args) {
  const chipDir = path.resolve(args._[0] || path.join(ROOT, 'dist', 'chip'));
  if (!fs.existsSync(chipDir)) die('convert-chip: missing source dir ' + chipDir);
  const outRoot = path.resolve(args.flags.out || path.join(ROOT, 'dist', 'packs', 'music'));
  const only = args.flags.only ? new Set(String(args.flags.only).split(',').map((s) => s.trim()).filter(Boolean)) : null;
  const limit = parseInt(args.flags.limit, 10) || 0;

  const tempo = loadTempoIndex(chipDir);
  const coversDir = path.join(chipDir, 'covers');
  let packCount = 0;

  for (const [plat, def] of Object.entries(CHIP_ALBUM_PLATS)) {
    if (only && !only.has(plat)) continue;
    const srcPlat = path.join(chipDir, plat);
    const albumsFile = path.join(srcPlat, 'albums.json');
    if (!fs.existsSync(albumsFile)) { console.log(plat + ': no albums.json, skipped'); continue; }
    let albums = readJSON(albumsFile, []);
    if (!Array.isArray(albums)) die(plat + '/albums.json is not an array');
    if (limit) albums = albums.slice(0, limit);
    const games = new Map();
    for (const g of readJSON(path.join(srcPlat, 'games.json'), [])) games.set(g.s, g);

    const outDir = path.join(outRoot, plat);
    const albumsIndex = [];
    const tracksAlbums = [];
    let covers = 0;

    for (const [dir, count] of albums) {
      const archive = path.join(srcPlat, dir, '_album.tar.zst');
      if (!fs.existsSync(archive)) { console.error('  MISSING archive: ' + plat + '/' + dir); continue; }
      linkOrCopy(archive, path.join(outDir, 'albums', dir, '_album.tar.zst'));
      albumsIndex.push([dir, count]);

      const g = games.get(dir) || {};
      const t = tempo.get(plat + '/' + dir) || { bpm: 0, conf: 0, tracks: [] };
      const gTracks = Array.isArray(g.tracks) ? g.tracks : [];
      const tracks = [];
      for (let i = 0; i < count; i++) {
        const gi = gTracks[i] || {};
        const ti = t.tracks[i] || {};
        const track = { title: gi.t || 'Track ' + (i + 1), len: gi.len || 0 };
        if (ti.file) track.file = ti.file.replace(/\.vgz$/i, '.vgm');
        if (ti.bpm) { track.bpm = ti.bpm; track.conf = ti.conf || 0; }
        tracks.push(track);
      }
      const albumRec = {
        dir,
        title: g.t || clean(dir.replace(/_/g, ' ')),
        system: g.sys || '',
        composer: g.c || '',
        year: g.y || 0,
        tracks
      };
      if (t.bpm) { albumRec.bpm = t.bpm; albumRec.conf = t.conf; }
      const cover = path.join(coversDir, coverName(plat, dir));
      if (fs.existsSync(cover)) {
        linkOrCopy(cover, path.join(outDir, 'covers', path.basename(cover)));
        albumRec.cover = 'covers/' + path.basename(cover);
        covers++;
      }
      tracksAlbums.push(albumRec);
    }

    const manifest = {
      schema: schema.MANIFEST_SCHEMA,
      kind: 'music',
      id: plat,
      name: def.label,
      version: '1.0.0',
      author: 'local library',
      license: 'personal use',
      decoder: def.decoder,
      platform: def.label,
      layout: 'album-archive',
      albums: 'albums.json',
      tracks: 'tracks.json'
    };
    if (covers) manifest.covers = 'covers';
    finishMusicPack(outDir, manifest, albumsIndex, tracksAlbums);
    console.log('  covers: ' + covers);
    packCount++;
  }

  for (const [plat, def] of Object.entries(CHIP_LOOSE_PLATS)) {
    if (only && !only.has(plat)) continue;
    let srcPlat = path.join(chipDir, plat);
    let prefix = '';
    if (!fs.existsSync(srcPlat) && plat === 'keygen') {
      // keygen ships as the cracktros-keygens/ subset of the demoscene corpus
      const alt = path.join(chipDir, 'demoscene', 'files', 'cracktros-keygens');
      if (fs.existsSync(alt)) { srcPlat = path.join(chipDir, 'demoscene'); prefix = 'cracktros-keygens/'; }
    }
    if (!fs.existsSync(srcPlat)) { if (only) console.log(plat + ': no source dir, skipped'); continue; }

    // File list: manifest.json array if present, else scan (root and files/).
    let files = readJSON(path.join(srcPlat, 'manifest.json'), null);
    let base = srcPlat;
    if (fs.existsSync(path.join(srcPlat, 'files'))) base = path.join(srcPlat, 'files');
    if (!Array.isArray(files)) {
      files = walkFiles(base).filter((f) => TRACKER_EXTS.has(path.extname(f).toLowerCase()));
    } else {
      files = files.filter((f) => typeof f === 'string' && TRACKER_EXTS.has(path.extname(f).toLowerCase()));
    }
    if (prefix) files = files.filter((f) => f.startsWith(prefix));
    files.sort(naturalCompare);
    if (limit) files = files.slice(0, limit);
    if (!files.length) { console.log(plat + ': no tracker files found, skipped'); continue; }

    const outDir = path.join(outRoot, plat);
    const t = tempo.get(plat + '/' + plat) || { tracks: [] };
    const tempoByFile = new Map(t.tracks.map((x) => [x.file, x]));
    const tracks = [];
    for (const f of files) {
      const src = path.join(base, f);
      if (!fs.existsSync(src)) { console.error('  MISSING file: ' + plat + '/' + f); continue; }
      const rel = prefix ? f.slice(prefix.length) : f;
      linkOrCopy(src, path.join(outDir, 'files', rel));
      const track = { file: 'files/' + rel.split(path.sep).join('/'), title: prettyTitle(rel) };
      const ti = tempoByFile.get(path.basename(f));
      if (ti && ti.bpm) { track.bpm = ti.bpm; track.conf = ti.conf || 0; }
      tracks.push(track);
    }

    const manifest = {
      schema: schema.MANIFEST_SCHEMA,
      kind: 'music',
      id: plat,
      name: def.label,
      version: '1.0.0',
      author: 'local library',
      license: 'personal use',
      decoder: def.decoder,
      platform: def.label,
      layout: 'loose',
      tracks: 'tracks.json'
    };
    finishMusicPack(outDir, manifest, [], [{ dir: '', title: def.label, tracks }]);
    packCount++;
  }

  console.log('convert-chip: ' + packCount + ' pack(s) -> ' + path.relative(process.cwd(), outRoot));
  if (!packCount) die('convert-chip: nothing converted (check --only / source dir)');
}

// ----------------------------------------------------------------- game cmds

function passthrough(script, args) {
  const file = path.join(__dirname, script);
  if (!fs.existsSync(file)) die('missing ' + path.relative(ROOT, file));
  const r = spawnSync(process.execPath, [file, ...args], { stdio: 'inherit' });
  process.exitCode = r.status == null ? 1 : r.status;
}

function resolveGameDir(arg) {
  if (fs.existsSync(path.join(path.resolve(arg), 'pack.json'))) return path.resolve(arg);
  const inPacks = path.join(ROOT, 'packs', 'games', arg);
  if (fs.existsSync(path.join(inPacks, 'pack.json'))) return inPacks;
  return null;
}

function gameBuild(args) {
  const arg = args._[0];
  if (!arg) return usage(1, 'game build: missing <authoringDir>');
  const dir = resolveGameDir(arg);
  if (!dir) die('game build: no pack.json under ' + arg + ' (or packs/games/' + arg + ')');
  const { manifest, code } = packBuild.buildGamePack(dir);
  const outDir = path.resolve(args.flags.out || path.join(ROOT, 'dist', 'packs', 'games', manifest.id));
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'pack.js'), code);
  writeJSON(path.join(outDir, 'pack.json'), manifest);
  if (manifest.icon && fs.existsSync(path.join(dir, manifest.icon))) {
    linkOrCopy(path.join(dir, manifest.icon), path.join(outDir, manifest.icon));
  }
  console.log('game pack ' + manifest.id + ' -> ' + path.relative(process.cwd(), outDir) + ' (' + code.length + ' bytes, ' + manifest.entryHash.slice(0, 19) + '...)');
}

function gameValidate(rawArgs) {
  // Manifest check first, then the structural validator (passthrough keeps its exit code).
  const args = parseArgs(rawArgs);
  const target = args._[0];
  if (target) {
    const dir = resolveGameDir(target);
    if (dir) {
      const res = schema.validateManifest(readJSON(path.join(dir, 'pack.json'), null));
      for (const w of res.warnings) console.error('  manifest warning: ' + w);
      if (!res.ok) {
        for (const e of res.errors) console.error('  manifest error: ' + e);
        process.exitCode = 1;
        return;
      }
    }
  }
  passthrough('validate-game-pack.js', rawArgs);
}

// ------------------------------------------------------------- composer cmds

function composerScaffold(args) {
  const id = args._[0];
  if (!id || !schema.ID_RE.test(id)) die('composer scaffold: <id> required, matching ' + String(schema.ID_RE));
  const name = args.flags.name || id;
  const dir = path.resolve(args.flags.out || path.join(ROOT, 'packs', 'composers', id));
  if (fs.existsSync(path.join(dir, 'pack.json')) || fs.existsSync(path.join(dir, 'composer.js'))) {
    die('composer scaffold: refusing to overwrite ' + path.relative(ROOT, dir));
  }
  fs.mkdirSync(dir, { recursive: true });
  writeJSON(path.join(dir, 'pack.json'), {
    schema: schema.MANIFEST_SCHEMA,
    kind: 'composer',
    id,
    name,
    version: '1.0.0',
    author: '',
    license: '',
    entry: 'composer.js',
    composerV: 3
  });
  fs.writeFileSync(path.join(dir, 'composer.js'), composerTemplate(id, name));
  console.log('composer pack scaffolded -> ' + path.relative(process.cwd(), dir));
  console.log('Read docs/composer-pack-authoring.md for the Score/Fingerprint contract; study rrr_core as the reference.');
}

function composerTemplate(id, name) {
  return `// ${name} — a Retro Rave Radio composer pack (rrr-pack@3, composerV 3).
// Contract: CT_COMPOSERS['${id}'] = { V:3, compile(token)->Score, fingerprint(token)->Fingerprint }.
// PURE: same token must always yield the same Score. No DOM, no WebAudio,
// no AudioContext, no Math.random — derive every choice from seeded rng streams.
// See docs/composer-pack-authoring.md; dist/packs/composers/rrr_core/ is the reference.
(function(){
  'use strict';
  var G = typeof window !== 'undefined' ? window : globalThis;
  G.CT_COMPOSERS = G.CT_COMPOSERS || {};

  function hash32(str){
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function mulberry32(seed){
    var t = seed >>> 0;
    return function(){
      t = (t + 0x6D2B79F5) >>> 0;
      var r = Math.imul(t ^ (t >>> 15), 1 | t);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }
  // One rng stream per compile stage keeps edits to one stage from reshuffling the rest.
  function rng(token, stage){ return mulberry32(hash32('${id}:3:' + token + ':' + stage)); }

  function fingerprint(token){
    var r = rng(token, 'fp');
    return {
      bpm: Math.round(96 + r() * 84),
      keyPc: Math.floor(r() * 12),
      brightness: Math.round(r() * 100) / 100,
      waveClass: r() < 0.5 ? 'square' : 'saw',
      grooveFamily: 'four',
      density: Math.round(r() * 100) / 100,
      energyPeak: 9,
      echoDepth: Math.round(r() * 50) / 100
    };
  }

  function compile(token){
    var fp = fingerprint(token);
    // TODO: build the real Score here (palette -> groove -> harmony -> motifs ->
    // arrangement -> event stream). This stub is only enough to register cleanly.
    return {
      V: 3,
      token: token,
      bpm: fp.bpm,
      beatsPerBar: 4,
      palette: { voices: [], percs: [], echo: null },
      sections: [],
      events: []
    };
  }

  G.CT_COMPOSERS['${id}'] = { V: 3, compile: compile, fingerprint: fingerprint };
})();
`;
}

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function composerValidate(args) {
  const target = args._[0];
  if (!target) return usage(1, 'composer validate: missing <dir|file>');
  const abs = path.resolve(target);
  let entryFile = abs;
  let manifest = null;
  if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
    manifest = readJSON(path.join(abs, 'pack.json'), null);
    entryFile = path.join(abs, (manifest && manifest.entry) || 'composer.js');
  }
  const errors = [];
  const warnings = [];

  if (manifest) {
    const res = schema.validateManifest(manifest);
    errors.push(...res.errors);
    warnings.push(...res.warnings);
    if (manifest.kind !== 'composer') errors.push('kind must be "composer"');
  } else if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
    errors.push('missing pack.json');
  }

  if (!fs.existsSync(entryFile)) {
    errors.push('missing entry file ' + path.relative(process.cwd(), entryFile));
  } else {
    const src = stripComments(fs.readFileSync(entryFile, 'utf8'));
    if (!/CT_COMPOSERS\s*[\[.]/.test(src)) errors.push('entry never registers into CT_COMPOSERS');
    if (!/\bcompile\b/.test(src)) errors.push('entry has no compile()');
    if (!/\bfingerprint\b/.test(src)) errors.push('entry has no fingerprint()');
    if (!/V\s*:\s*3/.test(src)) warnings.push('no visible "V: 3" on the registered composer object');
    // Purity: composers are pure token->Score functions.
    if (/\bdocument\b/.test(src)) errors.push('purity: references document (no DOM in composers)');
    if (/\bAudioContext\b|webkitAudioContext|AudioWorklet/.test(src)) errors.push('purity: references WebAudio (composers emit Scores, not sound)');
    if (/Math\.random/.test(src)) errors.push('purity: uses Math.random (determinism is the contract — seed from the token)');
    if (/window\s*\.\s*[Aa]udio\b/.test(src)) errors.push('purity: touches the app Audio global');
    if (/\bfetch\s*\(|XMLHttpRequest|localStorage|indexedDB/.test(src)) warnings.push('references I/O (fetch/storage) — composers should be self-contained');
  }

  for (const w of warnings) console.log('  warning: ' + w);
  if (errors.length) {
    for (const e of errors) console.error('  error: ' + e);
    console.error('composer validate: FAIL (' + errors.length + ' error(s))');
    process.exitCode = 1;
  } else {
    console.log('composer validate: OK' + (warnings.length ? ' (' + warnings.length + ' warning(s))' : ''));
  }
}

// ------------------------------------------------------------------ validate

function validatePack(args) {
  const target = args._[0];
  if (!target) return usage(1, 'validate: missing <packDir>');
  const dir = path.resolve(target);
  const strict = !!args.flags.strict;
  const manifest = readJSON(path.join(dir, 'pack.json'), null);
  const errors = [];
  const warnings = [];

  if (!manifest) {
    errors.push('missing or unparsable pack.json');
  } else {
    const res = schema.validateManifest(manifest);
    errors.push(...res.errors);
    warnings.push(...res.warnings);
  }

  if (manifest && !errors.length) {
    const exists = (rel) => fs.existsSync(path.join(dir, rel));
    if (manifest.kind === 'game') {
      const hasDist = exists(manifest.entry || 'pack.js');
      const layers = packBuild.gameLayerOrder();
      const hasAuthoring = layers.every(exists);
      if (!hasDist && !hasAuthoring) {
        errors.push('neither compiled ' + (manifest.entry || 'pack.js') + ' nor the ' + layers.length + ' authoring layers (' + layers.join(', ') + ') are present');
      }
      if (manifest.icon && !exists(manifest.icon)) warnings.push('declared icon missing: ' + manifest.icon);
    } else if (manifest.kind === 'composer') {
      if (!exists(manifest.entry)) errors.push('declared entry missing: ' + manifest.entry);
    } else if (manifest.kind === 'music') {
      if (!exists(manifest.tracks)) errors.push('declared tracks missing: ' + manifest.tracks);
      else {
        const tRes = schema.validateTracks(readJSON(path.join(dir, manifest.tracks), null));
        errors.push(...tRes.errors.map((e) => manifest.tracks + ': ' + e));
      }
      if (manifest.layout === 'album-archive') {
        const albums = readJSON(path.join(dir, manifest.albums), null);
        if (!Array.isArray(albums)) errors.push(manifest.albums + ': not a [[dir,count],...] array');
        else {
          for (const a of albums) {
            if (!Array.isArray(a) || typeof a[0] !== 'string' || typeof a[1] !== 'number') {
              errors.push(manifest.albums + ': bad entry ' + JSON.stringify(a));
              break;
            }
          }
          if (albums.length) {
            const first = path.join(dir, 'albums', albums[0][0], '_album.tar.zst');
            if (!fs.existsSync(first)) errors.push('first album archive missing: albums/' + albums[0][0] + '/_album.tar.zst');
            else {
              const fd = fs.openSync(first, 'r');
              const head = Buffer.alloc(4);
              fs.readSync(fd, head, 0, 4, 0);
              fs.closeSync(fd);
              if (head.readUInt32BE(0) !== ZSTD_MAGIC) errors.push('albums/' + albums[0][0] + '/_album.tar.zst: not zstd (bad magic bytes)');
            }
          }
        }
      }
      if (manifest.covers && !exists(manifest.covers)) warnings.push('declared covers dir missing: ' + manifest.covers);
    }
  }

  for (const w of warnings) console.log('  warning: ' + w);
  const failing = errors.concat(strict ? warnings : []);
  if (failing.length) {
    for (const e of errors) console.error('  error: ' + e);
    console.error('validate: FAIL — ' + path.relative(process.cwd(), dir) + (strict && warnings.length ? ' (strict: warnings fail)' : ''));
    process.exitCode = 1;
  } else {
    console.log('validate: OK — ' + path.relative(process.cwd(), dir) + (manifest ? ' (' + manifest.kind + ' ' + manifest.id + ')' : ''));
  }
}

// ----------------------------------------------------------------------- zip

// Minimal deterministic store-only zip: pack.json lands at the zip root, which
// is what Packs.importZip expects when unpacking into OPFS /packs/<id>/.
function zipPack(args) {
  const target = args._[0];
  if (!target) return usage(1, 'zip: missing <packDir>');
  const dir = path.resolve(target);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) die('zip: not a directory: ' + dir);
  const manifest = readJSON(path.join(dir, 'pack.json'), null);
  if (!manifest) die('zip: no pack.json in ' + dir + ' (only packs get zipped)');
  const res = schema.validateManifest(manifest);
  if (!res.ok) die('zip: invalid pack.json:\n  - ' + res.errors.join('\n  - '));

  const outFile = path.resolve(args.flags.out || path.join(process.cwd(), manifest.id + '.zip'));
  const files = walkFiles(dir);
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const rel of files) {
    const data = fs.readFileSync(path.join(dir, rel));
    const name = Buffer.from(rel.split(path.sep).join('/'), 'utf8');
    const crc = zlib.crc32(data) >>> 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);          // version needed
    local.writeUInt16LE(0x0800, 6);      // flags: UTF-8 names
    local.writeUInt16LE(0, 8);           // method: store
    local.writeUInt16LE(0, 10);          // time (deterministic)
    local.writeUInt16LE(0x21, 12);       // date: 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);        // made by
    central.writeUInt16LE(20, 6);        // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);   // local header offset (extra/comment/disk/attrs all 0)
    centrals.push(central, name);
    offset += 30 + name.length + data.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  fs.writeFileSync(outFile, Buffer.concat([...locals, centralBuf, eocd]));
  const size = fs.statSync(outFile).size;
  console.log('zip: ' + files.length + ' files -> ' + path.relative(process.cwd(), outFile) + ' (' + (size >> 10) + 'KB, store-only)');
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exitCode = 1;
});
