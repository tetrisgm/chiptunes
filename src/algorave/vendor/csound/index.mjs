import { getFrequency, logger, register } from '@strudel/core';
import { getAudioContext } from '@strudel/webaudio';
import csd from './project.csd';
// import livecodeOrc from './livecode.orc?raw';
import presetsOrc from './presets.orc';

let csoundLoader, _csound;
let loadController = new AbortController();
window.addEventListener('message', event => {
  if (event.source !== window || event.data !== 'strudel-stop') return;
  loadController.abort();
  loadController = new AbortController();
});

function waitForLoad(promise, signal) {
  return new Promise((resolve, reject) => {
    const cancelled = () => reject(new DOMException('Csound load cancelled.', 'AbortError'));
    if (signal.aborted) cancelled();
    else signal.addEventListener('abort', cancelled, { once: true });
    Promise.resolve(promise).then(value => {
      signal.removeEventListener('abort', cancelled); resolve(value);
    }, error => {
      signal.removeEventListener('abort', cancelled); reject(error);
    });
  });
}
const reportInitError = error => { if (error.name !== 'AbortError') logger(`[csound] ${error.message}`, 'error'); };

// initializes csound + can be used to reevaluate given instrument code
export async function loadCSound(code = '') {
  const signal = loadController.signal;
  await init(signal);
  signal.throwIfAborted();
  if (code) {
    code = `${code}`;
    //     ^       ^
    // wrapping in backticks makes sure it works when calling as templated function
    await waitForLoad(_csound.evalCode(code), signal);
  }
}
export const loadcsound = loadCSound;
export const loadCsound = loadCSound;

export const csound = register('csound', (instrument, pat) => {
  instrument = instrument || 'triangle';
  init().catch(reportInitError); // not async to support csound inside other patterns + to be able to call pattern methods after it
  // TODO: find a alternative way to wait for csound to load (to wait with first time playback)
  return pat.onTrigger((hap, currentTime, _cps, targetTime) => {
    if (!_csound) {
      logger('[csound] not loaded yet', 'warning');
      return;
    }
    hap.ensureObjectValue();
    let { gain = 0.8 } = hap.value;
    gain *= 0.2;

    const freq = Math.round(getFrequency(hap));
    const controls = Object.entries({ ...hap.value, freq })
      .flat()
      .join('/');
    // TODO: find out how to send a precise ctx based time
    // http://www.csounds.com/manual/html/i.html
    const timeOffset = targetTime - currentTime; // latency ?
    //const timeOffset = time_deprecate - getAudioContext().currentTime
    const params = [
      `"${instrument}"`, // p1: instrument name
      timeOffset, // p2: starting time in arbitrary unit called beats
      hap.duration + 0, // p3: duration in beats
      // instrument specific params:
      freq, //.toFixed(precision), // p4: frequency
      gain, // p5: gain
      `"${controls}"`, // p6 controls as string (like superdirt osc message)
    ];
    const msg = `i ${params.join(' ')}`;
    _csound.inputMessage(msg);
  });
});

function eventLogger(type, args) {
  const [msg] = args;
  if (
    type === 'message' &&
    (['[commit: HEAD]'].includes(msg) ||
      msg.startsWith('--Csound version') ||
      msg.startsWith('libsndfile') ||
      msg.startsWith('sr =') ||
      msg.startsWith('0dBFS') ||
      msg.startsWith('audio buffered') ||
      msg.startsWith('writing') ||
      msg.startsWith('SECTION 1:'))
  ) {
    // ignore
    return;
  }
  let logType = 'info';
  if (msg.startsWith('error:')) {
    logType = 'error';
  }
  logger(`[csound] ${msg || ''}`, logType);
}

