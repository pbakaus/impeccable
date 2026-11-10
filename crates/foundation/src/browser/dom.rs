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

/// One child of an element as [`Dom::child_nodes`] lists it: an element, or
/// a text node's data.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DomChild {
    Element(ElId),
    Text(String),
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
    /// The selector of each frame [`Dom::keyframes`] returns for `name`, in
    /// the same order (`"0%, 35%"`, `"to"`): which offsets each frame sets.
    /// `None` where the probe did not record them (a recording made before
    /// it did, the in-page probe), and a caller then knows no offsets.
    fn keyframe_keys(&self, _name: &str) -> Option<Vec<String>> {
        None
    }
    /// `document.documentElement.cloneNode(true)` with every
    /// `[id^="impeccable-live-"]` node removed, serialized as `outerHTML`.
    fn document_html_for_patterns(&self) -> String;
    /// The CSS of every readable linked stylesheet whose rules resolve to a
    /// live element, flattened out of its grouping rules (#709). Empty when
    /// the probe cannot read the CSSOM.
    fn linked_stylesheet_text(&self) -> String {
        String::new()
    }
    /// Whether the browser applies `text-wrap: pretty`: `CSS.supports` on
    /// the shorthand or on the `text-wrap-style` longhand (Chrome before 130
    /// knew only the former). Firefox parses no `pretty`, drops the
    /// declaration before the CSSOM sees it and computes `auto`, so a rule
    /// that read the computed style alone could not tell "never set" from
    /// "set and dropped" (issue #1136). `None` where the probe did not ask
    /// (a capture older than the flag, a page without `CSS.supports`); a
    /// caller then trusts the computed style.
    fn text_wrap_pretty_supported(&self) -> Option<bool> {
        None
    }

    /// The faces `document.fonts` holds, as `(family, status)`: the family
    /// with its quotes removed, the status one of `unloaded`, `loading`,
    /// `loaded` or `error`. It lists `@font-face` rules and faces a script
    /// added, never a face installed on the system. `None` where the
    /// capture did not ask (a recording older than the field), and a caller
    /// then knows nothing about which faces loaded.
    fn document_font_faces(&self) -> Option<Vec<(String, String)>> {
        None
    }

    /// For each face that heads the font stack of an element holding text,
    /// whether the browser draws text in it at all, from a face installed on
    /// the system or one the page loaded: `(face, drawn)`, measured on a
    /// canvas at capture. `None` where the capture did not measure.
    fn rendered_faces(&self) -> Option<Vec<(String, bool)>> {
        None
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
    /// `el.firstElementChild`. The default collects every child; an
    /// implementation that can read the first one alone should, since a
    /// bounded walk (first child, then next sibling) relies on it.
    fn first_element_child(&self, el: ElId) -> Option<ElId> {
        self.children(el).first().copied()
    }
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
    /// `el.childNodes` reduced to its element children and its text nodes
    /// (`nodeType === 3`), in document order. Comments and other node types
    /// are left out.
    ///
    /// This is the one view that says where an element's own text sits among
    /// its children, which a caller needs to rebuild the rendered text node
    /// by node. The default lists the direct text nodes and then the element
    /// children, which is the right order only when the element has one kind
    /// or the other; every DOM in this workspace overrides it.
    fn child_nodes(&self, el: ElId) -> Vec<DomChild> {
        let mut out: Vec<DomChild> = self.direct_text_nodes(el).into_iter().map(DomChild::Text).collect();
        out.extend(self.children(el).into_iter().map(DomChild::Element));
        out
    }
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
    /// `el.scrollHeight`; NaN when the probe cannot answer it (a snapshot
    /// recorded before the capture measured it).
    fn scroll_height(&self, _el: ElId) -> f64 {
        f64::NAN
    }
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

    /// Where the last two words of the element's rendered text sit: the
    /// rect of the word before the last, then the last word's, each the last
    /// of the word's client rects (a word hyphenated across two lines ends on
    /// the lower one). The text is the one `text_line_rects` measures, split
    /// on white space with soft hyphens and zero-width spaces dropped.
    ///
    /// `None` from a DOM that did not measure them: a snapshot records them
    /// only for the prose blocks `straggler` reads, and only from a capture
    /// that knew to. A caller stands down there rather than guess where the
    /// words broke.
    fn last_word_rects(&self, _el: ElId) -> Option<[Rect; 2]> {
        None
    }

    /// The CSS properties (`opacity`, `filter`, hyphenated as the CSSOM
    /// spells them) of every animation and transition running on the element
    /// itself at capture: `document.getAnimations()` entries whose effect
    /// targets it (not a pseudo-element) and whose `playState` is `running`
    /// or that are still pending. An empty list is a capture that looked and
    /// found none; `None` is a probe that could not look (a snapshot recorded
    /// before the capture read animations, a page with no Web Animations
    /// API).
    fn running_animation_properties(&self, _el: ElId) -> Option<Vec<String>> {
        None
    }

    /// Whether a box that is hidden with the page scrolled to the top shows
    /// once the page is scrolled to it: a reveal that follows the scroll
    /// position (a scrubbed timeline, a reveal that hides again when its
    /// section leaves the viewport). `None` is a probe that has not looked: a
    /// recording made before the probe existed, a DOM with no page behind it.
    /// A caller treats `None` as the base answer, hidden.
    fn shown_when_scrolled_to(&self, _el: ElId) -> Option<bool> {
        None
    }

    // ── image load state ──────────────────────────────────────────────
    //
    // What tells a loaded `<img>` from one whose source failed, read
    // together: no one of them is a load status on its own. All three
    // answer `None` for anything that is not an `HTMLImageElement` (an
    // `input type=image` and an SVG `<image>` have no `naturalWidth` or
    // `complete` on their interfaces) and from a probe that cannot say. The
    // `loading` attribute is [`Dom::attr`]`(el, "loading")`.
    /// `(img.naturalWidth, img.naturalHeight)`: the image's own size in CSS
    /// pixels, known as soon as the browser has read the image's dimensions,
    /// which can be before the fetch has finished. `(0, 0)` while it has
    /// none: not requested yet, nothing received yet, or failed. The size
    /// alone does not say which; [`Dom::image_complete`] says whether the
    /// browser is still waiting.
    fn image_natural_size(&self, _el: ElId) -> Option<(f64, f64)> {
        None
    }
    /// `img.complete`: the browser is not waiting on a fetch for this image.
    /// It reports that the request is over, not that an image came of it:
    /// true once the image is fully available, true once the fetch failed,
    /// and true with no source at all; false while a fetch is pending, which
    /// includes a `loading=lazy` image the browser has not requested yet.
    /// A failed image is the one that is complete with a selected source
    /// ([`Dom::image_current_src`]) and a natural size of 0. `None` where the
    /// probe did not read it (a snapshot recorded before the capture did).
    fn image_complete(&self, _el: ElId) -> Option<bool> {
        None
    }
    /// `img.currentSrc`: the absolute URL the browser selected from `src`,
    /// `srcset` and the `<source>`s of an enclosing `<picture>`. Empty when
    /// it has selected none.
    fn image_current_src(&self, _el: ElId) -> Option<String> {
        None
    }
    /// `video.readyState` (0 to 4) for an HTML `<video>`: 2
    /// (`HAVE_CURRENT_DATA`) or more means a frame is decoded, so the element
    /// paints a picture (its poster, or that frame where the poster did not
    /// load). Nothing tells whether a `poster` image loaded, so below 2 a
    /// video may paint nothing at all. `None` for anything that is not a
    /// `<video>` and where the probe did not read it.
    fn video_ready_state(&self, _el: ElId) -> Option<u8> {
        None
    }

    // ── the flat tree ─────────────────────────────────────────────────
    /// The box an element paints inside once shadow trees are composed: the
    /// slot a light-DOM child is assigned to, else its parent, else the host
    /// of the shadow tree whose top-level node it is. A fill drawn by a
    /// component's shadow tree sits between a slotted heading and the host,
    /// and only this walk passes through it. The default is `parent`, which
    /// is the light tree: a probe that cannot see shadow trees.
    fn flat_parent(&self, el: ElId) -> Option<ElId> {
        self.parent(el)
    }
    /// The slot this element's direct text is assigned to, where the element
    /// is a shadow host whose own text is slotted into its shadow tree. That
    /// text inherits its colour and font from the slot, not from the host.
    fn text_slot(&self, _el: ElId) -> Option<ElId> {
        None
    }
    /// The top-level nodes of the open shadow tree `el` hosts, in order:
    /// the elements whose [`Dom::flat_parent`] is `el` without being its
    /// children, where the probe composes the flat tree. The live page's
    /// `JsDom` lists them without composing it. Empty for an element that
    /// hosts no shadow tree, and from a probe that cannot see shadow trees
    /// (the default).
    fn shadow_children(&self, _el: ElId) -> Vec<ElId> {
        Vec::new()
    }
    /// Whether the probe reads open shadow trees ([`Dom::flat_parent`]), so
    /// that an element with no assigned slot is not slotted anywhere. A
    /// snapshot recorded before shadow trees were captured answers `false`,
    /// and so does the default, which goes with the default `flat_parent`: a
    /// probe that walks the light tree alone (the live page's `JsDom`) never
    /// sees a fill a component paints in its shadow tree.
    fn shadow_trees_recorded(&self) -> bool {
        false
    }
}

