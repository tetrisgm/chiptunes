#!/usr/bin/env node
'use strict';

// Offline descriptive diagnostic only. It deliberately has no pass/fail
// thresholds and is not part of production composition or candidate choice.
// Limits: this measures composer event structure, not rendered audio,
// instrument envelopes, perceived phrases, or hardware playback. Only events
// labelled lead are measured; routing is not inferred from the GB export.
// Onset-free windows are not necessarily silent: earlier notes may sustain.
const composer = require('../src/composer.js');

const TOKENS = Array.from({ length: 32 }, (_, i) => `composition-form-${String(i).padStart(2, '0')}`);

function barData(score) {
  const bars = Array.from({ length: score.totalBars }, () => []);
  (score.events || []).filter(e => e.ch === 'lead' && Number.isFinite(e.midi)).forEach(e => {
    const bar = Math.floor(e.tBeat / score.beatsPerBar);
    if (bar >= 0 && bar < bars.length) bars[bar].push({
      p: e.midi,
      t: e.tBeat - bar * score.beatsPerBar,
      d: e.dur || 0
    });
  });
  bars.forEach(b => b.sort((a, z) => a.t - z.t || a.p - z.p));
  return bars;
}

function fingerprint(bars) {
  const exact = bars.map(b => b.map(n => `${n.p}@${n.t}:${n.d}`).join(',')).join('|');
  const pitches = bars.map(b => b.map(n => n.p).join(',')).join('|');
  const rhythm = bars.map(b => b.map(n => `${n.t}:${n.d}`).join(',')).join('|');
  const notes = bars.flat();
  const contour = notes.map((n, i) => i ? n.p - notes[i - 1].p : 'start').join(',');
  return { exact, pitches, rhythm, contour, noteCount: notes.length, noOnsets: notes.length === 0 };
}

function sectionFingerprint(bars, section) {
  return fingerprint(bars.slice(section.startBar, section.startBar + section.bars));
}

function plannedPhraseAnalysis(score, bars) {
  const plan = score.musical && Array.isArray(score.musical.phrasePlan)
    ? score.musical.phrasePlan : [];
  const phrases = plan.map((p, index) => {
    const startBar = Number.isInteger(p.startBar) ? p.startBar : 0;
    const spanBars = Number.isInteger(p.bars) ? p.bars : 0;
    const fp = fingerprint(bars.slice(startBar, startBar + spanBars));
    return {
      index,
      startBar,
      bars: spanBars,
      role: p.role,
      sectionIndex: p.sectionIndex,
      letter: p.letter,
      noOnsets: fp.noOnsets,
      fingerprint: fp
    };
  });
  const groups = Object.create(null);
  phrases.forEach((p, index) => {
    if (!p.letter) return;
    const key = `${p.letter}|${p.bars}`;
    (groups[key] || (groups[key] = [])).push(index);
  });
  const repeated = [];
  Object.entries(groups).forEach(([key, indices]) => {
    if (indices.length < 2) return;
    for (let i = 0; i < indices.length; i++) for (let j = i + 1; j < indices.length; j++) {
      const a = phrases[indices[i]], b = phrases[indices[j]];
      repeated.push({
        letter: a.letter,
        bars: a.bars,
        first: { startBar: a.startBar, sectionIndex: a.sectionIndex },
        later: { startBar: b.startBar, sectionIndex: b.sectionIndex },
        exactVaries: a.fingerprint.exact !== b.fingerprint.exact,
        pitchVaries: a.fingerprint.pitches !== b.fingerprint.pitches,
        rhythmVaries: a.fingerprint.rhythm !== b.fingerprint.rhythm,
        contourVaries: a.fingerprint.contour !== b.fingerprint.contour,
        bothWithoutLeadOnsets: a.noOnsets && b.noOnsets
      });
    }
  });
  return { phrases, repeatedSameLetterSpan: repeated };
}

function songResult(token, score) {
  const bars = barData(score);
  const barFingerprints = bars.map(b => fingerprint([b]));
  const phrases = [];
  for (let start = 0; start + 4 <= bars.length; start += 4) {
    const fp = fingerprint(bars.slice(start, start + 4));
    phrases.push({ startBar: start, fingerprint: fp });
  }
  const phraseCounts = Object.create(null);
  let onsetFreePhraseWindows = 0;
  phrases.forEach(p => {
    if (p.fingerprint.noOnsets) { onsetFreePhraseWindows++; return; }
    const key = p.fingerprint.exact;
    phraseCounts[key] = (phraseCounts[key] || 0) + 1;
  });
  const repeatedPhraseGroups = Object.values(phraseCounts).filter(n => n > 1).length;
  const repeatedPhraseInstances = Object.values(phraseCounts).reduce((n, x) => n + (x > 1 ? x : 0), 0);

  const laterRepeatedSections = [];
  for (let i = 0; i < score.sections.length; i++) {
    for (let j = i + 1; j < score.sections.length; j++) {
      const a = score.sections[i], b = score.sections[j];
      if (a.role !== b.role || a.bars !== b.bars) continue;
      const af = sectionFingerprint(bars, a), bf = sectionFingerprint(bars, b);
      laterRepeatedSections.push({ role: a.role, firstBar: a.startBar, laterBar: b.startBar,
        pitchVaries: af.pitches !== bf.pitches, contourVaries: af.contour !== bf.contour,
        rhythmVaries: af.rhythm !== bf.rhythm, bothWithoutLeadOnsets: af.noOnsets && bf.noOnsets });
    }
  }
  return {
    token, style: score.style, form: score.form, bpm: score.bpm, totalBars: score.totalBars,
    sections: score.sections.map(s => ({ startBar: s.startBar, bars: s.bars, role: s.role })),
    barsWithoutLeadOnsets: bars.reduce((n, b) => n + (b.length ? 0 : 1), 0),
    barsWithLeadOnsets: bars.length - bars.reduce((n, b) => n + (b.length ? 0 : 1), 0),
    leadBarFingerprints: barFingerprints,
    exactPhraseRepetition: { windowBars: 4, groups: repeatedPhraseGroups, instances: repeatedPhraseInstances,
      excludedOnsetFreeWindows: onsetFreePhraseWindows },
    laterRepeatedSections,
    plannedPhraseAnalysis: plannedPhraseAnalysis(score, bars)
  };
}

