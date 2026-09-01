//! JS: live/session-store.mjs. Append-only per-session journal
//! (`<id>.jsonl`) with a derived snapshot (`<id>.snapshot.json`), replayed
//! through the same reducer the server uses.

use crate::paths::{legacy_live_sessions_dir, live_sessions_dir, safe_session_id};
use crate::util::{
    date_parse_ms, exists, iso_now, js_number, jsp, now_ms, read_dir_names_raw, safe_read, Env,
};
use serde_json::{json, Map, Value};

pub const COMPLETED_SESSION_PHASES: [&str; 2] = ["completed", "discarded"];
pub const GENERATION_FENCED_SESSION_PHASES: [&str; 5] = [
    "accept_requested",
    "discard_requested",
    "carbonize_required",
    "completed",
    "discarded",
];

const META_JOURNAL_BYTES: &str = "__journalBytes";
const META_NEXT_SEQ: &str = "__nextSeq";
const MOUNT_FAILURE_HISTORY: usize = 5;

pub struct SessionStore {
    pub root_dir: String,
    pub legacy_root_dir: String,
    pub session_id: Option<String>,
}

pub struct DerivedState {
    pub snapshot: Map<String, Value>,
    pub next_seq: i64,
    pub journal_path: String,
    pub size: i64,
}

fn journal_path(root: &str, id: &str) -> Result<String, String> {
    Ok(jsp::join(&[
        root,
        &format!("{}.jsonl", safe_session_id(id)?),
    ]))
}

fn snapshot_path(root: &str, id: &str) -> Result<String, String> {
    Ok(jsp::join(&[
        root,
        &format!("{}.snapshot.json", safe_session_id(id)?),
    ]))
}

fn file_size(p: &str) -> Option<i64> {
    std::fs::metadata(p).ok().map(|m| m.len() as i64)
}

/// JS: createLiveSessionStore({ cwd, sessionId })
pub fn create_live_session_store(cwd: &str, env: &Env, session_id: Option<&str>) -> SessionStore {
    let root_dir = live_sessions_dir(cwd, env);
    let legacy_root_dir = legacy_live_sessions_dir(cwd, env);
    let _ = std::fs::create_dir_all(&root_dir);
    SessionStore {
        root_dir,
        legacy_root_dir,
        session_id: session_id.map(String::from),
    }
}

impl SessionStore {
    fn readable_journal_path(&self, id: &str) -> Result<String, String> {
        let primary = journal_path(&self.root_dir, id)?;
        if exists(&primary) {
            return Ok(primary);
        }
        let legacy = journal_path(&self.legacy_root_dir, id)?;
        if exists(&legacy) {
            return Ok(legacy);
        }
        Ok(primary)
    }

    /// JS: readState(id, { allowSnapshotFile })
    pub fn read_state(&self, id: &str, allow_snapshot_file: bool) -> Result<DerivedState, String> {
        let journal = self.readable_journal_path(id)?;
        let size = file_size(&journal);
        if allow_snapshot_file {
            if let Some(sz) = size {
                if let Some((snapshot, next_seq)) =
                    read_snapshot_file(&snapshot_path(&self.root_dir, id)?, id, sz)
                {
                    return Ok(DerivedState {
                        snapshot,
                        next_seq,
                        journal_path: journal,
                        size: sz,
                    });
                }
            }
        }
        let (snapshot, next_seq) = rebuild_snapshot_from_journal(&journal, id);
        Ok(DerivedState {
            snapshot,
            next_seq,
            journal_path: journal,
            size: size.unwrap_or(-1),
        })
    }

    fn persist(
        &self,
        id: &str,
        snapshot: &Map<String, Value>,
        next_seq: i64,
    ) -> Result<(), String> {
        let sp = snapshot_path(&self.root_dir, id)?;
        let journal = self.readable_journal_path(id)?;
        let size = file_size(&journal).unwrap_or(-1);
        write_snapshot(&sp, snapshot, size, next_seq);
        Ok(())
    }

