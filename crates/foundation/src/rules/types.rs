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
    /// A per-finding severity that overrides the rule's registry severity,
    /// such as `advisory` on a contrast ratio just under its bar. `None`
    /// keeps the registry's. The engines carry it onto the finding they
    /// print, and the finding's `advisory` flag is derived from it. The
    /// recorded call vectors predate the field and compare `{ id, snippet }`
    /// only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub severity: Option<String>,
}

impl RuleHit {
    pub fn new(id: &str, snippet: String) -> Self {
        RuleHit {
            id: id.to_string(),
            snippet,
            severity: None,
        }
    }

    /// Whether this hit's own severity is `advisory`.
    pub fn is_advisory(&self) -> bool {
        self.severity.as_deref() == Some("advisory")
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

/// The four corner radii in px, in the order the `border-radius` shorthand
/// lists them.
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
pub struct Corners {
    pub top_left: f64,
    pub top_right: f64,
    pub bottom_right: f64,
    pub bottom_left: f64,
}

impl Corners {
    /// The two corners at the far end of the side at `[Top, Right, Bottom,
    /// Left][i]`: the pair a stripe on that side does not touch.
    pub fn away_from(&self, i: usize) -> (f64, f64) {
        match i {
            0 => (self.bottom_left, self.bottom_right),
            1 => (self.top_left, self.bottom_left),
            2 => (self.top_left, self.top_right),
            _ => (self.top_right, self.bottom_right),
        }
    }
}

/// JS `checkBorders` opts.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct BorderOpts {
    pub badge_like: bool,
    pub status_context: bool,
    pub tab_context: bool,
    /// The element's four corner radii, when the caller could read them.
    /// `None` means unknown, not square: a radius the engine cannot resolve
    /// (a `calc()`, a snapshot missing the column) leaves a side accent
    /// reported. The recorded call vectors predate the corner read and leave
    /// this `None`, which replays the behavior they pin.
    pub corners: Option<Corners>,
    /// The element's border-box `[width, height]`, when the caller could
    /// read it. `None` (the recorded call vectors, a static element with no
    /// resolved size) skips the circle test.
    #[serde(default)]
    pub box_size: Option<[f64; 2]>,
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

/// Text with no letter and no digit anywhere: an icon font's private-use
/// glyph, an arrow, a bullet, a breadcrumb separator, a bare multiplication
/// sign standing in for a close control. None of it is read, so WCAG text
/// contrast is the wrong rule for it.
pub fn is_glyph_only_text(text: &str) -> bool {
    let trimmed = js::trim(text);
    !trimmed.is_empty() && !trimmed.chars().any(char::is_alphanumeric)
}

/// Families that draw icons rather than letters. Material Icons and Material
/// Symbols turn a word into a glyph through a ligature (`arrow_forward`
/// renders as an arrow); the others map private-use code points, which
/// [`is_glyph_only_text`] already reads as glyphs.
const ICON_FONT_NAMES: &[&str] = &[
    "material icons",
    "material symbols",
    "materialicons",
    "materialsymbols",
    "material design icons",
    "font awesome",
    "fontawesome",
    "icomoon",
    "glyphicons",
    "bootstrap-icons",
    "remixicon",
    "ionicons",
    "tabler-icons",
    "boxicons",
    "codicon",
    "octicons",
    "dashicons",
    "lineicons",
    "themify",
];

/// Whether the first family of a `font-family` list is an icon font: one of
/// [`ICON_FONT_NAMES`], or a name one of whose words is `icons` or `icon`.
pub fn is_icon_font_family(font_family: &str) -> bool {
    let first = font_family.split(',').next().unwrap_or("");
    let name = js::to_lower_case(js::trim(first).trim_matches(|c| c == '"' || c == '\''));
    if name.is_empty() {
        return false;
    }
    ICON_FONT_NAMES.iter().any(|n| name.contains(n))
        || name
            .split(|c: char| !c.is_ascii_alphanumeric())
            .any(|w| w == "icons" || w == "icon")
}

/// Text an icon font turns into a glyph through a ligature: one word of
/// lowercase letters, digits, `_` or `-` (`arrow_forward`, `close`,
/// `counter_1`) set in an icon font. A reader sees an icon, not the word.
pub fn is_icon_ligature_text(text: &str, font_family: &str) -> bool {
    let word = js::trim(text);
    !word.is_empty()
        && word.len() <= 48
        && word.chars().any(|c| c.is_ascii_lowercase())
        && word
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-')
        && is_icon_font_family(font_family)
}

/// A Latin `x` standing in for a close glyph, where [`names_close_control`]
/// says the control it sits in closes something.
pub fn is_close_letter_text(text: &str) -> bool {
    matches!(js::trim(text), "x" | "X")
}

/// Whether attribute values (a class list, an id, an `aria-label`, a
/// `title`) name a close or dismiss control.
pub fn names_close_control(values: &[&str]) -> bool {
    values.iter().any(|v| {
        let lower = js::to_lower_case(v);
        lower.contains("close") || lower.contains("dismiss")
    })
}

/// Whether a computed `-webkit-text-fill-color` says the element's glyphs
/// are not painted in its `color` at all. A gradient heading is written by
/// clipping a background to the text and filling the text with nothing, so
/// what a reader sees is the gradient and `color` is a value that renders
/// nowhere. Scoring a colour nobody can see is how a legible heading gets
/// reported at 1.1:1 against the gradient's own first stop.
///
/// An empty value is not an answer. The static cascade carries only the
/// properties an author declared, so absence means unset, which is the
/// initial `currentcolor` and not transparent.
pub fn text_fill_is_transparent(value: &str) -> bool {
    !js::trim(value).is_empty() && crate::css::measures::css_color_is_transparent(Some(value))
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
    /// The element's own text has no letter and no digit
    /// ([`is_glyph_only_text`]): a lone circle, a pair of braces, an arrow.
    /// Nobody reads it, so it is not scored for text contrast on any path,
    /// SAFE_TAGS or not. The recorded call vectors predate the field and
    /// leave it false, which scores as they recorded.
    #[serde(default)]
    pub is_glyph_only: bool,
    /// The adapter's verdict that this element paints reading text of its
    /// own that no already-scored ancestor carries: direct text that is not
    /// an icon glyph, not visually hidden, and a `color` the nearest
    /// text-bearing ancestor does not share. `check_colors` scores the
    /// contrast of a SAFE_TAGS element on this alone; every other tag is
    /// scored regardless. The recorded call vectors predate the field and
    /// leave it false, which is the tag gate on its own.
    pub paints_own_text: bool,
    pub bg_clip: Option<String>,
    pub bg_image: Option<String>,
    /// The element's class list, already joined with spaces (JS accepts a
    /// string or a DOMTokenList; `Array.from(list).join(' ')`).
    pub class_list: Option<String>,
    /// JS `DETECTOR_IS_BROWSER` (`typeof window !== 'undefined'`): the
    /// static engines pass false, the browser build true.
    pub detector_is_browser: bool,
    /// The colour the glyphs read in over `effective_bg` (or each gradient
    /// sample), when the adapter folded the opacity of the boxes between the
    /// text and its surface into it. `None` scores `text_color`. Either way a
    /// translucent colour is composited over each background before it is
    /// scored and printed. The recorded call vectors predate the field.
    #[serde(default)]
    pub visible_text: Option<Rgba>,
    /// What painted the surface when it was not a plain fill, printed after
    /// the background colour (`gradient on a.primary`). One page reports a
    /// text colour once per box that paints the gradient, not once per
    /// sampled colour.
    #[serde(default)]
    pub bg_source: Option<String>,
    /// An opaque identity of the box `bg_source` names, unique within one
    /// document. The page's one report of a text colour on a gradient is
    /// claimed per box, because the label is only a tag and a class, which a
    /// row of same-class tiles on different gradients shares. `None` dedupes
    /// on the snippet alone.
    #[serde(default)]
    pub bg_source_host: Option<String>,
    /// The adapter's knowledge that its background walk reads only ancestor
    /// fills, so a resolved surface in exactly the text's own colour is the
    /// walk landing on a fill the text does not sit on (white copy over a
    /// photo scored `#ffffff on #ffffff`). With it set the full pass stands
    /// down there, as the SAFE_TAGS path always has. The recorded call
    /// vectors predate the field and leave it false, which scores the `1.0:1`
    /// as they recorded.
    #[serde(default)]
    pub same_color_surface_is_unread: bool,
    /// The adapter's knowledge that the glyphs paint no colour of their own:
    /// a transparent text fill (`-webkit-text-fill-color`), or an ancestor
    /// whose background is clipped to the text, which paints them instead
    /// (resend.com's `em` inside a gradient-clipped `h1`). `color` is not
    /// what a reader sees, so no contrast verdict is taken on it, on any
    /// path. The recorded call vectors predate the field and leave it false.
    #[serde(default)]
    pub ink_unread: bool,
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
    /// The anchor is a card title set on a non-heading tag (shadcn's
    /// `CardTitle` is a `div.font-semibold`), which the engines recognize
    /// from its type. `false` keeps the h1 to h6 anchor alone, the JS
    /// contract the recorded vectors pin.
    #[serde(default)]
    pub heading_is_card_title: bool,
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
    /// The tracking, in em of the sibling's size, that counts as tracked caps
    /// alongside the fixed 1.6px floor ([`HERO_EYEBROW_TRACKING_PX`]). The
    /// engines pass [`HERO_EYEBROW_TRACKING_EM`]; `None` keeps the fixed floor
    /// alone, which is the JS contract the recorded vectors pin.
    #[serde(default)]
    pub sibling_tracking_floor_em: Option<f64>,
    /// Whether the sibling is, or holds, a `<time>` element. A dated line
    /// above a post's h1 is the post's meta, not an eyebrow; the em floor
    /// alone does not make it tracked caps. `false` is the JS contract.
    #[serde(default)]
    pub sibling_holds_time: bool,
}

/// The fixed tracking floor of the hero eyebrow's tracked-caps signature.
pub const HERO_EYEBROW_TRACKING_PX: f64 = 1.6;

/// The tracking, in em, at which an uppercase label reads as tracked caps
/// whatever its size: Tailwind's `tracking-widest` (0.1em) at 12px is 1.2px,
/// under the fixed floor, and it is the most common eyebrow setting
/// (redoubt.agency). kicker-above-heading's own floor is 0.06em.
pub const HERO_EYEBROW_TRACKING_EM: f64 = 0.08;

/// Whether `letter_spacing_px` at `font_size_px` is tracked caps for the hero
/// eyebrow: at least the fixed floor, or, where the engine passes one, at
/// least `floor_em` of the size.
pub fn hero_eyebrow_tracked(letter_spacing_px: f64, font_size_px: f64, floor_em: Option<f64>) -> bool {
    if letter_spacing_px >= HERO_EYEBROW_TRACKING_PX {
        return true;
    }
    match floor_em {
        Some(em) if font_size_px > 0.0 => letter_spacing_px > 0.0 && letter_spacing_px >= font_size_px * em - 1e-9,
        _ => false,
    }
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
///
/// `element_opacity` and `element_size` feed the perceptibility floor. Both
/// are `None` on engines with no layout (the CSS-text scan, static HTML),
/// where the floor falls back to what the declaration alone can say.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct GlowOpts {
    pub box_shadow: Option<String>,
    pub text_shadow: Option<String>,
    pub effective_bg: Option<Rgba>,
    /// The element's own computed `opacity`; `None` when it is unknown.
    #[serde(default)]
    pub element_opacity: Option<f64>,
    /// The element's border-box size in CSS px; `None` without layout.
    #[serde(default)]
    pub element_size: Option<(f64, f64)>,
    /// The fill behind the element as the background walk resolved it, used
    /// to measure how far a glow lifts it. `None` where the walk named no
    /// single fill (an image, a gradient, a surface it could not read), and
    /// on the engines that pass no surface.
    #[serde(default)]
    pub surface: Option<Rgba>,
}
