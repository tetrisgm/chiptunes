'use strict';
// Shared data-only contract. Never evaluates Strudel or GLSL on the server.
const DOCUMENTS = Object.freeze(['music', 'Image', 'Common', 'A', 'B', 'C', 'D', 'channels']);
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
function project(value) {
  need(keys(value, ['version','runtime','music','visuals'], ['version','runtime','music','visuals']));
  need(value.version === 1 && keys(value.runtime,['music','visual'],['music','visual']));
  need(value.runtime.music === RUNTIME.music && value.runtime.visual === RUNTIME.visual,'Unsupported project runtime.');
  need(text(value.music,65536));
  need(keys(value.visuals,['Image','Common','A','B','C','D','channels'],['Image']));
  const visuals = {};
  for (const name of ['Image','Common','A','B','C','D']) {
    if (!Object.hasOwn(value.visuals,name)) continue;
    need(text(value.visuals[name],65536));
    if (name === 'Image' || value.visuals[name] !== '') visuals[name] = value.visuals[name];
  }
  const inputs = Object.hasOwn(value.visuals, 'channels') ? value.visuals.channels : { Image: ['audio'] };
  need(keys(inputs,['Image','A','B','C','D']));
  visuals.channels = {};
  for (const name of ['Image','A','B','C','D']) {
    if (!Object.hasOwn(inputs,name)) continue;
    need(Object.hasOwn(visuals,name),'Channel configuration names a missing pass.');
    const row = inputs[name];
    need(Array.isArray(row) && row.length <= 4);
    need(row.every(c => c === null || c === 'audio' || (['A','B','C','D'].includes(c) && Object.hasOwn(visuals,c))), 'Channel names a missing buffer.');
    visuals.channels[name] = [...row];
  }
  const result = { version:1, runtime:{...RUNTIME}, music:value.music, visuals };
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
module.exports={DOCUMENTS,RUNTIME,project,revision,sourceFor,candidateFrom,context};
