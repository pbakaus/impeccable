//! Replays the JS `detect --no-config --json <fixture>` goldens
//! (`tests/oracle/golden/detect-fixture-json-*.json` in the public repo)
//! through the static engine and diffs the finding arrays.
//!
//! The goldens' `stdout` is the JSON array for one fixture with the repo path
//! masked as `<REPO>`; the comparison re-applies that mask. Only `.html`
//! fixtures go through the static engine (the others belong to the regex
//! engine). The three text-content analyzers (`em-dash-overuse`,
//! `marketing-buzzword`, `aphoristic-cadence`) live in the regex engine and
//! reach `detectHtml` through the `text_content_analyzers` hook; the test
//! wires the `detect` crate's port so the complete arrays are diffed.
//!
//! The goldens and fixtures live in this repo; `IMPECCABLE_PUBLIC_REPO`
//! overrides the root for an out-of-tree checkout.

use impeccable_html::{detect_html_source, DetectHtmlOptions};

fn run_text_content_analyzers(
    content: &str,
    file_path: &str,
) -> Vec<impeccable_core::findings::Finding> {
    impeccable_detect::detect_text::run_text_content_analyzers(content, file_path, None)
}
use serde_json::Value;
use std::path::{Path, PathBuf};

fn public_repo() -> Option<PathBuf> {
    let p = match std::env::var("IMPECCABLE_PUBLIC_REPO") {
        Ok(p) => PathBuf::from(p),
        Err(_) => Path::new(env!("CARGO_MANIFEST_DIR")).join("../.."),
    };
    if p.join("tests/oracle/golden").is_dir() {
        return Some(p.canonicalize().unwrap_or(p));
    }
    None
}

/// Case ids -> the fixture file under tests/fixtures/antipatterns.
fn fixture_for(golden_name: &str, fixtures: &Path) -> Option<PathBuf> {
    let id = golden_name
        .strip_prefix("detect-fixture-json-")?
        .strip_suffix(".json")?;
    // The case id is the file name with non-alphanumerics replaced by `-`
    // and lower-cased; recover it by scanning the fixture directory.
    for ent in std::fs::read_dir(fixtures).ok()? {
        let ent = ent.ok()?;
        let name = ent.file_name().to_string_lossy().into_owned();
        let mut cid = String::new();
        let mut last_dash = false;
        for ch in name.chars() {
            if ch.is_ascii_alphanumeric() {
                cid.push(ch.to_ascii_lowercase());
                last_dash = false;
            } else if !last_dash {
                cid.push('-');
                last_dash = true;
            }
        }
        if cid == id {
            return Some(ent.path());
        }
    }
    None
}

