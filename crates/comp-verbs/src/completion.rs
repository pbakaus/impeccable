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

/// The tree the screenshot fallback fingerprints, project-relative: the
/// `fingerprintScope` in `.impeccable/config.json` when set, else "" (the whole
/// project). A scope that does not contain the entry is refused.
pub fn input_scope(root: &Path, state: &Value) -> Result<String, String> {
    let Ok(raw) = std::fs::read_to_string(root.join(".impeccable/config.json")) else { return Ok(String::new()) };
    let config: Value = serde_json::from_str(&raw).map_err(|e| format!(".impeccable/config.json is not valid JSON ({e})"))?;
    let scope = match config.get("fingerprintScope") {
        None => return Ok(String::new()),
        Some(Value::String(scope)) => scope.trim_start_matches("./").trim_end_matches('/'),
        Some(_) => return Err("fingerprintScope in .impeccable/config.json must be a folder path string".into()),
    };
    let inside = root.canonicalize().ok().zip(artifact_path(root, state)).is_some_and(|(base, entry)| entry.starts_with(scoped(&base, scope)));
    if !inside {
        let entry = state["artifact"].as_str().unwrap_or("the entry page");
        return Err(format!("fingerprintScope \"{scope}\" in .impeccable/config.json does not contain {entry}; set it to the folder that holds the page being built, relative to the project root"));
    }
    Ok(scope.to_string())
}

/// `scope` (always `/`-separated) under `root`, one component at a time: a
/// canonical Windows root is a verbatim path, where `/` does not separate.
fn scoped(root: &Path, scope: &str) -> PathBuf {
    scope.split('/').filter(|part| !part.is_empty()).fold(root.to_path_buf(), |path, part| path.join(part))
}

/// Conservative local frontend input signature for the screenshot fallback, over
/// the files under `scope` (see [`input_scope`]). Paths are hashed relative to the
/// project root, so scope "" is the whole-project signature older engines recorded.
/// Tool receipts and dependency caches cannot invalidate their own signature.
pub fn input_hash(root: &Path, scope: &str) -> Result<String, String> {
    /// Stops at the first limit it meets and names it in `over`.
    fn collect(root: &Path, dir: &Path, paths: &mut Vec<PathBuf>, total: &mut u64, over: &mut Option<String>) -> Result<(), String> {
        let unreadable=|path: &Path, e: std::io::Error| format!("cannot read {}: {e}", path.strip_prefix(root).unwrap_or(path).display());
        for entry in std::fs::read_dir(dir).map_err(|e|unreadable(dir,e))? {
            let entry=entry.map_err(|e|unreadable(dir,e))?;let path=entry.path();let name=entry.file_name();
            let name=name.to_string_lossy();
            if name.starts_with('.') || matches!(name.as_ref(), "node_modules"|"target") {continue;}
            let kind=entry.file_type().map_err(|e|unreadable(&path,e))?;
            if kind.is_symlink() { *over=Some(format!("it holds a symlink at {}", path.strip_prefix(root).unwrap_or(&path).display())); return Ok(()); }
            if kind.is_dir() {collect(root,&path,paths,total,over)?; if over.is_some() {return Ok(());}}
            else if matches!(path.extension().and_then(|v|v.to_str()),
                Some("html"|"htm"|"css"|"scss"|"sass"|"less"|"js"|"mjs"|"cjs"|"ts"|"tsx"|"jsx"|"vue"|"svelte"|"astro"|"json"|"svg"|"png"|"jpg"|"jpeg"|"webp"|"avif"|"gif"|"woff"|"woff2"|"ttf"|"otf"|"mp4"|"webm")) {
                *total=total.saturating_add(entry.metadata().map_err(|e|unreadable(&path,e))?.len());
                paths.push(path.strip_prefix(root).unwrap_or(&path).to_path_buf());
                if paths.len()>10000 { *over=Some("it holds more than 10000 frontend files (the limit)".into()); return Ok(()); }
            }
        }
        Ok(())
    }
    let root=root.canonicalize().map_err(|e|format!("cannot read the project root: {e}"))?;
    let under=if scope.is_empty() {"the project".to_string()} else {format!("{scope}/")};
    let start=scoped(&root,scope);
    if !Path::new(scope).components().all(|c|matches!(c,std::path::Component::Normal(_)))
        || start.canonicalize().ok().as_deref()!=Some(start.as_path()) || !start.is_dir() {
        return Err(format!("{under} is not a directory inside the project"));
    }
    // Sizes come from the walk, so an oversized tree is refused before any file is read.
    let (mut paths,mut total,mut over)=(Vec::new(),0u64,None);
    collect(&root,&start,&mut paths,&mut total,&mut over)?;
    if over.is_none() && total>256*1024*1024 { over=Some(format!("it holds {} MiB of frontend files (the limit is 256 MiB)", total.div_ceil(1024*1024))); }
    if let Some(why)=over {
        return Err(format!("{under} cannot be checked in full: {why}. Find the folder that holds the site and ask the user once: \"Your project is too big to check in full. I think the site is in `<dir>/`. Is that right? If not, which folder is it?\" Add the answer to .impeccable/config.json as \"fingerprintScope\": \"<dir>\" and advance responsive again. With no one to answer, use your own guess and say so in your report"));
    }
    paths.sort();
    let mut hasher=Sha256::new();
    for path in paths {
        hasher.update(path.to_string_lossy().as_bytes());hasher.update([0]);
        hasher.update(Sha256::digest(std::fs::read(root.join(&path)).map_err(|e|format!("cannot read {}: {e}",path.display()))?));
    }
    Ok(format!("{:x}",hasher.finalize()))
}

