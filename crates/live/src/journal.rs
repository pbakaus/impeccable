//! JS: live/frameworks/journal.mjs. Crash-safe injection journal at
//! `.impeccable/live/inject-journal.json`: what inject wrote, so a later
//! inject or `--remove` can heal orphans left by a session that never
//! stopped.

use crate::inject::undo_patch;
use crate::util::{
    dir_entry_count, inside_project, iso_now, json_pretty, jsp, read_json, safe_read, write_file,
};
use serde_json::{json, Map, Value};

pub const INJECT_JOURNAL_VERSION: i64 = 1;
pub const INJECT_JOURNAL_RELPATH: &str = ".impeccable/live/inject-journal.json";

/// JS: injectJournalPath(cwd)
pub fn inject_journal_path(cwd: &str) -> String {
    jsp::join(&[cwd, ".impeccable", "live", "inject-journal.json"])
}

/// JS: readInjectJournal(cwd): the parsed journal when it is an object with
/// an `artifacts` array.
pub fn read_inject_journal(cwd: &str) -> Option<Map<String, Value>> {
    let raw = read_json(&inject_journal_path(cwd))?;
    let obj = raw.as_object()?;
    if !obj.get("artifacts").map(|a| a.is_array()).unwrap_or(false) {
        return None;
    }
    Some(obj.clone())
}

/// JS: clearInjectJournal(cwd)
pub fn clear_inject_journal(cwd: &str) {
    let _ = std::fs::remove_file(inject_journal_path(cwd));
}

fn write_inject_journal(cwd: &str, journal: &Value) -> String {
    let file = inject_journal_path(cwd);
    let _ = write_file(&file, &format!("{}\n", json_pretty(journal)));
    file
}

/// JS: recordInjection(cwd, { framework, port, artifacts })
pub fn record_injection(
    cwd: &str,
    framework: Option<&str>,
    port: Option<i64>,
    artifacts: &[Value],
    pid: u32,
) -> Option<String> {
    if artifacts.is_empty() {
        clear_inject_journal(cwd);
        return None;
    }
    let journal = json!({
        "version": INJECT_JOURNAL_VERSION,
        "appRoot": jsp::resolve(cwd, &[]),
        "framework": framework,
        "port": port,
        "pid": pid,
        "recordedAt": iso_now(),
        "artifacts": artifacts,
    });
    Some(write_inject_journal(cwd, &journal))
}

fn normalize_rel(cwd: &str, rel: &str) -> String {
    jsp::to_posix(&jsp::resolve(cwd, &[rel]))
}

/// JS: pruneEmptyDirs(dir, stopDir) (journal flavour: `startsWith(stop + '/')`).
fn prune_empty_dirs(dir: &str, stop_dir: &str) {
    let mut current = jsp::resolve(dir, &[]);
    let stop = jsp::resolve(stop_dir, &[]);
    while current != stop && current.starts_with(&format!("{}{}", stop, jsp::SEP)) {
        match dir_entry_count(&current) {
            Some(0) => {
                if std::fs::remove_dir(&current).is_err() {
                    return;
                }
            }
            _ => return,
        }
        current = jsp::dirname(&current);
    }
}

/// One healed-artifact outcome `{ path, action }`.
#[derive(Debug, Clone)]
pub struct HealOutcome {
    pub path: String,
    pub action: &'static str,
}

fn heal_artifact(cwd: &str, artifact: &Value) -> Option<HealOutcome> {
    let path = artifact.get("path")?.as_str()?.to_string();
    let abs = jsp::resolve(cwd, &[&path]);
    if !inside_project(cwd, &abs) {
        return Some(HealOutcome {
            path,
            action: "refused_outside_project",
        });
    }
    let content = safe_read(&abs)?;
    let kind = artifact.get("kind").and_then(|k| k.as_str()).unwrap_or("");
    if kind == "created" {
        let marker = artifact
            .get("marker")
            .and_then(|m| m.as_str())
            .unwrap_or("");
        if marker.is_empty() || !content.contains(marker) {
            return Some(HealOutcome {
                path,
                action: "disowned",
            });
        }
        if std::fs::remove_file(&abs).is_err() {
            return None;
        }
        if let Some(prune_to) = artifact.get("pruneTo") {
            let prune_str = match prune_to {
                Value::String(s) if !s.is_empty() => s.as_str(),
                _ => ".",
            };
            let prune_root = jsp::resolve(cwd, &[prune_str]);
            if inside_project(cwd, &prune_root) || prune_root == jsp::resolve(cwd, &[]) {
                prune_empty_dirs(&jsp::dirname(&abs), &prune_root);
            }
        }
        return Some(HealOutcome {
            path,
            action: "removed",
        });
    }
    if kind == "patched" {
        let markers: Vec<&str> = artifact
            .get("markers")
            .and_then(|m| m.as_array())
            .map(|a| a.iter().filter_map(|v| v.as_str()).collect())
            .unwrap_or_default();
        if !markers.is_empty() && !markers.iter().any(|m| content.contains(m)) {
            return Some(HealOutcome {
                path,
                action: "disowned",
            });
        }
        let patch = artifact.get("patch").and_then(|p| p.as_str()).unwrap_or("");
        let next = undo_patch(patch, &content)?;
        if next == content {
            return Some(HealOutcome {
                path,
                action: "disowned",
            });
        }
        if write_file(&abs, &next).is_err() {
            return None;
        }
        return Some(HealOutcome {
            path,
            action: "unpatched",
        });
    }
    None
}

/// JS: healInjectJournal(cwd, { keep }) -> { healed, kept }
pub fn heal_inject_journal(cwd: &str, keep: &[String]) -> (Vec<HealOutcome>, Vec<Value>) {
    let Some(journal) = read_inject_journal(cwd) else {
        return (vec![], vec![]);
    };
    let keep_set: Vec<String> = keep.iter().map(|k| normalize_rel(cwd, k)).collect();
    let mut healed = Vec::new();
    let mut kept: Vec<Value> = Vec::new();
    for artifact in journal
        .get("artifacts")
        .and_then(|a| a.as_array())
        .cloned()
        .unwrap_or_default()
    {
        let Some(path) = artifact.get("path").and_then(|p| p.as_str()) else {
            continue;
        };
        if keep_set.contains(&normalize_rel(cwd, path)) {
            kept.push(artifact.clone());
            continue;
        }
        if let Some(outcome) = heal_artifact(cwd, &artifact) {
            if outcome.action == "removed" || outcome.action == "unpatched" {
                healed.push(outcome);
            }
        }
    }
    if !kept.is_empty() {
        let mut next = journal.clone();
        next.insert("artifacts".to_string(), Value::Array(kept.clone()));
        write_inject_journal(cwd, &Value::Object(next));
    } else {
        clear_inject_journal(cwd);
    }
    (healed, kept)
}

pub fn healed_to_value(healed: &[HealOutcome]) -> Value {
    Value::Array(
        healed
            .iter()
            .map(|h| json!({ "path": h.path, "action": h.action }))
            .collect(),
    )
}
