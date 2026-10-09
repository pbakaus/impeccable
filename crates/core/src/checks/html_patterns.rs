//! Port of `cli/engine/rules/checks.mjs` page-level regex-on-HTML checks:
//! `scanHtmlForShapeAssembledIllustration`, `buildHtmlPatternCorpora`, and
//! `checkHtmlPatterns` (the browser / static shared pattern pass).

use crate::checks::css_scan::{
    enclosing_css_selector, scan_css_text_for_buried_raster, scan_css_text_for_glow_with,
    scan_css_text_for_grid_background, scan_css_text_for_inset_stripe, scan_css_text_for_marquee,
    scan_css_text_for_organic_clip_path, scan_css_text_for_pseudo_stripe,
    scan_css_text_for_pulsing_dot, scan_css_text_for_radial_halo_with,
    PatternFinding,
};
use crate::checks::rules::{RuleHit, ANY, B, BEZIER_RE, D, DOT, W};
use crate::js::{self, ci, math_round, number_to_string, parse_float, parse_int, WS, WS_CHARS};
use crate::js_ext_a::{advance_utf16, is_word_byte, retreat_utf16};
use once_cell::sync::Lazy;
use regex::Regex;

/// The corpora type is shared; re-exported so `checks::html_patterns` stays
/// one path.
pub use impeccable_foundation::rules::html_patterns::*;

macro_rules! re {
    ($name:ident, $pat:expr) => {
        static $name: Lazy<Regex> = Lazy::new(|| Regex::new(&$pat).expect(stringify!($name)));
    };
}

// ─── scanHtmlForShapeAssembledIllustration ──────────────────────────────────

re!(
    SVG_BLOCK_RE,
    format!(r"<{svg}{B}[^>]*>{ANY}*?</{svg}>", svg = ci("svg"))
);
re!(SVG_OPEN_RE, format!(r"^<{svg}{B}[^>]*>", svg = ci("svg")));
re!(
    SVG_TEXT_RE,
    format!(
        r"<(?:{text}|{tspan}){B}",
        text = ci("text"),
        tspan = ci("tspan")
    )
);
re!(SVG_PATTERN_RE, format!(r"<{}{B}", ci("pattern")));
re!(
    SVG_PRIMITIVE_RE,
    format!(
        r"<(?:{rect}|{circle}|{ellipse}|{polygon}){B}",
        rect = ci("rect"),
        circle = ci("circle"),
        ellipse = ci("ellipse"),
        polygon = ci("polygon")
    )
);
re!(
    SVG_VIEWBOX_RE,
    format!(
        r#"{B}{vb}{WS}*={WS}*["']{WS}*[-0-9.]+[{WS_CHARS},]+[-0-9.]+[{WS_CHARS},]+([0-9.]+)[{WS_CHARS},]+([0-9.]+){WS}*["']"#,
        vb = ci("viewBox")
    )
);
re!(
    SVG_FILL_RE,
    format!(
        r#"{B}{fill}{WS}*[:=]{WS}*["']?{WS}*([^"';>}}{WS_CHARS}]+)"#,
        fill = ci("fill")
    )
);
re!(
    SVG_WIDTH_RE,
    format!(
        r#"{w}{WS}*={WS}*["']{WS}*([0-9.]+)(?:{px})?{WS}*["']"#,
        w = ci("width"),
        px = ci("px")
    )
);
re!(
    SVG_HEIGHT_RE,
    format!(
        r#"{h}{WS}*={WS}*["']{WS}*([0-9.]+)(?:{px})?{WS}*["']"#,
        h = ci("height"),
        px = ci("px")
    )
);

/// JS `attrDim(name)`: first `name="<num>"` in the open tag whose match is
/// not preceded by `[-\w]` (the lookbehind keeps `stroke-width` out).
fn svg_attr_dim(open_tag: &str, re: &Regex) -> Option<f64> {
    for m in re.captures_iter(open_tag) {
        let start = m.get(0).unwrap().start();
        let preceded = start > 0 && {
            let b = open_tag.as_bytes()[start - 1];
            b == b'-' || is_word_byte(b)
        };
        if preceded {
            continue;
        }
        return Some(parse_float(&m[1]));
    }
    None
}

