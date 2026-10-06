//! Pixel-sampled contrast for text over a `url()` background image in the
//! static engine (#560). Outside a browser there is no CORS and no canvas
//! taint, so the engine reads the image itself; what it cannot know is
//! layout. The verdict is therefore coarse: a fixed grid over the whole
//! image, and a finding only when nearly all of it fails. A photo with a dark
//! third under the headline passes; white text on a near-white texture does
//! not, wherever the text sits.
//!
//! This module is the decisions: grid geometry, how much of a box a layer
//! paints, the wash and compositing rules, the percentile verdict and its
//! label. Reading and decoding the image is the html crate's job.

use crate::checks::rules::{scores_safe_tag_text, ColorOpts, RuleHit};
use crate::color::{color_to_hex, composite_color_over, contrast_ratio, Rgba};
use crate::constants::{WCAG_LARGE_BOLD_TEXT_PX, WCAG_LARGE_TEXT_PX};
use crate::js::{number_to_string, parse_float, to_fixed};

/// Grid points per axis: 6x6 = 36 samples, sampling rather than scanning.
const GRID: usize = 6;
/// A layer painted smaller than this on an axis it does not repeat along is
/// an icon, badge, or rule, not the ground the text sits on.
const DECORATION_MAX_PX: f64 = 160.0;
/// The share of the grid that has to resolve to a color before a verdict.
const MIN_SAMPLE_SHARE: f64 = 0.75;
/// The finding fires when this share of the samples fails: the text is
/// somewhere on the image, so only a near-uniform failure is a failure.
const FAIL_PERCENTILE: f64 = 0.9;
/// Text at or below this alpha does not paint. Image-replacement text
/// (`color: rgba(0,0,0,0)` over a logo) is hidden on purpose, not a contrast
/// failure; the floor is the one the background walk uses for a surface.
const MIN_TEXT_ALPHA: f64 = 0.1;

/// The color rule's own gates plus the alpha floor, so the sampler never
/// fires where `check_colors` would not have measured a resolved background.
/// Bare text in a `SAFE_TAGS` element belongs to the deduped safe-tag path
/// and is not sampled.
pub fn applies(opts: &ColorOpts) -> bool {
    opts.has_direct_text
        && opts
            .text_color
            .is_some_and(|c| c.alpha_or_one() > MIN_TEXT_ALPHA)
        && !opts.is_emoji_only
        && !opts.is_glyph_only
        && opts.bg_clip.as_deref() != Some("text")
        && !scores_safe_tag_text(opts)
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

/// How much of a box a background layer paints along one axis.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Extent {
    /// The axis is filled: the layer repeats along it, or is sized `cover`
    /// or 100% and up.
    Covers,
    /// A known painted length in px.
    Px(f64),
    /// Not knowable without layout: a percentage under 100, `contain`, a
    /// viewport or container unit, an unresolved `var()` or `calc()`, or
    /// `auto` beside one of those.
    Unknown,
}

/// One component of a `background-size` value.
enum SizeToken {
    Auto,
    Px(f64),
    Percent(f64),
    Unknown,
}

fn size_token(token: &str, font_size: f64) -> SizeToken {
    if token == "auto" {
        return SizeToken::Auto;
    }
    let number = |unit: &str| -> Option<f64> {
        let n = parse_float(token.strip_suffix(unit)?);
        (!n.is_nan()).then_some(n)
    };
    if let Some(n) = number("%") {
        SizeToken::Percent(n)
    } else if let Some(n) = number("px") {
        SizeToken::Px(n)
    } else if let Some(n) = number("rem") {
        SizeToken::Px(n * 16.0)
    } else if let Some(n) = number("em") {
        SizeToken::Px(n * font_size)
    } else {
        SizeToken::Unknown
    }
}

