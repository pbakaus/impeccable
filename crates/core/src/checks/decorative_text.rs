//! Text with no reading job, for `low-contrast` (taste call r3-04: "Rank
//! those shapes lower: reported as advisory, outside the failure count. The
//! clipto.com mockup labels and the terminal text stay visible.").
//!
//! Four shapes, each read conservatively off the DOM. Where a shape is
//! uncertain the finding keeps its severity, so every test below asks for
//! positive evidence and none of them is a guess about intent:
//!
//! - **Avatar initials**: one letter, or two, alone in a small square or
//!   round box that paints itself, and centred in it. Digits are left out
//!   (a notification count, a page number, a step), and so are a lone
//!   lower-case `i`, `x` or `v` (an info badge, a close glyph, a chevron), a
//!   key in a `kbd` (a shortcut hint) and a letter that is the whole label
//!   of a control (an A to Z index, a quiz option). A brand's lower-case
//!   letter in a chat avatar (tryrote.com's `r`) is still an avatar.
//! - **Build or version stamps**: text made only of a version or build
//!   identifier, optionally with a date, a time or a short hash
//!   (`v2.4.1`, `Build 1289`, `N0.0.1 · 2024-03-01`), outside headings and
//!   controls: a changelog entry's `<h2>v4.2.0</h2>` and a `v3.1.0` link are
//!   navigation, not stamps. A word like `release` or `build` needs a dotted
//!   version, a build number that is not a year, or a hash after it
//!   (`Release 2024` is a year).
//! - **Signatures**: a short name set in a handwriting face, or marked
//!   `signature` by its class or id, outside headings and controls.
//! - **Text inside illustration mockups**: an ancestor that says it is one,
//!   by a `mockup` or `illustration` class or id part, or `mock` beside a UI
//!   word (`mock-window`, `mockBrowser`), or an HTML subtree marked
//!   `role="img"` (not an `svg`, where the role labels a chart whose axis
//!   text is read). Under a class marker, sentence-length copy is still
//!   copy (`mockups-grid` marketing text), and a `mock-exam` or an
//!   `illustration-credit` is not a mockup at all. A mockup built from
//!   utility classes says so by its structure or not at all (taste call
//!   r5-p26, [`crate::checks::text_context::in_framed_demo`]): a window with
//!   three title-bar dots, a framed box under a preview caption, a device
//!   frame that is scaled or tilted in 3D, a frame box with a sample
//!   caption on it or beside it (r8-t1). Sentence-length copy inside is
//!   still copy. `undersized-ui-text` and `tiny-text` report text in a
//!   mockup as advisory too.
//! - **Ghost wordmarks**: the site's own name set as a shape, not a line to
//!   read: display type at [`WORDMARK_MIN_PX`] or more, or at
//!   [`WORDMARK_H1_SCALE`] times the page's largest `h1` (and at least
//!   [`WORDMARK_H1_PATH_MIN_PX`]), painted at
//!   [`WORDMARK_MAX_OPACITY`] or less (its opacity and its ink's alpha
//!   together), whose words are the site's name (screen.movie's 222px
//!   "Screen Movie" at 0.1 in the footer, incredible.one's 272px
//!   "Incredible" at 0.07 alpha). Outside controls; a heading may carry it.
//!
//! The adapters gather [`DecorativeTextFacts`] against their own DOM; the
//! decision is made here, once, for both engines.

use once_cell::sync::Lazy;
use regex::Regex;

/// Smallest side, in px, of a box that can hold avatar initials.
pub const AVATAR_MIN_PX: f64 = 12.0;
/// Largest side, in px, of a box that still reads as a small avatar.
pub const AVATAR_MAX_PX: f64 = 72.0;
/// How far from square (width over height) an avatar box may be.
pub const AVATAR_MIN_ASPECT: f64 = 0.8;
pub const AVATAR_MAX_ASPECT: f64 = 1.25;
/// How far the text's centre may sit from the box's, as a share of the box.
pub const AVATAR_CENTRE_TOLERANCE: f64 = 0.15;