/// JS: checks.mjs#scanHtmlForShapeAssembledIllustration
pub fn scan_html_for_shape_assembled_illustration(html: &str) -> Vec<RuleHit> {
    let mut findings = Vec::new();
    for m in SVG_BLOCK_RE.find_iter(html) {
        let block = m.as_str();
        let open_tag = SVG_OPEN_RE.find(block).map(|o| o.as_str()).unwrap_or("");
        let text_count = SVG_TEXT_RE.find_iter(block).count();
        if text_count > 2 {
            continue;
        }
        if SVG_PATTERN_RE.is_match(block) {
            continue;
        }
        let primitives = SVG_PRIMITIVE_RE.find_iter(block).count();
        if primitives < 8 {
            continue;
        }
        let vb = SVG_VIEWBOX_RE.captures(open_tag);
        let w = svg_attr_dim(open_tag, &SVG_WIDTH_RE)
            .or_else(|| vb.as_ref().map(|v| parse_float(&v[1])));
        let h = svg_attr_dim(open_tag, &SVG_HEIGHT_RE)
            .or_else(|| vb.as_ref().map(|v| parse_float(&v[2])));
        let (w, h) = match (w, h) {
            (Some(w), Some(h)) => (w, h),
            _ => continue,
        };
        if w < 200.0 || h < 200.0 {
            continue;
        }
        let mut fills: Vec<String> = Vec::new();
        for fm in SVG_FILL_RE.captures_iter(block) {
            let paint = js::to_lower_case(js::trim(&fm[1]));
            if paint.is_empty()
                || matches!(
                    paint.as_str(),
                    "none" | "transparent" | "currentcolor" | "inherit"
                )
            {
                continue;
            }
            if !fills.contains(&paint) {
                fills.push(paint);
            }
        }
        if fills.len() < 3 {
            continue;
        }
        findings.push(RuleHit::new(
            "shape-assembled-illustration",
            format!(
                "inline <svg> scene: {} primitive shapes, ~{}x{}px, {} fill colors",
                primitives,
                number_to_string(math_round(w)),
                number_to_string(math_round(h)),
                fills.len()
            ),
        ));
    }
    findings
}

// ─── buildHtmlPatternCorpora ────────────────────────────────────────────────

re!(HAS_MARKUP_RE, r"<[a-zA-Z!/]".to_string());
re!(
    STYLE_BLOCK_RE,
    format!(r"<{style}{B}[^>]*>({ANY}*?)</{style}>", style = ci("style"))
);
re!(TAG_RE, r"<[a-zA-Z][^>]*>".to_string());
re!(
    STYLE_ATTR_RE,
    format!(
        r#"{B}{style}{WS}*={WS}*("[^"]*"|'[^']*')"#,
        style = ci("style")
    )
);
re!(
    CLASS_ATTR_IN_TAG_RE,
    format!(
        r#"{B}{cls}{WS}*={WS}*(?:"([^"]*)"|'([^']*)')"#,
        cls = ci("class")
    )
);

/// JS: checks.mjs#buildHtmlPatternCorpora
pub fn build_html_pattern_corpora(html: &str) -> HtmlPatternCorpora {
    if !HAS_MARKUP_RE.is_match(html) {
        return HtmlPatternCorpora {
            style_text: html.to_string(),
            class_text: html.to_string(),
        };
    }
    let mut style_parts: Vec<String> = Vec::new();
    let mut class_parts: Vec<String> = Vec::new();
    for m in STYLE_BLOCK_RE.captures_iter(html) {
        style_parts.push(m[1].to_string());
    }
    for t in TAG_RE.find_iter(html) {
        let tag = t.as_str();
        if let Some(sm) = STYLE_ATTR_RE.captures(tag) {
            style_parts.push(format!("style={}", &sm[1]));
        }
        if let Some(cm) = CLASS_ATTR_IN_TAG_RE.captures(tag) {
            let v = cm
                .get(1)
                .or_else(|| cm.get(2))
                .map(|g| g.as_str())
                .unwrap_or("");
            class_parts.push(v.to_string());
        }
    }
    HtmlPatternCorpora {
        style_text: style_parts.join("\n"),
        class_text: class_parts.join("\n"),
    }
}

// ─── checkHtmlPatterns ──────────────────────────────────────────────────────

