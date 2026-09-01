//! JS: live/svelte-component.mjs. Svelte live-mode component injection:
//! variants are real `.svelte` components under
//! `node_modules/.impeccable-live/<id>/`, scaffolded from the app's own
//! compiler (through `svelte_bridge`), and accept inlines the chosen variant
//! back into the route with CSS reconciled into the component style block.

use crate::accept_css::{
    bake_param_values, collect_all_selectors, collect_unused_selectors, match_data_p_attr,
    normalize_selector, parse_stylesheet, prune_unused_selectors, quoted_lazy, reconcile_css,
    serialize_nodes, split_selector_list, CssNode,
};
use crate::accept_verify::verify_accepted_source;
use crate::svelte_ast::{analyze_svelte_markup, build_props_script_v2, restore_svelte_markup};
use crate::svelte_bridge::{load_svelte_compiler, SharedBridge};
use crate::util::{exists, is_dir, json_pretty, jsp, safe_read, write_file, Env};
use crate::wrap_common::leading_ws;
use impeccable_core::js::{trim, WS};
use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::{json, Map, Value};
use std::collections::BTreeSet;

pub const SVELTE_COMPONENT_ROOT: &str = "node_modules/.impeccable-live";
pub const LEGACY_SVELTE_COMPONENT_ROOT: &str = ".impeccable/live/previews";
pub const SVELTE_RUNTIME_FILE: &str = "node_modules/.impeccable-live/__runtime.js";
pub const SVELTE_PROBE_FILE: &str = "node_modules/.impeccable-live/__probe.js";

/// JS: `p.split(path.sep).join('/')`
fn fwd(p: &str) -> String {
    jsp::to_posix(p)
}

/// JS: shouldUseSvelteComponentInjection(filePath)
pub fn should_use_svelte_component_injection(file_path: &str, env: &Env) -> bool {
    let flag = env
        .get("IMPECCABLE_LIVE_SVELTE_COMPONENT")
        .map(|s| s.to_lowercase())
        .unwrap_or_default();
    if flag == "0" || flag == "false" || flag == "no" {
        return false;
    }
    jsp::extname(file_path).to_lowercase() == ".svelte"
}

/// JS: componentSessionDir(id, cwd)
pub fn component_session_dir(id: &str, cwd: &str) -> String {
    jsp::join(&[cwd, SVELTE_COMPONENT_ROOT, id])
}

/// JS: manifestPathForSession(id, cwd)
pub fn manifest_path_for_session(id: &str, cwd: &str) -> String {
    jsp::join(&[&component_session_dir(id, cwd), "manifest.json"])
}

/// JS: ensureRuntimeHelper(cwd)
pub fn ensure_runtime_helper(cwd: &str) -> String {
    let file = jsp::join(&[cwd, SVELTE_RUNTIME_FILE]);
    if let Some(parent) = std::path::Path::new(&file).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if !exists(&file) {
        let _ = std::fs::write(&file, "export { mount, unmount } from 'svelte';\n");
    }
    let probe = jsp::join(&[cwd, SVELTE_PROBE_FILE]);
    if !exists(&probe) {
        let _ = std::fs::write(&probe, "export const impeccableLivePreviewProbe = true;\n");
    }
    file
}

static SCRIPT_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?is)^(.*?)<script(?-u:\b)[^>]*>.*?</script>").unwrap());
static STYLE_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(&format!(r"(?is)<style(?-u:\b)[^>]*>.*?</style{}*>", WS)).unwrap());
static STYLE_CAP_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(&format!(r"(?is)<style(?-u:\b)[^>]*>(.*?)</style{}*>", WS)).unwrap());
static STYLE_OPEN_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)^<style(?-u:\b)[^>]*>").unwrap());
static STYLE_CLOSE_END_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(&format!(r"(?i)</style{}*>$", WS)).unwrap());

/// JS: parseSvelteComponentFile(content) → (markup, cssLines)
pub fn parse_svelte_component_file(content: &str) -> (String, Vec<String>) {
    let without_script = match SCRIPT_RE.find(content) {
        Some(m) => &content[m.end()..],
        None => content,
    };
    let (markup, style_block) = match STYLE_RE.find(without_script) {
        Some(m) => (
            trim(&without_script[..m.start()]).to_string(),
            m.as_str().to_string(),
        ),
        None => (trim(without_script).to_string(), String::new()),
    };
    let mut css_lines: Vec<String> = if style_block.is_empty() {
        Vec::new()
    } else {
        let a = STYLE_OPEN_RE.replace(&style_block, "");
        let b = STYLE_CLOSE_END_RE.replace(&a, "");
        b.split('\n').map(|l| trim_end_js(l).to_string()).collect()
    };
    while css_lines
        .first()
        .map(|l| trim(l).is_empty())
        .unwrap_or(false)
    {
        css_lines.remove(0);
    }
    while css_lines
        .last()
        .map(|l| trim(l).is_empty())
        .unwrap_or(false)
    {
        css_lines.pop();
    }
    (markup, css_lines)
}

fn trim_end_js(s: &str) -> &str {
    s.trim_end_matches(impeccable_core::js::is_js_whitespace)
}

/// JS: buildInsertVariantStub(variantNum)
fn build_insert_variant_stub(n: i64) -> String {
    format!(
        "{}<div class=\"impeccable-insert-preview\">Insert variant {}</div>\n\n<style>\n  .impeccable-insert-preview {{ display: block; }}\n</style>\n",
        build_props_script_v2(&[]),
        n
    )
}

/// JS: buildVariantStubV2(variantNum, markupWithProps, contract, seededCss)
fn build_variant_stub_v2(
    n: i64,
    markup_with_props: &str,
    contract: &[Value],
    seeded_css: &str,
) -> String {
    let props_comment = if contract.is_empty() {
        String::new()
    } else {
        let parts: Vec<String> = contract
            .iter()
            .map(|c| {
                format!(
                    "{} ({}) <- {{{}}}",
                    c.get("prop")
                        .and_then(|v| v.as_str())
                        .unwrap_or("undefined"),
                    c.get("kind")
                        .and_then(|v| v.as_str())
                        .unwrap_or("undefined"),
                    c.get("expr")
                        .and_then(|v| v.as_str())
                        .unwrap_or("undefined")
                )
            })
            .collect();
        format!("\n<!-- Props: {} -->\n", parts.join(", "))
    };
    let css = if !seeded_css.is_empty() {
        let indented = seeded_css
            .split('\n')
            .map(|l| {
                if trim(l).is_empty() {
                    String::new()
                } else {
                    format!("  {}", l)
                }
            })
            .collect::<Vec<_>>()
            .join("\n");
        format!(
            "\n<style>\n  /* Variant {}: seeded from the route's current rules; restyle or delete freely.\n     ALL rules go inside THIS block. Svelte allows exactly one top-level style\n     element per component; appending a second one is a compile error. */\n{}\n</style>\n",
            n, indented
        )
    } else {
        format!(
            "\n<style>\n  /* Variant {}: add all CSS inside THIS block. Svelte allows exactly\n     one top-level style element; a second one is a compile error. */\n</style>\n",
            n
        )
    };
    format!(
        "{}{}{}\n{}",
        build_props_script_v2(contract),
        props_comment,
        trim(markup_with_props),
        css
    )
}

/// The scaffold outcome.
pub enum Scaffold {
    /// `{ fallback: 'source-preview', reason }`
    Fallback(String),
    Session(ScaffoldedSession),
}

pub struct ScaffoldedSession {
    pub manifest: Value,
    pub manifest_file: String,
    pub component_dir: String,
    pub prop_contract: Vec<Value>,
    pub stub_markup: String,
}

