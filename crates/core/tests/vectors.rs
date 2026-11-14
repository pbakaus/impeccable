//! Replays the recorded JS call vectors through the Rust port and requires
//! every one to match. Vectors live at
//! `tests/oracle/vectors/calls/<module>/<fn>.jsonl` in this repo;
//! `IMPECCABLE_PUBLIC_REPO` overrides the root for an out-of-tree checkout.

use impeccable_core::vectors::{call, KNOWN_FUNCTIONS};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

const MODULES: &[&str] = &["shared.color", "shared.inline-ignores", "rules.checks"];

/// Rules the registry has retired since the snapshot was recorded. The
/// snapshot is read-only (`tests/oracle/vectors/README.md`), so a retired
/// rule's recorded hits stay in it as history and the replay drops them from
/// both sides of the comparison instead. Every other hit on the same line
/// still has to match, so a retirement cannot quietly cover a regression in a
/// neighbouring rule.
///
/// `image-hover-transform` was retired after the corpus review: hover zoom on
/// a card image is a long-standing convention, not a generated-UI tell. Both
/// sides are filtered because the vectors cover rule-agnostic passes too:
/// `applyInlineIgnores` is handed findings as data and hands back whatever it
/// was given, retired id or not, which is the behavior a config naming a
/// retired rule depends on.
///
/// `layout-transition` was retired on 2026-10-07 (decision
/// r8-t5-layout-transition-retire): advisory since the first review, and on
/// two judged cohorts since then not one of its findings was harmful. Its
/// hits sit in the `checkMotion`, `checkHtmlPatterns` and regex-matcher
/// vectors beside `bounce-easing` hits, which still have to match.
const RETIRED_RULE_IDS: &[&str] = &["image-hover-transform", "layout-transition"];

/// Drops top-level findings carrying a retired rule id. Vectors name the rule
/// `id` (pattern findings) or `antipattern` (findings); a result that is not a
/// list of findings is returned untouched.
fn without_retired(v: &Value) -> Value {
    let Value::Array(items) = v else {
        return v.clone();
    };
    Value::Array(
        items
            .iter()
            .filter(|item| {
                !item
                    .get("id")
                    .or_else(|| item.get("antipattern"))
                    .and_then(|id| id.as_str())
                    .map(|id| RETIRED_RULE_IDS.contains(&id))
                    .unwrap_or(false)
            })
            .cloned()
            .collect(),
    )
}

/// The repo root. `IMPECCABLE_PUBLIC_REPO` overrides it for an out-of-tree
/// checkout.
fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("..")
}

fn vectors_dir() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(p) = std::env::var("IMPECCABLE_PUBLIC_REPO") {
        candidates.push(PathBuf::from(p));
    }
    candidates.push(repo_root());
    candidates
        .into_iter()
        .map(|repo| {
            repo.join("tests")
                .join("oracle")
                .join("vectors")
                .join("calls")
        })
        .find(|dir| dir.is_dir())
}

/// Canonical form for comparison: numbers by f64 value, objects key-order
/// insensitive, `{"$undef":true}` object values dropped (JSON.stringify would
/// omit them).
#[derive(Debug, PartialEq)]
enum Canon {
    Null,
    Bool(bool),
    Num(f64),
    Str(String),
    Arr(Vec<Canon>),
    Obj(BTreeMap<String, Canon>),
    Undef,
}

fn is_undef(v: &Value) -> bool {
    matches!(v, Value::Object(m) if m.len() == 1 && m.get("$undef").is_some())
}

fn canon(v: &Value) -> Canon {
    match v {
        Value::Null => Canon::Null,
        Value::Bool(b) => Canon::Bool(*b),
        Value::Number(n) => Canon::Num(n.as_f64().unwrap_or(f64::NAN)),
        Value::String(s) => Canon::Str(s.clone()),
        Value::Array(a) => Canon::Arr(a.iter().map(canon).collect()),
        Value::Object(m) => {
            if is_undef(v) {
                return Canon::Undef;
            }
            if m.len() == 1 {
                if let Some(n) = m.get("$negzero") {
                    if n.as_bool() == Some(true) {
                        return Canon::Num(-0.0);
                    }
                }
            }
            Canon::Obj(
                m.iter()
                    .filter(|(_, v)| !is_undef(v))
                    .map(|(k, v)| (k.clone(), canon(v)))
                    .collect(),
            )
        }
    }
}

/// How many units in the last place a number may differ by on Windows.
/// `f64::powf` calls the platform's math library, and the Universal CRT on
/// Windows Server 2022 rounds a few `pow` results one to three ULP away from
/// V8's (the recorded `relativeLuminance` and `contrastRatio` vectors), where
/// Server 2025 matches. Linux and macOS match V8 exactly and stay an exact
/// gate.
const WINDOWS_ULP_TOLERANCE: u64 = 4;

