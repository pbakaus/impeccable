//! JS: live-commit-manual-edits.mjs. Applies pending live copy edits as one
//! AI-owned batch, verifies the reported source changes, and clears only the
//! entries that verified.

use crate::copy_edit_agent::{run_copy_edit_batch_agent, run_copy_edit_post_apply_checks};
use crate::event_validation::truthy;
use crate::manual_edits::buffer::{
    count_by_page_value, read_buffer, read_buffer_strict, write_buffer, Buffer,
};
use crate::manual_edits::evidence::{
    arr, build_manual_edit_evidence_value, collapse_ws, count_ops, ins, js_string_or_empty,
    utf16_len,
};
use crate::manual_edits::is_generated_file;
use crate::util::{exists, jsp, Env};
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};

const ROLLBACK_EXTENSIONS: [&str; 23] = [
    ".astro", ".cjs", ".css", ".eex", ".ex", ".heex", ".htm", ".html", ".js", ".json", ".jsx",
    ".md", ".mdx", ".mjs", ".scss", ".svelte", ".svg", ".ts", ".tsx", ".txt", ".vue", ".yaml",
    ".yml",
];
const ROLLBACK_SKIP_DIRS: [&str; 11] = [
    ".astro",
    ".git",
    ".impeccable",
    ".next",
    ".nuxt",
    ".svelte-kit",
    "build",
    "coverage",
    "dist",
    "node_modules",
    "out",
];
const DEFAULT_REPAIR_ATTEMPTS: f64 = 3.0;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

pub struct CommitOptions<'a> {
    pub cwd: &'a str,
    pub env: &'a Env,
    pub page_url: Option<&'a str>,
    /// Explicit provider ("codex" | "claude" | "mock" | "chat"); None = choose
    /// via `copy_edit_agent::choose_copy_edit_agent`.
    pub provider: Option<&'a str>,
    pub timeout_ms: Option<f64>,
    /// chat provider callback: (batch, repair) -> raw result value.
    pub apply_batch_to_source:
        Option<&'a mut dyn FnMut(&Value, Option<&Value>) -> Result<Value, String>>,
    pub chat_available: Option<&'a dyn Fn() -> bool>,
    pub repair_only: bool,
    pub transaction_id: Option<&'a str>,
    pub batch: Option<&'a Value>,
}

/// JS: commitManualEdits(opts). `Err(message)` models a thrown error.
pub fn commit_manual_edits(opts: CommitOptions) -> Result<Value, String> {
    let page_url = match opts.page_url {
        Some(s) => Value::String(s.to_string()),
        None => Value::Null,
    };
    commit_manual_edits_value(opts, page_url)
}

/// The same, with the raw JS value for `pageUrl` (a bare `--page-url` flag
/// yields the boolean `true`). `opts.page_url` is ignored.
pub fn commit_manual_edits_value(opts: CommitOptions, page_url: Value) -> Result<Value, String> {
    let cwd = opts.cwd.to_string();
    let env = opts.env.clone();
    let mut agent = Agent {
        cwd: cwd.clone(),
        env: env.clone(),
        provider: opts.provider.map(String::from),
        timeout_ms: opts.timeout_ms,
        apply_batch_to_source: opts.apply_batch_to_source,
        chat_available: opts.chat_available,
    };
    let transaction_id = opts.transaction_id.map(String::from);
    run_commit(
        &cwd,
        &env,
        page_url,
        &mut agent,
        opts.repair_only,
        transaction_id.as_deref(),
        opts.batch,
    )
}

struct Agent<'a> {
    cwd: String,
    env: Env,
    provider: Option<String>,
    timeout_ms: Option<f64>,
    apply_batch_to_source:
        Option<&'a mut dyn FnMut(&Value, Option<&Value>) -> Result<Value, String>>,
    chat_available: Option<&'a dyn Fn() -> bool>,
}

impl Agent<'_> {
    fn run(&mut self, batch: &Value) -> Result<Value, String> {
        let cb = match self.apply_batch_to_source.as_mut() {
            Some(f) => {
                Some(&mut **f as &mut dyn FnMut(&Value, Option<&Value>) -> Result<Value, String>)
            }
            None => None,
        };
        run_copy_edit_batch_agent(
            batch,
            &self.cwd,
            &self.env,
            self.provider.as_deref(),
            self.timeout_ms,
            cb,
            self.chat_available,
        )
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn get_arr(v: &Value, key: &str) -> Vec<Value> {
    arr(v.get(key))
}

fn key_of(v: Option<&Value>) -> String {
    match v {
        None => "\u{0}undefined".to_string(),
        Some(v) => serde_json::to_string(v).unwrap_or_default(),
    }
}

fn str_of(v: Option<&Value>) -> Option<String> {
    match v {
        Some(Value::String(s)) => Some(s.clone()),
        _ => None,
    }
}

/// JS: uniqueStrings(values)
fn unique_strings(values: &[Value]) -> Vec<String> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut out = Vec::new();
    for v in values {
        if let Value::String(s) = v {
            if !impeccable_context::util::js_trim(s).is_empty() && seen.insert(s.clone()) {
                out.push(s.clone());
            }
        }
    }
    out
}

fn unique_str_list(values: &[String]) -> Vec<String> {
    let vals: Vec<Value> = values.iter().map(|s| json!(s)).collect();
    unique_strings(&vals)
}

fn to_values(v: &[String]) -> Vec<Value> {
    v.iter().map(|s| json!(s)).collect()
}

/// JS: summarizeAppliedEntries(entries, appliedEntryIds)
fn summarize_applied_entries(entries: &[Value], applied_entry_ids: &[Value]) -> Vec<Value> {
    let ids: HashSet<String> = applied_entry_ids.iter().map(|v| key_of(Some(v))).collect();
    let mut out = Vec::new();
    for entry in entries {
        if !ids.contains(&key_of(entry.get("id"))) {
            continue;
        }
        for op in get_arr(entry, "ops") {
            let mut m = Map::new();
            ins(&mut m, "id", entry.get("id").cloned());
            ins(&mut m, "ref", op.get("ref").cloned());
            ins(&mut m, "originalText", op.get("originalText").cloned());
            ins(&mut m, "newText", op.get("newText").cloned());
            out.push(Value::Object(m));
        }
    }
    out
}

/// JS: normalizeFailedEntries(batch, result, fallbackReason)
fn normalize_failed_entries(batch: &Value, result: &Value, fallback_reason: &str) -> Vec<Value> {
    let mut failed = Vec::new();
    let mut by_entry_id: HashMap<String, Value> = HashMap::new();
    for item in arr(result.get("failed")) {
        let entry_id = match item.get("entryId") {
            Some(v) if truthy(Some(v)) => Some(v.clone()),
            _ => match item.get("id") {
                Some(v) if truthy(Some(v)) => Some(v.clone()),
                _ => None,
            },
        };
        let Some(entry_id) = entry_id else { continue };
        by_entry_id.insert(key_of(Some(&entry_id)), item.clone());
    }

    for entry in get_arr(batch, "entries") {
        let Some(item) = by_entry_id.get(&key_of(entry.get("id"))) else {
            continue;
        };
        let reason = if truthy(item.get("reason")) {
            item.get("reason").cloned().unwrap()
        } else if truthy(item.get("message")) {
            item.get("message").cloned().unwrap()
        } else if !fallback_reason.is_empty() {
            json!(fallback_reason)
        } else {
            json!("failed")
        };
        let candidates = match item.get("candidates") {
            Some(Value::Array(a)) if !a.is_empty() => a.clone(),
            _ => candidates_for_entry(batch, entry.get("id")),
        };
        let mut m = Map::new();
        ins(&mut m, "id", entry.get("id").cloned());
        m.insert("reason".into(), reason);
        m.insert("candidates".into(), Value::Array(candidates));
        failed.push(Value::Object(m));
    }
    failed
}

/// JS: mergeFailedEntries(...groups)
fn merge_failed_entries(groups: &[&[Value]]) -> Vec<Value> {
    let mut out: Vec<Value> = Vec::new();
    let mut index_by_id: HashMap<String, usize> = HashMap::new();
    for group in groups {
        for item in group.iter() {
            if !item.is_object() {
                continue;
            }
            let id = match item.get("id") {
                Some(Value::String(s)) if !s.is_empty() => Some(s.clone()),
                _ => None,
            };
            let Some(id) = id else {
                out.push(item.clone());
                continue;
            };
            match index_by_id.get(&id) {
                None => {
                    index_by_id.insert(id, out.len());
                    out.push(item.clone());
                }
                Some(&existing_index) => {
                    let existing = out[existing_index].as_object().cloned().unwrap_or_default();
                    let mut merged = existing.clone();
                    if let Some(obj) = item.as_object() {
                        for (k, v) in obj {
                            merged.insert(k.clone(), v.clone());
                        }
                    }
                    for key in ["candidates", "checks"] {
                        let v = item
                            .get(key)
                            .cloned()
                            .or_else(|| existing.get(key).cloned());
                        match v {
                            Some(v) => {
                                merged.insert(key.to_string(), v);
                            }
                            None => {
                                merged.shift_remove(key);
                            }
                        }
                    }
                    out[existing_index] = Value::Object(merged);
                }
            }
        }
    }
    out
}

