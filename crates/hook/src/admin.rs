//! JS: skill/scripts/hook-admin.mjs (`impeccable hooks` / `hook-admin`):
//! status, on, off, ignore-rule, ignore-file, ignore-value, reset over
//! `.impeccable/config.json` / `config.local.json`, plus the harness manifest
//! repair `on` performs. Manifests are written as JSON with 2-space
//! indentation and a trailing newline, in the JS key order.
//!
//! Where the JS wrote `node "<skill>/scripts/hook.mjs"`, the binary writes
//! `"<skill>/scripts/impeccable" hook`: the launcher shipped next to the
//! skill picks the platform binary, so no Node is needed. Old `.mjs`
//! manifests are still recognized (`impeccable_context::hook_markers`) so
//! `on` repairs them to the new form and `off` prunes either.

use impeccable_core::js;
use serde_json::{Map, Value};

use crate::hook_lib::*;
use crate::util::{exists, iso_now, js_str_cmp, js_string, json_pretty, jsp, obj_field, safe_read};

const ACTIONS: &[&str] = &[
    "status",
    "on",
    "off",
    "ignore-rule",
    "ignore-file",
    "ignore-value",
    "reset",
];
const TIMEOUT_SECONDS: i64 = 5;
const STATUS_MESSAGE: &str = "Checking UI changes";
const STOP_TIMEOUT_SECONDS: i64 = 30;
const STOP_STATUS_MESSAGE: &str = "Design deep pass";
const DETECTOR_CONFIG_KEYS: &[&str] = &[
    "ignoreRules",
    "ignoreFiles",
    "ignoreValues",
    "designSystem",
    "advisoryRules",
];

fn obj(pairs: Vec<(&str, Value)>) -> Value {
    let mut m = Map::new();
    for (k, v) in pairs {
        m.insert(k.to_string(), v);
    }
    Value::Object(m)
}

fn command_hook(command: &str, timeout: i64, status: &str) -> Value {
    obj(vec![
        ("type", Value::from("command")),
        ("command", Value::from(command)),
        ("timeout", Value::from(timeout)),
        ("statusMessage", Value::from(status)),
    ])
}

/// A command hook with the `commandWindows` sibling Codex 0.146.0+ selects
/// on Windows (`command_windows.unwrap_or(command)`), pointing at the
/// launcher's `.cmd` shim so the same `.codex/hooks.json` runs on every OS.
fn command_hook_with_windows(command: &str, windows: &str, timeout: i64, status: &str) -> Value {
    obj(vec![
        ("type", Value::from("command")),
        ("command", Value::from(command)),
        ("commandWindows", Value::from(windows)),
        ("timeout", Value::from(timeout)),
        ("statusMessage", Value::from(status)),
    ])
}

/// JS: stopManifestEntry(command)
fn stop_manifest_entry(command: &str) -> Value {
    obj(vec![(
        "hooks",
        Value::Array(vec![command_hook(
            command,
            STOP_TIMEOUT_SECONDS,
            STOP_STATUS_MESSAGE,
        )]),
    )])
}

fn stop_manifest_entry_with_windows(command: &str, windows: &str) -> Value {
    obj(vec![(
        "hooks",
        Value::Array(vec![command_hook_with_windows(
            command,
            windows,
            STOP_TIMEOUT_SECONDS,
            STOP_STATUS_MESSAGE,
        )]),
    )])
}

/// The launcher paths the manifests invoke, per harness. Project-relative
/// (or `${CLAUDE_PROJECT_DIR}` / repo-root anchored) so a committed manifest
/// resolves on every teammate's checkout.
const CLAUDE_HOOK_COMMAND: &str = "\"${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts/impeccable\" hook";
const AGENTS_HOOK_COMMAND: &str = "\".agents/skills/impeccable/scripts/impeccable\" hook";
const AGENTS_HOOK_COMMAND_WINDOWS: &str = "\".agents/skills/impeccable/scripts/impeccable.cmd\" hook";
const CURSOR_HOOK_COMMAND: &str = "\".cursor/skills/impeccable/scripts/impeccable\" hook-before-edit";
const GITHUB_HOOK_COMMAND: &str = "\"$(git rev-parse --show-toplevel)/.github/skills/impeccable/scripts/impeccable\" hook";

struct ManifestTarget {
    provider: &'static str,
    skill_rel: &'static str,
    dest_rel: &'static str,
    shared_dest_rel: Option<&'static str>,
    manifest: fn() -> Value,
}

fn claude_manifest() -> Value {
    let cmd = CLAUDE_HOOK_COMMAND;
    obj(vec![
        (
            "description",
            // JS: Claude Code folded multi-edit behavior into Edit; the manifest
            // tracks the current Edit and Write tools (upstream 7d5c60d2).
            Value::from("Impeccable design detector: immediate-tier checks after Edit/Write on UI files, full-rule deep pass on Stop."),
        ),
        (
            "hooks",
            obj(vec![
                (
                    "PostToolUse",
                    Value::Array(vec![obj(vec![
                        ("matcher", Value::from("Edit|Write")),
                        ("hooks", Value::Array(vec![command_hook(cmd, TIMEOUT_SECONDS, STATUS_MESSAGE)])),
                    ])]),
                ),
                ("Stop", Value::Array(vec![stop_manifest_entry(cmd)])),
            ]),
        ),
    ])
}

fn agents_manifest() -> Value {
    let cmd = AGENTS_HOOK_COMMAND;
    let win = AGENTS_HOOK_COMMAND_WINDOWS;
    obj(vec![(
        "hooks",
        obj(vec![
            (
                "PostToolUse",
                Value::Array(vec![obj(vec![
                    ("matcher", Value::from("Edit|Write|apply_patch")),
                    (
                        "hooks",
                        Value::Array(vec![command_hook_with_windows(cmd, win, TIMEOUT_SECONDS, STATUS_MESSAGE)]),
                    ),
                ])]),
            ),
            ("Stop", Value::Array(vec![stop_manifest_entry_with_windows(cmd, win)])),
        ]),
    )])
}

