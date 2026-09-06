// DOES THE LEGACY DECODER SURVIVE A HOSTILE FILE, AND STILL OPEN A REAL ONE?
//
// `decompress` is what every public `.lsdsng` import runs through
// (api.fromLsdsng -> parseLsdsng -> decompress). The native-document worker has
// a separate strictly canonical share decoder; this file is about the OTHER one,
// the codec that real foreign files still arrive on. The old version could loop
// forever on a cyclic block jump and silently zero-pad a truncated or short
// stream (HANDOFF 2026-09-05, item 2). Both halves of the contract matter:
//
//   * cyclic / truncated / short / overrunning / out-of-range / bad-base input
//     must TERMINATE and be REJECTED -- the exact 32768-byte-plus-EOF shape our
//     compressor and liblsdj emit is the only complete song, and a padded or
//     sliced approximation is corruption, not a song;
//   * a VALID but noncontiguous or backward-but-acyclic full-length layout must
//     still be accepted UNCHANGED. A jump is not wrong for going backward, for
//     skipping a block number, or for not matching our own block+1 output.
//     Requiring a foreign file to recompress to our layout would be the bug.
//
// The self-cycle is run in a child process under a wall-clock timeout: if the
// bound ever regresses to an infinite loop, that child is killed and the test
// fails, rather than hanging this whole suite.
'use strict';
const path = require('path');
const cp = require('child_process');
const api = require(path.join(__dirname, '..', 'src', 'api.js'));
const L = require(path.join(__dirname, '..', 'src', 'lsdj.js'));
const LSDJ_PATH = path.join(__dirname, '..', 'src', 'lsdj.js');

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fail++; };
const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
function throws(fn, re, m) {
  let threw = false, msg = '';
  try { fn(); } catch (e) { threw = true; msg = e.message; }
  ok(threw && re.test(msg), m + (threw ? ' (' + msg + ')' : ' -- did NOT throw'));
}

// The control bytes and block size, tied to src/lsdj.js. BLOCK_COUNT (191) is
// the block-number ceiling, so it is also the largest legal base. Not exported;
// named here and kept honest by the real-song round trip at the bottom.
const RLE = 0xC0, SA = 0xE0, DEF_WAVE = 0xF0, EOF = 0xFF, BLOCK = 0x200, BLOCK_COUNT = 191;
const SONG = L.SONG_BYTES;

/* ---- an infinite-loop stream terminates (proven under a timeout) ---- */
console.log('a cyclic jump terminates and is rejected, proven in a child process');
{
  const child =
    'const L=require(' + JSON.stringify(LSDJ_PATH) + ');' +
    'try{L.decompress(Uint8Array.from([0xE0,0x01]),1);console.log("RETURNED");}' +
    'catch(e){console.log("THREW:"+e.message);}';
  let stdout = '', timedOut = false;
  try {
    stdout = cp.execFileSync(process.execPath, ['-e', child], { timeout: 5000, encoding: 'utf8' });
  } catch (e) {
    if (e.killed || e.signal === 'SIGTERM' || /ETIMEDOUT/.test(String(e.code))) timedOut = true;
    stdout = e.stdout ? e.stdout.toString() : '';
  }
  ok(!timedOut && /THREW:.*cyclic/.test(stdout),
     'a self-referential jump [E0 01] is rejected within a 5s timeout' +
     (timedOut ? ' -- TIMED OUT (the hang regressed)' : ' (' + stdout.trim() + ')'));
}

/* ---- the remaining hostile shapes reject fast, in process ---- */
console.log('hostile block jumps are rejected');
{
  // A -> B -> A: caught at once because the entry block (offset 0) is seeded.
  const two = new Uint8Array(2 * BLOCK);
  two[0] = SA; two[1] = 2; two[BLOCK] = SA; two[BLOCK + 1] = 1;
  throws(() => L.decompress(two, 1), /cyclic/, 'a two-block A->B->A jump cycle is rejected');
  // A jump straight back to the entry block, from a later position.
  throws(() => L.decompress(Uint8Array.of(0x11, SA, 1), 1), /cyclic/,
         'a jump back to the entry block is rejected immediately');
  // Off the end of the buffer, and below the base.
  throws(() => L.decompress(Uint8Array.of(SA, 200), 1), /out of range/, 'a jump past the buffer end is rejected');
  throws(() => L.decompress(Uint8Array.of(SA, 1), 2), /out of range/, 'a jump to a block below the base is rejected');
}

console.log('truncated, short, full-without-EOF and overrunning streams are rejected');
{
  // Missing operands.
  throws(() => L.decompress(Uint8Array.of(RLE), 1), /truncated/, 'an RLE marker with no value is rejected');
  throws(() => L.decompress(Uint8Array.of(RLE, 5), 1), /truncated/, 'an RLE value with no count is rejected');
  throws(() => L.decompress(Uint8Array.of(SA), 1), /truncated/, 'a special-action byte with no operand is rejected');
  throws(() => L.decompress(Uint8Array.of(SA, DEF_WAVE), 1), /truncated/, 'a default-wave run with no count is rejected');
  // early EOF: an EOF before the song is full.
  throws(() => L.decompress(Uint8Array.of(0x11, 0x22, SA, EOF), 1), /ended at \d+ of/,
         'an EOF before the song is full is rejected, not zero-padded');
  // full output WITHOUT EOF: exactly 32768 bytes then the stream just stops.
  const noEof = [];
  for (let r = 0; r < 128; r++) noEof.push(RLE, 0, 255);   // 32640
  noEof.push(RLE, 0, 128);                                 // + 128 = 32768, no EOF
  throws(() => L.decompress(Uint8Array.from(noEof), 1), /truncated/,
         'exactly 32768 bytes with no EOF marker is rejected');
  // overrun via an RLE run, and via a default-wave run.
  const rleOver = [];
  for (let r = 0; r < 129; r++) rleOver.push(RLE, 0, 255);  // 32895 > 32768
  throws(() => L.decompress(Uint8Array.from(rleOver), 1), /overrun/,
         'an RLE run that overruns the song image is rejected, not sliced');
  const waveOver = [];
  for (let r = 0; r < 9; r++) waveOver.push(SA, DEF_WAVE, 255);   // 9 * 4080 > 32768
  throws(() => L.decompress(Uint8Array.from(waveOver), 1), /overrun/,
         'a default-wave run that overruns the song image is rejected');
}

