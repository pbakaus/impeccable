//! Port of cli/engine/rules/checks.mjs (see checks/mod.rs for the split):
//! the pure parts of the kicker / numbered-label / em-dash / repeated-text
//! rules, plus the tag sets and selectors their element adapters (in the
//! `html` crate and the browser bundle) share.

use crate::checks::measures::{Finding, StyleMap};
use crate::color;

use crate::js::{self, ci, parse_float, parse_int, string_to_number, WS};

use crate::js_ext_b::{num_truthy, same_value_zero, utf16_len};
use once_cell::sync::Lazy;
use regex::Regex;

/// The selector lists, thresholds and text parsers these checks share are
/// open; re-exported so `checks::text_rules` stays one path.
pub use impeccable_foundation::rules::text::*;

macro_rules! re {
    ($name:ident, $pat:expr) => {
        static $name: Lazy<Regex> = Lazy::new(|| Regex::new(&$pat).expect(stringify!($name)));
    };
}

/// JS `\d` is ASCII only.
const D: &str = "[0-9]";

/// JS: checks.mjs#KICKER_META_TEXT_RE (`/[·•|]|\s[\/›»>]\s|\b(19|20)\d{2}\b/`).
pub static KICKER_META_TEXT_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(&format!(
        r"[·•|]|{ws}[/›»>]{ws}|(?-u:\b)(19|20){d}{{2}}(?-u:\b)",
        ws = WS,
        d = D
    ))
    .expect("KICKER_META_TEXT_RE")
});

/// JS: checks.mjs#KICKER_DOC_NUMBERING_RE (JS `/i`).
pub static KICKER_DOC_NUMBERING_RE: Lazy<Regex> = Lazy::new(|| {
    let words = [
        "section", "article", "clause", "appendix", "exhibit", "schedule", "chapter", "part",
        "rule", "title",
    ]
    .iter()
    .map(|w| ci(w))
    .collect::<Vec<_>>()
    .join("|");
    let numbers = [
        "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven",
        "twelve",
    ]
    .iter()
    .map(|w| ci(w))
    .collect::<Vec<_>>()
    .join("|");
    Regex::new(&format!(
        r"^(§|{d}+(\.{d}+)+(?-u:\b)|({words}){ws}+([0-9ivxlcIVXLC]+(?-u:\b)|{numbers})(?-u:\b))",
        d = D,
        ws = WS,
        words = words,
        numbers = numbers
    ))
    .expect("KICKER_DOC_NUMBERING_RE")
});

// ─── Group-A helpers duplicated until rules.rs lands ────────────────────────