fn cursor_manifest() -> Value {
    obj(vec![
        ("version", Value::from(1)),
        (
            "hooks",
            obj(vec![(
                "preToolUse",
                Value::Array(vec![obj(vec![
                    (
                        "command",
                        Value::from(CURSOR_HOOK_COMMAND),
                    ),
                    ("timeout", Value::from(TIMEOUT_SECONDS)),
                ])]),
            )]),
        ),
    ])
}

fn github_manifest() -> Value {
    obj(vec![
        ("version", Value::from(1)),
        (
            "hooks",
            obj(vec![(
                "postToolUse",
                Value::Array(vec![obj(vec![
                    ("type", Value::from("command")),
                    ("matcher", Value::from("edit|create|apply_patch")),
                    (
                        "bash",
                        Value::from(GITHUB_HOOK_COMMAND),
                    ),
                    ("timeoutSec", Value::from(TIMEOUT_SECONDS)),
                ])]),
            )]),
        ),
    ])
}

const HOOK_MANIFEST_TARGETS: &[ManifestTarget] = &[
    ManifestTarget {
        provider: ".claude",
        skill_rel: ".claude/skills/impeccable",
        dest_rel: ".claude/settings.local.json",
        shared_dest_rel: Some(".claude/settings.json"),
        manifest: claude_manifest,
    },
    ManifestTarget {
        provider: ".agents",
        skill_rel: ".agents/skills/impeccable",
        dest_rel: ".codex/hooks.json",
        shared_dest_rel: None,
        manifest: agents_manifest,
    },
    ManifestTarget {
        provider: ".cursor",
        skill_rel: ".cursor/skills/impeccable",
        dest_rel: ".cursor/hooks.json",
        shared_dest_rel: None,
        manifest: cursor_manifest,
    },
    ManifestTarget {
        provider: ".github",
        skill_rel: ".github/skills/impeccable",
        dest_rel: ".github/hooks/impeccable.json",
        shared_dest_rel: None,
        manifest: github_manifest,
    },
];

struct RawFile {
    exists: bool,
    malformed: bool,
    raw: Option<Value>,
}

/// JS: readRawConfigFile(filePath)
fn read_raw_config_file(path: &str) -> RawFile {
    if !exists(path) {
        return RawFile {
            exists: false,
            malformed: false,
            raw: None,
        };
    }
    match safe_read(path).and_then(|t| serde_json::from_str::<Value>(&t).ok()) {
        Some(v) => RawFile {
            exists: true,
            malformed: false,
            raw: Some(v),
        },
        None => RawFile {
            exists: true,
            malformed: true,
            raw: None,
        },
    }
}

fn config_file(cwd: &str, local: bool) -> String {
    if local {
        get_local_config_path(cwd)
    } else {
        get_config_path(cwd)
    }
}

/// JS: readRawHookConfig(cwd, opts)
fn read_raw_hook_config(cwd: &str, local: bool) -> Option<Map<String, Value>> {
    let unified = read_raw_config_file(&config_file(cwd, local)).raw;
    hook_section(unified.as_ref()).cloned()
}

/// JS: readRawDetectorConfig(cwd, opts)
fn read_raw_detector_config(cwd: &str, local: bool) -> Map<String, Value> {
    let unified = read_raw_config_file(&config_file(cwd, local)).raw;
    let merged = merge_detector_config(hook_section(unified.as_ref()), None);
    merge_detector_config(detector_section(unified.as_ref()), Some(&merged))
}

/// JS: stripDetectorKeys(raw)
fn strip_detector_keys(raw: Option<&Map<String, Value>>) -> Map<String, Value> {
    let mut out = Map::new();
    if let Some(raw) = raw {
        for (k, v) in raw {
            if !DETECTOR_CONFIG_KEYS.contains(&k.as_str()) {
                out.insert(k.clone(), v.clone());
            }
        }
    }
    out
}

/// JS: pickDetectorKeys(raw)
fn pick_detector_keys(raw: Option<&Map<String, Value>>) -> Map<String, Value> {
    let mut out = Map::new();
    if let Some(raw) = raw {
        for (k, v) in raw {
            if DETECTOR_CONFIG_KEYS.contains(&k.as_str()) {
                out.insert(k.clone(), v.clone());
            }
        }
    }
    out
}

fn existing_object(raw: Option<Value>) -> Map<String, Value> {
    match raw {
        Some(Value::Object(o)) => o,
        _ => Map::new(),
    }
}

fn write_json(path: &str, value: &Value) -> Result<(), String> {
    std::fs::create_dir_all(jsp::dirname(path)).map_err(|e| e.to_string())?;
    std::fs::write(path, format!("{}\n", json_pretty(value))).map_err(|e| e.to_string())
}

/// JS: writeHookConfig(cwd, hookConfig, opts)
fn write_hook_config(
    rt: &Runtime,
    cwd: &str,
    hook_config: &Map<String, Value>,
    local: bool,
) -> Result<String, String> {
    let file_path = config_file(cwd, local);
    if local {
        ensure_hook_git_excludes(rt, cwd);
    }
    let existing = existing_object(read_raw_config_file(&file_path).raw);
    let existing_hook_section = obj_field(&existing, "hook");
    let existing_hook = strip_detector_keys(existing_hook_section);
    let legacy_detector = pick_detector_keys(existing_hook_section);
    let mut next = existing.clone();
    let mut hook = existing_hook;
    for (k, v) in hook_config {
        hook.insert(k.clone(), v.clone());
    }
    next.insert("hook".into(), Value::Object(hook));
    if !legacy_detector.is_empty() {
        let existing_detector = obj_field(&existing, "detector")
            .cloned()
            .unwrap_or_default();
        let merged_legacy = merge_detector_config(Some(&legacy_detector), None);
        let merged = merge_detector_config(Some(&existing_detector), Some(&merged_legacy));
        let mut det = existing_detector;
        for (k, v) in merged {
            det.insert(k, v);
        }
        next.insert("detector".into(), Value::Object(det));
    }
    write_json(&file_path, &Value::Object(next))?;
    Ok(file_path)
}

