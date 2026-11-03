//! The browser engines' [`ContextNode`]: how the context predicates of
//! [`crate::checks::text_context`] read a `Dom` probe. It only measures; the
//! decisions are made there.

use super::dom::{class_attr, tag_lower, Dom, ElId};
use crate::checks::decorative_text::{classify_decorative_text, DecorativeShape};
use crate::checks::text_context::{self, ContextNode};
use crate::js;

/// One element of a `Dom`, as the context predicates read it.
#[derive(Clone, Copy)]
pub struct DomNode<'a> {
    pub dom: &'a dyn Dom,
    pub el: ElId,
}

impl<'a> DomNode<'a> {
    pub fn new(dom: &'a dyn Dom, el: ElId) -> Self {
        DomNode { dom, el }
    }
}

/// Properties whose running animation or transition makes the transform
/// read off an element a frame of a motion, not a resting state.
const TRANSFORM_PROPS: &[&str] = &["transform", "scale", "rotate", "translate"];

impl ContextNode for DomNode<'_> {
    fn key(&self) -> u64 {
        u64::from(self.el)
    }
    fn tag(&self) -> String {
        tag_lower(self.dom, self.el)
    }
    fn class_list(&self) -> String {
        class_attr(self.dom, self.el)
    }
    fn id_attr(&self) -> String {
        self.dom.attr(self.el, "id").unwrap_or_default()
    }
    fn attr(&self, name: &str) -> Option<String> {
        self.dom.attr(self.el, name)
    }
    fn parent(&self) -> Option<Self> {
        self.dom.parent(self.el).map(|el| DomNode { dom: self.dom, el })
    }
    fn children(&self) -> Vec<Self> {
        self.dom.children(self.el).into_iter().map(|el| DomNode { dom: self.dom, el }).collect()
    }
    fn text(&self) -> String {
        self.dom.text_content(self.el)
    }
    fn direct_text(&self) -> String {
        self.dom.direct_text_nodes(self.el).join(" ")
    }
    fn style(&self, prop: &str) -> String {
        self.dom.style(self.el, prop)
    }
    fn font_size(&self) -> f64 {
        let n = js::parse_float(&self.dom.style(self.el, "fontSize"));
        if n.is_finite() {
            n
        } else {
            0.0
        }
    }
    fn rect(&self) -> Option<(f64, f64, f64, f64)> {
        let r = self.dom.rect(self.el);
        Some((r.left, r.top, r.width, r.height))
    }
    fn transform_running(&self) -> bool {
        self.dom
            .running_animation_properties(self.el)
            .is_some_and(|props| props.iter().any(|p| TRANSFORM_PROPS.contains(&p.as_str())))
    }
}

/// Whether the element's text sits in a framed HTML demo, by structure.
pub fn in_framed_demo_dom(dom: &dyn Dom, el: ElId) -> bool {
    text_context::in_framed_demo(&DomNode::new(dom, el))
}

/// Whether the element is itself a framed HTML demo, by structure.
pub fn is_demo_frame_dom(dom: &dyn Dom, el: ElId) -> bool {
    text_context::is_demo_frame(&DomNode::new(dom, el))
}

/// Whether the element's text sits in mock context: an illustration mockup
/// by its marker, its `role="img"` or its structure.
pub fn in_mock_context_dom(dom: &dyn Dom, el: ElId) -> bool {
    classify_decorative_text(&super::decorative_text::decorative_text_facts_dom(dom, el))
        == Some(DecorativeShape::Mockup)
}

/// Whether the element's text is legal fine print.
pub fn is_fine_print_dom(dom: &dyn Dom, el: ElId) -> bool {
    text_context::is_fine_print(&DomNode::new(dom, el))
}

/// Which tier of legal fine print the element's text is in.
pub fn fine_print_dom(dom: &dyn Dom, el: ElId) -> text_context::FinePrint {
    text_context::fine_print(&DomNode::new(dom, el))
}

/// Whether the element's text is a label with no reading job.
pub fn is_micro_label_dom(dom: &dyn Dom, el: ElId) -> bool {
    text_context::is_micro_label(&DomNode::new(dom, el))
}
