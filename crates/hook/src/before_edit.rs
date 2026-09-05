//! JS: skill/scripts/hook-before-edit.mjs (`impeccable hook-before-edit`),
//! the Cursor preToolUse write gate. Always exits 0 and prints exactly one
//! JSON document: `{"permission":"allow"...}` or the deny payload.

use impeccable_core::findings::Finding;
use impeccable_core::js;
use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::{Map, Value};

use crate::hook_lib::*;
use crate::util::{iso_now, jsp, now_ms, obj_field, str_field_any, truthy_value, utf16_len};

const WS: &str = impeccable_core::js::WS;
const DOT: &str = "[^\n\r\\x{2028}\\x{2029}]";
const B: &str = r"(?-u:\b)";
const W: &str = "[A-Za-z0-9_]";

const CURSOR_DENY_LIMIT: f64 = 4000.0;

/// Byte cap shared by the gate's existing-file reads and the proposed
/// content it scans. Content past it is not plausible hand-edited frontend
/// source, and the envelope carrying it comes straight off stdin, so the
/// gate must not chew on it unbounded (triage A3). Over-cap content skips
/// the gate (allow), the same fail-open shape as an unreadable original.
const MAX_SCANNED_BYTES: u64 = 1024 * 1024;
const BLOCK_PREFIX: &str = "Impeccable design hook blocked this write before it landed. ";

/// The proposed content, or the reason the gate cannot scan it.
enum Proposed {
    Content(String),
    Skipped(&'static str),
}

fn tool_input(event: &Map<String, Value>) -> Map<String, Value> {
    obj_field(event, "tool_input").cloned().unwrap_or_default()
}

/// JS: proposedFilePath(event, cwd)
fn proposed_file_path(rt: &Runtime, event: &Map<String, Value>, cwd: &str) -> String {
    let input = tool_input(event);
    let raw = ["file_path", "path", "target_file"]
        .iter()
        .find_map(|k| input.get(*k).filter(|v| truthy_value(Some(v))))
        .or_else(|| event.get("file_path").filter(|v| truthy_value(Some(v))));
    let candidate = match raw {
        Some(Value::String(s)) if !js::trim(s).is_empty() => s.clone(),
        _ => shell_write_destination(&shell_command(&input)),
    };
    if js::trim(&candidate).is_empty() {
        return String::new();
    }
    if jsp::is_absolute(&candidate) {
        candidate
    } else {
        rt.resolve(&[cwd, &candidate])
    }
}

/// JS: proposedContent(event, cwd, filePath)
fn proposed_content(
    rt: &Runtime,
    event: &Map<String, Value>,
    cwd: &str,
    file_path: &str,
) -> Proposed {
    let input = tool_input(event);
    for key in ["content", "streamContent", "text"] {
        if let Some(Value::String(s)) = input.get(key) {
            return Proposed::Content(s.clone());
        }
    }
    if let Some(p) = projected_edit_content(rt, &input, file_path, cwd) {
        return p;
    }
    if has_fragment_edit_content(&input) {
        return Proposed::Skipped("fragment-only-edit");
    }
    let command = shell_command(&input);
    let python = shell_python_write_content(&command);
    if !python.is_empty() {
        return Proposed::Content(python);
    }
    let heredoc = shell_here_doc_content(&command);
    if !heredoc.is_empty() {
        return Proposed::Content(heredoc);
    }
    let copied = shell_copied_file_content(rt, &command, cwd);
    if !copied.is_empty() {
        return Proposed::Content(copied);
    }
    Proposed::Content(String::new())
}

/// JS: hasFragmentEditContent(input)
fn has_fragment_edit_content(input: &Map<String, Value>) -> bool {
    if ["new_string", "newString", "new_str", "replacement"]
        .iter()
        .any(|k| matches!(input.get(*k), Some(Value::String(_))))
    {
        return true;
    }
    // JS: `edit && typeof edit === 'object'` (arrays included).
    matches!(input.get("edits"), Some(Value::Array(list)) if list.iter().any(|e| matches!(e, Value::Object(_) | Value::Array(_))))
}

fn first_string<'a>(obj: &'a Map<String, Value>, keys: &[&str]) -> Option<&'a str> {
    keys.iter().find_map(|k| str_field_any(obj, k))
}

