//! JS: live-accept.mjs -> `impeccable live-accept` / `accept`. Deterministic
//! accept/discard of variant sessions: HTML/JSX wrapper carbonize, the
//! Svelte component inline path, receipts, source locks, buffer scrub.

use crate::paths::{live_dir, safe_session_id};
use crate::pending_edits::{read_buffer, write_buffer};
use crate::roots::enter_live_root;
use crate::source_lock::with_source_lock;
use crate::source_search::{find_source_file, is_generated_file, resolve_live_template_extensions};
use crate::svelte_component::{
    find_svelte_component_manifest, inline_svelte_component_accept, remove_svelte_component_session,
};
use crate::util::{eprintln, iso_now, json_compact, json_pretty, jsp, println, safe_read, Env};
use crate::wrap_common::{arg_val, leading_ws, min_leading_spaces, slice_chars};
use impeccable_common::Io;
use impeccable_core::js::{trim, trim_start, WS};
use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::{json, Map, Value};

const ACCEPT_LOCK_WAIT_MS: f64 = 1000.0;

const HELP: &str = "Usage: impeccable live-accept [options]

Deterministic accept/discard for live variant sessions.

Modes:
  --discard          Remove variants, restore original
  --variant N        Accept variant N, discard the rest

Required:
  --id SESSION_ID    Session ID of the variant wrapper

Options:
  --page-url URL     Current browser page URL; scopes staged copy-edit cleanup
  --defer-source-write
                     Deprecated compatibility flag. Svelte component accepts
                     now write the real source immediately.

Output (JSON):
  { handled, file, carbonize }";

pub fn run(args: &[String], io: &mut Io) -> i32 {
    let mut argv: Vec<String> = args.to_vec();
    if let Err(code) = enter_live_root(&mut argv, io) {
        return code;
    }
    accept_cli(&argv, io)
}

fn nonempty(v: Option<String>) -> Option<String> {
    v.filter(|s| !s.is_empty())
}

/// JS: operationFailure(err, extra)
fn operation_failure(message: &str, extra: &[(&str, Value)]) -> Value {
    let mut m = Map::new();
    m.insert("handled".into(), Value::Bool(false));
    m.insert("mode".into(), Value::String("error".into()));
    m.insert("error".into(), Value::String(message.to_string()));
    for (k, v) in extra {
        m.insert(k.to_string(), v.clone());
    }
    Value::Object(m)
}

/// JS: markPreviewFailure(result)
fn mark_preview_failure(result: Value) -> Value {
    if let Value::Object(mut m) = result {
        let unhandled = m.get("handled") == Some(&Value::Bool(false));
        let no_mode = m
            .get("mode")
            .map(|v| !crate::inject::detect_utils::truthy(v))
            .unwrap_or(true);
        let preview = m
            .get("previewMode")
            .map(crate::inject::detect_utils::truthy)
            .unwrap_or(false);
        if unhandled && no_mode && preview {
            m.insert("mode".into(), Value::String("error".into()));
        }
        Value::Object(m)
    } else {
        result
    }
}

fn accept_receipt_path(cwd: &str, env: &Env, id: &str) -> String {
    jsp::join(&[
        &live_dir(cwd, env),
        "accept-receipts",
        &format!("{}.json", id),
    ])
}

fn read_accept_receipt(cwd: &str, env: &Env, id: &str) -> Option<Value> {
    let text = safe_read(&accept_receipt_path(cwd, env, id))?;
    serde_json::from_str(&text).ok()
}

fn write_accept_receipt(
    cwd: &str,
    env: &Env,
    id: &str,
    operation: &str,
    variant_id: Option<&str>,
    result: &Value,
) {
    let file = accept_receipt_path(cwd, env, id);
    if let Some(parent) = std::path::Path::new(&file).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let mut m = Map::new();
    m.insert("id".into(), Value::String(id.to_string()));
    m.insert("operation".into(), Value::String(operation.to_string()));
    m.insert(
        "variantId".into(),
        variant_id
            .map(|v| Value::String(v.to_string()))
            .unwrap_or(Value::Null),
    );
    m.insert("result".into(), result.clone());
    m.insert("completedAt".into(), Value::String(iso_now()));
    let tmp = format!(
        "{}.{}.{}.tmp",
        file,
        std::process::id(),
        crate::util::now_ms() as i64
    );
    if std::fs::write(&tmp, format!("{}\n", json_pretty(&Value::Object(m)))).is_ok() {
        let _ = std::fs::rename(&tmp, &file);
    }
}

