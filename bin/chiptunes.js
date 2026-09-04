#!/usr/bin/env node
// The command line over src/api.js. Same contract as the MCP server and the
// in-page surface; this one exists so the API can be exercised, scripted and
// diffed without an agent or a browser in the loop.
'use strict';
const fs = require('fs');
const path = require('path');
const api = require('../src/api.js');

const USAGE = `chiptunes — make Game Boy songs from the command line

  compose [--mood M | --token T | --styles a,b --mode M --bpm-min N --bpm-max N]
                              [--title S] [--out FILE]
  brief --scene S [--seconds N] [--bars N] [--exclude Drums] [--key D]
                              [--mode minor] [--out FILE]
  soundtrack [--scenes a,b,c] [--key D] [--mode minor] --out DIR
  variant <doc|file> --mood sadder [--out FILE]
  transform <doc|file> --ops '[{"op":"tempo","percent":-10}]' [--out FILE]
  stems <doc|file> --out DIR
  midi <doc|file> --out FILE          format 1, one track per voice
  lsdsng <doc|file> --out FILE        one LSDj song, to drop into a .sav and keep writing
  layers <doc|file> --out DIR         base / mid / full, for adaptive audio
  variations --scene S [--n 5] --out DIR   n songs, unranked
  guide
  describe <doc|file>
  json <doc|file> [--out FILE]        document -> readable JSON
  build <json-file> [--out FILE]      readable JSON -> document
  validate <json-file>
  wav <doc|file> --out FILE
  rom <doc|file> --out FILE           a 32 KB .gb cartridge
  link <doc|file>
  capabilities

A "doc" is a song document string, or a path to a file containing one.
Everything is deterministic: the same token composes the same song forever.`;

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : dflt;
}
function readDoc(v) {
  if (!v) die('expected a document or a file path');
  if (fs.existsSync(v)) return fs.readFileSync(v, 'utf8').trim();
  return String(v).trim();
}
function die(msg) { process.stderr.write('chiptunes: ' + msg + '\n'); process.exit(1); }
function out(text) {
  const f = arg('out');
  if (f) { fs.mkdirSync(path.dirname(path.resolve(f)), { recursive: true }); fs.writeFileSync(f, text); process.stdout.write(f + '\n'); }
  else process.stdout.write(text + '\n');
}
function outBin(buf) {
  const f = arg('out');
  if (!f) die('this command writes binary; pass --out FILE');
  fs.mkdirSync(path.dirname(path.resolve(f)), { recursive: true });
  fs.writeFileSync(f, buf);
  process.stdout.write(f + ' (' + buf.length + ' bytes)\n');
}

