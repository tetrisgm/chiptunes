'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
// Ship the exact public source inputs beside the browser artifact. Never collect
// the whole working directory: credentials, local recovery and private files are
// outside this explicit Git/source allowlist.
function sourceArchive(root,out,packages,buildId){
  const recorded=path.join(root,'SOURCE.json');
  const paths=fs.existsSync(recorded)?JSON.parse(fs.readFileSync(recorded,'utf8')).files.map(file=>file.path):execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
  const allowed=/^(?:src\/|scripts\/|packs\/|assets\/|docs\/|server\/|gateway\/|build\.js$|package(?:-lock)?\.json$|LICENSE$|NOTICE$)/;
  const files=new Set(paths.filter(file=>allowed.test(file)&&fs.existsSync(path.join(root,file))));
  function walk(directory){
    for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
      if(entry.name==='node_modules')continue;
      const file=path.join(directory,entry.name);
      if(entry.isDirectory())walk(file);
      else if(entry.isFile())files.add(path.relative(root,file));
    }
  }
  for(const directory of packages)walk(directory);
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'algorave-source-')),source=path.join(temp,'chiptunes-source');
  try{
    const manifest={buildId,files:[]};
    for(const file of [...files].sort()){
      const from=path.join(root,file),to=path.join(source,file),data=fs.readFileSync(from);
      fs.mkdirSync(path.dirname(to),{recursive:true});fs.writeFileSync(to,data);
      manifest.files.push({path:file,sha256:crypto.createHash('sha256').update(data).digest('hex')});
    }
    fs.writeFileSync(path.join(source,'SOURCE.json'),JSON.stringify(manifest,null,2)+'\n');
    fs.writeFileSync(path.join(source,'BUILD.txt'),'Exact source inputs for Algorave '+buildId+'\n\nFrom this directory with Node.js and npm installed:\n  npm ci\n  node build.js\n\nThe included node_modules directories preserve the source packages used by the\nalgorave bundles, including their original source maps and license notices.\npackage-lock.json pins the remaining build dependencies.\n');
    function normalizeTimes(directory){
      for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
        const file=path.join(directory,entry.name);
        if(entry.isDirectory())normalizeTimes(file);
        fs.utimesSync(file,0,0);
      }
      fs.utimesSync(directory,0,0);
    }
    normalizeTimes(source);
    execFileSync('/usr/bin/tar',['-czf',path.join(out,'source.tar.gz'),'-C',temp,'chiptunes-source']);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
}
module.exports={sourceArchive};