fn accept_cli(args: &[String], io: &mut Io) -> i32 {
    if args.iter().any(|a| a == "--help" || a == "-h") {
        println(io, HELP);
        return 0;
    }
    let cwd = io.cwd.to_string_lossy().into_owned();
    let env = io.env.clone();

    let id = nonempty(arg_val(args, "--id"));
    let variant_num = nonempty(arg_val(args, "--variant"));
    let param_values_raw = nonempty(arg_val(args, "--param-values"));
    let page_url = nonempty(arg_val(args, "--page-url"));
    let is_discard = args.iter().any(|a| a == "--discard");

    let Some(id) = id else {
        eprintln(io, "Missing --id");
        return 1;
    };
    if safe_session_id(&id).is_err() {
        eprintln(io, "Invalid --id");
        return 1;
    }
    if !is_discard && variant_num.is_none() {
        eprintln(io, "Need --discard or --variant N");
        return 1;
    }
    if !is_discard {
        let v = variant_num.as_deref().unwrap_or("");
        let ok = !v.is_empty() && v.len() <= 3 && v.bytes().all(|b| b.is_ascii_digit());
        if !ok {
            eprintln(io, "Invalid --variant");
            return 1;
        }
    }
    let variant_num = variant_num.unwrap_or_default();

    let requested_operation = if is_discard { "discard" } else { "accept" };
    if let Some(prior) = read_accept_receipt(&cwd, &env, &id) {
        let prior_op = prior
            .get("operation")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let prior_variant = prior.get("variantId").cloned().unwrap_or(Value::Null);
        let same = prior_op == requested_operation
            && (is_discard || crate::accept_css::js_string(&prior_variant) == variant_num);
        let out = if same {
            let mut m = match prior.get("result") {
                Some(Value::Object(o)) => o.clone(),
                _ => Map::new(),
            };
            m.insert("handled".into(), Value::Bool(true));
            m.insert("alreadyApplied".into(), Value::Bool(true));
            Value::Object(m)
        } else {
            json!({
                "handled": false,
                "mode": "error",
                "error": "accept_receipt_conflict",
                "priorOperation": prior.get("operation").cloned().unwrap_or(Value::Null),
                "priorVariantId": prior_variant,
            })
        };
        println(io, &json_compact(&out));
        return 0;
    }

    let emit_result = |io: &mut Io, raw: Value| {
        let result = mark_preview_failure(raw);
        if result.get("handled") != Some(&Value::Bool(false)) {
            write_accept_receipt(
                &cwd,
                &env,
                &id,
                requested_operation,
                if is_discard {
                    None
                } else {
                    Some(variant_num.as_str())
                },
                &result,
            );
        }
        println(io, &json_compact(&result));
    };

    let param_values: Option<Map<String, Value>> =
        param_values_raw
            .as_deref()
            .and_then(|raw| match serde_json::from_str::<Value>(raw) {
                Ok(Value::Object(o)) => Some(o),
                _ => None,
            });

    let found = find_session_file(&id, &cwd);
    let svelte_manifest = if found.is_some() {
        None
    } else {
        match find_svelte_component_manifest(&id, &cwd) {
            Ok(m) => m,
            Err(e) => {
                eprintln(io, &format!("Error: {}", e));
                return 1;
            }
        }
    };

    if found.is_none() && svelte_manifest.is_none() {
        println(
            io,
            &json_compact(
                &json!({ "handled": false, "error": format!("Session markers not found for id: {}", id) }),
            ),
        );
        return 0;
    }

    if let Some(manifest) = svelte_manifest {
        let source_file = manifest.get("sourceFile").cloned().unwrap_or(Value::Null);
        let component_dir = manifest.get("componentDir").cloned().unwrap_or(Value::Null);
        let mut context: Vec<(&str, Value)> = vec![("file", source_file.clone())];
        if is_discard {
            context.push(("carbonize", Value::Bool(false)));
        } else {
            context.push(("sourceFile", source_file.clone()));
        }
        context.push(("previewMode", Value::String("svelte-component".into())));
        context.push(("componentDir", component_dir));

        let sf_str = crate::accept_css::js_string(&source_file);
        let lock_file = jsp::resolve(&cwd, &[&sf_str]);
        let owner = format!("{}:{}", requested_operation, id);
        let locked = with_source_lock(&lock_file, &owner, &cwd, &env, ACCEPT_LOCK_WAIT_MS, || {
            if is_discard {
                remove_svelte_component_session(&id, &cwd);
                let mut m = Map::new();
                m.insert("handled".into(), Value::Bool(true));
                for (k, v) in &context {
                    m.insert(k.to_string(), v.clone());
                }
                Ok(Value::Object(m))
            } else {
                inline_svelte_component_accept(&manifest, &variant_num, param_values.as_ref(), &cwd)
            }
        });
        let mut result = match locked {
            Ok(Ok(v)) => v,
            Ok(Err(msg)) => operation_failure(&msg, &context),
            Err(lock) => operation_failure(&lock.message, &context),
        };
        if let Value::Object(m) = &mut result {
            if m.get("carbonize")
                .map(crate::inject::detect_utils::truthy)
                .unwrap_or(false)
            {
                let file = m
                    .get("file")
                    .map(crate::accept_css::js_string)
                    .unwrap_or_default();
                m.insert(
                    "todo".into(),
                    Value::String(format!(
                        "REQUIRED before next poll: carbonize cleanup in {}. See reference/live.md \"Required after accept\".",
                        file
                    )),
                );
            }
            let handled = m.get("handled") != Some(&Value::Bool(false));
            m.insert("handled".into(), Value::Bool(handled));
            // `{ handled, ...result }`: handled stays first (it already is).
        }
        emit_result(io, result);
        return 0;
    }

    let (target_file, content, lines) = found.unwrap();
    let rel_file = jsp::relative("/", &cwd, &target_file);
    let preview_block = find_marker_block(&id, &lines);
    let source_shadow = preview_block.is_some() && read_source_shadow_preview_meta(&content, &id);
    if source_shadow {
        println(
            io,
            &json_compact(&json!({
                "handled": false,
                "error": "source_shadow_preview_deprecated",
                "hint": "Svelte live mode now uses svelte-component injection. Re-wrap the element and regenerate variants.",
            })),
        );
        return 0;
    }
    if is_generated_file(&target_file, &cwd) {
        println(
            io,
            &json_compact(&json!({
                "handled": false,
                "mode": "fallback",
                "file": rel_file,
                "hint": "Session is in a generated file. Persist the accepted variant in source; do not rely on this script.",
            })),
        );
        return 0;
    }

    if is_discard {
        let owner = format!("discard:{}", id);
        let locked = with_source_lock(
            &target_file,
            &owner,
            &cwd,
            &env,
            ACCEPT_LOCK_WAIT_MS,
            || {
                let lines: Vec<String> = safe_read(&target_file)
                    .unwrap_or_default()
                    .split('\n')
                    .map(String::from)
                    .collect();
                handle_discard_unlocked(&id, &lines, &target_file)
            },
        );
        match locked {
            Err(lock) => {
                emit_result(
                    io,
                    operation_failure(&lock.message, &[("file", Value::String(rel_file))]),
                );
            }
            Ok(result) => {
                let mut m = Map::new();
                m.insert("handled".into(), Value::Bool(true));
                m.insert("file".into(), Value::String(rel_file));
                m.insert("carbonize".into(), Value::Bool(false));
                match result {
                    Ok(()) => {}
                    Err(err) => {
                        m.insert("handled".into(), Value::Bool(false));
                        m.insert("error".into(), Value::String(err));
                    }
                }
                emit_result(io, Value::Object(m));
            }
        }
    } else {
        let owner = format!("accept:{}", id);
        let locked = with_source_lock(
            &target_file,
            &owner,
            &cwd,
            &env,
            ACCEPT_LOCK_WAIT_MS,
            || {
                let lines: Vec<String> = safe_read(&target_file)
                    .unwrap_or_default()
                    .split('\n')
                    .map(String::from)
                    .collect();
                handle_accept_unlocked(
                    &id,
                    &variant_num,
                    &lines,
                    &target_file,
                    param_values.as_ref(),
                )
            },
        );
        match locked {
            Err(lock) => {
                emit_result(
                    io,
                    operation_failure(&lock.message, &[("file", Value::String(rel_file))]),
                );
            }
            Ok(Err(err)) => {
                // JS: `{ handled: true, file, ...result }` with result.handled false.
                let mut m = Map::new();
                m.insert("handled".into(), Value::Bool(false));
                m.insert("file".into(), Value::String(rel_file));
                m.insert("error".into(), Value::String(err));
                emit_result(io, Value::Object(m));
            }
            Ok(Ok((carbonize, accepted_original_text))) => {
                let mut m = Map::new();
                m.insert("handled".into(), Value::Bool(true));
                m.insert("file".into(), Value::String(rel_file.clone()));
                m.insert("carbonize".into(), Value::Bool(carbonize));
                if carbonize {
                    m.insert(
                        "todo".into(),
                        Value::String(format!(
                            "REQUIRED before next poll: carbonize cleanup in {}. See reference/live.md \"Required after accept\".",
                            rel_file
                        )),
                    );
                }
                scrub_manual_edits_against_original_block(
                    &accepted_original_text,
                    &cwd,
                    &env,
                    page_url.as_deref(),
                );
                emit_result(io, Value::Object(m));
            }
        }
    }
    0
}

