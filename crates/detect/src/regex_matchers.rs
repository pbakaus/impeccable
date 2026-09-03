//! Port of the `REGEX_MATCHERS` line matchers and `REGEX_ANALYZERS` page
//! analyzers from `cli/engine/engines/regex/detect-text.mjs`.

use impeccable_core::checks::css_scan::{
    scan_css_text_for_glow, scan_css_text_for_marquee, scan_css_text_for_radial_halo,
};
use impeccable_core::color::is_neutral_color;
use impeccable_core::constants::{EM_DASH_CHARS_PER_DASH, EM_DASH_FLOOR, OVERUSED_FONTS};
use impeccable_core::checks::rules::find_solid_chromatic_bg;
use impeccable_core::findings::{finding, Finding};
use impeccable_core::fonts::extract_google_font_families;
use impeccable_core::js::{
    self, ci, math_round, number_to_string, parse_float, string_to_number,
};
use impeccable_core::js_ext_a::{advance_utf16, slice_utf16_start, utf16_index, utf16_length};
use once_cell::sync::Lazy;
use regex::Regex;

use crate::util::{line_of_offset, re, ANY, B, D, W, WS, WS_CHARS};

/// A regex match handed to a matcher's `test` / `fmt`: the whole match and
/// its capture groups (JS `m[0]`, `m[1]`, ...; `None` where a group did not
/// participate).
#[derive(Debug, Clone)]
pub struct MatchCtx {
    pub groups: Vec<Option<String>>,
    /// JS `m.index`: the byte offset of the whole match in the line.
    pub index: usize,
}

impl MatchCtx {
    fn from_caps(c: &regex::Captures) -> Self {
        MatchCtx {
            groups: (0..c.len())
                .map(|i| c.get(i).map(|g| g.as_str().to_string()))
                .collect(),
            index: c.get(0).map(|g| g.start()).unwrap_or(0),
        }
    }
    /// JS `m[i]` (`''` when undefined, which is what template strings and
    /// `+m[i]` treat it as for our purposes).
    pub fn g(&self, i: usize) -> &str {
        self.groups.get(i).and_then(|g| g.as_deref()).unwrap_or("")
    }
    pub fn whole(&self) -> &str {
        self.g(0)
    }
}

/// The JS-source scanner every gray-on-color scope helper walks with: it
/// tracks string, template-literal, paren and brace depth and reports every
/// other character to `on_char`, which returns `true` to stop the walk.
///
/// JS: detect-text.mjs#scanJs
struct ScanDepth {
    paren: i32,
    brace: i32,
}

fn scan_js<F>(text: &str, start: usize, mut on_char: F)
where
    F: FnMut(char, usize, Option<char>, Option<char>, &ScanDepth) -> bool,
{
    let chars: Vec<(usize, char)> = text.char_indices().collect();
    let mut k = chars
        .iter()
        .position(|(b, _)| *b >= start)
        .unwrap_or(chars.len());
    let mut string_quote: Option<char> = None;
    let mut in_template = false;
    let mut paren = 0i32;
    let mut brace = 0i32;
    let mut interp_brace: Vec<i32> = Vec::new();

    while k < chars.len() {
        let (bi, ch) = chars[k];
        let prev = if k > 0 { Some(chars[k - 1].1) } else { None };
        let next = chars.get(k + 1).map(|(_, c)| *c);

        if let Some(q) = string_quote {
            if ch == '\\' {
                k += 2;
                continue;
            }
            if ch == q {
                string_quote = None;
            }
            k += 1;
            continue;
        }
        if in_template && interp_brace.is_empty() {
            if ch == '\\' {
                k += 2;
                continue;
            }
            if ch == '$' && next == Some('{') {
                brace += 1;
                interp_brace.push(brace);
                k += 2;
                continue;
            }
            if ch == '`' {
                in_template = false;
            }
            k += 1;
            continue;
        }

        if ch == '\'' || ch == '"' {
            string_quote = Some(ch);
            k += 1;
            continue;
        }
        if ch == '`' {
            in_template = true;
            k += 1;
            continue;
        }
        if ch == '(' {
            paren += 1;
            k += 1;
            continue;
        }
        if ch == ')' {
            paren -= 1;
            k += 1;
            continue;
        }
        if ch == '{' {
            brace += 1;
            k += 1;
            continue;
        }
        if ch == '}' {
            brace -= 1;
            if interp_brace.last().is_some_and(|last| brace < *last) {
                interp_brace.pop();
            }
            k += 1;
            continue;
        }
        if on_char(ch, bi, prev, next, &ScanDepth { paren, brace }) {
            return;
        }
        k += 1;
    }
}

/// JS: detect-text.mjs#containingMarkupTag (only its `text` is read).
fn containing_markup_tag(line: &str) -> impl Fn(usize) -> String + '_ {
    move |index: usize| {
        let mut i = 0usize;
        while i < line.len() {
            let Some(rel) = line[i..].find('<') else { break };
            let tag_start = i + rel;
            let after = &line[tag_start + 1..];
            if !after.chars().next().is_some_and(|c| c.is_ascii_alphabetic()) {
                i = tag_start + 1;
                continue;
            }
            let mut tag_end: Option<usize> = None;
            scan_js(line, tag_start + 1, |ch, j, _p, _n, depth| {
                if ch == '>' && depth.brace == 0 {
                    tag_end = Some(j);
                    return true;
                }
                false
            });
            let Some(end) = tag_end else { break };
            if index >= tag_start && index <= end {
                return line[tag_start..end + 1].to_string();
            }
            i = end + 1;
        }
        line.to_string()
    }
}

struct TernarySplit {
    common: String,
    consequent: String,
    alternate: String,
    suffix: String,
}

