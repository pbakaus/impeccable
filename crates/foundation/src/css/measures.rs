//! CSS value parsing and measurement helpers, plus the plain-data input and
//! output types the rule checks are written against.
//!
//! Everything here is open: it reads CSS values, resolves custom properties,
//! measures lengths, alphas and shadows, and defines the structs that carry a
//! check's inputs and its hits. The checks themselves live in the detector.
//!
//! Style-reading helpers take a [`StyleMap`]: any lookup from the JS
//! camelCase computed-style property name (`borderTopWidth`, `clipPath`) to
//! its string value, so a jsdom-style map, a real cascade, and a test
//! `HashMap` all fit.

use crate::color::{self, Rgba};
use crate::js::{self, ci, math_max, math_max3, math_min, parse_float, WS, WS_CHARS};
use crate::js_ext_b::num_truthy;
use crate::rules::types::{Corners, D};
use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

macro_rules! re {
    ($name:ident, $pat:expr) => {
        static $name: Lazy<Regex> = Lazy::new(|| Regex::new(&$pat).expect(stringify!($name)));
    };
}

/// A computed-style lookup keyed by the JS camelCase property name. `None`
/// stands for JS `undefined`; JS code that reads `style.x || ''` treats both
/// `None` and `Some("")` alike.
pub trait StyleMap {
    fn prop(&self, name: &str) -> Option<String>;
}

impl StyleMap for HashMap<String, String> {
    fn prop(&self, name: &str) -> Option<String> {
        self.get(name).cloned()
    }
}

impl StyleMap for HashMap<&str, &str> {
    fn prop(&self, name: &str) -> Option<String> {
        self.get(name).map(|s| s.to_string())
    }
}

impl<F: Fn(&str) -> Option<String>> StyleMap for F {
    fn prop(&self, name: &str) -> Option<String> {
        self(name)
    }
}

/// `style.x || ''`
pub fn prop_or_empty(style: &dyn StyleMap, name: &str) -> String {
    style.prop(name).unwrap_or_default()
}

/// JS `parseFloat(x) || 0` (NaN and -0 both become +0).
pub fn parse_float_or_zero(s: Option<&str>) -> f64 {
    let n = match s {
        Some(s) => parse_float(s),
        None => f64::NAN,
    };
    if num_truthy(n) {
        n
    } else {
        0.0
    }
}

// ─── Section 4: lengths, colors, var() ──────────────────────────────────────

/// JS: checks.mjs#parseRadiusToPx. Parse a single CSS length token to
/// pixels; percentages convert against `width_px` when one is supplied,
/// else the raw percentage number is returned. `width_px` NaN reads as
/// "no width".
pub fn parse_radius_to_px(value: Option<&str>, width_px: f64) -> Option<f64> {
    re!(WS_RE, format!("{}+", WS));
    re!(PCT_END, "%$");
    let value = value?;
    if value.is_empty() {
        return None;
    }
    let trimmed = js::trim(value);
    if trimmed.is_empty() {
        return None;
    }
    let first = WS_RE.split(trimmed).next().unwrap_or("");
    let num = parse_float(first);
    if num.is_nan() {
        return None;
    }
    if PCT_END.is_match(first) {
        if num_truthy(width_px) && width_px > 0.0 {
            return Some((num / 100.0) * width_px);
        }
        return Some(num);
    }
    Some(num)
}

/// One `border-radius` token in px, or `None` when it is not a length this
/// can resolve: a `calc()`, an unresolved `var()`, a keyword, a unit whose
/// px value depends on something not in hand. Percentages resolve against
/// `width_px` the way [`parse_radius_to_px`] resolves them; `em` resolves
/// against `em_px`, the element's font size, and `rem` against the 16px root
/// default. Unit matching is case-insensitive: CSS units are, and a
/// stylesheet carrying `0.5REM` still describes a rounded corner.
fn radius_token_px(token: &str, width_px: f64, em_px: f64) -> Option<f64> {
    let token = js::trim(token);
    let num = parse_radius_to_px(Some(token), width_px)?;
    let unit = token.trim_start_matches(|c: char| !c.is_ascii_alphabetic() && c != '%');
    match js::to_lower_case(unit).as_str() {
        "px" | "%" => Some(num),
        "em" => Some(num * em_px),
        "rem" => Some(num * ROOT_FONT_SIZE_PX),
        // A bare `0` is the one unitless radius CSS allows.
        "" if num == 0.0 => Some(0.0),
        _ => None,
    }
}

/// The root font size `rem` resolves against, and the `em` default for a
/// caller that has no font size in hand.
pub const ROOT_FONT_SIZE_PX: f64 = 16.0;

/// One `border-radius` token in px, `em` read against the element's font
/// size. `None` on the terms [`parse_radius_corners`] documents.
pub fn parse_radius_token_px(token: &str, width_px: f64, em_px: f64) -> Option<f64> {
    radius_token_px(token, width_px, em_px)
}

/// The corners of a `border-radius` shorthand, in px. Reads the horizontal
/// radii (the half before any `/`) and fills the 1-, 2- and 3-value forms out
/// the way the shorthand does. `None` when the declaration is missing, empty
/// or carries a token this cannot resolve: a caller that cannot see the
/// corners should keep reporting rather than read the box as square.
pub fn parse_radius_corners(value: Option<&str>, width_px: f64) -> Option<Corners> {
    parse_radius_corners_em(value, width_px, ROOT_FONT_SIZE_PX)
}

/// [`parse_radius_corners`] with `em` read against `em_px`, the element's
/// font size.
pub fn parse_radius_corners_em(value: Option<&str>, width_px: f64, em_px: f64) -> Option<Corners> {
    let mut halves = value?.split('/');
    let mut corners = radius_half_corners(halves.next().unwrap_or(""), width_px, em_px)?;
    // An elliptical corner with a zero vertical radius is square
    // (`10px / 0`): a corner rounds only when both of its radii do.
    if let Some(vertical) = halves.next() {
        let v = radius_half_corners(vertical, width_px, em_px)?;
        for (h, v) in [
            (&mut corners.top_left, v.top_left),
            (&mut corners.top_right, v.top_right),
            (&mut corners.bottom_right, v.bottom_right),
            (&mut corners.bottom_left, v.bottom_left),
        ] {
            if v <= 0.0 {
                *h = 0.0;
            }
        }
    }
    Some(corners)
}

/// One half of a `border-radius` shorthand (the radii before or after the
/// `/`), filled out to four corners the way the shorthand does.
fn radius_half_corners(half: &str, width_px: f64, em_px: f64) -> Option<Corners> {
    re!(WS_SPLIT, format!("{}+", WS));
    let trimmed = js::trim(half);
    if trimmed.is_empty() {
        return None;
    }
    let parts: Vec<f64> = WS_SPLIT
        .split(trimmed)
        .filter(|t| !t.is_empty())
        .map(|t| radius_token_px(t, width_px, em_px))
        .collect::<Option<Vec<f64>>>()?;
    let at = |i: usize| parts.get(i).copied().unwrap_or(0.0);
    Some(match parts.len() {
        0 => return None,
        1 => Corners {
            top_left: at(0),
            top_right: at(0),
            bottom_right: at(0),
            bottom_left: at(0),
        },
        2 => Corners {
            top_left: at(0),
            top_right: at(1),
            bottom_right: at(0),
            bottom_left: at(1),
        },
        3 => Corners {
            top_left: at(0),
            top_right: at(1),
            bottom_right: at(2),
            bottom_left: at(1),
        },
        _ => Corners {
            top_left: at(0),
            top_right: at(1),
            bottom_right: at(2),
            bottom_left: at(3),
        },
    })
}

