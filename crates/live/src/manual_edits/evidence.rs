//! JS: live-manual-edit-evidence.mjs. Collects evidence for pending live copy
//! edits: staged entries, flattened ops, and likely source candidates.

use crate::event_validation::truthy;
use crate::manual_edits::buffer::{buffer_path, read_buffer};
use crate::manual_edits::is_generated_file;
use crate::util::{exists, jsp, Env};
use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::collections::HashSet;

const EVIDENCE_VERSION: i64 = 1;
const TEXT_EXTENSIONS: [&str; 12] = [
    ".html", ".jsx", ".tsx", ".vue", ".svelte", ".astro", ".js", ".mjs", ".ts", ".ex", ".heex",
    ".eex",
];
const SEARCH_DIRS: [&str; 10] = [
    "src",
    "app",
    "pages",
    "components",
    "public",
    "views",
    "templates",
    "site",
    "lib",
    "data",
];
const STRONG_LITERAL_MATCH_LIMIT: usize = 8;
const WEAK_LITERAL_MATCH_LIMIT: usize = 4;
const OBJECT_KEY_MATCH_LIMIT: usize = 8;
const LOCATOR_MATCH_LIMIT: usize = 4;
const CONTEXT_MATCH_LIMIT: usize = 8;
const CONTEXT_MATCH_PER_HINT: usize = 2;
const SKIP_DIRS: [&str; 11] = [
    "node_modules",
    ".git",
    ".impeccable",
    ".astro",
    ".next",
    ".nuxt",
    ".svelte-kit",
    "dist",
    "build",
    "out",
    "coverage",
];

// ---------------------------------------------------------------------------
// Small JS-semantics helpers shared with commit.rs
// ---------------------------------------------------------------------------

/// `obj[key]`: None models `undefined`.
pub(crate) fn prop(v: &Value, key: &str) -> Option<Value> {
    v.get(key).cloned()
}

/// Insert only when the JS value is not `undefined` (JSON.stringify drops it).
pub(crate) fn ins(m: &mut Map<String, Value>, k: &str, v: Option<Value>) {
    if let Some(v) = v {
        m.insert(k.to_string(), v);
    }
}

/// `x || null`
pub(crate) fn or_null(v: Option<Value>) -> Value {
    match v {
        Some(v) if truthy(Some(&v)) => v,
        _ => Value::Null,
    }
}

/// `Array.isArray(x) ? x : []`
pub(crate) fn arr(v: Option<&Value>) -> Vec<Value> {
    match v {
        Some(Value::Array(a)) => a.clone(),
        _ => vec![],
    }
}

/// `String(value)` for the value shapes these payloads carry.
pub(crate) fn js_string(v: Option<&Value>) -> String {
    match v {
        None => "undefined".to_string(),
        Some(Value::Null) => "null".to_string(),
        Some(Value::Bool(b)) => b.to_string(),
        Some(Value::Number(n)) => n
            .as_f64()
            .map(impeccable_context::util::js_number_to_string)
            .unwrap_or_default(),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(a)) => a
            .iter()
            .map(|x| match x {
                Value::Null => String::new(),
                other => js_string(Some(other)),
            })
            .collect::<Vec<_>>()
            .join(","),
        Some(Value::Object(_)) => "[object Object]".to_string(),
    }
}

/// `String(value || '')`
pub(crate) fn js_string_or_empty(v: Option<&Value>) -> String {
    if truthy(v) {
        js_string(v)
    } else {
        String::new()
    }
}

/// `typeof v === 'string' ? v : fallback`
pub(crate) fn as_string(v: Option<&Value>) -> Option<String> {
    match v {
        Some(Value::String(s)) => Some(s.clone()),
        _ => None,
    }
}

/// `str.length` in UTF-16 code units.
pub(crate) fn utf16_len(s: &str) -> usize {
    s.chars().map(|c| c.len_utf16()).sum()
}

/// `str.slice(0, max)` counting UTF-16 code units.
pub(crate) fn utf16_slice(s: &str, max: usize) -> String {
    let mut out = String::new();
    let mut n = 0usize;
    for c in s.chars() {
        let w = c.len_utf16();
        if n + w > max {
            break;
        }
        out.push(c);
        n += w;
    }
    out
}

fn is_js_space(c: char) -> bool {
    c.is_whitespace() || c == '\u{feff}'
}

/// JS: normalizeText(value)
pub(crate) fn normalize_text(v: Option<&Value>) -> String {
    collapse_ws(&js_string_or_empty(v))
}

