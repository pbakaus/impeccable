//! Stylesheet-text helpers: the parsing, indexing and keyframe-collection
//! utilities that read raw CSS (no DOM), plus the finding shapes the scanners
//! return. The scanners themselves live in the detector.

use crate::js::{self, ci, math_max, math_min, parse_float, WS, WS_CHARS};
use crate::js_ext_a::{
    is_word_byte, last_index_of_byte, split_commas_outside_parens, split_ws, JsMap,
};
use crate::rules::types::{ANY, B};
use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};

macro_rules! re {
    ($name:ident, $pat:expr) => {
        static $name: Lazy<Regex> = Lazy::new(|| Regex::new(&$pat).expect(stringify!($name)));
    };
}

/// A CSS custom-property map (`--name` -> raw value), first declaration wins.
pub type CustomProps = JsMap<String>;

/// A declaration block map (`prop` -> value), last declaration wins.
pub type DeclMap = JsMap<String>;

/// A `{ index, snippet }` hit; `index` is a byte offset into the scanned text.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IndexedHit {
    pub index: usize,
    pub snippet: String,
}

/// A rule-block finding: `{ id, snippet, index?, selector?, severity? }`.
/// Fields the JS leaves off a given finding are `None`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PatternFinding {
    pub id: String,
    pub snippet: String,
    pub selector: Option<String>,
    /// Byte offset into the scanned CSS text.
    pub index: Option<usize>,
    pub severity: Option<String>,
}

fn u8_at(s: &str, i: usize) -> Option<u8> {
    s.as_bytes().get(i).copied()
}

// ─── collectCssCustomProps ──────────────────────────────────────────────────
re!(
    CUSTOM_PROP_RE,
    format!(r"(--[A-Za-z0-9_-]+){WS}*:{WS}*([^;{{}}]+)")
);

/// JS: checks.mjs#collectCssCustomProps
pub fn collect_css_custom_props(content: &str) -> CustomProps {
    let mut map = JsMap::new();
    for m in CUSTOM_PROP_RE.captures_iter(content) {
        let name = &m[1];
        if !map.has(name) {
            map.set(name, js::trim(&m[2]).to_string());
        }
    }
    map
}

// ─── enclosingCssSelector ───────────────────────────────────────────────────
re!(WS_RUN_RE, format!(r"{WS}+"));

re!(SELECTOR_COMMENT_RE, format!(r"/\*{ANY}*?\*/"));

re!(
    KEYFRAME_STEP_RE,
    format!(
        r"^(?:{from}|{to})(?:{WS}*,{WS}*(?:{from}|{to}))*$",
        from = ci("from"),
        to = ci("to")
    )
);

/// JS: checks.mjs#enclosingCssSelector. `index` is a byte offset into
/// `css_text` (JS passes a UTF-16 index; callers here convert).
pub fn enclosing_css_selector(css_text: &str, index: usize) -> Option<String> {
    if css_text.is_empty() {
        return None;
    }
    let open = last_index_of_byte(css_text, b'{', index)?;
    // A match inside an inline style fragment (`style="…"` appended to the
    // corpus by buildHtmlPatternCorpora) has no enclosing rule; the previous
    // `{` belongs to some other selector.
    if let Some(close_before_index) = last_index_of_byte(css_text, b'}', index) {
        if close_before_index > open {
            return None;
        }
    }
    let from = open.saturating_sub(1);
    let prev_close = match (
        last_index_of_byte(css_text, b'}', from),
        last_index_of_byte(css_text, b';', from),
    ) {
        (Some(a), Some(b)) => Some(a.max(b)),
        (Some(a), None) => Some(a),
        (None, Some(b)) => Some(b),
        (None, None) => None,
    };
    // JS: `lastIndexOf('}', open - 1)` with open == 0 clamps to index 0.
    let prev_close = if open == 0 { None } else { prev_close };
    let slice_start = prev_close.map(|p| p + 1).unwrap_or(0);
    let no_comments = SELECTOR_COMMENT_RE.replace_all(&css_text[slice_start..open], "");
    let raw_trim = js::trim(&no_comments);
    let raw = WS_RUN_RE.replace_all(raw_trim, " ").into_owned();
    if raw.is_empty()
        || raw.starts_with('@')
        || raw.as_bytes()[0].is_ascii_digit()
        || raw.bytes().any(|b| b == b'{' || b == b'}' || b == b'<')
    {
        return None;
    }
    if KEYFRAME_STEP_RE.is_match(&raw) {
        return None;
    }
    Some(raw)
}

