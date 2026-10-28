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

// The client rects of the non-blank text nodes under `node`, in document
// order. `deep` walks element children too: one line of prose is one line
// box however the markup splits it, and an inline <strong>, an <a> or a
// framework marker in the middle of a sentence is a separate text node whose
// rects belong to the same line. Nothing is merged here — the rects travel as
// the page gave them and the consumer groups them into lines (see
// merge_text_rects_into_lines in crates/foundation/src/browser/dom.rs).
// A descendant whose text is on no line, the same test as renders_no_text in
// crates/foundation/src/browser/dom.rs: the deep walk skips it so the line
// rects and the characters line-length divides among them describe the same
// text. Chrome reports no rects inside a content-visibility: hidden box
// today; the walk skips it by the shared rule rather than relying on that.
// content-visibility applies only where layout containment does, so these
// displays render their text whatever it says (content_visibility_applies).
const __NO_TEXT_TAGS = new Set(['style', 'script', 'noscript', 'template']);
const __NO_CONTAINMENT_DISPLAYS = new Set([
  'inline', 'inline flow', 'contents', 'table-row', 'table-row-group',
  'table-header-group', 'table-footer-group', 'table-column',
  'table-column-group', 'ruby', 'ruby-base', 'ruby-text',
  'ruby-base-container', 'ruby-text-container',
]);
function __rendersNoText(el) {
  if (__NO_TEXT_TAGS.has(String(el.localName || '').toLowerCase())) return true;
  const cs = getComputedStyle(el);
  if (cs.display === 'none') return true;
  return String(cs.contentVisibility || '').toLowerCase() === 'hidden'
    && !__NO_CONTAINMENT_DISPLAYS.has(String(cs.display || '').toLowerCase().trim());
}
function __collectTextRects(node, deep, out) {
  for (const child of node.childNodes) {
    if (child.nodeType === 3) {
      if (!(child.textContent || '').trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(child);
      for (const rect of range.getClientRects()) {
        if (rect.width >= 1 && rect.height >= 1) out.push(rect);
      }
      range.detach?.();
    } else if (deep && child.nodeType === 1 && !__rendersNoText(child)) {
      __collectTextRects(child, true, out);
    }
  }
  return out;
}

// The element's own direct text, unmerged: what the union rect is built from.
// An HTML <img>, by name rather than `instanceof`, which is false for a
// node adopted from another realm.
function __isImg(node) {
  return !!node && node.localName === 'img' && node.namespaceURI === 'http://www.w3.org/1999/xhtml';
}
function __directTextRects(el) {
  return __collectTextRects(__el(el), false, []);
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
  // JSON `["0%, 35%", "to", ...]`: the selector of each frame keyframes(name)
  // returns, in the same order (the same walk, the same frames skipped);
  // undefined when no rule has that name.
  keyframe_keys(name) {
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
        const keys = [];
        for (const frame of rule.cssRules || []) {
          if (!frame.style) continue;
          keys.push(String(frame.keyText || ''));
        }
        return JSON.stringify(keys);
      }
    }
    return undefined;
  },
  linked_stylesheet_text() {
    // The CSSOM walk lives in 15-snapshot.js so the standalone snapshot
    // producer carries it too; both routes read the same corpus.
    return __snapLinkedStylesheetText();
  },
  // Dom::text_wrap_pretty_supported as -1 / 0 / 1, as check_visibility
  // travels; the helper lives in 15-snapshot.js beside the CSSOM walk.
  text_wrap_pretty_supported() {
    const v = __snapTextWrapPrettySupported();
    return v === null ? -1 : (v ? 1 : 0);
  },
  // Dom::document_font_faces and Dom::rendered_faces as JSON, or undefined
  // where they cannot be read; the readers live in 15-snapshot.js beside
  // the snapshot fields of the same names.
  document_font_faces() {
    const v = __snapFontFaces();
    return v === null ? undefined : JSON.stringify(v);
  },
  rendered_faces() {
    const v = __snapRenderedFaces();
    return v === null ? undefined : JSON.stringify(v);
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
  // The top-level elements of the open shadow tree el hosts; none for a
  // closed or absent one.
  shadow_children(el) {
    let root = null;
    try { root = __el(el).shadowRoot; } catch { root = null; }
    return root ? __ids_of(root.children) : [];
  },
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
  // The element children and text nodes of el.childNodes in order: an
  // element's handle, or 0 for a text node (its data is the matching entry of
  // direct_text_nodes, which walks the same list).
  child_node_kinds(el) {
    const out = [];
    for (const n of __el(el).childNodes) {
      if (n.nodeType === 3) out.push(0);
      else if (n.nodeType === 1) out.push(__intern(n));
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
  scroll_height(el) { return __el(el).scrollHeight; },
  offset_width(el) { return __el(el).offsetWidth; },
  offset_height(el) { return __el(el).offsetHeight; },
  check_visibility(el) {
    const node = __el(el);
    if (typeof node.checkVisibility !== 'function') return -1;
    return node.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true }) ? 1 : 0;
  },
  // Image load state, for an HTMLImageElement only: [] / -1 / undefined
  // are "not an image", which the Rust side reads as None.
  image_natural_size(el) {
    const node = __el(el);
    if (!__isImg(node)) return [];
    return [node.naturalWidth || 0, node.naturalHeight || 0];
  },
  image_complete(el) {
    const node = __el(el);
    if (!__isImg(node) || typeof node.complete !== 'boolean') return -1;
    return node.complete ? 1 : 0;
  },
  image_current_src(el) {
    const node = __el(el);
    if (!__isImg(node)) return undefined;
    return typeof node.currentSrc === 'string' ? node.currentSrc : '';
  },
  // `readyState` of an HTML <video>; -1 is "not a video".
  video_ready_state(el) {
    const node = __el(el);
    if (!node || node.localName !== 'video' || node.namespaceURI !== 'http://www.w3.org/1999/xhtml'
      || typeof node.readyState !== 'number') return -1;
    return node.readyState;
  },
  // getDirectTextRect(el) from the JS driver: union of the client rects of
  // the element's non-blank direct text nodes.
  direct_text_rect(el) {
    const rects = __directTextRects(el);
    if (rects.length === 0) return [];
    const left = Math.min(...rects.map(r => r.left));
    const top = Math.min(...rects.map(r => r.top));
    const right = Math.max(...rects.map(r => r.right));
    const bottom = Math.max(...rects.map(r => r.bottom));
    return [left, top, right - left, bottom - top, top, right, bottom, left];
  },
  // JSON `["opacity", ...]`: the properties, hyphenated, of every animation
  // and transition running on the element itself (running or pending, not a
  // pseudo-element's). The snapshot records the same (15-snapshot.js
  // __snapRunningAnimations). undefined when the Web Animations API is
  // missing or throws.
  running_animation_properties(el) {
    const node = __el(el);
    if (typeof node.getAnimations !== 'function') return undefined;
    let animations;
    try { animations = node.getAnimations(); } catch { return undefined; }
    const metadata = new Set(['offset', 'computedOffset', 'easing', 'composite']);
    const props = [];
    const add = (property) => {
      const name = String(property).startsWith('--')
        ? String(property)
        : String(property).replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
      if (name && !props.includes(name)) props.push(name);
    };
    for (const animation of animations) {
      let effect;
      try {
        if (animation.playState !== 'running' && !animation.pending) continue;
        effect = animation.effect;
      } catch { continue; }
      if (!effect || effect.pseudoElement || effect.target !== node) continue;
      if (typeof animation.transitionProperty === 'string') add(animation.transitionProperty);
      let frames = [];
      try { frames = effect.getKeyframes?.() || []; } catch { frames = []; }
      for (const frame of frames) {
        for (const property of Object.keys(frame)) {
          if (!metadata.has(property)) add(property);
        }
      }
    }
    return JSON.stringify(props);
  },
  // Every rect of the element's rendered text, descendants included, flattened
  // into eights. The scope is the element's whole text_content, which is the
  // text a caller counts characters from; the caller merges the rects that
  // share a row into the line they rendered on.
  text_rects(el) {
    const out = [];
    for (const r of __collectTextRects(__el(el), true, [])) {
      out.push(r.left, r.top, r.width, r.height, r.top, r.right, r.bottom, r.left);
    }
    return out;
  },
  // Dom::last_word_rects: the word before the last, then the last, in eights
  // as text_rects lays them out; empty under two words. The walk lives in
  // 15-snapshot.js, which the in-page bundle concatenates after this file.
  last_word_rects(el) {
    const rects = __snapLastWordRects(__el(el), __rendersNoText);
    if (!rects) return [];
    return rects.flatMap(r => [r.left, r.top, r.width, r.height, r.top, r.right, r.bottom, r.left]);
  },
};
