//! Completion feedback for a build explicitly owned by this native session.
use crate::hook_lib::{Cache, Runtime, ensure_session, persist_cache};
use impeccable_comp_verbs::completion;
use serde_json::{json, Value};
use std::path::Path;

fn literal_session_id(session: &str) -> bool {
    !session.is_empty() && session.len() <= 200
        && session.bytes().all(|b| b.is_ascii_alphanumeric() || b"_-:.".contains(&b))
}

/// Gemini supplies identity to hooks, but not ordinary shell tool processes.
/// Its native BeforeTool argument transform carries that metadata into the
/// POSIX shell without adding model instructions or changing the command body.
/// Only `build-phase` reads IMPECCABLE_SESSION_ID (start records the owner,
/// completion scopes the report), so every other command passes through
/// untouched: a prefix would change its first word for Gemini's allowlist and
/// coreTools policy. This runs before every shell call, so it is string checks
/// only. Windows shell semantics require a separate transport; decline there.
pub fn gemini_shell_identity(rt: &Runtime, event: &serde_json::Map<String, Value>) -> Option<String> {
    if rt.win32 || event.get("tool_name")?.as_str()? != "run_shell_command" { return None; }
    let command = event.get("tool_input")?.get("command")?.as_str()?;
    if !command.contains("build-phase") || command.contains("--session-id") { return None; }
    let session = event.get("session_id")?.as_str()?;
    if !literal_session_id(session) { return None; }
    let prefix = format!("export IMPECCABLE_SESSION_ID='{session}'\n");
    if command.starts_with(&prefix) { return None; }
    Some(json!({"hookSpecificOutput":{"tool_input":{"command":format!("{prefix}{command}")}}}).to_string())
}

pub fn reminder(rt: &Runtime, cwd: &str, session: &str, active: bool, cache: &mut Cache) -> Option<String> {
    if session == "unknown" || session.is_empty() { return None; }
    let root = Path::new(cwd);
    let state: Value = serde_json::from_str(&std::fs::read_to_string(root.join(".impeccable/build/state.json")).ok()?).ok()?;
    let report = completion::report(root, Some(&state), Some(session));
    if report["canContinue"] != true { return None; }
    let build = state.get("startedAt")?.as_str()?;
    let artifact = state.get("artifact")?.as_str()?;
    let key = format!("{build}:{artifact}");
    let current_hash = completion::artifact_hash(root, &state)?;
    let old = ensure_session(cache, session).get("buildCompletionNotice").cloned().unwrap_or(Value::Null);
    let same_build = old["build"] == key;
    let count = if same_build { old["count"].as_u64().unwrap_or(0) } else { 0 };
    // Do not take over a continuation issued by another Stop hook. On a new
    // turn, unchanged old work must not consume another reminder either.
    if count >= 3 || (active && count == 0)
        || (!active && same_build && old["artifactSha256"] == current_hash) { return None; }
    ensure_session(cache, session).insert("buildCompletionNotice".into(), json!({
        "build":key, "count":count+1, "artifactSha256":current_hash
    }));
    // Never emit an unbounded continuation if the counter cannot be saved.
    if !persist_cache(rt, cwd, cache) { return None; }
    let open = report["openPhases"].as_array()?.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(", ");
    let evidence = if report["status"] == "changed-after-finish" {
        "The entry artifact changed after the recorded final review.".to_string()
    } else { format!("Open phases: {open}.") };
    Some(format!("Comp build for {artifact} is unfinished. {evidence} Complete the remaining checks and record the actual finish disposition. If work is blocked, report what remains unresolved. This is completion pass {} of 3; existing fidelity gates still apply.", count+1))
}

/// Claude exposes a session-specific environment file at SessionStart. Store
/// only identity, not prompts or policy. Codex supplies CODEX_THREAD_ID itself.
pub fn persist_session_identity(rt: &Runtime, session: &str) {
    use std::io::Write;
    if !literal_session_id(session) { return; }
    let Some(path) = rt.env("CLAUDE_ENV_FILE").filter(|p| !p.is_empty()) else { return; };
    if let Ok(mut file) = std::fs::OpenOptions::new().append(true).create(true).open(path) {
        let _ = writeln!(file, "export IMPECCABLE_SESSION_ID='{session}'");
    }
}
