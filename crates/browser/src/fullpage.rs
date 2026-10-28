//! The full-page screenshot an evidence scan records, and a viewport shot for
//! each flagged element that falls past it.
//!
//! `Page.captureScreenshot` with `captureBeyondViewport` paints the document
//! past the viewport. That is right for most pages and wrong for three kinds,
//! each seen on real sites:
//!
//! - The page scrolls inside an element (`html, body { height: 100%;
//!   overflow: auto }`, or an app shell's main): the document is one viewport
//!   tall, so everything below the fold comes out blank.
//! - Content that renders only once it is scrolled to (a virtualized feed):
//!   the rows past the viewport do not exist at scroll 0.
//! - Content wider than the viewport: a capture cut at the viewport width
//!   leaves the overflow out, and the flagged elements with it.
//! - A page whose script answers the resize a beyond-viewport capture puts
//!   it through (developer.apple.com folds its navigator and slides the
//!   column back while the capture paints): the image shows a layout the
//!   rects were not measured in.
//!
//! The first is recognised from the page's geometry and captured by scrolling
//! that element in viewport steps and stitching the tiles. The second is
//! recognised from the image: a uniform band taller than two viewports is
//! recaptured the same way, and the stitched image is kept when it holds
//! more. The third captures the document's scroll width. The fourth is
//! recognised by measuring a sample of layout boxes before and after the
//! capture, and stitched once the page has settled.
//!
//! The screenshot is cut at a height cap. A flagged element past the cut, or
//! past the right edge, is scrolled into view and gets a viewport shot of its
//! own ([`ElementShot`]), so every flagged element has a picture. Fixed
//! chrome painted over the element there (a support appeal pinned over the
//! lower part of a phone viewport) is hidden for the shot.

use base64::Engine as _;
use image::RgbImage;
use serde_json::{json, Map, Value};

use crate::cdp::{CdpError, CdpResult, Page};
use crate::Screenshot;

/// How [`Screenshot::method`] was captured.
pub mod method {
    /// One `captureBeyondViewport` capture of the document.
    pub const BEYOND_VIEWPORT: &str = "beyond-viewport";
    /// Viewport tiles captured while scrolling, pasted into one image.
    pub const STITCHED: &str = "stitched";
}

/// The widest screenshot taken, in CSS pixels. A page wider than this is cut
/// at it, and flagged elements past it get their own shot.
pub const MAX_SCREENSHOT_WIDTH: f64 = 4096.0;
/// The most viewport captures one page's element shots take. Elements that
/// show together in one viewport share a capture.
pub const MAX_ELEMENT_SHOTS: usize = 40;
/// The most tiles one stitched capture takes before giving up on stitching.
const MAX_TILES: usize = 240;
/// A row whose sampled luma spreads no more than this reads as one colour.
const UNIFORM_ROW_SPREAD: u8 = 6;

/// A viewport screenshot taken with one flagged element scrolled into view.
#[derive(Debug, Clone)]
pub struct ElementShot {
    /// The flagged selector, a key of [`crate::Evidence::element_rects`].
    pub selector: String,
    pub jpeg_base64: String,
    /// The viewport, in CSS pixels (the scan uses a device scale factor of 1).
    pub width: f64,
    pub height: f64,
    /// The element's `[x, y, width, height]` inside this image.
    pub rect: [f64; 4],
    /// The fixed layers hidden while this image was taken, because they were
    /// painted over the element it was taken for (a support appeal, a cookie
    /// sheet), as short selectors (`aside#appeal`, `div.sheet.open`). Empty
    /// when the image shows the page as a visitor scrolled there sees it.
    pub hidden_covers: Vec<String>,
}

/// The element a page scrolls instead of its document.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Scroller {
    /// The top of its padding box, in viewport coordinates.
    pub top: f64,
    pub client_height: f64,
    pub scroll_height: f64,
    /// Where it was scrolled when the element rects were measured.
    pub scroll_top: f64,
}

impl Scroller {
    /// The page's height with this scroller unrolled: its content from where
    /// the rects were measured, plus whatever sits below its box, to the
    /// viewport's foot or, when the document scrolls a little further (a
    /// footer under a 100vh shell), to the document's.
    pub fn unrolled_height(&self, viewport_height: f64, document_height: f64) -> f64 {
        let box_bottom = self.top + self.client_height;
        let foot = viewport_height.max(document_height);
        self.top + self.scroll_height - self.scroll_top + (foot - box_bottom).max(0.0)
    }

    /// The viewport rows it shows, `[top, bottom)`.
    fn band(&self, viewport_height: f64) -> (f64, f64) {
        let top = self.top.clamp(0.0, viewport_height);
        let bottom = (self.top + self.client_height).clamp(0.0, viewport_height);
        (top, bottom)
    }
}

/// What the page measures before a capture.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Geometry {
    pub viewport_width: f64,
    pub viewport_height: f64,
    /// The document's scroll width.
    pub document_width: f64,
    /// `max(html scrollHeight, body scrollHeight, innerHeight)`.
    pub document_height: f64,
    /// Set when the document scrolls less than a quarter viewport and an
    /// element covering most of the viewport scrolls further.
    pub scroller: Option<Scroller>,
    /// The furthest left the document scrolls, in document coordinates: 0,
    /// or negative when the document scrolls from the right (a right-to-left
    /// page wider than the viewport keeps its overflow at negative x).
    pub scroll_origin_x: f64,
}

impl Geometry {
    fn from_value(v: &Value) -> Geometry {
        let num = |v: Option<&Value>, fallback: f64| {
            v.and_then(Value::as_f64).filter(|n| n.is_finite()).unwrap_or(fallback)
        };
        let viewport_width = num(v.get("vw"), 1280.0).max(1.0);
        let viewport_height = num(v.get("vh"), 800.0).max(1.0);
        let scroller = v.get("scroller").filter(|s| s.is_object()).map(|s| Scroller {
            top: num(s.get("top"), 0.0),
            client_height: num(s.get("clientHeight"), 0.0),
            scroll_height: num(s.get("scrollHeight"), 0.0),
            scroll_top: num(s.get("scrollTop"), 0.0),
        });
        Geometry {
            viewport_width,
            viewport_height,
            document_width: num(v.get("docW"), viewport_width).max(1.0),
            document_height: num(v.get("docH"), viewport_height).max(1.0),
            scroller,
            scroll_origin_x: num(v.get("originX"), 0.0).min(0.0),
        }
    }

    /// The screenshot width: the document's scroll width, at least the
    /// viewport and at most [`MAX_SCREENSHOT_WIDTH`].
    pub fn capture_width(&self) -> f64 {
        self.document_width
            .min(MAX_SCREENSHOT_WIDTH)
            .max(self.viewport_width)
            .round()
    }

    /// The document x of the screenshot's left edge ([`Screenshot::origin_x`]).
    /// A capture starts where the document's scrolling does, at
    /// [`Geometry::scroll_origin_x`]. When the width cap cuts a page that
    /// scrolls from the right, the capture starts further right instead, so
    /// the cut falls on the far overflow and the viewport stays in the image.
    pub fn capture_origin_x(&self) -> f64 {
        if self.scroll_origin_x >= 0.0 {
            return 0.0;
        }
        let cut = (self.document_width.round() - self.capture_width()).max(0.0);
        (self.scroll_origin_x + cut).min(0.0)
    }

    /// [`Geometry::capture_origin_x`] as a `Page.captureScreenshot` clip x,
    /// whose 0 is the left edge of what the document scrolls.
    pub fn capture_clip_x(&self) -> f64 {
        self.capture_origin_x() - self.scroll_origin_x
    }
}