/// The stock violet hexes the page-level accent check keys on. Kept as a
/// list rather than a regex fragment because a consumer that can render the
/// page (the browser pass) asks whether one of them is actually painted
/// before reporting it.
pub const PURPLE_ACCENT_HEXES: [&str; 9] = [
    "7c3aed", "8b5cf6", "a855f7", "9333ea", "7e22ce", "6d28d9", "6366f1", "764ba2", "667eea",
];
fn ci_alt(alts: &str) -> String {
    alts.split('|').map(ci).collect::<Vec<_>>().join("|")
}
static PURPLE_HEX_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(&format!(
        r"#(?:{}){B}",
        ci_alt(&PURPLE_ACCENT_HEXES.join("|"))
    ))
    .expect("PURPLE_HEX_RE")
});
static PURPLE_TEXT_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(&format!(
        r"(?:(?:^|;){WS}*{color}{WS}*:{WS}*(?:{DOT}*?)(?:#(?:{a}))|{gradient}{DOT}*?#(?:{b}))",
        color = ci("color"),
        gradient = ci("gradient"),
        a = ci_alt("7c3aed|8b5cf6|a855f7|9333ea|7e22ce|6d28d9"),
        b = ci_alt("7c3aed|8b5cf6|a855f7|764ba2|667eea")
    ))
    .expect("PURPLE_TEXT_RE")
});
re!(
    BG_CLIP_TEXT_RE,
    format!(
        r"(?:-webkit-)?{bct}{WS}*:{WS}*{text}",
        bct = ci("background-clip"),
        text = ci("text")
    )
);
re!(GRADIENT_CI_RE, ci("gradient"));
re!(TW_BG_CLIP_TEXT_RE, format!(r"{B}bg-clip-text{B}"));
re!(TW_BG_GRADIENT_TO_RE, format!(r"{B}bg-gradient-to-"));
re!(
    SPACING_PX_RE,
    format!(
        r"(?:{padding}|{margin})(?:-(?:{top}|{right}|{bottom}|{left}))?{WS}*:{WS}*({D}+)px",
        padding = ci("padding"),
        margin = ci("margin"),
        top = ci("top"),
        right = ci("right"),
        bottom = ci("bottom"),
        left = ci("left")
    )
);
re!(
    GAP_PX_RE,
    format!(r"{gap}{WS}*:{WS}*({D}+)px", gap = ci("gap"))
);
re!(
    TW_SPACE_RE,
    format!(r"{B}(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap)-({D}+){B}")
);
re!(
    SPACING_REM_RE,
    format!(
        r"(?:{padding}|{margin})(?:-(?:{top}|{right}|{bottom}|{left}))?{WS}*:{WS}*([0-9.]+){rem}",
        padding = ci("padding"),
        margin = ci("margin"),
        top = ci("top"),
        right = ci("right"),
        bottom = ci("bottom"),
        left = ci("left"),
        rem = ci("rem")
    )
);
re!(
    BOUNCE_ANIM_RE,
    format!(
        r"{animation}(?:-{name})?{WS}*:{WS}*([^;{{}}]*(?:{bounce}|{elastic}|{wobble}|{jiggle}|{spring})[^;{{}}]*)",
        animation = ci("animation"),
        name = ci("name"),
        bounce = ci("bounce"),
        elastic = ci("elastic"),
        wobble = ci("wobble"),
        jiggle = ci("jiggle"),
        spring = ci("spring")
    )
);
re!(
    BOUNCE_WORD_RE,
    format!(
        "{}|{}|{}|{}|{}",
        ci("bounce"),
        ci("elastic"),
        ci("wobble"),
        ci("jiggle"),
        ci("spring")
    )
);
re!(COMMA_WS_SPLIT_RE, format!(r"[,{WS_CHARS}]+"));
re!(
    REPEATING_GRADIENT_RE,
    format!(
        r"{repeating}-(?:{linear}|{radial}|{conic})-{gradient}{WS}*\(",
        repeating = ci("repeating"),
        linear = ci("linear"),
        radial = ci("radial"),
        conic = ci("conic"),
        gradient = ci("gradient")
    )
);
re!(
    SCRIPT_BLOCK_RE,
    format!(
        r"<{script}{B}[^>]*>{ANY}*?</{script}>",
        script = ci("script")
    )
);
re!(
    STYLE_BLOCK_STRIP_RE,
    format!(r"<{style}{B}[^>]*>{ANY}*?</{style}>", style = ci("style"))
);
re!(ANY_TAG_RE, r"<[^>]+>".to_string());
re!(
    THEATER_RE,
    format!(r"{B}({W}+){WS}+{theater}{B}", theater = ci("theater"))
);

/// Whether a `repeating-*-gradient(` whose arguments start `args` tiles at
/// all. Its pattern repeats every span from the first stop to the last, so a
/// ramp that starts at 0 and ends at the full length (`100%`, `360deg`,
/// `1turn`, or no position, which means the same) draws once across the box:
/// a faceted fill, not stripes (freddiemac.com's tonal chevrons). A stop
/// list it cannot read, or a lone stop that may be a `var()` holding a
/// colour and a position, counts as repeating.
///
/// The full length of a radial gradient is its ending shape, and only the
/// default one (`farthest-corner`) reaches every corner of the box. Under
/// `closest-side`, `closest-corner`, `farthest-side` or a stated size the
/// rings go on past `100%`, so a `radial` ramp with any size but the default
/// counts as repeating.
fn repeating_gradient_repeats(args: &str, radial: bool) -> bool {
    use crate::checks::css_scan::split_top_level;
    let stops = split_top_level(args, |c| c == ',');
    let tokens = |stop: &str| -> Vec<String> {
        split_top_level(stop, char::is_whitespace).into_iter().map(js::to_lower_case).collect()
    };
    // The first argument is a direction or a shape unless it opens with a colour.
    let first_index = match tokens(stops.first().copied().unwrap_or("")).first() {
        Some(t)
            if crate::color::parse_any_color(Some(t)).is_some()
                || matches!(t.as_str(), "transparent" | "currentcolor") =>
        {
            0
        }
        Some(t) if t.contains("var(") => return true,
        _ => 1,
    };
    if stops.len() < first_index + 2 {
        return true;
    }
    if radial && first_index == 1 {
        // The prelude also holds a position (`at ...`) and may name how the
        // colours are mixed (`in oklch longer hue`), before or after the
        // shape; neither sizes the ending shape.
        let prelude = tokens(stops[0]);
        let mut sized = false;
        let mut i = 0;
        while i < prelude.len() {
            match prelude[i].as_str() {
                "at" => {
                    i += 1;
                    while i < prelude.len() && prelude[i] != "in" {
                        i += 1;
                    }
                }
                "in" => {
                    i += 2;
                    if prelude.get(i + 1).is_some_and(|t| t == "hue") {
                        i += 2;
                    }
                }
                "circle" | "ellipse" | "farthest-corner" => i += 1,
                _ => {
                    sized = true;
                    break;
                }
            }
        }
        if sized {
            return true;
        }
    }
    let first = tokens(stops[first_index]);
    let last = tokens(stops[stops.len() - 1]);
    if last.len() == 1 && last[0].contains("var(") {
        return true;
    }
    let starts_at_zero = first.get(1).map_or(true, |p| gradient_position(p) == Some(0.0));
    let ends_at_full = last.len() == 1 || last.last().is_some_and(|p| gradient_position(p) == Some(1.0));
    !(starts_at_zero && ends_at_full)
}

