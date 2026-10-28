//! JS: skill/scripts/hook.mjs (`impeccable hook`) and hook-lib.mjs
//! `runHook` / `runStopHook`: the PostToolUse per-edit pass and the Stop deep
//! pass. Always exits 0; stdout is one JSON document or nothing.

use impeccable_core::findings::Finding;
use impeccable_core::js;
use impeccable_detect::file_system::uses_html_engine;
use serde_json::{Map, Value};
use std::collections::HashMap;

use crate::hook_lib::*;
use crate::stop_baseline;
use crate::util::{
    exists, iso_now, jsp, node_read_error, now_ms, str_field, truthy_value, utf16_len,
};

/// JS `runHook` / `runStopHook` result: `{ exitCode: 0, stdout, audit }`.
pub struct RunResult {
    pub stdout: String,
    pub audit: Map<String, Value>,
}

fn ms_since(started: f64) -> Value {
    Value::from((now_ms() - started).max(0.0) as u64)
}

fn with(audit: &Map<String, Value>, extra: Vec<(&str, Value)>) -> Map<String, Value> {
    let mut out = audit.clone();
    for (k, v) in extra {
        out.insert(k.to_string(), v);
    }
    out
}

fn result(audit: &Map<String, Value>, extra: Vec<(&str, Value)>) -> RunResult {
    RunResult {
        stdout: String::new(),
        audit: with(audit, extra),
    }
}

/// Parse stdin the way `runHook` does: `Err` for malformed JSON, `Ok(None)`
/// for a parsed non-object.
fn parse_event(stdin: &str) -> Result<Option<Map<String, Value>>, ()> {
    match serde_json::from_str::<Value>(stdin) {
        Ok(Value::Object(o)) => Ok(Some(o)),
        Ok(_) => Ok(None),
        Err(_) => Err(()),
    }
}

/// `event.session_id || 'unknown'` as the cache key; `None` when absent.
fn session_id_of(event: &Map<String, Value>) -> Option<Value> {
    event
        .get("session_id")
        .filter(|v| truthy_value(Some(v)))
        .cloned()
}

/// Cursor's cap on a hook's `additional_context` (characters, after trim).
const CURSOR_ADDITIONAL_CONTEXT_MAX_CHARS: f64 = 10_000.0;

fn session_key(v: &Option<Value>) -> String {
    match v {
        Some(v) => crate::util::js_string(v),
        None => "unknown".to_string(),
    }
}

/// Records the root whose cache this edit just wrote, so a Stop from a
/// session cwd above it finds it (#1101). Only for a named session, and only
/// for harnesses that run a Stop pass: Cursor and GitHub Copilot install none.
fn record_session_root(rt: &Runtime, harness: &str, session_value: &Option<Value>, project_cwd: &str) {
    if session_value.is_none() || matches!(harness, "cursor" | "github") {
        return;
    }
    crate::hook_sessions::record_root(rt, &session_key(session_value), project_cwd);
}