/// JS: writeDetectorConfig(cwd, detectorConfig, opts)
fn write_detector_config(
    rt: &Runtime,
    cwd: &str,
    detector_config: &Map<String, Value>,
    local: bool,
) -> Result<String, String> {
    let file_path = config_file(cwd, local);
    if local {
        ensure_hook_git_excludes(rt, cwd);
    }
    let existing = existing_object(read_raw_config_file(&file_path).raw);
    let next_hook = strip_detector_keys(obj_field(&existing, "hook"));
    let existing_detector_section = obj_field(&existing, "detector")
        .cloned()
        .unwrap_or_default();
    let existing_detector = merge_detector_config(Some(&existing_detector_section), None);
    let merged = merge_detector_config(Some(detector_config), Some(&existing_detector));
    let mut next = existing.clone();
    let mut det = existing_detector_section;
    for (k, v) in merged {
        det.insert(k, v);
    }
    next.insert("detector".into(), Value::Object(det));
    if !next_hook.is_empty() {
        next.insert("hook".into(), Value::Object(next_hook));
    } else {
        next.shift_remove("hook");
    }
    write_json(&file_path, &Value::Object(next))?;
    Ok(file_path)
}

fn is_finite_number(v: Option<&Value>) -> bool {
    matches!(v, Some(Value::Number(n)) if n.as_f64().map(f64::is_finite).unwrap_or(false))
}

/// JS: mergeHookConfig(existing)
fn merge_hook_config(existing: Option<&Map<String, Value>>) -> Map<String, Value> {
    let base = existing.cloned().unwrap_or_default();
    let limits = obj_field(&base, "limits");
    let pick = |key: &str, fallback: f64| -> Value {
        match limits.and_then(|l| l.get(key)) {
            Some(v) if is_finite_number(Some(v)) => v.clone(),
            _ => Value::from(fallback as i64),
        }
    };
    let mut out = Map::new();
    out.insert(
        "enabled".into(),
        Value::Bool(base.get("enabled") != Some(&Value::Bool(false))),
    );
    let mut l = Map::new();
    l.insert(
        "maxFindings".into(),
        pick("maxFindings", DEFAULT_MAX_FINDINGS),
    );
    l.insert("maxChars".into(), pick("maxChars", DEFAULT_MAX_CHARS));
    out.insert("limits".into(), Value::Object(l));
    out
}

fn string_array(v: Option<&Value>) -> Option<Vec<String>> {
    match v {
        Some(Value::Array(list)) => Some(list.iter().map(js_string).collect()),
        _ => None,
    }
}

fn unique(values: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for v in values {
        if !out.contains(&v) {
            out.push(v);
        }
    }
    out
}

fn ignore_values_json(entries: &[impeccable_detect::config::IgnoreValueEntry]) -> Value {
    Value::Array(entries.iter().map(|e| e.to_json()).collect())
}

/// JS: mergeDetectorConfig(existing, seed)
fn merge_detector_config(
    existing: Option<&Map<String, Value>>,
    seed: Option<&Map<String, Value>>,
) -> Map<String, Value> {
    let base = existing.cloned().unwrap_or_default();
    let mut out = Map::new();
    let seed_values = |key: &str| -> Vec<Value> {
        match seed.and_then(|s| s.get(key)) {
            Some(Value::Array(a)) => a.clone(),
            _ => vec![],
        }
    };
    if seed.is_some() {
        out.insert(
            "ignoreRules".into(),
            Value::Array(seed_values("ignoreRules")),
        );
        out.insert(
            "ignoreFiles".into(),
            Value::Array(seed_values("ignoreFiles")),
        );
        out.insert(
            "ignoreValues".into(),
            ignore_values_json(&impeccable_detect::config::normalize_ignore_value_entries(
                &seed_values("ignoreValues"),
            )),
        );
    } else {
        out.insert("ignoreRules".into(), Value::Array(vec![]));
        out.insert("ignoreFiles".into(), Value::Array(vec![]));
        out.insert("ignoreValues".into(), Value::Array(vec![]));
    }
    if let Some(ds) = seed.and_then(|s| obj_field(s, "designSystem")) {
        out.insert("designSystem".into(), Value::Object(ds.clone()));
    }
    if let Some(Value::String(a)) = seed.and_then(|s| s.get("advisoryRules")) {
        if a == "include" || a == "exclude" {
            out.insert("advisoryRules".into(), Value::String(a.clone()));
        }
    }
    if let Some(ds) = obj_field(&base, "designSystem") {
        let mut merged = obj_field(&out, "designSystem").cloned().unwrap_or_default();
        merged.insert(
            "enabled".into(),
            Value::Bool(ds.get("enabled") != Some(&Value::Bool(false))),
        );
        out.insert("designSystem".into(), Value::Object(merged));
    }
    if let Some(Value::String(a)) = base.get("advisoryRules") {
        if a == "include" || a == "exclude" {
            out.insert("advisoryRules".into(), Value::String(a.clone()));
        }
    }
    if let Some(rules) = string_array(base.get("ignoreRules")) {
        let cur: Vec<String> = string_array(out.get("ignoreRules")).unwrap_or_default();
        let all = unique(cur.into_iter().chain(rules).collect());
        out.insert(
            "ignoreRules".into(),
            Value::Array(all.into_iter().map(Value::String).collect()),
        );
    }
    if let Some(files) = string_array(base.get("ignoreFiles")) {
        let cur: Vec<String> = string_array(out.get("ignoreFiles")).unwrap_or_default();
        let all = unique(cur.into_iter().chain(files).collect());
        out.insert(
            "ignoreFiles".into(),
            Value::Array(all.into_iter().map(Value::String).collect()),
        );
    }
    if let Some(Value::Array(incoming)) = base.get("ignoreValues") {
        let cur = match out.get("ignoreValues") {
            Some(Value::Array(a)) => a.clone(),
            _ => vec![],
        };
        let existing_entries = impeccable_detect::config::normalize_ignore_value_entries(&cur);
        let merged = merge_ignore_values(&existing_entries, incoming);
        out.insert("ignoreValues".into(), ignore_values_json(&merged));
    }
    out
}

