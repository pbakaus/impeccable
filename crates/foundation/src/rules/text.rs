//! The selector lists, tag lists and thresholds the text rules are written
//! against, the plain-data inputs of the kicker and numbered-label checks,
//! and the two text parsers they share. The candidate gates and the checks
//! themselves live in the detector.

use crate::js::{self, parse_int, WS, WS_CHARS};
use crate::js_ext_b::utf16_len;
use crate::rules::types::D;
use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};

macro_rules! re {
    ($name:ident, $pat:expr) => {
        static $name: Lazy<Regex> = Lazy::new(|| Regex::new(&$pat).expect(stringify!($name)));
    };
}

// ─── Shared constants (selectors, tag sets, regexes) ────────────────────────

/// JS: checks.mjs#HEADING_TAGS.
pub const HEADING_TAGS: &[&str] = &["h1", "h2", "h3", "h4", "h5", "h6"];

/// JS: checks.mjs#KICKER_SKIP_SELECTOR.
pub const KICKER_SKIP_SELECTOR: &str = "nav,form,table,thead,tbody,tfoot,figure,figcaption,ol,ul,li,[role=\"navigation\"],[aria-label*=\"breadcrumb\" i],[class*=\"breadcrumb\" i],[aria-hidden=\"true\"],[data-impeccable-allow-kickers]";

/// JS: checks.mjs#KICKER_CARD_CONTEXT_SELECTOR.
pub const KICKER_CARD_CONTEXT_SELECTOR: &str =
    "article,button,a,li,[role=\"listitem\"],[role=\"option\"]";

/// JS: checks.mjs#NUMBERED_LABEL_TAGS.
pub const NUMBERED_LABEL_TAGS: &[&str] = &["span", "p", "div", "small", "em", "strong", "b"];

/// JS: checks.mjs#REPEATED_TEXT_SKIP_SELECTOR.
pub const REPEATED_TEXT_SKIP_SELECTOR: &str = "table,select,datalist,nav,menu,[role=\"navigation\"],[role=\"menu\"],[role=\"menubar\"],[role=\"listbox\"],[role=\"grid\"],[role=\"tablist\"],[role=\"radiogroup\"],[aria-hidden=\"true\"]";

/// JS: checks.mjs#REPEATED_TEXT_CONTAINER_TAGS.
pub const REPEATED_TEXT_CONTAINER_TAGS: &[&str] = &[
    "div", "section", "article", "aside", "main", "figure", "form", "fieldset", "details", "li",
];

/// JS: checks.mjs#QUALITY_TEXT_TAGS.
pub const QUALITY_TEXT_TAGS: &[&str] = &["p", "li", "td", "th", "dd", "blockquote", "figcaption"];

/// JS: checks.mjs#TEXT_EDGE_TAGS (upper-case tag names, as the JS set).
pub const TEXT_EDGE_TAGS: &[&str] = &[
    "A",
    "BUTTON",
    "CODE",
    "DD",
    "DT",
    "FIGCAPTION",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "LI",
    "P",
    "PRE",
    "SPAN",
    "TD",
    "TH",
];

/// JS: checks.mjs#SR_ONLY_SELECTOR.
pub const SR_ONLY_SELECTOR: &str = ".sr-only, .visually-hidden, .visuallyhidden, .screen-reader, .screen-reader-only, .screenreader, .a11y-hidden, .hidden-visually, [class*=\"sr-only\" i], [class*=\"visually-hidden\" i], [class*=\"visuallyhidden\" i], [class*=\"screen-reader\" i], [class*=\"screenreader\" i]";

/// JS: checks.mjs#NON_RENDERED_TAGS.
pub const NON_RENDERED_TAGS: &[&str] = &[
    "script", "style", "title", "noscript", "template", "head", "meta", "link", "base", "param",
    "source", "track", "datalist", "col", "colgroup", "map", "area",
];

/// JS: checks.mjs#TEXT_OVERFLOW_SKIP_TAGS.
pub const TEXT_OVERFLOW_SKIP_TAGS: &[&str] = &[
    "pre", "code", "textarea", "svg", "canvas", "select", "option", "marquee",
];

/// JS: checks.mjs#CURSOR_GLYPH_RE (`/^[_|▀-▟■▮❙❚｜]$/`).
pub static CURSOR_GLYPH_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^[_|▀-▟■▮❙❚｜]$").expect("CURSOR_GLYPH_RE"));

/// JS: checks.mjs#CURSOR_FIRST_VIEWPORT_PX.
pub const CURSOR_FIRST_VIEWPORT_PX: f64 = 1200.0;

/// JS: checks.mjs#HIDDEN_TEXT_EXCLUDE_TAGS.
pub const HIDDEN_TEXT_EXCLUDE_TAGS: &[&str] = &[
    "script", "style", "noscript", "template", "title", "head", "meta", "link", "option",
    "optgroup", "select", "datalist", "dialog",
];