// ---------------------------------------------------------------------------
// Buffer scrub
// ---------------------------------------------------------------------------

static TAG_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"<[^>]*>").unwrap());
static JSX_COMMENT_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?s)\{/\*.*?\*/\}").unwrap());
static HTML_COMMENT_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?s)<!--.*?-->").unwrap());
static WS_RUN_RE: Lazy<Regex> = Lazy::new(|| Regex::new(&format!("{}+", WS)).unwrap());

fn normalize_manual_edit_text(text: &str) -> String {
    trim(&WS_RUN_RE.replace_all(text, " ")).to_string()
}

fn manual_edit_text_segments(source: &str) -> Vec<String> {
    let a = TAG_RE.replace_all(source, "\n");
    let b = JSX_COMMENT_RE.replace_all(&a, "\n");
    let c = HTML_COMMENT_RE.replace_all(&b, "\n");
    c.split('\n')
        .map(normalize_manual_edit_text)
        .filter(|s| !s.is_empty())
        .collect()
}

fn original_block_has_exact_manual_text(block: &str, text: &str) -> bool {
    let needle = normalize_manual_edit_text(text);
    if needle.is_empty() {
        return false;
    }
    manual_edit_text_segments(block)
        .iter()
        .any(|s| *s == needle)
}

fn manual_edit_op_appears_in_block(op: &Value, block: &str) -> bool {
    [op.get("newText"), op.get("originalText")]
        .iter()
        .filter_map(|v| v.and_then(|x| x.as_str()))
        .filter(|s| !s.is_empty())
        .any(|s| original_block_has_exact_manual_text(block, s))
}

