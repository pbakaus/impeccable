//! Section 4 (`resolveBackground` family) in browser mode
//! (`DETECTOR_IS_BROWSER === true`; the static-only branches — inline
//! `style=""` peeks and customPropMap resolution — are not reachable here
//! and are not ported). See browser/mod.rs.

use super::dom::{Dom, ElId};
use crate::color::{
    composite_color_over, is_no_paint_color_value, parse_any_color, parse_gradient_colors,
    parse_rgb, split_top_level_commas, Rgba,
};
use crate::js;
use once_cell::sync::Lazy;
use regex::Regex;

macro_rules! re {
    ($name:ident, $pat:expr) => {
        static $name: Lazy<Regex> = Lazy::new(|| Regex::new(&$pat).expect(stringify!($name)));
    };
}

// JS `/gradient/i`, `/url\s*\(/i`, `/gradient\s*\(/i`, `/^\s*url\s*\(/i`,
// `/^currentcolor$/i`: ASCII case folding (`ci`) and the JS `\s` set (`WS`).
re!(GRADIENT_RE, js::ci("gradient"));
re!(URL_RE, format!("{}{}*\\(", js::ci("url"), js::WS));
re!(GRADIENT_PAREN_RE, format!("{}{}*\\(", js::ci("gradient"), js::WS));
re!(URL_LEADING_RE, format!("^{}*{}{}*\\(", js::WS, js::ci("url"), js::WS));
re!(CURRENTCOLOR_RE, format!("^{}$", js::ci("currentcolor")));

/// JS `{ color, unresolved }` from resolveBackgroundInfo.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct BackgroundInfo {
    pub color: Option<Rgba>,
    pub unresolved: bool,
}

/// JS `parseRgb(x) || parseAnyColor(x)`.
fn parse_rgb_or_any(value: &str) -> Option<Rgba> {
    parse_rgb(Some(value)).or_else(|| parse_any_color(Some(value)))
}

/// JS: checks.mjs#readOwnBackgroundColor(el, computedStyle) — in the browser
/// `DETECTOR_IS_BROWSER` short-circuits before the inline-shorthand peek, so
/// this is the computed-style parse alone.
pub fn read_own_background_color(dom: &dyn Dom, el: ElId) -> Option<Rgba> {
    parse_rgb_or_any(&dom.style(el, "backgroundColor"))
}

/// JS: checks.mjs#readCascadeBackgroundColor(current, style, customPropMap)
/// — browser branch: computed style only.
fn read_cascade_background_color(dom: &dyn Dom, el: ElId) -> Option<Rgba> {
    parse_rgb_or_any(&dom.style(el, "backgroundColor"))
}

/// JS `bg && bg.a > 0.1` — `bg.a` is `undefined` (never for parsed
/// colors, but keep JS `undefined > 0.1 === false`).
fn alpha_gt(bg: &Rgba, t: f64) -> bool {
    match bg.a {
        Some(a) => a > t,
        None => false,
    }
}

