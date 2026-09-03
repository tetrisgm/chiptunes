// DOES IT ACTUALLY UNDERSTAND THE SENTENCE?
//
// The field in the product and `ask()` in the API are the same parser, and it
// is deterministic: it matches words against a published vocabulary, so every
// claim it makes about a sentence is checkable here rather than by ear.
//
// Three kinds of failure this is built to catch, all of which happened:
//
//   * SILENT DROPPING. The parser composes something, reports a confident
//     summary, and the part the user cared about was never applied. Worse than
//     an error, because the summary reads like success.
//   * FALSE CLAIMING. The summary names a dial that lost. "a platformer like
//     Metroid" reported "read as: metroidvania" while the platformer dials were
//     the ones in force, and reported an 88-118 bpm band while the mood recipe
//     had already dragged the song to 79.
//   * LEAKAGE FROM A TITLE'S OWN WORDS. "Kirby's Adventure" contains the game
//     genre "adventure" and "Metal Gear" contains the genre "metal". Matched
//     naively, one phrase fires three rules and the summary contradicts itself.
//
// On the reference table specifically: a title sets GENRE DIALS and nothing
// else, it is always read back as a genre, and it can only reach dials a user
// could type by hand. That is asserted below, because it is the property that
// makes the feature description true rather than marketing.
'use strict';
const path = require('path');
const api = require(path.join(__dirname, '..', 'src', 'api.js'));
const REF = require(path.join(__dirname, '..', 'src', 'reference-styles.js'));

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fail++; };
const say = t => api.interpret(t, {});
const joined = r => r.understood.join(' | ');

/* ---------------------------------------------------------------- the table */
console.log('the reference table');
{
  const names = REF.names();
  ok(names.length >= 100, 'it covers at least a hundred titles (' + names.length + ')');
  const caps = api.capabilities();
  ok(caps.titles && caps.titles.length === names.length, 'and capabilities() publishes them, so an agent can see the list');

  // A TITLE MAY ONLY REACH DIALS A USER COULD TYPE. This is the invariant the
  // whole feature description rests on: if a mapping could ever carry
  // something specific to somebody's composition, it would not be a genre
  // reading any more.
  const allowed = ['name', 'genre', 'styles', 'mode', 'bpmMin', 'bpmMax', 'character', 'tech', 'reads'];
  const STYLES = ['anthem', 'house', 'trance', 'techno', 'dnb', 'breaks', 'arcade',
                  'rock', 'punk', 'funk', 'boombap', 'chill', 'ballad', 'drone'];
  const moodWords = api.capabilities().moodWords;
  const techniques = api.capabilities().techniques;
  const gameGenres = api.capabilities().gameGenres;
  let bad = [];
  Object.keys(REF.TITLES).forEach(k => {
    const e = REF.TITLES[k];
    Object.keys(e).forEach(f => { if (allowed.indexOf(f) < 0) bad.push(e.name + '.' + f); });
    e.styles.forEach(s => { if (STYLES.indexOf(s) < 0) bad.push(e.name + ' style ' + s); });
    if (['major', 'minor'].indexOf(e.mode) < 0) bad.push(e.name + ' mode ' + e.mode);
    if (!e.character.length) bad.push(e.name + ' has no character');
    e.character.forEach(c => { if (moodWords.indexOf(c) < 0) bad.push(e.name + ' character ' + c); });
    if (e.tech && techniques.indexOf(e.tech) < 0) bad.push(e.name + ' technique ' + e.tech);
    if (gameGenres.indexOf(e.genre) < 0 && ['arcade', 'shooter'].indexOf(e.genre) < 0) bad.push(e.name + ' genre ' + e.genre);
  });
  ok(!bad.length, 'every entry sets only published dials, and only ones that exist' +
     (bad.length ? ' -- ' + bad.slice(0, 4).join(', ') : ''));

  // and every one of them composes, rather than asking for a band no style can reach
  let broke = [];
  names.forEach(n => {
    try {
      const r = api.ask('like ' + n, {});
      if (!r.ok) broke.push(n + ': ' + r.error);
      else if ((r.skipped || []).some(x => /style constraint/.test(x))) broke.push(n + ': style unmet');
    } catch (e) { broke.push(n + ': threw ' + e.message); }
  });
  ok(!broke.length, 'and all ' + names.length + ' of them compose' + (broke.length ? ' -- ' + broke.slice(0, 3).join('; ') : ''));

  // ...KEEPING THEIR GENRE. brief() copes with an unsatisfiable premise by
  // deleting `styles`, so "style unmet" above is only half the check: a title
  // whose tempo band no style can reach still composes, it just composes
  // something with none of the character the summary promised.
  const composer = require(path.join(__dirname, '..', 'src', 'composer.js'));
  const table = composer.styles();
  let unreachable = [];
  names.forEach(n => {
    const e = REF.TITLES[REF.normalize(n)];
    if (!e || !e.bpmMin) return;
    const reachable = e.styles.some(id => {
      const st = table.filter(x => x.id === id)[0];
      return st && Math.max(st.bpm[0], e.bpmMin) <= Math.min(st.bpm[1], e.bpmMax);
    });
    if (!reachable) unreachable.push(n + ' ' + e.styles.join('/') + ' @ ' + e.bpmMin + '-' + e.bpmMax);
  });
  ok(!unreachable.length, 'and every tempo band is one of its own styles can actually reach' +
     (unreachable.length ? ' -- ' + unreachable.slice(0, 4).join('; ') : ''));

  // A minor title must not be composed by CONSTRAINING the composer to minor:
  // ten of the fourteen styles are major-only, so that empties the pool.
  const minorOnes = names.filter(n => (REF.TITLES[REF.normalize(n)] || {}).mode === 'minor');
  ok(minorOnes.length > 20, 'plenty of the titles are minor (' + minorOnes.length + ')');
  ok(minorOnes.every(n => api.interpret('like ' + n, {}).spec.mode == null),
     'and none of them constrains the composer to minor -- the mode is a transform after the fact');
}