/// JS: scrubManualEditsAgainstOriginalBlock(originalBlockText, cwd, pageUrl)
fn scrub_manual_edits_against_original_block(
    block: &str,
    cwd: &str,
    env: &Env,
    page_url: Option<&str>,
) {
    if block.is_empty() {
        return;
    }
    let Some(page_url) = page_url else { return };
    let mut entries = read_buffer(cwd, env);
    if entries.is_empty() {
        return;
    }
    let mut mutated = false;
    for entry in entries.iter_mut() {
        if entry.get("pageUrl").and_then(|v| v.as_str()) != Some(page_url) {
            continue;
        }
        let ops: Vec<Value> = match entry.get("ops") {
            Some(Value::Array(a)) => a.clone(),
            _ => Vec::new(),
        };
        let before = ops.len();
        let kept: Vec<Value> = ops
            .into_iter()
            .filter(|op| !manual_edit_op_appears_in_block(op, block))
            .collect();
        if kept.len() != before {
            mutated = true;
        }
        if let Value::Object(o) = entry {
            o.insert("ops".into(), Value::Array(kept));
        }
    }
    let entries: Vec<Value> = entries
        .into_iter()
        .filter(|e| matches!(e.get("ops"), Some(Value::Array(a)) if !a.is_empty()))
        .collect();
    if mutated {
        write_buffer(cwd, env, &entries);
    }
}

// ---------------------------------------------------------------------------
// Discard / Accept
// ---------------------------------------------------------------------------

struct MarkerBlock {
    start: usize,
    end: usize,
}

/// JS: findMarkerBlock(id, lines)
fn find_marker_block(id: &str, lines: &[String]) -> Option<MarkerBlock> {
    let start_pattern = format!("impeccable-variants-start {}", id);
    let end_pattern = format!("impeccable-variants-end {}", id);
    let mut start: Option<usize> = None;
    let mut end: Option<usize> = None;
    for (i, line) in lines.iter().enumerate() {
        if start.is_none() && line.contains(&start_pattern) {
            start = Some(i);
        }
        if line.contains(&end_pattern) {
            end = Some(i);
            break;
        }
    }
    match (start, end) {
        (Some(s), Some(e)) => Some(MarkerBlock { start: s, end: e }),
        _ => None,
    }
}

fn is_jsx_file(path: &str) -> bool {
    let ext = jsp::extname(path).to_lowercase();
    ext == ".jsx" || ext == ".tsx"
}

fn comment_syntax_for(path: &str) -> (&'static str, &'static str) {
    if is_jsx_file(path) {
        ("{/*", "*/}")
    } else {
        ("<!--", "-->")
    }
}

/// JS: handleDiscardUnlocked → Ok(()) or Err(error)
fn handle_discard_unlocked(id: &str, lines: &[String], target_file: &str) -> Result<(), String> {
    let Some(block) = find_marker_block(id, lines) else {
        return Err("Markers not found".to_string());
    };
    let original = extract_original(lines, &block);
    let is_jsx = is_jsx_file(target_file);
    let (rs, re) = expand_replace_range(&block, lines, is_jsx, id);
    let indent = leading_ws(&lines[rs]);
    let restored = deindent_content(&original, &indent);
    let mut new_lines: Vec<String> = Vec::new();
    new_lines.extend_from_slice(&lines[..rs]);
    new_lines.extend(restored);
    new_lines.extend_from_slice(&lines[(re + 1).min(lines.len())..]);
    let _ = std::fs::write(target_file, new_lines.join("\n"));
    Ok(())
}

