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

/// The year clause of [`KICKER_META_TEXT_RE`]: a four-digit year from 1900 to
/// 2099 standing as its own word, which marks a dated meta line ("Sep 2,
/// 2026", "Engineering / 2 September 2026").
pub static KICKER_META_YEAR_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(&format!(r"(?-u:\b)(19|20){d}{{2}}(?-u:\b)", d = D)).expect("KICKER_META_YEAR_RE")
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
    if !(o.kicker_font_size > 0.0
        && o.kicker_font_size <= label_size_ceiling(o.heading_font_size, KICKER_BASE_MAX_PX))
    {
        return false;
    }
    let min_tracked_spacing = o.kicker_font_size * 0.06;
    if !(o.kicker_letter_spacing >= min_tracked_spacing) {
        return false;
    }
    true
}

/// The size a kicker was always allowed, whatever the heading.
pub const KICKER_BASE_MAX_PX: f64 = 14.0;
/// The size a numbered label was always allowed, whatever the heading.
pub const NUMBERED_LABEL_BASE_MAX_PX: f64 = 13.0;
/// A label reads as a label beside a heading at most this share of the
/// heading's size: a 15px eyebrow over a 44px h2 is as small, relative to it,
/// as a 12px one over a 32px h2.
pub const LABEL_HEADING_SIZE_RATIO: f64 = 0.45;
/// The absolute cap on a label's size, whatever the heading: past it the text
/// is a subheading.
pub const LABEL_MAX_PX: f64 = 16.0;

