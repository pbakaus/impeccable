//! Read-only comp completion status shared by the CLI and native hooks.
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

pub const PHASES: [&str; 8] = ["comps", "spec", "plates", "hero", "sections", "motion", "responsive", "review"];

pub fn artifact_path(root: &Path, state: &Value) -> Option<PathBuf> {
    let relative = state.get("artifact")?.as_str()?;
    if relative.is_empty() { return None; }
    let path = Path::new(relative);
    let root = root.canonicalize().ok()?;
    let absolute = if path.is_absolute() { path.to_path_buf() } else { root.join(path) };
    let absolute = absolute.canonicalize().ok()?;
    absolute.starts_with(&root).then_some(absolute)
}

pub fn artifact_hash(root: &Path, state: &Value) -> Option<String> {
    let path = artifact_path(root, state)?;
    let bytes = std::fs::read(path).ok()?;
    Some(format!("{:x}", Sha256::digest(bytes)))
}

pub fn open_phases(state: &Value, include_review: bool) -> Vec<&'static str> {
    PHASES.iter().copied().filter(|phase| {
        (include_review || *phase != "review") && !matches!(
            state.pointer(&format!("/phases/{phase}/status")).and_then(Value::as_str),
            Some("closed" | "skipped")
        )
    }).collect()
}

pub fn report(root: &Path, state: Option<&Value>, session_id: Option<&str>) -> Value {
    let Some(state) = state else {
        return json!({"tool":"build-completion", "version":1, "status":"not-applicable", "canContinue":false});
    };
    let phases = open_phases(state, true);
    let disposition = state.pointer("/finish/disposition").and_then(Value::as_str);
    let owner = state.get("sessionId").and_then(Value::as_str).filter(|s| !s.is_empty());
    let scope = match (owner, session_id.filter(|s| !s.is_empty())) {
        (Some(a), Some(b)) if a == b => "current-session",
        (Some(_), Some(_)) => "other-session",
        _ => "unknown",
    };
    let current_hash = artifact_hash(root, state);
    let recorded_hash = state.pointer("/finish/artifactSha256").and_then(Value::as_str);
    let unchanged = recorded_hash.zip(current_hash.as_deref()).map(|(a,b)| a == b);
    let status = if phases.is_empty() && disposition == Some("ship") {
        match unchanged {
            Some(true) => "complete",
            Some(false) => "changed-after-finish",
            None => "unverified",
        }
    } else { "incomplete" };
    json!({
        "tool":"build-completion", "version":1, "status":status,
        "sessionScope":scope, "sessionId":owner, "buildStartedAt":state.get("startedAt"),
        "artifact":state.get("artifact"), "openPhases":phases,
        "disposition":disposition, "artifactUnchangedSinceFinish":unchanged,
        "canContinue":scope == "current-session" && current_hash.is_some()
            && matches!(status, "incomplete" | "changed-after-finish"),
        "verificationScope":"entry artifact bytes and recorded phase status; dependencies retain their own gate evidence"
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn missing_phase_is_unfinished() {
        assert_eq!(open_phases(&json!({"phases":{}}), false).len(), 7);
    }
    #[test]
    fn no_state_does_not_start_a_workflow() {
        assert_eq!(report(Path::new("."), None, Some("session"))["status"], "not-applicable");
    }
    #[test]
    fn absent_or_foreign_identity_cannot_continue() {
        for session in [None, Some("other")] {
            let state = json!({"sessionId":"owner","artifact":"missing.html"});
            assert_eq!(report(Path::new("."), Some(&state), session)["canContinue"], false);
        }
    }
}
