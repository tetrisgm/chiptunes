'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),esbuild=require('esbuild');
const root=path.resolve(__dirname,'..');
function build(){
  const out=path.join(root,'.algorave-preview');
  fs.mkdirSync(out,{recursive:true});
  const files=['preview.mjs','preview.html','music-runtime.mjs','music-bridge.mjs','shader-runtime.mjs','music-signals.mjs','drum-samples.mjs','project.cjs','session.mjs','agent-client.mjs','code-editor.mjs','examples.mjs'];
  const id=crypto.createHash('sha256');for(const file of files)id.update(fs.readFileSync(path.join(root,'src/algorave',file)));
  id.update(fs.readFileSync(path.join(root,'package-lock.json')));
  const buildId=id.digest('hex').slice(0,12);
  for(const [entry,name] of [['music-runtime.mjs','music-runtime.js'],['preview.mjs','workspace.js']]){
    esbuild.buildSync({entryPoints:[path.join(root,'src/algorave',entry)],outfile:path.join(out,name),bundle:true,
      format:entry==='preview.mjs'?'esm':'iife',platform:'browser',target:'es2022',minify:false,legalComments:'inline',
      define:{BUILD_ID:JSON.stringify('Algorave '+buildId)}});
  }
  fs.writeFileSync(path.join(out,'index.html'),fs.readFileSync(path.join(root,'src/algorave/preview.html'),'utf8').replace('<script src="workspace.js">','<script type="module" src="workspace.js">'));
  console.log('Local-only algorave runtime proof: '+out+' ('+buildId+')');
}
module.exports={build};
if(require.main===module)build();
