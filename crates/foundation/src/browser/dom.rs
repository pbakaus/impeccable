//! The DOM probe the browser rules run against.
//!
//! The in-page bundle keeps only measurement in JavaScript: every rule that
//! used to be a `checkElement*DOM` / `check*DOM` adapter in `checks.mjs` and
//! the driver in `browser/injected/index.mjs` is Rust code written against
//! this trait. The wasm crate implements it by calling back into a small JS
//! probe object (element handles are indexes into a JS-side registry); unit
//! tests implement it with [`super::fake_dom::FakeDom`].
//!
//! Semantics mirror the DOM APIs the JS called, one method per API, so a
//! ported function reads like the source: `dom.style(el, "fontSize")` is
//! `getComputedStyle(el).fontSize`, `dom.closest(el, sel)` is
//! `el.closest(sel)`, and so on. Where the JS wrapped a call in `try/catch`
//! (invalid selectors), the method returns `Result` and the caller keeps the
//! same fallback.

/// An element handle. `0` is never a valid element (the JS registry keeps
/// index 0 empty), so `Option<ElId>` marshals as a plain u32.
pub type ElId = u32;

/// `DOMRect` as `getBoundingClientRect()` returns it.
#[derive(Debug, Clone, Copy, PartialEq, Default, serde::Serialize, serde::Deserialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
    pub left: f64,
}

impl Rect {
    pub fn from_xywh(x: f64, y: f64, width: f64, height: f64) -> Self {
        Rect {
            x,
            y,
            width,
            height,
            top: y,
            right: x + width,
            bottom: y + height,
            left: x,
        }
    }
    /// JS `[rect.top, rect.right, rect.bottom, rect.left, rect.width, rect.height].every(Number.isFinite)`.
    pub fn all_finite(&self) -> bool {
        [
            self.top,
            self.right,
            self.bottom,
            self.left,
            self.width,
            self.height,
        ]
        .iter()
        .all(|v| v.is_finite())
    }
}

/// An invalid selector: the DOM threw a `SyntaxError`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SelectorError;

/// One `@keyframes` frame as the CSSOM exposes it: the declarations in
/// `frame.style` order (`[prop, value]`, prop as the CSSOM spells it, i.e.
/// hyphenated).
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
pub struct KeyframeFrame {
    pub decls: Vec<(String, String)>,
}

/// The DOM measurement surface. Element handles are opaque `u32`s.
pub trait Dom {
    // ── document / window ─────────────────────────────────────────────
    fn document_element(&self) -> Option<ElId>;
    fn body(&self) -> Option<ElId>;
    /// `document.querySelectorAll(sel)` (root `None`) or `el.querySelectorAll(sel)`.
    fn query_all(&self, root: Option<ElId>, selector: &str) -> Result<Vec<ElId>, SelectorError>;
    /// `document.querySelector(sel)` / `el.querySelector(sel)`.
    fn query_one(&self, root: Option<ElId>, selector: &str) -> Result<Option<ElId>, SelectorError>;
    fn inner_width(&self) -> f64;
    fn inner_height(&self) -> f64;
    fn scroll_x(&self) -> f64;
    fn scroll_y(&self) -> f64;
    /// `location.hostname`.
    fn hostname(&self) -> String;
    /// `document.elementFromPoint(x, y)`.
    fn element_from_point(&self, x: f64, y: f64) -> Option<ElId>;
    /// `document.elementsFromPoint(x, y)`.
    fn elements_from_point(&self, x: f64, y: f64) -> Vec<ElId>;
    /// `CSS.escape(s)`.
    fn css_escape(&self, s: &str) -> String;
    /// The frames of the `@keyframes` rule named `name`, walking
    /// `document.styleSheets` in order (nested rules included, cross-origin
    /// sheets skipped) and returning the FIRST rule with that name; `None`
    /// when no sheet declares it. Mirrors `keyframesToggleVisibilityDOM`'s
    /// walk order.
    fn keyframes(&self, name: &str) -> Option<Vec<KeyframeFrame>>;
    /// `document.documentElement.cloneNode(true)` with every
    /// `[id^="impeccable-live-"]` node removed, serialized as `outerHTML`.
    fn document_html_for_patterns(&self) -> String;
    /// The CSS of every readable linked stylesheet whose rules resolve to a
    /// live element, flattened out of its grouping rules (#709). Empty when
    /// the probe cannot read the CSSOM.
    fn linked_stylesheet_text(&self) -> String {
        String::new()
    }

