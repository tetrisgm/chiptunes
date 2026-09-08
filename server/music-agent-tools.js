'use strict';

// Host-neutral specs: the host converts inputSchema to its SDK's schema type,
// then calls server.registerTool(name, config, handler). No transport lives here.
// Each factory MUST receive closures bound to one already-authorized session.
// getContext() -> {generation, draftEpoch, baseRevision, source, ...public context};
// propose({id, generation, draftEpoch, baseRevision, edits, explanation}) -> public proposal result;
// getProposalStatus({id}) -> public status, with session-local ownership checks.
// propose must atomically check generation/draftEpoch/revision/source, compile, enforce host constraints
// and store a proposal, never apply it. Context is advisory, not a revision lock.
// Callbacks must return public JSON only (no credentials or internal errors).
// Adapter: getContext wraps readContext; propose forwards caller preconditions
// unchanged; status wraps status. Never refresh preconditions at submission.
// id is caller-selected replay evidence scoped by the host. Generation/epoch
// are untrusted compare-and-swap evidence, never authorization or session routing.
const LIMITS = Object.freeze({ source: 1048576, edits: 32, editBytes: 16384,
  explanation: 5000, responseBytes: 8388608 });
const HELP = 'Restricted music language v1 describes a finite Game Boy performance; it is not JavaScript. ' +
  'Use song({tempo:120,bars:4}), pattern("p",notes("C2 . G2 .").stepsPerBar(4).gate(0.7)), ' +
  'and track("bass").instrument("wave-bass").play("p",{atBar:0,repeat:4}). ' +
  'Pitches/rests may have step lengths and velocities (C4:2@0.5). ' +
  'Track channels: lead/pulse1, arp/pad/pulse2, bass/wave, drums/noise; aliases share hardware. ' +
  'Pattern methods: stepsPerBar, gate, velocity, transpose, register (sets octave). ' +
  'Exact mode uses song({totalFrames:120}) and event({ch:0,frame:0,frames:30,midi:60,inst:0}); ' +
  'supply instruments explicitly. Other calls: instruments, waves, performance, automation, vibratoOff, waveLoad, kit. ' +
  'No variables, expressions, loops, imports, arbitrary calls, assets, or generation. ' +
  'key is descriptive; exact events are not retimed by tempo metadata. ' +
  'Read context first; echo generation, draftEpoch and baseRevision unchanged, and supply a unique UUID-like proposal id. ' +
  'Submit ordered, nonoverlapping localized edits using zero-based UTF-16 offsets, end exclusive. ' +
  'Host validation and approval are required; proposing never means applied or playing. See docs/music-language.md.';

