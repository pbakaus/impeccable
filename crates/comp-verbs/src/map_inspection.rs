//! Read-only diagnostics for region authoring, before asset production.
use crate::{
    comp_spec::{self, is_kind, is_raster_kind},
    util::{arg, flag},
};
use impeccable_common::Io;
use impeccable_comp::{
    png_io,
    raster::{self as r, Image},
};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    path::Path,
};

fn issue(issues: &mut Vec<Value>, severity: &str, code: &str, id: Option<&str>, message: String) {
    issues.push(json!({"severity":severity,"code":code,"regionId":id,"message":message}));
}

// Inspection must not silently clamp malformed boxes or fall back to a band.
fn geometry_error(raw: &Value, comp: &Image) -> Option<String> {
    let formats = ["box", "pixelBox", "grid"]
        .iter()
        .filter(|k| raw.get(**k).is_some())
        .count();
    if formats != 1 {
        return Some("Use exactly one of box, pixelBox, or grid.".into());
    }
    for (key, width, height) in [
        ("box", 1., 1.),
        ("pixelBox", comp.width as f64, comp.height as f64),
    ] {
        if let Some(b) = raw.get(key) {
            let values: Option<Vec<f64>> = ["x", "y", "w", "h"]
                .iter()
                .map(|k| b[*k].as_f64())
                .collect();
            let Some(v) = values else {
                return Some(format!("{key} requires numeric x, y, w, h."));
            };
            if v.iter()
                .any(|n| !n.is_finite() || (key == "pixelBox" && n.fract() != 0.))
                || v[0] < 0.
                || v[1] < 0.
                || v[2] <= 0.
                || v[3] <= 0.
                || v[0] + v[2] > width + 1e-9
                || v[1] + v[3] > height + 1e-9
            {
                return Some(format!(
                    "{key} must fit within {width} × {height}, with positive size{}.",
                    if key == "pixelBox" {
                        " and whole pixels"
                    } else {
                        ""
                    }
                ));
            }
            if (v[2] / width * comp.width as f64).round() < 1.
                || (v[3] / height * comp.height as f64).round() < 1.
            {
                return Some("Region rounds to less than one original comp pixel.".into());
            }
        }
    }
    None
}