/// The largest size a label beside a heading of `heading_font_size` may be:
/// the old fixed ceiling `base`, raised to [`LABEL_HEADING_SIZE_RATIO`] of the
/// heading where that is larger, and never past [`LABEL_MAX_PX`].
pub fn label_size_ceiling(heading_font_size: f64, base: f64) -> f64 {
    let relative = if heading_font_size.is_finite() && heading_font_size > 0.0 {
        heading_font_size * LABEL_HEADING_SIZE_RATIO
    } else {
        0.0
    };
    base.max(relative.min(LABEL_MAX_PX))
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
    if !(o.label_font_size > 0.0
        && o.label_font_size <= label_size_ceiling(o.heading_font_size, NUMBERED_LABEL_BASE_MAX_PX))
    {
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

// ─── Letter spacing ─────────────────────────────────────────────────────────

/// Size at which type is read as display rather than as reading copy.
pub const DISPLAY_FONT_SIZE_PX: f64 = 40.0;
/// Tracking (letter-spacing over font-size) past which reading copy starts
/// losing its letterforms.
pub const CRUSHED_TRACKING_EM: f64 = -0.07;
/// Display type conventionally tightens further, and several display faces
/// ship values in the -0.05em range in their own tracking tables, so it takes
/// more before the letterforms are actually damaged.
pub const CRUSHED_TRACKING_EM_DISPLAY: f64 = -0.09;

/// The `extreme-negative-tracking` gate: how tight is too tight at this size.
pub fn tracking_is_crushed(tracking_em: f64, font_size_px: f64) -> bool {
    let limit = if font_size_px >= DISPLAY_FONT_SIZE_PX {
        CRUSHED_TRACKING_EM_DISPLAY
    } else {
        CRUSHED_TRACKING_EM
    };
    tracking_em < limit
}

/// How many leading characters the script test reads. Tracking is one authored
/// value for the whole element, so a prefix settles which script it is set in
/// and the test stays cheap on long text.
const SCRIPT_SAMPLE_CHARS: usize = 256;

fn is_cjk_char(c: char) -> bool {
    matches!(
        c as u32,
        0x1100..=0x11FF        // Hangul Jamo
        | 0x3040..=0x30FF      // Hiragana and Katakana
        | 0x3130..=0x318F      // Hangul compatibility Jamo
        | 0x31F0..=0x31FF      // Katakana phonetic extensions
        | 0x3400..=0x4DBF      // CJK unified ideographs extension A
        | 0x4E00..=0x9FFF      // CJK unified ideographs
        | 0xA960..=0xA97F      // Hangul Jamo extended-A
        | 0xAC00..=0xD7FF      // Hangul syllables and Jamo extended-B
        | 0xF900..=0xFAFF      // CJK compatibility ideographs
        | 0xFF66..=0xFF9F      // halfwidth Katakana
        | 0x20000..=0x3FFFF // CJK extensions B and later
    )
}

/// True when the text is written mostly in Han, Hiragana, Katakana or Hangul.
/// Letter-spacing on those scripts trims the gap between full-width glyphs
/// instead of pulling letterforms into each other, so the Latin tracking
/// thresholds do not describe them. Read from the text itself: a `lang`
/// attribute says what the page is, not what this element renders.
pub fn is_cjk_text(text: &str) -> bool {
    let mut cjk = 0usize;
    let mut scripted = 0usize;
    for c in text.chars().take(SCRIPT_SAMPLE_CHARS) {
        if is_cjk_char(c) {
            cjk += 1;
            scripted += 1;
        } else if c.is_alphabetic() {
            scripted += 1;
        }
    }
    cjk > 0 && cjk * 2 >= scripted
}

/// A glyph set a full em wide: Han, kana and Hangul, the CJK symbols and
/// punctuation block, and the fullwidth forms. Halfwidth katakana is half.
fn is_full_width_char(c: char) -> bool {
    matches!(c as u32, 0x3000..=0x303F | 0xFF01..=0xFF60 | 0xFFE0..=0xFFE6)
        || (is_cjk_char(c) && !matches!(c as u32, 0xFF66..=0xFF9F))
}

/// The average advance of a proportional face's Latin glyphs in ems, the
/// estimate's old constant.
pub const PROPORTIONAL_ADVANCE_EM: f64 = 0.5;

/// The advance of a monospace face's glyphs in ems: 600 units to the em in
/// JetBrains Mono, Courier, Menlo and SF Mono.
pub const MONOSPACE_ADVANCE_EM: f64 = 0.6;

/// The average advance of `text`'s characters in ems, for estimating how many
/// fit on a line: half an em for Latin and the scripts set like it, a whole em
/// for full-width CJK glyphs, weighted by how many of each the text holds.
/// Text with no full-width glyph is exactly 0.5, the estimate's old constant.
pub fn average_glyph_advance_em(text: &str) -> f64 {
    average_glyph_advance_em_at(text, PROPORTIONAL_ADVANCE_EM)
}

/// [`average_glyph_advance_em`] with the advance of the text's Latin glyphs
/// given: [`MONOSPACE_ADVANCE_EM`] for a monospace face. Full-width glyphs
/// are a whole em in either.
pub fn average_glyph_advance_em_at(text: &str, latin_em: f64) -> f64 {
    let mut total = 0usize;
    let mut wide = 0usize;
    for c in text.chars() {
        total += 1;
        if is_full_width_char(c) {
            wide += 1;
        }
    }
    if wide == 0 {
        return latin_em;
    }
    (latin_em * (total - wide) as f64 + wide as f64) / total as f64
}

/// Faces set on a fixed advance whose names hold no `mono` word.
const MONOSPACE_FACES: &[&str] = &[
    "andale mono",
    "cascadia code",
    "consolas",
    "courier",
    "courier new",
    "fira code",
    "hack",
    "inconsolata",
    "lucida console",
    "menlo",
    "monaco",
    "source code pro",
];

/// A class token that carries a generated id: one of its `-` or `_`
/// separated parts is four or more hex digits with at least one decimal digit
/// among them (`43268`, `a565c83`, `67254963955209192`). `grid-col-desk-2`,
/// `elementor-col-50` and `text-gray-500` carry none.
pub fn is_id_like_class(token: &str) -> bool {
    token.split(['-', '_']).any(|part| {
        part.len() >= 4
            && part.bytes().all(|b| b.is_ascii_hexdigit())
            && part.bytes().any(|b| b.is_ascii_digit())
    })
}

/// Whether a short run reads as source code rather than as a label: it holds
/// a character that structured text is written with and a label is not, one
/// of `{ } [ ] < > = ; " \` \ _`. A JSON line (`"id": 7,`, `},`), a tag, an
/// assignment and a snake_case name all do; a price (`$50/seat`), a count
/// (`200+`), a rating (`4.9`) and a copyright line do not. Builders set
/// monospace labels with their whitespace kept (Framer keeps it on every text
/// box), so the face and `white-space` alone cannot tell a code sample from a
/// pricing label.
pub fn reads_as_code(text: &str) -> bool {
    text.chars()
        .any(|c| matches!(c, '{' | '}' | '[' | ']' | '<' | '>' | '=' | ';' | '"' | '`' | '\\' | '_'))
}

/// Whether a computed `font-family` leads with a monospace face: a generic
/// `monospace` or `ui-monospace`, a name with a `mono` word in it
/// (`JetBrains Mono`, `SFMono-Regular`, `Roboto Mono`), or a known code face.
/// Only the first family is read; a display face such as `Monotype Corsiva`
/// holds no `mono` word.
pub fn is_monospace_family(font_family: &str) -> bool {
    let first = font_family
        .split(',')
        .next()
        .unwrap_or("")
        .trim()
        .trim_matches(|c| c == '"' || c == '\'')
        .to_ascii_lowercase();
    MONOSPACE_FACES.contains(&first.as_str())
        || first
            .split(|c: char| !c.is_ascii_alphanumeric())
            .any(|w| matches!(w, "mono" | "monospace" | "monospaced" | "sfmono"))
}

/// How many em dashes `body` sets: each `—`, each `--` written in its place
/// (two hyphens and no more, followed by a non-space), and each `---` set
/// between two letters or digits (the LaTeX and SmartyPants spelling). Any
/// other longer run of hyphens is a rule, not a dash: terminal output and
/// ASCII tables in a `<pre>` draw `----- Global (CDN) -----` (vps.dance's 139 of 140 "em
/// dashes"), and a JS-era count that consumed the run two at a time read
/// `----x` as two dashes.
pub fn count_em_dashes(body: &str) -> usize {
    let chars: Vec<char> = body.chars().collect();
    let mut count = 0usize;
    let mut i = 0usize;
    while i < chars.len() {
        if chars[i] == '—' {
            count += 1;
            i += 1;
        } else if chars[i] == '-' {
            let start = i;
            while i < chars.len() && chars[i] == '-' {
                i += 1;
            }
            let run = i - start;
            let next = chars.get(i).copied();
            if run == 2 && next.is_some_and(|c| !js::is_js_whitespace(c)) {
                count += 1;
            } else if run == 3
                && start > 0
                && chars[start - 1].is_alphanumeric()
                && next.is_some_and(char::is_alphanumeric)
            {
                // `word---word` is the em dash of LaTeX and SmartyPants
                // left unconverted; a table rule `|---|` is not.
                count += 1;
            }
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

    #[test]
    fn reads_as_code_wants_a_character_code_is_written_with() {
        for code in ["\"data\":", "\"id\": 7,", "},", "{", "<div>", "const x = 1", "published_date", "`npm i`", "a\\b", "items[0]", "run();"] {
            assert!(reads_as_code(code), "{code}");
        }
        for label in ["$50/seat", "per Month", "200+", "4.9", "© 2026 VexoAI, Inc.", "Type II", "G2", "v2.0-beta", "don't", "(optional)", "50% off: today", "A / B"] {
            assert!(!reads_as_code(label), "{label}");
        }
    }

    use std::collections::HashMap;

    #[test]
    fn label_ceilings_follow_the_heading_up_to_a_cap() {
        assert_eq!(label_size_ceiling(32.0, KICKER_BASE_MAX_PX), 14.4);
        assert_eq!(label_size_ceiling(24.0, KICKER_BASE_MAX_PX), 14.0);
        assert_eq!(label_size_ceiling(44.0, KICKER_BASE_MAX_PX), 16.0);
        assert_eq!(label_size_ceiling(0.0, NUMBERED_LABEL_BASE_MAX_PX), 13.0);
        assert_eq!(label_size_ceiling(f64::NAN, NUMBERED_LABEL_BASE_MAX_PX), 13.0);
    }

    /// opentrailpaper.com: 15.04px tracked kickers above 44px h2s.
    #[test]
    fn a_fifteen_pixel_kicker_counts_above_a_display_heading() {
        let input = |heading: f64, kicker: f64| KickerCandidateInput {
            heading_level: 2.0,
            heading_text: "Device walkthrough",
            heading_font_size: heading,
            kicker_tag: "p",
            kicker_text: "01 — Device controls",
            kicker_text_transform: "uppercase",
            kicker_font_variant: "normal normal",
            kicker_font_size: kicker,
            kicker_letter_spacing: kicker * 0.2,
        };
        assert!(is_kicker_candidate(&input(44.0, 15.04)));
        assert!(!is_kicker_candidate(&input(24.0, 15.04)));
        assert!(!is_kicker_candidate(&input(64.0, 17.0)));
        assert!(is_kicker_candidate(&input(20.0, 14.0)));
    }

    /// v0-optimus-delta.vercel.app: 14px mono "01" beside 36px h3s.
    #[test]
    fn a_numbered_label_ceiling_follows_the_heading() {
        let input = |heading: f64, label: f64| NumberedLabelCandidateInput {
            heading_tag: "h3",
            heading_text: "Instant Deployment",
            heading_font_size: heading,
            label_tag: "div",
            label_index: Some(1.0),
            label_text: "01",
            label_font_size: label,
            label_letter_spacing: 0.0,
            label_font_weight: "400",
            label_font_family: "\"JetBrains Mono\", monospace",
            label_text_transform: "none",
            label_color: "rgb(113, 113, 122)",
        };
        assert!(is_numbered_section_label_candidate(&input(36.0, 14.0)));
        assert!(!is_numbered_section_label_candidate(&input(24.0, 14.0)));
        assert!(is_numbered_section_label_candidate(&input(24.0, 13.0)));
    }

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
        // A run longer than two is a rule, not a dash.
        assert_eq!(count_em_dashes("----x"), 0);
        assert_eq!(count_em_dashes("---x"), 0);
        assert_eq!(count_em_dashes("word---word"), 1);
        assert_eq!(count_em_dashes("|---|---|"), 0);
        assert_eq!(count_em_dashes("word----word"), 0);
        assert_eq!(count_em_dashes("----- Global (CDN) -----"), 0);
        assert_eq!(count_em_dashes("a--b ---- c--d"), 2);
        assert_eq!(count_em_dashes("--"), 0);
        assert_eq!(count_em_dashes("--x"), 1);
    }

    #[test]
    fn tracking_is_crushed_cases() {
        // Reading sizes: Tailwind's tracking-tighter and vendor display tables pass.
        assert!(!tracking_is_crushed(-0.05, 16.0));
        assert!(!tracking_is_crushed(-0.06, 16.0));
        assert!(tracking_is_crushed(-0.08, 16.0));
        // Display sizes take the looser line.
        assert!(!tracking_is_crushed(-0.08, 40.0));
        assert!(!tracking_is_crushed(-0.08, 104.8));
        assert!(tracking_is_crushed(-0.1, 40.0));
        // Just under display size the reading-copy line still applies.
        assert!(tracking_is_crushed(-0.08, 39.0));
    }

    #[test]
    fn is_cjk_text_cases() {
        assert!(is_cjk_text("赓续长征精神 奋进复兴征程|福建守护"));
        assert!(is_cjk_text("この段落は日本語の文字組みです"));
        assert!(is_cjk_text("한국어 문장은 자간을 줄여도 글자 모양이 남습니다"));
        assert!(!is_cjk_text("The APIs powering your next feature"));
        assert!(!is_cjk_text(""));
        assert!(!is_cjk_text("משרד ההגנה של דרום קוריאה מסר"));
        // A lone ideograph in a Latin line is not CJK typesetting.
        assert!(!is_cjk_text("Download the 中 glyph sample sheet today"));
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
    fn monospace_faces_advance_six_tenths_of_an_em() {
        for family in [
            "\"JetBrains Mono\", \"JetBrains Mono Fallback\", ui-monospace, monospace",
            "ui-monospace, SFMono-Regular, Menlo, monospace",
            "SFMono-Regular, Consolas, monospace",
            "monospace",
            "'Courier New', Courier, monospace",
            "Menlo",
            "\"Roboto Mono\", sans-serif",
        ] {
            assert!(is_monospace_family(family), "{family}");
        }
        for family in ["\"Monotype Corsiva\", cursive", "Inter, monospace", "system-ui, sans-serif", ""] {
            assert!(!is_monospace_family(family), "{family}");
        }
        assert_eq!(average_glyph_advance_em("plain latin text"), 0.5);
        assert_eq!(average_glyph_advance_em_at("plain latin text", MONOSPACE_ADVANCE_EM), 0.6);
        // A full-width glyph is an em in either face: one of four.
        assert!((average_glyph_advance_em_at("ab c漢", 0.6) - (0.6 * 4.0 + 1.0) / 5.0).abs() < 1e-12);
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
