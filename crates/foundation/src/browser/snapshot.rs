//! [`Dom`] over a serialized page snapshot.
//!
//! The in-page bundle measures the live DOM through the JS probe
//! (`10-probe.js` → `crates/wasm/src/js_dom.rs`). Where WebAssembly cannot
//! run next to the page — the Chrome extension on a strict-CSP site — the
//! measurement happens in the content-script world (`15-snapshot.js`,
//! measurement only), travels as JSON to wherever the wasm core does run
//! (the extension's offscreen document), and this type answers every
//! [`Dom`] question from it. Same rules, same core, one more probe.
//!
//! What the snapshot carries is exactly what the probe surface reads: the
//! element tree in document order (child nodes with their text, so
//! `textContent` and the direct text nodes come out byte-equal), attributes,
//! the computed-style properties the rules read (`STYLE_PROPS`, interned
//! values), `::before` / `::after` styles where `content` is set, bounding
//! rects, the client/scroll/offset metrics, `checkVisibility`, direct-text
//! rects, viewport and scroll, hostname, quirks mode, `body.innerText`, the
//! `@keyframes` rules, the document HTML for the regex pass, and the media
//! intrinsics the visual-contrast path needs.
//!
//! Two things a snapshot cannot answer up front:
//!
//! - **hit tests** (`elementFromPoint` / `elementsFromPoint`): the points
//!   are decided by the rules. A miss records the point in
//!   [`SnapshotDom::take_needs`] and answers "nothing there"; the caller
//!   answers the points from the live page ([`SnapshotDom::add_facts`]) and
//!   re-runs. Runs are deterministic, so the fixpoint is reached in a round
//!   or two (the text-occlusion grid asks all its points in one pass).
//! - **selectors**: `matches` / `closest` / `querySelector*` run through
//!   [`super::selector`] (the `selectors` crate over the snapshot), which
//!   observes Chrome's parse and match surface.
//!
//! Unknown computed-style properties (a rule reading a property the capture
//! did not record) answer `""` and are counted in
//! [`SnapshotDom::unknown_style_props`], so a parity run can prove the
//! property list complete.

use super::dom::{Dom, ElId, KeyframeFrame, Rect, SelectorError};

use super::selector::Selector;

use serde::{Deserialize, Serialize};

use std::cell::RefCell;

use std::collections::{HashMap, HashSet};

pub const NS_XHTML: &str = "http://www.w3.org/1999/xhtml";

pub const NS_SVG: &str = "http://www.w3.org/2000/svg";

pub const NS_MATHML: &str = "http://www.w3.org/1998/Math/MathML";

/// The computed-style properties the browser rules read (`getComputedStyle`
/// spellings as the rules pass them). The capture reads exactly this list
/// per element; the order is the column order of `SnapNode::style`. Keep in
/// sync with `STYLE_PROPS` in `browser-bundle/15-snapshot.js` (the build
/// checks the two lists agree).
pub const STYLE_PROPS: &[&str] = &[
    "animationIterationCount",
    "animationName",
    "animationTimingFunction",
    "backdropFilter",
    "background",
    "backgroundClip",
    "backgroundColor",
    "backgroundImage",
    "backgroundPosition",
    "backgroundSize",
    "blockSize",
    "borderBottomColor",
    "borderBottomWidth",
    "borderBottomStyle",
    "borderLeftColor",
    "borderLeftWidth",
    "borderLeftStyle",
    "borderRadius",
    "borderRightColor",
    "borderRightWidth",
    "borderRightStyle",
    "borderTopColor",
    "borderTopWidth",
    "borderTopStyle",
    "bottom",
    "boxShadow",
    "clip",
    "clip-path",
    "clipPath",
    "color",
    "content",
    "contentVisibility",
    "cssFloat",
    "display",
    "filter",
    "float",
    "fontFamily",
    "fontSize",
    "fontStyle",
    "fontVariant",
    "fontVariantCaps",
    "fontWeight",
    "height",
    "hyphens",
    "inlineSize",
    "inset",
    "insetBlock",
    "insetBlockEnd",
    "insetBlockStart",
    "insetInline",
    "insetInlineEnd",
    "insetInlineStart",
    "left",
    "letterSpacing",
    "lineHeight",
    "marginBottom",
    "marginLeft",
    "marginRight",
    "marginTop",
    "maxHeight",
    "maxWidth",
    "minHeight",
    "minWidth",
    "mixBlendMode",
    "objectFit",
    "objectPosition",
    "opacity",
    "outline",
    "outlineColor",
    "outlineOffset",
    "outlineStyle",
    "outlineWidth",
    "overflow",
    "overflowX",
    "overflowY",
    "paddingBottom",
    "paddingLeft",
    "paddingRight",
    "paddingTop",
    "pointerEvents",
    "position",
    "right",
    "textAlign",
    "textDecoration",
    "textDecorationLine",
    "textIndent",
    "textOverflow",
    "textShadow",
    "textTransform",
    "top",
    "transform",
    "transitionDuration",
    "transitionProperty",
    "transitionTimingFunction",
    "verticalAlign",
    "visibility",
    "webkitBackgroundClip",
    "webkitClipPath",
    "webkitHyphens",
    "webkitTextFillColor",
    "whiteSpace",
    "width",
    "wordBreak",
    "zIndex",
];

