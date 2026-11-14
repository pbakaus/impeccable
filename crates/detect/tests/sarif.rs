//! `impeccable detect --sarif` writes a SARIF 2.1.0 log and skips the
//! human-readable findings stream. A clean scan still writes the log.

use std::collections::HashMap;
use std::io::Write;
use std::path::Path;

use impeccable_common::Io;
use impeccable_core::findings::{finding, Finding};
use impeccable_detect::cli::run_detect;
use impeccable_detect::engines::EngineError;
use impeccable_detect::{Engines, HtmlEngine, MissingHtmlEngine, ScanOptions};
use serde_json::Value;

struct CannedHtml(Vec<Finding>);

impl HtmlEngine for CannedHtml {
    fn detect_html(
        &self,
        path: &str,
        _options: &ScanOptions,
        _stderr: &mut dyn Write,
    ) -> Result<Vec<Finding>, EngineError> {
        Ok(self
            .0
            .iter()
            .map(|f| {
                let mut row = f.clone();
                row.file = path.to_string();
                row
            })
            .collect())
    }
}

fn run_with(
    dir: &Path,
    args: &[&str],
    html: &dyn HtmlEngine,
    env: HashMap<String, String>,
) -> (i32, String, String) {
    let argv: Vec<String> = args.iter().map(|s| s.to_string()).collect();
    let (mut io, cap) = Io::captured("", dir.to_path_buf(), env);
    let engines = Engines { html, url: None };
    let code = run_detect(&argv, &mut io, &engines);
    let out = String::from_utf8(cap.stdout.borrow().clone()).unwrap();
    let err = String::from_utf8(cap.stderr.borrow().clone()).unwrap();
    (code, out, err)
}

fn stage_card(dir: &Path) {
    std::fs::create_dir_all(dir).unwrap();
    std::fs::write(
        dir.join("card.html"),
        "<div style=\"border-left: 4px solid #ff0000; border-radius: 10px\">x</div>\n",
    )
    .unwrap();
}

fn sarif(out: &str) -> Value {
    assert!(out.ends_with('\n'), "{out}");
    serde_json::from_str(out.trim_end()).unwrap_or_else(|e| panic!("{e}\n{out}"))
}

fn temp(tag: &str) -> std::path::PathBuf {
    std::env::temp_dir().join(format!("impeccable-sarif-{tag}-{}", std::process::id()))
}

