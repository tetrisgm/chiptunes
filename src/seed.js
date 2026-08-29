// ===== seed.js — deterministic generated-track identity. =====
// Loads FIRST (before composer.js/audio.js) so any composer can seed itself from a URL token.
// A generated URL is just a readable phrase + entropy: /track/<phrase>-<code8>. There is no
// per-platform / per-genre / idiom prefix any more — the composer samples the full space, so the
// token is only an identity, not a recipe of forced choices. Routes identify content; local
// settings choose presentation. Non-default composer packs prefix their id ("<composerId>.<phrase>-<code8>").
var Song = (function(){
  // --- deterministic integer hash (FNV-1a, 32-bit) + mulberry32 PRNG. Pure 32-bit integer math
  //     (Math.imul is exact), identical on every JS engine. ---
  function hash32(str){ str=''+str; var h=2166136261>>>0;
    for(var i=0;i<str.length;i++){ h^=str.charCodeAt(i); h=Math.imul(h,16777619); } return h>>>0; }
  function mulberry32(a){ a=a>>>0; return function(){ a=(a+0x6D2B79F5)|0;
    var t=Math.imul(a^(a>>>15), 1|a); t=(t+Math.imul(t^(t>>>7), 61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; }; }

  // --- THE CARTRIDGE LABEL VOCABULARY -------------------------------------
  //
  // Names used to be four soft words -- "Velvet Tigers Drift Dusk" -- which is
  // an indie-album phrase, not something that was ever printed on a grey
  // cartridge. The music is NES and Game Boy; the names should read like the
  // shelf it came off. So: era words only, assembled in the shapes real
  // cartridge labels took -- an adjective and a subject, a subject and a
  // mission, a place and what happens there, and the sequel numeral that was
  // on half the shelf.
  //
  // The words are deliberately GENERIC. That is not a style choice: a
  // generated title that lands on a real one puts a trademark on a page we
  // publish, and the repository is what a complaint lands on (see AGENTS.md on
  // pack naming -- this is the same hazard with the same answer). Generic
  // vocabulary makes collisions rare; BLOCKED, below, makes them impossible
  // for the ones this vocabulary can actually reach.
  var W = {
    // what kind of thing it is
    adj: ['turbo','super','hyper','mega','ultra','cosmic','astro','neo','cyber','laser',
          'plasma','atomic','solar','lunar','crystal','thunder','shadow','iron','steel','chrome',
          'neon','phantom','mystic','ancient','savage','rapid','blazing','frozen','twin','double',
          'final','secret','hidden','dark','silver','golden','emerald','jade','obsidian','quantum',
          'radical','rocket','magma','glacial','electric','magnetic','spectral','molten','arctic','scarlet',
          'cobalt','crimson','velvet','wild','grand','royal','elite','prime','omega','delta'],
    // who or what is doing it
    hero:['ninja','samurai','knight','wizard','warrior','ranger','raider','rider','pilot','captain',
          'commander','soldier','trooper','hunter','slayer','fighter','gunner','blaster','bomber','racer',
          'runner','jumper','climber','diver','tank','mech','robot','android','cyborg','droid',
          'dragon','phoenix','falcon','hawk','wolf','tiger','panther','viper','cobra','scorpion',
          'mantis','beetle','turtle','frog','bat','ghost','goblin','wraith','golem','titan',
          'giant','sentinel','guardian','marauder','buccaneer','nomad','drifter','scout','sniper','ace'],
    // where it happens
    place:['zone','land','world','island','castle','tower','dungeon','cavern','canyon','valley',
           'forest','swamp','desert','glacier','volcano','city','metropolis','station','outpost','fortress',
           'citadel','temple','shrine','palace','labyrinth','maze','arena','coliseum','factory','foundry',
           'reactor','laboratory','sewer','highway','speedway','galaxy','nebula','orbit','moon','comet',
           'void','abyss','ridge','summit','harbor','junkyard','wasteland','frontier','bunker','vault'],
    // what you are there to do
    mission:['quest','saga','legend','chronicle','adventure','mission','patrol','brigade','squadron','battalion',
             'force','squad','corps','command','strike','assault','attack','invasion','rampage','rescue',
             'escape','revenge','revolt','uprising','gauntlet','crusade','odyssey','pursuit','chase','showdown',
             'duel','tournament','rally','blitz','panic','frenzy','fever','mania','madness','rush',
             'dash','sprint','scramble','offensive','onslaught','siege','raid','hunt','trial','circuit']
  };
  // Roman numerals were on half the shelf and are most of what made a name
  // read as a cartridge rather than a song.
  var NUMERALS = ['II','III','IV','V','VI','X','2','3','\'89','\'91','DX','EX','GX','Turbo','Plus','Zero'];

  // Real titles this vocabulary can actually produce. Checked on every mint;
  // a hit is re-rolled, never shipped. Normalized to lowercase letters and
  // digits only, so spacing and punctuation cannot slip one past.
  var BLOCKED = (function(){
    var t = ['double dragon','shadow warrior','shadow warriors','thunder force','dragon warrior',
      'ice climber','blaster master','iron tank','twin cobra','mystic quest','solar striker',
      'cosmic tank','star fox','marble madness','battle city','rad racer','final fight',
      'ninja gaiden','mega man','metal gear','final fantasy','silver surfer','golden axe',
      'space harrier','altered beast','phantasy star','bionic commando','ikari warriors',
      'super mario land','adventure island','kid icarus','bubble bobble','balloon fight',
      'city connection','elevator action','rolling thunder','shadow dancer','crystal quest',
      'laser blast','dragon quest','battle arena','ghost squad','robot warriors','turbo racing',
      'cyber police','last resort','burning rangers','steel empire','magma tank','crystal beans',
      'phantom fighter','wizards warriors','solar jetman','time lord','silent service',
      'guerrilla war','sky shark','snake rattle','cobra triangle','dark castle','shadow brigade',
      'raiden trad','power blade','vice project','image fight','captain skyhawk','wild guns',
      'super dodge','river city','crash dummies','battle clash','metal storm','over horizon',
      'thunder blade','galaxy force','after burner','out run','hang on','virtua racing',
      'panzer dragoon','shining force','landstalker','beyond oasis','gain ground','golden sun'];
    var m = Object.create(null);
    for(var i=0;i<t.length;i++) m[t[i].replace(/[^a-z0-9]+/g,'')] = 1;
    return m;
  })();
  function blocked(name){ return !!BLOCKED[String(name).toLowerCase().replace(/[^a-z0-9]+/g,'')]; }

  // The shapes a cartridge label actually took. Each is a function of the same
  // seeded generator, so a token always names the same song.
  var SHAPES = [
    function(r){ return [pick(W.adj,r), pick(W.hero,r), pick(W.mission,r)]; },       // Turbo Falcon Gauntlet
    function(r){ return [pick(W.adj,r), pick(W.hero,r), pick(W.NUM,r)]; },           // Neon Samurai II
    function(r){ return [pick(W.adj,r), pick(W.place,r), pick(W.mission,r)]; },      // Frozen Fortress Rampage
    function(r){ return [pick(W.hero,r), pick(W.mission,r), pick(W.NUM,r)]; },       // Raider Squadron III
    function(r){ return [pick(W.adj,r), pick(W.hero,r)]; },                          // Cobalt Marauder
    function(r){ return [pick(W.hero,r), pick(W.mission,r)]; },                      // Phoenix Crusade
    function(r){ return [pick(W.adj,r), pick(W.place,r)]; },                         // Molten Citadel
    function(r){ return [pick(W.place,r), pick(W.mission,r), pick(W.NUM,r)]; }       // Canyon Rally EX
  ];
  W.NUM = NUMERALS;

  // Prefixes the OLD (V2) token scheme put in front of the readable phrase. Kept ONLY so old shared
  // /track/ URLs strip cleanly into a title; they no longer influence the music (the composer ignores them).
  var LEGACY_PREFIXES = ['arcade','radio','stage','boss','club','dream','pocket','scene','drive','cell','engine','machine','hook','tool','cue','rush','system','cart',
    'trance','house','techno','dub','liquid','dnb','chip','tech','robots','nes','gameboy','gb','genesis','snes','turbografx','neogeo','lsdj'];

  function norm(name){ return (''+name).toLowerCase(); }
  function slugify(s){ return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,''); }
  function titleCaseWord(w){ return w ? w.charAt(0).toUpperCase()+w.slice(1) : ''; }
  function randU32(rand){
    if(!rand && typeof crypto!=='undefined' && crypto.getRandomValues){
      var a=new Uint32Array(1); crypto.getRandomValues(a); return a[0]>>>0;
    }
    var r=rand||Math.random; return (r()*4294967296)>>>0;
  }
  function pick(a, rand){ return a[randU32(rand)%a.length]; }
  function code8(rand){ var cs='0123456789abcdefghijklmnopqrstuvwxyz', out='', hasD=false, hasL=false;
    for(var i=0;i<8;i++){ var c=cs.charAt(randU32(rand)%cs.length); out += c; if(/[0-9]/.test(c)) hasD=true; else hasL=true; }
    if(!hasD) out=''+(randU32(rand)%10)+out.slice(1);
    if(!hasL) out=out.slice(0,1)+String.fromCharCode(97+(randU32(rand)%26))+out.slice(2);
    return out;
  }
  function looksLikeCode(w){ return /^[0-9a-z]{6,24}$/.test(w||'') && /[0-9]/.test(w||'') && /[a-z]/.test(w||''); }   // 24: a modern token is one 16-char run. Needs BOTH a digit and a letter, so a real word never matches.

  // A composer pack may prefix its id: "<composerId>.<phrase>-<code8>". Strip it for display/parse.
  function stripComposer(slug){ var s=String(slug||''); var d=s.indexOf('.'); return d>0 ? s.slice(d+1) : s; }

  function title(slug){
    var parts=slugify(stripComposer(slug)).split('-').filter(Boolean);
    if(parts.length && looksLikeCode(parts[parts.length-1])) parts.pop();           // drop the entropy nonce
    while(parts.length>4 && LEGACY_PREFIXES.indexOf(parts[0])>=0) parts.shift();     // strip old idiom/target prefixes
    // A modern token is pure entropy and carries no words to read: mint the
    // name from it instead. Old word-slugs still read out as themselves.
    if(!parts.length || parts.every(looksLikeCode)) return nameFor(slug);
    return parts.map(titleCaseWord).join(' ') || 'Chiptunes.app';
  }

  // A TOKEN IS ENTROPY, NOT A NAME.
  //
  // It used to be four words plus an eight-character nonce, and the composer
  // hashes whatever it is handed -- so the words sat in the musical input.
  // Measured, they changed nothing: holding the phrase fixed and varying only
  // the nonce gives the same spread of styles and tempos as varying everything,
  // because 41 bits of nonce dominate the hash. But the coupling was real even
  // where its effect was not: a song could not be RENAMED without becoming a
  // different song, and editing the word lists would have silently rewritten
  // every future composition. Causality runs one way now -- token to music, and
  // separately token to name -- so the words can never reach the composer.
  function mint(opts){
    opts=opts||{};
    var rand=opts.random||null;
    return code8(rand)+code8(rand);          // 16 base36 chars, ~82 bits
  }

  // ...and the name is minted FROM the token, at the very end, for the label
  // and nothing else. Deriving it (rather than storing it) keeps one song's
  // name stable across a reload and carries it through a shared link for free.
  function nameFor(token){
    var r = mulberry32(hash32(norm(token)+':name'));
    // Up to eight goes at an unblocked name. Each attempt draws from the same
    // stream, so a re-roll is still a pure function of the token; the loop
    // only ever runs more than once for the handful of combinations BLOCKED
    // names, and the last attempt is a shape that cannot collide.
    for(var i=0;i<8;i++){
      var parts = SHAPES[randU32(r)%SHAPES.length](r);
      var name  = parts.map(function(w){
        return /^[IVX0-9']/.test(w) ? w : titleCaseWord(w);   // numerals keep their case
      }).join(' ');
      if(!blocked(name)) return name;
    }
    return titleCaseWord(pick(W.adj,r))+' '+titleCaseWord(pick(W.hero,r))+' '+
           titleCaseWord(pick(W.mission,r));
  }

  return {
    V: 3,                                                   // freeform-phrase generated-song identity (no forced prefixes)
    seed:  function(name){ return hash32(norm(name)); },    // 32-bit composition seed
    rng:   function(name){ return mulberry32(hash32(norm(name))); },
    slugify: slugify,
    title: title,
    mint: mint,
    nameFor: nameFor,
    stripComposer: stripComposer,
    _hash32: hash32, _mulberry32: mulberry32                // exposed for tests
  };
})();
// Node export (live schedule + broadcaster + smoke tests import this file directly;
// in the browser bundle the top-level var above is the shared binding). Same pattern as composer.js.
if(typeof module!=='undefined' && module.exports) module.exports = Song;
