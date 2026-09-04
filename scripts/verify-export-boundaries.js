#!/usr/bin/env node
'use strict';

// Export boundaries must pass the chip song whole. Notes alone are not the
// performance: duty/pitch automation, vibrato cutoffs, wave-table swaps and
// sampled kits all live beside them.
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const DIST = path.join(__dirname, '..', 'dist');
const wait = ms => new Promise(r => setTimeout(r, ms));
let fail = 0;
const ok = (condition, message) => {
  console.log((condition ? '  ok   ' : '  FAIL ') + message);
  if (!condition) fail++;
};
function server() {
  return new Promise(resolve => {
    const s = http.createServer((req, res) => {
      let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
      let file = path.join(DIST, rel || 'index.html');
      if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
      fs.readFile(file, (err, body) => {
        if (err) { res.writeHead(500); res.end(); return; }
        res.writeHead(200, { 'content-type': file.endsWith('.js') ? 'text/javascript' : 'text/html' });
        res.end(body);
      });
    });
    s.listen(0, '127.0.0.1', () => resolve({ s, port: s.address().port }));
  });
}
const shape = song => ({
  notes: song && song.notes && song.notes.length || 0,
  auto: song && song.auto && song.auto.length || 0,
  vibOff: song && song.vibOff && song.vibOff.length || 0,
  waveLoads: song && song.waveLoads && song.waveLoads.length || 0,
  kit: song && song.kit && song.kit.length || 0,
  bank: !!(song && song.bank && song.bank.instruments && song.bank.waveTables)
});