    /// JS: appendEvent(event). Returns the new snapshot.
    pub fn append_event(&self, event: &Value) -> Result<Map<String, Value>, String> {
        let normalized = normalize_event(event, self.session_id.as_deref())?;
        let id = normalized
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let ty = normalized
            .get("type")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let jp = journal_path(&self.root_dir, &id)?;
        let legacy = journal_path(&self.legacy_root_dir, &id)?;
        if !exists(&jp) && exists(&legacy) {
            let _ = std::fs::create_dir_all(jsp::dirname(&jp));
            let _ = std::fs::copy(&legacy, &jp);
        }
        let prior = self.read_state(&id, true)?;
        let entry = json!({
            "seq": prior.next_seq,
            "id": id,
            "type": ty,
            "ts": iso_now(),
            "event": Value::Object(normalized.clone()),
        });
        {
            use std::io::Write;
            let _ = std::fs::create_dir_all(jsp::dirname(&jp));
            let mut f = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&jp)
                .map_err(|e| e.to_string())?;
            let _ = f.write_all(
                format!("{}\n", serde_json::to_string(&entry).unwrap_or_default()).as_bytes(),
            );
        }
        let next = apply_event(&prior.snapshot, &entry);
        self.persist(&id, &next, prior.next_seq + 1)?;
        Ok(next)
    }

    /// JS: has(id)
    pub fn has(&self, id: &str) -> bool {
        if id.is_empty() {
            return false;
        }
        match (
            journal_path(&self.root_dir, id),
            journal_path(&self.legacy_root_dir, id),
        ) {
            (Ok(a), Ok(b)) => exists(&a) || exists(&b),
            _ => false,
        }
    }

    /// JS: getSnapshot(id, { includeCompleted }); None for terminal sessions
    /// unless `include_completed`.
    pub fn get_snapshot(
        &self,
        id: &str,
        include_completed: bool,
    ) -> Result<Option<Map<String, Value>>, String> {
        let state = self.read_state(id, true)?;
        let phase = state
            .snapshot
            .get("phase")
            .and_then(|p| p.as_str())
            .unwrap_or("");
        if !include_completed && COMPLETED_SESSION_PHASES.contains(&phase) {
            return Ok(None);
        }
        Ok(Some(state.snapshot))
    }

    /// JS: flush(id)
    pub fn flush(&self, id: &str) -> Result<Map<String, Value>, String> {
        let state = self.read_state(id, false)?;
        self.persist(id, &state.snapshot, state.next_seq)?;
        Ok(state.snapshot)
    }

    /// JS: listActiveSessions(): all `*.jsonl` ids in legacy + primary,
    /// sorted, non-terminal.
    pub fn list_active_sessions(&self) -> Vec<Map<String, Value>> {
        let mut ids: Vec<String> = Vec::new();
        for dir in [&self.legacy_root_dir, &self.root_dir] {
            if !exists(dir) {
                continue;
            }
            for name in read_dir_names_raw(dir).unwrap_or_default() {
                if let Some(id) = name.strip_suffix(".jsonl") {
                    if !ids.iter().any(|x| x == id) {
                        ids.push(id.to_string());
                    }
                }
            }
        }
        ids.sort();
        ids.iter()
            .filter_map(|id| self.get_snapshot(id, false).ok().flatten())
            .collect()
    }
}

fn read_snapshot_file(
    path: &str,
    id: &str,
    journal_bytes: i64,
) -> Option<(Map<String, Value>, i64)> {
    let text = safe_read(path)?;
    let parsed: Value = serde_json::from_str(&text).ok()?;
    let mut obj = parsed.as_object()?.clone();
    if obj.get(META_JOURNAL_BYTES).and_then(|v| v.as_i64()) != Some(journal_bytes) {
        return None;
    }
    let next_seq = obj.get(META_NEXT_SEQ).and_then(|v| v.as_i64())?;
    obj.remove(META_JOURNAL_BYTES);
    obj.remove(META_NEXT_SEQ);
    if obj.get("id").and_then(|v| v.as_str()) != Some(id) {
        return None;
    }
    let mut merged = base_snapshot(id);
    for (k, v) in obj {
        merged.insert(k, v);
    }
    Some((merged, next_seq))
}

