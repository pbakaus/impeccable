//! Human review calibrates a build. Acceptance of the first viewport is terminal
//! for that review journey, not a claim that every later page byte was reviewed.
use super::{manifest::string, store};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

pub fn accepted(state: &Value) -> bool {
    state["capture"]["schema"] == "native-component-previews-v1"
        && state["receipt"]["captureVerified"] == true
        && state["receipt"]["visualDecision"] == "approved"
        && state["packet"]["revision"].is_string()
        && state["packet"]["id"].is_string()
        && state["receipt"]["submission"]["packetRevision"] == state["packet"]["revision"]
        && state["receipt"]["submission"]["requestId"] == state["packet"]["id"]
        && state["receipt"]["capture"] == state["capture"]
}

pub fn closed(state: &Value) -> bool {
    state["packet"]["stage"] == "hero" && accepted(state)
}

pub fn terminal(state: &Value) -> Value {
    json!({"schemaVersion":1,"status":"accepted","reviewClosed":true,
        "scope":"first-viewport","requestId":state["packet"]["id"],
        "packetRevision":state["packet"]["revision"],"completionFeedback":null,
        "message":"The user accepted the assembled first viewport. Component and assembly review are closed. Continue the remaining work using the accepted direction; do not request either review again."})
}

/// The host supplies trusted receipt directories, never model-authored booleans.
/// Final acceptance supersedes the earlier kit checkpoint, including shared CSS
/// changes. Original receipts and pinned captures remain unchanged.
pub fn inspect(sessions: &[PathBuf], required: &[String]) -> Result<Value, String> {
    if required
        .iter()
        .any(|stage| !matches!(stage.as_str(), "components" | "hero"))
    {
        return Err("unknown review stage".into());
    }
    let states = sessions
        .iter()
        .map(|dir| store::read(&dir.join("current.json")))
        .collect::<Result<Vec<_>, _>>()?;
    if let Some(state) = states.iter().find(|s| closed(s)) {
        return Ok(terminal(state));
    }
    for stage in required {
        if !states
            .iter()
            .any(|s| s["packet"]["stage"] == *stage && accepted(s))
        {
            return Ok(
                json!({"schemaVersion":1,"status":"pending","reviewClosed":false,
                "stage":stage,"completionFeedback":format!("Human {stage} review is not approved. Request this review and await the user's decision.")}),
            );
        }
    }
    Ok(
        json!({"schemaVersion":1,"status":"approved","reviewClosed":false,"completionFeedback":null}),
    )
}

/// Ordinary local sessions share a project identity. Hosted sessions transport
/// their prior receipt directories explicitly because captures use snapshots.
pub fn project_sessions(root: &Path, project: &Path) -> Result<Vec<PathBuf>, String> {
    if !root.exists() { return Ok(vec![]); }
    if root.canonicalize().map_err(|e| e.to_string())?.starts_with(project) {
        return Err("review store must be outside the builder project".into());
    }
    let mut sessions = Vec::new();
    for entry in std::fs::read_dir(root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.len() != 64 || !name.bytes().all(|b| b.is_ascii_hexdigit()) { continue; }
        let path = entry.path();
        if !path.join("current.json").exists() { continue; }
        let state = store::read(&path.join("current.json"))?;
        if string(&state, "project")? == project.to_string_lossy() { sessions.push(path); }
    }
    Ok(sessions)
}

pub fn final_session(root: &Path, project: &Path) -> Result<Option<PathBuf>, String> {
    for path in project_sessions(root, project)? {
        if closed(&store::read(&path.join("current.json"))?) { return Ok(Some(path)); }
    }
    Ok(None)
}
