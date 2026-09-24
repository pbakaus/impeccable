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

/// Conservative local frontend input signature for the screenshot fallback.
/// Tool receipts and dependency caches cannot invalidate their own signature.
pub fn input_hash(root: &Path) -> Option<String> {
    fn collect(root: &Path, dir: &Path, paths: &mut Vec<PathBuf>) -> Option<()> {
        for entry in std::fs::read_dir(dir).ok()? {
            let entry=entry.ok()?;let path=entry.path();let name=entry.file_name();
            let name=name.to_string_lossy();
            if name.starts_with('.') || matches!(name.as_ref(), "node_modules"|"target") {continue;}
            let kind=entry.file_type().ok()?;
            if kind.is_symlink() { return None; }
            if kind.is_dir() {collect(root,&path,paths)?;}
            else if matches!(path.extension().and_then(|v|v.to_str()),
                Some("html"|"htm"|"css"|"scss"|"sass"|"less"|"js"|"mjs"|"cjs"|"ts"|"tsx"|"jsx"|"vue"|"svelte"|"astro"|"json"|"svg"|"png"|"jpg"|"jpeg"|"webp"|"avif"|"gif"|"woff"|"woff2"|"ttf"|"otf"|"mp4"|"webm")) {
                paths.push(path.strip_prefix(root).ok()?.to_path_buf());
                if paths.len()>10000 {return None;}
            }
        }
        Some(())
    }
    let root=root.canonicalize().ok()?;let mut paths=Vec::new();collect(&root,&root,&mut paths)?;paths.sort();
    let mut hasher=Sha256::new();let mut total=0u64;
    for path in paths {
        let full=root.join(&path);total=total.checked_add(std::fs::metadata(&full).ok()?.len())?;
        if total>256*1024*1024 {return None;}
        hasher.update(path.to_string_lossy().as_bytes());hasher.update([0]);
        hasher.update(Sha256::digest(std::fs::read(full).ok()?));
    }
    Some(format!("{:x}",hasher.finalize()))
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
    let mut unchanged = recorded_hash.zip(current_hash.as_deref()).map(|(a,b)| a == b);
    if let Some(recorded) = state.pointer("/finish/artifactInputsSha256").and_then(Value::as_str) {
        unchanged = match (unchanged,input_hash(root)) {
            (Some(entry),Some(inputs)) => Some(entry && recorded == inputs),
            _ => None,
        };
    }
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
        "verificationScope":if state["finish"]["artifactInputsSha256"].is_string() {"local frontend inputs and recorded phase status"} else {"entry artifact bytes and recorded phase status; dependencies retain their own gate evidence"}
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
