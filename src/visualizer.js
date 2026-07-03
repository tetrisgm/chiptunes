// Shared visualizer-game contract. Every extracted game exposes definition,
// behavior, reaction, and renderer layers, then runs through this lifecycle.
const VisualizerGame = (function(){
  const pending = {};
  const LAYERS = ['definition','behavior','reactions','renderer'];
  const MAX_EVENTS = 64;

  function clamp(v, lo, hi){
    v = Number(v);
    if(!Number.isFinite(v)) v = 0;
    return Math.max(lo, Math.min(hi, v));
  }
  function hashSeed(seed){
    seed = String(seed == null ? 'seed' : seed);
    let h = 2166136261 >>> 0;
    for(let i=0;i<seed.length;i++){
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h || 0x9e3779b9;
  }
  function rng(seed){
    let s = hashSeed(seed);
    function next(){
      s += 0x6D2B79F5;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    next.seed = seed;
    next.range = function(lo, hi){ return lo + (hi - lo) * next(); };
    next.int = function(lo, hi){ return Math.floor(next.range(lo, hi + 1)); };
    next.chance = function(p){ return next() < p; };
    next.pick = function(arr){ return arr && arr.length ? arr[Math.floor(next() * arr.length) % arr.length] : undefined; };
    next.sign = function(){ return next() < 0.5 ? -1 : 1; };
    return next;
  }
  function rectsOverlap(a, b){
    if(!a || !b) return false;
    const aw = a.w == null ? 0 : a.w, ah = a.h == null ? 0 : a.h;
    const bw = b.w == null ? 0 : b.w, bh = b.h == null ? 0 : b.h;
    return a.x < b.x + bw && a.x + aw > b.x && a.y < b.y + bh && a.y + ah > b.y;
  }
  function entityPool(max, factory){
    max = Math.max(1, max || 64);
    const items = [];
    return {
      items,
      spawn: function(seed){
        let ent = null;
        for(let i=0;i<items.length;i++){
          if(!items[i].alive){
            ent = items[i];
            break;
          }
        }
        if(!ent){
          if(items.length >= max) return null;
          ent = factory ? factory(items.length) : {};
          items.push(ent);
        }
        for(const k of Object.keys(ent)) if(k !== 'id') delete ent[k];
        Object.assign(ent, seed || {}, { alive:true });
        return ent;
      },
      each: function(fn){
        for(let i=0;i<items.length;i++){
          const ent = items[i];
          if(ent && ent.alive) fn(ent, i);
        }
      },
      clear: function(){ for(let i=0;i<items.length;i++) if(items[i]) items[i].alive = false; }
    };
  }
  function fixedStep(st, dt, step, update, maxCatchUp){
    if(!st || typeof update !== 'function') return;
    step = step || 1 / 60;
    maxCatchUp = maxCatchUp || step * 5;
    st._fixedAcc = Math.min((st._fixedAcc || 0) + Math.max(0, dt || 0), maxCatchUp);
    let n = 0;
    while(st._fixedAcc >= step && n < 8){
      update(step);
      st._fixedAcc -= step;
      n++;
    }
    return n;
  }
  function makeCamera(opts){
    opts = opts || {};
    return {
      x:opts.x || 0,
      y:opts.y || 0,
      follow: function(target, dt){
        if(!target) return this;
        const lag = Math.max(0.001, opts.lag || 0.16);
        const k = clamp((dt || 0) / lag, 0, 1);
        this.x += ((target.x || 0) - this.x) * k;
        this.y += ((target.y || 0) - this.y) * k;
        return this;
      }
    };
  }
  const helpers = {
    clamp,
    hashSeed,
    rng,
    rectsOverlap,
    entityPool,
    fixedStep,
    camera:makeCamera
  };
  function manifestFor(game, key, layers){
    const def = layers && layers.definition || {};
    const base = {
      key:key || game.key || game.id || '',
      name:game.name || key || 'Untitled game',
      version:1,
      lifecycle:['make','behavior.update','definition.update','reactions.apply','renderer.render'],
      capabilities:{
        autonomousPlayer:true,
        normalizedAudio:true,
        semanticEvents:true,
        customRenderer:!!(layers && layers.renderer && typeof layers.renderer.render === 'function')
      }
    };
    return Object.assign(base, def.manifest || {}, game.manifest || {});
  }
  function bag(key){
    key = key || 'unknown';
    return pending[key] || (pending[key] = {});
  }
  function layer(key, name, value){
    if(!key || !name) return value;
    bag(key)[name] = value || {};
    if(typeof CT_GAMES !== 'undefined' && CT_GAMES[key]) install(CT_GAMES[key], key);
    return value;
  }
  function layers(key, value){
    value = value || {};
    for(const name of Object.keys(value)) layer(key, name, value[name]);
    return value;
  }
  function defaults(){
    return { definition:{}, behavior:{}, reactions:{}, renderer:{} };
  }
  function install(game, key){
    if(!game) return game;
    key = key || game.key || game.id || '';
    const merged = defaults();
    const own = game.layers || {};
    const queued = pending[key] || {};
    for(const name of Object.keys(own)){
      if(!merged[name]) merged[name] = {};
      merged[name] = Object.assign({}, merged[name], own[name] || {});
    }
    for(const name of Object.keys(queued)){
      if(!merged[name]) merged[name] = {};
      merged[name] = Object.assign({}, merged[name], queued[name] || {});
    }
    game.layers = merged;
    game.definition = merged.definition;
    game.behavior = merged.behavior;
    game.reactions = merged.reactions;
    game.renderer = merged.renderer;
    game.manifest = manifestFor(game, key, merged);
    game.pack = { key, layers:merged, manifest:game.manifest };
    if(merged.reactions && Array.isArray(merged.reactions.bindings) && (!Array.isArray(game.bindings) || game.bindings.length < merged.reactions.bindings.length)){
      game.bindings = merged.reactions.bindings;
    }
    game.getArchitecture = function(){ return this.layers; };
    return game;
  }
  function installAll(map){
    if(!map) return map;
    for(const key of Object.keys(map)) install(map[key], key);
    return map;
  }
  function ensureState(st, key){
    if(!st) st = {};
    if(!st.$viz){
      st.$viz = { key:key || 'game', frame:0, events:[], modifiers:{}, pools:{} };
    } else if(key && !st.$viz.key) {
      st.$viz.key = key;
    }
    st.$events = st.$viz.events;
    st.$modifiers = st.$viz.modifiers;
    return st.$viz;
  }
  function startFrame(st, key){
    const viz = ensureState(st, key);
    viz.frame++;
    viz.resetRequested = null;
    viz.events.length = 0;
    const m = viz.modifiers;
    for(const k of Object.keys(m)) delete m[k];
    return viz;
  }
  function emit(st, type, detail){
    const viz = ensureState(st, '');
    if(viz.events.length >= MAX_EVENTS) return null;
    const ev = { type:type || 'event', detail:detail || null };
    viz.events.push(ev);
    return ev;
  }
  function audioSignals(SND, st, key){
    const mf = (st && st._mvFrame) || (typeof MV !== 'undefined' && MV.frame ? MV.frame(SND, st, key || 'game') : null) || {};
    const cl = mf.cl || (SND && SND.clock ? SND.clock() : {}) || {};
    const gr = mf.gr || (SND && SND.grid ? SND.grid() : {}) || {};
    const bands = cl.bands || {};
    const roles = mf.roles || cl.roles || {};
    const energy = clamp(mf.energy != null ? mf.energy : (cl.energyLevel != null ? cl.energyLevel / 10 : cl.energy), 0, 1);
    const bass = clamp(bands.bass != null ? bands.bass : roles.bass && roles.bass.energy, 0, 1);
    const mid = clamp(bands.mid != null ? bands.mid : roles.pad && roles.pad.energy, 0, 1);
    const treble = clamp(bands.treble != null ? bands.treble : roles.noise && roles.noise.energy, 0, 1);
    const beatStrength = clamp(Math.max(mf.beatPulse || 0, cl.beatPulse || 0, cl.kick || 0), 0, 1);
    return {
      beat: !!mf.newBeat,
      step: !!mf.newStep,
      beatStrength,
      bass,
      mid,
      treble,
      energy,
      barProgress: clamp(cl.barPhase != null ? cl.barPhase : (((gr.gstep || 0) + (gr.phase || 0)) / 16), 0, 1),
      sectionChanged: !!mf.newBar,
      drop: !!(mf.dropEdge || mf.drop),
      silence: !!(mf.idle || cl.idle || cl.paused),
      paused: !!(mf.paused || cl.paused),
      bpm: Math.max(1, mf.bpm || gr.bpm || cl.bpm || 120),
      spb: mf.spb || gr.spb || 60 / Math.max(1, mf.bpm || gr.bpm || cl.bpm || 120),
      hue: mf.barHue || (typeof MV !== 'undefined' && MV.barHue ? MV.barHue(cl) : 0),
      roles,
      raw: mf
    };
  }
  const PROGRESS_EVENTS = {
    levelComplete:1, courseStarted:1, roomCleared:1, pickupCollected:1, coinCollected:1,
    pelletCollected:1, powerPelletCollected:1, ghostEaten:1, enemyDestroyed:1,
    waveCleared:1, lapComplete:1, lineClear:1, brickBroken:1, fruitCollected:1,
    goalReached:1, stageClear:1
  };
  const FAIL_EVENTS = {
    playerDied:1, playerDeath:1, death:1, lifeLost:1, roundReset:1, stuck:1,
    sectionLooped:1, pitFall:1, respawned:1
  };
  function finite(v, fallback){
    v = Number(v);
    return Number.isFinite(v) ? v : (fallback || 0);
  }
  function quant(v, unit){
    unit = unit || 1;
    return Math.round(finite(v, 0) / unit);
  }
  function objCount(o){
    if(!o || typeof o !== 'object') return 0;
    let n = 0;
    for(const k of Object.keys(o)) if(o[k]) n++;
    return n;
  }
  function aliveCount(arr){
    if(!Array.isArray(arr)) return null;
    let n = 0;
    for(let i=0;i<arr.length;i++){
      const it = arr[i];
      if(!it) continue;
      if(it.gone || it.dead || it.alive === false) continue;
      n++;
    }
    return n;
  }
  function remainingCount(arr){
    if(!Array.isArray(arr)) return null;
    let n = 0;
    for(let i=0;i<arr.length;i++){
      const it = arr[i];
      if(!it) continue;
      if(it.got || it.used || it.collected || it.gone || it.dead || it.alive === false) continue;
      n++;
    }
    return n;
  }
  function readXY(o){
    if(!o) return null;
    const x = o.x != null ? o.x : (o.px != null ? o.px : (o.c != null ? o.c : (o.cx != null ? o.cx : (o.lane != null ? o.lane : (o.a != null ? o.a : o.cursorA)))));
    const y = o.y != null ? o.y : (o.py != null ? o.py : (o.r != null ? o.r : (o.cy != null ? o.cy : (o.row != null ? o.row : (o.angle != null ? o.angle : o.rot)))));
    if(x == null && y == null) return null;
    return { x:finite(x, 0), y:finite(y, 0) };
  }
  function avatarOf(st){
    if(!st) return null;
    const names = ['mario','link','pac','player','hero','ship','bike','frog','balloon','runner','jumper','cursor','paddle','qbert','climber'];
    for(const name of names){
      const p = readXY(st[name]);
      if(p) return p;
    }
    if(st.cursorA != null || st.rot != null) return { x:finite(st.cursorA, 0), y:finite(st.rot, 0) };
    return null;
  }
  function roomKeyOf(st){
    if(!st) return '';
    if(st.roomX != null || st.roomY != null) return String(st.roomX || 0) + '_' + String(st.roomY || 0);
    if(st.rx != null || st.ry != null) return String(st.rx || 0) + '_' + String(st.ry || 0);
    if(st.room && (st.room.x != null || st.room.y != null)) return String(st.room.x || 0) + '_' + String(st.room.y || 0);
    return '';
  }
  function inferWatchdogMode(key, st, game){
    const cfg = watchdogConfig(game);
    if(cfg.mode) return cfg.mode;
    if(key === 'hexagon') return 'survival';
    if(st && (st.roomX != null || st.roomY != null || st.roomVisits || (st.world && (st.world.horiz || st.world.vert)))) return 'rooms';
    if(st && (st.cameraX != null || st.worldX != null || st.scrollX != null || st.segmentIndex != null || st.nextX != null)) return 'scroll';
    if(st && (st.dots != null || st.totalDots != null || Array.isArray(st.pellets))) return 'single-objective';
    return 'single';
  }
  function watchdogConfig(game){
    if(!game) return {};
    const ly = game.layers || {};
    const def = ly.definition || game.definition || {};
    return game.watchdog || def.watchdog || {};
  }
  function watchdogLimits(mode, cfg){
    const base = {
      warmup:8,
      cooldown:12,
      failureWindow:12,
      failureCount:3,
      loop:11,
      motion:12,
      progress:60
    };
    if(mode === 'scroll'){
      base.progress = 22;
      base.motion = 9;
      base.loop = 10;
    } else if(mode === 'rooms'){
      base.progress = 30;
      base.motion = 12;
      base.loop = 10;
    } else if(mode === 'single-objective'){
      base.progress = 70;
      base.motion = 14;
      base.loop = 16;
    } else if(mode === 'survival'){
      base.progress = 9999;
      base.motion = 14;
      base.loop = 16;
    }
    if(cfg){
      for(const k of Object.keys(base)) if(cfg[k] != null) base[k] = Math.max(0, Number(cfg[k]) || base[k]);
    }
    return base;
  }
  function eventList(viz, st){
    const out = [];
    if(viz && Array.isArray(viz.events)) for(let i=0;i<viz.events.length;i++) out.push(viz.events[i]);
    if(st && Array.isArray(st.events)) for(let i=0;i<st.events.length;i++) out.push(st.events[i]);
    return out;
  }
  function eventType(ev){
    return ev && (ev.type || ev.name || ev.event) || '';
  }
  function hasProgressEvent(events){
    for(let i=0;i<events.length;i++) if(PROGRESS_EVENTS[eventType(events[i])]) return true;
    return false;
  }
  function collectFailures(events, age){
    const out = [];
    for(let i=0;i<events.length;i++){
      const ev = events[i], t = eventType(ev);
      if(!FAIL_EVENTS[t]) continue;
      if(t === 'sectionLooped' && ev.detail && ev.detail.reason && ev.detail.reason !== 'fall') continue;
      out.push({ t:age, type:t });
    }
    return out;
  }
  function extractWatchMetric(st, key, mode, wd){
    const avatar = avatarOf(st);
    const roomKey = roomKeyOf(st);
    const roomSeenBefore = !!(roomKey && wd.seenRooms && wd.seenRooms[roomKey]);
    const parts = [];
    const sig = [];
    const motion = [];
    const score = finite(st && st.score, 0);
    const level = finite(st && (st.level != null ? st.level : st.stage), 0);
    const wave = finite(st && (st.wave != null ? st.wave : st.round), 0);
    const segment = finite(st && st.segmentIndex, 0);
    const camera = finite(st && (st.cameraX != null ? st.cameraX : (st.worldX != null ? st.worldX : st.scrollX)), 0);
    parts.push('score:' + quant(score, 10));
    parts.push('level:' + quant(level, 1));
    parts.push('wave:' + quant(wave, 1));
    const enemies = aliveCount(st && st.enemies);
    const ghosts = aliveCount(st && st.ghosts);
    const coins = remainingCount(st && st.coins);
    const pickups = remainingCount(st && (st.pickups || st.pellets));
    if(enemies != null) parts.push('en:' + enemies);
    if(ghosts != null) parts.push('gh:' + ghosts);
    if(coins != null) parts.push('co:' + coins);
    if(pickups != null) parts.push('pk:' + pickups);
    if(st && st.dots != null) parts.push('dots:' + quant(st.dots, 1));
    if(st && st.lines != null) parts.push('lines:' + quant(st.lines, 1));
    if(mode === 'scroll'){
      parts.push('cam:' + quant(camera, 24));
      parts.push('seg:' + quant(segment, 1));
      if(avatar) parts.push('ax:' + quant(avatar.x, 28));
    } else if(mode === 'rooms'){
      if(roomKey){
        if(!roomSeenBefore) parts.push('newRoom:' + roomKey);
        parts.push('seen:' + objCount(wd.seenRooms));
      }
      if(st && st.keys != null) parts.push('keys:' + quant(st.keys, 1));
      if(st && st.visitCount != null) parts.push('visits:' + quant(st.visitCount, 1));
    } else if(mode === 'survival'){
      parts.push('survive:' + quant(st && (st.surviveT || st.time || st.t), 4));
    }
    if(avatar){
      motion.push('x:' + quant(avatar.x, mode === 'rooms' ? 0.4 : 10));
      motion.push('y:' + quant(avatar.y, mode === 'rooms' ? 0.4 : 10));
    }
    motion.push('cam:' + quant(camera, 16));
    motion.push('rot:' + quant(st && (st.rot != null ? st.rot : st.angle), 0.12));
    sig.push(parts.join('|'));
    return {
      objectiveSig:sig.join('/'),
      motionSig:motion.join('|'),
      roomKey,
      newRoom:!!(roomKey && !roomSeenBefore),
      loopSig:(mode === 'rooms' && roomKey) ? roomKey : (parts.slice(0, 7).join('|') + '@' + motion.join('|'))
    };
  }
  function repeatsWithPeriod(arr, period, count){
    if(arr.length < count || period <= 0) return false;
    const start = arr.length - count;
    const uniques = {};
    for(let i=start;i<arr.length;i++) uniques[arr[i]] = 1;
    if(Object.keys(uniques).length < 2) return false;
    for(let i=start;i<arr.length-period;i++){
      if(arr[i] !== arr[i + period]) return false;
    }
    return true;
  }
  function loopDetected(wd, mode){
    const samples = wd.samples || [];
    if(repeatsWithPeriod(samples, 2, 8) || repeatsWithPeriod(samples, 3, 9)) return true;
    if(mode === 'rooms'){
      const rooms = wd.roomSamples || [];
      if(repeatsWithPeriod(rooms, 2, 6) || repeatsWithPeriod(rooms, 3, 9)) return true;
      const path = wd.roomPath || [];
      if(repeatsWithPeriod(path, 2, 6) || repeatsWithPeriod(path, 3, 9)) return true;
    }
    return false;
  }
  function updateWatchdog(full, viz){
    const st = full && full.state, game = full && full.game, key = full && full.key || 'game';
    if(!st || !viz) return null;
    const cfg = watchdogConfig(game);
    if(cfg.disabled) return null;
    const dt = Math.max(0, Math.min(0.25, finite(full.dt, 0)));
    const input = full.IN || {};
    const audio = full.audio || {};
    const wd = viz.watchdog || (viz.watchdog = {
      age:0, sinceProgress:0, sinceMotion:0, cooldown:0, sampleT:0,
      lastObjectiveSig:null, lastMotionSig:null, lastRoomKey:null,
      seenRooms:{}, samples:[], roomSamples:[], roomPath:[], failTimes:[]
    });
    const mode = inferWatchdogMode(key, st, game);
    const limits = watchdogLimits(mode, cfg);
    if(dt <= 0 || audio.paused || input.active){
      wd.cooldown = Math.max(0, wd.cooldown - dt);
      return null;
    }
    wd.age += dt;
    wd.sinceProgress += dt;
    wd.sinceMotion += dt;
    wd.cooldown = Math.max(0, wd.cooldown - dt);
    const metric = extractWatchMetric(st, key, mode, wd);
    if(metric.roomKey && !wd.seenRooms[metric.roomKey]) wd.seenRooms[metric.roomKey] = 1;
    if(metric.roomKey && metric.roomKey !== wd.lastRoomKey){
      wd.lastRoomKey = metric.roomKey;
      wd.roomPath.push(metric.roomKey);
      if(wd.roomPath.length > 18) wd.roomPath.shift();
    }
    const events = eventList(viz, st);
    const progressEvent = hasProgressEvent(events);
    const failures = collectFailures(events, wd.age);
    for(let i=0;i<failures.length;i++) wd.failTimes.push(failures[i].t);
    while(wd.failTimes.length && wd.age - wd.failTimes[0] > limits.failureWindow) wd.failTimes.shift();
    let progress = false;
    let motion = false;
    if(wd.lastObjectiveSig == null){
      wd.lastObjectiveSig = metric.objectiveSig;
      wd.lastMotionSig = metric.motionSig;
      wd.sinceProgress = 0;
      wd.sinceMotion = 0;
      progress = true;
      motion = true;
    } else {
      progress = progressEvent || metric.newRoom || metric.objectiveSig !== wd.lastObjectiveSig;
      motion = metric.motionSig !== wd.lastMotionSig;
      if(progress){
        wd.sinceProgress = 0;
        wd.lastObjectiveSig = metric.objectiveSig;
      }
      if(motion){
        wd.sinceMotion = 0;
        wd.lastMotionSig = metric.motionSig;
      }
    }
    wd.sampleT += dt;
    if(wd.sampleT >= 0.55){
      wd.sampleT = 0;
      wd.samples.push(metric.loopSig);
      if(wd.samples.length > 18) wd.samples.shift();
      if(metric.roomKey){
        wd.roomSamples.push(metric.roomKey);
        if(wd.roomSamples.length > 14) wd.roomSamples.shift();
      }
    }
    const loop = loopDetected(wd, mode);
    let reason = '';
    if(wd.age >= limits.warmup && wd.cooldown <= 0){
      if(wd.failTimes.length >= limits.failureCount && wd.sinceProgress > 5) reason = 'repeated-failure';
      else if(loop && wd.sinceProgress > limits.loop) reason = mode === 'rooms' ? 'room-loop' : 'state-loop';
      else if(wd.sinceMotion > limits.motion && wd.sinceProgress > Math.min(limits.progress, limits.motion + 4)) reason = 'motion-stall';
      else if((mode === 'scroll' || mode === 'rooms') && wd.sinceProgress > limits.progress) reason = 'no-objective-progress';
    }
    if(!reason) return null;
    const reset = {
      reason,
      key,
      mode,
      age:+wd.age.toFixed(2),
      sinceProgress:+wd.sinceProgress.toFixed(2),
      sinceMotion:+wd.sinceMotion.toFixed(2),
      failures:wd.failTimes.length
    };
    wd.cooldown = limits.cooldown;
    wd.sinceProgress = 0;
    wd.sinceMotion = 0;
    wd.samples.length = 0;
    wd.roomSamples.length = 0;
    wd.roomPath.length = 0;
    wd.failTimes.length = 0;
    viz.resetRequested = reset;
    emit(st, 'watchdogReset', reset);
    return reset;
  }
  function defaultReaction(ctx){
    const a = ctx.audio || {};
    const m = ctx.modifiers || {};
    m.scalePulse = clamp(0.025 + a.beatStrength * 0.08 + a.energy * 0.035, 0, 0.18);
    m.paletteHue = a.hue || 0;
    m.energy = clamp(a.energy || 0, 0, 1);
    m.shake = clamp(a.bass * 0.7 + a.beatStrength * 0.3, 0, 1);
    m.trail = clamp((a.energy * 0.7 + a.treble * 0.3), 0, 1);
    m.brightness = clamp(0.55 + a.energy * 0.35 + a.beatStrength * 0.1, 0, 1);
    if(a.drop) emit(ctx.state, 'audioDrop', { energy:a.energy, bpm:a.bpm });
    if(a.sectionChanged) emit(ctx.state, 'sectionChanged', { barProgress:a.barProgress, bpm:a.bpm });
  }
  function run(game, ctx){
    if(!game || !ctx) return;
    const key = game.key || ctx.key || game.name || 'game';
    install(game, key);
    const state = ctx.state || {};
    const viz = startFrame(state, key);
    const audio = audioSignals(ctx.SND, state, key);
    const full = Object.assign({}, ctx, {
      key,
      game,
      state,
      audio,
      events: viz.events,
      modifiers: viz.modifiers,
      helpers,
      emit: function(type, detail){ return emit(state, type, detail); }
    });
    const ly = game.layers || {};
    if(ly.behavior && typeof ly.behavior.update === 'function') ly.behavior.update(full);
    if(ly.definition && typeof ly.definition.update === 'function') ly.definition.update(full);
    if(ly.definition && ly.definition.rules && typeof ly.definition.rules.update === 'function') ly.definition.rules.update(full);
    updateWatchdog(full, viz);
    if(ly.reactions && typeof ly.reactions.apply === 'function') ly.reactions.apply(full);
    else defaultReaction(full);
    if(ly.renderer && typeof ly.renderer.render === 'function') return ly.renderer.render(full);
    return state;
  }
  function audit(keys){
    const out = [];
    const map = typeof CT_GAMES !== 'undefined' ? CT_GAMES : {};
    for(const key of keys || Object.keys(map)){
      const game = map[key];
      if(!game){ out.push({ key, missing:'game' }); continue; }
      install(game, key);
      const missing = [];
      for(const name of LAYERS) if(!game.layers || !game.layers[name]) missing.push(name);
      if(!Array.isArray(game.bindings) || game.bindings.length < 1) missing.push('bindings');
      out.push({ key, ok:missing.length === 0, missing });
    }
    return out;
  }

  return { layer, layers, install, installAll, run, emit, ensureState, audioSignals, defaultReaction, audit, helpers, clamp, hashSeed, rng, rectsOverlap, entityPool, fixedStep, camera:makeCamera };
})();
if(typeof window !== 'undefined') window.VisualizerGame = VisualizerGame;
