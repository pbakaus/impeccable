//! The plan and asset review packet (schemaVersion 3) is derived from the measured
//! spec, never authored: raster regions are reviewed as their plates, code regions
//! that need a human decision are reviewed as comp crops, the rest are listed.
use super::manifest::{digest, relative, valid_box};
use serde_json::{json, Value};
use std::path::Path;

pub const SPEC: &str = ".impeccable/build/spec.json";
pub const DEFAULT_OUT: &str = ".impeccable/review/components.json";

fn raster(kind: &str) -> bool {
    matches!(kind, "plate" | "image" | "texture")
}
fn flagged(region: &Value) -> bool {
    region["flags"].as_array().is_some_and(|f| !f.is_empty()) || region["codeDrawn"] == true
}
/// A code region needs a decision when it is flagged, drawn in code, or non-container chrome.
fn plan_item(region: &Value) -> bool {
    let kind = region["kind"].as_str().unwrap_or("");
    matches!(kind, "text" | "control" | "chrome")
        && (flagged(region) || (kind == "chrome" && region["container"] != true))
}
/// Whether a spec yields any component to decide on; without one there is nothing to review.
pub fn needs_review(spec: &Value) -> bool {
    spec["regions"].as_array().is_some_and(|rs| {
        rs.iter().any(|r| raster(r["kind"].as_str().unwrap_or("")) || plan_item(r))
    })
}
fn name(id: &str) -> String {
    let words = id.replace(['-', '_'], " ");
    let mut chars = words.trim().chars();
    chars.next().map(|c| c.to_uppercase().chain(chars).collect()).unwrap_or_default()
}
/// Spec boxes are rounded to four places; keep the far edge inside the frame.
fn clamp_box(b: &Value) -> Value {
    if valid_box(b) {
        return json!({"x":b["x"],"y":b["y"],"w":b["w"],"h":b["h"]});
    }
    let n = |k: &str| b[k].as_f64().unwrap_or(f64::NAN);
    let (x, y) = (n("x").max(0.), n("y").max(0.));
    json!({"x":x,"y":y,"w":n("w").min(1. - x),"h":n("h").min(1. - y)})
}
fn png_size(bytes: &[u8]) -> Option<(u64, u64)> {
    (impeccable_comp::png_io::is_png(bytes) && bytes.len() >= 24).then(|| {
        (u64::from(u32::from_be_bytes(bytes[16..20].try_into().unwrap())),
         u64::from(u32::from_be_bytes(bytes[20..24].try_into().unwrap())))
    })
}
fn project_path(project: &Path, value: &str) -> String {
    Path::new(value).strip_prefix(project).map(|p| p.to_string_lossy().into_owned()).unwrap_or_else(|_| value.to_string())
}

/// Build the v3 manifest from the current spec, comp and plate files.
pub fn build(project: &Path) -> Result<Value, String> {
    let project = project.canonicalize().map_err(|e| e.to_string())?;
    let bytes = std::fs::read(project.join(SPEC))
        .map_err(|_| format!("no measured spec at {SPEC}; run comp-spec --comp <png> --regions <json> first"))?;
    let spec: Value = serde_json::from_slice(&bytes).map_err(|e| format!("{SPEC}: {e}"))?;
    let regions = spec["regions"].as_array().ok_or("measured spec needs regions")?;
    let state = super::store::read(&project.join(".impeccable/build/state.json")).unwrap_or(Value::Null);
    let comp = spec["comp"].as_str().or_else(|| state["comp"].as_str()).filter(|s| !s.is_empty())
        .ok_or("the spec names no comp; rerun comp-spec --comp <png> --regions <json>")?;
    let comp = project_path(&project, comp);
    relative(&comp)?;
    let (width, height) = match (spec["compSize"]["width"].as_u64(), spec["compSize"]["height"].as_u64()) {
        (Some(w), Some(h)) => (w, h),
        _ => png_size(&std::fs::read(project.join(&comp)).map_err(|e| format!("{comp}: {e}"))?)
            .ok_or("the spec records no comp size and the comp is not a PNG")?,
    };
    let mut missing = Vec::new();
    let (mut first, mut assets, mut rest, mut code) = (vec![], vec![], vec![], vec![]);
    for r in regions {
        let id = r["id"].as_str().filter(|s| !s.is_empty()).ok_or("a measured region has no id")?;
        let kind = r["kind"].as_str().unwrap_or("");
        let b = clamp_box(&r["box"]);
        if !valid_box(&b) {
            return Err(format!("region {id} has no valid normalized box; rerun comp-spec"));
        }
        let note = r["note"].as_str().unwrap_or("");
        if raster(kind) {
            let plate = r["plate"].as_str().map(|p| project_path(&project, p))
                .unwrap_or_else(|| format!("assets/plates/{id}.png"));
            if relative(&plate).is_err() || !project.join(&plate).is_file() {
                missing.push(format!("  - {id} ({kind}): {plate}"));
                continue;
            }
            assets.push(json!({"id":id,"name":name(id),"kind":kind,"role":"asset","box":b,"note":note,
                "medium":"raster","preview":{"kind":"image","path":plate},"dependencies":[]}));
        } else if plan_item(r) {
            let mut item = json!({"id":id,"name":name(id),"kind":kind,"role":"plan","box":b,"note":note,
                "medium":"code","preview":{"kind":"comp-crop"}});
            if let Some(flags) = r["flags"].as_array().filter(|f| !f.is_empty()) {
                item["flags"] = json!(flags);
            }
            item["codeDrawn"] = json!(r["codeDrawn"] == true);
            item["dependencies"] = json!([]);
            if flagged(r) { first.push(item) } else { rest.push(item) }
        } else {
            code.push(json!({"id":id,"name":name(id),"kind":kind,"box":b,"note":note}));
        }
    }
    if !missing.is_empty() {
        return Err(format!("{} raster region(s) lack their plate; the plan and asset review opens once every plate exists:\n{}\nProduce these plates (the build-phase plates step), then run component-review plan again.", missing.len(), missing.join("\n")));
    }
    let components: Vec<Value> = first.into_iter().chain(assets).chain(rest).collect();
    if components.is_empty() {
        return Err("the spec has no raster region and no code region that needs a decision; there is nothing to review, and build-phase advance does not wait for this review".into());
    }
    let title = state["artifact"].as_str().map(|a| format!("Plan and asset review · {a}"))
        .unwrap_or_else(|| "Plan and asset review".into());
    Ok(json!({"schemaVersion":3,"stage":"components","id":"components","title":title,
        "comp":{"path":comp,"width":width,"height":height},"specSha256":digest(&bytes),
        "components":components,"codeRegions":code}))
}

