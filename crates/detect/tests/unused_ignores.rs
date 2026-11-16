//! `impeccable detect --report-unused-ignores` reports inline waivers that
//! matched nothing, on the same findings stream as every other rule.

use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};

use impeccable_common::Io;
use impeccable_core::findings::{finding, Finding};
use impeccable_detect::cli::run_detect;
use impeccable_detect::engines::EngineError;
use impeccable_detect::unused_ignores::{UNUSED_IGNORE_ID, UNUSED_IGNORE_NAME};
use impeccable_detect::{Engines, HtmlEngine, MissingHtmlEngine, ScanOptions};
use serde_json::Value;

fn fixture_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/unused-ignores")
}

fn run_in(dir: &Path, args: &[&str], html: &dyn HtmlEngine) -> (i32, String, String) {
    let argv: Vec<String> = args.iter().map(|s| s.to_string()).collect();
    let (mut io, cap) = Io::captured("", dir.to_path_buf(), HashMap::new());
    let engines = Engines { html, url: None };
    let code = run_detect(&argv, &mut io, &engines);
    let out = String::from_utf8(cap.stdout.borrow().clone()).unwrap();
    let err = String::from_utf8(cap.stderr.borrow().clone()).unwrap();
    (code, out, err)
}

fn run(args: &[&str]) -> (i32, String, String) {
    run_in(&fixture_dir(), args, &MissingHtmlEngine)
}

fn json_findings(out: &str) -> Vec<Value> {
    serde_json::from_str(out.trim_end()).unwrap_or_else(|e| panic!("{e}: {out}"))
}

fn snippets(findings: &[Value]) -> Vec<&str> {
    findings
        .iter()
        .map(|f| f["snippet"].as_str().unwrap_or(""))
        .collect()
}

#[test]
fn stale_line_and_next_line_are_reported_and_the_live_ones_are_not() {
    let (code, out, err) = run(&[
        "--no-design-system",
        "--json",
        "--report-unused-ignores",
        "brand.css",
    ]);
    assert_eq!(code, 2, "{err}{out}");
    assert!(err.is_empty(), "{err}");
    let findings = json_findings(&out);
    assert!(findings
        .iter()
        .all(|f| f["antipattern"] == UNUSED_IGNORE_ID));
    assert_eq!(
        snippets(&findings),
        vec![
            "impeccable-disable-line bounce-easing",
            "impeccable-disable-next-line bounce-easing",
        ]
    );
    assert_eq!(findings[0]["line"], 2);
    assert_eq!(findings[1]["line"], 5);
    assert_eq!(findings[0]["severity"], "warning");
    assert!(findings[0].get("advisory").is_none());
    assert!(findings[0]["name"] == UNUSED_IGNORE_NAME);
    // The live half of the multi-rule comment, and the live next-line, stay quiet.
    assert!(!out.contains("overused-font"));
    assert_eq!(
        findings
            .iter()
            .filter(|f| f["snippet"] == "impeccable-disable-next-line bounce-easing")
            .count(),
        1
    );
}

#[test]
fn text_quiet_and_github_carry_the_same_finding() {
    let (code, out, err) = run(&["--no-design-system", "--report-unused-ignores", "brand.css"]);
    assert_eq!(code, 2, "{err}");
    assert!(out.is_empty(), "{out}");
    assert!(err.contains("brand.css"));
    assert!(err.contains("  line 2: [unused-ignore] impeccable-disable-line bounce-easing\n"));
    assert!(err.contains("  line 5: [unused-ignore] impeccable-disable-next-line bounce-easing\n"));
    assert!(err.contains("\n2 unused inline ignores found.\n"));
    assert!(!err.contains("overused-font"));

    let (code, out, err) = run(&[
        "--no-design-system",
        "--quiet",
        "--report-unused-ignores",
        "brand.css",
    ]);
    assert_eq!(code, 2, "{err}");
    assert!(out.is_empty(), "{out}");
    assert_eq!(err, "2 unused inline ignores found.\n");

    let (code, out, err) = run(&[
        "--no-design-system",
        "--github",
        "--report-unused-ignores",
        "brand.css",
    ]);
    assert_eq!(code, 2, "{err}");
    assert!(err.is_empty(), "{err}");
    assert!(out.contains(&format!(
        "::warning file=brand.css,line=2,title={UNUSED_IGNORE_NAME}::[unused-ignore] impeccable-disable-line bounce-easing%0A"
    )));
    assert!(out.contains("line=5,"));
    assert!(out.ends_with('\n'));
}

