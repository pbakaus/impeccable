//! What each detector rule costs the edit hook, per edit, in milliseconds.
//!
//!     cargo run --release -p impeccable-html --example rule_cost -- \
//!         [--runs 9] [--out rule-cost.json] <file-or-dir>...
//!
//! The hook (`crates/hook/src/hook.rs`, `run_hook`) is a new process on every
//! Edit or Write, and it runs a whole engine over the edited file: the static
//! HTML engine for `.html` / `.htm`, the text engine for every other
//! `ALLOWED_EXTS` file. The per-edit tier only filters the findings shown
//! afterwards; it does not skip rules. So a rule costs every edit of a file
//! its engine reads, and what it costs is a cold run: its regexes compile and
//! its lazy tables build in that process.
//!
//! This measures exactly that. For every sample it starts itself again as a
//! fresh process (`--one <file>`), runs the file's engine the way the hook
//! does (inline ignores on, no design system, no rule pack) with the
//! engines' own profiler switched on (`impeccable_detect::profiler`), and
//! reports the timed units. Runs are interleaved across files so drift on the
//! machine spreads over every file instead of landing on one.
//!
//! A unit is what the engine times as one step. In the text engine that is a
//! line matcher or a page analyzer, named by its rule id. In the HTML engine
//! several rules share one pass over the elements (`color-rules`,
//! `quality-rules`, ...); their cost cannot be split, and the output says
//! which rules a unit emitted on the inputs.
//!
//! `--one <file>` prints one sample as a JSON line and is what the driver
//! spawns; it is also handy on its own.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::rc::Rc;
use std::time::Instant;

use impeccable_detect::detect_text::{detect_text, TextOptions};
use impeccable_detect::engines::{HtmlEngine, ScanOptions};
use impeccable_detect::profiler::DetectorProfile;
use impeccable_html::StaticHtmlEngine;
use serde_json::{json, Value};

/// `crates/hook/src/hook_lib.rs` `ALLOWED_EXTS`: the files the hook scans.
const HOOK_EXTS: &[&str] = &[
    "tsx", "jsx", "html", "htm", "vue", "svelte", "astro", "css", "scss", "sass", "less", "ts",
    "js",
];

fn is_html(path: &Path) -> bool {
    matches!(ext(path).as_str(), "html" | "htm")
}

fn ext(path: &Path) -> String {
    path.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}

/// One cold sample: the engine the hook would pick, over one file, profiled.
/// A file that cannot be read or scanned is an error, never an empty sample.
fn one(path: &Path) -> Result<Value, String> {
    let file = path.to_string_lossy().to_string();
    // As the hook reads it (`hook.rs`): bytes, decoded lossily.
    let bytes = std::fs::read(path).map_err(|e| format!("cannot read {file}: {e}"))?;
    let content = String::from_utf8_lossy(&bytes).into_owned();
    let profile = Rc::new(DetectorProfile::new());
    let html = is_html(path);
    let started = Instant::now();
    let findings = if html {
        let options = ScanOptions {
            inline_ignores: true,
            profile: Some(profile.clone()),
            ..Default::default()
        };
        StaticHtmlEngine::default()
            .detect_html(&file, &options, &mut std::io::sink())
            .map_err(|e| format!("the HTML engine failed on {file}: {}", e.message))?
    } else {
        let options = TextOptions {
            profile: Some(&profile),
            inline_ignores: true,
            ..Default::default()
        };
        detect_text(&content, &file, &options)
    };
    let total_ms = started.elapsed().as_secs_f64() * 1000.0;
    let events: Vec<Value> = profile
        .events
        .borrow()
        .iter()
        .map(|e| json!({ "engine": e.engine, "phase": e.phase, "unit": e.rule_id, "ms": e.ms, "rules": e.finding_ids.clone().unwrap_or_default() }))
        .collect();
    Ok(json!({
        "file": file,
        "engine": if html { "static-html" } else { "text" },
        "bytes": bytes.len(),
        "totalMs": total_ms,
        "findings": findings.len(),
        "events": events,
    }))
}

/// The files the hook would scan under `path`. A symlink met while walking is
/// skipped (a link to a sibling would weigh its files twice, a link to a
/// parent would loop); a path given on the command line is followed.
fn collect(path: &Path, out: &mut Vec<PathBuf>, top: bool) {
    let link = std::fs::symlink_metadata(path)
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false);
    if link && !top {
        return;
    }
    if path.is_dir() {
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if matches!(
            name,
            "node_modules" | ".git" | "dist" | "target" | ".next" | "build"
        ) {
            return;
        }
        let mut entries: Vec<PathBuf> = std::fs::read_dir(path)
            .map(|d| d.flatten().map(|e| e.path()).collect())
            .unwrap_or_default();
        entries.sort();
        for entry in entries {
            collect(&entry, out, false);
        }
    } else if HOOK_EXTS.contains(&ext(path).as_str()) {
        out.push(path.to_path_buf());
    }
}

