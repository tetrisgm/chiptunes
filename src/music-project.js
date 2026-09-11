/* Revision authority for Code/Notes. No audio or storage side effects on create/apply.
 * UMD, synchronous compiler injection: compile(source) -> {gb,settings,mapping,diagnostics}.
 * All returned data is detached. Source offsets are UTF-16, ranges half-open.
 * Locks use chip channel numbers, never model-provided track names or summaries.
 * Unknown GB fields and shared registers are conservatively global for constraints.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CT_MUSIC_PROJECT = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  var FORMAT = 'ct-music-project', VERSION = 1;
  var sessionCounter = 0;
  var LIMITS = { source: 1048576, record: 8388608, provenance: 65536, edits: 256, history: 64, requests: 1024 };
  function fail(code, message) { return { ok: false, code: code, message: message || code }; }
  function assert(ok, message) { if (!ok) throw new Error(message); }
  // Preserve typed instrument banks in memory; compiled artifacts are never persisted.
  function copy(value, depth) {
    depth = depth || 0;
    assert(depth < 100, 'Data nesting limit');
    if (value == null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') { assert(Number.isFinite(value), 'Non-finite data'); return value; }
    if (ArrayBuffer.isView(value)) {
      assert(!(value instanceof DataView), 'Unsupported DataView');
      return new value.constructor(value);
    }
    assert(typeof value === 'object', 'Non-data value');
    var result = Array.isArray(value) ? [] : {};
    Object.keys(value).forEach(function (key) {
      assert(key !== '__proto__' && key !== 'constructor' && key !== 'prototype', 'Unsafe data key');
      var descriptor = Object.getOwnPropertyDescriptor(value, key);
      assert(descriptor && 'value' in descriptor, 'Accessor data');
      if (descriptor.value !== undefined) result[key] = copy(descriptor.value, depth + 1);
    });
    return result;
  }
  function stable(value) {
    if (value === undefined) return 'undefined';
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (ArrayBuffer.isView(value)) return value.constructor.name + ':' + stable(Array.from(value));
    if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
    return '{' + Object.keys(value).sort().map(function (k) { return JSON.stringify(k) + ':' + stable(value[k]); }).join(',') + '}';
  }
  function equal(a, b) { return stable(a) === stable(b); }
  function sourceOK(source) { return typeof source === 'string' && source.length <= LIMITS.source; }
  function provenanceData(value) {
    var data = copy(value == null ? null : value);
    assert(JSON.stringify(data).length <= LIMITS.provenance, 'Provenance limit');
    return data;
  }
  function channels(tracks) {
    assert(Array.isArray(tracks) && tracks.length > 0 && tracks.length <= 4 && tracks.every(function (t) {
      return Number.isInteger(t) && t >= 0 && t <= 3;
    }), 'tracks must contain chip channels 0–3');
    return tracks;
  }
  function minus(a, b) {
    var counts = new Map();
    b.forEach(function (n) { var k = stable(n); counts.set(k, (counts.get(k) || 0) + 1); });
    return a.filter(function (n) { var k = stable(n), c = counts.get(k) || 0; if (c) { counts.set(k, c - 1); return false; } return true; });
  }
  function musicalDiff(before, after) {
    var a = before.gb, b = after.gb, removed = minus(a.notes, b.notes), added = minus(b.notes, a.notes);
    var fields = Array.from(new Set(Object.keys(a).concat(Object.keys(b)))).filter(function (k) {
      return k !== 'notes' && !equal(a[k], b[k]);
    }).sort();
    // Ordering of surviving events matters for same-frame register/trigger priority,
    // including when an unrelated addition/removal accompanies the reorder.
    var orderChanged = !equal(minus(a.notes, removed), minus(b.notes, added));
    var settingsChanged = !equal(before.settings, after.settings);
    return copy({ added: added, removed: removed, changedFields: fields, orderChanged: orderChanged,
      settingsChanged: settingsChanged, unchanged: !added.length && !removed.length && !fields.length && !orderChanged && !settingsChanged,
      summary: added.length + ' notes added; ' + removed.length + ' notes removed' +
        (fields.length ? '; GB fields changed: ' + fields.join(', ') : '') +
        (orderChanged ? '; note ordering changed' : '') + (settingsChanged ? '; song settings changed' : '') });
  }
  function projection(gb, tracks, type) {
    var notes = gb.notes.filter(function (n) { return tracks.indexOf(n.ch) !== -1; });
    if (type === 'track') return notes;
    // Anchor each assignment to its channel/start and occurrence order. Pitch,
    // velocity and gate edits remain possible; moving/adding/removing assignments
    // needs an unlocked instrument lane because correspondence is ambiguous.
    if (type === 'instrument') return notes.map(function (n) { return { ch: n.ch, frame: n.frame, inst: n.inst }; });
    return notes.map(function (n) {
      if (type === 'arrangement') return { ch: n.ch, frame: n.frame, frames: n.frames };
      var p = copy(n); delete p.inst; delete p.vel; delete p.pri; return p;
    });
  }
  function usedBank(gb, tracks) {
    var bank = gb.bank || {}, used = {}, waves = {}, arps = {}, unknown = {};
    gb.notes.forEach(function (n) {
      if (tracks.indexOf(n.ch) === -1) return;
      var record = (bank.instruments || [])[n.inst];
      used[n.inst] = { record: record, meta: (bank.meta || [])[n.inst] };
      if (record && record[2] !== undefined && record[2] !== 255) arps[record[2]] = (bank.arpTables || [])[record[2]];
      if (n.ch === 2) {
        var hw = root.CT_GB_HARDWARE;
        var slot = hw && hw.waveSlotOf ? hw.waveSlotOf(bank.instruments, n.inst) :
          (!record || !(record[3] & 1) ? 0 : Math.min(31, record[0] & 255));
        waves[slot] = (bank.waveTables || [])[slot];
      }
    });
    if (tracks.indexOf(2) !== -1) (gb.waveLoads || []).forEach(function (w) { waves[w.slot] = (bank.waveTables || [])[w.slot]; });
    Object.keys(bank).forEach(function (k) {
      if (['instruments', 'waveTables', 'arpTables', 'meta'].indexOf(k) === -1) unknown[k] = bank[k];
    });
    return { used: used, waves: waves, arps: arps, unknown: unknown };
  }
  function checkConstraints(before, after, constraints) {
    constraints = copy(constraints || {});
    assert(Object.keys(constraints).every(function (k) { return k === 'locks' || k === 'scope'; }), 'Unknown constraint');
    var locks = constraints.locks || [], scope = constraints.scope, diff = musicalDiff(before, after);
    assert(Array.isArray(locks) && locks.length <= 32, 'Invalid locks');
    locks.forEach(function (lock) {
      assert(['track', 'pitchrhythm', 'instrument', 'arrangement'].indexOf(lock.type) !== -1, 'Unknown lock');
      assert(Object.keys(lock).every(function (k) { return k === 'type' || k === 'tracks'; }), 'Unknown lock field');
      var tracks = channels(lock.tracks || [0, 1, 2, 3]);
      // Shared automation can change held notes and instruments without a note edit.
      var globalFields = diff.changedFields.filter(function (field) { return field !== 'bank'; });
      assert(!diff.settingsChanged && !globalFields.length && !diff.orderChanged, 'Lock conflicts with global/shared musical changes');
      if (diff.changedFields.indexOf('bank') !== -1)
        assert(equal(usedBank(before.gb, tracks), usedBank(after.gb, tracks)), 'Lock conflicts with used instrument-bank assets');
      assert(equal(projection(before.gb, tracks, lock.type), projection(after.gb, tracks, lock.type)), lock.type + ' lock violated');
    });
    if (scope) {
      assert(Object.keys(scope).every(function (k) { return ['tracks', 'fromFrame', 'toFrame'].indexOf(k) !== -1; }), 'Unknown scope field');
      var tracks = channels(scope.tracks || [0, 1, 2, 3]);
      var from = scope.fromFrame === undefined ? 0 : scope.fromFrame;
      var to = scope.toFrame === undefined ? Number.MAX_SAFE_INTEGER : scope.toFrame;
      assert(Number.isSafeInteger(from) && Number.isSafeInteger(to) && from >= 0 && to > from, 'Invalid frame scope');
      assert(!diff.settingsChanged && !diff.changedFields.length && !diff.orderChanged, 'Scope conflicts with global/shared musical changes');
      diff.added.concat(diff.removed).forEach(function (n) {
        assert(tracks.indexOf(n.ch) !== -1 && n.frame >= from && n.frame < to &&
          Number.isFinite(n.frames) && n.frames >= 0 && n.frame + n.frames <= to, 'Change outside requested track/region');
      });
    }
    return diff;
  }
  function create(source, options) {
    options = options || {};
    assert(sourceOK(source), 'Invalid or oversized source');
    var language = root.CT_MUSIC_LANGUAGE;
    var compiler = options.compile || (language && language.compile && language.compile.bind(language));
    assert(typeof compiler === 'function', 'A synchronous music compiler is required');
    var versions = { language: options.languageVersion || (language && language.VERSION) || '1',
      compiler: options.compilerVersion || (language && language.COMPILER_VERSION) || '1', assets: options.assetsVersion || 'unspecified' };
    versions = copy(versions);
    var metadata = copy({ seeds: options.seeds || [], assets: options.assets || [] });
    var privateData = copy({ chat: options.chat || [], provenance: provenanceData(options.provenance) });
    var draft = source, draftEpoch = 0, history = [], cursor = -1, serial = 0, queueSerial = 0;
    var visualData = null;
    var sessionId = ++sessionCounter;
    var playing = null, pending = null, diagnostics = [], active = null, requests = new Map();
    function current() { return history[cursor] || null; }
    function compile(text) {
      try {
        var c = compiler(text);
        assert(c && typeof c.then !== 'function', 'Compiler must be synchronous');
        c = copy(c);
        var ds = c.diagnostics || [];
        assert(Array.isArray(ds), 'Invalid diagnostics');
        if (c.ok === false || ds.some(function (d) { return d && (d.severity === 'error' || d.level === 'error'); })) return { ok: false, code: 'invalid', diagnostics: ds };
        assert(c.gb && Array.isArray(c.gb.notes), 'Compiler did not produce GB notes');
        assert(c.gb.notes.length <= 200000, 'Compiled event limit');
        c.gb.notes.forEach(function (n) {
          assert(Number.isInteger(n.ch) && n.ch >= 0 && n.ch <= 3 && Number.isFinite(n.frame) && n.frame >= 0 &&
            Number.isFinite(n.frames) && n.frames >= 0, 'Invalid compiled note timing/channel');
        });
        // View descriptors come only from this compile, never persisted input
        // or agent-supplied metadata. They cannot influence musical diffs/audio.
        assert(c.controls === undefined || Array.isArray(c.controls) && c.controls.length <= 50000, 'Invalid source-control descriptors');
        assert(c.controlsOmitted === undefined || Number.isSafeInteger(c.controlsOmitted) && c.controlsOmitted >= 0 && c.controlsOmitted <= LIMITS.source, 'Invalid source-control omissions');
        return { ok: true, compiled: { gb: c.gb, settings: c.settings || {}, mapping: c.mapping || [], controls: c.controls || [], controlsOmitted: c.controlsOmitted || 0, diagnostics: ds }, diagnostics: ds };
      } catch (e) { return { ok: false, code: 'invalid', diagnostics: [{ severity: 'error', message: String(e.message || e) }] }; }
    }
    function supersede() {
      if (active) { requests.set(active, { id: active, status: 'superseded' }); active = null; }
    }
    function install(text, compiled) {
      var previous = pending;
      supersede(); pending = null;
      history = history.slice(0, cursor + 1);
      var revision = { id: 'r' + (++serial), source: text, compiled: copy(compiled) };
      history.push(revision);
      if (history.length > LIMITS.history) history.shift();
      cursor = history.length - 1; draft = text; draftEpoch++; diagnostics = copy(compiled.diagnostics);
      return { ok: true, revision: copy(revision), superseded: copy(previous) };
    }
    function validate() {
      var result = compile(draft); diagnostics = copy(result.diagnostics);
      return copy(result);
    }
    function move(delta) {
      var next = cursor + delta;
      if (next < 0 || next >= history.length) return fail('history-boundary');
      var previous = pending;
      supersede(); pending = null; cursor = next; draft = current().source; draftEpoch++;
      diagnostics = copy(current().compiled.diagnostics);
      return { ok: true, revision: copy(current()), superseded: copy(previous) };
    }
    var project = {
      snapshot: function () { return copy({ draft: draft, draftEpoch: draftEpoch, validated: current(),
        playing: playing, pending: pending, diagnostics: diagnostics, versions: versions,
        canUndo: cursor > 0, canRedo: cursor + 1 < history.length,
        request: active ? { id: active, status: requests.get(active).status } : null }); },
      editDraft: function (text) {
        if (!sourceOK(text)) return fail('source-limit');
        if (text !== draft) { supersede(); draft = text; draftEpoch++; diagnostics = []; }
        return { ok: true, draftEpoch: draftEpoch };
      },
      validate: validate,
      // Conversation is private project data, not musical source or authority.
      // Legacy unknown chat records remain serialized, but are not rendered.
      getChat: function () {
        var messages=Array.isArray(privateData.chat)?privateData.chat:[];
        var recent=messages.filter(function(m){return m&&['user','assistant'].indexOf(m.role)!==-1&&typeof m.content==='string'&&m.content.length<=10000;}).slice(-64).map(function(m){return {role:m.role,content:m.content};});
        while(new TextEncoder().encode(JSON.stringify(recent)).length>131072)recent.shift();
        return recent;
      },
      setChat: function (messages) {
        try {
          var data=copy(messages);
          assert(Array.isArray(data)&&data.length<=64,'Conversation message limit');
          data.forEach(function(m){assert(m&&Object.keys(m).length===2&&['user','assistant'].indexOf(m.role)!==-1&&typeof m.content==='string'&&m.content.length<=10000,'Invalid conversation message');});
          assert(new TextEncoder().encode(JSON.stringify(data)).length<=131072,'Conversation size limit');
          privateData.chat=data;return {ok:true};
        }catch(e){return fail('invalid-conversation',String(e.message||e));}
      },
      // Call after a generated composition is applied to an existing project.
      // Private provenance is persisted only with serialize/save includePrivate.
      setProvenance: function (value) {
        try { privateData.provenance = provenanceData(value); return { ok: true }; }
        catch (e) { return fail('invalid-provenance', String(e.message || e)); }
      },
      applyDraft: function () {
        var result = validate(); if (!result.ok) return result;
        if (current() && current().source === draft && equal(current().compiled, result.compiled)) return { ok: true, revision: copy(current()), unchanged: true };
        return install(draft, result.compiled);
      },
      undo: function () { return move(-1); }, redo: function () { return move(1); },
      queue: function (revisionId) {
        if (!current() || revisionId !== current().id) return fail('stale-revision');
        var previous = pending;
        pending = { revisionId: revisionId, queueId: 'q' + sessionId + '-' + (++queueSerial) };
        return { ok: true, pending: copy(pending), superseded: copy(previous) };
      },
      ack: function (revisionId, queueId) {
        if (!pending || pending.revisionId !== revisionId || pending.queueId !== queueId) return fail('stale-ack');
        playing = revisionId; pending = null; return { ok: true, playing: playing };
      },
      cancel: function (queueId) {
        if (!pending || pending.queueId !== queueId) return fail('stale-queue');
        pending = null; return { ok: true };
      },
      stop: function () { playing = null; pending = null; return { ok: true }; },
      beginRequest: function (id) {
        if (typeof id !== 'string' || !id.length || id.length > 128) return fail('invalid-request-id');
        if (requests.has(id)) return fail('duplicate-request');
        if (active) return fail('request-active', 'Cancel or apply the active request before starting another');
        // Do not evict tombstones and accidentally admit replay. Start a new project session at the cap.
        if (requests.size >= LIMITS.requests) return fail('request-limit');
        if (!current() || draft !== current().source) return fail('unapplied-draft');
        active = id;
        var request = { id: id, status: 'proposed', baseRevision: current().id, baseSource: draft, epoch: draftEpoch };
        requests.set(id, request); return copy({ ok: true, id: id, baseRevision: request.baseRevision, baseSource: request.baseSource });
      },
      cancelRequest: function (id) {
        if (active !== id) return fail('stale-request');
        requests.set(id, { id: id, status: 'cancelled' }); active = null; return { ok: true };
      },
      validateProposal: function (proposal, constraints) {
        var request;
        try {
          proposal = copy(proposal);
          assert(proposal && typeof proposal.id === 'string', 'Missing proposal id');
          request = requests.get(proposal.id);
          if (!request || active !== proposal.id) return fail('stale-request');
          if (request.status !== 'proposed') return fail('duplicate-response');
          // A response is consumed even when malformed/invalid; retries require a new request id.
          request.status = 'invalid';
          assert(Object.keys(proposal).every(function (k) { return ['id', 'baseRevision', 'baseSource', 'edits'].indexOf(k) !== -1; }), 'Unknown proposal field');
          assert(current() && proposal.baseRevision === current().id && proposal.baseRevision === request.baseRevision &&
            proposal.baseSource === draft && draft === request.baseSource && request.epoch === draftEpoch, 'Stale proposal base');
          assert(Array.isArray(proposal.edits) && proposal.edits.length > 0 && proposal.edits.length <= LIMITS.edits, 'Invalid edit count');
          var edits = proposal.edits.slice().sort(function (a, b) { return a.from - b.from || a.to - b.to; });
          var end = -1, lastFrom = -1, text = '', pos = 0;
          edits.forEach(function (e) {
            assert(Object.keys(e).every(function (k) { return ['from', 'to', 'text'].indexOf(k) !== -1; }), 'Unknown edit field');
            assert(Number.isSafeInteger(e.from) && Number.isSafeInteger(e.to) && e.from >= 0 && e.to >= e.from && e.to <= draft.length &&
              e.from >= end && e.from !== lastFrom && sourceOK(e.text), 'Invalid/overlapping edit');
            text += draft.slice(pos, e.from) + e.text; pos = e.to; end = e.to; lastFrom = e.from;
            assert(text.length <= LIMITS.source, 'Source limit');
          });
          text += draft.slice(pos); assert(sourceOK(text), 'Source limit');
          var result = compile(text);
          if (!result.ok) return result;
          var diff = checkConstraints(current().compiled, result.compiled, constraints);
          request.status = 'ready'; request.source = text; request.compiled = result.compiled; request.diff = diff;
          return copy({ ok: true, id: proposal.id, source: text, compiled: result.compiled, diff: diff, status: 'ready' });
        } catch (e) { return fail('invalid-proposal', String(e.message || e)); }
      },
      applyProposal: function (id) {
        var request = requests.get(id);
        if (!request || active !== id || request.status !== 'ready') return fail('stale-request');
        if (!current() || request.baseRevision !== current().id || request.baseSource !== draft || request.epoch !== draftEpoch) return fail('stale-base');
        var result = install(request.source, request.compiled); request.status = 'applied';
        requests.set(id, { id: id, status: 'applied' }); result.diff = copy(request.diff); return result;
      },
      // Portable audiovisual composition data. The record key is optional, so a
      // record written here still restores on a build that predates it, and a
      // record written there still restores here. VERSION deliberately unchanged.
      setVisual: function (data) {
        if (data === null || data === undefined) { visualData = null; return { ok: true }; }
        if (typeof data !== 'object' || typeof data.scene !== 'string') return fail('invalid-visual');
        if (data.source !== undefined && (typeof data.source !== 'string' || data.source.length > 32768)) return fail('invalid-visual');
        if (data.values !== undefined && (typeof data.values !== 'object' || data.values === null || Array.isArray(data.values) ||
          !Object.keys(data.values).every(function (k) { return typeof data.values[k] === 'number' && Number.isFinite(data.values[k]); }))) return fail('invalid-visual');
        if (data.off !== undefined && typeof data.off !== 'boolean') return fail('invalid-visual');
        visualData = copy({ scene: data.scene, source: data.source || '', values: data.values || {} });
        if (data.off === true) visualData.off = true;
        return { ok: true };
      },
      serialize: function (opts) {
        var record = { format: FORMAT, version: VERSION, versions: versions, metadata: metadata,
          draft: draft, lastValid: current() ? { id: current().id, source: current().source } : null, revisionCounter: serial };
        if (opts && opts.includePrivate) record.private = privateData;
        // Visuals are portable, not private; a caller may still omit them to fit
        // a self-contained link budget.
        if (visualData && !(opts && opts.excludeVisual)) record.visual = visualData;
        var text = JSON.stringify(record); assert(text.length <= LIMITS.record, 'Project record limit'); return text;
      }
    };
    Object.defineProperties(project, {
      draft: { enumerable: true, get: function () { return draft; } },
      validated: { enumerable: true, get: function () { return copy(current()); } },
      pending: { enumerable: true, get: function () { return copy(pending); } },
      playing: { enumerable: true, get: function () { return playing; } },
      visual: { enumerable: true, get: function () { return copy(visualData); } }
    });
    if (options.visual) project.setVisual(options.visual);
    project.propose = project.validateProposal;
    var initial = compile(source); diagnostics = copy(initial.diagnostics);
    if (initial.ok) install(source, initial.compiled);
    // Private recovery entry point, not exposed on the project API.
    if (options._restore) {
      var saved = options._restore;
      if (saved.lastValid) {
        // This source compiled when it was saved, so a failure here is usually a
        // build difference -- a record written by a newer dialect opened on an
        // older build -- not broken music. Surface the compiler's own reason so
        // the message points at the build rather than blaming the source, and
        // say plainly that nothing was discarded.
        assert(current(), 'Saved validated source no longer compiles in this build' +
          (diagnostics && diagnostics[0] && diagnostics[0].message ? ' (' + diagnostics[0].message + ')' : '') +
          '. The saved project is unchanged.');
        current().id = saved.lastValid.id;
      }
      serial = saved.revisionCounter;
      draft = saved.draft; draftEpoch++;
      diagnostics = copy(compile(draft).diagnostics);
    }
    return project;
  }
  function restore(serialized, options) {
    try {
      assert(typeof serialized === 'string' && serialized.length <= LIMITS.record, 'Project record limit');
      var saved = copy(JSON.parse(serialized));
      assert(saved.format === FORMAT && saved.version === VERSION, 'Unsupported project format/version');
      assert(saved.versions && saved.metadata && sourceOK(saved.draft), 'Malformed project');
      assert(Number.isSafeInteger(saved.revisionCounter) && saved.revisionCounter >= 0, 'Invalid revision counter');
      assert(saved.lastValid === null || (saved.lastValid && sourceOK(saved.lastValid.source) && /^r[1-9][0-9]*$/.test(saved.lastValid.id) &&
        Number(saved.lastValid.id.slice(1)) <= saved.revisionCounter), 'Invalid validated revision');
      options = Object.assign({}, options || {});
      var language = root.CT_MUSIC_LANGUAGE;
      var expected = { language: options.languageVersion || (language && language.VERSION) || '1',
        compiler: options.compilerVersion || (language && language.COMPILER_VERSION) || '1', assets: options.assetsVersion || 'unspecified' };
      assert(equal(saved.versions, expected), 'Incompatible language/compiler/instrument assets versions');
      options.seeds = saved.metadata.seeds; options.assets = saved.metadata.assets;
      // An absent or malformed visual block never fails a music restore.
      options.visual = saved.visual || null;
      if (saved.private) { options.chat = saved.private.chat; options.provenance = saved.private.provenance; }
      options._restore = saved;
      var project = create(saved.lastValid ? saved.lastValid.source : saved.draft, options);
      return { ok: true, project: project };
    } catch (e) { return { ok: false, code: 'incompatible-project', message: String(e.message || e), original: serialized }; }
  }
  /* One setItem writes draft + valid source atomically. Baseline comparison detects
   * observed external writes. localStorage has no compare-and-swap: simultaneous
   * read/write races require host coordination (e.g. Web Locks), not a false CAS claim.
   * load first; a failed save never advances this adapter's baseline.
   */
  function createStorageAdapter(storage, key) {
    assert(storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function' && typeof key === 'string' && key.length, 'Invalid storage adapter');
    var baseline, loaded = false;
    return {
      load: function () {
        try { baseline = storage.getItem(key); loaded = true; return { ok: true, serialized: baseline }; }
        catch (e) { return fail('storage-error', String(e.message || e)); }
      },
      save: function (project, options) {
        if (!loaded) return fail('baseline-required');
        try {
          if (storage.getItem(key) !== baseline) return fail('storage-conflict');
          var serialized = project.serialize(options);
          if (serialized !== baseline) storage.setItem(key, serialized);
          if (storage.getItem(key) !== serialized) return fail('storage-conflict');
          baseline = serialized; return { ok: true };
        } catch (e) { return fail('storage-error', String(e.message || e)); }
      }
    };
  }
  return { FORMAT: FORMAT, VERSION: VERSION, LIMITS: copy(LIMITS), create: create, restore: restore,
    musicalDiff: musicalDiff, checkConstraints: checkConstraints, createStorageAdapter: createStorageAdapter };
});
