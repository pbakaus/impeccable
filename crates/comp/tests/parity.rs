//! Differential-parity harness: runs the Rust port over the same fixtures the
//! JS libs were recorded on (crates/comp/tests/record.mjs) and asserts the
//! outputs match the golden (crates/comp/tests/golden/parity.json).
//!
//! Pixel-level parity is proven by CRC32 of decoded/produced RGBA (and the f32
//! diff-map) buffers; scores and fingerprints are compared value-for-value.

use impeccable_comp::font_fingerprint as ff;
use impeccable_comp::font_index as fi;
use impeccable_comp::hero;
use impeccable_comp::metrics as m;
use impeccable_comp::raster::{self as r, rgb, Image};
use impeccable_comp::{crc32, crc32_f32, png_io};
use serde_json::Value;
use std::path::PathBuf;

fn fixtures() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
}
fn golden() -> Value {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/golden/parity.json");
    serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap()
}
fn load(name: &str) -> Image {
    let buf = std::fs::read(fixtures().join(name)).unwrap();
    png_io::decode_png(&buf).unwrap().image
}
fn u(v: &Value) -> u32 {
    v.as_u64().unwrap() as u32
}
fn f(v: &Value) -> f64 {
    v.as_f64().unwrap()
}
fn approx(a: f64, b: &Value, tol: f64, what: &str) {
    let bf = f(b);
    assert!((a - bf).abs() <= tol, "{what}: rust {a} vs golden {bf} (|d|={})", (a - bf).abs());
}

#[test]
fn png_decode_pixel_parity() {
    let g = golden();
    let sample = load("sample.png");
    assert_eq!(sample.width, g["sample"]["width"].as_u64().unwrap() as usize);
    assert_eq!(sample.height, g["sample"]["height"].as_u64().unwrap() as usize);
    assert_eq!(crc32(&sample.data), u(&g["sample"]["crc"]), "sample.png RGBA crc");
    for (name, key) in [
        ("comp.png", "comp"),
        ("build_flat.png", "flat"),
        ("build_recolor.png", "recolor"),
        ("build_shift.png", "shift"),
    ] {
        assert_eq!(crc32(&load(name).data), u(&g["images"][key]), "{name} crc");
    }
}

#[test]
fn png_encode_roundtrip() {
    // The encoder need not match the JS byte stream, but decode(encode(x)) must
    // round-trip the pixels exactly.
    let comp = load("comp.png");
    let bytes = png_io::encode_png(&comp, &[]).unwrap();
    let back = png_io::decode_png(&bytes).unwrap().image;
    assert_eq!(comp.data, back.data, "encode->decode pixel roundtrip");
}

#[test]
fn raster_op_parity() {
    let g = golden();
    let comp = load("comp.png");
    assert_eq!(crc32(&r::resize(&comp, 256.0, 170.0).data), u(&g["raster"]["resize_down"]));
    let up = r::resize(&r::crop(&comp, 24.0, 60.0, 300.0, 90.0), 600.0, 180.0);
    assert_eq!(crc32(&up.data), u(&g["raster"]["resize_up"]));
    assert_eq!(crc32(&r::crop(&comp, 340.0, 48.0, 400.0, 192.0).data), u(&g["raster"]["crop"]));
    assert_eq!(crc32(&r::fit(&comp, 300.0, 300.0, false).data), u(&g["raster"]["fit"]));

    let mut c = r::create_image(200, 60, [10, 10, 10, 255]);
    r::stroke_rect(&mut c, 10.0, 10.0, 180.0, 40.0, rgb([255, 0, 0]), 3.0);
    r::draw_label(&mut c, "HELLO 42%", 20.0, 20.0, rgb([255, 255, 255]), [0.0, 0.0, 0.0, 220.0], 2.0, 4.0);
    assert_eq!(crc32(&c.data), u(&g["raster"]["label"]), "drawLabel/strokeRect");

    let mut b = r::create_image(120, 80, [255, 255, 255, 255]);
    r::blit(&mut b, &r::crop(&comp, 0.0, 0.0, 60.0, 40.0), 30.0, 20.0);
    assert_eq!(crc32(&b.data), u(&g["raster"]["blit"]), "blit");
}

