//! JS: live/manual-apply.mjs. The chat-routed Apply controller: mints
//! `manual_edit_apply` events, waits for the agent's structured reply,
//! validates it, keeps pre-apply file snapshots for rollback, and owns the
//! commit transaction record.

use crate::paths::live_dir;
use crate::random::random_id8;
use crate::server_state::{
    lock, now_i64, truthy, ApplyDeferred, FileSnapshot, Shared, TimedOutApply,
};
use crate::util::{
    exists, iso_now, json_pretty, jsp, read_dir_names_raw, read_json, safe_read, Env,
};
use serde_json::{json, Map, Value};
use std::sync::mpsc::channel;
use std::time::Duration;

const DEFAULT_MANUAL_EDIT_APPLY_CHUNK_SIZE: i64 = 3;
const MIN_MANUAL_EDIT_APPLY_CHUNK_SIZE: i64 = 1;
const MAX_MANUAL_EDIT_APPLY_CHUNK_SIZE: i64 = 20;
const MANUAL_APPLY_COMPACT_TEXT_LIMIT: usize = 240;
const MANUAL_APPLY_COMPACT_NEARBY_LIMIT: usize = 4;

fn env_number(env: &Env, key: &str, default: f64) -> f64 {
    // JS: Number(process.env.X || default)
    match env.get(key).filter(|v| !v.is_empty()) {
        Some(v) => {
            let n = impeccable_core::js::string_to_number(v);
            if n.is_nan() {
                f64::NAN
            } else {
                n
            }
        }
        None => default,
    }
}

pub fn apply_event_hard_timeout_ms(env: &Env) -> f64 {
    env_number(
        env,
        "IMPECCABLE_LIVE_APPLY_EVENT_HARD_TIMEOUT_MS",
        150_000.0,
    )
}

pub fn apply_event_soft_deadline_ms(env: &Env) -> Value {
    let n = env_number(
        env,
        "IMPECCABLE_LIVE_APPLY_EVENT_SOFT_DEADLINE_MS",
        120_000.0,
    );
    if n.is_nan() {
        Value::Null
    } else {
        crate::util::js_num(n)
    }
}

/// JS: manualEditApplyChunkSize(env)
pub fn manual_edit_apply_chunk_size(env: &Env) -> i64 {
    let raw = match env.get("IMPECCABLE_LIVE_MANUAL_EDIT_CHUNK_SIZE") {
        Some(v) => impeccable_core::js::string_to_number(v),
        None => f64::NAN,
    };
    if !raw.is_finite() {
        return DEFAULT_MANUAL_EDIT_APPLY_CHUNK_SIZE;
    }
    let size = raw.trunc() as i64;
    size.clamp(
        MIN_MANUAL_EDIT_APPLY_CHUNK_SIZE,
        MAX_MANUAL_EDIT_APPLY_CHUNK_SIZE,
    )
}

fn arr<'a>(v: Option<&'a Value>) -> &'a [Value] {
    match v {
        Some(Value::Array(a)) => a.as_slice(),
        _ => &[],
    }
}

fn entries_of(batch: &Value) -> &[Value] {
    arr(batch.get("entries"))
}

/// JS: countManualApplyOps(entriesOrBatch)
pub fn count_manual_apply_ops(entries_or_batch: &Value) -> usize {
    let entries: &[Value] = match entries_or_batch {
        Value::Array(a) => a,
        other => arr(other.get("entries")),
    };
    entries.iter().map(|e| arr(e.get("ops")).len()).sum()
}

/// JS: manualApplyEvidenceDir(cwd)
pub fn manual_apply_evidence_dir(cwd: &str, env: &Env) -> String {
    jsp::join(&[&live_dir(cwd, env), "manual-edit-evidence"])
}

/// JS: writeManualApplyEvidence(eventId, batch, cwd)
pub fn write_manual_apply_evidence(event_id: &str, batch: &Value, cwd: &str, env: &Env) -> String {
    let dir = manual_apply_evidence_dir(cwd, env);
    let _ = std::fs::create_dir_all(&dir);
    let path = jsp::join(&[&dir, &format!("{}.json", event_id)]);
    let _ = std::fs::write(&path, format!("{}\n", json_pretty(batch)));
    path
}

/// JS: normalizeManualApplyEvidencePath(evidencePath, cwd)
pub fn normalize_manual_apply_evidence_path(
    evidence_path: Option<&Value>,
    cwd: &str,
    env: &Env,
) -> Option<String> {
    let p = evidence_path?.as_str()?;
    if p.is_empty() {
        return None;
    }
    let full = if jsp::is_absolute(p) {
        p.to_string()
    } else {
        jsp::resolve(cwd, &[p])
    };
    let dir = manual_apply_evidence_dir(cwd, env);
    let rel = jsp::relative("/", &dir, &full);
    if rel.is_empty() || rel.starts_with("..") || jsp::is_absolute(&rel) {
        return None;
    }
    if jsp::extname(&rel) != ".json" {
        return None;
    }
    Some(full)
}

/// JS: removeManualApplyEvidence(evidencePath, cwd)
pub fn remove_manual_apply_evidence(evidence_path: Option<&Value>, cwd: &str, env: &Env) -> bool {
    match normalize_manual_apply_evidence_path(evidence_path, cwd, env) {
        Some(full) => std::fs::remove_file(full).is_ok(),
        None => false,
    }
}

fn truncate_text(value: Option<&Value>, max: usize) -> Value {
    match value {
        Some(Value::String(s)) => {
            if s.encode_utf16().count() > max {
                let u: Vec<u16> = s.encode_utf16().take(max).collect();
                Value::String(String::from_utf16_lossy(&u))
            } else {
                Value::String(s.clone())
            }
        }
        Some(v) if truthy(Some(v)) => v.clone(),
        _ => Value::Null,
    }
}

fn compact_context(value: Option<&Value>) -> Value {
    let Some(v) = value.filter(|v| v.is_object()) else {
        return Value::Null;
    };
    let mut m = Map::new();
    m.insert("ref".into(), v.get("ref").cloned().unwrap_or(Value::Null));
    if v.get("ref").is_none() {
        m.shift_remove("ref");
    }
    let tag = match v.get("tagName") {
        Some(t) if truthy(Some(t)) => t.clone(),
        _ => match v.get("tag") {
            Some(t) if truthy(Some(t)) => t.clone(),
            _ => Value::Null,
        },
    };
    m.insert("tagName".into(), tag);
    m.insert(
        "id".into(),
        match v.get("id") {
            Some(t) if truthy(Some(t)) => t.clone(),
            _ => Value::Null,
        },
    );
    m.insert(
        "classes".into(),
        match v.get("classes") {
            Some(c @ Value::Array(_)) => c.clone(),
            _ => json!([]),
        },
    );
    m.insert(
        "textContent".into(),
        truncate_text(v.get("textContent"), MANUAL_APPLY_COMPACT_TEXT_LIMIT),
    );
    Value::Object(m)
}

fn compact_nearby(items: Option<&Value>) -> Value {
    Value::Array(
        arr(items)
            .iter()
            .take(MANUAL_APPLY_COMPACT_NEARBY_LIMIT)
            .map(|item| match item {
                Value::String(_) => {
                    json!({ "text": truncate_text(Some(item), MANUAL_APPLY_COMPACT_TEXT_LIMIT) })
                }
                other => {
                    let mut m = Map::new();
                    if let Some(r) = other.get("ref") {
                        m.insert("ref".into(), r.clone());
                    }
                    if let Some(t) = other.get("tag") {
                        m.insert("tag".into(), t.clone());
                    }
                    m.insert(
                        "classes".into(),
                        match other.get("classes") {
                            Some(c @ Value::Array(_)) => c.clone(),
                            _ => json!([]),
                        },
                    );
                    m.insert(
                        "text".into(),
                        truncate_text(other.get("text"), MANUAL_APPLY_COMPACT_TEXT_LIMIT),
                    );
                    Value::Object(m)
                }
            })
            .collect(),
    )
}

