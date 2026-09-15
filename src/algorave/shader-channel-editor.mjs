import contract from './project.cjs';
// Four optional inputs for the selected pass; the GLSL itself stays unchanged.
export function shaderChannelEditor(root,textarea,{importImage,onError=()=>{}}={}){
  let document,pass,version=0;
  function render(nextDocument,nextPass){
    const rendered=++version;document=nextDocument;pass=nextPass;root.replaceChildren();
    if(pass==='Common'){root.textContent='Select Image or a buffer to configure its inputs.';return;}
    let channels;try{channels=JSON.parse(textarea.value);}catch{root.textContent='Correct the channel JSON below to use the input controls.';return;}
    const row=channels?.[pass]||[];
    for(let index=0;index<4;index++){
      const raw=row[index],input=typeof raw==='string'?{type:['audio','keyboard'].includes(raw)?raw:'buffer',source:raw}:raw||{};
      const group=documentElement('fieldset'),legend=documentElement('legend');legend.textContent=`iChannel${index}`;group.append(legend);
      const source=select('Input',['none','audio','keyboard','texture','cubemap','volume','video','webcam',...['A','B','C','D','Cube'].filter(name=>document[name])],input.type==='buffer'?input.source:input.type||'none');group.append(source.label);
      const image=imageControl('Image URL','Import image',input.src);
      const volume=imageControl('Volume URL','Import volume',input.type==='volume'?input.src:undefined,true);
      const video=imageControl('Video URL','Import video',input.type==='video'?input.src:undefined,false,true);
      const faces=['+X','-X','+Y','-Y','+Z','-Z'].map((name,i)=>imageControl(name+' URL','Import '+name,input.faces?.[i]));
      const filter=select('Filter',['nearest','linear','mipmap'],input.filter||(input.type==='keyboard'?'nearest':'linear'));group.append(filter.label);
      const wrap=select('Wrap',['clamp','repeat','mirror'],input.wrap||'clamp');group.append(wrap.label);
      const flip=field('Flip vertically','checkbox'),srgb=field('sRGB','checkbox');flip.input.checked=input.vflip===true;srgb.input.checked=input.srgb===true;group.append(flip.label,srgb.label);
      function visibility(){
        const texture=source.input.value==='texture',cube=source.input.value==='cubemap',vol=source.input.value==='volume',vid=source.input.value==='video',camera=source.input.value==='webcam',empty=source.input.value==='none';
        image.show(texture);volume.show(vol);video.show(vid);faces.forEach(face=>face.show(cube));flip.label.hidden=srgb.label.hidden=!texture&&!cube&&!vol&&!vid&&!camera;filter.label.hidden=wrap.label.hidden=empty;
      }
      function update(){
        let current;try{current=JSON.parse(textarea.value);}catch{return;}
        const chosen=source.input.value;let value=null;
        if(chosen!=='none'){
          value={type:['A','B','C','D','Cube'].includes(chosen)?'buffer':chosen,filter:filter.input.value,wrap:wrap.input.value};
          if(value.type==='buffer')value.source=chosen;
          if(chosen==='texture')value.src=image.value();
          if(chosen==='volume')value.src=volume.value();
          if(chosen==='video')value.src=video.value();
          if(chosen==='cubemap')value.faces=faces.map(face=>face.value());
          if(chosen==='texture'||chosen==='cubemap'||chosen==='volume'||chosen==='video'||chosen==='webcam')Object.assign(value,{vflip:flip.input.checked,srgb:srgb.input.checked});
        }
        const inputs=[...(current[pass]||[])];while(inputs.length<=index)inputs.push(null);inputs[index]=value;
        current[pass]=inputs;textarea.value=JSON.stringify(current);visibility();
      }
      function imageControl(urlLabel,fileLabel,initial,isVolume=false,isVideo=false){
        const importedLabel=isVideo?'Imported video (saved)':isVolume?'Imported volume (saved)':'Imported image (saved)';
        let imported=contract.imageId(initial)?initial:'';
        const src=field(urlLabel,'url');src.input.value=imported?'':initial||'';src.input.placeholder=imported?importedLabel:'https://…';group.append(src.label);
        const file=field(fileLabel,'file');file.input.accept=isVideo?'video/mp4,video/webm,video/ogg':isVolume?'.bin,application/octet-stream,application/x-shadertoy-volume':'image/png,image/jpeg,image/webp,image/avif,image/gif,image/bmp';group.append(file.label);
        src.input.oninput=()=>{imported='';src.input.placeholder='https://…';update();};src.input.onchange=update;
        file.input.onchange=async()=>{
          const selected=file.input.files[0];if(!selected)return;
          try{const reference=await importImage(selected,{volume:isVolume,video:isVideo});if(rendered!==version)return;imported=reference;src.input.value='';src.input.placeholder=importedLabel;update();}
          catch(error){onError(error);}finally{file.input.value='';}
        };
        return {value:()=>imported||src.input.value,show:visible=>{src.label.hidden=!visible;file.label.hidden=!visible||!importImage;}};
      }
      source.input.onchange=()=>{if(source.input.value==='keyboard')filter.input.value='nearest';update();};
      for(const control of [filter,wrap,flip,srgb])control.input.onchange=update;
      visibility();root.append(group);
    }
  }
  function documentElement(tag){return root.ownerDocument.createElement(tag);}
  function field(name,type){const label=documentElement('label'),input=documentElement('input');input.type=type;input.setAttribute('aria-label',`${pass} ${name}`);label.append(name,input);return {label,input};}
  function select(name,values,value){const label=documentElement('label'),input=documentElement('select');input.setAttribute('aria-label',`${pass} ${name}`);for(const item of values){const option=documentElement('option');option.value=item;option.textContent={none:'None',audio:'Music audio',keyboard:'Keyboard',texture:'Image texture',cubemap:'Cube texture',volume:'Volume texture',video:'Video',webcam:'Camera',Cube:'Cubemap A'}[item]||item;input.append(option);}input.value=value;label.append(name,input);return {label,input};}
  return {render};
}
