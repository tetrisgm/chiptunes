#!/usr/bin/env node
// MCP server for Chiptunes — the surface an agent actually drives.
//
// Speaks JSON-RPC 2.0 over stdio, hand-rolled rather than pulled from an SDK:
// this repository has one runtime dependency and the protocol needed here is
// three methods. No network, no server, no state on disk.
//
// TWO THINGS THAT MATTER FOR AGENT ERGONOMICS, and both cost tokens if you get
// them wrong:
//
//   1. SONGS ARE HELD BY SHORT ID. A document is ~10,000 characters. Returning
//      one on every call would burn the caller's context for no reason, so the
//      server keeps them in memory and hands back "song_3". Anywhere an id is
//      accepted a raw document string or a file path also works, so nothing is
//      trapped inside a session.
//   2. READING A SONG IS PAGED BY BAR. A 900-note song is a large object.
//      song_to_json takes fromBar/toBar so an agent can work a section at a
//      time instead of pulling the whole arrangement to move one note.
'use strict';
const fs = require('fs');
const path = require('path');
const api = require('../src/api.js');

const PROTOCOL = '2024-11-05';
const songs = new Map();
let nextId = 1;

function keep(doc) { const id = 'song_' + nextId++; songs.set(id, doc); return id; }
function resolveDoc(v) {
  if (v == null || v === '') throw new Error('expected a song id, document or file path');
  const s = String(v);
  if (songs.has(s)) return songs.get(s);
  if (s.length < 512 && !s.includes('\n') && fs.existsSync(s)) return fs.readFileSync(s, 'utf8').trim();
  if (s.startsWith('song_')) throw new Error('unknown song id ' + s + '. Compose one first, or pass a document.');
  return s;
}
function writeFileArg(p, buf, what) {
  const abs = path.resolve(p);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf);
  return what + ' written to ' + abs + ' (' + buf.length + ' bytes)';
}
function summary(doc, id) {
  const d = api.describe(doc);
  return { id, title: d.title, bpm: d.bpm, bars: d.bars, seconds: d.seconds,
           notes: d.notes, perLane: d.perLane, cartridgeBytes: d.cartridgeBytes,
           fitsOnCartridge: d.fitsOnCartridge };
}

