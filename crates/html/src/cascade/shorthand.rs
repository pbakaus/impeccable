//! Shorthand expansion of the static cascade.
//!
//! JS: css-cascade.mjs#expandStaticBoxValues, #parseStaticBorder,
//! #parseStaticFont, #parseStaticTransition, #parseStaticAnimation,
//! #expandStaticDeclaration

use super::defaults::{is_static_inherited_prop, static_default_style};
use super::values::{css_prop_to_camel, extract_static_color, split_css_list, split_css_tokens};
use impeccable_core::js;
use once_cell::sync::Lazy;
use regex::Regex;

/// A `[prop, value]` pair as emitted by `expandStaticDeclaration`.
pub type Expanded = (String, String);

/// JS: css-cascade.mjs#expandStaticBoxValues(tokens)
pub fn expand_static_box_values(tokens: &[String]) -> [String; 4] {
    match tokens.len() {
        0 => ["0px".into(), "0px".into(), "0px".into(), "0px".into()],
        1 => [
            tokens[0].clone(),
            tokens[0].clone(),
            tokens[0].clone(),
            tokens[0].clone(),
        ],
        2 => [
            tokens[0].clone(),
            tokens[1].clone(),
            tokens[0].clone(),
            tokens[1].clone(),
        ],
        3 => [
            tokens[0].clone(),
            tokens[1].clone(),
            tokens[2].clone(),
            tokens[1].clone(),
        ],
        _ => [
            tokens[0].clone(),
            tokens[1].clone(),
            tokens[2].clone(),
            tokens[3].clone(),
        ],
    }
}

/// `{ width, color }` from `parseStaticBorder`.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct StaticBorder {
    pub width: String,
    pub color: String,
}

static BORDER_WIDTH_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^-?[0-9.]+(?:px|rem|em|%)$").expect("BORDER_WIDTH_RE"));

/// JS: css-cascade.mjs#parseStaticBorder(value)
pub fn parse_static_border(value: &str) -> StaticBorder {
    let mut out = StaticBorder::default();
    for token in split_css_tokens(value) {
        if out.width.is_empty() && BORDER_WIDTH_RE.is_match(&token) {
            out.width = token.clone();
        }
        if out.color.is_empty() {
            out.color = extract_static_color(&token);
        }
    }
    out
}

static FONT_SIZE_SLASH_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(&format!(
        r"(?:^|{ws})([0-9.]+(?:px|rem|em|%))(?:/([^{wsc}]+))?",
        ws = js::WS,
        wsc = js::WS_CHARS
    ))
    .expect("FONT_SIZE_SLASH_RE")
});
static ITALIC_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)(?-u:\b)italic(?-u:\b)").expect("ITALIC_RE"));
static FONT_WEIGHT_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)(?-u:\b)([1-9]00|bold|normal|lighter|bolder)(?-u:\b)").expect("FONT_WEIGHT_RE")
});

/// JS: css-cascade.mjs#parseStaticFont(value)
pub fn parse_static_font(value: &str) -> Vec<Expanded> {
    let mut out: Vec<Expanded> = Vec::new();
    let slash_parts = FONT_SIZE_SLASH_RE.captures(value);
    if ITALIC_RE.is_match(value) {
        out.push(("fontStyle".into(), "italic".into()));
    }
    if let Some(w) = FONT_WEIGHT_RE.captures(value) {
        out.push(("fontWeight".into(), w[1].to_string()));
    }
    if let Some(m) = slash_parts {
        out.push(("fontSize".into(), m[1].to_string()));
        if let Some(lh) = m.get(2) {
            if !lh.as_str().is_empty() {
                out.push(("lineHeight".into(), lh.as_str().to_string()));
            }
        }
        let whole = m.get(0).unwrap().as_str();
        // JS: value.indexOf(slashParts[0]) + slashParts[0].length
        let family_start = match value.find(whole) {
            Some(idx) => idx + whole.len(),
            // indexOf returned -1 in JS: -1 + length; unreachable since the
            // match text is a substring of value.
            None => whole.len().saturating_sub(1),
        };
        let family = js::trim(&value[family_start.min(value.len())..]);
        if !family.is_empty() {
            out.push(("fontFamily".into(), family.to_string()));
        }
    }
    out
}

/// `{ property, timing }` from `parseStaticTransition`.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct StaticTransition {
    pub property: String,
    pub timing: String,
}

/// `{ name, timing }` from `parseStaticAnimation`.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct StaticAnimation {
    pub name: String,
    pub timing: String,
}

