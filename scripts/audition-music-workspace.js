'use strict';
// Deliberate local acceptance artifacts; never starts playback or a service.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const L=require('../src/music-language.js'),E=require('../src/music-exports.js');
const base=`song({tempo:128,bars:8})
instruments([[128,241,0,0],[0,240,0,1],[0,161,0,0]])
waves([[15,15,15,15,15,15,15,15,0,0,0,0,0,0,0,0,15,15,15,15,15,15,15,15,0,0,0,0,0,0,0,0]])
pattern("melody",notes("C4 E4 G4 E4 D4 F4 A4 G4").stepsPerBar(4).gate(0.85))
pattern("bass",notes("C2 . G2 . F2 . G2 .").stepsPerBar(4).gate(0.8))
pattern("drums",notes("C2 . C2 C2 C2 . C2 C2").stepsPerBar(8).gate(0.2))
track("lead").instrument(0).play("melody",{repeat:4})
track("bass").instrument(1).play("bass",{repeat:4})
track("drums").instrument(2).play("drums",{repeat:8})
`;
async function main(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'chiptunes-music-listening-'));
 const variants=[['01-original',base],['02-manual-bass',base.replace('C2 . G2 . F2 . G2 .','C2 G2 C3 G2 F2 C3 G2 D3')],
  ['03-simplified-drums',base.replace('C2 . C2 C2 C2 . C2 C2','C2 . . . C2 . . .')]];
 for(const [name,source] of variants){
  const compiled=L.compile(source);if(!compiled.gb)throw Error(JSON.stringify(compiled.diagnostics));
  const result=await E.exportRevision({id:name,validated:true,compiled},'wav');
  fs.writeFileSync(path.join(dir,name+'.wav'),result.bytes);
  fs.writeFileSync(path.join(dir,name+'.music'),source);
 }
 console.log(dir);
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