/// JS: ignoreValueEntryKey(entry) on a raw JSON entry.
fn ignore_value_entry_key_json(entry: &Map<String, Value>) -> String {
    let files = match entry.get("files") {
        Some(Value::Array(f)) if !f.is_empty() => {
            let mut sorted: Vec<String> = f.iter().map(js_string).collect();
            sorted.sort_by(|a, b| js_str_cmp(a, b));
            sorted.join("\u{1f}")
        }
        _ => String::new(),
    };
    format!(
        "{}\0{}\0{}",
        entry.get("rule").map(js_string).unwrap_or_default(),
        entry.get("value").map(js_string).unwrap_or_default(),
        files
    )
}

/// JS: statusReport(cwd)
fn status_report(rt: &Runtime, cwd: &str) -> String {
    let shared = read_raw_config_file(&get_config_path(cwd));
    let local = read_raw_config_file(&get_local_config_path(cwd));
    let cfg = read_config(cwd);
    let env_state = match rt.env("IMPECCABLE_HOOK_DISABLED").filter(|v| !v.is_empty()) {
        Some(v) => format!("IMPECCABLE_HOOK_DISABLED={v}"),
        None => "unset".to_string(),
    };
    let rel = |p: &str, fallback: &str| -> String {
        let r = rt.relative(cwd, p);
        if r.is_empty() {
            fallback.to_string()
        } else {
            r
        }
    };
    let cfg_path = rel(&get_config_path(cwd), ".impeccable/config.json");
    let local_path = rel(&get_local_config_path(cwd), ".impeccable/config.local.json");
    let cache_path = rel(&get_cache_path(cwd), ".impeccable/hook.cache.json");
    let file_state = |info: &RawFile, rel_path: &str, absent: &str| -> String {
        if info.malformed {
            format!("{rel_path} (malformed; ignored)")
        } else if info.exists {
            rel_path.to_string()
        } else {
            format!("{rel_path} ({absent})")
        }
    };
    let ignore_values: Vec<String> = cfg
        .ignore_values
        .iter()
        .map(|e| {
            let scope = match &e.files {
                Some(f) if !f.is_empty() => format!(" [{}]", f.join(", ")),
                _ => String::new(),
            };
            format!("{}={}{}", e.rule, e.value, scope)
        })
        .collect();
    let list = |v: &[String]| {
        if v.is_empty() {
            "(none)".to_string()
        } else {
            v.join(", ")
        }
    };
    [
        "Impeccable design hook".to_string(),
        format!(
            "  state:        {}",
            if cfg.enabled { "enabled" } else { "disabled" }
        ),
        format!(
            "  shared file:  {}",
            file_state(&shared, &cfg_path, "using defaults; file not present")
        ),
        format!(
            "  local file:   {}",
            file_state(&local, &local_path, "not present")
        ),
        format!("  ignoreRules:  {}", list(&cfg.ignore_rules)),
        format!("  ignoreFiles:  {}", list(&cfg.ignore_files)),
        format!("  ignoreValues: {}", list(&ignore_values)),
        format!(
            "  maxFindings:  {}",
            js::number_to_string(cfg.limits.max_findings)
        ),
        format!(
            "  maxChars:     {}",
            js::number_to_string(cfg.limits.max_chars)
        ),
        format!("  env override: {env_state}"),
        format!(
            "  cache file:   {}",
            if exists(&get_cache_path(cwd)) {
                cache_path
            } else {
                format!("{cache_path} (not present)")
            }
        ),
    ]
    .join("\n")
}

fn rel_or(rt: &Runtime, cwd: &str, target: &str) -> String {
    let r = rt.relative(cwd, target);
    if r.is_empty() {
        target.to_string()
    } else {
        r
    }
}

/// JS: setEnabled(cwd, value)
fn set_enabled(rt: &Runtime, cwd: &str, value: bool) -> Result<String, String> {
    let mut config = merge_hook_config(read_raw_hook_config(cwd, false).as_ref());
    config.insert("enabled".into(), Value::Bool(value));
    let target = write_hook_config(rt, cwd, &config, false)?;
    if !value {
        return Ok(format!(
            "Design hook disabled for this project (wrote {}).",
            rel_or(rt, cwd, &target)
        ));
    }
    let mut consent = Map::new();
    consent.insert("consent".into(), Value::from("accepted"));
    let local_target = write_hook_config(rt, cwd, &consent, true)?;
    let repaired = repair_hook_manifests(cwd)?;
    let mut parts = vec![
        format!(
            "Design hook enabled for this project (wrote {}).",
            rel_or(rt, cwd, &target)
        ),
        format!(
            "Recorded local hook consent in {}.",
            rel_or(rt, cwd, &local_target)
        ),
    ];
    if !repaired.written.is_empty() {
        parts.push(format!(
            "Installed or repaired hook manifests for: {}.",
            repaired.written.join(", ")
        ));
    } else if !repaired.already.is_empty() {
        parts.push(format!(
            "Hook manifests already installed for: {}.",
            repaired.already.join(", ")
        ));
    } else {
        parts.push("No installed provider skill folders found to repair.".to_string());
    }
    if !repaired.backups.is_empty() {
        let names: Vec<String> = repaired
            .backups
            .iter()
            .map(|b| rel_or(rt, cwd, b))
            .collect();
        parts.push(format!(
            "Backed up malformed manifest(s): {}.",
            names.join(", ")
        ));
    }
    Ok(parts.join(" "))
}

