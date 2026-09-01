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
use crate::js::{self, ci, math_max, math_max3, parse_float, WS, WS_CHARS};
use crate::js_ext_b::num_truthy;
use crate::rules::types::D;
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
    re!(
        VAR_RE,
        format!(
            r"var\({ws}*(--[a-zA-Z0-9_-]+){ws}*(?:,{ws}*([^)]+))?\)",
            ws = WS
        )
    );
    if !raw.contains("var(") {
        return raw.to_string();
    }
    if depth > 8 {
        return raw.to_string();
    }
    VAR_RE
        .replace_all(raw, |caps: &regex::Captures| {
            let name = caps.get(1).map(|m| m.as_str()).unwrap_or("");
            if let Some(v) = custom_props.get(name) {
                return resolve_var_refs(&v, custom_props, depth + 1);
            }
            match caps.get(2) {
                Some(fb) if !fb.as_str().is_empty() => {
                    resolve_var_refs(js::trim(fb.as_str()), custom_props, depth + 1)
                }
                _ => caps.get(0).map(|m| m.as_str()).unwrap_or("").to_string(),
            }
        })
        .into_owned()
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
    Some(num * font_size_px)
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

/// JS: checks.mjs#parseRadialGradientStops. The ordered stops of the FIRST
/// non-repeating radial-gradient in a background value, or `None` when
/// there is no plain radial-gradient to read.
pub fn parse_radial_gradient_stops(value: Option<&str>) -> Option<Vec<GradientStop>> {
    re!(HAS_RADIAL, ci("radial-gradient"));
    re!(
        GRAD_RE,
        format!(r"({}-)?{}\(", ci("repeating"), ci("radial-gradient"))
    );
    re!(TRANSPARENT_ONLY, format!("^{}$", ci("transparent")));
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
        let mut depth = 0i32;
        let mut end: Option<usize> = None;
        for (i, &b) in bytes.iter().enumerate().skip(open) {
            if b == b'(' {
                depth += 1;
            } else if b == b')' {
                depth -= 1;
                if depth == 0 {
                    end = Some(i);
                    break;
                }
            }
        }
        let Some(end) = end else { return None };
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
                .map(|a| {
                    let Some(tok) = SPOTLIGHT_COLOR_TOKEN_RE.find(a) else {
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
                })
                .collect(),
        );
    }
    None
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

/// JS: checks.mjs#shadowMaxBlurPx. Largest blur radius across the layers
/// whose color alpha is at least `min_alpha` (JS default 0).
pub fn shadow_max_blur_px(box_shadow: Option<&str>, min_alpha: Option<f64>) -> f64 {
    re!(WORD_RE, r"(?-u:\b)[a-zA-Z]+(?-u:\b)");
    re!(NUM_RE, format!(r"-?{d}*\.?{d}+", d = D));
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

#[cfg(test)]
mod tests {
    use super::*;

    // Expected values below were produced by running the JS functions in Node.

    #[test]
    fn split_shadow_layers_cases() {
        assert_eq!(
            split_shadow_layers("0 1px 2px rgba(0,0,0,0.3), 0 0 30px hsl(1, 2%, 3%)"),
            vec!["0 1px 2px rgba(0,0,0,0.3)", " 0 0 30px hsl(1, 2%, 3%)"]
        );
        assert_eq!(split_shadow_layers("none"), vec!["none"]);
    }
}
