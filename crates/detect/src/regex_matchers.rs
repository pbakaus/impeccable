//! Port of the `REGEX_MATCHERS` line matchers and `REGEX_ANALYZERS` page
//! analyzers from `cli/engine/engines/regex/detect-text.mjs`.

use impeccable_core::checks::css_scan::{
    has_interpolation, is_unseen_declaration_source, names_same_element, scan_css_text_for_glow,
    scan_css_text_for_marquee, scan_css_text_for_radial_halo,
    CssHostIndex,
};
use impeccable_core::checks::rules::{
    find_solid_chromatic_bg, is_near_black_neutral_class, DeclaredCorners, NOMINAL_CARD_WIDTH_PX,
};
use impeccable_core::color::is_neutral_color;
use impeccable_core::constants::{EM_DASH_CHARS_PER_DASH, EM_DASH_FLOOR, OVERUSED_FONTS};
use impeccable_core::findings::{finding, Finding};
use impeccable_core::fonts::extract_google_font_families;
use impeccable_core::js::{self, ci, math_round, number_to_string, parse_float, string_to_number};
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

/// Opening-tag span that contains `index`, if any. `end` is the `>` byte.
fn markup_tag_span(line: &str, index: usize) -> Option<(usize, usize)> {
    let mut i = 0usize;
    while i < line.len() {
        let Some(rel) = line[i..].find('<') else {
            return None;
        };
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
        let Some(end) = tag_end else {
            return None;
        };
        if index >= tag_start && index <= end {
            return Some((tag_start, end));
        }
        i = end + 1;
    }
    None
}

/// JS: detect-text.mjs#containingMarkupTag (only its `text` is read).
fn containing_markup_tag(line: &str) -> impl Fn(usize) -> String + '_ {
    move |index: usize| {
        markup_tag_span(line, index)
            .map(|(start, end)| line[start..end + 1].to_string())
            .unwrap_or_else(|| line.to_string())
    }
}

fn is_self_closing_tag(tag: &str) -> bool {
    tag.trim_end_matches('>').trim_end().ends_with('/')
}

/// Text path cannot see the DOM. When this line holds a whole tag, require
/// it empty or self-closing. A class list with no `<` is a split JSX tag,
/// so emptiness is unknown and the other gates still apply.
fn stripe_child_markup_empty(line: &str, index: usize) -> bool {
    let Some((start, end)) = markup_tag_span(line, index) else {
        return true;
    };
    if is_self_closing_tag(&line[start..end + 1]) {
        return true;
    }
    let rest = line.get(end + 1..).unwrap_or("").trim_start();
    rest.starts_with("</")
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

// ─── side accent scope ──────────────────────────────────────────────────────
// `side-tab` reports a left or right accent only on a card rounded away from
// the stripe. A matcher sees one line; the corners live in the declarations
// around it, so the driver hands every side-tab match to
// [`side_tab_rounded_in_scope`] with the whole block in hand.

re!(TW_SIDE_TAB_WHOLE_RE, format!("^border-([lrse])-{D}+$"));
/// The utility-class corner reader lives in core, where the static engine
/// reads a runtime-compiled `rounded-*` class with it too.
pub use impeccable_core::checks::rules::tailwind_declared_corners;

re!(
    STYLE_ATTR_VALUE_RE,
    r#"(?i)\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')"#.to_string()
);
re!(STYLE_OBJECT_ATTR_RE, r"\bstyle\s*=\s*\{\{".to_string());
re!(STYLE_EXPRESSION_ATTR_RE, r"\bstyle\s*=\s*\{".to_string());
re!(JSX_SIDE_PROP_RE, r"^border(?:Left|Right)\s*=".to_string());
re!(
    CLASS_ATTR_RE,
    r#"(?:^|[\s<])(className|class|tw|:class|v-bind:class|class:[-\w]+)\s*=\s*("[^"]*"|'[^']*'|\{)"#
        .to_string()
);
re!(
    RADIUS_PROP_ATTR_RE,
    r#"(?:^|\s)(borderRadius|border(?:Top|Bottom)(?:Left|Right)Radius|rounded(?:Top|Bottom|Left|Right|TopLeft|TopRight|BottomLeft|BottomRight)?)\s*=\s*("[^"]*"|'[^']*'|\{[^}]*\})"#
        .to_string()
);
re!(
    CLASS_HELPER_RE,
    r"\b(?:cn|clsx|cx|classNames|classnames|twMerge|twJoin)\b".to_string()
);
re!(
    BARE_NUMBER_RE,
    r"^-?(?:[0-9]+\.?[0-9]*|\.[0-9]+)$".to_string()
);

/// A matcher run's lines joined once, with the byte offset each line starts
/// at: what the side accent scope reader walks, built once per file rather
/// than once per match.
pub struct SourceText {
    text: String,
    line_starts: Vec<usize>,
}

impl SourceText {
    pub fn new(lines: &[&str]) -> Self {
        let mut line_starts = Vec::with_capacity(lines.len());
        let mut pos = 0usize;
        for l in lines {
            line_starts.push(pos);
            pos += l.len() + 1;
        }
        SourceText {
            text: lines.join("\n"),
            line_starts,
        }
    }

    /// The joined text.
    pub fn text(&self) -> &str {
        &self.text
    }

    /// The byte offset of `index` on line `i` in the joined text.
    pub fn offset(&self, i: usize, index: usize) -> usize {
        self.line_starts[i] + index
    }

    fn line(&self, i: usize) -> &str {
        let start = self.line_starts[i];
        let end = self
            .line_starts
            .get(i + 1)
            .map_or(self.text.len(), |next| next - 1);
        &self.text[start..end]
    }

    fn line_count(&self) -> usize {
        self.line_starts.len()
    }
}

/// The innermost `{ ... }` block or template literal around `offset`:
/// `(start, end, open)`, where `open` is the block's `{` and `None` for a
/// template literal or the whole text.
fn block_bounds(b: &[u8], offset: usize) -> (usize, usize, Option<usize>) {
    let mut start = 0;
    let mut open = None;
    let mut depth = 0usize;
    let mut p = offset.min(b.len());
    while p > 0 {
        p -= 1;
        match b[p] {
            b'}' => depth += 1,
            b'{' if depth == 0 => {
                start = p + 1;
                open = Some(p);
                break;
            }
            b'{' => depth -= 1,
            b'`' if depth == 0 => {
                start = p + 1;
                break;
            }
            _ => {}
        }
    }
    let mut end = b.len();
    depth = 0;
    let mut p = offset.min(b.len());
    while p < b.len() {
        match b[p] {
            b'{' => depth += 1,
            b'}' if depth == 0 => {
                end = p;
                break;
            }
            b'}' => depth -= 1,
            b'`' if depth == 0 => {
                end = p;
                break;
            }
            _ => {}
        }
        p += 1;
    }
    (start, end, open)
}

/// The index of the `}` closing the `{` at `open`, strings and template
/// literals kept whole.
fn matching_close(b: &[u8], open: usize) -> Option<usize> {
    let mut depth = 0usize;
    let mut quote: Option<u8> = None;
    let mut p = open;
    while p < b.len() {
        let c = b[p];
        if let Some(q) = quote {
            if c == b'\\' {
                p += 2;
                continue;
            }
            if c == q {
                quote = None;
            }
            p += 1;
            continue;
        }
        match c {
            b'"' | b'\'' | b'`' => quote = Some(c),
            b'{' => depth += 1,
            b'}' => {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    return Some(p);
                }
            }
            _ => {}
        }
        p += 1;
    }
    None
}