/// Write the packet to `out` (project-relative) and return it.
pub fn write(project: &Path, out: &str) -> Result<Value, String> {
    let rel = relative(out)?;
    let packet = build(project)?;
    let full = project.canonicalize().map_err(|e| e.to_string())?.join(rel);
    super::store::write(&full, &packet)?;
    Ok(packet)
}

/// build-phase refuses page work until the plan review for this journey is accepted
/// against the current spec. An accepted first viewport has already closed review.
/// `s` is how the caller spells the binary in the commands it prints.
pub fn gate(store: &Path, project: &Path, s: &str) -> Result<(), String> {
    let project = project.canonicalize().map_err(|e| e.to_string())?;
    if super::lifecycle::final_session(store, &project)?.is_some() {
        return Ok(());
    }
    let steps = format!("Run {s} component-review plan, then {s} component-review capture --manifest {DEFAULT_OUT} and {s} component-review serve --session <session>, and wait for the user's decision.");
    decide(&super::lifecycle::project_sessions(store, &project)?, &project, s, &steps)
}

/// A hosted review lives in the host's store and its captures use snapshots, so the
/// host names its trusted session directories (as `lifecycle --hosted --session-dir`
/// does) and the same acceptance, integrity and spec-digest rules apply to them.
pub fn gate_hosted(sessions: &[std::path::PathBuf], project: &Path, s: &str, tool: &str) -> Result<(), String> {
    let project = project.canonicalize().map_err(|e| e.to_string())?;
    for dir in sessions {
        let state = super::store::read(&dir.join("current.json")).map_err(|e| format!("hosted review session {}: {e}", dir.display()))?;
        if state["packet"]["stage"] == "hero" && super::lifecycle::accepted_in(dir, &state) {
            return Ok(());
        }
    }
    let steps = format!("Write it with {s} component-review plan, call {tool} with manifest_path=\"{DEFAULT_OUT}\", and wait for the user's decision.");
    decide(sessions, &project, s, &steps)
}

fn decide(sessions: &[std::path::PathBuf], project: &Path, s: &str, steps: &str) -> Result<(), String> {
    let bytes = std::fs::read(project.join(SPEC)).map_err(|_| format!("no measured spec at {SPEC}; run comp-spec first"))?;
    let spec: Value = serde_json::from_slice(&bytes).map_err(|e| format!("{SPEC}: {e}"))?;
    if !needs_review(&spec) {
        return Ok(());
    }
    let sha = digest(&bytes);
    let steps = format!("{steps} Write no page code before it is accepted.");
    let mut plans = Vec::new();
    for dir in sessions {
        let state = super::store::read(&dir.join("current.json"))?;
        if state["packet"]["schemaVersion"] == 3 && state["packet"]["stage"] == "components" {
            if super::lifecycle::accepted_in(dir, &state) && state["packet"]["specSha256"] == sha.as_str() {
                return Ok(());
            }
            plans.push(state);
        }
    }
    Err(match plans.iter().find(|s| super::lifecycle::accepted(s)) {
        Some(_) => format!("The plan and asset review was accepted for an earlier spec.json; the spec changed since. {steps} Unchanged decisions carry over."),
        None if plans.iter().any(|s| s["receipt"]["visualDecision"] == "changes-requested") => format!("The user requested changes in the plan and asset review. Read the receipt with {s} component-review status --session <session>, apply it (reclassify regions in the regions file and rerun comp-spec --regions; regenerate revised plates), then present a new round. {steps}"),
        None => format!("The plan and asset review is not accepted for this build. {steps}"),
    })
}
