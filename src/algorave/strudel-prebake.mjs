// SPDX-License-Identifier: AGPL-3.0-or-later
// Standard sound setup and piano helper follow Strudel contributors' REPL:
// https://codeberg.org/uzu/strudel/src/branch/main/website/src/repl/prebake.mjs
import { Pattern, noteToMidi, valueToMidi, evalScope, samples, aliasBank, registerZZFXSounds } from '@strudel/web';
import * as soundfonts from '@strudel/soundfonts';
import * as xen from '@strudel/xen';

export const CDN = 'https://strudel.b-cdn.net';
export const BANKS = [
  ['piano', 'piano/'], ['vcsl', 'VCSL/'],
  ['tidal-drum-machines', 'tidal-drum-machines/machines/', 'drum-machines'],
  ['uzu-drumkit', 'uzu-drumkit/', 'drum-machines'],
  ['uzu-wavetables', 'uzu-wavetables/'], ['mridangam', 'mrid/', 'drum-machines'],
];
const numbered = (name, files) => files.map(file => `${name}/${file}.wav`);
const range = count => Array.from({length:count}, (_, i) => i);
export const DIRT = {
  casio:numbered('casio', ['high','low','noise']),
  crow:numbered('crow', ['000_crow','001_crow2','002_crow3','003_crow4']),
  insect:numbered('insect', ['000_everglades_conehead','001_robust_shieldback','002_seashore_meadow_katydid']),
  wind:numbered('wind', ['000_wind1','001_wind10','002_wind2','003_wind3','004_wind4','005_wind5','006_wind6','007_wind7','008_wind8','009_wind9']),
  jazz:numbered('jazz', ['000_BD','001_CB','002_FX','003_HH','004_OH','005_P1','006_P2','007_SN']),
  metal:numbered('metal', range(10).map(i => `${String(i).padStart(3,'0')}_${i}`)),
  east:numbered('east', ['000_nipon_wood_block','001_ohkawa_mute','002_ohkawa_open','003_shime_hi','004_shime_hi_2','005_shime_mute','006_taiko_1','007_taiko_2','008_taiko_3']),
  space:numbered('space', [0,1,11,12,13,14,15,16,17,18,2,3,4,5,6,7,8,9].map((n,i) => `${String(i).padStart(3,'0')}_${n}`)),
  numbers:numbered('numbers', range(9)),
  num:numbered('num', range(21).map(i => String(i).padStart(2,'0'))),
};

const maxPan = noteToMidi('C8');
Pattern.prototype.piano = function () {
  return this.fmap(value => ({...value, clip:value.clip ?? 1})).s('piano').release(.1)
    .fmap(value => ({...value, pan:(value.pan || 1) * (Math.min(Math.round(valueToMidi(value)) / maxPan, 1) * .5 + .25)}));
};

async function catalog(name) {
  // Load only the catalog here. Upstream fetches and decodes audio on demand.
  // An unavailable CDN must not prevent local synths/imported samples working.
  const response = await fetch(`${CDN}/${name}.json`, {credentials:'omit', signal:AbortSignal.timeout(8000)});
  if (!response.ok) throw Error(`${name}: HTTP ${response.status}`);
  return response.json();
}

export async function registerDefaultSounds() {
  await evalScope(soundfonts, xen);
  registerZZFXSounds(); soundfonts.registerSoundfonts();
  await samples(DIRT, `${CDN}/Dirt-Samples/`, {prebake:true});
  const tasks = BANKS.map(async ([name, base, tag]) => samples(await catalog(name), `${CDN}/${base}`, {prebake:true,tag}));
  const results = await Promise.allSettled([...tasks, catalog('tidal-drum-machines-alias')]);
  const aliases = results.at(-1);
  if (aliases.status === 'fulfilled') await aliasBank(aliases.value);
  return results.flatMap((result,index) => result.status === 'rejected' ? [BANKS[index]?.[0] || 'drum-machine aliases'] : []);
}
