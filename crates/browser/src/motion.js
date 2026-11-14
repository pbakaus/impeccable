// Runs only in the disposable capture page. No requests, dependencies, or page storage.
(() => {
  const animations = new Map();
  const identities = new WeakMap();
  const pseudoIdentities = new Map();
  const initial = new Map(document.getAnimations().map(a => [a, {state:a.playState, time:a.currentTime}]));
  let prepared = false, sampledTime = 0, beforeElements = null, transitionActive = false;
  let oldNamed = new Map(), newNamed = new Map();
  const nodesIn = root => {
    const nodes = [];
    const walk = node => { for (const el of node.children || []) { nodes.push(el); walk(el); if (el.shadowRoot) walk(el.shadowRoot); } };
    walk(root);
    return nodes;
  };
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
        const prior = initial.get(a);
        if (prior && prior.state === a.playState && prior.time === a.currentTime) continue;
        if (prepared) throw Error('New animation started after capture readiness; capture this interaction separately');
        const timing = a.effect?.getComputedTiming();
        if (!timing) continue;
        const end = timing.endTime;
        if (!Number.isFinite(end)) unsupported = 'Motion capture requires finite animation timing';
        animations.set(a, {end,
          kind: a.effect.pseudoElement?.startsWith('::view-transition-') ? 'view-transition' : typeof CSSTransition !== 'undefined' && a instanceof CSSTransition ? 'transition' : typeof CSSAnimation !== 'undefined' && a instanceof CSSAnimation ? 'css-animation' : 'waapi',
          properties: [...new Set(a.effect.getKeyframes().flatMap(f => Object.keys(f)).filter(k => !['offset','computedOffset','easing','composite'].includes(k)))],
          delay: timing.delay, duration: timing.duration,
          easing: timing.easing, iterations: timing.iterations,
          selector: a.effect.target instanceof Element ? selector(a.effect.target) : 'document',
          pseudo: a.effect.pseudoElement || null});
        const current = a.currentTime;
        a.pause();
        // Setting the same position completes a pending pause even when CDP
        // has frozen the document timeline. Do not rewind an existing position.
        a.currentTime = current ?? 0;
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
  const namedElements = () => new Map(nodesIn(document).flatMap(el => {
    const style = getComputedStyle(el), r = el.getBoundingClientRect();
    return style.viewTransitionName && style.viewTransitionName !== 'none' && r.width > 0 && r.height > 0
      ? [[style.viewTransitionName, {element:el, selector:selector(el), boxShadow:style.boxShadow}]] : [];
  }));
  const transitions = [];
  if (document.startViewTransition) {
    const start = document.startViewTransition.bind(document);
    document.startViewTransition = (...args) => {
      viewTransition = true;
      oldNamed = namedElements();
      const options = args[0];
      const update = typeof options === 'function' ? options : options?.update;
      const wrapped = async () => {
        if (update) await update();
        newNamed = namedElements();
      };
      const vt = start(typeof options === 'object' && options !== null ? {...options, update:wrapped} : wrapped);
      transitions.push(vt.ready.then(() => { transitionActive = true; collect(); }));
      return vt;
    };
  }
  const raf = () => new Promise(resolve => requestAnimationFrame(resolve));
  const flush = async () => { await raf(); collect(); await raf(); collect(); };
  const rect = r => [r.x, r.y, r.width, r.height];
  // The parent across a shadow boundary: a shadow root's direct child has no
  // parentElement, but its host's opacity, overflow and animations still apply.
  const up = n => n.parentElement || (n.parentNode instanceof ShadowRoot ? n.parentNode.host : null);
  const intersect = (a,b) => {
    const x = Math.max(a[0],b[0]), y = Math.max(a[1],b[1]);
    return [x,y,Math.max(0,Math.min(a[0]+a[2],b[0]+b[2])-x),Math.max(0,Math.min(a[1]+a[3],b[1]+b[3])-y)];
  };
  const snapshot = region => {
    const elements = [], outsideIds = [];
    const nodes = nodesIn(document);
    for (const el of nodes) {
      const cs = getComputedStyle(el), box = rect(el.getBoundingClientRect());
      if (cs.display === 'none' || cs.visibility !== 'visible' || box[2] <= 0 || box[3] <= 0) continue;
      const inRegion = intersect(box, region);
      if (!inRegion[2] || !inRegion[3]) { outsideIds.push(id(el)); continue; }
      let clip = box.slice(), opacity = Number(cs.opacity);
      for (let p = up(el); p; p = up(p)) {
        const style = getComputedStyle(p), r = rect(p.getBoundingClientRect());
        opacity *= Number(style.opacity);
        if (style.overflowX !== 'visible') clip = intersect(clip, [r[0],clip[1],r[2],clip[3]]);
        if (style.overflowY !== 'visible') clip = intersect(clip, [clip[0],r[1],clip[2],r[3]]);
      }
      const ancestors = [];
      for (let p=up(el);p;p=up(p)) ancestors.push(id(p));
      elements.push({id:id(el), ancestors, selector:selector(el), box, opacity, clip,
        clipPath:cs.clipPath, zIndex:cs.zIndex, viewTransitionName:cs.viewTransitionName,
        boxShadow: transitionActive
          ? (sampledTime === 0 ? oldNamed : newNamed).get(cs.viewTransitionName)?.boxShadow ?? cs.boxShadow : cs.boxShadow,
        entranceReplay: !!beforeElements?.has(selector(el)) && Array.from(animations.values()).some(a => a.kind === 'css-animation' && !a.pseudo && a.selector === selector(el)),
        content:Array.from(el.childNodes).filter(n=>n.nodeType===3).map(n=>n.textContent).join('') + (el.getAttribute('src') || ''),
        children:Array.from(el.children, child=>id(child)),
        clipped:1-(clip[2]*clip[3])/(box[2]*box[3])});
    }
    // Ordinary generated content needs an owner-qualified identity, including at
    // rest. These boxes are estimates; CSS offers no pseudo getBoundingClientRect.
    for (const el of nodes) for (const pseudo of ['::before', '::after']) {
      const owner = elements.find(e => e.id === id(el));
      if (!owner) continue;
      const cs = getComputedStyle(el, pseudo);
      if (cs.content === 'none' || cs.content === 'normal' || cs.display === 'none' || cs.visibility !== 'visible') continue;
      const width = parseFloat(cs.width), height = parseFloat(cs.height);
      if (!Number.isFinite(width) || !Number.isFinite(height)) continue;
      const matrix = new DOMMatrix(cs.transform === 'none' ? undefined : cs.transform);
      const points = [[0,0],[width,0],[0,height],[width,height]].map(([x,y])=>matrix.transformPoint({x,y}));
      const x = Math.min(...points.map(p=>p.x)), y = Math.min(...points.map(p=>p.y));
      const box = [owner.box[0]+(parseFloat(cs.left)||0)+x, owner.box[1]+(parseFloat(cs.top)||0)+y,
        Math.max(...points.map(p=>p.x))-x, Math.max(...points.map(p=>p.y))-y];
      const key = id(el) + pseudo;
      if (!pseudoIdentities.has(key)) pseudoIdentities.set(key, -10000-pseudoIdentities.size);
      const inRegion = intersect(box, region);
      if (!inRegion[2] || !inRegion[3]) { outsideIds.push(pseudoIdentities.get(key)); continue; }
      elements.push({id:pseudoIdentities.get(key), selector:owner.selector+pseudo, pseudo:true, box,
        opacity:Number(cs.opacity)*owner.opacity, clip:box, clipPath:cs.clipPath, clipped:0,
        boxShadow:cs.boxShadow, content:cs.content, ancestors:[id(el),...owner.ancestors]});
    }
    const transitionGroups = [];
    const groupNames = [];
    // getAnimations is in composite order, including the generated pseudo tree.
    for (const meta of animations.values()) {
      const match = /^::view-transition-(?:group|old|new)\((.+)\)$/.exec(meta.pseudo || '');
      if (match && !groupNames.includes(match[1])) groupNames.push(match[1]);
    }
    for (const name of [...oldNamed.keys(), ...newNamed.keys()]) if (!groupNames.includes(name)) groupNames.push(name);
    if (transitionActive) for (const name of groupNames) {
      const target = document.documentElement;
      const pseudo = `::view-transition-group(${name})`;
      const cs = getComputedStyle(target, pseudo);
      const pair = getComputedStyle(target, `::view-transition-image-pair(${name})`);
      const matrix = new DOMMatrix(cs.transform === 'none' ? undefined : cs.transform);
      const w = parseFloat(cs.width), h = parseFloat(cs.height);
      if (!Number.isFinite(w) || !Number.isFinite(h)) continue;
      const points = [[0,0],[w,0],[0,h],[w,h]].map(([x,y])=>matrix.transformPoint({x,y}));
      const x = Math.min(...points.map(p=>p.x)), y = Math.min(...points.map(p=>p.y));
      const box = [x,y,Math.max(...points.map(p=>p.x))-x,Math.max(...points.map(p=>p.y))-y];
      const inRegion = intersect(box, region);
      if (!inRegion[2] || !inRegion[3]) continue;
      const opacity = side => {
        if (!(side === 'old' ? oldNamed : newNamed).has(name)) return null;
        const style = getComputedStyle(target, `::view-transition-${side}(${name})`);
        return style.display === 'none' || style.visibility === 'hidden' ? 0 : Number(style.opacity) * Number(cs.opacity) * Number(pair.opacity);
      };
      const related = Array.from(animations.values()).filter(a => a.pseudo?.endsWith(`(${name})`));
      transitionGroups.push({name, selector:(newNamed.get(name) || oldNamed.get(name))?.selector || pseudo,
        box, oldOpacity:opacity('old'), newOpacity:opacity('new'), zIndex:Number.parseInt(cs.zIndex) || 0,
        order:groupNames.indexOf(name), blend:getComputedStyle(target, `::view-transition-new(${name})`).mixBlendMode,
        isolation:pair.isolation, background:pair.backgroundColor,
        endMs:Math.max(0,...related.map(a=>a.wallDuration)),
        geometryEndMs:Math.max(0,...related.filter(a=>a.pseudo === pseudo && a.properties.some(p=>['transform','width','height','translate','scale','rotate'].includes(p))).map(a=>a.wallDuration))});
      elements.push({id:-groupNames.indexOf(name)-1, selector:pseudo, pseudo:true, box, opacity:Number(cs.opacity), clip:box, clipPath:cs.clipPath, clipped:0, content:'', ancestors:[]});
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
    const transitionPaint = {};
    if (transitionActive) {
      for (let i=0;i<transitionGroups.length;i++) for (let j=i+1;j<transitionGroups.length;j++) {
        const a=transitionGroups[i], b=transitionGroups[j], overlap=intersect(a.box,b.box);
        if (overlap[2]<1 || overlap[3]<1) continue;
        if (Math.max(a.oldOpacity || 0,a.newOpacity || 0)<0.02 || Math.max(b.oldOpacity || 0,b.newOpacity || 0)<0.02) continue;
        const key=[a.name,b.name].sort().join(':');
        transitionPaint[key] = a.zIndex > b.zIndex || (a.zIndex === b.zIndex && a.order > b.order) ? a.name : b.name;
      }
    } else {
      const names = new Map(elements.filter(e=>e.viewTransitionName && e.viewTransitionName !== 'none').map(e=>[e.id,e.viewTransitionName]));
      for (const [pair,top] of Object.entries(paint)) {
        const [a,b]=pair.split(':').map(Number);
        if (names.has(a) && names.has(b)) transitionPaint[[names.get(a),names.get(b)].sort().join(':')]=names.get(top);
      }
    }
    if (!beforeElements) beforeElements = new Map(elements.map(e=>[e.selector,e]));
    return {elements, paint, transitionGroups, transitionPaint, viewTransition, outsideIds, scroll:[scrollX,scrollY]};
  };
  globalThis.__impeccableMotion = {
    snapshot,
    async ready() {
      await Promise.race([Promise.all(transitions).then(flush).then(() => Promise.all(Array.from(animations.keys(), a => a.ready))), new Promise((_,reject)=>setTimeout(()=>reject(Error('Animation readiness timed out')),5000))]);
      for (const [a, meta] of animations) {
        meta.origin = Number(a.currentTime) || 0;
        meta.playbackRate = a.playbackRate;
        meta.wallDuration = a.playbackRate === 0 ? 0 : Math.max(0,
          (a.playbackRate < 0 ? meta.origin : meta.end - meta.origin) / Math.abs(a.playbackRate));
        if (!Number.isFinite(meta.wallDuration) || meta.wallDuration > 10000) unsupported = 'Motion capture requires finite playback no longer than 10 seconds';
      }
      prepared = true;
      if (unsupported) throw Error(unsupported);
      return this.metadata();
    },
    metadata() { return {duration:Math.max(0,...Array.from(animations.values(), a=>a.wallDuration)), animations:Array.from(animations.values()),viewTransition}; },
    async seek(time) {
      sampledTime = time;
      collect();
      for (const [a, meta] of animations) {
        const local = meta.origin + time * meta.playbackRate;
        a.currentTime = meta.playbackRate === 0 ? meta.origin : meta.playbackRate < 0
          ? Math.max(Math.min(meta.origin, 0.01), local)
          : Math.min(local, Math.max(meta.origin, meta.end - 0.01));
      }
      await flush();
    },
    async finish() {
      collecting=false;
      for (const a of animations.keys()) { try { a.finish(); } catch {} }
      await new Promise(resolve=>setTimeout(resolve,250));
      await raf(); await raf();
      transitionActive = false;
      const running=document.getAnimations().filter(a=>a.playState==='running' || a.playState==='pending');
      if (running.length) throw Error('Motion did not settle: new or ongoing animations remain after completion');
    }
  };
  return true;
})()
