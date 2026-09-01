//! A table-driven in-memory [`Dom`] for unit tests. Not a browser: it holds
//! exactly the facts a test declares (tags, attributes, computed-style
//! values, rects, text nodes) and answers selector queries from a per-element
//! list of selectors the test says match, plus the trivial cases (`*`, a bare
//! tag name, comma lists of those). Its job is to pin thresholds and snippet
//! formats; byte parity is proven by the A/B differential against Chrome.

use super::dom::{Dom, ElId, KeyframeFrame, Rect, SelectorError};
use std::collections::HashMap;

#[derive(Debug, Clone)]
pub enum FakeNode {
    Text(String),
    El(ElId),
}

#[derive(Debug, Clone, Default)]
pub struct FakeEl {
    pub tag: String,
    pub ns: String,
    pub attrs: Vec<(String, String)>,
    pub styles: HashMap<String, String>,
    pub pseudo_styles: HashMap<(String, String), String>,
    pub rect: Rect,
    pub child_nodes: Vec<FakeNode>,
    pub parent: Option<ElId>,
    pub client_width: f64,
    pub client_height: f64,
    pub client_left: f64,
    pub scroll_width: f64,
    pub scroll_left: f64,
    pub offset_width: f64,
    pub offset_height: f64,
    pub is_content_editable: bool,
    pub hidden: bool,
    pub check_visibility: Option<bool>,
    pub direct_text_rect: Option<Rect>,
    /// Selectors (exact strings) this element matches beyond `*` and its tag.
    pub selectors: Vec<String>,
    /// `id` IDL property override (`None` = "not a string", falls back to attr).
    pub id_prop_is_string: bool,
    /// `className` IDL property is a string (false for SVG).
    pub class_name_is_string: bool,
    /// `innerText` override.
    pub inner_text: Option<String>,
}

#[derive(Debug, Default)]
pub struct FakeDom {
    pub els: Vec<FakeEl>,
    pub document_element: Option<ElId>,
    pub body: Option<ElId>,
    pub inner_width: f64,
    pub inner_height: f64,
    pub scroll_x: f64,
    pub scroll_y: f64,
    pub hostname: String,
    /// `(x, y)` → element stack, topmost first.
    pub points: Vec<((f64, f64), Vec<ElId>)>,
    pub keyframes: HashMap<String, Vec<KeyframeFrame>>,
    pub html_for_patterns: String,
}

impl FakeDom {
    pub fn new() -> Self {
        FakeDom {
            // index 0 is never an element
            els: vec![FakeEl::default()],
            inner_width: 1280.0,
            inner_height: 800.0,
            ..Default::default()
        }
    }

    /// Add an element under `parent` (`None` for the root). Returns its id.
    /// A real browser defines every computed property; the fake starts with
    /// the few the "is this rendered" walks read (`opacity: 1`,
    /// `visibility: visible`, `display: block`) so a test only declares what
    /// it is about.
    pub fn add(&mut self, parent: Option<ElId>, tag: &str) -> ElId {
        let id = self.els.len() as ElId;
        let mut styles = HashMap::new();
        styles.insert("opacity".to_string(), "1".to_string());
        styles.insert("visibility".to_string(), "visible".to_string());
        styles.insert("display".to_string(), "block".to_string());
        self.els.push(FakeEl {
            styles,
            tag: tag.to_string(),
            ns: if tag == "svg" || tag == "text" || tag == "path" || tag == "rect" {
                "http://www.w3.org/2000/svg".to_string()
            } else {
                "http://www.w3.org/1999/xhtml".to_string()
            },
            parent,
            id_prop_is_string: true,
            class_name_is_string: true,
            ..Default::default()
        });
        if let Some(p) = parent {
            self.els[p as usize].child_nodes.push(FakeNode::El(id));
        }
        if tag == "html" && self.document_element.is_none() {
            self.document_element = Some(id);
        }
        if tag == "body" && self.body.is_none() {
            self.body = Some(id);
        }
        id
    }

    /// Add a root `<html><body>` pair and return `(html, body)`.
    pub fn with_page(&mut self) -> (ElId, ElId) {
        let html = self.add(None, "html");
        let body = self.add(Some(html), "body");
        (html, body)
    }

