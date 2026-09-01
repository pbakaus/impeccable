//! Section 4 of `cli/engine/rules/checks.mjs`: the unified background walk
//! (`readOwnBackgroundColor`, `readCascadeBackgroundColor`,
//! `resolveBackgroundInfo`, `resolveBackground`, `resolveGradientStops`,
//! `compositeGradientStops`, `resolveBorderRadiusPx`), static-engine
//! branches only (`DETECTOR_IS_BROWSER === false`).

use crate::cascade::StyleValues;
use crate::dom::StaticElement;
use impeccable_core::checks::measures::{parse_color_resolved, parse_radius_to_px, CustomProps};
use impeccable_core::color::{
    composite_color_over, is_no_paint_color_value, parse_any_color, parse_gradient_colors,
    parse_rgb, split_top_level_commas, Rgba,
};
use impeccable_core::js;
use once_cell::sync::Lazy;
use regex::Regex;

/// `style.x || ''` on a computed style map.
pub fn sv<'a>(style: &'a StyleValues, key: &str) -> &'a str {
    style.get(key).map(|s| s.as_str()).unwrap_or("")
}

/// `style.x` as JS sees it: `None` for a key the style object never had.
pub fn sv_opt<'a>(style: &'a StyleValues, key: &str) -> Option<&'a str> {
    style.get(key).map(|s| s.as_str())
}

/// JS `c.a >= x` where `a` may be undefined (then false).
pub fn a_ge(c: &Rgba, x: f64) -> bool {
    c.a.is_some_and(|a| a >= x)
}
/// JS `c.a > x`.
pub fn a_gt(c: &Rgba, x: f64) -> bool {
    c.a.is_some_and(|a| a > x)
}
/// JS `c.a < x`.
pub fn a_lt(c: &Rgba, x: f64) -> bool {
    c.a.is_some_and(|a| a < x)
}

/// The static engine's `customPropMap` is always `null`; kept as a
/// parameter so the port mirrors the JS signatures.
pub type CustomPropMap<'a> = Option<&'a dyn CustomProps>;

static INLINE_BG_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(&format!(
        r"(?i)background(?:-color)?{ws}*:{ws}*([^;]+)",
        ws = js::WS
    ))
    .expect("INLINE_BG_RE")
});
static INLINE_BG_IMAGE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(&format!(
        r"(?i)background(?:-image)?{ws}*:{ws}*([^;]+)",
        ws = js::WS
    ))
    .expect("INLINE_BG_IMAGE_RE")
});
static GRADIENT_RE: Lazy<Regex> = Lazy::new(|| Regex::new("(?i)gradient").expect("GRADIENT_RE"));
static GRADIENT_CALL_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(&format!(r"(?i)gradient{ws}*\(", ws = js::WS)).expect("GRADIENT_CALL_RE")
});
static URL_CALL_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(&format!(r"(?i)url{ws}*\(", ws = js::WS)).expect("URL_CALL_RE"));
static URL_START_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(&format!(r"(?i)^{ws}*url{ws}*\(", ws = js::WS)).expect("URL_START_RE"));
static HEX_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)#([0-9a-f]{6}|[0-9a-f]{3})(?-u:\b)").expect("HEX_RE"));
static CURRENTCOLOR_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new("(?i)^currentcolor$").expect("CURRENTCOLOR_RE"));

/// `rawStyle.match(/background(?:-color)?\s*:\s*([^;]+)/i)` → trimmed value.
fn inline_bg(el: &StaticElement<'_>) -> String {
    let raw = el.get_attribute("style").unwrap_or("");
    INLINE_BG_RE
        .captures(raw)
        .map(|m| js::trim(&m[1]).to_string())
        .unwrap_or_default()
}

fn hex_to_rgba(h: &str) -> Rgba {
    let p = |s: &str| js::parse_int(s, 16);
    if h.len() == 6 {
        Rgba::new(p(&h[0..2]), p(&h[2..4]), p(&h[4..6]), 1.0)
    } else {
        let d = |i: usize| {
            let c = &h[i..i + 1];
            p(&format!("{c}{c}"))
        };
        Rgba::new(d(0), d(1), d(2), 1.0)
    }
}

