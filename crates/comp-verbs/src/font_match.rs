//! JS: skill/scripts/font-match.mjs
//!
//! Measure the lettering in a comp text region and rank candidate faces by
//! fingerprint distance. The MEASURE path and all ranking math are pure; the
//! browser rendering of candidate specimens (JS `renderCandidates` /
//! `renderProofSheet`) is injected as a [`FontRenderer`] the CLI implements
//! over `crates/browser`, so no browser (and no `core`) leaks into this crate.

use std::path::{Path, PathBuf};

use impeccable_common::Io;
use impeccable_comp::font_fingerprint::{distance, fingerprint, FpOpts, Fingerprint};
use impeccable_comp::font_index::{
    candidates_from_index, load_font_index, CandOpts, FontIndex, SizeKey, MIN_RANK_CAP_PX,
};
use impeccable_comp::png_io;
use impeccable_comp::raster::{self as r};
use serde_json::{json, Map, Value};
use sha1::{Digest, Sha1};

use crate::comp_spec::{load_spec, SPEC_PATH};
use crate::util::{self, arg, arg_or, num, round, to_fixed};

// ---- the injected browser renderer ----------------------------------------

/// A face + weight to render.
pub struct RankCandidate {
    pub family: String,
    pub weight: f64,
}

/// One rendered specimen (JS renderCandidates entry): `loaded` false when the
/// requested weight is not a real face, `fp` None when nothing was legible.
pub struct RenderedCandidate {
    pub family: String,
    pub weight: f64,
    pub loaded: bool,
    pub font_size_px: i64,
    pub fp: Option<Fingerprint>,
}

/// The headless-browser side of font-match, injected by the CLI. Every method
/// returns `None` when no browser is resolvable (the catalog then owns the
/// ranking, exactly as the JS falls back).
pub trait FontRenderer {
    /// JS renderCandidates: render `text` in each candidate at a size whose
    /// measured cap height ≈ `target_cap_px`, and fingerprint each.
    fn render_candidates(
        &mut self,
        candidates: &[RankCandidate],
        text: &str,
        target_cap_px: f64,
        transform: &str,
    ) -> Option<Vec<RenderedCandidate>>;

    /// JS renderProofSheet: the comp crop over the top candidates as one PNG.
    fn render_proof_sheet(
        &mut self,
        comp_crop: &r::Image,
        top: &[RenderedCandidate],
        text: &str,
        cap_px: f64,
        transform: &str,
    ) -> Option<Vec<u8>>;
}

/// A renderer that never has a browser (the catalog/shortlist path). Used when
/// the CLI cannot supply one.
pub struct NoRenderer;
impl FontRenderer for NoRenderer {
    fn render_candidates(&mut self, _: &[RankCandidate], _: &str, _: f64, _: &str) -> Option<Vec<RenderedCandidate>> {
        None
    }
    fn render_proof_sheet(&mut self, _: &r::Image, _: &[RenderedCandidate], _: &str, _: f64, _: &str) -> Option<Vec<u8>> {
        None
    }
}

// ---- width / weight classes ------------------------------------------------

fn fp_field(fp: &Fingerprint, key: &str) -> Option<f64> {
    if key == "weight" {
        fp.weight
    } else {
        fp.get(key)
    }
}

/// JS: widthMeasure(fp) -> (key, value).
fn width_measure(fp: &Fingerprint) -> Option<(&'static str, f64)> {
    if let Some(v) = fp.get("advX") {
        return Some(("advX", v));
    }
    if let Some(v) = fp.get("advTall") {
        return Some(("advTall", v));
    }
    if let Some(v) = fp.get("advance") {
        return Some(("advance", v));
    }
    None
}

/// JS: widthClass(fp).
fn width_class(fp: &Fingerprint) -> &'static str {
    let Some((key, value)) = width_measure(fp) else {
        return "normal";
    };
    let t = if key == "advTall" { [0.45, 0.61, 0.78] } else { [0.42, 0.585, 0.72] };
    if value < t[0] {
        "compressed"
    } else if value < t[1] {
        "condensed"
    } else if value < t[2] {
        "normal"
    } else {
        "wide"
    }
}

