// SPDX-License-Identifier: AGPL-3.0-or-later
// Adapted from @strudel/hydra 1.2.6; original and provenance are alongside this file.
import Hydra from 'hydra-synth';
import { getDrawContext, disposeDrawCanvases } from '@strudel/draw';
import { controls, getTime, reify } from '@strudel/core';

let active,frame;
function globals(record){return [...Object.keys(record.hydra.synth),'loadScript'];}
function restore(values){for(const [name,descriptor] of values){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}}
export function stopHydra(){cancelAnimationFrame(frame);frame=undefined;}
export function stopHydraInputs(record=active){
  record?.hydra.s.forEach(source=>source.stopCapture?source.stopCapture():source.captureController?.abort());
  const audio=record?.hydra.synth.a;
  if(audio?.dispose)audio.dispose();
  else{audio?.stream?.getTracks().forEach(track=>track.stop());audio?.meyda?.stop();void audio?.context?.close().catch(()=>{});}
}
export function startHydra(){
  stopHydra();if(!active||active.options.autoLoop===false)return;
  let last=performance.now();
  const tick=now=>{if(!active)return;active.hydra.tick(now-last);last=now;frame=requestAnimationFrame(tick);};
  frame=requestAnimationFrame(tick);
}
export function pauseHydra(){
  stopHydra();const previous=active;active=undefined;
  if(previous){previous.globals=globals(previous).map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]);restore(globals(previous).map(name=>[name,previous.before[name]]));}
  return previous;
}
export function restoreHydra(previous,running){active=previous;if(previous){restore(previous.globals);if(running)startHydra();else stopHydraInputs();}}
export function disposeHydra(record){
  if(!record)return;
  const h=record.hydra;
  h.s.forEach(source=>source.clear());
  h.captureStream?.getTracks().forEach(track=>track.stop());
  stopHydraInputs(record);
  const gl=h.canvas.getContext('webgl');h.regl.destroy();gl?.getExtension('WEBGL_lose_context')?.loseContext();
}
export async function initHydra(options={}){
  if(active&&JSON.stringify(active.options)!==JSON.stringify(options))clearHydra();
  if(!active){
    const {src='https://unpkg.com/hydra-synth',feedStrudel=false,contextType='webgl',pixelRatio=1,pixelated=true,...config}={detectAudio:false,...options};
    const before=Object.getOwnPropertyDescriptors(globalThis);
    let Renderer=Hydra;
    if(src!=='https://unpkg.com/hydra-synth'){const module=await import(/* @vite-ignore */ src);Renderer=module.default||globalThis.Hydra;}
    globalThis.Hydra=Renderer;
    const {canvas}=getDrawContext('hydra-canvas',{contextType,pixelRatio,pixelated,contextAttributes:{preserveDrawingBuffer:true}});
    const hydra=new Renderer({...config,canvas,autoLoop:false});
    active={hydra,options,before};
    if(feedStrudel){const {canvas}=getDrawContext();canvas.style.display='none';hydra.synth.s0.init({src:canvas});}
  }
  return active.hydra;
}
export function clearHydra(){
  const previous=pauseHydra();disposeHydra(previous);
  const canvas=document.getElementById('hydra-canvas');if(canvas)disposeDrawCanvases([canvas]);
  globalThis.speed=controls.speed;globalThis.shape=controls.shape;
}
export const H=p=>()=>reify(p).queryArc(getTime(),getTime())[0].value;