const OLD_KEYS: &[&str] = &["old_string", "oldString", "old_str", "target"];
const NEW_KEYS: &[&str] = &["new_string", "newString", "new_str", "replacement"];

/// JS: projectedEditContent(input, filePath, cwd) — `None` is JS `undefined`.
fn projected_edit_content(
    rt: &Runtime,
    input: &Map<String, Value>,
    file_path: &str,
    cwd: &str,
) -> Option<Proposed> {
    if file_path.is_empty() {
        return None;
    }
    let single_old = first_string(input, OLD_KEYS);
    let single_new = first_string(input, NEW_KEYS);
    if single_old.is_some() || single_new.is_some() {
        let (Some(old), Some(new)) = (single_old, single_new) else {
            return Some(Proposed::Skipped("fragment-only-edit"));
        };
        let Some(original) = read_existing_project_file(rt, file_path, cwd) else {
            return Some(Proposed::Skipped("edit-original-unreadable"));
        };
        return Some(match replace_once(&original, old, new) {
            Some(p) => Proposed::Content(p),
            None => Proposed::Skipped("edit-old-string-missing"),
        });
    }
    let Some(Value::Array(edits)) = input.get("edits") else {
        return None;
    };
    let Some(original) = read_existing_project_file(rt, file_path, cwd) else {
        return Some(Proposed::Skipped("edit-original-unreadable"));
    };
    let mut projected = original;
    for edit in edits {
        let Value::Object(edit) = edit else {
            return Some(Proposed::Skipped("fragment-only-edit"));
        };
        let (Some(old), Some(new)) = (first_string(edit, OLD_KEYS), first_string(edit, NEW_KEYS))
        else {
            return Some(Proposed::Skipped("fragment-only-edit"));
        };
        match replace_once(&projected, old, new) {
            Some(next) => projected = next,
            None => return Some(Proposed::Skipped("edit-old-string-missing")),
        }
    }
    Some(Proposed::Content(projected))
}

/// JS: replaceOnce(original, oldString, newString)
fn replace_once(original: &str, old: &str, new: &str) -> Option<String> {
    if old.is_empty() {
        return None;
    }
    let index = original.find(old)?;
    Some(format!(
        "{}{}{}",
        &original[..index],
        new,
        &original[index + old.len()..]
    ))
}

/// JS: readExistingProjectFile(filePath, cwd)
fn read_existing_project_file(rt: &Runtime, file_path: &str, cwd: &str) -> Option<String> {
    if !is_scan_target_inside_project(rt, file_path, cwd) {
        return None;
    }
    if is_sensitive_path(file_path) || is_generated_path(file_path) {
        return None;
    }
    read_regular_file_capped(file_path)
}

fn read_regular_file_capped(p: &str) -> Option<String> {
    let meta = std::fs::metadata(p).ok()?;
    if !meta.is_file() || meta.len() > MAX_SCANNED_BYTES {
        return None;
    }
    std::fs::read(p)
        .ok()
        .map(|b| String::from_utf8_lossy(&b).into_owned())
}

/// JS: shellCommand(input)
fn shell_command(input: &Map<String, Value>) -> String {
    if let Some(Value::String(c)) = input.get("command") {
        return c.clone();
    }
    if let Some(Value::Object(args)) = input.get("args") {
        if let Some(Value::String(c)) = args.get("command") {
            return c.clone();
        }
    }
    String::new()
}

