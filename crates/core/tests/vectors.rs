//! Replays the recorded JS call vectors through the Rust port and requires
//! every one to match. Vectors live in the public repo at
//! `tests/oracle/vectors/calls/<module>/<fn>.jsonl` in this repo;
//! `IMPECCABLE_PUBLIC_REPO` overrides the root for an out-of-tree checkout.

use impeccable_core::vectors::{call, KNOWN_FUNCTIONS};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

const MODULES: &[&str] = &["shared.color", "shared.inline-ignores", "rules.checks"];

/// The repo root: this workspace is the public repo. `IMPECCABLE_PUBLIC_REPO`
/// overrides it for an out-of-tree checkout.
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

fn same(a: &Canon, b: &Canon) -> bool {
    match (a, b) {
        (Canon::Num(x), Canon::Num(y)) => {
            (x.is_nan() && y.is_nan()) || (x == y && x.is_sign_negative() == y.is_sign_negative())
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
            "vectors dir not found; set IMPECCABLE_PUBLIC_REPO to a checkout of the public repo that has \
             tests/oracle/vectors/calls (generate with `node tests/oracle/vectors/record-calls.mjs`)"
        );
    };
    let mut total_pass = 0usize;
    let mut total_fail = 0usize;
    let mut lines_out: Vec<String> = Vec::new();
    for module in MODULES {
        let mod_dir = dir.join(module);
        // `KNOWN_FUNCTIONS` is already the union of the open arms and the
        // detector's, fetched across the boundary.
        let mut known: Vec<&str> = Vec::new();
        for (m, fns) in KNOWN_FUNCTIONS.iter() {
            if m == module {
                known.extend(fns.iter().map(|f| f.as_str()));
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
                let expected = rec.get("result").cloned().unwrap_or(Value::Null);
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
