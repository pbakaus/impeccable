//! JS: skill/scripts/build-phase.mjs
//!
//! The comp-led build as a state machine on disk. Phases, gates, scaffold, and
//! the hero readings. Nothing here needs a browser; the JS spawned comp-diff as
//! a child process, and this port calls [`crate::comp_diff::compare`] in-process
//! instead. The one external dependency, the organic-clip-path CSS scanner
//! (JS `require('../../cli/engine/rules/checks.mjs')`), is injected so this
//! crate stays free of the closed rule core.

use std::path::{Path, PathBuf};

use impeccable_common::Io;
use impeccable_comp::hero::{
    chrome_strip_check, invented_ink, plate_clip_check, svg_illustrations, text_region_check, Chosen, Region,
};
use impeccable_comp::png_io;
use impeccable_comp::raster::{self as r, Image};
use regex::Regex;
use serde_json::{json, Map, Value};

use crate::comp_diff::{align_build, best_shift, build_report, compare, write_artifacts, Score};
use crate::comp_spec::{load_spec, plate_reference, BUILD_DIR, SPEC_PATH};
use crate::font_match::choice_stamped;
use crate::util::{self, arg, flag, round, to_fixed};

pub const PHASES: [&str; 8] =
    ["comps", "spec", "plates", "hero", "sections", "motion", "responsive", "review"];
const MOCKS_DIR: &str = ".impeccable/mocks";
const HERO_MIN: f64 = 0.72;
const RESPONSIVE_MIN: f64 = 0.65;
const PLATE_MIN: f64 = 0.4;
const PLATE_STRUCTURE_MIN: f64 = 0.4;
const HERO_REPRO: &str = ".impeccable/review/hero-repro.png";
const INVENTED_MIN: f64 = 0.04;

fn state_path() -> String {
    format!("{BUILD_DIR}/state.json")
}

/// The organic-clip-path scanner, injected by the CLI. Returns (selector,
/// snippet) per finding; the default (`no_organic_scan`) returns none, matching
/// the JS behavior when the rules module could not be required.
pub type OrganicScan<'a> = &'a dyn Fn(&str) -> Vec<(Option<String>, String)>;

pub fn no_organic_scan(_: &str) -> Vec<(Option<String>, String)> {
    Vec::new()
}

fn abs(io: &Io, p: &str) -> PathBuf {
    let path = Path::new(p);
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        io.cwd.join(path)
    }
}

fn self_cmd(io: &Io) -> String {
    io.env.get("IMPECCABLE_SELF").filter(|v| !v.is_empty()).cloned().unwrap_or_else(|| "impeccable".to_string())
}

fn now() -> String {
    util::iso_now()
}

fn load_raster(io: &Io, p: &str) -> Result<Image, String> {
    let (d, _) = png_io::load_raster(&abs(io, p))?;
    Ok(d.image)
}

// ---- state -----------------------------------------------------------------

fn read_build_path(io: &Io) -> Option<String> {
    let mut value = None;
    for name in ["config.json", "config.local.json"] {
        let p = abs(io, &format!(".impeccable/{name}"));
        if let Ok(raw) = std::fs::read_to_string(&p) {
            if let Ok(v) = serde_json::from_str::<Value>(&raw) {
                match v.get("buildPath").and_then(Value::as_str) {
                    Some("comp") => value = Some("comp".to_string()),
                    Some("code") => value = Some("code".to_string()),
                    _ => {}
                }
            }
        }
    }
    value
}

fn load_state(io: &Io) -> Option<Value> {
    let raw = std::fs::read_to_string(abs(io, &state_path())).ok()?;
    serde_json::from_str(&raw).ok()
}

fn save_state(io: &Io, state: &Value) {
    let p = abs(io, &state_path());
    if let Some(parent) = p.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(p, util::json_pretty(state));
}

fn new_state(comp: Option<&str>, breakpoint: Option<&str>, artifact: Option<&str>, direction: Option<&str>) -> Value {
    let first = if comp.is_some() { "spec" } else { "comps" };
    let mut phases = Map::new();
    for p in PHASES {
        let status = if p == first { "open" } else { "pending" };
        let opened = if p == first { json!(now()) } else { Value::Null };
        phases.insert(
            p.into(),
            json!({
                "status": status, "openedAt": opened, "closedAt": Value::Null,
                "attempts": 0, "notes": [], "gate": Value::Null, "forced": Value::Null
            }),
        );
    }
    if comp.is_some() {
        if let Some(c) = phases.get_mut("comps") {
            c["status"] = json!("skipped");
            c["notes"] = json!([{ "at": now(), "text": "started with an approved comp; the comp round happened before this state (surface round or manual)" }]);
        }
    }
    json!({
        "tool": "build-phase",
        "version": 2,
        "startedAt": now(),
        "comp": comp.map(Value::from).unwrap_or(Value::Null),
        "direction": direction.map(Value::from).unwrap_or(Value::Null),
        "breakpoint": breakpoint.map(Value::from).unwrap_or(Value::Null),
        "artifact": artifact.map(Value::from).unwrap_or(Value::Null),
        "phase": first,
        "phases": Value::Object(phases),
        "finish": Value::Null,
    })
}

// ---- gate result -----------------------------------------------------------

struct Gate {
    ok: bool,
    reasons: Vec<String>,
    summary: Option<String>,
    // hero-specific extras:
    score: Option<f64>,
    verdict: Option<String>,
    report: Option<String>,
    side_by_side: Option<String>,
    worst: Vec<String>,
    worst_ids: Vec<String>,
    worst_crops: Vec<Value>,
    advisories: Vec<String>,
    region_verdicts: Map<String, Value>,
    // comps: approved comp path
    approved: Option<String>,
    // plates: per-plate rows
    plates: Option<Vec<Value>>,
    error: bool,
}

impl Gate {
    fn ok(summary: String) -> Gate {
        Gate { ok: true, reasons: vec![], summary: Some(summary), ..Gate::blank() }
    }
    fn fail(reasons: Vec<String>) -> Gate {
        Gate { ok: false, reasons, ..Gate::blank() }
    }
    fn blank() -> Gate {
        Gate {
            ok: false,
            reasons: vec![],
            summary: None,
            score: None,
            verdict: None,
            report: None,
            side_by_side: None,
            worst: vec![],
            worst_ids: vec![],
            worst_crops: vec![],
            advisories: vec![],
            region_verdicts: Map::new(),
            approved: None,
            plates: None,
            error: false,
        }
    }
    /// The subset stored on the phase (JS: `const { plates, ...gateRecord } = gate`).
    fn record_json(&self, at: &str) -> Value {
        let mut m = Map::new();
        m.insert("ok".into(), json!(self.ok));
        m.insert("reasons".into(), json!(self.reasons));
        if let Some(s) = &self.summary {
            m.insert("summary".into(), json!(s));
        }
        if let Some(s) = self.score {
            m.insert("score".into(), util::num(s));
        }
        if let Some(v) = &self.verdict {
            m.insert("verdict".into(), json!(v));
        }
        if let Some(v) = &self.report {
            m.insert("report".into(), json!(v));
        }
        if let Some(v) = &self.side_by_side {
            m.insert("sideBySide".into(), json!(v));
        }
        if !self.worst.is_empty() {
            m.insert("worst".into(), json!(self.worst));
        }
        if !self.worst_ids.is_empty() {
            m.insert("worstIds".into(), json!(self.worst_ids));
        }
        if !self.worst_crops.is_empty() {
            m.insert("worstCrops".into(), json!(self.worst_crops));
        }
        if !self.advisories.is_empty() {
            m.insert("advisories".into(), json!(self.advisories));
        }
        if !self.region_verdicts.is_empty() {
            m.insert("regionVerdicts".into(), Value::Object(self.region_verdicts.clone()));
        }
        if let Some(a) = &self.approved {
            m.insert("approved".into(), json!(a));
        }
        if self.error {
            m.insert("error".into(), json!(true));
        }
        m.insert("at".into(), json!(at));
        Value::Object(m)
    }
}

// ---- gates -----------------------------------------------------------------

struct CompEntry {
    file: String,
    sidecar: Option<Value>,
    approved: bool,
}

fn list_comps(io: &Io) -> Vec<CompEntry> {
    let dir = abs(io, MOCKS_DIR);
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return out;
    };
    let mut names: Vec<String> = entries.filter_map(|e| e.ok().map(|e| e.file_name().to_string_lossy().to_string())).collect();
    names.sort();
    for name in names {
        let lower = name.to_lowercase();
        if !(lower.ends_with(".png") || lower.ends_with(".webp") || lower.ends_with(".jpg") || lower.ends_with(".jpeg")) {
            continue;
        }
        let file = format!("{MOCKS_DIR}/{name}");
        let abs_file = abs(io, &file);
        if !abs_file.is_file() {
            continue;
        }
        let sidecar_path = format!("{file}.json");
        let sidecar = std::fs::read_to_string(abs(io, &sidecar_path)).ok().and_then(|raw| serde_json::from_str::<Value>(&raw).ok());
        let approved = sidecar.as_ref().map(|s| s.get("approved") == Some(&Value::Bool(true))).unwrap_or(false);
        out.push(CompEntry { file, sidecar, approved });
    }
    out
}

fn basename(p: &str) -> String {
    Path::new(p).file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| p.to_string())
}

fn gate_comps(io: &Io) -> Gate {
    let comps = list_comps(io);
    let mut reasons = Vec::new();
    if comps.len() < 3 {
        reasons.push(format!(
            "{} comp{} under {MOCKS_DIR}; the comp round puts three compositional options of the chosen direction in front of the user (reference/visualize.md). Generate the missing ones (harness image tool or generate-image.mjs), each with a .json sidecar holding its prompt.",
            comps.len(),
            if comps.len() == 1 { "" } else { "s" }
        ));
    }
    let no_sidecar: Vec<String> = comps.iter().filter(|c| c.sidecar.is_none()).map(|c| basename(&c.file)).collect();
    if !no_sidecar.is_empty() {
        reasons.push(format!(
            "no prompt sidecar for: {} (write <file>.json with {{ \"prompt\": \"...\" }}; generate-image.mjs does this itself)",
            no_sidecar.join(", ")
        ));
    }
    let approved: Vec<&CompEntry> = comps.iter().filter(|c| c.approved).collect();
    if approved.is_empty() {
        reasons.push("no comp is approved: put the three comps in front of the user (decision page via serve-question.mjs, or the structured question tool), then set \"approved\": true in the chosen comp's sidecar. A delegated pick is recorded the same way and disclosed.".into());
    }
    if approved.len() > 1 {
        reasons.push(format!(
            "{} comps carry \"approved\": true; exactly one is the approved comp: {}",
            approved.len(),
            approved.iter().map(|c| basename(&c.file)).collect::<Vec<_>>().join(", ")
        ));
    }
    let mut g = if reasons.is_empty() {
        Gate::ok(format!("{} comps, {} approved", comps.len(), approved.len()))
    } else {
        Gate::fail(reasons)
    };
    g.summary = Some(format!("{} comps, {} approved", comps.len(), approved.len()));
    if approved.len() == 1 {
        g.approved = Some(approved[0].file.clone());
    }
    g
}

fn spec_regions(spec: &Value) -> Vec<Value> {
    spec.get("regions").and_then(Value::as_array).cloned().unwrap_or_default()
}