fn manifest_tail(cwd: &str, dir: &str) -> Vec<(&'static str, Value)> {
    vec![
        (
            "componentDir",
            Value::String(fwd(&jsp::relative("/", cwd, dir))),
        ),
        ("componentDirAbs", Value::String(fwd(dir))),
        (
            "runtimeModule",
            Value::String(format!("/{}", SVELTE_RUNTIME_FILE)),
        ),
        (
            "runtimeModuleAbs",
            Value::String(fwd(&jsp::join(&[cwd, SVELTE_RUNTIME_FILE]))),
        ),
        (
            "probeModule",
            Value::String(format!("/{}", SVELTE_PROBE_FILE)),
        ),
        (
            "probeModuleAbs",
            Value::String(fwd(&jsp::join(&[cwd, SVELTE_PROBE_FILE]))),
        ),
    ]
}

/// JS: scaffoldSvelteComponentSession({...})
pub fn scaffold_svelte_component_session(
    id: &str,
    count: i64,
    source_file: &str,
    source_start_line: i64,
    source_end_line: i64,
    original_lines: &[String],
    cwd: &str,
) -> Scaffold {
    let original_markup = original_lines.join("\n");
    let Some(bridge) = load_svelte_compiler(cwd) else {
        return Scaffold::Fallback(
            "svelte 5 compiler not resolvable from the app root".to_string(),
        );
    };
    let analysis = {
        let mut guard = bridge.lock().unwrap();
        let mut parse = |src: &str| guard.parse(src);
        analyze_svelte_markup(&original_markup, &mut parse)
    };
    let analysis = match analysis {
        Ok(a) => a,
        Err(reason) => return Scaffold::Fallback(reason),
    };

    ensure_runtime_helper(cwd);
    let dir = component_session_dir(id, cwd);
    let _ = std::fs::create_dir_all(&dir);

    let contract = analysis.contract;
    let route_source = safe_read(&jsp::resolve(cwd, &[source_file])).unwrap_or_default();
    let (seeded_css, supersedable) = extract_matching_source_css(&route_source, &original_markup);
    let seeded_selectors: Vec<Value> = supersedable.into_iter().map(Value::String).collect();

    let mut manifest = Map::new();
    manifest.insert("id".into(), Value::String(id.to_string()));
    manifest.insert(
        "previewMode".into(),
        Value::String("svelte-component".into()),
    );
    manifest.insert("contractVersion".into(), json!(2));
    manifest.insert("sourceFile".into(), Value::String(fwd(source_file)));
    manifest.insert("sourceStartLine".into(), json!(source_start_line));
    manifest.insert("sourceEndLine".into(), json!(source_end_line));
    manifest.insert("count".into(), count_value(count));
    manifest.insert("propContract".into(), Value::Array(contract.clone()));
    manifest.insert(
        "originalMarkup".into(),
        Value::String(original_markup.clone()),
    );
    manifest.insert("seededSelectors".into(), Value::Array(seeded_selectors));
    for (k, v) in manifest_tail(cwd, &dir) {
        manifest.insert(k.into(), v);
    }
    let manifest = Value::Object(manifest);
    let _ = write_file(
        &jsp::join(&[&dir, "manifest.json"]),
        &format!("{}\n", json_pretty(&manifest)),
    );

    let mut n = 1;
    while n <= count {
        let variant_file = jsp::join(&[&dir, &format!("v{}.svelte", n)]);
        if !exists(&variant_file) {
            let _ = std::fs::write(
                &variant_file,
                build_variant_stub_v2(n, &analysis.markup_with_props, &contract, &seeded_css),
            );
        }
        n += 1;
    }

    let component_dir = manifest
        .get("componentDir")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    Scaffold::Session(ScaffoldedSession {
        manifest_file: fwd(&jsp::relative(
            "/",
            cwd,
            &jsp::join(&[&dir, "manifest.json"]),
        )),
        component_dir,
        prop_contract: contract,
        stub_markup: analysis.markup_with_props,
        manifest,
    })
}

/// `count` as JSON: NaN (the `i64::MIN` sentinel from `parse_count`) is
/// `null` in JSON.stringify.
fn count_value(count: i64) -> Value {
    if count == i64::MIN {
        Value::Null
    } else {
        json!(count)
    }
}

/// `class\s*=\s*(["'])(.*?)\1` (global): every quoted class attribute value.
pub fn class_attr_values(text: &str) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    let needle: Vec<char> = "class".chars().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i + needle.len() <= chars.len() {
        if chars[i..i + needle.len()] == needle[..] {
            let mut j = i + needle.len();
            while j < chars.len() && impeccable_core::js::is_js_whitespace(chars[j]) {
                j += 1;
            }
            if j < chars.len() && chars[j] == '=' {
                j += 1;
                while j < chars.len() && impeccable_core::js::is_js_whitespace(chars[j]) {
                    j += 1;
                }
                if let Some((content, end)) = quoted_lazy(&chars, j, &|_, _| true) {
                    out.push(content);
                    i = end;
                    continue;
                }
            }
        }
        i += 1;
    }
    out
}

fn split_ws(s: &str) -> Vec<String> {
    s.split(impeccable_core::js::is_js_whitespace)
        .filter(|c| !c.is_empty())
        .map(String::from)
        .collect()
}

static TAG_NAME_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)<([a-z][a-z0-9-]*)").unwrap());

fn is_selector_word_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_' || c == '-'
}

/// `\.<cls>(?![A-Za-z0-9_-])`
fn class_token_in(selector: &str, cls: &str) -> bool {
    let chars: Vec<char> = selector.chars().collect();
    let needle: Vec<char> = format!(".{}", cls).chars().collect();
    let mut i = 0;
    while i + needle.len() <= chars.len() {
        if chars[i..i + needle.len()] == needle[..] {
            let after = i + needle.len();
            if after >= chars.len() || !is_selector_word_char(chars[after]) {
                return true;
            }
        }
        i += 1;
    }
    false
}

/// `(^|[\s>+~,(])<tag>(?![A-Za-z0-9_-])` case-insensitive
fn tag_token_in(selector: &str, tag: &str) -> bool {
    let chars: Vec<char> = selector.to_lowercase().chars().collect();
    let needle: Vec<char> = tag.to_lowercase().chars().collect();
    let mut i = 0;
    while i + needle.len() <= chars.len() {
        if chars[i..i + needle.len()] == needle[..] {
            let before_ok = i == 0 || {
                let b = chars[i - 1];
                impeccable_core::js::is_js_whitespace(b) || matches!(b, '>' | '+' | '~' | ',' | '(')
            };
            let after = i + needle.len();
            let after_ok = after >= chars.len() || !is_selector_word_char(chars[after]);
            if before_ok && after_ok {
                return true;
            }
        }
        i += 1;
    }
    false
}

/// JS: extractMatchingSourceCss(routeSource, originalMarkup) → (css, supersedable)
pub fn extract_matching_source_css(
    route_source: &str,
    original_markup: &str,
) -> (String, Vec<String>) {
    let Some(caps) = STYLE_CAP_RE.captures(route_source) else {
        return (String::new(), Vec::new());
    };
    let mut class_names: Vec<String> = Vec::new();
    for value in class_attr_values(original_markup) {
        for cls in split_ws(&value) {
            if !cls.contains('{') && !class_names.contains(&cls) {
                class_names.push(cls);
            }
        }
    }
    let mut tags: Vec<String> = Vec::new();
    for m in TAG_NAME_RE.captures_iter(original_markup) {
        let t = m[1].to_lowercase();
        if !tags.contains(&t) {
            tags.push(t);
        }
    }
    if class_names.is_empty() && tags.is_empty() {
        return (String::new(), Vec::new());
    }
    let mut supersedable: Vec<String> = Vec::new();
    let mut rule_matches = |prelude: &str| -> bool {
        let mut matched = false;
        for selector in split_selector_list(prelude) {
            if class_names.iter().any(|c| class_token_in(&selector, c)) {
                matched = true;
                let n = normalize_selector(&selector);
                if !supersedable.contains(&n) {
                    supersedable.push(n);
                }
            } else if tags.iter().any(|t| tag_token_in(&selector, t)) {
                matched = true;
            }
        }
        matched
    };
    fn pick(nodes: &[CssNode], rule_matches: &mut dyn FnMut(&str) -> bool) -> Vec<CssNode> {
        let mut kept = Vec::new();
        for node in nodes {
            match node {
                CssNode::Rule { prelude, .. } => {
                    if rule_matches(prelude) {
                        kept.push(node.clone());
                    }
                }
                CssNode::At {
                    children: Some(children),
                    name,
                    prelude,
                    statement,
                    ..
                } => {
                    let kids = pick(children, rule_matches);
                    if !kids.is_empty() {
                        kept.push(CssNode::At {
                            name: name.clone(),
                            prelude: prelude.clone(),
                            children: Some(kids),
                            body: None,
                            statement: *statement,
                        });
                    }
                }
                _ => {}
            }
        }
        kept
    }
    let picked = pick(&parse_stylesheet(&caps[1]), &mut rule_matches);
    (serialize_nodes(&picked, ""), supersedable)
}

