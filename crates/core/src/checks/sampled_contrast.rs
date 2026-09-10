//! Pixel-sampled contrast for text over a `url()` background image in the
//! static engine (#560). Outside a browser there is no CORS and no canvas
//! taint, so the engine reads the image itself; what it cannot know is
//! layout. The verdict is therefore coarse: a fixed grid over the whole
//! image, and a finding only when nearly all of it fails. A photo with a dark
//! third under the headline passes; white text on a near-white texture does
//! not, wherever the text sits.
//!
//! This module is the decisions: grid geometry, the decoration gate, the
//! wash and compositing rules, the percentile verdict and its label. Reading
//! and decoding the image is the html crate's job.

use crate::checks::rules::{safe_tag_unstyled, ColorOpts, RuleHit};
use crate::color::{color_to_hex, composite_color_over, contrast_ratio, Rgba};
use crate::constants::{WCAG_LARGE_BOLD_TEXT_PX, WCAG_LARGE_TEXT_PX};
use crate::js::{number_to_string, parse_float, to_fixed};

/// Grid points per axis: 6x6 = 36 samples, sampling rather than scanning.
const GRID: usize = 6;
/// A `no-repeat` layer painted smaller than this on a non-repeating axis is
/// an icon, badge, or rule, not the ground the text sits on.
const DECORATION_MAX_PX: f64 = 160.0;
/// The share of the grid that has to resolve to a color before a verdict.
const MIN_SAMPLE_SHARE: f64 = 0.75;
/// The finding fires when this share of the samples fails: the text is
/// somewhere on the image, so only a near-uniform failure is a failure.
const FAIL_PERCENTILE: f64 = 0.9;

/// The color rule's own gates, so the sampler never fires where
/// `check_colors` would not have measured a resolved background.
pub fn applies(opts: &ColorOpts) -> bool {
    opts.has_direct_text
        && opts.text_color.is_some()
        && !opts.is_emoji_only
        && opts.bg_clip.as_deref() != Some("text")
        && !safe_tag_unstyled(opts)
}

/// The sample positions over a `width` x `height` raster: cell centers of
/// the `GRID`, row-major.
pub fn grid_points(width: usize, height: usize) -> Vec<(usize, usize)> {
    if width == 0 || height == 0 {
        return Vec::new();
    }
    let at = |i: usize, extent: usize| -> usize {
        let v = ((i as f64 + 0.5) / GRID as f64 * extent as f64).floor() as usize;
        v.min(extent - 1)
    };
    let mut points = Vec::with_capacity(GRID * GRID);
    for gy in 0..GRID {
        for gx in 0..GRID {
            points.push((at(gx, width), at(gy, height)));
        }
    }
    points
}

/// Whether a layer with this `background-repeat` and `background-size`
/// (the layer's own comma-list entries) paints too little to be the ground:
/// a non-repeating axis whose painted extent is under
/// `DECORATION_MAX_PX`. Repeating, `cover`, `contain`, and percentage sizes
/// fill the box and are never decoration.
pub fn is_decorative_layer(repeat: &str, size: &str, intrinsic_w: f64, intrinsic_h: f64) -> bool {
    let repeat = repeat.trim().to_ascii_lowercase();
    let tokens: Vec<&str> = repeat.split_whitespace().collect();
    let (repeat_x, repeat_y) = match tokens.as_slice() {
        ["no-repeat"] => (false, false),
        ["repeat-x"] => (true, false),
        ["repeat-y"] => (false, true),
        [x, y] => (*x != "no-repeat", *y != "no-repeat"),
        _ => (true, true),
    };
    if repeat_x && repeat_y {
        return false;
    }
    let size = size.trim().to_ascii_lowercase();
    if size == "cover" || size == "contain" || size.contains('%') {
        return false;
    }
    let tokens: Vec<&str> = size.split_whitespace().collect();
    let px = |t: Option<&&str>| t.filter(|t| t.ends_with("px")).map(|t| parse_float(t));
    // An `auto` (or absent) axis follows the other at the image's aspect
    // ratio, as in CSS: `40px`, `40px auto`, and `auto 40px` all scale.
    let (w, h) = match (px(tokens.first()), px(tokens.get(1))) {
        (Some(w), Some(h)) => (w, h),
        (Some(w), None) if intrinsic_w > 0.0 => (w, intrinsic_h * (w / intrinsic_w)),
        (None, Some(h)) if intrinsic_h > 0.0 => (intrinsic_w * (h / intrinsic_h), h),
        (Some(w), None) => (w, intrinsic_h),
        (None, Some(h)) => (intrinsic_w, h),
        (None, None) => (intrinsic_w, intrinsic_h),
    };
    (!repeat_x && w < DECORATION_MAX_PX) || (!repeat_y && h < DECORATION_MAX_PX)
}