/// JS: detect-text.mjs#findTernarySplit
fn find_ternary_split(text: &str) -> Option<TernarySplit> {
    let mut q_pos: Option<usize> = None;
    let mut q_paren = 0i32;
    let mut q_brace = 0i32;
    let mut nested = 0u32;
    let mut colon_pos: Option<usize> = None;
    let mut split: Option<TernarySplit> = None;

    // `?.` and `??` are not ternaries.
    let is_question = |ch: char, prev: Option<char>, next: Option<char>| {
        ch == '?'
            && prev != Some('.')
            && prev != Some('?')
            && next != Some('?')
            && next != Some('.')
    };

    scan_js(text, 0, |ch, i, prev, next, depth| {
        if colon_pos.is_none() {
            if q_pos.is_none() && is_question(ch, prev, next) {
                q_pos = Some(i);
                q_paren = depth.paren;
                q_brace = depth.brace;
                return false;
            }
            let same_depth = depth.paren == q_paren && depth.brace == q_brace;
            if q_pos.is_some() && is_question(ch, prev, next) && same_depth {
                nested += 1;
                return false;
            }
            if q_pos.is_some() && ch == ':' && same_depth {
                if nested > 0 {
                    nested -= 1;
                } else {
                    colon_pos = Some(i);
                }
            }
            return false;
        }
        if ch == ',' && depth.paren == q_paren && depth.brace == q_brace {
            let (q, c) = (q_pos.unwrap(), colon_pos.unwrap());
            split = Some(TernarySplit {
                common: text[..q].to_string(),
                consequent: text[q + 1..c].to_string(),
                alternate: text[c + 1..i].to_string(),
                suffix: text[i..].to_string(),
            });
            return true;
        }
        false
    });

    if split.is_none() {
        if let (Some(q), Some(c)) = (q_pos, colon_pos) {
            split = Some(TernarySplit {
                common: text[..q].to_string(),
                consequent: text[q + 1..c].to_string(),
                alternate: text[c + 1..].to_string(),
                suffix: String::new(),
            });
        }
    }
    split
}

/// JS: detect-text.mjs#exclusiveClassScopes
fn exclusive_class_scopes(text: &str) -> Vec<String> {
    let Some(split) = find_ternary_split(text) else {
        return vec![text.to_string()];
    };
    let mut out = Vec::new();
    for part in exclusive_class_scopes(&split.consequent) {
        out.push(format!("{}{}{}", split.common, part, split.suffix));
    }
    for part in exclusive_class_scopes(&split.alternate) {
        out.push(format!("{}{}{}", split.common, part, split.suffix));
    }
    out
}

/// JS: detect-text.mjs#grayOnColorPairs. A gray text class only pairs with a
/// chromatic background inside the same markup tag and the same ternary arm
/// (#707).
fn gray_on_color_pairs(line: &str, gray_class: &str, index: usize) -> Vec<String> {
    exclusive_class_scopes(&containing_markup_tag(line)(index))
        .into_iter()
        .filter(|scope| scope.contains(gray_class))
        .collect()
}

pub struct Matcher {
    pub id: &'static str,
    /// Match every occurrence on one line, in order.
    pub find_all: fn(&str) -> Vec<MatchCtx>,
    pub test: fn(&MatchCtx, &str) -> bool,
    pub fmt: fn(&MatchCtx, &str) -> String,
}

fn all(re: &Regex, line: &str) -> Vec<MatchCtx> {
    re.captures_iter(line)
        .map(|c| MatchCtx::from_caps(&c))
        .collect()
}

/// JS `+m[1]` on a digit run.
fn num(s: &str) -> f64 {
    string_to_number(s)
}

re!(ROUNDED_NONE_RE, format!("{B}rounded-none{B}"));
re!(ROUNDED_RE, format!("{B}rounded(?:-{W}+)?{B}"));
fn has_rounded(line: &str) -> bool {
    ROUNDED_RE.is_match(&ROUNDED_NONE_RE.replace_all(line, ""))
}
re!(BORDER_RADIUS_WORD_RE, ci("border-radius"));
fn has_border_radius(line: &str) -> bool {
    BORDER_RADIUS_WORD_RE.is_match(line)
}
re!(
    SAFE_ELEMENT_RE,
    format!(
        "<(?:{bq}|{nav}[{ws}>]|{pre}[{ws}>]|{code}[{ws}>]|{a}{WS}|{input}[{ws}>]|{span}[{ws}>])",
        bq = ci("blockquote"),
        nav = ci("nav"),
        pre = ci("pre"),
        code = ci("code"),
        a = ci("a"),
        input = ci("input"),
        span = ci("span"),
        ws = WS_CHARS
    )
);
fn is_safe_element(line: &str) -> bool {
    SAFE_ELEMENT_RE.is_match(line)
}

fn first_overused_google_font(text: &str) -> String {
    extract_google_font_families(text)
        .into_iter()
        .find(|f| OVERUSED_FONTS.contains(&f.as_str()))
        .unwrap_or_default()
}

const NEUTRAL_COLOR_KEYWORDS: &[&str] = &[
    "transparent",
    "currentcolor",
    "black",
    "white",
    "gray",
    "grey",
    "silver",
    "dimgray",
    "dimgrey",
    "darkgray",
    "darkgrey",
    "lightgray",
    "lightgrey",
    "gainsboro",
    "whitesmoke",
];

re!(
    HEX_LONG_RE,
    "^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})(?:[0-9a-fA-F]{2})?$"
);
re!(
    HEX_SHORT_RE,
    "^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])(?:[0-9a-fA-F])?$"
);

fn hex_channels(color: &str) -> Option<[f64; 3]> {
    if let Some(m) = HEX_LONG_RE.captures(color) {
        return Some([
            js::parse_int(&m[1], 16),
            js::parse_int(&m[2], 16),
            js::parse_int(&m[3], 16),
        ]);
    }
    if let Some(m) = HEX_SHORT_RE.captures(color) {
        let f = |s: &str| js::parse_int(&format!("{s}{s}"), 16);
        return Some([f(&m[1]), f(&m[2]), f(&m[3])]);
    }
    None
}

re!(RGB_PREFIX_RE, format!("^{}[aA]?\\(", ci("rgb")));
re!(
    RGB_CHANNELS_RE,
    format!(
        "^{}[aA]?\\({WS}*([0-9.]+)[{ws},]+([0-9.]+)[{ws},]+([0-9.]+)",
        ci("rgb"),
        ws = WS_CHARS
    )
);
re!(
    OTHER_FUNC_RE,
    format!(
        "^(?:{}[aA]?|{}|{}|{}|{}|{})\\(",
        ci("hsl"),
        ci("oklch"),
        ci("oklab"),
        ci("lab"),
        ci("lch"),
        ci("hwb")
    )
);