#[test]
fn file_level_star_is_unused_when_the_file_is_clean() {
    let (code, out, err) = run(&[
        "--no-design-system",
        "--json",
        "--report-unused-ignores",
        "Quiet.tsx",
    ]);
    assert_eq!(code, 2, "{err}{out}");
    let findings = json_findings(&out);
    assert_eq!(findings.len(), 1);
    assert_eq!(findings[0]["snippet"], "impeccable-disable *");
    assert_eq!(findings[0]["line"], 1);
    assert_eq!(findings[0]["antipattern"], UNUSED_IGNORE_ID);
}

#[test]
fn a_live_waiver_on_its_own_is_silent() {
    let dir = std::env::temp_dir().join(format!("impeccable-unused-live-{}", std::process::id()));
    if dir.exists() {
        std::fs::remove_dir_all(&dir).unwrap();
    }
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("hero.css"),
        "/* impeccable-disable-next-line bounce-easing: the spring is the point */\n.hero { transition-timing-function: cubic-bezier(0.68, -0.55, 0.265, 1.55); }\n",
    )
    .unwrap();
    let (code, out, err) = run_in(
        &dir,
        &[
            "--no-design-system",
            "--json",
            "--report-unused-ignores",
            "hero.css",
        ],
        &MissingHtmlEngine,
    );
    assert_eq!(code, 0, "{err}{out}");
    assert_eq!(out, "[]\n");
    assert!(err.is_empty(), "{err}");
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn without_the_flag_a_stale_waiver_stays_silent() {
    let (code, out, err) = run(&["--no-design-system", "--json", "brand.css"]);
    assert_eq!(code, 0, "{err}{out}");
    assert_eq!(out, "[]\n");
    assert!(!err.contains("unused-ignore"));
    assert!(!out.contains("unused-ignore"));
}

#[test]
fn scope_still_reports_unused_ignores() {
    let (code, out, err) = run(&[
        "--no-design-system",
        "--json",
        "--scope",
        "type",
        "--report-unused-ignores",
        "brand.css",
    ]);
    assert_eq!(code, 2, "{err}{out}");
    let findings = json_findings(&out);
    assert_eq!(snippets(&findings).len(), 2);
    assert!(findings
        .iter()
        .all(|f| f["antipattern"] == UNUSED_IGNORE_ID));
}

#[test]
fn conflicts_with_disabled_inline_ignores() {
    for args in [
        &[
            "--report-unused-ignores",
            "--no-inline-ignores",
            "brand.css",
        ][..],
        &["--report-unused-ignores", "--no-config", "brand.css"][..],
    ] {
        let (code, out, err) = run(args);
        assert_eq!(code, 1, "{args:?} {err}");
        assert!(out.is_empty(), "{out}");
        assert_eq!(
            err,
            "Error: --report-unused-ignores needs inline ignores enabled\n"
        );
    }
}

#[test]
fn help_wins_and_lists_the_flag() {
    let (code, out, err) = run(&["--report-unused-ignores", "--no-config", "--help"]);
    assert_eq!(code, 0, "{err}");
    assert!(err.is_empty(), "{err}");
    assert!(out.contains("--report-unused-ignores"));
    assert!(out.contains("unused-ignore"));
    assert!(!out.contains("Error:"));
}

#[test]
fn list_rules_does_not_grow_a_synthetic_rule() {
    let (code, out, err) = run(&["--list-rules", "--quiet", "--report-unused-ignores"]);
    assert_eq!(code, 0, "{err}");
    assert!(!out.lines().any(|line| line == "unused-ignore"), "{out}");
}

