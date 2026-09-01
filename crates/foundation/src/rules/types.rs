//! The shapes the element rules are written against: the `{ id, snippet }`
//! hit, the per-check option structs the callers fill in, and the small
//! DOM-semantics helpers (heading tags, emoji-only text, shadow-layer
//! parsing) that both the open callers and the detector need. The checks
//! themselves live in the detector.

use crate::color::{named_color, parse_any_color, Rgba};
use crate::js::{self, ci, parse_float};
use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};

macro_rules! re {
    ($name:ident, $pat:expr) => {
        static $name: Lazy<Regex> = Lazy::new(|| Regex::new(&$pat).expect(stringify!($name)));
    };
}

/// JS `\d`.
pub const D: &str = "[0-9]";

/// JS `\w`.
pub const W: &str = "[A-Za-z0-9_]";

/// JS `\b` (ASCII word boundary).
pub const B: &str = r"(?-u:\b)";

/// JS `.` (no line terminators: LF, CR, LS, PS).
pub const DOT: &str = "[^\n\r\\x{2028}\\x{2029}]";

/// JS `[\s\S]`.
pub const ANY: &str = "(?s:.)";

/// A `{ id, snippet }` finding, the shape every Section 3 check returns.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct RuleHit {
    pub id: String,
    pub snippet: String,
}

impl RuleHit {
    pub fn new(id: &str, snippet: String) -> Self {
        RuleHit {
            id: id.to_string(),
            snippet,
        }
    }
}

/// JS `SET.has(v)` over a static list.
pub fn set_has(set: &[&str], v: &str) -> bool {
    set.contains(&v)
}

// ─── checkBorders ───────────────────────────────────────────────────────────

/// The four border sides, JS `widths` / `colors` objects keyed Top / Right /
/// Bottom / Left.
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
pub struct Sides<T> {
    pub top: T,
    pub right: T,
    pub bottom: T,
    pub left: T,
}

impl<T: Copy> Sides<T> {
    /// `[Top, Right, Bottom, Left][i]`, the order the JS side loops in.
    pub fn get(&self, i: usize) -> T {
        match i {
            0 => self.top,
            1 => self.right,
            2 => self.bottom,
            _ => self.left,
        }
    }
}

/// JS `checkBorders` opts.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct BorderOpts {
    pub badge_like: bool,
    pub status_context: bool,
    pub tab_context: bool,
}

// ─── isEmojiOnlyText ────────────────────────────────────────────────────────
const EMOJI_CLASS: &str = r"[\x{1F1E6}-\x{1F1FF}\x{1F300}-\x{1F9FF}\x{1FA00}-\x{1FAFF}\x{2600}-\x{27BF}\x{2300}-\x{23FF}\x{FE0F}\x{200D}\x{1F3FB}-\x{1F3FF}]";

re!(EMOJI_CHAR_RE, EMOJI_CLASS.to_string());

/// JS: checks.mjs#isEmojiOnlyText
pub fn is_emoji_only_text(text: &str) -> bool {
    if text.is_empty() {
        return false;
    }
    if !EMOJI_CHAR_RE.is_match(text) {
        return false;
    }
    let stripped = EMOJI_CHAR_RE.replace_all(text, "");
    js::trim(&stripped).is_empty()
}

// ─── checkColors ────────────────────────────────────────────────────────────

/// JS `checkColors` opts.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ColorOpts {
    pub tag: String,
    pub text_color: Option<Rgba>,
    pub bg_color: Option<Rgba>,
    pub effective_bg: Option<Rgba>,
    pub effective_bg_stops: Option<Vec<Rgba>>,
    pub font_size: f64,
    pub font_weight: f64,
    pub has_direct_text: bool,
    pub is_emoji_only: bool,
    pub bg_clip: Option<String>,
    pub bg_image: Option<String>,
    /// The element's class list, already joined with spaces (JS accepts a
    /// string or a DOMTokenList; `Array.from(list).join(' ')`).
    pub class_list: Option<String>,
    /// JS `DETECTOR_IS_BROWSER` (`typeof window !== 'undefined'`): the
    /// static engines pass false, the browser build true.
    pub detector_is_browser: bool,
}

// ─── checkHoverContrast ─────────────────────────────────────────────────────

/// JS `checkHoverContrast` opts.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct HoverContrastOpts {
    pub tag: String,
    pub text_color: Option<Rgba>,
    pub bg: Option<Rgba>,
    pub own_bg_alpha: Option<f64>,
    pub font_size: f64,
    pub font_weight: f64,
    pub has_direct_text: bool,
    pub is_emoji_only: bool,
}

/// JS `HEADING_TAGS`.
pub const HEADING_TAGS: &[&str] = &["h1", "h2", "h3", "h4", "h5", "h6"];

pub fn is_heading_tag(tag: &str) -> bool {
    set_has(HEADING_TAGS, tag)
}

// ─── checkIconTile ──────────────────────────────────────────────────────────