/// JS: weightMeasure(fp) -> (key, value).
fn weight_measure(fp: &Fingerprint) -> Option<(&'static str, f64)> {
    if let Some(v) = fp.get("densTall") {
        return Some(("densTall", v));
    }
    if let Some(v) = fp.get("densX") {
        return Some(("densX", v));
    }
    if let Some(v) = fp.get("stemW") {
        return Some(("stemW", v));
    }
    if let Some(v) = fp.weight {
        return Some(("weight", v));
    }
    None
}

/// JS: weightClass(fp).
fn weight_class(fp: &Fingerprint) -> &'static str {
    let Some((key, value)) = weight_measure(fp) else {
        return "regular";
    };
    let t = if key == "stemW" { [0.105, 0.165, 0.195, 0.24] } else { [0.34, 0.48, 0.56, 0.66] };
    if value < t[0] {
        "light"
    } else if value < t[1] {
        "regular"
    } else if value < t[2] {
        "medium"
    } else if value < t[3] {
        "bold"
    } else {
        "black"
    }
}

/// JS SHORTLIST.
fn shortlist(width: &str) -> Vec<&'static str> {
    match width {
        "compressed" => vec![
            "League Gothic:400", "Bebas Neue:400", "Anton:400", "Six Caps:400",
            "Big Shoulders Display:900", "Antonio:700", "Saira Extra Condensed:800", "Oswald:700",
        ],
        "condensed" => vec![
            "League Gothic:400", "Fjalla One:400", "Anton:400", "Bebas Neue:400", "Oswald:600",
            "Barlow Condensed:700", "Roboto Condensed:800", "Archivo Narrow:700",
            "Pathway Gothic One:400", "Big Shoulders Display:800", "Teko:600", "Sofia Sans Condensed:800",
        ],
        "wide" => vec![
            "Archivo Black:400", "Syne:800", "Space Grotesk:700", "Unbounded:700",
            "Bricolage Grotesque:800", "Sora:800", "Outfit:800", "Lexend:800",
        ],
        _ => vec![
            "Inter:700", "Work Sans:700", "IBM Plex Sans:700", "Archivo:800", "Public Sans:700",
            "Source Sans 3:700", "Roboto:900", "Barlow:800", "Manrope:800", "Rubik:800",
        ],
    }
}

/// JS: parseCandidates(s).
fn parse_candidates(s: Option<&str>) -> Vec<RankCandidate> {
    let s = s.unwrap_or("");
    s.split(',')
        .map(|x| x.trim())
        .filter(|x| !x.is_empty())
        .map(|x| {
            // ^(.*?)(?::(\d{3}))?$
            if let Some(idx) = x.rfind(':') {
                let (fam, rest) = x.split_at(idx);
                let w = &rest[1..];
                if w.len() == 3 && w.bytes().all(|b| b.is_ascii_digit()) {
                    return RankCandidate { family: fam.trim().to_string(), weight: w.parse().unwrap() };
                }
            }
            RankCandidate { family: x.trim().to_string(), weight: 400.0 }
        })
        .collect()
}

/// JS: withWeightVariants(list).
fn with_weight_variants(list: &[&str]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let push = |s: String, out: &mut Vec<String>, seen: &mut std::collections::HashSet<String>| {
        if seen.insert(s.clone()) {
            out.push(s);
        }
    };
    for c in list {
        push(c.to_string(), &mut out, &mut seen);
        if let Some(idx) = c.rfind(':') {
            let (fam, rest) = c.split_at(idx);
            let w = &rest[1..];
            if w.len() == 3 && w.bytes().all(|b| b.is_ascii_digit()) {
                let wv: i64 = w.parse().unwrap();
                for d in [-200i64, 200] {
                    let nw = wv + d;
                    if (100..=900).contains(&nw) {
                        push(format!("{fam}:{nw}"), &mut out, &mut seen);
                    }
                }
            }
        }
    }
    out
}

struct Selected {
    candidates: Vec<RankCandidate>,
    catalog: Vec<impeccable_comp::font_index::Candidate>,
    #[allow(dead_code)]
    source: &'static str,
}