#[test]
fn a_url_target_accepts_the_flag() {
    let (code, out, err) = run(&["--report-unused-ignores", "https://example.com"]);
    assert_eq!(code, 1, "{out}");
    assert!(!err.contains("needs inline ignores"), "{err}");
    assert!(err.contains("Error:"), "{err}");
}

/// The HTML engine is not linked into this crate. A stand-in returns the
/// line-less side-tab the static engine reports for `page.html`, and the
/// CLI's own pass waives it and keeps the stale file-level comment.
struct SideTabHtml;

impl HtmlEngine for SideTabHtml {
    fn detect_html(
        &self,
        path: &str,
        options: &ScanOptions,
        _stderr: &mut dyn Write,
    ) -> Result<Vec<Finding>, EngineError> {
        assert!(
            !options.inline_ignores,
            "the flag asks the engine for raw findings"
        );
        Ok(vec![finding(
            "side-tab",
            path,
            "border-left: 4px + border-radius: 10px",
            0.0,
        )])
    }
}

#[test]
fn html_file_reports_the_stale_file_waiver_and_keeps_the_live_one() {
    let (code, out, err) = run_in(
        &fixture_dir(),
        &[
            "--no-design-system",
            "--json",
            "--report-unused-ignores",
            "page.html",
        ],
        &SideTabHtml,
    );
    assert_eq!(code, 2, "{err}{out}");
    let findings = json_findings(&out);
    assert_eq!(findings.len(), 1, "{out}");
    assert_eq!(findings[0]["antipattern"], UNUSED_IGNORE_ID);
    assert_eq!(findings[0]["snippet"], "impeccable-disable bounce-easing");
    assert_eq!(findings[0]["line"], 5);
    assert!(!out.contains("side-tab"));
}

/// The static HTML engine decodes invalid UTF-8 lossily and still scans.
/// The waiver pass has to read the same way: a strict read fails, and the
/// raw ignores-off findings (here, side-tab) would leak.
#[test]
fn non_utf8_html_keeps_waived_findings_out_and_reports_the_stale_one() {
    let dir = std::env::temp_dir().join(format!("impeccable-unused-latin1-{}", std::process::id()));
    if dir.exists() {
        std::fs::remove_dir_all(&dir).unwrap();
    }
    std::fs::create_dir_all(&dir).unwrap();
    let mut bytes = Vec::new();
    bytes.extend_from_slice(b"<!-- impeccable-disable side-tab -->\n");
    bytes.extend_from_slice(b"<p>caf\xe9</p>\n");
    bytes.extend_from_slice(b"<!-- impeccable-disable bounce-easing -->\n");
    std::fs::write(dir.join("page.html"), bytes).unwrap();
    let (code, out, err) = run_in(
        &dir,
        &[
            "--no-design-system",
            "--json",
            "--report-unused-ignores",
            "page.html",
        ],
        &SideTabHtml,
    );
    assert_eq!(code, 2, "{err}{out}");
    assert!(err.is_empty(), "{err}");
    let findings = json_findings(&out);
    assert_eq!(findings.len(), 1, "{out}");
    assert_eq!(findings[0]["antipattern"], UNUSED_IGNORE_ID);
    assert_eq!(findings[0]["snippet"], "impeccable-disable bounce-easing");
    assert_eq!(findings[0]["line"], 3);
    assert!(!out.contains("side-tab"));
    std::fs::remove_dir_all(&dir).unwrap();
}

