'use strict';
const assert = require('assert');
const {Apu} = require('../src/gb-apu');
const {Sequencer} = require('../src/gb-apu');
const {buildRom} = require('../src/gb-rom');
const {Cpu} = require('../src/gb-cpu');

// Independent hardware expectations: Pan Docs Audio details / Obscure Behavior
// documents x8 -> x8 increment modulo 16 without restarting the voice. This is
// not a model of all NRx2 glitches, nor a native LSDj envelope scheduler.
const channels = [{ch:0,env:0x12,trigger:0x14},{ch:1,env:0x17,trigger:0x19},{ch:3,env:0x21,trigger:0x23}];
let cases = 0;
for (const {ch,env,trigger} of channels) for (let initial=0;initial<16;initial++) {
  const apu=new Apu(44100), c=apu.ch[ch];
  apu.write(env,(initial<<4)|8);
  assert.strictEqual(c.on,false,'envelope write alone does not start a channel');
  apu.write(trigger,0x80);
  assert.strictEqual(c.vol,initial);
  // Give the oscillator/sequence observable state; NRx2 may not reset it.
  c.t=123;c.pos=3;c.lfsr=0x4567;c.ec=4;
  const state=()=>[c.t,c.pos,c.lfsr,c.ec,c.freq,c.on];
  const held=state();
  for(let i=1;i<=32;i++) {
    apu.write(env,8);
    assert.strictEqual(c.vol,(initial+i)&15,'manual increment wraps at four bits');
    assert.deepStrictEqual(state(),held,'manual volume does not retrigger oscillator or timer');
  }
  for(let i=0;i<15;i++) apu.write(env,8);
  assert.strictEqual(c.vol,(initial+15)&15,'15 portable increments decrement one');
  assert.strictEqual(c.on,true,'zero volume does not switch off the DAC');
  for(let i=0;i<100;i++) apu._clockEnv();
  assert.strictEqual(c.vol,(initial+15)&15,'pace-zero software envelope holds through clocks');
  apu.write(env,0);
  assert.strictEqual(c.on,false,'explicit DAC-off kills');
  const killed=c.vol;apu.write(env,8);
  assert.strictEqual(c.vol,killed,'writing to an inactive channel does not alter its live volume');
  assert.strictEqual(c.on,false,'DAC re-enable is not a trigger');
  apu.write(trigger,0x80);
  assert.strictEqual(c.vol,0,'trigger reloads the latest initial volume');
  cases++;
}

for (const {ch,env,trigger} of channels) for (const dir of [0,1]) {
  const apu=new Apu(),c=apu.ch[ch];
  apu.write(env,dir?0xE9:0x11);apu.write(trigger,0x80);
  apu._clockEnv();assert.strictEqual(c.vol,dir?15:0);
  apu._clockEnv();assert.strictEqual(c.envActive,false,'automatic overflow locks the envelope');
  apu.write(env,8);apu.write(env,8);
  assert.strictEqual(c.vol,dir?15:0,'locked envelope is not a portable manual-increment source');
  apu.write(trigger,0x80);
  assert.strictEqual(c.envActive,true,'trigger releases envelope lock');
  apu.write(env,8);assert.strictEqual(c.vol,1);
  cases++;
}

// Ordinary retriggered hardware envelopes keep their initial-volume contract,
// even when the preceding NRx2 write performs a manual increment first.
for (const {ch,env,trigger} of channels) {
  const apu=new Apu(),c=apu.ch[ch];
  apu.write(env,0x58);apu.write(trigger,0x80);
  apu.write(env,0xA8);assert.strictEqual(c.vol,6);
  apu.write(trigger,0x80);assert.strictEqual(c.vol,10);
}
// Integration: repeated identical writes must not be deduplicated by either
// the browser automation lane or cartridge event encoder. Both use our APU,
// so this proves transport/order, not independent physical-chip validation.
for (const {ch,env} of channels) {
  const auto=[{f:20,r:env,v:8},...Array.from({length:15},()=>({f:30,r:env,v:8}))];
  const score={gb:{bank:{instruments:[[ch===3?0x13:0x80,0x88,0xff,0]],waveTables:[]},
    notes:[{ch,frame:10,frames:40,midi:60,inst:0,vel:1,pri:8}],
    auto,vibOff:ch<2?[{f:10,ch}]:[],totalFrames:60,loopFrames:0}};
  const seq=new Sequencer(score.gb,44100), browser=[],cartridge=[];
  function observe(apu,output) {
    const write=apu.write.bind(apu);
    apu.write=(r,v)=>{
      const manual=r===env&&v===8&&apu.ch[ch].on;
      write(r,v);if(manual)output.push(apu.ch[ch].vol);
    };
  }
  observe(seq.apu,browser);
  for(let f=0;f<60;f++)seq._runFrame();
  const apu=new Apu();observe(apu,cartridge);
  const cpu=new Cpu(buildRom(score),{
    onIo:(r,v)=>{if(r>=0x10&&r<=0x3f)apu.write(r,v);},
    onCycles:cycles=>apu._advance(cycles)
  });
  while(cpu.frame<60)cpu.step();
  const expected=Array.from({length:16},(_,i)=>(9+i)&15);
  assert.deepStrictEqual(browser,expected,'browser retains every manual volume write');
  assert.deepStrictEqual(cartridge,expected,'cartridge retains every manual volume write');
}
console.log(`PASS manual APU envelope: ${cases} channel/volume/lock cases, retriggers and three browser/cartridge write-order cases`);
