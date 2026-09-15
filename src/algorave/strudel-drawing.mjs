import * as draw from '@strudel/draw';
import { evalScope } from '@strudel/web';
import './vendor/codemirror/drawing-widgets.mjs';
import { pauseHydra, restoreHydra, disposeHydra, startHydra, stopHydra, stopHydraAudio } from './vendor/hydra/hydra.mjs';


// Source callbacks stay inside the opaque music frame. Inline widgets export
// bitmap snapshots; they cannot insert DOM into the surrounding app.
export async function createDrawingHost(engine, visibility) {
  await evalScope(draw);
  const canvases = () => [...document.querySelectorAll('canvas:not([data-drawing-preview])')];
  let drawer, pending;
  const stop = (releaseAudio=false) => { drawer?.stop(); draw.pauseDraw(); draw.pauseAnimation(); stopHydra();if(releaseAudio){stopHydraAudio();stopHydraAudio(pending?.hydra);} };
  const report = () => {const nodes=canvases();visibility(nodes.length>0,nodes.length>0&&nodes.every(canvas=>canvas.dataset.inlineDrawing!==undefined),nodes.some(canvas=>canvas.dataset.inlineDrawing!==undefined));};
  const observer = new MutationObserver(() => { if (!pending) report(); });
  observer.observe(document.body, { childList: true, subtree: true });
  function prepare() {
    if (pending) throw Error('A drawing transaction is already active.');
    drawer?.stop();
    document.body.dataset.drawingPending='';
    const snapshot = { draw: draw.pauseDraw(), animation: draw.pauseAnimation(), drawer, hydra:pauseHydra(),
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
            const inline=painters.length&&painters.every(painter=>painter.inlineDrawing);
            const ctx = inline?canvases().find(canvas=>canvas.dataset.inlineDrawing!==undefined)?.getContext('2d'):draw.getDrawContext();
            if(!ctx)return;
            ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
            for (const painter of painters) painter(ctx, time, haps, state.drawTime);
          }, [-2, 2]);
          next.invalidate(engine.scheduler);
          if (next.painters.length) {
            drawer = next;if(!next.painters.every(painter=>painter.inlineDrawing))draw.getDrawContext();
            if (running) drawer.framer.start();
          }
        }
        if (!canvases().length&&(draw.hasDrawCallbacks() || draw.hasAnimation())) draw.getDrawContext();
        if (!running) stop(true);else startHydra();
        disposeHydra(snapshot.hydra);
        draw.disposeDrawCanvases(snapshot.nodes.map(node => node.canvas));
        snapshot.nodes.forEach(node => node.marker.remove());
        pending = undefined; report();
        delete document.body.dataset.drawingPending;
      },
      rollback(running) {
        stop();disposeHydra(pauseHydra());draw.disposeDrawCanvases(canvases());
        snapshot.nodes.forEach(({canvas, marker}) => marker.replaceWith(canvas));
        drawer = snapshot.drawer;
        draw.restoreDraw(snapshot.draw, running);
        draw.restoreAnimation(snapshot.animation, running);
        restoreHydra(snapshot.hydra,running);
        if (running) drawer?.framer.start();
        pending = undefined; report();
        delete document.body.dataset.drawingPending;
      },
    };
  }
  return { prepare, stop, dispose() {
    observer.disconnect();
    stop();disposeHydra(pauseHydra());draw.disposeDrawCanvases(canvases());
    if (pending) { disposeHydra(pending.hydra);draw.disposeDrawCanvases(pending.nodes.map(node => node.canvas)); pending.nodes.forEach(node => node.marker.remove()); }
    pending = undefined;
  } };
}
