//! JS: live/svelte-ast.mjs. AST-based Svelte scaffolding: analyze the
//! selected markup (parsed by the app's compiler through the bridge, here as
//! a JSON AST), replace only FREE expressions with props, describe each-block
//! items and if-block probes for browser hydration, and restore a variant's
//! props back to the route expressions. Offsets are UTF-16 code units, as
//! the compiler reports them; the source is kept as `Vec<u16>` for slicing.

use serde_json::{json, Map, Value};
use std::collections::BTreeSet;

fn u16s(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}

fn from_u16(v: &[u16]) -> String {
    String::from_utf16_lossy(v)
}

fn ty(node: &Value) -> &str {
    node.get("type").and_then(|v| v.as_str()).unwrap_or("")
}

fn off(node: &Value, key: &str) -> Option<usize> {
    node.get(key).and_then(|v| v.as_u64()).map(|v| v as usize)
}

fn arr<'a>(node: &'a Value, key: &str) -> &'a [Value] {
    match node.get(key) {
        Some(Value::Array(a)) => a,
        _ => &[],
    }
}

fn nodes_of(fragment: Option<&Value>) -> &[Value] {
    match fragment {
        Some(f) => arr(f, "nodes"),
        None => &[],
    }
}

fn expr_text(source: &[u16], node: &Value) -> String {
    let (Some(s), Some(e)) = (off(node, "start"), off(node, "end")) else {
        return String::new();
    };
    let s = s.min(source.len());
    let e = e.min(source.len()).max(s);
    from_u16(&source[s..e])
}

const SKIP_KEYS: [&str; 6] = ["type", "start", "end", "loc", "range", "parent"];

/// JS: collectRootIdentifiers(node)  (insertion-ordered set)
pub fn collect_root_identifiers(node: &Value, out: &mut Vec<String>) {
    fn add(out: &mut Vec<String>, name: &str) {
        if !out.iter().any(|n| n == name) {
            out.push(name.to_string());
        }
    }
    match node {
        Value::Array(items) => {
            for item in items {
                collect_root_identifiers(item, out);
            }
        }
        Value::Object(obj) => match ty(node) {
            "Identifier" => {
                if let Some(name) = obj.get("name").and_then(|v| v.as_str()) {
                    add(out, name);
                }
            }
            "MemberExpression" => {
                if let Some(o) = obj.get("object") {
                    collect_root_identifiers(o, out);
                }
                if obj.get("computed").and_then(|v| v.as_bool()) == Some(true) {
                    if let Some(p) = obj.get("property") {
                        collect_root_identifiers(p, out);
                    }
                }
            }
            "Property" => {
                if obj.get("computed").and_then(|v| v.as_bool()) == Some(true) {
                    if let Some(k) = obj.get("key") {
                        collect_root_identifiers(k, out);
                    }
                }
                if let Some(v) = obj.get("value") {
                    collect_root_identifiers(v, out);
                }
            }
            "ArrowFunctionExpression" | "FunctionExpression" => {
                let mut bound: BTreeSet<String> = BTreeSet::new();
                for param in arr(node, "params") {
                    collect_pattern_names(param, &mut bound);
                }
                let mut inner = Vec::new();
                if let Some(body) = obj.get("body") {
                    collect_root_identifiers(body, &mut inner);
                }
                for name in inner {
                    if !bound.contains(&name) {
                        add(out, &name);
                    }
                }
            }
            _ => {
                for (key, value) in obj {
                    if SKIP_KEYS.contains(&key.as_str()) {
                        continue;
                    }
                    collect_root_identifiers(value, out);
                }
            }
        },
        _ => {}
    }
}

/// JS: collectPatternNames(pattern)
pub fn collect_pattern_names(pattern: &Value, out: &mut BTreeSet<String>) {
    if !pattern.is_object() {
        return;
    }
    match ty(pattern) {
        "Identifier" => {
            if let Some(name) = pattern.get("name").and_then(|v| v.as_str()) {
                out.insert(name.to_string());
            }
        }
        "ObjectPattern" => {
            for prop in arr(pattern, "properties") {
                if ty(prop) == "RestElement" {
                    if let Some(a) = prop.get("argument") {
                        collect_pattern_names(a, out);
                    }
                } else if let Some(v) = prop.get("value") {
                    collect_pattern_names(v, out);
                }
            }
        }
        "ArrayPattern" => {
            for el in arr(pattern, "elements") {
                if !el.is_null() {
                    collect_pattern_names(el, out);
                }
            }
        }
        "AssignmentPattern" => {
            if let Some(l) = pattern.get("left") {
                collect_pattern_names(l, out);
            }
        }
        "RestElement" => {
            if let Some(a) = pattern.get("argument") {
                collect_pattern_names(a, out);
            }
        }
        _ => {}
    }
}

const RESERVED_PROP_NAMES: &[&str] = &[
    "await",
    "break",
    "case",
    "catch",
    "class",
    "const",
    "continue",
    "debugger",
    "default",
    "delete",
    "do",
    "else",
    "enum",
    "export",
    "extends",
    "false",
    "finally",
    "for",
    "function",
    "if",
    "implements",
    "import",
    "in",
    "instanceof",
    "interface",
    "let",
    "new",
    "null",
    "package",
    "private",
    "protected",
    "public",
    "return",
    "static",
    "super",
    "switch",
    "this",
    "throw",
    "true",
    "try",
    "typeof",
    "undefined",
    "var",
    "void",
    "while",
    "with",
    "yield",
];

fn is_ident_start(c: char) -> bool {
    c.is_ascii_alphabetic() || c == '_' || c == '$'
}
fn is_ident_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_' || c == '$'
}

/// JS: derivePropName(expr)
/// `/(?:\.|\[["']?)([A-Za-z_$][\w$]*)["']?\]?\s*$/` then `/^([A-Za-z_$][\w$]*)$/`
/// then `value`; reserved words get `Value` appended.
pub fn derive_prop_name(expr: &str) -> String {
    let candidate = tail_identifier(expr)
        .or_else(|| {
            let mut chars = expr.chars();
            match chars.next() {
                Some(c) if is_ident_start(c) && chars.all(is_ident_char) => Some(expr.to_string()),
                _ => None,
            }
        })
        .unwrap_or_else(|| "value".to_string());
    if RESERVED_PROP_NAMES.contains(&candidate.as_str()) {
        format!("{}Value", candidate)
    } else {
        candidate
    }
}