/// Type at least this large, in px, is display type a wordmark can be.
pub const WORDMARK_MIN_PX: f64 = 120.0;
/// Type at least this many times the page's largest `h1` is display type.
pub const WORDMARK_H1_SCALE: f64 = 3.0;
/// The least size the [`WORDMARK_H1_SCALE`] path accepts, so a page whose
/// `h1` is a small logo does not make body-sized type display.
pub const WORDMARK_H1_PATH_MIN_PX: f64 = 80.0;
/// The most a wordmark may show of its ink, its opacity and its colour's
/// alpha together, and still be a shape rather than a line to read.
pub const WORDMARK_MAX_OPACITY: f64 = 0.25;

/// Whether a box is the size and shape of a small avatar.
pub fn avatar_sized(width: f64, height: f64) -> bool {
    if !(width.is_finite() && height.is_finite()) || height <= 0.0 {
        return false;
    }
    let aspect = width / height;
    (AVATAR_MIN_PX..=AVATAR_MAX_PX).contains(&width)
        && (AVATAR_MIN_PX..=AVATAR_MAX_PX).contains(&height)
        && (AVATAR_MIN_ASPECT..=AVATAR_MAX_ASPECT).contains(&aspect)
}

/// Whether a text box `(left, top, width, height)` is centred in a box.
pub fn centred_in(text: (f64, f64, f64, f64), host: (f64, f64, f64, f64)) -> bool {
    let (tx, ty, tw, th) = text;
    let (bx, by, bw, bh) = host;
    let dx = ((tx + tw / 2.0) - (bx + bw / 2.0)).abs();
    let dy = ((ty + th / 2.0) - (by + bh / 2.0)).abs();
    dx <= (bw * AVATAR_CENTRE_TOLERANCE).max(2.0) && dy <= (bh * AVATAR_CENTRE_TOLERANCE).max(2.0)
}

/// What the adapters read off one element.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct DecorativeTextFacts {
    /// The element's whole text, whitespace collapsed and trimmed.
    pub text: String,
    /// The element's computed `font-family`.
    pub font_family: String,
    /// The element is, or sits in, a heading.
    pub in_heading: bool,
    /// The element is, or sits in, an interactive control whose whole text
    /// is this element's text: the element is the control's label.
    pub control_label: bool,
    /// The element is, or sits in, an interactive control, whatever else the
    /// control's text holds.
    pub in_control: bool,
    /// A small square or round box that paints itself holds this text and
    /// nothing else, centred in it ([`avatar_sized`], [`centred_in`]).
    pub avatar_box: bool,
    /// The element is, or sits in, a `kbd`: a key in a shortcut hint.
    pub in_kbd: bool,
    /// The element or its parent is marked a signature by class or id
    /// ([`is_signature_marker`]).
    pub signature_marked: bool,
    /// An ancestor's class or id says it is an illustration mockup
    /// ([`is_mockup_marker`]).
    pub mockup_ancestor: bool,
    /// An ancestor is an HTML element marked `role="img"` outside any `svg`:
    /// the author declared the subtree a picture.
    pub picture_ancestor: bool,
    /// An ancestor is a framed HTML demo by its structure: a window with
    /// three title-bar dots, a framed box under a preview caption, a device
    /// frame that is scaled or tilted in 3D, or a frame box with a sample
    /// caption on it or beside it
    /// ([`crate::checks::text_context::in_framed_demo`], taste calls r5-p26
    /// and r8-t1).
    pub framed_demo: bool,
    /// The element's computed font size in px, 0 where it was not read.
    pub font_size_px: f64,
    /// The largest computed font size of an `h1` on the page in px, 0 where
    /// there is none. Read only where the type is between
    /// [`WORDMARK_H1_PATH_MIN_PX`] and [`WORDMARK_MIN_PX`], the sizes the
    /// `h1` decides; 0 otherwise.
    pub largest_h1_px: f64,
    /// How much of its ink the text shows: its effective opacity times its
    /// colour's alpha. Read only where the type is display size; 1 otherwise.
    pub shown_opacity: f64,
    /// The names the site goes by (its host name, its `og:site_name`, its
    /// title and the title's parts). Read only where the type is display
    /// size and faint; empty otherwise.
    pub site_names: Vec<String>,
}

