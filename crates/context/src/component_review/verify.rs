//! Read-only approval verification against the current native capture and source bytes.
use super::{manifest::{digest, string}, store};
use serde_json::Value;
use std::{collections::BTreeSet, path::Path};

pub fn approved(store_root: &Path, project: &Path, manifest_path: &str) -> Result<Value, String> {
    let project = project.canonicalize().map_err(|e| e.to_string())?;
    if let Some(dir) = super::lifecycle::final_session(store_root, &project)? {
        let state = store::read(&dir.join("current.json"))?;
        capture_intact(&dir, &state)?;
        return Ok(state["receipt"].clone());
    }
    let manifest_file = project.join(super::manifest::relative(manifest_path)?);
    let manifest = store::read(&manifest_file)?;
    let directory = store::session_dir(store_root, &project, string(&manifest, "id")?);
    let _guard = store::lock(&directory)?;
    let state = store::read(&directory.join("current.json"))?;
    store::sources_current(&state)?;
    if !super::capture::verified(&state)
        || state["receipt"]["captureVerified"] != true
        || state["receipt"]["visualDecision"] != "approved"
        || state["receipt"]["submission"]["packetRevision"] != state["packet"]["revision"]
        || state["receipt"]["submission"]["requestId"] != state["packet"]["id"]
    {
        return Err(
            "component review is pending or needs work; await the user, then verify again".into(),
        );
    }
    // A different manifest with the same ID must not borrow this session's approval.
    let source = state["sources"][manifest_path]
        .as_str()
        .ok_or("review did not bind this manifest")?;
    if digest(&std::fs::read(manifest_file).map_err(|e| e.to_string())?) != source {
        return Err("review manifest changed; capture a new round".into());
    }
    let ids = |v: &Value| -> BTreeSet<String> {
        v.as_array().into_iter().flatten().filter_map(|c| c["id"].as_str().map(String::from)).collect()
    };
    if ids(&manifest["components"]) != ids(&state["packet"]["components"]) {
        return Err("review packet does not match this manifest; capture a new round".into());
    }
    capture_intact(&directory, &state)?;
    Ok(state["receipt"].clone())
}

/// Recompute capture integrity from the pinned blobs instead of trusting the
/// stored `captureVerified` flag: every component carries native evidence,
/// every served file matches its blob, and code views point at captured pixels.
pub fn capture_intact(dir: &Path, state: &Value) -> Result<(), String> {
    let fail = |why: &str| Err(format!("component review capture is not intact: {why}"));
    if !super::capture::verified(state) || state["receipt"]["capture"] != state["capture"] {
        return fail("no native capture bound to the receipt");
    }
    let files = state["files"].as_object().ok_or("missing pinned files")?;
    let sources = state["sources"].as_object().ok_or("missing pinned sources")?;
    for (path, hash) in files {
        let hash = hash.as_str().unwrap_or("");
        let captured = path.starts_with("_review_captures/");
        if hash.len() != 64 || !hash.bytes().all(|b| b.is_ascii_hexdigit())
            || std::fs::read(dir.join("blobs").join(hash)).map(|b| digest(&b)).ok().as_deref() != Some(hash)
            || (!captured && sources.get(path).and_then(Value::as_str) != Some(hash))
        {
            return fail(&format!("{path} does not match its pinned bytes"));
        }
    }
    let prefix = format!("/files/{}/", string(&state["packet"], "revision")?);
    let pinned = |view: &Value| -> Option<(String, String)> {
        let path = view["url"].as_str()?.strip_prefix(&prefix)?.to_string();
        Some((path.clone(), files.get(&path)?.as_str()?.to_string()))
    };
    if pinned(&state["packet"]["comp"]).is_none() {
        return fail("comp is not pinned");
    }
    let v3 = state["packet"]["schemaVersion"] == 3;
    if v3 && (state["packet"]["specSha256"].as_str().is_none()
        || sources.get(super::plan::SPEC) != Some(&state["packet"]["specSha256"]))
    {
        return fail("the reviewed spec digest does not match the pinned spec");
    }
    let components = state["packet"]["components"].as_array().ok_or("missing components")?;
    let evidence = state["capture"]["components"].as_array().ok_or("missing capture evidence")?;
    if evidence.len() != components.len() {
        return fail("evidence does not cover every component");
    }
    for c in components {
        let id = string(c, "id")?;
        let Some(proof) = evidence.iter().find(|e| e["id"] == id) else {
            return fail(&format!("{id} has no capture evidence"));
        };
        if v3 && c["preview"]["kind"] == "comp-crop" {
            let (comp, proof) = (pinned(&state["packet"]["comp"]), &proof["views"]["preview"]);
            if c["role"] != "plan" || !c["context"].is_null() || !c["thumbnail"].is_null() || proof["kind"] != "comp-crop"
                || proof["box"] != c["box"] || comp.as_ref().map(|(p, h)| (p.as_str(), h.as_str())) != Some((proof["compPath"].as_str().unwrap_or(""), proof["compSha256"].as_str().unwrap_or("")))
            {
                return fail(&format!("{id} lacks comp-crop evidence"));
            }
            continue;
        }
        if v3 && (c["role"] != "asset" || !c["context"].is_null()) {
            return fail(&format!("{id} lacks raster-source evidence"));
        }
        for key in ["preview", "context", "thumbnail"] {
            if c[key].is_null() && key != "preview" {
                continue;
            }
            let Some((path, hash)) = pinned(&c[key]) else {
                return fail(&format!("{id} {key} is not pinned"));
            };
            let view = &proof["views"][key];
            let ok = if key == "thumbnail" {
                Some((path, hash)) == pinned(&c["preview"])
            } else if view["kind"] == "raster-source" {
                key == "preview" && c[key]["kind"] == "image" && view["path"] == path.as_str() && view["sha256"] == hash.as_str()
            } else {
                !v3 && c[key]["kind"] == "image" && c[key]["sourceKind"] == "page"
                    && path == format!("_review_captures/{hash}.png") && view["screenshotSha256"] == hash.as_str()
            };
            if !ok {
                return fail(&format!("{id} {key} lacks native capture evidence"));
            }
        }
    }
    Ok(())
}
