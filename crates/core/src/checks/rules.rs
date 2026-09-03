//! Port of `cli/engine/rules/checks.mjs` Section 3: the pure element checks
//! and their helpers. Every function keeps the JS name in its doc comment;
//! opts objects become structs whose `Option` fields mirror the JS
//! `undefined` / `null` distinctions the source relies on.

use crate::color::{
    color_to_hex, contrast_ratio, get_hue, has_chroma, is_neutral_color, relative_luminance, Rgba,
};
use crate::constants::{
    BORDER_SAFE_TAGS, GENERIC_FONTS, KNOWN_SERIF_FONTS, SAFE_TAGS, WCAG_LARGE_BOLD_TEXT_PX,
    WCAG_LARGE_TEXT_PX,
};
use crate::js::{
    self, ci, math_max, math_round, number_to_string, parse_float, parse_int, string_to_number,
    to_fixed, WS,
};
use crate::js_ext_a::{num_truthy, slice_utf16_start, split_commas_outside_parens, utf16_length};
use once_cell::sync::Lazy;
use regex::Regex;

/// The hit and option structs these checks are written against are open;
/// re-exported so `checks::rules` stays one path.
pub use impeccable_foundation::rules::types::*;

macro_rules! re {
    ($name:ident, $pat:expr) => {
        static $name: Lazy<Regex> = Lazy::new(|| Regex::new(&$pat).expect(stringify!($name)));
    };
}

const SIDE_NAMES: [&str; 4] = ["Top", "Right", "Bottom", "Left"];

/// JS: checks.mjs#checkBorders
pub fn check_borders(
    tag: &str,
    widths: &Sides<f64>,
    colors: &Sides<Option<&str>>,
    radius: f64,
    opts: &BorderOpts,
) -> Vec<RuleHit> {
    let span_badge = tag == "span" && opts.badge_like;
    if set_has(BORDER_SAFE_TAGS, tag) && !span_badge {
        return Vec::new();
    }
    if opts.status_context {
        return Vec::new();
    }
    let mut findings = Vec::new();
    for i in 0..4 {
        let w = widths.get(i);
        if w < 1.0 || is_neutral_color(colors.get(i)) {
            continue;
        }
        let mut max_other = f64::NEG_INFINITY;
        for j in 0..4 {
            if j != i {
                max_other = math_max(max_other, widths.get(j));
            }
        }
        if !(w >= 2.0 && (max_other <= 1.0 || w >= max_other * 2.0)) {
            continue;
        }
        let sn = SIDE_NAMES[i].to_lowercase();
        let is_side = i == 1 || i == 3;
        let w_s = number_to_string(w);
        let r_s = number_to_string(radius);
        if is_side {
            if span_badge {
                continue;
            }
            if radius > 0.0 {
                findings.push(RuleHit::new(
                    "side-tab",
                    format!("border-{sn}: {w_s}px + border-radius: {r_s}px"),
                ));
            } else if w >= 3.0 {
                findings.push(RuleHit::new("side-tab", format!("border-{sn}: {w_s}px")));
            }
        } else if radius > 0.0 && w >= 2.0 {
            findings.push(RuleHit::new(
                "border-accent-on-rounded",
                format!("border-{sn}: {w_s}px + border-radius: {r_s}px"),
            ));
        } else if !opts.tab_context && w >= 3.0 && w <= 12.0 {
            findings.push(RuleHit::new("side-tab", format!("border-{sn}: {w_s}px")));
        }
    }
    findings
}

re!(GRADIENT_CI, ci("gradient"));

re!(
    TW_GRAY_TEXT,
    format!(r"{B}text-(?:gray|slate|zinc|neutral|stone)-{D}+{B}")
);
re!(
    TW_COLOR_BG,
    format!(
        r"{B}bg-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-{D}+{B}"
    )
);
re!(TW_BG_CLIP_TEXT, format!(r"{B}bg-clip-text{B}"));
re!(TW_BG_GRADIENT_TO, format!(r"{B}bg-gradient-to-"));
re!(
    TW_PURPLE_TEXT,
    format!(r"{B}text-(?:purple|violet|indigo)-{D}+{B}")
);
re!(TW_TEXT_XL, format!(r"{B}text-(?:[2-9]xl){B}"));
re!(
    TW_FROM_PURPLE,
    format!(r"{B}from-(?:purple|violet|indigo)-{D}+{B}")
);
re!(
    TW_TO_PURPLE,
    format!(r"{B}to-(?:purple|violet|indigo|blue|cyan|pink|fuchsia)-{D}+{B}")
);