/// JS: selectCandidates(fp, {own, index, n, category}).
fn select_candidates(
    fp: &Fingerprint,
    own: Vec<RankCandidate>,
    index: Option<&FontIndex>,
    n: usize,
    category: Option<&str>,
) -> Selected {
    let catalog = if let Some(index) = index {
        candidates_from_index(
            fp,
            index,
            &CandOpts { n, category: category.map(String::from), ..Default::default() },
        )
    } else {
        Vec::new()
    };
    let mut list: Vec<RankCandidate> = Vec::new();
    for o in own {
        list.push(o);
    }
    for c in &catalog {
        list.push(RankCandidate { family: c.family.clone(), weight: c.weight });
    }
    let mut source = "index";
    if index.is_none() {
        source = "shortlist";
        for s in with_weight_variants(&shortlist(width_class(fp))) {
            if let Some(c) = parse_candidates(Some(&s)).into_iter().next() {
                list.push(c);
            }
        }
    }
    let mut seen = std::collections::HashSet::new();
    let candidates: Vec<RankCandidate> = list
        .into_iter()
        .filter(|c| seen.insert(format!("{}:{}", c.family, fmt_num(c.weight))))
        .collect();
    Selected { candidates, catalog, source }
}

// ---- choice stamp ----------------------------------------------------------

fn stamp_hash(region_id: &str, family: &str, weight: &str, font_size_px: &str, source: &str) -> String {
    let mut h = Sha1::new();
    h.update(format!("font-match:{region_id}:{family}:{weight}:{font_size_px}:{source}").as_bytes());
    let digest = h.finalize();
    let hex: String = digest.iter().map(|b| format!("{b:02x}")).collect();
    hex[..12].to_string()
}

/// JS: choiceStamped(regionId, chosen).
pub fn choice_stamped(region_id: &str, chosen: &Value) -> bool {
    let Some(stamp) = chosen.get("stamp").and_then(Value::as_str) else {
        return false;
    };
    let family = chosen.get("family").and_then(Value::as_str).unwrap_or("");
    let weight = jsonnum_str(chosen.get("weight"));
    let font_size = jsonnum_str(chosen.get("fontSizePx"));
    let source = chosen.get("source").and_then(Value::as_str).unwrap_or("");
    stamp_hash(region_id, family, &weight, &font_size, source) == stamp
}

/// A number/string JSON field the way JS template-interpolates it in the stamp.
fn jsonnum_str(v: Option<&Value>) -> String {
    match v {
        Some(Value::Number(n)) => n.to_string(),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Null) | None => "undefined".to_string(),
        Some(Value::Bool(b)) => b.to_string(),
        Some(other) => other.to_string(),
    }
}

// ---- fp serialization ------------------------------------------------------

const COMPACT_KEYS: [&str; 16] = [
    "lines", "glyphs", "capHeightPx", "inkIsDark", "allCaps", "advance", "advTall", "advX", "gap",
    "xRatio", "stemW", "contrast", "serif", "densTall", "densX", "weight",
];

/// JS: compactFp(fp).
fn compact_fp(fp: &Fingerprint) -> Value {
    let mut m = Map::new();
    for &k in &COMPACT_KEYS {
        let v = match k {
            "lines" => json!(fp.lines),
            "glyphs" => json!(fp.glyphs),
            "capHeightPx" => num(fp.cap_height_px),
            "inkIsDark" => json!(fp.ink_is_dark),
            "allCaps" => json!(fp.all_caps),
            "weight" => fp.weight.map(num).unwrap_or(Value::Null),
            _ => fp.get(k).map(num).unwrap_or(Value::Null),
        };
        m.insert(k.into(), v);
    }
    Value::Object(m)
}

/// JS number in a template literal.
fn fmt_num(v: f64) -> String {
    match num(v) {
        Value::Number(n) => n.to_string(),
        _ => "null".to_string(),
    }
}

fn opt_num(v: Option<f64>) -> String {
    match v {
        Some(x) => fmt_num(x),
        None => "null".to_string(),
    }
}

/// JS: describe(fp).
fn describe(fp: &Fingerprint) -> String {
    let wm = width_measure(fp);
    let wt = weight_measure(fp);
    let wm_s = wm.map(|(k, v)| format!(" ({k} {})", fmt_num(v))).unwrap_or_default();
    let wt_s = wt.map(|(k, v)| format!(" ({k} {})", fmt_num(v))).unwrap_or_default();
    format!(
        "capHeight {}px, width {}{wm_s}, weight {}{wt_s}, tracking {}{}",
        fmt_num(fp.cap_height_px),
        width_class(fp),
        weight_class(fp),
        opt_num(fp.get("gap")),
        if fp.all_caps { ", all caps" } else { "" }
    )
}