/// The index of the `{` a `}` at `close` closes, walking back.
fn matching_open(b: &[u8], close: usize) -> Option<usize> {
    let mut depth = 0usize;
    let mut p = close + 1;
    while p > 0 {
        p -= 1;
        match b[p] {
            b'}' => depth += 1,
            b'{' => {
                depth -= 1;
                if depth == 0 {
                    return Some(p);
                }
            }
            _ => {}
        }
    }
    None
}

/// The contents of the balanced `{ ... }` at `open`, without the braces.
fn balanced_braces(text: &str, open: usize) -> Option<&str> {
    matching_close(text.as_bytes(), open).map(|close| &text[open + 1..close])
}

/// Whether the `{` at `open` belongs to an interpolation (`${`, `#{`, `@{`).
fn opens_interpolation(b: &[u8], open: usize) -> bool {
    open > 0 && matches!(b[open - 1], b'$' | b'#' | b'@')
}

/// A declaration block's statements at its own depth, in source order: split
/// on `;` and newlines, and on `,` in a style object. Strings, parentheses,
/// brackets and interpolations stay whole; a nested block (`&:hover {...}`,
/// `'@media ...': {...}`) is dropped with the selector or key before it.
fn split_statements(text: &str, object: bool) -> Vec<String> {
    let b = text.as_bytes();
    let mut out = Vec::new();
    let mut seg_start = 0usize;
    let mut depth = 0i32;
    let mut p = 0usize;
    let push = |out: &mut Vec<String>, from: usize, to: usize| {
        let s = js::trim(&text[from..to]);
        if !s.is_empty() {
            out.push(s.to_string());
        }
    };
    while p < b.len() {
        match b[p] {
            q @ (b'"' | b'\'' | b'`') => {
                let mut e = p + 1;
                while e < b.len() && b[e] != q {
                    if b[e] == b'\\' {
                        e += 1;
                    }
                    e += 1;
                }
                p = e.min(b.len());
            }
            b'(' | b'[' => depth += 1,
            b')' | b']' => depth -= 1,
            b'{' => {
                let close = matching_close(b, p).unwrap_or(b.len().saturating_sub(1));
                if !opens_interpolation(b, p) && depth <= 0 {
                    // A nested block and the selector before it.
                    seg_start = close + 1;
                }
                p = close;
            }
            b';' | b'\n' if depth <= 0 => {
                push(&mut out, seg_start, p);
                seg_start = p + 1;
            }
            b',' if object && depth <= 0 => {
                push(&mut out, seg_start, p);
                seg_start = p + 1;
            }
            _ => {}
        }
        p += 1;
    }
    if seg_start < b.len() {
        push(&mut out, seg_start, b.len());
    }
    out
}

/// A statement's property and value, a quoted style-object key unquoted.
fn split_declaration(statement: &str) -> Option<(String, String)> {
    let s = js::trim(statement);
    let first = s.chars().next()?;
    let (prop, rest) = if matches!(first, '"' | '\'' | '`') {
        let close = s[1..].find(first)? + 1;
        (&s[1..close], js::trim(&s[close + 1..]).strip_prefix(':')?)
    } else {
        let idx = s.find(':')?;
        (js::trim(&s[..idx]), &s[idx + 1..])
    };
    Some((prop.to_string(), js::trim(rest).to_string()))
}

/// Apply a block's statements to the corners in order. A statement that
/// brings in declarations the reader cannot see (a mixin call, a spread, a
/// bare interpolation) makes every corner unknown until a later literal
/// radius replaces it. In a theme-scale object (`sx={{ ... }}`) a bare
/// number is a theme multiple rather than px, so only a `0` is known.
fn apply_statements(corners: &mut DeclaredCorners, statements: &[String], theme_scale: bool) {
    for statement in statements {
        if is_unseen_declaration_source(statement) {
            corners.set_unknown();
            continue;
        }
        let Some((prop, value)) = split_declaration(statement) else {
            continue;
        };
        if theme_scale && BARE_NUMBER_RE.is_match(&value) {
            let key = prop.to_ascii_lowercase();
            if key.starts_with("border") && key.ends_with("radius") {
                if parse_float(&value) == 0.0 {
                    corners.apply(&prop, "0", NOMINAL_CARD_WIDTH_PX);
                } else {
                    corners.set_unknown();
                }
                continue;
            }
        }
        corners.apply(&prop, &value, NOMINAL_CARD_WIDTH_PX);
    }
}

/// The markup tag around `index` when the whole tag sits on the line.
fn complete_markup_tag(line: &str, index: usize) -> Option<&str> {
    let mut i = 0usize;
    while i < line.len() {
        let tag_start = i + line[i..].find('<')?;
        let after = &line[tag_start + 1..];
        if !after
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_alphabetic())
        {
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
        let end = tag_end?;
        if index >= tag_start && index <= end {
            return Some(&line[tag_start..end + 1]);
        }
        i = end + 1;
    }
    None
}

/// The class names a class attribute expression spells out, or `None` when
/// it carries anything that could add a class the reader cannot see: a
/// variable, a condition, a prop, a template interpolation.
fn literal_class_text(expression: &str) -> Option<String> {
    let b = expression.as_bytes();
    let mut classes = String::new();
    let mut rest = String::new();
    let mut p = 0usize;
    while p < b.len() {
        let c = b[p];
        if matches!(c, b'"' | b'\'' | b'`') {
            let mut e = p + 1;
            while e < b.len() && b[e] != c {
                if b[e] == b'\\' {
                    e += 1;
                }
                e += 1;
            }
            let literal = &expression[(p + 1).min(b.len())..e.min(b.len())];
            if has_interpolation(literal) {
                return None;
            }
            classes.push(' ');
            classes.push_str(literal);
            p = e + 1;
            continue;
        }
        rest.push(c as char);
        p += 1;
    }
    let rest = CLASS_HELPER_RE.replace_all(&rest, "");
    rest.chars()
        .all(|c| c.is_whitespace() || matches!(c, '(' | ')' | ',' | '+' | '[' | ']'))
        .then_some(classes)
}

/// The corners a markup tag gives its element: the `rounded-*` classes of a
/// literal class attribute, then any styled-system radius prop, then the
/// radius in its `style` attribute or style object. Unknown when the tag does
/// not close on the line, or carries a spread, a class expression or a style
/// expression that could add a class or a radius the reader cannot see.
fn markup_tag_corners(line: &str, index: usize) -> DeclaredCorners {
    let Some(tag) = complete_markup_tag(line, index) else {
        return DeclaredCorners::unknown();
    };
    if tag.contains("{...") || tag.contains("{ ...") {
        return DeclaredCorners::unknown();
    }
    let mut corners = DeclaredCorners::default();
    for c in CLASS_ATTR_RE.captures_iter(tag) {
        let name = &c[1];
        let value = c.get(2).unwrap();
        let text = if value.as_str() == "{" {
            balanced_braces(tag, value.start()).and_then(literal_class_text)
        } else if matches!(name, "class" | "className" | "tw") {
            let quoted = value.as_str();
            let inner = &quoted[1..quoted.len() - 1];
            (!inner.contains('{')).then(|| inner.to_string())
        } else {
            // A bound class (`:class`, `class:list`, `class:rounded-lg`).
            None
        };
        let Some(text) = text else {
            return DeclaredCorners::unknown();
        };
        let classes = tailwind_declared_corners(&text);
        if classes.declared() {
            corners = classes;
        }
    }
    tag_own_corners(tag, corners)
}

