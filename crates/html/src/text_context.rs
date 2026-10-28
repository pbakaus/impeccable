//! The static engine's [`ContextNode`]: how the context predicates of
//! [`impeccable_core::checks::text_context`] read a parsed document.
//!
//! There is no layout here, so there is no `rect`: every test that needs one
//! (a label drawn over a plot, labels lined up along an axis, a title bar's
//! place in its window) answers no, and the finding keeps its severity. A
//! box's `size` is its declared `width` and `height` in px. The cascade does
//! not carry `transform` or `scale`, so those are read from the element's
//! inline `style` only; a device frame transformed by a stylesheet rule is
//! not seen.

use std::hash::{Hash, Hasher};

use crate::background::sv;
use crate::dom::StaticElement;
use crate::quality::resolve_font_size_px;
use impeccable_core::checks::decorative_text::{classify_decorative_text, DecorativeShape};
use impeccable_core::checks::text_context::{self, ContextNode};
use impeccable_core::js;

#[derive(Clone, Copy)]
pub struct StaticNode<'a>(pub StaticElement<'a>);

fn px(value: &str) -> Option<f64> {
    let n = js::parse_float(js::trim(value).strip_suffix("px")?);
    n.is_finite().then_some(n)
}

/// One property of an inline `style` attribute, by its hyphenated name.
fn inline_declaration(el: &StaticElement<'_>, name: &str) -> String {
    let Some(style) = el.get_attribute("style") else { return String::new() };
    style
        .split(';')
        .filter_map(|decl| decl.split_once(':'))
        .filter(|(prop, _)| prop.trim().eq_ignore_ascii_case(name))
        .map(|(_, value)| value.trim().trim_end_matches("!important").trim().to_string())
        .next_back()
        .unwrap_or_default()
}

impl ContextNode for StaticNode<'_> {
    fn key(&self) -> u64 {
        let mut h = std::collections::hash_map::DefaultHasher::new();
        self.0.id().hash(&mut h);
        h.finish()
    }
    fn tag(&self) -> String {
        self.0.tag_lower()
    }
    fn class_list(&self) -> String {
        self.0.class_name().to_string()
    }
    fn id_attr(&self) -> String {
        self.0.id_attr().to_string()
    }
    fn attr(&self, name: &str) -> Option<String> {
        self.0.get_attribute(name).map(str::to_string)
    }
    fn parent(&self) -> Option<Self> {
        self.0.parent_element().map(StaticNode)
    }
    fn children(&self) -> Vec<Self> {
        self.0.children().into_iter().map(StaticNode).collect()
    }
    fn text(&self) -> String {
        self.0.text_content()
    }
    fn direct_text(&self) -> String {
        self.0.direct_text()
    }
    fn style(&self, prop: &str) -> String {
        match prop {
            "transform" | "scale" | "rotate" => inline_declaration(&self.0, prop),
            _ => sv(self.0.style(), prop).to_string(),
        }
    }
    // An unresolved var() font size is unknown; 0 is how the browser node
    // reports a size it cannot read, and every caller guards on `> 0`.
    fn font_size(&self) -> f64 {
        resolve_font_size_px(&self.0).unwrap_or(0.0)
    }
    fn rect(&self) -> Option<(f64, f64, f64, f64)> {
        None
    }
    fn size(&self) -> Option<(f64, f64)> {
        let style = self.0.style();
        Some((px(sv(style, "width"))?, px(sv(style, "height"))?))
    }
}

/// Whether the element's text sits in a framed HTML demo, by structure.
pub fn in_framed_demo(el: &StaticElement<'_>) -> bool {
    text_context::in_framed_demo(&StaticNode(*el))
}

/// Whether the element is itself a framed HTML demo, by structure.
pub fn is_demo_frame(el: &StaticElement<'_>) -> bool {
    text_context::is_demo_frame(&StaticNode(*el))
}

/// Whether the element's text sits in mock context: an illustration mockup
/// by its marker, its `role="img"` or its structure.
pub fn in_mock_context(el: &StaticElement<'_>) -> bool {
    classify_decorative_text(&crate::decorative_text::decorative_text_facts(el))
        == Some(DecorativeShape::Mockup)
}

/// Whether the element's text is legal fine print.
pub fn is_fine_print(el: &StaticElement<'_>) -> bool {
    text_context::is_fine_print(&StaticNode(*el))
}

/// Which tier of legal fine print the element's text is in.
pub fn fine_print(el: &StaticElement<'_>) -> text_context::FinePrint {
    text_context::fine_print(&StaticNode(*el))
}

/// Whether the element's text is a label with no reading job.
pub fn is_micro_label(el: &StaticElement<'_>) -> bool {
    text_context::is_micro_label(&StaticNode(*el))
}
