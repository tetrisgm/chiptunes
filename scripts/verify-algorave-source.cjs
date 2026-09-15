'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),artifact=path.join(root,'dist/algorave');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'algorave-source-check-'));
try{
  execFileSync('/usr/bin/tar',['-xzf',path.join(artifact,'source.tar.gz'),'-C',temp]);
  const source=path.join(temp,'chiptunes-source'),manifest=JSON.parse(fs.readFileSync(path.join(source,'SOURCE.json'),'utf8'));
  assert(manifest.files.some(file=>file.path==='src/create-entry.js'));
  assert(manifest.files.some(file=>file.path==='src/algorave/music-runtime.mjs'));
  assert(manifest.files.some(file=>file.path==='node_modules/@strudel/web/web.mjs'));
  assert(manifest.files.some(file=>file.path==='node_modules/@strudel/webaudio/webaudio.mjs'));
  assert(manifest.files.some(file=>file.path==='node_modules/@strudel/core/pattern.mjs'));
  assert(manifest.files.some(file=>file.path==='node_modules/@strudel/soundfonts/fontloader.mjs'));
  assert(manifest.files.some(file=>file.path==='src/algorave/vendor/sfumato/src/index.ts'));
  assert(manifest.files.some(file=>file.path==='src/algorave/vendor/edo/edo.mjs'));
  assert(manifest.files.some(file=>file.path==='src/algorave/vendor/edo/UPSTREAM.json'));
  assert(manifest.files.some(file=>file.path==='src/algorave/vendor/draw/draw.mjs'));
  assert(manifest.files.some(file=>file.path==='src/algorave/vendor/draw/upstream/draw.mjs'));
  assert(manifest.files.some(file=>file.path==='node_modules/sfumato/node_modules/soundfont2/src/index.ts'));
  assert(manifest.files.every(file=>!file.path.startsWith('dist/')&&!file.path.startsWith('.git/')));
  for(const file of manifest.files){
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(source,file.path))).digest('hex'),file.sha256,file.path);
  }
  const dependencies=JSON.parse(fs.readFileSync(path.join(artifact,'dependencies.json'),'utf8'));
  assert(dependencies.some(p=>p.name==='@strudel/core'&&p.license==='AGPL-3.0-or-later'));
  assert(dependencies.some(p=>p.name==='@strudel/edo'&&p.license==='AGPL-3.0-or-later'&&p.noticeFiles.includes('LICENSE')));
  assert(dependencies.every(p=>p.noticeFiles.length||p.supplementalNotice));
  assert(fs.readFileSync(path.join(artifact,'THIRD_PARTY_NOTICES.txt'),'utf8').includes('GNU AFFERO GENERAL PUBLIC LICENSE'));
  // Rebuild from the archive without the repository/.git or local node_modules.
  execFileSync('npm',['ci','--ignore-scripts','--no-audit','--no-fund'],{cwd:source,stdio:'pipe',timeout:120000});
  execFileSync(process.execPath,['build.js'],{cwd:source,stdio:'pipe',timeout:60000});
  for(const file of ['workspace.js','music-runtime.js']){
    assert.equal(fs.readFileSync(path.join(source,'dist/algorave',file),'utf8'),fs.readFileSync(path.join(artifact,file),'utf8'),file+' reproduces from supplied source');
  }
  console.log('PASS: exact source checksums, dependency notices, no dist/Git metadata, and matching browser bundles rebuilt from source archive with npm ci.');
}finally{fs.rmSync(temp,{recursive:true,force:true});}