/// The radius a markup tag declares on itself over `corners`: its
/// styled-system radius props, then the radius in its `style` attribute or
/// style object. Unknown when a style expression could add a radius unseen.
fn tag_own_corners(tag: &str, mut corners: DeclaredCorners) -> DeclaredCorners {
    for c in RADIUS_PROP_ATTR_RE.captures_iter(tag) {
        let prop = &c[1];
        let value = c[2]
            .trim_matches(|ch| matches!(ch, '"' | '\'' | '{' | '}'))
            .trim()
            .trim_matches(|ch| matches!(ch, '"' | '\''));
        let zero = matches!(value, "0" | "0px" | "none");
        if prop.starts_with("rounded") {
            // A styled-system `rounded` prop names a theme size.
            if !zero {
                corners.set_unknown();
            } else if prop == "rounded" {
                corners.apply("border-radius", "0", NOMINAL_CARD_WIDTH_PX);
            }
            continue;
        }
        if !zero && BARE_NUMBER_RE.is_match(value) {
            // A bare number on a styled-system prop is a theme multiple.
            corners.set_unknown();
            continue;
        }
        corners.apply(prop, value, NOMINAL_CARD_WIDTH_PX);
    }
    if let Some(c) = STYLE_ATTR_VALUE_RE.captures(tag) {
        let value = c.get(1).or_else(|| c.get(2)).map_or("", |m| m.as_str());
        apply_statements(&mut corners, &split_statements(value, false), false);
    } else if let Some(m) = STYLE_OBJECT_ATTR_RE.find(tag) {
        match balanced_braces(tag, m.end() - 1) {
            Some(object) => apply_statements(&mut corners, &split_statements(object, true), false),
            None => return DeclaredCorners::unknown(),
        }
    } else if STYLE_EXPRESSION_ATTR_RE.is_match(tag) {
        return DeclaredCorners::unknown();
    }
    corners
}

/// Whether `index` sits inside a `style="..."` value or a `style={{ ... }}`
/// object on the line (an object the line does not close counts).
fn in_style_attribute(line: &str, index: usize) -> bool {
    STYLE_ATTR_VALUE_RE.captures_iter(line).any(|c| {
        c.get(1)
            .or_else(|| c.get(2))
            .is_some_and(|v| v.start() <= index && index <= v.end())
    }) || STYLE_OBJECT_ATTR_RE.find_iter(line).any(|m| {
        m.start() < index
            && balanced_braces(line, m.end() - 1)
                .map_or(true, |object| index <= m.end() + object.len())
    })
}

/// Whether the `{` at `open` opens a style object rather than a CSS block:
/// a value position (`=`, `:`, `(`, `,`, `[`, `{`, `?`, `=>`, `return`).
fn is_object_open(text: &str, open: usize) -> bool {
    let before = text[..open].trim_end();
    before.ends_with(['{', '(', '=', ':', ',', '[', '?'])
        || before.ends_with("=>")
        || before.ends_with("return")
}

/// Whether the object at `open` is a theme-scale `sx={{ ... }}` prop.
fn is_sx_object(text: &str, open: usize) -> bool {
    let before = text[..open].trim_end();
    let Some(before) = before.strip_suffix('{') else {
        return false;
    };
    let Some(before) = before.trim_end().strip_suffix('=') else {
        return false;
    };
    before.trim_end().ends_with("sx")
}

/// The key a nested style object sits under and where the key starts: `'@media
/// (min-width: 600px)'`, `'&:hover'`, `root`. A computed key (`[theme.up('md')]`)
/// is returned as an interpolation, since the reader cannot name it.
fn object_key(text: &str, open: usize) -> (String, usize) {
    let trimmed = text[..open].trim_end();
    let Some(before) = trimmed.strip_suffix(':') else {
        return (String::new(), open);
    };
    let before = before.trim_end();
    if before.ends_with(']') {
        return ("${computed}".to_string(), before.len());
    }
    if let Some(q) = before
        .chars()
        .last()
        .filter(|c| matches!(c, '"' | '\'' | '`'))
    {
        if let Some(start) = before[..before.len() - 1].rfind(q) {
            return (before[start + 1..before.len() - 1].to_string(), start);
        }
    }
    let start = before
        .char_indices()
        .rev()
        .find(|(_, c)| !(c.is_ascii_alphanumeric() || matches!(c, '_' | '$' | '&' | '-')))
        .map_or(0, |(i, c)| i + c.len_utf8());
    (before[start..].to_string(), start)
}

/// Where the selector before a CSS block's `{` starts, reading an
/// interpolation inside the selector (`${Child} {`) as part of it.
fn selector_begin(b: &[u8], open: usize) -> usize {
    let mut p = open;
    while p > 0 {
        p -= 1;
        match b[p] {
            b'}' => {
                if let Some(o) = matching_open(b, p).filter(|o| opens_interpolation(b, *o)) {
                    p = o - 1;
                    continue;
                }
                return p + 1;
            }
            b';' | b'{' | b'`' => return p + 1,
            _ => {}
        }
    }
    0
}

/// Whether the template literal whose opening backtick is at `tick` sits
/// inside another template's interpolation (`${p => p.on && css`...`}`).
fn inside_interpolation(b: &[u8], tick: usize) -> bool {
    let mut depth = 0usize;
    let mut p = tick;
    while p > 0 {
        p -= 1;
        match b[p] {
            b'}' => depth += 1,
            b'{' if depth == 0 => return p > 0 && b[p - 1] == b'$',
            b'{' => depth -= 1,
            b'`' if depth == 0 => return false,
            _ => {}
        }
    }
    false
}

/// The corners of the element a CSS declaration or style-object property in
/// a braces syntax sits on: the statements of its own block, and of every
/// block around it it passes through or names with `&`, applied outermost
/// first. An at-rule (`@media`, `@include breakpoint(md) {`) or a style-object
/// at-rule key passes through to the rule around it; `&.x`, `&:hover`,
/// `.dark &` and a BEM modifier name the same element; a descendant stops the
/// walk. Wherever the walk cannot name the element (an interpolated selector
/// or key, a match inside an interpolation, a `css` template nested in
/// another template) the corners start unknown; otherwise the statements apply
/// over `base`.
fn brace_scope_corners(
    source: &SourceText,
    i: usize,
    index: usize,
    base: DeclaredCorners,
) -> DeclaredCorners {
    let text = source.text.as_str();
    let b = text.as_bytes();
    let (mut start, mut end, mut open) = block_bounds(b, source.line_starts[i] + index);
    let mut chunks: Vec<(usize, usize, bool)> = Vec::new();
    let mut unknown = false;
    let mut theme_scale = false;
    loop {
        let object = open.is_some_and(|o| is_object_open(text, o));
        chunks.push((start, end, object));
        let Some(o) = open else {
            if start > 0 && b[start - 1] == b'`' && inside_interpolation(b, start - 1) {
                unknown = true;
            }
            break;
        };
        if opens_interpolation(b, o) {
            unknown = true;
            break;
        }
        let (selector, selector_start) = if object {
            theme_scale |= is_sx_object(text, o);
            object_key(text, o)
        } else {
            let begin = selector_begin(b, o);
            (js::trim(&text[begin..o]).to_string(), begin)
        };
        if has_interpolation(&selector) {
            unknown = true;
            break;
        }
        if !(selector.starts_with('@') || names_same_element(&selector)) {
            break;
        }
        (start, end, open) = block_bounds(b, selector_start);
    }
    let mut corners = if unknown {
        DeclaredCorners::unknown()
    } else {
        base
    };
    for &(s, e, object) in chunks.iter().rev() {
        apply_statements(
            &mut corners,
            &split_statements(&text[s..e], object),
            object && theme_scale,
        );
    }
    corners
}