/// JS: scaffoldSvelteComponentInsertSession({...})
pub fn scaffold_svelte_component_insert_session(
    id: &str,
    count: i64,
    source_file: &str,
    insert_line: i64,
    position: &str,
    anchor_start_line: i64,
    anchor_end_line: i64,
    anchor_lines: &[String],
    cwd: &str,
) -> ScaffoldedSession {
    ensure_runtime_helper(cwd);
    let dir = component_session_dir(id, cwd);
    let _ = std::fs::create_dir_all(&dir);
    let anchor_markup = anchor_lines.join("\n");
    let mut manifest = Map::new();
    manifest.insert("id".into(), Value::String(id.to_string()));
    manifest.insert("mode".into(), Value::String("insert".into()));
    manifest.insert(
        "previewMode".into(),
        Value::String("svelte-component".into()),
    );
    manifest.insert("sourceFile".into(), Value::String(fwd(source_file)));
    manifest.insert("insertLine".into(), json!(insert_line));
    manifest.insert("position".into(), Value::String(position.to_string()));
    manifest.insert("anchorStartLine".into(), json!(anchor_start_line));
    manifest.insert("anchorEndLine".into(), json!(anchor_end_line));
    manifest.insert(
        "originalMarkup".into(),
        Value::String(anchor_markup.clone()),
    );
    manifest.insert("anchorMarkup".into(), Value::String(anchor_markup));
    manifest.insert("count".into(), count_value(count));
    manifest.insert("propContract".into(), Value::Array(vec![]));
    for (k, v) in manifest_tail(cwd, &dir) {
        manifest.insert(k.into(), v);
    }
    let manifest = Value::Object(manifest);
    let _ = write_file(
        &jsp::join(&[&dir, "manifest.json"]),
        &format!("{}\n", json_pretty(&manifest)),
    );
    let mut n = 1;
    while n <= count {
        let variant_file = jsp::join(&[&dir, &format!("v{}.svelte", n)]);
        if !exists(&variant_file) {
            let _ = std::fs::write(&variant_file, build_insert_variant_stub(n));
        }
        n += 1;
    }
    let component_dir = manifest
        .get("componentDir")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    ScaffoldedSession {
        manifest_file: fwd(&jsp::relative(
            "/",
            cwd,
            &jsp::join(&[&dir, "manifest.json"]),
        )),
        component_dir,
        prop_contract: Vec::new(),
        stub_markup: String::new(),
        manifest,
    }
}

/// JS: readManifest(manifestPath) → `{...data, manifestPath}` (Err on
/// unreadable / unparsable, which the JS threw).
pub fn read_manifest(manifest_path: &str) -> Result<Map<String, Value>, String> {
    let text = safe_read(manifest_path).ok_or_else(|| format!("ENOENT: {}", manifest_path))?;
    let data: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let mut map = match data {
        Value::Object(o) => o,
        _ => Map::new(),
    };
    map.insert(
        "manifestPath".into(),
        Value::String(manifest_path.to_string()),
    );
    Ok(map)
}

/// JS: findSvelteComponentManifest(id, cwd). `Err` when the direct manifest
/// exists but does not parse (the JS threw out of readManifest there).
pub fn find_svelte_component_manifest(
    id: &str,
    cwd: &str,
) -> Result<Option<Map<String, Value>>, String> {
    let direct = manifest_path_for_session(id, cwd);
    if exists(&direct) {
        return read_manifest(&direct).map(Some);
    }
    let legacy = jsp::join(&[cwd, LEGACY_SVELTE_COMPONENT_ROOT, id, "manifest.json"]);
    if exists(&legacy) {
        return read_manifest(&legacy).map(Some);
    }
    for root_rel in [SVELTE_COMPONENT_ROOT, LEGACY_SVELTE_COMPONENT_ROOT] {
        let root = jsp::join(&[cwd, root_rel]);
        if !exists(&root) {
            continue;
        }
        let Some(entries) = crate::source_search::read_dir_sorted(&root) else {
            continue;
        };
        for entry in entries {
            if !entry.is_dir {
                continue;
            }
            let candidate = jsp::join(&[&root, &entry.name, "manifest.json"]);
            if !exists(&candidate) {
                continue;
            }
            if let Ok(m) = read_manifest(&candidate) {
                if m.get("id").and_then(|v| v.as_str()) == Some(id) {
                    return Ok(Some(m));
                }
            }
        }
    }
    Ok(None)
}

/// JS: resolveSourceFile(sourceFile, cwd) → abs path or the thrown message.
pub fn resolve_source_file(source_file: Option<&str>, cwd: &str) -> Result<String, String> {
    let Some(sf) = source_file.filter(|s| !s.is_empty()) else {
        return Err("Invalid svelte-component source file".to_string());
    };
    if jsp::is_absolute(sf) {
        return Err("Invalid svelte-component source file".to_string());
    }
    let full = jsp::resolve(cwd, &[sf]);
    let rel = jsp::relative("/", cwd, &full);
    if rel.is_empty() || rel.starts_with("..") || jsp::is_absolute(&rel) {
        return Err("Svelte-component source file escapes project root".to_string());
    }
    if !exists(&full) {
        return Err(format!("Svelte-component source file not found: {}", sf));
    }
    Ok(full)
}

// ---------------------------------------------------------------------------
// Accept-time CSS sanitizing (defensive path for off-spec variants)
// ---------------------------------------------------------------------------

struct RawRule {
    prelude: String,
    body: String,
}

/// JS: parseCssRules(css)
fn parse_css_rules(css: &str) -> Vec<RawRule> {
    let text: Vec<char> = css.chars().collect();
    let mut rules = Vec::new();
    let mut i = 0;
    while i < text.len() {
        while i < text.len() && impeccable_core::js::is_js_whitespace(text[i]) {
            i += 1;
        }
        let prelude_start = i;
        while i < text.len() && text[i] != '{' {
            i += 1;
        }
        if i >= text.len() {
            break;
        }
        let prelude = trim(&text[prelude_start..i].iter().collect::<String>()).to_string();
        i += 1;
        let body_start = i;
        let mut depth = 1;
        let mut quote: Option<char> = None;
        let mut comment = false;
        while i < text.len() && depth > 0 {
            let ch = text[i];
            let next = text.get(i + 1).copied();
            if comment {
                if ch == '*' && next == Some('/') {
                    comment = false;
                    i += 2;
                    continue;
                }
                i += 1;
                continue;
            }
            if let Some(q) = quote {
                if ch == '\\' {
                    i += 2;
                    continue;
                }
                if ch == q {
                    quote = None;
                }
                i += 1;
                continue;
            }
            if ch == '/' && next == Some('*') {
                comment = true;
                i += 2;
                continue;
            }
            if ch == '"' || ch == '\'' {
                quote = Some(ch);
                i += 1;
                continue;
            }
            if ch == '{' {
                depth += 1;
            } else if ch == '}' {
                depth -= 1;
            }
            i += 1;
        }
        let end = i.saturating_sub(1).max(body_start).min(text.len());
        let body: String = text[body_start..end].iter().collect();
        if !prelude.is_empty() {
            rules.push(RawRule { prelude, body });
        }
    }
    rules
}