fn is_heading_123(tag: &str) -> bool {
    matches!(tag, "h1" | "h2" | "h3")
}

/// JS: checks.mjs#checkColors
pub fn check_colors(opts: &ColorOpts) -> Vec<RuleHit> {
    let tag = opts.tag.as_str();
    let bg_image = opts.bg_image.as_deref().unwrap_or("");
    let bg_clip = opts.bg_clip.as_deref().unwrap_or("");
    if set_has(SAFE_TAGS, tag) {
        let own_bg = opts
            .bg_color
            .map_or(false, |c| c.a.map_or(false, |a| a > 0.5));
        let own_gradient = !bg_image.is_empty() && GRADIENT_CI.is_match(bg_image);
        let is_styled_control =
            opts.has_direct_text && (own_bg || own_gradient) && opts.font_size >= 9.0;
        if !is_styled_control {
            return Vec::new();
        }
    }
    let mut findings = Vec::new();

    if opts.has_direct_text && opts.text_color.is_some() && !opts.is_emoji_only {
        let text_color = opts.text_color.unwrap();
        let is_gradient_clipped_text = bg_clip == "text";
        let bgs: Option<Vec<Rgba>> = if is_gradient_clipped_text {
            None
        } else if let Some(bg) = opts.effective_bg {
            Some(vec![bg])
        } else {
            match &opts.effective_bg_stops {
                Some(stops) if !stops.is_empty() => Some(stops.clone()),
                _ => None,
            }
        };
        if let Some(bgs) = bgs {
            let text_lum = relative_luminance(&text_color);
            let is_gray =
                !has_chroma(Some(&text_color), Some(20.0)) && text_lum > 0.05 && text_lum < 0.85;
            if is_gray && bgs.iter().all(|b| has_chroma(Some(b), Some(40.0))) {
                let bg_label = match opts.effective_bg {
                    Some(bg) => color_to_hex(Some(&bg)),
                    None => format!(
                        "gradient({})",
                        bgs.iter()
                            .map(|b| color_to_hex(Some(b)))
                            .collect::<Vec<_>>()
                            .join(", ")
                    ),
                };
                findings.push(RuleHit::new(
                    "gray-on-color",
                    format!(
                        "text {} on bg {}",
                        color_to_hex(Some(&text_color)),
                        bg_label
                    ),
                ));
            }

            let ratios: Vec<f64> = bgs.iter().map(|b| contrast_ratio(&text_color, b)).collect();
            let mut worst_idx = 0usize;
            for i in 1..ratios.len() {
                if ratios[i] < ratios[worst_idx] {
                    worst_idx = i;
                }
            }
            let ratio = ratios[worst_idx];
            let is_large_text = opts.font_size >= WCAG_LARGE_TEXT_PX
                || (opts.font_size >= WCAG_LARGE_BOLD_TEXT_PX && opts.font_weight >= 700.0);
            let threshold = if is_large_text { 3.0 } else { 4.5 };
            if ratio < threshold {
                let is_alpha_fallback_fp = !opts.detector_is_browser
                    && opts.effective_bg.is_none()
                    && text_color.a.map_or(false, |a| a < 1.0);
                if !is_alpha_fallback_fp {
                    let ratio_label = if to_fixed(ratio, 1) == to_fixed(threshold, 1) {
                        to_fixed(ratio, 2)
                    } else {
                        to_fixed(ratio, 1)
                    };
                    findings.push(RuleHit::new(
                        "low-contrast",
                        format!(
                            "{}:1 (need {}:1) — text {} on {}",
                            ratio_label,
                            number_to_string(threshold),
                            color_to_hex(Some(&text_color)),
                            color_to_hex(Some(&bgs[worst_idx]))
                        ),
                    ));
                }
            }
        }

        if has_chroma(Some(&text_color), Some(50.0)) {
            let hue = get_hue(Some(&text_color));
            if hue >= 260.0 && hue <= 310.0 && (is_heading_123(tag) || opts.font_size >= 20.0) {
                findings.push(RuleHit::new(
                    "ai-color-palette",
                    format!(
                        "Purple/violet text ({}) on heading",
                        color_to_hex(Some(&text_color))
                    ),
                ));
            }
        }
    }

    if bg_clip == "text" && !bg_image.is_empty() && bg_image.contains("gradient") {
        findings.push(RuleHit::new(
            "gradient-text",
            "background-clip: text + gradient".to_string(),
        ));
    }

    if let Some(class_str) = opts.class_list.as_deref().filter(|s| !s.is_empty()) {
        let gray_match = TW_GRAY_TEXT.find(class_str);
        let color_bg_match = TW_COLOR_BG.find(class_str);
        if let (Some(g), Some(c)) = (gray_match, color_bg_match) {
            findings.push(RuleHit::new(
                "gray-on-color",
                format!("{} on {}", g.as_str(), c.as_str()),
            ));
        }
        if TW_BG_CLIP_TEXT.is_match(class_str) && TW_BG_GRADIENT_TO.is_match(class_str) {
            findings.push(RuleHit::new(
                "gradient-text",
                "bg-clip-text + bg-gradient (Tailwind)".to_string(),
            ));
        }
        if let Some(p) = TW_PURPLE_TEXT.find(class_str) {
            if is_heading_123(tag) || TW_TEXT_XL.is_match(class_str) {
                findings.push(RuleHit::new(
                    "ai-color-palette",
                    format!("{} on heading", p.as_str()),
                ));
            }
        }
        if TW_FROM_PURPLE.is_match(class_str) && TW_TO_PURPLE.is_match(class_str) {
            findings.push(RuleHit::new(
                "ai-color-palette",
                "Purple/violet gradient (Tailwind)".to_string(),
            ));
        }
    }

    findings
}