/// Engine work no rule owns: reading, parsing, the cascade, selector
/// matching, extracting style blocks. Every edit pays it.
const SHARED_PHASES: &[&str] = &[
    "setup",
    // Reading a page's local linked stylesheets (`cascade/build.rs`).
    "preprocess",
    "parse-html",
    "parse-css",
    "cascade",
    "selector-match",
    "extract",
];

/// An event that only wraps others: the HTML engine times its call into the
/// text-content analyzers (`engine.rs`, `Meta::new("page", "text-content")`),
/// and each analyzer inside records its own `text-content` event.
fn is_container(e: &Value) -> bool {
    e["phase"] == "page" && e["unit"] == "text-content"
}

fn stats(mut samples: Vec<f64>) -> Value {
    if samples.is_empty() {
        return json!(null);
    }
    samples.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let pick = |p: f64| {
        samples[(((p / 100.0) * samples.len() as f64).ceil() as usize).clamp(1, samples.len()) - 1]
    };
    let mean = samples.iter().sum::<f64>() / samples.len() as f64;
    let r = |v: f64| (v * 1000.0).round() / 1000.0;
    json!({ "mean": r(mean), "p50": r(pick(50.0)), "p95": r(pick(95.0)), "max": r(*samples.last().unwrap()) })
}

fn registry(root: &Path) -> BTreeSet<String> {
    let text = std::fs::read_to_string(root.join("crates/live/assets/antipatterns.json"))
        .unwrap_or_default();
    let rows: Vec<Value> = serde_json::from_str(&text).unwrap_or_default();
    rows.iter()
        .filter_map(|r| r["id"].as_str().map(str::to_string))
        .collect()
}