/// The `::before` / `::after` properties the rules read, recorded for
/// pseudo-elements whose `content` is not `none` / empty (every rule gates
/// on that first). Keep in sync with `PSEUDO_PROPS` in `15-snapshot.js`.
pub const PSEUDO_PROPS: &[&str] = &[
    "content",
    "position",
    "opacity",
    "display",
    "width",
    "height",
    "top",
    "right",
    "bottom",
    "left",
    "backgroundColor",
    "backgroundImage",
    "background",
    "borderRadius",
    "transform",
    "visibility",
];

/// One child of an element: an element (by id) or a text node's data.
/// `CData` counts toward `textContent` but is not a `nodeType === 3` node.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(untagged)]
pub enum ChildNode {
    El(u32),
    Text(String),
    CData(Vec<String>),
}

/// Media intrinsics for `<img>` / `<video>` / `<canvas>` (visual contrast).
#[derive(Debug, Clone, Default, PartialEq, Deserialize, Serialize)]
pub struct MediaInfo {
    /// `naturalWidth` / `naturalHeight` (img).
    #[serde(default)]
    pub nw: f64,
    #[serde(default)]
    pub nh: f64,
    /// `videoWidth` / `videoHeight` (video).
    #[serde(default)]
    pub vw: f64,
    #[serde(default)]
    pub vh: f64,
    /// `width` / `height` IDL attributes.
    #[serde(default)]
    pub w: f64,
    #[serde(default)]
    pub h: f64,
    /// `currentSrc`, `src`.
    #[serde(default)]
    pub cur: String,
    #[serde(default)]
    pub src: String,
}

/// One element as captured. Field names are one letter on the wire to keep
/// multi-thousand-element snapshots small.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct SnapNode {
    /// `tagName`.
    #[serde(rename = "t")]
    pub tag: String,
    /// Namespace: 0 xhtml, 1 svg, 2 mathml, 3 other (`nsUri` then set).
    #[serde(rename = "n", default)]
    pub ns: u8,
    #[serde(rename = "nu", default)]
    pub ns_uri: Option<String>,
    #[serde(rename = "p", default)]
    pub parent: Option<u32>,
    /// `childNodes` in order (elements by id, text by data).
    #[serde(rename = "c", default)]
    pub child_nodes: Vec<ChildNode>,
    /// Element children in order (derived from `child_nodes` on load).
    #[serde(skip)]
    pub children: Vec<u32>,
    #[serde(skip)]
    pub index_in_parent: usize,
    /// `[name, value]` per attribute (`getAttributeNames` order).
    #[serde(rename = "a", default)]
    pub attrs: Vec<(String, String)>,
    /// Computed style: value index per `STYLE_PROPS` column.
    #[serde(rename = "s", default)]
    pub style: Vec<u32>,
    /// `::before` values per `PSEUDO_PROPS` when its `content` is set.
    #[serde(rename = "b", default)]
    pub before: Option<Vec<u32>>,
    #[serde(rename = "f", default)]
    pub after: Option<Vec<u32>>,
    /// `getBoundingClientRect` as `[x, y, width, height]`; `None` when the
    /// element has no such method.
    #[serde(rename = "r", default)]
    pub rect: Option<[f64; 4]>,
    /// `[clientWidth, clientHeight, clientLeft, scrollWidth, scrollLeft,
    /// offsetWidth, offsetHeight]` (`null` → NaN, as `undefined` crosses
    /// into a wasm f64).
    #[serde(rename = "m", default)]
    pub metrics: Vec<Option<f64>>,
    /// `checkVisibility`: 1 / 0, `-1` when the method is missing.
    #[serde(rename = "v", default = "minus_one")]
    pub visibility: i8,
    /// `getDirectTextRect` as `[x, y, width, height]`.
    #[serde(rename = "d", default)]
    pub direct_text_rect: Option<[f64; 4]>,
    #[serde(rename = "e", default)]
    pub content_editable: bool,
    #[serde(rename = "h", default)]
    pub hidden: bool,
    /// `typeof el.id !== 'string'` (a form control named `id`).
    #[serde(rename = "i", default)]
    pub id_shadowed: bool,
    /// `typeof el.className !== 'string'` (SVGAnimatedString).
    #[serde(rename = "k", default)]
    pub class_not_string: bool,
    /// Pseudo-class states the element matched at capture time.
    #[serde(rename = "st", default)]
    pub states: Vec<String>,
    #[serde(rename = "md", default)]
    pub media: Option<MediaInfo>,
}