/// The first regex of derivePropName: an identifier reached through `.` or
/// `[` (optionally quoted), optionally followed by a quote and `]`, then
/// trailing whitespace, at the very end of `expr`.
fn tail_identifier(expr: &str) -> Option<String> {
    let chars: Vec<char> = expr.chars().collect();
    let mut end = chars.len();
    while end > 0 && impeccable_core::js::is_js_whitespace(chars[end - 1]) {
        end -= 1;
    }
    // Optional `]`
    let mut i = end;
    if i > 0 && chars[i - 1] == ']' {
        i -= 1;
    }
    // Optional quote
    if i > 0 && (chars[i - 1] == '"' || chars[i - 1] == '\'') {
        i -= 1;
    }
    // Identifier: the regex is leftmost-first, so the identifier is the
    // maximal run ending at `i` that starts right after a `.` or `[`+quote?.
    let ident_end = i;
    let mut j = i;
    while j > 0 && is_ident_char(chars[j - 1]) {
        j -= 1;
    }
    // Try every start within the run whose first char is an ident start and
    // whose preceding context is `.` or `[` or `["` / `['`; the leftmost
    // (longest) qualifying start wins because the regex scans left to right.
    let mut k = j;
    while k < ident_end {
        if is_ident_start(chars[k]) {
            let prev = if k > 0 { Some(chars[k - 1]) } else { None };
            let ok = match prev {
                Some('.') => true,
                Some('[') => true,
                Some('"') | Some('\'') => k >= 2 && chars[k - 2] == '[',
                _ => false,
            };
            if ok {
                return Some(chars[k..ident_end].iter().collect());
            }
        }
        k += 1;
    }
    None
}

const GLOBAL_IDENTIFIERS: &[&str] = &[
    "Math",
    "JSON",
    "Date",
    "Intl",
    "Number",
    "String",
    "Boolean",
    "Array",
    "Object",
    "Map",
    "Set",
    "Promise",
    "RegExp",
    "NaN",
    "Infinity",
    "undefined",
    "isNaN",
    "isFinite",
    "parseInt",
    "parseFloat",
    "encodeURIComponent",
    "decodeURIComponent",
    "console",
    "window",
    "document",
    "navigator",
    "location",
    "structuredClone",
    "crypto",
];

type Scopes = Vec<BTreeSet<String>>;

fn classify_roots(node: &Value, scopes: &Scopes) -> (usize, usize) {
    let mut roots = Vec::new();
    collect_root_identifiers(node, &mut roots);
    let mut bound = 0;
    let mut free = 0;
    for name in roots {
        if GLOBAL_IDENTIFIERS.contains(&name.as_str()) {
            continue;
        }
        if scopes.iter().any(|s| s.contains(&name)) {
            bound += 1;
        } else {
            free += 1;
        }
    }
    (bound, free)
}

fn is_free(node: &Value, scopes: &Scopes) -> bool {
    let (bound, free) = classify_roots(node, scopes);
    free > 0 && bound == 0
}

struct Replacement {
    start: usize,
    end: usize,
    prop: String,
}

/// A contract entry as JS builds it: `{ prop, expr, kind, item?, probe? }`.
struct Entry {
    prop: String,
    expr: String,
    kind: &'static str,
    item: Option<Value>,
    probe: Option<Value>,
}

struct Analysis {
    source: Vec<u16>,
    replacements: Vec<Replacement>,
    contract: Vec<Entry>,
    used_names: BTreeSet<String>,
    unsupported: Option<String>,
}

impl Analysis {
    fn fail(&mut self, reason: String) {
        if self.unsupported.is_none() {
            self.unsupported = Some(reason);
        }
    }

    /// Returns the prop name for `expr_text`.
    fn prop_for(
        &mut self,
        expr_text: String,
        kind: &'static str,
        item: Option<Value>,
        probe: Option<Value>,
    ) -> String {
        if let Some(existing) = self.contract.iter().find(|e| e.expr == expr_text) {
            return existing.prop.clone();
        }
        let base = derive_prop_name(&expr_text);
        let mut name = base.clone();
        let mut n = 2;
        while self.used_names.contains(&name) {
            name = format!("{}{}", base, n);
            n += 1;
        }
        self.used_names.insert(name.clone());
        self.contract.push(Entry {
            prop: name.clone(),
            expr: expr_text,
            kind,
            item,
            probe,
        });
        name
    }

    fn fail_on_mixed(&mut self, node: &Value, scopes: &Scopes) -> bool {
        let (bound, free) = classify_roots(node, scopes);
        if bound > 0 && free > 0 {
            let text = expr_text(&self.source, node);
            let short: String = text
                .encode_utf16()
                .take(60)
                .collect::<Vec<u16>>()
                .pipe(|v| from_u16(&v));
            self.fail(format!(
                "expression mixing loop and outer identifiers ({{{}}}) requires source-preview mode",
                short
            ));
            return true;
        }
        false
    }

    fn replace_with_prop(
        &mut self,
        node: &Value,
        kind: &'static str,
        item: Option<Value>,
        probe: Option<Value>,
    ) {
        let text = expr_text(&self.source, node);
        let prop = self.prop_for(text, kind, item, probe);
        if let (Some(s), Some(e)) = (off(node, "start"), off(node, "end")) {
            self.replacements.push(Replacement {
                start: s,
                end: e,
                prop,
            });
        }
    }
}

trait Pipe: Sized {
    fn pipe<R>(self, f: impl FnOnce(Self) -> R) -> R {
        f(self)
    }
}
impl<T> Pipe for T {}

fn analyze_fragment(fragment: Option<&Value>, analysis: &mut Analysis, scopes: &Scopes) {
    let nodes = nodes_of(fragment);
    if nodes.is_empty() {
        return;
    }
    let mut fragment_scope: BTreeSet<String> = BTreeSet::new();
    for node in nodes {
        if ty(node) == "ConstTag" {
            if let Some(decl) = node.get("declaration") {
                for d in arr(decl, "declarations") {
                    if let Some(id) = d.get("id") {
                        collect_pattern_names(id, &mut fragment_scope);
                    }
                }
            }
        }
    }
    let mut next: Scopes = scopes.clone();
    next.push(fragment_scope);
    for node in nodes {
        analyze_node(node, analysis, &next);
    }
}