console.log('an invalid base is rejected');
{
  const okBytes = Uint8Array.of(SA, EOF);
  throws(() => L.decompress(okBytes, 0), /base/, 'base 0 is rejected');
  throws(() => L.decompress(okBytes, -1), /base/, 'a negative base is rejected');
  throws(() => L.decompress(okBytes, BLOCK_COUNT + 1), /base/, 'a base past the block count is rejected');
  throws(() => L.decompress(okBytes, 1.5), /base/, 'a non-integer base is rejected');
  throws(() => L.decompress(okBytes, NaN), /base/, 'a NaN base is rejected');
}

/* ---- a full-length valid noncontiguous / backward-but-acyclic layout ---- */
// Physical block 1 -> block 3 -> back to block 2 -> EOF: a backward and
// non-adjacent chain that decodes to a full 32768-byte song and ends on an EOF
// reached AFTER a jump. This is exactly the shape a .sav's absolute, scattered
// jumps produce, and precisely what our own compressor would NEVER emit.
console.log('a full-length noncontiguous, backward-but-acyclic layout still decodes');
{
  const buf = new Uint8Array(3 * BLOCK);
  let p = 0;                                        // block 1 (entry, offset 0)
  for (let r = 0; r < 40; r++) { buf[p++] = RLE; buf[p++] = 0; buf[p++] = 255; }   // 10200
  buf[p++] = SA; buf[p++] = 3;                      // -> block 3 (offset 1024)
  p = 2 * BLOCK;                                    // block 3
  for (let r = 0; r < 40; r++) { buf[p++] = RLE; buf[p++] = 0; buf[p++] = 255; }   // 20400
  buf[p++] = SA; buf[p++] = 2;                      // -> block 2 (offset 512), backward
  p = 1 * BLOCK;                                    // block 2
  for (let r = 0; r < 48; r++) { buf[p++] = RLE; buf[p++] = 0; buf[p++] = 255; }   // 32640
  buf[p++] = RLE; buf[p++] = 0; buf[p++] = 128;     // 32768
  buf[p++] = SA; buf[p++] = EOF;                    // EOF, post-jump

  let decoded = null;
  try { decoded = L.decompress(buf, 1); } catch (e) { /* surfaced by ok below */ }
  ok(decoded && decoded.length === SONG && decoded.every(v => v === 0),
     'it decodes to the exact 32768-byte song, following the backward jumps in order');
  ok(decoded && !eq(L.compress(decoded, 1), buf),
     'and it was accepted despite not matching our compressor\'s own block layout (no recompression required)');
}

/* ---- existing valid streams are unchanged ---- */
console.log('the empty song and a real high-entropy song are unaffected');
{
  let empty = null;
  try { empty = L.emptySong(); } catch (e) { /* a throw here is a FAIL, not a crash */ }
  ok(empty && empty.length === SONG, 'the empty song still decodes to a full image');
  if (empty) ok(eq(L.decompress(L.compress(empty, 1)), empty), 'and it survives our own compress/decompress');

  // A deterministic, note-dense song: its compressed form spans many blocks, so
  // the multi-jump path is exercised on real data, not a fixture of zeros.
  const doc = api.brief({ scene: 'battle', seconds: 30, token: '7f3a12bc55de90aa' }).doc;
  const img = L.fromDocument(doc).bytes;
  const body = L.compress(img, 1);
  ok(img.length === SONG, 'a generated song is a full image (' + img.length + ')');
  ok(body.length > BLOCK, 'and compresses to multiple blocks, so jumps are exercised (' + body.length + ')');
  ok(eq(L.decompress(body), img), 'a real high-entropy song round-trips exactly through the bounded decoder');

  // The file entry points inherit the same bounds.
  const file = new Uint8Array(9 + body.length);
  file.set(Uint8Array.of(0x54, 0x45, 0x53, 0x54), 0);         // "TEST"
  file.set(body, 9);
  const parsed = L.parseLsdsng(file);
  ok(parsed.name === 'TEST' && eq(parsed.song, img), 'parseLsdsng reads a valid multi-block file back unchanged');

  const evil = new Uint8Array(11);
  evil[9] = SA; evil[10] = 1;                                 // cyclic body behind a header
  throws(() => L.parseLsdsng(evil), /cyclic/, 'parseLsdsng rejects a cyclic body instead of hanging');

  throws(() => L.parseSav(new Uint8Array(100)), /not a \.sav/, 'parseSav rejects an undersized image');
  const sav = new Uint8Array(L.SAV_SIZE); sav[0] = 0x5A;
  const psav = L.parseSav(sav);
  ok(psav.song.length === SONG && psav.song[0] === 0x5A,
     'parseSav copies the working-memory song with a fixed bound');
}

console.log(fail ? '\nverify-lsdj-parser-bounds: ' + fail + ' FAILED'
                 : '\nverify-lsdj-parser-bounds: the legacy decoder is bounded and complete');
process.exit(fail ? 1 : 0);