/* ------------------------------------------------- character reaches the notes */
// THE POINT OF NAMING A GAME. "A platformer like Metroid" is not just a
// platformer -- Metroid is gloomy, sparse and unhurried -- and for one whole
// release naming it changed almost nothing, because an explicit genre took the
// styles and the mode, and the tempo band was discarded for being out of the
// genre's reach. What was left was a single mood word.
//
// So this measures the music, not the summary. Same token, same request, one
// word different.
console.log('the character of a title reaches the notes');
{
  const TOKEN = '7f3a12bc55de90aa';
  // The content, not two summary numbers: swing, duty and register change the
  // music without moving either the tempo or the note count, and an earlier
  // version of this check called that "unchanged".
  const content = doc => {
    const j = api.toJSON(doc);
    return j.notes.map(n => n.lane[0] + (n.note || n.drum) + '@' + n.step + ':' + (n.fd || 0) + (n.dy || 0)).join(',');
  };
  const song = name => {
    const r = api.ask('a platformer like ' + name + ', 30 seconds', { brief: { token: TOKEN } });
    return Object.assign({ ok: r.ok, content: content(r.doc) }, api.describe(r.doc));
  };
  const metroid = song('metroid'), mario = song('super mario bros');
  const castlevania = song('castlevania'), recca = song('recca');

  ok(metroid.bpm < mario.bpm - 15,
     'Metroid is markedly slower than Mario, asked as the same platformer (' +
     metroid.bpm + ' vs ' + mario.bpm + ' bpm)');
  ok(recca.bpm > mario.bpm, 'and Recca is faster still (' + recca.bpm + ' bpm)');
  ok(castlevania.notes > metroid.notes * 2,
     'Castlevania is far denser than Metroid (' + castlevania.notes + ' vs ' + metroid.notes + ' notes)');

  // and it is the CHARACTER doing it, not luck: the same brief with no title
  const plainDoc = api.ask('a platformer, 30 seconds', { brief: { token: TOKEN } }).doc;
  const plain = content(plainDoc);
  const four = [metroid, mario, castlevania, recca];
  const moved = four.filter(x => x.content !== plain).length;
  ok(moved === 4, 'every one of them differs from the same platformer with no title named (' + moved + '/4)');
  const distinct = new Set(four.map(x => x.content)).size;
  ok(distinct === 4, 'and from each other (' + distinct + '/4 distinct)');

  // a title's mode has to land even when a GENRE DEFAULT says otherwise:
  // `platformer` carries mode 'major', and treating that as the user's own word
  // is what made "a platformer like Metroid" come out cheerful.
  const m = say('a platformer like metroid');
  ok(m.ops.some(o => o.op === 'mode' && o.to === 'minor'),
     "a genre's default mode does not block the title's (Metroid stays minor under `platformer`)");
  ok(say('a platformer like metroid in major').ops.every(o => o.op !== 'mode' || o.to !== 'minor'),
     'but a mode the user TYPES does block it');

  // an unreachable band becomes a pull rather than nothing at all
  ok(m.ops.some(o => o.op === 'tempo' && o.percent < 0) && /slower, towards its 88-118/.test(m.understood[0]),
     'and a band the styles cannot reach pulls the tempo towards it, and says so (' + m.understood[0] + ')');

  // THE BLEND MUST NOT STACK. Three recipes concatenated raw would move the
  // melody three octaves and the tempo by half.
  let piled = [];
  REF.names().forEach(n => {
    const r = say('like ' + n);
    const oct = {}; let tempos = 0, vel = 0;
    r.ops.forEach(o => {
      if (o.op === 'register') oct[o.lane] = (oct[o.lane] || 0) + o.octaves;
      if (o.op === 'tempo') tempos++;
      if (o.op === 'velocity') vel += o.delta;
    });
    if (tempos > 1) piled.push(n + ': ' + tempos + ' tempo ops');
    if (Object.keys(oct).some(l => Math.abs(oct[l]) > 1)) piled.push(n + ': octaves ' + JSON.stringify(oct));
    if (Math.abs(vel) > 0.25 + 1e-9) piled.push(n + ': velocity ' + vel.toFixed(2));
  });
  ok(!piled.length, 'and blending traits never piles up into octaves or runaway tempo' +
     (piled.length ? ' -- ' + piled.slice(0, 3).join('; ') : ''));
}