fn compact_op(op: &Value) -> Value {
    let mut m = Map::new();
    let copy = |m: &mut Map<String, Value>, k: &str| {
        if let Some(v) = op.get(k) {
            m.insert(k.to_string(), v.clone());
        }
    };
    copy(&mut m, "entryId");
    copy(&mut m, "ref");
    copy(&mut m, "contextRef");
    copy(&mut m, "tag");
    copy(&mut m, "elementId");
    m.insert(
        "classes".into(),
        match op.get("classes") {
            Some(c @ Value::Array(_)) => c.clone(),
            _ => json!([]),
        },
    );
    copy(&mut m, "originalText");
    copy(&mut m, "newText");
    if op.get("deleted") == Some(&Value::Bool(true)) {
        m.insert("deleted".into(), json!(true));
    }
    m.insert(
        "sourceHint".into(),
        match op.get("sourceHint") {
            Some(v) if truthy(Some(v)) => v.clone(),
            _ => Value::Null,
        },
    );
    m.insert("leaf".into(), compact_context(op.get("leaf")));
    m.insert(
        "nearbyEditableTexts".into(),
        compact_nearby(op.get("nearbyEditableTexts")),
    );
    m.insert("container".into(), compact_context(op.get("container")));
    if let Some(Value::Array(h)) = op.get("contextHints") {
        m.insert(
            "contextHints".into(),
            Value::Array(h.iter().take(8).cloned().collect()),
        );
    }
    Value::Object(m)
}

fn compact_entry(entry: &Value) -> Value {
    let mut m = Map::new();
    if let Some(v) = entry.get("id") {
        m.insert("id".into(), v.clone());
    }
    if let Some(v) = entry.get("pageUrl") {
        m.insert("pageUrl".into(), v.clone());
    }
    m.insert(
        "stagedAt".into(),
        match entry.get("stagedAt") {
            Some(v) if truthy(Some(v)) => v.clone(),
            _ => Value::Null,
        },
    );
    m.insert("element".into(), compact_context(entry.get("element")));
    m.insert(
        "ops".into(),
        Value::Array(arr(entry.get("ops")).iter().map(compact_op).collect()),
    );
    Value::Object(m)
}

/// JS: summarizeManualLogFile(file, cwd)
pub fn summarize_manual_log_file(file: Option<&Value>, cwd: &str) -> Option<String> {
    let f = file?.as_str()?;
    if f.is_empty() {
        return None;
    }
    if !jsp::is_absolute(f) {
        return Some(f.to_string());
    }
    let rel = jsp::relative("/", cwd, f);
    if !rel.is_empty() && !rel.starts_with("..") && !jsp::is_absolute(&rel) {
        Some(rel)
    } else {
        Some(f.to_string())
    }
}

fn compact_source_match(m: Option<&Value>, cwd: &str) -> Value {
    let Some(m) = m.filter(|v| v.is_object()) else {
        return Value::Null;
    };
    let file = match m.get("relativeFile") {
        Some(v) if truthy(Some(v)) => Some(v.clone()),
        _ => m.get("file").filter(|v| truthy(Some(v))).cloned(),
    };
    if file.is_none() && !truthy(m.get("line")) {
        return Value::Null;
    }
    let mut out = Map::new();
    match summarize_manual_log_file(file.as_ref(), cwd) {
        Some(f) => {
            out.insert("file".into(), json!(f));
        }
        None => {}
    }
    out.insert(
        "line".into(),
        match m.get("line") {
            Some(v) if truthy(Some(v)) => v.clone(),
            _ => Value::Null,
        },
    );
    out.insert(
        "column".into(),
        match m.get("column") {
            Some(v) if truthy(Some(v)) => v.clone(),
            _ => Value::Null,
        },
    );
    let reason = match m.get("reason") {
        Some(v) if truthy(Some(v)) => Some(v.clone()),
        _ => m.get("kind").filter(|v| truthy(Some(v))).cloned(),
    };
    if let Some(r) = reason {
        out.insert("reason".into(), r);
    }
    if let Some(s) = m.get("status").filter(|v| truthy(Some(v))) {
        out.insert("status".into(), s.clone());
    }
    Value::Object(out)
}

fn compact_source_matches(matches: Option<&Value>, limit: usize, cwd: &str) -> Value {
    Value::Array(
        arr(matches)
            .iter()
            .take(limit)
            .map(|m| compact_source_match(Some(m), cwd))
            .filter(|v| !v.is_null())
            .collect(),
    )
}

/// JS: compactManualApplyCandidates(candidates, cwd)
pub fn compact_manual_apply_candidates(candidates: Option<&Value>, cwd: &str) -> Vec<Value> {
    arr(candidates)
        .iter()
        .take(24)
        .map(|c| {
            let mut m = Map::new();
            if let Some(v) = c.get("entryId") {
                m.insert("entryId".into(), v.clone());
            }
            if let Some(v) = c.get("ref") {
                m.insert("ref".into(), v.clone());
            }
            m.insert(
                "sourceHint".into(),
                compact_source_match(c.get("sourceHint"), cwd),
            );
            m.insert(
                "textMatches".into(),
                compact_source_matches(c.get("textMatches"), 8, cwd),
            );
            m.insert(
                "objectKeyMatches".into(),
                compact_source_matches(c.get("objectKeyMatches"), 8, cwd),
            );
            m.insert(
                "contextTextMatches".into(),
                compact_source_matches(c.get("contextTextMatches"), 8, cwd),
            );
            m.insert(
                "locatorMatches".into(),
                compact_source_matches(c.get("locatorMatches"), 6, cwd),
            );
            Value::Object(m)
        })
        .collect()
}

/// JS: compactManualApplyBatch(batch, cwd)
pub fn compact_manual_apply_batch(batch: &Value, cwd: &str) -> Value {
    let entries: Vec<Value> = entries_of(batch).iter().map(compact_entry).collect();
    let candidates = compact_manual_apply_candidates(batch.get("candidates"), cwd);
    let mut m = Map::new();
    if let Some(v) = batch.get("version") {
        m.insert("version".into(), v.clone());
    }
    m.insert(
        "pageUrl".into(),
        match batch.get("pageUrl") {
            Some(v) if truthy(Some(v)) => v.clone(),
            _ => Value::Null,
        },
    );
    if let Some(v) = batch.get("count") {
        m.insert("count".into(), v.clone());
    }
    m.insert("entries".into(), Value::Array(entries.clone()));
    let mut ops: Vec<Value> = Vec::new();
    for entry in &entries {
        let id = entry.get("id").cloned().unwrap_or(Value::Null);
        for op in arr(entry.get("ops")) {
            // JS: compactManualApplyOp creates `entryId` as the first key
            // (undefined when absent), so `{ ...op, entryId }` keeps it first.
            let mut o = Map::new();
            o.insert("entryId".into(), id.clone());
            for (k, v) in op.as_object().cloned().unwrap_or_default() {
                if k != "entryId" {
                    o.insert(k, v);
                }
            }
            ops.push(Value::Object(o));
        }
    }
    m.insert("ops".into(), Value::Array(ops));
    if !candidates.is_empty() {
        m.insert("candidates".into(), Value::Array(candidates));
    }
    if let Some(ctx) = batch.get("context").filter(|v| truthy(Some(v))) {
        let mut c = Map::new();
        for k in [
            "bufferPath",
            "totalEntries",
            "totalOps",
            "chunkIndex",
            "chunkTotal",
            "totalApplyOps",
        ] {
            if let Some(v) = ctx.get(k) {
                c.insert(k.to_string(), v.clone());
            }
        }
        m.insert("context".into(), Value::Object(c));
    }
    Value::Object(m)
}