fn inspect(comp: &Image, input: &Value, comp_path: &str) -> Value {
    let mut issues = Vec::new();
    let mut valid = Vec::new();
    let mut measured = Vec::new();
    let empty = Vec::new();
    let raw_regions = input["regions"].as_array().unwrap_or(&empty);
    let mut counts = HashMap::new();
    for raw in raw_regions {
        if let Some(id) = raw["id"].as_str() {
            *counts.entry(id).or_insert(0) += 1;
        }
    }
    if raw_regions.is_empty() {
        issue(
            &mut issues,
            "error",
            "empty-map",
            None,
            "Provide a nonempty regions array.".into(),
        );
    }
    if input["draft"] == true {
        issue(
            &mut issues,
            "warning",
            "draft",
            None,
            "This is an unmeasured draft. Bands do not identify individual elements.".into(),
        );
    }
    for (index, raw) in raw_regions.iter().enumerate() {
        let id = raw["id"].as_str();
        let mut invalid = false;
        if id.is_none_or(|s| s.trim().is_empty()) {
            issue(
                &mut issues,
                "error",
                "missing-id",
                None,
                format!("Region {} needs an id.", index + 1),
            );
            invalid = true;
        }
        if id.is_some_and(|s| counts.get(s).copied().unwrap_or(0) > 1) {
            issue(
                &mut issues,
                "error",
                "duplicate-id",
                id,
                "Duplicate id; every instance needs its own identity.".into(),
            );
            invalid = true;
        }
        if !raw["kind"].as_str().is_some_and(is_kind) {
            issue(
                &mut issues,
                "error",
                "invalid-kind",
                id,
                "Specify plate, image, texture, text, control, chrome, or band.".into(),
            );
            invalid = true;
        }
        if let Some(message) = geometry_error(raw, comp) {
            issue(&mut issues, "error", "invalid-geometry", id, message);
            invalid = true;
        }
        if invalid {
            continue;
        }
        match comp_spec::measure_regions(
            comp,
            &json!({"regions":[raw],"allowUncovered":true}),
            comp_path,
        ) {
            Err(message) => issue(&mut issues, "error", "measurement", id, message),
            Ok(spec) => {
                let mut region = spec["regions"][0].clone();
                region["number"] = json!(index + 1);
                for key in ["parentId", "reviewGroup"] {
                    if let Some(value) = raw.get(key) {
                        region[key] = value.clone();
                    }
                }
                measured.push(region);
                valid.push(raw.clone());
            }
        }
    }
    let mut spec = comp_spec::measure_regions(
        comp,
        &json!({"regions":valid,"allowUncovered":true}),
        comp_path,
    )
    .expect("individually validated regions");
    spec["regions"] = json!(measured);
    let group_issues = impeccable_comp::review_groups::issues(&measured);
    let invalid_groups: HashSet<String> = group_issues.iter().filter_map(|(id, _)| {
        measured.iter().find(|r| r["id"] == *id).and_then(|r| r["reviewGroup"].as_str()).map(String::from)
    }).collect();
    for (id, message) in group_issues {
        let code = if measured.iter().any(|r| r["id"] == id && r["kind"].as_str().is_some_and(is_raster_kind)) { "raster-group" } else { "invalid-group" };
        issue(&mut issues, "error", code, Some(&id), message);
    }
    let mut groups: serde_json::Map<String, Value> = serde_json::Map::new();
    for region in &mut measured {
        let id = region["id"].as_str().unwrap().to_string();
        if let Some(parent) = region.get("parentId") {
            let p = parent.as_str().and_then(|p| {
                spec["regions"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|r| r["id"] == p)
            });
            match p {
                None => issue(
                    &mut issues,
                    "error",
                    "invalid-parent",
                    Some(&id),
                    "parentId must name an existing container.".into(),
                ),
                Some(p) if p["container"] != true || p["id"] == id || !contains(p, region) => {
                    issue(
                        &mut issues,
                        "error",
                        "invalid-parent",
                        Some(&id),
                        "Parent must be a distinct container enclosing this region.".into(),
                    )
                }
                _ => {}
            }
        }
        if let Some(group) = region.get("reviewGroup") {
            if let Some(name) = group.as_str().filter(|n| !n.trim().is_empty() && !invalid_groups.contains(*n)) {
                groups
                    .entry(name)
                    .or_insert(json!([]))
                    .as_array_mut()
                    .unwrap()
                    .push(json!(id));
            }
        }
        if is_raster_kind(region["kind"].as_str().unwrap()) {
            let reference = comp_spec::prepare_plate_reference(comp, &spec, region);
            if let Some(message) = reference.issue(&id) {
                issue(&mut issues, "error", "fully-masked", Some(&id), message);
            } else if reference.excluded_pixels > 0 {
                let sources = reference.excluded_regions.iter().filter_map(|r| r["id"].as_str()).collect::<Vec<_>>().join(", ");
                issue(&mut issues,"warning","foreground-mask",Some(&id),format!("{sources} exclude {:.1}% of this reference. Check that the excluded pixels contain foreground, not artwork between separate text elements. Split overly broad foreground bounds; review grouping must not change geometry.",100.*reference.excluded_pixels as f64/reference.total_pixels as f64));
            }
            region["reference"] = reference.audit();
        }
    }
    // Parent cycles can exist even when equal-sized boxes enclose one another.
    for region in &measured {
        let mut seen = HashSet::new();
        let mut current = Some(region);
        while let Some(r) = current {
            if !seen.insert(r["id"].as_str().unwrap()) {
                issue(
                    &mut issues,
                    "error",
                    "parent-cycle",
                    region["id"].as_str(),
                    "Container relationships contain a cycle.".into(),
                );
                break;
            }
            current = r["parentId"]
                .as_str()
                .and_then(|id| measured.iter().find(|p| p["id"] == id));
        }
    }
    let mut overlaps = Vec::new();
    for (i, a) in measured.iter().enumerate() {
        for b in &measured[i + 1..] {
            let area = intersection(a, b);
            if area > 0. {
                overlaps.push(json!({"a":a["id"],"b":b["id"],"pixels":area,
                    "relationship": if a["container"]==true || b["container"]==true {"container extent"} else {"overlapping elements"}}));
            }
        }
    }
    for warning in spec["warnings"].as_array().unwrap() {
        issue(
            &mut issues,
            "warning",
            "measurement-warning",
            None,
            warning.as_str().unwrap_or_default().into(),
        );
    }
    let uncovered = &spec["uncoveredInkCells"];
    if !uncovered.as_array().unwrap().is_empty() {
        issue(&mut issues,"warning","uncovered-ink",None,format!("{} grid cells have detail outside named regions. This is a coverage heuristic, not proof of missing components.",uncovered.as_array().unwrap().len()));
    }
    json!({"tool":"comp-spec inspect-map","version":1,"referenceOnly":true,"stateChanged":false,
        "comp":comp_path,"compSize":{"width":comp.width,"height":comp.height},"inputRegionCount":raw_regions.len(),
        "regions":measured,"issues":issues,"overlaps":overlaps,"reviewGroups":groups,"uncoveredInkCells":uncovered})
}

