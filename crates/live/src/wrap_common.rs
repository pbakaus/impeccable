//! JS: live-wrap.mjs helpers shared with live-insert.mjs: search-query
//! construction, element location (opener / closer / text disambiguation),
//! comment syntax and style mode from the framework registry, and the
//! cssAuthoring contracts.

use crate::inject::{resolve_source_traits, SourceTraits};
use crate::source_search::{
    find_source_file, is_generated_file, resolve_live_template_extensions, visit_source_files,
    NEVER_SOURCE_DIRS,
};
use crate::util::{jsp, safe_read};
use impeccable_core::js::{is_js_whitespace, trim, WS};
use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::{json, Value};

/// JS: argVal(args, flag) as live-wrap.mjs spells it: `--flag=value` first,
/// then `--flag value`.
pub fn arg_val_eq(args: &[String], flag: &str) -> Option<String> {
    let prefix = format!("{}=", flag);
    for a in args {
        if let Some(v) = a.strip_prefix(&prefix) {
            return Some(v.to_string());
        }
    }
    arg_val(args, flag)
}

/// JS: argVal(args, flag) as live-insert.mjs / live-accept.mjs spell it.
pub fn arg_val(args: &[String], flag: &str) -> Option<String> {
    let idx = args.iter().position(|a| a == flag)?;
    args.get(idx + 1).cloned()
}

/// JS: `str.match(/^(\s*)/)[1]`
pub fn leading_ws(line: &str) -> String {
    line.chars().take_while(|c| is_js_whitespace(*c)).collect()
}

/// JS: minLeadingSpaces(lines) / deindentContent's minIndent
pub fn min_leading_spaces(lines: &[String]) -> usize {
    let mut min: Option<usize> = None;
    for l in lines {
        if trim(l).is_empty() {
            continue;
        }
        let n = leading_ws(l).chars().count();
        if min.map(|m| n < m).unwrap_or(true) {
            min = Some(n);
        }
    }
    min.unwrap_or(0)
}

/// JS `str.slice(n)` by UTF-16 units approximated by chars (leading
/// whitespace is BMP).
pub fn slice_chars(s: &str, n: usize) -> String {
    s.chars().skip(n).collect()
}

/// JS: splitClassList(classes)
pub fn split_class_list(classes: &str) -> Vec<String> {
    static SPLIT_RE: Lazy<Regex> =
        Lazy::new(|| Regex::new(&format!("[,{}]+", &WS[1..WS.len() - 1])).unwrap());
    SPLIT_RE
        .split(classes)
        .map(|c| trim(c).to_string())
        .filter(|c| !c.is_empty())
        .collect()
}

/// JS: buildSearchQueries(elementId, classes, tag, query)
pub fn build_search_queries(
    element_id: Option<&str>,
    classes: Option<&str>,
    tag: Option<&str>,
    query: Option<&str>,
) -> Vec<String> {
    let mut queries = Vec::new();
    if let Some(id) = element_id {
        queries.push(format!("id=\"{}\"", id));
    }
    if let Some(classes) = classes {
        let list = split_class_list(classes);
        if list.len() > 1 {
            let joined = list.join(" ");
            let mut sorted = list.clone();
            // Array.prototype.sort is stable; longest first.
            sorted.sort_by(|a, b| b.encode_utf16().count().cmp(&a.encode_utf16().count()));
            queries.push(format!("class=\"{}\"", joined));
            queries.push(format!("className=\"{}\"", joined));
            for c in sorted {
                queries.push(c);
            }
        } else if list.len() == 1 {
            queries.push(list[0].clone());
        }
    }
    if let (Some(tag), Some(classes)) = (tag, classes) {
        let list = split_class_list(classes);
        let first = list.first().map(String::as_str).unwrap_or("undefined");
        queries.push(format!("<{} class=\"{}", tag, first));
        queries.push(format!("<{} className=\"{}", tag, first));
    }
    if let Some(q) = query {
        queries.push(q.to_string());
    }
    if queries.is_empty() {
        if let Some(tag) = tag {
            queries.push(format!("<{}", tag));
        }
    }
    queries
}

/// A tag fallback uses one prefix query; element matching checks its boundary.
pub fn is_tag_only_search(queries: &[String], tag: Option<&str>) -> bool {
    tag.map_or(false, |tag| queries.len() == 1 && queries[0] == format!("<{}", tag))
}

/// Lowercase ASCII names are HTML tags; component names retain their case.
fn is_html_tag(tag: &str) -> bool {
    tag.is_ascii() && !tag.bytes().any(|b| b.is_ascii_uppercase())
}

/// Byte offsets in `line` where `prefix` (`<h1` or `</h1`) starts a tag of
/// that exact name, under the tag's case policy.
fn tag_prefix_positions(line: &str, prefix: &str, html_tag: bool) -> Vec<usize> {
    line.match_indices('<')
        .filter(|(start, _)| {
            let Some(found) = line[*start..].get(..prefix.len()) else {
                return false;
            };
            let matches = if html_tag {
                found.eq_ignore_ascii_case(prefix)
            } else {
                found == prefix
            };
            matches && line[start + prefix.len()..]
                .chars()
                .next()
                .map_or(true, |c| c.is_whitespace() || c == '>' || c == '/')
        })
        .map(|(start, _)| start)
        .collect()
}

fn matches_query(line: &str, query: &str, tag: Option<&str>) -> bool {
    if let Some(tag) = tag.filter(|tag| query == format!("<{}", tag)) {
        return !tag_prefix_positions(line, query, is_html_tag(tag)).is_empty();
    }
    line.contains(query)
}

/// Whether a tag-only match shares its first or last line with other markup:
/// a second opener of the tag on the opening line (a sibling or a nested
/// element of the same tag), text before the opener, or anything after the
/// element's own end. Wrap and accept replace whole lines, so such a range
/// would take its neighbours with it. `lines` come from `mask_markup`, so
/// markup inside a comment or a script is no neighbour.
fn shares_boundary_line(lines: &[String], m: ElementMatch, tag: &str) -> bool {
    let html_tag = is_html_tag(tag);
    let start_text = &lines[m.start_line];
    let openers = tag_prefix_positions(start_text, &format!("<{}", tag), html_tag);
    let Some(&first) = openers.first() else {
        return false;
    };
    if openers.len() > 1 || !start_text[..first].trim().is_empty() {
        return true;
    }
    let last = m.end_line.unwrap_or(m.start_line);
    // Where the element really ends: the opener's own `>` for a void or
    // self-closing tag, else the close that balances it (nested same-name
    // children counted), read by the scanner `find_closing_line` uses.
    // Anything after that within the range is a neighbour, and a scan that
    // cannot find the end fails closed.
    let void = html_tag && matches!(tag.to_ascii_lowercase().as_str(),
        "area" | "base" | "br" | "col" | "embed" | "hr" | "img" | "input" | "link" | "meta" | "param" | "source" | "track" | "wbr");
    let written: String = start_text[first + 1..].chars().take(tag.chars().count()).collect();
    let Some((end_line, end_col)) = scan_element(lines, m.start_line, &written, void).1 else {
        return true;
    };
    if end_line > last {
        return true;
    }
    if lines[end_line].chars().skip(end_col).any(|c| !is_js_whitespace(c)) {
        return true;
    }
    lines[end_line + 1..=last].iter().any(|l| !l.trim().is_empty())
}

/// A tag-only match whose boundary lines hold other markup is refused rather
/// than wrapped line by line.
fn refuse_shared_lines(resolved: Resolution, queries: &[String], tag: Option<&str>) -> Resolution {
    let Some(tag) = tag.filter(|_| is_tag_only_search(queries, tag)) else {
        return resolved;
    };
    match resolved {
        Resolution::Match(file, m) if shares_boundary_line(&mask_markup(&file.lines), m, tag) => {
            Resolution::SharedLine(file, m)
        }
        Resolution::TextNotInFile(file, candidates)
            if candidates.len() == 1 && shares_boundary_line(&mask_markup(&file.lines), candidates[0], tag) =>
        {
            Resolution::SharedLine(file, candidates[0])
        }
        other => other,
    }
}

