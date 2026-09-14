// Local integration with upstream Strudel. Distribution license review is tracked
// in docs/algorave-runtime-decisions.md; this prototype is not a release artifact.
import { createClock, registerSynthSounds, getAudioContext, initAudio, getSuperdoughAudioController, superdough, samples, loadBuffer } from '@strudel/web';
import { PatternClient } from './pattern-client.mjs';
import { PatternTransport } from './pattern-transport.mjs';
import { drumWav } from './drum-samples.mjs';

// This opaque-origin audio frame receives bounded event data from isolated
// workers. User source never executes here or receives private app state.
let connected = false;
window.addEventListener('message', async function connect(event) {
  if (connected || event.source !== parent || event.data?.type !== 'connect' || event.ports.length !== 1) return;
  connected = true;
  const port = event.ports[0];
  const send = port.postMessage.bind(port);
  let busy = false, analyser, timer, sequence = 0, epoch = 0;
  const sampleURLs = [];
  const events = [];
  try {
    const audio = getAudioContext();
    await registerSynthSounds();
    const transport = new PatternTransport({clockFactory:createClock,getTime:()=>audio.currentTime,
      output(event, time, duration, cps) {
        if (events.length < 256) events.push({time, sound:String(event.value.s || '').slice(0,64), cycle:event.begin});
        return superdough(event.value, time, duration, cps, event.begin);
      },
      onError(error) { epoch++; events.length=0; send({type:'runtime-error',error:('Playback stopped. '+String(error.message||error)).slice(0,2000)}); },
    });
    for (const name of ['bd', 'sd', 'hh']) {
      const url = URL.createObjectURL(new Blob([drumWav(name)], { type: 'audio/wav' }));
      sampleURLs.push(url);
      await samples({ [name]: [url] });
      await loadBuffer(url, audio, name);
    }
    let candidate = null, candidateId = 0;
    async function prepare(source) {
      if (typeof source !== 'string' || source.length > 65536) throw Error('Music code is too large.');
      candidate?.client.dispose(); candidate=null;
      const client = new PatternClient(PATTERN_WORKER_SOURCE);
      try {
        const now=Math.max(0,transport.position(audio.currentTime).cycle);
        await client.prepare(source,transport.cps,now);
        for(const start of [0,now,now+1])await client.query(start,start+1,client.cps);
        const token=++candidateId;candidate={token,client};return token;
      } catch(error) { client.dispose();throw error; }
    }
    async function commit(token, play) {
      if (!candidate || candidate.token !== token) throw Error('Music candidate expired. Run again.');
      await initAudio();
      if (play) await audio.resume();
      if (!analyser) {
        analyser = audio.createAnalyser(); analyser.fftSize = 1024; analyser.smoothingTimeConstant = 0.5;
        getSuperdoughAudioController().output.destinationGain.connect(analyser);
      }
      if (!transport.playing || !play) { epoch++; events.length=0; }
      transport.set(candidate.client,play);candidate=null;
    }
    const frequency = new Uint8Array(512), waveform = new Uint8Array(512);
    port.onmessage = async ({ data }) => {
      if (!data || !Number.isSafeInteger(data.id) || !['run', 'stop', 'prepare', 'commit', 'discard'].includes(data.type)) return;
      if (busy) { send({ type: 'reply', id: data.id, error: 'Another edit is still running.' }); return; }
      busy = true;
      try {
        if (data.type === 'stop') {
          transport.stop(); epoch++; candidate?.client.dispose(); candidate = null;
          events.length = 0;
        } else if (data.type === 'discard') {
          if (candidate?.token === data.token) { candidate.client.dispose(); candidate = null; }
        } else if (data.type === 'prepare') {
          const token = await prepare(data.source);
          send({ type: 'reply', id: data.id, token, playing: transport.playing });
          return;
        } else if (data.type === 'commit') {
          await commit(data.token, data.play === true);
        } else {
          await commit(await prepare(data.source), true);
        }
        send({ type: 'reply', id: data.id, playing: transport.playing });
      } catch (error) {
        send({ type: 'reply', id: data.id, error: String(error.message || error).slice(0, 2000), playing: transport.playing });
      } finally { busy = false; }
    };
    port.start();
    timer = setInterval(() => {
      if (!analyser) return;
      analyser.getByteFrequencyData(frequency);
      analyser.getByteTimeDomainData(waveform);
      const stamp = audio.getOutputTimestamp?.();
      const lag = stamp?.contextTime > 0 ? Math.max(0, Math.min(.5, audio.currentTime - stamp.contextTime)) : Math.max(0, Math.min(.5, (audio.baseLatency || 0) + (audio.outputLatency || 0)));
      send({ type: 'signal', sequence: ++sequence, epoch, observedAt: performance.timeOrigin + performance.now(), time: audio.currentTime - lag,
        ...transport.position(audio.currentTime - lag), playing: transport.playing,
        sampleRate: audio.sampleRate, frequency, waveform, events: events.splice(0) });
    }, 1000 / 30);
    window.addEventListener('pagehide', () => { clearInterval(timer); candidate?.client.dispose(); transport.dispose(); audio.close(); sampleURLs.forEach(url => URL.revokeObjectURL(url)); });
    send({ type: 'ready', version: 'strudel-web-1.3.0' });
  } catch (error) { send({ type: 'fatal', error: String(error.message || error).slice(0, 2000) }); }
});