const TOOLS = [
  {
    name: 'capabilities',
    description: 'The rules a song must obey before you write one: the four lanes and which motions each can do, the drums, the grid values, the note and velocity ranges, the cartridge budget, and the mood words. Read this first.',
    inputSchema: { type: 'object', properties: {} },
    run: () => api.capabilities()
  },
  {
    name: 'compose',
    description: 'Compose a complete Game Boy song. Give a mood word, or a token for an exact reproducible song, or a premise (styles/mode/bpm range). Deterministic: the same token always yields the same song. Returns a short song id.',
    inputSchema: {
      type: 'object',
      properties: {
        mood: { type: 'string', description: 'a mood word from capabilities().moods' },
        token: { type: 'string', description: 'reproduce an exact song' },
        styles: { type: 'array', items: { type: 'string' }, description: 'constrain the style, e.g. ["dnb","techno"]' },
        mode: { type: 'string', description: 'constrain the mode, e.g. "dorian"' },
        bpmMin: { type: 'number' }, bpmMax: { type: 'number' },
        title: { type: 'string' }
      }
    },
    run: (a) => { const r = api.compose(a || {}); const id = keep(r.doc); return Object.assign({ token: r.token }, summary(r.doc, id)); }
  },
  {
    name: 'describe',
    description: 'What a song is: title, tempo, bars, duration, note counts per lane, automation, and how many bytes it costs on the cartridge. Use this instead of listening.',
    inputSchema: { type: 'object', properties: { song: { type: 'string', description: 'song id, document or file path' } }, required: ['song'] },
    run: (a) => api.describe(resolveDoc(a.song))
  },
  {
    name: 'song_to_json',
    description: 'Read a song as editable JSON: named lanes, absolute step numbers, note names. Page it with fromBar/toBar rather than pulling a long arrangement all at once.',
    inputSchema: {
      type: 'object',
      properties: {
        song: { type: 'string' },
        fromBar: { type: 'number', description: 'first bar to include (default 0)' },
        toBar: { type: 'number', description: 'last bar to include, inclusive (default: all)' }
      },
      required: ['song']
    },
    run: (a) => {
      const j = api.toJSON(resolveDoc(a.song));
      if (a.fromBar == null && a.toBar == null) return j;
      const lo = a.fromBar == null ? 0 : a.fromBar, hi = a.toBar == null ? Infinity : a.toBar;
      const notes = j.notes.filter(n => n.bar >= lo && n.bar <= hi);
      return Object.assign({}, j, { notes, window: { fromBar: lo, toBar: hi === Infinity ? j.bars - 1 : hi, of: j.notes.length } });
    }
  },
  {
    name: 'json_to_song',
    description: 'Turn editable JSON into a song. Validates first and refuses with a list of what to fix. Returns a new song id; the input song is untouched.',
    inputSchema: { type: 'object', properties: { json: { type: 'object', description: 'a song object as returned by song_to_json' } }, required: ['json'] },
    run: (a) => { const doc = api.fromJSON(a.json); const id = keep(doc); return summary(doc, id); }
  },
  {
    name: 'validate',
    description: 'Check a song object without building it. Errors say which note is wrong and what to use instead; warnings flag notes that overlap on a lane, where the chip has only one voice.',
    inputSchema: { type: 'object', properties: { json: { type: 'object' } }, required: ['json'] },
    run: (a) => api.validate(a.json)
  },
  {
    name: 'export_cartridge',
    description: 'Write the song as a 32 KB .gb cartridge that boots on real hardware or any emulator.',
    inputSchema: { type: 'object', properties: { song: { type: 'string' }, path: { type: 'string', description: 'where to write the .gb file' } }, required: ['song', 'path'] },
    run: (a) => writeFileArg(a.path, Buffer.from(api.buildCartridge(resolveDoc(a.song))), 'cartridge')
  },
  {
    name: 'export_wav',
    description: 'Render the song to a 16-bit stereo WAV, through the same chip emulation the browser uses.',
    inputSchema: { type: 'object', properties: { song: { type: 'string' }, path: { type: 'string' } }, required: ['song', 'path'] },
    run: (a) => writeFileArg(a.path, api.renderWav(resolveDoc(a.song)), 'audio')
  },
  {
    name: 'share_link',
    description: 'A URL that plays the song. The whole arrangement rides in the URL fragment, so nothing is uploaded and nothing is stored.',
    inputSchema: { type: 'object', properties: { song: { type: 'string' } }, required: ['song'] },
    run: (a) => ({ url: api.shareUrl(resolveDoc(a.song)) })
  },
  {
    name: 'song_document',
    description: 'The raw song document string, when you need to save it or hand it to something outside this session. Long (~10k characters).',
    inputSchema: { type: 'object', properties: { song: { type: 'string' } }, required: ['song'] },
    run: (a) => ({ document: resolveDoc(a.song) })
  }
];

// ------------------------------------------------------------------- transport
function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }
function reply(id, result) { if (id !== undefined && id !== null) send({ jsonrpc: '2.0', id, result }); }
function fail(id, code, message) { if (id !== undefined && id !== null) send({ jsonrpc: '2.0', id, error: { code, message } }); }

function handle(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') {
    return reply(id, {
      protocolVersion: PROTOCOL,
      capabilities: { tools: {} },
      serverInfo: { name: 'chiptunes', version: String(api.API_VERSION) }
    });
  }
  if (method === 'notifications/initialized' || method === 'initialized') return;
  if (method === 'ping') return reply(id, {});
  if (method === 'tools/list') {
    return reply(id, { tools: TOOLS.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) });
  }
  if (method === 'tools/call') {
    const tool = TOOLS.find(t => t.name === (params && params.name));
    if (!tool) return fail(id, -32602, 'unknown tool ' + (params && params.name));
    try {
      const out = tool.run((params && params.arguments) || {});
      const text = typeof out === 'string' ? out : JSON.stringify(out, null, 2);
      return reply(id, { content: [{ type: 'text', text }] });
    } catch (e) {
      // Errors come back as tool results, not protocol errors: the agent is
      // meant to read them and try again.
      return reply(id, { content: [{ type: 'text', text: 'error: ' + (e && e.message ? e.message : String(e)) }], isError: true });
    }
  }
  return fail(id, -32601, 'unknown method ' + method);
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch (e) { continue; }
    try { handle(msg); } catch (e) { fail(msg && msg.id, -32603, String(e && e.message || e)); }
  }
});
process.stdin.on('end', () => process.exit(0));