/// A gradient stop position as a fraction of the full length: `0` in any
/// unit is 0, and `100%`, `360deg`, `400grad` and `1turn` are 1, written
/// bare or inside `calc()`. Anything else (a length, a `var()`) is `None`.
fn gradient_position(token: &str) -> Option<f64> {
    let mut t: String = token.chars().filter(|c| !c.is_whitespace()).collect();
    while let Some(inner) = t.strip_prefix("calc(").and_then(|r| r.strip_suffix(')')) {
        t = inner.to_string();
    }
    let split = t
        .find(|c: char| !(c.is_ascii_digit() || c == '.' || c == '-' || c == '+'))
        .unwrap_or(t.len());
    let n: f64 = if split == 0 { return None } else { t[..split].parse().ok()? };
    if n == 0.0 {
        return Some(0.0);
    }
    let full = match &t[split..] {
        "%" => 100.0,
        "deg" => 360.0,
        "grad" => 400.0,
        "turn" => 1.0,
        _ => return None,
    };
    Some(n / full)
}

/// The words that make "X theater" the dismissive idiom: a practice called a
/// performance of itself ("security theater", "growth theater"). Any other
/// word before "theater" names a building, a stage or a war zone ("the
/// official theater" of a ballet company, the PLA's "Southern Theater
/// Command"), so the list is closed.
const THEATER_DISMISSIVE_HEADS: &[&str] = &[
    "accessibility",
    "accountability",
    "agile",
    "alignment",
    "compliance",
    "diversity",
    "engagement",
    "governance",
    "growth",
    "hiring",
    "hygiene",
    "innovation",
    "inclusion",
    "kindness",
    "leadership",
    "metrics",
    "privacy",
    "process",
    "productivity",
    "quality",
    "safety",
    "security",
    "strategy",
    "sustainability",
    "transparency",
    "trust",
    "wellness",
];

fn pf(id: &str, snippet: String, selector: Option<String>) -> PatternFinding {
    PatternFinding {
        id: id.to_string(),
        snippet,
        selector,
        index: None,
        severity: None,
    }
}

/// What an engine that renders the page knows about it and the pattern pass
/// cannot read off the text. The default is what the file engines know:
/// nothing, so every decision comes from the stylesheet text.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct PatternContext {
    /// Whether the page's painted root background is dark. `None` decides
    /// from dark background declarations in the style text.
    pub dark_page: Option<bool>,
}

/// JS: checks.mjs#checkHtmlPatterns. `corpora` defaults to
/// `buildHtmlPatternCorpora(html)`. Findings' `index` fields are byte
/// offsets into `corpora.style_text`.
pub fn check_html_patterns(
    html: &str,
    corpora: Option<&HtmlPatternCorpora>,
) -> Vec<PatternFinding> {
    check_html_patterns_with(html, corpora, &PatternContext::default())
}

