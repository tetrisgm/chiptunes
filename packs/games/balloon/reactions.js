// BALLOON FIGHT audio reaction map. Normalized music bus in, render/behavior modifiers out.
(function(){
  const H = VisualizerGame.helpers;
  function clamp(v, lo, hi){ return H.clamp(v, lo, hi); }
  function roleEnergy(roles, name, fallback){
    const r = roles && roles[name];
    return clamp(r && r.energy != null ? r.energy : fallback || 0, 0, 1);
  }
  function roleHi(roles, name, fallback){
    const r = roles && roles[name];
    if(r && typeof r.hi === 'number') return clamp(r.hi, 0, 1);
    const notes = r && r.notes || [];
    if(notes.length && typeof MV !== 'undefined' && MV.noteHi) return MV.noteHi(notes[0]);
    return fallback == null ? 0.5 : fallback;
  }
  const bindings = [
    { system:'lead balloons', bus:'roles.lead.notes + roles.lead.energy', effect:'lead notes pick balloon height, color pulse, and collection emphasis' },
    { system:'counter enemies', bus:'roles.counter.energy + roles.counter.notes', effect:'enemy flaps, separation, and hit pulse intensity' },
    { system:'bass water', bus:'roles.bass.energy + bands.bass', effect:'water waveform depth and fish tension' },
    { system:'perc bombs', bus:'roles.perc.onset + beatStrength', effect:'bomb bounce, warning pulse, and hazard spacing accents' },
    { system:'noise stars', bus:'roles.noise.energy + treble', effect:'star twinkle, foam, and sky detail' },
    { system:'world sky', bus:'barProgress + hue + energy', effect:'sky palette and cloud drift' },
    { system:'phrase stage', bus:'sectionChanged + phrase', effect:'readable cluster variation without changing hitboxes' },
    { system:'drop flock', bus:'drop + energy', effect:'short stage-wide visual lift and ordered balloon emphasis' },
    { system:'idle float', bus:'paused + silence', effect:'hold progression but keep a restrained idle pose' }
  ];
  function apply(ctx){
    const st = ctx.state;
    if(!st || st.pack !== 'balloon') return;
    const a = ctx.audio || {};
    const roles = a.roles || {};
    const leadEnergy = roleEnergy(roles, 'lead', a.energy * 0.7);
    const counterEnergy = roleEnergy(roles, 'counter', a.mid * 0.65);
    const bassEnergy = roleEnergy(roles, 'bass', a.bass);
    const percEnergy = roleEnergy(roles, 'perc', Math.max(a.beatStrength, a.bass * 0.6));
    const noiseEnergy = roleEnergy(roles, 'noise', a.treble);
    const leadHi = roleHi(roles, 'lead', a.treble * 0.6 + 0.2);
    const pulse = clamp(Math.max(a.beatStrength || 0, leadEnergy * 0.7), 0, 1);
    const drop = !!a.drop;
    st.music = {
      bpm:a.bpm || 132,
      energy:clamp(a.energy || 0, 0, 1),
      beat:pulse,
      beatHit:!!a.beat,
      leadEnergy,
      counterEnergy,
      bass:bassEnergy,
      percEnergy,
      noiseEnergy,
      leadHi,
      hue:a.hue || 0,
      barProgress:clamp(a.barProgress || 0, 0, 1),
      drop,
      paused:!!a.paused,
      idle:!!a.silence
    };
    const m = ctx.modifiers || {};
    m.paletteHue = st.music.hue;
    m.scalePulse = 0.02 + pulse * 0.11 + (drop ? 0.08 : 0);
    m.waterAmp = 2 + bassEnergy * 10 + a.energy * 5;
    m.waterFine = 1 + noiseEnergy * 4;
    m.skyLift = 0.04 + a.energy * 0.28;
    m.shake = drop ? 0.45 : clamp(bassEnergy * 0.18 + a.beatStrength * 0.06, 0, 0.25);
    m.trail = clamp(leadEnergy * 0.5 + noiseEnergy * 0.25, 0, 0.85);
    m.entityRoles = { lead:'collectibles', counter:'enemies', bass:'water', perc:'hazards', noise:'stars', world:'sky', phrase:'clusters', drop:'stagePulse', idle:'floatPose' };
    if(a.beat || pulse > 0.42){
      const cam = st.cameraX || 0;
      for(let i=0;i<st.collectibles.length;i++){
        const b = st.collectibles[i];
        if(!b.got && b.x > cam - 20 && b.x < cam + 290) b.pulse = Math.max(b.pulse || 0, pulse);
      }
      for(let i=0;i<st.hazards.length;i++){
        const h = st.hazards[i];
        if(h.alive && h.x > cam - 20 && h.x < cam + 290) h.pulse = Math.max(h.pulse || 0, percEnergy);
      }
      for(let i=0;i<st.enemies.length;i++){
        const e = st.enemies[i];
        if(e.alive) e.hit = Math.max(e.hit || 0, counterEnergy * 0.45);
      }
    }
    if(drop){
      st.dropPulse = 1;
      ctx.emit('dropPeak', { energy:st.music.energy, bpm:st.music.bpm });
    } else {
      st.dropPulse = Math.max(0, (st.dropPulse || 0) - (ctx.dt || 0) * 2.5);
    }
    st.entities.length = 0;
    st.entities.push({ role:'world', type:'sky', x:0, y:0, alive:true });
    st.entities.push({ role:'bass', type:'water', x:0, y:st.waterY, alive:true, energy:bassEnergy });
    for(let i=0;i<st.collectibles.length && st.entities.length<90;i++){
      const b = st.collectibles[i];
      if(b && !b.got) st.entities.push({ role:'lead', type:'collectibleBalloon', x:b.x, y:b.y, alive:true });
    }
    for(let i=0;i<st.hazards.length && st.entities.length<120;i++){
      const h = st.hazards[i];
      if(h && h.alive) st.entities.push({ role:'perc', type:'bomb', x:h.x, y:h.y, alive:true });
    }
    for(let i=0;i<st.enemies.length && st.entities.length<145;i++){
      const e = st.enemies[i];
      if(e && e.alive) st.entities.push({ role:'counter', type:'enemyBalloonist', x:e.x, y:e.y, alive:true });
    }
    for(let i=0;i<Math.min(8, st.stars.length);i++){
      const s = st.stars[i];
      st.entities.push({ role:'noise', type:'star', x:s.x, y:s.y, alive:true });
    }
    if(st.dropPulse > 0 || a.beatStrength > 0.88) st.entities.push({ role:'drop', type:'stagePulse', x:st.player ? st.player.x : 0, y:st.player ? st.player.y : 0, alive:true });
    if(st.music.idle) st.entities.push({ role:'idle', type:'floatPose', x:st.player ? st.player.x : 0, y:st.player ? st.player.y : 0, alive:true });
    if(a.sectionChanged) ctx.emit('sectionChanged', { barProgress:st.music.barProgress, bpm:st.music.bpm });
  }

  const BalloonReactions = {
    packVersion:2,
    key:'balloon',
    entityRoles:{ lead:'collectibles', counter:'enemies', bass:'water', perc:'hazards', noise:'stars', world:'sky', phrase:'clusters', drop:'stagePulse', idle:'floatPose' },
    systems:{ lead:'collectibles', counter:'enemies', bass:'water', perc:'hazards', noise:'stars', world:'sky', phrase:'clusters', drop:'stagePulse', idle:'floatPose' },
    targets:{ leadTarget:'collectibles', counterTarget:'enemies', bassTarget:'water', percTarget:'hazards', noiseTarget:'stars', dropTarget:'stagePulse', idleTarget:'floatPose' },
    normalizedSignals:['beat','beatStrength','bass','mid','treble','energy','barProgress','sectionChanged','drop','silence','paused','bpm','roles'],
    bindings,
    apply
  };

  VisualizerGame.layer('balloon', 'reactions', BalloonReactions);
  (typeof window !== 'undefined' ? window : globalThis).BalloonReactions = BalloonReactions;
})();