static REDIRECT_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(&format!(
        r#"(?:^|[{ws};&|])(?:>>?|1>>?){WS}*(?:"([^"]+)"|'([^']+)'|([^<>{ws}]+))"#,
        ws = impeccable_core::js::WS_CHARS
    ))
    .unwrap()
});

/// JS: shellRedirectPath(command)
fn shell_redirect_path(command: &str) -> String {
    if command.is_empty() {
        return String::new();
    }
    match REDIRECT_RE.captures(command) {
        Some(m) => {
            let v = m
                .get(1)
                .or_else(|| m.get(2))
                .or_else(|| m.get(3))
                .map(|g| g.as_str())
                .unwrap_or("");
            js::trim(v).to_string()
        }
        None => String::new(),
    }
}

/// JS: shellWriteDestination(command)
fn shell_write_destination(command: &str) -> String {
    let r = shell_redirect_path(command);
    if !r.is_empty() {
        return r;
    }
    let t = shell_tee_destination(command);
    if !t.is_empty() {
        return t;
    }
    if let Some((_, dest)) = shell_copy_paths(command) {
        if !dest.is_empty() {
            return dest;
        }
    }
    shell_python_write_destination(command)
}

static PYTHON_RE: Lazy<Regex> = Lazy::new(|| Regex::new(&format!(r"{B}python(?:3)?{B}")).unwrap());
static PATH_WRITE_TEXT_RE: Lazy<Regex> = Lazy::new(|| {
    // JS: /(?:^|[^\w.])(?:pathlib\.)?Path\(\s*(["'])(.*?)\1\s*\)\s*\.write_text\s*\(/
    Regex::new(&format!(
        r#"(?:^|[^A-Za-z0-9_.])(?:pathlib\.)?Path\({WS}*(?:"({DOT}*?)"|'({DOT}*?)'){WS}*\){WS}*\.write_text{WS}*\("#
    ))
    .unwrap()
});
static PATH_ASSIGN_RE: Lazy<Regex> = Lazy::new(|| {
    // JS: /\b([A-Za-z_]\w*)\s*=\s*(?:pathlib\.)?Path\(\s*(["'])(.*?)\2\s*\)/g
    Regex::new(&format!(
        r#"{B}([A-Za-z_]{W}*){WS}*={WS}*(?:pathlib\.)?Path\({WS}*(?:"({DOT}*?)"|'({DOT}*?)'){WS}*\)"#
    ))
    .unwrap()
});
static WRITE_VAR_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(&format!(r"{B}([A-Za-z_]{W}*)\.write_text{WS}*\(")).unwrap());
static OPEN_RE: Lazy<Regex> = Lazy::new(|| {
    // JS: /\bopen\(\s*(["'])(.*?)\1\s*,\s*(["'])[wax](?:\+)?b?\3/
    Regex::new(&format!(
        r#"{B}open\({WS}*(?:"({DOT}*?)"|'({DOT}*?)'){WS}*,{WS}*(?:"[wax]\+?b?"|'[wax]\+?b?')"#
    ))
    .unwrap()
});

fn first_of(m: &regex::Captures, groups: &[usize]) -> String {
    groups
        .iter()
        .find_map(|g| m.get(*g))
        .map(|g| js::trim(g.as_str()).to_string())
        .unwrap_or_default()
}

/// JS: shellPythonWriteDestination(command)
fn shell_python_write_destination(command: &str) -> String {
    if !PYTHON_RE.is_match(command) {
        return String::new();
    }
    if let Some(m) = PATH_WRITE_TEXT_RE.captures(command) {
        let direct = first_of(&m, &[1, 2]);
        if !direct.is_empty() {
            return direct;
        }
    }
    let mut paths_by_var: Vec<(String, String)> = Vec::new();
    for m in PATH_ASSIGN_RE.captures_iter(command) {
        let var = m[1].to_string();
        let p = m
            .get(2)
            .or_else(|| m.get(3))
            .map(|g| g.as_str().to_string())
            .unwrap_or_default();
        crate::util::map_set(&mut paths_by_var, var, p);
    }
    for m in WRITE_VAR_RE.captures_iter(command) {
        if let Some((_, p)) = paths_by_var.iter().find(|(v, _)| *v == m[1]) {
            if !p.is_empty() {
                return p.clone();
            }
        }
    }
    match OPEN_RE.captures(command) {
        Some(m) => first_of(&m, &[1, 2]),
        None => String::new(),
    }
}