fn spread3(v: [f64; 3]) -> f64 {
    js::math_max3(v[0], v[1], v[2]) - js::math_min3(v[0], v[1], v[2])
}

/// JS: detect-text.mjs#isNeutralAuthoredColor
pub fn is_neutral_authored_color(raw_color: &str) -> bool {
    let c = js::to_lower_case(js::trim(raw_color));
    if c.is_empty() {
        return false;
    }
    if NEUTRAL_COLOR_KEYWORDS.contains(&c.as_str()) {
        return true;
    }
    if RGB_PREFIX_RE.is_match(&c) {
        if let Some(m) = RGB_CHANNELS_RE.captures(&c) {
            let v = [num(&m[1]), num(&m[2]), num(&m[3])];
            return spread3(v) < 30.0;
        }
        return is_neutral_color(Some(&c));
    }
    if OTHER_FUNC_RE.is_match(&c) {
        return is_neutral_color(Some(&c));
    }
    if let Some(ch) = hex_channels(&c) {
        return spread3(ch) < 30.0;
    }
    false
}

re!(
    NEUTRAL_BORDER_RE,
    format!(
        "{solid}{WS}+((?:{rgb}[aA]?|{hsl}[aA]?|{oklch}|{oklab}|{lab}|{lch}|{hwb}|{color})\\([^)]*\\)|#[0-9a-fA-F]{{3,8}}{B}|[a-zA-Z]+)",
        solid = ci("solid"),
        rgb = ci("rgb"),
        hsl = ci("hsl"),
        oklch = ci("oklch"),
        oklab = ci("oklab"),
        lab = ci("lab"),
        lch = ci("lch"),
        hwb = ci("hwb"),
        color = ci("color")
    )
);
fn is_neutral_border_color(s: &str) -> bool {
    match NEUTRAL_BORDER_RE.captures(s) {
        Some(m) => is_neutral_authored_color(&m[1]),
        None => false,
    }
}

// ─── The matchers ────────────────────────────────────────────────────────────

re!(SIDE_TAB_TW_RE, format!("{B}border-[lrse]-({D}+){B}"));
re!(
    SIDE_TAB_CSS_RE,
    format!(
        "{}(?:{}|{}){WS}*:{WS}*({D}+){}{WS}+{}[^;]*",
        ci("border-"),
        ci("left"),
        ci("right"),
        ci("px"),
        ci("solid")
    )
);
re!(TRAILING_SEMI_RE, format!("{WS}*;?{WS}*$"));
re!(
    SIDE_TAB_WIDTH_RE,
    format!(
        "{}(?:{}|{}){}{WS}*:{WS}*({D}+){}",
        ci("border-"),
        ci("left"),
        ci("right"),
        ci("-width"),
        ci("px")
    )
);
re!(
    SIDE_TAB_INLINE_RE,
    format!(
        "{}(?:{}|{}){WS}*:{WS}*({D}+){}{WS}+{}",
        ci("border-inline-"),
        ci("start"),
        ci("end"),
        ci("px"),
        ci("solid")
    )
);
re!(
    SIDE_TAB_INLINE_WIDTH_RE,
    format!(
        "{}(?:{}|{}){}{WS}*:{WS}*({D}+){}",
        ci("border-inline-"),
        ci("start"),
        ci("end"),
        ci("-width"),
        ci("px")
    )
);
re!(
    SIDE_TAB_JS_RE,
    format!("border(?:Left|Right){WS}*[:=]{WS}*[\"'`]({D}+)px{WS}+solid")
);
re!(BORDER_ACCENT_TW_RE, format!("{B}border-[tb]-({D}+){B}"));
re!(
    BORDER_ACCENT_CSS_RE,
    format!(
        "{}(?:{}|{}){WS}*:{WS}*({D}+){}{WS}+{}",
        ci("border-"),
        ci("top"),
        ci("bottom"),
        ci("px"),
        ci("solid")
    )
);
static OVERUSED_FONT_RE: Lazy<Regex> = Lazy::new(|| {
    let names = [
        "Inter",
        "Roboto",
        "Open Sans",
        "Lato",
        "Montserrat",
        "Arial",
        "Helvetica",
        "Fraunces",
        "Geist Sans",
        "Geist Mono",
        "Geist",
        "Mona Sans",
        "Plus Jakarta Sans",
        "Space Grotesk",
        "Recoleta",
        "Instrument Sans",
        "Instrument Serif",
    ];
    let alts: Vec<String> = names.iter().map(|n| ci(n)).collect();
    Regex::new(&format!(
        "{}{WS}*:{WS}*['\"]?({}){B}",
        ci("font-family"),
        alts.join("|")
    ))
    .unwrap()
});
re!(
    GOOGLE_FONTS_URL_RE,
    format!(
        "{}\\.{}\\.{}/{}2?\\?[^\"'{ws})<>]*",
        ci("fonts"),
        ci("googleapis"),
        ci("com"),
        ci("css"),
        ws = WS_CHARS
    )
);
re!(
    GRADIENT_TEXT_RE,
    format!(
        "{bc}{WS}*:{WS}*{text}|{wbc}{WS}*:{WS}*{text}",
        bc = ci("background-clip"),
        wbc = ci("-webkit-background-clip"),
        text = ci("text")
    )
);
re!(GRADIENT_WORD_RE, ci("gradient"));
re!(BG_CLIP_TEXT_RE, format!("{B}bg-clip-text{B}"));
re!(BG_GRADIENT_TO_RE, format!("{B}{}", ci("bg-gradient-to-")));
re!(
    GRAY_TEXT_RE,
    format!("{B}text-(?:gray|slate|zinc|neutral|stone)-({D}+){B}")
);
re!(
    PURPLE_TEXT_RE,
    format!("{B}text-(?:purple|violet|indigo)-({D}+){B}")
);
re!(
    HEADING_CTX_RE,
    format!(
        "{B}{}(?:[2-9]{xl}|[3-9]{xl}){B}|<{h}[1-3]",
        ci("text-"),
        xl = ci("xl"),
        h = ci("h")
    )
);
re!(
    FROM_PURPLE_RE,
    format!("{B}from-(?:purple|violet|indigo)-({D}+){B}")
);
re!(
    TO_COLOR_RE,
    format!("{B}to-(?:purple|violet|indigo|blue|cyan|pink|fuchsia)-{D}+{B}")
);
re!(ANIMATE_BOUNCE_RE, format!("{B}animate-bounce{B}"));
re!(
    ANIMATION_BOUNCE_RE,
    format!(
        "{anim}(?:{name})?{WS}*:{WS}*([^;{{}}]*(?:{b}|{e}|{w}|{j}|{s})[^;{{}}]*)",
        anim = ci("animation"),
        name = ci("-name"),
        b = ci("bounce"),
        e = ci("elastic"),
        w = ci("wobble"),
        j = ci("jiggle"),
        s = ci("spring")
    )
);
re!(
    MOTION_TOKEN_RE,
    format!(
        "{}|{}|{}|{}|{}",
        ci("bounce"),
        ci("elastic"),
        ci("wobble"),
        ci("jiggle"),
        ci("spring")
    )
);
re!(COMMA_WS_SPLIT_RE, format!("[,{WS_CHARS}]+"));
re!(
    CUBIC_BEZIER_RE,
    format!("cubic-bezier\\({WS}*([0-9.-]+){WS}*,{WS}*([0-9.-]+){WS}*,{WS}*([0-9.-]+){WS}*,{WS}*([0-9.-]+){WS}*\\)")
);
re!(
    TRANSITION_PREFIX_RE,
    format!("{}{WS}*:{WS}*", ci("transition"))
);
re!(
    TRANSITION_PROPERTY_PREFIX_RE,
    format!("{}{WS}*:{WS}*", ci("transition-property"))
);
re!(ALL_WORD_RE, format!("{B}all{B}"));
re!(
    LAYOUT_PROP_RE,
    format!("{B}(?:(?:max|min)-)?(?:width|height){B}|{B}padding{B}|{B}margin{B}")
);
re!(
    LAYOUT_PROP_FMT_RE,
    format!(
        "{B}(?:(?:{max}|{min})-)?(?:{width}|{height}){B}|{B}{padding}(?:-(?:{top}|{right}|{bottom}|{left}))?{B}|{B}{margin}(?:-(?:{top}|{right}|{bottom}|{left}))?{B}",
        max = ci("max"),
        min = ci("min"),
        width = ci("width"),
        height = ci("height"),
        padding = ci("padding"),
        top = ci("top"),
        right = ci("right"),
        bottom = ci("bottom"),
        left = ci("left"),
        margin = ci("margin")
    )
);
re!(
    BROKEN_IMG_SRC_RE,
    format!(
        "<{img}{B}[^>]*?{B}{src}{WS}*={WS}*(?:\"\"|''|\"{WS}+\"|'{WS}+'|\"#\"|'#')",
        img = ci("img"),
        src = ci("src")
    )
);
re!(IMG_OPEN_RE, format!("<{}{B}", ci("img")));
re!(SRC_ATTR_RE, format!("{B}{}{WS}*=", ci("src")));

