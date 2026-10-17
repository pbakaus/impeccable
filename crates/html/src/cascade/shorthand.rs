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
// One `background-position` component: an edge or center keyword, a length
// or percentage, or a value function the compute loop resolves later.
static BG_POSITION_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?i)^(?:left|right|top|bottom|center|-?[0-9.]+[a-z%]*|(?:calc|min|max|clamp|env)\(.*\))$",
    )
    .expect("BG_POSITION_RE")
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

/// The per-layer `background-repeat`, `background-size`, and
/// `background-position` lists of a `background` shorthand (`url(a) center
/// / cover no-repeat, url(b)` -> `no-repeat, repeat`, `cover, auto`, and
/// `center, 0% 0%`). An image call at the head of a token is dropped and
/// the rest of the token kept; any other function is a value and stays
/// whole, so `/ var(--s)` is stored for the compute loop to resolve instead
/// of collapsing to `auto`. A bare `var()` among the tokens may hold the
/// repeat: it is stored as the repeat when no keyword names one, so the
/// compute loop resolves it and an unresolved one is not read as tiling.
/// One directly before the size slash can only be the position and is
/// stored as that.
fn parse_static_background_layers(value: &str) -> (String, String, String) {
    let mut repeats: Vec<String> = Vec::new();
    let mut sizes: Vec<String> = Vec::new();
    let mut positions: Vec<String> = Vec::new();
    for layer in split_layers(value) {
        let mut repeat: Vec<String> = Vec::new();
        let mut size: Vec<String> = Vec::new();
        let mut position: Vec<String> = Vec::new();
        let mut var_token: Option<String> = None;
        let mut in_size = false;
        let tokens: Vec<String> = split_tokens(&layer).iter().flat_map(|t| unglue(t)).collect();
        for raw in join_slashes(tokens) {
            let token: &str = match BG_IMAGE_CALL_RE.find(&raw) {
                Some(call) => &raw[css_call_end(&raw, call.end() - 1)..],
                None => raw.as_str(),
            };
            if token.is_empty() {
                in_size = false;
                continue;
            }
            // `center/cover`, `center / cover`, or `center/ cover`: the size
            // is what follows the slash, one or two values; what precedes it
            // is the last position component.
            if let Some((before, after)) = split_size_slash(token) {
                if !before.is_empty()
                    && position.len() < 4
                    && (BG_POSITION_RE.is_match(before) || VAR_HEAD_TOKEN_RE.is_match(before))
                {
                    position.push(size_component(before));
                }
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
                continue;
            }
            // A bare `var()` may hold the repeat, a color, or a position;
            // the first one is kept for the repeat slot and none is read as
            // a position.
            if VAR_HEAD_TOKEN_RE.is_match(token) {
                if var_token.is_none() {
                    var_token = Some(token.to_string());
                }
                continue;
            }
            if position.len() < 4 && BG_POSITION_RE.is_match(token) {
                position.push(size_component(token));
            }
        }
        repeats.push(match (repeat.is_empty(), var_token) {
            (false, _) => repeat.join(" "),
            (true, Some(var)) => var,
            (true, None) => "repeat".into(),
        });
        sizes.push(if size.is_empty() {
            "auto".into()
        } else {
            size.join(" ")
        });
        positions.push(if position.is_empty() {
            "0% 0%".into()
        } else {
            position.join(" ")
        });
    }
    (repeats.join(", "), sizes.join(", "), positions.join(", "))
}

