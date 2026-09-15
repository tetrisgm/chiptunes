import contract from './project.cjs';
import {exportSampleProject,importSampleProject} from './sample-project.mjs';
import {ImageByteStore,IMAGE_LIMITS} from './image-assets.mjs';
export const PROJECT_BYTES=112*1024*1024;
export const imageIds=project=>[...new Set(Object.values(project.visuals.channels||{}).flat().map(input=>contract.imageId(input?.src)).filter(Boolean))];
const encode=bytes=>{let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(text);};
export function exportProject(value,{samples,images}={}){
  const project=contract.project(value),ids=imageIds(project),previous=exportSampleProject(project,samples);
  if(!ids.length)return previous;
  return {format:'ct-algorave-assets',version:1,project,samples:previous.assets||[],images:ids.map(id=>({id,data:encode(images.get(id))}))};
}
export async function importProject(value){
  if(value?.format!=='ct-algorave-assets')return {...await importSampleProject(value),images:null};
  if(value.version!==1||Object.keys(value).length!==5||!['format','version','project','samples','images'].every(k=>Object.hasOwn(value,k))||!Array.isArray(value.images)||value.images.length>IMAGE_LIMITS.count)throw Error('Invalid project asset archive.');
  const {project,store}=await importSampleProject({format:'ct-algorave-samples',version:1,project:value.project,assets:value.samples});
  const ids=new Set(imageIds(project)),images=new ImageByteStore();
  if(value.images.length!==ids.size)throw Error('Project images have missing or duplicate content.');
  for(const record of value.images){
    if(!record||Object.keys(record).length!==2||!ids.has(record.id)||typeof record.data!=='string'||record.data.length>Math.ceil(IMAGE_LIMITS.fileBytes/3)*4||record.data.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(record.data))throw Error('Invalid project image content.');
    const bytes=Uint8Array.from(atob(record.data),c=>c.charCodeAt(0));
    if((await images.put(bytes)).id!==record.id)throw Error('Project image content does not match its saved identity.');
    ids.delete(record.id);
  }
  return {project,store,images};
}
