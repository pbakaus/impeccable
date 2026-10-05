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
/// A code region needs a decision when it is flagged, drawn in code, or
/// non-container chrome that holds more than a bare ground or straight rules
/// (comp-spec's `surface` reading; a spec without it keeps every such chrome).
fn plan_item(region: &Value) -> bool {
    let kind = region["kind"].as_str().unwrap_or("");
    let plain = region["surface"]["flat"] == true || region["surface"]["rules"] == true;
    matches!(kind, "text" | "control" | "chrome")
        && (flagged(region) || (kind == "chrome" && region["container"] != true && !plain))
}
/// Whether a spec yields any component to decide on; without one there is nothing to review.
pub fn needs_review(spec: &Value) -> bool {
    spec["regions"].as_array().is_some_and(|rs| {
        rs.iter().any(|r| raster(r["kind"].as_str().unwrap_or("")) || plan_item(r))
    })
}
/// Whether the project's measured spec owes a plan and asset review. A missing or
/// unreadable spec owes one, so every gate keeps failing closed; only a spec that was
/// measured and holds nothing to decide releases the review, the same reading
/// `component-review plan` reports when it refuses to write an empty packet.
pub fn spec_needs_review(project: &Path) -> bool {
    spec_file_needs_review(&project.join(SPEC))
}
/// `spec_needs_review` for a spec at an explicit path. A spec without a `regions`
/// array is not a measured spec (`plan` refuses it), so it owes the review too.
pub fn spec_file_needs_review(path: &Path) -> bool {
    std::fs::read(path).ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .filter(|spec| spec["regions"].is_array())
        .is_none_or(|spec| needs_review(&spec))
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
/// A spec path as a project-relative, `/`-separated path. Comp-spec may record an
/// absolute path (inside the project) or a Windows one; the project is matched as
/// the caller spelled it and canonicalized (`\\?\` on Windows, `/private/tmp` on macOS).
fn project_path(roots: &[&Path], value: &str) -> String {
    fn slashes(p: &str) -> String {
        let p = p.replace('\\', "/");
        p.strip_prefix("//?/").map(String::from).unwrap_or(p)
    }
    let v = slashes(value);
    let within = |root: &Path, v: &str| {
        let root = slashes(&root.to_string_lossy());
        let root = root.trim_end_matches('/');
        (!root.is_empty()).then(|| v.strip_prefix(root)).flatten()
            .and_then(|rest| rest.strip_prefix('/')).map(String::from)
    };
    if let Some(rest) = roots.iter().find_map(|root| within(root, &v)) {
        return rest;
    }
    // An absolute path reached through a symlinked prefix of the project.
    if Path::new(value).is_absolute() {
        if let Ok(full) = Path::new(value).canonicalize() {
            let full = slashes(&full.to_string_lossy());
            if let Some(rest) = roots.iter().filter_map(|r| r.canonicalize().ok()).find_map(|root| within(&root, &full)) {
                return rest;
            }
        }
    }
    v
}

/// Build the v3 manifest from the current spec, comp and plate files.
pub fn build(cwd: &Path) -> Result<Value, String> {
    let project = cwd.canonicalize().map_err(|e| e.to_string())?;
    let roots = [cwd, project.as_path()];
    let bytes = std::fs::read(project.join(SPEC))
        .map_err(|_| format!("no measured spec at {SPEC}; run comp-spec --comp <png> --regions <json> first"))?;
    let spec: Value = serde_json::from_slice(&bytes).map_err(|e| format!("{SPEC}: {e}"))?;
    let regions = spec["regions"].as_array().ok_or("measured spec needs regions")?;
    let state = super::store::read(&project.join(".impeccable/build/state.json")).unwrap_or(Value::Null);
    let comp = spec["comp"].as_str().or_else(|| state["comp"].as_str()).filter(|s| !s.is_empty())
        .ok_or("the spec names no comp; rerun comp-spec --comp <png> --regions <json>")?;
    let comp = project_path(&roots, comp);
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
            let plate = r["plate"].as_str().map(|p| project_path(&roots, p))
                .unwrap_or_else(|| format!("assets/plates/{id}.png"));
            if relative(&plate).is_err() || !project.join(&plate).is_file() {
                missing.push(format!("  - {id} ({kind}): {plate}"));
                continue;
            }
            let mut item = json!({"id":id,"name":name(id),"kind":kind,"role":"asset","box":b,"note":note,
                "medium":"raster","preview":{"kind":"image","path":plate}});
            // A flagged asset (a frame baked around its view) is a decision too: it sorts first.
            let flags = r["flags"].as_array().filter(|f| !f.is_empty());
            if let Some(flags) = flags { item["flags"] = json!(flags); }
            item["dependencies"] = json!([]);
            if flags.is_some() { first.push(item) } else { assets.push(item) }
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

/// Whether the user accepted an assembled first viewport for this build journey,
/// locally (`store`) or in the host's named `sessions`. Once one is accepted, the
/// review store hands back that session, so no new first-viewport review can open.
pub fn first_viewport_accepted(store: Option<&Path>, sessions: &[std::path::PathBuf], project: &Path) -> bool {
    let Ok(project) = project.canonicalize() else { return false };
    if let Some(store) = store {
        if matches!(super::lifecycle::final_session(store, &project), Ok(Some(_))) { return true; }
    }
    sessions.iter().any(|dir| super::store::read(&dir.join("current.json"))
        .is_ok_and(|state| state["packet"]["stage"] == "hero" && super::lifecycle::accepted_in(dir, &state)))
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
    let mut stale = None;
    let mut unreadable = None;
    for dir in sessions {
        let state = super::store::read(&dir.join("current.json"))?;
        if state["packet"]["schemaVersion"] == 3 && state["packet"]["stage"] == "components" {
            if super::lifecycle::accepted_in(dir, &state) && state["packet"]["specSha256"] == sha.as_str() {
                // The user judged these plate bytes; a plate replaced since is unreviewed.
                match super::store::sources_current_in(&state, project) {
                    Ok(()) => return Ok(()),
                    Err(why) if why.starts_with("review is stale") => stale = Some(why),
                    // Not a changed plate; keep looking, a later session may still satisfy the gate.
                    Err(why) => unreadable = Some(why),
                }
            }
            plans.push(state);
        }
    }
    if let Some(why) = unreadable {
        // Asking the user to approve the same bytes again cannot help.
        return Err(format!("The accepted plan and asset review could not be checked against this project ({why}). This is a harness or filesystem problem, not a changed plate: stop and report it; do not request the same review again."));
    }
    if let Some(why) = stale {
        let why = why.strip_prefix("review is stale: ").unwrap_or(&why).trim_end_matches("; prepare a new round");
        return Err(format!("A reviewed plate changed after the user accepted the plan and asset review ({why}). Present a new round; unchanged decisions carry over. {steps}"));
    }
    Err(match plans.iter().find(|s| super::lifecycle::accepted(s)) {
        Some(_) => format!("The plan and asset review was accepted for an earlier spec.json; the spec changed since. {steps} Unchanged decisions carry over."),
        None if plans.iter().any(|s| s["receipt"]["visualDecision"] == "changes-requested") => format!("The user requested changes in the plan and asset review. Read the receipt with {s} component-review status --session <session>, apply it (reclassify regions in the regions file and rerun {s} comp-spec --comp <comp.png> --regions <regions.json>; regenerate revised plates), then present a new round. {steps}"),
        None => format!("The plan and asset review is not accepted for this build. {steps}"),
    })
}

#[cfg(test)]
mod tests {
    use super::project_path;
    use std::path::Path;

    #[test]
    fn spec_paths_become_project_relative_with_forward_slashes() {
        let raw = Path::new("/tmp/site");
        let canonical = Path::new("/private/tmp/site");
        let roots = [raw, canonical];
        assert_eq!(project_path(&roots, "comp.png"), "comp.png");
        assert_eq!(project_path(&roots, r"assets\plates\art.png"), "assets/plates/art.png");
        assert_eq!(project_path(&roots, "/tmp/site/comp.png"), "comp.png");
        assert_eq!(project_path(&roots, "/private/tmp/site/assets/art.png"), "assets/art.png");
        // A sibling that shares the prefix is not inside the project.
        assert_eq!(project_path(&roots, "/tmp/site-2/comp.png"), "/tmp/site-2/comp.png");
        let windows = [Path::new(r"C:\work\site"), Path::new(r"\\?\C:\work\site")];
        assert_eq!(project_path(&windows, r"C:\work\site\assets\art.png"), "assets/art.png");
        assert_eq!(project_path(&windows, r"\\?\C:\work\site\comp.png"), "comp.png");
    }
}
