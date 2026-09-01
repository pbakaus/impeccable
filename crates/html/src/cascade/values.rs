//! Color / length / token helpers of the static cascade.
//!
//! JS: css-cascade.mjs#splitCssList, #splitCssTokens, #cssPropToCamel,
//! #staticColorToCss, #parseStaticColor, #extractStaticColor,
//! #normalizeStaticCssValue, #normalizeColorForCheck, #unwrapCssAtLayer

use super::checks_shim::{resolve_length_px, resolve_var_refs, CustomProps};
use super::defaults::{
    static_default_style, static_named_color, static_prop_map, NAMED_COLORS, STATIC_NAMED_COLORS,
};
use impeccable_core::color::{parse_any_color, Rgba, CSS_NAMED_COLORS};
use impeccable_core::js;
use once_cell::sync::Lazy;
use regex::Regex;

/// A computed / partially-computed style: an ordered map of camelCase
/// property name to value string. `parentStyle` and `values` in the JS are
/// plain objects read with `style[prop]`; a missing key reads as undefined
/// (`None` here), an empty string is present but falsy.
pub type StyleValues = indexmap::IndexMap<String, String>;

/// JS `{ ...STATIC_DEFAULT_STYLE }`: a fresh style map holding every default,
/// in table order (the base `computeNode` fills before applying winners).
pub fn make_default_style() -> StyleValues {
    super::defaults::STATIC_DEFAULT_STYLE
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
}

/// JS `style?.[prop]` on an optional style.
pub fn style_get<'a>(style: Option<&'a StyleValues>, prop: &str) -> Option<&'a str> {
    style.and_then(|s| s.get(prop).map(|v| v.as_str()))
}

// ─── splitCssList / splitCssTokens ──────────────────────────────────────────

/// JS: css-cascade.mjs#splitCssList(value)
/// Split on top-level commas (outside quotes and parens/brackets), trimming
/// each part and dropping an empty tail.
pub fn split_css_list(value: &str) -> Vec<String> {
    let chars: Vec<char> = value.chars().collect();
    let mut parts: Vec<String> = Vec::new();
    let mut depth: i64 = 0;
    let mut quote: Option<char> = None;
    let mut start = 0usize;
    for i in 0..chars.len() {
        let ch = chars[i];
        if let Some(q) = quote {
            if ch == q && (i == 0 || chars[i - 1] != '\\') {
                quote = None;
            }
            continue;
        }
        if ch == '"' || ch == '\'' {
            quote = Some(ch);
            continue;
        }
        if ch == '(' || ch == '[' {
            depth += 1;
        } else if ch == ')' || ch == ']' {
            depth = std::cmp::max(0, depth - 1);
        } else if ch == ',' && depth == 0 {
            let piece: String = chars[start..i].iter().collect();
            parts.push(js::trim(&piece).to_string());
            start = i + 1;
        }
    }
    let tail: String = chars[start.min(chars.len())..].iter().collect();
    let tail = js::trim(&tail);
    if !tail.is_empty() {
        parts.push(tail.to_string());
    }
    parts
}

/// JS: css-cascade.mjs#splitCssTokens(value)
/// Split on top-level whitespace (outside quotes and parens).
pub fn split_css_tokens(value: &str) -> Vec<String> {
    let chars: Vec<char> = value.chars().collect();
    let mut tokens: Vec<String> = Vec::new();
    let mut depth: i64 = 0;
    let mut quote: Option<char> = None;
    let mut current = String::new();
    for i in 0..chars.len() {
        let ch = chars[i];
        if let Some(q) = quote {
            current.push(ch);
            if ch == q && (i == 0 || chars[i - 1] != '\\') {
                quote = None;
            }
            continue;
        }
        if ch == '"' || ch == '\'' {
            quote = Some(ch);
            current.push(ch);
            continue;
        }
        if ch == '(' {
            depth += 1;
            current.push(ch);
            continue;
        }
        if ch == ')' {
            depth = std::cmp::max(0, depth - 1);
            current.push(ch);
            continue;
        }
        if js::is_js_whitespace(ch) && depth == 0 {
            if !current.is_empty() {
                tokens.push(std::mem::take(&mut current));
            }
            continue;
        }
        current.push(ch);
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    tokens
}

// ─── cssPropToCamel ─────────────────────────────────────────────────────────

static DASH_LOWER_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"-([a-z])").expect("DASH_LOWER_RE"));

/// JS: css-cascade.mjs#cssPropToCamel(prop)
pub fn css_prop_to_camel(prop: &str) -> String {
    if prop.is_empty() {
        return prop.to_string();
    }
    if let Some(mapped) = static_prop_map(prop) {
        return mapped.to_string();
    }
    DASH_LOWER_RE
        .replace_all(prop, |m: &regex::Captures| m[1].to_ascii_uppercase())
        .into_owned()
}

// ─── Colors ─────────────────────────────────────────────────────────────────