static READY_DECL_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(&format!(r"--impeccable-variant-ready{}*:", WS)).unwrap());
static SCOPE_PRELUDE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)^@scope(?-u:\b)").unwrap());
static SCOPE_CHILD_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(&format!(r":scope(?:\[[^\]]+\])?{ws}*>{ws}*", ws = WS)).unwrap());
static SCOPE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r":scope(?:\[[^\]]+\])?").unwrap());
static WS_RUN_RE: Lazy<Regex> = Lazy::new(|| Regex::new(&format!("{}+", WS)).unwrap());
static LEADING_COMB_RE: Lazy<Regex> = Lazy::new(|| Regex::new(&format!(r"^[>+~]{}*", WS)).unwrap());

/// Remove `[data-impeccable-variant=<q>...<q>]` occurrences; `only` restricts
/// to a specific value.
fn strip_variant_attrs(selector: &str, only: Option<&str>) -> (String, bool) {
    let chars: Vec<char> = selector.chars().collect();
    let prefix: Vec<char> = "[data-impeccable-variant=".chars().collect();
    let mut out = String::new();
    let mut found = false;
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '['
            && i + prefix.len() <= chars.len()
            && chars[i..i + prefix.len()] == prefix[..]
        {
            let at = i + prefix.len();
            if let Some((content, end)) = quoted_lazy(&chars, at, &|t, j| t.get(j) == Some(&']')) {
                let ok = match only {
                    Some(v) => content == v,
                    None => true,
                };
                if ok {
                    found = true;
                    i = end + 1;
                    continue;
                }
            }
        }
        out.push(chars[i]);
        i += 1;
    }
    (out, found)
}

fn selector_has_variant(selector: &str, variant_num: &str) -> bool {
    strip_variant_attrs(selector, Some(variant_num)).1
}

fn rewrite_param_selectors(
    selector: &str,
    param_values: Option<&Map<String, Value>>,
) -> (bool, String) {
    let chars: Vec<char> = selector.chars().collect();
    let mut keep = true;
    let mut out = String::new();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '[' {
            if let Some((end, key, expected)) = match_data_p_attr(&chars, i, None) {
                match param_values.and_then(|pv| pv.get(&key)) {
                    None => {}
                    Some(actual) => match expected {
                        Some(e) => {
                            if crate::accept_css::js_string(actual) != e {
                                keep = false;
                            }
                        }
                        None => {
                            let off = match actual {
                                Value::Bool(false) | Value::Null => true,
                                Value::String(s) => s == "false" || s == "off" || s == "0",
                                _ => false,
                            };
                            if off {
                                keep = false;
                            }
                        }
                    },
                }
                i = end;
                continue;
            }
        }
        out.push(chars[i]);
        i += 1;
    }
    (keep, out)
}

fn rewrite_accepted_svelte_selector_part(
    selector: &str,
    variant_num: &str,
    param_values: Option<&Map<String, Value>>,
    root_tag: &str,
    from_scope: bool,
) -> String {
    let mut out = trim(selector).to_string();
    let has_variant = out.contains("data-impeccable-variant");
    if has_variant && !selector_has_variant(&out, variant_num) {
        return String::new();
    }
    if has_variant {
        out = strip_variant_attrs(&out, Some(variant_num)).0;
        out = strip_variant_attrs(&out, None).0;
    }
    let (keep, next) = rewrite_param_selectors(&out, param_values);
    if !keep {
        return String::new();
    }
    out = next;
    let a = SCOPE_CHILD_RE.replace_all(&out, "");
    let b = SCOPE_RE.replace_all(&a, root_tag);
    let c = WS_RUN_RE.replace_all(&b, " ");
    out = trim(&c).to_string();
    out = trim(&LEADING_COMB_RE.replace(&out, "")).to_string();
    if out.is_empty() && (has_variant || from_scope) {
        return if root_tag.is_empty() {
            ":global(*)".to_string()
        } else {
            root_tag.to_string()
        };
    }
    out
}

fn rewrite_accepted_svelte_selector(
    prelude: &str,
    variant_num: &str,
    param_values: Option<&Map<String, Value>>,
    root_tag: &str,
    from_scope: bool,
) -> String {
    let mut rewritten = Vec::new();
    for selector in split_selector_list(prelude) {
        let next = rewrite_accepted_svelte_selector_part(
            &selector,
            variant_num,
            param_values,
            root_tag,
            from_scope,
        );
        if !next.is_empty() {
            rewritten.push(next);
        }
    }
    rewritten.join(", ")
}

fn format_css_rule(selector: &str, body: &str) -> String {
    format!("{} {{ {} }}", selector, trim(body))
}

fn append_sanitized_css_rule(
    output: &mut Vec<String>,
    rule: &RawRule,
    variant_num: &str,
    param_values: Option<&Map<String, Value>>,
    root_tag: &str,
) {
    let prelude = trim(&rule.prelude);
    let body = trim(&rule.body);
    if prelude.is_empty() || body.is_empty() || READY_DECL_RE.is_match(body) {
        return;
    }
    if SCOPE_PRELUDE_RE.is_match(prelude) {
        if prelude.contains("data-impeccable-variant")
            && !selector_has_variant(prelude, variant_num)
        {
            return;
        }
        for inner in parse_css_rules(body) {
            let rewritten = rewrite_accepted_svelte_selector(
                &inner.prelude,
                variant_num,
                param_values,
                root_tag,
                true,
            );
            if rewritten.is_empty() || READY_DECL_RE.is_match(&inner.body) {
                continue;
            }
            output.push(format_css_rule(&rewritten, &inner.body));
        }
        return;
    }
    let rewritten =
        rewrite_accepted_svelte_selector(prelude, variant_num, param_values, root_tag, false);
    if rewritten.is_empty() {
        return;
    }
    output.push(format_css_rule(&rewritten, body));
}

/// JS: sanitizeAcceptedSvelteCss(cssLines, variantNum, paramValues, rootTag)
fn sanitize_accepted_svelte_css(
    css_lines: &[String],
    variant_num: &str,
    param_values: Option<&Map<String, Value>>,
    root_tag: &str,
) -> Vec<String> {
    let css = css_lines.join("\n");
    if !css.contains("data-impeccable-variant") && !css.contains("impeccable-variant-ready") {
        return css_lines.to_vec();
    }
    let mut output: Vec<String> = Vec::new();
    for rule in parse_css_rules(&css) {
        append_sanitized_css_rule(&mut output, &rule, variant_num, param_values, root_tag);
    }
    output
        .join("\n")
        .split('\n')
        .map(|l| trim_end_js(l).to_string())
        .filter(|l| !trim(l).is_empty())
        .collect()
}

// ---------------------------------------------------------------------------
// Accept
// ---------------------------------------------------------------------------

struct OpeningTag {
    raw: String,
    prefix: String,
    tag: String,
    attrs: String,
    close: String,
}

static OPENING_TAG_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(&format!(
        r"(?s)^({ws}*<)([A-Za-z][A-Za-z0-9_:-]*)([^>]*?)(/?>)",
        ws = WS
    ))
    .unwrap()
});

/// JS: matchOpeningTag(markup)
fn match_opening_tag(markup: &str) -> Option<OpeningTag> {
    let c = OPENING_TAG_RE.captures(markup)?;
    Some(OpeningTag {
        raw: c[0].to_string(),
        prefix: c[1].to_string(),
        tag: c[2].to_string(),
        attrs: c.get(3).map(|m| m.as_str()).unwrap_or("").to_string(),
        close: c[4].to_string(),
    })
}

struct AttrSeg {
    name: String,
    raw: String,
    start: usize,
    end: usize,
}

static ATTR_SEG_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(&format!(
        r#"([A-Za-z_:][A-Za-z0-9_:.-]*)(?:{ws}*={ws}*(?:"[^"]*"|'[^']*'|\{{[^}}]*\}}|[^{wsc}"'>=]+))?"#,
        ws = WS,
        wsc = &WS[1..WS.len() - 1]
    ))
    .unwrap()
});