/// JS `checkIconTile` opts.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct IconTileOpts {
    pub heading_tag: String,
    pub heading_text: Option<String>,
    pub heading_top: f64,
    pub sibling_tag: Option<String>,
    pub sibling_width: f64,
    pub sibling_height: f64,
    pub sibling_bottom: f64,
    pub sibling_bg_color: Option<Rgba>,
    pub sibling_bg_image: Option<String>,
    pub sibling_border_width: f64,
    pub sibling_border_radius: f64,
    pub has_icon_child: bool,
    pub icon_child_width: f64,
}

// ─── resolveSerif / checkItalicSerif ────────────────────────────────────────

/// JS `resolveSerif` result `{ primary, isSerif }`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SerifResolution {
    pub primary: Option<String>,
    pub is_serif: bool,
}

/// JS `checkItalicSerif` opts.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ItalicSerifOpts {
    pub tag: String,
    pub font_style: Option<String>,
    pub font_family: Option<String>,
    pub font_size: f64,
    pub heading_text: Option<String>,
}

// ─── checkHeroEyebrow ───────────────────────────────────────────────────────

/// JS `checkHeroEyebrow` opts.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct HeroEyebrowOpts {
    pub heading_tag: String,
    pub heading_text: Option<String>,
    pub heading_font_size: f64,
    pub heading_in_application_context: bool,
    pub sibling_tag: Option<String>,
    pub sibling_text: Option<String>,
    pub sibling_text_transform: Option<String>,
    pub sibling_font_size: f64,
    pub sibling_letter_spacing: f64,
    /// JS `Number(siblingFontWeight) || 400`; numbers arrive stringified.
    pub sibling_font_weight: Option<String>,
    pub sibling_color: Option<String>,
    pub sibling_has_accent_dash_pseudo: bool,
}

// ─── checkKickerAboveHeading ────────────────────────────────────────────────

/// One kicker candidate as `collectKickerCandidates` produces it.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct KickerCandidate {
    pub heading_tag: String,
    pub heading_text: String,
    pub kicker_text: String,
}

/// JS `checkMotion` opts.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct MotionOpts {
    pub tag: String,
    pub transition_property: Option<String>,
    pub animation_name: Option<String>,
    pub timing_functions: Option<String>,
    pub class_list: Option<String>,
}

// ─── findShadowColor / extractShadowLengths / checkGlow ─────────────────────

/// JS `findShadowColor` result `{ color, start, end }`; `start` / `end` are
/// byte offsets into the layer.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ShadowColor {
    pub color: Option<Rgba>,
    pub start: usize,
    pub end: usize,
}

re!(
    SHADOW_COLOR_FN,
    format!(
        r"(?:{}[aA]?|{}[aA]?|{}|{}|{}|{}|{}|{})\([^)]*\)",
        ci("rgb"),
        ci("hsl"),
        ci("hwb"),
        ci("oklch"),
        ci("oklab"),
        ci("lch"),
        ci("lab"),
        ci("color")
    )
);

re!(SHADOW_HEX, format!(r"#[0-9a-fA-F]{{3,8}}{B}"));

re!(SHADOW_WORD, r"[a-zA-Z][a-zA-Z]*".to_string());

/// JS: checks.mjs#findShadowColor
pub fn find_shadow_color(layer: &str) -> Option<ShadowColor> {
    if let Some(m) = SHADOW_COLOR_FN.find(layer) {
        return Some(ShadowColor {
            color: parse_any_color(Some(m.as_str())),
            start: m.start(),
            end: m.end(),
        });
    }
    if let Some(m) = SHADOW_HEX.find(layer) {
        return Some(ShadowColor {
            color: parse_any_color(Some(m.as_str())),
            start: m.start(),
            end: m.end(),
        });
    }
    for m in SHADOW_WORD.find_iter(layer) {
        // JS-PARITY: `CSS_NAMED_COLORS[word]` is a plain-object lookup, so an
        // inherited name like "constructor" would yield `{ a: 1 }` in JS;
        // no CSS shadow carries such a word, and Rust skips it.
        if let Some(named) = named_color(&js::to_lower_case(m.as_str())) {
            return Some(ShadowColor {
                color: Some(Rgba::new(named.r, named.g, named.b, 1.0)),
                start: m.start(),
                end: m.end(),
            });
        }
    }
    None
}

re!(SHADOW_LEN, format!(r"(-?{D}*\.?{D}+)(px|rem|em)?"));

/// JS: checks.mjs#extractShadowLengths
pub fn extract_shadow_lengths(layer: &str, color_span: Option<(usize, usize)>) -> Vec<f64> {
    let stripped: String = match color_span {
        Some((s, e)) => format!("{} {}", &layer[..s], &layer[e..]),
        None => layer.to_string(),
    };
    let mut vals = Vec::new();
    for m in SHADOW_LEN.captures_iter(&stripped) {
        let mut v = parse_float(&m[1]);
        if matches!(m.get(2).map(|u| u.as_str()), Some("rem") | Some("em")) {
            v *= 16.0;
        }
        vals.push(v);
    }
    vals
}

/// JS `checkGlow` opts.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct GlowOpts {
    pub box_shadow: Option<String>,
    pub text_shadow: Option<String>,
    pub effective_bg: Option<Rgba>,
}