const cmd = process.argv[2];
try {
  switch (cmd) {
    case 'compose': {
      const opts = {};
      if (arg('mood')) opts.mood = arg('mood');
      if (arg('token')) opts.token = arg('token');
      if (arg('styles')) opts.styles = arg('styles').split(',');
      if (arg('mode')) opts.mode = arg('mode');
      if (arg('bpm-min')) opts.bpmMin = +arg('bpm-min');
      if (arg('bpm-max')) opts.bpmMax = +arg('bpm-max');
      if (arg('title')) opts.title = arg('title');
      const r = api.compose(opts);
      process.stderr.write(r.title + ' — ' + r.bpm + 'bpm, ' + r.bars + ' bars' +
                           (r.token ? ', token ' + r.token : '') + '\n');
      out(r.doc);
      break;
    }
    case 'guide': out(JSON.stringify(api.guide(), null, 2)); break;
    case 'brief': {
      const spec = {};
      if (arg('scene')) spec.scene = arg('scene');
      if (arg('seconds')) spec.seconds = +arg('seconds');
      if (arg('bars')) spec.bars = +arg('bars');
      if (arg('key')) spec.key = arg('key');
      if (arg('mode')) spec.mode = arg('mode');
      if (arg('exclude')) spec.exclude = arg('exclude').split(',');
      if (arg('title')) spec.title = arg('title');
      const r = api.brief(spec);
      process.stderr.write(r.title + ' — ' + r.seconds + 's, ' + r.bars + ' bars' +
        (r.unmet.length ? '\n  not met: ' + r.unmet.join('; ') : '') + '\n');
      out(r.doc);
      break;
    }
    case 'soundtrack': {
      const dir = arg('out');
      if (!dir) die('soundtrack writes several files; pass --out DIR');
      const spec = {};
      if (arg('scenes')) spec.scenes = arg('scenes').split(',');
      if (arg('key')) spec.key = arg('key');
      if (arg('mode')) spec.mode = arg('mode');
      const s = api.soundtrack(spec);
      fs.mkdirSync(path.resolve(dir), { recursive: true });
      s.cues.forEach(c => {
        const f = path.join(dir, c.scene + '.doc');
        fs.writeFileSync(f, c.doc);
        process.stdout.write(f + '  ' + c.seconds + 's  ' + c.bars + ' bars  ' + c.title + '\n');
      });
      process.stderr.write('all in the key of ' + s.key + '\n');
      break;
    }
    case 'variant': {
      const r = api.variant(readDoc(process.argv[3]), { mood: arg('mood') });
      process.stderr.write(r.applied.join('\n') + '\n');
      out(r.doc);
      break;
    }
    case 'transform': {
      const r = api.transform(readDoc(process.argv[3]), JSON.parse(arg('ops') || '[]'));
      process.stderr.write(r.applied.join('\n') + (r.skipped.length ? '\nskipped: ' + r.skipped.join('; ') : '') + '\n');
      out(r.doc);
      break;
    }
    case 'stems': {
      const dir = arg('out');
      if (!dir) die('stems writes four files; pass --out DIR');
      fs.mkdirSync(path.resolve(dir), { recursive: true });
      api.renderStems(readDoc(process.argv[3])).forEach(s2 => {
        const f = path.join(dir, s2.lane.toLowerCase() + '.wav');
        fs.writeFileSync(f, s2.wav);
        process.stdout.write(f + ' (' + s2.wav.length + ' bytes)\n');
      });
      break;
    }
    case 'describe': out(JSON.stringify(api.describe(readDoc(process.argv[3])), null, 2)); break;
    case 'json': out(JSON.stringify(api.toJSON(readDoc(process.argv[3])), null, 2)); break;
    case 'build': {
      const obj = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
      out(api.fromJSON(obj));
      break;
    }
    case 'validate': {
      const obj = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
      const v = api.validate(obj);
      v.errors.forEach(e => process.stdout.write('error:   ' + e + '\n'));
      v.warnings.forEach(w => process.stdout.write('warning: ' + w + '\n'));
      process.stdout.write(v.ok ? 'ok\n' : 'not valid\n');
      process.exit(v.ok ? 0 : 1);
      break;
    }
    case 'midi': outBin(api.toMidi(readDoc(process.argv[3]))); break;
    case 'lsdsng': {
      var ls = api.toLsdsng(readDoc(process.argv[3]), { name: arg('name') });
      // The warnings go to stderr, not stdout, so `> song.lsdsng` still works --
      // and so a musician is told what did NOT make the trip before they open it.
      ls.warnings.forEach(function (w) { process.stderr.write('note: ' + w + '\n'); });
      process.stderr.write('note: ' + ls.phrases + ' phrases, ' + ls.chains + ' chains, tempo ' +
                           ls.tempo + ', groove [' + ls.groove + ']\n');
      outBin(ls.bytes); break;
    }
    case 'layers': {
      const dir = arg('out');
      if (!dir) die('layers writes several files; pass --out DIR');
      fs.mkdirSync(path.resolve(dir), { recursive: true });
      api.layers(readDoc(process.argv[3])).forEach(l => {
        const f = path.join(dir, l.layer + '.doc');
        fs.writeFileSync(f, l.doc);
        process.stdout.write(f + '  ' + l.notes + ' notes  ' + l.use + (l.note ? '  [' + l.note + ']' : '') + '\n');
      });
      break;
    }
    case 'variations': {
      const dir = arg('out');
      if (!dir) die('variations writes several files; pass --out DIR');
      const spec = {};
      if (arg('scene')) spec.scene = arg('scene');
      if (arg('seconds')) spec.seconds = +arg('seconds');
      const v = api.variations(spec, +(arg('n') || 5));
      fs.mkdirSync(path.resolve(dir), { recursive: true });
      v.candidates.forEach((c, i) => {
        const f = path.join(dir, String(i + 1).padStart(2, '0') + '-' + c.title.replace(/[^\w]+/g, '-').toLowerCase() + '.doc');
        fs.writeFileSync(f, c.doc);
        process.stdout.write(f + '  ' + c.seconds + 's  ' + c.title + '\n');
      });
      process.stderr.write(v.note + '\n');
      break;
    }
    case 'wav': outBin(api.renderWav(readDoc(process.argv[3]))); break;
    case 'rom': outBin(Buffer.from(api.buildCartridge(readDoc(process.argv[3])))); break;
    case 'link': out(api.shareUrl(readDoc(process.argv[3]))); break;
    case 'capabilities': out(JSON.stringify(api.capabilities(), null, 2)); break;
    case '-h': case '--help': case 'help': case undefined: process.stdout.write(USAGE + '\n'); break;
    default: die('unknown command ' + JSON.stringify(cmd) + '\n\n' + USAGE);
  }
} catch (e) {
  die(e && e.message ? e.message : String(e));
}
