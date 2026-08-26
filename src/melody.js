// Melodic writing: phrases that answer each other.
//
// The previous generator picked ONE learned interval cell and cycled it for the
// whole song, so the tune was periodic by construction -- and because the
// learned cells are dominated by "0,0,0,0" (162,831 hits vs 9,100 for the next,
// an artefact of counting sustained notes as zero-intervals), the common case
// was a single pitch repeated. Same for rhythm: "1-1-1-1" outweighs everything.
//
// Those statistics are a DISTRIBUTION to sample, not a riff to loop. Here each
// note draws its own interval, steered by a contour plan, and phrases are
// written in question/answer pairs where the answer TRANSFORMS the question
// (sequence, inversion, or a re-harmonised ending) instead of repeating it.
(function (G) {
  'use strict';

  var CONTOURS = ['arch', 'rise', 'fall', 'wave', 'valley'];

  // Flatten learned 4-note cells into a weighted pool of single intervals.
  // Zero-motion is kept but heavily discounted: real melodies do repeat notes,
  // just not 94% of the time.
  function intervalPool(cells, semiDegree) {
    var pool = [];
    (cells || []).forEach(function (c) {
      var w = c.count || c.tracks || 1;
      String(c.id).split(',').forEach(function (tok) {
        var semis = Number(tok);
        if (!isFinite(semis)) return;
        var d = semiDegree(semis);
        pool.push({ d: d, w: d === 0 ? w * 0.02 : w });     // 50x discount on "no move"
      });
    });
    if (!pool.length) [-2, -1, 1, 1, 2].forEach(function (d) { pool.push({ d: d, w: 1 }); });
    return pool;
  }

  function sample(r, pool) {
    var total = 0, i;
    for (i = 0; i < pool.length; i++) total += pool[i].w;
    var at = r() * total;
    for (i = 0; i < pool.length; i++) { at -= pool[i].w; if (at <= 0) return pool[i].d; }
    return pool[pool.length - 1].d;
  }

  // Where the line should sit at position t (0..1) of a phrase, in degrees
  // above the phrase's starting note.
  function contourAt(shape, t, span) {
    switch (shape) {
      case 'rise':   return span * t;
      case 'fall':   return span * (1 - t) - span;
      case 'valley': return -span * Math.sin(Math.PI * t);
      case 'wave':   return span * Math.sin(2 * Math.PI * t) * 0.6;
      default:       return span * Math.sin(Math.PI * t);      // arch
    }
  }

  // A rhythm for one bar: sample a learned cell, then vary it so the same
  // pattern never runs the whole song. Returns 16th-grid positions.
  function barRhythm(r, cells, density, vary) {
    var cell = null, total = 0, i;
    (cells || []).forEach(function (c) { total += (c.count || c.tracks || 1); });
    if (total) {
      var at = r() * total;
      for (i = 0; i < cells.length; i++) {
        at -= (cells[i].count || cells[i].tracks || 1);
        if (at <= 0) { cell = cells[i]; break; }
      }
    }
    var gaps = cell ? String(cell.id).split('-').map(Number).filter(function (n) { return n > 0; })
                    : [2, 2, 2, 2];
    var pos = [], at2 = 0, gi = 0;
    while (at2 < 16) {
      pos.push(at2);
      var g = gaps[gi++ % gaps.length] || 2;
      if (vary) {
        if (r() < 0.22) g = Math.max(1, g - 1);          // push a note earlier
        else if (r() < 0.18) g += 1;                     // let one breathe
      }
      at2 += Math.max(1, g);
    }
    // thin to the requested density, always keeping the downbeat
    return pos.filter(function (p, ix) { return ix === 0 || r() < density; });
  }

  /**
   * @returns [{ bar, pos16, degree, dur16, accent }]
   */
  function write(opts) {
    var r = opts.rng, hash = opts.hash, model = opts.model;
    var semiDegree = opts.semiDegree, bars = opts.bars, sections = opts.sections;
    var rootAt = opts.rootAt;                       // bar -> chord root degree
    var lead = (model && model.roleModels && model.roleModels.lead) || {};
    var pool = intervalPool(lead.intervalCells, semiDegree);
    var rcells = lead.rhythmCells || [];
    var out = [];

    // This is radio you put on behind something, not an album. A tune that
    // never stops takes the attention; real background game music states an
    // idea, leaves, and comes back. So melody arrives in EPISODES -- a couple
    // of phrase groups on, then a stretch off -- and how melodic a given song
    // is at all varies from song to song, so some tracks are carried by texture
    // and some by a hook.
    // THE THEME RETURNS. The old writer generated brand-new material for every
    // 4-bar group -- new contour, new span, new rhythm -- and its answer rule
    // said "never repeat". A song where nothing recurs is noodling: repetition
    // is what turns a phrase into a tune (Margulis' On Repeat experiments --
    // splicing literal repeats into even atonal music made listeners rate it
    // more enjoyable and more human). So a song now owns TWO phrases, A and B,
    // written once and restated in an AABA rotation, transposed diatonically to
    // sit on the local chord. The cadence note still re-resolves per return.
    // MOTIF-BUILT, not walked. The owner's verdict on the walk was exact:
    // "the overall patterns of when notes play sound mostly correct" but the
    // pitches read as random. A random walk IS random -- steering it toward a
    // contour cannot make it a sentence. So a phrase is now built the way a
    // person writes one: a short motif (one bar of rhythm plus an interval
    // shape) is STATED on a chord tone, restated following the harmony,
    // developed higher or inverted, and closed with a stepwise cadence run
    // onto a goal tone. Every strong beat is a chord tone by construction;
    // everything between moves by step; the motif's own rhythm stamps all
    // four bars, which is what makes it register as a motif at all.
    var scaleLen = opts.scaleLen || 7;
    // Snap a degree offset onto the TRIAD, in any octave. Rounding to even
    // degrees is wrong past the fifth: +6 is the seventh and +8 wraps to the
    // second. The chord-tone set is {0,2,4} modulo the scale length.
    function snapChord(rel) {
      var base = Math.floor(rel / scaleLen) * scaleLen, r = rel - base, best = 0, bd = 99;
      [0, 2, 4, scaleLen].forEach(function (c) { var d = Math.abs(c - r); if (d < bd) { bd = d; best = c; } });
      return base + best;
    }
    var MOTIF_RH = [[0,4,8,12],[0,4,8],[0,6,8,12],[0,4,10],[0,8,12],[0,3,8,11],[0,4,8,11],[0,2,4,8]];
    // The corpus carries 96 rhythm cells from real GB music and the hard pool
    // above is eight. Over half of motifs now draw their rhythm from the
    // corpus (a cell is note gaps in 16ths: '1-1-2-1' becomes positions), so
    // the phrase vocabulary is measured, not invented.
    function corpusRhythm() {
      var cells = rcells; if (!cells || !cells.length) return null;
      var total = 0, i; for (i = 0; i < cells.length; i++) total += (cells[i].count || cells[i].tracks || 1);
      var at = r() * total, cell = null;
      for (i = 0; i < cells.length; i++) { at -= (cells[i].count || cells[i].tracks || 1); if (at <= 0) { cell = cells[i]; break; } }
      if (!cell) return null;
      var gaps = String(cell.id).split('-').map(Number).filter(function (n) { return n > 0; });
      if (!gaps.length) return null;
      var pos = [], p = 0, gi = 0;
      while (p < 16 && pos.length < 6) { pos.push(p); p += Math.max(1, gaps[gi++ % gaps.length]); }
      return pos.length >= 2 ? pos : null;
    }
    var MOTIF_SHAPE = [[0,1,2],[0,2,1],[0,-1,-2],[0,2,4],[0,-1,1],[0,1,-1],[0,2,0],[0,-2,-1],[0,1,3],[0,3,2]];
    var themes = {};
    function materialize(letter, bar, role) {
      var rh = (hash(opts.token + ':mtf-src:' + letter) % 100 < 55 ? corpusRhythm() : null)
             || MOTIF_RH[hash(opts.token + ':mtf-rh:' + letter) % MOTIF_RH.length];
      // style density: sparse styles state their motif with fewer notes
      var md = opts.melDensity == null ? 1 : opts.melDensity;
      if (md < 1 && rh.length > 2) rh = rh.slice(0, Math.max(2, Math.ceil(rh.length * md)));
      var shape = MOTIF_SHAPE[hash(opts.token + ':mtf-sh:' + letter) % MOTIF_SHAPE.length];
      var homeRoot = rootAt(bar);
      // anchors: which chord tone each statement of the motif sits on.
      // bar 0 states, bar 1 follows the harmony, bar 2 lifts (development),
      // bar 3 is the cadence run. Question ends open; the answer's cadence is
      // re-resolved onto the coming chord at every return (see below).
      // the octave anchor is the anthem register -- the hook that leaps up and
      // holds is the most chipzel move there is
      var anchorOff = [2, 4, scaleLen][hash(opts.token + ':mtf-a0:' + letter) % 3];
      var notes = [];
      function state(rb, anchor, inv, segRoot) {
        for (var i = 0; i < rh.length && i < shape.length + 1; i++) {
          var off = shape[Math.min(i, shape.length - 1)];
          if (inv) off = -off;
          var d = anchor + off;
          // the mid-bar strong beat is a chord tone too, not just the downbeat:
          // round its distance from the chord root onto the triad (even degrees)
          if (rh[i] % 8 === 0) d = segRoot + snapChord(d - segRoot);
          notes.push({ rb: rb, pos16: rh[i], deg: d, accent: rb === 0 && i === 0 });
        }
      }
      state(0, homeRoot + anchorOff, false, homeRoot);
      state(1, rootAt(bar + 1) + anchorOff, false, rootAt(bar + 1));
      // development leans UPWARD (2 of 3): rising restatements lift, inverted
      // ones brood.
      var dev = hash(opts.token + ':mtf-dev:' + letter) % 3 < 2;
      state(2, rootAt(bar + 2) + anchorOff + (dev ? 2 : 0), !dev, rootAt(bar + 2));
      // cadence: a stepwise 3-2-1 run that LANDS ON THE ROOT. The old goal was
      // the 2nd degree -- the unresolved tone, which is the sound of longing.
      // Phrases that resolve are what "fun" is made of; the per-return re-aim
      // still steers the final note onto whatever chord comes next.
      var goal = rootAt(bar + 3);
      [0, 4, 8].forEach(function (p, i) {
        notes.push({ rb: 3, pos16: p, deg: goal + (2 - i), accent: false, answer: i === 2 });
      });
      return { notes: notes, homeRoot: homeRoot };
    }

    // Capped at .64: the smoke contract holds the lead under 72% of bars (this
    // is background radio), and the AABA rotation plus the sparse-section
    // override lands above that when presence runs to .75.
    var presence = (0.28 + (hash(opts.token + ':mel-presence') % 37) / 100)
                 * Math.min(1.15, Math.max(0.55, opts.melDensity == null ? 1 : opts.melDensity));
    var onRun  = 1 + hash(opts.token + ':mel-onrun') % 2;                    // 1-2 groups
    var offRun = Math.max(1, Math.round(onRun * (1 - presence) / Math.max(0.2, presence)));
    var cycle = onRun + offRun;
    var group = 0, played = 0, eligible = 0;
    for (var bar = 0; bar < bars; bar += 4, group++) {
      var sec = null;
      for (var s = 0; s < sections.length; s++) {
        if (bar >= sections[s].startBar && bar < sections[s].startBar + sections[s].bars) sec = sections[s];
      }
      var role = sec ? sec.role : 'drop';
      if (role === 'resolve') continue;
      // When the texture thins out, the tune is what is left holding the song
      // up -- that is what a break is FOR. So the episode rest is suspended in
      // sparse sections rather than compounding their silence.
      var sparse = role === 'break' || role === 'hush' || role === 'opening';
      eligible++;
      // HARD budget, not a probabilistic one. The sparse-section override plays
      // unconditionally, so a song whose form is mostly breaks and hushes blew
      // straight through the presence dice -- 78% of bars carried lead against
      // the 72% attention contract. Whatever the dice say, the lead stops when
      // it has already had two thirds of the song.
      if (played > 0 && (played + 1) / eligible > 0.62) continue;
      if (!sparse && (group % cycle) >= onRun) continue;
      if (!sparse && hash(opts.token + ':mel-skip:' + group) % 9 === 0) continue;

      // "Keeps playing the same sections over and over": two phrases for a
      // whole song was too few. Three now, rotating AABA CCBA -- the back half
      // opens with NEW material (C) before the theme comes home, so the second
      // minute is not a rerun of the first.
      var letter = ['A','A','B','A','C','C','B','A'][played % 8];
      played++;
      if (!themes[letter]) themes[letter] = materialize(letter, bar, role);
      var th = themes[letter];
      var lift = rootAt(bar) - th.homeRoot;          // diatonic transposition onto the local chord
      var firstReturn = played <= 1 || letter === 'B';
      var lastIdx = -1;
      th.notes.forEach(function (n, ix) {
        var ob = bar + n.rb;
        if (ob >= bars) return;
        // A return is the same phrase BREATHING, not a stamp: after the first
        // statement, one note in seven sits out. Enough that no two returns
        // are byte-identical, never enough to lose the tune.
        if (!firstReturn && !n.accent && !n.answer
            && hash(opts.token + ':mel-var:' + group + ':' + ix) % 7 === 0) return;
        out.push({ bar: ob, pos16: n.pos16, degree: n.deg + lift,
                   accent: n.accent, answer: !!n.answer });
        if (n.answer) lastIdx = out.length - 1;
      });
      // the cadence still lands on the chord that is coming, every time
      if (lastIdx >= 0) out[lastIdx].degree = rootAt(Math.min(bars - 1, bar + 4));
    }
    return out;
  }

  var API = { write: write, CONTOURS: CONTOURS, intervalPool: intervalPool };
  G.CT_MELODY = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : window);
