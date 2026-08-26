#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

let Processor = null;
class FakeAudioWorkletProcessor {
  constructor() {
    this.port = {
      onmessage: null,
      messages: [],
      postMessage: (message) => this.port.messages.push(message)
    };
  }
}

const context = {
  AudioWorkletProcessor: FakeAudioWorkletProcessor,
  currentTime: 0,
  sampleRate: 48000,
  registerProcessor(name, processor) {
    assert.equal(name, 'retro-rave-generated-synth');
    Processor = processor;
  }
};
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'generated-synth-worklet.js'), 'utf8');
vm.runInNewContext(source, context, { filename: 'generated-synth-worklet.js' });
assert.ok(Processor, 'worklet registered its processor');

function send(processor, message) {
  processor.port.onmessage({ data: message });
}

function palette(generation, osc, activateAt) {
  const message = {
    type: 'palette',
    generation,
    secondsPerBeat: generation === 1 ? 0.5 : 0.375,
    voices: { lead: { osc, env: { a: 0.002, d: 0.04, s: 0.7, r: 0.03 } } },
    percs: {},
    echo: { beats: 0.5, fb: 0.2, level: 0.1 }
  };
  if (activateAt != null) message.activateAt = activateAt;
  return message;
}

function event(time) {
  return { kind: 'note', time, dur: 0.1, slot: 'lead', freq: 440, vel: 0.4, seed: Math.round(time * 1000) };
}

function renderBlock(processor, at) {
  context.currentTime = at;
  const left = new Float32Array(128);
  const right = new Float32Array(128);
  processor.process([], [[left, right]]);
}

const processor = new Processor();
send(processor, palette(1, 'pulse'));
send(processor, { type: 'events', generation: 1, events: [event(9), event(9.5)] });

send(processor, palette(2, 'saw', 10));
assert.equal(processor.generation, 1, 'future palette does not activate early');
assert.equal(processor.events.length - processor.eventHead, 2, 'preloading the next palette preserves the current track tail');
assert.equal(processor.pendingPalette.generation, 2, 'next generation waits at the boundary');

send(processor, { type: 'events', generation: 2, events: [event(10)] });
assert.equal(processor.events.length - processor.eventHead, 3, 'current and next generation events coexist');

renderBlock(processor, 9);
assert.equal(processor.generation, 1);
assert.ok(processor.voices.some((voice) => voice.osc === 'pulse'), 'current palette renders before boundary');
renderBlock(processor, 9.5);
assert.equal(processor.generation, 1);
renderBlock(processor, 10);
assert.equal(processor.generation, 2, 'next palette activates exactly at boundary');
assert.ok(processor.voices.some((voice) => voice.osc === 'saw'), 'next generation event uses the next palette');
assert.equal(processor.pendingPalette, null);
assert.ok(processor.echoes.some((echo) => echo.gen === 1 && echo.frozen), 'outgoing echo drains after boundary');
assert.ok(processor.echoes.some((echo) => echo.gen === 2 && !echo.frozen), 'incoming echo uses the new generation');

const cancelled = new Processor();
send(cancelled, palette(1, 'pulse'));
send(cancelled, palette(2, 'saw', 20));
send(cancelled, { type: 'events', generation: 2, events: [event(20)] });
send(cancelled, { type: 'clearFuture', generation: 2, time: 15 });
assert.equal(cancelled.pendingPalette, null, 'transport retime/skip cancels a stale pending palette');
assert.equal(cancelled.events.length - cancelled.eventHead, 0, 'transport retime/skip clears future events across generations');

console.log('worklet boundary: PASS');
