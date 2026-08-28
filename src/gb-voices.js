// Voice allocation as a compositional act.
//
// A Game Boy composer does not write music and then discover it does not fit --
// they decide, while writing, that the second pulse plays the arpeggio and that
// the kick borrows it for two frames. This module is that decision made
// explicit: every note is placed onto a specific channel at a specific frame,
// and a channel physically cannot hold two notes at once, so nothing
// downstream ever has to remove anything.
//
// Placement is last-note-priority, exactly like a tracker: writing a note onto
// a busy channel truncates what was sounding. That is not data loss, it is how
// the hardware behaves and how the music was always meant to be heard.
(function (G) {
  'use strict';
  var H = (typeof require !== 'undefined' && typeof module !== 'undefined')
    ? require('./gb-hardware.js') : G.CT_GB;

  function Voices(bpm) {
    this.bpm = bpm;
    this.lanes = [[], [], [], []];
  }

  Voices.prototype.frameOf = function (beat) { return H.beatToFrame(beat, this.bpm); };

  // Notes arrive in whatever order the composer thinks of them (drums come in
  // three passes, melody later still), so placement records intent and the
  // hardware truth is resolved in collect(). Priority decides who wins a
  // contested frame: a kick beats a hat, a melody note beats an arpeggio step.
  Voices.prototype.place = function (ch, frame, frames, midi, inst, vel, pri, sweep) {
    if (ch == null || ch < 0 || ch > 3) return false;
    // A MELODIC NOTE WITHOUT A PITCH IS NOT A NOTE. The composer emits a few
    // per song (an echo whose source had none), and on the hardware they
    // become a period-0 note -- a click at the bottom of the range. Only the
    // noise channel has no pitch to speak of.
    if (ch !== 3 && midi == null) return false;
    frame = Math.max(0, Math.round(frame));
    frames = Math.max(1, Math.round(frames));
    if (midi != null) {
      var fam = ch === 2 ? 'wave' : 'pulse';
      var r = H.RANGE[fam], m = Math.round(midi);
      while (m < r.lo) m += 12;                 // fold by octaves, never clamp:
      while (m > r.hi) m -= 12;                 // clamping flattens a line
      midi = m;
    }
    var note = { ch: ch, frame: frame, frames: frames, midi: midi,
                 inst: inst, vel: Math.max(0.05, Math.min(1, vel)),
                 pri: pri || 0 };
    if (sweep) note.sweep = sweep & 0xFF;
    this.lanes[ch].push(note);
    return true;
  };

  Voices.prototype.collect = function () {
    var out = [];
    for (var c = 0; c < 4; c++) {
      var lane = this.lanes[c].slice();
      // highest priority first at equal frames, so the winner is kept
      lane.sort(function (a, b) { return a.frame - b.frame || b.pri - a.pri; });
      var kept = [];
      for (var i = 0; i < lane.length; i++) {
        var n = lane[i], prev = kept.length ? kept[kept.length - 1] : null;
        if (prev) {
          if (n.frame === prev.frame) continue;              // lost the frame
          if (prev.frame + prev.frames > n.frame)            // truncate, tracker-style
            prev.frames = n.frame - prev.frame;
        }
        if (n.frames > 0) kept.push(n);
      }
      for (var k = 0; k < kept.length; k++) if (kept[k].frames > 0) out.push(kept[k]);
    }
    out.sort(function (a, b) { return a.frame - b.frame || a.ch - b.ch; });
    return out;
  };

  var API = { Voices: Voices };
  G.CT_GB_VOICES = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : window);
