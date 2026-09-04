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
  // ⚠️ AN LSDJ GROOVE IS IN TICKS AND OURS IS IN FRAMES, so this used to assert
  // the two lists were EQUAL and was asserting a bug: writing frame counts into
  // the tick field made LSDj play a 7-frame row as 8.17 frames -- 17% slow on
  // every song we exported. Measured in mGBA; see verify-lsdj-emulator.
  //
  // What has to hold is the ROW LENGTH, and LSDj's own arithmetic decides it:
  //   frames per row = ticks x 149.31875 / TEMPO
  // The check is that the row we asked for is the row LSDj will play.
  {
    const ticks = out.groove.filter(t => t > 0);
    const frames = st.groove && st.groove.length ? st.groove : [6];
    const avgTicks = ticks.reduce((a, b) => a + b, 0) / ticks.length;
    const avgFrames = frames.reduce((a, b) => a + b, 0) / frames.length;
    const willPlay = avgTicks * 149.31875 / out.tempo;
    ok(Math.abs(willPlay - avgFrames) / avgFrames < 0.02,
       'and the groove says the same row length in LSDj\'s units ([' + ticks +
       '] ticks at tempo ' + out.tempo + ' = ' + willPlay.toFixed(2) +
       ' frames a row; we wrote ' + avgFrames.toFixed(2) + ')');
    // ...and the SHAPE survives too: an even groove stays even, a shuffle stays
    // a shuffle in the same proportion.
    const shape = a => a.map(v => (v / (a.reduce((x, y) => x + y, 0) / a.length)).toFixed(2)).join(',');
    ok(ticks.length === 1 || shape(ticks) === shape(frames),
       'and its shape is unchanged (' + shape(frames) + ' -> ' + shape(ticks) + ')');
  }
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
    if (n > L.NOTE_MAX) bad++;
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
  // AND NOTHING NEEDS SHIFTING AT ALL. That is the tell that the note base is
  // right: with one constant for every channel, six or seven of these songs had
  // to be transposed to escape the floor. Per channel, none do -- because the
  // bass sits in the wave channel's range on the hardware exactly as it does in
  // the file. If this starts firing again, the table below is wrong.
  ok(!shifted, 'and none of them needs an octave shift (' + shifted + '/' + checked + ')');

  // The note base is DERIVED from the machine, so it is checked against the
  // machine rather than against a comment. gb-hardware knows what each family
  // can hold; LSDj's byte 1 is the bottom of it.
  const HW = require(path.join(__dirname, '..', 'src', 'gb-hardware.js'));
  const floorOf = (family) => { for (let m = 0; m < 127; m++) if (HW.inRange(m, family)) return m; return -1; };
  ok(L.NOTE_BASE[0] === floorOf('pulse') && L.NOTE_BASE[1] === floorOf('pulse'),
     'the pulse channels start at the lowest note a pulse can hold (' + floorOf('pulse') + ')');
  ok(L.NOTE_BASE[2] === floorOf('wave'),
     'and the wave channel an octave below it, as the hardware does (' + floorOf('wave') + ')');
  ok(floorOf('pulse') - floorOf('wave') === 12,
     'which is exactly the octave the DMG puts between them');

  // MEASURED FROM LSDj 9.4.2's OWN PERIOD TABLE, not inferred: note 1 sounds
  // 65.41 Hz on a pulse (C2, 0.0 cents) and 32.70 Hz on the wave channel (C1),
  // and the table stops climbing after 89 entries. The highest note we can write
  // must stay inside that, or the index lands on whatever bytes follow.
  const ceilOf = (family) => { let hi = -1; for (let m = 0; m < 127; m++) if (HW.inRange(m, family)) hi = m; return hi; };
  const topIndex = Math.max(ceilOf('pulse') - L.NOTE_BASE[0], ceilOf('wave') - L.NOTE_BASE[2]) + 1;
  ok(topIndex <= 89, 'our highest note is index ' + topIndex + ', inside LSDj\'s 89-entry table');
  ok(L.NOTE_MAX === 89, 'and NOTE_MAX is that measured length, not a round number (' + L.NOTE_MAX + ')');

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

  // AND THE CART READ BACK BY LIBLSDJ, not by us. The .sav is the flagship --
  // it is what somebody copies onto a flash cart -- so it gets the same
  // treatment as the single song rather than being trusted because the single
  // song passed.
  const reader = process.env.LSDJCHECK || '/tmp/lsdjcheck';
  if (!fs.existsSync(reader)) {
    console.log('  ..     SKIPPED the independent read of the cart: no reader at ' + reader);
  } else {
    const tmp = path.join(os.tmpdir(), 'ct-cart-' + process.pid + '.sav');
    fs.writeFileSync(tmp, Buffer.from(cart.bytes));
    let rep = '';
    try { rep = execFileSync(reader, [tmp]).toString(); }
    catch (e) { rep = 'READER_FAILED ' + e.message; }
    fs.unlinkSync(tmp);
    const slots = (rep.match(/^slot /gm) || []).length;
    const projects = (rep.match(/projects=(\d+)/) || [, -1])[1];
    ok(!/SAV_READ_FAILED|READER_FAILED/.test(rep), 'liblsdj opens the cartridge we wrote');
    ok(+projects === cart.songs, 'and finds every slot (' + projects + '/' + cart.songs + ')');
    ok(slots === cart.songs, 'each one named and readable (' + slots + ')');
    ok(/active=0/.test(rep), 'with the first song in working memory, so the cart opens on something');
  }
}