/// The indentation-syntax Sass reading of [`brace_scope_corners`]: the lines
/// at the match's indentation that do not open a deeper block, then the same
/// for every parent it passes through (an at-rule, a `+mixin` wrapper) or
/// names with `&`. An indented `+mixin` or `@include` statement makes the
/// corners unknown; an interpolated parent selector starts them unknown.
/// Otherwise the statements apply over `base`: the cascade's `0`, or unknown
/// corners to learn which ones the scope declares.
fn sass_scope_corners(source: &SourceText, i: usize, base: DeclaredCorners) -> DeclaredCorners {
    let indent = |l: &str| l.len() - l.trim_start().len();
    let blank = |l: &str| l.trim().is_empty();
    let mut chunks: Vec<Vec<String>> = Vec::new();
    let mut unknown = false;
    let mut at = i;
    loop {
        let level = indent(source.line(at));
        let mut first = at;
        let mut parent = None;
        for j in (0..at).rev() {
            let l = source.line(j);
            if blank(l) {
                continue;
            }
            if indent(l) < level {
                parent = Some(j);
                break;
            }
            first = j;
        }
        let mut last = at;
        for j in at + 1..source.line_count() {
            let l = source.line(j);
            if blank(l) {
                continue;
            }
            if indent(l) < level {
                break;
            }
            last = j;
        }
        let mut statements = Vec::new();
        for j in first..=last {
            let l = source.line(j);
            if blank(l) || indent(l) != level {
                continue;
            }
            let opens_block = (j + 1..=last)
                .map(|k| source.line(k))
                .find(|k| !blank(k))
                .is_some_and(|k| indent(k) > level);
            if !opens_block {
                statements.push(js::trim(l).to_string());
            }
        }
        chunks.push(statements);
        let Some(pj) = parent else {
            break;
        };
        let selector = js::trim(source.line(pj));
        if has_interpolation(selector) {
            unknown = true;
            break;
        }
        if !(selector.starts_with('@') || selector.starts_with('+') || names_same_element(selector))
        {
            break;
        }
        at = pj;
    }
    let mut corners = if unknown {
        DeclaredCorners::unknown()
    } else {
        base
    };
    for statements in chunks.iter().rev() {
        apply_statements(&mut corners, statements, false);
    }
    corners
}

/// Whether a `side-tab` match is the stripe-child form: a narrow coloured
/// element drawn as the accent inside a card. Its own declarations are the
/// stripe's, not the card's, so the rounded-card reading below cannot be
/// taken off them; the form keeps the guards its matcher applies.
pub fn is_stripe_child_match(m: &MatchCtx) -> bool {
    let whole = m.whole();
    SIDE_TAB_STRIPE_CHILD_TW_RE
        .find(whole)
        .is_some_and(|f| f.start() == 0 && f.end() == whole.len())
}

/// Whether a `side-tab` match sits on a card rounded away from its stripe.
/// A utility class, a styled-system prop and a `style` attribute read the
/// markup tag they sit in; a CSS declaration or style-object property reads
/// the statements of its own block and of the blocks around it it passes
/// through or names with `&`; indentation-syntax Sass follows indentation the
/// same way.
///
/// The reader fails safe to reporting. A scope it read completely that
/// declares no radius is the initial square box and stays silent, as does a
/// literal radius under the rounded threshold. Wherever it cannot see the
/// radius (an interpolation, an unresolved `var()`, a theme token, a mixin
/// call, a spread, a class expression, a tag that does not close on the line)
/// the corners are unknown and the finding stays. A radius declared on a
/// different selector of the same element is out of this reader's reach: in
/// stylesheet text [`side_tab_known_square_in_sheet`] reads the stylesheet
/// before a square answer drops the finding.
pub fn side_tab_rounded_in_scope(m: &MatchCtx, source: &SourceText, i: usize, sass: bool) -> bool {
    let whole = m.whole();
    let line = source.line(i);
    if let Some(c) = TW_SIDE_TAB_WHOLE_RE.captures(whole) {
        let side = if matches!(&c[1], "l" | "s") { 3 } else { 1 };
        return markup_tag_corners(line, m.index).is_rounded_away_from_side(side);
    }
    let lower = js::to_lower_case(whole);
    let side = if lower.contains("left") || lower.contains("start") {
        3
    } else {
        1
    };
    let corners = if JSX_SIDE_PROP_RE.is_match(whole) || in_style_attribute(line, m.index) {
        markup_tag_corners(line, m.index)
    } else if sass {
        sass_scope_corners(source, i, DeclaredCorners::default())
    } else {
        brace_scope_corners(source, i, m.index, DeclaredCorners::default())
    };
    corners.is_rounded_away_from_side(side)
}

/// The second half of the gate for a declaration in stylesheet text (a `.css`,
/// `.scss`, `.sass` or `.less` file, a `<style>` block, a CSS-in-JS template):
/// whether a match [`side_tab_rounded_in_scope`] read as square sits on a box
/// known to be square. Reading the declarations around the match alone cannot
/// say so: another rule for the same element (`.card` before
/// `.card.is-active`), or a class the element may carry, can round it.
///
/// Braces syntax asks the stylesheet's [`CssHostIndex`], the reading the
/// pseudo-element and inset-shadow scans take, so one visual answers the same
/// way however it is drawn. Indented Sass has no index: the box is known
/// square when its scope declares both corners away from the stripe with
/// literal values under the threshold, or when `sheet` (every radius the
/// file's stylesheets declare, corner by corner at its largest) cannot round
/// them. A utility class in stylesheet text is never known square.
///
/// `index_text` is what the index is built on, byte for byte in step with the
/// source: the source itself, or a component file with everything outside its
/// `<style>` blocks blanked.
pub fn side_tab_known_square_in_sheet<'s>(
    m: &MatchCtx,
    source: &SourceText,
    i: usize,
    sass: bool,
    index: &once_cell::unsync::OnceCell<CssHostIndex<'s>>,
    index_text: &'s str,
    sheet: &DeclaredCorners,
) -> bool {
    let whole = m.whole();
    if TW_SIDE_TAB_WHOLE_RE.is_match(whole) {
        return false;
    }
    let lower = js::to_lower_case(whole);
    let side = if lower.contains("left") || lower.contains("start") {
        3
    } else {
        1
    };
    if sass {
        return !sass_scope_corners(source, i, DeclaredCorners::unknown())
            .is_rounded_away_from_side(side)
            || !sheet.is_rounded_away_from_side(side);
    }
    index
        .get_or_init(|| CssHostIndex::new(index_text))
        .is_declaration_known_square(source.offset(i, m.index), side, sheet)
}

