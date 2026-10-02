// Share of the viewport that raster images paint, measured from rendered boxes.
// Counts <img> (any source, data URIs included), <video>, <input type=image>,
// SVG <image>, and elements or ::before/::after pseudo-elements that paint a
// url() image (background, border, mask, list marker or generated content).
// Gradients and same-document fragment references (url(#mask), a pattern or
// mask drawn in SVG) are code and do not count. A no-repeat background with an
// explicit pixel size counts at that size; object-fit contain/scale-down counts
// the letterboxed picture, not its box. Every box is clipped by the ancestors
// that clip it (overflow or contain: paint on its containing-block chain), and
// an element under an ancestor with opacity 0 paints nothing. The union is taken
// on a 4px grid so tiled or overlapping pieces add up once.
//
// `exclude` (optional) is what a spec with raster regions declares: `boxes`
// are the regions' viewport rectangles, whose grid cells (by cell centre) are
// left out of the count, and `paths` are the declared plates (project paths),
// whose images are not counted at all. With neither, every image counts.
(exclude) => {
  const W = innerWidth, H = innerHeight, cell = 4;
  const cols = Math.ceil(W / cell), rows = Math.ceil(H / cell);
  const grid = new Uint8Array(cols * rows);
  const items = [];
  const page = location.href.split('#')[0];
  const boxes = (exclude && exclude.boxes) || [];
  // A resource is named by origin and path: the snapshot server ignores the
  // query string, and a fragment never reaches it, so `art.png?v=2` is the plate.
  const resource = u => u.origin + u.pathname;
  const plates = new Set(((exclude && exclude.paths) || []).map(p => resource(new URL(p, location.origin + '/'))));
  const outside = (x, y) => !boxes.some(b => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h);
  // The images a value references that are not fragments of this document.
  // Chromium may report url(#id) resolved against the page URL. An unparsable
  // reference is counted, never waived.
  const refs = v => {
    const out = [];
    if (typeof v !== 'string') return out;
    for (const m of v.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi)) {
      const ref = m[2];
      if (ref.startsWith('#')) continue;
      try {
        const u = new URL(ref, page);
        if (u.hash && u.href.split('#')[0] === page) continue;
        out.push(resource(u));
      } catch { out.push(null); }
    }
    return out;
  };
  const url = v => refs(v).length > 0;
  // A piece drawn only from declared plates is the spec's own raster.
  const declared = srcs => plates.size > 0 && srcs.length > 0 && srcs.every(u => u && plates.has(u));
  const px = v => /^-?[\d.]+px$/.test(v) ? parseFloat(v) : null;
  const intersect = (a, b) => ({ left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) });
  const createsFixedBlock = s => s.transform !== 'none' || s.perspective !== 'none' || s.filter !== 'none'
    || /transform|perspective|filter/.test(s.willChange) || /paint|layout|strict|content/.test(s.contain);
  const clips = s => s.overflowX !== 'visible' || s.overflowY !== 'visible' || /paint|strict|content/.test(s.contain);
  // Clip by the ancestors that actually clip the box: an absolutely positioned
  // box escapes overflow below its containing block, and a fixed one escapes
  // everything but a transform-like containing block. Never clip by an ancestor
  // that does not contain the box, or a hidden-overflow wrapper would let a
  // full-viewport image through.
  const clipped = (from, mode, r) => {
    for (let a = from; a && a !== document.documentElement; a = a.parentElement) {
      const s = getComputedStyle(a);
      const contains = mode === 'fixed' ? createsFixedBlock(s)
        : mode === 'absolute' ? (s.position !== 'static' || createsFixedBlock(s)) : true;
      if (!contains) continue;
      if (clips(s)) {
        const b = a.getBoundingClientRect();
        r = intersect(r, { left: b.left + a.clientLeft, top: b.top + a.clientTop, right: b.left + a.clientLeft + a.clientWidth, bottom: b.top + a.clientTop + a.clientHeight });
      }
      mode = s.position === 'fixed' || s.position === 'absolute' ? s.position : 'static';
    }
    return r;
  };
  const transparent = el => {
    for (let a = el; a; a = a.parentElement) if (parseFloat(getComputedStyle(a).opacity) === 0) return true;
    return false;
  };
  const mark = (from, mode, r, what, srcs) => {
    if (srcs && declared(srcs)) return;
    r = intersect(clipped(from, mode, r), { left: 0, top: 0, right: W, bottom: H });
    if (r.right <= r.left || r.bottom <= r.top) return;
    let own = 0;
    for (let y = Math.floor(r.top / cell); y < Math.ceil(r.bottom / cell); y++)
      for (let x = Math.floor(r.left / cell); x < Math.ceil(r.right / cell); x++) {
        if (!outside((x + 0.5) * cell, (y + 0.5) * cell)) continue;
        grid[y * cols + x] = 1;
        own++;
      }
    if (!own) return;
    // Without exclusion boxes a piece's share is its painted area; with them,
    // the share of the viewport it paints outside the declared regions.
    const share = boxes.length ? own / (cols * rows) : (r.right - r.left) * (r.bottom - r.top) / (W * H);
    items.push({ what, box: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.right - r.left), h: Math.round(r.bottom - r.top) }, share });
  };
  const name = el => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.classList.length ? '.' + [...el.classList].slice(0, 2).join('.') : '');
  const box = r => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
  const background = (s, r) => {
    const size = (s.backgroundSize || '').split(' ').map(px);
    const norepeat = /^no-repeat( no-repeat)?$/.test(s.backgroundRepeat || '');
    if (norepeat && size.length === 2 && size[0] != null && size[1] != null) {
      const [x, y] = (s.backgroundPosition || '0px 0px').split(' ').map(v => px(v) ?? 0);
      return { left: r.left + x, top: r.top + y, right: r.left + x + size[0], bottom: r.top + y + size[1] };
    }
    return box(r);
  };
  // The painted picture of a replaced element: object-fit contain and
  // scale-down letterbox it inside the content box.
  const picture = (el, s, r) => {
    const c = { left: r.left + (px(s.borderLeftWidth) ?? 0) + (px(s.paddingLeft) ?? 0), top: r.top + (px(s.borderTopWidth) ?? 0) + (px(s.paddingTop) ?? 0),
      right: r.right - (px(s.borderRightWidth) ?? 0) - (px(s.paddingRight) ?? 0), bottom: r.bottom - (px(s.borderBottomWidth) ?? 0) - (px(s.paddingBottom) ?? 0) };
    const nw = el.naturalWidth || el.videoWidth || 0, nh = el.naturalHeight || el.videoHeight || 0;
    if (!['contain', 'scale-down'].includes(s.objectFit) || !nw || !nh) return c;
    const cw = c.right - c.left, ch = c.bottom - c.top;
    let k = Math.min(cw / nw, ch / nh);
    if (s.objectFit === 'scale-down') k = Math.min(k, 1);
    const w = nw * k, h = nh * k;
    const [ox, oy] = (s.objectPosition || '50% 50%').split(' ');
    const at = (v, free) => v?.endsWith('%') ? free * parseFloat(v) / 100 : (px(v) ?? free / 2);
    const x = c.left + at(ox, cw - w), y = c.top + at(oy, ch - h);
    return { left: x, top: y, right: x + w, bottom: y + h };
  };
  for (const el of document.querySelectorAll('*')) {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility !== 'visible' || transparent(el)) continue;
    const r = el.getBoundingClientRect();
    const tag = el.tagName.toLowerCase();
    const at = (rect, what, srcs) => mark(el.parentElement, s.position, rect, what, srcs);
    const src = v => { try { return v ? [resource(new URL(v, page))] : []; } catch { return [null]; } };
    if (tag === 'img' || tag === 'video' || (tag === 'input' && el.type === 'image')) at(picture(el, s, r), name(el), src(el.currentSrc || el.src));
    if (tag === 'image') at(box(r), name(el), src(el.href && el.href.baseVal));
    if (url(s.backgroundImage)) at(background(s, r), name(el) + ' background', refs(s.backgroundImage));
    if (url(s.borderImageSource) || url(s.maskImage) || url(s.webkitMaskImage)) at(box(r), name(el) + ' border/mask image', [...refs(s.borderImageSource), ...refs(s.maskImage), ...refs(s.webkitMaskImage)]);
    if (url(s.listStyleImage) && s.display === 'list-item') at(box(r), name(el) + ' list marker', refs(s.listStyleImage));
    for (const p of ['::before', '::after']) {
      const ps = getComputedStyle(el, p);
      if (!ps || ps.content === 'none' || ps.content === 'normal' || ps.display === 'none' || ps.visibility !== 'visible' || parseFloat(ps.opacity) === 0) continue;
      if (!(url(ps.content) || url(ps.backgroundImage) || url(ps.borderImageSource) || url(ps.maskImage) || url(ps.webkitMaskImage))) continue;
      // A pseudo-element has no client rect. With a used pixel size, count that
      // size (at the viewport origin when fixed, else at the host's corner);
      // without one, count the host box. Its clipping chain starts at the host.
      const mode = ps.position === 'fixed' || ps.position === 'absolute' ? ps.position : 'static';
      const w = px(ps.width), h = px(ps.height);
      const srcs = [ps.content, ps.backgroundImage, ps.borderImageSource, ps.maskImage, ps.webkitMaskImage].flatMap(refs);
      if (w == null || h == null) { mark(el, mode, box(r), name(el) + p, srcs); continue; }
      const left = mode === 'fixed' ? (px(ps.left) ?? 0) : r.left, top = mode === 'fixed' ? (px(ps.top) ?? 0) : r.top;
      mark(el, mode, { left, top, right: left + w, bottom: top + h }, name(el) + p, srcs);
    }
  }
  const covered = grid.reduce((n, v) => n + v, 0);
  items.sort((a, b) => b.share - a.share);
  const result = { share: covered / (cols * rows), cell, largest: items.slice(0, 5), measure: 'painted-box-union-v2' };
  if (exclude) result.excluded = { boxes, paths: exclude.paths || [] };
  return result;
}
