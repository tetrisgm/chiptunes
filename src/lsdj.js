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
// WHAT SURVIVES A ROUND TRIP, all of it verified against the real ROM in mGBA
// by scripts/verify-lsdj-emulator.js: tempo, groove, pitch, lane, step, note
// LENGTH (LSDj stores none, so the export says where a note stops with a KILL),
// which drum it was, the timbre, the loudness, and the gesture.
//
// ⚠️ THE OLD VERSION OF THIS NOTE WAS WRONG ABOUT OUR OWN DRUMS. It said "ours
// are 4-bit PCM streamed into wave RAM -- the same technique LSDj kits use", and
// they are not: the composer puts drums on CHANNEL 3, NOISE, with no kit data on
// the score at all. That stale claim made "drums are a real loss" look
// inevitable and sent a whole session looking at kits. LSDj noise plays noise;
// drums-on-noise is an ordinary LSDj arrangement, and kits would cost the WAVE
// channel, which is where the bass lives.
//
// WHAT STILL DOES NOT CARRY, said here rather than discovered later:
//   * ECHO. Our echo is a delayed repeat and no single LSDj command says that.
//   * LSDJ'S ENVELOPE SHAPES. Byte 1's low nibble is a HOLD in frames before the
//     note is cut (measured: 0 sustains, 1..f hold 1,1,1,1,1,2,2,3,4,5,6,8,11,
//     15,20). We write 0 -- sustain -- which is what a tracker uses, and say
//     where a note stops with a KILL instead. Its other shapes are unused.
//   * TABLES. LSDj's 32 tables are a per-instrument modulation sequence and
//     nothing here writes or reads one.
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
    // WAVES, found by looking rather than by guessing: the default wave appears
    // in the empty song at exactly 256 contiguous 16-byte slots from 0x6000 to
    // 0x6FF0, which is the whole of the gap our field map had. Confirmed on the
    // machine -- a marker table planted at frame 0 comes back out of LSDj's wave
    // RAM byte for byte.
    WAVES: 0x6000,
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
  // ✅ CONFIRMED ON THE MACHINE, 2026-09-04. This carried a warning for a while
  // saying it could not be proved from a file and had to be heard: liblsdj
  // reports the note BYTE and never claims which pitch it sounds. LSDj itself
  // now answers, in mGBA -- `scripts/verify-lsdj-emulator.js` plays a song with
  // ONE note in it and reads the pitch off the APU. Byte 1 sounds MIDI 36 on
  // both pulses and MIDI 24 on the wave, and bytes 13 and 25 agree an octave and
  // two octaves up. These numbers are right.
  //
  // ⚠️ It has to be ONE note. The first attempt used an ascending ruler, which
  // repeats -- the trace starts mid-phrase, the sequences line up three notches
  // out, and the result is a clean, believable, WRONG answer: it reported every
  // base an octave low and would have had us "fix" a constant that was correct.
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
  // ⚠️ BLOCKS ARE NUMBERED FROM 1, so block N begins at (N - base) * 512 in this
  // buffer -- the same off-by-one the .sav block table has. This read `a * BLOCK`
  // and so landed one whole block past every jump. It went unnoticed because the
  // only thing ever round-tripped through here was the empty song, which
  // compresses to well under 512 bytes and therefore never jumps at all. On
  // anything with real note data the codec silently lost 512 bytes per block.
  //
  // `base` is the block number this buffer STARTS at: 1 for a bare song, and
  // the project's first block inside a .sav, where jumps are absolute.
  function decompress(bytes, base) {
    base = base == null ? 1 : base;
    var out = [], i = 0, j, k;
    while (i < bytes.length && out.length < SONG_BYTES) {
      var b = bytes[i++];
      if (b === RLE) {
        var v = bytes[i++];
        if (v === RLE) out.push(RLE);
        else { var cnt = bytes[i++]; for (j = 0; j < cnt; j++) out.push(v); }
      } else if (b === SA) {
        var a = bytes[i++];
        if (a === SA) out.push(SA);
        else if (a === DEF_WAVE) { var wc = bytes[i++]; for (j = 0; j < wc; j++) for (k = 0; k < 16; k++) out.push(DEFAULT_WAVE[k]); }
        else if (a === DEF_INST) { var ic = bytes[i++]; for (j = 0; j < ic; j++) for (k = 0; k < 16; k++) out.push(DEFAULT_INSTRUMENT[k]); }
        else if (a === EOF_BLOCK) break;
        else i = (a - base) * BLOCK;           // jump to that block, 1-based
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

  // OUR wave tables, packed the way the hardware wants them: 32 four-bit samples
  // into 16 bytes, high nibble first. The slots come from the same bank the
  // browser plays, so the table LSDj loads is the one you heard.
  var WAVE_SLOT = { bassg: 1, cello: 4 };          // saw (buzzy), sine (mellow)
  function waveTableFor(stamp) {
    var HW = (typeof require !== 'undefined' && typeof module !== 'undefined')
      ? require('./gb-hardware.js') : G.CT_GB;
    var CI = (typeof require !== 'undefined' && typeof module !== 'undefined')
      ? require('./chip-instruments.js') : G.CT_CHIP_INSTRUMENTS;
    if (!HW || !CI || !HW.buildBank) return null;
    var slot = WAVE_SLOT[stamp];
    if (slot == null) return null;
    var tables = HW.buildBank(CI.patches).waveTables;
    var t = tables && tables[slot];
    if (!t || t.length < 32) return null;
    var out = [];
    for (var i = 0; i < 16; i++) out.push(((t[i * 2] & 0xF) << 4) | (t[i * 2 + 1] & 0xF));
    return out;
  }

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

    // ---- one instrument per voice the song uses ----------------------------
    // A stamp IS an instrument -- a duty crossed with an envelope character --
    // and so is a drum. Giving each its own slot is both what an LSDj musician
    // would do and what makes the song survive a round trip: with one shared
    // noise instrument, a kick and a hat come back indistinguishable.
    var DUTY_INDEX = { 0.125: 0, 0.25: 1, 0.5: 2, 0.75: 3 };
    var STAMP_DUTY = { piano: 0.5, trumpet: 0.25, flute: 0.5, bell: 0.125 };
    var instruments = [], instOf = {};
    // WHICH DRUM lives in the cell's ROW, not in a field: the editor stacks the
    // drum lanes under the melodic ones, so row - melodicRows is the index into
    // the drum list. Reading it is what lets a kick come back as a kick.
    var DRUM_IDS = (CT_CREATE.tables && CT_CREATE.tables().drums) || ['hat', 'snare', 'kick'];
    // Measured note bytes, one note per song, read off NR43: 33 -> divisor 6,
    // 49 -> divisor 3, 61 -> divisor 1. Higher divisor is a lower noise pitch.
    var DRUM_NOTE = { kick: 33, snare: 49, hat: 61 };
    // ⚠️ VOLUME IS PART OF THE INSTRUMENT'S IDENTITY, because in LSDj it has
    // nowhere else to live -- there is no per-note volume column. Our renderer
    // plays an accent by making one note louder, and a single instrument per
    // voice could not carry that: the export flattened every accent.
    //
    // The LSDj answer is not to flatten the music, it is to have MORE
    // INSTRUMENTS -- which is what an LSDj musician does, and what the 64 slots
    // are for. A voice at four playing levels is four instruments. We use around
    // thirty of the sixty-four, and the accents survive.
    function instrumentFor(x, lane) {
      var isDrum = lane === 3;
      var drum = isDrum ? (DRUM_IDS[(x.r | 0) - melRows] || 'kick') : null;
      var vol = Math.max(1, Math.min(15, Math.round((x.vel != null ? x.vel : 0.8) * 15)));
      // A FALL AND A RISE ARE A HARDWARE SWEEP, and the sweep unit belongs to
      // PU1 alone -- so only the first pulse lane can carry them, which is the
      // same limit the machine has. NR10 is pace<<4 | direction<<3 | shift, and
      // direction 1 means the frequency DECREASES, which is the pitch falling.
      var sweep = 0;
      if (lane === 0 && x.z) sweep = 0x3E;              // pace 3, down, shift 6
      else if (lane === 0 && x.u) sweep = 0x36;         // pace 3, up,   shift 6
      var id = (isDrum ? ('drum:' + drum) : (lane + ':' + (x.st || 'piano'))) +
               (sweep ? ':s' + sweep : '') + ':v' + vol;
      if (instOf[id] != null) return instOf[id];
      // Out of slots: reuse the nearest instrument for this voice rather than
      // dropping to the lane default, so the timbre survives even when the
      // loudness has to be approximated.
      if (instruments.length >= MAX_INSTRUMENTS) {
        var stem = id.slice(0, id.lastIndexOf(':v')), best = lane, bd = 99;
        for (var q2 = 0; q2 < instruments.length; q2++) {
          if (instruments[q2].stem !== stem) continue;
          var d2 = Math.abs(instruments[q2].vol - vol);
          if (d2 < bd) { bd = d2; best = q2; }
        }
        return best;
      }
      var type = isDrum ? INST_TYPE.NOISE : lane === 2 ? INST_TYPE.WAVE : INST_TYPE.PULSE;
      var duty = DUTY_INDEX[STAMP_DUTY[x.st]] != null ? DUTY_INDEX[STAMP_DUTY[x.st]] : 2;
      // The NAME is the voice without the volume, so LSDj shows PIANO for every
      // loudness of piano and import can still read the drum back off it.
      var stem2 = id.slice(0, id.lastIndexOf(':v'));
      var name = String(stem2.replace(/^\d+:|^drum:/, '')).toUpperCase().slice(0, 5);
      instOf[id] = instruments.length;
      instruments.push({ type: type, vol: vol, duty: duty, name: name, stem: stem2, sweep: sweep });
      return instOf[id];
    }

    var outOfRange = 0, dropped = 0;
    st.cells.forEach(function (x) {
      var lane = laneOfCell(x, melRows), step = x.c | 0;
      var slot = { note: NO_NOTE, cmd: CMD.NONE, val: 0, inst: instrumentFor(x, lane) };
      if (lane === 3) {
        // ⚠️ A NOISE NOTE IS A PITCH, AND THE WRONG ONE IS SILENCE. This wrote
        // note 25 for every drum, on the reasoning that noise is not melodic.
        // Measured against the ROM one note at a time: LSDj writes nothing to
        // NR43 for any noise note below 33, so every drum this project ever
        // exported was SILENT -- and had they sounded, all three would have been
        // the same pitch anyway, because they shared the one note.
        //
        // These values are measured, and the divisor is the pitch: note 33 is
        // divisor 6 (low), 49 is divisor 3, 61 is divisor 1 (high). Kick low,
        // snare in the middle, hat on top -- what the kit sounds like, and what
        // an LSDj musician would have typed.
        slot.note = DRUM_NOTE[DRUM_IDS[(x.r | 0) - melRows]] || 49;
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
      slot.len = Math.max(1, x.len | 0 || 1);
      grid[lane][step] = slot;

      // AN ECHO IS TWO NOTES, and that is all it ever was. Our renderer plays it
      // as the note shortened to a row and a quieter repeat one row later on the
      // same channel; LSDj has no echo flag, so writing it as the flag lost it
      // entirely. Written out, both play the same thing -- and a musician
      // opening the file sees the repeat, which is what is actually happening.
      if (x.f && lane !== 3 && slot.note && !grid[lane][step + 1] && step + 1 < steps) {
        var quiet = Object.assign({}, x, { vel: (x.vel != null ? x.vel : 0.8) * 0.6 });
        grid[lane][step] = Object.assign({}, slot, { len: 1 });
        grid[lane][step + 1] = { note: slot.note, cmd: CMD.NONE, val: 0,
                                 inst: instrumentFor(quiet, lane), len: 1 };
      }
    });
    if (outOfRange) warn.push(outOfRange + ' notes were still outside LSDj\'s range after transposing and were left out');
    if (dropped) warn.push(dropped + ' notes shared a step with another on the same channel and were replaced');

    // ---- KILL, because LSDj does not store a note length ------------------
    // A note in LSDj RUNS UNTIL THE NEXT ONE. Ours have lengths, so a staccato
    // note exported without saying where it stops becomes a sustained one that
    // holds until the next note arrives -- which is a different piece of music,
    // and was audible on anything with space in it.
    //
    // The envelope cannot fix this. Measured off the ROM, byte 1's low nibble is
    // a HOLD IN FRAMES -- 1,1,1,1,1,2,2,3,4,5,6,8,11,15,20 for 1..f, and 0 means
    // sustain -- so it tops out at twenty frames and is tied to the instrument
    // rather than the note. A tracker says this with a command, and the command
    // is KILL: put it on the row the note stops on.
    var kills = 0;
    for (ch = 0; ch < 4; ch++) {
      // Drums are one-shots; killing them would cut the sample short.
      if (ch === 3) continue;
      for (var gs = 0; gs < steps; gs++) {
        var here = grid[ch][gs];
        if (!here || !here.note) continue;
        var endsAt = gs + here.len;
        if (endsAt >= steps) continue;
        // find the next note on this channel
        var nxt = -1;
        for (var gt = gs + 1; gt < steps; gt++) if (grid[ch][gt] && grid[ch][gt].note) { nxt = gt; break; }
        if (nxt >= 0 && nxt <= endsAt) continue;       // the next note ends it
        // ...and only if that row is free: a row holds one command, and an
        // arpeggio or a vibrato already there is the more musical thing to keep.
        if (grid[ch][endsAt] && (grid[ch][endsAt].note || grid[ch][endsAt].cmd !== CMD.NONE)) continue;
        grid[ch][endsAt] = { note: NO_NOTE, cmd: CMD.K, val: 0, inst: here.inst, len: 1 };
        kills++;
      }
    }

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
        // THE INSTRUMENT IS PART OF THE PHRASE. Leaving it out of the key merges
        // two bars that play the same notes on different voices into one phrase,
        // and the second one silently changes instrument.
        var key = slots.map(function (s2) {
          return s2 ? s2.note + ':' + s2.cmd + ':' + s2.val + ':' + s2.inst : '-';
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
        song[O.PHRASE_INSTRUMENTS + base + k] = sl ? (sl.inst != null ? sl.inst : phrases[i].ch) : NO_INSTRUMENT;
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

    // ONE INSTRUMENT PER VOICE THE SONG ACTUALLY USES, carrying our own duty and
    // volume rather than a stock blank.
    //
    // The byte layout is MEASURED, not looked up -- vary one byte of instrument
    // 0, play one note, read the APU, and whatever moves is what that byte
    // means (scripts/verify-lsdj-emulator.js keeps it honest):
    //
    //   byte 0   type: 0 pulse, 1 wave, 2 kit, 3 noise
    //   byte 1   high nibble is VOLUME -> NR12 as volume<<4 | 8
    //   byte 3   length
    //   byte 4   sweep, channel 1 only -> NR10
    //   byte 7   bits 6-7 DUTY -> NR11; bits 0-1 pan -> NR51 (3 is both sides)
    //   byte 11  transpose / finetune -> NR13, NR14
    //
    // ⚠️ LSDJ'S ENVELOPE IS SOFTWARE. It writes NR12 repeatedly as a note plays
    // rather than setting the hardware pace once, so byte 1's low nibble is
    // LSDj's own envelope shape and not a DMG field. We write a plain sustain
    // there; matching its shapes means reproducing its stepping, which is not
    // done and is the honest edge of sound parity today.
    for (i = 0; i < instruments.length && i < MAX_INSTRUMENTS; i++) {
      var inst = instruments[i], at = O.INSTRUMENT_PARAMS + i * 16;
      for (var b2 = 0; b2 < 16; b2++) song[at + b2] = DEFAULT_INSTRUMENT[b2];
      song[at] = inst.type;
      song[at + 1] = (Math.max(0, Math.min(15, inst.vol)) << 4);
      if (inst.type === INST_TYPE.PULSE) song[at + 7] = (inst.duty << 6) | 0x03;
      else song[at + 7] = (song[at + 7] & 0xFC) | 0x03;
      // A WAVE INSTRUMENT'S TIMBRE IS ITS TABLE, so pin it to the frame we
      // wrote ours into. Left alone, LSDj ANIMATES through a run of frames --
      // that is its wave synth, and it is a lovely thing that is not what our
      // bass sounds like. Byte 9 = 0x03 holds it on frame 0; measured.
      if (inst.type === INST_TYPE.WAVE) song[at + 9] = 0x03;
      // byte 4 is NR10, measured. Zero is "no sweep", which is the default.
      if (inst.sweep) song[at + 4] = inst.sweep & 0xFF;
      song[O.INSTRUMENT_ALLOC + i] = 1;
      for (var nm = 0; nm < 5; nm++) {
        var chr = inst.name.charCodeAt(nm);
        song[O.INSTRUMENT_NAMES + i * 5 + nm] = chr ? chr : 0;
      }
    }
    // ---- and the wave the bass is actually made of -------------------------
    // Everything above carries the pulse and noise voices. The WAVE voice's
    // whole timbre is its 32-nibble table, and without writing it the export
    // handed LSDj a bass playing the right notes through LSDj's default
    // waveform -- the correct tune in somebody else's voice.
    var waveStamps = {};
    st.cells.forEach(function (x) { if (laneOfCell(x, melRows) === 2 && x.st) waveStamps[x.st] = 1; });
    var usedWaves = Object.keys(waveStamps);
    if (usedWaves.length) {
      var table = waveTableFor(usedWaves[0]);
      if (table) for (i = 0; i < 16; i++) song[O.WAVES + i] = table[i];
      // ⚠️ ONE FRAME. Pinning is what stops LSDj animating through its synth,
      // and the pin found on the machine holds frame 0 specifically -- so a song
      // using two different wave voices has to share one table. Said out loud
      // rather than left for somebody to notice by ear.
      if (usedWaves.length > 1)
        warn.push('this song uses ' + usedWaves.length + ' wave voices (' + usedWaves.join(', ') +
                  ') and a pinned LSDj instrument holds one table, so they share ' +
                  usedWaves[0] + '\'s');
    }
    warn.push('instruments carry the duty, volume and wave table this song plays; ' +
              'LSDj\'s own envelope shapes are left plain, so voicing is still yours to finish');
    warn.push('drums are on the noise channel: a .sav cannot carry kit samples, which live in the ROM');

    // ---- tempo and groove --------------------------------------------------
    // ⚠️ AN LSDJ GROOVE IS IN TICKS, NOT FRAMES, and this wrote our frame counts
    // straight into it. Measured against the real ROM in mGBA: a song we
    // exported as 128 bpm with a 7-frame row played at 8.17 frames a row, which
    // is 110 bpm -- 17% slow, on every song we ever exported.
    //
    // What LSDj actually does, measured the same way across tempo 60..255 with
    // a one-note-per-row ruler song:
    //
    //   ticks per second = 0.4 x TEMPO
    //   frames per tick  = 149.31875 / TEMPO          (149.31875 = 2.5 x FPS)
    //   frames per row   = ticks x 149.31875 / TEMPO
    //
    // so the DEFAULT groove of 6 ticks makes a row 895.9125/TEMPO frames, and
    // TEMPO is then bpm in the ordinary sense with four rows to the beat. That
    // is exactly our own constant, which is the good news: TEMPO carries the
    // tempo unchanged, and the groove only has to carry the SHAPE.
    var FR_PER_TICK_NUM = 149.31875;
    var bpm = Math.max(40, Math.min(255, st.bpm | 0));
    song[O.TEMPO] = bpm;
    // NOTHING IS CONVERTED HERE ANY MORE. The document's groove is already in
    // LSDj ticks, because the composer and the editor both run LSDj's clock --
    // which is the point of the whole exercise. A conversion step is a place for
    // the two sides to disagree, and this one did: it wrote frame counts into
    // the tick field and made every export play 17% slow.
    var ticks = st.groove && st.groove.length ? st.groove.slice() : [6];
    for (i = 0; i < 16; i++) song[O.GROOVES + i] = i < ticks.length ? (ticks[i] & 0xFF) : 0;

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
      // `groove` is TICKS, LSDj's own unit. `framesPerRow` is what that works
      // out to on the machine at this tempo, reported so a caller never has to
      // rediscover the conversion -- which is where the 17% error lived.
      tempo: song[O.TEMPO], groove: ticks.slice(),
      framesPerRow: (function () {
        var s = 0;
        for (var t = 0; t < ticks.length; t++) s += ticks[t];
        return (s / ticks.length) * FR_PER_TICK_NUM / bpm;
      })(),
      title: st.title || ''
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

  /* ------------------------------------------------------- reading a song --- */
  // THE SONG IMAGE, UNDERSTOOD RATHER THAN COPIED.
  //
  // Export alone never needed this: `fromDocument` starts from the empty song
  // and writes fields into it. Import does, and so does the claim that we can
  // hold everything LSDj can -- which is only true if a song LSDj wrote survives
  // being read into our model and written back out UNCHANGED, byte for byte.
  //
  // The map below is the part we UNDERSTAND. Everything outside it is carried in
  // `raw` verbatim, so a round trip is exact from the first day rather than once
  // the last field is done. `coverage()` says how much is understood, and that
  // number is the honest measure of how much of LSDj we actually model. It is
  // meant to go up; the round trip is exact either way.
  var FIELDS = [
    { k: 'phraseNotes',       at: O.PHRASE_NOTES,          n: 255, w: 16 },
    { k: 'grooves',           at: O.GROOVES,               n: 32,  w: 16 },
    // ⚠️ ROW-MAJOR: the sequence is 256 ROWS of four channels, at
    // SEQUENCE + row*4 + channel -- not four channel-length columns. Both
    // readings round-trip byte-for-byte, so identity cannot catch this; what
    // catches it is that the wrong one hands channel 0 every channel's chains
    // interleaved and leaves the other three empty, which is what it did.
    { k: 'sequence',          at: O.SEQUENCE,              n: 256, w: 4 },
    { k: 'instrumentNames',   at: O.INSTRUMENT_NAMES,      n: 64,  w: 5 },
    { k: 'tableAlloc',        at: O.TABLE_ALLOC,           n: 1,   w: 32 },
    { k: 'instrumentAlloc',   at: O.INSTRUMENT_ALLOC,      n: 1,   w: 64 },
    { k: 'chainPhrases',      at: O.CHAIN_PHRASES,         n: 128, w: 16 },
    { k: 'chainTranspose',    at: O.CHAIN_TRANSPOSE,       n: 128, w: 16 },
    { k: 'instrumentParams',  at: O.INSTRUMENT_PARAMS,     n: 64,  w: 16 },
    { k: 'phraseAlloc',       at: O.PHRASE_ALLOC,          n: 1,   w: 32 },
    { k: 'chainAlloc',        at: O.CHAIN_ALLOC,           n: 1,   w: 16 },
    { k: 'tempo',             at: O.TEMPO,                 n: 1,   w: 1 },
    { k: 'transpose',         at: O.TRANSPOSE,             n: 1,   w: 1 },
    { k: 'phraseCommands',    at: O.PHRASE_COMMANDS,       n: 255, w: 16 },
    { k: 'phraseCommandVals', at: O.PHRASE_COMMAND_VALUES, n: 255, w: 16 },
    { k: 'waves',             at: O.WAVES,                 n: 256, w: 16 },
    // TABLES: five 512-byte regions, 32 tables of 16 rows each, found by
    // probing rather than by reading a header. What is measured so far:
    //   * INSTRUMENT BYTE 6 = 0x20 turns a table on. The default is 0x03 and
    //     nothing runs; with 0x20 a held note starts moving.
    //   * The data is in 0x3480..0x3E80 and nowhere else -- filling every other
    //     unmapped gap in the song changes nothing.
    //   * Regions 3 and 4 (0x3A80 and 0x3C80) are the command/value pair: a
    //     table runs with those two alone and with no other combination.
    // ⚠️ NOTHING PLAYS THESE YET. They are named so they are addressable and so
    // the coverage number stops flattering us; `toSongJSON` warns when an
    // imported song uses one.
    { k: 'tables0',           at: 0x3480,                  n: 32,  w: 16 },
    { k: 'tables1',           at: 0x3680,                  n: 32,  w: 16 },
    { k: 'tables2',           at: 0x3880,                  n: 32,  w: 16 },
    { k: 'tableCommands',     at: 0x3A80,                  n: 32,  w: 16 },
    { k: 'tableValues',       at: 0x3C80,                  n: 32,  w: 16 },
    { k: 'phraseInstruments', at: O.PHRASE_INSTRUMENTS,    n: 255, w: 16 },
    { k: 'formatVersion',     at: O.FORMAT_VERSION,        n: 1,   w: 1 }
  ];

  function readSong(song) {
    if (!song || song.length < SONG_BYTES) throw new Error('lsdj: not a song image');
    var m = { raw: Uint8Array.from(song.subarray(0, SONG_BYTES)) }, i, j, f;
    for (i = 0; i < FIELDS.length; i++) {
      f = FIELDS[i];
      if (f.n === 1 && f.w === 1) { m[f.k] = song[f.at]; continue; }
      var rows = [];
      for (j = 0; j < f.n; j++) rows.push(Uint8Array.from(song.subarray(f.at + j * f.w, f.at + (j + 1) * f.w)));
      m[f.k] = f.n === 1 ? rows[0] : rows;
    }
    return m;
  }

  function writeSong(m) {
    // Start from the bytes we were given, so anything the map does not name
    // survives untouched. A field we DO understand is written back from the
    // model, which is what makes an edit to the model actually take effect.
    var song = Uint8Array.from(m.raw || emptySong()), i, j, f, v;
    for (i = 0; i < FIELDS.length; i++) {
      f = FIELDS[i]; v = m[f.k];
      if (v == null) continue;
      if (f.n === 1 && f.w === 1) { song[f.at] = v & 0xFF; continue; }
      var rows = f.n === 1 ? [v] : v;
      for (j = 0; j < rows.length && j < f.n; j++) song.set(rows[j].subarray(0, f.w), f.at + j * f.w);
    }
    return song;
  }

  // THE NOTES A SONG ACTUALLY PLAYS, in the order LSDj plays them.
  //
  // This is the import path, and it is also the only way to check what we wrote
  // against what LSDj does with it: walk the sequence, follow each chain to its
  // phrases, and read the rows. Row numbers are absolute from the start of the
  // song, so they line up with a register trace off the emulator.
  //
  // `note` is LSDj's note BYTE, which is an index into what that channel can
  // play and therefore a different pitch on each one -- NOTE_BASE turns it into
  // MIDI. Zero means no note, and is not a rest you can hear.
  function playedNotes(m, ch) {
    var out = [], row = 0, s, cr, st;
    for (s = 0; s < 256; s++) {
      var chain = m.sequence[s][ch];
      if (chain === NO_CHAIN) continue;
      for (cr = 0; cr < 16; cr++) {
        var ph = m.chainPhrases[chain][cr];
        if (ph === NO_PHRASE) { continue; }
        var tr = m.chainTranspose[chain][cr];
        for (st = 0; st < 16; st++) {
          var n = m.phraseNotes[ph][st];
          if (n !== NO_NOTE) out.push({
            row: row + st, note: n, transpose: tr,
            midi: NOTE_BASE[ch] + (n - 1) + (tr << 24 >> 24),
            instrument: m.phraseInstruments[ph][st],
            command: m.phraseCommands[ph][st], value: m.phraseCommandVals[ph][st]
          });
        }
        row += 16;
      }
    }
    return out;
  }

  /* -------------------------------------------------------------- import --- */
  // A .lsdsng is a name, a version byte, and the compressed song.
  function parseLsdsng(bytes) {
    if (!bytes || bytes.length < 10) throw new Error('lsdj: not a .lsdsng');
    var name = '';
    for (var i = 0; i < 8 && bytes[i]; i++) name += String.fromCharCode(bytes[i]);
    return { name: name, song: decompress(bytes.subarray(9), 1) };
  }

  // The working-memory song of a .sav is UNCOMPRESSED at offset 0 -- it is what
  // the cart opens on, and what LSDj plays when you press START.
  function parseSav(bytes) {
    if (!bytes || bytes.length < SONG_BYTES) throw new Error('lsdj: not a .sav');
    return { song: Uint8Array.from(bytes.subarray(0, SONG_BYTES)) };
  }

  var LANES = ['Melody', 'Harmony', 'Bass', 'Drums'];
  var NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  function noteName(m) { return NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1); }

  // An LSDj song as the plain JSON our own editor speaks. This is the whole
  // import: walk the sequence the way LSDj walks it, and write down what sounds.
  //
  // WHICH DRUM comes back from the INSTRUMENT, not the note. Every drum sounds
  // on the noise channel as the same pitch -- a .sav carries no kit samples,
  // they live in the ROM -- so the note byte cannot tell a kick from a hat. The
  // instrument slot can, because each drum is written to its own, which is also
  // what an LSDj musician would do by hand.
  //
  // NOTE LENGTH comes back from the KILL, when there is one. LSDj stores no
  // length -- a note runs until the next note or a K command -- so a length is
  // exactly "where it stops", and that is a row we wrote. Read the K and the
  // length survives; with no K the note really does run to the next note, and
  // the reconstructed gap is the truth rather than a guess.
  // LSDJ'S ENVELOPE, MEASURED. Byte 1 is volume<<4 | shape, and the shape is a
  // HOLD IN FRAMES before the note is cut -- not a decay curve. Index 0 sustains
  // until something else stops the note, which is what a tracker uses and what
  // we write; 1..f hold for these many frames. Read off the real ROM one value
  // at a time, with notes retriggering so the steps land on separate frames.
  //
  // On the way IN this is how long an imported note lasts, which is a thing our
  // document already knows how to say. A foreign instrument with shape 9 is a
  // four-frame note, and without reading it that note would sustain to the next
  // one -- audibly wrong, and silently so.
  var ENVELOPE_HOLD = [0, 1, 1, 1, 1, 1, 2, 2, 3, 4, 5, 6, 8, 11, 15, 20];

  // The rows a channel is told to STOP on. Same walk as playedNotes, but K
  // commands sit on rows with no note, so that walk cannot see them.
  function killRows(m, ch) {
    var out = [], row = 0, s, cr, st;
    for (s = 0; s < 256; s++) {
      var chain = m.sequence[s][ch];
      if (chain === NO_CHAIN) continue;
      for (cr = 0; cr < 16; cr++) {
        var ph = m.chainPhrases[chain][cr];
        if (ph === NO_PHRASE) continue;
        for (st = 0; st < 16; st++)
          if (m.phraseCommands[ph][st] === CMD.K) out.push(row + st);
        row += 16;
      }
    }
    return out;
  }

  // The table an instrument runs, or null. Byte 6 is 0x20 | index when a table
  // is on and 0x03 by default; only a table whose transposes actually MOVE is
  // worth reporting, because an all-zero table sounds like no table at all.
  function tableOf(m, slot) {
    if (slot == null || slot === NO_INSTRUMENT) return null;
    var p = m.instrumentParams[slot];
    if (!p || (p[6] & 0xE0) !== 0x20) return null;
    var idx = p[6] & 0x1F, rows = m.tables0[idx], i;
    if (!rows) return null;
    for (i = 0; i < 16; i++) if (rows[i]) return idx;
    return null;
  }

  function instrumentName(m, slot) {
    if (slot == null || slot === NO_INSTRUMENT || !m.instrumentNames[slot]) return '';
    var s = '';
    for (var i = 0; i < 5; i++) { var c = m.instrumentNames[slot][i]; if (c) s += String.fromCharCode(c); }
    return s.toLowerCase();
  }
  // A TABLE, PLAYED EXACTLY, in cells rather than as an approximation.
  //
  // A table steps every TICK -- six to a row -- and transposes the note. Our
  // document is row-based, which is why this first arrived as "call it an
  // arpeggio and warn"; but a cell also carries `of` (an offset in FRAMES),
  // `midi` (an exact pitch) and `lf` (an exact length in frames), which between
  // them can put a note anywhere the machine can. That is the same mechanism a
  // composed song already uses to survive import at frame resolution.
  //
  // So a note running a table becomes one cell per tick, each at the frame that
  // tick starts on and at the pitch that tick sounds. Nothing is approximated
  // and nothing needed a new document format.
  function expandTables(m, st, tableNotes, laneRow) {
    var H = (typeof require !== 'undefined' && typeof module !== 'undefined')
      ? require('./gb-hardware.js') : G.CT_GB;
    if (!H || !H.lsdjRowFrame) return 0;
    var ticks = [], t;
    for (t = 0; t < 16 && m.grooves[0][t]; t++) ticks.push(m.grooves[0][t]);
    if (!ticks.length) ticks = [6];
    var perRow = 0;
    for (t = 0; t < ticks.length; t++) perRow += ticks[t];
    perRow = perRow / ticks.length;                       // ticks in a row
    var tempo = Math.max(1, m.tempo || 128), added = 0, out = [];

    // which (lane, step) pairs run a table, from the model rather than the doc
    var want = {};
    tableNotes.forEach(function (n) { want[n.lane + ':' + n.step] = n; });

    st.cells.forEach(function (x) {
      out.push(x);
      var hit = x.midi == null ? null : want[laneRow(x) + ':' + (x.c | 0)];
      if (!hit) return;
      var rows = m.tables0[hit.table];
      if (!rows) return;
      var startRow = x.c | 0, lenRows = Math.max(1, x.len | 0 || 1);
      var startTick = Math.round(startRow * perRow);
      var totalTicks = Math.max(1, Math.round(lenRows * perRow));
      var frame0 = H.lsdjTickFrame(tempo, startTick);
      // the first tick is the note itself; give it the table's row 0 and an
      // exact one-tick length, then lay the rest out beside it
      var tickFrame = function (j) { return H.lsdjTickFrame(tempo, startTick + j); };
      x.midi = (x.midi | 0) + ((rows[0] << 24) >> 24);
      x.lf = Math.max(1, tickFrame(1) - tickFrame(0));
      for (var j = 1; j < totalTicks; j++) {
        var tr = (rows[j % 16] << 24) >> 24;
        var f = tickFrame(j);
        out.push({
          c: startRow, r: x.r, st: x.st, ch: x.ch, inst: x.inst, vel: x.vel,
          midi: (x.midi | 0) - ((rows[0] << 24) >> 24) + tr,
          of: f - frame0,                                  // frames past the row
          lf: Math.max(1, tickFrame(j + 1) - f),
          len: 1
        });
        added++;
      }
    });
    st.cells = out;
    return added;
  }

  function toSongJSON(m, opts) {
    opts = opts || {};
    var warn = [], notes = [], ch, i;
    var ticks = [], t;
    for (t = 0; t < 16 && m.grooves[0][t]; t++) ticks.push(m.grooves[0][t]);
    if (!ticks.length) ticks = [6];
    var known = { hat: 1, snare: 1, kick: 1 };
    // How long a row lasts on this machine, so an envelope hold measured in
    // FRAMES can be turned into the row count our document speaks in.
    var tSum = 0;
    for (t = 0; t < ticks.length; t++) tSum += ticks[t];
    var rowFrames = (tSum / ticks.length) * 149.31875 / Math.max(1, m.tempo || 128);
    var lastRow = 0, unnamedDrums = 0, tableNotes = [], vibratoNotes = [];
    for (ch = 0; ch < 4; ch++) {
      var played = playedNotes(m, ch), kills = killRows(m, ch);
      for (i = 0; i < played.length; i++) {
        var n = played[i], next = played[i + 1];
        // Where does this note STOP? A KILL before the next note is the answer
        // and is exact; otherwise it runs to the next note, which is also exact
        // because that is what LSDj does.
        var stop = next ? next.row : n.row + 1;
        for (var ki = 0; ki < kills.length; ki++)
          if (kills[ki] > n.row && kills[ki] < stop) { stop = kills[ki]; break; }
        var len = Math.max(1, Math.min(16, stop - n.row));
        // ...and an instrument with a HOLD ends the note sooner than either.
        // LSDj's envelope cuts it after that many frames whatever the phrase
        // says, so the shorter of the two is what a listener hears.
        var ip = m.instrumentParams[n.instrument];
        if (ip && (ip[1] & 0x0F)) {
          var holdFrames = ENVELOPE_HOLD[ip[1] & 0x0F];
          var rowsHeld = Math.max(1, Math.round(holdFrames / rowFrames));
          if (rowsHeld < len) len = rowsHeld;
        }
        if (n.row > lastRow) lastRow = n.row;
        if (ch === 3) {
          var nm2 = instrumentName(m, n.instrument);
          if (!known[nm2]) { unnamedDrums++; nm2 = 'kick'; }
          notes.push({ lane: 'Drums', step: n.row, drum: nm2, len: 1 });
        } else {
          // ...AND THE VOICE IT WAS PLAYED WITH. Without this an imported song
          // plays back in OUR default timbre at OUR default loudness, which is
          // the app performing somebody else's notes rather than their song.
          // The instrument in the file says both: byte 1's high nibble is the
          // volume, byte 7's top two bits are the duty.
          var p = m.instrumentParams[n.instrument];
          var note = { lane: LANES[ch], step: n.row, note: noteName(n.midi), len: len };
          // THE COMMAND IS PART OF THE NOTE. An arpeggio is C and a roll is R on
          // the way out; without reading them back, a song exported with either
          // came home plain, and the round trip quietly flattened the gestures
          // it had just written.
          if (n.command === CMD.C) note.motion = 'arp';
          else if (n.command === CMD.R) note.motion = 'roll';
          // A TABLE THAT MOVES THE PITCH IS AN ARPEGGIO, and that is a thing our
          // document can say. Measured: instrument byte 6 = 0x20 | index turns
          // one on, the transposes live at 0x3480 + table*16 + row, and a row
          // runs every TICK -- six to a row -- looping through all sixteen.
          //
          // ⚠️ THIS IS AN APPROXIMATION AND THE WARNING SAYS SO. A table can do
          // far more than an arpeggio, and ours runs at the renderer's own rate
          // rather than the table's, because our document is ROW-based and a
          // table is per-TICK. It gets the character; it does not get the table.
          // VIBRATO is written on the way out and was dropped on the way in --
          // the same one-way asymmetry the arpeggio and the roll had. The
          // document carries it as a cell flag rather than a motion, so it is
          // set in the state pass alongside the tables.
          else if (n.command === CMD.V) vibratoNotes.push({ lane: ch, step: n.row });
          var tbl = tableOf(m, n.instrument);
          if (tbl != null) tableNotes.push({ lane: ch, step: n.row, table: tbl, len: len });
          // ...and a sweep is a fall or a rise, read off the instrument's NR10.
          // Bit 3 set means the frequency decreases, which is the pitch falling.
          else if (p && p[4]) note.motion = (p[4] & 0x08) ? 'fall' : 'rise';
          if (p) {
            note.velocity = Math.max(0.05, Math.min(1, (p[1] >> 4) / 15));
            // 75% duty is 25% inverted -- the same timbre on this chip -- so it
            // shares a stamp rather than inventing one that sounds identical.
            note.stamp = ch === 2 ? 'bassg' : ['bell', 'trumpet', 'piano', 'trumpet'][(p[7] >> 6) & 3];
          }
          notes.push(note);
        }
      }
    }
    if (unnamedDrums) warn.push(unnamedDrums + ' drums came back as kicks: their instrument was ' +
                                'not one this app names, and the noise channel cannot say which drum it was');
    // ⚠️ TABLES ARE NOT PLAYED. An LSDj table is a per-instrument modulation
    // sequence -- a transpose and two commands per tick -- and nothing here
    // reads or runs one. A song of ours never uses them, so this only fires on
    // a song somebody else wrote, and it is exactly the case where staying
    // quiet would be worst: the notes would all arrive and the song would still
    // be wrong, with nothing saying why.
    var tablesUsed = {}, ti;
    for (ch = 0; ch < 4; ch++) playedNotes(m, ch).forEach(function (n) {
      var t = tableOf(m, n.instrument);
      if (t != null) tablesUsed[t] = 1;
    });
    var tableCount = Object.keys(tablesUsed).length;
    if (tableCount) warn.push(tableCount + ' LSDj table' + (tableCount > 1 ? 's' : '') +
      ' played out into notes, one per tick, at the pitch and the frame each tick ' +
      'sounds -- so they play exactly rather than approximately');
    // Commands we do not act on, counted rather than silently dropped.
    var unknownCmds = {};
    for (ch = 0; ch < 4; ch++) playedNotes(m, ch).forEach(function (n) {
      if (n.command && n.command !== CMD.C && n.command !== CMD.R &&
          n.command !== CMD.K && n.command !== CMD.V)
        unknownCmds[n.command] = (unknownCmds[n.command] || 0) + 1;
    });
    var unknownTotal = Object.keys(unknownCmds).reduce(function (a, k) { return a + unknownCmds[k]; }, 0);
    if (unknownTotal) warn.push(unknownTotal + ' notes carry an LSDj command this app does not ' +
      'play (C, R, K and V are understood); the notes arrive, the effect does not');
    notes.sort(function (a, b) { return a.step - b.step; });
    return {
      json: {
        title: (opts.name || 'Imported').slice(0, 48),
        grid: 16, bpm: Math.max(70, Math.min(180, m.tempo || 128)),
        bars: Math.max(1, Math.ceil((lastRow + 1) / 16)),
        notes: notes
      },
      groove: ticks, tempo: m.tempo, warnings: warn,
      tableNotes: tableNotes, vibratoNotes: vibratoNotes
    };
  }

  // How much of a song image the map above accounts for, as bytes and percent.
  function coverage() {
    var seen = 0, i, f;
    for (i = 0; i < FIELDS.length; i++) { f = FIELDS[i]; seen += f.n * f.w; }
    return { bytes: seen, total: SONG_BYTES, percent: 100 * seen / SONG_BYTES };
  }

  var API = {
    SONG_BYTES: SONG_BYTES, SAV_SIZE: SAV_SIZE, SAV_PROJECTS: SAV_PROJECTS,
    OFFSETS: O, COMMANDS: CMD, sav: sav, FIELDS: FIELDS,
    NOTE_BASE: NOTE_BASE.slice(), NOTE_MAX: NOTE_MAX, PHRASE_STEPS: PHRASE_STEPS,
    compress: compress, decompress: decompress, emptySong: emptySong,
    fromDocument: fromDocument, lsdsng: lsdsng,
    readSong: readSong, writeSong: writeSong, coverage: coverage, playedNotes: playedNotes,
    expandTables: expandTables, tableOf: tableOf,
    parseLsdsng: parseLsdsng, parseSav: parseSav, toSongJSON: toSongJSON
  };
  G.CT_LSDJ = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : window);