/// JS: checks.mjs#checkHoverContrast
pub fn check_hover_contrast(opts: &HoverContrastOpts) -> Vec<RuleHit> {
    if !opts.has_direct_text || opts.is_emoji_only || opts.text_color.is_none() || opts.bg.is_none()
    {
        return Vec::new();
    }
    if set_has(SAFE_TAGS, &opts.tag) && !opts.own_bg_alpha.map_or(false, |a| a > 0.5) {
        return Vec::new();
    }
    let text_color = opts.text_color.unwrap();
    let bg = opts.bg.unwrap();
    let ratio = contrast_ratio(&text_color, &bg);
    let is_large_text = opts.font_size >= WCAG_LARGE_TEXT_PX
        || (opts.font_size >= WCAG_LARGE_BOLD_TEXT_PX && opts.font_weight >= 700.0);
    let threshold = if is_large_text { 3.0 } else { 4.5 };
    if ratio >= threshold {
        return Vec::new();
    }
    vec![RuleHit::new(
        "low-contrast",
        format!(
            ":hover state {}:1 (need {}:1) — text {} on {}",
            to_fixed(ratio, 1),
            number_to_string(threshold),
            color_to_hex(Some(&text_color)),
            color_to_hex(Some(&bg))
        ),
    )]
}

// ─── isCardLikeFromProps / HEADING_TAGS ─────────────────────────────────────

/// JS: checks.mjs#isCardLikeFromProps
pub fn is_card_like_from_props(
    has_shadow: bool,
    has_border: bool,
    has_radius: bool,
    has_bg: bool,
) -> bool {
    if !has_shadow && !has_border {
        return false;
    }
    has_radius || has_bg
}

