//! [`Dom`] implemented over the JS probe object the in-page bundle defines
//! (`browser-bundle/10-probe.js`, `const __impeccableDom = {...}`). Every
//! method is one imported function; element handles are indexes into the
//! probe's registry (0 = null). Selector errors come back as sentinels
//! (`u32::MAX`, or a first element of `u32::MAX` in arrays) because the probe
//! catches the DOM's SyntaxError and cannot throw across the boundary.

use impeccable_core::browser::dom::{Dom, ElId, KeyframeFrame, Rect, SelectorError};
use std::cell::RefCell;
use std::collections::HashMap;
use wasm_bindgen::prelude::*;

const ERR: u32 = u32::MAX;

#[wasm_bindgen(js_namespace = __impeccableDom)]
extern "C" {
    fn document_element() -> u32;
    fn body() -> u32;
    fn query_all(root: u32, selector: &str) -> Vec<u32>;
    fn query_one(root: u32, selector: &str) -> u32;
    fn inner_width() -> f64;
    fn inner_height() -> f64;
    fn scroll_x() -> f64;
    fn scroll_y() -> f64;
    fn hostname() -> String;
    fn element_from_point(x: f64, y: f64) -> u32;
    fn elements_from_point(x: f64, y: f64) -> Vec<u32>;
    fn css_escape(s: &str) -> String;
    fn keyframes(name: &str) -> Option<String>;
    fn document_html_for_patterns() -> String;
    fn linked_stylesheet_text() -> String;
    fn tag_name(el: u32) -> String;
    fn namespace_uri(el: u32) -> String;
    fn parent(el: u32) -> u32;
    fn children(el: u32) -> Vec<u32>;
    fn previous_element_sibling(el: u32) -> u32;
    fn next_element_sibling(el: u32) -> u32;
    fn contains(a: u32, b: u32) -> bool;
    fn matches(el: u32, selector: &str) -> u32;
    fn closest(el: u32, selector: &str) -> u32;
    fn attr(el: u32, name: &str) -> Option<String>;
    fn id_prop(el: u32) -> Option<String>;
    fn class_name_prop(el: u32) -> Option<String>;
    fn text_content(el: u32) -> String;
    fn inner_text(el: u32) -> Option<String>;
    fn direct_text_nodes(el: u32) -> Vec<String>;
    fn is_content_editable(el: u32) -> bool;
    fn hidden_prop(el: u32) -> bool;
    fn style(el: u32, prop: &str) -> String;
    fn pseudo_style(el: u32, pseudo: &str, prop: &str) -> Option<String>;
    fn rect(el: u32) -> Vec<f64>;
    fn client_width(el: u32) -> f64;
    fn client_height(el: u32) -> f64;
    fn client_left(el: u32) -> f64;
    fn scroll_width(el: u32) -> f64;
    fn scroll_left(el: u32) -> f64;
    fn offset_width(el: u32) -> f64;
    fn offset_height(el: u32) -> f64;
    fn check_visibility(el: u32) -> i32;
    fn direct_text_rect(el: u32) -> Vec<f64>;
}

fn opt(id: u32) -> Option<ElId> {
    if id == 0 {
        None
    } else {
        Some(id)
    }
}

fn to_rect(v: &[f64]) -> Rect {
    Rect {
        x: v[0],
        y: v[1],
        width: v[2],
        height: v[3],
        top: v[4],
        right: v[5],
        bottom: v[6],
        left: v[7],
    }
}

thread_local! {
    static STYLE_CACHE: RefCell<HashMap<ElId, HashMap<String, String>>> = RefCell::new(HashMap::new());
    static RECT_CACHE: RefCell<HashMap<ElId, Rect>> = RefCell::new(HashMap::new());
    static PARENT_CACHE: RefCell<HashMap<ElId, Option<ElId>>> = RefCell::new(HashMap::new());
    static TAG_CACHE: RefCell<HashMap<ElId, String>> = RefCell::new(HashMap::new());
    static ATTR_CACHE: RefCell<HashMap<ElId, HashMap<String, Option<String>>>> = RefCell::new(HashMap::new());
    static CLOSEST_CACHE: RefCell<HashMap<ElId, HashMap<String, Result<Option<ElId>, SelectorError>>>> = RefCell::new(HashMap::new());
    static CHILDREN_CACHE: RefCell<HashMap<ElId, Vec<ElId>>> = RefCell::new(HashMap::new());
    static TEXT_NODES_CACHE: RefCell<HashMap<ElId, Vec<String>>> = RefCell::new(HashMap::new());
}