/// JS: checks.mjs#OCCLUSION_TEXT_SKIP_TAGS.
pub const OCCLUSION_TEXT_SKIP_TAGS: &[&str] = &["script", "style", "noscript", "template", "title"];

/// JS: checks.mjs#POSITIONED_CHILD_INTERACTIVE_SELECTOR.
pub const POSITIONED_CHILD_INTERACTIVE_SELECTOR: &str = "a[href],button,input,select,summary,textarea,[tabindex]:not([tabindex=\"-1\"]),[role=\"button\"],[role=\"dialog\"],[role=\"link\"],[role=\"listbox\"],[role=\"menu\"],[role=\"menuitem\"],[role=\"option\"],[role=\"tooltip\"]";

// ─── Kicker above heading ───────────────────────────────────────────────────

/// Input of `isKickerCandidate`. Numbers are JS numbers: pass NaN where the
/// JS caller would pass `undefined`; strings are `''` where JS would pass
/// `undefined` / `''` (both are falsy there).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct KickerCandidateInput<'a> {
    pub heading_level: f64,
    #[serde(borrow)]
    pub heading_text: &'a str,
    pub heading_font_size: f64,
    #[serde(borrow)]
    pub kicker_tag: &'a str,
    #[serde(borrow)]
    pub kicker_text: &'a str,
    #[serde(borrow)]
    pub kicker_text_transform: &'a str,
    #[serde(borrow)]
    pub kicker_font_variant: &'a str,
    pub kicker_font_size: f64,
    pub kicker_letter_spacing: f64,
}

/// JS `text.replace(/^"|"$/g, '')`: one leading and one trailing quote.
pub fn strip_edge_quotes(text: &str) -> String {
    let s = text.strip_prefix('"').unwrap_or(text);
    let s = s.strip_suffix('"').unwrap_or(s);
    s.to_string()
}

// ─── Numbered section labels ────────────────────────────────────────────────

/// `{ index, text }` from `parseNumberedLabelText`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NumberedLabel {
    pub index: f64,
    pub text: String,
}

/// JS: checks.mjs#parseNumberedLabelText. A zero-padded / two-digit bare
/// index, or a 1-2 digit index, a non-word separator, and a short label.
pub fn parse_numbered_label_text(raw_text: Option<&str>) -> Option<NumberedLabel> {
    re!(WS_RE, format!("{}+", WS));
    re!(TWO_DIGIT_RE, format!(r"^({d}{{2}})$", d = D));
    re!(
        SEP_RE,
        format!(
            r"^({d}{{1,2}}){ws}*[^0-9A-Za-z_{wsc}]{ws}*[^{wsc}]",
            d = D,
            ws = WS,
            wsc = WS_CHARS
        )
    );
    let collapsed = WS_RE.replace_all(raw_text.unwrap_or(""), " ");
    let text = js::trim(&collapsed);
    if text.is_empty() || utf16_len(text) > 40 {
        return None;
    }
    let m = TWO_DIGIT_RE
        .captures(text)
        .or_else(|| SEP_RE.captures(text))?;
    let index = parse_int(&m[1], 10);
    if !index.is_finite() || index > 40.0 {
        return None;
    }
    Some(NumberedLabel {
        index,
        text: text.to_string(),
    })
}

/// Input of `isNumberedSectionLabelCandidate`. Numbers are JS numbers (NaN
/// for `undefined`); `label_index` `None` for JS `null` / `undefined`;
/// `label_font_weight` is the raw style string (`Number(x) || 400`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NumberedLabelCandidateInput<'a> {
    #[serde(borrow)]
    pub heading_tag: &'a str,
    #[serde(borrow)]
    pub heading_text: &'a str,
    pub heading_font_size: f64,
    #[serde(borrow)]
    pub label_tag: &'a str,
    pub label_index: Option<f64>,
    #[serde(borrow)]
    pub label_text: &'a str,
    pub label_font_size: f64,
    pub label_letter_spacing: f64,
    #[serde(borrow)]
    pub label_font_weight: &'a str,
    #[serde(borrow)]
    pub label_font_family: &'a str,
    #[serde(borrow)]
    pub label_text_transform: &'a str,
    #[serde(borrow)]
    pub label_color: &'a str,
}

/// One `collectNumberedSectionLabelCandidates` entry.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NumberedLabelCandidate {
    pub index: f64,
    pub label_text: String,
    pub heading_tag: String,
    pub heading_text: String,
}

// ─── Em-dash overuse ────────────────────────────────────────────────────────

/// JS: constants.mjs#EM_DASH_FLOOR.
pub const EM_DASH_FLOOR: usize = 8;

/// JS: constants.mjs#EM_DASH_CHARS_PER_DASH.
pub const EM_DASH_CHARS_PER_DASH: usize = 500;
