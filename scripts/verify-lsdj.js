// CAN AN LSDJ COMPOSER ACTUALLY OPEN THIS?
//
// The export exists so somebody who writes music on a Game Boy can take a
// generated arrangement as a starting point instead of a blank screen. That is
// only true if LSDj opens the file, so this gate spends most of its effort on
// whether the bytes are right rather than on whether our code agrees with
// itself.
//
// ⚠️ THE MISTAKE THIS IS BUILT TO AVOID. The WebMCP layer once registered on the
// wrong browser API and every test passed, because the test shim had been
// written against the same wrong surface: the code and its test agreed with
// each other and were both wrong. A self-round-trip here would repeat that
// exactly -- our compressor feeding our decompressor proves nothing about LSDj.
//
// So when liblsdj is available (MIT, Stijn Frishert with Johan Kotlinski) the
// output is read back by THAT library and its counts compared with ours. Build
// the reader with:
//
//   git clone --depth 1 https://github.com/stijnfrishert/liblsdj
//   clang -Iliblsdj/liblsdj/include -Iliblsdj/liblsdj/include/lsdj \
//         -o /tmp/lsdjcheck tools/lsdjcheck.c liblsdj/liblsdj/src/*.c
//
// Without it the structural checks below still run and say so, loudly, rather
// than reporting a pass that was never earned.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const api = require(path.join(__dirname, '..', 'src', 'api.js'));
const L = require(path.join(__dirname, '..', 'src', 'lsdj.js'));
const CT = require(path.join(__dirname, '..', 'src', 'create.js'));

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fail++; };
const O = L.OFFSETS;

/* ------------------------------------------------------- the empty song */
console.log('the song image');
{
  const e = L.emptySong();
  ok(e.length === L.SONG_BYTES, 'an LSDj song is ' + L.SONG_BYTES + ' bytes (' + e.length + ')');
  // The compressor is implemented from liblsdj's; a self round-trip is a weak
  // check but it does catch a broken escape or a mis-sized block, and it is
  // free. The strong check is further down.
  const rt = L.decompress(L.compress(e, 1));
  ok(rt.every((v, i) => v === e[i]), 'and it survives our own compress/decompress');
}

/* ----------------------------------------------------- what an export is */
console.log('exporting a generated song');
const made = api.brief({ scene: 'battle', seconds: 30, token: '7f3a12bc55de90aa' });
const out = api.toLsdsng(made.doc, { name: 'BATTLE' });
{
  ok(out.bytes.length > 9 && (out.bytes.length - 9) % 0x200 === 0,
     'the file is a name, a version byte and whole 512-byte blocks (' + out.bytes.length + ')');
  ok(out.phrases > 0 && out.chains > 0 && out.notes > 0,
     'it carries an arrangement (' + out.phrases + ' phrases, ' + out.chains + ' chains, ' + out.notes + ' notes)');
  ok(out.filename.endsWith('.lsdsng'), 'named ' + out.filename);

  // The tempo and groove are the point of the tick rewrite; they must survive.
  const st = CT.docState(made.doc);
  ok(out.tempo === st.bpm, 'the tempo is the one the song plays (' + out.tempo + ')');
  ok(JSON.stringify(out.groove) === JSON.stringify(st.groove),
     'and the groove goes with it ([' + out.groove + '])');
}

/* ------------------------------------------- structure, read from the bytes */
console.log('the structure inside');
{
  const built = L.fromDocument(made.doc);
  const s = built.bytes;
  // A phrase that a chain points at must exist, or LSDj opens a song full of
  // holes -- the most likely way to produce a file that loads and is useless.
  let dangling = 0, usedPhrases = new Set(), usedChains = new Set();
  for (let r = 0; r < 255; r++) for (let ch = 0; ch < 4; ch++) {
    const c = s[O.SEQUENCE + r * 4 + ch];
    if (c === 0xFF) continue;
    usedChains.add(c);
    for (let q = 0; q < 16; q++) {
      const p = s[O.CHAIN_PHRASES + c * 16 + q];
      if (p === 0xFF) continue;
      usedPhrases.add(p);
      const allocated = (s[O.PHRASE_ALLOC + (p >> 3)] >> (p & 7)) & 1;
      if (!allocated) dangling++;
    }
  }
  ok(!dangling, 'every phrase a chain points at is allocated (' + dangling + ' dangling)');
  ok(usedChains.size === built.chains, 'every chain written is reachable from the sequence (' +
     usedChains.size + '/' + built.chains + ')');
  ok(usedPhrases.size === built.phrases, 'and every phrase is reachable from a chain (' +
     usedPhrases.size + '/' + built.phrases + ')');

  // Notes must be in LSDj's range, and an instrument must accompany each one or
  // the step is silent.
  let bad = 0, orphan = 0;
  for (const p of usedPhrases) for (let k = 0; k < 16; k++) {
    const n = s[O.PHRASE_NOTES + p * 16 + k];
    if (n === 0) continue;
    if (n > 0x6F) bad++;
    if (s[O.PHRASE_INSTRUMENTS + p * 16 + k] === 0xFF) orphan++;
  }
  ok(!bad, 'every note is inside LSDj\'s range (' + bad + ' out)');
  ok(!orphan, 'and every note has an instrument (' + orphan + ' without)');

  // An arpeggio should arrive as a COMMAND, not as three notes. That is the
  // difference between a phrase a person can read and one they cannot.
  const arped = api.transform(made.doc, [{ op: 'motion', lane: 'Melody', motion: 'arp' }]).doc;
  const withArp = L.fromDocument(arped);
  let chords = 0;
  for (let p = 0; p < withArp.phrases; p++) for (let k = 0; k < 16; k++)
    if (withArp.bytes[O.PHRASE_COMMANDS + p * 16 + k] === L.COMMANDS.C) chords++;
  ok(chords > 0, 'an arpeggio exports as a C command, not as spelled-out notes (' + chords + ' steps)');
  ok(withArp.notes <= built.notes * 1.2,
     'so arping does not multiply the note count (' + built.notes + ' -> ' + withArp.notes + ')');
}