/// The refusal wrap and insert print for a `SharedLine` resolution.
pub fn element_shared_line_error(file: &str, m: ElementMatch) -> Value {
    json!({
        "error": "element_ambiguous",
        "fallback": "agent-driven",
        "reason": "shared_line",
        "file": file,
        "candidates": candidates_json(&[m]),
        "hint": "The element shares a source line with other markup, so a wrapper around its lines would take that markup with it. Write the wrapper manually with each marker on a line of its own. See \"Handle fallback\" in live.md.",
    })
}

/// JS: OPENER_RE = /<([A-Za-z][A-Za-z0-9]*)(?=[\s/>]|$)/  (first match's tag)
pub fn opener_tag(line: &str) -> Option<String> {
    let chars: Vec<char> = line.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '<' && i + 1 < chars.len() && chars[i + 1].is_ascii_alphabetic() {
            let mut j = i + 1;
            while j < chars.len() && chars[j].is_ascii_alphanumeric() {
                j += 1;
            }
            let ok = j >= chars.len()
                || is_js_whitespace(chars[j])
                || chars[j] == '/'
                || chars[j] == '>';
            if ok {
                return Some(chars[i + 1..j].iter().collect());
            }
        }
        i += 1;
    }
    None
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ElementMatch {
    pub start_line: usize,
    /// None when the element never closes; callers refuse rather than guess.
    pub end_line: Option<usize>,
}

/// The refusal wrap and insert print for a match with no end line.
pub fn element_unclosed_error(file: &str, start_line: usize) -> Value {
    json!({
        "error": "element_unclosed",
        "fallback": "agent-driven",
        "file": file,
        "startLine": start_line + 1,
        "hint": "Found the element's opening tag at startLine but not where it closes. Find its end and write the scaffold manually. See \"Handle fallback\" in live.md.",
    })
}

fn skip_line(line: &str) -> bool {
    let stripped = trim(line);
    stripped.starts_with("<!--") || stripped.starts_with("{/*") || stripped.starts_with("//")
}

/// JS: findElement(lines, query, tag)
pub fn find_element(lines: &[String], query: &str, tag: Option<&str>) -> Option<ElementMatch> {
    // Markup inside a comment or a script is no match.
    let masked = mask_markup(lines);
    for (i, line) in lines.iter().enumerate() {
        if !matches_query(&masked[i], query, tag) {
            continue;
        }
        if skip_line(line) {
            continue;
        }
        if line.contains("data-impeccable-variant") {
            continue;
        }
        let Some(opener) = find_opener_line(&masked, i, tag) else {
            continue;
        };
        return Some(ElementMatch {
            start_line: opener,
            end_line: find_closing_line(&masked, opener),
        });
    }
    None
}

/// JS: findAllElements(lines, query, tag)
pub fn find_all_elements(lines: &[String], query: &str, tag: Option<&str>) -> Vec<ElementMatch> {
    let mut out = Vec::new();
    let mut seen: Vec<usize> = Vec::new();
    let masked = mask_markup(lines);
    for (i, line) in lines.iter().enumerate() {
        if !matches_query(&masked[i], query, tag) {
            continue;
        }
        if skip_line(line) {
            continue;
        }
        if line.contains("data-impeccable-variant") {
            continue;
        }
        let Some(opener) = find_opener_line(&masked, i, tag) else {
            continue;
        };
        if seen.contains(&opener) {
            continue;
        }
        seen.push(opener);
        out.push(ElementMatch {
            start_line: opener,
            end_line: find_closing_line(&masked, opener),
        });
    }
    out
}

static TAG_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"<[^>]*>").unwrap());
static JSX_EXPR_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\{[^}]*\}").unwrap());
static WS_RUN_RE: Lazy<Regex> = Lazy::new(|| Regex::new(&format!("{}+", WS)).unwrap());

/// JS: filterByText(candidates, lines, text)
pub fn filter_by_text(
    candidates: &[ElementMatch],
    lines: &[String],
    text: &str,
) -> Vec<ElementMatch> {
    let collapsed = WS_RUN_RE.replace_all(text, " ");
    let trimmed: String = trim(&collapsed).to_lowercase().chars().take(80).collect();
    if trimmed.encode_utf16().count() < 8 {
        return Vec::new();
    }
    let target_spaced = trimmed.clone();
    let target_compact = WS_RUN_RE.replace_all(&trimmed, "").into_owned();
    candidates
        .iter()
        .filter(|c| {
            // An unclosed element has no end to read up to. For matching only,
            // look ahead a fixed window; nothing is written from this range.
            let end = c
                .end_line
                .unwrap_or_else(|| (c.start_line + 50).min(lines.len() - 1));
            let body = lines[c.start_line..=end].join(" ");
            let inner = TAG_RE.replace_all(&body, " ");
            let inner = JSX_EXPR_RE.replace_all(&inner, " ");
            let inner = inner.to_lowercase();
            let spaced = WS_RUN_RE.replace_all(&inner, " ");
            let source_spaced = trim(&spaced);
            let source_compact = WS_RUN_RE.replace_all(&inner, "");
            source_spaced.contains(&target_spaced) || source_compact.contains(&target_compact)
        })
        .copied()
        .collect()
}

/// Candidates whose whole text is `text`. A short heading ("Pricing") is too
/// short to trust as a substring, but as an element's entire text it is exact.
fn filter_by_whole_text(
    candidates: &[ElementMatch],
    lines: &[String],
    text: &str,
) -> Vec<ElementMatch> {
    let collapsed = WS_RUN_RE.replace_all(text, " ");
    let target = trim(&collapsed).to_lowercase();
    if target.is_empty() {
        return Vec::new();
    }
    candidates
        .iter()
        .filter(|c| {
            let Some(end) = c.end_line else {
                return false;
            };
            let body = lines[c.start_line..=end].join(" ");
            let inner = TAG_RE.replace_all(&body, " ");
            let inner = inner.to_lowercase();
            let spaced = WS_RUN_RE.replace_all(&inner, " ");
            trim(&spaced) == target
        })
        .copied()
        .collect()
}

/// Whether `text` is long enough (8 normalized chars) to choose between
/// elements; `filter_by_text` matches nothing below that.
fn text_disambiguates(text: &str) -> bool {
    let collapsed = WS_RUN_RE.replace_all(text, " ");
    trim(&collapsed).encode_utf16().count() >= 8
}

/// Every element any query finds, first-found order. Stops at the first query
/// that leaves exactly one candidate.
fn collect_candidates(lines: &[String], queries: &[String], tag: Option<&str>) -> Vec<ElementMatch> {
    let mut candidates: Vec<ElementMatch> = Vec::new();
    for q in queries {
        for c in find_all_elements(lines, q, tag) {
            if !candidates.iter().any(|x| x.start_line == c.start_line) {
                candidates.push(c);
            }
        }
        if candidates.len() == 1 {
            break;
        }
    }
    candidates
}

/// JS: findOpenerLine(lines, matchLine, tag)
/// The browser reports the rendered tag lowercased, so a source `<Input>` matches `input`.
pub fn find_opener_line(lines: &[String], match_line: usize, tag: Option<&str>) -> Option<usize> {
    if let Some(t) = opener_tag(&lines[match_line]) {
        return match tag {
            None => Some(match_line),
            Some(want) if want.eq_ignore_ascii_case(&t) => Some(match_line),
            _ => None,
        };
    }
    const MAX_BACKWALK: usize = 10;
    let floor = match_line.saturating_sub(MAX_BACKWALK);
    let mut i = match_line;
    while i > floor {
        i -= 1;
        let Some(t) = opener_tag(&lines[i]) else {
            continue;
        };
        return match tag {
            None => Some(i),
            Some(want) if want.eq_ignore_ascii_case(&t) => Some(i),
            _ => None,
        };
    }
    None
}

/// The line the element opened on `start` closes on. None when it never
/// closes: a guessed end would hand the caller the element's neighbours.
pub fn find_closing_line(lines: &[String], start: usize) -> Option<usize> {
    let Some(tag_name) = opener_tag(&lines[start]) else {
        return Some(start);
    };
    scan_element(lines, start, &tag_name, false).0
}