/// A translucent gradient whose stops are all one color is a tint over the
/// image and composites exactly; a gradient that varies is a scrim placed
/// under the text on purpose, and without layout the engine cannot say
/// which stop the text sits on. `None` for the varying case.
pub fn uniform_wash(stops: &[Rgba]) -> Option<Rgba> {
    let first = *stops.first()?;
    let same = |s: &Rgba| {
        s.r == first.r
            && s.g == first.g
            && s.b == first.b
            && (s.alpha_or_one() - first.alpha_or_one()).abs() < 1e-9
    };
    stops.iter().all(same).then_some(first)
}

/// One grid sample's ground color: the pixel, composited over `under` when
/// it is translucent, then under every `overlays` layer (top to bottom, as
/// the walk collected them). `None` when a translucent pixel has nothing
/// known beneath it.
pub fn composite_sample(pixel: Rgba, under: Option<Rgba>, overlays: &[Rgba]) -> Option<Rgba> {
    let mut color = if pixel.alpha_or_one() >= 0.99 {
        Rgba::new(pixel.r, pixel.g, pixel.b, 1.0)
    } else {
        composite_color_over(&pixel, &under?)
    };
    for overlay in overlays.iter().rev() {
        color = composite_color_over(overlay, &color);
    }
    Some(color)
}

