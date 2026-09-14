// Local integration with upstream Strudel. Distribution license review is tracked
// in docs/algorave-runtime-decisions.md; this prototype is not a release artifact.
import { initStrudel, getAudioContext, initAudio, getSuperdoughAudioController, webaudioOutput, samples, loadBuffer } from '@strudel/web';
import { drumWav } from './drum-samples.mjs';

// User code shares only this opaque-origin frame. It never receives parent storage,
// cookies, auth state or a callable parent API. Capture the port before evaluation.
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
    const repl = await initStrudel({
      defaultOutput(hap, deadline, duration, cps, time) {
        if (events.length < 256) events.push({ time, sound: String(hap.value?.s || '').slice(0, 64), cycle: Number(hap.whole?.begin) || 0 });
        return webaudioOutput(hap, deadline, duration, cps, time);
      },
    });
    for (const name of ['bd', 'sd', 'hh']) {
      const url = URL.createObjectURL(new Blob([drumWav(name)], { type: 'audio/wav' }));
      sampleURLs.push(url);
      await samples({ [name]: [url] });
      await loadBuffer(url, audio, name);
    }
    const frequency = new Uint8Array(512), waveform = new Uint8Array(512);
    port.onmessage = async ({ data }) => {
      if (!data || !Number.isSafeInteger(data.id) || !['run', 'stop'].includes(data.type)) return;
      if (busy) { send({ type: 'reply', id: data.id, error: 'Another edit is still running.' }); return; }
      busy = true;
      try {
        if (data.type === 'stop') {
          repl.stop(); epoch++;
          events.length = 0;
        } else {
          if (typeof data.source !== 'string' || data.source.length > 65536) throw Error('Music code is too large.');
          await initAudio();
          await audio.resume();
          if (!analyser) {
            analyser = audio.createAnalyser();
            analyser.fftSize = 1024;
            analyser.smoothingTimeConstant = 0.5;
            getSuperdoughAudioController().output.destinationGain.connect(analyser);
          }
          if (!repl.state.started) { epoch++; events.length = 0; }
          await repl.evaluate(data.source, true);
          if (repl.state.error) throw repl.state.error;
        }
        send({ type: 'reply', id: data.id, playing: repl.state.started, source: repl.state.activeCode });
      } catch (error) {
        send({ type: 'reply', id: data.id, error: String(error.message || error).slice(0, 2000), playing: repl.state.started });
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
        cycle: repl.scheduler.now() - (repl.state.started ? lag * repl.scheduler.cps : 0), cps: repl.scheduler.cps, playing: repl.state.started,
        sampleRate: audio.sampleRate, frequency, waveform, events: events.splice(0) });
    }, 1000 / 30);
    window.addEventListener('pagehide', () => { clearInterval(timer); repl.stop(); audio.close(); sampleURLs.forEach(url => URL.revokeObjectURL(url)); });
    send({ type: 'ready', version: 'strudel-web-1.3.0' });
  } catch (error) { send({ type: 'fatal', error: String(error.message || error).slice(0, 2000) }); }
});
