import {SampleByteStore,SAMPLE_LIMITS} from './sample-assets.mjs';
const NAME='ct-algorave-samples-v1';
async function database(){
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(NAME,1);let blocked=false;
    request.onupgradeneeded=()=>request.result.createObjectStore('samples',{keyPath:'id'});
    request.onerror=()=>reject(Error('Could not open sample storage.'));
    request.onblocked=()=>{blocked=true;reject(Error('Sample storage is busy in another tab.'));};
    request.onsuccess=()=>{if(blocked)request.result.close();else resolve(request.result);};
  });
}
export async function loadSamples(){
  const db=await database();
  try{
    const records=await new Promise((resolve,reject)=>{
      const tx=db.transaction('samples','readonly'),request=tx.objectStore('samples').getAll(undefined,SAMPLE_LIMITS.count+1);
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(Error('Could not read saved samples.'));
    });
    if(records.length>SAMPLE_LIMITS.count)throw Error('Saved sample collection exceeds its limit.');
    const store=new SampleByteStore();
    for(const record of records){const item=await store.put(record.bytes);if(item.id!==record.id)throw Error('Saved sample content is damaged.');}
    return store;
  }finally{db.close();}
}
export async function saveSamples(store){
  const records=store.snapshot().assets.map(({id})=>({id,bytes:store.get(id)})),db=await database();
  try{
    await new Promise((resolve,reject)=>{
      const tx=db.transaction('samples','readwrite'),table=tx.objectStore('samples'),request=table.getAll(undefined,SAMPLE_LIMITS.count+1);let failure;
      tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(failure||Error('Could not save samples.'));
      request.onsuccess=()=>{
        try{
          const existing=new Map(request.result.map(item=>[item.id,item.bytes]));
          for(const record of records){
            const previous=existing.get(record.id);
            if(previous&&(!(previous instanceof Uint8Array)||previous.length!==record.bytes.length||previous.some((v,i)=>v!==record.bytes[i])))throw Error('Saved sample identity conflicts with existing data.');
            existing.set(record.id,record.bytes);
          }
          let total=0;for(const bytes of existing.values()){
            if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>SAMPLE_LIMITS.fileBytes)throw Error('Saved sample data is invalid.');total+=bytes.length;
          }
          if(existing.size>SAMPLE_LIMITS.count||total>SAMPLE_LIMITS.totalBytes)throw Error('Saved sample collection is full (32 files or 16 MiB).');
          for(const record of records)if(!request.result.some(item=>item.id===record.id))table.add(record);
        }catch(error){failure=error;tx.abort();}
      };
    });
  }finally{db.close();}
}