fn gate_spec(io: &Io, state: &Value) -> Gate {
    let s = self_cmd(io);
    let Some(spec) = load_spec(&abs(io, SPEC_PATH)) else {
        let comp = state.get("comp").and_then(Value::as_str).unwrap_or("");
        return Gate::fail(vec![format!(
            "no spec at {SPEC_PATH}: run comp-spec.mjs --comp {comp} --grid, name the regions, then --regions regions.json"
        )]);
    };
    let regions = spec_regions(&spec);
    if regions.is_empty() {
        return Gate::fail(vec!["spec has no regions".into()]);
    }
    let spec_comp = spec.get("comp").and_then(Value::as_str);
    let state_comp = state.get("comp").and_then(Value::as_str);
    if let (Some(sc), Some(stc)) = (spec_comp, state_comp) {
        if abs(io, sc) != abs(io, stc) {
            return Gate::fail(vec![format!(
                "spec measures {sc}, but this build started on {stc}; re-run comp-spec on the approved comp"
            )]);
        }
    }
    let plates = regions.iter().filter(|r| r.get("medium").and_then(Value::as_str) == Some("raster")).count();
    let cut: Vec<&Value> = regions
        .iter()
        .filter(|r| {
            r.get("medium").and_then(Value::as_str) == Some("raster")
                && r.get("clipped").and_then(Value::as_array).map(|a| !a.is_empty()).unwrap_or(false)
        })
        .collect();
    if !cut.is_empty() {
        return Gate::fail(
            cut.iter()
                .map(|r| {
                    let id = r.get("id").and_then(Value::as_str).unwrap_or("");
                    let sides = r.get("clipped").and_then(Value::as_array).map(|a| a.iter().filter_map(|v| v.as_str()).collect::<Vec<_>>().join(" and ")).unwrap_or_default();
                    format!("region {id}: the comp's artwork runs off its box on the {sides}; widen the region's span so the box holds the whole shape with a margin (or set \"bleed\": true if the page really crops it there), then re-run comp-spec.mjs --regions")
                })
                .collect(),
        );
    }
    // text regions sorted by measured cap height (proxy px.h*0.4 when unmeasured)
    let mut text_regions: Vec<Value> = regions.iter().filter(|r| r.get("kind").and_then(Value::as_str) == Some("text")).cloned().collect();
    let cap_of = |r: &Value| -> f64 {
        r.pointer("/type/comp/capHeightPx").and_then(Value::as_f64).unwrap_or_else(|| r.pointer("/px/h").and_then(Value::as_f64).unwrap_or(0.0) * 0.4)
    };
    text_regions.sort_by(|a, b| cap_of(b).partial_cmp(&cap_of(a)).unwrap());
    let mut reasons: Vec<String> = Vec::new();
    if !text_regions.is_empty() {
        let ids = text_regions.iter().filter_map(|r| r.get("id").and_then(Value::as_str)).collect::<Vec<_>>().join(", ");
        let any_measured = text_regions.iter().any(|r| r.get("type").filter(|v| !v.is_null()).is_some());
        if !any_measured {
            reasons.push(format!(
                "measure the type before closing the spec: {s} font-match --measure <id> for each text region ({ids}); the region with the largest cap height is the lead and gets --rank."
            ));
            return Gate::fail(reasons);
        }
        let measurable: Vec<&Value> = text_regions.iter().filter(|r| r.pointer("/type/comp").filter(|v| !v.is_null()).is_some()).collect();
        let lead = measurable.first().copied().unwrap_or(&text_regions[0]);
        let lead_id = lead.get("id").and_then(Value::as_str).unwrap_or("");
        let has_type = lead.get("type").filter(|v| !v.is_null()).is_some();
        let type_comp = lead.pointer("/type/comp").filter(|v| !v.is_null());
        let chosen = lead.pointer("/type/chosen").filter(|v| !v.is_null());
        if !has_type {
            reasons.push(format!(
                "the lead text region {lead_id} has no type measurement: run {s} font-match --measure {lead_id} (and --rank {lead_id} --text \"<its first words>\" to choose the face by metrics). Set font-size from the printed cap height; do not pick a face by name."
            ));
        } else if type_comp.is_some() && chosen.is_none() {
            let wc = lead.pointer("/type/widthClass").and_then(Value::as_str).unwrap_or("");
            let wt = lead.pointer("/type/weightClass").and_then(Value::as_str).unwrap_or("");
            let cap = lead.pointer("/type/comp/capHeightPx").map(util::fmt_value).unwrap_or_default();
            reasons.push(format!(
                "the lead text region {lead_id} is measured ({wc} {wt}, cap {cap}px) but no face is ranked: run {s} font-match --rank {lead_id} --text \"<its first words>\" [--candidates \"Family:weight,...\"] and use the USE line."
            ));
        } else if type_comp.is_some() && chosen.is_some() && !choice_stamped(lead_id, chosen.unwrap()) {
            let fam = chosen.unwrap().get("family").and_then(Value::as_str).unwrap_or("?");
            reasons.push(format!(
                "the lead text region {lead_id} carries a \"chosen\" face that font-match did not write ({fam}). A face typed into spec.json is the guess this gate exists to refuse; run {s} font-match --rank {lead_id} --text \"<its first words>\" and let it record the choice (with no browser it records the catalog's nearest face)."
            ));
        }
        let unmeasured: Vec<String> = text_regions
            .iter()
            .skip(1)
            .filter(|r| r.get("type").filter(|v| !v.is_null()).is_none())
            .filter_map(|r| r.get("id").and_then(Value::as_str).map(String::from))
            .collect();
        if !unmeasured.is_empty() && reasons.is_empty() {
            reasons.push(format!(
                "measure the other text regions too, each sets its own font-size and weight class: {s} font-match --measure <id> for {}",
                unmeasured.join(", ")
            ));
        }
    }
    if !reasons.is_empty() {
        return Gate::fail(reasons);
    }
    Gate::ok(format!("{} regions, {plates} plates, {} text regions measured", regions.len(), text_regions.len()))
}


/// JS: plateVerdict(region, score).
fn plate_verdict(region: &Value, score: &Score) -> (bool, Vec<String>) {
    let id = region.get("id").and_then(Value::as_str).unwrap_or("");
    let is_texture = region.get("kind").and_then(Value::as_str) == Some("texture");
    let mut reasons = Vec::new();
    if is_texture {
        let effective = 0.5 * score.color + 0.5 * 1f64.min(score.detail / 0.6);
        if effective < PLATE_MIN {
            reasons.push(format!(
                "scores {}% as the material of region {id} (color {}%, detail {}%); crop a clean patch of the comp region (comp-spec.mjs --crop {id} --raw) and mirror-tile it, generate only when no clean patch exists",
                to_fixed(effective * 100.0, 0),
                to_fixed(score.color * 100.0, 0),
                to_fixed(score.detail * 100.0, 0)
            ));
        }
        return (reasons.is_empty(), reasons);
    }
    let comp_calm = region.pointer("/detail/energy").and_then(Value::as_f64).map(|e| e < 12.0).unwrap_or(true);
    if comp_calm && score.detail_added > 0.45 {
        reasons.push(format!(
            "carries detail the comp region {id} does not have (added-detail {}% of cells): noise, grain, or a busier subject where the comp is calm; regenerate from the crop reference without adding texture",
            to_fixed(score.detail_added * 100.0, 0)
        ));
    }
    if score.structure < PLATE_STRUCTURE_MIN {
        reasons.push(format!(
            "structure {}% against the comp region {id}: the composition of the plate is not the region's (different subject, orientation, or crop); regenerate with comp-spec.mjs --crop {id} as the reference image",
            to_fixed(score.structure * 100.0, 0)
        ));
    }
    if score.overall < PLATE_MIN {
        reasons.push(format!(
            "scores {}% against the comp region {id} (structure {}%, color {}%, detail {}%); regenerate with the crop as --ref and the comp-spec plate prompt",
            to_fixed(score.overall * 100.0, 0),
            to_fixed(score.structure * 100.0, 0),
            to_fixed(score.color * 100.0, 0),
            to_fixed(score.detail * 100.0, 0)
        ));
    }
    (reasons.is_empty(), reasons)
}

fn gate_plates(io: &Io) -> Gate {
    let Some(spec) = load_spec(&abs(io, SPEC_PATH)) else {
        return Gate::fail(vec!["no spec".into()]);
    };
    let regions = spec_regions(&spec);
    let raster_regions: Vec<Value> = regions.iter().filter(|r| r.get("medium").and_then(Value::as_str) == Some("raster")).cloned().collect();
    if raster_regions.is_empty() {
        let mut g = Gate::ok("no plates owed".into());
        g.plates = Some(vec![]);
        return g;
    }
    let comp = spec.get("comp").and_then(Value::as_str).and_then(|c| load_raster(io, c).ok());
    let mut reasons: Vec<String> = Vec::new();
    let mut plates: Vec<Value> = Vec::new();
    for rr in &raster_regions {
        let id = rr.get("id").and_then(Value::as_str).unwrap_or("").to_string();
        let file = rr.get("plate").and_then(Value::as_str).map(String::from);
        let Some(file) = file.clone().filter(|f| abs(io, f).exists()) else {
            reasons.push(format!(
                "plate missing for {id}: expected {}; produce it from comp-spec.mjs --crop {id} with generate-image.mjs --plate",
                file.clone().unwrap_or_else(|| "(no path)".into())
            ));
            plates.push(json!({ "id": id, "file": file, "status": "missing" }));
            continue;
        };
        let img = match std::fs::read(abs(io, &file)).map_err(|e| e.to_string()).and_then(|b| png_io::decode_png(&b)) {
            Ok(d) => d,
            Err(e) => {
                reasons.push(format!("plate {file} is not a decodable PNG: {e}"));
                plates.push(json!({ "id": id, "file": file, "status": "unreadable" }));
                continue;
            }
        };
        let is_texture = rr.get("kind").and_then(Value::as_str) == Some("texture");
        let px_w = rr.pointer("/px/w").and_then(Value::as_f64).unwrap_or(0.0);
        let min_w = 1536f64.min(px_w * 1.5);
        if !is_texture && (img.image.width as f64) < min_w {
            reasons.push(format!(
                "plate {file} is {}px wide; the comp region is {}px and a shipping plate needs at least {}px. Regenerate at asset size, do not crop the comp.",
                img.image.width, px_w as i64, round(min_w) as i64
            ));
        }
        let mut score_val: Option<f64> = None;
        if let Some(comp) = &comp {
            let refimg = plate_reference(comp, &spec, rr);
            // composite keyed plates over the region's sampled ground
            let mut build = img.image.clone();
            let mut transparent = 0usize;
            let mut i = 3;
            while i < img.image.data.len() {
                if img.image.data[i] < 128 {
                    transparent += 1;
                }
                i += 4;
            }
            if transparent as f64 > (img.image.data.len() / 4) as f64 * 0.05 {
                let ground = rr
                    .pointer("/palette/0/hex")
                    .and_then(Value::as_str)
                    .and_then(hex_rgba)
                    .unwrap_or([255, 255, 255, 255]);
                let mut over = r::create_image(img.image.width, img.image.height, ground);
                r::blit(&mut over, &img.image, 0.0, 0.0);
                build = over;
            }
            let kind = rr.get("kind").and_then(Value::as_str);
            let res = compare(&refimg, &build, None, "cover", "", kind);
            let score = res.whole.clone();
            score_val = Some(score.overall);
            let (_, vreasons) = plate_verdict(rr, &score);
            for reason in vreasons {
                reasons.push(format!("plate {file}: {reason}"));
            }
            let is_fake = img.text.get("impeccable:fake").map(|v| v == "1").unwrap_or(false);
            if !is_texture && !is_fake {
                let raw = r::crop(
                    comp,
                    rr.pointer("/px/x").and_then(Value::as_f64).unwrap_or(0.0),
                    rr.pointer("/px/y").and_then(Value::as_f64).unwrap_or(0.0),
                    px_w,
                    rr.pointer("/px/h").and_then(Value::as_f64).unwrap_or(0.0),
                );
                let same = impeccable_comp::metrics::structure_score(&raw, &r::resize(&img.image, raw.width as f64, raw.height as f64), 256);
                if same >= 0.95 {
                    reasons.push(format!(
                        "plate {file} is the comp crop of region {id} (structure {}% against the raw region, a resample of the same pixels): a crop of the comp is never a plate; generate the plate from the crop as reference (generate-image.mjs --plate {id})",
                        to_fixed(same * 100.0, 0)
                    ));
                }
            }
        }
        plates.push(json!({
            "id": id, "file": file, "status": "ok",
            "size": format!("{}x{}", img.image.width, img.image.height),
            "score": score_val.map(util::num).unwrap_or(Value::Null)
        }));
    }
    let ok_count = plates.iter().filter(|p| p.get("status").and_then(Value::as_str) == Some("ok")).count();
    let mut g = if reasons.is_empty() { Gate::ok(format!("{ok_count}/{} plates", raster_regions.len())) } else { Gate::fail(reasons) };
    g.summary = Some(format!("{ok_count}/{} plates", raster_regions.len()));
    g.plates = Some(plates);
    g
}

fn hex_rgba(hex: &str) -> Option<[u8; 4]> {
    let re = regex_hex();
    let caps = re.captures(hex)?;
    Some([
        u8::from_str_radix(&caps[1], 16).ok()?,
        u8::from_str_radix(&caps[2], 16).ok()?,
        u8::from_str_radix(&caps[3], 16).ok()?,
        255,
    ])
}

fn regex_hex() -> &'static regex::Regex {
    use once_cell::sync::Lazy;
    static RE: Lazy<regex::Regex> = Lazy::new(|| regex::Regex::new(r"(?i)^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$").unwrap());
    &RE
}

// ---- source-file walk / referenced plates ---------------------------------

fn source_files(io: &Io, limit: usize) -> Vec<String> {
    let skip: std::collections::HashSet<&str> = ["node_modules", ".git", "dist", "build", "out", ".next", ".svelte-kit", ".impeccable", "coverage"].into_iter().collect();
    use once_cell::sync::Lazy;
    static EXTS: Lazy<regex::Regex> = Lazy::new(|| regex::Regex::new(r"(?i)\.(html?|css|scss|jsx?|tsx?|svelte|vue|astro|mdx?|php|erb|hbs)$").unwrap());
    let mut out: Vec<String> = Vec::new();
    fn walk(io: &Io, dir: &Path, rel: &str, depth: usize, out: &mut Vec<String>, limit: usize, skip: &std::collections::HashSet<&str>, exts: &regex::Regex) {
        if out.len() >= limit || depth > 6 {
            return;
        }
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        let mut entries: Vec<_> = entries.filter_map(|e| e.ok()).collect();
        entries.sort_by_key(|e| e.file_name());
        for e in entries {
            if out.len() >= limit {
                return;
            }
            let name = e.file_name().to_string_lossy().to_string();
            let child_rel = if rel.is_empty() { name.clone() } else { format!("{rel}/{name}") };
            let ty = e.file_type();
            let is_dir = ty.map(|t| t.is_dir()).unwrap_or(false);
            if is_dir {
                if !skip.contains(name.as_str()) && !name.starts_with('.') {
                    walk(io, &e.path(), &child_rel, depth + 1, out, limit, skip, exts);
                }
            } else if exts.is_match(&name) {
                out.push(child_rel);
            }
        }
    }
    walk(io, &io.cwd, "", 0, &mut out, limit, &skip, &EXTS);
    out
}

