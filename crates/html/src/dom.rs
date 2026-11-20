//! The static DOM: `StaticDocument` / `StaticElement` from
//! `cli/engine/engines/static-html/css-cascade.mjs`, over an html5ever tree.
//!
//! The JS engine parses with htmlparser2 (`lowerCaseTags: true`) and queries
//! with css-select. Two htmlparser2 quirks the JS wrapper exposes and this
//! port reproduces:
//!
//! - `<script>` and `<style>` nodes have type `script` / `style`, not `tag`.
//!   css-select still matches them (`isTag` is true for all three), so they
//!   appear in `querySelectorAll` results and get element checks run on
//!   them, but `StaticElement.children` / `parentElement` /
//!   `previousElementSibling` / `closest` only walk `tag`-typed nodes and the
//!   cascade never computes a style for them (they read as the default
//!   style). [`StaticElement::is_plain_tag`] is that distinction.
//! - `childNodes` maps every non-text, non-tag child (comments, doctypes,
//!   script/style elements) to a `nodeType: 8` stub.
//!
//! html5ever differs from htmlparser2 in tree construction. What this port
//! normalizes: `<template>` fragments are flattened back under the
//! `<template>` element, and `html` / `head` / `body` elements the source
//! never spelled out are unwrapped again (htmlparser2 never implies them, so
//! a partial keeps its flat top-level shape and `:root` matches each
//! top-level element). What stays different, none of which the fixture
//! corpus exercises (see `tests/oracle_html.rs`; the JS repo's
//! `tests/oracle/DELTAS.md` is where a reviewed delta would be listed):
//!
//! - attribute names: htmlparser2 runs with `lowerCaseAttributeNames: false`,
//!   so `<div CLASS="card" STYLE="...">` has no `class` / `style` for the JS
//!   engine, while html5ever lowercases attribute names (the browser
//!   behavior) and the port sees them;
//! - implied `<tbody>` in tables, `<p>` auto-close on block starts, foster
//!   parenting of stray table content, nested `<a>` (adoption agency), and
//!   `<noscript>` content (raw text here, markup in htmlparser2);
//! - SVG tag names keep their case (`linearGradient`); tag matching is
//!   ASCII case-insensitive on both sides so selectors agree, but
//!   `tagName` reads lowercase as htmlparser2 (`lowerCaseTags`) reports it.

use crate::select::{El, Selector, SelectorError};
use ego_tree::{NodeId, NodeRef};
use html5ever::tendril::{StrTendril, TendrilSink};
use html5ever::tree_builder::{ElementFlags, NodeOrText, QuirksMode, TreeBuilderOpts, TreeSink};
use html5ever::{Attribute, ParseOpts, QualName};
use impeccable_core::color::Rgba;
use impeccable_core::js;
use once_cell::sync::Lazy;
use regex::Regex;
use scraper::{Html, HtmlTreeSink, Node};
use std::borrow::Cow;
use std::cell::{Cell, RefCell};
use std::collections::{HashMap, HashSet};

use crate::cascade::StyleValues;

/// The parsed document plus everything the cascade attaches to its nodes.
pub struct StaticDocument {
    pub html: Html,
    /// 1-based source line of each element's start tag (empty for a tree
    /// built by [`StaticDocument::new`]).
    lines: HashMap<NodeId, u32>,
    styles: HashMap<NodeId, StyleValues>,
    hover_styles: HashMap<NodeId, StyleValues>,
    placeholder_styles: HashMap<NodeId, StyleValues>,
    accent_dash: HashSet<NodeId>,
    pseudo_surface: HashMap<NodeId, Rgba>,
    pseudo_picture: HashSet<NodeId>,
    pseudo_overlay: HashSet<NodeId>,
    selector_cache: RefCell<HashMap<String, Result<Selector, SelectorError>>>,
    unsupported_selectors: RefCell<Vec<String>>,
    /// Elements some applied declaration gave a border radius.
    radius_declared: HashSet<NodeId>,
    /// Elements a radius the cascade could not apply may reach: a nested
    /// rule, a skipped at-rule, a selector the matcher refuses.
    radius_unseen: HashSet<NodeId>,
    /// A radius the cascade could not apply names no element it can find,
    /// so every element's corners are unknown.
    radius_unseen_everywhere: bool,
    /// The page links a stylesheet the engine did not read.
    unread_stylesheet: bool,
}

impl std::fmt::Debug for StaticDocument {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("StaticDocument")
            .field("styles", &self.styles.len())
            .finish()
    }
}

