#!/usr/bin/env node
// THE NATIVE AUTHORING DOCUMENT, ON ITS OWN. Smallest independently testable
// slice of the native import/export rework: validated slot access, atomic
// bounded-history edits, a hostile-input-safe versioned share that stays
// self-readable for ANY valid edit, and an HONEST refusal to claim playback.
// Depends only on src/lsdj.js.
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const LSDJ = require(path.join(ROOT, 'src', 'lsdj.js'));
const { NativeDocument, fnv1a } = require(path.join(ROOT, 'src', 'lsdj-native-document.js'));

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fail++; };
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const threw = (fn) => { try { fn(); return false; } catch (e) { return true; } };
const O = LSDJ.OFFSETS, SONG = LSDJ.SONG_BYTES, MAX_SHARE_CHARS = 262144;   // mirrors the module bound
const KNOWN_UNMAPPED = 0x1700;
const isMapped = (off) => LSDJ.FIELDS.some(f => { const s = (f.n === 1 && f.w === 1) ? 1 : f.n * f.w; return off >= f.at && off < f.at + s; });
function baseImage() { const img = Uint8Array.from(LSDJ.emptySong()); img[KNOWN_UNMAPPED] = 0xAB; return img; }
// Deterministic byte PRNG (mulberry32-derived) for high-entropy song images.
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) & 0xFF; }; }
function randomSong(seed) { const r = rng(seed), a = new Uint8Array(SONG); for (let i = 0; i < SONG; i++) a[i] = r(); return a; }

ok(!isMapped(KNOWN_UNMAPPED), 'the sentinel offset is genuinely unmapped by the field table');

// 1. round trip, dirty tracking, unmapped preservation
{
  const base = baseImage(), doc = NativeDocument.fromSong(base);
  ok(same(doc.toSong(), base), 'no-edit export is byte-identical to the input image');
  ok(doc.dirtyFields().length === 0, 'a fresh document reports no dirty fields');
  doc.setPhraseNote(3, 4, 0x2A).setTempo(120).setInstrumentByte(1, 7, 0xC0);
  ok(doc.toSong()[KNOWN_UNMAPPED] === 0xAB, 'a byte no field owns survives arbitrary edits verbatim');
}

// 2. exhaustive per-field one-byte edit at the FINAL valid index/offset
{
  let allExact = true, details = '';
  for (const f of LSDJ.FIELDS) {
    const base = baseImage(), doc = NativeDocument.fromSong(base);
    let i, j, off;
    if (f.n === 1 && f.w === 1) { i = 0; j = 0; off = f.at; }
    else if (f.n === 1) { i = 0; j = f.w - 1; off = f.at + (f.w - 1); }
    else { i = f.n - 1; j = f.w - 1; off = f.at + (f.n - 1) * f.w + (f.w - 1); }
    const val = base[off] ^ 0xFF;
    doc.setFieldByte(f.k, i, j, val);
    const out = doc.toSong();
    let diffs = 0, wrongPlace = false;
    for (let k = 0; k < SONG; k++) if (out[k] !== base[k]) { diffs++; if (k !== off) wrongPlace = true; }
    if (!(diffs === 1 && !wrongPlace && out[off] === val)) { allExact = false; details = f.k; break; }
  }
  ok(allExact, 'every mapped field edits exactly its final byte and nothing else' + (allExact ? '' : ' (failed at ' + details + ')'));
}

// 3. copy isolation
{
  const doc = NativeDocument.fromSong(baseImage());
  doc.setPhraseNote(0, 0, 0x11).setInstrumentAllocByte(0, 0x11);
  const row = doc.fieldRow('phraseNotes', 0); row[0] = 0x7F;
  ok(doc.fieldRow('phraseNotes', 0)[0] === 0x11, 'mutating a returned row copy does not touch the model');
  const ph = doc.phrase(0); ph.notes[0] = 0x7E;
  ok(doc.phrase(0).notes[0] === 0x11, 'mutating a returned phrase copy does not touch the model');
}

