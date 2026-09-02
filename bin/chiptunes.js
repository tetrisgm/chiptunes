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
