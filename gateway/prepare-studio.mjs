// Publish the SAME build.js artifact beside the gateway, so browser sign-in is
// first-party. Never copy local music libraries, ROMs or credentials into public.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
const output=fileURLToPath(new URL('./public/',import.meta.url));
const manifest=path.join(output,'.studio-generated.json');
let old=[];
try{old=JSON.parse(await fs.readFile(manifest,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
if(!Array.isArray(old)||old.some(p=>typeof p!=='string'||path.isAbsolute(p)||p.split('/').some(s=>s==='..'||s==='')))
  throw Error('Invalid generated studio manifest');
for(const relative of old)await fs.rm(path.join(output,relative),{force:true});
execFileSync(process.execPath,[path.join(root,'build.js')],{cwd:root,stdio:'inherit'});
const files=[];
async function copy(relative){
  const source=path.join(root,'dist',relative),target=path.join(output,relative);
  const stat=await fs.lstat(source);
  if(stat.isSymbolicLink())throw Error('Refusing symlink in studio assets');
  if(stat.isDirectory()){for(const child of await fs.readdir(source))await copy(relative+'/'+child);return;}
  if(!stat.isFile())throw Error('Unexpected studio asset');
  await fs.mkdir(path.dirname(target),{recursive:true});
  try{await fs.copyFile(source,target,fs.constants.COPYFILE_EXCL);}catch(e){throw Error('Refusing to overwrite non-generated studio asset: '+relative);}
  files.push(relative);
}
await copy('create/index.html');
for(const name of await fs.readdir(path.join(root,'dist'))){
  if(/^app\.[a-f0-9]+\.js$/.test(name)||['fonts','lib','favicon.ico','manifest.webmanifest','og.png'].includes(name))await copy(name);
}
await fs.writeFile(manifest,JSON.stringify(files));
console.log('Prepared shared Create artifact ('+files.length+' files); no music library or private files copied.');
