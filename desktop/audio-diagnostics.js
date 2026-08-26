'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_KEEP_FILES = 4;

function clean(value, depth = 0) {
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.slice(0, 1200);
  if (depth >= 5) return '[depth-limit]';
  if (Array.isArray(value)) return value.slice(0, 40).map(item => clean(item, depth + 1));
  if (typeof value !== 'object') return String(value).slice(0, 1200);
  const out = {};
  for (const key of Object.keys(value).slice(0, 80)) out[String(key).slice(0, 120)] = clean(value[key], depth + 1);
  return out;
}

class AudioDiagnostics {
  constructor({ directory, appVersion, maxBytes = DEFAULT_MAX_BYTES, keepFiles = DEFAULT_KEEP_FILES }) {
    this.directory = directory;
    this.file = path.join(directory, 'audio-diagnostics.jsonl');
    this.appVersion = appVersion || 'unknown';
    this.maxBytes = maxBytes;
    this.keepFiles = keepFiles;
    this.queue = Promise.resolve();
    fs.mkdirSync(directory, { recursive: true });
    try { this.bytes = fs.statSync(this.file).size; } catch (error) { this.bytes = 0; }
  }

  rotate() {
    if (this.bytes < this.maxBytes) return;
    for (let i = this.keepFiles - 1; i >= 1; i--) {
      const from = i === 1 ? this.file : this.file + '.' + (i - 1);
      const to = this.file + '.' + i;
      try { fs.renameSync(from, to); } catch (error) {
        if (error && error.code !== 'ENOENT') throw error;
      }
    }
    this.bytes = 0;
  }

  record(event, payload, meta) {
    const row = {
      at: new Date().toISOString(),
      ts: Date.now(),
      event: String(event || 'heartbeat').slice(0, 120),
      appVersion: this.appVersion,
      ...clean(meta || {}),
      data: clean(payload || {}),
    };
    const line = JSON.stringify(row) + '\n';
    this.queue = this.queue.then(async () => {
      this.rotate();
      await fs.promises.appendFile(this.file, line, 'utf8');
      this.bytes += Buffer.byteLength(line);
    }).catch(error => {
      console.error('[audio-diag] write failed:', error && error.message);
    });
    return true;
  }

  flush() { return this.queue; }
}

module.exports = { AudioDiagnostics };
