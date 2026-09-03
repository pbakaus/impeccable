// --- browser-bundle/10-probe.js ---
// The DOM probe the WASM rule core calls back into. Pure measurement: one
// function per DOM API the rules read (see crates/core/src/browser/dom.rs for
// the contract). Elements travel as handles (indexes into a registry; 0 is
// null). Nothing in here decides anything about a design.

const __els = [null];
let __ids = new WeakMap();
const __csCache = [null];
// Drop every handle (a new scan re-interns what it touches; JS keeps
// Elements, never handles, across calls).
function __resetRegistry() {
  __els.length = 1;
  __csCache.length = 1;
  __ids = new WeakMap();
}
function __intern(el) {
  if (!el) return 0;
  let id = __ids.get(el);
  if (id === undefined) {
    id = __els.length;
    __els.push(el);
    __csCache.push(null);
    __ids.set(el, id);
  }
  return id;
}
function __el(id) {
  return __els[id] || null;
}
function __cs(id) {
  let cs = __csCache[id];
  if (!cs) {
    cs = getComputedStyle(__els[id]);
    __csCache[id] = cs;
  }
  return cs;
}
function __ids_of(list) {
  const out = new Array(list.length);
  for (let i = 0; i < list.length; i++) out[i] = __intern(list[i]);
  return out;
}
const __SEL_ERR = 0xFFFFFFFF;
function __rectArray(r) {
  return [r.x, r.y, r.width, r.height, r.top, r.right, r.bottom, r.left];
}

const __impeccableDom = {
  document_element() { return __intern(document.documentElement); },
  body() { return __intern(document.body); },
  query_all(root, selector) {
    try {
      const scope = root ? __el(root) : document;
      return __ids_of(scope.querySelectorAll(selector));
    } catch { return [__SEL_ERR]; }
  },
  query_one(root, selector) {
    try {
      const scope = root ? __el(root) : document;
      return __intern(scope.querySelector(selector));
    } catch { return __SEL_ERR; }
  },
  inner_width() { return window.innerWidth; },
  inner_height() { return window.innerHeight; },
  scroll_x() { return window.scrollX; },
  scroll_y() { return window.scrollY; },
  hostname() { return location.hostname; },
  element_from_point(x, y) { return __intern(document.elementFromPoint(x, y)); },
  elements_from_point(x, y) {
    return typeof document.elementsFromPoint === 'function' ? __ids_of(document.elementsFromPoint(x, y)) : [];
  },
  css_escape(s) { return CSS.escape(s); },
  // JSON `[[["prop","value"],...], ...]` of the first @keyframes rule named
  // `name` (document.styleSheets order, nested rules walked breadth-first
  // exactly like keyframesToggleVisibilityDOM); undefined when none.
  keyframes(name) {
    if (!name) return undefined;
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules || sheet.rules; } catch { continue; }
      if (!rules) continue;
      const stack = [...rules];
      while (stack.length) {
        const rule = stack.shift();
        if (rule.cssRules && rule.type !== 7) { stack.push(...rule.cssRules); continue; }
        if (rule.type !== 7 || rule.name !== name) continue;
        const frames = [];
        for (const frame of rule.cssRules || []) {
          const fs = frame.style;
          if (!fs) continue;
          const decls = [];
          for (let i = 0; i < fs.length; i++) {
            const prop = fs[i];
            decls.push([prop, fs.getPropertyValue(prop)]);
          }
          frames.push(decls);
        }
        return JSON.stringify(frames);
      }
    }
    return undefined;
  },
  linked_stylesheet_text() {
    // The CSSOM walk lives in 15-snapshot.js so the standalone snapshot
    // producer carries it too; both routes read the same corpus.
    return __snapLinkedStylesheetText();
  },
  document_html_for_patterns() {
    const docClone = document.documentElement.cloneNode(true);
    for (const node of docClone.querySelectorAll('[id^="impeccable-live-"]')) node.remove();
    return docClone.outerHTML;
  },
  tag_name(el) { return __el(el).tagName; },
  namespace_uri(el) { return __el(el).namespaceURI || ''; },
  parent(el) { return __intern(__el(el).parentElement); },
  children(el) { return __ids_of(__el(el).children); },
  previous_element_sibling(el) { return __intern(__el(el).previousElementSibling); },
  next_element_sibling(el) { return __intern(__el(el).nextElementSibling); },
  contains(a, b) { return __el(a).contains(__el(b)); },
  matches(el, selector) {
    try { return __el(el).matches(selector) ? 1 : 0; } catch { return __SEL_ERR; }
  },
  closest(el, selector) {
    try { return __intern(__el(el).closest(selector)); } catch { return __SEL_ERR; }
  },
  attr(el, name) {
    const v = __el(el).getAttribute(name);
    return v == null ? undefined : v;
  },
  id_prop(el) {
    const v = __el(el).id;
    return typeof v === 'string' ? v : undefined;
  },
  class_name_prop(el) {
    const v = __el(el).className;
    return typeof v === 'string' ? v : undefined;
  },
  text_content(el) { return __el(el).textContent || ''; },
  inner_text(el) {
    const v = __el(el).innerText;
    return typeof v === 'string' && v ? v : undefined;
  },
  direct_text_nodes(el) {
    const out = [];
    for (const n of __el(el).childNodes) {
      if (n.nodeType === 3) out.push(n.textContent || '');
    }
    return out;
  },
  is_content_editable(el) { return !!__el(el).isContentEditable; },
  hidden_prop(el) { return !!__el(el).hidden; },
  style(el, prop) {
    const v = __cs(el)[prop];
    return v == null ? '' : String(v);
  },
  pseudo_style(el, pseudo, prop) {
    let ps;
    try { ps = getComputedStyle(__el(el), pseudo); } catch { return undefined; }
    if (!ps) return undefined;
    const v = ps[prop];
    return v == null ? '' : String(v);
  },
  rect(el) {
    const node = __el(el);
    if (typeof node.getBoundingClientRect !== 'function') return [];
    return __rectArray(node.getBoundingClientRect());
  },
  client_width(el) { return __el(el).clientWidth; },
  client_height(el) { return __el(el).clientHeight; },
  client_left(el) { return __el(el).clientLeft; },
  scroll_width(el) { return __el(el).scrollWidth; },
  scroll_left(el) { return __el(el).scrollLeft; },
  offset_width(el) { return __el(el).offsetWidth; },
  offset_height(el) { return __el(el).offsetHeight; },
  check_visibility(el) {
    const node = __el(el);
    if (typeof node.checkVisibility !== 'function') return -1;
    return node.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true }) ? 1 : 0;
  },
  // getDirectTextRect(el) from the JS driver: union of the client rects of
  // the element's non-blank direct text nodes.
  direct_text_rect(el) {
    const node = __el(el);
    const rects = [];
    for (const child of node.childNodes) {
      if (child.nodeType !== 3 || !(child.textContent || '').trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(child);
      for (const rect of range.getClientRects()) {
        if (rect.width >= 1 && rect.height >= 1) rects.push(rect);
      }
      range.detach?.();
    }
    if (rects.length === 0) return [];
    const left = Math.min(...rects.map(r => r.left));
    const top = Math.min(...rects.map(r => r.top));
    const right = Math.max(...rects.map(r => r.right));
    const bottom = Math.max(...rects.map(r => r.bottom));
    return [left, top, right - left, bottom - top, top, right, bottom, left];
  },
};