/// JS: `modules.parseDocument(html, { lowerCaseAttributeNames: false, lowerCaseTags: true })`
/// Parse with html5ever, then flatten template fragments.
///
/// Scripting stays enabled (the html5ever default), so `<noscript>` content
/// is raw text. htmlparser2 parses it as markup, but the alternative
/// (`scripting_enabled: false`) moves a head-level `<noscript>`'s prose out
/// to `<body>` as bare text, which the JS never sees; raw text inside the
/// (non-rendered) `noscript` element is the closer match.
pub fn parse_html(source: &str) -> Html {
    let mut html = html5ever::parse_document(HtmlTreeSink::new(Html::new_document()), parse_opts()).one(source);
    flatten_fragments(&mut html);
    unwrap_synthesized_wrappers(&mut html, source);
    html
}

/// [`parse_html`] plus the 1-based source line of every element's start tag.
fn parse_html_with_lines(source: &str) -> (Html, HashMap<NodeId, u32>) {
    let (mut html, lines) = html5ever::parse_document(LineSink::new(source), parse_opts()).one(source);
    flatten_fragments(&mut html);
    unwrap_synthesized_wrappers(&mut html, source);
    (html, lines)
}

fn parse_opts() -> ParseOpts {
    ParseOpts {
        tree_builder: TreeBuilderOpts {
            scripting_enabled: true,
            ..Default::default()
        },
        ..Default::default()
    }
}

/// Scraper's sink, recording the line each element's start tag begins on.
/// html5ever reports the line a start tag ends on (its `>`), so the sink walks
/// the source tag by tag alongside the parse to find where it opens; an
/// element the source never spelled out (an implied `<tbody>`) keeps the line
/// of the tag that implied it.
struct LineSink<'s> {
    inner: HtmlTreeSink,
    source: &'s str,
    /// Byte offset of each line's first character.
    line_starts: Vec<usize>,
    line: Cell<u64>,
    /// Byte offset of the next source tag not yet matched to an element.
    cursor: Cell<usize>,
    lines: RefCell<HashMap<NodeId, u32>>,
}

impl<'s> LineSink<'s> {
    fn new(source: &'s str) -> Self {
        let line_starts = std::iter::once(0)
            .chain(source.match_indices('\n').map(|(i, _)| i + 1))
            .collect();
        LineSink {
            inner: HtmlTreeSink::new(Html::new_document()),
            source,
            line_starts,
            line: Cell::new(1),
            cursor: Cell::new(0),
            lines: RefCell::new(HashMap::new()),
        }
    }

    /// The 1-based line holding byte `offset`.
    fn line_of(&self, offset: usize) -> u64 {
        self.line_starts.partition_point(|&start| start <= offset) as u64
    }

    /// `raw_text`: the element is HTML script, style or the like, whose
    /// content the tokenizer reads as text.
    fn start_line(&self, name: &str, raw_text: bool) -> u64 {
        let end_line = self.line.get();
        let bytes = self.source.as_bytes();
        // In markup, `<` and a letter always opens a tag, so the first one
        // past the cursor (outside comments and `<!...>` / `<?...>`) is the
        // tag html5ever is processing. A tag of another name means this
        // element was implied by it; one that closed on an earlier line was
        // a tag the tree builder dropped. Each step moves the cursor
        // forward, so the scan stays linear on a one-line page.
        let mut at = self.cursor.get();
        let found = loop {
            let Some(i) = self.source.get(at..).and_then(|w| w.find('<')).map(|i| at + i) else {
                break None;
            };
            let next = bytes.get(i + 1).copied().unwrap_or(0);
            if bytes[i..].starts_with(b"<!--") {
                at = self.source[i + 4..].find("-->").map_or(self.source.len(), |end| i + 4 + end + 3);
            } else if next == b'!' || next == b'?' {
                at = self.source[i..].find('>').map_or(self.source.len(), |end| i + end + 1);
            } else if next.is_ascii_alphabetic() {
                let len = bytes[i + 1..]
                    .iter()
                    .position(|b| b.is_ascii_whitespace() || *b == b'/' || *b == b'>')
                    .unwrap_or(bytes.len() - i - 1);
                let tag = &bytes[i + 1..i + 1 + len];
                let close = tag_close(bytes, i + 1 + len);
                let close_line = close.map_or(end_line, |c| self.line_of(c));
                let named = tag.eq_ignore_ascii_case(name.as_bytes())
                    || (name == "img" && tag.eq_ignore_ascii_case(b"image"));
                if named && close_line == end_line {
                    break Some((i, close.map_or(bytes.len(), |c| c + 1)));
                }
                if close_line >= end_line {
                    break None;
                }
                at = close.map_or(bytes.len(), |c| c + 1);
            } else {
                at = i + 1;
            }
            self.cursor.set(at);
        };
        match found {
            Some((i, mut cursor)) => {
                // Past the tag's attributes, and past a raw-text element's
                // text (a `<p` in a script string).
                if raw_text {
                    let closing = format!("</{name}");
                    cursor = bytes[cursor..]
                        .windows(closing.len())
                        .position(|w| w.eq_ignore_ascii_case(closing.as_bytes()))
                        .map_or(cursor, |end| cursor + end);
                }
                self.cursor.set(cursor);
                self.line_of(i)
            }
            None => end_line,
        }
    }
}