/// One `border-<corner>-radius` longhand in px: its horizontal radius, the
/// half a stripe runs along. `None` on the same terms as
/// [`parse_radius_corners`].
pub fn parse_radius_corner_px(value: Option<&str>, width_px: f64) -> Option<f64> {
    parse_radius_corner_px_em(value, width_px, ROOT_FONT_SIZE_PX)
}

/// [`parse_radius_corner_px`] with `em` read against `em_px`.
pub fn parse_radius_corner_px_em(value: Option<&str>, width_px: f64, em_px: f64) -> Option<f64> {
    re!(WS_SPLIT_ONE, format!("{}+", WS));
    let trimmed = js::trim(value?);
    let mut tokens = WS_SPLIT_ONE.split(trimmed).filter(|t| !t.is_empty());
    let horizontal = radius_token_px(tokens.next()?, width_px, em_px)?;
    // `10px 0`: a zero vertical radius leaves the corner square.
    match tokens.next() {
        Some(vertical) if radius_token_px(vertical, width_px, em_px)? <= 0.0 => Some(0.0),
        _ => Some(horizontal),
    }
}

/// The custom-property lookup `resolveVarRefs` reads (`customPropMap.get`).
pub trait CustomProps {
    fn get(&self, name: &str) -> Option<String>;
}

impl CustomProps for HashMap<String, String> {
    fn get(&self, name: &str) -> Option<String> {
        HashMap::get(self, name).cloned()
    }
}

impl CustomProps for Vec<(String, String)> {
    fn get(&self, name: &str) -> Option<String> {
        self.iter().find(|(k, _)| k == name).map(|(_, v)| v.clone())
    }
}

impl<F: Fn(&str) -> Option<String>> CustomProps for F {
    fn get(&self, name: &str) -> Option<String> {
        self(name)
    }
}

/// JS: checks.mjs#resolveVarRefs. Resolve `var(--x[, fallback])` refs in a
/// value string, recursing up to 8 levels for chained refs. Returns the
/// input unchanged when no refs are present or a chain does not resolve.
pub fn resolve_var_refs(raw: &str, custom_props: &dyn CustomProps, depth: u32) -> String {
    // CSS function names are ASCII case-insensitive; ASCII lowercasing keeps
    // every byte offset, so positions found in `lower` index `raw` directly.
    let lower = raw.to_ascii_lowercase();
    if !lower.contains("var(") {
        return raw.to_string();
    }
    if depth > 8 {
        return raw.to_string();
    }

    let bytes = raw.as_bytes();
    let mut out = String::with_capacity(raw.len());
    let mut cursor = 0;
    while let Some(relative_start) = lower[cursor..].find("var(") {
        let start = cursor + relative_start;
        let open = start + 3;
        let mut nesting = 1_u32;
        let mut quote = None;
        let mut escaped = false;
        let mut close = None;
        for (offset, byte) in bytes[open + 1..].iter().copied().enumerate() {
            let index = open + 1 + offset;
            if escaped {
                escaped = false;
                continue;
            }
            if byte == b'\\' {
                escaped = true;
                continue;
            }
            if let Some(active_quote) = quote {
                if byte == active_quote {
                    quote = None;
                }
                continue;
            }
            if byte == b'\'' || byte == b'"' {
                quote = Some(byte);
            } else if byte == b'(' {
                nesting += 1;
            } else if byte == b')' {
                nesting -= 1;
                if nesting == 0 {
                    close = Some(index);
                    break;
                }
            }
        }
        let Some(close) = close else {
            out.push_str(&raw[cursor..]);
            return out;
        };

        let body = &raw[open + 1..close];
        let mut nested = 0_u32;
        let mut comma = None;
        for (index, byte) in body.as_bytes().iter().copied().enumerate() {
            if byte == b'(' {
                nested += 1;
            } else if byte == b')' {
                nested = nested.saturating_sub(1);
            } else if byte == b',' && nested == 0 {
                comma = Some(index);
                break;
            }
        }
        let (name, fallback) = match comma {
            Some(index) => (js::trim(&body[..index]), Some(js::trim(&body[index + 1..]))),
            None => (js::trim(body), None),
        };
        let valid_name = name.starts_with("--")
            && name.len() > 2
            && name[2..]
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-');

        out.push_str(&raw[cursor..start]);
        if valid_name {
            if let Some(value) = custom_props.get(name) {
                out.push_str(&resolve_var_refs(&value, custom_props, depth + 1));
            } else if let Some(fallback) = fallback {
                out.push_str(&resolve_var_refs(fallback, custom_props, depth + 1));
            } else {
                out.push_str(&raw[start..=close]);
            }
        } else {
            out.push_str(&raw[start..=close]);
        }
        cursor = close + 1;
    }
    out.push_str(&raw[cursor..]);
    out
}

/// JS: checks.mjs#parseColorResolved. Resolve var() refs (when a map is
/// given), then parse. `None` on any failure.
pub fn parse_color_resolved(
    s: Option<&str>,
    custom_props: Option<&dyn CustomProps>,
) -> Option<Rgba> {
    let s = s?;
    if s.is_empty() {
        return None;
    }
    let resolved = match custom_props {
        Some(map) => resolve_var_refs(s, map, 0),
        None => s.to_string(),
    };
    color::parse_any_color(Some(&resolved))
}

/// JS: checks.mjs#resolveLengthPx. Resolve a CSS length given a font-size
/// context; `None` for `normal` / `auto` / `inherit` / unparseable.
pub fn resolve_length_px(value: Option<&str>, font_size_px: f64) -> Option<f64> {
    let value = value?;
    if value.is_empty() || value == "normal" || value == "auto" || value == "inherit" {
        return None;
    }
    let num = parse_float(value);
    if num.is_nan() {
        return None;
    }
    if value.ends_with("px") {
        return Some(num);
    }
    if value.ends_with("rem") {
        return Some(num * 16.0);
    }
    if value.ends_with("em") {
        return Some(num * font_size_px);
    }
    if value.ends_with('%') {
        return Some((num / 100.0) * font_size_px);
    }
    if let Some(px) = absolute_length_px(value, num) {
        return Some(px);
    }
    Some(num * font_size_px)
}

/// An absolute CSS length other than `px`, in px at 96px to the inch
/// (`1in = 96px = 72pt = 6pc = 2.54cm = 25.4mm = 101.6Q`); `None` for any other
/// unit or none, so the caller's fall-through still decides those. Print
/// stylesheets set type in `pt`, and without this `15pt` fell through to the
/// unitless branch and resolved as 15em. The unit is the whole trailing run of
/// letters, in either case, so `vmin` and `cqmin` are not taken for inches.
fn absolute_length_px(value: &str, num: f64) -> Option<f64> {
    let bytes = value.as_bytes();
    let mut start = bytes.len();
    while start > 0 && bytes[start - 1].is_ascii_alphabetic() {
        start -= 1;
    }
    // An ASCII letter is a whole character, so `start` is a char boundary.
    let unit = &value[start..];
    let units_per_inch = if unit.eq_ignore_ascii_case("pt") {
        72.0
    } else if unit.eq_ignore_ascii_case("pc") {
        6.0
    } else if unit.eq_ignore_ascii_case("in") {
        1.0
    } else if unit.eq_ignore_ascii_case("cm") {
        2.54
    } else if unit.eq_ignore_ascii_case("mm") {
        25.4
    } else if unit.eq_ignore_ascii_case("q") {
        101.6
    } else {
        return None;
    };
    Some(num * (96.0 / units_per_inch))
}