function need(ok) { if (!ok) throw new Error('Invalid data'); }
function record(value, fields, required = fields) {
  need(value !== null && typeof value === 'object' && !Array.isArray(value));
  need(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  const keys = Reflect.ownKeys(value);
  need(keys.every(k => typeof k === 'string' && fields.includes(k)));
  need(required.every(k => keys.includes(k)));
  for (const k of keys) {
    const d = Object.getOwnPropertyDescriptor(value, k);
    need(d.enumerable && Object.hasOwn(d, 'value'));
  }
}
function string(value, max) {
  need(typeof value === 'string' && value.length <= max);
  // Reject isolated surrogates, which UTF-8 encoding would silently replace.
  need(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value));
}
function id(value) { need(typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)); }
const proposalIdPattern = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
function proposalId(value) { need(typeof value === 'string' && value.length === 36 && new RegExp(proposalIdPattern).test(value)); }
function counter(value) { need(Number.isSafeInteger(value) && value >= 0); }
function boundary(source, n) {
  return !(n > 0 && n < source.length && /[\uD800-\uDBFF]/.test(source[n - 1]) && /[\uDC00-\uDFFF]/.test(source[n]));
}
function proposal(value) {
  record(value, ['id', 'generation', 'draftEpoch', 'baseRevision', 'edits', 'explanation'],
    ['id', 'generation', 'draftEpoch', 'baseRevision', 'edits']);
  proposalId(value.id); counter(value.generation); counter(value.draftEpoch);
  id(value.baseRevision);
  if (Object.hasOwn(value, 'explanation')) {
    string(value.explanation, LIMITS.explanation);
    need(Buffer.byteLength(value.explanation, 'utf8') <= LIMITS.explanation);
  }
  const a = value.edits;
  need(Array.isArray(a) && Object.getPrototypeOf(a) === Array.prototype && a.length > 0 && a.length <= LIMITS.edits);
  need(Reflect.ownKeys(a).length === a.length + 1);
  let end = 0, previous = -1, bytes = 0;
  const edits = [];
  for (let i = 0; i < a.length; i++) {
    const d = Object.getOwnPropertyDescriptor(a, String(i));
    need(d && Object.hasOwn(d, 'value'));
    const e = d.value;
    record(e, ['from', 'to', 'text']);
    need(Number.isSafeInteger(e.from) && Number.isSafeInteger(e.to) &&
      e.from >= end && e.from > previous && e.to >= e.from && e.to <= LIMITS.source);
    string(e.text, LIMITS.editBytes);
    bytes += Buffer.byteLength(e.text, 'utf8'); need(bytes <= LIMITS.editBytes);
    edits.push({ from: e.from, to: e.to, text: e.text });
    end = e.to; previous = e.from;
  }
  return { id: value.id, generation: value.generation, draftEpoch: value.draftEpoch,
    baseRevision: value.baseRevision, edits, explanation: value.explanation || '' };
}
function againstContext(p, context) {
  need(context && context.baseRevision === p.baseRevision &&
    context.generation === p.generation && context.draftEpoch === p.draftEpoch);
  string(context.source, LIMITS.source);
  const source = context.source;
  let removed = 0, end = 0, candidate = '';
  for (const e of p.edits) {
    need(e.to <= source.length && boundary(source, e.from) && boundary(source, e.to));
    removed += Buffer.byteLength(source.slice(e.from, e.to), 'utf8');
    need(removed <= LIMITS.editBytes);
    candidate += source.slice(end, e.from) + e.text; end = e.to;
  }
  candidate += source.slice(end);
  need(candidate.length <= LIMITS.source && candidate !== source && removed < Buffer.byteLength(source, 'utf8'));
}
// Validate and detach public callback data without invoking toJSON or accessors.
function publicCopy(value) {
  let nodes = 0, bytes = 0;
  function copy(v, depth) {
    need(++nodes <= 500000 && depth <= 32);
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'number') { need(Number.isFinite(v)); return v; }
    if (typeof v === 'string') {
      string(v, LIMITS.responseBytes); bytes += Buffer.byteLength(v); need(bytes <= LIMITS.responseBytes); return v;
    }
    if (Array.isArray(v)) {
      need(v.length <= 500000 && Reflect.ownKeys(v).length === v.length + 1);
      return Array.from({ length: v.length }, (_, i) => {
        const d = Object.getOwnPropertyDescriptor(v, String(i));
        need(d && Object.hasOwn(d, 'value')); return copy(d.value, depth + 1);
      });
    }
    const keys = v && typeof v === 'object' ? Reflect.ownKeys(v) : [];
    need(keys.every(k => typeof k === 'string' && !['__proto__', 'constructor', 'prototype'].includes(k)));
    record(v, keys);
    const out = {};
    for (const k of keys) { bytes += Buffer.byteLength(k); need(bytes <= LIMITS.responseBytes); out[k] = copy(v[k], depth + 1); }
    return out;
  }
  return copy(value, 0);
}
const objectSchema = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const idSchema = { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9_-]+$' };
const offsetSchema = { type: 'integer', minimum: 0, maximum: LIMITS.source };
const counterSchema = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const proposalIdSchema = { type: 'string', minLength: 36, maxLength: 36, pattern: proposalIdPattern };
function freeze(v) { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }

function createMusicAgentTools({ getContext, propose, getProposalStatus }) {
  if (![getContext, propose, getProposalStatus].every(f => typeof f === 'function')) throw new TypeError('Music session callbacks required');
  function tool(name, description, inputSchema, validate, run, readOnlyHint) {
    return freeze({ name, description, inputSchema, annotations: { readOnlyHint, destructiveHint: false, openWorldHint: false },
      handler: async function (input) {
        let args;
        try { args = validate(input); } catch (_) { return error('invalid_arguments'); }
        try {
          const data = publicCopy(await run(args));
          const text = JSON.stringify(data);
          need(Buffer.byteLength(text) <= LIMITS.responseBytes);
          return { content: [{ type: 'text', text }], isError: !!data && data.ok === false };
        } catch (_) { return error('music_tool_failed'); }
      } });
  }
  function error(code) { return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: code }) }] }; }
  const empty = v => { record(v, []); return {}; };
  return Object.freeze([
    tool('music_get_context', 'Read the trusted session music context.', objectSchema({}), empty, () => getContext(), true),
    tool('music_propose_edit', 'Propose localized source edits for host validation and approval; never applies or plays.',
      objectSchema({ id: proposalIdSchema, generation: counterSchema, draftEpoch: counterSchema,
        baseRevision: idSchema, edits: { type: 'array', minItems: 1, maxItems: LIMITS.edits,
        items: objectSchema({ from: offsetSchema, to: offsetSchema, text: { type: 'string', maxLength: LIMITS.editBytes } }) },
      explanation: { type: 'string', maxLength: LIMITS.explanation } }, ['id', 'generation', 'draftEpoch', 'baseRevision', 'edits']), proposal,
      async p => { againstContext(p, await getContext()); return propose(p); }, false),
    tool('music_get_proposal_status', 'Read a proposal status within the trusted session.', objectSchema({ id: idSchema }),
      v => { record(v, ['id']); id(v.id); return { id: v.id }; }, p => getProposalStatus(p), true),
    tool('music_get_help', 'Read restricted music language and proposal guidance.', objectSchema({}), empty, () => ({ languageVersion: '1', guidance: HELP }), true)
  ]);
}

module.exports = { createMusicAgentTools, LIMITS };