/// `value` split on whitespace outside parentheses, so `calc(1px + 2px)`
/// stays one component.
fn size_components(value: &str) -> Vec<&str> {
    let mut parts = Vec::new();
    let mut depth = 0usize;
    let mut start: Option<usize> = None;
    for (i, ch) in value.char_indices() {
        match ch {
            '(' => depth += 1,
            ')' => depth = depth.saturating_sub(1),
            _ => {}
        }
        if ch.is_whitespace() && depth == 0 {
            if let Some(s) = start.take() {
                parts.push(&value[s..i]);
            }
        } else if start.is_none() {
            start = Some(i);
        }
    }
    if let Some(s) = start {
        parts.push(&value[s..]);
    }
    parts
}

/// What a layer with this `background-repeat` and `background-size` (the
/// layer's own comma-list entries) paints along each axis, given the image's
/// intrinsic size and the element's font size for `em`.
pub fn layer_extents(
    repeat: &str,
    size: &str,
    intrinsic_w: f64,
    intrinsic_h: f64,
    font_size: f64,
) -> (Extent, Extent) {
    let repeat = repeat.trim().to_ascii_lowercase();
    let tokens: Vec<&str> = repeat.split_whitespace().collect();
    // `space` and `round` tile the axis too. Anything else (an unresolved
    // `var()`, a typo) is not known to repeat.
    let tiles = |token: &str| matches!(token, "repeat" | "space" | "round");
    let (repeat_x, repeat_y) = match tokens.as_slice() {
        // No declaration: the initial value is `repeat`.
        [] => (true, true),
        ["repeat-x"] => (true, false),
        ["repeat-y"] => (false, true),
        [both] => (tiles(both), tiles(both)),
        [x, y] => (tiles(x), tiles(y)),
        _ => (false, false),
    };
    let size = size.trim().to_ascii_lowercase();
    let sized = |token: SizeToken| match token {
        SizeToken::Px(v) => Extent::Px(v),
        SizeToken::Percent(p) if p >= 100.0 => Extent::Covers,
        _ => Extent::Unknown,
    };
    let scaled = |known: f64, of: f64, other: f64| {
        if of > 0.0 {
            Extent::Px(other * (known / of))
        } else {
            Extent::Unknown
        }
    };
    let (mut x, mut y) = match size.as_str() {
        "cover" => (Extent::Covers, Extent::Covers),
        "contain" => (Extent::Unknown, Extent::Unknown),
        _ => {
            let parts = size_components(&size);
            let first = size_token(parts.first().copied().unwrap_or("auto"), font_size);
            let second = size_token(parts.get(1).copied().unwrap_or("auto"), font_size);
            match (first, second) {
                (SizeToken::Auto, SizeToken::Auto) => {
                    (Extent::Px(intrinsic_w), Extent::Px(intrinsic_h))
                }
                // An `auto` axis follows a known one at the image's aspect
                // ratio: `40px`, `40px auto`, and `auto 40px` all scale.
                (SizeToken::Px(w), SizeToken::Auto) => {
                    (Extent::Px(w), scaled(w, intrinsic_w, intrinsic_h))
                }
                (SizeToken::Auto, SizeToken::Px(h)) => {
                    (scaled(h, intrinsic_h, intrinsic_w), Extent::Px(h))
                }
                (first, second) => (sized(first), sized(second)),
            }
        }
    };
    if repeat_x {
        x = Extent::Covers;
    }
    if repeat_y {
        y = Extent::Covers;
    }
    (x, y)
}

/// A layer that paints too little, or an unknowable amount, along an axis:
/// an icon, a rule, a seal. Its pixels are not the ground the text sits on.
pub fn is_decoration((x, y): (Extent, Extent)) -> bool {
    let small = |extent: Extent| match extent {
        Extent::Covers => false,
        Extent::Px(v) => v < DECORATION_MAX_PX,
        Extent::Unknown => true,
    };
    small(x) || small(y)
}

