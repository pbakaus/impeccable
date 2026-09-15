(key) => {
  if (Object.hasOwn(globalThis,key)) throw Error('capture key collision');
  const nodes=[...document.querySelectorAll('*')];
  if(nodes.length>5000) throw Error('capture DOM exceeds 5000 elements');
  const box=el=>{const b=el.getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height};};
  // Computed CSS only. Split complete top-level layers, preserving quoted URL commas.
  const layers=value=>{
    const out=[];let start=0,depth=0,quote=null,escaped=false;
    for(let i=0;i<value.length;i++){
      const c=value[i];
      if(escaped){escaped=false;continue;}
      if(c==='\\'){escaped=true;continue;}
      if(quote){if(c===quote)quote=null;continue;}
      if(c==='"'||c==="'"){quote=c;continue;}
      if(c==='(')depth++;else if(c===')'){if(--depth<0)return null;}
      else if(c===','&&depth===0){out.push(value.slice(start,i).trim());start=i+1;}
    }
    if(depth||quote||escaped)return null;out.push(value.slice(start).trim());
    if(out.length>16)return null;
    return out.every(v=>v==='none'||/^url\("([^"\\]*)"\)$/.test(v)||(/^(repeating-)?(linear|radial|conic)-gradient\(/.test(v)&&!/(url|image-set|paint)\(/.test(v)))?out:null;
  };
  const state={active:null,pseudos:[]};
  const computed=s=>({display:s.display,visibility:s.visibility,opacity:s.opacity,objectFit:s.objectFit,objectPosition:s.objectPosition,backgroundSize:s.backgroundSize,backgroundPosition:s.backgroundPosition});
  state.scan=()=>{
    const current=[...document.querySelectorAll('*')];
    const sameNodes=current.length===nodes.length&&current.every((el,i)=>el===nodes[i]);
    const rows=[],unsupported=[];
    for(const [index,el] of current.entries()){
      const s=getComputedStyle(el),b=box(el);
      if(el.shadowRoot||['IFRAME','FRAME','CANVAS','VIDEO','SVG'].includes(el.tagName.toUpperCase()))unsupported.push({kind:el.shadowRoot?'shadow-root':el.tagName.toLowerCase(),box:b});
      const ancestors=[];
      for(let p=el.parentElement;p;p=p.parentElement){const c=getComputedStyle(p);if(c.opacity!=='1'||c.visibility!=='visible'||c.display==='none'||c.overflow!=='visible'||c.clipPath!=='none')ancestors.push({tag:p.tagName,opacity:c.opacity,visibility:c.visibility,display:c.display,overflow:c.overflow,clipPath:c.clipPath});}
      if(el instanceof HTMLImageElement&&el.currentSrc)rows.push({kind:'img',url:el.currentSrc,decoded:el.complete&&el.naturalWidth>0,supported:true,index,tag:el.tagName,elementId:el.id,box:b,computed:computed(s),ancestors});
      for(const pseudo of ['', '::before','::after']){
        const p=pseudo?getComputedStyle(el,pseudo):s;
        const bg=p.backgroundImage;
        const native=pseudo?state.pseudos.find(r=>r.index===index&&r.pseudo===pseudo):null;
        const bounds=pseudo?native?.box:b;
        const parts=layers(bg);
        const urls=parts?.map((part,layer)=>({match:/^url\("([^"\\]*)"\)$/.exec(part),layer})).filter(r=>r.match)||[];
        const unknown=bg!=='none'&&(!parts||(pseudo&&!urls.length)||(pseudo&&!bounds));
        if(unknown||(pseudo&&p.content.includes('url('))){unsupported.push({kind:pseudo?'pseudo-imagery':'complex-background',box:bounds||b});continue;}
        for(const r of urls)rows.push({kind:pseudo?'pseudo-background':'background',pseudo,layer:r.layer,url:new URL(r.match[1],location.href).href,decoded:null,supported:true,index,tag:el.tagName,elementId:el.id,box:bounds,computed:computed(p),ancestors:pseudo?[{tag:el.tagName,...computed(s)},...ancestors]:ancestors});
      }
    }
    return {sameNodes,dom:document.documentElement.outerHTML,url:location.href,
      viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio,scrollX,scrollY},
      layout:current.map(box),pseudoLayout:state.pseudos,rows,unsupported,
      runningAnimations:document.getAnimations().filter(a=>a.playState==='running').length};
  };
  // Our temporary changes can start authored transitions. Let them finish naturally.
  state.settle=()=>Promise.race([
    (async()=>{await Promise.all(document.getAnimations().map(a=>a.finished));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return true;})(),
    new Promise((_,reject)=>setTimeout(()=>reject(Error('capture intervention did not settle within 1s')),1000))
  ]);
  state.suppressMany=(items)=>{
    if(state.active)throw Error('capture intervention already active');
    state.active={styles:new Map(),expected:[]};const groups=new Map(),rules=[];
    for(const item of items){
      const {index,kind}=item,el=nodes[index];
      if(!el||el!==document.querySelectorAll('*')[index])throw Error('capture node changed');
      if(kind!=='pseudo-background'&&!state.active.styles.has(el))state.active.styles.set(el,el.getAttribute('style'));
      if(kind==='img'){
        const nw=el.naturalWidth,nh=el.naturalHeight;
        const distance=Math.ceil(Math.max(nw,nh,el.clientWidth,el.clientHeight)*Math.max(1,el.clientWidth/nw,el.clientHeight/nh)+innerWidth+innerHeight+1);
        if(!Number.isFinite(distance)||distance>10000000)throw Error('image displacement exceeds capture coordinate budget');
        el.style.setProperty('object-position',`${distance}px ${distance}px`,'important');
      }else{
        const pseudo=item.pseudo||'',id=index+pseudo;
        if(!groups.has(id))groups.set(id,{index,pseudo,parts:layers(getComputedStyle(el,pseudo||null).backgroundImage),remove:new Set()});
        const group=groups.get(id);
        if(!group.parts||!Number.isInteger(item.layer)||!/^url\(/.test(group.parts[item.layer]||''))throw Error('capture background layer changed');
        group.remove.add(item.layer);
      }
    }
    for(const group of groups.values()){
      const image=group.parts.map((v,i)=>group.remove.has(i)?'none':v).join(', ');
      const el=nodes[group.index];
      if(group.pseudo){
        const native=state.pseudos.find(r=>r.index===group.index&&r.pseudo===group.pseudo);
        if(!native?.box)throw Error('capture pseudo geometry unavailable');
        rules.push(`${native.selector}${group.pseudo}{background-image:${image}!important}`);
      }else el.style.setProperty('background-image',image,'important');
      state.active.expected.push({index:group.index,pseudo:group.pseudo,image});
    }
    return {dom:document.documentElement.outerHTML,layout:state.scan().layout,rules:rules.join('\n')};
  };
  state.verifySuppression=()=>{
    for(const e of state.active?.expected||[]){if(getComputedStyle(nodes[e.index],e.pseudo||null).backgroundImage!==e.image)throw Error('capture background suppression was overridden');}
    return true;
  };
  state.restore=()=>{
    if(state.active){for(const [el,style] of state.active.styles)style===null?el.removeAttribute('style'):el.setAttribute('style',style);state.active=null;}
  };
  Object.defineProperty(globalThis,key,{value:state,configurable:true});
  return true;
}
