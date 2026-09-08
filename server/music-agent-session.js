'use strict';

// Trusted-host-only, synchronous in-memory state machine, NOT authentication or
// an MCP transport. The host authenticates/authorizes every call, separates browser
// from agent capabilities, bounds transport bytes before parsing, and serializes
// browser publication/claim/application. IDs and generations are not credentials.
// Browser must compare the full claim base against its current draft immediately
// before applying once; this core cannot make a remote browser mutation atomic.
// Create a fresh instance per authorized session; never reuse it after revoke.
// exportState()/createMusicAgentSession({now,state}) are PRIVATE HOST STORAGE APIs, never
// tool responses: records contain sensitive source and edits, but no credentials.
// Host must atomically persist EVERY transition (including failed calls, expiry,
// claim and revoke) before releasing its result, with one writer/CAS per session.
// Hydrate only the latest integrity-protected record; validation cannot detect a
// rollback to an older valid record or malicious edits that remain self-consistent.
// now() must use the same durable time domain across processes (e.g. epoch ms),
// not process uptime. Clock regression/failure permanently revokes the session.
const project = require('../src/music-project.js');
const language = require('../src/music-language.js');
const LIMITS = Object.freeze({ inputBytes: 600000, sourceBytes: 524288,
  editBytes: 16384, edits: 32, replay: 1024, pending: 1, ttlMs: 30000, storageBytes: 1048576 });
const bytes = s => Buffer.byteLength(s, 'utf8');
const need = (ok, code) => { if (!ok) throw new Error(code); };
const id = s => typeof s === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(s);
const integer = n => Number.isSafeInteger(n) && n >= 0;
function shape(v, keys) {
  need(v && !Array.isArray(v) && typeof v === 'object' &&
    Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k)), 'invalid_input');
}
function unicode(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(++i); if (!(d >= 0xdc00 && d <= 0xdfff)) return false;
    } else if (c >= 0xdc00 && c <= 0xdfff) return false;
  }
  return true;
}
// Bounded detached JSON data; do not invoke accessors or toJSON. Host must never
// pass executable objects/Proxies from untrusted code into this trusted API.
function data(value, limit = LIMITS.inputBytes, maxNodes = 4096) {
  let budget = limit, nodes = 0;
  function copy(v, depth) {
    need(depth <= 16 && ++nodes <= maxNodes, 'input_limit');
    if (typeof v === 'string') {
      need(v.length <= budget && unicode(v), 'invalid_input');
      budget -= bytes(JSON.stringify(v));
    } else if (v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) {
      budget -= 8;
    } else {
      need(v && typeof v === 'object' && (Array.isArray(v) || Object.getPrototypeOf(v) === Object.prototype ||
        Object.getPrototypeOf(v) === null), 'invalid_input');
      const keys = Object.keys(v); need(keys.length <= 4096, 'input_limit');
      if (Array.isArray(v)) need(keys.length === v.length && keys.every((k, i) => k === String(i)), 'invalid_input');
      const out = Array.isArray(v) ? [] : {};
      for (const k of keys) {
        need(!['__proto__', 'constructor', 'prototype'].includes(k), 'invalid_input');
        const d = Object.getOwnPropertyDescriptor(v, k);
        need(d && Object.hasOwn(d, 'value'), 'invalid_input');
        budget -= bytes(JSON.stringify(k)) + 2;
        out[k] = copy(d.value, depth + 1);
      }
      budget -= 2; need(budget >= 0, 'input_limit'); return out;
    }
    need(budget >= 0, 'input_limit'); return v;
  }
  return copy(value, 0);
}
const clone = v => JSON.parse(JSON.stringify(v));