/// JS: buildCarbonizeReplacement({...})
fn build_carbonize_replacement(
    indent: &str,
    cs: (&str, &str),
    is_jsx: bool,
    id: &str,
    variant_num: &str,
    css: Option<&[String]>,
    param_values: Option<&Map<String, Value>>,
    restored: &[String],
) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    let Some(css) = css else {
        lines.extend_from_slice(restored);
        return lines;
    };
    let (co, cc) = cs;
    let variant_style_attr = if is_jsx {
        "style={{ display: 'contents' }}"
    } else {
        "style=\"display: contents\""
    };
    let push_body = |lines: &mut Vec<String>, body_indent: &str| {
        let body_restored = reindent_content(restored, indent, &format!("{}  ", body_indent));
        lines.push(format!(
            "{}{} impeccable-carbonize-start {} {}",
            body_indent, co, id, cc
        ));
        lines.push(format!(
            "{}<style data-impeccable-css=\"{}\">{}",
            body_indent,
            id,
            if is_jsx { "{`" } else { "" }
        ));
        for css_line in css {
            lines.push(format!("{}{}", body_indent, trim_start(css_line)));
        }
        lines.push(format!(
            "{}{}",
            body_indent,
            if is_jsx { "`}</style>" } else { "</style>" }
        ));
        if let Some(pv) = param_values {
            if !pv.is_empty() {
                lines.push(format!(
                    "{}{} impeccable-param-values {}: {} {}",
                    body_indent,
                    co,
                    id,
                    json_compact(&Value::Object(pv.clone())),
                    cc
                ));
            }
        }
        lines.push(format!(
            "{}{} impeccable-carbonize-end {} {}",
            body_indent, co, id, cc
        ));
        lines.push(format!(
            "{}<div data-impeccable-variant=\"{}\" {}>",
            body_indent, variant_num, variant_style_attr
        ));
        lines.extend(body_restored);
        lines.push(format!("{}</div>", body_indent));
    };
    if is_jsx {
        lines.push(format!(
            "{}<div data-impeccable-carbonize=\"{}\" style={{{{ display: \"contents\" }}}}>",
            indent, id
        ));
        push_body(&mut lines, &format!("{}  ", indent));
        lines.push(format!("{}</div>", indent));
    } else {
        push_body(&mut lines, indent);
    }
    lines
}

/// JS: reindentContent(contentLines, fromIndent, toIndent)
fn reindent_content(content: &[String], from_indent: &str, to_indent: &str) -> Vec<String> {
    content
        .iter()
        .map(|line| {
            if trim(line).is_empty() {
                return String::new();
            }
            if let Some(rest) = line.strip_prefix(from_indent) {
                return format!("{}{}", to_indent, rest);
            }
            format!("{}{}", to_indent, trim_start(line))
        })
        .collect()
}

/// JS: handleAcceptUnlocked → Ok((carbonize, acceptedOriginalText)) or Err(error)
fn handle_accept_unlocked(
    id: &str,
    variant_num: &str,
    lines: &[String],
    target_file: &str,
    param_values: Option<&Map<String, Value>>,
) -> Result<(bool, String), String> {
    let Some(block) = find_marker_block(id, lines) else {
        return Err("Markers not found".to_string());
    };
    let cs = comment_syntax_for(target_file);
    let is_jsx = cs.0 == "{/*";
    let (rs, re) = expand_replace_range(&block, lines, is_jsx, id);
    let indent = leading_ws(&lines[rs]);
    let Some(variant_content) = extract_variant(lines, &block, variant_num) else {
        return Err(format!("Variant {} not found", variant_num));
    };
    let original_content = extract_original(lines, &block);
    let css_content = extract_css(lines, &block, id);
    let variant_text = variant_content.join("\n");
    let has_helper_attrs = variant_text.contains("data-impeccable-variant");
    let needs_carbonize = css_content.is_some() || has_helper_attrs;
    let restored = deindent_content(&variant_content, &indent);
    let replacement = build_carbonize_replacement(
        &indent,
        cs,
        is_jsx,
        id,
        variant_num,
        css_content.as_deref(),
        param_values,
        &restored,
    );
    let mut new_lines: Vec<String> = Vec::new();
    new_lines.extend_from_slice(&lines[..rs]);
    new_lines.extend(replacement);
    new_lines.extend_from_slice(&lines[(re + 1).min(lines.len())..]);
    let _ = std::fs::write(target_file, new_lines.join("\n"));
    Ok((needs_carbonize, original_content.join("\n")))
}