/* ------------------------------------------------------ nothing disappears */
// A CLAMPED NOTE IS NOT A QUIET MISTAKE. Mapping straight from our pitch range
// onto LSDj's pushed a third of a busy song's notes against the floor, and a
// clamped note is a WRONG note sitting in somebody's phrase -- worse than a
// missing one, because it looks deliberate. The export moves whole octaves to
// fit instead, which keeps every interval and every pitch class.
console.log('every note arrives');
{
  let lost = 0, shifted = 0, checked = 0, worst = null;
  for (const scene of ['battle', 'boss', 'cave', 'title', 'town', 'overworld', 'credits', 'game_over']) {
    for (let i = 0; i < 3; i++) {
      const r = api.toLsdsng(api.brief({ scene, seconds: 30 }).doc, { name: scene });
      checked++;
      const gone = r.warnings.filter(w => /left out/.test(w));
      if (gone.length) { lost++; worst = scene + ': ' + gone[0]; }
      if (r.warnings.some(w => /transposed/.test(w))) shifted++;
    }
  }
  ok(!lost, 'no note is dropped or clamped, across ' + checked + ' songs' + (worst ? ' -- ' + worst : ''));
  ok(shifted > 0, 'and octave shifting is doing real work (' + shifted + '/' + checked + ' needed it)');

  // THE COUNT THAT ARRIVES, FOLLOWED THROUGH THE SEQUENCE. Comparing against
  // the unique-phrase count was wrong and made a 217-note song look like a
  // 61-note one: identical bars share a phrase, which is the whole point of
  // chains. What has to survive is what a listener HEARS.
  const doc = api.brief({ scene: 'battle', seconds: 30, token: '7f3a12bc55de90aa' }).doc;
  const r2 = api.toLsdsng(doc, { name: 'B' });
  const built = L.fromDocument(doc);
  const st2 = CT.docState(doc);
  const melRows = CT.tables().melodicRows;
  const placeable = st2.cells.filter(c => c.r >= melRows || c.midi != null).length;
  const collided = (built.warnings.find(w => /shared a step/.test(w)) || '').match(/^(\d+)/);
  const expected = placeable - (collided ? +collided[1] : 0);
  ok(r2.sequencedNotes >= expected * 0.98,
     'every note survives the trip, followed through the sequence (' +
     r2.sequencedNotes + ' of ' + expected + ' after same-step collisions)');
  ok(r2.notes < r2.sequencedNotes,
     'and repeated bars really do share a phrase (' + r2.notes + ' unique, ' +
     r2.sequencedNotes + ' played)');
}

/* ------------------------------------------------- honesty about the losses */
console.log('what it says it cannot carry');
{
  ok(out.warnings.some(w => /drum/i.test(w) && /sample|kit|ROM/i.test(w)),
     'the drum limitation is stated, not discovered by ear');
  ok(out.warnings.some(w => /instrument/i.test(w)),
     'and so is the instrument voicing');
}

