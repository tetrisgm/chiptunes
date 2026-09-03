// IS IT ALL STARTING TO SOUND THE SAME?
//
// Every cohesion device is a way to make a generator boring: shared keys,
// shared palettes, shared motifs, scene presets, mood recipes. Each one is
// individually reasonable and the cumulative effect is that everything sounds
// alike. That has happened to this project before, and it is the failure the
// owner cares about most.
//
// So it is measured, on every run, and the build fails if variety drops. The
// thresholds below are floors with real headroom, not the current numbers
// rounded down -- a gate set to today's measurement fails on noise and gets
// deleted. If a change moves any of these materially, that is the signal.
//
// What is measured, and why:
//   * DISTINCT OPENINGS -- two songs that begin with the same eight notes are
//     the same song to a listener, whatever the rest does.
//   * PITCH-CLASS SIMILARITY -- cosine distance between the notes each song
//     actually uses. High similarity across a batch means one harmonic world.
//   * TEMPO SPREAD -- a generator collapsing onto one tempo is the first sign.
//   * ACROSS vs WITHIN -- cues inside ONE soundtrack are meant to be related.
//     Two DIFFERENT soundtracks sharing anything is the actual bug.
'use strict';
const path = require('path');
const api = require(path.join(__dirname, '..', 'src', 'api.js'));
const CT = require(path.join(__dirname, '..', 'src', 'create.js'));

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fail++; };

// The signature is LANE-TAGGED and drawn from every voice. Two earlier versions
// of this were wrong in opposite directions:
//   * all lanes flattened together -- fine for identity, but useless for
//     intervals, because it interleaves a bass line into the melody;
//   * Melody only -- which looks more precise and is worse, because plenty of
//     cues have no melody in the first bars, and every one of those produced an
//     EMPTY signature and collided with all the others.
// Tagging the lane keeps both voices in the identity without pretending they
// are one line, and sixteen notes makes an accidental collision vanishingly
// unlikely without hiding a real one.
function features(doc) {
  const st = CT.docState(doc);
  const j = api.toJSON(doc);
  const all = j.notes.filter(x => x.note || x.drum).sort((a, b) => a.step - b.step);
  const pitched = all.filter(x => x.note);
  const pcs = new Array(12).fill(0);
  pitched.forEach(x => { const m = api.midiOf(x.note); if (m != null) pcs[((m % 12) + 12) % 12]++; });
  const n = pitched.length || 1;
  const sig = x => x.lane[0] + (x.note || x.drum) + '@' + x.step;
  return {
    bpm: st.bpm,
    pcs: pcs.map(x => x / n),
    opening: all.slice(0, 16).map(sig).join(','),
    rhythm: all.slice(0, 16).map(x => x.lane[0] + x.step).join(',')
  };
}
const cosine = (a, b) => {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return d / (Math.sqrt(na) * Math.sqrt(nb) || 1);
};
function batch(docs) {
  const f = docs.map(features);
  let sim = 0, pairs = 0;
  for (let i = 0; i < f.length; i++) for (let j = i + 1; j < f.length; j++) { sim += cosine(f[i].pcs, f[j].pcs); pairs++; }
  return {
    n: f.length,
    openings: new Set(f.map(x => x.opening)).size,
    rhythms: new Set(f.map(x => x.rhythm)).size,
    tempos: new Set(f.map(x => x.bpm)).size,
    similarity: pairs ? sim / pairs : 0
  };
}
const N = 30;

console.log('free composition');
{
  const b = batch(Array.from({ length: N }, () => api.compose({}).doc));
  ok(b.openings === b.n, 'no two songs begin the same way (' + b.openings + '/' + b.n + ')');
  // NOT 100%, and demanding it would be wrong. Rhythm cells are mined from a
  // real corpus and reusing them is what makes the output sound like chip music
  // rather than like noise -- two songs sharing an opening rhythm while every
  // pitch differs is a feature. Collapse is the thing to catch: a floor of 75%
  // fails long before a listener would notice repetition.
  ok(b.rhythms >= b.n * 0.75, 'and rhythms are reused but not collapsed (' + b.rhythms + '/' + b.n + ', floor ' + Math.ceil(b.n * 0.75) + ')');
  ok(b.tempos >= b.n * 0.4, 'tempo is spread, not collapsed (' + b.tempos + ' distinct of ' + b.n + ')');
  ok(b.similarity < 0.55, 'and they are not one harmonic world (similarity ' + b.similarity.toFixed(3) + ', ceiling 0.55)');
}