fn ulps_apart(x: f64, y: f64) -> u64 {
    if x.is_sign_negative() != y.is_sign_negative() {
        return u64::MAX;
    }
    x.to_bits().abs_diff(y.to_bits())
}

fn same(a: &Canon, b: &Canon) -> bool {
    match (a, b) {
        (Canon::Num(x), Canon::Num(y)) => {
            (x.is_nan() && y.is_nan())
                || (x == y && x.is_sign_negative() == y.is_sign_negative())
                || (cfg!(windows)
                    && x.is_finite()
                    && y.is_finite()
                    && ulps_apart(*x, *y) <= WINDOWS_ULP_TOLERANCE)
        }
        (Canon::Arr(x), Canon::Arr(y)) => {
            x.len() == y.len() && x.iter().zip(y).all(|(p, q)| same(p, q))
        }
        (Canon::Obj(x), Canon::Obj(y)) => {
            x.len() == y.len()
                && x.iter()
                    .all(|(k, v)| y.get(k).map(|w| same(v, w)).unwrap_or(false))
        }
        _ => a == b,
    }
}

#[test]
fn replay_recorded_vectors() {
    let Some(dir) = vectors_dir() else {
        panic!(
            "vectors dir not found; set IMPECCABLE_PUBLIC_REPO to a checkout of this repo that has \
             tests/oracle/vectors/calls (generate with `node tests/oracle/vectors/record-calls.mjs`)"
        );
    };
    let mut total_pass = 0usize;
    let mut total_fail = 0usize;
    let mut lines_out: Vec<String> = Vec::new();
    for module in MODULES {
        let mod_dir = dir.join(module);
        // `KNOWN_FUNCTIONS` is the union of foundation's arms and this
        // crate's.
        let mut known: Vec<&str> = Vec::new();
        for (m, fns) in KNOWN_FUNCTIONS.iter() {
            if m == module {
                known.extend(fns.iter().copied());
            }
        }
        let mut seen: Vec<String> = Vec::new();
        let mut entries: Vec<PathBuf> = match std::fs::read_dir(&mod_dir) {
            Ok(rd) => rd
                .filter_map(|e| e.ok().map(|e| e.path()))
                .filter(|p| p.extension().map(|e| e == "jsonl").unwrap_or(false))
                .collect(),
            Err(_) => Vec::new(),
        };
        entries.sort();
        for path in entries {
            let fn_name = path.file_stem().unwrap().to_string_lossy().to_string();
            seen.push(fn_name.clone());
            if !known.iter().any(|k| *k == fn_name) {
                lines_out.push(format!("SKIP {}/{}: not ported yet", module, fn_name));
                continue;
            }
            let text = std::fs::read_to_string(&path).unwrap();
            let mut pass = 0usize;
            let mut fail = 0usize;
            let mut first_failures: Vec<String> = Vec::new();
            for (lineno, line) in text.lines().enumerate() {
                if line.trim().is_empty() {
                    continue;
                }
                let rec: Value = serde_json::from_str(line)
                    .unwrap_or_else(|e| panic!("{}:{}: {e}", path.display(), lineno + 1));
                let args = rec
                    .get("args")
                    .and_then(|a| a.as_array())
                    .cloned()
                    .unwrap_or_default();
                let expected = without_retired(&rec.get("result").cloned().unwrap_or(Value::Null));
                match call(module, &fn_name, &args) {
                    None => {
                        fail += 1;
                        if first_failures.len() < 3 {
                            first_failures.push(format!(
                                "  line {}: dispatcher has no handler / rejected args {}",
                                lineno + 1,
                                Value::Array(args.clone())
                            ));
                        }
                    }
                    Some(actual) => {
                        let actual = without_retired(&actual);
                        if same(&canon(&actual), &canon(&expected)) {
                            pass += 1;
                        } else {
                            fail += 1;
                            if first_failures.len() < 3 {
                                first_failures.push(format!(
                                    "  line {}: args {}\n    expected {}\n    actual   {}",
                                    lineno + 1,
                                    Value::Array(args.clone()),
                                    expected,
                                    actual
                                ));
                            }
                        }
                    }
                }
            }
            total_pass += pass;
            total_fail += fail;
            lines_out.push(format!(
                "{} {}/{}: {} pass, {} fail",
                if fail == 0 { "PASS" } else { "FAIL" },
                module,
                fn_name,
                pass,
                fail
            ));
            lines_out.extend(first_failures);
        }
        for f in &known {
            if !seen.iter().any(|s| s == *f) {
                lines_out.push(format!("SKIP {}/{}: no vectors recorded", module, f));
            }
        }
    }
    let summary = lines_out.join("\n");
    println!("{summary}\nTOTAL: {total_pass} pass, {total_fail} fail");
    assert_eq!(total_fail, 0, "vector mismatches:\n{summary}");
}
