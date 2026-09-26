use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Component, Path, PathBuf},
};

pub fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
pub fn string<'a>(v: &'a Value, key: &str) -> Result<&'a str, String> {
    v.get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| format!("missing {key}"))
}
pub fn relative(value: &str) -> Result<PathBuf, String> {
    let p = Path::new(value);
    if p.is_absolute()
        || value.contains(['\\', '?', '#', '%', ':'])
        || !p.components().all(|c| matches!(c, Component::Normal(_)))
    {
        return Err(format!("expected a plain project-relative path: {value}"));
    }
    Ok(p.to_path_buf())
}
pub fn valid_box(v: &Value) -> bool {
    let a: Option<Vec<f64>> = ["x", "y", "w", "h"]
        .iter()
        .map(|k| v.get(k).and_then(Value::as_f64))
        .collect();
    a.map(|a| {
        a.iter().all(|n| n.is_finite())
            && a[0] >= 0.
            && a[1] >= 0.
            && a[2] > 0.
            && a[3] > 0.
            && a[0] + a[2] <= 1.00001
            && a[1] + a[3] <= 1.00001
    })
    .unwrap_or(false)
}
fn pin(
    project: &Path,
    path: &str,
    files: &mut BTreeMap<String, Vec<u8>>,
) -> Result<String, String> {
    let rel = relative(path)?;
    let full = project
        .join(rel)
        .canonicalize()
        .map_err(|e| format!("{path}: {e}"))?;
    if !full.starts_with(project) || !full.is_file() {
        return Err(format!("file escapes project: {path}"));
    }
    let size = std::fs::metadata(&full).map_err(|e| e.to_string())?.len();
    if size > 32 * 1024 * 1024 {
        return Err(format!("file exceeds 32 MiB: {path}"));
    }
    let bytes = std::fs::read(full).map_err(|e| e.to_string())?;
    if files.values().map(Vec::len).sum::<usize>() + bytes.len() > 256 * 1024 * 1024 {
        return Err("review exceeds 256 MiB".into());
    }
    let hash = digest(&bytes);
    files.insert(path.into(), bytes);
    Ok(hash)
}
fn view(
    v: &mut Value,
    project: &Path,
    files: &mut BTreeMap<String, Vec<u8>>,
    used: &mut BTreeMap<String, String>,
) -> Result<(), String> {
    let p = string(v, "path")?.to_string();
    let hash = pin(project, &p, files)?;
    used.insert(p.clone(), hash);
    v.as_object_mut()
        .ok_or("preview must be an object")?
        .remove("path");
    v["url"] = json!(format!("/files/{p}"));
    Ok(())
}
/// Producer declares the dependency closure. Capturer verification is a separate gate;
/// pinning a supplied screenshot is not proof that it was captured from these sources.
pub fn freeze(project: &Path, input: &Value) -> Result<(Value, BTreeMap<String, Vec<u8>>), String> {
    let canonical = project.canonicalize().map_err(|e| e.to_string())?;
    let project = canonical.as_path();
    let v3 = input["schemaVersion"] == 3;
    if !matches!(input["schemaVersion"].as_u64(), Some(1..=3)) {
        return Err("manifest schemaVersion must be 1, 2 or 3".into());
    }
    if input["schemaVersion"] == 2 && input["stage"] == "components" {
        return Err("schemaVersion 2 component manifests are retired. Run impeccable component-review plan to write the plan and asset review (schemaVersion 3) from the measured spec.".into());
    }
    if input["schemaVersion"] == 2 && input["stage"] != "hero" {
        return Err("schemaVersion 2 requires stage hero".into());
    }
    if v3 && input["stage"] != "components" {
        return Err("schemaVersion 3 requires stage components".into());
    }
    let mut packet = input.clone();
    for key in ["capture", "captureVerified"] {
        packet
            .as_object_mut()
            .ok_or("manifest must be an object")?
            .remove(key);
    }
    string(input, "id")?;
    string(input, "title")?;
    if input["id"].as_str().unwrap().len() > 160 {
        return Err("id too long".into());
    }
    for k in ["width", "height"] {
        if !input["comp"][k]
            .as_u64()
            .is_some_and(|n| n > 0 && n <= 16384)
        {
            return Err(format!("invalid comp {k}"));
        }
    }
    let mut files = BTreeMap::new();
    let mut comp_files = BTreeMap::new();
    let mut measured_regions = Vec::new();
    // The component inventory is measured against this spec. Bind it centrally
    // rather than requiring every component author to repeat this dependency.
    if input["stage"] == "components" {
        let spec_path = ".impeccable/build/spec.json";
        comp_files.insert(spec_path.into(), pin(project, spec_path, &mut files)?);
        let spec: Value = serde_json::from_slice(&files[spec_path]).map_err(|e| e.to_string())?;
        measured_regions = spec["regions"].as_array().ok_or("measured spec needs regions")?.clone();
        // These checks are independent. Report the complete inventory repair in
        // one response before any browser work, without publishing partial proof.
        let mut errors = Vec::new();
        if v3 {
            if input["specSha256"].as_str() != Some(digest(&files[spec_path]).as_str()) {
                return Err("spec.json changed since this packet was written; run impeccable component-review plan again".into());
            }
            let listed = |key: &str| input[key].as_array().into_iter().flatten().filter_map(|c| c["id"].as_str()).map(String::from).collect::<Vec<_>>();
            let (components, code) = (listed("components"), listed("codeRegions"));
            let measured: BTreeSet<&str> = measured_regions.iter().filter_map(|r| r["id"].as_str()).collect();
            for region in &measured {
                if !components.iter().chain(&code).any(|id| id == region) {
                    errors.push(format!("plan review omitted measured region {region:?}; list it as a component or in codeRegions"));
                }
            }
            let mut seen = BTreeSet::new();
            for id in components.iter().chain(&code) {
                if !measured.contains(id.as_str()) {
                    errors.push(format!("plan review lists {id:?}, which is not a measured region"));
                } else if !seen.insert(id) {
                    errors.push(format!("plan review lists {id:?} twice"));
                }
            }
        } else {
            for region in &measured_regions {
                match input["components"].as_array().and_then(|items| items.iter().find(|c| c["id"] == region["id"])) {
                    None => errors.push(format!("component review omitted measured region {}", region["id"])),
                    Some(component) if matches!(region["kind"].as_str(), Some("text" | "control")) && component["preview"]["kind"] != "page" => {
                        errors.push(format!("semantic region {} requires a rendered code preview", region["id"]));
                    }
                    _ => {}
                }
            }
        }
        if !errors.is_empty() {
            return Err(errors.join("\n"));
        }
    }

    view(&mut packet["comp"], project, &mut files, &mut comp_files)?;
    let mut groups: BTreeMap<String, String> = BTreeMap::new();
    for c in input["components"].as_array().ok_or("components must be an array")? {
        if let Some(group) = c.get("reviewGroup") {
            if v3 {
                return Err("reviewGroup is not used in the plan and asset review (schemaVersion 3)".into());
            }
            let name = group.as_str().filter(|s| !s.trim().is_empty() && s.len() <= 120)
                .ok_or("reviewGroup needs a nonempty name of at most 120 bytes")?;
            if input["stage"] != "components" || c["preview"]["kind"] != "page" {
                return Err("review groups are for repeated code components; raster assets remain individual".into());
            }
            let path = string(&c["preview"], "path")?;
            if groups.insert(name.into(), path.into()).is_some_and(|previous| previous != path) {
                return Err("a review group must share one code document".into());
            }
        }
    }
    // Validate the actual review request against measured region roles, including
    // groups introduced or renamed after map authoring. Do not infer roles from labels.
    for region in &mut measured_regions {
        region.as_object_mut().ok_or("measured region must be an object")?.remove("reviewGroup");
        if let Some(group) = input["components"].as_array().and_then(|cs| cs.iter().find(|c| c["id"] == region["id"]))
            .and_then(|c| c.get("reviewGroup")) { region["reviewGroup"] = group.clone(); }
    }
    let group_issues = if v3 { vec![] } else { impeccable_comp::review_groups::issues(&measured_regions) };
    if !group_issues.is_empty() {
        return Err(group_issues.iter().map(|(id, message)| format!("component {id}: {message}")).collect::<Vec<_>>().join("\n"));
    }
    if v3 {
        let code = packet["codeRegions"].as_array_mut().ok_or("codeRegions must be an array")?;
        if code.len() > 400 {
            return Err("codeRegions exceeds 400 entries".into());
        }
        for r in code {
            let id = string(r, "id")?.to_string();
            if !valid_box(&r["box"]) || !r["name"].is_string() || !r["note"].is_string() || !r["kind"].is_string() {
                return Err(format!("code region {id:?} needs name, kind, note and a normalized box"));
            }
        }
    } else if packet.get("codeRegions").is_some() || packet.get("specSha256").is_some() {
        return Err("codeRegions and specSha256 belong to schemaVersion 3".into());
    }
    let mut ids = BTreeSet::new();
    let components = packet["components"]
        .as_array_mut()
        .ok_or("components must be an array")?;
    if components.is_empty() || components.len() > 200 {
        return Err("supply 1–200 components".into());
    }
    for c in components {
        for key in ["capture", "captureVerified"] {
            c.as_object_mut()
                .ok_or("component must be an object")?
                .remove(key);
        }
        for key in ["preview", "context", "thumbnail"] {
            if let Some(view) = c.get_mut(key).and_then(Value::as_object_mut) {
                view.remove("sourceKind");
                view.remove("capture");
                view.remove("isolation");
            }
        }
        let id = string(c, "id")?.to_string();
        if !ids.insert(id.clone()) {
            return Err(format!("duplicate component id {id:?}; each component needs a unique id"));
        }
        if !valid_box(&c["box"]) {
            return Err(format!("component {id:?} has invalid box {}. Expected normalized {{x,y,w,h}}: x/y >= 0, w/h > 0, x+w and y+h <= 1 (tolerance 0.00001).", c["box"]));
        }
        for k in ["name", "medium", "note"] {
            if !c[k].is_string() {
                return Err(format!("component needs {k}"));
            }
        }
        if v3 {
            let (role, kind) = (c["role"].as_str().unwrap_or(""), c["kind"].as_str().unwrap_or(""));
            let ok = match role {
                "asset" => matches!(kind, "plate" | "image" | "texture") && c["preview"]["kind"] == "image",
                "plan" => matches!(kind, "text" | "control" | "chrome") && c["preview"] == json!({"kind":"comp-crop"}),
                _ => false,
            };
            if !ok || c.get("context").is_some() || c.get("thumbnail").is_some() {
                return Err(format!("component {id:?}: an asset is a plate, image or texture previewed by its image; a plan item is text, control or chrome previewed as {{\"kind\":\"comp-crop\"}}; neither carries context or thumbnail"));
            }
        } else if !matches!(c["preview"]["kind"].as_str(), Some("image" | "page")) {
            return Err("preview kind must be image or page".into());
        }
        let deps = c["dependencies"]
            .as_array()
            .ok_or("each component must declare its dependencies array")?
            .clone();
        let mut used = comp_files.clone();
        for dep in deps {
            let p = dep.as_str().ok_or("dependency must be a path")?;
            used.insert(p.into(), pin(project, p, &mut files)?);
        }
        if c["preview"]["kind"] == "comp-crop" {
            // The UI crops the pinned comp; comp and spec hashes are already in `used`.
            c.as_object_mut().unwrap().remove("material");
            c.as_object_mut().unwrap().remove("revision");
            c["revision"] = json!(digest(&serde_json::to_vec(&json!({"component":c,"files":used,"specSha256":input["specSha256"]})).unwrap()));
            continue;
        }
        let preview_path = string(&c["preview"], "path")?.to_string();
        view(&mut c["preview"], project, &mut files, &mut used)?;
        c.as_object_mut().unwrap().remove("material");
        if c["preview"]["kind"] == "image" {
            let bytes = &files[&preview_path];
            if impeccable_comp::png_io::is_png(bytes) {
                if bytes.len() < 24 {
                    return Err("truncated PNG".into());
                }
                let width = u32::from_be_bytes(bytes[16..20].try_into().unwrap());
                let height = u32::from_be_bytes(bytes[20..24].try_into().unwrap());
                if u64::from(width) * u64::from(height) > 32_000_000 {
                    return Err("PNG exceeds 32 megapixels".into());
                }
                let image = impeccable_comp::png_io::decode_png(bytes)?.image;
                let transparent = image.data.chunks_exact(4).any(|p| p[3] < 255);
                c["material"] = json!({"format":"PNG","width":image.width,"height":image.height,"alpha":if transparent{"transparent"}else{"opaque"}});
            }
        }
        for k in ["context", "thumbnail"] {
            if c.get(k).is_some() {
                if let Some(b) = c[k].get("box") {
                    if !valid_box(b) {
                        return Err("invalid thumbnail box".into());
                    }
                }
                view(&mut c[k], project, &mut files, &mut used)?;
            }
        }
        c.as_object_mut().unwrap().remove("revision");
        let mut identity = json!({"component":c,"files":used});
        if v3 { identity["specSha256"] = input["specSha256"].clone(); }
        c["revision"] = json!(digest(&serde_json::to_vec(&identity).unwrap()));
    }
    let total: usize = files.values().map(Vec::len).sum();
    if total > 256 * 1024 * 1024 {
        return Err("review exceeds 256 MiB".into());
    }
    packet.as_object_mut().unwrap().remove("revision");
    packet.as_object_mut().unwrap().remove("round");
    let revision = digest(&serde_json::to_vec(&packet).unwrap());
    packet["revision"] = json!(revision);
    Ok((packet, files))
}