fn coord(region: &Value, key: &str) -> f64 {
    region["px"][key].as_f64().unwrap_or(0.)
}
fn intersection(a: &Value, b: &Value) -> f64 {
    ((coord(a, "x") + coord(a, "w")).min(coord(b, "x") + coord(b, "w"))
        - coord(a, "x").max(coord(b, "x")))
    .max(0.)
        * ((coord(a, "y") + coord(a, "h")).min(coord(b, "y") + coord(b, "h"))
            - coord(a, "y").max(coord(b, "y")))
        .max(0.)
}
fn contains(a: &Value, b: &Value) -> bool {
    intersection(a, b) >= coord(b, "w") * coord(b, "h")
}

fn save_reference(path: &Path, image: &Image, source: &str) -> Result<(), String> {
    let bytes = png_io::encode_png(image, &[("impeccable:crop-of".into(), source.into())])?;
    std::fs::write(path, bytes).map_err(|e| e.to_string())
}

fn write_report(dir: &Path, comp: &Image, report: &mut Value) -> Result<(), String> {
    // An inspection owns a new directory. Never overwrite an input, spec, or receipt.
    if let Some(parent) = dir.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::create_dir(dir).map_err(|e| format!("choose a new output directory: {e}"))?;
    let source = report["comp"].as_str().unwrap().to_string();
    save_reference(&dir.join("comp.png"), comp, &source)?;
    let spec = report.clone();
    let mut overlay = comp.clone();
    for region in report["regions"].as_array_mut().unwrap() {
        let n = region["number"].as_u64().unwrap();
        let crop = r::crop(
            comp,
            coord(region, "x"),
            coord(region, "y"),
            coord(region, "w"),
            coord(region, "h"),
        );
        let raw = format!("region-{n}.png");
        save_reference(&dir.join(&raw), &crop, &source)?;
        region["cropPath"] = json!(raw);
        if is_raster_kind(region["kind"].as_str().unwrap()) {
            let reference = comp_spec::prepare_plate_reference(comp, &spec, region);
            let file = format!("reference-{n}.png");
            save_reference(&dir.join(&file), &reference.image, &source)?;
            region["referencePath"] = json!(file);
        }
        let color = if region.pointer("/reference/fullyExcluded") == Some(&json!(true)) {
            [166., 54., 29., 255.]
        } else {
            [0., 104., 97., 255.]
        };
        r::stroke_rect(
            &mut overlay,
            coord(region, "x"),
            coord(region, "y"),
            coord(region, "w"),
            coord(region, "h"),
            color,
            2.,
        );
        r::draw_label(
            &mut overlay,
            &n.to_string(),
            coord(region, "x"),
            coord(region, "y"),
            [255., 255., 255., 255.],
            color,
            2.,
            3.,
        );
    }
    save_reference(&dir.join("overlay.png"), &overlay, &source)?;
    let data = serde_json::to_string_pretty(report).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("report.json"), &data).map_err(|e| e.to_string())?;
    // JSON in a script element is data; escape HTML delimiters to prevent closing it.
    let safe = data
        .replace('&', "\\u0026")
        .replace('<', "\\u003c")
        .replace('>', "\\u003e");
    std::fs::write(
        dir.join("index.html"),
        include_str!("map_inspection.html").replace("__REPORT_JSON__", &safe),
    )
    .map_err(|e| e.to_string())
}