re!(MARKUP_TAG_NAME_RE, r"^<([A-Za-z][-\w.:]*)".to_string());
re!(CSS_PROP_ATTR_RE, r"(?:^|\s)css\s*=".to_string());

/// The literal class names a markup tag carries, or `None` when a class
/// attribute is an expression or a bound class the reader cannot spell out.
fn literal_tag_classes(tag: &str) -> Option<Vec<String>> {
    let mut classes = Vec::new();
    for c in CLASS_ATTR_RE.captures_iter(tag) {
        let name = &c[1];
        let value = c.get(2).unwrap();
        let text = if value.as_str() == "{" {
            balanced_braces(tag, value.start()).and_then(literal_class_text)
        } else if matches!(name, "class" | "className" | "tw") {
            let quoted = value.as_str();
            let inner = &quoted[1..quoted.len() - 1];
            (!inner.contains('{')).then(|| inner.to_string())
        } else {
            None
        };
        classes.extend(text?.split_whitespace().map(str::to_string));
    }
    Some(classes)
}

/// Whether a markup tag squares its own corners away from `side` off: a
/// `rounded-none` or `rounded-0` utility, or literal square radii its radius
/// props, `style` attribute or style object declare, or, for a match inside a
/// style object on the tag (`sx={{ ... }}`), that object. A corner nothing on
/// the tag declares could come from a stylesheet.
fn tag_squares_itself(m: &MatchCtx, source: &SourceText, i: usize, tag: &str, side: usize) -> bool {
    if literal_tag_classes(tag)
        .is_some_and(|classes| classes.iter().any(|c| c == "rounded-none" || c == "rounded-0"))
    {
        return true;
    }
    if !tag_own_corners(tag, DeclaredCorners::unknown()).is_rounded_away_from_side(side) {
        return true;
    }
    let whole = m.whole();
    let in_object = !TW_SIDE_TAB_WHOLE_RE.is_match(whole)
        && !JSX_SIDE_PROP_RE.is_match(whole)
        && !in_style_attribute(source.line(i), m.index);
    in_object
        && !brace_scope_corners(source, i, m.index, DeclaredCorners::unknown())
            .is_rounded_away_from_side(side)
}

/// The stripe side of a `side-tab` match: `3` for left or start, else `1`.
fn side_tab_side(whole: &str) -> usize {
    if let Some(c) = TW_SIDE_TAB_WHOLE_RE.captures(whole) {
        return if matches!(&c[1], "l" | "s") { 3 } else { 1 };
    }
    let lower = js::to_lower_case(whole);
    if lower.contains("left") || lower.contains("start") {
        3
    } else {
        1
    }
}

/// The second half of the gate for a markup accent (a utility class, a
/// `style` attribute, a style object or a JSX prop inside a tag on the line)
/// that [`side_tab_rounded_in_scope`] read as square: whether the element is
/// known square given the file's `<style>` blocks and CSS-in-JS rules, which
/// can round a class the tag carries. A file whose style text declares no
/// radius leaves the tag's own reading as it was; otherwise
/// [`CssHostIndex::is_element_known_square`] answers, over an index built on
/// `index_text` (that style text). A tag with a `css` prop, or whose classes
/// the reader cannot spell out, is never known square. A match that sits in
/// no tag on the line (a template declaration, a standalone object) is not
/// markup and is left as read.
///
/// A file that imports a stylesheet (`imports_stylesheet`) could round any
/// class the tag carries, and the reader does not follow the import, so there
/// the tag is known square only when it squares itself off
/// ([`tag_squares_itself`]).
pub fn side_tab_markup_known_square<'s>(
    m: &MatchCtx,
    source: &SourceText,
    i: usize,
    index: &once_cell::unsync::OnceCell<CssHostIndex<'s>>,
    index_text: &'s str,
    sheet: &DeclaredCorners,
    imports_stylesheet: bool,
) -> bool {
    if !sheet.declared() && !imports_stylesheet {
        return true;
    }
    let Some(tag) = complete_markup_tag(source.line(i), m.index) else {
        return true;
    };
    if imports_stylesheet && !tag_squares_itself(m, source, i, tag, side_tab_side(m.whole())) {
        return false;
    }
    if !sheet.declared() {
        return true;
    }
    if CSS_PROP_ATTR_RE.is_match(tag) {
        return false;
    }
    let Some(classes) = literal_tag_classes(tag) else {
        return false;
    };
    let name = MARKUP_TAG_NAME_RE
        .captures(tag)
        .map_or(String::new(), |c| c[1].to_string());
    let component = name.starts_with(|c: char| c.is_ascii_uppercase()) || name.contains('.');
    let tag_type = (!component && !name.is_empty()).then(|| name.to_ascii_lowercase());
    // A styled component the file defines takes its template's own
    // declarations.
    let styled_root = component
        && Regex::new(&format!(r"\b{}\s*=\s*styled\b", regex::escape(&name)))
            .map_or(true, |re| re.is_match(source.text()));
    index
        .get_or_init(|| CssHostIndex::new(index_text))
        .is_element_known_square(
            tag_type.as_deref(),
            styled_root,
            &classes,
            side_tab_side(m.whole()),
            sheet,
        )
}

