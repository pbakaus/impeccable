//! JS: lib/staleness-notice.mjs

use crate::jsp;
use crate::staleness::Finding;
use crate::util::{homedir, json_compact, json_pretty, read_json, safe_read, Env};
use serde_json::{Map, Value};

const RENOTIFY_INTERVAL_MS: f64 = 7.0 * 24.0 * 60.0 * 60.0 * 1000.0;

fn cache_path(env: &Env) -> String {
    match env.get("IMPECCABLE_STALENESS_CACHE").filter(|v| !v.is_empty()) {
        Some(p) => p.clone(),
        None => jsp::join(&[&homedir(env), ".impeccable", "staleness-check.json"]),
    }
}

fn read_cache(env: &Env) -> Map<String, Value> {
    // returns the `projects` map (JS keeps whole object but only uses .projects)
    if let Some(text) = safe_read(&cache_path(env)) {
        if let Ok(Value::Object(raw)) = serde_json::from_str::<Value>(&text) {
            if let Some(p) = raw.get("projects") {
                if crate::staleness::js_truthy(p) {
                    // raw.projects truthy: return the whole raw; we only need projects entries
                    return raw;
                }
            }
        }
    }
    let mut m = Map::new();
    m.insert("projects".into(), Value::Object(Map::new()));
    m
}

fn as_number(v: &Value) -> Option<f64> {
    v.as_f64()
}

fn prune_cache(cache: &Map<String, Value>, now: f64) -> Map<String, Value> {
    let mut projects = Map::new();
    if let Some(Value::Object(ps)) = cache.get("projects") {
        for (key, entries) in ps {
            let Some(obj) = entries.as_object() else { continue };
            let stamps: Vec<f64> = obj.values().filter_map(as_number).collect();
            if !stamps.is_empty() {
                let max = stamps.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
                if now - max < RENOTIFY_INTERVAL_MS {
                    projects.insert(key.clone(), entries.clone());
                }
            }
        }
    }
    let mut out = Map::new();
    out.insert("projects".into(), Value::Object(projects));
    out
}

fn write_cache(env: &Env, cache: &Map<String, Value>) {
    let fp = cache_path(env);
    let _ = std::fs::create_dir_all(jsp::dirname(&fp));
    let _ = std::fs::write(&fp, json_compact(&Value::Object(cache.clone())));
}

/// JS: stalenessCheckDisabled(roots)
pub fn staleness_check_disabled(env: &Env, roots: &[Option<&str>]) -> bool {
    if env.get("IMPECCABLE_NO_STALENESS_CHECK").map(|v| !v.is_empty()).unwrap_or(false) {
        return true;
    }
    let mut value: Option<bool> = None;
    for root in roots {
        let Some(root) = root else { continue };
        if root.is_empty() {
            continue;
        }
        for name in ["config.json", "config.local.json"] {
            if let Some(raw) = read_json(&jsp::join(&[root, ".impeccable", name])) {
                if let Some(b) = raw.as_object().and_then(|o| o.get("stalenessCheck")).and_then(|v| v.as_bool()) {
                    value = Some(b);
                }
            }
        }
    }
    value == Some(false)
}

/// JS: filterFreshFindings(findings, { projectRoot, now })
pub fn filter_fresh_findings(env: &Env, findings: Vec<Finding>, project_root: &str, now: f64) -> Vec<Finding> {
    if findings.is_empty() {
        return vec![];
    }
    let auto: Vec<Finding> = findings.iter().filter(|f| f.severity == "auto").cloned().collect();
    let notifiable: Vec<Finding> = findings.iter().filter(|f| f.severity != "auto").cloned().collect();
    if notifiable.is_empty() {
        return auto;
    }
    let key = jsp::resolve(project_root, &[]);
    let cache = read_cache(env);
    let seen: Map<String, Value> = cache
        .get("projects")
        .and_then(|p| p.as_object())
        .and_then(|p| p.get(&key))
        .and_then(|v| v.as_object())
        .cloned()
        .unwrap_or_default();
    let fresh: Vec<Finding> = notifiable
        .iter()
        .filter(|f| match seen.get(&f.id).and_then(as_number) {
            Some(last) => !(now - last < RENOTIFY_INTERVAL_MS),
            None => true,
        })
        .cloned()
        .collect();
    let live: Vec<&str> = notifiable.iter().map(|f| f.id.as_str()).collect();
    let mut next = Map::new();
    for (id, v) in &seen {
        if live.contains(&id.as_str()) {
            next.insert(id.clone(), v.clone());
        }
    }
    for f in &fresh {
        next.insert(f.id.clone(), Value::from(now as i64));
    }
    let changed = json_compact(&Value::Object(next.clone())) != json_compact(&Value::Object(seen.clone()));
    if changed {
        let mut pruned = prune_cache(&cache, now);
        if let Some(Value::Object(ps)) = pruned.get_mut("projects") {
            ps.insert(key.clone(), Value::Object(next));
        }
        write_cache(env, &pruned);
    }
    let mut out = auto;
    out.extend(fresh);
    out
}

/// JS: buildStalenessDirective(findings)
///
/// `command` is the skill command the user types (`/impeccable`, or
/// `$impeccable` on Codex): the fixed sentence names `<command> doctor`.
pub fn build_staleness_directive(findings: &[Finding], command: &str) -> Option<String> {
    if findings.is_empty() {
        return None;
    }
    let payload: Vec<Value> = findings.iter().map(|f| f.to_value()).collect();
    let has_reportable = findings.iter().any(|f| f.severity != "auto");
    let mut lines = vec![format!("CONTEXT_STALE:\n{}", json_pretty(&Value::Array(payload)))];
    if has_reportable {
        // One fixed sentence, like UPDATE_AVAILABLE: a paraphrase drifts per
        // model, and a model that lists the findings tends to repair them as
        // a side effect of the design task. It leads the block because a
        // model that skims takes the first imperative it meets.
        lines.push(format!(
            "End your final reply to the user with this exact sentence as its last line: \"Impeccable found setup issues in your project. Run `{} doctor` to see them. Fixing them lets Impeccable catch design problems as you build.\" Say it once, do not list the findings, do not run doctor or any repair unless the user asks, and do not raise this again.",
            command
        ));
    }
    lines.extend([
        "Impeccable's own project files have drifted from what this version reads. Do not stop, reorder, or expand the requested task for any of these findings.".to_string(),
        "By severity: `auto` is a migration the next write to that file performs anyway, so apply it then and do not raise it with the user. `mention` and `route` reach the user only through that fixed sentence; doctor owns their details and fixes.".to_string(),
        "A finding that reports a deprecated field is binding: treat that field as absent for every decision in this session, whatever value it holds.".to_string(),
    ]);
    Some(lines.join(" "))
}