struct Repaired {
    written: Vec<String>,
    already: Vec<String>,
    backups: Vec<String>,
}

/// JS: repairHookManifests(cwd)
fn repair_hook_manifests(cwd: &str) -> Result<Repaired, String> {
    let mut result = Repaired {
        written: vec![],
        already: vec![],
        backups: vec![],
    };
    for target in HOOK_MANIFEST_TARGETS {
        if !exists(&jsp::join(&[cwd, target.skill_rel])) {
            continue;
        }
        let dest = jsp::join(&[cwd, target.dest_rel]);
        let shared_dest = target.shared_dest_rel.map(|s| jsp::join(&[cwd, s]));
        if let Some(sd) = &shared_dest {
            if file_has_impeccable_hook_marker(sd) {
                prune_impeccable_hook_from_manifest(&dest)?;
                result.already.push(target.provider.to_string());
                continue;
            }
        }
        let fresh = (target.manifest)();
        let mut next = fresh.clone();
        if exists(&dest) {
            match safe_read(&dest).and_then(|t| serde_json::from_str::<Value>(&t).ok()) {
                Some(existing) => next = merge_hook_manifests(&existing, &fresh),
                None => {
                    let backup = format!("{dest}.bak");
                    std::fs::copy(&dest, &backup).map_err(|e| e.to_string())?;
                    result.backups.push(backup);
                }
            }
        }
        let serialized = format!("{}\n", json_pretty(&next));
        let current = if exists(&dest) {
            safe_read(&dest)
        } else {
            None
        };
        if current.as_deref() == Some(serialized.as_str()) {
            result.already.push(target.provider.to_string());
            continue;
        }
        std::fs::create_dir_all(jsp::dirname(&dest)).map_err(|e| e.to_string())?;
        std::fs::write(&dest, serialized).map_err(|e| e.to_string())?;
        result.written.push(target.provider.to_string());
    }
    Ok(result)
}

fn as_object(v: &Value) -> Map<String, Value> {
    match v {
        Value::Object(o) => o.clone(),
        _ => Map::new(),
    }
}

/// JS: mergeHookManifests(existing, fresh)
fn merge_hook_manifests(existing: &Value, fresh: &Value) -> Value {
    let existing_object = as_object(existing);
    let fresh_object = as_object(fresh);
    let existing_hooks = obj_field(&existing_object, "hooks")
        .cloned()
        .unwrap_or_default();
    let fresh_hooks = obj_field(&fresh_object, "hooks")
        .cloned()
        .unwrap_or_default();
    let mut merged = existing_object.clone();
    merged.insert("hooks".into(), Value::Object(Map::new()));
    if let Some(v) = fresh_object.get("version") {
        merged.insert("version".into(), v.clone());
    }
    if let Some(d) = fresh_object.get("description") {
        merged.insert("description".into(), d.clone());
    }
    let mut events: Vec<String> = existing_hooks.keys().cloned().collect();
    for k in fresh_hooks.keys() {
        if !events.contains(k) {
            events.push(k.clone());
        }
    }
    let mut hooks = Map::new();
    for event in events {
        let preserved = strip_impeccable_hook_entries(existing_hooks.get(&event));
        let added: Vec<Value> = match fresh_hooks.get(&event) {
            Some(Value::Array(a)) => a.clone(),
            _ => vec![],
        };
        let mut merged_entries = preserved;
        merged_entries.extend(added);
        if !merged_entries.is_empty() {
            hooks.insert(event, Value::Array(merged_entries));
        }
    }
    merged.insert("hooks".into(), Value::Object(hooks));
    Value::Object(merged)
}

/// JS: fileHasImpeccableHookMarker(filePath)
fn file_has_impeccable_hook_marker(path: &str) -> bool {
    if !exists(path) {
        return false;
    }
    let Some(parsed) = safe_read(path).and_then(|t| serde_json::from_str::<Value>(&t).ok()) else {
        return false;
    };
    let Value::Object(o) = parsed else {
        return false;
    };
    match o.get("hooks") {
        Some(h @ (Value::Object(_) | Value::Array(_))) => value_has_impeccable_hook_marker(h),
        _ => false,
    }
}

/// JS: valueHasImpeccableHookMarker(value)
fn value_has_impeccable_hook_marker(value: &Value) -> bool {
    match value {
        Value::String(s) => impeccable_context::hook_markers::is_impeccable_hook_command(s),
        Value::Array(a) => a.iter().any(value_has_impeccable_hook_marker),
        Value::Object(o) => o.values().any(value_has_impeccable_hook_marker),
        _ => false,
    }
}

fn marker_in(entry: &Map<String, Value>, key: &str) -> bool {
    entry
        .get(key)
        .map(value_has_impeccable_hook_marker)
        .unwrap_or(false)
}

/// JS: stripImpeccableHookEntry(entry) — `None` drops the entry.
fn strip_impeccable_hook_entry(entry: &Value) -> Option<Value> {
    let Value::Object(e) = entry else {
        // JS: `!entry || typeof entry !== 'object'` returns the entry as-is
        // (a null/primitive survives until `.filter(Boolean)`; an array is
        // an object with none of the inspected keys and no `hooks` array).
        return Some(entry.clone());
    };
    if marker_in(e, "command")
        || marker_in(e, "commandWindows")
        || marker_in(e, "args")
        || marker_in(e, "bash")
        || marker_in(e, "powershell")
    {
        return None;
    }
    let Some(Value::Array(hooks)) = e.get("hooks") else {
        return Some(entry.clone());
    };
    let stripped: Vec<Value> = hooks
        .iter()
        .filter_map(strip_impeccable_hook_entry)
        .filter(|v| truthy_json(v))
        .collect();
    if stripped.is_empty() && hooks.iter().any(value_has_impeccable_hook_marker) {
        return None;
    }
    let mut out = e.clone();
    out.insert("hooks".into(), Value::Array(stripped));
    Some(Value::Object(out))
}

