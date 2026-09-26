//! Visual decisions bind reviewed pixels and scope; source integrity remains separate.
use super::manifest::digest;
use serde_json::{json, Value};
use std::path::Path;

fn identity(state: &Value, component: &Value, blobs: &Path) -> Option<Value> {
    if !super::capture::verified(state) {
        return None;
    }
    let evidence = state["capture"]["components"]
        .as_array()?
        .iter()
        .find(|c| c["id"] == component["id"])?;
    let prefix = format!("/files/{}/", state["packet"]["revision"].as_str()?);
    let mut definition = component.clone();
    definition.as_object_mut()?.remove("revision");
    let component_stage = state["packet"]["stage"] == "components";
    if component_stage {
        // The checkpoint approves the isolated component. Context is explicitly
        // reference-only; shared document dependencies and thumbnails are not
        // additional things the user approves. Source integrity still binds the
        // full frozen closure and is checked separately by sources_current.
        for key in ["dependencies", "context", "thumbnail"] {
            definition.as_object_mut()?.remove(key);
        }
    }
    let mut views = serde_json::Map::new();
    let keys: &[&str] = if component_stage { &["preview", "comp"] }
        else { &["preview", "context", "thumbnail", "comp"] };
    for &key in keys {
        let view = if key == "comp" {
            &state["packet"]["comp"]
        } else {
            &component[key]
        };
        if view.is_null() {
            continue;
        }
        if key == "preview" && view["kind"] == "comp-crop" {
            // A plan item's pixels are the comp crop: its box is in the definition, the comp in `comp`.
            if evidence["views"]["preview"]["kind"] != "comp-crop" { return None; }
            views.insert(key.into(), view.clone());
            continue;
        }
        let path = view["url"].as_str()?.strip_prefix(&prefix)?;
        let hash = state["files"][path].as_str()?;
        if hash.len() != 64 || !hash.bytes().all(|b| b.is_ascii_hexdigit()) {
            return None;
        }
        if digest(&std::fs::read(blobs.join(hash)).ok()?) != hash {
            return None;
        }
        let mut scoped = view.clone();
        scoped.as_object_mut()?.remove("url");
        scoped["sha256"] = json!(hash);
        if key != "comp" {
            definition[key] = scoped.clone();
        }
        let proof = &evidence["views"][key];
        if view["sourceKind"] == "page" {
            if proof["kind"] != "static-code"
                || proof["screenshotSha256"] != hash
                || !proof["viewport"].is_object()
            {
                return None;
            }
            // Keep capture geometry and representation. Whole-document hashes and
            // resource hashes are deliberately not visual approval identities.
            for field in [
                "kind",
                "entry",
                "viewport",
                "box",
                "cropMethod",
                "reducedMotion",
                "svgElements",
                "rasterElements",
                "semanticControls",
            ] {
                // These counts describe the entire shared document, including
                // components outside this decision's isolated preview.
                if component_stage && matches!(field, "svgElements" | "rasterElements" | "semanticControls") { continue; }
                scoped[field] = proof[field].clone();
            }
        }
        views.insert(key.into(), scoped);
    }
    Some(
        json!({"component":definition,"views":views,"stage":state["packet"]["stage"],"request":state["packet"]["id"]}),
    )
}

/// Rebind a submitted visual approval to an unchanged captured presentation.
/// Never manufacture a receipt or suppress a source change.
pub fn carry(previous: &Value, current: &mut Value, blobs: &Path) -> usize {
    if previous["journey"] != current["journey"]
        || previous["receipt"]["captureVerified"] != true
        || previous["receipt"]["submission"]["packetRevision"] != previous["packet"]["revision"]
    {
        return 0;
    }
    let Some(components) = current["packet"]["components"].as_array().cloned() else {
        return 0;
    };
    let mut count = 0;
    for component in components {
        let Some(id) = component["id"].as_str() else {
            continue;
        };
        // Preserve all new human work, including needs-work decisions.
        if !current["draft"]["decisions"][id].is_null() {
            continue;
        }
        let Some(prior) = previous["packet"]["components"]
            .as_array()
            .and_then(|cs| cs.iter().find(|c| c["id"] == id))
        else {
            continue;
        };
        let decision = &previous["receipt"]["submission"]["decisions"][id];
        if decision["action"] != "approve" || decision["revision"] != prior["revision"] {
            continue;
        }
        let Some(before) = identity(previous, prior, blobs) else {
            continue;
        };
        if identity(current, &component, blobs).as_ref() != Some(&before) {
            continue;
        }
        let mut carried = decision.clone();
        carried["revision"] = component["revision"].clone();
        current["draft"]["decisions"][id] = carried;
        current["visualApprovalCarry"][id] = json!({"fromPacketRevision":previous["packet"]["revision"],"fromComponentRevision":prior["revision"],"basis":"identical-native-captures-v1"});
        count += 1;
    }
    count
}