/// HTML elements whose content the tokenizer reads as text, not markup (an
/// SVG `<title>` is markup).
const RAW_TEXT: [&str; 7] = ["script", "style", "textarea", "title", "xmp", "noscript", "iframe"];

/// The offset of the `>` that closes a start tag whose name ends at `from`,
/// skipping quoted attribute values (`title="a > b"`).
fn tag_close(bytes: &[u8], from: usize) -> Option<usize> {
    let mut quote = None;
    // A quote opens a value only right after `=` (an apostrophe in an
    // unquoted value, `title=don't`, is text).
    let mut after_equals = false;
    for (i, &b) in bytes.iter().enumerate().skip(from) {
        match quote {
            Some(q) if b == q => quote = None,
            Some(_) => {}
            None if after_equals && (b == b'"' || b == b'\'') => quote = Some(b),
            None if b == b'>' => return Some(i),
            None => {}
        }
        if quote.is_none() && !b.is_ascii_whitespace() {
            after_equals = b == b'=';
        }
    }
    None
}

impl TreeSink for LineSink<'_> {
    type Handle = NodeId;
    type Output = (Html, HashMap<NodeId, u32>);
    type ElemName<'a>
        = <HtmlTreeSink as TreeSink>::ElemName<'a>
    where
        Self: 'a;

    fn finish(self) -> Self::Output {
        (self.inner.finish(), self.lines.into_inner())
    }
    fn set_current_line(&self, line_number: u64) {
        self.line.set(line_number);
    }
    fn create_element(&self, name: QualName, attrs: Vec<Attribute>, flags: ElementFlags) -> NodeId {
        let raw_text = name.ns == html5ever::ns!(html) && RAW_TEXT.contains(&name.local.as_ref());
        let line = self.start_line(name.local.as_ref(), raw_text);
        let id = self.inner.create_element(name, attrs, flags);
        self.lines.borrow_mut().insert(id, line as u32);
        id
    }
    fn parse_error(&self, msg: Cow<'static, str>) {
        self.inner.parse_error(msg)
    }
    fn get_document(&self) -> NodeId {
        self.inner.get_document()
    }
    fn elem_name<'a>(&'a self, target: &'a NodeId) -> Self::ElemName<'a> {
        self.inner.elem_name(target)
    }
    fn create_comment(&self, text: StrTendril) -> NodeId {
        self.inner.create_comment(text)
    }
    fn create_pi(&self, target: StrTendril, data: StrTendril) -> NodeId {
        self.inner.create_pi(target, data)
    }
    fn append(&self, parent: &NodeId, child: NodeOrText<NodeId>) {
        self.inner.append(parent, child)
    }
    fn append_based_on_parent_node(&self, element: &NodeId, prev: &NodeId, child: NodeOrText<NodeId>) {
        self.inner.append_based_on_parent_node(element, prev, child)
    }
    fn append_doctype_to_document(&self, name: StrTendril, public_id: StrTendril, system_id: StrTendril) {
        self.inner.append_doctype_to_document(name, public_id, system_id)
    }
    fn get_template_contents(&self, target: &NodeId) -> NodeId {
        self.inner.get_template_contents(target)
    }
    fn same_node(&self, x: &NodeId, y: &NodeId) -> bool {
        self.inner.same_node(x, y)
    }
    fn set_quirks_mode(&self, mode: QuirksMode) {
        self.inner.set_quirks_mode(mode)
    }
    fn append_before_sibling(&self, sibling: &NodeId, new_node: NodeOrText<NodeId>) {
        self.inner.append_before_sibling(sibling, new_node)
    }
    fn add_attrs_if_missing(&self, target: &NodeId, attrs: Vec<Attribute>) {
        self.inner.add_attrs_if_missing(target, attrs)
    }
    fn remove_from_parent(&self, target: &NodeId) {
        self.inner.remove_from_parent(target)
    }
    fn reparent_children(&self, node: &NodeId, new_parent: &NodeId) {
        self.inner.reparent_children(node, new_parent)
    }
}

