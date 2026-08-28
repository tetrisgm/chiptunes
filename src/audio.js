// AUTO-SPLIT from index.html — classic script, shares global scope (load order matters).
// The AUDIO ENGINE + PLAYBACK ADAPTER (must load FIRST).
"use strict";
/* ============================================================
   Chiptunes — audio engine v2
   - ENGINE: a facade over the generated-synth AudioWorklet (worklet v2 protocol:
     palette registration, batched events, tempo-synced echo, generation tagging).
     Worklet-only — there is no node-graph voice fallback.
   - PLAYBACK ADAPTER: token -> activeComposer().compile(token) -> Score; a
     scheduler walks Score.events into the Engine inside a deep lookahead
     horizon; tracks chain gaplessly (next Score pre-compiled, cold-opened on
     the boundary while the previous generation's echo drains in the worklet).
   - EXTERNAL path (mic / file / chip PCM): unchanged — an outside node drives
     the analyser + the games' beat clock; the generated engine is muted.
   - vis(): the games' music bus. Analyser-derived bands/onsets/spectrum plus
     composer section/energy. Same shape for generated + external sources.
   ============================================================ */

/* ---------- NES color palette (vivid subset of the 2C02) ---------- */
const PAL = [
  "#f878f8","#f87858","#fca044","#f8d878","#b8f818","#58f898","#58d854",
  "#00e8d8","#6888fc","#9878f8","#f8b8f8","#a80020","#0000fc","#007800",
  "#00a800","#e40058","#f83800","#fc7460","#bcbcbc","#fcfcfc"
];
const palColor = i => PAL[((i%PAL.length)+PAL.length)%PAL.length];

/* ---------- music theory helpers ---------- */
const mtof = m => 440 * Math.pow(2,(m-69)/12);

/* ============================================================
   AUDIO ENGINE
   ============================================================ */
