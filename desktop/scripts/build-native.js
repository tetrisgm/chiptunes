'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

if (process.platform !== 'darwin') {
  console.log('rrr wallpaper native bridge: skipped (macOS only)');
  process.exit(0);
}

const electronVersion = require('electron/package.json').version;
const nodeGyp = require.resolve('node-gyp/bin/node-gyp.js');
const arch = process.argv[2] || process.arch;
const result = spawnSync(process.execPath, [
  nodeGyp,
  'rebuild',
  '--target=' + electronVersion,
  '--arch=' + arch,
  '--dist-url=https://electronjs.org/headers',
], {
  cwd: path.join(__dirname, '..'),
  stdio: 'inherit',
  env: { ...process.env, npm_config_runtime: 'electron' },
});

if (result.error) throw result.error;
process.exit(result.status == null ? 1 : result.status);