const GEOMETRY_JS: &str = r#"(() => {
  const de = document.documentElement;
  const body = document.body;
  const se = document.scrollingElement || de;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const out = {
    vw,
    vh,
    docW: Math.max(se ? se.scrollWidth : 0, vw),
    docH: Math.max(de ? de.scrollHeight : 0, body ? body.scrollHeight : 0, vh),
    scroller: null,
    originX: 0,
  };
  // A document that scrolls from the right (a right-to-left page wider than
  // the viewport) keeps its overflow at negative x, and a beyond-viewport
  // capture starts at the left edge of that overflow: the furthest left the
  // document scrolls. Asked by scrolling there and straight back, in one task;
  // a page that scrolls from the left does not move.
  if (se && se.scrollWidth > se.clientWidth + 1) {
    const sx = window.scrollX;
    const sy = window.scrollY;
    window.scrollTo({ left: -se.scrollWidth, top: sy, behavior: 'instant' });
    out.originX = Math.min(0, window.scrollX);
    if (window.scrollX !== sx) window.scrollTo({ left: sx, top: sy, behavior: 'instant' });
  }
  try { delete window.__impeccableShotScroller; } catch (e) {}
  // A document that scrolls a viewport's quarter or more is the page. One
  // that scrolls a few rows (a body margin around a 100vh shell, a URL-bar
  // gap) may still keep its content in a frame, which then has to hold more
  // than the document does.
  const documentExtra = se ? se.scrollHeight - vh : 0;
  if (documentExtra > vh * 0.25) return out;
  let best = null;
  let extra = Math.max(1, documentExtra);
  // Open shadow trees included: an app shell rendered inside a custom
  // element scrolls a frame the document's own query never reaches.
  const all = [];
  const visit = (scope) => {
    for (const el of scope.querySelectorAll('*')) {
      all.push(el);
      if (el.shadowRoot) visit(el.shadowRoot);
    }
  };
  visit(document);
  for (const el of all) {
    const more = el.scrollHeight - el.clientHeight;
    if (more <= extra) continue;
    // `hidden` included: a smooth-scroll library moves a viewport-tall frame
    // that hides its overflow, and setting its scrollTop still scrolls it.
    const overflowY = getComputedStyle(el).overflowY;
    if (overflowY !== 'auto' && overflowY !== 'scroll' && overflowY !== 'overlay' && overflowY !== 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width < vw * 0.5 || r.height < vh * 0.5) continue;
    best = el;
    extra = more;
  }
  if (best) {
    const r = best.getBoundingClientRect();
    window.__impeccableShotScroller = best;
    out.scroller = {
      top: r.top + best.clientTop,
      clientHeight: best.clientHeight,
      scrollHeight: best.scrollHeight,
      scrollTop: best.scrollTop,
    };
  }
  return out;
})()"#;

const SCROLL_TO_JS: &str = r#"(async ({ x, y, useScroller, hideFixed, docY }) => {
  const el = useScroller ? window.__impeccableShotScroller : null;
  if (useScroller && !el) throw new Error('the page scroller is gone');
  if (el) {
    window.scrollTo({ left: x, top: docY || 0, behavior: 'instant' });
    el.scrollTo({ left: el.scrollLeft, top: y, behavior: 'instant' });
  } else {
    window.scrollTo({ left: x, top: y, behavior: 'instant' });
  }
  const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 50))));
  await frame();
  const se = document.scrollingElement || document.documentElement;
  const pos = {
    x: window.scrollX,
    y: el ? el.scrollTop : window.scrollY,
    docY: window.scrollY,
    maxY: el ? el.scrollHeight - el.clientHeight : se.scrollHeight - window.innerHeight,
  };
  // Every element under body, open shadow trees included: chrome a widget
  // renders into a shadow root repeats on tiles like any other.
  const deepAll = () => {
    const all = [];
    const visit = scope => {
      for (const node of scope.querySelectorAll('*')) {
        all.push(node);
        if (node.shadowRoot) visit(node.shadowRoot);
      }
    };
    if (document.body) visit(document.body);
    return all;
  };
  // The flat-tree parent: a slotted node's slot, else its parent, else the
  // host of the shadow root it sits at the top of.
  const up = n => n.assignedSlot || n.parentElement || (n.parentNode && n.parentNode.host) || null;
  const holds = (node, target) => {
    for (let n = target; n; n = up(n)) if (n === node) return true;
    return false;
  };
  // The first tile keeps where every positioned box sits in the viewport.
  if (!hideFixed && !window.__impeccableShotAnchors) {
    const boxes = [];
    for (const node of deepAll()) {
      const position = getComputedStyle(node).position;
      if (position !== 'absolute' && position !== 'sticky') continue;
      const r = node.getBoundingClientRect();
      boxes.push([node, r.left, r.top]);
    }
    window.__impeccableShotAnchors = { x: pos.x, y: pos.y, boxes };
  }
  // Chrome that paints where the viewport is (a chat widget, a cookie bar)
  // lands on every tile; a beyond-viewport capture shows it once, at the top.
  // Every tile after the first hides it, by opacity, since a child can
  // override a hidden parent's visibility.
  // A sticky box the document's scroll has stuck at its `top` offset, whose
  // own place in the document is above this tile, so an earlier tile painted
  // it there. `anchorTop` is where it sat on the anchor tile. A box only at
  // its offset because its section starts there, or stuck on the tile its
  // section starts on, is painted on this tile and stays.
  const stuckSincePainted = (node, r, anchorTop) => {
    const cs = getComputedStyle(node);
    if (cs.position !== 'sticky') return false;
    const offset = parseFloat(cs.top);
    if (!Number.isFinite(offset) || Math.abs(r.top - offset) >= 0.5) return false;
    const anchors = window.__impeccableShotAnchors;
    return !!anchors && anchors.y + anchorTop < pos.y - 0.5;
  };
  if (hideFixed && !window.__impeccableShotHidden) {
    const hidden = [];
    const hide = node => {
      hidden.push([node, node.style.getPropertyValue('opacity'), node.style.getPropertyPriority('opacity')]);
      node.style.setProperty('opacity', '0', 'important');
    };
    for (const node of deepAll()) {
      if (getComputedStyle(node).position !== 'fixed') continue;
      // A page can scroll a fixed frame: that frame is the content, even
      // when the frame sits in the fixed box's shadow tree.
      if (el && holds(node, el)) continue;
      // Under a transformed or filtered ancestor a fixed box scrolls along.
      let contained = false;
      for (let p = up(node); p && !contained; p = up(p)) {
        const cs = getComputedStyle(p);
        // Every property that makes an ancestor the containing block of a
        // fixed descendant.
        const none = v => !v || v === 'none';
        contained = !none(cs.transform) || !none(cs.translate) || !none(cs.scale) || !none(cs.rotate)
          || !none(cs.filter) || !none(cs.backdropFilter) || !none(cs.perspective)
          || /transform|translate|scale|rotate|filter|perspective/.test(cs.willChange)
          || /paint|layout|strict|content/.test(cs.contain);
      }
      if (!contained) hide(node);
    }
    // A box the page keeps in place while it scrolls (a tooltip re-anchored
    // to fixed chrome on every scroll, a stuck header) is viewport chrome too:
    // it did not move while the page did. So is a sticky box the document's
    // scroll has stuck at its offset, though it sat lower on the first tile
    // (a section bar under a header that scrolls away).
    const anchors = window.__impeccableShotAnchors;
    if (anchors && Math.abs(pos.x - anchors.x) + Math.abs(pos.y - anchors.y) >= 1) {
      for (const [node, left, top] of anchors.boxes) {
        if (!node.isConnected || (el && holds(node, el))) continue;
        const r = node.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        if (Math.abs(r.left - left) + Math.abs(r.top - top) < 0.5 || (!el && stuckSincePainted(node, r, top))) hide(node);
      }
    }
    window.__impeccableShotHidden = hidden;
    await frame();
  } else if (hideFixed && !el && window.__impeccableShotHidden && window.__impeccableShotAnchors) {
    // Each later tile: a sticky box that sticks only now (a section bar
    // further down) goes too, once its place at the top of its section is on
    // an earlier tile. Once hidden it stays hidden.
    const hidden = window.__impeccableShotHidden;
    const done = new Set(hidden.map(h => h[0]));
    let added = false;
    for (const [node, , top] of window.__impeccableShotAnchors.boxes) {
      if (done.has(node) || !node.isConnected) continue;
      const r = node.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      if (!stuckSincePainted(node, r, top)) continue;
      hidden.push([node, node.style.getPropertyValue('opacity'), node.style.getPropertyPriority('opacity')]);
      node.style.setProperty('opacity', '0', 'important');
      added = true;
    }
    if (added) await frame();
  }
  return pos;
})"#;

const RESTORE_JS: &str = r#"(({ scrollTop }) => {
  const hidden = window.__impeccableShotHidden;
  if (hidden) {
    for (const [node, value, priority] of hidden.reverse()) {
      if (value) node.style.setProperty('opacity', value, priority);
      else node.style.removeProperty('opacity');
    }
    try { delete window.__impeccableShotHidden; } catch (e) {}
  }
  try { delete window.__impeccableShotAnchors; } catch (e) {}
  window.scrollTo({ left: 0, top: 0, behavior: 'instant' });
  const el = window.__impeccableShotScroller;
  if (el) el.scrollTo({ left: el.scrollLeft, top: scrollTop, behavior: 'instant' });
})"#;