/// JS: checks.mjs#resolveBackgroundInfo(el, win, customPropMap) in browser mode.
pub fn resolve_background_info(dom: &dyn Dom, el: ElId) -> BackgroundInfo {
    let mut current = Some(el);
    let mut overlays: Vec<Rgba> = Vec::new();
    let flatten = |overlays: &Vec<Rgba>, base: Rgba| -> Rgba {
        let mut acc = base;
        for o in overlays.iter().rev() {
            acc = composite_color_over(o, &acc);
        }
        acc
    };
    while let Some(cur) = current {
        let bg_image = dom.style(cur, "backgroundImage");
        let has_gradient_or_url = !bg_image.is_empty()
            && bg_image != "none"
            && (GRADIENT_RE.is_match(&bg_image) || URL_RE.is_match(&bg_image));

        let mut bg = read_cascade_background_color(dom, cur);

        let bg_color_raw = dom.style(cur, "backgroundColor");
        if (bg.is_none() || bg.map_or(false, |b| b.alpha_or_one() < 0.1))
            && CURRENTCOLOR_RE.is_match(js::trim(&bg_color_raw))
        {
            // JS: `bg.a < 0.1` with `a` undefined is false; alpha_or_one keeps
            // that (undefined never < 0.1 → treat as 1).
            let color = dom.style(cur, "color");
            bg = parse_rgb(Some(&color)).or_else(|| parse_any_color(Some(&color)));
        }

        match bg {
            Some(b) if alpha_gt(&b, 0.1) => {
                if b.a.map_or(false, |a| a >= 0.99) {
                    return BackgroundInfo {
                        color: Some(flatten(&overlays, b)),
                        unresolved: false,
                    };
                }
                overlays.push(b);
            }
            None if !is_no_paint_color_value(Some(&bg_color_raw)) => {
                return BackgroundInfo {
                    color: None,
                    unresolved: true,
                };
            }
            _ => {}
        }

        if has_gradient_or_url {
            let layers = split_top_level_commas(&bg_image);
            let top_paint_layer = layers
                .iter()
                .find(|layer| GRADIENT_PAREN_RE.is_match(layer) || URL_RE.is_match(layer));
            let gradient_on_top = match top_paint_layer {
                Some(layer) => {
                    GRADIENT_PAREN_RE.is_match(layer) && !URL_LEADING_RE.is_match(layer)
                }
                None => false,
            };
            if !gradient_on_top {
                return BackgroundInfo {
                    color: None,
                    unresolved: true,
                };
            }
            let top = top_paint_layer.expect("gradient_on_top implies a layer");
            let url_beneath = layers
                .iter()
                .any(|layer| layer != top && URL_RE.is_match(layer));
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
        current = dom.parent(cur);
    }
    BackgroundInfo {
        color: Some(flatten(&overlays, Rgba::new(255.0, 255.0, 255.0, 1.0))),
        unresolved: false,
    }
}

/// JS: checks.mjs#resolveBackground(el, win, customPropMap)
pub fn resolve_background(dom: &dyn Dom, el: ElId) -> Option<Rgba> {
    resolve_background_info(dom, el).color
}

/// JS: checks.mjs#compositeGradientStops(stops, gradientEl, win, customPropMap)
fn composite_gradient_stops(dom: &dyn Dom, stops: Vec<Rgba>, gradient_el: ElId) -> Option<Vec<Rgba>> {
    let has_alpha = stops.iter().any(|s| s.alpha_or_one() < 0.99);
    if !has_alpha {
        return Some(stops);
    }
    let base_el = dom.parent(gradient_el).unwrap_or(gradient_el);
    let base = resolve_background(dom, base_el);
    let mut out = Vec::new();
    for s in stops {
        let a = s.alpha_or_one();
        if a >= 0.99 {
            out.push(s);
            continue;
        }
        if let Some(b) = base {
            out.push(composite_color_over(&s, &b));
        }
    }
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

/// JS: checks.mjs#resolveGradientStops(el, win, customPropMap) in browser mode.
pub fn resolve_gradient_stops(dom: &dyn Dom, el: ElId) -> Option<Vec<Rgba>> {
    let mut current = Some(el);
    let mut overlays: Vec<Rgba> = Vec::new();
    while let Some(cur) = current {
        let bg_image = dom.style(cur, "backgroundImage");
        if !bg_image.is_empty() && bg_image != "none" && URL_RE.is_match(&bg_image) {
            return None;
        }
        let mut stops: Option<Vec<Rgba>> = None;
        if !bg_image.is_empty() && bg_image != "none" && GRADIENT_RE.is_match(&bg_image) {
            let parsed = parse_gradient_colors(Some(&bg_image));
            if !parsed.is_empty() {
                stops = Some(parsed);
            }
        }
        if let Some(stops) = stops {
            let composited = composite_gradient_stops(dom, stops, cur);
            let Some(composited) = composited else { return None };
            if overlays.is_empty() {
                return Some(composited);
            }
            return Some(
                composited
                    .into_iter()
                    .map(|stop| {
                        let mut acc = stop;
                        for o in overlays.iter().rev() {
                            acc = composite_color_over(o, &acc);
                        }
                        acc
                    })
                    .collect(),
            );
        }
        let bg = read_cascade_background_color(dom, cur);
        if let Some(b) = bg {
            if alpha_gt(&b, 0.1) {
                if b.a.map_or(false, |a| a >= 0.99) {
                    return None;
                }
                overlays.push(b);
            }
        }
        current = dom.parent(cur);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::browser::fake_dom::FakeDom;

    #[test]
    fn opaque_ancestor_wins_and_translucent_overlays_flatten() {
        let mut d = FakeDom::new();
        let (html, body) = d.with_page();
        d.set_style(html, "backgroundColor", "rgba(0, 0, 0, 0)");
        d.set_style(html, "backgroundImage", "none");
        d.set_style(body, "backgroundColor", "rgb(0, 0, 0)");
        d.set_style(body, "backgroundImage", "none");
        let card = d.add(Some(body), "div");
        d.set_style(card, "backgroundColor", "rgba(255, 255, 255, 0.5)");
        d.set_style(card, "backgroundImage", "none");
        let info = resolve_background_info(&d, card);
        assert!(!info.unresolved);
        assert_eq!(info.color, Some(Rgba::new(128.0, 128.0, 128.0, 1.0)));
    }

    #[test]
    fn transparent_chain_falls_back_to_white_and_url_layer_abstains() {
        let mut d = FakeDom::new();
        let (html, body) = d.with_page();
        for e in [html, body] {
            d.set_style(e, "backgroundColor", "rgba(0, 0, 0, 0)");
            d.set_style(e, "backgroundImage", "none");
        }
        let p = d.add(Some(body), "p");
        d.set_style(p, "backgroundColor", "rgba(0, 0, 0, 0)");
        d.set_style(p, "backgroundImage", "none");
        assert_eq!(resolve_background(&d, p), Some(Rgba::new(255.0, 255.0, 255.0, 1.0)));
        d.set_style(body, "backgroundImage", "url(\"photo.png\")");
        let info = resolve_background_info(&d, p);
        assert!(info.unresolved && info.color.is_none());
    }

    #[test]
    fn gradient_on_top_yields_stops_and_unparseable_color_abstains() {
        let mut d = FakeDom::new();
        let (html, body) = d.with_page();
        d.set_style(html, "backgroundColor", "rgba(0, 0, 0, 0)");
        d.set_style(html, "backgroundImage", "none");
        d.set_style(body, "backgroundColor", "rgba(0, 0, 0, 0)");
        d.set_style(body, "backgroundImage", "linear-gradient(rgb(10, 20, 30), rgb(40, 50, 60))");
        let p = d.add(Some(body), "p");
        d.set_style(p, "backgroundColor", "rgba(0, 0, 0, 0)");
        d.set_style(p, "backgroundImage", "none");
        let info = resolve_background_info(&d, p);
        assert!(!info.unresolved && info.color.is_none());
        let stops = resolve_gradient_stops(&d, p).unwrap();
        assert_eq!(stops.len(), 2);
        assert_eq!(stops[0], Rgba::new(10.0, 20.0, 30.0, 1.0));
        d.set_style(p, "backgroundColor", "color(display-p3 1 0 0 / 0.5)");
        // JS parseAnyColor may or may not read display-p3; whatever it does,
        // an unreadable, non-no-paint value abstains.
        let info = resolve_background_info(&d, p);
        if parse_any_color(Some("color(display-p3 1 0 0 / 0.5)")).is_none() {
            assert!(info.unresolved);
        }
    }

    #[test]
    fn currentcolor_background_paints_with_text_color() {
        let mut d = FakeDom::new();
        let (html, body) = d.with_page();
        for e in [html, body] {
            d.set_style(e, "backgroundColor", "rgba(0, 0, 0, 0)");
            d.set_style(e, "backgroundImage", "none");
        }
        let chip = d.add(Some(body), "span");
        d.set_style(chip, "backgroundColor", "currentcolor");
        d.set_style(chip, "backgroundImage", "none");
        d.set_style(chip, "color", "rgb(1, 2, 3)");
        assert_eq!(resolve_background(&d, chip), Some(Rgba::new(1.0, 2.0, 3.0, 1.0)));
    }
}
