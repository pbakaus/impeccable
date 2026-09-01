//! JS: live/accept-css.mjs. Accept-time CSS reconciliation: a small
//! comment- and string-aware block parser, `reconcileCss`, parameter baking
//! (`substituteParamVar`, `stripParamSelector`, `bakeParamValues`), the
//! compiler-driven `pruneUnusedSelectors`, and `collectAllSelectors`.
//!
//! Text is handled as `Vec<char>` so index arithmetic mirrors the JS string
//! indices (all structural characters are ASCII).

use impeccable_core::js::{is_js_whitespace, trim, WS};
use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::{Map, Value};
use std::collections::{BTreeSet, HashMap};

/// JS: the node shapes parseStylesheet emits.
#[derive(Debug, Clone)]
pub enum CssNode {
    Comment {
        text: String,
    },
    Rule {
        prelude: String,
        body: String,
    },
    At {
        name: String,
        prelude: String,
        /// Some for media/supports/layer/container/scope blocks.
        children: Option<Vec<CssNode>>,
        /// Some for other at-blocks.
        body: Option<String>,
        /// Block-less at-statement (`@import ...;`).
        statement: bool,
    },
}

fn s(chars: &[char]) -> String {
    chars.iter().collect()
}

fn index_of(chars: &[char], needle: &str, from: usize) -> Option<usize> {
    let n: Vec<char> = needle.chars().collect();
    if n.is_empty() {
        return Some(from.min(chars.len()));
    }
    if chars.len() < n.len() {
        return None;
    }
    let mut i = from;
    while i + n.len() <= chars.len() {
        if chars[i..i + n.len()] == n[..] {
            return Some(i);
        }
        i += 1;
    }
    None
}

fn last_index_of(chars: &[char], needle: &str, from: usize) -> Option<usize> {
    let n: Vec<char> = needle.chars().collect();
    if n.is_empty() || chars.len() < n.len() {
        return None;
    }
    let mut i = from.min(chars.len() - n.len());
    loop {
        if chars[i..i + n.len()] == n[..] {
            return Some(i);
        }
        if i == 0 {
            return None;
        }
        i -= 1;
    }
}

enum Boundary {
    Block(usize),
    Statement(usize),
    None,
}

/// JS: scanToBlockOrStatementEnd(text, from)
fn scan_to_block_or_statement_end(text: &[char], from: usize) -> Boundary {
    let mut i = from;
    let mut quote: Option<char> = None;
    while i < text.len() {
        let ch = text[i];
        if let Some(q) = quote {
            if ch == '\\' {
                i += 1;
            } else if ch == q {
                quote = None;
            }
        } else if ch == '"' || ch == '\'' {
            quote = Some(ch);
        } else if ch == '/' && text.get(i + 1) == Some(&'*') {
            match index_of(text, "*/", i + 2) {
                Some(close) => i = close + 1,
                None => i = text.len(),
            }
        } else if ch == '{' {
            return Boundary::Block(i);
        } else if ch == ';' {
            return Boundary::Statement(i);
        }
        i += 1;
    }
    Boundary::None
}

/// JS: scanBlockEnd(text, from)
pub fn scan_block_end(text: &[char], from: usize) -> usize {
    let mut i = from;
    let mut depth = 1;
    let mut quote: Option<char> = None;
    while i < text.len() {
        let ch = text[i];
        if let Some(q) = quote {
            if ch == '\\' {
                i += 1;
            } else if ch == q {
                quote = None;
            }
        } else if ch == '"' || ch == '\'' {
            quote = Some(ch);
        } else if ch == '/' && text.get(i + 1) == Some(&'*') {
            match index_of(text, "*/", i + 2) {
                Some(close) => i = close + 1,
                None => i = text.len(),
            }
        } else if ch == '{' {
            depth += 1;
        } else if ch == '}' {
            depth -= 1;
            if depth == 0 {
                return i;
            }
        }
        i += 1;
    }
    text.len()
}

