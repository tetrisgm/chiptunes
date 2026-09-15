'use strict';
const fs=require('node:fs'),path=require('node:path');
// Inventory only the packages actually present in the browser bundles.
// This is provenance/notice generation, not an automatic legal approval gate.
function notices(out,inputs){
  const packages=new Map();
  for(const file of inputs){
    const vendor=['edo','draw','gamepad','midi','motion'].find(name=>file.includes('src/algorave/vendor/'+name+'/'));
    if(vendor){
      const directory=path.resolve(__dirname,'../src/algorave/vendor',vendor);
      packages.set(directory,JSON.parse(fs.readFileSync(path.join(directory,'package.json'),'utf8')));
      continue;
    }
    if(!file.includes('node_modules/'))continue;
    let directory=path.dirname(path.resolve(file));
    while(directory.includes('node_modules')){
      const manifest=path.join(directory,'package.json');
      if(fs.existsSync(manifest)){
        const data=JSON.parse(fs.readFileSync(manifest,'utf8'));
        if(data.name&&data.version){packages.set(directory,data);break;}
      }
      directory=path.dirname(directory);
    }
  }
  const records=[],sections=[];
  for(const [directory,data]of [...packages].sort((a,b)=>a[1].name.localeCompare(b[1].name))){
    const files=fs.readdirSync(directory).filter(name=>/^(LICENSE|LICENCE|COPYING|NOTICE)(\.|$)/i.test(name)&&fs.statSync(path.join(directory,name)).isFile());
    const supplement=data.name==='@tonaljs/progression'?'tonal-MIT.txt':data.name==='chord-voicings'?'chord-voicings.txt':data.name==='sfumato'?'sfumato.txt':null;
    const extra=supplement?fs.readFileSync(path.join(__dirname,'../src/algorave/licenses',supplement),'utf8'):'';
    const record={supplementalNotice:supplement,name:data.name,version:data.version,license:data.license||data.licenses||'UNDECLARED',repository:data.repository||null,noticeFiles:files};
    records.push(record);
    sections.push(`${data.name}@${data.version}\nDeclared license: ${JSON.stringify(record.license)}\n`+files.map(name=>`${name}\n${fs.readFileSync(path.join(directory,name),'utf8')}`).join('\n')+(extra?'\nSupplemental notice:\n'+extra:''));
  }
  fs.writeFileSync(path.join(out,'dependencies.json'),JSON.stringify(records,null,2)+'\n');
  fs.writeFileSync(path.join(out,'THIRD_PARTY_NOTICES.txt'),sections.join('\n\n'+'='.repeat(72)+'\n\n'));
  return {records,directories:[...packages.keys()]};
}
module.exports={notices};