#[test]
fn sarif_writes_a_log_to_stdout() {
    let dir = temp("ann");
    stage_card(&dir);
    let html = CannedHtml(vec![finding("side-tab", "", "border-left: 4px", 1.0)]);
    let (code, out, err) = run_with(
        &dir,
        &["--no-config", "--sarif", "card.html"],
        &html,
        HashMap::new(),
    );
    assert_eq!(code, 2, "{err}");
    assert!(err.is_empty(), "{err}");
    let log = sarif(&out);
    assert_eq!(log["version"], "2.1.0");
    assert_eq!(log["runs"][0]["tool"]["driver"]["name"], "impeccable");
    assert_eq!(
        log["runs"][0]["tool"]["driver"]["version"],
        env!("CARGO_PKG_VERSION")
    );
    assert_eq!(
        log["runs"][0]["tool"]["driver"]["informationUri"],
        "https://impeccable.style"
    );
    let rules = log["runs"][0]["tool"]["driver"]["rules"]
        .as_array()
        .unwrap();
    assert_eq!(rules.len(), 1);
    assert_eq!(rules[0]["id"], "side-tab");
    assert_eq!(rules[0]["name"], "Side-tab accent border");
    assert_eq!(
        rules[0]["shortDescription"]["text"],
        "Side-tab accent border"
    );
    assert!(rules[0]["help"]["text"]
        .as_str()
        .unwrap()
        .contains("Thick colored border"));
    assert_eq!(rules[0]["properties"]["category"], "slop");
    let result = &log["runs"][0]["results"][0];
    assert_eq!(result["ruleId"], "side-tab");
    assert_eq!(result["ruleIndex"], 0);
    assert_eq!(result["level"], "warning");
    let message = result["message"]["text"].as_str().unwrap();
    assert!(message.starts_with("border-left: 4px\n"), "{message}");
    assert!(message.contains("Thick colored border"), "{message}");
    let loc = &result["locations"][0]["physicalLocation"];
    assert_eq!(loc["artifactLocation"]["uri"], "card.html");
    assert_eq!(loc["artifactLocation"]["uriBaseId"], "%SRCROOT%");
    assert_eq!(loc["region"]["startLine"], 1);
    assert!(!out.contains("partialFingerprints"), "{out}");
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn sarif_advisory_is_note_and_does_not_fail() {
    let dir = temp("notice");
    stage_card(&dir);
    let html = CannedHtml(vec![finding("em-dash-overuse", "", "—", 2.0)]);
    let (code, out, err) = run_with(
        &dir,
        &["--no-config", "--sarif", "card.html"],
        &html,
        HashMap::new(),
    );
    assert_eq!(code, 0, "{err}");
    let log = sarif(&out);
    assert_eq!(log["runs"][0]["results"][0]["level"], "note");
    assert_eq!(log["runs"][0]["results"][0]["ruleId"], "em-dash-overuse");
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn sarif_error_severity_is_error() {
    let dir = temp("err");
    stage_card(&dir);
    let html = CannedHtml(vec![finding("script-error", "", "TypeError: x", 9.0)]);
    let (code, out, err) = run_with(
        &dir,
        &["--no-config", "--sarif", "card.html"],
        &html,
        HashMap::new(),
    );
    assert_eq!(code, 2, "{err}");
    let log = sarif(&out);
    assert_eq!(log["runs"][0]["results"][0]["level"], "error");
    assert_eq!(
        log["runs"][0]["results"][0]["locations"][0]["physicalLocation"]["region"]["startLine"],
        9
    );
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn sarif_omits_start_line_when_the_finding_has_none() {
    let dir = temp("line0");
    stage_card(&dir);
    let html = CannedHtml(vec![finding("side-tab", "", "snip", 0.0)]);
    let (code, out, err) = run_with(
        &dir,
        &["--no-config", "--sarif", "card.html"],
        &html,
        HashMap::new(),
    );
    assert_eq!(code, 2, "{err}");
    let log = sarif(&out);
    let phys = &log["runs"][0]["results"][0]["locations"][0]["physicalLocation"];
    assert!(phys.get("region").is_none(), "{phys}");
    assert_eq!(phys["artifactLocation"]["uri"], "card.html");
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn sarif_workspace_relativizes_nested_cwd() {
    let dir = temp("ws");
    let nested = dir.join("packages").join("web");
    stage_card(&nested);
    let html = CannedHtml(vec![finding("side-tab", "", "snip", 1.0)]);
    let mut env = HashMap::new();
    env.insert(
        "GITHUB_WORKSPACE".into(),
        dir.to_string_lossy().into_owned(),
    );
    let (code, out, err) = run_with(
        &nested,
        &["--no-config", "--sarif", "card.html"],
        &html,
        env,
    );
    assert_eq!(code, 2, "{err}");
    let log = sarif(&out);
    assert_eq!(
        log["runs"][0]["results"][0]["locations"][0]["physicalLocation"]["artifactLocation"]["uri"],
        "packages/web/card.html"
    );
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn sarif_clean_scan_writes_empty_results() {
    let dir = temp("clean");
    stage_card(&dir);
    let (code, out, err) = run_with(
        &dir,
        &["--no-config", "--sarif", "card.html"],
        &CannedHtml(vec![]),
        HashMap::new(),
    );
    assert_eq!(code, 0, "{err}");
    assert!(err.is_empty(), "{err}");
    let log = sarif(&out);
    assert!(log["runs"][0]["results"].as_array().unwrap().is_empty());
    assert!(log["runs"][0]["tool"]["driver"]["rules"]
        .as_array()
        .unwrap()
        .is_empty());
    assert_eq!(log["version"], "2.1.0");
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn sarif_missing_file_exits_1_with_a_log_marked_unsuccessful() {
    let dir = temp("miss");
    std::fs::create_dir_all(&dir).unwrap();
    let (code, out, err) = run_with(
        &dir,
        &["--no-config", "--sarif", "missing.html"],
        &MissingHtmlEngine,
        HashMap::new(),
    );
    assert_eq!(code, 1, "{err}");
    assert!(err.contains("cannot access"), "{err}");
    let log = sarif(&out);
    assert!(log["runs"][0]["results"].as_array().unwrap().is_empty());
    // An empty log from a failed scan is not a clean scan: it says so.
    let inv = &log["runs"][0]["invocations"][0];
    assert_eq!(inv["executionSuccessful"], false, "{inv}");
    assert_eq!(inv["toolExecutionNotifications"][0]["level"], "error");
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn sarif_partial_scan_keeps_exit_1_and_the_finding() {
    let dir = temp("partial");
    stage_card(&dir);
    let html = CannedHtml(vec![finding("side-tab", "", "snip", 1.0)]);
    let (code, out, err) = run_with(
        &dir,
        &["--no-config", "--sarif", "card.html", "missing.html"],
        &html,
        HashMap::new(),
    );
    assert_eq!(code, 1, "{err}");
    assert!(err.contains("cannot access"), "{err}");
    let log = sarif(&out);
    assert_eq!(log["runs"][0]["results"].as_array().unwrap().len(), 1);
    assert_eq!(
        log["runs"][0]["invocations"][0]["executionSuccessful"],
        false
    );
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn sarif_conflicts_with_json() {
    let dir = temp("json");
    stage_card(&dir);
    let (code, out, err) = run_with(
        &dir,
        &["--sarif", "--json", "card.html"],
        &MissingHtmlEngine,
        HashMap::new(),
    );
    assert_eq!(code, 1);
    assert!(out.is_empty(), "{out}");
    assert_eq!(err, "Error: --sarif cannot be used with --json\n");
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn sarif_conflicts_with_github() {
    let dir = temp("gh");
    std::fs::create_dir_all(&dir).unwrap();
    let (code, out, err) = run_with(
        &dir,
        &["--sarif", "--github", "card.html"],
        &MissingHtmlEngine,
        HashMap::new(),
    );
    assert_eq!(code, 1);
    assert!(out.is_empty(), "{out}");
    assert_eq!(err, "Error: --sarif cannot be used with --github\n");
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn sarif_conflicts_with_list_rules() {
    let dir = temp("list");
    std::fs::create_dir_all(&dir).unwrap();
    for args in [
        &["--list-rules", "--sarif"][..],
        &["--list-rules", "--sarif", "--json"][..],
    ] {
        let (code, out, err) = run_with(&dir, args, &MissingHtmlEngine, HashMap::new());
        assert_eq!(code, 1, "{args:?} {err}");
        assert!(out.is_empty(), "{out}");
        assert_eq!(
            err,
            "Error: --sarif writes a SARIF log of scan findings and cannot be used with --list-rules\n"
        );
    }
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn sarif_help_wins() {
    let (code, out, err) = run_with(
        Path::new("/tmp"),
        &["--sarif", "--json", "--github", "--list-rules", "--help"],
        &MissingHtmlEngine,
        HashMap::new(),
    );
    assert_eq!(code, 0, "{err}");
    assert!(err.is_empty(), "{err}");
    assert!(out.starts_with("Usage: impeccable detect"));
    assert!(out.contains("--sarif"));
    assert!(out.contains("code scanning"));
    assert!(!out.contains("\"$schema\""));
    assert!(!out.contains("::warning"));
}

#[test]
fn sarif_quiet_still_writes_the_log() {
    let dir = temp("quiet");
    stage_card(&dir);
    let html = CannedHtml(vec![finding("side-tab", "", "snip", 4.0)]);
    let (code, out, err) = run_with(
        &dir,
        &["--no-config", "--sarif", "--quiet", "card.html"],
        &html,
        HashMap::new(),
    );
    assert_eq!(code, 2, "{err}");
    assert!(err.is_empty(), "{err}");
    let log = sarif(&out);
    assert_eq!(
        log["runs"][0]["results"][0]["locations"][0]["physicalLocation"]["region"]["startLine"],
        4
    );
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn sarif_no_advisory_drops_notes() {
    let dir = temp("adv");
    stage_card(&dir);
    let html = CannedHtml(vec![
        finding("side-tab", "", "primary", 1.0),
        finding("em-dash-overuse", "", "—", 2.0),
    ]);
    let (code, out, err) = run_with(
        &dir,
        &["--no-config", "--sarif", "--no-advisory", "card.html"],
        &html,
        HashMap::new(),
    );
    assert_eq!(code, 2, "{err}");
    let log = sarif(&out);
    let results = log["runs"][0]["results"].as_array().unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0]["ruleId"], "side-tab");
    assert_eq!(results[0]["level"], "warning");
    let rules = log["runs"][0]["tool"]["driver"]["rules"]
        .as_array()
        .unwrap();
    assert_eq!(rules.len(), 1);
    assert!(!out.contains("em-dash-overuse"));
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn sarif_skips_the_regex_only_note() {
    let dir = temp("regex");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("probe.astro"), "<p>ok</p>\n").unwrap();
    let (code, out, err) = run_with(
        &dir,
        &["--no-config", "--sarif", "probe.astro"],
        &MissingHtmlEngine,
        HashMap::new(),
    );
    assert_eq!(code, 0, "{err}");
    assert!(!err.contains("regex matching only"), "{err}");
    let log = sarif(&out);
    assert!(log["runs"][0]["results"].as_array().unwrap().is_empty());
    std::fs::remove_dir_all(&dir).unwrap();
}

fn stage_framework_dir(tag: &str) -> std::path::PathBuf {
    let dir = temp(&format!("fw-{tag}"));
    stage_card(&dir);
    std::fs::write(
        dir.join("next.config.js"),
        "module.exports = { port: 59871 };\n",
    )
    .unwrap();
    dir
}

#[test]
fn sarif_skips_the_framework_note() {
    let dir = stage_framework_dir("sarif");
    let (code, _out, err) = run_with(
        &dir,
        &["--no-config", "--sarif", "."],
        &CannedHtml(vec![]),
        HashMap::new(),
    );
    assert_eq!(code, 0, "{err}");
    assert!(!err.contains("project detected"), "{err}");
    assert!(!err.contains("dev server detected"), "{err}");
    std::fs::remove_dir_all(&dir).unwrap();
}

fn run_tty(dir: &Path, args: &[&str]) -> (i32, String, String) {
    let argv: Vec<String> = args.iter().map(|s| s.to_string()).collect();
    let (mut io, cap) = Io::captured("", dir.to_path_buf(), HashMap::new());
    io.stdin_is_tty = true;
    let html = CannedHtml(vec![]);
    let engines = Engines {
        html: &html,
        url: None,
    };
    let code = run_detect(&argv, &mut io, &engines);
    let out = String::from_utf8(cap.stdout.borrow().clone()).unwrap();
    let err = String::from_utf8(cap.stderr.borrow().clone()).unwrap();
    (code, out, err)
}

#[test]
fn sarif_skips_the_large_scan_prompt() {
    let dir = temp("many");
    std::fs::create_dir_all(&dir).unwrap();
    for i in 0..51 {
        std::fs::write(dir.join(format!("f{i}.css")), "body { margin: 0; }\n").unwrap();
    }
    let (code, _out, err) = run_tty(&dir, &["--no-config", "--sarif", "."]);
    assert_eq!(code, 0, "{err}");
    assert!(!err.contains("Found 51 files"), "{err}");
    assert!(!err.contains("Continue?"), "{err}");
    std::fs::remove_dir_all(&dir).unwrap();
}