/// JS: runHook({ stdinJson, env, cwd })
pub fn run_hook(rt: &Runtime, stdin: &str) -> RunResult {
    let mut audit: Map<String, Value> = Map::new();
    audit.insert("ts".into(), Value::String(iso_now()));
    audit.insert("event".into(), Value::String("PostToolUse".into()));

    if depth_is_set(rt.env("IMPECCABLE_HOOK_DEPTH")) || depth_is_set(rt.env("CLAUDE_HOOK_DEPTH")) {
        return result(
            &audit,
            vec![
                ("reentrant", Value::Bool(true)),
                ("durationMs", Value::from(0)),
            ],
        );
    }
    if truthy(rt.env("IMPECCABLE_HOOK_DISABLED")) {
        return result(
            &audit,
            vec![
                ("skipped", Value::from("env-disabled")),
                ("durationMs", Value::from(0)),
            ],
        );
    }
    let started = now_ms();

    let event = match parse_event(stdin) {
        Err(()) => {
            return result(
                &audit,
                vec![
                    ("skipped", Value::from("stdin-malformed")),
                    ("durationMs", ms_since(started)),
                ],
            )
        }
        Ok(None) => {
            return result(
                &audit,
                vec![
                    ("skipped", Value::from("stdin-empty")),
                    ("durationMs", ms_since(started)),
                ],
            )
        }
        Ok(Some(e)) => e,
    };

    let harness = resolve_harness(rt, Some(&event));
    let raw_event = event.clone();
    let event = normalize_hook_event(rt, &event, &rt.proc_cwd, harness);
    audit.insert("harness".into(), Value::from(harness));

    let session_cwd = str_field(&event, "cwd").unwrap_or(&rt.proc_cwd).to_string();
    let primary_files = normalize_scan_targets(
        rt,
        &resolve_target_files(rt, &event, &session_cwd),
        &session_cwd,
    );
    let project_cwd =
        resolve_cache_cwd(rt, primary_files.first().map(String::as_str), &session_cwd);
    audit.insert("cwd".into(), Value::String(project_cwd.clone()));
    let target_files = expand_scan_targets(rt, &primary_files, &project_cwd);
    let session_value = session_id_of(&event);
    audit.insert(
        "session".into(),
        session_value.clone().unwrap_or(Value::Null),
    );
    if let Some(tool) = event.get("tool_name").filter(|v| truthy_value(Some(v))) {
        audit.insert("tool".into(), tool.clone());
    }

    if target_files.is_empty() {
        return result(
            &audit,
            vec![
                ("skipped", Value::from("no-file-path")),
                ("durationMs", ms_since(started)),
            ],
        );
    }

    let mut config = read_config(&project_cwd);
    if harness == "cursor" {
        // Cursor rejects a postToolUse `additional_context` longer than
        // 10,000 characters and drops it, so a raised `limits.maxChars`
        // must not push the findings past that.
        config.limits.max_chars = config.limits.max_chars.min(CURSOR_ADDITIONAL_CONTEXT_MAX_CHARS);
    }
    if !config.enabled {
        return result(
            &audit,
            vec![
                ("skipped", Value::from("config-disabled")),
                ("durationMs", ms_since(started)),
            ],
        );
    }

    let platform = resolve_project_platform(rt, &project_cwd);
    if is_native_platform(platform.as_deref()) {
        return result(
            &audit,
            vec![
                ("skipped", Value::from("native-platform")),
                ("platform", Value::String(platform.unwrap_or_default())),
                ("durationMs", ms_since(started)),
            ],
        );
    }

    // Several Impeccable hooks can fire for one edit (home and project
    // manifests, a plugin and a project hook): only the first scans.
    if crate::hook_claim::claim_event(rt, &raw_event, &project_cwd, &primary_files) == crate::hook_claim::Claim::Duplicate {
        return result(
            &audit,
            vec![
                ("skipped", Value::from("duplicate-event")),
                ("durationMs", ms_since(started)),
            ],
        );
    }

    let mut cache = read_cache(&project_cwd);
    let session_id = session_key(&session_value);
    let mut scans = HashMap::new();
    let tiered = per_edit_tiering_active(&config, harness);

    struct Pending {
        file_path: String,
        known: Vec<String>,
    }
    let mut pending_winner: Option<Pending> = None;
    let mut clean_winner: Option<String> = None;
    let mut fresh_groups: Vec<Group> = Vec::new();
    let mut suppression_winner: Option<String> = None;
    let mut clean_ack_deduped = false;
    let mut skipped_bytes: u64 = 0;
    let quiet_mode = truthy(rt.env("IMPECCABLE_HOOK_QUIET")) || config.quiet;
    let mut detector_threw_any = false;
    let mut last_skip = "no-scannable-file";
    let mut live_preview_edit: Option<String> = None;
    let mut suppressed_hit = false;
    let mut cache_dirty = false;
    let mut deferred_total: usize = 0;

    for file_path in &target_files {
        audit.insert("file".into(), Value::String(file_path.clone()));

        if has_path_traversal(file_path) || is_sensitive_path(file_path) {
            last_skip = "sensitive";
            continue;
        }
        if is_generated_path(file_path) {
            last_skip = "generated";
            continue;
        }
        let ext = js::to_lower_case(&jsp::extname(file_path));
        let configured = match_configured_extension(file_path, &config.extensions);
        audit.insert(
            "ext".into(),
            Value::String(
                configured
                    .map(|c| c.ext.clone())
                    .unwrap_or_else(|| ext.clone()),
            ),
        );
        if !ALLOWED_EXTS.contains(&ext.as_str()) && configured.is_none() {
            last_skip = "extension";
            continue;
        }
        if is_ignored_file(&rt.proc_cwd, file_path, &project_cwd, &config.ignore_files) {
            last_skip = "config-ignore-file";
            continue;
        }
        if !exists(file_path) {
            last_skip = "file-missing";
            continue;
        }
        if !is_scan_target_inside_project(rt, file_path, &project_cwd) {
            last_skip = "outside-project";
            continue;
        }
        let max_file_bytes = config.limits.max_file_bytes;
        if max_file_bytes > 0.0 {
            let size = std::fs::metadata(file_path).map(|m| m.len()).unwrap_or(0);
            if size as f64 > max_file_bytes {
                skipped_bytes = size;
                last_skip = "too-large";
                continue;
            }
        }

        // A live variant session owns a file carrying preview markers: stand
        // down before the per-session edit cap can turn the variants wrap
        // into a suppression notice.
        if primary_files.contains(file_path) {
            if let Ok(bytes) = std::fs::read(file_path) {
                if crate::hook_lib::has_live_preview_markers(&String::from_utf8_lossy(&bytes)) {
                    if live_preview_edit.is_none() {
                        live_preview_edit = Some(file_path.clone());
                    }
                    last_skip = "live-preview";
                    continue;
                }
            }
        }
        let use_html_engine = uses_html_engine(file_path, &config.extensions);
        if primary_files.contains(file_path) {
            if harness == "claude" {
                stop_baseline::capture(rt, &event, &mut cache, &session_id, file_path, use_html_engine);
            }
            let edit_count = bump_edit_count(&mut cache, &session_id, file_path);
            cache_dirty = true;
            audit.insert("editCount".into(), Value::from(edit_count as u64));
            if edit_count > EDIT_COUNT_THRESHOLD as f64 {
                stop_baseline::invalidate(&mut cache, &session_id, file_path);
                let just_crossed = edit_count == (EDIT_COUNT_THRESHOLD + 1) as f64;
                if just_crossed && suppression_winner.is_none() {
                    suppression_winner = Some(file_path.clone());
                }
                last_skip = "suppressed";
                suppressed_hit = true;
                continue;
            }
        }

        let content = match std::fs::read(file_path) {
            Ok(bytes) => String::from_utf8_lossy(&bytes).into_owned(),
            Err(e) => {
                // JS: fs.readFileSync throws out of runHook's try; the catch
                // records the error and emits nothing.
                return RunResult {
                    stdout: String::new(),
                    audit: with(
                        &audit,
                        vec![("error", Value::String(node_read_error(file_path, &e)))],
                    ),
                };
            }
        };
        if crate::hook_lib::has_live_preview_markers(&content) {
            // A live variant session owns this file. When it is the edited
            // (primary) file, the whole event stands down, co-scanned
            // stylesheets included: a clean ack or a finding about the
            // companion file is the same mid-session noise the stand-down
            // exists to prevent.
            if primary_files.contains(file_path) && live_preview_edit.is_none() {
                live_preview_edit = Some(file_path.clone());
            }
            last_skip = "live-preview";
            continue;
        }
        let scan = scans.entry(file_path.clone()).or_insert_with(|| {
            design_system_options_for_file(rt, &config, &project_cwd, file_path)
        });
        let mut detector_threw = false;
        let findings: Vec<Finding> = if use_html_engine {
            match detector_detect_html(rt, file_path, scan) {
                Ok(f) => f,
                Err(_) => {
                    detector_threw = true;
                    vec![]
                }
            }
        } else {
            detector_detect_text(&content, file_path, scan)
        };
        if !detector_threw && !use_html_engine {
            stop_baseline::reconcile(&mut cache, &session_id, file_path, &findings);
        }
        let raw_count = findings.len();
        let filtered = filter_findings(findings, &config);
        let (immediate, deferred) = if tiered {
            split_findings_by_tier(filtered)
        } else {
            (filtered, vec![])
        };
        if !deferred.is_empty() {
            touch_file(&mut cache, &session_id, file_path);
            cache_dirty = true;
            deferred_total += deferred.len();
        }
        let immediate_keys = finding_cache_keys(&immediate);
        let fresh = dedupe_against_cache(&immediate, &immediate_keys, &mut cache, &session_id, file_path);
        audit.insert("findings".into(), Value::from(raw_count));
        audit.insert("freshFindings".into(), Value::from(fresh.len()));
        if deferred_total > 0 {
            audit.insert("deferred".into(), Value::from(deferred_total));
        }
        if detector_threw {
            detector_threw_any = true;
            continue;
        }
        // JS: Grok ignores PostToolUse stdout, so Stop is the user-visible
        // pass. Remembering here would dedupe those findings out of Stop.
        // Touch the file so Stop has it, and leave the finding list empty
        // (#646).
        if harness == "grok" {
            touch_file(&mut cache, &session_id, file_path);
        } else {
            // Deferred findings a Stop pass already reported stay remembered;
            // the rest of the old list is dropped (see the Stop pass).
            let known = known_findings(ensure_file(&mut cache, &session_id, file_path));
            let mut keys = immediate_keys;
            keys.extend(finding_cache_keys(&deferred).into_iter().filter(|k| known.contains(k)));
            remember_findings(&mut cache, &session_id, file_path, &keys);
        }
        cache_dirty = true;

        if !fresh.is_empty() {
            fresh_groups.push(Group {
                file_path: file_path.clone(),
                findings: fresh,
            });
            continue;
        }
        if !immediate.is_empty() && pending_winner.is_none() {
            pending_winner = Some(Pending {
                file_path: file_path.clone(),
                known: immediate.iter().map(pending_label).collect(),
            });
        } else if immediate.is_empty() && clean_winner.is_none() {
            if quiet_mode || !should_emit_ack_for_file(file_path, &config) {
                clean_winner = Some(file_path.clone());
            } else if truthy_value(
                ensure_file(&mut cache, &session_id, file_path).get("cleanAcked"),
            ) {
                clean_ack_deduped = true;
            } else {
                ensure_file(&mut cache, &session_id, file_path)
                    .insert("cleanAcked".into(), Value::Bool(true));
                clean_winner = Some(file_path.clone());
                clean_ack_deduped = false;
            }
        }
    }
    if let Some(file) = live_preview_edit {
        audit.insert("file".into(), Value::String(file));
        return result(
            &audit,
            vec![
                ("emitted", Value::Bool(false)),
                ("skipped", Value::from("live-preview")),
                ("durationMs", ms_since(started)),
            ],
        );
    }

    if !fresh_groups.is_empty() {
        let scan = &scans[&fresh_groups[0].file_path];
        let short = footer_mode_short(&mut cache, &session_id);
        let reserve = design_note_reserve(rt, scan, &mut cache, &session_id);
        let rendered = render_grouped_template(
            rt,
            &fresh_groups,
            &config,
            &RenderOpts {
                cwd: Some(project_cwd.clone()),
                short_footer: short,
                reserve_chars: reserve,
            },
        );
        let text =
            append_design_system_note_once(rt, &rendered, scan, &mut cache, &session_id, &config);
        commit_footer_shown(rt, &mut cache, &session_id, &text);
        if persist_cache(rt, &project_cwd, &cache) {
            record_session_root(rt, harness, &session_value, &project_cwd);
        }
        let all: usize = fresh_groups.iter().map(|g| g.findings.len()).sum();
        return RunResult {
            stdout: payload(&text, "PostToolUse", harness),
            audit: with(
                &audit,
                vec![
                    ("file", Value::String(fresh_groups[0].file_path.clone())),
                    ("emitted", Value::Bool(true)),
                    ("freshFiles", Value::from(fresh_groups.len())),
                    ("freshFindings", Value::from(all)),
                    ("chars", Value::from(utf16_len(&text))),
                    ("durationMs", ms_since(started)),
                ],
            ),
        };
    }

    enum Ack {
        Pending(String),
        Clean(String),
    }
    let mut ack: Option<Ack> = None;
    if !quiet_mode {
        if let Some(p) = pending_winner
            .as_ref()
            .filter(|p| should_emit_ack_for_file(&p.file_path, &config))
        {
            let base = render_pending_ack(rt, &p.file_path, &p.known, &project_cwd);
            let scan = &scans[&p.file_path];
            ack = Some(Ack::Pending(append_design_system_note_once(
                rt,
                &base,
                scan,
                &mut cache,
                &session_id,
                &config,
            )));
        } else if suppression_winner.is_none() && !clean_ack_deduped {
            if let Some(c) = clean_winner
                .as_ref()
                .filter(|c| should_emit_ack_for_file(c, &config))
            {
                let base = render_clean_ack(rt, c, &project_cwd);
                let scan = &scans[c];
                ack = Some(Ack::Clean(append_design_system_note_once(
                    rt,
                    &base,
                    scan,
                    &mut cache,
                    &session_id,
                    &config,
                )));
            }
        }
    }

    // JS: an already-present `.impeccable/` dir marks a project that opted
    // in (issues #344, #305). An existing cache file also counts as opted
    // in: under IMPECCABLE_CACHE_ROOT (issue #422) state lives outside the
    // project, so the project dir alone can't carry the marker — without
    // this, clean-edit editCount bumps would stop persisting the moment
    // state relocates. Under stock paths the cache sits inside
    // `.impeccable/`, so the extra check changes nothing there.
    let wants_persist = deferred_total > 0
        || (cache_dirty
            && (exists(&jsp::join(&[&project_cwd, ".impeccable"])) || exists(&get_cache_path(&project_cwd))));
    if wants_persist && persist_cache(rt, &project_cwd, &cache) {
        record_session_root(rt, harness, &session_value, &project_cwd);
    }

    if detector_threw_any && pending_winner.is_none() && clean_winner.is_none() {
        return result(
            &audit,
            vec![
                ("emitted", Value::Bool(false)),
                ("error", Value::from("detector-threw")),
                ("durationMs", ms_since(started)),
            ],
        );
    }
    if quiet_mode {
        return result(
            &audit,
            vec![
                ("emitted", Value::Bool(false)),
                ("quiet", Value::Bool(true)),
                ("durationMs", ms_since(started)),
            ],
        );
    }
    if let Some(Ack::Pending(text)) = &ack {
        let p = pending_winner.as_ref().unwrap();
        return RunResult {
            stdout: payload(text, "PostToolUse", harness),
            audit: with(
                &audit,
                vec![
                    ("file", Value::String(p.file_path.clone())),
                    ("emitted", Value::Bool(true)),
                    ("kind", Value::from("pending")),
                    ("pending", Value::from(p.known.len())),
                    ("chars", Value::from(utf16_len(text))),
                    ("durationMs", ms_since(started)),
                ],
            ),
        };
    }
    if let Some(sw) = &suppression_winner {
        let text = suppression_notice(rt, &relativize(rt, sw, &project_cwd));
        return RunResult {
            stdout: payload(&text, "PostToolUse", harness),
            audit: with(
                &audit,
                vec![
                    ("file", Value::String(sw.clone())),
                    ("suppressed", Value::Bool(true)),
                    ("emitted", Value::Bool(true)),
                    ("durationMs", ms_since(started)),
                ],
            ),
        };
    }
    if let Some(Ack::Clean(text)) = &ack {
        let c = clean_winner.as_ref().unwrap();
        return RunResult {
            stdout: payload(text, "PostToolUse", harness),
            audit: with(
                &audit,
                vec![
                    ("file", Value::String(c.clone())),
                    ("emitted", Value::Bool(true)),
                    ("kind", Value::from("clean")),
                    ("chars", Value::from(utf16_len(text))),
                    ("durationMs", ms_since(started)),
                ],
            ),
        };
    }
    if pending_winner.is_some() || clean_winner.is_some() {
        return result(
            &audit,
            vec![
                ("emitted", Value::Bool(false)),
                ("skipped", Value::from("non-ui-ack")),
                ("durationMs", ms_since(started)),
            ],
        );
    }
    if clean_ack_deduped {
        return result(
            &audit,
            vec![
                ("emitted", Value::Bool(false)),
                ("skipped", Value::from("clean-ack-deduped")),
                ("durationMs", ms_since(started)),
            ],
        );
    }
    if suppressed_hit {
        return result(
            &audit,
            vec![
                ("suppressed", Value::Bool(true)),
                ("emitted", Value::Bool(false)),
                ("durationMs", ms_since(started)),
            ],
        );
    }
    let mut extra = vec![("skipped", Value::from(last_skip))];
    if last_skip == "too-large" {
        extra.push(("bytes", Value::from(skipped_bytes)));
    }
    extra.push(("durationMs", ms_since(started)));
    result(&audit, extra)
}