function createMusicAgentSession({ now, compile = language.compile,
  ttlMs = LIMITS.ttlMs, maxReplay = LIMITS.replay, state, serialized } = {}) {
  let saved = null;
  if (serialized !== undefined || state !== undefined) {
    try {
      need(serialized === undefined || state === undefined, 'invalid_storage');
      if (serialized !== undefined) {
        need(typeof serialized === 'string' && bytes(serialized) <= LIMITS.storageBytes, 'invalid_storage');
        state = JSON.parse(serialized);
      }
      saved = data(state, LIMITS.storageBytes, 16384);
      shape(saved, ['format', 'version', 'ttlMs', 'maxReplay', 'revoked', 'generation', 'lastTime', 'expires', 'snapshot', 'pending', 'seen']);
      need(saved.format === 'ct-music-agent-session' && saved.version === 1, 'invalid_storage');
      // The stored bounds are authoritative: restoration never resets capacity
      // or extends a lease using the caller's current defaults.
      ttlMs = saved.ttlMs; maxReplay = saved.maxReplay;
    } catch (_) { throw new TypeError('invalid_storage'); }
  }
  if (typeof now !== 'function' || typeof compile !== 'function' || !Number.isInteger(ttlMs) ||
      ttlMs < 1 || ttlMs > LIMITS.ttlMs || !Number.isInteger(maxReplay) || maxReplay < 1 || maxReplay > LIMITS.replay)
    throw new TypeError(saved ? 'invalid_storage' : 'invalid_options');
  let revoked = false, snapshot = null, generation = 0, expires = null, lastTime = null, pending = null;
  const seen = new Map();
  function invalidate(status) {
    if (pending) seen.set(pending.id, status);
    pending = null;
  }
  const validTime = t => typeof t === 'number' && Number.isFinite(t) && t >= 0 && t <= Number.MAX_SAFE_INTEGER - ttlMs;
  function tick(allowRevoked = false) {
    let t;
    try { t = now(); } catch (_) { t = NaN; }
    if (!validTime(t) || (lastTime !== null && t < lastTime)) {
      revoked = true; snapshot = null; invalidate('revoked');
      expires = null;
    } else lastTime = t;
    need(allowRevoked || !revoked, 'revoked');
    if (snapshot && t >= expires) { invalidate('offline'); snapshot = null; expires = null; }
    return t;
  }
  function online() { need(snapshot !== null, 'offline'); }
  function compiled(source) {
    const p = project.create(source, { compile });
    need(p.validated, 'invalid_source'); return p.validated.compiled;
  }
  function checkedSnapshot(v) {
    shape(v, ['source', 'baseRevision', 'draftEpoch', 'selection', 'constraints']);
    need(typeof v.source === 'string' && bytes(v.source) <= LIMITS.sourceBytes &&
      id(v.baseRevision) && integer(v.draftEpoch), 'invalid_snapshot');
    if (v.selection !== null) {
      shape(v.selection, ['ch', 'fromFrame', 'toFrame']);
      const s = v.selection;
      need(integer(s.ch) && s.ch < 4 && integer(s.fromFrame) && integer(s.toFrame) && s.toFrame > s.fromFrame, 'invalid_selection');
    }
    need(v.constraints && typeof v.constraints === 'object' && !Array.isArray(v.constraints), 'invalid_constraints');
    const c = compiled(v.source);
    project.checkConstraints(c, c, v.constraints);
    return v;
  }
  function exact(v) {
    need(v.generation === generation && v.baseRevision === snapshot.baseRevision &&
      v.draftEpoch === snapshot.draftEpoch, 'stale_snapshot');
  }
  function install(v, t) {
    need(generation < Number.MAX_SAFE_INTEGER, 'generation_limit');
    invalidate('superseded'); snapshot = v; generation++; expires = t + ttlMs;
  }
  // Only fixed codes cross the boundary; compiler exceptions/diagnostics may
  // contain source and are deliberately discarded.
  const codes = new Set(['invalid_input', 'input_limit', 'revoked', 'offline', 'invalid_source',
    'invalid_snapshot', 'invalid_selection', 'invalid_constraints', 'stale_snapshot',
    'generation_limit', 'duplicate_proposal', 'replay_limit', 'pending_proposal',
    'invalid_proposal', 'stale_claim', 'invalid_ack']);
  function call(fn, allowRevoked = false) {
    try { return { ok: true, ...fn(tick(allowRevoked)) }; }
    catch (e) { return { ok: false, code: e instanceof Error && codes.has(e.message) ? e.message : 'invalid_input' }; }
  }
  function candidateOf(v) {
      shape(v, ['id', 'generation', 'baseRevision', 'draftEpoch', 'edits', 'explanation']);
      need(id(v.id), 'invalid_proposal');
      exact(v);
      need(typeof v.explanation === 'string' && bytes(v.explanation) <= 5000 &&
        Array.isArray(v.edits) && v.edits.length > 0 && v.edits.length <= LIMITS.edits, 'invalid_proposal');
      let pos = 0, previous = -1, inserted = 0, removed = 0, candidate = '';
      for (const e of v.edits) {
        shape(e, ['from', 'to', 'text']);
        need(integer(e.from) && integer(e.to) && e.from >= pos && e.from > previous && e.to >= e.from &&
          e.to <= snapshot.source.length && typeof e.text === 'string', 'invalid_proposal');
        const cut = snapshot.source.slice(e.from, e.to);
        need(unicode(snapshot.source.slice(0, e.from)) && unicode(snapshot.source.slice(e.to)), 'invalid_proposal');
        inserted += bytes(e.text); removed += bytes(cut);
        need(inserted <= LIMITS.editBytes && removed <= LIMITS.editBytes, 'invalid_proposal');
        candidate += snapshot.source.slice(pos, e.from) + e.text; pos = e.to; previous = e.from;
      }
      candidate += snapshot.source.slice(pos);
      need(candidate !== snapshot.source && removed < bytes(snapshot.source) && bytes(candidate) <= LIMITS.sourceBytes, 'invalid_proposal');
      const before = compiled(snapshot.source), after = compiled(candidate);
      // Selection is contextual; only explicit constraints authorize scope enforcement.
      project.checkConstraints(before, after, snapshot.constraints);
      return candidate;
  }
  if (saved) {
    try {
      need(typeof saved.revoked === 'boolean' && integer(saved.generation) &&
        (saved.lastTime === null || validTime(saved.lastTime)), 'invalid_storage');
      revoked = saved.revoked; generation = saved.generation; lastTime = saved.lastTime;
      need(Array.isArray(saved.seen) && saved.seen.length <= maxReplay, 'invalid_storage');
      const statuses = ['invalid', 'pending', 'claimed', 'superseded', 'offline', 'revoked', 'applied', 'rejected', 'failed'];
      for (const entry of saved.seen) {
        need(Array.isArray(entry) && entry.length === 2 && id(entry[0]) && statuses.includes(entry[1]) && !seen.has(entry[0]), 'invalid_storage');
        seen.set(entry[0], entry[1]);
      }
      need(generation > 0 || (!saved.snapshot && !saved.pending && !seen.size), 'invalid_storage');
      need(lastTime !== null || (!generation && !seen.size), 'invalid_storage');
      if (saved.snapshot !== null) {
        need(!revoked && generation > 0 && lastTime !== null && typeof saved.expires === 'number' &&
          Number.isFinite(saved.expires) && saved.expires > lastTime && saved.expires <= lastTime + ttlMs, 'invalid_storage');
        snapshot = checkedSnapshot(data(saved.snapshot)); expires = saved.expires;
      } else need(saved.expires === null && saved.pending === null, 'invalid_storage');
      if (saved.pending !== null) {
        shape(saved.pending, ['proposal', 'status']);
        const v = data(saved.pending.proposal), status = saved.pending.status;
        need(snapshot && ['pending', 'claimed'].includes(status) && seen.get(v.id) === status, 'invalid_storage');
        pending = { ...v, candidate: candidateOf(v), status };
      }
      for (const [key, status] of seen) {
        if (status === 'pending' || status === 'claimed') need(pending && pending.id === key, 'invalid_storage');
        if (status === 'revoked') need(revoked, 'invalid_storage');
      }
    } catch (_) { throw new TypeError('invalid_storage'); }
    // Preserve revoked imports and expire elapsed leases without extending them.
    tick(true);
  }
  function exportState() {
    tick(true);
    let storedPending = null;
    if (pending) {
      const { candidate, status, ...proposal } = pending;
      storedPending = { proposal, status };
    }
    return clone({ format: 'ct-music-agent-session', version: 1,
      ttlMs, maxReplay, revoked, generation, lastTime, expires, snapshot,
      pending: storedPending, seen: Array.from(seen) });
  }
  return Object.freeze({
    exportState,
    publish: input => call(t => {
      // Even a malformed publication invalidates outstanding work fail closed.
      invalidate('superseded'); snapshot = null; expires = null;
      install(checkedSnapshot(data(input)), t); return { generation, status: 'online' };
    }),
    heartbeat: input => call(t => {
      online(); const v = data(input); shape(v, ['generation', 'baseRevision', 'draftEpoch']); exact(v);
      expires = t + ttlMs; return { status: 'online', generation };
    }),
    readContext: () => call(() => { online(); return { ...clone(snapshot), generation }; }),
    // Browser-only capability: host must not register this as an agent tool.
    peek: () => call(() => pending ? {
      id: pending.id, generation: pending.generation, baseRevision: pending.baseRevision,
      draftEpoch: pending.draftEpoch, status: pending.status
    } : { generation, status: snapshot ? 'idle' : 'offline' }),
    peekPending: () => call(() => ({ pending: pending ? {
      id: pending.id, generation: pending.generation, baseRevision: pending.baseRevision,
      draftEpoch: pending.draftEpoch, status: pending.status
    } : null })),
    propose: input => call(() => {
      online(); const v = data(input);
      shape(v, ['id', 'generation', 'baseRevision', 'draftEpoch', 'edits', 'explanation']);
      need(id(v.id), 'invalid_proposal');
      need(!seen.has(v.id), 'duplicate_proposal');
      need(seen.size < maxReplay, 'replay_limit');
      seen.set(v.id, 'invalid'); // Failed submissions also consume their ID.
      need(!pending, 'pending_proposal');
      const candidate = candidateOf(v);
      pending = { ...v, candidate, status: 'pending' }; seen.set(v.id, 'pending');
      return { id: v.id, status: 'pending', generation };
    }),
    claim: input => call(() => {
      online(); const v = data(input); shape(v, ['id', 'generation', 'baseRevision', 'draftEpoch']); exact(v);
      need(pending && pending.id === v.id && pending.status === 'pending', 'stale_claim');
      pending.status = 'claimed'; seen.set(v.id, 'claimed');
      return { proposal: clone(pending) };
    }),
    acknowledge: input => call(t => {
      online(); const v = data(input); shape(v, ['id', 'generation', 'baseRevision', 'draftEpoch', 'status', 'snapshot']); exact(v);
      need(pending && pending.id === v.id && pending.status === 'claimed', 'stale_claim');
      need(['applied', 'rejected', 'failed'].includes(v.status), 'invalid_ack');
      if (v.status === 'applied') {
        const next = checkedSnapshot(v.snapshot);
        need(next.source === pending.candidate && next.baseRevision !== snapshot.baseRevision &&
          next.draftEpoch > snapshot.draftEpoch, 'invalid_ack');
        install(next, t);
      } else { need(v.snapshot === null, 'invalid_ack'); pending = null; }
      seen.set(v.id, v.status); return { id: v.id, status: v.status, generation };
    }),
    status: input => call(() => {
      const v = data(input); shape(v, ['id']); need(id(v.id), 'invalid_input');
      return { id: v.id, status: seen.get(v.id) || 'unknown' };
    }),
    serialize: () => call(() => {
      const serialized = JSON.stringify(exportState());
      need(bytes(serialized) <= LIMITS.storageBytes, 'input_limit');
      return { serialized };
    }, true),
    revoke: () => { revoked = true; invalidate('revoked'); snapshot = null; expires = null; return { ok: true, status: 'revoked' }; }
  });
}

function hydrateMusicAgentSession(serialized, options = {}) {
  try {
    need(typeof serialized === 'string', 'invalid_storage');
    return { ok: true, session: createMusicAgentSession({ ...options, serialized }) };
  } catch (_) { return { ok: false, code: 'invalid_storage' }; }
}

module.exports = { createMusicAgentSession, hydrateMusicAgentSession, LIMITS };
