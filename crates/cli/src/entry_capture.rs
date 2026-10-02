//! Native static-entry adapter. One immutable snapshot; batches share a browser per viewport.
use crate::{
    asset_capture::CdpAssetRenderer,
    capture_snapshot::{HtmlSnapshot, SnapshotSelection},
    component_capture::render_page,
};
use impeccable_browser::{cdp::Browser, discovery, html_snapshot::HtmlSnapshot as PageSnapshot};
use impeccable_comp_verbs::asset_capture::capture_sha256;
use impeccable_comp_verbs::entry_capture::{
    CapturedEntry, EntryEvidence, EntryRenderer, EntryRequest, EntryStage, FrameEvidence,
};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    sync::Arc,
};

pub struct CdpEntryRenderer;
/// Largest share of a frame that images may cover when the spec declares no
/// raster region. Logos, avatars and icons sit well under it (a 200x60 logo is
/// about 1% of a 1440x900 viewport; a row of twelve 40px avatars under 2%); a
/// chart, photo or copied comp that carries real weight in the comparison sits
/// well over it.
pub const TEXT_ONLY_RASTER_SHARE_MAX: f64 = 0.15;
/// The frozen inputs a capture was drawn from. A text-only capture also binds
/// the hero review manifest whose dependency list chose what the page may load.
struct FrozenEntry {
    snapshot: Arc<HtmlSnapshot>,
    manifest: Option<(PathBuf, Vec<u8>)>,
    evidence: EntryEvidence,
}
impl CapturedEntry for FrozenEntry {
    fn evidence(&self) -> &EntryEvidence {
        &self.evidence
    }
    fn verify_current(&self) -> Result<(), String> {
        self.snapshot.verify_current()?;
        if let Some((path, bytes)) = &self.manifest {
            if fs::read(path).ok().as_ref() != Some(bytes) {
                return Err("capture input changed: .impeccable/review/hero.json".into());
            }
        }
        Ok(())
    }
}
impl EntryRenderer for CdpEntryRenderer {
    fn capture_entry(&self, request: &EntryRequest) -> Result<Box<dyn CapturedEntry>, String> {
        self.capture_forbidding(request, &[])
    }
}
/// The instant a capture's clock is pinned to, and where it came from.
#[derive(Clone, Copy)]
pub struct CaptureClock {
    pub epoch_ms: f64,
    /// True when the instant is the one an approved review screenshot was captured at.
    pub from_review: bool,
}
impl CaptureClock {
    pub fn now() -> Self {
        Self { epoch_ms: crate::component_capture::now_ms(), from_review: false }
    }
    fn json(&self) -> Value {
        json!({"pinnedEpochMs": self.epoch_ms.floor() as i64, "source": if self.from_review { "approved-review" } else { "capture-start" },
            "policy": "every frame's Date starts at the pinned instant and advances in real time"})
    }
}
impl CdpEntryRenderer {
    /// `forbidden` holds approved images (a reviewed screenshot) that a text-only
    /// page must not load or embed; the bound comp is always forbidden there.
    pub fn capture_forbidding(
        &self,
        request: &EntryRequest,
        forbidden: &[&[u8]],
    ) -> Result<Box<dyn CapturedEntry>, String> {
        self.capture_at(request, forbidden, CaptureClock::now())
    }

