// THE PAGE, DRIVEN BY AN AGENT.
//
// This is the other half of the agent story and a different job from src/api.js.
// The Node API makes songs; this controls the SESSION somebody is looking at:
// what is playing, skip it, put a specific song on the deck, open the editor.
// Making tracks does not need a browser and should not use this. Operating the
// running app cannot use anything else.
//
// Two surfaces, one implementation:
//   * window.chiptunes  — always present, callable from the console or from any
//     automation that can evaluate script in the page.
//   * document.modelContext (WebMCP) — registered when the browser has it, so
//     a browsing agent discovers these as tools instead of guessing at globals.
//     The spec is young; this degrades to the plain object with no error when
//     it is absent, which is most browsers today.
//
// Everything here is a thin call into what the app already exposes. No new
// behaviour, so an agent and a person cannot end up in different states.
(function (G) {
  'use strict';
  if (typeof document === 'undefined') return;

  function has(fn) { return typeof fn === 'function'; }
  function safe(fn, dflt) { try { return fn(); } catch (e) { return dflt; } }
  // ⚠️ `Audio` IS A TOP-LEVEL const IN THIS BUNDLE, NOT A WINDOW PROPERTY.
  // `G.Audio` is the browser's native HTMLAudioElement constructor, which has
  // no currentDoc and no playDoc -- reaching for it that way silently returns
  // nothing rather than failing, so the page reports "no song" while a song is
  // playing. Always the bare name, behind a typeof guard. Same for the other
  // function declarations here: they are lexical, not window properties.
  function deck() { return (typeof Audio !== 'undefined' && Audio && Audio.currentDoc) ? Audio : null; }

  // The composer, the measurements and the exporters, all already in this page.
  function api() { return G.CT_API && has(G.CT_API.ask) ? G.CT_API : null; }
  // A file built in the page and handed to the user. No upload, no round trip.
  function download(bytes, filename, mime) {
    try {
      var arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      var url = URL.createObjectURL(new Blob([arr], { type: mime || 'application/octet-stream' }));
      var a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      return true;
    } catch (e) { return false; }
  }

  var TOOLS = [
    {
      name: 'chiptunes_now_playing',
      description: 'What the station is playing right now: title, tempo, position, whether it is paused, which screen face is on, and whether the editor is open.',
      inputSchema: { type: 'object', properties: {} },
      run: function () {
        var d = safe(function () { return G.__rrrPanelDiag && G.__rrrPanelDiag(); }, null);
        return {
          title: safe(function () { return (document.getElementById('pbTitle') || {}).textContent || ''; }, ''),
          paused: safe(function () { return typeof _transportIsPaused === 'function' ? !!_transportIsPaused() : null; }, null),
          seconds: safe(function () { return Math.round((deck() && Audio.audiblePosition && Audio.audiblePosition()) || 0); }, null),
          screen: d ? d.mode : null,
          screenRandom: d ? !!d.mix : null,
          editorOpen: safe(function () { return !!(G.CT_CREATE && G.CT_CREATE.isOpen && G.CT_CREATE.isOpen()); }, false),
          moods: safe(function () { return G.CT_CREATE && G.CT_CREATE.moods ? G.CT_CREATE.moods() : []; }, [])
        };
      }
    },
    {
      name: 'chiptunes_play_mood',
      description: 'Compose a complete song for a mood word and play it. Use chiptunes_now_playing to see the available moods.',
      inputSchema: { type: 'object', properties: { mood: { type: 'string' } }, required: ['mood'] },
      run: function (a) {
        var mood = String((a && a.mood) || '');
        var btn = null;
        try {
          btn = [].slice.call(document.querySelectorAll('.rmood')).filter(function (b) {
            return b.textContent.trim().toLowerCase() === mood.toLowerCase();
          })[0] || null;
        } catch (e) {}
        if (btn) { btn.click(); return { ok: true, mood: mood, via: 'button' }; }
        if (typeof _moodOnAir === 'function') { _moodOnAir(mood, null); return { ok: true, mood: mood, via: 'api' }; }
        return { ok: false, error: 'no such mood: ' + mood };
      }
    },
    {
      name: 'chiptunes_transport',
      description: 'Control playback: next, previous, play, pause or toggle.',
      inputSchema: {
        type: 'object',
        properties: { action: { type: 'string', enum: ['next', 'previous', 'toggle', 'play', 'pause'] } },
        required: ['action']
      },
      run: function (a) {
        var act = String((a && a.action) || 'toggle');
        var id = act === 'next' ? 'pbNext' : act === 'previous' ? 'pbPrev' : 'pbPlay';
        var el = document.getElementById(id);
        if (!el) return { ok: false, error: 'transport not on screen yet; start a song first' };
        var paused = safe(function () { return typeof _transportIsPaused === 'function' ? !!_transportIsPaused() : null; }, null);
        if ((act === 'play' && paused === false) || (act === 'pause' && paused === true)) return { ok: true, already: act };
        el.click();
        return { ok: true, action: act };
      }
    },
    {
      name: 'chiptunes_current_song',
      description: 'The document of the song on air. It is the whole arrangement as a string, and it round-trips: hand it to chiptunes_play_song, to a share link, or to the Node API to edit or export it.',
      inputSchema: { type: 'object', properties: {} },
      run: function () {
        var doc = safe(function () { return (deck() && Audio.currentDoc()) || ''; }, '');
        return doc ? { document: doc, length: doc.length } : { error: 'nothing is playing yet' };
      }
    },
    {
      name: 'chiptunes_play_song',
      description: 'Put a specific song document on the deck and play it, with its visuals and transport, exactly as a shared link would.',
      inputSchema: { type: 'object', properties: { document: { type: 'string' } }, required: ['document'] },
      run: function (a) {
        if (!deck() || !has(Audio.playDoc)) return { ok: false, error: 'the player is not ready' };
        var ok = Audio.playDoc(String((a && a.document) || ''));
        return ok ? { ok: true } : { ok: false, error: 'that is not a playable song document' };
      }
    },
    {
      name: 'chiptunes_editor',
      description: 'Open the tracker on the song that is playing, on a given document, or on an empty song; or close it and hand the screen back to the station.',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['open', 'open_blank', 'close'] },
          document: { type: 'string', description: 'optional: open this song instead of the one playing' }
        },
        required: ['action']
      },
      run: function (a) {
        var act = String((a && a.action) || 'open');
        if (act === 'close') {
          if (G.CT_CREATE && has(G.CT_CREATE.close)) { G.CT_CREATE.close(); return { ok: true }; }
          return { ok: false, error: 'the editor is not open' };
        }
        if (act === 'open_blank') {
          if (typeof _openCreate === 'function') { _openCreate(true); return { ok: true, blank: true }; }
          return { ok: false, error: 'the editor is unavailable' };
        }
        if (a && a.document && G.CT_CREATE && has(G.CT_CREATE.open)) {
          G.CT_CREATE.open(String(a.document)); return { ok: true, from: 'document' };
        }
        if (typeof _openCreate === 'function') { _openCreate(false); return { ok: true, from: 'now playing' }; }
        return { ok: false, error: 'the editor is unavailable' };
      }
    },
    {
      name: 'chiptunes_variant',
      description: 'Make a version of the song on air with a different feeling and play it: sadder for a death screen, intense for a boss, calmer for a menu. The original document is returned too, so you can go back.',
      inputSchema: {
        type: 'object',
        properties: { mood: { type: 'string', description: 'happier, sadder, darker, brighter, calmer, intense, sparser, dreamier' } },
        required: ['mood']
      },
      run: function (a) {
        if (!deck() || !has(Audio.currentDoc)) return { ok: false, error: 'the player is not ready' };
        var before = Audio.currentDoc() || '';
        if (!before) return { ok: false, error: 'nothing is playing yet' };
        if (!G.CT_API || !has(G.CT_API.variant)) return { ok: false, error: 'the variant API is unavailable in this build' };
        var r;
        try { r = G.CT_API.variant(before, { mood: String((a && a.mood) || '') }); }
        catch (e) { return { ok: false, error: e && e.message ? e.message : String(e) }; }
        var played = Audio.playDoc(r.doc);
        return played ? { ok: true, applied: r.applied, previous: before } : { ok: false, error: 'the variant would not play' };
      }
    },
    {
      name: 'chiptunes_screen',
      description: 'Choose the display: crt (Modern), dmg (Game Boy), nes, or mix to let it re-roll on every track.',
      inputSchema: {
        type: 'object',
        properties: { mode: { type: 'string', enum: ['crt', 'dmg', 'nes', 'mix'] } },
        required: ['mode']
      },
      run: function (a) {
        if (!has(G.__rrrScreenMode)) return { ok: false, error: 'the screen control is unavailable' };
        return { ok: true, screen: G.__rrrScreenMode(String((a && a.mode) || 'mix')) };
      }
    },
    // ---- THE PART THAT NEEDS NO SERVER ---------------------------------
    //
    // Everything above operates the running app. Everything below COMPOSES,
    // MEASURES and EXPORTS, in the page, with no request going anywhere.
    // That is the whole reason this belongs in WebMCP rather than behind an
    // API: the capability travels with the page, so an agent that can open a
    // tab can write music with no key, no quota, no account and no cost. A
    // song is 1.6 ms, so an agent can afford to generate twenty, measure them
    // and keep one -- a loop that is unaffordable against a hosted model.
    {
      name: 'chiptunes_capabilities',
      description: 'Every word this understands and every knob it has: scenes, moods, musical genres, game genres, forms, techniques, the hundred-odd game titles it can read as a style, the transform operations, and the things it deliberately cannot do. Read this BEFORE composing rather than guessing at vocabulary.',
      inputSchema: { type: 'object', properties: {} },
      run: function () {
        if (!api()) return { error: 'the composer is not loaded' };
        var c = safe(function () { return G.CT_API.capabilities(); }, null);
        if (!c) return { error: 'capabilities unavailable' };
        return {
          scenes: c.scenes, moods: c.moodWords, genres: c.genres, gameGenres: c.gameGenres,
          forms: c.forms, techniques: c.techniques, operations: c.operations,
          titles: c.titles, titleCount: (c.titles || []).length,
          meter: c.meter, references: c.references, writing: c.writing,
          deterministic: c.deterministic,
          note: 'Composition happens in this page. Nothing is uploaded, nothing is metered, and the same document always gives the same song.'
        };
      }
    },
    {
      name: 'chiptunes_ask',
      description: 'Describe music in a sentence and hear it: "a dungeon theme like Castlevania, 40 seconds, no drums", "a gloomy song about exploring a cave", or a change to what is on air like "make it much slower". Returns exactly what it understood, what it ignored, and anything it refused, so you can tell the user the truth rather than guessing whether it worked.',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'the request, in plain English' },
          apply_to_current: { type: 'boolean', description: 'treat it as a change to the song on air rather than a new one' },
          play: { type: 'boolean', description: 'put the result on the deck (default true)' }
        },
        required: ['text']
      },
      run: function (a) {
        if (!api()) return { ok: false, error: 'the composer is not loaded' };
        var cur = (a && a.apply_to_current) ? safe(function () { return (deck() && Audio.currentDoc()) || ''; }, '') : '';
        var r;
        try { r = G.CT_API.ask(String((a && a.text) || ''), cur ? { doc: cur } : {}); }
        catch (e) { return { ok: false, error: e && e.message ? e.message : String(e) }; }
        if (!r.ok) return { ok: false, error: r.error, understood: r.understood, refused: r.unsupported };
        var out = { ok: true, applied: r.applied, ignored: r.notUnderstood,
                    refused: r.unsupported, document: r.doc };
        out.summary = safe(function () { return G.CT_API.describe(r.doc); }, null);
        if (!(a && a.play === false) && deck() && has(Audio.playDoc)) out.playing = !!Audio.playDoc(r.doc);
        return out;
      }
    },
    {
      name: 'chiptunes_compose',
      description: 'Compose from a structured brief rather than a sentence: a scene, a length in seconds, a key and mode, voices to leave out. Anything it could not satisfy comes back in `unmet` instead of being quietly dropped.',
      inputSchema: {
        type: 'object',
        properties: {
          scene: { type: 'string', description: 'title, menu, overworld, town, shop, cave, battle, boss, victory, game_over, credits' },
          seconds: { type: 'number' },
          bars: { type: 'number' },
          key: { type: 'string', description: 'C, D, F#, A# ...' },
          mode: { type: 'string', enum: ['major', 'minor'] },
          exclude: { type: 'array', items: { type: 'string' }, description: 'lanes to leave out: Melody, Harmony, Bass, Drums' },
          play: { type: 'boolean' }
        }
      },
      run: function (a) {
        if (!api()) return { ok: false, error: 'the composer is not loaded' };
        a = a || {};
        var spec = {};
        ['scene', 'seconds', 'bars', 'key', 'mode', 'exclude'].forEach(function (k) {
          if (a[k] != null && a[k] !== '') spec[k] = a[k];
        });
        var r;
        try { r = G.CT_API.brief(spec); }
        catch (e) { return { ok: false, error: e && e.message ? e.message : String(e) }; }
        var out = { ok: true, document: r.doc, unmet: r.unmet, title: r.title,
                    bpm: r.bpm, bars: r.bars, seconds: r.seconds, cartridgeBytes: r.cartridgeBytes };
        if (a.play !== false && deck() && has(Audio.playDoc)) out.playing = !!Audio.playDoc(r.doc);
        return out;
      }
    },
    {
      name: 'chiptunes_variations',
      description: 'Compose several DIFFERENT songs from one brief and get them all back, unranked, each with its measurements. This is the thing that is cheap here and expensive everywhere else: twenty complete songs take about thirty milliseconds and cost nothing, so you can offer the user a real choice instead of one take. Nothing is scored or pre-selected; the choosing is yours.',
      inputSchema: {
        type: 'object',
        properties: {
          scene: { type: 'string' },
          seconds: { type: 'number' },
          key: { type: 'string' },
          mode: { type: 'string', enum: ['major', 'minor'] },
          n: { type: 'number', description: 'how many, 1 to 20' }
        }
      },
      run: function (a) {
        if (!api()) return { ok: false, error: 'the composer is not loaded' };
        a = a || {};
        var spec = {};
        ['scene', 'seconds', 'key', 'mode'].forEach(function (k) { if (a[k] != null && a[k] !== '') spec[k] = a[k]; });
        var n = Math.max(1, Math.min(20, a.n || 5)), started = safe(function () { return Date.now(); }, 0);
        var list;
        // variations() returns an ENVELOPE -- {asked, count, candidates, note}
        // -- not a bare array, which is right for an API and easy to forget
        // here. Reaching for .map on it failed at the agent, not in any unit
        // test, which is why verify-webmcp calls every tool for real.
        try { list = (G.CT_API.variations(spec, n) || {}).candidates || []; }
        catch (e) { return { ok: false, error: e && e.message ? e.message : String(e) }; }
        return {
          ok: true,
          tookMs: safe(function () { return Date.now() - started; }, null),
          note: 'Unranked and unselected, on purpose. Play one with chiptunes_play_song.',
          options: list.map(function (v, i) {
            var an = safe(function () { return G.CT_API.analyse(v.doc); }, null);
            return {
              index: i, title: v.title, bpm: v.bpm, seconds: v.seconds, document: v.doc,
              character: an ? { key: an.key, mode: an.mode, majorness: an.majorness,
                                melodyNotes: an.melody.n, sitsAt: an.melody.meanPitch,
                                phraseArc: an.melody.phraseArc, consonance: an.melody.consonance,
                                busyness: an.density.onsetsPerSecond } : null
            };
          })
        };
      }
    },
    {
      name: 'chiptunes_analyse',
      description: 'Measure a song instead of listening to it: how major or minor its pitch material is, whether its phrases climb or fall, how much the melody agrees with the chords under it, how high it sits, how busy it is, whether it ends on the tonic. You cannot hear the output; this is how you check that what you asked for is what you got.',
      inputSchema: {
        type: 'object',
        properties: { document: { type: 'string', description: 'omit to measure whatever is on air' } }
      },
      run: function (a) {
        if (!api()) return { error: 'the composer is not loaded' };
        var doc = (a && a.document) || safe(function () { return (deck() && Audio.currentDoc()) || ''; }, '');
        if (!doc) return { error: 'nothing is playing and no document was given' };
        try { return G.CT_API.analyse(doc); }
        catch (e) { return { error: e && e.message ? e.message : String(e) }; }
      }
    },
    {
      name: 'chiptunes_export',
      description: 'Take the music away: a share link that carries the whole arrangement in the URL, a Standard MIDI file, or a 32 KB .gb cartridge that boots on real Game Boy hardware. The link needs no server and stores nothing; the files are built in the page and handed straight to the user.',
      inputSchema: {
        type: 'object',
        properties: {
          format: { type: 'string', enum: ['link', 'midi', 'rom'] },
          document: { type: 'string', description: 'omit to export whatever is on air' }
        },
        required: ['format']
      },
      run: function (a) {
        if (!api()) return { ok: false, error: 'the composer is not loaded' };
        a = a || {};
        var doc = a.document || safe(function () { return (deck() && Audio.currentDoc()) || ''; }, '');
        if (!doc) return { ok: false, error: 'nothing is playing and no document was given' };
        var fmt = String(a.format || 'link');
        try {
          if (fmt === 'link') return { ok: true, url: G.CT_API.shareUrl(doc),
            note: 'The whole song is in the fragment, which browsers never send to a server.' };
          var name = safe(function () { return (G.CT_API.describe(doc).title || 'song'); }, 'song')
                       .replace(/[^A-Za-z0-9 _-]+/g, '').trim() || 'song';
          var bytes = fmt === 'midi' ? G.CT_API.toMidi(doc) : G.CT_API.buildCartridge(doc);
          var saved = download(bytes, name + (fmt === 'midi' ? '.mid' : '.gb'),
                               fmt === 'midi' ? 'audio/midi' : 'application/octet-stream');
          return { ok: saved, filename: name + (fmt === 'midi' ? '.mid' : '.gb'),
                   bytes: bytes && bytes.length != null ? bytes.length : null,
                   note: saved ? 'Handed to the browser as a download.' : 'Built, but the browser refused the download.' };
        } catch (e) { return { ok: false, error: e && e.message ? e.message : String(e) }; }
      }
    }

  ];

  // window.chiptunes: the same tools as plain methods, plus the descriptors so
  // anything driving the page can read what is available rather than guess.
  var surface = { version: 1, tools: TOOLS.map(function (t) {
    return { name: t.name, description: t.description, inputSchema: t.inputSchema }; }) };
  TOOLS.forEach(function (t) {
    surface[t.name.replace(/^chiptunes_/, '')] = function (args) { return t.run(args || {}); };
  });
  surface.call = function (name, args) {
    var t = TOOLS.filter(function (x) { return x.name === name; })[0];
    if (!t) throw new Error('unknown tool ' + name);
    return t.run(args || {});
  };
  G.chiptunes = surface;

  // ---- WEBMCP REGISTRATION -------------------------------------------
  //
  // ⚠️ THE SPEC SURFACE IS `document.modelContext`, NOT `navigator`. This code
  // looked only at `navigator.modelContext`, which meant that in the browsers
  // that actually implement WebMCP -- the ChatGPT desktop app's in-app browser,
  // and Chrome with chrome://flags/#enable-webmcp-testing -- not one of these
  // tools was ever registered. Everything worked in testing, because testing
  // was a shim on `navigator`. Both are tried now, `document` first.
  //
  // It is also polled briefly, because the agent browser can inject the API
  // AFTER the page's scripts run, and a one-shot check at load time loses that
  // race silently: the page looks fine and simply has no tools.
  function describeTool(t) {
    return {
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      // The spec passes the arguments straight in and expects MCP content back.
      // Errors are RETURNED rather than thrown: a tool that throws reads to the
      // agent as a broken page, while a returned error is something it can tell
      // the user about.
      execute: function (args) {
        var out;
        try { out = t.run(args || {}); }
        catch (e) { out = { ok: false, error: e && e.message ? e.message : String(e) }; }
        return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] };
      }
    };
  }

  function register() {
    if (surface.webmcp) return true;                       // already done
    var mc = (typeof document !== 'undefined' && document.modelContext) ||
             (G.navigator && G.navigator.modelContext) || null;
    if (!mc) return false;
    var where = (typeof document !== 'undefined' && document.modelContext) ? 'document' : 'navigator';
    try {
      if (has(mc.registerTool)) {
        TOOLS.forEach(function (t) { mc.registerTool(describeTool(t)); });
        surface.webmcp = where + '.modelContext.registerTool';
      } else if (has(mc.provideContext)) {
        mc.provideContext({ tools: TOOLS.map(describeTool) });
        surface.webmcp = where + '.modelContext.provideContext';
      } else return false;
      surface.registered = TOOLS.length;
      return true;
    } catch (e) { surface.webmcpError = String(e && e.message || e); return false; }
  }

  surface.webmcp = null;
  surface.register = register;          // so a page or a test can force it
  if (!register()) {
    // ~10s of polling, then stop. Cheap, bounded, and it never touches the page.
    var tries = 0;
    var timer = setInterval(function () {
      if (register() || ++tries > 40) clearInterval(timer);
    }, 250);
    if (typeof G.addEventListener === 'function')
      G.addEventListener('load', function () { register(); }, { once: true });
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
