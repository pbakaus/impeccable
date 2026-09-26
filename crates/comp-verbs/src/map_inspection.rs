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

/// A bounded overview, not a new matcher: both panes use the same scale and
/// preserve aspect ratio. Individual full-resolution crops remain authoritative.
fn comparison_sheet(comp: &Image, spec: &Value, regions: &[&Value], page: usize, pages: usize) -> Image {
    const PANEL_W: usize = 512;
    const PANEL_H: usize = 320;
    const PAD: usize = 24;
    let rows = regions.len().div_ceil(2);
    let mut sheet = r::create_image(PANEL_W * 2 + PAD * 3, 96 + rows * PANEL_H + PAD, [246,247,245,255]);
    let ink = [32.,38.,35.,255.];
    let muted = [91.,101.,95.,255.];
    r::draw_text(&mut sheet, &format!("MASKED REFERENCES {page}/{pages}"), 24., 20., ink, 3.);
    r::draw_text(&mut sheet, "ORIGINAL AND ACTUAL CHECKER REFERENCE. REFERENCE ONLY.", 24., 54., muted, 2.);
    for (i, region) in regions.iter().enumerate() {
        let x = (PAD + (i % 2) * (PANEL_W + PAD)) as f64;
        let y = (96 + (i / 2) * PANEL_H) as f64;
        let label = format!("#{} {}", region["number"], region["id"].as_str().unwrap());
        let label = if label.chars().count() > 42 { format!("{}...", label.chars().take(39).collect::<String>()) } else { label };
        r::draw_text(&mut sheet, &label, x, y, ink, 2.);
        r::draw_text(&mut sheet, &format!("{:.1}% EXCLUDED - {}X{} PX",
            region["reference"]["excludedFraction"].as_f64().unwrap() * 100., region["px"]["w"], region["px"]["h"]), x, y+23., muted, 2.);
        let original = r::crop(comp, coord(region,"x"), coord(region,"y"), coord(region,"w"), coord(region,"h"));
        let reference = comp_spec::prepare_plate_reference(comp, spec, region);
        let scale = (244. / original.width as f64).min(216. / original.height as f64).min(3.);
        let width = (original.width as f64 * scale).round().max(1.);
        let height = (original.height as f64 * scale).round().max(1.);
        for (pane, (name, image)) in [("ORIGINAL", &original), ("CHECKER", &reference.image)].iter().enumerate() {
            let px = x + pane as f64 * 268.;
            r::draw_text(&mut sheet, name, px, y+48., muted, 2.);
            r::fill_rect(&mut sheet, px, y+72., 244., 216., [233.,237.,232.,255.]);
            r::blit(&mut sheet, &r::resize(image, width, height), px+(244.-width)/2., y+72.+(216.-height)/2.);
        }
    }
    sheet
}

fn write_report(dir: &Path, comp: &Image, report: &mut Value) -> Result<(), String> {
    // An inspection owns a new directory. Never overwrite an input, spec, or receipt.
    if let Some(parent) = dir.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::create_dir(dir).map_err(|e| format!("choose a new output directory: {e}"))?;
    let result = write_report_contents(dir, comp, report);
    if result.is_err() { let _ = std::fs::remove_dir_all(dir); }
    result
}

