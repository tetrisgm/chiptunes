// RetroArch slang -> WebGL2 GLSL ES 300.
//
// The brickboy DMG passes in lib/shaders/brickboy are vendored UNMODIFIED
// (Apache-2.0, see their NOTICE). They are written in the slang dialect:
// Vulkan GLSL 450 with push-constant blocks, a std140 UBO, and set/binding
// qualifiers RetroArch fills in. None of that exists in WebGL2, but the
// mathematics is plain GLSL, so the whole difference is a mechanical rewrite
// applied at load time:
//
//   #version 450                      -> #version 300 es + precision
//   layout(push_constant) uniform Push -> individual uniforms; param.x -> x
//   layout(std140 ...) uniform UBO     -> individual uniforms; global.x -> x
//   layout(set=,binding=) sampler2D    -> uniform sampler2D
//   #pragma stage vertex|fragment      -> split into two shader sources
//   #include "inc/..."                 -> inlined
//
// Nothing here changes a constant, a coefficient or the order of operations --
// if it did, this would stop being a port and become the guesswork it replaced.
(function (G) {
  'use strict';

  // RetroArch's semantic uniforms. Sizes are vec4(w, h, 1/w, 1/h).
  var UBO_MEMBERS = ['MVP', 'SourceSize', 'OriginalSize', 'OutputSize', 'FrameCount'];

  function stripLayout(src) {
    return src
      .replace(/layout\s*\(\s*set\s*=\s*\d+\s*,\s*binding\s*=\s*\d+\s*\)\s*/g, '')
      .replace(/layout\s*\(\s*location\s*=\s*\d+\s*\)\s*/g, '');
  }

  // "#pragma parameter name "label" default min max step"
  function parseParams(src) {
    var out = {}, re = /#pragma\s+parameter\s+(\w+)\s+"[^"]*"\s+([-\d.]+)/g, m;
    while ((m = re.exec(src))) out[m[1]] = parseFloat(m[2]);
    return out;
  }

  // A declaration may name several variables at once ("float a, b, c;"), which
  // the colour and grid passes use heavily for their palette channels.
  function blockNames(src, blockRe) {
    var m = blockRe.exec(src);
    if (!m) return [];
    var out = [];
    m[1].split(';').forEach(function (line) {
      var t = line.trim();
      if (!t) return;
      var sp = t.indexOf(' ');
      if (sp < 0) return;
      var type = t.slice(0, sp).trim();
      t.slice(sp + 1).split(',').forEach(function (name) {
        name = name.trim().replace(/\[.*/, '');
        if (name) out.push({ name: name, type: type });
      });
    });
    return out;
  }

  function translate(source, opts) {
    opts = opts || {};
    var src = source;

    // inline includes
    src = src.replace(/#include\s+"([^"]+)"/g, function (_, path) {
      var inc = (opts.includes || {})[path.replace(/^.*\//, '')];
      return inc == null ? '' : inc.replace(/^#ifndef[\s\S]*?\n/, '').replace(/#endif\s*$/, '');
    });

    var params = parseParams(src);
    var pushNames = blockNames(src, /layout\s*\(\s*push_constant\s*\)\s*uniform\s+Push\s*\{([\s\S]*?)\}\s*param\s*;/);
    var uboNames = blockNames(src, /layout\s*\(\s*std140[^)]*\)\s*uniform\s+UBO\s*\{([\s\S]*?)\}\s*global\s*;/);

    // drop the block declarations, then re-declare their members as uniforms
    src = src.replace(/layout\s*\(\s*push_constant\s*\)\s*uniform\s+Push\s*\{[\s\S]*?\}\s*param\s*;/, '');
    src = src.replace(/layout\s*\(\s*std140[^)]*\)\s*uniform\s+UBO\s*\{[\s\S]*?\}\s*global\s*;/, '');
    src = src.replace(/#pragma\s+parameter[^\n]*\n/g, '');
    src = src.replace(/\bparam\.(\w+)/g, '$1');
    src = src.replace(/\bglobal\.(\w+)/g, '$1');
    src = stripLayout(src);

    var decls = pushNames.map(function (v) { return 'uniform ' + v.type + ' ' + v.name + ';'; });
    uboNames.forEach(function (v) {
      if (v.name === 'MVP') decls.push('uniform mat4 MVP;');
      // FrameCount is a uint counter in RetroArch; the defects pass drives its
      // dead-line flicker from it.
      else if (v.name === 'FrameCount') decls.push('uniform uint FrameCount;');
      else if (UBO_MEMBERS.indexOf(v.name) >= 0) decls.push('uniform vec4 ' + v.name + ';');
    });

    var vi = src.indexOf('#pragma stage vertex');
    var fi = src.indexOf('#pragma stage fragment');
    var head = src.slice(0, vi < 0 ? src.length : vi).replace(/#version\s+\d+\s*/, '');
    var vbody = vi < 0 ? '' : src.slice(vi, fi < 0 ? src.length : fi).replace('#pragma stage vertex', '');
    var fbody = fi < 0 ? '' : src.slice(fi).replace('#pragma stage fragment', '');

    var pre = '#version 300 es\nprecision highp float;\nprecision highp int;\n';
    return {
      vertex: pre + decls.join('\n') + '\n' + head + vbody,
      fragment: pre + decls.join('\n') + '\n' + head + fbody,
      params: params,
      uniforms: pushNames.concat(uboNames).map(function (v) { return v.name; })
    };
  }

  // "shader0 = x.slang" / "scale_type0 = viewport" ... -> ordered pass list
  function parsePreset(text) {
    var kv = {};
    text.split('\n').forEach(function (line) {
      var m = /^\s*([A-Za-z_]+\d*)\s*=\s*"?([^"#\n]*?)"?\s*(?:#.*)?$/.exec(line);
      if (m) kv[m[1]] = m[2].trim();
    });
    var n = parseInt(kv.shaders || '0', 10), passes = [];
    for (var i = 0; i < n; i++) {
      passes.push({
        index: i,
        shader: kv['shader' + i],
        scaleType: kv['scale_type' + i] || 'source',
        scale: parseFloat(kv['scale' + i] || '1'),
        linear: (kv['filter_linear' + i] || 'false') === 'true',
        float: (kv['float_framebuffer' + i] || 'false') === 'true'
      });
    }
    return { passes: passes, textures: (kv.textures || '').split(/\s+/).filter(Boolean), kv: kv };
  }

  var API = { translate: translate, parsePreset: parsePreset };
  G.CT_SLANG = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : window);