/// JS: manualApplyReplyCommand / buildManualApplyAgentAction
pub fn build_manual_apply_agent_action(id: Option<&str>) -> Value {
    let id = id.filter(|s| !s.is_empty()).unwrap_or("EVENT_ID");
    json!({
        "kind": "manual_edit_apply",
        "required": "apply_source_edits_then_reply",
        "replyCommand": format!("live-poll.mjs --reply {} done --data '<json>'", id),
        "warning": "Polling only leases this work item; it does not commit source edits.",
    })
}

fn normalize_project_file(file: Option<&Value>, cwd: &str) -> Option<String> {
    let f = file?.as_str()?;
    if f.is_empty() {
        return None;
    }
    let abs = if jsp::is_absolute(f) {
        f.to_string()
    } else {
        jsp::resolve(cwd, &[f])
    };
    let rel = jsp::relative("/", cwd, &abs);
    if rel.is_empty() || rel.starts_with("..") || jsp::is_absolute(&rel) {
        return None;
    }
    Some(rel)
}

/// JS: collectManualApplyFiles(batch, extraFiles, cwd)
pub fn collect_manual_apply_files(batch: &Value, extra_files: &[Value], cwd: &str) -> Vec<String> {
    let mut files: Vec<Value> = Vec::new();
    for entry in entries_of(batch) {
        for op in arr(entry.get("ops")) {
            files.push(
                op.get("sourceHint")
                    .and_then(|h| h.get("file"))
                    .cloned()
                    .unwrap_or(Value::Null),
            );
        }
    }
    for c in arr(batch.get("candidates")) {
        files.push(
            c.get("sourceHint")
                .and_then(|h| h.get("relativeFile"))
                .cloned()
                .unwrap_or(Value::Null),
        );
        files.push(
            c.get("sourceHint")
                .and_then(|h| h.get("file"))
                .cloned()
                .unwrap_or(Value::Null),
        );
        for k in [
            "textMatches",
            "objectKeyMatches",
            "locatorMatches",
            "contextTextMatches",
        ] {
            for item in arr(c.get(k)) {
                files.push(item.get("file").cloned().unwrap_or(Value::Null));
            }
        }
    }
    files.extend(extra_files.iter().cloned());
    // [...new Set(files)] dedupes by SameValueZero on the raw values.
    let mut seen: Vec<Value> = Vec::new();
    let mut out: Vec<String> = Vec::new();
    for f in files {
        if seen.contains(&f) {
            continue;
        }
        seen.push(f.clone());
        if let Some(rel) = normalize_project_file(Some(&f), cwd) {
            out.push(rel);
        }
    }
    out
}

/// JS: summarizeManualApplyEvent(event, batch, cwd)
pub fn summarize_manual_apply_event(event: &Map<String, Value>, batch: &Value, cwd: &str) -> Value {
    let entries = entries_of(batch);
    let op_count: usize = entries.iter().map(|e| arr(e.get("ops")).len()).sum();
    json!({
        "pageUrl": match event.get("pageUrl") { Some(v) if truthy(Some(v)) => v.clone(), _ => Value::Null },
        "chunk": match event.get("chunk") { Some(v) if truthy(Some(v)) => v.clone(), _ => Value::Null },
        "entryCount": entries.len(),
        "opCount": op_count,
        "files": collect_manual_apply_files(batch, &[], cwd),
    })
}

/// JS: compactManualLogText(value, max)
pub fn compact_manual_log_text(value: Option<&Value>, max: usize) -> Option<String> {
    let s = value?.as_str()?;
    let normalized: String = s.split_whitespace().collect::<Vec<_>>().join(" ");
    let len = normalized.encode_utf16().count();
    if len <= max {
        return Some(normalized);
    }
    let u: Vec<u16> = normalized.encode_utf16().take(max).collect();
    Some(format!(
        "{}... [truncated {} chars]",
        String::from_utf16_lossy(&u),
        len - max
    ))
}

fn opt_insert(m: &mut Map<String, Value>, k: &str, v: Option<Value>) {
    if let Some(v) = v {
        m.insert(k.to_string(), v);
    }
}

/// JS: summarizeManualDiagnostics(items, cwd) -> undefined | array
pub fn summarize_manual_diagnostics(items: Option<&Value>, cwd: &str) -> Option<Value> {
    let items = arr(items);
    if items.is_empty() {
        return None;
    }
    Some(Value::Array(
        items
            .iter()
            .take(12)
            .map(|item| {
                let mut m = Map::new();
                let reason = match item.get("reason") {
                    Some(v) if truthy(Some(v)) => Some(v.clone()),
                    _ => item.get("kind").filter(|v| truthy(Some(v))).cloned(),
                };
                opt_insert(&mut m, "reason", reason);
                opt_insert(
                    &mut m,
                    "detail",
                    compact_manual_log_text(item.get("detail"), 220).map(Value::String),
                );
                opt_insert(
                    &mut m,
                    "message",
                    compact_manual_log_text(item.get("message"), 300).map(Value::String),
                );
                let file = match item.get("file") {
                    Some(v) if truthy(Some(v)) => Some(v.clone()),
                    _ => item
                        .get("relativeFile")
                        .filter(|v| truthy(Some(v)))
                        .cloned(),
                };
                opt_insert(
                    &mut m,
                    "file",
                    summarize_manual_log_file(file.as_ref(), cwd).map(Value::String),
                );
                opt_insert(
                    &mut m,
                    "line",
                    item.get("line").filter(|v| truthy(Some(v))).cloned(),
                );
                opt_insert(
                    &mut m,
                    "ref",
                    compact_manual_log_text(item.get("ref"), 180).map(Value::String),
                );
                opt_insert(
                    &mut m,
                    "marker",
                    compact_manual_log_text(item.get("marker"), 120).map(Value::String),
                );
                if let Some(Value::Array(files)) = item.get("files") {
                    m.insert(
                        "files".into(),
                        Value::Array(
                            files
                                .iter()
                                .take(8)
                                .filter_map(|f| summarize_manual_log_file(Some(f), cwd))
                                .map(Value::String)
                                .collect(),
                        ),
                    );
                }
                Value::Object(m)
            })
            .collect(),
    ))
}

/// JS: summarizeManualApplyFailures(failed, cwd)
pub fn summarize_manual_apply_failures(failed: Option<&Value>, cwd: &str) -> Value {
    let Some(Value::Array(failed)) = failed else {
        return json!([]);
    };
    Value::Array(
        failed
            .iter()
            .take(20)
            .map(|item| {
                let mut m = Map::new();
                let id = match item.get("id") {
                    Some(v) if truthy(Some(v)) => v.clone(),
                    _ => match item.get("entryId") {
                        Some(v) if truthy(Some(v)) => v.clone(),
                        _ => Value::Null,
                    },
                };
                m.insert("id".into(), id);
                let reason = match item.get("reason") {
                    Some(v) if truthy(Some(v)) => v.clone(),
                    _ => match item.get("message") {
                        Some(v) if truthy(Some(v)) => v.clone(),
                        _ => json!("failed"),
                    },
                };
                m.insert("reason".into(), reason);
                opt_insert(
                    &mut m,
                    "message",
                    compact_manual_log_text(item.get("message"), 300).map(Value::String),
                );
                if let Some(Value::Array(files)) = item.get("files") {
                    m.insert(
                        "files".into(),
                        Value::Array(
                            files
                                .iter()
                                .take(12)
                                .filter_map(|f| summarize_manual_log_file(Some(f), cwd))
                                .map(Value::String)
                                .collect(),
                        ),
                    );
                }
                opt_insert(
                    &mut m,
                    "checks",
                    summarize_manual_diagnostics(item.get("checks"), cwd),
                );
                opt_insert(
                    &mut m,
                    "failures",
                    summarize_manual_diagnostics(item.get("failures"), cwd),
                );
                opt_insert(
                    &mut m,
                    "candidates",
                    summarize_manual_diagnostics(item.get("candidates"), cwd),
                );
                Value::Object(m)
            })
            .collect(),
    )
}