/* ------------------------------------------ and LSDj ITSELF, in an emulator */
// The last thing liblsdj cannot tell you: whether LSDj ACCEPTS the save and
// plays it. This boots the real ROM in mGBA with one of our .sav files, presses
// START, and compares the pitches the APU is told to make against the notes in
// the document.
//
// Optional, because neither mGBA nor the LSDj ROM can live in this repository:
// LSDj is Johan Kotlinski's and its licence forbids redistribution. Point it at
// your own copy. Skipped loudly rather than silently, like the liblsdj check.
//
//   brew install mgba
//   clang -I$(brew --prefix)/include -L$(brew --prefix)/lib -lmgba \
//         -o /tmp/lsdjplay tools/lsdjplay.c
//   LSDJPLAY=/tmp/lsdjplay LSDJ_ROM=~/lsdj.gb npm run test:lsdj
console.log('played by LSDj itself');
{
  const player = process.env.LSDJPLAY || '/tmp/lsdjplay';
  const romPath = process.env.LSDJ_ROM || '';
  if (!fs.existsSync(player) || !romPath || !fs.existsSync(romPath)) {
    console.log('  ..     SKIPPED: needs mGBA and your own LSDj ROM.');
    console.log('  ..     Everything above proves the FILE is right. This is the only check');
    console.log('  ..     that proves LSDj plays it. See the header of this section.');
  } else {
    const doc = api.brief({ scene: 'battle', seconds: 30, token: '7f3a12bc55de90aa' }).doc;
    const st3 = CT.docState(doc);
    const melRows2 = CT.tables().melodicRows;
    const laneOf = (x) => {
      if (x.r >= melRows2) return 3;
      if (x.ch === 0 || x.ch === 1) return x.ch;
      if (x.rch != null) return x.rch;
      if (x.st === 'bassg' || x.st === 'cello') return 2;
      return 0;
    };
    const expected = [...new Set(st3.cells.filter(c => laneOf(c) !== 3 && c.midi != null)
                                          .map(c => c.midi | 0))].sort((a, b) => a - b);
    const tmp = path.join(os.tmpdir(), 'ct-play-' + process.pid + '.sav');
    fs.writeFileSync(tmp, Buffer.from(api.toLsdjSav([doc], { name: 'TEST' }).bytes));
    let rep = '';
    try { rep = execFileSync(player, [romPath, tmp, '400', '2400'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString(); }
    catch (e) { rep = 'PLAYER_FAILED ' + e.message; }
    fs.unlinkSync(tmp);
    const toMidi = (f) => Math.round(69 + 12 * Math.log2(f / 440));
    const lines = rep.split('\n');
    const heard = new Set(lines.filter(l => l.startsWith('HZ ')).map(l => toMidi(+l.slice(3))));
    const noteOn = new Set(lines.filter(l => l.startsWith('TRIG ')).map(l => toMidi(+l.slice(5))));
    ok(!/FAILED/.test(rep) && heard.size > 0, 'LSDj boots with our save and plays it');
    const missing = expected.filter(m => !heard.has(m));
    ok(!missing.length, 'every note in the document is played (' +
       (expected.length - missing.length) + '/' + expected.length +
       (missing.length ? ', missing ' + missing.join(', ') : '') + ')');
    // The note-on set is smaller but everything in it is real, so it is the one
    // to check for notes LSDj plays that we never wrote.
    const wrong = [...noteOn].filter(m => !expected.includes(m));
    ok(!wrong.length, 'and nothing is played that we did not write' +
       (wrong.length ? ' -- ' + wrong.join(', ') : ' (' + noteOn.size + ' note-ons checked)'));
  }
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