fn minus_one() -> i8 {
    -1
}

/// A recorded hit test: `elementFromPoint` (`top`) and `elementsFromPoint`
/// (`stack`) at `(x, y)`.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct HitTest {
    pub x: f64,
    pub y: f64,
    #[serde(default)]
    pub top: u32,
    #[serde(default)]
    pub stack: Vec<u32>,
}

/// Facts a run asked for and the page must supply.
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq)]
pub struct Needs {
    /// `[x, y]` points to hit-test.
    #[serde(default, rename = "hitTests")]
    pub hit_tests: Vec<[f64; 2]>,
}

impl Needs {
    pub fn is_empty(&self) -> bool {
        self.hit_tests.is_empty()
    }
}

/// Facts supplied in answer to [`Needs`] (also accepted inline in the
/// snapshot as `hits`).
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct Facts {
    #[serde(default)]
    pub hits: Vec<HitTest>,
}

/// The serialized page.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct Snapshot {
    #[serde(default)]
    pub v: u32,
    #[serde(default)]
    pub hostname: String,
    /// `document.compatMode === 'BackCompat'`.
    #[serde(default)]
    pub quirks: bool,
    #[serde(rename = "innerWidth", default)]
    pub inner_width: f64,
    #[serde(rename = "innerHeight", default)]
    pub inner_height: f64,
    #[serde(rename = "scrollX", default)]
    pub scroll_x: f64,
    #[serde(rename = "scrollY", default)]
    pub scroll_y: f64,
    /// `document_html_for_patterns`.
    #[serde(default)]
    pub html: String,
    /// `[name, frames]` in stylesheet order (first rule per name wins).
    #[serde(default)]
    pub keyframes: Vec<(String, Vec<Vec<(String, String)>>)>,
    /// The property columns of `SnapNode::style` (normally `STYLE_PROPS`;
    /// carried so an older capture stays readable).
    #[serde(rename = "styleProps", default)]
    pub style_props: Vec<String>,
    #[serde(rename = "pseudoProps", default)]
    pub pseudo_props: Vec<String>,
    /// Interned style values.
    #[serde(default)]
    pub strings: Vec<String>,
    /// Elements in document order; element id = index + 1.
    #[serde(default)]
    pub els: Vec<SnapNode>,
    #[serde(rename = "documentElement", default)]
    pub document_element: Option<u32>,
    #[serde(default)]
    pub body: Option<u32>,
    #[serde(rename = "bodyInnerText", default)]
    pub body_inner_text: Option<String>,
    #[serde(default)]
    pub hits: Vec<HitTest>,
    /// Derived on load: column index per style property name.
    #[serde(skip)]
    style_index: HashMap<String, usize>,
    #[serde(skip)]
    pseudo_index: HashMap<String, usize>,
}

impl Snapshot {
    /// Parse and index a snapshot.
    pub fn from_json(json: &str) -> Result<Snapshot, serde_json::Error> {
        let mut s: Snapshot = serde_json::from_str(json)?;
        s.finish();
        Ok(s)
    }

    /// Derive the indexes (children lists, sibling positions, column maps).
    pub fn finish(&mut self) {
        if self.style_props.is_empty() {
            self.style_props = STYLE_PROPS.iter().map(|s| s.to_string()).collect();
        }
        if self.pseudo_props.is_empty() {
            self.pseudo_props = PSEUDO_PROPS.iter().map(|s| s.to_string()).collect();
        }
        self.style_index = self
            .style_props
            .iter()
            .enumerate()
            .map(|(i, p)| (p.clone(), i))
            .collect();
        self.pseudo_index = self
            .pseudo_props
            .iter()
            .enumerate()
            .map(|(i, p)| (p.clone(), i))
            .collect();
        for i in 0..self.els.len() {
            let kids: Vec<u32> = self.els[i]
                .child_nodes
                .iter()
                .filter_map(|n| match n {
                    ChildNode::El(id) => Some(*id),
                    _ => None,
                })
                .collect();
            for (pos, kid) in kids.iter().enumerate() {
                if let Some(k) = self.els.get_mut((*kid as usize).wrapping_sub(1)) {
                    k.index_in_parent = pos;
                    k.parent = Some(i as u32 + 1);
                }
            }
            self.els[i].children = kids;
        }
    }