/// The element scan behind `find_closing_line`, for the element whose opener
/// `<tag_name` leads line `start`. Returns the line where the depth first sits
/// at zero at a line's end (`find_closing_line`'s answer), and the line and
/// char index just past the `>` where the depth first reaches zero. With
/// `void`, the opener's own `>` ends the element. Tags are read by
/// `lex_markup`, so comments, raw text and quoted values never count.
fn scan_element(lines: &[String], start: usize, tag_name: &str, void: bool) -> (Option<usize>, Option<(usize, usize)>) {
    let fold = folds_tag_case(tag_name);
    let same = |name: &str| if fold { name.eq_ignore_ascii_case(tag_name) } else { name == tag_name };
    let mut first_zero: Option<(usize, usize)> = None;
    let mut opener_open = true;
    let mut depth: i64 = 0;
    let mut result = (None, None);
    lex_markup(lines, start, |event| {
        match event {
            Lexed::Open { name } if same(name) => depth += 1,
            Lexed::OpenEnd { name, line, col, self_closing } if same(name) => {
                if self_closing {
                    depth -= 1;
                    if depth <= 0 && first_zero.is_none() {
                        first_zero = Some((line, col));
                    }
                } else if void && std::mem::take(&mut opener_open) && first_zero.is_none() {
                    result = (None, Some((line, col)));
                    return true;
                }
                opener_open = false;
            }
            Lexed::Close { name, line, col } if same(name) => {
                depth -= 1;
                if depth <= 0 && first_zero.is_none() {
                    first_zero = Some((line, col));
                }
            }
            Lexed::LineEnd { line } if depth <= 0 => {
                result = (Some(line), first_zero);
                return true;
            }
            _ => {}
        }
        false
    });
    if result.0.is_none() && result.1.is_none() {
        result.1 = first_zero;
    }
    result
}

/// Whether a tag name matches case-insensitively. HTML names do; a JSX
/// component (`Card`, an uppercase letter followed by lowercase ones) keeps
/// its exact case.
fn folds_tag_case(name: &str) -> bool {
    name.is_ascii()
        && !(name.starts_with(|c: char| c.is_ascii_uppercase()) && name.bytes().any(|b| b.is_ascii_lowercase()))
}

/// Elements whose contents are text, not markup.
const RAW_TEXT_TAGS: [&str; 3] = ["script", "style", "textarea"];