/// The shape a text with no reading job was recognised by.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DecorativeShape {
    AvatarInitials,
    VersionStamp,
    Signature,
    Mockup,
    Wordmark,
}

/// The decorative shape these facts show, if any.
pub fn classify_decorative_text(f: &DecorativeTextFacts) -> Option<DecorativeShape> {
    if f.picture_ancestor {
        return Some(DecorativeShape::Mockup);
    }
    if f.text.is_empty() {
        return None;
    }
    if (f.mockup_ancestor || f.framed_demo) && !is_sentence_copy(&f.text) {
        return Some(DecorativeShape::Mockup);
    }
    // Any text inside a control is part of what the control says, a site
    // name beside other words in a link included.
    if !f.in_control
        && !f.control_label
        && is_wordmark_size(f.font_size_px, f.largest_h1_px)
        && f.shown_opacity <= WORDMARK_MAX_OPACITY
        && names_the_site(&f.text, &f.site_names)
    {
        return Some(DecorativeShape::Wordmark);
    }
    if f.avatar_box
        && !f.control_label
        && !f.in_kbd
        && is_initials(&f.text)
        && !is_icon_letter(&f.text)
    {
        return Some(DecorativeShape::AvatarInitials);
    }
    if !f.in_heading && !f.control_label {
        if is_version_stamp(&f.text) {
            return Some(DecorativeShape::VersionStamp);
        }
        let by_marker = f.signature_marked && is_name_like(&f.text, false);
        let by_face = is_handwriting_face(&f.font_family) && is_name_like(&f.text, true);
        if by_marker || by_face {
            return Some(DecorativeShape::Signature);
        }
    }
    None
}

/// Whether type at `font_size` is display type for a wordmark: at least
/// [`WORDMARK_MIN_PX`], or [`WORDMARK_H1_SCALE`] times the page's largest
/// `h1` where it has one.
pub fn is_wordmark_size(font_size: f64, largest_h1: f64) -> bool {
    font_size.is_finite()
        && font_size > 0.0
        && (font_size >= WORDMARK_MIN_PX
            || (largest_h1 > 0.0 && font_size >= WORDMARK_H1_PATH_MIN_PX && font_size >= largest_h1 * WORDMARK_H1_SCALE))
}

/// The words of `text`, lower-cased, letters and digits only.
fn name_words(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(|w| w.to_lowercase())
        .collect()
}

/// Whether `text` is the site's name: its words, run together, are one of
/// `names` run together (`Screen Movie` and the host `screen.movie`), or they
/// open one of `names` word for word (`Screen Movie` and the title `Screen
/// Movie Blog`). At least three letters.
pub fn names_the_site(text: &str, names: &[String]) -> bool {
    let words = name_words(text);
    let joined: String = words.concat();
    if joined.chars().count() < 3 {
        return false;
    }
    names.iter().any(|name| {
        let name_words = name_words(name);
        name_words.concat() == joined || name_words.starts_with(&words)
    })
}

/// One letter or two, in any script, and nothing else.
pub fn is_initials(text: &str) -> bool {
    let chars: Vec<char> = text.chars().filter(|c| !c.is_whitespace()).collect();
    (1..=2).contains(&chars.len())
        && chars.iter().all(|c| c.is_alphabetic())
        && !text.trim().contains(char::is_whitespace)
}