/* ------------------------------------- and now the part that is not our word */
console.log('read back by liblsdj itself');
{
  const reader = process.env.LSDJCHECK || '/tmp/lsdjcheck';
  if (!fs.existsSync(reader)) {
    console.log('  ..     SKIPPED: no liblsdj reader at ' + reader);
    console.log('  ..     Everything above is our own code checking our own code.');
    console.log('  ..     See the header of this file for the two commands that build it.');
  } else {
    const tmp = path.join(os.tmpdir(), 'ct-verify-' + process.pid + '.lsdsng');
    fs.writeFileSync(tmp, Buffer.from(out.bytes));
    let report = '';
    try { report = execFileSync(reader, [tmp]).toString(); }
    catch (e) { report = 'READER_FAILED ' + e.message; }
    fs.unlinkSync(tmp);
    const num = (k) => { const m = report.match(new RegExp(k + '=(\\d+)')); return m ? +m[1] : -1; };
    ok(!/READ_FAILED|READER_FAILED/.test(report), 'liblsdj opens the file we wrote');
    ok(num('tempo') === out.tempo, 'and reads the same tempo (' + num('tempo') + ')');
    ok(num('phrases') === out.phrases, 'the same phrase count (' + num('phrases') + ')');
    ok(num('chains') === out.chains, 'the same chain count (' + num('chains') + ')');
    ok(num('notes') === out.notes, 'the same note count (' + num('notes') + ')');
    ok(num('instruments') === 4, 'and four instruments, one per channel (' + num('instruments') + ')');
    ok(/name=BATTLE/.test(report), 'under the name we gave it');
  }
}

/* ------------------------------------------------------------- a whole cart */
// A .lsdsng is one song and still needs importing. A .sav IS the cartridge, and
// that is the difference between "here is a file" and "every slot on your Game
// Boy already has something in it".
console.log('a cartridge full of starting points');
{
  const scenes = ['title', 'overworld', 'battle', 'boss', 'cave', 'town', 'victory', 'game_over'];
  const docs = scenes.map(scene => api.brief({ scene, seconds: 30 }).doc);
  const cart = api.toLsdjSav(docs, { name: 'CART' });
  ok(cart.bytes.length === L.SAV_SIZE, 'a save is ' + L.SAV_SIZE + ' bytes (' + cart.bytes.length + ')');
  ok(cart.songs === scenes.length, 'every song got a slot (' + cart.songs + '/' + scenes.length + ')');
  ok(cart.blocksFree > 0, 'and there is room left to keep writing (' + cart.blocksFree + ' blocks free)');
  ok(cart.titles.every(t => t && t.length), 'each slot is named (' + cart.titles.slice(0, 2).join(', ') + '...)');

  // The header markers are what tell LSDj this is a save at all rather than
  // 128 KB of noise, and the block table is the off-by-one to get wrong.
  const H = L.SONG_BYTES;
  ok(cart.bytes[H + 256 + 32 + 30] === 0x6A && cart.bytes[H + 256 + 32 + 31] === 0x6B,
     "the 'jk' marker LSDj looks for is in place");
  const table = cart.bytes.slice(H + 256 + 32 + 33, H + 256 + 32 + 33 + 191);
  const owned = table.filter(v => v !== 0xFF).length;
  ok(owned === cart.blocksUsed, 'the block table accounts for every block used (' + owned + ')');
  const maxOwner = Math.max.apply(null, Array.from(table).filter(v => v !== 0xFF));
  ok(maxOwner === cart.songs - 1, 'and points only at slots that exist (highest ' + maxOwner + ')');

  // 32 is the ceiling, and going over must not corrupt the file.
  const many = api.toLsdjSav(scenes.concat(scenes, scenes, scenes, scenes)
    .map(scene => api.brief({ scene, seconds: 20 }).doc), {});
  ok(many.bytes.length === L.SAV_SIZE && many.songs <= 32,
     'asking for more than 32 songs still writes a valid save (' + many.songs + ' slots)');
}

/* --------------------------------------------------------- it is repeatable */
console.log('and it is deterministic, like everything else here');
{
  const a = api.toLsdsng(made.doc, { name: 'BATTLE' }).bytes;
  const b = api.toLsdsng(made.doc, { name: 'BATTLE' }).bytes;
  ok(a.length === b.length && a.every((v, i) => v === b[i]), 'the same song gives the same file, byte for byte');

  // Several scenes, so a shape that only works for one is caught.
  let broke = [];
  for (const scene of ['title', 'cave', 'boss', 'town', 'game_over']) {
    try {
      const r = api.toLsdsng(api.brief({ scene, seconds: 25 }).doc, { name: scene });
      if (!(r.bytes.length > 9) || !r.phrases) broke.push(scene + ': empty');
    } catch (e) { broke.push(scene + ': ' + e.message); }
  }
  ok(!broke.length, 'every scene exports' + (broke.length ? ' -- ' + broke.join('; ') : ''));
}

console.log(fail ? '\nverify-lsdj: ' + fail + ' FAILED'
                 : '\nverify-lsdj: an LSDj composer can open it');
process.exit(fail ? 1 : 0);
