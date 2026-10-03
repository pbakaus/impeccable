//! JS: live-wrap.mjs helpers shared with live-insert.mjs: search-query
//! construction, element location (opener / closer / text disambiguation),
//! comment syntax and style mode from the framework registry, and the
//! cssAuthoring contracts.

use crate::inject::resolve_source_traits;
use crate::source_search::{
    find_source_file, is_generated_file, resolve_live_template_extensions, NEVER_SOURCE_DIRS,
};
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
    queries
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
    for (i, line) in lines.iter().enumerate() {
        if !line.contains(query) {
            continue;
        }
        if skip_line(line) {
            continue;
        }
        if line.contains("data-impeccable-variant") {
            continue;
        }
        let Some(opener) = find_opener_line(lines, i, tag) else {
            continue;
        };
        return Some(ElementMatch {
            start_line: opener,
            end_line: find_closing_line(lines, opener),
        });
    }
    None
}

/// JS: findAllElements(lines, query, tag)
pub fn find_all_elements(lines: &[String], query: &str, tag: Option<&str>) -> Vec<ElementMatch> {
    let mut out = Vec::new();
    let mut seen: Vec<usize> = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        if !line.contains(query) {
            continue;
        }
        if skip_line(line) {
            continue;
        }
        if line.contains("data-impeccable-variant") {
            continue;
        }
        let Some(opener) = find_opener_line(lines, i, tag) else {
            continue;
        };
        if seen.contains(&opener) {
            continue;
        }
        seen.push(opener);
        out.push(ElementMatch {
            start_line: opener,
            end_line: find_closing_line(lines, opener),
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

/// JS: findOpenerLine(lines, matchLine, tag)
pub fn find_opener_line(lines: &[String], match_line: usize, tag: Option<&str>) -> Option<usize> {
    if let Some(t) = opener_tag(&lines[match_line]) {
        return match tag {
            None => Some(match_line),
            Some(want) if want == t => Some(match_line),
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
            Some(want) if want == t => Some(i),
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
    // Scan chars with state carried across lines: an opening tag can span
    // lines and hold `>` inside a quoted value or a `{...}` prop (`=>`).
    let name: Vec<char> = tag_name.chars().collect();
    let mut depth: i64 = 0;
    let mut in_tag = false;
    let mut braces = 0usize;
    let mut quote: Option<char> = None;
    // A closing tag whose `>` sits on the next line (`</section` / `>`).
    let mut pending_close = false;
    for (i, line) in lines.iter().enumerate().skip(start) {
        let chars: Vec<char> = line.chars().collect();
        if std::mem::take(&mut pending_close)
            && chars.iter().find(|c| !is_js_whitespace(**c)) == Some(&'>')
        {
            depth -= 1;
        }
        let mut escaped = false;
        for (j, &c) in chars.iter().enumerate() {
            if in_tag {
                if let Some(q) = quote {
                    // A JS string takes backslash escapes; an attribute value
                    // does not.
                    if escaped {
                        escaped = false;
                    } else if braces > 0 && c == '\\' {
                        escaped = true;
                    } else if c == q {
                        quote = None;
                    }
                } else if c == '{' {
                    braces += 1;
                } else if c == '}' {
                    braces = braces.saturating_sub(1);
                } else if c == '"' || c == '\'' || c == '`' {
                    // Outside `{...}` a quote opens an attribute value. Inside,
                    // a backtick opens a template literal, and `"` or `'` open
                    // a JS string only when it closes on this line and is no
                    // contraction: an apostrophe in a comment or in text is not
                    // a delimiter.
                    let opens = if braces == 0 {
                        c != '`'
                    } else {
                        c == '`'
                            || chars[j + 1..].contains(&c)
                                && !(c == '\'' && j > 0 && chars[j - 1].is_alphanumeric())
                    };
                    if opens {
                        quote = Some(c);
                    }
                } else if braces == 0 && c == '>' {
                    in_tag = false;
                    if j > 0 && chars[j - 1] == '/' {
                        depth -= 1;
                    }
                }
            } else if c == '<' {
                let rest = &chars[j + 1..];
                if rest.first() == Some(&'/') && rest[1..].starts_with(&name) {
                    let after = &rest[1 + name.len()..];
                    match after.iter().find(|c| !is_js_whitespace(**c)) {
                        Some('>') => depth -= 1,
                        None => pending_close = true,
                        _ => {}
                    }
                } else if rest.starts_with(&name) {
                    // JS: `(?=[\s/>]|$)`, so `<legend` does not match `<legendary`.
                    let k = name.len();
                    if k >= rest.len()
                        || is_js_whitespace(rest[k])
                        || rest[k] == '/'
                        || rest[k] == '>'
                    {
                        depth += 1;
                        in_tag = true;
                    }
                }
            }
        }
        if depth <= 0 {
            return Some(i);
        }
    }
    None
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

/// JS: detectStyleMode(filePath) → (mode, styleTag)
pub fn detect_style_mode(file_path: &str) -> (&'static str, &'static str) {
    let t = resolve_source_traits(file_path);
    (t.style_mode, t.style_tag)
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

/// JS: buildCssAuthoring(styleMode, count)
pub fn build_css_authoring(style_mode: (&str, &str), count: i64) -> Value {
    let (mode, style_tag) = style_mode;
    let numbers: Vec<i64> = (1..=count.max(0)).collect();
    if mode == "astro-global-prefixed" {
        return json!({
            "mode": mode,
            "styleTag": style_tag,
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
pub fn find_file_with_query(query: &str, cwd: &str, include_generated: bool) -> Option<String> {
    let extensions = resolve_live_template_extensions(cwd);
    let filter = |p: &str| include_generated || !is_generated_file(p, cwd);
    find_source_file(query, cwd, &extensions, &NEVER_SOURCE_DIRS, &filter)
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