static HTML_TAG_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(&format!(r"(?i)<html[{}/>]", js::WS_CHARS)).expect("HTML_TAG_RE"));
static HEAD_TAG_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(&format!(r"(?i)<head[{}/>]", js::WS_CHARS)).expect("HEAD_TAG_RE"));
static BODY_TAG_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(&format!(r"(?i)<body[{}/>]", js::WS_CHARS)).expect("BODY_TAG_RE"));
static COMMENT_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?s)<!--.*?-->").expect("COMMENT_RE"));

/// html5ever always synthesizes `<html>`, `<head>` and `<body>`; htmlparser2
/// never does. For every one of the three the source does not spell out
/// (comments stripped first), splice the element's children into its parent
/// at its position and drop it, so a fragment or partial keeps the flat
/// top-level shape the JS engine walks (`:root` then matches each top-level
/// element, `html {}` rules match nothing, and so on).
fn unwrap_synthesized_wrappers(html: &mut Html, source: &str) {
    let stripped = COMMENT_RE.replace_all(source, "");
    let missing: Vec<&str> = [
        ("html", &*HTML_TAG_RE),
        ("head", &*HEAD_TAG_RE),
        ("body", &*BODY_TAG_RE),
    ]
    .into_iter()
    .filter(|(_, re)| !re.is_match(&stripped))
    .map(|(name, _)| name)
    .collect();
    if missing.is_empty() {
        return;
    }
    // Innermost first (body, head, then html) so parents are still present.
    for name in ["body", "head", "html"] {
        if !missing.contains(&name) {
            continue;
        }
        let target = html.tree.root().descendants().find(|n| {
            n.value()
                .as_element()
                .is_some_and(|e| e.name.ns == html5ever::ns!(html) && e.name.local.as_ref() == name)
        });
        let Some(target) = target else {
            continue;
        };
        let id = target.id();
        let children: Vec<NodeId> = target.children().map(|c| c.id()).collect();
        for child in children {
            if let Some(mut t) = html.tree.get_mut(id) {
                t.insert_id_before(child);
            }
        }
        if let Some(mut t) = html.tree.get_mut(id) {
            t.detach();
        }
    }
}

/// Move `<template>` fragment children under the template element and drop
/// the fragment node, so the tree walk sees template content as ordinary
/// descendants (htmlparser2 has no template special-casing).
fn flatten_fragments(html: &mut Html) {
    let fragments: Vec<(NodeId, NodeId)> = html
        .tree
        .root()
        .descendants()
        .filter(|n| n.value().is_fragment())
        .filter_map(|n| n.parent().map(|p| (p.id(), n.id())))
        .collect();
    for (parent, frag) in fragments {
        if let Some(mut p) = html.tree.get_mut(parent) {
            p.reparent_from_id_append(frag);
        }
        if let Some(mut f) = html.tree.get_mut(frag) {
            f.detach();
        }
    }
}

impl StaticDocument {
    /// Wrap a parsed tree.
    pub fn new(html: Html) -> Self {
        StaticDocument {
            html,
            lines: HashMap::new(),
            styles: HashMap::new(),
            hover_styles: HashMap::new(),
            placeholder_styles: HashMap::new(),
            accent_dash: HashSet::new(),
            pseudo_surface: HashMap::new(),
            pseudo_picture: HashSet::new(),
            pseudo_overlay: HashSet::new(),
            selector_cache: RefCell::new(HashMap::new()),
            unsupported_selectors: RefCell::new(Vec::new()),
            radius_declared: HashSet::new(),
            radius_unseen: HashSet::new(),
            radius_unseen_everywhere: false,
            unread_stylesheet: false,
        }
    }

    /// Parse and wrap.
    pub fn parse(source: &str) -> Self {
        let (html, lines) = parse_html_with_lines(source);
        StaticDocument { lines, ..Self::new(html) }
    }