fn is_line_terminator(c: char) -> bool {
    matches!(c, '\n' | '\r' | '\u{2028}' | '\u{2029}')
}

/// Hand-written port of
/// `/PREFIX(?:(['"])((?:(?!\1)[^\\]|\\.)*)\1|([^;{}]+))/gi` (backreference):
/// groups are `[whole, quote?, quoted?, bare?]`.
fn find_transition_matches(prefix: &Regex, line: &str) -> Vec<MatchCtx> {
    let mut out = Vec::new();
    let mut pos = 0;
    while pos <= line.len() {
        let Some(m) = prefix.find_at(line, pos) else {
            break;
        };
        let value_start = m.end();
        let rest = &line[value_start..];
        let mut matched: Option<(usize, Vec<Option<String>>)> = None;
        if let Some(q) = rest.chars().next().filter(|c| *c == '\'' || *c == '"') {
            // Scan for the closing unescaped quote.
            let mut iter = rest.char_indices().skip(1).peekable();
            let mut end: Option<usize> = None;
            while let Some((i, c)) = iter.next() {
                if c == q {
                    end = Some(i);
                    break;
                }
                if c == '\\' {
                    match iter.peek() {
                        Some((_, n)) if !is_line_terminator(*n) => {
                            iter.next();
                        }
                        _ => break,
                    }
                }
            }
            if let Some(end) = end {
                let inner = &rest[q.len_utf8()..end];
                let whole_end = value_start + end + q.len_utf8();
                matched = Some((
                    whole_end,
                    vec![
                        Some(line[m.start()..whole_end].to_string()),
                        Some(q.to_string()),
                        Some(inner.to_string()),
                        None,
                    ],
                ));
            }
        }
        if matched.is_none() {
            let bare_len: usize = rest
                .char_indices()
                .find(|(_, c)| matches!(c, ';' | '{' | '}'))
                .map(|(i, _)| i)
                .unwrap_or(rest.len());
            if bare_len > 0 {
                let whole_end = value_start + bare_len;
                matched = Some((
                    whole_end,
                    vec![
                        Some(line[m.start()..whole_end].to_string()),
                        None,
                        None,
                        Some(rest[..bare_len].to_string()),
                    ],
                ));
            }
        }
        match matched {
            Some((end, groups)) => {
                out.push(MatchCtx {
                    groups,
                    index: m.start(),
                });
                pos = end;
            }
            None => {
                // The value part failed at this prefix; the engine moves on.
                pos = m.start() + 1;
                if pos > line.len() {
                    break;
                }
                // Advance to a char boundary.
                while pos < line.len() && !line.is_char_boundary(pos) {
                    pos += 1;
                }
            }
        }
    }
    out
}

fn transition_val(m: &MatchCtx) -> String {
    let raw = m
        .groups
        .get(2)
        .and_then(|g| g.clone())
        .or_else(|| m.groups.get(3).and_then(|g| g.clone()))
        .unwrap_or_default();
    raw
}

fn transition_test(m: &MatchCtx, _line: &str) -> bool {
    let val = js::to_lower_case(&transition_val(m));
    if ALL_WORD_RE.is_match(&val) {
        return false;
    }
    LAYOUT_PROP_RE.is_match(&val)
}