/// JS: css-cascade.mjs#staticColorToCss(c)
pub fn static_color_to_css(c: Option<&Rgba>) -> String {
    let Some(c) = c else {
        return String::new();
    };
    let n = js::number_to_string;
    match c.a {
        Some(a) if a < 1.0 => {
            let rounded = js::string_to_number(&js::to_fixed(a, 3));
            format!("rgba({}, {}, {}, {})", n(c.r), n(c.g), n(c.b), n(rounded))
        }
        _ => format!("rgb({}, {}, {})", n(c.r), n(c.g), n(c.b)),
    }
}

/// JS: css-cascade.mjs#parseStaticColor(value)
pub fn parse_static_color(value: &str) -> Option<Rgba> {
    if let Some(parsed) = parse_any_color(Some(value)) {
        return Some(parsed);
    }
    let key = js::to_lower_case(js::trim(value));
    static_named_color(&key)
}

/// JS `NAMED_COLOR_TOKENS`: every shared + static named color, longest
/// first (stable), joined with `|`.
static NAMED_COLOR_TOKENS: Lazy<String> = Lazy::new(|| {
    let mut names: Vec<&str> = CSS_NAMED_COLORS
        .iter()
        .map(|(n, _)| *n)
        .chain(STATIC_NAMED_COLORS.iter().map(|(n, _)| *n))
        .collect();
    // JS Array.prototype.sort is stable; sort_by is stable too.
    names.sort_by(|a, b| b.len().cmp(&a.len()));
    names.join("|")
});

/// JS `STATIC_COLOR_TOKEN_RE`.
static STATIC_COLOR_TOKEN_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(&format!(
        r"(?i)(?:rgba?\([^)]+\)|oklch\([^)]+\)|oklab\([^)]+\)|lch\([^)]+\)|lab\([^)]+\)|hsla?\([^)]+\)|hwb\([^)]+\)|#[0-9a-f]{{3,8}}(?-u:\b)|(?-u:\b)(?:{})(?-u:\b))",
        *NAMED_COLOR_TOKENS
    ))
    .expect("STATIC_COLOR_TOKEN_RE")
});

static VAR_HEAD_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)^var\(").expect("VAR_HEAD_RE"));
static COLOR_MIX_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)color-mix\(").expect("COLOR_MIX_RE"));

/// JS: css-cascade.mjs#extractStaticColor(value)
pub fn extract_static_color(value: &str) -> String {
    if value.is_empty() {
        return String::new();
    }
    let raw = js::trim(value);
    if VAR_HEAD_RE.is_match(raw) {
        return raw.to_string();
    }
    // color-mix(...) needs balanced-paren capture (its arguments regularly
    // contain nested var()/oklch() calls AND the keyword `transparent`, which
    // the flat regex below would otherwise pluck out of the middle of the
    // expression and report as the whole color).
    if let Some(m) = COLOR_MIX_RE.find(raw) {
        let mix_start = m.start();
        let bytes = raw.as_bytes();
        // JS: raw.indexOf('(', mixStart) — the `(` right after `color-mix`.
        let mut i = match raw[mix_start..].find('(') {
            Some(off) => mix_start + off,
            None => raw.len(),
        };
        let mut depth: i64 = 0;
        while i < bytes.len() {
            if bytes[i] == b'(' {
                depth += 1;
            } else if bytes[i] == b')' {
                depth -= 1;
                if depth == 0 {
                    return raw[mix_start..=i].to_string();
                }
            }
            i += 1;
        }
        return String::new();
    }
    match STATIC_COLOR_TOKEN_RE.find(raw) {
        Some(m) => m.as_str().to_string(),
        None => String::new(),
    }
}

static MODERN_BORDER_PROP_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^border[A-Z][a-z]+Color$").expect("MODERN_BORDER_PROP_RE"));
static MODERN_COLOR_FN_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)^(?:oklch|oklab|lch|lab|hsl|hwb)\(").expect("MODERN_COLOR_FN_RE")
});
static COLOR_TAIL_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)color$").expect("COLOR_TAIL_RE"));

/// JS `parseFloat(style?.fontSize) || 16`.
fn font_size_base(style: Option<&StyleValues>) -> f64 {
    let n = match style_get(style, "fontSize") {
        Some(v) => js::parse_float(v),
        None => f64::NAN,
    };
    if n.is_nan() || n == 0.0 {
        16.0
    } else {
        n
    }
}

/// JS `parseFloat(currentStyle?.fontSize || parentStyle?.fontSize) || 16`.
fn font_size_base2(current: Option<&StyleValues>, parent: Option<&StyleValues>) -> f64 {
    let v = match style_get(current, "fontSize") {
        Some(v) if !v.is_empty() => Some(v),
        _ => style_get(parent, "fontSize"),
    };
    let n = match v {
        Some(v) => js::parse_float(v),
        None => f64::NAN,
    };
    if n.is_nan() || n == 0.0 {
        16.0
    } else {
        n
    }
}