fn with_scope(scopes: &Scopes, bound: BTreeSet<String>) -> Scopes {
    let mut next = scopes.clone();
    next.push(bound);
    next
}

fn analyze_node(node: &Value, analysis: &mut Analysis, scopes: &Scopes) {
    if !node.is_object() || analysis.unsupported.is_some() {
        return;
    }
    match ty(node) {
        "Text" | "Comment" => {}
        "ExpressionTag" | "HtmlTag" => {
            let kind = if ty(node) == "HtmlTag" { "raw" } else { "text" };
            let Some(expr) = node.get("expression") else {
                return;
            };
            if analysis.fail_on_mixed(expr, scopes) {
                return;
            }
            if is_free(expr, scopes) {
                analysis.replace_with_prop(expr, kind, None, None);
            }
        }
        "ConstTag" => {
            if let Some(decl) = node.get("declaration") {
                for d in arr(decl, "declarations") {
                    let Some(init) = d.get("init") else { continue };
                    if init.is_null() {
                        continue;
                    }
                    if analysis.fail_on_mixed(init, scopes) {
                        return;
                    }
                    if is_free(init, scopes) {
                        analysis.replace_with_prop(init, "text", None, None);
                    }
                }
            }
        }
        "EachBlock" => {
            let Some(expr) = node.get("expression") else {
                return;
            };
            if analysis.fail_on_mixed(expr, scopes) {
                return;
            }
            if is_free(expr, scopes) {
                let text = expr_text(&analysis.source, expr);
                let mut item = describe_each_item(node, &analysis.source);
                if node.get("key").map(|k| !k.is_null()).unwrap_or(false) {
                    match classify_each_key(node) {
                        KeyInfo::Unsupported(reason) => {
                            analysis.fail(reason);
                            return;
                        }
                        KeyInfo::Field(field) => {
                            let displayed = item
                                .get("textSlots")
                                .and_then(|v| v.as_array())
                                .map(|slots| {
                                    slots.iter().any(|s| {
                                        s.get("key").and_then(|k| k.as_str())
                                            == Some(field.as_str())
                                    })
                                })
                                .unwrap_or(false);
                            if displayed {
                                analysis.fail("each key that is also a displayed field requires source-preview mode".to_string());
                                return;
                            }
                            if let Value::Object(o) = &mut item {
                                o.insert("keyField".to_string(), Value::String(field));
                            }
                        }
                        KeyInfo::Plain => {}
                    }
                }
                let prop = analysis.prop_for(text, "collection", Some(item), None);
                if let (Some(s), Some(e)) = (off(expr, "start"), off(expr, "end")) {
                    analysis.replacements.push(Replacement {
                        start: s,
                        end: e,
                        prop,
                    });
                }
            }
            let mut bound: BTreeSet<String> = BTreeSet::new();
            if let Some(ctx) = node.get("context") {
                collect_pattern_names(ctx, &mut bound);
            }
            if let Some(idx) = node.get("index").and_then(|v| v.as_str()) {
                bound.insert(idx.to_string());
            }
            analyze_fragment(node.get("body"), analysis, &with_scope(scopes, bound));
            if let Some(fb) = node.get("fallback") {
                if !fb.is_null() {
                    analyze_fragment(Some(fb), analysis, scopes);
                }
            }
        }
        "IfBlock" => {
            let Some(test) = node.get("test") else { return };
            if analysis.fail_on_mixed(test, scopes) {
                return;
            }
            if is_free(test, scopes) {
                let probe = describe_element_probe(node.get("consequent"));
                analysis.replace_with_prop(test, "condition", None, Some(probe));
            }
            analyze_fragment(node.get("consequent"), analysis, scopes);
            if let Some(alt) = node.get("alternate") {
                if !alt.is_null() {
                    analyze_fragment(Some(alt), analysis, scopes);
                }
            }
        }
        "KeyBlock" => {
            let Some(expr) = node.get("expression") else {
                return;
            };
            if analysis.fail_on_mixed(expr, scopes) {
                return;
            }
            if is_free(expr, scopes) {
                analysis.replace_with_prop(expr, "text", None, None);
            }
            analyze_fragment(node.get("fragment"), analysis, scopes);
        }
        "SnippetBlock" => {
            let mut bound: BTreeSet<String> = BTreeSet::new();
            for param in arr(node, "parameters") {
                collect_pattern_names(param, &mut bound);
            }
            analyze_fragment(node.get("body"), analysis, &with_scope(scopes, bound));
        }
        "RegularElement" | "SlotElement" | "TitleElement" => {
            if node.get("name").and_then(|v| v.as_str()) == Some("script") {
                analysis.fail("inline script element requires source-preview mode".to_string());
                return;
            }
            analyze_attributes(node, analysis, scopes);
            if analysis.unsupported.is_none() {
                analyze_fragment(node.get("fragment"), analysis, scopes);
            }
        }
        "SvelteElement" | "SvelteFragment" | "SvelteBoundary" => {
            analyze_attributes(node, analysis, scopes);
            if analysis.unsupported.is_none() {
                analyze_fragment(node.get("fragment"), analysis, scopes);
            }
        }
        "Component" | "SvelteComponent" | "SvelteSelf" => {
            let name = node
                .get("name")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .unwrap_or("Component");
            analysis.fail(format!(
                "component tag <{}> requires source-preview mode",
                name
            ));
        }
        "RenderTag" => analysis.fail("render tag requires source-preview mode".to_string()),
        "AwaitBlock" => analysis.fail("await block requires source-preview mode".to_string()),
        "SvelteHead" | "SvelteWindow" | "SvelteDocument" | "SvelteBody" => {
            analysis.fail(format!("{} requires source-preview mode", ty(node)));
        }
        _ => {
            if node.get("fragment").map(|f| !f.is_null()).unwrap_or(false) {
                analyze_fragment(node.get("fragment"), analysis, scopes);
            }
        }
    }
}

