import contract from './project.cjs';
import {SampleByteStore,SAMPLE_LIMITS,inspectSampleWav} from './sample-assets.mjs';
export const SAMPLE_PROJECT_BYTES=24*1024*1024;
export const sampleIds=project=>[...new Set(Object.values(project.samples||{}).flat())];
const encode=bytes=>{let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(text);};
export function exportSampleProject(value,store){
  const project=contract.project(value),ids=sampleIds(project);
  if(!ids.length)return project;
  return {format:'ct-algorave-samples',version:1,project,assets:ids.map(id=>({id,data:encode(store.get(id))}))};
}
export async function importSampleProject(value){
  if(value?.format!=='ct-algorave-samples')return {project:contract.project(value),store:null};
  if(value.version!==1||Object.keys(value).length!==4||!['format','version','project','assets'].every(k=>Object.hasOwn(value,k))||!Array.isArray(value.assets)||value.assets.length>32)throw Error('Invalid project sample archive.');
  const project=contract.project(value.project),ids=new Set(sampleIds(project)),store=new SampleByteStore();
  if(value.assets.length!==ids.size)throw Error('Project sample archive has missing or duplicate content.');
  for(const record of value.assets){
    if(!record||Object.keys(record).length!==2||!ids.has(record.id)||typeof record.data!=='string'||record.data.length>Math.ceil(SAMPLE_LIMITS.fileBytes/3)*4||(record.data.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(record.data)))throw Error('Invalid project sample content.');
    const bytes=Uint8Array.from(atob(record.data),c=>c.charCodeAt(0));inspectSampleWav(bytes);
    if((await store.put(bytes)).id!==record.id)throw Error('Project sample content does not match its saved identity.');
    ids.delete(record.id);
  }
  return {project,store};
}