/// JS: candidatesForEntry(batch, entryId)
fn candidates_for_entry(batch: &Value, entry_id: Option<&Value>) -> Vec<Value> {
    let key = key_of(entry_id);
    let mut out = Vec::new();
    for candidate in get_arr(batch, "candidates") {
        if key_of(candidate.get("entryId")) != key {
            continue;
        }
        if truthy(candidate.get("sourceHint")) {
            out.push(candidate.get("sourceHint").cloned().unwrap());
        }
        for k in [
            "textMatches",
            "objectKeyMatches",
            "locatorMatches",
            "contextTextMatches",
        ] {
            out.extend(arr(candidate.get(k)));
        }
    }
    out.truncate(12);
    out
}

/// JS: allEntryIds(batch)
fn all_entry_ids(batch: &Value) -> Vec<Value> {
    get_arr(batch, "entries")
        .iter()
        .filter_map(|e| e.get("id").cloned())
        .filter(|v| truthy(Some(v)))
        .collect()
}

/// JS: repairAttemptLimit(env)
fn repair_attempt_limit(env: &Env) -> f64 {
    let raw = env
        .get("IMPECCABLE_LIVE_MANUAL_EDIT_REPAIR_ATTEMPTS")
        .cloned()
        .unwrap_or_default();
    let value = if raw.is_empty() {
        DEFAULT_REPAIR_ATTEMPTS
    } else {
        impeccable_core::js::string_to_number(&raw)
    };
    if !value.is_finite() {
        return DEFAULT_REPAIR_ATTEMPTS;
    }
    value.trunc().min(10.0).max(1.0)
}

fn slice_map<F: Fn(&Value) -> Value>(items: &[Value], limit: usize, f: F) -> Vec<Value> {
    items.iter().take(limit).map(f).collect()
}

fn candidate_summary(candidate: &Value) -> Value {
    let mut m = Map::new();
    ins(&mut m, "file", candidate.get("file").cloned());
    ins(&mut m, "line", candidate.get("line").cloned());
    ins(&mut m, "kind", candidate.get("kind").cloned());
    ins(&mut m, "reason", candidate.get("reason").cloned());
    Value::Object(m)
}

/// JS: summarizeRepairFailures(failures)
fn summarize_repair_failures(failures: &[Value]) -> Vec<Value> {
    failures
        .iter()
        .map(|failure| {
            let mut out = Map::new();
            let reason = if truthy(failure.get("reason")) {
                failure.get("reason").cloned().unwrap()
            } else if truthy(failure.get("detail")) {
                failure.get("detail").cloned().unwrap()
            } else {
                json!("validation_failed")
            };
            out.insert("reason".into(), reason);
            if truthy(failure.get("id")) || truthy(failure.get("entryId")) {
                let v = if truthy(failure.get("id")) {
                    failure.get("id").cloned().unwrap()
                } else {
                    failure.get("entryId").cloned().unwrap()
                };
                out.insert("entryId".into(), v);
            }
            if truthy(failure.get("ref")) {
                out.insert("ref".into(), failure.get("ref").cloned().unwrap());
            }
            if truthy(failure.get("detail")) {
                out.insert("detail".into(), failure.get("detail").cloned().unwrap());
            }
            if truthy(failure.get("file")) {
                out.insert("file".into(), failure.get("file").cloned().unwrap());
            }
            if truthy(failure.get("message")) {
                out.insert("message".into(), failure.get("message").cloned().unwrap());
            }
            if truthy(failure.get("marker")) {
                out.insert("marker".into(), failure.get("marker").cloned().unwrap());
            }
            if let Some(Value::Array(files)) = failure.get("files") {
                out.insert(
                    "files".into(),
                    Value::Array(files.iter().take(8).cloned().collect()),
                );
            }
            if let Some(Value::Array(candidates)) = failure.get("candidates") {
                out.insert(
                    "candidates".into(),
                    Value::Array(slice_map(candidates, 8, candidate_summary)),
                );
            }
            if let Some(Value::Array(items)) = failure.get("failures") {
                out.insert(
                    "failures".into(),
                    Value::Array(slice_map(items, 8, |item| {
                        let mut m = Map::new();
                        ins(&mut m, "ref", item.get("ref").cloned());
                        let reason = if truthy(item.get("reason")) {
                            item.get("reason").cloned()
                        } else {
                            item.get("detail").cloned()
                        };
                        ins(&mut m, "reason", reason);
                        ins(&mut m, "detail", item.get("detail").cloned());
                        if let Some(Value::Array(cs)) = item.get("candidates") {
                            m.insert(
                                "candidates".into(),
                                Value::Array(slice_map(cs, 6, candidate_summary)),
                            );
                        }
                        Value::Object(m)
                    })),
                );
            }
            if truthy(failure.get("checks")) {
                out.insert("checks".into(), failure.get("checks").cloned().unwrap());
            }
            Value::Object(out)
        })
        .take(20)
        .collect()
}

/// JS: buildRepairBatch(batch, repair)
fn build_repair_batch(batch: &Value, repair: Value) -> Value {
    let mut m = batch.as_object().cloned().unwrap_or_default();
    m.insert("repair".into(), repair);
    Value::Object(m)
}

/// JS: normalizeProjectSourcePath(cwd, file, opts)
fn normalize_project_source_path(
    cwd: &str,
    file: Option<&Value>,
    require_exists: bool,
) -> Option<String> {
    let file = match file {
        Some(Value::String(s)) if !s.is_empty() => s.clone(),
        _ => return None,
    };
    let absolute = if jsp::is_absolute(&file) {
        file.clone()
    } else {
        jsp::resolve(cwd, &[&file])
    };
    let relative = jsp::relative("/", cwd, &absolute);
    if relative.is_empty() || relative.starts_with("..") || jsp::is_absolute(&relative) {
        return None;
    }
    if require_exists && !exists(&absolute) {
        return None;
    }
    if is_generated_file(&absolute, cwd) {
        return None;
    }
    Some(relative)
}

fn normalize_relative_file(cwd: &str, file: Option<&Value>) -> Option<String> {
    normalize_project_source_path(cwd, file, true)
}

fn normalize_rollback_path(cwd: &str, file: &Value) -> Option<String> {
    normalize_project_source_path(cwd, Some(file), false)
}

fn read_lines(path: &str) -> Option<Vec<String>> {
    let bytes = std::fs::read(path).ok()?;
    let content = String::from_utf8_lossy(&bytes).into_owned();
    Some(content.split('\n').map(String::from).collect())
}

/// JS: sourceHintWindowFailure(cwd, op)
fn source_hint_window_failure(cwd: &str, op: &Value) -> Option<Value> {
    let hint = op.get("sourceHint");
    if !truthy(hint.and_then(|h| h.get("file"))) || !truthy(hint.and_then(|h| h.get("line"))) {
        return None;
    }
    let relative = normalize_relative_file(cwd, hint.and_then(|h| h.get("file")))?;
    let absolute = jsp::resolve(cwd, &[&relative]);
    let lines = read_lines(&absolute)?;
    let hint_line = crate::util::js_number(hint.and_then(|h| h.get("line"))).unwrap_or(0.0);
    let line = if hint_line == 0.0 || hint_line.is_nan() {
        1.0f64
    } else {
        hint_line
    }
    .max(1.0);
    let line_text = lines.get(line as usize - 1).cloned().unwrap_or_default();
    let original_text = str_of(op.get("originalText")).unwrap_or_default();
    if !original_text.is_empty()
        && line_text.contains(&original_text)
        && !line_shows_applied_op(&line_text, op)
    {
        return Some(json!({
            "file": relative,
            "line": crate::util::js_num(line),
            "reason": "source_hint_still_contains_original_text",
        }));
    }
    // JS-PARITY: live-commit-manual-edits.mjs#sourceHintWindowFailure ends with
    // two `return null` branches, so the window scan below cannot change the
    // result. Kept for shape, not effect.
    None
}

#[derive(Clone)]
struct Target {
    file: String,
    line: f64,
    kind: String,
    reported: bool,
}

impl Target {
    fn as_candidate(&self) -> Value {
        json!({ "file": self.file, "line": crate::util::js_num(self.line), "kind": self.kind })
    }
}

