// Full upstream evaluation, scheduler and Web Audio share this opaque frame.
// Only source/sample bytes enter; no application storage or credentials do.
import { initStrudel, transpiler, getAudioContext, initAudio, getSuperdoughAudioController, webaudioOutput, samples, loadBuffer, soundMap } from '@strudel/web';
import { drumWav } from './drum-samples.mjs';
import { SampleByteStore } from './sample-assets.mjs';
import { SampleBank } from './sample-bank.mjs';
import { registerDefaultSounds, updateSlider, snapshotSliders, restoreSliders } from './strudel-prebake.mjs';
import { createDrawingHost } from './strudel-drawing.mjs';
import { getWidgetID } from '@strudel/transpiler';

let connected = false;
window.addEventListener('message', async event => {
  if (connected || event.source !== parent || event.data?.type !== 'connect' || event.ports.length !== 1) return;
  connected = true;
  const port=event.ports[0],send=port.postMessage.bind(port);
  let busy=false,operation,candidate=null,candidateId=0,checkpoint=0,epoch=0,sequence=0,timer,evaluationBank,drawingRevision=0;
  const registries=new Map(),localAssets={};
  const restoreRegistry=registry=>soundMap.set({...registry,...localAssets});
  const events=[],bankKey=Symbol('local sample bank'),wrapped=Symbol('observed pattern');
  document.addEventListener('strudel.log',event=>{
    const detail=event.detail;
    if(typeof detail?.message==='string'&&(detail.type==='error'||/^\[[^\]]+\] error:/.test(detail.message)))
      send({type:'diagnostic',error:detail.message.slice(0,2000)});
  });
  // Some upstream onTrigger integrations launch promises without returning them.
  // Keep asynchronous connection failures visible in the same status area.
  window.addEventListener('unhandledrejection',event=>{
    let error=String(event.reason?.message||event.reason||'Asynchronous music error.').slice(0,1800);
    if(error.includes('Could not connect to OSC server'))error+=' Check the bridge and your browser’s local-network permission.';
    send({type:'diagnostic',error});
    event.preventDefault();
  });
  try {
    const audio=getAudioContext();
    // Observe the context's complete output, including upstream dough() and
    // custom nodes that connect directly to destination instead of an orbit.
    const output=audio.createGain(),analyser=audio.createAnalyser();
    analyser.fftSize=2048;analyser.smoothingTimeConstant=.8;analyser.minDecibels=-100;analyser.maxDecibels=-30;
    const connect=AudioNode.prototype.connect,disconnect=AudioNode.prototype.disconnect;
    connect.call(output,audio.destination);connect.call(output,analyser);
    AudioNode.prototype.connect=function(destination,...args){
      const result=connect.call(this,destination===audio.destination?output:destination,...args);
      return destination===audio.destination?destination:result;
    };
    AudioNode.prototype.disconnect=function(...args){
      if(args[0]===audio.destination)args[0]=output;
      return disconnect.apply(this,args);
    };
    window.addEventListener('message',event=>{
      if(event.source!==parent||event.data?.type!=='unlock'||!Number.isSafeInteger(event.data.id))return;
      const id=event.data.id;
      audio.resume().then(()=>send({type:'reply',id}),error=>send({type:'reply',id,error:String(error.message||error).slice(0,2000)}));
    });
    let locationCode,sourceLocations=new Set();
    const engine=await initStrudel({
      defaultOutput(hap,...args){
        // Portable imported samples retain immutable names across live edits.
        // samples() and registerSound() otherwise use upstream's normal scope.
        hap.ensureObjectValue();const bank=hap.context[bankKey];
        return webaudioOutput(bank?hap.withValue(value=>bank.resolve(value)):hap,...args);
      },
      editPattern(pattern){
        if(pattern[wrapped])return pattern;
        const bank=evaluationBank;
        const observed=pattern.withHap(hap=>{
          const original=hap.context.onTrigger;
          const observedHap=hap.setContext({...hap.context,[bankKey]:bank,onTrigger:async(hap,now,cps,time)=>{
            if(locationCode!==engine.state.activeCode){locationCode=engine.state.activeCode;sourceLocations=new Set(transpiler(locationCode||'').miniLocations.map(([start,end])=>`${start}:${end}`));}
            if(events.length<256)events.push({time,end:time+Number(hap.whole?.duration||0)/cps,sound:String(hap.value?.s||'').slice(0,64),locations:(hap.context.locations||[]).filter(({start,end})=>sourceLocations.has(`${start}:${end}`)).slice(0,32).map(({start,end})=>({start,end})),markcss:typeof hap.value?.markcss==='string'?hap.value.markcss.slice(0,1024):'',color:typeof hap.value?.color==='string'?hap.value.color.slice(0,128):''});
            return original?.call(hap.context,hap,now,cps,time);
          }});
          observedHap.stateful=hap.stateful;return observedHap;
        });
        Object.defineProperty(observed,wrapped,{value:true});return observed;
      },
    });
    const drawing=await createDrawingHost(engine,(visible,inlineOnly,hasInline)=>send({type:'drawing',visible,inlineOnly,hasInline}));
    audio.addEventListener('statechange',()=>{
      if(!busy&&engine.state.started&&audio.state!=='running'&&audio.state!=='closed'){
        engine.pause();drawing.stop(true);epoch++;events.length=0;
        send({type:'runtime-error',error:'Audio output was interrupted. Press Play to resume.'});
      }
    });
    getSuperdoughAudioController();await initAudio();
    const sampleBytes=new SampleByteStore(),sampleBank=new SampleBank({sampleRate:audio.sampleRate,loadBuffer:url=>loadBuffer(url,audio),registerSamples:async map=>{
      await samples(map);for(const name of Object.keys(map))localAssets[name]=soundMap.get()[name];
    }});
    const originals={};
    for(const name of ['bd','sd','hh']){
      const asset=await sampleBytes.put(new Uint8Array(drumWav(name)));
      originals[name]=[asset.id];
    }
    const originalBank=await sampleBank.prepare(originals,id=>sampleBytes.get(id));
    // Register defaults under ordinary Strudel names, so source-level samples()
    // can replace them exactly as it does in the upstream REPL.
    for(const [name,alias] of Object.entries(originalBank.mapping)){
      // Alias the registered sample source without changing the source language.
      soundMap.setKey(name,soundMap.get()[alias]);
    }
    const unavailableBanks=await registerDefaultSounds();
    registries.set(0,{...soundMap.get()});
    async function prepare(source,map={},assets=[],restore=false,restoreCheckpoint=0,defer=false){
      if(typeof source!=='string'||source.length>65536)throw Error('Music code is too large.');
      // Parse only: preparation must not run callbacks, fetch URLs or change a
      // playing engine. The actual upstream evaluation happens once, on Apply.
      transpiler(source);
      if(!map||typeof map!=='object'||Array.isArray(map)||!Array.isArray(assets)||assets.length>32)throw Error('Invalid sample collection.');
      for(const asset of assets)if(!asset||(await sampleBytes.put(asset.bytes)).id!==asset.id)throw Error('Sample content does not match its identity.');
      const bank=await sampleBank.prepare(map,id=>sampleBytes.get(id));
      const registry=restore?registries.get(restoreCheckpoint):undefined;
      if(restore&&!registry)throw Error('Music Undo checkpoint expired.');
      const token=++candidateId;candidate={token,source,bank,registry,defer};return token;
    }
    async function commit(token,play,current){
      if(!candidate||candidate.token!==token)throw Error('Music candidate expired. Run again.');
      const next=candidate;candidate=null;
      drawingRevision++;
      if(next.defer&&play)throw Error('An opened project must remain stopped until Play.');
      const previous={pattern:engine.state.pattern,activeCode:engine.state.activeCode,cps:engine.scheduler.cps,playing:engine.state.started,registry:{...soundMap.get()}};
      const visual=drawing.prepare();
      const previousSliders=snapshotSliders();
      try {
        if(!play)await audio.suspend();else{
          await audio.resume();
          if(audio.state!=='running')throw Error('Audio output is unavailable. Press Play again.');
        }
        if(next.registry)restoreRegistry(next.registry);
        evaluationBank=next.bank;
        if(!next.defer){restoreSliders([]);await engine.evaluate(next.source,false);}
        if(current.cancelled)throw Error('Music edit cancelled.');
        if(!next.defer&&engine.state.error)throw engine.state.error;
        if(play){if(!previous.playing){epoch++;events.length=0;}if(!engine.state.started)await engine.start();}
        else{engine.stop();epoch++;events.length=0;}
        registries.set(++checkpoint,{...soundMap.get()});
        visual.complete(play,next.defer?null:engine.state.pattern);
      }catch(error){
        restoreSliders(previousSliders);
        let resumed=false;
        try{
          restoreRegistry(previous.registry);
          engine.setCps(previous.cps);
          if(previous.pattern)await engine.setPattern(previous.pattern,false);
          engine.state.pattern=previous.pattern;engine.state.activeCode=previous.activeCode;
          engine.state.isDirty=engine.state.code!==previous.activeCode;
          if(!previous.playing||current.stopped){engine.stop();await audio.suspend();}
          else{await audio.resume();if(!engine.state.started)await engine.start();resumed=audio.state==='running';}
        }finally{visual.rollback(resumed);}
        throw error;
      }
    }
    let widgetCode,widgetConfigs=[];
    port.onmessage=async({data})=>{
      if(!data||!Number.isSafeInteger(data.id))return;
      if(data.type==='cancel'){if(operation?.id===data.id)operation.cancelled=true;return;}
      if(data.type==='drawings'){
        if(busy){send({type:'reply',id:data.id});return;}
        const frames=[],revision=drawingRevision;
        if(!busy&&data.source===engine.state.activeCode){
          if(widgetCode!==data.source){widgetCode=data.source;widgetConfigs=transpiler(widgetCode).widgets.filter(w=>w.type!=='slider');}
          try{
            for(const config of widgetConfigs){
              const canvas=document.getElementById(getWidgetID(config));
              if(canvas?.dataset.inlineDrawing!==undefined&&canvas.width&&canvas.height){
                const bitmap=await createImageBitmap(canvas);
                frames.push({to:config.to,id:getWidgetID(config),width:parseFloat(canvas.style.width),height:parseFloat(canvas.style.height),bitmap});
              }
            }
          }catch(error){frames.forEach(frame=>frame.bitmap.close());send({type:'reply',id:data.id,error:String(error.message||error)});return;}
        }
        if(busy||revision!==drawingRevision){frames.forEach(frame=>frame.bitmap.close());send({type:'reply',id:data.id});return;}
        send({type:'reply',id:data.id,drawings:frames},frames.map(frame=>frame.bitmap));return;
      }
      if(data.type==='slider'){
        const accepted=!busy&&updateSlider(data.sliderId,data.value);
        send({type:'reply',id:data.id,...(accepted?{}:{error:'Slider is unavailable.'})});return;
      }
      if(data.type==='retain'){
        if(Array.isArray(data.checkpoints)&&data.checkpoints.length<=21&&data.checkpoints.every(Number.isSafeInteger)){
          const keep=new Set([0,checkpoint,...data.checkpoints]);
          for(const id of registries.keys())if(!keep.has(id))registries.delete(id);
        }
        send({type:'reply',id:data.id,playing:engine.state.started});return;
      }
      if(!['run','stop','prepare','commit','discard'].includes(data.type))return;
      if(data.type==='stop'){
        if(operation){operation.cancelled=true;operation.stopped=true;}
        engine.stop();drawing.stop(true);window.postMessage('strudel-stop','*');await audio.suspend();epoch++;events.length=0;candidate=null;
        send({type:'reply',id:data.id,playing:false});return;
      }
      if(busy){send({type:'reply',id:data.id,error:'Another edit is still running.'});return;}
      busy=true;const current={id:data.id,cancelled:false,stopped:false};operation=current;
      try {
        if(data.type==='discard'){if(candidate?.token===data.token)candidate=null;}
        else if(data.type==='prepare'){
          const token=await prepare(data.source,data.samples,data.assets,data.restore===true,data.checkpoint,data.defer===true);
          send({type:'reply',id:data.id,token,playing:engine.state.started});return;
        }else if(data.type==='commit')await commit(data.token,data.play===true,current);
        else await commit(await prepare(data.source,data.samples,data.assets),true,current);
        send({type:'reply',id:data.id,playing:engine.state.started,checkpoint});
      }catch(error){send({type:'reply',id:data.id,error:String(error.message||error).slice(0,2000),playing:engine.state.started});}
      finally{busy=false;if(operation===current)operation=null;}
    };
    port.start();
    const frequency=new Uint8Array(512),waveform=new Uint8Array(512);
    timer=setInterval(()=>{
      analyser.getByteFrequencyData(frequency);analyser.getByteTimeDomainData(waveform);
      const stamp=audio.getOutputTimestamp?.();
      const lag=stamp?.contextTime>0?Math.max(0,Math.min(.5,audio.currentTime-stamp.contextTime)):Math.max(0,Math.min(.5,(audio.baseLatency||0)+(audio.outputLatency||0)));
      send({type:'signal',sequence:++sequence,epoch,observedAt:performance.timeOrigin+performance.now(),time:audio.currentTime-lag,
        cycle:engine.state.started?Math.max(0,engine.scheduler.now()-lag*engine.scheduler.cps):0,cps:engine.scheduler.cps,playing:engine.state.started,
        sampleRate:audio.sampleRate,frequency,waveform,events:events.splice(0)});
    },1000/30);
    window.addEventListener('pagehide',()=>{clearInterval(timer);engine.stop();drawing.dispose();sampleBank.close();audio.close();});
    send({type:'ready',version:'strudel-web-1.3.0'});
    if(unavailableBanks.length)send({type:'diagnostic',error:'Could not load sound libraries: '+unavailableBanks.join(', ')+'. Local sounds remain available; reload to retry.'});
  }catch(error){send({type:'fatal',error:String(error.message||error).slice(0,2000)});}
});
