'use strict';
// Shared data-only contract. Never evaluates Strudel or GLSL on the server.
const DOCUMENTS = Object.freeze(['music', 'Image', 'Common', 'A', 'B', 'C', 'D', 'Cube', 'Sound', 'channels']);
const RUNTIME = Object.freeze({ music: 'strudel-web-1.3.0', visual: 'shadertoy-webgl2-v1' });
const bytes = value => new TextEncoder().encode(value).length;
const plain = v => v && typeof v === 'object' && !Array.isArray(v);
function need(ok, message = 'Invalid audiovisual project.') { if (!ok) throw Error(message); }
function keys(v, allowed, required = []) {
  return plain(v) && Object.keys(v).every(k => allowed.includes(k)) && required.every(k => Object.hasOwn(v, k));
}
function text(v, limit) {
  return typeof v === 'string' && bytes(v) <= limit && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(v);
}
const imageId = src => typeof src === 'string' && /^asset:[a-f0-9]{64}$/.test(src) ? src.slice(6) : null;
const textureSources = input => input?.type === 'cubemap' ? input.faces : ['texture','volume','video','music'].includes(input?.type) ? [input.src] : [];
function textureSource(src){
  need(text(src,4096),'Invalid texture URL.');
  if(imageId(src))return src;
  let url;try{url=new URL(src);}catch{throw Error('Use an HTTPS texture URL or an imported image.');}
  need(url.protocol==='https:'&&!url.username&&!url.password&&!url.hash,'Use an HTTPS texture URL without credentials or a fragment.');
  return url.href;
}
function channel(value, visuals) {
  if(value===null||value==='audio'||value==='keyboard')return value;
  if(['A','B','C','D','Cube'].includes(value)){
    need(Object.hasOwn(visuals,value),'Channel names a missing buffer.');return value;
  }
  need(keys(value,['type','source','src','faces','filter','wrap','vflip','srgb'],['type']),'Invalid visual input.');
  need(['audio','keyboard','buffer','texture','cubemap','volume','video','webcam','music','mic'].includes(value.type),'Unsupported visual input type.');
  const result={type:value.type};
  if(value.type==='buffer'){
    need(['A','B','C','D','Cube'].includes(value.source)&&Object.hasOwn(visuals,value.source),'Channel names a missing buffer.');
    result.source=value.source;
  }else need(!Object.hasOwn(value,'source'),'Only buffers have a source pass.');
  if(value.type==='mic'){
    need(!['src','faces','vflip','srgb'].some(key=>Object.hasOwn(value,key)),'Microphone input does not have a URL or image options.');
  }else if(value.type==='music'){
    need(!['faces','vflip','srgb'].some(key=>Object.hasOwn(value,key)),'Audio input does not have image options.');result.src=textureSource(value.src);
  }else if(value.type==='webcam'){
    need(!Object.hasOwn(value,'src')&&!Object.hasOwn(value,'faces'),'Camera input does not have a URL.');
    for(const option of ['vflip','srgb'])if(Object.hasOwn(value,option)){need(typeof value[option]==='boolean');result[option]=value[option];}
  }else if(value.type==='texture'||value.type==='cubemap'||value.type==='volume'||value.type==='video'){
    if(value.type!=='cubemap'){
      need(!Object.hasOwn(value,'faces'),'Only cube textures have faces.');result.src=textureSource(value.src);
    }else{
      need(!Object.hasOwn(value,'src')&&Array.isArray(value.faces)&&value.faces.length===6,'A cube texture needs six faces: +X, -X, +Y, -Y, +Z, -Z.');
      result.faces=Array.from(value.faces,textureSource);
    }
    for(const option of ['vflip','srgb'])if(Object.hasOwn(value,option)){need(typeof value[option]==='boolean');result[option]=value[option];}
  }else need(!['src','faces','vflip','srgb'].some(key=>Object.hasOwn(value,key)),'Image options need a texture input.');
  if(Object.hasOwn(value,'filter')){need(['nearest','linear','mipmap'].includes(value.filter),'Invalid texture filter.');result.filter=value.filter;}
  if(Object.hasOwn(value,'wrap')){need(['clamp','repeat','mirror'].includes(value.wrap),'Invalid texture wrap.');result.wrap=value.wrap;}
  return result;
}
function project(value) {
  need(keys(value, ['version','runtime','music','visuals','samples'], ['version','runtime','music','visuals']));
  need(value.version === 1 && keys(value.runtime,['music','visual'],['music','visual']));
  need(value.runtime.music === RUNTIME.music && value.runtime.visual === RUNTIME.visual,'Unsupported project runtime.');
  need(text(value.music,65536));
  need(keys(value.visuals,['Image','Common','A','B','C','D','Cube','Sound','channels'],['Image']));
  const visuals = {};
  for (const name of ['Image','Common','A','B','C','D','Cube','Sound']) {
    if (!Object.hasOwn(value.visuals,name)) continue;
    need(text(value.visuals[name],65536));
    if (name === 'Image' || value.visuals[name] !== '') visuals[name] = value.visuals[name];
  }
  const inputs = Object.hasOwn(value.visuals, 'channels') ? value.visuals.channels : { Image: ['audio'] };
  need(keys(inputs,['Image','A','B','C','D','Cube','Sound']));
  visuals.channels = {};
  for (const name of ['Image','A','B','C','D','Cube','Sound']) {
    if (!Object.hasOwn(inputs,name)) continue;
    need(Object.hasOwn(visuals,name),'Channel configuration names a missing pass.');
    const row = inputs[name];
    need(Array.isArray(row) && row.length <= 4);
    visuals.channels[name] = row.map(c=>channel(c,visuals));
  }
  const result = { version:1, runtime:{...RUNTIME}, music:value.music, visuals };
  if(Object.hasOwn(value,'samples')){
    need(plain(value.samples)&&Object.keys(value.samples).length<=32,'Invalid sample collection.');
    const samples={},ids=new Set();
    for(const name of Object.keys(value.samples).sort()){
      const row=value.samples[name];
      need(/^[a-z][a-z0-9_-]{0,63}$/.test(name)&&!['constructor','prototype'].includes(name)&&Array.isArray(row)&&row.length>0&&row.length<=32,'Invalid sample name or list.');
      need(row.every(id=>typeof id==='string'&&/^[a-f0-9]{64}$/.test(id)),'Invalid sample content identity.');
      samples[name]=[...row];row.forEach(id=>ids.add(id));
    }
    need(ids.size<=32,'Too many sample files.');
    if(Object.keys(samples).length)result.samples=samples;
  }
  need(bytes(JSON.stringify(result)) <= 524288,'Project is too large.');
  return result;
}
async function revision(value) {
  const input = new TextEncoder().encode(JSON.stringify(project(value)));
  return [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',input))].map(x=>x.toString(16).padStart(2,'0')).join('');
}
function sourceFor(value, document) {
  need(DOCUMENTS.includes(document),'Unknown edit document.');
  if (document === 'music') return value.music;
  if (document === 'channels') return JSON.stringify(value.visuals.channels);
  return value.visuals[document] || '';
}
function candidateFrom(value, proposal, { id, baseRevision, target = 'auto' }) {
  const base = project(value);
  need(keys(proposal,['id','baseRevision','edits','explanation'],['id','baseRevision','edits','explanation']),'Invalid agent proposal.');
  need(proposal.id === id && proposal.baseRevision === baseRevision,'The proposal belongs to a different revision.');
  need(text(proposal.explanation,20000) && proposal.explanation.length <= 5000);
  need(Array.isArray(proposal.edits) && proposal.edits.length <= 32);
  const grouped = new Map(); let inserted=0,removed=0;
  for (const edit of proposal.edits) {
    need(keys(edit,['document','from','to','text'],['document','from','to','text']));
    const source = sourceFor(base,edit.document);
    need(target !== 'music' || edit.document === 'music','This request may only edit music.');
    need(target !== 'visuals' || edit.document !== 'music','This request may only edit visuals.');
    need(Number.isSafeInteger(edit.from) && Number.isSafeInteger(edit.to) && edit.from >= 0 && edit.to >= edit.from && edit.to <= source.length && text(edit.text,16384));
    need(text(source.slice(0,edit.from),65536) && text(source.slice(edit.to),65536),'Edit splits a Unicode character.');
    inserted += bytes(edit.text); removed += bytes(source.slice(edit.from,edit.to));
    need(inserted<=32768 && removed<=131072,'Agent edit is too large.');
    if (!grouped.has(edit.document)) grouped.set(edit.document,[]);
    grouped.get(edit.document).push(edit);
  }
  for (const [name, edits] of grouped) {
    const source = sourceFor(base,name);let end=0,previous=-1,output='';
    for (const edit of edits) {
      need(edit.from>=end && edit.from>previous,'Agent edits overlap or are out of order.');
      output += source.slice(end,edit.from)+edit.text;end=edit.to;previous=edit.from;
    }
    output+=source.slice(end);need(output!==source,'Agent edit makes no change.');
    if(name==='music')base.music=output;
    else if(name==='channels') { try { base.visuals.channels=JSON.parse(output); } catch { throw Error('Invalid channel configuration.'); } }
    else if(name!=='Image' && output==='')delete base.visuals[name];
    else base.visuals[name]=output;
  }
  return project(base);
}
async function context(value) {
  need(keys(value,['kind','id','request','baseRevision','project','target','conversation'],['kind','id','request','baseRevision','project']));
  need(value.kind==='algorave' && typeof value.id==='string' && /^[A-Za-z0-9_-]{1,128}$/.test(value.id));
  need(text(value.request,8000) && value.request.trim().length>0 && value.request.length<=2000);
  const target = Object.hasOwn(value, 'target') ? value.target : 'auto';
  need(['auto','music','visuals','both'].includes(target));
  const normalized=project(value.project);
  need(value.baseRevision===await revision(normalized),'Stale or incorrect project revision.');
  const conversation=Object.hasOwn(value,'conversation') ? value.conversation : [];
  need(Array.isArray(conversation)&&conversation.length<=12);
  let count=0;
  for(const turn of conversation){need(keys(turn,['role','content'],['role','content'])&&['user','assistant'].includes(turn.role)&&text(turn.content,16384));count+=bytes(turn.content);}
  need(count<=16384);
  return {kind:'algorave',id:value.id,request:value.request,baseRevision:value.baseRevision,project:normalized,target,conversation};
}
module.exports={DOCUMENTS,RUNTIME,project,revision,sourceFor,candidateFrom,context,channel,imageId,textureSources};