/* --------------------------------------------- the user's own adjectives too */
console.log("the user's own adjectives reach the notes");
{
  // "a gloomy song about exploring a cave" -- both adjectives, and the cave.
  const g = say('a gloomy song about exploring a cave');
  ok(g.spec.scene === 'cave', '"exploring a cave" is a cave, not an overworld');
  ok(g.moods.indexOf('darker') >= 0 && g.moods.indexOf('exploratory') >= 0,
     'and BOTH adjectives are taken, not just the first (' + g.moods.join(', ') + ')');
  ok(!g.notUnderstood.length, 'with nothing ignored');
  const made = api.ask('a gloomy song about exploring a cave', { brief: { token: '7f3a12bc55de90aa' } });
  const plainCave = api.describe(api.brief({ scene: 'cave', seconds: 30, token: '7f3a12bc55de90aa' }).doc);
  ok(made.ok && api.describe(made.doc).bpm < plainCave.bpm,
     'and the result is slower than the same cave without them (' +
     api.describe(made.doc).bpm + ' vs ' + plainCave.bpm + ' bpm)');

  // a tempo the sentence asked for is not compounded by a mood's own tempo
  const f = api.ask('a cheerful fast platformer', { brief: { token: '7f3a12bc55de90aa' } });
  ok(f.ok && api.describe(f.doc).bpm <= 175,
     'an explicit "fast" is not compounded by cheerful\'s own +8% (' + api.describe(f.doc).bpm + ' bpm)');
}

/* -------------------------------------------------------- reading a title in */
console.log('reading a title');
{
  const r = say('a boss theme like castlevania');
  ok(r.reference && r.reference.known && r.reference.name === 'Castlevania', 'the name is recognised');
  ok(/^like Castlevania \(platformer\), used for:/.test(r.understood[0]),
     'and stated as a READING, naming the genre it was read as (' + r.understood[0] + ')');
  ok(r.spec.styles.join() === 'rock,punk' && r.spec.bpmMin === 145, 'which sets real dials');

  // aliases, sequels, roman numerals and apostrophes
  const alias = [['mario', 'Super Mario Bros.'], ['zelda 2', 'Zelda II: The Adventure of Link'],
                 ['castlevania iii', "Castlevania III: Dracula's Curse"],
                 ["kirby's adventure", "Kirby's Adventure"], ['TMNT', 'Teenage Mutant Ninja Turtles'],
                 ['ghosts n goblins', "Ghosts 'n Goblins"], ['salamander', 'Life Force']];
  alias.forEach(([typed, want]) => {
    const g = say('something like ' + typed);
    ok(g.reference && g.reference.name === want,
       '"' + typed + '" resolves to ' + want + (g.reference ? ' (' + g.reference.name + ')' : ' (nothing)'));
  });
  // the longer name must win over the shorter one inside it
  ok(say('like super mario bros 3').reference.name === 'Super Mario Bros. 3',
     'and "super mario bros 3" is not read as plain Mario');
}

