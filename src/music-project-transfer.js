/* Explicit, one-shot project transfer. No import, storage, fetch or model calls.
 * send(project.serialize()) MUST run inside the user's click handler.
 * receive().offer resolves to metadata; only an explicit UI Accept calls accept().
 * Message nonce is a capability; in URLs it appears ONLY in the initial fragment.
 * Do not log messages or persist nonce/source. COOP must preserve window.opener.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CT_MUSIC_PROJECT_TRANSFER = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  var SENDER = 'https://chiptunes.app', RECEIVER = 'https://chiptunes-agent-gateway.vercel.app';
  var MAX_BYTES = 8 * 1024 * 1024, TIMEOUT_MS = 120000, PROTOCOL = 'ct-project-transfer-v1';
  var seen = new WeakMap();
  function deferred() { var resolve; var promise = new Promise(function (r) { resolve = r; }); return { promise: promise, resolve: resolve }; }
  function error(code) { return { ok: false, code: code }; }
  function validate(serialized) {
    if (typeof serialized !== 'string' || serialized.length > MAX_BYTES) throw Error('project_limit');
    var bytes = new TextEncoder().encode(serialized).byteLength;
    if (bytes > MAX_BYTES) throw Error('project_limit');
    var value;
    try { value = JSON.parse(serialized); } catch (_) { throw Error('invalid_json'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('invalid_json');
    return bytes;
  }
  function environment(options, origin) {
    var win = options.window || root, ms = options.timeoutMs == null ? TIMEOUT_MS : options.timeoutMs;
    if (win.location.origin !== origin) throw Error('wrong_origin');
    if (!Number.isInteger(ms) || ms < 1 || ms > TIMEOUT_MS) throw Error('invalid_timeout');
    return { win: win, ms: ms };
  }
  // All deadlines use local monotonic time. Timers are session-local and removed
  // on every terminal path; delayed event dispatch cannot revive an expired offer.
  function channel(win, peer, origin, nonce, ms, onMessage, onEnd) {
    var active = true, expires = win.performance.now() + ms;
    function post(type, extra) {
      if (!active) return false;
      try { peer.postMessage(Object.assign({ protocol: PROTOCOL, nonce: nonce, type: type }, extra || {}), origin); return true; }
      catch (_) { finish(error('peer_unavailable')); return false; }
    }
    function finish(result, notify) {
      if (!active) return;
      if (notify) { try { peer.postMessage({ protocol: PROTOCOL, nonce: nonce, type: 'cancel' }, origin); } catch (_) {} }
      active = false; win.clearTimeout(timer);
      win.removeEventListener('message', message); win.removeEventListener('pagehide', leave);
      onEnd(result);
    }
    function live() {
      if (active && win.performance.now() >= expires) finish(error('expired'), true);
      return active;
    }
    function message(event) {
      if (!live() || event.origin !== origin || event.source !== peer) return;
      var data = event.data;
      if (!data || typeof data !== 'object' || data.protocol !== PROTOCOL || data.nonce !== nonce) return;
      if (data.type === 'cancel') return finish(error('cancelled'));
      onMessage(data);
    }
    function leave() { finish(error('cancelled'), true); }
    var timer = win.setTimeout(function () { finish(error('expired'), true); }, ms);
    win.addEventListener('message', message); win.addEventListener('pagehide', leave);
    return { post: post, finish: finish, live: live, cancel: leave };
  }
  function send(serialized, options) {
    options = options || {};
    var env = environment(options, SENDER), win = env.win, bytes = validate(serialized);
    var random = new Uint8Array(32);
    win.crypto.getRandomValues(random);
    var nonce = Array.from(random, function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    var done = deferred(), phase = 'hello', ch;
    // An opener is required; do not use noopener or a reusable named window.
    var popup = win.open(RECEIVER + '/create#music-transfer=' + nonce, '_blank');
    if (!popup) return Object.freeze({ result: Promise.resolve(error('popup_blocked')), cancel: function () {} });
    ch = channel(win, popup, RECEIVER, nonce, env.ms, function (data) {
      if (phase === 'hello' && data.type === 'hello') {
        phase = 'accept'; ch.post('offer', { bytes: bytes });
      } else if (phase === 'accept' && data.type === 'accept') {
        phase = 'ack';
        ch.post('project', { serialized: serialized });
        serialized = null;
      } else if (phase === 'ack' && data.type === 'received') {
        ch.finish({ ok: true, code: 'received' });
      }
    }, function (result) { serialized = null; done.resolve(result); });
    return Object.freeze({ result: done.promise, cancel: ch.cancel });
  }
  function receive(options) {
    options = options || {};
    var env = environment(options, RECEIVER), win = env.win;
    var match = /^#music-transfer=([0-9a-f]{64})$/.exec(win.location.hash);
    if (!match) return null;
    var nonce = match[1], peer = win.opener;
    // Remove capability from browser history before displaying the offer.
    win.history.replaceState(null, '', win.location.pathname + win.location.search + '#music');
    var used = seen.get(win);
    if (!used) { used = new Set(); seen.set(win, used); }
    if (!peer || peer === win || used.has(nonce) || used.size >= 64) return null;
    used.add(nonce);
    var offer = deferred(), done = deferred(), phase = 'offer', bytes, ch;
    ch = channel(win, peer, SENDER, nonce, env.ms, function (data) {
      if (phase === 'offer' && data.type === 'offer') {
        if (!Number.isSafeInteger(data.bytes) || data.bytes < 2 || data.bytes > MAX_BYTES) return ch.finish(error('project_limit'), true);
        bytes = data.bytes; phase = 'consent'; offer.resolve({ ok: true, bytes: bytes });
      } else if (phase === 'project' && data.type === 'project') {
        try {
          if (validate(data.serialized) !== bytes) throw Error('size_mismatch');
        } catch (e) { return ch.finish(error(e.message), true); }
        if (!ch.live()) return;
        if (ch.post('received')) ch.finish({ ok: true, serialized: data.serialized });
      }
    }, function (result) {
      // Terminal protocol ack/cancel has already been sent. Release only this
      // receiver's opener capability; never close or navigate either window.
      try { win.opener = null; } catch (_) {}
      phase = 'done'; offer.resolve(result); done.resolve(result);
    });
    ch.post('hello');
    return Object.freeze({ offer: offer.promise, result: done.promise,
      accept: function () {
        if (ch.live() && phase === 'consent') { phase = 'project'; ch.post('accept'); }
        return done.promise;
      }, cancel: ch.cancel });
  }
  return Object.freeze({ send: send, receive: receive, MAX_BYTES: MAX_BYTES, TIMEOUT_MS: TIMEOUT_MS,
    SENDER_ORIGIN: SENDER, RECEIVER_ORIGIN: RECEIVER });
});
