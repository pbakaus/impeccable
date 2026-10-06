//! Shorthand expansion of the static cascade.
//!
//! JS: css-cascade.mjs#expandStaticBoxValues, #parseStaticBorder,
//! #parseStaticFont, #parseStaticTransition, #parseStaticAnimation,
//! #expandStaticDeclaration

use super::defaults::{is_static_inherited_prop, static_default_style};
use super::values::{
    css_call_end, css_prop_to_camel, extract_static_color, split_css_list, split_css_tokens,
};
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

static BG_REPEAT_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)^(?:repeat|no-repeat|repeat-x|repeat-y|space|round)$").expect("BG_REPEAT_RE")
});
// One `background-size` component: a keyword, a length or percentage, or a
// value function (`var()`, `calc()`) the compute loop resolves later.
static BG_SIZE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?i)^(?:auto|cover|contain|-?[0-9.]+[a-z%]*|(?:var|calc|min|max|clamp|env)\(.*\))$",
    )
    .expect("BG_SIZE_RE")
});
// An image value at the head of a token: the call the css-tree generator may
// glue the next keyword to (`url(a)center/cover`).
static BG_IMAGE_CALL_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?i)^(?:url|image-set|-webkit-image-set|image|cross-fade|element|paint|(?:repeating-)?(?:linear|radial|conic)-gradient)\(",
    )
    .expect("BG_IMAGE_CALL_RE")
});
static CSS_WIDE_KEYWORD_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)^(?:inherit|initial|unset|revert|revert-layer)$").expect("CSS_WIDE_KEYWORD_RE")
});

/// `token` split at its first top-level `/`, the position / size separator.
/// A slash inside `calc()` is not one.
fn split_size_slash(token: &str) -> Option<(&str, &str)> {
    let mut depth = 0usize;
    for (i, b) in token.bytes().enumerate() {
        match b {
            b'(' => depth += 1,
            b')' => depth = depth.saturating_sub(1),
            b'/' if depth == 0 => return Some((&token[..i], &token[i + 1..])),
            _ => {}
        }
    }
    None
}

/// Keywords and units fold to lowercase; a function keeps its case, since
/// custom property names are case-sensitive.
fn size_component(token: &str) -> String {
    if token.contains('(') {
        token.to_string()
    } else {
        js::to_lower_case(token)
    }
}

/// The per-layer `background-repeat` and `background-size` lists of a
/// `background` shorthand (`url(a) center / cover no-repeat, url(b)` ->
/// `no-repeat, repeat` and `cover, auto`). An image call at the head of a
/// token is dropped and the rest of the token kept; any other function is a
/// value and stays whole, so `/ var(--s)` is stored for the compute loop to
/// resolve instead of collapsing to `auto`.
fn parse_static_background_layers(value: &str) -> (String, String) {
    let mut repeats: Vec<String> = Vec::new();
    let mut sizes: Vec<String> = Vec::new();
    for layer in split_css_list(value) {
        let mut repeat: Vec<String> = Vec::new();
        let mut size: Vec<String> = Vec::new();
        let mut in_size = false;
        for raw in split_css_tokens(&layer) {
            let token: &str = match BG_IMAGE_CALL_RE.find(&raw) {
                Some(call) => &raw[css_call_end(&raw, call.end() - 1)..],
                None => raw.as_str(),
            };
            if token.is_empty() {
                in_size = false;
                continue;
            }
            // `center/cover`, `center / cover`, or `center/ cover`: the size
            // is what follows the slash, one or two values.
            if let Some((_, after)) = split_size_slash(token) {
                in_size = true;
                size.clear();
                if !after.is_empty() && BG_SIZE_RE.is_match(after) {
                    size.push(size_component(after));
                }
                continue;
            }
            if in_size && size.len() < 2 && BG_SIZE_RE.is_match(token) {
                size.push(size_component(token));
                continue;
            }
            in_size = false;
            if repeat.len() < 2 && BG_REPEAT_RE.is_match(token) {
                repeat.push(js::to_lower_case(token));
            }
        }
        repeats.push(if repeat.is_empty() {
            "repeat".into()
        } else {
            repeat.join(" ")
        });
        sizes.push(if size.is_empty() {
            "auto".into()
        } else {
            size.join(" ")
        });
    }
    (repeats.join(", "), sizes.join(", "))
}