/// The element a flagged selector names. `node` is the flagged element's id
/// in the scan's capture, when the scan knows it: while that element is
/// still in the document (the capture keeps it as `window.__impCap`), it is
/// the answer, wherever the selector now points (a class a typing animation
/// moved to the next span, a selector that matches a carousel's clones).
/// Otherwise `identity` is `[n, count]` when the scan's capture matched the
/// selector on `count` elements and flagged the `n`th (a repeated id): while
/// the page still has `count` matches, the `n`th. Otherwise, and with neither,
/// `querySelector`'s answer.
pub const RESOLVE_FLAGGED_JS: &str = r#"((selector, identity, node) => {
  if (typeof node === 'number' && node > 0) {
    const cap = window.__impCap;
    const el = cap && cap.elements ? cap.elements[node] : null;
    if (el && el.isConnected) return el;
  }
  if (Array.isArray(identity)) {
    const all = document.querySelectorAll(selector);
    if (all.length === identity[1]) return all[identity[0]] || null;
  }
  return document.querySelector(selector);
})"#;

const ELEMENT_INTO_VIEW_JS: &str = r#"(async (resolve, { selector, identity, node, reuse, mayScroll }) => {
  let el;
  try {
    el = resolve(selector, identity, node);
  } catch (e) {
    return null;
  }
  if (!el) return null;
  // Ancestors through slots and shadow roots: a slotted element scrolls
  // inside its host's shadow frame.
  const up = n => n.assignedSlot || n.parentElement || (n.parentNode && n.parentNode.host) || null;
  const chain = [];
  for (let p = up(el); p; p = up(p)) chain.push(p);
  // How much of the element shows: its box cut by the viewport and by every
  // ancestor that clips overflow, as a share of its own area.
  const showing = () => {
    const r = el.getBoundingClientRect();
    let left = Math.max(r.left, 0);
    let top = Math.max(r.top, 0);
    let right = Math.min(r.right, window.innerWidth);
    let bottom = Math.min(r.bottom, window.innerHeight);
    for (const p of chain) {
      const cs = getComputedStyle(p);
      const pr = p.getBoundingClientRect();
      if (cs.overflowX !== 'visible') { left = Math.max(left, pr.left); right = Math.min(right, pr.right); }
      if (cs.overflowY !== 'visible') { top = Math.max(top, pr.top); bottom = Math.min(bottom, pr.bottom); }
      if (cs.position === 'fixed') break;
    }
    const area = Math.max(0, right - left) * Math.max(0, bottom - top);
    return { r, area, share: area / Math.max(1, r.width * r.height) };
  };
  const result = (moved, s) => ({
    moved,
    visible: s.area >= 1 && (s.share >= 0.25 || s.area >= 0.25 * window.innerWidth * window.innerHeight),
    rect: [s.r.x, s.r.y, s.r.width, s.r.height],
    vw: window.innerWidth,
    vh: window.innerHeight,
  });
  if (reuse) {
    const now = showing();
    if (now.share >= 0.9) return result(false, now);
  }
  if (!mayScroll) return { moved: false, visible: false };
  const offsets = () => [window.scrollX, window.scrollY]
    .concat(...chain.map(p => [p.scrollTop, p.scrollLeft]))
    .join(',');
  const before = offsets();
  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  const moved = offsets() !== before;
  if (moved) {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 50))));
  }
  return result(moved, showing());
})"#;

/// Before an element shot: hide, by opacity, each `position: fixed` layer
/// painted over the flagged element (a support appeal pinned over the lower
/// two thirds of a phone viewport, a cookie sheet), so the shot shows the
/// element rather than the chrome that follows the viewport to it. A layer is
/// over the element when the hit-test stack at one of 9 points over the
/// element's visible part lists something of the layer before it. Never the
/// layer that holds the element, never one that scrolls along (a fixed box
/// under a transformed or filtered ancestor, as `stitch` reads it), and never
/// one painted under it (a fixed backdrop). A point counts only when its
/// stack reaches the element or something inside it: where the element takes
/// no pointer events the stack runs past it to what lies beneath, so nothing
/// there is known to be above it, and such an element keeps whatever covers
/// it (as before). A layer that takes no pointer events stays too: the hit
/// test does not list it. Neither does an open modal (`dialog[open]`,
/// `aria-modal="true"`): a visitor sees it over the page, so it stays in the
/// shot. Returns the hidden layers' short selectors; [`RESTORE_COVERS_JS`]
/// puts them back. With `check` it hides nothing and answers whether the
/// last tile's hiding left this element covered or hidden: 0 when the last
/// tile serves it.
const HIDE_COVERS_JS: &str = r#"(async (resolve, { selector, identity, node }, check) => {
  if (!check) window.__impeccableShotTileCovers = [];
  let el;
  try {
    el = resolve(selector, identity, node);
  } catch (e) {
    return check ? 0 : [];
  }
  if (!el) return check ? 0 : [];
  const up = n => n.assignedSlot || n.parentElement || (n.parentNode && n.parentNode.host) || null;
  const holds = (outer, inner) => {
    for (let n = inner; n; n = up(n)) if (n === outer) return true;
    return false;
  };
  const none = v => !v || v === 'none';
  const scrollsAlong = node => {
    for (let p = up(node); p; p = up(p)) {
      const cs = getComputedStyle(p);
      if (!none(cs.transform) || !none(cs.translate) || !none(cs.scale) || !none(cs.rotate)
        || !none(cs.filter) || !none(cs.backdropFilter) || !none(cs.perspective)
        || /transform|translate|scale|rotate|filter|perspective/.test(cs.willChange)
        || /paint|layout|strict|content/.test(cs.contain)) return true;
    }
    return false;
  };
  const fixedLayer = node => {
    for (let n = node; n && n !== document.body && n !== document.documentElement; n = up(n)) {
      if (n.nodeType === 1 && getComputedStyle(n).position === 'fixed') return n;
    }
    return null;
  };
  const r = el.getBoundingClientRect();
  const left = Math.max(r.left, 0);
  const top = Math.max(r.top, 0);
  const right = Math.min(r.right, window.innerWidth);
  const bottom = Math.min(r.bottom, window.innerHeight);
  if (right - left < 1 || bottom - top < 1) return check ? 0 : [];
  const layers = new Set();
  // An element that takes no pointer events (card content under a link that
  // covers the card) is not in the hit stack. Made hit-testable for the walk,
  // it is listed at its true paint position, so what comes before it is over it.
  const pointer = [el.style.getPropertyValue('pointer-events'), el.style.getPropertyPriority('pointer-events')];
  el.style.setProperty('pointer-events', 'auto', 'important');
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const x = left + (right - left) * (i + 0.5) / 3;
      const y = top + (bottom - top) * (j + 0.5) / 3;
      const above = [];
      for (const hit of document.elementsFromPoint(x, y)) {
        // The element or something inside it: what came before is over it.
        if (holds(el, hit)) {
          for (const layer of above) layers.add(layer);
          break;
        }
        // An ancestor first: the element is not in the stack here.
        if (holds(hit, el)) break;
        const layer = fixedLayer(hit);
        if (layer && !holds(layer, el)) above.push(layer);
      }
    }
  }
  if (pointer[0]) el.style.setProperty('pointer-events', pointer[0], pointer[1]);
  else el.style.removeProperty('pointer-events');
  const modal = layer => {
    for (let n = layer; n; n = up(n)) {
      if (n.nodeType !== 1) continue;
      if ((n.localName === 'dialog' && n.hasAttribute('open')) || n.getAttribute('aria-modal') === 'true') return true;
    }
    return false;
  };
  // A fixed backdrop that wraps an open dialog is the modal too: hiding it
  // would take the dialog with it. Only a dialog the page renders counts: a
  // cookie banner's hidden preferences panel does not keep the banner.
  const shown = n => n.checkVisibility
    ? n.checkVisibility({ opacityProperty: true, visibilityProperty: true })
    : n.getClientRects().length > 0;
  const holdsModal = layer => modal(layer)
    || [...layer.querySelectorAll('dialog[open], [aria-modal="true"]')].some(shown);
  const covers = [...layers].filter(layer => !scrollsAlong(layer) && !holdsModal(layer));
  if (check) {
    // Whether the last tile serves this element too: it hid every layer
    // over this one, and none that holds it.
    const tile = window.__impeccableShotTileCovers || [];
    if (tile.some(layer => holds(layer, el))) return 1;
    return covers.filter(layer => !tile.includes(layer)).length;
  }
  const hidden = [];
  for (const layer of covers) {
    hidden.push([layer, layer.style.getPropertyValue('opacity'), layer.style.getPropertyPriority('opacity')]);
    layer.style.setProperty('opacity', '0', 'important');
  }
  window.__impeccableShotCovers = hidden;
  window.__impeccableShotTileCovers = covers;
  if (hidden.length) {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 50))));
  }
  const name = n => {
    let out = n.localName;
    if (n.id) return out + '#' + n.id;
    const cls = typeof n.className === 'string' ? n.className.trim().split(/\s+/).filter(Boolean).slice(0, 2) : [];
    return out + cls.map(c => '.' + c).join('');
  };
  return covers.map(name);
})"#;

