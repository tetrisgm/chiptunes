// watch.js — rebuild the single-file index.html whenever a src/ file changes.
// Run directly (`node watch.js`) or always-on via the net.mikutap.build LaunchAgent.
// Debounced; never watches index.html (build's OUTPUT) so it can't loop.
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');
const NODE = process.execPath;          // rebuild with the same node running the watcher
let timer = null;

function rebuild(reason){
  clearTimeout(timer);
  timer = setTimeout(() => {
    execFile(NODE, ['build.js'], { cwd: ROOT }, (err, out, errout) => {
      if (err) process.stderr.write('[watch] build FAILED (' + reason + '): ' + (errout || err.message).trim() + '\n');
      else     process.stdout.write('[watch] ' + reason + ' -> ' + String(out).trim() + '\n');
    });
  }, 250);
}

try {
  fs.watch(SRC, { recursive: true }, (evt, file) => {
    if (file && (file.endsWith('.js') || file.endsWith('.html'))) rebuild(file);
  });
  process.stdout.write('[watch] watching ' + SRC + ' for *.js / *.html changes…\n');
  rebuild('startup');
} catch (e) {
  process.stderr.write('[watch] cannot watch src/: ' + e.message + '\n');
  process.exit(1);
}