    fn root(&self) -> NodeRef<'_, Node> {
        self.html.tree.root()
    }

    /// Wrap a node id as an element (None when it is not an element).
    pub fn element(&self, id: NodeId) -> Option<StaticElement<'_>> {
        let node = self.html.tree.get(id)?;
        node.value()
            .is_element()
            .then(|| StaticElement { doc: self, node })
    }

    fn wrap<'a>(&'a self, node: NodeRef<'a, Node>) -> StaticElement<'a> {
        StaticElement { doc: self, node }
    }

    /// Compile (and cache) a selector; `Err` where css-select throws. The
    /// first failure of each selector text is recorded for the parity report.
    pub fn compile(&self, selector: &str) -> Result<Selector, SelectorError> {
        if let Some(r) = self.selector_cache.borrow().get(selector) {
            return r.clone();
        }
        let r = Selector::parse(selector);
        if r.is_err() {
            self.unsupported_selectors
                .borrow_mut()
                .push(selector.to_string());
        }
        self.selector_cache
            .borrow_mut()
            .insert(selector.to_string(), r.clone());
        r
    }

    /// Selectors css-select would refuse that were seen during this scan.
    pub fn unsupported_selectors(&self) -> Vec<String> {
        self.unsupported_selectors.borrow().clone()
    }

    /// css-select `selectAll(selector, nodes)`: every element among `nodes`
    /// and their descendants (document order) matching `selector`.
    fn select_all_in<'a>(
        &'a self,
        selector: &Selector,
        roots: impl Iterator<Item = NodeRef<'a, Node>>,
    ) -> Vec<StaticElement<'a>> {
        let mut out = Vec::new();
        for root in roots {
            for n in root.descendants() {
                if n.value().is_element() && selector.matches(&El(n)) {
                    out.push(self.wrap(n));
                }
            }
        }
        out
    }

    fn select_one_in<'a>(
        &'a self,
        selector: &Selector,
        roots: impl Iterator<Item = NodeRef<'a, Node>>,
    ) -> Option<StaticElement<'a>> {
        for root in roots {
            for n in root.descendants() {
                if n.value().is_element() && selector.matches(&El(n)) {
                    return Some(self.wrap(n));
                }
            }
        }
        None
    }

    /// JS `document.querySelectorAll(selector)`: `[]` for an unsupported selector.
    pub fn query_selector_all(&self, selector: &str) -> Vec<StaticElement<'_>> {
        match self.compile(selector) {
            Ok(sel) => self.select_all_in(&sel, self.root().children()),
            Err(_) => Vec::new(),
        }
    }

    /// The ids of every element matching `selector`, or `None` when the
    /// matcher refuses it. Unlike [`Self::query_selector_all`] a refusal is
    /// not recorded for the parity report: the side-accent fail-safe probes
    /// selectors the page never asked the matcher about.
    pub fn select_ids_quiet(&self, selector: &str) -> Option<Vec<NodeId>> {
        let sel = Selector::parse(selector).ok()?;
        Some(
            self.select_all_in(&sel, self.root().children())
                .iter()
                .map(|el| el.id())
                .collect(),
        )
    }

    /// The ids among `candidates` whose element matches `selector`, parsed
    /// quietly like [`Self::select_ids_quiet`]; `None` when the matcher
    /// refuses it. For a selector tested against a handful of elements
    /// rather than the whole document.
    pub fn matching_ids_quiet(&self, selector: &str, candidates: &[NodeId]) -> Option<Vec<NodeId>> {
        let sel = Selector::parse(selector).ok()?;
        Some(
            candidates
                .iter()
                .copied()
                .filter(|id| {
                    self.element(*id)
                        .is_some_and(|el| sel.matches(&El(el.node)))
                })
                .collect(),
        )
    }

    /// JS `document.querySelector(selector)`.
    pub fn query_selector(&self, selector: &str) -> Option<StaticElement<'_>> {
        match self.compile(selector) {
            Ok(sel) => self.select_one_in(&sel, self.root().children()),
            Err(_) => None,
        }
    }

    /// JS `document.documentElement`.
    pub fn document_element(&self) -> Option<StaticElement<'_>> {
        self.query_selector("html")
    }

    /// JS `document.body`.
    pub fn body(&self) -> Option<StaticElement<'_>> {
        self.query_selector("body")
    }

    /// Every element node in document order (JS `selectAll('*', root.children)`).
    pub fn all_elements(&self) -> Vec<StaticElement<'_>> {
        self.root()
            .descendants()
            .filter(|n| n.value().is_element())
            .map(|n| self.wrap(n))
            .collect()
    }

    /// Element children of the document root, in order (JS `root.children`
    /// filtered to tags).
    pub fn root_elements(&self) -> Vec<StaticElement<'_>> {
        self.root()
            .children()
            .filter(|n| n.value().is_element())
            .map(|n| self.wrap(n))
            .collect()
    }

    // ── cascade attachments ─────────────────────────────────────────────

    pub fn set_style(&mut self, node: NodeId, style: StyleValues) {
        self.styles.insert(node, style);
    }
    /// JS `getStyle(el)`: the computed style, or the default style for a
    /// node the cascade never visited.
    pub fn get_style(&self, node: NodeId) -> &StyleValues {
        self.styles.get(&node).unwrap_or_else(|| default_style())
    }
    pub fn set_hover_style(&mut self, node: NodeId, style: StyleValues) {
        self.hover_styles.insert(node, style);
    }
    pub fn get_hover_style(&self, node: NodeId) -> Option<&StyleValues> {
        self.hover_styles.get(&node)
    }
    pub fn set_placeholder_style(&mut self, node: NodeId, style: StyleValues) {
        self.placeholder_styles.insert(node, style);
    }
    pub fn get_placeholder_style(&self, node: NodeId) -> Option<&StyleValues> {
        self.placeholder_styles.get(&node)
    }
    pub fn set_accent_dash_pseudo(&mut self, node: NodeId) {
        self.accent_dash.insert(node);
    }
    pub fn has_accent_dash_pseudo(&self, node: NodeId) -> bool {
        self.accent_dash.contains(&node)
    }
    pub fn set_pseudo_surface(&mut self, node: NodeId, color: Rgba) {
        self.pseudo_surface.insert(node, color);
    }
    pub fn get_pseudo_surface(&self, node: NodeId) -> Option<Rgba> {
        self.pseudo_surface.get(&node).copied()
    }
    /// Mark a node whose `::before` or `::after` is stretched over it and
    /// paints a raster image: a hero photo drawn by a pseudo-element.
    pub fn set_pseudo_picture(&mut self, node: NodeId) {
        self.pseudo_picture.insert(node);
    }
    /// Mark a node whose `::before` or `::after` is stretched over it and
    /// paints anything at all (a translucent fill, a gradient), even one too
    /// faint or too varied to be read as a surface. The sampled-contrast
    /// walk stops at such a node.
    pub fn set_pseudo_overlay(&mut self, node: NodeId) {
        self.pseudo_overlay.insert(node);
    }
    pub fn has_pseudo_overlay(&self, node: NodeId) -> bool {
        self.pseudo_overlay.contains(&node)
    }
    pub fn has_pseudo_picture(&self, node: NodeId) -> bool {
        self.pseudo_picture.contains(&node)
    }
    /// Record that an applied declaration gave `node` a border radius.
    pub fn set_radius_declared(&mut self, node: NodeId) {
        self.radius_declared.insert(node);
    }
    /// Record that a radius the cascade could not apply may reach `node`.
    pub fn set_radius_unseen(&mut self, node: NodeId) {
        self.radius_unseen.insert(node);
    }
    /// Record that a radius the cascade could not apply names no element it
    /// can find, so no element's corners are known.
    pub fn set_radius_unseen_everywhere(&mut self) {
        self.radius_unseen_everywhere = true;
    }
    /// Record that the page links a stylesheet the engine did not read.
    pub fn set_unread_stylesheet(&mut self) {
        self.unread_stylesheet = true;
    }
}