/// JS: parseAttrSegments(attrs) → insertion-ordered map name → segment
/// (later duplicates replace the value but keep the first position).
fn parse_attr_segments(attrs: &str) -> Vec<AttrSeg> {
    let mut out: Vec<AttrSeg> = Vec::new();
    for c in ATTR_SEG_RE.captures_iter(attrs) {
        let whole = c.get(0).unwrap();
        let seg = AttrSeg {
            name: c[1].to_string(),
            raw: whole.as_str().to_string(),
            start: whole.start(),
            end: whole.end(),
        };
        if let Some(existing) = out.iter_mut().find(|s| s.name == seg.name) {
            *existing = seg;
        } else {
            out.push(seg);
        }
    }
    out
}

fn class_value_of(raw: &str) -> Option<(char, String)> {
    let chars: Vec<char> = raw.chars().collect();
    let needle: Vec<char> = "class".chars().collect();
    let mut i = 0;
    while i + needle.len() <= chars.len() {
        if chars[i..i + needle.len()] == needle[..] {
            let mut j = i + needle.len();
            while j < chars.len() && impeccable_core::js::is_js_whitespace(chars[j]) {
                j += 1;
            }
            if j < chars.len() && chars[j] == '=' {
                j += 1;
                while j < chars.len() && impeccable_core::js::is_js_whitespace(chars[j]) {
                    j += 1;
                }
                if let Some((content, _)) = quoted_lazy(&chars, j, &|_, _| true) {
                    return Some((chars[j], content));
                }
            }
        }
        i += 1;
    }
    None
}

/// JS: mergeStaticClassAttr(originalClass, variantClass)
fn merge_static_class_attr(original_raw: &str, variant_raw: &str) -> Option<String> {
    let (_, ov) = class_value_of(original_raw)?;
    let (q, vv) = class_value_of(variant_raw)?;
    let mut classes: Vec<String> = Vec::new();
    for c in split_ws(&vv).into_iter().chain(split_ws(&ov)) {
        if !classes.contains(&c) {
            classes.push(c);
        }
    }
    Some(format!("class={}{}{}", q, classes.join(" "), q))
}

/// JS: mergeOriginalTopLevelAttrs(markup, originalMarkup)
fn merge_original_top_level_attrs(markup: &str, original_markup: &str) -> String {
    let (Some(variant_open), Some(original_open)) = (
        match_opening_tag(markup),
        match_opening_tag(original_markup),
    ) else {
        return markup.to_string();
    };
    if variant_open.tag.to_lowercase() != original_open.tag.to_lowercase() {
        return markup.to_string();
    }
    let variant_attrs = parse_attr_segments(&variant_open.attrs);
    let original_attrs = parse_attr_segments(&original_open.attrs);
    let mut additions: Vec<String> = Vec::new();
    let mut attrs = variant_open.attrs.clone();

    let original_class = original_attrs.iter().find(|a| a.name == "class");
    let variant_class = variant_attrs.iter().find(|a| a.name == "class");
    match (original_class, variant_class) {
        (Some(oc), Some(vc)) => {
            if let Some(merged) = merge_static_class_attr(&oc.raw, &vc.raw) {
                attrs = format!(
                    "{}{}{}",
                    &variant_open.attrs[..vc.start],
                    merged,
                    &variant_open.attrs[vc.end..]
                );
            }
        }
        (Some(oc), None) => additions.push(oc.raw.clone()),
        _ => {}
    }
    for attr in &original_attrs {
        if attr.name == "class" {
            continue;
        }
        if !variant_attrs.iter().any(|v| v.name == attr.name) {
            additions.push(attr.raw.clone());
        }
    }
    if additions.is_empty() && attrs == variant_open.attrs {
        return markup.to_string();
    }
    let next_open = format!(
        "{}{}{}{}{}",
        variant_open.prefix,
        variant_open.tag,
        attrs,
        additions
            .iter()
            .map(|a| format!(" {}", trim(a)))
            .collect::<String>(),
        variant_open.close
    );
    format!("{}{}", next_open, &markup[variant_open.raw.len()..])
}

/// JS: reindentPreservingStructure(lines, indent)
pub fn reindent_preserving_structure(lines: &[String], indent: &str) -> Vec<String> {
    let non_empty: Vec<&String> = lines.iter().filter(|l| !trim(l).is_empty()).collect();
    if non_empty.is_empty() {
        return lines.iter().map(|_| String::new()).collect();
    }
    let min_indent = non_empty
        .iter()
        .map(|l| leading_ws(l).chars().count())
        .min()
        .unwrap_or(0);
    lines
        .iter()
        .map(|line| {
            if trim(line).is_empty() {
                return String::new();
            }
            let current = leading_ws(line).chars().count();
            format!(
                "{}{}",
                indent,
                crate::wrap_common::slice_chars(line, min_indent.min(current))
            )
        })
        .collect()
}

fn style_block_text(source: &str) -> String {
    STYLE_CAP_RE
        .captures(source)
        .map(|c| c[1].to_string())
        .unwrap_or_default()
}

/// The last `<style ...>...</style>` match: (start, end, open tag, inner).
fn last_style_block(text: &str) -> Option<(usize, usize, String, String)> {
    let mut last = None;
    for c in STYLE_CAP_RE.captures_iter(text) {
        let whole = c.get(0).unwrap();
        let open_end = whole.as_str().find('>').map(|i| i + 1).unwrap_or(0);
        last = Some((
            whole.start(),
            whole.end(),
            whole.as_str()[..open_end].to_string(),
            c[1].to_string(),
        ));
    }
    last
}

fn indent_css_block(css: &str) -> String {
    css.split('\n')
        .map(|l| {
            if trim(l).is_empty() {
                String::new()
            } else {
                format!("  {}", l)
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// JS: removeSelectorsFromSvelteSource(sourceText, selectors) → (text, removed)
pub fn remove_selectors_from_svelte_source(
    source: &str,
    selectors: &[String],
) -> (String, Vec<String>) {
    let Some((start, end, open_tag, inner)) = last_style_block(source) else {
        return (source.to_string(), Vec::new());
    };
    let mut removed: Vec<String> = Vec::new();
    fn transform(
        nodes: &[CssNode],
        selectors: &[String],
        removed: &mut Vec<String>,
    ) -> Vec<CssNode> {
        let mut kept = Vec::new();
        for node in nodes {
            match node {
                CssNode::Rule { prelude, body } => {
                    let mut survivors: Vec<String> = Vec::new();
                    for selector in split_selector_list(prelude) {
                        let n = normalize_selector(&selector);
                        if selectors.contains(&n) {
                            removed.push(n);
                        } else {
                            survivors.push(selector);
                        }
                    }
                    if !survivors.is_empty() {
                        kept.push(CssNode::Rule {
                            prelude: survivors.join(", "),
                            body: body.clone(),
                        });
                    }
                }
                CssNode::At {
                    children: Some(children),
                    name,
                    prelude,
                    statement,
                    ..
                } => {
                    let kids = transform(children, selectors, removed);
                    if !kids.is_empty() {
                        kept.push(CssNode::At {
                            name: name.clone(),
                            prelude: prelude.clone(),
                            children: Some(kids),
                            body: None,
                            statement: *statement,
                        });
                    }
                }
                other => kept.push(other.clone()),
            }
        }
        kept
    }
    let nodes = transform(&parse_stylesheet(&inner), selectors, &mut removed);
    if removed.is_empty() {
        return (source.to_string(), removed);
    }
    let rebuilt = format!(
        "{}\n{}\n</style>",
        open_tag,
        indent_css_block(&serialize_nodes(&nodes, ""))
    );
    (
        format!("{}{}{}", &source[..start], rebuilt, &source[end..]),
        removed,
    )
}

/// JS: findLostSelectors(beforeSource, afterSource, prunedSelectors)
pub fn find_lost_selectors(before: &str, after: &str, pruned: &[String]) -> Vec<String> {
    let before_sel = collect_all_selectors(&style_block_text(before));
    let after_sel = collect_all_selectors(&style_block_text(after));
    let pruned: BTreeSet<String> = pruned.iter().map(|s| normalize_selector(s)).collect();
    before_sel
        .into_iter()
        .filter(|s| !after_sel.contains(s) && !pruned.contains(s))
        .collect()
}

fn read_declared_params(manifest: &Map<String, Value>, variant_num: &str, cwd: &str) -> Vec<Value> {
    let dir = manifest
        .get("componentDir")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let path = jsp::join(&[cwd, dir, "params.json"]);
    let Some(text) = safe_read(&path) else {
        return Vec::new();
    };
    let Ok(raw) = serde_json::from_str::<Value>(&text) else {
        return Vec::new();
    };
    match raw.get(variant_num) {
        Some(Value::Array(a)) => a.clone(),
        _ => Vec::new(),
    }
}

/// JS: mergeCssIntoSvelteSource(sourceText, incomingCss) → (text, replaced, appended)
pub fn merge_css_into_svelte_source(source: &str, incoming: &str) -> (String, i64, i64) {
    match last_style_block(source) {
        None => {
            let (css, replaced, appended) = reconcile_css("", incoming);
            let base = source.trim_end_matches(impeccable_core::js::is_js_whitespace);
            (
                format!(
                    "{}\n\n<style>\n{}\n</style>\n",
                    base,
                    indent_css_block(&css)
                ),
                replaced,
                appended,
            )
        }
        Some((start, end, open_tag, inner)) => {
            let (css, replaced, appended) = reconcile_css(&inner, incoming);
            let block = format!("{}\n{}\n</style>", open_tag, indent_css_block(&css));
            (
                format!("{}{}{}", &source[..start], block, &source[end..]),
                replaced,
                appended,
            )
        }
    }
}

static SCRIPT_ANY_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?is)<script.*?</script>").unwrap());
static STYLE_ANY_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?is)<style.*?</style>").unwrap());
static COMMENT_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?s)<!--.*?-->").unwrap());
static ANY_TAG_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"<[^>]+>").unwrap());
static VISIBLE_TAG_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)<(img|svg|canvas|video|audio|picture|input|button|select|textarea)(?-u:\b)")
        .unwrap()
});
static DATA_IMPECCABLE_ATTR_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(&format!(r"(?-u:\b)data-impeccable-[A-Za-z0-9_-]*{}*=", WS)).unwrap());