// 4. invalid inputs rejected, no bogus history
{
  const doc = NativeDocument.fromSong(baseImage());
  ok(threw(() => doc.setFieldByte('nope', 0, 0, 0)), 'unknown field key throws');
  ok(threw(() => doc.setPhraseNote(0, 16, 0)), 'row offset out of range throws');
  ok(threw(() => doc.setPhraseNote(255, 0, 0)), 'row index out of range throws');
  ok(threw(() => doc.setPhraseNote(0, 0, 256)), 'byte value > 255 throws');
  ok(threw(() => doc.setPhraseNote(0, 0, 1.5)), 'non-integer byte throws');
  ok(threw(() => doc.setFieldByte('tempo', 1, 0, 0)), 'a nonzero scalar index throws');
  ok(threw(() => doc.setSequence(0, 4, 0)), 'sequence channel out of range throws');
  ok(doc.undoDepth() === 0, 'no rejected edit left any history behind');
}

// 5. atomic rollback, single-entry multiwrite undo, no-op coalescing
{
  const base = baseImage(), doc = NativeDocument.fromSong(base);
  ok(threw(() => doc.setPhraseRow(0, 0, { note: 5, instrument: 256 })), 'an invalid field aborts the whole row edit');
  ok(same(doc.toSong(), base) && doc.undoDepth() === 0, 'the aborted row edit mutated nothing and recorded nothing');
  doc.setPhraseRow(0, 0, { note: 5, instrument: 2, command: 1, value: 3 });
  ok(doc.undoDepth() === 1, 'a four-field row edit is a single undo entry');
  ok(doc.undo() && same(doc.toSong(), base), 'undoing it reverts all four bytes back to base, not an intermediate');
  doc.setPhraseNote(0, 0, 7); const depth = doc.undoDepth(); doc.setPhraseNote(0, 0, 7);
  ok(doc.undoDepth() === depth, 'writing the same value records no history entry');
}

// 6. bounded history & redo invalidation
{
  const doc = NativeDocument.fromSong(baseImage(), { historyLimit: 3 });
  for (let i = 0; i < 5; i++) doc.setPhraseNote(i, 0, 0x20 + i);
  ok(doc.undoDepth() === 3, 'history is bounded to the configured limit');
  ok(doc.undo() && doc.undo() && doc.undo() && !doc.undo(), 'only the retained edits undo; the dropped ones cannot');
  const out = doc.toSong();
  ok(out[O.PHRASE_NOTES] === 0x20 && out[O.PHRASE_NOTES + 16] === 0x21, 'edits past the bound stay applied');
  const d2 = NativeDocument.fromSong(baseImage());
  d2.setPhraseNote(0, 0, 1); d2.undo(); d2.setPhraseNote(0, 0, 2);
  ok(!d2.redo(), 'a new edit clears the redo stack');
}

// 7. diff / applyDiff strictness
{
  const base = baseImage(), doc = NativeDocument.fromSong(base);
  doc.setPhraseNote(7, 7, 0x11).setChainTranspose(0, 0, 0x0C);
  const d = doc.diff();
  ok(same(NativeDocument.applyDiff(base, d), doc.toSong()), 'applyDiff reproduces the edited image');
  const wrong = Uint8Array.from(base); wrong[0] ^= 0xFF;
  ok(threw(() => NativeDocument.applyDiff(wrong, d)), 'applyDiff rejects a base whose hash does not match');
  ok(threw(() => NativeDocument.applyDiff(base, { runs: d.runs })), 'applyDiff rejects a diff with no base hash');
  ok(threw(() => NativeDocument.applyDiff(base, { base: d.base, runs: [{ o: 10, d: [1, 2, 3] }, { o: 12, d: [9] }] })), 'applyDiff rejects overlapping runs');
  ok(threw(() => NativeDocument.applyDiff(base, { base: d.base, runs: [{ o: 10, d: [1] }, { o: 11, d: [2] }] })), 'applyDiff rejects adjacent (non-canonical) runs');
  ok(threw(() => NativeDocument.applyDiff(base, { base: d.base, runs: [{ o: 5, d: [] }] })), 'applyDiff rejects an empty run');
  ok(threw(() => NativeDocument.applyDiff(base, { base: d.base, runs: [{ o: SONG - 1, d: [1, 2] }] })), 'applyDiff rejects an out-of-bounds run');
}

