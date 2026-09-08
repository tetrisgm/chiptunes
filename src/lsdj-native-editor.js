// THE USER-FACING NATIVE LSDj STRUCTURE EDITOR.
//
// Reached from Create ("Open LSDj" for a local .lsdsng/.sav, "Open native JSON"
// for a standalone structure share, "Resume LSDj edit" to reopen an in-progress
// edit). A NativeDocument is the SOLE authority; the flattened Create score is
// never read or re-exported here. Every mapped native field is reachable --
// sequence, chains, phrases, instrument params, instrument names, all five
// table columns, grooves, waves, the allocation maps, and the scalar tempo /
// transpose / (read-only) format version -- edited as raw hex bytes. Nothing
// decodes or auto-allocates unproven bits.
//
// NOT A PLAYER. It runs no audio engine and says so. Entering it stops Create's
// playback. It is MODAL: the background is inert and Tab is trapped inside the
// panel (visible controls only), so focus cannot reach hidden Create controls;
// Escape closes only this panel (via runtime), with no implicit play; focus is
// restored on close.
//
// EDITS ARE ATOMIC PER ROW AND NEVER SILENTLY LOST. Typed cells are held in a
// persistent DRAFT map keyed by native (field/slot/row), independent of DOM
// re-renders. "Apply" (or Enter) commits ONE row through setBytes() as one undo
// entry and clears only that row's drafts; every other staged row survives.
// Navigating slots/categories, undo/redo, and closing all preserve drafts
// (invalid ones included) -- they clear only on explicit "Revert pending" or by
// being applied. Exports flush ALL pending drafts first (blocking on invalid).
// A closed edit is retained; "Resume" reopens it without re-importing.
//
// Import uses the shared strict foreign-file parser; native JSON goes through
// the document's strict deserializer. Replacement requires confirmation when
// edits exist, and leaving the page warns about unsaved session work. A
// a request-start generation token means the last-requested import wins and a
// slow earlier read cannot clobber it. Closing invalidates in-flight reads.
//
// Export: .lsdsng from document.toSong() through the real compressor, REUSING
// the original 8-byte name + version bytes when a .lsdsng was opened. .sav only
// when a .sav was opened, replacing its first 32768 bytes and keeping the rest.
// The uploaded file is never overwritten. Native sharing is a standalone
// serializeFull() JSON (structure only) -- a file to reopen here, not a link.
(function (G) {
  'use strict';

  var SONG = 0x8000;

  var panel = null, fileInput = null, jsonInput = null;
  var state = null;                 // { doc, savBytes, header, title, draft, dirty }
  var curCat = 0, curSlot = 0;
  var importGen = 0;
  var lastFocus = null, inerted = [];
  var SHAPE = null;

  function LS() { return G.CT_LSDJ; }
  function DOC() { return G.CT_LSDJ_DOC; }
  function shape() {
    if (!SHAPE && LS()) {
      SHAPE = {};
      LS().FIELDS.forEach(function (f) { SHAPE[f.k] = { scalar: f.n === 1 && f.w === 1, singleRow: f.n === 1 && f.w > 1 }; });
    }
    return SHAPE;
  }
  function hex2(v) { return ('0' + (v & 0xFF).toString(16).toUpperCase()).slice(-2); }
  function parseHexByte(s) { if (!/^[0-9a-fA-F]{1,2}$/.test(s)) return null; var v = parseInt(s, 16); return (v >= 0 && v <= 255) ? v : null; }
  function attr(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function hasEdits() { return !!state && (Object.keys(state.draft).length > 0 || state.doc.diff().runs.length > 0); }
  function confirmReplacement() {
    return !hasEdits() || G.confirm('Replace the current native edit, including pending changes? Export it first if you want to keep it. Cancel keeps your work.');
  }
  G.addEventListener('beforeunload', function (ev) {
    if (hasEdits()) { ev.preventDefault(); ev.returnValue = ''; }
  });
  function safeName(t) { return (String(t || 'lsdj').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'lsdj').slice(0, 24); }
  function projName(t) {
    var s = String(t || 'CHIPTUNE').toUpperCase().replace(/[^A-Z0-9 -]/g, '').trim(); if (!s) s = 'CHIPTUNE';
    var out = new Uint8Array(8); for (var i = 0; i < 8; i++) out[i] = i < s.length ? s.charCodeAt(i) : 0; return out;
  }


  // ---- categories ---------------------------------------------------------
  function mrow(label, key) { return { l: label, at: function (s, r) { return { key: key, i: s, j: r }; } }; }
  function seqCol(label, ch) { return { l: label, at: function (s) { return { key: 'sequence', i: s, j: ch }; } }; }
  var ALLOC = ['instrumentAlloc', 'tableAlloc', 'phraseAlloc', 'chainAlloc'];
  var SONGF = ['tempo', 'transpose', 'formatVersion'];
  var CATS = [
    { id: 'sequence', label: 'Sequence', unit: 'row', slots: 256, rows: 1, rowLabel: '',
      cols: [ seqCol('PU1', 0), seqCol('PU2', 1), seqCol('WAV', 2), seqCol('NOI', 3) ] },
    { id: 'chains', label: 'Chains', unit: 'chain', slots: 128, rows: 16, rowLabel: 'Row',
      cols: [ mrow('Phrase', 'chainPhrases'), mrow('Transpose', 'chainTranspose') ] },
    { id: 'phrases', label: 'Phrases', unit: 'phrase', slots: 255, rows: 16, rowLabel: 'Step',
      cols: [ mrow('Note', 'phraseNotes'), mrow('Inst', 'phraseInstruments'), mrow('Cmd', 'phraseCommands'), mrow('Val', 'phraseCommandVals') ] },
    { id: 'instruments', label: 'Instruments', unit: 'instrument', slots: 64, rows: 16, rowLabel: 'Byte',
      cols: [ mrow('Param', 'instrumentParams') ] },
    { id: 'instrnames', label: 'Instr names', unit: 'instrument', slots: 64, rows: 5, rowLabel: 'Char',
      cols: [ mrow('Byte', 'instrumentNames') ] },
    { id: 'tables', label: 'Tables', unit: 'table', slots: 32, rows: 16, rowLabel: 'Row',
      cols: [ mrow('tables0', 'tables0'), mrow('tables1', 'tables1'), mrow('tables2', 'tables2'), mrow('cmd', 'tableCommands'), mrow('val', 'tableValues') ] },
    { id: 'groove', label: 'Groove', unit: 'groove', slots: 32, rows: 16, rowLabel: 'Step',
      cols: [ mrow('Ticks', 'grooves') ] },
    { id: 'waves', label: 'Waves', unit: 'wave', slots: 256, rows: 16, rowLabel: 'Byte',
      cols: [ mrow('Sample', 'waves') ] },
    { id: 'alloc', label: 'Alloc', unit: 'map', slots: 4, rowLabel: 'Byte',
      slotName: function (s) { return ALLOC[s]; }, rowsFor: function (s) { return [64, 32, 32, 16][s]; },
      cols: [ { l: 'Value', at: function (s, r) { return { key: ALLOC[s], i: 0, j: r }; } } ] },
    { id: 'song', label: 'Song', unit: '', slots: 1, rows: 3, rowLabel: 'Field',
      rowName: function (r) { return SONGF[r]; },
      cols: [ { l: 'Value', readonlyFor: function (r) { return r === 2; }, at: function (s, r) { return { key: SONGF[r], i: 0, j: 0 }; } } ] }
  ];
  function rowsOf(cat, slot) { return cat.rowsFor ? cat.rowsFor(slot) : cat.rows; }
  function readByte(a) {
    var f = shape()[a.key];
    if (f.scalar) return state.doc.field(a.key);
    if (f.singleRow) return state.doc.field(a.key)[a.j];
    return state.doc.fieldRow(a.key, a.i)[a.j];
  }
  function committedHex(a) { return hex2(readByte(a)); }
  function draftKey(a) { return a.key + '/' + a.i + '/' + a.j; }
  function addrOf(inp) { return CATS[curCat].cols[+inp.dataset.col].at(curSlot, +inp.dataset.row); }
  function cellValue(a) {
    var dk = draftKey(a), c = committedHex(a);
    if (state.draft[dk] != null) {
      return state.draft[dk];
    }
    return c;
  }

  function status(m) { var s = panel && panel.querySelector('.ne-status'); if (s) s.textContent = m; }
  function toast(m) { if (G._toast) G._toast(m); status(m); }
  function saveBytes(bytes, name, type) {
    try {
      var blob = new Blob([bytes], { type: type || 'application/octet-stream' });
      if (G._saveBlob) { G._saveBlob(blob, name); return true; }
      var url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000); return true;
    } catch (e) { return false; }
  }

  // ---- inputs -------------------------------------------------------------
  function ensureInputs() {
    if (!fileInput) {
      fileInput = document.createElement('input'); fileInput.type = 'file'; fileInput.accept = '.lsdsng,.sav';
      fileInput.style.display = 'none'; fileInput.setAttribute('aria-hidden', 'true');
      fileInput.addEventListener('change', function () { var f = fileInput.files && fileInput.files[0]; fileInput.value = ''; if (f) openFromFile(f); });
      document.body.appendChild(fileInput);
    }
    if (!jsonInput) {
      jsonInput = document.createElement('input'); jsonInput.type = 'file'; jsonInput.accept = '.json,application/json';
      jsonInput.style.display = 'none'; jsonInput.setAttribute('aria-hidden', 'true');
      jsonInput.addEventListener('change', function () { var f = jsonInput.files && jsonInput.files[0]; jsonInput.value = ''; if (f) importJsonFile(f); });
      document.body.appendChild(jsonInput);
    }
  }
  function pick() { ensureInputs(); fileInput.click(); }
  function pickJson() { ensureInputs(); jsonInput.click(); }

  // ---- imports (token bumps at request START; last request wins) ----------
  function openFromFile(f) {
    var gen = ++importGen;                               // supersede any earlier pending read, even if this proves invalid
    var lower = String(f.name || '').toLowerCase();
    var isSav = /\.sav$/.test(lower), isSng = /\.lsdsng$/.test(lower);
    if (!isSav && !isSng) { toast('Choose a .lsdsng or .sav file'); return; }
    if (isSav && f.size !== 0x20000) { toast('A .sav must be exactly 128 KB'); return; }
    if (isSng && (f.size < 10 || f.size > 200000)) { toast('That .lsdsng is not a valid size'); return; }
    if (!DOC()) { toast('LSDj support is unavailable in this build'); return; }
    var rd = new FileReader();
    rd.onerror = function () { if (gen === importGen) toast('Could not read that file'); };
    rd.onload = function () {
      if (gen !== importGen) return;                     // superseded or cancelled by close
      try {
        var bytes = new Uint8Array(rd.result), song, sav = null, header = null, name = 'CHIPTUNE';
        if (isSav) { song = Uint8Array.from(bytes.subarray(0, SONG)); sav = Uint8Array.from(bytes); name = 'WORKMEM'; }
        else { var parsed = LS().parseLsdsng(bytes); song = parsed.song; name = parsed.name || 'CHIPTUNE'; header = { name: Uint8Array.from(bytes.subarray(0, 8)), version: bytes[8] & 0xFF }; }
        open({ doc: DOC().NativeDocument.fromSong(song, { title: name }), savBytes: sav, header: header, name: name });
      } catch (e) { toast('That file is not a valid LSDj song'); }   // current document untouched
    };
    rd.readAsArrayBuffer(f);
  }
  function importJsonFile(f) {
    var gen = ++importGen;
    if (!f) return;
    if (f.size > 400000) { toast('That native JSON is too large'); return; }
    if (!DOC()) { toast('LSDj support is unavailable in this build'); return; }
    var rd = new FileReader();
    rd.onerror = function () { if (gen === importGen) toast('Could not read that file'); };
    rd.onload = function () {
      if (gen !== importGen) return;
      try {
        var d = DOC().NativeDocument.deserialize(String(rd.result));
        if (open({ doc: d, savBytes: null, header: null, name: d.title() || 'CHIPTUNE' }))
          status('Opened native structure from JSON (structure only, no playback)');
      } catch (e) { toast('That native JSON is not valid'); }
    };
    rd.readAsText(f);
  }

  // ---- modal focus --------------------------------------------------------
  function setBackgroundInert(on) {
    if (on) {
      inerted = []; var kids = document.body.children;
      for (var i = 0; i < kids.length; i++) {
        var el = kids[i]; if (el === panel || el === fileInput || el === jsonInput) continue;
        if (!el.hasAttribute('inert')) { try { el.setAttribute('inert', ''); inerted.push(el); } catch (e) {} }
      }
    } else { inerted.forEach(function (el) { try { el.removeAttribute('inert'); } catch (e) {} }); inerted = []; }
  }
  function focusables() {
    return [].slice.call(panel.querySelectorAll('button:not([disabled]), input:not([disabled]), [tabindex="0"]'))
      .filter(function (el) { return el.getClientRects().length > 0; });      // visible only (skip hidden Save .sav)
  }
  function trapTab(ev) {
    var f = focusables(); if (!f.length) return;
    var first = f[0], last = f[f.length - 1], a = document.activeElement;
    if (ev.shiftKey && (a === first || !panel.contains(a))) { last.focus(); ev.preventDefault(); }
    else if (!ev.shiftKey && (a === last || !panel.contains(a))) { first.focus(); ev.preventDefault(); }
  }

  // ---- panel --------------------------------------------------------------
  function buildPanel() {
    if (panel) return;
    panel = document.createElement('div');
    panel.id = 'nativeeditor';
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'LSDj native structure editor');
    panel.innerHTML =
      '<div class="ne-top"><div class="ne-title"><b>LSDj</b> <span class="ne-name"></span></div>' +
        '<button type="button" class="ne-close" aria-label="Close native editor" title="Close">\u2715</button></div>' +
      '<p class="ne-banner" role="note">Structural editor \u2014 native playback is <b>not implemented</b>. ' +
        'Edits change raw bytes only; nothing here plays, and no sound approximation is claimed.</p>' +
      '<div class="ne-cats" role="tablist" aria-label="Native field category"></div>' +
      '<div class="ne-bar">' +
        '<label class="ne-slotlab">Slot <input class="ne-slot" type="number" min="0" step="1" value="0" inputmode="numeric" aria-label="Slot index"></label>' +
        '<span class="ne-slothex"></span><span class="ne-sp"></span>' +
        '<button type="button" class="ne-btn ne-undo">\u21A9 Undo</button>' +
        '<button type="button" class="ne-btn ne-redo">\u21AA Redo</button>' +
        '<button type="button" class="ne-btn ne-discard" title="Discard all uncommitted edits">Revert pending</button>' +
        '<span class="ne-sp"></span>' +
        '<button type="button" class="ne-btn ne-exp-sng">Save .lsdsng</button>' +
        '<button type="button" class="ne-btn ne-exp-sav">Save .sav</button>' +
        '<button type="button" class="ne-btn ne-exp-json" title="Structure only \u2014 a file to reopen here, not a playable link">Save native JSON</button>' +
        '<button type="button" class="ne-btn ne-imp-json">Open native JSON</button>' +
      '</div>' +
      '<div class="ne-grid" role="region" aria-label="Native byte grid"></div>' +
      '<p class="ne-status" role="status" aria-live="polite"></p>';
    document.body.appendChild(panel);
    wire();
  }
  function renderTabs() {
    panel.querySelector('.ne-cats').innerHTML = CATS.map(function (c, i) {
      return '<button type="button" class="ne-cat' + (i === curCat ? ' on' : '') + '" role="tab" aria-selected="' + (i === curCat) + '" data-cat="' + i + '">' + c.label + '</button>';
    }).join('');
  }
  function renderSlotMax() {
    var cat = CATS[curCat], si = panel.querySelector('.ne-slot');
    si.max = cat.slots - 1; si.value = curSlot;
    var nm = cat.slotName ? cat.slotName(curSlot) : (cat.unit ? cat.unit + ' ' + curSlot : 'song');
    panel.querySelector('.ne-slothex').textContent = nm + '  (' + cat.slots + ' total, hex ' + hex2(curSlot) + ')';
  }
  function renderExports() { var sav = panel.querySelector('.ne-exp-sav'); if (sav) sav.style.display = (state && state.savBytes) ? '' : 'none'; }
  function renderGrid() {
    var active = document.activeElement, focusRow = null, focusCol = null;
    if (active && panel.contains(active)) {
      if (active.classList.contains('ne-byte')) { focusRow = active.dataset.row; focusCol = active.dataset.col; }
      else if (active.classList.contains('ne-apply')) { focusRow = active.dataset.applyrow; focusCol = '0'; }
    }
    var cat = CATS[curCat], rows = rowsOf(cat, curSlot), showHead = rows > 1 || !!cat.rowName;
    var h = '<table class="ne-table"><thead><tr>';
    if (showHead) h += '<th scope="col" class="ne-rh">' + (cat.rowLabel || '') + '</th>';
    for (var c = 0; c < cat.cols.length; c++) h += '<th scope="col">' + cat.cols[c].l + '</th>';
    h += '<th scope="col">Apply</th></tr></thead><tbody>';
    for (var r = 0; r < rows; r++) {
      h += '<tr data-row="' + r + '">';
      if (showHead) h += '<th scope="row" class="ne-rowname">' + (cat.rowName ? cat.rowName(r) : hex2(r)) + '</th>';
      for (var ci = 0; ci < cat.cols.length; ci++) {
        var col = cat.cols[ci], a = col.at(curSlot, r), ro = !!(col.readonlyFor && col.readonlyFor(r));
        var val = cellValue(a), lab = cat.label + ' ' + (cat.rowName ? cat.rowName(r) : (cat.unit + ' ' + curSlot + (rows > 1 ? ' ' + cat.rowLabel + ' ' + r : ''))) + ' ' + col.l;
        h += '<td><input class="ne-byte" type="text" spellcheck="false" autocomplete="off" maxlength="2" ' +
          (ro ? 'readonly ' : '') + 'data-row="' + r + '" data-col="' + ci + '" data-doc="' + committedHex(a) + '" aria-label="' + attr(lab) + '" value="' + attr(val) + '"></td>';
      }
      h += '<td><button type="button" class="ne-apply" data-applyrow="' + r + '" disabled>Apply</button></td></tr>';
    }
    h += '</tbody></table>';
    panel.querySelector('.ne-grid').innerHTML = h;
    for (var rr = 0; rr < rows; rr++) refreshRow(rr);
    updatePending();
    if (focusRow != null) {
      var next = panel.querySelector('.ne-byte[data-row="' + focusRow + '"][data-col="' + focusCol + '"]');
      if (next) next.focus();
    }
  }
  function updateHistory() { var u = panel.querySelector('.ne-undo'), r = panel.querySelector('.ne-redo'); if (u) u.disabled = !state.doc.canUndo(); if (r) r.disabled = !state.doc.canRedo(); }
  function updatePending() { var d = panel.querySelector('.ne-discard'); if (d) d.disabled = !state || !Object.keys(state.draft).length; }

  function rowInputs(r) { return [].slice.call(panel.querySelectorAll('.ne-byte[data-row="' + r + '"]')); }
  function refreshRow(r) {
    var cat = CATS[curCat], dirty = false, bad = false;
    rowInputs(r).forEach(function (inp) {
      if (inp.readOnly) return;
      var dk = draftKey(addrOf(inp)); if (state.draft[dk] == null) return;
      var v = parseHexByte((state.draft[dk] || '').trim());
      if (v == null) bad = true; else dirty = true;
    });
    var tr = panel.querySelector('tr[data-row="' + r + '"]');
    var btn = panel.querySelector('.ne-apply[data-applyrow="' + r + '"]');
    if (tr) { tr.classList.toggle('staged', dirty || bad); tr.classList.toggle('invalid', bad); }
    if (btn) { btn.disabled = !(dirty && !bad); btn.classList.toggle('staged', dirty && !bad); }
  }
  function onCellInput(inp) {
    var a = addrOf(inp), dk = draftKey(a), raw = inp.value || '';
    if (raw.trim().toUpperCase() === committedHex(a)) delete state.draft[dk];
    else state.draft[dk] = raw;
    refreshRow(+inp.dataset.row); updatePending();
  }
  function applyRow(r) {
    var cat = CATS[curCat], writes = [], dks = [], bad = false;
    rowInputs(r).forEach(function (inp) {
      if (inp.readOnly) return;
      var a = addrOf(inp), dk = draftKey(a); if (state.draft[dk] == null) return;
      var v = parseHexByte((state.draft[dk] || '').trim());
      if (v == null) { bad = true; return; }
      writes.push({ key: a.key, i: a.i, j: a.j, value: v }); dks.push(dk);
    });
    if (bad) { status('This row has an invalid byte (00\u2013FF); fix it before applying'); return false; }
    if (!writes.length) return true;
    try { state.doc.setBytes(writes); } catch (e) { status(String(e && e.message || e)); return false; }
    dks.forEach(function (dk) { delete state.draft[dk]; });   // clear ONLY this row's drafts
    state.dirty = true; updateHistory(); renderGrid();        // other rows' drafts persist
    status('Applied ' + cat.label + ' row (one atomic edit)'); return true;
  }
  // Commit ALL pending drafts across the whole song (block on any invalid), so
  // nothing typed is silently dropped on export.
  function flushAllOrBlock() {
    var writes = [], bad = false;
    Object.keys(state.draft).forEach(function (dk) {
      var v = parseHexByte((state.draft[dk] || '').trim());
      if (v == null) { bad = true; return; }
      var pz = dk.split('/'); writes.push({ key: pz[0], i: +pz[1], j: +pz[2], value: v });
    });
    if (bad) { status('Some pending edits are invalid (00\u2013FF). Fix or Revert pending before exporting.'); return false; }
    if (writes.length) {
      try { state.doc.setBytes(writes); } catch (e) { status(String(e && e.message || e)); return false; }
      state.draft = {}; state.dirty = true; updateHistory(); renderGrid();
      status('Applied ' + writes.length + ' pending edit(s) before export');
    }
    return true;
  }
  function discardPending() {
    if (!G.confirm('Discard all pending byte edits? Applied edits will be kept.')) return;
    state.draft = {}; renderGrid(); status('Discarded pending edits');
  }
  function doUndo() { if (state.doc.undo()) { renderGrid(); updateHistory(); status('Undid one edit'); } else status('Nothing to undo'); }
  function doRedo() { if (state.doc.redo()) { renderGrid(); updateHistory(); status('Redid one edit'); } else status('Nothing to redo'); }

  function exportLsdsng() {
    if (!flushAllOrBlock()) return;
    try {
      var song = state.doc.toSong(), body = LS().compress(song, 1);
      var name = state.header ? state.header.name : projName(state.title), ver = state.header ? (state.header.version & 0xFF) : 0;
      var file = new Uint8Array(9 + body.length); file.set(name.subarray(0, 8), 0); file[8] = ver; file.set(body, 9);
      if (saveBytes(file, safeName(state.title) + '-edited.lsdsng'))
        status('Saved ' + safeName(state.title) + '-edited.lsdsng \u2014 original header retained, ' + state.doc.dirtyFields().length + ' field group(s) changed');
    } catch (e) { status('Export failed: ' + String(e && e.message || e)); }
  }
  function exportSav() {
    if (!state.savBytes) { status('No .sav was opened, so only .lsdsng can be written'); return; }
    if (!flushAllOrBlock()) return;
    try {
      var out = Uint8Array.from(state.savBytes); out.set(state.doc.toSong(), 0);
      if (saveBytes(out, safeName(state.title) + '-edited.sav'))
        status('Saved ' + safeName(state.title) + '-edited.sav \u2014 working-memory song updated, other slots untouched');
    } catch (e) { status('Export failed: ' + String(e && e.message || e)); }
  }
  function exportJson() {
    if (!flushAllOrBlock()) return;
    try {
      var s = state.doc.serializeFull();
      if (saveBytes(new TextEncoder().encode(s), safeName(state.title) + '-native.json', 'application/json'))
        status('Saved native structure JSON \u2014 structure only, a file to reopen here, not a playable link');
    } catch (e) { status('Export failed: ' + String(e && e.message || e)); }
  }

  function setSlot(v) {
    var cat = CATS[curCat]; v = Math.round(+v || 0); if (!(v >= 0)) v = 0; v = Math.max(0, Math.min(cat.slots - 1, v));
    if (v === curSlot) { renderSlotMax(); return; }
    curSlot = v; renderSlotMax(); renderGrid();          // drafts persist (keyed by absolute address)
  }
  function wire() {
    panel.addEventListener('click', function (ev) {
      var t = ev.target;
      if (t.closest('.ne-close')) { close(); return; }
      var ap = t.closest('.ne-apply'); if (ap) { applyRow(+ap.dataset.applyrow); return; }
      var cat = t.closest('.ne-cat'); if (cat) { selectCategory(+cat.dataset.cat); return; }
      if (t.closest('.ne-undo')) { doUndo(); return; }
      if (t.closest('.ne-redo')) { doRedo(); return; }
      if (t.closest('.ne-discard')) { discardPending(); return; }
      if (t.closest('.ne-exp-sng')) { exportLsdsng(); return; }
      if (t.closest('.ne-exp-sav')) { exportSav(); return; }
      if (t.closest('.ne-exp-json')) { exportJson(); return; }
      if (t.closest('.ne-imp-json')) { pickJson(); return; }
    });
    panel.addEventListener('input', function (ev) {
      var b = ev.target.closest('.ne-byte'); if (b) { onCellInput(b); return; }
      var s = ev.target.closest('.ne-slot'); if (s) setSlot(s.value);
    });
    panel.addEventListener('change', function (ev) { var s = ev.target.closest('.ne-slot'); if (s) setSlot(s.value); });
    panel.addEventListener('keydown', function (ev) {
      // Local controls retain native key behaviour; app/game shortcuts never
      // receive bubbling keys from this modal (including Shift+D screen mode).
      ev.stopPropagation();
      if (ev.target.closest('.ne-cat') && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].indexOf(ev.key) >= 0) {
        ev.preventDefault(); ev.stopPropagation();
        var next = ev.key === 'Home' ? 0 : ev.key === 'End' ? CATS.length - 1 : (curCat + (ev.key === 'ArrowRight' ? 1 : -1) + CATS.length) % CATS.length;
        selectCategory(next); return;
      }
      if (ev.key === 'Tab') { trapTab(ev); return; }
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopImmediatePropagation(); close(); return; }
      if (ev.key === 'Enter') { var b = ev.target.closest('.ne-byte'); if (b) { ev.preventDefault(); applyRow(+b.dataset.row); } }
    });
  }

  function selectCategory(index) {
    curCat = index; curSlot = 0; renderTabs(); renderSlotMax(); renderGrid();
    panel.querySelector('.ne-cat[data-cat="' + curCat + '"]').focus();
  }

  function applyState(o) {
    state = { doc: o.doc, savBytes: o.savBytes || null, header: o.header || null, title: o.name || 'CHIPTUNE', draft: {}, dirty: false };
    curCat = 0; curSlot = 0;
  }
  function showPanel() {
    ensureInputs();
    var already = isOpen();
    if (G.CT_CREATE && G.CT_CREATE.stopForNative) { try { G.CT_CREATE.stopForNative(); } catch (e) {} }
    buildPanel();
    panel.querySelector('.ne-name').textContent = state.title;
    renderExports(); renderTabs(); renderSlotMax(); renderGrid(); updateHistory();
    if (!already) { lastFocus = document.activeElement; setBackgroundInert(true); }
    panel.classList.add('show'); document.body.classList.add('native-open');
    var c = panel.querySelector('.ne-close'); if (c) c.focus();
  }
  function open(o) {
    if (!confirmReplacement()) { status('Replacement cancelled; current edit preserved'); return false; }
    applyState(o); showPanel();
    status('Opened ' + state.title + ' — structure only, no playback. Edits stay in this tab; export before leaving.');
    return true;
  }
  function resume() {
    if (!state) { toast('No native edit in progress \u2014 use Open LSDj or Open native JSON'); return; }
    showPanel(); status('Resumed native edit (pending changes preserved)');
  }
  function close() {
    if (!isOpen()) return;
    importGen++;                                          // cancel any in-flight read so it cannot reopen us
    panel.classList.remove('show'); document.body.classList.remove('native-open');
    setBackgroundInert(false);
    if (lastFocus && lastFocus.isConnected && typeof lastFocus.focus === 'function') { try { lastFocus.focus(); } catch (e) {} }
    lastFocus = null;                                    // state (incl. drafts) is retained for resume()
  }
  function isOpen() { return !!(panel && panel.classList.contains('show')); }
  function hasState() { return !!state; }

  G.CT_LSDJ_NATIVE_EDITOR = { pick: pick, pickJson: pickJson, resume: resume, open: open, close: close, isOpen: isOpen, hasState: hasState };
  if (typeof module !== 'undefined' && module.exports) module.exports = G.CT_LSDJ_NATIVE_EDITOR;
})(typeof globalThis !== 'undefined' ? globalThis : window);