fn is_handler_attr(name: &str) -> bool {
    let b = name.as_bytes();
    b.len() >= 3 && b[0] == b'o' && b[1] == b'n' && b[2].is_ascii_lowercase()
}

/// `attr.value === true` → None; else the parts array.
fn attr_parts(attr: &Value) -> Option<Vec<&Value>> {
    match attr.get("value") {
        Some(Value::Bool(true)) => None,
        Some(Value::Array(a)) => Some(a.iter().collect()),
        Some(v) => Some(vec![v]),
        None => Some(vec![]),
    }
}

fn analyze_attributes(node: &Value, analysis: &mut Analysis, scopes: &Scopes) {
    for attr in arr(node, "attributes") {
        match ty(attr) {
            "Attribute" => {
                let Some(parts) = attr_parts(attr) else {
                    continue;
                };
                let name = attr.get("name").and_then(|v| v.as_str()).unwrap_or("");
                for part in parts {
                    if ty(part) != "ExpressionTag" {
                        continue;
                    }
                    let Some(expr) = part.get("expression") else {
                        continue;
                    };
                    if analysis.fail_on_mixed(expr, scopes) {
                        return;
                    }
                    if !is_free(expr, scopes) {
                        continue;
                    }
                    let kind = if is_handler_attr(name) {
                        "handler"
                    } else {
                        "text"
                    };
                    analysis.replace_with_prop(expr, kind, None, None);
                }
            }
            "ClassDirective" => {
                let Some(expr) = attr.get("expression") else {
                    continue;
                };
                if expr.is_null() {
                    continue;
                }
                if analysis.fail_on_mixed(expr, scopes) {
                    return;
                }
                if is_free(expr, scopes) {
                    let name = attr.get("name").cloned().unwrap_or(Value::Null);
                    analysis.replace_with_prop(
                        expr,
                        "condition",
                        None,
                        Some(json!({ "className": name })),
                    );
                }
            }
            "StyleDirective" => {
                let parts: Vec<&Value> = attr_parts(attr).unwrap_or_default();
                for part in &parts {
                    if ty(part) == "ExpressionTag" {
                        if let Some(expr) = part.get("expression") {
                            if analysis.fail_on_mixed(expr, scopes) {
                                return;
                            }
                        }
                    }
                }
                let dynamic = parts.iter().any(|p| {
                    ty(p) == "ExpressionTag"
                        && p.get("expression")
                            .map(|e| is_free(e, scopes))
                            .unwrap_or(false)
                });
                let name = attr.get("name").and_then(|v| v.as_str()).unwrap_or("");
                let shorthand_free = matches!(attr.get("value"), Some(Value::Bool(true)))
                    && is_free(&json!({ "type": "Identifier", "name": name }), scopes);
                if dynamic || shorthand_free {
                    analysis.fail(format!(
                        "style:{} with a dynamic value requires source-preview mode",
                        name
                    ));
                }
            }
            "BindDirective" => {
                let name = attr.get("name").and_then(|v| v.as_str()).unwrap_or("");
                analysis.fail(format!("bind:{} requires source-preview mode", name));
                return;
            }
            "UseDirective" => {
                let name = attr.get("name").and_then(|v| v.as_str()).unwrap_or("");
                analysis.fail(format!("use:{} requires source-preview mode", name));
                return;
            }
            "AnimateDirective" | "TransitionDirective" => {
                analysis.fail(format!("{} requires source-preview mode", ty(attr)));
                return;
            }
            "OnDirective" => {
                let Some(expr) = attr.get("expression") else {
                    continue;
                };
                if expr.is_null() {
                    continue;
                }
                if analysis.fail_on_mixed(expr, scopes) {
                    return;
                }
                if is_free(expr, scopes) {
                    analysis.replace_with_prop(expr, "handler", None, None);
                }
            }
            "SpreadAttribute" => {
                analysis.fail("spread attribute requires source-preview mode".to_string());
                return;
            }
            _ => {}
        }
    }
}

struct ScopeInfo {
    names: BTreeSet<String>,
    item_name: Option<String>,
    index_name: Option<String>,
}

fn scope_info_of(each: &Value) -> ScopeInfo {
    let mut names = BTreeSet::new();
    if let Some(ctx) = each.get("context") {
        collect_pattern_names(ctx, &mut names);
    }
    let item_name = each
        .get("context")
        .filter(|c| ty(c) == "Identifier")
        .and_then(|c| c.get("name"))
        .and_then(|v| v.as_str())
        .map(String::from);
    let index_name = each.get("index").and_then(|v| v.as_str()).map(String::from);
    ScopeInfo {
        names,
        item_name,
        index_name,
    }
}

fn bound_as(name: &str, infos: &[ScopeInfo]) -> Option<&'static str> {
    for info in infos.iter().rev() {
        if info.index_name.as_deref() == Some(name) {
            return Some("index");
        }
        if info.item_name.as_deref() == Some(name) {
            return Some("item");
        }
        if info.names.contains(name) {
            return Some("field");
        }
    }
    None
}

enum Slot {
    Crashy,
    Lossy,
    Skip,
    Key(String),
}

#[derive(Default, Clone, Copy)]
struct Ctx {
    callee: bool,
    member_object: bool,
}

