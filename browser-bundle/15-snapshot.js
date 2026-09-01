// --- browser-bundle/15-snapshot.js ---
// The page snapshot producer and the live-page IO the rules cannot do from
// a snapshot. Pure measurement: what the probe in 10-probe.js reads on
// demand, this reads once and serializes, so the WASM core can run where
// the page's Content-Security-Policy keeps WebAssembly out (the extension's
// offscreen document; see crates/core/src/browser/snapshot.rs for the
// consumer and the field contract). Nothing in here decides anything about
// a design: no thresholds, no rule names, no snippet strings.
//
// Exposed as `__impeccableSnapshot`:
//   capture(options)        -> { json, elements, stats } | { error }
//   answer(needs, elements) -> facts for the core (`hitTests` -> `hits`)
//   idOf(el, elements)      -> the element's snapshot id (0 when absent)
//   visualIO(elements)      -> the IO half of the visual-contrast pass
//                              (image loads, canvas pixel reads) over live
//                              Elements, keyed by snapshot id
//   STYLE_PROPS / PSEUDO_PROPS / STATE_PSEUDOS (the capture contract)

// Computed-style properties the rules read. Mirrors STYLE_PROPS in
// crates/core/src/browser/snapshot.rs (cargo xtask bundle checks the two
// lists agree).
const __SNAP_STYLE_PROPS = [
  "animationIterationCount", "animationName", "animationTimingFunction",
  "backdropFilter", "background", "backgroundClip", "backgroundColor",
  "backgroundImage", "backgroundPosition", "backgroundSize", "blockSize",
  "borderBottomColor", "borderBottomWidth", "borderBottomStyle",
  "borderLeftColor", "borderLeftWidth", "borderLeftStyle", "borderRadius",
  "borderRightColor", "borderRightWidth", "borderRightStyle",
  "borderTopColor", "borderTopWidth", "borderTopStyle", "bottom", "boxShadow",
  "clip", "clip-path", "clipPath", "color", "content", "contentVisibility",
  "cssFloat", "display", "filter", "float", "fontFamily", "fontSize",
  "fontStyle", "fontVariant", "fontVariantCaps", "fontWeight", "height",
  "hyphens", "inlineSize", "inset", "insetBlock", "insetBlockEnd",
  "insetBlockStart", "insetInline", "insetInlineEnd", "insetInlineStart",
  "left", "letterSpacing", "lineHeight", "marginBottom", "marginLeft",
  "marginRight", "marginTop", "maxHeight", "maxWidth", "minHeight", "minWidth",
  "mixBlendMode", "objectFit", "objectPosition", "opacity", "outline",
  "outlineColor", "outlineOffset", "outlineStyle", "outlineWidth", "overflow",
  "overflowX", "overflowY", "paddingBottom", "paddingLeft", "paddingRight",
  "paddingTop", "pointerEvents", "position", "right", "textAlign",
  "textDecoration", "textDecorationLine", "textIndent", "textOverflow",
  "textShadow", "textTransform", "top", "transform", "transitionDuration",
  "transitionProperty", "transitionTimingFunction", "verticalAlign",
  "visibility", "webkitBackgroundClip", "webkitClipPath", "webkitHyphens",
  "webkitTextFillColor", "whiteSpace", "width", "wordBreak", "zIndex",
];
// `::before` / `::after` properties, recorded where `content` is set.
const __SNAP_PSEUDO_PROPS = [
  "content", "position", "opacity", "display", "width", "height", "top",
  "right", "bottom", "left", "backgroundColor", "backgroundImage",
  "background", "borderRadius", "transform", "visibility",
];
// Pseudo-class states recorded per element (`el.matches(':name')`), so the
// snapshot selector engine can answer `:checked` / `:disabled` / ... the way
// the live DOM would. Mirrors STATE_PSEUDOS in crates/core/src/browser/selector.rs.
const __SNAP_STATE_PSEUDOS = [
  "hover", "active", "focus", "focus-within", "focus-visible", "target",
  "target-within", "checked", "indeterminate", "disabled", "required",
  "invalid", "user-invalid", "user-valid", "in-range", "out-of-range",
  "placeholder-shown", "default", "open", "autofill", "-webkit-autofill",
  "popover-open", "modal", "fullscreen", "-webkit-full-screen",
  "picture-in-picture", "playing", "buffering", "seeking", "muted",
  "volume-locked",
];
const __SNAP_NS = { "http://www.w3.org/1999/xhtml": 0, "http://www.w3.org/2000/svg": 1, "http://www.w3.org/1998/Math/MathML": 2 };
const __SNAP_DEFAULT_MAX_ELEMENTS = 30000;
const __SNAP_DEFAULT_MAX_BYTES = 48 * 1024 * 1024;

