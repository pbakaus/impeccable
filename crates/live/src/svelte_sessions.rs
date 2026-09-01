//! JS: live/svelte-component.mjs, the legacy deferred-accept record the
//! helper server applies at startup (`applyDeferredSvelteComponentAccepts`).
//! The session-directory helpers themselves (manifest lookup, sweeps,
//! publish revisions, compile check) live in `svelte_component`.

use crate::svelte_component::{find_svelte_component_manifest, inline_svelte_component_accept};
use crate::util::{jsp, read_json, Env};
use serde_json::{json, Value};

/// JS: deferredAcceptsPath(cwd)
pub fn deferred_accepts_path(cwd: &str, env: &Env) -> String {
    use sha1::{Digest, Sha1};
    let abs = jsp::resolve(cwd, &[]);
    let mut h = Sha1::new();
    h.update(abs.as_bytes());
    let hex: String = h.finalize().iter().map(|b| format!("{:02x}", b)).collect();
    let key: String = hex.chars().take(16).collect();
    jsp::join(&[
        &tmpdir(env),
        "impeccable-live",
        &key,
        "deferred-svelte-component-accepts.json",
    ])
}

/// `os.tmpdir()`
pub fn tmpdir(env: &Env) -> String {
    #[cfg(windows)]
    {
        // Node: TEMP || TMP || (SystemRoot || windir) + '\\temp', then one
        // trailing backslash dropped unless it is a drive root (`C:\`).
        let mut path = ["TEMP", "TMP"]
            .iter()
            .find_map(|k| env.get(*k).filter(|v| !v.is_empty()).cloned())
            .unwrap_or_else(|| {
                let root = env
                    .get("SystemRoot")
                    .or_else(|| env.get("windir"))
                    .cloned()
                    .unwrap_or_default();
                format!("{}\\temp", root)
            });
        if path.len() > 1 && path.ends_with('\\') && !path.ends_with(":\\") {
            path.pop();
        }
        path
    }
    #[cfg(not(windows))]
    {
        for k in ["TMPDIR", "TMP", "TEMP"] {
            if let Some(v) = env.get(k).filter(|v| !v.is_empty()) {
                let t = if v.len() > 1 && v.ends_with('/') {
                    v.trim_end_matches('/').to_string()
                } else {
                    v.clone()
                };
                return t;
            }
        }
        "/tmp".to_string()
    }
}

fn js_str(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Null => "null".to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => n
            .as_f64()
            .map(impeccable_context::util::js_number_to_string)
            .unwrap_or_default(),
        other => other.to_string(),
    }
}

/// JS: applyDeferredSvelteComponentAccepts(cwd) -> `{ applied, failed, results }`
pub fn apply_deferred_svelte_component_accepts(cwd: &str, env: &Env) -> Value {
    let file = deferred_accepts_path(cwd, env);
    let data = read_json(&file).unwrap_or_else(|| json!({ "accepts": [] }));
    let pending: Vec<Value> = data
        .get("accepts")
        .and_then(|a| a.as_array())
        .cloned()
        .unwrap_or_default();
    let mut results: Vec<Value> = Vec::new();
    let mut remaining: Vec<Value> = Vec::new();
    for entry in pending {
        let id_val = entry.get("id").cloned().unwrap_or(Value::Null);
        let id = js_str(&id_val);
        let manifest = match find_svelte_component_manifest(&id, cwd) {
            Ok(m) => m,
            Err(e) => {
                results.push(json!({ "id": id_val, "ok": false, "error": e }));
                remaining.push(entry);
                continue;
            }
        };
        let Some(manifest) = manifest else {
            results.push(json!({ "id": id_val, "ok": false, "error": "manifest not found" }));
            remaining.push(entry);
            continue;
        };
        let variant = js_str(entry.get("variantNum").unwrap_or(&Value::Null));
        let params = entry.get("paramValues").and_then(|p| p.as_object());
        match inline_svelte_component_accept(&manifest, &variant, params, cwd) {
            Ok(result) => {
                let ok = result.get("handled") != Some(&Value::Bool(false));
                results.push(json!({ "id": id_val, "ok": ok, "result": result }));
                if !ok {
                    remaining.push(entry);
                }
            }
            Err(e) => {
                results.push(json!({ "id": id_val, "ok": false, "error": e }));
                remaining.push(entry);
            }
        }
    }
    if !remaining.is_empty() {
        let _ = std::fs::write(
            &file,
            format!(
                "{}\n",
                crate::util::json_pretty(&json!({ "accepts": remaining }))
            ),
        );
    } else {
        let _ = std::fs::remove_file(&file);
    }
    let applied = results
        .iter()
        .filter(|r| r.get("ok") == Some(&Value::Bool(true)))
        .count();
    let failed = results.len() - applied;
    json!({ "applied": applied, "failed": failed, "results": results })
}