/// `a` is `b` or a flat-tree ancestor of it ([`Dom::flat_parent`]).
pub fn flat_contains(dom: &dyn Dom, a: ElId, b: ElId) -> bool {
    const MAX_DEPTH: usize = 512;
    let mut cur = Some(b);
    for _ in 0..MAX_DEPTH {
        let Some(c) = cur else { return false };
        if c == a {
            return true;
        }
        cur = dom.flat_parent(c);
    }
    false
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

/// Elements whose text is in `textContent` and never on a line.
pub const UNRENDERED_TEXT_TAGS: [&str; 4] = ["style", "script", "noscript", "template"];

/// A descendant whose text is on no line: a `<style>`, `<script>`,
/// `<noscript>` or `<template>`, a `display: none` box, and a
/// `content-visibility: hidden` box (the box lays out, its contents do not).
/// `content-visibility` applies only where layout containment does, so a
/// plain inline box, `display: contents`, and internal table and ruby boxes
/// render their text whatever the property says
/// ([`content_visibility_applies`]).
///
/// One definition for both sides of `line-length`: the characters it counts
/// and the line rects it divides them among skip the same subtrees, so the
/// two cannot disagree about which text rendered. A DOM that does not
/// record `contentVisibility` answers `""` and the subtree is kept.
pub fn renders_no_text(dom: &dyn Dom, el: ElId) -> bool {
    UNRENDERED_TEXT_TAGS.contains(&tag_lower(dom, el).as_str())
        || dom.style(el, "display") == "none"
        || (crate::js::to_lower_case(&dom.style(el, "contentVisibility")) == "hidden"
            && content_visibility_applies(&dom.style(el, "display")))
}

/// Displays whose box takes layout containment, which is the condition for
/// `content-visibility` to have any effect (CSS Containment 2: containment
/// does not apply to non-atomic inline boxes, internal table boxes other
/// than table cells, or internal ruby boxes; `display: contents` makes no
/// box at all). An unknown display (`""`) counts as applying.
pub fn content_visibility_applies(display: &str) -> bool {
    !matches!(
        crate::js::to_lower_case(display).trim(),
        "inline"
            | "inline flow"
            | "contents"
            | "table-row"
            | "table-row-group"
            | "table-header-group"
            | "table-footer-group"
            | "table-column"
            | "table-column-group"
            | "ruby"
            | "ruby-base"
            | "ruby-text"
            | "ruby-base-container"
            | "ruby-text-container"
    )
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

#[cfg(test)]
mod tests {
    use super::*;

    /// A probe that overrides nothing it need not, as the live page's
    /// `JsDom` does.
    struct LightTreeOnly;

    #[rustfmt::skip]
    impl Dom for LightTreeOnly {
    fn document_element(&self) -> Option<ElId> { None }
        fn body(&self) -> Option<ElId> { None }
        fn query_all(&self, _: Option<ElId>, _: &str) -> Result<Vec<ElId>, SelectorError> { Ok(Vec::new()) }
        fn query_one(&self, _: Option<ElId>, _: &str) -> Result<Option<ElId>, SelectorError> { Ok(None) }
        fn inner_width(&self) -> f64 { 0.0 }
        fn inner_height(&self) -> f64 { 0.0 }
        fn scroll_x(&self) -> f64 { 0.0 }
        fn scroll_y(&self) -> f64 { 0.0 }
        fn hostname(&self) -> String { String::new() }
        fn element_from_point(&self, _: f64, _: f64) -> Option<ElId> { None }
        fn elements_from_point(&self, _: f64, _: f64) -> Vec<ElId> { Vec::new() }
        fn css_escape(&self, s: &str) -> String { s.to_string() }
        fn keyframes(&self, _: &str) -> Option<Vec<KeyframeFrame>> { None }
        fn document_html_for_patterns(&self) -> String { String::new() }
        fn tag_name(&self, _: ElId) -> String { String::new() }
        fn namespace_uri(&self, _: ElId) -> String { String::new() }
        fn parent(&self, _: ElId) -> Option<ElId> { None }
        fn children(&self, _: ElId) -> Vec<ElId> { Vec::new() }
        fn previous_element_sibling(&self, _: ElId) -> Option<ElId> { None }
        fn next_element_sibling(&self, _: ElId) -> Option<ElId> { None }
        fn contains(&self, _: ElId, _: ElId) -> bool { false }
        fn matches(&self, _: ElId, _: &str) -> Result<bool, SelectorError> { Ok(false) }
        fn closest(&self, _: ElId, _: &str) -> Result<Option<ElId>, SelectorError> { Ok(None) }
        fn attr(&self, _: ElId, _: &str) -> Option<String> { None }
        fn id_prop(&self, _: ElId) -> Option<String> { None }
        fn class_name_prop(&self, _: ElId) -> Option<String> { None }
        fn text_content(&self, _: ElId) -> String { String::new() }
        fn inner_text(&self, _: ElId) -> Option<String> { None }
        fn direct_text_nodes(&self, _: ElId) -> Vec<String> { Vec::new() }
        fn is_content_editable(&self, _: ElId) -> bool { false }
        fn hidden_prop(&self, _: ElId) -> bool { false }
        fn style(&self, _: ElId, _: &str) -> String { String::new() }
        fn pseudo_style(&self, _: ElId, _: &str, _: &str) -> Option<String> { None }
        fn rect(&self, _: ElId) -> Rect { Rect::default() }
        fn client_width(&self, _: ElId) -> f64 { 0.0 }
        fn client_height(&self, _: ElId) -> f64 { 0.0 }
        fn client_left(&self, _: ElId) -> f64 { 0.0 }
        fn scroll_width(&self, _: ElId) -> f64 { 0.0 }
        fn scroll_left(&self, _: ElId) -> f64 { 0.0 }
        fn offset_width(&self, _: ElId) -> f64 { 0.0 }
        fn offset_height(&self, _: ElId) -> f64 { 0.0 }
        fn check_visibility(&self, _: ElId) -> Option<bool> { None }
        fn direct_text_rect(&self, _: ElId) -> Option<Rect> { None }
    }

    /// The default `flat_parent` walks the light tree, so the default must
    /// not claim shadow trees were read: a probe that cannot see them keeps
    /// the custom-element fallback for a surface hidden in one.
    #[test]
    fn a_light_tree_probe_records_no_shadow_trees() {
        assert!(!LightTreeOnly.shadow_trees_recorded());
        assert_eq!(LightTreeOnly.flat_parent(3), None);
    }

    /// A probe written before the image load state existed answers
    /// "unknown" for all of it, which a caller must not read as "failed".
    #[test]
    fn a_probe_without_image_state_answers_unknown() {
        assert_eq!(LightTreeOnly.image_natural_size(3), None);
        assert_eq!(LightTreeOnly.image_complete(3), None);
        assert_eq!(LightTreeOnly.image_current_src(3), None);
        assert_eq!(LightTreeOnly.video_ready_state(3), None);
    }
}