fn slot_keys_of(expression: &Value, infos: &[ScopeInfo]) -> Slot {
    let mut keys: Vec<String> = Vec::new();
    let mut crashy = false;
    let mut lossy = false;
    let mut touches = false;
    fn visit(
        node: &Value,
        ctx: Ctx,
        infos: &[ScopeInfo],
        keys: &mut Vec<String>,
        crashy: &mut bool,
        lossy: &mut bool,
        touches: &mut bool,
    ) {
        if *crashy {
            return;
        }
        match node {
            Value::Array(items) => {
                for item in items {
                    visit(item, Ctx::default(), infos, keys, crashy, lossy, touches);
                }
            }
            Value::Object(obj) => match ty(node) {
                "Identifier" => {
                    let name = obj.get("name").and_then(|v| v.as_str()).unwrap_or("");
                    let Some(kind) = bound_as(name, infos) else {
                        return;
                    };
                    *touches = true;
                    if kind == "index" {
                        return;
                    }
                    if kind == "item" {
                        *lossy = true;
                        return;
                    }
                    if ctx.callee {
                        *crashy = true;
                        return;
                    }
                    if !keys.iter().any(|k| k == name) {
                        keys.push(name.to_string());
                    }
                }
                "MemberExpression" => {
                    let computed = obj.get("computed").and_then(|v| v.as_bool()) == Some(true);
                    let object = obj.get("object");
                    let property = obj.get("property");
                    if !computed
                        && object.map(|o| ty(o) == "Identifier").unwrap_or(false)
                        && object
                            .and_then(|o| o.get("name"))
                            .and_then(|v| v.as_str())
                            .map(|n| bound_as(n, infos) == Some("item"))
                            .unwrap_or(false)
                        && property.map(|p| ty(p) == "Identifier").unwrap_or(false)
                    {
                        *touches = true;
                        if ctx.member_object || ctx.callee {
                            *crashy = true;
                            return;
                        }
                        let name = property
                            .and_then(|p| p.get("name"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("");
                        if !keys.iter().any(|k| k == name) {
                            keys.push(name.to_string());
                        }
                        return;
                    }
                    if let Some(o) = object {
                        visit(
                            o,
                            Ctx {
                                member_object: true,
                                callee: false,
                            },
                            infos,
                            keys,
                            crashy,
                            lossy,
                            touches,
                        );
                    }
                    if computed {
                        if let Some(p) = property {
                            visit(p, Ctx::default(), infos, keys, crashy, lossy, touches);
                        }
                    }
                }
                "CallExpression" => {
                    if let Some(c) = obj.get("callee") {
                        visit(
                            c,
                            Ctx {
                                callee: true,
                                member_object: false,
                            },
                            infos,
                            keys,
                            crashy,
                            lossy,
                            touches,
                        );
                    }
                    for a in arr(node, "arguments") {
                        visit(a, Ctx::default(), infos, keys, crashy, lossy, touches);
                    }
                }
                "ArrowFunctionExpression" | "FunctionExpression" => {
                    let mut roots = Vec::new();
                    collect_root_identifiers(node, &mut roots);
                    if roots.iter().any(|n| bound_as(n, infos).is_some()) {
                        *touches = true;
                        *lossy = true;
                    }
                }
                "Property" => {
                    if obj.get("computed").and_then(|v| v.as_bool()) == Some(true) {
                        if let Some(k) = obj.get("key") {
                            visit(k, Ctx::default(), infos, keys, crashy, lossy, touches);
                        }
                    }
                    if let Some(v) = obj.get("value") {
                        visit(v, Ctx::default(), infos, keys, crashy, lossy, touches);
                    }
                }
                _ => {
                    for (key, value) in obj {
                        if SKIP_KEYS.contains(&key.as_str()) {
                            continue;
                        }
                        visit(value, Ctx::default(), infos, keys, crashy, lossy, touches);
                    }
                }
            },
            _ => {}
        }
    }
    visit(
        expression,
        Ctx::default(),
        infos,
        &mut keys,
        &mut crashy,
        &mut lossy,
        &mut touches,
    );
    if crashy {
        return Slot::Crashy;
    }
    if lossy || keys.len() > 1 {
        return Slot::Lossy;
    }
    if !touches || keys.is_empty() {
        return Slot::Skip;
    }
    Slot::Key(keys[0].clone())
}

fn static_classes_of(el: Option<&Value>) -> Vec<String> {
    let mut classes = Vec::new();
    let Some(el) = el else { return classes };
    for attr in arr(el, "attributes") {
        if ty(attr) == "Attribute" && attr.get("name").and_then(|v| v.as_str()) == Some("class") {
            if let Some(Value::Array(parts)) = attr.get("value") {
                for part in parts {
                    if ty(part) == "Text" {
                        let data = part.get("data").and_then(|v| v.as_str()).unwrap_or("");
                        for c in data.split(impeccable_core::js::is_js_whitespace) {
                            if !c.is_empty() {
                                classes.push(c.to_string());
                            }
                        }
                    }
                }
            }
        }
    }
    classes
}

fn describe_each_item(node: &Value, source: &[u16]) -> Value {
    let body = node.get("body");
    let root_el = nodes_of(body).iter().find(|n| ty(n) == "RegularElement");

    let mut text_slots: Vec<Value> = Vec::new();
    let mut static_texts: Vec<String> = Vec::new();
    let mut nested_unsupported = false;
    fn collect_statics(fragment: Option<&Value>, out: &mut Vec<String>) {
        for child in nodes_of(fragment) {
            match ty(child) {
                "Text" => {
                    let data = child.get("data").and_then(|v| v.as_str()).unwrap_or("");
                    let trimmed = impeccable_core::js::trim(data);
                    if !trimmed.is_empty() {
                        out.push(trimmed.to_string());
                    }
                }
                "IfBlock" => {
                    collect_statics(child.get("consequent"), out);
                    if let Some(alt) = child.get("alternate") {
                        if !alt.is_null() {
                            collect_statics(Some(alt), out);
                        }
                    }
                }
                "EachBlock" => collect_statics(child.get("body"), out),
                _ => {
                    if let Some(f) = child.get("fragment") {
                        if !f.is_null() {
                            collect_statics(Some(f), out);
                        }
                    }
                }
            }
        }
    }
    collect_statics(body, &mut static_texts);
    let mut attr_slots: Vec<Value> = Vec::new();

    fn walk_for_slots(
        fragment: Option<&Value>,
        infos: &mut Vec<ScopeInfo>,
        source: &[u16],
        text_slots: &mut Vec<Value>,
        attr_slots: &mut Vec<Value>,
        nested_unsupported: &mut bool,
    ) {
        for child in nodes_of(fragment) {
            match ty(child) {
                "ExpressionTag" => {
                    let Some(expr) = child.get("expression") else {
                        continue;
                    };
                    match slot_keys_of(expr, infos) {
                        Slot::Crashy | Slot::Lossy => {
                            *nested_unsupported = true;
                            continue;
                        }
                        Slot::Skip => continue,
                        Slot::Key(key) => {
                            text_slots.push(json!({ "key": key, "expr": expr_text(source, expr) }))
                        }
                    }
                }
                "RegularElement" | "SvelteElement" => {
                    for attr in arr(child, "attributes") {
                        if ty(attr) != "Attribute"
                            || matches!(attr.get("value"), Some(Value::Bool(true)))
                        {
                            continue;
                        }
                        let name = attr.get("name").and_then(|v| v.as_str()).unwrap_or("");
                        if is_handler_attr(name) {
                            continue;
                        }
                        let parts = attr_parts(attr).unwrap_or_default();
                        let expr_parts: Vec<&Value> = parts
                            .iter()
                            .copied()
                            .filter(|p| ty(p) == "ExpressionTag")
                            .collect();
                        for part in expr_parts {
                            let Some(expr) = part.get("expression") else {
                                continue;
                            };
                            match slot_keys_of(expr, infos) {
                                Slot::Crashy => {
                                    *nested_unsupported = true;
                                    continue;
                                }
                                Slot::Skip | Slot::Lossy => continue,
                                Slot::Key(key) => {
                                    if parts.len() != 1 {
                                        continue;
                                    }
                                    attr_slots.push(json!({
                                        "key": key,
                                        "expr": expr_text(source, expr),
                                        "attr": name,
                                        "tag": child.get("name").cloned().filter(|v| !v.is_null()).unwrap_or(Value::Null),
                                        "classes": static_classes_of(Some(child)),
                                    }));
                                }
                            }
                        }
                    }
                    walk_for_slots(
                        child.get("fragment"),
                        infos,
                        source,
                        text_slots,
                        attr_slots,
                        nested_unsupported,
                    );
                    continue;
                }
                "EachBlock" => {
                    let mut roots = Vec::new();
                    if let Some(e) = child.get("expression") {
                        collect_root_identifiers(e, &mut roots);
                    }
                    if roots.iter().any(|n| bound_as(n, infos).is_some()) {
                        *nested_unsupported = true;
                    }
                    infos.push(scope_info_of(child));
                    walk_for_slots(
                        child.get("body"),
                        infos,
                        source,
                        text_slots,
                        attr_slots,
                        nested_unsupported,
                    );
                    infos.pop();
                }
                "IfBlock" => {
                    walk_for_slots(
                        child.get("consequent"),
                        infos,
                        source,
                        text_slots,
                        attr_slots,
                        nested_unsupported,
                    );
                    if let Some(alt) = child.get("alternate") {
                        if !alt.is_null() {
                            walk_for_slots(
                                Some(alt),
                                infos,
                                source,
                                text_slots,
                                attr_slots,
                                nested_unsupported,
                            );
                        }
                    }
                }
                _ => {
                    if let Some(f) = child.get("fragment") {
                        if !f.is_null() {
                            walk_for_slots(
                                Some(f),
                                infos,
                                source,
                                text_slots,
                                attr_slots,
                                nested_unsupported,
                            );
                        }
                    }
                }
            }
        }
    }
    let mut infos = vec![scope_info_of(node)];
    walk_for_slots(
        body,
        &mut infos,
        source,
        &mut text_slots,
        &mut attr_slots,
        &mut nested_unsupported,
    );

    let root_classes = static_classes_of(root_el);
    json!({
        "rootTag": root_el.and_then(|e| e.get("name")).cloned().filter(|v| !v.is_null()).unwrap_or(Value::Null),
        "rootClasses": root_classes,
        "textSlots": text_slots,
        "attrSlots": attr_slots,
        "staticTexts": static_texts,
        "nestedUnsupported": nested_unsupported,
    })
}

enum KeyInfo {
    Field(String),
    Plain,
    Unsupported(String),
}

fn classify_each_key(node: &Value) -> KeyInfo {
    let mut bound: BTreeSet<String> = BTreeSet::new();
    if let Some(ctx) = node.get("context") {
        collect_pattern_names(ctx, &mut bound);
    }
    if let Some(idx) = node.get("index").and_then(|v| v.as_str()) {
        bound.insert(idx.to_string());
    }
    let key = node.get("key").cloned().unwrap_or(Value::Null);
    let mut roots = Vec::new();
    collect_root_identifiers(&key, &mut roots);
    let uses_loop_binding = roots.iter().any(|n| bound.contains(n));
    if !uses_loop_binding {
        return KeyInfo::Unsupported(
            "each key not derived from the loop item requires source-preview mode".to_string(),
        );
    }
    if ty(&key) == "Identifier"
        && key
            .get("name")
            .and_then(|v| v.as_str())
            .map(|n| bound.contains(n))
            .unwrap_or(false)
    {
        return KeyInfo::Plain;
    }
    if ty(&key) == "MemberExpression"
        && key.get("computed").and_then(|v| v.as_bool()) != Some(true)
        && key
            .get("object")
            .map(|o| ty(o) == "Identifier")
            .unwrap_or(false)
        && key
            .get("object")
            .and_then(|o| o.get("name"))
            .and_then(|v| v.as_str())
            .map(|n| bound.contains(n))
            .unwrap_or(false)
        && key
            .get("property")
            .map(|p| ty(p) == "Identifier")
            .unwrap_or(false)
    {
        let field = key
            .get("property")
            .and_then(|p| p.get("name"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        return KeyInfo::Field(field);
    }
    KeyInfo::Unsupported("complex each key requires source-preview mode".to_string())
}

fn describe_element_probe(fragment: Option<&Value>) -> Value {
    let Some(root_el) = nodes_of(fragment)
        .iter()
        .find(|n| ty(n) == "RegularElement")
    else {
        return Value::Null;
    };
    json!({ "tag": root_el.get("name").cloned().unwrap_or(Value::Null), "classes": static_classes_of(Some(root_el)) })
}

/// The analysis result: prop-substituted markup and the v2 contract.
pub struct MarkupAnalysis {
    pub markup_with_props: String,
    pub contract: Vec<Value>,
}

/// JS: analyzeSvelteMarkup(markup, parse). `parse` is the bridge's parse
/// (Ok(ast) / Err(message)).
pub fn analyze_svelte_markup(
    markup: &str,
    parse: &mut dyn FnMut(&str) -> Result<Value, String>,
) -> Result<MarkupAnalysis, String> {
    let ast = match parse(markup) {
        Ok(ast) => ast,
        Err(msg) => return Err(format!("svelte parse failed: {}", msg)),
    };
    let has = |k: &str| ast.get(k).map(|v| !v.is_null()).unwrap_or(false);
    if has("instance") || has("module") {
        return Err("selected block contains a script tag".to_string());
    }
    let mut analysis = Analysis {
        source: u16s(markup),
        replacements: Vec::new(),
        contract: Vec::new(),
        used_names: BTreeSet::new(),
        unsupported: None,
    };
    analyze_fragment(ast.get("fragment"), &mut analysis, &Vec::new());
    if let Some(reason) = analysis.unsupported.take() {
        return Err(reason);
    }
    for entry in &analysis.contract {
        if entry.kind == "collection" {
            let nested = entry
                .item
                .as_ref()
                .and_then(|i| i.get("nestedUnsupported"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            if nested {
                return Err(
                    "per-item content (nested blocks or expressions) this preview cannot hydrate requires source-preview mode"
                        .to_string(),
                );
            }
        }
    }
    let markup_with_props = apply_replacements(&analysis.source, &analysis.replacements);
    let contract = analysis
        .contract
        .iter()
        .map(|e| {
            let mut o = Map::new();
            o.insert("prop".into(), Value::String(e.prop.clone()));
            o.insert("expr".into(), Value::String(e.expr.clone()));
            o.insert("kind".into(), Value::String(e.kind.to_string()));
            o.insert(
                "placeholder".into(),
                Value::String(format!("{{{}}}", e.expr)),
            );
            if let Some(item) = &e.item {
                o.insert("item".into(), item.clone());
            }
            if let Some(probe) = &e.probe {
                if !probe.is_null() {
                    o.insert("probe".into(), probe.clone());
                }
            }
            Value::Object(o)
        })
        .collect();
    Ok(MarkupAnalysis {
        markup_with_props,
        contract,
    })
}

fn apply_replacements(source: &[u16], replacements: &[Replacement]) -> String {
    let mut sorted: Vec<&Replacement> = replacements.iter().collect();
    sorted.sort_by(|a, b| b.start.cmp(&a.start));
    let mut out: Vec<u16> = source.to_vec();
    for r in sorted {
        let s = r.start.min(out.len());
        let e = r.end.min(out.len()).max(s);
        let mut next = out[..s].to_vec();
        next.extend(u16s(&r.prop));
        next.extend_from_slice(&out[e..]);
        out = next;
    }
    from_u16(&out)
}

/// JS: restoreSvelteMarkup(markup, contract, parse) → Ok(markup) / Err(reason)
pub fn restore_svelte_markup(
    markup: &str,
    contract: &[Value],
    parse: &mut dyn FnMut(&str) -> Result<Value, String>,
) -> Result<String, String> {
    let mut by_prop: Vec<(String, String)> = Vec::new();
    for entry in contract {
        let (Some(p), Some(e)) = (
            entry.get("prop").and_then(|v| v.as_str()),
            entry.get("expr").and_then(|v| v.as_str()),
        ) else {
            continue;
        };
        if let Some(existing) = by_prop.iter_mut().find(|(k, _)| k == p) {
            existing.1 = e.to_string();
        } else {
            by_prop.push((p.to_string(), e.to_string()));
        }
    }
    if by_prop.is_empty() {
        return Ok(markup.to_string());
    }
    let ast = match parse(markup) {
        Ok(ast) => ast,
        Err(msg) => return Err(format!("variant parse failed: {}", msg)),
    };
    let source = u16s(markup);
    let mut replacements: Vec<Replacement> = Vec::new();

    fn visit_expr(
        expression: Option<&Value>,
        scopes: &Scopes,
        by_prop: &[(String, String)],
        out: &mut Vec<Replacement>,
    ) {
        let Some(expression) = expression else { return };
        if expression.is_null() {
            return;
        }
        collect_free_identifier_ranges(expression, scopes, &mut |name, start, end| {
            if let Some((_, original)) = by_prop.iter().find(|(k, _)| k == name) {
                if original != name {
                    out.push(Replacement {
                        start,
                        end,
                        prop: original.clone(),
                    });
                }
            }
        });
    }

    fn walk(
        fragment: Option<&Value>,
        scopes: &Scopes,
        by_prop: &[(String, String)],
        out: &mut Vec<Replacement>,
    ) {
        let mut fragment_scope: BTreeSet<String> = BTreeSet::new();
        for node in nodes_of(fragment) {
            if ty(node) == "ConstTag" {
                if let Some(decl) = node.get("declaration") {
                    for d in arr(decl, "declarations") {
                        if let Some(id) = d.get("id") {
                            collect_pattern_names(id, &mut fragment_scope);
                        }
                    }
                }
            }
        }
        let next = with_scope(scopes, fragment_scope);
        for node in nodes_of(fragment) {
            match ty(node) {
                "ExpressionTag" | "HtmlTag" => {
                    visit_expr(node.get("expression"), &next, by_prop, out)
                }
                "ConstTag" => {
                    if let Some(decl) = node.get("declaration") {
                        for d in arr(decl, "declarations") {
                            visit_expr(d.get("init"), &next, by_prop, out);
                        }
                    }
                }
                "EachBlock" => {
                    visit_expr(node.get("expression"), &next, by_prop, out);
                    let mut bound: BTreeSet<String> = BTreeSet::new();
                    if let Some(ctx) = node.get("context") {
                        collect_pattern_names(ctx, &mut bound);
                    }
                    if let Some(idx) = node.get("index").and_then(|v| v.as_str()) {
                        bound.insert(idx.to_string());
                    }
                    let inner = with_scope(&next, bound);
                    if node.get("key").map(|k| !k.is_null()).unwrap_or(false) {
                        visit_expr(node.get("key"), &inner, by_prop, out);
                    }
                    walk(node.get("body"), &inner, by_prop, out);
                    if let Some(fb) = node.get("fallback") {
                        if !fb.is_null() {
                            walk(Some(fb), &next, by_prop, out);
                        }
                    }
                }
                "IfBlock" => {
                    visit_expr(node.get("test"), &next, by_prop, out);
                    walk(node.get("consequent"), &next, by_prop, out);
                    if let Some(alt) = node.get("alternate") {
                        if !alt.is_null() {
                            walk(Some(alt), &next, by_prop, out);
                        }
                    }
                }
                "KeyBlock" => {
                    visit_expr(node.get("expression"), &next, by_prop, out);
                    walk(node.get("fragment"), &next, by_prop, out);
                }
                "SnippetBlock" => {
                    let mut bound: BTreeSet<String> = BTreeSet::new();
                    for param in arr(node, "parameters") {
                        collect_pattern_names(param, &mut bound);
                    }
                    walk(node.get("body"), &with_scope(&next, bound), by_prop, out);
                }
                _ => {
                    for attr in arr(node, "attributes") {
                        if ty(attr) == "Attribute"
                            && matches!(attr.get("value"), Some(Value::Array(_)))
                        {
                            for part in arr(attr, "value") {
                                if ty(part) == "ExpressionTag" {
                                    visit_expr(part.get("expression"), &next, by_prop, out);
                                }
                            }
                        } else if attr
                            .get("expression")
                            .map(|e| !e.is_null())
                            .unwrap_or(false)
                        {
                            visit_expr(attr.get("expression"), &next, by_prop, out);
                        }
                    }
                    if node.get("fragment").map(|f| !f.is_null()).unwrap_or(false) {
                        walk(node.get("fragment"), &next, by_prop, out);
                    }
                }
            }
        }
    }
    walk(
        ast.get("fragment"),
        &Vec::new(),
        &by_prop,
        &mut replacements,
    );
    Ok(apply_replacements(&source, &replacements))
}

fn collect_free_identifier_ranges(
    node: &Value,
    scopes: &Scopes,
    emit: &mut dyn FnMut(&str, usize, usize),
) {
    fn visit(
        n: &Value,
        local: &BTreeSet<String>,
        scopes: &Scopes,
        emit: &mut dyn FnMut(&str, usize, usize),
    ) {
        match n {
            Value::Array(items) => {
                for item in items {
                    visit(item, local, scopes, emit);
                }
            }
            Value::Object(obj) => match ty(n) {
                "Identifier" => {
                    let name = obj.get("name").and_then(|v| v.as_str()).unwrap_or("");
                    let bound = local.contains(name) || scopes.iter().any(|s| s.contains(name));
                    if !bound {
                        if let (Some(s), Some(e)) = (off(n, "start"), off(n, "end")) {
                            emit(name, s, e);
                        }
                    }
                }
                "MemberExpression" => {
                    if let Some(o) = obj.get("object") {
                        visit(o, local, scopes, emit);
                    }
                    if obj.get("computed").and_then(|v| v.as_bool()) == Some(true) {
                        if let Some(p) = obj.get("property") {
                            visit(p, local, scopes, emit);
                        }
                    }
                }
                "Property" => {
                    if obj.get("computed").and_then(|v| v.as_bool()) == Some(true) {
                        if let Some(k) = obj.get("key") {
                            visit(k, local, scopes, emit);
                        }
                    }
                    if let Some(v) = obj.get("value") {
                        visit(v, local, scopes, emit);
                    }
                }
                "ArrowFunctionExpression" | "FunctionExpression" => {
                    let mut inner = local.clone();
                    for param in arr(n, "params") {
                        collect_pattern_names(param, &mut inner);
                    }
                    if let Some(body) = obj.get("body") {
                        visit(body, &inner, scopes, emit);
                    }
                }
                _ => {
                    for (key, value) in obj {
                        if SKIP_KEYS.contains(&key.as_str()) {
                            continue;
                        }
                        visit(value, local, scopes, emit);
                    }
                }
            },
            _ => {}
        }
    }
    visit(node, &BTreeSet::new(), scopes, emit);
}

/// JS: buildPropsScriptV2(contract)
pub fn build_props_script_v2(contract: &[Value]) -> String {
    if contract.is_empty() {
        return "<script>\n  /** @typedef {Record<string, never>} Props */\n  let {} = $props();\n</script>\n".to_string();
    }
    let default_of = |kind: &str| match kind {
        "text" | "raw" => "''",
        "condition" => "false",
        "collection" => "[]",
        "handler" => "() => {}",
        _ => "''",
    };
    let type_of = |kind: &str| match kind {
        "text" | "raw" => "string",
        "condition" => "boolean",
        "collection" => "Array<Record<string, unknown>>",
        "handler" => "() => void",
        _ => "string",
    };
    let names = contract
        .iter()
        .map(|c| {
            let prop = c
                .get("prop")
                .and_then(|v| v.as_str())
                .unwrap_or("undefined");
            let kind = c.get("kind").and_then(|v| v.as_str()).unwrap_or("");
            format!("{} = {}", prop, default_of(kind))
        })
        .collect::<Vec<_>>()
        .join(", ");
    let type_fields = contract
        .iter()
        .map(|c| {
            let prop = c
                .get("prop")
                .and_then(|v| v.as_str())
                .unwrap_or("undefined");
            let kind = c.get("kind").and_then(|v| v.as_str()).unwrap_or("");
            format!("    {}?: {};", prop, type_of(kind))
        })
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "<script>\n  /** @typedef {{{{\n{}\n  }}}} Props */\n  let {{ {} }} = $props();\n</script>\n",
        type_fields, names
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prop_names() {
        assert_eq!(derive_prop_name("title"), "title");
        assert_eq!(derive_prop_name("data.stages"), "stages");
        assert_eq!(derive_prop_name("items[0]"), "value");
        assert_eq!(derive_prop_name("obj['class']"), "classValue");
        assert_eq!(derive_prop_name("fmt(x)"), "value");
        assert_eq!(derive_prop_name("a.b.c "), "c");
    }

    #[test]
    fn props_script() {
        let c: Vec<Value> =
            serde_json::from_str(r#"[{"prop":"title","expr":"title","kind":"text"}]"#).unwrap();
        assert_eq!(
            build_props_script_v2(&c),
            "<script>\n  /** @typedef {{\n    title?: string;\n  }} Props */\n  let { title = '' } = $props();\n</script>\n"
        );
    }
}
