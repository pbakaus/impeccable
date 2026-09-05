//! JS: skill/scripts/hook.mjs (`impeccable hook`) and hook-lib.mjs
//! `runHook` / `runStopHook`: the PostToolUse per-edit pass and the Stop deep
//! pass. Always exits 0; stdout is one JSON document or nothing.

use impeccable_core::findings::Finding;
use impeccable_core::js;
use serde_json::{Map, Value};

use crate::hook_lib::*;
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

fn session_key(v: &Option<Value>) -> String {
    match v {
        Some(v) => crate::util::js_string(v),
        None => "unknown".to_string(),
    }
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

    let config = read_config(&project_cwd);
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

    let mut cache = read_cache(&project_cwd);
    let session_id = session_key(&session_value);
    let scan = design_system_options(&config, &project_cwd);
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
        let rel_for_match = relativize(rt, file_path, &project_cwd);
        if matches_any_glob_list(&rel_for_match, &config.ignore_files)
            || matches_any_glob_list(file_path, &config.ignore_files)
        {
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

        if primary_files.contains(file_path) {
            let edit_count = bump_edit_count(&mut cache, &session_id, file_path);
            cache_dirty = true;
            audit.insert("editCount".into(), Value::from(edit_count as u64));
            if edit_count > EDIT_COUNT_THRESHOLD as f64 {
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
            last_skip = "live-preview";
            continue;
        }
        let use_html_engine = match configured {
            Some(c) => c.engine == "html",
            None => ext == ".html" || ext == ".htm",
        };
        let mut detector_threw = false;
        let findings: Vec<Finding> = if use_html_engine {
            match detector_detect_html(rt, file_path, &scan) {
                Ok(f) => f,
                Err(_) => {
                    detector_threw = true;
                    vec![]
                }
            }
        } else {
            detector_detect_text(&content, file_path, &scan)
        };
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
        let fresh = dedupe_against_cache(&immediate, &mut cache, &session_id, file_path);
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
            remember_findings(&mut cache, &session_id, file_path, &immediate);
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
                known: immediate.iter().map(finding_cache_key).collect(),
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

    if !fresh_groups.is_empty() {
        let short = footer_mode_short(&mut cache, &session_id);
        let reserve = design_note_reserve(rt, &scan, &mut cache, &session_id);
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
            append_design_system_note_once(rt, &rendered, &scan, &mut cache, &session_id, &config);
        commit_footer_shown(rt, &mut cache, &session_id, &text);
        persist_cache(rt, &project_cwd, &cache);
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
            ack = Some(Ack::Pending(append_design_system_note_once(
                rt,
                &base,
                &scan,
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
                ack = Some(Ack::Clean(append_design_system_note_once(
                    rt,
                    &base,
                    &scan,
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
    if deferred_total > 0
        || (cache_dirty
            && (exists(&jsp::join(&[&project_cwd, ".impeccable"])) || exists(&get_cache_path(&project_cwd))))
    {
        persist_cache(rt, &project_cwd, &cache);
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
    if event.get("stop_hook_active") == Some(&Value::Bool(true)) {
        return result(
            &audit,
            vec![
                ("skipped", Value::from("stop-hook-active")),
                ("durationMs", ms_since(started)),
            ],
        );
    }
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
    let project_cwd = rt.resolve(&[str_field(&event, "cwd").unwrap_or(&rt.proc_cwd)]);
    audit.insert("cwd".into(), Value::String(project_cwd.clone()));
    let session_value = session_id_of(&event);
    let session_id = session_key(&session_value);
    audit.insert(
        "session".into(),
        session_value.unwrap_or_else(|| Value::from("unknown")),
    );

    let config = read_config(&project_cwd);
    if !config.enabled {
        return result(
            &audit,
            vec![
                ("skipped", Value::from("config-disabled")),
                ("durationMs", ms_since(started)),
            ],
        );
    }
    let mut cache = read_cache(&project_cwd);
    let touched = touched_files(&cache, &session_id);
    if touched.is_empty() {
        return result(
            &audit,
            vec![
                ("skipped", Value::from("no-touched-files")),
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
    let scan = design_system_options(&config, &project_cwd);

    let mut fresh_groups: Vec<Group> = Vec::new();
    let mut scanned = 0usize;
    let mut cache_dirty = false;
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
        let configured = match_configured_extension(file_path, &config.extensions);
        if !ALLOWED_EXTS.contains(&ext.as_str()) && configured.is_none() {
            continue;
        }
        let rel = relativize(rt, file_path, &project_cwd);
        if matches_any_glob_list(&rel, &config.ignore_files)
            || matches_any_glob_list(file_path, &config.ignore_files)
        {
            continue;
        }
        if !exists(file_path) || !is_scan_target_inside_project(rt, file_path, &project_cwd) {
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
        let use_html_engine = match configured {
            Some(c) => c.engine == "html",
            None => ext == ".html" || ext == ".htm",
        };
        // JS: a detector failure tells us nothing about the file. Leave
        // whatever was remembered alone rather than recording an empty scan
        // as truth. (detectText cannot throw here: the Rust engine returns
        // findings directly.)
        let findings = if use_html_engine {
            match detector_detect_html(rt, file_path, &scan) {
                Ok(f) => f,
                Err(_) => continue,
            }
        } else {
            detector_detect_text(&content, file_path, &scan)
        };
        let filtered = filter_findings(findings, &config);
        let fresh = dedupe_against_cache(&filtered, &mut cache, &session_id, file_path);
        // JS: sync to the live scan, including empty. Remembering only
        // `fresh` (or skipping the write on a clean Stop) left stale keys in
        // place, so a finding that was fixed and later reintroduced never
        // fired again.
        remember_findings(&mut cache, &session_id, file_path, &filtered);
        cache_dirty = true;
        if !fresh.is_empty() {
            fresh_groups.push(Group {
                file_path: file_path.clone(),
                findings: fresh,
            });
        }
    }
    audit.insert("scannedFiles".into(), Value::from(scanned));
    if fresh_groups.is_empty() {
        if cache_dirty {
            persist_cache(rt, &project_cwd, &cache);
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
    let short = footer_mode_short(&mut cache, &session_id);
    let reserve = design_note_reserve(rt, &scan, &mut cache, &session_id);
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
        append_design_system_note_once(rt, &rendered, &scan, &mut cache, &session_id, &config);
    commit_footer_shown(rt, &mut cache, &session_id, &text);
    persist_cache(rt, &project_cwd, &cache);
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