/// The files the final native capture bound (its `inputs.json` manifest), as
/// `finish` recorded them. Returns the recorded paths whose bytes differ now (a
/// deleted file counts as changed), or `None` when nothing was recorded or a
/// recorded path is not a plain project-relative path.
pub fn changed_capture_inputs(root: &Path, state: &Value) -> Option<Vec<String>> {
    let files = state.pointer("/finish/captureInputs")?.as_array()?;
    let root = root.canonicalize().ok()?;
    let mut changed = Vec::new();
    for file in files {
        let relative = file.get("path")?.as_str()?;
        let recorded = file.get("sha256")?.as_str()?;
        let path = Path::new(relative);
        if relative.is_empty() || !path.components().all(|c| matches!(c, std::path::Component::Normal(_))) {
            return None;
        }
        let current = std::fs::read(root.join(path)).ok().map(|bytes| format!("{:x}", Sha256::digest(bytes)));
        if current.as_deref() != Some(recorded) {
            changed.push(relative.to_string());
        }
    }
    Some(changed)
}

/// A fingerprint of everything the recorded finish is checked against now: the
/// entry's bytes and each recorded capture input's current bytes. It moves when
/// any bound file changes, not only the entry.
pub fn bound_fingerprint(root: &Path, state: &Value) -> Option<String> {
    let mut hasher = Sha256::new();
    hasher.update(artifact_hash(root, state)?.as_bytes());
    if let Some(files) = state.pointer("/finish/captureInputs").and_then(Value::as_array) {
        let root = root.canonicalize().ok()?;
        for file in files {
            let relative = file.get("path").and_then(Value::as_str).unwrap_or("");
            let path = Path::new(relative);
            hasher.update([0]);
            hasher.update(relative.as_bytes());
            if !relative.is_empty() && path.components().all(|c| matches!(c, std::path::Component::Normal(_))) {
                if let Ok(bytes) = std::fs::read(root.join(path)) { hasher.update(Sha256::digest(bytes)); }
            }
        }
    }
    Some(format!("{:x}", hasher.finalize()))
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
    let mut changed_inputs: Vec<String> = Vec::new();
    if unchanged == Some(false) {
        if let Some(artifact) = state.get("artifact").and_then(Value::as_str) { changed_inputs.push(artifact.to_string()); }
    }
    if state.pointer("/finish/captureInputs").is_some() {
        unchanged = match (unchanged, changed_capture_inputs(root, state)) {
            (entry, Some(changed)) => {
                for path in changed { if !changed_inputs.contains(&path) { changed_inputs.push(path); } }
                // A deleted entry has no hash, but the manifest still names it as changed.
                if !changed_inputs.is_empty() { Some(false) } else { entry }
            }
            _ => None,
        };
    }
    if let Some(recorded) = state.pointer("/finish/artifactInputsSha256").and_then(Value::as_str) {
        let scope = state.pointer("/finish/artifactInputsScope").and_then(Value::as_str).unwrap_or("");
        unchanged = match (unchanged,input_hash(root, scope)) {
            (Some(entry),Ok(inputs)) => Some(entry && recorded == inputs),
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
        "changedSinceFinish":changed_inputs,
        "canContinue":scope == "current-session" && current_hash.is_some()
            && matches!(status, "incomplete" | "changed-after-finish"),
        "verificationScope":if state["finish"]["artifactInputsSha256"].is_string() {"local frontend inputs and recorded phase status"}
            else if state["finish"]["captureInputs"].is_array() {"entry artifact and every file the final native capture bound, and recorded phase status"}
            else {"entry artifact bytes and recorded phase status; dependencies retain their own gate evidence"}
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
    fn root_scope_hash_matches_the_signature_older_engines_recorded() {
        let dir = std::env::temp_dir().join(format!("input-hash-compat-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("index.html"), "<main>First</main>").unwrap();
        std::fs::write(dir.join("styles.css"), "body{}").unwrap();
        // Digest of the pre-scope algorithm over index.html and styles.css.
        assert_eq!(input_hash(&dir, "").unwrap(), "69b1db45e244b97e5995c8dd8df7c77b7e6d9d55f26ba992ea1dcaca8a3cb795");
        assert!(input_hash(&dir, "../elsewhere").is_err());
        // A nested fingerprintScope resolves on a canonical (verbatim on Windows) root.
        std::fs::create_dir_all(dir.join("apps/web")).unwrap();
        std::fs::create_dir_all(dir.join(".impeccable")).unwrap();
        std::fs::write(dir.join("apps/web/index.html"), "<main/>").unwrap();
        std::fs::write(dir.join(".impeccable/config.json"), r#"{"fingerprintScope":"./apps/web/"}"#).unwrap();
        assert_eq!(input_scope(&dir, &json!({"artifact":"apps/web/index.html"})).unwrap(), "apps/web");
        assert!(input_hash(&dir, "apps/web").is_ok());
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn absent_or_foreign_identity_cannot_continue() {
        for session in [None, Some("other")] {
            let state = json!({"sessionId":"owner","artifact":"missing.html"});
            assert_eq!(report(Path::new("."), Some(&state), session)["canContinue"], false);
        }
    }
}
