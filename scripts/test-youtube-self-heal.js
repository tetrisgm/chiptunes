#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');
const { watchFfmpegOutput } = require('../broadcast/video.js');

function fakeFfmpeg() {
  const ff = new EventEmitter();
  ff.exitCode = null;
  ff.signalCode = null;
  ff.stderr = new PassThrough();
  ff.stdio = [null, null, ff.stderr, new PassThrough()];
  return ff;
}

function harness() {
  const ff = fakeFfmpeg();
  const failures = [];
  let now = 0, check = null;
  const watch = watchFfmpegOutput(ff, reason => failures.push(reason), {
    now: () => now,
    stallMs: 60000,
    checkMs: 10000,
    wedgeWindowMs: 30000,
    wedgeHits: 3,
    echoStderr: false,
    setInterval: fn => { check = fn; return { unref() {} }; },
    clearInterval: () => {},
  });
  return { ff, failures, watch, advance(ms) { now += ms; check(); } };
}

// Advancing mux output resets the 60s clock; a live-but-frozen process trips it exactly once.
{
  const h = harness();
  h.advance(50000);
  h.ff.stdio[3].write('frame=100\nout_time_us=5000000\nprogress=continue\n');
  h.advance(60000);
  assert.deepStrictEqual(h.failures, []);
  h.advance(1);
  assert.match(h.failures[0], /encoded output stalled/);
  h.advance(60000);
  assert.strictEqual(h.failures.length, 1);
  h.watch.stop();
}

// The known EOF/FIFO incident signature trips after three nearby observations, without waiting 60s.
{
  const h = harness();
  h.ff.stderr.write('A non-NULL packet sent after an EOF\n');
  h.ff.stderr.write('Failed to send packet to filter extract_extradata\n');
  assert.deepStrictEqual(h.failures, []);
  h.ff.stderr.write('FIFO queue full\n');
  assert.match(h.failures[0], /repeated EOF\/FIFO wedge signature/);
  h.watch.stop();
}

// Guard the recovery doctrine: an ended broadcast is surfaced and privatized; no API path deletes it.
{
  const src = fs.readFileSync(require.resolve('../broadcast/youtube-live.mjs'), 'utf8');
  assert.match(src, /ended:\s*recent\.filter/);
  assert.match(src, /snap\.ended\?\.status\?\.privacyStatus !== 'private'/);
  assert.match(src, /if \(snap\.ended\) await privateVideo\(token, snap\.ended\.id\)/);
  assert.doesNotMatch(src, /['"]DELETE['"]\s*,\s*['"]\/liveBroadcasts/);
}

process.stdout.write('youtube self-heal tests: ok\n');