/// JS: verificationTargetsForOp(batch, op, reportedFiles, cwd)
fn verification_targets_for_op(
    batch: &Value,
    op: &Value,
    reported_files: &[String],
    cwd: &str,
) -> Vec<Target> {
    let op_entry_id = key_of(op.get("entryId"));
    let op_ref = key_of(op.get("ref"));
    let candidate = get_arr(batch, "candidates").into_iter().find(|item| {
        key_of(item.get("entryId")) == op_entry_id && key_of(item.get("ref")) == op_ref
    });
    let reported_set: HashSet<&String> = reported_files.iter().collect();
    let mut out: Vec<Target> = Vec::new();

    let add = |out: &mut Vec<Target>, file: Option<&Value>, line: Option<&Value>, kind: &str| {
        let Some(relative_file) = normalize_relative_file(cwd, file) else {
            return;
        };
        let Some(line_number) = crate::util::js_number(line) else {
            return;
        };
        if !line_number.is_finite() || line_number < 1.0 {
            return;
        }
        let reported = reported_set.contains(&relative_file);
        out.push(Target {
            file: relative_file,
            line: line_number,
            kind: kind.to_string(),
            reported,
        });
    };

    let source_hint = op.get("sourceHint");
    add(
        &mut out,
        source_hint.and_then(|h| h.get("file")),
        source_hint.and_then(|h| h.get("line")),
        "source_hint",
    );
    let cand_hint = candidate.as_ref().and_then(|c| c.get("sourceHint"));
    let cand_file = cand_hint
        .and_then(|h| h.get("relativeFile"))
        .filter(|v| truthy(Some(v)))
        .or_else(|| cand_hint.and_then(|h| h.get("file")));
    add(
        &mut out,
        cand_file,
        cand_hint.and_then(|h| h.get("line")),
        "candidate_source_hint",
    );
    for (key, kind) in [
        ("textMatches", "text_match"),
        ("objectKeyMatches", "object_key_match"),
        ("locatorMatches", "locator_match"),
        ("contextTextMatches", "context_text_match"),
    ] {
        for item in arr(candidate.as_ref().and_then(|c| c.get(key))) {
            add(&mut out, item.get("file"), item.get("line"), kind);
        }
    }

    for sibling in sibling_candidates_for_entry(batch, op) {
        let hint = sibling.get("sourceHint");
        let file = hint
            .and_then(|h| h.get("relativeFile"))
            .filter(|v| truthy(Some(v)))
            .or_else(|| hint.and_then(|h| h.get("file")));
        add(
            &mut out,
            file,
            hint.and_then(|h| h.get("line")),
            "entry_source_hint",
        );
        for (key, kind) in [
            ("textMatches", "entry_text_match"),
            ("objectKeyMatches", "entry_object_key_match"),
            ("contextTextMatches", "entry_context_text_match"),
        ] {
            for item in arr(sibling.get(key)) {
                add(&mut out, item.get("file"), item.get("line"), kind);
            }
        }
    }

    for relative_file in reported_files {
        for target in locator_targets_in_file(cwd, relative_file, op) {
            out.push(target);
        }
    }

    let mut seen: HashSet<String> = HashSet::new();
    out.into_iter()
        .filter(|t| {
            let key = format!(
                "{}:{}:{}",
                t.file,
                impeccable_context::util::js_number_to_string(t.line),
                t.kind
            );
            seen.insert(key)
        })
        .collect()
}

fn object_key_candidates_for_op(batch: &Value, op: &Value) -> Vec<Value> {
    let op_entry_id = key_of(op.get("entryId"));
    let op_ref = key_of(op.get("ref"));
    let mut out = Vec::new();
    for candidate in get_arr(batch, "candidates") {
        if key_of(candidate.get("entryId")) == op_entry_id && key_of(candidate.get("ref")) == op_ref
        {
            out.extend(arr(candidate.get("objectKeyMatches")));
        }
    }
    out
}

fn is_ws_comma_brace(c: char) -> bool {
    c.is_whitespace() || c == ',' || c == '{'
}

/// JS: lineHasObjectKey(line, text)
fn line_has_object_key(line: &str, text: Option<&Value>) -> bool {
    let text = match text {
        Some(Value::String(s)) if !s.is_empty() => s.clone(),
        _ => return false,
    };
    // `(^|[\s,{])(['"`])TEXT\2\s*:`
    let b = line.as_bytes();
    let mut i = 0usize;
    while i < b.len() {
        let q = b[i];
        if q == b'"' || q == b'\'' || q == b'`' {
            let prefix_ok = i == 0
                || line[..i]
                    .chars()
                    .next_back()
                    .map(is_ws_comma_brace)
                    .unwrap_or(false);
            if prefix_ok && line[i + 1..].starts_with(&text) {
                let after = i + 1 + text.len();
                if b.get(after) == Some(&q) {
                    let mut j = after + 1;
                    while j < b.len() && (b[j] as char).is_ascii_whitespace() {
                        j += 1;
                    }
                    if b.get(j) == Some(&b':') {
                        return true;
                    }
                }
            }
        }
        i += 1;
        while i < b.len() && !line.is_char_boundary(i) {
            i += 1;
        }
    }
    // Bare identifier key.
    let identifier_safe = {
        let mut cs = text.chars();
        match cs.next() {
            Some(c) if c.is_ascii_alphabetic() || c == '_' || c == '$' => {
                cs.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$')
            }
            _ => false,
        }
    };
    if !identifier_safe {
        return false;
    }
    let mut start = 0usize;
    while let Some(found) = line[start..].find(&text) {
        let at = start + found;
        let prefix_ok = at == 0
            || line[..at]
                .chars()
                .next_back()
                .map(is_ws_comma_brace)
                .unwrap_or(false);
        if prefix_ok {
            let mut j = at + text.len();
            while j < b.len() && (b[j] as char).is_ascii_whitespace() {
                j += 1;
            }
            if b.get(j) == Some(&b':') {
                return true;
            }
        }
        start = at + text.len().max(1);
        if start > line.len() {
            break;
        }
    }
    false
}

/// JS: objectKeyMatchStillUsesOriginal(cwd, match, op)
fn object_key_match_still_uses_original(cwd: &str, m: &Value, op: &Value) -> bool {
    let Some(relative) = normalize_relative_file(cwd, m.get("file")) else {
        return false;
    };
    let Some(line_number) = crate::util::js_number(m.get("line")) else {
        return false;
    };
    if !line_number.is_finite() || line_number < 1.0 {
        return false;
    }
    let Some(lines) = read_lines(&jsp::resolve(cwd, &[&relative])) else {
        return false;
    };
    let start = (line_number - 4.0).max(0.0) as usize;
    let end = (line_number + 3.0).min(lines.len() as f64).max(0.0) as usize;
    let window: &[String] = if start < end { &lines[start..end] } else { &[] };
    if window
        .iter()
        .any(|line| line_has_object_key(line, op.get("newText")))
    {
        return false;
    }
    window
        .iter()
        .any(|line| line_has_object_key(line, op.get("originalText")))
}

/// JS: coupledObjectKeyFailuresForOp(batch, op, cwd)
fn coupled_object_key_failures_for_op(batch: &Value, op: &Value, cwd: &str) -> Vec<Value> {
    let original = str_of(op.get("originalText"));
    let new_text = str_of(op.get("newText"));
    match (&original, &new_text) {
        (Some(a), Some(b)) if a != b => {}
        _ => return vec![],
    }
    object_key_candidates_for_op(batch, op)
        .into_iter()
        .filter(|m| object_key_match_still_uses_original(cwd, m, op))
        .map(|m| {
            let file = normalize_relative_file(cwd, m.get("file"))
                .map(Value::String)
                .filter(|v| truthy(Some(v)))
                .or_else(|| m.get("file").cloned())
                .unwrap_or(Value::Null);
            let mut candidate = Map::new();
            candidate.insert("file".into(), file);
            ins(&mut candidate, "line", m.get("line").cloned());
            candidate.insert("kind".into(), json!("object_key_match"));
            candidate.insert("reason".into(), json!("edited text is also a source key; update the coupled key to newText or fail the entry"));
            let mut out = Map::new();
            ins(&mut out, "ref", op.get("ref").cloned());
            out.insert("reason".into(), json!("source_verification_failed"));
            out.insert(
                "detail".into(),
                json!("edited_text_source_key_dependency_not_updated"),
            );
            out.insert(
                "candidates".into(),
                Value::Array(vec![Value::Object(candidate)]),
            );
            Value::Object(out)
        })
        .collect()
}

fn sibling_candidates_for_entry(batch: &Value, op: &Value) -> Vec<Value> {
    if !truthy(op.get("entryId")) {
        return vec![];
    }
    let op_entry_id = key_of(op.get("entryId"));
    let op_ref = key_of(op.get("ref"));
    get_arr(batch, "candidates")
        .into_iter()
        .filter(|item| {
            key_of(item.get("entryId")) == op_entry_id && key_of(item.get("ref")) != op_ref
        })
        .collect()
}

/// JS: locatorTargetsInFile(cwd, relativeFile, op)
fn locator_targets_in_file(cwd: &str, relative_file: &str, op: &Value) -> Vec<Target> {
    if !op_has_locator(op) {
        return vec![];
    }
    let Some(lines) = read_lines(&jsp::resolve(cwd, &[relative_file])) else {
        return vec![];
    };
    let mut out = Vec::new();
    for (index, line) in lines.iter().enumerate() {
        if !line_matches_manual_edit_locator(line, op) {
            continue;
        }
        out.push(Target {
            file: relative_file.to_string(),
            line: (index + 1) as f64,
            kind: "reported_locator_match".to_string(),
            reported: false,
        });
        if out.len() >= 20 {
            break;
        }
    }
    out
}

/// JS: verificationTargetPasses(cwd, target, op)
fn verification_target_passes(cwd: &str, target: &Target, op: &Value) -> bool {
    let Some(lines) = read_lines(&jsp::resolve(cwd, &[&target.file])) else {
        return false;
    };
    verification_target_passes_lines(&lines, target, op)
}

fn verification_target_passes_lines(lines: &[String], target: &Target, op: &Value) -> bool {
    let line = lines
        .get(target.line as usize - 1)
        .cloned()
        .unwrap_or_default();
    if line_shows_applied_op(&line, op) {
        return true;
    }
    let original_text = str_of(op.get("originalText")).unwrap_or_default();
    if !original_text.is_empty() && line.contains(&original_text) {
        return false;
    }
    let kind = &target.kind;
    let can_search_window = target.reported
        || kind.contains("context_text_match")
        || kind.contains("object_key_match")
        || kind.contains("text_match");
    if !can_search_window {
        return false;
    }
    let radius = if kind.contains("context_text_match") {
        20.0
    } else {
        4.0
    };
    let start = (target.line - radius - 1.0).max(0.0) as usize;
    let end = (target.line + radius).min(lines.len() as f64).max(0.0) as usize;
    let window: &[String] = if start < end { &lines[start..end] } else { &[] };
    if window.iter().any(|l| line_shows_applied_op(l, op)) {
        return true;
    }
    window_shows_applied_op(window, op)
}

