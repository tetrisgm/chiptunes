// rrr-pack@3 manifest + rrr-tracks@1 index validation.
// Shared by pack-tools, build.js, and (optionally) the browser loader.
// Dual export: CommonJS module.exports + global PackSchema when loaded raw.
(function (root) {
  'use strict';

  var MANIFEST_SCHEMA = 'rrr-pack@3';
  var TRACKS_SCHEMA = 'rrr-tracks@1';
  var ID_RE = /^[a-z][a-z0-9_]{1,31}$/;
  var KINDS = ['game', 'music', 'composer'];
  var DECODERS = ['vgm', 'gme', 'openmpt'];
  var LAYOUTS = ['album-archive', 'loose'];

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function isStr(v) { return typeof v === 'string' && v.length > 0; }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  function validateManifest(m) {
    var errors = [];
    var warnings = [];
    function err(s) { errors.push(s); }
    function warn(s) { warnings.push(s); }

    if (!isObj(m)) {
      return { ok: false, errors: ['manifest is not an object'], warnings: [] };
    }
    if (m.schema !== MANIFEST_SCHEMA) err('schema must be "' + MANIFEST_SCHEMA + '" (got ' + JSON.stringify(m.schema) + ')');
    if (KINDS.indexOf(m.kind) < 0) err('kind must be one of ' + KINDS.join('|') + ' (got ' + JSON.stringify(m.kind) + ')');
    if (!isStr(m.id) || !ID_RE.test(m.id)) err('id must match ' + String(ID_RE) + ' (got ' + JSON.stringify(m.id) + ')');
    if (!isStr(m.name)) err('name is required');
    if (!isStr(m.version)) err('version is required');
    else if (!/^\d+\.\d+(\.\d+)?/.test(m.version)) warn('version does not look semver-ish: ' + m.version);
    if (!isStr(m.author)) warn('author missing');
    if (!isStr(m.license)) warn('license missing');

    if (m.kind === 'game') {
      if (!isObj(m.app) || m.app.contract !== 3) err('game packs need app.contract === 3');
      if (m.entry != null && (!isStr(m.entry) || !/\.js$/.test(m.entry))) err('entry must be a .js path when present');
      if (m.permissions != null && !Array.isArray(m.permissions)) err('permissions must be an array');
      if (m.icon != null && !isStr(m.icon)) err('icon must be a string path');
      if (m.decoder != null || m.layout != null) err('game packs must not carry music fields (decoder/layout)');
    } else if (m.kind === 'composer') {
      if (!isStr(m.entry) || !/\.js$/.test(m.entry)) err('composer packs need entry (a .js path)');
      if (m.composerV !== 3) err('composer packs need composerV === 3');
      if (m.decoder != null || m.layout != null) err('composer packs must not carry music fields (decoder/layout)');
    } else if (m.kind === 'music') {
      // Data-only by enforcement: a music pack that names executable code is rejected outright.
      if (m.entry != null) err('music packs are data-only: "entry" is forbidden');
      if (m.app != null || m.composerV != null) err('music packs must not carry game/composer fields (app/composerV)');
      if (DECODERS.indexOf(m.decoder) < 0) err('music packs need decoder ' + DECODERS.join('|') + ' (got ' + JSON.stringify(m.decoder) + ')');
      if (!isStr(m.platform)) err('music packs need a platform label');
      if (LAYOUTS.indexOf(m.layout) < 0) err('music packs need layout ' + LAYOUTS.join('|') + ' (got ' + JSON.stringify(m.layout) + ')');
      if (!isStr(m.tracks)) err('music packs need tracks (path to a ' + TRACKS_SCHEMA + ' file)');
      if (m.layout === 'album-archive' && !isStr(m.albums)) err('album-archive layout needs albums (path to albums.json)');
      if (m.covers != null && !isStr(m.covers)) err('covers must be a string path');
      if (m.meta != null && !isStr(m.meta)) err('meta must be a string path');
    }

    return { ok: errors.length === 0, errors: errors, warnings: warnings };
  }

  // rrr-tracks@1:
  // { "schema":"rrr-tracks@1",
  //   "albums":[ { "dir":"<albumDir or '' for loose>", "title":"...",
  //                "system"?, "composer"?, "year"?, "cover"?, "bpm"?, "conf"?,
  //                "tracks":[ { "title":"...", "file"?, "len"?, "bpm"?, "conf"? } ] } ] }
  function validateTracks(t) {
    var errors = [];
    var warnings = [];
    function err(s) { errors.push(s); }

    if (!isObj(t)) return { ok: false, errors: ['tracks index is not an object'], warnings: [] };
    if (t.schema !== TRACKS_SCHEMA) err('schema must be "' + TRACKS_SCHEMA + '" (got ' + JSON.stringify(t.schema) + ')');
    if (!Array.isArray(t.albums)) {
      err('albums must be an array');
      return { ok: false, errors: errors, warnings: warnings };
    }
    for (var i = 0; i < t.albums.length; i++) {
      var a = t.albums[i];
      var where = 'albums[' + i + ']';
      if (!isObj(a)) { err(where + ' is not an object'); continue; }
      if (typeof a.dir !== 'string') err(where + '.dir must be a string ("" allowed for loose)');
      if (!isStr(a.title)) err(where + '.title is required');
      if (a.year != null && !isNum(a.year)) err(where + '.year must be a number');
      if (a.bpm != null && !isNum(a.bpm)) err(where + '.bpm must be a number');
      if (a.conf != null && !isNum(a.conf)) err(where + '.conf must be a number');
      if (a.cover != null && !isStr(a.cover)) err(where + '.cover must be a string path');
      if (!Array.isArray(a.tracks)) { err(where + '.tracks must be an array'); continue; }
      for (var j = 0; j < a.tracks.length; j++) {
        var tr = a.tracks[j];
        var w2 = where + '.tracks[' + j + ']';
        if (!isObj(tr)) { err(w2 + ' is not an object'); continue; }
        if (!isStr(tr.title) && !isStr(tr.file)) err(w2 + ' needs title or file');
        if (tr.len != null && !isNum(tr.len)) err(w2 + '.len must be a number');
        if (tr.bpm != null && !isNum(tr.bpm)) err(w2 + '.bpm must be a number');
        if (tr.conf != null && !isNum(tr.conf)) err(w2 + '.conf must be a number');
      }
    }
    return { ok: errors.length === 0, errors: errors, warnings: warnings };
  }

  var api = {
    MANIFEST_SCHEMA: MANIFEST_SCHEMA,
    TRACKS_SCHEMA: TRACKS_SCHEMA,
    ID_RE: ID_RE,
    KINDS: KINDS,
    DECODERS: DECODERS,
    LAYOUTS: LAYOUTS,
    validateManifest: validateManifest,
    validateTracks: validateTracks
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.PackSchema = api;
  else if (typeof self !== 'undefined') self.PackSchema = api;
  else if (root && root !== module) root.PackSchema = api;
})(this);