/// Undo [`HIDE_COVERS_JS`].
const RESTORE_COVERS_JS: &str = r#"(() => {
  const hidden = window.__impeccableShotCovers;
  if (hidden) {
    for (const [node, value, priority] of hidden.reverse()) {
      if (value) node.style.setProperty('opacity', value, priority);
      else node.style.removeProperty('opacity');
    }
  }
  try { delete window.__impeccableShotCovers; } catch (e) {}
})()"#;

/// Forget the last tile's covers ([`HIDE_COVERS_JS`]) once the shots are done.
const FORGET_COVERS_JS: &str = "(() => { try { delete window.__impeccableShotTileCovers; } catch (e) {} })()";

/// Capture the page, cut at `max_height`. See the module docs for the method.
pub fn capture_full_page(page: &mut Page<'_>, max_height: f64, quality: u32) -> CdpResult<Screenshot> {
    let geometry = Geometry::from_value(&page.evaluate_value(GEOMETRY_JS)?);
    let shot = capture_with(page, &geometry, max_height, quality);
    let _ = page.evaluate(
        "(() => { try { delete window.__impeccableShotScroller; delete window.__impeccableShotProbe; } catch (e) {} })()",
    );
    shot
}

fn capture_with(
    page: &mut Page<'_>,
    geometry: &Geometry,
    max_height: f64,
    quality: u32,
) -> CdpResult<Screenshot> {
    let width = geometry.capture_width();
    if let Some(scroller) = geometry.scroller {
        let document_height = geometry
            .document_height
            .max(scroller.unrolled_height(geometry.viewport_height, geometry.document_height))
            .round();
        let height = document_height.min(max_height).max(1.0);
        if let Ok(img) = stitch(page, geometry, Some(scroller), width, height) {
            if let Some(jpeg_base64) = encode_jpeg(&img, quality) {
                return Ok(Screenshot {
                    jpeg_base64,
                    width,
                    height,
                    document_height,
                    method: method::STITCHED,
                    origin_x: geometry.capture_origin_x(),
                });
            }
        }
    }

    let document_height = geometry.document_height;
    let height = document_height.min(max_height);
    let before = probe_layout(page, true);
    let jpeg_base64 = page.screenshot_jpeg(geometry.capture_clip_x(), 0.0, width, height, quality)?;
    // A page whose script answers the capture's resize re-lays itself while
    // the capture paints (developer.apple.com folds its navigator and slides
    // the column back over 300ms): the image shows that state, not the one
    // the rects were measured in. Viewport tiles do not resize the page, so
    // the page is stitched instead, once it has settled; a stitch that fails
    // keeps the beyond-viewport capture.
    let after = probe_layout(page, false);
    if layout_moved(&before, &after) {
        // Only a page whose moved boxes come back to where they were
        // measured relaid for the capture. One that keeps moving (a marquee on `margin-left`, an
        // autoplaying accordion) is in motion either way, and a beyond-viewport
        // capture shows it no worse than tiles would.
        if wait_for_layout(page, &before, &moved_boxes(&before, &after)) {
            if let Ok(stitched) = stitch(page, geometry, None, width, height) {
                if let Some(jpeg_base64) = encode_jpeg(&stitched, quality) {
                    return Ok(Screenshot {
                        jpeg_base64,
                        width,
                        height,
                        document_height,
                        method: method::STITCHED,
                        origin_x: geometry.capture_origin_x(),
                    });
                }
            }
        }
    }
    let beyond = Screenshot {
        jpeg_base64,
        width,
        height,
        document_height,
        method: method::BEYOND_VIEWPORT,
        origin_x: geometry.capture_origin_x(),
    };
    let vh = geometry.viewport_height;
    if height < 3.0 * vh {
        return Ok(beyond);
    }
    let Some(img) = decode_jpeg(&beyond.jpeg_base64) else {
        return Ok(beyond);
    };
    let (_, blank) = longest_uniform_band(&img);
    if (blank as f64) <= 2.0 * vh {
        return Ok(beyond);
    }
    let Ok(stitched) = stitch(page, geometry, None, width, height) else {
        return Ok(beyond);
    };
    let (_, still_blank) = longest_uniform_band(&stitched);
    if still_blank as f64 + vh > blank as f64 {
        return Ok(beyond);
    }
    match encode_jpeg(&stitched, quality) {
        Some(jpeg_base64) => Ok(Screenshot {
            jpeg_base64,
            method: method::STITCHED,
            ..beyond
        }),
        None => Ok(beyond),
    }
}

/// The layout boxes of a sample of the elements in the first viewport:
/// `[left, top, width, height]` each, from `offsetLeft` and `offsetTop` up
/// the offset-parent chain, so a transform (a carousel, a reveal) does not
/// move them and only layout does. `pick` samples a fresh set (a 6x6 grid of
/// points over the viewport) and keeps it on the page; otherwise the kept
/// set is measured again, an element that left the document as `null`.
const PROBE_LAYOUT_JS: &str = r#"((pick) => {
  if (pick) {
    const seen = new Set();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 6; j++) {
        const el = document.elementFromPoint(vw * (i + 0.5) / 6, vh * (j + 0.5) / 6);
        if (el instanceof HTMLElement && el !== document.body && el !== document.documentElement) seen.add(el);
      }
    }
    window.__impeccableShotProbe = [...seen];
  }
  const probe = window.__impeccableShotProbe || [];
  return probe.map(el => {
    if (!el.isConnected) return null;
    let x = 0;
    let y = 0;
    for (let n = el; n; n = n.offsetParent) {
      x += n.offsetLeft;
      y += n.offsetTop;
    }
    return [x, y, el.offsetWidth, el.offsetHeight];
  });
})"#;