fn window_shows_applied_op(lines: &[String], op: &Value) -> bool {
    let new_text = str_of(op.get("newText")).unwrap_or_default();
    if new_text.is_empty() {
        return false;
    }
    let original_text = str_of(op.get("originalText")).unwrap_or_default();
    let normalized_new = collapse_ws(&new_text);
    let normalized_original = collapse_ws(&original_text);
    let normalized_window = collapse_ws(&lines.join("\n"));
    if normalized_new.is_empty() || !normalized_window.contains(&normalized_new) {
        return false;
    }
    if !normalized_original.is_empty()
        && !normalized_new.contains(&normalized_original)
        && normalized_window.contains(&normalized_original)
    {
        return false;
    }
    true
}

/// JS: lineShowsAppliedOp(line, op)
fn line_shows_applied_op(line: &str, op: &Value) -> bool {
    let original_text = str_of(op.get("originalText")).unwrap_or_default();
    let new_text = str_of(op.get("newText")).unwrap_or_default();
    let deletion = op.get("deleted") == Some(&Value::Bool(true)) || new_text.is_empty();
    if deletion {
        return !original_text.is_empty() && !line.contains(&original_text);
    }
    if !line.contains(&new_text) {
        return false;
    }
    if !original_text.is_empty()
        && !new_text.contains(&original_text)
        && line.contains(&original_text)
    {
        return false;
    }
    true
}

fn op_has_locator(op: &Value) -> bool {
    truthy(op.get("tag"))
        || truthy(op.get("elementId"))
        || arr(op.get("classes"))
            .iter()
            .filter(|c| truthy(Some(c)))
            .count()
            > 0
}

/// JS: lineMatchesManualEditLocator(line, op)
fn line_matches_manual_edit_locator(line: &str, op: &Value) -> bool {
    if truthy(op.get("tag")) {
        let tag = js_string_or_empty(op.get("tag"));
        if !matches_tag(line, &tag) {
            return false;
        }
    }
    if truthy(op.get("elementId")) {
        let id = js_string_or_empty(op.get("elementId"));
        if !matches_id_attr(line, &id) {
            return false;
        }
    }
    for class_name in arr(op.get("classes")) {
        if !truthy(Some(&class_name)) {
            continue;
        }
        if !line.contains(&js_string_or_empty(Some(&class_name))) {
            return false;
        }
    }
    true
}

/// `<\s*TAG(?=[\s>/]|$)` case-insensitive.
fn matches_tag(line: &str, tag: &str) -> bool {
    let lower_line = line.to_lowercase();
    let lower_tag = tag.to_lowercase();
    let b = lower_line.as_bytes();
    let mut i = 0usize;
    while let Some(found) = lower_line[i..].find('<') {
        let at = i + found;
        let mut j = at + 1;
        while j < b.len() && (b[j] as char).is_ascii_whitespace() {
            j += 1;
        }
        if lower_line[j..].starts_with(&lower_tag) {
            let after = j + lower_tag.len();
            let next = lower_line[after..].chars().next();
            match next {
                None => return true,
                Some(c) if c.is_whitespace() || c == '>' || c == '/' => return true,
                _ => {}
            }
        }
        i = at + 1;
        if i > lower_line.len() {
            break;
        }
    }
    false
}

/// `\bid\s*=\s*["']ID["']`
fn matches_id_attr(line: &str, id: &str) -> bool {
    let b = line.as_bytes();
    let mut i = 0usize;
    while let Some(found) = line[i..].find("id") {
        let at = i + found;
        let word_before = at > 0
            && line[..at]
                .chars()
                .next_back()
                .map(|c| c.is_alphanumeric() || c == '_')
                .unwrap_or(false);
        if !word_before {
            let mut j = at + 2;
            while j < b.len() && (b[j] as char).is_ascii_whitespace() {
                j += 1;
            }
            if b.get(j) == Some(&b'=') {
                j += 1;
                while j < b.len() && (b[j] as char).is_ascii_whitespace() {
                    j += 1;
                }
                if matches!(b.get(j), Some(b'"') | Some(b'\'')) && line[j + 1..].starts_with(id) {
                    let after = j + 1 + id.len();
                    if matches!(b.get(after), Some(b'"') | Some(b'\'')) {
                        return true;
                    }
                }
            }
        }
        i = at + 1;
        if i > line.len() {
            break;
        }
    }
    false
}

/// JS: verifyAppliedEntry({ batch, entry, reportedFiles, cwd })
fn verify_applied_entry(
    batch: &Value,
    entry: &Value,
    reported_files: &[String],
    cwd: &str,
) -> Vec<Value> {
    let mut failures = Vec::new();
    for raw_op in get_arr(entry, "ops") {
        let mut op_map = raw_op.as_object().cloned().unwrap_or_default();
        op_map.insert(
            "entryId".into(),
            entry.get("id").cloned().unwrap_or(Value::Null),
        );
        if op_map.get("deleted") == Some(&Value::Bool(true))
            && !matches!(op_map.get("newText"), Some(Value::String(_)))
        {
            op_map.insert("newText".into(), json!(""));
        }
        let op = Value::Object(op_map);
        if !matches!(op.get("newText"), Some(Value::String(_))) {
            let mut m = Map::new();
            ins(&mut m, "ref", op.get("ref").cloned());
            m.insert("reason".into(), json!("source_verification_failed"));
            m.insert("detail".into(), json!("missing_newText"));
            let mut cands = candidates_for_entry(batch, entry.get("id"));
            cands.truncate(12);
            m.insert("candidates".into(), Value::Array(cands));
            failures.push(Value::Object(m));
            continue;
        }
        let targets = verification_targets_for_op(batch, &op, reported_files, cwd);
        let coupled = coupled_object_key_failures_for_op(batch, &op, cwd);
        if coupled.is_empty()
            && targets
                .iter()
                .any(|t| verification_target_passes(cwd, t, &op))
        {
            continue;
        }

        if !coupled.is_empty() {
            for failure in coupled {
                let mut m = failure.as_object().cloned().unwrap_or_default();
                let mut cands = arr(failure.get("candidates"));
                cands.extend(targets.iter().map(|t| t.as_candidate()));
                cands.extend(candidates_for_entry(batch, entry.get("id")));
                cands.truncate(12);
                m.insert("candidates".into(), Value::Array(cands));
                failures.push(Value::Object(m));
            }
            continue;
        }

        if let Some(hinted) = source_hint_window_failure(cwd, &op) {
            let mut cands = vec![hinted.clone()];
            cands.extend(targets.iter().map(|t| t.as_candidate()));
            cands.extend(candidates_for_entry(batch, entry.get("id")));
            cands.truncate(12);
            let mut m = Map::new();
            ins(&mut m, "ref", op.get("ref").cloned());
            m.insert("reason".into(), json!("source_verification_failed"));
            ins(&mut m, "detail", hinted.get("reason").cloned());
            m.insert("candidates".into(), Value::Array(cands));
            failures.push(Value::Object(m));
            continue;
        }

        let new_text = str_of(op.get("newText")).unwrap_or_default();
        let mut cands: Vec<Value> = targets.iter().map(|t| t.as_candidate()).collect();
        cands.extend(candidates_for_entry(batch, entry.get("id")));
        cands.truncate(12);
        let mut m = Map::new();
        ins(&mut m, "ref", op.get("ref").cloned());
        m.insert("reason".into(), json!("source_verification_failed"));
        m.insert(
            "detail".into(),
            json!(if utf16_len(&new_text) == 0 {
                "originalText_still_present_in_plausible_source_location"
            } else {
                "newText_not_found_in_plausible_source_location"
            }),
        );
        m.insert("candidates".into(), Value::Array(cands));
        failures.push(Value::Object(m));
    }
    failures
}

fn snapshot_target_passes(snapshot: &Map<String, Value>, target: &Target, op: &Value) -> bool {
    let before = snapshot.get(&target.file).and_then(|s| s.get("content"));
    let Some(Value::String(content)) = before else {
        return false;
    };
    let lines: Vec<String> = content.split('\n').map(String::from).collect();
    verification_target_passes_lines(&lines, target, op)
}

/// JS: findUnappliedEntrySourceChanges(...)
fn find_unapplied_entry_source_changes(
    batch: &Value,
    entries: &[Value],
    reported_files: &[String],
    cwd: &str,
    rollback_snapshot: &Map<String, Value>,
) -> Vec<Value> {
    let mut failures = Vec::new();
    for entry in entries {
        for raw_op in get_arr(entry, "ops") {
            let mut op_map = raw_op.as_object().cloned().unwrap_or_default();
            op_map.insert(
                "entryId".into(),
                entry.get("id").cloned().unwrap_or(Value::Null),
            );
            let op = Value::Object(op_map);
            let new_text = match op.get("newText") {
                Some(Value::String(s)) if !s.is_empty() => s.clone(),
                _ => continue,
            };
            let targets = verification_targets_for_op(batch, &op, reported_files, cwd);
            let leaked: Vec<&Target> = targets
                .iter()
                .filter(|t| {
                    verification_target_passes(cwd, t, &op)
                        && !snapshot_target_passes(rollback_snapshot, t, &op)
                })
                .collect();
            if leaked.is_empty() {
                continue;
            }
            let mut cands: Vec<Value> = leaked.iter().map(|t| t.as_candidate()).collect();
            cands.extend(candidates_for_entry(batch, entry.get("id")));
            cands.truncate(12);
            let mut m = Map::new();
            ins(&mut m, "id", entry.get("id").cloned());
            m.insert("reason".into(), json!("failed_entry_source_changed"));
            ins(&mut m, "ref", op.get("ref").cloned());
            m.insert("newText".into(), json!(new_text));
            m.insert("candidates".into(), Value::Array(cands));
            failures.push(Value::Object(m));
            break;
        }
    }
    failures
}