/// The indentation-syntax Sass reading of [`CssHostIndex::sheet_corners`]:
/// every radius declaration in the text, corner by corner at its largest.
/// A mixin call, `@extend`, `@apply` or a bare interpolation standing where a
/// declaration would makes every corner unknown, as does an interpolated
/// radius. A line that opens a block (a selector, an at-rule, a `+mixin`
/// wrapper) is not a statement.
pub fn sass_sheet_corners(text: &str) -> DeclaredCorners {
    let lines: Vec<&str> = text.split('\n').collect();
    let indent = |l: &str| l.len() - l.trim_start().len();
    let mut sheet = DeclaredCorners::default();
    for (j, line) in lines.iter().enumerate() {
        let statement = js::trim(line);
        if statement.is_empty() {
            continue;
        }
        let opens_block = lines[j + 1..]
            .iter()
            .find(|l| !l.trim().is_empty())
            .is_some_and(|next| indent(next) > indent(line));
        if opens_block {
            continue;
        }
        if is_unseen_declaration_source(statement) {
            sheet.set_unknown();
            continue;
        }
        let lower = statement.to_ascii_lowercase();
        if has_interpolation(statement) && (lower.contains("radius") || lower.contains("rounded")) {
            sheet.set_unknown();
            continue;
        }
        if let Some((prop, value)) = split_declaration(statement) {
            let mut one = DeclaredCorners::default();
            if one.apply(&prop, &value, NOMINAL_CARD_WIDTH_PX) {
                sheet.raise_to(&one);
            }
        }
    }
    sheet
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
re!(
    SIDE_TAB_STRIPE_CHILD_TW_RE,
    r"w-(?:0\.5|1(?:\.5)?|2(?:\.5)?|3|\[(?:[2-9]|1[0-2])px\])"
);
re!(STRIPE_CHILD_HEIGHT_TOKEN_RE, r"h-(?:px\b|[0-9]|\[)");
re!(
    STRIPE_CHILD_ARIA_RE,
    r"(?i)aria-(?:current|selected)"
);
re!(STRIPE_CHILD_ROUNDED_FULL_RE, format!("{B}rounded-full{B}"));
re!(
    STRIPE_CHILD_CUE_RE,
    format!("{B}(?:shrink-0|rounded-[lres](?:-{W}+)?|left-0|right-0|inset-0|inset-y-0){B}")
);

/// Hyphen-safe class-token boundary: the byte before `index` must not be `-`
/// or an ASCII word character (mirrors JS `(?<![\w-])`; the `regex` crate has
/// no lookbehind).
fn hyphen_safe_prefix(text: &str, index: usize) -> bool {
    match text.as_bytes().get(index.wrapping_sub(1)) {
        Some(b) if index > 0 => !b.is_ascii_alphanumeric() && *b != b'-',
        _ => true,
    }
}

fn hyphen_safe_suffix(text: &str, end: usize) -> bool {
    !matches!(
        text.as_bytes().get(end),
        Some(b) if b.is_ascii_alphanumeric() || *b == b'-' || *b == b'.' || *b == b'/'
    )
}

fn scope_has_fixed_height(scope: &str) -> bool {
    STRIPE_CHILD_HEIGHT_TOKEN_RE.find_iter(scope).any(|m| {
        hyphen_safe_prefix(scope, m.start())
    })
}
re!(BORDER_ACCENT_TW_RE, format!("{B}border-[tb]-({D}+){B}"));
re!(ANIMATE_SPIN_RE, format!("{B}animate-spin{B}"));
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
    BROKEN_IMG_SRC_RE,
    format!(
        "<{img}{B}[^>]*?{B}{src}{WS}*={WS}*(?:\"\"|''|\"{WS}+\"|'{WS}+'|\"#\"|'#')",
        img = ci("img"),
        src = ci("src")
    )
);
re!(IMG_OPEN_RE, format!("<{}{B}", ci("img")));
re!(SRC_ATTR_RE, format!("{B}{}{WS}*=", ci("src")));

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
            id: "side-tab",
            find_all: |l| all(&SIDE_TAB_STRIPE_CHILD_TW_RE, l),
            test: |m, line| {
                if !hyphen_safe_prefix(line, m.index)
                    || !hyphen_safe_suffix(line, m.index + m.whole().len())
                {
                    return false;
                }
                let scope = containing_markup_tag(line)(m.index);
                find_solid_chromatic_bg(&scope).is_some()
                    && stripe_child_markup_empty(line, m.index)
                    && STRIPE_CHILD_CUE_RE.find_iter(&scope).any(|cue| {
                        hyphen_safe_prefix(&scope, cue.start())
                            && hyphen_safe_suffix(&scope, cue.end())
                    })
                    && !scope_has_fixed_height(&scope)
                    && !STRIPE_CHILD_ROUNDED_FULL_RE.is_match(&scope)
                    && !STRIPE_CHILD_ARIA_RE.is_match(&scope)
            },
            fmt: |m, line| {
                let scope = containing_markup_tag(line)(m.index);
                let bg = find_solid_chromatic_bg(&scope).unwrap();
                format!("{} + {bg} stripe child", m.whole())
            },
        },
        Matcher {
            id: "border-accent-on-rounded",
            find_all: |l| all(&BORDER_ACCENT_TW_RE, l),
            test: |m, line| {
                let scope = containing_markup_tag(line)(m.index);
                has_rounded(&scope)
                    && num(m.g(1)) >= 1.0
                    && !ANIMATE_SPIN_RE.is_match(&scope)
            },
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
                !is_near_black_neutral_class(m.whole())
                    && gray_on_color_pairs(line, m.whole(), m.index)
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

/// The page engines' count ([`impeccable_core::checks::text_rules::count_em_dashes`]):
/// a run of more than two hyphens is a rule, not a dash.
fn count_em_dashes(text: &str) -> usize {
    impeccable_core::checks::text_rules::count_em_dashes(text)
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
        // Shade 700 and darker is near-black ink, the same split the DOM
        // path draws at `GRAY_INK_MIN_LIGHTNESS`.
        assert!(g(r#"<div className="text-gray-800 bg-yellow-400">Card</div>"#).is_empty());
        assert!(g(r#"<div className="text-neutral-700 bg-green-400">Card</div>"#).is_empty());
        assert_eq!(
            g(r#"<div className="text-gray-600 bg-amber-400">Card</div>"#),
            vec!["text-gray-600 on bg-amber-400"]
        );
    }

    #[test]
    fn tailwind_corners_follow_the_class_order_the_framework_emits() {
        let left = |classes: &str| tailwind_declared_corners(classes).is_rounded_away_from_side(3);
        let right = |classes: &str| tailwind_declared_corners(classes).is_rounded_away_from_side(1);
        assert!(!left("border-l-4 border-indigo-500 bg-white p-4"));
        assert!(!left("border-l-4 rounded-none"));
        assert!(!left("border-l-4 rounded-xs"));
        assert!(left("border-l-4 rounded-lg"));
        assert!(left("border-l-4 rounded"));
        assert!(left("border-l-4 rounded-r-lg"));
        assert!(!right("border-r-4 rounded-r-lg"));
        assert!(!left("border-l-4 rounded-l-lg"));
        // Class order in the attribute does not matter, the emit order does.
        assert!(!left("rounded-r-none border-l-4 rounded-lg"));
        assert!(left("border-l-4 rounded-tr-xl rounded-br-xl"));
        assert!(left("border-l-4 rounded-[12px]"));
        assert!(!left("border-l-4 rounded-[2px]"));
        // A variant can round the card; it never squares it.
        assert!(left("border-l-4 md:rounded-xl"));
        assert!(left("border-l-4 rounded-xl md:rounded-none"));
        // Unknown sizes keep the finding.
        assert!(left("border-l-4 rounded-card"));
        assert!(left("border-l-4 rounded-(--radius)"));
        assert!(left("border-l-4 !rounded-lg"));
    }

    #[test]
    fn side_tab_scope_reads_the_enclosing_declarations() {
        let rounded = |text: &str, needle: &str, sass: bool| {
            let lines: Vec<&str> = text.split('\n').collect();
            let i = lines.iter().position(|l| l.contains(needle)).unwrap();
            let index = lines[i].find(needle).unwrap();
            let m = MatchCtx {
                groups: vec![Some(needle.to_string())],
                index,
            };
            side_tab_rounded_in_scope(&m, &SourceText::new(&lines), i, sass)
        };
        let accent = "border-left: 4px solid #6366f1";
        assert!(!rounded(
            ".c {\n  border-left: 4px solid #6366f1;\n}",
            accent,
            false
        ));
        assert!(rounded(
            ".c {\n  border-radius: 12px;\n  border-left: 4px solid #6366f1;\n}",
            accent,
            false
        ));
        // A radius in a sibling or nested rule is not this box's.
        assert!(!rounded(".a { border-radius: 12px }\n.c {\n  border-left: 4px solid #6366f1;\n  &:hover { border-radius: 12px; }\n}", accent, false));
        // Longhands after the shorthand square the far corners off.
        assert!(!rounded(".c { border-left: 4px solid #6366f1; border-radius: 12px; border-top-right-radius: 0; border-bottom-right-radius: 0 }", accent, false));
        // A template literal is a scope of its own.
        assert!(rounded(
            "const A = styled.div`\n  border-left: 4px solid #6366f1;\n  border-radius: 8px;\n`;",
            accent,
            false
        ));
        // Inline style attributes and style objects.
        assert!(!rounded(
            "<div style=\"border-left: 4px solid #6366f1; padding: 8px\">x</div>",
            accent,
            false
        ));
        assert!(rounded(
            "<div style=\"border-left: 4px solid #6366f1; border-radius: 8px\">x</div>",
            accent,
            false
        ));
        assert!(rounded(
            "<div style={{ borderLeft: '4px solid #6366f1', borderRadius: 12 }} />",
            "borderLeft: '4px solid",
            false
        ));
        assert!(!rounded(
            "<div style={{ borderLeft: '4px solid #6366f1', padding: 12 }} />",
            "borderLeft: '4px solid",
            false
        ));
        // An unresolvable radius keeps the finding.
        assert!(rounded(
            ".c { border-left: 4px solid #6366f1; border-radius: $radius; }",
            accent,
            false
        ));
        // Indentation-syntax Sass.
        assert!(rounded(
            ".card\n  border-left: 4px solid #6366f1\n  border-radius: 12px",
            accent,
            true
        ));
        assert!(!rounded(
            ".card\n  border-left: 4px solid #6366f1\n  .inner\n    border-radius: 12px",
            accent,
            true
        ));
    }

    #[test]
    fn side_tab_scope_follows_same_element_nesting() {
        let rounded = |text: &str| {
            let needle = "border-left: 4px solid #6366f1";
            let lines: Vec<&str> = text.split('\n').collect();
            let i = lines.iter().position(|l| l.contains(needle)).unwrap();
            let index = lines[i].find(needle).unwrap();
            let m = MatchCtx {
                groups: vec![Some(needle.to_string())],
                index,
            };
            side_tab_rounded_in_scope(&m, &SourceText::new(&lines), i, false)
        };
        // `&.x`, `&:hover` and a BEM modifier style the rule's own element.
        assert!(rounded(
            ".c {\n  border-radius: 12px;\n  &.is-accent { border-left: 4px solid #6366f1; }\n}"
        ));
        assert!(rounded(
            ".c {\n  border-radius: 12px;\n  &:hover { border-left: 4px solid #6366f1; }\n}"
        ));
        assert!(rounded(
            ".c {\n  border-radius: 12px;\n  &--accent { border-left: 4px solid #6366f1; }\n}"
        ));
        // Two levels deep.
        assert!(rounded(
            ".c {\n  border-radius: 12px;\n  &.a {\n    &:hover { border-left: 4px solid #6366f1; }\n  }\n}"
        ));
        // A template literal's own declarations style `&`.
        assert!(rounded(
            "const A = styled.div`\n  border-radius: 12px;\n  &.active { border-left: 4px solid #6366f1; }\n`;"
        ));
        // A square parent stays square; a descendant and a BEM element are
        // other boxes.
        assert!(!rounded(
            ".c {\n  padding: 8px;\n  &.is-accent { border-left: 4px solid #6366f1; }\n}"
        ));
        assert!(!rounded(
            ".c {\n  border-radius: 12px;\n  & .child { border-left: 4px solid #6366f1; }\n}"
        ));
        assert!(!rounded(
            ".c {\n  border-radius: 12px;\n  &__part { border-left: 4px solid #6366f1; }\n}"
        ));
        assert!(!rounded(
            ".c {\n  border-radius: 12px;\n  .child { border-left: 4px solid #6366f1; }\n}"
        ));
        // The nested rule's own longhand still wins over the parent's shorthand.
        assert!(!rounded(
            ".c {\n  border-radius: 12px;\n  &.flat { border-left: 4px solid #6366f1; border-top-right-radius: 0; }\n}"
        ));
    }

    /// Wherever the scope reader cannot see the radius it keeps the finding,
    /// as the engine did before the rounded-card gate; a literal square host
    /// in the same shape still drops it.
    #[test]
    fn side_tab_scope_fails_safe_where_it_cannot_see_the_radius() {
        let rounded = |text: &str, needle: &str, sass: bool| {
            let lines: Vec<&str> = text.split('\n').collect();
            let i = lines.iter().position(|l| l.contains(needle)).unwrap();
            let index = lines[i].find(needle).unwrap();
            let m = MatchCtx {
                groups: vec![Some(needle.to_string())],
                index,
            };
            side_tab_rounded_in_scope(&m, &SourceText::new(&lines), i, sass)
        };
        let accent = "border-left: 4px solid #6366f1";

        // At-rules and mixin content blocks pass through to the card.
        for wrapper in [
            "@media (min-width: 600px)",
            "@include breakpoint(md)",
            "@supports (display: grid)",
        ] {
            let card = |radius: &str| {
                format!(".c {{\n  border-radius: {radius};\n  {wrapper} {{\n    border-left: 4px solid #6366f1;\n  }}\n}}")
            };
            assert!(rounded(&card("12px"), accent, false), "{wrapper}");
            assert!(!rounded(&card("0"), accent, false), "{wrapper}");
        }
        // A context rule styles the same element.
        assert!(rounded(
            ".c {\n  border-radius: 12px;\n  .dark & { border-left: 4px solid #6366f1; }\n}",
            accent,
            false
        ));

        // A mixin call could round the card; a later literal replaces it.
        for mixin in ["@include card-shape;", ".rounded();", "@extend .card;"] {
            let css = format!(".c {{\n  {mixin}\n  border-left: 4px solid #6366f1;\n}}");
            assert!(rounded(&css, accent, false), "{mixin}");
        }
        assert!(!rounded(
            ".c {\n  @include card-shape;\n  border-radius: 0;\n  border-left: 4px solid #6366f1;\n}",
            accent,
            false
        ));
        assert!(!rounded(
            ".c {\n  box-shadow: 0 0 0 1px\n    #000;\n  border-left: 4px solid #6366f1;\n}",
            accent,
            false
        ));

        // Interpolations: a bare one, an interpolated radius or selector, a
        // `css` template nested in another template's interpolation.
        assert!(rounded(
            "const A = styled.div`\n  ${cardShape}\n  &.on { border-left: 4px solid #6366f1; }\n`;",
            accent,
            false
        ));
        assert!(rounded(
            "const A = styled.div`\n  border-radius: ${({ theme }) => theme.radii.md};\n  &.on { border-left: 4px solid #6366f1; }\n`;",
            accent,
            false
        ));
        assert!(!rounded(
            "const A = styled.div`\n  border-radius: 0;\n  &.on { border-left: 4px solid #6366f1; }\n`;",
            accent,
            false
        ));
        assert!(rounded(
            "const A = styled.div`\n  ${Child} { border-left: 4px solid #6366f1; }\n`;",
            accent,
            false
        ));
        assert!(rounded(
            "const A = styled.div`\n  position: relative;\n  ${(p) => p.on && css`\n    border-left: 4px solid #6366f1;\n  `}\n`;",
            accent,
            false
        ));

        // Style objects: a media query key passes through, a theme-scale
        // number is not px, and a spread could bring in a radius.
        let obj = "borderLeft: '4px solid";
        assert!(rounded(
            "<Box sx={{ borderRadius: '12px', '@media (min-width: 600px)': { borderLeft: '4px solid #6366f1' } }} />",
            obj,
            false
        ));
        assert!(!rounded(
            "<Box sx={{ borderRadius: 0, '@media (min-width: 600px)': { borderLeft: '4px solid #6366f1' } }} />",
            obj,
            false
        ));
        assert!(rounded(
            "<Box sx={{ borderRadius: 2, borderLeft: '4px solid #6366f1' }} />",
            obj,
            false
        ));
        assert!(rounded(
            "const s = { ...cardStyle, borderLeft: '4px solid #6366f1' };",
            obj,
            false
        ));
        assert!(rounded(
            "const s = { [theme.breakpoints.up('md')]: { borderLeft: '4px solid #6366f1' } };",
            obj,
            false
        ));

        // Markup: a tag that does not close on the line, a class expression,
        // a spread or a styled-system radius prop could round the card.
        let tw = "border-l-4";
        assert!(rounded(
            "<div\n  className=\"border-l-4 border-indigo-500 p-4\"\n>",
            tw,
            false
        ));
        assert!(rounded(
            "<div className={cn('border-l-4 border-indigo-500', className)} />",
            tw,
            false
        ));
        assert!(rounded(
            "<div {...props} className=\"border-l-4 border-indigo-500\" />",
            tw,
            false
        ));
        assert!(rounded(
            "<div className={`border-l-4 ${radius}`} />",
            tw,
            false
        ));
        assert!(!rounded(
            "<div className={cn('border-l-4 border-indigo-500', 'p-4')} />",
            tw,
            false
        ));
        assert!(rounded(
            "<div className=\"rounded-lg\" style={{ borderLeft: '4px solid #6366f1' }} />",
            obj,
            false
        ));
        let prop = "borderLeft=\"4px solid";
        assert!(rounded(
            "<Box borderLeft=\"4px solid #6366f1\" borderRadius=\"md\" />",
            prop,
            false
        ));
        assert!(!rounded(
            "<Box borderLeft=\"4px solid #6366f1\" borderRadius={0} />",
            prop,
            false
        ));

        // Indented Sass follows `&` nesting and mixin wrappers.
        assert!(rounded(
            ".card\n  border-radius: 12px\n  &.on\n    border-left: 4px solid #6366f1",
            accent,
            true
        ));
        assert!(!rounded(
            ".card\n  border-radius: 0\n  &.on\n    border-left: 4px solid #6366f1",
            accent,
            true
        ));
        assert!(rounded(
            ".card\n  border-radius: 12px\n  +breakpoint(md)\n    border-left: 4px solid #6366f1",
            accent,
            true
        ));
        assert!(rounded(
            ".card\n  +card-shape\n  &.on\n    border-left: 4px solid #6366f1",
            accent,
            true
        ));
        assert!(!rounded(
            ".card\n  padding: 8px\n  &.on\n    border-left: 4px solid #6366f1\n  .inner\n    border-radius: 12px",
            accent,
            true
        ));
        assert!(rounded(
            "#{$block}\n  &.on\n    border-left: 4px solid #6366f1",
            accent,
            true
        ));
    }

    #[test]
    fn stripe_child_cues_require_complete_class_tokens() {
        for cue in ["left-0.5", "right-0.5", "inset-0.5", "inset-y-0.5", "-left-0", "left-0/2", "shrink-0.5"] {
            let source = format!(r#"<div className="w-1 {cue} bg-amber-500" />"#);
            assert!(run("side-tab", &source).is_empty(), "{cue}");
        }
        for cue in ["left-0", "right-0", "inset-0", "inset-y-0", "shrink-0", "rounded-l-lg"] {
            let source = format!(r#"<div className="w-1 {cue} bg-amber-500" />"#);
            assert_eq!(run("side-tab", &source).len(), 1, "{cue}");
        }
    }

    #[test]
    fn stripe_child_tailwind() {
        let s = |line: &str| run("side-tab", line);
        assert_eq!(
            s(r#"<div className="w-1 shrink-0 rounded-l-lg bg-amber-500" />"#),
            vec!["w-1 + bg-amber-500 stripe child"]
        );
        assert_eq!(
            s(r#"<div class="w-[4px] bg-blue-500 shrink-0"></div>"#),
            vec!["w-[4px] + bg-blue-500 stripe child"]
        );
        assert_eq!(
            s(r#"<span className="w-0.5 bg-rose-500 shrink-0" />"#),
            vec!["w-0.5 + bg-rose-500 stripe child"]
        );
        assert_eq!(
            s(r#"<div className="w-1 min-h-0 bg-amber-500 shrink-0" />"#),
            vec!["w-1 + bg-amber-500 stripe child"]
        );
        assert!(s(r#"<div className="w-2 h-2 rounded-full bg-green-500" />"#).is_empty());
        assert!(s(
            r#"<div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-amber-500" /><span className="text-slate-400">Vital few</span></div>"#
        )
        .is_empty());
        assert!(s(r#"<div className="w-1 bg-amber-500/10" />"#).is_empty());
        assert!(s(r#"<a className="w-1 bg-amber-500" aria-current="page"></a>"#).is_empty());
        assert!(s(
            r#"<div className="w-1 shrink-0"><span className="bg-amber-500" /></div>"#
        )
        .is_empty());
        assert!(s(r#"<div className="w-1 bg-amber-500">|</div>"#).is_empty());
        assert!(s(r#"<div className="w-1 bg-amber-500" />"#).is_empty());
        assert_eq!(
            s(r#"          className="w-1 shrink-0 rounded-l-lg bg-amber-500""#),
            vec!["w-1 + bg-amber-500 stripe child"]
        );
        assert!(s(r#"<div className="w-1 shrink-0 bg-amber-500">"#).is_empty());
    }

    #[test]
    fn matchers() {
        assert_eq!(
            run("side-tab", ".c { border-left: 4px solid #6366f1; }"),
            vec!["border-left: 4px solid #6366f1"]
        );
        assert!(run("side-tab", ".c { border-left: 4px solid #000; }").is_empty());
        assert_eq!(run("broken-image", "<img alt=x>"), vec!["<img alt=x>"]);
        assert!(run("broken-image", "<img src=\"a.png\">").is_empty());
        assert_eq!(
            run("bounce-easing", "cubic-bezier(0.68, -0.55, 0.265, 1.55)"),
            vec!["cubic-bezier(0.68, -0.55, 0.265, 1.55)"]
        );
    }

    #[test]
    fn border_accent_skips_tailwind_spinner() {
        let g = |line: &str| run("border-accent-on-rounded", line);
        assert_eq!(
            g(r#"<div className="rounded-lg border-t-4 border-blue-500" />"#),
            vec!["border-t-4"]
        );
        assert_eq!(
            g(r#"<div className="rounded-full border-b-2" />"#),
            vec!["border-b-2"]
        );
        assert!(g(r#"<div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent" />"#).is_empty());
        assert!(g(r#"<div className="sm:animate-spin rounded-full h-8 w-8 border-t-2" />"#).is_empty());
        assert!(g(r#"<div className="motion-safe:animate-spin rounded-full border-b-2" />"#).is_empty());
        assert_eq!(
            g(r#"<div className="animate-spin rounded-full h-12 w-12 border-b-2" /><div className="rounded-lg border-t-4" />"#),
            vec!["border-t-4"]
        );
        assert!(g(r#"<div className="animate-spin rounded-full h-12 w-12 border-b-2" /><div className="border-t-4" />"#).is_empty());
    }

    #[test]
    fn dashes() {
        assert_eq!(count_em_dashes("a — b -- c ---d"), 1);
        assert_eq!(count_em_dashes("a — b --c"), 2);
        assert_eq!(count_em_dashes("a -- "), 0);
    }
}
