//! Parity checks for the deterministic (non-browser) comp-verb logic. The
//! expected numbers were produced by the original JS scripts (run from git
//! history) against the same `crates/comp/tests/fixtures` PNGs and confirmed
//! byte-identical to this port's output during the Node-free swap.

use std::path::PathBuf;

use impeccable_comp::png_io;
use impeccable_comp::raster::Image;
use impeccable_comp_verbs::comp_diff;
use impeccable_comp_verbs::comp_spec;
use serde_json::{json, Value};

fn fixtures() -> PathBuf {
    // comp-verbs shares the comp crate's fixtures.
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../comp/tests/fixtures")
}

fn load(name: &str) -> Image {
    let buf = std::fs::read(fixtures().join(name)).unwrap();
    png_io::decode_png(&buf).unwrap().image
}

#[test]
fn comp_diff_scores_match_js() {
    // JS: comp-diff.mjs --comp comp.png --build build_flat.png (no spec).
    let comp = load("comp.png");
    let build = load("build_flat.png");
    let res = comp_diff::compare(&comp, &build, None, "top", "", None);
    let w = &res.whole;
    assert_eq!(w.overall, 0.8374, "overall");
    assert_eq!(w.structure, 0.9846, "structure");
    assert_eq!(w.color, 0.8306, "color");
    assert_eq!(w.detail, 0.5407, "detail");
    assert_eq!(comp_diff::verdict_for(w, None), "match");
}

#[test]
fn grid_to_box_matches_js() {
    // JS: gridToBox on a 10x10 grid.
    assert_eq!(comp_spec::grid_to_box("E2:J4").unwrap(), (0.4, 0.2, 0.6, 0.3));
    assert_eq!(comp_spec::grid_to_box("A0:J0").unwrap(), (0.0, 0.0, 1.0, 0.1));
    assert_eq!(comp_spec::grid_to_box("a0:a0").unwrap(), (0.0, 0.0, 0.1, 0.1));
    // reversed spans normalize the same way
    assert_eq!(comp_spec::grid_to_box("J4:E2").unwrap(), (0.4, 0.2, 0.6, 0.3));
    assert!(comp_spec::grid_to_box("Z9:A0").is_err());
    assert!(comp_spec::grid_to_box("E2-J4").is_err());
}

#[test]
fn measure_regions_shape_matches_js() {
    // A raster region gets a plate path + raster medium; a text region snaps
    // to ink and is measured semantic. `allowUncovered` lets the busy comp pass.
    let comp = load("comp.png");
    let input: Value = json!({
        "allowUncovered": true,
        "regions": [
            { "id": "art", "kind": "plate", "grid": "E2:J4", "note": "an exploded illustration drawing" },
            { "id": "body", "kind": "text", "grid": "A5:D8", "note": "a paragraph of body text content" }
        ]
    });
    let spec = comp_spec::measure_regions(&comp, &input, "comp.png").unwrap();
    let regions = spec.get("regions").and_then(Value::as_array).unwrap();
    assert_eq!(regions.len(), 2);
    let art = &regions[0];
    assert_eq!(art.get("medium").and_then(Value::as_str), Some("raster"));
    assert_eq!(art.get("plate").and_then(Value::as_str), Some("assets/plates/art.png"));
    let body = &regions[1];
    assert_eq!(body.get("medium").and_then(Value::as_str), Some("semantic"));
    assert!(body.get("plate").unwrap().is_null());
    // spec-level fields
    assert_eq!(spec.get("tool").and_then(Value::as_str), Some("comp-spec"));
    assert_eq!(spec.pointer("/compSize/width").and_then(Value::as_i64), Some(comp.width as i64));
}

#[test]
fn measure_regions_refuses_painted_note_under_code_kind() {
    // JS: a text/control/chrome region whose note names painted material is
    // refused at the spec unless codeDrawn is set.
    let comp = load("comp.png");
    let input: Value = json!({
        "allowUncovered": true,
        "regions": [ { "id": "x", "kind": "chrome", "grid": "A0:B1", "note": "an exploded diagram illustration" } ]
    });
    let err = comp_spec::measure_regions(&comp, &input, "comp.png").unwrap_err();
    assert!(err.contains("describes painted material"), "got: {err}");
}

#[test]
fn measure_regions_refuses_oversized_code_region() {
    let comp = load("comp.png");
    let input: Value = json!({
        "allowUncovered": true,
        "regions": [ { "id": "col", "kind": "chrome", "grid": "A0:J9", "note": "a big column of things" } ]
    });
    let err = comp_spec::measure_regions(&comp, &input, "comp.png").unwrap_err();
    assert!(err.contains("covers 100% of the comp") || err.contains("% of the comp"), "got: {err}");
}