/// The verdict over the resolved `samples` of a grid of `grid_total` points,
/// against the text of `opts`. `ground` names the image in the snippet (its
/// file name, or `data:image/png`).
pub fn sampled_contrast(
    opts: &ColorOpts,
    ground: &str,
    samples: &[Rgba],
    grid_total: usize,
) -> Option<RuleHit> {
    if !applies(opts) {
        return None;
    }
    let text = opts.text_color?;
    let needed = ((grid_total as f64) * MIN_SAMPLE_SHARE).ceil().max(1.0) as usize;
    if samples.len() < needed {
        return None;
    }
    let mut ratios: Vec<f64> = samples
        .iter()
        .map(|bg| {
            let fg = if text.alpha_or_one() < 1.0 {
                composite_color_over(&text, bg)
            } else {
                text
            };
            contrast_ratio(&fg, bg)
        })
        .collect();
    ratios.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let n = ratios.len();
    let pick = |share: f64| ratios[((share * n as f64).floor() as usize).min(n - 1)];
    let measured = pick(FAIL_PERCENTILE);
    let median = pick(0.5);
    let is_large_text = opts.font_size >= WCAG_LARGE_TEXT_PX
        || (opts.font_size >= WCAG_LARGE_BOLD_TEXT_PX && opts.font_weight >= 700.0);
    let threshold = if is_large_text { 3.0 } else { 4.5 };
    if measured >= threshold {
        return None;
    }
    let ratio_label = if to_fixed(measured, 1) == to_fixed(threshold, 1) {
        to_fixed(measured, 2)
    } else {
        to_fixed(measured, 1)
    };
    Some(RuleHit::new(
        "low-contrast",
        format!(
            "sampled (coarse) {}:1 (need {}:1) — text {} on {}; p90 of {} samples, median {}:1",
            ratio_label,
            number_to_string(threshold),
            color_to_hex(Some(&text)),
            ground,
            n,
            to_fixed(median, 1)
        ),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rgba(r: f64, g: f64, b: f64, a: f64) -> Rgba {
        Rgba::new(r, g, b, a)
    }

    fn opts(text: Rgba, font_size: f64) -> ColorOpts {
        ColorOpts {
            tag: "p".into(),
            text_color: Some(text),
            font_size,
            font_weight: 400.0,
            has_direct_text: true,
            ..Default::default()
        }
    }

    #[test]
    fn grid_covers_cell_centers_and_clamps() {
        let points = grid_points(96, 64);
        assert_eq!(points.len(), 36);
        assert_eq!(points[0], (8, 5));
        assert_eq!(points[35], (88, 58));
        assert_eq!(grid_points(1, 1), vec![(0, 0); 36]);
        assert!(grid_points(0, 10).is_empty());
    }

    #[test]
    fn decoration_gate() {
        assert!(is_decorative_layer("no-repeat", "auto", 24.0, 24.0));
        assert!(is_decorative_layer("no-repeat", "40px", 1200.0, 800.0));
        assert!(is_decorative_layer("no-repeat", "40px auto", 1200.0, 800.0));
        assert!(is_decorative_layer("no-repeat", "auto 40px", 1200.0, 800.0));
        assert!(!is_decorative_layer(
            "no-repeat",
            "auto 800px",
            1200.0,
            800.0
        ));
        assert!(is_decorative_layer("repeat-y", "auto", 8.0, 400.0));
        assert!(is_decorative_layer("repeat-x", "auto", 1200.0, 80.0));
        assert!(!is_decorative_layer("no-repeat", "cover", 24.0, 24.0));
        assert!(!is_decorative_layer("no-repeat", "100% auto", 24.0, 24.0));
        assert!(!is_decorative_layer("no-repeat", "auto", 1600.0, 900.0));
        assert!(!is_decorative_layer("repeat", "auto", 4.0, 4.0));
        assert!(!is_decorative_layer("", "", 16.0, 16.0));
        assert!(!is_decorative_layer(
            "repeat no-repeat",
            "auto",
            1200.0,
            300.0
        ));
        assert!(is_decorative_layer(
            "repeat no-repeat",
            "auto",
            1200.0,
            30.0
        ));
    }

    #[test]
    fn washes_and_compositing() {
        let tint = rgba(0.0, 0.0, 0.0, 0.4);
        assert_eq!(uniform_wash(&[tint, tint]), Some(tint));
        assert_eq!(uniform_wash(&[tint, rgba(0.0, 0.0, 0.0, 0.0)]), None);
        assert_eq!(uniform_wash(&[]), None);
        let light = rgba(240.0, 240.0, 240.0, 1.0);
        assert_eq!(composite_sample(light, None, &[]), Some(light));
        let dimmed = composite_sample(light, None, &[tint]).unwrap();
        assert_eq!((dimmed.r, dimmed.g, dimmed.b), (144.0, 144.0, 144.0));
        let translucent = rgba(240.0, 240.0, 240.0, 0.25);
        assert_eq!(composite_sample(translucent, None, &[]), None);
        let over_dark =
            composite_sample(translucent, Some(rgba(20.0, 20.0, 20.0, 1.0)), &[]).unwrap();
        assert_eq!((over_dark.r, over_dark.a), (75.0, Some(1.0)));
    }

    #[test]
    fn verdict_needs_a_near_uniform_failure() {
        let white = rgba(253.0, 253.0, 253.0, 1.0);
        let light = rgba(243.0, 239.0, 230.0, 1.0);
        let dark = rgba(26.0, 24.0, 22.0, 1.0);
        let all_light: Vec<Rgba> = vec![light; 36];
        let hit = sampled_contrast(&opts(white, 16.0), "hero.png", &all_light, 36).unwrap();
        assert_eq!(hit.id, "low-contrast");
        assert_eq!(
            hit.snippet,
            "sampled (coarse) 1.1:1 (need 4.5:1) — text #fdfdfd on hero.png; p90 of 36 samples, median 1.1:1"
        );
        // Half the image is dark: the text may well sit there.
        let split: Vec<Rgba> = (0..36)
            .map(|i| if i % 2 == 0 { light } else { dark })
            .collect();
        assert!(sampled_contrast(&opts(white, 16.0), "hero.png", &split, 36).is_none());
        // Three dark samples out of 36 are not enough to save it.
        let mostly: Vec<Rgba> = (0..36).map(|i| if i < 3 { dark } else { light }).collect();
        assert!(sampled_contrast(&opts(white, 16.0), "hero.png", &mostly, 36).is_some());
        // Too few resolved samples: no verdict.
        assert!(sampled_contrast(&opts(white, 16.0), "hero.png", &all_light[..20], 36).is_none());
        // Large text lowers the bar, and the snippet says so.
        let mid = rgba(150.0, 150.0, 150.0, 1.0);
        let on_mid: Vec<Rgba> = vec![mid; 36];
        assert!(
            sampled_contrast(&opts(white, 28.0), "hero.png", &on_mid, 36)
                .unwrap()
                .snippet
                .contains("(need 3:1)")
        );
        // Safe tags and gradient-clipped text never sample.
        let mut anchor = opts(white, 16.0);
        anchor.tag = "a".into();
        assert!(sampled_contrast(&anchor, "hero.png", &all_light, 36).is_none());
        let mut clipped = opts(white, 16.0);
        clipped.bg_clip = Some("text".into());
        assert!(sampled_contrast(&clipped, "hero.png", &all_light, 36).is_none());
    }
}