pub(crate) fn collapse_ws(s: &str) -> String {
    let mut out = String::new();
    let mut in_ws = false;
    for c in s.chars() {
        if is_js_space(c) {
            in_ws = true;
        } else {
            if in_ws && !out.is_empty() {
                out.push(' ');
            }
            in_ws = false;
            out.push(c);
        }
    }
    out
}

/// JS: decodeBasicHtml(value)
fn decode_basic_html(v: &str) -> String {
    v.replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
}

/// JS: isPathInsideOrEqual(cwd, file)
pub(crate) fn is_path_inside_or_equal(cwd: &str, file: &str) -> bool {
    let rel = jsp::relative("/", &jsp::resolve("/", &[cwd]), &jsp::resolve("/", &[file]));
    rel.is_empty() || (!rel.starts_with("..") && !jsp::is_absolute(&rel))
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

/// JS: buildManualEditEvidence({ cwd, pageUrl })
pub fn build_manual_edit_evidence(cwd: &str, env: &Env, page_url: Option<&str>) -> Value {
    let pu = match page_url {
        Some(s) => Value::String(s.to_string()),
        None => Value::Null,
    };
    build_manual_edit_evidence_value(cwd, env, &pu)
}

/// The same, but with the raw JS value for `pageUrl` (the CLI's bare
/// `--page-url` flag yields the boolean `true`).
pub fn build_manual_edit_evidence_value(cwd: &str, env: &Env, page_url: &Value) -> Value {
    let buffer = read_buffer(cwd, env);
    let entries: Vec<Value> = if truthy(Some(page_url)) {
        buffer
            .entries
            .iter()
            .filter(|e| e.get("pageUrl").map(|v| v == page_url).unwrap_or(false))
            .cloned()
            .collect()
    } else {
        buffer.entries.clone()
    };
    let op_count = count_ops(&entries);

    if op_count == 0 {
        let mut m = Map::new();
        m.insert("pageUrl".into(), page_url.clone());
        m.insert("count".into(), json!(0));
        m.insert("entries".into(), json!([]));
        m.insert("ops".into(), json!([]));
        m.insert("candidates".into(), json!([]));
        return Value::Object(m);
    }

    let search_files = collect_search_files(cwd);
    let ops = flatten_ops(&entries);
    let candidates: Vec<Value> = ops
        .iter()
        .map(|op| build_candidates_for_op(op, cwd, &search_files))
        .collect();

    let mut ctx = Map::new();
    ctx.insert("cwd".into(), json!(cwd));
    ctx.insert(
        "bufferPath".into(),
        json!(jsp::relative("/", cwd, &buffer_path(cwd, env))),
    );
    ctx.insert("totalEntries".into(), json!(entries.len()));
    ctx.insert("totalOps".into(), json!(op_count));

    let mut m = Map::new();
    m.insert("version".into(), json!(EVIDENCE_VERSION));
    m.insert("pageUrl".into(), or_null(Some(page_url.clone())));
    m.insert("count".into(), json!(op_count));
    m.insert("entries".into(), Value::Array(entries));
    m.insert("ops".into(), Value::Array(ops));
    m.insert("context".into(), Value::Object(ctx));
    m.insert("candidates".into(), Value::Array(candidates));
    Value::Object(m)
}

pub(crate) fn count_ops(entries: &[Value]) -> usize {
    entries.iter().map(|e| arr(e.get("ops")).len()).sum()
}

// ---------------------------------------------------------------------------
// Ops
// ---------------------------------------------------------------------------

fn flatten_ops(entries: &[Value]) -> Vec<Value> {
    let mut out = Vec::new();
    for entry in entries {
        let hints = build_context_hints_by_ref(entry);
        for op in arr(entry.get("ops")) {
            let mut m = Map::new();
            ins(&mut m, "entryId", prop(entry, "id"));
            ins(&mut m, "pageUrl", prop(entry, "pageUrl"));
            ins(&mut m, "ref", prop(&op, "ref"));
            m.insert("contextRef".into(), or_null(prop(&op, "contextRef")));
            ins(&mut m, "tag", prop(&op, "tag"));
            m.insert("elementId".into(), or_null(prop(&op, "elementId")));
            m.insert("classes".into(), Value::Array(arr(op.get("classes"))));
            ins(&mut m, "originalText", prop(&op, "originalText"));
            ins(&mut m, "newText", prop(&op, "newText"));
            m.insert(
                "deleted".into(),
                json!(op.get("deleted") == Some(&Value::Bool(true))),
            );
            m.insert("sourceHint".into(), or_null(prop(&op, "sourceHint")));
            m.insert("leaf".into(), or_null(prop(&op, "leaf")));
            m.insert(
                "nearbyEditableTexts".into(),
                Value::Array(arr(op.get("nearbyEditableTexts"))),
            );
            m.insert("container".into(), or_null(prop(&op, "container")));
            let key = ref_key(op.get("ref"));
            m.insert(
                "contextHints".into(),
                Value::Array(hints.get(&key).cloned().unwrap_or_default()),
            );
            out.push(Value::Object(m));
        }
    }
    out
}

fn ref_key(v: Option<&Value>) -> String {
    match v {
        None => "\u{0}undefined".to_string(),
        Some(v) => serde_json::to_string(v).unwrap_or_default(),
    }
}

static ORIGINAL_TEXT_ATTR: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"data-impeccable-original-text="([^"]*)""#).unwrap());
static TEXT_CHUNK_SPLIT: Lazy<Regex> = Lazy::new(|| Regex::new(r"\s{2,}|\n|\t").unwrap());

fn build_context_hints_by_ref(entry: &Value) -> HashMap<String, Vec<Value>> {
    let mut map: HashMap<String, Vec<Value>> = HashMap::new();
    let element = entry.get("element");
    for op in arr(entry.get("ops")) {
        let mut hints: Vec<String> = Vec::new();
        let mut seen: HashSet<String> = HashSet::new();
        let skip_a = normalize_text(op.get("originalText"));
        let skip_b = normalize_text(op.get("newText"));
        {
            let mut add = |value: Option<&Value>| {
                let text = collapse_ws(&decode_basic_html(&js_string_or_empty(value)));
                let len = utf16_len(&text);
                if !(3..=160).contains(&len) {
                    return;
                }
                if text == skip_a || text == skip_b {
                    return;
                }
                if seen.insert(text.clone()) {
                    hints.push(text);
                }
            };

            for item in arr(op.get("nearbyEditableTexts")) {
                match &item {
                    Value::String(_) => add(Some(&item)),
                    other => add(other.get("text")),
                }
            }
            let outer = match element.and_then(|e| e.get("outerHTML")) {
                Some(Value::String(s)) => s.clone(),
                _ => String::new(),
            };
            for cap in ORIGINAL_TEXT_ATTR.captures_iter(&outer) {
                add(Some(&Value::String(cap[1].to_string())));
            }
            if let Some(Value::String(tc)) = element.and_then(|e| e.get("textContent")) {
                for chunk in TEXT_CHUNK_SPLIT.split(tc) {
                    add(Some(&Value::String(chunk.to_string())));
                }
            }
        }
        hints.truncate(16);
        map.insert(
            ref_key(op.get("ref")),
            hints.into_iter().map(Value::String).collect(),
        );
    }
    map
}

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

fn build_candidates_for_op(op: &Value, cwd: &str, search_files: &[SearchFile]) -> Value {
    let original_text = js_string_or_empty(op.get("originalText"));
    let context_needles: Vec<String> = arr(op.get("contextHints"))
        .iter()
        .map(|v| js_string_or_empty(Some(v)))
        .collect();
    let mut m = Map::new();
    ins(&mut m, "entryId", prop(op, "entryId"));
    ins(&mut m, "ref", prop(op, "ref"));
    m.insert("originalText".into(), json!(original_text));
    m.insert("sourceHint".into(), analyze_source_hint(op, cwd));
    m.insert(
        "textMatches".into(),
        Value::Array(if original_text.is_empty() {
            vec![]
        } else {
            find_matches(
                search_files,
                &original_text,
                "text",
                literal_match_limit(&original_text),
            )
        }),
    );
    m.insert(
        "objectKeyMatches".into(),
        Value::Array(if original_text.is_empty() {
            vec![]
        } else {
            find_object_key_matches(search_files, &original_text, OBJECT_KEY_MATCH_LIMIT)
        }),
    );
    m.insert(
        "locatorMatches".into(),
        Value::Array(find_locator_matches(search_files, op, LOCATOR_MATCH_LIMIT)),
    );
    m.insert(
        "contextTextMatches".into(),
        Value::Array(find_context_matches(
            search_files,
            &context_needles,
            CONTEXT_MATCH_PER_HINT,
            CONTEXT_MATCH_LIMIT,
        )),
    );
    Value::Object(m)
}

fn literal_match_limit(text: &str) -> usize {
    if is_weak_source_needle(text) {
        WEAK_LITERAL_MATCH_LIMIT
    } else {
        STRONG_LITERAL_MATCH_LIMIT
    }
}

fn is_weak_source_needle(text: &str) -> bool {
    let normalized = collapse_ws(text);
    if utf16_len(&normalized) < 4 {
        return true;
    }
    !normalized.is_empty()
        && normalized
            .chars()
            .all(|c| c.is_ascii_digit() || ".,+-%".contains(c) || is_js_space(c))
}

/// JS: normalizeSourceHint(hint) -> { file, loc, line, column }
fn normalize_source_hint(hint: Option<&Value>) -> (String, String, Value, Value) {
    let is_obj = matches!(hint, Some(Value::Object(_)) | Some(Value::Array(_)));
    if !truthy(hint) || !is_obj {
        // JS returns {} -> file '' via `typeof hint.file === 'string'` on {}
        return (String::new(), String::new(), Value::Null, Value::Null);
    }
    let hint = hint.unwrap();
    let mut line = finite_number(hint.get("line"));
    let mut column = finite_number(hint.get("column"));
    let line_falsy = !truthy(line.as_ref());
    let col_falsy = !truthy(column.as_ref());
    if line_falsy || col_falsy {
        if let Some(Value::String(loc)) = hint.get("loc") {
            if let Some((l, c)) = parse_loc(loc) {
                line = Some(crate::util::js_num(l));
                if let Some(c) = c {
                    column = Some(crate::util::js_num(c));
                }
            }
        }
    }
    (
        as_string(hint.get("file")).unwrap_or_default(),
        as_string(hint.get("loc")).unwrap_or_default(),
        line.unwrap_or(Value::Null),
        column.unwrap_or(Value::Null),
    )
}

/// `Number.isFinite(Number(x)) ? Number(x) : null`
fn finite_number(v: Option<&Value>) -> Option<Value> {
    let n = crate::util::js_number(v)?;
    if n.is_finite() {
        Some(crate::util::js_num(n))
    } else {
        None
    }
}

/// `/^(\d+)(?::(\d+))?/` on a loc string.
fn parse_loc(loc: &str) -> Option<(f64, Option<f64>)> {
    let b = loc.as_bytes();
    let mut i = 0;
    while i < b.len() && b[i].is_ascii_digit() {
        i += 1;
    }
    if i == 0 {
        return None;
    }
    let line: f64 = loc[..i].parse().ok()?;
    if i < b.len() && b[i] == b':' {
        let start = i + 1;
        let mut j = start;
        while j < b.len() && b[j].is_ascii_digit() {
            j += 1;
        }
        if j > start {
            let col: f64 = loc[start..j].parse().ok()?;
            return Some((line, Some(col)));
        }
    }
    Some((line, None))
}

fn hint_map(file: &str, loc: &str, line: &Value, column: &Value) -> Map<String, Value> {
    let mut m = Map::new();
    m.insert("file".into(), json!(file));
    m.insert("loc".into(), json!(loc));
    m.insert("line".into(), line.clone());
    m.insert("column".into(), column.clone());
    m
}

/// JS: analyzeSourceHint(op, cwd)
fn analyze_source_hint(op: &Value, cwd: &str) -> Value {
    let (file_s, loc_s, line_v, column_v) = normalize_source_hint(op.get("sourceHint"));
    if file_s.is_empty() {
        return Value::Null;
    }
    let file = jsp::resolve(cwd, &[&file_s]);
    let relative_file = jsp::relative("/", cwd, &file);
    if !is_path_inside_or_equal(cwd, &file) {
        let mut m = hint_map(&file_s, &loc_s, &line_v, &column_v);
        m.insert("status".into(), json!("outside_cwd"));
        m.insert("relativeFile".into(), json!(file_s));
        return Value::Object(m);
    }
    if !exists(&file) {
        let mut m = hint_map(&file_s, &loc_s, &line_v, &column_v);
        m.insert("status".into(), json!("file_missing"));
        m.insert("relativeFile".into(), json!(relative_file));
        return Value::Object(m);
    }
    if is_generated_file(&file, cwd) {
        let mut m = hint_map(&file_s, &loc_s, &line_v, &column_v);
        m.insert("status".into(), json!("generated"));
        m.insert("relativeFile".into(), json!(relative_file));
        return Value::Object(m);
    }

    let content = match std::fs::read(&file) {
        Ok(b) => String::from_utf8_lossy(&b).into_owned(),
        Err(_) => String::new(),
    };
    let lines: Vec<&str> = content.split('\n').collect();
    // `hint.line || 1`
    let line = if truthy(Some(&line_v)) {
        crate::util::js_number(Some(&line_v)).unwrap_or(1.0)
    } else {
        1.0
    };
    let start = (line - 4.0).max(0.0) as usize;
    let end = ((line + 3.0).min(lines.len() as f64)).max(0.0) as usize;
    let slice: Vec<&str> = if start < end {
        lines[start..end].to_vec()
    } else {
        vec![]
    };
    let window_text = slice.join("\n");
    let contains = match op.get("originalText") {
        Some(Value::String(s)) => window_text.contains(s.as_str()),
        _ => false,
    };
    let mut m = hint_map(&file_s, &loc_s, &line_v, &column_v);
    m.insert(
        "status".into(),
        json!(if contains {
            "ok"
        } else {
            "text_not_found_near_hint"
        }),
    );
    m.insert("relativeFile".into(), json!(relative_file));
    let excerpt: Vec<Value> = slice
        .iter()
        .enumerate()
        .map(|(index, text)| json!({ "line": start + index + 1, "text": utf16_slice(text, 240) }))
        .collect();
    m.insert("excerpt".into(), Value::Array(excerpt));
    Value::Object(m)
}

// ---------------------------------------------------------------------------
// Search files
// ---------------------------------------------------------------------------

pub(crate) struct SearchFile {
    pub relative_file: String,
    pub content: String,
    pub lines: Vec<String>,
}

fn collect_search_files(cwd: &str) -> Vec<SearchFile> {
    let mut out = Vec::new();
    let mut seen_dirs: HashSet<String> = HashSet::new();
    let mut seen_files: HashSet<String> = HashSet::new();
    for dir in SEARCH_DIRS {
        scan_dir(
            &jsp::join(&[cwd, dir]),
            cwd,
            &mut seen_dirs,
            &mut seen_files,
            &mut out,
            0,
        );
    }
    scan_root_files(cwd, &mut seen_files, &mut out);
    out
}

fn realpath(p: &str) -> Option<String> {
    std::fs::canonicalize(p)
        .ok()
        .map(|p| p.to_string_lossy().into_owned())
}

fn has_text_extension(name: &str) -> bool {
    let ext = jsp::extname(name).to_lowercase();
    TEXT_EXTENSIONS.contains(&ext.as_str())
}

fn scan_dir(
    dir: &str,
    cwd: &str,
    seen_dirs: &mut HashSet<String>,
    seen_files: &mut HashSet<String>,
    out: &mut Vec<SearchFile>,
    depth: usize,
) {
    if depth > 7 || !exists(dir) {
        return;
    }
    let Some(real_dir) = realpath(dir) else {
        return;
    };
    if !seen_dirs.insert(real_dir) {
        return;
    }
    let Some(entries) = crate::util::read_dir_raw(dir) else {
        return;
    };
    for entry in entries {
        let full_path = jsp::join(&[dir, &entry.name]);
        if entry.is_dir {
            if SKIP_DIRS.contains(&entry.name.as_str()) {
                continue;
            }
            scan_dir(&full_path, cwd, seen_dirs, seen_files, out, depth + 1);
            continue;
        }
        if !entry.is_file || !has_text_extension(&entry.name) {
            continue;
        }
        maybe_add_search_file(&full_path, cwd, seen_files, out);
    }
}

fn scan_root_files(cwd: &str, seen_files: &mut HashSet<String>, out: &mut Vec<SearchFile>) {
    let Some(entries) = crate::util::read_dir_raw(cwd) else {
        return;
    };
    for entry in entries {
        if !entry.is_file || !has_text_extension(&entry.name) {
            continue;
        }
        maybe_add_search_file(&jsp::join(&[cwd, &entry.name]), cwd, seen_files, out);
    }
}

fn maybe_add_search_file(
    file: &str,
    cwd: &str,
    seen_files: &mut HashSet<String>,
    out: &mut Vec<SearchFile>,
) {
    let Some(real_file) = realpath(file) else {
        return;
    };
    if !seen_files.insert(real_file) {
        return;
    }
    if is_generated_file(file, cwd) {
        return;
    }
    let Ok(bytes) = std::fs::read(file) else {
        return;
    };
    let content = String::from_utf8_lossy(&bytes).into_owned();
    let lines = content.split('\n').map(String::from).collect();
    out.push(SearchFile {
        relative_file: jsp::relative("/", cwd, file),
        content,
        lines,
    });
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

fn match_for_index(file: &SearchFile, index: usize, kind: &str, needle: &str) -> Value {
    let line = file.content[..index].matches('\n').count() + 1;
    let line_text = file.lines.get(line - 1).cloned().unwrap_or_default();
    json!({
        "kind": kind,
        "file": file.relative_file,
        "line": line,
        "needle": needle,
        "excerpt": utf16_slice(impeccable_context::util::js_trim(&line_text), 240),
    })
}

fn find_matches(files: &[SearchFile], needle: &str, kind: &str, max: usize) -> Vec<Value> {
    if needle.is_empty() {
        return vec![];
    }
    let mut out = Vec::new();
    for file in files {
        let mut index = 0usize;
        while out.len() < max {
            let Some(found) = file.content[index..].find(needle) else {
                break;
            };
            let at = index + found;
            out.push(match_for_index(file, at, kind, needle));
            index = at + needle.len().max(1);
            if index > file.content.len() {
                break;
            }
        }
        if out.len() >= max {
            break;
        }
    }
    out
}

/// JS: findObjectKeyMatches. Hand-rolled because the JS regex uses a
/// backreference and a lookahead.
fn find_object_key_matches(files: &[SearchFile], text: &str, max: usize) -> Vec<Value> {
    let mut out = Vec::new();
    if text.is_empty() {
        // JS: an empty needle still forms a valid regex (quote-quote pair).
    }
    for file in files {
        let b = file.content.as_bytes();
        let mut i = 0usize;
        while i < b.len() {
            let q = b[i];
            if (q == b'"' || q == b'\'' || q == b'`') && file.content[i + 1..].starts_with(text) {
                let after = i + 1 + text.len();
                if b.get(after) == Some(&q) {
                    // lookahead: \s* then ':'
                    let mut j = after + 1;
                    while j < b.len() && (b[j] as char).is_ascii_whitespace() {
                        j += 1;
                    }
                    if b.get(j) == Some(&b':') {
                        out.push(match_for_index(file, i, "object_key", text));
                        if out.len() >= max {
                            return out;
                        }
                    }
                    i = after + 1;
                    continue;
                }
            }
            i += 1;
            while i < b.len() && !file.content.is_char_boundary(i) {
                i += 1;
            }
        }
    }
    out
}

fn find_locator_matches(files: &[SearchFile], op: &Value, max: usize) -> Vec<Value> {
    let mut needles: Vec<(String, String)> = Vec::new();
    if truthy(op.get("elementId")) {
        needles.push(("id".into(), js_string_or_empty(op.get("elementId"))));
    }
    for cls in arr(op.get("classes")) {
        if truthy(Some(&cls)) {
            needles.push(("class".into(), js_string_or_empty(Some(&cls))));
        }
    }
    if truthy(op.get("tag")) {
        needles.push((
            "tag".into(),
            format!("<{}", js_string_or_empty(op.get("tag"))),
        ));
    }

    let mut out: Vec<Value> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for (kind, needle) in needles {
        for m in find_matches(files, &needle, &kind, max) {
            let key = format!(
                "{}:{}:{}:{}",
                js_string_or_empty(m.get("file")),
                js_string_or_empty(m.get("line")),
                kind,
                needle
            );
            if !seen.insert(key) {
                continue;
            }
            let mut mm = m.as_object().cloned().unwrap_or_default();
            mm.insert("needle".into(), json!(needle));
            out.push(Value::Object(mm));
            if out.len() >= max {
                return out;
            }
        }
    }
    out
}

fn find_context_matches(
    files: &[SearchFile],
    hints: &[String],
    max_per_hint: usize,
    max: usize,
) -> Vec<Value> {
    let mut out: Vec<Value> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for hint in hints {
        for m in find_matches(files, hint, "context", max_per_hint) {
            let key = format!(
                "{}:{}:{}",
                js_string_or_empty(m.get("file")),
                js_string_or_empty(m.get("line")),
                hint
            );
            if !seen.insert(key) {
                continue;
            }
            let mut mm = m.as_object().cloned().unwrap_or_default();
            mm.insert("needle".into(), json!(hint));
            out.push(Value::Object(mm));
            if out.len() >= max {
                return out;
            }
        }
    }
    out
}