static DEFAULT_STYLE: once_cell::sync::Lazy<StyleValues> =
    once_cell::sync::Lazy::new(crate::cascade::make_default_style);

/// JS `makeStaticStyle()`: the untouched default style.
pub fn default_style() -> &'static StyleValues {
    &DEFAULT_STYLE
}

/// One entry of JS `childNodes`.
#[derive(Debug, Clone, Copy)]
pub enum ChildNode<'a> {
    /// `nodeType: 3`
    Text(&'a str),
    /// `nodeType: 1` (a `tag`-typed element)
    Element(StaticElement<'a>),
    /// `nodeType: 8` (comment, doctype, script/style element)
    Other,
}

/// JS `StaticElement`: a wrapper over one element node.
#[derive(Clone, Copy)]
pub struct StaticElement<'a> {
    pub doc: &'a StaticDocument,
    pub node: NodeRef<'a, Node>,
}

impl std::fmt::Debug for StaticElement<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "<{}>", self.tag_lower())
    }
}

impl PartialEq for StaticElement<'_> {
    fn eq(&self, other: &Self) -> bool {
        self.node.id() == other.node.id()
    }
}
impl Eq for StaticElement<'_> {}

impl std::hash::Hash for StaticElement<'_> {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.node.id().hash(state);
    }
}