fn svelte_markup_has_visible_content(markup: &str) -> bool {
    let a = SCRIPT_ANY_RE.replace_all(markup, "");
    let b = STYLE_ANY_RE.replace_all(&a, "");
    let c = COMMENT_RE.replace_all(&b, "");
    let d = ANY_TAG_RE.replace_all(&c, " ");
    let e = WS_RUN_RE.replace_all(&d, " ");
    if !trim(&e).is_empty() {
        return true;
    }
    VISIBLE_TAG_RE.is_match(markup)
}

/// The base result fields for the component accept path.
fn result_base(manifest: &Map<String, Value>) -> Vec<(&'static str, Value)> {
    let sf = manifest.get("sourceFile").cloned().unwrap_or(Value::Null);
    vec![
        ("file", sf.clone()),
        ("sourceFile", sf),
        ("previewMode", Value::String("svelte-component".into())),
        (
            "componentDir",
            manifest.get("componentDir").cloned().unwrap_or(Value::Null),
        ),
        ("carbonize", Value::Bool(false)),
    ]
}

fn with_base(mut head: Map<String, Value>, manifest: &Map<String, Value>) -> Value {
    for (k, v) in result_base(manifest) {
        head.insert(k.to_string(), v);
    }
    Value::Object(head)
}

fn failure(error: String, manifest: &Map<String, Value>) -> Value {
    let mut m = Map::new();
    m.insert("handled".into(), Value::Bool(false));
    m.insert("error".into(), Value::String(error));
    with_base(m, manifest)
}

fn js_integer(v: Option<&Value>) -> Option<i64> {
    let n = crate::util::js_number(v)?;
    if n.is_finite() && n.fract() == 0.0 {
        Some(n as i64)
    } else {
        None
    }
}

