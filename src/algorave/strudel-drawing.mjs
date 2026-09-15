import * as draw from '@strudel/draw';
import { evalScope } from '@strudel/web';

// The visible canvas stays inside the opaque music frame. Only a boolean crosses
// to the parent; source callbacks cannot insert DOM into the surrounding app.
export async function createDrawingHost(engine, visibility) {
  await evalScope(draw);
  const canvases = () => [...document.querySelectorAll('canvas:not([data-drawing-preview])')];
  let drawer, pending;
  const stop = () => { drawer?.stop(); draw.pauseDraw(); draw.pauseAnimation(); };
  const report = () => visibility(canvases().length > 0);
  const observer = new MutationObserver(() => { if (!pending) report(); });
  observer.observe(document.body, { childList: true, subtree: true });
  function prepare() {
    if (pending) throw Error('A drawing transaction is already active.');
    drawer?.stop();
    document.body.dataset.drawingPending='';
    const snapshot = { draw: draw.pauseDraw(), animation: draw.pauseAnimation(), drawer,
      nodes: canvases().map(canvas => {
        // Keep the last image visible while async source evaluates. Remove its
        // ID so the candidate receives a different drawing surface.
        const marker = canvas.cloneNode(false);
        marker.removeAttribute('id'); marker.dataset.drawingPreview='';
        if(canvas.width&&canvas.height)marker.getContext('2d').drawImage(canvas,0,0);
        canvas.replaceWith(marker); return { canvas, marker };
      }) };
    drawer = undefined; pending = snapshot;
    return {
      complete(running, pattern = engine.state.pattern) {
        // onPaint-based methods (punchcard, pitchwheel, spiral) use the same
        // scheduler haps and upstream Drawer as Strudel's editor.
        if (pattern) {
          const next = new draw.Drawer((haps, time, state, painters) => {
            const ctx = draw.getDrawContext();
            ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
            for (const painter of painters) painter(ctx, time, haps, state.drawTime);
          }, [-2, 2]);
          next.invalidate(engine.scheduler);
          if (next.painters.length) {
            drawer = next; draw.getDrawContext();
            if (running) drawer.framer.start();
          }
        }
        if (draw.hasDrawCallbacks() || draw.hasAnimation()) draw.getDrawContext();
        if (!running) stop();
        draw.disposeDrawCanvases(snapshot.nodes.map(node => node.canvas));
        snapshot.nodes.forEach(node => node.marker.remove());
        pending = undefined; report();
        delete document.body.dataset.drawingPending;
      },
      rollback(running) {
        stop(); draw.disposeDrawCanvases(canvases());
        snapshot.nodes.forEach(({canvas, marker}) => marker.replaceWith(canvas));
        drawer = snapshot.drawer;
        draw.restoreDraw(snapshot.draw, running);
        draw.restoreAnimation(snapshot.animation, running);
        if (running) drawer?.framer.start();
        pending = undefined; report();
        delete document.body.dataset.drawingPending;
      },
    };
  }
  return { prepare, stop, dispose() {
    observer.disconnect();
    stop(); draw.disposeDrawCanvases(canvases());
    if (pending) { draw.disposeDrawCanvases(pending.nodes.map(node => node.canvas)); pending.nodes.forEach(node => node.marker.remove()); }
    pending = undefined;
  } };
}