/// JS: checks.mjs#readOwnBackgroundColor(el, computedStyle)
pub fn read_own_background_color(el: &StaticElement<'_>, style: &StyleValues) -> Option<Rgba> {
    let bgc = sv_opt(style, "backgroundColor");
    let bg = parse_rgb(bgc).or_else(|| parse_any_color(bgc));
    if bg.as_ref().is_some_and(|c| a_ge(c, 0.1)) {
        return bg;
    }
    let inline = inline_bg(el);
    if inline.is_empty() {
        return bg;
    }
    if GRADIENT_RE.is_match(&inline) || URL_CALL_RE.is_match(&inline) {
        return bg;
    }
    if let Some(from_rgb) = parse_rgb(Some(&inline)) {
        return Some(from_rgb);
    }
    if let Some(m) = HEX_RE.captures(&inline) {
        return Some(hex_to_rgba(&m[1]));
    }
    bg
}

/// JS: checks.mjs#readCascadeBackgroundColor(current, style, customPropMap)
pub fn read_cascade_background_color(
    current: &StaticElement<'_>,
    style: &StyleValues,
    custom_props: CustomPropMap<'_>,
) -> Option<Rgba> {
    let bgc = sv_opt(style, "backgroundColor");
    let mut bg = parse_rgb(bgc).or_else(|| parse_any_color(bgc));
    if bg.is_none() || bg.as_ref().is_some_and(|c| a_lt(c, 0.1)) {
        if let Some(map) = custom_props {
            bg = parse_color_resolved(bgc, Some(map));
        }
        if bg.is_none() || bg.as_ref().is_some_and(|c| a_lt(c, 0.1)) {
            let inline = inline_bg(current);
            if !inline.is_empty()
                && !GRADIENT_RE.is_match(&inline)
                && !URL_CALL_RE.is_match(&inline)
            {
                bg = parse_color_resolved(Some(&inline), custom_props)
                    .or_else(|| parse_any_color(Some(&inline)));
            }
        }
    }
    bg
}

/// `{ color, unresolved }` from `resolveBackgroundInfo`.
#[derive(Debug, Clone, PartialEq)]
pub struct BackgroundInfo {
    pub color: Option<Rgba>,
    pub unresolved: bool,
}

fn flatten(overlays: &[Rgba], base: Rgba) -> Rgba {
    let mut acc = base;
    for o in overlays.iter().rev() {
        acc = composite_color_over(o, &acc);
    }
    acc
}

/// JS: checks.mjs#resolveBackgroundInfo(el, win, customPropMap)
pub fn resolve_background_info(
    el: &StaticElement<'_>,
    custom_props: CustomPropMap<'_>,
) -> BackgroundInfo {
    let mut current = Some(*el);
    let mut overlays: Vec<Rgba> = Vec::new();
    while let Some(cur) = current {
        let style = cur.style();
        let bg_image = sv(style, "backgroundImage");
        let has_gradient_or_url = !bg_image.is_empty()
            && bg_image != "none"
            && (GRADIENT_RE.is_match(bg_image) || URL_CALL_RE.is_match(bg_image));

        let mut bg = read_cascade_background_color(&cur, style, custom_props);

        if (bg.is_none() || bg.as_ref().is_some_and(|c| a_lt(c, 0.1)))
            && CURRENTCOLOR_RE.is_match(js::trim(sv(style, "backgroundColor")))
        {
            let color = sv_opt(style, "color");
            bg = parse_rgb(color).or_else(|| parse_color_resolved(color, custom_props));
        }

        if let Some(c) = bg.as_ref().filter(|c| a_gt(c, 0.1)) {
            if a_ge(c, 0.99) {
                return BackgroundInfo {
                    color: Some(flatten(&overlays, *c)),
                    unresolved: false,
                };
            }
            overlays.push(*c);
        } else if bg.is_none() && !is_no_paint_color_value(sv_opt(style, "backgroundColor")) {
            return BackgroundInfo {
                color: None,
                unresolved: true,
            };
        }
        if has_gradient_or_url {
            let layers = split_top_level_commas(bg_image);
            let top_paint_layer = layers
                .iter()
                .find(|layer| GRADIENT_CALL_RE.is_match(layer) || URL_CALL_RE.is_match(layer));
            let gradient_on_top = top_paint_layer.is_some_and(|layer| {
                GRADIENT_CALL_RE.is_match(layer) && !URL_START_RE.is_match(layer)
            });
            if !gradient_on_top {
                return BackgroundInfo {
                    color: None,
                    unresolved: true,
                };
            }
            let top = top_paint_layer.unwrap();
            let url_beneath = layers
                .iter()
                .any(|layer| layer != top && URL_CALL_RE.is_match(layer));
            if url_beneath {
                let top_stops = parse_gradient_colors(Some(top));
                let provably_opaque =
                    !top_stops.is_empty() && top_stops.iter().all(|s| s.alpha_or_one() >= 0.99);
                if !provably_opaque {
                    return BackgroundInfo {
                        color: None,
                        unresolved: true,
                    };
                }
            }
            return BackgroundInfo {
                color: None,
                unresolved: false,
            };
        }
        current = cur.parent_element();
    }
    BackgroundInfo {
        color: Some(flatten(&overlays, Rgba::new(255.0, 255.0, 255.0, 1.0))),
        unresolved: false,
    }
}