static TIMING_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)^(?:ease|linear|step-|cubic-bezier\()").expect("TIMING_RE"));
static TRANSITION_PROP_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)^[a-z-]+$").expect("TRANSITION_PROP_RE"));
static TRANSITION_KEYWORD_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^(?:ease|linear|infinite|alternate|forwards|backwards|both|normal|none)$")
        .expect("TRANSITION_KEYWORD_RE")
});
static ENDS_WITH_S_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"s$").expect("ENDS_WITH_S_RE"));

/// JS: css-cascade.mjs#parseStaticTransition(value)
pub fn parse_static_transition(value: &str) -> StaticTransition {
    let mut props: Vec<String> = Vec::new();
    let mut timings: Vec<String> = Vec::new();
    for item in split_css_list(value) {
        let tokens = split_css_tokens(&item);
        if let Some(timing) = tokens.iter().find(|t| TIMING_RE.is_match(t)) {
            timings.push(timing.clone());
        }
        if let Some(prop) = tokens.iter().find(|t| {
            TRANSITION_PROP_RE.is_match(t)
                && !TRANSITION_KEYWORD_RE.is_match(t)
                && !ENDS_WITH_S_RE.is_match(t)
        }) {
            props.push(prop.clone());
        }
    }
    StaticTransition {
        property: props.join(", "),
        timing: timings.join(", "),
    }
}

static ANIMATION_NAME_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)^[a-z_-][0-9A-Za-z_-]*$").expect("ANIMATION_NAME_RE"));
static ANIMATION_KEYWORD_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"^(?:ease|linear|infinite|alternate|forwards|backwards|both|normal|none|running|paused)$",
    )
    .expect("ANIMATION_KEYWORD_RE")
});

/// JS: css-cascade.mjs#parseStaticAnimation(value)
pub fn parse_static_animation(value: &str) -> StaticAnimation {
    let mut names: Vec<String> = Vec::new();
    let mut timings: Vec<String> = Vec::new();
    for item in split_css_list(value) {
        let tokens = split_css_tokens(&item);
        if let Some(timing) = tokens.iter().find(|t| TIMING_RE.is_match(t)) {
            timings.push(timing.clone());
        }
        if let Some(name) = tokens
            .iter()
            .find(|t| ANIMATION_NAME_RE.is_match(t) && !ANIMATION_KEYWORD_RE.is_match(t))
        {
            names.push(name.clone());
        }
    }
    StaticAnimation {
        name: names.join(", "),
        timing: timings.join(", "),
    }
}

static BG_IMAGE_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)gradient|url\(").expect("BG_IMAGE_RE"));
static BG_IMAGE_SPLIT_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)(?:repeating-)?(?:linear|radial|conic)-gradient\(|url\(")
        .expect("BG_IMAGE_SPLIT_RE")
});
static VAR_ANYWHERE_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)var\(").expect("VAR_ANYWHERE_RE"));
static OUTLINE_STYLE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)^(none|hidden|solid|dashed|dotted|double|groove|ridge|inset|outset)$")
        .expect("OUTLINE_STYLE_RE")
});
static ZERO_LENGTH_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^0(?:px|rem|em|%)?$").expect("ZERO_LENGTH_RE"));
static BORDER_SIDE_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^border-(top|right|bottom|left)$").expect("BORDER_SIDE_RE"));

fn box4(names: [&str; 4], vals: [String; 4]) -> Vec<Expanded> {
    let [a, b, c, d] = vals;
    vec![
        (names[0].to_string(), a),
        (names[1].to_string(), b),
        (names[2].to_string(), c),
        (names[3].to_string(), d),
    ]
}

