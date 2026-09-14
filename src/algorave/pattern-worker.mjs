// Actual upstream pattern evaluation. No DOM, audio context or private app state.
import * as core from '@strudel/core';
import * as mini from '@strudel/mini';
import * as tonal from '@strudel/tonal';
import { transpiler } from '@strudel/transpiler';
let connected = false;
self.onmessage = async event => {
  if (connected || event.data?.type !== 'connect' || event.ports.length !== 1) return;
  connected = true;
  const port = event.ports[0], send = port.postMessage.bind(port);
  let cycle = 0, ready = false, pattern;
  const engine = core.repl({getTime:()=>0,transpiler});
  engine.scheduler.now = () => cycle;
  engine.scheduler.start = async () => { throw Error('Playback is controlled by the workspace.'); };
  try {
    await core.evalScope(core, mini, tonal); mini.miniAllStrings();
    core.Pattern.prototype.play = function () { return this.p('$'); };
    port.onmessage = async ({data}) => {
      if (!data || !Number.isSafeInteger(data.id)) return;
      try {
        if (data.type === 'prepare') {
          if (ready || typeof data.source !== 'string' || data.source.length > 65536) throw Error('Invalid music candidate.');
          cycle = Number.isFinite(data.cycle) ? data.cycle : 0;
          engine.scheduler.setCps(data.cps);
          await engine.evaluate(data.source, false);
          if (engine.state.error) throw engine.state.error;
          const cps = engine.scheduler.cps;
          if (!Number.isFinite(cps) || cps <= 0 || cps > 20) throw Error('Tempo must be between 0 and 1200 cycles per minute.');
          pattern = engine.state.pattern; ready = true;
          send({id:data.id,type:'reply',cps});
        } else if (data.type === 'query') {
          if (!ready || !Number.isFinite(data.begin) || !Number.isFinite(data.end) || data.end < data.begin || data.end-data.begin > 16) throw Error('Invalid pattern window.');
          cycle = data.begin; engine.scheduler.setCps(data.cps);
          const haps = pattern.queryArc(data.begin, data.end, {_cps:data.cps,cyclist:'cyclist'});
          if (!Array.isArray(haps) || haps.length > 4096) throw Error('The pattern is too dense for live playback.');
          const events = haps.filter(hap=>hap.hasOnset()).map(hap=>{
            if (hap.context.onTrigger || hap.stateful) throw Error('Audio-output callbacks are not supported in the isolated pattern worker.');
            hap.ensureObjectValue();
            return {begin:Number(hap.whole.begin),end:Number(hap.whole.end),duration:Number(hap.duration),value:plain(hap.value)};
          });
          send({type:'reply',id:data.id,events});
        }
      } catch(error) { send({type:'reply',id:data.id,error:String(error.message||error).slice(0,2000)}); }
    };
    port.start(); send({type:'ready'});
  } catch(error) { send({type:'fatal',error:String(error.message||error).slice(0,2000)}); }
};
// Reject executable/nonportable values; never stringify or evaluate them in the
// audio frame. A malicious getter can only stall this terminable worker.
function plain(value, depth = 0) {
  if (depth > 6) throw Error('Music controls are nested too deeply.');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e9) return value;
  if (typeof value === 'string' && value.length <= 2048) return value;
  if (Array.isArray(value) && value.length <= 128) return value.map(v=>plain(v,depth+1));
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const entries=Object.entries(value);
    if(entries.length>128)throw Error('Too many music controls.');
    const result={};
    for(const [key,item] of entries){
      if(['__proto__','constructor','prototype'].includes(key))throw Error('Invalid music control.');
      result[key]=plain(item,depth+1);
    }
    return result;
  }
  throw Error('Music controls must be serializable values.');
}