fn transition_fmt(prefix: &str, m: &MatchCtx) -> String {
    let raw = transition_val(m);
    let found: Vec<&str> = LAYOUT_PROP_FMT_RE
        .find_iter(&raw)
        .map(|x| x.as_str())
        .collect();
    if found.is_empty() {
        format!("{prefix}: {}", js::trim(&raw))
    } else {
        format!("{prefix}: {}", found.join(", "))
    }
}

/// Hand-written port of `/<img\b(?:(?!\bsrc\s*=)[^>])*>/gi`.
fn find_img_without_src(line: &str) -> Vec<MatchCtx> {
    let mut out = Vec::new();
    let mut pos = 0;
    while let Some(m) = IMG_OPEN_RE.find_at(line, pos) {
        let run_start = m.end();
        let gt = line[run_start..].find('>').map(|i| i + run_start);
        match gt {
            Some(gt) => {
                let has_src = SRC_ATTR_RE
                    .find_at(line, run_start)
                    .map(|s| s.start() < gt)
                    .unwrap_or(false);
                if has_src {
                    pos = m.end();
                    continue;
                }
                out.push(MatchCtx {
                    groups: vec![Some(line[m.start()..gt + 1].to_string())],
                    index: m.start(),
                });
                pos = gt + 1;
            }
            None => {
                pos = m.end();
            }
        }
    }
    out
}

pub static REGEX_MATCHERS: Lazy<Vec<Matcher>> = Lazy::new(|| {
    vec![
        Matcher {
            id: "side-tab",
            find_all: |l| all(&SIDE_TAB_TW_RE, l),
            test: |m, line| {
                let n = num(m.g(1));
                if has_rounded(line) {
                    n >= 2.0
                } else {
                    n >= 4.0
                }
            },
            fmt: |m, _| m.whole().to_string(),
        },
        Matcher {
            id: "side-tab",
            find_all: |l| all(&SIDE_TAB_CSS_RE, l),
            test: |m, line| {
                if is_safe_element(line) {
                    return false;
                }
                if is_neutral_border_color(m.whole()) {
                    return false;
                }
                let n = num(m.g(1));
                if has_border_radius(line) {
                    n >= 2.0
                } else {
                    n >= 3.0
                }
            },
            fmt: |m, _| TRAILING_SEMI_RE.replace(m.whole(), "").into_owned(),
        },
        Matcher {
            id: "side-tab",
            find_all: |l| all(&SIDE_TAB_WIDTH_RE, l),
            test: |m, line| !is_safe_element(line) && num(m.g(1)) >= 3.0,
            fmt: |m, _| m.whole().to_string(),
        },
        Matcher {
            id: "side-tab",
            find_all: |l| all(&SIDE_TAB_INLINE_RE, l),
            test: |m, line| !is_safe_element(line) && num(m.g(1)) >= 3.0,
            fmt: |m, _| m.whole().to_string(),
        },
        Matcher {
            id: "side-tab",
            find_all: |l| all(&SIDE_TAB_INLINE_WIDTH_RE, l),
            test: |m, line| !is_safe_element(line) && num(m.g(1)) >= 3.0,
            fmt: |m, _| m.whole().to_string(),
        },
        Matcher {
            id: "side-tab",
            find_all: |l| all(&SIDE_TAB_JS_RE, l),
            test: |m, _| num(m.g(1)) >= 3.0,
            fmt: |m, _| m.whole().to_string(),
        },
        Matcher {
            id: "border-accent-on-rounded",
            find_all: |l| all(&BORDER_ACCENT_TW_RE, l),
            test: |m, line| has_rounded(line) && num(m.g(1)) >= 1.0,
            fmt: |m, _| m.whole().to_string(),
        },
        Matcher {
            id: "border-accent-on-rounded",
            find_all: |l| all(&BORDER_ACCENT_CSS_RE, l),
            test: |m, line| num(m.g(1)) >= 3.0 && has_border_radius(line),
            fmt: |m, _| m.whole().to_string(),
        },
        Matcher {
            id: "overused-font",
            find_all: |l| all(&OVERUSED_FONT_RE, l),
            test: |_, _| true,
            fmt: |m, _| m.whole().to_string(),
        },
        Matcher {
            id: "overused-font",
            find_all: |l| all(&GOOGLE_FONTS_URL_RE, l),
            test: |m, _| !first_overused_google_font(m.whole()).is_empty(),
            fmt: |m, _| format!("Google Fonts: {}", first_overused_google_font(m.whole())),
        },
        Matcher {
            id: "gradient-text",
            find_all: |l| all(&GRADIENT_TEXT_RE, l),
            test: |_, line| GRADIENT_WORD_RE.is_match(line),
            fmt: |_, _| "background-clip: text + gradient".to_string(),
        },
        Matcher {
            id: "gradient-text",
            find_all: |l| all(&BG_CLIP_TEXT_RE, l),
            test: |_, line| BG_GRADIENT_TO_RE.is_match(line),
            fmt: |_, _| "bg-clip-text + bg-gradient".to_string(),
        },
        Matcher {
            id: "gray-on-color",
            find_all: |l| all(&GRAY_TEXT_RE, l),
            test: |m, line| {
                gray_on_color_pairs(line, m.whole(), m.index)
                    .iter()
                    .any(|scope| find_solid_chromatic_bg(scope).is_some())
            },
            fmt: |m, line| {
                let pairs = gray_on_color_pairs(line, m.whole(), m.index);
                let bg = pairs
                    .iter()
                    .find_map(|scope| find_solid_chromatic_bg(scope))
                    .unwrap_or("?");
                format!("{} on {}", m.whole(), bg)
            },
        },
        Matcher {
            id: "ai-color-palette",
            find_all: |l| all(&PURPLE_TEXT_RE, l),
            test: |_, line| HEADING_CTX_RE.is_match(line),
            fmt: |m, _| format!("{} on heading", m.whole()),
        },
        Matcher {
            id: "ai-color-palette",
            find_all: |l| all(&FROM_PURPLE_RE, l),
            test: |_, line| TO_COLOR_RE.is_match(line),
            fmt: |m, _| format!("{} gradient", m.whole()),
        },
        Matcher {
            id: "bounce-easing",
            find_all: |l| all(&ANIMATE_BOUNCE_RE, l),
            test: |_, _| true,
            fmt: |_, _| "animate-bounce (Tailwind)".to_string(),
        },
        Matcher {
            id: "bounce-easing",
            find_all: |l| all(&ANIMATION_BOUNCE_RE, l),
            test: |_, _| true,
            fmt: |m, _| {
                let token = COMMA_WS_SPLIT_RE
                    .split(m.g(1))
                    .find(|part| MOTION_TOKEN_RE.is_match(part));
                match token {
                    Some(t) => format!("animation: {t}"),
                    None => format!("animation: {}", js::trim(m.g(1))),
                }
            },
        },
        Matcher {
            id: "bounce-easing",
            find_all: |l| all(&CUBIC_BEZIER_RE, l),
            test: |m, _| {
                let y1 = parse_float(m.g(2));
                let y2 = parse_float(m.g(4));
                y1 < -0.1 || y1 > 1.1 || y2 < -0.1 || y2 > 1.1
            },
            fmt: |m, _| {
                format!(
                    "cubic-bezier({}, {}, {}, {})",
                    m.g(1),
                    m.g(2),
                    m.g(3),
                    m.g(4)
                )
            },
        },
        Matcher {
            id: "layout-transition",
            find_all: |l| find_transition_matches(&TRANSITION_PREFIX_RE, l),
            test: transition_test,
            fmt: |m, _| transition_fmt("transition", m),
        },
        Matcher {
            id: "layout-transition",
            find_all: |l| find_transition_matches(&TRANSITION_PROPERTY_PREFIX_RE, l),
            test: transition_test,
            fmt: |m, _| transition_fmt("transition-property", m),
        },
        Matcher {
            id: "broken-image",
            find_all: |l| all(&BROKEN_IMG_SRC_RE, l),
            test: |_, _| true,
            fmt: |m, _| slice_utf16_start(m.whole(), 100),
        },
        Matcher {
            id: "broken-image",
            find_all: find_img_without_src,
            test: |m, _| !SRC_ATTR_RE.is_match(m.whole()),
            fmt: |m, _| slice_utf16_start(m.whole(), 100),
        },
    ]
});