/// JS `.filter(Boolean)` on the mapped entries.
fn truthy_json(v: &Value) -> bool {
    crate::util::truthy_value(Some(v))
}

/// JS: stripImpeccableHookEntries(entries)
fn strip_impeccable_hook_entries(entries: Option<&Value>) -> Vec<Value> {
    match entries {
        Some(Value::Array(a)) => a
            .iter()
            .filter_map(strip_impeccable_hook_entry)
            .filter(|v| truthy_json(v))
            .collect(),
        _ => vec![],
    }
}

/// JS: pruneImpeccableHookFromManifest(manifestPath)
fn prune_impeccable_hook_from_manifest(path: &str) -> Result<bool, String> {
    if !file_has_impeccable_hook_marker(path) {
        return Ok(false);
    }
    let Some(parsed) = safe_read(path).and_then(|t| serde_json::from_str::<Value>(&t).ok()) else {
        return Ok(false);
    };
    let parsed = as_object(&parsed);
    let existing_hooks = obj_field(&parsed, "hooks").cloned().unwrap_or_default();
    let mut cleaned = Map::new();
    for (event, entries) in &existing_hooks {
        let kept = strip_impeccable_hook_entries(Some(entries));
        if !kept.is_empty() {
            cleaned.insert(event.clone(), Value::Array(kept));
        }
    }
    let mut next = parsed.clone();
    if !cleaned.is_empty() {
        next.insert("hooks".into(), Value::Object(cleaned));
    } else {
        next.shift_remove("hooks");
        next.shift_remove("description");
        next.shift_remove("version");
    }
    if next.is_empty() {
        let _ = std::fs::remove_file(path);
    } else {
        std::fs::write(path, format!("{}\n", json_pretty(&Value::Object(next))))
            .map_err(|e| e.to_string())?;
    }
    Ok(true)
}

fn normalize_rule(rule: &str) -> String {
    js::to_lower_case(js::trim(rule))
}

/// JS: parseIgnoreRuleArgs(args)
fn parse_ignore_rule_args(args: &[String]) -> Result<(String, bool), String> {
    let mut positionals: Vec<String> = Vec::new();
    let mut all_values = false;
    let mut i = 0;
    while i < args.len() {
        let arg = args[i].as_str();
        if arg == "--all-values" {
            all_values = true;
        } else if arg == "--reason" {
            while i + 1 < args.len() && !args[i + 1].starts_with("--") {
                i += 1;
            }
        } else if arg.starts_with("--reason=") {
            // accepted, discarded
        } else if arg.starts_with("--") {
            return Err(format!("Unknown ignore-rule flag: {arg}"));
        } else {
            positionals.push(arg.to_string());
        }
        i += 1;
    }
    Ok((
        normalize_rule(positionals.first().map(String::as_str).unwrap_or("")),
        all_values,
    ))
}

/// JS: addIgnoreRule(cwd, args)
fn add_ignore_rule(rt: &Runtime, cwd: &str, args: &[String]) -> Result<String, String> {
    let (rule, all_values) = parse_ignore_rule_args(args)?;
    let cmd = &rt.impeccable_command;
    if rule.is_empty() {
        return Err(format!(
            "Pass a rule id, e.g. {cmd} hooks ignore-rule side-tab"
        ));
    }
    if rule == "overused-font" && !all_values {
        return Err(format!("overused-font is value-specific by default. Use {cmd} hooks ignore-value overused-font <font> for a confirmed font, or {cmd} hooks ignore-rule overused-font --all-values only when the user asked to ignore overused fonts generally."));
    }
    let mut config = merge_detector_config(Some(&read_raw_detector_config(cwd, false)), None);
    let mut rules = string_array(config.get("ignoreRules")).unwrap_or_default();
    if !rules.contains(&rule) {
        rules.push(rule.clone());
    }
    config.insert(
        "ignoreRules".into(),
        Value::Array(rules.iter().cloned().map(Value::String).collect()),
    );
    write_detector_config(rt, cwd, &config, false)?;
    Ok(format!(
        "Added \"{rule}\" to detector.ignoreRules. Current: {}",
        rules.join(", ")
    ))
}

/// JS: parseIgnoreFileArgs(args)
fn parse_ignore_file_args(args: &[String]) -> Result<(Option<String>, bool), String> {
    let mut positionals: Vec<String> = Vec::new();
    let mut shared = false;
    let mut local = false;
    for arg in args {
        if arg == "--shared" {
            shared = true;
        } else if arg == "--local" {
            local = true;
        } else if arg == "--reason" || arg.starts_with("--reason=") {
            return Err("--reason is not supported for ignore-file because detector.ignoreFiles stores globs only; use ignore-value when a documented rule-specific exception fits".to_string());
        } else if arg.starts_with("--") {
            return Err(format!("Unknown ignore-file flag: {arg}"));
        } else {
            positionals.push(arg.clone());
        }
    }
    if shared && local {
        return Err("Pass only one scope flag: --shared or --local".to_string());
    }
    if positionals.len() > 1 {
        return Err("Pass exactly one glob to ignore-file".to_string());
    }
    Ok((positionals.into_iter().next(), local))
}