    pub fn el_mut(&mut self, id: ElId) -> &mut FakeEl {
        &mut self.els[id as usize]
    }
    pub fn el(&self, id: ElId) -> &FakeEl {
        &self.els[id as usize]
    }
    pub fn set_style(&mut self, id: ElId, prop: &str, value: &str) -> &mut Self {
        self.el_mut(id)
            .styles
            .insert(prop.to_string(), value.to_string());
        self
    }
    pub fn set_styles(&mut self, id: ElId, pairs: &[(&str, &str)]) -> &mut Self {
        for (p, v) in pairs {
            self.set_style(id, p, v);
        }
        self
    }
    pub fn set_pseudo_style(
        &mut self,
        id: ElId,
        pseudo: &str,
        prop: &str,
        value: &str,
    ) -> &mut Self {
        self.el_mut(id)
            .pseudo_styles
            .insert((pseudo.to_string(), prop.to_string()), value.to_string());
        self
    }
    pub fn set_attr(&mut self, id: ElId, name: &str, value: &str) -> &mut Self {
        let el = self.el_mut(id);
        if let Some(slot) = el.attrs.iter_mut().find(|(n, _)| n == name) {
            slot.1 = value.to_string();
        } else {
            el.attrs.push((name.to_string(), value.to_string()));
        }
        self
    }
    pub fn set_rect(&mut self, id: ElId, x: f64, y: f64, w: f64, h: f64) -> &mut Self {
        self.el_mut(id).rect = Rect::from_xywh(x, y, w, h);
        self
    }
    pub fn add_text(&mut self, id: ElId, text: &str) -> &mut Self {
        self.el_mut(id)
            .child_nodes
            .push(FakeNode::Text(text.to_string()));
        self
    }
    /// Declare that `id` matches `selector` (exact string) for `matches` /
    /// `closest` / `query_all`.
    pub fn add_selector(&mut self, id: ElId, selector: &str) -> &mut Self {
        self.el_mut(id).selectors.push(selector.to_string());
        self
    }
    pub fn set_point(&mut self, x: f64, y: f64, stack: Vec<ElId>) -> &mut Self {
        self.points.push(((x, y), stack));
        self
    }

    fn all_in_order(&self, root: Option<ElId>) -> Vec<ElId> {
        let mut out = Vec::new();
        let roots: Vec<ElId> = match root {
            Some(r) => self.child_elements(r),
            None => (1..self.els.len() as ElId)
                .filter(|&i| self.els[i as usize].parent.is_none())
                .collect(),
        };
        fn walk(dom: &FakeDom, el: ElId, out: &mut Vec<ElId>) {
            out.push(el);
            for c in dom.child_elements(el) {
                walk(dom, c, out);
            }
        }
        for r in roots {
            walk(self, r, &mut out);
        }
        out
    }

    fn child_elements(&self, el: ElId) -> Vec<ElId> {
        self.els[el as usize]
            .child_nodes
            .iter()
            .filter_map(|n| match n {
                FakeNode::El(id) => Some(*id),
                _ => None,
            })
            .collect()
    }

    fn matches_one(&self, el: ElId, token: &str) -> bool {
        let token = token.trim();
        if token == "*" {
            return true;
        }
        let e = &self.els[el as usize];
        if token.eq_ignore_ascii_case(&e.tag) {
            return true;
        }
        e.selectors.iter().any(|s| s == token)
    }

    fn matches_sel(&self, el: ElId, selector: &str) -> bool {
        // Whole-string match first (tests may declare the full list), then
        // top-level comma split.
        if self.els[el as usize]
            .selectors
            .iter()
            .any(|s| s == selector)
        {
            return true;
        }
        split_top_level_commas(selector)
            .iter()
            .any(|t| self.matches_one(el, t))
    }

    fn text_content_of(&self, el: ElId, out: &mut String) {
        for n in &self.els[el as usize].child_nodes {
            match n {
                FakeNode::Text(t) => out.push_str(t),
                FakeNode::El(id) => self.text_content_of(*id, out),
            }
        }
    }
}