function __snapRect4(r) { return [r.x, r.y, r.width, r.height]; }
function __snapNum(v) { return typeof v === 'number' ? v : null; }

// getDirectTextRect(el): union of the client rects of the element's
// non-blank direct text nodes (same measure as 10-probe.js).
function __snapDirectTextRect(node) {
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
  if (rects.length === 0) return null;
  const left = Math.min(...rects.map(r => r.left));
  const top = Math.min(...rects.map(r => r.top));
  const right = Math.max(...rects.map(r => r.right));
  const bottom = Math.max(...rects.map(r => r.bottom));
  return [left, top, right - left, bottom - top];
}

// Every @keyframes rule, in document.styleSheets order (nested rules walked
// breadth-first like 10-probe.js keyframes()); first rule per name wins.
function __snapKeyframes() {
  const out = [];
  const seen = new Set();
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules || sheet.rules; } catch { continue; }
    if (!rules) continue;
    const stack = [...rules];
    while (stack.length) {
      const rule = stack.shift();
      if (rule.cssRules && rule.type !== 7) { stack.push(...rule.cssRules); continue; }
      if (rule.type !== 7 || seen.has(rule.name)) continue;
      seen.add(rule.name);
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
      out.push([rule.name, frames]);
    }
  }
  return out;
}

// Which recorded pseudo-class states each element carries: one document
// query per state (cheap), instead of N x states `matches` calls.
function __snapStates(ids) {
  const states = new Map();
  for (const name of __SNAP_STATE_PSEUDOS) {
    let list;
    try { list = document.querySelectorAll(':' + name); } catch { continue; }
    for (const el of list) {
      const id = ids.get(el);
      if (!id) continue;
      let arr = states.get(id);
      if (!arr) { arr = []; states.set(id, arr); }
      arr.push(name);
    }
  }
  // Custom elements without a definition (`:defined` is the common case;
  // record its complement).
  try {
    for (const el of document.querySelectorAll(':not(:defined)')) {
      const id = ids.get(el);
      if (!id) continue;
      let arr = states.get(id);
      if (!arr) { arr = []; states.set(id, arr); }
      arr.push('undefined');
    }
  } catch { /* older engines */ }
  return states;
}

// The drawable IO both adapters share: fetch an image for sampling (the
// 800ms budget and the CORS opt-in for cross-origin URLs are load policy,
// not rule logic), draw a drawable to a cached canvas, read one pixel.
function __createDrawableIO() {
  const images = new Map();      // src -> Promise<Image|null>
  const rasters = new WeakMap(); // drawable -> { ctx, plan } | { ctx: null, error }
  return {
    loadImageEl(src) {
      if (!src) return Promise.resolve(null);
      if (images.has(src)) return images.get(src);
      const promise = new Promise(resolve => {
        const img = new Image();
        let settled = false;
        const finish = value => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value);
        };
        const timer = setTimeout(() => finish(null), 800);
        try {
          const absolute = new URL(src, location.href);
          if (absolute.origin !== location.origin && absolute.protocol !== 'data:' && absolute.protocol !== 'blob:') {
            img.crossOrigin = 'anonymous';
          }
        } catch {
          // Let the browser resolve unusual URLs itself.
        }
        img.onload = () => finish(img);
        img.onerror = () => finish(null);
        img.src = src;
      });
      images.set(src, promise);
      return promise;
    },
    // Draw `drawable` to a canvas of plan.width x plan.height (cached per
    // drawable, failures included) and read the pixel at (px, py).
    // -> { data: [r, g, b, a] } | { error: message } | { noContext: true }
    readPixel(drawable, plan, px, py) {
      let cached = rasters.get(drawable);
      if (!cached) {
        const canvas = document.createElement('canvas');
        canvas.width = plan.width;
        canvas.height = plan.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return { noContext: true };
        try {
          ctx.drawImage(drawable, 0, 0, canvas.width, canvas.height);
          cached = { ctx, plan };
        } catch (err) {
          cached = { ctx: null, error: err?.message || '' };
        }
        rasters.set(drawable, cached);
      }
      if (!cached.ctx) return { error: cached.error || '' };
      try {
        const data = cached.ctx.getImageData(px, py, 1, 1).data;
        return { data: [data[0], data[1], data[2], data[3]] };
      } catch (err) {
        return { error: err?.message || '' };
      }
    },
  };
}