fn check_scores(a: &Image, b: &Image, gs: &Value) {
    approx(m::structure_score(a, b, 256), &gs["structure"], 1e-6, "structure");
    let cs = m::color_score(a, b);
    approx(cs.score, &gs["color"]["score"], 1e-6, "color.score");
    approx(cs.intersection, &gs["color"]["intersection"], 1e-6, "color.intersection");
    approx(cs.palette_match, &gs["color"]["paletteMatch"], 1e-6, "color.paletteMatch");
    let ds = m::detail_score(a, b, 12, 8);
    approx(ds.score, &gs["detail"]["score"], 1e-6, "detail.score");
    approx(ds.raw_score, &gs["detail"]["rawScore"], 1e-6, "detail.rawScore");
    approx(ds.added_fraction, &gs["detail"]["addedFraction"], 1e-6, "detail.addedFraction");
    let ba = m::horizontal_bands(a, 128, 0.02);
    let bb = m::horizontal_bands(b, 128, 0.02);
    approx(m::band_score(&ba, &bb, 0.04), &gs["bands"], 1e-7, "bands");
    let dm = m::diff_map(a, b, 384);
    assert_eq!(crc32_f32(&dm.data), u(&gs["diffMapCrc"]), "diffMap f32 crc (bit-exact)");
}

#[test]
fn metrics_score_parity() {
    let g = golden();
    let comp = load("comp.png");
    let flat = load("build_flat.png");
    let recolor = load("build_recolor.png");
    let shift = load("build_shift.png");
    let sample = load("sample.png");
    check_scores(&comp, &flat, &g["scores"]["comp_flat"]);
    check_scores(&comp, &recolor, &g["scores"]["comp_recolor"]);
    check_scores(&comp, &shift, &g["scores"]["comp_shift"]);
    check_scores(&comp, &comp, &g["scores"]["comp_self"]);
    let sr = r::resize(&sample, 300.0, 200.0);
    check_scores(&sample, &sr, &g["scores"]["sample_resized"]);

    assert_eq!(crc32_f32(&m::to_gray(&comp).data), u(&g["gray"]["comp_toGray"]), "toGray f32 crc");
    assert_eq!(
        crc32_f32(&m::blur_gray(&m::to_gray(&comp), 2).data),
        u(&g["gray"]["comp_blur"]),
        "blurGray f32 crc"
    );
}

#[test]
fn dominant_colors_and_bands_parity() {
    let g = golden();
    for (name, key) in [("comp.png", "comp"), ("sample.png", "sample")] {
        let img = load(name);
        let dc = m::dominant_colors(&img, 6, 3);
        let gold = g["dominant"][key].as_array().unwrap();
        assert_eq!(dc.len(), gold.len(), "{key} dominant count");
        for (c, gc) in dc.iter().zip(gold) {
            assert_eq!(c.hex, gc["hex"].as_str().unwrap(), "{key} hex");
            approx(c.coverage, &gc["coverage"], 1e-12, "coverage");
        }
    }
    let comp = load("comp.png");
    let bands = m::horizontal_bands(&comp, 128, 0.02);
    let gb = g["bands"]["comp"].as_array().unwrap();
    assert_eq!(bands.len(), gb.len(), "band count");
    for (b, gbi) in bands.iter().zip(gb) {
        approx(b.y, &gbi["y"], 1e-7, "band.y");
        approx(b.strength, &gbi["strength"], 1e-7, "band.strength");
    }
    let dg = m::detail_grid(&comp, 12, 8, 512);
    let gg = g["detailGrid"]["comp"].as_array().unwrap();
    for (i, cell) in dg.cells.iter().enumerate() {
        approx(*cell as f64, &gg[i], 1e-4, "detailGrid cell");
    }
}

fn check_ink_box(img: &Image, gv: &Value, what: &str) {
    let b = hero::ink_box(img).unwrap();
    assert_eq!(b.x, gv["x"].as_i64().unwrap(), "{what}.x");
    assert_eq!(b.y, gv["y"].as_i64().unwrap(), "{what}.y");
    assert_eq!(b.w, gv["w"].as_i64().unwrap(), "{what}.w");
    assert_eq!(b.h, gv["h"].as_i64().unwrap(), "{what}.h");
}

#[test]
fn ink_box_parity() {
    let g = golden();
    check_ink_box(&load("comp.png"), &g["inkBox"]["comp"], "comp");
    check_ink_box(&load("sample.png"), &g["inkBox"]["sample"], "sample");
    check_ink_box(&load("build_flat.png"), &g["inkBox"]["flat"], "flat");
}