/// JS: checks.mjs#checkIconTile
pub fn check_icon_tile(opts: &IconTileOpts) -> Vec<RuleHit> {
    if !is_heading_tag(&opts.heading_tag) {
        return Vec::new();
    }
    let sibling_tag = match opts.sibling_tag.as_deref() {
        None | Some("") => return Vec::new(),
        Some(t) => t,
    };
    if is_heading_tag(sibling_tag) {
        return Vec::new();
    }
    let w = opts.sibling_width;
    let h = opts.sibling_height;
    if !(w >= 32.0 && w <= 128.0) {
        return Vec::new();
    }
    if !(h >= 32.0 && h <= 128.0) {
        return Vec::new();
    }
    let ratio = w / h;
    if ratio < 0.7 || ratio > 1.4 {
        return Vec::new();
    }
    let bg_visible = opts
        .sibling_bg_color
        .map_or(false, |c| c.a.map_or(false, |a| a > 0.1))
        || opts
            .sibling_bg_image
            .as_deref()
            .map_or(false, |s| !s.is_empty() && s != "none");
    let border_visible = opts.sibling_border_width > 0.0;
    if !bg_visible && !border_visible {
        return Vec::new();
    }
    if opts.sibling_border_radius >= w / 2.0 {
        return Vec::new();
    }
    if !opts.has_icon_child {
        return Vec::new();
    }
    if num_truthy(opts.icon_child_width) && opts.icon_child_width >= w * 0.95 {
        return Vec::new();
    }
    if num_truthy(opts.heading_top)
        && num_truthy(opts.sibling_bottom)
        && opts.sibling_bottom > opts.heading_top + 4.0
    {
        return Vec::new();
    }
    let text = slice_utf16_start(js::trim(opts.heading_text.as_deref().unwrap_or("")), 60);
    vec![RuleHit::new(
        "icon-tile-stack",
        format!(
            "{}x{}px icon tile above {} \"{}\"",
            number_to_string(math_round(w)),
            number_to_string(math_round(h)),
            opts.heading_tag,
            text
        ),
    )]
}

/// JS `f.trim().replace(/^['"]|['"]$/g, '')`.
fn strip_font_quotes(f: &str) -> &str {
    let t = js::trim(f);
    let is_quote = |b: u8| b == b'\'' || b == b'"';
    let bytes = t.as_bytes();
    let start = if !bytes.is_empty() && is_quote(bytes[0]) {
        1
    } else {
        0
    };
    let end = if bytes.len() > start && is_quote(bytes[bytes.len() - 1]) {
        bytes.len() - 1
    } else {
        bytes.len()
    };
    &t[start..end]
}

/// JS: checks.mjs#resolveSerif
pub fn resolve_serif(font_family: Option<&str>) -> SerifResolution {
    let none = SerifResolution {
        primary: None,
        is_serif: false,
    };
    let ff = match font_family {
        None | Some("") => return none,
        Some(s) => s,
    };
    let tokens: Vec<String> = ff
        .split(',')
        .map(|f| js::to_lower_case(strip_font_quotes(f)))
        .collect();
    let primary = tokens
        .iter()
        .find(|f| !f.is_empty() && !set_has(GENERIC_FONTS, f))
        .cloned();
    let primary = match primary {
        None => return none,
        Some(p) => p,
    };
    if set_has(KNOWN_SERIF_FONTS, &primary) {
        return SerifResolution {
            primary: Some(primary),
            is_serif: true,
        };
    }
    if tokens.iter().any(|t| t == "serif") {
        return SerifResolution {
            primary: Some(primary),
            is_serif: true,
        };
    }
    SerifResolution {
        primary: Some(primary),
        is_serif: false,
    }
}

/// JS: checks.mjs#checkItalicSerif
pub fn check_italic_serif(opts: &ItalicSerifOpts) -> Vec<RuleHit> {
    if opts.font_style.as_deref() != Some("italic") {
        return Vec::new();
    }
    let tag = opts.tag.as_str();
    if tag != "h1" && !(tag == "h2" && opts.font_size >= 48.0) {
        return Vec::new();
    }
    if opts.font_size < 48.0 {
        return Vec::new();
    }
    let res = resolve_serif(opts.font_family.as_deref());
    if !res.is_serif {
        return Vec::new();
    }
    let text = slice_utf16_start(js::trim(opts.heading_text.as_deref().unwrap_or("")), 60);
    vec![RuleHit::new(
        "italic-serif-display",
        format!(
            "italic serif {} ({}) at {}px \"{}\"",
            tag,
            res.primary.as_deref().unwrap_or("serif"),
            number_to_string(math_round(opts.font_size)),
            text
        ),
    )]
}