/// JS: runStopHook({ stdinJson, env, cwd })
pub fn run_stop_hook(rt: &Runtime, stdin: &str) -> RunResult {
    let mut audit: Map<String, Value> = Map::new();
    audit.insert("ts".into(), Value::String(iso_now()));
    audit.insert("event".into(), Value::String("Stop".into()));

    if depth_is_set(rt.env("IMPECCABLE_HOOK_DEPTH")) || depth_is_set(rt.env("CLAUDE_HOOK_DEPTH")) {
        return result(
            &audit,
            vec![
                ("reentrant", Value::Bool(true)),
                ("durationMs", Value::from(0)),
            ],
        );
    }
    if truthy(rt.env("IMPECCABLE_HOOK_DISABLED")) {
        return result(
            &audit,
            vec![
                ("skipped", Value::from("env-disabled")),
                ("durationMs", Value::from(0)),
            ],
        );
    }
    let started = now_ms();
    let event = match parse_event(stdin) {
        Err(()) => {
            return result(
                &audit,
                vec![
                    ("skipped", Value::from("stdin-malformed")),
                    ("durationMs", ms_since(started)),
                ],
            )
        }
        Ok(None) => {
            return result(
                &audit,
                vec![
                    ("skipped", Value::from("stdin-empty")),
                    ("durationMs", ms_since(started)),
                ],
            )
        }
        Ok(Some(e)) => e,
    };
    let harness = resolve_harness(rt, Some(&event));
    audit.insert("harness".into(), Value::from(harness));
    let event = normalize_hook_event(rt, &event, &rt.proc_cwd, harness);
    // Stop-hook re-entry guard (#400): Claude Code and Codex send
    // `stop_hook_active`; Grok sends `stopHookActive`, copied onto the
    // snake_case field by the normalizer. Cursor and GitHub Copilot omit
    // the field, so the strict `=== true` is a no-op for them.
    let stop_hook_active = event.get("stop_hook_active") == Some(&Value::Bool(true));
    // JS: Grok fires Stop twice: `end_turn` (the gate that can inject
    // additionalContext) then an observe-only `shutdown`. A second deep
    // pass would re-emit the same findings. Claude omits `reason`; only
    // skip when Grok named a reason that is not end_turn (#646).
    if harness == "grok" {
        if let Some(Value::String(reason)) = event.get("reason") {
            if reason != "end_turn" {
                return result(
                    &audit,
                    vec![
                        ("skipped", Value::from("stop-reason")),
                        ("reason", Value::String(reason.clone())),
                        ("durationMs", ms_since(started)),
                    ],
                );
            }
        }
    }
    let session_value = session_id_of(&event);
    let session_id = session_key(&session_value);
    let named_session = session_value.is_some();
    // The build-completion stage keeps the session cwd: `build-phase` writes
    // its state under its own cwd. Only the touched-file scan moves to the
    // root the per-edit pass keyed this session's cache to (#1088).
    let session_cwd = rt.resolve(&[str_field(&event, "cwd").unwrap_or(&rt.proc_cwd)]);
    audit.insert("cwd".into(), Value::String(session_cwd.clone()));
    audit.insert(
        "session".into(),
        session_value.unwrap_or_else(|| Value::from("unknown")),
    );

    let config = read_config(&session_cwd);
    if !config.enabled {
        return result(
            &audit,
            vec![
                ("skipped", Value::from("config-disabled")),
                ("durationMs", ms_since(started)),
            ],
        );
    }
    // Native projects skip the whole Stop pass, the build-completion reminder
    // included. Resolving the platform reads PRODUCT.md, so it is paid only
    // when there is a build state to remind about or touched files to scan.
    let mut platform_memo: Option<Option<String>> = None;
    let native_skip = |audit: &Map<String, Value>, cwd: &str, platform_memo: &mut Option<Option<String>>| -> Option<RunResult> {
        let platform = platform_memo.get_or_insert_with(|| resolve_project_platform(rt, cwd)).clone();
        is_native_platform(platform.as_deref()).then(|| result(
            audit,
            vec![
                ("skipped", Value::from("native-platform")),
                ("platform", Value::String(platform.unwrap_or_default())),
                ("durationMs", ms_since(started)),
            ],
        ))
    };
    if std::path::Path::new(&session_cwd).join(".impeccable/build/state.json").is_file() {
        if let Some(skip) = native_skip(&audit, &session_cwd, &mut platform_memo) { return skip; }
    }
    let mut cache = read_cache(&session_cwd);
    if matches!(harness, "claude" | "codex" | "gemini" | "hermes") {
        if let Some(message) = crate::build_completion::reminder(rt, &session_cwd, &session_id, stop_hook_active, &mut cache) {
            return RunResult {
                stdout: payload(&message, "Stop", harness),
                audit: with(&audit, vec![("kind", Value::from("build-completion")), ("emitted", Value::Bool(true)), ("durationMs", ms_since(started))]),
            };
        }
    }
    if stop_hook_active {
        return result(&audit, vec![("skipped", Value::from("stop-hook-active")), ("durationMs", ms_since(started))]);
    }
    if truthy(rt.env("IMPECCABLE_HOOK_COMPLETION_ONLY")) {
        return result(&audit, vec![("skipped", Value::from("no-build-continuation")), ("durationMs", ms_since(started))]);
    }
    // The roots to scan: the nearest one from the session cwd up whose cache
    // this session touched (#1088), then every root the per-edit pass
    // recorded for this session (#1101), which finds projects below a session
    // cwd that sits above them. Without a recorded root this is the walk up
    // alone, as before.
    let mut roots = vec![resolve_stop_cwd(rt, &session_cwd, &session_id)];
    if named_session {
        for root in crate::hook_sessions::recorded_roots(rt, &session_id) {
            if !roots.contains(&root) {
                roots.push(root);
            }
        }
    }

    // Each root is scanned under its own config and cache, as the per-edit
    // pass did. The session cwd's cache keeps the build marker.
    struct RootPass {
        cwd: String,
        config: HookConfig,
        cache: Cache,
        groups: Vec<Group>,
        scans: HashMap<String, HookScanOptions>,
        dirty: bool,
    }
    let mut passes: Vec<RootPass> = Vec::new();
    let mut first_skip: Option<RunResult> = None;
    let mut scanned = 0usize;
    let mut pre_existing = 0usize;
    let mut new_findings = 0usize;
    let mut unknown = 0usize;
    for root in &roots {
        let mut root_audit = audit.clone();
        if *root != session_cwd {
            root_audit.insert("cwd".into(), Value::String(root.clone()));
        }
        let at_session_cwd = *root == session_cwd;
        let root_config = if at_session_cwd { config.clone() } else { read_config(root) };
        if !root_config.enabled {
            first_skip.get_or_insert_with(|| result(
                &root_audit,
                vec![("skipped", Value::from("config-disabled")), ("durationMs", ms_since(started))],
            ));
            continue;
        }
        let mut root_cache = if at_session_cwd { cache.clone() } else { read_cache(root) };
        let touched = touched_files(&root_cache, &session_id);
        if touched.is_empty() {
            first_skip.get_or_insert_with(|| result(
                &root_audit,
                vec![("skipped", Value::from("no-touched-files")), ("durationMs", ms_since(started))],
            ));
            continue;
        }
        let mut root_memo = if at_session_cwd { platform_memo.clone() } else { None };
        if let Some(skip) = native_skip(&root_audit, root, &mut root_memo) {
            first_skip.get_or_insert(skip);
            continue;
        }
        let mut scans = HashMap::new();
        let mut groups: Vec<Group> = Vec::new();
        let mut dirty = false;
        for file_path in &touched {
            if scanned >= STOP_MAX_FILES {
                break;
            }
            if has_path_traversal(file_path)
                || is_sensitive_path(file_path)
                || is_generated_path(file_path)
            {
                continue;
            }
            let ext = js::to_lower_case(&jsp::extname(file_path));
            let configured = match_configured_extension(file_path, &root_config.extensions);
            if !ALLOWED_EXTS.contains(&ext.as_str()) && configured.is_none() {
                continue;
            }
            if is_ignored_file(&rt.proc_cwd, file_path, root, &root_config.ignore_files) {
                continue;
            }
            if !exists(file_path) || !is_scan_target_inside_project(rt, file_path, root) {
                continue;
            }
            scanned += 1;
            let content = match std::fs::read(file_path) {
                Ok(b) => String::from_utf8_lossy(&b).into_owned(),
                Err(_) => continue,
            };
            if crate::hook_lib::has_live_preview_markers(&content) {
                continue;
            }
            let use_html_engine = uses_html_engine(file_path, &root_config.extensions);
            let scan = scans.entry(file_path.clone()).or_insert_with(|| {
                design_system_options_for_file(rt, &root_config, root, file_path)
            });
            // JS: a detector failure tells us nothing about the file. Leave
            // whatever was remembered alone rather than recording an empty scan
            // as truth. (detectText cannot throw here: the Rust engine returns
            // findings directly.)
            let findings = if use_html_engine {
                match detector_detect_html(rt, file_path, scan) {
                    Ok(f) => f,
                    Err(_) => continue,
                }
            } else {
                detector_detect_text(&content, file_path, scan)
            };
            if !use_html_engine {
                stop_baseline::reconcile(&mut root_cache, &session_id, file_path, &findings);
            }
            let filtered = filter_findings(findings, &root_config);
            let classified = stop_baseline::classify(&root_cache, &session_id, file_path, use_html_engine, filtered.clone());
            pre_existing += classified.pre_existing;
            new_findings += classified.new;
            unknown += classified.unknown;
            // Occurrence numbers come from the whole scan: classify drops the
            // pre-existing findings, and counting over the survivors would
            // shift the keys of the ones that stay.
            let keys = finding_cache_keys(&filtered);
            let kept_keys: Vec<String> = classified.kept.iter().map(|&i| keys[i].clone()).collect();
            let fresh = dedupe_against_cache(&classified.findings, &kept_keys, &mut root_cache, &session_id, file_path);
            // JS: sync to the live scan, including empty. Remembering only
            // `fresh` (or skipping the write on a clean Stop) left stale keys in
            // place, so a finding that was fixed and later reintroduced never
            // fired again.
            remember_findings(&mut root_cache, &session_id, file_path, &keys);
            dirty = true;
            if !fresh.is_empty() {
                groups.push(Group {
                    file_path: file_path.clone(),
                    findings: fresh,
                });
            }
        }
        passes.push(RootPass { cwd: root.clone(), config: root_config, cache: root_cache, groups, scans, dirty });
    }
    if passes.is_empty() {
        // Every root fell out at a gate: report the first, as a single root did.
        return first_skip.expect("at least one root");
    }
    if passes[0].cwd != session_cwd {
        audit.insert("cwd".into(), Value::String(passes[0].cwd.clone()));
    }
    if passes.len() > 1 {
        audit.insert("roots".into(), Value::from(passes.len()));
    }
    audit.insert("scannedFiles".into(), Value::from(scanned));
    audit.insert("preExistingFindings".into(), Value::from(pre_existing));
    audit.insert("newFindings".into(), Value::from(new_findings));
    audit.insert("unknownFindings".into(), Value::from(unknown));
    let emitting: Vec<usize> = (0..passes.len()).filter(|&i| !passes[i].groups.is_empty()).collect();
    if emitting.is_empty() {
        for pass in passes.iter().filter(|p| p.dirty) {
            persist_cache(rt, &pass.cwd, &pass.cache);
        }
        return result(
            &audit,
            vec![
                ("emitted", Value::Bool(false)),
                ("skipped", Value::from("stop-clean")),
                ("durationMs", ms_since(started)),
            ],
        );
    }
    // The first root with findings leads: its config sets the render caps, and
    // its cache carries the footer mode and the design-system note. Findings
    // from several roots render as one grouped list, root by root, with paths
    // relative to the session cwd so each names its project.
    let lead = emitting[0];
    let fresh_groups: Vec<Group> = emitting.iter().flat_map(|&i| std::mem::take(&mut passes[i].groups)).collect();
    let display_cwd = if emitting.len() == 1 { passes[lead].cwd.clone() } else { session_cwd.clone() };
    let config = passes[lead].config.clone();
    let scan = passes[lead].scans[&fresh_groups[0].file_path].clone();
    let short = footer_mode_short(&mut passes[lead].cache, &session_id);
    let first_unknown = fresh_groups.iter().flat_map(|group| &group.findings)
        .position(|f| f.name.starts_with("[attribution unknown]"));
    let mut attribution_note = if first_unknown.is_some() {
        format!("{ENVELOPE_PREFIX} {}", stop_baseline::UNKNOWN_NOTE)
    } else {
        String::new()
    };
    // Findings and attribution take priority. Append the lower-priority stale
    // DESIGN.md notice only if it fits, without consuming its session flag.
    let render = |note: &str, render_config: &HookConfig| render_grouped_template(
        rt,
        &fresh_groups,
        render_config,
        &RenderOpts {
            cwd: Some(display_cwd.clone()),
            short_footer: short,
            reserve_chars: if note.is_empty() { 0.0 } else { (utf16_len(note) + 2) as f64 },
        },
    );
    let mut rendered = render(&attribution_note, &config);
    if !attribution_note.is_empty() && !rendered.lines().any(|line| {
        line.starts_with("- ") && (line.contains("[attribution unknown]") || line.contains("[new]"))
    }) {
        // At the minimum budget, a grouped header and policy footer may crowd
        // out even the first finding. Shorten the notice before losing it.
        attribution_note = format!("{ENVELOPE_PREFIX} {}", stop_baseline::COMPACT_UNKNOWN_NOTE);
        rendered = render(&attribution_note, &config);
    }
    // maxFindings / maxChars may also remove all unknown findings. Do not
    // attach their guidance to an output that only shows confirmed new debt.
    let shows_unknown = rendered.lines().any(|line| {
        line.starts_with("- ") && line.contains("[attribution unknown]")
    });
    if !shows_unknown {
        if let Some(prefix @ 1..) = first_unknown {
            // Reclaim the unused notice budget for the known-new prefix.
            // Keep the unknown suffix omitted: simply expanding the budget
            // could reveal an unknown finding without its required guidance.
            let mut visible_config = config.clone();
            visible_config.limits.max_findings = cap_of(&config).min(prefix) as f64;
            rendered = render("", &visible_config);
        }
    }
    let text = if shows_unknown { format!("{attribution_note}\n\n{rendered}") } else { rendered };
    let text =
        append_design_system_note_once(rt, &text, &scan, &mut passes[lead].cache, &session_id, &config);
    // Findings shown over a comp build already recorded as shipped: a fix voids
    // that finish, so say so with the findings, not after the agent stops.
    let note = match passes.iter().position(|p| p.cwd == session_cwd) {
        Some(i) => {
            passes[i].dirty = true;
            crate::build_completion::finished_build_note(rt, &session_cwd, &session_id, &mut passes[i].cache)
        }
        None => {
            let note = crate::build_completion::finished_build_note(rt, &session_cwd, &session_id, &mut cache);
            if note.is_some() { persist_cache(rt, &session_cwd, &cache); }
            note
        }
    };
    let text = match note {
        Some(note) => format!("{text}\n\n{note}"),
        None => text,
    };
    for &i in &emitting {
        commit_footer_shown(rt, &mut passes[i].cache, &session_id, &text);
        passes[i].dirty = true;
    }
    for pass in passes.iter().filter(|p| p.dirty) {
        persist_cache(rt, &pass.cwd, &pass.cache);
    }
    let all: usize = fresh_groups.iter().map(|g| g.findings.len()).sum();
    RunResult {
        stdout: payload(&text, "Stop", harness),
        audit: with(
            &audit,
            vec![
                ("emitted", Value::Bool(true)),
                ("freshFiles", Value::from(fresh_groups.len())),
                ("freshFindings", Value::from(all)),
                ("chars", Value::from(utf16_len(&text))),
                ("durationMs", ms_since(started)),
            ],
        ),
    }
}