fn git(root: &Path, args: &[&str]) -> String {
    Command::new("git")
        .args(args)
        .current_dir(root)
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default()
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if let Some(i) = args.iter().position(|a| a == "--one") {
        let Some(path) = args.get(i + 1) else {
            eprintln!("usage: rule_cost --one <file>");
            std::process::exit(1);
        };
        match one(Path::new(path)) {
            Ok(sample) => println!("{sample}"),
            Err(e) => {
                eprintln!("{e}");
                std::process::exit(2);
            }
        }
        return;
    }

    let flag = |name: &str| {
        args.iter()
            .position(|a| a == name)
            .and_then(|i| args.get(i + 1))
            .cloned()
    };
    let runs: usize = flag("--runs").and_then(|v| v.parse().ok()).unwrap_or(9);
    let out = flag("--out").unwrap_or_else(|| "rule-cost.json".into());
    let mut inputs = Vec::new();
    let mut skip = false;
    for a in &args {
        if skip {
            skip = false;
            continue;
        }
        if a == "--runs" || a == "--out" {
            skip = true;
            continue;
        }
        if !Path::new(a).exists() {
            eprintln!("rule_cost: no such file or directory: {a}");
            std::process::exit(1);
        }
        collect(Path::new(a), &mut inputs, true);
    }
    if inputs.is_empty() {
        eprintln!("usage: rule_cost [--runs N] [--out rule-cost.json] <file-or-dir>...");
        std::process::exit(1);
    }
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let rules = registry(&root);
    let me = std::env::current_exe().expect("own path");

    // engine -> samples; a sample is one cold run of one file.
    let mut samples: BTreeMap<String, Vec<Value>> = BTreeMap::new();
    let mut process_ms: BTreeMap<String, Vec<f64>> = BTreeMap::new();
    for run in 0..runs {
        eprint!("\rrun {}/{runs}", run + 1);
        for path in &inputs {
            let started = Instant::now();
            let output = Command::new(&me)
                .arg("--one")
                .arg(path)
                .output()
                .expect("spawn");
            let wall = started.elapsed().as_secs_f64() * 1000.0;
            // A failed sample stops the run: a report with holes in it is not a measurement.
            let sample = match serde_json::from_slice::<Value>(&output.stdout) {
                Ok(sample) if output.status.success() => sample,
                _ => {
                    eprintln!(
                        "\nrule_cost: the sample of {} failed ({}): {}",
                        path.display(),
                        output.status,
                        String::from_utf8_lossy(&output.stderr).trim()
                    );
                    std::process::exit(1);
                }
            };
            let engine = sample["engine"].as_str().unwrap_or("?").to_string();
            process_ms.entry(engine.clone()).or_default().push(wall);
            samples.entry(engine).or_default().push(sample);
        }
    }
    eprintln!();

    let mut engines = serde_json::Map::new();
    let mut units_out = Vec::new();
    let mut by_rule: BTreeMap<String, Vec<Value>> = BTreeMap::new();
    for (engine, list) in &samples {
        // unit -> per-sample ms (0 where it did not run), phases, rules seen.
        let mut unit_ms: BTreeMap<String, Vec<f64>> = BTreeMap::new();
        let mut unit_phases: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
        let mut unit_rules: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
        let (mut totals, mut shared, mut unprofiled) = (vec![], vec![], vec![]);
        for (i, sample) in list.iter().enumerate() {
            let total = sample["totalMs"].as_f64().unwrap_or(0.0);
            let (mut shared_ms, mut attributed) = (0.0, 0.0);
            for e in sample["events"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|e| !is_container(e))
            {
                let ms = e["ms"].as_f64().unwrap_or(0.0);
                let phase = e["phase"].as_str().unwrap_or("");
                if SHARED_PHASES.contains(&phase) {
                    shared_ms += ms;
                    continue;
                }
                attributed += ms;
                let unit = e["unit"].as_str().unwrap_or("?").to_string();
                let slot = unit_ms.entry(unit.clone()).or_default();
                slot.resize(list.len(), 0.0);
                slot[i] += ms;
                unit_phases
                    .entry(unit.clone())
                    .or_default()
                    .insert(phase.to_string());
                let seen = unit_rules.entry(unit.clone()).or_default();
                for r in e["rules"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|r| r.as_str())
                {
                    seen.insert(r.to_string());
                }
                if rules.contains(&unit) {
                    seen.insert(unit);
                }
            }
            totals.push(total);
            shared.push(shared_ms);
            unprofiled.push((total - shared_ms - attributed).max(0.0));
        }
        let n = list.len();
        engines.insert(
            engine.clone(),
            json!({
                "samples": n,
                "files": n / runs.max(1),
                "perEdit": stats(totals),
                "shared": stats(shared),
                "unprofiled": stats(unprofiled),
                "process": stats(process_ms.remove(engine).unwrap_or_default()),
            }),
        );
        for (unit, mut ms) in unit_ms {
            ms.resize(n, 0.0);
            let emitted: Vec<String> = unit_rules
                .remove(&unit)
                .unwrap_or_default()
                .into_iter()
                .filter(|r| rules.contains(r))
                .collect();
            let row = json!({
                "engine": engine,
                "unit": unit,
                "phases": unit_phases.remove(&unit).unwrap_or_default(),
                "rules": emitted,
                "perEdit": stats(ms),
            });
            for r in &emitted {
                by_rule.entry(r.clone()).or_default().push(json!({ "engine": engine, "unit": unit, "sharedWith": emitted.len() - 1, "perEdit": row["perEdit"] }));
            }
            units_out.push(row);
        }
    }
    units_out.sort_by(|a, b| {
        b["perEdit"]["mean"]
            .as_f64()
            .partial_cmp(&a["perEdit"]["mean"].as_f64())
            .unwrap()
    });

    let report = json!({
        "commit": git(&root, &["rev-parse", "HEAD"]),
        "dirty": !git(&root, &["status", "--porcelain", "--untracked-files=no"]).is_empty(),
        "commitDate": git(&root, &["log", "-1", "--format=%cI"]),
        "generatedAtUnix": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0),
        "machine": format!("{} {}", std::env::consts::OS, std::env::consts::ARCH),
        "runs": runs,
        "inputs": inputs.len(),
        "method": "Each sample is a fresh process running one file through the engine the hook picks for it, cold, with the engines' profiler on. perEdit stats are over samples (file x run), in milliseconds. A unit that did not run on a file counts 0 there. Units sharing a pass are not split: sharedWith counts the other rules in the same unit.",
        "engines": engines,
        "units": units_out,
        "rules": by_rule,
        // Registry rules no hook unit emitted on these inputs: browser-only
        // rules (layout, pixels), or rules the inputs never triggered.
        "notSeen": rules.iter().filter(|r| !by_rule.contains_key(*r)).collect::<Vec<_>>(),
    });
    std::fs::write(&out, serde_json::to_string_pretty(&report).unwrap()).expect("write report");
    eprintln!("wrote {out}: {} inputs x {runs} runs", inputs.len());
}
