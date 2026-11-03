// Runs only in the disposable capture page. No requests, dependencies, or page storage.
(() => {
  const animations = new Map();
  const identities = new WeakMap();
  let nextId = 0, collecting = true, viewTransition = false, unsupported = null;
  const id = el => {
    if (!identities.has(el)) identities.set(el, ++nextId);
    return identities.get(el);
  };
  const selector = el => {
    if (el.id) return '#' + CSS.escape(el.id);
    const parts = [];
    for (let p = el; p && p.nodeType === 1; p = p.parentElement) {
      parts.unshift(p.localName + ':nth-child(' + (Array.from(p.parentElement?.children || [p]).indexOf(p) + 1) + ')');
    }
    return parts.join(' > ');
  };
  const collect = () => {
    if (!collecting) return;
    for (const a of document.getAnimations()) {
      if (!animations.has(a)) {
        const timing = a.effect?.getComputedTiming();
        if (!timing) continue;
        const end = timing.endTime;
        if (!Number.isFinite(end) || end > 10000) unsupported = 'Motion capture requires finite animations no longer than 10 seconds';
        animations.set(a, {end, delay: timing.delay, duration: timing.duration,
          easing: timing.easing, iterations: timing.iterations,
          selector: a.effect.target instanceof Element ? selector(a.effect.target) : 'document',
          pseudo: a.effect.pseudoElement || null});
        a.pause();
        a.currentTime = 0;
      }
    }
  };
  // Capture WAAPI creations synchronously, including ones started by click handlers.
  const animate = Element.prototype.animate;
  Element.prototype.animate = function(...args) {
    const a = animate.apply(this, args);
    collect();
    return a;
  };
  const transitions = [];
  if (document.startViewTransition) {
    const start = document.startViewTransition.bind(document);
    document.startViewTransition = (...args) => {
      viewTransition = true;
      const vt = start(...args);
      transitions.push(vt.ready.then(collect));
      return vt;
    };
  }
  const raf = () => new Promise(resolve => requestAnimationFrame(resolve));
  const flush = async () => { await raf(); collect(); await raf(); collect(); };
  const rect = r => [r.x, r.y, r.width, r.height];
  const intersect = (a,b) => {
    const x = Math.max(a[0],b[0]), y = Math.max(a[1],b[1]);
    return [x,y,Math.max(0,Math.min(a[0]+a[2],b[0]+b[2])-x),Math.max(0,Math.min(a[1]+a[3],b[1]+b[3])-y)];
  };
  const snapshot = region => {
    const elements = [], outsideIds = [];
    const nodes = [];
    const walk = root => { for (const el of root.children || []) { nodes.push(el); walk(el); if (el.shadowRoot) walk(el.shadowRoot); } };
    walk(document);
    for (const el of nodes) {
      const cs = getComputedStyle(el), box = rect(el.getBoundingClientRect());
      if (cs.display === 'none' || cs.visibility !== 'visible' || box[2] <= 0 || box[3] <= 0) continue;
      const inRegion = intersect(box, region);
      if (!inRegion[2] || !inRegion[3]) { outsideIds.push(id(el)); continue; }
      let clip = box.slice(), opacity = Number(cs.opacity);
      for (let p = el.parentElement; p; p = p.parentElement) {
        const style = getComputedStyle(p), r = rect(p.getBoundingClientRect());
        opacity *= Number(style.opacity);
        if (style.overflowX !== 'visible') clip = intersect(clip, [r[0],clip[1],r[2],clip[3]]);
        if (style.overflowY !== 'visible') clip = intersect(clip, [clip[0],r[1],clip[2],r[3]]);
      }
      const ancestors = [];
      for (let p=el.parentElement;p;p=p.parentElement) ancestors.push(id(p));
      elements.push({id:id(el), ancestors, selector:selector(el), box, opacity, clip,
        clipPath:cs.clipPath, zIndex:cs.zIndex,
        content:Array.from(el.childNodes).filter(n=>n.nodeType===3).map(n=>n.textContent).join('') + (el.getAttribute('src') || ''),
        children:Array.from(el.children, child=>id(child)),
        clipped:1-(clip[2]*clip[3])/(box[2]*box[3])});
    }
    let pseudoId = -1;
    const seenPseudos = new Set();
    for (const [a, meta] of animations) {
      const pseudo = meta.pseudo;
      if (!pseudo || seenPseudos.has(pseudo) || a.playState === 'finished') continue;
      seenPseudos.add(pseudo);
      const target = a.effect.target;
      if (!(target instanceof Element)) continue;
      const cs = getComputedStyle(target, pseudo);
      const matrix = new DOMMatrix(cs.transform === 'none' ? undefined : cs.transform);
      const w = parseFloat(cs.width), h = parseFloat(cs.height);
      if (!Number.isFinite(w) || !Number.isFinite(h)) continue;
      const points = [[0,0],[w,0],[0,h],[w,h]].map(([x,y])=>matrix.transformPoint({x,y}));
      const x = Math.min(...points.map(p=>p.x)), y = Math.min(...points.map(p=>p.y));
      const box = [x,y,Math.max(...points.map(p=>p.x))-x,Math.max(...points.map(p=>p.y))-y];
      elements.push({id:pseudoId--, selector:pseudo, pseudo:true, box, opacity:Number(cs.opacity), clip:box, clipPath:cs.clipPath, clipped:0, content:'', ancestors:[]});
    }
    if (elements.length > 2000) throw Error('Motion region exceeds 2000 elements; choose a smaller region');
    // Pairwise order only where boxes overlap: changing overlap alone is not a flip.
    const paint = {};
    const byId = new Map(nodes.map(el=>[id(el),el]));
    for (let i=0;i<elements.length;i++) for (let j=i+1;j<elements.length;j++) {
      const a=elements[i], b=elements[j], ea=byId.get(a.id), eb=byId.get(b.id);
      if (!ea || !eb) continue;
      if (ea.contains(eb) || eb.contains(ea)) continue;
      const r=intersect(intersect(a.box,b.box),region);
      if (r[2]<1 || r[3]<1) continue;
      const stack=document.elementsFromPoint(r[0]+r[2]/2,r[1]+r[3]/2);
      const ai=stack.indexOf(ea), bi=stack.indexOf(eb);
      if (ai>=0 && bi>=0) paint[a.id+':'+b.id]=ai<bi ? a.id : b.id;
    }
    return {elements, paint, viewTransition, outsideIds, scroll:[scrollX,scrollY]};
  };
  globalThis.__impeccableMotion = {
    snapshot,
    async ready() {
      await Promise.race([Promise.all(transitions).then(flush), new Promise((_,reject)=>setTimeout(()=>reject(Error('Animation readiness timed out')),5000))]);
      if (unsupported) throw Error(unsupported);
      return this.metadata();
    },
    metadata() { return {duration:Math.max(0,...Array.from(animations.values(), a=>a.end)), animations:Array.from(animations.values()),viewTransition}; },
    async seek(time) { collect(); for (const [a,meta] of animations) a.currentTime=Math.min(time,Math.max(0,meta.end-0.01)); await flush(); },
    async finish() {
      collecting=false;
      for (const a of animations.keys()) { try { a.finish(); } catch {} }
      await new Promise(resolve=>setTimeout(resolve,250));
      await raf(); await raf();
      const running=document.getAnimations().filter(a=>a.playState==='running' || a.playState==='pending');
      if (running.length) throw Error('Motion did not settle: new or ongoing animations remain after completion');
    }
  };
  return true;
})()