fn manual_apply_result_shape_hint(event_id: &str) -> String {
    format!(
        "Use live-poll.mjs --reply {} done --data '{{\"status\":\"done\",\"appliedEntryIds\":[\"ENTRY_ID\"],\"failed\":[],\"files\":[\"src/page.html\"],\"notes\":[]}}'",
        event_id
    )
}

fn invalid_result(reason: &str, event_id: &str, extra: &[(&str, Value)]) -> Result<Value, Value> {
    let mut body = Map::new();
    body.insert("error".into(), json!("invalid_manual_apply_result"));
    body.insert("reason".into(), json!(reason));
    body.insert(
        "hint".into(),
        json!(manual_apply_result_shape_hint(event_id)),
    );
    for (k, v) in extra {
        body.insert((*k).to_string(), v.clone());
    }
    Err(Value::Object(body))
}

/// JS: validateManualApplyResultMessage(msg, deferred). Ok(result) or
/// Err(400 body).
pub fn validate_manual_apply_result_message(
    msg: &Map<String, Value>,
    deferred_batch: &Value,
    deferred_event_id: Option<&str>,
) -> Result<Value, Value> {
    let event_id: String = match msg.get("id") {
        Some(v) if truthy(Some(v)) => match v {
            Value::String(s) => s.clone(),
            other => other.to_string(),
        },
        _ => deferred_event_id
            .filter(|s| !s.is_empty())
            .unwrap_or("EVENT_ID")
            .to_string(),
    };
    let data = match msg.get("data") {
        Some(Value::Object(d)) => d,
        _ => return invalid_result("missing_result_data", &event_id, &[]),
    };
    if data.contains_key("entries") || data.contains_key("ops") {
        return invalid_result("summary_result_not_allowed", &event_id, &[]);
    }
    let status = data.get("status").and_then(|s| s.as_str()).unwrap_or("");
    if !matches!(status, "done" | "partial" | "error") {
        return invalid_result(
            "invalid_status",
            &event_id,
            &[("status", data.get("status").cloned().unwrap_or(Value::Null))],
        );
    }
    for key in ["appliedEntryIds", "failed", "files", "notes"] {
        if !matches!(data.get(key), Some(Value::Array(_))) {
            return invalid_result(&format!("{}_must_be_array", key), &event_id, &[]);
        }
    }
    let applied = arr(data.get("appliedEntryIds"));
    let files = arr(data.get("files"));
    let notes = arr(data.get("notes"));
    let failed = arr(data.get("failed"));
    for (index, v) in applied.iter().enumerate() {
        if !matches!(v, Value::String(s) if !s.is_empty()) {
            return invalid_result(
                "appliedEntryIds_must_contain_strings",
                &event_id,
                &[("index", json!(index))],
            );
        }
    }
    for (index, v) in files.iter().enumerate() {
        if !matches!(v, Value::String(s) if !s.is_empty()) {
            return invalid_result(
                "files_must_contain_strings",
                &event_id,
                &[("index", json!(index))],
            );
        }
    }
    for (index, v) in notes.iter().enumerate() {
        if !v.is_string() {
            return invalid_result(
                "notes_must_contain_strings",
                &event_id,
                &[("index", json!(index))],
            );
        }
    }
    for (index, item) in failed.iter().enumerate() {
        if !item.is_object() {
            return invalid_result(
                "failed_must_contain_objects",
                &event_id,
                &[("index", json!(index))],
            );
        }
        if !matches!(item.get("entryId"), Some(Value::String(s)) if !s.is_empty()) {
            return invalid_result(
                "failed_entryId_required",
                &event_id,
                &[("index", json!(index))],
            );
        }
        if !matches!(item.get("reason"), Some(Value::String(s)) if !s.is_empty()) {
            return invalid_result(
                "failed_reason_required",
                &event_id,
                &[("index", json!(index))],
            );
        }
    }
    let event_entry_ids: Vec<Value> = entries_of(deferred_batch)
        .iter()
        .filter_map(|e| e.get("id"))
        .filter(|v| truthy(Some(v)))
        .cloned()
        .collect();
    for id in applied {
        if !event_entry_ids.is_empty() && !event_entry_ids.contains(id) {
            return invalid_result(
                "applied_entry_id_not_in_event",
                &event_id,
                &[("entryId", id.clone())],
            );
        }
    }
    for item in failed {
        let eid = item.get("entryId").cloned().unwrap_or(Value::Null);
        if !event_entry_ids.is_empty() && !event_entry_ids.contains(&eid) {
            return invalid_result(
                "failed_entry_id_not_in_event",
                &event_id,
                &[("entryId", eid)],
            );
        }
    }
    if status == "done" {
        if !failed.is_empty() {
            return invalid_result("done_result_has_failed_entries", &event_id, &[]);
        }
        if count_manual_apply_ops(deferred_batch) > 0 && applied.is_empty() {
            return invalid_result("done_result_missing_applied_entry_ids", &event_id, &[]);
        }
    }
    if status == "partial" && applied.is_empty() && failed.is_empty() {
        return invalid_result("partial_result_has_no_entries", &event_id, &[]);
    }
    if status == "error" && !applied.is_empty() {
        return invalid_result("error_result_has_applied_entries", &event_id, &[]);
    }
    let mut result = Map::new();
    result.insert("status".into(), json!(status));
    if let Some(Value::String(m)) = data.get("message") {
        result.insert("message".into(), json!(m));
    }
    result.insert("appliedEntryIds".into(), Value::Array(applied.to_vec()));
    result.insert("failed".into(), Value::Array(failed.to_vec()));
    result.insert("files".into(), Value::Array(files.to_vec()));
    result.insert("notes".into(), Value::Array(notes.to_vec()));
    Ok(Value::Object(result))
}

/// JS: normalizeApplyChunkResult(result)
fn normalize_apply_chunk_result(result: &Value) -> Value {
    let status = match result.get("status").and_then(|s| s.as_str()) {
        Some("partial") => "partial",
        Some("error") => "error",
        _ => "done",
    };
    json!({
        "status": status,
        "message": match result.get("message") { Some(Value::String(s)) => json!(s), _ => Value::Null },
        "appliedEntryIds": arr(result.get("appliedEntryIds")).iter().filter(|v| v.is_string()).cloned().collect::<Vec<_>>(),
        "failed": arr(result.get("failed")).iter().filter(|v| truthy(Some(v))).cloned().collect::<Vec<_>>(),
        "files": arr(result.get("files")).iter().filter(|v| v.is_string()).cloned().collect::<Vec<_>>(),
        "notes": arr(result.get("notes")).iter().filter(|v| v.is_string()).cloned().collect::<Vec<_>>(),
    })
}

fn first_failure_reason(result: &Value) -> Option<Value> {
    let first = arr(result.get("failed")).iter().find(|v| truthy(Some(v)))?;
    match first.get("reason") {
        Some(v) if truthy(Some(v)) => Some(v.clone()),
        _ => first.get("message").filter(|v| truthy(Some(v))).cloned(),
    }
}

/// One chunk of a split batch.
pub struct ApplyChunk {
    pub batch: Value,
    pub meta: Option<Value>,
    pub entry_ids: Vec<Value>,
    pub op_counts_by_entry: Vec<(Value, usize)>,
}

struct ChunkBuilder {
    entries: Vec<Value>,
    entry_index: Vec<(Value, usize)>,
    ops: Vec<Value>,
    refs_by_entry: Vec<(Value, Vec<Value>)>,
    op_counts_by_entry: Vec<(Value, usize)>,
    op_count: usize,
}