fn normalize_event(event: &Value, fallback_id: Option<&str>) -> Result<Map<String, Value>, String> {
    let Some(obj) = event.as_object() else {
        return Err("event object required".to_string());
    };
    let id: Option<String> = match obj.get("id") {
        Some(Value::String(s)) if !s.is_empty() => Some(s.clone()),
        Some(v) if !matches!(v, Value::Null | Value::String(_)) && truthy(v) => {
            // JS: `event.id || fallbackId` then `typeof id !== 'string'` throws
            let _ = v;
            return Err("event id required".to_string());
        }
        _ => fallback_id.map(String::from),
    };
    let Some(id) = id else {
        return Err("event id required".to_string());
    };
    match obj.get("type") {
        Some(Value::String(t)) if !t.is_empty() => {}
        _ => return Err("event type required".to_string()),
    }
    let mut out = obj.clone();
    out.insert("id".to_string(), Value::String(id));
    Ok(out)
}

fn truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().map(|f| f != 0.0).unwrap_or(false),
        Value::String(s) => !s.is_empty(),
        _ => true,
    }
}

/// JS: baseSnapshot(id)
pub fn base_snapshot(id: &str) -> Map<String, Value> {
    let v = json!({
        "id": id,
        "phase": "new",
        "pageUrl": null,
        "sourceFile": null,
        "previewFile": null,
        "previewMode": null,
        "expectedVariants": 0,
        "arrivedVariants": 0,
        "visibleVariant": null,
        "paramValues": {},
        "pendingEventSeq": null,
        "pendingEvent": null,
        "deliveryLease": null,
        "checkpointRevision": 0,
        "browserCheckpointRevision": 0,
        "publicationCheckpointRevision": 0,
        "activeOwner": null,
        "sourceMarkers": {},
        "fallbackMode": null,
        "generationPhase": null,
        "generationCompletedAt": null,
        "generationTimings": {},
        "variantPlan": null,
        "generationCanceled": false,
        "generationCanceledAt": null,
        "cancelReason": null,
        "annotationArtifacts": [],
        "mountedVariants": [],
        "mountFailures": [],
        "renderState": null,
        "diagnostics": [],
        "updatedAt": null,
    });
    v.as_object().cloned().unwrap_or_default()
}

fn derive_render_state(s: &Map<String, Value>) -> Value {
    let mounted = s
        .get("mountedVariants")
        .and_then(|v| v.as_array())
        .map(|a| a.len())
        .unwrap_or(0);
    let failures = s
        .get("mountFailures")
        .and_then(|v| v.as_array())
        .map(|a| a.len())
        .unwrap_or(0);
    if mounted > 0 {
        return json!("mounted");
    }
    if failures > 0 {
        return json!("failed");
    }
    if truthy(s.get("generationCompletedAt").unwrap_or(&Value::Null)) {
        return json!("pending");
    }
    Value::Null
}

/// JS: rebuildSnapshotFromJournal(journalPath, id) -> (snapshot, nextSeq)
pub fn rebuild_snapshot_from_journal(journal_path: &str, id: &str) -> (Map<String, Value>, i64) {
    let mut snapshot = base_snapshot(id);
    let mut diagnostics: Vec<Value> = Vec::new();
    let mut next_seq: i64 = 1;
    let Some(text) = safe_read(journal_path) else {
        return (snapshot, next_seq);
    };
    for (i, line) in text.split('\n').enumerate() {
        if impeccable_context::util::js_trim(line).is_empty() {
            continue;
        }
        match serde_json::from_str::<Value>(line) {
            Ok(entry) if entry.is_object() => {
                if let Some(seq) = entry.get("seq").and_then(|s| s.as_i64()) {
                    next_seq = next_seq.max(seq + 1);
                }
                snapshot = apply_event(&snapshot, &entry);
            }
            Ok(_) => diagnostics.push(json!({ "error": "journal_parse_failed", "line": i + 1, "message": "entry is not object" })),
            Err(e) => diagnostics.push(json!({ "error": "journal_parse_failed", "line": i + 1, "message": e.to_string() })),
        }
    }
    if !diagnostics.is_empty() {
        let mut d = snapshot
            .get("diagnostics")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        d.extend(diagnostics);
        snapshot.insert("diagnostics".to_string(), Value::Array(d));
    }
    (snapshot, next_seq)
}