// A scene NARROWS the composer on purpose -- that is what asking for a boss
// theme means. It must not narrow it to one song.
console.log('scenes narrow without collapsing');
for (const scene of ['boss', 'title', 'cave']) {
  const b = batch(Array.from({ length: N }, () => api.brief({ scene, seconds: 30 }).doc));
  ok(b.openings === b.n, scene + ': every cue is a different song (' + b.openings + '/' + b.n + ')');
  ok(b.similarity < 0.6, scene + ': still varied harmonically (' + b.similarity.toFixed(3) + ', ceiling 0.6)');
  ok(b.tempos >= 3, scene + ': more than a couple of tempos (' + b.tempos + ')');
}

// The one that matters most: two DIFFERENT soundtracks must share nothing.
console.log('soundtracks do not share across games');
{
  const osts = Array.from({ length: 10 }, () => api.soundtrack({ scenes: ['title', 'battle', 'boss'], key: 'D' }));
  const first = batch(osts.map(o => o.cues[0].doc));
  ok(first.openings === first.n, 'ten different games, ten different title themes (' + first.openings + '/' + first.n + ')');
  ok(first.similarity < 0.65, 'and they are not one sound (' + first.similarity.toFixed(3) + ', ceiling 0.65)');

  // Within one soundtrack, cues are ALLOWED to be related -- that is the point.
  // They must still be different pieces of music.
  const within = batch(osts[0].cues.map(c => c.doc));
  ok(within.openings === within.n, 'inside one game the cues are still distinct songs');

  // motif:true is the strongest cohesion device here. It must relate the cues
  // without making them the same, and it is OFF unless asked for.
  const off = api.soundtrack({ scenes: ['title', 'battle', 'boss'], key: 'D' });
  ok(!off.motif, 'a shared motif is opt-in, not the default');
  // Ask a few times: a cue with no melodic phrase at all is a real outcome, and
  // the API says so rather than sharing silence. What must never happen is a
  // motif that is shared but identical across cues.
  let on = null;
  for (let i = 0; i < 5 && !(on && on.motif); i++) {
    on = api.soundtrack({ scenes: ['title', 'battle', 'boss'], key: 'D', motif: true });
    if (!on.motif) ok(!!on.motifSkipped, 'when there is no phrase to share it says why (' + on.motifSkipped + ')');
  }
  ok(!!on.motif, 'and motif:true does share one (' + (on.motif ? on.motif.pitches.slice(0, 4).join(' ') + ' on ' + on.motif.lane : '') + ')');
  const withMotif = batch(on.cues.map(c => c.doc));
  ok(withMotif.openings === withMotif.n,
     'even with a shared motif the cues open differently, because it is transposed per cue, not copied');
  const shifts = on.cues.slice(1).map(c => c.motif && c.motif.transposedBy);
  ok(shifts.every(x => typeof x === 'number'), 'and each cue reports where it heard the figure (' + shifts.join(', ') + ')');

  // and two different games asking for a motif must not get the SAME motif
  let on2 = null;
  for (let i = 0; i < 5 && !(on2 && on2.motif); i++) on2 = api.soundtrack({ scenes: ['title', 'battle', 'boss'], key: 'D', motif: true });
  ok(on.motif && on2.motif && on.motif.pitches.join(',') !== on2.motif.pitches.join(','),
     'two games asking for a motif get different motifs');
}

// Mood recipes are transforms, so they must move the music without flattening
// a batch into one thing.
console.log('mood recipes do not flatten');
{
  const docs = Array.from({ length: N }, () => api.brief({ scene: 'battle', seconds: 25 }).doc);
  const sad = docs.map(d => api.variant(d, { mood: 'sadder' }).doc);
  const b = batch(sad);
  // A FLOOR, NOT 100%, AND THIS ONE IS MEASURED. A mood recipe flattens: it
  // moves mode, tempo, register and dynamics towards a common target, so two
  // songs that were near neighbours can land on the same first sixteen notes.
  // Over 60 batches of 30 the worst seen was 29/30, and exactly one batch in
  // 60 collided at all -- so demanding 30/30 fails about one run in sixty for
  // no reason, which is how a gate earns a reputation for lying and gets
  // deleted. 28 catches a recipe that is genuinely collapsing the batch.
  ok(b.openings >= b.n - 2, 'thirty songs made sadder are still thirty songs (' +
     b.openings + '/' + b.n + ', floor ' + (b.n - 2) + ')');
  ok(b.similarity < 0.7, 'and the recipe has not pulled them into one key (' + b.similarity.toFixed(3) + ', ceiling 0.7)');
}

console.log(fail ? '\nFAILED (' + fail + ')' : '\nall good');
process.exit(fail ? 1 : 0);