/// A lone lower-case letter that small UI draws as an icon: `i` in an info
/// badge, `x` on a close chip, `v` as a chevron. Not initials.
pub fn is_icon_letter(text: &str) -> bool {
    matches!(text.trim(), "i" | "x" | "v")
}

/// Text that reads as a sentence: eight words or more, or five or more
/// ending in `.`, `!` or `?`. A mockup's labels are short ("Ready", "Draft
/// saved", "$ npm run build"); a paragraph under a marked wrapper is copy.
pub fn is_sentence_copy(text: &str) -> bool {
    let words = text.split_whitespace().count();
    let ends = text.trim_end().ends_with(['.', '!', '?', '。', '！', '？']);
    words >= 8 || (words >= 5 && ends)
}

static STAMP_TOKEN_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?ix)
        \b(?:version|ver\.?|build|release|rev(?:ision)?|commit)\s*[:\#]?\s*(?P<id>[0-9a-z][0-9a-z.+_-]*\d[0-9a-z.+_-]*)
        | (?:^|[\s(\[])v\d+(?:\.\d+)+(?:[-+][0-9a-z.]+)?
        | (?:^|[\s(\[])[a-z]{1,3}\d+\.\d+\.\d+(?:\.\d+)?(?:[-+][0-9a-z.]+)?
        ",
    )
    .expect("STAMP_TOKEN_RE")
});
/// What may follow `version`, `build`, `release` and the other stamp words:
/// a dotted version (`12.4`, `2024.03.1`), a build number that is not a year
/// (`1289`, not `2024`), optionally with a suffix (`1289-rc1`), or a short
/// hash (`5f3a2c1`). `Release 2024` is a year and `Build faster` no number.
static STAMP_ID_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?ix)^(?:
        [a-z]?\d+(?:\.\d+)+(?:[-+_][0-9a-z.]+)?
        | (?P<num>\d+)(?:[-+_][0-9a-z.]+)?
        | [0-9a-f]{7,40}
        )$",
    )
    .expect("STAMP_ID_RE")
});

fn is_stamp_id(id: &str) -> bool {
    let Some(c) = STAMP_ID_RE.captures(id) else { return false };
    match c.name("num") {
        Some(n) => {
            let n = n.as_str();
            let year = n.len() == 4 && (n.starts_with("19") || n.starts_with("20"));
            // A hash of digits alone falls here too (`1234567`), and reads as
            // a build number, which is what it is used as.
            !year
        }
        None => true,
    }
}

/// A bare three-part version (`1.10.0`). A dotted date (`2026.08.13`,
/// `13.08.26`) has a four-digit part or a zero-padded one, which a version
/// never has, and is left to [`STAMP_FILLER_RE`] as a date.
static BARE_VERSION_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)(?:^|[\s(\[])(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:[-+][0-9a-z.]+)?\b")
        .expect("BARE_VERSION_RE")
});

fn bare_version_spans(text: &str) -> Vec<(usize, usize)> {
    let padded = |p: &str| p.len() > 1 && p.starts_with('0');
    BARE_VERSION_RE
        .captures_iter(text)
        .filter(|c| !(padded(&c[2]) || padded(&c[3])))
        .map(|c| {
            let m = c.get(0).unwrap();
            (m.start(), m.end())
        })
        .collect()
}
static STAMP_FILLER_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?ix)
        \b\d{4}[-./]\d{1,2}[-./]\d{1,2}(?:[\sT]+\d{1,2}(?::\d{2}){0,2})?\b
        | \b\d{1,2}[-./]\d{1,2}[-./]\d{2,4}(?:[\sT]+\d{1,2}(?::\d{2}){0,2})?\b
        | \b\d{1,2}:\d{2}(?::\d{2})?\b
        | \b[0-9a-f]{7,12}\b
        | [\s·•|/,()\[\]–—-]+
        ",
    )
    .expect("STAMP_FILLER_RE")
});