impl ChunkBuilder {
    fn new() -> ChunkBuilder {
        ChunkBuilder {
            entries: vec![],
            entry_index: vec![],
            ops: vec![],
            refs_by_entry: vec![],
            op_counts_by_entry: vec![],
            op_count: 0,
        }
    }
    fn add_op(&mut self, entry: &Value, op: &Value) {
        let id = entry.get("id").cloned().unwrap_or(Value::Null);
        let idx = match self.entry_index.iter().find(|(k, _)| *k == id) {
            Some((_, i)) => *i,
            None => {
                let mut e = entry.as_object().cloned().unwrap_or_default();
                e.insert("ops".into(), json!([]));
                self.entries.push(Value::Object(e));
                let i = self.entries.len() - 1;
                self.entry_index.push((id.clone(), i));
                i
            }
        };
        if let Some(Value::Array(ops)) = self.entries[idx].get_mut("ops") {
            ops.push(op.clone());
        }
        let mut o = op.as_object().cloned().unwrap_or_default();
        let entry_id = match op.get("entryId") {
            Some(v) if truthy(Some(v)) => v.clone(),
            _ => id.clone(),
        };
        o.insert("entryId".into(), entry_id);
        self.ops.push(Value::Object(o));
        if !self.refs_by_entry.iter().any(|(k, _)| *k == id) {
            self.refs_by_entry.push((id.clone(), vec![]));
        }
        if let Some(r) = op.get("ref").filter(|v| truthy(Some(v))) {
            if let Some((_, refs)) = self.refs_by_entry.iter_mut().find(|(k, _)| *k == id) {
                if !refs.contains(r) {
                    refs.push(r.clone());
                }
            }
        }
        match self.op_counts_by_entry.iter_mut().find(|(k, _)| *k == id) {
            Some((_, n)) => *n += 1,
            None => self.op_counts_by_entry.push((id.clone(), 1)),
        }
        self.op_count += 1;
    }
}

fn filter_chunk_candidates(batch: &Value, refs_by_entry: &[(Value, Vec<Value>)]) -> Vec<Value> {
    arr(batch.get("candidates"))
        .iter()
        .filter(|c| {
            let eid = c.get("entryId").cloned().unwrap_or(Value::Null);
            let Some((_, refs)) = refs_by_entry.iter().find(|(k, _)| *k == eid) else {
                return false;
            };
            match c.get("ref") {
                Some(r) if truthy(Some(r)) => refs.contains(r),
                _ => true,
            }
        })
        .cloned()
        .collect()
}

/// JS: splitManualApplyBatch(batch, maxOps)
pub fn split_manual_apply_batch(batch: &Value, max_ops: usize) -> Vec<ApplyChunk> {
    let total = count_manual_apply_ops(batch);
    let entry_ids = |entries: &[Value]| -> Vec<Value> {
        entries
            .iter()
            .filter_map(|e| e.get("id"))
            .filter(|v| truthy(Some(v)))
            .cloned()
            .collect()
    };
    if total <= max_ops {
        return vec![ApplyChunk {
            batch: batch.clone(),
            meta: None,
            entry_ids: entry_ids(entries_of(batch)),
            op_counts_by_entry: entries_of(batch)
                .iter()
                .map(|e| {
                    (
                        e.get("id").cloned().unwrap_or(Value::Null),
                        arr(e.get("ops")).len(),
                    )
                })
                .collect(),
        }];
    }
    let mut raw: Vec<ChunkBuilder> = Vec::new();
    let mut current = ChunkBuilder::new();
    for entry in entries_of(batch) {
        let ops = arr(entry.get("ops"));
        if ops.len() <= max_ops {
            if current.op_count > 0 && current.op_count + ops.len() > max_ops {
                raw.push(std::mem::replace(&mut current, ChunkBuilder::new()));
            }
            for op in ops {
                current.add_op(entry, op);
            }
            continue;
        }
        if current.op_count > 0 {
            raw.push(std::mem::replace(&mut current, ChunkBuilder::new()));
        }
        for op in ops {
            if current.op_count >= max_ops {
                raw.push(std::mem::replace(&mut current, ChunkBuilder::new()));
            }
            current.add_op(entry, op);
        }
    }
    if current.op_count > 0 {
        raw.push(current);
    }
    let n = raw.len();
    raw.into_iter()
        .enumerate()
        .map(|(index, chunk)| {
            let mut b = batch.as_object().cloned().unwrap_or_default();
            b.insert("count".into(), json!(chunk.op_count));
            b.insert("entries".into(), Value::Array(chunk.entries.clone()));
            b.insert("ops".into(), Value::Array(chunk.ops.clone()));
            b.insert(
                "candidates".into(),
                Value::Array(filter_chunk_candidates(batch, &chunk.refs_by_entry)),
            );
            let mut ctx = batch
                .get("context")
                .and_then(|c| c.as_object())
                .cloned()
                .unwrap_or_default();
            ctx.insert("totalEntries".into(), json!(chunk.entries.len()));
            ctx.insert("totalOps".into(), json!(chunk.op_count));
            ctx.insert("chunkIndex".into(), json!(index + 1));
            ctx.insert("chunkTotal".into(), json!(n));
            ctx.insert("totalApplyOps".into(), json!(total));
            b.insert("context".into(), Value::Object(ctx));
            ApplyChunk {
                batch: Value::Object(b),
                meta: Some(json!({
                    "index": index + 1,
                    "total": n,
                    "opCount": chunk.op_count,
                    "totalOpCount": total,
                })),
                entry_ids: entry_ids(&chunk.entries),
                op_counts_by_entry: chunk.op_counts_by_entry,
            }
        })
        .collect()
}

/// JS: snapshotApplyEventFiles(batch, cwd)
pub fn snapshot_apply_event_files(batch: &Value, cwd: &str) -> Vec<(String, FileSnapshot)> {
    let mut out = Vec::new();
    for rel in collect_manual_apply_files(batch, &[], cwd) {
        let abs = jsp::resolve(cwd, &[&rel]);
        let ex = exists(&abs);
        let content = if ex {
            match std::fs::read(&abs) {
                Ok(b) => String::from_utf8_lossy(&b).into_owned(),
                Err(_) => continue,
            }
        } else {
            String::new()
        };
        out.push((
            rel,
            FileSnapshot {
                exists: ex,
                content,
            },
        ));
    }
    out
}

/// JS: rollbackApplySnapshot(batch, rollbackSnapshot, extraFiles, reason, cwd)
pub fn rollback_apply_snapshot(
    batch: &Value,
    snapshot: &[(String, FileSnapshot)],
    extra_files: &[Value],
    cwd: &str,
) -> Value {
    let scope = collect_manual_apply_files(batch, extra_files, cwd);
    let mut rolled: Vec<String> = Vec::new();
    let mut failures: Vec<Value> = Vec::new();
    for rel in scope {
        let Some((_, before)) = snapshot.iter().find(|(k, _)| *k == rel) else {
            continue;
        };
        let abs = jsp::resolve(cwd, &[&rel]);
        let res: Result<(), String> = (|| {
            if before.exists {
                if let Some(parent) = std::path::Path::new(&abs).parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                std::fs::write(&abs, &before.content).map_err(|e| e.to_string())?;
            } else if exists(&abs) {
                std::fs::remove_file(&abs).map_err(|e| e.to_string())?;
            }
            Ok(())
        })();
        match res {
            Ok(()) => rolled.push(rel),
            Err(e) => {
                failures.push(json!({ "file": rel, "reason": "restore_failed", "message": e }))
            }
        }
    }
    json!({ "rolledBackFiles": rolled, "rollbackFailures": failures })
}

/// JS: manualApplyTransactionPath(cwd)
pub fn manual_apply_transaction_path(cwd: &str, env: &Env) -> String {
    jsp::join(&[&live_dir(cwd, env), "manual-edit-apply-transaction.json"])
}

/// JS: readManualApplyTransaction(cwd)
pub fn read_manual_apply_transaction(cwd: &str, env: &Env) -> Option<Value> {
    let file = manual_apply_transaction_path(cwd, env);
    if !exists(&file) {
        return None;
    }
    read_json(&file)
}

