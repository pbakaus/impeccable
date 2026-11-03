//! `impeccable detect --list-rules` prints the catalog and never scans.

use std::collections::HashMap;

use impeccable_common::Io;
use impeccable_core::registry::all_antipatterns;
use impeccable_detect::cli::run_detect;
use impeccable_detect::{Engines, MissingHtmlEngine};
use serde_json::Value;

fn run(args: &[&str]) -> (i32, String, String) {
    let args: Vec<String> = args.iter().map(|s| s.to_string()).collect();
    let (mut io, cap) = Io::captured("", std::env::temp_dir(), HashMap::new());
    let engines = Engines {
        html: &MissingHtmlEngine,
        url: None,
    };
    let code = run_detect(&args, &mut io, &engines);
    let out = String::from_utf8(cap.stdout.borrow().clone()).unwrap();
    let err = String::from_utf8(cap.stderr.borrow().clone()).unwrap();
    (code, out, err)
}

#[test]
fn list_rules_prints_the_catalog_on_stdout() {
    let n = all_antipatterns().count();
    let (code, out, err) = run(&["--list-rules"]);
    assert_eq!(code, 0, "{err}");
    assert!(err.is_empty(), "{err}");
    assert!(out.starts_with("slop\n"));
    assert!(out.contains("  side-tab\n"));
    assert!(out.contains("  bounce-easing  (advisory)\n"));
    assert!(out.contains("\nquality\n"));
    assert!(out.contains("  low-contrast\n"));
    assert!(out.ends_with(&format!("\n{n} rules.\n")));
}

#[test]
fn list_rules_json_is_an_array() {
    let n = all_antipatterns().count();
    let (code, out, err) = run(&["--list-rules", "--json"]);
    assert_eq!(code, 0, "{err}");
    assert!(err.is_empty(), "{err}");
    let parsed: Value = serde_json::from_str(out.trim_end()).unwrap();
    let arr = parsed.as_array().expect("array");
    assert_eq!(arr.len(), n);
    assert_eq!(arr[0]["id"], "side-tab");
}

#[test]
fn list_rules_quiet_prints_ids() {
    let n = all_antipatterns().count();
    let (code, out, err) = run(&["--list-rules", "--quiet"]);
    assert_eq!(code, 0, "{err}");
    assert!(err.is_empty(), "{err}");
    let lines: Vec<&str> = out.lines().collect();
    assert_eq!(lines.len(), n);
    assert_eq!(lines[0], "side-tab");
    assert_eq!(
        *lines.last().unwrap(),
        all_antipatterns().last().unwrap().id
    );
}

#[test]
fn list_rules_help_wins() {
    let (code, out, err) = run(&["--list-rules", "--help"]);
    assert_eq!(code, 0, "{err}");
    assert!(err.is_empty(), "{err}");
    assert!(out.starts_with("Usage: impeccable detect"));
    assert!(out.contains("--list-rules"));
    assert!(!out.contains("  side-tab\n"));
}

#[test]
fn list_rules_rejects_a_file_target() {
    let (code, out, err) = run(&["--list-rules", "src/"]);
    assert_eq!(code, 1);
    assert!(out.is_empty(), "{out}");
    assert_eq!(
        err,
        "Error: --list-rules prints the rule catalog and takes no file, URL, or --cdp scan\n"
    );
}

#[test]
fn list_rules_rejects_cdp() {
    let (code, _, err) = run(&["--list-rules", "--cdp", "9222"]);
    assert_eq!(code, 1);
    assert!(err.contains("--list-rules prints the rule catalog"));
}

#[test]
fn list_rules_scope_type_drops_unscoped_rules() {
    let (code, out, err) = run(&["--list-rules", "--quiet", "--scope", "type"]);
    assert_eq!(code, 0, "{err}");
    let ids: Vec<&str> = out.lines().collect();
    assert!(ids.contains(&"overused-font"));
    assert!(!ids.contains(&"side-tab"));
    assert!(!ids.contains(&"nested-cards"));
}

#[test]
fn list_rules_no_advisory_hides_advisory_ids() {
    let (code, out, err) = run(&["--list-rules", "--quiet", "--no-advisory"]);
    assert_eq!(code, 0, "{err}");
    let ids: Vec<&str> = out.lines().collect();
    assert!(ids.contains(&"side-tab"));
    assert!(!ids.contains(&"bounce-easing"));
    assert!(!ids.contains(&"em-dash-overuse"));
}