/// What `lex_markup` reports. Columns are char indices; `col` is just past
/// the tag's `>`.
enum Lexed<'a> {
    /// `<name` opened a tag.
    Open { name: &'a str },
    /// The open tag's `>`.
    OpenEnd { name: &'a str, line: usize, col: usize, self_closing: bool },
    /// `</name>`, its `>` possibly on the next line.
    Close { name: &'a str, line: usize, col: usize },
    /// Chars `from..to` of `line` are comment or raw-text contents.
    Hidden { line: usize, from: usize, to: usize },
    LineEnd { line: usize },
}

enum LexMode {
    Text,
    Tag { braces: usize, quote: Option<char> },
    HtmlComment,
    JsxComment,
    Raw(String),
}

/// The one markup reader the element scans share. From line `start` it
/// reports tags in order while skipping what is not markup: `<!-- -->` and
/// `{/* */}` comments, the contents of script, style and textarea, and quoted
/// attribute values and `{...}` props inside a tag (where `>` and `<` are
/// text). A tag name matches `[A-Za-z][A-Za-z0-9.:_-]*` followed by
/// whitespace, `/`, `>` or the line's end. `on` returns true to stop.
fn lex_markup(lines: &[String], start: usize, mut on: impl FnMut(Lexed) -> bool) {
    fn name_end(chars: &[char], from: usize) -> usize {
        let mut k = from;
        while k < chars.len() && (chars[k].is_ascii_alphanumeric() || matches!(chars[k], '.' | ':' | '_' | '-')) {
            k += 1;
        }
        k
    }
    let mut mode = LexMode::Text;
    let mut tag_name = String::new();
    let mut pending_close: Option<String> = None;
    for (i, line) in lines.iter().enumerate().skip(start) {
        let chars: Vec<char> = line.chars().collect();
        let n = chars.len();
        let mut j = 0;
        if let Some(name) = pending_close.take() {
            if let Some(k) = chars.iter().position(|c| !is_js_whitespace(*c)).filter(|&k| chars[k] == '>') {
                if on(Lexed::Close { name: &name, line: i, col: k + 1 }) {
                    return;
                }
                j = k + 1;
            }
        }
        let mut hidden_from = 0;
        let mut escaped = false;
        while j < n {
            let c = chars[j];
            match &mut mode {
                LexMode::Text => {
                    if c == '<' && chars[j + 1..].starts_with(&['!', '-', '-']) {
                        mode = LexMode::HtmlComment;
                        j += 4;
                        hidden_from = j;
                        continue;
                    }
                    if c == '{' && chars[j + 1..].starts_with(&['/', '*']) {
                        mode = LexMode::JsxComment;
                        j += 3;
                        hidden_from = j;
                        continue;
                    }
                    if c == '<' && chars.get(j + 1) == Some(&'/') && chars.get(j + 2).map_or(false, |c| c.is_ascii_alphabetic()) {
                        let end = name_end(&chars, j + 2);
                        let name: String = chars[j + 2..end].iter().collect();
                        match chars[end..].iter().position(|c| !is_js_whitespace(*c)) {
                            Some(k) if chars[end + k] == '>' => {
                                if on(Lexed::Close { name: &name, line: i, col: end + k + 1 }) {
                                    return;
                                }
                                j = end + k + 1;
                                continue;
                            }
                            None => {
                                pending_close = Some(name);
                                j = n;
                                continue;
                            }
                            _ => {}
                        }
                    } else if c == '<' && chars.get(j + 1).map_or(false, |c| c.is_ascii_alphabetic()) {
                        let end = name_end(&chars, j + 1);
                        if end >= n || is_js_whitespace(chars[end]) || chars[end] == '/' || chars[end] == '>' {
                            tag_name = chars[j + 1..end].iter().collect();
                            if on(Lexed::Open { name: &tag_name }) {
                                return;
                            }
                            mode = LexMode::Tag { braces: 0, quote: None };
                            j = end;
                            continue;
                        }
                    }
                }
                LexMode::Tag { braces, quote } => {
                    if let Some(q) = *quote {
                        // A JS string takes backslash escapes; an attribute
                        // value does not.
                        if escaped {
                            escaped = false;
                        } else if *braces > 0 && c == '\\' {
                            escaped = true;
                        } else if c == q {
                            *quote = None;
                        }
                    } else if c == '{' {
                        *braces += 1;
                    } else if c == '}' {
                        *braces = braces.saturating_sub(1);
                    } else if c == '"' || c == '\'' || c == '`' {
                        // Outside `{...}` a quote opens an attribute value.
                        // Inside, a backtick opens a template literal, and `"`
                        // or `'` open a JS string only when it closes on this
                        // line and is no contraction: an apostrophe in a
                        // comment or in text is not a delimiter.
                        let opens = if *braces == 0 {
                            c != '`'
                        } else {
                            c == '`'
                                || chars[j + 1..].contains(&c)
                                    && !(c == '\'' && j > 0 && chars[j - 1].is_alphanumeric())
                        };
                        if opens {
                            *quote = Some(c);
                        }
                    } else if *braces == 0 && c == '>' {
                        let self_closing = j > 0 && chars[j - 1] == '/';
                        if on(Lexed::OpenEnd { name: &tag_name, line: i, col: j + 1, self_closing }) {
                            return;
                        }
                        let raw = tag_name.to_ascii_lowercase();
                        mode = if !self_closing && RAW_TEXT_TAGS.contains(&raw.as_str()) {
                            hidden_from = j + 1;
                            LexMode::Raw(raw)
                        } else {
                            LexMode::Text
                        };
                    }
                }
                LexMode::HtmlComment => {
                    if chars[j..].starts_with(&['-', '-', '>']) {
                        if on(Lexed::Hidden { line: i, from: hidden_from, to: j }) {
                            return;
                        }
                        mode = LexMode::Text;
                        j += 3;
                        continue;
                    }
                }
                LexMode::JsxComment => {
                    if chars[j..].starts_with(&['*', '/']) {
                        if on(Lexed::Hidden { line: i, from: hidden_from, to: j }) {
                            return;
                        }
                        mode = LexMode::Text;
                        j += if chars.get(j + 2) == Some(&'}') { 3 } else { 2 };
                        continue;
                    }
                }
                LexMode::Raw(raw) => {
                    if c == '<' && chars.get(j + 1) == Some(&'/') {
                        let end = name_end(&chars, j + 2);
                        let name: String = chars[j + 2..end].iter().collect();
                        let bounded = end >= n || is_js_whitespace(chars[end]) || chars[end] == '>' || chars[end] == '/';
                        if bounded && name.eq_ignore_ascii_case(raw) {
                            if on(Lexed::Hidden { line: i, from: hidden_from, to: j }) {
                                return;
                            }
                            // The close itself is read in text mode.
                            mode = LexMode::Text;
                            continue;
                        }
                    }
                }
            }
            j += 1;
        }
        if matches!(mode, LexMode::HtmlComment | LexMode::JsxComment | LexMode::Raw(_)) && hidden_from < n {
            if on(Lexed::Hidden { line: i, from: hidden_from, to: n }) {
                return;
            }
        }
        if on(Lexed::LineEnd { line: i }) {
            return;
        }
    }
}

/// `lines` with the contents of comments and raw-text elements blanked to
/// spaces, char for char, so line numbers and char columns still hold. The
/// delimiters stay, so a comment still reads as something on its line.
pub(crate) fn mask_markup(lines: &[String]) -> Vec<String> {
    let mut out: Vec<Vec<char>> = lines.iter().map(|l| l.chars().collect()).collect();
    lex_markup(lines, 0, |event| {
        if let Lexed::Hidden { line, from, to } = event {
            for c in &mut out[line][from..to] {
                *c = ' ';
            }
        }
        false
    });
    out.into_iter().map(|l| l.into_iter().collect()).collect()
}

/// JS: detectCommentSyntax(filePath) → (open, close)
pub fn detect_comment_syntax(file_path: &str) -> (&'static str, &'static str) {
    if resolve_source_traits(file_path).comment_syntax == "jsx" {
        ("{/*", "*/}")
    } else {
        ("<!--", "-->")
    }
}

pub fn comment_syntax_value(cs: (&str, &str)) -> Value {
    json!({ "open": cs.0, "close": cs.1 })
}

/// JS: buildCssSelectorPrefixExamples(styleMode, count)
pub fn build_css_selector_prefix_examples(style_mode: &str, count: i64) -> Vec<String> {
    if style_mode != "astro-global-prefixed" {
        return Vec::new();
    }
    (1..=count.max(0))
        .map(|i| format!("[data-impeccable-variant=\"{}\"]", i))
        .collect()
}

/// JS: buildCssAuthoring(styleMode, count), read from the file's source traits.
pub fn build_css_authoring(traits: &SourceTraits, count: i64) -> Value {
    let (mode, style_tag, style_close) = (traits.style_mode, traits.style_tag, traits.style_close);
    let numbers: Vec<i64> = (1..=count.max(0)).collect();
    if mode == "astro-global-prefixed" {
        return json!({
            "mode": mode,
            "styleTag": style_tag,
            "styleClose": style_close,
            "strategy": "global-prefixed",
            "rulePattern": "[data-impeccable-variant=\"N\"] > .variant-class { ... }",
            "selectorExamples": numbers.iter().map(|n| format!("[data-impeccable-variant=\"{}\"] > .variant-class", n)).collect::<Vec<_>>(),
            "requirements": [
                "Use the styleTag exactly; the is:inline attribute is required for this file.",
                "Put raw CSS directly between the styleTag opening and a plain </style> close.",
                "Prefix every preview selector with the matching [data-impeccable-variant=\"N\"] selector.",
                "Keep selectors anchored to the generated variant wrapper; do not rely on component CSS scoping for preview rules.",
            ],
            "forbidden": [
                "Do not use @scope for this styleMode.",
                "Do not wrap style content in a JSX/TSX template literal ({` ... `}); that syntax is for .tsx/.jsx only.",
                "Do not put { immediately after the style opening tag; Astro parses { as expression syntax.",
            ],
        });
    }
    json!({
        "mode": mode,
        "styleTag": style_tag,
        "styleClose": style_close,
        "strategy": "scope-rule",
        "rulePattern": "@scope ([data-impeccable-variant=\"N\"]) { :scope > .variant-class { ... } }",
        "selectorExamples": numbers.iter().map(|n| format!("@scope ([data-impeccable-variant=\"{}\"]) {{ :scope > .variant-class {{ ... }} }}", n)).collect::<Vec<_>>(),
        "requirements": [
            "Use @scope blocks keyed to each [data-impeccable-variant=\"N\"] wrapper.",
            "Inside each @scope block, make :scope rules step into the replacement element with a descendant combinator.",
            "Use the styleTag exactly; do not add framework-specific style attributes unless this object says to.",
        ],
        "forbidden": [
            "Do not use global [data-impeccable-variant=\"N\"] selector prefixes for this styleMode.",
            "Do not add is:inline to the style tag for this styleMode.",
        ],
    })
}

/// JS: findFileWithQuery(query, cwd, genOpts)
pub fn find_file_with_query(
    query: &str,
    cwd: &str,
    include_generated: bool,
    tag: Option<&str>,
) -> Option<String> {
    let extensions = resolve_live_template_extensions(cwd);
    let filter = |p: &str| include_generated || !is_generated_file(p, cwd);
    if !tag.map_or(false, |tag| query == format!("<{}", tag)) {
        return find_source_file(query, cwd, &extensions, &NEVER_SOURCE_DIRS, &filter);
    }
    // The walker prefilter must allow uppercase HTML tags. Element matching
    // enforces the tag's case policy and boundary for generated-file hints too.
    let mut found = None;
    visit_source_files(
        "<",
        cwd,
        &extensions,
        &NEVER_SOURCE_DIRS,
        &filter,
        &mut |path, content| {
            let file = SourceFile::from_content(path, content);
            if find_all_elements(&file.lines, query, tag).is_empty() {
                return false;
            }
            found = Some(path.to_string());
            true
        },
    );
    found
}

/// A source file read once for element resolution: the path as the caller
/// spelled it (absolute from the search, verbatim from `--file`) and its lines.
pub struct SourceFile {
    pub path: String,
    pub lines: Vec<String>,
}

impl SourceFile {
    pub fn read(cwd: &str, path: &str) -> Option<Self> {
        let content = safe_read(&jsp::resolve(cwd, &[path]))?;
        Some(Self::from_content(path, &content))
    }

    fn from_content(path: &str, content: &str) -> Self {
        SourceFile {
            path: path.to_string(),
            lines: content.split('\n').map(String::from).collect(),
        }
    }
}

/// JS: resolveElementMatch, grown across files. How the locator queries, and
/// the picked text when it has at least 8 normalized chars, resolved.
pub enum Resolution {
    /// One element: the first the locator finds, or the one the text picks.
    Match(SourceFile, ElementMatch),
    /// Several elements in the file carry the text.
    Ambiguous(SourceFile, Vec<ElementMatch>),
    /// The file's candidates carry the text nowhere.
    TextNotInFile(SourceFile, Vec<ElementMatch>),
    /// The locator hits several files (path, candidates); the text is in none
    /// of their candidates.
    TextInNoFile(Vec<(String, Vec<ElementMatch>)>),
    /// The file (its path as spelled) holds no element for the locator.
    NotLocated(String),
    /// No source file contains the locator.
    NotFound,
    /// Tag-only targeting leaves candidates in several source files.
    AmbiguousFiles(Vec<(String, Vec<ElementMatch>)>),
    /// A tag-only match that shares its first or last line with other markup.
    SharedLine(SourceFile, ElementMatch),
}

/// Resolve the locator inside one file.
pub fn resolve_in_file(
    file: SourceFile,
    queries: &[String],
    tag: Option<&str>,
    text: Option<&str>,
) -> Resolution {
    refuse_shared_lines(resolve_file_lines(file, queries, tag, text), queries, tag)
}

fn resolve_file_lines(
    file: SourceFile,
    queries: &[String],
    tag: Option<&str>,
    text: Option<&str>,
) -> Resolution {
    // A bare element with short text: its whole text may still single it out.
    if is_tag_only_search(queries, tag) {
        if let Some(short) = text.filter(|t| !text_disambiguates(t)) {
            let candidates = collect_candidates(&file.lines, queries, tag);
            let whole = filter_by_whole_text(&candidates, &file.lines, short);
            if whole.len() == 1 {
                return Resolution::Match(file, whole[0]);
            }
        }
    }
    resolve_lines(file, queries, tag, text.filter(|t| text_disambiguates(t)))
}

/// The in-file pass; `text` is already known to disambiguate.
fn resolve_lines(
    file: SourceFile,
    queries: &[String],
    tag: Option<&str>,
    text: Option<&str>,
) -> Resolution {
    let Some(text) = text else {
        if is_tag_only_search(queries, tag) {
            let candidates = collect_candidates(&file.lines, queries, tag);
            return match candidates.len() {
                0 => Resolution::NotLocated(file.path),
                1 => Resolution::Match(file, candidates[0]),
                _ => Resolution::Ambiguous(file, candidates),
            };
        }
        for q in queries {
            if let Some(m) = find_element(&file.lines, q, tag) {
                return Resolution::Match(file, m);
            }
        }
        return Resolution::NotLocated(file.path);
    };
    let candidates = collect_candidates(&file.lines, queries, tag);
    if candidates.is_empty() {
        return Resolution::NotLocated(file.path);
    }
    let filtered = filter_by_text(&candidates, &file.lines, text);
    match filtered.len() {
        0 => Resolution::TextNotInFile(file, candidates),
        1 => Resolution::Match(file, filtered[0]),
        _ => Resolution::Ambiguous(file, filtered),
    }
}

/// Resolve the locator across the project's source files (JS-era
/// `findFileWithQuery` over every query, then the in-file pass): the first
/// file the first hitting query matches, or with usable text the first such
/// file whose candidates carry the text. A file the query hits without a
/// candidate (the class in a `<style>` block, or on another tag) says nothing
/// about the text and only counts when no file has a candidate.
pub fn resolve_in_project(
    queries: &[String],
    cwd: &str,
    tag: Option<&str>,
    text: Option<&str>,
) -> Resolution {
    if is_tag_only_search(queries, tag) {
        return refuse_shared_lines(resolve_tag_in_project(queries, cwd, tag, text), queries, tag);
    }
    let text = text.filter(|t| text_disambiguates(t));
    let extensions = resolve_live_template_extensions(cwd);
    let filter = |p: &str| !is_generated_file(p, cwd);
    for q in queries {
        let mut chosen: Option<Resolution> = None;
        // A miss keeps its path and ranges; only the first keeps its lines,
        // for the single-miss fallback.
        let mut misses: Vec<(String, Vec<ElementMatch>)> = Vec::new();
        let mut first_miss: Option<SourceFile> = None;
        let mut unlocated: Option<String> = None;
        visit_source_files(
            q,
            cwd,
            &extensions,
            &NEVER_SOURCE_DIRS,
            &filter,
            &mut |path, content| {
                let resolved =
                    resolve_lines(SourceFile::from_content(path, content), queries, tag, text);
                if text.is_none() {
                    chosen = Some(resolved);
                    return true;
                }
                match resolved {
                    Resolution::TextNotInFile(file, candidates) => {
                        misses.push((file.path.clone(), candidates));
                        first_miss.get_or_insert(file);
                    }
                    Resolution::NotLocated(path) => {
                        unlocated.get_or_insert(path);
                    }
                    found => {
                        chosen = Some(found);
                        return true;
                    }
                }
                false
            },
        );
        if let Some(resolved) = chosen {
            return resolved;
        }
        if misses.len() > 1 {
            return Resolution::TextInNoFile(misses);
        }
        if let Some(file) = first_miss {
            return Resolution::TextNotInFile(file, misses.remove(0).1);
        }
        match unlocated {
            Some(path) => return Resolution::NotLocated(path),
            None => continue,
        }
    }
    Resolution::NotFound
}

/// Tag-only locators must consider every source candidate, including across files.
fn resolve_tag_in_project(
    queries: &[String],
    cwd: &str,
    tag: Option<&str>,
    text: Option<&str>,
) -> Resolution {
    let extensions = resolve_live_template_extensions(cwd);
    let filter = |p: &str| !is_generated_file(p, cwd);
    let mut files = Vec::new();
    visit_source_files(
        "<",
        cwd,
        &extensions,
        &NEVER_SOURCE_DIRS,
        &filter,
        &mut |path, content| {
            let file = SourceFile::from_content(path, content);
            let candidates = collect_candidates(&file.lines, queries, tag);
            if !candidates.is_empty() {
                files.push((file, candidates));
            }
            false
        },
    );
    if files.is_empty() {
        return Resolution::NotFound;
    }
    if let Some(short) = text.filter(|t| !text_disambiguates(t)) {
        // Short text: exactly one element in the project whose whole text it is.
        let whole: Vec<(usize, ElementMatch)> = files
            .iter()
            .enumerate()
            .flat_map(|(i, (file, candidates))| {
                filter_by_whole_text(candidates, &file.lines, short)
                    .into_iter()
                    .map(move |m| (i, m))
            })
            .collect();
        if whole.len() == 1 {
            let (index, m) = whole[0];
            return Resolution::Match(files.remove(index).0, m);
        }
    }
    let text = text.filter(|t| text_disambiguates(t));
    if let Some(text) = text {
        let matching: Vec<_> = files
            .iter()
            .filter_map(|(file, candidates)| {
                let filtered = filter_by_text(candidates, &file.lines, text);
                if filtered.is_empty() {
                    None
                } else {
                    Some((file.path.clone(), filtered))
                }
            })
            .collect();
        if matching.len() > 1 {
            return Resolution::AmbiguousFiles(matching);
        }
        if let Some((path, _)) = matching.first() {
            let index = files.iter().position(|(file, _)| &file.path == path).unwrap();
            return resolve_lines(files.remove(index).0, queries, tag, Some(text));
        }
        if files.len() > 1 {
            return Resolution::TextInNoFile(files.into_iter().map(|(f, c)| (f.path, c)).collect());
        }
    } else if files.len() > 1 {
        return Resolution::AmbiguousFiles(files.into_iter().map(|(f, c)| (f.path, c)).collect());
    }
    resolve_lines(files.remove(0).0, queries, tag, text)
}

/// Candidate ranges in the JS shape `{ startLine, endLine }` (1-indexed).
pub fn candidates_json(list: &[ElementMatch]) -> Vec<Value> {
    list.iter()
        .map(|c| json!({ "startLine": c.start_line + 1, "endLine": c.end_line.map(|e| e + 1) }))
        .collect()
}

/// The same ranges across files, each naming its project-relative `file` first.
pub fn file_candidates_json(cwd: &str, hits: &[(String, Vec<ElementMatch>)]) -> Vec<Value> {
    hits.iter()
        .flat_map(|(path, list)| {
            let file = jsp::relative("/", cwd, &jsp::resolve(cwd, &[path]));
            list.iter().map(move |c| {
                json!({ "file": file, "startLine": c.start_line + 1, "endLine": c.end_line.map(|e| e + 1) })
            })
        })
        .collect()
}

/// `parseInt(x || '3')` for `--count`.
pub fn parse_count(v: Option<&str>) -> i64 {
    let raw = match v {
        Some(s) if !s.is_empty() => s,
        _ => "3",
    };
    let n = impeccable_core::js::parse_int(raw, 10);
    if n.is_nan() {
        // JS: NaN interpolates as "NaN" and Array.from({length: NaN}) is [].
        i64::MIN
    } else {
        n as i64
    }
}

/// `String(count)` for interpolation: NaN prints as "NaN".
pub fn count_text(count: i64) -> String {
    if count == i64::MIN {
        "NaN".to_string()
    } else {
        count.to_string()
    }
}

/// `count` as a length for `Array.from({ length: count })`.
pub fn count_len(count: i64) -> i64 {
    if count == i64::MIN {
        0
    } else {
        count
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lines(src: &[&str]) -> Vec<String> {
        src.iter().map(|l| l.to_string()).collect()
    }

    struct TagProject(std::path::PathBuf);

    impl TagProject {
        fn new(file: &str, source: &str) -> Self {
            static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
            let serial = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            let dir = std::env::temp_dir().join(format!("impeccable-tag-only-{}-{}", std::process::id(), serial));
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(dir.join("package.json"), "{}").unwrap();
            std::fs::write(dir.join(file), source).unwrap();
            Self(dir)
        }

        fn run(&self, insert: bool, extra: &[&str]) -> (i32, String, String) {
            let (mut io, captured) = impeccable_common::Io::captured("", self.0.clone(), Default::default());
            let mut args: Vec<String> = ["--id", "ab12cd34", "--count", "3"]
                .iter().map(|s| s.to_string()).collect();
            args.extend(extra.iter().map(|s| s.to_string()));
            let code = if insert {
                args.extend(["--position".to_string(), "after".to_string()]);
                crate::live_insert::run(&args, &mut io)
            } else {
                crate::live_wrap::run(&args, &mut io)
            };
            drop(io);
            let out = String::from_utf8(captured.stdout.borrow().clone()).unwrap();
            let err = String::from_utf8(captured.stderr.borrow().clone()).unwrap();
            (code, out, err)
        }

        fn source(&self, file: &str) -> String {
            std::fs::read_to_string(self.0.join(file)).unwrap()
        }
    }

    impl Drop for TagProject {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn empty_locator_error_lists_tag_for_wrap_and_insert() {
        for insert in [false, true] {
            let project = TagProject::new("index.html", "<h1>Harbor Coffee</h1>\n");
            let (code, _, err) = project.run(insert, &["--element-id", "", "--classes", "", "--tag", "", "--query", ""]);
            assert_eq!(code, 1);
            assert_eq!(err.trim(), "Need at least one of: --element-id, --classes, --tag, --query");
        }
    }

    #[test]
    fn tag_only_html_matching_ignores_ascii_case_in_files_and_projects() {
        let project = TagProject::new("index.html", "<H1>Title</H1>\n");
        let cwd = project.0.to_str().unwrap();
        let queries = build_search_queries(None, None, Some("h1"), None);
        assert!(matches_query("<H1>Title</H1>", &queries[0], Some("h1")));
        assert!(!matches_query("<H10>Other</H10>", &queries[0], Some("h1")));
        assert!(find_element(&lines(&["<H1>Title</H1>"]), &queries[0], Some("h1")).is_some());
        assert!(matches!(
            resolve_in_project(&queries, cwd, Some("h1"), None),
            Resolution::Match(_, ElementMatch { start_line: 0, end_line: Some(0) })
        ));
        assert_eq!(
            find_file_with_query(&queries[0], cwd, true, Some("h1")),
            Some(project.0.join("index.html").to_string_lossy().into_owned())
        );
    }

    #[test]
    fn tag_only_component_matching_preserves_case() {
        let project = TagProject::new("App.jsx", "<card>Title</card>\n");
        let cwd = project.0.to_str().unwrap();
        let queries = build_search_queries(None, None, Some("Card"), None);
        assert!(!matches_query("<card>Title</card>", &queries[0], Some("Card")));
        assert!(matches_query("<Card>Title</Card>", &queries[0], Some("Card")));
        assert!(matches!(
            resolve_in_project(&queries, cwd, Some("Card"), None),
            Resolution::NotFound
        ));
        assert!(find_file_with_query(&queries[0], cwd, true, Some("Card")).is_none());
    }

    #[test]
    fn tag_only_project_short_text_selects_a_unique_whole_heading() {
        let project = TagProject::new("index.html", "<h2>First</h2>\n<h2>Second</h2>\n");
        let queries = build_search_queries(None, None, Some("h2"), None);
        assert!(matches!(
            resolve_in_project(&queries, project.0.to_str().unwrap(), Some("h2"), Some("Second")),
            Resolution::Match(_, ElementMatch { start_line: 1, end_line: Some(1) })
        ));
    }

    #[test]
    fn tag_only_project_short_text_keeps_duplicate_headings_ambiguous() {
        let project = TagProject::new("index.html", "<h2>Same</h2>\n<h2>Same</h2>\n");
        let queries = build_search_queries(None, None, Some("h2"), None);
        match resolve_in_project(&queries, project.0.to_str().unwrap(), Some("h2"), Some("Same")) {
            Resolution::Ambiguous(_, candidates) => assert_eq!(candidates.len(), 2),
            _ => panic!("duplicate whole text must remain ambiguous"),
        }
    }

    #[test]
    fn tag_only_project_short_text_does_not_select_a_substring() {
        let project = TagProject::new("index.html", "<h2>First heading</h2>\n<h2>Second heading</h2>\n");
        let queries = build_search_queries(None, None, Some("h2"), None);
        match resolve_in_project(&queries, project.0.to_str().unwrap(), Some("h2"), Some("Second")) {
            Resolution::Ambiguous(_, candidates) => assert_eq!(candidates.len(), 2),
            _ => panic!("short text must only disambiguate a whole-text match"),
        }
    }

    #[test]
    fn tag_only_wrap_surrounds_a_bare_heading_in_html_and_jsx() {
        for (file, source, heading) in [
            ("index.html", "<h1>Harbor Coffee</h1>\n", "<h1>Harbor Coffee</h1>"),
            ("App.jsx", "export default function App() {\n  return (\n    <h1>Get started</h1>\n  );\n}\n", "<h1>Get started</h1>"),
        ] {
            let project = TagProject::new(file, source);
            // Auto-detection, including explicitly empty legacy locator flags.
            let (code, out, err) = project.run(false, &["--tag", "h1", "--element-id", "", "--classes", "", "--query", ""]);
            assert_eq!(code, 0, "{out} {err}");
            let result = project.source(file);
            let wrapper = result.find("data-impeccable-variant=\"original\"").unwrap();
            let target = result.find(heading).unwrap();
            let variants = result.find("Variants: insert below").unwrap();
            assert!(wrapper < target && target < variants, "{result}");
            assert_eq!(result.matches(heading).count(), 1);
        }
    }

    #[test]
    fn tag_only_text_selects_the_second_heading_for_wrap_and_insert() {
        for insert in [false, true] {
            let source = "<h2>First heading</h2>\n<h2>Second heading</h2>\n";
            let project = TagProject::new("index.html", source);
            let (code, out, err) = project.run(insert, &["--file", "index.html", "--tag", "h2", "--text", "Second heading"]);
            assert_eq!(code, 0, "{out} {err}");
            let result = project.source("index.html");
            assert!(result.starts_with("<h2>First heading</h2>\n"), "{result}");
            let wrapper = result.find("data-impeccable-variants=").unwrap();
            let second = result.find("<h2>Second heading</h2>").unwrap();
            assert_eq!(wrapper > second, insert, "{result}");
        }
    }

    #[test]
    fn tag_only_short_text_matches_a_whole_heading_only() {
        let lines: Vec<String> = ["<main>", "  <h2>First</h2>", "  <h2>Second</h2>", "  <h2>Same</h2>", "  <h2>Same</h2>", "  <h2>Second helping</h2>", "</main>"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        let queries = vec!["<h2".to_string()];
        let candidates = collect_candidates(&lines, &queries, Some("h2"));
        assert_eq!(candidates.len(), 5);
        let second = filter_by_whole_text(&candidates, &lines, "Second");
        assert_eq!(second.len(), 1, "a substring match is not a whole-text match");
        assert_eq!(second[0].start_line, 2);
        assert_eq!(filter_by_whole_text(&candidates, &lines, "Same").len(), 2);
        assert!(filter_by_whole_text(&candidates, &lines, "").is_empty());
    }

    #[test]
    fn tag_only_never_guesses_between_headings() {
        for insert in [false, true] {
            for text in [None, Some("Same heading"), Some("Missing rendered heading"), Some("short")] {
                let source = "<h2>Same heading</h2>\n<h2>Same heading</h2>\n";
                let project = TagProject::new("index.html", source);
                let mut args = vec!["--tag", "h2"];
                if let Some(text) = text {
                    args.extend(["--text", text]);
                }
                let (code, out, err) = project.run(insert, &args);
                assert_eq!(code, 1, "{out} {err}");
                let error: Value = serde_json::from_str(err.trim()).unwrap();
                assert_eq!(error["error"], "element_ambiguous");
                assert_eq!(error["fallback"], "agent-driven");
                assert_eq!(project.source("index.html"), source);
            }
        }
    }

    #[test]
    fn tag_only_checks_the_opening_tag_boundary() {
        for tag in ["h1", "h"] {
            let project = TagProject::new("index.html", "<header>Header</header>\n<h10>Other heading</h10>\n");
            let (code, _, err) = project.run(false, &["--tag", tag]);
            assert_eq!(code, 1, "{err}");
            let error: Value = serde_json::from_str(err.trim()).unwrap();
            assert_eq!(error["error"], "element_not_found");
        }
        for heading in ["<h1>Harbor Coffee</h1>", "<h1 title=\"Coffee\">Harbor Coffee</h1>", "<h1\n title=\"Coffee\">Harbor Coffee</h1>"] {
            let project = TagProject::new("index.html", &format!("<header>Header</header>\n<h10>Other</h10>\n{heading}\n"));
            let (code, out, err) = project.run(false, &["--tag", "h1"]);
            assert_eq!(code, 0, "{out} {err}");
            assert!(project.source("index.html").starts_with("<header>Header</header>\n<h10>Other</h10>\n"));
        }
    }

    #[test]
    fn tag_only_does_not_stop_at_one_bare_heading_before_attributed_siblings() {
        let source = "<h2>Same heading</h2>\n<h2 title=\"Other\">Same heading</h2>\n";
        let project = TagProject::new("index.html", source);
        let (code, _, err) = project.run(false, &["--tag", "h2", "--text", "Same heading"]);
        assert_eq!(code, 1, "{err}");
        let error: Value = serde_json::from_str(err.trim()).unwrap();
        assert_eq!(error["error"], "element_ambiguous");
        assert_eq!(project.source("index.html"), source);
    }

    #[test]
    fn tag_only_refuses_a_range_that_shares_its_line_with_other_markup() {
        for insert in [false, true] {
            for (source, text) in [
                ("<h2>First</h2><h2>Second</h2>\n", None),
                ("<h2>First</h2><h2>Second</h2>\n", Some("Second")),
                ("<h2>First</h2><h2>Second</h2>\n", Some("Second heading")),
                ("<main>\n  <h2>First</h2><p>Keep</p>\n</main>\n", None),
                ("<h2>\n  First\n</h2><p>Keep</p>\n", None),
                ("Intro <h2>First</h2>\n", None),
            ] {
                for explicit in [false, true] {
                    let project = TagProject::new("index.html", source);
                    let mut args = vec!["--tag", "h2"];
                    if let Some(text) = text {
                        args.extend(["--text", text]);
                    }
                    if explicit {
                        args.extend(["--file", "index.html"]);
                    }
                    let (code, out, err) = project.run(insert, &args);
                    assert_eq!(code, 1, "{source:?} {out} {err}");
                    let error: Value = serde_json::from_str(err.trim()).unwrap();
                    assert_eq!(error["error"], "element_ambiguous", "{source:?}");
                    assert_eq!(error["reason"], "shared_line", "{source:?}");
                    assert_eq!(error["fallback"], "agent-driven");
                    assert_eq!(project.source("index.html"), source);
                }
            }
        }
    }

    #[test]
    fn tag_only_boundary_check_reads_the_elements_own_end() {
        let m = |start, end| ElementMatch { start_line: start, end_line: Some(end) };
        // A nested child's close is not the parent's: the parent ends at the
        // balancing close, and nothing follows it.
        let nested = lines(&["<div>", "  Outer intro", "  <div>Child</div></div>"]);
        assert!(!shares_boundary_line(&nested, m(0, 2), "div"));
        let nested_tail = lines(&["<div>", "  <div>Child</div></div><p>Keep</p>"]);
        assert!(shares_boundary_line(&nested_tail, m(0, 1), "div"));
        // A multi-line self-closing tag ends at its `/>`.
        let self_closing = lines(&["<Input", "  id=\"email\"", "/><p>Keep</p>"]);
        assert!(shares_boundary_line(&self_closing, m(0, 2), "Input"));
        let lone_self_closing = lines(&["<Input", "  onChange={(e) => set(e)}", "/>"]);
        assert!(!shares_boundary_line(&lone_self_closing, m(0, 2), "Input"));
        // Text or a comment after a void tag is a neighbour too.
        for after in ["<img src=\"a.png\"> caption", "<img src=\"a.png\"><!-- note -->", "<br/> tail"] {
            let page = lines(&[after]);
            let tag = if after.starts_with("<br") { "br" } else { "img" };
            assert!(shares_boundary_line(&page, m(0, 0), tag), "{after}");
        }
    }

    #[test]
    fn tag_only_boundary_check_reads_jsx_quotes_and_fails_closed() {
        let m = |start, end| ElementMatch { start_line: start, end_line: Some(end) };
        let crowded = [
            r#"<Card onClick={() => alert("it's")}>A</Card><p>Keep</p>"#,
            r#"<Card data={a /* don't */}>A</Card><p>Keep</p>"#,
            r#"<Card label={"say \"hi\" >"}>A</Card><p>Keep</p>"#,
            r#"<Card title="it's">A</Card><p>Keep</p>"#,
        ];
        for line in crowded {
            assert!(shares_boundary_line(&lines(&[line]), m(0, 0), "Card"), "{line}");
        }
        let lone = [
            r#"<Card onClick={() => alert("it's")}>A</Card>"#,
            r#"<Card label={"say \"hi\" >"}>A</Card>"#,
        ];
        for line in lone {
            assert!(!shares_boundary_line(&lines(&[line]), m(0, 0), "Card"), "{line}");
        }
        let multi = lines(&["<Card", "  note={x /* it's */}", ">A</Card>", "<p>Keep</p>"]);
        assert!(!shares_boundary_line(&multi, m(0, 2), "Card"));
        // No end in sight: refuse rather than guess.
        assert!(shares_boundary_line(&lines(&["<Card>A", "more"]), m(0, 1), "Card"));
        assert!(shares_boundary_line(&lines(&["<Card>A"]), ElementMatch { start_line: 0, end_line: None }, "Card"));
    }

    #[test]
    fn element_scan_folds_html_case_and_keeps_component_case() {
        let cases = [
            // HTML names match whatever their case (PRRT_kwDOQWgufc629ma3).
            ("<div>\n  Outer intro\n  <DIV>Child</DIV>\n</div>\n<p>a</p>\n", Some(3)),
            ("<div>\n  Outer intro\n  <DIV>Child</div>\n</div>\n<p>a</p>\n", Some(3)),
            ("<DIV>\n  Outer intro\n  <div>Child</DIV>\n</Div>\n<p>a</p>\n", Some(3)),
            // A component keeps its exact case: `<card>` is another element.
            ("<Card>\n  <card>x</card>\n  <Card>y</Card>\n</Card>\n<p>a</p>\n", Some(3)),
        ];
        for (src, end) in cases {
            let lines: Vec<String> = src.lines().map(String::from).collect();
            assert_eq!(find_closing_line(&lines, 0), end, "{src}");
        }
        let page = lines(&["<main>", "<div>", "  Outer intro", "  <DIV>Child</div>", "</div>", "</main>"]);
        assert_eq!(find_element(&page, "Outer intro", Some("div")).and_then(|m| m.end_line), Some(4));
        assert!(!shares_boundary_line(&mask_markup(&page), ElementMatch { start_line: 1, end_line: Some(4) }, "div"));
    }

    #[test]
    fn element_scan_skips_comments_raw_text_and_quoted_values() {
        let cases = [
            ("<div>\n  <!-- </div> -->\n  x\n</div>\n<p>a</p>\n", Some(3)),
            ("<div>\n  <!--\n  </div>\n  -->\n</div>\n<p>a</p>\n", Some(4)),
            ("<div>\n  {/* </div> */}\n</div>\n<p>a</p>\n", Some(2)),
            ("<div>\n  <script>const t = '</div>';</script>\n</div>\n<p>a</p>\n", Some(2)),
            ("<div>\n  <style>\n  </div>\n  </style>\n</div>\n<p>a</p>\n", Some(4)),
            ("<div>\n  <p title=\"</div>\">x</p>\n</div>\n<p>a</p>\n", Some(2)),
        ];
        for (src, end) in cases {
            let lines: Vec<String> = src.lines().map(String::from).collect();
            assert_eq!(find_closing_line(&lines, 0), end, "{src}");
        }
        // A commented-out or scripted heading is no match; the real one after
        // it is.
        let page = lines(&[
            "<!-- <script> -->",
            "<p title=\"<script>\">x</p>",
            "<!-- <h1>Old</h1> -->",
            "<script>const h = '<h1>';</script>",
            "<h1>Real</h1>",
        ]);
        assert_eq!(find_element(&page, "<h1", Some("h1")).map(|m| m.start_line), Some(4));
        assert_eq!(find_all_elements(&page, "<h1", Some("h1")).len(), 1);
        // Markup inside a comment or a script within the element is no
        // neighbour; a comment after its end still is.
        let m = ElementMatch { start_line: 0, end_line: Some(0) };
        for lone in [
            "<div>A<!-- </div> --></div>",
            "<div><script>const t = '<div>';</script></div>",
        ] {
            assert!(!shares_boundary_line(&mask_markup(&lines(&[lone])), m, "div"), "{lone}");
        }
        assert!(shares_boundary_line(&mask_markup(&lines(&["<div>A</div><!-- x -->"])), m, "div"));
    }

    #[test]
    fn tag_only_wraps_a_parent_whose_last_line_closes_a_nested_child() {
        for insert in [false, true] {
            let source = "<main>\n<div>\n  Outer intro\n  <div>Child</div></div>\n</main>\n";
            let project = TagProject::new("index.html", source);
            let (code, out, err) = project.run(insert, &["--tag", "div", "--text", "Outer intro"]);
            assert_eq!(code, 0, "{out} {err}");
            assert!(project.source("index.html").contains("data-impeccable-variants="));
        }
    }

    #[test]
    fn tag_only_boundary_check_leaves_lone_elements_alone() {
        let page = lines(&["<main>", "  <h2 title=\"a\">First</h2>  ", "  <h2>", "    Second", "  </h2>", "  <img src=\"a.png\">", "</main>"]);
        let m = |start, end| ElementMatch { start_line: start, end_line: Some(end) };
        assert!(!shares_boundary_line(&page, m(1, 1), "h2"));
        assert!(!shares_boundary_line(&page, m(2, 4), "h2"));
        assert!(!shares_boundary_line(&page, m(5, 5), "img"));
        let crowded = lines(&["<img src=\"a.png\"><p>Keep</p>", "<H2>A</H2><H2>B</H2>", "<Card>A</Card><Card>B</Card>"]);
        assert!(shares_boundary_line(&crowded, m(0, 0), "img"));
        assert!(shares_boundary_line(&crowded, m(1, 1), "h2"));
        assert!(shares_boundary_line(&crowded, m(2, 2), "Card"));
    }

    #[test]
    fn tag_only_considers_candidates_across_files() {
        for insert in [false, true] {
            let project = TagProject::new("index.html", "<h2>First heading</h2>\n");
            std::fs::write(project.0.join("other.html"), "<h2>Second heading</h2>\n").unwrap();
            let (code, _, err) = project.run(insert, &["--tag", "h2"]);
            assert_eq!(code, 1, "{err}");
            let error: Value = serde_json::from_str(err.trim()).unwrap();
            assert_eq!(error["error"], "element_ambiguous");
            assert_eq!(error["fallback"], "agent-driven");
            assert_eq!(error["candidates"].as_array().unwrap().len(), 2);
            let (code, out, err) = project.run(insert, &["--tag", "h2", "--text", "Second heading"]);
            assert_eq!(code, 0, "{out} {err}");
            assert!(project.source("other.html").contains("data-impeccable-variants="));
            assert_eq!(project.source("index.html"), "<h2>First heading</h2>\n");
        }
    }

    #[test]
    fn find_opener_line_ignores_tag_case() {
        let one_line = lines(&[r#"<Input id="password" type="password" required />"#]);
        assert_eq!(find_opener_line(&one_line, 0, Some("input")), Some(0));
        let multi_line = lines(&["<Input", r#"  id="email""#, "/>"]);
        assert_eq!(find_opener_line(&multi_line, 1, Some("input")), Some(0));
        let other = lines(&[r#"<Label id="email" />"#]);
        assert_eq!(find_opener_line(&other, 0, Some("input")), None);
    }

    #[test]
    fn closing_line_is_the_elements_own_end() {
        let cases = [
            // Self-closing over several lines (#852).
            ("<legend\n  className={cn(\"a\", className)}\n  {...props}\n/>\n);\n}\n", Some(3)),
            // `>` inside a prop expression, then inside a quoted value.
            ("<input onChange={(e) => set(e.target.value)} />\n<p>a</p>\n<p>b</p>\n", Some(0)),
            ("<input className=\"[&>svg]:size-4\" />\n<p>a</p>\n<p>b</p>\n", Some(0)),
            // An apostrophe inside a prop expression is not a quote, a string is.
            ("<button onClick={() => {\n  // don't resubmit\n  go();\n}}>\n  Go\n</button>\n<p>a</p>\n", Some(5)),
            ("<Field label={\"{\"} />\n<p>a</p>\n<p>b</p>\n", Some(0)),
            ("<Field sql={`\n  a {\n`} />\n<p>a</p>\n<p>b</p>\n", Some(2)),
            ("<Field title={`a\\`b`} />\n<p>a</p>\n<p>b</p>\n", Some(0)),
            // Nested same-name tags, and a sibling opened on the closing line.
            ("<section>\n  <section>\n    x\n  </section>\n</section>\n<p>a</p>\n", Some(4)),
            ("<a>x</a> and <a>y\nz</a>\n<p>a</p>\n", Some(1)),
            // A closing tag split before its `>`.
            ("<section>\n  x\n</section\n>\n<p>a</p>\n", Some(3)),
            // Never closed: no end line rather than a guessed one.
            ("<img class=\"hero\">\n<p>a</p>\n<p>b</p>\n", None),
        ];
        for (src, end) in cases {
            let lines: Vec<String> = src.lines().map(String::from).collect();
            assert_eq!(find_closing_line(&lines, 0), end, "{src}");
        }
    }

    #[test]
    fn text_filter_reads_an_unclosed_elements_text_past_its_children() {
        let src = "<div class=\"n\">Earlier card</div>\n<div class=\"n\">\n  <div class=\"n\">Nested card</div>\n  Parent trailing text\n<p>after</p>\n";
        let lines: Vec<String> = src.lines().map(String::from).collect();
        let candidates = find_all_elements(&lines, "class=\"n\"", Some("div"));
        let picked = filter_by_text(&candidates, &lines, "Parent trailing text");
        assert_eq!(picked.len(), 1);
        assert_eq!((picked[0].start_line, picked[0].end_line), (1, None));
    }
}