/// The regex engine's rule list is what lets a CSS or TSX scan leave a
/// `low-contrast` or `tiny-text` waiver unjudged. It must still name every
/// rule that engine reports, or a stale waiver for that rule goes unreported:
/// run it over every antipattern fixture and check.
#[test]
fn regex_engine_rule_ids_name_every_rule_the_engine_reports() {
    use impeccable_detect::detect_text::{
        detect_text, regex_engine_rule_ids, should_run_page_analyzers, TextOptions,
    };
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/antipatterns");
    let mut stack = vec![root];
    let mut scanned = 0;
    while let Some(dir) = stack.pop() {
        for entry in std::fs::read_dir(&dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            let Ok(content) = std::fs::read_to_string(&path) else {
                continue;
            };
            let file = path.to_string_lossy().into_owned();
            let ids = regex_engine_rule_ids(should_run_page_analyzers(&content, &file));
            let options = TextOptions::default();
            for found in detect_text(&content, &file, &options) {
                assert!(
                    ids.contains(&found.antipattern.as_str()),
                    "{file} reports {} but regex_engine_rule_ids does not list it",
                    found.antipattern
                );
            }
            scanned += 1;
        }
    }
    assert!(scanned > 50, "only {scanned} fixtures scanned");
}

/// A CSS scan runs the regex engine, which has no `low-contrast` or
/// `tiny-text` rule, so their waivers are not reported as stale and the run
/// exits clean. The `bounce-easing` waiver beside them still is.
#[test]
fn a_css_scan_does_not_judge_element_rule_waivers() {
    let dir =
        std::env::temp_dir().join(format!("impeccable-unused-element-{}", std::process::id()));
    if dir.exists() {
        std::fs::remove_dir_all(&dir).unwrap();
    }
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("muted.css"),
        "/* impeccable-disable low-contrast, tiny-text: checked in the browser */\n.muted { color: #999; font-size: 10px; }\n",
    )
    .unwrap();
    let args = [
        "--no-design-system",
        "--json",
        "--report-unused-ignores",
        "muted.css",
    ];
    let (code, out, err) = run_in(&dir, &args, &MissingHtmlEngine);
    assert_eq!(code, 0, "{err}{out}");
    assert_eq!(out, "[]\n");
    std::fs::write(
        dir.join("muted.css"),
        "/* impeccable-disable low-contrast, bounce-easing */\n.muted { color: #999; }\n",
    )
    .unwrap();
    let (code, out, err) = run_in(&dir, &args, &MissingHtmlEngine);
    assert_eq!(code, 2, "{err}{out}");
    let findings = json_findings(&out);
    assert_eq!(
        snippets(&findings),
        vec!["impeccable-disable bounce-easing"]
    );
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn the_design_health_scan_leaves_unused_ignores_out() {
    let dir = std::env::temp_dir().join(format!("impeccable-unused-health-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::copy(fixture_dir().join("brand.css"), dir.join("brand.css")).unwrap();
    let scan = |args: &[&str]| {
        let argv: Vec<String> = args.iter().map(|s| s.to_string()).collect();
        let (mut io, cap) = Io::captured("", dir.clone(), HashMap::new());
        let engines = Engines {
            html: &MissingHtmlEngine,
            url: None,
        };
        let mut report = None;
        let code = impeccable_detect::cli::run_detect_reporting(
            &argv,
            &mut io,
            &engines,
            None,
            &mut report,
        );
        let out = String::from_utf8(cap.stdout.borrow().clone()).unwrap();
        (code, out, report.expect("a whole-directory scan"))
    };
    let (code, out, with_flag) = scan(&[
        "--no-design-system",
        "--json",
        "--report-unused-ignores",
        ".",
    ]);
    let (_, _, without) = scan(&["--no-design-system", "--json", "."]);
    let _ = std::fs::remove_dir_all(&dir);
    // The flag still reports the stale waivers to the user...
    assert_eq!(code, 2, "{out}");
    assert!(json_findings(&out)
        .iter()
        .any(|f| f["antipattern"] == UNUSED_IGNORE_ID));
    // ...but the snapshot design health uploads is the one without it.
    assert!(with_flag
        .findings
        .iter()
        .all(|f| f.antipattern != UNUSED_IGNORE_ID));
    assert_eq!(with_flag.findings.len(), without.findings.len());
    assert_eq!(with_flag.ruleset, without.ruleset);
}