static AT_NAME_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^@([A-Za-z-]+)").unwrap());

fn at_name(raw: &str) -> String {
    AT_NAME_RE
        .captures(raw)
        .map(|c| c[1].to_string())
        .unwrap_or_default()
}

/// JS: parseStylesheet(css)
pub fn parse_stylesheet(css: &str) -> Vec<CssNode> {
    let text: Vec<char> = css.chars().collect();
    parse_chars(&text)
}

fn parse_chars(text: &[char]) -> Vec<CssNode> {
    let mut nodes = Vec::new();
    let mut i = 0;
    while i < text.len() {
        while i < text.len() && is_js_whitespace(text[i]) {
            i += 1;
        }
        if i >= text.len() {
            break;
        }
        if text[i] == '/' && text.get(i + 1) == Some(&'*') {
            let start = i;
            i = match index_of(text, "*/", i + 2) {
                Some(close) => close + 2,
                None => text.len(),
            };
            nodes.push(CssNode::Comment {
                text: s(&text[start..i]),
            });
            continue;
        }
        let prelude_start = i;
        let brace_idx = match scan_to_block_or_statement_end(text, i) {
            Boundary::None => break,
            Boundary::Statement(idx) => {
                let raw = trim(&s(&text[prelude_start..idx + 1])).to_string();
                if !raw.is_empty() {
                    let prelude = raw.strip_suffix(';').unwrap_or(&raw).to_string();
                    nodes.push(CssNode::At {
                        name: at_name(&raw),
                        prelude,
                        children: None,
                        body: None,
                        statement: true,
                    });
                }
                i = idx + 1;
                continue;
            }
            Boundary::Block(idx) => idx,
        };
        let prelude = trim(&s(&text[prelude_start..brace_idx])).to_string();
        let body_start = brace_idx + 1;
        let body_end = scan_block_end(text, body_start);
        let body = s(&text[body_start..body_end]);
        let node_end = (body_end + 1).min(text.len());
        if prelude.starts_with('@') {
            let name = at_name(&prelude);
            if ["media", "supports", "layer", "container", "scope"].contains(&name.as_str()) {
                nodes.push(CssNode::At {
                    name,
                    prelude,
                    children: Some(parse_chars(&text[body_start..body_end])),
                    body: None,
                    statement: false,
                });
            } else {
                nodes.push(CssNode::At {
                    name,
                    prelude,
                    children: None,
                    body: Some(body),
                    statement: false,
                });
            }
        } else if !prelude.is_empty() {
            nodes.push(CssNode::Rule { prelude, body });
        }
        i = node_end;
    }
    nodes
}

/// JS: serializeNodes(nodes, indent)
pub fn serialize_nodes(nodes: &[CssNode], indent: &str) -> String {
    let mut out: Vec<String> = Vec::new();
    for node in nodes {
        match node {
            CssNode::Comment { text } => out.push(format!("{}{}", indent, text)),
            CssNode::Rule { prelude, body } => out.push(format!(
                "{}{} {{{}}}",
                indent,
                prelude,
                format_body(body, indent)
            )),
            CssNode::At {
                prelude,
                children: Some(children),
                ..
            } => {
                out.push(format!("{}{} {{", indent, prelude));
                out.push(serialize_nodes(children, &format!("{}  ", indent)));
                out.push(format!("{}}}", indent));
            }
            CssNode::At {
                prelude,
                statement: true,
                ..
            } => out.push(format!("{}{};", indent, prelude)),
            CssNode::At { prelude, body, .. } => out.push(format!(
                "{}{} {{{}}}",
                indent,
                prelude,
                format_body(body.as_deref().unwrap_or(""), indent)
            )),
        }
    }
    out.join("\n")
}

