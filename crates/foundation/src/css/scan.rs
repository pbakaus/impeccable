//! Stylesheet-text helpers: the parsing, indexing and keyframe-collection
//! utilities that read raw CSS (no DOM), plus the finding shapes the scanners
//! return. The scanners themselves live in `impeccable-core`.

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

/// The vendor prefixes a property token may carry and still be the property.
const VENDOR_PREFIXES: [&[u8]; 4] = [b"-webkit-", b"-moz-", b"-ms-", b"-o-"];

/// Whether the property name that starts at byte `start` of `text` is a name
/// of its own rather than the tail of a longer identifier. A regex word
/// boundary treats a hyphen as a break, so `--bprogress-box-shadow:` reads as
/// `box-shadow:`, and `border-width` or `line-height` inside a `transition`
/// list read as `width` and `height`. The byte before the name must not be a
/// hyphen or an identifier character; a vendor prefix (`-webkit-box-shadow`)
/// belongs to the property and passes when it starts cleanly itself.
pub fn starts_css_property_token(text: &str, start: usize) -> bool {
    let bytes = text.as_bytes();
    let clean = |at: usize| {
        at == 0 || {
            let b = bytes[at - 1];
            !(b == b'-' || is_word_byte(b) || b >= 0x80)
        }
    };
    if start > bytes.len() {
        return false;
    }
    if clean(start) {
        return true;
    }
    VENDOR_PREFIXES.iter().any(|prefix| {
        start >= prefix.len()
            && bytes[start - prefix.len()..start].eq_ignore_ascii_case(prefix)
            && clean(start - prefix.len())
    })
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
    // Ignore delimiters inside comments when locating the previous
    // declaration. Blanking each comment to its own length keeps every index
    // into the original source valid (#709).
    let before_open = SELECTOR_COMMENT_RE.replace_all(&css_text[..open], |c: &regex::Captures| {
        " ".repeat(c[0].len())
    });
    // The selector starts after the last `}`, `;` or `{` before its block:
    // the first rule inside `@media (...) {` or `@supports (...) {` follows
    // the at-rule's own brace, not a declaration.
    // A delimiter in a quoted string (`[data-template*="{"]`) or escaped
    // (`\{`) bounds nothing.
    let slice_start = last_unquoted_delimiter(&before_open, b"{};").map(|p| p + 1).unwrap_or(0);
    // Only a grouping at-rule may enclose the rule. Inside a style rule
    // (`.card { & > .stripe { … } }`, CSS nesting) the selector means
    // nothing without its parent, so the match stays unscoped as before.
    if !enclosed_only_by_at_rules(&before_open[..slice_start]) {
        return None;
    }
    let no_comments = SELECTOR_COMMENT_RE.replace_all(&css_text[slice_start..open], "");
    let raw_trim = js::trim(&no_comments);
    let raw = WS_RUN_RE.replace_all(raw_trim, " ").into_owned();
    if raw.is_empty()
        || raw.starts_with('@')
        || raw.as_bytes()[0].is_ascii_digit()
        || last_unquoted_delimiter(&raw, b"{}<").is_some()
    {
        return None;
    }
    if KEYFRAME_STEP_RE.is_match(&raw) || raw.contains('&') {
        return None;
    }
    Some(raw)
}

/// The byte offset of the last of `delims` in `css` outside quoted strings
/// and escapes.
fn last_unquoted_delimiter(css: &str, delims: &[u8]) -> Option<usize> {
    let bytes = css.as_bytes();
    let mut quote: Option<u8> = None;
    let mut last = None;
    let mut i = 0;
    while i < bytes.len() {
        let b = bytes[i];
        if b == b'\\' {
            i += 2;
            continue;
        }
        match quote {
            // A newline ends an unterminated string in CSS, so one stray
            // quote cannot swallow the rest of the sheet.
            Some(q) if b == q || b == b'\n' => quote = None,
            Some(_) => {}
            None if b == b'"' || b == b'\'' => quote = Some(b),
            None if delims.contains(&b) => last = Some(i),
            None => {}
        }
        i += 1;
    }
    last
}