// ─── isAccentColor ──────────────────────────────────────────────────────────
re!(
    ACCENT_RGB_STRICT,
    format!(r"rgba?\({WS}*({D}+){WS}*,{WS}*({D}+){WS}*,{WS}*({D}+)")
);
re!(ACCENT_HEX, format!(r"^#([0-9a-fA-F]{{3,8}}){B}"));
re!(ACCENT_OKLCH_HEAD, format!(r"^{}\(", ci("oklch")));
re!(ACCENT_NUMS, format!(r"{D}*\.{D}+|{D}+"));
re!(
    ACCENT_HSL,
    format!(r"{}[aA]?\({WS}*[0-9.]+{WS}*,{WS}*([0-9.]+)%", ci("hsl"))
);

/// JS: checks.mjs#isAccentColor
pub fn is_accent_color(css_color: &str) -> bool {
    if css_color.is_empty() {
        return false;
    }
    let s = js::trim(css_color);
    if let Some(m) = ACCENT_RGB_STRICT.captures(s) {
        let r = string_to_number(&m[1]);
        let g = string_to_number(&m[2]);
        let b = string_to_number(&m[3]);
        return (js::math_max3(r, g, b) - js::math_min3(r, g, b)) >= 40.0;
    }
    if let Some(m) = ACCENT_HEX.captures(s) {
        let raw = &m[1];
        let h: String = if raw.len() == 3 || raw.len() == 4 {
            let doubled: String = raw.chars().flat_map(|c| [c, c]).collect();
            doubled.chars().take(6).collect()
        } else {
            raw.chars().take(6).collect()
        };
        if h.len() == 6 {
            let r = parse_int(&h[0..2], 16);
            let g = parse_int(&h[2..4], 16);
            let b = parse_int(&h[4..6], 16);
            return (js::math_max3(r, g, b) - js::math_min3(r, g, b)) >= 40.0;
        }
    }
    if ACCENT_OKLCH_HEAD.is_match(s) {
        let nums: Vec<&str> = ACCENT_NUMS.find_iter(s).map(|m| m.as_str()).collect();
        if nums.len() >= 2 {
            let c = parse_float(nums[1]);
            return !c.is_nan() && c >= 0.05;
        }
    }
    if let Some(m) = ACCENT_HSL.captures(s) {
        let sat = parse_float(&m[1]);
        return !sat.is_nan() && sat >= 20.0;
    }
    false
}

// ─── resolveHeroHeadingSizePx ───────────────────────────────────────────────
re!(
    SIMPLE_LENGTH,
    format!(r"^(-?{D}*\.?{D}+){WS}*(px|rem|em|%)?$")
);
re!(CLAMP_RE, format!(r"^clamp\(({DOT}*)\)$"));

fn simple_length_px(token: &str) -> Option<f64> {
    let m = SIMPLE_LENGTH.captures(js::trim(token))?;
    let amount = string_to_number(&m[1]);
    if !amount.is_finite() {
        return None;
    }
    match m.get(2).map(|u| u.as_str()) {
        Some("rem") | Some("em") => Some(amount * 16.0),
        Some("%") => Some(amount * 0.16),
        _ => Some(amount),
    }
}

/// JS: checks.mjs#resolveHeroHeadingSizePx
pub fn resolve_hero_heading_size_px(value: Option<&str>) -> f64 {
    let input = js::to_lower_case(js::trim(value.unwrap_or("")));
    if input.is_empty() {
        return 0.0;
    }
    if let Some(direct) = simple_length_px(&input) {
        return direct;
    }
    if let Some(m) = CLAMP_RE.captures(&input) {
        let parts: Vec<&str> = m[1].split(',').collect();
        if parts.len() == 3 {
            let bounds: Vec<f64> = [simple_length_px(parts[0]), simple_length_px(parts[2])]
                .into_iter()
                .flatten()
                .collect();
            if !bounds.is_empty() {
                let mut mx = f64::NEG_INFINITY;
                for b in bounds {
                    mx = math_max(mx, b);
                }
                return mx;
            }
        }
    }
    0.0
}