/// JS: verificationFailuresForEntries(batch, entries, reason, extra)
fn verification_failures_for_entries(
    batch: &Value,
    entries: &[Value],
    reason: &str,
    extra: &[(&str, Value)],
) -> Vec<Value> {
    entries
        .iter()
        .map(|entry| {
            let mut m = Map::new();
            ins(&mut m, "id", entry.get("id").cloned());
            m.insert("reason".into(), json!(reason));
            m.insert(
                "candidates".into(),
                Value::Array(candidates_for_entry(batch, entry.get("id"))),
            );
            for (k, v) in extra {
                m.insert(k.to_string(), v.clone());
            }
            Value::Object(m)
        })
        .collect()
}

/// JS: clearAppliedEntries(cwd, appliedEntryIds)
fn clear_applied_entries(cwd: &str, env: &Env, applied_entry_ids: &[Value]) -> usize {
    let ids: HashSet<String> = applied_entry_ids.iter().map(|v| key_of(Some(v))).collect();
    if ids.is_empty() {
        return 0;
    }
    let buffer = read_buffer(cwd, env);
    let mut cleared = 0usize;
    let mut kept = Vec::new();
    for entry in buffer.entries {
        if ids.contains(&key_of(entry.get("id"))) {
            cleared += arr(entry.get("ops")).len();
        } else {
            kept.push(entry);
        }
    }
    let _ = write_buffer(cwd, env, &Buffer { entries: kept });
    cleared
}

/// JS: snapshotRollbackFiles(cwd, files)
fn snapshot_rollback_files(cwd: &str, files: Option<&[String]>) -> Map<String, Value> {
    let mut snapshot = Map::new();
    let rollback_files: Vec<String> = match files {
        Some(f) if !f.is_empty() => unique_str_list(f)
            .iter()
            .filter_map(|file| normalize_rollback_path(cwd, &json!(file)))
            .collect(),
        _ => collect_rollback_files(cwd),
    };
    for relative_file in rollback_files {
        let absolute = jsp::resolve(cwd, &[&relative_file]);
        match std::fs::read(&absolute) {
            Ok(b) => {
                snapshot.insert(
                    relative_file,
                    json!({ "existed": true, "content": String::from_utf8_lossy(&b) }),
                );
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                snapshot.insert(relative_file, json!({ "existed": false }));
            }
            Err(_) => {}
        }
    }
    snapshot
}

fn collect_rollback_files(cwd: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut seen_dirs: HashSet<String> = HashSet::new();
    let mut seen_files: HashSet<String> = HashSet::new();
    scan_rollback_dir(cwd, cwd, &mut out, &mut seen_dirs, &mut seen_files, 0);
    out
}

fn scan_rollback_dir(
    dir: &str,
    cwd: &str,
    out: &mut Vec<String>,
    seen_dirs: &mut HashSet<String>,
    seen_files: &mut HashSet<String>,
    depth: usize,
) {
    if depth > 10 {
        return;
    }
    let Ok(real_dir) = std::fs::canonicalize(dir) else {
        return;
    };
    if !seen_dirs.insert(real_dir.to_string_lossy().into_owned()) {
        return;
    }
    let Some(entries) = crate::util::read_dir_raw(dir) else {
        return;
    };
    for entry in entries {
        if entry.is_dir {
            if ROLLBACK_SKIP_DIRS.contains(&entry.name.as_str()) {
                continue;
            }
            scan_rollback_dir(
                &jsp::join(&[dir, &entry.name]),
                cwd,
                out,
                seen_dirs,
                seen_files,
                depth + 1,
            );
            continue;
        }
        if !entry.is_file {
            continue;
        }
        let ext = jsp::extname(&entry.name).to_lowercase();
        if !ROLLBACK_EXTENSIONS.contains(&ext.as_str()) {
            continue;
        }
        let absolute = jsp::join(&[dir, &entry.name]);
        if is_generated_file(&absolute, cwd) {
            continue;
        }
        let Ok(real_file) = std::fs::canonicalize(&absolute) else {
            continue;
        };
        if !seen_files.insert(real_file.to_string_lossy().into_owned()) {
            continue;
        }
        let relative = jsp::relative("/", cwd, &absolute);
        if relative.is_empty() || relative.starts_with("..") || jsp::is_absolute(&relative) {
            continue;
        }
        out.push(relative);
    }
}

/// JS: changedFilesSinceSnapshot(cwd, snapshot, scopeFiles)
fn changed_files_since_snapshot(
    cwd: &str,
    snapshot: &Map<String, Value>,
    scope_files: Option<&[String]>,
) -> Vec<Value> {
    let mut changed: Map<String, Value> = Map::new();
    let scoped_files: Option<Vec<String>> = match scope_files {
        Some(f) if !f.is_empty() => Some(
            f.iter()
                .filter_map(|file| normalize_rollback_path(cwd, &json!(file)))
                .collect(),
        ),
        _ => None,
    };
    let current_files: Vec<String> = match &scoped_files {
        Some(f) => f.clone(),
        None => collect_rollback_files(cwd),
    };
    let current_set: HashSet<&String> = current_files.iter().collect();
    for (relative_file, before) in snapshot.iter() {
        if scoped_files.is_some() && !current_set.contains(relative_file) {
            continue;
        }
        let absolute = jsp::resolve(cwd, &[relative_file]);
        if before.get("existed") == Some(&Value::Bool(false)) {
            if exists(&absolute) {
                changed.insert(
                    relative_file.clone(),
                    json!({ "file": relative_file, "kind": "added" }),
                );
            }
            continue;
        }
        if !exists(&absolute) {
            changed.insert(
                relative_file.clone(),
                json!({ "file": relative_file, "kind": "deleted" }),
            );
            continue;
        }
        let Ok(bytes) = std::fs::read(&absolute) else {
            continue;
        };
        let content = String::from_utf8_lossy(&bytes).into_owned();
        if before.get("content") != Some(&Value::String(content)) {
            changed.insert(
                relative_file.clone(),
                json!({ "file": relative_file, "kind": "modified" }),
            );
        }
    }
    let mut seen_current: HashSet<&String> = HashSet::new();
    for relative_file in current_files.iter() {
        if !seen_current.insert(relative_file) {
            continue;
        }
        if !snapshot.contains_key(relative_file) {
            changed.insert(
                relative_file.clone(),
                json!({ "file": relative_file, "kind": "unknown" }),
            );
        }
    }
    changed.values().cloned().collect()
}

/// JS: rollbackChangedFiles(cwd, snapshot, extraFiles, scopeFiles)
fn rollback_changed_files(
    cwd: &str,
    snapshot: &Map<String, Value>,
    extra_files: &[Value],
    scope_files: &[String],
) -> (Vec<String>, Vec<Value>) {
    let mut scope: Vec<String> = Vec::new();
    let mut scope_set: HashSet<String> = HashSet::new();
    for file in scope_files
        .iter()
        .map(|s| json!(s))
        .chain(extra_files.iter().cloned())
    {
        if let Some(rel) = normalize_rollback_path(cwd, &file) {
            if scope_set.insert(rel.clone()) {
                scope.push(rel);
            }
        }
    }
    let changed = changed_files_since_snapshot(cwd, snapshot, Some(&scope));
    let mut by_file: Map<String, Value> = Map::new();
    for item in changed {
        let key = js_string_or_empty(item.get("file"));
        by_file.insert(key, item);
    }
    for file in extra_files {
        if let Some(relative) = normalize_rollback_path(cwd, file) {
            if !by_file.contains_key(&relative) {
                let kind = if snapshot.contains_key(&relative) {
                    "reported"
                } else {
                    "unknown"
                };
                by_file.insert(relative.clone(), json!({ "file": relative, "kind": kind }));
            }
        }
    }

    let mut rolled_back_files = Vec::new();
    let mut rollback_failures = Vec::new();
    for item in by_file.values() {
        let file = js_string_or_empty(item.get("file"));
        if !scope_set.contains(&file) {
            continue;
        }
        let absolute = jsp::resolve(cwd, &[&file]);
        let before = snapshot.get(&file);
        let existed_false = before.and_then(|b| b.get("existed")) == Some(&Value::Bool(false));
        let content = before
            .and_then(|b| b.get("content"))
            .and_then(|c| c.as_str());
        if !existed_false && content.is_some() {
            let content = content.unwrap();
            if let Some(parent) = std::path::Path::new(&absolute).parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            match std::fs::write(&absolute, content) {
                Ok(()) => rolled_back_files.push(file),
                Err(e) => rollback_failures.push(
                    json!({ "file": file, "reason": "restore_failed", "message": e.to_string() }),
                ),
            }
            continue;
        }
        if existed_false
            && item.get("kind") == Some(&Value::String("added".into()))
            && exists(&absolute)
        {
            match std::fs::remove_file(&absolute) {
                Ok(()) => rolled_back_files.push(file),
                Err(e) => rollback_failures.push(
                    json!({ "file": file, "reason": "restore_failed", "message": e.to_string() }),
                ),
            }
            continue;
        }
        rollback_failures.push(json!({ "file": file, "reason": "no_snapshot" }));
    }
    (rolled_back_files, rollback_failures)
}

