// Fixed reads at a point of the walked page, for the person's own agent (agent.js): what a generic browser tool can't
// tell it. Each runs in the walk's own world (driver.js `inspect`), from its source here: no code from anyone else.
// Neither reads a field's value, so nothing typed, a password least of all, comes back.

/** The element at a point: its computed type, colour, space and border, and its custom properties in use. */
function stylesAt(x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const cs = getComputedStyle(el);
  const KEEP = ['display', 'position', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-transform', 'text-align',
    'color', 'background-color', 'background-image', 'opacity', 'border-top', 'border-right', 'border-bottom', 'border-left', 'border-radius', 'outline',
    'box-shadow', 'padding', 'margin', 'gap', 'width', 'height', 'transition', 'animation-name', 'z-index'];
  const styles = {};
  for (const name of KEEP) {
    const value = cs.getPropertyValue(name);
    if (value && !['none', 'normal', 'auto', '0px', 'rgba(0, 0, 0, 0)', 'static', 'start'].includes(value)) styles[name] = value.slice(0, 200);
  }
  // The tokens: custom properties the element's own rules name, with what they are here.
  const tokens = {};
  const named = new Set();
  const walkRules = (rules) => {
    for (const rule of rules) {
      if (rule.cssRules) walkRules(rule.cssRules);
      if (!rule.selectorText || !rule.style) continue;
      let hit = false;
      try { hit = el.matches(rule.selectorText); } catch { /* a selector this Chrome can't match */ }
      if (hit) for (const found of rule.style.cssText.matchAll(/var\((--[\w-]+)/g)) named.add(found[1]);
    }
  };
  for (const sheet of document.styleSheets) {
    try { walkRules(sheet.cssRules); } catch { /* another origin's sheet */ }
    if (named.size > 40) break;
  }
  for (const name of [...named].slice(0, 40)) tokens[name] = cs.getPropertyValue(name).trim().slice(0, 200);
  const tag = el.tagName.toLowerCase();
  const classes = typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).slice(0, 3).join('.')}` : '';
  // Its own words only: never a field's, nor a script's (a textarea's starting text is its child), nor the page's code.
  let text = '';
  const words = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (node) => (node.parentElement?.closest('textarea, select, option, input, script, style, noscript, template, [contenteditable]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
  for (let node = words.nextNode(); node && text.length < 120; node = words.nextNode()) text += ` ${node.textContent}`;
  text = text.trim().replace(/\s+/g, ' ').slice(0, 80);
  return { element: `${tag}${classes}`, ...(text ? { text } : {}), styles, tokens };
}

/**
 * The element at a point: its box and the edges of what it paints (its text's glyph boxes, its images and drawings),
 * and how far each ink edge sits inside the box. Alignment is judged by ink, not by boxes.
 */
function inkAt(x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const round = (n) => Math.round(n * 10) / 10;
  const rect = (r) => ({ left: round(r.left), top: round(r.top), right: round(r.right), bottom: round(r.bottom) });
  const box = el.getBoundingClientRect();
  let ink = null;
  const add = (r) => {
    if (!r.width || !r.height) return;
    ink = ink ? { left: Math.min(ink.left, r.left), top: Math.min(ink.top, r.top), right: Math.max(ink.right, r.right), bottom: Math.max(ink.bottom, r.bottom) } : { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  };
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let node = walker.currentNode, seen = 0; node && seen < 2000; node = walker.nextNode(), seen++) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (!node.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) add(r);
    } else if (['IMG', 'SVG', 'svg', 'CANVAS', 'VIDEO', 'PICTURE'].includes(node.tagName)) {
      add(node.getBoundingClientRect());
    }
  }
  const out = { element: el.tagName.toLowerCase(), box: rect(box), ink: ink ? rect(ink) : null };
  if (ink) out.inset = { left: round(ink.left - box.left), top: round(ink.top - box.top), right: round(box.right - ink.right), bottom: round(box.bottom - ink.bottom) };
  return out;
}

export const INSPECTS = Object.freeze({ styles: String(stylesAt), ink: String(inkAt) });