/// Whether every block still open at the end of `css` (comments already
/// blanked) is a grouping at-rule (`@media`, `@supports`, `@layer`, …):
/// the header before each unclosed `{` starts with `@`.
fn enclosed_only_by_at_rules(css: &str) -> bool {
    let bytes = css.as_bytes();
    // Each open block as (where its header starts, its `{`).
    let mut open: Vec<(usize, usize)> = Vec::new();
    // A brace or semicolon in a quoted string (`content: "{"`, an at-rule
    // header's `@supports (content: "a;b")`) or escaped (`\{`) opens,
    // closes and ends nothing.
    let mut quote: Option<u8> = None;
    let mut head_start = 0;
    let mut i = 0;
    while i < bytes.len() {
        let b = bytes[i];
        if b == b'\\' {
            i += 2;
            continue;
        }
        match quote {
            // A newline ends an unterminated string, as in
            // [`last_unquoted_delimiter`].
            Some(q) if b == q || b == b'\n' => quote = None,
            Some(_) => {}
            None => match b {
                b'"' | b'\'' => quote = Some(b),
                b'{' => {
                    open.push((head_start, i));
                    head_start = i + 1;
                }
                b'}' => {
                    open.pop();
                    head_start = i + 1;
                }
                b';' => head_start = i + 1,
                _ => {}
            },
        }
        i += 1;
    }
    open.iter().all(|&(start, brace)| js::trim(&css[start..brace]).starts_with('@'))
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

// The percentage may sit inside a `calc()`, the usual gap-compensated loop
// (`translateX(calc(-100% - 32px))`); the first percentage is the travel.
re!(
    TRANSLATE_X_PCT_RE,
    format!(
        r"{B}{translate}(?:[xX]|3[dD])?\({WS}*(?:{calc}\({WS}*)?(-?[0-9.]+)%",
        translate = ci("translate"),
        calc = ci("calc")
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

re!(KEYFRAME_STEP_BLOCK_RE, r"([^{};]+)\{([^{}]*)\}".to_string());
re!(
    TRANSLATE_FN_RE,
    format!(r"{}(?:x|y|z|3d)?\([^)]*\)", ci("translate"))
);

/// How far a keyframe step may move its box before the step travels, in px.
const PULSE_TRAVEL_MIN_PX: f64 = 4.0;

/// A translation component as (px, percent): any zero (`0`, `0px`, `0%`) is
/// (0, 0), a px / rem / em length converts to px, a percentage is kept as
/// one, and anything else (`calc()`, a `var()`) is unknown.
fn translate_component(value: &str) -> Option<(f64, f64)> {
    let v = js::trim(value);
    if is_zero_offset(Some(v)) {
        return Some((0.0, 0.0));
    }
    if let Some(n) = v.strip_suffix('%') {
        let n = js::trim(n);
        if !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit() || b == b'.' || b == b'-' || b == b'+') {
            let pct = parse_float(n);
            return pct.is_finite().then_some((0.0, pct));
        }
        return None;
    }
    css_length_to_px(v).map(|px| (px, 0.0))
}

/// One axis of a step's translation: the px and percent parts summed, or
/// `None` when a part on that axis cannot be read.
type TranslateAxis = Option<(f64, f64)>;

fn add_axis(axis: &mut TranslateAxis, part: Option<(f64, f64)>) {
    *axis = match (*axis, part) {
        (Some((px, pct)), Some((dpx, dpct))) => Some((px + dpx, pct + dpct)),
        _ => None,
    };
}

/// The translation a step declares, per axis (x, y, z): the sum of the
/// `translate*()` functions in its `transform` plus its `translate`, `none`
/// or a transform without one being no translation. An axis is unknown when
/// one of its components cannot be read; the other axes still read, so a
/// centred float (`translate(-50%, -14px)`) moves on y. `None` when the step
/// declares neither property.
fn step_translation(decls: &DeclMap) -> Option<[TranslateAxis; 3]> {
    let transform = decls.get("transform").map(|v| js::to_lower_case(js::trim(v)));
    let translate = decls.get("translate").map(|v| js::to_lower_case(js::trim(v)));
    if transform.is_none() && translate.is_none() {
        return None;
    }
    let mut out: [TranslateAxis; 3] = [Some((0.0, 0.0)); 3];
    if let Some(t) = &transform {
        // A matrix carries its translation in its last terms, which this does
        // not read: every axis is unknown rather than still.
        if t.contains("matrix") {
            return Some([None; 3]);
        }
        // A scale, rotate, skew or perspective before a translate changes how
        // far that translate moves the box (`scale(.5) translateY(6px)`
        // travels 3px), which this does not compute: unknown, not the
        // declared distance. After the translate it leaves the travel alone.
        if let Some(first) = TRANSLATE_FN_RE.find(t) {
            let before = &t[..first.start()];
            if ["scale", "rotate", "skew", "perspective"].iter().any(|f| before.contains(f)) {
                return Some([None; 3]);
            }
        }
        for m in TRANSLATE_FN_RE.find_iter(t) {
            let f = m.as_str();
            let Some(open) = f.find('(') else { continue };
            let name = &f[..open];
            let inner = &f[open + 1..f.len() - 1];
            // A nested call (`translate(calc(0px), 8px)`) ends the match at
            // its own `)`, cutting the arguments short: none of them reads.
            if inner.contains('(') {
                let axes: &[usize] = match name {
                    "translatex" => &[0],
                    "translatey" => &[1],
                    "translatez" => &[2],
                    _ => &[0, 1, 2],
                };
                for &i in axes {
                    out[i] = None;
                }
                continue;
            }
            let args: Vec<&str> = inner.split(',').map(js::trim).collect();
            let part = |i: usize| args.get(i).map_or(Some((0.0, 0.0)), |a| translate_component(a));
            match name {
                "translatex" => add_axis(&mut out[0], part(0)),
                "translatey" => add_axis(&mut out[1], part(0)),
                "translatez" => add_axis(&mut out[2], part(0)),
                _ => {
                    for (i, axis) in out.iter_mut().enumerate() {
                        add_axis(axis, part(i));
                    }
                }
            }
        }
    }
    if let Some(t) = translate.filter(|t| t != "none") {
        for (i, part) in t.split_ascii_whitespace().take(3).enumerate() {
            add_axis(&mut out[i], translate_component(part));
        }
    }
    Some(out)
}

/// Whether two steps' readings of one axis travel apart: both read, the
/// same percentage, and px parts [`PULSE_TRAVEL_MIN_PX`] or more apart.
fn axis_travels(a: TranslateAxis, b: TranslateAxis) -> bool {
    match (a, b) {
        (Some((apx, apct)), Some((bpx, bpct))) => {
            (apct - bpct).abs() < 1e-9 && (apx - bpx).abs() >= PULSE_TRAVEL_MIN_PX
        }
        _ => false,
    }
}

/// Whether a keyframes body moves its box or changes its height, read from
/// the steps that declare it. It moves when two steps' translations, read
/// in px, differ by [`PULSE_TRAVEL_MIN_PX`] or more on an axis whose
/// percentage part is the same in both: a float
/// (imageto3d.studio's `library-node-float`, `transform: none` to
/// `translateY(-14px)`). A centred ring that repeats `translate(-50%, -50%)`
/// at every step, a `translateZ(0)` layer hint, a dot that breathes a
/// pixel up and a typing indicator that bobs 2px do not travel; neither
/// does a translation that cannot be read (a percentage that changes). It
/// resizes when two steps declare different `height`s and the same `width`
/// (or none): a waveform bar (juskoe's `wavePulse`, `height: 4px` to
/// `16px`). A ripple that grows both sides is a ping, and a step that
/// declares nothing leaves the reading as it was.
fn keyframes_move_or_resize(body: &str) -> bool {
    let mut translations: Vec<[TranslateAxis; 3]> = Vec::new();
    let mut sizes: Vec<(String, Option<String>)> = Vec::new();
    // Per step: the offsets, margins and box size it declares.
    let mut offsets: Vec<Vec<(&'static str, String)>> = Vec::new();
    for step in KEYFRAME_STEP_BLOCK_RE.captures_iter(body) {
        let decls = parse_css_decl_block(&step[2]);
        if let Some(t) = step_translation(&decls) {
            translations.push(t);
        }
        let mut step_offsets: Vec<(&'static str, String)> = Vec::new();
        for &prop in PULSE_OFFSET_PROPS.iter().chain(["width", "height"].iter()) {
            if let Some(v) = decls.get(prop) {
                step_offsets.push((prop, js::to_lower_case(&v.split_ascii_whitespace().collect::<Vec<_>>().join(" "))));
            }
        }
        offsets.push(step_offsets);
        if let Some(h) = decls.get("height") {
            let norm = |v: &str| js::to_lower_case(&v.split_ascii_whitespace().collect::<String>());
            sizes.push((norm(h), decls.get("width").map(|w| norm(w))));
        }
    }
    let travels = translations.iter().any(|a| {
        translations.iter().any(|b| (0..3).any(|i| axis_travels(a[i], b[i])))
    });
    // Two spellings of one length (`8px`, `8.0px`) are one size.
    let same = |a: &str, b: &str| match (css_length_to_px(a), css_length_to_px(b)) {
        (Some(x), Some(y)) => (x - y).abs() < 1e-6,
        _ => a == b,
    };
    let same_opt = |a: &Option<String>, b: &Option<String>| match (a, b) {
        (Some(a), Some(b)) => same(a, b),
        (None, None) => true,
        _ => false,
    };
    let resizes = sizes.iter().any(|(h, _)| !same(h, &sizes[0].0))
        && sizes.iter().all(|(_, w)| same_opt(w, &sizes[0].1));
    // An offset that changes between steps moves the box along its
    // containing block: zcad.ai's connector dot runs `left: 0px` to
    // `left: calc(100% - 4px)` (observations-1010 row 11). Two px lengths
    // under [`PULSE_TRAVEL_MIN_PX`] apart are a breath, not travel; values
    // that cannot both be read in px travel when they differ. An offset that
    // changes with the box's size, or with the offset on its opposite side,
    // keeps a growing dot centred: that is a ripple, not travel.
    let changed = |a: &[(&'static str, String)], b: &[(&'static str, String)], prop: &str| -> bool {
        let get = |s: &[(&'static str, String)]| s.iter().find(|(p, _)| *p == prop).map(|(_, v)| v.clone());
        match (get(a), get(b)) {
            (Some(va), Some(vb)) => match (offset_px(&va), offset_px(&vb)) {
                (Some(x), Some(y)) => (x - y).abs() >= PULSE_TRAVEL_MIN_PX,
                _ => va != vb,
            },
            _ => false,
        }
    };
    let offset_travels = offsets.iter().any(|a| {
        offsets.iter().any(|b| {
            if changed(a, b, "width") || changed(a, b, "height") {
                return false;
            }
            PULSE_OFFSET_PROPS
                .iter()
                .any(|&prop| changed(a, b, prop) && !changed(a, b, pulse_opposite_offset(prop)))
        })
    });
    travels || resizes || offset_travels
}

/// An offset or margin in px: a length [`css_length_to_px`] reads, or a
/// bare `0`.
fn offset_px(v: &str) -> Option<f64> {
    if is_zero_length(v) {
        return Some(0.0);
    }
    css_length_to_px(v)
}

/// Whether `v` is a zero in any unit (`0`, `0px`, `0%`, `-0.0em`): zero is
/// zero whatever its unit, so `left: 0` to `left: 0%` is no move.
fn is_zero_length(v: &str) -> bool {
    let v = js::trim(v);
    let digits = v.trim_start_matches(['-', '+']);
    let end = digits.find(|c: char| !(c.is_ascii_digit() || c == '.')).unwrap_or(digits.len());
    let (number, unit) = digits.split_at(end);
    !number.is_empty()
        && number.chars().any(|c| c.is_ascii_digit())
        && number.chars().all(|c| c == '0' || c == '.')
        && unit.chars().all(|c| c.is_ascii_alphabetic() || c == '%')
}

/// The box offsets and margins a keyframe step can move a dot with: one
/// side each. A shorthand that sets every side (`inset`, `margin`) moves
/// all four at once, which keeps a dot in place.
const PULSE_OFFSET_PROPS: [&str; 16] = [
    "left",
    "right",
    "top",
    "bottom",
    "inset-inline-start",
    "inset-inline-end",
    "inset-block-start",
    "inset-block-end",
    "margin-left",
    "margin-right",
    "margin-top",
    "margin-bottom",
    "margin-inline-start",
    "margin-inline-end",
    "margin-block-start",
    "margin-block-end",
];

/// The offset on the other side of the box from `prop`.
fn pulse_opposite_offset(prop: &str) -> &'static str {
    match prop {
        "left" => "right",
        "right" => "left",
        "top" => "bottom",
        "bottom" => "top",
        "inset-inline-start" => "inset-inline-end",
        "inset-inline-end" => "inset-inline-start",
        "inset-block-start" => "inset-block-end",
        "inset-block-end" => "inset-block-start",
        "margin-left" => "margin-right",
        "margin-right" => "margin-left",
        "margin-top" => "margin-bottom",
        "margin-bottom" => "margin-top",
        "margin-inline-start" => "margin-inline-end",
        "margin-inline-end" => "margin-inline-start",
        "margin-block-start" => "margin-block-end",
        _ => "margin-block-start",
    }
}

re!(
    SCALE_FN_RE,
    format!(
        r"{B}({}(?:{}|{}|{}|3{})?)\(",
        ci("scale"),
        ci("x"),
        ci("y"),
        ci("z"),
        ci("d")
    )
);

/// Whether every scale the keyframes declare in a `transform` runs along
/// one axis (all `scaleX()` or all `scaleY()`): an eye that blinks
/// (looot.ai's `asblink`, `scaleY(1)` to `scaleY(.1)`) or a bar that fills,
/// not a dot that swells. A body with no scale, or any `scale()`,
/// `scale3d()` or `scale:` property, is not.
fn scales_on_one_axis(body: &str) -> bool {
    let mut axis: Option<String> = None;
    for step in KEYFRAME_STEP_BLOCK_RE.captures_iter(body) {
        let decls = parse_css_decl_block(&step[2]);
        if decls.get("scale").is_some_and(|v| js::trim(v) != "none") {
            return false;
        }
        let Some(t) = decls.get("transform") else { continue };
        for m in SCALE_FN_RE.captures_iter(t) {
            let name = js::to_lower_case(&m[1]);
            if name != "scalex" && name != "scaley" {
                return false;
            }
            match &axis {
                Some(a) if *a != name => return false,
                _ => axis = Some(name),
            }
        }
    }
    axis.is_some()
}

/// JS: checks.mjs#collectPulseKeyframes (Map name -> pulses?)
pub fn collect_pulse_keyframes(content: &str) -> JsMap<bool> {
    let mut map: JsMap<bool> = JsMap::new();
    let mut pos = 0usize;
    while let Some(m) = KEYFRAMES_RE.captures_at(content, pos) {
        let after = m.get(0).unwrap().end();
        let (i, closed) = scan_brace_block(content, after);
        let body = brace_body(content, after, i, closed);
        let pulses = (OPACITY_DECL_RE.is_match(body)
            || BOX_SHADOW_DECL_RE.is_match(body)
            || (TRANSFORM_SCALE_RE.is_match(body) && !scales_on_one_axis(body)))
            && !keyframes_move_or_resize(body);
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