/// JS: readSourceShadowPreviewMeta(content, id) → whether the wrapper carries
/// `data-impeccable-preview="source-shadow"` (the only bit accept acts on).
fn read_source_shadow_preview_meta(content: &str, id: &str) -> bool {
    // /<[^>]+data-impeccable-variants=(["'])ID\1[^>]*>/
    let chars: Vec<char> = content.chars().collect();
    let needle: Vec<char> = "data-impeccable-variants=".chars().collect();
    let mut i = 0;
    let mut tag: Option<String> = None;
    while i + needle.len() <= chars.len() {
        if chars[i..i + needle.len()] == needle[..] {
            let q_at = i + needle.len();
            let idc: Vec<char> = id.chars().collect();
            if let Some(&q) = chars.get(q_at) {
                if (q == '"' || q == '\'')
                    && q_at + 1 + idc.len() < chars.len()
                    && chars[q_at + 1..q_at + 1 + idc.len()] == idc[..]
                    && chars[q_at + 1 + idc.len()] == q
                {
                    // Walk back to the nearest `<` with no `>` between; forward to `>`.
                    let mut s = i;
                    let mut ok = false;
                    while s > 0 {
                        s -= 1;
                        if chars[s] == '>' {
                            break;
                        }
                        if chars[s] == '<' {
                            ok = s + 1 < i;
                            break;
                        }
                    }
                    if ok {
                        let mut e = q_at + 2 + idc.len();
                        while e < chars.len() && chars[e] != '>' {
                            e += 1;
                        }
                        if e < chars.len() {
                            tag = Some(chars[s..=e].iter().collect());
                            break;
                        }
                    }
                }
            }
        }
        i += 1;
    }
    let Some(tag) = tag else { return false };
    let preview = read_html_attr(&tag, "data-impeccable-preview");
    if preview.as_deref() != Some("source-shadow") {
        return false;
    }
    let source_file = read_html_attr(&tag, "data-impeccable-source-file");
    let start = read_html_attr(&tag, "data-impeccable-source-start")
        .map(|s| impeccable_core::js::string_to_number(&s))
        .unwrap_or(0.0);
    let end = read_html_attr(&tag, "data-impeccable-source-end")
        .map(|s| impeccable_core::js::string_to_number(&s))
        .unwrap_or(0.0);
    let sf_ok = source_file.map(|s| !s.is_empty()).unwrap_or(false);
    sf_ok && start.is_finite() && end.is_finite()
}

/// JS: readHtmlAttr(tag, name): `/\s<name>\s*=\s*(["'])(.*?)\1/`
fn read_html_attr(tag: &str, name: &str) -> Option<String> {
    let chars: Vec<char> = tag.chars().collect();
    let needle: Vec<char> = name.chars().collect();
    let mut i = 0;
    while i + 1 + needle.len() <= chars.len() {
        if impeccable_core::js::is_js_whitespace(chars[i])
            && chars[i + 1..i + 1 + needle.len()] == needle[..]
        {
            let mut j = i + 1 + needle.len();
            while j < chars.len() && impeccable_core::js::is_js_whitespace(chars[j]) {
                j += 1;
            }
            if j < chars.len() && chars[j] == '=' {
                j += 1;
                while j < chars.len() && impeccable_core::js::is_js_whitespace(chars[j]) {
                    j += 1;
                }
                if let Some((content, _)) = crate::accept_css::quoted_lazy(&chars, j, &|_, _| true)
                {
                    return Some(decode_html_attr(&content));
                }
            }
        }
        i += 1;
    }
    None
}

fn decode_html_attr(value: &str) -> String {
    value
        .replace("&quot;", "\"")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

/// JS: isVariantEndMarkerLine(line, id): `impeccable-variants-end\s+ID(?:\s|--|\*/|$)`
fn is_variant_end_marker_line(line: &str, id: &str) -> bool {
    let re = Regex::new(&format!(
        r"impeccable-variants-end{ws}+{id}(?:{ws}|--|\*/|$)",
        ws = WS,
        id = regex::escape(id)
    ))
    .unwrap();
    re.is_match(line)
}

/// JS: hasVariantWrapperAttr(line, id)
fn has_variant_wrapper_attr(line: &str, id: &str) -> bool {
    let e = regex::escape(id);
    let re = Regex::new(&format!(
        r#"data-impeccable-variants{ws}*={ws}*(?:"{id}"|'{id}'|\{{["']{id}["']\}})"#,
        ws = WS,
        id = e
    ))
    .unwrap();
    re.is_match(line)
}

static DIV_OPEN_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"<div(?-u:\b)").unwrap());
static DIV_TAG_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(&format!(r"<div(?-u:\b)[^>]*?(/?)>|</div{}*>", WS)).unwrap());