/// JS: shellTeeDestination(command)
fn shell_tee_destination(command: &str) -> String {
    let words = shell_words(command);
    let Some(tee_index) = words.iter().position(|w| jsp::basename(w) == "tee") else {
        return String::new();
    };
    for word in &words[tee_index + 1..] {
        if ["&&", "||", ";", "|"].contains(&word.as_str()) {
            break;
        }
        if word == "--" || word.starts_with('-') {
            continue;
        }
        return word.clone();
    }
    String::new()
}

/// JS: shellCopiedFileContent(command, cwd)
fn shell_copied_file_content(rt: &Runtime, command: &str, cwd: &str) -> String {
    let Some((source, _)) = shell_copy_paths(command) else {
        return String::new();
    };
    if source.is_empty() {
        return String::new();
    }
    let source_path = if jsp::is_absolute(&source) {
        source
    } else {
        rt.resolve(&[cwd, &source])
    };
    if !is_scan_target_inside_project(rt, &source_path, cwd) {
        return String::new();
    }
    if is_sensitive_path(&source_path) || is_generated_path(&source_path) {
        return String::new();
    }
    read_regular_file_capped(&source_path).unwrap_or_default()
}

/// JS: shellCopyPaths(command) -> (source, dest)
fn shell_copy_paths(command: &str) -> Option<(String, String)> {
    let words = shell_words(command);
    if words.len() < 3 || jsp::basename(&words[0]) != "cp" {
        return None;
    }
    let mut args: Vec<String> = Vec::new();
    for word in &words[1..] {
        if ["&&", "||", ";", "|"].contains(&word.as_str()) {
            break;
        }
        if word == "--" || word.starts_with('-') {
            continue;
        }
        args.push(word.clone());
    }
    if args.len() < 2 {
        return None;
    }
    Some((args[args.len() - 2].clone(), args[args.len() - 1].clone()))
}

static SHELL_WORD_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(&format!(
        r#""((?:\\"|[^"])*)"|'((?:\\'|[^'])*)'|([^{ws}]+)"#,
        ws = impeccable_core::js::WS_CHARS
    ))
    .unwrap()
});
static UNESCAPE_QUOTE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r#"\\(["'])"#).unwrap());

/// JS: shellWords(command)
fn shell_words(command: &str) -> Vec<String> {
    if command.is_empty() {
        return vec![];
    }
    SHELL_WORD_RE
        .captures_iter(command)
        .map(|m| {
            let raw = m
                .get(1)
                .or_else(|| m.get(2))
                .or_else(|| m.get(3))
                .map(|g| g.as_str())
                .unwrap_or("");
            UNESCAPE_QUOTE_RE.replace_all(raw, "$1").into_owned()
        })
        .collect()
}

static HEREDOC_MARKER_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(&format!(
        r#"<<-?{WS}*['"]?([A-Za-z0-9_.-]+)['"]?[^\r\n]*\r?\n"#
    ))
    .unwrap()
});

/// JS: shellHereDocContent(command)
fn shell_here_doc_content(command: &str) -> String {
    if command.is_empty() {
        return String::new();
    }
    let Some(m) = HEREDOC_MARKER_RE.captures(command) else {
        return String::new();
    };
    let marker = m[1].to_string();
    let start = m.get(0).unwrap().end();
    let rest = &command[start..];
    let end_re = Regex::new(&format!(r"\r?\n{}(?:\r?\n|\z)", regex::escape(&marker)));
    let Ok(end_re) = end_re else {
        return String::new();
    };
    match end_re.find(rest) {
        Some(mm) => rest[..mm.start()].to_string(),
        None => String::new(),
    }
}