/// JS: checks.mjs#isCardLikeFromProps.
// TODO(dedupe): use rules::is_card_like_from_props
fn is_card_like_from_props(
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

/// JS: checks.mjs#isAccentColor. Whether a CSS color has visible chroma.
// TODO(dedupe): use rules::is_accent_color
fn is_accent_color(css_color: &str) -> bool {
    re!(
        RGB_STRICT,
        format!(
            r"rgba?\({ws}*({d}+){ws}*,{ws}*({d}+){ws}*,{ws}*({d}+)",
            ws = WS,
            d = D
        )
    );
    re!(HEX_RE, r"^#([0-9a-fA-F]{3,8})(?-u:\b)");
    re!(OKLCH_START, format!(r"^{}\(", ci("oklch")));
    re!(NUM_RE, format!(r"{d}*\.{d}+|{d}+", d = D));
    re!(
        HSL_RE,
        format!(
            r"{hsl}[aA]?\({ws}*[0-9.]+{ws}*,{ws}*([0-9.]+)%",
            hsl = ci("hsl"),
            ws = WS
        )
    );
    if css_color.is_empty() {
        return false;
    }
    let s = js::trim(css_color);
    if let Some(m) = RGB_STRICT.captures(s) {
        let r = string_to_number(&m[1]);
        let g = string_to_number(&m[2]);
        let b = string_to_number(&m[3]);
        return js::math_max3(r, g, b) - js::math_min3(r, g, b) >= 40.0;
    }
    if let Some(m) = HEX_RE.captures(s) {
        let mut h = m[1].to_string();
        if h.len() == 3 || h.len() == 4 {
            let doubled: String = h.chars().flat_map(|c| [c, c]).collect();
            h = doubled.chars().take(6).collect();
        } else {
            h = h.chars().take(6).collect();
        }
        if h.len() == 6 {
            let r = parse_int(&h[0..2], 16);
            let g = parse_int(&h[2..4], 16);
            let b = parse_int(&h[4..6], 16);
            return js::math_max3(r, g, b) - js::math_min3(r, g, b) >= 40.0;
        }
    }
    if OKLCH_START.is_match(s) {
        let nums: Vec<&str> = NUM_RE.find_iter(s).map(|m| m.as_str()).collect();
        if nums.len() >= 2 {
            let c = parse_float(nums[1]);
            return !c.is_nan() && c >= 0.05;
        }
    }
    if let Some(m) = HSL_RE.captures(s) {
        let sat = parse_float(&m[1]);
        return !sat.is_nan() && sat >= 20.0;
    }
    false
}

/// JS: checks.mjs#isKickerCandidate.
pub fn is_kicker_candidate(o: &KickerCandidateInput) -> bool {
    re!(SLASH_PATH_RE, r"^/[0-9A-Za-z_-]+");
    re!(
        STEP_RE,
        format!(r"^{}{ws}*{d}+", ci("step"), ws = WS, d = D)
    );
    re!(TWO_DIGITS_RE, format!(r"^{d}{{1,2}}$", d = D));
    if !num_truthy(o.heading_level) || o.heading_level > 4.0 {
        return false;
    }
    if o.heading_text.is_empty() || utf16_len(o.heading_text) < 3 {
        return false;
    }
    let unquoted = strip_edge_quotes(o.heading_text);
    if SLASH_PATH_RE.is_match(js::trim(&unquoted)) {
        return false;
    }
    if !(o.heading_font_size >= 20.0) {
        return false;
    }
    if o.kicker_tag.is_empty() || HEADING_TAGS.contains(&o.kicker_tag) {
        return false;
    }
    if !["p", "span", "div", "small"].contains(&o.kicker_tag) {
        return false;
    }
    let kicker_len = utf16_len(o.kicker_text);
    if o.kicker_text.is_empty() || kicker_len < 2 || kicker_len > 34 {
        return false;
    }
    if STEP_RE.is_match(o.kicker_text) || TWO_DIGITS_RE.is_match(o.kicker_text) {
        return false;
    }
    if KICKER_META_TEXT_RE.is_match(o.kicker_text) {
        return false;
    }
    if KICKER_DOC_NUMBERING_RE.is_match(o.kicker_text) {
        return false;
    }

    let is_small_caps = o.kicker_font_variant.contains("small-caps");
    let has_upper = o.kicker_text.chars().any(|c| c.is_ascii_uppercase());
    let has_lower = o.kicker_text.chars().any(|c| c.is_ascii_lowercase());
    let is_uppercased =
        o.kicker_text_transform == "uppercase" || (has_upper && !has_lower) || is_small_caps;
    if !is_uppercased {
        return false;
    }
    if !(o.kicker_font_size > 0.0 && o.kicker_font_size <= 14.0) {
        return false;
    }
    let min_tracked_spacing = o.kicker_font_size * 0.06;
    if !(o.kicker_letter_spacing >= min_tracked_spacing) {
        return false;
    }
    true
}

/// JS: checks.mjs#isNumberedSectionLabelCandidate.
pub fn is_numbered_section_label_candidate(o: &NumberedLabelCandidateInput) -> bool {
    re!(MONO_RE, ci("mono"));
    if !["h2", "h3", "h4"].contains(&o.heading_tag) {
        return false;
    }
    if o.heading_text.is_empty() || utf16_len(o.heading_text) < 3 {
        return false;
    }
    if o.label_tag.is_empty() || !NUMBERED_LABEL_TAGS.contains(&o.label_tag) {
        return false;
    }
    if o.label_index.is_none() || o.label_text.is_empty() {
        return false;
    }
    if !(o.label_font_size > 0.0 && o.label_font_size <= 13.0) {
        return false;
    }
    if o.heading_font_size > 0.0 && o.heading_font_size < o.label_font_size * 1.3 {
        return false;
    }
    let weight_n = string_to_number(o.label_font_weight);
    let weight = if num_truthy(weight_n) {
        weight_n
    } else {
        400.0
    };
    let spacing = if num_truthy(o.label_letter_spacing) {
        o.label_letter_spacing
    } else {
        0.0
    };
    MONO_RE.is_match(o.label_font_family)
        || weight >= 600.0
        || spacing >= 0.5
        || o.label_text_transform == "uppercase"
        || is_accent_color(o.label_color)
}

/// JS: checks.mjs#checkNumberedSectionLabels (`min_count` default 2).
pub fn check_numbered_section_labels(
    candidates: &[NumberedLabelCandidate],
    min_count: Option<f64>,
) -> Vec<Finding> {
    let min_count = min_count.unwrap_or(2.0);
    if (candidates.len() as f64) < min_count {
        return vec![];
    }
    let mut distinct: Vec<f64> = Vec::new();
    for c in candidates {
        if !distinct.iter().any(|d| same_value_zero(*d, c.index)) {
            distinct.push(c.index);
        }
    }
    if distinct.len() < 2 {
        return vec![];
    }
    candidates
        .iter()
        .map(|c| {
            Finding::new(
                "numbered-section-labels",
                format!(
                    "tiny numbered label \"{}\" beside {} \"{}\" ({} on page)",
                    c.label_text,
                    c.heading_tag,
                    c.heading_text,
                    candidates.len()
                ),
            )
        })
        .collect()
}

/// JS `/[—]|--(?=\S)/g` match count over `body`.
fn count_em_dashes(body: &str) -> usize {
    let chars: Vec<char> = body.chars().collect();
    let mut count = 0usize;
    let mut i = 0usize;
    while i < chars.len() {
        if chars[i] == '—' {
            count += 1;
            i += 1;
        } else if chars[i] == '-'
            && i + 2 < chars.len()
            && chars[i + 1] == '-'
            && !js::is_js_whitespace(chars[i + 2])
        {
            count += 1;
            i += 2;
        } else {
            i += 1;
        }
    }
    count
}

/// JS: checks.mjs#checkEmDashOveruse. Two gates (absolute floor + density)
/// over already-rendered text. `None` for a non-string input.
pub fn check_em_dash_overuse(text: Option<&str>) -> Vec<Finding> {
    re!(WS_RE, format!("{}+", WS));
    let body: String = match text {
        Some(t) => WS_RE.replace_all(t, " ").into_owned(),
        None => String::new(),
    };
    let count = count_em_dashes(&body);
    if count < EM_DASH_FLOOR {
        return vec![];
    }
    if utf16_len(&body) > count * EM_DASH_CHARS_PER_DASH {
        return vec![];
    }
    vec![Finding::new(
        "em-dash-overuse",
        format!("{} em-dashes in body text", count),
    )]
}

// ─── Repeated container text ────────────────────────────────────────────────

/// JS: checks.mjs#isRepeatedTextContainer. A container worth attributing
/// text to: visibly bounded and surface-like.
pub fn is_repeated_text_container(style: Option<&dyn StyleMap>) -> bool {
    let Some(style) = style else { return false };
    let box_shadow = style.prop("boxShadow");
    let has_shadow = matches!(box_shadow.as_deref(), Some(v) if v != "none" && !v.is_empty());
    let border_sides = ["Top", "Right", "Bottom", "Left"]
        .iter()
        .filter(|side| {
            let w = parse_float(
                &style
                    .prop(&format!("border{}Width", side))
                    .unwrap_or_default(),
            );
            let w = if num_truthy(w) { w } else { 0.0 };
            w >= 1.0
        })
        .count();
    let has_border = border_sides >= 3;
    let radius = parse_float(&style.prop("borderRadius").unwrap_or_default());
    let has_radius = num_truthy(radius) && radius > 0.0;
    let bgc = style.prop("backgroundColor");
    let bg = color::parse_rgb(bgc.as_deref()).or_else(|| color::parse_any_color(bgc.as_deref()));
    let has_bg = matches!(bg, Some(c) if c.alpha_or_one() > 0.1);
    is_card_like_from_props(has_shadow, has_border, has_radius, has_bg)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn style(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    // Expected values below were produced by running the JS functions in Node.

    #[test]
    fn is_accent_color_cases() {
        assert!(!is_accent_color(""));
        assert!(is_accent_color("rgb(180, 83, 9)"));
        assert!(!is_accent_color("rgb(120, 120, 130)"));
        assert!(is_accent_color("#f00"));
        assert!(!is_accent_color("#888"));
        assert!(is_accent_color("#ff000080"));
        assert!(!is_accent_color("#12345"));
        assert!(is_accent_color("oklch(43%.15 34)"));
        assert!(!is_accent_color("oklch(0.5 0.01 200)"));
        assert!(is_accent_color("hsl(200, 50%, 50%)"));
        assert!(!is_accent_color("hsla(200, 10%, 50%, 0.5)"));
        assert!(!is_accent_color("var(--x)"));
    }

    #[test]
    fn strip_edge_quotes_cases() {
        assert_eq!(strip_edge_quotes("\"a\""), "a");
        assert_eq!(strip_edge_quotes("\""), "");
        assert_eq!(strip_edge_quotes("\"\""), "");
        assert_eq!(strip_edge_quotes("a\"b"), "a\"b");
    }

    #[test]
    fn count_em_dashes_cases() {
        assert_eq!(count_em_dashes("a — b — c"), 2);
        assert_eq!(count_em_dashes("a--b"), 1);
        assert_eq!(count_em_dashes("a-- b"), 0);
        assert_eq!(count_em_dashes("----x"), 2);
        assert_eq!(count_em_dashes("---x"), 1);
        assert_eq!(count_em_dashes("--"), 0);
    }

    #[test]
    fn check_em_dash_overuse_non_string() {
        assert!(check_em_dash_overuse(None).is_empty());
    }

    #[test]
    fn is_repeated_text_container_cases() {
        assert!(!is_repeated_text_container(None));
        assert!(is_repeated_text_container(Some(&style(&[
            ("boxShadow", "0 1px 2px rgba(0,0,0,0.2)"),
            ("borderRadius", "8px"),
        ]))));
        assert!(!is_repeated_text_container(Some(&style(&[
            ("boxShadow", "none"),
            ("borderRadius", "8px"),
        ]))));
        assert!(is_repeated_text_container(Some(&style(&[
            ("borderTopWidth", "1px"),
            ("borderRightWidth", "1px"),
            ("borderBottomWidth", "1px"),
            ("backgroundColor", "rgb(255, 255, 255)"),
        ]))));
        assert!(!is_repeated_text_container(Some(&style(&[
            ("borderTopWidth", "1px"),
            ("borderRightWidth", "1px"),
            ("backgroundColor", "rgb(255, 255, 255)"),
        ]))));
        assert!(!is_repeated_text_container(Some(&style(&[
            ("borderTopWidth", "1px"),
            ("borderRightWidth", "1px"),
            ("borderBottomWidth", "1px"),
            ("backgroundColor", "rgba(255, 255, 255, 0.05)"),
        ]))));
    }

    #[test]
    fn kicker_regex_cases() {
        assert!(KICKER_META_TEXT_RE.is_match("News · 2024"));
        assert!(KICKER_META_TEXT_RE.is_match("Docs / Guides"));
        assert!(KICKER_META_TEXT_RE.is_match("Since 1999"));
        assert!(!KICKER_META_TEXT_RE.is_match("Our story"));
        assert!(!KICKER_META_TEXT_RE.is_match("Docs/Guides"));
        assert!(KICKER_DOC_NUMBERING_RE.is_match("Section 4.2"));
        assert!(KICKER_DOC_NUMBERING_RE.is_match("ARTICLE IX"));
        assert!(KICKER_DOC_NUMBERING_RE.is_match("§ 12.3"));
        assert!(KICKER_DOC_NUMBERING_RE.is_match("1.2.3 Scope"));
        assert!(KICKER_DOC_NUMBERING_RE.is_match("Chapter one"));
        assert!(!KICKER_DOC_NUMBERING_RE.is_match("Section"));
        assert!(!KICKER_DOC_NUMBERING_RE.is_match("Partial"));
        assert!(!KICKER_DOC_NUMBERING_RE.is_match("12 Scope"));
        assert!(CURSOR_GLYPH_RE.is_match("▌"));
        assert!(CURSOR_GLYPH_RE.is_match("_"));
        assert!(!CURSOR_GLYPH_RE.is_match("__"));
    }
}