// ─── Page analyzers ──────────────────────────────────────────────────────────

re!(
    SCRIPT_BLOCK_RE,
    format!("<{s}{B}[^>]*>{ANY}*?</{s}>", s = ci("script"))
);
re!(
    STYLE_BLOCK_RE,
    format!("<{s}{B}[^>]*>{ANY}*?</{s}>", s = ci("style"))
);
re!(HTML_COMMENT_RE, format!("<!--{ANY}*?-->"));
re!(TAG_RE, "<[^>]+>");
re!(WS_RUN_RE, format!("{WS}+"));

/// JS: detect-text.mjs#stripHtmlToText
pub fn strip_html_to_text(html: &str) -> String {
    let s = SCRIPT_BLOCK_RE.replace_all(html, " ");
    let s = STYLE_BLOCK_RE.replace_all(&s, " ");
    let s = HTML_COMMENT_RE.replace_all(&s, " ");
    let s = TAG_RE.replace_all(&s, " ");
    WS_RUN_RE.replace_all(&s, " ").into_owned()
}

/// JS `text.slice(start, end)` in UTF-16 units.
fn utf16_slice(s: &str, start: usize, end: usize) -> String {
    let b0 = advance_utf16(s, 0, start);
    let b1 = advance_utf16(s, 0, end.max(start));
    s[b0..b1].to_string()
}

pub type Analyzer = fn(&str, &str) -> Vec<Finding>;

fn same_value_zero(a: f64, b: f64) -> bool {
    (a.is_nan() && b.is_nan()) || a == b
}

fn set_add(set: &mut Vec<f64>, v: f64) {
    if !set.iter().any(|x| same_value_zero(*x, v)) {
        set.push(v);
    }
}


re!(
    SPACING_PX_RE,
    format!(
        "(?:{p}|{m})(?:-(?:{top}|{right}|{bottom}|{left}))?{WS}*:{WS}*({D}+){px}",
        p = ci("padding"),
        m = ci("margin"),
        top = ci("top"),
        right = ci("right"),
        bottom = ci("bottom"),
        left = ci("left"),
        px = ci("px")
    )
);
re!(
    SPACING_REM_RE,
    format!(
        "(?:{p}|{m})(?:-(?:{top}|{right}|{bottom}|{left}))?{WS}*:{WS}*([0-9.]+){rem}",
        p = ci("padding"),
        m = ci("margin"),
        top = ci("top"),
        right = ci("right"),
        bottom = ci("bottom"),
        left = ci("left"),
        rem = ci("rem")
    )
);
re!(
    GAP_RE,
    format!("{}{WS}*:{WS}*({D}+){}", ci("gap"), ci("px"))
);
re!(
    TW_SPACING_RE,
    format!("{B}(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap)-({D}+){B}")
);

fn is_array_index_key(key: &str) -> bool {
    // A canonical non-negative integer string below 2^32 - 1.
    if key.is_empty() || key.len() > 10 || !key.bytes().all(|b| b.is_ascii_digit()) {
        return false;
    }
    if key.len() > 1 && key.starts_with('0') {
        return false;
    }
    key.parse::<u64>().map(|v| v < 4294967295).unwrap_or(false)
}