/// htmlparser2 element type: `script` / `style` are not `tag`.
fn node_is_plain_tag(n: &NodeRef<'_, Node>) -> bool {
    match n.value() {
        Node::Element(e) => {
            let name = e.name.local.as_ref();
            !name.eq_ignore_ascii_case("script") && !name.eq_ignore_ascii_case("style")
        }
        _ => false,
    }
}

impl<'a> StaticElement<'a> {
    pub fn id(&self) -> NodeId {
        self.node.id()
    }

    /// The 1-based source line of this element's start tag, 0 when unknown.
    pub fn source_line(&self) -> f64 {
        self.doc.lines.get(&self.id()).copied().unwrap_or(0) as f64
    }

    fn elem(&self) -> &'a scraper::node::Element {
        self.node.value().as_element().expect("element node")
    }

    /// htmlparser2 `type === 'tag'` (false for `<script>` / `<style>`).
    pub fn is_plain_tag(&self) -> bool {
        node_is_plain_tag(&self.node)
    }

    /// JS `el.tagName.toLowerCase()` (htmlparser2 lowercases tag names).
    pub fn tag_lower(&self) -> String {
        self.elem().name.local.as_ref().to_ascii_lowercase()
    }

    /// JS `el.tagName` (upper-cased).
    pub fn tag_upper(&self) -> String {
        self.elem().name.local.as_ref().to_ascii_uppercase()
    }

    /// JS `getAttribute(name)`: `null` when absent.
    pub fn get_attribute(&self, name: &str) -> Option<&'a str> {
        self.elem().attr(name)
    }

    /// Every attribute as `(name, value)`.
    pub fn attributes(&self) -> impl Iterator<Item = (&'a str, &'a str)> {
        self.elem().attrs()
    }

    /// JS `el.className` (`getAttribute('class') || ''`).
    pub fn class_name(&self) -> &'a str {
        self.get_attribute("class").unwrap_or("")
    }

    /// JS `el.id` (`getAttribute('id') || ''`).
    pub fn id_attr(&self) -> &'a str {
        self.get_attribute("id").unwrap_or("")
    }

    /// JS `parentElement`: the nearest `tag`-typed ancestor.
    pub fn parent_element(&self) -> Option<StaticElement<'a>> {
        let mut cur = self.node.parent();
        while let Some(n) = cur {
            if node_is_plain_tag(&n) {
                return Some(self.doc.wrap(n));
            }
            if n.value().is_document() {
                return None;
            }
            cur = n.parent();
        }
        None
    }

    /// JS `previousElementSibling`: the nearest preceding `tag`-typed sibling.
    pub fn previous_element_sibling(&self) -> Option<StaticElement<'a>> {
        self.node
            .prev_siblings()
            .find(node_is_plain_tag)
            .map(|n| self.doc.wrap(n))
    }

    /// JS `nextElementSibling`: the nearest following `tag`-typed sibling.
    pub fn next_element_sibling(&self) -> Option<StaticElement<'a>> {
        self.node
            .next_siblings()
            .find(node_is_plain_tag)
            .map(|n| self.doc.wrap(n))
    }

    /// JS `firstElementChild`: the first `tag`-typed child node, read without
    /// collecting the rest.
    pub fn first_element_child(&self) -> Option<StaticElement<'a>> {
        self.node
            .children()
            .find(node_is_plain_tag)
            .map(|n| self.doc.wrap(n))
    }

    /// JS `children`: `tag`-typed child nodes.
    pub fn children(&self) -> Vec<StaticElement<'a>> {
        self.node
            .children()
            .filter(node_is_plain_tag)
            .map(|n| self.doc.wrap(n))
            .collect()
    }

    /// JS `childNodes`.
    pub fn child_nodes(&self) -> Vec<ChildNode<'a>> {
        self.node
            .children()
            .map(|n| match n.value() {
                Node::Text(t) => ChildNode::Text(&t.text),
                Node::Element(_) if node_is_plain_tag(&n) => ChildNode::Element(self.doc.wrap(n)),
                _ => ChildNode::Other,
            })
            .collect()
    }

    /// The concatenated direct text-node content (`childNodes` of type 3).
    pub fn direct_text(&self) -> String {
        let mut s = String::new();
        for c in self.node.children() {
            if let Node::Text(t) = c.value() {
                s.push_str(&t.text);
            }
        }
        s
    }

    /// Whether any direct text node's trimmed length exceeds `min_len`
    /// (JS `childNodes.some(n => n.nodeType === 3 && n.textContent.trim().length > min_len)`).
    pub fn has_direct_text_longer_than(&self, min_len: usize) -> bool {
        self.node.children().any(|c| match c.value() {
            Node::Text(t) => {
                impeccable_core::js_ext_b::utf16_len(impeccable_core::js::trim(&t.text)) > min_len
            }
            _ => false,
        })
    }

    /// JS `textContent` (domutils): all descendant text, including
    /// `<script>` / `<style>` payloads, excluding comments.
    pub fn text_content(&self) -> String {
        let mut s = String::new();
        for n in self.node.descendants().skip(1) {
            if let Node::Text(t) = n.value() {
                s.push_str(&t.text);
            }
        }
        s
    }

    /// JS `el.querySelectorAll(selector)`: `[]` for an unsupported selector.
    pub fn query_selector_all(&self, selector: &str) -> Vec<StaticElement<'a>> {
        match self.doc.compile(selector) {
            Ok(sel) => self.doc.select_all_in(&sel, self.node.children()),
            Err(_) => Vec::new(),
        }
    }

    /// JS `el.querySelector(selector)`.
    pub fn query_selector(&self, selector: &str) -> Option<StaticElement<'a>> {
        match self.doc.compile(selector) {
            Ok(sel) => self.doc.select_one_in(&sel, self.node.children()),
            Err(_) => None,
        }
    }

    /// JS `closest(selector)`: self-or-ancestor walk over `tag`-typed nodes;
    /// `null` for an unsupported selector or when `self` is script/style.
    pub fn closest(&self, selector: &str) -> Option<StaticElement<'a>> {
        let sel = self.doc.compile(selector).ok()?;
        let mut cur = Some(*self);
        while let Some(el) = cur {
            if !el.is_plain_tag() {
                return None;
            }
            if sel.matches(&El(el.node)) {
                return Some(el);
            }
            cur = el.parent_element();
        }
        None
    }

    /// JS `contains(other)`: `other` is `self` or a descendant.
    pub fn contains(&self, other: &StaticElement<'_>) -> bool {
        let mut cur = Some(other.node);
        while let Some(n) = cur {
            if n.id() == self.node.id() {
                return true;
            }
            cur = n.parent();
        }
        false
    }

    /// The computed style (default when the cascade skipped this node).
    pub fn style(&self) -> &'a StyleValues {
        self.doc.get_style(self.node.id())
    }

    /// Whether an applied declaration gave this element a border radius.
    pub fn radius_declared(&self) -> bool {
        self.doc.radius_declared.contains(&self.node.id())
    }

    /// Whether a radius the cascade could not apply may reach this element.
    pub fn radius_unseen(&self) -> bool {
        self.doc.radius_unseen_everywhere || self.doc.radius_unseen.contains(&self.node.id())
    }

    /// Whether the page links a stylesheet the engine did not read.
    pub fn page_has_unread_stylesheet(&self) -> bool {
        self.doc.unread_stylesheet
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn script_style_are_not_tags() {
        let doc = StaticDocument::parse(
            "<html><body><style>p{}</style><h1>Hi</h1><script>x</script><div><template><p>t</p></template></div></body></html>",
        );
        let h1 = doc.query_selector("h1").unwrap();
        assert!(h1.previous_element_sibling().is_none());
        let body = doc.body().unwrap();
        assert_eq!(body.children().len(), 2);
        assert_eq!(body.child_nodes().len(), 4);
        assert!(body.text_content().contains("p{}"));
        let style = doc.query_selector("style").unwrap();
        assert!(style.closest("body").is_none());
        assert!(h1.closest("body").is_some());
        assert_eq!(doc.query_selector_all("template p").len(), 1);
        // No `<head>` in the source: the synthesized one is unwrapped.
        assert_eq!(doc.query_selector_all("*").len(), 8);
        assert!(doc.query_selector_all("p:focus").is_empty());
        assert_eq!(doc.unsupported_selectors(), vec!["p:focus".to_string()]);
    }

    #[test]
    fn fragments_keep_top_level_shape() {
        let doc = StaticDocument::parse("<style>x{}</style><div class=a>one</div><p>two</p>");
        let tags: Vec<String> = doc.all_elements().iter().map(|e| e.tag_lower()).collect();
        assert_eq!(tags, vec!["style", "div", "p"]);
        assert_eq!(doc.query_selector_all(":root").len(), 3);
        assert!(doc.document_element().is_none());
        assert!(doc.body().is_none());
        let full = StaticDocument::parse("<!-- <html> --><html><body><p>x</p></body></html>");
        let tags: Vec<String> = full.all_elements().iter().map(|e| e.tag_lower()).collect();
        assert_eq!(tags, vec!["html", "body", "p"]);
    }
}
