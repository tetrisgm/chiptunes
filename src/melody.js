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
    // The fallback pool was eight figures and six of them sat on the 0/4/8/12
    // grid, so when the corpus was not used the bar came out square. These add
    // anacrusis (entering off the downbeat), syncopation across the half-bar,
    // and dotted groupings, which is most of what the old pool could not say.
    var MOTIF_RH = [[0,4,8,12],[0,4,8],[0,6,8,12],[0,4,10],[0,8,12],[0,3,8,11],[0,4,8,11],[0,2,4,8],
                    [0,3,6,9],[0,6,12],[2,6,10,14],[0,2,6,8,14],[0,5,10],[3,7,11,15],
                    [0,1,4,8,9,12],[0,4,7,10,14],[2,4,8,12],[0,6,10,12],[0,3,4,8,11,12],[6,8,12,14]];
    // The corpus carries 96 rhythm cells from real GB music and the hard pool
    // above is eight. Over half of motifs now draw their rhythm from the
    // corpus (a cell is note gaps in 16ths: '1-1-2-1' becomes positions), so
    // the phrase vocabulary is measured, not invented.
    // THE CORPUS COUNTS WINDOWS, NOT DECISIONS, and that had collapsed the
    // whole station onto one rhythm. The cells were mined by sliding a window
    // over real Game Boy leads, so a 32-note run of straight sixteenths emits
    // 29 overlapping '1-1-1-1's. Weighting by raw count therefore measures HOW
    // LONG a figure ran, not how often anyone chose it: '1-1-1-1' took 69% of
    // the draw and the effective vocabulary of a 96-cell corpus was 5.7 cells.
    // Compressing by sqrt -- the same thing chipPatch already does to
    // instrument weights -- leaves the ordering intact and the straight run
    // still the single most common figure at 16%, while the effective
    // vocabulary goes to 58. Measured both ways in verify-rhythm.
    function cellWeight(c) { return Math.sqrt(c.count || c.tracks || 1); }
    function corpusRhythm() {
      var cells = rcells; if (!cells || !cells.length) return null;
      var total = 0, i; for (i = 0; i < cells.length; i++) total += cellWeight(cells[i]);
      var at = r() * total, cell = null;
      for (i = 0; i < cells.length; i++) { at -= cellWeight(cells[i]); if (at <= 0) { cell = cells[i]; break; } }
      if (!cell) return null;
      var gaps = String(cell.id).split('-').map(Number).filter(function (n) { return n > 0; });
      if (!gaps.length) return null;
      // ROTATE rather than always entering at gaps[0]. Reading one cell from a
      // different starting gap is a different figure built of the same
      // material, which is what a composer does with one; strict cycling from
      // index 0 is what made every bar the same shape.
      var rot = Math.floor(r() * gaps.length);
      var pos = [], p = 0, gi = 0;
      while (p < 16 && pos.length < 8) { pos.push(p); p += Math.max(1, gaps[(rot + gi++) % gaps.length]); }
      return pos.length >= 2 ? pos : null;
    }
    var MOTIF_SHAPE = [[0,1,2],[0,2,1],[0,-1,-2],[0,2,4],[0,-1,1],[0,1,-1],[0,2,0],[0,-2,-1],[0,1,3],[0,3,2]];
    var themes = {};
    function materialize(letter, bar, role) {
      var rh = (hash(opts.token + ':mtf-src:' + letter) % 100 < 55 ? corpusRhythm() : null)
             || MOTIF_RH[hash(opts.token + ':mtf-rh:' + letter) % MOTIF_RH.length];
      // AT WHAT SPEED IS THE FIGURE STATED? Everything was written at the
      // sixteenth, and the corpus cells are mined at the sixteenth too, so
      // essentially every gap in every song was a 1 or a 2 -- an effective
      // vocabulary of five spacings across the whole station. Stating the same
      // figure at the eighth is not a different figure, it is the ordinary
      // thing a composer does with one, and it moves the gaps to 2 and 4.
      var aug = [1, 1, 1, 2, 2][hash(opts.token + ':mtf-aug:' + letter) % 5];
      if (aug > 1) {
        var wide = [];
        for (var ai = 0; ai < rh.length; ai++) {
          var q = rh[0] + (rh[ai] - rh[0]) * aug;
          if (q < 16) wide.push(q);
        }
        if (wide.length >= 2) rh = wide;
      }
      // A straight run is a real chip figure, but a cell of all-ones now fills
      // the whole bar (the four-note cap used to hide that), and eight even
      // sixteenths every time it comes up is its own kind of sameness. Thin the
      // long even ones into something with a shape.
      if (rh.length >= 6) {
        var even = true;
        for (var ei = 2; ei < rh.length; ei++) if (rh[ei] - rh[ei-1] !== rh[1] - rh[0]) { even = false; break; }
        if (even) {
          var keep = [], drop = hash(opts.token + ':mtf-thin:' + letter) % 3;
          for (var ki = 0; ki < rh.length; ki++)
            if (ki === 0 || ki % 3 !== drop) keep.push(rh[ki]);
          if (keep.length >= 3) rh = keep;
        }
      }
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
      // A MOTIF IS RESTATED, NOT PHOTOCOPIED. One rhythm used to stamp every bar
      // of the phrase unchanged, which is the '1234 1234 1234' the station kept
      // playing. These are the standard ways of restating a figure so it stays
      // recognisably itself: displace it, thin it, halve its speed, or drop its
      // tail. The statement bars keep it literal -- that is what makes it
      // register as a motif -- and the development bar is where it moves.
      function varyRh(src, kind) {
        var out = src.slice(), i;
        if (kind === 1) {                                   // displacement
          var by = 2; out = [];
          for (i = 0; i < src.length; i++) if (src[i] + by < 16) out.push(src[i] + by);
        } else if (kind === 2) {                            // fragmentation
          out = src.slice(0, Math.max(2, Math.ceil(src.length / 2)));
        } else if (kind === 3) {                            // augmentation
          out = []; for (i = 0; i < src.length; i++) { var q = src[0] + (src[i] - src[0]) * 2; if (q < 16) out.push(q); }
        } else if (kind === 4 && src.length > 2) {          // truncation
          out = src.slice(0, src.length - 1);
        }
        return out.length >= 2 ? out : src;
      }
      function state(rb, anchor, inv, segRoot, rhOv) {
        var use = rhOv || rh;
        // NO 4-NOTE CAP. It read `i < shape.length + 1` and every contour in
        // MOTIF_SHAPE is three long, so every bar of every song was truncated
        // to four notes no matter how much rhythm the cell actually carried --
        // which is why the station only ever played one, two, three, four.
        // The contour cycles instead, which turns a longer rhythm into a
        // sequence of the same figure rather than a severed one.
        for (var i = 0; i < use.length; i++) {
          var off = shape[i % shape.length];
          if (inv) off = -off;
          var d = anchor + off;
          // the mid-bar strong beat is a chord tone too, not just the downbeat:
          // round its distance from the chord root onto the triad (even degrees)
          if (use[i] % 8 === 0 || i === 0) d = segRoot + snapChord(d - segRoot);
          notes.push({ rb: rb, pos16: use[i], deg: d, accent: rb === 0 && i === 0 });
        }
      }
      state(0, homeRoot + anchorOff, false, homeRoot);
      // A VARIED RESTATEMENT, not a photocopy. Bars 0 and 1 used the identical
      // figure, which is half of what "it plays 1234 1234" was. The head stays
      // literal so the ear still hears the same idea; the tail moves. That is
      // the difference between a motif being restated and a bar being repeated.
      var reKind = hash(opts.token + ':mtf-re:' + letter) % 5;
      var rh1 = rh;
      if (reKind < 3 && rh.length >= 3) {
        var head = Math.max(2, Math.floor(rh.length / 2));
        rh1 = rh.slice(0, head);
        var tail = rh.slice(head), shift = reKind === 0 ? 1 : reKind === 1 ? -1 : 2;
        for (var ti = 0; ti < tail.length; ti++) {
          var q = tail[ti] + shift;
          if (q < 16 && q > rh1[rh1.length - 1]) rh1.push(q);
        }
        if (rh1.length < 2) rh1 = rh;
      }
      state(1, rootAt(bar + 1) + anchorOff, false, rootAt(bar + 1), rh1);
      // development leans UPWARD (2 of 3): rising restatements lift, inverted
      // ones brood. And it is where the RHYTHM moves too, not only the pitch.
      var dev = hash(opts.token + ':mtf-dev:' + letter) % 3 < 2;
      var devKind = hash(opts.token + ':mtf-vary:' + letter) % 5;
      state(2, rootAt(bar + 2) + anchorOff + (dev ? 2 : 0), !dev, rootAt(bar + 2),
            varyRh(rh, devKind));
      // cadence: a stepwise 3-2-1 run that LANDS ON THE ROOT. The old goal was
      // the 2nd degree -- the unresolved tone, which is the sound of longing.
      // Phrases that resolve are what "fun" is made of; the per-return re-aim
      // still steers the final note onto whatever chord comes next.
      var goal = rootAt(bar + 3);
      // The cadence used to be [0,4,8] -- literally the same three positions in
      // every phrase of every song, which is a quarter of all the melodic bars
      // the station has ever played, and it is where the "three then a long
      // one" came from. The run still walks stepwise down onto the goal tone,
      // because that is what makes it a cadence; only its rhythm varies.
      var CAD = [[0,4,8],[0,2,4],[0,4,10],[0,6,12],[4,8,12],[0,3,6],[2,6,10],[0,4,12],[0,8,12],[6,10,12]];
      var cad = CAD[hash(opts.token + ':mtf-cad:' + letter) % CAD.length];
      cad.forEach(function (p, i) {
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