/// Text made only of a version or build identifier, with at most a date, a
/// time, a short hash and separators beside it. A version inside a sentence
/// ("Version 2 adds dark mode") is copy, not a stamp.
pub fn is_version_stamp(text: &str) -> bool {
    let text = text.trim();
    if text.is_empty() || text.chars().count() > 64 {
        return false;
    }
    let mut tokens = false;
    let mut rest = STAMP_TOKEN_RE
        .replace_all(text, |c: &regex::Captures<'_>| {
            if c.name("id").is_some_and(|id| !is_stamp_id(id.as_str())) {
                return c[0].to_string();
            }
            tokens = true;
            " ".to_string()
        })
        .into_owned();
    let bare = bare_version_spans(&rest);
    if !tokens && bare.is_empty() {
        return false;
    }
    for (start, end) in bare.into_iter().rev() {
        rest.replace_range(start..end, " ");
    }
    STAMP_FILLER_RE.replace_all(&rest, "").is_empty()
}

static SIGNATURE_TOKEN_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?i)^(?:[a-z0-9]+(?:-{1,2}|_{1,2}))?(?:signature|autograph|sign-?off)(?:(?:-{1,2}|_{1,2})(?:name|text|line|block|wrap|wrapper|img|image))?$",
    )
    .expect("SIGNATURE_TOKEN_RE")
});

/// Whether a class list or id names a signature: `signature`,
/// `author-signature`, `signature__name`. A class that only starts with the
/// word (`signature-dish`) names something else.
pub fn is_signature_marker(class_or_id: &str) -> bool {
    class_or_id
        .split_whitespace()
        .any(|token| SIGNATURE_TOKEN_RE.is_match(token))
}

/// UI words that make a `mock` part name a picture of an interface
/// (`mock-window`, `mockBrowser`) rather than a practice run (`mock-exam`,
/// `mock-interview`).
const MOCK_UI_PARTS: &[&str] = &[
    "app", "browser", "chrome", "dashboard", "desktop", "device", "editor", "frame", "laptop",
    "phone", "screen", "terminal", "ui", "window",
];
/// Parts that make a token name the words about an illustration, which are
/// read: `illustration-credit`, `mockup-caption`.
const MOCKUP_COPY_PARTS: &[&str] = &[
    "attribution", "caption", "captions", "copyright", "credit", "credits", "license",
    "licence",
];

/// A class or id token's parts: split on `-`, `_`, `:`, `/` and `.`, and
/// where a lower-case letter meets a capital (`heroIllustration`), lower
/// cased.
pub(crate) fn token_parts(token: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut cur = String::new();
    let mut prev_lower = false;
    for c in token.chars() {
        if matches!(c, '-' | '_' | ':' | '/' | '.') {
            if !cur.is_empty() {
                parts.push(std::mem::take(&mut cur));
            }
            prev_lower = false;
            continue;
        }
        if c.is_uppercase() && prev_lower && !cur.is_empty() {
            parts.push(std::mem::take(&mut cur));
        }
        prev_lower = c.is_lowercase();
        cur.extend(c.to_lowercase());
    }
    if !cur.is_empty() {
        parts.push(cur);
    }
    parts
}

/// Whether a class list or id names an illustration mockup: a token with a
/// part that is `mockup(s)` or `illustration(s)`, or `mock` beside a UI
/// word part ([`MOCK_UI_PARTS`]), and no part naming a credit or caption
/// ([`MOCKUP_COPY_PARTS`]).
pub fn is_mockup_marker(class_or_id: &str) -> bool {
    class_or_id.split_whitespace().any(|token| {
        let parts = token_parts(token);
        let has = |set: &[&str]| parts.iter().any(|p| set.contains(&p.as_str()));
        if has(MOCKUP_COPY_PARTS) {
            return false;
        }
        has(&["mockup", "mockups", "illustration", "illustrations"])
            || (has(&["mock"]) && has(MOCK_UI_PARTS))
    })
}

