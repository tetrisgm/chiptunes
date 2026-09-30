'use strict';
// The radio stream was retired on 2026-09-30. Nothing the site ships may point
// at it, and /radio, which people have shared, must still open the player.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..');
require('child_process').execFileSync(process.execPath, ['build.js'], {cwd:root, stdio:'inherit'});
const dist = path.join(root, 'dist');
assert.strictEqual(fs.readFileSync(path.join(dist, 'radio/index.html'), 'utf8'), fs.readFileSync(path.join(dist, 'index.html'), 'utf8'), '/radio serves the player');
for (const gone of ['listen.m3u', 'listen.pls', 'radio.m3u', 'radio.pls', 'radio-qr.png']) {
  assert.ok(!fs.existsSync(path.join(dist, gone)), gone + ' should not ship');
}
const texts = [];
const walk = (dir) => { for (const e of fs.readdirSync(dir, {withFileTypes:true})) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (/\.(html|js|css|json|txt|xml|webmanifest)$|^_headers$|^_redirects$/.test(e.name)) texts.push(p); } };
walk(dist);
for (const file of texts) {
  const body = fs.readFileSync(file, 'utf8');
  for (const needle of ['radio.chiptunes.app', 'stream.chiptunes.app', 'listen.m3u', 'listen.pls']) {
    assert.ok(!body.includes(needle), path.relative(root, file) + ' still mentions ' + needle);
  }
}
console.log('verify-radio-retired: no radio links ship, and /radio opens the player');