(async () => {
  const host = await server();
  const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });

  // Build a real edited song containing both movement and a sampled drum, then
  // exercise the actual Create download buttons.
  const create = await browser.newPage({ viewport: { width: 1380, height: 900 }, acceptDownloads: true });
  // ⚠️ LOAD A KNOWN SONG. This opened bare /create and edited whatever the
  // editor happened to put there -- a different song every run, and one run in
  // several has no DRUMS at all, so the kit loop had nothing to click and the
  // fixture came back without kit or wave data. The gate then reported that
  // exports drop data, when the truth was that the fixture never had any.
  const api = require(path.join(__dirname, '..', 'src', 'api.js'));
  const NOTE = n => ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][n % 12] + (Math.floor(n / 12) - 1);
  const fixture = { title: 'Boundaries', grid: 16, bpm: 128, bars: 4, notes: [] };
  for (let s = 0; s < 16; s++) {
    fixture.notes.push({ lane: 'Melody', step: s * 4, note: NOTE(60 + (s % 12)), len: 2 });
    fixture.notes.push({ lane: 'Bass', step: s * 4, note: NOTE(36 + (s % 7)), len: 3 });
    fixture.notes.push({ lane: 'Drums', step: s * 4, drum: ['kick', 'hat', 'snare', 'hat'][s % 4] });
  }
  const code = api.fromJSON(fixture);
  await create.goto(`http://127.0.0.1:${host.port}/create#s=${code}`, { waitUntil: 'domcontentloaded' });
  await create.waitForFunction(() => document.querySelector('#createscreen.show'), null, { timeout: 40000 });
  await wait(3500);
  const prepared = await create.evaluate(async () => {
    const delay = ms => new Promise(r => setTimeout(r, ms));
    // ⚠️ WAIT FOR THE PANEL, don't race a timer. This drove the editor on flat
    // 80ms delays: fine idle, and on a loaded machine the picker had not opened
    // yet, so the click landed on nothing and the fixture came back with no kit
    // and no wave load. It then failed for being "not rich enough" -- a gate
    // reporting that the editor is broken when the editor was merely slower than
    // the test's stopwatch.
    const until = async (fn, ms) => {
      const t0 = Date.now();
      while (Date.now() - t0 < (ms || 4000)) { if (fn()) return true; await delay(25); }
      return false;
    };
    const tour = document.querySelector('.cr-tour'); if (tour) tour.remove();
    const pulseCount = document.querySelectorAll('.n-note[data-ch="0"],.n-note[data-ch="1"]').length;
    for (let i = 0; i < pulseCount; i++) {
      const pulse = document.querySelectorAll('.n-note[data-ch="0"],.n-note[data-ch="1"]')[i];
      if (!pulse) break;
      pulse.click();
      await until(() => document.querySelector('[data-ed="mvvb"]'));
      const wobble = document.querySelector('[data-ed="mvvb"]'); if (wobble && !wobble.classList.contains('on')) wobble.click();
      await until(() => CT_CREATE._score().auto.length && CT_CREATE._score().vibOff.length, 1500);
      const close = document.querySelector('.n-pclose'); if (close) close.click();
      await until(() => !document.querySelector('.n-pick'), 1500);
      const probe = CT_CREATE._score();
      if (probe.auto.length && probe.vibOff.length) break;
    }
    const drumCount = document.querySelectorAll('.n-note[data-ch="3"]').length;
    for (let i = 0; i < drumCount; i++) {
      const drum = document.querySelectorAll('.n-note[data-ch="3"]')[i];
      if (!drum) break;
      drum.click();
      await until(() => document.querySelector('.n-pick [data-full="Kick"]'));
      const kick = document.querySelector('.n-pick [data-full="Kick"]'); if (kick && !kick.classList.contains('on')) kick.click();
      await until(() => CT_CREATE._score().kit.length && CT_CREATE._score().waveLoads.length, 1500);
      const close = document.querySelector('.n-pclose'); if (close) close.click();
      await until(() => !document.querySelector('.n-pick'), 1500);
      const probe = CT_CREATE._score();
      if (probe.kit.length && probe.waveLoads.length) break;
    }
    const source = CT_CREATE._score();
    window.__exports = { source: {
      notes: source.notes.length, auto: source.auto.length, vibOff: source.vibOff.length,
      waveLoads: source.waveLoads.length, kit: source.kit.length,
      bank: !!(source.instruments && source.waveTables)
    }};
    const rom = CT_GB_ROM.buildRom, render = CT_GB_APU.render;
    CT_GB_ROM.buildRom = score => { window.__exports.rom = {
      notes: score.gb.notes.length, auto: score.gb.auto.length, vibOff: score.gb.vibOff.length,
      waveLoads: score.gb.waveLoads.length, kit: score.gb.kit.length,
      bank: !!(score.gb.bank && score.gb.bank.instruments && score.gb.bank.waveTables)
    }; return new Uint8Array(32768); };
    CT_GB_APU.render = song => { window.__exports.wav = {
      notes: song.notes.length, auto: song.auto.length, vibOff: song.vibOff.length,
      waveLoads: song.waveLoads.length, kit: song.kit.length,
      bank: !!(song.bank && song.bank.instruments && song.bank.waveTables)
    }; return new Float32Array(64); };
    document.querySelector('[data-cr="rom"]').click();
    document.querySelector('[data-cr="wav"]').click();
    CT_GB_ROM.buildRom = rom; CT_GB_APU.render = render;
    return window.__exports;
  });
  const rich = prepared.source.auto > 0 && prepared.source.vibOff > 0 &&
               prepared.source.waveLoads > 0 && prepared.source.kit > 0;
  ok(rich, 'the edited fixture contains automation, vibrato handoff, wave reload and kit data ' +
    JSON.stringify(prepared.source));
  ok(JSON.stringify(prepared.rom) === JSON.stringify(prepared.source),
    'Create ROM receives the complete chip song');
  ok(JSON.stringify(prepared.wav) === JSON.stringify(prepared.source),
    'Create WAV receives the complete chip song');
  await create.close();

  // The station WAV/AAC helper shares one PCM boundary. Sentinels make every
  // adjacent array visible without depending on a particular generated song.
  const station = await browser.newPage({ viewport: { width: 1380, height: 900 }, acceptDownloads: true });
  await station.goto(`http://127.0.0.1:${host.port}/`, { waitUntil: 'domcontentloaded' });
  await wait(3000);
  const stationShape = await station.evaluate(async () => {
    const gb = { notes: [{ ch: 0, frame: 0, frames: 2, midi: 60, inst: 0 }],
      bank: { instruments: [[2, 242, 0, 0]], waveTables: [[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]] },
      totalFrames: 8, auto: [{ f: 1, r: 0x11, v: 64 }], vibOff: [{ f: 2, ch: 0 }],
      waveLoads: [{ f: 3, slot: 0 }], kit: [{ f: 4, id: 0 }] };
    Audio.currentScore = () => ({ gb });
    const render = CT_GB_APU.render;
    window.__stationExport = null;
    CT_GB_APU.render = song => { window.__stationExport = {
      notes: song.notes.length, auto: song.auto.length, vibOff: song.vibOff.length,
      waveLoads: song.waveLoads.length, kit: song.kit.length,
      bank: !!(song.bank && song.bank.instruments && song.bank.waveTables)
    }; return new Float32Array(64); };
    document.querySelector('#plinks [data-k="wav"]').click();
    await new Promise(r => setTimeout(r, 100));
    CT_GB_APU.render = render;
    return window.__stationExport;
  });
  ok(stationShape && JSON.stringify(stationShape) === JSON.stringify({ notes: 1, auto: 1, vibOff: 1, waveLoads: 1, kit: 1, bank: true }),
    'station WAV/AAC receives every chip-song field');
  await station.close();

  await browser.close(); host.s.close();
  console.log(fail ? '\nverify-export-boundaries: ' + fail + ' FAILED'
                   : '\nverify-export-boundaries: exports preserve the whole performance');
  process.exit(fail ? 1 : 0);
})().catch(error => { console.error(error.stack || error.message); process.exit(1); });
