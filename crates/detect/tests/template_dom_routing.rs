//! DOM-engine routing for built-in SFC/template suffixes and configured
//! `detector.extensions` (`engine: "html"`). Regression for
//! https://github.com/pbakaus/impeccable/issues/795.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use impeccable_common::Io;
use impeccable_detect::{run_detect, Engines};
use serde_json::Value;

static HTML: impeccable_html::StaticHtmlEngine = impeccable_html::StaticHtmlEngine {
    static_rule_pack: None,
};

fn fixture_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/detect/template-dom-routing")
}

fn engines() -> Engines<'static> {
    Engines {
        html: &HTML,
        url: None,
    }
}

fn detect_json(cwd: &Path, args: &[&str]) -> (i32, Vec<Value>, String) {
    let argv: Vec<String> = args.iter().map(|s| (*s).to_string()).collect();
    let (mut io, cap) = Io::captured("", cwd.to_path_buf(), HashMap::new());
    let code = run_detect(&argv, &mut io, &engines());
    let stdout = String::from_utf8(cap.stdout.borrow().clone()).unwrap();
    let stderr = String::from_utf8(cap.stderr.borrow().clone()).unwrap();
    let findings: Vec<Value> = serde_json::from_str(stdout.trim()).unwrap_or_else(|e| {
        panic!("detect stdout was not JSON (exit {code}): {e}; stdout={stdout:?} stderr={stderr}")
    });
    (code, findings, stderr)
}

fn ids(findings: &[Value]) -> Vec<String> {
    findings
        .iter()
        .filter_map(|f| f.get("antipattern").and_then(Value::as_str).map(str::to_string))
        .collect()
}

fn has_dom_contrast_family(findings: &[Value]) -> bool {
    ids(findings).iter().any(|id| {
        id == "low-contrast" || id == "gray-on-color" || id == "hover-low-contrast"
    })
}

#[test]
fn builtin_markup_and_configured_erb_share_the_html_finding_family() {
    let cwd = fixture_dir()
        .canonicalize()
        .expect("template-dom-routing fixture");
    let names = [
        "page.html",
        "page.vue",
        "page.svelte",
        "page.blade.php",
        "page.html.erb",
    ];
    let mut by_name: Vec<(&str, Vec<Value>)> = Vec::new();
    for name in names {
        let (code, findings, stderr) =
            detect_json(&cwd, &["--json", "--no-design-system", name]);
        assert_eq!(
            code, 2,
            "{name}: expected findings (exit 2), got {code}; stderr={stderr}"
        );
        assert!(
            has_dom_contrast_family(&findings),
            "{name}: expected low-contrast family, got {:?} stderr={stderr}",
            ids(&findings)
        );
        by_name.push((name, findings));
    }
    let html_ids = ids(&by_name[0].1);
    for (name, findings) in &by_name[1..] {
        assert_eq!(
            ids(findings),
            html_ids,
            "{name} finding ids should match page.html"
        );
    }
}

#[test]
fn html_erb_without_config_does_not_run_dom_rules() {
    let src = fixture_dir().join("page.html.erb");
    let tmp = std::env::temp_dir().join(format!(
        "impeccable-detect-erb-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&tmp).unwrap();
    std::fs::copy(&src, tmp.join("page.html.erb")).unwrap();
    let (code, findings, stderr) = detect_json(
        &tmp,
        &["--json", "--no-design-system", "page.html.erb"],
    );
    let _ = std::fs::remove_dir_all(&tmp);
    assert!(
        !has_dom_contrast_family(&findings),
        "unconfigured .html.erb must not DOM-route; exit={code} ids={:?} stderr={stderr}",
        ids(&findings)
    );
}

#[test]
fn directory_walk_includes_configured_html_erb() {
    let cwd = fixture_dir()
        .canonicalize()
        .expect("template-dom-routing fixture");
    let (code, findings, stderr) = detect_json(&cwd, &["--json", "--no-design-system", "."]);
    assert_eq!(code, 2, "dir scan should find issues; stderr={stderr}");
    let files: Vec<&str> = findings
        .iter()
        .filter_map(|f| f.get("file").and_then(Value::as_str))
        .collect();
    assert!(
        files.iter().any(|f| f.ends_with("page.html.erb")),
        "configured .html.erb should appear in a directory walk, got {files:?}"
    );
    assert!(
        files.iter().any(|f| f.ends_with("page.vue")),
        "built-in .vue should appear in a directory walk, got {files:?}"
    );
}