/// JS: checks.mjs#checkHeroEyebrow
pub fn check_hero_eyebrow(opts: &HeroEyebrowOpts) -> Vec<RuleHit> {
    if opts.heading_tag != "h1" {
        return Vec::new();
    }
    if opts.heading_in_application_context {
        return Vec::new();
    }
    if !(opts.heading_font_size >= 48.0) {
        return Vec::new();
    }
    let sibling_tag = match opts.sibling_tag.as_deref() {
        None | Some("") => return Vec::new(),
        Some(t) => t,
    };
    if is_heading_tag(sibling_tag) {
        return Vec::new();
    }
    let text = js::trim(opts.sibling_text.as_deref().unwrap_or(""));
    let text_len = utf16_length(text);
    if text_len < 2 || text_len > 60 {
        return Vec::new();
    }
    if !(opts.sibling_font_size > 0.0 && opts.sibling_font_size <= 14.0) {
        return Vec::new();
    }
    let is_uppercased = opts.sibling_text_transform.as_deref() == Some("uppercase")
        || (text.bytes().any(|b| b.is_ascii_uppercase())
            && !text.bytes().any(|b| b.is_ascii_lowercase()));
    let is_classic_tracked = is_uppercased && opts.sibling_letter_spacing >= 1.6;

    let weight = {
        let n = match opts.sibling_font_weight.as_deref() {
            None => f64::NAN,
            Some(s) => string_to_number(s),
        };
        if num_truthy(n) {
            n
        } else {
            400.0
        }
    };
    let is_accent_bold =
        weight >= 700.0 && is_accent_color(opts.sibling_color.as_deref().unwrap_or(""));
    let is_dash_prefixed = opts.sibling_has_accent_dash_pseudo;
    if !is_classic_tracked && !is_accent_bold && !is_dash_prefixed {
        return Vec::new();
    }
    let heading_text_snippet =
        slice_utf16_start(js::trim(opts.heading_text.as_deref().unwrap_or("")), 60);
    let eyebrow_snippet = slice_utf16_start(text, 40);
    let style = if is_classic_tracked {
        "tracked-caps"
    } else if is_accent_bold {
        "accent-bold"
    } else {
        "dash-prefix"
    };
    vec![RuleHit::new(
        "hero-eyebrow-chip",
        format!(
            "eyebrow chip ({}) \"{}\" above {} \"{}\"",
            style, eyebrow_snippet, opts.heading_tag, heading_text_snippet
        ),
    )]
}

/// JS: checks.mjs#checkKickerAboveHeading
pub fn check_kicker_above_heading(candidates: &[KickerCandidate]) -> Vec<RuleHit> {
    candidates
        .iter()
        .map(|c| {
            RuleHit::new(
                "kicker-above-heading",
                format!(
                    "kicker \"{}\" above {} \"{}\"",
                    c.kicker_text, c.heading_tag, c.heading_text
                ),
            )
        })
        .collect()
}

// ─── checkMotion ────────────────────────────────────────────────────────────

/// JS `LAYOUT_TRANSITION_PROPS`.
pub const LAYOUT_TRANSITION_PROPS: &[&str] = &[
    "width",
    "height",
    "padding",
    "margin",
    "max-height",
    "max-width",
    "min-height",
    "min-width",
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left",
    "margin-top",
    "margin-right",
    "margin-bottom",
    "margin-left",
];

re!(
    BOUNCE_NAME,
    format!(
        "{}|{}|{}|{}|{}",
        ci("bounce"),
        ci("elastic"),
        ci("wobble"),
        ci("jiggle"),
        ci("spring")
    )
);
re!(TW_ANIMATE_BOUNCE, format!(r"{B}animate-bounce{B}"));
/// JS `/cubic-bezier\(\s*([\d.-]+)\s*,\s*([\d.-]+)\s*,\s*([\d.-]+)\s*,\s*([\d.-]+)\s*\)/g`.
pub(crate) static BEZIER_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(&format!(
        r"cubic-bezier\({WS}*([0-9.-]+){WS}*,{WS}*([0-9.-]+){WS}*,{WS}*([0-9.-]+){WS}*,{WS}*([0-9.-]+){WS}*\)"
    ))
    .expect("BEZIER_RE")
});