fn format_body(body: &str, indent: &str) -> String {
    let trimmed = trim(body);
    if trimmed.is_empty() {
        return " ".to_string();
    }
    let lines: Vec<&str> = trimmed
        .split('\n')
        .map(trim)
        .filter(|l| !l.is_empty())
        .collect();
    if lines.len() == 1 && lines[0].encode_utf16().count() < 60 {
        return format!(" {} ", lines[0]);
    }
    let mut out = String::from("\n");
    out.push_str(
        &lines
            .iter()
            .map(|l| format!("{}  {}", indent, l))
            .collect::<Vec<_>>()
            .join("\n"),
    );
    out.push('\n');
    out.push_str(indent);
    out
}

static WS_RUN_RE: Lazy<Regex> = Lazy::new(|| Regex::new(&format!("{}+", WS)).unwrap());
static COMBINATOR_WS_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(&format!("{ws}*([>+~,]){ws}*", ws = WS)).unwrap());

/// JS: normalizeSelector(prelude)
pub fn normalize_selector(prelude: &str) -> String {
    let collapsed = WS_RUN_RE.replace_all(prelude, " ");
    let tight = COMBINATOR_WS_RE.replace_all(&collapsed, "$1");
    trim(&tight).to_string()
}

/// JS: reconcileCss(existingCss, variantCss) → (css, replaced, appended)
pub fn reconcile_css(existing_css: &str, variant_css: &str) -> (String, i64, i64) {
    let mut existing = parse_stylesheet(existing_css);
    let incoming = parse_stylesheet(variant_css);
    let mut replaced = 0;
    let mut appended = 0;
    merge_level(&mut existing, &incoming, &mut replaced, &mut appended);
    (serialize_nodes(&existing, ""), replaced, appended)
}

fn merge_level(
    existing: &mut Vec<CssNode>,
    incoming: &[CssNode],
    replaced: &mut i64,
    appended: &mut i64,
) {
    // index: normalized selector -> position of the rule in `existing`
    let mut index: HashMap<String, usize> = HashMap::new();
    for (i, node) in existing.iter().enumerate() {
        if let CssNode::Rule { prelude, .. } = node {
            index.insert(normalize_selector(prelude), i);
        }
    }
    let mut at_index: HashMap<String, usize> = HashMap::new();
    for (i, node) in existing.iter().enumerate() {
        if let CssNode::At {
            prelude,
            children: Some(_),
            ..
        } = node
        {
            at_index.insert(normalize_selector(prelude), i);
        }
    }
    let mut touched: BTreeSet<String> = BTreeSet::new();
    for node in incoming {
        match node {
            CssNode::Comment { .. } => continue,
            CssNode::Rule { prelude, body } => {
                let key = normalize_selector(prelude);
                if let Some(&pos) = index.get(&key) {
                    if let CssNode::Rule {
                        body: match_body, ..
                    } = &mut existing[pos]
                    {
                        if touched.contains(&key) {
                            *match_body = format!("{}\n{}", trim(match_body), trim(body));
                        } else if trim(match_body) != trim(body) {
                            *match_body = body.clone();
                            *replaced += 1;
                        }
                    }
                    touched.insert(key);
                } else {
                    let first_at = existing.iter().position(|n| {
                        matches!(
                            n,
                            CssNode::At {
                                children: Some(_),
                                ..
                            }
                        )
                    });
                    let pos = match first_at {
                        None => {
                            existing.push(node.clone());
                            existing.len() - 1
                        }
                        Some(at) => {
                            existing.insert(at, node.clone());
                            // Shift every index at or after `at`.
                            for v in index.values_mut() {
                                if *v >= at {
                                    *v += 1;
                                }
                            }
                            for v in at_index.values_mut() {
                                if *v >= at {
                                    *v += 1;
                                }
                            }
                            at
                        }
                    };
                    index.insert(key.clone(), pos);
                    touched.insert(key);
                    *appended += 1;
                }
            }
            CssNode::At {
                prelude,
                children: Some(children),
                ..
            } => {
                let key = normalize_selector(prelude);
                if let Some(&pos) = at_index.get(&key) {
                    if let CssNode::At {
                        children: Some(existing_children),
                        ..
                    } = &mut existing[pos]
                    {
                        merge_level(existing_children, children, replaced, appended);
                    }
                } else {
                    existing.push(node.clone());
                    at_index.insert(key, existing.len() - 1);
                    *appended += 1;
                }
            }
            other => {
                existing.push(other.clone());
                *appended += 1;
            }
        }
    }
}

