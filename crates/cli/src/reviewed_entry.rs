//! A human-approved assembled capture is evidence for code-region styling, never a
//! replacement for native integrity, missing-region, or overall fidelity gates.
use crate::entry_capture::CdpEntryRenderer;
use impeccable_comp_verbs::asset_capture::capture_sha256;
use impeccable_comp_verbs::entry_capture::{
    ApprovedReference, CapturedEntry, EntryEvidence, EntryRenderer, EntryRequest,
};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
};

pub struct ReviewedEntryRenderer {
    pub session: Option<PathBuf>,
}
struct ReviewedEntry {
    source: Box<dyn CapturedEntry>,
    evidence: EntryEvidence,
    approved: Option<ApprovedReference>,
    session: Option<PathBuf>,
    request: EntryRequest,
}
fn read(path: &Path) -> Result<Value, String> {
    serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}
fn file(root: &Path, path: &str) -> Result<Vec<u8>, String> {
    let mut full = root.to_path_buf();
    for c in Path::new(path).components() {
        let std::path::Component::Normal(c) = c else {
            return Err("invalid reviewed path".into());
        };
        full.push(c);
        if fs::symlink_metadata(&full)
            .map_err(|e| e.to_string())?
            .file_type()
            .is_symlink()
        {
            return Err("symlink in reviewed source".into());
        }
    }
    fs::read(full).map_err(|e| e.to_string())
}
/// Read only private native session state. The host selects the session; neither
/// a model-written receipt nor a saved build-phase report is an authority.
fn reference(
    session: &Path,
    r: &EntryRequest,
    evidence: &EntryEvidence,
) -> Result<ApprovedReference, String> {
    let root = r.root.canonicalize().map_err(|e| e.to_string())?;
    if session
        .canonicalize()
        .map_err(|e| e.to_string())?
        .starts_with(&root)
    {
        return Err("review session must be outside the project".into());
    }
    let state = read(&session.join("current.json"))?;
    let packet = &state["packet"];
    let receipt = &state["receipt"];
    if packet["stage"] != "hero"
        || receipt["visualDecision"] != "approved"
        || receipt["captureVerified"] != true
        || receipt["capture"] != state["capture"]
        || state["capture"]["schema"] != "native-component-previews-v1"
        || receipt["submission"]["packetRevision"] != packet["revision"]
        || receipt["submission"]["requestId"] != packet["id"]
    {
        return Err("assembled review is not approved".into());
    }
    let components = packet["components"]
        .as_array()
        .filter(|c| c.len() == 1)
        .ok_or("expected one assembled page")?;
    let component = &components[0];
    if component["box"] != json!({"x":0,"y":0,"w":1,"h":1})
        || component["preview"]["sourceKind"] != "page"
    {
        return Err("review did not cover the assembled viewport".into());
    }
    let capture = &state["capture"]["components"][0]["views"]["preview"];
    if capture["kind"] != "assembled-page"
        || capture["entry"] != r.artifact
        || capture["viewport"]["dpr"] != 1
        || capture["viewport"]["width"] != packet["comp"]["width"]
        || capture["viewport"]["height"] != packet["comp"]["height"]
    {
        return Err("reviewed viewport or entry differs".into());
    }
    let sources = state["sources"]
        .as_object()
        .ok_or("missing review sources")?;
    for (path, hash) in sources {
        if hash.as_str() != Some(&capture_sha256(&file(&root, path)?)) {
            return Err(format!("reviewed source changed: {path}"));
        }
    }
    if !sources.contains_key(&r.artifact) || !sources.contains_key(&r.reference) {
        return Err("review must bind entry and original comp".into());
    }
    let comp_url = packet["comp"]["url"]
        .as_str()
        .ok_or("missing reviewed comp")?;
    if comp_url
        != format!(
            "/files/{}/{}",
            packet["revision"].as_str().ok_or("missing revision")?,
            r.reference
        )
    {
        return Err("reviewed reference differs".into());
    }
    // A newly added served file must not borrow an earlier approval.
    for input in evidence.report["manifest"]["files"]
        .as_array()
        .ok_or("missing current native inputs")?
    {
        let path = input["path"].as_str().ok_or("invalid input")?;
        let raster = matches!(
            Path::new(path).extension().and_then(|s| s.to_str()),
            Some("png" | "jpg" | "jpeg" | "webp" | "avif" | "gif")
        );
        if input["served"] == true
            && !raster
            && sources.get(input["path"].as_str().ok_or("invalid input")?) != Some(&input["sha256"])
        {
            return Err("native inputs differ from reviewed inputs".into());
        }
    }
    // Available but unused raster variants are not dependencies. Every raster
    // actually observed at the captured breakpoint must belong to the approval.
    for frame in &evidence.frames {
        for region in &frame.regions {
            for binding in region.receipt["resourceBindings"]
                .as_array()
                .ok_or("missing observed raster bindings")?
            {
                if !sources
                    .values()
                    .any(|h| h == &binding["responseSha256"] && h.is_string())
                {
                    return Err("unreviewed raster contributes to current page".into());
                }
            }
        }
    }
    let hash = capture["screenshotSha256"]
        .as_str()
        .filter(|h| h.len() == 64 && h.bytes().all(|c| c.is_ascii_hexdigit()))
        .ok_or("missing reviewed screenshot digest")?;
    let preview = component["preview"]["url"]
        .as_str()
        .ok_or("missing preview")?;
    let relative = preview
        .strip_prefix(&format!("/files/{}/", packet["revision"].as_str().unwrap()))
        .ok_or("preview revision differs")?;
    if state["files"][relative] != hash {
        return Err("reviewed preview digest differs".into());
    }
    let png = fs::read(session.join("blobs").join(hash)).map_err(|e| e.to_string())?;
    if capture_sha256(&png) != hash {
        return Err("reviewed screenshot changed".into());
    }
    Ok(ApprovedReference {
        png,
        proof: json!({"schema":"human-assembled-reference-v1","requestId":packet["id"],"packetRevision":packet["revision"],"sha256":hash,"scope":"Code-region styling accepted in a source-bound assembled-page review; material and fidelity gates retained"}),
    })
}
impl EntryRenderer for ReviewedEntryRenderer {
    fn capture_entry(&self, r: &EntryRequest) -> Result<Box<dyn CapturedEntry>, String> {
        let source = CdpEntryRenderer.capture_entry(r)?;
        let candidate = self
            .session
            .as_ref()
            .map(|s| reference(s, r, source.evidence()));
        let mut report = source.evidence().report.clone();
        if let Some(Err(reason)) = &candidate {
            report["humanTextReview"] = json!({"status":"not-current","reason":reason});
        }
        let approved = candidate.and_then(Result::ok);
        if let Some(a) = &approved {
            report["humanTextReview"] = a.proof.clone();
        }
        // Frames are produced once by the native adapter; copy bytes for the transport.
        let frames = source
            .evidence()
            .frames
            .iter()
            .map(|f| impeccable_comp_verbs::entry_capture::FrameEvidence {
                name: f.name.clone(),
                png: f.png.clone(),
                regions: f
                    .regions
                    .iter()
                    .map(|r| impeccable_comp_verbs::asset_capture::AssetCapture {
                        receipt: r.receipt.clone(),
                        images: vec![],
                    })
                    .collect(),
            })
            .collect();
        Ok(Box::new(ReviewedEntry {
            source,
            evidence: EntryEvidence { report, frames },
            approved,
            session: self.session.clone(),
            request: EntryRequest {
                root: r.root.clone(),
                artifact: r.artifact.clone(),
                spec: r.spec.clone(),
                reference: r.reference.clone(),
                stage: r.stage,
            },
        }))
    }
}
impl CapturedEntry for ReviewedEntry {
    fn evidence(&self) -> &EntryEvidence {
        &self.evidence
    }
    fn approved_reference(&self) -> Option<&ApprovedReference> {
        self.approved.as_ref()
    }
    fn verify_current(&self) -> Result<(), String> {
        self.source.verify_current()?;
        if let Some(a) = &self.approved {
            let current = reference(
                self.session.as_ref().unwrap(),
                &self.request,
                self.source.evidence(),
            )?;
            if current.png != a.png || current.proof != a.proof {
                return Err("human review changed during capture".into());
            }
        }
        Ok(())
    }
}
impl ReviewedEntryRenderer {
    pub fn local(root: &Path, home: Option<&Path>) -> Self {
        let session = (|| {
            let manifest = read(&root.join(".impeccable/review/hero.json")).ok()?;
            let project = root.canonicalize().ok()?;
            let id = manifest["id"].as_str()?;
            // Same project/id key as the shared component-review store.
            let key = capture_sha256(format!("{}\0{}", project.display(), id).as_bytes());
            Some(home?.join(".impeccable/component-reviews").join(key))
        })();
        Self { session }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn approval_is_bound_to_reviewed_sources_and_the_native_capture() {
        let dir = std::env::temp_dir().join(format!("review-reference-{}", std::process::id()));
        let root = dir.join("project");
        let session = dir.join("session");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(session.join("blobs")).unwrap();
        fs::write(root.join("index.html"), b"page").unwrap();
        fs::write(root.join("comp.png"), b"comp").unwrap();
        let page = capture_sha256(b"page");
        let comp = capture_sha256(b"comp");
        let png = capture_sha256(b"png");
        fs::write(session.join("blobs").join(&png), b"png").unwrap();
        let capture = json!({"schema":"native-component-previews-v1","components":[{"views":{"preview":{"kind":"assembled-page","entry":"index.html","viewport":{"width":1536,"height":1024,"dpr":1},"screenshotSha256":png}}}]});
        let state = json!({"sources":{"index.html":page,"comp.png":comp},"files":{"preview.png":png},"capture":capture,"packet":{"stage":"hero","id":"hero","revision":"rev","comp":{"width":1536,"height":1024,"url":"/files/rev/comp.png"},"components":[{"box":{"x":0,"y":0,"w":1,"h":1},"preview":{"sourceKind":"page","url":"/files/rev/preview.png"}}]},"receipt":{"visualDecision":"approved","captureVerified":true,"capture":capture,"submission":{"requestId":"hero","packetRevision":"rev"}}});
        let save = |s: &Value| {
            fs::write(session.join("current.json"), serde_json::to_vec(s).unwrap()).unwrap()
        };
        save(&state);
        let request = EntryRequest {
            root: root.clone(),
            artifact: "index.html".into(),
            spec: "spec.json".into(),
            reference: "comp.png".into(),
            stage: impeccable_comp_verbs::entry_capture::EntryStage::Responsive,
        };
        let evidence = EntryEvidence {
            report: json!({"manifest":{"files":[{"path":"index.html","sha256":page,"served":true}]}}),
            frames: vec![],
        };
        assert_eq!(
            reference(&session, &request, &evidence).unwrap().png,
            b"png"
        );
        for (pointer, value) in [
            ("/receipt/visualDecision", json!("changes-requested")),
            ("/receipt/submission/packetRevision", json!("old")),
            ("/packet/stage", json!("components")),
            ("/packet/components/0/box/w", json!(0.5)),
            ("/packet/comp/url", json!("/files/rev/other.png")),
            (
                "/capture/components/0/views/preview/viewport/width",
                json!(1440),
            ),
        ] {
            let mut broken = state.clone();
            *broken.pointer_mut(pointer).unwrap() = value;
            save(&broken);
            assert!(
                reference(&session, &request, &evidence).is_err(),
                "{pointer}"
            );
        }
        save(&state);
        fs::write(root.join("index.html"), b"changed").unwrap();
        assert!(reference(&session, &request, &evidence).is_err());
        fs::write(root.join("index.html"), b"page").unwrap();
        let mut added = EntryEvidence {
            report: evidence.report.clone(),
            frames: vec![],
        };
        added.report["manifest"]["files"]
            .as_array_mut()
            .unwrap()
            .push(json!({"path":"late.css","sha256":"new","served":true}));
        assert!(reference(&session, &request, &added).is_err());
        fs::write(session.join("blobs").join(&png), b"replaced").unwrap();
        assert!(reference(&session, &request, &evidence).is_err());
        let _ = fs::remove_dir_all(dir);
    }
}
