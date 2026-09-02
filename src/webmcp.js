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
//   * navigator.modelContext (WebMCP) — registered when the browser has it, so
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

  // WebMCP, when the browser has it. Registration shapes are still moving, so
  // try the two that exist and never let a failure here touch the page.
  try {
    var mc = G.navigator && G.navigator.modelContext;
    if (mc) {
      if (has(mc.registerTool)) {
        TOOLS.forEach(function (t) {
          mc.registerTool({
            name: t.name, description: t.description, inputSchema: t.inputSchema,
            async execute(args) {
              return { content: [{ type: 'text', text: JSON.stringify(t.run(args || {}), null, 2) }] };
            }
          });
        });
        surface.webmcp = 'registerTool';
      } else if (has(mc.provideContext)) {
        mc.provideContext({
          tools: TOOLS.map(function (t) {
            return {
              name: t.name, description: t.description, inputSchema: t.inputSchema,
              async execute(args) {
                return { content: [{ type: 'text', text: JSON.stringify(t.run(args || {}), null, 2) }] };
              }
            };
          })
        });
        surface.webmcp = 'provideContext';
      }
    } else surface.webmcp = null;
  } catch (e) { surface.webmcp = null; }
})(typeof globalThis !== 'undefined' ? globalThis : window);