/// JS: css-cascade.mjs#normalizeStaticCssValue(prop, value, customProps, parentStyle, currentStyle = null)
pub fn normalize_static_css_value(
    prop: &str,
    value: &str,
    custom_props: &CustomProps,
    parent_style: Option<&StyleValues>,
    current_style: Option<&StyleValues>,
) -> String {
    let mut resolved = resolve_var_refs(js::trim(value), custom_props);
    if resolved == "inherit" {
        if let Some(v) = style_get(parent_style, prop) {
            if !v.is_empty() {
                return v.to_string();
            }
        }
        if let Some(d) = static_default_style(prop) {
            if !d.is_empty() {
                return d.to_string();
            }
        }
        return String::new();
    }
    let is_modern_border_color =
        MODERN_BORDER_PROP_RE.is_match(prop) && MODERN_COLOR_FN_RE.is_match(&resolved);
    if !is_modern_border_color
        && (COLOR_TAIL_RE.is_match(prop) || prop == "color" || prop == "backgroundColor")
    {
        if let Some(parsed) = parse_static_color(&resolved) {
            resolved = static_color_to_css(Some(&parsed));
        }
    }
    if prop == "fontSize" {
        let base = font_size_base(parent_style);
        if let Some(px) = resolve_length_px(&resolved, base) {
            resolved = format!("{}px", js::number_to_string(px));
        }
    }
    if prop == "letterSpacing" {
        let base = font_size_base2(current_style, parent_style);
        if let Some(px) = resolve_length_px(&resolved, base) {
            resolved = format!("{}px", js::number_to_string(px));
        }
    }
    if prop == "lineHeight" && resolved != "normal" {
        let base = font_size_base2(current_style, parent_style);
        if let Some(px) = resolve_length_px(&resolved, base) {
            resolved = format!("{}px", js::number_to_string(px));
        }
    }
    resolved
}

// ─── normalizeColorForCheck ─────────────────────────────────────────────────

static HEX6_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$").expect("HEX6_RE"));
static HEX3_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)^#([0-9a-f])([0-9a-f])([0-9a-f])$").expect("HEX3_RE"));

/// JS: css-cascade.mjs#normalizeColorForCheck(value)
/// isNeutralColor only understands rgba()/oklch()/lch()/lab()/hsl()/hwb().
/// CSS variables typically hold hex or named colors, so normalize those to
/// rgb() before handing the value off to the shared check. Anything we don't
/// recognise is passed through unchanged (trimmed).
pub fn normalize_color_for_check(value: &str) -> String {
    if value.is_empty() {
        return value.to_string();
    }
    let v = js::trim(value);
    if let Some(m) = HEX6_RE.captures(v) {
        let p = |i: usize| u32::from_str_radix(&m[i], 16).unwrap_or(0);
        return format!("rgb({}, {}, {})", p(1), p(2), p(3));
    }
    if let Some(m) = HEX3_RE.captures(v) {
        let p = |i: usize| u32::from_str_radix(&format!("{}{}", &m[i], &m[i]), 16).unwrap_or(0);
        return format!("rgb({}, {}, {})", p(1), p(2), p(3));
    }
    let lower = js::to_lower_case(v);
    if let Some((_, rgb)) = NAMED_COLORS.iter().find(|(n, _)| *n == lower) {
        return format!("rgb({}, {}, {})", rgb[0], rgb[1], rgb[2]);
    }
    v.to_string()
}

// ─── unwrapCssAtLayer ───────────────────────────────────────────────────────

static AT_LAYER_OPEN_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"@layer(?-u:\b)[^{;]*\{").expect("AT_LAYER_OPEN_RE"));

/// JS: css-cascade.mjs#unwrapCssAtLayer(source)
/// Rewrite `@layer name { ... }` blocks to their inner rules as flat CSS
/// (jsdom doesn't implement @layer). Walks the source balancing braces so
/// nested style rules inside the layer block are handled; an unbalanced
/// block returns the source unchanged.
pub fn unwrap_css_at_layer(source: &str) -> String {
    if source.is_empty() || !source.contains("@layer") {
        return source.to_string();
    }
    let bytes = source.as_bytes();
    let mut out = String::new();
    let mut last_idx = 0usize;
    let mut search_from = 0usize;
    while let Some(m) = AT_LAYER_OPEN_RE.find_at(source, search_from) {
        let open_start = m.start();
        let open_end = m.end();
        let mut depth: i64 = 1;
        let mut i = open_end;
        while i < bytes.len() && depth > 0 {
            let c = bytes[i];
            if c == b'{' {
                depth += 1;
            } else if c == b'}' {
                depth -= 1;
            }
            i += 1;
        }
        if depth != 0 {
            return source.to_string();
        }
        out.push_str(&source[last_idx..open_start]);
        out.push_str(&source[open_end..i - 1]);
        last_idx = i;
        search_from = i;
    }
    out.push_str(&source[last_idx..]);
    out
}
