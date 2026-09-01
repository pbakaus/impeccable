//! JS: live-wrap.mjs -> `impeccable live-wrap` / `wrap`. Find an element in
//! source and wrap it in a variant container (or scaffold a Svelte component
//! preview session), printing where the agent inserts variants.

use crate::inject::resolve_source_traits;
use crate::pending_edits::read_buffer;
use crate::roots::enter_live_root;
use crate::source_search::is_generated_file;
use crate::svelte_component::{
    build_svelte_component_css_authoring, scaffold_svelte_component_session,
    should_use_svelte_component_injection, Scaffold,
};
use crate::util::{eprintln, json_compact, jsp, println, safe_read};
use crate::wrap_common::*;
use impeccable_common::Io;
use impeccable_core::js::trim;
use serde_json::{json, Map, Value};

const HELP: &str = "Usage: impeccable wrap [options]

Find an element in source and wrap it in a variant container.

Required:
  --id ID            Session ID for the variant wrapper
  --count N          Number of expected variants (1-8)

Element identification (at least one required):
  --element-id ID    HTML id attribute of the element
  --classes A,B,C    Comma- or space-separated CSS class names
  --tag TAG          Tag name (div, section, etc.)
  --query TEXT       Fallback: raw text to search for

Optional:
  --file PATH        Source file to search in (skips auto-detection)
  --text TEXT        Picked element's textContent. Used to disambiguate when
                     classes/tag match multiple sibling elements (e.g. a list
                     of <Card>s with the same className). Pass the first ~80
                     chars of event.element.textContent.
  --page-url URL     Current page URL. Required when pending manual edits may
                     affect the picked source block. Pending edits are filtered
                     to this page so an edit on /a doesn't bleed into /b.
  --help             Show this help message

Output (JSON):
  { file, startLine, endLine, insertLine, commentSyntax }

The agent should insert variant HTML at insertLine.";

pub fn run(args: &[String], io: &mut Io) -> i32 {
    let mut argv: Vec<String> = args.to_vec();
    if let Err(code) = enter_live_root(&mut argv, io) {
        return code;
    }
    wrap_cli(&argv, io)
}

fn nonempty(v: Option<String>) -> Option<String> {
    v.filter(|s| !s.is_empty())
}

/// The candidate range in the JS shape `{ startLine, endLine }` (1-indexed).
fn candidates_json(list: &[ElementMatch]) -> Value {
    Value::Array(
        list.iter()
            .map(|c| json!({ "startLine": c.start_line + 1, "endLine": c.end_line + 1 }))
            .collect(),
    )
}