/// Tags whose class or id says nothing about the text inside them being an
/// illustration: a `<section class="mockups">` holds the copy about them.
pub const MOCKUP_MARKER_SKIP_TAGS: &[&str] = &[
    "html", "body", "main", "section", "article", "header", "footer", "nav", "aside",
    "figcaption",
];

/// Handwriting faces a signature is set in, beyond the generic `cursive`
/// and any family with `script` or `handwriting` in its name.
const HANDWRITING_FACES: &[&str] = &[
    "allura",
    "alex brush",
    "arizonia",
    "birthstone",
    "caveat",
    "cedarville cursive",
    "cookie",
    "dawning of a new day",
    "great vibes",
    "herr von muellerhoff",
    "homemade apple",
    "italianno",
    "la belle aurore",
    "meddon",
    "monsieur la doulaise",
    "mr dafoe",
    "mrs saint delafield",
    "ms madi",
    "nothing you could do",
    "pacifico",
    "parisienne",
    "qwigley",
    "reenie beanie",
    "sacramento",
    "satisfy",
    "tangerine",
    "whisper",
    "yellowtail",
    "zeyada",
];

/// Whether the first family of a `font-family` list is a handwriting face.
pub fn is_handwriting_face(font_family: &str) -> bool {
    let first = font_family
        .split(',')
        .next()
        .unwrap_or("")
        .trim()
        .trim_matches(|c| c == '"' || c == '\'')
        .to_ascii_lowercase();
    if first.is_empty() {
        return false;
    }
    first == "cursive"
        || first.contains("script")
        || first.contains("handwriting")
        || HANDWRITING_FACES.contains(&first.as_str())
}

