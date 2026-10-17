//! The static engine's reading of
//! [`impeccable_core::checks::decorative_text::DecorativeTextFacts`]. There
//! is no layout here, so a box's size is its declared `width` and `height`
//! in px (or an `svg`'s attributes), and "centred" is what the cascade can
//! say: `text-align: center`, a flex or grid box, a line box as tall as the
//! box, or an SVG `text-anchor: middle`. Anything else is not evidence, and
//! the finding keeps its severity.

use crate::background::{read_own_background_color, sv};
use crate::dom::StaticElement;
use impeccable_core::checks::decorative_text::{
    avatar_sized, classify_decorative_text, is_mockup_marker, is_signature_marker,
    DecorativeTextFacts, MOCKUP_MARKER_SKIP_TAGS,
};
use impeccable_core::color::{parse_any_color, parse_rgb};
use impeccable_core::js;

const CONTROL_TAGS: &[&str] = &["a", "button", "label", "summary", "select", "option"];
const CONTROL_ROLES: &[&str] = &[
    "button", "link", "tab", "menuitem", "option", "checkbox", "radio", "switch",
];

fn collapsed_text(el: &StaticElement<'_>) -> String {
    js::trim(&el.text_content())
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn role_is(el: &StaticElement<'_>, roles: &[&str]) -> bool {
    el.get_attribute("role")
        .map(|r| js::to_lower_case(js::trim(r)))
        .is_some_and(|r| roles.contains(&r.as_str()))
}

fn ancestors_inclusive<'a>(el: &StaticElement<'a>) -> impl Iterator<Item = StaticElement<'a>> {
    std::iter::successors(Some(*el), |e| e.parent_element())
}

/// A declared length in px, or `None` when it is not one.
fn px(value: &str) -> Option<f64> {
    let v = js::trim(value);
    let n = v.strip_suffix("px")?;
    let n = js::parse_float(n);
    n.is_finite().then_some(n)
}

fn box_size(el: &StaticElement<'_>) -> Option<(f64, f64)> {
    let style = el.style();
    let w = px(sv(style, "width")).or_else(|| {
        (el.tag_lower() == "svg").then(|| el.get_attribute("width").and_then(|w| {
            let n = js::parse_float(w.trim_end_matches("px"));
            n.is_finite().then_some(n)
        }))?
    })?;
    let h = px(sv(style, "height")).or_else(|| {
        (el.tag_lower() == "svg").then(|| el.get_attribute("height").and_then(|h| {
            let n = js::parse_float(h.trim_end_matches("px"));
            n.is_finite().then_some(n)
        }))?
    })?;
    Some((w, h))
}

fn box_paints(el: &StaticElement<'_>) -> bool {
    if el.tag_lower() == "svg" {
        return true;
    }
    let style = el.style();
    if read_own_background_color(el, style).is_some_and(|c| c.alpha_or_one() > 0.1) {
        return true;
    }
    let image = sv(style, "backgroundImage");
    if !image.is_empty() && image != "none" {
        return true;
    }
    ["Top", "Right", "Bottom", "Left"].iter().all(|side| {
        px(sv(style, &format!("border{side}Width"))).is_some_and(|w| w > 0.0) && {
            let c = sv(style, &format!("border{side}Color"));
            parse_rgb(Some(c))
                .or_else(|| parse_any_color(Some(c)))
                .is_some_and(|c| c.alpha_or_one() > 0.1)
        }
    })
}

/// What the cascade can say about text sitting centred in `host`.
fn centred(host: &StaticElement<'_>, el: &StaticElement<'_>, height: f64) -> bool {
    let style = host.style();
    let display = sv(style, "display");
    // A flex or grid box centres its text only when it says so on both axes:
    // `justify-content: flex-start` or `align-items: flex-start` leaves an
    // initial in a corner of the painted box.
    // One alignment keyword per axis. `place-items: var(--x)` reaches both
    // longhands whole, so a two-value result (`center stretch`) is read as
    // its first value for align-items and its last for justify-items;
    // `safe` and `unsafe` only qualify the keyword after them.
    let is_center = |prop: &str| {
        let value = js::to_lower_case(sv(style, prop));
        let tokens: Vec<&str> = value.split_whitespace().filter(|t| *t != "safe" && *t != "unsafe").collect();
        let token = if prop == "alignItems" { tokens.first() } else { tokens.last() };
        token == Some(&"center")
    };
    if matches!(display, "flex" | "inline-flex") && is_center("justifyContent") && is_center("alignItems") {
        return true;
    }
    if matches!(display, "grid" | "inline-grid")
        && is_center("alignItems")
        && (is_center("justifyItems") || is_center("justifyContent"))
    {
        return true;
    }
    if sv(el.style(), "textAlign") == "center" || sv(style, "textAlign") == "center" {
        return true;
    }
    if px(sv(style, "lineHeight")).is_some_and(|lh| (lh - height).abs() <= 1.0) {
        return true;
    }
    host.tag_lower() == "svg"
        && el
            .get_attribute("text-anchor")
            .is_some_and(|a| js::trim(a).eq_ignore_ascii_case("middle"))
}