/// JS: collectApplyOwnedFiles(batch, cwd, extraFiles)
fn collect_apply_owned_files(batch: &Value, cwd: &str, extra_files: &[Value]) -> Vec<String> {
    let mut files: Vec<Value> = Vec::new();
    for entry in get_arr(batch, "entries") {
        for op in get_arr(&entry, "ops") {
            if let Some(v) = op.get("sourceHint").and_then(|h| h.get("file")) {
                files.push(v.clone());
            }
        }
    }
    for candidate in get_arr(batch, "candidates") {
        let hint = candidate.get("sourceHint");
        if let Some(v) = hint.and_then(|h| h.get("relativeFile")) {
            files.push(v.clone());
        }
        if let Some(v) = hint.and_then(|h| h.get("file")) {
            files.push(v.clone());
        }
        for key in [
            "textMatches",
            "objectKeyMatches",
            "locatorMatches",
            "contextTextMatches",
        ] {
            for item in arr(candidate.get(key)) {
                if let Some(v) = item.get("file") {
                    files.push(v.clone());
                }
            }
        }
    }
    files.extend(extra_files.iter().cloned());
    unique_strings(&files)
        .iter()
        .filter_map(|file| normalize_rollback_path(cwd, &json!(file)))
        .collect()
}

/// JS: unreportedChangedFiles(cwd, snapshot, reportedFiles, scopeFiles)
fn unreported_changed_files(
    cwd: &str,
    snapshot: &Map<String, Value>,
    reported_files: &[Value],
    scope_files: &[String],
) -> Vec<String> {
    let reported: HashSet<String> = reported_files
        .iter()
        .filter_map(|f| normalize_rollback_path(cwd, f))
        .collect();
    let mut scope: Vec<String> = Vec::new();
    let mut scope_set: HashSet<String> = HashSet::new();
    for file in scope_files {
        if let Some(rel) = normalize_rollback_path(cwd, &json!(file)) {
            if scope_set.insert(rel.clone()) {
                scope.push(rel);
            }
        }
    }
    changed_files_since_snapshot(cwd, snapshot, Some(&scope))
        .iter()
        .map(|item| js_string_or_empty(item.get("file")))
        .filter(|file| scope_set.contains(file))
        .filter(|file| !reported.contains(file))
        .collect()
}

struct VerifyAfterRepair {
    verified_ids: Vec<Value>,
    failed: Vec<Value>,
}

/// JS: verifyEntriesAfterRepair({ batch, appliedEntryIds, files, cwd })
fn verify_entries_after_repair(
    batch: &Value,
    applied_entry_ids: &[String],
    files: &[String],
    cwd: &str,
) -> VerifyAfterRepair {
    let reported_files: Vec<String> = unique_str_list(files)
        .iter()
        .filter_map(|file| normalize_relative_file(cwd, Some(&json!(file))))
        .collect();
    let applied: HashSet<&String> = applied_entry_ids.iter().collect();
    let entries: Vec<Value> = get_arr(batch, "entries")
        .into_iter()
        .filter(|entry| match entry.get("id") {
            Some(Value::String(s)) => applied.contains(&s),
            _ => false,
        })
        .collect();
    let mut verified_ids = Vec::new();
    let mut failed = Vec::new();
    for entry in entries {
        let failures = verify_applied_entry(batch, &entry, &reported_files, cwd);
        if failures.is_empty() {
            if let Some(id) = entry.get("id") {
                verified_ids.push(id.clone());
            }
        } else {
            let mut m = Map::new();
            ins(&mut m, "id", entry.get("id").cloned());
            m.insert("reason".into(), json!("source_verification_failed"));
            m.insert("failures".into(), Value::Array(failures));
            m.insert(
                "candidates".into(),
                Value::Array(candidates_for_entry(batch, entry.get("id"))),
            );
            failed.push(Value::Object(m));
        }
    }
    VerifyAfterRepair {
        verified_ids,
        failed,
    }
}

// ---------------------------------------------------------------------------
// Repair loop
// ---------------------------------------------------------------------------

#[allow(clippy::too_many_arguments)]
struct RepairArgs<'a> {
    batch: &'a Value,
    cwd: &'a str,
    env: &'a Env,
    page_url: &'a Value,
    count: usize,
    transaction_id: Option<&'a str>,
    applied_entry_ids: Vec<String>,
    files: Vec<String>,
    failed: Vec<Value>,
    notes: Vec<Value>,
    warnings: Vec<Value>,
    repair_reason: &'a str,
    repair_failures: Vec<Value>,
}

fn repair_post_apply_validation(args: RepairArgs, agent: &mut Agent) -> Value {
    let RepairArgs {
        batch,
        cwd,
        env,
        page_url,
        count,
        transaction_id,
        applied_entry_ids,
        files,
        failed,
        notes,
        warnings,
        repair_reason,
        repair_failures,
    } = args;
    let max_attempts = repair_attempt_limit(env);
    let mut current_files = unique_str_list(&files);
    let mut current_applied_ids = unique_str_list(&applied_entry_ids);
    let mut current_failed = failed;
    let mut current_notes = notes;
    let mut current_warnings = warnings;
    let mut current_failures = repair_failures;

    let mut attempt = 1.0f64;
    while attempt <= max_attempts {
        let mut repair = Map::new();
        repair.insert("attempt".into(), crate::util::js_num(attempt));
        repair.insert("maxAttempts".into(), crate::util::js_num(max_attempts));
        repair.insert(
            "transactionId".into(),
            match transaction_id {
                Some(t) if !t.is_empty() => json!(t),
                _ => Value::Null,
            },
        );
        repair.insert("reason".into(), json!(repair_reason));
        repair.insert(
            "failures".into(),
            Value::Array(summarize_repair_failures(&current_failures)),
        );
        repair.insert("files".into(), Value::Array(to_values(&current_files)));
        repair.insert("pageUrl".into(), page_url.clone());

        let repair_result = match agent.run(&build_repair_batch(batch, Value::Object(repair))) {
            Ok(v) => v,
            Err(message) => {
                current_failures = vec![json!({
                    "reason": "repair_agent_failed",
                    "message": message,
                })];
                attempt += 1.0;
                continue;
            }
        };

        let mut merged_files = to_values(&current_files);
        merged_files.extend(arr(repair_result.get("files")));
        current_files = unique_strings(&merged_files);
        current_notes.extend(arr(repair_result.get("notes")));
        current_warnings.extend(arr(repair_result.get("warnings")));
        let mut merged_ids = to_values(&current_applied_ids);
        merged_ids.extend(arr(repair_result.get("appliedEntryIds")));
        current_applied_ids = unique_strings(&merged_ids);
        let repair_failed = normalize_failed_entries(batch, &repair_result, "repair_failed");
        current_failed = merge_failed_entries(&[&current_failed, &repair_failed]);

        let verified =
            verify_entries_after_repair(batch, &current_applied_ids, &current_files, cwd);
        if !verified.failed.is_empty() {
            current_failures = verified.failed;
            attempt += 1.0;
            continue;
        }

        let repaired_checks = run_copy_edit_post_apply_checks(cwd, &current_files);
        current_warnings.extend(arr(repaired_checks.get("warnings")));
        if repaired_checks.get("ok") != Some(&Value::Bool(true)) {
            current_failures = arr(repaired_checks.get("failures"));
            attempt += 1.0;
            continue;
        }

        let cleared = clear_applied_entries(cwd, env, &verified.verified_ids);
        let counts = count_by_page_value(cwd, env);
        let verified_id_set: HashSet<String> = verified
            .verified_ids
            .iter()
            .map(|v| key_of(Some(v)))
            .collect();
        let merged = merge_failed_entries(&[&current_failed]);
        let final_failed: Vec<Value> = merged
            .into_iter()
            .filter(|item| !verified_id_set.contains(&key_of(item.get("id"))))
            .collect();
        let mut m = Map::new();
        m.insert(
            "applied".into(),
            Value::Array(summarize_applied_entries(
                &get_arr(batch, "entries"),
                &verified.verified_ids,
            )),
        );
        m.insert("failed".into(), Value::Array(final_failed));
        m.insert("files".into(), Value::Array(to_values(&current_files)));
        m.insert("cleared".into(), json!(cleared));
        m.insert("count".into(), json!(count));
        m.insert("pageUrl".into(), page_url.clone());
        m.insert("warnings".into(), Value::Array(current_warnings));
        m.insert("notes".into(), Value::Array(current_notes));
        m.insert(
            "repair".into(),
            json!({
                "status": "repaired",
                "attempts": crate::util::js_num(attempt),
                "maxAttempts": crate::util::js_num(max_attempts),
                "transactionId": match transaction_id { Some(t) if !t.is_empty() => json!(t), _ => Value::Null },
            }),
        );
        for (k, v) in counts {
            m.insert(k, v);
        }
        return Value::Object(m);
    }

    let decision_failed_entries: Vec<Value> = if !current_applied_ids.is_empty() {
        let applied: HashSet<&String> = current_applied_ids.iter().collect();
        get_arr(batch, "entries")
            .into_iter()
            .filter(|entry| match entry.get("id") {
                Some(Value::String(s)) => applied.contains(&s),
                _ => false,
            })
            .map(|entry| {
                let mut m = Map::new();
                ins(&mut m, "id", entry.get("id").cloned());
                m.insert("reason".into(), json!(repair_reason));
                m.insert("checks".into(), Value::Array(current_failures.clone()));
                m.insert(
                    "candidates".into(),
                    Value::Array(candidates_for_entry(batch, entry.get("id"))),
                );
                Value::Object(m)
            })
            .collect()
    } else {
        verification_failures_for_entries(
            batch,
            &get_arr(batch, "entries"),
            repair_reason,
            &[("checks", Value::Array(current_failures.clone()))],
        )
    };

    let mut m = Map::new();
    m.insert("applied".into(), json!([]));
    m.insert(
        "failed".into(),
        Value::Array(merge_failed_entries(&[
            &decision_failed_entries,
            &current_failed,
        ])),
    );
    m.insert("files".into(), Value::Array(to_values(&current_files)));
    m.insert("cleared".into(), json!(0));
    m.insert("count".into(), json!(count));
    m.insert("pageUrl".into(), page_url.clone());
    m.insert("warnings".into(), Value::Array(current_warnings));
    m.insert("notes".into(), Value::Array(current_notes));
    m.insert("reason".into(), json!("manual_edit_repair_needs_decision"));
    m.insert("needsManualDecision".into(), Value::Bool(true));
    let mut repair = Map::new();
    repair.insert("status".into(), json!("needs_decision"));
    repair.insert("attempts".into(), crate::util::js_num(max_attempts));
    repair.insert("maxAttempts".into(), crate::util::js_num(max_attempts));
    repair.insert(
        "transactionId".into(),
        match transaction_id {
            Some(t) if !t.is_empty() => json!(t),
            _ => Value::Null,
        },
    );
    repair.insert(
        "failures".into(),
        Value::Array(summarize_repair_failures(&current_failures)),
    );
    repair.insert("files".into(), Value::Array(to_values(&current_files)));
    m.insert("repair".into(), Value::Object(repair));
    for (k, v) in count_by_page_value(cwd, env) {
        m.insert(k, v);
    }
    Value::Object(m)
}