    #[inline]
    pub fn node(&self, id: u32) -> &SnapNode {
        &self.els[(id as usize) - 1]
    }
    pub fn get(&self, id: u32) -> Option<&SnapNode> {
        if id == 0 {
            None
        } else {
            self.els.get(id as usize - 1)
        }
    }
    pub fn len(&self) -> usize {
        self.els.len()
    }
    pub fn is_empty(&self) -> bool {
        self.els.is_empty()
    }
    pub fn ns_uri(&self, id: u32) -> &str {
        let n = self.node(id);
        match n.ns {
            0 => NS_XHTML,
            1 => NS_SVG,
            2 => NS_MATHML,
            _ => n.ns_uri.as_deref().unwrap_or(""),
        }
    }
    pub fn attr(&self, id: u32, name: &str) -> Option<String> {
        self.node(id)
            .attrs
            .iter()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.clone())
    }
    pub fn previous_element_sibling(&self, id: u32) -> Option<u32> {
        let n = self.node(id);
        let p = self.node(n.parent?);
        if n.index_in_parent == 0 {
            None
        } else {
            p.children.get(n.index_in_parent - 1).copied()
        }
    }
    pub fn next_element_sibling(&self, id: u32) -> Option<u32> {
        let n = self.node(id);
        let p = self.node(n.parent?);
        p.children.get(n.index_in_parent + 1).copied()
    }
    /// The interned style value for `prop`, `None` when the capture did not
    /// record that property.
    pub fn style_value(&self, id: u32, prop: &str) -> Option<&str> {
        let col = *self.style_index.get(prop)?;
        let idx = *self.node(id).style.get(col)? as usize;
        Some(self.strings.get(idx).map(|s| s.as_str()).unwrap_or(""))
    }
    /// Descendant text in document order (`textContent`).
    fn text_content_into(&self, id: u32, out: &mut String) {
        for n in &self.node(id).child_nodes {
            match n {
                ChildNode::Text(t) => out.push_str(t),
                ChildNode::CData(v) => {
                    for t in v {
                        out.push_str(t)
                    }
                }
                ChildNode::El(c) => self.text_content_into(*c, out),
            }
        }
    }
    /// Preorder document walk from `root` (exclusive) — the order
    /// `querySelectorAll` returns.
    fn descendants(&self, root: Option<u32>, out: &mut Vec<u32>) {
        match root {
            None => {
                if let Some(r) = self.document_element {
                    out.push(r);
                    self.descendants(Some(r), out);
                }
            }
            Some(r) => {
                for c in &self.node(r).children {
                    out.push(*c);
                    self.descendants(Some(*c), out);
                }
            }
        }
    }
}

fn rect4(v: &[f64; 4]) -> Rect {
    Rect::from_xywh(v[0], v[1], v[2], v[3])
}

/// [`Dom`] over a [`Snapshot`], with per-run memo tables, a fact table for
/// hit tests, and the record of what the run could not answer.
pub struct SnapshotDom {
    pub snap: Snapshot,
    hits: RefCell<HashMap<(u64, u64), (Option<ElId>, Vec<ElId>)>>,
    misses: RefCell<Vec<[f64; 2]>>,
    missed_keys: RefCell<HashSet<(u64, u64)>>,
    selectors: RefCell<HashMap<String, Option<Selector>>>,
    closest_cache: RefCell<HashMap<(ElId, String), Result<Option<ElId>, SelectorError>>>,
    text_cache: RefCell<HashMap<ElId, String>>,
    unknown_props: RefCell<Vec<String>>,
}

impl SnapshotDom {
    pub fn new(snap: Snapshot) -> SnapshotDom {
        let dom = SnapshotDom {
            snap,
            hits: RefCell::new(HashMap::new()),
            misses: RefCell::new(Vec::new()),
            missed_keys: RefCell::new(HashSet::new()),
            selectors: RefCell::new(HashMap::new()),
            closest_cache: RefCell::new(HashMap::new()),
            text_cache: RefCell::new(HashMap::new()),
            unknown_props: RefCell::new(Vec::new()),
        };
        let inline: Vec<HitTest> = dom.snap.hits.clone();
        dom.add_hits(&inline);
        dom
    }

    pub fn from_json(json: &str) -> Result<SnapshotDom, serde_json::Error> {
        Ok(SnapshotDom::new(Snapshot::from_json(json)?))
    }

    fn key(x: f64, y: f64) -> (u64, u64) {
        (x.to_bits(), y.to_bits())
    }