// 8. share serialization: versioning, integrity, hostile/corrupt/looping input
{
  const base = baseImage(), doc = NativeDocument.fromSong(base, { title: 'HELLO' });
  doc.setPhraseNote(2, 2, 0x33);
  ok(same(NativeDocument.deserialize(doc.serialize(), base).toSong(), doc.toSong()), 'a small edit serializes to a compact diff that round-trips against its base');
  ok(same(NativeDocument.deserialize(doc.serializeFull()).toSong(), doc.toSong()), 'full share round-trips standalone');
  ok(threw(() => NativeDocument.deserialize(JSON.stringify({ v: 'nd0', mode: 'diff', diff: doc.diff() }), base)), 'unknown share version is rejected');
  ok(threw(() => NativeDocument.deserialize(JSON.stringify({ v: 'nd1', mode: 'sideways' }))), 'unknown share mode is rejected');
  ok(threw(() => NativeDocument.deserialize(JSON.stringify({ v: 'nd1', mode: 'diff', title: '', diff: doc.diff() }))), 'a diff share without its base is rejected');
  ok(threw(() => NativeDocument.deserialize(JSON.stringify({ v: 'nd1', mode: 'full', song: 'AAAA' }))), 'a full share with no hash is rejected');
  // corrupt a content byte -> integrity check fires
  const full = JSON.parse(doc.serializeFull());
  full.song = (full.song[0] === 'A' ? 'B' : 'A') + full.song.slice(1);
  ok(threw(() => NativeDocument.deserialize(JSON.stringify(full))), 'a corrupted full share fails validation');
  // tamper a trailing (padding) byte but keep the hash -> recompression equality fires
  const tam = JSON.parse(doc.serializeFull());
  const enc = Buffer.from(tam.song, 'base64'); enc[enc.length - 1] ^= 0xFF;
  tam.song = enc.toString('base64');
  ok(threw(() => NativeDocument.deserialize(JSON.stringify(tam))), 'padding tampering fails the canonical recompression check');
  // noncanonical / truncated / hostile base64
  const nc = JSON.parse(doc.serializeFull()); nc.song = 'A' + nc.song;
  ok(threw(() => NativeDocument.deserialize(JSON.stringify(nc))), 'noncanonical base64 length/content is rejected');
  const tr = JSON.parse(doc.serializeFull()); tr.song = tr.song.slice(0, -1);
  ok(threw(() => NativeDocument.deserialize(JSON.stringify(tr))), 'a truncated full share is rejected at decode');
  const huge = JSON.stringify({ v: 'nd1', mode: 'full', hash: '00000000', song: 'A'.repeat(400000) });
  ok(threw(() => NativeDocument.deserialize(huge)), 'a hostile huge share is rejected before decoding');
  // self/backward block jump and all-padding block must fail BOUNDED (not hang)
  const blk = Buffer.alloc(512); blk[0] = 0xE0; blk[1] = 0x01;   // SA -> block 1 (self)
  ok(threw(() => NativeDocument.deserialize(JSON.stringify({ v: 'nd1', mode: 'full', hash: '00000000', song: blk.toString('base64') }))), 'a self/backward block jump fails in bounded time');
  const zeroBlk = JSON.stringify({ v: 'nd1', mode: 'full', hash: fnv1a(new Uint8Array(SONG)), song: Buffer.alloc(512).toString('base64') });
  ok(threw(() => NativeDocument.deserialize(zeroBlk)), 'an all-padding block cannot masquerade as a zero song');
}