/// JS: inlineSvelteComponentAccept(manifest, variantNum, paramValues, cwd).
/// `Err(message)` is a thrown error (resolveSourceFile).
pub fn inline_svelte_component_accept(
    manifest: &Map<String, Value>,
    variant_num: &str,
    param_values: Option<&Map<String, Value>>,
    cwd: &str,
) -> Result<Value, String> {
    let source_file =
        resolve_source_file(manifest.get("sourceFile").and_then(|v| v.as_str()), cwd)?;
    let component_dir = manifest
        .get("componentDir")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let variant_path = jsp::join(&[cwd, component_dir, &format!("v{}.svelte", variant_num)]);
    if !exists(&variant_path) {
        return Ok(failure(
            format!("Variant {} not found", variant_num),
            manifest,
        ));
    }
    let (markup, css_lines) =
        parse_svelte_component_file(&safe_read(&variant_path).unwrap_or_default());
    if manifest.get("mode").and_then(|v| v.as_str()) == Some("insert") {
        return Ok(inline_svelte_component_insert_accept(
            manifest,
            &markup,
            &css_lines,
            variant_num,
            param_values,
            &source_file,
            cwd,
        ));
    }

    let root_tag = match_opening_tag(&markup)
        .map(|t| t.tag)
        .unwrap_or_else(|| "div".to_string());
    let contract: Vec<Value> = match manifest.get("propContract") {
        Some(Value::Array(a)) => a.clone(),
        _ => Vec::new(),
    };
    let compiler: Option<SharedBridge> = load_svelte_compiler(cwd);
    let original_markup = manifest
        .get("originalMarkup")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let merged_markup = merge_original_top_level_attrs(&markup, original_markup);

    let contract_version = crate::util::js_number(manifest.get("contractVersion"));
    let restored_text = if contract_version == Some(2.0) && compiler.is_some() {
        let bridge = compiler.clone().unwrap();
        let restored = {
            let mut guard = bridge.lock().unwrap();
            let mut parse = |src: &str| guard.parse(src);
            restore_svelte_markup(&merged_markup, &contract, &mut parse)
        };
        match restored {
            Ok(m) => m,
            Err(reason) => {
                return Ok(failure(
                    format!("Accepted variant does not parse: {}", reason),
                    manifest,
                ));
            }
        }
    } else {
        substitute_props_with_exprs(&merged_markup, &contract)
    };
    let restored_markup: Vec<String> = restored_text
        .split('\n')
        .map(|l| trim_end_js(l).to_string())
        .collect();

    let source_content = safe_read(&source_file).unwrap_or_default();
    let source_lines: Vec<String> = source_content.split('\n').map(String::from).collect();
    let start = js_integer(manifest.get("sourceStartLine")).map(|n| n - 1);
    let end = js_integer(manifest.get("sourceEndLine")).map(|n| n - 1);
    let (Some(start), Some(end)) = (start, end) else {
        return Ok(failure(
            format!(
                "Invalid source line range for {}",
                manifest
                    .get("sourceFile")
                    .and_then(|v| v.as_str())
                    .unwrap_or("undefined")
            ),
            manifest,
        ));
    };
    if start < 0 || end < start || end as usize >= source_lines.len() {
        return Ok(failure(
            format!(
                "Invalid source line range for {}",
                manifest
                    .get("sourceFile")
                    .and_then(|v| v.as_str())
                    .unwrap_or("undefined")
            ),
            manifest,
        ));
    }
    let start = start as usize;
    let end = end as usize;

    let indent = leading_ws(&source_lines[start]);
    let indented_markup = reindent_preserving_structure(&restored_markup, &indent);
    let mut new_lines: Vec<String> = Vec::new();
    new_lines.extend_from_slice(&source_lines[..start]);
    new_lines.extend(indented_markup);
    new_lines.extend_from_slice(&source_lines[end + 1..]);

    let compile_fn = |bridge: &SharedBridge| {
        let b = bridge.clone();
        move |src: &str| -> Option<Vec<crate::accept_css::UnusedWarning>> {
            let mut guard = b.lock().unwrap();
            guard.compile(src).ok()
        }
    };

    let pre_unused: BTreeSet<String> = match &compiler {
        Some(bridge) => {
            let f = compile_fn(bridge);
            collect_unused_selectors(&source_content, &f)
        }
        None => BTreeSet::new(),
    };

    let declared_params = read_declared_params(manifest, variant_num, cwd);
    let mut variant_css = css_lines.join("\n");
    if variant_css.contains("data-impeccable-variant")
        || variant_css.contains("impeccable-variant-ready")
    {
        variant_css =
            sanitize_accepted_svelte_css(&css_lines, variant_num, param_values, &root_tag)
                .join("\n");
    }
    let empty = Map::new();
    let baked_css = bake_param_values(
        &variant_css,
        &declared_params,
        param_values.unwrap_or(&empty),
    );
    let mut css_replaced = 0i64;
    let mut css_appended = 0i64;
    let mut css_pruned: Vec<String> = Vec::new();
    let mut css_superseded: Vec<String> = Vec::new();
    if !trim(&baked_css).is_empty() {
        let (text, replaced, appended) =
            merge_css_into_svelte_source(&new_lines.join("\n"), &baked_css);
        new_lines = text.split('\n').map(String::from).collect();
        css_replaced = replaced;
        css_appended = appended;
    }
    let mut final_text = new_lines.join("\n");

    // Preview truth: seeded selectors the variant did not re-declare.
    let mut outside: Vec<String> = Vec::new();
    outside.extend_from_slice(&source_lines[..start]);
    outside.extend_from_slice(&source_lines[end + 1..]);
    let outside_markup = STYLE_RE.replace_all(&outside.join("\n"), "").into_owned();
    let mut outside_classes: BTreeSet<String> = BTreeSet::new();
    for value in class_attr_values(&outside_markup) {
        for cls in split_ws(&value) {
            if !cls.contains('{') {
                outside_classes.insert(cls);
            }
        }
    }
    static DIRECTIVE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"class:([A-Za-z0-9_-]+)").unwrap());
    for c in DIRECTIVE_RE.captures_iter(&outside_markup) {
        outside_classes.insert(c[1].to_string());
    }
    static CLASS_TOKEN_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\.([A-Za-z0-9_-]+)").unwrap());
    let used_outside = |selector: &str| -> bool {
        CLASS_TOKEN_RE
            .captures_iter(selector)
            .any(|c| outside_classes.contains(&c[1]))
    };
    let incoming_selectors = collect_all_selectors(&baked_css);
    let superseded: Vec<String> = match manifest.get("seededSelectors") {
        Some(Value::Array(a)) => a
            .iter()
            .map(|v| normalize_selector(&crate::accept_css::js_string(v)))
            .filter(|s| !s.is_empty() && !incoming_selectors.contains(s) && !used_outside(s))
            .collect(),
        _ => Vec::new(),
    };
    if !superseded.is_empty() {
        let (text, removed) = remove_selectors_from_svelte_source(&final_text, &superseded);
        final_text = text;
        css_superseded = removed;
    }

    if let Some(bridge) = &compiler {
        let f = compile_fn(bridge);
        let (src, removed) = prune_unused_selectors(&final_text, &f, &pre_unused);
        final_text = src;
        css_pruned = removed;
    }

    let mut all_removed: Vec<String> = css_pruned.clone();
    all_removed.extend(css_superseded.iter().cloned());
    let lost = find_lost_selectors(&source_content, &final_text, &all_removed);
    if !lost.is_empty() {
        let mut m = Map::new();
        m.insert("handled".into(), Value::Bool(false));
        m.insert(
            "error".into(),
            Value::String(format!(
                "CSS reconciliation would lose selectors from the existing style block: {}. Source not modified; accept the variant manually.",
                lost.join(", ")
            )),
        );
        m.insert("mode".into(), Value::String("error".into()));
        return Ok(with_base(m, manifest));
    }

    if let Err(e) = std::fs::write(&source_file, &final_text) {
        return Ok(failure(
            format!("Failed to write Svelte source: {}", e),
            manifest,
        ));
    }
    remove_svelte_component_session(
        manifest.get("id").and_then(|v| v.as_str()).unwrap_or(""),
        cwd,
    );

    let (clean, findings) = verify_accepted_source(&final_text);
    let mut m = Map::new();
    m.insert("handled".into(), Value::Bool(true));
    m.insert(
        "css".into(),
        json!({ "replaced": css_replaced, "appended": css_appended, "pruned": css_pruned, "superseded": css_superseded }),
    );
    m.insert(
        "verify".into(),
        json!({ "clean": clean, "findings": findings }),
    );
    Ok(with_base(m, manifest))
}

/// JS: substitutePropsWithExprs(markup, contract)
fn substitute_props_with_exprs(markup: &str, contract: &[Value]) -> String {
    let mut out = markup.to_string();
    for entry in contract {
        let prop = entry
            .get("prop")
            .and_then(|v| v.as_str())
            .unwrap_or("undefined");
        let expr = entry
            .get("expr")
            .and_then(|v| v.as_str())
            .unwrap_or("undefined");
        out = out.replace(&format!("{{{}}}", prop), &format!("{{{}}}", expr));
    }
    out
}

fn inline_svelte_component_insert_accept(
    manifest: &Map<String, Value>,
    markup: &str,
    css_lines: &[String],
    variant_num: &str,
    param_values: Option<&Map<String, Value>>,
    source_file: &str,
    cwd: &str,
) -> Value {
    if !svelte_markup_has_visible_content(markup) {
        return failure(
            "Accepted Svelte insert variant is empty".to_string(),
            manifest,
        );
    }
    if DATA_IMPECCABLE_ATTR_RE.is_match(markup) {
        return failure(
            "Accepted Svelte insert variant contains preview-only data-impeccable attributes"
                .to_string(),
            manifest,
        );
    }
    let root_tag = match_opening_tag(markup)
        .map(|t| t.tag)
        .unwrap_or_else(|| "div".to_string());
    let restored_markup: Vec<String> = markup
        .split('\n')
        .map(|l| trim_end_js(l).to_string())
        .collect();
    let source_content = safe_read(source_file).unwrap_or_default();
    let source_lines: Vec<String> = source_content.split('\n').map(String::from).collect();
    let insert_index = js_integer(manifest.get("insertLine")).map(|n| n - 1);
    let Some(insert_index) =
        insert_index.filter(|i| *i >= 0 && (*i as usize) <= source_lines.len())
    else {
        return failure(
            format!(
                "Invalid insert line for {}",
                manifest
                    .get("sourceFile")
                    .and_then(|v| v.as_str())
                    .unwrap_or("undefined")
            ),
            manifest,
        );
    };
    let insert_index = insert_index as usize;
    let nearby = source_lines
        .get(insert_index)
        .or_else(|| {
            if insert_index > 0 {
                source_lines.get(insert_index - 1)
            } else {
                None
            }
        })
        .cloned()
        .unwrap_or_default();
    let indent = leading_ws(&nearby);
    let indented = reindent_preserving_structure(&restored_markup, &indent);
    let mut new_lines: Vec<String> = Vec::new();
    new_lines.extend_from_slice(&source_lines[..insert_index]);
    new_lines.extend(indented);
    new_lines.extend_from_slice(&source_lines[insert_index..]);

    let mut variant_css = css_lines.join("\n");
    if variant_css.contains("data-impeccable-variant")
        || variant_css.contains("impeccable-variant-ready")
    {
        variant_css = sanitize_accepted_svelte_css(css_lines, variant_num, param_values, &root_tag)
            .join("\n");
    }
    let declared = read_declared_params(manifest, variant_num, cwd);
    let empty = Map::new();
    let baked = bake_param_values(&variant_css, &declared, param_values.unwrap_or(&empty));
    if !trim(&baked).is_empty() {
        let (text, _, _) = merge_css_into_svelte_source(&new_lines.join("\n"), &baked);
        new_lines = text.split('\n').map(String::from).collect();
    }
    let final_text = new_lines.join("\n");
    if let Err(e) = std::fs::write(source_file, &final_text) {
        return failure(format!("Failed to write Svelte source: {}", e), manifest);
    }
    remove_svelte_component_session(
        manifest.get("id").and_then(|v| v.as_str()).unwrap_or(""),
        cwd,
    );
    let (clean, findings) = verify_accepted_source(&final_text);
    let mut m = Map::new();
    m.insert("handled".into(), Value::Bool(true));
    m.insert(
        "verify".into(),
        json!({ "clean": clean, "findings": findings }),
    );
    with_base(m, manifest)
}