    fn add_hits(&self, hits: &[HitTest]) {
        let mut table = self.hits.borrow_mut();
        for h in hits {
            let top = if h.top == 0 { None } else { Some(h.top) };
            table.insert(Self::key(h.x, h.y), (top, h.stack.clone()));
        }
    }

    /// Supply facts for an earlier [`Self::take_needs`].
    pub fn add_facts(&self, facts: &Facts) {
        self.add_hits(&facts.hits);
        // Answers may change what a later run asks; forget the misses.
        self.misses.borrow_mut().clear();
        self.missed_keys.borrow_mut().clear();
    }

    /// The questions the runs so far could not answer (drained).
    pub fn take_needs(&self) -> Needs {
        let hit_tests = std::mem::take(&mut *self.misses.borrow_mut());
        self.missed_keys.borrow_mut().clear();
        Needs { hit_tests }
    }

    /// Whether anything is pending.
    pub fn has_needs(&self) -> bool {
        !self.misses.borrow().is_empty()
    }

    /// Computed-style properties a rule asked for that the capture did not
    /// record (distinct, in first-read order).
    pub fn unknown_style_props(&self) -> Vec<String> {
        self.unknown_props.borrow().clone()
    }

    /// Forget per-run memo tables (selectors, closest, text) but keep facts.
    pub fn reset_memo(&self) {
        self.closest_cache.borrow_mut().clear();
    }

    fn hit(&self, x: f64, y: f64) -> Option<(Option<ElId>, Vec<ElId>)> {
        let k = Self::key(x, y);
        if let Some(v) = self.hits.borrow().get(&k) {
            return Some(v.clone());
        }
        if self.missed_keys.borrow_mut().insert(k) {
            self.misses.borrow_mut().push([x, y]);
        }
        None
    }

    fn with_selector<R>(
        &self,
        selector: &str,
        f: impl FnOnce(&Selector) -> R,
    ) -> Result<R, SelectorError> {
        let mut cache = self.selectors.borrow_mut();
        let entry = cache
            .entry(selector.to_string())
            .or_insert_with(|| Selector::parse(selector).ok());
        match entry {
            Some(sel) => Ok(f(sel)),
            None => Err(SelectorError),
        }
    }

    fn valid(&self, el: ElId) -> bool {
        el != 0 && (el as usize) <= self.snap.els.len()
    }
}