fn split_top_level_commas(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut depth = 0i32;
    let mut cur = String::new();
    for ch in s.chars() {
        match ch {
            '(' | '[' => {
                depth += 1;
                cur.push(ch);
            }
            ')' | ']' => {
                depth -= 1;
                cur.push(ch);
            }
            ',' if depth == 0 => {
                out.push(cur.trim().to_string());
                cur.clear();
            }
            _ => cur.push(ch),
        }
    }
    if !cur.trim().is_empty() {
        out.push(cur.trim().to_string());
    }
    out
}

impl Dom for FakeDom {
    fn document_element(&self) -> Option<ElId> {
        self.document_element
    }
    fn body(&self) -> Option<ElId> {
        self.body
    }
    fn query_all(&self, root: Option<ElId>, selector: &str) -> Result<Vec<ElId>, SelectorError> {
        if selector.contains("!!") {
            return Err(SelectorError);
        }
        Ok(self
            .all_in_order(root)
            .into_iter()
            .filter(|&e| self.matches_sel(e, selector))
            .collect())
    }
    fn query_one(&self, root: Option<ElId>, selector: &str) -> Result<Option<ElId>, SelectorError> {
        Ok(self.query_all(root, selector)?.into_iter().next())
    }
    fn inner_width(&self) -> f64 {
        self.inner_width
    }
    fn inner_height(&self) -> f64 {
        self.inner_height
    }
    fn scroll_x(&self) -> f64 {
        self.scroll_x
    }
    fn scroll_y(&self) -> f64 {
        self.scroll_y
    }
    fn hostname(&self) -> String {
        self.hostname.clone()
    }
    fn element_from_point(&self, x: f64, y: f64) -> Option<ElId> {
        self.elements_from_point(x, y).into_iter().next()
    }
    fn elements_from_point(&self, x: f64, y: f64) -> Vec<ElId> {
        // nearest declared point within 0.5px, else the deepest element whose
        // rect contains the point (last in document order wins as "topmost").
        for ((px, py), stack) in &self.points {
            if (px - x).abs() < 0.5 && (py - y).abs() < 0.5 {
                return stack.clone();
            }
        }
        let mut hits: Vec<ElId> = self
            .all_in_order(None)
            .into_iter()
            .filter(|&e| {
                let r = self.els[e as usize].rect;
                r.width > 0.0
                    && r.height > 0.0
                    && x >= r.left
                    && x <= r.right
                    && y >= r.top
                    && y <= r.bottom
            })
            .collect();
        hits.reverse();
        hits
    }
    fn css_escape(&self, s: &str) -> String {
        s.to_string()
    }
    fn keyframes(&self, name: &str) -> Option<Vec<KeyframeFrame>> {
        self.keyframes.get(name).cloned()
    }
    fn document_html_for_patterns(&self) -> String {
        self.html_for_patterns.clone()
    }
    fn tag_name(&self, el: ElId) -> String {
        let e = &self.els[el as usize];
        if e.ns == "http://www.w3.org/1999/xhtml" {
            e.tag.to_ascii_uppercase()
        } else {
            e.tag.clone()
        }
    }
    fn namespace_uri(&self, el: ElId) -> String {
        self.els[el as usize].ns.clone()
    }
    fn parent(&self, el: ElId) -> Option<ElId> {
        self.els[el as usize].parent
    }
    fn children(&self, el: ElId) -> Vec<ElId> {
        self.child_elements(el)
    }
    fn previous_element_sibling(&self, el: ElId) -> Option<ElId> {
        let p = self.els[el as usize].parent?;
        let sibs = self.child_elements(p);
        let i = sibs.iter().position(|&s| s == el)?;
        if i == 0 {
            None
        } else {
            Some(sibs[i - 1])
        }
    }
    fn next_element_sibling(&self, el: ElId) -> Option<ElId> {
        let p = self.els[el as usize].parent?;
        let sibs = self.child_elements(p);
        let i = sibs.iter().position(|&s| s == el)?;
        sibs.get(i + 1).copied()
    }
    fn contains(&self, a: ElId, b: ElId) -> bool {
        let mut cur = Some(b);
        while let Some(c) = cur {
            if c == a {
                return true;
            }
            cur = self.els[c as usize].parent;
        }
        false
    }
    fn matches(&self, el: ElId, selector: &str) -> Result<bool, SelectorError> {
        if selector.contains("!!") {
            return Err(SelectorError);
        }
        Ok(self.matches_sel(el, selector))
    }
    fn closest(&self, el: ElId, selector: &str) -> Result<Option<ElId>, SelectorError> {
        if selector.contains("!!") {
            return Err(SelectorError);
        }
        let mut cur = Some(el);
        while let Some(c) = cur {
            if self.matches_sel(c, selector) {
                return Ok(Some(c));
            }
            cur = self.els[c as usize].parent;
        }
        Ok(None)
    }
    fn attr(&self, el: ElId, name: &str) -> Option<String> {
        self.els[el as usize]
            .attrs
            .iter()
            .find(|(n, _)| n == name)
            .map(|(_, v)| v.clone())
    }
    fn id_prop(&self, el: ElId) -> Option<String> {
        if self.els[el as usize].id_prop_is_string {
            Some(self.attr(el, "id").unwrap_or_default())
        } else {
            None
        }
    }
    fn class_name_prop(&self, el: ElId) -> Option<String> {
        if self.els[el as usize].class_name_is_string {
            Some(self.attr(el, "class").unwrap_or_default())
        } else {
            None
        }
    }
    fn text_content(&self, el: ElId) -> String {
        let mut s = String::new();
        self.text_content_of(el, &mut s);
        s
    }
    fn inner_text(&self, el: ElId) -> Option<String> {
        self.els[el as usize].inner_text.clone()
    }
    fn direct_text_nodes(&self, el: ElId) -> Vec<String> {
        self.els[el as usize]
            .child_nodes
            .iter()
            .filter_map(|n| match n {
                FakeNode::Text(t) => Some(t.clone()),
                _ => None,
            })
            .collect()
    }
    fn is_content_editable(&self, el: ElId) -> bool {
        self.els[el as usize].is_content_editable
    }
    fn hidden_prop(&self, el: ElId) -> bool {
        self.els[el as usize].hidden
    }
    fn style(&self, el: ElId, prop: &str) -> String {
        self.els[el as usize]
            .styles
            .get(prop)
            .cloned()
            .unwrap_or_default()
    }
    fn pseudo_style(&self, el: ElId, pseudo: &str, prop: &str) -> Option<String> {
        let e = &self.els[el as usize];
        // A pseudo with no declared props at all reads as `content: none`
        // (the JS `!ps || ps.content === 'none'` guard).
        if !e.pseudo_styles.keys().any(|(p, _)| p == pseudo) {
            return Some(if prop == "content" {
                "none".to_string()
            } else {
                String::new()
            });
        }
        Some(
            e.pseudo_styles
                .get(&(pseudo.to_string(), prop.to_string()))
                .cloned()
                .unwrap_or_default(),
        )
    }
    fn rect(&self, el: ElId) -> Rect {
        self.els[el as usize].rect
    }
    fn client_width(&self, el: ElId) -> f64 {
        self.els[el as usize].client_width
    }
    fn client_height(&self, el: ElId) -> f64 {
        self.els[el as usize].client_height
    }
    fn client_left(&self, el: ElId) -> f64 {
        self.els[el as usize].client_left
    }
    fn scroll_width(&self, el: ElId) -> f64 {
        self.els[el as usize].scroll_width
    }
    fn scroll_left(&self, el: ElId) -> f64 {
        self.els[el as usize].scroll_left
    }
    fn offset_width(&self, el: ElId) -> f64 {
        self.els[el as usize].offset_width
    }
    fn offset_height(&self, el: ElId) -> f64 {
        self.els[el as usize].offset_height
    }
    fn check_visibility(&self, el: ElId) -> Option<bool> {
        self.els[el as usize].check_visibility
    }
    fn direct_text_rect(&self, el: ElId) -> Option<Rect> {
        self.els[el as usize].direct_text_rect
    }
}