const Audio = (()=>{
  let ctx, master, comp, genGain, masterOut=null, _captureDest=null;
  // EXTERNAL-SOURCE mode (party visualizer): when set, an outside Web Audio node (mic / file / chip player)
  // drives the games' beat clock via a real-time analyser, the generative engine is muted, and vis() returns the
  // analysed beat/energy instead of the internal clock. Lets the games dance to ANY audio we route through ctx.
  let extMode=false, extGain=null, extAnalyser=null, extSrcNode=null, extEqIn=null, extEqNodes=null, _extFreq=null, _extTime=null, _micMode=false;
  let _masterAna=null, _masterFreq=null, _masterTime=null, _specAvg=null, _specPrev=null, _specLast=null, _specT=-1;   // SPECTRUM bus (pitch/timbre/notes + visualizer FFT) — universal across generated + chip + mic
  let _outputProbeLast=null, _outputProbeAt=0;
  let _semanticFrame=null;                         // source-normalized semantic channels: lead/counter/bass/perc/noise -> notes
  let _bd={ pulse:0, avg:0, hue:0.5, beatN:0, ibi:0.5, lastBeatT:0 };
  let started = false, muted = false;
  let genWorkletNode = null, genWorkletReady = null, genWorkletActive = false, genWorkletBatch = null, genWorkletGeneration = 1, genWorkletStats = null;
  let gbNode = null, gbReady = null, gbActive = false, gbSynthGain = null, gbChipGain = null, gbPending = null;
  // Root-relative URLs work on the website, but Electron loads the shared bundle from file://,
  // where `/lib/...` resolves to the nonexistent filesystem root. Keep one bundle and resolve the
  // packaged worklet beside index.html only for the desktop file origin.
  const WORKLET_URL = (typeof location!=='undefined' && location.protocol==='file:')
    ? new URL('lib/generated-synth-worklet.js', location.href).href
    : '/lib/generated-synth-worklet.js';
  const WORKLET_NAME = 'retro-rave-generated-synth';
  // THE CHIP. Generated tracks are played by a DMG APU on the audio thread --
  // the same source scripts/gb-emu.js runs an exported cartridge through -- so
  // the browser and the .gb file cannot disagree. dist/lib/gb-chip-worklet.js is
  // assembled by build.js from src/gb-hardware.js + src/gb-apu.js + the
  // processor shell; an AudioWorklet has its own global scope and cannot import
  // from the page, so there is no way to share it except by concatenation.
  const GB_WORKLET_URL = (typeof location!=='undefined' && location.protocol==='file:')
    ? new URL('lib/gb-chip-worklet.js', location.href).href
    : '/lib/gb-chip-worklet.js';
  const GB_WORKLET_NAME = 'chiptunes-gb-chip';
  // 'master' scales the final gain; non-native external streams do not get fake per-role EQ.
  const MIX = { master:1, kick:1, snare:1, hat:1, bass:1, lead:1, arp:1, pad:1, fx:1 };
  // On phones/tablets the generated master is routed to a MediaStream + a playing <audio> element so
  // the OS keeps the audio session (and the WebAudio generation feeding it) alive on lock/background.
  let _outStreamDest=null;
  function masterTargetGain(){ return muted ? 0.0001 : 0.42*MIX.master; }
  function holdParam(param, t){
    if(!param) return;
    try{
      if(param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(t);
      else { param.cancelScheduledValues(t); param.setValueAtTime(param.value, t); }
    }catch(e){}
  }
  function diag(key, val){                                        // window.__rrr diagnostics bag
    if(typeof window==='undefined') return;
    var b=window.__rrr=(window.__rrr||{}); b[key]=val;
  }

  /* ---------------- worklet transport ---------------- */
  function genWorkletUsable(){
    return !!(started && ctx && genWorkletActive && genWorkletNode && genWorkletNode.port && !extMode);
  }
  function genWorkletPost(msg, transfers){
    if(!genWorkletNode || !genWorkletNode.port) return false;
    try{ genWorkletNode.port.postMessage(msg, transfers||[]); return true; }catch(e){ return false; }
  }
  function genWorkletPush(ev, generation){
    if(!genWorkletUsable()) return false;
    ev.generation = (generation!=null) ? generation : genWorkletGeneration;
    if(genWorkletBatch){ genWorkletBatch.push(ev); return true; }
    return genWorkletPost({type:'events', generation:ev.generation, events:[ev]});
  }
  function genWorkletFlush(){
    if(!genWorkletBatch) return;
    var batch=genWorkletBatch; genWorkletBatch=null;
    if(!batch.length || !genWorkletNode) return;
    var groups=Object.create(null), order=[];
    for(var i=0;i<batch.length;i++){
      var ev=batch[i], gen=(ev&&ev.generation!=null)?ev.generation:genWorkletGeneration, key=String(gen);
      if(!groups[key]){ groups[key]=[]; order.push(key); }
      groups[key].push(ev);
    }
    for(var j=0;j<order.length;j++){
      var k=order[j], events=groups[k];
      genWorkletPost({type:'events', generation:+k, events:events});
    }
  }
  function genWorkletReset(paused){
    genWorkletGeneration++;
    genWorkletPost({type:'reset', generation:genWorkletGeneration, paused:!!paused, mix:MIX});
  }
  function genWorkletSetPaused(paused){
    genWorkletPost({type:'pause', paused:!!paused});
    gbSetPaused(paused);
  }
  function genWorkletSetMix(){
    genWorkletPost({type:'mix', mix:MIX});
  }
  function genWorkletClearFuture(time){
    genWorkletPost({type:'clearFuture', generation:genWorkletGeneration, time:time});
  }
  // Build a {type:'palette'} message from a Score palette. VoiceDefs/PercDefs pass through untouched
  // except sample PCM, which is copied into fresh Float32Arrays (and optionally transferred) so the
  // Score object stays reusable after posting.
  function buildPaletteMsg(palette, generation, transfer){
    palette = palette || {};
    var transfers=[];
    function cloneDefs(src, isVoice){
      var out={};
      if(!src) return out;
      if(Array.isArray(src)){ var m={}; for(var i=0;i<src.length;i++){ var d=src[i]; if(d) m[d.id||d.role||('v'+i)]=d; } src=m; }
      Object.keys(src).forEach(function(k){
        var d=src[k]; if(!d){ return; }
        var c=Object.assign({}, d);
        if(isVoice && c.osc==null && c.wave!=null) c.osc=c.wave;   // composer VoiceDefs use `wave`; the worklet reads `osc`
        if(c.sample && c.sample.pcm && c.sample.pcm.length){
          var pcm=new Float32Array(c.sample.pcm);
          c.sample=Object.assign({}, c.sample, {pcm:pcm});
          if(transfer) transfers.push(pcm.buffer);
        }
        out[k]=c;
      });
      return out;
    }
    // sample bank: copy each PCM into a fresh Float32Array (optionally transferred) so the Score stays reusable
    var samples=null;
    if(Array.isArray(palette.samples) && palette.samples.length){
      samples=[];
      for(var si=0; si<palette.samples.length; si++){
        var s=palette.samples[si]; if(!s || !s.pcm || !s.pcm.length) continue;
        var spcm=new Float32Array(s.pcm);
        var so={ id:s.id, rate:s.rate, pcm:spcm };                    // worklet reads baseFreq/loopStart/loopEnd
        so.baseFreq=(s.baseFreq!=null) ? s.baseFreq : (s.baseMidi!=null ? mtof(s.baseMidi) : 261.626);
        if(s.loop && typeof s.loop==='object'){ if(s.loop.start!=null) so.loopStart=s.loop.start; if(s.loop.end!=null) so.loopEnd=s.loop.end; }
        if(s.loopStart!=null) so.loopStart=s.loopStart;
        if(s.loopEnd!=null) so.loopEnd=s.loopEnd;
        samples.push(so);
        if(transfer) transfers.push(spcm.buffer);
      }
    }
    return { msg:{ type:'palette', generation:generation,
      voices:cloneDefs(palette.voices, true), percs:cloneDefs(palette.percs, false),
      echo:(palette.echo?Object.assign({},palette.echo):null),
      panLayout:(palette.panLayout?Object.assign({},palette.panLayout):null),
      samples:samples }, transfers:transfers };
  }

  /* ---------------- ENGINE facade (public worklet v2 surface) ---------------- */
  const Engine = {
    usable: genWorkletUsable,
    generation(){ return genWorkletGeneration; },
    newGeneration(){ return ++genWorkletGeneration; },
    loadPalette(palette, generation, activateAt, secondsPerBeat){
      if(!genWorkletNode) return false;
      var p=buildPaletteMsg(palette, generation!=null?generation:genWorkletGeneration, true);
      if(isFinite(activateAt)) p.msg.activateAt=+activateAt;
      if(isFinite(secondsPerBeat)&&secondsPerBeat>0) p.msg.secondsPerBeat=+secondsPerBeat;
      return genWorkletPost(p.msg, p.transfers);
    },
    note(ev, generation){ return genWorkletPush(ev, generation); },
    perc(ev, generation){ return genWorkletPush(ev, generation); },
    beginBatch(){ if(!genWorkletBatch) genWorkletBatch=[]; },
    flush(){ genWorkletFlush(); },
    setTempo(spbSec, bpm, generation){                 // tempo-synced echo lines follow the audible deck
      return genWorkletPost({type:'echoTime', secondsPerBeat:spbSec, spb:spbSec, bpm:bpm||Math.round(60/Math.max(0.05,spbSec)), generation:generation!=null?generation:genWorkletGeneration});
    },
    killAll(fade){                                     // fade every live voice; scheduled future stays (clear it separately)
      var t=(ctx&&ctx.currentTime)||0;
      return genWorkletPost({type:'killAll', time:t, fade:Math.max(0.008, fade||0.018)});
    },
    clearFuture(time){ genWorkletClearFuture(time); },
    setMix(){ genWorkletSetMix(); },
    setPaused(p){ genWorkletSetPaused(p); },
    reset(paused){ genWorkletReset(paused); },
    // OFFLINE RENDER for the audition harness: same worklet module + the SAME master chain
    // (compressor -> makeup -> limiter, identical constants) so offline WAVs match live loudness.
    render(score, opts){
      opts=opts||{};
      // GAME BOY PATH. The score is already four channels of register-level
      // note data, so it is synthesised by the chip itself -- no OfflineAudio-
      // Context, no biquads, no compressor. That is not a shortcut for parity:
      // a DMG has none of those, and routing through them is what made the
      // browser and the offline renderer disagree (their filter and compressor
      // implementations differ). Same JS, same notes, same samples, either side.
      var GB=(typeof globalThis!=='undefined'?globalThis:window).CT_GB_APU;
      if(GB && score && score.gb && score.gb.notes && score.gb.notes.length){
        var gsr=opts.sampleRate||48000;
        var mono=GB.render({notes:score.gb.notes, bank:score.gb.bank,
                            totalFrames:score.gb.totalFrames}, gsr);
        return Promise.resolve({left:mono, right:mono, sampleRate:gsr});
      }
      if(typeof OfflineAudioContext==='undefined' || typeof AudioWorkletNode==='undefined')
        return Promise.reject(new Error('OfflineAudioContext/AudioWorklet unavailable in this environment'));
      if(!score || !score.events) return Promise.reject(new Error('render: no score'));
      var sr=opts.sampleRate||48000;
      var bpm=clampBpm(score.bpm)||128, rspb=60/bpm;
      var beats=scoreTotalBeats(score);
      var lead=0.06, seconds=beats*rspb + 1.8;
      var oc=new OfflineAudioContext(2, Math.ceil((seconds+lead)*sr), sr);
      var m=oc.createGain(); m.gain.value=0.42;
      // keep IDENTICAL to the live master chain in init() (voicing EQ + leveler + makeup + limiter)
      var pe=oc.createBiquadFilter(); pe.type='peaking'; pe.frequency.value=1200; pe.Q.value=0.8; pe.gain.value=3.5;
      var ae=oc.createBiquadFilter(); ae.type='highshelf'; ae.frequency.value=8000; ae.gain.value=-6;
      var c=oc.createDynamicsCompressor();
      c.threshold.value=-24; c.knee.value=10; c.ratio.value=3; c.attack.value=0.01; c.release.value=0.25;
      var mk=oc.createGain(); mk.gain.value=1.9;
      var lim=oc.createDynamicsCompressor();
      lim.threshold.value=-1.5; lim.knee.value=0; lim.ratio.value=20; lim.attack.value=0.002; lim.release.value=0.06;
      m.connect(pe); pe.connect(ae); ae.connect(c); c.connect(mk); mk.connect(lim); lim.connect(oc.destination);
      return oc.audioWorklet.addModule(opts.workletUrl||WORKLET_URL).then(function(){
        var node=new AudioWorkletNode(oc, WORKLET_NAME, {numberOfInputs:0, numberOfOutputs:1, outputChannelCount:[2]});
        node.connect(m);
        node.port.postMessage({type:'reset', generation:1, paused:false, mix:{}});
        var p=buildPaletteMsg(score.palette, 1, false);
        node.port.postMessage(p.msg);
        node.port.postMessage({type:'echoTime', secondsPerBeat:rspb, spb:rspb, bpm:bpm, generation:1});
        var evs=score.events, out=[];
        var rvs=(score.gainScalar>0 && score.gainScalar<=1) ? score.gainScalar : 1;   // same density duck as live decks
        for(var i=0;i<evs.length;i++){
          var we=deckEventToWorklet({spb:rspb, bpm:bpm, nativeBpm:bpm, generation:1, velScale:rvs}, evs[i], lead+(evNum(evs[i].tBeat, evs[i].t))*rspb);
          if(we) out.push(we);
        }
        node.port.postMessage({type:'events', generation:1, events:out});
        // OFFLINE RENDER RACE: an OfflineAudioContext renders as fast as it can,
        // and worklet port messages are delivered asynchronously — if the render
        // outruns delivery, the processor renders the ENTIRE track before the
        // palette/events arrive: a full-length file of pure silence (hit ~40% of
        // golden renders, at random). Canonical fix: suspend at t=0, start the
        // render (audio thread now alive but parked), ping the worklet and wait
        // for its pong (port messages are ordered, so pong => palette+events
        // processed), then resume. 5s pong timeout so a broken processor can't
        // deadlock the render — it proceeds and the silence gate catches it.
        var suspendP = oc.suspend(0);
        var pongP = new Promise(function(resolve){
          var to=setTimeout(function(){ resolve('timeout'); }, 5000);
          node.port.onmessage=function(e){ if(e.data && e.data.type==='pong'){ clearTimeout(to); resolve('pong'); } };
        });
        node.port.postMessage({type:'ping', n:1});
        var renderP = oc.startRendering();
        return suspendP.then(function(){ return pongP; })
          .then(function(){ return oc.resume(); })
          .then(function(){ return renderP; });
      }).then(function(buf){
        return { left:buf.getChannelData(0), right:(buf.numberOfChannels>1?buf.getChannelData(1):buf.getChannelData(0)), seconds:buf.duration, sampleRate:buf.sampleRate };
      });
    }
  };

  /* ---------------- external EQ (chip stems live elsewhere; this is the non-native stream shaper) ---------------- */
  function updateExtEq(){
    if(!ctx || !extEqNodes) return;
    Object.keys(extEqNodes).forEach(function(k){
      if(extEqNodes[k]) extEqNodes[k].gain.setTargetAtTime(0, ctx.currentTime, 0.025);
    });
  }
  function ensureExtEq(){
    if(extEqIn || !ctx || !extAnalyser) return;
    extEqIn = ctx.createGain();
    extEqNodes = {};
    var chain = [
      ['kick','peaking',62,1.05],
      ['bass','lowshelf',180,0.7],
      ['snare','peaking',1500,0.95],
      ['pad','peaking',650,0.55],
      ['lead','peaking',2600,0.75],
      ['arp','peaking',4300,0.95],
      ['hat','highshelf',7600,0.7],
      ['fx','peaking',9800,0.9]
    ];
    var prev=extEqIn;
    for(var i=0;i<chain.length;i++){
      var c=chain[i], f=ctx.createBiquadFilter();
      f.type=c[1]; f.frequency.value=c[2]; f.Q.value=c[3]; f.gain.value=0;
      prev.connect(f); prev=f; extEqNodes[c[0]]=f;
    }
    prev.connect(extAnalyser);
    updateExtEq();
  }

  // cut everything sounding + scheduled in the worklet (skip / track-change / handoff)
  function killDrums(fade){
    if(!ctx) return;
    Engine.killAll(fade||0.018);
    if(genWorkletActive) genWorkletReset(transportPaused);   // generation bump: already-queued future events die with the old generation
  }
  function beginExternalHandoff(){
    if(!ctx) return;
    var t=ctx.currentTime;
    try{
      if(typeof document!=='undefined' && document.documentElement) document.documentElement.dataset.rrrAudioHandoff=String(Date.now());
      if(typeof window!=='undefined') window.__rrrAudioHandoff={t:Date.now(), from:'generated'};
    }catch(e){}
    if(genGain&&genGain.gain){ holdParam(genGain.gain,t); genGain.gain.setTargetAtTime(0.0001,t,0.006); }
    killDrums(0.018);
    if(master&&master.gain){
      holdParam(master.gain,t);
      master.gain.linearRampToValueAtTime(0.0001,t+0.012);
      master.gain.setTargetAtTime(masterTargetGain(),t+0.045,0.025);
    }
  }

  function ensureGbChip(){
    if(!ctx || gbReady) return gbReady;
    if(!ctx.audioWorklet || typeof AudioWorkletNode==='undefined') return null;
    gbReady = ctx.audioWorklet.addModule(GB_WORKLET_URL).then(function(){
      gbNode = new AudioWorkletNode(ctx, GB_WORKLET_NAME, {numberOfInputs:0, numberOfOutputs:1, outputChannelCount:[2]});
      gbNode.connect(gbChipGain);
      gbNode.port.onmessage = function(ev){
        if(ev.data && ev.data.type==='stat' && typeof window!=='undefined') window.__rrrChip = ev.data;
        if(ev.data && ev.data.type==='msgError'){ try{ console.error('[chiptunes] chip message failed:', ev.data.in, ev.data.message); }catch(_){} }
      };
      // A track may have started before the module finished loading; play it now.
      if(gbPending){ gbNode.port.postMessage(gbPending); gbPending=null; }
      if(typeof document!=='undefined' && document.documentElement) document.documentElement.dataset.rrrChip='gb';
    }).catch(function(e){
      // Falling back silently is how this project has lost a feature before, so say it.
      try{ console.error('[chiptunes] Game Boy chip unavailable, falling back to the event synth:', e&&e.message||e); }catch(_){}
      gbNode=null;
      if(ctx) { try{ gbSynthGain.gain.value=1; gbChipGain.gain.value=0; }catch(_){}}
      gbActive=false;
    });
    return gbReady;
  }
  // Hand a score to the chip. Everything else about the deck -- sections, energy,
  // the beat events the games read -- keeps running off the event scheduler; only
  // the SOUND moves.
  // Who owns the chip. The radio's scheduler reposts its score on every track
  // handover and live-sync seek; while the Create editor (or the ROM page)
  // holds the chip, those reposts must bounce off or the radio steals the
  // speaker back mid-composition.
  var chipOwner='radio';
  function gbPlay(score, offsetFrames, paused, leadSec){
    if(chipOwner!=='radio') return false;
    var gb = score && score.gb;
    var on = !!(gb && gb.notes && gb.notes.length);
    gbActive = on;
    if(ctx && gbSynthGain && gbChipGain){
      var t=ctx.currentTime;
      // crossfade rather than switch: a hard gain step on a running graph clicks
      gbSynthGain.gain.setTargetAtTime(on?0.0001:1.0, t, 0.01);
      gbChipGain.gain.setTargetAtTime(on?1.0:0.0001, t, 0.01);
    }
    if(!on){ if(gbNode) gbNode.port.postMessage({type:'stop'}); return false; }
    // the WHOLE song: automation, wave swaps, vibrato hand-offs and kit hits are
    // as much the music as the note-ons (playCreate had the same omission)
    var msg = {type:'play', gb:{notes:gb.notes, bank:gb.bank, totalFrames:gb.totalFrames,
                                auto:gb.auto||null, vibOff:gb.vibOff||null,
                                waveLoads:gb.waveLoads||null, kit:gb.kit||null},
               offsetFrames:Math.max(0, offsetFrames|0), paused:!!paused,
               rate:chipRate(), mix:Object.assign({}, MIX),
               // Decks open 0.18s in the future so the scheduler has lead time.
               // The chip has to wait the same amount or the picture runs 180ms
               // ahead of the sound, which for a beat-driven game is the whole
               // point of the thing being wrong.
               leadSec:Math.max(0, +leadSec || 0)};
    ensureGbChip();
    if(gbNode) gbNode.port.postMessage(msg); else gbPending=msg;
    return true;
  }
  function gbSetPaused(paused){ if(gbNode) gbNode.port.postMessage({type:'pause', paused:!!paused}); }
  // The chip's tempo is a playback rate: pinned bpm over the track's native
  // bpm. The deck is retimed with the same ratio, so the score's end and the
  // deck's endTime stay the same instant and the handover never gaps.
  function chipRate(){
    if(!deckCur || !deckCur.nativeBpm) return 1;
    return Math.max(0.25, Math.min(4, (deckCur.bpm||deckCur.nativeBpm)/deckCur.nativeBpm));
  }
  function gbSetRate(){ if(gbNode) gbNode.port.postMessage({type:'rate', rate:chipRate()}); }
  function gbSetMix(){ if(gbNode) gbNode.port.postMessage({type:'mix', mix:Object.assign({}, MIX)}); }
  // TRY IT ON A GAME BOY. Hand the chip the exported cartridge instead of the
  // score and it runs the 8-bit code: the register writes now come from the
  // driver executing on an emulated LR35902, not from a sequencer. Same APU
  // either way, which is exactly the claim being demonstrated.
  var gbRomMode = false;
  function gbPlayRom(bytes){
    chipOwner='rom';
    if(!bytes) return false;
    gbRomMode = true;
    var msg = {type:'rom', bytes:bytes, paused:transportPaused};
    // A cold load of /gameboy arrives before the worklet module has finished
    // loading. Queue it the way the score path already does rather than
    // refusing -- the emulator screen opens and the sound joins a moment later.
    ensureGbChip();
    if(!gbNode){ gbPending = msg; }
    else gbNode.port.postMessage(msg, [bytes.buffer]);
    if(ctx && gbSynthGain && gbChipGain){
      var t=ctx.currentTime;
      gbSynthGain.gain.setTargetAtTime(0.0001, t, 0.01);
      gbChipGain.gain.setTargetAtTime(1.0, t, 0.01);
    }
    return true;
  }
  // Back to the composition, from wherever the track has got to, so leaving the
  // cartridge does not restart the song.
  function gbPlayScore(){
    if(chipOwner!=='radio') return;
    gbRomMode = false;
    if(!gbNode || !deckCur) return false;
    gbNode.port.postMessage({type:'score'});
    var off = ctx ? Math.max(0, ctx.currentTime - deckCur.origin) : 0;
    var fps = (typeof CT_GB_HARDWARE!=='undefined') ? CT_GB_HARDWARE.FPS : 59.7275;
    gbPlay(deckCur.score, Math.round(off*fps), transportPaused, 0);
    return true;
  }

  function ensureGeneratedWorklet(){
    if(!ctx || genWorkletReady) return genWorkletReady;
    if(!ctx.audioWorklet || typeof AudioWorkletNode==='undefined'){
      if(typeof document!=='undefined' && document.documentElement) document.documentElement.dataset.rrrGenOutput='none';
      return null;
    }
    genWorkletReady = ctx.audioWorklet.addModule(WORKLET_URL).then(function(){
      genWorkletNode = new AudioWorkletNode(ctx, WORKLET_NAME, {numberOfInputs:0, numberOfOutputs:1, outputChannelCount:[2]});
      genWorkletNode.port.onmessage = function(ev){
        genWorkletStats = ev.data || null;
        if(typeof window!=='undefined') window.__rrrGeneratedWorklet = genWorkletStats;
      };
      genWorkletNode.connect(gbSynthGain);
      genWorkletActive = true;
      genWorkletReset(transportPaused);
      genWorkletSetMix();
      // Decks minted before the worklet came up never reached the audio thread: re-key them onto
      // fresh post-reset generations, BEFORE any scheduler pass runs. Normally restart from the top;
      // in LIVE mode the deck was built at a mid-track offset (back-dated origin via startTrackAtOffset)
      // and MUST keep its position — restarting from 0 would play the on-air track from the top for
      // ~5s before the drift tick snaps it, so preserve origin and fast-forward the cursor to "now".
      if(deckCur){
        deckCur.generation=Engine.newGeneration(); deckCur.paletteSent=false;
        if(_liveMode && ctx){
          var _bp=Math.max(0,(ctx.currentTime-deckCur.origin)/deckCur.spb), _evs=deckCur.events, _ci=0;
          while(_ci<_evs.length && evNum(_evs[_ci].tBeat,_evs[_ci].t) < _bp) _ci++;
          deckCur.cursor=_ci;
        } else {
          deckCur.cursor=0;
          if(ctx) retimeDeckOrigin(deckCur, ctx.currentTime+0.12);
        }
      }
      if(deckNext){
        deckNext.generation=Engine.newGeneration(); deckNext.paletteSent=false; deckNext.cursor=0;
        if(deckCur) retimeDeckOrigin(deckNext, deckCur.endTime);
      }
      setBackgroundAudioOnly(backgroundAudioOnly);
      if(typeof document!=='undefined' && document.documentElement) document.documentElement.dataset.rrrGenOutput='worklet';
      if(started) scheduler();
      return true;
    }).catch(function(e){
      genWorkletActive = false;
      if(typeof document!=='undefined' && document.documentElement){
        document.documentElement.dataset.rrrGenOutput='none';
        document.documentElement.dataset.rrrGenWorkletError=String(e&&e.message||e).slice(0,160);
      }
      diag('workletError', String(e&&e.message||e));
      return false;
    });
    return genWorkletReady;
  }

  /* ---------------- tempo deck ---------------- */
  let spb = 60/128, step16 = spb/4, barLen = step16*16;
  let genTempoBaseBpm = 128, tempoPitchRatio = 1;   // DJ-deck pitch: manual BPM = target/native, AUTO = 1x
  let beatOrigin = 0;
  let transportPaused = false, pausedGridSnap = null, pausedClockSnap = null, pausedAtMs = 0;
  let musHue = 0.5, musPulse = 0;
  let energy = 0;
  let _genVisLast = null, _genVisT = -1, _genAna = {};

  let timer = null, schedWorker = null, _visBound = false;
  let backgroundAudioOnly = false, _bgVisLast = null, _bgVisT = -1, schedPeriod = 25, _schedLastWall = 0, _schedDiag = {};
  let LOOKAHEAD = 0.3;                       // seconds of audio scheduled ahead
  const LOOKAHEAD_FG = 0.3;
  const LOOKAHEAD_BG = 18.0;                 // hidden/unfocused tab: deep horizon so throttled timers can't starve playback
  const LOOKAHEAD_WORKLET_FG = 18.0;         // generated-worklet score horizon: sparse events, rendered on the audio thread
  const LOOKAHEAD_WORKLET_BG = 45.0;         // background generated radio gets a deep score horizon
  const TICK = 25;
  const TICK_BG = 500;
  const TICK_WORKLET_FG = 250;
  const TICK_WORKLET_BG = 5000;
  function clampBpm(b){ b=+b; return (isFinite(b)&&b>=50&&b<=240) ? Math.round(b) : 0; }
  function normTrackBpm(b, prev){
    b=+b; if(!isFinite(b)||b<=0) return 0;
    var cand=[b,b*2,b/2], best=0, bd=1e9, target=prev||128;
    for(var i=0;i<cand.length;i++){
      var c=cand[i]; if(c<55||c>220) continue;
      if(!prev){ while(c<82 && c*2<=220)c*=2; while(c>188 && c/2>=55)c/=2; }
      var d=Math.abs(c-target); if(d<bd){ bd=d; best=c; }
    }
    return clampBpm(best||b);
  }
  function nativeTrackBpm(){
    if(extMode) return clampBpm((_bd&&(_bd.nativeBpm||_bd.seedBpm))||0);
    return clampBpm((deckCur&&deckCur.nativeBpm) || genTempoBaseBpm || Math.round(60/(spb||0.5)));
  }
  function setPitchForTempo(targetBpm){
    var base=nativeTrackBpm() || clampBpm(targetBpm) || Math.round(60/(spb||0.5)) || 128;
    var r=base ? (+targetBpm/base) : 1;
    tempoPitchRatio=Math.max(0.25, Math.min(4, isFinite(r)?r:1));
  }
  function pitchFreq(f){
    f=(+f||0) * (tempoPitchRatio||1);
    return Math.max(20, Math.min(20000, f||20));
  }

  /* ---------------- scheduler CLOCK (Web Worker, background-proof) ---------------- */
  // The clock runs in a Worker: its setInterval keeps firing at ~25ms even when the tab is BACKGROUNDED,
  // where the main thread's setInterval is throttled to ~1/sec. Falls back to a main-thread interval.
  function gestureUnlockTick(){
    if(!ctx) return;
    try{
      var b=ctx.createBuffer(1, 1, ctx.sampleRate||44100);
      var s=ctx.createBufferSource(), g=ctx.createGain();
      g.gain.value=0;
      s.buffer=b; s.connect(g); g.connect(ctx.destination);
      s.start(0);
      try{ s.stop(ctx.currentTime+0.02); }catch(e){}
    }catch(e){}
  }
  function resumeCtx(force){
    function rdiag(o){
      if(typeof window!=='undefined') window.__rrrAudioResume = o;
      if(typeof document!=='undefined' && document.documentElement) document.documentElement.dataset.rrrResume = JSON.stringify(o);
    }
    // The context is already running almost every time this is called -- the
    // editor calls it before every audition, and auditions happen on hover.
    // Leave EARLY and silently: the diagnostic below stringifies and writes a
    // dataset attribute, which invalidates style on the document element, and
    // paying that dozens of times a second is what "sluggish" is made of.
    if(ctx && ctx.state==='running') return null;
    rdiag({ state:ctx&&ctx.state, force:!!force, paused:!!transportPaused, t:Date.now(), attempt:true });
    if(!ctx || transportPaused || ctx.state==='running' || !ctx.resume){
      rdiag({ state:ctx&&ctx.state, force:!!force, paused:!!transportPaused, t:Date.now(), skipped:!ctx?'no-context':transportPaused?'paused':(ctx.state==='running')?'running':'no-resume' });
      return null;
    }
    try{
      if(force) gestureUnlockTick();
      rdiag({ state:ctx.state, force:!!force, paused:!!transportPaused, t:Date.now(), called:true });
      const p=ctx.resume();
      if(p&&p.then) p.then(function(){ rdiag({ state:ctx.state, ok:true, force:!!force, paused:!!transportPaused, t:Date.now() }); });
      if(p&&p.catch) p.catch(function(err){ rdiag({ state:ctx.state, ok:false, error:String(err&&err.message||err), force:!!force, paused:!!transportPaused, t:Date.now() }); });
      return p;
    }catch(e){
      rdiag({ state:ctx&&ctx.state, ok:false, error:String(e&&e.message||e), force:!!force, paused:!!transportPaused, t:Date.now() });
    }
    return null;
  }
  function setSchedClockPeriod(ms){
    schedPeriod = Math.max(25, ms|0);
    if(schedWorker){ try{ schedWorker.postMessage({start:schedPeriod}); }catch(e){} }
    else if(timer){ clearInterval(timer); timer = setInterval(schedTick, schedPeriod); }
    publishSchedClock(!!(schedWorker||timer), (schedWorker||timer)?'period':(extMode?'external':'period'));
  }
  function setBackgroundAudioOnly(on){
    on = !!on;
    backgroundAudioOnly = on;
    LOOKAHEAD = genWorkletActive ? (on ? LOOKAHEAD_WORKLET_BG : LOOKAHEAD_WORKLET_FG) : (on ? LOOKAHEAD_BG : LOOKAHEAD_FG);
    setSchedClockPeriod(genWorkletActive ? (on ? TICK_WORKLET_BG : TICK_WORKLET_FG) : (on ? TICK_BG : TICK));
    if(on){
      events.length = 0;                      // hidden tabs do not need note/screen events queued for visuals
      _genVisLast = null; _genVisT = -1;
      _bgVisLast = null; _bgVisT = -1;
      if(started) scheduler();
    } else {
      _bgVisLast = null; _bgVisT = -1;
      _genVisLast = null; _genVisT = -1;
      if(started){ scheduler(); resumeCtx(); }
      flushBackgroundTrackPublish();
    }
    return backgroundAudioOnly;
  }
  function shouldBackgroundAudioOnly(){
    if(typeof document==='undefined') return false;
    // Only a truly hidden page (minimised / other tab / occluded) goes background-audio-only; a visible
    // but unfocused window keeps full foreground audio + visuals (park it on the side and watch).
    return !!document.hidden;
  }
  function schedTick(){ scheduler(); if(ctx && ctx.state==='suspended') resumeCtx(); }
  function startSchedClock(){
    stopSchedClock();
    try {
      var src = 'var t=null;onmessage=function(e){var d=e.data;if(d&&d.start){if(t)clearInterval(t);t=setInterval(function(){postMessage(0);},d.start);}else if(d==="stop"){if(t)clearInterval(t);t=null;}};';
      schedWorker = new Worker(URL.createObjectURL(new Blob([src], {type:'application/javascript'})));
      schedWorker.onmessage = function(){ schedTick(); };
      schedWorker.postMessage({start:schedPeriod || TICK});
    } catch(e){ schedWorker = null; timer = setInterval(schedTick, schedPeriod || TICK); }
    publishSchedClock(true, schedWorker?'worker':'timer');
  }
  function stopSchedClock(){
    if(schedWorker){ try{ schedWorker.postMessage('stop'); schedWorker.terminate(); }catch(e){} schedWorker=null; }
    if(timer){ clearInterval(timer); timer=null; }
    publishSchedClock(false, extMode?'external':'stop');
  }
  function publishSchedClock(active, reason){
    if(typeof window!=='undefined') window.__rrrSchedClock = {
      active:!!active, reason:reason||'', period:schedPeriod||0, ext:!!extMode, bg:!!backgroundAudioOnly, t:Date.now()
    };
  }

  // audio-timed events handed to the visuals for tight A/V sync
  const events = [];
  function pushAudioEvent(ev){ if(!backgroundAudioOnly) events.push(ev); }
  // every sound emits a visual blip; hy = on-screen height from frequency (high pitch -> top)
  const freqHy = f => Math.max(0, Math.min(1, (Math.log2(f)-6)/5));   // ~64Hz -> 0 .. ~2kHz -> 1
  const emitSnd = (when, hy, gain) => { musHue += (hy - musHue)*0.05; pushAudioEvent({t:when, kind:'snd', hy, g:Math.max(0.15,Math.min(1,gain))}); };

  function init(opts){
    if(started) return;                       // idempotent — never spin up a 2nd AudioContext or scheduler
    opts=opts||{};
    const AudioCtor = window.AudioContext||window.webkitAudioContext;
    try{ ctx = new AudioCtor({latencyHint:'playback'}); }
    catch(e){ ctx = new AudioCtor(); }
    master = ctx.createGain(); master.gain.value = masterTargetGain();   // headroom into the leveler
    // MASTER VOICING EQ — measured against the owner's reference records
    // (Chipzel/Disasterpeace): at equal RMS the renders carried HALF the refs'
    // presence-mid share (600-2500Hz: 8% vs 17%) and 6x their >8kHz air (9% vs
    // 1.5% — real chip hardware rolls off up there). Presence bell + air shelf
    // close exactly that gap. MUST stay identical to the offline render chain
    // in Engine.render.
    var presEq = ctx.createBiquadFilter(); presEq.type='peaking';
    presEq.frequency.value=1200; presEq.Q.value=0.8; presEq.gain.value=3.5;
    var airEq = ctx.createBiquadFilter(); airEq.type='highshelf';
    airEq.frequency.value=8000; airEq.gain.value=-6;
    comp = ctx.createDynamicsCompressor();                   // RADIO LEVELER: gentle soft-knee, slow-ish attack (no pumping)
    comp.threshold.value=-24; comp.knee.value=10; comp.ratio.value=3;
    comp.attack.value=0.01; comp.release.value=0.25;
    var makeup = ctx.createGain(); makeup.gain.value = 1.9;  // POST-comp makeup -> full broadcast level (renders sat 2.7dB under the refs' ceiling at 1.7)
    var limiter = ctx.createDynamicsCompressor();            // BRICK-WALL limiter -> no clipping/crackle
    limiter.threshold.value=-1.5; limiter.knee.value=0; limiter.ratio.value=20;
    limiter.attack.value=0.002; limiter.release.value=0.06;
    genGain = ctx.createGain(); genGain.gain.value = 1.0;    // GENERATIVE sub-mix -> muted when an EXTERNAL source drives instead
    genGain.connect(master);
    // Two sources feed the generative sub-mix and exactly one of them is audible
    // at a time: the event synth (chip albums, mic-driven visuals, any score with
    // no gb data) and the DMG chip (every generated track).
    gbSynthGain = ctx.createGain(); gbSynthGain.gain.value = 1.0; gbSynthGain.connect(genGain);
    gbChipGain  = ctx.createGain(); gbChipGain.gain.value  = 0.0; gbChipGain.connect(genGain);
    master.connect(presEq); presEq.connect(airEq); airEq.connect(comp);
    comp.connect(makeup); makeup.connect(limiter);   // master -> EQ -> leveler -> makeup -> limiter -> out
    masterOut = limiter;   // the post-everything node (== what listeners hear); the broadcaster's video leg taps this
    // Mobile: output through a MediaStream -> a playing <audio> element (runtime _syncMediaAnchor binds it)
    // so audio survives a screen lock / backgrounded tab. Desktop keeps the raw destination (already fine).
    _outStreamDest = null;
    try{
      var _ua=(typeof navigator!=='undefined' && navigator.userAgent)||'';
      var _mobile=/iPhone|iPad|iPod|Android/i.test(_ua) || ((navigator.maxTouchPoints||0)>1 && /Macintosh/.test(_ua));
      if(_mobile && ctx.createMediaStreamDestination) { _outStreamDest=ctx.createMediaStreamDestination(); limiter.connect(_outStreamDest); }
    }catch(e){ _outStreamDest=null; }
    if(!_outStreamDest) limiter.connect(ctx.destination);   // desktop / unsupported: raw output
    try{ _masterAna=ctx.createAnalyser(); _masterAna.fftSize=2048; _masterAna.smoothingTimeConstant=0.5; master.connect(_masterAna); }catch(e){}   // SPECTRUM tap (a sink, doesn't alter the signal)
    ensureGeneratedWorklet();

    started = true;
    beatOrigin = ctx.currentTime + 0.08;
    if(opts.external) playExternal(null, typeof opts.external==='object' ? opts.external : {source:'external'});
    if(!extMode) startSchedClock();           // Generated music owns this clock. External/chip playback has its own output path.
    if(shouldBackgroundAudioOnly()) setBackgroundAudioOnly(true);
    if(!_visBound && typeof document!=='undefined' && document.addEventListener){
      _visBound = true;
      document.addEventListener('visibilitychange', function(){
        const bg = shouldBackgroundAudioOnly();
        setBackgroundAudioOnly(bg);
        if(!bg) resumeCtx();
        if(started) scheduler();              // fill the (now larger) horizon immediately on hide, or rebase on show
      });
      if(typeof window!=='undefined' && window.addEventListener){
        window.addEventListener('blur', function(){ setBackgroundAudioOnly(true); if(started) scheduler(); });
        window.addEventListener('focus', function(){ const bg=shouldBackgroundAudioOnly(); setBackgroundAudioOnly(bg); if(!bg) resumeCtx(); if(started) scheduler(); });
      }
    }
  }

  /* ============================================================
     PLAYBACK ADAPTER — token -> Score -> worklet events.
     A DECK is one compiled Score anchored at an absolute ctx time:
       { tok, score, fp, generation, nativeBpm, bpm, spb, origin, totalBeats,
         endTime, cursor, sections, chords, paletteSent }
     deckCur plays; deckNext is pre-compiled and scheduled to cold-open on the
     boundary (gapless: fresh generation palette, old echo line drains).
     ============================================================ */
  let deckCur=null, deckNext=null, curTok=null, curSec=null;
  let _mintN=0, _autoRetryAt=0;
  // MusicalNow — the harmony/motif state gameMelodyNote/reactNote answer in key with
  const mnow = { scale:[0,2,4,5,7,9,11], rootMidi:60, chordOffset:0, chordPcs:null, motifDegs:[0,2,4,2,7,4,2,0], motifIdx:0, register:0, leadHint:'lead' };

  function activeComposerSafe(){
    try{ if(typeof activeComposer==='function'){ var c=activeComposer(); if(c && typeof c.compile==='function') return c; } }catch(e){}
    var R=(typeof window!=='undefined' && window.CT_COMPOSERS) || null;
    if(R){ var ks=Object.keys(R); if(R.rrr_core && typeof R.rrr_core.compile==='function') return R.rrr_core;
      for(var i=0;i<ks.length;i++) if(R[ks[i]] && typeof R[ks[i]].compile==='function') return R[ks[i]]; }
    return null;
  }
  function mintTok(){
    var t='';
    if(_mintTokenCb){ try{ t=String(_mintTokenCb()||''); }catch(e){ t=''; } }
    if(!t) t='mix-'+(Date.now()%1000000)+'-'+(_mintN++);
    return t;
  }
  function evNum(a, b){ return (a!=null && isFinite(+a)) ? +a : ((b!=null && isFinite(+b)) ? +b : 0); }
  function scoreTotalBeats(score){
    if(!score) return 16;
    var b = score.totalBeats!=null ? +score.totalBeats
          : score.beats!=null ? +score.beats
          : score.totalBars!=null ? (+score.totalBars)*4
          : score.bars!=null ? (+score.bars)*4 : 0;
    if(!(b>0)){
      var evs=score.events||[], end=0;
      for(var i=0;i<evs.length;i++){ var e=evs[i], t=evNum(e.tBeat, e.t)+(e.durBeat!=null?+e.durBeat:0); if(t>end) end=t; }
      b=Math.ceil(end/4)*4;
    }
    return Math.max(16, b||16);
  }
  // section role vocabulary: composers emit the mapped names; map composer-internal names defensively.
  const SECT_MAP = { HOOK:'groove', DEV:'flow', CONTRAST:'bridge', STRIP:'break', BUILD:'build', PEAK:'drop', LIFT:'drop', OUT:'outro' };
  function normalizeSections(score){
    var src=(score && (score.sections||score.form))||[], out=[], acc=0;
    for(var i=0;i<src.length;i++){
      var s=src[i]||{}, bars=+(s.bars!=null?s.bars:s.len)||0;
      var role=String(s.role||s.type||'groove');
      role=SECT_MAP[role]||SECT_MAP[role.toUpperCase()]||role.toLowerCase();
      out.push({ role:role, e:(s.e!=null?+s.e:(s.energy!=null?+s.energy:5)), bars:bars, startBar:(s.startBar!=null?+s.startBar:acc), musical:s.musical||null });
      acc=out[i].startBar+bars;
    }
    return out;
  }
  // chord timeline: meta events {kind:'chord'|'meta', tBeat, chordOffset?, chordPcs?} (never sent to the worklet)
  function chordTimeline(score){
    var evs=(score&&score.events)||[], out=[];
    for(var i=0;i<evs.length;i++){
      var e=evs[i];
      if(e && (e.kind==='chord'||e.kind==='meta') && (e.chordOffset!=null||e.chordPcs!=null))
        out.push({ t:evNum(e.tBeat, e.t), chordOffset:e.chordOffset||0, chordPcs:e.chordPcs||null });
    }
    out.sort(function(a,b){ return a.t-b.t; });
    return out;
  }
  // LIVE mode (the shared clock schedule, src/live.js). While live: tempo pins are bypassed
  // (a pin re-times the deck and drifts this client off the shared schedule — the runtime
  // forks to private on pin anyway; this is belt-and-braces), the composer is routed by the
  // schedule's PINNED id (never activeComposer() — a custom composer pack must not put a live
  // listener in a parallel universe), and prepareNextDeck wall-anchors each track boundary
  // via the sync hook (resets audio-clock-vs-wall skew every track).
  var _liveMode=false, _liveComposerGet=null, _liveSyncFn=null;
  function setLiveMode(on, composerGet, syncFn){
    _liveMode=!!on; _liveComposerGet=(on&&composerGet)||null; _liveSyncFn=(on&&syncFn)||null;
  }
  function compileScore(tok){
    var C=null;
    if(_liveMode && _liveComposerGet){ try{ C=_liveComposerGet(tok); }catch(e){ C=null; } }
    if(!C) C=activeComposerSafe();
    if(!C){ diag('compile', {tok:tok, err:'no composer registered', t:Date.now()}); return null; }
    try{
      var score=C.compile(tok);
      if(!score || !score.events || !score.events.length) throw new Error('empty score');
      // THE STATION PLAYS CREATE'S SONGS. The composer writes a Score; Create
      // turns it into a document -- the same import the editor does -- and the
      // chip plays THAT. So what you hear is exactly what opens in the editor,
      // note for note, rather than something near it. The Score stays for the
      // visuals, the sections and the games, which read events, not notes.
      try{
        if(typeof CT_CREATE!=='undefined' && CT_CREATE.songFrom){
          // the name goes IN, so a shared song keeps the name it was shared under
          var nm=''; try{ nm=(typeof Song!=='undefined'&&Song.title)?Song.title(tok):''; }catch(eN){}
          var doc=CT_CREATE.songFrom(score, nm);
          if(doc && doc.gb && doc.gb.notes && doc.gb.notes.length){ score.gb=doc.gb; score.doc=doc.code; }
        }
      }catch(docErr){ diag('compile', {tok:tok, doc:String(docErr&&docErr.message||docErr)}); }
      var fp=null; try{ fp=C.fingerprint ? C.fingerprint(tok) : null; }catch(e2){ fp=null; }
      return { tok:tok, score:score, fp:fp };
    }catch(e){
      diag('compile', {tok:tok, err:String(e&&e.stack||e), t:Date.now()});
      return null;
    }
  }
  function pinnedTempo(){
    if(_liveMode) return null;   // live durations must run at native bpm or the client drifts within one track
    return (typeof Radio!=='undefined' && Radio.state && Radio.state.tempo!=null) ? Radio.state.tempo : null;
  }
  function mkDeck(cs, origin, generation){
    var score=cs.score;
    var native=clampBpm(score.bpm)||128;
    var pin=pinnedTempo();
    var bpm=(pin!=null && clampBpm(pin)) ? clampBpm(pin) : native;
    var evs=(score.events||[]).slice().sort(function(a,b){ return evNum(a.tBeat,a.t)-evNum(b.tBeat,b.t); });
    var beats=scoreTotalBeats(score);
    var d={ tok:cs.tok, score:score, events:evs, fp:cs.fp, generation:generation,
      nativeBpm:native, bpm:bpm, spb:60/bpm, origin:origin, totalBeats:beats,
      endTime:origin + beats*(60/bpm), cursor:0, sections:normalizeSections(score),
      chords:chordTimeline(score), paletteSent:false,
      // per-track density duck (0.55..1): the composer computes it for every
      // Score but nothing consumed it — the densest tracks played up to +5dB
      // hotter than designed. Applied to every event vel in deckEventToWorklet.
      velScale:(score.gainScalar>0 && score.gainScalar<=1) ? score.gainScalar : 1 };
    return d;
  }
  function retimeDeckOrigin(d, origin){ d.origin=origin; d.endTime=origin + d.totalBeats*d.spb; }
  function retimeDeckTempo(d, bpm, now){
    bpm=clampBpm(bpm)||d.nativeBpm;
    var beatPos=Math.max(0,(now-d.origin)/d.spb);
    d.bpm=bpm; d.spb=60/bpm;
    d.origin=now - beatPos*d.spb;
    d.endTime=d.origin + d.totalBeats*d.spb;
    // rewind the cursor to the first event at/after "now" under the new timing
    var evs=d.events, i=0;
    while(i<evs.length && evNum(evs[i].tBeat, evs[i].t) < beatPos) i++;
    d.cursor=i;
  }
  function setGridTempo(bpm){                        // the games' continuous visual grid (beatOrigin) — never rewinds
    bpm=clampBpm(bpm)||128;
    var gn=(ctx?gridNow().gstep:0);
    spb=Math.max(60/240,Math.min(60/55,60/bpm)); step16=spb/4; barLen=step16*16;
    setPitchForTempo(bpm);
    if(ctx) beatOrigin=ctx.currentTime - gn*step16;
    _genVisLast=null; _genVisT=-1; _bgVisLast=null; _bgVisT=-1;   // a tempo change is visible on the very next vis() read
  }
  // translate one Score event to a worklet WEvent at absolute time t (returns null for meta events)
  // Translate a composer Score event -> the worklet's flat WEvent schema. The composer emits
  // { tBeat, dur(beats), ch, vel, seed, midi?, artic:{...} }; the worklet reads
  // { time, dur(seconds), slot, freq, vel, seed, accent/slideSemis/arp/dutyStart/from/tie/cut/q/drive/sendEcho }.
  var _ARTIC_MAP={ accent:'accent', slide:'slideSemis', arp:'arp', dutyStart:'dutyStart',
    tie:'tie', cut:'cut', cutMul:'cutMul', q:'q', drive:'drive', sendEcho:'sendEcho' };
  function deckEventToWorklet(d, ev, t){
    if(!ev || ev.kind==='chord' || ev.kind==='meta') return null;
    var ratio=Math.max(0.25, Math.min(4, d.bpm/(d.nativeBpm||d.bpm||128)));
    // start from a copy so a composer emitting documented top-level WEvent fields (pan/from/cut/slideSemis/...)
    // keeps them; then translate the composer-native fields (ch->slot, dur beats->sec, midi->freq, artic->flat).
    var we=Object.assign({}, ev);
    delete we.tBeat; delete we.durBeat; delete we.artic; delete we.ch; delete we.midi;
    we.time=t;
    we.slot=(typeof ev.slot==='string' ? ev.slot : ev.ch) || 'lead';
    var durBeats=(ev.durBeat!=null) ? ev.durBeat : (ev.dur!=null ? ev.dur : null);
    we.dur=(durBeats!=null) ? Math.max(0.006, durBeats*d.spb) : 0.1;
    var f=(ev.freq!=null) ? +ev.freq : (ev.midi!=null ? mtof(+ev.midi) : 0);
    if(f) we.freq=Math.max(20, Math.min(20000, f*ratio));
    var a=ev.artic;
    if(a){
      for(var key in _ARTIC_MAP){ if(a[key]!=null) we[_ARTIC_MAP[key]]=a[key]; }
      if(a.from!=null){ var ff=mtof(+a.from)*ratio; if(ff) we.from=Math.max(20, Math.min(20000, ff)); }  // portamento origin (midi -> Hz)
    }
    if(d.velScale!=null && d.velScale!==1 && we.vel!=null) we.vel=we.vel*d.velScale;   // Score.gainScalar density duck
    we.generation=d.generation;
    return we;
  }
  function pushDeckEvent(d, ev, t){
    var we=deckEventToWorklet(d, ev, t);
    if(!we) return;
    genWorkletPush(we, d.generation);
    // visual hooks: percussion -> beat events for the games; melodic -> pitch-height blips (musHue driver)
    var slot=String(we.slot||'');
    var isPerc=/^(kick|snare|hat|tom|clap|perc|fx)$/.test(slot);
    if(slot.indexOf('kick')===0) pushAudioEvent({t:t, kind:'kick'});
    else if(slot.indexOf('snare')===0||slot.indexOf('clap')===0) pushAudioEvent({t:t, kind:'snare'});
    if(!isPerc && we.freq) emitSnd(t, freqHy(we.freq), (we.vel!=null?we.vel:0.08)*3.5);
  }
  function scheduleDeck(d, now, horizon){
    if(!d) return 0;
    if(!d.paletteSent){ Engine.loadPalette(d.score.palette, d.generation, d.origin, d.spb); d.paletteSent=true; }
    var evs=d.events, n=0;
    while(d.cursor<evs.length){
      var ev=evs[d.cursor], t=d.origin + evNum(ev.tBeat, ev.t)*d.spb;
      if(t>=horizon) break;
      d.cursor++;
      if(t < now-0.05) continue;              // resume-guard: OS sleep / long suspend -> skip the past, land on the live grid
      pushDeckEvent(d, ev, t);
      n++;
    }
    return n;
  }
  function sectionAt(d, bar){
    var S=d.sections||[];
    for(var i=S.length-1;i>=0;i--){ if(bar>=S[i].startBar) return S[i]; }
    return S[0]||null;
  }
  function updateMusicalNow(d, sec, beat){
    var glob=(d && d.score && d.score.musical)||{};
    var m=(sec && sec.musical)||glob;
    mnow.scale=(m.scale&&m.scale.length)?m.scale:((glob.scale&&glob.scale.length)?glob.scale:[0,2,4,5,7,9,11]);
    mnow.rootMidi=(m.rootMidi!=null)?+m.rootMidi:((glob.rootMidi!=null)?+glob.rootMidi:60);
    mnow.register=(m.register!=null)?+m.register:((glob.register!=null)?+glob.register:0);
    mnow.leadHint=m.leadHint||glob.leadHint||'lead';
    var degs=(m.motifDegs&&m.motifDegs.length)?m.motifDegs:((glob.motifDegs&&glob.motifDegs.length)?glob.motifDegs:null);
    if(degs && degs!==mnow.motifDegs){ mnow.motifDegs=degs; mnow.motifIdx=0; }
    // chord: latest timeline entry <= beat, else section/global fields
    var co=(m.chordOffset!=null)?+m.chordOffset:((glob.chordOffset!=null)?+glob.chordOffset:0);
    var pcs=m.chordPcs||glob.chordPcs||null;
    var tl=d&&d.chords;
    if(tl&&tl.length){ for(var i=tl.length-1;i>=0;i--){ if(tl[i].t<=beat){ co=tl[i].chordOffset||0; pcs=tl[i].chordPcs||pcs; break; } } }
    mnow.chordOffset=co; mnow.chordPcs=pcs;
  }
  function mnowDeg2Midi(deg){
    var sc=mnow.scale, L=sc.length||7, i=((deg%L)+L)%L, oct=Math.floor(deg/L);
    return (mnow.rootMidi||60) + oct*12 + sc[i] + (mnow.chordOffset||0);
  }
  function nextMelodyMidi(){
    var degs=mnow.motifDegs||[0];
    var d=degs.length?degs[mnow.motifIdx%degs.length]:0; mnow.motifIdx++;
    var m=mnowDeg2Midi(d)+12*(mnow.register||0);
    while(m<60)m+=12; while(m>88)m-=12;
    return m;
  }

  // ---- publish flow (unchanged contract: onSeedReset BEFORE audible, onTrackReady after) ----
  let _trackReadyCb=null, _onSeedResetCb=null, _mintTokenCb=null, _onTrackEndCb=null, _bgPendingTrackPublish=null;
  function onTrackReady(fn){ _trackReadyCb=fn; }    // fired (with the track TOKEN/slug) when a track becomes audible
  function onSeedReset(fn){ _onSeedResetCb=fn; }    // fired (with the token) just before -> runtime resets URL/session bookkeeping
  function onMintToken(fn){ _mintTokenCb=fn; }      // runtime mints each fresh track's NAME/slug (auto-advance + skip); the slug IS the seed
  function onTrackEnd(fn){ _onTrackEndCb=fn; }      // optional: observe track boundaries (the queue already feeds tokens via onMintToken)
  function publishTrackReady(tok, fp){
    if(backgroundAudioOnly){ _bgPendingTrackPublish={tok:tok, fp:fp}; return; }
    if(typeof Radio!=='undefined' && Radio.setCurrent && fp) Radio.setCurrent(Object.assign({slug:tok}, fp));
    if(_trackReadyCb){ try{ _trackReadyCb(tok); }catch(e){} }
  }
  function flushBackgroundTrackPublish(){
    if(!_bgPendingTrackPublish || backgroundAudioOnly) return;
    var p=_bgPendingTrackPublish; _bgPendingTrackPublish=null;
    publishTrackReady(p.tok, p.fp);
  }
  function announceDeck(d){
    curTok=d.tok;
    if(_onSeedResetCb){ try{ _onSeedResetCb(d.tok); }catch(e){} }
    publishTrackReady(d.tok, d.fp);
  }

  // start (or restart) playback on a token. Explicit tok = deep link / skip target; null = mint fresh.
  function startTrack(forcedTok, opts){
    opts=opts||{};
    var explicit=(forcedTok!=null && forcedTok!=='');
    var tok=explicit?String(forcedTok):mintTok();
    var cs=compileScore(tok);
    if(!cs && explicit) cs=compileScore(mintTok());   // a broken deep-link token still yields music
    if(!cs){ _autoRetryAt=(ctx?ctx.currentTime:0)+5; return null; }
    return startCompiled(cs, opts);
  }
  // Everything startTrack does once it HAS a compiled track. Split out so a
  // shared document can enter by the same door: it is a real track on the deck
  // -- visuals, games, sections, transport -- not a special case played beside
  // the station.
  function startCompiled(cs, opts){
    opts=opts||{};
    if(ctx && started){
      Engine.killAll(opts.fade!=null?opts.fade:0.12);     // manual skip = 120ms fade...
      Engine.clearFuture(ctx.currentTime+0.02);
    }
    var gen=Engine.newGeneration();                        // ...then a cold open on a fresh generation
    var origin=(ctx?ctx.currentTime:0)+0.18;
    deckCur=mkDeck(cs, origin, gen);
    gbPlay(cs.score, 0, transportPaused, origin-(ctx?ctx.currentTime:0));
    deckNext=null;
    curSec=sectionAt(deckCur,0);
    updateMusicalNow(deckCur, curSec, 0); mnow.motifIdx=0;
    setGridTempo(deckCur.bpm);
    Engine.setTempo(deckCur.spb, deckCur.bpm, gen);
    energy=Math.max(energy||0, 0.35);
    genTempoBaseBpm=deckCur.nativeBpm;
    announceDeck(deckCur);
    if(started && !extMode) scheduler();
    return deckCur.tok;
  }
  // A DOCUMENT IS A TRACK. A shared link carries the song itself rather than a
  // seed, because once a note has been moved no seed reproduces it -- so the
  // station has to be able to play one straight. The events the visuals and the
  // games read are rebuilt from the notes, which is where they came from.
  function scoreFromDoc(doc){
    var FPS=(typeof CT_GB_HARDWARE!=='undefined')?CT_GB_HARDWARE.FPS:59.7275;
    var bpm=doc.bpm||128, spb=60/bpm, evs=[];
    (doc.gb.notes||[]).forEach(function(n){
      evs.push({ kind:(n.ch===3?'perc':n.ch===2?'bass':'lead'),
                 tBeat:(n.frame/FPS)/spb, ch:n.ch,
                 midi:(n.midi==null?undefined:n.midi),
                 vel:(n.vel==null?0.8:n.vel),
                 dur:Math.max(1,n.frames||1)/FPS/spb });
    });
    var beats=Math.max(4,(doc.gb.totalFrames/FPS)/spb);
    return { bpm:bpm, events:evs, totalBars:Math.max(1,Math.round(beats/4)), totalBeats:beats,
             gb:doc.gb, doc:doc.code, title:doc.title||'', sharedDoc:true };
  }
  function playDoc(code){
    if(typeof CT_CREATE==='undefined' || !CT_CREATE.songOf) return null;
    _liveMode=false;                       // a document is nobody's broadcast but yours
    var doc=null;
    try{ doc=CT_CREATE.songOf(code); }catch(e){ doc=null; }
    if(!doc) return null;
    _sharedTitle=doc.title||'';
    // NOT the deck token: a document has none, and returning '' made every
    // successful call read as a failure to the caller that had to decide
    // whether to fall back to a random track.
    startCompiled({ tok:'', score:scoreFromDoc(doc), fp:null }, {fade:0.12});
    return (deckCur && deckCur.score === undefined) ? false : true;
  }
  var _sharedTitle='';
  // LIVE join: start a token AT an offset (seconds) — the mid-track seek for the shared
  // clock schedule. Same cold-open as startTrack (kill/clear/new generation), but the deck
  // origin is BACK-DATED so (now - origin) already equals the offset: every downstream
  // reader (sectionAt/advancePlayhead/updateMusicalNow/trackInfo) self-corrects, and the
  // cursor fast-forward is the retimeDeckTempo precedent. Join fidelity is per-note
  // deterministic (worklet voices seed per-event); sounding-note onsets before the offset
  // and the echo line's first ~2s are the accepted differences vs having played from 0.
  function startTrackAtOffset(forcedTok, offsetSec, opts){
    opts=opts||{};
    var tok=String(forcedTok||'');
    if(!tok) return null;
    var cs=compileScore(tok);
    // live join failure: caller falls back to private — never substitute a random mint (desyncs the room)
    if(!cs){ _autoRetryAt=(ctx?ctx.currentTime:0)+5; return null; }
    if(ctx && started){
      Engine.killAll(opts.fade!=null?opts.fade:0.12);
      Engine.clearFuture(ctx.currentTime+0.02);
    }
    var gen=Engine.newGeneration();
    var d=mkDeck(cs, 0, gen);
    var off=Math.max(0, Math.min(+offsetSec||0, Math.max(0, d.totalBeats*d.spb-0.5)));
    retimeDeckOrigin(d, (ctx?ctx.currentTime:0)+0.18-off);
    var beatPos=off/d.spb, evs=d.events, i=0;          // cursor fast-forward (retimeDeckTempo precedent)
    while(i<evs.length && evNum(evs[i].tBeat, evs[i].t) < beatPos) i++;
    d.cursor=i;
    deckCur=d; deckNext=null;
    // A live join starts mid-track; the chip skips to the same frame.
    gbPlay(cs.score, Math.round(off*(typeof CT_GB_HARDWARE!=='undefined'?CT_GB_HARDWARE.FPS:59.7275)), transportPaused, 0.18);
    curSec=sectionAt(deckCur, Math.floor(beatPos/4));
    updateMusicalNow(deckCur, curSec, beatPos); mnow.motifIdx=0;
    setGridTempo(deckCur.bpm);
    beatOrigin=deckCur.origin;   // games' bar counter matches the track position (grid continuity yields to the shared schedule)
    Engine.setTempo(deckCur.spb, deckCur.bpm, gen);
    energy=Math.max(energy||0, 0.35);
    genTempoBaseBpm=deckCur.nativeBpm;
    announceDeck(deckCur);
    if(started && !extMode) scheduler();
    return deckCur.tok;
  }
  function prepareNextDeck(){
    if(deckNext || !deckCur) return;
    var cs=compileScore(mintTok());
    if(!cs){ _autoRetryAt=(ctx?ctx.currentTime:0)+5; return; }
    deckNext=mkDeck(cs, deckCur.endTime, Engine.newGeneration());
    // LIVE: wall-anchor the boundary so audio-clock-vs-wall skew (~20ms/track) resets every
    // track. The hook gets the minted next token and answers with its scheduled wall start;
    // null (or an implausible anchor, e.g. the hour straddler whose successor starts at the
    // FIXED boundary long before natural end) keeps the natural gapless chain — the live
    // tick cold-opens the hour via gotoTrackAtOffset instead.
    if(_liveMode && _liveSyncFn){
      try{
        var s=_liveSyncFn(deckNext.tok);
        if(s && s.startWallMs!=null && s.nowMs!=null && ctx){
          var o=ctx.currentTime + (s.startWallMs - s.nowMs)/1000;
          if(Math.abs(o - deckCur.endTime) < 5) retimeDeckOrigin(deckNext, o);
        }
      }catch(e){}
    }
  }
  function promoteDecks(now){
    if(deckNext && now >= deckNext.origin - 0.01){
      var old=deckCur;
      deckCur=deckNext; deckNext=null;
      curSec=sectionAt(deckCur, 0);
      updateMusicalNow(deckCur, curSec, 0); mnow.motifIdx=0;
      setGridTempo(deckCur.bpm);
      genTempoBaseBpm=deckCur.nativeBpm;
      announceDeck(deckCur);
      // TELL THE CHIP. The Game Boy is the audible path (gbChipGain 1.0, the
      // event synth held at 0.0001), and it only ever learned about a track
      // through startTrack -- a deep link, a skip, a live join. A natural
      // end-of-track promotion swapped the deck, announced the new name to the
      // UI and left the chip playing a score that had ended: its sequencer ran
      // past totalFrames and rendered silence for good, while every diagnostic
      // on the muted synth path stayed green. That is the blank pause.
      if(gbActive && deckCur.score){
        gbPlay(deckCur.score, 0, transportPaused,
               Math.max(0, deckCur.origin - (ctx ? ctx.currentTime : 0)));
      }
      if(_onTrackEndCb && old){ try{ _onTrackEndCb(old.tok, deckCur.tok); }catch(e){} }
    }
  }
  function advancePlayhead(now){
    promoteDecks(now);
    var d=deckCur;
    if(!d){ curSec=null; return; }
    var beat=Math.max(0,(now-d.origin)/d.spb), bar=Math.floor(beat/4);
    var sec=sectionAt(d, bar);
    if(sec!==curSec) curSec=sec;
    updateMusicalNow(d, sec, beat);
    var target=sec ? Math.max(0.08, Math.min(1, (sec.e!=null?sec.e:5)/10)) : 0.3;
    energy += (target-energy)*0.08;
  }

  function scheduler(){
    if(!started || extMode) return;   // EXTERNAL mode: the analyser drives the visuals; nothing to generate
    const wallNow = (typeof performance!=='undefined'&&performance.now) ? performance.now() : Date.now();
    const wallGap = _schedLastWall ? wallNow - _schedLastWall : 0;
    _schedLastWall = wallNow;
    var now=ctx.currentTime, horizon=now+LOOKAHEAD;
    if(!deckCur){
      if(now>=_autoRetryAt) startTrack(null);               // radio starts itself (runtime's gotoTrack overrides with a deep link)
      if(!deckCur) return;
    }
    advancePlayhead(now);
    var scheduled=0;
    if(genWorkletUsable()){
      genWorkletBatch=[];
      try{
        scheduled+=scheduleDeck(deckCur, now, horizon);
        // GAPLESS: pre-compile the next track once the current one is fully scheduled and its end enters reach
        if(deckCur.cursor>=deckCur.events.length && !deckNext && (deckCur.endTime-now)<(LOOKAHEAD+4) && now>=_autoRetryAt) prepareNextDeck();
        if(deckNext) scheduled+=scheduleDeck(deckNext, now, horizon);
      }catch(e){
        diag('schedError', {err:String(e&&e.stack||e), t:Date.now(), tok:deckCur&&deckCur.tok});
        try{ startTrack(null, {fade:0.06}); }catch(e2){}    // safety: a broken score never wedges the radio
      }finally{
        genWorkletFlush();
      }
    }
    var aheadT=0;
    if(deckCur){
      var edge=(deckCur.cursor<deckCur.events.length)
        ? deckCur.origin + evNum(deckCur.events[deckCur.cursor].tBeat, deckCur.events[deckCur.cursor].t)*deckCur.spb
        : (deckNext ? deckNext.endTime : deckCur.endTime);
      aheadT=+(edge-now).toFixed(2);
    }
    _schedDiag = {
      t:Date.now(), bg:!!backgroundAudioOnly, wallGap:Math.round(wallGap||0), ahead:aheadT,
      lookahead:LOOKAHEAD, period:schedPeriod, events:scheduled, tok:deckCur&&deckCur.tok, next:deckNext&&deckNext.tok,
      section:curSec&&curSec.role, output:genWorkletUsable()?'worklet':'none', ctx:ctx.state, bpm:Math.round(60/(spb||0.5)),
      // The MAIN THREAD's audio clock. Every event time and every activateAt is
      // computed in this domain, and the worklet compares them against its own
      // `currentTime`. The two must agree; ctxTime vs the worklet's `now` is the
      // one measurement that says whether they do.
      ctxTime:+(ctx.currentTime||0).toFixed(2), endT:deckCur?+(deckCur.endTime||0).toFixed(2):null
    };
    if(typeof window!=='undefined') window.__rrrSched=_schedDiag;
    if(typeof document!=='undefined' && document.documentElement && !backgroundAudioOnly && wallGap>900){
      try{ document.documentElement.dataset.rrrSched=JSON.stringify(_schedDiag); }catch(e){}
    }
    // The visual loop drains `events`; cap so a stalled tab can't grow the array into a freeze.
    if(backgroundAudioOnly){ if(events.length) events.length = 0; }
    else if(events.length > 300) events.splice(0, events.length - 300);
  }

  /* ---- QUANTIZED user/game hits: input never plays off the grid ---- */
  function quantizeTime(q){
    if(!ctx) return 0;
    var t=ctx.currentTime+0.01, rel=(t-beatOrigin)/step16, gs=Math.ceil(rel);
    if(gs<0) gs=0;
    while(gs%q!==0) gs++;
    return beatOrigin+gs*step16;
  }
  const bump = a => { energy = Math.min(1, energy + (a||0.07)); };

  /* ============================================================
     ANALYSER STACK — realtime features for vis(): 24-band note spectrum,
     128-band visualizer spectrum, waveform, per-band onsets, semantic roles.
     UNIVERSAL: master analyser (generated/chip) or external analyser (mic).
     ============================================================ */
  var CAP_PROFILES = {
    chip: { kThr:1.20, sThr:1.30, hThr:1.32, floor:0.020, rel:0.115, deb:0.20, agc:0.62, latency:0.035 },
    mic:  { kThr:1.10, sThr:1.15, hThr:1.18, floor:0.010, rel:0.150, deb:0.22, agc:0.55, latency:0.035 }
  };
  var _SPEC_NB=24, _SPEC_F0=55, _SPEC_F1=10000;
  var _FULL_SPEC_NB=128, _FULL_SPEC_F0=35, _FULL_SPEC_F1=16000;
  function _waveCompute(bytes, outN){
    var n=bytes&&bytes.length; if(!n) return [];
    var N=Math.max(64,Math.min(192,outN||128)), out=new Array(N), step=n/N, dc=0, i;
    for(i=0;i<n;i++) dc += (bytes[i]-128)/128;
    dc /= n;
    for(var j=0;j<N;j++){
      var i0=Math.floor(j*step), i1=Math.max(i0+1,Math.floor((j+1)*step)), s=0,c=0;
      if(i1>n) i1=n;
      for(i=i0;i<i1;i++){ s += ((bytes[i]-128)/128)-dc; c++; }
      out[j]=Math.max(-1,Math.min(1,c?s/c:0));
    }
    return out;
  }
  // Per-frame spectrum hot path: bins are Uint8 (256 possible values) and the log band edges depend only
  // on (n, sr, N) — so cache a pow LUT + the band index tables. Bit-identical: same doubles for the same
  // inputs (POW82[k] IS Math.pow(k/255,0.82); edges computed by the same expressions, just once).
  var _POW82=null, _fsIdx=null, _fsKey='';
  function _fullSpectrumCompute(bins, n, sr, outN){
    if(!bins || !n) return [];
    var N=Math.max(64,Math.min(192,outN||_FULL_SPEC_NB));
    if(!_POW82){ _POW82=new Float64Array(256); for(var k=0;k<256;k++) _POW82[k]=Math.pow(k/255,0.82); }
    var key=n+'|'+(sr||44100)+'|'+N;
    if(key!==_fsKey){
      _fsKey=key;
      var nyq=(sr||44100)/2, hpb=nyq/n;
      var f0=Math.max(20,_FULL_SPEC_F0), f1=Math.min(_FULL_SPEC_F1,nyq*0.92);
      _fsIdx=new Int32Array(N*2);
      for(var b0=0;b0<N;b0++){
        var lo=f0*Math.pow(f1/f0,b0/N), hi=f0*Math.pow(f1/f0,(b0+1)/N);
        var a0=Math.max(1,Math.floor(lo/hpb)), a1=Math.min(n-1,Math.floor(hi/hpb));
        if(a1<a0) a1=a0;
        _fsIdx[b0*2]=a0; _fsIdx[b0*2+1]=a1;
      }
    }
    var out=new Array(N);
    for(var b=0;b<N;b++){
      var i0=_fsIdx[b*2], i1=_fsIdx[b*2+1];
      var sum=0, peak=0, c=0;
      for(var i=i0;i<=i1;i++){
        var raw=bins[i]||0, v=raw/255;
        if(v>peak) peak=v;
        sum+=_POW82[raw];
        c++;
      }
      var avg=c?sum/c:0;
      out[b]=Math.max(0,Math.min(1,avg*0.78+Math.pow(peak,0.72)*0.32));
    }
    return out;
  }
  function _specCompute(bins, n, sr){
    var t = ctx ? ctx.currentTime : 0;
    if(_specLast && t-_specT>=0 && t-_specT<0.012) return _specLast;   // once per frame (shared cache)
    _specT=t;
    if(!_specAvg){ _specAvg=new Float32Array(_SPEC_NB); _specPrev=new Float32Array(_SPEC_NB); }
    var nyq=(sr||44100)/2, hpb=nyq/n, NB=_SPEC_NB, spec=new Array(NB), ons=[], cw=0, ctot=0;
    for(var b=0;b<NB;b++){
      var lo=_SPEC_F0*Math.pow(_SPEC_F1/_SPEC_F0, b/NB), hi=_SPEC_F0*Math.pow(_SPEC_F1/_SPEC_F0,(b+1)/NB);
      var i0=Math.max(1,Math.floor(lo/hpb)), i1=Math.min(n-1,Math.floor(hi/hpb)); if(i1<i0) i1=i0;
      var s=0,c=0; for(var i=i0;i<=i1;i++){ s+=bins[i]; c++; }
      var v=c?(s/c)/255:0; spec[b]=v;
      var flux=v-_specPrev[b]; _specPrev[b]=v;
      var av=(_specAvg[b]=_specAvg[b]*0.88+v*0.12);
      if(v>av*1.5 && v>0.085 && flux>0.035) ons.push({ band:b, hi:b/(NB-1), mag:Math.min(1,v) });   // a NOTE HIT at this pitch band
      ctot+=v*b; cw+=v;
    }
    _specLast={ spectrum:spec, noteOns:ons, centroid: cw>0?(ctot/cw)/(NB-1):0.5 };
    return _specLast;
  }
  function _waveGenerated(){ if(!_masterAna) return [];
    if(!_masterTime || _masterTime.length!==_masterAna.fftSize) _masterTime=new Uint8Array(_masterAna.fftSize);
    _masterAna.getByteTimeDomainData(_masterTime);
    return _waveCompute(_masterTime, 160);
  }
  function outputProbe(){
    var now=(typeof performance!=='undefined'&&performance.now)?performance.now():Date.now();
    if(_outputProbeLast && now-_outputProbeAt>=0 && now-_outputProbeAt<100) return _outputProbeLast;
    _outputProbeAt=now;
    var rms=0, peak=0, n=0;
    if(_masterAna){
      if(!_masterTime || _masterTime.length!==_masterAna.fftSize) _masterTime=new Uint8Array(_masterAna.fftSize);
      _masterAna.getByteTimeDomainData(_masterTime);
      n=_masterTime.length;
      for(var i=0;i<n;i++){
        var x=(_masterTime[i]-128)/128, a=Math.abs(x);
        rms+=x*x; if(a>peak)peak=a;
      }
      rms=n?Math.sqrt(rms/n):0;
    }
    var ws=genWorkletStats;
    _outputProbeLast={ signal:Math.max(rms,peak*0.25), rms:rms, peak:peak,
      worklet:ws?{generation:ws.generation,queued:ws.queued,voices:ws.voices,paused:ws.paused,
        pendingGeneration:ws.pendingGeneration,pendingActivateAt:ws.pendingActivateAt,renderTimePerBlock:ws.renderTimePerBlock}:null };
    return _outputProbeLast;
  }
  function _specGenerated(){ if(!_masterAna) return { spectrum:[], noteOns:[], centroid:0.5 };
    if(!_masterFreq || _masterFreq.length!==_masterAna.frequencyBinCount) _masterFreq=new Uint8Array(_masterAna.frequencyBinCount);
    _masterAna.getByteFrequencyData(_masterFreq);
    var sr=(ctx&&ctx.sampleRate)||44100, sp=_specCompute(_masterFreq, _masterFreq.length, sr);
    sp.fullSpectrum=_fullSpectrumCompute(_masterFreq, _masterFreq.length, sr, _FULL_SPEC_NB);
    return sp;
  }
  function _bandFromBins(bins, n, f0, f1){
    if(!bins || !n) return 0;
    var hz=((ctx&&ctx.sampleRate)||44100)/2/n, i0=Math.max(1,Math.floor(f0/hz)), i1=Math.min(n-1,Math.floor(f1/hz)), s=0,c=0;
    if(i1<i0) i1=i0;
    for(var i=i0;i<=i1;i++){ s+=bins[i]||0; c++; }
    return c ? (s/c)/255 : 0;
  }
  function _generatedRealtime(gsp, wave){
    var t=ctx?ctx.currentTime:0;
    var dt=Math.min(0.1,Math.max(0.001,t-(_genAna.t||t))); _genAna.t=t;
    var bins=_masterFreq, n=bins&&bins.length;
    var bBass=_bandFromBins(bins,n,35,165), bMid=_bandFromBins(bins,n,300,2200), bHat=_bandFromBins(bins,n,5000,13000);
    var rsum=0, nt=_masterTime&&_masterTime.length;
    if(nt){ for(var j=0;j<nt;j++){ var d=(_masterTime[j]-128)/128; rsum+=d*d; } }
    var energyRaw=nt ? Math.min(1, Math.sqrt(rsum/nt)*1.85) : Math.max(0,Math.min(1,energy||0));
    _genAna.avgB=(_genAna.avgB||0)*0.94+bBass*0.06; _genAna.avgM=(_genAna.avgM||0)*0.94+bMid*0.06; _genAna.avgH=(_genAna.avgH||0)*0.92+bHat*0.08;
    var fK=bBass-(_genAna.pBass||0), fS=bMid-(_genAna.pMid||0), fH=bHat-(_genAna.pHat||0); _genAna.pBass=bBass; _genAna.pMid=bMid; _genAna.pHat=bHat;
    var onK=(bBass>_genAna.avgB*1.16 && bBass>0.018 && fK>0);
    var onS=(bMid >_genAna.avgM*1.22 && bMid >0.014 && fS>0);
    var onH=(bHat >_genAna.avgH*1.24 && bHat >0.010 && fH>0);
    _genAna.kick =onK?1:Math.max(0,(_genAna.kick ||0)-dt/0.115);
    _genAna.snare=onS?1:Math.max(0,(_genAna.snare||0)-dt/0.138);
    _genAna.hatE =onH?1:Math.max(0,(_genAna.hatE ||0)-dt/0.080);
    _genAna.bass=Math.max(bBass,(_genAna.bass||0)-dt/0.115);
    _genAna.mid=Math.max(bMid,(_genAna.mid||0)-dt/0.138);
    _genAna.trebE=Math.max(bHat,(_genAna.trebE||0)-dt/0.080);
    _genAna.agcRef=Math.max(energyRaw,(_genAna.agcRef||0.05)*0.999);
    var anaEnergy=Math.min(1, energyRaw/Math.max(0.035,_genAna.agcRef)*0.62 + energyRaw*0.22);
    _genAna.energy=(_genAna.energy||0)*0.68 + anaEnergy*0.32;
    _genAna.eSlow=(_genAna.eSlow||anaEnergy)*0.997+anaEnergy*0.003;
    _genAna.eFast=(_genAna.eFast||anaEnergy)*0.6+anaEnergy*0.4;
    var relE=_genAna.eFast/Math.max(0.02,_genAna.eSlow);
    _genAna.drop=false; if(_genAna.dropCD>0) _genAna.dropCD-=dt;
    if(relE>1.75 && _genAna.energy>0.28 && (_genAna.dropCD||0)<=0){ _genAna.drop=true; _genAna.dropCD=4.0; }
    var spec=(gsp&&gsp.fullSpectrum)||[], visual=spec;
    if(spec.length){
      var peak=0, avg=0;
      for(var si=0; si<spec.length; si++){ var sv=spec[si]||0; avg+=sv; if(sv>peak) peak=sv; }
      avg/=spec.length;
      _genAna.specRef=Math.max(peak,(_genAna.specRef||0.08)*0.995);
      var gain=Math.min(4.8, Math.max(1.0, 0.62/Math.max(0.08,_genAna.specRef||peak||0.08)));
      visual=new Array(spec.length);
      for(var vi=0; vi<spec.length; vi++) visual[vi]=Math.max(0,Math.min(1,Math.pow((spec[vi]||0)*gain,0.82)));
    }
    var visualWave=wave||[];
    if(visualWave.length){
      var wmax=0;
      for(var wi=0; wi<visualWave.length; wi++) wmax=Math.max(wmax,Math.abs(visualWave[wi]||0));
      _genAna.waveRef=Math.max(wmax,(_genAna.waveRef||0.05)*0.995);
      var wg=Math.min(12, Math.max(1, 0.42/Math.max(0.035,_genAna.waveRef||wmax||0.035)));
      var nw=new Array(visualWave.length);
      for(var wj=0; wj<visualWave.length; wj++) nw[wj]=Math.max(-1,Math.min(1,(visualWave[wj]||0)*wg));
      visualWave=nw;
    }
    var anaLevel=Math.max(1,Math.min(10,Math.round(2 + _genAna.energy*8.5 + (relE>1.2?(relE-1.2)*5:0))));
    return { energy:_genAna.energy||0, energyLevel:anaLevel,
      bands:{ bass:_genAna.bass||0, mid:_genAna.mid||0, treble:_genAna.trebE||0 },
      kick:_genAna.kick||0, snare:_genAna.snare||0, hat:_genAna.hatE||0,
      drop:_genAna.drop||false, visualSpectrum:visual, fullSpectrum:visual, waveform:visualWave };
  }
  function _emptyRole(){ return { energy:0, onset:0, hi:0.5, band:12, notes:[] }; }
  function _normSemanticNote(n, role, source){
    n=n||{};
    var hi=(typeof n.hi==='number')?n.hi:((typeof n.band==='number')?n.band/Math.max(1,_SPEC_NB-1):0.5);
    hi=Math.max(0,Math.min(1,hi));
    var band=(typeof n.band==='number')?n.band:Math.round(hi*(_SPEC_NB-1));
    return { id:n.id||null, hi:hi, band:Math.max(0,Math.min(_SPEC_NB-1,band|0)), mag:Math.max(0,Math.min(1,n.mag==null?0.35:n.mag)),
      hz:n.hz||0, stem:n.stem, channel:n.channel||null, role:role||n.role||'lead', source:source||n.source||'spectrum', native:!!n.native };
  }
  function _fallbackSemantic(notes, centroid){
    var roles={ lead:_emptyRole(), counter:_emptyRole(), bass:_emptyRole(), perc:_emptyRole(), noise:_emptyRole() };
    notes=notes||[];
    for(var i=0;i<notes.length;i++){
      var no=_normSemanticNote(notes[i], 'lead', 'spectrum');
      if(no.band<=4){ roles.bass.notes.push(_normSemanticNote(notes[i], 'bass', 'spectrum')); roles.bass.energy=Math.max(roles.bass.energy,no.mag); }
      else { roles.lead.notes.push(no); roles.lead.energy=Math.max(roles.lead.energy,no.mag); }
    }
    roles.lead.notes.sort(function(a,b){ return b.mag-a.mag; }); if(roles.lead.notes.length>8) roles.lead.notes.length=8;
    roles.bass.notes.sort(function(a,b){ return b.mag-a.mag; }); if(roles.bass.notes.length>4) roles.bass.notes.length=4;
    if(roles.lead.notes.length){ roles.lead.onset=1; roles.lead.hi=roles.lead.notes[0].hi; roles.lead.band=roles.lead.notes[0].band; }
    else { roles.lead.hi=centroid==null?0.5:centroid; roles.lead.band=Math.round(roles.lead.hi*(_SPEC_NB-1)); }
    if(roles.bass.notes.length){ roles.bass.onset=1; roles.bass.hi=roles.bass.notes[0].hi; roles.bass.band=roles.bass.notes[0].band; }
    roles.primary=roles.lead; roles.melody=roles.lead;
    return roles;
  }
  function _normalizeSemanticFrame(frame){
    var out={ source:(frame&&frame.source)||'external', roles:{} }, src=out.source, roles=(frame&&frame.roles)||{};
    ['lead','counter','bass','perc','noise','pad'].forEach(function(k){
      var r=roles[k]||{}, o=_emptyRole(), ns=r.notes||[];
      o.energy=Math.max(0,Math.min(1,r.energy||0)); o.onset=Math.max(0,Math.min(1,r.onset||0));
      for(var i=0;i<ns.length;i++) o.notes.push(_normSemanticNote(ns[i], k, src));
      if(o.notes.length){ o.notes.sort(function(a,b){ return b.mag-a.mag; }); o.hi=o.notes[0].hi; o.band=o.notes[0].band; o.energy=Math.max(o.energy,o.notes[0].mag); o.onset=Math.max(o.onset,o.notes[0].mag); }
      else { o.hi=(r.hi==null?0.5:r.hi); o.band=(r.band==null?Math.round(o.hi*(_SPEC_NB-1)):r.band); }
      out.roles[k]=o;
    });
    out.roles.primary=out.roles.lead; out.roles.melody=out.roles.lead;
    out.t=ctx?ctx.currentTime:0;
    return out;
  }
  function _semanticRoles(fallbackNotes, centroid){
    var roles=_fallbackSemantic(fallbackNotes||[], centroid);
    var now=ctx?ctx.currentTime:0;
    if(_semanticFrame && now-(_semanticFrame.t||0)<0.34){
      var nativeRoles=_semanticFrame.roles||{};
      ['lead','counter','bass','perc','noise','pad'].forEach(function(k){
        var nr=nativeRoles[k]; if(!nr) return;
        if(nr.notes&&nr.notes.length) roles[k]=nr;
        else if(nr.energy>0.002 || nr.onset>0.002){
          roles[k].energy=Math.max(roles[k].energy||0, nr.energy||0);
          roles[k].onset=Math.max(roles[k].onset||0, nr.onset||0);
          roles[k].hi=nr.hi==null?roles[k].hi:nr.hi; roles[k].band=nr.band==null?roles[k].band:nr.band;
        }
      });
      roles.primary=roles.lead; roles.melody=roles.lead;
    }
    return roles;
  }
  function pushSemanticFrame(frame){ _semanticFrame=_normalizeSemanticFrame(frame||{}); return _semanticFrame; }
  function _externalDeckLock(bpm, t, beatBase){
    var b=clampBpm(bpm||0); if(!_bd || !b) return false;
    t=(t==null && ctx)?ctx.currentTime:t;
    _bd.nativeBpm=b;
    _bd.seedBpm=_bd.seedBpm||b;
    _bd.bpmLocked=true;
    _bd.ibi=60/b;
    _bd.deckOrigin=t||0;
    _bd.deckBeatBase=Math.max(0, beatBase==null?(_bd.beatN||0):beatBase);
    return true;
  }
  function _externalDeckClock(t){
    if(!_bd || !_bd.bpmLocked) return null;
    var b=clampBpm(_bd.nativeBpm||_bd.seedBpm||0); if(!b) return null;
    t=(t==null && ctx)?ctx.currentTime:t;
    var sp=60/b, beatFloat=Math.max(0,(_bd.deckBeatBase||0)+((t||0)-(_bd.deckOrigin||0))/Math.max(0.001,sp));
    var beat=Math.floor(beatFloat), beatPhase=beatFloat-beat;
    var gFloat=beatFloat*4, gstep=Math.floor(gFloat), stepPhase=gFloat-gstep;
    return {
      bpm:b, spb:sp, step16:sp/4,
      beat:beat, beatPhase:beatPhase, gstep:gstep, stepPhase:stepPhase,
      bar:Math.floor(beat/4), phrase:Math.floor(beat/16),
      barPhase:Math.max(0,Math.min(1,((beat%4)+beatPhase)/4)),
      phrasePulse:1-((((beat%16)+beatPhase)/16))
    };
  }
  // REACTOR: a rich real-time signal bus derived from the external analyser — SAME shape as the generative vis().
  function visExternal(){
    var t = ctx ? ctx.currentTime : 0;
    if(_bd._last && (t-(_bd._upd||0))>=0 && (t-(_bd._upd||0))<0.012) return _bd._last;   // once per ~frame regardless of caller count
    var dt = Math.min(0.1, Math.max(0.001, t-(_bd._upd||t))); _bd._upd=t;
    var P = _bd.prof || CAP_PROFILES.chip, a = extAnalyser;
    if(a){
      if(!_extFreq || _extFreq.length!==a.frequencyBinCount) _extFreq=new Uint8Array(a.frequencyBinCount);
      a.getByteFrequencyData(_extFreq);
      var bins=_extFreq, n=bins.length, hz=((ctx&&ctx.sampleRate)||44100)/2/n;
      function band(f0,f1){ var i0=Math.max(1,Math.floor(f0/hz)), i1=Math.min(n-1,Math.floor(f1/hz)), s=0,c=0; for(var i=i0;i<=i1;i++){ s+=bins[i]; c++; } return c?(s/c)/255:0; }
      var bBass=band(35,165), bMid=band(300,2200), bHat=band(5000,13000);
      var sr=(ctx&&ctx.sampleRate)||44100;
      _bd._spec = _specCompute(_extFreq, n, sr);   // NOTE-level spectrum (pitch/timbre/onsets) for the visualizer
      _bd._fullSpec = _fullSpectrumCompute(_extFreq, n, sr, _FULL_SPEC_NB);   // high-resolution visualizer spectrum
      if(!_extTime || _extTime.length!==a.fftSize) _extTime=new Uint8Array(a.fftSize);
      a.getByteTimeDomainData(_extTime); _bd._wave=_waveCompute(_extTime, 160); var rsum=0, nt=_extTime.length;
      for(var j=0;j<nt;j++){ var d=(_extTime[j]-128)/128; rsum+=d*d; }
      var energyRaw=Math.min(1, Math.sqrt(rsum/nt)*1.7);
      _bd.avgB=(_bd.avgB||0)*0.94+bBass*0.06; _bd.avgM=(_bd.avgM||0)*0.94+bMid*0.06; _bd.avgH=(_bd.avgH||0)*0.92+bHat*0.08;
      var fK=bBass-(_bd.pBass||0), fS=bMid-(_bd.pMid||0), fH=bHat-(_bd.pHat||0); _bd.pBass=bBass; _bd.pMid=bMid; _bd.pHat=bHat;
      var onK=(bBass>_bd.avgB*P.kThr && bBass>P.floor && fK>0);
      var onS=(bMid >_bd.avgM*P.sThr && bMid >P.floor && fS>0);
      var onH=(bHat >_bd.avgH*P.hThr && bHat >P.floor*0.6 && fH>0);
      _bd.kick =onK?1:Math.max(0,(_bd.kick ||0)-dt/P.rel);
      _bd.snare=onS?1:Math.max(0,(_bd.snare||0)-dt/(P.rel*1.2));
      _bd.hatE =onH?1:Math.max(0,(_bd.hatE ||0)-dt/(P.rel*0.7));
      _bd.bass=Math.max(bBass,(_bd.bass||0)-dt/P.rel); _bd.mid=Math.max(bMid,(_bd.mid||0)-dt/P.rel); _bd.trebE=Math.max(bHat,(_bd.trebE||0)-dt/P.rel);
      _bd.agcRef=Math.max(energyRaw,(_bd.agcRef||0.05)*0.999); var energyX=Math.min(1, energyRaw/Math.max(0.03,_bd.agcRef)*P.agc + energyRaw*0.18);
      _bd.energy=(_bd.energy||0)*0.7 + energyX*0.3;
      var since=t-_bd.lastBeatT, primary = onK || (onS && bBass<_bd.avgB*1.05);
      if(primary && since>P.deb){
        if(_bd.lastBeatT>0){ var ibiNew=Math.min(1.4,since); (_bd.ibiBuf=_bd.ibiBuf||[]).push(ibiNew); if(_bd.ibiBuf.length>8)_bd.ibiBuf.shift();
          var srt=_bd.ibiBuf.slice().sort(function(x,y){return x-y;}), med=srt[srt.length>>1]; _bd.ibi=Math.max(0.25,Math.min(1.2,(_bd.ibi||0.5)*0.4+med*0.6)); }
        _bd.lastBeatT=t; _bd.pulse=1; _bd.beatN++; _bd.hue=(_bd.hue+0.085)%1;
      } else { _bd.pulse=Math.max(_bd.kick, Math.max(0,(_bd.pulse||0)-dt/P.rel)); }
      _bd.eSlow=(_bd.eSlow||energyX)*0.997+energyX*0.003; _bd.eFast=(_bd.eFast||energyX)*0.6+energyX*0.4;
      var relE=_bd.eFast/Math.max(0.02,_bd.eSlow);
      _bd.level=Math.max(1,Math.min(10, Math.round(2 + _bd.energy*8.5 + (relE>1.2?(relE-1.2)*5:0))));
      _bd.intensity=(_bd.intensity||0)*0.95 + _bd.energy*0.05;
      _bd.dropEvent=false; if(_bd.dropCD>0) _bd.dropCD-=dt;
      if(relE>1.7 && _bd.energy>0.26 && (_bd.dropCD||0)<=0 && _bd.beatN>2){ _bd.dropEvent=true; _bd.dropCD=4.0; }
    }
    // IDLE-GROOVE: no onset for a while -> free-run a gentle clock so nothing freezes
    if(_bd.lastBeatT===0) _bd.lastBeatT=t;
    var ibi=_bd.ibi||0.5, sinceB=t-_bd.lastBeatT, step=Math.max(0.3,ibi);
    if(sinceB>1.6 && sinceB>step){ _bd.lastBeatT=t; _bd.beatN++; _bd.ibi=1.6; _bd.idle=true; if((_bd.pulse||0)<0.22)_bd.pulse=0.22; } else _bd.idle=(sinceB>1.6);
    if(!_bd.idle && !_bd.bpmLocked && _bd.ibiBuf && _bd.ibiBuf.length>=4){
      var rawBpm=60/Math.max(0.25,_bd.ibi||0.5), normBpm=normTrackBpm(rawBpm, _bd.nativeBpm||_bd.seedBpm||0);
      if(normBpm){
        _bd.rawBpm=Math.round(rawBpm);
        _externalDeckLock(normBpm, t, _bd.beatN||0);
      }
    }
    var bphase=Math.min(1,Math.max(0,(t-_bd.lastBeatT+P.latency)/ibi));      // +latency = predicted phase (pulses land ON the transient)
    var deck=_externalDeckClock(t);
    var bar=deck?deck.bar:Math.floor(_bd.beatN/4), barPhase=deck?deck.barPhase:Math.min(1,((_bd.beatN%4)+bphase)/4);
    var outBpm=deck?deck.bpm:(clampBpm(_bd.nativeBpm)||Math.round(60/Math.max(0.25,ibi))),
        outBeat=deck?deck.beat:_bd.beatN, outBar=bar, outPhrase=deck?deck.phrase:Math.floor(bar/4),
        outBarPhase=barPhase, outBarPulse=1-barPhase, outPhrasePulse=deck?deck.phrasePulse:1-(((_bd.beatN%4)+bphase)/4);
    var pin=pinnedTempo();
    if(pin!=null && ctx && step16){
      var relPin=Math.max(0, ctx.currentTime - beatOrigin);
      var beatFloat=relPin/Math.max(0.001, spb);
      outBeat=Math.max(0, Math.floor(beatFloat));
      outBar=Math.floor(outBeat/4);
      outPhrase=Math.floor(outBar/4);
      var beatPhase=beatFloat-Math.floor(beatFloat);
      outBarPhase=Math.max(0,Math.min(1,((outBeat%4)+beatPhase)/4));
      outBarPulse=1-outBarPhase;
      outPhrasePulse=outBarPulse;
      outBpm=Math.round(60/spb);
    }
    var _roles=_semanticRoles((_bd._spec&&_bd._spec.noteOns)||[], (_bd._spec&&_bd._spec.centroid)||0.5);
    _bd._last = { hue:_bd.hue, pulse:_bd.pulse||0, beatPulse:_bd.pulse||0, energy:_bd.energy||0,
      bpm:outBpm, beat:outBeat, bar:outBar, phrase:outPhrase,
      barPhase:outBarPhase, barPulse:outBarPulse, phrasePulse:outPhrasePulse,
      energyLevel:_bd.level||3, intensity:_bd.intensity||0, section:null,
      bands:{ bass:_bd.bass||0, mid:_bd.mid||0, treble:_bd.trebE||0 }, kick:_bd.kick||0, snare:_bd.snare||0, hat:_bd.hatE||0,
      drop:_bd.dropEvent||false, idle:_bd.idle||false,
      spectrum:(_bd._spec&&_bd._spec.spectrum)||[], fullSpectrum:_bd._fullSpec||[], visualSpectrum:_bd._fullSpec||[],
      waveform:_bd._wave||[], noteOns:(_bd._spec&&_bd._spec.noteOns)||[], centroid:(_bd._spec&&_bd._spec.centroid)||0.5,
      roles:_roles, primaryNotes:(_roles.lead&&_roles.lead.notes)||[] };
    return _bd._last;
  }
  // route an outside Web Audio node (mic source / <audio> element source / buffer / chip player) into the graph
  function playExternal(node, opts){
    if(!ctx) return false;
    opts=opts||{};
    var wasExt=extMode, t=ctx.currentTime;
    if(!wasExt) beginExternalHandoff();
    stopSchedClock();                         // the generative scheduler sleeps while a console/file source is active
    deckCur=null; deckNext=null; curSec=null; // generated decks are rebuilt on return (stopExternal -> gotoTrack/mint)
    _specLast=null; _specT=-1; _specAvg=null; _specPrev=null;
    if(!extGain){ extGain=ctx.createGain(); extGain.gain.value=1.0; extGain.connect(master); }
    if(!extAnalyser){ extAnalyser=ctx.createAnalyser(); extAnalyser.fftSize=2048; extAnalyser.smoothingTimeConstant=0.55; extAnalyser.connect(extGain); }
    ensureExtEq();
    if(extSrcNode && extSrcNode!==node){ try{ extSrcNode.disconnect(); }catch(e){} }
    extSrcNode=node; if(node){ try{ node.connect(extEqIn||extAnalyser); }catch(e){} }
    _micMode = (opts.monitor===false);
    if(extGain&&extGain.gain){
      if(wasExt) holdParam(extGain.gain, t);
      extGain.gain.setTargetAtTime(_micMode ? 0.0001 : 1, t, wasExt?0.012:0.018);
    }   // mic = ANALYSE ONLY (no speaker output) -> no feedback/echo; analyser still reads the signal pre-gain
    var seedBpm=clampBpm(opts.nativeBpm||opts.bpm||0), seedIbi=seedBpm?60/seedBpm:0.5;
    extMode=true; _bd={ prof:(_micMode?CAP_PROFILES.mic:CAP_PROFILES.chip), pulse:0, hue:0.5, beatN:0, ibi:seedIbi, lastBeatT:0,
      energy:0, eSlow:0, eFast:0, intensity:0, level:3, ibiBuf:[], agcRef:0.05, dropCD:0, nativeBpm:seedBpm||0, seedBpm:seedBpm||0,
      bpmLocked:!!seedBpm, deckOrigin:ctx.currentTime, deckBeatBase:0 };
    if(genGain) genGain.gain.setTargetAtTime(0.0001, t, 0.008);   // silence the generative engine and its scheduled look-ahead
    if(wasExt) try{ killDrums(0.018); }catch(e){}
    _schedDiag = {t:Date.now(), bg:!!backgroundAudioOnly, ext:true, stopped:true, output:'external', ctx:ctx.state, source:opts.source||'external'};
    if(typeof window!=='undefined') window.__rrrSched=_schedDiag;
    return true;
  }
  function resetExternalClock(nativeBpm){
    if(!ctx || !extMode) return;
    var b=clampBpm(nativeBpm||0), ib=b?60/b:0.5;
    _bd.ibi=ib; _bd.seedBpm=b||0; _bd.nativeBpm=b||0; _bd.rawBpm=0; _bd.ibiBuf=[]; _bd.bpmLocked=!!b; _bd.deckOrigin=ctx.currentTime; _bd.deckBeatBase=0;
    _bd.lastBeatT=ctx.currentTime; _bd.beatN=0; _bd.pulse=0; _bd.idle=false;
  }
  function stopExternal(){
    var t=ctx?ctx.currentTime:0;
    if(extGain&&extGain.gain){ holdParam(extGain.gain, t); extGain.gain.setTargetAtTime(0.0001, t, 0.018); }
    if(extSrcNode){ try{ extSrcNode.disconnect(); }catch(e){} extSrcNode=null; }
    extMode=false;
    _specLast=null; _specT=-1; _specAvg=null; _specPrev=null;
    _genVisLast=null; _genVisT=-1; _genAna={};
    if(master&&master.gain) master.gain.setTargetAtTime(masterTargetGain(), t, 0.03);
    if(genGain && ctx) genGain.gain.setTargetAtTime(1.0, t+0.02, 0.05);   // un-mute the generative engine
    if(started){
      setBackgroundAudioOnly(shouldBackgroundAudioOnly());
      startSchedClock();
      scheduler();
    }
  }
  function backgroundVis(){
    var vt=ctx?ctx.currentTime:0;
    if(_bgVisLast && vt-_bgVisT>=0 && vt-_bgVisT<0.25) return _bgVisLast;
    _bgVisT=vt;
    var bpm=nativeTrackBpm() || Math.round(60/(spb||0.5)) || 120;
    var ps=60/Math.max(50,bpm), s16=step16||(ps/4), bl=barLen||(s16*16);
    var origin=(extMode && _bd && _bd.deckOrigin!=null) ? _bd.deckOrigin : beatOrigin;
    var rel=Math.max(0, vt - (origin||0)), barF=rel/bl, barN=Math.floor(barF), barPhase=barF-barN;
    var beatN=Math.floor(rel/(s16*4));
    var sec=curSec;
    var baseEnergy=Math.max(0.08, Math.min(0.22, extMode ? ((_bd&&(_bd.energy||_bd.eSlow))||0.14) : (energy||0.14)));
    _bgVisLast = { hue:musHue||((_bd&&_bd.hue)||0.5), pulse:0, beatPulse:0, energy:baseEnergy,
      bpm:bpm, beat:beatN, bar:barN, phrase:Math.floor(barN/4), barPhase:barPhase,
      barPulse:1-barPhase, phrasePulse:1-(((barN%4)+barPhase)/4),
      energyLevel:Math.max(1, Math.min(3, Math.round(baseEnergy*10))), section:sec?sec.role:null,
      bands:{ bass:baseEnergy*0.18, mid:baseEnergy*0.24, treble:baseEnergy*0.18 },
      kick:0, snare:0, hat:0, intensity:baseEnergy, drop:false, idle:true, background:true,
      spectrum:[], fullSpectrum:[], visualSpectrum:[], waveform:[], noteOns:[], centroid:0.5,
      roles:_fallbackSemantic([],0.5), primaryNotes:[] };
    return _bgVisLast;
  }
  function vis(){
    if(transportPaused) return pausedVis();
    if(backgroundAudioOnly) return backgroundVis();
    if(extMode) return visExternal();
    var vt=ctx?ctx.currentTime:0;
    if(_genVisLast && vt-_genVisT>=0 && vt-_genVisT<0.012) return _genVisLast;
    _genVisT=vt;
    var rel = (ctx && step16) ? Math.max(0, ctx.currentTime - beatOrigin) : 0;
    var s16 = step16||0.1, bl = barLen||(s16*16);
    var barF = rel/bl, barN = Math.floor(barF), barPhase = barF - barN, beatN = Math.floor(rel/(s16*4));
    var sec = curSec;
    var eLvl = (sec && sec.e!=null) ? sec.e : Math.max(1, Math.round((energy||0)*10));
    var gsp = _specGenerated();                                                  // NOTE-level spectrum + full visualizer spectrum from the master output
    var gwave = _waveGenerated();                                                // real mixed waveform for visualizers
    var grt = _generatedRealtime(gsp, gwave);                                    // analyser-derived bands/onsets/normalized spectrum
    var groles = _semanticRoles(gsp.noteOns, gsp.centroid);
    _genVisLast = { hue: musHue, pulse:Math.max(musPulse,grt.kick*0.85), energy:Math.max(energy,grt.energy),
      bpm: Math.round(60/spb), beat: beatN, bar: barN, phrase: Math.floor(barN/4), barPhase: barPhase,
      beatPulse: Math.max(musPulse,grt.kick*0.85), barPulse: 1-barPhase, phrasePulse: 1-(((barN%4)+barPhase)/4),
      energyLevel: Math.max(eLvl,grt.energyLevel||1), section: sec?sec.role:null,
      bands:grt.bands||{ bass:musPulse, mid:energy, treble:energy*0.6 }, kick:Math.max(musPulse,grt.kick||0), snare:grt.snare||0, hat:grt.hat||0,
      intensity:Math.max(energy,grt.energy||0), drop:grt.drop||false, idle:false,
      spectrum:gsp.spectrum, fullSpectrum:grt.fullSpectrum||gsp.fullSpectrum||[], visualSpectrum:grt.visualSpectrum||gsp.fullSpectrum||[],
      waveform:grt.waveform||gwave, noteOns:gsp.noteOns, centroid:gsp.centroid,
      roles:groles, primaryNotes:(groles.lead&&groles.lead.notes)||[] };   // source-agnostic FX + note-spawn fields
    return _genVisLast;
  }
  function pauseNowMs(){ return (typeof performance!=='undefined'&&performance.now) ? performance.now() : Date.now(); }
  function pausedVisualGrid(){
    var pg=pausedGridSnap||{}, pb=pg.bpm||Math.round(60/(spb||0.5))||120, ps=pg.spb||spb||60/pb, p16=pg.step16||ps/4;
    var elapsed=(transportPaused&&pausedAtMs) ? Math.max(0,(pauseNowMs()-pausedAtMs)/1000) : 0;
    var gs=pg.gstep||0, ph=pg.phase||0;
    return { gstep:gs, phase:ph, beat:pg.beat||((gs/4)|0), bar:pg.bar||((gs/16)|0), spb:ps, step16:p16, bpm:pb, elapsed:elapsed, paused:true, visual:true };
  }
  function pausedVis(){
    var g=pausedVisualGrid(), c=pausedClockSnap||{}, bpm=g.bpm||c.bpm||Math.round(60/(spb||0.5))||120;
    var barPhase=((g.gstep%16)+g.phase)/16;
    var baseEnergy=Math.max(0.12, Math.min(0.26, ((c.energy!=null?c.energy:energy)||0.32)*0.5));
    var eLvl=Math.max(2, Math.min(3, Math.round((c.energyLevel||Math.round(baseEnergy*10)||3))));
    return { hue:c.hue||0.5, pulse:0, beatPulse:0, energy:baseEnergy,
      bpm:bpm, beat:g.beat, bar:g.bar, phrase:Math.floor(g.bar/4),
      barPhase:barPhase, barPulse:1-barPhase, phrasePulse:1-(((g.bar%4)+barPhase)/4),
      energyLevel:eLvl, section:c.section||null,
      bands:{ bass:baseEnergy*0.18, mid:baseEnergy*0.24, treble:baseEnergy*0.18 }, kick:0, snare:0, hat:0, intensity:baseEnergy, drop:false, idle:true, paused:true,
      spectrum:[], fullSpectrum:[], visualSpectrum:[], waveform:[], noteOns:[], centroid:0.5,
      roles:_fallbackSemantic([],0.5), primaryNotes:[] };
  }
  // THE MUSICAL CLOCK the gameplay runs on: which 16th-note is sounding now + how far into it (0..1).
  function gridNow(){
    if(transportPaused){
      var pg=pausedGridSnap||{}, pb=pg.bpm||Math.round(60/(spb||0.5))||120, ps=pg.spb||spb||60/pb;
      return { gstep:pg.gstep||0, phase:pg.phase||0, beat:pg.beat||0, bar:pg.bar||0, spb:ps, step16:pg.step16||ps/4, bpm:pb, paused:true };
    }
    if(extMode){                                              // KEYSTONE: in external mode the games' beat clock IS the analyser
      var pin=pinnedTempo();
      if(pin!=null && ctx && step16){
        const relPinned = (ctx.currentTime - beatOrigin) / step16;
        const gstepPinned = Math.max(0, Math.floor(relPinned));
        return { gstep:gstepPinned, phase:Math.max(0, Math.min(1, relPinned - Math.floor(relPinned))), beat:(gstepPinned/4)|0, bar:(gstepPinned/16)|0, spb, step16, bpm:Math.round(60/spb), pinned:true };
      }
      if(backgroundAudioOnly){
        var tbg=ctx?ctx.currentTime:0, deckBg=_externalDeckClock(tbg);
        if(deckBg) return { gstep:deckBg.gstep, phase:deckBg.stepPhase, beat:deckBg.beat, bar:deckBg.bar, spb:deckBg.spb, step16:deckBg.step16, bpm:deckBg.bpm, locked:true, background:true };
        var bb=clampBpm((_bd&&(_bd.nativeBpm||_bd.seedBpm))||0) || Math.round(60/(spb||0.5)) || 120;
        var bps=60/Math.max(55,bb), b16=bps/4, borg=(_bd&&_bd.deckOrigin!=null)?_bd.deckOrigin:(beatOrigin||0);
        var bgf=Math.max(0,(tbg-borg)/b16), bgs=Math.floor(bgf);
        return { gstep:bgs, phase:Math.max(0,Math.min(1,bgf-bgs)), beat:(bgs/4)|0, bar:(bgs/16)|0, spb:bps, step16:b16, bpm:bb, background:true };
      }
      visExternal();                                          // ensure the reactor is fresh (cached per frame)
      var te=ctx?ctx.currentTime:0, ib=_bd.ibi||0.5, lat=(_bd.prof?_bd.prof.latency:0);
      var deck=_externalDeckClock(te);
      if(deck) return { gstep:deck.gstep, phase:deck.stepPhase, beat:deck.beat, bar:deck.bar, spb:deck.spb, step16:deck.step16, bpm:deck.bpm, locked:true };
      var bph=Math.min(0.999,Math.max(0,(te-_bd.lastBeatT+lat)/ib));   // 0..<1 within the beat (predicted, matching vis())
      var sub=Math.min(3,Math.floor(bph*4));                  // 0..3 sixteenth within THIS beat
      var gs=_bd.beatN*4 + sub;
      var gridBpm=clampBpm(_bd.nativeBpm)||Math.round(60/Math.max(0.25,ib));
      return { gstep:gs, phase:(bph*4)-sub, beat:_bd.beatN, bar:(_bd.beatN/4)|0, spb:60/Math.max(55,gridBpm), step16:(60/Math.max(55,gridBpm))/4, bpm:gridBpm };
    }
    if(!ctx || !step16) return { gstep:0, phase:0, beat:0, bar:0, spb:spb, step16:step16, bpm:Math.round(60/spb) };
    const rel = (ctx.currentTime - beatOrigin) / step16;
    const gstep = Math.max(0, Math.floor(rel));
    return { gstep, phase: Math.max(0, Math.min(1, rel - Math.floor(rel))), beat:(gstep/4)|0, bar:(gstep/16)|0, spb, step16, bpm:Math.round(60/spb) };
  }
  function detectedBpm(){
    if(extMode){
      if(backgroundAudioOnly) return clampBpm((_bd&&(_bd.nativeBpm||_bd.seedBpm))||0) || null;
      if(ctx) visExternal();
      if(!_bd || _bd.idle) return null;
      var b=clampBpm(_bd.nativeBpm||0);
      if(!b && _bd.ibiBuf && _bd.ibiBuf.length>=2) b=normTrackBpm(60/Math.max(0.25,_bd.ibi||0.5), _bd.seedBpm||0);
      return (b>=50 && b<=220) ? b : null;
    }
    return Math.round(60/spb);
  }

  /* ---- radio transport (driven by the Radio brain / player UI) ---- */
  function nextMovement(){ startTrack(null, {fade:0.12}); }   // "skip" -> 120ms fade, then a fresh minted track (cold open)
  function setPlaying(p){
    p=!!p;
    if(!p && !transportPaused){
      try{ pausedGridSnap=gridNow(); }catch(e){ pausedGridSnap=null; }
      try{ pausedClockSnap=vis(); }catch(e2){ pausedClockSnap=null; }
      pausedAtMs=pauseNowMs();
    }
    transportPaused=!p;
    if(p){ pausedGridSnap=null; pausedClockSnap=null; pausedAtMs=0; }
    genWorkletSetPaused(!p);
    if(ctx){ if(p){ resumeCtx(true); } else { ctx.suspend&&ctx.suspend(); } }
    if(p && started) scheduler();
    return p;
  }
  // Tempo is CONTINUOUS: a user pin re-times the running score (DJ-deck pitch follows target/native).
  function setTempo(bpm){
    bpm=clampBpm(bpm)||128;
    setGridTempo(bpm);
    if(!extMode && started && ctx && deckCur){
      var t=ctx.currentTime;
      retimeDeckTempo(deckCur, bpm, t);
      if(deckNext){ deckNext.origin=deckCur.endTime; deckNext.bpm=bpm; deckNext.spb=60/bpm; deckNext.endTime=deckNext.origin+deckNext.totalBeats*deckNext.spb; deckNext.cursor=0; deckNext.paletteSent=false; }
      if(genWorkletUsable()){
        genWorkletClearFuture(t+0.025);
        Engine.setTempo(deckCur.spb, bpm, deckCur.generation);
      }
      gbSetRate();
      scheduler();
    }
  }
  function resetTempo(){
    var bpm=nativeTrackBpm() || Math.round(60/(spb||0.5)) || 128;
    genTempoBaseBpm=bpm; setTempo(bpm); tempoPitchRatio=1;
    return Math.round(60/spb);
  }

  /* ============================================================
     GAME-MUSIC EVENT LAYER — the music owns time; games emit normalized events;
     each is QUANTIZED onto the song grid and answered with a quiet, dry, in-key
     note that belongs to the track (never a disconnected SFX). All over Engine.note.
     ============================================================ */
  let _lastSfxSlot = -1;
  const SFX_QUANT = 2;                                   // 1=16th, 2=8th notes
  // play one synth recipe through the Engine (quiet, in-key support layer)
  function playRecipe(r, when, freqOverride){
    if(!started || !r || !ctx || !genWorkletUsable()) return;
    when = when || ctx.currentTime;
    var fr = pitchFreq(Math.max(20, freqOverride || r.freq || 220));
    var ev = { kind:'note', time:when, dur:r.dur||0.15, freq:fr,
      voice:(r.voice||r.role||mnow.leadHint||'lead'),
      vel:(r.vel!=null?r.vel:0.18),
      wave:r.wave, duty:r.duty,
      sendEcho:(r.send?0.18:0) };
    if(r.filter){ ev.cut=r.filter.freq||2200; ev.q=r.filter.q||2; }
    if(r.attack!=null) ev.attack=r.attack;
    Engine.note(ev, deckCur?deckCur.generation:undefined);
    Engine.flush();
    emitSnd(when, freqHy(fr), (ev.vel||0.18)*4);
  }
  function gameMelodyNote(vel, semis){
    if(!started || transportPaused || extMode || !genWorkletUsable()) return;
    const slot = quantizeTime(SFX_QUANT);               // schedule onto the song's beat, not "right now"
    if(slot - _lastSfxSlot < step16*0.5){ bump(0.012); return; }   // at most ONE sfx note per slot
    _lastSfxSlot = slot;
    const fr = pitchFreq(mtof(nextMelodyMidi() + (semis||0)));     // the next melody note, in key
    Engine.note({ kind:'note', time:slot, dur:0.12, freq:fr,
      voice:mnow.leadHint||'lead',
      vel:Math.min(0.075, vel!=null?vel:0.05), sendEcho:0 }, deckCur?deckCur.generation:undefined);   // quiet + DRY — strictly UNDER the track
    Engine.flush();
    emitSnd(slot, freqHy(fr), 0.4); musPulse = Math.max(musPulse, 0.16); bump(0.02);
  }
  var _react = { minor:{slot:-1,bar:-1,n:0}, medium:{slot:-1,bar:-1,n:0}, major:{slot:-1,bar:-1,n:0} };
  function reactNote(deg, reg){ var m=mnowDeg2Midi(deg)+12*(reg||0); while(m<48)m+=12; while(m>88)m-=12; return m; }   // in key, planed onto the CURRENT chord
  function reactOK(cat, slot, perBar){                             // density limiter: per-bar cap + cooldown
    var r=_react[cat]; if(!r) return true; var bar=Math.floor(slot/step16/16);
    if(bar!==r.bar){ r.bar=bar; r.n=0; }
    var cd = step16*(cat==='minor'?0.5 : cat==='medium'?1.5 : 3);
    if(slot - r.slot < cd) return false;
    if(r.n >= perBar) return false;
    r.slot=slot; r.n++; return true;
  }
  // GAMEPLAY EVENTS ARE VISUAL-ONLY: an on-beat blip + 'gamefx'/'screenfx' events the visual layer drives
  // VJ-style shader/distortion from. No audio, and no bump() — gameplay never alters the music.
  function reactMinor(){
    if(!started || !ctx || extMode || transportPaused) return;
    var slot=quantizeTime(1); if(!reactOK('minor', slot, 6)) return;
    emitSnd(slot, 0.82, 0.3); musPulse=Math.max(musPulse,0.14);
    pushAudioEvent({t:slot, kind:'gamefx', mag:0.25});
  }
  function reactMedium(){
    if(!started || !ctx || extMode || transportPaused) return;
    var slot=quantizeTime(2); if(!reactOK('medium', slot, 3)){ return reactMinor(); }
    emitSnd(slot, 0.55, 0.6); musPulse=Math.max(musPulse,0.32);
    pushAudioEvent({t:slot, kind:'gamefx', mag:0.6});
  }
  function reactMajor(){
    if(!started || !ctx || extMode || transportPaused) return;
    var slot=quantizeTime(8); if(!reactOK('major', slot, 2)){ return reactMedium(); }
    emitSnd(slot, 0.3, 0.95); musPulse=1;
    pushAudioEvent({t:slot, kind:'screenfx'});                                                // big on-screen hit (flash/distortion)
    pushAudioEvent({t:slot, kind:'gamefx', mag:1});
  }
  function reactState(name, on){ /* visual-only state flag; no audio layer */ }

  const SND = {
    // THE EVENT BUS: games emit NORMALIZED music events; the engine quantizes + answers them, under the track.
    // category: 'minor' | 'medium' | 'major' | 'state'.
    event(category, intensity, opts){
      if(!started || extMode) return;
      opts = opts || {};
      if(category==='major') reactMajor();
      else if(category==='medium') reactMedium();
      else if(category==='state') reactState(opts.name||'hype', opts.on!==false);
      else reactMinor();                                                 // 'minor' / default
    },
    // back-compat aliases (older games) -> normalized categories. New games should call SND.event(...).
    note(deg, dur, vel){ reactMinor(); },
    lead(dur, vel){ reactMedium(); },
    fx(name, semis){ if(semis>=12||semis<=-12) reactMajor(); else reactMedium(); },
    tone(recipe, semis){ reactMinor(); },
    drum(type, vel){ reactMinor(); },
    bass(deg, dur, vel){ reactMinor(); },
    energy(){ return energy; },
    act(a){ /* no-op: gameplay does not drive the music (kept for API compatibility) */ },
    grid(){ return gridNow(); },                   // THE BEAT CLOCK — gameplay runs on this (gstep/phase/beat/bar/spb)
    clock(){ return vis(); },                      // THE VISUAL CLOCK — beat/bar/phrase pulses + section energy
  };

  // returns (and clears) audio-timed events whose scheduled time has arrived
  function consumeEvents(){
    if(!started || transportPaused) return [];
    const now = ctx.currentTime;
    const out=[];
    for(let i=events.length-1;i>=0;i--){
      if(events[i].t <= now){ out.push(events[i]); events.splice(i,1); }
    }
    return out;
  }

  // lean frame-loop accessor (bpm + current section for the montage/HUD)
  function current(){
    return { key:(deckCur?deckCur.tok:'radio'), name:(deckCur?deckCur.tok:''),
             bpm:Math.round(60/(spb||0.5)), sect:(curSec&&curSec.role)||'groove' };
  }

  /* ---- now-playing introspection (fingerprint fields + voice summaries + form) ---- */
  function fpOut(d){
    var fp=(d&&d.fp)||{};
    return { bpm:(fp.bpm!=null?fp.bpm:(d?d.nativeBpm:null)),
      keyPc:(fp.keyPc!=null?fp.keyPc:null), brightness:(fp.brightness!=null?fp.brightness:null),
      waveClass:fp.waveClass||null, grooveFamily:fp.grooveFamily||null,
      density:(fp.density!=null?fp.density:null), energyPeak:(fp.energyPeak!=null?fp.energyPeak:null),
      echoDepth:(fp.echoDepth!=null?fp.echoDepth:null) };
  }
  function voiceLabel(d, role){
    var P=d&&d.score&&d.score.palette, vs=P&&P.voices;
    if(!vs) return null;
    var v=null;
    if(Array.isArray(vs)){ for(var i=0;i<vs.length;i++){ if(vs[i]&&(vs[i].role===role||vs[i].id===role)){ v=vs[i]; break; } } }
    else v=vs[role];
    if(!v) return null;
    return v.id || (v.wave ? (v.wave + (v.duty!=null?('@'+v.duty):'')) : role);
  }

  return {
    init,
    resume(force){ return resumeCtx(!!force); },
    running(){ return !!(ctx && ctx.state==='running' && !transportPaused); },        // is audio actually sounding (autoplay gate cleared)?
    get started(){ return started; },
    audioCtx(){ return ctx; },                                    // the shared AudioContext (runtime builds mic/element/buffer source nodes in it for EXTERNAL mode)
    // Which engine is actually making the sound. Every audio bug on this project
    // has been the answer to that differing from the assumption, and none of it
    // was visible from outside.
    chipDiag(){
      return { chip: !!gbNode, active: gbActive, pending: !!gbPending, owner: chipOwner,
               chipGain: gbChipGain ? +gbChipGain.gain.value.toFixed(4) : null,
               synthGain: gbSynthGain ? +gbSynthGain.gain.value.toFixed(4) : null,
               ctx: ctx ? ctx.state : null, paused: transportPaused };
    },
    setBackgroundAudioOnly,
    backgroundAudioOnly(){ return backgroundAudioOnly; },
    playExternal(node, opts){ return playExternal(node, opts); }, // drive the visuals from an outside Web Audio node; mutes the generative engine
    resetExternalClock,
    stopExternal(){ stopExternal(); },                            // back to the generated station
    extActive(){ return extMode; },
    consumeEvents,
    SND, grid: gridNow, detectedBpm, pushSemanticFrame, nextMovement, setPlaying, setExternalPaused(p){ return setPlaying(!p); }, isPaused(){ return transportPaused; }, setTempo, resetTempo, get energy(){ return energy; },
    play(){ return setPlaying(true); },
    vis,
    outputProbe,
    current,
    trackBpm(){ return extMode ? (nativeTrackBpm() || detectedBpm() || null) : (nativeTrackBpm() || Math.round(60/(spb||0.5))); },
    // LIVE MIXER: scale a voice role's level (1 = built-in). 'master' scales the master gain. Drives the on-screen mixer panel.
    setMix(role, val){ val=Math.max(0, Math.min(3, (+val||0)));
      if(role==='master'){ MIX.master=val; if(master&&ctx) master.gain.setTargetAtTime(masterTargetGain(), ctx.currentTime, 0.03); }
      else if(MIX[role]!=null){ MIX[role]=val; updateExtEq(); }
      genWorkletSetMix();
      gbSetMix();                                    // the CHIP is the audible path; the synth mix alone moved nothing
      return Object.assign({}, MIX); },
    getMix(){ return Object.assign({}, MIX); },
    refreshMix(){ updateExtEq(); return Object.assign({}, MIX); },
    toggleMute(){ muted=!muted; if(master&&ctx) master.gain.setTargetAtTime(masterTargetGain(), ctx.currentTime, 0.02); return !muted; },
    // The track TOKEN (a word-slug) IS the seed + the name + the shareable URL: same slug ALWAYS plays the same song.
    onTrackReady, onSeedReset, onMintToken, onTrackEnd,
    trackToken(){ return curTok; },
    gotoTrack(tok){ if(tok==null) return curTok; startTrack(String(tok), {fade:0.12}); return curTok; },
    // LIVE (shared clock schedule): mid-track join + mode wiring. See setLiveMode/startTrackAtOffset.
    gotoTrackAtOffset(tok, offsetSec){ return startTrackAtOffset(tok, offsetSec, {fade:0.12}); },
    // BROADCASTER video leg: a MediaStream of the FINAL master output (post EQ/leveler/limiter =
    // exactly what listeners hear). The headless /radio page combines this with canvas.captureStream
    // for the YouTube feed. Sink-only (a fan-out tap; never alters the signal to the speakers).
    captureStream(){
      if(!ctx || !masterOut) return null;
      try{ if(!_captureDest){ _captureDest=ctx.createMediaStreamDestination(); masterOut.connect(_captureDest); } return _captureDest.stream; }
      catch(e){ return null; }
    },
    // Mobile only: the master output as a MediaStream to feed a playing <audio> element (background
    // survival). Null on desktop, where the output goes straight to ctx.destination.
    outputStream(){ return _outStreamDest ? _outStreamDest.stream : null; },
    // Safety net: if the media-element route can't play (a device that blocks it), wire the raw
    // destination so there is NEVER silence — we lose background survival but keep foreground audio.
    useDestinationOutput(){ try{ if(masterOut && ctx){ masterOut.connect(ctx.destination); return true; } }catch(e){} return false; },
    setLiveMode,
    deckPosition(){ var d=deckCur; if(!d||!ctx) return null;
      return { tok:d.tok, sec:ctx.currentTime-d.origin, durSec:d.totalBeats*d.spb, next:deckNext?deckNext.tok:null }; },
    // The score the synth is reading right now. The cartridge exporter uses this
    // so the download is the identical music, not a second compile that could
    // drift if the composer revision moved underneath it.
    currentScore(){ return deckCur ? deckCur.score : null; },
    // on=true runs the exported cartridge; on=false returns to the composition
    // at the position the track has reached.
    playRom(bytes){ return gbPlayRom(bytes); },
    playScore(){ if(gbNode) gbNode.port.postMessage({type:'chmute', mask:null}); chipOwner='radio'; return gbPlayScore(); },
    // CREATE editor: loop a user-authored gb song on the chip. Shares the
    // radio's chip node; playScore() hands it back afterwards.
    // Entering the editor: the radio goes quiet NOW, not at first play.
    enterCreate(){
      chipOwner='create';
      if(gbNode) gbNode.port.postMessage({type:'stop'});
    },
    playCreate(gb, loopFrames, offsetFrames){
      if(!gb || !gb.notes){ return false; }
      startAudio(true); if(this.resume) this.resume(true);
      chipOwner='create';
      gbActive=true;
      if(ctx && gbSynthGain && gbChipGain){
        var t=ctx.currentTime;
        gbSynthGain.gain.setTargetAtTime(0.0001, t, 0.01);
        gbChipGain.gain.setTargetAtTime(1.0, t, 0.01);
      }
      // offsetFrames: an edit mid-play swaps the song under the playhead
      // instead of yanking it back to the start.
      var off=(offsetFrames|0)||0;
      // The whole song, not just its notes: automation, wave swaps, vibrato
      // hand-offs and kit hits are as much the music as the note-ons, and
      // leaving them out here meant the cartridge played things the browser
      // never did.
      var msg={type:'play', gb:{notes:gb.notes, bank:gb.bank, totalFrames:gb.totalFrames,
                                auto:gb.auto||null, vibOff:gb.vibOff||null,
                                waveLoads:gb.waveLoads||null, kit:gb.kit||null},
               offsetFrames:off, paused:false, loopFrames:loopFrames|0, rate:1,
               mix:Object.assign({}, MIX), leadSec:off>0?0:0.06};
      ensureGbChip();
      if(gbNode) gbNode.port.postMessage(msg); else gbPending=msg;
      return true;
    },
    pokeCreate(note){ if(!gbNode) startAudio(true); if(this.resume) this.resume(true);
      if(gbNode && note) gbNode.port.postMessage({type:'poke', note:note}); },
    pokeKit(id){ if(!gbNode) startAudio(true); if(this.resume) this.resume(true);
      if(gbNode) gbNode.port.postMessage({type:'kit', id:id|0}); },
    stopPoke(ch){ if(gbNode) gbNode.port.postMessage({type:'pokeoff', ch:(ch==null?null:ch|0)}); },
    setChipMute(mask){ ensureGbChip(); if(gbNode) gbNode.port.postMessage({type:'chmute', mask:mask||null}); },
    stopCreate(){ if(gbNode) gbNode.port.postMessage({type:'stop'}); },  // editor stop: chip quiet, ownership stays; playScore() is the way back
    romMode(){ return gbRomMode; },
    // the song on air, as a Create document -- this is what makes "edit what I
    // am hearing" the same song rather than a near-enough copy of it
    currentDoc(){ return (deckCur && deckCur.score && deckCur.score.doc) || null; },
    playDoc(code){ return playDoc(code); },
    sharedTitle(){ return _sharedTitle; },
    // Quiet, in-key game hooks (over the Engine): the games' melodic support layer.
    gameMelodyNote, reactNote, reactOK, playRecipe,
    // ENGINE facade — worklet v2 protocol + offline render for the audition harness.
    Engine,
    // NOW PLAYING: fingerprint axes + the instrument on each voice role.
    nowPlaying(){ var d=deckCur; if(!d) return null; var fp=fpOut(d);
      var tracker=(d.score&&d.score.tracker)||{}, premise=tracker.premise||{}, background=(d.score&&d.score.background)||{};
      return { slug:d.tok, token:d.tok, section:(curSec&&curSec.role)||null,
        bpm:Math.round(60/(spb||0.5)), nativeBpm:d.nativeBpm,
        keyPc:fp.keyPc, brightness:fp.brightness, waveClass:fp.waveClass, grooveFamily:fp.grooveFamily,
        density:fp.density, energyPeak:fp.energyPeak, echoDepth:fp.echoDepth,
        identity:tracker.identity||null, dialect:tracker.dialect||fp.dialect||null,
        era:tracker.era||null, hardware:tracker.hardware||null,
        development:premise.development||fp.development||null, motion:premise.motion||fp.motion||null,
        space:premise.space||null, attention:background.attentionBudget,
        quality:tracker.critic&&tracker.critic.quality,
        composer:(typeof Packs!=='undefined'&&Packs.activeComposerId)?Packs.activeComposerId():null,
        lead:voiceLabel(d,'lead'), bass:voiceLabel(d,'bass'), arp:voiceLabel(d,'arp'), pad:voiceLabel(d,'pad') }; },
    // FULL track shape: fingerprint + the FORM laid out with bar ranges AND time ranges + the live playhead.
    trackInfo(){ var d=deckCur; if(!d) return null;
      var s4=d.spb*4, S=d.sections||[], form=[], i;
      for(i=0;i<S.length;i++){ var b=S[i].bars||0, sb=S[i].startBar||0;
        form.push({ idx:i, role:S[i].role, bars:b, energy:S[i].e,
          startBar:sb, startSec:+(sb*s4).toFixed(1), endSec:+((sb+b)*s4).toFixed(1), current:(S[i]===curSec) }); }
      var now=ctx?ctx.currentTime:0, elapsed=Math.max(0, now-d.origin);
      var NOTE=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
      var fp=fpOut(d), keyPc=(fp.keyPc!=null)?(((fp.keyPc%12)+12)%12):null;
      var tracker=(d.score&&d.score.tracker)||{}, premise=tracker.premise||{}, background=(d.score&&d.score.background)||{};
      return { slug:d.tok, token:d.tok, bpm:Math.round(60/(spb||0.5)), nativeBpm:d.nativeBpm,
        key:(keyPc!=null?NOTE[keyPc]:null), keyPc:keyPc,
        brightness:fp.brightness, waveClass:fp.waveClass, grooveFamily:fp.grooveFamily,
        density:fp.density, energyPeak:fp.energyPeak, echoDepth:fp.echoDepth,
        identity:tracker.identity||null, dialect:tracker.dialect||fp.dialect||null,
        era:tracker.era||null, hardware:tracker.hardware||null,
        development:premise.development||fp.development||null, motion:premise.motion||fp.motion||null,
        space:premise.space||null, attention:background.attentionBudget,
        leadActiveShare:background.leadActiveShare, quality:tracker.critic&&tracker.critic.quality,
        patterns:tracker.patterns||null,
        composer:(typeof Packs!=='undefined'&&Packs.activeComposerId)?Packs.activeComposerId():null,
        elapsedSec:+elapsed.toFixed(1), trackBar:Math.max(0,Math.floor(elapsed/s4)), totalBars:Math.round(d.totalBeats/4),
        section:(curSec&&curSec.role)||null,
        instruments:{ lead:voiceLabel(d,'lead'), bass:voiceLabel(d,'bass'), arp:voiceLabel(d,'arp'), pad:voiceLabel(d,'pad'), fx:voiceLabel(d,'fx') },
        form:form }; },
  };
})();

/* ============================================================
   VISUALS
   ============================================================ */
const cv = document.getElementById('stage');
const g = cv.getContext('2d');
let W=0, H=0, DPR=1;
let pxBase = 4;       // on-screen size of one sprite "pixel"
function resize(){
  var vw = window.innerWidth, vh = window.innerHeight;
  // On the Game Boy panel the stage IS the console's framebuffer: the games draw
  // at the LCD's own resolution, one canvas pixel per cell, and the panel shows
  // those pixels. Drawing at full device resolution and downsampling afterwards
  // is the graphics version of composing music and then squeezing it onto the
  // chip -- detail finer than a cell is authored, then thrown away by a point
  // sample, and the art never gets to be Game Boy art in the first place.
  var mode = document.documentElement.dataset.rrrScreen;
  var native = mode === 'dmg' ? window.CT_DMG_NATIVE
             : mode === 'nes' ? window.CT_NES_NATIVE : null;
  if (native) {
    W = native.w; H = native.h; DPR = 1;
    cv.width = W; cv.height = H;
    // A 16px sprite lands at about a tenth of the screen, the proportion it has
    // on the real console. The NES framebuffer is ~1.67x the Game Boy's at the
    // same window, so the divisor moves with it or sprites shrink by a third.
    pxBase = mode === 'nes' ? Math.max(3, Math.round(Math.min(W,H)/54))
                            : Math.max(2, Math.round(Math.min(W,H)/90));
  } else {
    W = vw; H = vh;
    var rawDpr = window.devicePixelRatio||1;
    var maxCanvasPixels = 3200000; // pixel art does not need a giant Retina backbuffer; keep render cost bounded.
    var area = Math.max(1, W*H);
    DPR = Math.max(1, Math.min(2, rawDpr, Math.sqrt(maxCanvasPixels/area)));
    cv.width = Math.floor(W*DPR); cv.height = Math.floor(H*DPR);
    pxBase = Math.max(3, Math.round(Math.min(W,H)/150));
  }
  cv.style.width = vw+'px'; cv.style.height = vh+'px';
  g.setTransform(DPR,0,0,DPR,0,0);
  g.imageSmoothingEnabled = false;                 // crisp pixels, not blurry scaling
}
window.addEventListener('resize', resize);
resize();

/* ---------- 8-bit sprite engine ----------
   Sprites are tiny pixel grids, pre-rendered once to offscreen canvases and
   blitted (drawImage, smoothing off) — far cheaper than the old glow particles.
   '.' = transparent, '#' = instance-tint colour, other chars -> SC palette. */
const SC = {
  '.':null, '#':'TINT',
  k:'#0c0c0c', w:'#fcfcfc', W:'#bcbcbc',
  r:'#d82800', R:'#fc7460', m:'#a80020',
  o:'#e07818', O:'#f87858', y:'#fca044', Y:'#f8d878',
  g:'#00a800', G:'#58d854', J:'#187818', j:'#0a4a0a',   // greens (mid / dark)
  b:'#0000fc', B:'#6888fc', c:'#00e8d8',
  p:'#f878f8', s:'#f8b888', h:'#a85428', t:'#7c2800',
  L:'#fcb878', q:'#e89020', n:'#fce0b0',                 // light-orange / ?-block
  u:'#2040d8', U:'#88b0f8', v:'#7858c0', V:'#3a2870',    // water / tube (dungeon / cavern)
  e:'#909090', E:'#585858',                              // stone / mountain
};
const DEFS = {
  // PLATFORMER
  coin:["..tyyt..",".tYYYYt.","tYYwwYYt","tYwwwwYt","tYYwwYYt","tYYYYYYt",".tYYYYt.","..tyyt.."],
  boost:[".tRRRRt.","tRRwwRRt","tRwwwwRt","tRRwwRRt","twwwwwwt",".twwwwt.",".twwwwt.","..twwt.."],
  extralife:[".tGGGGt.","tGGwwGGt","tGwwwwGt","tGGwwGGt","twwwwwwt",".twwwwt.",".twwwwt.","..twwt.."],
  starpow:["...YY...","...YY...",".YYYYYY.","YYYYYYYY",".YYYYYY.",".YYYYYY.",".YY..YY.","YY....YY"],
  brick:["oooooooo","ooototoo","oooooooo","otooooto","oooooooo","ooototoo","oooooooo","otooooto"],
  // DUNGEON
  gem:["...gg...","..gGGg..",".gGGGGg.","gGGwwGGg",".gGGGGg.","..gGGg..","...gg..."],
  heart:[".rr..rr.","rRRrrRRr","rRRRRRRr","rRRRRRRr",".rRRRRr.","..rRRr..","...rr..."],
  relic:["...YY...","..YYYY..",".YYYYYY.",".YY..YY.","YYY..YYY","YYYYYYYY"],
  sword:["...ww...","...ww...","...ww...","...Ww...","..YYYY..","...hh...","...hh...","...YY..."],
  // SUPER VORTEX (tintable)
  vortex:["..####..",".#....#.","#......#","#......#","#......#","#......#",".#....#.","..####.."],
  tri:["...##...","..####..",".######.","########"],
  chevron:["#......#",".#....#.","..#..#..","...##..."],
  sqring:["########","#......#","#......#","#......#","#......#","#......#","#......#","########"],
  // EXPLORER
  orbup:["..oOOo..",".oyooyo.","oyooooyo","Oootoooo","oootoooO","oyooooyo",".oyooyo.","..oOOo.."],
  cell:["wwwwwwww","wrRrRrRw","wRrRrRrw","wrRrRrRw","wwwwwwww"],
  missile:["..wwww..",".wwwwwr.","Wwwwwwwr",".wwwwwr.","..wwww.."],
  jelly:[".gGGGGg.","gGGGGGGg","gGrGGrGg","gGGGGGGg","gGrGGrGg",".gwwwwg.",".g.gg.g.","g......g"],
  // FREE (tintable icons)
  note:[".....##.",".....##.",".....##.",".....##.","..#####.",".######.",".####...","........"],
  diamond:["...##...","..####..",".######.","########",".######.","..####..","...##..."],
  plus:["...##...","...##...","...##...","########","########","...##...","...##...","...##..."],
  // accent
  spark:["##","##"],
  // ---- NES-style environment tiles (original art in the 8-bit aesthetic) ----
  gnd:["LLLLLLLL","Loooooot","Loooooot","Loooooot","Loooooot","Loooooot","Loooooot","tttttttt"],
  bush:["..JJ..JJ..JJ....",".JGGJ.JGGJ.JGGJ.","JggggggggggggggJ","JggggggggggggggJ","jJJJJJJJJJJJJJJj"],
  hill:["......JJJJ......",".....JGGGGJ.....","....JGGGGGGJ....","...JGGGGGGGGJ...","..JGGGGGGGGGGJ..",".JGGGGGGGGGGGGJ.","JGGGGGGGGGGGGGGJ","jJJJJJJJJJJJJJJj"],
  cloud:["..BB..BB..BB....",".BwwB.BwwB.BwwB.","BwwwwwwwwwwwwwwB","BwwwwwwwwwwwwwwB","BBBBBBBBBBBBBBBB"],
  qblk:["kkkkkkkkkkkkkkkk","kqqqqqqqqqqqqqqk","kqqqkkkkkkkkqqqk","kqqkkqqqqqqkkqqk","kqqqqqqqqqqkkqqk","kqqqqqqqqqkkqqqk","kqqqqqqqqkkqqqqk","kqqqqqqqkkqqqqqk","kqqqqqqkkqqqqqqk","kqqqqqqkkqqqqqqk","kqqqqqqqqqqqqqqk","kqqqqqqkkqqqqqqk","kqqqqqqkkqqqqqqk","kqqqqqqqqqqqqqqk","kqqqqqqqqqqqqqqk","kkkkkkkkkkkkkkkk"],
  walker:["....kkkkkkkk....","..kkhhhhhhhhkk..",".khhhhhhhhhhhhk.","khhhhhhhhhhhhhhk","khhwwhhhhhhwwhhk","khwwkhhhhhhkwwhk","khhhhhhhhhhhhhhk","khhhhhhhhhhhhhhk",".khhhhhhhhhhhhk.","..kkhhhhhhhhkk..","...kkkkkkkkkk...","..ww........ww..","..ww........ww..","..kk........kk.."],
  ztree:["..jJJJJJJj..",".jJGGGGGGJj.","jJGGGGGGGGJj","JGGGGGGGGGGJ","JGGjGGGGjGGJ","JGGGGGGGGGGJ","jJGGGGGGGGJj",".jJGGGGGGJj.","..jJ.hh.Jj..","....hhhh....","....hhhh....","...tttttt..."],
};
function makeSprite(rows){
  const h = rows.length, w = Math.max(...rows.map(r=>r.length));
  let tint=false;
  for(const r of rows) for(const ch of r) if(SC[ch]==='TINT') tint=true;
  const lumOf = str =>{ const m=/^#([0-9a-f]{6})$/i.exec(str||''); if(!m) return 0.5;
    const n=parseInt(m[1],16);
    return (0.299*((n>>16)&255) + 0.587*((n>>8)&255) + 0.114*(n&255))/255; };
  const bake = color =>{
    const c=document.createElement('canvas'); c.width=w; c.height=h;
    const x=c.getContext('2d');
    // On the Game Boy panel a sprite is not "these colours, quantised". A Game
    // Boy artist assigns shades by ROLE within the sprite: the darkest colour is
    // the outline that carries the silhouette, the lightest is the interior that
    // makes it read, and the field's own shade is never used or the sprite would
    // dissolve into the background. Mapping each source colour by its absolute
    // luminance instead scatters those roles across shades at random -- which is
    // why the sprites came out as unreadable mid-green mush.
    const P = (typeof CT_PAL !== 'undefined') && CT_PAL;
    let map = null;
    if(P && P.installed && P.LEVEL_BYTES){
      const seen=[];
      for(let j=0;j<h;j++) for(let i=0;i<rows[j].length;i++){
        let col=SC[rows[j][i]]; if(!col) continue;
        if(col==='TINT') col=color;
        if(seen.indexOf(col)<0) seen.push(col);
      }
      const order = seen.slice().sort((a,b)=>lumOf(a)-lumOf(b));
      map = {};
      order.forEach((col,idx)=>{
        const t = order.length>1 ? idx/(order.length-1) : 0;
        // darkest source -> level 3, which the panel's inversion turns into the
        // DARKEST ink; lightest source -> level 1. Level 0 is the field.
        // four shades, lightest included -- see spriteMap() in dmg-palette.js
        const v = P.LEVEL_BYTES[Math.max(0, Math.min(3, 3 - Math.round(t*3)))];
        map[col] = 'rgb('+v+','+v+','+v+')';
      });
    }
    for(let j=0;j<h;j++) for(let i=0;i<rows[j].length;i++){
      let col=SC[rows[j][i]]; if(!col) continue;
      if(col==='TINT') col=color;
      x.fillStyle = map ? map[col] : col;
      x.fillRect(i,j,1,1);
    }
    return c;
  };
  return tint ? {w,h,tint:true,variants:PAL.map(bake)} : {w,h,tint:false,canvas:bake('#fff')};
}
const SPRITES = {};
// Sprites are baked ONCE into offscreen canvases and then blitted with
// drawImage -- which never touches fillStyle, so the DMG palette hook cannot see
// them. Baked at module load they keep their full NES colours, and the panel
// maps that arbitrary luminance into the middle two shades: every sprite-based
// pack came out as mid-green mush on mid-green. The cache has to be rebuilt
// whenever the palette changes, not just installed around it.
function rebuildSprites(){ for(const k in DEFS) SPRITES[k] = makeSprite(DEFS[k]); }
rebuildSprites();

/* ============================================================
   VISUALIZER RUNTIME STATE
   Games run through packs/games/<key>/ via VisualizerGame.
   These globals are only the shared canvas effects and the fallback random
   montage state; game-specific state belongs inside each pack's make() result.
   ============================================================ */
let sceneKind = 'abs';
let flash=0, shake=0, flashColor='255,255,255', shock=0, shockColor='#fff';
let sceneT=0;
let curGame=null, curState=null, lastGameIdx=-1, vigT=0, lastSect='', remStage=1;

const hexToRgb = h => { const n=parseInt(h.slice(1),16); return `${(n>>16)&255},${(n>>8)&255},${n&255}`; };
const rrect = (x,y,w,h,col)=>{ g.fillStyle=col; g.fillRect(Math.round(x),Math.round(y),Math.max(1,Math.round(w)),Math.max(1,Math.round(h))); };
// reactive-visuals helpers (shared by games): HSL string + rotate a #rrggbb's hue by `deg` (keeps S/L; white/gray stay put)