// ─── Rule-block helpers ─────────────────────────────────────────────────────

/// JS `CSS_RULE_BLOCK_SOURCE`: `selector { declarations }` pairs; the block
/// body excludes braces so nested structures yield their innermost rules.
pub const CSS_RULE_BLOCK_SOURCE: &str = r"([^{};]+)\{([^{}]*)\}";

re!(
    IMPORTANT_TAIL_RE,
    format!(r"{WS}*!{}{WS}*$", ci("important"))
);

/// JS: checks.mjs#parseCssDeclBlock
pub fn parse_css_decl_block(block: &str) -> DeclMap {
    let mut decls = JsMap::new();
    for part in block.split(';') {
        let idx = match part.find(':') {
            Some(i) if i > 0 => i,
            _ => continue,
        };
        let prop = js::to_lower_case(js::trim(&part[..idx]));
        let value_raw = IMPORTANT_TAIL_RE.replace(&part[idx + 1..], "");
        let value = js::trim(&value_raw);
        if !prop.is_empty() && !value.is_empty() {
            decls.set(&prop, value.to_string());
        }
    }
    decls
}

re!(
    CSS_LENGTH_RE,
    format!(
        r"^(-?[0-9.]+)({px}|{rem}|{em})$",
        px = ci("px"),
        rem = ci("rem"),
        em = ci("em")
    )
);

/// JS: checks.mjs#cssLengthToPx
pub fn css_length_to_px(value: &str) -> Option<f64> {
    let m = CSS_LENGTH_RE.captures(js::trim(value))?;
    let n = parse_float(&m[1]);
    if m[2].eq_ignore_ascii_case("px") {
        Some(n)
    } else {
        Some(n * 16.0)
    }
}

re!(ZERO_OFFSET_RE, r"^-?0(?:px|%|rem|em)?$".to_string());

/// JS: checks.mjs#isZeroOffset
pub fn is_zero_offset(value: Option<&str>) -> bool {
    match value {
        None => false,
        Some(v) => ZERO_OFFSET_RE.is_match(js::trim(v)),
    }
}

/// A byte that continues an identifier-ish CSS token (`[A-Za-z0-9_-]`).
pub fn is_word_or_dash(b: u8) -> bool {
    is_word_byte(b) || b == b'-'
}

// ─── Keyframes ──────────────────────────────────────────────────────────────
re!(
    KEYFRAMES_RE,
    format!(r"@(?:-webkit-)?keyframes{WS}+([A-Za-z0-9_-]+){WS}*\{{")
);

/// Walk from `from` (just past an opening brace) to the matching close;
/// returns (byte position after the close or the text end, closed?).
fn scan_brace_block(content: &str, from: usize) -> (usize, bool) {
    let bytes = content.as_bytes();
    let mut depth: i64 = 1;
    let mut i = from;
    while i < bytes.len() && depth > 0 {
        if bytes[i] == b'{' {
            depth += 1;
        } else if bytes[i] == b'}' {
            depth -= 1;
        }
        i += 1;
    }
    (i, depth == 0)
}