/// [`PROBE_LAYOUT_JS`]: the sample's boxes, `None` for an element gone or a
/// failed measure.
fn probe_layout(page: &mut Page<'_>, pick: bool) -> Vec<Option<[f64; 4]>> {
    let Ok(v) = page.evaluate_value(&format!("({PROBE_LAYOUT_JS})({pick})")) else {
        return Vec::new();
    };
    v.as_array()
        .map(|boxes| {
            boxes
                .iter()
                .map(|b| {
                    let n: Vec<f64> = b.as_array()?.iter().filter_map(Value::as_f64).collect();
                    (n.len() == 4).then(|| [n[0], n[1], n[2], n[3]])
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Which boxes of one sample ([`probe_layout`]) moved sideways between two
/// measures: measured both times, with the left edge or the width changed by
/// 2px or more. Only the horizontal geometry counts: an image that loads
/// during a capture pushes content down without the layout having switched.
pub fn moved_boxes(before: &[Option<[f64; 4]>], after: &[Option<[f64; 4]>]) -> Vec<bool> {
    before
        .iter()
        .zip(after)
        .map(|(b, a)| match (b, a) {
            (Some(b), Some(a)) => (b[0] - a[0]).abs() >= 2.0 || (b[2] - a[2]).abs() >= 2.0,
            _ => false,
        })
        .collect()
}

/// Whether the page's layout moved sideways between two measures of one
/// sample: at least 2 of the elements measured both times, and a quarter of
/// them, are [`moved_boxes`].
pub fn layout_moved(before: &[Option<[f64; 4]>], after: &[Option<[f64; 4]>]) -> bool {
    let measured = before.iter().zip(after).filter(|(b, a)| b.is_some() && a.is_some()).count();
    let moved = moved_boxes(before, after).iter().filter(|m| **m).count();
    moved >= 2 && moved * 4 >= measured
}

/// Whether a page measured `before` has settled back there: every box that
/// `moved` at the capture is back in its place (measured, left edge and
/// width within 2px) in the last two measures, 100ms apart. A box in steady
/// motion can pass its old place once, not twice in a row. Boxes that did
/// not move at the capture do not count: the image was painted with them
/// where they were measured, whatever they do afterwards. A box that moved
/// at the capture and keeps its new geometry leaves the page unsettled, so
/// it keeps the beyond-viewport capture: the engine cannot tell whether the
/// image or the rects hold its true place (developer.apple.com's navigator
/// labels re-wrap at the capture's resize and stay that way).
pub fn settled(before: &[Option<[f64; 4]>], moved: &[bool], measures: &[Vec<Option<[f64; 4]>>]) -> bool {
    let back = |m: &Vec<Option<[f64; 4]>>| {
        before.iter().zip(moved).enumerate().all(|(i, (b, moved))| {
            if !moved {
                return true;
            }
            match (b, m.get(i).copied().flatten()) {
                (Some(b), Some(a)) => (b[0] - a[0]).abs() < 2.0 && (b[2] - a[2]).abs() < 2.0,
                _ => false,
            }
        })
    };
    moved.iter().any(|m| *m) && measures.len() >= 2 && measures[measures.len() - 2..].iter().all(back)
}

/// Measure the sample every 100ms, up to 2 seconds, until the boxes that
/// `moved` at the capture have [`settled`] back to `before`. Returns whether
/// they did.
fn wait_for_layout(page: &mut Page<'_>, before: &[Option<[f64; 4]>], moved: &[bool]) -> bool {
    let started = std::time::Instant::now();
    let mut measures: Vec<Vec<Option<[f64; 4]>>> = Vec::new();
    while started.elapsed() < std::time::Duration::from_secs(2) {
        std::thread::sleep(std::time::Duration::from_millis(100));
        measures.push(probe_layout(page, false));
        if settled(before, moved, &measures) {
            return true;
        }
    }
    false
}

/// The start and length, in rows, of the longest run of rows that each read
/// as one colour.
pub fn longest_uniform_band(img: &RgbImage) -> (u32, u32) {
    let (w, h) = img.dimensions();
    if w == 0 {
        return (0, h);
    }
    let step = (w / 64).max(1) as usize;
    let raw = img.as_raw();
    let row_len = w as usize * 3;
    let mut best = (0u32, 0u32);
    let mut run_start: Option<u32> = None;
    for y in 0..=h {
        let uniform = y < h && {
            let row = &raw[y as usize * row_len..(y as usize + 1) * row_len];
            let (mut lo, mut hi) = (u8::MAX, 0u8);
            for x in (0..w as usize).step_by(step) {
                let p = &row[x * 3..x * 3 + 3];
                let l = ((p[0] as u32 * 299 + p[1] as u32 * 587 + p[2] as u32 * 114) / 1000) as u8;
                lo = lo.min(l);
                hi = hi.max(l);
            }
            hi - lo <= UNIFORM_ROW_SPREAD
        };
        match (uniform, run_start) {
            (true, None) => run_start = Some(y),
            (false, Some(start)) => {
                if y - start > best.1 {
                    best = (start, y - start);
                }
                run_start = None;
            }
            _ => {}
        }
    }
    best
}

/// Tile scroll positions along one axis: `0, step, 2 * step, ...` below
/// `extent`.
pub fn tile_positions(extent: f64, step: f64) -> Vec<f64> {
    if !(step >= 1.0) || !(extent > 0.0) {
        return vec![0.0];
    }
    let count = (extent / step).ceil().max(1.0) as usize;
    (0..count).map(|i| i as f64 * step).collect()
}

/// The viewport rows `[from, to)` a tile contributes. Without a scroller the
/// whole viewport. With one, the rows it shows, plus what sits above its box
/// on the first tile and below it on the last.
pub fn tile_rows(scroller: Option<&Scroller>, viewport_height: f64, first: bool, last: bool) -> (f64, f64) {
    match scroller {
        None => (0.0, viewport_height),
        Some(s) => {
            let (top, bottom) = s.band(viewport_height);
            (if first { 0.0 } else { top }, if last { viewport_height } else { bottom })
        }
    }
}

/// Copy `rows` of `tile` into `canvas`, the tile's top-left at document
/// `(dx, dy)`.
fn paste(canvas: &mut RgbImage, tile: &RgbImage, dx: f64, dy: f64, rows: (f64, f64)) {
    let (cw, ch) = (canvas.width() as i64, canvas.height() as i64);
    let tw = tile.width() as i64;
    let (dx, dy) = (dx.round() as i64, dy.round() as i64);
    let x0 = dx.max(0);
    let x1 = (dx + tw).min(cw);
    if x1 <= x0 {
        return;
    }
    let from = rows.0.max(0.0).round() as i64;
    let to = (rows.1.round() as i64).min(tile.height() as i64);
    let tile_raw = tile.as_raw();
    let canvas_row = cw as usize * 3;
    let tile_row = tw as usize * 3;
    let canvas_raw: &mut [u8] = canvas;
    for r in from..to {
        let y = r + dy;
        if y < 0 || y >= ch {
            continue;
        }
        let src = r as usize * tile_row;
        let dst = y as usize * canvas_row;
        let (sx0, sx1) = ((x0 - dx) as usize * 3, (x1 - dx) as usize * 3);
        canvas_raw[dst + x0 as usize * 3..dst + x1 as usize * 3]
            .copy_from_slice(&tile_raw[src + sx0..src + sx1]);
    }
}

/// Scroll the page (or its scroller) in viewport steps and paste each tile at
/// the document position it shows. Leaves the page scrolled to the top.
fn stitch(
    page: &mut Page<'_>,
    geometry: &Geometry,
    scroller: Option<Scroller>,
    width: f64,
    height: f64,
) -> CdpResult<RgbImage> {
    let vw = geometry.viewport_width;
    let vh = geometry.viewport_height;
    let (origin, step_y) = match &scroller {
        None => (0.0, vh),
        Some(s) => {
            let (top, bottom) = s.band(vh);
            (s.scroll_top, bottom - top)
        }
    };
    if step_y < 1.0 {
        return Err(CdpError::new("the page scroller shows no rows"));
    }
    let xs = tile_positions(width, vw);
    let ys = tile_positions(height, step_y);
    if xs.len() * ys.len() > MAX_TILES {
        return Err(CdpError::new("too many tiles to stitch"));
    }
    let mut canvas = RgbImage::from_pixel(
        width.round().max(1.0) as u32,
        height.round().max(1.0) as u32,
        image::Rgb([255, 255, 255]),
    );
    let use_scroller = scroller.is_some();
    let band_bottom = match &scroller {
        None => vh,
        Some(s) => s.band(vh).1,
    };
    let result = (|| {
        // Each row steps on from where the last one actually scrolled to, so
        // a scroll the page snaps short still leaves no gap. The first row
        // starts where the rects were measured: a scroller already offset
        // keeps the rows above it at the image's top.
        let mut ty = origin;
        let mut previous: Option<f64> = None;
        for row in 0..MAX_TILES {
            let mut row_y = 0.0;
            let mut at_bottom = false;
            for (col, &tx) in xs.iter().enumerate() {
                let args = json!({
                    // Columns start where the image does, left of 0 on a page
                    // that scrolls from the right.
                    "x": geometry.capture_origin_x() + tx,
                    "y": ty,
                    "useScroller": use_scroller,
                    "hideFixed": row > 0 || col > 0,
                });
                let pos = page.evaluate_value(&format!("({SCROLL_TO_JS})({args})"))?;
                let sx = pos.get("x").and_then(Value::as_f64).unwrap_or(0.0);
                let sy = pos.get("y").and_then(Value::as_f64).unwrap_or(0.0);
                let max_y = pos.get("maxY").and_then(Value::as_f64).unwrap_or(0.0);
                if col == 0 {
                    // A page that holds its scroll still (it resets the offset,
                    // or scrolls by transform) would paste one tile over and
                    // over: give up, and the caller keeps the beyond-viewport
                    // capture.
                    if let Some(p) = previous {
                        if sy < p + 1.0 && sy + 1.0 < max_y {
                            return Err(CdpError::new("the page did not scroll to the next tile"));
                        }
                    }
                    row_y = sy;
                    at_bottom = sy + 1.0 >= max_y;
                }
                let tile = decode_png(&page.screenshot_viewport_png()?)
                    .ok_or_else(|| CdpError::new("could not decode a viewport tile"))?;
                if tile.width() != vw.round() as u32 || tile.height() != vh.round() as u32 {
                    return Err(CdpError::new("a viewport tile does not match the viewport"));
                }
                let rows = tile_rows(scroller.as_ref(), vh, row == 0, at_bottom);
                paste(&mut canvas, &tile, sx - geometry.capture_origin_x(), sy - origin, rows);
                // A scroll that stops short sideways has reached the right edge.
                if sx - geometry.capture_origin_x() + 0.5 < tx {
                    break;
                }
            }
            if at_bottom || row_y - origin + band_bottom >= height {
                // The scroller is at its foot. A document that scrolls a
                // little further than the viewport (a footer under a 100vh
                // shell) still holds rows below it: scroll the document by
                // that much, the scroller kept where it is, and paste the
                // rows that come into view under the last tile.
                let document_extra = (geometry.document_height - vh).round();
                if use_scroller && at_bottom && document_extra >= 1.0 {
                    for &tx in &xs {
                        let args = json!({
                            "x": geometry.capture_origin_x() + tx,
                            "y": row_y,
                            "useScroller": true,
                            "hideFixed": true,
                            "docY": document_extra,
                        });
                        let pos = page.evaluate_value(&format!("({SCROLL_TO_JS})({args})"))?;
                        let sx = pos.get("x").and_then(Value::as_f64).unwrap_or(0.0);
                        let sy = pos.get("y").and_then(Value::as_f64).unwrap_or(0.0);
                        let wy = pos.get("docY").and_then(Value::as_f64).unwrap_or(0.0).round();
                        if wy < 1.0 || (sy - row_y).abs() >= 1.0 {
                            break;
                        }
                        let tile = decode_png(&page.screenshot_viewport_png()?)
                            .ok_or_else(|| CdpError::new("could not decode a viewport tile"))?;
                        if tile.width() != vw.round() as u32 || tile.height() != vh.round() as u32 {
                            return Err(CdpError::new("a viewport tile does not match the viewport"));
                        }
                        paste(&mut canvas, &tile, sx - geometry.capture_origin_x(), sy - origin + wy, (vh - wy, vh));
                        if sx - geometry.capture_origin_x() + 0.5 < tx {
                            break;
                        }
                    }
                }
                break;
            }
            previous = Some(row_y);
            ty = row_y + step_y;
        }
        Ok(())
    })();
    let restore = json!({ "scrollTop": origin });
    let _ = page.evaluate(&format!("({RESTORE_JS})({restore})"));
    result.map(|_| canvas)
}

/// Whether a flagged element's document rect falls mostly outside the
/// screenshot (less than half of it, or of the image's own height or width
/// for an element larger than the image, inside the cut and the right edge,
/// so a paragraph that starts just above the cut and runs below it counts)
/// while something of it lies right of the image's left edge and below its
/// top. `origin_x` is the
/// image's left edge in document coordinates ([`Screenshot::origin_x`]).
pub fn needs_element_shot(rect: &[f64], origin_x: f64, shot_width: f64, shot_height: f64) -> bool {
    if rect.len() < 4 || rect.iter().any(|v| !v.is_finite()) {
        return false;
    }
    let (x, y, w, h) = (rect[0] - origin_x, rect[1], rect[2], rect[3]);
    if w < 1.0 || h < 1.0 || x + w <= 0.0 || y + h <= 0.0 {
        return false;
    }
    let shown_h = (y + h).min(shot_height) - y.max(0.0);
    let shown_w = (x + w).min(shot_width) - x.max(0.0);
    shown_h < h.min(shot_height) / 2.0 || shown_w < w.min(shot_width) / 2.0
}

/// A viewport shot per flagged element past the screenshot, the element
/// scrolled into view first. An element that stays clipped away gets none, and
/// failures skip that element: the findings stand without the picture.
/// `identities` names which match of a repeated selector the scan flagged,
/// and `nodes` the flagged element itself (`selector: [id, x, y, width,
/// height]`, its id in the scan's capture first; [`RESOLVE_FLAGGED_JS`]).
#[allow(clippy::too_many_arguments)]
pub fn capture_element_shots(
    page: &mut Page<'_>,
    rects: &Map<String, Value>,
    identities: &Map<String, Value>,
    nodes: &Map<String, Value>,
    origin_x: f64,
    shot_width: f64,
    shot_height: f64,
    quality: u32,
) -> Vec<ElementShot> {
    let mut out: Vec<ElementShot> = Vec::new();
    // The tile of the page as it is scrolled now, when one was captured.
    let mut last: Option<String> = None;
    let mut captures = 0usize;
    let mut moved_any = false;
    // The fixed layers hidden for the last tile ([`ElementShot::hidden_covers`]).
    let mut tile_covers: Vec<String> = Vec::new();
    for (selector, rect) in rects {
        if selector == "body" || selector == "html" {
            continue;
        }
        let r: Vec<f64> = rect
            .as_array()
            .map(|a| a.iter().filter_map(Value::as_f64).collect())
            .unwrap_or_default();
        if !needs_element_shot(&r, origin_x, shot_width, shot_height) {
            continue;
        }
        let args = json!({
            "selector": selector,
            "identity": identities.get(selector).cloned().unwrap_or(Value::Null),
            "node": nodes.get(selector).and_then(|n| n.get(0)).cloned().unwrap_or(Value::Null),
            "reuse": last.is_some(),
            "mayScroll": captures < MAX_ELEMENT_SHOTS,
        });
        let Ok(v) = page.evaluate_value(&format!("({ELEMENT_INTO_VIEW_JS})({RESOLVE_FLAGGED_JS}, {args})")) else {
            last = None;
            continue;
        };
        if v.get("moved").and_then(Value::as_bool).unwrap_or(true) {
            moved_any = true;
            last = None;
        }
        // Still clipped away (a collapsed section, a slide past its track's
        // edge): a crop of this tile would show something else.
        if v.get("visible").and_then(Value::as_bool) != Some(true) {
            continue;
        }
        let Some(live) = v.get("rect").and_then(Value::as_array) else { continue };
        let live: Vec<f64> = live.iter().filter_map(Value::as_f64).collect();
        if live.len() < 4 {
            continue;
        }
        let vw = v.get("vw").and_then(Value::as_f64).unwrap_or(0.0);
        let vh = v.get("vh").and_then(Value::as_f64).unwrap_or(0.0);
        // The last tile hid the fixed layers over another element: it serves
        // this one only when this one is under no layer it left showing.
        if last.is_some() {
            let uncovered = page
                .evaluate_value(&format!("({HIDE_COVERS_JS})({RESOLVE_FLAGGED_JS}, {args}, true)"))
                .ok()
                .and_then(|v| v.as_f64())
                == Some(0.0);
            if !uncovered {
                last = None;
            }
        }
        let jpeg_base64 = match &last {
            Some(previous) => previous.clone(),
            None => {
                if captures >= MAX_ELEMENT_SHOTS {
                    continue;
                }
                captures += 1;
                // Fixed chrome over the element goes for the shot and comes
                // back after it: elements that share the tile share it too.
                tile_covers = page
                    .evaluate_value(&format!("({HIDE_COVERS_JS})({RESOLVE_FLAGGED_JS}, {args}, false)"))
                    .ok()
                    .and_then(|v| {
                        v.as_array()
                            .map(|a| a.iter().filter_map(Value::as_str).map(String::from).collect())
                    })
                    .unwrap_or_default();
                let shot = page.screenshot_viewport_jpeg(quality);
                if !tile_covers.is_empty() {
                    let _ = page.evaluate(RESTORE_COVERS_JS);
                }
                match shot {
                    Ok(j) => j,
                    Err(_) => continue,
                }
            }
        };
        last = Some(jpeg_base64.clone());
        out.push(ElementShot {
            selector: selector.clone(),
            jpeg_base64,
            width: vw,
            height: vh,
            rect: [live[0], live[1], live[2], live[3]],
            hidden_covers: tile_covers.clone(),
        });
    }
    let _ = page.evaluate(FORGET_COVERS_JS);
    if moved_any {
        let _ = page.evaluate("window.scrollTo({ left: 0, top: 0, behavior: 'instant' })");
    }
    out
}

fn decode_jpeg(jpeg_base64: &str) -> Option<RgbImage> {
    let bytes = base64::engine::general_purpose::STANDARD.decode(jpeg_base64).ok()?;
    image::load_from_memory_with_format(&bytes, image::ImageFormat::Jpeg)
        .ok()
        .map(|img| img.to_rgb8())
}

fn decode_png(png_base64: &str) -> Option<RgbImage> {
    let bytes = base64::engine::general_purpose::STANDARD.decode(png_base64).ok()?;
    let mut decoder = png::Decoder::new(std::io::Cursor::new(bytes));
    decoder.set_transformations(png::Transformations::normalize_to_color8());
    let mut reader = decoder.read_info().ok()?;
    let mut buf = vec![0; reader.output_buffer_size()?];
    let info = reader.next_frame(&mut buf).ok()?;
    let samples = info.color_type.samples();
    let pixels = info.width as usize * info.height as usize;
    let data = &buf[..info.buffer_size()];
    let rgb: Vec<u8> = match samples {
        3 => data.to_vec(),
        4 => data.chunks_exact(4).flat_map(|p| [p[0], p[1], p[2]]).collect(),
        1 => data.iter().flat_map(|&g| [g, g, g]).collect(),
        2 => data.chunks_exact(2).flat_map(|p| [p[0], p[0], p[0]]).collect(),
        _ => return None,
    };
    if rgb.len() != pixels * 3 {
        return None;
    }
    RgbImage::from_raw(info.width, info.height, rgb)
}

fn encode_jpeg(img: &RgbImage, quality: u32) -> Option<String> {
    let mut bytes: Vec<u8> = Vec::new();
    let encoder =
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, quality.clamp(1, 100) as u8);
    img.write_with_encoder(encoder).ok()?;
    Some(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgb;

    fn striped(w: u32, h: u32, blank_from: u32, blank_to: u32) -> RgbImage {
        RgbImage::from_fn(w, h, |x, y| {
            if y >= blank_from && y < blank_to {
                Rgb([255, 255, 255])
            } else if (x / 8 + y / 8) % 2 == 0 {
                Rgb([20, 30, 40])
            } else {
                Rgb([230, 220, 210])
            }
        })
    }

    #[test]
    fn a_layout_moved_when_a_quarter_of_the_sample_shifted_sideways() {
        let at = |x: f64, w: f64| Some([x, 100.0, w, 40.0]);
        let before = vec![at(390.0, 539.0), at(390.0, 539.0), at(150.0, 200.0), at(0.0, 1280.0), None];
        // The column moved left and the sidebar narrowed.
        let after = vec![at(309.0, 620.0), at(309.0, 620.0), at(150.0, 127.0), at(0.0, 1280.0), at(5.0, 5.0)];
        assert!(layout_moved(&before, &after));
        // One box moving is a widget, not the layout.
        let after = vec![at(309.0, 539.0), at(390.0, 539.0), at(150.0, 200.0), at(0.0, 1280.0), None];
        assert!(!layout_moved(&before, &after));
        // Content pushed down (an image loading above) is not a relayout.
        let down = |x: f64, w: f64| Some([x, 400.0, w, 90.0]);
        let after = vec![down(390.0, 539.0), down(390.0, 539.0), down(150.0, 200.0), down(0.0, 1280.0), None];
        assert!(!layout_moved(&before, &after));
        // Two of ten is under a quarter.
        let many: Vec<Option<[f64; 4]>> = (0..10).map(|i| at(i as f64 * 10.0, 50.0)).collect();
        let mut shifted = many.clone();
        shifted[0] = at(500.0, 50.0);
        shifted[1] = at(500.0, 50.0);
        assert!(!layout_moved(&many, &shifted));
        shifted[2] = at(500.0, 50.0);
        assert!(layout_moved(&many, &shifted));
        // Nothing measured twice, nothing moved.
        assert!(!layout_moved(&[], &[]));
        assert!(!layout_moved(&before, &[None, None, None, None, None]));
    }

    #[test]
    fn a_page_has_settled_when_two_measures_in_a_row_match() {
        let at = |x: f64| vec![Some([x, 0.0, 300.0, 40.0]), Some([x, 60.0, 300.0, 40.0])];
        let before = at(390.0);
        let moved = moved_boxes(&before, &at(0.0));
        assert_eq!(moved, vec![true, true]);
        // Folded, then on its way back, then back twice: settled.
        assert!(settled(&before, &moved, &[at(0.0), at(300.0), at(390.0), at(390.0)]));
        // Back once is not enough: a marquee passes its old place.
        assert!(!settled(&before, &moved, &[at(0.0), at(390.0)]));
        assert!(!settled(&before, &moved, &[at(390.0), at(200.0)]));
        // Never back.
        assert!(!settled(&before, &moved, &[at(100.0), at(200.0), at(300.0)]));
        assert!(!settled(&before, &moved, &[]));
        // Nothing moved at the capture: nothing to wait for.
        assert!(!settled(&before, &[false, false], &[at(390.0), at(390.0)]));
    }

    #[test]
    fn only_the_boxes_that_moved_at_the_capture_decide_settled() {
        // Two column boxes and four navigator labels. The capture's resize
        // moves the column and it slides back; the labels change width
        // only after the capture.
        let page = |x: f64, w: f64| -> Vec<Option<[f64; 4]>> {
            vec![
                Some([x, 0.0, 539.0, 40.0]),
                Some([x, 60.0, 539.0, 40.0]),
                Some([165.0, 0.0, w, 20.0]),
                Some([165.0, 30.0, w, 20.0]),
                Some([204.0, 60.0, w, 20.0]),
                Some([204.0, 90.0, w, 20.0]),
            ]
        };
        let before = page(390.0, 96.0);
        let after = page(309.0, 96.0);
        assert!(layout_moved(&before, &after));
        let moved = moved_boxes(&before, &after);
        assert_eq!(moved, vec![true, true, false, false, false, false]);
        // The column is back and the labels changed width for good: settled,
        // though the whole sample still reads as moved.
        let back = page(390.0, 84.0);
        assert!(layout_moved(&before, &back));
        assert!(settled(&before, &moved, &[after.clone(), back.clone(), back.clone()]));
        // Should-flag twin: a box that moved at the capture and stays
        // changed keeps the page unsettled, whatever the rest does. This
        // is developer.apple.com's shape: its labels re-wrap at the capture
        // and keep the new width, so it keeps the beyond-viewport capture.
        let rewrapped = page(309.0, 84.0);
        let moved_too = moved_boxes(&before, &rewrapped);
        assert_eq!(moved_too, vec![true; 6]);
        assert!(!settled(&before, &moved_too, &[rewrapped.clone(), back.clone(), back.clone()]));
        let stays = page(309.0, 96.0);
        assert!(!settled(&before, &moved, &[after.clone(), stays.clone(), stays]));
        let mut half = page(390.0, 96.0);
        half[1] = Some([390.0, 60.0, 420.0, 40.0]);
        assert!(!settled(&before, &moved, &[after.clone(), half.clone(), half]));
        // A moved box that left the document is not back.
        let mut gone = page(390.0, 96.0);
        gone[0] = None;
        assert!(!settled(&before, &moved, &[after, gone.clone(), gone]));
    }

    #[test]
    fn a_blank_tail_is_the_longest_uniform_band() {
        let img = striped(390, 3000, 844, 3000);
        assert_eq!(longest_uniform_band(&img), (844, 2156));
        let img = striped(390, 3000, 300, 700);
        assert_eq!(longest_uniform_band(&img), (300, 400));
    }

    #[test]
    fn a_flat_colour_band_counts_whatever_its_colour() {
        let img = RgbImage::from_fn(200, 1000, |x, y| {
            if y < 100 && x % 2 == 0 {
                Rgb([0, 0, 0])
            } else {
                Rgb([12, 14, 40])
            }
        });
        assert_eq!(longest_uniform_band(&img), (100, 900));
        // JPEG noise of a few levels still reads as flat.
        let noisy = RgbImage::from_fn(200, 500, |x, _| Rgb([250 + (x % 4) as u8, 252, 251]));
        assert_eq!(longest_uniform_band(&noisy), (0, 500));
    }

    #[test]
    fn content_everywhere_has_no_band() {
        let img = striped(390, 2000, 0, 0);
        let (_, len) = longest_uniform_band(&img);
        assert!(len < 8, "{len}");
    }

    #[test]
    fn tiles_cover_the_extent_in_steps() {
        assert_eq!(tile_positions(2532.0, 844.0), vec![0.0, 844.0, 1688.0]);
        assert_eq!(tile_positions(2533.0, 844.0), vec![0.0, 844.0, 1688.0, 2532.0]);
        assert_eq!(tile_positions(500.0, 844.0), vec![0.0]);
        assert_eq!(tile_positions(500.0, 0.0), vec![0.0]);
    }

    #[test]
    fn a_scroller_tile_pastes_the_rows_it_scrolls() {
        // A 700px scroller under a 100px header in an 844px viewport, with
        // a 44px bar below it.
        let s = Scroller {
            top: 100.0,
            client_height: 700.0,
            scroll_height: 5000.0,
            scroll_top: 0.0,
        };
        assert_eq!(tile_rows(None, 844.0, false, false), (0.0, 844.0));
        assert_eq!(tile_rows(Some(&s), 844.0, true, false), (0.0, 800.0));
        assert_eq!(tile_rows(Some(&s), 844.0, false, false), (100.0, 800.0));
        assert_eq!(tile_rows(Some(&s), 844.0, false, true), (100.0, 844.0));
        assert_eq!(s.unrolled_height(844.0, 844.0), 100.0 + 5000.0 + 44.0);
        // A document 150px taller than the viewport (a footer under the
        // shell) adds its rows below the bar.
        assert_eq!(s.unrolled_height(844.0, 994.0), 100.0 + 5000.0 + 44.0 + 150.0);
        // Rects measured with the scroller at 300 start 300px earlier.
        let scrolled = Scroller { scroll_top: 300.0, ..s };
        assert_eq!(scrolled.unrolled_height(844.0, 844.0), 100.0 + 4700.0 + 44.0);
        // A body scroller as tall as the viewport.
        let body = Scroller {
            top: 0.0,
            client_height: 844.0,
            scroll_height: 6990.0,
            scroll_top: 0.0,
        };
        assert_eq!(body.unrolled_height(844.0, 844.0), 6990.0);
        assert_eq!(tile_rows(Some(&body), 844.0, false, false), (0.0, 844.0));
    }

    #[test]
    fn paste_places_rows_at_their_document_position() {
        let mut canvas = RgbImage::from_pixel(6, 10, Rgb([255, 255, 255]));
        let tile = RgbImage::from_fn(4, 4, |_, y| Rgb([y as u8, 0, 0]));
        paste(&mut canvas, &tile, 2.0, 5.0, (1.0, 4.0));
        assert_eq!(canvas.get_pixel(2, 5).0, [255, 255, 255]);
        assert_eq!(canvas.get_pixel(2, 6).0, [1, 0, 0]);
        assert_eq!(canvas.get_pixel(5, 8).0, [3, 0, 0]);
        assert_eq!(canvas.get_pixel(1, 6).0, [255, 255, 255]);
        // Rows past the canvas and a negative offset are clipped, not wrapped.
        paste(&mut canvas, &tile, -2.0, 8.0, (0.0, 4.0));
        assert_eq!(canvas.get_pixel(0, 8).0, [0, 0, 0]);
        assert_eq!(canvas.get_pixel(1, 9).0, [1, 0, 0]);
        assert_eq!(canvas.get_pixel(2, 9).0, [255, 255, 255]);
    }

    #[test]
    fn only_elements_outside_the_screenshot_get_a_shot() {
        assert!(needs_element_shot(&[100.0, 12500.0, 200.0, 20.0], 0.0, 1280.0, 12000.0));
        assert!(needs_element_shot(&[1400.0, 300.0, 200.0, 20.0], 0.0, 1280.0, 12000.0));
        assert!(!needs_element_shot(&[100.0, 11990.0, 200.0, 20.0], 0.0, 1280.0, 12000.0));
        // Starting above the cut but mostly below it.
        assert!(needs_element_shot(&[100.0, 11990.0, 200.0, 400.0], 0.0, 1280.0, 12000.0));
        assert!(!needs_element_shot(&[100.0, 11900.0, 200.0, 120.0], 0.0, 1280.0, 12000.0));
        assert!(needs_element_shot(&[1200.0, 300.0, 400.0, 20.0], 0.0, 1280.0, 12000.0));
        // Taller than the image and filling it: the screenshot shows it.
        assert!(!needs_element_shot(&[0.0, 0.0, 1280.0, 30000.0], 0.0, 1280.0, 12000.0));
        assert!(!needs_element_shot(&[100.0, 300.0, 200.0, 20.0], 0.0, 1280.0, 12000.0));
        assert!(!needs_element_shot(&[100.0, 12500.0, 0.0, 20.0], 0.0, 1280.0, 12000.0));
        assert!(!needs_element_shot(&[-500.0, 12500.0, 200.0, 20.0], 0.0, 1280.0, 12000.0));
        assert!(!needs_element_shot(&[100.0, f64::NAN, 200.0, 20.0], 0.0, 1280.0, 12000.0));
        assert!(!needs_element_shot(&[100.0, 12500.0], 0.0, 1280.0, 12000.0));
        // An image that starts at document x -510 (a right-to-left page):
        // x -500 lies inside it, and its right edge is at document x 390.
        assert!(!needs_element_shot(&[-500.0, 300.0, 200.0, 20.0], -510.0, 900.0, 12000.0));
        assert!(needs_element_shot(&[-500.0, 12500.0, 200.0, 20.0], -510.0, 900.0, 12000.0));
        assert!(needs_element_shot(&[400.0, 300.0, 200.0, 20.0], -510.0, 900.0, 12000.0));
        assert!(!needs_element_shot(&[-800.0, 12500.0, 200.0, 20.0], -510.0, 900.0, 12000.0));
    }

    #[test]
    fn the_screenshot_starts_where_the_document_scrolls() {
        // A page that scrolls from the left starts at 0, however wide.
        let g = Geometry::from_value(&json!({ "vw": 390, "vh": 844, "docW": 1380, "docH": 7685, "originX": 0 }));
        assert_eq!((g.capture_origin_x(), g.capture_clip_x()), (0.0, 0.0));
        // A right-to-left page with 321px of overflow starts at its left edge.
        let g = Geometry::from_value(&json!({ "vw": 390, "vh": 844, "docW": 711, "docH": 1932, "originX": -321 }));
        assert_eq!((g.capture_width(), g.capture_origin_x(), g.capture_clip_x()), (711.0, -321.0, 0.0));
        // Past the width cap, the cut falls on the far overflow and the
        // viewport (document x 0 to 1280) stays in the image.
        let g = Geometry::from_value(&json!({ "vw": 1280, "vh": 800, "docW": 6000, "docH": 800, "originX": -4720 }));
        assert_eq!(g.capture_width(), MAX_SCREENSHOT_WIDTH);
        assert_eq!(g.capture_origin_x(), -(MAX_SCREENSHOT_WIDTH - 1280.0));
        assert_eq!(g.capture_clip_x(), 6000.0 - MAX_SCREENSHOT_WIDTH);
        assert_eq!(g.capture_origin_x() + g.capture_width(), 1280.0);
        // A probe with no origin, or a positive one, reads as 0.
        let g = Geometry::from_value(&json!({ "vw": 390, "vh": 844, "docW": 711, "docH": 1932 }));
        assert_eq!(g.scroll_origin_x, 0.0);
        let g = Geometry::from_value(&json!({ "vw": 390, "vh": 844, "docW": 711, "docH": 1932, "originX": 40 }));
        assert_eq!(g.capture_origin_x(), 0.0);
    }

    #[test]
    fn geometry_reads_the_probe() {
        let g = Geometry::from_value(&json!({
            "vw": 390, "vh": 844, "docW": 1320, "docH": 6990,
            "scroller": { "top": 0, "clientHeight": 844, "scrollHeight": 6990, "scrollTop": 0 },
        }));
        assert_eq!(g.capture_width(), 1320.0);
        assert_eq!(g.scroller.unwrap().scroll_height, 6990.0);
        let g = Geometry::from_value(&json!({ "vw": 1280, "vh": 800, "docW": 90000, "docH": 800, "scroller": null }));
        assert_eq!(g.capture_width(), MAX_SCREENSHOT_WIDTH);
        assert!(g.scroller.is_none());
        let g = Geometry::from_value(&json!({}));
        assert_eq!((g.viewport_width, g.viewport_height, g.capture_width()), (1280.0, 800.0, 1280.0));
    }

    #[test]
    fn jpeg_round_trip_keeps_a_band() {
        let img = striped(128, 600, 200, 600);
        let b64 = encode_jpeg(&img, 82).unwrap();
        let back = decode_jpeg(&b64).unwrap();
        assert_eq!(back.dimensions(), (128, 600));
        let (start, len) = longest_uniform_band(&back);
        assert!((195..=205).contains(&start) && len >= 390, "{start} {len}");
    }
}