/// Characters that fit on one line at a given measure: an average glyph runs
/// about half the font size wide. The estimate `line-length` reports and the
/// one `justified-text` reads to tell a narrow column from a long measure.
pub fn chars_per_line(width_px: f64, font_size_px: f64) -> f64 {
    width_px / (font_size_px * 0.5)
}

/// JS: checks.mjs#cssColorIsTransparent.
pub fn css_color_is_transparent(value: Option<&str>) -> bool {
    re!(
        ZERO_RGBA,
        format!(
            r"^rgba\({ws}*{d}+{ws}*,{ws}*{d}+{ws}*,{ws}*{d}+{ws}*,{ws}*0(?:\.0+)?{ws}*\)$",
            ws = WS,
            d = D
        )
    );
    let Some(value) = value else { return true };
    if value.is_empty() {
        return true;
    }
    let s = js::to_lower_case(js::trim(value));
    if s.is_empty() || s == "transparent" || s == "rgba(0, 0, 0, 0)" {
        return true;
    }
    if let Some(parsed) = color::parse_any_color(Some(&s)) {
        return parsed.alpha_or_one() <= 0.05;
    }
    ZERO_RGBA.is_match(&s)
}

/// JS: checks.mjs#colorsNearlyMatch.
pub fn colors_nearly_match(a: Option<&str>, b: Option<&str>) -> bool {
    let (Some(ca), Some(cb)) = (color::parse_any_color(a), color::parse_any_color(b)) else {
        return false;
    };
    let alpha_delta = (ca.alpha_or_one() - cb.alpha_or_one()).abs();
    let channel_delta = math_max3(
        (ca.r - cb.r).abs(),
        (ca.g - cb.g).abs(),
        (ca.b - cb.b).abs(),
    );
    alpha_delta <= 0.03 && channel_delta <= 3.0
}

// ─── Radial spotlight ───────────────────────────────────────────────────────

/// JS: checks.mjs#SPOTLIGHT_COLOR_TOKEN_RE (JS `/i`, ASCII `\b`).
pub static SPOTLIGHT_COLOR_TOKEN_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(&format!(
        r"(?:{rgb}[aA]?|{hsl}[aA]?|{oklch}|{oklab}|{lab}|{lch}|{hwb}|{colormix})\([^)]*(?:\([^)]*\))?[^)]*\)|#[0-9a-fA-F]{{3,8}}(?-u:\b)|(?-u:\b){transparent}(?-u:\b)",
        rgb = ci("rgb"),
        hsl = ci("hsl"),
        oklch = ci("oklch"),
        oklab = ci("oklab"),
        lab = ci("lab"),
        lch = ci("lch"),
        hwb = ci("hwb"),
        colormix = ci("color-mix"),
        transparent = ci("transparent"),
    ))
    .expect("SPOTLIGHT_COLOR_TOKEN_RE")
});

/// One radial-gradient color stop as `parseRadialGradientStops` reads it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GradientStop {
    pub color: Option<Rgba>,
    pub transparent: bool,
}

/// The byte index of the `)` closing the `(` at `open`, or `None` when the
/// value never closes it.
fn matching_paren(bytes: &[u8], open: usize) -> Option<usize> {
    let mut depth = 0i32;
    for (i, &b) in bytes.iter().enumerate().skip(open) {
        if b == b'(' {
            depth += 1;
        } else if b == b')' {
            depth -= 1;
            if depth == 0 {
                return Some(i);
            }
        }
    }
    None
}

/// One stop argument read the way `parseRadialGradientStops` reads it: the
/// first color token, `transparent` or a near-zero alpha as a transparent
/// stop, and an unparseable token as a stop with no color.
fn spotlight_stop_from_arg(arg: &str) -> GradientStop {
    re!(TRANSPARENT_ONLY, format!("^{}$", ci("transparent")));
    let Some(tok) = SPOTLIGHT_COLOR_TOKEN_RE.find(arg) else {
        return GradientStop {
            color: None,
            transparent: false,
        };
    };
    if TRANSPARENT_ONLY.is_match(tok.as_str()) {
        return GradientStop {
            color: None,
            transparent: true,
        };
    }
    let c = color::parse_any_color(Some(tok.as_str()));
    let transparent = matches!(c, Some(c) if c.alpha_or_one() <= 0.05);
    GradientStop {
        color: c,
        transparent,
    }
}

/// JS: checks.mjs#parseRadialGradientStops. The ordered stops of the FIRST
/// non-repeating radial-gradient in a background value, or `None` when
/// there is no plain radial-gradient to read.
pub fn parse_radial_gradient_stops(value: Option<&str>) -> Option<Vec<GradientStop>> {
    re!(HAS_RADIAL, ci("radial-gradient"));
    re!(
        GRAD_RE,
        format!(r"({}-)?{}\(", ci("repeating"), ci("radial-gradient"))
    );
    let value = value?;
    if value.is_empty() || !HAS_RADIAL.is_match(value) {
        return None;
    }
    let bytes = value.as_bytes();
    for g in GRAD_RE.captures_iter(value) {
        if g.get(1).is_some() {
            continue; // repeating-* is a pattern, not a spotlight
        }
        let start = g.get(0).map(|m| m.start()).unwrap_or(0);
        let open = match value[start..].find('(') {
            Some(i) => start + i,
            None => return None,
        };
        let end = matching_paren(bytes, open)?;
        let args = color::split_top_level_commas(&value[open + 1..end]);
        let stop_args: Vec<&String> = args
            .iter()
            .filter(|a| SPOTLIGHT_COLOR_TOKEN_RE.is_match(a))
            .collect();
        if stop_args.len() < 2 {
            return None;
        }
        return Some(
            stop_args
                .iter()
                .map(|a| spotlight_stop_from_arg(a))
                .collect(),
        );
    }
    None
}

/// The color stops of one gradient image layer (`linear-gradient(...)`,
/// `radial-gradient(...)`, `conic-gradient(...)` or a repeating form) in
/// declaration order, `transparent` included. Unlike
/// [`parse_radial_gradient_stops`] it takes any gradient function and a
/// single stop, and reads a named color (`white`, `navy`) as a stop. `None`
/// when the layer is not a gradient or no argument names a color.
pub fn parse_gradient_layer_stops(layer: &str) -> Option<Vec<GradientStop>> {
    re!(GRADIENT_FN, format!(r"{}\(", ci("gradient")));
    let m = GRADIENT_FN.find(layer)?;
    let open = m.end() - 1;
    let end = matching_paren(layer.as_bytes(), open)?;
    let mut stops = Vec::new();
    for arg in color::split_top_level_commas(&layer[open + 1..end]) {
        if SPOTLIGHT_COLOR_TOKEN_RE.is_match(&arg) {
            stops.push(spotlight_stop_from_arg(&arg));
            continue;
        }
        let first = arg.split_ascii_whitespace().next().unwrap_or("");
        if let Some(c) = color::parse_any_color(Some(first)) {
            stops.push(GradientStop {
                color: Some(c),
                transparent: c.alpha_or_one() <= 0.05,
            });
        }
    }
    if stops.is_empty() {
        None
    } else {
        Some(stops)
    }
}