/// JS `content.slice(re.lastIndex, Math.max(re.lastIndex, i - 1))` for a
/// keyframes body: the text between the braces, or (unterminated) all but
/// the last code unit.
fn brace_body(content: &str, from: usize, i: usize, closed: bool) -> &str {
    let mut e = i;
    if closed {
        e = i - 1;
    } else if e > 0 {
        // JS-PARITY: drops one UTF-16 unit; a lone surrogate half cannot be
        // represented, so an astral final char is dropped whole.
        e -= 1;
        while !content.is_char_boundary(e) {
            e -= 1;
        }
    }
    &content[from..e.max(from)]
}

re!(
    TRANSLATE_X_PCT_RE,
    format!(
        r"{B}{translate}(?:[xX]|3[dD])?\({WS}*(-?[0-9.]+)%",
        translate = ci("translate")
    )
);

re!(
    SCALE_OR_OPACITY_RE,
    format!(
        r"{B}{scale}\(|{B}{opacity}{WS}*:",
        scale = ci("scale"),
        opacity = ci("opacity")
    )
);

/// JS: checks.mjs#collectMarqueeKeyframes (a Set, in insertion order)
pub fn collect_marquee_keyframes(content: &str) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    let mut pos = 0usize;
    while let Some(m) = KEYFRAMES_RE.captures_at(content, pos) {
        let after = m.get(0).unwrap().end();
        let (i, closed) = scan_brace_block(content, after);
        let body = brace_body(content, after, i, closed);
        pos = i;
        let pct: Vec<f64> = TRANSLATE_X_PCT_RE
            .captures_iter(body)
            .map(|xm| parse_float(&xm[1]))
            .collect();
        if pct.is_empty() {
            continue;
        }
        if pct.len() == 1 && SCALE_OR_OPACITY_RE.is_match(body) {
            continue;
        }
        let travel_pct = if pct.len() > 1 {
            let mut mx = f64::NEG_INFINITY;
            let mut mn = f64::INFINITY;
            for &p in &pct {
                mx = math_max(mx, p);
                mn = math_min(mn, p);
            }
            mx - mn
        } else {
            pct[0].abs()
        };
        if travel_pct >= 20.0 {
            let name = m[1].to_string();
            if !names.contains(&name) {
                names.push(name);
            }
        }
    }
    names
}

re!(OPACITY_DECL_RE, format!(r"{B}{}{WS}*:", ci("opacity")));

re!(
    BOX_SHADOW_DECL_RE,
    format!(r"{B}{}{WS}*:", ci("box-shadow"))
);

re!(
    TRANSFORM_SCALE_RE,
    format!(
        r"{B}{transform}{WS}*:[^;{{}}]*{B}{scale}",
        transform = ci("transform"),
        scale = ci("scale")
    )
);

/// JS: checks.mjs#collectPulseKeyframes (Map name -> pulses?)
pub fn collect_pulse_keyframes(content: &str) -> JsMap<bool> {
    let mut map: JsMap<bool> = JsMap::new();
    let mut pos = 0usize;
    while let Some(m) = KEYFRAMES_RE.captures_at(content, pos) {
        let after = m.get(0).unwrap().end();
        let (i, closed) = scan_brace_block(content, after);
        let body = brace_body(content, after, i, closed);
        let pulses = OPACITY_DECL_RE.is_match(body)
            || BOX_SHADOW_DECL_RE.is_match(body)
            || TRANSFORM_SCALE_RE.is_match(body);
        let name = &m[1];
        if !map.has(name) || pulses {
            map.set(name, pulses);
        }
        pos = i;
    }
    map
}

/// JS `ANIMATION_VALUE_KEYWORDS`.
pub const ANIMATION_VALUE_KEYWORDS: &[&str] = &[
    "ease",
    "ease-in",
    "ease-out",
    "ease-in-out",
    "linear",
    "infinite",
    "alternate",
    "alternate-reverse",
    "normal",
    "reverse",
    "none",
    "forwards",
    "backwards",
    "both",
    "running",
    "paused",
    "step-start",
    "step-end",
    "inherit",
    "initial",
    "unset",
];