fn is_nullish(v: Option<&Value>) -> bool {
    matches!(v, None | Some(Value::Null))
}

/// `a ?? b`
fn coalesce<'a>(a: Option<&'a Value>, b: &'a Value) -> Value {
    match a {
        Some(v) if !v.is_null() => v.clone(),
        _ => b.clone(),
    }
}

fn get<'a>(m: &'a Map<String, Value>, k: &str) -> Option<&'a Value> {
    m.get(k)
}

fn ts_ms(entry: &Value) -> Option<i64> {
    // JS: Date.parse(entry.ts || '') || null
    let ts = entry.get("ts").and_then(|t| t.as_str()).unwrap_or("");
    date_parse_ms(ts).filter(|v| *v != 0)
}

fn to_pending_event(event: &Map<String, Value>) -> Value {
    let mut p = event.clone();
    p.shift_remove("token");
    Value::Object(p)
}

fn push_diag(next: &mut Map<String, Value>, d: Value) {
    let mut arr = next
        .get("diagnostics")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    arr.push(d);
    next.insert("diagnostics".to_string(), Value::Array(arr));
}

/// JS: applyEvent(snapshot, entry)
pub fn apply_event(snapshot: &Map<String, Value>, entry: &Value) -> Map<String, Value> {
    let event: Map<String, Value> = match entry.get("event") {
        Some(Value::Object(o)) => o.clone(),
        Some(_) | None => entry.as_object().cloned().unwrap_or_default(),
    };
    let mut next = snapshot.clone();
    // Spread copies (JS: fresh objects for the mutable containers).
    for k in ["paramValues", "sourceMarkers", "generationTimings"] {
        let v = next
            .get(k)
            .and_then(|v| v.as_object())
            .cloned()
            .unwrap_or_default();
        next.insert(k.to_string(), Value::Object(v));
    }
    let vp = next.get("variantPlan").cloned().unwrap_or(Value::Null);
    next.insert(
        "variantPlan".to_string(),
        if truthy(&vp) { vp } else { Value::Null },
    );
    for k in [
        "annotationArtifacts",
        "mountedVariants",
        "mountFailures",
        "diagnostics",
    ] {
        let v = next
            .get(k)
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        next.insert(k.to_string(), Value::Array(v));
    }
    let rs = next.get("renderState").cloned().unwrap_or(Value::Null);
    next.insert("renderState".to_string(), rs);
    next.insert(
        "updatedAt".to_string(),
        coalesce(
            entry.get("ts").filter(|t| truthy(t)),
            &Value::String(iso_now()),
        ),
    );

    let ev = |k: &str| event.get(k);
    let evt_type = event
        .get("type")
        .and_then(|t| t.as_str())
        .unwrap_or("")
        .to_string();
    let phase_now = next
        .get("phase")
        .and_then(|p| p.as_str())
        .unwrap_or("")
        .to_string();
    let canceled = truthy(next.get("generationCanceled").unwrap_or(&Value::Null));
    let fenced = GENERATION_FENCED_SESSION_PHASES.contains(&phase_now.as_str());
    let seq = entry.get("seq").cloned();
    let now_or_ts = |entry: &Value| -> Value {
        match ts_ms(entry) {
            Some(ms) => json!(ms),
            None => json!(now_ms() as i64),
        }
    };

    macro_rules! set_if {
        ($k:expr, $v:expr) => {{
            let cur = next.get($k).cloned().unwrap_or(Value::Null);
            next.insert($k.to_string(), coalesce($v, &cur));
        }};
    }
    macro_rules! set {
        ($k:expr, $v:expr) => {
            next.insert($k.to_string(), $v);
        };
    }

    match evt_type.as_str() {
        "generate" => {
            set!("phase", json!("generate_requested"));
            set_if!("pageUrl", ev("pageUrl"));
            set_if!("expectedVariants", ev("count"));
            set_if!("pendingEventSeq", seq.as_ref());
            set!("pendingEvent", to_pending_event(&event));
            set!("variantPlan", Value::Null);
            set!("mountedVariants", json!([]));
            set!("mountFailures", json!([]));
            set!("renderState", Value::Null);
            if let Some(sp) = ev("screenshotPath").filter(|v| truthy(v)) {
                let mut arts = next
                    .get("annotationArtifacts")
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default();
                let exists_already = arts.iter().any(|a| {
                    a.get("path") == Some(sp)
                        && a.get("type").and_then(|t| t.as_str()) == Some("screenshot")
                });
                if !exists_already {
                    arts.push(json!({ "type": "screenshot", "path": sp }));
                }
                set!("annotationArtifacts", Value::Array(arts));
            }
        }
        "variant_plan" => {
            if !canceled && !fenced {
                set_if!("variantPlan", ev("plan"));
            }
        }
        "detector_waivers" => {
            if !canceled && !fenced {
                let mut w = next
                    .get("detectorWaivers")
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default();
                if let Some(arr) = ev("waivers").and_then(|v| v.as_array()) {
                    w.extend(arr.iter().cloned());
                }
                set!("detectorWaivers", Value::Array(w));
            }
        }
        "agent_phase" => {
            set_if!("generationPhase", ev("phase"));
            if let Some(phase) = ev("phase").filter(|v| truthy(v)) {
                let key = match phase {
                    Value::String(s) => s.clone(),
                    other => other.to_string(),
                };
                let at = match ev("at") {
                    Some(v) if !v.is_null() => v.clone(),
                    _ => ts_ms(entry).map(|ms| json!(ms)).unwrap_or(Value::Null),
                };
                let dur = coalesce(ev("durationMs"), &Value::Null);
                let mut timings = next
                    .get("generationTimings")
                    .and_then(|v| v.as_object())
                    .cloned()
                    .unwrap_or_default();
                timings.insert(key, json!({ "at": at, "durationMs": dur }));
                set!("generationTimings", Value::Object(timings));
            }
        }
        "variants_ready" | "agent_done" => {
            let carbonize = ev("carbonize") == Some(&Value::Bool(true));
            if (canceled || fenced)
                && !(evt_type == "agent_done" && carbonize && phase_now == "accept_requested")
            {
                push_diag(
                    &mut next,
                    json!({ "error": "late_generation_event_ignored", "type": evt_type, "phase": phase_now }),
                );
            } else {
                set!(
                    "phase",
                    json!(if carbonize {
                        "carbonize_required"
                    } else {
                        "variants_ready"
                    })
                );
                let at = match ev("at") {
                    Some(v) if !v.is_null() => v.clone(),
                    _ => now_or_ts(entry),
                };
                set!("generationCompletedAt", at);
                let sf = coalesce(
                    ev("sourceFile"),
                    &coalesce(ev("file"), next.get("sourceFile").unwrap_or(&Value::Null)),
                );
                set!("sourceFile", sf);
                set_if!("previewFile", ev("previewFile"));
                set_if!("previewMode", ev("previewMode"));
                let arrived = match ev("arrivedVariants") {
                    Some(v) if !v.is_null() => v.clone(),
                    _ => {
                        let expected = next.get("expectedVariants").cloned().unwrap_or(Value::Null);
                        if truthy(&expected) {
                            expected
                        } else {
                            let a = next.get("arrivedVariants").cloned().unwrap_or(Value::Null);
                            if truthy(&a) {
                                a
                            } else {
                                json!(0)
                            }
                        }
                    }
                };
                set!("arrivedVariants", arrived);
                set!("pendingEventSeq", Value::Null);
                set!("pendingEvent", Value::Null);
                if carbonize {
                    let file = match ev("file") {
                        Some(v) if truthy(v) => v.clone(),
                        _ => Value::Null,
                    };
                    push_diag(
                        &mut next,
                        json!({
                            "error": "carbonize_cleanup_required",
                            "file": file,
                            "message": "Accepted variant still has carbonize markers that must be folded into source CSS.",
                        }),
                    );
                }
                let rs = derive_render_state(&next);
                set!("renderState", rs);
            }
        }
        "variant_mounted" => {
            let variant = js_number(ev("variant"));
            match variant {
                Some(v) if v.fract() == 0.0 && v >= 1.0 => {
                    let v = v as i64;
                    let mut mounted: Vec<i64> = next
                        .get("mountedVariants")
                        .and_then(|m| m.as_array())
                        .map(|a| a.iter().filter_map(|x| x.as_i64()).collect())
                        .unwrap_or_default();
                    if !mounted.contains(&v) {
                        mounted.push(v);
                        mounted.sort();
                    }
                    set!("mountedVariants", json!(mounted));
                    let rs = derive_render_state(&next);
                    set!("renderState", rs);
                }
                _ => {
                    push_diag(
                        &mut next,
                        json!({ "error": "malformed_mount_ack", "type": evt_type, "variant": coalesce(ev("variant"), &Value::Null) }),
                    );
                }
            }
        }
        "variant_mount_failed" => {
            let variant = js_number(ev("variant"));
            match variant {
                Some(v) if v.fract() == 0.0 && v >= 1.0 => {
                    let mut failures = next
                        .get("mountFailures")
                        .and_then(|m| m.as_array())
                        .cloned()
                        .unwrap_or_default();
                    let at = match ev("at") {
                        Some(a) if !a.is_null() => a.clone(),
                        _ => now_or_ts(entry),
                    };
                    failures.push(json!({
                        "variant": v as i64,
                        "url": ev("url").and_then(|u| u.as_str()).map(|s| json!(s)).unwrap_or(Value::Null),
                        "error": ev("error").and_then(|u| u.as_str()).map(|s| json!(s)).unwrap_or(Value::Null),
                        "at": at,
                    }));
                    if failures.len() > MOUNT_FAILURE_HISTORY {
                        failures = failures[failures.len() - MOUNT_FAILURE_HISTORY..].to_vec();
                    }
                    set!("mountFailures", Value::Array(failures));
                    let rs = derive_render_state(&next);
                    set!("renderState", rs);
                    if !truthy(next.get("pendingEvent").unwrap_or(&Value::Null)) {
                        set!("pendingEvent", to_pending_event(&event));
                    }
                }
                _ => {
                    push_diag(
                        &mut next,
                        json!({ "error": "malformed_mount_ack", "type": evt_type, "variant": coalesce(ev("variant"), &Value::Null) }),
                    );
                }
            }
        }
        "checkpoint" => {
            if canceled || fenced {
                push_diag(
                    &mut next,
                    json!({ "error": "checkpoint_after_terminal_ignored", "phase": coalesce(ev("phase"), &Value::Null), "revision": coalesce(ev("revision"), &Value::Null) }),
                );
            } else {
                let publication = ev("revisionDomain").and_then(|v| v.as_str())
                    == Some("publication")
                    || (ev("reason").and_then(|v| v.as_str()) == Some("variants_progress")
                        && !truthy(ev("owner").unwrap_or(&Value::Null)));
                let domain = if publication {
                    "publication"
                } else {
                    "browser"
                };
                let field = if publication {
                    "publicationCheckpointRevision"
                } else {
                    "browserCheckpointRevision"
                };
                let current_revision: f64 = match next.get(field) {
                    Some(v) if !v.is_null() => js_number(Some(v)).unwrap_or(f64::NAN),
                    _ => {
                        if domain == "browser" {
                            match next.get("checkpointRevision") {
                                Some(v) if !v.is_null() => js_number(Some(v)).unwrap_or(f64::NAN),
                                _ => 0.0,
                            }
                        } else {
                            0.0
                        }
                    }
                };
                let rev_val = coalesce(ev("revision"), &json!(0));
                let rev_num = js_number(Some(&rev_val)).unwrap_or(f64::NAN);
                if rev_num >= current_revision {
                    set_if!("phase", ev("phase"));
                    let cur = next.get(field).cloned().unwrap_or(Value::Null);
                    let stored = coalesce(
                        ev("revision"),
                        &if current_revision.is_nan() {
                            cur
                        } else {
                            crate::util::js_num(current_revision)
                        },
                    );
                    set!(field, stored);
                    if domain == "browser" {
                        set_if!("checkpointRevision", ev("revision"));
                        set_if!("activeOwner", ev("owner"));
                    }
                    set_if!("arrivedVariants", ev("arrivedVariants"));
                    if domain == "browser" {
                        set_if!("visibleVariant", ev("visibleVariant"));
                    }
                    set_if!("sourceFile", ev("sourceFile"));
                    set_if!("previewFile", ev("previewFile"));
                    set_if!("previewMode", ev("previewMode"));
                    if domain == "browser" {
                        if let Some(pv) = ev("paramValues").filter(|v| truthy(v)) {
                            let copy = pv
                                .as_object()
                                .cloned()
                                .map(Value::Object)
                                .unwrap_or_else(|| json!({}));
                            set!("paramValues", copy);
                        }
                    }
                } else {
                    push_diag(
                        &mut next,
                        json!({ "error": "stale_checkpoint_ignored", "revision": ev("revision").cloned().unwrap_or(Value::Null), "revisionDomain": domain }),
                    );
                    // JS: `revision: event.revision` (undefined is dropped by JSON)
                    if is_nullish(ev("revision")) && ev("revision").is_none() {
                        if let Some(Value::Array(arr)) = next.get_mut("diagnostics") {
                            if let Some(Value::Object(last)) = arr.last_mut() {
                                last.shift_remove("revision");
                            }
                        }
                    }
                }
            }
        }
        "accept" | "accept_intent" => {
            set!("phase", json!("accept_requested"));
            set!("generationCanceled", json!(true));
            let at = match ev("at") {
                Some(a) if !a.is_null() => a.clone(),
                _ => now_or_ts(entry),
            };
            set!("generationCanceledAt", at);
            set!("cancelReason", json!("accept"));
            let vid = coalesce(
                ev("variantId"),
                next.get("visibleVariant").unwrap_or(&Value::Null),
            );
            let n = js_number(Some(&vid));
            set!(
                "visibleVariant",
                n.map(crate::util::js_num).unwrap_or(Value::Null)
            );
            if let Some(pv) = ev("paramValues").filter(|v| truthy(v)) {
                let copy = pv
                    .as_object()
                    .cloned()
                    .map(Value::Object)
                    .unwrap_or_else(|| json!({}));
                set!("paramValues", copy);
            }
            set_if!("pendingEventSeq", seq.as_ref());
            set!("pendingEvent", to_pending_event(&event));
        }
        "manual_edit_apply" => {
            set!("phase", json!("manual_edit_apply_requested"));
            set_if!("pageUrl", ev("pageUrl"));
            set_if!("pendingEventSeq", seq.as_ref());
            set!("pendingEvent", to_pending_event(&event));
        }
        "steer" => {
            set!("phase", json!("steer_requested"));
            set_if!("pageUrl", ev("pageUrl"));
            set_if!("pendingEventSeq", seq.as_ref());
            set!("pendingEvent", to_pending_event(&event));
        }
        "carbonize_cleanup" => {
            set!("phase", json!("carbonize_cleanup_requested"));
            set_if!("sourceFile", ev("file"));
            set_if!("pendingEventSeq", seq.as_ref());
            set!("pendingEvent", to_pending_event(&event));
        }
        "steer_done" => {
            set!("phase", json!("steer_done"));
            let sf = coalesce(
                ev("sourceFile"),
                &coalesce(ev("file"), next.get("sourceFile").unwrap_or(&Value::Null)),
            );
            set!("sourceFile", sf);
            set_if!("previewFile", ev("previewFile"));
            set_if!("previewMode", ev("previewMode"));
            // JS: next.message = event.message ?? next.message (key appears
            // even when undefined... no: assigning undefined creates the key,
            // JSON.stringify drops it).
            match ev("message") {
                Some(v) if !v.is_null() => {
                    set!("message", v.clone());
                }
                _ => {
                    if let Some(cur) = next.get("message").cloned() {
                        set!("message", cur);
                    }
                }
            }
            set!("pendingEventSeq", Value::Null);
            set!("pendingEvent", Value::Null);
        }
        "discard" => {
            set!("phase", json!("discard_requested"));
            set!("generationCanceled", json!(true));
            let at = match ev("at") {
                Some(a) if !a.is_null() => a.clone(),
                _ => now_or_ts(entry),
            };
            set!("generationCanceledAt", at);
            set!("cancelReason", json!("discard"));
            set_if!("pendingEventSeq", seq.as_ref());
            set!("pendingEvent", to_pending_event(&event));
        }
        "discarded" => {
            set!("phase", json!("discarded"));
            set!("pendingEventSeq", Value::Null);
            set!("pendingEvent", Value::Null);
        }
        "complete" => {
            set!("phase", json!("completed"));
            let sf = coalesce(
                ev("sourceFile"),
                &coalesce(ev("file"), next.get("sourceFile").unwrap_or(&Value::Null)),
            );
            set!("sourceFile", sf);
            set_if!("previewFile", ev("previewFile"));
            set_if!("previewMode", ev("previewMode"));
            set!("pendingEventSeq", Value::Null);
            set!("pendingEvent", Value::Null);
        }
        "agent_error" => {
            if canceled && ev("sourceEventType").and_then(|v| v.as_str()) == Some("generate") {
                push_diag(
                    &mut next,
                    json!({ "error": "late_generation_event_ignored", "type": evt_type, "phase": phase_now }),
                );
            } else {
                set!("phase", json!("agent_error"));
                set!("pendingEventSeq", Value::Null);
                set!("pendingEvent", Value::Null);
                let msg = match ev("message") {
                    Some(v) if truthy(v) => v.clone(),
                    _ => json!("unknown agent error"),
                };
                push_diag(&mut next, json!({ "error": "agent_error", "message": msg }));
            }
        }
        _ => {
            push_diag(
                &mut next,
                json!({ "error": "unknown_event_type", "type": ev("type").cloned().unwrap_or(Value::Null) }),
            );
            if ev("type").is_none() {
                if let Some(Value::Array(arr)) = next.get_mut("diagnostics") {
                    if let Some(Value::Object(last)) = arr.last_mut() {
                        last.shift_remove("type");
                    }
                }
            }
        }
    }
    next
}

fn write_snapshot(path: &str, snapshot: &Map<String, Value>, journal_bytes: i64, next_seq: i64) {
    let mut payload = snapshot.clone();
    payload.insert(META_JOURNAL_BYTES.to_string(), json!(journal_bytes));
    payload.insert(META_NEXT_SEQ.to_string(), json!(next_seq));
    let _ = crate::util::write_file(
        path,
        &format!("{}\n", crate::util::json_pretty(&Value::Object(payload))),
    );
}

/// The pending event's `id`/`type` as strings (helper for status/resume).
pub fn get_str<'a>(m: &'a Map<String, Value>, k: &str) -> Option<&'a str> {
    get(m, k).and_then(|v| v.as_str())
}
