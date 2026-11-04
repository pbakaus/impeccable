//! JS: live-insert.mjs -> `impeccable live-insert` / `insert`. Find an anchor
//! element in source and splice an insert-variant wrapper before or after
//! it (no original variant), or scaffold a Svelte insert session.

use crate::inject::resolve_source_traits;
use crate::roots::enter_live_root;
use crate::source_search::is_generated_file;
use crate::svelte_component::{
    build_svelte_component_css_authoring, scaffold_svelte_component_insert_session,
    should_use_svelte_component_injection,
};
use crate::util::{eprintln, json_compact, jsp, println};
use crate::wrap_common::*;
use impeccable_common::Io;
use serde_json::{json, Map, Value};

const HELP: &str = "Usage: impeccable live-insert [options]

Find an anchor element in source and splice an insert-variant wrapper.

Required:
  --id ID            Session ID for the variant wrapper
  --count N          Number of expected variants (1-8)
  --position POS     before | after (relative to the anchor element)

Element identification (at least one required):
  --element-id ID    HTML id attribute of the anchor element
  --classes A,B,C    Comma-separated CSS class names
  --tag TAG          Tag name (div, section, etc.)
  --query TEXT       Fallback: raw text to search for

Optional:
  --file PATH        Source file to search in (skips auto-detection)
  --text TEXT        Anchor textContent for disambiguation (~80 chars)