/// JS: writeManualApplyTransaction({ cwd, pageUrl, batch })
pub fn write_manual_apply_transaction(
    cwd: &str,
    env: &Env,
    page_url: &Value,
    batch: &Value,
) -> Value {
    let file = manual_apply_transaction_path(cwd, env);
    let files = collect_manual_apply_files(batch, &[], cwd);
    let file_entries: Vec<Value> = files
        .iter()
        .map(|rel| {
            let abs = jsp::resolve(cwd, &[rel]);
            let ex = exists(&abs);
            json!({
                "file": rel,
                "exists": ex,
                "content": if ex { safe_read(&abs).unwrap_or_default() } else { String::new() },
            })
        })
        .collect();
    let transaction = json!({
        "version": 1,
        "id": random_id8(),
        "createdAt": iso_now(),
        "pageUrl": page_url,
        "entryIds": entries_of(batch).iter().filter_map(|e| e.get("id")).filter(|v| truthy(Some(v))).cloned().collect::<Vec<_>>(),
        "files": file_entries,
    });
    if let Some(parent) = std::path::Path::new(&file).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let tmp = format!("{}.tmp", file);
    let _ = std::fs::write(&tmp, format!("{}\n", json_pretty(&transaction)));
    let _ = std::fs::rename(&tmp, &file);
    transaction
}

/// JS: clearManualApplyTransaction(cwd, transactionId)
pub fn clear_manual_apply_transaction(cwd: &str, env: &Env, transaction_id: Option<&str>) -> bool {
    let file = manual_apply_transaction_path(cwd, env);
    if !exists(&file) {
        return false;
    }
    if let Some(tid) = transaction_id.filter(|s| !s.is_empty()) {
        if let Some(existing) = read_manual_apply_transaction(cwd, env) {
            if let Some(id) = existing
                .get("id")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
            {
                if id != tid {
                    return false;
                }
            }
        }
    }
    std::fs::remove_file(&file).is_ok()
}

/// JS: rollbackManualApplyTransaction({ cwd, pageUrl, reason,
/// recordManualEditActivity }). `activity` receives the rolled-back
/// activity entry to record (the caller holds the state lock).
pub fn rollback_manual_apply_transaction(
    cwd: &str,
    env: &Env,
    page_url: Option<&str>,
    reason: &str,
) -> (Option<Value>, Option<Map<String, Value>>) {
    let Some(transaction) = read_manual_apply_transaction(cwd, env) else {
        return (None, None);
    };
    if let Some(pu) = page_url {
        if let Some(tp) = transaction.get("pageUrl").filter(|v| truthy(Some(v))) {
            if tp.as_str() != Some(pu) {
                return (None, None);
            }
        }
    }
    let tid = transaction.get("id").cloned().unwrap_or(Value::Null);
    let tid_str = tid.as_str().map(String::from);
    let entry_ids: Vec<Value> = arr(transaction.get("entryIds")).to_vec();
    let buffer = crate::manual_edits::buffer::read_buffer(cwd, env);
    let pending_ids: Vec<Value> = buffer
        .entries
        .iter()
        .filter_map(|e| e.get("id"))
        .filter(|v| truthy(Some(v)))
        .cloned()
        .collect();
    let should_rollback = entry_ids.iter().any(|id| pending_ids.contains(id));
    if !should_rollback {
        clear_manual_apply_transaction(cwd, env, tid_str.as_deref());
        return (
            Some(
                json!({ "id": tid, "reason": reason, "rolledBackFiles": [], "rollbackFailures": [], "skipped": "entries_not_pending" }),
            ),
            None,
        );
    }
    let mut rolled: Vec<String> = Vec::new();
    let mut failures: Vec<Value> = Vec::new();
    for item in arr(transaction.get("files")) {
        let Some(rel) = normalize_project_file(item.get("file"), cwd) else {
            continue;
        };
        let abs = jsp::resolve(cwd, &[&rel]);
        let res: Result<(), String> = (|| {
            if truthy(item.get("exists")) {
                if let Some(parent) = std::path::Path::new(&abs).parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                let content = item.get("content").and_then(|c| c.as_str()).unwrap_or("");
                std::fs::write(&abs, content).map_err(|e| e.to_string())?;
            } else if exists(&abs) {
                std::fs::remove_file(&abs).map_err(|e| e.to_string())?;
            }
            Ok(())
        })();
        match res {
            Ok(()) => rolled.push(rel),
            Err(e) => {
                failures.push(json!({ "file": rel, "reason": "restore_failed", "message": e }))
            }
        }
    }
    clear_manual_apply_transaction(cwd, env, tid_str.as_deref());
    let mut activity = Map::new();
    activity.insert("id".into(), tid.clone());
    activity.insert(
        "pageUrl".into(),
        match transaction.get("pageUrl") {
            Some(v) if truthy(Some(v)) => v.clone(),
            _ => Value::Null,
        },
    );
    activity.insert("reason".into(), json!(reason));
    activity.insert("entryIds".into(), Value::Array(entry_ids));
    activity.insert(
        "rolledBackFiles".into(),
        Value::Array(
            rolled
                .iter()
                .filter_map(|f| summarize_manual_log_file(Some(&Value::String(f.clone())), cwd))
                .map(Value::String)
                .collect(),
        ),
    );
    opt_insert(
        &mut activity,
        "rollbackFailures",
        summarize_manual_diagnostics(Some(&Value::Array(failures.clone())), cwd),
    );
    (
        Some(
            json!({ "id": tid, "reason": reason, "rolledBackFiles": rolled, "rollbackFailures": failures }),
        ),
        Some(activity),
    )
}

// ---------------------------------------------------------------------------
// Controller operations on the shared server state
// ---------------------------------------------------------------------------

/// JS: tombstoneTimedOutApplyId(eventId, details)
fn tombstone(st: &mut crate::server_state::ServerState, event_id: &str, details: TimedOutApply) {
    if event_id.is_empty() {
        return;
    }
    st.timed_out_apply_ids.retain(|(k, _)| k != event_id);
    st.timed_out_apply_ids.push((event_id.to_string(), details));
    if st.timed_out_apply_ids.len() > 200 {
        st.timed_out_apply_ids.remove(0);
    }
}

