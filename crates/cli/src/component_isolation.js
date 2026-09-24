// Native capture adapter, evaluated in a CDP isolated world. Keep DOM/layout and
// authored styling; suppress paint belonging to other components. No page script
// or producer screenshot participates in this operation.
({ id, targets, pseudos = [] }) => {
  const roots = targets.map(target => {
    const matches = document.querySelectorAll(target.selector);
    if (matches.length !== 1) throw Error(`${target.id}: selector must match exactly one element (got ${matches.length}).`);
    const element = matches[0];
    if (element === document.body || element === document.documentElement || !document.body.contains(element)) {
      throw Error(`${target.id}: select a component element inside the body, not the whole document.`);
    }
    return { ...target, element };
  });
  if (new Set(roots.map(root => root.element)).size !== roots.length) throw Error('Components cannot own the same DOM element.');
  const selected = roots.find(root => root.id === id);
  if (!selected) throw Error('Missing component target.');
  const rect = selected.element.getBoundingClientRect();
  if (!rect.width || !rect.height || getComputedStyle(selected.element).visibility !== 'visible') throw Error(`${id}: component target is not visible.`);
  const otherRoots = roots.filter(root => root !== selected && selected.element.contains(root.element));
  const elements = [...document.querySelectorAll('body,body *')];
  const visibility = elements.map(element => {
    const owns = (element === selected.element || selected.element.contains(element))
      && !otherRoots.some(root => root.element === element || root.element.contains(element));
    const computed = getComputedStyle(element);
    return { owns, rect: element.getBoundingClientRect().toJSON(),
      authored: owns ? Object.fromEntries([...computed].filter(key => key !== 'visibility').map(key => [key, computed.getPropertyValue(key)])) : {},
      main: owns ? computed.visibility : 'hidden',
      pseudo: ['::before','::after','::marker'].map(pseudo => owns ? getComputedStyle(element, pseudo).visibility : 'hidden') };
  });
  // Record visible layout/text extents before isolation. A small wrapper can
  // have overflowing children; its border box alone would certify a clipped crop.
  let paint = {left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom};
  function include(bounds, element) {
    let b = {left:bounds.left,top:bounds.top,right:bounds.right,bottom:bounds.bottom};
    for(let parent=element;parent;parent=parent.parentElement){
      const style=getComputedStyle(parent), clip=parent.getBoundingClientRect();
      if(/hidden|clip|scroll|auto/.test(style.overflowX)){b.left=Math.max(b.left,clip.left);b.right=Math.min(b.right,clip.right);}
      if(/hidden|clip|scroll|auto/.test(style.overflowY)){b.top=Math.max(b.top,clip.top);b.bottom=Math.min(b.bottom,clip.bottom);}
    }
    if(b.right<=b.left||b.bottom<=b.top)return;
    paint={left:Math.min(paint.left,b.left),top:Math.min(paint.top,b.top),right:Math.max(paint.right,b.right),bottom:Math.max(paint.bottom,b.bottom)};
  }
  elements.forEach((element,index)=>{
    if(!visibility[index].owns || visibility[index].main!=='visible')return;
    include(element.getBoundingClientRect(),element.parentElement);
    for(const node of element.childNodes){
      if(node.nodeType!==Node.TEXT_NODE||!node.textContent.trim())continue;
      const range=document.createRange();range.selectNodeContents(node);
      for(const bounds of range.getClientRects())include(bounds,element);
    }
  });
  const allElements=[...document.querySelectorAll('*')];
  for(const pseudo of pseudos){
    const element=allElements[pseudo.index], index=elements.indexOf(element);
    if(index<0||!visibility[index].owns||visibility[index].main!=='visible')continue;
    if(!pseudo.box)throw Error(`${id}: generated content geometry unavailable; provide a dedicated static component document.`);
    const {x,y,w,h}=pseudo.box;
    include({left:x,top:y,right:x+w,bottom:y+h},element);
  }
  // Apply only after reading all original computed styles. Descendant components
  // keep their layout space but cannot paint inside their parent's preview.
  if (document.querySelector('[data-impeccable-capture]')) throw Error('Reserved capture attribute is already present.');
  elements.forEach((element, index) => {
    element.style.setProperty('visibility', visibility[index].main, 'important');
    element.setAttribute('data-impeccable-capture', String(index));
  });
  const style = document.createElement('style');
  // Explicit pseudo-element visibility can otherwise escape its hidden owner.
  style.textContent = elements.map((_, index) => ['::before','::after','::marker'].map((pseudo, p) =>
    `[data-impeccable-capture="${index}"]${pseudo}{visibility:${visibility[index].pseudo[p]}!important}`).join('')).join('');
  document.head.append(style);
  // A body's background can propagate to the viewport despite visibility:hidden.
  // Neither document root is a component; leave the capture canvas transparent.
  for (const root of [document.documentElement, document.body]) root.style.setProperty('background', 'transparent', 'important');
  elements.forEach((element, index) => {
    const before = visibility[index];
    if (!before.owns) return;
    const rect = element.getBoundingClientRect();
    const computed = getComputedStyle(element);
    if (['x','y','width','height'].some(key => Math.abs(before.rect[key] - rect[key]) > .01)
      || Object.entries(before.authored).some(([key, value]) => computed.getPropertyValue(key) !== value)) {
      throw Error('Isolating the component changed its authored layout or styles. Use a dedicated static component document.');
    }
  });
  const after = selected.element.getBoundingClientRect();
  if (['x','y','width','height'].some(key => Math.abs(rect[key] - after[key]) > .01)) throw Error('Isolating the component changed its layout.');
  return { method: 'dom-component-v1', selector: selected.selector, excludedComponents: otherRoots.map(root => root.id),
    bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    paintBounds: {x:paint.left,y:paint.top,width:paint.right-paint.left,height:paint.bottom-paint.top} };
}