#[test]
fn html_fixture_goldens_match() {
    let Some(repo) = public_repo() else {
        eprintln!("oracle_html: public repo not found; skipping");
        return;
    };
    let golden_dir = repo.join("tests/oracle/golden");
    let fixtures = repo.join("tests/fixtures/antipatterns");
    let repo_str = repo.to_string_lossy().into_owned();

    let mut names: Vec<String> = std::fs::read_dir(&golden_dir)
        .unwrap()
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.starts_with("detect-fixture-json-") && n.ends_with(".json"))
        .collect();
    names.sort();

    let mut matched = 0usize;
    let mut skipped: Vec<String> = Vec::new();
    let mut failures: Vec<String> = Vec::new();

    for name in &names {
        let Some(fixture) = fixture_for(name, &fixtures) else {
            skipped.push(format!("{name}: fixture not found"));
            continue;
        };
        let ext = fixture
            .extension()
            .map(|e| e.to_string_lossy().to_ascii_lowercase())
            .unwrap_or_default();
        if !fixture.is_file() || (ext != "html" && ext != "htm") {
            continue;
        }
        let golden: Value =
            serde_json::from_str(&std::fs::read_to_string(golden_dir.join(name)).unwrap()).unwrap();
        let stdout = golden["stdout"].as_str().unwrap_or("");
        let expected: Vec<Value> = if stdout.trim().is_empty() {
            Vec::new()
        } else {
            match serde_json::from_str::<Vec<Value>>(stdout) {
                Ok(v) => v,
                Err(e) => {
                    skipped.push(format!("{name}: golden stdout is not a JSON array ({e})"));
                    continue;
                }
            }
        };

        // The JS CLI passes the argv path through unchanged: `<REPO>/tests/...`.
        let rel = fixture.strip_prefix(&repo).unwrap();
        let masked_path = format!("<REPO>/{}", rel.to_string_lossy());
        let source = String::from_utf8_lossy(&std::fs::read(&fixture).unwrap()).into_owned();
        // Linked stylesheets resolve against the real file directory, so scan
        // with the real path and mask afterwards.
        let analyzers = run_text_content_analyzers;
        let opts = DetectHtmlOptions {
            inline_ignores_disabled: true,
            text_content_analyzers: Some(&analyzers),
            ..Default::default()
        };
        let findings = detect_html_source(&source, &fixture, &opts);
        let mut actual: Vec<Value> = serde_json::to_value(&findings)
            .unwrap()
            .as_array()
            .cloned()
            .unwrap();
        for f in &mut actual {
            if let Some(file) = f.get_mut("file") {
                if let Some(s) = file.as_str() {
                    let s = s.replace(&repo_str, "<REPO>");
                    *file = Value::String(s);
                }
            }
        }
        let _ = &masked_path;

        if actual == expected {
            matched += 1;
        } else {
            let exp_s = serde_json::to_string_pretty(&expected).unwrap();
            let act_s = serde_json::to_string_pretty(&actual).unwrap();
            let mut diff = String::new();
            let el: Vec<&str> = exp_s.lines().collect();
            let al: Vec<&str> = act_s.lines().collect();
            let mut shown = 0;
            for i in 0..el.len().max(al.len()) {
                let e = el.get(i).copied().unwrap_or("<eof>");
                let a = al.get(i).copied().unwrap_or("<eof>");
                if e != a {
                    diff.push_str(&format!(
                        "    line {}:\n      expected: {}\n      actual:   {}\n",
                        i + 1,
                        e,
                        a
                    ));
                    shown += 1;
                    if shown >= 12 {
                        diff.push_str("    ...\n");
                        break;
                    }
                }
            }
            failures.push(format!(
                "{name}: expected {} findings, got {}\n{}",
                expected.len(),
                actual.len(),
                diff
            ));
        }
    }

    eprintln!(
        "oracle_html: {matched} matched, {} mismatched, {} skipped",
        failures.len(),
        skipped.len()
    );
    for s in &skipped {
        eprintln!("  skipped {s}");
    }
    if !failures.is_empty() {
        panic!(
            "{} golden(s) mismatched:\n{}",
            failures.len(),
            failures.join("\n")
        );
    }
}

/// `detect-config-page-no-config`: the detect-config workspace page with
/// `--no-config --json` (the only workspace case that needs neither the CLI's
/// config filter nor the design-system hook).
#[test]
fn detect_config_workspace_no_config_matches() {
    let Some(repo) = public_repo() else {
        eprintln!("oracle_html: public repo not found; skipping");
        return;
    };
    let ws = repo.join("tests/oracle/workspaces/detect-config");
    let golden_path = repo.join("tests/oracle/golden/detect-config-page-no-config.json");
    let (Ok(golden_src), true) = (std::fs::read_to_string(&golden_path), ws.is_dir()) else {
        eprintln!("oracle_html: detect-config golden or workspace missing; skipping");
        return;
    };
    let golden: Value = serde_json::from_str(&golden_src).unwrap();
    let expected: Vec<Value> = serde_json::from_str(golden["stdout"].as_str().unwrap()).unwrap();
    let page = ws.join("src/page.html");
    let source = String::from_utf8_lossy(&std::fs::read(&page).unwrap()).into_owned();
    let analyzers = run_text_content_analyzers;
    let opts = DetectHtmlOptions {
        inline_ignores_disabled: true,
        text_content_analyzers: Some(&analyzers),
        ..Default::default()
    };
    let findings = detect_html_source(&source, &page, &opts);
    let mut actual: Vec<Value> = serde_json::to_value(&findings)
        .unwrap()
        .as_array()
        .cloned()
        .unwrap();
    let ws_str = ws.to_string_lossy().into_owned();
    for f in &mut actual {
        if let Some(Value::String(s)) = f.get_mut("file") {
            *s = s.replace(&ws_str, "<WS>");
        }
    }
    assert_eq!(actual, expected);
}