/// JS: substituteParamVar(css, id, value)
pub fn substitute_param_var(css: &str, id: &str, value: &str) -> String {
    let text: Vec<char> = css.chars().collect();
    let needle = format!("var(--p-{}", id);
    let needle_len = needle.chars().count();
    let mut out = String::new();
    let mut i = 0;
    while i < text.len() {
        let Some(idx) = index_of(&text, &needle, i) else {
            out.push_str(&s(&text[i..]));
            break;
        };
        let after = idx + needle_len;
        if after < text.len() && text[after] != ')' && text[after] != ',' {
            out.push_str(&s(&text[i..after]));
            i = after;
            continue;
        }
        let mut j = after;
        let mut depth = 1;
        while j < text.len() && depth > 0 {
            if text[j] == '(' {
                depth += 1;
            } else if text[j] == ')' {
                depth -= 1;
            }
            j += 1;
        }
        out.push_str(&s(&text[i..idx]));
        out.push_str(value);
        i = j;
    }
    out
}

/// JS: `String(value)` for the JSON values a param can carry.
pub fn js_string(value: &Value) -> String {
    match value {
        Value::Null => "null".to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => n
            .as_f64()
            .map(impeccable_core::js::number_to_string)
            .unwrap_or_else(|| n.to_string()),
        Value::String(t) => t.clone(),
        Value::Array(a) => a.iter().map(js_string).collect::<Vec<_>>().join(","),
        Value::Object(_) => "[object Object]".to_string(),
    }
}

/// JS: normalizeToggleForVar(value)
pub fn normalize_toggle_for_var(value: &Value) -> &'static str {
    let on = match value {
        Value::Bool(true) => true,
        Value::Number(n) => n.as_f64() == Some(1.0),
        Value::String(t) => t == "true" || t == "1" || t == "on",
        _ => false,
    };
    if on {
        "1"
    } else {
        "0"
    }
}

fn is_toggle_on(value: &Value) -> bool {
    normalize_toggle_for_var(value) == "1"
}

/// Match `[data-p-<key>]` or `[data-p-<key>=<q>...<q>]` starting at `at`
/// (which must point at `[`). `key_filter` restricts the key. Returns
/// (end index exclusive, key, expected value if quoted).
/// Mirrors `/\[data-p-([A-Za-z0-9_-]+)(?:=(["'])(.*?)\2)?\]/`.
pub fn match_data_p_attr(
    text: &[char],
    at: usize,
    key_filter: Option<&str>,
) -> Option<(usize, String, Option<String>)> {
    let prefix: Vec<char> = "[data-p-".chars().collect();
    if at + prefix.len() > text.len() || text[at..at + prefix.len()] != prefix[..] {
        return None;
    }
    let mut i = at + prefix.len();
    let key_start = i;
    while i < text.len() && (text[i].is_ascii_alphanumeric() || text[i] == '_' || text[i] == '-') {
        i += 1;
    }
    if i == key_start {
        return None;
    }
    let key = s(&text[key_start..i]);
    if let Some(k) = key_filter {
        if key != k {
            return None;
        }
    }
    if i < text.len() && text[i] == ']' {
        return Some((i + 1, key, None));
    }
    if i < text.len() && text[i] == '=' {
        if let Some((content, end)) = quoted_lazy(text, i + 1, &|t, j| t.get(j) == Some(&']')) {
            return Some((end + 1, key, Some(content)));
        }
    }
    None
}