fn in_avatar_box(el: &StaticElement<'_>, text: &str) -> bool {
    for b in ancestors_inclusive(el).take(3) {
        if collapsed_text(&b) != text {
            break;
        }
        if let Some((w, h)) = box_size(&b) {
            if avatar_sized(w, h) && box_paints(&b) && centred(&b, el, h) {
                return true;
            }
        }
    }
    false
}

/// `(picture, marked)`: an HTML ancestor is `role="img"`, or an ancestor's
/// class or id names a mockup. A `figcaption` on the way up ends both.
fn marked_mockup(el: &StaticElement<'_>) -> (bool, bool) {
    // `role="img"` names an HTML subtree drawn as a picture; on or inside an
    // `svg` it labels a chart, a logo or an icon, whose text is read.
    let mut in_svg = ancestors_inclusive(el).any(|c| c.tag_lower() == "svg");
    for c in ancestors_inclusive(el) {
        let tag = c.tag_lower();
        if tag == "figcaption" {
            return (false, false);
        }
        if !in_svg && role_is(&c, &["img"]) {
            return (true, false);
        }
        if tag == "svg" {
            in_svg = false;
        }
        if !MOCKUP_MARKER_SKIP_TAGS.contains(&tag.as_str())
            && (is_mockup_marker(c.class_name()) || is_mockup_marker(c.id_attr()))
        {
            return (false, true);
        }
    }
    (false, false)
}

/// Whether a box sits in a drawn product mockup: under an HTML `role="img"`
/// outside any `svg`, or in or itself a framed demo by its structure. The static twin
/// of [`impeccable_core::browser::decorative_text::box_in_mockup_dom`], for
/// `nested-cards` (decision r6-t3-nested-cards-mockups); a mockup class or id
/// is not read there either.
pub fn box_in_mockup(el: &StaticElement<'_>) -> bool {
    let mut in_svg = ancestors_inclusive(el).any(|c| c.tag_lower() == "svg");
    for c in ancestors_inclusive(el) {
        let tag = c.tag_lower();
        if tag == "figcaption" {
            break;
        }
        if !in_svg && role_is(&c, &["img"]) {
            return true;
        }
        if tag == "svg" {
            in_svg = false;
        }
    }
    crate::text_context::in_framed_demo(el) || crate::text_context::is_demo_frame(el)
}

/// What the static document says about one element's text.
pub fn decorative_text_facts(el: &StaticElement<'_>) -> DecorativeTextFacts {
    let text = collapsed_text(el);
    let control = ancestors_inclusive(el)
        .find(|c| CONTROL_TAGS.contains(&c.tag_lower().as_str()) || role_is(c, CONTROL_ROLES));
    let in_heading = ancestors_inclusive(el).any(|c| {
        matches!(c.tag_lower().as_str(), "h1" | "h2" | "h3" | "h4" | "h5" | "h6")
            || role_is(&c, &["heading"])
    });
    let signature_marked = ancestors_inclusive(el)
        .take(2)
        .any(|c| is_signature_marker(c.class_name()) || is_signature_marker(c.id_attr()));
    let (picture_ancestor, mockup_ancestor) = marked_mockup(el);
    DecorativeTextFacts {
        avatar_box: !text.is_empty() && text.chars().count() <= 3 && in_avatar_box(el, &text),
        in_kbd: ancestors_inclusive(el).any(|c| c.tag_lower() == "kbd"),
        font_family: sv(el.style(), "fontFamily").to_string(),
        in_heading,
        control_label: control.as_ref().is_some_and(|c| collapsed_text(c) == text),
        in_control: control.is_some(),
        signature_marked,
        mockup_ancestor,
        picture_ancestor,
        framed_demo: crate::text_context::in_framed_demo(el),
        text,
        // The static engine reads no layout, so the ghost-wordmark shape,
        // which needs the type's rendered size and opacity, never applies.
        ..Default::default()
    }
}

/// Whether one element's text has no reading job.
pub fn is_decorative_text(el: &StaticElement<'_>) -> bool {
    classify_decorative_text(&decorative_text_facts(el)).is_some()
}