fn cmp_fp(fp: Option<&ff::Fingerprint>, gold: &Value, what: &str) {
    if gold.is_null() {
        assert!(fp.is_none(), "{what}: expected null fingerprint");
        return;
    }
    let fp = fp.expect(&format!("{what}: expected some fingerprint"));
    assert_eq!(fp.lines as u64, gold["lines"].as_u64().unwrap(), "{what}.lines");
    assert_eq!(fp.glyphs, gold["glyphs"].as_i64().unwrap(), "{what}.glyphs");
    approx(fp.cap_height_px, &gold["capHeightPx"], 1e-9, &format!("{what}.capHeightPx"));
    assert_eq!(fp.ink_is_dark, gold["inkIsDark"].as_bool().unwrap(), "{what}.inkIsDark");
    assert_eq!(fp.upsampled, gold["upsampled"].as_bool().unwrap(), "{what}.upsampled");
    assert_eq!(fp.all_caps, gold["allCaps"].as_bool().unwrap(), "{what}.allCaps");
    assert_eq!(fp.isolated_from, gold["isolatedFrom"].as_i64().unwrap(), "{what}.isolatedFrom");
    match (fp.weight, gold["weight"].as_f64()) {
        (Some(w), Some(_)) => approx(w, &gold["weight"], 1e-12, &format!("{what}.weight")),
        (None, None) => {}
        (a, b) => panic!("{what}.weight mismatch: rust {a:?} golden {b:?}"),
    }
    for k in ff::FEATURES.iter() {
        let rv = fp.get(k);
        let gv = &gold[k.as_str()];
        match (rv, gv.is_null()) {
            (Some(v), false) => approx(v, gv, 1e-12, &format!("{what}.{k}")),
            (None, true) => {}
            _ => panic!("{what}.{k} mismatch: rust {rv:?} golden {gv}"),
        }
    }
}

#[test]
fn fingerprint_parity() {
    let g = golden();
    let o = ff::FpOpts::default();
    // (fixture file, golden key)
    for (file, key) in [
        ("text_s6", "s6"),
        ("text_s4", "s4"),
        ("text_heavy", "heavy"),
        ("text_multi", "multi"),
        ("sample", "sample"),
    ] {
        let img = load(&format!("{file}.png"));
        let fp = ff::fingerprint(&img, &o);
        cmp_fp(fp.as_ref(), &g["fingerprint"][key], key);
    }
}

#[test]
fn distance_parity() {
    let g = golden();
    let o = ff::FpOpts::default();
    let s6 = ff::fingerprint(&load("text_s6.png"), &o).unwrap();
    let s4 = ff::fingerprint(&load("text_s4.png"), &o).unwrap();
    let heavy = ff::fingerprint(&load("text_heavy.png"), &o).unwrap();
    let d = |a: &ff::Fingerprint, b: &ff::Fingerprint| ff::distance(&|k| a.get(k), &|k| b.get(k));
    approx(d(&s6, &s6), &g["distance"]["self"], 1e-12, "distance self");
    approx(d(&s6, &s4), &g["distance"]["s6_s4"], 1e-10, "distance s6_s4");
    approx(d(&s6, &heavy), &g["distance"]["s6_heavy"], 1e-10, "distance s6_heavy");
    let gg = ff::gross_gap(&|k| s6.get(k), &|k| heavy.get(k));
    approx(gg.width.unwrap(), &g["distance"]["grossGap_s6_heavy"]["width"], 1e-10, "grossGap.width");
    approx(gg.weight.unwrap(), &g["distance"]["grossGap_s6_heavy"]["weight"], 1e-10, "grossGap.weight");

    // synthetic: {advX,densTall,contrast} vs contrast:null
    let a = |k: &str| match k {
        "advX" => Some(0.5),
        "densTall" => Some(0.5),
        "contrast" => Some(1.0),
        _ => None,
    };
    let b = |k: &str| match k {
        "advX" => Some(0.5),
        "densTall" => Some(0.5),
        _ => None,
    };
    approx(ff::distance(&a, &b), &g["distance"]["synthetic"], 1e-12, "distance synthetic");

    let gf: Vec<String> = g["features"].as_array().unwrap().iter().map(|v| v.as_str().unwrap().to_string()).collect();
    assert_eq!(*ff::FEATURES, gf, "FEATURES list");
}