/// `(["'])(.*?)\1` at `at`, requiring `follow(text, index_after_closing_quote)`
/// to hold; the lazy body cannot span a newline. Returns (content, index of
/// the closing quote + 1).
pub fn quoted_lazy(
    text: &[char],
    at: usize,
    follow: &dyn Fn(&[char], usize) -> bool,
) -> Option<(String, usize)> {
    let q = *text.get(at)?;
    if q != '"' && q != '\'' {
        return None;
    }
    let mut j = at + 1;
    while j < text.len() {
        if text[j] == '\n' {
            return None;
        }
        if text[j] == q && follow(text, j + 1) {
            return Some((s(&text[at + 1..j]), j + 1));
        }
        j += 1;
    }
    None
}

static GLOBAL_EMPTY_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(&format!(r":global\({}*\)", WS)).unwrap());
static LEADING_COMBINATOR_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(&format!(r"^{ws}*[>+~]{ws}*", ws = WS)).unwrap());

/// JS: stripParamSelector(selector, id, kind, chosenValue)
pub fn strip_param_selector(
    selector: &str,
    id: &str,
    kind: &str,
    chosen: &Value,
) -> Option<String> {
    let text: Vec<char> = selector.chars().collect();
    let mut drop = false;
    let mut out = String::new();
    let mut i = 0;
    while i < text.len() {
        if text[i] == '[' {
            if let Some((end, _key, expected)) = match_data_p_attr(&text, i, Some(id)) {
                if kind == "steps" {
                    match &expected {
                        None => {}
                        Some(e) if *e == js_string(chosen) => {}
                        Some(_) => drop = true,
                    }
                } else {
                    if let Some(e) = &expected {
                        if e != "on" {
                            drop = true;
                        }
                    }
                    if !is_toggle_on(chosen) {
                        drop = true;
                    }
                }
                i = end;
                continue;
            }
        }
        out.push(text[i]);
        i += 1;
    }
    if drop {
        return None;
    }
    let out = GLOBAL_EMPTY_RE.replace_all(&out, "");
    let out = WS_RUN_RE.replace_all(&out, " ");
    let out = LEADING_COMBINATOR_RE.replace(&out, "");
    let out = trim(&out).to_string();
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

static READY_DECL_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(&format!(
        r"(^|;){ws}*--impeccable-variant-ready{ws}*:[^;{{}}]*",
        ws = WS
    ))
    .unwrap()
});
static DOUBLE_SEMI_RE: Lazy<Regex> = Lazy::new(|| Regex::new(&format!(r";{}*;", WS)).unwrap());
static LEADING_SEMI_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(&format!(r"^{ws}*;{ws}*", ws = WS)).unwrap());

struct Chosen {
    id: String,
    kind: String,
    /// `None` is JS `undefined` (a param with no `default` and no value).
    value: Option<Value>,
}