fn analyze_monotonous_spacing(content: &str, file_path: &str) -> Vec<Finding> {
    let mut vals: Vec<f64> = Vec::new();
    for m in SPACING_PX_RE.captures_iter(content) {
        let v = num(&m[1]);
        if v > 0.0 && v < 200.0 {
            vals.push(v);
        }
    }
    for m in SPACING_REM_RE.captures_iter(content) {
        let v = math_round(parse_float(&m[1]) * 16.0);
        if v > 0.0 && v < 200.0 {
            vals.push(v);
        }
    }
    for m in GAP_RE.captures_iter(content) {
        vals.push(num(&m[1]));
    }
    for m in TW_SPACING_RE.captures_iter(content) {
        vals.push(num(&m[1]) * 4.0);
    }
    let rounded: Vec<f64> = vals.iter().map(|v| math_round(v / 4.0) * 4.0).collect();
    if rounded.len() < 10 {
        return vec![];
    }
    // JS object keyed by number: integer keys enumerate ascending first,
    // other keys in insertion order.
    let mut counts: Vec<(String, f64)> = Vec::new();
    for v in &rounded {
        let key = number_to_string(*v);
        if let Some(slot) = counts.iter_mut().find(|(k, _)| *k == key) {
            slot.1 += 1.0;
        } else {
            counts.push((key, 1.0));
        }
    }
    let max_count = counts
        .iter()
        .map(|(_, c)| *c)
        .fold(f64::NEG_INFINITY, f64::max);
    let pct = max_count / rounded.len() as f64;
    let mut unique: Vec<f64> = Vec::new();
    for v in &rounded {
        set_add(&mut unique, *v);
    }
    let unique: Vec<f64> = unique.into_iter().filter(|v| *v > 0.0).collect();
    if pct <= 0.6 || unique.len() > 3 {
        return vec![];
    }
    let mut ordered: Vec<(String, f64)> = Vec::new();
    let mut ints: Vec<(String, f64)> = counts
        .iter()
        .filter(|(k, _)| is_array_index_key(k))
        .cloned()
        .collect();
    ints.sort_by(|a, b| {
        a.0.parse::<u64>()
            .unwrap()
            .cmp(&b.0.parse::<u64>().unwrap())
    });
    ordered.extend(ints);
    ordered.extend(
        counts
            .iter()
            .filter(|(k, _)| !is_array_index_key(k))
            .cloned(),
    );
    ordered.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    let dominant = ordered[0].0.clone();
    vec![finding(
        "monotonous-spacing",
        file_path,
        &format!(
            "~{dominant}px used {}/{} times ({}%)",
            number_to_string(max_count),
            rounded.len(),
            number_to_string(math_round(pct * 100.0))
        ),
        0.0,
    )]
}

re!(
    EM_DASH_ENTITY_RE,
    format!("&{mdash};|&#0*8212;|&#[xX]0*2014;", mdash = ci("mdash"))
);

fn count_em_dashes(text: &str) -> usize {
    let mut count = 0;
    let mut chars = text.char_indices().peekable();
    while let Some((i, c)) = chars.next() {
        if c == '\u{2014}' {
            count += 1;
            continue;
        }
        if c == '-' {
            if let Some((_, '-')) = chars.peek().copied() {
                // `--(?=\S)`: the char after the pair must exist and be non-ws.
                let after = text[i + 2..].chars().next();
                if let Some(a) = after {
                    if !js::is_js_whitespace(a) {
                        count += 1;
                        chars.next();
                    }
                }
            }
        }
    }
    count
}

fn analyze_em_dash_overuse(content: &str, file_path: &str) -> Vec<Finding> {
    let text = EM_DASH_ENTITY_RE
        .replace_all(&strip_html_to_text(content), "\u{2014}")
        .into_owned();
    let count = count_em_dashes(&text);
    if count < EM_DASH_FLOOR {
        return vec![];
    }
    if utf16_length(&text) > count * EM_DASH_CHARS_PER_DASH {
        return vec![];
    }
    vec![finding(
        "em-dash-overuse",
        file_path,
        &format!("{count} em-dashes in body text"),
        0.0,
    )]
}

const BUZZWORDS: &[&str] = &[
    "streamline your",
    "empower your",
    "supercharge your",
    "unleash your",
    "unleash the power",
    "leverage the power",
    "built for the modern",
    "trusted by leading",
    "trusted by the world",
    "best-in-class",
    "industry-leading",
    "world-class",
    "enterprise-grade",
    "next-generation",
    "cutting-edge",
    "transform your business",
    "revolutionize",
    "game-changer",
    "game changing",
    "mission-critical",
    "best of breed",
    "future-proof",
    "future proof",
    "seamless experience",
    "seamlessly integrate",
    "drive engagement",
    "drive growth",
    "drive results",
    "harness the power",
];

fn analyze_marketing_buzzword(content: &str, file_path: &str) -> Vec<Finding> {
    let text = strip_html_to_text(content);
    let lower = js::to_lower_case(&text);
    let text_len = utf16_length(&text);
    let mut count = 0usize;
    let mut first_sample = String::new();
    for phrase in BUZZWORDS {
        let mut from = 0usize; // UTF-16 index into `lower`
        loop {
            let from_b = advance_utf16(&lower, 0, from);
            let Some(rel) = lower[from_b..].find(phrase) else {
                break;
            };
            let idx = utf16_index(&lower, from_b + rel);
            count += 1;
            if first_sample.is_empty() {
                let plen = utf16_length(phrase);
                let start = idx.saturating_sub(12);
                let end = (idx + plen + 12).min(text_len);
                first_sample = js::trim(&utf16_slice(&text, start, end)).to_string();
            }
            from = idx + utf16_length(phrase);
        }
    }
    if count == 0 {
        return vec![];
    }
    vec![finding(
        "marketing-buzzword",
        file_path,
        &format!(
            "{count} buzzword phrase{}: \"{first_sample}\"",
            if count == 1 { "" } else { "s" }
        ),
        0.0,
    )]
}

re!(
    NOT_A_RE,
    format!("{B}Not an? [a-z][^.!?]{{1,40}}[.!]{WS}+[A-Z][^.!?]{{1,60}}[.!]")
);
re!(
    SHORT_REBUTTAL_RE,
    format!("{B}[A-Z][^.!?]{{4,80}}[.!]{WS}+(No|Just){WS}+[a-z][^.!?]{{2,60}}[.!]")
);

fn analyze_aphoristic_cadence(content: &str, file_path: &str) -> Vec<Finding> {
    let text = strip_html_to_text(content);
    let mut count = 0usize;
    let mut first_sample = String::new();
    for m in NOT_A_RE.find_iter(&text) {
        count += 1;
        if first_sample.is_empty() {
            first_sample = slice_utf16_start(js::trim(m.as_str()), 80);
        }
    }
    for m in SHORT_REBUTTAL_RE.find_iter(&text) {
        count += 1;
        if first_sample.is_empty() {
            first_sample = slice_utf16_start(js::trim(m.as_str()), 80);
        }
    }
    if count < 3 {
        return vec![];
    }
    vec![finding(
        "aphoristic-cadence",
        file_path,
        &format!("{count} aphoristic constructions: \"{first_sample}\""),
        0.0,
    )]
}