re!(INFINITE_RE, format!(r"{B}{}{B}", ci("infinite")));

re!(IDENT_RE, r"^[a-zA-Z_-][A-Za-z0-9_-]*$".to_string());

/// JS: checks.mjs#infiniteAnimationNames
pub fn infinite_animation_names(decls: &DeclMap) -> Vec<String> {
    let mut out = Vec::new();
    if let Some(shorthand) = decls.get("animation").filter(|s| !s.is_empty()) {
        for layer in split_commas_outside_parens(shorthand) {
            if !INFINITE_RE.is_match(layer) {
                continue;
            }
            let name = split_ws(layer).into_iter().find(|t| {
                IDENT_RE.is_match(t)
                    && !ANIMATION_VALUE_KEYWORDS.contains(&js::to_lower_case(t).as_str())
            });
            if let Some(n) = name {
                out.push(n.to_string());
            }
        }
    }
    if let Some(name_decl) = decls.get("animation-name").filter(|s| !s.is_empty()) {
        let count = decls
            .get("animation-iteration-count")
            .map(|s| s.as_str())
            .unwrap_or("");
        if INFINITE_RE.is_match(count) {
            for raw in name_decl.split(',') {
                let t = js::trim(raw);
                if !t.is_empty() && js::to_lower_case(t) != "none" {
                    out.push(t.to_string());
                }
            }
        }
    }
    out
}

re!(
    REDUCED_MOTION_RE,
    format!(
        r"@{media}[^{{]*{prm}{WS}*:{WS}*{reduce}[^{{]*\{{",
        media = ci("media"),
        prm = ci("prefers-reduced-motion"),
        reduce = ci("reduce")
    )
);

/// JS: checks.mjs#stripReducedMotionBlocks
pub fn strip_reduced_motion_blocks(content: &str) -> String {
    let mut out = String::new();
    let mut last = 0usize;
    let mut pos = 0usize;
    while let Some(m) = REDUCED_MOTION_RE.find_at(content, pos) {
        let (i, _) = scan_brace_block(content, m.end());
        out.push_str(&content[last..m.start()]);
        last = i;
        pos = i;
    }
    out.push_str(&content[last..]);
    out
}

/// JS: checks.mjs#landmarkSourceRanges (byte offsets)
pub fn landmark_source_ranges(content: &str) -> Vec<(usize, usize)> {
    let mut ranges = Vec::new();
    for tag in ["header", "nav"] {
        let re = Regex::new(&format!(r"<{t}{B}|</{t}{WS}*>", t = ci(tag))).expect("landmark re");
        let mut stack: Vec<usize> = Vec::new();
        for m in re.find_iter(content) {
            if m.as_str().as_bytes()[1] == b'/' {
                if let Some(start) = stack.pop() {
                    ranges.push((start, m.start()));
                }
            } else {
                stack.push(m.start());
            }
        }
    }
    ranges
}

/// JS: checks.mjs#indexInSourceRanges
pub fn index_in_source_ranges(index: usize, ranges: &[(usize, usize)]) -> bool {
    ranges
        .iter()
        .any(|(start, end)| index >= *start && index < *end)
}

re!(SELECTOR_COMBINATOR_RE, format!(r"[{WS_CHARS}>+~]+"));

re!(ID_TOKEN_RE, r"#([A-Za-z_][A-Za-z0-9_-]*)".to_string());

re!(CLASS_TOKEN_RE, r"\.([A-Za-z_][A-Za-z0-9_-]*)".to_string());