fn wrap_cli(args: &[String], io: &mut Io) -> i32 {
    if args.iter().any(|a| a == "--help" || a == "-h") {
        println(io, HELP);
        return 0;
    }
    let cwd = io.cwd.to_string_lossy().into_owned();
    let env = io.env.clone();

    let id = nonempty(arg_val_eq(args, "--id"));
    let count = parse_count(arg_val_eq(args, "--count").as_deref());
    let element_id = nonempty(arg_val_eq(args, "--element-id"));
    let classes = nonempty(arg_val_eq(args, "--classes"));
    let tag = nonempty(arg_val_eq(args, "--tag"));
    let query = nonempty(arg_val_eq(args, "--query"));
    let file_path = nonempty(arg_val_eq(args, "--file"));
    let text = nonempty(arg_val_eq(args, "--text"));
    let page_url = nonempty(arg_val_eq(args, "--page-url"));
    let defer_source_write = args.iter().any(|a| a == "--defer-source-write");

    let Some(id) = id else {
        eprintln(io, "Missing --id");
        return 1;
    };
    if element_id.is_none() && classes.is_none() && query.is_none() {
        eprintln(io, "Need at least one of: --element-id, --classes, --query");
        return 1;
    }

    let queries = build_search_queries(
        element_id.as_deref(),
        classes.as_deref(),
        tag.as_deref(),
        query.as_deref(),
    );

    let target_file: String;
    if let Some(fp) = &file_path {
        if is_generated_file(fp, &cwd) {
            eprintln(
                io,
                &json_compact(&json!({
                    "error": "file_is_generated",
                    "fallback": "agent-driven",
                    "file": jsp::relative("/", &cwd, &jsp::resolve(&cwd, &[fp])),
                    "hint": "Explicit --file points at a generated file. Writing here gets wiped by the next build. See \"Handle fallback\" in live.md.",
                })),
            );
            return 1;
        }
        target_file = fp.clone();
    } else {
        let mut found: Option<String> = None;
        for q in &queries {
            found = find_file_with_query(q, &cwd, false);
            if found.is_some() {
                break;
            }
        }
        match found {
            Some(f) => target_file = f,
            None => {
                let mut generated_hit: Option<String> = None;
                for q in &queries {
                    generated_hit = find_file_with_query(q, &cwd, true);
                    if generated_hit.is_some() {
                        break;
                    }
                }
                if let Some(hit) = generated_hit {
                    eprintln(
                        io,
                        &json_compact(&json!({
                            "error": "element_not_in_source",
                            "fallback": "agent-driven",
                            "generatedMatch": jsp::relative("/", &cwd, &hit),
                            "hint": "Element found only in a generated file. See \"Handle fallback\" in live.md.",
                        })),
                    );
                } else {
                    eprintln(
                        io,
                        &json_compact(&json!({
                            "error": "element_not_found",
                            "fallback": "agent-driven",
                            "hint": "Element not found in any project file. It may be runtime-injected (JS component, etc.). See \"Handle fallback\" in live.md.",
                        })),
                    );
                }
                return 1;
            }
        }
    }

    let content = match safe_read(&jsp::resolve(&cwd, &[&target_file])) {
        Some(c) => c,
        None => {
            // JS: readFileSync throws (uncaught) -> exit 1 with the stack on stderr.
            eprintln(
                io,
                &format!(
                    "Error: ENOENT: no such file or directory, open '{}'",
                    target_file
                ),
            );
            return 1;
        }
    };
    let lines: Vec<String> = content.split('\n').map(String::from).collect();

    let target_rel_for_errors = jsp::relative("/", &cwd, &jsp::resolve(&cwd, &[&target_file]));
    // JS interpolates `targetFile` as given (explicit --file stays relative).
    let target_display = target_file.clone();
    let not_located = |io: &mut Io| {
        eprintln(
            io,
            &json_compact(&json!({
                "error": format!("Found file but could not locate element in {}. Searched for: {}", target_display, queries.join(", ")),
            })),
        );
        1
    };

    let m: ElementMatch;
    if let Some(text) = &text {
        let mut candidates: Vec<ElementMatch> = Vec::new();
        for q in &queries {
            for c in find_all_elements(&lines, q, tag.as_deref()) {
                if !candidates.iter().any(|x| x.start_line == c.start_line) {
                    candidates.push(c);
                }
            }
            if candidates.len() == 1 {
                break;
            }
        }
        if candidates.is_empty() {
            return not_located(io);
        }
        if candidates.len() == 1 {
            m = candidates[0];
        } else {
            let filtered = filter_by_text(&candidates, &lines, text);
            if filtered.len() == 1 {
                m = filtered[0];
            } else if filtered.is_empty() {
                let normalized: String = {
                    let re = regex::Regex::new(&format!("{}+", impeccable_core::js::WS)).unwrap();
                    trim(&re.replace_all(text, " ")).to_string()
                };
                if normalized.encode_utf16().count() < 8 {
                    m = candidates[0];
                } else {
                    eprintln(
                        io,
                        &json_compact(&json!({
                            "error": "element_ambiguous",
                            "fallback": "agent-driven",
                            "reason": "rendered_text_not_in_source",
                            "file": target_rel_for_errors,
                            "candidates": candidates_json(&candidates),
                            "hint": "Rendered text does not occur in any matching source branch. The element may use dynamic props or expressions; inspect the candidates and wrap the intended instance manually.",
                        })),
                    );
                    return 1;
                }
            } else {
                eprintln(
                    io,
                    &json_compact(&json!({
                        "error": "element_ambiguous",
                        "fallback": "agent-driven",
                        "file": target_rel_for_errors,
                        "candidates": candidates_json(&filtered),
                        "hint": "Multiple source elements match both classes/tag and textContent. Pass --element-id, a more specific --text, or write the wrapper manually. See \"Handle fallback\" in live.md.",
                    })),
                );
                return 1;
            }
        }
    } else {
        let mut found: Option<ElementMatch> = None;
        for q in &queries {
            found = find_element(&lines, q, tag.as_deref());
            if found.is_some() {
                break;
            }
        }
        match found {
            Some(f) => m = f,
            None => return not_located(io),
        }
    }

    let start_line = m.start_line;
    let end_line = m.end_line.min(lines.len() - 1);
    let comment_syntax = detect_comment_syntax(&target_file);
    let style_mode = detect_style_mode(&target_file);
    let is_jsx = comment_syntax.0 == "{/*";
    let indent = leading_ws(&lines[start_line]);

    let mut original_lines: Vec<String> = lines[start_line..=end_line].to_vec();

    // Buffer-aware original.
    let pending_entries = read_buffer(&cwd, &env);
    let target_abs = jsp::resolve(&cwd, &[&target_file]);
    if page_url.is_none() {
        let affecting = pending_entries
            .iter()
            .filter(|entry| {
                entry_ops(entry).iter().any(|op| {
                    manual_edit_may_affect_wrap(op, &target_abs, &original_lines, start_line, &cwd)
                })
            })
            .count();
        if affecting > 0 {
            eprintln(
                io,
                &json_compact(&json!({
                    "error": "missing_page_url_with_pending_edits",
                    "pendingEntries": affecting,
                    "hint": "Pending manual edits may affect the selected source block. Pass --page-url=$event.pageUrl so the wrap block reflects the user's staged DOM.",
                })),
            );
            return 1;
        }
    }
    if let Some(page_url) = &page_url {
        let mut failed: Vec<Value> = Vec::new();
        for entry in &pending_entries {
            if entry.get("pageUrl").and_then(|v| v.as_str()) != Some(page_url.as_str()) {
                continue;
            }
            for op in entry_ops(entry) {
                let may_affect = manual_edit_may_affect_wrap(
                    &op,
                    &target_abs,
                    &original_lines,
                    start_line,
                    &cwd,
                );
                if let Some(next) =
                    apply_buffered_manual_edit_to_lines(&original_lines, start_line, &op)
                {
                    original_lines = next;
                    continue;
                }
                if !may_affect {
                    continue;
                }
                failed.push(json!({
                    "entryId": entry.get("id").cloned().unwrap_or(Value::Null),
                    "ref": op.get("ref").cloned().filter(|v| truthy(v)).unwrap_or(Value::Null),
                    "originalText": op.get("originalText").cloned().filter(|v| truthy(v)).unwrap_or(Value::Null),
                    "reason": "ambiguous_or_unmatched_pending_edit",
                }));
            }
        }
        if !failed.is_empty() {
            eprintln(
                io,
                &json_compact(&json!({
                    "error": "manual_edit_buffer_apply_failed",
                    "pendingOps": failed,
                    "hint": "A staged copy edit appears to affect the selected source block, but could not be applied unambiguously to the wrap original. Apply or discard copy edits first, or write the wrapper manually.",
                })),
            );
            return 1;
        }
    }

    let original_base_indent = min_leading_spaces(&original_lines);
    let reindent_original = |extra: &str| -> String {
        original_lines
            .iter()
            .map(|l| {
                if trim(l).is_empty() {
                    String::new()
                } else {
                    format!(
                        "{}{}{}",
                        indent,
                        extra,
                        slice_chars(l, original_base_indent)
                    )
                }
            })
            .collect::<Vec<_>>()
            .join("\n")
    };
    let original_indented = reindent_original("    ");
    let rel_target_file = jsp::to_posix(&jsp::relative("/", &cwd, &target_abs));
    let use_svelte_component = resolve_source_traits(&target_file).preview == "component"
        && should_use_svelte_component_injection(&target_file, &env);

    let style_contents = if is_jsx {
        "style={{ display: \"contents\" }}"
    } else {
        "style=\"display: contents\""
    };
    let count_s = count_text(count);
    let (co, cc) = comment_syntax;
    let wrapper_lines: Vec<String> = if is_jsx {
        vec![
            format!(
                "{}<div data-impeccable-variants=\"{}\" data-impeccable-variant-count=\"{}\" {}>",
                indent, id, count_s, style_contents
            ),
            format!("{}  {} impeccable-variants-start {} {}", indent, co, id, cc),
            format!("{}  {} Original {}", indent, co, cc),
            format!("{}  <div data-impeccable-variant=\"original\">", indent),
            reindent_original("    "),
            format!("{}  </div>", indent),
            format!("{}  {} Variants: insert below this line {}", indent, co, cc),
            format!("{}  {} impeccable-variants-end {} {}", indent, co, id, cc),
            format!("{}</div>", indent),
        ]
    } else {
        vec![
            format!("{}{} impeccable-variants-start {} {}", indent, co, id, cc),
            format!(
                "{}<div data-impeccable-variants=\"{}\" data-impeccable-variant-count=\"{}\" {}>",
                indent, id, count_s, style_contents
            ),
            format!("{}  {} Original {}", indent, co, cc),
            format!("{}  <div data-impeccable-variant=\"original\">", indent),
            original_indented,
            format!("{}  </div>", indent),
            format!("{}  {} Variants: insert below this line {}", indent, co, cc),
            format!("{}</div>", indent),
            format!("{}{} impeccable-variants-end {} {}", indent, co, id, cc),
        ]
    };

    let mut output_file = target_abs.clone();
    let mut output_start_line = start_line + 1;
    let mut output_end_line = start_line + wrapper_lines.len() + (original_lines.len() - 1);
    let insert_line: usize;
    let mut svelte_session = None;
    let mut deferred_wrapper: Option<(String, usize, usize)> = None;
    let mut svelte_preview_fallback: Option<String> = None;

    if use_svelte_component {
        match scaffold_svelte_component_session(
            &id,
            count,
            &rel_target_file,
            (start_line + 1) as i64,
            (end_line + 1) as i64,
            &original_lines,
            &cwd,
        ) {
            Scaffold::Fallback(reason) => {
                svelte_preview_fallback = Some(if reason.is_empty() {
                    "unsupported markup".to_string()
                } else {
                    reason
                });
            }
            Scaffold::Session(session) => {
                output_file = jsp::resolve(&cwd, &[&session.manifest_file]);
                output_start_line = 1;
                output_end_line = 1;
                svelte_session = Some(session);
            }
        }
    }
    if svelte_session.is_some() {
        insert_line = 1;
    } else if defer_source_write {
        deferred_wrapper = Some((wrapper_lines.join("\n"), start_line + 1, end_line + 1));
        insert_line = start_line + 6 + (original_lines.len() - 1) + 1;
    } else {
        let mut new_lines: Vec<String> = Vec::new();
        new_lines.extend_from_slice(&lines[..start_line]);
        new_lines.extend(wrapper_lines.iter().cloned());
        new_lines.extend_from_slice(&lines[end_line + 1..]);
        let _ = std::fs::write(&target_abs, new_lines.join("\n"));
        insert_line = start_line + 6 + (original_lines.len() - 1) + 1;
    }

    let output_rel_file = jsp::to_posix(&jsp::relative("/", &cwd, &output_file));
    let component_active = svelte_session.is_some();

    let mut out = Map::new();
    out.insert("file".into(), Value::String(output_rel_file));
    if component_active {
        out.insert("sourceFile".into(), Value::String(rel_target_file.clone()));
        out.insert(
            "previewMode".into(),
            Value::String("svelte-component".into()),
        );
    }
    if let Some(reason) = &svelte_preview_fallback {
        out.insert(
            "previewFallback".into(),
            json!({ "from": "svelte-component", "reason": reason }),
        );
    }
    if let Some((block, rs, re)) = &deferred_wrapper {
        out.insert("sourceWritten".into(), Value::Bool(false));
        out.insert("wrapperBlock".into(), Value::String(block.clone()));
        out.insert("replaceStartLine".into(), json!(rs));
        out.insert("replaceEndLine".into(), json!(re));
    }
    if let Some(session) = &svelte_session {
        out.insert(
            "componentDir".into(),
            Value::String(session.component_dir.clone()),
        );
        out.insert(
            "propContract".into(),
            Value::Array(session.prop_contract.clone()),
        );
        out.insert(
            "componentStubMarkup".into(),
            Value::String(session.stub_markup.clone()),
        );
        out.insert("sourceStartLine".into(), json!(start_line + 1));
        out.insert("sourceEndLine".into(), json!(end_line + 1));
    }
    out.insert("startLine".into(), json!(output_start_line));
    out.insert("endLine".into(), json!(output_end_line));
    out.insert("insertLine".into(), json!(insert_line));
    out.insert("commentSyntax".into(), comment_syntax_value(comment_syntax));
    out.insert(
        "styleMode".into(),
        Value::String(if component_active {
            "svelte-component".into()
        } else {
            style_mode.0.into()
        }),
    );
    out.insert(
        "styleTag".into(),
        if component_active {
            Value::Null
        } else {
            Value::String(style_mode.1.into())
        },
    );
    out.insert(
        "cssSelectorPrefixExamples".into(),
        if component_active {
            json!([])
        } else {
            json!(build_css_selector_prefix_examples(
                style_mode.0,
                count_len(count)
            ))
        },
    );
    out.insert(
        "cssAuthoring".into(),
        if component_active {
            build_svelte_component_css_authoring(count)
        } else {
            build_css_authoring(style_mode, count_len(count))
        },
    );
    out.insert("originalLineCount".into(), json!(original_lines.len()));
    println(io, &json_compact(&Value::Object(out)));
    0
}