/// JS: expandReplaceRange(block, lines, isJsx) → (start, end)
fn expand_replace_range(
    block: &MarkerBlock,
    lines: &[String],
    is_jsx: bool,
    id: &str,
) -> (usize, usize) {
    if !is_jsx {
        return (block.start, block.end);
    }
    let mut start = block.start;
    let mut end = block.end;
    let mut i = block.start as i64 - 1;
    while i >= 0 {
        let iu = i as usize;
        if is_variant_end_marker_line(&lines[iu], id) {
            break;
        }
        if has_variant_wrapper_attr(&lines[iu], id) {
            let mut opener = iu;
            while opener > 0
                && !DIV_OPEN_RE.is_match(&lines[opener])
                && !is_variant_end_marker_line(&lines[opener], id)
            {
                opener -= 1;
            }
            if DIV_OPEN_RE.is_match(&lines[opener]) {
                start = opener;
            }
            break;
        }
        i -= 1;
    }
    let joined = lines[start..].join("\n");
    let mut depth: i64 = 0;
    for m in DIV_TAG_RE.captures_iter(&joined) {
        let whole = m.get(0).unwrap();
        let is_close = whole.as_str().starts_with("</");
        let is_self_close = !is_close && m.get(1).map(|g| g.as_str() == "/").unwrap_or(false);
        if is_close {
            depth -= 1;
        } else if !is_self_close {
            depth += 1;
        }
        if depth <= 0 {
            let lines_before = joined[..whole.end()].matches('\n').count();
            let candidate_end = start + lines_before;
            if candidate_end >= end {
                end = candidate_end;
                break;
            }
        }
    }
    (start, end)
}

static STYLE_FULL_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(&format!(r"(?s)<style(?-u:\b)[^>]*>.*?</style{}*>", WS)).unwrap());
static STYLE_SELF_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(&format!(r"<style(?-u:\b)[^>]*/{}*>", WS)).unwrap());
static STYLE_OPEN_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"<style(?-u:\b)").unwrap());
static STYLE_CLOSE_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(&format!(r"</style{}*>", WS)).unwrap());

/// JS: stripStyleAndJoin(lines, block)
fn strip_style_and_join(lines: &[String], block: &MarkerBlock) -> String {
    let mut out: Vec<String> = Vec::new();
    let mut in_style = false;
    for line in &lines[block.start..=block.end.min(lines.len() - 1)] {
        if !in_style {
            let a = STYLE_FULL_RE.replace_all(line, "");
            let mut l = STYLE_SELF_RE.replace_all(&a, "").into_owned();
            if let Some(m) = STYLE_OPEN_RE.find(&l) {
                l = l[..m.start()].to_string();
                in_style = true;
            }
            out.push(l);
        } else if let Some(m) = STYLE_CLOSE_RE.find(line) {
            in_style = false;
            let rest = &line[m.start()..];
            out.push(STYLE_CLOSE_RE.replacen(rest, 1, "").into_owned());
        }
    }
    out.join("\n")
}

/// JS: extractInnerByAttr(text, attrMatch) with `attrMatch` a literal.
fn extract_inner_by_attr(text: &str, attr: &str) -> Option<String> {
    // /<([A-Za-z][A-Za-z0-9]*)\b[^>]*ATTR[^>]*>/
    let opener_re = Regex::new(&format!(
        r"<([A-Za-z][A-Za-z0-9]*)(?-u:\b)[^>]*{}[^>]*>",
        regex::escape(attr)
    ))
    .ok()?;
    let m = opener_re.captures(text)?;
    let tag_name = m[1].to_string();
    let whole = m.get(0).unwrap();
    let inner_start = whole.end();
    let tag_re = Regex::new(&format!(
        r"<(?:/)?{}(?-u:\b)[^>]*>",
        regex::escape(&tag_name)
    ))
    .ok()?;
    let self_close_re = Regex::new(&format!(r"/{}*>$", WS)).unwrap();
    let mut depth = 1i64;
    for t in tag_re.find_iter(&text[inner_start..]) {
        let s = t.as_str();
        let is_close = s.starts_with("</");
        let is_self_close = !is_close && self_close_re.is_match(s);
        if is_close {
            depth -= 1;
            if depth == 0 {
                return Some(text[inner_start..inner_start + t.start()].to_string());
            }
        } else if !is_self_close {
            depth += 1;
        }
    }
    None
}

/// JS: extractOriginal(lines, block)
fn extract_original(lines: &[String], block: &MarkerBlock) -> Vec<String> {
    let text = strip_style_and_join(lines, block);
    match extract_inner_by_attr(&text, "data-impeccable-variant=\"original\"") {
        None => Vec::new(),
        Some(inner) => inner.split('\n').map(String::from).collect(),
    }
}