/// A `{ id, snippet }` finding as the pure checks return them.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Finding {
    pub id: String,
    pub snippet: String,
}

impl Finding {
    pub fn new(id: &str, snippet: String) -> Self {
        Finding {
            id: id.to_string(),
            snippet,
        }
    }
}

/// Input of `checkRadialSpotlight`. `width` / `height` NaN when the JS
/// caller would pass `undefined`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RadialSpotlightInput<'a> {
    #[serde(borrow)]
    pub gradient_value: Option<&'a str>,
    pub width: f64,
    pub height: f64,
    #[serde(borrow)]
    pub label: Option<&'a str>,
}

/// What `checkRadialSpotlight`'s declaration test cannot see: how much of the
/// glow actually reaches the page. The adapters measure it per element.
/// Whether the glow sits behind copy is the third measurement and the
/// expensive one, so it travels to the gate as a closure rather than a field.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct RadialGlowProminence {
    /// The painting element's effective opacity: its own `opacity` times
    /// every ancestor's.
    pub opacity: f64,
    /// The surface the glow paints over, `None` when the cascade cannot
    /// resolve one (an image or an unreadable stack underneath).
    pub backdrop: Option<Rgba>,
}

/// JS: checks.mjs#TAILWIND_BG_HEX (insertion order preserved).
pub const TAILWIND_BG_HEX: &[(&str, &str)] = &[
    ("bg-amber-50", "#fffbeb"),
    ("bg-amber-100", "#fef3c7"),
    ("bg-orange-50", "#fff7ed"),
    ("bg-orange-100", "#ffedd5"),
    ("bg-yellow-50", "#fefce8"),
    ("bg-stone-50", "#fafaf9"),
    ("bg-stone-100", "#f5f5f4"),
    ("bg-stone-200", "#e7e5e4"),
];

/// A layout rect (`getBoundingClientRect`-shaped) as the pure gate reads it.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Rect {
    pub width: f64,
    pub height: f64,
}

/// Input of `checkOversizedH1`; `viewport_*` default to 0 in JS.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OversizedH1Input<'a> {
    #[serde(borrow)]
    pub tag: &'a str,
    pub font_size: f64,
    #[serde(borrow)]
    pub heading_text: &'a str,
    pub rect: Option<Rect>,
    pub viewport_width: f64,
    pub viewport_height: f64,
}

// ─── Hairline border + wide diffuse shadow ──────────────────────────────────

/// JS: checks.mjs#CSS_COLOR_TOKEN_RE (JS `/gi`, ASCII `\b`).
pub static CSS_COLOR_TOKEN_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(&format!(
        r"(?:{rgb}[aA]?|{hsl}[aA]?|{oklch}|{oklab}|{lab}|{lch}|{color})\([^)]*\)|#[0-9a-fA-F]{{3,8}}(?-u:\b)|(?-u:\b)(?:{black}|{white}|{transparent}|{currentcolor})(?-u:\b)",
        rgb = ci("rgb"),
        hsl = ci("hsl"),
        oklch = ci("oklch"),
        oklab = ci("oklab"),
        lab = ci("lab"),
        lch = ci("lch"),
        color = ci("color"),
        black = ci("black"),
        white = ci("white"),
        transparent = ci("transparent"),
        currentcolor = ci("currentcolor"),
    ))
    .expect("CSS_COLOR_TOKEN_RE")
});

/// JS: checks.mjs#shadowLayerAlpha. Alpha of the first color token in one
/// box-shadow layer; 1 when there is none or it does not parse.
pub fn shadow_layer_alpha(layer: &str) -> f64 {
    let Some(m) = CSS_COLOR_TOKEN_RE.find(layer) else {
        return 1.0;
    };
    if js::to_lower_case(m.as_str()) == "transparent" {
        return 0.0;
    }
    color::parse_any_color(Some(m.as_str()))
        .map(|c| c.alpha_or_one())
        .unwrap_or(1.0)
}

/// JS `boxShadow.split(/,(?![^()]*\))/)`: split on commas that are not
/// inside parentheses (a comma followed by a `)` before any `(` stays).
fn split_shadow_layers(s: &str) -> Vec<&str> {
    let bytes = s.as_bytes();
    let mut out = Vec::new();
    let mut start = 0usize;
    for (i, &b) in bytes.iter().enumerate() {
        if b != b',' {
            continue;
        }
        let mut inside = false;
        for &c in &bytes[i + 1..] {
            if c == b'(' {
                break;
            }
            if c == b')' {
                inside = true;
                break;
            }
        }
        if inside {
            continue;
        }
        out.push(&s[start..i]);
        start = i + 1;
    }
    out.push(&s[start..]);
    out
}

/// Whether a computed `box-shadow` draws anything: some layer with a visible
/// color and a non-zero offset, blur or spread. Tailwind's ring and shadow
/// variables compute to `rgba(0, 0, 0, 0) 0px 0px 0px 0px` layers, and a
/// fully zero layer paints nothing even in an opaque color. Nor does an
/// unblurred layer whose negative spread pulls its shape in at least as far
/// as its offset moves it, measured as a distance so a rounded corner moved
/// diagonally still counts: outside, that shape stays under the box; inset,
/// the hole it cuts covers the whole box (`0 0 0 -1px`).
pub fn box_shadow_paints(box_shadow: &str) -> bool {
    re!(WORD_RE, r"(?-u:\b)[a-zA-Z]+(?-u:\b)");
    re!(NUM_RE, format!(r"-?{d}*\.?{d}+", d = D));
    let box_shadow = box_shadow.trim();
    if box_shadow.is_empty() || box_shadow == "none" {
        return false;
    }
    split_shadow_layers(box_shadow).into_iter().any(|layer| {
        if shadow_layer_alpha(layer) <= 0.0 {
            return false;
        }
        let cleaned = CSS_COLOR_TOKEN_RE.replace_all(layer, " ");
        let cleaned = WORD_RE.replace_all(&cleaned, " ");
        let nums: Vec<f64> = NUM_RE.find_iter(&cleaned).map(|m| parse_float(m.as_str())).collect();
        if !nums.iter().any(|&n| n != 0.0) {
            return false;
        }
        match nums.as_slice() {
            [x, y, blur, spread, ..] if *blur == 0.0 && x.hypot(*y) + spread <= 0.0 => false,
            _ => true,
        }
    })
}

/// JS: checks.mjs#shadowMaxBlurPx. Largest blur radius across the layers
/// whose color alpha is at least `min_alpha` (JS default 0).
pub fn shadow_max_blur_px(box_shadow: Option<&str>, min_alpha: Option<f64>) -> f64 {
    shadow_max_blur_px_among(box_shadow, min_alpha, false)
}

/// Largest blur radius across the layers drawn outside the box: not `inset`,
/// with a color alpha of at least `min_alpha`. An inset layer is a well
/// pressed into the surface rather than an elevation under it, so it is never
/// the halo around a card. Offsets are read by nothing here: every step of
/// every mainstream elevation scale casts a y-offset, so a shadow lit from
/// above is the common case rather than the exception.
pub fn shadow_max_outer_blur_px(box_shadow: Option<&str>, min_alpha: Option<f64>) -> f64 {
    shadow_max_blur_px_among(box_shadow, min_alpha, true)
}

