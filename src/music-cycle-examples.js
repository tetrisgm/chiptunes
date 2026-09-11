// Seven edits of one finite performance, following docs/music-cycle-v1.md.
// Source data only: the existing music language and chip player execute it.
(function (G) {
  'use strict';

  // Restoration deliberately reuses this exact text for Run/Undo demos.
  var fullArrangement = `song({tempo:132,bars:8})

pattern("beat",cycleV1("C2(3,8)").gate(.15))
pattern("bass",cycleV1("C2 [E2 G2] ~ G2").gate(.65))
pattern("lead",cycleV1("<C4 E4> [G4 B4] E4 ~").every(4,"rev",3).gate(.55))

track("drums").instrument("n-tick").play("beat",{repeat:8})
track("bass").instrument("wave-bass").play("bass",{repeat:8})
track("lead").instrument("p0").play("lead",{repeat:8})`;

  var steps = [
    {
      id: 'noise-groove',
      title: 'Noise groove',
      description: 'Start eight bars at 132 BPM with a short noise tick on each beat.',
      source: `song({tempo:132,bars:8})

pattern("beat",cycleV1("C2 C2 C2 C2").gate(.15))

track("drums").instrument("n-tick").play("beat",{repeat:8})`
    },
    {
      id: 'subdivided-bass',
      title: 'Add subdivided bass',
      description: 'Add a C-major bass phrase. The bracketed E2 and G2 share one beat; ~ leaves a rest.',
      source: `song({tempo:132,bars:8})

pattern("beat",cycleV1("C2 C2 C2 C2").gate(.15))
pattern("bass",cycleV1("C2 [E2 G2] ~ G2").gate(.65))

track("drums").instrument("n-tick").play("beat",{repeat:8})
track("bass").instrument("wave-bass").play("bass",{repeat:8})`
    },
    {
      id: 'alternating-melody',
      title: 'Add alternating melody',
      description: 'Let <C4 E4> alternate the opening pitch each bar, followed by a bright G4-B4 figure.',
      source: `song({tempo:132,bars:8})

pattern("beat",cycleV1("C2 C2 C2 C2").gate(.15))
pattern("bass",cycleV1("C2 [E2 G2] ~ G2").gate(.65))
pattern("lead",cycleV1("<C4 E4> [G4 B4] E4 ~").gate(.55))

track("drums").instrument("n-tick").play("beat",{repeat:8})
track("bass").instrument("wave-bass").play("bass",{repeat:8})
track("lead").instrument("p0").play("lead",{repeat:8})`
    },
    {
      id: 'periodic-reverse',
      title: 'Turn the melody around',
      description: 'Reverse the melody on zero-based cycles 3 and 7 (bars 4 and 8), keeping the bass steady.',
      source: `song({tempo:132,bars:8})

pattern("beat",cycleV1("C2 C2 C2 C2").gate(.15))
pattern("bass",cycleV1("C2 [E2 G2] ~ G2").gate(.65))
pattern("lead",cycleV1("<C4 E4> [G4 B4] E4 ~").every(4,"rev",3).gate(.55))

track("drums").instrument("n-tick").play("beat",{repeat:8})
track("bass").instrument("wave-bass").play("bass",{repeat:8})
track("lead").instrument("p0").play("lead",{repeat:8})`
    },
    {
      id: 'euclidean-drums',
      title: 'Vary the drums',
      description: 'Use C2(3,8) for three noise hits across eight equal slots, keeping both pitched parts.',
      source: fullArrangement
    },
    {
      id: 'rest-breakdown',
      title: 'Make room with rests',
      description: 'Leave a downbeat tick, two bass anchors and two surviving melody notes. The periodic reversal continues.',
      source: `song({tempo:132,bars:8})

pattern("beat",cycleV1("C2 ~ ~ ~").gate(.15))
pattern("bass",cycleV1("C2 ~ ~ G2").gate(.65))
pattern("lead",cycleV1("<C4 E4> [G4 ~] ~ ~").every(4,"rev",3).gate(.55))

track("drums").instrument("n-tick").play("beat",{repeat:8})
track("bass").instrument("wave-bass").play("bass",{repeat:8})
track("lead").instrument("p0").play("lead",{repeat:8})`
    },
    {
      id: 'restore-arrangement',
      title: 'Bring it all back',
      description: 'Restore exactly the full Euclidean arrangement from step 5, ready to compare or Undo.',
      source: fullArrangement
    }
  ].map(function (step) { return Object.freeze(step); });

  var API = Object.freeze({ steps: Object.freeze(steps) });
  G.CT_MUSIC_CYCLE_EXAMPLES = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