/// [`check_html_patterns`] with what a rendering engine knows about the page.
pub fn check_html_patterns_with(
    html: &str,
    corpora: Option<&HtmlPatternCorpora>,
    context: &PatternContext,
) -> Vec<PatternFinding> {
    let built;
    let corpora = match corpora {
        Some(c) => c,
        None => {
            built = build_html_pattern_corpora(html);
            &built
        }
    };
    let style_text = corpora.style_text.as_str();
    let class_text = corpora.class_text.as_str();
    let mut findings: Vec<PatternFinding> = Vec::new();

    // --- Color ---
    if PURPLE_HEX_RE.is_match(style_text) {
        if let Some(pm) = PURPLE_TEXT_RE.find(style_text) {
            let idx = advance_utf16(style_text, pm.start(), 1);
            findings.push(pf(
                "ai-color-palette",
                "Purple/violet accent colors detected".to_string(),
                enclosing_css_selector(style_text, idx),
            ));
        }
    }

    for gm in BG_CLIP_TEXT_RE.find_iter(style_text) {
        let start = retreat_utf16(style_text, gm.start(), 200);
        let end = advance_utf16(style_text, gm.end(), 200);
        let context = &style_text[start..end];
        if GRADIENT_CI_RE.is_match(context) && !context_gradients_are_one_colour(context) {
            findings.push(pf(
                "gradient-text",
                "background-clip: text + gradient".to_string(),
                enclosing_css_selector(style_text, gm.start()),
            ));
            break;
        }
    }
    if TW_BG_CLIP_TEXT_RE.is_match(class_text) && TW_BG_GRADIENT_TO_RE.is_match(class_text) {
        findings.push(pf(
            "gradient-text",
            "bg-clip-text + bg-gradient (Tailwind)".to_string(),
            None,
        ));
    }

    // --- Borders ---
    findings.extend(scan_css_text_for_pseudo_stripe(style_text));
    findings.extend(scan_css_text_for_inset_stripe(style_text));

    // --- Layout ---
    let mut spacing_values: Vec<f64> = Vec::new();
    for sm in SPACING_PX_RE.captures_iter(style_text) {
        let v = parse_int(&sm[1], 10);
        if v > 0.0 && v < 200.0 {
            spacing_values.push(v);
        }
    }
    for sm in GAP_PX_RE.captures_iter(style_text) {
        spacing_values.push(parse_int(&sm[1], 10));
    }
    for sm in TW_SPACE_RE.captures_iter(class_text) {
        spacing_values.push(parse_int(&sm[1], 10) * 4.0);
    }
    for sm in SPACING_REM_RE.captures_iter(style_text) {
        let v = math_round(parse_float(&sm[1]) * 16.0);
        if v > 0.0 && v < 200.0 {
            spacing_values.push(v);
        }
    }
    let rounded_spacing: Vec<f64> = spacing_values
        .iter()
        .map(|v| math_round(v / 4.0) * 4.0)
        .collect();
    if rounded_spacing.len() >= 10 {
        // `counts` as a JS object: keys are `String(v)`.
        let mut counts: Vec<(String, f64, usize)> = Vec::new(); // (key, numeric, count)
        for &v in &rounded_spacing {
            let key = number_to_string(v);
            if let Some(slot) = counts.iter_mut().find(|(k, _, _)| *k == key) {
                slot.2 += 1;
            } else {
                counts.push((key, v, 1));
            }
        }
        let max_count = counts.iter().map(|c| c.2).max().unwrap_or(0);
        let dominant_pct = max_count as f64 / rounded_spacing.len() as f64;
        // `[...new Set(roundedSpacing)].filter(v => v > 0)`
        let mut unique: Vec<f64> = Vec::new();
        for &v in &rounded_spacing {
            if !unique.iter().any(|u| (u.is_nan() && v.is_nan()) || *u == v) {
                unique.push(v);
            }
        }
        let unique: Vec<f64> = unique.into_iter().filter(|v| *v > 0.0).collect();
        if dominant_pct > 0.6 && unique.len() <= 3 {
            // JS sorts `Object.entries(counts)` by count and takes the first;
            // `dominantPct > 0.6` means the maximum is unique, so entry
            // order never decides.
            let dominant = &counts.iter().find(|c| c.2 == max_count).unwrap().0;
            findings.push(pf(
                "monotonous-spacing",
                format!(
                    "~{}px used {}/{} times ({}%)",
                    dominant,
                    max_count,
                    rounded_spacing.len(),
                    number_to_string(math_round(dominant_pct * 100.0))
                ),
                None,
            ));
        }
    }

    // --- Motion ---
    // The first declaration that names a bounce reports, as before, unless
    // the stylesheet shows that name's keyframes and they only pulse: a
    // loader dot scaling from nothing to its size and back is called
    // `sk-bounceDelay` and neither moves nor overshoots. Then the next
    // declaration is read, so a pulse never hides a bounce declared after it.
    // Every bounce-named token in a declaration's list is read the same way,
    // so a pulse listed first never hides a bounce listed after it.
    for bm in BOUNCE_ANIM_RE.captures_iter(style_text) {
        let list = &bm[1];
        let mut labels: Vec<String> = COMMA_WS_SPLIT_RE
            .split(list)
            .filter(|part| !part.is_empty() && BOUNCE_WORD_RE.is_match(part))
            .map(str::to_string)
            .collect();
        if labels.is_empty() {
            labels.push(js::trim(list).to_string());
        }
        let Some(label) = labels
            .into_iter()
            .find(|label| crate::checks::css_scan::css_keyframes_only_pulse(style_text, label) != Some(true))
        else {
            continue;
        };
        findings.push(pf(
            "bounce-easing",
            format!("animation: {}", label),
            enclosing_css_selector(style_text, bm.get(0).unwrap().start()),
        ));
        break;
    }

    for bm in BEZIER_RE.captures_iter(style_text) {
        let y1 = parse_float(&bm[2]);
        let y2 = parse_float(&bm[4]);
        if y1 < -0.1 || y1 > 1.1 || y2 < -0.1 || y2 > 1.1 {
            findings.push(pf(
                "bounce-easing",
                format!(
                    "cubic-bezier({}, {}, {}, {})",
                    &bm[1], &bm[2], &bm[3], &bm[4]
                ),
                enclosing_css_selector(style_text, bm.get(0).unwrap().start()),
            ));
            break;
        }
    }

    findings.extend(scan_css_text_for_pulsing_dot(style_text, Some(html)));
    findings.extend(
        scan_html_for_shape_assembled_illustration(html)
            .into_iter()
            .map(|h| pf(&h.id, h.snippet, None)),
    );

    // Organic clip-path contours and rasters buried under washes or opacity
    findings.extend(scan_css_text_for_organic_clip_path(style_text));
    findings.extend(scan_css_text_for_buried_raster(style_text));

    findings.extend(scan_css_text_for_marquee(style_text, Some(html)));

    // --- Dark glow / chromatic halo shadows ---
    let glow_hits = scan_css_text_for_glow_with(style_text, context.dark_page);
    if let Some(first) = glow_hits.first() {
        findings.push(pf(
            "dark-glow",
            first.snippet.clone(),
            enclosing_css_selector(style_text, first.index),
        ));
    }
    let halo_hits = scan_css_text_for_radial_halo_with(style_text, context.dark_page);
    if let Some(first) = halo_hits.first() {
        findings.push(pf(
            "radial-halo",
            first.snippet.clone(),
            enclosing_css_selector(style_text, first.index),
        ));
    }

    // --- Generated-UI tells: repeating-gradient stripes ---
    if let Some(sm) = REPEATING_GRADIENT_RE
        .find_iter(style_text)
        .find(|m| {
            let radial = js::to_lower_case(m.as_str()).contains("radial");
            repeating_gradient_repeats(&style_text[m.end()..], radial)
        })
    {
        findings.push(pf(
            "repeating-stripes-gradient",
            "repeating-gradient decorative stripes".to_string(),
            enclosing_css_selector(style_text, sm.start()),
        ));
    }

    // --- Generated-UI tells: two-axis grid-line background ---
    let grid_hits = scan_css_text_for_grid_background(style_text);
    if let Some(first) = grid_hits.first() {
        findings.push(pf(
            "codex-grid-background",
            first.snippet.clone(),
            enclosing_css_selector(style_text, first.index),
        ));
    }

    // --- Generated-copy tells: "X theater" framing copy ---
    {
        let no_script = SCRIPT_BLOCK_RE.replace_all(html, " ");
        let no_style = STYLE_BLOCK_STRIP_RE.replace_all(&no_script, " ");
        let body_text = ANY_TAG_RE.replace_all(&no_style, " ");
        if let Some(tm) = THEATER_RE
            .captures_iter(&body_text)
            .find(|c| THEATER_DISMISSIVE_HEADS.contains(&js::to_lower_case(&c[1]).as_str()))
            .and_then(|c| c.get(0))
        {
            findings.push(pf(
                "theater-slop-phrase",
                format!("\"{}\"", js::trim(tm.as_str())),
                None,
            ));
        }
    }

    findings
}

