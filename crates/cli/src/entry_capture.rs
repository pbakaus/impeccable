//! Native static-entry adapter. One immutable snapshot; batches share a browser per viewport.
use crate::{
    asset_capture::CdpAssetRenderer,
    capture_snapshot::{HtmlSnapshot, SnapshotSelection},
};
use impeccable_comp_verbs::entry_capture::{
    CapturedEntry, EntryEvidence, EntryRenderer, EntryRequest, EntryStage, FrameEvidence,
};
use serde_json::{Value, json};
use std::{fs, path::Path, sync::Arc};

pub struct CdpEntryRenderer;
struct FrozenEntry {
    snapshot: Arc<HtmlSnapshot>,
    evidence: EntryEvidence,
}
impl CapturedEntry for FrozenEntry {
    fn evidence(&self) -> &EntryEvidence {
        &self.evidence
    }
    fn verify_current(&self) -> Result<(), String> {
        self.snapshot.verify_current()
    }
}
impl EntryRenderer for CdpEntryRenderer {
    fn capture_entry(&self, request: &EntryRequest) -> Result<Box<dyn CapturedEntry>, String> {
        // The shared gate chooses the entry/spec/reference, never a caller URL.
        let served = static_inventory(&request.root)?;
        let snapshot = Arc::new(HtmlSnapshot::freeze(SnapshotSelection {
            root: request.root.clone(),
            entry: request.artifact.clone(),
            served,
            bound: vec![request.spec.clone(), request.reference.clone()],
        })?);
        let spec: Value =
            serde_json::from_slice(snapshot.bytes(&request.spec).ok_or("missing bound spec")?)
                .map_err(|e| e.to_string())?;
        if spec["comp"] != request.reference {
            return Err("state and spec disagree on the approved reference".into());
        }
        let ids: Vec<_> = spec["regions"]
            .as_array()
            .ok_or("missing spec regions")?
            .iter()
            .filter(|r| r["medium"] == "raster")
            .map(|r| r["id"].as_str().ok_or("raster region missing id"))
            .collect::<Result<_, _>>()?;
        if ids.is_empty() {
            return Err("native raster capture requires at least one raster region; text-only capture is not supported yet".into());
        }
        let width = spec["compSize"]["width"]
            .as_f64()
            .ok_or("missing reference width")?;
        let height = spec["compSize"]["height"]
            .as_f64()
            .ok_or("missing reference height")?;
        if width <= 0. || height <= 0. {
            return Err("invalid reference dimensions".into());
        }
        let frames: Vec<(&str, Option<[u32; 2]>)> = match request.stage {
            EntryStage::Hero => vec![("hero", None)],
            EntryStage::Responsive => vec![
                (
                    "desktop",
                    Some([1440, (height * 1440. / width).ceil() as u32]),
                ),
                (
                    "mobile",
                    Some([390, 844.max((height * 390. / width).ceil() as u32)]),
                ),
            ],
        };
        let mut evidence = EntryEvidence {
            report: json!({"schema":"native-entry-capture-v1","inputSnapshot":snapshot.digest(),"manifest":snapshot.manifest(),"artifact":request.artifact,"stage":match request.stage {EntryStage::Hero=>"hero",EntryStage::Responsive=>"responsive"},"scope":"Fresh static HTML rendering and scoped raster evidence. No independent aesthetic approval."}),
            frames: vec![],
        };
        for (name, viewport) in frames {
            // Mobile is captured as actual page evidence; the desktop comp does
            // not prescribe mobile artwork positions. Do not score its placements.
            let selected = if name == "mobile" {
                &ids[..1]
            } else {
                &ids[..]
            };
            let regions = snapshot.capture_regions_at_viewport(
                &mut CdpAssetRenderer::from_process_env(),
                &request.spec,
                selected,
                true,
                viewport,
            )?;
            if regions.iter().any(|r| {
                r.receipt["stableCapture"] != true || r.receipt["batchStabilityVerified"] != true
            }) {
                let details = regions
                    .iter()
                    .filter(|r| {
                        r.receipt["stableCapture"] != true
                            || r.receipt["batchStabilityVerified"] != true
                    })
                    .take(4)
                    .map(|r| {
                        format!(
                            "{}: {}",
                            r.receipt["regionId"].as_str().unwrap_or("region"),
                            r.receipt["individualCaptureReason"]
                                .as_str()
                                .or_else(|| r.receipt["reason"].as_str())
                                .unwrap_or("capture identity changed")
                        )
                    })
                    .collect::<Vec<_>>()
                    .join("; ");
                return Err(format!(
                    "{name} native capture did not retain a stable bound document: {details}"
                ));
            }
            let png = regions[0]
                .images
                .iter()
                .find(|i| i.name == "baseline.png")
                .ok_or("native capture has no baseline image")?
                .png
                .clone();
            evidence.frames.push(FrameEvidence {
                name: name.into(),
                png,
                regions,
            });
        }
        snapshot.verify_current()?;
        Ok(Box::new(FrozenEntry { snapshot, evidence }))
    }
}

/// Enumerate only static browser files. Never serve hidden state, source-only
/// extensions or package trees. A bound/required file omitted here is an error.
pub fn static_inventory(root: &Path) -> Result<Vec<String>, String> {
    fn walk(
        root: &Path,
        dir: &Path,
        depth: usize,
        visited: &mut usize,
        out: &mut Vec<String>,
    ) -> Result<(), String> {
        if depth > 12 {
            return Err("static input inventory exceeds directory-depth budget".into());
        }
        let mut entries = fs::read_dir(dir)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        entries.sort_by_key(|e| e.file_name());
        for entry in entries {
            *visited += 1;
            if *visited > 8192 {
                return Err("static input inventory exceeds entry budget".into());
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || name == "node_modules" {
                continue;
            }
            let kind = entry.file_type().map_err(|e| e.to_string())?;
            if kind.is_symlink() {
                return Err(format!(
                    "symlink in static input tree: {}",
                    entry.path().display()
                ));
            }
            if kind.is_dir() {
                walk(root, &entry.path(), depth + 1, visited, out)?;
            } else if kind.is_file()
                && matches!(
                    entry.path().extension().and_then(|x| x.to_str()),
                    Some(
                        "html"
                            | "htm"
                            | "css"
                            | "js"
                            | "mjs"
                            | "png"
                            | "jpg"
                            | "jpeg"
                            | "webp"
                            | "gif"
                            | "svg"
                            | "avif"
                            | "ico"
                            | "woff"
                            | "woff2"
                            | "ttf"
                            | "otf"
                    )
                )
            {
                out.push(
                    entry
                        .path()
                        .strip_prefix(root)
                        .map_err(|e| e.to_string())?
                        .to_str()
                        .ok_or("non-UTF8 static path")?
                        .replace('\\', "/"),
                );
                if out.len() > 1024 {
                    return Err("static input inventory exceeds file budget".into());
                }
            }
        }
        Ok(())
    }
    let root = fs::canonicalize(root).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    walk(&root, &root, 0, &mut 0, &mut out)?;
    Ok(out)
}