function run() {
  const songs = TOKENS.map(token => songResult(token, composer.compile(token)));
  const repeated = songs.flatMap(s => s.laterRepeatedSections);
  const summary = {
    songs: songs.length,
    totalBars: songs.reduce((n, s) => n + s.totalBars, 0),
    barsWithoutLeadOnsets: songs.reduce((n, s) => n + s.barsWithoutLeadOnsets, 0),
    exactPhraseRepetitionGroups: songs.reduce((n, s) => n + s.exactPhraseRepetition.groups, 0),
    exactPhraseRepetitionInstances: songs.reduce((n, s) => n + s.exactPhraseRepetition.instances, 0),
    repeatedSectionComparisons: repeated.length,
    repeatedSectionsWithPitchVariation: repeated.filter(x => x.pitchVaries).length,
    repeatedSectionsWithContourVariation: repeated.filter(x => x.contourVaries).length,
    repeatedSectionsWithRhythmVariation: repeated.filter(x => x.rhythmVaries).length,
    onsetFreePhraseWindowsExcluded: songs.reduce((n, s) => n + s.exactPhraseRepetition.excludedOnsetFreeWindows, 0)
  };
  return { diagnostic: 'composition-form', measurement: 'composer lead-event structure', songs, summary };
}

function selfTest() {
  const assert = (condition, message) => { if (!condition) throw new Error(`self-test failed: ${message}`); };
  const silence = fingerprint([[]]);
  assert(silence.noOnsets && silence.noteCount === 0, 'no lead onsets');
  const one = fingerprint([[{ p: 60, t: 0, d: 2 }]]);
  assert(one.noteCount === 1 && one.contour === 'start', 'one-note bar');
  const base = [[{ p: 60, t: 0, d: 2 }, { p: 64, t: 2, d: 1 }], [{ p: 67, t: 0, d: 2 }]];
  const transposed = base.map(b => b.map(n => ({ p: n.p + 5, t: n.t, d: n.d })));
  assert(fingerprint(base).exact !== fingerprint(transposed).exact, 'absolute pitch in exact fingerprint');
  assert(fingerprint(base).contour === fingerprint(transposed).contour, 'transposition preserves contour');
  const durationChanged = [[{ p: 60, t: 0, d: 3 }, { p: 64, t: 2, d: 1 }], [{ p: 67, t: 0, d: 2 }]];
  assert(fingerprint(base).exact !== fingerprint(durationChanged).exact, 'duration in exact fingerprint');
  assert(fingerprint(base).contour === fingerprint(durationChanged).contour, 'duration does not alter contour');
  assert(fingerprint(base).pitches === fingerprint(durationChanged).pitches, 'duration does not count as pitch variation');
  assert(fingerprint(base).rhythm !== fingerprint(durationChanged).rhythm, 'duration counts as rhythm variation');
  const leap = [[{ p: 60, t: 0, d: 1 }], [{ p: 72, t: 0, d: 1 }]];
  assert(fingerprint(leap).contour === 'start,12', 'cross-bar leap in contour');
  const silentPhrase = fingerprint([[], [], [], []]);
  assert(silentPhrase.noOnsets, 'onset-free phrase window');
  const plannedScore = {
    musical: { phrasePlan: [
      { startBar: 1, bars: 2, role: 'theme', sectionIndex: 1, letter: 'A' },
      { startBar: 5, bars: 2, role: 'theme', sectionIndex: 3, letter: 'A' },
      { startBar: 0, bars: 3, role: 'bridge', sectionIndex: 0, letter: 'B' }
    ] }
  };
  const plannedBars = [[], [{ p: 60, t: 0, d: 1 }], [{ p: 64, t: 0, d: 1 }], [],
    [], [{ p: 60, t: 0, d: 2 }], [{ p: 64, t: 0, d: 1 }]];
  const planned = plannedPhraseAnalysis(plannedScore, plannedBars);
  assert(planned.phrases[0].bars === 2 && planned.phrases[0].startBar === 1, 'non-four-bar planned span');
  assert(planned.phrases[2].bars === 3, 'three-bar planned span');
  assert(planned.phrases[0].letter === 'A' && planned.phrases[1].letter === 'A', 'planned theme letters');
  assert(planned.repeatedSameLetterSpan.length === 1, 'repeated same-letter same-span phrase');
  assert(planned.repeatedSameLetterSpan[0].rhythmVaries, 'rhythm-only variation');
  assert(!planned.repeatedSameLetterSpan[0].pitchVaries, 'rhythm-only change is not pitch variation');
  assert(plannedPhraseAnalysis({}, plannedBars).phrases.length === 0, 'absent metadata defaults empty');
  process.stdout.write('diagnose-composition-form self-test: ok\n');
}

if (process.argv.includes('--self-test')) selfTest();
else process.stdout.write(JSON.stringify(run()) + '\n');