impl Dom for SnapshotDom {
    fn document_element(&self) -> Option<ElId> {
        self.snap.document_element
    }
    fn body(&self) -> Option<ElId> {
        self.snap.body
    }
    fn query_all(&self, root: Option<ElId>, selector: &str) -> Result<Vec<ElId>, SelectorError> {
        let mut out = Vec::new();
        self.snap.descendants(root, &mut out);
        let scope = root;
        self.with_selector(selector, |sel| {
            out.into_iter()
                .filter(|el| sel.matches(&self.snap, *el, scope))
                .collect()
        })
    }
    fn query_one(&self, root: Option<ElId>, selector: &str) -> Result<Option<ElId>, SelectorError> {
        let mut out = Vec::new();
        self.snap.descendants(root, &mut out);
        let scope = root;
        self.with_selector(selector, |sel| {
            out.into_iter()
                .find(|el| sel.matches(&self.snap, *el, scope))
        })
    }
    fn inner_width(&self) -> f64 {
        self.snap.inner_width
    }
    fn inner_height(&self) -> f64 {
        self.snap.inner_height
    }
    fn scroll_x(&self) -> f64 {
        self.snap.scroll_x
    }
    fn scroll_y(&self) -> f64 {
        self.snap.scroll_y
    }
    fn hostname(&self) -> String {
        self.snap.hostname.clone()
    }
    fn element_from_point(&self, x: f64, y: f64) -> Option<ElId> {
        self.hit(x, y).and_then(|(top, _)| top)
    }
    fn elements_from_point(&self, x: f64, y: f64) -> Vec<ElId> {
        self.hit(x, y).map(|(_, stack)| stack).unwrap_or_default()
    }
    fn css_escape(&self, s: &str) -> String {
        css_escape(s)
    }
    fn keyframes(&self, name: &str) -> Option<Vec<KeyframeFrame>> {
        if name.is_empty() {
            return None;
        }
        self.snap
            .keyframes
            .iter()
            .find(|(n, _)| n == name)
            .map(|(_, frames)| {
                frames
                    .iter()
                    .map(|decls| KeyframeFrame {
                        decls: decls.clone(),
                    })
                    .collect()
            })
    }
    fn document_html_for_patterns(&self) -> String {
        self.snap.html.clone()
    }
    fn tag_name(&self, el: ElId) -> String {
        self.snap.node(el).tag.clone()
    }
    fn namespace_uri(&self, el: ElId) -> String {
        self.snap.ns_uri(el).to_string()
    }
    fn parent(&self, el: ElId) -> Option<ElId> {
        self.snap.node(el).parent
    }
    fn children(&self, el: ElId) -> Vec<ElId> {
        self.snap.node(el).children.clone()
    }
    fn previous_element_sibling(&self, el: ElId) -> Option<ElId> {
        self.snap.previous_element_sibling(el)
    }
    fn next_element_sibling(&self, el: ElId) -> Option<ElId> {
        self.snap.next_element_sibling(el)
    }
    fn contains(&self, a: ElId, b: ElId) -> bool {
        if !self.valid(a) || !self.valid(b) {
            return false;
        }
        let mut cur = Some(b);
        while let Some(c) = cur {
            if c == a {
                return true;
            }
            cur = self.snap.node(c).parent;
        }
        false
    }
    fn matches(&self, el: ElId, selector: &str) -> Result<bool, SelectorError> {
        self.with_selector(selector, |sel| sel.matches(&self.snap, el, None))
    }
    fn closest(&self, el: ElId, selector: &str) -> Result<Option<ElId>, SelectorError> {
        let key = (el, selector.to_string());
        if let Some(hit) = self.closest_cache.borrow().get(&key) {
            return *hit;
        }
        let out = self.with_selector(selector, |sel| {
            let mut cur = Some(el);
            while let Some(c) = cur {
                if sel.matches(&self.snap, c, None) {
                    return Some(c);
                }
                cur = self.snap.node(c).parent;
            }
            None
        });
        self.closest_cache.borrow_mut().insert(key, out);
        out
    }
    fn attr(&self, el: ElId, name: &str) -> Option<String> {
        // getAttribute lower-cases the name for HTML elements.
        let n = self.snap.node(el);
        if n.ns == 0 {
            let lower = name.to_ascii_lowercase();
            n.attrs
                .iter()
                .find(|(k, _)| *k == lower)
                .map(|(_, v)| v.clone())
        } else {
            n.attrs
                .iter()
                .find(|(k, _)| k == name)
                .map(|(_, v)| v.clone())
        }
    }
    fn id_prop(&self, el: ElId) -> Option<String> {
        if self.snap.node(el).id_shadowed {
            return None;
        }
        Some(self.attr(el, "id").unwrap_or_default())
    }
    fn class_name_prop(&self, el: ElId) -> Option<String> {
        if self.snap.node(el).class_not_string {
            return None;
        }
        Some(self.attr(el, "class").unwrap_or_default())
    }
    fn text_content(&self, el: ElId) -> String {
        if let Some(t) = self.text_cache.borrow().get(&el) {
            return t.clone();
        }
        let mut s = String::new();
        self.snap.text_content_into(el, &mut s);
        self.text_cache.borrow_mut().insert(el, s.clone());
        s
    }
    fn inner_text(&self, el: ElId) -> Option<String> {
        if Some(el) == self.snap.body {
            return self.snap.body_inner_text.clone().filter(|s| !s.is_empty());
        }
        None
    }
    fn direct_text_nodes(&self, el: ElId) -> Vec<String> {
        self.snap
            .node(el)
            .child_nodes
            .iter()
            .filter_map(|n| match n {
                ChildNode::Text(t) => Some(t.clone()),
                _ => None,
            })
            .collect()
    }
    fn is_content_editable(&self, el: ElId) -> bool {
        self.snap.node(el).content_editable
    }
    fn hidden_prop(&self, el: ElId) -> bool {
        self.snap.node(el).hidden
    }
    fn style(&self, el: ElId, prop: &str) -> String {
        match self.snap.style_value(el, prop) {
            Some(v) => v.to_string(),
            None => {
                let mut u = self.unknown_props.borrow_mut();
                if !u.iter().any(|p| p == prop) {
                    u.push(prop.to_string());
                }
                String::new()
            }
        }
    }
    fn pseudo_style(&self, el: ElId, pseudo: &str, prop: &str) -> Option<String> {
        let n = self.snap.node(el);
        let vals = match pseudo {
            "::before" | ":before" => n.before.as_ref(),
            "::after" | ":after" => n.after.as_ref(),
            _ => None,
        };
        match vals {
            None => {
                // Not recorded: the pseudo's `content` was none/empty (or the
                // pseudo is one no rule reads). Answer as a real browser
                // would for the gate every rule applies first.
                if prop == "content" {
                    Some("none".to_string())
                } else {
                    Some(String::new())
                }
            }
            Some(vals) => {
                let col = self.snap.pseudo_index.get(prop).copied();
                match col.and_then(|c| vals.get(c)) {
                    Some(idx) => Some(
                        self.snap
                            .strings
                            .get(*idx as usize)
                            .cloned()
                            .unwrap_or_default(),
                    ),
                    None => {
                        let mut u = self.unknown_props.borrow_mut();
                        let key = format!("{pseudo}{prop}");
                        if !u.iter().any(|p| *p == key) {
                            u.push(key);
                        }
                        Some(String::new())
                    }
                }
            }
        }
    }
    fn rect(&self, el: ElId) -> Rect {
        self.snap
            .node(el)
            .rect
            .as_ref()
            .map(rect4)
            .unwrap_or_default()
    }
    fn client_width(&self, el: ElId) -> f64 {
        metric(&self.snap.node(el).metrics, 0)
    }
    fn client_height(&self, el: ElId) -> f64 {
        metric(&self.snap.node(el).metrics, 1)
    }
    fn client_left(&self, el: ElId) -> f64 {
        metric(&self.snap.node(el).metrics, 2)
    }
    fn scroll_width(&self, el: ElId) -> f64 {
        metric(&self.snap.node(el).metrics, 3)
    }
    fn scroll_left(&self, el: ElId) -> f64 {
        metric(&self.snap.node(el).metrics, 4)
    }
    fn offset_width(&self, el: ElId) -> f64 {
        metric(&self.snap.node(el).metrics, 5)
    }
    fn offset_height(&self, el: ElId) -> f64 {
        metric(&self.snap.node(el).metrics, 6)
    }
    fn check_visibility(&self, el: ElId) -> Option<bool> {
        match self.snap.node(el).visibility {
            0 => Some(false),
            1 => Some(true),
            _ => None,
        }
    }
    fn direct_text_rect(&self, el: ElId) -> Option<Rect> {
        self.snap.node(el).direct_text_rect.as_ref().map(rect4)
    }
}