#[test]
fn font_index_parity() {
    let g = golden();
    let gi = &g["index"];
    // INDEX_FEATURES order
    let gif: Vec<String> = gi["features"].as_array().unwrap().iter().map(|v| v.as_str().unwrap().to_string()).collect();
    assert_eq!(*fi::INDEX_FEATURES, gif, "INDEX_FEATURES");

    let o = ff::FpOpts::default();
    let s6 = ff::fingerprint(&load("text_s6.png"), &o).unwrap();
    assert_eq!(fi::pack_vector(&|k| s6.get(k), &fi::INDEX_FEATURES), gi["pack"].as_str().unwrap(), "packVector");
    let un = fi::unpack_vector(gi["pack"].as_str().unwrap(), &fi::INDEX_FEATURES);
    for k in fi::INDEX_FEATURES.iter() {
        let gv = &gi["unpack"][k.as_str()];
        match (un.get(k), gv.is_null()) {
            (Some(v), false) => approx(v, gv, 1e-9, &format!("unpack.{k}")),
            (None, true) => {}
            _ => panic!("unpack.{k} mismatch"),
        }
    }
    // routeSize
    let sizes = fi::index_sizes();
    assert_eq!(fi::route_size(8.0, &sizes, false), fi::SizeKey::Num(f(&gi["route"]["c8"])), "route c8");
    assert_eq!(fi::route_size(20.0, &sizes, false), fi::SizeKey::Num(f(&gi["route"]["c20"])), "route c20");
    assert_eq!(fi::route_size(30.0, &sizes, false), fi::SizeKey::Num(f(&gi["route"]["c30"])), "route c30");
    assert_eq!(fi::route_size(30.0, &sizes, true).key(), gi["route"]["c30caps"].as_str().unwrap(), "route c30caps");
    // NON_TEXT_FAMILY
    for e in gi["nonText"].as_array().unwrap() {
        let fam = e["f"].as_str().unwrap();
        assert_eq!(fi::NON_TEXT_FAMILY.is_match(fam), e["hit"].as_bool().unwrap(), "nonText {fam}");
    }

    // Full index (candidate ranking) — needs the catalog JSON from the public repo.
    let pubrepo = std::env::var("IMPECCABLE_PUBLIC_REPO")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.."));
    let idx_path = pubrepo.join("skill/scripts/data/font-index.json");
    if !idx_path.exists() {
        eprintln!("skipping candidate-ranking parity: {idx_path:?} not present");
        return;
    }
    let index = fi::load_font_index(&idx_path).expect("load font index");
    if let Some(loaded) = gi.get("loaded") {
        assert_eq!(index.schema, loaded["schema"].as_i64().unwrap(), "index schema");
        assert_eq!(index.entries.len(), loaded["entries"].as_u64().unwrap() as usize, "index entries");
    }
    if let Some(cand) = gi.get("candidates_s6").and_then(|c| c.as_array()) {
        let out = fi::candidates_from_index(&s6, &index, &fi::CandOpts { n: 10, ..Default::default() });
        assert_eq!(out.len(), cand.len(), "candidate count s6");
        for (c, gc) in out.iter().zip(cand) {
            assert_eq!(c.family, gc["family"].as_str().unwrap(), "candidate family");
            approx(c.weight, &gc["weight"], 1e-9, "candidate weight");
            assert_eq!(c.category, gc["category"].as_str().unwrap(), "candidate category");
            approx(c.d, &gc["d"], 1e-6, "candidate distance");
        }
    }
}

fn assert_json_eq(a: &Value, b: &Value, what: &str) {
    // numeric-aware equality: treat 42 and 42.0 as equal, floats within 1e-9.
    match (a, b) {
        (Value::Number(_), Value::Number(_)) => {
            let (x, y) = (a.as_f64().unwrap(), b.as_f64().unwrap());
            assert!((x - y).abs() <= 1e-9 + 1e-9 * y.abs(), "{what}: {x} vs {y}");
        }
        (Value::Array(xa), Value::Array(ya)) => {
            assert_eq!(xa.len(), ya.len(), "{what}: array len");
            for (i, (x, y)) in xa.iter().zip(ya).enumerate() {
                assert_json_eq(x, y, &format!("{what}[{i}]"));
            }
        }
        (Value::Object(xo), Value::Object(yo)) => {
            for (k, yv) in yo {
                let xv = xo.get(k).unwrap_or_else(|| panic!("{what}: missing key {k}"));
                assert_json_eq(xv, yv, &format!("{what}.{k}"));
            }
        }
        _ => assert_eq!(a, b, "{what}"),
    }
}

