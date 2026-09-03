//! Port of `cli/engine/rules/checks.mjs` page-level regex-on-HTML checks:
//! `scanHtmlForShapeAssembledIllustration`, `buildHtmlPatternCorpora`, and
//! `checkHtmlPatterns` (the browser / static shared pattern pass).

use crate::checks::css_scan::{
    enclosing_css_selector, scan_css_text_for_buried_raster, scan_css_text_for_glow,
    scan_css_text_for_grid_background, scan_css_text_for_inset_stripe, scan_css_text_for_marquee,
    scan_css_text_for_organic_clip_path, scan_css_text_for_pseudo_stripe,
    scan_css_text_for_pulsing_dot, scan_css_text_for_radial_halo, PatternFinding,
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

const PURPLE_HEX_ALT: &str = "7c3aed|8b5cf6|a855f7|9333ea|7e22ce|6d28d9|6366f1|764ba2|667eea";
fn ci_alt(alts: &str) -> String {
    alts.split('|').map(ci).collect::<Vec<_>>().join("|")
}
static PURPLE_HEX_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(&format!(r"#(?:{}){B}", ci_alt(PURPLE_HEX_ALT))).expect("PURPLE_HEX_RE")
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
    TRANSITION_RE,
    format!(
        r"{transition}(?:-{property})?{WS}*:{WS}*([^;{{}}]+)",
        transition = ci("transition"),
        property = ci("property")
    )
);
re!(ALL_WORD_RE, format!(r"{B}all{B}"));
re!(
    LAYOUT_PROP_RE,
    format!(
        r"{B}(?:(?:{max}|{min})-)?(?:{width}|{height}){B}|{B}{padding}(?:-(?:{top}|{right}|{bottom}|{left}))?{B}|{B}{margin}(?:-(?:{top}|{right}|{bottom}|{left}))?{B}",
        max = ci("max"),
        min = ci("min"),
        width = ci("width"),
        height = ci("height"),
        padding = ci("padding"),
        margin = ci("margin"),
        top = ci("top"),
        right = ci("right"),
        bottom = ci("bottom"),
        left = ci("left")
    )
);
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
re!(
    IMG_HOVER_CSS_RE,
    format!(
        r"{B}{img}{B}[^,{{}}]*:{hover}{B}[^{{}}]*\{{[^}}]*{B}{transform}{WS}*:{WS}*(?:{scale}|{rotate}|{translate}|{matrix}|{skew})",
        img = ci("img"),
        hover = ci("hover"),
        transform = ci("transform"),
        scale = ci("scale"),
        rotate = ci("rotate"),
        translate = ci("translate"),
        matrix = ci("matrix"),
        skew = ci("skew")
    )
);
re!(
    IMG_TAG_CLASS_RE,
    format!(
        r#"<{img}{B}[^>]*{B}{cls}{WS}*={WS}*"([^"]*)""#,
        img = ci("img"),
        cls = ci("class")
    )
);
re!(
    TW_HOVER_TRANSFORM_RE,
    format!(r"{B}hover:(?:scale|rotate|translate|skew)-")
);

fn pf(id: &str, snippet: String, selector: Option<String>) -> PatternFinding {
    PatternFinding {
        id: id.to_string(),
        snippet,
        selector,
        index: None,
        severity: None,
    }
}

/// JS: checks.mjs#checkHtmlPatterns. `corpora` defaults to
/// `buildHtmlPatternCorpora(html)`. Findings' `index` fields are byte
/// offsets into `corpora.style_text`.
pub fn check_html_patterns(
    html: &str,
    corpora: Option<&HtmlPatternCorpora>,
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
        if GRADIENT_CI_RE.is_match(context) {
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
    if let Some(bm) = BOUNCE_ANIM_RE.captures(style_text) {
        let list = &bm[1];
        let token = COMMA_WS_SPLIT_RE
            .split(list)
            .find(|part| BOUNCE_WORD_RE.is_match(part));
        let label = match token {
            Some(t) if !t.is_empty() => t.to_string(),
            _ => js::trim(list).to_string(),
        };
        findings.push(pf(
            "bounce-easing",
            format!("animation: {}", label),
            enclosing_css_selector(style_text, bm.get(0).unwrap().start()),
        ));
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

    for tm in TRANSITION_RE.captures_iter(style_text) {
        let val = js::to_lower_case(&tm[1]);
        if ALL_WORD_RE.is_match(&val) {
            continue;
        }
        let found: Vec<&str> = LAYOUT_PROP_RE.find_iter(&val).map(|m| m.as_str()).collect();
        if !found.is_empty() {
            findings.push(pf(
                "layout-transition",
                format!("transition: {}", found.join(", ")),
                None,
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
    let glow_hits = scan_css_text_for_glow(style_text);
    if let Some(first) = glow_hits.first() {
        findings.push(pf(
            "dark-glow",
            first.snippet.clone(),
            enclosing_css_selector(style_text, first.index),
        ));
    }
    let halo_hits = scan_css_text_for_radial_halo(style_text);
    if let Some(first) = halo_hits.first() {
        findings.push(pf(
            "radial-halo",
            first.snippet.clone(),
            enclosing_css_selector(style_text, first.index),
        ));
    }

    // --- Generated-UI tells: repeating-gradient stripes ---
    if let Some(sm) = REPEATING_GRADIENT_RE.find(style_text) {
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
        if let Some(tm) = THEATER_RE.find(&body_text) {
            findings.push(pf(
                "theater-slop-phrase",
                format!("\"{}\"", js::trim(tm.as_str())),
                None,
            ));
        }
    }

    // --- Generated-UI tells: image hover transform ---
    if let Some(im) = IMG_HOVER_CSS_RE.find(style_text) {
        let brace = im.as_str().find('{').unwrap_or(0);
        findings.push(pf(
            "image-hover-transform",
            "img:hover { transform } rule".to_string(),
            enclosing_css_selector(style_text, im.start() + brace + 1),
        ));
    }
    for im in IMG_TAG_CLASS_RE.captures_iter(html) {
        if TW_HOVER_TRANSFORM_RE.is_match(&im[1]) {
            findings.push(pf(
                "image-hover-transform",
                "Tailwind hover transform on <img>".to_string(),
                None,
            ));
        }
    }

    findings
}

#[cfg(test)]
mod tests {
    use super::*;

    // Expected values come from running the JS functions in Node.

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
}