/// JS: checks.mjs#checkMotion
pub fn check_motion(opts: &MotionOpts) -> Vec<RuleHit> {
    if set_has(SAFE_TAGS, &opts.tag) {
        return Vec::new();
    }
    let mut findings = Vec::new();
    if let Some(name) = opts.animation_name.as_deref() {
        if !name.is_empty() && name != "none" && BOUNCE_NAME.is_match(name) {
            findings.push(RuleHit::new("bounce-easing", format!("animation: {name}")));
        }
    }
    if let Some(cls) = opts.class_list.as_deref() {
        if !cls.is_empty() && TW_ANIMATE_BOUNCE.is_match(cls) {
            findings.push(RuleHit::new(
                "bounce-easing",
                "animate-bounce (Tailwind)".to_string(),
            ));
        }
    }
    if let Some(tf) = opts.timing_functions.as_deref() {
        if !tf.is_empty() {
            for m in BEZIER_RE.captures_iter(tf) {
                let y1 = parse_float(&m[2]);
                let y2 = parse_float(&m[4]);
                if y1 < -0.1 || y1 > 1.1 || y2 < -0.1 || y2 > 1.1 {
                    findings.push(RuleHit::new(
                        "bounce-easing",
                        format!("cubic-bezier({}, {}, {}, {})", &m[1], &m[2], &m[3], &m[4]),
                    ));
                    break;
                }
            }
        }
    }
    if let Some(tp) = opts.transition_property.as_deref() {
        if !tp.is_empty() && tp != "all" && tp != "none" {
            let layout_found: Vec<String> = tp
                .split(',')
                .map(|p| js::to_lower_case(js::trim(p)))
                .filter(|p| set_has(LAYOUT_TRANSITION_PROPS, p))
                .collect();
            if !layout_found.is_empty() {
                findings.push(RuleHit::new(
                    "layout-transition",
                    format!("transition: {}", layout_found.join(", ")),
                ));
            }
        }
    }
    findings
}

fn glow_scan(value: Option<&str>, prop: &str, on_dark_bg: bool) -> Option<RuleHit> {
    let value = match value {
        None | Some("") | Some("none") => return None,
        Some(v) => v,
    };
    for layer in split_commas_outside_parens(value) {
        let info = match find_shadow_color(layer) {
            Some(i) => i,
            None => continue,
        };
        let color = match info.color {
            Some(c) => c,
            None => continue,
        };
        if !has_chroma(Some(&color), Some(30.0)) {
            continue;
        }
        let vals = extract_shadow_lengths(layer, Some((info.start, info.end)));
        if vals.len() < 3 || vals[2] <= 4.0 {
            continue;
        }
        if vals[0] == 0.0 && vals[1] == 0.0 {
            return Some(RuleHit::new(
                "dark-glow",
                format!("Zero-offset {} glow ({})", prop, color_to_hex(Some(&color))),
            ));
        }
        if on_dark_bg {
            return Some(RuleHit::new(
                "dark-glow",
                format!(
                    "Colored {} glow ({}) on dark background",
                    prop,
                    color_to_hex(Some(&color))
                ),
            ));
        }
    }
    None
}