pub fn run(argv: &[String], io: &mut Io, comp: &Image, comp_path: &str) -> i32 {
    let Some(regions_path) = arg(argv, "regions") else {
        io.err("inspect-map requires --regions <json>\n");
        return 1;
    };
    let result = (|| -> Result<Value, String> {
        let bytes = std::fs::read(io.cwd.join(regions_path)).map_err(|e| e.to_string())?;
        let input: Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
        let mut report = inspect(comp, &input, comp_path);
        let default = format!(
            ".impeccable/build/map-inspections/{}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos(),
            std::process::id()
        );
        let output = arg(argv, "out-dir").unwrap_or(&default);
        write_report(&io.cwd.join(output), comp, &mut report)?;
        report["outputDir"] = json!(output);
        Ok(report)
    })();
    match result {
        Err(e) => {
            io.err(&format!("inspect-map: {e}\n"));
            1
        }
        Ok(report) => {
            let errors = report["issues"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|i| i["severity"] == "error")
                .count();
            if flag(argv, "json") {
                io.out(&format!("{report}\n"));
            } else {
                let partial_masks = report["issues"].as_array().unwrap().iter().filter(|i| i["code"] == "foreground-mask").count();
                io.out(&format!("MAP {}/index.html\nOVERLAY {}/overlay.png\n{} regions, {errors} errors, {partial_masks} partial masks to inspect. Zero errors does not certify crop accuracy. Reference only; no build state or approvals changed.\n",report["outputDir"].as_str().unwrap(),report["outputDir"].as_str().unwrap(),report["inputRegionCount"]));
                for i in report["issues"].as_array().unwrap() {
                    io.out(&format!(
                        "{} {}: {}\n",
                        i["severity"].as_str().unwrap(),
                        i["regionId"].as_str().unwrap_or("map"),
                        i["message"].as_str().unwrap()
                    ));
                }
            }
            if errors > 0 {
                2
            } else {
                0
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use impeccable_comp::raster::create_image;

    #[test]
    fn partial_masks_need_attention_even_without_geometry_errors() {
        let image = create_image(100, 100, [240, 240, 240, 255]);
        let input = json!({"regions":[
            {"id":"art", "kind":"image", "note":"Decorative artwork", "pixelBox":{"x":50,"y":50,"w":20,"h":20}},
            {"id":"details", "kind":"text", "note":"Separate text elements", "pixelBox":{"x":30,"y":30,"w":30,"h":30}}
        ]});
        let report = inspect(&image, &input, "comp.png");
        let findings = report["issues"].as_array().unwrap();
        assert!(!findings.iter().any(|i| i["severity"] == "error"));
        let mask = findings.iter().find(|i| i["code"] == "foreground-mask").unwrap();
        assert_eq!(mask["severity"], "warning");
        assert!(mask["message"].as_str().unwrap().contains("details"));
        assert_eq!(report["regions"][0]["reference"]["excludedPixels"], 100);
    }

    #[test]
    fn granular_text_bounds_preserve_art_in_gaps_without_dropping_foreground() {
        let image = create_image(100, 100, [240, 240, 240, 255]);
        let input = json!({"regions":[
            {"id":"art", "kind":"image", "note":"Decorative artwork", "pixelBox":{"x":50,"y":50,"w":20,"h":20}},
            {"id":"details", "kind":"chrome", "container":true, "note":"Text layout extent", "pixelBox":{"x":30,"y":30,"w":30,"h":30}},
            {"id":"title", "kind":"text", "parentId":"details", "reviewGroup":"titles", "note":"First title text", "pixelBox":{"x":30,"y":30,"w":30,"h":8}},
            {"id":"title-2", "kind":"text", "reviewGroup":"titles", "note":"Second title text", "pixelBox":{"x":5,"y":30,"w":30,"h":8}},
            {"id":"caption", "kind":"text", "parentId":"details", "note":"Caption overlapping art", "pixelBox":{"x":30,"y":50,"w":22,"h":5}}
        ]});
        let report = inspect(&image, &input, "comp.png");
        let reference = &report["regions"][0]["reference"];
        assert_eq!(reference["excludedPixels"], 10, "only the actual caption overlap is masked");
        assert_eq!(reference["regions"][0]["id"], "caption");
        assert_eq!(reference["ignoredContainers"], json!(["details"]));
        assert_eq!(report["reviewGroups"]["titles"], json!(["title", "title-2"]));
        assert_eq!(report["regions"].as_array().unwrap().len(), 5);
    }

    #[test]
    fn mixed_review_groups_are_reported_without_discarding_geometry() {
        let comp = Image { width: 100, height: 100, data: vec![255; 100*100*4] };
        let input = json!({"regions":[
            {"id":"frame","kind":"chrome","container":true,"reviewGroup":"cards","pixelBox":{"x":0,"y":0,"w":20,"h":20},"note":"Card border"},
            {"id":"label","kind":"text","reviewGroup":"cards","pixelBox":{"x":2,"y":2,"w":10,"h":5},"note":"Card label"}
        ]});
        let report = inspect(&comp, &input, "comp.png");
        assert_eq!(report["regions"].as_array().unwrap().len(),2);
        assert!(report["issues"].as_array().unwrap().iter().any(|i| i["code"]=="invalid-group"));
        assert!(report["reviewGroups"].get("cards").is_none());
        let measured = comp_spec::measure_regions(&comp, &input, "comp.png").unwrap();
        assert_eq!(measured["regions"][1]["reviewGroup"], "cards");
    }

    #[test]
    fn map_inspection_writes_only_new_reference_artifacts_and_escapes_labels() {
        let root = std::env::temp_dir().join(format!(
            "impeccable-map-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&root).unwrap();
        let image = create_image(100, 100, [240, 240, 240, 255]);
        let input = json!({"regions":[{"id":"</script><script>alert(1)</script>","kind":"image","note":"room photograph","pixelBox":{"x":10,"y":10,"w":20,"h":20}}]});
        std::fs::write(root.join("regions.json"), input.to_string()).unwrap();
        std::fs::create_dir_all(root.join(".impeccable/build")).unwrap();
        std::fs::write(root.join(".impeccable/build/spec.json"), "existing spec").unwrap();
        std::fs::write(root.join(".impeccable/build/state.json"), "existing state").unwrap();
        let mut io = Io::stdio();
        io.cwd = root.clone();
        io.stdout = Box::new(Vec::<u8>::new());
        io.stderr = Box::new(Vec::<u8>::new());
        let args = [
            "--inspect-map",
            "--regions",
            "regions.json",
            "--out-dir",
            "inspection",
        ]
        .map(String::from);
        assert_eq!(run(&args, &mut io, &image, "comp.png"), 0);
        assert_eq!(
            std::fs::read_to_string(root.join("regions.json")).unwrap(),
            input.to_string()
        );
        assert_eq!(
            std::fs::read_to_string(root.join(".impeccable/build/spec.json")).unwrap(),
            "existing spec"
        );
        assert_eq!(
            std::fs::read_to_string(root.join(".impeccable/build/state.json")).unwrap(),
            "existing state"
        );
        let html = std::fs::read_to_string(root.join("inspection/index.html")).unwrap();
        assert!(!html.contains("</script><script>alert(1)</script>"));
        for name in ["comp.png", "overlay.png", "region-1.png", "reference-1.png"] {
            let bytes = std::fs::read(root.join("inspection").join(name)).unwrap();
            assert!(png_io::decode_png(&bytes)
                .unwrap()
                .text
                .contains_key("impeccable:crop-of"));
        }
        assert_eq!(
            run(&args, &mut io, &image, "comp.png"),
            1,
            "existing report must not be overwritten"
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn map_inspection_collects_invalid_geometry_and_duplicate_ids() {
        let image = create_image(100, 100, [240, 240, 240, 255]);
        let report = inspect(
            &image,
            &json!({"regions":[
                {"id":"outside", "kind":"image", "note":"room photograph", "pixelBox":{"x":90,"y":0,"w":20,"h":20}},
                {"id":"outside", "kind":"text", "note":"room heading", "box":{"x":0,"y":0,"w":2,"h":0.1}},
                {"id":"unknown", "kind":"imag", "note":"room photograph", "grid":"A0:B1"}
            ]}),
            "comp.png",
        );
        let issues = report["issues"].as_array().unwrap();
        assert!(issues.len() >= 3, "{report}");
        assert!(issues.iter().any(|i| i["code"] == "duplicate-id"));
        assert!(issues.iter().any(|i| i["code"] == "invalid-geometry"));
        assert!(issues.iter().any(|i| i["code"] == "invalid-kind"));
        assert!(report["regions"].as_array().unwrap().is_empty());
    }

    #[test]
    fn map_inspection_exposes_masked_photos_without_hiding_group_members() {
        let image = create_image(100, 100, [240, 240, 240, 255]);
        let mut input = json!({"regions":[
            {"id":"room", "kind":"image", "note":"room photograph", "pixelBox":{"x":0,"y":0,"w":20,"h":20},"reviewGroup":"rooms"},
            {"id":"room-info", "kind":"control", "note":"room information", "pixelBox":{"x":0,"y":0,"w":20,"h":20}},
            {"id":"price", "kind":"text", "note":"room price label", "parentId":"room-info", "reviewGroup":"prices", "pixelBox":{"x":0,"y":0,"w":5,"h":5}},
            {"id":"price-2", "kind":"text", "note":"room price label", "reviewGroup":"prices", "pixelBox":{"x":30,"y":0,"w":5,"h":5}}
        ]});
        let broken = inspect(&image, &input, "comp.png");
        assert_eq!(broken["regions"][0]["reference"]["fullyExcluded"], true);
        assert!(broken["issues"]
            .as_array()
            .unwrap()
            .iter()
            .any(|i| i["code"] == "fully-masked"));
        assert!(broken["issues"]
            .as_array()
            .unwrap()
            .iter()
            .any(|i| i["code"] == "raster-group"));
        input["regions"][1]["container"] = json!(true);
        let fixed = inspect(&image, &input, "comp.png");
        assert_eq!(fixed["regions"].as_array().unwrap().len(), 4);
        assert_eq!(fixed["regions"][0]["reference"]["excludedPixels"], 25);
        assert_eq!(
            fixed["regions"][0]["reference"]["ignoredContainers"],
            json!(["room-info"])
        );
        assert_eq!(fixed["reviewGroups"]["prices"], json!(["price", "price-2"]));
        assert_eq!(fixed["regions"][2]["parentId"], "room-info");
        assert!(fixed.get("approved").is_none());
    }
}