fn analyze_dark_glow(content: &str, file_path: &str) -> Vec<Finding> {
    let hits = scan_css_text_for_glow(content);
    let Some(first) = hits.first() else {
        return vec![];
    };
    vec![finding(
        "dark-glow",
        file_path,
        &first.snippet,
        line_of_offset(content, first.index) as f64,
    )]
}

fn analyze_radial_halo(content: &str, file_path: &str) -> Vec<Finding> {
    let hits = scan_css_text_for_radial_halo(content);
    let Some(first) = hits.first() else {
        return vec![];
    };
    vec![finding(
        "radial-halo",
        file_path,
        &first.snippet,
        line_of_offset(content, first.index) as f64,
    )]
}

fn analyze_marquee(content: &str, file_path: &str) -> Vec<Finding> {
    scan_css_text_for_marquee(content, None)
        .into_iter()
        .map(|hit| finding("marquee", file_path, &hit.snippet, 0.0))
        .collect()
}

/// JS `REGEX_ANALYZERS` in order.
pub const REGEX_ANALYZERS: &[Analyzer] = &[
    analyze_monotonous_spacing,
    analyze_em_dash_overuse,
    analyze_marketing_buzzword,
    analyze_aphoristic_cadence,
    analyze_dark_glow,
    analyze_radial_halo,
    analyze_marquee,
];

/// JS `TEXT_CONTENT_ANALYZER_IDS`.
pub const TEXT_CONTENT_ANALYZER_IDS: &[&str] = &[
    "em-dash-overuse",
    "marketing-buzzword",
    "aphoristic-cadence",
];

/// The ruleIds the JS assigns to analyzers by index (`analyzerIds[i] || analyzer-${i+1}`).
pub fn analyzer_rule_id(i: usize) -> String {
    const IDS: &[&str] = &[
        "monotonous-spacing",
        "em-dash-overuse",
        "marketing-buzzword",
        "aphoristic-cadence",
        "dark-glow",
    ];
    IDS.get(i)
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("analyzer-{}", i + 1))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(id: &str, line: &str) -> Vec<String> {
        let mut out = vec![];
        for m in REGEX_MATCHERS.iter().filter(|m| m.id == id) {
            for c in (m.find_all)(line) {
                if (m.test)(&c, line) {
                    out.push((m.fmt)(&c, line));
                }
            }
        }
        out
    }

    /// Cases recorded from origin/main's JS after #707; every expectation
    /// here was produced by running `impeccable detect` on both engines.
    #[test]
    fn gray_on_color_scoping() {
        let g = |line: &str| run("gray-on-color", line);
        // A `/10` opacity tint is not a solid fill.
        assert!(g(r#"<button className="text-slate-300 hover:bg-red-500/10 hover:text-red-400">Log out</button>"#).is_empty());
        assert!(g(r#"<button className="text-slate-300 bg-red-500/10">Log out</button>"#).is_empty());
        assert_eq!(
            g(r#"<button className="text-slate-300 bg-red-500">Log out</button>"#),
            vec!["text-slate-300 on bg-red-500"]
        );
        // Exclusive ternary arms never pair with each other.
        assert!(g(r#"<button className={`px-4 py-2 text-sm rounded-lg transition-colors ${mode === "a" ? "bg-amber-600 text-white" : "bg-white/5 text-slate-400 hover:bg-white/10"}`}>Mode</button>"#).is_empty());
        assert!(g(r#"<button className={mode > 0 ? "bg-amber-600 text-white" : "text-slate-400"}>Mode</button>"#).is_empty());
        assert!(g(r#"<div className={a ? "bg-red-500" : b ? "text-slate-400" : "bg-blue-600"} />"#).is_empty());
        assert!(g(r#"<div className={value ?? fallback ? "bg-red-500" : "text-slate-400"} />"#).is_empty());
        // Sibling tags on one line are separate scopes.
        assert!(g(r#"<div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-amber-500" /><span className="text-slate-400">Vital few</span></div>"#).is_empty());
        // Simultaneous arguments, a common prefix, and a shared suffix pair.
        assert_eq!(
            g(r#"<button className={cn("text-slate-400", "bg-blue-600")}>Go</button>"#),
            vec!["text-slate-400 on bg-blue-600"]
        );
        assert_eq!(
            g(r#"<button className={cn("text-slate-400", mode === "a" ? "bg-amber-600" : "bg-white")}>Go</button>"#),
            vec!["text-slate-400 on bg-amber-600"]
        );
        assert_eq!(
            g(r#"<div className={cn(a ? "bg-red-500" : "bg-blue-600", "text-slate-400")} />"#),
            vec!["text-slate-400 on bg-red-500"]
        );
    }

    #[test]
    fn matchers() {
        assert_eq!(
            run("side-tab", ".c { border-left: 4px solid #6366f1; }"),
            vec!["border-left: 4px solid #6366f1"]
        );
        assert!(run("side-tab", ".c { border-left: 4px solid #000; }").is_empty());
        assert_eq!(
            run("layout-transition", "transition: width 0.3s"),
            vec!["transition: width"]
        );
        assert_eq!(
            run("layout-transition", "transition: 'height 1s'"),
            vec!["transition: height"]
        );
        assert!(run("layout-transition", "transition: all 1s").is_empty());
        assert_eq!(run("broken-image", "<img alt=x>"), vec!["<img alt=x>"]);
        assert!(run("broken-image", "<img src=\"a.png\">").is_empty());
        assert_eq!(
            run("bounce-easing", "cubic-bezier(0.68, -0.55, 0.265, 1.55)"),
            vec!["cubic-bezier(0.68, -0.55, 0.265, 1.55)"]
        );
    }

    #[test]
    fn dashes() {
        assert_eq!(count_em_dashes("a — b -- c ---d"), 2);
        assert_eq!(count_em_dashes("a -- "), 0);
    }
}