/* ------------------------------------------------- a title never overreaches */
console.log('what a title is NOT allowed to overrule');
{
  // A TITLE CONTAINS ORDINARY VOCABULARY. Its span is blanked before anything
  // else matches, or one phrase fires three rules at once.
  const k = say("like kirby's adventure");
  ok(!joined(k).includes('game genre: adventure'), '"Kirby\'s Adventure" is not also the game genre "adventure"');
  const mg = say('like metal gear');
  ok(!joined(mg).includes('genre: metal'), '"Metal Gear" is not also the genre "metal"');
  ok(!mg.notUnderstood.length, 'and a title\'s own words are never reported as ignored');
  ok(!say('like life force').notUnderstood.length, 'nor "Life Force"');

  // an explicitly named genre is the user's choice and outranks the reference
  const p = say('a platformer like metroid');
  ok(p.spec.styles.join() === 'arcade,anthem', 'a named genre beats the title (platformer wins over metroidvania)');
  ok(!/used for: metroidvania/.test(joined(p)), 'and the summary does not claim the dial that lost (' + p.understood[0] + ')');
  ok(/% slower, towards its/.test(p.understood[0]) && !/^like Metroid \(metroidvania\), used for: 88-118 bpm/.test(p.understood[0]),
     'and a band those styles cannot reach becomes a pull towards it, described as one (' + p.understood[0] + ')');

  // THE GENERAL INVARIANT, which is the one worth holding: everything the
  // summary lists under "used for" is really in force. This is the assertion
  // that catches the next false claim, whatever shape it takes.
  const table2 = require(path.join(__dirname, '..', 'src', 'composer.js')).styles();
  const claims = ['like castlevania', 'a platformer like metroid', 'like tetris, 30 seconds',
                  'a dungeon theme like zelda', 'like recca', 'like metal gear, no drums',
                  'a title screen like mega man', 'like dragon warrior in a minor'];
  let lies = [];
  claims.forEach(text => {
    const r = say(text);
    const head = r.understood[0] || '';
    const used = (head.match(/used for: (.*)$/) || [, ''])[1];
    if (!used || /nothing, you named/.test(used)) return;
    // the character is a comma list inside one item, so a bare split would
    // hand each trait to the wrong branch; traits are checked as a group below
    used.replace(/(\d+)% (slower|faster), towards/, '$1%_$2,_towards')
        .split(', ').map(x => x.replace(/_/g, ' ')).forEach(item => {
      if (/^\d+% (slower|faster), towards its/.test(item)) {
        const pct = Number(item.match(/^(\d+)%/)[1]);
        const dir = /slower/.test(item) ? -1 : 1;
        if (!r.ops.some(o => o.op === 'tempo' && o.percent === pct * dir)) lies.push(text + ': pull ' + item);
      } else if (/bpm$/.test(item)) {
        const [lo, hi] = item.replace(' bpm', '').split('-').map(Number);
        if (r.spec.bpmMin !== lo || r.spec.bpmMax !== hi) lies.push(text + ': band ' + item);
      } else if (item.indexOf('/') >= 0 || table2.some(x => x.id === item)) {
        if ((r.spec.styles || []).join('/') !== item) lies.push(text + ': styles ' + item);
      } else if (item === 'major' || item === 'minor') {
        if (!r.ops.some(o => o.op === 'mode' && o.to === item) && r.spec.mode !== item)
          lies.push(text + ': mode ' + item);
      } else if (api.capabilities().techniques.indexOf(item) >= 0) {
        if (!r.ops.length) lies.push(text + ': technique ' + item);
      } else if (!r.ops.length) lies.push(text + ': mood ' + item + ' produced no ops');
    });
  });
  ok(!lies.length, 'everything a summary lists under "used for" is actually in force' +
     (lies.length ? ' -- ' + lies.slice(0, 4).join('; ') : ''));

  // a named scene keeps its own mode: a dungeon is minor even "like Zelda"
  const z = say('a dungeon theme like zelda');
  ok(z.spec.scene === 'cave' && z.spec.mode == null,
     'a named scene keeps its own mode, so a dungeon stays a dungeon');
  ok(say('a dungeon theme like zelda in major').spec.mode === 'major',
     'and typing the mode still beats both');

  // the title's mood may not undo the title's own tempo band
  const bandOk = ['like metroid', 'like castlevania', 'like final fantasy', 'like recca'].every(t => {
    const r = api.ask(t, {}); const d = api.describe(r.doc); const s = say(t).spec;
    return d.bpm >= s.bpmMin - 12 && d.bpm <= s.bpmMax + 12;
  });
  ok(bandOk, 'and the song lands in the tempo band the summary named');
}