/// JS: extractVariant(lines, block, variantNum)
fn extract_variant(
    lines: &[String],
    block: &MarkerBlock,
    variant_num: &str,
) -> Option<Vec<String>> {
    let text = strip_style_and_join(lines, block);
    let inner = extract_inner_by_attr(
        &text,
        &format!("data-impeccable-variant=\"{}\"", variant_num),
    )?;
    let mut result: Vec<String> = inner.split('\n').map(String::from).collect();
    while result.len() > 1 && trim(&result[0]).is_empty() {
        result.remove(0);
    }
    while result.len() > 1 && trim(result.last().unwrap()).is_empty() {
        result.pop();
    }
    if result.is_empty() {
        None
    } else {
        Some(result)
    }
}

static STYLE_SAME_LINE_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(&format!(r"(?s)<style(?-u:\b)[^>]*>(.*?)</style{}*>", WS)).unwrap());

/// JS: extractCss(lines, block, id)
fn extract_css(lines: &[String], block: &MarkerBlock, id: &str) -> Option<Vec<String>> {
    let style_attr = format!("data-impeccable-css=\"{}\"", id);
    let mut in_style = false;
    let mut content: Vec<String> = Vec::new();
    for line in &lines[block.start..=block.end.min(lines.len() - 1)] {
        if !in_style && line.contains(&style_attr) {
            if STYLE_SELF_RE.is_match(line) {
                return None;
            }
            if let Some(c) = STYLE_SAME_LINE_RE.captures(line) {
                let inner = strip_jsx_template_wrap(&c[1]);
                return if inner.is_empty() {
                    None
                } else {
                    Some(inner.split('\n').map(String::from).collect())
                };
            }
            in_style = true;
            continue;
        }
        if in_style {
            if line.contains("</style>") {
                break;
            }
            content.push(line.clone());
        }
    }
    if content.is_empty() {
        return None;
    }
    strip_jsx_template_lines(&content)
}

/// JS: stripJsxTemplateLines(content)
fn strip_jsx_template_lines(content: &[String]) -> Option<Vec<String>> {
    let mut out: Vec<String> = content.to_vec();
    while out.first().map(|l| trim(l).is_empty()).unwrap_or(false) {
        out.remove(0);
    }
    while out.last().map(|l| trim(l).is_empty()).unwrap_or(false) {
        out.pop();
    }
    if out.is_empty() {
        return None;
    }
    let first_trim = trim_start(&out[0]).to_string();
    if first_trim == "{`" {
        out.remove(0);
    } else if first_trim.starts_with("{`") {
        let idx = out[0].find("{`").unwrap();
        out[0] = format!("{}{}", &out[0][..idx], &out[0][idx + 2..]);
        if trim(&out[0]).is_empty() {
            out.remove(0);
        }
    }
    if out.is_empty() {
        return None;
    }
    let last_idx = out.len() - 1;
    let last_trim = out[last_idx]
        .trim_end_matches(impeccable_core::js::is_js_whitespace)
        .to_string();
    if last_trim == "`}" {
        out.pop();
    } else if last_trim.ends_with("`}") {
        let text = out[last_idx].clone();
        let idx = text.rfind("`}").unwrap();
        out[last_idx] = format!("{}{}", &text[..idx], &text[idx + 2..]);
        if trim(&out[last_idx]).is_empty() {
            out.pop();
        }
    }
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

fn strip_jsx_template_wrap(text: &str) -> String {
    let lines: Vec<String> = text.split('\n').map(String::from).collect();
    match strip_jsx_template_lines(&lines) {
        Some(v) => v.join("\n"),
        None => String::new(),
    }
}

/// JS: deindentContent(contentLines, baseIndent)
fn deindent_content(content: &[String], base_indent: &str) -> Vec<String> {
    let min_indent = min_leading_spaces(content);
    content
        .iter()
        .map(|line| {
            if trim(line).is_empty() {
                String::new()
            } else {
                format!("{}{}", base_indent, slice_chars(line, min_indent))
            }
        })
        .collect()
}

/// JS: findSessionFile(id, cwd) → (file, content, lines)
fn find_session_file(id: &str, cwd: &str) -> Option<(String, String, Vec<String>)> {
    let skip: [&str; 5] = ["node_modules", ".git", ".impeccable", "dist", "build"];
    let extensions = resolve_live_template_extensions(cwd);
    let file = find_source_file(
        &format!("impeccable-variants-start {}", id),
        cwd,
        &extensions,
        &skip,
        &|_| true,
    )?;
    let content = safe_read(&file)?;
    let lines: Vec<String> = content.split('\n').map(String::from).collect();
    Some((file, content, lines))
}