    // ── element identity / tree ───────────────────────────────────────
    /// `el.tagName` (uppercase for HTML elements, as-is for SVG/foreign).
    fn tag_name(&self, el: ElId) -> String;
    /// `el.namespaceURI`.
    fn namespace_uri(&self, el: ElId) -> String;
    fn parent(&self, el: ElId) -> Option<ElId>;
    fn children(&self, el: ElId) -> Vec<ElId>;
    fn previous_element_sibling(&self, el: ElId) -> Option<ElId>;
    fn next_element_sibling(&self, el: ElId) -> Option<ElId>;
    /// `a.contains(b)` (true when `a === b`).
    fn contains(&self, a: ElId, b: ElId) -> bool;
    fn matches(&self, el: ElId, selector: &str) -> Result<bool, SelectorError>;
    fn closest(&self, el: ElId, selector: &str) -> Result<Option<ElId>, SelectorError>;

    // ── attributes / text ─────────────────────────────────────────────
    /// `el.getAttribute(name)`; `None` when absent.
    fn attr(&self, el: ElId, name: &str) -> Option<String>;
    /// `typeof el.id === 'string' ? el.id : null` (a `<form>` with a named
    /// `id` control shadows the getter with the element).
    fn id_prop(&self, el: ElId) -> Option<String>;
    /// `typeof el.className === 'string' ? el.className : null` (SVG
    /// elements expose an `SVGAnimatedString`).
    fn class_name_prop(&self, el: ElId) -> Option<String>;
    /// `el.textContent` (`""` when null).
    fn text_content(&self, el: ElId) -> String;
    /// `el.innerText` when it is a non-empty string, else `None`.
    fn inner_text(&self, el: ElId) -> Option<String>;
    /// The `textContent` of every direct child text node (`nodeType === 3`),
    /// in order. Empty text nodes are included (they matter for `join(' ')`).
    fn direct_text_nodes(&self, el: ElId) -> Vec<String>;
    /// `el.isContentEditable`.
    fn is_content_editable(&self, el: ElId) -> bool;
    /// `el.hidden` (the boolean IDL attribute).
    fn hidden_prop(&self, el: ElId) -> bool;

    // ── computed style / geometry ─────────────────────────────────────
    /// `getComputedStyle(el)[prop]` with `prop` as the JS spelled it
    /// (`backgroundColor`, `clip-path`, `float`, ...); `""` when the value is
    /// null/undefined.
    fn style(&self, el: ElId, prop: &str) -> String;
    /// `getComputedStyle(el, pseudo)[prop]`; `None` when getComputedStyle
    /// threw or returned nothing (the JS `try { ps = ... } catch { continue }`
    /// plus `!ps` guard). `pseudo` is `"::before"` / `"::after"`.
    fn pseudo_style(&self, el: ElId, pseudo: &str, prop: &str) -> Option<String>;
    /// `el.getBoundingClientRect()`.
    fn rect(&self, el: ElId) -> Rect;
    fn client_width(&self, el: ElId) -> f64;
    fn client_height(&self, el: ElId) -> f64;
    fn client_left(&self, el: ElId) -> f64;
    fn scroll_width(&self, el: ElId) -> f64;
    fn scroll_left(&self, el: ElId) -> f64;
    fn offset_width(&self, el: ElId) -> f64;
    fn offset_height(&self, el: ElId) -> f64;
    /// `el.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true })`;
    /// `None` when the method does not exist.
    fn check_visibility(&self, el: ElId) -> Option<bool>;
    /// `getDirectTextRect(el)` from index.mjs: the union of the client rects
    /// of every non-blank direct text node (rects narrower/shorter than 1px
    /// dropped); `None` when there is none.
    fn direct_text_rect(&self, el: ElId) -> Option<Rect>;
    /// The rows the element's rendered text occupies: one rect per line box,
    /// top to bottom. `None` when this DOM cannot say where the lines are.
    ///
    /// This is how a rule reads a line rather than the box that holds it, and
    /// a line here is the whole line the reader sees. `getClientRects()` on a
    /// text node gives a rect per line box, but a line box is routinely split
    /// across several text nodes — an inline `<strong>` in the middle of a
    /// sentence, a framework marker, an HTML comment — so the rects are
    /// collected over the element's whole rendered text (descendants
    /// included, which is the text `text_content` counts) and the ones that
    /// share a row are merged back into the one line they came from. Without
    /// that merge each fragment is a "line" and one wrapped sentence is
    /// charged as several.
    ///
    /// `None` is the honest answer from a DOM that only kept the union of
    /// those rects (a page snapshot captured before the lines were recorded).
    /// A caller stands down there; it never divides a union by a line height
    /// and calls the pieces lines, because the union of a long first line and
    /// a short tail says nothing about either.
    fn text_line_rects(&self, _el: ElId) -> Option<Vec<Rect>> {
        None
    }
}