fn truthy(v: &Value) -> bool {
    crate::inject::detect_utils::truthy(v)
}

fn entry_ops(entry: &Value) -> Vec<Value> {
    match entry.get("ops") {
        Some(Value::Array(a)) => a.clone(),
        _ => Vec::new(),
    }
}

fn op_str<'a>(op: &'a Value, key: &str) -> Option<&'a str> {
    op.get(key).and_then(|v| v.as_str())
}

/// JS: manualEditMayAffectWrap(op, targetFile, originalLines, selectionStartLine, cwd)
fn manual_edit_may_affect_wrap(
    op: &Value,
    target_abs: &str,
    original_lines: &[String],
    selection_start: usize,
    cwd: &str,
) -> bool {
    if manual_edit_hint_falls_inside_selection(op, target_abs, original_lines, selection_start, cwd)
    {
        return true;
    }
    if manual_edit_locator_matches_selection(op, original_lines) {
        return true;
    }
    if let Some(t) = op_str(op, "originalText") {
        if !t.is_empty() {
            return original_lines.join("\n").contains(t);
        }
    }
    false
}

fn manual_edit_hint_falls_inside_selection(
    op: &Value,
    target_abs: &str,
    original_lines: &[String],
    selection_start: usize,
    cwd: &str,
) -> bool {
    let hint = op.get("sourceHint");
    let Some(hint_file) = hint
        .and_then(|h| h.get("file"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
    else {
        return false;
    };
    let Some(hinted_line) =
        crate::util::js_number(hint.and_then(|h| h.get("line"))).filter(|n| n.is_finite())
    else {
        return false;
    };
    let hint_abs = if jsp::is_absolute(hint_file) {
        hint_file.to_string()
    } else {
        jsp::resolve(cwd, &[hint_file])
    };
    if jsp::resolve(&hint_abs, &[]) != target_abs {
        return false;
    }
    let hinted_index = hinted_line - 1.0 - selection_start as f64;
    if hinted_index < 0.0
        || hinted_index >= original_lines.len() as f64
        || hinted_index.fract() != 0.0
    {
        return false;
    }
    match op_str(op, "originalText") {
        Some(t) => original_lines[hinted_index as usize].contains(t),
        None => false,
    }
}

fn manual_edit_locator_matches_selection(op: &Value, original_lines: &[String]) -> bool {
    let Some(t) = op_str(op, "originalText").filter(|s| !s.is_empty()) else {
        return false;
    };
    original_lines
        .iter()
        .any(|line| line.contains(t) && line_matches_manual_edit_locator(line, op))
}

/// JS: applyBufferedManualEditToLines → Some(newLines) when changed.
fn apply_buffered_manual_edit_to_lines(
    original_lines: &[String],
    selection_start: usize,
    op: &Value,
) -> Option<Vec<String>> {
    let original_text = op_str(op, "originalText").filter(|s| !s.is_empty())?;
    let new_text = op_str(op, "newText")?;
    let replace_line = |idx: usize| -> Vec<String> {
        original_lines
            .iter()
            .enumerate()
            .map(|(i, line)| {
                if i == idx {
                    line.replacen(original_text, new_text, 1)
                } else {
                    line.clone()
                }
            })
            .collect()
    };
    if let Some(hinted_line) =
        crate::util::js_number(op.get("sourceHint").and_then(|h| h.get("line")))
            .filter(|n| n.is_finite())
    {
        let hinted_index = hinted_line - 1.0 - selection_start as f64;
        if hinted_index >= 0.0
            && hinted_index < original_lines.len() as f64
            && hinted_index.fract() == 0.0
        {
            let idx = hinted_index as usize;
            if original_lines[idx].contains(original_text) {
                return Some(replace_line(idx));
            }
        }
    }
    let locator_matches: Vec<usize> = original_lines
        .iter()
        .enumerate()
        .filter(|(_, line)| {
            line.contains(original_text) && line_matches_manual_edit_locator(line, op)
        })
        .map(|(i, _)| i)
        .collect();
    if locator_matches.len() == 1 {
        return Some(replace_line(locator_matches[0]));
    }
    let block = original_lines.join("\n");
    if block.matches(original_text).count() == 1 {
        return Some(
            block
                .replacen(original_text, new_text, 1)
                .split('\n')
                .map(String::from)
                .collect(),
        );
    }
    None
}

/// JS: lineMatchesManualEditLocator(line, op)
fn line_matches_manual_edit_locator(line: &str, op: &Value) -> bool {
    if let Some(tag) = op.get("tag").filter(|v| truthy(v)) {
        let tag = crate::accept_css::js_string(tag);
        let re = regex::Regex::new(&format!(
            "(?i)<{ws}*{tag}(?:[{wsc}>/]|$)",
            ws = impeccable_core::js::WS,
            wsc = &impeccable_core::js::WS[1..impeccable_core::js::WS.len() - 1],
            tag = regex::escape(&tag)
        ))
        .unwrap();
        // The lookahead `(?=[\s>/]|$)` becomes a consumed class; the match
        // outcome is the same.
        if !re.is_match(line) {
            return false;
        }
    }
    if let Some(eid) = op.get("elementId").filter(|v| truthy(v)) {
        let eid = crate::accept_css::js_string(eid);
        let re = regex::Regex::new(&format!(
            "(?-u:\\b)id{ws}*={ws}*[\"']{id}[\"']",
            ws = impeccable_core::js::WS,
            id = regex::escape(&eid)
        ))
        .unwrap();
        if !re.is_match(line) {
            return false;
        }
    }
    if let Some(Value::Array(classes)) = op.get("classes") {
        for c in classes {
            if !truthy(c) {
                continue;
            }
            let c = crate::accept_css::js_string(c);
            if !line.contains(&c) {
                return false;
            }
        }
    }
    true
}