/// `undefined` read into a wasm f64 is NaN (`offsetWidth` on an SVG
/// element); a missing column reads the same way.
fn metric(m: &[Option<f64>], i: usize) -> f64 {
    match m.get(i) {
        Some(Some(v)) => *v,
        _ => f64::NAN,
    }
}

/// `CSS.escape(s)` (CSSOM serialize-an-identifier).
pub fn css_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 4);
    let chars: Vec<char> = s.chars().collect();
    for (i, &c) in chars.iter().enumerate() {
        let code = c as u32;
        if code == 0 {
            out.push('\u{FFFD}');
        } else if (0x1..=0x1F).contains(&code) || code == 0x7F {
            out.push_str(&format!("\\{:x} ", code));
        } else if i == 0 && c.is_ascii_digit() {
            out.push_str(&format!("\\{:x} ", code));
        } else if i == 1 && c.is_ascii_digit() && chars[0] == '-' {
            out.push_str(&format!("\\{:x} ", code));
        } else if i == 0 && c == '-' && chars.len() == 1 {
            out.push('\\');
            out.push(c);
        } else if code >= 0x80 || c == '-' || c == '_' || c.is_ascii_alphanumeric() {
            out.push(c);
        } else {
            out.push('\\');
            out.push(c);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snap(json: &str) -> SnapshotDom {
        SnapshotDom::from_json(json).expect("snapshot json")
    }

    const SMALL: &str = r#"{
      "v": 1, "hostname": "example.test", "innerWidth": 1280, "innerHeight": 800,
      "styleProps": ["display", "color"], "pseudoProps": ["content", "width"],
      "strings": ["block", "rgb(0, 0, 0)", "inline", "\"\"", "4px", "none"],
      "documentElement": 1, "body": 3,
      "els": [
        {"t":"HTML","c":[2,3],"a":[["lang","en"]],"s":[0,1],"r":[0,0,1280,800]},
        {"t":"HEAD","p":1,"c":[],"s":[5,1]},
        {"t":"BODY","p":1,"c":[4,"tail"],"a":[["class","home dark"]],"s":[0,1],"r":[0,0,1280,800]},
        {"t":"DIV","p":3,"c":["Hello ",5,6],"a":[["id","main"],["class","card feature"]],"s":[0,1],"r":[10,10,300,100],"b":[3,4]},
        {"t":"SPAN","p":4,"c":["world"],"s":[2,1],"r":[10,10,50,20],"st":["hover"]},
        {"t":"svg","n":1,"p":4,"c":[],"a":[["class","icon"]],"s":[2,1],"k":true}
      ]
    }"#;

    #[test]
    fn tree_and_text() {
        let d = snap(SMALL);
        assert_eq!(d.document_element(), Some(1));
        assert_eq!(d.body(), Some(3));
        assert_eq!(d.tag_name(4), "DIV");
        assert_eq!(d.parent(5), Some(4));
        assert_eq!(d.children(4), vec![5, 6]);
        assert_eq!(d.text_content(4), "Hello world");
        assert_eq!(d.text_content(3), "Hello worldtail");
        assert_eq!(d.direct_text_nodes(4), vec!["Hello ".to_string()]);
        assert_eq!(d.previous_element_sibling(6), Some(5));
        assert_eq!(d.next_element_sibling(5), Some(6));
        assert!(d.contains(3, 5));
        assert!(!d.contains(5, 3));
        assert_eq!(d.style(5, "display"), "inline");
        assert_eq!(d.style(5, "opacity"), "");
        assert_eq!(d.unknown_style_props(), vec!["opacity".to_string()]);
        assert_eq!(
            d.pseudo_style(4, "::before", "content").as_deref(),
            Some("\"\"")
        );
        assert_eq!(
            d.pseudo_style(4, "::before", "width").as_deref(),
            Some("4px")
        );
        assert_eq!(
            d.pseudo_style(5, "::before", "content").as_deref(),
            Some("none")
        );
        assert_eq!(d.class_name_prop(6), None);
        assert_eq!(d.class_name_prop(4).as_deref(), Some("card feature"));
        assert_eq!(d.id_prop(5).as_deref(), Some(""));
        assert_eq!(d.rect(4).right, 310.0);
        assert!(d.offset_width(6).is_nan());
    }

    #[test]
    fn selectors_over_snapshot() {
        let d = snap(SMALL);
        assert_eq!(d.query_all(None, "*").unwrap(), vec![1, 2, 3, 4, 5, 6]);
        assert_eq!(d.query_all(None, "body *").unwrap(), vec![4, 5, 6]);
        assert_eq!(d.query_all(Some(4), ":scope > span").unwrap(), vec![5]);
        assert_eq!(d.query_one(None, "#main").unwrap(), Some(4));
        assert_eq!(
            d.query_one(None, "div.card.feature > span:nth-of-type(1)")
                .unwrap(),
            Some(5)
        );
        assert_eq!(d.closest(5, "[class*=\"CARD\" i]").unwrap(), Some(4));
        assert_eq!(d.closest(5, ".nope").unwrap(), None);
        assert!(d.matches(5, "span:hover").unwrap());
        assert!(!d.matches(4, "div:hover").unwrap());
        assert!(d.matches(6, "svg").unwrap());
        assert!(
            d.matches(6, "SVG").unwrap() == false,
            "svg type selectors are case-sensitive"
        );
        assert!(d.matches(4, "DIV").unwrap());
        assert!(d.matches(1, ":root").unwrap());
        assert!(d.matches(1, ":lang(en)").unwrap());
        assert!(d.matches(5, ":lang(en)").unwrap());
        assert!(d.matches(3, "body:has(> div)").unwrap());
        assert!(d.matches(2, ":empty").unwrap());
        assert!(!d.matches(4, ":empty").unwrap());
        assert!(d.matches(4, "div::before").unwrap() == false);
        assert!(d.matches(4, "div:foo").is_err());
        assert!(d.query_all(None, ".x)").is_err());
        assert_eq!(
            d.query_all(None, "h1, h2, [role=\"heading\"]").unwrap(),
            Vec::<u32>::new()
        );
    }

    #[test]
    fn hit_tests_are_demand_driven() {
        let d = snap(SMALL);
        assert_eq!(d.element_from_point(20.0, 20.0), None);
        assert!(d.has_needs());
        let needs = d.take_needs();
        assert_eq!(needs.hit_tests, vec![[20.0, 20.0]]);
        d.add_facts(&Facts {
            hits: vec![HitTest {
                x: 20.0,
                y: 20.0,
                top: 5,
                stack: vec![5, 4, 3, 1],
            }],
        });
        assert_eq!(d.element_from_point(20.0, 20.0), Some(5));
        assert_eq!(d.elements_from_point(20.0, 20.0), vec![5, 4, 3, 1]);
        assert!(!d.has_needs());
    }

    #[test]
    fn css_escape_matches_spec() {
        assert_eq!(css_escape("foo"), "foo");
        assert_eq!(css_escape("1st"), "\\31 st");
        assert_eq!(css_escape("-1"), "-\\31 ");
        assert_eq!(css_escape("-"), "\\-");
        assert_eq!(css_escape("a b.c"), "a\\ b\\.c");
        assert_eq!(css_escape("\u{0}x"), "\u{FFFD}x");
        assert_eq!(css_escape("é"), "é");
        assert_eq!(css_escape("a\u{1}"), "a\\1 ");
    }
}