/// The live-page DOM.
///
/// Every export constructs one with [`JsDom::fresh`], which drops the
/// per-call memo tables. Within one synchronous export nothing else runs on
/// the page (no page script, no layout-changing act of ours), so a computed
/// style, rect, parent, tag, attribute, `closest` answer, child list or text
/// node list read once holds for the rest of the call — and the rules read
/// the same facts many times over (every "is this rendered" walk re-reads
/// display/visibility/opacity up the ancestor chain). Memoizing them cuts
/// the wasm↔JS crossings, which dominate scan time, by roughly two thirds.
/// Across exports the tables are dropped: the visual-contrast path scrolls
/// between calls, and a later scan may follow DOM changes.
pub struct JsDom {
    _private: (),
}

impl JsDom {
    /// A DOM view with empty memo tables. Call at every export entry.
    pub fn fresh() -> JsDom {
        STYLE_CACHE.with(|c| c.borrow_mut().clear());
        RECT_CACHE.with(|c| c.borrow_mut().clear());
        PARENT_CACHE.with(|c| c.borrow_mut().clear());
        TAG_CACHE.with(|c| c.borrow_mut().clear());
        ATTR_CACHE.with(|c| c.borrow_mut().clear());
        CLOSEST_CACHE.with(|c| c.borrow_mut().clear());
        CHILDREN_CACHE.with(|c| c.borrow_mut().clear());
        TEXT_NODES_CACHE.with(|c| c.borrow_mut().clear());
        JsDom { _private: () }
    }
}

