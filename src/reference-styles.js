// "MAKE IT SOUND LIKE <a game everybody knows>"
//
// This is the one place a real game title maps onto composer dials, and the
// honesty of the whole feature rests on how that mapping is described.
//
// WHAT THIS IS: a reading. Somebody says "like Castlevania" and means, roughly,
// a minor-key action platformer at about 155 bpm that sounds threatening. That
// sentence is a genre description, and this table is a hundred-odd of those
// written down. The composer then writes its own music to that description.
//
// WHAT THIS IS NOT: an imitation, a model, or anything derived from the
// referenced music. Nothing here was trained on a recording and no melodic,
// harmonic or rhythmic material comes from one. That distinction is not a
// disclaimer, it is the design: the ONLY things a title can set are genre,
// styles, mode, tempo band, mood and one playing technique -- the same dials a
// user can type by hand. If a mapping could ever carry something specific to
// somebody's composition, it would not belong in this file.
//
// So the parser always says back what it read a title AS, in the user's own
// view ("read as: platformer, rock/punk, minor, brisk"), and never claims to
// have reproduced anything. A user who disagrees with a reading can type the
// dials themselves and get exactly what they asked for.
//
// SCOPE, and why it is narrow (AGENTS.md, owner 2026-09-02): this rule was
// always about the visualizer PACKS, which are original code that looks like
// somebody's game -- naming one after a real title is what turns a lookalike
// into a target. A descriptive style hint in a prompt is a different act.
// Generated SONG TITLES are a third thing and are still forbidden from landing
// on real cartridge names; `BLOCKED` in seed.js and verify-chrome hold that.
//
// CHARACTER IS THE POINT, not the genre. "A platformer like Metroid" is not
// just a platformer: Metroid is gloomy, sparse and exploratory, and those words
// have to reach the notes or naming the game did nothing. So a title carries
// two or three TRAITS, drawn from the same published mood vocabulary a user can
// type, and they are applied whether or not a genre was named alongside --
// genre says what a piece is FOR, character says what it FEELS like, and the
// two are orthogonal rather than competing.
//
// Positional, because it is a table and reads like one:
//   P(name, genre, styles, mode, bpmMin, bpmMax, character, technique, aliases)
// character is a list of WORD_MOODS values, technique a WORD_TECHNIQUES key.
(function (G) {
  'use strict';

  var TITLES = {};
  var ORDER = [];

  // Roman numerals in sequel names are normalised to digits at both ends, so
  // "castlevania iii" and "castlevania 3" are one entry rather than two.
  var ROMAN = { ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10' };

  function normalize(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/['‘’ʼ]/g, '')     // kirby's -> kirbys, 'n -> n
      .replace(/[^a-z0-9#]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .map(function (w) { return ROMAN[w] || w; })
      .join(' ');
  }

  function P(name, genre, styles, mode, bpmMin, bpmMax, character, tech, aliases) {
    var e = { name: name, genre: genre, styles: styles, mode: mode,
              bpmMin: bpmMin || null, bpmMax: bpmMax || null,
              character: character || [], tech: tech || null };
    // A short sentence saying what the reading IS, for the user-facing summary.
    e.reads = [genre, styles.join('/'), mode].concat(e.character)
      .concat(bpmMin ? [bpmMin + '-' + bpmMax + ' bpm'] : []).join(', ');
    [name].concat(aliases || []).forEach(function (a) {
      var k = normalize(a);
      if (!k || TITLES[k]) return;
      TITLES[k] = e;
      ORDER.push(k);
    });
  }

  /* ---- Nintendo ---------------------------------------------------------- */
  P('Super Mario Bros.', 'platformer', ['funk', 'arcade'], 'major', 140, 168, ['playful', 'happier', 'brighter'], 'syncopated',
    ['mario', 'super mario', 'super mario brothers', 'smb']);
  P('Super Mario Bros. 2', 'platformer', ['arcade', 'funk'], 'major', 128, 155, ['playful', 'dreamier'], null, ['smb2']);
  P('Super Mario Bros. 3', 'platformer', ['funk', 'anthem'], 'major', 132, 162, ['playful', 'heroic', 'brighter'], 'syncopated', ['smb3']);
  P('Super Mario Land', 'platformer', ['arcade', 'funk'], 'major', 142, 170, ['playful', 'happier'], null, []);
  P('Super Mario Land 2', 'platformer', ['funk', 'arcade'], 'major', 128, 155, ['playful', 'brighter'], null, []);
  P('The Legend of Zelda', 'adventure', ['anthem', 'arcade'], 'major', 130, 158, ['heroic', 'brighter', 'intense'], null,
    ['zelda', 'legend of zelda']);
  P('Zelda II: The Adventure of Link', 'adventure', ['anthem', 'rock'], 'minor', 132, 162, ['heroic', 'mysterious'], null,
    ['zelda 2', 'adventure of link']);
  P("Link's Awakening", 'adventure', ['anthem', 'chill'], 'major', 118, 148, ['playful', 'dreamier', 'brighter'], null, ['links awakening']);
  P('Metroid', 'metroidvania', ['drone', 'chill'], 'minor', 88, 118, ['mysterious', 'sparser', 'calmer', 'darker'], null, []);
  P('Metroid II: Return of Samus', 'metroidvania', ['drone'], 'minor', 82, 112, ['mysterious', 'sparser', 'darker'], null,
    ['metroid 2', 'return of samus']);
  P('Kid Icarus', 'platformer', ['arcade', 'anthem'], 'major', 130, 158, ['heroic', 'playful'], null, []);
  P('Ice Climber', 'platformer', ['arcade'], 'major', 132, 155, ['playful', 'brighter'], null, []);
  P('Balloon Fight', 'arcade', ['arcade'], 'major', 138, 162, ['playful', 'calmer'], null, []);
  P('Excitebike', 'racing', ['arcade', 'anthem'], 'major', 148, 172, ['playful', 'intense'], null, []);
  P('Punch-Out!!', 'sports', ['anthem', 'arcade'], 'major', 140, 168, ['intense', 'heroic'], null,
    ['punch out', 'mike tysons punch out']);
  P('Donkey Kong', 'arcade', ['arcade'], 'major', 130, 158, ['playful', 'intense'], null, ['donkey kong jr']);
  P('Donkey Kong Land', 'platformer', ['funk', 'breaks'], 'major', 128, 155, ['playful', 'intense'], null, []);
  P("Kirby's Adventure", 'platformer', ['funk', 'anthem'], 'major', 130, 158, ['playful', 'happier', 'brighter'], null, ['kirby']);
  P("Kirby's Dream Land", 'platformer', ['arcade', 'funk'], 'major', 132, 160, ['playful', 'happier', 'brighter'], null, ['kirbys dreamland']);
  P('StarTropics', 'adventure', ['anthem', 'arcade'], 'major', 125, 152, ['heroic', 'playful'], null, ['star tropics']);
  P('Tetris', 'puzzle', ['arcade', 'house'], 'minor', 138, 166, ['playful', 'intense'], null, []);
  P('Dr. Mario', 'puzzle', ['funk', 'house'], 'minor', 102, 128, ['playful', 'intense'], 'syncopated', ['dr mario']);
  P('Pokemon Red and Blue', 'rpg', ['anthem', 'arcade'], 'major', 128, 156, ['playful', 'brighter', 'heroic'], null,
    ['pokemon', 'pokemon red', 'pokemon blue', 'pokemon yellow']);
  P('Pokemon Gold and Silver', 'rpg', ['anthem', 'chill'], 'major', 122, 150, ['playful', 'calmer', 'brighter'], null,
    ['pokemon gold', 'pokemon silver']);
  P('Fire Emblem', 'strategy', ['anthem', 'ballad'], 'major', 110, 140, ['solemn', 'heroic'], null, []);
  P('Wario Land', 'platformer', ['funk', 'arcade'], 'major', 130, 158, ['playful', 'intense'], null, []);

  /* ---- Konami ------------------------------------------------------------ */
  P('Castlevania', 'platformer', ['rock', 'punk'], 'minor', 145, 172, ['menacing', 'intense'], 'arpeggiated', []);
  P("Castlevania II: Simon's Quest", 'platformer', ['rock', 'anthem'], 'minor', 128, 158, ['mysterious', 'menacing', 'solemn'], null,
    ['castlevania 2', 'simons quest']);
  P("Castlevania III: Dracula's Curse", 'platformer', ['rock', 'punk'], 'minor', 148, 178, ['intense', 'menacing', 'frantic'], 'arpeggiated',
    ['castlevania 3', 'draculas curse']);
  P('Contra', 'shooter', ['rock', 'dnb'], 'minor', 150, 178, ['intense', 'frantic', 'heroic'], null, ['super c', 'super contra']);
  P('Gradius', 'shmup', ['techno', 'dnb'], 'minor', 150, 176, ['intense', 'heroic'], 'arpeggiated', []);
  P('Life Force', 'shmup', ['techno', 'dnb'], 'minor', 150, 178, ['intense', 'heroic'], null, ['salamander', 'lifeforce']);
  P('Metal Gear', 'stealth', ['chill', 'drone'], 'minor', 98, 128, ['tense', 'sparser', 'mysterious'], null, []);
  P('Teenage Mutant Ninja Turtles', 'platformer', ['rock', 'techno'], 'minor', 142, 170, ['intense', 'frantic'], null,
    ['tmnt', 'ninja turtles']);
  P("The Goonies II", 'platformer', ['arcade', 'funk'], 'minor', 132, 160, ['mysterious', 'playful'], null, ['goonies']);
  P('Lagrange Point', 'rpg', ['anthem', 'techno'], 'minor', 122, 152, ['mysterious', 'intense'], 'arpeggiated', []);
  P('Crisis Force', 'shmup', ['techno', 'dnb'], 'minor', 152, 180, ['intense', 'frantic'], null, []);
  P('Jackal', 'shooter', ['rock', 'techno'], 'minor', 140, 168, ['intense', 'tense'], null, []);
  P('Blades of Steel', 'sports', ['rock', 'anthem'], 'major', 140, 168, ['intense', 'playful'], null, []);

  /* ---- Capcom ------------------------------------------------------------ */
  P('Mega Man', 'platformer', ['anthem', 'rock'], 'minor', 150, 178, ['heroic', 'intense', 'brighter'], 'arpeggiated',
    ['megaman', 'mega man 2', 'megaman 2', 'mega man 3', 'mega man 4', 'mega man 5', 'mega man 6',
     'mega man 5 gb', 'rockman']);
  P('DuckTales', 'platformer', ['arcade', 'funk'], 'major', 140, 168, ['playful', 'brighter', 'heroic'], null, ['duck tales', 'ducktales 2']);
  P("Chip 'n Dale Rescue Rangers", 'platformer', ['funk', 'arcade'], 'major', 135, 162, ['playful', 'happier'], null,
    ['chip n dale', 'rescue rangers']);
  P('Darkwing Duck', 'platformer', ['rock', 'arcade'], 'minor', 140, 168, ['menacing', 'intense'], null, []);
  P("Ghosts 'n Goblins", 'platformer', ['arcade', 'rock'], 'minor', 148, 176, ['tense', 'menacing', 'frantic'], null,
    ['ghosts n goblins', 'ghouls n ghosts']);
  P('Bionic Commando', 'platformer', ['techno', 'rock'], 'minor', 140, 170, ['intense', 'heroic'], null, []);
  P('Strider', 'platformer', ['rock', 'techno'], 'minor', 142, 170, ['intense', 'tense'], null, []);
  P('Little Nemo: The Dream Master', 'platformer', ['chill', 'arcade'], 'major', 122, 150, ['dreamier', 'playful', 'calmer'], null,
    ['little nemo']);
  P('Mighty Final Fight', 'fighting', ['funk', 'rock'], 'minor', 138, 165, ['intense', 'playful'], null, ['final fight']);
  P("Gargoyle's Quest", 'platformer', ['drone', 'rock'], 'minor', 118, 148, ['mysterious', 'menacing'], null,
    ['gargoyles quest', 'demons crest']);
  P('1943', 'shmup', ['arcade', 'anthem'], 'minor', 145, 172, ['intense', 'solemn'], null, ['1942']);

  /* ---- Sunsoft ----------------------------------------------------------- */
  P('Blaster Master', 'metroidvania', ['rock', 'anthem'], 'minor', 130, 160, ['heroic', 'mysterious', 'intense'], null, []);
  P('Journey to Silius', 'platformer', ['techno', 'dnb'], 'minor', 145, 172, ['intense', 'sadder', 'tense'], 'arpeggiated',
    ['silius']);
  P('Batman', 'platformer', ['rock', 'techno'], 'minor', 140, 168, ['menacing', 'tense', 'intense'], null,
    ['batman return of the joker']);
  P('Gimmick!', 'platformer', ['funk', 'arcade'], 'major', 135, 162, ['playful', 'happier'], null, ['gimmick']);
  P("Fester's Quest", 'platformer', ['rock', 'techno'], 'minor', 132, 160, ['menacing', 'tense'], null, ['festers quest']);
  P('Ufouria', 'platformer', ['funk', 'arcade'], 'major', 130, 158, ['playful', 'happier'], null, []);

  /* ---- Tecmo ------------------------------------------------------------- */
  P('Ninja Gaiden', 'platformer', ['rock', 'punk'], 'minor', 148, 176, ['intense', 'tense', 'menacing'], 'arpeggiated',
    ['ninja gaiden 2', 'ninja gaiden 3', 'shadow warriors']);
  P('Rygar', 'platformer', ['anthem', 'rock'], 'minor', 130, 160, ['heroic', 'solemn', 'mysterious'], null, []);
  P('Tecmo Bowl', 'sports', ['anthem', 'funk'], 'major', 138, 166, ['intense', 'heroic'], null, []);
  P("Solomon's Key", 'puzzle', ['arcade'], 'major', 132, 160, ['playful', 'calmer'], null, ['solomons key']);

  /* ---- Rare / Tradewest -------------------------------------------------- */
  P('Battletoads', 'platformer', ['dnb', 'techno'], 'minor', 130, 172, ['intense', 'playful', 'frantic'], null,
    ['battletoads double dragon']);
  P("Snake Rattle 'n' Roll", 'platformer', ['funk', 'arcade'], 'major', 138, 165, ['playful', 'happier'], 'syncopated',
    ['snake rattle n roll']);
  P('R.C. Pro-Am', 'racing', ['arcade', 'techno'], 'major', 150, 178, ['intense', 'playful'], null, ['rc pro am']);
  P('Wizards & Warriors', 'platformer', ['anthem', 'arcade'], 'major', 135, 162, ['heroic', 'brighter'], null,
    ['wizards and warriors', 'ironsword']);
  P('Marble Madness', 'puzzle', ['funk', 'house'], 'major', 102, 128, ['playful', 'calmer', 'dreamier'], 'syncopated', []);
  P('Silver Surfer', 'shmup', ['techno', 'dnb'], 'minor', 155, 182, ['intense', 'frantic', 'mysterious'], 'arpeggiated', []);
  P('Cobra Triangle', 'racing', ['arcade', 'techno'], 'major', 145, 172, ['intense', 'playful'], null, []);
  P('Captain Skyhawk', 'shmup', ['techno', 'rock'], 'minor', 128, 142, ['intense', 'tense'], null, []);

  /* ---- Technos ----------------------------------------------------------- */
  P('Double Dragon', 'fighting', ['rock', 'funk'], 'minor', 135, 165, ['intense', 'menacing'], null,
    ['double dragon 2', 'double dragon 3']);
  P('River City Ransom', 'fighting', ['funk', 'arcade'], 'major', 135, 162, ['playful', 'intense'], null, ['river city']);
  P("Super Dodge Ball", 'sports', ['funk', 'arcade'], 'major', 138, 165, ['playful', 'intense'], null, ['super dodgeball']);

  /* ---- RPGs and adventures ----------------------------------------------- */
  P('Final Fantasy', 'rpg', ['anthem', 'ballad'], 'major', 108, 140, ['heroic', 'solemn', 'brighter'], null,
    ['final fantasy 3', 'final fantasy adventure']);
  P('Dragon Warrior', 'rpg', ['ballad', 'chill'], 'major', 76, 108, ['solemn', 'calmer', 'heroic'], null,
    ['dragon quest', 'dragon warrior 4']);
  P('Mother', 'rpg', ['chill', 'ballad'], 'major', 100, 132, ['sadder', 'dreamier', 'calmer'], null, ['earthbound beginnings']);
  P('Crystalis', 'rpg', ['anthem', 'arcade'], 'minor', 125, 155, ['heroic', 'mysterious', 'intense'], null, []);
  P('Faxanadu', 'rpg', ['ballad', 'drone'], 'minor', 72, 96, ['mysterious', 'sadder', 'calmer'], null, []);
  P('Legacy of the Wizard', 'rpg', ['anthem', 'rock'], 'minor', 125, 155, ['heroic', 'mysterious'], null, []);
  P('Willow', 'rpg', ['anthem', 'ballad'], 'major', 112, 142, ['heroic', 'solemn'], null, []);
  P('Ultima: Exodus', 'rpg', ['ballad', 'chill'], 'minor', 76, 108, ['solemn', 'mysterious'], null, ['ultima']);
  P('Shadowgate', 'adventure', ['drone', 'ballad'], 'minor', 80, 110, ['mysterious', 'menacing', 'sparser'], null, []);
  P('Maniac Mansion', 'adventure', ['chill', 'funk'], 'minor', 110, 140, ['playful', 'mysterious'], null, []);
  P('Deja Vu', 'adventure', ['chill', 'drone'], 'minor', 95, 125, ['mysterious', 'tense', 'sparser'], null, ['uninvited']);
  P('The Immortal', 'adventure', ['drone', 'ballad'], 'minor', 88, 118, ['menacing', 'solemn', 'sparser'], null, []);

  /* ---- shmups ------------------------------------------------------------ */
  P('Zanac', 'shmup', ['techno', 'dnb'], 'minor', 152, 180, ['intense', 'frantic'], null, []);
  P('The Guardian Legend', 'shmup', ['techno', 'dnb'], 'minor', 145, 175, ['intense', 'heroic'], 'arpeggiated',
    ['guardian legend']);
  P('Recca', 'shmup', ['dnb', 'techno'], 'minor', 165, 188, ['frantic', 'intense'], null, ['summer carnival 92 recca']);
  P('Gun-Nac', 'shmup', ['techno', 'arcade'], 'minor', 148, 175, ['intense', 'playful'], null, ['gun nac']);
  P('TwinBee', 'shmup', ['arcade', 'funk'], 'major', 140, 168, ['playful', 'happier'], null, ['twin bee']);
  P('Abadox', 'shmup', ['techno', 'dnb'], 'minor', 130, 172, ['menacing', 'tense', 'frantic'], null, []);
  P('Gyruss', 'shmup', ['arcade', 'techno'], 'minor', 148, 175, ['intense', 'mysterious'], 'arpeggiated', []);
  P('Galaga', 'arcade', ['arcade'], 'major', 140, 168, ['playful', 'intense'], null, ['galaxian']);
  P('Xevious', 'shmup', ['arcade', 'drone'], 'minor', 138, 165, ['mysterious', 'sparser'], null, []);

  /* ---- arcade ports and the rest ----------------------------------------- */
  P('Pac-Man', 'arcade', ['arcade', 'funk'], 'major', 138, 165, ['playful', 'happier'], null, ['pac man', 'ms pac man']);
  P('Dig Dug', 'arcade', ['arcade'], 'major', 135, 162, ['playful', 'happier'], null, []);
  P('Bubble Bobble', 'arcade', ['arcade', 'funk'], 'major', 140, 168, ['playful', 'happier', 'brighter'], null, []);
  P('Arkanoid', 'puzzle', ['arcade', 'techno'], 'minor', 142, 170, ['intense', 'calmer'], null, []);
  P('BurgerTime', 'arcade', ['arcade', 'funk'], 'major', 138, 165, ['playful', 'happier'], null, ['burger time']);
  P('Paperboy', 'arcade', ['arcade', 'funk'], 'major', 138, 165, ['playful', 'intense'], null, []);
  P('Skate or Die', 'sports', ['rock', 'funk'], 'major', 140, 168, ['intense', 'playful'], null, []);
  P('Adventures of Lolo', 'puzzle', ['chill', 'arcade'], 'major', 122, 150, ['playful', 'calmer'], null, ['lolo']);
  P('Kickle Cubicle', 'puzzle', ['arcade', 'chill'], 'major', 128, 155, ['playful', 'happier'], null, []);
  P('Felix the Cat', 'platformer', ['arcade', 'funk'], 'major', 132, 160, ['playful', 'happier'], null, []);
  P("Bucky O'Hare", 'platformer', ['rock', 'anthem'], 'minor', 145, 172, ['intense', 'heroic'], null, ['bucky ohare']);
  P('Power Blade', 'platformer', ['techno', 'dnb'], 'minor', 128, 172, ['intense', 'heroic'], 'syncopated', []);
  P('Shatterhand', 'platformer', ['techno', 'rock'], 'minor', 142, 170, ['intense', 'tense'], null, []);
  P('Vice: Project Doom', 'platformer', ['techno', 'rock'], 'minor', 140, 168, ['tense', 'menacing'], null, ['project doom']);
  P('Kabuki Quantum Fighter', 'platformer', ['techno', 'rock'], 'minor', 142, 170, ['intense', 'frantic'], null, ['kabuki']);
  P('Clash at Demonhead', 'platformer', ['funk', 'arcade'], 'major', 132, 160, ['playful', 'mysterious'], null, ['demonhead']);
  P('Little Samson', 'platformer', ['anthem', 'arcade'], 'major', 132, 160, ['heroic', 'playful'], null, []);
  P('Moon Crystal', 'platformer', ['ballad', 'anthem'], 'minor', 118, 148, ['sadder', 'solemn', 'dreamier'], null, []);
  P('Solstice', 'puzzle', ['trance', 'techno'], 'minor', 140, 170, ['mysterious', 'dreamier', 'intense'], 'arpeggiated', []);
  P('Treasure Master', 'platformer', ['techno', 'trance'], 'minor', 128, 142, ['intense', 'playful'], 'arpeggiated', []);
  P('Friday the 13th', 'horror', ['drone', 'ballad'], 'minor', 85, 115, ['menacing', 'tense', 'sparser'], null, ['friday the 13']);
  P('A Nightmare on Elm Street', 'horror', ['drone', 'ballad'], 'minor', 74, 100, ['menacing', 'tense', 'dreamier'], null,
    ['nightmare on elm street']);
  P('Shantae', 'platformer', ['funk', 'house'], 'major', 102, 128, ['playful', 'brighter'], null, []);

  // Longest key first, so "castlevania 3" beats "castlevania" and
  // "super mario bros 3" beats "mario".
  ORDER.sort(function (a, b) { return b.length - a.length || a.localeCompare(b); });

  // Find every known title in a normalised sentence. Returns matches with the
  // character span each occupies, so the caller can BLANK them before matching
  // ordinary vocabulary -- otherwise "Kirby's Adventure" would also register as
  // the game genre "adventure", and "Metal Gear" as the word "metal".
  function scan(normalizedText) {
    var pad = ' ' + normalizedText + ' ';
    var taken = new Array(pad.length).fill(false);
    var found = [];
    ORDER.forEach(function (key) {
      var needle = ' ' + key + ' ';
      var from = 0, at;
      while ((at = pad.indexOf(needle, from)) >= 0) {
        from = at + 1;
        var s = at + 1, e = at + needle.length - 1;
        var clash = false;
        for (var i = s; i < e; i++) if (taken[i]) { clash = true; break; }
        if (clash) continue;
        for (var j = s; j < e; j++) taken[j] = true;
        found.push({ entry: TITLES[key], matched: key, start: s - 1, end: e - 1 });
      }
    });
    found.sort(function (a, b) { return a.start - b.start; });
    return found;
  }

  var API = { TITLES: TITLES, normalize: normalize, scan: scan,
              names: function () {
                var seen = [], out = [];
                ORDER.forEach(function (k) {
                  var e = TITLES[k];
                  if (seen.indexOf(e) >= 0) return;
                  seen.push(e); out.push(e.name);
                });
                return out.sort();
              } };
  G.CT_REFERENCE_STYLES = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : window);