/// Whether every gradient function written in a declaration's context
/// paints one colour ([`crate::checks::rules::gradient_stops_are_one_colour`]):
/// a `linear-gradient(rgb(14, 15, 18) 0%, rgb(14, 15, 18) 53%)` clipped to
/// text is solid type. With no gradient function read in full, no.
fn context_gradients_are_one_colour(context: &str) -> bool {
    let lower = context.to_ascii_lowercase();
    let mut found = 0usize;
    let mut from = 0usize;
    while let Some(rel) = lower[from..].find("gradient(") {
        let open = from + rel + "gradient".len();
        let mut depth = 0i32;
        let mut close = None;
        for (i, c) in context[open..].char_indices() {
            match c {
                '(' => depth += 1,
                ')' => {
                    depth -= 1;
                    if depth == 0 {
                        close = Some(open + i);
                        break;
                    }
                }
                _ => {}
            }
        }
        let Some(close) = close else { return false };
        let function = format!("linear-gradient{}", &context[open..=close]);
        if !crate::checks::rules::gradient_stops_are_one_colour(&function) {
            return false;
        }
        found += 1;
        from = close + 1;
    }
    found > 0
}

#[cfg(test)]
mod tests {
    use super::*;

    // Expected values come from running the JS functions in Node.

    /// freddiemac.com: a repeating gradient whose last stop sits at 100%, or
    /// has no position, draws its ramp once and never tiles.
    #[test]
    fn a_repeating_gradient_that_never_repeats_is_not_stripes() {
        assert!(!repeating_gradient_repeats("147deg, rgb(3, 46, 109), rgb(3, 46, 109) 40%, rgb(2, 29, 69) 80%, rgb(2, 29, 69)), none", false));
        assert!(!repeating_gradient_repeats("90deg, #eee, #ddd 100%)", false));
        assert!(repeating_gradient_repeats("45deg, #eee, #eee 10px, #fafafa 10px, #fafafa 20px)", false));
        assert!(repeating_gradient_repeats("to top, transparent 0, transparent calc(25% - 1px), var(--n) calc(25% - 1px), var(--n) 25%)", false));
        assert!(repeating_gradient_repeats("45deg, var(--a), var(--stripe))", false));
        // The period runs from the first stop: one at 80% tiles every 20%.
        assert!(repeating_gradient_repeats("90deg, #000 80%, #fff 90%, #000 100%)", false));
        // A full length written another way still draws once.
        assert!(!repeating_gradient_repeats("90deg, #000, #fff 100.0%)", false));
        assert!(!repeating_gradient_repeats("90deg, #000 0%, #fff calc(100%))", false));
        assert!(!repeating_gradient_repeats("from 0deg, #000, #fff 1turn)", false));
        assert!(!repeating_gradient_repeats("#000, #fff)", false));
        assert!(repeating_gradient_repeats("#000, #fff 50%)", false));
        // A unitless 0 is a zero, and a keyword colour opens the stop list.
        assert!(!repeating_gradient_repeats("90deg, #000 0, #fff 100%)", false));
        assert!(!repeating_gradient_repeats("transparent, #fff 100%)", false));
        assert!(!repeating_gradient_repeats("currentColor 0, #fff)", false));
        // A radial ramp to 100% covers the box only at the default size:
        // rings sized to the closest side, or to a stated radius, go on.
        assert!(!repeating_gradient_repeats("circle, #000 0%, #fff 100%)", true));
        assert!(!repeating_gradient_repeats("#000, #fff)", true));
        assert!(!repeating_gradient_repeats("ellipse farthest-corner at 20% 30%, #000, #fff 100%)", true));
        assert!(repeating_gradient_repeats("circle closest-side, #000 0%, #fff 100%)", true));
        assert!(repeating_gradient_repeats("closest-corner at 50% 50%, #000, #fff)", true));
        assert!(repeating_gradient_repeats("circle 40px at center, #000, #fff 100%)", true));
        assert!(repeating_gradient_repeats("farthest-side, #000, #fff 100%)", true));
        // Naming the colour space, before or after the shape, sizes nothing.
        assert!(!repeating_gradient_repeats("circle in srgb, #000 0%, #fff 100%)", true));
        assert!(!repeating_gradient_repeats("in oklch longer hue, #000, #fff)", true));
        assert!(!repeating_gradient_repeats("in hsl circle at 10% 20%, #000, #fff 100%)", true));
        assert!(!repeating_gradient_repeats("ellipse at top left in oklab, #000, #fff 100%)", true));
        assert!(repeating_gradient_repeats("circle closest-side in srgb, #000, #fff 100%)", true));
        assert!(repeating_gradient_repeats("in srgb 40px 20px at center, #000, #fff 100%)", true));
        let ids = |css: &str| -> Vec<String> {
            check_html_patterns(&format!("<style>{css}</style>"), None).into_iter().map(|f| f.id).collect()
        };
        let rings = ".r{background:repeating-radial-gradient(circle closest-side,#000 0%,#fff 100%)}";
        assert!(ids(rings).contains(&"repeating-stripes-gradient".to_string()));
        let once = ".a{background:repeating-linear-gradient(147deg,#032e6d,#032e6d 40%,#021d45)}";
        let tiles = ".b{background:repeating-linear-gradient(45deg,#eee,#eee 10px,#fafafa 10px,#fafafa 20px)}";
        assert!(!ids(once).contains(&"repeating-stripes-gradient".to_string()));
        // A later gradient that tiles still reports.
        assert!(ids(&format!("{once}{tiles}")).contains(&"repeating-stripes-gradient".to_string()));
    }

