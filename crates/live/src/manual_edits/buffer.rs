//! JS: live/manual-edits-buffer.mjs. The pending-manual-edits buffer on disk
//! (`.impeccable/live/pending-manual-edits.json`).

use crate::json_error::json_parse_error;
use crate::paths::live_dir;
use crate::util::{iso_now, jsp, Env};
use serde_json::{json, Map, Value};

pub const BUFFER_VERSION: i64 = 1;
const BUFFER_FILENAME: &str = "pending-manual-edits.json";

/// JS: getBufferPath(cwd)
pub fn buffer_path(cwd: &str, env: &Env) -> String {
    jsp::join(&[&live_dir(cwd, env), BUFFER_FILENAME])
}

/// The parsed buffer: `{ version: 1, entries: [...] }`.
#[derive(Debug, Clone)]
pub struct Buffer {
    pub entries: Vec<Value>,
}

impl Buffer {
    pub fn to_value(&self) -> Value {
        json!({ "version": BUFFER_VERSION, "entries": self.entries })
    }
}

fn read_internal(cwd: &str, env: &Env, strict: bool) -> Result<Buffer, String> {
    let file = buffer_path(cwd, env);
    let raw = match std::fs::read(&file) {
        Ok(b) => String::from_utf8_lossy(&b).into_owned(),
        Err(e) => {
            if strict && e.kind() != std::io::ErrorKind::NotFound {
                return Err(format!(
                    "manual_edit_buffer_unreadable: {}",
                    impeccable_context::util::node_read_error(&file, &e)
                ));
            }
            return Ok(Buffer { entries: vec![] });
        }
    };
    let parsed: Option<Value> = serde_json::from_str(&raw).ok();
    let parsed = match parsed {
        Some(v) => v,
        None => {
            if strict {
                let msg = json_parse_error(&raw).unwrap_or_else(|| "Unexpected token".to_string());
                return Err(format!("manual_edit_buffer_unreadable: {}", msg));
            }
            return Ok(Buffer { entries: vec![] });
        }
    };
    match parsed.get("entries") {
        Some(Value::Array(a)) if parsed.is_object() => Ok(Buffer { entries: a.clone() }),
        _ => {
            if strict {
                // JS: throw new Error('manual_edit_buffer_invalid_schema') is
                // caught by the same catch and re-thrown as unreadable.
                return Err(
                    "manual_edit_buffer_unreadable: manual_edit_buffer_invalid_schema".to_string(),
                );
            }
            Ok(Buffer { entries: vec![] })
        }
    }
}

/// JS: readBuffer(cwd)
pub fn read_buffer(cwd: &str, env: &Env) -> Buffer {
    read_internal(cwd, env, false).unwrap_or(Buffer { entries: vec![] })
}

/// JS: readBufferStrict(cwd)
pub fn read_buffer_strict(cwd: &str, env: &Env) -> Result<Buffer, String> {
    read_internal(cwd, env, true)
}

/// JS: writeBuffer(cwd, buffer)
pub fn write_buffer(cwd: &str, env: &Env, buffer: &Buffer) -> Result<(), String> {
    let file = buffer_path(cwd, env);
    if let Some(parent) = std::path::Path::new(&file).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(&file, crate::util::json_pretty(&buffer.to_value())).map_err(|e| e.to_string())
}

fn ops_of(entry: &Value) -> Vec<Value> {
    entry
        .get("ops")
        .and_then(|o| o.as_array())
        .cloned()
        .unwrap_or_default()
}

