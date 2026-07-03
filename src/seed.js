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

  // --- readable phrase slots. Fresh mints add an 8-char base36 nonce: 36^8 (~2.8T) suffixes per
  //     phrase, so "next" never cycles through a small audible neighborhood of near-duplicate names. ---
  var SLOTS = [
    ['velvet','neon','golden','hollow','restless','silent','electric','frozen','molten','lonely','gentle','savage','ancient','distant','secret','endless','fragile','radiant','weary','fearless','crimson','cobalt','amber','violet','copper','scarlet','ivory','onyx','ember','marble','twilight','lunar'],
    ['tigers','foxes','robots','comets','sirens','wolves','sparrows','dreamers','angels','machines','shadows','sailors','dancers','rebels','ghosts','lanterns','engines','horses','pilots','gardens','mountains','rivers','towers','circuits','satellites','wanderers','lovers','strangers','voyagers','falcons','embers','giants'],
    ['drift','dream','dance','wander','race','glide','burn','rise','fall','spin','sleep','sing','chase','fade','bloom','shiver','soar','echo','drown','wake','roam','sway','melt','gleam','tremble','whisper','collide','scatter','linger','ascend','ignite','dissolve'],
    ['dusk','dawn','rain','glass','light','static','fog','snow','fire','dust','silence','thunder','ocean','sky','void','mist','storm','tide','ash','smoke','twilight','horizon','harbor','desert','garden','cinder','frost','echo','shore','dream','neon','midnight']
  ];
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
  function looksLikeCode(w){ return /^[0-9a-z]{6,14}$/.test(w||'') && /[0-9]/.test(w||'') && /[a-z]/.test(w||''); }

  // A composer pack may prefix its id: "<composerId>.<phrase>-<code8>". Strip it for display/parse.
  function stripComposer(slug){ var s=String(slug||''); var d=s.indexOf('.'); return d>0 ? s.slice(d+1) : s; }

  function title(slug){
    var parts=slugify(stripComposer(slug)).split('-').filter(Boolean);
    if(parts.length && looksLikeCode(parts[parts.length-1])) parts.pop();           // drop the entropy nonce
    while(parts.length>4 && LEGACY_PREFIXES.indexOf(parts[0])>=0) parts.shift();     // strip old idiom/target prefixes
    if(!parts.length) parts=slugify(stripComposer(slug)).split('-').filter(Boolean);
    return parts.map(titleCaseWord).join(' ') || 'Retro Rave Radio';
  }

  function mint(opts){
    opts=opts||{};
    var rand=opts.random||null;
    var words=[ pick(SLOTS[0], rand), pick(SLOTS[1], rand), pick(SLOTS[2], rand), pick(SLOTS[3], rand) ];
    return words.join('-')+'-'+code8(rand);
  }

  return {
    V: 3,                                                   // freeform-phrase generated-song identity (no forced prefixes)
    seed:  function(name){ return hash32(norm(name)); },    // 32-bit composition seed
    rng:   function(name){ return mulberry32(hash32(norm(name))); },
    slugify: slugify,
    title: title,
    mint: mint,
    stripComposer: stripComposer,
    _hash32: hash32, _mulberry32: mulberry32                // exposed for tests
  };
})();