fn size_display(s: &SizeKey) -> String {
    match s {
        SizeKey::Num(n) => fmt_num(*n),
        SizeKey::Caps => "48c".to_string(),
    }
}

fn resolve(io: &Io, p: &str) -> PathBuf {
    let path = Path::new(p);
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        io.cwd.join(path)
    }
}

/// Resolve the font-index catalog the way concept-seed resolves its catalog:
/// `IMPECCABLE_CATALOG_DIR/font-index.json` first (the private moat mount, evals
/// and tests), then the skill's shipped copy at
/// `IMPECCABLE_SKILL_DIR/scripts/data/font-index.json`. None when neither
/// exists: the built-in per-width shortlist stands in, exactly as the JS did
/// when `data/font-index.json` was absent. The catalog file is never committed
/// to the engine repo.
fn font_index_path(io: &Io) -> Option<PathBuf> {
    if let Some(dir) = io.env.get("IMPECCABLE_CATALOG_DIR").filter(|v| !v.is_empty()) {
        let p = Path::new(dir).join("font-index.json");
        if p.exists() {
            return Some(p);
        }
    }
    if let Some(dir) = io.env.get("IMPECCABLE_SKILL_DIR").filter(|v| !v.is_empty()) {
        let p = Path::new(dir).join("scripts").join("data").join("font-index.json");
        if p.exists() {
            return Some(p);
        }
    }
    None
}

// ---- spec mutation helpers -------------------------------------------------

fn region_mut<'a>(spec: &'a mut Value, id: &str) -> Option<&'a mut Value> {
    spec.get_mut("regions")?
        .as_array_mut()?
        .iter_mut()
        .find(|r| r.get("id").and_then(Value::as_str) == Some(id))
}

fn write_spec(io: &Io, spec_path: &str, spec: &Value) {
    let out = resolve(io, spec_path);
    if let Some(parent) = out.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(out, util::json_pretty(spec));
}

// ---- CLI -------------------------------------------------------------------