/// JS: pushApplyEventAndWait(batch, pageUrl, chunk, repair): mints the
/// event, dispatches, and blocks until the agent replies (Ok(result)) or the
/// hard timeout / a cancel rejects (Err(reason)).
pub fn push_apply_event_and_wait(
    shared: &Shared,
    batch: &Value,
    page_url: &Value,
    chunk: Option<&Value>,
    repair: Option<&Value>,
) -> Result<Value, String> {
    let (rx, event_id, cwd, env, hard_timeout) = {
        let mut st = lock(shared);
        let cwd = st.cwd.clone();
        let env = st.env.clone();
        let event_id = random_id8();
        let evidence_path = write_manual_apply_evidence(&event_id, batch, &cwd, &env);
        let mut event = Map::new();
        event.insert("type".into(), json!("manual_edit_apply"));
        event.insert("id".into(), json!(event_id));
        event.insert("pageUrl".into(), page_url.clone());
        event.insert("batch".into(), compact_manual_apply_batch(batch, &cwd));
        event.insert("evidencePath".into(), json!(evidence_path));
        event.insert(
            "agentAction".into(),
            build_manual_apply_agent_action(Some(&event_id)),
        );
        event.insert("schemaVersion".into(), json!(1));
        event.insert("deadlineMs".into(), apply_event_soft_deadline_ms(&env));
        if let Some(c) = chunk.filter(|c| truthy(Some(c))) {
            event.insert("chunk".into(), c.clone());
        }
        if let Some(r) = repair.filter(|r| truthy(Some(r))) {
            event.insert("repair".into(), r.clone());
        }
        let rollback_snapshot = snapshot_apply_event_files(batch, &cwd);
        let mut details = Map::new();
        details.insert("id".into(), json!(event_id));
        details.insert("pageUrl".into(), page_url.clone());
        details.insert("chunk".into(), chunk.cloned().unwrap_or(Value::Null));
        details.insert("repair".into(), repair.cloned().unwrap_or(Value::Null));
        details.insert("entryCount".into(), json!(entries_of(batch).len()));
        details.insert("opCount".into(), json!(count_manual_apply_ops(batch)));
        details.insert(
            "fileCount".into(),
            json!(collect_manual_apply_files(batch, &[], &cwd).len()),
        );
        st.record_manual_edit_activity("manual_edit_apply_dispatched", details);
        let (tx, rx) = channel();
        st.next_apply_timer_gen += 1;
        let timer_gen = st.next_apply_timer_gen;
        st.pending_apply_deferreds.push((
            event_id.clone(),
            ApplyDeferred {
                tx,
                event: event.clone(),
                batch: batch.clone(),
                page_url: page_url.clone(),
                rollback_snapshot,
                cwd: cwd.clone(),
                timer_gen,
            },
        ));
        st.enqueue_event(event);
        let hard = apply_event_hard_timeout_ms(&env);
        (rx, event_id, cwd, env, hard)
    };
    // Hard timeout timer.
    {
        let weak = std::sync::Arc::downgrade(shared);
        let eid = event_id.clone();
        let batch_c = batch.clone();
        let page_url_c = page_url.clone();
        let chunk_c = chunk.cloned().unwrap_or(Value::Null);
        let cwd_c = cwd.clone();
        let env_c = env.clone();
        let delay = if hard_timeout.is_finite() && hard_timeout > 0.0 {
            hard_timeout as u64
        } else {
            1
        };
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(delay));
            let Some(shared) = weak.upgrade() else {
                return;
            };
            let mut st = lock(&shared);
            let Some(pos) = st
                .pending_apply_deferreds
                .iter()
                .position(|(k, _)| *k == eid)
            else {
                return;
            };
            let (_, deferred) = st.pending_apply_deferreds.remove(pos);
            tombstone(
                &mut st,
                &eid,
                TimedOutApply {
                    batch: deferred.batch.clone(),
                    rollback_snapshot: deferred.rollback_snapshot.clone(),
                    cwd: deferred.cwd.clone(),
                },
            );
            st.acknowledge_pending_event(Some(&eid), None);
            remove_manual_apply_evidence(deferred.event.get("evidencePath"), &cwd_c, &env_c);
            let mut details = Map::new();
            details.insert("id".into(), json!(eid));
            details.insert("pageUrl".into(), page_url_c);
            details.insert("chunk".into(), chunk_c);
            details.insert("entryCount".into(), json!(entries_of(&batch_c).len()));
            details.insert("opCount".into(), json!(count_manual_apply_ops(&batch_c)));
            st.record_manual_edit_activity("manual_edit_apply_timeout", details);
            let _ = deferred.tx.send(Err("chat_agent_timeout".to_string()));
        });
    }
    match rx.recv() {
        Ok(r) => r,
        Err(_) => Err("chat_agent_error".to_string()),
    }
}

fn mark_chunk_entries_failed(
    failed_by_entry: &mut Vec<(Value, Value)>,
    chunk: &ApplyChunk,
    reason: &str,
) {
    for eid in &chunk.entry_ids {
        if failed_by_entry.iter().any(|(k, _)| k == eid) {
            continue;
        }
        failed_by_entry.push((
            eid.clone(),
            json!({ "entryId": eid, "reason": reason, "candidates": [] }),
        ));
    }
}

/// JS: pushBatchInChunksAndWait(batch, pageUrl, context)
pub fn push_batch_in_chunks_and_wait(
    shared: &Shared,
    batch: &Value,
    page_url: &Value,
    repair: Option<&Value>,
) -> Result<Value, String> {
    let repair = repair
        .filter(|r| truthy(Some(r)))
        .cloned()
        .or_else(|| batch.get("repair").filter(|r| truthy(Some(r))).cloned());
    if let Some(r) = repair {
        return push_apply_event_and_wait(shared, batch, page_url, None, Some(&r));
    }
    let chunk_size = {
        let st = lock(shared);
        manual_edit_apply_chunk_size(&st.env)
    };
    let chunks = split_manual_apply_batch(batch, chunk_size as usize);
    if chunks.len() <= 1 {
        return push_apply_event_and_wait(shared, batch, page_url, None, None);
    }
    let expected_ops_by_entry: Vec<(Value, usize)> = entries_of(batch)
        .iter()
        .map(|e| {
            (
                e.get("id").cloned().unwrap_or(Value::Null),
                arr(e.get("ops")).len(),
            )
        })
        .collect();
    let mut applied_ops_by_entry: Vec<(Value, usize)> = Vec::new();
    let mut failed_by_entry: Vec<(Value, Value)> = Vec::new();
    let mut files: Vec<Value> = Vec::new();
    let mut notes: Vec<Value> = Vec::new();
    let mut aborted = false;
    for chunk in &chunks {
        if aborted {
            mark_chunk_entries_failed(&mut failed_by_entry, chunk, "manual_edit_chunk_aborted");
            continue;
        }
        let result = match push_apply_event_and_wait(
            shared,
            &chunk.batch,
            page_url,
            chunk.meta.as_ref(),
            None,
        ) {
            Ok(r) => normalize_apply_chunk_result(&r),
            Err(e) => {
                let reason = if e.is_empty() {
                    "chat_agent_error".to_string()
                } else {
                    e
                };
                mark_chunk_entries_failed(&mut failed_by_entry, chunk, &reason);
                aborted = true;
                continue;
            }
        };
        for f in arr(result.get("files")) {
            if !files.contains(f) {
                files.push(f.clone());
            }
        }
        notes.extend(arr(result.get("notes")).iter().cloned());
        let mut chunk_failed_ids: Vec<Value> = Vec::new();
        for item in arr(result.get("failed")) {
            let eid = match item.get("entryId") {
                Some(v) if truthy(Some(v)) => v.clone(),
                _ => match item.get("id") {
                    Some(v) if truthy(Some(v)) => v.clone(),
                    _ => continue,
                },
            };
            chunk_failed_ids.push(eid.clone());
            if !failed_by_entry.iter().any(|(k, _)| *k == eid) {
                let reason = match item.get("reason") {
                    Some(v) if truthy(Some(v)) => v.clone(),
                    _ => match item.get("message") {
                        Some(v) if truthy(Some(v)) => v.clone(),
                        _ => json!("failed"),
                    },
                };
                let candidates = match item.get("candidates") {
                    Some(c @ Value::Array(_)) => c.clone(),
                    _ => json!([]),
                };
                failed_by_entry.push((
                    eid.clone(),
                    json!({ "entryId": eid, "reason": reason, "candidates": candidates }),
                ));
            }
        }
        if result.get("status").and_then(|s| s.as_str()) == Some("error") {
            let reason = match result.get("message") {
                Some(Value::String(m)) if !m.is_empty() => m.clone(),
                _ => match first_failure_reason(&result) {
                    Some(Value::String(s)) => s,
                    Some(other) => other.to_string(),
                    None => "chat_agent_error".to_string(),
                },
            };
            mark_chunk_entries_failed(&mut failed_by_entry, chunk, &reason);
            aborted = true;
            continue;
        }
        let reported: Vec<Value> = arr(result.get("appliedEntryIds")).to_vec();
        for eid in &reported {
            if !chunk.entry_ids.contains(eid) || chunk_failed_ids.contains(eid) {
                continue;
            }
            let add = chunk
                .op_counts_by_entry
                .iter()
                .find(|(k, _)| k == eid)
                .map(|(_, n)| *n)
                .unwrap_or(0);
            match applied_ops_by_entry.iter_mut().find(|(k, _)| k == eid) {
                Some((_, n)) => *n += add,
                None => applied_ops_by_entry.push((eid.clone(), add)),
            }
        }
        for eid in &chunk.entry_ids {
            if reported.contains(eid) || chunk_failed_ids.contains(eid) {
                continue;
            }
            if !failed_by_entry.iter().any(|(k, _)| k == eid) {
                failed_by_entry.push((
                    eid.clone(),
                    json!({ "entryId": eid, "reason": "not_reported_applied", "candidates": [] }),
                ));
            }
        }
    }
    let mut applied_entry_ids: Vec<Value> = Vec::new();
    for (eid, expected) in &expected_ops_by_entry {
        if failed_by_entry.iter().any(|(k, _)| k == eid) {
            continue;
        }
        let applied = applied_ops_by_entry
            .iter()
            .find(|(k, _)| k == eid)
            .map(|(_, n)| *n)
            .unwrap_or(0);
        if applied == *expected && *expected > 0 {
            applied_entry_ids.push(eid.clone());
        } else if !failed_by_entry.iter().any(|(k, _)| k == eid) {
            failed_by_entry.push((
                eid.clone(),
                json!({ "entryId": eid, "reason": "not_reported_applied", "candidates": [] }),
            ));
        }
    }
    let failed: Vec<Value> = failed_by_entry.into_iter().map(|(_, v)| v).collect();
    let status = if failed.is_empty() {
        "done"
    } else if !applied_entry_ids.is_empty() {
        "partial"
    } else {
        "error"
    };
    Ok(json!({
        "status": status,
        "appliedEntryIds": applied_entry_ids,
        "failed": failed,
        "files": files,
        "notes": notes,
    }))
}

