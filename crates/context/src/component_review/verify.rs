//! Read-only approval verification against the current native capture and source bytes.
use super::{manifest::string, store};
use serde_json::Value;
use std::path::Path;

pub fn approved(store_root: &Path, project: &Path, manifest_path: &str) -> Result<Value, String> {
    let project = project.canonicalize().map_err(|e| e.to_string())?;
    let manifest_file = project.join(super::manifest::relative(manifest_path)?);
    let manifest = store::read(&manifest_file)?;
    let directory = store::session_dir(store_root, &project, string(&manifest, "id")?);
    let _guard = store::lock(&directory)?;
    let state = store::read(&directory.join("current.json"))?;
    store::sources_current(&state)?;
    if state["capture"]["schema"] != "native-component-previews-v1"
        || state["receipt"]["captureVerified"] != true
        || state["receipt"]["visualDecision"] != "approved"
        || state["receipt"]["submission"]["packetRevision"] != state["packet"]["revision"]
        || state["receipt"]["submission"]["requestId"] != state["packet"]["id"]
    {
        return Err("component review is pending or needs work; await the user, then verify again".into());
    }
    // A different manifest with the same ID must not borrow this session's approval.
    let source = state["sources"][manifest_path].as_str().ok_or("review did not bind this manifest")?;
    if super::manifest::digest(&std::fs::read(manifest_file).map_err(|e| e.to_string())?) != source {
        return Err("review manifest changed; capture a new round".into());
    }
    Ok(state["receipt"].clone())
}