impl Dom for JsDom {
    fn document_element(&self) -> Option<ElId> {
        opt(document_element())
    }
    fn body(&self) -> Option<ElId> {
        opt(body())
    }
    fn query_all(&self, root: Option<ElId>, selector: &str) -> Result<Vec<ElId>, SelectorError> {
        let v = query_all(root.unwrap_or(0), selector);
        if v.first() == Some(&ERR) {
            return Err(SelectorError);
        }
        Ok(v)
    }
    fn query_one(&self, root: Option<ElId>, selector: &str) -> Result<Option<ElId>, SelectorError> {
        let v = query_one(root.unwrap_or(0), selector);
        if v == ERR {
            return Err(SelectorError);
        }
        Ok(opt(v))
    }
    fn inner_width(&self) -> f64 {
        inner_width()
    }
    fn inner_height(&self) -> f64 {
        inner_height()
    }
    fn scroll_x(&self) -> f64 {
        scroll_x()
    }
    fn scroll_y(&self) -> f64 {
        scroll_y()
    }
    fn hostname(&self) -> String {
        hostname()
    }
    fn element_from_point(&self, x: f64, y: f64) -> Option<ElId> {
        opt(element_from_point(x, y))
    }
    fn elements_from_point(&self, x: f64, y: f64) -> Vec<ElId> {
        elements_from_point(x, y)
    }
    fn css_escape(&self, s: &str) -> String {
        css_escape(s)
    }
    fn keyframes(&self, name: &str) -> Option<Vec<KeyframeFrame>> {
        let json = keyframes(name)?;
        let frames: Vec<Vec<(String, String)>> = serde_json::from_str(&json).ok()?;
        Some(
            frames
                .into_iter()
                .map(|decls| KeyframeFrame { decls })
                .collect(),
        )
    }
    fn linked_stylesheet_text(&self) -> String {
        linked_stylesheet_text()
    }
    fn document_html_for_patterns(&self) -> String {
        document_html_for_patterns()
    }
    fn tag_name(&self, el: ElId) -> String {
        TAG_CACHE.with(|c| {
            c.borrow_mut()
                .entry(el)
                .or_insert_with(|| tag_name(el))
                .clone()
        })
    }
    fn namespace_uri(&self, el: ElId) -> String {
        namespace_uri(el)
    }
    fn parent(&self, el: ElId) -> Option<ElId> {
        PARENT_CACHE.with(|c| *c.borrow_mut().entry(el).or_insert_with(|| opt(parent(el))))
    }
    fn children(&self, el: ElId) -> Vec<ElId> {
        CHILDREN_CACHE.with(|c| {
            c.borrow_mut()
                .entry(el)
                .or_insert_with(|| children(el))
                .clone()
        })
    }
    fn previous_element_sibling(&self, el: ElId) -> Option<ElId> {
        opt(previous_element_sibling(el))
    }
    fn next_element_sibling(&self, el: ElId) -> Option<ElId> {
        opt(next_element_sibling(el))
    }
    fn contains(&self, a: ElId, b: ElId) -> bool {
        contains(a, b)
    }
    fn matches(&self, el: ElId, selector: &str) -> Result<bool, SelectorError> {
        match matches(el, selector) {
            0 => Ok(false),
            1 => Ok(true),
            _ => Err(SelectorError),
        }
    }
    fn closest(&self, el: ElId, selector: &str) -> Result<Option<ElId>, SelectorError> {
        CLOSEST_CACHE.with(|c| {
            let mut c = c.borrow_mut();
            let per_el = c.entry(el).or_default();
            if let Some(hit) = per_el.get(selector) {
                return *hit;
            }
            let v = closest(el, selector);
            let out = if v == ERR {
                Err(SelectorError)
            } else {
                Ok(opt(v))
            };
            per_el.insert(selector.to_string(), out);
            out
        })
    }
    fn attr(&self, el: ElId, name: &str) -> Option<String> {
        ATTR_CACHE.with(|c| {
            let mut c = c.borrow_mut();
            let per_el = c.entry(el).or_default();
            if let Some(hit) = per_el.get(name) {
                return hit.clone();
            }
            let v = attr(el, name);
            per_el.insert(name.to_string(), v.clone());
            v
        })
    }
    fn id_prop(&self, el: ElId) -> Option<String> {
        id_prop(el)
    }
    fn class_name_prop(&self, el: ElId) -> Option<String> {
        class_name_prop(el)
    }
    fn text_content(&self, el: ElId) -> String {
        text_content(el)
    }
    fn inner_text(&self, el: ElId) -> Option<String> {
        inner_text(el)
    }
    fn direct_text_nodes(&self, el: ElId) -> Vec<String> {
        TEXT_NODES_CACHE.with(|c| {
            c.borrow_mut()
                .entry(el)
                .or_insert_with(|| direct_text_nodes(el))
                .clone()
        })
    }
    fn is_content_editable(&self, el: ElId) -> bool {
        is_content_editable(el)
    }
    fn hidden_prop(&self, el: ElId) -> bool {
        hidden_prop(el)
    }
    fn style(&self, el: ElId, prop: &str) -> String {
        STYLE_CACHE.with(|c| {
            let mut c = c.borrow_mut();
            let per_el = c.entry(el).or_default();
            if let Some(hit) = per_el.get(prop) {
                return hit.clone();
            }
            let v = style(el, prop);
            per_el.insert(prop.to_string(), v.clone());
            v
        })
    }
    fn pseudo_style(&self, el: ElId, pseudo: &str, prop: &str) -> Option<String> {
        pseudo_style(el, pseudo, prop)
    }
    fn rect(&self, el: ElId) -> Rect {
        RECT_CACHE.with(|c| {
            *c.borrow_mut().entry(el).or_insert_with(|| {
                let v = rect(el);
                if v.len() < 8 {
                    Rect::default()
                } else {
                    to_rect(&v)
                }
            })
        })
    }
    fn client_width(&self, el: ElId) -> f64 {
        client_width(el)
    }
    fn client_height(&self, el: ElId) -> f64 {
        client_height(el)
    }
    fn client_left(&self, el: ElId) -> f64 {
        client_left(el)
    }
    fn scroll_width(&self, el: ElId) -> f64 {
        scroll_width(el)
    }
    fn scroll_left(&self, el: ElId) -> f64 {
        scroll_left(el)
    }
    fn offset_width(&self, el: ElId) -> f64 {
        offset_width(el)
    }
    fn offset_height(&self, el: ElId) -> f64 {
        offset_height(el)
    }
    fn check_visibility(&self, el: ElId) -> Option<bool> {
        match check_visibility(el) {
            0 => Some(false),
            1 => Some(true),
            _ => None,
        }
    }
    fn direct_text_rect(&self, el: ElId) -> Option<Rect> {
        let v = direct_text_rect(el);
        if v.len() < 8 {
            None
        } else {
            Some(to_rect(&v))
        }
    }
}