// ---------------------------------------------------------------------------
// commitManualEdits
// ---------------------------------------------------------------------------

fn base_result(
    applied: Vec<Value>,
    failed: Vec<Value>,
    files: Vec<Value>,
    cleared: usize,
    count: usize,
    page_url: &Value,
) -> Map<String, Value> {
    let mut m = Map::new();
    m.insert("applied".into(), Value::Array(applied));
    m.insert("failed".into(), Value::Array(failed));
    m.insert("files".into(), Value::Array(files));
    m.insert("cleared".into(), json!(cleared));
    m.insert("count".into(), json!(count));
    m.insert("pageUrl".into(), page_url.clone());
    m
}

fn run_commit(
    cwd: &str,
    env: &Env,
    page_url: Value,
    agent: &mut Agent,
    repair_only: bool,
    transaction_id: Option<&str>,
    provided_batch: Option<&Value>,
) -> Result<Value, String> {
    if let Err(message) = read_buffer_strict(cwd, env) {
        let mut m = base_result(vec![], vec![], vec![], 0, 0, &page_url);
        m.insert("reason".into(), json!("manual_edit_buffer_invalid"));
        m.insert("message".into(), json!(message));
        for (k, v) in count_by_page_value(cwd, env) {
            m.insert(k, v);
        }
        return Ok(Value::Object(m));
    }

    let batch = match provided_batch {
        Some(b) if truthy(Some(b)) => b.clone(),
        _ => build_manual_edit_evidence_value(cwd, env, &page_url),
    };
    let count = count_ops(&get_arr(&batch, "entries"));
    if count == 0 {
        let mut m = base_result(vec![], vec![], vec![], 0, 0, &page_url);
        m.insert("reason".into(), json!("no_pending_edits"));
        for (k, v) in count_by_page_value(cwd, env) {
            m.insert(k, v);
        }
        return Ok(Value::Object(m));
    }

    let base_rollback_scope = collect_apply_owned_files(&batch, cwd, &[]);
    let rollback_snapshot = snapshot_rollback_files(cwd, Some(&base_rollback_scope));

    let result = if repair_only {
        let mut m = Map::new();
        m.insert("status".into(), json!("done"));
        m.insert(
            "appliedEntryIds".into(),
            Value::Array(all_entry_ids(&batch)),
        );
        m.insert("failed".into(), json!([]));
        m.insert(
            "files".into(),
            Value::Array(to_values(&collect_apply_owned_files(&batch, cwd, &[]))),
        );
        m.insert("notes".into(), json!(["repair-only validation pass"]));
        Ok(Value::Object(m))
    } else {
        agent.run(&batch)
    };

    let result = match result {
        Ok(v) => v,
        Err(message) => {
            let (rolled_back_files, rollback_failures) =
                rollback_changed_files(cwd, &rollback_snapshot, &[], &base_rollback_scope);
            let failed: Vec<Value> = get_arr(&batch, "entries")
                .iter()
                .map(|entry| {
                    let mut m = Map::new();
                    ins(&mut m, "id", entry.get("id").cloned());
                    m.insert("reason".into(), json!(message));
                    m.insert(
                        "candidates".into(),
                        Value::Array(candidates_for_entry(&batch, entry.get("id"))),
                    );
                    Value::Object(m)
                })
                .collect();
            let mut m = base_result(vec![], failed, vec![], 0, count, &page_url);
            m.insert(
                "rolledBackFiles".into(),
                Value::Array(to_values(&rolled_back_files)),
            );
            m.insert("rollbackFailures".into(), Value::Array(rollback_failures));
            for (k, v) in count_by_page_value(cwd, env) {
                m.insert(k, v);
            }
            return Ok(Value::Object(m));
        }
    };

    let result_files = arr(result.get("files"));
    let result_notes = arr(result.get("notes"));
    let result_warnings = arr(result.get("warnings"));
    let status = str_of(result.get("status")).unwrap_or_default();

    if status == "error" {
        let rollback_scope = collect_apply_owned_files(&batch, cwd, &result_files);
        let (rolled_back_files, rollback_failures) =
            rollback_changed_files(cwd, &rollback_snapshot, &result_files, &rollback_scope);
        let message = if truthy(result.get("message")) {
            js_string_or_empty(result.get("message"))
        } else {
            "AI copy edit failed".to_string()
        };
        let failed = normalize_failed_entries(&batch, &result, &message);
        let failed = if !failed.is_empty() {
            failed
        } else {
            verification_failures_for_entries(&batch, &get_arr(&batch, "entries"), &message, &[])
        };
        let mut m = base_result(vec![], failed, result_files.clone(), 0, count, &page_url);
        m.insert("notes".into(), Value::Array(result_notes));
        m.insert(
            "rolledBackFiles".into(),
            Value::Array(to_values(&rolled_back_files)),
        );
        m.insert("rollbackFailures".into(), Value::Array(rollback_failures));
        for (k, v) in count_by_page_value(cwd, env) {
            m.insert(k, v);
        }
        return Ok(Value::Object(m));
    }

    let reported_applied_ids = unique_strings(&arr(result.get("appliedEntryIds")));
    let reported_files: Vec<String> = unique_strings(&result_files)
        .iter()
        .filter_map(|file| normalize_relative_file(cwd, Some(&json!(file))))
        .collect();
    let ai_failed = normalize_failed_entries(&batch, &result, "AI copy edit failed");
    let rollback_scope = collect_apply_owned_files(&batch, cwd, &result_files);
    let failed_ids: HashSet<String> = ai_failed
        .iter()
        .filter_map(|item| str_of(item.get("id")))
        .filter(|s| !s.is_empty())
        .collect();
    let conflicting_applied_ids: Vec<String> = reported_applied_ids
        .iter()
        .filter(|id| failed_ids.contains(*id))
        .cloned()
        .collect();

    if !conflicting_applied_ids.is_empty() {
        let (rolled_back_files, rollback_failures) =
            rollback_changed_files(cwd, &rollback_snapshot, &result_files, &rollback_scope);
        let conflicting_entries: Vec<Value> = get_arr(&batch, "entries")
            .into_iter()
            .filter(|entry| match entry.get("id") {
                Some(Value::String(s)) => conflicting_applied_ids.contains(s),
                _ => false,
            })
            .collect();
        let mut failed = verification_failures_for_entries(
            &batch,
            &conflicting_entries,
            "conflicting_apply_result",
            &[],
        );
        failed.extend(
            ai_failed
                .iter()
                .filter(|item| match item.get("id") {
                    Some(Value::String(s)) => !conflicting_applied_ids.contains(s),
                    _ => true,
                })
                .cloned(),
        );
        let mut m = base_result(vec![], failed, result_files.clone(), 0, count, &page_url);
        m.insert("notes".into(), Value::Array(result_notes));
        m.insert(
            "rolledBackFiles".into(),
            Value::Array(to_values(&rolled_back_files)),
        );
        m.insert("rollbackFailures".into(), Value::Array(rollback_failures));
        for (k, v) in count_by_page_value(cwd, env) {
            m.insert(k, v);
        }
        return Ok(Value::Object(m));
    }

    let unreported_files =
        unreported_changed_files(cwd, &rollback_snapshot, &result_files, &rollback_scope);
    if !unreported_files.is_empty() {
        let mut scope = rollback_scope.clone();
        scope.extend(unreported_files.iter().cloned());
        let (rolled_back_files, rollback_failures) =
            rollback_changed_files(cwd, &rollback_snapshot, &result_files, &scope);
        let failed = verification_failures_for_entries(
            &batch,
            &get_arr(&batch, "entries"),
            "unreported_source_changes",
            &[("files", Value::Array(to_values(&unreported_files)))],
        );
        let mut m = base_result(vec![], failed, result_files.clone(), 0, count, &page_url);
        // JS (1f2c3f9d failWithRollback): the details spread — here
        // `unreportedFiles` then `notes` — lands after `pageUrl`.
        m.insert(
            "unreportedFiles".into(),
            Value::Array(to_values(&unreported_files)),
        );
        m.insert("notes".into(), Value::Array(result_notes));
        m.insert(
            "rolledBackFiles".into(),
            Value::Array(to_values(&rolled_back_files)),
        );
        m.insert("rollbackFailures".into(), Value::Array(rollback_failures));
        for (k, v) in count_by_page_value(cwd, env) {
            m.insert(k, v);
        }
        return Ok(Value::Object(m));
    }

    if status == "done" && reported_applied_ids.is_empty() {
        let (rolled_back_files, rollback_failures) =
            rollback_changed_files(cwd, &rollback_snapshot, &result_files, &rollback_scope);
        let failed = verification_failures_for_entries(
            &batch,
            &get_arr(&batch, "entries"),
            "missing_applied_entry_ids",
            &[],
        );
        let mut m = base_result(vec![], failed, result_files.clone(), 0, count, &page_url);
        m.insert("notes".into(), Value::Array(result_notes));
        m.insert(
            "rolledBackFiles".into(),
            Value::Array(to_values(&rolled_back_files)),
        );
        m.insert("rollbackFailures".into(), Value::Array(rollback_failures));
        for (k, v) in count_by_page_value(cwd, env) {
            m.insert(k, v);
        }
        return Ok(Value::Object(m));
    }

    let reported_applied_entries: Vec<Value> = get_arr(&batch, "entries")
        .into_iter()
        .filter(|entry| match entry.get("id") {
            Some(Value::String(s)) => reported_applied_ids.contains(s),
            _ => false,
        })
        .collect();

    if !reported_applied_ids.is_empty() && reported_files.is_empty() {
        return Ok(repair_post_apply_validation(
            RepairArgs {
                batch: &batch,
                cwd,
                env,
                page_url: &page_url,
                count,
                transaction_id,
                applied_entry_ids: reported_applied_ids.clone(),
                files: unique_strings(&result_files),
                failed: ai_failed.clone(),
                notes: result_notes.clone(),
                warnings: result_warnings.clone(),
                repair_reason: "missing_touched_files",
                repair_failures: verification_failures_for_entries(
                    &batch,
                    &reported_applied_entries,
                    "missing_touched_files",
                    &[],
                ),
            },
            agent,
        ));
    }

    let mut verified_applied_ids: Vec<Value> = Vec::new();
    let mut verification_failed: Vec<Value> = Vec::new();
    for entry in &reported_applied_entries {
        let failures = verify_applied_entry(&batch, entry, &reported_files, cwd);
        if failures.is_empty() {
            if let Some(id) = entry.get("id") {
                verified_applied_ids.push(id.clone());
            }
        } else {
            let mut m = Map::new();
            ins(&mut m, "id", entry.get("id").cloned());
            m.insert("reason".into(), json!("source_verification_failed"));
            m.insert("failures".into(), Value::Array(failures));
            m.insert(
                "candidates".into(),
                Value::Array(candidates_for_entry(&batch, entry.get("id"))),
            );
            verification_failed.push(Value::Object(m));
        }
    }

    let unreported_entries: Vec<Value> = if status == "done" || status == "partial" {
        get_arr(&batch, "entries")
            .into_iter()
            .filter(|entry| {
                let is_reported = match entry.get("id") {
                    Some(Value::String(s)) => reported_applied_ids.contains(s),
                    _ => false,
                };
                let in_failed = ai_failed
                    .iter()
                    .any(|item| key_of(item.get("id")) == key_of(entry.get("id")));
                !is_reported && !in_failed
            })
            .collect()
    } else {
        vec![]
    };
    let mut non_repair_failed =
        verification_failures_for_entries(&batch, &unreported_entries, "not_reported_applied", &[]);
    non_repair_failed.extend(ai_failed.iter().cloned());
    let mut failed = verification_failed.clone();
    failed.extend(non_repair_failed.iter().cloned());

    let unapplied_entries: Vec<Value> = get_arr(&batch, "entries")
        .into_iter()
        .filter(|entry| match entry.get("id") {
            Some(Value::String(s)) => !reported_applied_ids.contains(s),
            _ => true,
        })
        .collect();
    let leaked_unapplied = find_unapplied_entry_source_changes(
        &batch,
        &unapplied_entries,
        &reported_files,
        cwd,
        &rollback_snapshot,
    );
    if !leaked_unapplied.is_empty() {
        let leaked_ids: HashSet<String> = leaked_unapplied
            .iter()
            .filter_map(|item| str_of(item.get("id")))
            .filter(|s| !s.is_empty())
            .collect();
        let rolled_back_verified: Vec<Value> = reported_applied_entries
            .iter()
            .filter(|entry| {
                verified_applied_ids
                    .iter()
                    .any(|id| key_of(Some(id)) == key_of(entry.get("id")))
            })
            .map(|entry| {
                let mut m = Map::new();
                ins(&mut m, "id", entry.get("id").cloned());
                m.insert(
                    "reason".into(),
                    json!("rolled_back_due_to_failed_entry_source_changed"),
                );
                m.insert(
                    "candidates".into(),
                    Value::Array(candidates_for_entry(&batch, entry.get("id"))),
                );
                Value::Object(m)
            })
            .collect();
        let (rolled_back_files, rollback_failures) =
            rollback_changed_files(cwd, &rollback_snapshot, &result_files, &rollback_scope);
        let mut all_failed = leaked_unapplied.clone();
        all_failed.extend(
            failed
                .iter()
                .filter(|item| match item.get("id") {
                    Some(Value::String(s)) => !leaked_ids.contains(s),
                    _ => true,
                })
                .cloned(),
        );
        all_failed.extend(rolled_back_verified);
        let mut m = base_result(
            vec![],
            all_failed,
            result_files.clone(),
            0,
            count,
            &page_url,
        );
        // JS (1f2c3f9d failWithRollback): `notes` now precedes the
        // rollback fields.
        m.insert("notes".into(), Value::Array(result_notes));
        m.insert(
            "rolledBackFiles".into(),
            Value::Array(to_values(&rolled_back_files)),
        );
        m.insert("rollbackFailures".into(), Value::Array(rollback_failures));
        for (k, v) in count_by_page_value(cwd, env) {
            m.insert(k, v);
        }
        return Ok(Value::Object(m));
    }

    if !verification_failed.is_empty() {
        return Ok(repair_post_apply_validation(
            RepairArgs {
                batch: &batch,
                cwd,
                env,
                page_url: &page_url,
                count,
                transaction_id,
                applied_entry_ids: reported_applied_ids.clone(),
                files: unique_strings(&result_files),
                failed: non_repair_failed.clone(),
                notes: result_notes.clone(),
                warnings: result_warnings.clone(),
                repair_reason: "source_verification_failed",
                repair_failures: verification_failed.clone(),
            },
            agent,
        ));
    }

    let post_check_files = unique_strings(&result_files);
    let post_checks = run_copy_edit_post_apply_checks(cwd, &post_check_files);
    if post_checks.get("ok") != Some(&Value::Bool(true)) {
        let post_check_entries: Vec<Value> = if !verified_applied_ids.is_empty() {
            reported_applied_entries
                .iter()
                .filter(|entry| {
                    verified_applied_ids
                        .iter()
                        .any(|id| key_of(Some(id)) == key_of(entry.get("id")))
                })
                .cloned()
                .collect()
        } else {
            get_arr(&batch, "entries")
        };
        let applied_ids: Vec<String> = if !verified_applied_ids.is_empty() {
            verified_applied_ids
                .iter()
                .filter_map(|v| str_of(Some(v)))
                .collect()
        } else {
            post_check_entries
                .iter()
                .filter_map(|entry| str_of(entry.get("id")))
                .filter(|s| !s.is_empty())
                .collect()
        };
        let mut warnings = result_warnings.clone();
        warnings.extend(arr(post_checks.get("warnings")));
        return Ok(repair_post_apply_validation(
            RepairArgs {
                batch: &batch,
                cwd,
                env,
                page_url: &page_url,
                count,
                transaction_id,
                applied_entry_ids: applied_ids,
                files: unique_strings(&result_files),
                failed: failed.clone(),
                notes: result_notes.clone(),
                warnings,
                repair_reason: "post_apply_validation_failed",
                repair_failures: arr(post_checks.get("failures")),
            },
            agent,
        ));
    }

    let cleared = clear_applied_entries(cwd, env, &verified_applied_ids);
    let counts = count_by_page_value(cwd, env);
    let mut m = base_result(
        summarize_applied_entries(&get_arr(&batch, "entries"), &verified_applied_ids),
        failed,
        result_files.clone(),
        cleared,
        count,
        &page_url,
    );
    let mut warnings = result_warnings;
    warnings.extend(arr(post_checks.get("warnings")));
    m.insert("warnings".into(), Value::Array(warnings));
    m.insert("notes".into(), Value::Array(result_notes));
    for (k, v) in counts {
        m.insert(k, v);
    }
    Ok(Value::Object(m))
}
