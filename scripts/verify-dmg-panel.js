// The four shades must stay four shades.
//
// Two stacked luminance remappings once crushed them into three -- the palette
// hook ranged the art across 0..1 and the blit ranged it AGAIN over 0.02..0.55,
// clipping the top half, so a block's fill and its own outline reached the panel
// as the same colour. Nothing failed; it just looked wrong, which is the kind of
// bug worth a test. This runs the real arithmetic of both stages.
'use strict';
const P = require('../src/dmg-palette.js');
const fs = require('fs'), path = require('path');

const src = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
let fail = 0;
const check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) fail++; };

// The blit's tail (invert + snap), then color-correct.slang's shade recovery.
const blit  = l => Math.floor((1 - l) * 3 + 0.5) / 3;
const shade = l => Math.max(0, Math.min(3, Math.floor((1 - blit(l)) * 3 + 0.5)));

const shades = P.LEVELS.map(shade);
check(new Set(shades).size === 4, 'four art levels -> four distinct GB shades  [' + shades + ']');

// Both stages must agree that the range is already 0..1; a second stretch here
// is what caused the collapse, so read it back out of the source.
const dmg = src('src/dmg-screen.js');
check(/opts\.lo == null \? 0\.0 /.test(dmg) && /opts\.hi == null \? 1\.0 /.test(dmg),
      'blit does not re-range what the palette hook already ranged');
check(/l=floor\(l\*3\.0\+0\.5\)\/3\.0/.test(dmg),
      'blit snaps alpha/gradient in-betweens onto the four levels');

// bb_density is the physical contrast wheel: above 0.5 it mixes EVERY pixel
// toward the darkest shade. Overriding it to "separate shades" flattens the
// whole panel to one olive tone. It must not appear in the adaptation table.
const table = dmg.slice(dmg.indexOf('var ADAPTED'), dmg.indexOf('var BLIT_VS'));
check(!/bb_density/.test(table), 'bb_density is not overridden (it is the contrast wheel, not separation)');

// An outline has to survive quantisation whatever colour it starts from.
const probes = ['#ffffff', '#000000', '#f8d878', '#0058f8', '#306230', '#8bac0f', '#f83800'];
const bad = probes.filter(c => P.quantize(c) === P.step(c, 1));
check(bad.length === 0, 'step() never lands on the fill\'s own shade  (' + probes.length + ' probes)');

console.log(fail ? '\ndmg-panel: ' + fail + ' FAILED' : '\ndmg-panel: all checks passed');
process.exit(fail ? 1 : 0);