Output (JSON):
  { mode: \"insert\", file, position, insertLine, commentSyntax, styleMode, styleTag, cssAuthoring }";

/// JS: buildInsertWrapperLines({ id, count, indent, commentSyntax, isJsx })
pub fn build_insert_wrapper_lines(
    id: &str,
    count: i64,
    indent: &str,
    cs: (&str, &str),
    is_jsx: bool,
) -> Vec<String> {
    let style_contents = if is_jsx {
        "style={{ display: \"contents\" }}"
    } else {
        "style=\"display: contents\""
    };
    let attrs = format!(
        "data-impeccable-variants=\"{}\" data-impeccable-mode=\"insert\" data-impeccable-variant-count=\"{}\" {}",
        id,
        count_text(count),
        style_contents
    );
    let (co, cc) = cs;
    if is_jsx {
        return vec![
            format!("{}<div {}>", indent, attrs),
            format!("{}  {} impeccable-variants-start {} {}", indent, co, id, cc),
            format!("{}  {} Variants: insert below this line {}", indent, co, cc),
            format!("{}  {} impeccable-variants-end {} {}", indent, co, id, cc),
            format!("{}</div>", indent),
        ];
    }
    vec![
        format!("{}{} impeccable-variants-start {} {}", indent, co, id, cc),
        format!("{}<div {}>", indent, attrs),
        format!("{}  {} Variants: insert below this line {}", indent, co, cc),
        format!("{}</div>", indent),
        format!("{}{} impeccable-variants-end {} {}", indent, co, id, cc),
    ]
}

pub fn run(args: &[String], io: &mut Io) -> i32 {
    let mut argv: Vec<String> = args.to_vec();
    if let Err(code) = enter_live_root(&mut argv, io) {
        return code;
    }
    insert_cli(&argv, io)
}

fn nonempty(v: Option<String>) -> Option<String> {
    v.filter(|s| !s.is_empty())
}

fn insert_cli(args: &[String], io: &mut Io) -> i32 {
    if args.iter().any(|a| a == "--help" || a == "-h") {
        println(io, HELP);
        return 0;
    }
    let cwd = io.cwd.to_string_lossy().into_owned();
    let env = io.env.clone();

    let id = nonempty(arg_val(args, "--id"));
    let count = parse_count(arg_val(args, "--count").as_deref());
    let position = nonempty(arg_val(args, "--position"));
    let element_id = nonempty(arg_val(args, "--element-id"));
    let classes = nonempty(arg_val(args, "--classes"));
    let tag = nonempty(arg_val(args, "--tag"));
    let query = nonempty(arg_val(args, "--query"));
    let file_path = nonempty(arg_val(args, "--file"));
    let text = nonempty(arg_val(args, "--text"));
    let defer_source_write = args.iter().any(|a| a == "--defer-source-write");

    let Some(id) = id else {
        eprintln(io, "Missing --id");
        return 1;
    };
    let Some(position) = position else {
        eprintln(io, "Missing --position (before | after)");
        return 1;
    };
    if position != "before" && position != "after" {
        eprintln(io, &format!("Invalid --position: {}", position));
        return 1;
    }
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
    let resolved = if let Some(fp) = &file_path {
        if is_generated_file(fp, &cwd) {
            eprintln(
                io,
                &json_compact(&json!({
                    "error": "file_is_generated",
                    "fallback": "agent-driven",
                    "file": jsp::relative("/", &cwd, &jsp::resolve(&cwd, &[fp])),
                })),
            );
            return 1;
        }
        match SourceFile::read(&cwd, fp) {
            Some(file) => resolve_in_file(file, &queries, tag.as_deref(), text.as_deref()),
            None => {
                eprintln(
                    io,
                    &format!("Error: ENOENT: no such file or directory, open '{}'", fp),
                );
                return 1;
            }
        }
    } else {
        resolve_in_project(&queries, &cwd, tag.as_deref(), text.as_deref())
    };
    let (file, m) = match resolved {
        Resolution::Match(file, m) => (file, m),
        // Insert anchors on the first candidate when the text is in none.
        Resolution::TextNotInFile(file, candidates) => (file, candidates[0]),
        Resolution::Ambiguous(file, candidates) => {
            eprintln(
                io,
                &json_compact(&json!({
                    "error": "element_ambiguous",
                    "fallback": "agent-driven",
                    "file": jsp::relative("/", &cwd, &jsp::resolve(&cwd, &[&file.path])),
                    "candidates": candidates_json(&candidates),
                })),
            );
            return 1;
        }
        Resolution::NotLocated(_) => {
            eprintln(
                io,
                &json_compact(&json!({ "error": "element_not_found", "fallback": "agent-driven" })),
            );
            return 1;
        }
        Resolution::TextInNoFile(hits) => {
            eprintln(
                io,
                &json_compact(&json!({
                    "error": "element_ambiguous",
                    "fallback": "agent-driven",
                    "reason": "rendered_text_not_in_source",
                    "candidates": file_candidates_json(&cwd, &hits),
                })),
            );
            return 1;
        }
        Resolution::NotFound => {
            let mut generated_hit: Option<String> = None;
            for q in &queries {
                generated_hit = find_file_with_query(q, &cwd, true);
                if generated_hit.is_some() {
                    break;
                }
            }
            eprintln(
                io,
                &json_compact(&json!({
                    "error": if generated_hit.is_some() { "element_not_in_source" } else { "element_not_found" },
                    "fallback": "agent-driven",
                    "hint": "See \"Handle fallback\" in live.md.",
                })),
            );
            return 1;
        }
    };
    let target_file = file.path;
    let target_abs = jsp::resolve(&cwd, &[&target_file]);
    let lines = file.lines;

    let start_line = m.start_line;
    let svelte_component = should_use_svelte_component_injection(&target_file, &env);
    let end_line = match m.end_line {
        Some(end) => end,
        // Inserting before a source anchor needs only its start line.
        None if position == "before" && !svelte_component => start_line,
        None => {
            let file = jsp::relative("/", &cwd, &target_abs);
            eprintln(
                io,
                &json_compact(&element_unclosed_error(&file, start_line)),
            );
            return 1;
        }
    };
    let comment_syntax = detect_comment_syntax(&target_file);
    let traits = resolve_source_traits(&target_file);
    let is_jsx = comment_syntax.0 == "{/*";
    let splice_index = if position == "before" {
        start_line
    } else {
        end_line + 1
    };
    let rel_target_file = jsp::to_posix(&jsp::relative("/", &cwd, &target_abs));

    if svelte_component {
        let anchor_end = end_line.min(lines.len() - 1);
        let session = scaffold_svelte_component_insert_session(
            &id,
            count,
            &rel_target_file,
            (splice_index + 1) as i64,
            &position,
            (start_line + 1) as i64,
            (end_line + 1) as i64,
            &lines[start_line..=anchor_end],
            &cwd,
        );
        let mut out = Map::new();
        out.insert("mode".into(), Value::String("insert".into()));
        out.insert("position".into(), Value::String(position.clone()));
        out.insert("file".into(), Value::String(session.manifest_file.clone()));
        out.insert("sourceFile".into(), Value::String(rel_target_file.clone()));
        out.insert(
            "previewMode".into(),
            Value::String("svelte-component".into()),
        );
        out.insert(
            "componentDir".into(),
            Value::String(session.component_dir.clone()),
        );
        out.insert(
            "propContract".into(),
            Value::Array(session.prop_contract.clone()),
        );
        out.insert("insertLine".into(), json!(1));
        out.insert("sourceInsertLine".into(), json!(splice_index + 1));
        out.insert("anchorStartLine".into(), json!(start_line + 1));
        out.insert("anchorEndLine".into(), json!(end_line + 1));
        out.insert("commentSyntax".into(), comment_syntax_value(comment_syntax));
        out.insert("styleMode".into(), Value::String("svelte-component".into()));
        out.insert("styleTag".into(), Value::Null);
        out.insert("cssSelectorPrefixExamples".into(), json!([]));
        out.insert(
            "cssAuthoring".into(),
            build_svelte_component_css_authoring(count),
        );
        println(io, &json_compact(&Value::Object(out)));
        return 0;
    }

    let indent = lines
        .get(splice_index)
        .map(|l| leading_ws(l))
        .or_else(|| lines.get(start_line).map(|l| leading_ws(l)))
        .unwrap_or_default();
    let wrapper_lines = build_insert_wrapper_lines(&id, count, &indent, comment_syntax, is_jsx);

    let mut deferred: Option<(String, usize, usize)> = None;
    if defer_source_write {
        deferred = Some((wrapper_lines.join("\n"), splice_index + 1, splice_index));
    } else {
        let mut new_lines: Vec<String> = Vec::new();
        new_lines.extend_from_slice(&lines[..splice_index.min(lines.len())]);
        new_lines.extend(wrapper_lines.iter().cloned());
        new_lines.extend_from_slice(&lines[splice_index.min(lines.len())..]);
        let _ = std::fs::write(&target_abs, new_lines.join("\n"));
    }
    let insert_line = splice_index + 3;

    let mut out = Map::new();
    out.insert("mode".into(), Value::String("insert".into()));
    out.insert("position".into(), Value::String(position.clone()));
    out.insert("file".into(), Value::String(rel_target_file));
    if let Some((block, rs, re)) = &deferred {
        out.insert("sourceWritten".into(), Value::Bool(false));
        out.insert("wrapperBlock".into(), Value::String(block.clone()));
        out.insert("replaceStartLine".into(), json!(rs));
        out.insert("replaceEndLine".into(), json!(re));
    }
    out.insert("insertLine".into(), json!(insert_line + 1));
    out.insert("commentSyntax".into(), comment_syntax_value(comment_syntax));
    out.insert("styleMode".into(), Value::String(traits.style_mode.into()));
    out.insert("styleTag".into(), Value::String(traits.style_tag.into()));
    out.insert(
        "cssSelectorPrefixExamples".into(),
        json!(build_css_selector_prefix_examples(
            traits.style_mode,
            count_len(count)
        )),
    );
    out.insert(
        "cssAuthoring".into(),
        build_css_authoring(&traits, count_len(count)),
    );
    println(io, &json_compact(&Value::Object(out)));
    0
}