/// JS: css-cascade.mjs#expandStaticDeclaration(prop, value)
pub fn expand_static_declaration(prop: &str, value: &str) -> Vec<Expanded> {
    let p = js::to_lower_case(prop);
    let v = js::trim(value);
    if v.is_empty() {
        return Vec::new();
    }
    if p.starts_with("--") {
        return vec![(p, v.to_string())];
    }
    if p == "background" {
        let mut out: Vec<Expanded> = Vec::new();
        let has_image = BG_IMAGE_RE.is_match(v);
        if has_image {
            out.push(("backgroundImage".into(), v.to_string()));
        }
        let before_image: &str = if has_image {
            match BG_IMAGE_SPLIT_RE.find(v) {
                Some(m) => &v[..m.start()],
                None => v,
            }
        } else {
            v
        };
        let color = extract_static_color(if has_image { before_image } else { v });
        if !color.is_empty() {
            out.push(("backgroundColor".into(), color.clone()));
        }
        // The `background` shorthand resets every longhand it does not set.
        // Without this, `pre code { background: none }` leaves an earlier
        // `background: var(--surface)` color standing and the contrast checks
        // measure text against a surface the browser never paints. var() values
        // stay untouched: they may resolve to a color later in the pipeline.
        if color.is_empty() && !has_image && !VAR_ANYWHERE_RE.is_match(v) {
            out.push(("backgroundColor".into(), "rgba(0, 0, 0, 0)".into()));
            out.push(("backgroundImage".into(), "none".into()));
        }
        return out;
    }
    if p == "border" {
        let parsed = parse_static_border(v);
        let mut out: Vec<Expanded> = Vec::new();
        for side in ["Top", "Right", "Bottom", "Left"] {
            if !parsed.width.is_empty() {
                out.push((format!("border{}Width", side), parsed.width.clone()));
            }
            if !parsed.color.is_empty() {
                out.push((format!("border{}Color", side), parsed.color.clone()));
            }
        }
        return out;
    }
    if p == "outline" {
        // `outline` shorthand: width | style | color, in any order. Reuse the
        // border parser for width + color, then sniff a style keyword from the
        // tokens (solid|dashed|...). `outline: 0` (single-token zero) zeros
        // the width and effectively hides the outline.
        let tokens = split_css_tokens(v);
        let parsed = parse_static_border(v);
        let style_token = tokens.iter().find(|t| OUTLINE_STYLE_RE.is_match(t));
        let mut out: Vec<Expanded> = Vec::new();
        if !parsed.width.is_empty() {
            out.push(("outlineWidth".into(), parsed.width.clone()));
        }
        if !parsed.color.is_empty() {
            out.push(("outlineColor".into(), parsed.color.clone()));
        }
        if let Some(st) = style_token {
            out.push(("outlineStyle".into(), js::to_lower_case(st)));
        }
        // `outline: 0` with no other tokens: explicit zero width.
        if parsed.width.is_empty() && ZERO_LENGTH_RE.is_match(js::trim(v)) {
            out.push(("outlineWidth".into(), "0px".into()));
        }
        return out;
    }
    if let Some(m) = BORDER_SIDE_RE.captures(&p) {
        let parsed = parse_static_border(v);
        let raw_side = &m[1];
        let mut side = String::new();
        let mut chars = raw_side.chars();
        if let Some(first) = chars.next() {
            side.push_str(&first.to_uppercase().to_string());
            side.push_str(chars.as_str());
        }
        let mut out: Vec<Expanded> = Vec::new();
        if !parsed.width.is_empty() {
            out.push((format!("border{}Width", side), parsed.width.clone()));
        }
        if !parsed.color.is_empty() {
            out.push((format!("border{}Color", side), parsed.color.clone()));
        }
        return out;
    }
    if p == "border-width" {
        let vals = expand_static_box_values(&split_css_tokens(v));
        return box4(
            [
                "borderTopWidth",
                "borderRightWidth",
                "borderBottomWidth",
                "borderLeftWidth",
            ],
            vals,
        );
    }
    if p == "border-color" {
        let vals = expand_static_box_values(&split_css_tokens(v));
        return box4(
            [
                "borderTopColor",
                "borderRightColor",
                "borderBottomColor",
                "borderLeftColor",
            ],
            vals,
        );
    }
    if p == "padding" {
        let vals = expand_static_box_values(&split_css_tokens(v));
        return box4(
            ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"],
            vals,
        );
    }
    if p == "margin" {
        let vals = expand_static_box_values(&split_css_tokens(v));
        return box4(
            ["marginTop", "marginRight", "marginBottom", "marginLeft"],
            vals,
        );
    }
    if p == "font" {
        return parse_static_font(v);
    }
    if p == "transition" {
        let parsed = parse_static_transition(v);
        let mut out: Vec<Expanded> = Vec::new();
        if !parsed.property.is_empty() {
            out.push(("transitionProperty".into(), parsed.property));
        }
        if !parsed.timing.is_empty() {
            out.push(("transitionTimingFunction".into(), parsed.timing));
        }
        return out;
    }
    if p == "animation" {
        let parsed = parse_static_animation(v);
        let mut out: Vec<Expanded> = Vec::new();
        if !parsed.name.is_empty() {
            out.push(("animationName".into(), parsed.name));
        }
        if !parsed.timing.is_empty() {
            out.push(("animationTimingFunction".into(), parsed.timing));
        }
        return out;
    }
    let mapped = css_prop_to_camel(&p);
    if static_default_style(&mapped).is_some() || is_static_inherited_prop(&mapped) {
        return vec![(mapped, v.to_string())];
    }
    Vec::new()
}