    /// auradeballet.com's "official theater" and globaltimes.cn's "Southern
    /// Theater" Command name a building and a war zone.
    #[test]
    fn theater_framing_needs_a_dismissive_head() {
        let theater = |text: &str| -> Vec<String> {
            check_html_patterns(&format!("<p>{text}</p>"), None)
                .into_iter()
                .filter(|f| f.id == "theater-slop-phrase")
                .map(|f| f.snippet)
                .collect()
        };
        assert!(theater("The company returns to its official theater.").is_empty());
        assert!(theater("The PLA Southern Theater Command held drills.").is_empty());
        assert!(theater("Dance in any theater you like.").is_empty());
        assert_eq!(
            theater("The Southern Theater met. We cut the compliance theater.").as_slice(),
            ["\"compliance theater\""]
        );
    }

    #[test]
    fn corpora_match_node() {
        let c = build_html_pattern_corpora("a{b:c}");
        assert_eq!(
            (c.style_text.as_str(), c.class_text.as_str()),
            ("a{b:c}", "a{b:c}")
        );
        let c = build_html_pattern_corpora(
            "<style>.a{b:c}</style><div style=\"x:y\" class=\"p q\"><span class='r'>t</span></div><p STYLE='m:n'>&lt;div style=\"z\"&gt;</p>",
        );
        assert_eq!(c.style_text, ".a{b:c}\nstyle=\"x:y\"\nstyle='m:n'");
        assert_eq!(c.class_text, "p q\nr");
        let c = build_html_pattern_corpora("<!-- x --><div>");
        assert_eq!((c.style_text.as_str(), c.class_text.as_str()), ("", ""));
        let c = build_html_pattern_corpora("<style>a</style><style>b</style>");
        assert_eq!(c.style_text, "a\nb");
    }