/// The background color a shorthand names where `expand_static_declaration`
/// does not look: after the image (`url(x) #17150f`), or as the final layer
/// of a list (`url(x), #17150f`). `None` when the expansion already read one
/// before the first image, or when there is none.
fn color_outside_image(v: &str) -> Option<String> {
    let first = BG_IMAGE_SPLIT_RE.find(v)?;
    if !extract_static_color(&v[..first.start()]).is_empty() {
        return None;
    }
    let layers = split_css_list(v);
    let last = layers.last()?;
    let (outside, color_only) = match BG_IMAGE_SPLIT_RE.find(last) {
        Some(call) => {
            let end = css_call_end(last, call.end() - 1);
            (format!("{} {}", &last[..call.start()], &last[end..]), false)
        }
        None => (last.clone(), true),
    };
    if VAR_ANYWHERE_RE.is_match(&outside) {
        return None;
    }
    let color = extract_static_color(&outside);
    // A final layer with no image is the color only when it is nothing else:
    // the `#abc` in `element(#abc)` is not one.
    let named = !color.is_empty() && (!color_only || color == js::trim(&outside));
    named.then_some(color)
}

/// The background longhands a declaration sets beside what
/// `expand_static_declaration` yields. That expansion is pinned by the
/// recorded vectors, so what the JS model never carried lives here and
/// `apply_static_declaration` stores both under one cascade priority:
///
/// - `backgroundRepeat` / `backgroundSize`, so the sampled-contrast path
///   (#560) can tell a tiled or cover image from a no-repeat icon. Every
///   `background` shorthand resets both to what it names, the defaults when
///   it names nothing, as in CSS.
/// - `backgroundImage: none` for a shorthand that names no image, which the
///   expansion only resets for `background: none`. Without it
///   `.card.plain { background: transparent }` keeps the image an earlier
///   rule set. A shorthand whose image is a function the engine does not
///   read stores that value, so nothing is read through it.
/// - `backgroundColor` for a color the shorthand names after its image.
///
/// A CSS-wide keyword passes through, and a bare `var()` value is left alone
/// the way the expansion leaves it.
pub fn background_longhands(prop: &str, value: &str) -> Vec<Expanded> {
    // Runs per declaration per matched node: leave before allocating.
    if !prop
        .get(..10)
        .is_some_and(|head| head.eq_ignore_ascii_case("background"))
    {
        return Vec::new();
    }
    let v = js::trim(value);
    if v.is_empty() {
        return Vec::new();
    }
    match js::to_lower_case(prop).as_str() {
        "background" => background_shorthand_longhands(v),
        "background-repeat" => vec![("backgroundRepeat".into(), v.to_string())],
        "background-size" => vec![("backgroundSize".into(), v.to_string())],
        _ => Vec::new(),
    }
}

/// A layer token that opens with an image function other than `url()` or a
/// gradient: an image the engine does not read (`image-set("a.png" 1x)`,
/// `element()`, `paint()`), with or without a `var()` inside.
fn names_unread_image(v: &str) -> bool {
    split_css_list(v).iter().any(|layer| {
        split_css_tokens(layer)
            .iter()
            .any(|token| BG_IMAGE_CALL_RE.is_match(token))
    })
}

fn background_shorthand_longhands(v: &str) -> Vec<Expanded> {
    let has_image = BG_IMAGE_RE.is_match(v);
    let unread_image = !has_image && names_unread_image(v);
    // A bare `var()` may resolve to anything, so it is left alone the way
    // the expansion leaves it. A `var()` inside an image function
    // (`paint(var(--pattern))`) still names an image.
    if VAR_ANYWHERE_RE.is_match(v) && !has_image && !unread_image {
        return Vec::new();
    }
    if CSS_WIDE_KEYWORD_RE.is_match(v) {
        let keyword = js::to_lower_case(v);
        return vec![
            ("backgroundRepeat".into(), keyword.clone()),
            ("backgroundSize".into(), keyword),
        ];
    }
    let (repeat, size) = parse_static_background_layers(v);
    let mut out: Vec<Expanded> = vec![
        ("backgroundRepeat".into(), repeat),
        ("backgroundSize".into(), size),
    ];
    if !has_image {
        // Neither a `url()` nor a gradient. A shorthand that names no image
        // clears it. One that names an image the engine does not read
        // replaces it with that value instead, and the sampled walk stops
        // there.
        let image = if unread_image {
            v.to_string()
        } else {
            "none".into()
        };
        out.push(("backgroundImage".into(), image));
    } else if let Some(color) = color_outside_image(v) {
        out.push(("backgroundColor".into(), color));
    }
    out
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
