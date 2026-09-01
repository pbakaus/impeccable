//! JS: live-inject.mjs -> `impeccable live-inject`. Insert / remove / check
//! the live script tag (or framework adapter) named by
//! `.impeccable/live/config.json`.

use crate::config::{resolve_files, validate_config, LiveConfig};
use crate::gitignore::ensure_live_git_ignores;
use crate::inject::tag_strategy::{insert_tag, patch_csp_meta, remove_tag, revert_csp_meta};
use crate::inject::{
    adapter_apply, adapter_remove, describe_inject_artifacts, framework_ignore_patterns,
    resolve_framework, resolve_source_traits,
};
use crate::journal::{
    clear_inject_journal, heal_inject_journal, healed_to_value, record_injection,
};
use crate::paths::resolve_live_config_path;
use crate::roots::enter_live_root;
use crate::util::{eprintln, exists, json_compact, jsp, println, read_json, safe_read, write_file};
use impeccable_common::Io;
use serde_json::{json, Map, Value};

const HELP: &str = "Usage: impeccable live-inject [options]

Insert or remove the live mode script tag in the project's HTML entry point.
Reads configuration from .impeccable/live/config.json.

Modes:
  --port PORT   Insert script tag pointing at http://localhost:PORT/live.js
  --remove      Remove the script tag (if present)
  --check       Print whether .impeccable/live/config.json exists and its content

Output (JSON):
  { ok, file, inserted|removed, config? }";

/// The verb entry: `enterLiveRoot()` then `injectCli()`.
pub fn run(args: &[String], io: &mut Io) -> i32 {
    let mut argv: Vec<String> = args.to_vec();
    if let Err(code) = enter_live_root(&mut argv, io) {
        return code;
    }
    inject_cli(&argv, io)
}