/// JS: unreferencedPlates(spec, artifact). Returns the unreferenced regions.
fn unreferenced_plates(io: &Io, spec: Option<&Value>, artifact: Option<&str>) -> Vec<Value> {
    let Some(spec) = spec else { return vec![] };
    let plates: Vec<Value> = spec_regions(spec)
        .into_iter()
        .filter(|r| r.get("medium").and_then(Value::as_str) == Some("raster") && r.get("plate").and_then(Value::as_str).is_some())
        .collect();
    if plates.is_empty() {
        return vec![];
    }
    let mut linked: Vec<PathBuf> = Vec::new();
    if let Some(art) = artifact {
        if abs(io, art).exists() {
            linked.push(abs(io, art));
            if let Ok(html) = std::fs::read_to_string(abs(io, art)) {
                use once_cell::sync::Lazy;
                static LINK: Lazy<regex::Regex> = Lazy::new(|| regex::Regex::new(r#"(?i)<link\b[^>]*href=["']([^"']+)["'][^>]*>"#).unwrap());
                static REL: Lazy<regex::Regex> = Lazy::new(|| regex::Regex::new(r#"(?i)rel=["']?stylesheet"#).unwrap());
                static CSS: Lazy<regex::Regex> = Lazy::new(|| regex::Regex::new(r#"(?i)\.css(\?|$)"#).unwrap());
                static PROTO: Lazy<regex::Regex> = Lazy::new(|| regex::Regex::new(r"(?i)^(https?:|data:|//)").unwrap());
                for m in LINK.captures_iter(&html) {
                    let href = &m[1];
                    let whole = &m[0];
                    if PROTO.is_match(href) {
                        continue;
                    }
                    if !REL.is_match(whole) && !CSS.is_match(href) {
                        continue;
                    }
                    let clean = href.split('?').next().unwrap_or(href);
                    if clean.starts_with('/') {
                        linked.push(io.cwd.join(clean.trim_start_matches('/')));
                        let art_dir = abs(io, art).parent().map(|p| p.to_path_buf()).unwrap_or_default();
                        linked.push(art_dir.join(clean.trim_start_matches('/')));
                    } else {
                        let art_dir = abs(io, art).parent().map(|p| p.to_path_buf()).unwrap_or_default();
                        linked.push(art_dir.join(clean));
                    }
                }
            }
        }
    }
    let mut files: Vec<PathBuf> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for l in linked {
        if seen.insert(l.clone()) {
            files.push(l);
        }
    }
    for rel in source_files(io, 400) {
        let p = abs(io, &rel);
        if seen.insert(p.clone()) {
            files.push(p);
        }
    }
    let mut corpus = String::new();
    for f in &files {
        if let Ok(t) = std::fs::read_to_string(f) {
            corpus.push_str(&t);
            corpus.push('\n');
        }
    }
    let mut missing = Vec::new();
    for rr in &plates {
        let plate = rr.get("plate").and_then(Value::as_str).unwrap_or("");
        let base = basename(plate);
        let stem = {
            use once_cell::sync::Lazy;
            static EXT: Lazy<regex::Regex> = Lazy::new(|| regex::Regex::new(r"(?i)\.[a-z0-9]+$").unwrap());
            EXT.replace(&base, "").to_string()
        };
        let id = rr.get("id").and_then(Value::as_str).unwrap_or("");
        if corpus.contains(&base) || (corpus.contains("data:image/") && (corpus.contains(&stem) || corpus.contains(id))) {
            continue;
        }
        missing.push(rr.clone());
    }
    missing
}

/// JS: organicClipRegions(artifactFile, spec) via the injected scanner.
fn organic_clip_regions(io: &Io, artifact_file: &str, spec: &Value, scan: OrganicScan) -> Vec<Value> {
    let Ok(html) = std::fs::read_to_string(abs(io, artifact_file)) else {
        return vec![];
    };
    let findings = scan(&html);
    if findings.is_empty() {
        return vec![];
    }
    let raster_regions: Vec<Value> = spec_regions(spec).into_iter().filter(|r| r.get("medium").and_then(Value::as_str) == Some("raster")).collect();
    let mut out = Vec::new();
    for (selector, snippet) in &findings {
        let sel = selector.clone().unwrap_or_default().to_lowercase();
        for rr in &raster_regions {
            let id = rr.get("id").and_then(Value::as_str).unwrap_or("");
            let stem = {
                let plate = rr.get("plate").and_then(Value::as_str).unwrap_or("");
                Path::new(plate).file_stem().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default()
            };
            if (!sel.is_empty() && (sel.contains(&id.to_lowercase()) || (!stem.is_empty() && sel.contains(&stem)))) || raster_regions.len() == 1 {
                out.push(json!({ "id": id, "snippet": snippet }));
                break;
            }
        }
    }
    out
}

// ---- scaffold --------------------------------------------------------------

fn escape_lt(s: &str) -> String {
    s.replace('<', "&lt;")
}

fn relpath(from_dir: &str, to: &str) -> String {
    // JS path.relative(dir, target); both relative to cwd.
    let from = Path::new(from_dir);
    let to = Path::new(to);
    pathdiff(to, from)
}

fn pathdiff(to: &Path, from: &Path) -> String {
    let to_c: Vec<_> = to.components().collect();
    let from_c: Vec<_> = from.components().collect();
    let mut i = 0;
    while i < to_c.len() && i < from_c.len() && to_c[i] == from_c[i] {
        i += 1;
    }
    let mut parts: Vec<String> = Vec::new();
    for _ in i..from_c.len() {
        parts.push("..".into());
    }
    for c in &to_c[i..] {
        parts.push(c.as_os_str().to_string_lossy().to_string());
    }
    if parts.is_empty() {
        ".".into()
    } else {
        parts.join("/")
    }
}

struct Scaffold {
    dir: String,
    css: String,
    html: String,
}

fn write_scaffold(io: &Io, spec: &Value) -> Scaffold {
    let dir = format!("{BUILD_DIR}/scaffold");
    let _ = std::fs::create_dir_all(abs(io, &dir));
    let w = spec.pointer("/compSize/width").and_then(Value::as_i64).unwrap_or(0);
    let h = spec.pointer("/compSize/height").and_then(Value::as_i64).unwrap_or(0);
    let pct = |v: f64| format!("{}%", to_fixed(v * 100.0, 3));
    let mut vars: Vec<String> = vec![":root {".into()];
    let mut rules: Vec<String> = Vec::new();
    let mut body_parts: Vec<String> = Vec::new();
    let mut font_links: Vec<String> = Vec::new();
    let mut seen_links = std::collections::HashSet::new();
    for rr in spec_regions(spec) {
        if rr.get("kind").and_then(Value::as_str) == Some("band") {
            continue;
        }
        let id = rr.get("id").and_then(Value::as_str).unwrap_or("").to_string();
        let bx = rr.pointer("/box/x").and_then(Value::as_f64).unwrap_or(0.0);
        let by = rr.pointer("/box/y").and_then(Value::as_f64).unwrap_or(0.0);
        let bw = rr.pointer("/box/w").and_then(Value::as_f64).unwrap_or(0.0);
        let bh = rr.pointer("/box/h").and_then(Value::as_f64).unwrap_or(0.0);
        vars.push(format!("  --r-{id}-x: {}; --r-{id}-y: {}; --r-{id}-w: {}; --r-{id}-h: {};", pct(bx), pct(by), pct(bw), pct(bh)));
        let cap = rr.pointer("/type/comp/capHeightPx").and_then(Value::as_f64);
        let chosen = rr.pointer("/type/chosen").filter(|v| !v.is_null());
        let chosen_font = chosen.and_then(|c| c.get("fontSizePx")).and_then(Value::as_f64);
        let font_px: Option<i64> = if let Some(f) = chosen_font {
            Some(f as i64)
        } else {
            cap.map(|c| round(c / 0.7) as i64)
        };
        if let Some(cap) = cap {
            let font_seg = font_px.map(|f| format!(" --r-{id}-font: {f}px;")).unwrap_or_default();
            let fam_seg = chosen
                .map(|c| {
                    let fam = c.get("family").and_then(Value::as_str).unwrap_or("");
                    let wt = util::fmt_value(c.get("weight").unwrap_or(&Value::Null));
                    format!(" --r-{id}-family: '{fam}'; --r-{id}-weight: {wt};")
                })
                .unwrap_or_default();
            vars.push(format!("  --r-{id}-cap: {}px;{font_seg}{fam_seg}", cap as i64));
        }
        if let Some(c) = chosen {
            if let Some(fam) = c.get("family").and_then(Value::as_str) {
                let key = format!("{fam}:{}", util::fmt_value(c.get("weight").unwrap_or(&Value::Null)));
                if seen_links.insert(key.clone()) {
                    font_links.push(key);
                }
            }
        }
        rules.push(format!(".r-{id} {{ position: absolute; left: var(--r-{id}-x); top: var(--r-{id}-y); width: var(--r-{id}-w); height: var(--r-{id}-h); }}"));
        let note = rr.get("note").and_then(Value::as_str).unwrap_or(&id);
        let label = escape_lt(note);
        let kind = rr.get("kind").and_then(Value::as_str).unwrap_or("");
        let medium = rr.get("medium").and_then(Value::as_str).unwrap_or("");
        let plate = rr.get("plate").and_then(Value::as_str).unwrap_or("");
        if medium == "raster" && kind != "texture" {
            let src = if !plate.is_empty() { relpath(&dir, plate) } else { String::new() };
            let object_pos = if kind == "image" { "center" } else { "top left" };
            body_parts.push(format!("  <figure class=\"r-{id} region plate\" data-region=\"{id}\"><img src=\"{src}\" alt=\"\" style=\"width:100%;height:100%;object-fit:contain;object-position:{object_pos}\"></figure>"));
        } else if kind == "texture" {
            let src = if !plate.is_empty() { relpath(&dir, plate) } else { String::new() };
            body_parts.push(format!("  <div class=\"r-{id} region texture\" data-region=\"{id}\" style=\"background-image:url('{src}');background-repeat:repeat\"></div>"));
        } else if kind == "text" {
            let style = [
                if font_px.is_some() { format!("font-size:var(--r-{id}-font)") } else { String::new() },
                if chosen.is_some() { format!("font-family:var(--r-{id}-family),sans-serif;font-weight:var(--r-{id}-weight)") } else { String::new() },
                "line-height:1.05".into(),
                "margin:0".into(),
            ]
            .into_iter()
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join(";");
            let text = rr.get("text").and_then(Value::as_str).map(escape_lt).filter(|t| !t.is_empty()).unwrap_or_else(|| id.clone());
            body_parts.push(format!("  <div class=\"r-{id} region text\" data-region=\"{id}\"><!-- {label} --><p style=\"{style}\">{text}</p></div>"));
        } else if kind == "control" {
            body_parts.push(format!("  <div class=\"r-{id} region control\" data-region=\"{id}\"><!-- {label}: rebuild the control's chrome from the crop (comp-spec.mjs --crop {id}); its ink box, border, fill, radius, and label size are the comp's --></div>"));
        } else {
            body_parts.push(format!("  <div class=\"r-{id} region chrome\" data-region=\"{id}\"><!-- {label} --></div>"));
        }
    }
    vars.push("}".into());
    let mut css_lines: Vec<String> = Vec::new();
    css_lines.push("/* Impeccable scaffold: the measured layout of the approved comp as custom properties. Generated by build-phase.mjs scaffold; regenerate after comp-spec.mjs --regions changes. Bind these to your own markup; positions are % of the comp frame so they scale with it. */".into());
    css_lines.extend(vars);
    css_lines.push(String::new());
    css_lines.push(format!(".comp-frame {{ position: relative; width: 100%; aspect-ratio: {w} / {h}; overflow: hidden; }}"));
    css_lines.extend(rules);
    css_lines.push(String::new());
    let css = css_lines.join("\n");
    let css_path = format!("{dir}/layout.css");
    let _ = std::fs::write(abs(io, &css_path), &css);
    let link = if !font_links.is_empty() {
        let fams = font_links
            .iter()
            .map(|f| {
                let parts: Vec<&str> = f.splitn(2, ':').collect();
                let fam = parts[0];
                let wt = parts.get(1).copied().unwrap_or("");
                format!("family={}:wght@{wt}", encode_family(fam))
            })
            .collect::<Vec<_>>()
            .join("&");
        format!("  <link rel=\"stylesheet\" href=\"https://fonts.googleapis.com/css2?{fams}&display=swap\">\n")
    } else {
        String::new()
    };
    let body_bg = spec.pointer("/palette/0/hex").and_then(Value::as_str).unwrap_or("#fff");
    let comp_name = basename(spec.get("comp").and_then(Value::as_str).unwrap_or(""));
    let html = format!(
        "<!doctype html>\n<html lang=\"en\">\n<head>\n  <meta charset=\"utf-8\">\n  <title>Scaffold reference: {comp_name}</title>\n{link}  <link rel=\"stylesheet\" href=\"layout.css\">\n  <style>html,body{{margin:0}}body{{background:{body_bg}}}.region{{box-sizing:border-box}}.region.text p{{white-space:pre-wrap}}</style>\n</head>\n<body>\n<!-- Reference only. Every region sits at its measured box inside a comp-aspect frame. Take the boxes (layout.css), keep your own semantic structure. -->\n<main class=\"comp-frame\" style=\"max-width:{w}px\">\n{}\n</main>\n</body>\n</html>\n",
        body_parts.join("\n")
    );
    let html_path = format!("{dir}/hero-reference.html");
    let _ = std::fs::write(abs(io, &html_path), &html);
    Scaffold { dir, css: css_path, html: html_path }
}

fn encode_family(fam: &str) -> String {
    // encodeURIComponent(fam).replace(/%20/g, '+')
    let mut out = String::new();
    for ch in fam.chars() {
        if ch == ' ' {
            out.push('+');
        } else if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | '!' | '~' | '*' | '\'' | '(' | ')') {
            out.push(ch);
        } else {
            let mut buf = [0u8; 4];
            for b in ch.encode_utf8(&mut buf).bytes() {
                out.push_str(&format!("%{b:02X}"));
            }
        }
    }
    out
}

// ---- hero readings ---------------------------------------------------------

fn region_struct(rr: &Value) -> Region {
    let chosen = rr.pointer("/type/chosen").filter(|v| !v.is_null()).map(|c| Chosen {
        family: c.get("family").and_then(Value::as_str).unwrap_or("").to_string(),
        weight: util::fmt_value(c.get("weight").unwrap_or(&Value::Null)),
        font_size_px: util::fmt_value(c.get("fontSizePx").unwrap_or(&Value::Null)),
    });
    Region {
        id: rr.get("id").and_then(Value::as_str).unwrap_or("").to_string(),
        kind: rr.get("kind").and_then(Value::as_str).unwrap_or("").to_string(),
        chosen,
    }
}

struct HeroReadings {
    text: Vec<String>,
    chrome: Vec<String>,
    plates: Vec<String>,
    invented: Value,
}

fn hero_readings(io: &Io, state: &Value, spec: Option<&Value>, build_path: &str) -> Option<HeroReadings> {
    let spec = spec?;
    let comp_path = state.get("comp").and_then(Value::as_str)?;
    let comp = load_raster(io, comp_path).ok()?;
    let build = load_raster(io, build_path).ok()?;
    let mut aligned = align_build(&comp, &build, "top");
    let shift = best_shift(&comp, &aligned, 256);
    if shift.dx != 0 || shift.dy != 0 {
        let mut shifted = r::create_image(aligned.width, aligned.height, [255, 255, 255, 255]);
        r::blit(&mut shifted, &aligned, -shift.dx as f64, -shift.dy as f64);
        aligned = shifted;
    }
    let mut text: Vec<String> = Vec::new();
    let mut chrome: Vec<String> = Vec::new();
    let mut plates: Vec<String> = Vec::new();
    for rr in spec_regions(spec) {
        let px = rr.get("px");
        if px.is_none() {
            continue;
        }
        let pxf = |k: &str| rr.pointer(&format!("/px/{k}")).and_then(Value::as_f64).unwrap_or(0.0);
        let a = r::crop(&comp, pxf("x"), pxf("y"), pxf("w"), pxf("h"));
        let b = r::crop(&aligned, pxf("x"), pxf("y"), pxf("w"), pxf("h"));
        let kind = rr.get("kind").and_then(Value::as_str).unwrap_or("");
        let region = region_struct(&rr);
        if kind == "text" {
            let t = text_region_check(&region, &a, &b);
            for f in t.get("findings").and_then(Value::as_array).cloned().unwrap_or_default() {
                if let Some(s) = f.as_str() {
                    text.push(s.to_string());
                }
            }
        } else if kind == "chrome" || kind == "control" {
            let cc = chrome_strip_check(&region, &a, &b);
            for f in cc.get("findings").and_then(Value::as_array).cloned().unwrap_or_default() {
                if let Some(s) = f.as_str() {
                    chrome.push(s.to_string());
                }
            }
        } else if kind == "plate" || kind == "image" {
            let cc = plate_clip_check(&region, &a, &b);
            let sides = cc.get("sides").and_then(Value::as_array).cloned().unwrap_or_default();
            if !sides.is_empty() {
                let id = rr.get("id").and_then(Value::as_str).unwrap_or("");
                let sides_str = sides.iter().filter_map(|v| v.as_str()).collect::<Vec<_>>().join(" and ");
                let cx = cc.pointer("/comp/x").map(util::fmt_value).unwrap_or_default();
                let cy = cc.pointer("/comp/y").map(util::fmt_value).unwrap_or_default();
                let cw = cc.pointer("/comp/w").map(util::fmt_value).unwrap_or_default();
                let ch = cc.pointer("/comp/h").map(util::fmt_value).unwrap_or_default();
                let bx = cc.pointer("/build/x").map(util::fmt_value).unwrap_or_default();
                let byv = cc.pointer("/build/y").map(util::fmt_value).unwrap_or_default();
                let bw = cc.pointer("/build/w").map(util::fmt_value).unwrap_or_default();
                let bh = cc.pointer("/build/h").map(util::fmt_value).unwrap_or_default();
                plates.push(format!(
                    "plate {id} is clipped at the {sides_str}: the comp's artwork keeps a margin there (ink box {cw}x{ch} at {cx},{cy} in the region) and the build's runs to the edge ({bw}x{bh} at {bx},{byv}); size the box to the artwork's aspect and use object-fit: contain, or place the <img> at the artwork's own size, never cover on a narrower box"
                ));
            }
        }
    }
    let invented = invented_ink(&comp, &aligned);
    Some(HeroReadings { text, chrome, plates, invented })
}

// ---- hero gate -------------------------------------------------------------

fn pct0(v: f64) -> String {
    to_fixed(v * 100.0, 0)
}
fn pct1(v: f64) -> String {
    to_fixed(v * 100.0, 1)
}

fn rscore(r: &Value, k: &str) -> f64 {
    r.pointer(&format!("/score/{k}")).and_then(Value::as_f64).unwrap_or(0.0)
}
fn rscore_opt(r: &Value, k: &str) -> Option<f64> {
    r.pointer(&format!("/score/{k}")).and_then(Value::as_f64)
}

/// Run comp-diff in-process (JS spawned comp-diff.mjs --json), returning its report.
fn hero_diff(io: &Io, comp_path: &str, build_path: &str, spec: Option<&Value>, out_dir: &str) -> Result<Value, String> {
    let comp = load_raster(io, comp_path)?;
    let build = load_raster(io, build_path)?;
    let res = compare(&comp, &build, spec, "top", "hero", None);
    let files = write_artifacts(&res, &comp, &abs(io, out_dir));
    let meta = json!({
        "label": "hero",
        "comp": comp_path,
        "build": build_path,
        "spec": if spec.is_some() { Value::String(SPEC_PATH.into()) } else { Value::Null },
        "compSize": format!("{}x{}", comp.width, comp.height),
        "buildSize": format!("{}x{}", build.width, build.height),
    });
    let report = build_report(&res, Some(&files), &meta);
    let _ = std::fs::write(abs(io, &format!("{out_dir}/report.json")), util::json_pretty(&report));
    Ok(report)
}

#[allow(clippy::too_many_arguments)]
fn gate_hero(io: &Io, state: &mut Value, build_path: &str, min: f64, out_dir: &str, artifact: Option<&str>, organic_scan: OrganicScan) -> Gate {
    if !abs(io, build_path).exists() {
        let bp = state.get("breakpoint").and_then(Value::as_str).map(String::from).unwrap_or_else(|| "comp size".into());
        return Gate::fail(vec![format!("no hero capture at {build_path}: screenshot the first viewport at the comp's own dimensions ({bp}) into that path")]);
    }
    let spec_for_refs = load_spec(&abs(io, SPEC_PATH));
    // resolve the page
    let mut page_file: Option<String> = artifact.map(String::from).or_else(|| state.get("artifact").and_then(Value::as_str).map(String::from));
    if page_file.as_ref().map(|p| !abs(io, p).exists()).unwrap_or(true) {
        if abs(io, "index.html").exists() {
            page_file = Some("index.html".into());
        } else if let Ok(entries) = std::fs::read_dir(&io.cwd) {
            let htmls: Vec<String> = entries
                .filter_map(|e| e.ok().map(|e| e.file_name().to_string_lossy().to_string()))
                .filter(|n| {
                    let l = n.to_lowercase();
                    l.ends_with(".html") || l.ends_with(".htm")
                })
                .collect();
            if htmls.len() == 1 {
                page_file = Some(htmls[0].clone());
            } else {
                page_file = None;
            }
        }
    }
    let page_exists = page_file.as_ref().map(|p| abs(io, p).exists()).unwrap_or(false);
    let unreferenced = unreferenced_plates(io, spec_for_refs.as_ref(), if page_exists { page_file.as_deref() } else { None });
    if !unreferenced.is_empty() {
        return Gate::fail(
            unreferenced
                .iter()
                .map(|r| {
                    let plate = r.get("plate").and_then(Value::as_str).unwrap_or("");
                    let id = r.get("id").and_then(Value::as_str).unwrap_or("");
                    format!("plate {plate} (region {id}) is not referenced by any source file this scan can see: the page draws that region in code while the produced plate sits unused. Place the plate (an <img>, a background-image, or an inlined data URI named for it) and recapture. If the plate IS referenced from a file the scan missed (your page is not index.html, or the reference lives in a stylesheet outside the project walk), re-run with --artifact <your page>: its linked stylesheets are followed exactly.")
                })
                .collect(),
        );
    }
    let comp_path = state.get("comp").and_then(Value::as_str).unwrap_or("").to_string();
    let report = match hero_diff(io, &comp_path, build_path, spec_for_refs.as_ref(), out_dir) {
        Ok(r) => r,
        Err(e) => return Gate::fail(vec![format!("comp-diff failed: {e}")]),
    };
    let mut regions: Vec<Value> = report.get("regions").and_then(Value::as_array).cloned().unwrap_or_default();
    let mut reasons: Vec<String> = Vec::new();
    let mut advisories: Vec<String> = Vec::new();
    let overall = report.get("overall").and_then(Value::as_f64).unwrap_or(0.0);
    let sc = |k: &str| report.pointer(&format!("/scores/{k}")).and_then(Value::as_f64).unwrap_or(0.0);
    // capture-frame check
    let parse_dim = |s: &str| -> (Option<f64>, Option<f64>) {
        let mut it = s.split('x');
        (it.next().and_then(|v| v.parse().ok()), it.next().and_then(|v| v.parse().ok()))
    };
    let (cw, ch) = parse_dim(report.get("compSize").and_then(Value::as_str).unwrap_or(""));
    let (bw, bh) = parse_dim(report.get("buildSize").and_then(Value::as_str).unwrap_or(""));
    if let (Some(cw), Some(ch), Some(bw), Some(bh)) = (cw, ch, bw, bh) {
        let comp_aspect = cw / ch;
        let build_aspect = bw / bh;
        if bw < cw * 0.9 || (build_aspect - comp_aspect).abs() / comp_aspect > 0.08 {
            reasons.push(format!(
                "hero capture is {}x{}; the comp is {}x{}. Capture the first viewport at the comp's own dimensions (viewport {}x{}, not full page) into {build_path}.",
                bw as i64, bh as i64, cw as i64, ch as i64, cw as i64, ch as i64
            ));
        }
    }
    let above_bar = overall >= min;
    if !above_bar {
        reasons.push(format!(
            "hero overall {}% < {}% (structure {}%, color {}%, detail {}%)",
            pct1(overall), pct0(min), pct0(sc("structure")), pct0(sc("color")), pct0(sc("detail"))
        ));
    }
    if sc("colorIntersection") < 0.2 {
        let comp_pal = report.pointer("/palette/comp").and_then(Value::as_array).cloned().unwrap_or_default();
        let build_pal = report.pointer("/palette/build").and_then(Value::as_array).cloned().unwrap_or_default();
        let hexes = |a: &[Value]| a.iter().take(3).filter_map(|c| c.get("hex").and_then(Value::as_str)).collect::<Vec<_>>().join(" ");
        reasons.push(format!(
            "the palette is not the comp's (color intersection {}%): comp {} vs build {}. Use the spec's sampled palette values, not a rendition of them.",
            pct0(sc("colorIntersection")), hexes(&comp_pal), hexes(&build_pal)
        ));
    }
    let spec_regions_v: Vec<Value> = spec_for_refs.as_ref().map(spec_regions).unwrap_or_default();
    let overlaps = |a: &Value, b: &Value| -> bool {
        let ab = |v: &Value, k: &str| v.pointer(&format!("/box/{k}")).and_then(Value::as_f64).unwrap_or(0.0);
        ab(a, "x") < ab(b, "x") + ab(b, "w") && ab(b, "x") < ab(a, "x") + ab(a, "w") && ab(a, "y") < ab(b, "y") + ab(b, "h") && ab(b, "y") < ab(a, "y") + ab(a, "h")
    };
    let verdict_of: std::collections::HashMap<String, String> = regions
        .iter()
        .filter_map(|r| Some((r.get("id")?.as_str()?.to_string(), r.get("verdict")?.as_str()?.to_string())))
        .collect();
    // missing (with texture-ink-present demotion), mutating verdicts
    let mut missing_ids: Vec<String> = Vec::new();
    for r in regions.iter_mut() {
        if r.get("verdict").and_then(Value::as_str) != Some("missing") {
            continue;
        }
        let id = r.get("id").and_then(Value::as_str).unwrap_or("").to_string();
        let kind = r.get("kind").and_then(Value::as_str).unwrap_or("").to_string();
        if kind != "texture" {
            missing_ids.push(id);
            continue;
        }
        let me = spec_regions_v.iter().find(|x| x.get("id").and_then(Value::as_str) == Some(&id));
        let Some(me) = me else {
            missing_ids.push(id);
            continue;
        };
        let ink_over: Vec<&Value> = spec_regions_v
            .iter()
            .filter(|x| {
                let xid = x.get("id").and_then(Value::as_str);
                let xk = x.get("kind").and_then(Value::as_str).unwrap_or("");
                xid != Some(&id) && (xk == "text" || xk == "control" || xk == "chrome") && overlaps(me, x)
            })
            .collect();
        let ink_present = !ink_over.is_empty()
            && ink_over.iter().all(|x| {
                let xid = x.get("id").and_then(Value::as_str).unwrap_or("");
                verdict_of.get(xid).map(|v| v != "missing").unwrap_or(false)
            });
        if ink_present {
            r["verdict"] = json!("drift");
        } else {
            missing_ids.push(id);
        }
    }
    // passed-plate placement notes
    let passed_plate = |id: &str| -> bool {
        state
            .pointer(&format!("/plates/{id}"))
            .map(|p| {
                p.get("status").and_then(Value::as_str) == Some("ok")
                    && p.get("score").map(|s| s.is_null() || s.as_f64().map(|v| v >= PLATE_MIN).unwrap_or(false)).unwrap_or(true)
            })
            .unwrap_or(false)
    };
    let mut placement_notes: Vec<String> = Vec::new();
    for r in regions.iter_mut() {
        let kind = r.get("kind").and_then(Value::as_str).unwrap_or("").to_string();
        let id = r.get("id").and_then(Value::as_str).unwrap_or("").to_string();
        if !(kind == "plate" || kind == "image" || kind == "texture") || !passed_plate(&id) {
            continue;
        }
        let verdict = r.get("verdict").and_then(Value::as_str).unwrap_or("");
        if verdict != "missing" && verdict != "contradicted" {
            continue;
        }
        let present = if kind == "texture" {
            rscore(r, "structure") >= 0.85 && rscore(r, "color") >= 0.6
        } else {
            rscore_opt(r, "detailRaw").map(|v| v >= 0.3).unwrap_or(rscore(r, "detail") >= 0.3)
        };
        if !present {
            continue;
        }
        r["verdict"] = json!("drift");
        r["placed"] = json!(true);
        let ic = r.pointer("/inkBox/comp").cloned().unwrap_or(Value::Null);
        let ib = r.pointer("/inkBox/build").cloned().unwrap_or(Value::Null);
        if !ic.is_null() && !ib.is_null() {
            let cf = |v: &Value, k: &str| v.get(k).and_then(Value::as_f64).unwrap_or(0.0);
            let (cw_, ch_, cx, cy) = (cf(&ic, "w"), cf(&ic, "h"), cf(&ic, "x"), cf(&ic, "y"));
            let (bw_, bh_, bx, by) = (cf(&ib, "w"), cf(&ib, "h"), cf(&ib, "x"), cf(&ib, "y"));
            let off = (bw_ - cw_).abs() > cw_ * 0.2 || (bh_ - ch_).abs() > ch_ * 0.2 || (bx - cx).abs() > cw_ * 0.15 || (by - cy).abs() > ch_ * 0.15;
            if off {
                placement_notes.push(format!(
                    "plate {id} is placed but not at the comp's box: its ink spans {}x{}px at ({},{}) in the comp region and {}x{}px at ({},{}) in the build; size and position the <img> to the spec box (object-fit: cover), not to the surrounding layout",
                    cw_ as i64, ch_ as i64, cx as i64, cy as i64, bw_ as i64, bh_ as i64, bx as i64, by as i64
                ));
            }
        }
    }
    for id in &missing_ids {
        if let Some(r) = regions.iter().find(|r| r.get("id").and_then(Value::as_str) == Some(id.as_str())) {
            if r.get("verdict").and_then(Value::as_str) == Some("missing") {
                reasons.push(format!(
                    "region {id} is missing (detail {}%, structure {}%): the comp shows material the build does not",
                    pct0(rscore(r, "detail")), pct0(rscore(r, "structure"))
                ));
            }
        }
    }
    for n in placement_notes {
        if above_bar {
            advisories.push(format!("(advisory, above the {}% bar) {n}", pct0(min)));
        } else {
            reasons.push(n);
        }
    }
    // contradicted
    let contradicted: Vec<Value> = regions.iter().filter(|r| r.get("verdict").and_then(Value::as_str) == Some("contradicted")).cloned().collect();
    let direction_contradicted: Vec<Value> = contradicted
        .iter()
        .filter(|r| matches!(r.get("kind").and_then(Value::as_str), Some("plate") | Some("image") | Some("text") | Some("control")))
        .cloned()
        .collect();
    for r in &direction_contradicted {
        let id = r.get("id").and_then(Value::as_str).unwrap_or("");
        let kind = r.get("kind").and_then(Value::as_str).unwrap_or("");
        let tail = if kind == "text" {
            "the composition of this text region differs from the comp; re-derive it from the spec box".to_string()
        } else if kind == "control" {
            "this control does not read as the comp's: rebuild its chrome from the crop (border, fill, radius, chevron or arrow, label size) rather than from a component default".to_string()
        } else {
            format!("the plate here does not read as the comp region; regenerate it with the crop as reference (generate-image.mjs --plate {id}) and place it at its box")
        };
        reasons.push(format!(
            "region {id} ({kind}) is contradicted (structure {}%, detail added {}%): {tail}",
            pct0(rscore(r, "structure")), pct0(rscore(r, "detailAdded"))
        ));
    }
    for r in &regions {
        if r.get("kind").and_then(Value::as_str) != Some("control") || r.get("verdict").and_then(Value::as_str) != Some("drift") || rscore(r, "overall") >= 0.65 {
            continue;
        }
        let id = r.get("id").and_then(Value::as_str).unwrap_or("");
        reasons.push(format!(
            "control {id} drifts to {}% (structure {}%, color {}%): its chrome differs from the comp's; open {} and match the border, fill, radius, chevron or arrow, and label size",
            pct0(rscore(r, "overall")), pct0(rscore(r, "structure")), pct0(rscore(r, "color")),
            format!("{out_dir}/regions/{id}.png")
        ));
    }
    // control ink boxes
    for r in &regions {
        if r.get("kind").and_then(Value::as_str) != Some("control") {
            continue;
        }
        let ic = r.pointer("/inkBox/comp").cloned().unwrap_or(Value::Null);
        let ib = r.pointer("/inkBox/build").cloned().unwrap_or(Value::Null);
        if ic.is_null() || ib.is_null() {
            continue;
        }
        let rw_n = r.get("w").and_then(Value::as_f64).or_else(|| r.pointer("/box/w").and_then(Value::as_f64)).unwrap_or(1.0);
        let rh_n = r.get("h").and_then(Value::as_f64).or_else(|| r.pointer("/box/h").and_then(Value::as_f64)).unwrap_or(1.0);
        let cs_w = report.get("compSize").and_then(Value::as_str).and_then(|s| s.split('x').next()).and_then(|v| v.parse::<f64>().ok()).unwrap_or(1536.0);
        let cs_h = report.get("compSize").and_then(Value::as_str).and_then(|s| s.split('x').nth(1)).and_then(|v| v.parse::<f64>().ok()).unwrap_or(1024.0);
        let rw = rw_n * cs_w;
        let rh = rh_n * cs_h;
        let cf = |v: &Value, k: &str| v.get(k).and_then(Value::as_f64).unwrap_or(0.0);
        if cf(&ic, "w") >= rw * 0.85 || cf(&ic, "h") >= rh * 0.85 {
            continue;
        }
        let dh = cf(&ib, "h") - cf(&ic, "h");
        let dw = cf(&ib, "w") - cf(&ic, "w");
        if cf(&ib, "w") >= rw * 0.98 || cf(&ib, "h") >= rh * 0.98 {
            continue;
        }
        if dh.abs() > 6f64.max(cf(&ic, "h") * 0.15) || dw.abs() > 12f64.max(cf(&ic, "w") * 0.15) {
            let id = r.get("id").and_then(Value::as_str).unwrap_or("");
            let msg = format!(
                "region {id}: its ink sits in a {}x{}px box in the comp and {}x{}px in the build (padding, row height, or size); match the box, not only the position",
                cf(&ic, "w") as i64, cf(&ic, "h") as i64, cf(&ib, "w") as i64, cf(&ib, "h") as i64
            );
            if above_bar {
                advisories.push(format!("(advisory, above the {}% bar) {msg}", pct0(min)));
            } else {
                reasons.push(msg);
            }
        }
    }
    let other_contradicted: Vec<&Value> = contradicted.iter().filter(|r| !direction_contradicted.iter().any(|d| d.get("id") == r.get("id"))).collect();
    let allow = 1usize.max(regions.len() / 3);
    if other_contradicted.len() > allow {
        reasons.push(format!(
            "{} of {} regions contradicted: {}",
            other_contradicted.len(),
            regions.len(),
            other_contradicted.iter().filter_map(|r| r.get("id").and_then(Value::as_str)).collect::<Vec<_>>().join(", ")
        ));
    }
    // organic clip + svg illustrations
    let artifact_file = page_file.clone();
    if let (Some(af), Some(spec)) = (&artifact_file, &spec_for_refs) {
        if abs(io, af).exists() {
            for o in organic_clip_regions(io, af, spec, organic_scan) {
                let id = o.get("id").and_then(Value::as_str).unwrap_or("");
                let snip = o.get("snippet").and_then(Value::as_str).unwrap_or("");
                reasons.push(format!("artifact draws an organic clip-path ({snip}) inside raster region {id}'s box; that region ships as its plate, never as a polygon"));
            }
            let svgs = std::fs::read_to_string(abs(io, af)).map(|h| svg_illustrations(&h)).unwrap_or_default();
            for v in svgs.iter().take(6) {
                let label = v.get("label").and_then(Value::as_str).filter(|s| !s.is_empty()).map(|l| format!(" ({l})")).unwrap_or_default();
                let snip = v.get("snippet").and_then(Value::as_str).unwrap_or("");
                reasons.push(format!("artifact draws an illustration in inline SVG{label}: {snip}. Drawings, diagrams, notation, and leader lines are plates or belong to the plate they annotate; only icon-sized SVG (under 64px, a few paths) is code"));
            }
            if svgs.len() > 6 {
                reasons.push(format!("...and {} more inline SVG illustrations", svgs.len() - 6));
            }
        }
    }
    // readings
    let readings = hero_readings(io, state, spec_for_refs.as_ref(), build_path);
    if readings.is_none() {
        // JS wraps in try/catch; a None here means comp/build unreadable — the
        // JS would have thrown and pushed the errored message. Reading succeeds
        // in practice when the diff above succeeded, so treat None as "no readings".
    }
    if let Some(readings) = readings {
        use once_cell::sync::Lazy;
        static FOLD: Lazy<regex::Regex> = Lazy::new(|| Regex::new(r"(?i)^text ([a-z0-9]+(?:-[a-z0-9]+)*?)(?:-(?:\d+|[a-z]))?: (cap height|\d+ lines? in the build|the face renders|ink is|its first line|it starts|line pitch)").unwrap());
        static IDM: Lazy<regex::Regex> = Lazy::new(|| Regex::new(r"^text ([^:]+):").unwrap());
        static CAP: Lazy<regex::Regex> = Lazy::new(|| Regex::new(r"cap height").unwrap());
        static LINES: Lazy<regex::Regex> = Lazy::new(|| Regex::new(r"lines? in the build").unwrap());
        static HEAV: Lazy<regex::Regex> = Lazy::new(|| Regex::new(r"heavier|lighter").unwrap());
        static INKIS: Lazy<regex::Regex> = Lazy::new(|| Regex::new(r"ink is").unwrap());
        static NUM: Lazy<regex::Regex> = Lazy::new(|| Regex::new(r"\d+").unwrap());
        let order = |f: &str| -> u8 {
            if CAP.is_match(f) { 0 } else if LINES.is_match(f) { 1 } else if HEAV.is_match(f) { 2 } else if INKIS.is_match(f) { 3 } else { 4 }
        };
        // fold sibling text findings
        let mut folded: Vec<(String, String, Vec<String>)> = Vec::new(); // (key, first, ids)
        for f in &readings.text {
            let key = if let Some(m) = FOLD.captures(f) {
                format!("{}|{}", &m[1], NUM.replace_all(&m[2], "N"))
            } else {
                f.clone()
            };
            let idm = IDM.captures(f).map(|m| m[1].to_string());
            if let Some(entry) = folded.iter_mut().find(|(k, _, _)| *k == key) {
                if let Some(id) = idm {
                    entry.2.push(id);
                }
            } else {
                let ids = idm.map(|id| vec![id]).unwrap_or_default();
                folded.push((key, f.clone(), ids));
            }
        }
        let mut text: Vec<String> = folded
            .into_iter()
            .map(|(_, first, ids)| {
                if ids.len() > 1 {
                    format!("{first} (also {})", ids[1..].join(", "))
                } else {
                    first
                }
            })
            .collect();
        text.sort_by_key(|a| order(a));
        // staleness
        let seen = state
            .pointer_mut("/phases/hero")
            .and_then(|h| h.as_object_mut())
            .map(|h| h.entry("readingsSeen").or_insert_with(|| json!({})))
            .unwrap();
        let seen_map = seen.as_object_mut().unwrap();
        let mut stale = |f: &str| -> bool {
            let k = {
                use once_cell::sync::Lazy;
                static WS: Lazy<regex::Regex> = Lazy::new(|| Regex::new(r"\s+").unwrap());
                WS.replace_all(f, " ").trim().to_string()
            };
            let n = seen_map.get(&k).and_then(Value::as_i64).unwrap_or(0) + 1;
            seen_map.insert(k, json!(n));
            n > 3
        };
        let all: Vec<String> = text.iter().cloned().chain(readings.chrome.iter().cloned()).collect();
        let mut fresh: Vec<String> = Vec::new();
        let mut advisory_stale: Vec<String> = Vec::new();
        for f in &all {
            if stale(f) {
                advisory_stale.push(f.clone());
            } else {
                fresh.push(f.clone());
            }
        }
        let kept: Vec<String> = fresh.iter().take(8).cloned().collect();
        if above_bar {
            if !kept.is_empty() {
                advisories.push(format!("(advisory, above the {}% bar; fix in the polish pass before responsive) {} reading{}:", pct0(min), kept.len(), if kept.len() == 1 { "" } else { "s" }));
            }
            for f in &kept {
                advisories.push(format!("  {f}"));
            }
        } else {
            if !kept.is_empty() {
                let of = if fresh.len() > kept.len() { format!("{} of {}, the rest after these", kept.len(), fresh.len()) } else { format!("{}", kept.len()) };
                reasons.push(format!("READINGS, each one CSS edit ({of}):"));
            }
            for f in &kept {
                reasons.push(f.clone());
            }
        }
        for f in &advisory_stale {
            advisories.push(format!("(advisory, unchanged for 3+ attempts) {f}"));
        }
        for f in &readings.plates {
            reasons.push(f.clone());
        }
        let cells = readings.invented.get("cells").and_then(Value::as_array).cloned().unwrap_or_default();
        let fraction = readings.invented.get("fraction").and_then(Value::as_f64).unwrap_or(0.0);
        let strong_cells = cells.iter().filter(|c| c.get("build").and_then(Value::as_f64).unwrap_or(0.0) >= 22.0).count();
        if fraction >= INVENTED_MIN || strong_cells >= 2 {
            let labels: Vec<String> = cells.iter().filter_map(|c| c.get("label").and_then(Value::as_str).map(String::from)).collect();
            let shown = labels.iter().take(12).cloned().collect::<Vec<_>>().join(", ");
            let more = if labels.len() > 12 { ", ..." } else { "" };
            reasons.push(format!(
                "the build carries ink in {} grid cells where the comp is calm ({shown}{more}); nothing exists on the page that the comp does not show (a kicker, an extra nav item, a divider, a second row of controls); remove it or name it in a stated decision after the hero passes",
                labels.len()
            ));
        }
    }
    // worst regions
    let mut worst_sorted = regions.clone();
    worst_sorted.sort_by(|a, b| rscore(a, "overall").partial_cmp(&rscore(b, "overall")).unwrap());
    let worst_top: Vec<&Value> = worst_sorted.iter().take(3).collect();
    let region_dir = format!("{out_dir}/regions");
    let mut g = Gate::blank();
    g.ok = reasons.is_empty();
    g.reasons = reasons;
    g.summary = Some(format!("hero {}% ({})", pct0(overall), report.get("verdict").and_then(Value::as_str).unwrap_or("")));
    g.score = Some(overall);
    g.verdict = report.get("verdict").and_then(Value::as_str).map(String::from);
    g.report = Some(format!("{out_dir}/report.json"));
    g.side_by_side = report.pointer("/files/sideBySide").and_then(Value::as_str).map(String::from);
    g.worst = worst_top
        .iter()
        .map(|r| format!("{} {} {}%", r.get("id").and_then(Value::as_str).unwrap_or(""), r.get("verdict").and_then(Value::as_str).unwrap_or(""), pct0(rscore(r, "overall"))))
        .collect();
    g.worst_ids = worst_top.iter().filter_map(|r| r.get("id").and_then(Value::as_str).map(String::from)).collect();
    g.worst_crops = worst_top
        .iter()
        .map(|r| {
            let id = r.get("id").and_then(Value::as_str).unwrap_or("");
            json!({ "id": id, "verdict": r.get("verdict").and_then(Value::as_str).unwrap_or(""), "score": r.get("score").cloned().unwrap_or(Value::Null), "file": format!("{region_dir}/{id}.png") })
        })
        .collect();
    g.advisories = advisories;
    g.region_verdicts = regions
        .iter()
        .filter_map(|r| Some((r.get("id")?.as_str()?.to_string(), json!(r.get("verdict")?.as_str()?))))
        .collect();
    g
}

/// JS: heroLoopVerdict(state, gate, artifactPath).
fn hero_loop_verdict(state: &mut Value, gate: &Gate, artifact_path: &str, io: &Io) -> Option<String> {
    let hero = state.pointer_mut("/phases/hero")?.as_object_mut()?;
    let mut history: Vec<Value> = hero.get("history").and_then(Value::as_array).cloned().unwrap_or_default();
    let entry = json!({
        "at": now(),
        "score": gate.score.map(util::num).unwrap_or(Value::Null),
        "worstIds": gate.worst_ids,
        "regionVerdicts": Value::Object(gate.region_verdicts.clone()),
        "artifactHash": hash_file(io, artifact_path).map(Value::from).unwrap_or(Value::Null),
    });
    history.push(entry);
    let start = history.len().saturating_sub(6);
    let trimmed: Vec<Value> = history[start..].to_vec();
    hero.insert("history".into(), json!(trimmed.clone()));
    if history.len() < 3 {
        return None;
    }
    let last3 = &history[history.len() - 3..];
    let first_worst = last3[0].pointer("/worstIds/0").and_then(Value::as_str);
    let stuck = first_worst.is_some() && last3.iter().all(|h| h.pointer("/worstIds/0").and_then(Value::as_str) == first_worst);
    let scores: Vec<f64> = last3.iter().map(|h| h.get("score").and_then(Value::as_f64).unwrap_or(0.0)).collect();
    let no_progress = scores.iter().cloned().fold(f64::MIN, f64::max) - scores.iter().cloned().fold(f64::MAX, f64::min) < 0.03;
    if stuck && no_progress {
        let w = first_worst.unwrap();
        return Some(format!(
            "region {w} has been the worst region for three attempts and the score moved less than 3 points: value edits are not reaching it. Open {} and rebuild that region from the comp crop (place its plate, or produce one with generate-image.mjs --plate, or re-derive its structure from the spec box), then recapture.",
            format!(".impeccable/review/diff/hero/regions/{w}.png")
        ));
    }
    None
}

fn hash_file(io: &Io, file: &str) -> Option<String> {
    use sha1::{Digest, Sha1};
    let data = std::fs::read(abs(io, file)).ok()?;
    let mut h = Sha1::new();
    h.update(&data);
    let d = h.finalize();
    Some(d.iter().map(|b| format!("{b:02x}")).collect::<String>()[..12].to_string())
}

fn gate_responsive(io: &Io, state: &Value, min: f64, out_dir: &str) -> Gate {
    let desktop = ".impeccable/review/desktop.png";
    let mobile = ".impeccable/review/mobile.png";
    let mut reasons = Vec::new();
    if !abs(io, desktop).exists() {
        reasons.push(format!("no {desktop}: capture the page at a common desktop width (1440 wide, full page) into that path"));
    }
    if !abs(io, mobile).exists() {
        reasons.push(format!("no {mobile}: capture the page at 390 wide, full page, into that path"));
    }
    if !reasons.is_empty() {
        return Gate::fail(reasons);
    }
    let spec = load_spec(&abs(io, SPEC_PATH));
    let comp_path = state.get("comp").and_then(Value::as_str).unwrap_or("");
    let report = match hero_diff_labeled(io, comp_path, desktop, spec.as_ref(), out_dir, "desktop") {
        Ok(r) => r,
        Err(e) => return Gate::fail(vec![format!("comp-diff failed on {desktop}: {e}")]),
    };
    let regions: Vec<Value> = report.get("regions").and_then(Value::as_array).cloned().unwrap_or_default();
    let missing: Vec<&Value> = regions
        .iter()
        .filter(|r| {
            if r.get("verdict").and_then(Value::as_str) != Some("missing") || r.get("kind").and_then(Value::as_str) == Some("texture") {
                return false;
            }
            let id = r.get("id").and_then(Value::as_str).unwrap_or("");
            let passed = state.pointer(&format!("/plates/{id}/status")).and_then(Value::as_str) == Some("ok");
            let kind = r.get("kind").and_then(Value::as_str).unwrap_or("");
            if (kind == "plate" || kind == "image") && passed {
                let present = rscore_opt(r, "detailRaw").map(|v| v >= 0.3).unwrap_or(rscore(r, "detail") >= 0.3);
                if present && rscore(r, "structure") >= 0.5 {
                    return false;
                }
            }
            true
        })
        .collect();
    let contradicted_direction: Vec<&Value> = regions.iter().filter(|r| r.get("verdict").and_then(Value::as_str) == Some("contradicted") && r.get("kind").and_then(Value::as_str) == Some("text")).collect();
    let overall = report.get("overall").and_then(Value::as_f64).unwrap_or(0.0);
    let mut reasons = Vec::new();
    if overall < min {
        let bp = state.get("breakpoint").and_then(Value::as_str).map(String::from).unwrap_or_else(|| "the comp size".into());
        reasons.push(format!(
            "the desktop capture ({}; the top {} rows scaled to the comp's width are compared, a full-page capture is fine) scores {}% against the comp, under {}%: the first viewport does not survive a common desktop width. The hero passed at {bp}; the layout must hold from ~1280 up, not only at the comp's exact width (grid columns in fr / minmax, not fixed px that overflow and wrap).",
            report.get("buildSize").and_then(Value::as_str).unwrap_or(""),
            report.get("compSize").and_then(Value::as_str).unwrap_or(""),
            pct0(overall), pct0(min)
        ));
    }
    for r in &missing {
        reasons.push(format!("at desktop width, region {} is missing", r.get("id").and_then(Value::as_str).unwrap_or("")));
    }
    for r in &contradicted_direction {
        reasons.push(format!(
            "at desktop width, region {} ({}) is contradicted (structure {}%)",
            r.get("id").and_then(Value::as_str).unwrap_or(""),
            r.get("kind").and_then(Value::as_str).unwrap_or(""),
            pct0(rscore(r, "structure"))
        ));
    }
    let mut g = if reasons.is_empty() { Gate::ok(format!("desktop {}% ({})", pct0(overall), report.get("verdict").and_then(Value::as_str).unwrap_or(""))) } else { Gate::fail(reasons) };
    g.summary = Some(format!("desktop {}% ({})", pct0(overall), report.get("verdict").and_then(Value::as_str).unwrap_or("")));
    g.score = Some(overall);
    g.side_by_side = report.pointer("/files/sideBySide").and_then(Value::as_str).map(String::from);
    g
}

fn hero_diff_labeled(io: &Io, comp_path: &str, build_path: &str, spec: Option<&Value>, out_dir: &str, label: &str) -> Result<Value, String> {
    let comp = load_raster(io, comp_path)?;
    let build = load_raster(io, build_path)?;
    let res = compare(&comp, &build, spec, "top", label, None);
    let files = write_artifacts(&res, &comp, &abs(io, out_dir));
    let meta = json!({
        "label": label, "comp": comp_path, "build": build_path,
        "spec": if spec.is_some() { Value::String(SPEC_PATH.into()) } else { Value::Null },
        "compSize": format!("{}x{}", comp.width, comp.height),
        "buildSize": format!("{}x{}", build.width, build.height),
    });
    let report = build_report(&res, Some(&files), &meta);
    let _ = std::fs::write(abs(io, &format!("{out_dir}/report.json")), util::json_pretty(&report));
    Ok(report)
}

// ---- transitions -----------------------------------------------------------

struct GateOpts {
    build_path: Option<String>,
    min: Option<f64>,
    artifact: Option<String>,
}

fn run_gate(io: &Io, state: &mut Value, phase: &str, opts: &GateOpts, organic_scan: OrganicScan) -> Gate {
    match phase {
        "comps" => gate_comps(io),
        "spec" => gate_spec(io, state),
        "plates" => gate_plates(io),
        "hero" => {
            let build_path = opts.build_path.clone().unwrap_or_else(|| HERO_REPRO.to_string());
            let min = opts.min.unwrap_or(HERO_MIN);
            gate_hero(io, state, &build_path, min, ".impeccable/review/diff/hero", opts.artifact.as_deref(), organic_scan)
        }
        "responsive" => gate_responsive(io, state, opts.min.unwrap_or(RESPONSIVE_MIN), ".impeccable/review/diff/desktop"),
        _ => Gate::ok("no mechanical gate".into()),
    }
}

/// JS: forceAllowed(reason).
fn force_allowed(reason: Option<&str>) -> bool {
    use once_cell::sync::Lazy;
    let Some(reason) = reason else { return false };
    if reason.trim().chars().count() < 20 {
        return false;
    }
    static ERRORED: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)gate \w+ errored").unwrap());
    if ERRORED.is_match(reason) {
        return true;
    }
    static NAMES_USER: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\buser\b|\bthey (said|asked|told|chose|picked)\b|\bpaul\b").unwrap());
    static ABOUT_COMP: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\b(comp|mock|mockup|composition|fidelity|plate|region)\b").unwrap());
    static TRANS1: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)truthful|semantic|pixel-level|prioriti[sz]e (facts|semantics|accessibility)").unwrap());
    static TRANS2: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)(drop|skip|remove|without|not needed|don't need|do not need|ignore) (the )?(comp|plate|region|fidelity)").unwrap());
    static DOWNGRADES: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\b(don't|do not|doesn't|does not|no longer|not) (need|have to|want|care|require|match|follow|hold)|\b(drop|skip|remove|ignore|waive|relax|override|approve|approved|accept|accepted|fine|okay|ok|good enough|ship it|move on|proceed|go ahead|instead of|rather than)\b").unwrap());
    static REPORTED: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?i)["'\u{201c}\u{2018}].{6,}["'\u{201d}\u{2019}]|\b(user|they|paul) (said|says|asked|asks|told|wrote|replied|answered|chose|picked|approved|confirmed)\b"#).unwrap());
    static BRIEF1: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\b(should feel|feel like|not a .* page|extension of)\b").unwrap());
    static BRIEF2: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\b(comp|mock|fidelity|gate|plate)\b.*\b(approved|accept|fine|ok|okay|skip|drop|waive|relax|override|move on|proceed)\b").unwrap());
    let names_user = NAMES_USER.is_match(reason);
    let about_comp = ABOUT_COMP.is_match(reason);
    let is_translation_dodge = TRANS1.is_match(reason) && !TRANS2.is_match(reason);
    let downgrades = DOWNGRADES.is_match(reason);
    let reported = REPORTED.is_match(reason);
    let brief_quote_only = BRIEF1.is_match(reason) && !BRIEF2.is_match(reason);
    names_user && about_comp && downgrades && reported && !is_translation_dodge && !brief_quote_only
}

struct AdvanceResult {
    ok: bool,
    phase: String,
    next: Option<String>,
    reasons: Vec<String>,
    worst_crops: Vec<Value>,
    advisories: Vec<String>,
    side_by_side: Option<String>,
    forced: bool,
    gate_summary: Option<String>,
}

fn phase_index(phase: &str) -> Option<usize> {
    PHASES.iter().position(|&p| p == phase)
}

fn advance(io: &Io, state: &mut Value, force: bool, reason: Option<&str>, opts: &GateOpts, organic_scan: OrganicScan) -> AdvanceResult {
    let phase = state.get("phase").and_then(Value::as_str).unwrap_or("").to_string();
    let idx = phase_index(&phase);
    if idx.is_none() || phase == "review" {
        return AdvanceResult {
            ok: false,
            phase: phase.clone(),
            next: None,
            reasons: vec![format!("phase {phase} cannot advance; use finish")],
            worst_crops: vec![],
            advisories: vec![],
            side_by_side: None,
            forced: false,
            gate_summary: None,
        };
    }
    let idx = idx.unwrap();
    if let Some(p) = state.pointer_mut(&format!("/phases/{phase}")).and_then(|p| p.as_object_mut()) {
        let a = p.get("attempts").and_then(Value::as_i64).unwrap_or(0) + 1;
        p.insert("attempts".into(), json!(a));
    }
    let mut gate = run_gate(io, state, &phase, opts, organic_scan);
    if let Some(p) = state.pointer_mut(&format!("/phases/{phase}")).and_then(|p| p.as_object_mut()) {
        p.insert("gate".into(), gate.record_json(&now()));
    }
    if phase == "plates" {
        if let Some(plates) = &gate.plates {
            let mut m = Map::new();
            for pl in plates {
                let id = pl.get("id").and_then(Value::as_str).unwrap_or("").to_string();
                m.insert(id, json!({ "status": pl.get("status").cloned().unwrap_or(Value::Null), "score": pl.get("score").cloned().unwrap_or(Value::Null), "size": pl.get("size").cloned().unwrap_or(Value::Null) }));
            }
            state.as_object_mut().unwrap().insert("plates".into(), Value::Object(m));
        }
    }
    if !gate.ok && force && !force_allowed(reason) {
        if let Some(p) = state.pointer_mut(&format!("/phases/{phase}")).and_then(|p| p.as_object_mut()) {
            p.insert("status".into(), json!("open"));
        }
        let mut reasons = gate.reasons.clone();
        reasons.push(format!(
            "--force refused: \"{}\" does not quote the user downgrading the comp. A single-file deliverable, a missing tool, or difficulty is not a reason, and a refused force is not the end of the phase: the readings above are the edits, each one a CSS value; make them, recapture, advance. Ask the user only when a reading contradicts something they said about this comp.",
            reason.unwrap_or("")
        ));
        return AdvanceResult { ok: false, phase, next: None, reasons, worst_crops: gate.worst_crops, advisories: gate.advisories, side_by_side: gate.side_by_side, forced: false, gate_summary: gate.summary };
    }
    if phase == "hero" && gate.score.is_some() {
        let artifact = opts.artifact.clone().or_else(|| state.get("artifact").and_then(Value::as_str).map(String::from)).unwrap_or_else(|| "index.html".into());
        if let Some(stuck) = hero_loop_verdict(state, &gate, &artifact, io) {
            if !gate.ok {
                let mut r = vec![stuck];
                r.extend(gate.reasons.clone());
                gate.reasons = r;
            }
        }
    }
    if !gate.ok && !force {
        if let Some(p) = state.pointer_mut(&format!("/phases/{phase}")).and_then(|p| p.as_object_mut()) {
            p.insert("status".into(), json!("open"));
        }
        return AdvanceResult { ok: false, phase, next: None, reasons: gate.reasons.clone(), worst_crops: gate.worst_crops, advisories: gate.advisories, side_by_side: gate.side_by_side, forced: false, gate_summary: gate.summary };
    }
    let mut forced = false;
    if !gate.ok && force {
        forced = true;
        if let Some(p) = state.pointer_mut(&format!("/phases/{phase}")).and_then(|p| p.as_object_mut()) {
            p.insert("forced".into(), json!({ "at": now(), "reason": reason, "reasons": gate.reasons }));
        }
    }
    if let Some(p) = state.pointer_mut(&format!("/phases/{phase}")).and_then(|p| p.as_object_mut()) {
        p.insert("status".into(), json!("closed"));
        p.insert("closedAt".into(), json!(now()));
    }
    if phase == "comps" {
        if let Some(approved) = &gate.approved {
            state.as_object_mut().unwrap().insert("comp".into(), json!(approved));
            if state.get("breakpoint").map(|v| v.is_null()).unwrap_or(true) {
                if let Ok(img) = load_raster(io, approved) {
                    state.as_object_mut().unwrap().insert("breakpoint".into(), json!(format!("{}x{}", img.width, img.height)));
                }
            }
        }
    }
    let next = PHASES[idx + 1].to_string();
    state.as_object_mut().unwrap().insert("phase".into(), json!(next));
    if let Some(np) = state.pointer_mut(&format!("/phases/{next}")).and_then(|p| p.as_object_mut()) {
        np.insert("status".into(), json!("open"));
        np.insert("openedAt".into(), json!(now()));
    }
    AdvanceResult { ok: true, phase, next: Some(next), reasons: vec![], worst_crops: vec![], advisories: gate.advisories, side_by_side: gate.side_by_side, forced, gate_summary: gate.summary }
}

// ---- guidance strings ------------------------------------------------------

fn next_instruction(io: &Io, state: &Value) -> String {
    let s = self_cmd(io);
    let phase = state.get("phase").and_then(Value::as_str).unwrap_or("");
    let comp = state.get("comp").and_then(Value::as_str).unwrap_or("");
    let direction = state.get("direction").and_then(Value::as_str);
    let bp = state.get("breakpoint").and_then(Value::as_str);
    match phase {
        "comps" => {
            let dir = direction.map(|d| format!(" (seed {d})")).unwrap_or_default();
            format!("Comp round for the chosen direction{dir}: read reference/visualize.md, generate three compositional comps of the requested surface at its own viewport into {MOCKS_DIR}/ (each with a prompt sidecar), put them in front of the user, and set \"approved\": true in the chosen comp's sidecar. Then {s} build-phase advance. No page code before this closes.")
        }
        "spec" => format!(
            "Measure the comp: {s} comp-spec --comp {comp} --grid, open {}, write regions.json (every illustration, photo, texture as its own plate region; every text block its own text region), run {s} comp-spec --comp {comp} --regions regions.json. Then measure the type: {s} font-match --measure <id> for each text region (cap height, width class, weight class) and {s} font-match --rank <lead text region> --text \"<its first words>\" to choose the headline face by metrics (the USE line is the CSS; with no browser it records the catalog's nearest face, which is the choice; do not install one, and do not write a chosen face into the spec by hand). Then {s} build-phase advance.",
            format!("{BUILD_DIR}/comp-grid.png")
        ),
        "plates" => format!("Produce every plate in the spec ({s} comp-spec --print lists them). Illustrations, photos, figures: {s} generate-image --plate <id>, one call per plate. It crops the comp region itself, sends the crop as the edit reference, sizes the plate, keys ink-on-ground to alpha, scores the result against the crop (PLATE-SCORE) and embeds the prompt; nothing else does all of that. Only when it errors (no key, no network) fall back to the harness image tool with {s} comp-spec --crop <id> as its reference image and {s} comp-spec --plate-prompt <id> as its prompt, then {s} embed-prompt; do not post-process a plate with magick or write your own keying. A generation takes 30 to 90 seconds: run it with a long wait (a 90 s yield, or all plates in one command joined with &&) rather than polling an open session turn after turn. A line drawing or figure on flat ground is keyed to alpha automatically (PLATE-CHROMA): place it with a plain <img> over the page's own ground, never on a second paper. An opaque plate whose ground differs from the page goes in with mix-blend-mode: multiply. Textures (paper, cloth, grain): do not generate first; crop a clean patch of the comp region ({s} comp-spec --crop <id> --raw, then cut a patch free of ink), mirror-tile it to the plate size, and save it as the plate; generate only when no clean patch exists. The gate scores a texture against its whole region box, so a texture region should be drawn around clean ground (a sample cell), not around the ink it sits under; the page tiles it wherever the material goes. Then {s} build-phase advance. Write no page code before this passes."),
        "hero" => format!(
            "Run {s} build-phase scaffold first: it writes the measured layout as CSS custom properties (.impeccable/build/scaffold/layout.css, --r-<id>-x/y/w/h in % of the comp, plus cap height, font-size, family, and weight where measured) and a reference page with every region at its box. Bind those numbers to your own markup (an element per region, its box from the properties); the reference is a check, not the page, and overlapping boxes are overlapping boxes. Build only the first viewport at {}. Copy the comp's words verbatim in this phase (headline, labels, table cells, footer): the user approved that comp with those words, and rewriting is a later, stated decision, never a silent one here. Set every text region's font-size from its measured cap height and its face from the ranking. Plates first: place every plate at its spec box ({s} comp-spec --print lists boxes as percentages of the viewport) with object-fit: cover before writing a line of text or a control, capture into {HERO_REPRO}, and run {s} build-phase record hero (not advance) once so you see the plate regions read as match before text exists; then lay the semantic layer (text, controls, rules) over the plates from the spec's palette and boxes, capture, advance. When it fails, open the region crops it lists first, in order, then fix; do not build past the hero until it passes.",
            bp.unwrap_or("the comp size")
        ),
        "sections" => format!("Build the remaining sections inside the spec system (same corner language, rules, and palette; nothing the comp does not show). The hero passed with the comp's words verbatim; from here, content beyond the comp is yours to author at full fidelity, and any change to words the comp showed is a stated decision in your report, never silent. Then {s} build-phase advance."),
        "motion" => format!("Add the signature interaction, reveals, and motion. Then {s} build-phase advance."),
        "responsive" => format!("Build the other viewports (mobile first if the surface is mobile). The first viewport must hold at common desktop widths (1280 to 1600), not only at the comp's exact size: fluid columns, no fixed-px grid that wraps 96px narrower. Settle or disable entrance motion before capturing (an element mid-animation reads as missing). Capture desktop.png (1440 wide, full page) and mobile.png (390 wide, full page) into .impeccable/review/; the gate diffs the top of desktop.png (scaled to the comp's width) against the comp. Then {s} build-phase advance."),
        "review" => format!("Spawn the finish reviewer with the state file, the hero diff report, and the captures; record its disposition with {s} build-phase finish --disposition <word>."),
        _ => String::new(),
    }
}

fn render_status(io: &Io, state: &Value) -> String {
    let phase = state.get("phase").and_then(Value::as_str).unwrap_or("");
    let comp = state.get("comp").and_then(Value::as_str);
    let direction = state.get("direction").and_then(Value::as_str);
    let bp = state.get("breakpoint").and_then(Value::as_str);
    let mut lines = vec![format!(
        "BUILD-PHASE {}  comp {}{}{}",
        phase.to_uppercase(),
        comp.unwrap_or("(pending comp round)"),
        direction.map(|d| format!("  direction {d}")).unwrap_or_default(),
        bp.map(|b| format!("  breakpoint {b}")).unwrap_or_default()
    )];
    for p in PHASES {
        let sp = state.pointer(&format!("/phases/{p}"));
        let status = sp.and_then(|v| v.get("status")).and_then(Value::as_str).unwrap_or("");
        let mut line = format!("  {} {}", util::pad_end(p, 11), util::pad_end(status, 8));
        if let Some(summary) = sp.and_then(|v| v.pointer("/gate/summary")).and_then(Value::as_str) {
            line.push_str(&format!(" {summary}"));
        }
        let attempts = sp.and_then(|v| v.get("attempts")).and_then(Value::as_i64).unwrap_or(0);
        if attempts > 1 {
            line.push_str(&format!(" ({attempts} attempts)"));
        }
        if let Some(fr) = sp.and_then(|v| v.pointer("/forced/reason")).and_then(Value::as_str) {
            line.push_str(&format!("  FORCED: {fr}"));
        }
        lines.push(line);
    }
    if let Some(finish) = state.get("finish").filter(|v| !v.is_null()) {
        let disp = finish.get("disposition").and_then(Value::as_str).unwrap_or("");
        let at = finish.get("at").and_then(Value::as_str).unwrap_or("");
        lines.push(format!("  finish      {disp} at {at}"));
    }
    lines.push(format!("NEXT {}", next_instruction(io, state)));
    lines.join("\n")
}

// ---- CLI -------------------------------------------------------------------

/// `impeccable build-phase <cmd> ...`
pub fn run(argv: &[String], io: &mut Io, organic_scan: OrganicScan) -> i32 {
    let cmd = argv.first().map(String::as_str);
    if cmd.is_none() || flag(argv, "help") {
        io.err("usage: build-phase.mjs start --comp <png> [--breakpoint WxH] | status [--json] | advance [--force --reason \"...\"] | record hero --build <png> | scaffold | note \"<text>\" | finish --disposition <word>\n");
        return 1;
    }
    let cmd = cmd.unwrap();
    if cmd == "start" {
        let comp = arg(argv, "comp");
        let direction = arg(argv, "direction");
        if comp.is_none() && direction.is_none() {
            io.err("build-phase: start needs --comp <approved comp png> (comp already approved) or --direction <seed key> (comp round still to run)\n");
            return 1;
        }
        if let Some(c) = comp {
            if !abs(io, c).exists() {
                io.err(&format!("build-phase: comp {c} does not exist\n"));
                return 1;
            }
        }
        if direction.is_some() && arg(argv, "kind").is_some() {
            io.out("choice ping skipped\n");
        }
        let _ = std::fs::remove_file(abs(io, &format!("{BUILD_DIR}/pending.json")));
        let build_path = read_build_path(io);
        if direction.is_some() && comp.is_none() && build_path.as_deref() == Some("code") {
            io.out("CODE-LED (from .impeccable config): no comp round and no phase gates. Write the direction contract (reference/new-work.md section 5), build, and finish per section 7. The chosen decision comp, if any, rides to the finish review as the critique reference.\n");
            return 0;
        }
        let mut breakpoint = arg(argv, "breakpoint").map(String::from);
        if breakpoint.is_none() {
            if let Some(c) = comp {
                if let Ok(img) = load_raster(io, c) {
                    breakpoint = Some(format!("{}x{}", img.width, img.height));
                }
            }
        }
        let existing = load_state(io);
        if let Some(existing) = &existing {
            if !flag(argv, "reset") {
                io.out(&format!("build-phase: state exists (phase {}); pass --reset to start over\n", existing.get("phase").and_then(Value::as_str).unwrap_or("")));
                io.out(&format!("{}\n", render_status(io, existing)));
                return 0;
            }
        }
        let state = new_state(comp, breakpoint.as_deref(), arg(argv, "artifact"), direction);
        save_state(io, &state);
        io.out(&format!("{}\n", render_status(io, &state)));
        return 0;
    }
    let mut state = match load_state(io) {
        Some(s) => s,
        None => {
            io.err(&format!("build-phase: no state at {}; run build-phase.mjs start --comp <approved comp>\n", state_path()));
            return 1;
        }
    };
    match cmd {
        "status" => {
            if flag(argv, "json") {
                io.out(&format!("{}\n", util::json_pretty(&state)));
            } else {
                io.out(&format!("{}\n", render_status(io, &state)));
            }
            0
        }
        "scaffold" => {
            let Some(spec) = load_spec(&abs(io, SPEC_PATH)) else {
                io.err(&format!("build-phase: no spec at {SPEC_PATH}; run comp-spec.mjs first\n"));
                return 1;
            };
            let out = write_scaffold(io, &spec);
            let bp = state.get("breakpoint").and_then(Value::as_str).map(String::from).unwrap_or_else(|| {
                let w = spec.pointer("/compSize/width").and_then(Value::as_i64).unwrap_or(0);
                let h = spec.pointer("/compSize/height").and_then(Value::as_i64).unwrap_or(0);
                format!("{w}x{h}")
            });
            io.out(&format!("SCAFFOLD {}\n", out.dir));
            io.out(&format!("  {}   one custom property set per region (--r-<id>-x/y/w/h in % of the comp; --r-<id>-cap, --r-<id>-font, --r-<id>-weight where measured); bind these to your own markup\n", out.css));
            io.out(&format!("  {}  a reference page: every region positioned at its box inside a {bp} frame, plates placed with object-fit: contain, text slots at the measured cap height in the ranked face\n", out.html));
            io.out("  The reference is a check, not the page: keep your own semantic structure and bind the numbers to it (an element per region, its box from the properties). Overlapping boxes are overlapping boxes. What the gate reads is pixels; a page that lands each region at its box passes whatever markup it uses.\n");
            0
        }
        "note" => {
            let text = argv[1..].iter().filter(|a| !a.starts_with("--")).cloned().collect::<Vec<_>>().join(" ");
            let phase = state.get("phase").and_then(Value::as_str).unwrap_or("").to_string();
            if let Some(notes) = state.pointer_mut(&format!("/phases/{phase}/notes")).and_then(|v| v.as_array_mut()) {
                notes.push(json!({ "at": now(), "text": text }));
            }
            save_state(io, &state);
            io.out(&format!("noted on {phase}\n"));
            0
        }
        "record" => {
            let which = argv.get(1).map(String::as_str);
            if which != Some("hero") {
                io.err("build-phase: record hero --build <png>\n");
                return 1;
            }
            let build_path = arg(argv, "build").unwrap_or(HERO_REPRO).to_string();
            let min = arg(argv, "min").map(|m| util::parse_f64(m, HERO_MIN)).unwrap_or(HERO_MIN);
            let gate = gate_hero(io, &mut state, &build_path, min, ".impeccable/review/diff/hero", None, organic_scan);
            let records = state.pointer("/phases/hero/records").and_then(Value::as_i64).unwrap_or(0) + 1;
            if let Some(h) = state.pointer_mut("/phases/hero").and_then(|v| v.as_object_mut()) {
                h.insert("records".into(), json!(records));
                h.insert("gate".into(), gate.record_json(&now()));
            }
            save_state(io, &state);
            let spec = load_spec(&abs(io, SPEC_PATH));
            let plate_rows: Vec<String> = gate
                .region_verdicts
                .iter()
                .filter(|(id, _)| {
                    spec.as_ref()
                        .and_then(|s| spec_regions(s).into_iter().find(|r| r.get("id").and_then(Value::as_str) == Some(id.as_str())))
                        .map(|r| r.get("medium").and_then(Value::as_str) == Some("raster"))
                        .unwrap_or(false)
                })
                .map(|(id, v)| format!("{id}:{}", v.as_str().unwrap_or("")))
                .collect();
            if !plate_rows.is_empty() {
                io.out(&format!("PLATES {}\n", plate_rows.join(" ")));
            }
            io.out(&format!("{} {} (record: nothing advanced)\n", if gate.ok { "PASS" } else { "FAIL" }, gate.summary.clone().unwrap_or_default()));
            for r in &gate.reasons {
                io.out(&format!("  - {r}\n"));
            }
            for a in &gate.advisories {
                io.out(&format!("  {a}\n"));
            }
            if !gate.worst.is_empty() {
                io.out(&format!("  worst: {}\n", gate.worst.join("; ")));
            }
            if let Some(sbs) = &gate.side_by_side {
                io.out(&format!("  open {sbs}\n"));
            }
            if gate.ok {
                0
            } else {
                2
            }
        }
        "advance" => {
            let opts = GateOpts {
                build_path: arg(argv, "build").map(String::from),
                min: arg(argv, "min").map(|m| util::parse_f64(m, f64::NAN)),
                artifact: arg(argv, "artifact").map(String::from),
            };
            let res = advance(io, &mut state, flag(argv, "force"), arg(argv, "reason"), &opts, organic_scan);
            save_state(io, &state);
            if !res.ok {
                io.out(&format!("GATE {} FAILED (state unchanged)\n", res.phase.to_uppercase()));
                if !res.worst_crops.is_empty() {
                    io.out("  LOOK FIRST, in this order, before editing anything (comp on the left, your build on the right):\n");
                    for c in &res.worst_crops {
                        let file = c.get("file").and_then(Value::as_str).unwrap_or("");
                        let id = c.get("id").and_then(Value::as_str).unwrap_or("");
                        let verdict = c.get("verdict").and_then(Value::as_str).unwrap_or("");
                        let sc = |k: &str| c.pointer(&format!("/score/{k}")).and_then(Value::as_f64).unwrap_or(0.0);
                        io.out(&format!("    {file}   {id}: {verdict} {}% (structure {}%, color {}%, detail {}%)\n", pct0(sc("overall")), pct0(sc("structure")), pct0(sc("color")), pct0(sc("detail"))));
                    }
                    io.out("  A region scored missing needs its material (a plate placed, or produced), not a value change; contradicted needs its structure re-derived from the spec box; drift is where padding and size edits belong. When a thin chrome strip (masthead, breadcrumb, table header) is the worst region, check its box height in the spec against the comp first: a strip one grid row tall in the spec but 53px in the comp compares your build against ground it never had.\n");
                }
                for r in &res.reasons {
                    io.out(&format!("  - {r}\n"));
                }
                for a in &res.advisories {
                    io.out(&format!("  {a}\n"));
                }
                if let Some(sbs) = &res.side_by_side {
                    io.out(&format!("  then {sbs} for the whole viewport\n"));
                }
                return 2;
            }
            io.out(&format!(
                "ADVANCED {} -> {}{}{}\n",
                res.phase,
                res.next.clone().unwrap_or_default(),
                if res.forced { " (FORCED; recorded)" } else { "" },
                res.gate_summary.map(|s| format!("  {s}")).unwrap_or_default()
            ));
            for a in &res.advisories {
                io.out(&format!("  {a}\n"));
            }
            io.out(&format!("NEXT {}\n", next_instruction(io, &state)));
            0
        }
        "finish" => {
            let disposition = arg(argv, "disposition");
            if !matches!(disposition, Some("ship") | Some("fix") | Some("rebuild") | Some("recapture")) {
                io.err("build-phase: finish --disposition ship|fix|rebuild|recapture\n");
                return 1;
            }
            let disposition = disposition.unwrap();
            let open_before: Vec<String> = PHASES
                .iter()
                .filter(|&&ph| {
                    ph != "review"
                        && state
                            .pointer(&format!("/phases/{ph}/status"))
                            .and_then(Value::as_str)
                            .map(|st| st != "closed" && st != "skipped")
                            .unwrap_or(false)
                })
                .map(|s| s.to_string())
                .collect();
            if disposition == "ship" && !open_before.is_empty() {
                let phase = state.get("phase").and_then(Value::as_str).unwrap_or("");
                io.err(&format!(
                    "build-phase: finish --disposition ship refused: {} {} not closed (phase {phase}). Record fix or rebuild, or close the phases first; a page shipped over an open hero is a page shipped against its own gate.\n",
                    open_before.join(", "),
                    if open_before.len() == 1 { "is" } else { "are" }
                ));
                return 2;
            }
            let phase = state.get("phase").and_then(Value::as_str).unwrap_or("").to_string();
            state.as_object_mut().unwrap().insert("finish".into(), json!({ "disposition": disposition, "at": now(), "phaseAtFinish": phase }));
            if phase == "review" {
                if let Some(rev) = state.pointer_mut("/phases/review").and_then(|v| v.as_object_mut()) {
                    rev.insert("status".into(), json!("closed"));
                    rev.insert("closedAt".into(), json!(now()));
                }
            }
            save_state(io, &state);
            io.out(&format!("{}\n", render_status(io, &state)));
            0
        }
        other => {
            io.err(&format!("build-phase: unknown command {other}\n"));
            1
        }
    }
}