/// The rects of one element's rendered text, merged into the lines they
/// rendered on.
///
/// Two rects are the same line when they share a row *and* run on from each
/// other. Sharing a row is a vertical band overlapping the band the row
/// started with by more than half the shorter height — that is what makes an
/// inline `<strong>`, a superscript and the text around them one line.
/// Running on is a horizontal gap no wider than the row's own line box: the
/// fragments of a wrapped line are contiguous, while two columns of text that
/// happen to sit on the same rows are separated by a gutter, and unioning
/// those would invent a page-wide line neither column ever rendered. An
/// inline image wider than the leading splits its line in two by the same
/// test, which understates a line rather than overstating it — the direction
/// this rule should err in.
///
/// Rects arrive in whatever order a DOM walked the text (an element's own
/// text and its descendants' are interleaved on the page but not in the
/// walk), so they are sorted top then left first and each rect joins the
/// newest row still level with it.
pub fn merge_text_rects_into_lines(rects: Vec<Rect>) -> Vec<Rect> {
    let mut rects: Vec<Rect> = rects
        .into_iter()
        .filter(|r| r.width > 0.0 && r.height > 0.0 && r.all_finite())
        .collect();
    rects.sort_by(|a, b| {
        a.top
            .partial_cmp(&b.top)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(a.left.partial_cmp(&b.left).unwrap_or(std::cmp::Ordering::Equal))
    });
    let mut lines: Vec<Rect> = Vec::new();
    // The band of the rect each row started with. Membership is tested
    // against that rather than against the row as it grows, so an
    // inline-block taller than the leading does not swallow the line beneath.
    let mut bands: Vec<(f64, f64)> = Vec::new();
    for r in rects {
        let mut joined = false;
        for i in (0..lines.len()).rev() {
            let (band_top, band_bottom) = bands[i];
            // Sorted by top: once a row sits entirely above this rect, every
            // row before it does too.
            if band_bottom <= r.top {
                break;
            }
            let overlap = band_bottom.min(r.bottom) - band_top.max(r.top);
            let shorter = (band_bottom - band_top).min(r.height);
            if shorter <= 0.0 || overlap <= shorter / 2.0 {
                continue;
            }
            let line = lines[i];
            let gap = (r.left - line.right).max(line.left - r.right);
            if gap > band_bottom - band_top {
                continue;
            }
            let left = line.left.min(r.left);
            let top = line.top.min(r.top);
            let right = line.right.max(r.right);
            let bottom = line.bottom.max(r.bottom);
            lines[i] = Rect::from_xywh(left, top, right - left, bottom - top);
            joined = true;
            break;
        }
        if !joined {
            bands.push((r.top, r.bottom));
            lines.push(r);
        }
    }
    lines
}

// ── shared helpers over the trait ─────────────────────────────────────────

