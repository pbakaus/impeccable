//! `impeccable detect --github` writes Actions workflow commands and skips
//! the human-readable findings stream.

use std::collections::HashMap;
use std::io::Write;
use std::path::Path;

use impeccable_common::Io;
use impeccable_core::findings::{finding, Finding};
use impeccable_detect::cli::run_detect;
use impeccable_detect::engines::EngineError;
use impeccable_detect::{Engines, HtmlEngine, MissingHtmlEngine, ScanOptions};

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

#[test]
fn github_writes_annotations_to_stdout() {
    let dir = std::env::temp_dir().join(format!("impeccable-gh-ann-{}", std::process::id()));
    stage_card(&dir);
    let html = CannedHtml(vec![finding("side-tab", "", "border-left: 4px", 1.0)]);
    let (code, out, err) = run_with(
        &dir,
        &["--no-config", "--github", "card.html"],
        &html,
        HashMap::new(),
    );
    assert_eq!(code, 2, "{err}");
    assert!(err.is_empty(), "{err}");
    assert!(out.starts_with("::warning file=card.html,line=1,title=Side-tab accent border::"));
    assert!(out.contains("[side-tab] border-left: 4px%0A"));
    assert!(out.ends_with('\n'));
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn github_conflicts_with_json() {
    let dir = std::env::temp_dir().join(format!("impeccable-gh-json-{}", std::process::id()));
    stage_card(&dir);
    let (code, out, err) = run_with(
        &dir,
        &["--github", "--json", "card.html"],
        &MissingHtmlEngine,
        HashMap::new(),
    );
    assert_eq!(code, 1);
    assert!(out.is_empty(), "{out}");
    assert_eq!(err, "Error: --github cannot be used with --json\n");
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn github_help_wins() {
    let (code, out, err) = run_with(
        Path::new("/tmp"),
        &["--github", "--help"],
        &MissingHtmlEngine,
        HashMap::new(),
    );
    assert_eq!(code, 0, "{err}");
    assert!(err.is_empty(), "{err}");
    assert!(out.starts_with("Usage: impeccable detect"));
    assert!(out.contains("--github"));
    assert!(!out.contains("::warning"));
}

#[test]
fn github_quiet_still_annotates() {
    let dir = std::env::temp_dir().join(format!("impeccable-gh-quiet-{}", std::process::id()));
    stage_card(&dir);
    let html = CannedHtml(vec![finding("side-tab", "", "snip", 4.0)]);
    let (code, out, err) = run_with(
        &dir,
        &["--no-config", "--github", "--quiet", "card.html"],
        &html,
        HashMap::new(),
    );
    assert_eq!(code, 2, "{err}");
    assert!(err.is_empty(), "{err}");
    assert!(out.contains("::warning file=card.html,line=4,"));
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn github_no_advisory_drops_notices() {
    let dir = std::env::temp_dir().join(format!("impeccable-gh-adv-{}", std::process::id()));
    stage_card(&dir);
    let html = CannedHtml(vec![
        finding("side-tab", "", "primary", 1.0),
        finding("em-dash-overuse", "", "—", 2.0),
    ]);
    let (code, out, err) = run_with(
        &dir,
        &["--no-config", "--github", "--no-advisory", "card.html"],
        &html,
        HashMap::new(),
    );
    assert_eq!(code, 2, "{err}");
    assert!(out.contains("::warning "));
    assert!(!out.contains("::notice "));
    assert!(!out.contains("em-dash-overuse"));
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn github_advisory_is_notice_and_does_not_fail() {
    let dir = std::env::temp_dir().join(format!("impeccable-gh-notice-{}", std::process::id()));
    stage_card(&dir);
    let html = CannedHtml(vec![finding("em-dash-overuse", "", "—", 2.0)]);
    let (code, out, err) = run_with(
        &dir,
        &["--no-config", "--github", "card.html"],
        &html,
        HashMap::new(),
    );
    assert_eq!(code, 0, "{err}");
    assert!(out.starts_with("::notice file=card.html,line=2,title=Em-dash overuse::"));
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn github_error_severity_is_an_error_annotation() {
    let dir = std::env::temp_dir().join(format!("impeccable-gh-err-{}", std::process::id()));
    stage_card(&dir);
    let html = CannedHtml(vec![finding("script-error", "", "TypeError: x", 9.0)]);
    let (code, out, err) = run_with(
        &dir,
        &["--no-config", "--github", "card.html"],
        &html,
        HashMap::new(),
    );
    assert_eq!(code, 2, "{err}");
    assert!(out.starts_with("::error file=card.html,line=9,title=Uncaught script error on load::"));
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn github_clean_scan_is_silent() {
    let dir = std::env::temp_dir().join(format!("impeccable-gh-clean-{}", std::process::id()));
    stage_card(&dir);
    let (code, out, err) = run_with(
        &dir,
        &["--no-config", "--github", "card.html"],
        &CannedHtml(vec![]),
        HashMap::new(),
    );
    assert_eq!(code, 0, "{err}");
    assert!(out.is_empty(), "{out}");
    assert!(err.is_empty(), "{err}");
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn github_workspace_relativizes_nested_cwd() {
    let dir = std::env::temp_dir().join(format!("impeccable-gh-ws-{}", std::process::id()));
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
        &["--no-config", "--github", "card.html"],
        &html,
        env,
    );
    assert_eq!(code, 2, "{err}");
    assert!(
        out.contains("file=packages/web/card.html"),
        "{out}"
    );
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn github_skips_the_regex_only_note() {
    let dir = std::env::temp_dir().join(format!("impeccable-gh-regex-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("probe.astro"), "<p>ok</p>\n").unwrap();
    let (code, out, err) = run_with(
        &dir,
        &["--no-config", "--github", "probe.astro"],
        &MissingHtmlEngine,
        HashMap::new(),
    );
    assert_eq!(code, 0, "{err}");
    assert!(out.is_empty(), "{out}");
    assert!(
        !err.contains("regex matching only"),
        "{err}"
    );
    std::fs::remove_dir_all(&dir).unwrap();
}

fn stage_framework_dir(tag: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("impeccable-gh-fw-{tag}-{}", std::process::id()));
    stage_card(&dir);
    // An unlikely port keeps the probe from finding a real dev server.
    std::fs::write(dir.join("next.config.js"), "module.exports = { port: 59871 };\n").unwrap();
    dir
}

#[test]
fn github_skips_the_framework_note() {
    let dir = stage_framework_dir("gh");
    let (code, _out, err) = run_with(
        &dir,
        &["--no-config", "--github", "."],
        &CannedHtml(vec![]),
        HashMap::new(),
    );
    assert_eq!(code, 0, "{err}");
    assert!(!err.contains("project detected"), "{err}");
    assert!(!err.contains("dev server detected"), "{err}");
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn text_mode_prints_the_framework_note() {
    let dir = stage_framework_dir("text");
    let (_code, _out, err) = run_with(&dir, &["--no-config", "."], &CannedHtml(vec![]), HashMap::new());
    assert!(err.contains("Next.js"), "{err}");
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn github_conflicts_with_list_rules() {
    let dir = std::env::temp_dir().join(format!("impeccable-gh-list-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    for args in [&["--list-rules", "--github"][..], &["--list-rules", "--github", "--json"][..]] {
        let (code, out, err) = run_with(&dir, args, &MissingHtmlEngine, HashMap::new());
        assert_eq!(code, 1, "{args:?}");
        assert!(out.is_empty(), "{out}");
        assert_eq!(
            err,
            "Error: --github annotates scan findings and cannot be used with --list-rules\n"
        );
    }
    std::fs::remove_dir_all(&dir).unwrap();
}

// The prompt reads the process's real stdin, so only the suppressed path is
// driven here; a regression would read stdin (EOF under cargo test < /dev/null
// or CI) and print the "Found 51 files" banner this test rejects.
fn run_tty(dir: &Path, args: &[&str]) -> (i32, String, String) {
    let argv: Vec<String> = args.iter().map(|s| s.to_string()).collect();
    let (mut io, cap) = Io::captured("", dir.to_path_buf(), HashMap::new());
    io.stdin_is_tty = true;
    let html = CannedHtml(vec![]);
    let engines = Engines { html: &html, url: None };
    let code = run_detect(&argv, &mut io, &engines);
    let out = String::from_utf8(cap.stdout.borrow().clone()).unwrap();
    let err = String::from_utf8(cap.stderr.borrow().clone()).unwrap();
    (code, out, err)
}

fn stage_many(tag: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("impeccable-gh-many-{tag}-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    for i in 0..51 {
        std::fs::write(dir.join(format!("f{i}.css")), "body { margin: 0; }\n").unwrap();
    }
    dir
}

#[test]
fn github_skips_the_large_scan_prompt() {
    let dir = stage_many("gh");
    let (code, _out, err) = run_tty(&dir, &["--no-config", "--github", "."]);
    assert_eq!(code, 0, "{err}");
    assert!(!err.contains("Found 51 files"), "{err}");
    assert!(!err.contains("Continue?"), "{err}");
    std::fs::remove_dir_all(&dir).unwrap();
}
