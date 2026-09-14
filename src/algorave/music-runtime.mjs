// Local integration with upstream Strudel. Distribution license review is tracked
// in docs/algorave-runtime-decisions.md; this prototype is not a release artifact.
import { initStrudel, getAudioContext, initAudio, getSuperdoughAudioController, webaudioOutput, samples, loadBuffer, webaudioRepl, transpiler, setTime, Pattern } from '@strudel/web';
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
    let candidate = null, candidateId = 0;
    async function prepare(source) {
      if (typeof source !== 'string' || source.length > 65536) throw Error('Music code is too large.');
      candidate = null;
      // An upstream REPL evaluates labels/transforms without starting its clock.
      // Only the primary REPL ever schedules audio. A candidate keeps its pattern
      // closures locally; no executable objects cross the private message port.
      const stage = webaudioRepl({ audioContext: audio, transpiler });
      let tempo = repl.scheduler.cps, active = false;
      Object.defineProperty(stage.scheduler, 'cps', { get: () => active ? repl.scheduler.cps : tempo, set: value => { tempo = value; } });
      stage.scheduler.now = () => repl.scheduler.now();
      stage.scheduler.start = async () => { throw Error('Use Play after applying music.'); };
      const previousPlay = Pattern.prototype.play;
      Pattern.prototype.play = function () { return this.p('$'); };
      try {
        await stage.evaluate(source, false);
        if (stage.state.error) throw stage.state.error;
        if (!Number.isFinite(tempo) || tempo <= 0 || tempo > 20) throw Error('Tempo must be between 0 and 1200 cycles per minute.');
        const pattern = stage.state.pattern;
        // Exercise representative query windows before committing lazy patterns.
        const now = Math.max(0, repl.scheduler.now());
        for (const start of [0, now, now + 1]) {
          const events = pattern.queryArc(start, start + 1, { _cps:tempo });
          if (!Array.isArray(events) || events.length > 4096) throw Error('The pattern is too dense.');
        }
        const token = ++candidateId;
        candidate = { token, source, pattern, tempo, activate: () => { active = true; } };
        return token;
      } finally { Pattern.prototype.play = previousPlay; setTime(() => repl.scheduler.now()); }
    }
    async function commit(token, play) {
      if (!candidate || candidate.token !== token) throw Error('Music candidate expired. Run again.');
      const selected = candidate;
      await initAudio();
      if (play) await audio.resume();
      if (!analyser) {
        analyser = audio.createAnalyser(); analyser.fftSize = 1024; analyser.smoothingTimeConstant = 0.5;
        getSuperdoughAudioController().output.destinationGain.connect(analyser);
      }
      if (!repl.state.started && play) { epoch++; events.length = 0; }
      repl.setCps(selected.tempo); selected.activate();
      await repl.setPattern(selected.pattern, play);
      repl.state.activeCode = selected.source;
      candidate = null;
    }
    const frequency = new Uint8Array(512), waveform = new Uint8Array(512);
    port.onmessage = async ({ data }) => {
      if (!data || !Number.isSafeInteger(data.id) || !['run', 'stop', 'prepare', 'commit', 'discard'].includes(data.type)) return;
      if (busy) { send({ type: 'reply', id: data.id, error: 'Another edit is still running.' }); return; }
      busy = true;
      try {
        if (data.type === 'stop') {
          repl.stop(); epoch++; candidate = null;
          events.length = 0;
        } else if (data.type === 'discard') {
          if (candidate?.token === data.token) candidate = null;
        } else if (data.type === 'prepare') {
          const token = await prepare(data.source);
          send({ type: 'reply', id: data.id, token, playing: repl.state.started });
          return;
        } else if (data.type === 'commit') {
          await commit(data.token, data.play === true);
        } else {
          await commit(await prepare(data.source), true);
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