static WRITE_TEXT_PREFIX_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(&format!(r"\.write_text{WS}*\({WS}*")).unwrap());
static WRITE_PREFIX_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(&format!(r"\.write{WS}*\({WS}*")).unwrap());

/// JS: shellPythonWriteContent(command)
fn shell_python_write_content(command: &str) -> String {
    if !PYTHON_RE.is_match(command) {
        return String::new();
    }
    let heredoc = shell_here_doc_content(command);
    let script = if heredoc.is_empty() {
        command
    } else {
        heredoc.as_str()
    };
    let a = python_string_arg(script, &WRITE_TEXT_PREFIX_RE);
    if !a.is_empty() {
        return a;
    }
    python_string_arg(script, &WRITE_PREFIX_RE)
}

/// JS: pythonStringArg(script, prefixRe)
fn python_string_arg(script: &str, prefix_re: &Regex) -> String {
    for m in prefix_re.find_iter(script) {
        let start = m.end();
        let tail = &script[start..];
        if tail.starts_with("'''") || tail.starts_with("\"\"\"") {
            let triple = &tail[..3];
            if let Some(end) = tail[3..].find(triple) {
                return tail[3..3 + end].to_string();
            }
            continue;
        }
        let mut chars = tail.chars();
        let quote = match chars.next() {
            Some(q @ ('"' | '\'')) => q,
            _ => continue,
        };
        let mut out = String::new();
        while let Some(ch) = chars.next() {
            if ch == '\\' {
                if let Some(next) = chars.next() {
                    out.push(next);
                }
            } else if ch == quote {
                return out;
            } else {
                out.push(ch);
            }
        }
    }
    String::new()
}

/// JS: relativePath(filePath, cwd)
fn relative_path(rt: &Runtime, file_path: &str, cwd: &str) -> String {
    let rel = rt.relative(cwd, file_path);
    if rel.is_empty() || rel.starts_with("..") || jsp::is_absolute(&rel) {
        return file_path.to_string();
    }
    jsp::to_posix(&rel)
}

/// JS: detectProposedHtml(detector, content, filePath, scanOptions)
fn detect_proposed_html(
    rt: &Runtime,
    content: &str,
    file_path: &str,
    scan: &HookScanOptions,
) -> Result<Vec<Finding>, String> {
    let base = std::env::temp_dir();
    let stamp = format!("{}{}", std::process::id(), now_ms() as u64);
    let dir = base.join(format!("impeccable-pre-{stamp}"));
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let tmp = dir.join(jsp::basename(file_path));
    let result = (|| {
        std::fs::write(&tmp, content).map_err(|e| e.to_string())?;
        let findings = detector_detect_html(rt, &tmp.to_string_lossy(), scan)?;
        Ok(findings
            .into_iter()
            .map(|mut f| {
                f.file = file_path.to_string();
                f
            })
            .collect())
    })();
    let _ = std::fs::remove_dir_all(&dir);
    result
}

/// JS: cursorBlockMessage(findings, filePath, config, cwd, footerMode, reserveChars)
fn cursor_block_message(
    rt: &Runtime,
    findings: &[Finding],
    file_path: &str,
    config: &HookConfig,
    cwd: &str,
    short_footer: bool,
    reserve_chars: f64,
) -> String {
    let mc = config.limits.max_chars;
    let mc = if mc == 0.0 || mc.is_nan() {
        DEFAULT_MAX_CHARS
    } else {
        mc
    };
    let budget = js::math_min(mc, CURSOR_DENY_LIMIT);
    let mut capped = config.clone();
    capped.limits.max_chars = budget;
    let rendered = render_template(
        rt,
        findings,
        file_path,
        &capped,
        &RenderOpts {
            cwd: Some(cwd.to_string()),
            short_footer,
            reserve_chars: reserve_chars + utf16_len(BLOCK_PREFIX) as f64,
        },
    );
    rendered.replacen(
        "[impeccable@1] Design hook findings requiring review",
        &format!("[impeccable@1] {BLOCK_PREFIX}Design hook findings requiring review"),
        1,
    )
}