/// JS: resolveDeferred(eventId, body)
pub fn resolve_deferred(
    st: &mut crate::server_state::ServerState,
    event_id: &str,
    body: Value,
) -> bool {
    let Some(pos) = st
        .pending_apply_deferreds
        .iter()
        .position(|(k, _)| k == event_id)
    else {
        return false;
    };
    let (_, deferred) = st.pending_apply_deferreds.remove(pos);
    let env = st.env.clone();
    remove_manual_apply_evidence(deferred.event.get("evidencePath"), &deferred.cwd, &env);
    let _ = deferred.tx.send(Ok(body));
    true
}

/// JS: pruneStaleEvidence(cwd)
pub fn prune_stale_evidence(st: &crate::server_state::ServerState) -> Vec<String> {
    let cwd = st.cwd.clone();
    let env = st.env.clone();
    let dir = manual_apply_evidence_dir(&cwd, &env);
    if !exists(&dir) {
        return vec![];
    }
    let mut referenced: Vec<String> = Vec::new();
    for entry in &st.pending_events {
        if let Some(p) =
            normalize_manual_apply_evidence_path(entry.event.get("evidencePath"), &cwd, &env)
        {
            referenced.push(p);
        }
    }
    for (_, d) in &st.pending_apply_deferreds {
        if let Some(p) =
            normalize_manual_apply_evidence_path(d.event.get("evidencePath"), &cwd, &env)
        {
            referenced.push(p);
        }
    }
    let mut removed = Vec::new();
    for name in read_dir_names_raw(&dir).unwrap_or_default() {
        if !name.ends_with(".json") {
            continue;
        }
        let full = jsp::join(&[&dir, &name]);
        if referenced.contains(&full) {
            continue;
        }
        if std::fs::remove_file(&full).is_ok() {
            removed.push(full);
        }
    }
    removed
}

/// JS: rollbackTimedOutReply(msg)
pub fn rollback_timed_out_reply(
    st: &mut crate::server_state::ServerState,
    msg: &Map<String, Value>,
) -> Value {
    let id = msg.get("id").and_then(|v| v.as_str()).unwrap_or("");
    let Some(pos) = st.timed_out_apply_ids.iter().position(|(k, _)| k == id) else {
        return json!({ "rolledBackFiles": [], "rollbackFailures": [] });
    };
    let (_, details) = st.timed_out_apply_ids.remove(pos);
    let extra: Vec<Value> = msg
        .get("data")
        .and_then(|d| d.get("files"))
        .and_then(|f| f.as_array())
        .cloned()
        .unwrap_or_default();
    rollback_apply_snapshot(
        &details.batch,
        &details.rollback_snapshot,
        &extra,
        &details.cwd,
    )
}

/// JS: cancelPendingEvents(pageUrl, reason)
pub fn cancel_pending_events(
    st: &mut crate::server_state::ServerState,
    page_url: Option<&str>,
    reason: &str,
) -> Vec<Value> {
    let cwd = st.cwd.clone();
    let env = st.env.clone();
    let should_cancel = |event: &Map<String, Value>| -> bool {
        event.get("type").and_then(|t| t.as_str()) == Some("manual_edit_apply")
            && (page_url.is_none() || event.get("pageUrl").and_then(|p| p.as_str()) == page_url)
    };
    let mut canceled: Vec<(String, Value)> = Vec::new();
    let mut i = st.pending_events.len();
    while i > 0 {
        i -= 1;
        let ev = st.pending_events[i].event.clone();
        if !should_cancel(&ev) {
            continue;
        }
        st.pending_events.remove(i);
        remove_manual_apply_evidence(ev.get("evidencePath"), &cwd, &env);
        let id = ev
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let rec = json!({
            "id": ev.get("id").cloned().unwrap_or(Value::Null),
            "pageUrl": ev.get("pageUrl").cloned().unwrap_or(Value::Null),
            "entryCount": ev.get("batch").map(|b| entries_of(b).len()).unwrap_or(0),
        });
        canceled.retain(|(k, _)| *k != id);
        canceled.push((id, rec));
    }
    let deferred_ids: Vec<String> = st
        .pending_apply_deferreds
        .iter()
        .filter(|(_, d)| should_cancel(&d.event))
        .map(|(k, _)| k.clone())
        .collect();
    for eid in deferred_ids {
        let Some(pos) = st
            .pending_apply_deferreds
            .iter()
            .position(|(k, _)| *k == eid)
        else {
            continue;
        };
        let (_, deferred) = st.pending_apply_deferreds.remove(pos);
        let rollback = rollback_apply_snapshot(
            &deferred.batch,
            &deferred.rollback_snapshot,
            &[],
            &deferred.cwd,
        );
        tombstone(
            st,
            &eid,
            TimedOutApply {
                batch: deferred.batch.clone(),
                rollback_snapshot: deferred.rollback_snapshot.clone(),
                cwd: deferred.cwd.clone(),
            },
        );
        remove_manual_apply_evidence(deferred.event.get("evidencePath"), &deferred.cwd, &env);
        let rec = json!({
            "id": eid,
            "pageUrl": deferred.page_url,
            "entryCount": entries_of(&deferred.batch).len(),
            "rolledBackFiles": rollback.get("rolledBackFiles").cloned().unwrap_or(json!([])),
            "rollbackFailures": rollback.get("rollbackFailures").cloned().unwrap_or(json!([])),
        });
        canceled.retain(|(k, _)| *k != eid);
        canceled.push((eid.clone(), rec));
        let _ = deferred.tx.send(Err(reason.to_string()));
    }
    if !canceled.is_empty() {
        st.flush_pending_polls();
    }
    canceled.into_iter().map(|(_, v)| v).collect()
}

/// Helper: `st.rollbackTransaction({ pageUrl, reason })` recording activity.
pub fn rollback_transaction(
    st: &mut crate::server_state::ServerState,
    page_url: Option<&str>,
    reason: &str,
) -> Option<Value> {
    let cwd = st.cwd.clone();
    let env = st.env.clone();
    let (result, activity) = rollback_manual_apply_transaction(&cwd, &env, page_url, reason);
    if let Some(a) = activity {
        st.record_manual_edit_activity("manual_edit_transaction_rolled_back", a);
    }
    result
}

/// `Date.now()`-stamped id helper re-export for the routes.
pub fn now() -> i64 {
    now_i64()
}