/// JS: stageEntry(cwd, newEntry)
pub fn stage_entry(cwd: &str, env: &Env, new_entry: &Value) -> Result<Buffer, String> {
    let mut buf = read_buffer_strict(cwd, env)?;
    let page_url = new_entry.get("pageUrl").cloned().unwrap_or(Value::Null);
    let new_id = new_entry.get("id").cloned().unwrap_or(Value::Null);
    let element = new_entry.get("element").cloned();
    for new_op in ops_of(new_entry) {
        let mut merged = false;
        for existing in buf.entries.iter_mut() {
            if existing.get("pageUrl") != Some(&page_url) {
                continue;
            }
            let existing_ops = ops_of(existing);
            let idx = existing_ops
                .iter()
                .position(|op| op.get("ref") == new_op.get("ref"));
            if let Some(i) = idx {
                let mut replaced = new_op.as_object().cloned().unwrap_or_default();
                let original = existing_ops[i]
                    .get("originalText")
                    .cloned()
                    .unwrap_or(Value::Null);
                replaced.insert("originalText".into(), original);
                replaced.insert(
                    "newText".into(),
                    new_op.get("newText").cloned().unwrap_or(Value::Null),
                );
                let deleted = match new_op.get("deleted") {
                    Some(v) if crate::event_validation::truthy(Some(v)) => v.clone(),
                    _ => Value::Bool(false),
                };
                replaced.insert("deleted".into(), deleted);
                let mut ops = existing_ops.clone();
                ops[i] = Value::Object(replaced);
                if let Some(obj) = existing.as_object_mut() {
                    obj.insert("ops".into(), Value::Array(ops));
                    if let Some(el) = &element {
                        if crate::event_validation::truthy(Some(el)) {
                            obj.insert("element".into(), el.clone());
                        }
                    }
                    obj.insert("stagedAt".into(), Value::String(iso_now()));
                }
                merged = true;
                break;
            }
        }
        if merged {
            continue;
        }
        let pos = buf
            .entries
            .iter()
            .position(|e| e.get("pageUrl") == Some(&page_url) && e.get("id") == Some(&new_id));
        let pos = match pos {
            Some(p) => p,
            None => {
                let mut m = Map::new();
                m.insert("id".into(), new_id.clone());
                m.insert("pageUrl".into(), page_url.clone());
                m.insert("element".into(), element.clone().unwrap_or(Value::Null));
                m.insert("ops".into(), Value::Array(vec![]));
                m.insert("stagedAt".into(), Value::String(iso_now()));
                buf.entries.push(Value::Object(m));
                buf.entries.len() - 1
            }
        };
        if let Some(obj) = buf.entries[pos].as_object_mut() {
            let mut ops = obj
                .get("ops")
                .and_then(|o| o.as_array())
                .cloned()
                .unwrap_or_default();
            ops.push(new_op.clone());
            obj.insert("ops".into(), Value::Array(ops));
            obj.insert("stagedAt".into(), Value::String(iso_now()));
        }
    }
    write_buffer(cwd, env, &buf)?;
    Ok(buf)
}

/// JS: removeEntries(cwd, predicate). Returns removed op count.
pub fn remove_entries(
    cwd: &str,
    env: &Env,
    predicate: impl Fn(&Value) -> bool,
) -> Result<usize, String> {
    let buf = read_buffer(cwd, env);
    let mut removed = 0;
    let mut kept = Vec::new();
    for entry in buf.entries {
        if predicate(&entry) {
            removed += ops_of(&entry).len();
        } else if !ops_of(&entry).is_empty() {
            kept.push(entry);
        }
    }
    write_buffer(cwd, env, &Buffer { entries: kept })?;
    Ok(removed)
}

/// JS: countByPage(cwd) -> (totalCount, perPage)
pub fn count_by_page(cwd: &str, env: &Env) -> (usize, Map<String, Value>) {
    let buf = read_buffer(cwd, env);
    let mut per_page: Map<String, Value> = Map::new();
    let mut total = 0usize;
    for entry in &buf.entries {
        let n = ops_of(entry).len();
        let key = match entry.get("pageUrl") {
            Some(Value::String(s)) => s.clone(),
            Some(Value::Null) | None => "null".to_string(),
            Some(other) => other.to_string(),
        };
        let cur = per_page.get(&key).and_then(|v| v.as_u64()).unwrap_or(0) as usize;
        per_page.insert(key, json!(cur + n));
        total += n;
    }
    (total, per_page)
}

/// JS: truncateBuffer(cwd). Returns removed op count.
pub fn truncate_buffer(cwd: &str, env: &Env) -> Result<usize, String> {
    let buf = read_buffer(cwd, env);
    let removed: usize = buf.entries.iter().map(|e| ops_of(e).len()).sum();
    write_buffer(cwd, env, &Buffer { entries: vec![] })?;
    Ok(removed)
}

/// `{ totalCount, perPage }` as a JSON object (spread helper).
pub fn count_by_page_value(cwd: &str, env: &Env) -> Map<String, Value> {
    let (total, per_page) = count_by_page(cwd, env);
    let mut m = Map::new();
    m.insert("totalCount".into(), json!(total));
    m.insert("perPage".into(), Value::Object(per_page));
    m
}