/// JS: injectCli() against an already-entered cwd.
pub fn inject_cli(args: &[String], io: &mut Io) -> i32 {
    let has = |flag: &str| args.iter().any(|a| a == flag);
    if has("--help") || has("-h") {
        println(io, HELP);
        return 0;
    }
    let cwd = io.cwd.to_string_lossy().into_owned();
    let env = io.env.clone();
    let config_path = resolve_live_config_path(&cwd, &env);

    if has("--check") {
        if !exists(&config_path) {
            println(
                io,
                &json_compact(
                    &json!({ "ok": false, "error": "config_missing", "path": config_path }),
                ),
            );
            return 0;
        }
        let text = safe_read(&config_path).unwrap_or_default();
        let cfg: Value = match serde_json::from_str(&text) {
            Ok(v) => v,
            Err(_) => {
                let msg = crate::json_error::json_parse_error(&text)
                    .unwrap_or_else(|| "Unexpected end of JSON input".to_string());
                println(
                    io,
                    &json_compact(
                        &json!({ "ok": false, "error": "config_invalid", "message": msg, "path": config_path }),
                    ),
                );
                return 0;
            }
        };
        if let Err(msg) = validate_config(&cfg) {
            println(
                io,
                &json_compact(
                    &json!({ "ok": false, "error": "config_invalid", "message": msg, "path": config_path }),
                ),
            );
            return 0;
        }
        println(
            io,
            &json_compact(&json!({ "ok": true, "config": cfg, "path": config_path })),
        );
        return 0;
    }

    if !exists(&config_path) {
        eprintln(
            io,
            &json_compact(&json!({ "ok": false, "error": "config_missing", "path": config_path })),
        );
        return 1;
    }
    let text = safe_read(&config_path).unwrap_or_default();
    let cfg: Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(_) => {
            // JS: JSON.parse throws out of injectCli (uncaught): stack on stderr, exit 1.
            let msg = crate::json_error::json_parse_error(&text)
                .unwrap_or_else(|| "Unexpected end of JSON input".to_string());
            eprintln(io, &format!("SyntaxError: {}", msg));
            return 1;
        }
    };
    if let Err(msg) = validate_config(&cfg) {
        eprintln(io, &format!("Error: {}", msg));
        return 1;
    }
    let config = LiveConfig { raw: cfg };
    let resolved_files = resolve_files(&cwd, &config);
    let resolved = resolve_framework(&cwd, Some(&config));
    let is_adapter = resolved.as_ref().map(|r| r.is_adapter()).unwrap_or(false);

    if has("--remove") {
        if let (true, Some(r)) = (is_adapter, resolved.as_ref()) {
            let adapter_result = adapter_remove(r, &cwd, Some(&config));
            let ok = !(adapter_result
                .get("error")
                .map(crate::inject::detect_utils::truthy)
                .unwrap_or(false));
            let (healed, _) = heal_inject_journal(&cwd, &[]);
            clear_inject_journal(&cwd);
            let mut out = Map::new();
            out.insert("ok".into(), json!(ok));
            out.insert("adapter".into(), json!(r.name.as_str()));
            out.insert("results".into(), json!([adapter_result]));
            if !healed.is_empty() {
                out.insert("healed".into(), healed_to_value(&healed));
            }
            println(io, &json_compact(&Value::Object(out)));
            return if ok { 0 } else { 1 };
        }
        let mut results: Vec<Value> = Vec::new();
        for rel in &resolved_files {
            let abs = jsp::resolve(&cwd, &[rel]);
            if !exists(&abs) {
                results.push(json!({ "file": rel, "error": "file_not_found" }));
                continue;
            }
            let content = safe_read(&abs).unwrap_or_default();
            let detagged = remove_tag(&content);
            let updated = revert_csp_meta(&detagged);
            if updated == content {
                results.push(json!({ "file": rel, "removed": false, "note": "no tag present" }));
                continue;
            }
            let _ = write_file(&abs, &updated);
            results.push(json!({ "file": rel, "removed": detagged != content, "cspReverted": updated != detagged }));
        }
        let (healed, _) = heal_inject_journal(&cwd, &[]);
        clear_inject_journal(&cwd);
        let mut out = Map::new();
        out.insert("ok".into(), json!(true));
        out.insert("results".into(), Value::Array(results));
        if !healed.is_empty() {
            out.insert("healed".into(), healed_to_value(&healed));
        }
        println(io, &json_compact(&Value::Object(out)));
        return 0;
    }

    // Insert mode: --port required (parseInt of the following arg).
    let port: Option<i64> = args
        .iter()
        .position(|a| a == "--port")
        .and_then(|i| args.get(i + 1))
        .and_then(|v| parse_int_prefix(v));
    let Some(port) = port else {
        eprintln(
            io,
            &json_compact(&json!({ "ok": false, "error": "missing_port" })),
        );
        return 1;
    };
    let mut token: Option<String> = args
        .iter()
        .position(|a| a == "--token")
        .and_then(|i| args.get(i + 1))
        .cloned()
        .filter(|t| !t.is_empty());
    if token.is_none() {
        if let Some(info) = read_json(&jsp::join(&[&cwd, ".impeccable", "live", "server.json"])) {
            let t = info
                .get("token")
                .filter(|v| crate::inject::detect_utils::truthy(v));
            let p = crate::util::js_number(info.get("port"));
            if let (Some(t), Some(p)) = (t, p) {
                if p == port as f64 {
                    token = match t {
                        Value::String(s) => Some(s.clone()),
                        other => Some(other.to_string()),
                    };
                }
            }
        }
    }

    let planned = describe_inject_artifacts(resolved.as_ref(), &resolved_files);
    let keep: Vec<String> = planned
        .iter()
        .filter_map(|a| a.get("path").and_then(|p| p.as_str()).map(String::from))
        .collect();
    let (healed, _) = heal_inject_journal(&cwd, &keep);

    let git_ignore = ensure_live_git_ignores(&cwd, &framework_ignore_patterns(resolved.as_ref()));
    if let Some(m) = read_json(&jsp::join(&[&cwd, ".impeccable", "live", "roots.json"])) {
        if let Some(repo_root) = m
            .get("repoRoot")
            .and_then(|r| r.as_str())
            .filter(|r| !r.is_empty())
        {
            if jsp::resolve(repo_root, &[]) != jsp::resolve(&cwd, &[]) {
                ensure_live_git_ignores(repo_root, &[]);
            }
        }
    }

    if let (true, Some(r)) = (is_adapter, resolved.as_ref()) {
        let adapter_result = adapter_apply(r, &cwd, port, token.as_deref(), Some(&config));
        let ok = !(adapter_result
            .get("error")
            .map(crate::inject::detect_utils::truthy)
            .unwrap_or(false));
        if ok {
            record_injection(
                &cwd,
                Some(r.name.as_str()),
                Some(port),
                &planned,
                std::process::id(),
            );
        }
        let mut out = Map::new();
        out.insert("ok".into(), json!(ok));
        out.insert("port".into(), json!(port));
        out.insert("adapter".into(), json!(r.name.as_str()));
        out.insert("gitIgnore".into(), git_ignore.to_value());
        out.insert("results".into(), json!([adapter_result]));
        if !healed.is_empty() {
            out.insert("healed".into(), healed_to_value(&healed));
        }
        println(io, &json_compact(&Value::Object(out)));
        return if ok { 0 } else { 1 };
    }

    let mut results: Vec<Value> = Vec::new();
    let mut written: Vec<String> = Vec::new();
    for rel in &resolved_files {
        let abs = jsp::resolve(&cwd, &[rel]);
        if !exists(&abs) {
            results.push(json!({ "file": rel, "error": "file_not_found" }));
            continue;
        }
        let content = safe_read(&abs).unwrap_or_default();
        let without_old = revert_csp_meta(&remove_tag(&content));
        let script_attrs = resolve_source_traits(rel).inject_script_attrs;
        let with_tag = insert_tag(
            &without_old,
            config.comment_syntax(),
            config.insert_before(),
            config.insert_after(),
            port,
            token.as_deref(),
            script_attrs,
        );
        if with_tag == without_old {
            let anchor = config
                .insert_before()
                .filter(|a| !a.is_empty())
                .or(config.insert_after());
            results.push(
                json!({ "file": rel, "error": "insertion_point_not_found", "anchor": anchor }),
            );
            continue;
        }
        let updated = patch_csp_meta(&with_tag, port);
        let _ = write_file(&abs, &updated);
        written.push(rel.clone());
        results.push(json!({ "file": rel, "inserted": true, "cspPatched": updated != with_tag }));
    }
    let any_inserted = !written.is_empty();
    let artifacts: Vec<Value> = planned
        .into_iter()
        .filter(|a| {
            a.get("path")
                .and_then(|p| p.as_str())
                .map(|p| written.iter().any(|w| w == p))
                .unwrap_or(false)
        })
        .collect();
    record_injection(
        &cwd,
        resolved.as_ref().map(|r| r.name.as_str()),
        Some(port),
        &artifacts,
        std::process::id(),
    );
    let mut out = Map::new();
    out.insert("ok".into(), json!(any_inserted));
    out.insert("port".into(), json!(port));
    out.insert("gitIgnore".into(), git_ignore.to_value());
    out.insert("results".into(), Value::Array(results));
    if !healed.is_empty() {
        out.insert("healed".into(), healed_to_value(&healed));
    }
    println(io, &json_compact(&Value::Object(out)));
    if any_inserted {
        0
    } else {
        1
    }
}

/// JS: parseInt(v, 10) → finite number or None.
fn parse_int_prefix(v: &str) -> Option<i64> {
    let f = impeccable_core::js::parse_int(v, 10);
    if f.is_finite() {
        Some(f as i64)
    } else {
        None
    }
}