    /// As [`Self::capture_forbidding`], with every frame's clock pinned to `clock`:
    /// a page that renders the time or day shows the same state in each frame,
    /// and the same state as an approved screenshot captured at that instant.
    pub fn capture_at(
        &self,
        request: &EntryRequest,
        forbidden: &[&[u8]],
        clock: CaptureClock,
    ) -> Result<Box<dyn CapturedEntry>, String> {
        // The shared gate chooses the entry/spec/reference, never a caller URL.
        let served = static_inventory(&request.root)?;
        let snapshot = Arc::new(HtmlSnapshot::freeze(SnapshotSelection {
            root: request.root.clone(),
            entry: request.artifact.clone(),
            served: served.clone(),
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
        if ids.is_empty() {
            return capture_text_only(request, snapshot, &served, &frames, forbidden, clock);
        }
        let mut evidence = EntryEvidence {
            report: json!({"schema":"native-entry-capture-v1","inputSnapshot":snapshot.digest(),"manifest":snapshot.manifest(),"artifact":request.artifact,"stage":match request.stage {EntryStage::Hero=>"hero",EntryStage::Responsive=>"responsive"},"scope":"Fresh static HTML rendering and scoped raster evidence. No independent aesthetic approval.","clock":clock.json()}),
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
                &mut CdpAssetRenderer::from_process_env().pinned_at(clock.epoch_ms),
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
        Ok(Box::new(FrozenEntry {
            snapshot,
            manifest: None,
            evidence,
        }))
    }
}

/// A first viewport with no raster region has no asset to intervene on, so the
/// asset adapter has nothing to measure. Capture each frame the way the
/// assembled-page review captures the page it shows the user (same snapshot
/// transport, pinned local scripts, verified dependencies, font check and
/// double-screenshot stability), so an approved review screenshot and the gate's
/// frame come from one capture method. Frames carry no region receipts: there is
/// no rendered-presence check to run without artwork.
///
/// The page is served what the review serves: the entry plus the dependencies the
/// hero review manifest declares for it, or, before any review names this entry,
/// the static inventory. Either way the bound spec and comp are never served, and
/// a page that loads or embeds the comp (or an approved screenshot) is refused,
/// so the comparison cannot be satisfied by showing the reference itself.
fn capture_text_only(
    request: &EntryRequest,
    raster: Arc<HtmlSnapshot>,
    inventory: &[String],
    frames: &[(&str, Option<[u32; 2]>)],
    forbidden: &[&[u8]],
    clock: CaptureClock,
) -> Result<Box<dyn CapturedEntry>, String> {
    let spec: Value = serde_json::from_slice(raster.bytes(&request.spec).ok_or("missing bound spec")?)
        .map_err(|e| e.to_string())?;
    let size = |k: &str| {
        spec["compSize"][k]
            .as_u64()
            .and_then(|v| u32::try_from(v).ok())
            .filter(|v| *v > 0)
            .ok_or_else(|| format!("missing reference {k}"))
    };
    let (width, height) = (size("width")?, size("height")?);
    let comp = raster.bytes(&request.reference).ok_or("reference is not bound to snapshot")?;
    let mut forbidden: Vec<&[u8]> = forbidden.to_vec();
    forbidden.push(comp);
    let (declared, manifest) = declared_dependencies(&request.root, &request.artifact)?;
    let policy = if declared.is_some() { "hero-review-manifest" } else { "static-inventory" };
    let names: Vec<String> = match &declared {
        Some(deps) => {
            let mut names = vec![request.artifact.clone()];
            for dep in deps {
                if !inventory.contains(dep) {
                    return Err(format!("hero review dependency {dep} is not a static browser file in the project (hidden, package or source-only paths are never served)"));
                }
                names.push(dep.clone());
            }
            names
        }
        None => inventory.to_vec(),
    };
    // Reuse the bytes the first snapshot froze; nothing is read from disk twice.
    let mut files = BTreeMap::new();
    for name in names {
        if name == request.spec || name == request.reference {
            continue;
        }
        let bytes = raster.bytes(&name).ok_or_else(|| format!("{name} is not in the frozen inputs"))?;
        // Served files are checked when the page loads them (below), under either
        // policy: a file that never reaches the page cannot show the reference.
        files.insert(name, bytes.to_vec());
    }
    let page = Arc::new(PageSnapshot::from_pinned(request.artifact.clone(), files)?);
    let env = impeccable_common::process_env();
    let exe = discovery::find_browser(&env).map_err(|e| format!("browser unavailable: {e:?}"))?;
    let mut browser = Browser::launch(&exe, &[], false).map_err(|e| e.message)?;
    let result = (|| -> Result<EntryEvidence, String> {
        let browser_version = browser.version().map_err(|e| e.message)?;
        let mut evidence = EntryEvidence {
            report: json!({"schema":"native-entry-capture-v1","inputSnapshot":raster.digest(),"manifest":raster.manifest(),"artifact":request.artifact,"stage":match request.stage {EntryStage::Hero=>"hero",EntryStage::Responsive=>"responsive"},"scope":"Fresh static HTML rendering of a first viewport with no raster region. No independent aesthetic approval.","captureMethod":"assembled-page-viewport","integrityScope":"assembled-page viewport from frozen inputs; the comp and approved screenshots are never served; images cover under 15% of each frame; no raster presence check (no raster region)","dependencyPolicy":policy,"servedToPage":page.manifest()["files"],"browser":browser_version,"frameProofs":{},"clock":clock.json()}),
            frames: vec![],
        };
        for &(name, viewport) in frames {
            let [w, h] = viewport.unwrap_or([width, height]);
            let (png, proof) = render_page(
                &mut browser,
                page.clone(),
                w,
                h,
                &json!({"x":0,"y":0,"w":1,"h":1}),
                None,
                true,
                true,
                true,
                clock.epoch_ms,
            )
            .map_err(|e| {
                // Both the network check and the image-decode check name the path
                // the page asked for; the comp is never served, so either fires.
                let asked = format!("/{}", request.reference);
                if e.split(|c: char| c.is_whitespace() || c == ',').any(|t| t.trim_end_matches('.') == asked) {
                    format!("{name} text-only capture refused: the page loads the approved comp ({}). Draw the first viewport in code.", request.reference)
                } else {
                    format!("{name} text-only capture failed: {e}")
                }
            })?;
            for path in proof["observedDependencies"].as_object().into_iter().flatten().map(|(p, _)| p) {
                let bytes = page.bytes(path).ok_or("observed dependency is not in the page snapshot")?;
                if let Some(reason) = forbidden_content(path, bytes, &forbidden) {
                    return Err(format!("{name} text-only capture refused: the page loads {path}, which {reason}. Draw the first viewport in code."));
                }
            }
            // Byte checks cannot see a re-encoded copy. The spec says every raster
            // in this viewport is a raster region and it declares none, so a large
            // image contradicts the spec whatever its bytes are.
            let coverage = &proof["rasterCoverage"];
            let share = coverage["share"].as_f64().ok_or("raster coverage was not measured")?;
            if share >= TEXT_ONLY_RASTER_SHARE_MAX {
                let largest = coverage["largest"].as_array().into_iter().flatten().take(3)
                    .map(|i| format!("{} ({}% of the viewport)", i["what"].as_str().unwrap_or("image"), (i["share"].as_f64().unwrap_or(0.) * 100.).round()))
                    .collect::<Vec<_>>().join(", ");
                return Err(format!("{name} text-only capture refused: images cover {}% of the viewport (limit {}%): {largest}. The spec declares no raster region, so a large image contradicts it: declare the image as a raster region in the spec (comp-spec --regions), or remove it and draw that area in code.", (share * 100.).round(), (TEXT_ONLY_RASTER_SHARE_MAX * 100.) as u32));
            }
            evidence.report["frameProofs"][name] = proof;
            evidence.frames.push(FrameEvidence {
                name: name.into(),
                png,
                regions: vec![],
            });
        }
        Ok(evidence)
    })();
    browser.close();
    let mut evidence = result?;
    if let Some((_, bytes)) = &manifest {
        evidence.report["reviewManifestSha256"] = json!(capture_sha256(bytes));
    }
    let entry = FrozenEntry { snapshot: raster, manifest, evidence };
    entry.verify_current()?;
    Ok(Box::new(entry))
}

/// The dependency list the hero review manifest declares for this entry, when it
/// names one: the same closure the assembled-page review pins and serves.
fn declared_dependencies(
    root: &Path,
    artifact: &str,
) -> Result<(Option<Vec<String>>, Option<(PathBuf, Vec<u8>)>), String> {
    let path = root.join(".impeccable").join("review").join("hero.json");
    let Ok(bytes) = fs::read(&path) else {
        return Ok((None, None));
    };
    let Ok(manifest) = serde_json::from_slice::<Value>(&bytes) else {
        return Ok((None, None));
    };
    let pages: Vec<&Value> = manifest["components"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|c| c["preview"]["kind"] == "page" && c["preview"]["path"] == artifact)
        .collect();
    if manifest["stage"] != "hero" || pages.len() != 1 {
        return Ok((None, None));
    }
    let deps = pages[0]["dependencies"]
        .as_array()
        .ok_or("hero review manifest: the page component has no dependencies list")?
        .iter()
        .map(|d| d.as_str().map(|s| s.replace('\\', "/")).ok_or("hero review manifest: dependencies must be paths"))
        .collect::<Result<Vec<_>, _>>()?;
    Ok((Some(deps), Some((path, bytes))))
}

/// Whether a served file is, or inlines as base64, one of the forbidden images.
fn forbidden_content(name: &str, bytes: &[u8], forbidden: &[&[u8]]) -> Option<&'static str> {
    use base64::Engine;
    let text = matches!(
        Path::new(name).extension().and_then(|x| x.to_str()).map(str::to_ascii_lowercase).as_deref(),
        Some("html" | "htm" | "css" | "js" | "mjs" | "svg")
    )
    .then(|| String::from_utf8_lossy(bytes));
    // Line breaks and spaces inside a data URI do not change the image it decodes to.
    let text = text.map(|t| t.chars().filter(|c| !c.is_whitespace()).collect::<String>());
    for image in forbidden {
        if bytes == *image {
            return Some("is a copy of the approved reference");
        }
        // A data URI of the image carries its base64 from the first byte, so a
        // leading run of it identifies the embed.
        if let Some(text) = &text {
            let encoded = base64::engine::general_purpose::STANDARD.encode(image);
            let probe = &encoded[..encoded.len().min(512)];
            if probe.len() >= 64 && text.contains(probe) {
                return Some("embeds the approved reference as a data URI");
            }
        }
    }
    None
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