static VAR_HEAD_TOKEN_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)^var\(").expect("VAR_HEAD_TOKEN_RE"));

/// `center / cover`, `center/ cover`, and `center /cover` read as one
/// `center/cover` token, so the slash branch sees the position before it
/// and the size after it whichever way the value was spaced.
fn join_slashes(tokens: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut pending = false;
    for token in tokens {
        if (pending || token.starts_with('/')) && !out.is_empty() {
            out.last_mut().expect("non-empty").push_str(&token);
        } else {
            out.push(token);
        }
        pending = out.last().is_some_and(|last| last.ends_with('/'));
    }
    out
}

/// The css-tree generator writes no space where the tokenizer needs none,
/// so a parsed `url(x.png) center / 100% 100% no-repeat #111` reads
/// `url(x.png)center/100% 100%no-repeat#111`. One whitespace token may
/// then hold several components; they are cut apart where the tokenizer
/// would start the next one: after a top-level `)`, after a `%`, and
/// before a `#`. Quoted strings, the inside of a call, and an escaped
/// character are left alone.
fn unglue(token: &str) -> Vec<String> {
    let chars: Vec<char> = token.chars().collect();
    let starts_component =
        |c: &char| c.is_ascii_alphanumeric() || matches!(c, '_' | '#' | '.' | '-');
    let mut parts: Vec<String> = Vec::new();
    let mut depth = 0usize;
    let mut quote: Option<char> = None;
    let mut start = 0;
    let mut i = 0;
    while i < chars.len() {
        let ch = chars[i];
        if ch == '\\' {
            i += 2;
            continue;
        }
        if let Some(q) = quote {
            if ch == q {
                quote = None;
            }
            i += 1;
            continue;
        }
        match ch {
            '"' | '\'' => quote = Some(ch),
            '(' => depth += 1,
            ')' => depth = depth.saturating_sub(1),
            _ => {}
        }
        if depth == 0 && quote.is_none() {
            if ch == '#' && i > start {
                parts.push(chars[start..i].iter().collect());
                start = i;
            } else if matches!(ch, ')' | '%') && chars.get(i + 1).is_some_and(starts_component) {
                parts.push(chars[start..=i].iter().collect());
                start = i + 1;
            }
        }
        i += 1;
    }
    if start < chars.len() {
        parts.push(chars[start..].iter().collect());
    }
    parts
}

/// `split_css_list` and `split_css_tokens` as the layer parser needs them.
/// The shared splitters keep the JS reading the recorded vectors pin, where
/// a backslash is nothing special outside a string, so the generator's
/// `url(icon\(1.png)` opens a second call that never closes and swallows
/// every keyword after it. Here a backslash hides the character after it,
/// as the tokenizer reads it.
fn split_escaped(value: &str, boundary: impl Fn(char) -> bool) -> Vec<String> {
    let chars: Vec<char> = value.chars().collect();
    let mut parts: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut depth = 0usize;
    let mut quote: Option<char> = None;
    let mut i = 0;
    while i < chars.len() {
        let ch = chars[i];
        if ch == '\\' {
            current.push(ch);
            if let Some(next) = chars.get(i + 1) {
                current.push(*next);
            }
            i += 2;
            continue;
        }
        if let Some(q) = quote {
            if ch == q {
                quote = None;
            }
            current.push(ch);
        } else if ch == '"' || ch == '\'' {
            quote = Some(ch);
            current.push(ch);
        } else if ch == '(' {
            depth += 1;
            current.push(ch);
        } else if ch == ')' {
            depth = depth.saturating_sub(1);
            current.push(ch);
        } else if depth == 0 && boundary(ch) {
            let piece = js::trim(&current).to_string();
            if !piece.is_empty() {
                parts.push(piece);
            }
            current.clear();
        } else {
            current.push(ch);
        }
        i += 1;
    }
    let piece = js::trim(&current).to_string();
    if !piece.is_empty() {
        parts.push(piece);
    }
    parts
}

fn split_layers(value: &str) -> Vec<String> {
    split_escaped(value, |c| c == ',')
}

fn split_tokens(layer: &str) -> Vec<String> {
    split_escaped(layer, js::is_js_whitespace)
}

/// A token that is one `var()` call and nothing else.
fn is_bare_var(token: &str) -> bool {
    VAR_HEAD_TOKEN_RE.is_match(token)
        && token
            .find('(')
            .is_some_and(|open| css_call_end(token, open) == token.len())
}

static BG_ATTACHMENT_OR_BOX_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)^(?:fixed|scroll|local|border-box|padding-box|content-box)$")
        .expect("BG_ATTACHMENT_OR_BOX_RE")
});