const __impeccableSnapshot = {
  STYLE_PROPS: __SNAP_STYLE_PROPS,
  PSEUDO_PROPS: __SNAP_PSEUDO_PROPS,
  STATE_PSEUDOS: __SNAP_STATE_PSEUDOS,

  // Serialize the page. `options.maxElements` / `options.maxBytes` are the
  // guards (defaults 30k elements / 48 MB); `options.exclude(el)` skips a
  // subtree (the extension passes its own overlay nodes, exactly the nodes
  // the rules skip through their `.impeccable-*` selectors anyway).
  capture(options = {}) {
    const t0 = performance.now();
    const maxElements = options.maxElements || __SNAP_DEFAULT_MAX_ELEMENTS;
    const maxBytes = options.maxBytes || __SNAP_DEFAULT_MAX_BYTES;
    const root = document.documentElement;
    if (!root) return { error: 'no document element' };

    // 1. Walk in document order, assign ids.
    const elements = [null];
    const ids = new WeakMap();
    const stack = [root];
    while (stack.length) {
      const el = stack.pop();
      if (options.exclude && options.exclude(el)) continue;
      const id = elements.length;
      elements.push(el);
      ids.set(el, id);
      if (elements.length > maxElements) {
        return { error: `page has more than ${maxElements} elements` };
      }
      const kids = el.children;
      for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
    }

    // 2. Intern style values.
    const strings = [];
    const stringIndex = new Map();
    const intern = (v) => {
      const s = v == null ? '' : String(v);
      let i = stringIndex.get(s);
      if (i === undefined) { i = strings.length; strings.push(s); stringIndex.set(s, i); }
      return i;
    };

    const states = __snapStates(ids);
    const els = new Array(elements.length - 1);
    for (let id = 1; id < elements.length; id++) {
      const el = elements[id];
      const rec = { t: el.tagName };
      const nsUri = el.namespaceURI || '';
      const ns = __SNAP_NS[nsUri];
      if (ns === undefined) { rec.n = 3; rec.nu = nsUri; } else if (ns !== 0) { rec.n = ns; }
      const parent = el.parentElement;
      if (parent) rec.p = ids.get(parent) || 0;
      // childNodes: element ids, text data, CDATA as [data].
      const c = [];
      for (const n of el.childNodes) {
        if (n.nodeType === 1) {
          const cid = ids.get(n);
          if (cid) c.push(cid);
        } else if (n.nodeType === 3) {
          c.push(n.textContent || '');
        } else if (n.nodeType === 4) {
          c.push([n.textContent || '']);
        }
      }
      rec.c = c;
      const names = el.getAttributeNames();
      if (names.length) rec.a = names.map(name => [name, el.getAttribute(name)]);
      const cs = getComputedStyle(el);
      rec.s = __SNAP_STYLE_PROPS.map(p => intern(cs[p]));
      for (const [key, pseudo] of [['b', '::before'], ['f', '::after']]) {
        let ps;
        try { ps = getComputedStyle(el, pseudo); } catch { continue; }
        if (!ps) continue;
        const content = ps.content;
        if (content == null || content === '' || content === 'none') continue;
        rec[key] = __SNAP_PSEUDO_PROPS.map(p => intern(ps[p]));
      }
      if (typeof el.getBoundingClientRect === 'function') rec.r = __snapRect4(el.getBoundingClientRect());
      rec.m = [
        __snapNum(el.clientWidth), __snapNum(el.clientHeight), __snapNum(el.clientLeft),
        __snapNum(el.scrollWidth), __snapNum(el.scrollLeft),
        __snapNum(el.offsetWidth), __snapNum(el.offsetHeight),
      ];
      rec.v = typeof el.checkVisibility === 'function'
        ? (el.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true }) ? 1 : 0)
        : -1;
      const dtr = __snapDirectTextRect(el);
      if (dtr) rec.d = dtr;
      if (el.isContentEditable) rec.e = true;
      if (el.hidden) rec.h = true;
      if (typeof el.id !== 'string') rec.i = true;
      if (typeof el.className !== 'string') rec.k = true;
      const st = states.get(id);
      if (st) rec.st = st;
      const tag = rec.t;
      if (tag === 'IMG' || tag === 'VIDEO' || tag === 'CANVAS' || tag === 'PICTURE') {
        rec.md = {
          nw: el.naturalWidth || 0, nh: el.naturalHeight || 0,
          vw: el.videoWidth || 0, vh: el.videoHeight || 0,
          w: typeof el.width === 'number' ? el.width : 0,
          h: typeof el.height === 'number' ? el.height : 0,
          cur: el.currentSrc || '', src: typeof el.src === 'string' ? el.src : '',
        };
      }
      els[id - 1] = rec;
    }

    // 3. Document-level facts.
    const docClone = root.cloneNode(true);
    for (const node of docClone.querySelectorAll('[id^="impeccable-live-"]')) node.remove();
    const body = document.body;
    let bodyInnerText = null;
    if (body) {
      const v = body.innerText;
      bodyInnerText = typeof v === 'string' ? v : null;
    }
    const snapshot = {
      v: 1,
      hostname: location.hostname,
      quirks: document.compatMode === 'BackCompat',
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      html: docClone.outerHTML,
      keyframes: __snapKeyframes(),
      styleProps: __SNAP_STYLE_PROPS,
      pseudoProps: __SNAP_PSEUDO_PROPS,
      strings,
      els,
      documentElement: ids.get(root) || 0,
      body: body ? (ids.get(body) || 0) : 0,
      bodyInnerText,
      hits: options.hits || [],
    };
    const json = JSON.stringify(snapshot);
    if (json.length > maxBytes) {
      return { error: `snapshot is ${json.length} bytes (limit ${maxBytes})` };
    }
    return {
      json,
      elements,
      ids,
      stats: { elements: elements.length - 1, bytes: json.length, ms: performance.now() - t0 },
    };
  },

  idOf(el, capture) {
    if (!el || !capture) return 0;
    return capture.ids.get(el) || 0;
  },

  // Answer the core's pending questions from the live page.
  answer(needs, capture) {
    const facts = { hits: [] };
    for (const [x, y] of (needs && needs.hitTests) || []) {
      const top = document.elementFromPoint(x, y);
      const stack = typeof document.elementsFromPoint === 'function' ? document.elementsFromPoint(x, y) : [];
      facts.hits.push({
        x, y,
        top: this.idOf(top, capture),
        stack: [...stack].map(el => this.idOf(el, capture)).filter(Boolean),
      });
    }
    return facts;
  },

  // The IO half of the visual-contrast pass over live Elements: image
  // loading and canvas pixel reads (see createVisualContrast in
  // 35-visual.js for the adapter contract). Refs are snapshot ids for page
  // elements and `{ url }` for separately loaded images.
  visualIO(capture) {
    const io = __createDrawableIO();
    const loadedByUrl = new Map();
    const drawableOf = (ref) => {
      if (ref && typeof ref === 'object' && ref.url) return loadedByUrl.get(ref.url) || null;
      return capture.elements[ref] || null;
    };
    return {
      // -> { ref: { url }, w, h } | null   (w = naturalWidth || width)
      async loadImage(src) {
        const img = await io.loadImageEl(src);
        if (!img) return null;
        loadedByUrl.set(src, img);
        return { ref: { url: src }, w: img.naturalWidth || img.width || 0, h: img.naturalHeight || img.height || 0 };
      },
      // -> { data: [r, g, b, a] } | { error: message } | { noContext: true }
      readPixel(ref, plan, px, py) {
        const drawable = drawableOf(ref);
        if (!drawable) return { error: 'drawable unavailable' };
        return io.readPixel(drawable, plan, px, py);
      },
    };
  },
};