/// JS: removeSvelteComponentSession(id, cwd)
pub fn remove_svelte_component_session(id: &str, cwd: &str) {
    let dir = component_session_dir(id, cwd);
    let _ = std::fs::remove_dir_all(&dir);
}

/// JS: compileCheckVariants(id, cwd) → { ok, failures, checked }
pub fn compile_check_variants(id: &str, cwd: &str) -> Value {
    let empty = json!({ "ok": true, "failures": [], "checked": 0 });
    let Ok(Some(manifest)) = find_svelte_component_manifest(id, cwd) else {
        return empty;
    };
    let Some(manifest_path) = manifest.get("manifestPath").and_then(|v| v.as_str()) else {
        return empty;
    };
    let Some(bridge) = load_svelte_compiler(cwd) else {
        return empty;
    };
    let session_dir = jsp::dirname(manifest_path);
    let Some(entries) = crate::source_search::read_dir_sorted(&session_dir) else {
        return empty;
    };
    static VARIANT_FILE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^v\d+\.svelte$").unwrap());
    let component_dir = manifest
        .get("componentDir")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let mut failures = Vec::new();
    let mut checked = 0;
    for entry in entries {
        if !VARIANT_FILE_RE.is_match(&entry.name) {
            continue;
        }
        checked += 1;
        let source = safe_read(&jsp::join(&[&session_dir, &entry.name])).unwrap_or_default();
        let result = bridge.lock().unwrap().compile(&source);
        if let Err(err) = result {
            let first_line = err.message.split('\n').next().unwrap_or("");
            let message: String = first_line
                .encode_utf16()
                .take(300)
                .collect::<Vec<u16>>()
                .pipe_from_utf16();
            failures.push(json!({
                "file": format!("{}/{}", component_dir, entry.name),
                "line": err.line,
                "column": err.column,
                "message": message,
            }));
        }
    }
    json!({ "ok": failures.is_empty(), "failures": failures, "checked": checked })
}

trait PipeU16 {
    fn pipe_from_utf16(self) -> String;
}
impl PipeU16 for Vec<u16> {
    fn pipe_from_utf16(self) -> String {
        String::from_utf16_lossy(&self)
    }
}

/// JS: bumpSvelteComponentPreviewRevision(id, cwd) → { revision, revisionDir } or None
pub fn bump_svelte_component_preview_revision(id: &str, cwd: &str) -> Option<Value> {
    let manifest = find_svelte_component_manifest(id, cwd).ok()??;
    let manifest_path = manifest
        .get("manifestPath")
        .and_then(|v| v.as_str())?
        .to_string();
    let session_dir = jsp::dirname(&manifest_path);
    let revision = crate::util::js_number(manifest.get("revision")).unwrap_or(0.0) as i64 + 1;
    let rev_dir_name = format!("r{}", revision);
    let rev_dir = jsp::join(&[&session_dir, &rev_dir_name]);
    std::fs::create_dir_all(&rev_dir).ok()?;
    let entries = crate::source_search::read_dir_sorted(&session_dir).unwrap_or_default();
    for entry in &entries {
        if !entry.is_file || entry.name == "manifest.json" {
            continue;
        }
        std::fs::copy(
            jsp::join(&[&session_dir, &entry.name]),
            jsp::join(&[&rev_dir, &entry.name]),
        )
        .ok()?;
    }
    static REV_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^r\d+$").unwrap());
    for entry in &entries {
        if entry.is_dir && REV_RE.is_match(&entry.name) && entry.name != rev_dir_name {
            let _ = std::fs::remove_dir_all(jsp::join(&[&session_dir, &entry.name]));
        }
    }
    let rel_session_dir = fwd(&jsp::relative("/", cwd, &session_dir));
    let mut updated = manifest.clone();
    updated.shift_remove("manifestPath");
    updated.insert("revision".into(), json!(revision));
    updated.insert(
        "revisionDir".into(),
        Value::String(format!("{}/{}", rel_session_dir, rev_dir_name)),
    );
    updated.insert("revisionDirAbs".into(), Value::String(fwd(&rev_dir)));
    std::fs::write(
        &manifest_path,
        format!("{}\n", json_pretty(&Value::Object(updated.clone()))),
    )
    .ok()?;
    Some(json!({ "revision": revision, "revisionDir": updated.get("revisionDir") }))
}

/// JS: removeAllSvelteComponentSessions(cwd)
pub fn remove_all_svelte_component_sessions(cwd: &str) {
    for root_rel in [SVELTE_COMPONENT_ROOT, LEGACY_SVELTE_COMPONENT_ROOT] {
        let root = jsp::join(&[cwd, root_rel]);
        if exists(&root) {
            let _ = std::fs::remove_dir_all(&root);
        }
    }
}

/// JS: sweepInactiveSvelteComponentSessions(activeIds, cwd) → { removed, removedRoot, kept }
pub fn sweep_inactive_svelte_component_sessions(active_ids: &[String], cwd: &str) -> Value {
    let mut removed: Vec<String> = Vec::new();
    let mut kept: Vec<String> = Vec::new();
    let mut removed_root = false;
    for root_rel in [SVELTE_COMPONENT_ROOT, LEGACY_SVELTE_COMPONENT_ROOT] {
        let root = jsp::join(&[cwd, root_rel]);
        if !exists(&root) {
            continue;
        }
        let Some(entries) = crate::source_search::read_dir_sorted(&root) else {
            continue;
        };
        let mut kept_here = 0;
        for entry in entries {
            if !entry.is_dir || entry.name.starts_with("__") {
                continue;
            }
            if active_ids.iter().any(|a| !a.is_empty() && *a == entry.name) {
                kept.push(entry.name.clone());
                kept_here += 1;
                continue;
            }
            let p = jsp::join(&[&root, &entry.name]);
            if std::fs::remove_dir_all(&p).is_ok() || !is_dir(&p) {
                removed.push(entry.name.clone());
            } else {
                kept.push(entry.name.clone());
                kept_here += 1;
            }
        }
        if kept_here == 0 && std::fs::remove_dir_all(&root).is_ok() {
            removed_root = true;
        }
    }
    json!({ "removed": removed, "removedRoot": removed_root, "kept": kept })
}

/// JS: buildSvelteComponentCssAuthoring(count)
pub fn build_svelte_component_css_authoring(count: i64) -> Value {
    let n = crate::wrap_common::count_len(count).max(0);
    let examples: Vec<&str> = (0..n).map(|_| ".expense-row { padding: 22px; }").collect();
    json!({
        "mode": "svelte-component",
        "styleTag": null,
        "strategy": "component-style-block",
        "rulePattern": ".semantic-class { ... }",
        "selectorExamples": examples,
        "requirements": [
            "Write each variant as a real Svelte component file (v1.svelte, v2.svelte, ...).",
            "Keep the prop names from propContract; bind dynamic text with {propName}, not literal snapshot text.",
            "Put variant CSS in the component <style> block using semantic class selectors.",
            "Author param-driven CSS against var(--p-<id>, default) and [data-p-<id>] using :global(...) so the runtime knob values reach the mounted root.",
            "Declare params in componentDir/params.json keyed by variant number (e.g. {\"1\": [...], \"2\": [...]}), NOT as a data-impeccable-params attribute.",
            "Do not use @scope or data-impeccable-variant selectors in component files.",
            "Do not edit the route source file during generation; only edit files under componentDir.",
        ],
        "forbidden": [
            "Do not use @scope blocks in Svelte component variants.",
            "Do not copy live DOM snapshot text into markup when propContract provides bindings.",
            "Do not add data-impeccable-* attributes inside component files. Svelte parses { in attribute values as an expression, so data-impeccable-params with JSON breaks the build; use componentDir/params.json instead.",
        ],
        "paramsFile": "params.json",
    })
}