/// A short name: one to four words (three when `capitalised`) of letters,
/// with `.`, `'` and `-` inside them, at most 40 characters, after an
/// optional sign-off dash or tilde. With `capitalised` every word starts in
/// upper case, which is what separates a name set in a script face from a
/// tagline set in one.
pub fn is_name_like(text: &str, capitalised: bool) -> bool {
    let text = text
        .trim()
        .trim_start_matches(|c: char| matches!(c, '-' | '–' | '—' | '~') || c.is_whitespace());
    if text.is_empty() || text.chars().count() > 40 {
        return false;
    }
    let words: Vec<&str> = text.split_whitespace().collect();
    let max = if capitalised { 3 } else { 4 };
    if words.is_empty() || words.len() > max {
        return false;
    }
    words.iter().all(|w| {
        let mut chars = w.chars();
        let Some(first) = chars.next() else { return false };
        first.is_alphabetic()
            && (!capitalised || first.is_uppercase() || !first.is_lowercase())
            && w.chars().all(|c| c.is_alphabetic() || matches!(c, '.' | '\'' | '’' | '-'))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn facts(text: &str) -> DecorativeTextFacts {
        DecorativeTextFacts { text: text.to_string(), ..Default::default() }
    }

    #[test]
    fn a_ghost_wordmark_is_the_site_name_as_a_faint_display_shape() {
        let names = vec!["screenmovie".to_string(), "screen".to_string(), "Screen Movie Blog".to_string()];
        let ghost = |text: &str, size: f64, h1: f64, shown: f64| DecorativeTextFacts {
            font_size_px: size,
            largest_h1_px: h1,
            shown_opacity: shown,
            site_names: names.clone(),
            ..facts(text)
        };
        let shape = |f: &DecorativeTextFacts| classify_decorative_text(f);
        // screen.movie's footer: 222px at 0.1.
        assert_eq!(shape(&ghost("Screen Movie", 222.0, 64.0, 0.1)), Some(DecorativeShape::Wordmark));
        assert_eq!(shape(&ghost("SCREEN", 222.0, 64.0, 0.1)), Some(DecorativeShape::Wordmark));
        // Three times the largest h1 is display type too.
        assert_eq!(shape(&ghost("Screen Movie", 100.0, 32.0, 0.2)), Some(DecorativeShape::Wordmark));
        // Read as a line: visible enough, small, another word, or a control.
        assert_eq!(shape(&ghost("Screen Movie", 222.0, 64.0, 0.4)), None);
        assert_eq!(shape(&ghost("Screen Movie", 96.0, 48.0, 0.1)), None);
        // A small logo h1 does not make body-sized type display.
        assert_eq!(shape(&ghost("Screen Movie", 60.0, 16.0, 0.1)), None);
        assert_eq!(shape(&ghost("Record faster", 222.0, 64.0, 0.1)), None);
        assert_eq!(shape(&ghost("Movie", 222.0, 64.0, 0.1)), None);
        assert_eq!(shape(&DecorativeTextFacts { control_label: true, ..ghost("Screen Movie", 222.0, 64.0, 0.1) }), None);
        // Review of #1044: part of a link's label, beside its other words.
        assert_eq!(shape(&DecorativeTextFacts { in_control: true, ..ghost("Screen Movie", 222.0, 64.0, 0.1) }), None);
        // An adapter that reads no layout leaves the size at 0.
        assert_eq!(shape(&ghost("Screen Movie", 0.0, 0.0, 0.0)), None);
        assert!(!names_the_site("Sc", &["sc".to_string()]));
    }

    #[test]
    fn initials_need_an_avatar_box_and_letters() {
        let boxed = |t: &str| DecorativeTextFacts { avatar_box: true, ..facts(t) };
        for t in ["J", "AB", "李", "r", "Jd"] {
            assert_eq!(classify_decorative_text(&boxed(t)), Some(DecorativeShape::AvatarInitials), "{t}");
        }
        for t in ["3", "12", "A1", "ABC", "A B", "×", "i", "x", "v"] {
            assert_eq!(classify_decorative_text(&boxed(t)), None, "{t}");
        }
        assert_eq!(classify_decorative_text(&facts("JD")), None);
        let label = DecorativeTextFacts { control_label: true, ..boxed("A") };
        assert_eq!(classify_decorative_text(&label), None);
        // A key in a shortcut hint is a key, however avatar-like its box.
        let key = DecorativeTextFacts { in_kbd: true, ..boxed("K") };
        assert_eq!(classify_decorative_text(&key), None);
    }

    #[test]
    fn stamps_in_headings_and_controls_are_navigation() {
        let heading = DecorativeTextFacts { in_heading: true, ..facts("v4.2.0") };
        assert_eq!(classify_decorative_text(&heading), None);
        let link = DecorativeTextFacts { control_label: true, ..facts("v3.1.0") };
        assert_eq!(classify_decorative_text(&link), None);
        assert_eq!(classify_decorative_text(&facts("v3.1.0")), Some(DecorativeShape::VersionStamp));
    }

    #[test]
    fn version_stamps_stand_alone() {
        for t in [
            "v2.4.1",
            "V1.2",
            "Version 3.1.0",
            "Build 1289",
            "build: 2024.03.1",
            "N0.0.1 · 2024-03-01",
            "N0.0.1 , 2026-09-08 19",
            "v1.8.0 (5f3a2c1)",
            "Release 12.4 — 03/01/2024",
            "commit 5f3a2c1d",
            "1.10.0",
            "0.0.1 (2024-03-01)",
            "Build 1289-rc1",
            "Build 5f3a2c1",
            "Release 12.4",
            "rev 512",
        ] {
            assert!(is_version_stamp(t), "{t}");
        }
        for t in [
            "4.99",
            "1.2",
            "Version 2 adds dark mode",
            "© 2024 Acme Inc. v1.2",
            "Rebuild your workflow",
            "Build faster with templates",
            "10.0.0.1 is the router",
            "Revenue",
            "2026.08.13",
            "13.08.26",
            "13.08.2026",
            "12.03.24 · 09:30",
            "2026-09-08 19",
            "Release 2024",
            "Build 2026",
            "Version 1999",
            "Release 2024-03-01",
            "Build faster",
        ] {
            assert!(!is_version_stamp(t), "{t}");
        }
    }

    #[test]
    fn signatures_are_short_names_in_a_script_face_or_marked() {
        let face = |t: &str, fam: &str| DecorativeTextFacts { font_family: fam.to_string(), ..facts(t) };
        assert_eq!(
            classify_decorative_text(&face("Pedro", "\"Great Vibes\", cursive")),
            Some(DecorativeShape::Signature)
        );
        assert_eq!(
            classify_decorative_text(&face("— Sarah J.", "Dancing Script")),
            Some(DecorativeShape::Signature)
        );
        assert_eq!(classify_decorative_text(&face("Made with love", "cursive")), None);
        assert_eq!(classify_decorative_text(&face("Pedro", "Georgia, serif")), None);
        let heading = DecorativeTextFacts { in_heading: true, ..face("Pedro", "cursive") };
        assert_eq!(classify_decorative_text(&heading), None);
        let marked = DecorativeTextFacts { signature_marked: true, ..facts("pedro") };
        assert_eq!(classify_decorative_text(&marked), Some(DecorativeShape::Signature));
        assert!(is_signature_marker("text-sm author-signature"));
        assert!(is_signature_marker("signature__name"));
        assert!(!is_signature_marker("signature-dish"));
        assert!(!is_signature_marker("signatures-list item"));
    }

    #[test]
    fn mockups_say_so() {
        for yes in [
            "hero-mockup rounded",
            "mock-window",
            "mockBrowser",
            "heroIllustration",
            "mockup-phone",
            "illustrations",
            "app__mockup",
            "md:hero-mockup",
        ] {
            assert!(is_mockup_marker(yes), "{yes}");
        }
        for no in [
            "hammock",
            "mocha card",
            "mock-exam",
            "mock-interview",
            "mock",
            "illustration-credit",
            "mockup-caption",
            "illustrator-bio",
            "mockupsgrid",
        ] {
            assert!(!is_mockup_marker(no), "{no}");
        }
        let m = DecorativeTextFacts { mockup_ancestor: true, ..facts("Ready") };
        assert_eq!(classify_decorative_text(&m), Some(DecorativeShape::Mockup));
        // A paragraph under a marked wrapper is copy about the mockups.
        let copy = DecorativeTextFacts {
            mockup_ancestor: true,
            ..facts("Download our device frames and use them in your pitch deck for free.")
        };
        assert_eq!(classify_decorative_text(&copy), None);
        // A picture the author marked role="img" is a picture, sentences and all.
        let pic = DecorativeTextFacts { picture_ancestor: true, ..copy.clone() };
        assert_eq!(classify_decorative_text(&pic), Some(DecorativeShape::Mockup));
        // A demo framed by structure reads the same way as a marked one.
        let framed = DecorativeTextFacts { framed_demo: true, ..facts("847 results") };
        assert_eq!(classify_decorative_text(&framed), Some(DecorativeShape::Mockup));
        let framed_copy = DecorativeTextFacts { framed_demo: true, ..copy.clone() };
        assert_eq!(classify_decorative_text(&framed_copy), None);
        assert!(!is_sentence_copy("Draft saved"));
        assert!(!is_sentence_copy("$ npm run build --watch"));
        assert!(is_sentence_copy("Your export is ready to download."));
    }

    #[test]
    fn avatar_geometry() {
        assert!(avatar_sized(40.0, 40.0));
        assert!(avatar_sized(26.0, 24.0));
        assert!(!avatar_sized(80.0, 80.0));
        assert!(!avatar_sized(40.0, 20.0));
        assert!(!avatar_sized(10.0, 10.0));
        assert!(centred_in((14.0, 10.0, 12.0, 20.0), (0.0, 0.0, 40.0, 40.0)));
        assert!(!centred_in((2.0, 10.0, 12.0, 20.0), (0.0, 0.0, 40.0, 40.0)));
    }
}
