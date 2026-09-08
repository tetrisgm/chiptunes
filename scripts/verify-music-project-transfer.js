#!/usr/bin/env node
'use strict';
// Deterministic fake windows/clock/crypto only. No popup, network or persistence.
const assert = require('node:assert/strict');
const transfer = require('../src/music-project-transfer.js');
const projects = require('../src/music-project.js');
const language = require('../src/music-language.js');
const { test } = require('node:test');
function fixture() {
  let time = 0, nextTimer = 0, rng = 0;
  const timers = new Map(), queue = [], messages = [];
  function window(origin) {
    const listeners = new Map();
    const win = { location: { origin, pathname: '/create', search: '', hash: '' },
      close() { assert.fail('transfer must never close either window'); },
      performance: { now: () => time },
      crypto: { getRandomValues(bytes) { for (let i = 0; i < bytes.length; i++) bytes[i] = (++rng) % 256; return bytes; } },
      setTimeout(fn, ms) { timers.set(++nextTimer, { fn, at: time + ms }); return nextTimer; },
      clearTimeout(id) { timers.delete(id); },
      addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
      removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
      emit(name, event) { for (const fn of [...(listeners.get(name) || [])]) fn(event); },
      listenerCount: () => [...listeners.values()].reduce((n, set) => n + set.size, 0),
    };
    win.history = { replaceState(state, unused, path) { assert.equal(state, null); win.location.hash = path.slice(path.indexOf('#')); } };
    return win;
  }
  const sender = window(transfer.SENDER_ORIGIN), receiver = window(transfer.RECEIVER_ORIGIN);
  const senderRef = {}, receiverRef = {};
  function post(from, to, source, data, targetOrigin) {
    assert.notEqual(targetOrigin, '*');
    messages.push({ from, to, source, data: structuredClone(data), targetOrigin });
    queue.push(() => { if (to.location.origin === targetOrigin) to.emit('message', { source, origin: from.location.origin, data: structuredClone(data) }); });
  }
  senderRef.postMessage = (data, origin) => post(receiver, sender, receiverRef, data, origin);
  receiverRef.postMessage = (data, origin) => post(sender, receiver, senderRef, data, origin);
  const openerAtTerminal = [];
  const sendToParent = senderRef.postMessage;
  senderRef.postMessage = (data, origin) => {
    if (data.type === 'received' || data.type === 'cancel') openerAtTerminal.push(receiver.opener);
    sendToParent(data, origin);
  };
  receiver.opener = senderRef;
  let opened;
  sender.open = (url, target) => { opened = { url, target }; receiver.location.hash = new URL(url).hash; return receiverRef; };
  return { sender, receiver, senderRef, receiverRef, messages, openerAtTerminal,
    opened: () => opened, timers,
    flush() { while (queue.length) queue.shift()(); },
    advance(ms, fire = true) { time += ms; if (fire) for (const [id, timer] of [...timers]) if (timer.at <= time) { timers.delete(id); timer.fn(); } },
    send(text = '{"draft":"test"}') { return transfer.send(text, { window: sender, timeoutMs: 100 }); },
    receive() { return transfer.receive({ window: receiver, timeoutMs: 100 }); },
    forge(win, source, origin, type, nonce, extra = {}) { win.emit('message', { source, origin,
      data: { protocol: 'ct-project-transfer-v1', type, nonce, ...extra } }); },
    nonce: () => new URL(opened.url).hash.split('=')[1],
  };
}
test('large Unicode project transfers byte-exactly only after Accept; fragment has nonce only', async () => {
  const f = fixture();
  const options = { compile: language.compile };
  const base = 'song({totalFrames:120})\ninstruments([[128,240,255,0]])\nevent({ch:0,frame:0,frames:10,midi:60,inst:0,vel:1})\n';
  const project = projects.create(base, options);
  const draft = '// 🎵 café\n'.repeat(40000) + base;
  assert.equal(project.editDraft(draft).ok, true);
  const text = project.serialize();
  assert.ok(Buffer.byteLength(text) > 12000);
  const send = f.send(text), receive = f.receive();
  assert.equal(f.opened().target, '_blank');
  const url = new URL(f.opened().url);
  assert.equal(url.origin, transfer.RECEIVER_ORIGIN); assert.equal(url.search, '');
  assert.match(url.hash, /^#music-transfer=[0-9a-f]{64}$/);
  assert.equal(f.receiver.location.hash, '#music');
  f.flush(); assert.deepEqual(await receive.offer, { ok: true, bytes: Buffer.byteLength(text) });
  assert.ok(f.messages.every(m => !Object.hasOwn(m.data, 'serialized')));
  receive.accept(); f.flush();
  assert.deepEqual(await receive.result, { ok: true, serialized: text });
  // Import remains an explicit host action after Accept, outside the module.
  const restored = projects.restore((await receive.result).serialized, options);
  assert.equal(restored.ok, true);
  assert.equal(restored.project.draft, draft);
  assert.equal(restored.project.validated.source, base); // Preserve unapplied draft AND last valid source.
  assert.deepEqual(await send.result, { ok: true, code: 'received' });
  assert.equal(f.messages.filter(m => m.data.type === 'project').length, 1);
  receive.accept(); f.flush(); assert.equal(f.messages.filter(m => m.data.type === 'project').length, 1);
  assert.equal(f.sender.listenerCount() + f.receiver.listenerCount(), 0); assert.equal(f.timers.size, 0);
  assert.equal(f.receiver.opener, null);
  assert.deepEqual(f.openerAtTerminal, [f.senderRef]); // Ack precedes capability release.
});
test('hostile origin, wrong window and wrong nonce cannot advance sender or receiver', async () => {
  const f = fixture(), send = f.send(), receive = f.receive(), nonce = f.nonce();
  for (const type of ['hello', 'accept', 'received']) {
    f.forge(f.sender, f.receiverRef, 'https://evil.example', type, nonce);
    f.forge(f.sender, {}, transfer.RECEIVER_ORIGIN, type, nonce);
    f.forge(f.sender, f.receiverRef, transfer.RECEIVER_ORIGIN, type, '0'.repeat(64));
  }
  assert.equal(f.messages.length, 1); // Only receiver's legitimate hello.
  f.flush(); await receive.offer;
  for (const [source, origin, n] of [[{}, transfer.SENDER_ORIGIN, nonce],
    [f.senderRef, 'https://evil.example', nonce], [f.senderRef, transfer.SENDER_ORIGIN, '0'.repeat(64)]]) {
    f.forge(f.receiver, source, origin, 'project', n, { serialized: '{"draft":"evil"}' });
  }
  // Even the correct peer cannot push data before acceptance.
  f.forge(f.receiver, f.senderRef, transfer.SENDER_ORIGIN, 'project', nonce, { serialized: '{"draft":"evil"}' });
  receive.accept(); f.flush();
  assert.equal((await receive.result).serialized, '{"draft":"test"}'); assert.equal((await send.result).ok, true);
});
test('cancel on either side is terminal and late messages/replayed fragment cannot revive transfer', async () => {
  for (const side of ['sender', 'receiver']) {
    const f = fixture(), send = f.send(), receive = f.receive(), nonce = f.nonce();
    f.flush(); await receive.offer;
    (side === 'sender' ? send : receive).cancel(); f.flush();
    assert.equal((await send.result).code, 'cancelled'); assert.equal((await receive.result).code, 'cancelled');
    assert.equal(f.receiver.opener, null);
    receive.accept();
    f.forge(f.sender, f.receiverRef, transfer.RECEIVER_ORIGIN, 'accept', nonce); f.flush();
    assert.equal(f.messages.filter(m => m.data.type === 'project').length, 0);
    f.receiver.location.hash = '#music-transfer=' + nonce;
    assert.equal(f.receive(), null); assert.equal(f.timers.size, 0);
  }
});
test('deadline and delayed timer dispatch expire pending acceptance; pagehide cancels', async () => {
  for (const fire of [true, false]) {
    const f = fixture(), send = f.send(), receive = f.receive(); f.flush(); await receive.offer;
    f.advance(101, fire); receive.accept(); f.flush();
    assert.equal((await receive.result).code, 'expired');
    assert.equal((await send.result).ok, false);
    assert.equal(f.messages.filter(m => m.data.type === 'project').length, 0); assert.equal(f.timers.size, 0);
  }
  const f = fixture(), send = f.send(), receive = f.receive();
  f.sender.emit('pagehide', {}); f.flush();
  assert.equal((await send.result).code, 'cancelled'); assert.equal((await receive.result).code, 'cancelled');
});
test('receiver pagehide sends cancel before clearing opener without closing or navigating either window', async () => {
  const f = fixture(), send = f.send(), receive = f.receive();
  f.flush(); await receive.offer;
  const senderLocation = { ...f.sender.location }, receiverLocation = { ...f.receiver.location };
  const sentinel = {}; f.sender.opener = sentinel;
  f.receiver.emit('pagehide', {}); f.flush();
  assert.equal((await receive.result).code, 'cancelled'); assert.equal((await send.result).code, 'cancelled');
  assert.deepEqual(f.openerAtTerminal, [f.senderRef]);
  assert.equal(f.receiver.opener, null); assert.equal(f.sender.opener, sentinel);
  assert.deepEqual(f.sender.location, senderLocation); assert.deepEqual(f.receiver.location, receiverLocation);
  assert.equal(f.sender.listenerCount() + f.receiver.listenerCount(), 0); assert.equal(f.timers.size, 0);
});
test('opener setter failure does not prevent terminal cleanup or completion', async () => {
  const f = fixture(), send = f.send(), receive = f.receive();
  Object.defineProperty(f.receiver, 'opener', { get: () => f.senderRef, set: () => { throw Error('read-only'); } });
  f.flush(); await receive.offer; receive.accept(); f.flush();
  assert.equal((await receive.result).ok, true); assert.equal((await send.result).ok, true);
  assert.equal(f.sender.listenerCount() + f.receiver.listenerCount(), 0); assert.equal(f.timers.size, 0);
});
test('sender validates JSON and UTF-8 8MiB bound before opening any popup', () => {
  const f = fixture();
  for (const value of ['not JSON', 'null', '[]', 1]) assert.throws(() => f.send(value));
  assert.throws(() => f.send(JSON.stringify({ draft: '🎵'.repeat(transfer.MAX_BYTES / 4) })), /project_limit/);
  assert.equal(f.opened(), undefined); assert.equal(f.timers.size, 0);
  const exact = '{"draft":"' + 'x'.repeat(transfer.MAX_BYTES - 12) + '"}';
  assert.equal(Buffer.byteLength(exact), transfer.MAX_BYTES);
  const send = f.send(exact); send.cancel();
});
test('receiver refuses oversized offer, oversized payload, size mismatch and invalid JSON', async () => {
  for (const variant of ['offer', 'payload', 'mismatch', 'json']) {
    const f = fixture(), send = f.send(), receive = f.receive(), nonce = f.nonce();
    if (variant === 'offer') {
      f.forge(f.receiver, f.senderRef, transfer.SENDER_ORIGIN, 'offer', nonce, { bytes: transfer.MAX_BYTES + 1 });
    } else {
      f.flush(); await receive.offer; receive.accept();
      const serialized = variant === 'payload' ? 'x'.repeat(transfer.MAX_BYTES + 1) : variant === 'json' ? '!' : '{}';
      f.forge(f.receiver, f.senderRef, transfer.SENDER_ORIGIN, 'project', nonce, { serialized });
    }
    f.flush(); assert.equal((await receive.result).ok, false); assert.equal((await send.result).ok, false);
    assert.equal(f.sender.listenerCount() + f.receiver.listenerCount(), 0);
  }
});
test('fixed origins, missing opener, normal page, blocked popup and unavailable crypto fail closed', async () => {
  const f = fixture(); assert.equal(f.receive(), null);
  f.sender.open = () => null; assert.equal((await f.send().result).code, 'popup_blocked');
  f.sender.location.origin = 'https://evil.example'; assert.throws(() => f.send(), /wrong_origin/);
  f.sender.location.origin = transfer.SENDER_ORIGIN; f.sender.crypto = null; assert.throws(() => f.send());
  f.receiver.location.hash = '#music-transfer=' + 'a'.repeat(64); f.receiver.opener = null;
  assert.equal(f.receive(), null); assert.equal(f.receiver.location.hash, '#music');
  f.receiver.location.origin = 'https://evil.example'; assert.throws(() => f.receive(), /wrong_origin/);
});
