'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),esbuild=require('esbuild');
const root=path.resolve(__dirname,'..');
function build({out=path.join(root,'.algorave-preview')}={}){
  fs.mkdirSync(out,{recursive:true});
  const files=['preview.mjs','preview.html','music-runtime.mjs','music-bridge.mjs','shader-runtime.mjs','music-signals.mjs','drum-samples.mjs','sample-assets.mjs','sample-bank.mjs','sample-persistence.mjs','sample-project.mjs','project.cjs','session.mjs','agent-client.mjs','code-editor.mjs','examples.mjs'];
  const id=crypto.createHash('sha256');for(const file of files)id.update(fs.readFileSync(path.join(root,'src/algorave',file)));
  id.update(fs.readFileSync(path.join(root,'src/algorave/strudel-prebake.mjs')));
  id.update(fs.readFileSync(__filename));
  id.update(fs.readFileSync(path.join(root,'package-lock.json')));
  const buildId=id.digest('hex').slice(0,12);
  const inputs=new Set();
  for(const [entry,name] of [['music-runtime.mjs','music-runtime.js'],['preview.mjs','workspace.js']]){
    const result=esbuild.buildSync({metafile:true,entryPoints:[path.join(root,'src/algorave',entry)],outfile:path.join(out,name),bundle:true,
      format:entry==='preview.mjs'?'esm':'iife',platform:'browser',target:'es2022',minify:false,legalComments:'inline',
      // Bundle upstream source, not its prebundled distribution, so the input
      // graph records every dependency for notices and corresponding source.
      alias:{'@strudel/web':path.join(root,'node_modules/@strudel/web/web.mjs'),'@strudel/soundfonts':path.join(root,'node_modules/@strudel/soundfonts/index.mjs'),'@strudel/xen':path.join(root,'node_modules/@strudel/xen/index.mjs')},
      define:{BUILD_ID:JSON.stringify('Algorave '+buildId)}});
    Object.keys(result.metafile.inputs).forEach(file=>inputs.add(file));
  }
  fs.writeFileSync(path.join(out,'index.html'),fs.readFileSync(path.join(root,'src/algorave/preview.html'),'utf8').replace('<script src="workspace.js">','<script type="module" src="workspace.js">'));
  const dependencies=require('./algorave-notices.cjs').notices(out,inputs);
  fs.copyFileSync(path.join(root,'docs/algorave-distribution.md'),path.join(out,'DISTRIBUTION.md'));
  fs.copyFileSync(path.join(root,'node_modules/@strudel/web/LICENSE'),path.join(out,'AGPL-3.0.txt'));
  require('./algorave-source.cjs').sourceArchive(root,out,dependencies.directories,buildId);
  console.log('Algorave workspace: '+out+' ('+buildId+')');
}
module.exports={build};
if(require.main===module)build();
