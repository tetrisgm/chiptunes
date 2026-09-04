// SONGS AN LSDJ COMPOSER CAN OPEN AND KEEP WRITING.
//
// This exports a `.lsdsng` -- one song, the unit LSDj users actually pass
// around -- built from the same document the browser plays. The point is not
// interoperability for its own sake. It is that somebody who writes on a Game
// Boy can take a generated arrangement as a STARTING POINT: the notes, the
// structure, the tempo and the groove arrive laid out in phrases and chains,
// and they get on with the part that is fun.
//
// WHY THIS IS A FAITHFUL EXPORT RATHER THAN A CONVERSION. Our composer already
// works the way a tracker does: sixteen steps to a bar, four channels that map
// one-to-one onto PU1/PU2/WAV/NOI, instruments that are literally DMG register
// bytes, and -- since the tick rewrite -- a step that lasts a whole number of
// frames with a groove for the rest. So a bar IS a phrase. Nothing is
// quantised on the way out and nothing is approximated.
//
// WHAT IT DOES NOT CARRY, said here rather than discovered later:
//   * DRUMS. Ours are 4-bit PCM streamed into wave RAM -- the same technique
//     LSDj kits use -- but a .sav cannot carry samples, because kits live in
//     the ROM. Drums are written to the noise channel, which is a real loss and
//     the reason `warnings` exists.
//   * INSTRUMENT VOICING. One default instrument per channel is written rather
//     than a translation of our DMG registers. That is deliberate: dialling in
//     instruments is the part an LSDj composer enjoys and is best at, and a
//     half-right translation would be worse than an honest blank.
//
// The format is implemented from liblsdj (MIT, Stijn Frishert with Johan
// Kotlinski) and Kotlinski's own lsdj-doc. scripts/verify-lsdj.js checks the
// output by reading it back with liblsdj itself where that library is present,
// so this file is never graded by its own homework -- the mistake that let a
// WebMCP registration ship against the wrong surface.
(function (G) {
  'use strict';

  var _req = (typeof require === 'function') ? require : null;
  var CT_CREATE = _req ? _req('./create.js') : G.CT_CREATE;

  var SONG_BYTES = 0x8000;

  // Offsets, from liblsdj's song_offsets.h.
  var O = {
    PHRASE_NOTES: 0x0000, GROOVES: 0x1090, SEQUENCE: 0x1290,
    INSTRUMENT_NAMES: 0x1E7A, TABLE_ALLOC: 0x2020, INSTRUMENT_ALLOC: 0x2040,
    CHAIN_PHRASES: 0x2080, CHAIN_TRANSPOSE: 0x2880, INSTRUMENT_PARAMS: 0x3080,
    PHRASE_ALLOC: 0x3E82, CHAIN_ALLOC: 0x3EA2,
    TEMPO: 0x3FB4, TRANSPOSE: 0x3FB5,
    PHRASE_COMMANDS: 0x4000, PHRASE_COMMAND_VALUES: 0x4FF0,
    PHRASE_INSTRUMENTS: 0x7000, FORMAT_VERSION: 0x7FFF
  };
  var NO_NOTE = 0, NO_INSTRUMENT = 0xFF, NO_CHAIN = 0xFF, NO_PHRASE = 0xFF;
  var MAX_PHRASES = 255, MAX_CHAINS = 128, MAX_INSTRUMENTS = 64;
  // command indices, from liblsdj's command.h
  var CMD = { NONE: 0, A: 1, C: 2, D: 3, E: 4, F: 5, G: 6, H: 7, K: 8, L: 9,
              M: 10, O: 11, P: 12, R: 13, S: 14, T: 15, V: 16, W: 17, Z: 18 };
  var INST_TYPE = { PULSE: 0, WAVE: 1, KIT: 2, NOISE: 3 };

  // THE NOTE BYTE IS AN INDEX INTO WHAT THAT CHANNEL CAN PLAY, and it is a
  // different pitch on each one. This started as one constant and a guess. It
  // is now MEASURED: LSDj 9.4.2 carries a table of 16-bit DMG period values,
  // and reading it says exactly what every note index sounds like.
  //
  //   note 1 through 131072/(2048-x)  ->  65.41 Hz  =  C2, MIDI 36, 0.0 cents
  //   note 1 through  65536/(2048-x)  ->  32.70 Hz  =  C1, MIDI 24, 0.0 cents
  //
  // One table serves both, and the wave channel's halved frequency formula puts
  // it an octave below the pulses -- which is why the base differs per channel
  // rather than per song. Our own register-level model agrees to the note:
  // gb-hardware holds pulse at MIDI 36..108 and wave at 24..96, and
  // verify-lsdj asserts this table against it so the two can never drift.
  //
  // The table runs to 89 entries before it stops climbing. Our composer's
  // highest pulse note is MIDI 108, which is index 73, so everything we write
  // fits with room to spare -- but NOTE_MAX is the measured length rather than
  // a comfortable round number, because an index past the end of a period table
  // is not a wrong note, it is whatever bytes happen to be next.
  //
  // (LSDj is Johan Kotlinski's and is freeware for personal and educational use;
  // nothing from the ROM is copied here. These are two frequencies and a count.)
  var NOTE_BASE = [36, 36, 24, 36];             // PU1, PU2, WAV, NOI
  var NOTE_MAX = 89;

  var RLE = 0xC0, SA = 0xE0, DEF_WAVE = 0xF0, DEF_INST = 0xF1, EOF_BLOCK = 0xFF;
  var BLOCK = 0x200, BLOCK_COUNT = 191;
  var DEFAULT_WAVE = [0x8E, 0xCD, 0xCC, 0xBB, 0xAA, 0xA9, 0x99, 0x88,
                      0x87, 0x76, 0x66, 0x55, 0x54, 0x43, 0x32, 0x31];
  var DEFAULT_INSTRUMENT = [0xA8, 0x00, 0x00, 0xFF, 0x00, 0x00, 0x03, 0x00,
                            0x00, 0xD0, 0x00, 0x00, 0x00, 0xF3, 0x00, 0x00];

  // LSDj's own empty song, compressed with LSDj's own scheme (1 KB), rather
  // than 32 KB of literal bytes or a hand-built guess at every unrelated field.
  // From liblsdj's song_empty.c, MIT.
  var EMPTY_B64 =
    'wAD/wAD/wAD/wAD/wAD/wAD/wAD/wAD/wAD/wAD/wAD/wAD/wAD/wAD/wAD/wAD/wP9AwABgBgbAAA4GBsAADgYGwAAOBgbA' +
    'AA4GBsAADgYGwAAOBgbAAA4GBsAADgYGwAAOBgbAAA4GBsAADgYGwAAOBgbAAA4GBsAADgYGwAAOBgbAAA4GBsAADgYGwAAO' +
    'BgbAAA4GBsAADgYGwAAOBgbAAA4GBsAADgYGwAAOBgbAAA4GBsAADgYGwAAOBgbAAA4GBsAADgYGwAAOBgbAAA4GBsAADsD/' +
    '/8D//8D//8D//8D/BMAA/8AA/8AA/8AA/8AA/8AA/8AA/8AAR0MgMiBDIzIgRCAyIEQjMiBFIDIgRiAyIEYjMiBHIDIgRyMy' +
    'IEEgMiBBIzIgQiAyIEMgMyBDIzMgRCAzIEQjMyBFIDMgRiAzIEYjMyBHIDMgRyMzIEEgMyBBIzMgQiAzIEMgNCBDIzQgRCA0' +
    'IEQjNCBFIDQgRiA0IEYjNCBHIDQgRyM0IEEgNCBBIzQgQiA0IEMgNSBDIzUgRCA1IEQjNSBFIDUgRiA1IHJiwAD/wAD/wAAI' +
    'wP//wP//wP//wP//wP//wP//wP//wP//wP8IwAD/wAD/wAD/wAD/wAD/wAD/wAD/wAD/wAAJ4PFAwAD/wAD/wAD/wAD/wAD/' +
    'wAD/4AIAAADAAP/AAP/AAP/AAP/AAAlyYsAANRD/AAAQ/8AAChD/AAAQ/8AAChD/AAAQ/8AAChD/AAAQ/8AAChD/AAAQ/8AA' +
    'ChD/AAAQ/8AAChD/AAAQ/8AAChD/AAAQ/8AAChD/AAAQ/8AAChD/AAAQ/8AAChD/AAAQ/8AAChD/AAAQ/8AAChD/AAAQ/8AA' +
    'ChD/AAAQ/8AAChD/AAAQ/8AAChD/AAAQ/8AAB4DAAAUHAsAABwHAAP/AAP/AAP/AAP/AAP/AAP/AAP/AAP/AAP/AAP/AAP/A' +
    'AP/AAP/AAP/AAP/AAP/AAP/AAP/AAP/AAP/AAP/AAP/AAP/AAP/AAP/AAP/AAP/AAP/AAP/AAP/AAP/AAP/AAFzg8P/g8AHA' +
    '///A///A///A///A///A///A///A///A///A///A///A///A///A///A///A//9yYsAADQfg/wAAAAAAAAAAAAAAAAAAAAAA' +
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
    'AAAAAAAAAAAAAAAAAAAAAA==';

  function b64bytes(s) {
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(s, 'base64'));
    var bin = G.atob(s), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /* ------------------------------------------------------------ compression */
  // LSDj's own scheme: run-length runs, two escape bytes, and special actions
  // for the default wave and default instrument (which is why an empty song is
  // a kilobyte). Data is laid into 512-byte blocks, each ending in a jump to
  // the next. Implemented from liblsdj's compression.c.
  function matches(d, at, arr) {
    for (var i = 0; i < arr.length; i++) if (d[at + i] !== arr[i]) return false;
    return true;
  }
  function compress(data, blockOffset) {
    var out = [], block = blockOffset == null ? 1 : blockOffset, size = 0;
    var read = 0, end = data.length, i;
    while (read < end) {
      var ev = null, n = 0;
      // NOTE the strict `<`: liblsdj will not match a default run that ends
      // exactly at the buffer end, and a decompressor built to the same rule
      // has to agree byte for byte.
      while (read + 16 < end && matches(data, read, DEFAULT_WAVE) && n !== 0xFF) { read += 16; n++; }
      if (n > 0) ev = [SA, DEF_WAVE, n];
      else {
        var m = 0;
        while (read + 16 < end && matches(data, read, DEFAULT_INSTRUMENT) && m !== 0xFF) { read += 16; m++; }
        if (m > 0) ev = [SA, DEF_INST, m];
        else if (data[read] === RLE) { ev = [RLE, RLE]; read++; }
        else if (data[read] === SA) { ev = [SA, SA]; read++; }
        else {
          var c = data[read];
          if (read + 3 < end && data[read + 1] === c && data[read + 2] === c && data[read + 3] === c) {
            var k = 0;
            while (read < end && data[read] === c && k !== 0xFF) { k++; read++; }
            ev = [RLE, c, k];
          } else { ev = [data[read++]]; }
        }
      }
      if (size + ev.length + 2 >= BLOCK) {
        out.push(SA, block + 1); size += 2;
        while (size < BLOCK) { out.push(0); size++; }
        block++; size = 0;
        if (block === BLOCK_COUNT + 1) throw new Error('lsdj: song does not fit in a save');
      }
      for (i = 0; i < ev.length; i++) out.push(ev[i]);
      size += ev.length;
    }
    out.push(SA, EOF_BLOCK);
    if (size > 0) { size += 2; while (size < BLOCK) { out.push(0); size++; } }
    return Uint8Array.from(out);
  }
  function decompress(bytes) {
    var out = [], i = 0, j;
    while (i < bytes.length && out.length < SONG_BYTES) {
      var b = bytes[i++];
      if (b === RLE) {
        var v = bytes[i++];
        if (v === RLE) out.push(RLE);
        else { var cnt = bytes[i++]; for (j = 0; j < cnt; j++) out.push(v); }
      } else if (b === SA) {
        var a = bytes[i++];
        if (a === SA) out.push(SA);
        else if (a === DEF_WAVE) { var wc = bytes[i++]; for (j = 0; j < wc; j++) out = out.concat(DEFAULT_WAVE); }
        else if (a === DEF_INST) { var ic = bytes[i++]; for (j = 0; j < ic; j++) out = out.concat(DEFAULT_INSTRUMENT); }
        else if (a === EOF_BLOCK) break;
        else i = a * BLOCK;                    // jump to the next block
      } else out.push(b);
    }
    var song = new Uint8Array(SONG_BYTES);
    song.set(out.slice(0, SONG_BYTES));
    return song;
  }

  function emptySong() { return decompress(b64bytes(EMPTY_B64)); }

  /* --------------------------------------------------------- writing a song */
  function setBit(song, base, index, on) {
    var byte = base + (index >> 3), mask = 1 << (index & 7);
    if (on) song[byte] |= mask; else song[byte] &= ~mask;
  }

  // PHRASES ARE SIXTEEN STEPS, not one bar. At our default sixteenth grid those
  // are the same thing, which is the happy case and the common one; at a 24th
  // or 32nd grid a phrase is a fraction of a bar instead. Chunking by STEPS
  // rather than by bars keeps the export structurally correct either way, and
  // the caller is warned when the two stop coinciding.
  var PHRASE_STEPS = 16;

  function laneOfCell(x, melRows) {
    if (x.r >= melRows) return 3;                        // drum rows
    if (x.ch === 0 || x.ch === 1) return x.ch;
    if (x.rch != null) return x.rch;
    if (x.st === 'bassg' || x.st === 'cello') return 2;
    return 0;
  }

  function fromDocument(doc, opts) {
    opts = opts || {};
    var st = CT_CREATE.docState(typeof doc === 'string' ? doc : String(doc || ''));
    if (!st) throw new Error('lsdj: not a readable song document');
    var melRows = (CT_CREATE.tables && CT_CREATE.tables().melodicRows) || 12;
    var warn = [], song = emptySong(), i, ch;

    if ((st.grid || 16) !== PHRASE_STEPS)
      warn.push('this song is on a ' + st.grid + '-step bar, so one LSDj phrase is ' +
                (PHRASE_STEPS / st.grid).toFixed(2) + ' of a bar rather than exactly one');

    // ---- lay the notes out per channel, one slot per step ------------------
    var lastStep = 0;
    st.cells.forEach(function (x) { if ((x.c | 0) > lastStep) lastStep = x.c | 0; });
    var steps = lastStep + 1;
    var grid = [[], [], [], []];
    for (ch = 0; ch < 4; ch++) for (i = 0; i < steps; i++) grid[ch].push(null);

    // FIT THE RANGE BY MOVING WHOLE OCTAVES, NEVER BY CLAMPING. Our composer
    // writes down to MIDI 24 and LSDj's note 1 sits higher than that, so a
    // straight mapping pushed a third of the notes of a busy song against the
    // floor -- and a clamped note is not a quiet mistake, it is a WRONG note
    // sitting in somebody's phrase. Shifting by octaves keeps every interval
    // and every pitch class; the musician undoes it with one transpose if they
    // want it lower, and the warning tells them it happened.
    var lowest = null, highest = null;
    st.cells.forEach(function (x) {
      if (laneOfCell(x, melRows) === 3 || x.midi == null) return;
      var m = x.midi | 0;
      if (lowest === null || m < lowest) lowest = m;
      if (highest === null || m > highest) highest = m;
    });
    // With a per-channel base the bass no longer collides with the floor, so
    // this is a safety net rather than the load-bearing part it used to be.
    var octaves = 0;
    if (lowest !== null) {
      var floorBase = Math.min.apply(null, NOTE_BASE);
      while (lowest + octaves * 12 < floorBase) octaves++;
      while (highest + octaves * 12 - floorBase + 1 > NOTE_MAX && octaves > 0) octaves--;
    }
    if (octaves) warn.push('transposed up ' + octaves + ' octave' + (octaves > 1 ? 's' : '') +
                           ' so the low notes fit LSDj\'s range; transpose it back down if you want');

    var outOfRange = 0, dropped = 0;
    st.cells.forEach(function (x) {
      var lane = laneOfCell(x, melRows), step = x.c | 0;
      var slot = { note: NO_NOTE, cmd: CMD.NONE, val: 0 };
      if (lane === 3) {
        // Drums land on the noise channel: a .sav cannot carry the samples our
        // kits are made of, because in LSDj those live in the ROM.
        slot.note = 60 - NOTE_BASE[3] + 1;     // a plain mid note; noise pitch is not melodic
      } else if (x.midi != null) {
        var n = (x.midi | 0) + octaves * 12 - NOTE_BASE[lane] + 1;
        // A note that STILL does not fit after the octave shift is dropped
        // rather than clamped: a missing note reads as a rest, a clamped one
        // reads as a mistake somebody made on purpose.
        if (n < 1 || n > NOTE_MAX) { outOfRange++; return; }
        slot.note = n;
      } else return;
      // An arpeggio is a COMMAND here, not three notes. Our document carries the
      // gesture as a flag and only the player expands it, so the export can say
      // what was meant rather than what was rendered -- which is the difference
      // between a phrase somebody can read and 300 rows they cannot.
      if (x.q && lane !== 3) { slot.cmd = CMD.C; slot.val = st.minor ? 0x37 : 0x47; }
      else if (x.g && lane !== 3) { slot.cmd = CMD.R; slot.val = 0x00; }
      else if (x.vb && lane !== 3) { slot.cmd = CMD.V; slot.val = 0x84; }
      if (grid[lane][step]) dropped++;
      grid[lane][step] = slot;
    });
    if (outOfRange) warn.push(outOfRange + ' notes were still outside LSDj\'s range after transposing and were left out');
    if (dropped) warn.push(dropped + ' notes shared a step with another on the same channel and were replaced');

    // ---- phrases, deduplicated --------------------------------------------
    var phrases = [], byKey = {}, chainsOf = [[], [], [], []];
    var full = Math.ceil(steps / PHRASE_STEPS);
    for (ch = 0; ch < 4; ch++) {
      for (var p = 0; p < full; p++) {
        var slots = [], any = false;
        for (i = 0; i < PHRASE_STEPS; i++) {
          var s = grid[ch][p * PHRASE_STEPS + i] || null;
          if (s) any = true;
          slots.push(s);
        }
        if (!any) { chainsOf[ch].push(NO_PHRASE); continue; }
        var key = slots.map(function (s2) {
          return s2 ? s2.note + ':' + s2.cmd + ':' + s2.val : '-';
        }).join(',');
        if (byKey[key] == null) {
          if (phrases.length >= MAX_PHRASES) { chainsOf[ch].push(NO_PHRASE); continue; }
          byKey[key] = phrases.length;
          phrases.push({ slots: slots, ch: ch });
        }
        chainsOf[ch].push(byKey[key]);
      }
    }
    if (phrases.length >= MAX_PHRASES)
      warn.push('this song needs more than ' + MAX_PHRASES + ' phrases; the tail was dropped');

    // ---- chains ------------------------------------------------------------
    var chains = [], seq = [[], [], [], []];
    for (ch = 0; ch < 4; ch++) {
      for (var c0 = 0; c0 < chainsOf[ch].length; c0 += 16) {
        var run = chainsOf[ch].slice(c0, c0 + 16);
        while (run.length < 16) run.push(NO_PHRASE);
        if (run.every(function (v) { return v === NO_PHRASE; })) { seq[ch].push(NO_CHAIN); continue; }
        if (chains.length >= MAX_CHAINS) { seq[ch].push(NO_CHAIN); continue; }
        chains.push(run);
        seq[ch].push(chains.length - 1);
      }
    }
    if (chains.length >= MAX_CHAINS) warn.push('this song needs more than ' + MAX_CHAINS + ' chains; the tail was dropped');

    // ---- write it out ------------------------------------------------------
    for (i = 0; i < phrases.length; i++) {
      var base = i * PHRASE_STEPS;
      for (var k = 0; k < PHRASE_STEPS; k++) {
        var sl = phrases[i].slots[k];
        song[O.PHRASE_NOTES + base + k] = sl ? sl.note : NO_NOTE;
        song[O.PHRASE_INSTRUMENTS + base + k] = sl ? phrases[i].ch : NO_INSTRUMENT;
        song[O.PHRASE_COMMANDS + base + k] = sl ? sl.cmd : CMD.NONE;
        song[O.PHRASE_COMMAND_VALUES + base + k] = sl ? sl.val : 0;
      }
      setBit(song, O.PHRASE_ALLOC, i, true);
    }
    for (i = 0; i < chains.length; i++) {
      for (var q = 0; q < 16; q++) {
        song[O.CHAIN_PHRASES + i * 16 + q] = chains[i][q];
        song[O.CHAIN_TRANSPOSE + i * 16 + q] = 0;
      }
      setBit(song, O.CHAIN_ALLOC, i, true);
    }
    var rows = Math.max.apply(null, seq.map(function (s3) { return s3.length; }));
    for (var r = 0; r < Math.min(rows, 255); r++)
      for (ch = 0; ch < 4; ch++)
        song[O.SEQUENCE + r * 4 + ch] = seq[ch][r] == null ? NO_CHAIN : seq[ch][r];

    // ONE INSTRUMENT PER CHANNEL, of the right type and otherwise stock. See the
    // note at the top: a half-right translation of our DMG registers would be
    // worse for the person receiving this than an honest blank they can voice.
    var types = [INST_TYPE.PULSE, INST_TYPE.PULSE, INST_TYPE.WAVE, INST_TYPE.NOISE];
    var names = ['MELODY', 'HARMONY', 'BASS', 'DRUMS'];
    for (i = 0; i < 4; i++) {
      for (var b2 = 0; b2 < 16; b2++)
        song[O.INSTRUMENT_PARAMS + i * 16 + b2] = DEFAULT_INSTRUMENT[b2];
      song[O.INSTRUMENT_PARAMS + i * 16] = types[i];
      song[O.INSTRUMENT_ALLOC + i] = 1;
      for (var nm = 0; nm < 5; nm++) {
        var chr = names[i].charCodeAt(nm);
        song[O.INSTRUMENT_NAMES + i * 5 + nm] = chr ? chr : 0;
      }
    }
    warn.push('instruments are stock LSDj defaults, one per channel, for you to voice');
    warn.push('drums are on the noise channel: a .sav cannot carry kit samples, which live in the ROM');

    // ---- tempo and groove --------------------------------------------------
    song[O.TEMPO] = Math.max(40, Math.min(255, st.bpm | 0));
    var gr = st.groove && st.groove.length ? st.groove : [6];
    for (i = 0; i < 16; i++) song[O.GROOVES + i] = i < gr.length ? (gr[i] & 0xFF) : 0;

    return {
      bytes: song, warnings: warn,
      phrases: phrases.length, chains: chains.length, rows: Math.min(rows, 255),
      // TWO COUNTS, BECAUSE THEY ARE DIFFERENT QUESTIONS. `notes` is what lives
      // in the unique phrases -- what LSDj shows, and what liblsdj counts, since
      // identical bars share one phrase. `sequencedNotes` is what a listener
      // hears, following the sequence through its chains. Reporting only the
      // first made a 217-note song look like a 61-note one.
      notes: phrases.reduce(function (a, ph) {
        return a + ph.slots.filter(function (s4) { return s4 && s4.note !== NO_NOTE; }).length;
      }, 0),
      sequencedNotes: (function () {
        var total = 0;
        for (var r2 = 0; r2 < Math.min(rows, 255); r2++) for (var c2 = 0; c2 < 4; c2++) {
          var cid = seq[c2][r2];
          if (cid == null || cid === NO_CHAIN) continue;
          for (var q2 = 0; q2 < 16; q2++) {
            var pid = chains[cid][q2];
            if (pid === NO_PHRASE) continue;
            total += phrases[pid].slots.filter(function (s5) { return s5 && s5.note !== NO_NOTE; }).length;
          }
        }
        return total;
      })(),
      tempo: song[O.TEMPO], groove: gr.slice(), title: st.title || ''
    };
  }

  // LSDj project names are eight characters of its own alphabet.
  function projectName(title) {
    var s = String(title || 'CHIPTUNE').toUpperCase().replace(/[^A-Z0-9 -]/g, '').trim();
    if (!s) s = 'CHIPTUNE';
    var out = new Uint8Array(8);
    for (var i = 0; i < 8; i++) out[i] = i < s.length ? s.charCodeAt(i) : 0;
    return out;
  }

  function lsdsng(doc, opts) {
    var built = fromDocument(doc, opts);
    var name = projectName((opts && opts.name) || built.title);
    var body = compress(built.bytes, 1);
    var file = new Uint8Array(9 + body.length);
    file.set(name, 0);
    file[8] = 0;                                        // project version
    file.set(body, 9);
    built.file = file;
    return built;
  }

  /* --------------------------------------------------------- a whole cart */
  // THE THING THAT ACTUALLY SAVES TIME. A `.lsdsng` is one song and still needs
  // importing; a `.sav` IS the cartridge. Generate a dozen starting points,
  // write one file, copy it to a flash cart, and every slot on the machine has
  // something in it to argue with.
  //
  // Layout: the working-memory song, a 512-byte header, then 191 blocks of 512.
  // The block allocation table says which project owns each block, and blocks
  // are numbered from 1 -- block N lives at (N-1)*512 in the block area, which
  // is the off-by-one to get wrong.
  var SAV_SIZE = 0x20000, SAV_PROJECTS = 32, SAV_HEADER = SONG_BYTES;
  var BLOCK_AREA = SAV_HEADER + 0x200, EMPTY_BLOCK = 0xFF;

  function sav(docs, opts) {
    opts = opts || {};
    var list = [].concat(docs || []).slice(0, SAV_PROJECTS);
    if (!list.length) throw new Error('lsdj: a save needs at least one song');
    var out = new Uint8Array(SAV_SIZE);
    var names = [], built = [], warnings = [], i;

    var blockCursor = 1;                       // blocks are 1-based
    var alloc = new Uint8Array(191); alloc.fill(EMPTY_BLOCK);
    for (i = 0; i < list.length; i++) {
      var b = fromDocument(list[i], opts);
      var body = compress(b.bytes, blockCursor);
      var blocks = body.length / BLOCK;
      if (blockCursor - 1 + blocks > 191) {
        warnings.push('the save filled up after ' + i + ' songs; the rest were left out');
        break;
      }
      out.set(body, BLOCK_AREA + (blockCursor - 1) * BLOCK);
      for (var k = 0; k < blocks; k++) alloc[blockCursor - 1 + k] = i;
      blockCursor += blocks;
      names.push(projectName((opts.names && opts.names[i]) || b.title));
      built.push(b);
      b.warnings.forEach(function (w) { if (warnings.indexOf(w) < 0) warnings.push(w); });
    }

    // The working-memory song is what the cart opens on, so it is the first one
    // rather than a blank screen.
    out.set(built[0].bytes, 0);
    for (i = 0; i < names.length; i++) out.set(names[i], SAV_HEADER + i * 8);
    for (i = 0; i < names.length; i++) out[SAV_HEADER + 256 + i] = 0;   // project version
    out[SAV_HEADER + 256 + 32 + 30] = 0x6A;                             // 'j'
    out[SAV_HEADER + 256 + 32 + 31] = 0x6B;                             // 'k'
    out[SAV_HEADER + 256 + 32 + 32] = 0;                                // active project
    out.set(alloc, SAV_HEADER + 256 + 32 + 33);

    return { bytes: out, songs: built.length, warnings: warnings,
             blocksUsed: blockCursor - 1, blocksFree: 191 - (blockCursor - 1),
             titles: built.map(function (b2) { return b2.title; }) };
  }

  var API = {
    SONG_BYTES: SONG_BYTES, SAV_SIZE: SAV_SIZE, SAV_PROJECTS: SAV_PROJECTS,
    OFFSETS: O, COMMANDS: CMD, sav: sav,
    NOTE_BASE: NOTE_BASE.slice(), NOTE_MAX: NOTE_MAX, PHRASE_STEPS: PHRASE_STEPS,
    compress: compress, decompress: decompress, emptySong: emptySong,
    fromDocument: fromDocument, lsdsng: lsdsng
  };
  G.CT_LSDJ = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : window);