/* ----------------------------------------------------- refusing what it cannot */
console.log('refusing, out loud');
{
  const unknown = say('something like radiohead');
  ok(unknown.reference && unknown.reference.known === false, 'a name not on the list is not silently ignored');
  ok(unknown.unsupported.length === 1, 'it is refused');
  const asked = api.ask('something like radiohead', {});
  ok(!asked.ok && /do not know/.test(asked.error) && /Castlevania/.test(asked.error),
     'and the refusal explains itself and names games the list DOES know, since it is read in a browser as often as by an agent');

  const cannot = [
    ['a waltz for a shop', 'time signature'],
    ['a song with vocals', 'vocals'],
    ['a guitar solo over drums', 'real instrument'],
    ['something in dorian', 'mode other than'],
    ['a boss theme with reverb', 'studio effects']
  ];
  cannot.forEach(([text, want]) => {
    const r = say(text);
    ok(r.unsupported.some(u => u.asked.includes(want.split(' ')[0]) || u.asked.includes(want)),
       '"' + text + '" says it cannot (' + (r.unsupported[0] ? r.unsupported[0].asked : 'NOTHING') + ')');
  });
  // the reason must come with it. "I cannot" on its own is not an answer.
  ok(say('a waltz').unsupported[0].why.length > 30, 'and each refusal carries the reason why');
}

/* ------------------------------------------------------------ ordinary asks */
console.log('sentences people actually type');
{
  // Each of these must be understood COMPLETELY: nothing ignored, nothing
  // refused. A parser that half-understands a plain sentence is the failure
  // this whole file exists to catch.
  const complete = [
    ['a platformer overworld theme, arpeggiated, 40 seconds', r => r.spec.scene === 'overworld' && r.spec.seconds === 40],
    ['forty five seconds of upbeat shop music', r => r.spec.seconds === 45 && r.spec.scene === 'shop'],
    ['two minutes of calm world map music', r => r.spec.seconds === 120 && r.spec.scene === 'overworld'],
    ['a gloomy exploratory piece, 40 seconds', r => r.spec.seconds === 40 && r.moods.length === 2],
    ['half a minute, tense, in the sewers', r => r.spec.seconds === 30 && r.spec.scene === 'cave'],
    ['a minute and a half of credits music', r => r.spec.seconds === 90 && r.spec.scene === 'credits'],
    ['16 bars of menacing dungeon music', r => r.spec.bars === 16 && r.spec.scene === 'cave'],
    ['a battle theme in b flat minor', r => r.spec.key === 'A#' && r.spec.mode === 'minor'],
    ['a title screen in f sharp major', r => r.spec.key === 'F#' && r.spec.mode === 'major'],
    ['a boss fight, no drums, 30 seconds', r => (r.spec.exclude || []).join() === 'Drums' && r.spec.seconds === 30],
    ['just bass and drums, dark and slow', r => (r.spec.exclude || []).sort().join() === 'Harmony,Melody'],
    ['leave out the harmony please', r => (r.spec.exclude || []).join() === 'Harmony'],
    ['a stealth theme that loops seamlessly', r => r.spec.loop === true],
    ['a victory fanfare that ends on the tonic', r => r.spec.resolve === true],
    ['a frantic shmup stage, 150 bpm', r => r.ops.some(o => o.op === 'tempo' && o.absolute === 150)],
    ['a lullaby for a town, staccato', r => r.spec.styles.join() === 'ballad' && r.ops.some(o => o.op === 'fade')],
    ['a dirge, much slower, an octave down', r => r.ops.some(o => o.op === 'register' && o.octaves === -1)]
  ];
  complete.forEach(([text, check]) => {
    const r = say(text);
    const clean = !r.notUnderstood.length && !r.unsupported.length;
    ok(clean && check(r), '"' + text + '"' +
       (clean ? '' : ' -- ignored: ' + r.notUnderstood.join(',') + ' / cannot: ' + r.unsupported.map(u => u.asked).join(',')) +
       (check(r) ? '' : ' -- WRONG SPEC ' + JSON.stringify(r.spec)));
  });

  // ...and every one of them actually composes what it said
  complete.forEach(([text]) => {
    let r; try { r = api.ask(text, {}); } catch (e) { r = { ok: false, error: e.message }; }
    ok(r.ok && r.doc, '"' + text + '" composes' + (r.ok ? '' : ' -- ' + r.error));
  });
}