/// JS: bakeParamValues(css, params, values)
pub fn bake_param_values(css: &str, params: &[Value], values: &Map<String, Value>) -> String {
    let nodes = parse_stylesheet(css);
    // Insertion-ordered map (JS Map semantics).
    let mut chosen: Vec<Chosen> = Vec::new();
    for param in params {
        let Some(id) = param.get("id").and_then(|v| v.as_str()) else {
            continue;
        };
        if id.is_empty() {
            continue;
        }
        let kind = param
            .get("kind")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let value = match values.get(id) {
            Some(v) => Some(v.clone()),
            None => param.get("default").cloned(),
        };
        if let Some(existing) = chosen.iter_mut().find(|c| c.id == id) {
            existing.kind = kind;
            existing.value = value;
        } else {
            chosen.push(Chosen {
                id: id.to_string(),
                kind,
                value,
            });
        }
    }
    for (id, value) in values {
        if !chosen.iter().any(|c| c.id == *id) {
            chosen.push(Chosen {
                id: id.clone(),
                kind: "range".to_string(),
                value: Some(value.clone()),
            });
        }
    }

    let bake_body = |body: &str| -> String {
        let mut out = body.to_string();
        for c in &chosen {
            let literal = if c.kind == "toggle" {
                normalize_toggle_for_var(c.value.as_ref().unwrap_or(&Value::Null)).to_string()
            } else {
                // JS: String(undefined) === 'undefined' when the default is absent.
                match &c.value {
                    None => "undefined".to_string(),
                    Some(v) => js_string(v),
                }
            };
            out = substitute_param_var(&out, &c.id, &literal);
        }
        let out = READY_DECL_RE.replace_all(&out, "$1");
        let out = DOUBLE_SEMI_RE.replace_all(&out, ";");
        let out = LEADING_SEMI_RE.replace(&out, "");
        out.into_owned()
    };

    fn transform(
        list: &[CssNode],
        chosen: &[Chosen],
        bake_body: &dyn Fn(&str) -> String,
    ) -> Vec<CssNode> {
        let mut result = Vec::new();
        for node in list {
            match node {
                CssNode::At {
                    children: Some(children),
                    name,
                    prelude,
                    statement,
                    ..
                } => {
                    let kids = transform(children, chosen, bake_body);
                    if !kids.is_empty() {
                        result.push(CssNode::At {
                            name: name.clone(),
                            prelude: prelude.clone(),
                            children: Some(kids),
                            body: None,
                            statement: *statement,
                        });
                    }
                }
                CssNode::At {
                    name,
                    prelude,
                    body,
                    statement,
                    ..
                } => result.push(CssNode::At {
                    name: name.clone(),
                    prelude: prelude.clone(),
                    children: None,
                    body: Some(bake_body(body.as_deref().unwrap_or(""))),
                    statement: *statement,
                }),
                CssNode::Comment { .. } => result.push(node.clone()),
                CssNode::Rule { prelude, body } => {
                    let selectors = split_selector_list(prelude);
                    let mut kept: Vec<String> = Vec::new();
                    for selector in selectors {
                        let mut selector = selector;
                        let mut alive = true;
                        for c in chosen {
                            if c.kind != "steps" && c.kind != "toggle" {
                                continue;
                            }
                            if !selector.contains(&format!("data-p-{}", c.id)) {
                                continue;
                            }
                            match strip_param_selector(
                                &selector,
                                &c.id,
                                &c.kind,
                                c.value.as_ref().unwrap_or(&Value::Null),
                            ) {
                                None => {
                                    alive = false;
                                    break;
                                }
                                Some(next) => selector = next,
                            }
                        }
                        if alive && !trim(&selector).is_empty() {
                            kept.push(trim(&selector).to_string());
                        }
                    }
                    if kept.is_empty() {
                        continue;
                    }
                    let baked = bake_body(body);
                    if trim(&baked).is_empty() {
                        continue;
                    }
                    result.push(CssNode::Rule {
                        prelude: kept.join(", "),
                        body: baked,
                    });
                }
            }
        }
        result
    }

    let nodes = transform(&nodes, &chosen, &bake_body);
    serialize_nodes(&nodes, "")
}

/// JS: splitSelectorList(prelude)
pub fn split_selector_list(prelude: &str) -> Vec<String> {
    let text: Vec<char> = prelude.chars().collect();
    let mut selectors: Vec<String> = Vec::new();
    let mut start = 0;
    let mut bracket = 0i64;
    let mut paren = 0i64;
    let mut quote: Option<char> = None;
    let mut i = 0;
    while i < text.len() {
        let ch = text[i];
        if let Some(q) = quote {
            if ch == '\\' {
                i += 1;
            } else if ch == q {
                quote = None;
            }
            i += 1;
            continue;
        }
        if ch == '"' || ch == '\'' {
            quote = Some(ch);
        } else if ch == '[' {
            bracket += 1;
        } else if ch == ']' {
            bracket = (bracket - 1).max(0);
        } else if ch == '(' {
            paren += 1;
        } else if ch == ')' {
            paren = (paren - 1).max(0);
        } else if ch == ',' && bracket == 0 && paren == 0 {
            selectors.push(s(&text[start..i]));
            start = i + 1;
        }
        i += 1;
    }
    selectors.push(s(&text[start.min(text.len())..]));
    selectors
        .into_iter()
        .map(|x| trim(&x).to_string())
        .filter(|x| !x.is_empty())
        .collect()
}