/// JS: addIgnoreFile(cwd, args)
fn add_ignore_file(rt: &Runtime, cwd: &str, args: &[String]) -> Result<String, String> {
    let (glob, local) = parse_ignore_file_args(args)?;
    let glob = match glob {
        Some(g) if !g.is_empty() => g,
        _ => {
            return Err(format!(
                "Pass a glob, e.g. {} hooks ignore-file \"src/legacy/**\"",
                rt.impeccable_command
            ))
        }
    };
    let mut config = merge_detector_config(Some(&read_raw_detector_config(cwd, local)), None);
    let mut files = string_array(config.get("ignoreFiles")).unwrap_or_default();
    if !files.contains(&glob) {
        files.push(glob.clone());
    }
    config.insert(
        "ignoreFiles".into(),
        Value::Array(files.iter().cloned().map(Value::String).collect()),
    );
    let target = write_detector_config(rt, cwd, &config, local)?;
    let scope = if local {
        "local detector.ignoreFiles"
    } else {
        "shared detector.ignoreFiles"
    };
    Ok(format!(
        "Added \"{glob}\" to {scope} ({}). Current: {}",
        rel_or(rt, cwd, &target),
        files.join(", ")
    ))
}

/// JS: requireGlob(raw, flag)
fn require_glob(raw: &str, flag: &str) -> Result<String, String> {
    let glob = js::trim(raw);
    if glob.is_empty() {
        return Err(format!("{flag} requires a non-empty glob"));
    }
    if glob.starts_with("--") {
        return Err(format!("{flag} requires a glob, got the flag {glob}"));
    }
    Ok(glob.to_string())
}

struct IgnoreValueArgs {
    rule: String,
    value: String,
    files: Vec<String>,
    shared: bool,
    local: bool,
    reason: String,
}

/// JS: parseIgnoreValueArgs(args)
fn parse_ignore_value_args(args: &[String]) -> Result<IgnoreValueArgs, String> {
    let mut positionals: Vec<String> = Vec::new();
    let mut files: Vec<String> = Vec::new();
    let mut shared = false;
    let mut local = false;
    let mut reason = String::new();
    let mut i = 0;
    while i < args.len() {
        let arg = args[i].as_str();
        if arg == "--shared" {
            shared = true;
        } else if arg == "--local" {
            local = true;
        } else if arg == "--reason" {
            let mut chunks: Vec<String> = Vec::new();
            while i + 1 < args.len() && !args[i + 1].starts_with("--") {
                i += 1;
                chunks.push(args[i].clone());
            }
            reason = js::trim(&chunks.join(" ")).to_string();
        } else if let Some(r) = arg.strip_prefix("--reason=") {
            reason = js::trim(r).to_string();
        } else if arg == "--file" || arg == "--files" {
            if i + 1 >= args.len() {
                return Err(format!("{arg} requires a glob"));
            }
            i += 1;
            files.push(require_glob(&args[i], arg)?);
        } else if let Some(g) = arg.strip_prefix("--file=") {
            files.push(require_glob(g, "--file")?);
        } else if let Some(g) = arg.strip_prefix("--files=") {
            files.push(require_glob(g, "--files")?);
        } else if arg.starts_with("--") {
            return Err(format!("Unknown ignore-value flag: {arg}"));
        } else {
            positionals.push(arg.to_string());
        }
        i += 1;
    }
    let rule = positionals.first().cloned().unwrap_or_default();
    let value_parts: Vec<String> = positionals.iter().skip(1).cloned().collect();
    let mut uniq = unique(files.into_iter().filter(|f| !f.is_empty()).collect());
    uniq.sort_by(|a, b| js_str_cmp(a, b));
    Ok(IgnoreValueArgs {
        rule: js::to_lower_case(js::trim(&rule)),
        value: normalize_ignore_value_str(&value_parts.join(" ")),
        files: uniq,
        shared,
        local,
        reason,
    })
}

/// JS: addIgnoreValue(cwd, args)
fn add_ignore_value(rt: &Runtime, cwd: &str, args: &[String]) -> Result<String, String> {
    let parsed = parse_ignore_value_args(args)?;
    let cmd = &rt.impeccable_command;
    if parsed.rule.is_empty() || parsed.value.is_empty() {
        return Err(format!(
            "Pass a rule id and value, e.g. {cmd} hooks ignore-value overused-font Inter"
        ));
    }
    if parsed.shared && parsed.local {
        return Err("Pass only one scope flag: --shared or --local".to_string());
    }
    if parsed.value == "*" && parsed.files.is_empty() {
        let project_wide = if parsed.rule == "overused-font" {
            format!("{cmd} hooks ignore-rule {} --all-values", parsed.rule)
        } else {
            format!("{cmd} hooks ignore-rule {}", parsed.rule)
        };
        return Err(format!("Wildcard value ignores must be scoped with --file <glob>, e.g. {cmd} hooks ignore-value design-system-font-size \"*\" --file \"src/widget.js\". To suppress the rule project-wide use {project_wide}."));
    }
    // JS: refuse inert exact entries — a value the extractor can never
    // produce for this rule would silently match nothing (upstream be87f5eb,
    // issue #662). Shared with `ignores add-value` via impeccable-detect.
    if parsed.value != "*"
        && impeccable_detect::config::synthetic_ignore_value(&parsed.rule, &parsed.value).is_empty()
    {
        return Err(format!(
            "{rule} has no extractable ignore value. Use {cmd} hooks ignore-value {rule} \"*\" --file <glob> to suppress it in matching files.",
            rule = parsed.rule
        ));
    }
    let local = parsed.local;
    let mut config = merge_detector_config(Some(&read_raw_detector_config(cwd, local)), None);
    let mut probe = Map::new();
    probe.insert("rule".into(), Value::String(parsed.rule.clone()));
    probe.insert("value".into(), Value::String(parsed.value.clone()));
    probe.insert(
        "files".into(),
        Value::Array(parsed.files.iter().cloned().map(Value::String).collect()),
    );
    let key = ignore_value_entry_key_json(&probe);
    let mut entries: Vec<Value> = match config.get("ignoreValues") {
        Some(Value::Array(a)) => a.clone(),
        _ => vec![],
    };
    let existing_idx = entries.iter().position(|e| {
        e.as_object()
            .map(|o| ignore_value_entry_key_json(o) == key)
            .unwrap_or(false)
    });
    match existing_idx {
        Some(idx) => {
            if !parsed.reason.is_empty() {
                if let Some(o) = entries[idx].as_object_mut() {
                    o.insert("reason".into(), Value::String(parsed.reason.clone()));
                }
            }
        }
        None => {
            let mut entry = Map::new();
            entry.insert("rule".into(), Value::String(parsed.rule.clone()));
            entry.insert("value".into(), Value::String(parsed.value.clone()));
            if !parsed.files.is_empty() {
                entry.insert(
                    "files".into(),
                    Value::Array(parsed.files.iter().cloned().map(Value::String).collect()),
                );
            }
            entry.insert("createdAt".into(), Value::String(iso_now()));
            if !parsed.reason.is_empty() {
                entry.insert("reason".into(), Value::String(parsed.reason.clone()));
            }
            entries.push(Value::Object(entry));
        }
    }
    config.insert("ignoreValues".into(), Value::Array(entries));
    let target = write_detector_config(rt, cwd, &config, local)?;
    let scope = if local {
        "local detector.ignoreValues"
    } else {
        "shared detector.ignoreValues"
    };
    let scope_suffix = if parsed.files.is_empty() {
        String::new()
    } else {
        format!(" scoped to {}", parsed.files.join(", "))
    };
    Ok(format!(
        "Added {}={}{scope_suffix} to {scope} ({}).",
        parsed.rule,
        parsed.value,
        rel_or(rt, cwd, &target)
    ))
}