/// Iterate JS `/<[a-zA-Z][^>]*\b<attr>\s*=\s*["']…["']/gi` matches. With
/// `exact` the value must equal `needle` (ASCII case-insensitive); otherwise
/// the value is the run of non-quote chars and must contain `needle` as a
/// `[\w-]`-delimited token. Yields match start offsets in scan order,
/// advancing past each match the way `lastIndex` does.
fn attr_tag_match_starts(content: &str, attr: &str, needle: &str, exact: bool) -> Vec<usize> {
    let bytes = content.as_bytes();
    let n = bytes.len();
    let mut starts = Vec::new();
    let mut pos = 0usize;
    let is_quote = |b: u8| b == b'"' || b == b'\'';
    while pos < n {
        // Next `<` followed by an ASCII letter.
        let start = match (pos..n)
            .find(|&i| bytes[i] == b'<' && i + 1 < n && bytes[i + 1].is_ascii_alphabetic())
        {
            Some(s) => s,
            None => break,
        };
        let tag_end = (start + 1..n).find(|&i| bytes[i] == b'>').unwrap_or(n);
        // Candidate attribute positions q in (start+1, tag_end], last first
        // (greedy `[^>]*` backtracks from the longest prefix).
        let mut found: Option<usize> = None;
        let mut q = tag_end;
        while q > start + 2 {
            q -= 1;
            if q + attr.len() > n || is_word_byte(bytes[q - 1]) {
                continue;
            }
            if !bytes[q..q + attr.len()].eq_ignore_ascii_case(attr.as_bytes()) {
                continue;
            }
            // `\s*=\s*["']`
            let mut k = q + attr.len();
            k += content.len() - k - js::trim_start(&content[k..]).len();
            if u8_at(content, k) != Some(b'=') {
                continue;
            }
            k += 1;
            k += content.len() - k - js::trim_start(&content[k..]).len();
            if !u8_at(content, k).map_or(false, is_quote) {
                continue;
            }
            k += 1;
            let value_start = k;
            let mut value_end = value_start;
            while value_end < n && !is_quote(bytes[value_end]) {
                value_end += 1;
            }
            if value_end >= n {
                continue; // no closing quote
            }
            let value = &content[value_start..value_end];
            let ok = if exact {
                value.eq_ignore_ascii_case(needle)
            } else {
                value_contains_token(value, needle)
            };
            if ok {
                found = Some(value_end + 1);
                break;
            }
        }
        match found {
            Some(end) => {
                starts.push(start);
                pos = end.max(start + 1);
            }
            None => pos = start + 1,
        }
    }
    starts
}

/// `[^"']*(?<![\w-])NEEDLE(?![\w-])[^"']*` over a quote-free value, ASCII
/// case-insensitive.
fn value_contains_token(value: &str, needle: &str) -> bool {
    let vb = value.as_bytes();
    let nl = needle.len();
    if nl == 0 || vb.len() < nl {
        return false;
    }
    for t in 0..=vb.len() - nl {
        if !vb[t..t + nl].eq_ignore_ascii_case(needle.as_bytes()) {
            continue;
        }
        let before_ok = t == 0 || !is_word_or_dash(vb[t - 1]);
        let after_ok = t + nl == vb.len() || !is_word_or_dash(vb[t + nl]);
        if before_ok && after_ok {
            return true;
        }
    }
    false
}

/// JS: checks.mjs#selectorHitsLandmark
pub fn selector_hits_landmark(content: &str, selector: &str, ranges: &[(usize, usize)]) -> bool {
    if ranges.is_empty() {
        return false;
    }
    let last = SELECTOR_COMBINATOR_RE
        .split(selector)
        .filter(|s| !s.is_empty())
        .last()
        .unwrap_or("");
    let id_match = ID_TOKEN_RE.captures(last).map(|m| m[1].to_string());
    let class_match = CLASS_TOKEN_RE.captures(last).map(|m| m[1].to_string());
    let starts = if let Some(id) = id_match {
        attr_tag_match_starts(content, "id", &id, true)
    } else if let Some(cls) = class_match {
        attr_tag_match_starts(content, "class", &cls, false)
    } else {
        return false;
    };
    starts
        .into_iter()
        .any(|s| index_in_source_ranges(s, ranges))
}
