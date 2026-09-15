import {ImageByteStore,IMAGE_LIMITS} from './image-assets.mjs';
const NAME='ct-algorave-images-v1';
async function database(){
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(NAME,1);let blocked=false;
    request.onupgradeneeded=()=>request.result.createObjectStore('images',{keyPath:'id'});
    request.onerror=()=>reject(Error('Could not open image storage.'));
    request.onblocked=()=>{blocked=true;reject(Error('Image storage is busy in another tab.'));};
    request.onsuccess=()=>{if(blocked)request.result.close();else resolve(request.result);};
  });
}
export async function loadImages(){
  const db=await database();
  try{
    const records=await new Promise((resolve,reject)=>{
      const tx=db.transaction('images','readonly'),request=tx.objectStore('images').getAll(undefined,IMAGE_LIMITS.count+1);
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(Error('Could not read saved images.'));
    });
    if(records.length>IMAGE_LIMITS.count)throw Error('Saved image collection exceeds its limit.');
    const store=new ImageByteStore();
    for(const record of records){const item=await store.put(record.bytes);if(item.id!==record.id)throw Error('Saved image content is damaged.');}
    return store;
  }finally{db.close();}
}
export async function saveImages(store){
  const records=store.snapshot().assets.map(({id})=>({id,bytes:store.get(id)})),db=await database();
  try{
    await new Promise((resolve,reject)=>{
      const tx=db.transaction('images','readwrite'),table=tx.objectStore('images'),request=table.getAll(undefined,IMAGE_LIMITS.count+1);let failure;
      tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(failure||Error('Could not save images.'));
      request.onsuccess=()=>{
        try{
          const existing=new Map(request.result.map(item=>[item.id,item.bytes]));
          for(const record of records){
            const previous=existing.get(record.id);
            if(previous&&(!(previous instanceof Uint8Array)||previous.length!==record.bytes.length||previous.some((v,i)=>v!==record.bytes[i])))throw Error('Saved image identity conflicts with existing data.');
            existing.set(record.id,record.bytes);
          }
          let total=0;for(const bytes of existing.values()){
            if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>IMAGE_LIMITS.fileBytes)throw Error('Saved image data is invalid.');total+=bytes.length;
          }
          if(existing.size>IMAGE_LIMITS.count||total>IMAGE_LIMITS.totalBytes)throw Error('Saved image collection is full (32 files or 64 MiB).');
          for(const record of records)if(!request.result.some(item=>item.id===record.id))table.add(record);
        }catch(error){failure=error;tx.abort();}
      };
    });
  }finally{db.close();}
}
