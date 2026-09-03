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