/// JS: checks.mjs#resolveBackground(el, win, customPropMap)
pub fn resolve_background(el: &StaticElement<'_>, custom_props: CustomPropMap<'_>) -> Option<Rgba> {
    resolve_background_info(el, custom_props).color
}

/// JS: checks.mjs#resolveGradientStops(el, win, customPropMap)
pub fn resolve_gradient_stops(
    el: &StaticElement<'_>,
    custom_props: CustomPropMap<'_>,
) -> Option<Vec<Rgba>> {
    let mut current = Some(*el);
    let mut overlays: Vec<Rgba> = Vec::new();
    while let Some(cur) = current {
        let style = cur.style();
        let bg_image = sv(style, "backgroundImage");
        if !bg_image.is_empty() && bg_image != "none" && URL_CALL_RE.is_match(bg_image) {
            return None;
        }
        let mut stops: Option<Vec<Rgba>> = None;
        if !bg_image.is_empty() && bg_image != "none" && GRADIENT_RE.is_match(bg_image) {
            let parsed = parse_gradient_colors(Some(bg_image));
            if !parsed.is_empty() {
                stops = Some(parsed);
            }
        }
        if stops.is_none() {
            let raw = cur.get_attribute("style").unwrap_or("");
            if let Some(m) = INLINE_BG_IMAGE_RE.captures(raw) {
                if GRADIENT_RE.is_match(&m[1]) {
                    let parsed = parse_gradient_colors(Some(&m[1]));
                    if !parsed.is_empty() {
                        stops = Some(parsed);
                    }
                }
            }
        }
        if let Some(stops) = stops {
            let composited = composite_gradient_stops(&stops, &cur, custom_props);
            let Some(composited) = composited else {
                return None;
            };
            if overlays.is_empty() {
                return Some(composited);
            }
            return Some(
                composited
                    .into_iter()
                    .map(|stop| flatten(&overlays, stop))
                    .collect(),
            );
        }
        let bg = read_cascade_background_color(&cur, style, custom_props);
        if let Some(c) = bg.filter(|c| a_gt(c, 0.1)) {
            if a_ge(&c, 0.99) {
                return None;
            }
            overlays.push(c);
        }
        current = cur.parent_element();
    }
    None
}

/// JS: checks.mjs#compositeGradientStops(stops, gradientEl, win, customPropMap)
pub fn composite_gradient_stops(
    stops: &[Rgba],
    gradient_el: &StaticElement<'_>,
    custom_props: CustomPropMap<'_>,
) -> Option<Vec<Rgba>> {
    let has_alpha = stops.iter().any(|s| s.alpha_or_one() < 0.99);
    if !has_alpha {
        return Some(stops.to_vec());
    }
    let base_el = gradient_el.parent_element().unwrap_or(*gradient_el);
    let base = resolve_background(&base_el, custom_props);
    let mut out: Vec<Rgba> = Vec::new();
    for s in stops {
        let a = s.alpha_or_one();
        if a >= 0.99 {
            out.push(*s);
            continue;
        }
        if let Some(base) = base.as_ref() {
            out.push(composite_color_over(s, base));
        }
    }
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

/// JS: checks.mjs#resolveBorderRadiusPx(el, style, widthPx, win)
pub fn resolve_border_radius_px(style: &StyleValues, width_px: f64) -> f64 {
    parse_radius_to_px(sv_opt(style, "borderRadius"), width_px).unwrap_or(0.0)
}