/// JS: hook.mjs#isStopEvent(stdinJson)
fn is_stop_event(stdin: &str) -> bool {
    // JS: hook.mjs#stdinIsStop routes on the raw stdin via hook-lib's
    // isStopEvent, which matches Claude's `hook_event_name: "Stop"` and
    // Grok Build's `hookEventName: "stop"`.
    match serde_json::from_str::<Value>(stdin) {
        Ok(Value::Object(o)) => crate::hook_lib::is_stop_event(&o),
        _ => false,
    }
}

/// `impeccable hook` (hook.mjs main). Returns the exit code (always 0).
pub fn run(rt: &Runtime, stdin: &str, io: &mut impeccable_common::Io) -> i32 {
    if let Ok(Value::Object(event)) = serde_json::from_str::<Value>(stdin) {
        if event.get("hook_event_name").and_then(Value::as_str) == Some("BeforeTool")
            && resolve_harness(rt, Some(&event)) == "gemini" {
            // String checks first: this fires before every Gemini shell call.
            if let Some(output) = crate::build_completion::gemini_shell_identity(rt, &event) {
                if !truthy(rt.env("IMPECCABLE_HOOK_DISABLED")) && read_config(&rt.proc_cwd).enabled {
                    io.out(&format!("{output}\n"));
                }
            }
            return 0;
        }
        if event.get("hook_event_name").and_then(Value::as_str) == Some("SessionStart") {
            let cwd = rt.resolve(&[event.get("cwd").and_then(Value::as_str).unwrap_or(&rt.proc_cwd)]);
            if !truthy(rt.env("IMPECCABLE_HOOK_DISABLED")) && resolve_harness(rt, Some(&event)) == "claude"
                && read_config(&cwd).enabled {
                if let Some(session) = event.get("session_id").and_then(Value::as_str) {
                    crate::build_completion::persist_session_identity(rt, session);
                }
            }
            return 0;
        }
    }
    // JS: process.env.IMPECCABLE_HOOK_DEPTH = process.env.IMPECCABLE_HOOK_DEPTH || '1'
    // is exported for child processes; this binary spawns none, so the
    // pre-mutation snapshot in `rt.env` is the only value that matters.
    let result = if is_stop_event(stdin) {
        run_stop_hook(rt, stdin)
    } else {
        run_hook(rt, stdin)
    };
    write_audit_log(rt, &result.audit, &rt.proc_cwd);
    if !result.stdout.is_empty() {
        io.out(&result.stdout);
    }
    0
}