/// The one box-shadow parse behind [`shadow_max_blur_px`] and
/// [`shadow_max_outer_blur_px`]; `outer_only` skips `inset` layers.
fn shadow_max_blur_px_among(
    box_shadow: Option<&str>,
    min_alpha: Option<f64>,
    outer_only: bool,
) -> f64 {
    re!(WORD_RE, r"(?-u:\b)[a-zA-Z]+(?-u:\b)");
    re!(NUM_RE, format!(r"-?{d}*\.?{d}+", d = D));
    re!(INSET_RE, r"(?i)(?-u:\b)inset(?-u:\b)");
    let min_alpha = min_alpha.unwrap_or(0.0);
    let Some(box_shadow) = box_shadow else {
        return 0.0;
    };
    if box_shadow.is_empty() || box_shadow == "none" {
        return 0.0;
    }
    let mut max_blur = 0.0f64;
    for layer in split_shadow_layers(box_shadow) {
        if shadow_layer_alpha(layer) < min_alpha {
            continue;
        }
        let cleaned = CSS_COLOR_TOKEN_RE.replace_all(layer, " ");
        if outer_only && INSET_RE.is_match(&cleaned) {
            continue;
        }
        let cleaned = WORD_RE.replace_all(&cleaned, " ");
        let nums: Vec<f64> = NUM_RE
            .find_iter(&cleaned)
            .map(|m| parse_float(m.as_str()))
            .collect();
        if nums.len() >= 3 {
            max_blur = math_max(max_blur, nums[2]);
        }
    }
    max_blur
}

/// One layer of a computed `box-shadow`: its offsets, blur, spread, whether
/// it is drawn inside the box, and its colour (`None` when the layer names
/// none, which is `currentcolor`, or names one that does not parse).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ShadowLayer {
    pub x: f64,
    pub y: f64,
    pub blur: f64,
    pub spread: f64,
    pub inset: bool,
    pub alpha: f64,
    pub color: Option<color::Rgba>,
}

impl ShadowLayer {
    /// How far the layer paints past the box on `[top, right, bottom, left]`.
    /// A Gaussian blur shows about half its radius past the shape it blurs,
    /// and the shape is the box grown by the spread and moved by the offsets:
    /// `0 2px 4px -2px` draws a 2px lip under the box and nothing at its
    /// sides, where `0 2px 4px 0` draws 2px at the sides too.
    pub fn outer_reach(&self) -> [f64; 4] {
        let base = self.spread + self.blur / 2.0;
        [base - self.y, base + self.x, base + self.y, base - self.x]
    }

    /// The blur that shows as a halo: the radius less whatever a negative
    /// spread pulls the shape in by. `0 18px 40px -26px` is a tight lift under
    /// the box, not a 40px halo.
    pub fn halo_blur(&self) -> f64 {
        self.blur + math_min(self.spread, 0.0)
    }
}

/// Every layer of a computed `box-shadow` that parses to at least two
/// lengths, in order. `none` and the empty string have none.
pub fn parse_shadow_layers(box_shadow: &str) -> Vec<ShadowLayer> {
    re!(WORD_RE, r"(?-u:\b)[a-zA-Z]+(?-u:\b)");
    re!(NUM_RE, format!(r"-?{d}*\.?{d}+", d = D));
    re!(INSET_RE, r"(?i)(?-u:\b)inset(?-u:\b)");
    if box_shadow.is_empty() || box_shadow == "none" {
        return Vec::new();
    }
    let mut layers = Vec::new();
    for layer in split_shadow_layers(box_shadow) {
        let color = CSS_COLOR_TOKEN_RE
            .find(layer)
            .and_then(|m| color::parse_any_color(Some(m.as_str())));
        let alpha = shadow_layer_alpha(layer);
        let cleaned = CSS_COLOR_TOKEN_RE.replace_all(layer, " ");
        let inset = INSET_RE.is_match(&cleaned);
        let cleaned = WORD_RE.replace_all(&cleaned, " ");
        let nums: Vec<f64> = NUM_RE
            .find_iter(&cleaned)
            .map(|m| parse_float(m.as_str()))
            .collect();
        if nums.len() < 2 || nums.iter().any(|n| !n.is_finite()) {
            continue;
        }
        layers.push(ShadowLayer {
            x: nums[0],
            y: nums[1],
            blur: nums.get(2).copied().unwrap_or(0.0),
            spread: nums.get(3).copied().unwrap_or(0.0),
            inset,
            alpha,
            color,
        });
    }
    layers
}

/// The alpha under which a shadow or a border paints nothing a reader sees.
pub const FAINT_PAINT_ALPHA: f64 = 0.05;

/// How far, per channel, a painted colour has to move the surface it lands on
/// before a reader sees an edge: a black shadow on a near-black page, or a
/// hairline in the card's own colour, draws nothing.
pub const VISIBLE_EDGE_CHANNEL_DELTA: f64 = 8.0;

/// Whether `paint` (with its own alpha) composited over the opaque `surface`
/// shows against it.
pub fn paint_shows_over(paint: &color::Rgba, surface: &color::Rgba) -> bool {
    let over = color::composite_color_over(paint, surface);
    math_max3(
        (over.r - surface.r).abs(),
        (over.g - surface.g).abs(),
        (over.b - surface.b).abs(),
    ) >= VISIBLE_EDGE_CHANNEL_DELTA
}

/// JS: checks.mjs#cssColorAlpha.
pub fn css_color_alpha(value: Option<&str>) -> f64 {
    if css_color_is_transparent(value) {
        return 0.0;
    }
    color::parse_any_color(value)
        .map(|c| c.alpha_or_one())
        .unwrap_or(1.0)
}

/// Input of `checkGptThinBorderWideShadow`.
// Serialize only: `border_widths: &[f64]` and `border_colors: &[Option<String>]`
// are borrowed slices, which serde cannot deserialize into.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct GptBorderShadowInput<'a> {
    pub border_widths: &'a [f64],
    /// JS `borderColors?.[index] || ''`: `None` for a missing array, and
    /// each entry `None` for a missing / empty color.
    pub border_colors: Option<&'a [Option<String>]>,
    pub box_shadow: Option<&'a str>,
}

/// JS: checks.mjs#borderWidthsFromStyle. Top, right, bottom, left.
pub fn border_widths_from_style(style: &dyn StyleMap) -> [f64; 4] {
    [
        parse_float_or_zero(style.prop("borderTopWidth").as_deref()),
        parse_float_or_zero(style.prop("borderRightWidth").as_deref()),
        parse_float_or_zero(style.prop("borderBottomWidth").as_deref()),
        parse_float_or_zero(style.prop("borderLeftWidth").as_deref()),
    ]
}

/// JS: checks.mjs#borderColorsFromStyle. Top, right, bottom, left (`''`
/// when unset).
pub fn border_colors_from_style(style: &dyn StyleMap) -> [String; 4] {
    [
        prop_or_empty(style, "borderTopColor"),
        prop_or_empty(style, "borderRightColor"),
        prop_or_empty(style, "borderBottomColor"),
        prop_or_empty(style, "borderLeftColor"),
    ]
}