/// `el.tagName.toLowerCase()`.
pub fn tag_lower(dom: &dyn Dom, el: ElId) -> String {
    crate::js::to_lower_case(&dom.tag_name(el))
}

/// `el.getAttribute('class') || ''`.
pub fn class_attr(dom: &dyn Dom, el: ElId) -> String {
    dom.attr(el, "class").unwrap_or_default()
}

/// `String(el.getAttribute?.('class') || el.className || '')`.
pub fn class_attr_or_prop(dom: &dyn Dom, el: ElId) -> String {
    match dom.attr(el, "class") {
        Some(c) if !c.is_empty() => c,
        _ => match dom.class_name_prop(el) {
            Some(c) if !c.is_empty() => c,
            // JS `String(el.className)` on an SVGAnimatedString gives
            // "[object SVGAnimatedString]"; the JS callers only regex-test the
            // result and none of the patterns match that string, so "" is
            // observably identical.
            _ => String::new(),
        },
    }
}

/// `typeof el.id === 'string' ? el.id : (el.getAttribute('id') || '')`.
pub fn safe_id(dom: &dyn Dom, el: ElId) -> String {
    match dom.id_prop(el) {
        Some(id) => id,
        None => dom.attr(el, "id").unwrap_or_default(),
    }
}

/// `[...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('')`.
pub fn direct_text(dom: &dyn Dom, el: ElId) -> String {
    dom.direct_text_nodes(el).concat()
}

/// `[...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > min)`.
pub fn has_direct_text_longer_than(dom: &dyn Dom, el: ElId, min: usize) -> bool {
    dom.direct_text_nodes(el)
        .iter()
        .any(|t| crate::js_ext_b::utf16_len(crate::js::trim(t)) > min)
}

/// `getComputedStyle(el).x || ''` — the trait already returns "" for
/// null/undefined, so this is just [`Dom::style`]; kept for readability at
/// call sites that mirror `style.x || ''`.
pub fn style_or_empty(dom: &dyn Dom, el: ElId, prop: &str) -> String {
    dom.style(el, prop)
}

/// JS `parseFloat(style.x) || 0`.
pub fn style_px(dom: &dyn Dom, el: ElId, prop: &str) -> f64 {
    let n = crate::js::parse_float(&dom.style(el, prop));
    if crate::js_ext_a::num_truthy(n) {
        n
    } else {
        0.0
    }
}

/// JS `parseFloat(s) || 0`.
pub fn pf0(s: &str) -> f64 {
    let n = crate::js::parse_float(s);
    if crate::js_ext_a::num_truthy(n) {
        n
    } else {
        0.0
    }
}

/// `el.closest(sel)` where the JS wrapped the call in `try/catch` and treated
/// a throw as "no match".
pub fn closest_or_none(dom: &dyn Dom, el: ElId, selector: &str) -> Option<ElId> {
    dom.closest(el, selector).unwrap_or(None)
}

/// `el.matches(sel)` with a throw read as false.
pub fn matches_or_false(dom: &dyn Dom, el: ElId, selector: &str) -> bool {
    dom.matches(el, selector).unwrap_or(false)
}

/// Iterate `el, el.parentElement, ...` while the node is an element.
pub fn ancestors_inclusive(dom: &dyn Dom, el: ElId) -> Vec<ElId> {
    let mut out = Vec::new();
    let mut cur = Some(el);
    while let Some(c) = cur {
        out.push(c);
        cur = dom.parent(c);
    }
    out
}

/// A live element's computed style as a [`crate::css::measures::StyleMap`],
/// so the browser adapters can hand `getComputedStyle(el)` to the pure
/// helpers that take a style map (`isScreenReaderOnlyTextStyle`,
/// `positionedStyleImpliesEscape`, `isRepeatedTextContainer`, ...). Real
/// browsers define every property, so `prop` is always `Some`.
pub struct ElStyle<'a> {
    pub dom: &'a dyn Dom,
    pub el: ElId,
}

impl crate::css::measures::StyleMap for ElStyle<'_> {
    fn prop(&self, name: &str) -> Option<String> {
        Some(self.dom.style(self.el, name))
    }
}