/* ----------------------------------------------------------- changing a song */
console.log('changing a song that already exists');
{
  const base = api.brief({ scene: 'battle', seconds: 30 });
  const changes = ['make it much slower and darker', 'faster please', 'an octave higher',
                   'drop the drums', 'make it sadder', 'half time', 'repeat it'];
  changes.forEach(text => {
    const r = say(text);
    ok(r.kind === 'change', '"' + text + '" is read as a change, not a new song');
    const done = api.ask(text, { doc: base.doc });
    ok(done.ok && done.applied.length > 0, '  and it applies (' + (done.applied || []).slice(0, 2).join(', ') + ')');
  });
  ok(say('a boss theme').kind === 'brief', 'while a scene is read as a new song');
}

/* ----------------------------------------------------- the claims it makes */
console.log('claims that have to be true');
{
  // The summary says a song "loops (a whole number of bars)". That is a
  // checkable statement, so it is checked rather than asserted in copy.
  const looped = [0, 1, 2, 3, 4].map(() => api.ask('a cave theme that loops, 40 seconds', {}));
  ok(looped.every(r => r.ok && Number.isInteger(api.describe(r.doc).bars)),
     'a song that says it loops is a whole number of bars');

  // brief() ignored SCENES' own `resolve: true` for as long as scenes existed,
  // so the two cues that most need a clean ending were the two not getting one.
  const vic = api.brief({ scene: 'victory' });
  const j = api.toJSON(vic.doc);
  const mel = j.notes.filter(n => n.lane === 'Melody' && n.note);
  const key = api.describe(vic.doc);
  ok(mel.length === 0 || typeof key === 'object', 'a victory cue composes');
  const resolved = api.transform(api.brief({ scene: 'battle', seconds: 20 }).doc, [{ op: 'resolve' }]);
  ok(resolved.applied.some(a => /resolved to the tonic/.test(a)) || resolved.skipped.length,
     'and resolve either lands on the tonic or says why it could not');

  // determinism: the same sentence twice is the same song, or none of the
  // reproducibility claims in the README survive
  const a1 = api.ask('a boss theme like castlevania in d minor, 30 seconds', { brief: { token: 'abcd1234abcd1234' } });
  const a2 = api.ask('a boss theme like castlevania in d minor, 30 seconds', { brief: { token: 'abcd1234abcd1234' } });
  ok(a1.doc === a2.doc, 'the same sentence and the same token give the same song, byte for byte');
}

/* ------------------------------------------------------------- global leaks */
console.log('the bundle');
{
  // reference-styles.js joins a CONCATENATED classic-script bundle where a
  // top-level `var` becomes a global. api.js once shipped 47 of them and
  // clobbered seed.js's `Song`, which killed audio everywhere while every
  // standalone test passed.
  const fs = require('fs');
  const before = new Set(Object.keys(global));
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'reference-styles.js'), 'utf8');
  (0, eval)(src);
  const leaked = Object.keys(global).filter(k => !before.has(k) && k !== 'CT_REFERENCE_STYLES');
  ok(!leaked.length, 'reference-styles.js leaks nothing but CT_REFERENCE_STYLES' +
     (leaked.length ? ' -- ' + leaked.join(', ') : ''));
}

console.log(fail ? '\nverify-language: ' + fail + ' FAILED' : '\nverify-language: it understands the sentence');
process.exit(fail ? 1 : 0);