// 9. high-entropy & worst-case full shares round-trip exactly
{
  let allRt = true, at = -1;
  for (let s = 0; s < 12; s++) {
    const song = randomSong(s), doc = NativeDocument.fromSong(song, { title: 'RND' + s });
    if (!same(NativeDocument.deserialize(doc.serializeFull()).toSong(), song)) { allRt = false; at = s; break; }
  }
  ok(allRt, '12 deterministic high-entropy full shares round-trip exactly' + (allRt ? '' : ' (failed at seed ' + at + ')'));
  const worst = new Uint8Array(SONG); for (let i = 0; i < SONG; i++) worst[i] = (i & 1) ? 0xE0 : 0xC0;
  const wdoc = NativeDocument.fromSong(worst);
  const wShare = JSON.parse(wdoc.serializeFull());
  ok(Buffer.from(wShare.song, 'base64').length > 512, 'alternating C0/E0 worst-case escaping produces a multi-block stream');
  ok(same(NativeDocument.deserialize(wdoc.serializeFull()).toSong(), worst), 'the worst-case-escaping full share round-trips exactly');
  const zeros = new Uint8Array(SONG);
  ok(same(NativeDocument.deserialize(NativeDocument.fromSong(zeros, { title: 'Z' }).serializeFull()).toSong(), zeros), 'an all-zeros song survives a full-share round trip');
  const maxTitle = 'T'.repeat(64);
  ok(NativeDocument.deserialize(NativeDocument.fromSong(baseImage(), { title: maxTitle }).serializeFull()).title() === maxTitle, 'a maximal 64-char title survives a full-share round trip');
  ok(threw(() => NativeDocument.fromSong(baseImage(), { title: 'T'.repeat(65) })), 'a 65-char title is rejected');
}

// 10. a whole-song edit still serializes to a self-readable share (full fallback)
{
  const base = baseImage(), doc = NativeDocument.fromSong(base);
  for (const f of LSDJ.FIELDS) {
    if (f.n === 1 && f.w === 1) { if (f.at % 2 === 0) doc.setFieldByte(f.k, 0, 0, base[f.at] ^ 0xFF); continue; }
    for (let i = 0; i < f.n; i++) for (let j = 0; j < f.w; j++) {
      const off = f.at + i * f.w + j;
      if (off % 2 === 0) doc.setFieldByte(f.k, f.n === 1 ? 0 : i, j, base[off] ^ 0xFF);
    }
  }
  const share = doc.serialize();
  ok(share.length <= MAX_SHARE_CHARS, 'a whole-song (every-even-byte) edit still serializes within the share size bound');
  ok(JSON.parse(share).mode === 'full', 'the oversized diff transparently falls back to a full share');
  ok(same(NativeDocument.deserialize(share, base).toSong(), doc.toSong()), 'every-even-mapped-byte edit serialize()/deserialize() is exact identity');
}

// 11. constructor input validation
{
  ok(threw(() => NativeDocument.fromSong(LSDJ.emptySong().subarray(0, 100))), 'a short image is rejected');
  ok(threw(() => NativeDocument.fromSong(new Uint8Array(131072))), 'a .sav-sized buffer is rejected (parse upstream)');
  ok(threw(() => NativeDocument.fromSong([...LSDJ.emptySong()])), 'a plain array is rejected');
  ok(threw(() => NativeDocument.fromSong(baseImage(), { title: 123 })), 'a non-string title is rejected');
}

// 12. FIELD snapshot is immune to external descriptor mutation
{
  const base = baseImage(), doc = NativeDocument.fromSong(base);
  const f = LSDJ.FIELDS.find(x => x.k === 'phraseNotes'), origAt = f.at;
  try {
    f.at = origAt + 32;                     // move the exported descriptor out from under the doc
    doc.setPhraseNote(0, 0, 0x5A);
    const out = doc.toSong();
    ok(out[origAt] === 0x5A && out[origAt + 32] === base[origAt + 32],
       'a document writes at its frozen field snapshot, not a mutated external descriptor');
  } finally {
    f.at = origAt;                          // restore for any later consumer
  }
}

// 13. honest inventory & playback status; private state
{
  const doc = NativeDocument.fromSong(baseImage());
  const before = doc.inventory().allocatedInstrumentSlots;
  doc.setInstrumentAllocByte(5, 3);
  ok(doc.inventory().allocatedInstrumentSlots === before + 1, 'a per-slot alloc byte of value 3 counts as one slot, not two');
  const ps = doc.playbackStatus();
  ok(ps.available === false && ps.verified === false, 'playbackStatus reports playback unavailable and unverified');
  ok(typeof doc.capabilities === 'undefined' && typeof doc.playbackReport === 'undefined', 'no capability classifier or support-promotion exists');
  ok(typeof doc._commit === 'undefined', 'the commit path is private, not a public method');
  ok(threw(() => { doc.hack = 1; }), 'the frozen instance rejects new public properties (state stays private)');
}

console.log(fail ? ('\n' + fail + ' check(s) failed') : '\nlsdj-native-document: all checks passed');
process.exit(fail ? 1 : 0);