/// A layer that fills the box on both axes, so nothing beneath it shows
/// except through its own translucent pixels.
pub fn covers_box((x, y): (Extent, Extent)) -> bool {
    x == Extent::Covers && y == Extent::Covers
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

/// The sampler's verdict for one element.
#[derive(Debug, Clone, PartialEq)]
pub enum Sampled {
    /// The pixels were read and the text clears the threshold on enough of
    /// them.
    Pass,
    Fail(RuleHit),
}

/// The verdict over the resolved `samples` of a grid of `grid_total` points,
/// against the text of `opts`. `ground` names the image in the snippet (its
/// file name, or `data:image/png`). `None` when the rule does not apply to
/// the element or too few samples resolved to say anything.
pub fn sampled_contrast(
    opts: &ColorOpts,
    ground: &str,
    samples: &[Rgba],
    grid_total: usize,
) -> Option<Sampled> {
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
        return Some(Sampled::Pass);
    }
    let ratio_label = if to_fixed(measured, 1) == to_fixed(threshold, 1) {
        to_fixed(measured, 2)
    } else {
        to_fixed(measured, 1)
    };
    Some(Sampled::Fail(RuleHit::new(
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
    )))
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

    fn decoration(repeat: &str, size: &str, w: f64, h: f64) -> bool {
        is_decoration(layer_extents(repeat, size, w, h, 16.0))
    }

    fn covers(repeat: &str, size: &str) -> bool {
        covers_box(layer_extents(repeat, size, 1200.0, 800.0, 16.0))
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
    fn decoration_gate_reads_px_and_intrinsic_sizes() {
        assert!(decoration("no-repeat", "auto", 24.0, 24.0));
        assert!(decoration("no-repeat", "40px", 1200.0, 800.0));
        assert!(decoration("no-repeat", "40px auto", 1200.0, 800.0));
        assert!(decoration("no-repeat", "auto 40px", 1200.0, 800.0));
        assert!(!decoration("no-repeat", "auto 800px", 1200.0, 800.0));
        assert!(decoration("repeat-y", "auto", 8.0, 400.0));
        assert!(decoration("repeat-x", "auto", 1200.0, 80.0));
        assert!(!decoration("no-repeat", "cover", 24.0, 24.0));
        assert!(!decoration("no-repeat", "auto", 1600.0, 900.0));
        assert!(!decoration("repeat", "auto", 4.0, 4.0));
        assert!(!decoration("", "", 16.0, 16.0));
        assert!(!decoration("repeat no-repeat", "auto", 1200.0, 300.0));
        assert!(decoration("repeat no-repeat", "auto", 1200.0, 30.0));
        // Only a keyword that tiles fills an axis.
        assert!(!decoration("round space", "auto", 4.0, 4.0));
        assert!(decoration("var(--tile)", "auto", 4.0, 4.0));
    }

    #[test]
    fn decoration_gate_reads_every_unit_per_axis() {
        // A percentage fills an axis only at 100% and up: a 5% icon and a
        // rule image stretched to the box height are still decoration.
        assert!(decoration("no-repeat", "5% auto", 24.0, 24.0));
        assert!(decoration("repeat-y", "auto 100%", 4.0, 4.0));
        assert!(decoration("no-repeat", "50% 50%", 1200.0, 800.0));
        assert!(!decoration("no-repeat", "100% 100%", 24.0, 24.0));
        // `100% auto` fills the width; the height it paints depends on the
        // box, so without `repeat` the axis is unknown.
        assert!(decoration("no-repeat", "100% auto", 1200.0, 800.0));
        assert!(!decoration("repeat-y", "100% auto", 1200.0, 800.0));
        // rem and em are lengths: a 1200px seal painted at 4rem is a seal.
        assert!(decoration("no-repeat", "4rem", 1200.0, 1200.0));
        assert!(decoration("no-repeat", "4em 4em", 1200.0, 1200.0));
        assert!(!decoration("no-repeat", "20rem 20rem", 24.0, 24.0));
        assert_eq!(
            layer_extents("no-repeat", "2em auto", 100.0, 50.0, 20.0),
            (Extent::Px(40.0), Extent::Px(20.0))
        );
        // Anything layout would have to resolve keeps the skip.
        assert!(decoration("no-repeat", "50vw auto", 1200.0, 800.0));
        assert!(decoration("no-repeat", "var(--seal)", 1200.0, 800.0));
        assert!(decoration(
            "no-repeat",
            "calc(100% - 4px) auto",
            1200.0,
            800.0
        ));
        assert!(decoration("no-repeat", "contain", 1200.0, 800.0));
        assert!(!decoration("repeat", "var(--seal)", 1200.0, 800.0));
    }

    #[test]
    fn only_a_filled_box_covers() {
        assert!(covers("repeat", "auto"));
        assert!(covers("", ""));
        assert!(covers("no-repeat", "cover"));
        assert!(covers("no-repeat", "100% 100%"));
        assert!(covers("repeat-y", "100% auto"));
        assert!(!covers("no-repeat", "auto"));
        assert!(!covers("no-repeat", "100% auto"));
        assert!(!covers("repeat-x", "auto"));
        assert!(!covers("no-repeat", "contain"));
        assert!(!covers("no-repeat", "2000px 2000px"));
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
        let Some(Sampled::Fail(hit)) =
            sampled_contrast(&opts(white, 16.0), "hero.png", &all_light, 36)
        else {
            panic!("white on a light image fails");
        };
        assert_eq!(hit.id, "low-contrast");
        assert_eq!(
            hit.snippet,
            "sampled (coarse) 1.1:1 (need 4.5:1) — text #fdfdfd on hero.png; p90 of 36 samples, median 1.1:1"
        );
        // Half the image is dark: the text may well sit there.
        let split: Vec<Rgba> = (0..36)
            .map(|i| if i % 2 == 0 { light } else { dark })
            .collect();
        assert_eq!(
            sampled_contrast(&opts(white, 16.0), "hero.png", &split, 36),
            Some(Sampled::Pass)
        );
        // Three dark samples out of 36 are not enough to save it.
        let mostly: Vec<Rgba> = (0..36).map(|i| if i < 3 { dark } else { light }).collect();
        assert!(matches!(
            sampled_contrast(&opts(white, 16.0), "hero.png", &mostly, 36),
            Some(Sampled::Fail(_))
        ));
        // Too few resolved samples: no verdict either way.
        assert_eq!(
            sampled_contrast(&opts(white, 16.0), "hero.png", &all_light[..20], 36),
            None
        );
        // Large text lowers the bar, and the snippet says so.
        let mid = rgba(150.0, 150.0, 150.0, 1.0);
        let on_mid: Vec<Rgba> = vec![mid; 36];
        let Some(Sampled::Fail(large)) =
            sampled_contrast(&opts(white, 28.0), "hero.png", &on_mid, 36)
        else {
            panic!("white on mid gray fails at 3:1");
        };
        assert!(large.snippet.contains("(need 3:1)"));
        // Safe tags and gradient-clipped text never sample.
        let mut anchor = opts(white, 16.0);
        anchor.tag = "a".into();
        assert_eq!(sampled_contrast(&anchor, "hero.png", &all_light, 36), None);
        let mut clipped = opts(white, 16.0);
        clipped.bg_clip = Some("text".into());
        assert_eq!(sampled_contrast(&clipped, "hero.png", &all_light, 36), None);
    }

    #[test]
    fn text_that_does_not_paint_is_not_measured() {
        let light: Vec<Rgba> = vec![rgba(243.0, 239.0, 230.0, 1.0); 36];
        // Image-replacement text: alpha 0 in either spelling.
        for hidden in [rgba(0.0, 0.0, 0.0, 0.0), rgba(253.0, 253.0, 253.0, 0.05)] {
            assert!(!applies(&opts(hidden, 16.0)));
            assert_eq!(
                sampled_contrast(&opts(hidden, 16.0), "logo.png", &light, 36),
                None
            );
        }
        // Translucent text that does paint is composited and measured.
        let faint = rgba(0.0, 0.0, 0.0, 0.3);
        assert!(applies(&opts(faint, 16.0)));
        assert!(matches!(
            sampled_contrast(&opts(faint, 16.0), "hero.png", &light, 36),
            Some(Sampled::Fail(_))
        ));
        let solid = rgba(0.0, 0.0, 0.0, 0.9);
        assert_eq!(
            sampled_contrast(&opts(solid, 16.0), "hero.png", &light, 36),
            Some(Sampled::Pass)
        );
    }
}