/// JS: findingSignature(findings)
fn finding_signature(findings: &[Finding]) -> String {
    let mut parts: Vec<String> = findings
        .iter()
        .map(|f| {
            let ap = if f.antipattern.is_empty() {
                "unknown"
            } else {
                f.antipattern.as_str()
            };
            let line = if f.line > 0.0 || f.line < 0.0 {
                js::number_to_string(f.line)
            } else {
                "0".to_string()
            };
            format!("{ap}:{line}")
        })
        .collect();
    parts.sort_by(|a, b| crate::util::js_str_cmp(a, b));
    parts.join("|")
}

/// JS: bumpCursorDenial(cache, sessionId, filePath, findings) -> (key, count)
fn bump_cursor_denial(
    cache: &mut Cache,
    session_id: &str,
    file_path: &str,
    findings: &[Finding],
) -> (String, f64) {
    let session = ensure_session(cache, session_id);
    session.insert("updatedAt".into(), crate::util::now_value());
    let entry = ensure_file(cache, session_id, file_path);
    let key = finding_signature(findings);
    if !matches!(entry.get("cursorDenials"), Some(Value::Object(_))) {
        entry.insert("cursorDenials".into(), Value::Object(Map::new()));
    }
    let denials = entry
        .get_mut("cursorDenials")
        .unwrap()
        .as_object_mut()
        .unwrap();
    let count = denials.get(&key).and_then(Value::as_f64).unwrap_or(0.0) + 1.0;
    denials.insert(key.clone(), Value::from(count as u64));
    (key, count)
}

fn base_audit() -> Map<String, Value> {
    let mut m = Map::new();
    m.insert("ts".into(), Value::String(iso_now()));
    m.insert("event".into(), Value::String("preToolUse".into()));
    m
}

struct Out {
    stdout: String,
    audit: Map<String, Value>,
}

fn allow(extra: Map<String, Value>, payload_extra: Vec<(&str, Value)>) -> Out {
    let mut audit = base_audit();
    for (k, v) in extra {
        audit.insert(k, v);
    }
    let mut p = Map::new();
    p.insert("permission".into(), Value::from("allow"));
    for (k, v) in payload_extra {
        p.insert(k.to_string(), v);
    }
    Out {
        stdout: serde_json::to_string(&Value::Object(p)).unwrap_or_default(),
        audit,
    }
}

fn deny(message: &str, extra: Map<String, Value>) -> Out {
    let mut audit = base_audit();
    audit.insert("blocked".into(), Value::Bool(true));
    for (k, v) in extra {
        audit.insert(k, v);
    }
    let mut p = Map::new();
    p.insert("permission".into(), Value::from("deny"));
    p.insert("user_message".into(), Value::String(message.to_string()));
    p.insert("agent_message".into(), Value::String(message.to_string()));
    Out {
        stdout: serde_json::to_string(&Value::Object(p)).unwrap_or_default(),
        audit,
    }
}

fn ext(audit: &Map<String, Value>, more: Vec<(&str, Value)>) -> Map<String, Value> {
    let mut out = audit.clone();
    for (k, v) in more {
        out.insert(k.to_string(), v);
    }
    out
}

fn ms(started: f64) -> Value {
    Value::from((now_ms() - started).max(0.0) as u64)
}