/// A value `metricLengthPx` accepts: a JS number, a string, or anything else
/// (`undefined`, `null`, ...), which parses to nothing.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum LengthInput<'a> {
    Number(f64),
    Text(&'a str),
    Missing,
}

impl<'a> From<Option<&'a str>> for LengthInput<'a> {
    fn from(v: Option<&'a str>) -> Self {
        match v {
            Some(s) => LengthInput::Text(s),
            None => LengthInput::Missing,
        }
    }
}

impl From<Option<f64>> for LengthInput<'_> {
    fn from(v: Option<f64>) -> Self {
        match v {
            Some(n) => LengthInput::Number(n),
            None => LengthInput::Missing,
        }
    }
}

/// JS: checks.mjs#metricLengthPx (`font_size_px` default 16).
pub fn metric_length_px(value: LengthInput, font_size_px: f64) -> Option<f64> {
    match value {
        LengthInput::Number(n) if n.is_finite() => Some(n),
        LengthInput::Number(_) => None,
        LengthInput::Text(s) => resolve_length_px(Some(s), font_size_px),
        LengthInput::Missing => None,
    }
}

/// JS: checks.mjs#firstMetricLengthPx.
pub fn first_metric_length_px(font_size_px: f64, values: &[LengthInput]) -> Option<f64> {
    for v in values {
        if let Some(parsed) = metric_length_px(*v, font_size_px) {
            return Some(parsed);
        }
    }
    None
}

/// JS: checks.mjs#expandBoxShorthand. One to four values to
/// `[top, right, bottom, left]`.
// JS-PARITY: expandBoxShorthand on an empty array yields four `undefined`s;
// this returns an empty Vec (no caller reaches it with no parts).
pub fn expand_box_shorthand<T: Clone>(parts: &[T]) -> Vec<T> {
    match parts.len() {
        0 => vec![],
        1 => vec![
            parts[0].clone(),
            parts[0].clone(),
            parts[0].clone(),
            parts[0].clone(),
        ],
        2 => vec![
            parts[0].clone(),
            parts[1].clone(),
            parts[0].clone(),
            parts[1].clone(),
        ],
        3 => vec![
            parts[0].clone(),
            parts[1].clone(),
            parts[2].clone(),
            parts[1].clone(),
        ],
        _ => vec![
            parts[0].clone(),
            parts[1].clone(),
            parts[2].clone(),
            parts[3].clone(),
        ],
    }
}

/// JS: checks.mjs#clippedByInset. `clip-path: inset(...)` that removes the
/// whole box.
pub fn clipped_by_inset(clip_path: Option<&str>) -> bool {
    re!(INSET_RE, format!(r"^inset{ws}*\(([^)]*)\)$", ws = WS));
    re!(ROUND_RE, format!(r"{ws}+round{ws}+", ws = WS));
    re!(WS_RE, format!("{}+", WS));
    re!(PCT_RE, format!(r"^(-?{d}+(?:\.{d}+)?)%$", d = D));
    let s = js::to_lower_case(js::trim(clip_path.unwrap_or("")));
    let Some(m) = INSET_RE.captures(&s) else {
        return false;
    };
    let inner = m.get(1).map(|x| x.as_str()).unwrap_or("");
    let before_round = js::trim(ROUND_RE.split(inner).next().unwrap_or(""));
    if before_round.is_empty() {
        return false;
    }
    let parts: Vec<&str> = WS_RE.split(before_round).take(4).collect();
    let values = expand_box_shorthand(&parts);
    let mut nums: Vec<f64> = Vec::with_capacity(4);
    for v in values {
        let Some(pm) = PCT_RE.captures(js::trim(v)) else {
            return false;
        };
        nums.push(parse_float(pm.get(1).map(|x| x.as_str()).unwrap_or("")));
    }
    if nums.len() < 4 {
        return false;
    }
    let (top, right, bottom, left) = (nums[0], nums[1], nums[2], nums[3]);
    top + bottom >= 100.0 || left + right >= 100.0
}

/// JS: checks.mjs#clippedByRect. Legacy `clip: rect(...)` that removes the
/// whole box.
pub fn clipped_by_rect(clip: Option<&str>) -> bool {
    re!(RECT_RE, format!(r"^rect{ws}*\(([^)]*)\)$", ws = WS));
    re!(SEP_RE, format!(r"[,{ws}]+", ws = WS_CHARS));
    let s = js::to_lower_case(js::trim(clip.unwrap_or("")));
    let Some(m) = RECT_RE.captures(&s) else {
        return false;
    };
    let inner = m.get(1).map(|x| x.as_str()).unwrap_or("");
    let values: Vec<&str> = SEP_RE
        .split(inner)
        .map(js::trim)
        .filter(|v| !v.is_empty())
        .collect();
    if values.len() != 4 {
        return false;
    }
    let mut nums: Vec<f64> = Vec::with_capacity(4);
    for v in &values {
        match metric_length_px(LengthInput::Text(v), 16.0) {
            Some(n) => nums.push(n),
            None => return false,
        }
    }
    let (top, right, bottom, left) = (nums[0], nums[1], nums[2], nums[3]);
    bottom <= top || right <= left
}

/// The measured box `isScreenReaderOnlyTextStyle` may receive alongside the
/// style (JS `metrics = {}`; each field optional).
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
pub struct SrOnlyMetrics {
    pub width: Option<f64>,
    pub client_width: Option<f64>,
    pub height: Option<f64>,
    pub client_height: Option<f64>,
}

/// JS: checks.mjs#isScreenReaderOnlyTextStyle. Visually-hidden-but-readable
/// text: a 1x1 absolutely positioned clipped box, an `inset()` clip-path
/// that removes the box, or a legacy `clip: rect(...)` that does.
pub fn is_screen_reader_only_text_style(
    style: Option<&dyn StyleMap>,
    metrics: &SrOnlyMetrics,
) -> bool {
    let Some(style) = style else { return false };
    let clips_overflow = ["overflow", "overflowX", "overflowY"]
        .iter()
        .map(|p| js::to_lower_case(&prop_or_empty(style, p)))
        .any(|v| v == "hidden" || v == "clip");

    let font_size_prop = style.prop("fontSize");
    let font_size = match metric_length_px(LengthInput::from(font_size_prop.as_deref()), 16.0) {
        Some(n) if num_truthy(n) => n,
        _ => 16.0,
    };
    let width_prop = style.prop("width");
    let inline_size_prop = style.prop("inlineSize");
    let width = first_metric_length_px(
        font_size,
        &[
            LengthInput::from(metrics.width),
            LengthInput::from(metrics.client_width),
            LengthInput::from(width_prop.as_deref()),
            LengthInput::from(inline_size_prop.as_deref()),
        ],
    );
    let height_prop = style.prop("height");
    let block_size_prop = style.prop("blockSize");
    let height = first_metric_length_px(
        font_size,
        &[
            LengthInput::from(metrics.height),
            LengthInput::from(metrics.client_height),
            LengthInput::from(height_prop.as_deref()),
            LengthInput::from(block_size_prop.as_deref()),
        ],
    );
    let is_tiny = matches!((width, height), (Some(w), Some(h)) if w <= 2.0 && h <= 2.0);
    let is_absolutely_hidden = js::to_lower_case(&prop_or_empty(style, "position")) == "absolute"
        && is_tiny
        && clips_overflow;

    let clip_path_raw = match style.prop("clipPath") {
        Some(v) if !v.is_empty() => v,
        _ => prop_or_empty(style, "webkitClipPath"),
    };
    let clip_path = js::trim(&clip_path_raw).to_string();
    let clip_raw = prop_or_empty(style, "clip");
    let clip = js::trim(&clip_raw).to_string();
    is_absolutely_hidden || clipped_by_inset(Some(&clip_path)) || clipped_by_rect(Some(&clip))
}