/// `impeccable font-match --measure <id> | --rank <id> ...`
pub fn run(argv: &[String], io: &mut Io, renderer: &mut dyn FontRenderer) -> i32 {
    let spec_path = arg_or(argv, "spec", SPEC_PATH).to_string();
    let mut spec = load_spec(&resolve(io, &spec_path));
    let measure_id = arg(argv, "measure");
    let rank_id = arg(argv, "rank");
    let id = measure_id.or(rank_id);
    let Some(id) = id else {
        io.err("usage: font-match.mjs --measure <text-region-id> | --rank <text-region-id> [--candidates \"Family:700,Family2:400,...\"] [--text \"...\"] [--transform uppercase] [--category sans,serif,display,handwriting,mono]\n");
        return 1;
    };
    let Some(spec_val) = spec.as_mut() else {
        io.err(&format!("font-match: no spec at {spec_path}; run comp-spec.mjs first\n"));
        return 1;
    };
    let region = spec_val
        .get("regions")
        .and_then(Value::as_array)
        .and_then(|a| a.iter().find(|r| r.get("id").and_then(Value::as_str) == Some(id)))
        .cloned();
    let Some(region) = region else {
        let ids = spec_val
            .get("regions")
            .and_then(Value::as_array)
            .map(|a| a.iter().filter_map(|r| r.get("id").and_then(Value::as_str)).collect::<Vec<_>>().join(", "))
            .unwrap_or_default();
        io.err(&format!("font-match: no region {id}; ids: {ids}\n"));
        return 1;
    };
    let comp_file = spec_val.get("comp").and_then(Value::as_str).unwrap_or("").to_string();
    let comp = match png_io::load_raster(&resolve(io, &comp_file)) {
        Ok((d, _)) => d.image,
        Err(e) => {
            io.err(&format!("font-match: cannot read {comp_file}: {e}\n"));
            return 1;
        }
    };
    let px = |k: &str| region.pointer(&format!("/px/{k}")).and_then(Value::as_f64).unwrap_or(0.0);
    let (rx, ry, rw, rh) = (px("x"), px("y"), px("w"), px("h"));
    let c = r::crop(&comp, rx, ry, rw, rh);
    let fp = fingerprint(&c, &FpOpts::default());
    let px_w = rw as i64;
    let px_h = rh as i64;
    let Some(fp) = fp else {
        // No lettering: record the attempt and size by the box.
        if let Some(reg) = region_mut(spec_val, id) {
            let ty = reg.as_object_mut().and_then(|_| None::<()>);
            let _ = ty;
            let mut tmap = reg.get("type").and_then(|t| t.as_object()).cloned().unwrap_or_default();
            tmap.insert("comp".into(), Value::Null);
            tmap.insert("measuredAt".into(), json!(util::iso_now()));
            tmap.insert("note".into(), json!("no separable lettering in the crop; size by the region box"));
            reg.as_object_mut().unwrap().insert("type".into(), Value::Object(tmap));
        }
        write_spec(io, &spec_path, spec_val);
        io.out(&format!("MEASURE {id}: no separable lettering in the region crop at comp resolution; size this text by its box ({px_w}x{px_h}px) and inherit face and weight from the nearest measured region.\n"));
        return 0;
    };
    // Record type.comp + classes.
    if let Some(reg) = region_mut(spec_val, id) {
        let mut tmap = reg.get("type").and_then(|t| t.as_object()).cloned().unwrap_or_default();
        tmap.insert("comp".into(), compact_fp(&fp));
        tmap.insert("widthClass".into(), json!(width_class(&fp)));
        tmap.insert("weightClass".into(), json!(weight_class(&fp)));
        reg.as_object_mut().unwrap().insert("type".into(), Value::Object(tmap));
    }
    write_spec(io, &spec_path, spec_val);
    io.out(&format!(
        "MEASURE {id}: {} over {} line{}, {} glyphs. Set this region's font-size so its cap height renders at {}px; choose a {} {} face.\n",
        describe(&fp),
        fp.lines,
        if fp.lines == 1 { "" } else { "s" },
        fp.glyphs,
        fmt_num(fp.cap_height_px),
        width_class(&fp),
        weight_class(&fp)
    ));
    if rank_id.is_none() {
        return 0;
    }
    if fp.cap_height_px < MIN_RANK_CAP_PX {
        io.out(&format!(
            "RANK skipped: cap height {}px is under {}px, too small at comp resolution for a face fingerprint to mean anything. Size this text by its box ({px_w}x{px_h}px) and inherit face and weight from the nearest measured region.\n",
            fmt_num(fp.cap_height_px),
            fmt_num(MIN_RANK_CAP_PX)
        ));
        return 0;
    }
    let own = parse_candidates(arg(argv, "candidates"));
    let own_len = own.len();
    let index = font_index_path(io).and_then(|p| load_font_index(&p));
    let category = arg(argv, "category");
    let sel = select_candidates(&fp, own, index.as_ref(), 25, category);
    if let Some(index) = index.as_ref() {
        let mut top5: Vec<&impeccable_comp::font_index::Candidate> = Vec::new();
        for h in &sel.catalog {
            if !top5.iter().any(|t| t.family == h.family) {
                top5.push(h);
            }
            if top5.len() >= 5 {
                break;
            }
        }
        let size_note = sel.catalog.first().map(|c| format!(", {}px index", size_display(&c.size))).unwrap_or_default();
        let cat_note = category.map(|c| format!(", category {c}")).unwrap_or_default();
        io.out(&format!(
            "CATALOG top-5 by fingerprint: {} (from {} indexed faces{size_note}{cat_note})\n",
            top5.iter().map(|t| format!("{}:{}", t.family, fmt_num(t.weight))).collect::<Vec<_>>().join(", "),
            index.entries.len()
        ));
        io.out(&format!(
            "CANDIDATES {}: {own_len} yours + {} nearest in the catalog index\n",
            sel.candidates.len(),
            sel.candidates.len() - own_len
        ));
    } else {
        io.out(&format!(
            "CANDIDATES {}: {own_len} yours + {} from the {} shortlist (no catalog index at data/font-index.json)\n",
            sel.candidates.len(),
            sel.candidates.len() - own_len,
            width_class(&fp)
        ));
    }
    let region_text = region.get("text").and_then(Value::as_str);
    let text = arg(argv, "text").or(region_text).unwrap_or("The manuals stop. The forum keeps going.").to_string();
    let default_transform = if fp.all_caps { "uppercase" } else { "none" };
    let transform = arg_or(argv, "transform", default_transform).to_string();
    let results = renderer.render_candidates(&sel.candidates, &text, fp.cap_height_px, &transform);
    let Some(results) = results else {
        // No browser: the catalog fingerprint order is the ranking.
        if let (Some(_), Some(best)) = (index.as_ref(), sel.catalog.first()) {
            let font_size_px = round(fp.cap_height_px / 0.70) as i64;
            io.out("RANK unavailable: no browser (playwright or puppeteer) resolvable from this project or the impeccable CLI; the CATALOG order stands as the ranking.\n");
            io.out(&format!(
                "USE font-family: '{}'; font-weight: {}; font-size: {font_size_px}px;{} NOTE font-size is estimated (cap {}px / 0.70); render one headline word at that size, compare its cap height to the comp crop, and correct the size before building on it.\n",
                best.family,
                fmt_num(best.weight),
                if transform != "none" { format!(" text-transform: {transform};") } else { String::new() },
                fmt_num(fp.cap_height_px)
            ));
            let mut chosen = Map::new();
            chosen.insert("family".into(), json!(best.family));
            chosen.insert("weight".into(), num(best.weight));
            chosen.insert("fontSizePx".into(), json!(font_size_px));
            chosen.insert("source".into(), json!("catalog"));
            chosen.insert("estimatedSize".into(), json!(true));
            let stamp = stamp_hash(id, &best.family, &fmt_num(best.weight), &font_size_px.to_string(), "catalog");
            chosen.insert("stamp".into(), json!(stamp));
            if let Some(reg) = region_mut(spec_val, id) {
                if let Some(ty) = reg.get_mut("type").and_then(|t| t.as_object_mut()) {
                    ty.insert("chosen".into(), Value::Object(chosen));
                }
            }
            write_spec(io, &spec_path, spec_val);
            return 0;
        }
        io.out("RANK unavailable: no browser (playwright or puppeteer) resolvable from this project or the impeccable CLI, and no catalog index. Choose by the MEASURE line: match the width class first, then the weight class; render one headline word against the comp before building on it.\n");
        return 0;
    };
    // Rank rendered rows.
    let mut seen_fp = std::collections::HashSet::new();
    let mut rows: Vec<(RenderedCandidate, f64)> = results
        .iter()
        .filter(|r| r.fp.is_some() && r.loaded)
        .map(|r| {
            let d = distance(&|k| fp.get(k), &|k| r.fp.as_ref().unwrap().get(k));
            (r, d)
        })
        .filter(|(_, d)| d.is_finite())
        .map(|(r, d)| (clone_rendered(r), d))
        .collect();
    rows.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap());
    rows.retain(|(r, _)| {
        let f = r.fp.as_ref().unwrap();
        let k = format!(
            "{}|{}|{}|{}|{}",
            r.family,
            opt_num(f.get("advX")),
            opt_num(f.get("advTall")),
            opt_num(f.get("densTall")),
            opt_num(f.get("stemW"))
        );
        seen_fp.insert(k)
    });
    let dropped: Vec<String> = results
        .iter()
        .filter(|r| !r.loaded)
        .map(|r| format!("{}:{}", r.family, fmt_num(r.weight)))
        .collect();
    if !dropped.is_empty() {
        io.out(&format!("SKIPPED (not available at that weight on Google Fonts): {}\n", dropped.join(", ")));
    }
    let wm = width_measure(&fp);
    let wt = weight_measure(&fp);
    let pct_delta = |m: Option<(&'static str, f64)>, other: &Fingerprint| -> Option<f64> {
        let (key, value) = m?;
        let ov = fp_field(other, key)?;
        Some((ov - value) / value)
    };
    let fmt_pct = |v: Option<f64>| -> String {
        match v {
            None => "n/a".to_string(),
            Some(x) => format!("{}{}%", if x >= 0.0 { "+" } else { "" }, to_fixed(x * 100.0, 0)),
        }
    };
    for (r, d) in &rows {
        let f = r.fp.as_ref().unwrap();
        io.out(&format!(
            "RANK {}:{} distance {}  width {} ({} {})  weight {} ({} {})  font-size {}px for cap {}px\n",
            r.family,
            fmt_num(r.weight),
            to_fixed(*d, 3),
            width_class(f),
            fmt_pct(pct_delta(wm, f)),
            wm.map(|(k, _)| k).unwrap_or("advance"),
            weight_class(f),
            fmt_pct(pct_delta(wt, f)),
            wt.map(|(k, _)| k).unwrap_or("ink"),
            r.font_size_px,
            fmt_num(fp.cap_height_px)
        ));
    }
    // Proof sheet (best-effort).
    let top: Vec<RenderedCandidate> = rows.iter().take(3).map(|(r, _)| clone_rendered(r)).collect();
    if let Some(sheet) = renderer.render_proof_sheet(&c, &top, &text, fp.cap_height_px, &transform) {
        let dir = Path::new(&spec_path).parent().map(|p| p.to_path_buf()).unwrap_or_default();
        let out = dir.join("font-match").join(format!("{id}.png"));
        let abs = resolve(io, &out.to_string_lossy());
        if let Some(parent) = abs.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if std::fs::write(&abs, sheet).is_ok() {
            io.out(&format!(
                "PROOF {} (comp crop, then the top {} candidates at the comp's cap height; open it before choosing)\n",
                out.to_string_lossy().replace('\\', "/"),
                top.len()
            ));
        }
    }
    if let Some((best, _)) = rows.first() {
        let bfp = best.fp.as_ref().unwrap();
        let mut advice: Vec<String> = Vec::new();
        let dw = pct_delta(wm, bfp);
        let dwt = pct_delta(wt, bfp);
        if let Some(dw) = dw {
            if dw.abs() > 0.1 {
                advice.push(if dw > 0.0 {
                    "still too wide: try a more condensed face or a variable font with a wdth axis".to_string()
                } else {
                    "still too narrow: try a wider face".to_string()
                });
            }
        }
        let variable = index
            .as_ref()
            .and_then(|idx| idx.entries.iter().find(|e| e.family == best.family))
            .map(|e| e.variable)
            .unwrap_or(true);
        if let Some(dwt) = dwt {
            if dwt.abs() > 0.15 && variable {
                advice.push(if dwt > 0.0 {
                    format!("too heavy: drop to weight {}", 100f64.max(best.weight - 200.0) as i64)
                } else {
                    format!("too light: raise to weight {}", 900f64.min(best.weight + 200.0) as i64)
                });
            }
        }
        io.out(&format!(
            "USE font-family: '{}'; font-weight: {}; font-size: {}px;{}{}\n",
            best.family,
            fmt_num(best.weight),
            best.font_size_px,
            if transform != "none" { format!(" text-transform: {transform};") } else { String::new() },
            if advice.is_empty() { String::new() } else { format!(" NOTE {}", advice.join("; ")) }
        ));
        let mut chosen = Map::new();
        chosen.insert("family".into(), json!(best.family));
        chosen.insert("weight".into(), num(best.weight));
        chosen.insert("fontSizePx".into(), json!(best.font_size_px));
        chosen.insert("source".into(), json!(sel.source));
        chosen.insert("fp".into(), compact_fp(bfp));
        let stamp = stamp_hash(id, &best.family, &fmt_num(best.weight), &best.font_size_px.to_string(), sel.source);
        chosen.insert("stamp".into(), json!(stamp));
        if let Some(reg) = region_mut(spec_val, id) {
            if let Some(ty) = reg.get_mut("type").and_then(|t| t.as_object_mut()) {
                ty.insert("chosen".into(), Value::Object(chosen));
            }
        }
        write_spec(io, &spec_path, spec_val);
    }
    0
}

fn clone_rendered(r: &RenderedCandidate) -> RenderedCandidate {
    RenderedCandidate {
        family: r.family.clone(),
        weight: r.weight,
        loaded: r.loaded,
        font_size_px: r.font_size_px,
        fp: r.fp.as_ref().map(clone_fp),
    }
}

fn clone_fp(f: &Fingerprint) -> Fingerprint {
    Fingerprint {
        lines: f.lines,
        glyphs: f.glyphs,
        cap_height_px: f.cap_height_px,
        ink_is_dark: f.ink_is_dark,
        upsampled: f.upsampled,
        all_caps: f.all_caps,
        isolated_from: f.isolated_from,
        weight: f.weight,
        feats: f.feats.clone(),
    }
}
