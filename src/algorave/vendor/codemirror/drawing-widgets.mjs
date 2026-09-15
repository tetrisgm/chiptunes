// SPDX-License-Identifier: AGPL-3.0-or-later
import { Pattern } from '@strudel/core';
import { registerWidgetType } from '@strudel/transpiler';

// Drawing registrations and defaults follow @strudel/codemirror 1.2.6
// widget.mjs (Strudel contributors, AGPL-3.0-or-later). Canvas ownership is
// adapted to the opaque frame so existing drawing transactions can retain it.
function registerWidget(type, fn) {
  registerWidgetType(type);
  Pattern.prototype[type]=function(id,options={fold:1}){return fn(id,options,this);};
}
function getCanvasWidget(id,options={}) {
  const {width=500,height=60,pixelRatio=window.devicePixelRatio}=options;
  const canvas=document.getElementById(id)||document.createElement('canvas');
  canvas.id=id;canvas.dataset.inlineDrawing='';
  canvas.width=width*pixelRatio;canvas.height=height*pixelRatio;
  canvas.style.width=width+'px';canvas.style.height=height+'px';
  if(!canvas.isConnected)document.body.append(canvas);
  return canvas;
}

registerWidget('_pianoroll', (id, options = {}, pat) => {
  const ctx = getCanvasWidget(id, options).getContext('2d');
  return pat.tag(id).pianoroll({ fold: 1, ...options, ctx, id });
});

registerWidget('_punchcard', (id, options = {}, pat) => {
  const ctx = getCanvasWidget(id, options).getContext('2d');
  return pat.tag(id).punchcard({ fold: 1, ...options, ctx, id });
});

registerWidget('_spiral', (id, options = {}, pat) => {
  let _size = options.size || 275;
  options = { width: _size, height: _size, ...options, size: _size / 5 };
  const ctx = getCanvasWidget(id, options).getContext('2d');
  return pat.tag(id).spiral({ ...options, ctx, id });
});

registerWidget('_scope', (id, options = {}, pat) => {
  options = { width: 500, height: 60, pos: 0.5, scale: 1, ...options };
  const ctx = getCanvasWidget(id, options).getContext('2d');
  return pat.tag(id).scope({ ...options, ctx, id });
});

registerWidget('_pitchwheel', (id, options = {}, pat) => {
  let _size = options.size || 200;
  options = { width: _size, height: _size, ...options, size: _size / 5 };
  const ctx = getCanvasWidget(id, options).getContext('2d');
  return pat.pitchwheel({ ...options, ctx, id });
});

registerWidget('_spectrum', (id, options = {}, pat) => {
  let _size = options.size || 200;
  options = { width: _size, height: _size, ...options, size: _size / 5 };
  const ctx = getCanvasWidget(id, options).getContext('2d');
  return pat.spectrum({ ...options, ctx, id });
});