// ─── Content hidden at rest ─────────────────────────────────────────────────

/// Input of `checkContentHiddenAtRest` (JS defaults: 0, 0, `[]`).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct ContentHiddenInput {
    pub total_chars: f64,
    pub hidden_chars: f64,
    pub hidden_samples: Vec<String>,
}

// ─── Background images drawn as icons ───────────────────────────────────────

/// The largest an icon is drawn, per axis: an external-link mark, an arrow
/// bullet, a chevron. A background image no larger than this sits beside the
/// text it decorates and cannot be the picture that text is read against.
pub const ICON_MAX_PX: f64 = 32.0;

/// Decodes `%XX` escapes, leaving anything malformed as it was.
fn percent_decode(s: &str) -> String {
    let hex = |b: u8| (b as char).to_digit(16).map(|d| d as u8);
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(hi), Some(lo)) = (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                out.push(hi * 16 + lo);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Resolves CSS escapes: `\\` and a hex code point (with its optional
/// trailing space), or `\\` and any other character, which stands for itself.
/// A serializer writes an unquoted `url()` this way, `width=\\'10\\'`.
fn css_unescape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        let mut hex = String::new();
        while hex.len() < 6 && chars.peek().map_or(false, |h| h.is_ascii_hexdigit()) {
            hex.push(chars.next().unwrap_or_default());
        }
        if hex.is_empty() {
            if let Some(next) = chars.next() {
                out.push(next);
            }
            continue;
        }
        if chars.peek().map_or(false, |w| *w == ' ') {
            chars.next();
        }
        out.push(u32::from_str_radix(&hex, 16).ok().and_then(char::from_u32).unwrap_or('\u{fffd}'));
    }
    out
}

/// The payload of the single `url()` in a background-image value, quotes
/// stripped and CSS escapes resolved; `None` where the value holds no `url()`
/// or more than one.
fn single_url(value: &str) -> Option<String> {
    let lower = value.to_ascii_lowercase();
    if lower.matches("url(").count() != 1 {
        return None;
    }
    let start = lower.find("url(")? + 4;
    let rest = value[start..].trim_start();
    let quote = rest.chars().next()?;
    let (body, close) = if quote == '"' || quote == '\'' {
        (&rest[1..], quote)
    } else {
        (rest, ')')
    };
    let mut escaped = false;
    for (i, c) in body.char_indices() {
        if escaped {
            escaped = false;
        } else if c == '\\' {
            escaped = true;
        } else if c == close {
            return Some(css_unescape(body[..i].trim_end()));
        }
    }
    None
}

re!(SVG_OPEN_TAG_RE, r"(?i)<svg(?:\s[^>]*)?>");
re!(
    SVG_DIMENSION_RE,
    r#"(?i)\s(width|height)\s*=\s*["']?\s*([0-9]*\.?[0-9]+)\s*(?:px)?\s*["']?"#
);
re!(
    SVG_VIEWBOX_RE,
    r#"(?i)\sviewbox\s*=\s*["']\s*-?[0-9.]+[\s,]+-?[0-9.]+[\s,]+([0-9.]+)[\s,]+([0-9.]+)"#
);