async function load() {
  if (window.__csound__) {
    // Allows using some other csound instance.
    // In that case, the external Csound is responsible
    // for compiling an orchestra and starting to perform.
    logger('[load] Using external Csound', 'warning');
    _csound = window.__csound__;
    return _csound;
  } else {
    const signal = loadController.signal;
    const { Csound } = await import('../csound-browser/dist/csound.js');
    signal.throwIfAborted();
    const instance = await Csound({ audioContext: getAudioContext() });
    instance.removeAllListeners('message');
    ['message'].forEach((k) => instance.on(k, (...args) => eventLogger(k, args)));
    await instance.setOption('-m0d'); // see -m flag https://csound.com/docs/manual/CommandFlags.html
    await instance.setOption('--sample-accurate');
    await instance.setOption('-odac');
    await instance.compileCsdText(csd);
    // await instance.compileOrc(livecodeOrc);
    await instance.compileOrc(presetsOrc);
    await instance.start();
    _csound = instance;
    return instance;
  }
}

async function init(signal = loadController.signal) {
  csoundLoader = csoundLoader || load().catch(error => {
    csoundLoader = undefined;
    throw error;
  });
  return waitForLoad(csoundLoader, signal);
}

const orcCache = Object.create(null);
export async function loadOrc(url) {
  const signal = loadController.signal;
  await init(signal);
  signal.throwIfAborted();
  if (typeof url !== 'string') {
    throw new Error('loadOrc: expected url string');
  }
  if (url.startsWith('github:')) {
    const [_, path] = url.split('github:');
    url = `https://raw.githubusercontent.com/${path}`;
  }
  if (!orcCache[url]) {
    orcCache[url] = fetch(url, { signal })
      .then((res) => {
        if (!res.ok) throw Error(`Csound orchestra download failed: HTTP ${res.status}`);
        return res.text();
      })
      .then(async (code) => {
        signal.throwIfAborted();
        const result = await waitForLoad(_csound.compileOrc(code), signal);
        if (result !== 0) throw Error('Csound orchestra could not be compiled.');
      })
      .catch(error => { delete orcCache[url]; throw error; });
  }
  await waitForLoad(orcCache[url], signal);
}

/**
 * Sends notes to Csound for rendering with MIDI semantics. The hap value is
 * translated to these Csound pfields:
 *
 *  p1 -- Csound instrument either as a number (1-based, can be a fraction),
 *        or as a string name.
 *  p2 -- time in beats (usually seconds) from start of performance.
 *  p3 -- duration in beats (usually seconds).
 *  p4 -- MIDI key number (as a real number, not an integer but in [0, 127].
 *  p5 -- MIDI velocity (as a real number, not an integer but in [0, 127].
 *  p6 -- Strudel controls, as a string.
 */
export const csoundm = register('csoundm', (instrument, pat) => {
  let p1 = instrument;
  if (typeof instrument === 'string') {
    p1 = `"${instrument}"`;
  }
  init().catch(reportInitError); // not async to support csound inside other patterns + to be able to call pattern methods after it
  return pat.onTrigger((hap, currentTime, _cps, targetTime) => {
    if (!_csound) {
      logger('[csound] not loaded yet', 'warning');
      return;
    }
    if (typeof hap.value !== 'object') {
      throw new Error('csound only support objects as hap values');
    }
    // Time in seconds counting from now.
    const p2 = targetTime - currentTime;
    const p3 = hap.duration.valueOf() + 0;
    const frequency = getFrequency(hap);
    let { gain = 1, velocity = 0.9 } = hap.value;
    velocity = gain * velocity;
    // Translate frequency to MIDI key number _without_ rounding.
    const C4 = 261.62558;
    let octave = Math.log(frequency / C4) / Math.log(2.0) + 8.0;
    const p4 = octave * 12.0 - 36.0;
    // We prefer floating point precision, but over the MIDI range [0, 127].
    const p5 = 127 * velocity;
    // The Strudel controls as a string.
    const p6 = Object.entries({ ...hap.value, frequency })
      .flat()
      .join('/');
    const i_statement = `i ${p1} ${p2} ${p3} ${p4} ${p5} "${p6}"`;
    console.log('[csoundm]:', i_statement);
    _csound.inputMessage(i_statement);
  });
});
