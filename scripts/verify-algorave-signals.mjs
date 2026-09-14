import assert from 'node:assert/strict';
import { MusicSignals } from '../src/algorave/music-signals.mjs';
import { drumWav } from '../src/algorave/drum-samples.mjs';
const signals = new MusicSignals();
const base = { epoch: 1, observedAt: 1000, time: 10, cycle: 3, cps: .5, playing: true,
  sampleRate: 48000, frequency: new Uint8Array(512), waveform: new Uint8Array(512), events: [{time:10.1,sound:'bd'}] };
signals.receive(base);
assert.equal(signals.at(1000).kick,0,'scheduled future kick must not fire early');
assert.equal(signals.at(1100).kick,1,'envelope begins at the audio event deadline');
assert(Math.abs(signals.at(1200).kick-Math.exp(-1.4))<1e-10);
assert.equal(signals.at(1200).cycle,3.1);
signals.receive({...base,observedAt:1200,time:10.2,cycle:3.1,cps:1,events:[]});
assert.equal(signals.at(1300).cycle,3.2,'tempo changes extrapolate from the new shared clock');
assert.equal(signals.at(999999).cycle,3.35,'background extrapolation is bounded');
signals.receive({...base,epoch:2,events:[{time:10,sound:'sd'}]});
assert.equal(signals.at(1000).kick,0,'other drums and previous transport do not trigger kick');
signals.receive({...base,epoch:3,playing:false});
assert.equal(signals.at(1100).kick,0);assert.equal(signals.at(1100).cycle,0);
for(const kind of ['bd','sd','hh']) {
  const bytes=drumWav(kind),view=new DataView(bytes);
  assert.equal(new TextDecoder().decode(bytes.slice(0,4)),'RIFF');
  assert.equal(view.getUint32(40,true),bytes.byteLength-44);
  assert.equal(view.getUint32(24,true),22050);
  assert.deepEqual(new Uint8Array(bytes),new Uint8Array(drumWav(kind)),'original sample is repeatable');
  let peak=0,energy=0;
  for(let i=44;i<bytes.byteLength;i+=2){const v=view.getInt16(i,true)/32768;peak=Math.max(peak,Math.abs(v));energy+=v*v;}
  assert(peak>.2&&peak<.9);assert(energy>1,'nonempty PCM');
}
console.log('PASS: audio deadline envelopes, tempo extrapolation, stopped/old-event rejection, bounded timing and original PCM sample integrity.');