/// One `css_unused_selector` warning: UTF-16 character offsets into the
/// compiled source.
#[derive(Debug, Clone, Copy)]
pub struct UnusedWarning {
    pub start: usize,
    pub end: usize,
}

/// A compile probe: `Some(warnings)` for a successful compile,
/// `None` when the compiler threw.
pub type CompileFn<'a> = &'a dyn Fn(&str) -> Option<Vec<UnusedWarning>>;

/// JS `str.slice(a, b)` on UTF-16 offsets.
pub fn slice_utf16(text: &str, start: usize, end: usize) -> String {
    let units: Vec<u16> = text.encode_utf16().collect();
    let start = start.min(units.len());
    let end = end.min(units.len()).max(start);
    String::from_utf16_lossy(&units[start..end])
}

/// JS: collectUnusedSelectors(componentSource, compileFn)
pub fn collect_unused_selectors(source: &str, compile: CompileFn) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    if let Some(warnings) = compile(source) {
        for w in warnings {
            out.insert(trim(&slice_utf16(source, w.start, w.end)).to_string());
        }
    }
    out
}

/// JS: pruneUnusedSelectors(componentSource, compileFn, { skipSelectors })
pub fn prune_unused_selectors(
    component_source: &str,
    compile: CompileFn,
    skip: &BTreeSet<String>,
) -> (String, Vec<String>) {
    let mut source = component_source.to_string();
    let mut removed: Vec<String> = Vec::new();
    for _pass in 0..3 {
        let Some(warnings) = compile(&source) else {
            return (source, removed);
        };
        let mut unused: Vec<UnusedWarning> = warnings
            .into_iter()
            .filter(|w| !skip.contains(trim(&slice_utf16(&source, w.start, w.end))))
            .collect();
        unused.sort_by(|a, b| b.start.cmp(&a.start));
        if unused.is_empty() {
            break;
        }
        let mut next = source.clone();
        for w in unused {
            let (changed, selector, out) = remove_selector_at(&next, w.start, w.end);
            if changed {
                removed.push(selector);
                next = out;
            }
        }
        if next == source {
            break;
        }
        source = next;
    }
    (source, removed)
}

/// JS: removeSelectorAt(source, start, end) → (changed, selector, source)
fn remove_selector_at(source: &str, start_u16: usize, end_u16: usize) -> (bool, String, String) {
    // Work in chars; convert the UTF-16 offsets to char indices.
    let units: Vec<u16> = source.encode_utf16().collect();
    let to_char = |u: usize| -> usize {
        String::from_utf16_lossy(&units[..u.min(units.len())])
            .chars()
            .count()
    };
    let start = to_char(start_u16);
    let end = to_char(end_u16);
    let text: Vec<char> = source.chars().collect();
    let selector = s(&text[start.min(text.len())..end.min(text.len())]);

    let Some(brace_idx) = index_of(&text, "{", end) else {
        return (false, selector, source.to_string());
    };
    let body_end = scan_block_end(&text, brace_idx + 1);

    let mut prelude_start = start;
    let mut i = start as i64 - 1;
    while i >= 0 {
        let iu = i as usize;
        let ch = text[iu];
        if ch == '}' || ch == '{' || ch == ';' {
            prelude_start = iu + 1;
            break;
        }
        if ch == '>' {
            if let Some(style_open) = last_index_of(&text, "<style", iu) {
                if index_of(&text, ">", style_open) == Some(iu) {
                    prelude_start = iu + 1;
                    break;
                }
            }
            i -= 1;
            continue;
        }
        if iu == 0 {
            prelude_start = 0;
        }
        i -= 1;
    }
    let prelude = s(&text[prelude_start..brace_idx]);
    let selectors = split_selector_list(&prelude);
    let target = trim(&selector).to_string();
    let kept: Vec<String> = selectors
        .iter()
        .filter(|x| **x != target)
        .cloned()
        .collect();
    if kept.len() == selectors.len() {
        return (false, selector, source.to_string());
    }
    if kept.is_empty() {
        let mut rule_end = (body_end + 1).min(text.len());
        while rule_end < text.len() && text[rule_end] == '\n' {
            rule_end += 1;
        }
        let mut rule_start = prelude_start;
        while rule_start > 0 && (text[rule_start - 1] == ' ' || text[rule_start - 1] == '\t') {
            rule_start -= 1;
        }
        let out = format!("{}{}", s(&text[..rule_start]), s(&text[rule_end..]));
        return (true, target, out);
    }
    let indent: String = prelude
        .chars()
        .take_while(|c| is_js_whitespace(*c))
        .collect();
    let out = format!(
        "{}{}{} {}",
        s(&text[..prelude_start]),
        indent,
        kept.join(", "),
        s(&text[brace_idx..])
    );
    (true, target, out)
}