/// JS: reset(cwd)
fn reset(rt: &Runtime, cwd: &str) -> String {
    let mut removed: Vec<String> = Vec::new();
    for file_path in [get_config_path(cwd), get_local_config_path(cwd)] {
        let raw = read_raw_config_file(&file_path).raw;
        let Some(Value::Object(raw)) = raw else {
            continue;
        };
        if !raw.contains_key("hook") && !raw.contains_key("detector") {
            continue;
        }
        let mut rest = raw.clone();
        rest.shift_remove("hook");
        rest.shift_remove("detector");
        let ok = if rest.is_empty() {
            std::fs::remove_file(&file_path).is_ok()
        } else {
            std::fs::write(
                &file_path,
                format!("{}\n", json_pretty(&Value::Object(rest))),
            )
            .is_ok()
        };
        if ok {
            removed.push(rel_or(rt, cwd, &file_path));
        }
    }
    for file_path in [get_cache_path(cwd), get_pending_path(cwd)] {
        if exists(&file_path) && std::fs::remove_file(&file_path).is_ok() {
            removed.push(rel_or(rt, cwd, &file_path));
        }
    }
    // JS #668: `on` writes three things: config, consent, and hook entries in
    // the provider manifests. Reset must undo all three (issue #512), or a
    // leftover manifest entry keeps invoking the hook after the config was
    // deleted. destRel only (the local manifest `on` writes); never the
    // team-shared sharedDestRel. No skill-folder gate: a reset mid-uninstall is
    // exactly the case that needs the prune. The manifest entries are the
    // launcher-era shape the engine writes (`impeccable hook ...`), not the old
    // `node hook.mjs` form; prune_impeccable_hook_from_manifest keys on the
    // impeccable marker, so it removes whichever form is present.
    let mut pruned: Vec<String> = Vec::new();
    for target in HOOK_MANIFEST_TARGETS {
        let dest = jsp::join(&[cwd, target.dest_rel]);
        if let Ok(true) = prune_impeccable_hook_from_manifest(&dest) {
            pruned.push(target.provider.to_string());
        }
    }
    let mut parts: Vec<String> = Vec::new();
    if !removed.is_empty() {
        parts.push(format!(
            "Reset design hook config and cache (removed: {}).",
            removed.join(", ")
        ));
    }
    if !pruned.is_empty() {
        parts.push(format!("Removed hook entries from: {}.", pruned.join(", ")));
    }
    if parts.is_empty() {
        "No hook config or cache to remove. Already at defaults.".to_string()
    } else {
        parts.join(" ")
    }
}

/// `impeccable hooks [action] [args...]` (hook-admin.mjs main). Returns the exit code.
pub fn run(rt: &Runtime, args: &[String], io: &mut impeccable_common::Io) -> i32 {
    let action = js::to_lower_case(
        args.first()
            .map(String::as_str)
            .filter(|a| !a.is_empty())
            .unwrap_or("status"),
    );
    let rest: Vec<String> = args.iter().skip(1).cloned().collect();
    let cwd = rt.proc_cwd.clone();
    if !ACTIONS.contains(&action.as_str()) {
        io.err(&format!(
            "Unknown action: {action}\nValid: {}\n",
            ACTIONS.join(", ")
        ));
        return 1;
    }
    let out = match action.as_str() {
        "status" => Ok(status_report(rt, &cwd)),
        "on" => set_enabled(rt, &cwd, true),
        "off" => set_enabled(rt, &cwd, false),
        "ignore-rule" => add_ignore_rule(rt, &cwd, &rest),
        "ignore-file" => add_ignore_file(rt, &cwd, &rest),
        "ignore-value" => add_ignore_value(rt, &cwd, &rest),
        "reset" => Ok(reset(rt, &cwd)),
        _ => Ok(String::new()),
    };
    match out {
        Ok(text) => {
            io.out(&format!("{text}\n"));
            0
        }
        Err(message) => {
            io.err(&format!("Error: {message}\n"));
            1
        }
    }
}