fn main_flow(rt: &Runtime, stdin: &str) -> Out {
    if truthy(rt.env("IMPECCABLE_HOOK_DISABLED")) {
        let mut m = Map::new();
        m.insert("skipped".into(), Value::from("env-disabled"));
        return allow(m, vec![]);
    }
    let event: Option<Value> = if stdin.is_empty() {
        None
    } else {
        match serde_json::from_str::<Value>(stdin) {
            Ok(v) => Some(v),
            Err(_) => {
                let mut m = Map::new();
                m.insert("skipped".into(), Value::from("stdin-malformed"));
                return allow(m, vec![]);
            }
        }
    };
    let event = match event {
        Some(Value::Object(o)) => o,
        _ => {
            let mut m = Map::new();
            m.insert("skipped".into(), Value::from("stdin-empty"));
            return allow(m, vec![]);
        }
    };

    let session_cwd = resolve_project_cwd(rt, Some(&event), &rt.proc_cwd);
    let started = now_ms();
    let file_path = proposed_file_path(rt, &event, &session_cwd);
    let cwd = resolve_cache_cwd(
        rt,
        if file_path.is_empty() {
            None
        } else {
            Some(&file_path)
        },
        &session_cwd,
    );
    let mut audit = Map::new();
    audit.insert("harness".into(), Value::from("cursor"));
    audit.insert("cwd".into(), Value::String(cwd.clone()));
    audit.insert(
        "tool".into(),
        event
            .get("tool_name")
            .filter(|v| truthy_value(Some(v)))
            .cloned()
            .unwrap_or(Value::Null),
    );
    audit.insert(
        "file".into(),
        if file_path.is_empty() {
            Value::Null
        } else {
            Value::String(file_path.clone())
        },
    );

    let skip = |audit: &Map<String, Value>, reason: &str| -> Out {
        allow(
            ext(
                audit,
                vec![
                    ("skipped", Value::from(reason)),
                    ("durationMs", ms(started)),
                ],
            ),
            vec![],
        )
    };

    if file_path.is_empty() {
        return skip(&audit, "no-file-path");
    }
    if !is_scan_target_inside_project(rt, &file_path, &cwd) {
        return skip(&audit, "outside-project");
    }
    if is_sensitive_path(&file_path) {
        return skip(&audit, "sensitive");
    }
    if is_generated_path(&file_path) {
        return skip(&audit, "generated");
    }

    let config = read_config(&cwd);
    let ext_name = js::to_lower_case(&jsp::extname(&file_path));
    let configured = match_configured_extension(&file_path, &config.extensions);
    audit.insert(
        "ext".into(),
        Value::String(
            configured
                .map(|c| c.ext.clone())
                .unwrap_or_else(|| ext_name.clone()),
        ),
    );
    if !ALLOWED_EXTS.contains(&ext_name.as_str()) && configured.is_none() {
        return skip(&audit, "extension");
    }

    let content = match proposed_content(rt, &event, &cwd, &file_path) {
        Proposed::Skipped(reason) => return skip(&audit, reason),
        Proposed::Content(c) => c,
    };
    if content.is_empty() {
        return skip(&audit, "no-proposed-content");
    }
    if content.len() as u64 > MAX_SCANNED_BYTES {
        return skip(&audit, "content-too-large");
    }
    // A live variant session owns files carrying preview scaffolding. Check
    // the proposed content AND the file on disk: the very first variants
    // write introduces the markers, and later fragment edits (variant CSS
    // tweaks) touch a file that already carries them.
    if crate::hook_lib::has_live_preview_markers(&content)
        || read_existing_project_file(rt, &file_path, &cwd)
            .map(|on_disk| crate::hook_lib::has_live_preview_markers(&on_disk))
            .unwrap_or(false)
    {
        return skip(&audit, "live-preview");
    }
    if !config.enabled {
        return skip(&audit, "config-disabled");
    }
    let platform = resolve_project_platform(rt, &cwd);
    if is_native_platform(platform.as_deref()) {
        return allow(
            ext(
                &audit,
                vec![
                    ("skipped", Value::from("native-platform")),
                    ("platform", Value::String(platform.unwrap_or_default())),
                    ("durationMs", ms(started)),
                ],
            ),
            vec![],
        );
    }
    let rel = relative_path(rt, &file_path, &cwd);
    if matches_any_glob_list(&rel, &config.ignore_files)
        || matches_any_glob_list(&file_path, &config.ignore_files)
    {
        return skip(&audit, "config-ignore-file");
    }
    let scan = design_system_options(&config, &cwd);
    let use_html_engine = match configured {
        Some(c) => c.engine == "html",
        None => ext_name == ".html" || ext_name == ".htm",
    };
    let findings = if use_html_engine {
        match detect_proposed_html(rt, &content, &file_path, &scan) {
            Ok(f) => f,
            Err(_) => {
                return allow(
                    ext(
                        &audit,
                        vec![
                            ("error", Value::from("detector-threw")),
                            ("durationMs", ms(started)),
                        ],
                    ),
                    vec![],
                )
            }
        }
    } else {
        detector_detect_text(&content, &file_path, &scan)
    };
    let raw_count = findings.len();
    let filtered = filter_findings(findings, &config);
    if filtered.is_empty() {
        return allow(
            ext(
                &audit,
                vec![
                    ("findings", Value::from(raw_count)),
                    ("blockedFindings", Value::from(0)),
                    ("durationMs", ms(started)),
                ],
            ),
            vec![],
        );
    }
    let session_id = event
        .get("session_id")
        .filter(|v| truthy_value(Some(v)))
        .or_else(|| {
            event
                .get("conversation_id")
                .filter(|v| truthy_value(Some(v)))
        })
        .map(crate::util::js_string)
        .unwrap_or_else(|| "unknown".to_string());
    let mut cache = read_cache(&cwd);
    let short = footer_mode_short(&mut cache, &session_id);
    let reserve = design_note_reserve(rt, &scan, &mut cache, &session_id);
    let block = cursor_block_message(rt, &filtered, &file_path, &config, &cwd, short, reserve);
    let message =
        append_design_system_note_once(rt, &block, &scan, &mut cache, &session_id, &config);
    commit_footer_shown(rt, &mut cache, &session_id, &message);
    let (key, count) = bump_cursor_denial(&mut cache, &session_id, &file_path, &filtered);
    persist_cache(rt, &cwd, &cache);
    if count > EDIT_COUNT_THRESHOLD as f64 {
        let warning = format!(
            "{message}\n\nThis is the {}th repeated denial for the same file and finding signature, so Impeccable is allowing this write to avoid a loop. Reconsider the issue immediately after the tool runs.",
            js::number_to_string(count)
        );
        return allow(
            ext(
                &audit,
                vec![
                    ("findings", Value::from(raw_count)),
                    ("blockedFindings", Value::from(filtered.len())),
                    ("cursorDenialKey", Value::String(key)),
                    ("cursorDenialCount", Value::from(count as u64)),
                    ("downgraded", Value::Bool(true)),
                    ("chars", Value::from(utf16_len(&warning))),
                    ("durationMs", ms(started)),
                ],
            ),
            vec![
                ("user_message", Value::String(warning.clone())),
                ("agent_message", Value::String(warning)),
            ],
        );
    }
    deny(
        &message,
        ext(
            &audit,
            vec![
                ("findings", Value::from(raw_count)),
                ("blockedFindings", Value::from(filtered.len())),
                ("cursorDenialKey", Value::String(key)),
                ("cursorDenialCount", Value::from(count as u64)),
                ("chars", Value::from(utf16_len(&message))),
                ("durationMs", ms(started)),
            ],
        ),
    )
}

/// `impeccable hook-before-edit`. Returns the exit code (always 0).
pub fn run(rt: &Runtime, stdin: &str, io: &mut impeccable_common::Io) -> i32 {
    let out = main_flow(rt, stdin);
    write_audit_log(rt, &out.audit, &rt.proc_cwd);
    io.out(&out.stdout);
    0
}