/// JS: checks.mjs#checkGlow
pub fn check_glow(opts: &GlowOpts) -> Vec<RuleHit> {
    let on_dark_bg = opts
        .effective_bg
        .map_or(false, |bg| relative_luminance(&bg) < 0.1);
    let found = glow_scan(opts.box_shadow.as_deref(), "box-shadow", on_dark_bg)
        .or_else(|| glow_scan(opts.text_shadow.as_deref(), "text-shadow", on_dark_bg));
    match found {
        Some(f) => vec![f],
        None => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Expected values below were produced by running the JS functions in
    // Node against the same inputs.

    #[test]
    fn hover_contrast_matches_node() {
        let hits = check_hover_contrast(&HoverContrastOpts {
            tag: "div".into(),
            text_color: Some(Rgba::new(120.0, 120.0, 120.0, 1.0)),
            bg: Some(Rgba::new(255.0, 255.0, 255.0, 1.0)),
            own_bg_alpha: Some(1.0),
            font_size: 16.0,
            font_weight: 400.0,
            has_direct_text: true,
            is_emoji_only: false,
        });
        assert_eq!(hits.len(), 1);
        assert_eq!(
            hits[0].snippet,
            ":hover state 4.4:1 (need 4.5:1) — text #787878 on #ffffff"
        );
        // SAFE_TAGS suppression without an own background.
        let none = check_hover_contrast(&HoverContrastOpts {
            tag: "a".into(),
            text_color: Some(Rgba::new(120.0, 120.0, 120.0, 1.0)),
            bg: Some(Rgba::new(255.0, 255.0, 255.0, 1.0)),
            own_bg_alpha: Some(0.2),
            font_size: 16.0,
            font_weight: 400.0,
            has_direct_text: true,
            is_emoji_only: false,
        });
        assert!(none.is_empty());
        // Large bold text uses the 3:1 threshold.
        let large = check_hover_contrast(&HoverContrastOpts {
            tag: "button".into(),
            text_color: Some(Rgba::new(160.0, 160.0, 160.0, 1.0)),
            bg: Some(Rgba::new(255.0, 255.0, 255.0, 1.0)),
            own_bg_alpha: Some(1.0),
            font_size: 19.0,
            font_weight: 700.0,
            has_direct_text: true,
            is_emoji_only: false,
        });
        assert_eq!(
            large[0].snippet,
            ":hover state 2.6:1 (need 3:1) — text #a0a0a0 on #ffffff"
        );
    }

    #[test]
    fn hero_heading_size_matches_node() {
        assert_eq!(resolve_hero_heading_size_px(Some("3rem")), 48.0);
        assert_eq!(resolve_hero_heading_size_px(Some(" 56PX ")), 56.0);
        assert_eq!(resolve_hero_heading_size_px(Some("200%")), 32.0);
        assert_eq!(
            resolve_hero_heading_size_px(Some("clamp(2rem, 5vw, 4.5rem)")),
            72.0
        );
        assert_eq!(
            resolve_hero_heading_size_px(Some("clamp(40px, 6vw, 10vw)")),
            40.0
        );
        assert_eq!(resolve_hero_heading_size_px(Some("clamp(5vw, 6vw)")), 0.0);
        assert_eq!(resolve_hero_heading_size_px(Some("5vw")), 0.0);
        assert_eq!(resolve_hero_heading_size_px(None), 0.0);
        assert_eq!(resolve_hero_heading_size_px(Some("")), 0.0);
        assert_eq!(resolve_hero_heading_size_px(Some(".5em")), 8.0);
    }

    #[test]
    fn shadow_helpers_match_node() {
        let c = find_shadow_color("0 0 20px rgba(59,130,246,0.4)").unwrap();
        assert_eq!((c.start, c.end), (9, 29));
        assert_eq!(c.color, Some(Rgba::new(59.0, 130.0, 246.0, 0.4)));
        let hex = find_shadow_color("0 0 20px #3b82f6").unwrap();
        assert_eq!((hex.start, hex.end), (9, 16));
        let named = find_shadow_color("inset 0 0 4px Red").unwrap();
        assert_eq!((named.start, named.end), (14, 17));
        assert_eq!(named.color, Some(Rgba::new(255.0, 0.0, 0.0, 1.0)));
        assert!(find_shadow_color("0 0 4px var(--x)").is_none());
        let p3 = find_shadow_color("0 0 4px color(display-p3 1 0 0)").unwrap();
        assert_eq!((p3.start, p3.end), (8, 31));
        assert_eq!(p3.color, Some(Rgba::new(255.0, 0.0, 0.0, 1.0)));
        assert_eq!(
            extract_shadow_lengths("0 0 20px rgba(59,130,246,0.4)", Some((9, 29))),
            vec![0.0, 0.0, 20.0]
        );
        assert_eq!(
            extract_shadow_lengths("0 1rem .5em 2px", None),
            vec![0.0, 16.0, 8.0, 2.0]
        );
        assert_eq!(
            extract_shadow_lengths("rgb(1, 2, 3) 0px 0px 20px", None),
            vec![1.0, 2.0, 3.0, 0.0, 0.0, 20.0]
        );
    }

    #[test]
    fn heading_tags_and_card_like() {
        assert!(is_heading_tag("h4"));
        assert!(!is_heading_tag("div"));
        assert!(is_card_like_from_props(true, false, false, true));
        assert!(!is_card_like_from_props(false, false, true, true));
    }
}