/// Whether a value names background geometry rather than a color: repeat,
/// position, or size tokens (with or without the size slash), attachment,
/// or box keywords. What a shorthand's bare `var()` turned out to hold when
/// the cascade stored it in the color slot too; the compute loop then
/// stores `transparent` there instead.
pub fn names_background_geometry(value: &str) -> bool {
    let tokens = join_slashes(split_tokens(value).iter().flat_map(|t| unglue(t)).collect());
    !tokens.is_empty()
        && tokens.iter().all(|token| {
            // An unresolved `var()` is not geometry: the walk keeps its stop.
            let geometry = |t: &str| {
                !VAR_ANYWHERE_RE.is_match(t)
                    && (BG_REPEAT_RE.is_match(t)
                        || BG_POSITION_RE.is_match(t)
                        || BG_SIZE_RE.is_match(t)
                        || BG_ATTACHMENT_OR_BOX_RE.is_match(t))
            };
            match split_size_slash(token) {
                Some((before, after)) => {
                    (before.is_empty() || geometry(before)) && (after.is_empty() || geometry(after))
                }
                None => geometry(token),
            }
        })
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
    let layers = split_layers(v);
    let last = layers.last()?;
    let (outside, color_only) = match BG_IMAGE_SPLIT_RE.find(last) {
        Some(call) => {
            let end = css_call_end(last, call.end() - 1);
            (format!("{} {}", &last[..call.start()], &last[end..]), false)
        }
        None => (last.clone(), true),
    };
    if VAR_ANYWHERE_RE.is_match(&outside) {
        // One bare `var()` token beside the image may hold the color, the
        // only slot the expansion never reads on this side; one glued to
        // the size slash is the position, and one inside another function
        // is not read. The compute loop resolves it, and a repeat,
        // position, or size it turns out to hold computes as `transparent`
        // for every reader (`color_slot_or_transparent`). A whole final
        // layer that is a `var()` stays what it was: unknown paint beneath
        // the image, not its color.
        let tokens = join_slashes(split_tokens(&outside).iter().flat_map(|t| unglue(t)).collect());
        // A literal color beside the `var()` is the color, as it is without
        // one; the tokens that hold a `var()` are left out of that read so
        // a fallback inside one (`var(--x, #fff)`) is not taken for it.
        let plain: Vec<&str> = tokens
            .iter()
            .filter(|t| !VAR_ANYWHERE_RE.is_match(t))
            .map(|t| t.as_str())
            .collect();
        let literal = extract_static_color(&plain.join(" "));
        if !literal.is_empty() {
            return (!color_only).then_some(literal);
        }
        let bare: Vec<&String> = tokens.iter().filter(|t| is_bare_var(t)).collect();
        let rest_plain = tokens
            .iter()
            .filter(|t| !is_bare_var(t))
            .all(|t| !VAR_ANYWHERE_RE.is_match(t));
        let named = !color_only && bare.len() == 1 && rest_plain;
        return named.then(|| bare[0].clone());
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
/// - `backgroundRepeat` / `backgroundSize` / `backgroundPosition`, so the
///   sampled-contrast path (#560) can tell a tiled or cover image from a
///   no-repeat icon or a shifted one. Every `background` shorthand resets
///   all three to what it names, the defaults when it names nothing, as in
///   CSS.
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
        "background-repeat" => vec![("backgroundRepeat".into(), initial_or(v, "repeat"))],
        "background-size" => vec![("backgroundSize".into(), initial_or(v, "auto"))],
        "background-position" => vec![("backgroundPosition".into(), initial_or(v, "0% 0%"))],
        // Not part of the shorthand, so it is never reset by one; the
        // sampled-contrast path stands down on any mode but `normal`.
        "background-blend-mode" => vec![("backgroundBlendMode".into(), v.to_string())],
        _ => Vec::new(),
    }
}

/// `initial`, `unset`, and `revert` are the property's initial value for
/// these non-inherited longhands; `inherit` is left for the compute loop.
fn initial_or(v: &str, initial: &str) -> String {
    if !CSS_WIDE_KEYWORD_RE.is_match(v) {
        v.to_string()
    } else if v.eq_ignore_ascii_case("inherit") {
        "inherit".to_string()
    } else {
        initial.to_string()
    }
}

/// A layer token that opens with an image function other than `url()` or a
/// gradient: an image the engine does not read (`image-set("a.png" 1x)`,
/// `element()`, `paint()`), with or without a `var()` inside.
fn names_unread_image(v: &str) -> bool {
    split_layers(v).iter().any(|layer| {
        split_tokens(layer)
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
        return vec![
            ("backgroundRepeat".into(), initial_or(v, "repeat")),
            ("backgroundSize".into(), initial_or(v, "auto")),
            ("backgroundPosition".into(), initial_or(v, "0% 0%")),
        ];
    }
    let (repeat, size, position) = parse_static_background_layers(v);
    let mut out: Vec<Expanded> = vec![
        ("backgroundRepeat".into(), repeat),
        ("backgroundSize".into(), size),
        ("backgroundPosition".into(), position),
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