fn write_report_contents(dir: &Path, comp: &Image, report: &mut Value) -> Result<(), String> {
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
    let mut affected: Vec<&Value> = report["regions"].as_array().unwrap().iter()
        .filter(|r| r.pointer("/reference/excludedPixels").and_then(Value::as_u64).unwrap_or(0) > 0).collect();
    affected.sort_by(|a,b| b["reference"]["excludedFraction"].as_f64().unwrap()
        .total_cmp(&a["reference"]["excludedFraction"].as_f64().unwrap()));
    let pages = affected.len().div_ceil(6);
    let mut sheets = Vec::new();
    for (i, regions) in affected.chunks(6).enumerate() {
        let path = format!("comparison-{}.png", i+1);
        save_reference(&dir.join(&path), &comparison_sheet(comp, &spec, regions, i+1, pages), &source)?;
        sheets.push(json!({"path":path,"regionIds":regions.iter().map(|r| &r["id"]).collect::<Vec<_>>()}));
    }
    report["comparisonSheets"] = json!(sheets);
    let data = serde_json::to_string_pretty(report).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("report.json"), &data).map_err(|e| e.to_string())?;
    // JSON in a script element is data; escape HTML delimiters to prevent closing it.
    let safe = data
        .replace('&', "\\u0026")
        .replace('<', "\\u003c")
        .replace('>', "\\u003e");
    // The page is standalone: the design-system kit (vendored from impeccable-site, the source of
    // truth) is inlined, and the three licensed fonts ship beside it.
    let kit = [
        include_str!("../../../ui/component-review/vendor/kinpaku-tokens.css"),
        include_str!("../../../ui/component-review/vendor/kinpaku-kit.css"),
        include_str!("../../../ui/component-review/vendor/docs-rail.css"),
    ]
    .join("\n");
    let strip = include_str!("../../../ui/component-review/vendor/instrument-strip.js").replace("export function", "function");
    let fonts = dir.join("fonts");
    std::fs::create_dir(&fonts).map_err(|e| e.to_string())?;
    for (name, bytes) in [
        ("albertsans.ttf", &include_bytes!("../../../ui/component-review/fonts/albertsans.ttf")[..]),
        ("alumnisans.ttf", &include_bytes!("../../../ui/component-review/fonts/alumnisans.ttf")[..]),
        ("jetbrainsmono.ttf", &include_bytes!("../../../ui/component-review/fonts/jetbrainsmono.ttf")[..]),
        ("albertsans-OFL.txt", include_bytes!("../../../ui/component-review/fonts/albertsans-OFL.txt")),
        ("alumnisans-OFL.txt", include_bytes!("../../../ui/component-review/fonts/alumnisans-OFL.txt")),
        ("jetbrainsmono-OFL.txt", include_bytes!("../../../ui/component-review/fonts/jetbrainsmono-OFL.txt")),
    ] {
        std::fs::write(fonts.join(name), bytes).map_err(|e| e.to_string())?;
    }
    std::fs::write(
        dir.join("index.html"),
        include_str!("map_inspection.html")
            .replace("/*__KS_KIT__*/", &kit)
            .replace("/*__KS_STRIP__*/", &strip)
            .replace("__REPORT_JSON__", &safe),
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
                for sheet in report["comparisonSheets"].as_array().unwrap() {
                    io.out(&format!("COMPARE {}/{}\n", report["outputDir"].as_str().unwrap(), sheet["path"].as_str().unwrap()));
                }
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
    fn sheet_panes_match_original_and_real_reference_at_the_same_scale() {
        let mut comp = create_image(100, 100, [240,240,240,255]);
        r::fill_rect(&mut comp, 10., 10., 10., 10., [150.,40.,20.,255.]);
        let mut region = json!({"id":"art","number":1,"kind":"image","px":{"x":10,"y":10,"w":20,"h":10},"palette":[{"hex":"#f0f0f0"}]});
        let spec = json!({"regions":[region,{"id":"label","kind":"text","px":{"x":10,"y":10,"w":5,"h":10}}]});
        let reference = comp_spec::prepare_plate_reference(&comp, &spec, &region);
        region["reference"] = reference.audit();
        let sheet = comparison_sheet(&comp, &spec, &[&region], 1, 1);
        let expected_original = r::resize(&r::crop(&comp,10.,10.,20.,10.),60.,30.);
        let expected_reference = r::resize(&reference.image,60.,30.);
        assert_ne!(expected_original.data, expected_reference.data);
        assert_eq!(r::crop(&sheet,116.,261.,60.,30.).data, expected_original.data);
        assert_eq!(r::crop(&sheet,384.,261.,60.,30.).data, expected_reference.data);
    }

    #[test]
    fn comparison_sheets_paginate_masked_assets_and_keep_reference_provenance() {
        let root = std::env::temp_dir().join(format!("impeccable-sheet-test-{}-{}", std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let image = create_image(300, 100, [240, 240, 240, 255]);
        let mut regions: Vec<Value> = (0..7).map(|n| json!({"id":format!("art-{n}"),"kind":"image",
            "note":"Distinct illustration", "pixelBox":{"x":5+n*25,"y":20,"w":20,"h":20}})).collect();
        regions.push(json!({"id":"foreground","kind":"text","note":"Overlapping text line",
            "pixelBox":{"x":0,"y":20,"w":200,"h":4}}));
        regions.push(json!({"id":"unmasked","kind":"image","note":"Unobscured photograph",
            "pixelBox":{"x":230,"y":20,"w":20,"h":20}}));
        let mut report = inspect(&image, &json!({"regions":regions}), "comp.png");
        write_report(&root, &image, &mut report).unwrap();
        let sheets = report["comparisonSheets"].as_array().expect("sheets are discoverable in JSON");
        assert_eq!(sheets.len(), 2);
        let ids: Vec<&str> = sheets.iter().flat_map(|s| s["regionIds"].as_array().unwrap()).map(|id|id.as_str().unwrap()).collect();
        assert_eq!(ids, (0..7).map(|n|format!("art-{n}")).collect::<Vec<_>>());
        for sheet in sheets {
            let png = png_io::decode_png(&std::fs::read(root.join(sheet["path"].as_str().unwrap())).unwrap()).unwrap();
            assert_eq!(png.text.get("impeccable:crop-of").map(String::as_str), Some("comp.png"));
            assert!(sheet["regionIds"].as_array().unwrap().len() <= 6);
        }
        assert_eq!(report["regions"].as_array().unwrap().len(), 9);
        let mut clean = inspect(&image, &json!({"regions":[regions[8].clone()]}), "comp.png");
        write_report(&root.join("clean"), &image, &mut clean).unwrap();
        assert_eq!(clean["comparisonSheets"], json!([]));
        std::fs::remove_dir_all(root).unwrap();
    }

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
    fn failed_report_write_removes_only_its_new_directory() {
        let root=std::env::temp_dir().join(format!("map-write-failure-{}",std::process::id()));
        let mut report=json!({"comp":"comp.png","regions":[]});
        let image=create_image(0,0,[0;4]);
        assert!(write_report(&root,&image,&mut report).is_err());
        assert!(!root.exists());
        std::fs::create_dir(&root).unwrap();
        std::fs::write(root.join("keep.txt"),"existing").unwrap();
        assert!(write_report(&root,&image,&mut report).is_err());
        assert_eq!(std::fs::read_to_string(root.join("keep.txt")).unwrap(),"existing");
        std::fs::remove_dir_all(root).unwrap();
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