/// The intrinsic size of a background image written as an inline SVG data
/// URI, read off its root `<svg>` element's `width` and `height` (or, lacking
/// those, its `viewBox`). A value with no `url()`, more than one, a remote
/// file, or a base64 payload has no size this can read, because the pixels
/// are not in the computed style, and answers `None`.
pub fn data_svg_intrinsic_size(background_image: &str) -> Option<(f64, f64)> {
    let url = single_url(background_image)?;
    let (header, payload) = url.split_once(',')?;
    let header = header.to_ascii_lowercase();
    if !header.starts_with("data:image/svg+xml") || header.contains(";base64") {
        return None;
    }
    let svg = percent_decode(payload);
    let tag = SVG_OPEN_TAG_RE.find(&svg)?.as_str();
    let mut width = None;
    let mut height = None;
    for caps in SVG_DIMENSION_RE.captures_iter(tag) {
        let v = parse_float(&caps[2]);
        if caps[1].eq_ignore_ascii_case("width") {
            width = width.or(Some(v));
        } else {
            height = height.or(Some(v));
        }
    }
    if let (Some(w), Some(h)) = (width, height) {
        if w > 0.0 && h > 0.0 {
            return Some((w, h));
        }
    }
    let caps = SVG_VIEWBOX_RE.captures(tag)?;
    let (w, h) = (parse_float(&caps[1]), parse_float(&caps[2]));
    (w > 0.0 && h > 0.0).then_some((w, h))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn data_svg_intrinsic_size_reads_the_root_svg() {
        let icon = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='12'%3E%3Crect width='100' height='100'/%3E%3C/svg%3E\")";
        assert_eq!(data_svg_intrinsic_size(icon), Some((10.0, 12.0)));
        let viewbox = "url('data:image/svg+xml,<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\"><path stroke-width=\"900\"/></svg>')";
        assert_eq!(data_svg_intrinsic_size(viewbox), Some((16.0, 16.0)));
        // The static cascade serializes an unquoted `url()` with escapes.
        let escaped = "url(data:image/svg+xml,%3Csvg\\ xmlns=\\'http://www.w3.org/2000/svg\\'\\ width=\\'10\\'\\ height=\\'8\\'%3E%3Cpath\\ d=\\'M0\\ 0h10v10\\'/%3E%3C/svg%3E)no-repeat right center";
        assert_eq!(data_svg_intrinsic_size(escaped), Some((10.0, 8.0)));
        assert_eq!(data_svg_intrinsic_size("url(\"/img/external.png\")"), None);
        assert_eq!(
            data_svg_intrinsic_size("url(\"data:image/svg+xml;base64,PHN2Zz4=\")"),
            None
        );
        assert_eq!(data_svg_intrinsic_size("none"), None);
        assert_eq!(
            data_svg_intrinsic_size(
                "url(\"data:image/svg+xml,%3Csvg width='8' height='8'%3E%3C/svg%3E\"), url(\"hero.jpg\")"
            ),
            None,
            "two layers are not one icon"
        );
    }

    #[test]
    fn absolute_length_px_reads_the_whole_unit() {
        // 1in = 96px = 72pt = 6pc = 2.54cm = 25.4mm = 101.6Q.
        for (value, num) in [
            ("72pt", 72.0),
            ("6pc", 6.0),
            ("1in", 1.0),
            ("2.54cm", 2.54),
            ("25.4mm", 25.4),
            ("101.6Q", 101.6),
            ("72PT", 72.0),
            ("101.6q", 101.6),
        ] {
            assert_eq!(absolute_length_px(value, num), Some(96.0), "{value}");
        }
        // The unit is the whole trailing word: these end in a unit's letters
        // without being it, and none is an absolute length.
        let others = "10vmin 10vmax 10cqmin 10cqmax 10vw 10vh 10ch 10ex 10lh 10fr 10deg 10s \
                      10px 10em 10rem 10% 10 1.5 1e3 inherit calc(1pt)";
        for value in others.split(' ').chain([""]) {
            assert_eq!(absolute_length_px(value, 10.0), None, "{value:?}");
        }
        // A non-ASCII tail is no unit, and slicing for it must not panic.
        assert_eq!(absolute_length_px("10\u{2013}", 10.0), None);
        assert_eq!(absolute_length_px("72\u{00e9}pt", 72.0), Some(96.0));
    }

    // Expected values below were produced by running the JS functions in Node.

    #[test]
    fn split_shadow_layers_cases() {
        assert_eq!(
            split_shadow_layers("0 1px 2px rgba(0,0,0,0.3), 0 0 30px hsl(1, 2%, 3%)"),
            vec!["0 1px 2px rgba(0,0,0,0.3)", " 0 0 30px hsl(1, 2%, 3%)"]
        );
        assert_eq!(split_shadow_layers("none"), vec!["none"]);
    }

    #[test]
    fn box_shadow_paints_cases() {
        assert!(!box_shadow_paints("none"));
        assert!(!box_shadow_paints(""));
        // Tailwind's ring and shadow variables at rest.
        assert!(!box_shadow_paints(
            "rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px"
        ));
        assert!(!box_shadow_paints("rgb(0, 0, 0) 0px 0px 0px 0px"));
        assert!(!box_shadow_paints("rgba(0, 0, 0, 0) 0px 4px 6px 0px"));
        assert!(box_shadow_paints("rgb(229, 231, 235) 0px 1px 0px 0px"));
        assert!(box_shadow_paints(
            "rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0.1) 0px 0px 0px 1px"
        ));
        assert!(box_shadow_paints("0 2px 4px"));
        // review of #941: a negative spread with no blur keeps the shape
        // under the box, or cuts a hole over all of it when inset.
        assert!(!box_shadow_paints("rgb(0, 0, 0) 0px 0px 0px -1px"));
        assert!(!box_shadow_paints("rgb(0, 0, 0) 0px 0px 0px -4px inset"));
        assert!(!box_shadow_paints("rgb(0, 0, 0) 2px -2px 0px -3px"));
        // A 4px diagonal move under a 4px pull still shows past a rounded
        // corner (review of #968): the offset is read as a distance.
        assert!(box_shadow_paints("rgb(0, 0, 0) 4px 4px 0px -4px"));
        assert!(box_shadow_paints("rgb(0, 0, 0) 0px 4px 0px -3px"), "offset past the spread");
        assert!(box_shadow_paints("rgb(0, 0, 0) 0px 0px 6px -2px"), "a blur reaches out");
    }

    #[test]
    fn radius_corner_shorthand_cases() {
        let c = |v: &str| parse_radius_corners(Some(v), 200.0).expect(v);
        assert_eq!(
            c("8px"),
            Corners {
                top_left: 8.0,
                top_right: 8.0,
                bottom_right: 8.0,
                bottom_left: 8.0,
            }
        );
        assert_eq!(
            c("8px 2px"),
            Corners {
                top_left: 8.0,
                top_right: 2.0,
                bottom_right: 8.0,
                bottom_left: 2.0,
            }
        );
        assert_eq!(
            c("1px 2px 3px"),
            Corners {
                top_left: 1.0,
                top_right: 2.0,
                bottom_right: 3.0,
                bottom_left: 2.0,
            }
        );
        assert_eq!(
            c("0px 10px 10px 0px"),
            Corners {
                top_left: 0.0,
                top_right: 10.0,
                bottom_right: 10.0,
                bottom_left: 0.0,
            }
        );
        // The vertical half after `/` is not what a stripe runs along.
        assert_eq!(c("12px / 4px").top_left, 12.0);
        // review of #941: but a zero vertical radius leaves the corner
        // square, whatever its horizontal one.
        assert_eq!(
            c("10px / 0"),
            Corners { top_left: 0.0, top_right: 0.0, bottom_right: 0.0, bottom_left: 0.0 }
        );
        assert_eq!(
            c("10px / 0px 6px"),
            Corners { top_left: 0.0, top_right: 10.0, bottom_right: 0.0, bottom_left: 10.0 }
        );
        assert_eq!(parse_radius_corners(Some("10px / calc(1px)"), 200.0), None);
        assert_eq!(parse_radius_corner_px(Some("10px 0px"), 200.0), Some(0.0));
        assert_eq!(parse_radius_corner_px(Some("10px 4px"), 200.0), Some(10.0));
        assert_eq!(parse_radius_corner_px(Some("10px"), 200.0), Some(10.0));
        // rem and em read against the 16px root default; % against the box.
        assert_eq!(c("0.375rem").top_left, 6.0);
        assert_eq!(c("0.5em").bottom_right, 8.0);
        // Units are case-insensitive in CSS.
        assert_eq!(c("0.5REM").top_left, 8.0);
        assert_eq!(c("10PX").top_left, 10.0);
        assert_eq!(c("50%").top_right, 100.0);
        assert_eq!(c("0").top_left, 0.0);
        assert_eq!(c("0 10px 10px 0").bottom_left, 0.0);
        // `em` reads against the element's font size, `rem` against the root.
        let em = |v: &str, font: f64| parse_radius_corners_em(Some(v), 200.0, font).expect(v);
        assert!((em("0.3em", 12.0).top_left - 3.6).abs() < 1e-9);
        assert_eq!(em("0.5rem", 12.0).top_left, 8.0);
        assert_eq!(
            parse_radius_corner_px_em(Some("0.5em"), 200.0, 24.0),
            Some(12.0)
        );
    }

    #[test]
    fn radius_corners_unreadable_values_are_unknown() {
        let c = |v: Option<&str>| parse_radius_corners(v, 200.0);
        // A radius this cannot resolve is unknown, not zero: the caller keeps
        // reporting rather than reading the box as square.
        assert_eq!(c(Some("calc(0.5rem)")), None);
        assert_eq!(c(Some("var(--radius)")), None);
        assert_eq!(c(Some("0px calc(8px + 2px)")), None);
        assert_eq!(c(Some("1vw")), None);
        assert_eq!(c(Some("")), None);
        assert_eq!(c(Some("   ")), None);
        assert_eq!(c(None), None);
    }

    #[test]
    fn radius_corner_longhand_cases() {
        let c = |v: &str| parse_radius_corner_px(Some(v), 200.0);
        assert_eq!(c("10px"), Some(10.0));
        assert_eq!(c("0.5rem"), Some(8.0));
        // A longhand may carry both radii; a stripe runs along the first.
        assert_eq!(c("10px 4px"), Some(10.0));
        assert_eq!(c("50%"), Some(100.0));
        assert_eq!(c("calc(1rem)"), None);
        assert_eq!(c(""), None);
        assert_eq!(parse_radius_corner_px(None, 200.0), None);
    }

    #[test]
    fn resolve_var_refs_handles_nested_fallbacks() {
        let props = HashMap::new();
        assert_eq!(
            resolve_var_refs("var(--outer, var(--inner, 0))", &props, 0),
            "0"
        );
        assert_eq!(
            resolve_var_refs("calc(1px + var(--missing, 2px))", &props, 0),
            "calc(1px + 2px)"
        );
    }
}