#[test]
fn hero_checks_parity() {
    let g = golden();
    let gh = &g["hero"];

    // textRegion
    let comp_crop = load("hero_comp_crop.png");
    let build_crop = load("hero_build_crop.png");
    let region = hero::Region { id: "hero".into(), kind: "text".into(), chosen: None };
    let trc = hero::text_region_check(&region, &comp_crop, &build_crop);
    assert_json_eq(&trc["findings"], &gh["textRegion"]["findings"], "textRegion.findings");
    assert_json_eq(&trc["metrics"], &gh["textRegion"]["metrics"], "textRegion.metrics");

    // inventedInk: rebuild the exact inputs the recorder used.
    let hero_comp = r::create_image(512, 400, [245, 245, 240, 255]);
    let mut hero_build = hero_comp.clone();
    // deterministic lcg(11)
    let mut s: u32 = 11;
    let mut next = || {
        s = s.wrapping_mul(1664525).wrapping_add(1013904223);
        s as f64 / 0xffffffffu32 as f64
    };
    for y in 20..60usize {
        for x in 20..480usize {
            let v = (next() * 255.0).floor() as u8;
            let p = (y * 512 + x) * 4;
            hero_build.data[p] = v;
            hero_build.data[p + 1] = v;
            hero_build.data[p + 2] = v;
        }
    }
    let inv = hero::invented_ink(&hero_comp, &hero_build);
    assert_json_eq(&inv["cells"], &gh["invented"]["cells"], "invented.cells");
    approx(f(&inv["fraction"]), &gh["invented"]["fraction"], 1e-9, "invented.fraction");

    // plateClip
    let mut plate_comp = r::create_image(300, 200, [255, 255, 255, 255]);
    r::fill_rect(&mut plate_comp, 40.0, 30.0, 200.0, 140.0, rgb([10, 20, 40]));
    let mut plate_build = r::create_image(300, 200, [255, 255, 255, 255]);
    r::fill_rect(&mut plate_build, 0.0, 0.0, 260.0, 180.0, rgb([10, 20, 40]));
    let pc = hero::plate_clip_check(&region, &plate_comp, &plate_build);
    assert_json_eq(&pc, &gh["plateClip"], "plateClip");

    // chromeStrip
    let mut strip_comp = r::create_image(600, 120, [255, 255, 255, 255]);
    r::fill_rect(&mut strip_comp, 0.0, 0.0, 600.0, 40.0, rgb([20, 30, 50]));
    r::fill_rect(&mut strip_comp, 0.0, 58.0, 600.0, 2.0, rgb([0, 0, 0]));
    let mut strip_build = r::create_image(600, 120, [255, 255, 255, 255]);
    r::fill_rect(&mut strip_build, 0.0, 0.0, 600.0, 40.0, rgb([20, 30, 50]));
    r::fill_rect(&mut strip_build, 0.0, 88.0, 600.0, 2.0, rgb([0, 0, 0]));
    let nav = hero::Region { id: "nav".into(), kind: "band".into(), chosen: None };
    let cs = hero::chrome_strip_check(&nav, &strip_comp, &strip_build);
    assert_json_eq(&cs["findings"], &gh["chromeStrip"]["findings"], "chromeStrip.findings");
    assert_json_eq(&cs["comp"], &gh["chromeStrip"]["comp"], "chromeStrip.comp");
    assert_json_eq(&cs["build"], &gh["chromeStrip"]["build"], "chromeStrip.build");

    // ruleRows
    let rr: Vec<Value> = hero::rule_rows(&strip_comp, 0.5, 28.0).into_iter().map(|v| Value::from(v)).collect();
    assert_json_eq(&Value::Array(rr), &gh["ruleRows"]["strip"], "ruleRows");

    // inkColor of comp crop
    let ic = hero::ink_color(&comp_crop);
    match (ic.and_then(|c| c.ink), gh["inkColor"].is_null()) {
        (Some(ink), false) => assert_eq!(ink.hex, gh["inkColor"]["hex"].as_str().unwrap(), "inkColor.hex"),
        (None, true) => {}
        _ => panic!("inkColor mismatch"),
    }

    // svgIllustrations
    let html = "\n<svg width=\"24\" height=\"24\"><path d=\"M1 1 L2 2\"/></svg>\n<svg viewBox=\"0 0 800 600\"><path d=\"".to_string()
        + &"M0 0 ".repeat(200)
        + "\"/><path d=\""
        + &"L1 1 ".repeat(100)
        + "\"/><polyline points=\""
        + &"1,2 ".repeat(50)
        + "\"/></svg>\n<svg width=\"48\" height=\"48\"><use href=\"#icon\"/></svg>\n";
    let svg = hero::svg_illustrations(&html);
    let gs = gh["svg"].as_array().unwrap();
    assert_eq!(svg.len(), gs.len(), "svg count");
    for (s, gsv) in svg.iter().zip(gs) {
        assert_eq!(s["paths"].as_i64(), gsv["paths"].as_i64(), "svg paths");
        assert_eq!(s["budget"].as_i64(), gsv["budget"].as_i64(), "svg budget");
        approx(f(&s["long"]), &gsv["long"], 1e-9, "svg long");
        assert_eq!(s["label"], gsv["label"], "svg label");
    }
}
