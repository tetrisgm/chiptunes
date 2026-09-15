// THE /webmcp PATH: the same app, with the WebMCP story on top of it.
//
// Deliberately NOT a separate static page. Two reasons, and the first is not
// negotiable:
//
//   * An agent arriving at /webmcp reads the TOP document's modelContext. A
//     standalone explainer page that framed the real app in an iframe would
//     register its tools inside the frame, where no agent would ever find them.
//     This route is the whole app, so registration happens exactly where it is
//     looked for, and what a judge tests is what everybody else uses.
//   * The panel is a passenger. Close it and the station is playing underneath,
//     because it always was -- so every tool call made from here moves the same
//     session the visitor is already watching, which is the thing worth showing.
//
// It also has to work for somebody WITHOUT a WebMCP browser, which is most
// people and possibly a judge in a hurry. Every tool is callable from the panel
// itself through window.chiptunes -- the same implementation the agent reaches
// -- so the capability can be seen working before anybody installs anything.
(function (G) {
  'use strict';
  if (typeof document === 'undefined') return;

  function onDemoRoute() {
    try {
      return /^\/webmcp\/?$/.test(location.pathname) || /(^|[#&?])webmcp\b/.test(location.hash + location.search);
    } catch (e) { return false; }
  }
  if (!onDemoRoute()) return;

  // NORMALISE THE ROUTE BEFORE THE APP BOOTS. runtime.js decides what to show
  // from location.pathname, and /webmcp is not a path it knows, so the station
  // never entered its landing state -- in agent mode, where this panel demotes
  // to a bar, that left a person staring at an empty page.
  //
  // Rewriting to '/#webmcp' gives the app the root route it understands while
  // keeping the demo addressable: the hash still matches onDemoRoute() above,
  // so a reload comes back here. This runs at bundle execution, which is before
  // runtime.js in the concatenation order -- doing it at mount would be too
  // late, since the app has booted by then.
  try {
    if (/^\/webmcp\/?$/.test(location.pathname) && history && history.replaceState)
      history.replaceState(null, '', '/#webmcp');
  } catch (e) {}

  var CSS = [
    '#wmcp{position:fixed;inset:0;z-index:2147483000;overflow:auto;background:rgba(6,5,12,.965);',
    'color:#f7f5ef;font:600 15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;',
    '-webkit-overflow-scrolling:touch;overscroll-behavior:contain}',
    '#wmcp .wrap{width:min(940px,100%);margin:0 auto;padding:clamp(18px,4vw,44px) clamp(16px,4vw,32px) 80px}',
    '#wmcp h1{font-size:clamp(28px,5vw,46px);line-height:1.03;margin:.15em 0 .2em;letter-spacing:-.01em}',
    '#wmcp h2{font-size:15px;text-transform:uppercase;letter-spacing:.14em;color:#b7e34c;margin:34px 0 12px}',
    '#wmcp p{color:#c4bfd2;margin:0 0 14px}#wmcp p.lead{font-size:clamp(17px,2.2vw,21px);color:#ded9ea}',
    '#wmcp a{color:#8edbff}#wmcp code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.92em;',
    'background:#191727;border:1px solid #302a43;border-radius:6px;padding:1px 5px;color:#e6e1f2}',
    '#wmcp .eyebrow{color:#b7e34c;text-transform:uppercase;letter-spacing:.16em;font-size:12px;margin:0}',
    '#wmcp .status{display:flex;gap:12px;align-items:flex-start;border:1px solid #302a43;border-radius:14px;',
    'padding:14px 16px;background:#11101b;margin:0 0 8px}',
    '#wmcp .status.on{border-color:#4d7a12;background:#131c0c}#wmcp .status.off{border-color:#6b5a24;background:#1b1710}',
    '#wmcp .dot{width:11px;height:11px;border-radius:50%;margin-top:7px;flex:0 0 auto;background:#8b8397}',
    '#wmcp .status.on .dot{background:#9bbc0f;box-shadow:0 0 12px #9bbc0f}',
    '#wmcp .status.off .dot{background:#e0a83a;box-shadow:0 0 12px #e0a83a88}',
    '#wmcp .status b{display:block;font-size:16px;color:#fff}#wmcp .status span{color:#b9b4c7;font-size:14px}',
    '#wmcp .grid{display:grid;gap:10px;grid-template-columns:repeat(auto-fill,minmax(250px,1fr))}',
    '#wmcp .card{border:1px solid #302a43;border-radius:12px;background:#11101b;padding:12px 14px}',
    '#wmcp .card b{color:#a8dcff;font-family:ui-monospace,Menlo,monospace;font-size:13px;display:block;margin-bottom:4px}',
    '#wmcp .card span{color:#b9b4c7;font-size:13px;font-weight:500;line-height:1.42}',
    '#wmcp .try{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 12px}',
    '#wmcp button.b{border:1px solid #696178;border-radius:999px;background:linear-gradient(#e8e5d8,#b9b6a8);',
    'color:#20251b;padding:9px 16px;font:750 14px/1 system-ui,sans-serif;cursor:pointer;box-shadow:inset 0 2px #fff8,0 3px 0 #68665f}',
    '#wmcp button.b:active{transform:translateY(2px);box-shadow:inset 0 2px #fff4,0 1px 0 #68665f}',
    '#wmcp button.b.p{background:linear-gradient(#c03678,#8d174f);color:#fff;border-color:#df5594;box-shadow:inset 0 2px #fff3,0 3px 0 #4d102f}',
    '#wmcp button.b[disabled]{opacity:.55;cursor:progress}',
    '#wmcp input.t{flex:1 1 320px;min-width:0;border:1px solid #3b3450;border-radius:999px;background:#0b0a14;',
    'color:#f7f5ef;padding:10px 16px;font:600 14px system-ui,sans-serif}',
    '#wmcp pre{white-space:pre-wrap;word-break:break-word;background:#0b0a14;border:1px solid #302a43;',
    'border-radius:12px;padding:14px;max-height:340px;overflow:auto;color:#cfe8b0;font:500 12.5px/1.5 ui-monospace,Menlo,monospace;margin:0}',
    '#wmcp ol{color:#c4bfd2;padding-left:20px;margin:0 0 14px}#wmcp ol li{margin:0 0 7px}',
    '#wmcp .prompts{display:grid;gap:8px;margin:0 0 6px}',
    '#wmcp .prompt{display:flex;gap:10px;align-items:center;border:1px solid #302a43;border-radius:10px;',
    'background:#11101b;padding:10px 12px;cursor:pointer;text-align:left;color:#ded9ea;font:600 14px/1.4 system-ui,sans-serif}',
    '#wmcp .prompt:hover{border-color:#5a5177;background:#171525}#wmcp .prompt .c{color:#8b8397;font-size:12px;flex:0 0 auto}',
    '#wmcp .foot{display:flex;flex-wrap:wrap;gap:14px;margin-top:34px;padding-top:20px;border-top:1px solid #302a43;',
    'color:#8b8397;font-size:13px}',
    '#wmcp .x{position:sticky;top:0;float:right;margin:0 0 -10px;border:1px solid #3b3450;background:#11101b;color:#f7f5ef;',
    'border-radius:999px;padding:8px 16px;font:700 13px system-ui,sans-serif;cursor:pointer;z-index:3}',
    // AGENT MODE. When something is already driving the page, the explainer is
    // in the way: the agent has its own chat, and the person wants to see and
    // hear the instrument. The overlay demotes to a bar and stops swallowing
    // clicks -- pointer-events:none on the root, auto on the bar itself.
    '#wmcp.mini{background:transparent;overflow:visible;pointer-events:none;inset:0 0 auto 0;',
    // flex, so the bar shrinks to its own content instead of stretching the
    // full width as a block-level child would
    'display:flex;justify-content:flex-end;align-items:flex-start}',
    '#wmcp.mini .wrap{display:none}',
    '#wmcp .bar{display:none}',
    // Tucked to the corner, not across the top: centred, it sat straight over
    // the Game Boy's title, and the point of demoting the panel was to let the
    // instrument be seen.
    '#wmcp.mini .bar{display:flex;pointer-events:auto;gap:10px;align-items:center;',
    'width:auto;max-width:calc(100% - 24px);margin:12px 12px 0 auto;padding:8px 12px;border:1px solid #4d7a12;',
    'border-radius:999px;background:#131c0cf2;backdrop-filter:blur(6px);box-shadow:0 8px 30px #000a}',
    '#wmcp.mini .bar b{color:#fff;font-size:13px}#wmcp.mini .bar span{color:#b9b4c7;font-size:12px}',
    '@media(max-width:700px){#wmcp.mini .bar span{display:none}}',
    '#wmcp.mini .bar button{margin-left:6px;border:1px solid #3b3450;background:#11101b;color:#f7f5ef;',
    'border-radius:999px;padding:6px 12px;font:700 12px system-ui,sans-serif;cursor:pointer;white-space:nowrap}',
    '@media(max-width:640px){#wmcp .try{gap:6px}#wmcp input.t{flex-basis:100%}}'
  ].join('');

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function has(fn) { return typeof fn === 'function'; }
  function api() { return G.chiptunes || null; }

  var PROMPTS = [
    'What can this page do? List your tools.',
    'Write me a dungeon theme like Castlevania, 40 seconds, no drums.',
    'Is that actually in a minor key? How busy is it?',
    'Give me a dozen boss themes to choose from, then play the third one.',
    'Make it gloomier, then hand me the cartridge.'
  ];

  function mount() {
    if (document.getElementById('wmcp')) return;
    var style = el('style'); style.textContent = CSS; document.head.appendChild(style);

    var root = el('div'); root.id = 'wmcp';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Chiptunes for WebMCP');
    var wrap = el('div', 'wrap'); root.appendChild(wrap);

    // The demoted form, always built, shown only in agent mode.
    var bar = el('div', 'bar');
    var barTxt = el('div');
    var barB = el('b', null, '\uD83E\uDD16 Agent driving');
    var barS = el('span');
    barTxt.appendChild(barB); barTxt.appendChild(document.createTextNode(' ')); barTxt.appendChild(barS);
    var barBtn = el('button', null, 'Explain');
    bar.appendChild(barTxt); bar.appendChild(barBtn);
    root.appendChild(bar);

    // SET ONCE. If the person has asked for the explainer, a host appearing
    // later must not snatch it away again.
    var humanOpened = false, demoted = false;
    barBtn.addEventListener('click', function () {
      humanOpened = true; root.classList.remove('mini');
    });
    function considerDemoting() {
      var s = api();
      if (demoted || humanOpened || !(s && s.webmcp)) return;
      demoted = true;
      barS.textContent = (s.registered || (s.tools || []).length) + ' tools ready';
      root.classList.add('mini');
    }

    var close = el('button', 'x', 'Close and just listen');
    close.addEventListener('click', function () {
      root.remove();
      // drop the #webmcp too, or a reload reopens what was just closed
      try { history.replaceState(null, '', '/'); } catch (e) {}
    });
    wrap.appendChild(close);

    wrap.appendChild(el('p', 'eyebrow', 'WebMCP demo'));
    var h1 = el('h1'); h1.textContent = 'A Game Boy studio your agent can drive.';
    wrap.appendChild(h1);
    wrap.appendChild(el('p', 'lead',
      'The composer and a register-level Game Boy sound chip are already running in this page. ' +
      'That means an agent can write music here with no API key, no account and nothing metered — ' +
      'and a song takes 1.6 ms, so it can afford to write twenty and let you pick.'));
    wrap.appendChild(el('p', null,
      'The station is playing behind this panel. Close it at any time; every tool below moves that same ' +
      'session, so you and the agent are never looking at different things.'));

    // ---- status ------------------------------------------------------
    var status = el('div', 'status');
    status.appendChild(el('div', 'dot'));
    var stxt = el('div');
    var sb = el('b'), ss = el('span');
    stxt.appendChild(sb); stxt.appendChild(ss);
    status.appendChild(stxt);
    wrap.appendChild(status);
    var help = el('div');
    wrap.appendChild(help);

    // THE DIAGNOSTIC LINE. Without it, "my agent cannot see the tools" has two
    // completely different causes that look identical from the outside: the page
    // failed to register, or the page registered fine and the AI client is not
    // handing page-defined tools to its model. Printing what was found separates
    // them in one glance, and it is the first thing anybody debugging this asks.
    var probe = el('pre');
    probe.style.cssText = 'margin:8px 0 0;max-height:none;font-size:12px';
    var probeWrap = el('div');
    var toggle = el('button', 'b', 'What did this page detect?');
    toggle.style.cssText = 'margin:8px 0 0';
    var shown = false;
    toggle.addEventListener('click', function () {
      shown = !shown;
      probe.style.display = shown ? 'block' : 'none';
      toggle.textContent = shown ? 'Hide detection details' : 'What did this page detect?';
      if (shown) paintProbe();
    });
    probe.style.display = 'none';
    var recheck = el('button', 'b', 'Re-check');
    recheck.style.cssText = 'margin:8px 0 0 8px';
    recheck.addEventListener('click', function () {
      var s = api();
      if (s && has(s.register)) s.register();
      paint(); paintProbe();
    });
    probeWrap.appendChild(toggle); probeWrap.appendChild(recheck); probeWrap.appendChild(probe);

    function paintProbe() {
      var s = api();
      if (!s || !has(s.probe)) { probe.textContent = 'the page is still loading'; return; }
      try { probe.textContent = JSON.stringify(s.probe(), null, 2); }
      catch (e) { probe.textContent = String(e); }
    }

    function paint() {
      var s = api(), where = s && s.webmcp;
      if (where) {
        status.className = 'status on';
        sb.textContent = 'WebMCP is live in this browser.';
        ss.textContent = (s.registered || (s.tools || []).length) + ' tools registered on ' + where +
                         '. If your agent still says it has no tools, the page has done its part: ' +
                         'the AI client is not passing page-defined tools to its model.';
        help.innerHTML = '';
      } else {
        status.className = 'status off';
        sb.textContent = 'No WebMCP in this browser — the tools still work here.';
        ss.textContent = 'Everything in "Try it right now" below calls the same implementation an agent gets, ' +
                         'so you can see it work before installing anything.';
        if (!help.childNodes.length) {
          help.appendChild(el('h2', null, 'To drive it with an agent'));
          var ol = el('ol');
          var a = el('li');
          a.textContent = 'Open this page in the ChatGPT desktop app’s in-app browser, which supports WebMCP by default; or';
          var b = el('li');
          b.innerHTML = 'use Google Chrome 149 or later, enable <code>chrome://flags/#enable-webmcp-testing</code>, ' +
                        'restart the browser, and come back.';
          ol.appendChild(a); ol.appendChild(b);
          help.appendChild(ol);
        }
      }
    }
    wrap.appendChild(probeWrap);
    paint();
    considerDemoting();
    // registration can arrive after load: the agent browser injects the API on
    // its own schedule, and a panel that said "not supported" for the whole
    // session would be lying about a page that had in fact registered.
    var polls = 0, timer = setInterval(function () { paint(); considerDemoting(); if (shown) paintProbe(); if (++polls > 240) clearInterval(timer); }, 500);

    // ---- prompts -----------------------------------------------------
    wrap.appendChild(el('h2', null, 'Ask your agent'));
    var pl = el('div', 'prompts');
    PROMPTS.forEach(function (t) {
      var b = el('button', 'prompt');
      b.appendChild(el('span', null, t));
      var c = el('span', 'c', 'copy');
      b.appendChild(c);
      b.addEventListener('click', function () {
        try {
          navigator.clipboard.writeText(t);
          c.textContent = 'copied';
          setTimeout(function () { c.textContent = 'copy'; }, 1400);
        } catch (e) { c.textContent = 'select it'; }
      });
      pl.appendChild(b);
    });
    wrap.appendChild(pl);

    // ---- try it ------------------------------------------------------
    wrap.appendChild(el('h2', null, 'Try it right now, agent or not'));
    wrap.appendChild(el('p', null,
      'These buttons call the tools directly. Listen to the station behind the panel as they run.'));

    var out = el('pre', 'out', 'Results appear here.');   // named, so a test can find THIS one
    var field = el('input', 't');
    field.type = 'text';
    field.value = 'a dungeon theme like Castlevania, 40 seconds, no drums';
    field.setAttribute('aria-label', 'Describe the music you want');

    function show(label, value, ms) {
      var head = label + (ms != null ? '  (' + ms + ' ms)' : '') + '\n';
      var body;
      try { body = JSON.stringify(value, null, 2); } catch (e) { body = String(value); }
      if (body && body.length > 4000) body = body.slice(0, 4000) + '\n… (truncated)';
      out.textContent = head + body;
      out.scrollTop = 0;
    }
    function run(btn, label, name, args) {
      var s = api();
      if (!s || !has(s.call)) { show(label, { error: 'the page is still loading' }); return; }
      btn.disabled = true;
      // a frame, so the disabled state paints before a synchronous compose
      requestAnimationFrame(function () { setTimeout(function () {
        var t0 = Date.now(), r;
        try { r = s.call(name, args || {}); }
        catch (e) { r = { error: e && e.message ? e.message : String(e) }; }
        show(label, r, Date.now() - t0);
        btn.disabled = false;
      }, 0); });
    }

    var row1 = el('div', 'try');
    var askBtn = el('button', 'b p', 'chiptunes_ask');
    askBtn.addEventListener('click', function () {
      run(askBtn, 'chiptunes_ask', 'chiptunes_ask', { text: field.value });
    });
    field.addEventListener('keydown', function (ev) {
      ev.stopPropagation();                       // the app's shortcuts must not eat typing
      if (ev.key === 'Enter') { ev.preventDefault(); askBtn.click(); }
    });
    row1.appendChild(field); row1.appendChild(askBtn);
    wrap.appendChild(row1);

    var row2 = el('div', 'try');
    [
      ['chiptunes_capabilities', 'chiptunes_capabilities', {}],
      ['chiptunes_analyse', 'chiptunes_analyse', {}],
      ['12 songs in one call', 'chiptunes_variations', { scene: 'boss', seconds: 30, n: 12 }],
      ['make it gloomier', 'chiptunes_variant', { mood: 'darker' }],
      ['share link', 'chiptunes_export', { format: 'link' }],
      ['.gb cartridge', 'chiptunes_export', { format: 'rom' }],
      ['MIDI file', 'chiptunes_export', { format: 'midi' }],
      ['now playing', 'chiptunes_now_playing', {}]
    ].forEach(function (spec) {
      var b = el('button', 'b', spec[0]);
      b.addEventListener('click', function () { run(b, spec[1], spec[1], spec[2]); });
      row2.appendChild(b);
    });
    wrap.appendChild(row2);
    wrap.appendChild(out);

    // ---- the tool list, read from the live surface --------------------
    wrap.appendChild(el('h2', null, 'The tools'));
    var grid = el('div', 'grid');
    wrap.appendChild(grid);
    function paintTools() {
      var s = api();
      if (!s || !s.tools || grid.childNodes.length) return;
      s.tools.forEach(function (t) {
        var c = el('div', 'card');
        c.appendChild(el('b', null, t.name));
        c.appendChild(el('span', null, t.description));
        grid.appendChild(c);
      });
    }
    paintTools();
    var t2 = 0, tt = setInterval(function () { paintTools(); if (grid.childNodes.length || ++t2 > 40) clearInterval(tt); }, 250);

    var foot = el('div', 'foot');
    [['The station', '/'], ['Source (MIT)', 'https://github.com/VaporWorks/chiptunes'],
     ['How it was built', '/docs/WEBMCP.md']].forEach(function (l) {
      var a = el('a', null, l[0]); a.href = l[1]; foot.appendChild(a);
    });
    foot.appendChild(el('span', null, 'Composed in your browser. Nothing uploaded, nothing metered.'));
    wrap.appendChild(foot);

    document.body.appendChild(root);
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', function () { setTimeout(mount, 400); });
  else setTimeout(mount, 400);
})(typeof globalThis !== 'undefined' ? globalThis : window);
