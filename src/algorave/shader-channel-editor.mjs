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
      const source=select('Input',['none','audio','keyboard','texture',...['A','B','C','D'].filter(name=>document[name])],input.type==='buffer'?input.source:input.type||'none');group.append(source.label);
      let imported=contract.imageId(input.src)?input.src:'';
      const src=field('Image URL','url');src.input.value=imported?'':input.src||'';src.input.placeholder=imported?'Imported image (saved)':'https://…';group.append(src.label);
      const file=field('Import image','file');file.input.accept='image/png,image/jpeg,image/webp,image/avif,image/gif,image/bmp';group.append(file.label);
      const filter=select('Filter',['nearest','linear','mipmap'],input.filter||(input.type==='keyboard'?'nearest':'linear'));group.append(filter.label);
      const wrap=select('Wrap',['clamp','repeat','mirror'],input.wrap||'clamp');group.append(wrap.label);
      const flip=field('Flip vertically','checkbox'),srgb=field('sRGB','checkbox');flip.input.checked=input.vflip===true;srgb.input.checked=input.srgb===true;group.append(flip.label,srgb.label);
      function visibility(){const texture=source.input.value==='texture',empty=source.input.value==='none';file.label.hidden=!texture||!importImage;src.label.hidden=flip.label.hidden=srgb.label.hidden=!texture;filter.label.hidden=wrap.label.hidden=empty;}
      const update=()=>{
        let current;try{current=JSON.parse(textarea.value);}catch{return;}
        const chosen=source.input.value;let value=null;
        if(chosen!=='none'){
          value={type:['A','B','C','D'].includes(chosen)?'buffer':chosen,filter:filter.input.value,wrap:wrap.input.value};
          if(value.type==='buffer')value.source=chosen;
          if(chosen==='texture')Object.assign(value,{src:imported||src.input.value,vflip:flip.input.checked,srgb:srgb.input.checked});
        }
        const inputs=[...(current[pass]||[])];while(inputs.length<=index)inputs.push(null);inputs[index]=value;
        current[pass]=inputs;textarea.value=JSON.stringify(current);visibility();
      };
      source.input.onchange=()=>{if(source.input.value==='keyboard')filter.input.value='nearest';update();};
      for(const control of [src,filter,wrap,flip,srgb])control.input.onchange=update;
      src.input.oninput=()=>{imported='';src.input.placeholder='https://…';update();};
      file.input.onchange=async()=>{
        const selected=file.input.files[0];if(!selected)return;
        try{const reference=await importImage(selected);if(rendered!==version)return;imported=reference;src.input.value='';src.input.placeholder='Imported image (saved)';update();}
        catch(error){onError(error);}finally{file.input.value='';}
      };
      visibility();root.append(group);
    }
  }
  function documentElement(tag){return root.ownerDocument.createElement(tag);}
  function field(name,type){const label=documentElement('label'),input=documentElement('input');input.type=type;input.setAttribute('aria-label',`${pass} ${name}`);label.append(name,input);return {label,input};}
  function select(name,values,value){const label=documentElement('label'),input=documentElement('select');input.setAttribute('aria-label',`${pass} ${name}`);for(const item of values){const option=documentElement('option');option.value=item;option.textContent={none:'None',audio:'Music audio',keyboard:'Keyboard',texture:'Image texture'}[item]||item;input.append(option);}input.value=value;label.append(name,input);return {label,input};}
  return {render};
}