    #[test]
    fn svg_attr_dim_lookbehind() {
        let scene = "<rect fill=\"red\"/><rect fill=\"blue\"/><rect fill=\"#0f0\"/><circle/><circle/><circle/><ellipse/><polygon/></svg>";
        let hits = scan_html_for_shape_assembled_illustration(&format!(
            "<svg stroke-width=\"1\" viewBox=\"0 0 400 300\">{scene}"
        ));
        assert_eq!(
            hits[0].snippet,
            "inline <svg> scene: 8 primitive shapes, ~400x300px, 3 fill colors"
        );
        assert!(scan_html_for_shape_assembled_illustration(&format!(
            "<svg stroke-width=\"1\" width=\"100\" viewBox=\"0 0 400 300\">{scene}"
        ))
        .is_empty());
        let nan = scan_html_for_shape_assembled_illustration(&format!(
            "<svg width=\".\" height=\".\">{scene}"
        ));
        assert_eq!(
            nan[0].snippet,
            "inline <svg> scene: 8 primitive shapes, ~NaNxNaNpx, 3 fill colors"
        );
    }

    #[test]
    fn spacing_and_theater_match_node() {
        let out = check_html_patterns(
            "<style>.a{padding:8px;margin:8px;gap:8px;padding-top:8px;margin-left:8px;padding:8px;margin:0.5rem;gap:5000000000px;padding:9px}</style><p class=\"p-2 gap-2\">security theater here</p>",
            None,
        );
        let snippets: Vec<&str> = out.iter().map(|f| f.snippet.as_str()).collect();
        assert_eq!(
            snippets,
            vec!["~8px used 10/11 times (91%)", "\"security theater\""]
        );
        let out = check_html_patterns(
            "<style>.a{padding:8px;margin:8px;gap:8px;padding-top:8px;margin-left:8px;padding:8px;margin:0.5rem;gap:8px;padding:9px;gap:9px;gap:9px}</style>",
            None,
        );
        assert_eq!(out[0].snippet, "~8px used 11/11 times (100%)");
    }

    /// Hover zoom on card imagery is a long-standing convention, so none of
    /// the shapes the retired `image-hover-transform` rule used to match are
    /// reported any more: the CSS rule on the image's own hover, the parent
    /// card's hover, and the utility-class forms (including the
    /// `group-hover:` prefix, which fires from the card rather than the
    /// image).
    #[test]
    fn image_hover_zoom_is_silent() {
        let out = check_html_patterns(
            "<style>.card img{transition:transform .3s}.card img:hover{transform:scale(1.05)}.card:hover img{transform:scale(1.04)}</style>\
             <a class=\"card group\"><img class=\"transition-transform group-hover:scale-[1.04] hover:scale-105\" src=\"a.png\" width=\"240\" height=\"160\" alt=\"Card thumbnail\" /></a>",
            None,
        );
        assert!(out.is_empty(), "unexpected findings: {out:?}");
    }
    /// epcco.com.sa: SpinKit's loader dots run `sk-circleBounceDelay`, which
    /// scales a dot from nothing to its size and back.
    #[test]
    fn a_bounce_name_whose_keyframes_only_pulse_is_not_a_bounce() {
        let bounce = |css: &str| -> Vec<String> {
            check_html_patterns(&format!("<style>{css}</style>"), None)
                .into_iter()
                .filter(|f| f.id == "bounce-easing")
                .map(|f| f.snippet)
                .collect()
        };
        let spinner = ".sk-child:before{animation:sk-circleBounceDelay 1.2s infinite ease-in-out both}\
@keyframes sk-circleBounceDelay{0%,80%,100%{transform:scale(0)}40%{transform:scale(1)}}";
        assert!(bounce(spinner).is_empty());
        // The pulse does not hide a bounce declared after it.
        let both = format!("{spinner} .ball{{animation:bounce 1s infinite}} @keyframes bounce{{0%,100%{{transform:translateY(-25%)}}50%{{transform:none}}}}");
        assert_eq!(bounce(&both), vec!["animation: bounce".to_string()]);
        // Keyframes the stylesheet does not show keep the finding.
        assert_eq!(
            bounce(".sk-child:before{animation:sk-circleBounceDelay 1.2s infinite}"),
            vec!["animation: sk-circleBounceDelay".to_string()]
        );
        // A pop past full size is a bounce.
        assert_eq!(
            bounce(".badge{animation:bounce-in .4s} @keyframes bounce-in{0%{transform:scale(0)}60%{transform:scale(1.15)}100%{transform:scale(1)}}"),
            vec!["animation: bounce-in".to_string()]
        );
        // review of #947: a pulse listed first in one declaration does not
        // hide a bounce listed after it in the same list.
        let listed = ".dot{animation:sk-bounceDelay 1s infinite, bounce-in .4s}\
@keyframes sk-bounceDelay{0%,100%{transform:scale(0)}50%{transform:scale(1)}}\
@keyframes bounce-in{0%{transform:scale(0)}60%{transform:scale(1.15)}100%{transform:scale(1)}}";
        assert_eq!(bounce(listed), vec!["animation: bounce-in".to_string()]);
        // A list of pulses alone stays quiet.
        let pulses = ".dot{animation:sk-bounceDelay 1s infinite, sk-bounceDelay2 2s infinite}\
@keyframes sk-bounceDelay{0%,100%{transform:scale(0)}50%{transform:scale(1)}}\
@keyframes sk-bounceDelay2{0%,100%{opacity:0}50%{opacity:1}}";
        assert!(bounce(pulses).is_empty());
    }
}