/// JS: collectAllSelectors(css) (insertion order preserved).
pub fn collect_all_selectors(css: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    fn add(out: &mut Vec<String>, sel: String) {
        if !out.contains(&sel) {
            out.push(sel);
        }
    }
    fn from_nodes(nodes: &[CssNode], out: &mut Vec<String>) {
        for node in nodes {
            match node {
                CssNode::Rule { prelude, .. } => {
                    for sel in split_selector_list(prelude) {
                        add(out, normalize_selector(&sel));
                    }
                }
                CssNode::At {
                    children: Some(children),
                    ..
                } => from_nodes(children, out),
                _ => {}
            }
        }
    }
    for node in parse_stylesheet(css) {
        match &node {
            CssNode::Rule { prelude, .. } => {
                for sel in split_selector_list(prelude) {
                    add(&mut out, normalize_selector(&sel));
                }
            }
            CssNode::At {
                children: Some(children),
                ..
            } => {
                for child in children {
                    match child {
                        CssNode::Rule { prelude, .. } => {
                            for sel in split_selector_list(prelude) {
                                add(&mut out, normalize_selector(&sel));
                            }
                        }
                        CssNode::At {
                            children: Some(kids),
                            ..
                        } => from_nodes(kids, &mut out),
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reconcile_replaces_and_appends() {
        let (css, replaced, appended) = reconcile_css(
            "  .a { color: red; }\n  .b { x: 1; }\n",
            ".a { color: blue; }\n.c { y: 2; }",
        );
        assert_eq!(replaced, 1);
        assert_eq!(appended, 1);
        assert_eq!(css, ".a { color: blue; }\n.b { x: 1; }\n.c { y: 2; }");
    }

    #[test]
    fn bake_range_and_steps() {
        let params: Vec<Value> = serde_json::from_str(
            r#"[{"id":"lead","kind":"range","default":1.2},{"id":"density","kind":"steps","default":"airy"}]"#,
        )
        .unwrap();
        let values: Map<String, Value> =
            serde_json::from_str(r#"{"lead":1.8,"density":"snug"}"#).unwrap();
        let out = bake_param_values(
            ".t { line-height: var(--p-lead, 1.2); }\n:global([data-p-density=\"snug\"]) .t { letter-spacing: 0; }\n:global([data-p-density=\"airy\"]) .t { letter-spacing: 1; }",
            &params,
            &values,
        );
        assert_eq!(out, ".t { line-height: 1.8; }\n.t { letter-spacing: 0; }");
    }

    #[test]
    fn strip_toggle() {
        assert_eq!(
            strip_param_selector(
                ":scope[data-p-italic] > h1",
                "italic",
                "toggle",
                &Value::Bool(true)
            ),
            Some(":scope > h1".to_string())
        );
        assert_eq!(
            strip_param_selector(
                ":scope[data-p-italic] > h1",
                "italic",
                "toggle",
                &Value::Bool(false)
            ),
            None
        );
    }
}
